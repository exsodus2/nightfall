import type { Building } from "./world.ts";
export interface SightPoint { x: number; y: number; z: number }
/** Conservative segment/AABB visibility for small street-level props. The
 * skyline is never culled with this test: rooftops remain visible above walls. */
export function visibleFrom(eye: SightPoint, target: SightPoint, occluders: readonly Building[]): boolean {
  const ex = eye.x, ey = eye.y, ez = eye.z, tx = target.x, ty = target.y, tz = target.z, dx = tx - ex, dy = ty - ey, dz = tz - ez;
  // Perf: the segment's bounding box. An occluder wholly outside it cannot be hit (see the note
  // above segmentHits), so it is skipped before the slab test's divisions.
  const loX = ex < tx ? ex : tx, hiX = ex < tx ? tx : ex, loZ = ez < tz ? ez : tz, hiZ = ez < tz ? tz : ez, loY = ey < ty ? ey : ty, hiY = ey < ty ? ty : ey;
  for (let i = 0; i < occluders.length; i++) {
    const b = occluders[i], minX = b.x - b.width / 2, maxX = b.x + b.width / 2;
    if (minX > hiX || maxX < loX) continue;
    const minZ = b.z - b.depth / 2, maxZ = b.z + b.depth / 2;
    if (minZ > hiZ || maxZ < loZ || b.height < loY || hiY < 0) continue;
    if (segmentHits(ex, ey, ez, dx, dy, dz, minX, maxX, b.height, minZ, maxZ)) return false;
  }
  return true;
}

/**
 * Perf: an exact early-out for segmentHits. When a box lies wholly beyond the segment's bounding box
 * on one axis (strictly), the slab test on that axis gives an interval outside [0, 1] - both of its
 * ends have the sign of (bound - eye), or are >= (target - eye) / d = 1, because IEEE subtraction and
 * division by the same d are monotonic - so it already returns false (or, for |d| < 1e-5, the eye is
 * outside the slab). Skipping such boxes therefore changes no result; it only skips the divisions.
 * Callers must pass d = target - eye computed exactly that way.
 *
 * The slab test of one segment (eye + t * d, t in [0.001, 0.995]) against a box standing on the
 * ground (y 0..height), unrolled per axis. Same arithmetic, in the same order, as the generic
 * per-axis loop it replaces, so every result is bit-for-bit unchanged; it just allocates nothing.
 */
function segmentHits(ex: number, ey: number, ez: number, dx: number, dy: number, dz: number, minX: number, maxX: number, maxY: number, minZ: number, maxZ: number): boolean {
  let near = 0.001, far = 0.995;
  if (Math.abs(dx) < 0.00001) { if (ex < minX || ex > maxX) return false; }
  else { const a = (minX - ex) / dx, c = (maxX - ex) / dx; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); if (near > far) return false; }
  if (Math.abs(dy) < 0.00001) { if (ey < 0 || ey > maxY) return false; }
  else { const a = (0 - ey) / dy, c = (maxY - ey) / dy; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); if (near > far) return false; }
  if (Math.abs(dz) < 0.00001) { if (ez < minZ || ez > maxZ) return false; }
  else { const a = (minZ - ez) / dz, c = (maxZ - ez) / dz; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); }
  return near <= far;
}

/** True when nothing of the solid core `s` lies on the segment from (sx, sy, sz) to (x, y, z). */
function sees(s: SolidCore, sx: number, sy: number, sz: number, x: number, y: number, z: number): boolean {
  // Perf: the exact early-out above (the box is beyond the segment's bounding box on one axis).
  if (s.minX > (sx > x ? sx : x) || s.maxX < (sx < x ? sx : x) || s.minZ > (sz > z ? sz : z) || s.maxZ < (sz < z ? sz : z) || s.height < (sy < y ? sy : y) || (sy > y ? sy : y) < 0) return true;
  return !segmentHits(sx, sy, sz, x - sx, y - sy, z - sz, s.minX, s.maxX, s.height, s.minZ, s.maxZ);
}

/** The solid core fullyHidden trusts for an occluder (setbacks and glass shells excluded), as box
 *  bounds. It depends only on the building's fixed shape, so it is computed once per building. */
interface SolidCore { minX: number; maxX: number; minZ: number; maxZ: number; height: number }
const solidCores = new WeakMap<Building, SolidCore>();
function solidCore(other: Building): SolidCore {
  let core = solidCores.get(other);
  if (!core) {
    const scale = other.style === 4 ? 0.55 : other.style === 7 ? 0.64 : 0.89;
    // Same expressions as the old `{ ...other, x, width, depth }` copy fed to visibleFrom.
    const x = other.x - (other.style === 4 ? other.width * 0.2 : 0), width = other.width * scale, depth = other.depth * scale;
    core = { minX: x - width / 2, maxX: x + width / 2, minZ: other.z - depth / 2, maxZ: other.z + depth / 2, height: other.height };
    solidCores.set(other, core);
  }
  return core;
}

/** Cull only when a single solid occluder covers the entire expanded building
 * box in BOTH real and reflected views. This removes zero visible geometry. */
export function fullyHidden(eye: SightPoint, target: Building, occluders: readonly Building[]): boolean {
  // Perf: no per-call allocation (this runs for every building beyond 100 m, every frame). The eight
  // corners are tested in the original x, z, y order with the real then the reflected eye.
  const ex = eye.x, ey = eye.y, ez = eye.z, my = -eye.y;
  const x0 = target.x - target.width / 2 - 3, x1 = target.x + target.width / 2 + 3;
  const z0 = target.z - target.depth / 2 - 3, z1 = target.z + target.depth / 2 + 3;
  const y0 = 0.1, y1 = target.height + 24;
  for (const other of occluders) {
    if (other.id === target.id) continue;
    const s = solidCore(other);
    if (sees(s, ex, ey, ez, target.x, target.height / 2, target.z)) continue;
    let covered = true;
    for (let i = 0; i < 8 && covered; i++) {
      const x = i < 4 ? x0 : x1, z = (i & 2) === 0 ? z0 : z1, y = (i & 1) === 0 ? y0 : y1;
      if (sees(s, ex, ey, ez, x, y, z) || sees(s, ex, my, ez, x, y, z)) covered = false;
    }
    if (covered) return true;
  }
  return false;
}
