import type { PropCanvas } from "./prop-canvas.ts";
import type { CarKind } from "./traffic.ts";
import type { RGB } from "./world.ts";

/**
 * Close-range body detail for road vehicles, drawn over drawCar's boxes (activity.ts) in the car's
 * local frame (x right, y up, -z forward). Three tiers by distance from the eye:
 *  - far (>= KIT_MID): nothing here, the plain boxes stay as they were (flat far instance count);
 *  - mid (KIT_NEAR..KIT_MID): large panels only, each at least about a cell tall so nothing winks:
 *    dark window glass, a painted roof, lower-body grime, bumpers, bus window posts, roof pods;
 *  - near (< KIT_NEAR): the full kit: seams, handles, wheel arches, mirrors, light strips, a lit
 *    interior with a driver silhouette, plates, roof-sign letters, liveries, passengers.
 * Each tier dissolves out (prop range code) before its CPU gate, so detail fades instead of popping.
 * Thin parts are sized from the cell footprint (cellMetres) so they stay at least a cell wide.
 */
export interface VehicleKitScene {
  paint(t: PropCanvas, color: RGB, glyph: string, gain?: number): void;
  /** Sets the draw distance of what follows; returns the previous range code. */
  range(metres: number): number;
  restore(code: number): void;
}
export interface VehicleKitState {
  /** Ground distance from the eye, in metres. */
  distance: number;
  /** Scene clock (destination boards); 0 when the car is parked. */
  time: number;
  rain: boolean;
  /** Nearby neon colour for the shoulder highlight. */
  neon: RGB;
  /** Someone at the wheel (traffic, the player, remote drivers): lit dash and a silhouette. */
  occupied: boolean;
  /** Headlight pool strength 0..1 (eased with speed: no brightness step when a car pulls away). */
  beams: number;
  /** Bus doors open at a berth. */
  doors: boolean;
  /** Bus doors 0 shut .. 1 open, eased (traffic.ts busDoorOpen); without it `doors` counts as fully open. */
  door?: number;
  /** Paint index (route number for buses, livery word and colour for lorries). */
  variant: number;
}

