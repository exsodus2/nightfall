import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

// Read the lossless 8-bit RGB/RGBA PNGs produced by Chromium without adding an
// imaging dependency. Compare identical camera/clock/viewport audit captures.
async function pixels(path) {
  const file = await readFile(path), chunks = [];
  if (file.subarray(1, 4).toString() !== "PNG") throw Error("Expected a PNG screenshot");
  let width, height, channels;
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset), type = file.toString("ascii", offset + 4, offset + 8), data = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (data[8] !== 8 || !channels || data[12]) throw Error("Expected non-interlaced 8-bit RGB/RGBA");
    }
    if (type === "IDAT") chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, out = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error("Unknown PNG row filter");
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x, a = x >= channels ? out[index - channels] : 0, b = y ? out[index - stride] : 0, c = y && x >= channels ? out[index - stride - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? pa <= pb && pa <= pc ? a : pb <= pc ? b : c : 0;
      out[index] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return { width, height, channels, out };
}
const [first, second] = process.argv.slice(2);
if (!first || !second) throw Error("Usage: node scripts/image-diff.mjs reference.png candidate.png");
const [a, b] = await Promise.all([pixels(first), pixels(second)]);
if (a.width !== b.width || a.height !== b.height) throw Error("Screenshot dimensions differ");
let total = 0, changed = 0, above8 = 0, max = 0;
for (let i = 0; i < a.width * a.height; i++) {
  let difference = 0;
  for (let c = 0; c < 3; c++) { const delta = Math.abs(a.out[i * a.channels + c] - b.out[i * b.channels + c]); total += delta; difference = Math.max(difference, delta); }
  if (difference) changed++; if (difference > 8) above8++; max = Math.max(max, difference);
}
console.log(JSON.stringify({ reference: first, candidate: second, width: a.width, height: a.height, meanAbsoluteRGB: total / (a.width * a.height * 3), changedPercent: changed / (a.width * a.height) * 100, above8Percent: above8 / (a.width * a.height) * 100, maxChannelDifference: max }, null, 2));
