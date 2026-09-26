// Colours and the tiny drawing vocabulary every rpg/scene drawer shares. The city's prop material
// (SURFACE 2, materials.ts) lights `charColor` as the albedo and ignores the cell colour's rgb; a
// channel above ~0.64 (163) starts to glow and above ~0.95 (242) it is fully emissive, so
// "lit trim" in this module means "a colour whose brightest channel is ~245-255". The cell colour's
// alpha carries the prop draw distance (4 m units, 255 = never dissolve), exactly like
// activity.ts propRange/propAlpha - kept local here so importing this module has no side effects on
// the city's own range stack (and so it runs under node's type stripping in tests).
import type { PropCanvas } from "../../city/prop-canvas.ts";
import type { FactionId, Rarity } from "../types.ts";

/** [r, g, b] 0..255. */
export type Rgb = readonly [number, number, number];

/** One consistent rarity palette for the whole RPG: world loot, the HUD, the first-person trim and
 * the React screens (import it there too). Common is a plain grey (not emissive); the rest are
 * saturated enough to glow in the city material. */
export const RARITY_COLOR: Readonly<Record<Rarity, Rgb>> = {
  common: [168, 174, 178],
  uncommon: [84, 236, 112],
  rare: [74, 156, 255],
  epic: [190, 98, 255],
  legendary: [255, 164, 44],
};
/** CSS strings of RARITY_COLOR for DOM/React screens. */
export const RARITY_CSS: Readonly<Record<Rarity, string>> = Object.fromEntries(
  (Object.keys(RARITY_COLOR) as Rarity[]).map(r => [r, `rgb(${RARITY_COLOR[r].join(", ")})`]),
) as Record<Rarity, string>;
/** Rarity order (index = tier). */
export const RARITY_ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
export const rarityTier = (rarity: Rarity): number => Math.max(0, RARITY_ORDER.indexOf(rarity));

export type Silhouette = "spiked" | "tall" | "armoured" | "hooded" | "plain";
/** How a faction reads at a glance: silhouette, body colours, lit accent and body glyph. */
export interface FactionStyle {
  silhouette: Silhouette;
  /** Main body / jacket. */
  body: Rgb;
  /** Secondary: trousers, armour plates, hood. */
  trim: Rgb;
  /** Emissive accent (eyes, visor, seams, ground ring): what makes them readable at night. */
  light: Rgb;
  /** Spikes / halo / plates. */
  detail: Rgb;
  /** Glyph for the torso: structure in the character, tone in the colour. */
  glyph: string;
  /** HUD name colour. */
  hud: Rgb;
}
export const FACTION_STYLE: Readonly<Record<string, FactionStyle>> = {
  razorbacks: { silhouette: "spiked", body: [150, 40, 34], trim: [58, 26, 24], light: [255, 72, 48], detail: [214, 200, 176], glyph: "#", hud: [255, 96, 72] },
  "chrome-saints": { silhouette: "tall", body: [168, 176, 188], trim: [92, 98, 110], light: [255, 246, 206], detail: [132, 238, 255], glyph: "=", hud: [236, 240, 250] },
  corpsec: { silhouette: "armoured", body: [40, 66, 122], trim: [70, 96, 150], light: [88, 182, 255], detail: [26, 34, 52], glyph: "H", hud: [110, 176, 255] },
  ghosts: { silhouette: "hooded", body: [26, 30, 40], trim: [36, 40, 52], light: [70, 255, 236], detail: [18, 20, 26], glyph: "%", hud: [96, 244, 230] },
};
const PLAIN: FactionStyle = { silhouette: "plain", body: [96, 92, 88], trim: [52, 56, 62], light: [255, 190, 90], detail: [140, 140, 140], glyph: "H", hud: [230, 214, 170] };
/** Style for a faction; unknown factions fall back to a plain street tough. */
export const factionStyle = (faction: FactionId): FactionStyle => FACTION_STYLE[faction] ?? PLAIN;

