import type { PropCanvas } from "./prop-canvas.ts";
import { parkBlock } from "./park.ts";
import { pedestrianGreen, trafficGreen } from "./people.ts";
import { LINE_PER_METRE } from "./landmarks-scene.ts";
import { BLOCK_SIZE, HALF_BLOCKS, LANDMARKS, districtAt, randomFor, type RGB, type StreetLamp } from "./world.ts";

/**
 * Street life between the buildings (activity.ts calls this once per frame while recording props):
 * cables strung across the alleys between plots with lanterns, laundry and banners; lantern lines
 * and power lines across the streets at mid-block; three-lamp signal heads, walk signals and
 * street-sign blades on the corner lamp posts; small drones with running lights over the streets;
 * and rats darting along the alleys. Everything is deterministic (`randomFor` per block, the
 * scene clock for motion) and above head height or under 0.5 m, so none of it needs collision
 * (`CityWorld.canOccupy`) or touches the walking lines, crossings, parking lanes or lamp posts.
 */
export type StreetPaint = (canvas: PropCanvas, color: RGB, glyph: string, gain?: number) => void;
export interface StreetKit { paint: StreetPaint; range: (meters: number) => number; restore: (code: number) => void }
export interface StreetView { x: number; z: number; time: number; signalTime?: number; low: boolean; visible?: (x: number, y: number, z: number, radius?: number) => boolean }

const DEG = 180 / Math.PI;
/** Plot faces along a mid-block alley lie 26.5-37.5 m into the block (world.ts: plots at 19 and
 * 45 m, 15-22 m deep or wide), so a cable from 26 to 38 m always ends inside both buildings. */
const ALLEY_FROM = 26, ALLEY_TO = 38;
/** Across a street the faces are 8-11.5 m from the centre line (18.5 m on the avenue). */
const STREET_REACH = 12, AVENUE_REACH = 19;
const LANTERNS: readonly (readonly RGB[])[] = [
  [[255, 150, 70], [255, 96, 60]], // The Foundry
  [[255, 80, 170], [90, 230, 255]], // Neon Ward
  [[140, 160, 255], [90, 230, 255]], // Ghost Circuit
  [[140, 255, 190], [255, 210, 130]], // Rain Gardens
  [[255, 86, 64], [255, 200, 100]], // Silk Market
  [[255, 200, 100], [255, 140, 80]], // The Spillway
];
const LAUNDRY: readonly RGB[] = [[150, 60, 70], [70, 100, 150], [170, 160, 130], [80, 130, 100], [150, 120, 60], [120, 80, 140]];

function strut(t: PropCanvas, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number): void {
  const dx = bx - ax, dy = ay - by, dz = bz - az; // textmode Y points down
  t.push(); t.translate((ax + bx) / 2, -(ay + by) / 2, (az + bz) / 2);
  t.rotateY(Math.atan2(dx, dz) * DEG); t.rotateX(Math.atan2(Math.hypot(dx, dz), dy) * DEG);
  t.box(w, Math.hypot(dx, dy, dz), w); t.pop();
}
function box(t: PropCanvas, x: number, y: number, z: number, w: number, h: number, d: number): void {
  t.translate(x, -y, z); t.box(w, h, d); t.translate(-x, y, -z);
}
function blob(t: PropCanvas, x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
  t.translate(x, -y, z); t.ellipsoid(rx, ry, rz); t.translate(-x, y, -z);
}

/** True when all four plots of a block were built (world.ts CityWorld: park and landmark blocks
 * are reserved, and plots on the six station concourses are skipped). Keep in step with world.ts. */
export function blockHasPlots(bx: number, bz: number): boolean {
  if (bx < -HALF_BLOCKS || bx >= HALF_BLOCKS || bz < -HALF_BLOCKS || bz >= HALF_BLOCKS || parkBlock(bx, bz)) return false;
  if (LANDMARKS.some(l => l.kind !== "gate" && Math.floor(l.x / BLOCK_SIZE) === bx && Math.floor(l.z / BLOCK_SIZE) === bz)) return false;
  for (let plot = 0; plot < 4; plot++) {
    const original = bx * BLOCK_SIZE + (plot % 2 === 0 ? 19 : 45), x = Math.abs(original) < 24 ? Math.sign(original) * 25 : original;
    const z = bz * BLOCK_SIZE + (plot < 2 ? 19 : 45);
    if (Math.abs(Math.abs(z) - 320) < 28 && [-448, 0, 448].some(stop => Math.abs(x - stop) < 35)) return false;
  }
  return true;
}

