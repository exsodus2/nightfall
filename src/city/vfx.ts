import { randomFor } from "./world.ts";

// Pure VFX maths (no textmode, no DOM): wheel spin, brake state, camera projection and the
// deterministic particle fields behind rain, splashes, drips, sparks, searchlights and sky
// trails. Every particle is a function of (id, time) - adapted from the official examples'
// particle loops (textmode.js examples: Textmodifier/mouseReleased sparks, translateY2 rain,
// TextmodeTileset/characterMap cipher rain) but stateless, so the effects are identical in the
// reflected pass, in studio replays and after pauses, and never pop or flicker on respawn.

export const WHEEL_RADIUS = 0.4;
const DEG = 180 / Math.PI;
export const wrap = (n: number, length: number): number => ((n % length) + length) % length;
export const hash = (a: number, b: number, salt = 0): number => randomFor(Math.floor(a), Math.floor(b), salt);

// ---- Cars: rolling wheels and brake lights ------------------------------------------------
export interface CarMotion {
  /** Wheel angle in degrees, quantised to 7.5 degree steps (the glyph rotation steps). */
  spin: number;
  /** Share of the 72 degree spoke spacing swept per 1/48 s exposure: 0 = crisp spokes, 1 = full blur. */
  blur: number;
  /** 0..1, eased: lit brake lights when decelerating or queued. */
  brake: number;
  speed: number;
}
interface Tracked { x: number; z: number; roll: number; speed: number; brake: number; time: number; seen: number }
const tracked = new Map<number, Tracked>();
let frame = 0;

/** Advances a car's rolled distance from its movement since the last call, so any car (traffic,
 * parked, player) spins correctly without its simulation exposing an odometer. `speed` null =
 * estimate it from the movement. Brake lights: queued in traffic, or decelerating. Calls at the
 * same clock (the reflection pass, a frozen clock) leave the state unchanged. */
export function carMotion(id: number, x: number, z: number, yaw: number, speed: number | null, time: number, queued = false): CarMotion {
  let s = tracked.get(id);
  if (!s) { s = { x, z, roll: randomFor(id, 11) * 9, speed: speed ?? 0, brake: queued ? 1 : 0, time, seen: frame }; tracked.set(id, s); }
  const dt = time - s.time;
  if (dt > 0) {
    const along = (x - s.x) * Math.sin(yaw) - (z - s.z) * Math.cos(yaw);
    // A jump (teleport, wrap-around lane, first sighting after a long gap) does not spin the wheel.
    const jump = Math.abs(along) > 45 * dt + 1;
    if (!jump) s.roll += along;
    const current = speed ?? (jump ? s.speed : s.speed + (along / dt - s.speed) * (1 - Math.exp(-dt * 10)));
    const decel = (Math.abs(s.speed) - Math.abs(current)) / dt;
    const target = queued || (decel > 1.5 && Math.abs(current) > 0.2) ? 1 : 0;
    s.brake += (target - s.brake) * (1 - Math.exp(-dt * (target > s.brake ? 14 : 2.5)));
    s.x = x; s.z = z; s.speed = current; s.time = time;
  } else if (dt < 0) { s.x = x; s.z = z; s.time = time; }
  s.seen = frame;
  const angle = (s.roll / WHEEL_RADIUS) * DEG;
  return { spin: wrap(Math.round(angle / 7.5) * 7.5, 360), blur: Math.min(1, (Math.abs(s.speed) / WHEEL_RADIUS) * DEG / 48 / 72), brake: s.brake, speed: s.speed };
}
/** Call once per frame: forgets cars not seen for a while (bounded memory). */
export function endMotionFrame(): void {
  frame++;
  if (frame % 600 === 0) for (const [id, s] of tracked) if (frame - s.seen > 600) tracked.delete(id);
}

