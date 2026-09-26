import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// iPhone 16 emulation check (Chrome DevTools Protocol, no test dependency): Safari iOS user agent,
// 852x393 landscape / 393x852 portrait at DPR 3, touch emulation with synthesized multi-touch
// (joystick + look + a button at once), frame-time sampling and screenshots in artifacts/mobile/.
//   node scripts/mobile-check.mjs [--gpu] [--seconds=6] [--cpu=1] [--quality=auto|low|balanced|high] [--skip-map]
// Chrome is not Safari: this checks layout, input and the render profile, not WebKit itself.
const args = new Map(process.argv.slice(2).map((arg) => { const [key, value = "1"] = arg.replace(/^--/, "").split("="); return [key, value]; }));
const out = resolve("artifacts", "mobile");
await mkdir(out, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch { /* next */ } }
if (!executable) throw new Error("Set CHROME_PATH to an installed Chromium browser.");
const port = 9341;
const chrome = spawn(executable, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(out, "profile")}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--enable-webgl", "--ignore-gpu-blocklist",
  ...(args.has("gpu") ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
  "--window-size=1000,1000", "about:blank",
], { stdio: "ignore", windowsHide: true });

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const LANDSCAPE = { width: 852, height: 393, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } };
const PORTRAIT = { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } };
let socket;
const report = { errors: [], landscape: null, portrait: null, checks: {} };
try {
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()); break; } catch { await delay(200); } }
  if (!tabs) throw new Error("Browser did not start");
  socket = new WebSocket(tabs.find((item) => item.type === "page").webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.addEventListener("open", ok, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  let counter = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); if (message.error) p.reject(new Error(JSON.stringify(message.error))); else p.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") report.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") report.errors.push(message.params.args.map((arg) => arg.description ?? arg.value).join(" "));
  });
  const call = (method, params = {}) => new Promise((ok, fail) => { const id = ++counter; pending.set(id, { resolve: ok, reject: fail }); socket.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); fail(new Error(`CDP timeout ${method}`)); } }, 30000); });
  const evaluate = async (expression) => { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const shot = async (name) => { const image = await call("Page.captureScreenshot", { format: "png" }); await writeFile(resolve(out, `${name}.png`), Buffer.from(image.data, "base64")); };
  const rect = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
  const touch = (type, points) => call("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });
  const tap = async (point, id = 20) => { await touch("touchStart", [{ ...point, id }]); await delay(60); await touch("touchEnd", []); await delay(250); };
  const tapButton = async (text) => {
    const point = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(el => el.offsetParent !== null && (el.getAttribute('aria-label') === ${JSON.stringify(text)} || el.textContent.replace(/^[^A-Za-z]+/, '').trim().startsWith(${JSON.stringify(text)}))); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!point) throw new Error(`No visible button: ${text}`);
    await tap(point);
  };
  const dataset = () => evaluate("(() => { const m = document.querySelector('main'); const c = document.querySelector('.coordinates'); return { phase: m?.dataset.phase, mode: m?.dataset.mode, quality: m?.dataset.quality ?? null, x: Number(c?.dataset.x), z: Number(c?.dataset.z), y: Number(c?.dataset.y), yaw: Number(c?.dataset.yaw) }; })()");
  // Frame intervals from the page's own rAF plus the engine's snapshot fps.
  const sample = async (seconds) => evaluate(`new Promise((done) => { const dts = []; let last = performance.now(); const end = last + ${seconds * 1000}; const step = (now) => { dts.push(now - last); last = now; if (now < end) requestAnimationFrame(step); else { dts.sort((a, b) => a - b); const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))]; done({ frames: dts.length, fps: Math.round(dts.length / ${seconds}), median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), engineFps: document.querySelector('.fps-count')?.textContent ?? '', canvas: (() => { const c = document.querySelector('.city-canvas'); return c ? c.width + 'x' + c.height : ''; })(), perf: window.__nightfallPerf?.() ?? null }); } }; requestAnimationFrame(step); })`);

  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setUserAgentOverride", { userAgent: IOS_UA, platform: "iPhone" });
  await call("Emulation.setDeviceMetricsOverride", LANDSCAPE);
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (Number(args.get("cpu") ?? 1) > 1) await call("Emulation.setCPUThrottlingRate", { rate: Number(args.get("cpu")) });
  await call("Page.navigate", { url: process.env.CITY_URL ?? "http://127.0.0.1:3000/?perf=1" });
  for (let i = 0; i < 150; i++) { if ((await dataset().catch(() => ({}))).phase === "intro") break; await delay(200); }
  report.gpu = await evaluate("(() => { const gl = document.createElement('canvas').getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()");
  await shot("landscape-intro");
  report.checks.noOverflow = await evaluate("document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight");
  if (args.has("quality")) {
    await tapButton("Settings"); await delay(300);
    const label = { auto: "Auto", low: "Performance", balanced: "Balanced", high: "Fine" }[args.get("quality")];
    await delay(300); await tapButton(label); await delay(300); await shot("landscape-settings");
    await tapButton("Back to the streets");
  } else await tapButton("Enter the city");
  await delay(3500);
  await shot("landscape-playing");
  report.landscape = { ...(await sample(Number(args.get("seconds") ?? 6))), state: await dataset() };

  // Multi-touch: left thumb joystick forward, right thumb swipes to look, third finger taps Jump.
  const zone = await rect("[data-touch-zone='move']");
  if (zone) {
    const before = await dataset();
    const stick = { x: 150, y: 290, id: 1 }, lookStart = { x: 620, y: 200, id: 2 };
    await touch("touchStart", [stick]);
    await delay(50);
    await touch("touchMove", [{ ...stick, y: stick.y - 70 }]);
    await touch("touchMove", [{ ...stick, y: stick.y - 70 }, lookStart]);
    for (let i = 1; i <= 12; i++) { await touch("touchMove", [{ ...stick, y: stick.y - 70 }, { ...lookStart, x: lookStart.x + i * 9 }]); await delay(30); }
    const jump = await rect("[data-touch-action='jump']");
    let airborne = null;
    if (jump) {
      await touch("touchMove", [{ ...stick, y: stick.y - 70 }, { ...lookStart, x: lookStart.x + 108 }, { x: jump.x, y: jump.y, id: 3 }]);
      await delay(180);
      airborne = (await dataset()).y;
      await touch("touchMove", [{ ...stick, y: stick.y - 70 }, { ...lookStart, x: lookStart.x + 108 }]);
    }
    await shot("landscape-multitouch");
    await delay(700);
    await touch("touchEnd", []);
    await delay(300);
    const after = await dataset();
    report.checks.multitouch = { moved: +Math.hypot(after.x - before.x, after.z - before.z).toFixed(2), turned: +(after.yaw - before.yaw).toFixed(3), jumpHeight: airborne, phase: after.phase };
    // Push past the ring: sprint.
    const s0 = await dataset();
    await touch("touchStart", [stick]); await delay(40);
    await touch("touchMove", [{ ...stick, y: stick.y - 150 }]); await delay(1000);
    const s1 = await dataset();
    await touch("touchEnd", []); await delay(200);
    report.checks.sprintSpeed = +(Math.hypot(s1.x - s0.x, s1.z - s0.z)).toFixed(2);
    // Drawer and context buttons.
    const menu = await rect("[data-touch-action='menu']");
    if (menu) { await tap(menu); await delay(300); await shot("landscape-drawer"); report.checks.drawer = await evaluate("document.querySelectorAll('[data-touch-drawer] button').length"); await tap(menu); }
    report.checks.buttonSizes = await evaluate("[...document.querySelectorAll('[data-touch-action]')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return b.dataset.touchAction + ':' + Math.round(r.width) + 'x' + Math.round(r.height); })");
  } else report.checks.multitouch = "no touch zone (old controls)";

  if (!args.has("skip-map") && zone) {
    await tap(await rect("[data-touch-action='menu']")); await delay(250);
    await tapButton("Map"); await delay(900);
    const area = await rect("[data-world-map] canvas");
    if (area) {
      const count = () => evaluate("document.querySelectorAll('[data-world-map] li').length");
      const c0 = await count();
      await tap({ x: area.x + 30, y: area.y + 20 }, 30); await delay(400);
      const c1 = await count();
      await touch("touchStart", [{ x: area.x - 40, y: area.y, id: 31 }, { x: area.x + 40, y: area.y, id: 32 }]);
      for (let i = 1; i <= 8; i++) { await touch("touchMove", [{ x: area.x - 40 - i * 10, y: area.y, id: 31 }, { x: area.x + 40 + i * 10, y: area.y, id: 32 }]); await delay(30); }
      await touch("touchEnd", []); await delay(400);
      await shot("landscape-map");
      report.checks.map = { waypointsBefore: c0, waypointsAfterTap: c1 };
      await tapButton("Close map"); await delay(400);
    }
  }

  await call("Emulation.setDeviceMetricsOverride", PORTRAIT);
  await delay(2500);
  await shot("portrait-playing");
  report.portrait = { ...(await sample(Number(args.get("seconds") ?? 6))), state: await dataset() };
  report.checks.portraitNoOverflow = await evaluate("document.documentElement.scrollWidth <= innerWidth");
  await tapButton("Pause"); await delay(500); await shot("portrait-paused");
  await call("Emulation.setDeviceMetricsOverride", LANDSCAPE);
  await delay(1500); await shot("landscape-paused");
} finally {
  console.log(JSON.stringify(report, null, 2));
  socket?.close();
  chrome.kill();
}
