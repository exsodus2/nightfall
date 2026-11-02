import type { NpcLook } from "./npcs.ts";
import type { HumanArms } from "./human-model.ts";
import { parkBlock } from "./park.ts";
import { BLOCK_SIZE, HALF_BLOCKS, LANDMARKS, blockKey, districtAt, randomFor, type Block, type Building, type RGB } from "./world.ts";

// Typed colour sets (strict: a number[] literal is not an RGB tuple).
const BAG_COLOURS: readonly RGB[] = [[60, 60, 70], [80, 70, 60], [50, 66, 60]];
const SPRAY_COLOURS: readonly RGB[] = [[255, 80, 160], [80, 220, 255], [200, 255, 90]];
const LED_COLOURS: readonly RGB[] = [[80, 255, 170], [255, 190, 70], [80, 200, 255], [80, 255, 170]];

/**
 * Themed alleys (alley-scene.ts draws them). Every block's four plots leave a cross of alleys
 * between them: two arms running along z (north and south of the crossing at local 32, 32) and two
 * along x (west and east). Each arm gets a theme, seeded per block and weighted by district, so the
 * four arms of a block always differ and an arm never repeats the one facing it across the street.
 *
 * A layout is static data in world coordinates: wall-hugging parts (boxes and ellipsoids), a few
 * slow "breathing" lights, animated actors (drips, ripples, steam, figures, a cat) and letter
 * panels. Rules every layout keeps (tests/alley-layouts.test.ts checks them):
 * - nothing at ground level (below 2.4 m) closer to the alley centre than `reach` from its wall,
 *   so a walking line of at least 1.8 m stays open down every arm (props have no collision);
 * - nothing at ground level nearer the street than s = 10 m (the 7.2 m walking lines and the
 *   rail portal legs at 9 m stay clear);
 * - lights pulse at most at 0.4 Hz; nothing strobes.
 */

export const ALLEY_THEMES = ["kitchen", "shrine", "squat", "workshop", "market", "pipes", "flooded", "graffiti", "data", "garden"] as const;
export type AlleyTheme = (typeof ALLEY_THEMES)[number];
export type AlleySide = "n" | "s" | "w" | "e";

/** Themes that live mostly flat on the walls or overhead; the narrow avenue-side arms only get these. */
export const FLUSH_THEMES: readonly AlleyTheme[] = ["graffiti", "pipes", "garden", "data"];
const FLUSH = FLUSH_THEMES;
/** District favourites (world.ts DISTRICTS order). */
const FAVOURITES: readonly (readonly AlleyTheme[])[] = [
  ["workshop", "kitchen", "pipes", "squat"], // The Foundry
  ["graffiti", "market", "data", "kitchen"], // Neon Ward
  ["data", "shrine", "pipes", "graffiti"], // Ghost Circuit
  ["garden", "flooded", "shrine", "kitchen"], // Rain Gardens
  ["market", "kitchen", "shrine", "graffiti"], // Silk Market
  ["flooded", "squat", "pipes", "workshop"], // The Spillway
];
/** The colour an alley's mouth glows with, so the street hints at what is inside. */
export const THEME_GLOW: Readonly<Record<AlleyTheme, RGB>> = {
  kitchen: [255, 176, 96], shrine: [255, 72, 58], squat: [255, 138, 62], workshop: [130, 200, 255], market: [255, 84, 200],
  pipes: [255, 190, 70], flooded: [80, 200, 255], graffiti: [190, 255, 90], data: [80, 255, 170], garden: [214, 112, 255],
};
const SIGN_WORDS: Readonly<Partial<Record<AlleyTheme, readonly string[]>>> = {
  kitchen: ["NOODLES", "DUMPLING", "KITCHEN", "RAMEN"], workshop: ["WELDING", "REPAIRS", "FAB"], market: ["BAZAAR", "NO ASK"],
  data: ["NET", "SIGNAL", "UPLINK"], garden: ["GROW", "FLORA"], squat: ["HOSTEL"],
};
/** Words for the projecting blade sign over a black-market stall. */
const BLADE_WORDS = ["CHROME", "BLADES", "PARTS", "MEDS", "RIGS"];

/** Avenue-side arms running along z (block columns 0 and -1) sit beside a 13 m avenue plot and are 2.5-6 m wide. */
const narrowArm = (bx: number, side: AlleySide): boolean => (bx === 0 || bx === -1) && (side === "n" || side === "s");
const SIDES: readonly AlleySide[] = ["s", "e", "n", "w"];

/** Theme preference order for a block: district favourites first, shuffled by the block seed. */
function preference(bx: number, bz: number): AlleyTheme[] {
  const district = districtAt(bx * BLOCK_SIZE + 32, bz * BLOCK_SIZE + 32).id, favourites = FAVOURITES[district];
  const keyed = ALLEY_THEMES.map((theme, i) => ({ theme, key: randomFor(bx * 13 + i, bz * 7 + 3, 9101) - (favourites.includes(theme) ? 0.55 : 0) }));
  return keyed.sort((a, b) => a.key - b.key).map(entry => entry.theme);
}
function firstOf(order: readonly AlleyTheme[], avoid: readonly AlleyTheme[], narrow: boolean): AlleyTheme {
  const pool = narrow ? order.filter(theme => FLUSH.includes(theme)) : order;
  return pool.find(theme => !avoid.includes(theme)) ?? pool[0];
}
/** The south and east arms choose first (they depend on nothing outside the block). */
function primary(bx: number, bz: number): { s: AlleyTheme; e: AlleyTheme } {
  const order = preference(bx, bz);
  const s = firstOf(order, [], narrowArm(bx, "s"));
  return { s, e: firstOf(order, [s], narrowArm(bx, "e")) };
}
/**
 * The theme of an arm. The north arm avoids the south arm across its street (block bz - 1), the
 * west arm the east arm across its street (block bx - 1); all four arms of a block differ.
 * Deterministic and world-free (it does not say whether the arm has buildings).
 */
export function alleyTheme(bx: number, bz: number, side: AlleySide): AlleyTheme {
  const own = primary(bx, bz);
  if (side === "s" || side === "e") return own[side];
  const order = preference(bx, bz);
  const n = firstOf(order, [own.s, own.e, primary(bx, bz - 1).s], narrowArm(bx, "n"));
  if (side === "n") return n;
  return firstOf(order, [own.s, own.e, n, primary(bx - 1, bz).e], narrowArm(bx, "w"));
}

export interface AlleyPart {
  x: number; y: number; z: number; w: number; h: number; d: number;
  color: RGB; glyph: string; gain: number;
  /** Draw distance in metres (detail is culled by the arm's distance). */
  near: number;
  round: boolean;
  /** Lit parts are never drawn thinner than a cell (they would blink in and out as the camera moves). */
  lit: boolean;
  /** Slow breathing of the gain: rate in rad/s (<= 2.5, i.e. 0.4 Hz), depth and phase. */
  pulse?: { rate: number; depth: number; phase: number };
}
export type AlleyActor =
  | { kind: "drip"; x: number; y: number; z: number; seed: number }
  | { kind: "ripple"; x: number; z: number; axis: "x" | "z"; span: number; length: number; seed: number }
  | { kind: "steam"; x: number; z: number; seed: number }
  | { kind: "figure"; x: number; z: number; facing: number; look: NpcLook; seated: boolean; arms?: HumanArms; seed: number }
  | { kind: "cat"; x: number; y: number; z: number; facing: number; color: RGB; seed: number };
