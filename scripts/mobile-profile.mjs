import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// CPU profile of the iPhone-emulated city while walking (CDP Profiler): top self-time functions.
//   node scripts/mobile-profile.mjs [--seconds=5] [--cpu=1] [--port=9343] [--desktop] [--match=people,street-life]
// --desktop profiles a 1440x960 desktop page instead of the iPhone; --match also prints the
// inclusive time (self + callees) of the functions defined in files whose name contains a match.
const args = new Map(process.argv.slice(2).map((arg) => { const [key, value = "1"] = arg.replace(/^--/, "").split("="); return [key, value]; }));
const out = resolve("artifacts", "mobile");
await mkdir(out, { recursive: true });
const port = Number(args.get("port") ?? 9343);
const desktop = args.has("desktop");
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(out, "profile-cpu")}`, "--no-first-run", "--enable-webgl", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore", windowsHide: true });
let socket;
try {
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()); break; } catch { await delay(200); } }
  socket = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok) => socket.addEventListener("open", ok, { once: true }));
  let id = 0; const pending = new Map();
  socket.addEventListener("message", ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  const call = (method, params = {}) => new Promise((ok) => { const n = ++id; pending.set(n, ok); socket.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  await call("Page.enable"); await call("Runtime.enable"); await call("Profiler.enable");
  if (desktop) await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  else {
    await call("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
    await call("Emulation.setDeviceMetricsOverride", { width: 852, height: 393, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
    await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  if (Number(args.get("cpu") ?? 1) > 1) await call("Emulation.setCPUThrottlingRate", { rate: Number(args.get("cpu")) });
  await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?perf=1` });
  for (let i = 0; i < 900; i++) { const p = await evaluate("document.querySelector('main')?.dataset.phase"); if (p === "intro" || p === "error") break; await delay(200); }
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Enter the city')).click()");
  for (let i = 0; i < 50; i++) { if (await evaluate("document.querySelector('main')?.dataset.phase") === "playing") break; await delay(200); }
  const phase = await evaluate("document.querySelector('main')?.dataset.phase");
  console.log(`phase: ${phase}`);
  if (phase === "error") throw new Error(await evaluate("document.querySelector('.error-state details p')?.textContent ?? document.body.innerText.slice(-600)"));
  await delay(3000);
  const touch = (type, points) => desktop ? Promise.resolve() : call("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [{ x: 150, y: 290, id: 1 }]); await touch("touchMove", [{ x: 150, y: 230, id: 1 }]);
  await call("Profiler.setSamplingInterval", { interval: 200 });
  await call("Profiler.start");
  await delay(Number(args.get("seconds") ?? 5) * 1000);
  const { profile } = await call("Profiler.stop");
  await touch("touchEnd", []);
  await writeFile(resolve(out, "walk.cpuprofile"), JSON.stringify(profile));
  const self = new Map(), total = profile.samples.length;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const counts = new Map(); for (const s of profile.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [nodeId, n] of counts) { const f = byId.get(nodeId).callFrame; const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`; self.set(key, (self.get(key) ?? 0) + n); }
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`);
  console.log(top.join("\n"));
  if (args.has("match")) {
    // Inclusive time: every sample counts once for each distinct function on its stack.
    const matches = args.get("match").split(","), parent = new Map(), inclusive = new Map();
    for (const n of profile.nodes) for (const child of n.children ?? []) parent.set(child, n.id);
    const keyOf = (f) => `${f.functionName || "(anon)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber + 1}`;
    for (const [nodeId, n] of counts) {
      const seen = new Set();
      for (let id = nodeId; id !== undefined; id = parent.get(id)) { const f = byId.get(id).callFrame; if (matches.some((m) => f.url.includes(m) || f.functionName.includes(m))) seen.add(keyOf(f)); }
      for (const key of seen) inclusive.set(key, (inclusive.get(key) ?? 0) + n);
    }
    console.log("inclusive:");
    console.log([...inclusive].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`).join("\n"));
  }
  console.log(JSON.stringify(await evaluate("window.__nightfallPerf?.()")));
} finally { socket?.close(); chrome.kill(); }
