import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Trailer capture: a headless Chrome on the real renderer, driven over the DevTools protocol, with a
// virtual clock so every captured frame advances the game by exactly 1/fps seconds no matter how long
// the capture itself takes. No dependencies.

// Installed before the page's own scripts. Until `__trailerClock.manual()` the page runs on real time;
// afterwards performance.now() and requestAnimationFrame only move when `__trailerClock.advance(ms)`
// is called, which runs one animation frame at the new virtual timestamp.
const VIRTUAL_CLOCK = `(() => {
  const realNow = performance.now.bind(performance), realRaf = requestAnimationFrame.bind(window), realCancel = cancelAnimationFrame.bind(window);
  let manual = false, now = 0, nextId = 1e9; const queue = new Map();
  performance.now = () => manual ? now : realNow();
  window.requestAnimationFrame = callback => { if (!manual) return realRaf(callback); const id = nextId++; queue.set(id, callback); return id; };
  window.cancelAnimationFrame = id => { if (queue.has(id)) queue.delete(id); else realCancel(id); };
  const presented = () => new Promise(done => realRaf(() => realRaf(done)));
  window.__trailerClock = {
    manual() { if (!manual) { now = realNow(); manual = true; } },
    get now() { return now; },
    async advance(ms) {
      now += ms; const due = [...queue.values()]; queue.clear();
      for (const callback of due) callback(now);
      await presented();
    },
  };
})();`;

export async function launch({ width = 1920, height = 1080, dpr = 1, port = 9377 } = {}) {
  const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch { /* next */ } }
  if (!executable) throw new Error("Set CHROME_PATH to an installed Chromium browser.");
  const chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve("artifacts", `trailer-profile-${port}`)}`, "--no-first-run", "--no-default-browser-check", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--hide-scrollbars", "--mute-audio", `--window-size=${width},${height}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let tabs;
  for (let i = 0; i < 80; i++) { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()); break; } catch { await delay(200); } }
  if (!tabs) { chrome.kill(); throw new Error("Browser did not start"); }
  const socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(); let id = 0;
  socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); const request = pending.get(message.id); if (!request) return; pending.delete(message.id); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); });
  const call = (method, params = {}) => new Promise((done, reject) => { const requestId = ++id; pending.set(requestId, { resolve: done, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); setTimeout(() => reject(Error(`Timed out: ${method}`)), 120000); });
  const evaluate = async expression => { const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: VIRTUAL_CLOCK });
  const close = () => { try { socket.close(); } catch { /* closed */ } chrome.kill(); };
  return { call, evaluate, close };
}

/** Opens the city in the studio (clean, frozen, ready) and waits until the renderer is up. */
export async function openCity(browser, { query = "", base = process.env.CITY_URL ?? "http://127.0.0.1:3000", warm = 4000 } = {}) {
  await browser.call("Page.navigate", { url: `${base}/?studio=1&clean=1&view=market&clock=45${query ? `&${query}` : ""}` });
  for (let i = 0; i < 600; i++) {
    const phase = await browser.evaluate("document.querySelector('main')?.dataset.phase").catch(() => null);
    if (phase === "error") throw Error(await browser.evaluate("document.body.innerText"));
    if (phase === "intro" && await browser.evaluate("!!window.__nightfall")) break;
    await delay(200);
  }
  await delay(warm);
}

export async function screenshot(browser) {
  const image = await browser.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  return Buffer.from(image.data, "base64");
}