export const KIT_NEAR = 26, KIT_MID = 46, PLATE_TEXT_RANGE = 12;
/** Dissolve distances (each tier is fully gone before its CPU gate). */
const NEAR_FADE = 24, MID_FADE = 44;
export type KitTier = 0 | 1 | 2;
export const kitTier = (distance: number): KitTier => distance < KIT_NEAR ? 2 : distance < KIT_MID ? 1 : 0;
/** About one character cell, in metres, at `distance` (LINE_PER_METRE in landmarks-scene.ts). */
export const cellMetres = (distance: number): number => Math.max(0.035, distance * 0.0105);
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** Deterministic 0..1 per car and salt. */
export function kitHash(id: number, salt: number): number {
  let h = Math.imul(id | 0, 374761393) ^ Math.imul(salt + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const PLATE_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";
/** Four-character number plate: two letters, two digits. */
export function plateText(id: number): string {
  const letter = (salt: number) => PLATE_LETTERS[Math.floor(kitHash(id, salt) * PLATE_LETTERS.length)];
  const digit = (salt: number) => String(Math.floor(kitHash(id, salt) * 10));
  return letter(1) + letter(2) + digit(3) + digit(4);
}

export const DESTINATIONS: readonly string[] = ["FOUNDRY", "NEON WARD", "GHOST CIRCUIT", "RAIN GARDENS", "SILK MARKET", "SPILLWAY"];
/** A bus's destination text, with the gap that separates the loop when it scrolls. */
export function destinationText(route: number): string {
  const r = Math.abs(Math.floor(route));
  return `${DESTINATIONS[r % DESTINATIONS.length]} VIA ${DESTINATIONS[(r + 3) % DESTINATIONS.length]}   `;
}
/** Letters per second a destination board scrolls (the blimp ticker's pace). */
export const BOARD_RATE = 2;
/** The `slots` letters a board shows at `time`: centred and still when the text fits, else scrolling. */
export function boardWindow(text: string, time: number, slots: number): string {
  if (slots <= 0 || text.length === 0) return "";
  const trimmed = text.trimEnd();
  if (trimmed.length <= slots) {
    const left = Math.floor((slots - trimmed.length) / 2);
    return (" ".repeat(left) + trimmed).padEnd(slots);
  }
  const offset = Math.floor(Math.max(0, time) * BOARD_RATE) % text.length;
  let out = "";
  for (let k = 0; k < slots; k++) out += text[(offset + k) % text.length];
  return out;
}
/** Letters per second the drawn boards glide (the blimp ticker's pace): each cell's letter changes
 * well under the 0.4 Hz comfort ceiling, where boardWindow's stepped window swapped them at 2 Hz. */
export const BOARD_GLIDE = 0.6;
/** Gain of a gliding board letter at slot position `u` (0 .. slots-1 inside; it fades over the last
 * half slot at either end, so letters slide in and out instead of popping). */
export const boardEdge = (u: number, slots: number): number => Math.min(1, u + 0.5, slots - 0.5 - u);
/** A destination board in `slots` one-cell letters (cellText's layout): a still `prefix` (a route
 * number), then `text` centred and still when it fits, else gliding continuously at BOARD_GLIDE. */
export function boardText(t: PropCanvas, scene: VehicleKitScene, prefix: string, text: string, color: RGB, gain: number, cell: number, x: number, y: number, z: number, axis: "x" | "z", step: number, height: number, time: number, slots: number): void {
  const pitch = cell * 1.15, start = -(slots - 1) / 2, n = slots - prefix.length;
  const letter = (glyph: string, slot: number, g: number): void => {
    if (glyph === " " || g <= 0) return;
    const offset = (start + slot) * pitch * step;
    scene.paint(t, color, glyph, g);
    if (axis === "x") part(t, x + offset, y, z, cell, height, 0.01);
    else part(t, x, y, z + offset, 0.01, height, cell);
  };
  for (let k = 0; k < prefix.length && k < slots; k++) letter(prefix[k], k, gain);
  if (n <= 0 || text.length === 0) return;
  if (text.trimEnd().length <= n) {
    const still = boardWindow(text, 0, n);
    for (let k = 0; k < n; k++) letter(still[k], prefix.length + k, gain);
    return;
  }
  const pos = Math.max(0, time) * BOARD_GLIDE, first = Math.floor(pos), slide = pos - first;
  for (let k = 0; k <= n; k++) {
    const u = k - slide;
    letter(text[(first + k) % text.length], prefix.length + u, gain * boardEdge(u, n));
  }
}
/** Bus door leaves' opening 0..1 (traffic.ts eases it; a bare `doors` flag counts as open). */
export const busDoorLeaf = (state: VehicleKitState): number => clamp(state.door ?? (state.doors ? 1 : 0), 0, 1);

/** 3x5 block letters for lorry liveries; rows top to bottom, bit 4 = left column. */
const FONT: Readonly<Record<string, readonly number[]>> = {
  A: [2, 5, 7, 5, 5], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7],
  K: [5, 5, 6, 5, 5], N: [5, 7, 7, 5, 5], O: [7, 5, 5, 5, 7], R: [6, 5, 6, 5, 5], S: [7, 4, 7, 1, 7],
  T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], Z: [7, 1, 2, 4, 7],
};
export const LIVERY_WORDS: readonly string[] = ["TETSU", "OKADA", "HAZE", "KIRIN", "SOREN", "ZENITH"];
/** Bright livery inks (the box is pale grey; the stripe colours are often too dark to read). */
const LIVERY_INKS: readonly RGB[] = [[255, 143, 77], [66, 223, 227], [255, 71, 148], [250, 206, 70], [96, 196, 140], [133, 155, 255], [214, 120, 40]];
export type Stroke = readonly [column: number, row: number, length: number];
const strokeCache = new Map<string, readonly Stroke[]>();
/** Horizontal runs of a block letter (merged so a letter costs a handful of boxes). */
export function letterStrokes(letter: string): readonly Stroke[] {
  const cached = strokeCache.get(letter);
  if (cached) return cached;
  const rows = FONT[letter] ?? [];
  const strokes: Stroke[] = [];
  rows.forEach((bits, row) => {
    let start = -1;
    for (let column = 0; column <= 3; column++) {
      const on = column < 3 && (bits & (4 >> column)) !== 0;
      if (on && start < 0) start = column;
      else if (!on && start >= 0) { strokes.push([start, row, column - start]); start = -1; }
    }
  });
  strokeCache.set(letter, strokes);
  return strokes;
}

function part(t: PropCanvas, x: number, y: number, z: number, w: number, h: number, d: number): void {
  t.translate(x, -y, z); t.box(w, h, d); t.translate(-x, y, -z);
}

