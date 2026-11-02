import type { PropCanvas } from "./prop-canvas.ts";
import { ink, propRange, restorePropRange } from "./activity.ts";
import { LINE_PER_METRE } from "./landmarks-scene.ts";
import { gustAt, windAt } from "./weather.ts";
import { ANIMATION_HZ, activeEvents, eventSite, type ActiveCityEvent } from "./city-events.ts";
import type { RGB } from "./world.ts";
/** engine.ts imports the scheduler's watch from here so it needs a single import line. */
export { cityEventWatch } from "./city-events.ts";

/**
 * Events agent: draws the scheduled happenings of city-events.ts while recording props (engine.ts
 * recordProps). Bounded geometry, only while a happening runs and the eye is near it, and nothing
 * on the `low` profile. Far lights keep at least a cell's size (street-life.ts drones) so they glide
 * instead of blinking. Every periodic change uses ANIMATION_HZ (all below 0.4 Hz) and every
 * happening blooms in and fades out over seconds (`event.level`).
 */
export interface EventView { x: number; z: number; time: number; signalTime?: number; height?: number; low: boolean; visible?: (x: number, y: number, z: number, radius?: number) => boolean }

const TAU = Math.PI * 2, DEG = 180 / Math.PI;
const wave = (rate: number, age: number, phase = 0): number => Math.sin(age * TAU * rate + phase);
const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

function box(t: PropCanvas, x: number, y: number, z: number, w: number, h: number, d: number): void {
  t.translate(x, -y, z); t.box(w, h, d); t.translate(-x, y, -z);
}
/** A rotated box (yaw in radians, local +z along (sin yaw, cos yaw) as street-life.ts strut). */
function slab(t: PropCanvas, x: number, y: number, z: number, yaw: number, w: number, h: number, d: number, roll = 0): void {
  t.push(); t.translate(x, -y, z); t.rotateY(yaw * DEG); if (roll) t.rotateZ(roll); t.box(w, h, d); t.pop();
}

interface Eye { x: number; y: number; z: number }
/** A light at least a cell wide at its distance. */
function light(t: PropCanvas, eye: Eye, x: number, y: number, z: number, color: RGB, gain: number, scale = 1.1, min = 0.3, glyph = "*"): void {
  const size = Math.max(min, Math.hypot(x - eye.x, y - eye.y, z - eye.z) * LINE_PER_METRE * scale);
  ink(t, color, glyph, gain); box(t, x, y, z, size, size, size);
}

export function drawCityEvents(t: PropCanvas, view: EventView): void {
  if (view.low) return;
  const time = view.signalTime ?? view.time;
  const events = activeEvents(time);
  if (events.length === 0) return;
  const eye: Eye = { x: view.x, y: view.height ?? 2.7, z: view.z };
  for (const event of events) {
    if (event.level <= 0.001) continue;
    if (event.kind === "satellite") { const outer = propRange(0); satellite(t, eye, event); restorePropRange(outer); continue; }
    const site = eventSite(event.kind), distance = Math.hypot(event.x - eye.x, event.z - eye.z);
    if (distance > site.drawRadius) continue;
    const outer = propRange(event.kind === "flare" ? 0 : site.drawRadius);
    if (event.kind === "drones") drones(t, eye, event, view);
    else if (event.kind === "lanterns") lanterns(t, eye, event, view, time);
    else if (event.kind === "checkpoint") checkpoint(t, eye, event, view);
    else if (event.kind === "flare") flare(t, eye, event);
    else if (event.kind === "substation") substation(t, eye, event, view, time);
    else if (event.kind === "protest") protest(t, eye, event, view);
    restorePropRange(outer);
  }
}

// ---------------------------------------------------------------------------------------------
// Drone light show: 64 lights behind Memory Gate, holding a shape for 6 s, then morphing into the
// next over 10 s. They rise from a hover grid over the avenue in the first 14 s and return in the last 14 s.