export interface AlleySign { x: number; y: number; z: number; yaw: number; width: number; height: number; text: string; color: RGB; vertical: boolean; seed: number }

export interface AlleyArm {
  bx: number; bz: number; side: AlleySide; theme: AlleyTheme; district: number;
  /** The axis the alley runs along, and the world coordinate of its centre line on the other axis. */
  axis: "x" | "z"; mid: number;
  /** Clear width between the two faces, and how far ground-level props may reach out from a wall. */
  width: number; reach: number;
  /** Where the arm meets its street (centre of the mouth) and its middle, for culling. */
  mouthX: number; mouthZ: number; cx: number; cz: number; radius: number;
  parts: AlleyPart[]; actors: AlleyActor[]; signs: AlleySign[];
  /** Mouth hint parts, drawn from further away than the rest. */
  mouth: AlleyPart[];
}

/** Below this, a part is at walking height and must stay within `reach` of its wall. */
export const GROUND_TOP = 2.4;
/** Ground-level props start this far in from the street centre line (walking lines at 7.2 m, portal legs at 9 m). */
export const MOUTH_CLEAR = 10;
const MIN_WIDTH = 2.3;

// Palette.
const METAL: RGB = [52, 58, 66], DARK: RGB = [34, 38, 44], RUST: RGB = [104, 66, 46], WOOD: RGB = [112, 84, 58], CRATE: RGB = [124, 96, 62];
const BIN: RGB = [40, 72, 58], LID: RGB = [30, 52, 44], CLOTH: RGB = [176, 42, 44], PAPER: RGB = [196, 186, 156], LEAF: RGB = [44, 96, 54];
const WARM: RGB = [255, 196, 128], EMBER: RGB = [255, 116, 40], FLAME: RGB = [255, 184, 86], TERRACOTTA: RGB = [146, 82, 58];

/** Builds one arm's parts in its own frame: s runs inward from the street centre line, v across. */
class Composer {
  readonly parts: AlleyPart[] = [];
  readonly actors: AlleyActor[] = [];
  readonly signs: AlleySign[] = [];
  readonly mouth: AlleyPart[] = [];
  readonly arm: AlleyArm;
  readonly vA: number;
  readonly vB: number;
  readonly range: readonly [readonly [number, number], readonly [number, number]];
  private readonly origin: number;
  private readonly dir: 1 | -1;
  private readonly seed: number;
  private readonly cursor: [number, number];
  private salt = 0;
  constructor(arm: AlleyArm, origin: number, dir: 1 | -1, vA: number, vB: number, range: readonly [readonly [number, number], readonly [number, number]], seed: number) {
    this.arm = arm; this.origin = origin; this.dir = dir; this.vA = vA; this.vB = vB; this.range = range; this.seed = seed;
    this.cursor = [range[0][0] + 0.3 + this.rand() * 1.2, range[1][0] + 0.3 + this.rand() * 1.2];
  }
  rand(): number { return randomFor(this.seed, this.salt++, 9203); }
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.rand() * list.length) % list.length]; }
  /** World position of (s, v). */
  at(s: number, v: number): [number, number] {
    const along = this.origin + this.dir * s, across = this.arm.mid + v;
    return this.arm.axis === "z" ? [across, along] : [along, across];
  }
  /** World (dx, dz) of a direction given in the arm frame. */
  vector(ds: number, dv: number): [number, number] {
    return this.arm.axis === "z" ? [dv, this.dir * ds] : [this.dir * ds, dv];
  }
  /** rotateY degrees that make a figure (facing -z at 0) face the frame direction (ds, dv). */
  facing(ds: number, dv: number): number { const [fx, fz] = this.vector(ds, dv); return Math.atan2(-fx, -fz) * 180 / Math.PI; }
  /** Panel yaw (a rect at yaw 0 faces +z) to face the frame direction (ds, dv). */
  panelYaw(ds: number, dv: number): number { const [fx, fz] = this.vector(ds, dv); return Math.atan2(fx, fz) * 180 / Math.PI; }
  /** v of a point `offset` metres out from wall 0 (A) or 1 (B). */
  wallV(side: 0 | 1, offset: number): number { return side === 0 ? this.vA + offset : this.vB - offset; }
  /** Unit vector (in v) pointing from wall `side` into the alley. */
  inward(side: 0 | 1): number { return side === 0 ? 1 : -1; }
  /** Reserves `length` metres along wall `side`; null when the wall has no room left. */
  slot(side: 0 | 1, length: number, gap = 0.4 + this.rand() * 1.2): number | null {
    const start = this.cursor[side], end = start + length;
    if (end > this.range[side][1] - 0.2) return null;
    this.cursor[side] = end + gap;
    return start + length / 2;
  }
  /** Marks a wall as full (a composition took the rest of it). */
  close(side: 0 | 1): void { this.cursor[side] = this.range[side][1]; }
  /** Room left on a wall, in metres. */
  room(side: 0 | 1): number { return this.range[side][1] - 0.2 - this.cursor[side]; }
  /**
   * A part centred at (s, v, y) with size along s, across v and height h. Ground-level parts that
   * would reach past `reach` from their wall, or sit nearer the street than MOUTH_CLEAR, are dropped.
   */
  part(s: number, v: number, y: number, along: number, across: number, h: number, color: RGB, glyph: string,
    options: { gain?: number; near?: number; round?: boolean; lit?: boolean; pulse?: AlleyPart["pulse"]; mouth?: boolean } = {}): AlleyPart | null {
    // Flat things on the floor (water, planks, a hose) are walked over, not around.
    const ground = y - h / 2 < GROUND_TOP, flat = y + h / 2 <= 0.2;
    if (ground && flat && s - along / 2 < MOUTH_CLEAR - 0.6) return null;
    if (ground && !flat) {
      const fromA = v + across / 2 - this.vA, fromB = this.vB - (v - across / 2);
      if (Math.min(fromA, fromB) > this.arm.reach + 1e-6) return null;
      if (s - along / 2 < MOUTH_CLEAR) return null;
    }
    const [x, z] = this.at(s, v);
    const [w, d] = this.arm.axis === "z" ? [across, along] : [along, across];
    const lit = options.lit ?? (options.gain ?? 1) >= 0.9;
    const made: AlleyPart = { x, y, z, w, h, d, color, glyph, gain: options.gain ?? 0.85, near: options.near ?? 70, round: options.round ?? false, lit, ...(options.pulse ? { pulse: options.pulse } : {}) };
    (options.mouth ? this.mouth : this.parts).push(made);
    return made;
  }
  /** A part against wall `side`: `offset` is the distance of its back from the wall. */
  onWall(side: 0 | 1, s: number, y: number, along: number, depth: number, h: number, color: RGB, glyph: string,
    options: Parameters<Composer["part"]>[8] = {}, offset = 0.02): AlleyPart | null {
    return this.part(s, this.wallV(side, offset + depth / 2), y, along, depth, h, color, glyph, options);
  }
  figure(side: 0 | 1, s: number, offset: number, faceS: number, faceV: number, look: NpcLook, seated: boolean, arms?: HumanArms): void {
    // A figure is about 0.5 m deep: keep it within reach like any ground-level prop.
    if (offset + 0.3 > this.arm.reach || s < MOUTH_CLEAR + 0.5) return;
    const [x, z] = this.at(s, this.wallV(side, offset));
    this.actors.push({ kind: "figure", x, z, facing: this.facing(faceS, faceV), look, seated, ...(arms ? { arms } : {}), seed: Math.floor(this.rand() * 997) });
  }
  sign(s: number, v: number, y: number, faceS: number, faceV: number, width: number, height: number, text: string, color: RGB, vertical = false): void {
    const [x, z] = this.at(s, v);
    // Mode 3 of the sign shader (floor(seed * 97) mod 4): a slow 0.2 Hz pulse, never a stutter.
    const seed = (3.5 + 4 * Math.floor(this.rand() * 23)) / 97;
    this.signs.push({ x, y, z, yaw: this.panelYaw(faceS, faceV), width, height, text, color, vertical, seed });
  }
}