/** Window glass (or a cargo box): half width, bottom, top, front z, rear z. */
interface Volume { half: number; y0: number; y1: number; z0: number; z1: number }
interface Shape { glass: Volume | null; cargo: Volume | null; seams: readonly number[]; pillar: number | null; seat: number }
const SALOON: Volume = { half: 1.15, y0: 1.2, y1: 2.1, z0: -1.05, z1: 1.55 };
const VAN_CAB: Volume = { half: 1.15, y0: 1.35, y1: 2.15, z0: -1.75, z1: -0.95 };
const SHAPES: Partial<Record<CarKind, Shape>> = {
  sedan: { glass: SALOON, cargo: null, seams: [-1.0, 0.3, 1.5], pillar: 0.3, seat: -0.3 },
  cab: { glass: SALOON, cargo: null, seams: [-1.0, 0.3, 1.5], pillar: 0.3, seat: -0.3 },
  police: { glass: SALOON, cargo: null, seams: [-1.0, 0.3, 1.5], pillar: 0.3, seat: -0.3 },
  coupe: { glass: { half: 1.1, y0: 1.225, y1: 1.875, z0: -0.65, z1: 1.55 }, cargo: null, seams: [-0.7, 1.05], pillar: null, seat: 0.15 },
  pickup: { glass: { half: 1.15, y0: 1.2, y1: 2.1, z0: -1.75, z1: 0.25 }, cargo: null, seams: [-1.7, 0.2], pillar: null, seat: -1.0 },
  van: { glass: VAN_CAB, cargo: { half: 1.3, y0: 1.1, y1: 2.8, z0: -0.95, z1: 2.85 }, seams: [-1.75, -0.95, 0.35, 1.85], pillar: null, seat: -1.35 },
  ambulance: { glass: VAN_CAB, cargo: { half: 1.33, y0: 1.075, y1: 2.825, z0: -1.0, z1: 2.9 }, seams: [-1.75, -0.95], pillar: null, seat: -1.35 },
  corpsec: { glass: null, cargo: { half: 1.33, y0: 1.1, y1: 2.8, z0: -2.1, z1: 2.8 }, seams: [-1.4, 0.6], pillar: null, seat: 0 },
};
const MUD: RGB = [74, 62, 46], BUMPER: RGB = [34, 37, 44], WELL: RGB = [12, 13, 16], CHROME: RGB = [168, 174, 182];
const AMBER: RGB = [255, 168, 56], TAIL: RGB = [255, 51, 103], DRL: RGB = [210, 236, 255], WET: RGB = [150, 180, 210];
const HEAD: RGB = [58, 50, 62], SHOULDERS: RGB = [30, 28, 36], POOL: RGB = [170, 160, 120];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Body kit for `kind` at the state's distance (nothing beyond KIT_MID). Leaves ink and range changed
 * only through the scene's own calls; the caller's range code is restored. */
export function drawVehicleKit(t: PropCanvas, scene: VehicleKitScene, kind: CarKind, id: number, body: RGB, state: VehicleKitState): void {
  const tier = kitTier(state.distance);
  if (tier === 0 || kind === "wreck") return;
  const outer = scene.range(MID_FADE);
  const shape = SHAPES[kind];
  if (shape) carKit(t, scene, kind, id, body, state, shape, tier);
  else if (kind === "bus") busKit(t, scene, id, body, state, tier);
  else if (kind === "truck" || kind === "tanker") lorryKit(t, scene, kind, id, body, state, tier);
  else if (kind === "tuktuk" && tier === 2) {
    // Canopy fringe: a band of "v" tassels hanging under the canopy edge, inside the string lights.
    scene.range(NEAR_FADE);
    scene.paint(t, body, "v", 0.95); part(t, 0, 1.91, 0.25, 1.7, 0.16, 2.5);
  }
  scene.restore(outer);
}

/** What the tram kit needs about one body section (activity.ts drawTram fills it). */
export interface TramKitState {
  distance: number; time: number; rain: boolean;
  /** 0 leads (cab and destination board at its front), last trails (cab at its back). */
  section: number; sections: number; length: number;
  /** Destination text for the boards (route letter first). */
  destination: string;
  /** Tram serial: seats and grime. */
  serial: number;
}
/** Close-range kit for one tram section, in its local frame (x right, y up, -z forward), with the
 * same tiers as the cars: mid adds window posts, roof grime and the destination board's letters;
 * near adds the lit ceiling strip, seated and standing passengers and the cab driver. */
