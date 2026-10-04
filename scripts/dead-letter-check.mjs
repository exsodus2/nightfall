import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const outcome = process.argv.includes("--callback") ? "callback" : "anonymous";
const cityUrl = new URL(process.env.CITY_URL ?? "http://127.0.0.1:3000");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(cityUrl.hostname), "Use an existing loopback dev server.");
cityUrl.search = "studio=1&clock=4&perf=1";
const directory = resolve("artifacts", "dead-letter", outcome);
await mkdir(directory, { recursive: true });
const profile = await mkdtemp(resolve(directory, "browser-profile-"));
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");

const started = Date.now();
const errors = [], pending = new Map();
const report = { outcome, url: cityUrl.href, profile, startedAt: new Date(started).toISOString(), passed: false, checks: [], errors };
const questId = "last-good-signal";
const approaches = {
  counter: { x: 429, z: -233.997 },
  archive: { x: 435.849, z: -234.222 },
  relay: { x: 422.951, z: -239.75 },
};
let chrome, socket, evaluate, capture;
const waitFor = async (predicate, label, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  do { if (await predicate()) return; await delay(150); } while (Date.now() < deadline);
  throw Error(`Timed out: ${label}`);
};
const checkpoint = async (name, detail = {}) => {
  const check = { name, elapsedMs: Date.now() - started, ...detail };
  report.checks.push(check);
  console.log(JSON.stringify(check));
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
};