const DRONES = 64, SHAPE_HOLD = 6, SHAPE_MORPH = 10, SHAPE_COUNT = 5;
const SHAPE_COLORS: readonly RGB[] = [[90, 230, 255], [255, 168, 92], [220, 230, 255], [255, 84, 170], [120, 255, 200]];
/** Unit-space formation point of drone `i` in shape `s` (x right, y up, z depth). */
function shapePoint(s: number, i: number, age: number): [number, number, number] {
  const p = i / DRONES, a = p * TAU;
  if (s === 0) return [Math.cos(a), Math.sin(a), 0.18 * Math.sin(a * 3)]; // a ring
  if (s === 1) {
    // A koi: a tapered body, a forked tail and an eye, its body waving slowly.
    if (i === DRONES - 1) return [0.75, 0.12, 0.05];
    if (i >= 50) { const f = (i - 50) / 12, side = i % 2 ? 1 : -1; return [-1.05 - 0.55 * f, side * 0.62 * f, 0]; }
    const b = (i / 50) * TAU, x = 1.15 * Math.cos(b), y = 0.5 * Math.sin(b) * (0.55 + 0.45 * Math.cos(b));
    return [x, y + 0.07 * wave(ANIMATION_HZ.koiSwim, age, x * 2.4), 0.22 * Math.sin(b * 2)];
  }
  if (s === 2) {
    // A crescent moon: the outer arc and the inner bite.
    if (i < 36) { const b = (-0.78 + 1.56 * (i / 35)) * Math.PI; return [Math.cos(b) * -1, Math.sin(b), 0]; }
    const b = (-0.55 + 1.1 * ((i - 36) / 27)) * Math.PI; return [-0.42 - Math.cos(b) * 0.78, Math.sin(b) * 0.78, 0];
  }
  if (s === 3) {
    // The Nightfall "N": two uprights and the diagonal.
    const stroke = Math.floor(i / 22), f = (i % 22) / 21;
    if (stroke === 0) return [-0.7, -1 + 2 * f, 0];
    if (stroke === 1) return [-0.7 + 1.4 * f, 1 - 2 * f, 0.1];
    return [0.7, -1 + 2 * Math.min(1, f * 22 / 19), 0];
  }
  // A slowly turning globe (fibonacci sphere).
  const y = 1 - 2 * (i + 0.5) / DRONES, r = Math.sqrt(1 - y * y), b = i * 2.39996 + age * TAU * ANIMATION_HZ.droneSwing;
  return [Math.cos(b) * r, y, Math.sin(b) * r];
}

function drones(t: PropCanvas, eye: Eye, event: ActiveCityEvent, view: EventView): void {
  const cx = event.x, cy = 38, cz = event.z + 30, scale = 13;
  if (view.visible && !view.visible(cx, cy - 10, cz, 40)) return;
  const age = event.age, duration = event.end - event.start, cycle = SHAPE_HOLD + SHAPE_MORPH;
  const step = Math.floor(age / cycle), first = event.seed % SHAPE_COUNT;
  const shapeA = (first + step) % SHAPE_COUNT, shapeB = (first + step + 1) % SHAPE_COUNT;
  const morph = smooth((age - step * cycle - SHAPE_HOLD) / SHAPE_MORPH);
  const flight = smooth(age / 14) * smooth((duration - age) / 14);
  const swing = 0.3 * wave(ANIMATION_HZ.droneSwing, age), cs = Math.cos(swing), sn = Math.sin(swing);
  const color = mix(SHAPE_COLORS[shapeA], SHAPE_COLORS[shapeB], morph);
  for (let i = 0; i < DRONES; i++) {
    const a = shapePoint(shapeA, i, age), b = shapePoint(shapeB, i, age);
    const ux = a[0] + (b[0] - a[0]) * morph, uy = a[1] + (b[1] - a[1]) * morph, uz = a[2] + (b[2] - a[2]) * morph;
    const fx = cx + (ux * cs + uz * sn) * scale, fy = cy + uy * scale, fz = cz + (uz * cs - ux * sn) * scale;
    // Staging grid: an 8 x 8 hover grid 9 m over the avenue behind the gate (clear of the traffic).
    const px = cx + ((i % 8) - 3.5) * 2.2, pz = event.z + 12 + Math.floor(i / 8) * 2.2;
    const x = px + (fx - px) * flight, y = 9 + (fy - 9) * flight, z = pz + (fz - pz) * flight;
    const gain = event.level * (0.55 + 0.45 * flight) * (0.92 + 0.08 * wave(ANIMATION_HZ.droneTwinkle, age, i * 1.7));
    light(t, eye, x, y, z, color, gain * 1.1, 1.1, 0.32);
  }
}

// ---------------------------------------------------------------------------------------------
// Sky lanterns: 36 warm lanterns released around the Last Tree over the first 40 s, rising at
// ~0.5 m/s, drifting with the wind (leaning together in gusts) and fading out around 30-42 m.

