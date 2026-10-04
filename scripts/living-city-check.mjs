import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createNightfallServer } from "../server/app.ts";
import { MultiplayerSession } from "../src/multiplayer/session.ts";
import { presencePlace } from "../src/multiplayer/presence.ts";
import { interiorWorld, interiorLocal } from "../src/city/interiors.ts";

const directory = resolve("artifacts", "living-city");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const { gameServer, httpServer } = createNightfallServer();
await gameServer.listen(0, "127.0.0.1");
const serverUrl = `ws://127.0.0.1:${httpServer.address().port}`;
const guest = new MultiplayerSession();
const venue = presencePlace("blue-hour");
assert.ok(venue);
const pose = (position, place = "") => ({ ...position, y: 0, yaw: Math.PI, pitch: 0, heading: Math.PI, speed: 0, mode: "walk", car: 0, place });
const waitFor = async (predicate, label, attempts = 120) => {
  for (let attempt = 0; attempt < attempts; attempt++) { if (await predicate()) return; await delay(150); }
  throw Error(`Timed out: ${label}`);
};
let chrome, socket;
const errors = [];
try {
  assert.ok(await guest.connect({ serverUrl, name: "Relay Guest", pose: pose(interiorWorld(venue, 2, 1), venue.id) }));
  const port = 9345;
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
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map(argument => argument.value ?? argument.description).join(" "));
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++requestId, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).catch(error => { throw Error(`${error.message}: ${expression.slice(0, 180)}`); });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const click = async label => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.textContent.trim().startsWith(${JSON.stringify(label)})); if (!button) throw Error('Missing button: ' + ${JSON.stringify(label)}); button.click(); })()`);
    await delay(250);
  };
  const press = async (code, key, duration = 60) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key }); await delay(duration);
    await call("Input.dispatchKeyEvent", { type: "keyUp", code, key }); await delay(250);
  };
  const field = async (label, value) => {
    await evaluate(`(() => { const input = [...document.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input'); if (!input) throw Error('Missing field'); input.focus(); input.select(); })()`);
    await call("Input.insertText", { text: value }); await delay(100);
  };
  const choose = async id => {
    const label = await evaluate(`window.__nightfall.rpg.dialogue.options.find(option => option.id === ${JSON.stringify(id)})?.label`);
    assert.ok(label, `dialogue choice ${id}`);
    await evaluate(`(() => { const option = [...document.querySelectorAll('.qd-option')].find(button => button.querySelector('.qd-label').textContent === ${JSON.stringify(label)}); if (!option) throw Error('Missing dialogue option'); option.click(); })()`);
    await delay(300);
  };
  const capture = async name => {
    const result = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(result.data, "base64"));
  };
  const inspect = async command => { await evaluate(`window.__nightfall.inspect(${JSON.stringify(command)})`); await delay(300); };
  const meetMira = async () => {
    await inspect({ kind: "camera", x: -52, z: 73, height: 2.7, yaw: Math.PI / 2, pitch: 0 });
    await press("KeyE", "e");
    assert.equal(await evaluate("window.__nightfall.rpg.dialogue?.npcId"), "mira");
  };
  const visit = async name => { await press("KeyT", "t"); await click(`Visit ${name}`); await press("KeyE", "e"); };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.clear(); } catch {}" });
  await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&clock=4&perf=1&server=${encodeURIComponent(serverUrl)}` });
  console.log("Loading city, content and shaders...");
  await waitFor(async () => await evaluate("document.querySelector('main')?.dataset.phase") === "intro", "renderer ready");
  await evaluate("document.querySelector('.scene-studio').style.display='none'");
  await click("Enter the city");
  console.log("Renderer ready; checking the Night Shift quest.");
  await meetMira(); await capture("mira-offer");
  const startingCredits = await evaluate("window.__nightfall.rpg.character.credits");
  await choose("accept-light"); await press("Escape", "Escape");
  assert.equal(await evaluate("window.__nightfall.rpg.quests.stage('borrowed-light')"), "manifest");
  for (const [name, stage] of [["Blue Hour Tea", "salvage"], ["Second Life Salvage", "repair"], ["Kiln Nine", "glasshouse"], ["The Glasshouse", "report"]]) {
    await visit(name);
    assert.equal(await evaluate("window.__nightfall.rpg.quests.stage('borrowed-light')"), stage);
    await press("KeyE", "e");
  }
  await meetMira(); await choose("report");
  if (await evaluate("!!window.__nightfall.rpg.dialogue")) await press("Escape", "Escape");
  assert.equal(await evaluate("window.__nightfall.rpg.quests.status('borrowed-light')"), "complete");
  assert.equal(await evaluate("window.__nightfall.rpg.character.credits"), startingCredits + 220);
  console.log("Mira offer, four actual venue entries and one-time quest payout passed.");
  await visit("Kiln Nine");
  await inspect({ kind: "freeze", value: false });
  const kiln = presencePlace("kiln");
  assert.ok(kiln);
  const roomPosition = async () => {
    const position = await evaluate("({ x: Number(document.querySelector('.coordinates').dataset.x), z: Number(document.querySelector('.coordinates').dataset.z) })");
    return interiorLocal(kiln, position.x, position.z);
  };
  for (let step = 0; step < 16 && (await roomPosition()).z > 3.0; step++) await press("KeyW", "w", 80);
  for (let step = 0; step < 22 && (await roomPosition()).x < 4.5; step++) await press("KeyD", "d", 80);
  await waitFor(async () => (await evaluate("window.__nightfall.rpg.snapshot().prompt ?? ''")).includes("workbench"), "scoped workbench prompt");
  const startingCells = await evaluate("window.__nightfall.rpg.character.count('shield-cell')");
  await capture("kiln-terminal"); await press("KeyE", "e");
  assert.equal(await evaluate("window.__nightfall.rpg.dialogue?.npcId"), "kiln-workbench");
  await choose("accept-calibration"); await choose("clip-chassis");
  assert.equal(await evaluate("window.__nightfall.rpg.quests.stage('kiln-calibration')"), "earth");
  await choose("retry-earth"); await choose("bond-earth"); await press("Escape", "Escape");
  await press("KeyE", "e");
  assert.equal(await evaluate("window.__nightfall.rpg.quests.stage('kiln-calibration')"), "supply");
  await choose("aux-feed"); await choose("dummy-load"); await choose("proof-pulse");
  await capture("kiln-certified"); await press("Escape", "Escape");
  assert.equal(await evaluate("window.__nightfall.rpg.quests.status('kiln-calibration')"), "complete");
  assert.equal(await evaluate("window.__nightfall.rpg.character.count('shield-cell')"), startingCells + 1);
  await waitFor(async () => !(await evaluate("window.__nightfall.rpg.snapshot().prompt ?? ''")).includes("workbench"), "completed workbench no longer offers reward");
  console.log("Kiln workbench: physical approach, safe wrong choice, exit/retry and one-time Shield Cell reward passed.");
  await visit("Blue Hour Tea");
  await click("Online"); await field("Display name", "City QA"); await field("Room code", guest.getView().code); await click("Join room");
  await waitFor(() => guest.getView().roster.length === 2, "browser joins local room");
  await waitFor(async () => (await evaluate("document.querySelector('[aria-label=\"Players in this room\"]')?.textContent ?? ''")).includes("Blue Hour Tea"), "indoor roster labels");
  await click("Back to the city");
  await waitFor(async () => await evaluate("window.__nightfallPerf().remotePlayers") === 1, "same-room remote rendered");
  assert.equal(await evaluate("window.__nightfallPerf().visibleBuildings"), 0);
  assert.equal(await evaluate("[...document.querySelectorAll('svg title')].some(title => title.textContent === 'Relay Guest')"), true);
  await press("KeyW", "w", 250); await capture("shared-teahouse");
  guest.publish(pose(venue.entrance), performance.now() / 1000);
  await waitFor(async () => await evaluate("window.__nightfallPerf().remotePlayers") === 0, "outdoor friend hidden inside");
  assert.equal(await evaluate("[...document.querySelectorAll('svg title')].some(title => title.textContent === 'Relay Guest')"), false);
  guest.publish(pose(interiorWorld(venue, 0, venue.depth / 2 - 2.2), venue.id), performance.now() / 1000);
  await delay(300);
  guest.publish(pose(interiorWorld(venue, 2, 1), venue.id), performance.now() / 1000);
  await waitFor(async () => await evaluate("window.__nightfallPerf().remotePlayers") === 1, "friend re-enters");
  console.log("Room-scoped avatars, floorplan dots, exits and re-entry passed.");
  await evaluate("window.qaPreviousRenderer=window.__nightfall.t; window.qaLoss=document.querySelector('.city-canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.qaLoss.loseContext()");
  await waitFor(async () => await evaluate("document.querySelector('main')?.dataset.phase") === "lost", "context loss surface");
  await evaluate("window.qaLoss.restoreContext()");
  await waitFor(async () => await evaluate("window.__nightfall.t !== window.qaPreviousRenderer && document.querySelector('main')?.dataset.phase === 'paused'"), "renderer rebuild", 200);
  await click("Keep walking");
  await waitFor(() => guest.friends().some(friend => friend.name === "City QA" && friend.place === ""), "rebuilt engine publishes outdoor recovery");
  await press("KeyE", "e");
  await waitFor(async () => await evaluate("window.__nightfallPerf().remotePlayers") === 1, "rebuilt engine sees same-room peer");
  const before = guest.friends().find(friend => friend.name === "City QA");
  assert.ok(before);
  await press("KeyD", "d", 400);
  await waitFor(() => guest.friends().some(friend => friend.name === "City QA" && Math.hypot(friend.x - before.x, friend.z - before.z) > 0.5), "rebuilt engine movement replicates");
  await capture("recovered-online");
  assert.equal(await evaluate("window.__nightfall.rpg.quests.status('borrowed-light')"), "complete");
  assert.equal(await evaluate("window.__nightfall.rpg.quests.status('kiln-calibration')"), "complete");
  assert.deepEqual(errors, [], "no browser runtime errors");
  console.log("Online renderer recovery preserves quests, presence, remote rendering and movement. All living-city checks passed.");
} catch (error) {
  console.error(error); if (errors.length) console.error(errors.join("\n")); process.exitCode = 1;
} finally {
  socket?.close(); chrome?.kill(); await guest.leave(); await gameServer.gracefullyShutdown(false);
}
