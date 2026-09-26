// ASCII weapon models, shared by enemies (in hand) and the first-person view (at arm's length), so a
// shotgun looks like the same shotgun in both. Built from prop boxes: structure in the glyph (=, |,
// #, O), tone in the colour, a lit trim strip (rarity / faction accent) and optionally the item's own
// glyph embossed on a side plate.
//
// Model frame: origin at the grip where the hand closes, forward = -z, up = -y (textmode), x right.
// Lengths in metres, realistic sizes (enemies draw them scaled up a little for readability).
import type { PropCanvas } from "../../city/prop-canvas.ts";
import type { WeaponClass } from "../types.ts";
import { box, paint, type Rgb } from "./palette.ts";

export type WeaponModel = WeaponClass | "fists";
/** Colours + options for one weapon draw (reuse one object per caller; no per-frame allocation). */
export interface WeaponPaint {
  metal: Rgb;
  dark: Rgb;
  /** Emissive trim (rarity or faction light). */
  trim: Rgb;
  /** Item glyph to emboss on the side plate ("" = none). */
  glyph: string;
  /** Magazine drop (m, downwards) for the reload animation; 0 = seated. Negative hides it. */
  mag: number;
  /** Near-camera detail (sights, edge strips); off for far enemies. */
  detail: boolean;
  /** Stun-baton / blade edge energy 0..1 (brightens the lit parts). */
  charge: number;
}
export const defaultWeaponPaint = (): WeaponPaint => ({ metal: [150, 158, 168], dark: [44, 48, 56], trim: [168, 174, 178], glyph: "", mag: 0, detail: true, charge: 0 });

/** Muzzle / tip position in the model frame (x, y up, z) - where flashes and tracers start. */
export const WEAPON_TIP: Readonly<Record<WeaponClass, readonly [number, number, number]>> = {
  blade: [0, 0, -0.92], blunt: [0, 0, -0.7], baton: [0, 0, -0.45],
  pistol: [0, 0.05, -0.18], smg: [0, 0.055, -0.35], shotgun: [0, 0.06, -0.62], rifle: [0, 0.058, -0.61],
};
export const isRanged = (c: WeaponModel): boolean => c === "pistol" || c === "smg" || c === "shotgun" || c === "rifle";
export const isTwoHanded = (c: WeaponModel): boolean => c === "smg" || c === "shotgun" || c === "rifle";

const WOOD: Rgb = [112, 76, 50];

