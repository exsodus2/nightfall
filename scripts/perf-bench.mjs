import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Frame-cost benchmark at the standard audit cameras. For each view it renders `--frames` frames
// back to back with t.redraw() (synchronous) and times each one twice: the CPU submit time (the
// redraw call) and the total time to a 1-pixel readPixels, which waits for the GPU. It also counts
// WebGL draw calls, uniform calls, buffer/texture uploads and program switches per frame.
//   node scripts/perf-bench.mjs [--play] [--shots] [--dpr=1] [--views=market,...] [--frames=120] [--port=9440] [--quality=balanced] [--out=perf-bench] [--query=k=v&k2=v2]
// Besides the studio views, --views takes the long-view cameras below (draw distance / LOD):
//   --views=edge-high,corner-high,avenue-long,top-down
// Medians are printed per view; the report is written to artifacts/<out>/report.json.
const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=") || "true"]; }));
const directory = resolve("artifacts", args.get("out") ?? "perf-bench");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const path of candidates) { try { await access(path); executable = path; break; } catch { /* next */ } }
if (!executable) throw new Error("Set CHROME_PATH to an installed Chromium browser.");
const port = Number(args.get("port") ?? 9440);
const chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve("artifacts", `perf-browser-profile-${port}`)}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", "--ignore-gpu-blocklist", "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
const report = [];
try {
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()); break; } catch { await delay(200); } }
  if (!tabs) throw new Error("Browser did not start");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(), errors = []; let id = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); if (message.error) p.reject(Error(JSON.stringify(message.error))); else p.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  const call = (method, params = {}) => new Promise((ok, reject) => { const n = ++id; pending.set(n, { resolve: ok, reject }); socket.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: Number(args.get("dpr") ?? 1), mobile: false });
  const views = (args.get("views") ?? "market,crossing,tenements,foundry,rooftops,platform,carriage").split(",");
  // Long-view cameras (positive pitch looks down): across the city from its edge and a corner, down
  // the central avenue at street level, and straight down from the air (the steep-view cull).
  const cameras = {
    "edge-high": { x: 0, z: 740, height: 165, yaw: 0, pitch: 0.05 },
    "corner-high": { x: 700, z: 700, height: 120, yaw: -0.785, pitch: 0.08 },
    "avenue-long": { x: 0, z: 700, height: 2.7, yaw: 0, pitch: -0.03 },
    "top-down": { x: -64, z: 128, height: 230, yaw: 0.3, pitch: 1.2 },
  };
  const frames = Number(args.get("frames") ?? 120);
  for (const view of views) {
    const params = new URLSearchParams({ studio: "1", view: cameras[view] ? "market" : view, clock: args.get("clock") ?? "45", clean: "1", perf: "1" });
    for (const [k, v] of new URLSearchParams(args.get("query") ?? "")) params.set(k, v);
    await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?${params}` });
    for (let i = 0; i < 450; i++) { const phase = await evaluate("document.querySelector('main')?.dataset.phase"); if (phase === "intro") break; if (phase === "error") throw Error(await evaluate("document.body.innerText")); await delay(200); }
    if (cameras[view]) await evaluate(`window.__nightfall.inspect(${JSON.stringify({ kind: "camera", ...cameras[view] })})`);
    if (args.has("quality")) {
      const label = { high: "Fine", balanced: "Balanced", low: "Performance" }[args.get("quality")];
      await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith('Settings')).click()");
      await delay(100);
      await evaluate(`[...document.querySelectorAll('[aria-label="Detail level"] button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
      await evaluate("document.querySelector('[aria-label=\"Close panel\"]').click()");
    }
    // --play: run the simulation (population, traffic, AI) during the benchmark, as in real play.
    if (args.has("play")) await evaluate("window.__nightfall.play()");
    await delay(Number(args.get("warm") ?? 2500));
    const result = await evaluate(`(() => {
      const t = window.__nightfall.t, canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2');
      const proto = WebGL2RenderingContext.prototype, counters = {}, originals = [];
      const count = (names, key) => { for (const name of names) { const original = proto[name]; originals.push([name, original]); proto[name] = function (...a) { counters[key] = (counters[key] ?? 0) + 1; return original.apply(this, a); }; } };
      count(["drawArrays", "drawElements"], "draws"); count(["drawArraysInstanced", "drawElementsInstanced"], "instancedDraws");
      // Instances submitted per frame (building parts, props and textmode's own shapes).
      for (const name of ["drawArraysInstanced", "drawElementsInstanced"]) { const original = proto[name]; originals.push([name, original]); proto[name] = function (...a) { counters.instances = (counters.instances ?? 0) + a[a.length - 1]; return original.apply(this, a); }; }
      count(Object.getOwnPropertyNames(proto).filter(n => /^uniform(Matrix)?[1-4]/.test(n)), "uniforms");
      count(["bufferData", "bufferSubData"], "bufferUploads"); count(["texSubImage2D", "texImage2D"], "textureUploads"); count(["useProgram"], "programs"); count(["bindFramebuffer"], "framebufferBinds");
      const pixel = new Uint8Array(4), cpu = [], total = [], perFrame = [];
      try {
        for (let i = 0; i < 10; i++) { t.redraw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); }
        for (let i = 0; i < ${frames}; i++) {
          for (const k in counters) counters[k] = 0;
          const a = performance.now(); t.redraw(); const b = performance.now();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); const c = performance.now();
          cpu.push(b - a); total.push(c - a); perFrame.push({ ...counters });
        }
      } finally { for (const [name, original] of originals.reverse()) proto[name] = original; }
      const median = v => { const s = [...v].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(3); };
      const p90 = v => { const s = [...v].sort((x, y) => x - y); return +s[Math.floor(s.length * 0.9)].toFixed(3); };
      const keys = new Set(perFrame.flatMap(f => Object.keys(f)));
      const calls = Object.fromEntries([...keys].map(k => [k, median(perFrame.map(f => f[k] ?? 0))]));
      return { cpuMedian: median(cpu), cpuP90: p90(cpu), totalMedian: median(total), totalP90: p90(total), calls, perf: window.__nightfallPerf?.() };
    })()`);
    report.push({ view, ...result });
    // --shots: a screenshot of the view as benchmarked (long-view LOD and fog review).
    if (args.has("shots")) { await delay(600); const { data } = await call("Page.captureScreenshot", { format: "png" }); await writeFile(resolve(directory, `${view}.png`), Buffer.from(data, "base64")); }
    console.log(JSON.stringify({ view, cpu: result.cpuMedian, cpuP90: result.cpuP90, total: result.totalMedian, totalP90: result.totalP90, ...result.calls, visible: result.perf?.visibleBuildings, grid: result.perf?.grid, sections: result.perf?.sections }));
  }
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  const mean = key => (report.reduce((s, r) => s + r[key], 0) / report.length).toFixed(3);
  console.log(`mean cpu ${mean("cpuMedian")} ms, mean total ${mean("totalMedian")} ms`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { socket?.close(); chrome.kill(); }