const look = (coat: RGB, trim: RGB, light: RGB, headwear: NpcLook["headwear"], skin: RGB = [190, 150, 118]): NpcLook => ({ coat, trim, skin, light, headwear, prop: null, idle: "breathe" });

/** A crate, sometimes a stack of them. Returns the top height. */
function crates(c: Composer, side: 0 | 1, s: number, count: number): number {
  let y = 0;
  for (let k = 0; k < count; k++) {
    const size = 0.55 + c.rand() * 0.25, shift = (c.rand() - 0.5) * 0.15;
    c.onWall(side, s + shift, y + size / 2, size, Math.min(size, c.arm.reach - 0.05), size, k % 2 ? CRATE : [104, 80, 52], "#", { near: 60 });
    y += size;
  }
  return y;
}
function bin(c: Composer, side: 0 | 1, s: number): number {
  c.onWall(side, s, 0.55, 1.1, 0.7, 1.1, BIN, "H", { near: 70 });
  c.onWall(side, s, 1.14, 1.16, 0.74, 0.08, LID, "=", { near: 45 });
  return 1.18;
}
function cat(c: Composer, side: 0 | 1, s: number, y: number, offset: number): void {
  const [x, z] = c.at(s, c.wallV(side, offset));
  const colors: readonly RGB[] = [[40, 38, 40], [150, 104, 60], [176, 170, 160], [96, 90, 86]];
  c.actors.push({ kind: "cat", x, y, z, facing: c.facing(c.rand() > 0.5 ? -1 : 1, c.inward(side) * 0.6), color: c.pick(colors), seed: Math.floor(c.rand() * 997) });
}
function drip(c: Composer, s: number, v: number, y: number): void {
  const [x, z] = c.at(s, v);
  c.actors.push({ kind: "drip", x, y, z, seed: c.rand() * 10 });
  c.part(s, v, 0.015, 0.7, Math.min(0.6, 0.3 + c.arm.reach), 0.02, [36, 60, 76], "~", { gain: 0.8, near: 35, round: true, lit: false });
}
/** Wall lamp in a cage. */
function lamp(c: Composer, side: 0 | 1, s: number, y: number, color: RGB): void {
  c.onWall(side, s, y, 0.3, 0.22, 0.3, color, "o", { gain: 1.0, near: 120 });
}

function kitchen(c: Composer): void {
  const door = c.slot(0, 1.4);
  if (door !== null) {
    c.onWall(0, door, 1.05, 1.0, 0.05, 2.1, WARM, "#", { gain: 0.9, near: 90 });
    lamp(c, 0, door, 2.55, [255, 214, 150]);
    c.sign(door, c.wallV(0, 0.06), 2.95, 0, c.inward(0), 1.6, 0.42, c.pick(SIGN_WORDS.kitchen ?? ["KITCHEN"]), THEME_GLOW.kitchen);
    // The cook on a break beside the door, smoking, facing across the alley.
    c.figure(0, door + 1.1, 0.35, 0.3, c.inward(0), look([214, 212, 204], [150, 150, 146], [255, 170, 90], "cap"), false, "smoke");
    c.slot(0, 1.2);
  }
  for (let k = 0; k < 2; k++) {
    const fan = c.slot(0, 1.1);
    if (fan === null) break;
    c.onWall(0, fan, 3.3 + k * 0.6, 1.0, 0.5, 0.9, METAL, "#", { near: 80 });
    c.onWall(0, fan, 3.3 + k * 0.6, 0.76, 0.04, 0.66, [118, 124, 130], "+", { near: 40 }, 0.5);
    if (k === 0) { const [x, z] = c.at(fan, c.wallV(0, 0.8)); c.actors.push({ kind: "steam", x, z, seed: c.rand() }); }
  }
  const stack = c.slot(1, 1.0);
  if (stack !== null) crates(c, 1, stack, 2 + Math.floor(c.rand() * 3));
  for (let k = 0; k < 2; k++) {
    const at = c.slot(1, 1.2, 0.15);
    if (at === null) break;
    const top = bin(c, 1, at);
    if (k === 0 && c.rand() < 0.7) cat(c, 1, at, top, 0.4);
  }
  const greens = c.slot(1, 0.8);
  if (greens !== null) {
    c.onWall(1, greens, 0.25, 0.7, 0.5, 0.5, CRATE, "#", { near: 50 });
    for (let k = 0; k < 3; k++) c.part(greens + (k - 1) * 0.2, c.wallV(1, 0.27), 0.55, 0.2, 0.2, 0.18, [70, 130, 60], "o", { near: 25, round: true });
  }
}