export const mix = (a: Rgb, b: Rgb, k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const scaleRgb = (c: Rgb, k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];
/** Lift a colour so its brightest channel is `peak` (keeps the hue; makes it emissive). */
export function glowOf(c: Rgb, peak = 250): [number, number, number] {
  const top = Math.max(c[0], c[1], c[2], 1), k = peak / top;
  return [c[0] * k, c[1] * k, c[2] * k];
}

// ---- Draw-state modifiers (hit flash, telegraph heat, death fade) --------------------------------
// Set around one figure's drawing and applied by paint(): every part of the figure picks them up
// without threading parameters through each limb.
const mod = { flash: 0, heat: 0, fade: 1, glyph: "" };
const WHITE: Rgb = [255, 244, 226], HEAT: Rgb = [255, 136, 52];
export function setPaintMods(flash: number, heat: number, fade: number, glyph = ""): void { mod.flash = flash; mod.heat = heat; mod.fade = fade; mod.glyph = glyph; }
export function clearPaintMods(): void { mod.flash = 0; mod.heat = 0; mod.fade = 1; mod.glyph = ""; }

let range = 255;
/** Draw distance (m) for following paint() calls; 0 = always drawn. Returns the previous code. */
export function paintRange(meters: number): number {
  const previous = range;
  range = meters > 0 ? Math.max(1, Math.min(254, Math.round(meters / 4))) : 255;
  return previous;
}
export function restorePaintRange(code: number): void { range = code; }

/** Sets glyph + colour for the next primitives. `gain` scales the colour; values are clamped. */
export function paint(t: PropCanvas, color: Rgb, glyph: string, gain = 1): void {
  let r = color[0] * gain, g = color[1] * gain, b = color[2] * gain;
  if (mod.heat > 0) { const k = mod.heat * 0.55; r += (HEAT[0] - r) * k; g += (HEAT[1] - g) * k; b += (HEAT[2] - b) * k; }
  if (mod.flash > 0) { const k = mod.flash; r += (WHITE[0] - r) * k; g += (WHITE[1] - g) * k; b += (WHITE[2] - b) * k; }
  r *= mod.fade; g *= mod.fade; b *= mod.fade;
  t.char(mod.glyph || (mod.flash > 0.55 ? (mod.flash > 0.85 ? "@" : "#") : glyph));
  t.charColor(Math.min(255, r), Math.min(255, g), Math.min(255, b));
  t.cellColor(Math.min(255, r * 0.12), Math.min(255, g * 0.12), Math.min(255, b * 0.12), range);
}

/** Axis-aligned box centred at (x, y up, z) in the current frame (activity.ts cuboid). */
export function box(t: PropCanvas, x: number, y: number, z: number, w: number, h: number, d: number): void {
  t.translate(x, -y, z); t.box(w, h, d); t.translate(-x, y, -z);
}
/** Ellipsoid centred at (x, y up, z). */
export function blob(t: PropCanvas, x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
  t.translate(x, -y, z); t.ellipsoid(rx, ry, rz); t.translate(-x, y, -z);
}
/** Horizontal ring at height y. textmode's torus already lies in its local XZ plane (axis Y: the
 * direct primitive is 2(r+tube) wide and deep, 2 tube high; prop-batch.ts builds it the same way),
 * so no rotation - a rotateX(90) would stand it up as a vertical hoop. */
export function ring(t: PropCanvas, x: number, y: number, z: number, radius: number, tube: number): void {
  t.translate(x, -y, z); t.torus(radius, tube); t.translate(-x, y, -z);
}

/** A box of square cross-section `thick` from a to b (y up), in the current frame: tracers, arms,
 * slash ribbons. Its local +z runs along a -> b. */
export function segment(t: PropCanvas, ax: number, ay: number, az: number, bx: number, by: number, bz: number, thick: number): void {
  const dx = bx - ax, dy = by - ay, dz = bz - az, length = Math.hypot(dx, dy, dz);
  if (length < 1e-5) return;
  t.push(); t.translate((ax + bx) / 2, -(ay + by) / 2, (az + bz) / 2);
  t.rotateY(Math.atan2(dx, dz) * DEG); t.rotateX(Math.asin(Math.max(-1, Math.min(1, dy / length))) * DEG);
  t.box(thick, thick, length);
  t.pop();
}

export const DEG = 180 / Math.PI;
export const clamp01 = (v: number): number => v < 0 ? 0 : v > 1 ? 1 : v;
export const smooth = (e0: number, e1: number, x: number): number => { const k = clamp01((x - e0) / (e1 - e0)); return k * k * (3 - 2 * k); };
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Stable 0..1 hash of a string id (FNV-1a). */
export function hashString(id: string): number { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
/** Stable 0..1 hash of numbers (no allocation). */
export function hash3(a: number, b: number, c = 0): number {
  let h = Math.imul(Math.floor(a) | 0, 374761393) ^ Math.imul(Math.floor(b) | 0, 668265263) ^ Math.imul(Math.floor(c) | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Density ramp used for fades, dissolves and damage numbers (dense -> sparse). */
export const RAMP = "@%#*+=-:.";