export function drawTramKit(t: PropCanvas, scene: VehicleKitScene, body: RGB, state: TramKitState): void {
  const tier = kitTier(state.distance);
  if (tier === 0) return;
  const outer = scene.range(MID_FADE);
  const cell = cellMetres(state.distance), half = state.length / 2, lead = state.section === 0, last = state.section === state.sections - 1;
  const id = state.serial * 8 + state.section;
  // Mid: window posts (at least a cell wide, so they never break into dashes), grime above the
  // skirt, rain on the roof, and the destination letters once they fit the boards.
  scene.paint(t, body, "|", 0.6); const post = Math.max(0.1, cell);
  for (let z = -half + 0.8; z <= half - 0.7; z += 1.55) part(t, 0, 2.25, z, 2.67, 1.28, post);
  scene.paint(t, mix(body, MUD, 0.55), ":", 0.4 + 0.25 * kitHash(id, 7)); part(t, 0, 0.82, 0, 2.62, 0.26, state.length - 0.3);
  if (state.rain) { scene.paint(t, WET, "~", 0.22 + 0.18 * kitHash(id, 3)); part(t, 0, 3.315, 0, 2.3, 0.02, state.length - 0.4); }
  const slots = Math.min(14, Math.floor(1.7 / (cell * 1.15)));
  if (slots >= 2) {
    // A dark board in front of the far tier's lit one, then the letters (the bus kit's order).
    const text = state.destination + "   ";
    scene.paint(t, [22, 14, 6], "#");
    if (lead) part(t, 0, 3.0, -half - 0.075, 1.8, 0.32, 0.02);
    if (last) part(t, 0, 3.0, half + 0.075, 1.8, 0.32, 0.02);
    if (lead) boardText(t, scene, "", text, [255, 184, 60], 1.25, cell, 0, 3.0, -half - 0.092, "x", -1, Math.min(cell, 0.28), state.time, slots);
    if (last) boardText(t, scene, "", text, [255, 184, 60], 1.25, cell, 0, 3.0, half + 0.092, "x", 1, Math.min(cell, 0.28), state.time, slots);
  }
  if (tier < 2) { scene.restore(outer); return; }

  // Near: a lit ceiling strip, passengers through the windows (one box across the body per seat,
  // the bus kit's trick), a few standing near the doors, and the driver in each cab.
  scene.range(NEAR_FADE);
  scene.paint(t, [255, 240, 214], "-", 1.2); part(t, 0, 2.84, 0, 2.66, clamp(cell * 0.8, 0.05, 0.1), state.length - 1.2);
  for (let k = 0; k < 6; k++) {
    const seat = kitHash(id, 20 + k);
    if (seat > 0.6) continue;
    const z = -half + 1.2 + k * 1.4 + (seat - 0.3) * 0.5;
    if (seat < 0.18) {
      scene.paint(t, [56, 46, 44], "@"); part(t, 0, 2.62, z, 2.68, 0.26, 0.22);
      scene.paint(t, [30, 28, 32], "#"); part(t, 0, 2.2, z, 2.68, 0.55, 0.45);
    } else {
      scene.paint(t, [60, 48, 40], "@"); part(t, 0, 2.32, z, 2.68, 0.26, 0.22);
      scene.paint(t, [34, 30, 30], "#"); part(t, 0, 2.05, z, 2.68, 0.2, 0.5);
    }
  }
  if (lead) { scene.paint(t, HEAD, "@"); part(t, 0.5, 2.25, -half - 0.03, 0.3, 0.3, 0.02); }
  scene.restore(outer);
}

/** Two pools of dotted light on the road ahead of a moving car (props, not shader light). */
function headlightPools(t: PropCanvas, scene: VehicleKitScene, front: number, width: number, beams: number): void {
  if (beams < 0.05) return;
  scene.paint(t, POOL, ".", 0.32 * beams); part(t, 0, 0.03, front - 3.0, width * 0.85, 0.02, 3.4);
  scene.paint(t, POOL, ".", 0.18 * beams); part(t, 0, 0.03, front - 6.1, width * 1.1, 0.02, 2.8);
}

/** Letters in one-cell boxes along a face: `axis` "x" runs across a front/back face, "z" along a side.
 * `step` is +1 or -1 so the text reads left to right for someone facing that face. In this (y-up,
 * right-handed) frame a viewer facing the front sees +x on their left: fronts step -1, backs +1, and a
 * side at x = s * half steps -s along z (vfx.ts project: yaw 0 looks down -z with +x to the right). */
