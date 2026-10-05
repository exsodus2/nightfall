import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Deterministic, human-reviewable scene QA using the browser already installed.
// No screenshots of different camera positions masquerading as comparisons.
const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=") || "true"]; }));
const directory = resolve("artifacts", args.get("out") ?? "visual-audit");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const path of candidates) { try { await access(path); executable = path; break; } catch { /* Next browser */ } }
if (!executable) throw new Error("Set CHROME_PATH to an installed Chromium browser.");
const port = Number(args.get("port") ?? 9332);
const chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve("artifacts", `visual-browser-profile-${port}`)}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", ...(args.has("software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []), "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
const report = [];
const cameras = {
  "glass-office": { x: -45, z: 124, height: 14, yaw: 0, pitch: 0 },
  "glass-grazing": { x: -35, z: 119, height: 14, yaw: -1.335, pitch: 0 },
  "glass-warm": { x: -45, z: 63, height: 14, yaw: 0, pitch: 0 },
  "park-pond": { x: -437, z: 249, height: 9, yaw: 0.72, pitch: 0.22 },
  "park-arena": { x: -527, z: 378, height: 10, yaw: 0.74, pitch: 0.24 },
  // Positive pitch looks down. District massing and roof kits from the air (architecture.ts).
  "foundry-air": { x: -576, z: -128, height: 60, yaw: 0.3, pitch: 0.25 },
  "neon-air": { x: 0, z: -200, height: 55, yaw: 0.2, pitch: 0.2 },
  "ghost-air": { x: 576, z: -128, height: 60, yaw: -0.3, pitch: 0.25 },
  "gardens-air": { x: -576, z: 192, height: 55, yaw: 3.44, pitch: 0.25 },
  "spill-air": { x: 576, z: 192, height: 45, yaw: 2.84, pitch: 0.2 },
  "street-up": { x: -128, z: 96, height: 2.7, yaw: 0.4, pitch: -0.45 },
  "roof-close": { x: -128, z: 64, height: 95, yaw: 0.8, pitch: 0.4 },
  "top-down": { x: -64, z: 128, height: 230, yaw: 0.3, pitch: 1.2 },
  // Landmarks (landmarks-scene.ts), shopfronts and street life (signage.ts, street-life.ts).
  "ember-core": { x: -452, z: -258, height: 2.7, yaw: -0.75, pitch: -0.35 },
  "ember-far": { x: -448, z: 0, height: 2.7, yaw: -0.11, pitch: -0.05 },
  "spire": { x: 5, z: -130, height: 2.7, yaw: 0.73, pitch: -0.55 },
  "spire-far": { x: 0, z: 140, height: 2.7, yaw: 0.106, pitch: -0.12 },
  "gate": { x: 4, z: 160, height: 2.7, yaw: 3.1416, pitch: -0.2 },
  "cathedral": { x: 452, z: -258, height: 2.7, yaw: 0.75, pitch: -0.45 },
  "tree": { x: -462, z: 268, height: 2.7, yaw: -2.41, pitch: -0.3 },
  "arcade": { x: 452, z: 260, height: 2.7, yaw: 2.36, pitch: -0.3 },
  "storefront": { x: -45, z: 131, height: 2.7, yaw: 3.1416, pitch: 0.05 },
  "stall": { x: -45, z: 187.5, height: 2.7, yaw: 0, pitch: 0.05 },
  "alley-cables": { x: -60, z: 160, height: 2.7, yaw: 1.5708, pitch: -0.2 },
  // Holograms and hologram screens (materials.ts SURFACE 7 / 5).
  "hologram": { x: -71, z: -45, height: 40, yaw: 1.5708, pitch: 0.1 },
  "hologram-street": { x: -70, z: 5, height: 38, yaw: 0.25, pitch: 0.05 },
  "screen": { x: 66, z: 96, height: 27, yaw: -0.7, pitch: 0 },
};
try {
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()); break; } catch { await delay(200); } }
  if (!tabs) throw new Error("Browser did not start");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(), errors = []; let id = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const promise = pending.get(message.id); pending.delete(message.id); clearTimeout(promise.timer);
      if (message.error) promise.reject(Error(JSON.stringify(message.error))); else promise.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(" "));
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`Timed out: ${method}`)); }, 180000);
    pending.set(requestId, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await call("Runtime.enable"); await call("Page.enable");
  const mobile = args.has("mobile");
  await call("Emulation.setDeviceMetricsOverride", { width: mobile ? 844 : 1440, height: mobile ? 390 : 960, deviceScaleFactor: Number(args.get("dpr") ?? (mobile ? 3 : 1)), mobile });
  if (mobile) await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const views = (args.get("views") ?? "market,crossing,tenements,foundry,rooftops,platform,carriage").split(",");
  for (const view of views) {
    const params = new URLSearchParams({ studio: "1", view, clock: args.get("clock") ?? "45", clean: "1", perf: "1" });
    if (args.has("reference")) params.set("reference", args.get("reference"));
    const url = `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?${params}`;
    const startedAt = performance.now();
    await call("Page.navigate", { url });
    console.log(`Loading ${view}...`);
    for (let i = 0; i < 100; i++) {
      const phase = await evaluate("document.querySelector('main')?.dataset.phase");
      if (phase === "error") throw Error(await evaluate("document.body.innerText"));
      if (phase === "intro") break;
      await delay(200);
    }
    if (await evaluate("document.querySelector('main')?.dataset.phase") !== "intro") throw Error(`Renderer not ready: ${view}`);
    const readyMs = Math.round(performance.now() - startedAt);
    if (cameras[view]) await evaluate(`window.__nightfall.inspect(${JSON.stringify({ kind: "camera", ...cameras[view] })})`);
    if (args.has("quality")) {
      const label = { high: "Fine", balanced: "Balanced", low: "Performance", auto: "Auto" }[args.get("quality")];
      if (!label) throw Error("Quality must be high, balanced, low or auto");
      await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith('Settings')).click()");
      await delay(100);
      await evaluate(`[...document.querySelectorAll('[aria-label="Detail level"] button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
      await evaluate("document.querySelector('[aria-label=\"Close panel\"]').click()");
    }
    await delay(Number(args.get("warm") ?? 2500));
    const image = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${view}.png`), Buffer.from(image.data, "base64"));
    const metrics = await evaluate("({ fps: document.querySelector('.fps-count')?.textContent, status: [...document.querySelectorAll('.studio-body dl > *')].map(el=>el.textContent).join(' | '), x: document.querySelector('.coordinates')?.dataset.x, z: document.querySelector('.coordinates')?.dataset.z, performance: window.__nightfallPerf?.() })");
    report.push({ view, url, readyMs, ...metrics }); console.log(JSON.stringify({ view, readyMs, ...metrics }));
  }
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  await writeFile(resolve(directory, "index.html"), `<!doctype html><meta charset="utf-8"><title>Nightfall visual audit</title><style>body{margin:32px;background:#0a1317;color:#c5d4ce;font:14px/1.6 system-ui}h1{font-size:24px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0}img{width:100%;image-rendering:auto}a{color:#9ddccd}figcaption{padding:10px 0}details{font:12px monospace;white-space:pre-line}@media(max-width:900px){main{grid-template-columns:1fr}}</style><h1>Nightfall · visual audit</h1><p>Fixed seed, camera and clock. Click a scene to inspect the full-resolution image. <a href="${escape(process.env.CITY_URL ?? "http://127.0.0.1:3000")}/?studio=1">Open scene lab</a></p><main>${report.map(row => `<figure><a href="${row.view}.png"><img src="${row.view}.png" alt="${row.view}"></a><figcaption><strong>${row.view}</strong> · ${row.fps} · <a href="${escape(row.url.replace("clean=1", "clean=0"))}">Inspect this camera</a><details><summary>Scene metrics</summary>${escape(row.status ?? "")}</details></figcaption></figure>`).join("")}</main>`);
  console.log(`Gallery: ${resolve(directory, "index.html")}`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { socket?.close(); chrome.kill(); }