const LANTERNS = 36, LANTERN_WARM: RGB = [255, 168, 78], LANTERN_PAPER: RGB = [190, 96, 52];
function lanterns(t: PropCanvas, eye: Eye, event: ActiveCityEvent, view: EventView, time: number): void {
  const wind = windAt(time), gust = gustAt(time);
  if (view.visible && !view.visible(event.x + 30, 22, event.z + 10, 80)) return;
  for (let i = 0; i < LANTERNS; i++) {
    const r1 = ((event.seed >>> (i % 24)) & 255) / 255, r2 = ((i * 2654435761) >>> 0) / 4294967296;
    const release = (i / LANTERNS) * 40 + r1 * 3, age = event.age - release;
    if (age < -5) continue;
    const angle = i * 2.39996 + r1, radius = 7 + 15 * r2;
    const rise = Math.max(0, age) * (0.48 + 0.12 * r2);
    const drift = rise * 1.2; // metres downwind: the mean breeze (weather.ts windAt) carries them
    const lean = Math.min(1, rise / 6) * (gust * 3.5);
    const x = event.x + Math.cos(angle) * radius + drift * 0.93 + lean * (wind.x / Math.hypot(wind.x, wind.z)) + 1.2 * wave(ANIMATION_HZ.lanternWander, event.age, i);
    const z = event.z + Math.sin(angle) * radius + drift * 0.36 + lean * (wind.z / Math.hypot(wind.x, wind.z)) + 1.2 * wave(ANIMATION_HZ.lanternWander, event.age, i * 2.1);
    const y = 1.4 + rise;
    // Lit on the ground for a few seconds before letting go; fading into the cloud deck from 30 m.
    const fade = smooth((age + 5) / 4) * (1 - smooth((y - 30) / 12));
    if (fade <= 0.01) continue;
    const gain = event.level * fade * (0.88 + 0.12 * wave(ANIMATION_HZ.lanternBreath, event.age, i * 0.9));
    const distance = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
    if (distance < 60) {
      ink(t, LANTERN_PAPER, "#", gain * 0.9); box(t, x, y + 0.08, z, 0.46, 0.56, 0.46);
      ink(t, LANTERN_WARM, "o", gain * 1.1); box(t, x, y - 0.26, z, Math.max(0.24, distance * LINE_PER_METRE), 0.14, Math.max(0.24, distance * LINE_PER_METRE));
    } else light(t, eye, x, y, z, LANTERN_WARM, gain * 1.05, 1.1, 0.3, "o");
  }
}

// ---------------------------------------------------------------------------------------------
// CorpSec checkpoint on the east pavement of the Neon Ward avenue (road < 12.4 m, kerb to 13.2 m):
// a van half on the kerb with a roof lamp blending red and blue, barriers, two guards and a
// floodlight mast pouring a pool of light on the pavement.

