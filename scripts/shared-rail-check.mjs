import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createNightfallServer } from "../server/app.ts";
import { MultiplayerSession } from "../src/multiplayer/session.ts";
import { METRO_TIME_OFFSET, railPose } from "../src/multiplayer/rail.ts";
import { PLATFORM_HEIGHT, STATIONS, TRAIN_EYE_HEIGHT, boardingTrain, doorAt, localToWorld, trainAt, worldToLocal } from "../src/city/metro.ts";

const directory = resolve("artifacts", "shared-rail");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const { gameServer, httpServer } = createNightfallServer();
await gameServer.listen(0, "127.0.0.1");
const serverUrl = `ws://127.0.0.1:${httpServer.address().port}`;
const guest = new MultiplayerSession(), epochGuest = new MultiplayerSession();
const browserName = "Rail QA", station = STATIONS[1];
const now = () => performance.now() / 1000;
const railMessage = (carrier, time) => ({ ...railPose(carrier, time), pitch: 0, speed: 0, mode: "metro", car: 0, place: "", carrier });
const waitFor = async (predicate, label, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(100); }
  throw Error(`Timed out: ${label}`);
};
const angleGap = (first, second) => Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
const report = { server: "ephemeral loopback", checks: {}, errors: [] };
let chrome, socket, capture;
try {
  assert.ok(await guest.connect({ serverUrl, name: "Rail Guest", pose: { ...localToWorld(station, 7, 22), y: PLATFORM_HEIGHT, yaw: station.yaw, pitch: 0, heading: station.yaw, speed: 0, mode: "walk", car: 0, place: "" } }));
  await waitFor(() => guest.worldTime(now()) !== null, "room clock heartbeat");
  const port = 9346;
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
  const key = (type, code, value) => call("Input.dispatchKeyEvent", { type, code, key: value });
  const press = async (code, value, duration = 60) => {
    await key("keyDown", code, value);
    try { await delay(duration); } finally { await key("keyUp", code, value); }
    await delay(250);
  };
  const field = async (label, value) => {
    await evaluate(`(() => { const input = [...document.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input'); if (!input) throw Error('Missing field'); input.focus(); input.select(); })()`);
    await call("Input.insertText", { text: value }); await delay(100);
  };
  const state = () => evaluate("(() => { const main = document.querySelector('main'), position = document.querySelector('.coordinates'); return { phase:main?.dataset.phase, mode:main?.dataset.mode, x:Number(position?.dataset.x), z:Number(position?.dataset.z), height:Number(position?.dataset.y), yaw:Number(position?.dataset.yaw), u:main?.dataset.cabinU === '' ? null : Number(main?.dataset.cabinU), v:main?.dataset.cabinV === '' ? null : Number(main?.dataset.cabinV), doors:Number(main?.dataset.doors), prompt:document.querySelector('.interaction-prompt')?.textContent }; })()");
  const friend = (session = guest) => session.friends().find(person => person.name === browserName);
  const remote = (session = guest) => session.remotes(now()).find(person => person.name === browserName);
  const sameLocal = (first, second, label) => {
    assert.equal(first.train, second.train, `${label}: same train`);
    assert.ok(Math.abs(first.u - second.u) < 0.06 && Math.abs(first.v - second.v) < 0.06, `${label}: same carriage-local coordinates`);
    assert.ok(angleGap(first.yaw, second.yaw) < 0.025, `${label}: same relative facing`);
  };
  capture = async name => {
    const result = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(result.data, "base64"));
  };
  const walkUntil = async (code, value, reached, label, timeout = 4500) => {
    await key("keyDown", code, value);
    try { await waitFor(async () => reached(await state()), label, timeout); } finally { await key("keyUp", code, value); }
    await delay(200);
  };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.clear(); } catch {}" });
  await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&view=platform&clock=4&perf=1&server=${encodeURIComponent(serverUrl)}` });
  console.log("Loading shared-rail browser and shaders...");
  await waitFor(async () => {
    const current = await state();
    if (current.phase === "error") throw Error(await evaluate("document.body.innerText"));
    return current.phase === "intro";
  }, "renderer ready", 180000);
  await evaluate("document.querySelector('.scene-studio').style.display='none'");
  await click("Enter the city");
  console.log("Renderer ready; joining the loopback room.");
  await click("Online"); await field("Display name", browserName); await field("Room code", guest.getView().code); await click("Join room");
  await waitFor(() => guest.getView().roster.length === 2 && !!friend(), "browser joins local platform room");
  await click("Back to the city");
  await evaluate("window.__nightfall.inspect({kind:'freeze',value:false})");
  const platformStart = await state();
  assert.equal(platformStart.mode, "walk"); assert.ok(platformStart.height > 31);
  console.log(`Joined room; walking to the physical platform doorway from ${JSON.stringify(platformStart)}.`);
  await walkUntil("KeyW", "w", current => worldToLocal(station, current.x, current.z).v <= 15.6, "walk along the platform to a door");
  await walkUntil("KeyA", "a", current => current.mode === "metro" || worldToLocal(station, current.x, current.z).u <= 4.5, "walk to the platform boarding edge");
  const platformEdge = await state();
  if (platformEdge.mode !== "metro") {
    assert.ok(doorAt(worldToLocal(station, platformEdge.x, platformEdge.z).v), "approach aligns with a real carriage doorway");
    console.log("At the physical platform door; waiting for the shared timetable.");
    await waitFor(async () => {
      const train = boardingTrain(guest.worldTime(now()) + METRO_TIME_OFFSET, station.index);
      return !!train && train.remaining > 3 && (await state()).prompt?.includes("Board the monorail");
    }, "scheduled train opens its physical doors", 100000);
    await press("KeyE", "e");
  }
  await waitFor(async () => (await state()).mode === "metro" && !!friend()?.carrier, "actual boarding publishes a carrier");
  let aboard = await state();
  const attached = friend().carrier;
  assert.ok(attached && doorAt(aboard.v));
  assert.ok(Math.abs(aboard.height - PLATFORM_HEIGHT - TRAIN_EYE_HEIGHT) < 0.035);
  const guestCarrier = { train: attached.train, u: -0.6, v: 18, yaw: Math.PI };
  guest.publish(railMessage(guestCarrier, guest.worldTime(now())), now());
  await waitFor(() => guest.getView().roster.find(person => person.self)?.mode === "metro", "Node peer boards the same physical train");
  await waitFor(async () => await evaluate("window.__nightfallPerf().remotePlayers") === 1, "browser renders the rail peer");
  await walkUntil("KeyA", "a", current => current.u <= 0.5, "walk from the doorway into the aisle");
  await evaluate("window.__nightfall.look(300,0)"); await delay(500);
  await capture("shared-carriage");
  report.checks.boarding = { platformStart, platformEdge, browser: friend(), guestCarrier };
  console.log(`Browser and Node peer boarded shared train ${attached.train}.`);

  await waitFor(() => trainAt(guest.worldTime(now()) + METRO_TIME_OFFSET, attached.train).speed > 8, "shared train departs", 30000);
  await press("Escape", "Escape");
  await waitFor(() => remote()?.speed === 0, "paused rider publishes a stopped local gait");
  await delay(300);
  const pausedStart = await state(), parkedCarrier = { ...friend().carrier }, idleStart = { ...remote() };
  assert.equal(pausedStart.phase, "paused");
  await press("KeyW", "w", 500);
  const samples = [];
  for (let sample = 0; sample < 8; sample++) { await delay(150); samples.push({ ...remote() }); }
  const pausedEnd = await state();
  sameLocal(friend().carrier, parkedCarrier, "pause");
  assert.equal(pausedEnd.u, pausedStart.u); assert.equal(pausedEnd.v, pausedStart.v);
  assert.ok(Math.hypot(pausedEnd.x - pausedStart.x, pausedEnd.z - pausedStart.z) > 10, "paused player follows the moving train in world space");
  assert.ok(samples.every(sample => sample.speed === 0 && Math.abs(sample.stride - idleStart.stride) < 1e-6), "standing riders do not walk in place while the train moves");
  assert.ok(Math.hypot(samples.at(-1).x - idleStart.x, samples.at(-1).z - idleStart.z) > 10, "the idle remote remains physically carried");
  await capture("paused-shared-carriage");
  report.checks.pausedCarrier = { start: pausedStart, end: pausedEnd, carrier: parkedCarrier, idleStride: idleStart.stride, finalStride: samples.at(-1).stride };
  console.log("Paused carrier coordinates and stopped remote gait remain stable while the train travels.");

  console.log("Exercising WebGL context loss and passenger rebuild.");
  await evaluate("window.qaPreviousRenderer=window.__nightfall.t; window.qaLoss=document.querySelector('.city-canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); if (!window.qaLoss) throw Error('Missing context-loss extension'); window.qaLoss.loseContext()");
  await waitFor(async () => (await state()).phase === "lost", "context loss surface");
  await evaluate("window.qaLoss.restoreContext()");
  await waitFor(async () => await evaluate("window.__nightfall.t !== window.qaPreviousRenderer && document.querySelector('main')?.dataset.phase === 'paused'"), "renderer rebuild", 180000);
  await evaluate("document.querySelector('.scene-studio').style.display='none'");
  const rebuilt = await state();
  assert.equal(rebuilt.mode, "metro");
  assert.ok(Math.abs(rebuilt.u - parkedCarrier.u) < 0.06 && Math.abs(rebuilt.v - parkedCarrier.v) < 0.06, "WebGL rebuild restores the same carriage-local location");
  assert.ok(Math.abs(rebuilt.height - PLATFORM_HEIGHT - TRAIN_EYE_HEIGHT) < 0.035);
  await delay(350); sameLocal(friend().carrier, parkedCarrier, "rebuilt carrier");
  await click("Continue journey");
  const beforeWalk = { ...friend().carrier };
  await press("KeyW", "w", 550);
  await waitFor(() => {
    const carrier = friend()?.carrier;
    return carrier?.train === beforeWalk.train && Math.hypot(carrier.u - beforeWalk.u, carrier.v - beforeWalk.v) > 0.7;
  }, "rebuilt local carriage movement replicates");
  aboard = await state();
  const afterWalk = { ...friend().carrier };
  assert.ok(Math.abs(aboard.u - afterWalk.u) < 0.2 && Math.abs(aboard.v - afterWalk.v) < 0.2);
  await capture("recovered-shared-carriage");
  report.checks.rebuild = { state: rebuilt, beforeWalk, afterWalk };
  console.log("WebGL rebuild preserves the passenger and resumes carriage-local replication.");

  console.log("Creating a second local room to test joining a different rail epoch while aboard.");
  assert.ok(await epochGuest.connect({ serverUrl, name: "Epoch Guest", pose: railMessage(guestCarrier, 0) }));
  await waitFor(() => epochGuest.worldTime(now()) !== null, "fresh room clock");
  const oldEpoch = guest.worldTime(now()), newEpoch = epochGuest.worldTime(now());
  assert.ok(oldEpoch - newEpoch > 10, "room-swap test actually uses different rail epochs");
  await click("Online");
  const beforeJoin = { ...friend().carrier };
  await click("Leave room");
  await waitFor(() => guest.getView().roster.length === 1, "browser leaves old room");
  await field("Room code", epochGuest.getView().code); await click("Join room");
  await waitFor(() => !!friend(epochGuest)?.carrier, "joining while riding preserves the carrier in the fresh room");
  await click("Back to the city");
  const afterJoin = await state(), acceptedJoin = friend(epochGuest);
  sameLocal(acceptedJoin.carrier, beforeJoin, "new-epoch join");
  assert.equal(afterJoin.mode, "metro");
  assert.ok(Math.hypot(acceptedJoin.x - afterJoin.x, acceptedJoin.z - afterJoin.z) < 12, "browser and server adopt the new room's train position");
  const beforeSecondWalk = { ...acceptedJoin.carrier };
  await press("KeyW", "w", 350);
  await waitFor(() => {
    const carrier = friend(epochGuest)?.carrier;
    return carrier?.train === beforeSecondWalk.train && Math.hypot(carrier.u - beforeSecondWalk.u, carrier.v - beforeSecondWalk.v) > 0.5;
  }, "post-room-swap carriage movement is accepted");
  await capture("joined-new-epoch");
  report.checks.roomSwap = { oldEpoch, newEpoch, beforeJoin, afterJoin, acceptedJoin, afterWalk: friend(epochGuest).carrier };
  assert.deepEqual(report.errors, [], "no browser runtime errors");
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log("Actual shared-timetable boarding, idle gait, paused carrying, WebGL recovery and riding room-swap passed.");
} catch (error) {
  console.error(error); if (report.errors.length) console.error(report.errors.join("\n"));
  report.failure = error instanceof Error ? error.message : String(error);
  if (capture) await capture("failure").catch(() => {});
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close(); chrome?.kill(); await guest.leave(); await epochGuest.leave(); await gameServer.gracefullyShutdown(false);
}