function shrine(c: Composer): void {
  // A torii-red frame across the mouth, then lanterns overhead and the altar deep inside.
  const s0 = Math.max(c.range[0][0], c.range[1][0], MOUTH_CLEAR) + 1.2, red: RGB = [190, 40, 34];
  for (const side of [0, 1] as const) c.part(s0, c.wallV(side, 0.15), 1.9, 0.26, 0.26, 3.8, red, "|", { near: 140, mouth: true });
  c.part(s0, (c.vA + c.vB) / 2, 3.75, 0.3, c.vB - c.vA - 0.1, 0.26, red, "=", { near: 140, mouth: true });
  c.part(s0, (c.vA + c.vB) / 2, 4.15, 0.36, c.vB - c.vA + 0.5, 0.2, [60, 26, 26], "=", { near: 140, mouth: true });
  for (let k = 0; k < 3; k++) c.part(s0 + 3 + k * 3.5, (c.vA + c.vB) / 2 + (k % 2 ? 0.4 : -0.4), 3.4, 0.4, 0.4, 0.55, [255, 70, 52], "o", { gain: 1.0, near: 120, round: true, pulse: { rate: 0.6, depth: 0.08, phase: k } });
  const side: 0 | 1 = c.room(0) >= c.room(1) ? 0 : 1, end = c.range[side][1] - 1.2;
  if (end - 1 < c.range[side][0]) return;
  c.close(side);
  c.onWall(side, end, 0.45, 1.4, 0.6, 0.9, [96, 28, 26], "#", { near: 80 });
  c.onWall(side, end, 0.93, 1.5, 0.62, 0.06, CLOTH, "=", { near: 60 });
  c.onWall(side, end, 1.35, 0.32, 0.3, 0.6, [255, 204, 112], "@", { gain: 1.0, near: 90, round: true, pulse: { rate: 0.5, depth: 0.06, phase: 0 } }, 0.08);
  // Candles and offerings on the altar.
  for (let k = 0; k < 5; k++) c.onWall(side, end - 0.6 + k * 0.3, 1.06, 0.06, 0.06, 0.2, [255, 196, 110], "i", { gain: 1.0, near: 30, pulse: { rate: 1.1 + k * 0.17, depth: 0.08, phase: k * 1.7 } }, 0.42);
  for (let k = 0; k < 3; k++) c.part(end - 0.45 + k * 0.45, c.wallV(side, 0.25), 1.05, 0.16, 0.16, 0.14, k === 1 ? [220, 210, 190] : [230, 120, 40], "o", { near: 25, round: true });
  // Paper charms on the wall above.
  for (let k = 0; k < 4; k++) c.onWall(side, end - 0.75 + k * 0.5, 2.0 + (k % 2) * 0.25, 0.16, 0.02, 0.5, PAPER, "=", { near: 35 });
  if (c.rand() < 0.6) c.figure(side, end - 1.6, 0.55, 1, -c.inward(side) * 0.6, look([70, 56, 66], [46, 40, 48], [255, 120, 80], "hood"), true);
}

function squat(c: Composer): void {
  const tarp = c.slot(0, 3.0);
  if (tarp !== null) {
    const depth = Math.min(1.3, c.arm.reach - 0.03);
    c.onWall(0, tarp, 2.25, 3.0, depth, 0.05, [52, 84, 124], "=", { near: 90 });
    c.part(tarp - 1.4, c.wallV(0, depth - 0.05), 1.1, 0.07, 0.07, 2.2, METAL, "|", { near: 30 });
    c.part(tarp + 1.4, c.wallV(0, depth - 0.05), 1.1, 0.07, 0.07, 2.2, METAL, "|", { near: 30 });
    // The lit tent under it: a dome glowing from inside.
    c.part(tarp - 0.4, c.wallV(0, Math.min(0.6, depth / 2)), 0.45, 1.7, Math.min(1.2, depth), 0.9, [236, 150, 92], "o", { gain: 0.62, near: 90, round: true, lit: true, pulse: { rate: 0.35, depth: 0.05, phase: c.rand() * 6 } });
    c.onWall(0, tarp + 1.0, 0.06, 1.0, Math.min(0.9, depth), 0.12, [120, 100, 72], "=", { near: 40 });
  }
  const fire = c.slot(1, 1.0);
  if (fire !== null) {
    const off = Math.min(0.75, c.arm.reach - 0.3);
    c.part(fire, c.wallV(1, off), 0.45, 0.6, 0.6, 0.9, RUST, "#", { near: 80 });
    c.part(fire, c.wallV(1, off), 0.95, 0.5, 0.5, 0.16, EMBER, "*", { gain: 1.0, near: 120, round: true, pulse: { rate: 1.5, depth: 0.1, phase: 0 } });
    c.part(fire, c.wallV(1, off), 1.18, 0.34, 0.34, 0.36, FLAME, "^", { gain: 1.0, near: 60, round: true, pulse: { rate: 2.2, depth: 0.12, phase: 1 } });
    c.figure(1, fire + 1.0, 0.35, -1, c.inward(1) * 0.4, look([88, 76, 62], [56, 50, 44], EMBER, c.rand() < 0.5 ? "hood" : "bare"), true);
    c.onWall(1, fire + 1.0, 0.22, 0.55, 0.5, 0.44, CRATE, "#", { near: 45 });
  }
  const bags = c.slot(1, 1.2);
  if (bags !== null) for (let k = 0; k < 3; k++) c.part(bags + (k - 1) * 0.42, c.wallV(1, 0.3), 0.28, 0.5, 0.5, 0.56, BAG_COLOURS[k], "o", { near: 40, round: true });
  // A string of warm bulbs across the alley.
  const string = c.range[0][0] + (c.range[0][1] - c.range[0][0]) * 0.6, span = c.vB - c.vA;
  c.part(string, (c.vA + c.vB) / 2, 3.2, 0.04, span, 0.04, DARK, "-", { near: 30 });
  for (let k = 1; k <= 4; k++) c.part(string, c.vA + span * k / 5, 3.05, 0.14, 0.14, 0.14, k % 2 ? [255, 210, 140] : [255, 150, 90], "o", { gain: 1.0, near: 80, round: true });
}

function workshop(c: Composer): void {
  const scaffold = c.slot(0, 3.0);
  if (scaffold !== null) {
    const depth = Math.min(0.9, c.arm.reach - 0.03);
    for (const ds of [-1.45, 1.45]) for (const off of [0.06, depth - 0.06]) c.part(scaffold + ds, c.wallV(0, off), 2.6, 0.1, 0.1, 5.2, [140, 150, 160], "|", { near: 45 });
    for (const y of [1.8, 3.6, 5.2]) c.onWall(0, scaffold, y, 3.0, depth, 0.08, [150, 118, 76], "=", { near: 80 });
    c.onWall(0, scaffold - 0.5, 3.9, 0.5, 0.4, 0.5, [84, 120, 160], "#", { near: 40 }, 0.2);
  }
  const bench = c.slot(1, 2.0);
  if (bench !== null) {
    c.onWall(1, bench, 0.45, 1.8, 0.7, 0.9, [86, 78, 70], "#", { near: 70 });
    c.onWall(1, bench - 0.5, 1.0, 0.3, 0.2, 0.2, METAL, "#", { near: 25 }, 0.2);
    // The weld: a blue-white glow on the bench and its wash on the wall, swelling slowly.
    c.onWall(1, bench + 0.3, 1.0, 0.18, 0.18, 0.18, [210, 236, 255], "*", { gain: 1.0, near: 120, round: true, pulse: { rate: 1.2, depth: 0.25, phase: 0 } }, 0.3);
    c.onWall(1, bench + 0.3, 1.6, 1.6, 0.03, 1.4, [70, 120, 170], ".", { gain: 0.75, near: 70, lit: true, pulse: { rate: 1.2, depth: 0.2, phase: 0 } }, 0.0);
    c.figure(1, bench + 0.3, 0.9, 0, -c.inward(1), look([70, 62, 54], [50, 46, 40], [130, 200, 255], "visor"), false, "push");
  }
  const tanks = c.slot(1, 0.9);
  if (tanks !== null) {
    c.onWall(1, tanks - 0.2, 0.6, 0.3, 0.3, 1.2, [60, 110, 72], "|", { near: 50 });
    c.onWall(1, tanks + 0.2, 0.6, 0.3, 0.3, 1.2, [150, 58, 48], "|", { near: 50 });
  }
  const tyres = c.slot(0, 0.9);
  if (tyres !== null) for (let k = 0; k < 3; k++) c.onWall(0, tyres, 0.12 + k * 0.24, 0.8, Math.min(0.8, c.arm.reach - 0.03), 0.22, [36, 36, 40], "O", { near: 40, round: true });
  const parts = c.slot(0, 1.2);
  if (parts !== null) { crates(c, 0, parts, 1); c.onWall(0, parts + 0.9, 0.55, 0.12, 1.1, 1.1, [130, 52, 42], "#", { near: 40 }); }
}

