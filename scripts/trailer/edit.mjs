import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { CLIPS, DURATION, FPS } from "./timeline.mjs";

// Conforms the trailer: picture from artifacts/trailer/shots, the typography layer
// (titles.mov) and the score (score.wav) into H.264 deliverables.
//   node scripts/trailer/edit.mjs [--draft]   (--draft: quick 1080p preview)
// Compositing happens in RGB: the captures are full-range BT.601 4:4:4 and are converted once,
// explicitly, to BT.709 limited range at the very end.
const draft = process.argv.includes("--draft");
const dir = "artifacts/trailer";
const W = draft ? 1920 : 3840, H = draft ? 1080 : 2160;
const run = args => { const r = spawnSync("ffmpeg", args, { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" }); if (r.status) { console.error(r.stderr.slice(-4000)); process.exit(r.status); } return r.stderr; };

for (const clip of CLIPS) if (!existsSync(`${dir}/shots/${clip.shot}.mp4`)) throw new Error(`Missing shot ${clip.shot}`);

// ---- picture ----------------------------------------------------------------------------------
const inputs = ["-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${FPS}:d=${DURATION}`];
const filters = [`[0:v]format=gbrp,setsar=1[base0]`];
CLIPS.forEach((clip, k) => {
  const next = CLIPS[k + 1];
  // A dissolve straddles the cut: the incoming clip starts half a dissolve early, the outgoing one
  // runs half a dissolve long.
  const lead = (clip.dissolve ?? 0) / 2, tail = next?.dissolve && Math.abs(next.at - (clip.at + clip.dur)) < 0.001 ? next.dissolve / 2 : 0;
  const start = clip.at - lead, length = clip.dur + lead + tail;
  inputs.push("-i", `${dir}/shots/${clip.shot}.mp4`);
  const chain = [`trim=start_frame=0:end_frame=${Math.round(length * FPS)}`, "setpts=PTS-STARTPTS",
    `scale=${W}:${H}:flags=lanczos:in_range=full:in_color_matrix=bt601`, "format=gbrap", `setpts=PTS+${start.toFixed(4)}/TB`];
  if (clip.dissolve) chain.push(`fade=t=in:st=${start.toFixed(4)}:d=${clip.dissolve}:alpha=1`);
  if (clip.fadeIn) chain.push(`fade=t=in:st=${clip.at}:d=${clip.fadeIn}`);
  if (clip.fadeOut) chain.push(`fade=t=out:st=${(clip.at + clip.dur - clip.fadeOut).toFixed(4)}:d=${clip.fadeOut}`);
  filters.push(`[${k + 1}:v]${chain.join(",")}[c${k}]`);
  filters.push(`[base${k}][c${k}]overlay=eof_action=pass:format=gbrp[base${k + 1}]`);
});
let last = `base${CLIPS.length}`;
// Finishing: a touch of contrast and a soft vignette; the game's own colours are left alone.
filters.push(`[${last}]eq=contrast=1.05:saturation=1.06:gamma=1.02,vignette=angle=PI/5:mode=forward:eval=init[graded]`);
last = "graded";
// Typography layer.
const titleIndex = CLIPS.length + 1;
inputs.push("-i", `${dir}/titles.mov`);
filters.push(`[${titleIndex}:v]scale=${W}:${H}:flags=lanczos,format=gbrap[titles]`, `[${last}][titles]overlay=format=gbrp:shortest=0:eof_action=pass[comp]`);
filters.push(`[comp]trim=duration=${DURATION},scale=${W}:${H}:out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]`);

// ---- sound ---------------------------------------------------------------------------------------
inputs.push("-i", `${dir}/score.wav`);
const audioIndex = titleIndex + 1;
// Two-pass linear loudness normalisation to -14 LUFS / -1.5 dBTP (streaming delivery level).
const measure = run(["-hide_banner", "-i", `${dir}/score.wav`, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]);
const stats = JSON.parse(measure.slice(measure.lastIndexOf("{"), measure.lastIndexOf("}") + 1));
filters.push(`[${audioIndex}:a]loudnorm=I=-14:TP=-1.5:LRA=11:linear=true:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset},aresample=48000[aout]`);

// BT.709 tags written into the H.264 bitstream itself (the container flags alone get dropped).
const TAGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", "-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0"];
const name = draft ? "nightfall-trailer-draft.mp4" : "nightfall-trailer-4k.mp4";
const video = draft
  ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
  : ["-c:v", "libx264", "-preset", "slow", "-crf", "15", "-profile:v", "high", "-level:v", "5.2", "-x264-params", "aq-mode=3:aq-strength=0.9:deblock=-1,-1", "-maxrate", "90M", "-bufsize", "180M"];
run(["-v", "error", "-stats", "-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]",
  ...video, "-g", String(FPS), ...TAGS,
  "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", "-t", String(DURATION), `${dir}/${name}`]);
console.log(`wrote ${dir}/${name}`);

// A 1080p version for sharing, down-sampled from the 4K master.
if (!draft) {
  run(["-v", "error", "-stats", "-y", "-i", `${dir}/${name}`, "-vf", "scale=1920:1080:flags=lanczos:in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-level:v", "4.2", "-x264-params", "aq-mode=3:aq-strength=0.9:deblock=-1,-1", "-maxrate", "40M", "-bufsize", "80M",
    "-g", String(FPS), ...TAGS, "-c:a", "copy", "-movflags", "+faststart", `${dir}/nightfall-trailer-1080p.mp4`]);
  console.log(`wrote ${dir}/nightfall-trailer-1080p.mp4`);
}
