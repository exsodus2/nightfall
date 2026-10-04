import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const cityUrl = new URL(process.env.CITY_URL ?? "http://127.0.0.1:3000");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(cityUrl.hostname), "Use a loopback development server.");
cityUrl.search = "studio=1&clock=4&perf=1";
const directory = resolve("artifacts", "map-destinations");
await mkdir(directory, { recursive: true });
const profile = await mkdtemp(resolve(directory, "browser-profile-"));
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
let chrome, socket;
const errors = [], checks = [];
try {
  chrome = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chrome.exitCode !== null) throw Error(`Browser exited during startup: ${chrome.exitCode}`);
    try { port = Number((await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]); if (port > 0) break; } catch {}
    await delay(100);
  }
  assert.ok(port);
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let requestId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map(argument => argument.value ?? argument.description).join(" "));
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++requestId, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 180000);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(100); }
    throw Error(`Timed out: ${label}`);
  };
  const press = async (code, key) => {
    const windowsVirtualKeyCode = key === "Enter" ? 13 : undefined;
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key, windowsVirtualKeyCode, text: key === "Enter" ? "\r" : undefined, unmodifiedText: key === "Enter" ? "\r" : undefined });
    await call("Input.dispatchKeyEvent", { type: "keyUp", code, key, windowsVirtualKeyCode }); await delay(250);
  };
  const click = label => evaluate(`(() => {const button=[...document.querySelectorAll('button')].find(element=>element.getAttribute('aria-label')===${JSON.stringify(label)}||element.textContent.trim().startsWith(${JSON.stringify(label)}));if(!button)throw Error('Missing button: '+${JSON.stringify(label)});button.click()})()`);
  const capture = async name => {
    const shot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const pins = () => evaluate("JSON.parse(localStorage.getItem('nightfall.waypoints.v1'))");
  const position = () => evaluate("({x:+document.querySelector('.coordinates').dataset.x,z:+document.querySelector('.coordinates').dataset.z,mode:document.querySelector('main').dataset.mode,interior:window.__nightfallPerf().interior})");
  const ready = async () => {
    await waitFor("document.querySelector('main')?.dataset.phase==='intro' && !!window.__nightfall", "Renderer ready", 180000);
    await evaluate("document.querySelector('.scene-studio').style.display='none'");
    await click("Enter the city"); await waitFor("document.querySelector('main')?.dataset.phase==='playing'", "Playing");
  };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.navigate", { url: cityUrl.href }); await ready();
  const before = await position();
  const questsBefore = await evaluate("window.__nightfall.rpg.quests.serialize().quests");
  await evaluate("window.__mapLabels=new Set();window.__mapFillText=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(...args){if(this.canvas.closest('[data-world-map]'))window.__mapLabels.add(args[0]);return window.__mapFillText.apply(this,args)}");
  await press("KeyM", "m");
  await waitFor("document.querySelectorAll('[data-world-map] [data-venue]').length===6 && window.__mapLabels.has('Mira Bell') && window.__mapLabels.has('Blue Hour Tea')", "All venues, new quest giver and doorway label");
  await capture("map-spawn-desktop");
  await evaluate("document.querySelector('[data-venue=blue-hour]').focus()");
  await press("Enter", "Enter");
  await waitFor("document.querySelector('[data-venue=blue-hour]').getAttribute('aria-pressed')==='true' && JSON.parse(localStorage.getItem('nightfall.waypoints.v1'))?.waypoints.length===1", "Keyboard route selection");
  const first = await pins();
  assert.equal(first.waypoints[0].shared, false);
  assert.equal(first.active, first.waypoints[0].id);
  assert.deepEqual(await position(), before, "A map route does not teleport or change travel mode");
  assert.deepEqual(await evaluate("window.__nightfall.rpg.quests.serialize().quests"), questsBefore, "Browsing does not start or advance jobs");
  await click("Track entrance to Blue Hour Tea"); await delay(450);
  assert.equal((await pins()).waypoints.length, 1, "Repeated tracking reuses the pin");
  for (const viewport of [{ name: "desktop", width: 1440, height: 960 }, { name: "portrait", width: 393, height: 852 }, { name: "compact", width: 480, height: 320 }]) {
    await call("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false }); await delay(450);
    await evaluate("document.querySelector('[data-venue=blue-hour]').scrollIntoView({block:'center'})");
    const layout = await evaluate("(() => {const buttons=[...document.querySelectorAll('[data-venue]')],panel=buttons[0].closest('aside'),scroll=panel.firstElementChild;return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,panelWidth:scroll.clientWidth,panelScroll:scroll.scrollWidth,buttons:buttons.map(button=>{const box=button.getBoundingClientRect();return {name:button.getAttribute('aria-label'),height:box.height,left:box.left,right:box.right,pressed:button.getAttribute('aria-pressed')}})}})()");
    assert.equal(layout.buttons.length, 6);
    assert.equal(layout.buttons.filter(button => button.pressed === "true").length, 1);
    assert.ok(layout.buttons.every(button => button.height >= 44 && button.left >= 0 && button.right <= viewport.width));
    assert.ok(layout.documentWidth <= viewport.width && layout.panelScroll <= layout.panelWidth + 1, `${viewport.name}: no horizontal overflow`);
    checks.push({ name: `directory-${viewport.name}`, ...layout }); await capture(`directory-${viewport.name}`);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  const venues = await evaluate("window.__nightfall.interiors.places.map(place=>({id:place.id,name:place.name,entrance:place.entrance}))");
  for (const place of venues) {
    await click(`Track entrance to ${place.name}`); await delay(400);
    const saved = await pins(), active = saved.waypoints.find(waypoint => waypoint.id === saved.active);
    assert.ok(Math.hypot(active.x - place.entrance.x, active.z - place.entrance.z) < 0.15);
    assert.equal(active.shared, false);
  }
  assert.equal((await pins()).waypoints.length, 6);
  await click("Track entrance to Blue Hour Tea"); await delay(450);
  await press("KeyM", "m"); await waitFor("!document.querySelector('[data-world-map]')", "Map closed");
  await waitFor("document.querySelector('[data-arrived]')?.textContent.includes('Blue Hour Tea entrance')", "Waypoint compass follows the doorway");
  await capture("entrance-compass");
  checks.push({ name: "six-private-doorway-routes", waypoints: (await pins()).waypoints.length, before, after: await position() });
  await call("Page.reload", { ignoreCache: false }); await ready();
  await press("KeyM", "m"); await waitFor("document.querySelector('[data-venue=blue-hour]')?.getAttribute('aria-pressed')==='true'", "Selected entrance survives reload");
  assert.equal((await pins()).waypoints.length, 6);
  await press("KeyM", "m"); await press("KeyT", "t"); await click("Visit Blue Hour Tea"); await delay(250); await press("KeyE", "e");
  assert.equal((await position()).interior, "blue-hour");
  const indoors = await position();
  await press("KeyM", "m"); await click("Track entrance to The Glasshouse"); await delay(450);
  assert.deepEqual(await position(), indoors, "Choosing another doorway while indoors leaves the room intact");
  await capture("directory-indoors");
  checks.push({ name: "reload-and-indoor-tracking", interior: indoors.interior });
  assert.deepEqual(errors, []);
  await writeFile(resolve(directory, "report.json"), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log("Actual quest-giver rendering, six doorway routes, keyboard controls, responsive layout, save/reload and indoor navigation passed.");
} catch (error) {
  console.error(error);
  await writeFile(resolve(directory, "report.json"), JSON.stringify({ passed: false, checks, errors, failure: String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close(); chrome?.kill();
}
