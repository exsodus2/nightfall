import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CityWorld } from "../src/city/world.ts";
import { raycastWorld } from "../src/rpg/combat/raycast.ts";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { cityMaterial } = await import("../src/city/materials.ts");
const args = new Map(process.argv.slice(2).map(argument => { const [key, ...value] = argument.replace(/^--/, "").split("="); return [key, value.join("=") || "true"]; }));
const phase = args.get("phase") ?? "current", directory = resolve("artifacts", "glass", phase);
await mkdir(directory, { recursive: true });
const world = new CityWorld(), styles = (args.get("styles") ?? "0,1,2,3,4,5,6,7").split(",").map(Number);
const names = ["brick", "megablock", "office", "industrial", "terraced", "market", "balcony", "signal"];
const spacing = [[2.8, 4.2], [4.8, 6.4], [2.4, 3.6], [7, 8.8], [3.4, 4.8], [5.2, 5.5], [2.8, 4.2], [2.1, 6.7]];
const normals = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
const fixtures = [];
for (const style of styles) {
  assert.ok(Number.isInteger(style) && style >= 0 && style < 8);
  let fixture;
  for (const building of world.buildings.filter(candidate => candidate.style === style && candidate.height > 45).sort((first, second) => Math.hypot(first.x, first.z) - Math.hypot(second.x, second.z))) {
    for (const normal of normals) {
      const tangent = normal.x ? { x: 0, z: 1 } : { x: 1, z: 0 };
      const scale = style === 4 || style === 7 ? 0.5 : style === 1 && normal.x ? 0.485 : 0.465;
      const target = { x: building.x + normal.x * building.width * scale, z: building.z + normal.z * building.depth * scale };
      const horizontal = normal.x ? building.z : building.x, span = spacing[style][0], center = style === 1 ? 0.53 : style === 2 ? 0.5 : 0.48;
      let along = (Math.floor(horizontal / span) + center) * span;
      if (style === 7) {
        const candidates = [-2, -1, 0, 1, 2].map(offset => along + offset * span).filter(value => { const stripe = (value / 14 % 1 + 1) % 1; return stripe > 0.2 && stripe < 0.72; });
        if (!candidates.length) continue;
        along = candidates.sort((first, second) => Math.abs(first - horizontal) - Math.abs(second - horizontal))[0];
      }
      target.x += tangent.x * (along - horizontal); target.z += tangent.z * (along - horizontal);
      const height = (Math.floor(16 / spacing[style][1]) + (style === 2 ? 0.52 : style === 3 ? 0.64 : 0.475)) * spacing[style][1];
      const pose = (distance, slide) => {
        const x = target.x + normal.x * distance + tangent.x * slide, z = target.z + normal.z * distance + tangent.z * slide;
        return { x, z, height, yaw: Math.atan2(target.x - x, -(target.z - z)), pitch: 0 };
      };
      const cameras = { near: pose(4, 0), far: pose(44, 0), grazing: pose(4, 12), "grazing-far": pose(16, 48) };
      if (Object.values(cameras).every(camera => {
        const distance = Math.hypot(target.x - camera.x, target.z - camera.z);
        return Math.abs(camera.x) < 763 && Math.abs(camera.z) < 763 && raycastWorld(world, { x: camera.x, y: height, z: camera.z }, { x: (target.x - camera.x) / distance, y: 0, z: (target.z - camera.z) / distance }, distance + 1)?.building === building.id;
      })) { fixture = { style, family: names[style], building, target, normal, cameras }; break; }
    }
    if (fixture) break;
  }
  assert.ok(fixture, `Family ${style} needs an unobstructed front/grazing fixture`);
  fixtures.push(fixture);
}
const source = await readFile(resolve("src/city/materials.ts"), "utf8"), digest = value => createHash("sha256").update(value).digest("hex");
const variants = { main: { reflections: true }, reflection: { ground: false }, props: { batch: true, ground: false }, architecture: { batch: true, opaque: true, architecture: true } };
const shaders = Object.fromEntries([false, true].flatMap(lite => Object.entries(variants).map(([name, options]) => {
  const shader = cityMaterial({ ...options, lite });
  return [`${lite ? "lite" : "full"}-${name}`, { sha256: digest(shader), bytes: Buffer.byteLength(shader), textureCalls: (shader.match(/\b(?:texelFetch|texture)\s*\(/g) ?? []).length, loops: (shader.match(/\bfor\s*\(/g) ?? []).length }];
})));
const metadata = { phase, generated: new Date().toISOString(), materialSha256: digest(source), shaders, fixtures, deviceNote: "Phone cases exercise Chromium touch/LITE profiles on the local desktop GPU; timings are not real-phone performance." };
await writeFile(resolve(directory, "manifest.json"), JSON.stringify(metadata, null, 2));
if (args.has("prepare")) { console.log(`Prepared ${fixtures.length} facade families at ${directory}`); process.exit(0); }
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw Error("Set CHROME_PATH to an installed Chromium browser.");
const port = 9348;
const chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve("artifacts", "glass", "browser-profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--enable-webgl", ...(args.has("software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []), "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
const report = [], errors = [], failures = [];
try {
  let tabs;
  for (let attempt = 0; attempt < 60; attempt++) { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()); break; } catch { await delay(200); } }
  if (!tabs) throw Error("Test browser did not start");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(); let sequence = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map(argument => argument.value ?? argument.description).join(" "));
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 180000);
    pending.set(id, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  const waitFor = async (expression, message, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(80); }
    throw Error(message);
  };
  const waitFrames = async (count = 4) => {
    const frame = await evaluate("window.__nightfall.t.frameCount");
    await waitFor(`window.__nightfall.t.frameCount >= ${frame + count}`, "Renderer did not advance");
  };
  const camera = async pose => { await evaluate(`window.__nightfall.inspect(${JSON.stringify({ kind: "camera", ...pose })})`); await waitFrames(); };
  const sample = async save => evaluate(`(() => {
    const frame = window.__nightfall.t.layers.base.drawFramebuffer;
    if (!frame) throw Error('Missing cell framebuffer');
    const attachments = [0,1,2].map(index => frame.readPixels(index));
    const previous = window.__glassPixels;
    const stats = attachments.map((pixels, attachment) => {
      let hash = 2166136261, changed = 0, magnitude = 0, sum = 0, count = 0;
      for (let row = Math.floor(frame.height * .2); row < Math.ceil(frame.height * .8); row++) for (let column = Math.floor(frame.width * .2); column < Math.ceil(frame.width * .8); column++) {
        for (let channel = 0; channel < 3; channel++) {
          const offset = (row * frame.width + column) * 4 + channel, value = pixels[offset];
          hash = Math.imul(hash ^ value, 16777619); sum += value; count++;
          if (previous && previous[attachment][offset] !== value) { changed++; magnitude += Math.abs(previous[attachment][offset] - value); }
        }
      }
      return { hash:(hash >>> 0).toString(16), changed, changedRatio:changed / count, meanDelta:magnitude / count, mean:sum / count, samples:count };
    });
    if (${save}) window.__glassPixels = attachments;
    return { columns:frame.width, rows:frame.height, attachments:stats };
  })()`);
  await call("Page.enable"); await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.clear()" });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const profiles = (args.get("profiles") ?? "desktop,phone").split(",");
  for (const profile of profiles) {
    assert.ok(profile === "desktop" || profile === "phone");
    const phone = profile === "phone";
    await call("Emulation.setDeviceMetricsOverride", { width: phone ? 844 : 1440, height: phone ? 390 : 960, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
    await call("Emulation.setTouchEmulationEnabled", { enabled: phone, maxTouchPoints: phone ? 5 : 1 });
    console.log(`Loading ${profile} glass baseline and compiling shaders...`);
    const started = performance.now();
    await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&clock=4&clean=1&perf=1` });
    await waitFor("document.querySelector('main')?.dataset.phase === 'intro' && !!window.__nightfall", "City renderer did not become ready", 180000);
    const startupMs = Math.round(performance.now() - started);
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith('Settings')).click()");
    await waitFor("!!document.querySelector('[aria-label=\"Detail level\"]')", "Settings did not open");
    await evaluate(`[...document.querySelectorAll('[aria-label="Detail level"] button')].find(button => button.textContent === ${JSON.stringify(phone ? "Performance" : "Fine")}).click(); document.querySelector('[aria-label="Close panel"]').click()`);
    await delay(2200);
    assert.equal(await evaluate("window.__nightfallPerf().lite"), phone, "The intended compiled quality family is active");
    for (const fixture of fixtures) for (const [view, pose] of Object.entries(fixture.cameras)) {
      const name = `${profile}-${fixture.family}-${view}`;
      await camera(pose); await delay(350);
      const metrics = await evaluate("window.__nightfallPerf()");
      const baseline = await sample(true); await waitFrames(5);
      const stationary = await sample(false);
      await camera({ ...pose, yaw: pose.yaw + 0.003 });
      const moved = await sample(false);
      await camera(pose);
      const returned = await sample(false);
      const image = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(resolve(directory, `${name}.png`), Buffer.from(image.data, "base64"));
      const row = { name, profile, style: fixture.style, view, pose, startupMs, metrics, baseline, stationary, moved, returned };
      report.push(row);
      for (const [stage, sampled] of [["stationary", stationary], ["returned", returned]]) if (sampled.attachments.some(attachment => attachment.meanDelta > 0.3)) failures.push(`${name}: ${stage} cell data drift exceeds 0.3/255: ${JSON.stringify(sampled.attachments)}`);
      console.log(JSON.stringify({ name, fps: metrics.fps, cpuMs: metrics.cpuMs, grid: metrics.grid, stability: returned.attachments.map(attachment => attachment.meanDelta), motion: moved.attachments.map(attachment => attachment.meanDelta) }));
    }
  }
  assert.deepEqual(errors, [], "No shader or browser runtime errors");
  assert.deepEqual(failures, [], "Stationary and returned-camera glass stay stable");
  console.log(`Glass checks passed: ${report.length} fixed-camera captures at ${directory}`);
} finally {
  await writeFile(resolve(directory, "report.json"), JSON.stringify({ ...metadata, report, errors, failures }, null, 2));
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  await writeFile(resolve(directory, "index.html"), `<!doctype html><meta charset="utf-8"><title>Facade glass ${escape(phase)}</title><style>body{background:#091218;color:#cee0d9;font:14px/1.6 monospace;margin:24px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}img{width:100%}a{color:inherit}</style><h1>Facade glass: ${escape(phase)}</h1><p>${escape(metadata.deviceNote)}</p><main>${report.map(row => `<figure><a href="${row.name}.png"><img src="${row.name}.png" alt="${row.name}"></a><figcaption>${row.name} · ${row.metrics.fps} local fps · ${row.metrics.cpuMs} ms callback</figcaption></figure>`).join("")}</main>`);
  socket?.close(); chrome.kill();
}
