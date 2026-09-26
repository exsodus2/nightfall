import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// iPhone-emulated touch check of the context controls: get into a kerbside car with the Interact
// button, drive with the joystick (throttle + steer), handbrake, chase cam; then flight: Fly, Rise, Land.
//   node scripts/mobile-modes.mjs
const out = resolve("artifacts", "mobile");
await mkdir(out, { recursive: true });
const port = 9345;
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(out, "profile-modes")}`, "--no-first-run", "--enable-webgl", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore", windowsHide: true });
let socket;
const report = { errors: [] };
try {
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()); break; } catch { await delay(200); } }
  socket = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok) => socket.addEventListener("open", ok, { once: true }));
  let id = 0; const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") report.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  const call = (method, params = {}) => new Promise((ok) => { const n = ++id; pending.set(n, ok); socket.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (name) => { const image = await call("Page.captureScreenshot", { format: "png" }); await writeFile(resolve(out, `${name}.png`), Buffer.from(image.data, "base64")); };
  const touch = (type, points) => call("Input.dispatchTouchEvent", { type, touchPoints: points });
  const center = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const tap = async (selector) => { const p = await center(selector); if (!p) return false; await touch("touchStart", [{ ...p, id: 9 }]); await delay(60); await touch("touchEnd", []); await delay(300); return true; };
  const state = () => evaluate("(() => { const m = document.querySelector('main'), c = document.querySelector('.coordinates'); return { mode: m.dataset.mode, x: +c.dataset.x, z: +c.dataset.z, y: +c.dataset.y, yaw: +c.dataset.yaw, interact: document.querySelector('[data-touch-action=interact]')?.textContent ?? null }; })()");
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
  await call("Emulation.setDeviceMetricsOverride", { width: 852, height: 393, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  // Next to a kerbside car (computed from the deterministic ParkedCars layout near the spawn).
  await call("Page.navigate", { url: "http://127.0.0.1:3000/?studio=1&camera=13.5,2.7,90.8,-1.57,0" });
  for (let i = 0; i < 150; i++) { if (await evaluate("document.querySelector('main')?.dataset.phase") === "intro") break; await delay(200); }
  await evaluate("document.querySelector('.scene-studio')?.remove()");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Enter the city')).click()");
  await delay(1500);
  report.start = await state();
  await shot("mode-car-prompt");
  await tap("[data-touch-action=interact]");
  await delay(600);
  report.inCar = await state();
  const stick = { x: 150, y: 290, id: 1 };
  await touch("touchStart", [stick]); await touch("touchMove", [{ ...stick, y: stick.y - 60 }]);
  await delay(1600);
  await touch("touchMove", [{ ...stick, x: stick.x + 40, y: stick.y - 50 }]);
  await delay(600);
  await shot("mode-driving");
  report.driving = await state();
  await touch("touchEnd", []);
  const brake = await center("[data-touch-action=handbrake]");
  if (brake) { await touch("touchStart", [{ ...brake, id: 5 }]); await delay(1500); await touch("touchEnd", []); }
  await tap("[data-touch-action=camera]"); await delay(500);
  await shot("mode-chase");
  report.braked = await state();
  await delay(1500);
  await tap("[data-touch-action=interact]"); await delay(500);
  report.outOfCar = await state();
  await tap("[data-touch-action=fly]"); await delay(300);
  const rise = await center("[data-touch-action=rise]");
  if (rise) { await touch("touchStart", [{ ...rise, id: 6 }]); await delay(1500); await touch("touchEnd", []); }
  await shot("mode-flying");
  report.flying = await state();
  await tap("[data-touch-action=land]"); await delay(400);
  report.landed = await state();
  // Context loss (iOS drops WebGL contexts under memory pressure): overlay, then rebuild on restore.
  await evaluate("window.__lose = document.querySelector('.city-canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); true");
  await delay(600);
  report.lost = await evaluate("({ phase: document.querySelector('main').dataset.phase, text: document.querySelector('[role=alert] h1')?.textContent })");
  await shot("context-lost");
  await evaluate("window.__lose.restoreContext(); true");
  for (let i = 0; i < 60; i++) { if (await evaluate("document.querySelector('main').dataset.phase") === "paused") break; await delay(250); }
  report.rebuilt = { ...(await state()), phase: await evaluate("document.querySelector('main').dataset.phase") };
  await delay(2500); await shot("context-rebuilt");
} finally { console.log(JSON.stringify(report, null, 1)); socket?.close(); chrome.kill(); }