/** Draws a weapon in its model frame (the caller has placed the grip). Fists draw nothing. */
export function drawWeaponModel(t: PropCanvas, model: WeaponModel, p: WeaponPaint): void {
  const lit = 0.75 + p.charge * 0.25;
  switch (model) {
    case "blade":
      paint(t, p.dark, "o"); box(t, 0, 0, 0.14, 0.05, 0.05, 0.05);
      paint(t, p.dark, "="); box(t, 0, 0, 0.04, 0.036, 0.036, 0.18);
      paint(t, p.metal, "=", 0.9); box(t, 0, 0, -0.065, 0.2, 0.036, 0.04);
      paint(t, p.metal, "|", 1.1); box(t, 0, 0.004, -0.46, 0.018, 0.056, 0.75);
      box(t, 0, 0.012, -0.87, 0.016, 0.034, 0.08);
      // The edge carries the light: a thin strip along the underside.
      paint(t, p.trim, "-", lit); box(t, 0, -0.027, -0.46, 0.02, 0.012, 0.74);
      if (p.glyph) { paint(t, p.trim, p.glyph, 0.8); box(t, 0, 0, -0.065, 0.034, 0.042, 0.044); }
      return;
    case "blunt":
      paint(t, p.dark, "="); box(t, 0, 0, 0.06, 0.042, 0.042, 0.2);
      paint(t, p.metal, "|", 0.85); box(t, 0, 0, -0.3, 0.05, 0.05, 0.54);
      paint(t, p.metal, "#"); box(t, 0, 0, -0.62, 0.11, 0.11, 0.16);
      paint(t, p.trim, "+", lit); box(t, 0, 0, -0.62, 0.124, 0.124, 0.03);
      if (p.glyph) { paint(t, p.trim, p.glyph, 0.8); box(t, 0.026, 0, -0.16, 0.004, 0.03, 0.04); }
      return;
    case "baton":
      paint(t, p.dark, "="); box(t, 0, 0, 0.05, 0.04, 0.04, 0.18);
      paint(t, p.trim, "-", 0.7); box(t, 0, 0, -0.03, 0.048, 0.048, 0.02);
      paint(t, p.metal, "=", 0.6); box(t, 0, 0, -0.21, 0.034, 0.034, 0.34);
      // Stun tip: always lit, brighter while charged / swinging.
      paint(t, [120, 232, 255], "*", 0.8 + p.charge * 0.2); box(t, 0, 0, -0.41, 0.05, 0.05, 0.07);
      if (p.glyph) { paint(t, p.trim, p.glyph, 0.8); box(t, 0.021, 0, 0.05, 0.004, 0.026, 0.04); }
      return;
    case "pistol":
      paint(t, p.metal, "="); box(t, 0, 0.05, -0.07, 0.04, 0.05, 0.21);
      paint(t, p.dark, "="); box(t, 0, 0.015, -0.05, 0.036, 0.03, 0.15);
      paint(t, p.dark, "#"); box(t, 0, -0.045, 0.015, 0.034, 0.1, 0.05);
      if (p.mag >= 0 && p.mag < 0.3) { paint(t, p.dark, "="); box(t, 0, -0.1 - p.mag, 0.015, 0.028, 0.02, 0.04); }
      paint(t, p.trim, "-", lit); box(t, 0.021, 0.052, -0.07, 0.004, 0.01, 0.17);
      if (p.detail) { paint(t, p.trim, ".", 0.9); box(t, 0, 0.081, -0.16, 0.008, 0.012, 0.012); box(t, 0, 0.081, 0.02, 0.022, 0.012, 0.012); }
      if (p.glyph) { paint(t, p.trim, p.glyph, 0.8); box(t, -0.021, 0.045, -0.04, 0.004, 0.034, 0.05); }
      return;
    case "smg":
      paint(t, p.metal, "="); box(t, 0, 0.045, -0.08, 0.05, 0.07, 0.3);
      paint(t, p.dark, "-"); box(t, 0, 0.055, -0.28, 0.022, 0.022, 0.13);
      paint(t, p.dark, "#"); box(t, 0, -0.035, 0.03, 0.034, 0.09, 0.045);
      if (p.mag >= 0 && p.mag < 0.4) box(t, 0, -0.05 - p.mag, -0.11, 0.03, 0.14, 0.05);
      paint(t, p.dark, "="); box(t, 0, 0.04, 0.17, 0.03, 0.04, 0.16);
      paint(t, p.trim, "-", lit); box(t, 0.027, 0.05, -0.08, 0.004, 0.012, 0.26);
      if (p.detail) { paint(t, p.trim, ".", 0.9); box(t, 0, 0.088, -0.2, 0.008, 0.014, 0.012); box(t, 0, 0.088, 0.03, 0.024, 0.014, 0.012); }
      if (p.glyph) { paint(t, p.trim, p.glyph, 0.8); box(t, -0.027, 0.045, -0.05, 0.004, 0.045, 0.06); }
      return;
    case "shotgun":
      paint(t, p.metal, "=");
      box(t, -0.014, 0.062, -0.31, 0.026, 0.026, 0.62); box(t, 0.014, 0.062, -0.31, 0.026, 0.026, 0.62);
      paint(t, p.dark, "#"); box(t, 0, 0.034, -0.33, 0.052, 0.036, 0.16);
      paint(t, p.metal, "#", 0.8); box(t, 0, 0.05, -0.02, 0.05, 0.06, 0.16);
      paint(t, WOOD, "="); box(t, 0, 0.0, 0.18, 0.044, 0.07, 0.3);
      if (p.mag >= 0 && p.mag < 0.3) { paint(t, [200, 60, 50], "="); box(t, 0, 0.0 - p.mag, -0.1, 0.02, 0.02, 0.05); }
      paint(t, p.trim, "-", lit); box(t, 0, 0.08, -0.02, 0.03, 0.006, 0.14);
      if (p.detail) { paint(t, p.trim, ".", 0.9); box(t, 0, 0.082, -0.6, 0.01, 0.012, 0.012); }
      if (p.glyph) { paint(t, p.trim, p.glyph, 0.8); box(t, -0.026, 0.05, -0.02, 0.004, 0.04, 0.06); }
      return;
    case "rifle":
      paint(t, p.metal, "="); box(t, 0, 0.05, -0.08, 0.05, 0.07, 0.34);
      paint(t, p.dark, "-"); box(t, 0, 0.058, -0.43, 0.02, 0.02, 0.36);
      paint(t, p.dark, "#"); box(t, 0, 0.05, -0.33, 0.044, 0.052, 0.18);
      if (p.mag >= 0 && p.mag < 0.4) box(t, 0, -0.04 - p.mag, -0.12, 0.03, 0.12, 0.06);
      box(t, 0, -0.035, 0.03, 0.034, 0.09, 0.045);
      paint(t, p.dark, "="); box(t, 0, 0.035, 0.24, 0.036, 0.07, 0.26);
      paint(t, p.dark, "O"); box(t, 0, 0.106, -0.08, 0.03, 0.03, 0.15);
      paint(t, p.trim, "o", lit); box(t, 0, 0.106, -0.158, 0.024, 0.024, 0.006);
      paint(t, p.trim, "-", lit); box(t, 0.027, 0.05, -0.08, 0.004, 0.012, 0.3);
      if (p.glyph) { paint(t, p.trim, p.glyph, 0.8); box(t, -0.027, 0.045, -0.05, 0.004, 0.045, 0.06); }
      return;
    default:
      return;
  }
}
