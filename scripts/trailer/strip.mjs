import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
// Review sheets of shot stills (first / middle / last frame per row, 3 shots per sheet):
//   node scripts/trailer/strip.mjs [dir]
const dir = process.argv[2] ?? "artifacts/trailer/stills";
const names = [...new Set(readdirSync(dir).filter(f => /-a\.png$/.test(f)).map(f => f.replace(/-a\.png$/, "")))].sort();
for (let s = 0; s * 3 < names.length; s++) {
  const group = names.slice(s * 3, s * 3 + 3); while (group.length < 3) group.push(group[0]);
  const args = ["-v", "error", "-y"]; const filters = [];
  group.forEach((name, r) => ["a", "b", "c"].forEach((f, c) => { args.push("-i", `${dir}/${name}-${f}.png`); const k = r * 3 + c; filters.push(`[${k}:v]scale=640:360${c === 0 ? `,drawtext=fontfile=artifacts/trailer/consola.ttf:text=${name}:x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6` : ""}[v${k}]`); }));
  const layout = Array.from({ length: 9 }, (_, k) => `${(k % 3) * 640}_${Math.floor(k / 3) * 360}`).join("|");
  args.push("-filter_complex", `${filters.join(";")};${Array.from({ length: 9 }, (_, k) => `[v${k}]`).join("")}xstack=inputs=9:layout=${layout}`, `${dir}/review-${s}.png`);
  const r = spawnSync("ffmpeg", args, { stdio: "inherit" }); if (r.status) process.exit(r.status);
}