export function cellText(t: PropCanvas, scene: VehicleKitScene, text: string, color: RGB, gain: number, cell: number, x: number, y: number, z: number, axis: "x" | "z", step: number, height = cell): void {
  const pitch = cell * 1.15, start = -(text.length - 1) / 2;
  for (let k = 0; k < text.length; k++) {
    const glyph = text[k];
    if (glyph === " ") continue;
    const offset = (start + k) * pitch * step;
    scene.paint(t, color, glyph, gain);
    if (axis === "x") part(t, x + offset, y, z, cell, height, 0.01);
    else part(t, x, y, z + offset, 0.01, height, cell);
  }
}

function carKit(t: PropCanvas, scene: VehicleKitScene, kind: CarKind, id: number, body: RGB, state: VehicleKitState, shape: Shape, tier: KitTier): void {
  const front = -2.9, rear = 2.9, top = 1.425;
  const grime = kitHash(id, 7);
  const { glass, cargo } = shape;
  // Mid: lower-body grime (mud-tinted, per-car amount), bumpers, dark glass, painted roof, rain sheen.
  scene.paint(t, mix(body, MUD, 0.5 + 0.35 * grime), ":", 0.42 + 0.3 * grime); part(t, 0, 0.39, 0, 2.73, 0.43, 5.76);
  scene.paint(t, BUMPER, "=", 0.9); part(t, 0, 0.36, front - 0.04, 2.76, 0.26, 0.12); part(t, 0, 0.36, rear + 0.04, 2.76, 0.26, 0.12);
  let roofY = cargo ? cargo.y1 : top, roofZ = cargo ? (cargo.z0 + cargo.z1) / 2 : 0, roofLength = cargo ? cargo.z1 - cargo.z0 : 5.6, roofWidth = cargo ? cargo.half * 2 : 2.7;
  let paneY = 0, paneH = 0;
  if (glass) {
    const low = Math.max(glass.y0, top) + 0.06, high = glass.y1 - 0.08, centre = (glass.z0 + glass.z1) / 2, length = glass.z1 - glass.z0;
    paneY = (low + high) / 2; paneH = high - low;
    // Tinted glass: one box wider than the glasshouse shows both side windows, one longer shows both screens.
    scene.paint(t, state.occupied ? [24, 44, 56] : [14, 24, 32], "/", 1);
    part(t, 0, paneY, centre, glass.half * 2 + 0.024, paneH, length - 0.2);
    part(t, 0, paneY, centre, glass.half * 2 - 0.16, paneH, length + 0.024);
    if (!cargo) {
      scene.paint(t, body, "=", 0.62); part(t, 0, glass.y1 + 0.012, centre, glass.half * 2 - 0.04, 0.02, length - 0.04);
      roofY = glass.y1; roofZ = centre; roofLength = length; roofWidth = glass.half * 2;
    }
  }
  if (state.rain) { scene.paint(t, WET, "~", 0.22 + 0.18 * kitHash(id, 3)); part(t, 0, roofY + 0.035, roofZ, roofWidth - 0.2, 0.02, roofLength - 0.3); }
  headlightPools(t, scene, front, 2.4, state.beams);
  if (tier < 2) return;

  // Near: the full kit.
  scene.range(NEAR_FADE);
  const cell = cellMetres(state.distance), line = clamp(cell * 0.9, 0.04, 0.2), trim = clamp(cell * 0.8, 0.05, 0.12);
  // Wheel wells behind the tyres and a body-coloured arch lip over each.
  scene.paint(t, WELL, "#"); for (const axle of [-1.75, 1.75]) part(t, 0, 0.6, axle, 2.745, 0.85, 1.12);
  scene.paint(t, body, "-", 1.05); for (const axle of [-1.75, 1.75]) part(t, 0, 1.06, axle, 2.75, trim, 1.2);
  // Door seams (up the cargo box where there is one) and handles.
  scene.paint(t, body, "|", 0.22);
  for (const z of shape.seams) {
    part(t, 0, 0.82, z, 2.756, 1.15, line);
    if (cargo && z >= cargo.z0 - 0.01 && z <= cargo.z1) part(t, 0, (top + cargo.y1 - 0.1) / 2, z, cargo.half * 2 + 0.06, cargo.y1 - 0.1 - top, line);
  }
  scene.paint(t, CHROME, "-", 1.0);
  for (let k = 1; k < shape.seams.length; k++) part(t, 0, 1.2, shape.seams[k] - 0.32, 2.764, trim, 0.22);
  // Shoulder line catching the nearest neon.
  scene.paint(t, mix(state.neon, [255, 255, 255], 0.3), "-", 0.6); part(t, 0, 1.39, 0, 2.738, clamp(cell, 0.04, 0.2), 5.5);
  // Lamps: a daytime-running strip, amber side markers, a tail strip on the boot lid.
  scene.paint(t, DRL, "-", 0.95); part(t, 0, 1.15, front - 0.015, 2.1, trim, 0.03);
  scene.paint(t, AMBER, "o", 0.7); part(t, 0, 0.95, front + 0.3, 2.756, 0.12, 0.2);
  if (glass) {
    if (shape.pillar !== null) { scene.paint(t, body, "|", 0.55); part(t, 0, paneY, shape.pillar, glass.half * 2 + 0.03, paneH + 0.1, Math.max(0.1, cell)); }
    // Wing mirrors: one bar through the glasshouse; only its ends show.
    scene.paint(t, body, "#", 0.7); part(t, 0, Math.max(top + 0.08, glass.y0 + 0.12), glass.z0 + 0.18, glass.half * 2 + 0.5, 0.14, 0.1);
    if (state.occupied) {
      // A faintly lit interior: the driver's head and shoulders against the dash glow, through the
      // side windows (one box across the car) and the windscreen.
      const headY = paneY + paneH * 0.2, z = shape.seat;
      scene.paint(t, HEAD, "@"); part(t, 0, headY, z, glass.half * 2 + 0.03, 0.26, 0.24); part(t, -0.5, headY, glass.z0 - 0.014, 0.26, 0.26, 0.02);
      scene.paint(t, SHOULDERS, "#"); part(t, 0, headY - 0.24, z + 0.04, glass.half * 2 + 0.028, Math.min(0.2, paneH * 0.4), 0.5);
      scene.paint(t, kind === "cab" ? [255, 190, 90] : [80, 210, 240], "-", 0.6); part(t, 0, paneY - paneH / 2 + 0.05, glass.z0 - 0.016, glass.half * 2 - 0.3, trim, 0.02);
    }
  }
  if (cargo) {
    // Split rear doors with vertical lamps; vans also carry a roof rack.
    scene.paint(t, body, "|", 0.22); part(t, 0, (0.3 + cargo.y1 - 0.15) / 2, cargo.z1 + 0.012 + Math.max(0, rear - cargo.z1), line, cargo.y1 - 0.45, 0.02);
    scene.paint(t, TAIL, "=", 1.0); for (const s of [-1, 1]) part(t, s * (cargo.half - 0.12), cargo.y0 + 0.6, Math.max(cargo.z1, rear) + 0.012, 0.14, 0.7, 0.02);
    if (kind === "van") {
      scene.paint(t, [70, 74, 82], "=", 0.9);
      for (const s of [-1, 1]) part(t, s * 0.95, cargo.y1 + 0.06, 0.95, 0.06, 0.06, 3.4);
      for (const z of [-0.4, 0.95, 2.3]) part(t, 0, cargo.y1 + 0.08, z, 2.3, 0.05, 0.06);
    }
  } else if (kind === "pickup") {
    scene.paint(t, body, "-", 0.22); part(t, 0, 1.25, rear + 0.012, 2.4, line, 0.02);
  }
  if (kind === "cab") {
    // TAXI on the roof sign's front and back (one-cell letters, while they fit the sign).
    if (4 * cell * 1.15 <= 0.9) {
      cellText(t, scene, "TAXI", [255, 244, 214], 1.25, cell, 0, 2.3, -0.162, "x", -1, Math.min(cell, 0.3));
      cellText(t, scene, "TAXI", [255, 244, 214], 1.25, cell, 0, 2.3, 0.562, "x", 1, Math.min(cell, 0.3));
    }
  } else if (kind === "police") {
    scene.paint(t, [70, 120, 255], "=", 0.85); part(t, 0, 0.6, 0, 2.766, clamp(cell, 0.06, 0.14), 5.6);
    if (6 * cell * 1.15 <= 2.2) for (const s of [-1, 1]) cellText(t, scene, "POLICE", [60, 110, 255], 1.1, cell, s * 1.386, 0.95, 0.1, "z", -s, Math.min(cell, 0.4));
  }
  // Number plates: letters over the pale plates (front reads +x, back reads -x).
  if (state.distance < PLATE_TEXT_RANGE) {
    const text = plateText(id), height = Math.min(cell, 0.15);
    cellText(t, scene, text, [28, 32, 40], 1, cell, 0, 0.6, -2.948, "x", -1, height);
    cellText(t, scene, text, [28, 32, 40], 1, cell, 0, 0.6, 2.948, "x", 1, height);
  }
}

