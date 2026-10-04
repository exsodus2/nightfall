import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createNightfallServer } from "../server/app.ts";
import { MultiplayerSession } from "../src/multiplayer/session.ts";
import { CHAT_MAX, sanitizeText } from "../src/multiplayer/protocol.ts";
import { combatHudLayout } from "../src/rpg/scene/hud-layout.ts";
import { CHAT_PREVIEW_MS } from "../src/components/chat-attention.ts";

const directory = resolve("artifacts", "mobile-chat");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const profile = await mkdtemp(resolve(directory, "profile-"));
const { gameServer, httpServer } = createNightfallServer();
const host = new MultiplayerSession(), other = new MultiplayerSession(), peers = [];
const report = { checks: [], errors: [], screenshots: [] };
let chrome, socket, call, lastSent = 0;
const pending = new Map();
const until = async (predicate, label, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) { if (Date.now() > deadline) throw Error(`Timed out: ${label}`); await delay(100); }
};
const overlap = (first, second) => first.left < second.right - 1 && first.right > second.left + 1 && first.top < second.bottom - 1 && first.bottom > second.top + 1;

try {
  await gameServer.listen(0, "127.0.0.1");
  const serverUrl = `ws://127.0.0.1:${httpServer.address().port}`;
  assert.ok(await host.connect({ serverUrl, name: "A very long runner name" }));
  const firstCode = host.getView().code;
  for (let index = 0; index < 3; index++) {
    const visitor = new MultiplayerSession(); peers.push(visitor);
    assert.ok(await visitor.connect({ serverUrl, code: firstCode, name: `Old visitor ${index}` }));
    await visitor.leave();
  }
  assert.ok(host.sendChat("Earlier room conversation"));
  await until(() => host.getView().chat.some(line => line.text === "Earlier room conversation"), "history seed");
  const port = 9365;
  chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", "--window-size=852,393", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let tabs;
  await until(async () => { try { tabs = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) }).then(response => response.json()); return true; } catch { return false; } }, "browser startup");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let requestId = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") report.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") report.errors.push(message.params.args.map(argument => argument.value ?? argument.description).join(" "));
  });
  socket.addEventListener("close", () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error("Test browser closed")); } pending.clear(); });
  call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++requestId, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 180000);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  const waitPage = (expression, label, timeout) => until(() => evaluate(expression), label, timeout);
  const capture = async name => {
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(screenshot.data, "base64"));
    report.screenshots.push(`${name}.png`);
  };
  const click = async label => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(element => element.offsetParent && (element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.textContent.replace(/^[^A-Za-z]+/,'').trim().startsWith(${JSON.stringify(label)}))); if (!button) throw Error('Missing button: '+${JSON.stringify(label)}); button.click(); })()`);
    await delay(150);
  };
  const tap = async selector => {
    const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw Error('Missing tap target'); const bounds = element.getBoundingClientRect(); return {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}; })()`);
    await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 9 }] });
    await delay(45);
    await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await delay(200);
  };
  const key = async (code, value) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key: value });
    await call("Input.dispatchKeyEvent", { type: "keyUp", code, key: value });
    await delay(150);
  };
  const field = async (label, value) => {
    await evaluate(`(() => { const input = [...document.querySelectorAll('label')].find(element=>element.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input'); if (!input) throw Error('Missing field'); input.focus(); input.select(); })()`);
    await call("Input.insertText", { text: value }); await delay(100);
  };
  const send = async (text, sender = host) => {
    await delay(Math.max(0, 1250 - (Date.now() - lastSent))); lastSent = Date.now();
    assert.ok(sender.sendChat(text));
    await until(() => sender.getView().chat.some(line => line.text === sanitizeText(text, CHAT_MAX) && line.kind === "chat"), "real chat delivery");
    await delay(150);
  };
  const unread = () => evaluate("Number(document.querySelector('section[aria-label=\"Room chat\"]')?.dataset.unread)");
  const closed = () => waitPage("document.querySelector('section[aria-label=\"Room chat\"]')?.dataset.open === 'false'", "closed chat");
  const online = async () => { await tap('[data-touch-action="menu"]'); await click("Online"); await waitPage("!!document.querySelector('#mp-title')", "online panel"); };
  const join = async code => { await field("Room code", code); await click("Join room"); await waitPage("document.querySelector('#mp-title')?.textContent === 'Party up.'", "joined room"); await click("Back to the city"); await closed(); };
  const viewport = async (width, height, touch = true, insets = {}) => {
    await call("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: 5 });
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: touch, screenOrientation: { type: width >= height ? "landscapePrimary" : "portraitPrimary", angle: width >= height ? 90 : 0 } });
    await evaluate(`(() => { const root=document.documentElement; for(const [key,value] of Object.entries(${JSON.stringify({ sat: 0, sar: 0, sab: 0, sal: 0, ...insets })})) root.style.setProperty('--'+key,value+'px'); })()`);
    await delay(400);
  };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 852, height: 393, deviceScaleFactor: 1, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.clear()" });
  await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&clock=4&perf=1&server=${encodeURIComponent(serverUrl)}` });
  console.log("Loading isolated mobile chat regression.");
  await waitPage("document.querySelector('main')?.dataset.phase === 'intro' && !!window.__nightfall", "renderer ready", 180000);
  await evaluate("document.querySelector('.scene-studio').style.display='none'");
  await click("Enter the city");
  await evaluate("window.__nightfall.inspect({kind:'freeze',value:true}); document.addEventListener('click',event=>{if(event.target.closest?.('[data-chat-launcher]')) window.__chatSynchronousFocus=document.activeElement?.id==='chat-input';});");
  await online(); await field("Display name", "Chat QA"); await join(firstCode);
  await delay(300);
  assert.equal(await unread(), 0, "old history does not create unread");
  assert.equal(await evaluate("!!document.querySelector('[data-chat-preview]')"), false);
  for (let index = 0; index < 6; index++) {
    const peer = new MultiplayerSession(); peers.push(peer);
    assert.ok(await peer.connect({ serverUrl, code: firstCode, name: `Long roster player ${index + 1}` }));
  }
  await until(() => host.getView().roster.length === 8, "full roster");
  await delay(400);
  assert.equal(await unread(), 0, "live system joins do not create unread");
  report.checks.push({ name: "history-and-system", unread: 0, roster: 8 });

  const measure = async name => {
    const result = await evaluate(`(() => {
      const rectangle=element=>{const bounds=element.getBoundingClientRect();return {left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom,width:bounds.width,height:bounds.height};};
      const visible=element=>element && getComputedStyle(element).display!=='none' && getComputedStyle(element).visibility!=='hidden' && element.getBoundingClientRect().height>0;
      const section=document.querySelector('section[aria-label="Room chat"]'),launcher=document.querySelector('[data-chat-launcher]'),preview=document.querySelector('[data-chat-preview]'),grid=window.__nightfall.t.layers.all.at(-1).grid,root=getComputedStyle(document.documentElement);
      return {width:innerWidth,height:innerHeight,touch:matchMedia('(pointer:coarse)').matches,cols:grid.cols,rows:grid.rows,unread:Number(section.dataset.unread),launcher:rectangle(launcher),preview:preview?rectangle(preview):null,logVisible:visible(section.querySelector('ol')),controls:[...document.querySelectorAll('[data-touch-action="pause"],[data-touch-action="menu"],.navigation-widget')].filter(visible).map(rectangle),insets:{top:parseFloat(root.getPropertyValue('--sat'))||0,right:parseFloat(root.getPropertyValue('--sar'))||0,bottom:parseFloat(root.getPropertyValue('--sab'))||0,left:parseFloat(root.getPropertyValue('--sal'))||0},expanded:launcher.getAttribute('aria-expanded'),label:launcher.getAttribute('aria-label'),overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    assert.equal(result.touch, true); assert.equal(result.logVisible, false); assert.equal(result.expanded, "false"); assert.equal(result.overflow, false);
    assert.equal(result.launcher.width, 44); assert.equal(result.launcher.height, 44);
    const layout = combatHudLayout(result.cols, result.rows, result);
    const hud = Object.values(layout).map(region => ({ left: (region.left + Math.floor(result.cols / 2)) * result.width / result.cols, top: (region.top + Math.floor(result.rows / 2)) * result.height / result.rows, right: (region.left + Math.floor(result.cols / 2) + region.width) * result.width / result.cols, bottom: (region.top + Math.floor(result.rows / 2) + region.height) * result.height / result.rows }));
    for (const box of [result.launcher, result.preview].filter(Boolean)) {
      assert.ok(box.left >= result.insets.left && box.right <= result.width - result.insets.right, `${name}: horizontal safe area`);
      assert.ok(box.top >= result.insets.top && box.bottom <= result.insets.top + 54.1, `${name}: bounded top band`);
      for (const obstacle of [...hud, ...result.controls]) assert.ok(!overlap(box, obstacle), `${name}: HUD/control overlap ${JSON.stringify({ box, obstacle })}`);
    }
    report.checks.push({ name, ...result }); await capture(name);
  };
  for (const [name, width, height, insets] of [["landscape", 852, 393], ["stacked-landscape", 700, 360], ["compact", 480, 320], ["portrait", 393, 852], ["small-portrait", 320, 568], ["portrait-safe-area", 430, 932, { sat: 59, sab: 34 }], ["landscape-safe-area", 932, 430, { sal: 59, sar: 59, sab: 21 }]]) {
    await viewport(width, height, true, insets);
    await send(`${name}: Meet by Undertone. ${"Keep this very long message bounded. ".repeat(5)}`);
    await waitPage("!!document.querySelector('[data-chat-preview]')", "incoming preview");
    await measure(name);
  }
  console.log("Seven closed-mobile layouts clear native HUD, controls and safe areas.");
  const beforeExpiry = await unread();
  await delay(CHAT_PREVIEW_MS + 150);
  assert.equal(await evaluate("!!document.querySelector('[data-chat-preview]')"), false);
  assert.equal(await unread(), beforeExpiry, "expiry never clears unread");
  await viewport(852, 393);
  await online();
  await delay(150);
  await click("Back to the city"); await closed();
  assert.equal(await unread(), beforeExpiry, "panel unmount preserves unread");
  assert.equal(await evaluate("!!document.querySelector('[data-chat-preview]')"), false, "remount does not revive expired preview");
  await tap("[data-chat-launcher]");
  await waitPage("document.activeElement?.id === 'chat-input'", "synchronous direct touch focus");
  assert.equal(await evaluate("window.__chatSynchronousFocus"), true);
  assert.equal(await unread(), 0);
  assert.equal(await evaluate("document.querySelector('[data-chat-launcher]').getAttribute('aria-expanded')"), "true");
  assert.ok(await evaluate("document.querySelector('#room-chat-log').textContent.includes('Earlier room conversation')"), "full old history remains readable");
  await capture("opened-history");

  await evaluate("document.documentElement.style.setProperty('--vvh','170px');document.documentElement.style.setProperty('--vv-top','12px');");
  const keyboard = await evaluate("(() => { const section=document.querySelector('section[aria-label=\"Room chat\"]'),input=document.querySelector('#chat-input'),bounds=section.getBoundingClientRect(),field=input.getBoundingClientRect();return {top:bounds.top,bottom:bounds.bottom,inputTop:field.top,inputBottom:field.bottom,font:getComputedStyle(input).fontSize,log:section.querySelector('ol').getBoundingClientRect().height};})()");
  assert.ok(keyboard.top >= 12 && keyboard.bottom <= 182 && keyboard.inputBottom <= 182, JSON.stringify(keyboard));
  assert.equal(keyboard.font, "16px"); assert.ok(keyboard.log > 0);
  report.checks.push({ name: "keyboard-viewport", ...keyboard }); await capture("keyboard-viewport");
  await call("Input.insertText", { text: "Not sent while composing" });
  const beforeIme = host.getView().chat.filter(line => line.name === "Chat QA" && line.kind === "chat").length;
  await evaluate("(() => {const input=document.querySelector('#chat-input');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'未'}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,isComposing:true}));input.form.requestSubmit();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true,isComposing:true}));})()");
  await delay(250);
  assert.equal(host.getView().chat.filter(line => line.name === "Chat QA" && line.kind === "chat").length, beforeIme);
  assert.equal(await evaluate("document.querySelector('section[aria-label=\"Room chat\"]').dataset.open"), "true");
  await evaluate("(() => {const input=document.querySelector('#chat-input');input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'未'}));input.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));input.select();})()");
  await call("Input.insertText", { text: "こんにちは from the phone" });
  await key("Enter", "Enter"); await closed();
  await until(() => host.getView().chat.some(line => line.text === "こんにちは from the phone"), "IME completion sends once");
  assert.equal(host.getView().chat.filter(line => line.text === "こんにちは from the phone").length, 1);
  assert.equal(await unread(), 0, "own messages do not create unread");
  await evaluate("document.documentElement.style.removeProperty('--vvh');document.documentElement.style.removeProperty('--vv-top');window.dispatchEvent(new Event('resize'));");
  await tap('[data-touch-action="menu"]'); await click("Chat");
  await waitPage("document.activeElement?.id === 'chat-input'", "drawer opens and focuses chat");
  await key("Escape", "Escape"); await closed();
  assert.equal(await evaluate("document.querySelector('main').dataset.phase"), "playing", "Escape closes only chat");
  await evaluate("document.querySelector('.city-canvas').focus()"); await key("Enter", "Enter");
  await waitPage("document.activeElement?.id === 'chat-input'", "keyboard opens chat");
  await tap("[data-chat-close]"); await closed();
  report.checks.push({ name: "touch-keyboard-ime", synchronousFocus: true, drawer: true, imeSentOnce: true, escapeKeepsPlaying: true });

  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Reduced motion still announces messages");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-chat-preview]')).animationName"), "none");
  await online();
  await delay(CHAT_PREVIEW_MS + 100);
  await click("Back to the city"); await closed();
  assert.equal(await unread(), 1, "unmount during preview preserves unread");
  assert.equal(await evaluate("!!document.querySelector('[data-chat-preview]')"), false);
  await tap("[data-chat-launcher]"); await key("Escape", "Escape");

  assert.ok(await other.connect({ serverUrl, name: "Second room friend" }));
  const secondCode = other.getView().code;
  await online(); await click("Leave room"); await join(secondCode);
  assert.equal(await unread(), 0, "room switch clears previous unread");
  await send("New room, reused IDs", other);
  await until(async () => await unread() === 1, "new-room message");
  assert.ok(await evaluate("document.querySelector('[data-chat-preview]').textContent.includes('New room, reused IDs')"));
  await online(); await click("Leave room"); await join(secondCode);
  assert.equal(await unread(), 0, "reconnect history does not revive unread");
  await send("Live after reconnect", other);
  await until(async () => await unread() === 1, "post-reconnect message");
  await capture("reconnected");
  report.checks.push({ name: "room-switch-reconnect", reusedIds: true, historyIgnored: true });

  await viewport(1440, 960, false);
  await closed();
  const desktop = await evaluate("(() => {const section=document.querySelector('section[aria-label=\"Room chat\"]'),launcher=document.querySelector('[data-chat-launcher]');return {touch:matchMedia('(pointer:coarse)').matches,logVisible:section.querySelector('ol').getBoundingClientRect().height>0,launcherVisible:launcher.getBoundingClientRect().height>0,left:section.getBoundingClientRect().left};})()");
  assert.equal(desktop.touch, false); assert.equal(desktop.logVisible, true); assert.equal(desktop.launcherVisible, false); assert.equal(desktop.left, 39);
  await evaluate("document.querySelector('.city-canvas').focus()"); await key("Enter", "Enter");
  await waitPage("document.activeElement?.id === 'chat-input'", "desktop Enter focuses input");
  await call("Input.insertText", { text: "Desktop is unchanged" }); await key("Enter", "Enter");
  await until(() => other.getView().chat.some(line => line.text === "Desktop is unchanged"), "desktop send");
  await capture("desktop"); report.checks.push({ name: "desktop", ...desktop });
  assert.deepEqual(report.errors, []);
  console.log(`Mobile chat PASS: ${report.checks.length} checks, ${report.screenshots.length} screenshots, zero runtime errors.`);
} catch (error) {
  report.failure = error.stack ?? String(error);
  if (call && socket?.readyState === WebSocket.OPEN) {
    try { const screenshot = await call("Page.captureScreenshot", { format: "png" }); await writeFile(resolve(directory, "failure.png"), Buffer.from(screenshot.data, "base64")); } catch {}
  }
  process.exitCode = 1;
  console.error(report.failure);
} finally {
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  if (call && socket?.readyState === WebSocket.OPEN) await call("Browser.close").catch(() => undefined);
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  pending.clear();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await Promise.race([new Promise(done => chrome.once("exit", done)), delay(3000)]); }
  await Promise.all([host.leave(), other.leave(), ...peers.map(peer => peer.leave())]);
  await gameServer.gracefullyShutdown(false);
  const ownedProfile = relative(directory, profile);
  if (ownedProfile && !ownedProfile.startsWith("..") && !isAbsolute(ownedProfile)) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
}
