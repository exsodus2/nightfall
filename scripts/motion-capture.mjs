import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import zlib from "node:zlib";

// Motion QA: moves the studio camera along a scripted path one exact step per frame, captures
// every frame, and writes (1) an animated GIF to watch, (2) a contact sheet, (3) a shimmer
// heatmap of pixels that flip back and forth between consecutive frames, and (4) metrics.
// Needs the dev server and an installed Chrome/Edge; no dependencies.
//   npm run audit:motion -- --path=walk --frames=40 --clip=360,240,720,480
const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=") || "true"]; }));
const pathName = args.get("path") ?? "walk";
const frames = Number(args.get("frames") ?? 36);
const fps = Number(args.get("fps") ?? 20);
const clip = args.get("clip")?.split(",").map(Number);
const out = resolve("artifacts", args.get("out") ?? "motion", pathName);
await mkdir(out, { recursive: true });

// Camera paths: x, height, z, yaw, pitch as functions of t in [0, 1]. Speeds match play: walking
// 8 m/s, turning ~70 deg/s, flight 32 m/s, at the chosen fps.
const seconds = frames / fps;
const PATHS = {
  walk: t => [11.5, 2.7, 77 - 8 * seconds * t, -0.1, -0.035],
  sprint: t => [11.5, 2.7, 77 - 18 * seconds * t, -0.1, -0.035],
  turn: t => [-12, 2.7, 12, 0.2 + 1.2 * seconds * t, -0.035],
  strafe: t => [-40 + 8 * seconds * t, 2.7, 150, 0.48, -0.1],
  flight: t => [85, 128, 150 - 32 * seconds * t, -0.38, 0.1],
  approach: t => [11.5, 2.7, 260 - 18 * seconds * t, 0.0, 0.02],
  // Sub-cell yaw steps (use --step=0): checks that turning glides in pixels rather than jumping.
  slowturn: t => [-12, 2.7, 12, 0.2 + 0.35 * seconds * t, -0.035],
  awning: t => [62, 2.7, -55, -1.9 + 0.9 * t, -0.02], // a shopfront awning at the left edge of the view (culling regression)
  micropitch: t => [-12, 2.7, 12, 0.2, -0.035 + 0.0024 * (frames - 1) * t],
  micro: t => [-12, 2.7, 12, 0.2 + 0.0024 * (frames - 1) * t, -0.035],
};
const path = PATHS[pathName];
if (!path) throw new Error(`Unknown path "${pathName}". Use: ${Object.keys(PATHS).join(", ")}`);