/** A sagging cable from a to b (three straight runs; `width` at least a cell at its distance), returning its four points. */
function cable(t: PropCanvas, ax: number, az: number, bx: number, bz: number, y: number, sag: number, width: number): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (let k = 0; k <= 3; k++) { const s = k / 3; points.push([ax + (bx - ax) * s, y - sag * 4 * s * (1 - s), az + (bz - az) * s]); }
  for (let k = 0; k < 3; k++) strut(t, ...points[k], ...points[k + 1], width);
  return points;
}

/** Things hung on a cable: lanterns, laundry or a banner. */
function hangings(t: PropCanvas, kit: StreetKit, points: readonly [number, number, number][], kind: number, district: number, seed: number, distance: number): void {
  // Small parts are prefiltered: strings only close up, lanterns and cloth never thinner than a cell.
  const line = distance * LINE_PER_METRE, near = distance < 70;
  const [a, b] = LANTERNS[district] ?? LANTERNS[1];
  const [x0, y0, z0] = points[0], [x3, , z3] = points[3];
  const sagAt = (s: number) => { const [, y1] = points[1]; const sag = (y0 - y1) / (4 * (1 / 3) * (2 / 3)); return y0 - sag * 4 * s * (1 - s); };
  if (kind === 0) {
    // Paper lanterns at intervals along the cable.
    for (let k = 1; k <= 4; k++) {
      const s = k / 5, lx = x0 + (x3 - x0) * s, lz = z0 + (z3 - z0) * s, ly = sagAt(s);
      if (distance < 25) { kit.paint(t, [60, 52, 44], "|"); box(t, lx, ly - 0.2, lz, 0.03, 0.4, 0.03); }
      const radius = Math.max(0.24, line * 0.5);
      kit.paint(t, k % 2 ? a : b, "o", 1.0); blob(t, lx, ly - 0.62, lz, radius, Math.max(0.34, radius), radius);
    }
  } else if (kind === 1 && near) {
    // Laundry: cloths of different sizes pegged along the line.
    const along = Math.atan2(x3 - x0, z3 - z0) * DEG;
    for (let k = 0; k < 6; k++) {
      const s = 0.12 + k * 0.15, lx = x0 + (x3 - x0) * s, lz = z0 + (z3 - z0) * s, h = 0.5 + randomFor(seed, k, 3) * 0.6;
      kit.paint(t, LAUNDRY[Math.floor(randomFor(seed, k, 4) * LAUNDRY.length)], k % 2 ? "=" : "#", 0.8);
      t.push(); t.translate(lx, -(sagAt(s) - h / 2 - 0.02), lz); t.rotateY(along + 90); t.box(0.45 + randomFor(seed, k, 5) * 0.4, h, Math.max(0.03, line)); t.pop();
    }
  } else if (kind === 2) {
    // A cloth banner hanging from the middle of the line, glowing faintly.
    const lx = (x0 + x3) / 2, lz = (z0 + z3) / 2, ly = sagAt(0.5), along = Math.atan2(x3 - x0, z3 - z0) * DEG;
    kit.paint(t, a, "=", 0.95);
    t.push(); t.translate(lx, -(ly - 1.35), lz); t.rotateY(along + 90); t.box(Math.max(0.9, line), 2.6, Math.max(0.05, line)); t.pop();
  }
}

/** A cable strung between two buildings: ends (x, z) inside both, height and sag at mid-span,
 * what hangs on it (-1 nothing, 0 lanterns, 1 laundry, 2 a banner), its district and seed. */
