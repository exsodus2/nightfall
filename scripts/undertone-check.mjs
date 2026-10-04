import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const mood = process.argv.find(argument => argument.startsWith("--mood="))?.slice(7) ?? "rail";
assert.ok(["rail", "rain"].includes(mood), "Use --mood=rail or --mood=rain.");
const record = mood === "rail" ? "rail-return" : "rain-on-tin", title = mood === "rail" ? "RAIL RETURN" : "RAIN ON TIN";
const pattern = mood === "rail" ? "ONE HIT / TWO REST / THREE HIT / FOUR REST" : "ONE REST / TWO HIT / THREE REST / FOUR HIT";
const cityUrl = new URL(process.env.CITY_URL ?? "http://127.0.0.1:3000");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(cityUrl.hostname), "Use an existing loopback dev server.");
cityUrl.search = "studio=1&clock=4&perf=1";
const directory = resolve("artifacts", "undertone", mood);
await mkdir(directory, { recursive: true });
const profile = await mkdtemp(resolve(directory, "browser-profile-"));
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const started = Date.now(), errors = [], pending = new Map();
const report = { url: cityUrl.href, mood, profile, startedAt: new Date(started).toISOString(), passed: false, checks: [], errors };
const stations = {
  counter: { id: "undertone-counter", x: 45, z: -232.939 },
  booth: { id: "undertone-listening-note", x: 51.8, z: -239.75 },
  archive: { id: "undertone-sleeve-archive", x: 52.6, z: -233.164 },
};
let chrome, socket, capture;
const waitFor = async (predicate, label, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  do { if (await predicate()) return; await delay(150); } while (Date.now() < deadline);
  throw Error(`Timed out: ${label}`);
};
const checkpoint = async (name, detail = {}) => {
  const check = { name, elapsedMs: Date.now() - started, ...detail };
  report.checks.push(check); console.log(JSON.stringify(check));
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
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).catch(error => { throw Error(`${error.message}: ${expression.slice(0, 160)}`); });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const press = async (code, key, duration = 60) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key });
    try { await delay(duration); } finally { await call("Input.dispatchKeyEvent", { type: "keyUp", code, key }); }
    await delay(300);
  };
  const click = async label => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.textContent.trim().startsWith(${JSON.stringify(label)})); if (!button) throw Error('Missing button: ' + ${JSON.stringify(label)}); button.click(); })()`);
    await delay(250);
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
    const game = window.__nightfall.rpg, coordinates = document.querySelector('.coordinates');
    return { phase: document.querySelector('main').dataset.phase, mode: document.querySelector('main').dataset.mode, x: Number(coordinates.dataset.x), z: Number(coordinates.dataset.z), yaw: Number(coordinates.dataset.yaw), interior: window.__nightfallPerf().interior, stage: game.quests.stage('the-space-between'), status: game.quests.status('the-space-between'), outcome: game.quests.outcome('the-space-between'), request: game.quests.flags.get('the-space-between.request') ?? null, record: game.quests.flags.get('the-space-between.record') ?? null, queued: game.quests.flags.get('undertone.last-set') ?? null, character: game.character.serialize(), prompt: game.snapshot().prompt, dialogue: game.dialogue ? {npcId:game.dialogue.npcId,lines:game.dialogue.lines,options:game.dialogue.options.map(option=>option.id)} : null };
  })()`);
  const radio = () => evaluate(`(() => { const widget=document.querySelector('section[aria-label="Radio"]'); if(!widget) throw Error('Radio widget missing'); return {status:widget.dataset.status,power:widget.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed'),controls:[...widget.querySelectorAll('select,input')].map(control=>({label:control.getAttribute('aria-label'),value:control.value}))}; })()`);
  const ready = async () => {
    await waitFor(async () => {
      try { return await evaluate("document.querySelector('main')?.dataset.phase === 'intro' && !!window.__nightfall"); }
      catch (error) { if (/Execution context was destroyed|Cannot find context/.test(error.message)) return false; throw error; }
    }, "renderer ready", 240000);
    await evaluate("document.querySelector('.scene-studio').style.display='none'; window.__nightfall.inspect({kind:'freeze',value:false})");
    await click("Enter the city"); assert.equal((await state()).phase, "playing");
  };
  const markers = async expected => {
    const ids = expected.map(station => stations[station].id);
    await waitFor(async () => JSON.stringify(await evaluate("[...document.querySelectorAll('[data-interior-use]')].map(marker=>marker.dataset.interiorUse)")) === JSON.stringify(ids), "scoped Undertone floorplan markers");
    const description = await evaluate("document.getElementById(document.querySelector('.minimap-button').getAttribute('aria-describedby'))?.textContent ?? ''");
    assert.ok(description.includes("Undertone floor plan"));
    for (const id of ids) assert.ok(await evaluate(`document.querySelector('[data-interior-use="${id}"] title')?.textContent`));
  };
  const visit = async () => {
    await press("KeyT", "t"); await click("Visit Undertone"); await press("KeyE", "e");
    const current = await state(); assert.equal(current.interior, "undertone"); assert.equal(current.mode, "walk");
    assert.ok(Math.abs(current.yaw - Math.PI) < 0.01);
  };
  const moveAxis = async (axis, target) => {
    let stalled = 0;
    for (let step = 0; step < 48; step++) {
      const before = await state(), gap = target - before[axis];
      assert.equal(before.interior, "undertone"); assert.equal(before.phase, "playing"); assert.equal(before.dialogue, null);
      if (Math.abs(gap) < 0.24) return;
      const key = axis === "x" ? gap > 0 ? "a" : "d" : gap > 0 ? "w" : "s";
      await press(`Key${key.toUpperCase()}`, key, Math.min(450, Math.max(60, Math.abs(gap) * 100)));
      const after = await state(); stalled = Math.abs(after[axis] - before[axis]) < 0.02 ? stalled + 1 : 0;
      assert.ok(stalled < 4, `clear ${axis} route to ${target}: ${JSON.stringify(after)}`);
    }
    throw Error(`Movement did not settle near ${axis}=${target}: ${JSON.stringify(await state())}`);
  };
  const approach = async station => {
    await moveAxis("x", 45); await moveAxis("z", stations[station].z); await moveAxis("x", stations[station].x);
    await checkpoint(`approach-${station}`, { pose: await state() });
  };
  const open = async station => {
    await press("KeyE", "e"); const current = await state();
    assert.equal(current.dialogue?.npcId, stations[station].id); return current;
  };
  const linesContain = async text => assert.ok((await state()).dialogue?.lines.some(line => line.includes(text)), `readable feedback: ${text}`);
  const saveReload = async label => {
    assert.equal((await state()).dialogue, null); await press("Escape", "Escape");
    assert.equal((await state()).phase, "paused");
    const saved = await evaluate("JSON.parse(localStorage.getItem('nightfall.save.v1'))");
    assert.ok(saved?.savedAt >= started); assert.ok(Math.hypot(saved.position.x - 45, saved.position.z + 248.536183) < 0.1);
    await checkpoint(`saved-${label}`, { quest: saved.quests.quests['the-space-between'], flags: saved.flags, character: saved.character });
    await call("Page.reload", { ignoreCache: false }); await ready();
    assert.equal((await state()).dialogue, null);
  };

  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.navigate", { url: cityUrl.href });
  console.log(`Loading isolated Undertone ${mood} run; shader startup is not an FPS measurement.`);
  await ready();
  const initial = await state(), originalRadio = await radio();
  assert.equal(initial.status, "available"); assert.equal(initial.queued, null); assert.equal(originalRadio.power, "false");
  await visit(); await markers(["counter"]); await approach("counter"); await open("counter"); await capture("01-last-set-book");
  await choose("accept-set"); await choose("leave"); await markers(["counter", "booth", "archive"]);
  await approach("archive");
  assert.deepEqual((await open("archive")).dialogue.options, ["leave"]); await linesContain("Confirm the request"); await choose("leave");
  assert.equal((await state()).stage, "listen"); assert.equal((await state()).record, null);
  await approach("booth"); await capture("02-listening-table"); await open("booth");
  await linesContain("TWO HITS. TWO RESTS."); await press("Escape", "Escape");
  assert.equal((await state()).request, null); await saveReload("unconfirmed-request");
  assert.equal((await state()).request, null); assert.equal((await state()).stage, "listen");
  await visit(); await approach("booth"); await open("booth"); await choose("confirm-request"); await choose("leave");
  assert.equal((await state()).request, "confirm-request"); assert.equal((await state()).stage, "sleeves");
  await approach("archive"); await capture("03-sleeve-archive"); await open("archive"); await choose("busy-record");
  await linesContain("Nothing was selected"); assert.equal((await state()).record, null); await choose("leave");
  await saveReload("request-logged"); assert.equal((await state()).request, "confirm-request"); assert.equal((await state()).record, null);
  await visit(); await approach("archive"); await open("archive"); await choose("busy-record"); await choose("retry-sleeves");
  await capture("04-quiet-side-choice"); await choose(record); await linesContain(title); await linesContain(pattern); await choose("leave");
  assert.equal((await state()).record, record); assert.equal((await state()).stage, "program");
  assert.deepEqual((await open("archive")).dialogue.options, ["leave"]); await choose("leave");
  await approach("counter"); await open("counter"); await choose("fill-rests"); await linesContain("Nothing was queued");
  assert.equal((await state()).queued, null); assert.deepEqual((await state()).character, initial.character); await capture("05-rests-preserved-feedback");
  await press("Escape", "Escape"); await saveReload("selected-side");
  assert.equal((await state()).record, record); assert.equal((await state()).stage, "program");
  await visit(); await approach("counter"); await open("counter"); await linesContain(title); await linesContain(pattern);
  await choose("fill-rests"); assert.deepEqual((await state()).dialogue.options, [`retry-${mood}`, "leave"]);
  await choose(`retry-${mood}`); await choose("keep-rests");
  const completed = await state();
  assert.equal(completed.status, "complete"); assert.equal(completed.outcome, mood); assert.equal(completed.queued, record);
  assert.equal(completed.character.credits, initial.character.credits + 75); assert.equal(completed.character.xp, initial.character.xp + 100);
  assert.equal(completed.character.reputation.civilian, (initial.character.reputation.civilian ?? 0) + 3);
  assert.equal(await evaluate("[...document.querySelectorAll('.quest-toast-message')].filter(element=>element.textContent.startsWith('Quest complete: The Space Between')).length"), 1);
  await linesContain("ONE SET PAID"); await linesContain(pattern); await capture("06-set-receipt"); await choose("leave"); await markers(["counter"]);
  const receipt = await open("counter"); assert.deepEqual(receipt.dialogue.options, ["leave"]); assert.deepEqual(receipt.character, completed.character); await choose("leave");
  await saveReload("complete"); assert.deepEqual((await state()).character, completed.character);
  await visit(); await markers(["counter"]); await approach("counter");
  const restored = await open("counter"); await linesContain(title); await linesContain(pattern); await linesContain("ONE SET PAID");
  assert.deepEqual(restored.dialogue.options, ["leave"]); assert.deepEqual(restored.character, completed.character); await capture("07-restored-receipt"); await choose("leave");
  assert.deepEqual(await radio(), originalRadio, "silent cue cards never change radio power, station or controls");
  assert.deepEqual(errors, [], "no browser runtime errors");
  report.passed = true;
  await checkpoint("all-undertone-checks-passed", { reward: { credits: 75, xp: 100 }, character: restored.character, radio: originalRadio, perf: await evaluate("window.__nightfallPerf()") });
} catch (error) {
  report.failure = error.stack ?? String(error); console.error(error);
  if (errors.length) console.error(errors.join("\n"));
  if (capture) { try { await capture("failure"); } catch {} }
  process.exitCode = 1;
} finally {
  report.durationMs = Date.now() - started;
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  for (const request of pending.values()) clearTimeout(request.timer);
  socket?.close(); chrome?.kill();
}
