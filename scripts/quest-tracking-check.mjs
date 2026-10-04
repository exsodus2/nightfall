import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const cityUrl = new URL(process.env.CITY_URL ?? "http://127.0.0.1:3000");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(cityUrl.hostname), "Use a loopback development server.");
cityUrl.search = "studio=1&clock=4&perf=1";
const directory = resolve("artifacts", "quest-tracking");
await mkdir(directory, { recursive: true });
const profile = await mkdtemp(resolve(directory, "browser-profile-"));
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
let chrome, socket;
const errors = [], checks = [];
try {
  chrome = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chrome.exitCode !== null) throw Error(`Browser exited during startup: ${chrome.exitCode}`);
    try { port = Number((await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]); if (port > 0) break; } catch {}
    await delay(100);
  }
  assert.ok(port, "Isolated browser has a debug port");
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
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
    const id = ++requestId, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 180000);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(100); }
    throw Error(`Timed out: ${label}: ${JSON.stringify(await evaluate("({phase:document.querySelector('main')?.dataset.phase,focus:document.activeElement?.outerHTML?.slice(0,300),tracked:window.__nightfall?.rpg.questSnapshot(null).tracked?.id,pressed:[...document.querySelectorAll('.quest-track-button')].map(button=>[button.getAttribute('aria-label'),button.getAttribute('aria-pressed')])})"))}`);
  };
  const click = async label => {
    await evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(element=>element.getAttribute('aria-label')===${JSON.stringify(label)}||element.textContent.trim().startsWith(${JSON.stringify(label)})); if(!button)throw Error('Missing button: '+${JSON.stringify(label)});button.click(); })()`);
    await delay(200);
  };
  const press = async (code, key, modifiers = 0) => {
    const windowsVirtualKeyCode = key === "Enter" ? 13 : key === "Tab" ? 9 : undefined;
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key, modifiers, windowsVirtualKeyCode, text: key === "Enter" ? "\r" : undefined, unmodifiedText: key === "Enter" ? "\r" : undefined });
    await call("Input.dispatchKeyEvent", { type: "keyUp", code, key, modifiers, windowsVirtualKeyCode });
    await delay(250);
  };
  const capture = async name => {
    const shot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const tracked = quest => waitFor(`window.__nightfall.rpg.questSnapshot(null).tracked?.id===${JSON.stringify(quest)} && document.querySelector('[data-quest=${quest}] .quest-track-button')?.getAttribute('aria-pressed')==='true'`, `Tracking ${quest}`);
  const ready = async () => {
    await waitFor("document.querySelector('main')?.dataset.phase==='intro' && !!window.__nightfall", "Renderer ready", 180000);
    await evaluate("document.querySelector('.scene-studio').style.display='none'");
    await click("Enter the city");
  };
  const saved = () => evaluate("JSON.parse(localStorage.getItem('nightfall.save.v1'))");
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.navigate", { url: cityUrl.href });
  await ready();
  await evaluate("window.__nightfall.rpg.quests.start('borrowed-light'); window.__nightfall.rpg.quests.start('relay-chip')");
  await press("KeyJ", "j");
  await tracked("relay-chip");
  const initial = await evaluate("({character:window.__nightfall.rpg.character.serialize(),quests:window.__nightfall.rpg.quests.serialize().quests})");
  await evaluate("document.querySelector('[data-quest=borrowed-light] .quest-track-button').focus()");
  await press("Enter", "Enter");
  await tracked("borrowed-light");
  assert.equal((await saved()).quests.tracked, "borrowed-light", "Selection saves immediately while the ledger remains open");
  assert.equal(await evaluate("document.querySelector('main').dataset.phase"), "paused");
  assert.equal(await evaluate("window.__nightfall.rpg.dialogue"), null);
  assert.deepEqual(await evaluate("({character:window.__nightfall.rpg.character.serialize(),quests:window.__nightfall.rpg.quests.serialize().quests})"), initial, "Tracking never grants rewards or advances objectives");
  checks.push({ name: "keyboard-track-and-save", quest: "borrowed-light" });

  for (const viewport of [{ name: "desktop", width: 1440, height: 960 }, { name: "portrait", width: 393, height: 852 }, { name: "compact", width: 480, height: 320 }]) {
    await call("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    await delay(250);
    await evaluate("document.querySelector('[data-quest=borrowed-light] .quest-track-button').scrollIntoView({block:'center'})");
    const layout = await evaluate("(() => {const panel=document.querySelector('.quest-log');return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,panelWidth:panel.clientWidth,panelScroll:panel.scrollWidth,buttons:[...document.querySelectorAll('.quest-track-button')].map(button=>{const box=button.getBoundingClientRect();return {name:button.getAttribute('aria-label'),pressed:button.getAttribute('aria-pressed'),left:box.left,right:box.right,height:box.height}})};})()");
    assert.equal(layout.buttons.filter(button => button.pressed === "true").length, 1);
    assert.ok(layout.buttons.every(button => button.height >= 44 && button.left >= 0 && button.right <= viewport.width));
    assert.ok(layout.documentWidth <= viewport.width && layout.panelScroll <= layout.panelWidth + 1, `${viewport.name}: no horizontal overflow`);
    checks.push({ name: `layout-${viewport.name}`, ...layout });
    await capture(`ledger-${viewport.name}`);
  }
  await evaluate("document.querySelector('.panel-resume').focus()");
  await press("Tab", "Tab");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "Close quest log", "Keyboard focus wraps inside the ledger");
  await press("Tab", "Tab", 8);
  assert.equal(await evaluate("document.activeElement.classList.contains('panel-resume')"), true);
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Page.reload", { ignoreCache: false });
  await ready();
  await press("KeyJ", "j"); await tracked("borrowed-light");
  await click("Back to the streets");
  await waitFor("document.querySelector('.quest-tracker-copy strong')?.textContent==='Borrowed Light'", "HUD tracks the restored selection");
  checks.push({ name: "reload-and-hud", quest: "borrowed-light" });

  await press("KeyT", "t"); await click("Visit Blue Hour Tea"); await press("KeyE", "e");
  assert.equal(await evaluate("window.__nightfallPerf().interior"), "blue-hour");
  await press("KeyJ", "j");
  await click("Track The Relay Chip"); await tracked("relay-chip");
  const indoorSave = await saved();
  const entrance = await evaluate("window.__nightfall.interiors.active.entrance");
  assert.deepEqual(indoorSave.position, entrance, "Changing tracking indoors saves the actual safe doorway");
  assert.equal(await evaluate("window.__nightfallPerf().interior"), "blue-hour", "Tracking does not exit the room");
  await click("Track The Relay Chip");
  await tracked("relay-chip");
  checks.push({ name: "indoor-save", position: indoorSave.position });
  await evaluate("window.__nightfall.rpg.quests.talk('juno');window.__nightfall.rpg.quests.choose('step-0');window.__nightfall.rpg.quests.close();window.__nightfall.rpg.quests.talk('mara');window.__nightfall.rpg.quests.choose('complete');window.__nightfall.rpg.quests.close()");
  await waitFor("document.querySelector('[data-quest=relay-chip]')?.dataset.status==='complete'", "Completed fixture appears in closed contracts");
  assert.equal(await evaluate("document.querySelector('[data-quest=relay-chip] .quest-track-button')"), null, "Closed contracts have no tracking action");
  await tracked("borrowed-light");
  checks.push({ name: "completed-contract-fallback", quest: "borrowed-light" });
  assert.deepEqual(errors, []);
  await writeFile(resolve(directory, "report.json"), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log("Ledger keyboard selection, responsive controls, immediate saving, reload, indoor return and completion fallback passed.");
} catch (error) {
  console.error(error);
  await writeFile(resolve(directory, "report.json"), JSON.stringify({ passed: false, checks, errors, failure: String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close(); chrome?.kill();
}