try {
  chrome = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", ...(process.argv.includes("--software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []), "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let port;
  await waitFor(async () => {
    if (chrome.exitCode !== null) throw Error(`Browser exited before startup: ${chrome.exitCode}`);
    try { port = Number((await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]); return port > 0; } catch { return false; }
  }, "isolated browser startup");
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let requestId = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map(argument => argument.value ?? argument.description).join(" "));
  });
  const call = (method, params = {}, timeout = 180000) => new Promise((resolveCall, reject) => {
    const id = ++requestId, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, timeout);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).catch(error => { throw Error(`${error.message}: ${expression.slice(0, 160)}`); });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const click = async label => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.textContent.trim().startsWith(${JSON.stringify(label)})); if (!button) throw Error('Missing button: ' + ${JSON.stringify(label)}); button.click(); })()`);
    await delay(250);
  };
  const press = async (code, key, duration = 60) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key });
    try { await delay(duration); } finally { await call("Input.dispatchKeyEvent", { type: "keyUp", code, key }); }
    await delay(300);
  };
  const choose = async id => {
    const label = await evaluate(`window.__nightfall.rpg.dialogue?.options.find(option => option.id === ${JSON.stringify(id)} && !option.disabled)?.label`);
    assert.ok(label, `enabled dialogue choice: ${id}`);
    await evaluate(`(() => { const option = [...document.querySelectorAll('.qd-option')].find(button => button.querySelector('.qd-label')?.textContent === ${JSON.stringify(label)}); if (!option) throw Error('Missing dialogue option'); option.click(); })()`);
    await delay(300);
  };
  capture = async name => {
    const result = await call("Page.captureScreenshot", { format: "png" }, 15000);
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(result.data, "base64"));
  };
  const state = () => evaluate(`(() => {
    const game = window.__nightfall.rpg, main = document.querySelector('main'), coordinates = document.querySelector('.coordinates');
    return { phase: main.dataset.phase, mode: main.dataset.mode, x: Number(coordinates.dataset.x), z: Number(coordinates.dataset.z), yaw: Number(coordinates.dataset.yaw), interior: window.__nightfallPerf().interior, stage: game.quests.stage('${questId}'), status: game.quests.status('${questId}'), outcome: game.quests.outcome('${questId}'), ledger: game.quests.flags.get('dead-letter.ledger') ?? null, spool: game.quests.flags.get('dead-letter.spool') ?? null, publication: game.quests.flags.get('dead-letter.publication') ?? null, character: game.character.serialize(), prompt: game.snapshot().prompt, dialogue: game.dialogue ? { npcId: game.dialogue.npcId, lines: game.dialogue.lines, options: game.dialogue.options.map(option => option.id) } : null };
  })()`);
  const ready = async () => {
    await waitFor(async () => {
      try { return await evaluate("document.querySelector('main')?.dataset.phase === 'intro' && !!window.__nightfall"); }
      catch (error) { if (/Execution context was destroyed|Cannot find context/.test(error.message)) return false; throw error; }
    }, "renderer ready", 240000);
    await evaluate("document.querySelector('.scene-studio').style.display='none'; window.__nightfall.inspect({kind:'freeze',value:false})");
    await click("Enter the city");
    assert.equal((await state()).phase, "playing");
  };
  const visit = async () => {
    await press("KeyT", "t"); await click("Visit Dead Letter Exchange"); await press("KeyE", "e");
    const current = await state();
    assert.equal(current.interior, "dead-letter", "E enters the actual venue");
    assert.equal(current.mode, "walk");
    assert.ok(Math.abs(current.yaw - Math.PI) < 0.01, "room-facing keyboard axes remain stable");
  };
  const moveAxis = async (axis, target) => {
    let stalled = 0;
    for (let step = 0; step < 48; step++) {
      const before = await state(), gap = target - before[axis];
      assert.equal(before.interior, "dead-letter", "walking stays inside the room");
      assert.equal(before.phase, "playing"); assert.equal(before.dialogue, null);
      if (Math.abs(gap) < 0.26) return;
      const key = axis === "x" ? gap > 0 ? "a" : "d" : gap > 0 ? "w" : "s";
      await press(`Key${key.toUpperCase()}`, key, Math.min(450, Math.max(60, Math.abs(gap) * 100)));
      const after = await state();
      stalled = Math.abs(after[axis] - before[axis]) < 0.02 ? stalled + 1 : 0;
      assert.ok(stalled < 4, `clear ${axis} route to ${target}; stopped at ${JSON.stringify(after)}`);
    }
    throw Error(`Movement did not settle near ${axis}=${target}: ${JSON.stringify(await state())}`);
  };
  const approach = async station => {
    const target = approaches[station];
    await moveAxis("x", 429);
    await moveAxis("z", target.z);
    await moveAxis("x", target.x);
    await checkpoint(`approach-${station}`, { pose: await state() });
  };
  const open = async station => {
    await press("KeyE", "e");
    const current = await state();
    assert.equal(current.dialogue?.npcId, `dead-letter-${station}`, `E opens ${station}`);
    return current;
  };
  const dialogueContains = async fragment => assert.ok((await state()).dialogue?.lines.some(line => line.includes(fragment)), `readable feedback: ${fragment}`);
  const floorplan = async (expected, label) => {
    await waitFor(async () => JSON.stringify(await evaluate("[...document.querySelectorAll('[data-interior-use]')].map(marker => marker.dataset.interiorUse)")) === JSON.stringify(expected), `${label}: active room markers`);
    const markers = await evaluate("[...document.querySelectorAll('[data-interior-use]')].map(marker => ({id:marker.dataset.interiorUse,label:marker.querySelector('title')?.textContent,glyph:marker.querySelector('text')?.textContent,dotsAbove:[...document.querySelectorAll('[data-interior-player],[data-interior-friend]')].every(dot => !!(marker.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING))}))");
    const documentRoot = await call("DOM.getDocument", { depth: 0 });
    const { nodeId } = await call("DOM.querySelector", { nodeId: documentRoot.root.nodeId, selector: ".minimap-button" });
    const accessible = await call("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
    const description = accessible.nodes.find(node => node.role?.value === "button")?.description?.value ?? "";
    assert.ok(description.includes("The exit is at the bottom"), `${label}: map button exposes the floorplan description`);
    for (const marker of markers) {
      assert.ok(marker.label && description.includes(marker.label), `${label}: accessible station name and region`);
      assert.ok(marker.glyph && marker.glyph.length === 1); assert.equal(marker.dotsAbove, true, `${label}: friend/player dots draw above stations`);
    }
    await checkpoint(`floorplan-${label}`, { markers, description });
  };
  const saveReload = async label => {
    assert.equal((await state()).dialogue, null);
    await press("Escape", "Escape");
    assert.equal((await state()).phase, "paused", "normal pause saves the game");
    const saved = await evaluate("JSON.parse(localStorage.getItem('nightfall.save.v1'))");
    assert.ok(saved?.savedAt >= started, "test owns a fresh save");
    assert.ok(Math.hypot(saved.position.x - 429, saved.position.z + 247.477972) < 0.1, "indoor save uses the safe exterior doorway");
    await checkpoint(`saved-${label}`, { quest: saved.quests.quests[questId], flags: saved.flags, character: saved.character });
    await call("Page.reload", { ignoreCache: false });
    await ready();
    assert.equal((await state()).dialogue, null, "reload never restores a stale modal");
    return saved;
  };

  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.navigate", { url: cityUrl.href });
  console.log(`Loading isolated ${outcome} quest run; cold shader startup is not an FPS measurement.`);
  await ready();
  const initial = await state();
  assert.equal(initial.status, "available", "fresh profile cannot import a real save");
  assert.equal(initial.ledger, null); assert.equal(initial.spool, null); assert.equal(initial.publication, null);
  await checkpoint("renderer-ready", { character: initial.character, perf: await evaluate("window.__nightfallPerf()") });
  await visit(); await floorplan(["dead-letter-counter"], "offer"); await approach("counter"); await open("counter"); await capture("01-public-desk");
  await choose("accept-signal"); await choose("leave");
  assert.equal((await state()).stage, "evidence");
  await floorplan(["dead-letter-counter", "dead-letter-archive", "dead-letter-relay"], "active-desktop");
  await capture("07-floorplan-desktop");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(500);
  await floorplan(["dead-letter-counter", "dead-letter-archive", "dead-letter-relay"], "active-narrow");
  await capture("08-floorplan-narrow");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await delay(500);

  await approach("archive"); await open("archive"); await dialogueContains("CONSENT");
  assert.equal((await state()).ledger, null, "opening the ledger is not confirmation");
  await press("Escape", "Escape");
  assert.equal((await state()).ledger, null, "Escape keeps the ledger retryable");
  await saveReload("unconfirmed-ledger");
  assert.equal((await state()).stage, "evidence"); assert.equal((await state()).ledger, null);
  await visit(); await approach("archive"); await open("archive");
  await choose("confirm-ledger"); await dialogueContains("LEDGER LOGGED"); await capture("02-ledger-logged"); await choose("leave");
  assert.equal((await state()).ledger, true);

  await approach("relay"); await open("relay");
  assert.equal((await state()).spool, null, "opening the spool is not confirmation");
  await choose("leave"); assert.equal((await state()).spool, null, "Leave keeps the spool retryable");
  await open("relay"); await choose("confirm-spool"); await dialogueContains("SPOOL RECORDED"); await choose("leave");
  assert.equal((await state()).spool, true); assert.equal((await state()).stage, "verify");
  await checkpoint("evidence-confirmed", { ledger: true, spool: true });
  await open("relay"); await choose("select-041"); await dialogueContains("supersedes");
  assert.equal((await state()).stage, "verify"); await choose("retry-verification");
  await choose("select-043"); await dialogueContains("no verified sender");
  assert.equal((await state()).stage, "verify"); await capture("03-unsigned-feedback"); await choose("retry-verification");
  await choose("select-042"); assert.equal((await state()).stage, "route");
  await choose("route-blue-hour"); await dialogueContains("DESTINATION MISMATCH");
  assert.equal((await state()).stage, "route"); await choose("leave");
  await saveReload("verified-route");
  const resumed = await state();
  assert.equal(resumed.stage, "route"); assert.equal(resumed.ledger, true); assert.equal(resumed.spool, true);
  assert.equal(resumed.character.credits, initial.character.credits, "wrong choices do not pay");
  await visit(); await approach("relay");
  const route = await open("relay"); assert.ok(route.dialogue.options.includes("route-glasshouse"));
  await choose("route-second-life"); await dialogueContains("DESTINATION MISMATCH");
  await choose("retry-route"); await choose("route-glasshouse"); await dialogueContains("ROUTED: GLASSHOUSE");
  assert.equal((await state()).stage, "publish"); await choose("leave");
  await checkpoint("verification-and-route-retries-persist");

  await approach("counter"); await open("counter"); await choose("publish-home");
  await dialogueContains("PRIVACY INTERLOCK"); assert.equal((await state()).stage, "publish");
  assert.equal((await state()).publication, null); await choose("retry-publication");
  await capture("04-publication-choice"); await choose(`publish-${outcome}`);
  const completed = await state();
  assert.equal(completed.status, "complete"); assert.equal(completed.outcome, outcome); assert.equal(completed.publication, outcome);
  assert.equal(completed.character.credits, initial.character.credits + (outcome === "anonymous" ? 90 : 130));
  assert.equal(completed.character.level, initial.character.level); assert.equal(completed.character.xp, initial.character.xp + 150);
  assert.equal(completed.character.reputation.civilian, (initial.character.reputation.civilian ?? 0) + (outcome === "anonymous" ? 6 : 4));
  assert.equal(completed.character.reputation.ghosts ?? 0, (initial.character.reputation.ghosts ?? 0) + (outcome === "anonymous" ? 3 : 0));
  assert.equal(await evaluate("[...document.querySelectorAll('.quest-toast-message')].filter(element => element.textContent.startsWith('Quest complete: Last Good Signal')).length"), 1, "completion has one visible notification");
  await dialogueContains("SENT RECEIPT"); await dialogueContains("Home line sealed"); await capture("05-sent-receipt");
  assert.deepEqual(completed.dialogue.options, ["leave"], "receipt cannot pay twice");
  await choose("leave");
  await floorplan(["dead-letter-counter"], "receipt");
  for (let retry = 0; retry < 2; retry++) {
    const receipt = await open("counter");
    assert.deepEqual(receipt.dialogue.options, ["leave"]); await dialogueContains("SENT RECEIPT");
    assert.deepEqual(receipt.character, completed.character, "reopening cannot duplicate rewards"); await choose("leave");
  }
  await saveReload("complete");
  assert.equal((await state()).status, "complete"); assert.deepEqual((await state()).character, completed.character);
  await visit(); await floorplan(["dead-letter-counter"], "restored-receipt"); await approach("counter");
  const restored = await open("counter"); await dialogueContains("SENT RECEIPT"); await dialogueContains("Home line sealed");
  assert.deepEqual(restored.dialogue.options, ["leave"]); assert.deepEqual(restored.character, completed.character);
  assert.deepEqual(await evaluate("window.__nightfall.rpg.interactables('dead-letter').map(object => object.id)"), ["dead-letter-counter"]);
  await capture("06-restored-receipt"); await choose("leave");
  assert.deepEqual(errors, [], "no browser runtime errors");
  report.passed = true;
  await checkpoint("all-dead-letter-checks-passed", { reward: { credits: completed.character.credits - initial.character.credits, xp: completed.character.xp - initial.character.xp }, character: restored.character, perf: await evaluate("window.__nightfallPerf()") });
} catch (error) {
  report.failure = error.stack ?? String(error);
  console.error(error);
  if (errors.length) console.error(errors.join("\n"));
  if (capture) { try { await capture("failure"); } catch {} }
  process.exitCode = 1;
} finally {
  report.durationMs = Date.now() - started;
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  for (const request of pending.values()) clearTimeout(request.timer);
  socket?.close(); chrome?.kill();
}
