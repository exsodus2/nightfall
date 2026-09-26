// World ray casts for hitscan weapons and line-of-sight. Buildings are axis-aligned boxes standing
// on the ground; a coarse uniform grid (built once per CityWorld) means a ray only tests the few
// boxes in the cells it crosses instead of all ~2,200 buildings. Coordinates: x east, z south,
// y = height above the ground (up positive) - the same convention as city/visibility.ts.

import { LANDMARKS, RAIL_SOFFIT, RAIL_SOLIDS, type CityWorld } from "../../city/world.ts";
import type { Vec3 } from "./util.ts";

interface Solid { minX: number; maxX: number; minZ: number; maxZ: number; height: number; building: number | null; stamp: number }
interface Grid { cells: Map<number, Solid[]>; buildings: number; stamp: number }

const CELL = 16;
const OFFSET = 1024;
const cellKey = (cx: number, cz: number): number => (cx + OFFSET) * 4096 + (cz + OFFSET);
const grids = new WeakMap<CityWorld, Grid>();

function buildGrid(world: CityWorld): Grid {
  const cells = new Map<number, Solid[]>();
  const add = (solid: Solid) => {
    for (let cz = Math.floor(solid.minZ / CELL); cz <= Math.floor(solid.maxZ / CELL); cz++) {
      for (let cx = Math.floor(solid.minX / CELL); cx <= Math.floor(solid.maxX / CELL); cx++) {
        const key = cellKey(cx, cz), list = cells.get(key);
        if (list) list.push(solid); else cells.set(key, [solid]);
      }
    }
  };
  for (const b of world.buildings) add({ minX: b.x - b.width / 2, maxX: b.x + b.width / 2, minZ: b.z - b.depth / 2, maxZ: b.z + b.depth / 2, height: b.height, building: b.id, stamp: 0 });
  // Street-level solids that also block movement (CityWorld.canOccupy): viaduct legs, station
  // columns and the landmark cores. Their exact visual heights vary; these are conservative.
  for (const leg of RAIL_SOLIDS) add({ minX: leg.x - leg.half, maxX: leg.x + leg.half, minZ: leg.z - leg.half, maxZ: leg.z + leg.half, height: RAIL_SOFFIT, building: null, stamp: 0 });
  for (const landmark of LANDMARKS) {
    if (landmark.kind === "gate") continue;
    const r = landmark.kind === "garden" ? 4 : landmark.kind === "spire" ? 14 : 12;
    add({ minX: landmark.x - r, maxX: landmark.x + r, minZ: landmark.z - r, maxZ: landmark.z + r, height: 30, building: null, stamp: 0 });
  }
  return { cells, buildings: world.buildings.length, stamp: 0 };
}

function gridFor(world: CityWorld): Grid {
  let grid = grids.get(world);
  // Rebuild if content added buildings after the first cast (the world is otherwise immutable).
  if (!grid || grid.buildings !== world.buildings.length) { grid = buildGrid(world); grids.set(world, grid); }
  return grid;
}

export interface RayHit { distance: number; normal: Vec3; building: number | null }

/** Slab test of a ray against one box; returns entry distance and the entry face's axis. */
function slab(o: Vec3, d: Vec3, s: Solid, maxDistance: number): { t: number; axis: number; sign: number } | null {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const origin = a === 0 ? o.x : a === 1 ? o.y : o.z;
    const dir = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const min = a === 0 ? s.minX : a === 1 ? 0 : s.minZ;
    const max = a === 0 ? s.maxX : a === 1 ? s.height : s.maxZ;
    if (Math.abs(dir) < 1e-12) { if (origin < min || origin > max) return null; continue; }
    const t1 = (min - origin) / dir, t2 = (max - origin) / dir;
    const near = Math.min(t1, t2), far = Math.max(t1, t2);
    if (near > tmin) { tmin = near; axis = a; sign = dir > 0 ? -1 : 1; }
    if (far < tmax) tmax = far;
    if (tmin > tmax) return null;
  }
  if (tmax < 0 || tmin > maxDistance) return null;
  return tmin < 0 ? { t: 0, axis: -1, sign: 0 } : { t: tmin, axis, sign };
}

