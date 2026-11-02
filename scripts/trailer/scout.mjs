import { mkdir, readFile, writeFile } from "node:fs/promises";
import { launch, openCity, screenshot } from "./browser.mjs";
// Stills for choosing compositions:  node scripts/trailer/scout.mjs <shots.json> [outDir]
// shots.json: [{ name, cam: [x, height, z, yaw, pitch], clock?, settle? }]
const shots = JSON.parse(await readFile(process.argv[2], "utf8"));
const out = process.argv[3] ?? "artifacts/trailer/scout"; await mkdir(out, { recursive: true });
const b = await launch({ width: 1920, height: 1080, dpr: 1, port: 9378 });
try {
  await openCity(b);
  await b.evaluate(`(() => { window.__nightfall.inspect({ kind: "freeze", value: false }); window.__trailerClock.manual(); })()`);
  for (const shot of shots) {
    const [x, height, z, yaw, pitch] = shot.cam;
    await b.evaluate(`(async () => { const n = window.__nightfall; n.inspect({ kind: "clock", seconds: ${shot.clock ?? 60} }); n.inspect({ kind: "camera", x: ${x}, height: ${height}, z: ${z}, yaw: ${yaw}, pitch: ${pitch} }); for (let i = 0; i < ${shot.settle ?? 30}; i++) await window.__trailerClock.advance(100); })()`);
    await writeFile(`${out}/${shot.name}.png`, await screenshot(b));
    process.stdout.write(shot.name + " ");
  }
} finally { b.close(); }