export interface CableSpan { ax: number; az: number; ex: number; ez: number; y: number; sag: number; hang: -1 | 0 | 1 | 2; district: number; seed: number }
const spanCache = new Map<number, readonly CableSpan[]>();
/**
 * The cables belonging to block (bx, bz): up to six across each of its two mid-block alleys, and
 * one across each of the streets on its west (x = bx * 64) and north (z = bz * 64) sides when both
 * neighbouring blocks have buildings. Deterministic; cached per block.
 */
export function cableSpans(bx: number, bz: number): readonly CableSpan[] {
  const key = (bx + 64) * 256 + (bz + 64);
  const cached = spanCache.get(key);
  if (cached) return cached;
  const spans: CableSpan[] = [];
  const ox = bx * BLOCK_SIZE, oz = bz * BLOCK_SIZE;
  if (blockHasPlots(bx, bz)) {
    const district = districtAt(ox + 32, oz + 32).id;
    // Alleys: the gap between the plots along z (cables span x) and along x (cables span z).
    for (const across of ["x", "z"] as const) for (let k = 0; k < 6; k++) {
      const seed = randomFor(bx * 7 + (across === "x" ? 1 : 2), bz * 5 + k, 4401);
      if (seed < 0.4) continue;
      const at = [13, 18, 24, 40, 46, 51][k] + (seed - 0.7) * 3;
      // Plot spans are 11.5-26.5 and 37.5-52.5 m into a block, except beside the avenue (x = +-25 plots).
      if (across === "z" && ((bx === 0 && at < 19.5) || (bx === -1 && at > 44.5))) continue;
      const kind = Math.floor(randomFor(bx, bz, 4405 + k + (across === "x" ? 0 : 9)) * 4);
      spans.push({
        ax: across === "x" ? ox + ALLEY_FROM : ox + at, az: across === "x" ? oz + at : oz + ALLEY_FROM,
        ex: across === "x" ? ox + ALLEY_TO : ox + at, ez: across === "x" ? oz + at : oz + ALLEY_TO,
        y: 6.5 + randomFor(bx, bz * 3 + k, 4403) * 8, sag: 0.35 + seed * 0.5, hang: kind < 3 ? kind as 0 | 1 | 2 : -1, district, seed: bx * 131 + bz * 17 + k,
      });
    }
  }
  // Across the streets at mid-block: lantern lines (Silk Market, Neon Ward), banners and power lines.
  for (const street of ["ns", "ew"] as const) {
    const line = (street === "ns" ? bx : bz) * BLOCK_SIZE;
    if (Math.abs(line) >= HALF_BLOCKS * BLOCK_SIZE) continue;
    const seed = randomFor(bx * 3 + (street === "ns" ? 1 : 2), bz * 11, 4420);
    const bothSides = street === "ns" ? blockHasPlots(bx - 1, bz) && blockHasPlots(bx, bz) : blockHasPlots(bx, bz - 1) && blockHasPlots(bx, bz);
    if (seed < 0.5 || !bothSides) continue;
    const along = (seed > 0.75 ? 20 : 44) + (street === "ns" ? oz : ox), half = street === "ns" && bx === 0 ? AVENUE_REACH : STREET_REACH;
    const mx = street === "ns" ? line : along, mz = street === "ns" ? along : line, district = districtAt(mx, mz).id;
    const hang = district === 4 || district === 1 || seed > 0.85 ? (district === 1 && seed < 0.7 ? 2 : 0) : -1;
    spans.push(street === "ns"
      ? { ax: line - half, az: along, ex: line + half, ez: along, y: 9.5 + seed * 3, sag: 0.8, hang, district, seed: bx * 71 + bz }
      : { ax: along, az: line - half, ex: along, ez: line + half, y: 9.5 + seed * 3, sag: 0.8, hang, district, seed: bx * 71 + bz + 5 });
  }
  spanCache.set(key, spans);
  return spans;
}

