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
  /** Side-plate size multiplier for the item glyph (first person embosses it larger). */
  emboss: number;
  /** Legendary signature effect drawn on the model ("" = none). */
  signature: WeaponSignature;
  /** Clock (s) for the signature's slow animation. */
  time: number;
}
/** Legendary signatures: Root Prompt's blinking optic cursor, the @ Sigil's gyro ring, the Bell
 * Character's slow ring ripple. All are smooth swells at <= 1 Hz (never a hard blink). */
export type WeaponSignature = "" | "cursor" | "ring" | "bell";
export const SIGNATURE_BY_ITEM: Readonly<Record<string, WeaponSignature>> = { "root-prompt": "cursor", "at-sigil": "ring", "bell-character": "bell" };
export const defaultWeaponPaint = (): WeaponPaint => ({ metal: [150, 158, 168], dark: [44, 48, 56], trim: [168, 174, 178], glyph: "", mag: 0, detail: true, charge: 0, emboss: 1, signature: "", time: 0 });
/** 0..1 cursor blink: on for half a second, a 0.12 s ease each way (1 Hz, no hard edge). */
export const cursorBlink = (time: number): number => { const u = ((time % 1) + 1) % 1; return u < 0.12 ? u / 0.12 : u < 0.5 ? 1 : u < 0.62 ? 1 - (u - 0.5) / 0.12 : 0; };

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
  drawBody(t, model, p);
  if (p.signature && p.detail) drawSignature(t, model, p);
}

/** Item glyph on a side plate (x = side offset); larger in first person. */
function plate(t: PropCanvas, p: WeaponPaint, x: number, y: number, z: number, h: number, d: number): void {
  if (!p.glyph) return;
  const e = p.emboss;
  paint(t, p.trim, p.glyph, 0.85); box(t, x, y, z, 0.004 * e, h * e, d * e);
}

/** Bright top edge along a metal part (a specular line that gives the silhouette its form). */
function edge(t: PropCanvas, p: WeaponPaint, x: number, y: number, z: number, w: number, d: number): void {
  if (!p.detail) return;
  paint(t, p.metal, "-", 1.32); box(t, x, y, z, w, 0.006, d);
}

function drawSignature(t: PropCanvas, model: WeaponModel, p: WeaponPaint): void {
  const time = p.time;
  if (p.signature === "cursor" && model === "rifle") {
    // A terminal cursor in the optic's rear lens and a prompt caret on its flank.
    const k = cursorBlink(time);
    paint(t, p.trim, "_", 0.35 + 0.75 * k); box(t, 0, 0.098, 0.0, 0.026, 0.012, 0.006);
    paint(t, p.trim, ">", 0.9); box(t, -0.017, 0.106, -0.1, 0.004, 0.022, 0.03);
  } else if (p.signature === "ring" && model === "blade") {
    // The ring-blade's field: a gyro ring precessing slowly round the guard.
    t.push(); t.translate(0, 0, -0.065); t.rotateZ(time * 36); t.rotateX(62);
    paint(t, p.trim, "@", 0.95); t.torus(0.115, 0.009);
    t.pop();
    const u = (time * 0.35) % 1, z = -0.2 - u * 0.62;
    paint(t, p.trim, "o", 0.5 + 0.5 * Math.sin(u * Math.PI)); t.push(); t.translate(0, 0, z); t.rotateX(90); t.torus(0.05, 0.006); t.pop();
  } else if (p.signature === "bell" && (model === "blunt")) {
    // The bell's ring: one soft ripple off the head every two seconds.
    const u = (time * 0.5) % 1;
    paint(t, p.trim, u < 0.5 ? "o" : ".", 0.95 * (1 - u));
    t.push(); t.translate(0, 0, -0.62); t.rotateX(90); t.torus(0.09 + 0.2 * u, 0.008 + 0.004 * (1 - u)); t.pop();
  }
}