// ---- Camera projection (matches engine.ts: t.perspective(fov) + t.camera(eye, eye + forward)) --
export interface ViewCamera { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; aspect: number }
export interface Projected { sx: number; sy: number; depth: number }
/** World point (y up) to normalised device coordinates (x right, y up, both -1..1 on screen). */
export function project(cam: ViewCamera, px: number, py: number, pz: number): Projected | null {
  const dx = px - cam.x, dy = py - cam.y, dz = pz - cam.z;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  // forward = (sin yaw cos p, -sin p, -cos yaw cos p); right = (cos yaw, 0, sin yaw); up = right x forward.
  const fx = sy * cp, fy = -sp, fz = -cy * cp, rx = cy, rz = sy;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const depth = dx * fx + dy * fy + dz * fz;
  if (depth < 0.15) return null;
  const f = Math.tan(cam.fov * Math.PI / 360);
  return { sx: (dx * rx + dz * rz) / (depth * f * cam.aspect), sy: (dx * ux + dy * uy + dz * uz) / (depth * f), depth };
}
/** World size of one character cell at a given depth. */
export const cellWorld = (fov: number, rows: number, depth: number): number => 2 * depth * Math.tan(fov * Math.PI / 360) / Math.max(1, rows);

// ---- Rain: world-anchored drops around the eye --------------------------------------------
export interface RainDrop { x: number; y: number; z: number; seed: number }
export const RAIN_FALL = 7.5;      // m/s: calmer than real rain, still reads as rain
export const RAIN_WIND = { x: 0.9, z: 0.35 };
const RAIN_BAND = 16;              // vertical wrap band around the eye (m)
/** Drops in tiles of `tile` metres within `radius` of the eye. Positions depend only on the world
 * tile, the drop index and time: moving the camera never re-rolls a drop, it just reveals new tiles. */
export function rainDrops(eyeX: number, eyeY: number, eyeZ: number, time: number, radius: number, tile: number, perTile: number): RainDrop[] {
  const drops: RainDrop[] = [];
  const x0 = Math.floor((eyeX - radius) / tile), x1 = Math.floor((eyeX + radius) / tile);
  const z0 = Math.floor((eyeZ - radius) / tile), z1 = Math.floor((eyeZ + radius) / tile);
  const bottom = eyeY - RAIN_BAND * 0.35;
  for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) for (let k = 0; k < perTile; k++) {
    const salt = 700 + k * 13;
    const fall = RAIN_FALL * (0.85 + 0.3 * randomFor(tx, tz, salt + 3));
    const y = bottom + wrap(randomFor(tx, tz, salt + 2) * RAIN_BAND - time * fall - bottom, RAIN_BAND);
    if (y < 0.02) continue;
    // Wind drift follows the fall, so position and streak direction agree.
    const x = (tx + randomFor(tx, tz, salt)) * tile - y * RAIN_WIND.x / RAIN_FALL;
    const z = (tz + randomFor(tx, tz, salt + 1)) * tile - y * RAIN_WIND.z / RAIN_FALL;
    if ((x - eyeX) ** 2 + (z - eyeZ) ** 2 > radius * radius) continue;
    drops.push({ x, y, z, seed: randomFor(tx, tz, salt + 4) });
  }
  return drops;
}

/** Splash life cycle: 0..1 while visible, -1 otherwise. `rate` is splashes per second per site. */
export function splashPhase(seed: number, time: number, rate: number, duration = 0.32): number {
  const cycle = wrap(time * rate + seed * 17.13, 1);
  return cycle * (1 / rate) < duration ? (cycle / rate) / duration : -1;
}
/** ASCII splash: a drop hits, a tiny crown/ring opens, a dot settles. */
export const splashGlyph = (phase: number): string => phase < 0.25 ? "'" : phase < 0.62 ? "o" : ".";

/** A drip hanging from an edge, falling and splashing. Returns the drop height above the ground
 * edge (m, 0 = at the edge) and a stage, deterministic in time. */
