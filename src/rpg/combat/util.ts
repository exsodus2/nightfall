// Small shared helpers for the combat simulation. Pure functions, no state.

/** The fixed simulation step: every hit window, telegraph and cooldown is measured in these. */
export const TICK = 1 / 60;
/** Most catch-up ticks run in one frame (0.25 s); a longer stall is dropped, not replayed. */
export const MAX_TICKS_PER_FRAME = 15;

export interface Vec3 { x: number; y: number; z: number }

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** World yaw that faces along (dx, dz): forward = (sin yaw, -cos yaw), 0 faces -z. */
export const yawTo = (dx: number, dz: number): number => Math.atan2(dx, -dz);

/** Signed shortest difference a - b, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turns `from` toward `to` by at most `step` radians. */
export function turnToward(from: number, to: number, step: number): number {
  const d = angleDiff(to, from);
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step;
}

/** Deterministic 32-bit PRNG (mulberry32) for the default injected RNG. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unit view direction from yaw and pitch (positive pitch looks down, as in the engine). */
export function viewDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: -Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** Distance along a ray (unit dir) to a vertical cylinder standing on the ground, or null. */
export function rayCylinder(o: Vec3, d: Vec3, cx: number, cz: number, radius: number, height: number, maxDistance: number): number | null {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  const inside = ox * ox + oz * oz <= radius * radius;
  if (inside) return o.y >= 0 && o.y <= height ? 0 : null;
  if (a < 1e-12) return null;
  const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > maxDistance) return null;
  const y = o.y + d.y * t;
  return y >= 0 && y <= height ? t : null;
}

/** Rotates unit vector `d` toward unit vector `target` by at most `maxAngle` radians. */
export function rotateToward(d: Vec3, target: Vec3, maxAngle: number): Vec3 {
  const dot = clamp(d.x * target.x + d.y * target.y + d.z * target.z, -1, 1);
  const angle = Math.acos(dot);
  if (angle < 1e-6) return { ...d };
  const f = Math.min(1, maxAngle / angle);
  // Slerp by fraction f.
  const s = Math.sin(angle), a = Math.sin((1 - f) * angle) / s, b = Math.sin(f * angle) / s;
  const r = { x: d.x * a + target.x * b, y: d.y * a + target.y * b, z: d.z * a + target.z * b };
  const len = Math.hypot(r.x, r.y, r.z) || 1;
  return { x: r.x / len, y: r.y / len, z: r.z / len };
}

/** `d` jittered uniformly inside a cone of half-angle `spread` (two RNG draws). */
export function jitter(d: Vec3, spread: number, rng: () => number): Vec3 {
  if (spread <= 0) return { ...d };
  const r = spread * Math.sqrt(rng()), theta = rng() * Math.PI * 2;
  // Orthonormal basis around d.
  const up = Math.abs(d.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let ux = up.y * d.z - up.z * d.y, uy = up.z * d.x - up.x * d.z, uz = up.x * d.y - up.y * d.x;
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const vx = d.y * uz - d.z * uy, vy = d.z * ux - d.x * uz, vz = d.x * uy - d.y * ux;
  const a = Math.tan(r) * Math.cos(theta), b = Math.tan(r) * Math.sin(theta);
  const x = d.x + ux * a + vx * b, y = d.y + uy * a + vy * b, z = d.z + uz * a + vz * b;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

export function pick<T>(list: readonly T[] | undefined, rng: () => number): T | null {
  return list && list.length ? list[Math.floor(rng() * list.length) % list.length] : null;
}
