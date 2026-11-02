import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WALK_HEIGHT } from "../src/city/locomotion.ts";
import { CityWorld } from "../src/city/world.ts";
import { GROUND_FLOOR_KINDS, interiorWorld } from "../src/city/interiors.ts";
import { liftLanding } from "../src/city/upper-floors.ts";
import { groundFloorPlaces, groundFloorPlan } from "../src/city/building-interiors.ts";

// Ground floors: one building of every kind near the city centre — door, entry, three looks inside, exit.
// --upper: instead, ride the lift of a tall building of each lift kind to every stop and capture each floor.
// Options: --port=<n>, --out=<name> (artifacts/<name>, default "ground-floors"), --kinds=a,b (subset), --software.
const option = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const kinds = (option("kinds") ?? GROUND_FLOOR_KINDS.join(",")).split(",");
const directory = resolve("artifacts", option("out") || "ground-floors");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const portArgument = process.argv.find(argument => argument.startsWith("--port="));
const port = portArgument ? Number(portArgument.slice(7)) : 9344;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error(`Invalid --port: ${portArgument}`);
const chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(directory, "browser-profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", ...(process.argv.includes("--software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []), "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
const errors = [], report = [];
try {
  let tabs;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()); break; } catch { await delay(200); }
  }
  if (!tabs) throw Error("Test browser did not start.");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let requestId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map(argument => argument.value ?? argument.description).join(" "));
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 180000);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  const click = async label => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.textContent.trim().startsWith(${JSON.stringify(label)})); if (!button) throw Error('Missing button: ' + ${JSON.stringify(label)}); button.click(); })()`);
    await delay(250);
  };
  const press = async (code, key, duration = 50) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key });
    await delay(duration);
    await call("Input.dispatchKeyEvent", { type: "keyUp", code, key });
    await delay(250);
  };
  const capture = async name => {
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(screenshot.data, "base64"));
  };
  const measure = async name => {
    await delay(2500);
    const metrics = await evaluate("window.__nightfallPerf()");
    report.push({ name, ...metrics }); console.log(JSON.stringify({ name, ...metrics }));
  };
  const pose = () => evaluate("(() => { const point = document.querySelector('.coordinates'); if (!point) throw Error('Missing player coordinates'); return { x:Number(point.dataset.x), z:Number(point.dataset.z), height:Number(point.dataset.y), mode:document.querySelector('main').dataset.mode, prompt:document.querySelector('.interaction-prompt')?.textContent }; })()");
  const inspectCamera = camera => evaluate(`window.__nightfall.inspect(${JSON.stringify({ kind: "camera", ...camera })})`);
  const hold = async (keys, samples, observe) => {
    for (const [code, key] of keys) await call("Input.dispatchKeyEvent", { type: "keyDown", code, key });
    try {
      for (let sample = 0; sample < samples; sample++) {
        await delay(150);
        if (await observe(await pose()) === false) break;
      }
    } finally {
      for (const [code, key] of keys) await call("Input.dispatchKeyEvent", { type: "keyUp", code, key });
      await delay(400);
    }
  };
  const sideOfCar = (car, position) => (position.x - car.x) * Math.cos(car.yaw) + (position.z - car.z) * Math.sin(car.yaw);
  const carClearance = (car, position) => Math.max(Math.abs(sideOfCar(car, position)) - CAR_HALF_WIDTH - PLAYER_RADIUS, Math.abs((position.x - car.x) * Math.sin(car.yaw) - (position.z - car.z) * Math.cos(car.yaw)) - CAR_HALF_LENGTH - PLAYER_RADIUS);
  const checkRotateHint = async reducedMotion => {
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }] });
    await press("Escape", "Escape"); await click("Keep walking");
    await delay(500);
    const bounds = await evaluate("(() => { const hint = document.querySelector('[aria-label=\"Dismiss: rotate to landscape for the widest view\"]'); if (!hint) throw Error('Missing fresh rotate hint'); const rect = hint.getBoundingClientRect(); return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height, viewportWidth:innerWidth, viewportHeight:innerHeight, animations:hint.getAnimations().map(animation => animation.playState), animationName:getComputedStyle(hint).animationName }; })()");
    assert.ok(bounds.width > 0 && bounds.height >= 32, "portrait rotate hint is visible");
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.viewportWidth && bounds.top >= 0 && bounds.bottom <= bounds.viewportHeight, `rotate hint fits after animation: ${JSON.stringify(bounds)}`);
    assert.ok(Math.abs((bounds.left + bounds.right) / 2 - bounds.viewportWidth / 2) < 2, `rotate hint stays horizontally centered: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.animations.every(state => state === "finished"), "rotate bounds are checked after the entrance animation completes");
    if (reducedMotion) assert.equal(bounds.animationName, "none");
    report.push({ name: reducedMotion ? "rotate-hint-reduced-motion" : "rotate-hint", ...bounds });
    console.log(JSON.stringify(report.at(-1)));
  };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&clock=4&perf=1` });
  console.log("Loading city and compiling shaders...");
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const phase = await evaluate("document.querySelector('main')?.dataset.phase");
    if (phase === "error") throw Error(await evaluate("document.body.innerText"));
    if (phase === "intro") { ready = true; break; }
    await delay(250);
  }
  assert.ok(ready, "renderer becomes ready");
  await evaluate("document.querySelector('.scene-studio').style.display = 'none'");
  await click("Enter the city");
  await evaluate("window.__nightfall.inspect({kind:'freeze',value:false})");
  const all = groundFloorPlaces(new CityWorld());
  const upper = process.argv.includes("--upper");
  const stand = async (place, x, z, yaw) => { await evaluate(`Object.assign(window.__nightfall.interiors.visitor, ${JSON.stringify({ x, z, yaw, pitch: 0.02 })})`); await delay(500); };
  const liftSpot = place => {
    const lift = groundFloorPlan(place).fixtures.find(item => item.kind === "lift");
    if (!lift) return null;
    const landing = liftLanding(lift), at = interiorWorld(place, landing.x, landing.z);
    const c = Math.cos(place.yaw), s = Math.sin(place.yaw), wx = c * landing.fx + s * landing.fz, wz = -s * landing.fx + c * landing.fz;
    return { ...at, yaw: Math.atan2(wx, -wz) }; // facing into the room, as interiors.landingPose
  };
  for (const kind of upper ? ["lobby", "corp-lobby", "capsule-hotel", "apartment", "server-hall"] : []) {
    const place = all.filter(candidate => candidate.kind === kind && (candidate.stops?.length ?? 0) > 1 && liftSpot(candidate)).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    if (!place) { console.log(JSON.stringify({ kind, upper: "no tall building with a reachable lift" })); continue; }
    const { entrance } = place;
    await inspectCamera({ x: entrance.x - Math.sin(entrance.yaw) * 2.2, z: entrance.z + Math.cos(entrance.yaw) * 2.2, height: WALK_HEIGHT, yaw: entrance.yaw, pitch: 0 });
    await delay(1000); await press("KeyE", "e");
    assert.equal(await evaluate("window.__nightfall.interiors.active?.id"), place.id);
    for (let ride = 0; ride < place.stops.length - 1; ride++) {
      const active = await evaluate("(() => { const p = window.__nightfall.interiors.active; return { id: p.id, floor: p.floor ?? 1 }; })()");
      const current = active.floor === 1 ? place : null;
      const spot = current ? liftSpot(current) : null;
      if (spot) await stand(place, spot.x, spot.z, spot.yaw + Math.PI); // face the lift
      const prompt = (await pose()).prompt;
      console.log(JSON.stringify({ kind, at: active.id, prompt }));
      await press("KeyE", "e"); await delay(900);
      const now = await evaluate("window.__nightfall.interiors.active?.id");
      console.log(JSON.stringify({ kind, rode: now }));
      await measure(`${kind}-${now}`); await capture(`${kind}-${now}`);
      await press("ArrowLeft", "ArrowLeft", 1200); await delay(400); await capture(`${kind}-${now}-left`);
      await press("ArrowRight", "ArrowRight", 2400); await delay(400); await capture(`${kind}-${now}-right`);
      await press("ArrowLeft", "ArrowLeft", 1200);
    }
  }
  for (const kind of upper ? [] : kinds) {
    const place = all.filter(candidate => candidate.kind === kind).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    assert.ok(place, `a ${kind} exists`);
    const { entrance } = place;
    const back = 2.2; // stand a little out from the door, facing it
    await inspectCamera({ x: entrance.x - Math.sin(entrance.yaw) * back, z: entrance.z + Math.cos(entrance.yaw) * back, height: WALK_HEIGHT, yaw: entrance.yaw, pitch: 0 });
    await delay(1200);
    const door = await pose();
    console.log(JSON.stringify({ kind, id: place.id, name: place.name, prompt: door.prompt }));
    await capture(`${kind}-door`);
    if (!door.prompt?.includes(`Enter ${place.name}`)) { await press("KeyW", "w", 500); }
    const prompt = (await pose()).prompt;
    assert.ok(prompt?.includes(`Enter ${place.name}`), `${kind} ${place.id} door prompt: ${prompt}`);
    await press("KeyE", "e");
    assert.equal(await evaluate("window.__nightfall.interiors.active?.id"), place.id);
    await delay(700); await capture(`${kind}-entry`);
    await press("KeyW", "w", 900); await measure(kind); await capture(`${kind}-floor`);
    await press("ArrowLeft", "ArrowLeft", 900); await delay(400); await capture(`${kind}-left`);
    await press("ArrowRight", "ArrowRight", 1800); await delay(400); await capture(`${kind}-right`);
    await press("ArrowLeft", "ArrowLeft", 900);
    await press("KeyS", "s", 1300);
    const exit = (await pose()).prompt;
    assert.ok(exit?.includes(`Exit ${place.name}`), `${kind} exit prompt: ${exit}`);
    await press("KeyE", "e");
    assert.equal(await evaluate("window.__nightfall.interiors.active"), null, `${kind} left`);
  }
  assert.deepEqual(errors, [], "no browser errors");
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Ground floors: ${kinds.length} kinds entered, captured and left.`);
} finally {
  socket?.close();
  chrome.kill();
}
