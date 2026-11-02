import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { launch, screenshot } from "./browser.mjs";
import { DURATION, FPS } from "./timeline.mjs";

// Renders the typography layer (titles.html) with alpha for the whole timeline:
//   node scripts/trailer/titles.mjs                 -> artifacts/trailer/titles.mov (PNG in MOV, RGBA)
//   node scripts/trailer/titles.mjs --at=12,21,70   -> stills over a checker for review
const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=") || "true"]; }));
const stills = args.get("at")?.split(",").map(Number);
const browser = await launch({ width: 1920, height: 1080, dpr: stills ? 1 : 2, port: 9381 });
try {
  await browser.call("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await browser.call("Page.navigate", { url: pathToFileURL(resolve("scripts/trailer/titles.html")).href });
  for (let i = 0; i < 100 && !(await browser.evaluate("!!window.fontsReady").catch(() => false)); i++) await new Promise(r => setTimeout(r, 100));
  await browser.evaluate("window.fontsReady");
  const frame = async t => { await browser.evaluate(`(async () => { window.renderAt(${t}); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); })()`); return screenshot(browser); };
  if (stills) {
    await mkdir("artifacts/trailer/titles-review", { recursive: true });
    for (const t of stills) await writeFile(`artifacts/trailer/titles-review/t${t.toFixed(2)}.png`, await frame(t));
  } else {
    const encoder = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "png", "-pix_fmt", "rgba", "artifacts/trailer/titles.mov"], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((ok, fail) => encoder.on("close", code => code ? fail(Error(`ffmpeg ${code}`)) : ok()));
    let blank = null;
    const total = Math.round(DURATION * FPS);
    for (let i = 0; i < total; i++) {
      const t = i / FPS;
      let png;
      if (await browser.evaluate(`window.activeAt(${t})`)) png = await frame(t);
      else png = blank ??= await frame(-10);
      if (!encoder.stdin.write(png)) await new Promise(ok => encoder.stdin.once("drain", ok));
      if (i % 600 === 0) console.log(`titles ${i}/${total}`);
    }
    encoder.stdin.end(); await done;
  }
} finally { browser.close(); }
