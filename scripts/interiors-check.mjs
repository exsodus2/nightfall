import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from "../src/city/driving.ts";
import { WALK_HEIGHT } from "../src/city/locomotion.ts";
import { PLAYER_RADIUS } from "../src/city/world.ts";

const directory = resolve("artifacts", "interiors");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const port = 9344;
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
  await measure("street"); await capture("street");
  const places = await evaluate("window.__nightfall.interiors.places.map(place => ({id:place.id,name:place.name}))");
  assert.equal(places.length, 6);
  for (const place of places) {
    await press("KeyT", "t");
    await click(`Visit ${place.name}`);
    await delay(1000);
    const doorway = await evaluate("({prompt:document.querySelector('.interaction-prompt')?.textContent,phase:document.querySelector('main').dataset.phase,x:document.querySelector('.coordinates').dataset.x,z:document.querySelector('.coordinates').dataset.z})");
    console.log(JSON.stringify({ place: place.id, doorway }));
    assert.ok(doorway.prompt?.includes(`Enter ${place.name}`), JSON.stringify(doorway));
    await capture(`${place.id}-door`);
    await press("KeyE", "e");
    assert.equal(await evaluate("window.__nightfall.interiors.active?.id"), place.id);
    assert.ok((await evaluate("document.querySelector('.location-strip').textContent")).includes(place.name));
    await press("KeyW", "w", 600);
    await measure(place.id); await capture(place.id);
    assert.equal(await evaluate("window.__nightfallPerf().visibleBuildings"), 0, "exterior geometry is skipped indoors");
    await press("KeyS", "s", 800);
    assert.ok((await evaluate("document.querySelector('.interaction-prompt')?.textContent")).includes(`Exit ${place.name}`));
    await press("KeyE", "e");
    assert.equal(await evaluate("window.__nightfall.interiors.active"), null);
  }
  await press("KeyT", "t"); await click("Visit Blue Hour Tea"); await press("KeyE", "e");
  await press("Escape", "Escape");
  assert.equal(await evaluate("document.querySelector('main').dataset.phase"), "paused");
  await capture("paused");
  await click("Keep walking");
  assert.equal(await evaluate("window.__nightfall.interiors.active?.id"), "blue-hour");
  await press("KeyF", "f");
  assert.equal(await evaluate("window.__nightfall.interiors.active"), null, "flight leaves the room safely");
  assert.equal(await evaluate("document.querySelector('main').dataset.mode"), "fly");
  await press("KeyF", "f");
  await press("KeyT", "t"); await click("Visit Blue Hour Tea"); await press("KeyE", "e");
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 852, height: 393, deviceScaleFactor: 2, mobile: true });
  await delay(750); await capture("mobile-landscape");
  await call("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await delay(750); await capture("mobile-portrait");
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false, "mobile layout has no horizontal overflow");
  await call("Emulation.setTouchEmulationEnabled", { enabled: false });
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.__nightfall.inspect({kind:'freeze',value:true})");
  await evaluate("(() => { const style = document.createElement('style'); style.textContent = '.discovery-notice, .quest-toasts { display: none !important; }'; document.head.append(style); })()");
  for (const headwear of ["hood", "visor", "umbrella"]) {
    await evaluate(`(() => { const npc = window.__nightfall.rpg.npcs.find(person => ${JSON.stringify(headwear)} === 'umbrella' ? person.look.prop === 'umbrella' : person.look.headwear === ${JSON.stringify(headwear)}); window.__nightfall.inspect({kind:'camera',x:npc.x,z:npc.z+4.5,height:2.7,yaw:0,pitch:0.21}); })()`);
    await delay(400); await capture(`npc-${headwear}`);
  }
  const vehicles = await evaluate("window.__nightfall.parked.nearby(0,78,90).filter(car => !car.moved && Math.abs(car.x)>4 && window.__nightfall.rpg.npcs.every(npc => Math.hypot(npc.x-car.x,npc.z-car.z)>8)).sort((first,second) => Math.hypot(first.x,first.z-78)-Math.hypot(second.x,second.z-78)).slice(0,12).map(car => ({id:car.id,x:car.x,z:car.z,yaw:car.yaw}))");
  const approaches = [];
  let vehicle, approachCamera, approachSide, stopped;
  for (const car of vehicles) {
    const rightX = Math.cos(car.yaw), rightZ = Math.sin(car.yaw);
    const side = Math.sign(Math.abs(rightX) > 0.5 ? (Math.round(car.x / 64) * 64 - car.x) * rightX : (Math.round(car.z / 64) * 64 - car.z) * rightZ) || 1;
    const camera = { x: car.x + rightX * side * 4.5, z: car.z + rightZ * side * 4.5, height: WALK_HEIGHT, yaw: car.yaw - side * Math.PI / 2, pitch: 0 };
    await inspectCamera(camera); await delay(400);
    const start = await pose();
    assert.equal(start.mode, "walk");
    assert.ok(carClearance(car, start) > 2, "vehicle collision test starts outside the body, not inside its escape region");
    await hold([["KeyW", "w"]], 12, position => {
      assert.equal(position.mode, "walk");
      assert.ok(sideOfCar(car, position) * side >= CAR_HALF_WIDTH + PLAYER_RADIUS - 0.035, `walking passed through parked vehicle ${car.id}: ${JSON.stringify(position)}`);
    });
    const end = await pose(), travelled = Math.hypot(end.x - start.x, end.z - start.z), gap = sideOfCar(car, end) * side - CAR_HALF_WIDTH - PLAYER_RADIUS;
    approaches.push({ car: car.id, start, end, travelled, gap });
    if (travelled > 1.5 && gap < 0.3 && end.prompt?.includes("Get in the car")) { vehicle = car; approachCamera = camera; approachSide = side; stopped = end; break; }
  }
  assert.ok(vehicle, `reached a parked car from outside rather than stopping behind another road user: ${JSON.stringify(approaches)}`);
  await capture("walking-car-blocked");
  const jumpStart = await pose();
  let jumpPeak = jumpStart.height;
  await hold([["KeyW", "w"], ["Space", " "]], 12, position => {
    jumpPeak = Math.max(jumpPeak, position.height);
    assert.ok(sideOfCar(vehicle, position) * approachSide >= CAR_HALF_WIDTH + PLAYER_RADIUS - 0.035, "an ordinary jump cannot phase through the car body");
  });
  assert.ok(jumpPeak > WALK_HEIGHT + 0.25, "the regression actually executes a jump");
  await delay(700);
  assert.ok(Math.abs((await pose()).height - WALK_HEIGHT) < 0.035, "jump lands back on street level");
  await inspectCamera({ ...approachCamera, pitch: 0.32 }); await delay(400); await capture("rounded-wheels");
  await inspectCamera({ x: stopped.x, z: stopped.z, height: WALK_HEIGHT, yaw: vehicle.yaw, pitch: 0 }); await delay(400);
  await press("KeyE", "e");
  assert.equal(await evaluate("document.querySelector('main').dataset.mode"), "drive");
  assert.equal(await evaluate(`window.__nightfall.parked.nearby(${vehicle.x},${vehicle.z},1).some(car => car.id === ${vehicle.id})`), false, "the approached vehicle is the one entered");
  await delay(600); await capture("cockpit-front");
  await evaluate("window.__nightfall.look(1666, 40)");
  await delay(600); await capture("cockpit-rear");
  await press("KeyE", "e");
  const exit = await pose();
  assert.equal(exit.mode, "walk");
  assert.ok(carClearance(vehicle, exit) >= -0.035, "exiting places the player outside the parked body");
  assert.equal(await evaluate(`window.__nightfall.parked.nearby(${vehicle.x},${vehicle.z},1).some(car => car.id === ${vehicle.id})`), true, "the exited car is returned to the street");
  await inspectCamera({ ...approachCamera, height: 10 }); await delay(400);
  await hold([["KeyW", "w"]], 16, position => sideOfCar(vehicle, position) * approachSide >= -CAR_HALF_WIDTH - PLAYER_RADIUS - 0.3);
  const overflight = await pose();
  assert.equal(overflight.mode, "fly");
  assert.ok(overflight.height > 9.9);
  assert.ok(sideOfCar(vehicle, overflight) * approachSide < -CAR_HALF_WIDTH - PLAYER_RADIUS, "flight above a car is not clipped to its ground footprint");
  await evaluate("window.__nightfall.inspect({kind:'view',id:'platform'})"); await delay(400);
  const platformStart = await pose();
  const platformSamples = [];
  await hold([["KeyW", "w"]], 60, position => {
    platformSamples.push(position);
    assert.equal(position.mode, "walk");
    assert.ok(position.height > 25 && Math.abs(position.height - platformStart.height) < 0.035);
    return Math.hypot(position.x - platformStart.x, position.z - platformStart.z) < 1.3;
  });
  const platformEnd = await pose();
  assert.equal(platformEnd.mode, "walk");
  assert.ok(platformEnd.height > 25 && Math.abs(platformEnd.height - platformStart.height) < 0.035);
  console.log(JSON.stringify({ name: "platform-movement", start: platformStart, end: platformEnd, samples: platformSamples }));
  assert.ok(Math.hypot(platformEnd.x - platformStart.x, platformEnd.z - platformStart.z) > 1, `platform walking remains independent of street vehicle collision: ${JSON.stringify({ platformStart, platformEnd, platformSamples })}`);
  const collisionReport = { name: "walking-vehicle-collision", car: vehicle, approaches, stopped, jumpPeak, exit, overflight, platformStart, platformEnd };
  report.push(collisionReport); console.log(JSON.stringify(collisionReport));
  await evaluate("window.__nightfall.inspect({kind:'clock',seconds:25}); window.__nightfall.inspect({kind:'view',id:'carriage'}); window.__nightfall.inspect({kind:'freeze',value:false})");
  await delay(400); await press("Escape", "Escape");
  const pausedTrainStart = await pose();
  const cabinStart = await evaluate("({u:document.querySelector('main').dataset.cabinU,v:document.querySelector('main').dataset.cabinV})");
  assert.equal(await evaluate("document.querySelector('main').dataset.phase"), "paused");
  await press("KeyW", "w", 500); await delay(600);
  const pausedTrainEnd = await pose();
  const cabinEnd = await evaluate("({u:document.querySelector('main').dataset.cabinU,v:document.querySelector('main').dataset.cabinV})");
  assert.equal(pausedTrainEnd.mode, "metro");
  assert.ok(Math.hypot(pausedTrainEnd.x - pausedTrainStart.x, pausedTrainEnd.z - pausedTrainStart.z) > 5, "the paused camera travels with its moving train");
  assert.deepEqual(cabinEnd, cabinStart, "paused movement input does not change the passenger's carriage-local position");
  assert.ok(pausedTrainEnd.height > 30 && Math.abs(pausedTrainEnd.height - pausedTrainStart.height) < 0.035);
  await capture("paused-moving-train");
  await click("Continue journey");
  assert.equal(await evaluate("document.querySelector('main').dataset.phase"), "playing");
  assert.equal((await pose()).mode, "metro");
  const trainReport = { name: "paused-train-carrier", start: pausedTrainStart, end: pausedTrainEnd, cabinStart, cabinEnd };
  report.push(trainReport); console.log(JSON.stringify(trainReport));
  assert.deepEqual(errors, [], "no browser errors");
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log("Six rooms, movement, exits, pause, mobile layout, parked-car collision, jumping, vehicle entry/exit, overflight, platform walking and paused train carrying passed; NPC and vehicle screenshots saved.");
} catch (error) {
  if (errors.length) console.error(errors.join("\n"));
  throw error;
} finally { socket?.close(); chrome.kill(); }