export function drawStreetLife(t: PropCanvas, view: StreetView, kit: StreetKit): void {
  const { x, z, time, low } = view;
  const reach = low ? 100 : 150;
  const outer = kit.range(reach);
  const cx = Math.floor(x / BLOCK_SIZE), cz = Math.floor(z / BLOCK_SIZE), radius = low ? 1 : 2;
  for (let bz = cz - radius; bz <= cz + radius + 1; bz++) for (let bx = cx - radius; bx <= cx + radius + 1; bx++) {
    for (const span of cableSpans(bx, bz)) {
      const mx = (span.ax + span.ex) / 2, mz = (span.az + span.ez) / 2, distance = Math.hypot(mx - x, mz - z);
      if (distance > reach || (view.visible && !view.visible(mx, span.y, mz, Math.hypot(span.ex - span.ax, span.ez - span.az) / 2))) continue;
      kit.paint(t, [30, 34, 38], "-");
      const points = cable(t, span.ax, span.az, span.ex, span.ez, span.y, span.sag, Math.max(0.05, distance * LINE_PER_METRE));
      if (span.hang >= 0) hangings(t, kit, points, span.hang, span.district, span.seed, distance);
    }
    // Rats along the alley floor, close by only: 0.25 m, quick and low.
    const ox = bx * BLOCK_SIZE, oz = bz * BLOCK_SIZE;
    if (!low && Math.hypot(ox + 32 - x, oz + 32 - z) < 40 && blockHasPlots(bx, bz)) {
      for (let k = 0; k < 2; k++) {
        const run = ((time * (2.6 + k * 0.7) + randomFor(bx, bz, 4410 + k) * 44) % 44 + 44) % 44, rx = ox + 32 + (k ? 1.2 : -1.4), rz = oz + 10 + run;
        if (Math.abs(rz - (oz + 32)) < 3 || Math.hypot(rx - x, rz - z) > 25) continue; // not across the alley crossing; tiny, so close up only
        kit.paint(t, [56, 50, 48], "~");
        box(t, rx, 0.07, rz, 0.1, 0.1, 0.24); box(t, rx, 0.05, rz - 0.22, 0.03, 0.03, 0.22);
      }
    }
  }
  kit.restore(outer);
  drawDrones(t, view, kit);
}

/** Corner furniture on a lamp post (activity.ts draws the post): a three-lamp head for each axis,
 * walk signals and two street-sign blades, all within the post's footprint or above 2.4 m. */
export function drawSignalPost(t: PropCanvas, lamp: StreetLamp, signalTime: number, distance: number, kit: StreetKit): void {
  const lx = lamp.postX, lz = lamp.z, phase = ((signalTime % 28) + 28) % 28;
  // The lit lamp is never smaller than about a cell (it would blink in and out as the camera moves);
  // unlit lamps, walk signals and blades are small parts and appear only close up.
  const lit = Math.max(0.4, distance * LINE_PER_METRE), near = distance < 35;
  for (const axis of ["z", "x"] as const) {
    // trafficGreen: z green 0-11 s, x green 14-25 s; the last 2.5 s of each green show amber.
    const green = trafficGreen(axis, signalTime), amber = green && (axis === "z" ? phase >= 8.5 : phase >= 22.5);
    const hx = axis === "z" ? lx : lx - 0.42, hz = axis === "z" ? lz - 0.4 : lz;
    kit.paint(t, [33, 52, 72], "#");
    if (axis === "z") box(t, lx, 5.8, lz - 0.1, 0.65, 1.5, 0.5); else box(t, lx - 0.1, 5.8, lz, 0.5, 1.5, 0.65);
    const lamps: readonly [number, RGB, boolean][] = [[6.25, [255, 78, 91], !green], [5.8, [255, 190, 70], amber], [5.35, [88, 255, 163], green && !amber]];
    for (const [y, color, on] of lamps) {
      if (!on && distance > 70) continue;
      kit.paint(t, on ? color : [Math.round(color[0] * 0.18), Math.round(color[1] * 0.18), Math.round(color[2] * 0.18)], on ? "O" : "o");
      const size = on ? lit : 0.4, depth = on ? Math.max(0.1, lit * 0.5) : 0.1;
      if (axis === "z") box(t, hx, y, hz, size, Math.max(0.36, lit * 0.9), depth); else box(t, hx, y, hz, depth, Math.max(0.36, lit * 0.9), size);
    }
  }
  if (!near) return;
  // Walk signals (white figure / orange hand) for the two crossings at this corner.
  for (const axis of ["x", "z"] as const) {
    const walk = pedestrianGreen(axis, signalTime);
    kit.paint(t, walk ? [235, 240, 236] : [255, 120, 50], walk ? "i" : "#", walk ? 1.05 : 0.95);
    if (axis === "x") box(t, lx, 2.75, lz + 0.2, 0.26, 0.32, 0.06); else box(t, lx + 0.2, 2.75, lz, 0.06, 0.32, 0.26);
  }
  // Street-sign blades above the walk signals, one along each street.
  kit.paint(t, [36, 110, 88], "=", 0.9);
  box(t, lx, 3.45, lz + 0.62, 0.04, 0.26, 1.2); box(t, lx - 0.62, 3.75, lz, 1.2, 0.26, 0.04);
}