export interface Drip { stage: "bead" | "fall" | "splash" | "none"; drop: number; phase: number }
export function dripState(seed: number, time: number, edgeHeight: number): Drip {
  const period = 1.8 + seed * 2.6, fallTime = Math.sqrt(2 * edgeHeight / 9.8);
  const age = wrap(time + seed * 31.7, period);
  const bead = period - fallTime - 0.35;
  if (age < bead) return age > bead * 0.45 ? { stage: "bead", drop: 0, phase: (age - bead * 0.45) / (bead * 0.55) } : { stage: "none", drop: 0, phase: 0 };
  if (age < bead + fallTime) { const a = age - bead; return { stage: "fall", drop: 4.9 * a * a, phase: a / fallTime }; }
  return { stage: "splash", drop: edgeHeight, phase: (age - bead - fallTime) / 0.35 };
}

// ---- Sparks from shorting signs ----------------------------------------------------------
export interface Spark { x: number; y: number; z: number; life: number; age: number }
/** Signs in buzz mode (mode 0 in the material) short out every few seconds: a burst of sparks
 * from a point on the bottom edge, falling ballistically with a bounce. `normal` points out of
 * the sign face (unit, horizontal); `along` runs along its bottom edge. */
export function sparkBurst(seed: number, time: number, x: number, y: number, z: number, nx: number, nz: number, halfWidth: number): Spark[] {
  const period = 5 + seed * 7, index = Math.floor((time + seed * 40) / period), age0 = wrap(time + seed * 40, period);
  if (age0 > 1.6 || randomFor(index, Math.floor(seed * 1e6), 5) < 0.35) return [];
  const sparks: Spark[] = [];
  const ax = -nz, az = nx, origin = (randomFor(index, Math.floor(seed * 1e6), 6) - 0.5) * 1.6 * halfWidth;
  const count = 9 + Math.floor(randomFor(index, 3, 7) * 6);
  for (let i = 0; i < count; i++) {
    const r = (s: number) => randomFor(index * 31 + i, Math.floor(seed * 1e5), s);
    const delay = r(1) * 0.35, age = age0 - delay, life = 0.45 + r(2) * 0.7;
    if (age < 0 || age > life) continue;
    const out = 0.6 + r(3) * 1.8, side = (r(4) - 0.5) * 2.4, up = 0.4 + r(5) * 2.2;
    let py = y + up * age - 4.9 * age * age;
    const bounce = py < 0.05;
    if (bounce) py = 0.05 + Math.abs(py) * 0.08;
    sparks.push({ x: x + ax * origin + (nx * out + ax * side) * age * (bounce ? 0.6 : 1), y: py, z: z + az * origin + (nz * out + az * side) * age * (bounce ? 0.6 : 1), life: 1 - age / life, age });
  }
  return sparks;
}
/** Glyph for a cooling spark (hot white star -> plus -> tick -> dot), as in the spark-burst example. */
export const sparkGlyph = (life: number): string => life > 0.72 ? "*" : life > 0.45 ? "+" : life > 0.22 ? "'" : ".";
/** Same test as the city material: signs whose seed selects mode 0 buzz and flicker. */
export const signSeed = (x: number, y: number, z: number): number => Math.abs(Math.sin(x * 12.9898 + z * 78.233 + y) * 43758.5453) % 1;
export const signBuzzes = (seed: number): boolean => Math.floor(seed * 97) % 4 === 0;

// ---- Searchlights --------------------------------------------------------------------------
export interface Beam { x: number; y: number; z: number; dx: number; dy: number; dz: number }
/** A slow sweeping searchlight: tilted 14-30 degrees off vertical, turning ~ one lap per 40-70 s. */
export function searchlight(seed: number, time: number, x: number, y: number, z: number): Beam {
  const heading = seed * Math.PI * 2 + time * (0.09 + seed * 0.06) * (seed > 0.5 ? 1 : -1);
  const tilt = 0.24 + 0.28 * (0.5 + 0.5 * Math.sin(time * 0.13 + seed * 9));
  return { x, y, z, dx: Math.sin(heading) * Math.sin(tilt), dy: Math.cos(tilt), dz: Math.cos(heading) * Math.sin(tilt) };
}