/** Casts a ray (dir need not be normalised) against building boxes, street solids and the ground
 * plane y = 0. Returns the nearest hit within maxDistance, or null. `building` is the hit
 * building's id (null for the ground or a non-building solid). */
export function raycastWorld(world: CityWorld, origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null {
  const length = Math.hypot(dir.x, dir.y, dir.z);
  if (!(length > 1e-12) || !(maxDistance > 0)) return null;
  const d = { x: dir.x / length, y: dir.y / length, z: dir.z / length };
  let best = Infinity, bestNormal: Vec3 = { x: 0, y: 1, z: 0 }, bestBuilding: number | null = null;
  // Ground plane.
  if (origin.y <= 0 && d.y < 0) return { distance: 0, normal: { x: 0, y: 1, z: 0 }, building: null };
  if (d.y < 0) { const t = origin.y / -d.y; if (t <= maxDistance) best = t; }
  const limit = Math.min(maxDistance, best);
  const grid = gridFor(world), stamp = ++grid.stamp;
  // 2D DDA over the grid cells under the ray's xz projection.
  let cx = Math.floor(origin.x / CELL), cz = Math.floor(origin.z / CELL);
  const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(d.x) > 1e-12 ? CELL / Math.abs(d.x) : Infinity;
  const tDeltaZ = Math.abs(d.z) > 1e-12 ? CELL / Math.abs(d.z) : Infinity;
  let tMaxX = Math.abs(d.x) > 1e-12 ? ((cx + (stepX > 0 ? 1 : 0)) * CELL - origin.x) / d.x : Infinity;
  let tMaxZ = Math.abs(d.z) > 1e-12 ? ((cz + (stepZ > 0 ? 1 : 0)) * CELL - origin.z) / d.z : Infinity;
  let t = 0;
  for (let guard = 0; guard < 4096 && t <= limit; guard++) {
    const list = grid.cells.get(cellKey(cx, cz));
    if (list) for (const solid of list) {
      if (solid.stamp === stamp) continue;
      solid.stamp = stamp;
      // Rays passing over a roof never hit it: cheap reject before the full slab test.
      if (origin.y > solid.height && d.y >= 0) continue;
      const hit = slab(origin, d, solid, Math.min(best, maxDistance));
      if (hit && hit.t < best) {
        best = hit.t; bestBuilding = solid.building;
        bestNormal = hit.axis === 0 ? { x: hit.sign, y: 0, z: 0 } : hit.axis === 1 ? { x: 0, y: hit.sign, z: 0 } : hit.axis === 2 ? { x: 0, y: 0, z: hit.sign } : { x: -d.x, y: -d.y, z: -d.z };
      }
    }
    const next = Math.min(tMaxX, tMaxZ);
    if (best <= next) break;
    if (tMaxX < tMaxZ) { cx += stepX; t = tMaxX; tMaxX += tDeltaX; } else { cz += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; }
    if (Math.abs(cx) > 64 || Math.abs(cz) > 64) break;
  }
  return best <= maxDistance ? { distance: best, normal: bestNormal, building: bestBuilding } : null;
}

/** True when nothing solid (buildings, street solids, ground) lies between a and b. */
export function hasLineOfSight(world: CityWorld, a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length = Math.hypot(dx, dy, dz);
  if (length < 0.05) return true;
  return raycastWorld(world, a, { x: dx, y: dy, z: dz }, length - 0.05) === null;
}

/** True when a body can walk the straight segment a -> b (CityWorld.canOccupy every ~0.75 m). */
export function walkable(world: CityWorld, ax: number, az: number, bx: number, bz: number): boolean {
  const length = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(length / 0.75));
  for (let i = 1; i <= steps; i++) if (!world.canOccupy(ax + (bx - ax) * i / steps, az + (bz - az) * i / steps)) return false;
  return true;
}
