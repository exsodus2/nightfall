import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from "../src/city/driving.ts";
import { WALK_HEIGHT } from "../src/city/locomotion.ts";
import { CityWorld, DISTRICTS, PLAYER_RADIUS } from "../src/city/world.ts";

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
  await checkRotateHint(false); await capture("mobile-portrait");
  await checkRotateHint(true); await capture("mobile-portrait-reduced-motion");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
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
  const injectedBase = 910000;
  const clearArrivalCars = () => evaluate(`(() => { const parked = window.__nightfall.parked; for (const car of parked.all().filter(car => car.id >= ${injectedBase})) parked.take(car); })()`);
  const blockArrival = (anchor, dense = true) => evaluate(`(() => { const anchor = ${JSON.stringify(anchor)}, offsets = ${dense ? "[-4,-2,0,2,4]" : "[0]"}; let id = ${injectedBase}; for (const offsetX of offsets) for (const offsetZ of offsets) window.__nightfall.parked.park({ id:id++, x:anchor.x+offsetX, z:anchor.z+offsetZ, yaw:0 }); })()`);
  const arrivals = { name: "safe-walk-arrivals" };
  try {
    await inspectCamera({ x: vehicle.x, z: vehicle.z, height: 10, yaw: 0, pitch: 0 });
    await press("KeyF", "f");
    const landed = await pose();
    assert.equal(landed.mode, "walk");
    assert.ok(carClearance(vehicle, landed) >= -0.035, "landing over a parked car finds clear footing");
    assert.ok(Math.hypot(landed.x - vehicle.x, landed.z - vehicle.z) <= 4.02, "landing correction stays local");
    arrivals.parkedCarLanding = landed;

    await inspectCamera({ x: stopped.x, z: stopped.z, height: WALK_HEIGHT, yaw: vehicle.yaw, pitch: 0 });
    await press("KeyE", "e");
    assert.equal((await pose()).mode, "drive");
    await blockArrival(exit);
    await press("KeyE", "e");
    assert.equal((await pose()).mode, "drive", "blocked door exit keeps the controllable car session");
    assert.equal(await evaluate(`window.__nightfall.parked.all().some(car => car.id === ${vehicle.id})`), false, "blocked exit does not duplicate the driven car into parked storage");
    await clearArrivalCars(); await press("KeyE", "e");
    assert.equal((await pose()).mode, "walk", "the same door exit succeeds after the obstruction clears");

    await inspectCamera({ x: vehicle.x, z: vehicle.z, height: 10, yaw: 0, pitch: 0 });
    await blockArrival(vehicle);
    const flightBefore = await pose();
    await press("KeyF", "f");
    const flightAfter = await pose();
    assert.equal(flightAfter.mode, "fly", "a fully blocked landing preserves free flight");
    assert.ok(Math.hypot(flightAfter.x - flightBefore.x, flightAfter.z - flightBefore.z) < 0.04 && Math.abs(flightAfter.height - 10) < 0.04);
    arrivals.blockedFlight = flightAfter;
    await clearArrivalCars();

    const door = await evaluate("window.__nightfall.interiors.places.find(place => place.id === 'blue-hour').entrance");
    await blockArrival(door);
    await press("KeyT", "t"); await click("Visit Blue Hour Tea");
    const rejectedTravel = await pose();
    assert.equal(rejectedTravel.mode, "fly", "blocked map travel preserves the original mode");
    assert.ok(Math.hypot(rejectedTravel.x - flightAfter.x, rejectedTravel.z - flightAfter.z) < 0.04, "blocked map travel does not teleport into an obstacle");
    await clearArrivalCars();

    await press("KeyT", "t"); await click("Visit Blue Hour Tea"); await press("KeyE", "e");
    assert.equal(await evaluate("window.__nightfall.interiors.active?.id"), "blue-hour");
    await blockArrival(door, false);
    await press("KeyE", "e");
    const correctedExit = await pose();
    assert.equal(await evaluate("window.__nightfall.interiors.active"), null);
    assert.equal(correctedExit.mode, "walk");
    assert.ok(carClearance({ ...door, yaw: 0 }, correctedExit) >= -0.035, "venue exit avoids a car occupying the doorway");
    assert.ok(Math.hypot(correctedExit.x - door.x, correctedExit.z - door.z) <= 4.02);
    arrivals.correctedDoorway = correctedExit;
    await clearArrivalCars();

    await press("KeyT", "t"); await click("Visit Blue Hour Tea"); await press("KeyE", "e");
    await blockArrival(door);
    await press("KeyE", "e");
    assert.equal(await evaluate("window.__nightfall.interiors.active?.id"), "blue-hour", "fully blocked street exit leaves the room intact");
    await press("KeyF", "f");
    assert.equal(await evaluate("window.__nightfall.interiors.active"), null, "flight remains available as an alternative to a blocked street exit");
    assert.equal((await pose()).mode, "fly");
    await clearArrivalCars();

    const destination = DISTRICTS[4];
    const routeWorld = new CityWorld();
    await inspectCamera({ x: -36, z: 36, height: WALK_HEIGHT, yaw: 0, pitch: 0 });
    await press("KeyT", "t"); await click("Ground taxi"); await click(destination.name);
    assert.equal((await pose()).mode, "taxi");
    const taxiSamples = [];
    for (let sample = 0; sample < 300; sample++) {
      const position = await pose();
      assert.ok(routeWorld.canOccupy(position.x, position.z), `taxi pickup stays outside fixed obstacles: ${JSON.stringify(position)}`);
      taxiSamples.push(position);
      if (position.mode !== "taxi") break;
      await delay(150);
    }
    assert.ok(taxiSamples.length > 3);
    assert.notEqual(taxiSamples.at(-1).mode, "taxi", "safe pickup route completes");
    assert.ok(Math.hypot(taxiSamples.at(-1).x - destination.x, taxiSamples.at(-1).z - destination.z) <= 4.02);
    arrivals.safeTaxiPickup = { start: taxiSamples[0], end: taxiSamples.at(-1), samples: taxiSamples.length };

    await inspectCamera({ x: -540, z: 212, height: WALK_HEIGHT, yaw: 0, pitch: 0 });
    const isolatedPickup = await pose();
    assert.ok(routeWorld.canOccupy(isolatedPickup.x, isolatedPickup.z));
    await press("KeyT", "t"); await click("Ground taxi"); await click(destination.name);
    const rejectedTaxi = await pose();
    assert.equal(rejectedTaxi.mode, "walk", "a disconnected pickup does not start a broken journey");
    assert.ok(Math.hypot(rejectedTaxi.x - isolatedPickup.x, rejectedTaxi.z - isolatedPickup.z) < 0.04);
    arrivals.disconnectedTaxiPickup = rejectedTaxi;

    await inspectCamera({ x: destination.x, z: destination.z - 30, height: WALK_HEIGHT, yaw: 0, pitch: 0 });
    await blockArrival(destination);
    await press("KeyT", "t"); await click("Ground taxi"); await click(destination.name);
    assert.equal((await pose()).mode, "taxi");
    for (let sample = 0; sample < 240 && (await pose()).mode === "taxi"; sample++) await delay(150);
    const taxiArrival = await pose();
    assert.equal(taxiArrival.mode, "fly", "mandatory taxi arrival becomes controllable hover, not a stuck journey");
    assert.ok(taxiArrival.height > WALK_HEIGHT + 2.2);
    assert.ok(Math.hypot(taxiArrival.x - destination.x, taxiArrival.z - destination.z) < 0.04, "blocked taxi arrival does not teleport to a distant street");
    arrivals.blockedTaxiArrival = taxiArrival;
    await clearArrivalCars(); await press("KeyF", "f");
    assert.equal((await pose()).mode, "walk", "hover can land once the destination clears");
    report.push(arrivals); console.log(JSON.stringify(arrivals));
    await capture("safe-arrival");
  } finally { await clearArrivalCars(); }
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
  console.log("Six rooms, movement, exits, pause, mobile layout, car collision, safe arrivals, blocked handoffs, jumping, vehicle entry/exit, overflight, platform walking and paused train carrying passed; NPC and vehicle screenshots saved.");
} catch (error) {
  if (errors.length) console.error(errors.join("\n"));
  throw error;
} finally { socket?.close(); chrome.kill(); }