const CORPSEC: RGB = [56, 62, 74], CORP_RED: RGB = [255, 64, 72], CORP_BLUE: RGB = [70, 120, 255];
function checkpoint(t: PropCanvas, eye: Eye, event: ActiveCityEvent, view: EventView): void {
  const x = event.x, z = event.z;
  if (view.visible && !view.visible(x, 3, z, 16)) return;
  // Everything slides in over the bloom: no popping.
  const level = event.level, settle = 1 - level;
  // The van, half up on the kerb, nose to the north.
  const vx = x - 3.2, vz = z + 4 + settle * 6;
  ink(t, CORPSEC, "#", 0.4 + 0.6 * level); box(t, vx, 1.35, vz, 2.3, 2.1, 6.2);
  ink(t, [36, 70, 110], "=", 0.8 * level); box(t, vx, 1.75, vz - 3.05, 2.1, 0.7, 0.12); box(t, vx - 1.16, 1.75, vz - 1.4, 0.06, 0.6, 1.6); box(t, vx + 1.16, 1.75, vz - 1.4, 0.06, 0.6, 1.6);
  ink(t, [34, 38, 46], "o", 0.9); for (const sx of [-1, 1]) for (const sz of [-1.9, 1.9]) box(t, vx + sx * 1.05, 0.36, vz + sz, 0.3, 0.72, 0.72);
  const blend = 0.5 + 0.5 * wave(ANIMATION_HZ.checkpointLamp, event.age);
  light(t, eye, vx - 0.5, 2.55, vz - 1.6, mix(CORP_RED, CORP_BLUE, blend), level * 1.05, 1.1, 0.42, "O");
  light(t, eye, vx + 0.5, 2.55, vz - 1.6, mix(CORP_BLUE, CORP_RED, blend), level * 1.05, 1.1, 0.42, "O");
  // Barriers: along the kerb, then two across the pavement leaving a 1.4 m gate.
  for (let k = 0; k < 6; k++) {
    ink(t, k % 2 ? [214, 214, 204] : [208, 62, 58], "=", 0.35 + 0.6 * level);
    box(t, x - 2.1, 0.45, z - 9 + k * 2.1, 0.5, 0.9 * level + 0.05, 1.9);
  }
  for (const bz of [z - 10, z + 3.5]) for (const bx of [x - 1.2, x + 1.8]) {
    ink(t, bx > x ? [208, 62, 58] : [214, 214, 204], "=", 0.35 + 0.6 * level);
    box(t, bx, 0.45, bz, 1.9, 0.9 * level + 0.05, 0.5);
  }
  // Two guards by the gap: dark coats, a cyan visor line, standing still.
  for (const [gx, gz] of [[x - 0.4, z - 11], [x + 0.6, z + 4.6]] as const) {
    if (Math.hypot(gx - eye.x, gz - eye.z) > 120) continue;
    ink(t, [40, 44, 54], "#", 0.9); box(t, gx, 0.85, gz, 0.5, 1.7 * level, 0.34); box(t, gx, 1.9, gz, 0.3, 0.32 * level, 0.3);
    ink(t, [90, 230, 255], "-", level); box(t, gx, 1.93, gz - 0.16, 0.26, 0.06, 0.03);
  }
  // Floodlight mast at the back of the pavement, its head tilted onto the gate.
  const mx = x + 2.6, mz = z - 5, top = 6.2 * (0.3 + 0.7 * level);
  ink(t, [60, 66, 74], "|", 0.9); box(t, mx, top / 2, mz, 0.16, top, 0.16);
  light(t, eye, mx - 0.3, top, mz, [236, 242, 255], level * 1.1, 1.0, 0.5, "O");
  // The beam: four faint edges down to the pool, and the pool of light itself.
  ink(t, [130, 150, 182], ".", 0.55 * level);
  const px = x - 0.2, pz = z - 3.8;
  for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
    const ex = px + ox, ez = pz + oz, dx = ex - (mx - 0.3), dz = ez - mz, dy = top;
    t.push(); t.translate((mx - 0.3 + ex) / 2, -top / 2, (mz + ez) / 2); t.rotateY(Math.atan2(dx, dz) * DEG); t.rotateX(Math.atan2(Math.hypot(dx, dz), dy) * DEG);
    t.box(0.05, Math.hypot(dx, dy, dz), 0.05); t.pop();
  }
  ink(t, [150, 170, 204], ".", 0.6 * level); box(t, px, 0.03, pz, 4.4, 0.04, 4.4);
}

// ---------------------------------------------------------------------------------------------
// Harbour flares: two red flares from a ship beyond the rim, each climbing for 8 s, then hanging
// under its parachute and sinking slowly for 40 s, with a fading smoke trail along the climb.

