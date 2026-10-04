import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const directory = resolve("artifacts", "hud");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const port = 9347;
const chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(directory, "browser-profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", ...(process.argv.includes("--software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []), "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
const errors = [], report = [], failures = [];
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
    const message = JSON.parse(data), request = pending.get(message.id);
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
  const waitFor = async (expression, message, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(100); }
    throw Error(message);
  };
  const key = async (code, value, duration = 60) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", code, key: value });
    await delay(duration);
    await call("Input.dispatchKeyEvent", { type: "keyUp", code, key: value });
  };
  const capture = async name => {
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(screenshot.data, "base64"));
  };
  const instrument = async () => evaluate(`(() => {
    const textmode = window.__nightfall.t, hud = textmode.layers.all.at(-1);
    const print = textmode.print, align = textmode.printAlign;
    let horizontal = 'left', vertical = 'top', rows = [];
    window.__hudAudit = { rows: [], frames: 0 };
    textmode.printAlign = function(nextHorizontal, nextVertical) { horizontal = nextHorizontal; vertical = nextVertical ?? vertical; return align.apply(this, arguments); };
    textmode.print = function(value, column, row) {
      if (textmode.grid === hud.grid) rows.push({ text:value, column, row, horizontal, vertical });
      return print.apply(this, arguments);
    };
    hud.postDraw(() => {
      const grid = hud.grid;
      window.__hudAudit = { rows, frames:window.__hudAudit.frames + 1, cols:grid.cols, lines:grid.rows, cellWidth:grid.cellWidth, cellHeight:grid.cellHeight, gridWidth:grid.width, gridHeight:grid.height, offsetX:grid.offsetX, offsetY:grid.offsetY };
      rows = [];
    });
  })()`);
  const load = async clean => {
    console.log(`Loading ${clean ? 'clean studio' : 'combat HUD'} and compiling shaders...`);
    await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&clock=4&perf=1&rpgtest=1${clean ? "&clean=1" : ""}` });
    await waitFor("document.querySelector('main')?.dataset.phase === 'intro' && !!window.__nightfall", "Renderer did not become ready", 180000);
    await evaluate("document.querySelector('.scene-studio').style.display = 'none'; [...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith('Enter the city')).click()");
    await waitFor("document.querySelector('main')?.dataset.phase === 'playing'", "City did not enter play");
    await instrument();
  };
  const readyBoss = async () => {
    await evaluate("window.__nightfall.inspect({kind:'camera',x:64,z:112,height:2.7,yaw:Math.PI,pitch:0}); window.__nightfall.rpg.combat.spawnEncounter('combat-test-boss'); window.__nightfall.inspect({kind:'freeze',value:false})");
    await key("Digit2", "2");
    await waitFor("window.__nightfall.rpg.playerView().weaponClass === 'pistol'", "Starting pistol was not selected");
    await evaluate("(() => { const boss = window.__nightfall.rpg.enemies({x:64,z:132},80).find(enemy => enemy.boss); if (!boss) throw Error('Missing authored test boss'); window.__nightfall.rpg.combat.damageEnemy(boss.id,1); })()");
    await waitFor("!!window.__nightfall.rpg.combat.boss()", "Authored boss never engaged");
    await evaluate("window.__nightfall.inspect({kind:'freeze',value:true})");
    await waitFor("window.__hudAudit.rows.some(row => row.text.includes('BRAKKA')) && window.__hudAudit.rows.some(row => row.text.startsWith('HP '))", "Native combat HUD did not draw");
    await delay(250);
    const alert = await evaluate("({bark:window.__nightfall.rpg.enemies({x:64,z:132},80).find(enemy => enemy.boss)?.bark,feed:window.__nightfall.rpg.snapshot().feed.map(entry => entry.text),toasts:[...document.querySelectorAll('.quest-toast-message')].map(element => element.textContent),native:window.__hudAudit.rows.some(row => row.text.includes('FRESH MEAT!'))})");
    assert.equal(alert.bark, "FRESH MEAT!", "Initial boss alert retains its native bark");
    assert.ok(alert.native, "Initial boss bark is drawn above the enemy");
    assert.ok(!alert.feed.includes("Brakka: FRESH MEAT!"), "Routine boss bark does not duplicate into the RPG feed");
    assert.ok(!alert.toasts.includes("Brakka: FRESH MEAT!"), "Routine boss bark does not obscure the HUD with a toast");
    report.push({ name:"boss-alert", ...alert });
  };
  const measure = async name => {
    const result = await evaluate(String.raw`(() => {
      const audit = window.__hudAudit;
      const rectangle = element => { const bounds = element.getBoundingClientRect(); return { left:bounds.left, top:bounds.top, right:bounds.right, bottom:bounds.bottom }; };
      const selectors = ['.city-header','.location-strip','.city-footer','.walking-hint','.navigation-widget','.quest-hud','.quest-toast','[data-touch-action]','[class*="stickHint"]'];
      const obstacles = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(element => { const style = getComputedStyle(element), bounds = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && bounds.width > 0 && bounds.height > 0; }).map(element => ({ selector, label:element.getAttribute('data-touch-action') ?? element.textContent.trim().slice(0,50), ...rectangle(element) })));
      const textBounds = row => {
        const leftColumn = row.column - (row.horizontal === 'right' ? row.text.length : row.horizontal === 'center' ? Math.floor(row.text.length / 2) : 0);
        const left = (leftColumn + Math.floor(audit.cols / 2)) * innerWidth / audit.cols;
        const top = (row.row + Math.floor(audit.lines / 2)) * innerHeight / audit.lines;
        return { ...row, left, top, right:left + row.text.length * innerWidth / audit.cols, bottom:top + innerHeight / audit.lines };
      };
      const rows = audit.rows.filter(row => row.vertical === 'top' && (row.text.startsWith('HP ') || row.text.startsWith('ST ') || row.text.includes('BRAKKA') || row.text.includes('CARET') || /^\d+ \/ \d+/.test(row.text) || /^\[#+/.test(row.text) || /^[*@o ]+$/.test(row.text))).map(textBounds);
      const projected = audit.rows.filter(row => row.vertical === 'middle').map(textBounds);
      return { width:innerWidth, height:innerHeight, touch:matchMedia('(pointer:coarse)').matches, phase:document.querySelector('main').dataset.phase, place:window.__nightfall.interiors.active?.id ?? null, player:window.__nightfall.rpg.playerView(), boss:window.__nightfall.rpg.combat.boss(), audit, rows, projected, obstacles, perf:window.__nightfallPerf() };
    })()`);
    const overlaps = (first, second) => Math.min(first.right, second.right) > Math.max(first.left, second.left) + 1 && Math.min(first.bottom, second.bottom) > Math.max(first.top, second.top) + 1;
    assert.equal(result.place, null, `${name}: HUD is measured outdoors`);
    assert.ok(result.rows.some(row => row.text.startsWith('HP ')), `${name}: HP is drawn`);
    assert.ok(result.rows.some(row => /^\d+ \/ \d+/.test(row.text)), `${name}: numeric ammo is drawn`);
    assert.ok(result.rows.some(row => row.text.includes('BRAKKA')), `${name}: boss is drawn`);
    if (name !== "compact") assert.ok(result.projected.some(row => row.text.includes("FRESH MEAT!")), `${name}: non-conflicting native bark remains visible`);
    for (const row of result.rows) {
      if (row.left < -1 || row.top < -1 || row.right > result.width + 1 || row.bottom > result.height + 1) failures.push(`${name}: offscreen ${JSON.stringify(row)}`);
      for (const obstacle of result.obstacles) if (overlaps(row, obstacle)) failures.push(`${name}: ${row.text} overlaps ${obstacle.selector} ${obstacle.label}: ${JSON.stringify({ row, obstacle })}`);
    }
    for (let index = 0; index < result.rows.length; index++) for (const other of result.rows.slice(index + 1)) if (overlaps(result.rows[index], other)) failures.push(`${name}: native HUD rows overlap ${result.rows[index].text} and ${other.text}`);
    for (const label of result.projected) for (const row of result.rows) if (overlaps(label, row)) failures.push(`${name}: projected ${label.text} obscures persistent ${row.text}: ${JSON.stringify({ label, row })}`);
    report.push({ name, ...result });
    console.log(JSON.stringify({ name, grid: [result.audit.cols, result.audit.lines], rows:result.rows, projected:result.projected, failures:failures.filter(value => value.startsWith(name)) }));
    await capture(name);
  };
  await call("Page.enable"); await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.clear()" });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Emulation.setDeviceMetricsOverride", { width:1440, height:960, deviceScaleFactor:1, mobile:false });
  await call("Emulation.setTouchEmulationEnabled", { enabled:false });
  await load(false); await readyBoss();
  for (const viewport of [
    { name:"desktop", width:1440, height:960, scale:1, touch:false },
    { name:"portrait", width:393, height:852, scale:2, touch:true },
    { name:"landscape", width:852, height:393, scale:2, touch:true },
    { name:"compact", width:480, height:320, scale:1, touch:true },
  ]) {
    console.log(`Checking ${viewport.name} ${viewport.width}x${viewport.height}...`);
    await call("Emulation.setDeviceMetricsOverride", { width:viewport.width, height:viewport.height, deviceScaleFactor:viewport.scale, mobile:viewport.touch });
    await call("Emulation.setTouchEmulationEnabled", { enabled:viewport.touch, maxTouchPoints:viewport.touch ? 5 : 1 });
    const frame = await evaluate("window.__hudAudit.frames");
    await waitFor(`window.__hudAudit.frames > ${frame + 2} && matchMedia('(pointer:coarse)').matches === ${viewport.touch}`, "Viewport resize did not finish");
    await delay(350); await measure(viewport.name);
  }
  await call("Emulation.setDeviceMetricsOverride", { width:1440, height:960, deviceScaleFactor:1, mobile:false });
  await call("Emulation.setTouchEmulationEnabled", { enabled:false });
  await load(true);
  await waitFor("window.__hudAudit.frames >= 3", "Clean HUD did not complete a frame");
  const clean = await evaluate("({rows:window.__hudAudit.rows,frames:window.__hudAudit.frames,layers:window.__nightfall.t.layers.all.length,phase:document.querySelector('main').dataset.phase})");
  assert.equal(clean.rows.length, 0, "studio clean=1 suppresses native HUD submissions");
  report.push({ name:"studio-clean", ...clean }); await capture("studio-clean");
  assert.deepEqual(errors, [], "No browser runtime errors");
  assert.deepEqual(failures, [], "Persistent native HUD stays clear of DOM controls and other HUD rows");
  console.log("HUD browser checks passed.");
} finally {
  await writeFile(resolve(directory, "report.json"), JSON.stringify({ report, errors, failures }, null, 2));
  socket?.close(); chrome.kill();
}