function drawBody(t: PropCanvas, model: WeaponModel, p: WeaponPaint): void {
  const lit = 0.75 + p.charge * 0.25;
  switch (model) {
    case "blade":
      // Cyber-katana: pommel, cord-wrapped grip, a wide guard, long blade with a lit edge and a
      // clipped (tanto) tip - the longest, thinnest silhouette of all.
      paint(t, p.dark, "o"); box(t, 0, 0, 0.15, 0.046, 0.046, 0.04);
      paint(t, p.dark, "x"); box(t, 0, 0, 0.05, 0.036, 0.038, 0.17);
      paint(t, p.metal, "=", 0.95); box(t, 0, 0, -0.045, 0.13, 0.05, 0.03);
      paint(t, p.dark, "#"); box(t, 0, 0, -0.07, 0.05, 0.044, 0.024);
      paint(t, p.metal, "|", 1.05); box(t, 0, 0.004, -0.44, 0.016, 0.054, 0.72);
      box(t, 0, 0.014, -0.84, 0.014, 0.034, 0.1);
      edge(t, p, 0, 0.032, -0.44, 0.012, 0.7);
      // The edge carries the light: a thin strip along the underside.
      paint(t, p.trim, "-", lit); box(t, 0, -0.026, -0.46, 0.02, 0.012, 0.76);
      plate(t, p, 0.026, 0, -0.045, 0.036, 0.024);
      return;
    case "blunt":
      // Sledge: taped grip, steel shaft, a heavy head across the swing with a lit band and a spike.
      paint(t, p.dark, "="); box(t, 0, 0, 0.06, 0.044, 0.044, 0.2);
      paint(t, p.metal, "|", 0.85); box(t, 0, 0, -0.3, 0.04, 0.04, 0.54);
      paint(t, p.metal, "#"); box(t, 0, 0, -0.62, 0.22, 0.12, 0.13);
      paint(t, p.dark, "#"); box(t, 0.13, 0, -0.62, 0.05, 0.14, 0.15); box(t, -0.13, 0, -0.62, 0.05, 0.14, 0.15);
      edge(t, p, 0, 0.064, -0.62, 0.2, 0.11);
      paint(t, p.trim, "+", lit); box(t, 0, 0, -0.62, 0.236, 0.03, 0.03);
      paint(t, p.metal, "^", 1.1); box(t, 0, 0, -0.72, 0.03, 0.03, 0.08);
      plate(t, p, 0.024, 0, -0.18, 0.03, 0.04);
      return;
    case "baton":
      // Stun baton: grip, guard ring, slim shaft, twin prongs with a live arc between them.
      paint(t, p.dark, "="); box(t, 0, 0, 0.05, 0.04, 0.04, 0.18);
      paint(t, p.trim, "-", 0.7); box(t, 0, 0, -0.03, 0.056, 0.056, 0.02);
      paint(t, p.metal, "=", 0.6); box(t, 0, 0, -0.21, 0.034, 0.034, 0.34);
      edge(t, p, 0, 0.018, -0.21, 0.02, 0.32);
      paint(t, p.metal, "|", 0.9); box(t, 0.014, 0, -0.41, 0.01, 0.01, 0.08); box(t, -0.014, 0, -0.41, 0.01, 0.01, 0.08);
      // Stun tip: always lit, brighter while charged / swinging.
      paint(t, [120, 232, 255], "*", 0.8 + p.charge * 0.2); box(t, 0, 0, -0.43, 0.03 + 0.012 * p.charge, 0.03 + 0.012 * p.charge, 0.05);
      plate(t, p, 0.021, 0, 0.05, 0.026, 0.04);
      return;
    case "pistol":
      // Slide over a dark frame, raked grip, trigger guard, three-dot sights.
      paint(t, p.metal, "="); box(t, 0, 0.05, -0.07, 0.036, 0.046, 0.21);
      edge(t, p, 0, 0.074, -0.07, 0.03, 0.2);
      paint(t, p.dark, "#"); box(t, 0, 0.015, -0.06, 0.034, 0.028, 0.16);
      box(t, 0, -0.012, -0.045, 0.012, 0.03, 0.05);
      t.push(); t.translate(0, 0.045, 0.012); t.rotateX(-14);
      paint(t, p.dark, "#"); box(t, 0, 0, 0, 0.036, 0.11, 0.05);
      t.pop();
      if (p.mag >= 0 && p.mag < 0.3) { paint(t, p.dark, "="); box(t, 0, -0.11 - p.mag, 0.025, 0.028, 0.02, 0.04); }
      paint(t, p.trim, "-", lit); box(t, 0.02, 0.052, -0.07, 0.004, 0.01, 0.17);
      if (p.detail) { paint(t, p.trim, ".", 0.9); box(t, 0, 0.081, -0.16, 0.008, 0.012, 0.012); box(t, 0, 0.081, 0.02, 0.022, 0.012, 0.012); }
      plate(t, p, -0.02, 0.045, -0.04, 0.034, 0.05);
      return;
    case "smg":
      // Boxy receiver, shrouded barrel, long straight magazine ahead of the grip, vertical fore-grip.
      paint(t, p.metal, "="); box(t, 0, 0.045, -0.08, 0.05, 0.07, 0.3);
      edge(t, p, 0, 0.082, -0.08, 0.04, 0.28);
      paint(t, p.dark, "o"); box(t, 0, 0.05, -0.29, 0.036, 0.036, 0.13);
      paint(t, p.dark, "#"); box(t, 0, -0.035, 0.03, 0.034, 0.09, 0.045);
      if (p.mag >= 0 && p.mag < 0.4) { paint(t, p.dark, "="); box(t, 0, -0.07 - p.mag, -0.11, 0.028, 0.19, 0.045); }
      paint(t, p.dark, "|"); box(t, 0, -0.02, -0.23, 0.03, 0.07, 0.035);
      paint(t, p.dark, "-"); box(t, 0, 0.06, 0.13, 0.012, 0.012, 0.13); box(t, 0, 0.01, 0.13, 0.012, 0.012, 0.13);
      paint(t, p.dark, "|"); box(t, 0, 0.035, 0.2, 0.03, 0.07, 0.02);
      paint(t, p.trim, "-", lit); box(t, 0.027, 0.05, -0.08, 0.004, 0.012, 0.26);
      if (p.detail) { paint(t, p.trim, ".", 0.9); box(t, 0, 0.088, -0.2, 0.008, 0.014, 0.012); box(t, 0, 0.088, 0.03, 0.024, 0.014, 0.012); }
      plate(t, p, -0.027, 0.045, -0.05, 0.045, 0.06);
      return;
    case "shotgun":
      // Twin barrels over a ribbed pump, wooden stock, red shells in a side carrier.
      paint(t, p.metal, "=");
      box(t, -0.014, 0.062, -0.31, 0.026, 0.026, 0.62); box(t, 0.014, 0.062, -0.31, 0.026, 0.026, 0.62);
      edge(t, p, 0, 0.077, -0.31, 0.04, 0.6);
      paint(t, p.dark, "#"); box(t, 0, 0.032, -0.33, 0.056, 0.04, 0.17);
      paint(t, p.metal, "#", 0.8); box(t, 0, 0.05, -0.02, 0.05, 0.06, 0.16);
      paint(t, WOOD, "="); box(t, 0, 0.0, 0.18, 0.044, 0.07, 0.3);
      if (p.mag >= 0 && p.mag < 0.3) { paint(t, [200, 60, 50], "="); box(t, 0, 0.0 - p.mag, -0.1, 0.02, 0.02, 0.05); }
      if (p.detail) { paint(t, [190, 56, 46], "o"); for (let i = 0; i < 3; i++) box(t, -0.03, 0.05, -0.05 + i * 0.03, 0.012, 0.022, 0.018); }
      paint(t, p.trim, "-", lit); box(t, 0, 0.08, -0.02, 0.03, 0.006, 0.14);
      if (p.detail) { paint(t, p.trim, ".", 0.9); box(t, 0, 0.082, -0.6, 0.01, 0.012, 0.012); }
      plate(t, p, 0.026, 0.05, -0.02, 0.04, 0.06);
      return;
    case "rifle":
      // Long receiver, scope on top, curved mag, full stock: the longest gun.
      paint(t, p.metal, "="); box(t, 0, 0.05, -0.08, 0.05, 0.07, 0.34);
      paint(t, p.dark, "-"); box(t, 0, 0.058, -0.43, 0.02, 0.02, 0.36);
      paint(t, p.dark, "#"); box(t, 0, 0.05, -0.33, 0.044, 0.052, 0.18);
      if (p.mag >= 0 && p.mag < 0.4) { t.push(); t.translate(0, 0.04 + p.mag, -0.12); t.rotateX(-12); box(t, 0, 0, 0, 0.03, 0.12, 0.06); t.pop(); }
      box(t, 0, -0.035, 0.03, 0.034, 0.09, 0.045);
      paint(t, p.dark, "="); box(t, 0, 0.035, 0.24, 0.036, 0.07, 0.26);
      paint(t, p.dark, "O"); box(t, 0, 0.106, -0.08, 0.03, 0.03, 0.15);
      edge(t, p, 0, 0.124, -0.08, 0.02, 0.14);
      paint(t, p.trim, "o", lit); box(t, 0, 0.106, -0.158, 0.024, 0.024, 0.006);
      paint(t, p.trim, "-", lit); box(t, 0.027, 0.05, -0.08, 0.004, 0.012, 0.3);
      plate(t, p, -0.027, 0.045, -0.05, 0.045, 0.06);
      return;
    default:
      return;
  }
}