function market(c: Composer): void {
  const stall = c.slot(0, 2.6);
  if (stall === null) return;
  // The vendor stands against the wall, the table in front of them.
  const reach = c.arm.reach, tableAcross = Math.min(0.8, reach - 0.6), tableAt = 0.6 + tableAcross / 2;
  if (tableAcross < 0.35) return;
  c.part(stall, c.wallV(0, tableAt), 0.4, 2.2, tableAcross, 0.8, [70, 56, 48], "#", { near: 80 });
  const goods: readonly RGB[] = [[255, 70, 180], [80, 230, 255], [200, 255, 90], [255, 180, 70], [180, 120, 255], [230, 230, 240]];
  for (let k = 0; k < 6; k++) c.part(stall - 0.9 + k * 0.36, c.wallV(0, tableAt + (k % 2 ? 0.1 : -0.1)), 0.88, 0.22, 0.16, 0.12, goods[k], k % 3 ? "=" : "/", { gain: 0.95, near: 35 });
  c.part(stall, c.wallV(0, Math.min(1.35, reach + 0.3)), 2.85, 2.6, Math.min(1.5, reach + 0.6), 0.06, [130, 30, 70], "=", { gain: 0.7, near: 90 });
  for (let k = 0; k < 3; k++) c.part(stall - 1.0 + k, c.wallV(0, Math.min(1.3, reach + 0.2)), 2.62, 0.18, 0.18, 0.24, k % 2 ? [80, 230, 255] : [255, 84, 200], "o", { gain: 1.0, near: 100, round: true });
  c.figure(0, stall, 0.3, 0, c.inward(0), look([36, 32, 44], [24, 22, 30], [255, 84, 200], "hood"), false, "wrist");
  // The blade sign projecting over the stall, facing the street.
  const word = c.pick(BLADE_WORDS);
  c.sign(stall - 1.6, c.wallV(0, 0.55), 3.2 + word.length * 0.38, -1, 0, 0.8, word.length * 0.75 + 0.3, word, THEME_GLOW.market, true);
  const stock = c.slot(1, 1.2);
  if (stock !== null) { crates(c, 1, stock, 2); crates(c, 1, stock + 0.75, 1); }
}

function pipes(c: Composer): void {
  const colours: readonly RGB[] = [[80, 92, 98], RUST, [62, 94, 82], [96, 96, 104]];
  for (const side of [0, 1] as const) {
    const [from, to] = c.range[side], length = to - from - 0.4;
    if (length < 2) continue;
    const runs = side === 0 ? [2.8, 3.35, 4.3] : [3.0, 5.0];
    runs.forEach((y, k) => c.onWall(side, (from + to) / 2, y, length, 0.24, 0.24, colours[(k + side) % colours.length], "=", { near: 100 }, 0.06 + k * 0.08));
    for (let k = 0; k < 2; k++) {
      const drop = c.slot(side, 0.6, 1.5 + c.rand() * 2.5);
      if (drop === null) break;
      c.onWall(side, drop, 2.3, 0.3, 0.3, 4.6, colours[(k + 2) % colours.length], "|", { near: 80 }, 0.05);
      c.onWall(side, drop, 1.4, 0.5, 0.06, 0.06, [180, 40, 40], "+", { near: 25 }, 0.36);
      c.onWall(side, drop, 1.4, 0.06, 0.06, 0.5, [180, 40, 40], "+", { near: 25 }, 0.36);
      c.onWall(side, drop + 0.3, 2.0, 0.14, 0.06, 0.14, [230, 240, 200], "o", { gain: 0.95, near: 30, round: true }, 0.3);
      drip(c, drop + 0.6, c.wallV(side, 0.25), 2.75);
    }
  }
  const ladder = c.slot(1, 0.6);
  if (ladder !== null) {
    for (const ds of [-0.25, 0.25]) c.onWall(1, ladder + ds, 3.0, 0.07, 0.07, 6.0, [120, 126, 132], "|", { near: 40 }, 0.3);
    for (let y = 0.4; y < 6; y += 0.4) c.onWall(1, ladder, y, 0.5, 0.05, 0.05, [110, 116, 122], "-", { near: 22 }, 0.3);
  }
  const at = c.slot(0, 0.5);
  if (at !== null) lamp(c, 0, at, 2.6, THEME_GLOW.pipes);
  // Hazard band on wall A.
  if (c.range[0][1] - c.range[0][0] > 4) c.onWall(0, c.range[0][0] + 2.2, 0.5, 3.0, 0.02, 0.18, [210, 170, 40], "/", { near: 40 });
}

function flooded(c: Composer): void {
  const lo = Math.max(c.range[0][0], c.range[1][0], MOUTH_CLEAR) + 0.6, hi = Math.min(c.range[0][1], c.range[1][1]) - 0.2, span = c.vB - c.vA;
  if (hi - lo < 3) return;
  // The water covers the floor (flat, walkable); ripples and light streaks move on it slowly.
  c.part((lo + hi) / 2, (c.vA + c.vB) / 2, 0.03, hi - lo, span, 0.04, [22, 44, 60], "~", { gain: 0.8, near: 100, lit: false });
  const [x, z] = c.at((lo + hi) / 2, 0);
  for (let k = 0; k < 2; k++) c.actors.push({ kind: "ripple", x, z, axis: c.arm.axis, span: (hi - lo) * 0.4, length: span * 0.7, seed: k * 2.1 + c.rand() });
  for (let k = 0; k < 3; k++) c.part(lo + 1 + k * (hi - lo - 2) / 2, (k - 1) * span * 0.25, 0.055, 1.6, 0.26, 0.012, k === 1 ? THEME_GLOW.flooded : [255, 150, 90], "-", { gain: 0.75, near: 60, lit: true });
  // Planks on bricks along the dry side.
  const plankV = c.wallV(0, Math.min(0.5, c.arm.reach - 0.25));
  for (let s = lo + 0.4; s < hi - 0.9; s += 1.9) {
    c.part(s + 0.8, plankV, 0.12, 1.6, 0.45, 0.06, WOOD, "=", { near: 50 });
    c.part(s + 0.8, plankV, 0.05, 0.25, 0.3, 0.1, [96, 64, 54], "#", { near: 25 });
  }
  const at = c.slot(1, 0.5);
  if (at !== null) lamp(c, 1, at, 2.7, THEME_GLOW.flooded);
  for (let k = 0; k < 2; k++) drip(c, lo + 2 + k * 3.7, c.wallV(1, 0.3), 3.8);
  const debris = c.slot(1, 0.6);
  if (debris !== null) c.onWall(1, debris, 0.08, 0.4, 0.3, 0.1, [130, 120, 100], "#", { near: 25 }, 0.4);
}