const FLARE_RED: RGB = [255, 62, 52], SMOKE: RGB = [120, 70, 70];
function flare(t: PropCanvas, eye: Eye, event: ActiveCityEvent): void {
  for (let n = 0; n < 2; n++) {
    const launch = n * 24, age = event.age - launch, life = 46;
    if (age < 0 || age > life) continue;
    const x0 = event.x + (n ? -70 : 0), z0 = event.z + (n ? 30 : 0), climb = 8, apex = 135 + n * 15;
    const pathAt = (a: number): [number, number, number] => {
      if (a <= climb) { const u = a / climb; return [x0 + 14 * u, 8 + (apex - 8) * (1 - (1 - u) * (1 - u)), z0 - 6 * u]; }
      const d = a - climb; return [x0 + 14 + d * 0.9, apex - d * 2.1, z0 - 6 + d * 0.3];
    };
    const [hx, hy, hz] = pathAt(age);
    const glow = smooth(age / 3) * smooth((life - age) / 10) * Math.min(1, event.level + 0.2);
    light(t, eye, hx, hy, hz, FLARE_RED, glow * (1.05 + 0.08 * wave(ANIMATION_HZ.flareWaver, age, n)), 1.7, 1.2, "*");
    // The smoke trail along the climb, thinning as it ages.
    for (let k = 0; k < 14; k++) {
      const at = (k / 14) * Math.min(age, climb), [sx, sy, sz] = pathAt(at);
      const fade = Math.exp(-(age - at) / 16) * smooth(age / 2) * smooth((life - age) / 10);
      if (fade < 0.04) continue;
      light(t, eye, sx, sy, sz, SMOKE, 0.6 * fade, 1.1, 0.8, ":");
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Foundry grid fault: a fenced substation in the Ember Core's plaza with an arc that swells and
// eases, a soft plume of embers, and two utility vans with swelling amber beacons on the street.

const EMBER: RGB = [255, 140, 60], AMBER: RGB = [255, 168, 56], UTILITY: RGB = [196, 168, 88];
function substation(t: PropCanvas, eye: Eye, event: ActiveCityEvent, view: EventView, time: number): void {
  const x = event.x, z = event.z, level = event.level, age = event.age;
  if (!view.visible || view.visible(x, 6, z, 22)) {
    ink(t, [74, 70, 66], "=", 0.9); box(t, x, 0.2, z, 6, 0.4, 4);
    ink(t, [82, 86, 90], "#", 0.9); box(t, x - 1.4, 1.5, z, 1.7, 2.2, 1.7); box(t, x + 1.4, 1.5, z, 1.7, 2.2, 1.7);
    ink(t, [150, 154, 150], "|", 0.9); for (const ix of [-1.9, -0.9, 0.9, 1.9]) box(t, x + ix, 3, z, 0.16, 0.9, 0.16);
    ink(t, [92, 88, 80], "+", 0.75);
    box(t, x, 0.9, z - 2.6, 7, 0.06, 0.06); box(t, x, 0.9, z + 2.6, 7, 0.06, 0.06); box(t, x - 3.5, 0.9, z, 0.06, 0.06, 5.2); box(t, x + 3.5, 0.9, z, 0.06, 0.06, 5.2);
    // The arc between the inner insulators: a soft swell (raised cosine squared), never a flash.
    const swell = Math.pow(0.5 - 0.5 * Math.cos(age * TAU * ANIMATION_HZ.sparkSwell), 2);
    light(t, eye, x, 3.5, z, [180, 220, 255], level * (0.35 + 0.8 * swell), 1.2, 0.36, "*");
    // Embers: 24 drifting up 18 m at 1.2 m/s, blooming in at the bottom and dying out above.
    const wind = windAt(time);
    for (let i = 0; i < 24; i++) {
      const f = ((age * 1.2 / 18 + i / 24) % 1 + 1) % 1, y = 3.6 + f * 18;
      const ex = x + Math.sin(i * 2.3) * 0.8 + f * 3 * wind.x, ez = z + Math.cos(i * 1.7) * 0.8 + f * 3 * wind.z;
      const gain = level * smooth(f / 0.1) * Math.pow(1 - f, 1.4);
      if (gain < 0.03) continue;
      light(t, eye, ex, y, ez, EMBER, gain * 1.05, 1.0, 0.12, ".");
    }
  }
  // Utility vans on the street east of the plaza, half on the kerb.
  for (let v = 0; v < 2; v++) {
    const vx = event.x + 11.6, vz = event.z - 12 - v * 14; // the plaza's east street: road < 6.2 m from x = -448, kerb to 6.6 m
    if (view.visible && !view.visible(vx, 1.5, vz, 5)) continue;
    ink(t, UTILITY, "#", 0.5 + 0.5 * level); box(t, vx, 1.25, vz, 2.1, 1.9, 5.4);
    ink(t, [40, 60, 80], "=", 0.8 * level); box(t, vx, 1.7, vz - 2.66, 1.9, 0.6, 0.1);
    ink(t, [34, 38, 46], "o", 0.9); for (const sx of [-1, 1]) for (const sz of [-1.7, 1.7]) box(t, vx + sx * 0.95, 0.34, vz + sz, 0.28, 0.68, 0.68);
    const swell = 0.5 - 0.5 * Math.cos(event.age * TAU * ANIMATION_HZ.beaconSwell + v * 2.2);
    light(t, eye, vx, 2.35, vz - 1.2, AMBER, level * (0.5 + 0.6 * swell), 1.1, 0.36, "O");
    // Two cones behind each van.
    ink(t, [255, 120, 40], "^", level); box(t, vx - 0.6, 0.3, vz + 3.6, 0.3, 0.6, 0.3); box(t, vx + 0.6, 0.3, vz + 4.4, 0.3, 0.6, 0.3);
  }
}

// ---------------------------------------------------------------------------------------------
// Rent march at the Afterlight Arcade: a cluster of placards swaying on their poles and two
// floating letter panels ("RENT", "WATER") bobbing above them, facing the plaza's approach.

const LETTERS: Record<string, string> = {
  R: "110101110101101", E: "111100110100111", N: "110101101101101", T: "111010010010010",
  W: "101101111111101", A: "010101111101101",
};
const CARD: readonly RGB[] = [[230, 226, 210], [240, 200, 90], [220, 80, 70], [200, 210, 220]];
function protest(t: PropCanvas, eye: Eye, event: ActiveCityEvent, view: EventView): void {
  const x = event.x, z = event.z, level = event.level, age = event.age;
  if (view.visible && !view.visible(x, 3, z, 12)) return;
  // The panels face the approach from the southwest (towards the arcade's plaza corner).
  const nx = -Math.SQRT1_2, nz = -Math.SQRT1_2, yaw = Math.atan2(nx, nz);
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39996, r = 1.2 + 3.6 * ((i * 37) % 12) / 12;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, h = 2.3 + ((i * 5) % 4) * 0.15;
    const sway = 7 * wave(ANIMATION_HZ.placardSway, age, i * 1.7);
    t.push(); t.translate(px, 0, pz); t.rotateY(yaw * DEG + ((i % 3) - 1) * 14); t.rotateZ(sway);
    ink(t, [96, 80, 60], "|", 0.9); t.translate(0, -h * level / 2, 0); t.box(0.06, h * level, 0.06); t.translate(0, h * level / 2, 0);
    ink(t, CARD[i % CARD.length], i % 2 ? "=" : "#", 0.4 + 0.6 * level); t.translate(0, -(h * level + 0.3), 0); t.box(1.0, 0.68 * level + 0.02, 0.05);
    t.pop();
  }
  // Letter panels: each font pixel a small cube laid out along the viewer's right (rx, rz) for a
  // reader standing in front, with a dark backing slab behind so the words don't read mirrored.
  const rx = nz, rz = -nx;
  const words: readonly [string, number, number, RGB][] = [["RENT", 6.6, -1.4, [255, 96, 120]], ["WATER", 5.0, 2.6, [96, 230, 255]]];
  for (const [word, baseY, offset, color] of words) {
    const pixel = 0.36, width = word.length * 4 * pixel - pixel, height = 5 * pixel;
    const cy = baseY + 0.18 * wave(ANIMATION_HZ.panelBob, age, offset), cx = x + rx * offset, cz = z + rz * offset;
    if (Math.hypot(cx - eye.x, cz - eye.z) > 160) continue;
    ink(t, [26, 22, 34], "#", 0.9 * level + 0.05); slab(t, cx - nx * 0.22, cy, cz - nz * 0.22, yaw, width + 0.6, (height + 0.5) * level, 0.12);
    for (let c = 0; c < word.length; c++) {
      const bits = LETTERS[word[c]] ?? "";
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
        if (bits[row * 3 + col] !== "1") continue;
        const u = -width / 2 + (c * 4 + col) * pixel + pixel / 2, v = height / 2 - row * pixel - pixel / 2;
        ink(t, color, "#", level * 1.05); box(t, cx + rx * u, cy + v * level, cz + rz * u, pixel * 0.9, pixel * 0.9, pixel * 0.9);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Satellite re-entry: one slow streak across the sky over 12 s, high and far (drawn relative to
// the eye, like the moon), with a fading orange trail. It crosses ~60 degrees of sky in 12 s.

function satellite(t: PropCanvas, eye: Eye, event: ActiveCityEvent): void {
  const bearing = (event.seed / 4294967296) * TAU, duration = event.end - event.start, horizontal = 650;
  const at = (u: number): [number, number, number] => {
    const a = bearing + 1.05 * u, elevation = (32 - 18 * u) * Math.PI / 180;
    return [eye.x + Math.cos(a) * horizontal, horizontal * Math.tan(elevation), eye.z + Math.sin(a) * horizontal];
  };
  const u = event.age / duration, [hx, hy, hz] = at(u);
  light(t, eye, hx, hy, hz, [255, 226, 180], event.level * 1.1, 1.8, 2, "*");
  for (let k = 1; k <= 18; k++) {
    const back = u - k * 0.012;
    if (back < 0) break;
    const [sx, sy, sz] = at(back), fade = Math.pow(1 - k / 19, 1.6);
    light(t, eye, sx, sy, sz, mix([255, 190, 120], [255, 96, 60], k / 18), event.level * 0.85 * fade, 1.3 - k * 0.03, 1.2, k < 6 ? "*" : "+");
  }
}
