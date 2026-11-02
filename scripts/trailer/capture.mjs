import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { launch, openCity, screenshot } from "./browser.mjs";
import { SHOTS } from "./shots.mjs";

// Renders trailer shots from the live renderer, one exact 1/fps step per frame.
//   node scripts/trailer/capture.mjs [--only=a,b] [--dpr=2] [--fps=60] [--stills] [--port=9377]
// Shots land in artifacts/trailer/shots/<name>.mp4 (near-lossless 4:4:4, edited by edit.mjs);
// --stills writes the first, middle and last frame of each shot to artifacts/trailer/stills/ instead.
const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=") || "true"]; }));
const only = args.get("only")?.split(",");
const dpr = Number(args.get("dpr") ?? 2), fps = Number(args.get("fps") ?? 60), stills = args.has("stills");
const shots = SHOTS.filter(shot => !only || only.includes(shot.name));
if (!shots.length) throw new Error(`No shots match. Shots: ${SHOTS.map(s => s.name).join(", ")}`);
const outDir = stills ? "artifacts/trailer/stills" : "artifacts/trailer/shots";
await mkdir(outDir, { recursive: true });

// Page-side helpers: camera placement outdoors, inside a venue (venue-local coordinates) and riding.
const HELPERS = `(() => {
  const n = window.__nightfall, I = n.interiors;
  const venue = id => I.places.find(place => place.id === id);
  window.__trailer = {
    outdoors() { I.active = null; I.fixtures = []; },
    camera(p) { n.inspect({ kind: "camera", x: p[0], height: p[1], z: p[2], yaw: p[3], pitch: p[4] }); },
    // p = [right, height, back, yaw, pitch] in the venue's frame; yaw 0 faces the back counter.
    room(id, p) {
      const place = venue(id), c = Math.cos(place.yaw), s = Math.sin(place.yaw);
      I.active = null; this.camera([place.x + c * p[0] + s * p[2], p[1], place.z - s * p[0] + c * p[2], place.yaw + p[3], p[4]]);
      I.enter(place, { x: 0, z: 0, yaw: 0, pitch: 0 });
    },
  };
})()`;

const browser = await launch({ width: 1920, height: 1080, dpr, port: Number(args.get("port") ?? 9377) });
try {
  await openCity(browser);
  await browser.evaluate(HELPERS);
  await browser.evaluate(`(() => { window.__nightfall.inspect({ kind: "freeze", value: false }); window.__trailerClock.manual(); })()`);
  const step = 1000 / fps;
  for (const shot of shots) {
    const started = Date.now();
    const frames = Math.round(shot.seconds * fps);
    const frameJs = shot.frame ?? (u => `window.__trailer.camera(${JSON.stringify(shot.pose(u))})`);
    const preroll = Math.round((shot.preroll ?? 1.5) * fps);
    await browser.evaluate(`(() => { window.__trailer.outdoors(); window.__nightfall.inspect({ kind: "clock", seconds: ${Math.max(0, (shot.clock ?? 60) - preroll / fps)} }); ${shot.setup ?? ""} })()`);
    // Pre-roll at the opening pose so draw distance, fog and rain velocity have settled.
    for (let i = 0; i < preroll; i++) await browser.evaluate(`(async () => { ${frameJs(0, 0)}; await window.__trailerClock.advance(${step}); })()`);
    // --late reviews two thirds in rather than the last frame (the part of a shot the cut usually uses).
    const wanted = stills ? new Set([0, Math.floor(frames / 2), args.has("late") ? Math.floor(frames * 0.66) : frames - 1]) : null;
    const lastWanted = wanted && Math.max(...wanted);
    const encoder = stills ? null : spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-preset", "fast", "-crf", "8", "-pix_fmt", "yuv444p", "-color_range", "pc", `${outDir}/${shot.name}.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
    const done = encoder && new Promise((ok, fail) => encoder.on("close", code => code ? fail(Error(`ffmpeg exited ${code}`)) : ok()));
    for (let frame = 0; frame < frames; frame++) {
      const u = frames > 1 ? frame / (frames - 1) : 0;
      if (wanted && !wanted.has(frame)) { await browser.evaluate(`(async () => { ${frameJs(u, frame / fps)}; await window.__trailerClock.advance(${step}); })()`); continue; }
      await browser.evaluate(`(async () => { ${frameJs(u, frame / fps)}; await window.__trailerClock.advance(${step}); })()`);
      const png = await screenshot(browser);
      if (wanted) await writeFile(`${outDir}/${shot.name}-${frame === 0 ? "a" : frame === lastWanted ? "c" : "b"}.png`, png);
      else if (!encoder.stdin.write(png)) await new Promise(ok => encoder.stdin.once("drain", ok));
    }
    if (encoder) { encoder.stdin.end(); await done; }
    if (shot.teardown) await browser.evaluate(`(() => { ${shot.teardown} })()`);
    console.log(`${shot.name}: ${frames} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
} finally { browser.close(); }