/** A big mural on wall `side` between along-coordinates s - len/2 .. s + len/2. */
function mural(c: Composer, side: 0 | 1, s: number, len: number, kind: number): void {
  const flat = (ds: number, y: number, along: number, h: number, color: RGB, glyph: string, layer: number, gain = 0.8, round = false) =>
    c.onWall(side, s + ds, y, along, 0.03, h, color, glyph, { gain, near: 90, round, lit: false }, 0.01 + layer * 0.015);
  if (kind === 0) {
    // Sunset: banded sky, a sun and dark skyline teeth.
    const bands: readonly RGB[] = [[150, 50, 120], [220, 70, 110], [255, 120, 70], [255, 180, 80]];
    bands.forEach((color, k) => flat(0, 4.4 - k * 0.7, len, 0.72, color, k % 2 ? "=" : "-", 0));
    flat(0, 3.2, len * 0.32, len * 0.32, [255, 226, 120], "o", 1, 0.95, true);
    for (let k = 0; k < 6; k++) flat(-len / 2 + len * (k + 0.5) / 6, 1.9 + (k % 3) * 0.35, len / 7, 1.2 + (k % 3) * 0.7, [26, 22, 40], "#", 2);
  } else if (kind === 1) {
    // An eye.
    flat(0, 3.2, len, 3.0, [30, 40, 70], ".", 0);
    flat(0, 3.2, len * 0.8, 1.6, [222, 220, 208], "o", 1, 0.85, true);
    flat(0, 3.2, 1.3, 1.3, [60, 210, 230], "@", 2, 0.95, true);
    flat(0, 3.2, 0.55, 0.55, [10, 10, 14], "#", 3, 1, true);
  } else if (kind === 2) {
    // An oni mask.
    flat(0, 3.3, len * 0.55, 2.6, [200, 46, 40], "%", 0, 0.85, true);
    for (const ds of [-0.5, 0.5]) { flat(ds * len * 0.3, 3.75, 0.6, 0.38, [240, 236, 200], "o", 1, 0.9, true); flat(ds * len * 0.38, 4.75, 0.25, 0.8, [230, 220, 180], "^", 1); }
    flat(0, 2.6, len * 0.3, 0.26, [20, 16, 18], "=", 1);
    for (let k = 0; k < 4; k++) flat(-0.45 + k * 0.3, 2.62, 0.1, 0.22, [236, 236, 230], "v", 2);
  } else {
    // An ASCII glyph wall: tiles of colour, each its own glyph.
    const glyphs = ["@", "%", "#", "&", "$", "*"], colours: readonly RGB[] = [[255, 80, 160], [80, 220, 255], [200, 255, 90], [255, 180, 60], [160, 110, 255]];
    const cols = Math.max(3, Math.floor(len / 1.1));
    for (let row = 0; row < 3; row++) for (let col = 0; col < cols; col++) {
      if (c.rand() < 0.25) continue;
      flat(-len / 2 + (col + 0.5) * len / cols, 1.8 + row * 1.05, len / cols - 0.12, 0.95, c.pick(colours), c.pick(glyphs), 0, 0.82);
    }
  }
  // Paint drips under the piece.
  for (let k = 0; k < 4; k++) flat(-len / 2 + c.rand() * len, 1.25 - c.rand() * 0.3, 0.06, 0.4 + c.rand() * 0.5, [180, 180, 190], "|", 0, 0.6);
}

function graffiti(c: Composer): void {
  let index = Math.floor(c.rand() * 4);
  for (const side of [0, 1] as const) for (let k = 0; k < 2; k++) {
    const len = Math.min(5.5, Math.max(3, c.room(side) - 0.4));
    if (len < 3) break;
    const at = c.slot(side, len, 0.8 + c.rand() * 1.5);
    if (at === null) break;
    mural(c, side, at, len, index++ % 4);
  }
  // A tag over the mouth side of wall B, glowing, and spray cans on the ground.
  const tag = c.pick(["KAIJU", "ZERO", "RONIN", "GHOST", "MOTH", "STATIC", "404"]);
  // A glowing tag high on wall B, facing into the alley.
  c.sign(c.range[1][0] + 1.2 + tag.length * 0.3, c.wallV(1, 0.05), 5.6, 0, c.inward(1), tag.length * 0.62 + 0.4, 0.9, tag, THEME_GLOW.graffiti);
  for (let k = 0; k < 3; k++) c.part(c.range[0][0] + 3 + k * 0.4, c.wallV(0, 0.2), 0.11, 0.08, 0.08, 0.22, SPRAY_COLOURS[k], "i", { near: 18 });
  if (c.rand() < 0.5) c.figure(0, c.range[0][0] + 4.2, 0.65, 0, -c.inward(0), look([40, 44, 60], [28, 30, 40], THEME_GLOW.graffiti, "hood"), false, "sign");
}

function data(c: Composer): void {
  const [from, to] = c.range[0], length = to - from - 0.4;
  const cables: readonly RGB[] = [[30, 36, 44], [52, 40, 64], [30, 62, 52], [72, 52, 30], [24, 28, 34]];
  if (length > 2) cables.forEach((color, k) => c.onWall(0, (from + to) / 2, 3.0 + k * 0.17, length, 0.1, 0.1, color, "=", { near: 60 }, 0.05 + (k % 3) * 0.1));
  const box = c.slot(0, 1.2);
  if (box !== null) {
    c.onWall(0, box, 1.5, 1.0, 0.36, 1.3, [40, 50, 62], "#", { near: 80 });
    c.onWall(0, box, 1.7, 0.7, 0.02, 0.42, [80, 255, 170], "%", { gain: 1.0, near: 90, pulse: { rate: 0.9, depth: 0.1, phase: 0 } }, 0.37);
    for (let k = 0; k < 4; k++) c.onWall(0, box - 0.3 + k * 0.2, 1.2, 0.07, 0.03, 0.07, LED_COLOURS[k], "o", { gain: 1.0, near: 25 }, 0.37);
    for (let k = 0; k < 3; k++) c.onWall(0, box - 0.3 + k * 0.3, 0.42, 0.07, 0.07, 0.84, cables[k], "|", { near: 30 }, 0.15);
  }
  const rack = c.slot(0, 0.8);
  if (rack !== null) {
    c.onWall(0, rack, 0.95, 0.7, Math.min(0.6, c.arm.reach - 0.08), 1.9, [28, 32, 38], "H", { near: 70 });
    c.onWall(0, rack, 0.95, 0.06, 0.02, 1.6, [80, 200, 255], ":", { gain: 1.0, near: 70, pulse: { rate: 0.7, depth: 0.08, phase: 1 } }, Math.min(0.6, c.arm.reach - 0.08) + 0.02);
  }
  // The hacker on a crate across the alley, a laptop glowing on another crate.
  const seat = c.slot(1, 1.6);
  if (seat !== null) {
    c.onWall(1, seat, 0.23, 0.55, 0.5, 0.46, CRATE, "#", { near: 45 });
    c.onWall(1, seat + 0.9, 0.2, 0.5, 0.45, 0.4, [104, 80, 52], "#", { near: 40 });
    c.onWall(1, seat + 0.9, 0.52, 0.36, 0.26, 0.22, [120, 200, 255], "=", { gain: 1.0, near: 60 }, 0.1);
    c.figure(1, seat, 0.25, 1, c.inward(1) * 0.3, look([30, 40, 46], [20, 26, 30], [80, 255, 170], "visor"), true, "wrist");
  }
  // A cable dropping across the alley overhead.
  const over = c.range[1][0] + (c.range[1][1] - c.range[1][0]) * 0.5;
  c.part(over, (c.vA + c.vB) / 2, 4.4, 0.08, c.vB - c.vA, 0.08, DARK, "-", { near: 45 });
}

