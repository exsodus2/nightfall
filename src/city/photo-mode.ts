// Photo mode helpers (pure; no DOM, no textmode). The React side (src/components/photo-mode.tsx) owns
// the session; the engine only hides its HUD layer, aims the paused camera and hands back the cell grid.

/** The base layer's cell grid as `CityController.photoFrame()` returns it. */
export interface PhotoFrame {
  cols: number;
  rows: number;
  /** Attachment 0 of the cell framebuffer, RGBA per cell, top row first: R = glyph index low byte, G = high byte. */
  cells: Uint8Array;
  /** The active font's character map: character -> glyph identity colour (0..1 floats or 0..255 bytes). */
  glyphs: readonly (readonly [string, readonly number[]])[];
}

// The city atlas (src/city/atlas.ts) keys its thin weight in the Private Use Area from U+E000, in
// printable-ASCII order from the space, and pads the 256 tiles with blank keys from U+E100.
const FIRST_ASCII = 32;
const ASCII_COUNT = 95;
const THIN_BASE = 0xe000;

/** Plain-text stand-in for an atlas key: thin weights become their ASCII letter, blank or unknown keys a space. */
export function plainCharacter(key: string): string {
  const code = key.codePointAt(0);
  if (code === undefined) return " ";
  if (code >= THIN_BASE && code < THIN_BASE + ASCII_COUNT) return String.fromCharCode(FIRST_ASCII + code - THIN_BASE);
  if (code < FIRST_ASCII || (code >= 0x7f && code < 0xa0) || (code >= 0xe000 && code <= 0xf8ff)) return " ";
  return key;
}

/** Glyph index -> plain character. When two keys share an index the first printable one wins. */
export function glyphLookup(glyphs: PhotoFrame["glyphs"]): Map<number, string> {
  let bytes = false;
  for (const [, color] of glyphs) if ((color[0] ?? 0) > 1 || (color[1] ?? 0) > 1) { bytes = true; break; }
  const scale = bytes ? 1 : 255;
  const lookup = new Map<number, string>();
  for (const [key, color] of glyphs) {
    const index = Math.round((color[0] ?? 0) * scale) + Math.round((color[1] ?? 0) * scale) * 256;
    const character = plainCharacter(key);
    const previous = lookup.get(index);
    if (previous === undefined || (previous === " " && character !== " ")) lookup.set(index, character);
  }
  return lookup;
}

/** The frame as plain text: one line per cell row, trailing spaces trimmed, "\n" line ends. */
export function frameToText(frame: PhotoFrame): string {
  const lookup = glyphLookup(frame.glyphs);
  const lines: string[] = [];
  for (let row = 0; row < frame.rows; row++) {
    let line = "";
    for (let column = 0; column < frame.cols; column++) {
      const offset = (row * frame.cols + column) * 4;
      if (offset + 1 >= frame.cells.length) break;
      line += lookup.get(frame.cells[offset] + frame.cells[offset + 1] * 256) ?? " ";
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

/** "nightfall-neon-market-2026-10-21-221509.png": the place as a slug plus the local date and time. */
export function photoFilename(place: string, date: Date, extension: "png" | "txt"): string {
  const slug = place.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const pad = (value: number) => value.toString().padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `nightfall-${slug ? `${slug}-` : ""}${stamp}.${extension}`;
}

/** Slow orbit limits in degrees per second (motion comfort: never faster than 10 deg/s). */
export const ORBIT_MIN_SPEED = 2;
export const ORBIT_MAX_SPEED = 10;
export const ORBIT_DEFAULT_SPEED = 5;
/** Seconds for the orbit to ease most of the way up to (or down from) its speed. */
export const ORBIT_EASE = 0.9;

export function clampOrbitSpeed(speed: number): number {
  return Number.isFinite(speed) ? Math.max(ORBIT_MIN_SPEED, Math.min(ORBIT_MAX_SPEED, speed)) : ORBIT_DEFAULT_SPEED;
}

/**
 * One frame of the orbit: the angular velocity (deg/s) eases exponentially toward `target`, so starting
 * and stopping never jerk; returns the new velocity and the yaw step in radians. A hitch (dt > 0.1 s)
 * is clamped so a slow frame never turns the camera in one jump.
 */
export function orbitStep(velocity: number, target: number, dt: number): { velocity: number; yaw: number } {
  const step = Math.max(0, Math.min(0.1, dt));
  const goal = Math.max(-ORBIT_MAX_SPEED, Math.min(ORBIT_MAX_SPEED, target));
  let next = velocity + (goal - velocity) * (1 - Math.exp(-step * 3 / ORBIT_EASE));
  if (goal === 0 && Math.abs(next) < 0.02) next = 0;
  return { velocity: next, yaw: (next * Math.PI / 180) * step };
}

/** Drag-to-frame: pointer pixels -> yaw / pitch radians, the same directions as mouse look, with the engine's pitch limits. */
export const DRAG_RADIANS_PER_PIXEL = 0.0028;
export function dragAim(yaw: number, pitch: number, dx: number, dy: number): { yaw: number; pitch: number } {
  return { yaw: yaw + dx * DRAG_RADIANS_PER_PIXEL, pitch: Math.max(-1.3, Math.min(1.2, pitch + dy * DRAG_RADIANS_PER_PIXEL)) };
}
