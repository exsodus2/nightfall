import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

// Uses the installed Chrome and Node's built-in CDP transport; no test dependency.
const artifacts = resolve("artifacts");
await mkdir(artifacts, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch { /* Try the next installed browser. */ } }
if (!executable) throw new Error("Set CHROME_PATH to an installed Chromium browser to run this optional check.");
const port = 9327;
const chrome = spawn(executable, [
  "--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${resolve(artifacts, "test-browser-profile")}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--enable-webgl", ...(process.argv.includes("--gpu") ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
  "--window-size=1440,960", "about:blank",
], { stdio: "ignore", windowsHide: true });
let socket;
try {
  let tabs;
  for (let i = 0; i < 60; i++) {
    try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()); break; } catch { await delay(200); }
  }
  if (!tabs) throw new Error("Test browser did not start");
  const tab = tabs.find((item) => item.type === "page");
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolveReady, reject) => { socket.addEventListener("open", resolveReady, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let counter = 0;
  const requests = new Map();
  const errors = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = requests.get(message.id);
      if (request) { requests.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); }
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((arg) => arg.description ?? arg.value).join(" "));
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
    requests.set(id, { resolve: resolveCall, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  const capture = async (name) => {
    const image = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(artifacts, `${name}.png`), Buffer.from(image.data, "base64"));
  };
  const click = async (text) => {
    const point = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === ${JSON.stringify(text)} || el.textContent.trim().startsWith(${JSON.stringify(text)})); if (!button) throw new Error('Button not found: ' + ${JSON.stringify(text)}); button.scrollIntoView({block:'nearest'}); const r = button.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    await delay(400);
  };
  const key = async (type, code, keyValue, virtualKey) => call("Input.dispatchKeyEvent", { type, code, key: keyValue, windowsVirtualKeyCode: virtualKey });
  const press = async (code, value, virtualKey, duration = 60) => { await key("keyDown", code, value, virtualKey); await delay(duration); await key("keyUp", code, value, virtualKey); await delay(200); };
  const metroCheck = async () => {
    await click("Transit"); await click("Monorail"); await click("The Foundry");
    assert.equal(await evaluate("document.querySelector('main').dataset.mode"), "walk", "Station visit arrives at street level");
    assert.ok((await evaluate("document.querySelector('.interaction-prompt')?.textContent")).includes("lift to the platform"));
    await capture("city-station-street");
    await press("KeyE", "e", 69); await delay(3900);
    assert.ok(Number(await evaluate("document.querySelector('.coordinates').dataset.y")) > 31, "Physical lift reaches its platform");
    await capture("city-station-platform");
    await press("KeyW", "w", 87, 900); // lift at v=20 -> rear carriage door at v=15
    await press("KeyA", "a", 65, 880); // walk to the boarding line
    console.log("At platform; waiting for an open physical train door");
    let boarding = false;
    for (let i = 0; i < 150; i++) {
      if (await evaluate("document.querySelector('.interaction-prompt')?.textContent.includes('Board the monorail')")) { boarding = true; break; }
      await delay(500);
    }
    await capture("city-station-train");
    assert.ok(boarding, "A scheduled train stops and opens its doors at the platform");
    await press("KeyE", "e", 69);
    assert.equal(await evaluate("document.querySelector('main').dataset.mode"), "metro");
    await capture("city-monorail");
    await press("KeyA", "a", 65, 340); // enter the aisle
    const cabinStart = Number(await evaluate("document.querySelector('main').dataset.cabinV"));
    await press("KeyW", "w", 87, 2300);
    const cabinAfter = Number(await evaluate("document.querySelector('main').dataset.cabinV"));
    assert.ok(cabinStart - cabinAfter > 8, "WASD walks between connected carriages");
    await capture("city-monorail-aisle");
    // Continue to the middle door using observed local carriage coordinates.
    await key("keyDown", "KeyW", "w", 87);
    for (let i = 0; i < 30; i++) { if (Number(await evaluate("document.querySelector('main').dataset.cabinV")) < 0.55) break; await delay(80); }
    await key("keyUp", "KeyW", "w", 87); await delay(200);
    // Wait for departure while still aboard, then prove E cannot drop us into the road.
    for (let i = 0; i < 35; i++) { if (Number(await evaluate("document.querySelector('main').dataset.doors")) === 0) break; await delay(500); }
    await press("KeyE", "e", 69);
    assert.equal(await evaluate("document.querySelector('main').dataset.mode"), "metro", "Closed doors prevent midair alighting");
    await press("KeyD", "d", 68, 360);
    console.log("Walking inside the moving train; waiting for the next station");
    for (let i = 0; i < 100; i++) { if (await evaluate("document.querySelector('.interaction-prompt')?.textContent.includes('Step onto the platform')")) break; await delay(500); }
    await capture("city-monorail-arrival");
    await press("KeyE", "e", 69);
    assert.equal(await evaluate("document.querySelector('main').dataset.mode"), "walk", "Passenger alights onto the next platform");
    assert.equal(await evaluate("document.querySelector('main').dataset.station"), "Neon Ward");
    assert.ok(Number(await evaluate("document.querySelector('.coordinates').dataset.y")) > 31, "Alighting keeps the player on the elevated platform");
    await capture("city-station-alight");
    assert.deepEqual(errors, [], "Metro has no runtime errors");
    console.log(JSON.stringify({ metroPassed: true, cabinStart, cabinAfter, fps: await evaluate("document.querySelector('.fps-count').textContent") }));
  };
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: process.argv.includes("--hidpi") ? 2 : 1, mobile: false });
  await call("Page.navigate", { url: process.env.CITY_URL ?? "http://127.0.0.1:3000" });
  let phase;
  for (let i = 0; i < 100; i++) {
    phase = await evaluate("document.querySelector('main')?.dataset.phase");
    if (phase === "intro" || phase === "error") break;
    await delay(500);
  }
  await delay(1800);
  await capture("city-intro");
  console.log(JSON.stringify({ phase, errors, text: await evaluate("document.body.innerText.slice(0,1600)") }));
  assert.equal(phase, "intro", "City must finish loading");
  assert.deepEqual(errors, [], "Renderer initializes without shader errors");
  assert.ok(Number(await evaluate("document.querySelector('.coordinates').dataset.cars")) > 20, "Traffic populates nearby streets");
  assert.ok(Number(await evaluate("document.querySelector('.coordinates').dataset.residents")) > 20, "Residents populate nearby sidewalks");
  assert.equal(await evaluate("Math.round(document.querySelector('.city-canvas').getBoundingClientRect().width)"), 1440, "Native-resolution city fills the screen");
  assert.equal(await evaluate("document.querySelector('.city-canvas').width"), process.argv.includes("--hidpi") ? 2880 : 1440, "Native glyph pixels match display density");
  if (process.argv.includes("--profile")) {
    await call("Profiler.enable"); await call("Profiler.start"); await delay(4000);
    const profile = await call("Profiler.stop"); await writeFile(resolve(artifacts, "renderer.cpuprofile"), JSON.stringify(profile.profile));
  }
  if (process.argv.includes("--capture-only")) process.exitCode = 0;
  else {
    await click("Enter the city");
    const before = await evaluate("document.querySelector('.coordinates').dataset.z");
    await key("keyDown", "KeyW", "w", 87);
    await delay(1200);
    await key("keyUp", "KeyW", "w", 87);
    await delay(300);
    const after = await evaluate("document.querySelector('.coordinates').dataset.z");
    assert.ok(Number(after) < Number(before) - 0.5, `Walk must move player: ${before} -> ${after}`);
    await capture("city-walking");
    if (process.argv.includes("--motion")) {
      await click("Settings"); await click("Fine"); await click("Back to the streets");
      await key("keyDown", "KeyW", "w", 87);
      for (let i = 0; i < 5; i++) { await delay(180); await capture(`city-motion-${i}`); }
      await key("keyUp", "KeyW", "w", 87);
      await key("keyDown", "ArrowLeft", "ArrowLeft", 37); await delay(250); await key("keyUp", "ArrowLeft", "ArrowLeft", 37);
      await capture("city-motion-turn");
    }
    // Verify the input path in the browser as well as the pure smoothing tests.
    const lockActive = await evaluate("document.pointerLockElement === document.querySelector('.city-canvas')");
    if (lockActive) {
      const yaw = Number(await evaluate("document.querySelector('.coordinates').dataset.yaw"));
      await evaluate("document.dispatchEvent(new MouseEvent('mousemove', { movementX: 900, movementY: 0, bubbles: true }))");
      await delay(350);
      const turned = Number(await evaluate("document.querySelector('.coordinates').dataset.yaw"));
      assert.ok(Math.abs(turned - yaw - 900 * 0.00165) < 0.04, "Fast swipe must integrate once without a jump or discarded input");
      await evaluate("document.dispatchEvent(new MouseEvent('mousemove', { movementX: -900, movementY: 0, bubbles: true }))");
      await delay(350);
      assert.ok(Math.abs(Number(await evaluate("document.querySelector('.coordinates').dataset.yaw")) - yaw) < 0.04, "Opposite swipe returns smoothly to the same heading");
    } else {
      const yaw = Number(await evaluate("document.querySelector('.coordinates').dataset.yaw"));
      const swipe = async (from, to) => {
        await call("Input.dispatchMouseEvent", { type: "mousePressed", x: from, y: 340, button: "left", clickCount: 1 });
        await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: to, y: 340, buttons: 1 });
        await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: to, y: 340, button: "left", clickCount: 1 });
        await delay(350);
      };
      await swipe(600, 1100);
      assert.ok(Math.abs(Number(await evaluate("document.querySelector('.coordinates').dataset.yaw")) - yaw - 500 * 0.00165) < 0.04, "Fast drag integrates once without snapping");
      await swipe(1100, 600);
      assert.ok(Math.abs(Number(await evaluate("document.querySelector('.coordinates').dataset.yaw")) - yaw) < 0.04, "Fast return drag restores heading");
    }
    if (process.argv.includes("--input-only")) {
      assert.deepEqual(errors, []);
      await delay(1500);
      console.log(JSON.stringify({ inputPassed: true, rawMouseCapture: lockActive, settledFps: await evaluate("document.querySelector('.fps-count').textContent") }));
    } else if (process.argv.includes("--metro-only")) {
      await metroCheck();
    } else {
    await key("keyDown", "ArrowRight", "ArrowRight", 39);
    await delay(900);
    await key("keyUp", "ArrowRight", "ArrowRight", 39);
    const beforeTurn = Number(await evaluate("document.querySelector('.coordinates').dataset.x"));
    await key("keyDown", "KeyW", "w", 87);
    await delay(700);
    await key("keyUp", "KeyW", "w", 87);
    await delay(200);
    assert.ok(Number(await evaluate("document.querySelector('.coordinates').dataset.x")) > beforeTurn + 0.5, "Turning must change walking direction");
    // M opens the city map overlay (the city keeps running) and closes it; T opens the transit panel, which pauses.
    await key("keyDown", "KeyM", "m", 77);
    await key("keyUp", "KeyM", "m", 77);
    await delay(500);
    assert.ok(await evaluate("!!document.querySelector('[data-world-map]')"), "M opens the city map");
    await capture("city-map");
    await key("keyDown", "KeyM", "m", 77);
    await key("keyUp", "KeyM", "m", 77);
    await delay(400);
    await key("keyDown", "KeyT", "t", 84);
    await key("keyUp", "KeyT", "t", 84);
    await delay(500);
    assert.equal(await evaluate("document.querySelector('[role=dialog] h2')?.textContent"), "Enjoy the ride.");
    const positionExpression = "(() => { const d=document.querySelector('.coordinates').dataset; return [d.x,d.z,d.y,d.yaw].join(','); })()";
    const pausedPosition = await evaluate(positionExpression);
    await delay(500);
    assert.equal(await evaluate(positionExpression), pausedPosition, "Player must stop while the atlas is open");
    await capture("city-atlas");
    await click("The Foundry");
    assert.equal(await evaluate("document.querySelector('main').dataset.mode"), "taxi");
    const taxiBefore = await evaluate("document.querySelector('.coordinates').dataset.z");
    await delay(1800);
    assert.notEqual(await evaluate("document.querySelector('.coordinates').dataset.z"), taxiBefore, "Taxi travels through the streets");
    await capture("city-taxi");
    await key("keyDown", "KeyE", "e", 69); await key("keyUp", "KeyE", "e", 69);
    await key("keyDown", "KeyT", "t", 84); await key("keyUp", "KeyT", "t", 84);
    await delay(300);
    await click("Sky taxi"); await click("Ghost Circuit");
    await delay(11500);
    assert.equal(await evaluate("document.querySelector('main').dataset.mode"), "sky");
    assert.ok(Number(await evaluate("document.querySelector('.coordinates').dataset.y")) > 200, "Sky taxi clears the full skyline");
    await capture("city-sky-taxi");
    if (process.argv.includes("--sky-only")) {
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ skyPassed: true, fps: await evaluate("document.querySelector('.fps-count').textContent") }));
    } else {
    await key("keyDown", "KeyE", "e", 69); await key("keyUp", "KeyE", "e", 69);
    await key("keyDown", "KeyF", "f", 70); await key("keyUp", "KeyF", "f", 70);
    await key("keyDown", "KeyQ", "q", 81); await delay(1000); await key("keyUp", "KeyQ", "q", 81);
    assert.equal(await evaluate("document.querySelector('main').dataset.mode"), "fly");
    assert.ok(Number(await evaluate("document.querySelector('.coordinates').dataset.y")) > 20, "Free flight rises independently");
    await capture("city-flight");
    await key("keyDown", "KeyE", "e", 69); await key("keyUp", "KeyE", "e", 69);
    await metroCheck();
    await key("keyDown", "Escape", "Escape", 27);
    await key("keyUp", "Escape", "Escape", 27);
    await delay(200);
    await click("Settings");
    await click("Rain");
    assert.equal(await evaluate("document.querySelector('[role=switch]')?.getAttribute('aria-checked')"), "false");
    await click("Performance");
    await capture("city-settings");
    await click("Balanced");
    await click("Rain");
    await click("Return to the starting street");
    await key("keyDown", "Escape", "Escape", 27);
    await key("keyUp", "Escape", "Escape", 27);
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    await delay(1200);
    await capture("city-mobile");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Mobile must not overflow");
    await click("Keep walking");
    const touchBefore = Number(await evaluate("document.querySelector('.coordinates').dataset.z"));
    // Mobile: the floating joystick appears where the thumb lands in the move zone; drag it forward.
    const touchPoint = await evaluate("(() => { const r=document.querySelector('[data-touch-zone=move]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height*0.7}; })()");
    await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touchPoint, id: 1 }] });
    await call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchPoint.x, y: touchPoint.y - 60, id: 1 }] });
    await delay(900);
    await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await delay(300);
    assert.ok(Math.abs(Number(await evaluate("document.querySelector('.coordinates').dataset.z")) - touchBefore) > 0.5, "Touch controls must move the player");
    await capture("city-mobile-walking");
    assert.equal(await evaluate("Math.round(document.querySelector('main').getBoundingClientRect().top)"), 0, "Mobile view must stay anchored after focus changes");
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log(JSON.stringify({ passed: true, movement: { before, after }, rawMouseCapture: lockActive, browserErrors: errors.length }));
    }
    }
  }
} finally {
  socket?.close();
  chrome.kill();
}