function garden(c: Composer): void {
  for (const side of [0, 1] as const) {
    const [from, to] = c.range[side];
    // Overflow from a balcony garden: a ledge of planters at 7 m, vines spilling down.
    if (to - from > 3) c.onWall(side, (from + to) / 2, 7.0, to - from - 0.6, 0.6, 0.4, TERRACOTTA, "=", { near: 110 });
    for (let k = 0; k < 6; k++) {
      const s = from + 0.6 + c.rand() * (to - from - 1.2), length = 1.6 + c.rand() * 4;
      c.onWall(side, s, 7.0 - length / 2, 0.25 + c.rand() * 0.3, 0.08, length, k % 2 ? LEAF : [56, 116, 62], k % 3 ? "|" : "&", { near: 90, gain: 0.8 }, 0.02);
      c.onWall(side, s, 7.25, 0.8, 0.5, 0.5, [52, 110, 60], "&", { near: 90, round: true, gain: 0.8 }, 0.1);
    }
  }
  for (let k = 0; k < 3; k++) {
    const at = c.slot(k % 2 as 0 | 1, 1.3);
    if (at === null) continue;
    const side = k % 2 as 0 | 1, depth = Math.min(0.6, c.arm.reach - 0.03);
    c.onWall(side, at, 0.3, 1.2, depth, 0.6, TERRACOTTA, "#", { near: 70 });
    c.onWall(side, at, 0.8, 1.1, depth, 0.6, [60, 122, 70], "&", { near: 70, round: true });
    for (let f = 0; f < 3; f++) c.onWall(side, at - 0.35 + f * 0.35, 1.05, 0.12, 0.12, 0.12, [255, 120, 200], "*", { gain: 0.95, near: 25, round: true }, depth * 0.5);
    // A grow lamp breathing slowly over it.
    c.onWall(side, at, 2.3, 1.0, 0.12, 0.08, [220, 100, 255], "=", { gain: 1.0, near: 100, pulse: { rate: 0.45, depth: 0.08, phase: k } }, 0.3);
  }
  // A hose snaking from a reel on wall A.
  const reel = c.slot(0, 0.6);
  if (reel !== null) {
    c.onWall(0, reel, 0.9, 0.5, 0.25, 0.5, [60, 140, 90], "O", { near: 35, round: true });
    let s = reel, v = c.wallV(0, 0.15);
    for (let k = 0; k < 4; k++) {
      const ds = 0.6 + c.rand() * 0.4, dv = (k % 2 ? -1 : 1) * 0.3 * c.inward(0);
      c.part(s + ds / 2, v + dv / 2, 0.04, ds, Math.max(0.06, Math.abs(dv)), 0.06, [60, 140, 90], "~", { near: 22 });
      s += ds; v += dv;
    }
  }
}

const COMPOSE: Readonly<Record<AlleyTheme, (c: Composer) => void>> = { kitchen, shrine, squat, workshop, market, pipes, flooded, graffiti, data, garden };

/** Life any alley may have: a radio-lit window, a lit back door, a cat. */
function extras(c: Composer): void {
  if (c.rand() < 0.45) {
    const side = c.rand() < 0.5 ? 0 : 1, [from, to] = c.range[side], s = from + (to - from) * (0.3 + c.rand() * 0.5);
    c.onWall(side, s, 4.6, 1.2, 0.04, 0.9, [255, 190, 120], "#", { gain: 0.9, near: 110, pulse: { rate: 0.8, depth: 0.08, phase: c.rand() * 6 } });
    c.onWall(side, s - 0.15, 4.45, 0.22, 0.05, 0.5, [40, 30, 28], "#", { near: 50 }, 0.04);
  }
  if (c.arm.theme !== "kitchen" && c.rand() < 0.35) {
    const side = c.rand() < 0.5 ? 0 : 1, door = c.slot(side, 1.3);
    if (door !== null) {
      c.onWall(side, door, 1.05, 0.95, 0.05, 2.1, [255, 210, 160], "#", { gain: 0.85, near: 90 });
      lamp(c, side, door, 2.55, [255, 220, 170]);
    }
  }
  if (c.rand() < 0.3) {
    const side = c.rand() < 0.5 ? 0 : 1, at = c.slot(side, 1.2);
    if (at !== null) { const top = bin(c, side, at); cat(c, side, at, top, 0.4); feeder(c, side, at); }
  }
}

const FEEDER_COATS: readonly RGB[] = [[120, 96, 80], [70, 84, 100], [140, 70, 80], [90, 110, 86]];
/**
 * Now and then a neighbour feeds the cat on the bin: standing just past it on the wall, a morsel
 * held out (human-model "feed"). Placed after the bin, which is the last thing on that wall (extras
 * runs last), and decided without `c.rand()` so the rest of the alley's layout is unchanged.
 */
function feeder(c: Composer, side: 0 | 1, at: number): void {
  if (c.actors.filter(actor => actor.kind === "figure").length >= 2) return;
  const s = at + 1.0, offset = 0.4, roll = randomFor(Math.round(at * 10), c.arm.bx * 31 + c.arm.bz * 7 + side, 9311);
  if (roll > 0.35 || s + 0.35 > c.range[side][1] - 0.2 || offset + 0.3 > c.arm.reach || s < MOUTH_CLEAR + 0.5) return;
  const [x, z] = c.at(s, c.wallV(side, offset));
  c.actors.push({ kind: "figure", x, z, facing: c.facing(-1, c.inward(side) * 0.3), look: look(FEEDER_COATS[Math.floor(roll * 11.4) % FEEDER_COATS.length], [52, 50, 56], [255, 200, 140], roll < 0.15 ? "hood" : "bare"), seated: false, arms: "feed", seed: Math.floor(roll * 997) });
}

