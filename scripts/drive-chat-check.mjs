// Driving HUD vs room chat: proves the bottom-left driving controls strip, the room chat column, the
// walking hint, the travel HUD, the interaction prompt, the quest tracker and the location strip never
// overlap, walking and driving, chat closed and open, at common desktop sizes. Runs its own in-process
// multiplayer server (so chat exists) against the already running dev server; it never starts Next.
//   node --experimental-strip-types scripts/drive-chat-check.mjs [--port=9441] [--out=drive-chat] [--software]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createNightfallServer } from "../server/app.ts";
import { MultiplayerSession } from "../src/multiplayer/session.ts";

const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const port = Number(argument("port", "9441"));
const directory = resolve("artifacts", argument("out", "drive-chat"));
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const profile = await mkdtemp(resolve(directory, "profile-"));
const { gameServer, httpServer } = createNightfallServer();
const host = new MultiplayerSession(), peer = new MultiplayerSession();
const report = { checks: [], errors: [], failures: [], screenshots: [] };
const pending = new Map();
const vehicle = { id: 61101, x: 0, z: 100, yaw: 0 };
let chrome, socket;
const until = async (predicate, label, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) { if (Date.now() > deadline) throw Error(`Timed out: ${label}`); await delay(100); }
};

try {
  await gameServer.listen(0, "127.0.0.1");
  const serverUrl = `ws://127.0.0.1:${httpServer.address().port}`;
  assert.ok(await host.connect({ serverUrl, name: "Kerbside Host" }));
  const code = host.getView().code;
  assert.ok(await peer.connect({ serverUrl, code, name: "Mira from Silk Market" }));
  const lines = [
    [host, "Anyone near the Silk Market cab rank?"],
    [peer, "Two blocks east of Blue Hour Tea, by the noodle cart."],
    [host, "Parking by the kerb. Meet at the monorail stairs?"],
    [peer, "On my way. Watch the Razorbacks on the overpass, they jumped me last run and took half my ammo."],
    [host, "Copy. Driving over now."],
  ];
  for (const [sender, text] of lines) { assert.ok(sender.sendChat(text)); await delay(1300); }

  chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", ...(process.argv.includes("--software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []), "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let tabs;
  await until(async () => { try { tabs = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) }).then(response => response.json()); return true; } catch { return false; } }, "browser startup");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let requestId = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") report.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") report.errors.push(message.params.args.map(item => item.value ?? item.description).join(" "));
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++requestId, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 180000);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  const waitPage = (expression, label, timeout) => until(() => evaluate(expression), label, timeout);
  const click = async label => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(element => element.offsetParent && (element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.textContent.replace(/^[^A-Za-z]+/,'').trim().startsWith(${JSON.stringify(label)}))); if (!button) throw Error('Missing button: '+${JSON.stringify(label)}); button.click(); })()`);
    await delay(250);
  };
  const field = async (label, value) => {
    await evaluate(`(() => { const input = [...document.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input'); if (!input) throw Error('Missing field: '+${JSON.stringify(label)}); input.focus(); input.select(); })()`);
    await call("Input.insertText", { text: value }); await delay(100);
  };
  const press = async (code, key, duration = 60) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key, windowsVirtualKeyCode: code === "Enter" ? 13 : code === "Escape" ? 27 : undefined });
    try { await delay(duration); } finally { await call("Input.dispatchKeyEvent", { type: "keyUp", code, key }); }
    await delay(250);
  };
  const capture = async name => {
    const shot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(shot.data, "base64"));
    report.screenshots.push(resolve(directory, `${name}.png`));
  };
  // Native HUD rows (HP / ammo) drawn by textmode on the last layer, in CSS pixels.
  const instrument = () => evaluate(`(() => {
    const textmode = window.__nightfall.t, hud = textmode.layers.all.at(-1), print = textmode.print, align = textmode.printAlign;
    let horizontal = 'left', vertical = 'top', rows = [];
    window.__hudAudit = { rows: [], frames: 0 };
    textmode.printAlign = function(nextHorizontal, nextVertical) { horizontal = nextHorizontal; vertical = nextVertical ?? vertical; return align.apply(this, arguments); };
    textmode.print = function(value, column, row) { if (textmode.grid === hud.grid) rows.push({ text: String(value), column, row, horizontal, vertical }); return print.apply(this, arguments); };
    hud.postDraw(() => { const grid = hud.grid; window.__hudAudit = { rows, frames: window.__hudAudit.frames + 1, cols: grid.cols, lines: grid.rows }; rows = []; });
  })()`);

  // Pairs that must never overlap. Native rows are checked against every DOM element below.
  const PAIRS = [
    [".drive-hud", "chat"], [".drive-hud", ".travel-hud"], [".drive-hud", ".navigation-widget"], [".drive-hud", ".city-footer"], [".drive-hud", ".interaction-prompt"],
    [".walking-hint", "chat"], [".walking-hint", ".travel-hud"], [".walking-hint", ".city-footer"],
    ["chat", ".travel-hud"], ["chat", ".quest-hud"], ["chat", ".interaction-prompt"], ["chat", ".navigation-widget"], ["chat", ".city-footer"],
    [".interaction-prompt", ".travel-hud"], [".quest-hud", ".location-strip"], [".quest-hud", ".city-header"], [".location-strip", ".city-header"],
    [".quest-toast", ".navigation-widget"], [".quest-toast", ".quest-hud"],
  ];
  const measure = async name => {
    const result = await evaluate(String.raw`(() => {
      const visible = element => { if (!element) return false; const style = getComputedStyle(element), bounds = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05 && bounds.width > 0 && bounds.height > 0; };
      const box = element => { const bounds = element.getBoundingClientRect(); return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }; };
      const selectors = { chat: 'section[aria-label="Room chat"]', '.drive-hud': '.drive-hud', '.walking-hint': '.walking-hint', '.travel-hud': '.travel-hud', '.navigation-widget': '.navigation-widget', '.city-footer': '.city-footer > *', '.interaction-prompt': '.interaction-prompt', '.quest-hud': '.quest-hud', '.location-strip': '.location-strip', '.city-header': '.city-header', '.quest-toast': '.quest-toast' };
      const rects = {};
      for (const [key, selector] of Object.entries(selectors)) rects[key] = [...document.querySelectorAll(selector)].filter(visible).map(box);
      const audit = window.__hudAudit;
      const native = (audit?.rows ?? []).filter(row => row.vertical === 'top' && (row.text.startsWith('HP ') || row.text.startsWith('ST ') || /^\d+ \/ \d+/.test(row.text))).map(row => {
        const leftColumn = row.column - (row.horizontal === 'right' ? row.text.length : row.horizontal === 'center' ? Math.floor(row.text.length / 2) : 0);
        const left = (leftColumn + Math.floor(audit.cols / 2)) * innerWidth / audit.cols, top = (row.row + Math.floor(audit.lines / 2)) * innerHeight / audit.lines;
        return { text: row.text, left, top, right: left + row.text.length * innerWidth / audit.cols, bottom: top + innerHeight / audit.lines };
      });
      const chat = document.querySelector('section[aria-label="Room chat"]');
      return { width: innerWidth, height: innerHeight, mode: document.querySelector('main').dataset.mode, phase: document.querySelector('main').dataset.phase, chatOpen: chat?.dataset.open ?? null, chatLines: chat ? chat.querySelectorAll('li').length : 0, rects, native, overflow: document.documentElement.scrollWidth > innerWidth, rendererError: document.querySelector('main').dataset.phase === 'error' ? document.querySelector('.error-state details p')?.textContent ?? 'unknown' : null };
    })()`);
    const overlaps = (first, second) => Math.min(first.right, second.right) > Math.max(first.left, second.left) + 1 && Math.min(first.bottom, second.bottom) > Math.max(first.top, second.top) + 1;
    const failures = [];
    for (const [first, second] of PAIRS) for (const a of result.rects[first] ?? []) for (const b of result.rects[second] ?? []) if (overlaps(a, b)) failures.push(`${name}: ${first} overlaps ${second} ${JSON.stringify({ a, b })}`);
    for (const row of result.native) for (const [key, list] of Object.entries(result.rects)) for (const rect of list) if (overlaps(row, rect)) failures.push(`${name}: native "${row.text}" overlaps ${key} ${JSON.stringify({ row, rect })}`);
    for (const [key, list] of Object.entries(result.rects)) for (const rect of list) if (rect.left < -1 || rect.right > result.width + 1 || rect.top < -1 || rect.bottom > result.height + 1) failures.push(`${name}: ${key} leaves the viewport ${JSON.stringify(rect)}`);
    if (result.overflow) failures.push(`${name}: page scrolls horizontally`);
    if (result.rendererError) failures.push(`${name}: the renderer stopped: ${result.rendererError}`);
    report.failures.push(...failures);
    report.checks.push({ name, ...result, failures });
    console.log(`${name}: mode=${result.mode} chat=${result.chatOpen} lines=${result.chatLines} native=${result.native.length} ${failures.length ? `FAIL ${failures.length}` : "clear"}`);
    for (const failure of failures) console.log(`  ${failure}`);
    await capture(name);
    return result;
  };
  const viewport = async (width, height) => {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(600);
  };

  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setTouchEmulationEnabled", { enabled: false });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await viewport(1440, 960);
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.clear(); localStorage.setItem('nightfall.driveView','cockpit'); } catch {}" });
  await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&clock=4&perf=1&rpgtest=1&server=${encodeURIComponent(serverUrl)}` });
  console.log("Loading city and compiling shaders...");
  await waitPage("document.querySelector('main')?.dataset.phase === 'intro' && !!window.__nightfall", "renderer ready", 180000);
  await evaluate("document.querySelector('.scene-studio').style.display='none'");
  await click("Enter the city");
  await waitPage("document.querySelector('main')?.dataset.phase === 'playing'", "city entered play");
  await evaluate("window.__nightfall.inspect({kind:'freeze',value:true})");
  await instrument();
  await click("Online");
  await waitPage("!!document.querySelector('#mp-title')", "online panel");
  await field("Display name", "Drive QA"); await field("Room code", code); await click("Join room");
  await waitPage("document.querySelector('#mp-title')?.textContent === 'Party up.'", "joined room");
  await click("Back to the city");
  await waitPage("document.querySelector('main')?.dataset.phase === 'playing' && !!document.querySelector('section[aria-label=\"Room chat\"]')", "chat visible in play");
  await until(async () => (await evaluate("document.querySelectorAll('section[aria-label=\"Room chat\"] li').length")) >= 3, "chat history arrives");

  await evaluate(`window.__nightfall.parked.park(${JSON.stringify(vehicle)})`);
  await evaluate(`window.__nightfall.inspect({kind:'camera',x:-3,z:${vehicle.z},height:2.7,yaw:Math.PI/2,pitch:0})`);
  await delay(500);
  for (const [width, height] of [[1440, 960], [1280, 720]]) {
    await viewport(width, height);
    await measure(`walk-${width}x${height}`);
  }
  await viewport(1440, 960);
  assert.match(await evaluate("document.querySelector('.interaction-prompt')?.textContent ?? ''"), /car/i, "standing by the parked car offers to get in");
  await press("KeyE", "e");
  await waitPage("document.querySelector('main')?.dataset.mode === 'drive' && !!document.querySelector('.drive-hud')", "entered the car", 8000);
  await delay(600);
  for (const [width, height] of [[1440, 960], [1280, 720], [1024, 640]]) {
    await viewport(width, height);
    await measure(`drive-${width}x${height}`);
    await press("Enter", "Enter");
    await waitPage("document.querySelector('section[aria-label=\"Room chat\"]')?.dataset.open === 'true'", "chat opened with Enter", 5000);
    await evaluate("document.querySelector('#chat-input')?.select()");
    await call("Input.insertText", { text: "Pulling up outside Blue Hour Tea" });
    await delay(300);
    await measure(`drive-chat-open-${width}x${height}`);
    await press("Escape", "Escape");
    await waitPage("document.querySelector('section[aria-label=\"Room chat\"]')?.dataset.open === 'false'", "chat closed with Escape", 5000);
  }
  assert.deepEqual(report.errors, [], "No browser runtime errors");
  assert.deepEqual(report.failures, [], "Bottom-left HUD, chat and the other overlays stay apart");
  console.log(`Drive/chat layout checks passed. Screenshots in ${directory}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  socket?.close(); chrome?.kill();
  await Promise.allSettled([host.leave(), peer.leave()]);
  await gameServer.gracefullyShutdown?.(false).catch(() => {});
  httpServer.close();
  process.exit(process.exitCode ?? 0);
}
