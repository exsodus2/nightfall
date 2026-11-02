import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
// Labelled 2x2 contact sheets from a folder of stills: node scripts/trailer/sheet.mjs <dir>
const dir = process.argv[2];
const files = readdirSync(dir).filter(f => f.endsWith(".png") && !f.startsWith("sheet-")).sort();
for (let s = 0; s * 4 < files.length; s++) {
  const group = files.slice(s * 4, s * 4 + 4); while (group.length < 4) group.push(group[0]);
  const args = ["-v", "error", "-y"]; group.forEach(f => args.push("-i", `${dir}/${f}`));
  const filters = group.map((f, k) => `[${k}:v]scale=960:540,drawtext=fontfile=artifacts/trailer/consola.ttf:text=${f.replace(".png", "")}:x=10:y=10:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6[v${k}]`).join(";");
  args.push("-filter_complex", `${filters};[v0][v1][v2][v3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0`, `${dir}/sheet-${s}.png`);
  const r = spawnSync("ffmpeg", args, { stdio: "inherit" }); if (r.status) process.exit(r.status);
}