/** Mouth hints every arm has: two lanterns in its glow colour, and a sign for some themes. */
function mouthHints(c: Composer): void {
  const s = Math.max(c.range[0][0], c.range[1][0], MOUTH_CLEAR) + 0.5, glow = THEME_GLOW[c.arm.theme];
  for (const side of [0, 1] as const) {
    c.part(s, c.wallV(side, 0.3), 4.6, 0.08, 0.6, 0.08, DARK, "-", { near: 40, mouth: true });
    c.part(s, c.wallV(side, 0.55), 4.2, 0.36, 0.36, 0.5, glow, "o", { gain: 1.0, near: 170, round: true, mouth: true });
  }
  const words = SIGN_WORDS[c.arm.theme];
  if (words && c.arm.width > 3.4) {
    const text = c.pick(words), width = Math.min(c.arm.width - 0.8, text.length * 0.42 + 0.5);
    c.sign(s + 0.4, c.vA + 0.1 + width / 2, 3.5, -1, 0, width, 0.6, text, glow);
  }
}

interface Plot { building: Building; minX: number; maxX: number; minZ: number; maxZ: number }
const plotOf = (b: Building): Plot => ({ building: b, minX: b.x - b.width / 2, maxX: b.x + b.width / 2, minZ: b.z - b.depth / 2, maxZ: b.z + b.depth / 2 });

/** The arms of one block (none when a plot either side of an arm is missing). */
export function blockAlleys(block: Block): AlleyArm[] {
  const ox = block.x * BLOCK_SIZE, oz = block.z * BLOCK_SIZE;
  const plots: (Plot | undefined)[] = [];
  for (const b of block.buildings) plots[(b.z - oz < 32 ? 0 : 2) + (b.x - ox < 32 ? 0 : 1)] = plotOf(b);
  const arms: AlleyArm[] = [];
  const specs: readonly { side: AlleySide; a: number; b: number }[] = [{ side: "n", a: 0, b: 1 }, { side: "s", a: 2, b: 3 }, { side: "w", a: 0, b: 2 }, { side: "e", a: 1, b: 3 }];
  for (const { side, a, b } of specs) {
    const pa = plots[a], pb = plots[b];
    if (!pa || !pb) continue;
    const axis: "x" | "z" = side === "n" || side === "s" ? "z" : "x";
    const wallA = axis === "z" ? pa.maxX : pa.maxZ, wallB = axis === "z" ? pb.minX : pb.minZ, width = wallB - wallA;
    if (width < MIN_WIDTH) continue;
    const origin = side === "n" ? oz : side === "s" ? oz + BLOCK_SIZE : side === "w" ? ox : ox + BLOCK_SIZE;
    const dir: 1 | -1 = side === "n" || side === "w" ? 1 : -1;
    const span = (p: Plot): [number, number] => {
      const lo = axis === "z" ? p.minZ : p.minX, hi = axis === "z" ? p.maxZ : p.maxX;
      const s0 = dir * (lo - origin), s1 = dir * (hi - origin);
      return [Math.max(Math.min(s0, s1), MOUTH_CLEAR - 0.6), Math.min(Math.max(s0, s1), 31)];
    };
    const range = [span(pa), span(pb)] as const;
    const mid = (wallA + wallB) / 2, theme = alleyTheme(block.x, block.z, side);
    const reach = Math.max(0.15, Math.min(1.3, (width - 1.8) / 2));
    const sMid = (Math.min(range[0][0], range[1][0]) + Math.max(range[0][1], range[1][1])) / 2;
    const mouthS = Math.max(range[0][0], range[1][0]);
    const point = (s: number): [number, number] => axis === "z" ? [mid, origin + dir * s] : [origin + dir * s, mid];
    const [mouthX, mouthZ] = point(mouthS), [cx, cz] = point(sMid);
    const arm: AlleyArm = {
      bx: block.x, bz: block.z, side, theme, district: districtAt(ox + 32, oz + 32).id, axis, mid, width, reach,
      mouthX, mouthZ, cx, cz, radius: Math.max(range[0][1], range[1][1]) - sMid + width,
      parts: [], actors: [], signs: [], mouth: [],
    };
    const composer = new Composer(arm, origin, dir, wallA - mid, wallB - mid, range, (block.x + 64) * 1031 + (block.z + 64) * 7 + SIDES.indexOf(side) * 131071);
    mouthHints(composer);
    COMPOSE[theme](composer);
    extras(composer);
    arm.parts = composer.parts; arm.actors = composer.actors; arm.signs = composer.signs; arm.mouth = composer.mouth;
    arms.push(arm);
  }
  return arms;
}

const armCache = new Map<number, readonly AlleyArm[]>();
/** The arms of block (bx, bz), cached (the layout is deterministic). */
export function alleysOf(blocks: ReadonlyMap<string, Block>, bx: number, bz: number): readonly AlleyArm[] {
  if (bx < -HALF_BLOCKS || bx >= HALF_BLOCKS || bz < -HALF_BLOCKS || bz >= HALF_BLOCKS) return [];
  const key = (bx + 64) * 256 + (bz + 64);
  let arms = armCache.get(key);
  if (!arms) {
    const block = blocks.get(blockKey(bx, bz));
    arms = block ? blockAlleys(block) : [];
    armCache.set(key, arms);
  }
  return arms;
}

const THEME_NAMES: Readonly<Record<AlleyTheme, string>> = {
  kitchen: "Kitchen Alley", shrine: "Shrine Alley", squat: "Tarp Alley", workshop: "Weld Alley", market: "Black Alley",
  pipes: "Pipe Gallery", flooded: "Wet Alley", graffiti: "Paint Alley", data: "Wire Alley", garden: "Vine Alley",
};
/** The themed name of the alley arm at (x, z) when the point lies inside an arm's core band, else null (world-free). */
export function alleyNameAt(x: number, z: number): string | null {
  const bx = Math.floor(x / BLOCK_SIZE), bz = Math.floor(z / BLOCK_SIZE), lx = x - bx * BLOCK_SIZE, lz = z - bz * BLOCK_SIZE;
  // Park and landmark blocks have no plots, so no alleys (world.ts CityWorld).
  if (bx < -HALF_BLOCKS || bx >= HALF_BLOCKS || bz < -HALF_BLOCKS || bz >= HALF_BLOCKS || parkBlock(bx, bz)) return null;
  if (LANDMARKS.some(l => l.kind !== "gate" && Math.floor(l.x / BLOCK_SIZE) === bx && Math.floor(l.z / BLOCK_SIZE) === bz)) return null;
  let side: AlleySide | null = null;
  if (Math.abs(lx - 32) < 2.2 && lz > 10 && lz < 29) side = "n";
  else if (Math.abs(lx - 32) < 2.2 && lz > 35 && lz < 54) side = "s";
  else if (Math.abs(lz - 32) < 2.2 && lx > 10 && lx < 29) side = "w";
  else if (Math.abs(lz - 32) < 2.2 && lx > 35 && lx < 54) side = "e";
  return side ? THEME_NAMES[alleyTheme(bx, bz, side)] : null;
}