function busKit(t: PropCanvas, scene: VehicleKitScene, id: number, body: RGB, state: VehicleKitState, tier: KitTier): void {
  const cell = cellMetres(state.distance), grime = kitHash(id, 7);
  // Mid: grime on the lower third, window posts, bumpers, roof air-con pods, closed door leaves.
  scene.paint(t, mix(body, MUD, 0.5 + 0.35 * grime), ":", 0.42 + 0.3 * grime); part(t, 0, 0.7, 2.9, 2.73, 0.8, 11.56);
  scene.paint(t, body, "|", 0.6); const post = Math.max(0.1, cell);
  for (let k = 0; k <= 8; k++) part(t, 0, 2.3, -1.2 + k * 1.15, 2.79, 0.9, post);
  scene.paint(t, BUMPER, "=", 0.9); part(t, 0, 0.45, -3.0, 2.76, 0.3, 0.12); part(t, 0, 0.45, 8.8, 2.76, 0.3, 0.12);
  scene.paint(t, [140, 146, 156], "#", 0.75); part(t, 0, 3.47, 0.9, 1.5, 0.3, 1.4); part(t, 0, 3.47, 6.6, 1.5, 0.3, 1.4);
  // Door leaves: each doorway's two leaves slide apart to its edges as the doors open (eased in
  // traffic.ts busDoorOpen), uncovering the lit doorway activity.ts draws behind them.
  const open = busDoorLeaf(state), leaf = 0.55 * (1 - open);
  if (open < 0.98) {
    scene.paint(t, [22, 30, 36], "|", 1);
    for (const dz of [-1.75, 3.7]) {
      if (open <= 0.01) part(t, -1.4, 1.5, dz, 0.02, 2.1, 1.1); // shut: one panel (keeps the mid tier small)
      else for (const l of [-1, 1]) part(t, -1.4, 1.5, dz + l * (0.55 - leaf / 2), 0.02, 2.1, leaf);
    }
  }
  if (state.rain) { scene.paint(t, WET, "~", 0.22 + 0.18 * kitHash(id, 3)); part(t, 0, 3.215, 2.9, 2.5, 0.02, 11.2); }
  // Destination board: route number then the destination, gliding when it does not fit.
  const slots = Math.min(14, Math.floor(1.8 / (cell * 1.15)));
  scene.paint(t, [22, 14, 6], "#"); part(t, 0, 2.98, -3.065, 1.9, 0.34, 0.02);
  if (slots >= 1) {
    const route = String(1 + state.variant % 9);
    if (slots >= 4) boardText(t, scene, route + " ", destinationText(state.variant), [255, 184, 60], 1.25, cell, 0, 2.98, -3.08, "x", -1, Math.min(cell, 0.3), state.time, slots);
    else cellText(t, scene, route, [255, 184, 60], 1.25, cell, 0, 2.98, -3.08, "x", -1, Math.min(cell, 0.3));
  }
  headlightPools(t, scene, -3.0, 2.5, state.beams);
  if (tier < 2) return;

  scene.range(NEAR_FADE);
  const line = clamp(cell * 0.9, 0.04, 0.2);
  scene.paint(t, mix(state.neon, [255, 255, 255], 0.3), "-", 0.55); part(t, 0, 3.12, 2.9, 2.74, clamp(cell, 0.04, 0.2), 11.5);
  // The leaves' meeting edges (one seam when shut, two parting lines as they open).
  if (open < 0.98) { scene.paint(t, [10, 12, 16], "|"); for (const dz of [-1.75, 3.7]) for (const l of open > 0.01 ? [-1, 1] : [0]) part(t, -1.415, 1.5, dz + l * (0.55 - leaf), 0.02, 2.0, line); }
  // Passengers: heads and shoulders in about half the windows (one box across the bus per seat).
  for (let k = 0; k < 8; k++) {
    const seat = kitHash(id, 20 + k);
    if (seat > 0.55) continue;
    const z = -1.2 + (k + 0.5) * 1.15 + (seat - 0.27) * 0.6;
    scene.paint(t, [60, 48, 40], "@"); part(t, 0, 2.3, z, 2.77, 0.26, 0.22);
    scene.paint(t, [34, 30, 30], "#"); part(t, 0, 2.03, z, 2.77, 0.2, 0.5);
  }
  if (state.occupied) {
    scene.paint(t, HEAD, "@"); part(t, 0.7, 2.1, -3.035, 0.3, 0.3, 0.01);
    scene.paint(t, [80, 210, 240], "-", 0.6); part(t, 0, 1.6, -3.036, 2.2, clamp(cell * 0.8, 0.05, 0.12), 0.01);
  }
}

