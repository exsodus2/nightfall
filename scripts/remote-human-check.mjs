import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createNightfallServer } from "../server/app.ts";
import { CityWorld } from "../src/city/world.ts";
import { interiorWorld } from "../src/city/interiors.ts";
import { PropRecorder } from "../src/city/prop-canvas.ts";
import { MultiplayerSession } from "../src/multiplayer/session.ts";
import { hexToRgb } from "../src/multiplayer/protocol.ts";
import { presencePlace } from "../src/multiplayer/presence.ts";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { drawRemotePlayers, drawInteriorPlayers } = await import("../src/multiplayer/remote-scene.ts");
const directory = resolve("artifacts", "remote-human");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const hash = value => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); }
  return result >>> 0;
};
const headwear = ["visor", "cap", "hood", "bare"];
const skins = [[179, 143, 115], [111, 85, 69], [189, 174, 141], [144, 112, 88]];
const slots = [-3.3, -1.1, 1.1, 3.3], stage = { x: -512, z: 270 };
const pose = extra => ({ x: stage.x, y: 0, z: stage.z, yaw: Math.PI, pitch: 0, heading: Math.PI, speed: 0, mode: "walk", car: 0, place: "", carrier: null, ...extra });
const world = new CityWorld();
for (const offset of slots) assert.ok(world.canOccupy(stage.x + offset, stage.z), "Staged peers stand on unobstructed promenade pavement");
const now = () => performance.now() / 1000;
const angleGap = (first, second) => Math.abs(Math.atan2(Math.sin(first-second), Math.cos(first-second)));
const waitFor = async (predicate, label, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(100); }
  throw Error(`Timed out: ${label}`);
};
const { gameServer, httpServer } = createNightfallServer();
await gameServer.listen(0, "127.0.0.1");
const serverUrl = `ws://127.0.0.1:${httpServer.address().port}`;
const report = { server: "ephemeral loopback", clock: 4, peers: [], checks: [], errors: [] };
const sessions = [], peers = [];
let chrome, socket, capture;
try {
  for (let attempt = 0; attempt < 48 && peers.length < 4; attempt++) {
    const session = new MultiplayerSession(); sessions.push(session);
    const name = `PEER ${peers.length + 1}`, initial = pose({ x: stage.x + slots[peers.length] });
    assert.ok(await session.connect({ serverUrl, code: peers[0]?.session.getView().code, name, pose: initial }), session.getView().error ?? "Node peer joins local room");
    await waitFor(() => session.getView().roster.some(person => person.self), "peer roster state");
    const self = session.getView().roster.find(person => person.self), seed = hash(self.id), style = headwear[(seed >>> 4) % 4];
    if (peers.some(peer => peer.headwear === style)) { await session.leave(); await delay(120); continue; }
    peers.push({ session, id: self.id, name: self.name, hex: self.color, color: hexToRgb(self.color), headwear: style, skin: skins[(seed >>> 8) % 4], pose: initial });
  }
  assert.equal(peers.length, 4, "The local room represents all four deterministic headwear styles");
  report.peers = peers.map(peer => ({ id:peer.id, name:peer.name, hex:peer.hex, color:peer.color, headwear:peer.headwear, skin:peer.skin, pose:peer.pose }));
  console.log(`Staged real peers: ${peers.map(peer => `${peer.name} ${peer.headwear} ${peer.hex}`).join(", ")}`);
  const port = 9349;
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
  const press = async (code, value) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key: value }); await delay(65);
    await call("Input.dispatchKeyEvent", { type: "keyUp", code, key: value }); await delay(300);
  };
  const inspect = command => evaluate(`window.__nightfall.inspect(${JSON.stringify(command)})`);
  const camera = (distance, height = 2.7, pitch = 0.16) => inspect({ kind: "camera", x: stage.x, z: stage.z + distance, height, yaw: 0, pitch });
  const instrument = () => evaluate(`(() => {
    const textmode = window.__nightfall.t, weather = textmode.layers.all.at(-2), print = textmode.print, charColor = textmode.charColor;
    let color = [], rows = [];
    window.__peerAudit = { rows:[], frames:0 };
    textmode.charColor = function(...channels) { if (channels.length) color = channels; return charColor.apply(this, channels); };
    textmode.print = function(value, column, row) {
      if (typeof value === 'string' && value.startsWith('PEER ')) rows.push({ text:value, column, row, color:[...color] });
      return print.apply(this, arguments);
    };
    weather.postDraw(() => { window.__peerAudit = { rows, frames:window.__peerAudit.frames+1, cols:weather.grid.cols, lines:weather.grid.rows }; rows = []; });
  })()`);
  capture = async name => {
    const result = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(result.data, "base64"));
  };
  const observed = peer => peers.find(other => other !== peer).session.remotes(now()).find(remote => remote.id === peer.id);
  const setPoses = async makePose => {
    peers.forEach((peer, index) => { peer.pose = makePose(peer, index); peer.session.publish(peer.pose, now()); });
    await waitFor(() => peers.every(peer => {
      const observer = peers.find(other => other !== peer).session;
      const friend = observer.friends().find(person => person.id === peer.id);
      return friend?.place === peer.pose.place && friend.mode === peer.pose.mode && Math.hypot(friend.x - peer.pose.x, friend.z - peer.pose.z) < 0.04;
    }), "all staged peer poses accepted");
    await waitFor(() => peers.every(peer => {
      const remote = observed(peer);
      return remote?.mode === peer.pose.mode && remote.place === peer.pose.place && angleGap(remote.heading, peer.pose.heading) < 0.004 && Math.abs(remote.y-peer.pose.y) < 0.04 && Math.abs(remote.speed-peer.pose.speed) < 0.04;
    }), "interpolated heading, feet height and gait settle");
    await delay(350);
  };
  const readAudit = () => evaluate("({audit:window.__peerAudit,perf:window.__nightfallPerf(),phase:document.querySelector('main')?.dataset.phase,touch:matchMedia('(pointer:coarse)').matches})");
  const measure = async (name, distance, options = {}) => {
    const expected = options.visible ?? peers;
    const frame = (await readAudit()).audit.frames;
    await waitFor(async () => {
      const result = await readAudit();
      return result.audit.frames > frame + 3 && result.perf.remotePlayers === expected.length && expected.every(peer => result.audit.rows.some(row => row.text.startsWith(peer.name)));
    }, `${name}: native peer labels and scope`);
    const result = await readAudit(), counts = peers.map(peer => {
      const recorder = new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
      const avatar = { ...peer.pose, id:peer.id, name:peer.name, color:peer.color, hex:peer.hex, stride:0 };
      if (options.interior) drawInteriorPlayers(recorder, [avatar], 4);
      else drawRemotePlayers(recorder, { x:stage.x, z:stage.z + distance, height:2.7, yaw:0, time:4, rain:true, low:result.perf.lite }, [avatar]);
      const total = recorder.counts.reduce((sum, count) => sum + count, 0);
      const far = !options.interior && Math.hypot(peer.pose.x - stage.x, peer.pose.z - stage.z - distance) >= (result.perf.lite ? 28 : 48);
      assert.ok(total <= (far ? 7 : peer.pose.mode === "fly" ? 42 : 40), `${name}: ${peer.name} shared model stays in budget`);
      return { name:peer.name, distance:Math.hypot(peer.pose.x-stage.x,peer.pose.z-stage.z-distance), far, instances:total, meshes:[...recorder.counts] };
    });
    for (const peer of expected) {
      const label = result.audit.rows.find(row => row.text.startsWith(peer.name));
      assert.ok(Math.abs(label.column) < result.audit.cols / 2 && Math.abs(label.row) < result.audit.lines / 2, `${name}: ${peer.name} label is onscreen`);
      if (!options.allowDim) assert.deepEqual(label.color.slice(0,3), peer.color, `${name}: ${peer.name} keeps its assigned color`);
    }
    const observerPoses = peers.map(peer => {
      const remote = observed(peer); assert.ok(remote);
      assert.ok(angleGap(remote.heading,peer.pose.heading) < 0.004, `${name}: ${peer.name} heading is settled before capture`);
      assert.ok(Math.abs(remote.y-peer.pose.y) < 0.04, `${name}: ${peer.name} feet height is settled before capture`);
      return { id:peer.id, name:peer.name, x:remote.x, y:remote.y, z:remote.z, heading:remote.heading, speed:remote.speed, stride:remote.stride, place:remote.place };
    });
    assert.equal(result.phase, "playing");
    report.checks.push({ name, ...result, observerPoses, recordedPoseBudget:counts });
    await capture(name);
    console.log(`${name}: ${expected.length} visible peers, recorded instances ${counts.map(count => count.instances).join("/")}, local ${result.perf.fps}fps / ${result.perf.cpuMs}ms`);
  };
  const load = async touch => {
    await call("Emulation.setDeviceMetricsOverride", { width:touch ? 852 : 1440, height:touch ? 393 : 960, deviceScaleFactor:touch ? 2 : 1, mobile:touch });
    await call("Emulation.setTouchEmulationEnabled", { enabled:touch, maxTouchPoints:touch ? 5 : 1 });
    console.log(`Loading ${touch ? "touch/LITE" : "desktop/full"} renderer and shaders...`);
    await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&clock=4&perf=1&server=${encodeURIComponent(serverUrl)}` });
    await waitFor(async () => await evaluate("document.querySelector('main')?.dataset.phase === 'intro' && !!window.__nightfall"), "renderer ready", 180000);
    await evaluate("document.querySelector('.scene-studio').style.display='none'");
    await click("Enter the city"); await instrument(); await inspect({ kind:"freeze", value:true }); await camera(8);
    await click("Online"); await field("Display name", "Avatar QA"); await field("Room code", peers[0].session.getView().code); await click("Join room");
    await waitFor(() => peers[0].session.friends().some(friend => friend.name === "Avatar QA"), "browser joins local room");
    await click("Back to the city");
    await waitFor(async () => (await readAudit()).perf.lite === touch, "requested renderer specialization");
  };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setEmulatedMedia", { features:[{ name:"prefers-reduced-motion", value:"reduce" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", { source:"try { localStorage.clear(); } catch {}" });
  await load(false); await measure("desktop-front", 8);
  await setPoses((peer, index) => pose({ x:stage.x + slots[index], yaw:0, heading:0 }));
  await measure("desktop-back", 8);
  await setPoses((peer, index) => pose({ x:stage.x + slots[index], yaw:Math.PI/2, heading:Math.PI/2, speed:2 }));
  for (let step = 1; step <= 6; step++) {
    peers.forEach((peer,index) => { peer.pose = pose({ x:stage.x+slots[index]+step*0.2, heading:Math.PI/2, yaw:Math.PI/2, speed:2 }); peer.session.publish(peer.pose,now()); });
    await delay(100);
  }
  await measure("desktop-stride", 8);
  await setPoses((peer, index) => pose({ x:stage.x + slots[index] }));
  await camera(56, 2.7, 0.02); await measure("desktop-distant", 56, { allowDim:true });
  await camera(8, 5.2);
  await setPoses((peer, index) => pose({ x:stage.x + slots[index], y:2, mode:"fly", speed:22, heading:Math.PI/2 }));
  await measure("desktop-flight", 8);
  const venue = presencePlace("blue-hour"); assert.ok(venue);
  await setPoses(() => pose({ ...venue.entrance }));
  await press("KeyT", "t"); await click("Visit Blue Hour Tea"); await press("KeyE", "e");
  await waitFor(async () => (await readAudit()).perf.interior === venue.id, "normal door enters shared teahouse");
  await waitFor(async () => (await readAudit()).perf.remotePlayers === 0, "outdoor peers are hidden inside");
  await setPoses(() => pose({ ...interiorWorld(venue,0,venue.depth/2-2.2), place:venue.id, heading:venue.yaw+Math.PI }));
  await setPoses((peer,index) => pose({ ...interiorWorld(venue,slots[index],-0.5), place:venue.id, heading:venue.yaw+Math.PI }));
  await measure("shared-teahouse", 8, { interior:true });
  await setPoses(() => pose({ ...venue.entrance }));
  await waitFor(async () => (await readAudit()).perf.remotePlayers === 0, "exited peers no longer render inside");
  await delay(1700);
  await setPoses((peer,index) => pose({ x:stage.x+slots[index] }));
  await click("Online"); await click("Leave room");
  await waitFor(() => !peers[0].session.friends().some(friend => friend.name === "Avatar QA"), "desktop browser leaves before touch reload");
  await load(true); await measure("touch-front", 8);
  await camera(32, 2.7, 0.03); await measure("touch-distant", 32, { allowDim:true });
  assert.deepEqual(report.errors, [], "No browser runtime errors");
  await writeFile(resolve(directory,"index.html"), `<!doctype html><meta charset="utf-8"><title>Remote humans</title><style>body{background:#071017;color:#e0ecef;font:14px monospace;margin:24px}figure{margin:28px 0}img{max-width:100%;border:1px solid #42545f}pre{white-space:pre-wrap}</style><h1>Shared human model · remote players</h1><p>Fixed city clock 4. Real loopback peers; session-ID headwear/skin shown below. GPU screenshots plus separately recorded production-model instance budgets. Local timing is not phone-device FPS.</p><pre>${JSON.stringify(report.peers,null,2)}</pre>${report.checks.map(check=>`<figure><h2>${check.name}</h2><img src="${check.name}.png"><figcaption>${JSON.stringify(check.recordedPoseBudget)}</figcaption></figure>`).join("")}`);
  console.log("Remote human hardware checks passed: four styles, color/name retention, near/far, heading, stride, flight, shared-room scope and touch/LITE.");
} catch (error) {
  console.error(error); report.failure = error instanceof Error ? error.message : String(error);
  if (capture) await capture("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(resolve(directory,"report.json"), JSON.stringify(report,null,2));
  socket?.close(); chrome?.kill();
  for (const session of sessions) await session.leave();
  await gameServer.gracefullyShutdown(false);
}
