import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Deterministic, human-reviewable scene QA using the browser already installed.
// No screenshots of different camera positions masquerading as comparisons.
const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=") || "true"]; }));
const directory = resolve("artifacts", args.get("out") ?? "visual-audit");
await mkdir(directory, { recursive: true });
const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const path of candidates) { try { await access(path); executable = path; break; } catch { /* Next browser */ } }
if (!executable) throw new Error("Set CHROME_PATH to an installed Chromium browser.");
const port = 9332;
const chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve("artifacts", "visual-browser-profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--enable-webgl", "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
const report = [];
try {
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()); break; } catch { await delay(200); } }
  if (!tabs) throw new Error("Browser did not start");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(), errors = []; let id = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const promise = pending.get(message.id); pending.delete(message.id); clearTimeout(promise.timer);
      if (message.error) promise.reject(Error(JSON.stringify(message.error))); else promise.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(" "));
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const requestId = ++id, timer = setTimeout(() => reject(Error(`Timed out: ${method}`)), 30000);
    pending.set(requestId, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: Number(args.get("dpr") ?? 1), mobile: false });
  const views = (args.get("views") ?? "market,crossing,tenements,foundry,rooftops,platform,carriage").split(",");
  for (const view of views) {
    const params = new URLSearchParams({ studio: "1", view, clock: args.get("clock") ?? "45", clean: "1" });
    if (args.has("reference")) params.set("reference", args.get("reference"));
    const url = `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?${params}`;
    await call("Page.navigate", { url });
    for (let i = 0; i < 100; i++) {
      const phase = await evaluate("document.querySelector('main')?.dataset.phase");
      if (phase === "error") throw Error(await evaluate("document.body.innerText"));
      if (phase === "intro") break;
      await delay(200);
    }
    await delay(Number(args.get("warm") ?? 2500));
    const image = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(directory, `${view}.png`), Buffer.from(image.data, "base64"));
    const metrics = await evaluate("({ fps: document.querySelector('.fps-count')?.textContent, status: [...document.querySelectorAll('.studio-body dl > *')].map(el=>el.textContent).join(' | '), x: document.querySelector('.coordinates')?.dataset.x, z: document.querySelector('.coordinates')?.dataset.z })");
    report.push({ view, url, ...metrics }); console.log(JSON.stringify({ view, ...metrics }));
  }
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  await writeFile(resolve(directory, "index.html"), `<!doctype html><meta charset="utf-8"><title>Nightfall visual audit</title><style>body{margin:32px;background:#0a1317;color:#c5d4ce;font:14px/1.6 system-ui}h1{font-size:24px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0}img{width:100%;image-rendering:auto}a{color:#9ddccd}figcaption{padding:10px 0}details{font:12px monospace;white-space:pre-line}@media(max-width:900px){main{grid-template-columns:1fr}}</style><h1>Nightfall · visual audit</h1><p>Fixed seed, camera and clock. Click a scene to inspect the full-resolution image. <a href="${escape(process.env.CITY_URL ?? "http://127.0.0.1:3000")}/?studio=1">Open scene lab</a></p><main>${report.map(row => `<figure><a href="${row.view}.png"><img src="${row.view}.png" alt="${row.view}"></a><figcaption><strong>${row.view}</strong> · ${row.fps} · <a href="${escape(row.url.replace("clean=1", "clean=0"))}">Inspect this camera</a><details><summary>Scene metrics</summary>${escape(row.status ?? "")}</details></figcaption></figure>`).join("")}</main>`);
  console.log(`Gallery: ${resolve(directory, "index.html")}`);
} finally { socket?.close(); chrome.kill(); }