/** Small drones crossing over the streets near the camera, with static running lights. */
function drawDrones(t: PropCanvas, view: StreetView, kit: StreetKit): void {
  const { x, z, time, low } = view;
  const count = low ? 4 : 9, outer = kit.range(low ? 200 : 300);
  for (let i = 0; i < count; i++) {
    const axis = i % 2 ? "x" : "z", street = (axis === "z" ? Math.round(x / BLOCK_SIZE) : Math.round(z / BLOCK_SIZE)) + ((i >> 1) % 5) - 2;
    const span = 1472, speed = 7 + (i % 3) * 2.5, direction = i % 4 < 2 ? 1 : -1;
    const along = ((time * speed * direction + randomFor(i, 3, 4430) * span) % span + span) % span - span / 2;
    const lateral = street * BLOCK_SIZE + (i % 3 - 1) * 2.4, y = 15 + (i * 7) % 24;
    const px = axis === "z" ? lateral : along, pz = axis === "z" ? along : lateral;
    const distance = Math.hypot(px - x, pz - z);
    if (distance > (low ? 200 : 300) || (view.visible && !view.visible(px, y, pz, 2))) continue;
    if (distance > 45) {
      // Far away a drone is its light: one point at least a cell wide, so it glides instead of blinking.
      const size = Math.max(0.3, distance * LINE_PER_METRE);
      kit.paint(t, i % 2 ? [255, 120, 120] : [200, 230, 255], "*", 1.05); box(t, px, y, pz, size, size, size);
      continue;
    }
    const ln = Math.max(0.06, distance * LINE_PER_METRE), light = Math.max(0.14, ln);
    t.push(); t.translate(px, -y, pz); t.rotateY(axis === "z" ? (direction > 0 ? 180 : 0) : direction > 0 ? -90 : 90);
    kit.paint(t, [44, 50, 58], "#"); t.box(0.7, 0.16, 0.7);
    kit.paint(t, [70, 76, 84], "-"); t.rotateY(45); t.box(1.5, ln, ln); t.box(ln, ln, 1.5); t.rotateY(-45);
    kit.paint(t, [255, 70, 80], "*", 1.1); t.translate(-0.55, 0, 0); t.box(light, light, light);
    kit.paint(t, [80, 255, 150], "*", 1.1); t.translate(1.1, 0, 0); t.box(light, light, light); t.translate(-0.55, 0, 0);
    // A soft belly light breathing at 0.4 Hz, and a parcel or a tiny ad panel on some.
    kit.paint(t, [220, 236, 255], "o", 0.8 + 0.25 * Math.sin(time * 2.5 + i)); t.translate(0, 0.14, 0); t.box(light, ln, light); t.translate(0, -0.14, 0);
    if (i % 3 === 0) { kit.paint(t, [150, 116, 80], "#"); t.translate(0, 0.42, 0); t.box(0.42, 0.36, 0.42); t.translate(0, -0.42, 0); }
    else if (i % 3 === 1) { kit.paint(t, (LANTERNS[i % LANTERNS.length])[1], "=", 1.05); t.translate(0, 0.75, 0); t.box(1.3, 0.62, ln); t.translate(0, -0.75, 0); }
    t.pop();
  }
  kit.restore(outer);
}

