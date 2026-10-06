import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { matchMaker } from "colyseus";
import { createNightfallServer } from "../server/app.ts";
import { NightfallRoom } from "../server/room.ts";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from "../src/city/driving.ts";
import { PLAYER_RADIUS } from "../src/city/world.ts";
import { MultiplayerSession } from "../src/multiplayer/session.ts";
import { presencePlace } from "../src/multiplayer/presence.ts";

const directory = resolve("artifacts", "remote-vehicles");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const browserName = "Vehicle QA", vehicle = { id: 61001, x: 0, z: 100, yaw: 0 };
const groundPose = (x, z, mode = "drive", heading = 0) => ({ x, y: 0, z, yaw: heading + 0.8, pitch: 0, heading, speed: 0, mode, car: mode === "drive" ? 77 : 0, place: "" });
const report = { checks: {}, joins: [], errors: [] };
const playerPose = player => Object.fromEntries(["x", "y", "z", "yaw", "heading", "speed", "mode", "car", "place"].map(key => [key, player[key]]));
const originalJoin = NightfallRoom.prototype.onJoin;
NightfallRoom.prototype.onJoin = function(client, options) {
  originalJoin.call(this, client, options);
  const player = this.state.players.get(client.sessionId);
  if (player?.name === browserName) report.joins.push({ room: this.roomId, session: client.sessionId, ...playerPose(player) });
};
const { gameServer, httpServer } = createNightfallServer();
await gameServer.listen(0, "127.0.0.1");
const serverUrl = `ws://127.0.0.1:${httpServer.address().port}`;
const firstPeer = new MultiplayerSession(), secondPeer = new MultiplayerSession();
const waitFor = async (predicate, label, timeout = 20000) => {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeout) throw Error(`Timed out: ${label}`);
    await delay(150);
  }
};
const near = (actual, expected, label, tolerance = 0.04) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} differs from ${expected}`);
const clearance = (car, point) => Math.max(Math.abs((point.x - car.x) * Math.cos(car.yaw) + (point.z - car.z) * Math.sin(car.yaw)) - CAR_HALF_WIDTH - PLAYER_RADIUS, Math.abs((point.x - car.x) * Math.sin(car.yaw) - (point.z - car.z) * Math.cos(car.yaw)) - CAR_HALF_LENGTH - PLAYER_RADIUS);
const serverPose = code => {
  const room = matchMaker.getLocalRoomById(code);
  const player = room && [...room.state.players.values()].find(candidate => candidate.name === browserName);
  return player ? playerPose(player) : null;
};
let chrome, socket;
try {
  assert.ok(await firstPeer.connect({ serverUrl, name: "First Anchor", pose: groundPose(0, 0, "walk") }));
  assert.ok(await secondPeer.connect({ serverUrl, name: "Second Anchor", pose: groundPose(0, 0, "walk") }));
  const firstCode = firstPeer.getView().code, secondCode = secondPeer.getView().code;
  const port = 9363;
  chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(directory, "browser-profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", ...(process.argv.includes("--software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []), "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let tabs;
  await waitFor(async () => { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()); return true; } catch { return false; } }, "browser startup");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let requestId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") report.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") report.errors.push(message.params.args.map(argument => argument.value ?? argument.description).join(" "));
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
  const click = async label => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.textContent.trim().startsWith(${JSON.stringify(label)})); if (!button) throw Error('Missing button: ' + ${JSON.stringify(label)}); button.click(); })()`);
    await delay(250);
  };
  const field = async (label, value) => {
    await evaluate(`(() => { const input = [...document.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input'); if (!input) throw Error('Missing field'); input.focus(); input.select(); })()`);
    await call("Input.insertText", { text: value }); await delay(100);
  };
  const press = async (code, key, duration = 60) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key });
    try { await delay(duration); } finally { await call("Input.dispatchKeyEvent", { type: "keyUp", code, key }); }
    await delay(250);
  };
  const state = () => evaluate("(() => { const point = document.querySelector('.coordinates'), main = document.querySelector('main'); return { x:Number(point.dataset.x), z:Number(point.dataset.z), height:Number(point.dataset.y), phase:main.dataset.phase, mode:main.dataset.mode, interior:window.__nightfall.interiors.active?.id ?? '', prompt:document.querySelector('.interaction-prompt')?.textContent ?? '' }; })()");
  const inspect = async camera => { await evaluate(`window.__nightfall.inspect(${JSON.stringify({ kind: "camera", height: 2.7, yaw: 0, pitch: 0, ...camera })})`); await delay(350); };
  const capture = async name => {
    const result = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(result.data, "base64"));
  };
  const holdForward = async (samples, observe) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyW", key: "w" });
    try { for (let sample = 0; sample < samples; sample++) { await delay(150); await observe(await state()); } }
    finally { await call("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyW", key: "w" }); }
    await delay(350);
  };
  const peerPose = async pose => { secondPeer.publish(pose, performance.now() / 1000); await delay(750); };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.clear(); localStorage.setItem('nightfall.driveView','chase'); } catch {}" });
  await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&clock=0&perf=1&server=${encodeURIComponent(serverUrl)}` });
  console.log("Loading remote vehicle regression scene.");
  await waitFor(async () => await evaluate("document.querySelector('main')?.dataset.phase") === "intro", "renderer ready", 180000);
  await evaluate("document.querySelector('.scene-studio').style.display='none'");
  await click("Enter the city");
  await evaluate(`window.__nightfall.inspect({kind:'freeze',value:true}); window.__nightfall.parked.park(${JSON.stringify(vehicle)})`);
  await inspect({ x: -3, z: 100, yaw: Math.PI / 2 });
  assert.match((await state()).prompt, /Get in the car/);
  await press("KeyE", "e");
  assert.equal((await state()).mode, "drive");
  await delay(400);
  await click("Online");
  const firstCamera = await state();
  assert.equal(firstCamera.phase, "paused");
  assert.ok(Math.hypot(firstCamera.x - vehicle.x, firstCamera.z - vehicle.z) > 8, "the paused join actually uses an offset chase camera");
  await field("Display name", browserName); await field("Room code", firstCode); await click("Join room");
  await waitFor(() => !!serverPose(firstCode), "paused browser joins first room");
  const firstJoin = report.joins[0];
  assert.equal(firstJoin.mode, "drive"); assert.equal(firstJoin.y, 0); assert.equal(firstJoin.car, vehicle.id); assert.equal(firstJoin.speed, 0);
  near(firstJoin.x, vehicle.x, "join body x"); near(firstJoin.z, vehicle.z, "join body z"); near(firstJoin.heading, vehicle.yaw, "join body yaw");
  report.checks.pausedJoin = { camera: firstCamera, seed: firstJoin, server: serverPose(firstCode) };
  await capture("paused-chase-join"); await click("Back to the city");
  for (let turn = 0; turn < 4; turn++) {
    await evaluate(`window.__nightfall.look(${turn % 2 ? -1800 : 1800},0)`);
    await press("KeyV", "v"); await delay(450);
    const physical = serverPose(firstCode);
    near(physical.x, vehicle.x, "orbit body x"); near(physical.z, vehicle.z, "orbit body z"); near(physical.heading, vehicle.yaw, "orbit body yaw");
    assert.equal(physical.y, 0); assert.equal(physical.car, vehicle.id); assert.equal(physical.speed, 0);
  }
  await press("KeyW", "w", 850);
  assert.ok(serverPose(firstCode).speed > 0.5, "the switch test pauses a physically moving car");
  await click("Online");
  await waitFor(() => serverPose(firstCode)?.speed === 0, "pause publishes a stopped body");
  const beforeSwitch = serverPose(firstCode), switchCamera = await state();
  await click("Leave room"); await field("Room code", secondCode); await click("Join room");
  await waitFor(() => !!serverPose(secondCode), "paused browser joins another room");
  const secondJoin = report.joins[1];
  near(secondJoin.x, beforeSwitch.x, "room switch body x"); near(secondJoin.z, beforeSwitch.z, "room switch body z"); near(secondJoin.heading, beforeSwitch.heading, "room switch body yaw");
  assert.equal(secondJoin.speed, 0); assert.equal(secondJoin.y, 0); assert.equal(secondJoin.car, vehicle.id);
  assert.ok(Math.hypot(secondJoin.x - switchCamera.x, secondJoin.z - switchCamera.z) > 5, "room switching does not replace the body with the chase camera");
  report.checks.pausedSwitch = { camera: switchCamera, before: beforeSwitch, seed: secondJoin };
  console.log("Paused joins, signed stop publication and physical camera-orbit continuity passed.");
  await capture("paused-room-switch");
  const blocker = { x: secondJoin.x, z: secondJoin.z - 10, yaw: 0 };
  await peerPose(groundPose(blocker.x, blocker.z));
  await click("Back to the city");
  let nearestDriveGap = Infinity;
  await holdForward(18, () => {
    const body = serverPose(secondCode);
    const gap = body.z - blocker.z;
    nearestDriveGap = Math.min(nearestDriveGap, gap);
    assert.ok(gap >= 5.55, `local driving crossed the peer's physical body: ${gap}`);
  });
  assert.ok(nearestDriveGap < 7, "the collision test actually reaches the remote bumper");
  report.checks.driving = { blocker, nearestDriveGap, stopped: serverPose(secondCode) };
  await capture("remote-bumper-stop");
  await delay(500); await press("KeyE", "e");
  assert.equal((await state()).mode, "walk");

  await peerPose(groundPose(0, 0));
  await inspect({ x: -6, z: 0, yaw: Math.PI / 2 });
  await holdForward(12, point => assert.ok(point.x <= -CAR_HALF_WIDTH - PLAYER_RADIUS + 0.04, `walker crossed the remote body: ${JSON.stringify(point)}`));
  const blockedWalker = await state();
  assert.ok(blockedWalker.x > -2.6, "the walker reaches the peer's side");
  report.checks.walking = blockedWalker;
  await capture("walking-remote-body");
  await inspect({ x: 0, z: 0, height: 10 });
  await press("KeyF", "f");
  const landing = await state();
  assert.equal(landing.mode, "walk");
  assert.ok(clearance({ x: 0, z: 0, yaw: 0 }, landing) >= -0.04);
  assert.ok(Math.hypot(landing.x, landing.z) <= 4.02);
  report.checks.landing = landing;
  await capture("landing-beside-remote");
  await peerPose(groundPose(0, 0, "walk"));
  await inspect({ x: -6, z: 0, yaw: Math.PI / 2 });
  await holdForward(14, () => undefined);
  assert.ok((await state()).x > 1, "changing the peer to walking clears its vehicle collision");
  await peerPose(groundPose(0, 0));
  await inspect({ x: -6, z: 0, yaw: Math.PI / 2 });
  await secondPeer.leave(); await delay(600);
  await holdForward(14, () => undefined);
  assert.ok((await state()).x > 1, "departing peers do not leave a phantom vehicle collider");
  report.checks.cleared = await state();
  console.log("Real-input driving, walking, landing and remote-obstacle retirement passed.");

  const venue = presencePlace("blue-hour");
  assert.ok(venue);
  await press("KeyT", "t"); await click("Visit Blue Hour Tea"); await press("KeyE", "e");
  assert.equal((await state()).interior, venue.id);
  assert.ok(await secondPeer.connect({ serverUrl, name: "Door Driver", code: secondCode, pose: groundPose(venue.entrance.x, venue.entrance.z) }));
  await delay(800);
  assert.equal(await evaluate("window.__nightfallPerf().remotePlayers"), 0, "street cars are not rendered inside the venue");
  await press("KeyE", "e");
  const exited = await state();
  assert.equal(exited.interior, ""); assert.equal(exited.mode, "walk");
  assert.ok(clearance({ ...venue.entrance, yaw: 0 }, exited) >= -0.04, "leaving indoors queries exterior vehicles rather than the indoor render list");
  assert.ok(Math.hypot(exited.x - venue.entrance.x, exited.z - venue.entrance.z) <= 4.02);
  await waitFor(() => serverPose(secondCode)?.place === "", "canonical scope exit accepted by server");
  const exitedServer = serverPose(secondCode);
  near(exitedServer.x, exited.x, "corrected exit server x"); near(exitedServer.z, exited.z, "corrected exit server z");
  report.checks.interiorExit = { exited, server: exitedServer };
  await capture("remote-car-doorway-exit");
  await click("Online"); await click("Leave room"); await click("Keep exploring solo");
  const immediateVehicle = { id: 61002, x: 0, z: 140, yaw: 0 };
  await evaluate(`window.__nightfall.parked.park(${JSON.stringify(immediateVehicle)})`);
  await inspect({ x: -3, z: 140, yaw: Math.PI / 2 });
  await press("KeyE", "e");
  assert.equal((await state()).mode, "drive");
  await call("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyW", key: "w" });
  let immediateOpen;
  try {
    await delay(850);
    immediateOpen = await evaluate("(async () => { const started=performance.now(), online=[...document.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith('Online')); if (!online) throw Error('Missing Online button'); online.click(); for (let attempt=0;attempt<40;attempt++) { await new Promise(resolve=>setTimeout(resolve,0)); const create=[...document.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith('Create private room')); if (create&&!create.disabled) { create.click(); return {elapsedMs:performance.now()-started}; } } throw Error('Create room did not open immediately'); })()");
  } finally { await call("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyW", key: "w" }); }
  await waitFor(() => report.joins.length === 3, "immediate paused create-room request");
  const immediateJoin = report.joins[2];
  assert.equal(immediateJoin.mode, "drive"); assert.equal(immediateJoin.speed, 0); assert.equal(immediateJoin.y, 0); assert.equal(immediateJoin.car, immediateVehicle.id);
  near(immediateJoin.x, immediateVehicle.x, "immediate join physical x"); near(immediateJoin.heading, 0, "immediate join body yaw");
  assert.ok(immediateJoin.z < immediateVehicle.z - 0.5, "the immediate join pauses an actually moving car before the next scheduled snapshot");
  report.checks.immediatePause = { ...immediateOpen, seed: immediateJoin, server: serverPose(immediateJoin.room) };
  await capture("immediate-moving-pause-join");
  assert.deepEqual(report.errors, [], "no browser runtime errors");
  report.checks.performance = await evaluate("window.__nightfallPerf()");
  console.log(JSON.stringify(report.checks));
  console.log("Paused physical-pose joins, orbiting, driving/walking collision, landing and scoped room exit passed.");
} catch (error) {
  report.errors.push(error.stack ?? String(error)); console.error(error); process.exitCode = 1;
} finally {
  socket?.close(); chrome?.kill();
  await firstPeer.leave(); await secondPeer.leave(); await gameServer.gracefullyShutdown(false);
  NightfallRoom.prototype.onJoin = originalJoin;
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
}