const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch { /* Next browser */ } }
if (!executable) throw new Error("Set CHROME_PATH to an installed Chromium browser.");
const port = 9361;
const chrome = spawn(executable, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${resolve("artifacts", "motion-browser-profile")}`, "--no-first-run", "--no-default-browser-check", "--enable-webgl", "--ignore-gpu-blocklist", "--window-size=1440,960", "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
const pngs = [];
try {
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()); break; } catch { await delay(200); } }
  if (!tabs) throw new Error("Browser did not start");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((ready, reject) => { socket.addEventListener("open", ready, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(); let id = 0;
  socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); const request = pending.get(message.id); if (!request) return; pending.delete(message.id); if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result); });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => { const requestId = ++id; pending.set(requestId, { resolve: resolveCall, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); setTimeout(() => reject(Error(`Timed out: ${method}`)), 60000); });
  const evaluate = async expression => { const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: Number(args.get("dpr") ?? 1), mobile: false });
  await call("Page.navigate", { url: `${process.env.CITY_URL ?? "http://127.0.0.1:3000"}/?studio=1&view=market&clean=1&clock=${args.get("clock") ?? 45}${args.has("query") ? `&${args.get("query")}` : ""}` });
  for (let i = 0; i < 150; i++) { const phase = await evaluate("document.querySelector('main')?.dataset.phase").catch(() => null); if (phase === "error") throw Error(await evaluate("document.body.innerText")); if (phase === "intro") break; await delay(200); }
  await delay(Number(args.get("warm") ?? 2500));
  const step = Number(args.get("step") ?? 1 / fps);
  for (let frame = 0; frame < frames; frame++) {
    const [x, height, z, yaw, pitch] = path(frames > 1 ? frame / (frames - 1) : 0);
    // Advance the (frozen) world clock with the camera so animation is sampled at the same rate.
    await evaluate(`(async () => { const n = window.__nightfall; n.inspect({ kind: "camera", x: ${x}, height: ${height}, z: ${z}, yaw: ${yaw}, pitch: ${pitch} }); if (${frame} > 0) n.inspect({ kind: "step", seconds: ${step} }); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))); })()`);
    const image = await call("Page.captureScreenshot", clip ? { format: "png", clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: 1 } } : { format: "png" });
    pngs.push(Buffer.from(image.data, "base64"));
  }
} finally { socket?.close(); chrome.kill(); }

// ---- PNG decode / encode ----------------------------------------------------------------
function decodePng(png) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), type = png[25];
  const channels = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!channels || png[24] !== 8 || png[28] !== 0) throw Error("Unsupported PNG from the browser");
  const chunks = []; let offset = 8;
  while (offset < png.length) { const length = png.readUInt32BE(offset); if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length)); offset += 12 + length; }
  const raw = zlib.inflateSync(Buffer.concat(chunks)), stride = width * channels, rgb = Buffer.alloc(width * height * 3);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? current[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      current[x] = v & 255;
    }
    for (let x = 0; x < width; x++) for (let k = 0; k < 3; k++) rgb[(y * width + x) * 3 + k] = current[x * channels + k];
    previous = current;
  }
  return { width, height, rgb };
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---- GIF encode (global popularity palette, LZW) ------------------------------------------
function buildPalette(images) {
  const counts = new Map();
  for (const { rgb } of images) for (let i = 0; i < rgb.length; i += 9) { const key = (rgb[i] >> 3) << 10 | (rgb[i + 1] >> 3) << 5 | rgb[i + 2] >> 3; counts.set(key, (counts.get(key) ?? 0) + 1); }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(([key]) => [((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4]);
  while (top.length < 256) top.push([0, 0, 0]);
  return top;
}
function lzw(indices) {
  const bytes = []; let bitBuffer = 0, bitCount = 0, codeSize = 9, next = 258;
  const write = code => { bitBuffer |= code << bitCount; bitCount += codeSize; while (bitCount >= 8) { bytes.push(bitBuffer & 255); bitBuffer >>>= 8; bitCount -= 8; } };
  let dictionary = new Map(); write(256);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const key = prefix << 8 | indices[i], code = dictionary.get(key);
    if (code !== undefined) { prefix = code; continue; }
    write(prefix);
    if (next < 4096) { dictionary.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
    else { write(256); dictionary = new Map(); next = 258; codeSize = 9; }
    prefix = indices[i];
  }
  write(prefix); write(257);
  if (bitCount > 0) bytes.push(bitBuffer & 255);
  const blocks = [8];
  for (let i = 0; i < bytes.length; i += 255) { const block = bytes.slice(i, i + 255); blocks.push(block.length, ...block); }
  blocks.push(0);
  return Buffer.from(blocks);
}
function encodeGif(images, delayCs) {
  const { width, height } = images[0], palette = buildPalette(images), cache = new Map();
  const nearest = (r, g, b) => {
    const key = r << 16 | g << 8 | b, hit = cache.get(key); if (hit !== undefined) return hit;
    let best = 0, bestDistance = Infinity;
    for (let i = 0; i < 256; i++) { const p = palette[i], d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bestDistance) { bestDistance = d; best = i; } }
    cache.set(key, best); return best;
  };
  const parts = [Buffer.from("GIF89a"), Buffer.from([width & 255, width >> 8, height & 255, height >> 8, 0xf7, 0, 0]), Buffer.from(palette.flat()),
    Buffer.from([0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0])];
  for (const { rgb } of images) {
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i++) indices[i] = nearest(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    parts.push(Buffer.from([0x21, 0xf9, 4, 0, delayCs & 255, delayCs >> 8, 0, 0]), Buffer.from([0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0]), lzw(indices));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

// ---- Analysis -------------------------------------------------------------------------------
const images = pngs.map(decodePng);
const { width, height } = images[0];
const luma = (rgb, i) => 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
// Horizontal image motion between consecutive frames (best integer pixel shift of the middle band).
const shifts = [];
for (let f = 1; f < images.length; f++) {
  let best = 0, bestError = Infinity;
  for (let dx = -24; dx <= 24; dx++) {
    let error = 0;
    for (let y = height * 0.3 | 0; y < height * 0.7; y += 2) for (let x = 30; x < width - 30; x += 2) error += Math.abs(luma(images[f].rgb, y * width + x) - luma(images[f - 1].rgb, y * width + x - dx));
    if (error < bestError) { bestError = error; best = dx; }
  }
  shifts.push(best);
}
// Per-strip motion (left edge / centre / right edge): under perspective a turn moves the edges
// faster than the centre; a sawtooth here (steady glide, then a jump back) is peripheral jitter.
const strips = [[0.02, 0.18], [0.42, 0.58], [0.82, 0.98]].map(([a, b]) => {
  const out = [];
  for (let f = 1; f < images.length; f++) {
    let best = 0, bestError = Infinity;
    for (let dx = -40; dx <= 40; dx++) {
      let error = 0;
      for (let y = height * 0.25 | 0; y < height * 0.75; y += 2) for (let x = width * a | 0; x < width * b; x += 2) { const xs = x - dx; if (xs < 0 || xs >= width) { error += 255; continue; } error += Math.abs(luma(images[f].rgb, y * width + x) - luma(images[f - 1].rgb, y * width + xs)); }
      if (error < bestError) { bestError = error; best = dx; }
    }
    out.push(best);
  }
  return out;
});
// Vertical motion of the centre region (pitch paths).
const vertical = [];
for (let f = 1; f < images.length; f++) {
  let best = 0, bestError = Infinity;
  for (let dy = -40; dy <= 40; dy++) {
    let error = 0;
    for (let y = height * 0.3 | 0; y < height * 0.7; y += 2) for (let x = width * 0.3 | 0; x < width * 0.7; x += 2) { const ys = y - dy; error += ys < 0 || ys >= height ? 255 : Math.abs(luma(images[f].rgb, y * width + x) - luma(images[f - 1].rgb, ys * width + x)); }
    if (error < bestError) { bestError = error; best = dy; }
  }
  vertical.push(best);
}
// A pixel "shimmers" when it moves one way then straight back (A -> B -> A) across three frames:
// the signature of aliasing and glyph flicker. Frames are first aligned by the global horizontal
// shift, so characters gliding smoothly while turning are not mistaken for flicker.
// Energies weight by magnitude (luma levels): halving a glyph's contrast halves its flicker energy
// even when the pixel still crosses the binary thresholds above.
// Alignment is per vertical band: under perspective the edges of a turning view move faster than
// the centre, and a single global shift would count that correct motion as flicker.
const BANDS = 12, bandOf = x => Math.min(BANDS - 1, Math.floor(x / width * BANDS));
const bandShifts = [];
for (let f = 1; f < images.length; f++) {
  const row = [];
  for (let band = 0; band < BANDS; band++) {
    const x0 = Math.floor(band * width / BANDS), x1 = Math.floor((band + 1) * width / BANDS);
    let best = shifts[f - 1], bestError = Infinity;
    for (let dx = -40; dx <= 40; dx++) {
      let error = 0;
      for (let y = 0; y < height; y += 3) for (let x = x0; x < x1; x += 2) { const xs = x - dx; error += xs < 0 || xs >= width ? 64 : Math.abs(luma(images[f].rgb, y * width + x) - luma(images[f - 1].rgb, y * width + xs)); }
      if (error < bestError) { bestError = error; best = dx; }
    }
    row.push(best);
  }
  bandShifts.push(row);
}
const toggles = new Float32Array(width * height); let toggleTotal = 0, changeTotal = 0, changeEnergy = 0, shimmerEnergy = 0, samples = 0;
for (let f = 2; f < images.length; f++) {
  const a = images[f - 2].rgb, b = images[f - 1].rgb, c = images[f].rgb;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s1 = bandShifts[f - 2][bandOf(x)], s2 = bandShifts[f - 1][bandOf(x)];
    const xa = x - s1, xc = x + s2;
    if (xa < 0 || xa >= width || xc < 0 || xc >= width) continue;
    const i = y * width + x, la = luma(a, y * width + xa), lb = luma(b, i), lc = luma(c, y * width + xc);
    const d1 = lb - la, d2 = lc - lb;
    samples++; changeEnergy += Math.abs(d1);
    if (Math.sign(d1) !== Math.sign(d2)) shimmerEnergy += Math.max(0, Math.min(Math.abs(d1), Math.abs(d2)) - Math.abs(lc - la));
    if (Math.abs(d1) > 12) changeTotal++;
    if (Math.abs(d1) > 24 && Math.abs(d2) > 24 && Math.sign(d1) !== Math.sign(d2) && Math.abs(lc - la) < 16) { toggles[i]++; toggleTotal++; }
  }
}
const pairs = Math.max(1, images.length - 2), heat = Buffer.alloc(width * height * 3);
for (let i = 0; i < width * height; i++) {
  const v = Math.min(1, toggles[i] / pairs * 3), base = luma(images[images.length >> 1].rgb, i) * 0.35;
  heat[i * 3] = Math.min(255, base + v * 255); heat[i * 3 + 1] = Math.min(255, base + v * 60); heat[i * 3 + 2] = base;
}
// Contact sheet: every nth frame in a grid at native scale (glyphs stay legible).
const pick = Math.max(1, Math.floor(images.length / 8)), sheetFrames = images.filter((_, i) => i % pick === 0).slice(0, 8);
const columns = Math.min(4, sheetFrames.length), rows = Math.ceil(sheetFrames.length / columns);
const sheet = Buffer.alloc(width * columns * height * rows * 3);
sheetFrames.forEach(({ rgb }, index) => {
  const ox = (index % columns) * width, oy = Math.floor(index / columns) * height;
  for (let y = 0; y < height; y++) rgb.copy(sheet, ((oy + y) * width * columns + ox) * 3, y * width * 3, (y + 1) * width * 3);
});
const metrics = {
  shifts, vertical, strips: { left: strips[0], centre: strips[1], right: strips[2] },
  path: pathName, frames: images.length, fps, width, height,
  shimmerRate: toggleTotal / (width * height * pairs),
  changeRate: changeTotal / (width * height * pairs),
  shimmerShareOfChange: toggleTotal / Math.max(1, changeTotal),
  changeEnergy: changeEnergy / Math.max(1, samples),
  shimmerEnergy: shimmerEnergy / Math.max(1, samples),
};
await writeFile(resolve(out, "motion.gif"), encodeGif(images, Math.round(100 / fps)));
await writeFile(resolve(out, "contact-sheet.png"), encodePng(width * columns, height * rows, sheet));
await writeFile(resolve(out, "shimmer-heatmap.png"), encodePng(width, height, heat));
await writeFile(resolve(out, "first.png"), pngs[0]);
await writeFile(resolve(out, "metrics.json"), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics));
console.log(`Wrote ${out}`);
