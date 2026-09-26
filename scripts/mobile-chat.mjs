import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// iPhone-emulated chat check (needs `npm run server`): create a room from the touch drawer, open chat from
// the drawer, confirm the input is focused, preview the layout with a keyboard-sized visual viewport.
//   node scripts/mobile-chat.mjs
const out = resolve("artifacts", "mobile");
await mkdir(out, { recursive: true });
const port = 9347;
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(out, "profile-chat")}`, "--no-first-run", "--enable-webgl", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore", windowsHide: true });
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
  const tapAt = async (p) => { await touch("touchStart", [{ ...p, id: 9 }]); await delay(60); await touch("touchEnd", []); await delay(350); };
  const find = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.offsetParent && (e.getAttribute('aria-label') === ${JSON.stringify(text)} || e.textContent.replace(/^[^A-Za-z]+/, '').trim().startsWith(${JSON.stringify(text)}))); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const tap = async (text) => { const p = await find(text); if (!p) throw new Error(`No button ${text}`); await tapAt(p); };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
  await call("Emulation.setDeviceMetricsOverride", { width: 852, height: 393, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.navigate", { url: "http://127.0.0.1:3000/" });
  for (let i = 0; i < 150; i++) { if (await evaluate("document.querySelector('main')?.dataset.phase") === "intro") break; await delay(200); }
  await tap("Enter the city"); await delay(800);
  await tapAt(await evaluate("(() => { const r = document.querySelector('[data-touch-action=menu]').getBoundingClientRect(); return { x: r.x + 22, y: r.y + 22 }; })()"));
  await tap("Online"); await delay(500);
  await evaluate("(() => { const i = document.querySelector('input[placeholder=Runner]'); i.focus(); })()");
  await call("Input.insertText", { text: "Thumbs" });
  await tap("Create room");
  for (let i = 0; i < 40; i++) { if (await find("Back to the city")) break; await delay(250); }
  await shot("chat-lobby");
  await tap("Back to the city"); await delay(800);
  await tapAt(await evaluate("(() => { const r = document.querySelector('[data-touch-action=menu]').getBoundingClientRect(); return { x: r.x + 22, y: r.y + 22 }; })()"));
  await shot("chat-drawer");
  await tap("Chat"); await delay(400);
  report.focused = await evaluate("document.activeElement?.id");
  report.fontSize = await evaluate("getComputedStyle(document.activeElement).fontSize");
  // The iOS keyboard shrinks the visual viewport; preview the layout at a keyboard-sized viewport.
  await evaluate("document.documentElement.style.setProperty('--vvh', '170px')");
  await call("Input.insertText", { text: "hello from the phone" });
  await shot("chat-open");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await delay(800);
  report.lastLine = await evaluate("[...document.querySelectorAll('section[aria-label=\"Room chat\"] li')].pop()?.textContent");
  await shot("chat-sent");
} finally { console.log(JSON.stringify(report, null, 1)); socket?.close(); chrome.kill(); }
