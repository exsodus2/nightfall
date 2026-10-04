import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const directory = resolve("artifacts", "startup");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const port = 9351;
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
  const waitFor = async (expression, message, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(100); }
    throw Error(`${message}: ${JSON.stringify(await evaluate("({phase:document.querySelector('main')?.dataset.phase,stage:document.querySelector('[data-boot-stage]')?.dataset.bootStage,text:document.querySelector('[role=alert]')?.textContent})"))}`);
  };
  const capture = async name => {
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${name}.png`), Buffer.from(screenshot.data, "base64"));
  };
  const click = label => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(element => element.textContent.trim().startsWith(${JSON.stringify(label)})); if (!button) throw Error('Missing button: '+${JSON.stringify(label)}); button.click(); })()`);
  const state = () => evaluate("({phase:document.querySelector('main')?.dataset.phase,stage:document.querySelector('[data-boot-stage]')?.dataset.bootStage??null,canvases:window.qaStartup.canvases.length,lateBuffers:window.qaStartup.lateBuffers,radioSame:!window.qaStartup.radio||document.querySelector('section[aria-label=Radio]')===window.qaStartup.radio,unhandled:window.qaStartup.unhandled,history:window.qaStartup.history})");
  const loseCurrent = async () => {
    await evaluate("window.qaStartup.loss=document.querySelector('.city-canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); if(!window.qaStartup.loss)throw Error('Missing WEBGL_lose_context'); window.qaStartup.loss.loseContext()");
    await waitFor("document.querySelector('main')?.dataset.phase==='lost'", "Context loss surface");
  };
  const waitRebuilt = async message => {
    await waitFor("document.querySelector('main')?.dataset.phase==='paused' && window.__nightfall?.t.canvas===document.querySelector('.city-canvas')", message, 180000);
    await evaluate("document.querySelector('.scene-studio').style.display='none'");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.city-canvas')).visibility"), "visible", "The rebuilt city canvas becomes visible");
    assert.equal((await state()).radioSame, true, "Radio shell remains mounted across recovery");
  };

  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `
    try { localStorage.clear(); } catch {}
    window.qaStartup={canvases:[],history:[],unhandled:[],holds:[],holdNext:false,retired:new Set(),lateBuffers:0};
    window.addEventListener('unhandledrejection',event=>window.qaStartup.unhandled.push(String(event.reason)));
    new MutationObserver(()=>{
      const audit=window.qaStartup,canvas=document.querySelector('.city-canvas');
      if(canvas&&!audit.canvases.includes(canvas))audit.canvases.push(canvas);
      const entry={phase:document.querySelector('main')?.dataset.phase??null,stage:document.querySelector('[data-boot-stage]')?.dataset.bootStage??null,canvas:audit.canvases.length};
      if(JSON.stringify(entry)!==JSON.stringify(audit.history.at(-1)))audit.history.push(entry);
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-phase','data-boot-stage']});
  ` });
  await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&clock=4&perf=1` });
  console.log("Checking first-load stages and normal startup...");
  await waitFor("document.querySelector('main')?.dataset.phase==='intro' && !!window.__nightfall", "Initial renderer ready", 180000);
  await evaluate("document.querySelector('.scene-studio').style.display='none'");
  const initial = await state();
  assert.equal(initial.canvases, 1);
  const stages = initial.history.filter(entry => entry.stage).map(entry => entry.stage);
  assert.ok(stages.includes("opening") && stages.includes("materials"), JSON.stringify(stages));
  assert.ok(stages.every(stage => ["opening", "materials", "scene", "glyphs"].includes(stage)));
  report.push({ name: "first-load", ...initial });
  await evaluate(`(() => {
    window.qaStartup.radio=document.querySelector('section[aria-label=Radio]');
    if(!window.qaStartup.radio)throw Error('Missing radio shell');
    const prototype=Object.getPrototypeOf(window.__nightfall.t),original=prototype.createShader;
    prototype.createShader=async function(vertex,fragment){
      const shader=await original.call(this,vertex,fragment);
      if(window.qaStartup.holdNext&&vertex.includes('a_axisX')){
        window.qaStartup.holdNext=false;
        const hold={renderer:this,canvas:this.canvas,released:false};
        window.qaStartup.holds.push(hold);
        await new Promise(resolve=>{hold.release=()=>{hold.released=true;resolve();};});
      }
      return shader;
    };
    const createBuffer=WebGL2RenderingContext.prototype.createBuffer;
    WebGL2RenderingContext.prototype.createBuffer=function(){
      if(window.qaStartup.retired.has(this.canvas))window.qaStartup.lateBuffers++;
      return createBuffer.call(this);
    };
    window.qaStartup.holdNext=true;
  })()`);
  await loseCurrent();
  await evaluate("(() => { const button=[...document.querySelectorAll('button')].find(element=>element.textContent.startsWith('Rebuild the city')); if(!button)throw Error('Missing rebuild'); button.click(); button.click(); button.click(); window.qaStartup.loss.restoreContext(); })()");
  await waitFor("window.qaStartup.holds.length===1", "Delayed next boot reaches prop shader", 180000);
  assert.equal((await state()).phase, "loading");
  assert.equal((await state()).stage, "scene");
  assert.equal((await state()).radioSame, true, "Rebuild loading preserves the original radio component");
  assert.equal((await state()).canvases, 2, "Repeated manual clicks and automatic restoration share one rebuild");
  assert.equal(await evaluate("document.documentElement.dataset.sceneClean='true'; getComputedStyle(document.querySelector('.loading-state')).visibility"), "visible", "Clean studio mode keeps loading status visible");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.scene-studio')).visibility"), "hidden", "Inspection tools cannot obscure startup status");
  await evaluate("document.documentElement.dataset.sceneClean='false'");
  for (const viewport of [{ name: "desktop", width: 1440, height: 960 }, { name: "portrait", width: 393, height: 852 }, { name: "compact", width: 480, height: 320 }]) {
    await call("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    await delay(350);
    const bounds = await evaluate("(() => { const element=document.querySelector('.loading-state'); if(!element)throw Error('Missing loading surface'); const box=element.getBoundingClientRect(); return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height,viewportWidth:innerWidth,viewportHeight:innerHeight,documentWidth:document.documentElement.scrollWidth,headerBottom:Math.max(document.querySelector('.city-header').getBoundingClientRect().bottom,document.querySelector('.location-strip').getBoundingClientRect().bottom),footerTop:document.querySelector('.city-footer').getBoundingClientRect().top,canvasVisibility:getComputedStyle(document.querySelector('.city-canvas')).visibility,stage:element.dataset.bootStage,text:element.textContent}; })()");
    assert.ok(bounds.width > 0 && bounds.height > 0);
    assert.ok(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= bounds.viewportWidth + 1 && bounds.bottom <= bounds.viewportHeight + 1, `${viewport.name}: loading bounds ${JSON.stringify(bounds)}`);
    assert.ok(bounds.documentWidth <= bounds.viewportWidth + 1, `${viewport.name}: no horizontal overflow`);
    assert.ok(bounds.top >= bounds.headerBottom && bounds.bottom <= bounds.footerTop, `${viewport.name}: loading status clears header and footer`);
    assert.equal(bounds.canvasVisibility, "hidden", `${viewport.name}: native loading text cannot overlap the status screen`);
    assert.equal(bounds.stage, "scene");
    report.push({ name: `loading-${viewport.name}`, ...bounds });
    await capture(`loading-${viewport.name}`);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

  console.log("Losing a context before readiness, then releasing its delayed shader...");
  await loseCurrent();
  assert.equal(await evaluate("document.documentElement.dataset.sceneClean='true'; getComputedStyle(document.querySelector('.error-state')).visibility"), "visible", "Clean studio mode keeps recovery controls visible");
  await evaluate("document.documentElement.dataset.sceneClean='false'");
  await evaluate("window.qaStartup.retired.add(window.qaStartup.holds[0].canvas); window.qaStartup.holds[0].release()");
  await delay(500);
  const lostDuringBoot = await state();
  assert.equal(lostDuringBoot.phase, "lost", "Retired setup cannot report ready or error over a context-loss screen");
  assert.equal(lostDuringBoot.radioSame, true);
  assert.equal(lostDuringBoot.lateBuffers, 0, "Lost setup allocates no prop buffers after its await resumes");
  assert.equal(await evaluate("window.qaStartup.holds[0].renderer.isLooping()"), false, "Interrupted setup cannot leave the default renderer loop running");
  await capture("lost-during-startup");
  await evaluate("window.qaStartup.loss.restoreContext()");
  await waitRebuilt("Automatic recovery after interrupted startup");
  assert.equal((await state()).canvases, 3);
  report.push({ name: "loss-during-setup", ...lostDuringBoot });

  console.log("Replacing a still-pending boot, then releasing the disposed generation...");
  await evaluate("window.qaStartup.holdNext=true");
  await loseCurrent(); await click("Rebuild the city");
  await waitFor("window.qaStartup.holds.length===2", "Second delayed prop shader", 180000);
  await loseCurrent();
  await evaluate("window.qaStartup.retired.add(window.qaStartup.holds[1].canvas)");
  await click("Rebuild the city"); await waitRebuilt("Manual replacement of a pending setup");
  assert.equal(await evaluate("window.qaStartup.holds[1].renderer.isDisposed"), true);
  const replacement = await state();
  await evaluate("window.qaStartup.holds[1].release()");
  await delay(500);
  const afterRelease = await state();
  assert.equal(afterRelease.phase, "paused");
  assert.equal(afterRelease.canvases, replacement.canvases, "Stale setup never starts another boot");
  assert.equal(afterRelease.lateBuffers, 0, "Disposed setup allocates no late prop buffers");
  report.push({ name: "dispose-during-setup", ...afterRelease });

  console.log("Rejecting a runtime atlas load after graphics loss...");
  await evaluate("window.__nightfall.t.loadTileset=function(){return new Promise((resolve,reject)=>{window.qaStartup.rejectAtlas=reject;});}");
  await click("Settings"); await click("Balanced");
  await waitFor("typeof window.qaStartup.rejectAtlas==='function'", "Runtime quality change starts atlas load");
  await loseCurrent();
  await evaluate("window.qaStartup.rejectAtlas(Error('QA retired atlas rejection'))");
  await delay(500);
  const lostAtlas = await state();
  assert.equal(lostAtlas.phase, "lost", "Retired atlas errors cannot replace the recovery screen");
  assert.equal(lostAtlas.radioSame, true);
  assert.deepEqual(lostAtlas.unhandled, []);
  await evaluate("window.qaStartup.loss.restoreContext()");
  await waitRebuilt("Automatic recovery after runtime atlas rejection");
  report.push({ name: "rejected-retired-atlas", ...lostAtlas });
  await capture("recovered");

  console.log("Checking live atlas failures still reach the error surface...");
  await evaluate("window.__nightfall.t.loadTileset=function(){return Promise.reject(Error('QA live atlas rejection'));}");
  await click("Settings"); await click("Performance");
  await waitFor("document.querySelector('main')?.dataset.phase==='error'", "Live atlas rejection is reported");
  assert.ok((await evaluate("document.querySelector('[role=alert]')?.textContent")).includes("QA live atlas rejection"));
  assert.deepEqual((await state()).unhandled, []);
  assert.deepEqual(errors, [], "No unhandled browser errors during startup/recovery");
  report.push({ name: "live-atlas-error", ...(await state()) });
  await writeFile(resolve(directory, "report.json"), JSON.stringify({ report, errors }, null, 2));
  console.log("Startup stages, mobile loading bounds, single-flight rebuilds, delayed setup retirement and atlas error handling passed.");
} catch (error) {
  console.error(error); if (errors.length) console.error(errors.join("\n"));
  await writeFile(resolve(directory, "report.json"), JSON.stringify({ report, errors, failure: String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close(); chrome.kill();
}