function lorryKit(t: PropCanvas, scene: VehicleKitScene, kind: CarKind, id: number, body: RGB, state: VehicleKitState, tier: KitTier): void {
  const cell = cellMetres(state.distance), grime = kitHash(id, 7);
  // Mid: cab glass, cab grime, bumper; a mud-streaked lower third and rust runs on the box.
  scene.paint(t, state.occupied ? [24, 44, 56] : [14, 24, 32], "/", 1);
  part(t, 0, 2.15, -2.0, 2.62, 0.6, 1.0); part(t, 0, 2.1, -3.058, 2.1, 0.66, 0.02);
  scene.paint(t, mix(body, MUD, 0.55 + 0.3 * grime), ":", 0.4 + 0.3 * grime); part(t, 0, 0.75, -1.85, 2.62, 0.7, 2.26);
  scene.paint(t, BUMPER, "=", 0.9); part(t, 0, 0.55, -3.08, 2.7, 0.34, 0.12);
  if (kind === "truck") {
    scene.paint(t, mix([150, 152, 156], MUD, 0.65), ":", 0.45 + 0.3 * grime); part(t, 0, 1.02, 4.0, 2.73, 0.64, 9.26);
    for (let k = 0; k < 3; k++) {
      const z = -0.2 + kitHash(id, 40 + k) * 8.4, length = 0.6 + kitHash(id, 50 + k) * 0.9;
      scene.paint(t, [132, 74, 42], "|", 0.45 + 0.2 * grime); part(t, 0, 3.55 - length / 2, z, 2.735, length, Math.max(0.14, cell));
    }
    if (state.rain) { scene.paint(t, WET, "~", 0.22 + 0.18 * kitHash(id, 3)); part(t, 0, 3.615, 4.0, 2.5, 0.02, 9.0); }
  }
  headlightPools(t, scene, -3.04, 2.4, state.beams);
  if (tier < 2) return;

  scene.range(NEAR_FADE);
  const line = clamp(cell * 0.9, 0.04, 0.2);
  scene.paint(t, [40, 44, 52], "#"); part(t, 0, 2.2, -2.75, 3.1, 0.42, 0.08); // mirrors on arms
  scene.paint(t, [16, 18, 22], "|"); part(t, 0, 1.5, -0.95, 2.63, 1.9, line); // cab door seam
  scene.paint(t, CHROME, "-"); part(t, 0, 1.7, -1.25, 2.64, clamp(cell * 0.8, 0.05, 0.12), 0.2);
  if (state.occupied) {
    scene.paint(t, HEAD, "@"); part(t, -0.6, 2.2, -3.062, 0.3, 0.3, 0.01);
    scene.paint(t, [80, 210, 240], "-", 0.6); part(t, 0, 1.82, -3.062, 1.8, clamp(cell * 0.8, 0.05, 0.12), 0.01);
  }
  if (kind !== "truck") return;
  scene.paint(t, mix(state.neon, [255, 255, 255], 0.3), "-", 0.5); part(t, 0, 3.52, 4.0, 2.74, clamp(cell, 0.04, 0.2), 9.2);
  // Rear doors: centre seam and lock bars.
  scene.paint(t, [22, 24, 28], "|"); part(t, 0, 2.15, 8.662, line, 2.8, 0.02);
  scene.paint(t, [150, 152, 156], "|", 0.8); for (const x of [-1.0, -0.4, 0.4, 1.0]) part(t, x, 2.15, 8.666, Math.max(0.05, cell * 0.8), 2.6, 0.02);
  // Livery: the company name in big block letters down each side of the box.
  const word = LIVERY_WORDS[Math.abs(state.variant) % LIVERY_WORDS.length], unit = 0.3, advance = 4 * unit;
  scene.paint(t, LIVERY_INKS[Math.abs(state.variant >> 1) % LIVERY_INKS.length], "#", 0.9);
  // Text runs toward -z on the +x side and +z on the -x side, so both sides read left to right.
  for (const s of [-1, 1]) for (let i = 0; i < word.length; i++) {
    const dir = -s, letterZ = 4.0 + dir * (i - (word.length - 1) / 2) * advance;
    for (const [column, row, length] of letterStrokes(word[i])) {
      const z = letterZ + dir * (column + (length - 1) / 2 - 1) * unit;
      part(t, s * 1.37, 2.6 + (2 - row) * unit, z, 0.02, unit, length * unit);
    }
  }
}
