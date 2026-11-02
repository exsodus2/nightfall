import { citizenPavement } from "./citizen-ai.ts";
import type { CityWorld } from "./world.ts";

/**
 * Shopfront doors residents walk in and out of (signage.ts draws one at the middle of each of a
 * building's two street faces). Pure geometry, built per block on first use and cached per world.
 *
 * A door is usable when the lane from the residents' walking line (people.ts pavementPoint: 7.2 m
 * from the street's centre line, 14 m on the avenue) straight in to the face is open pavement, it
 * is clear of the corners, and the building is not a stall (id % 3 === 0: a counter and its queue
 * stand in front of the door).
 */
export interface ShopDoor {
  /** Standing spot in the doorway, just off the face (inside the building's collision skin). */
  x: number; z: number;
  /** Unit normal out of the face, toward the street. */
  nx: number; nz: number;
  /** Where the lane meets the walking line. */
  ax: number; az: number;
  /** Block face (0 north, 1 east, 2 south, 3 west): the walkers' corner `c` to `c + 1`. */
  face: number;
  building: number;
}
export interface Doorway { x: number; z: number; nx: number; nz: number; opened: number; hold: number }

/** How far out of the face a resident stands in the doorway (the face itself is the wall). */
export const DOORWAY_OUT = 0.3;
/** The lane's last stretch is inside the collision skin, so it is checked to this far from the face. */
const LANE_STOP = 0.85;
const CORNER_CLEAR = 3.2;

const caches = new WeakMap<object, Map<number, readonly ShopDoor[]>>();

/** The walking line of one face, as the coordinate on its fixed axis (x for east/west faces). */
function walkingLine(bx: number, bz: number, face: number): number {
  if (face === 0) return bz * 64 + 7.2;
  if (face === 2) return bz * 64 + 56.8;
  const x = bx * 64 + (face === 3 ? 7.2 : 56.8);
  return Math.abs(x) < 8 ? Math.sign(x) * 14 : x;
}

export function blockDoors(world: Pick<CityWorld, "blocks" | "canOccupy">, bx: number, bz: number): readonly ShopDoor[] {
  let cache = caches.get(world);
  if (!cache) { cache = new Map(); caches.set(world, cache); }
  const key = (bx + 64) * 256 + (bz + 64);
  const cached = cache.get(key);
  if (cached) return cached;
  const doors: ShopDoor[] = [];
  const block = world.blocks.get(`${bx},${bz}`);
  for (const building of block?.buildings ?? []) {
    if (building.id % 3 === 0) continue;
    const wrap = (value: number) => ((value % 64) + 64) % 64;
    const sx = wrap(building.x) < 32 ? -1 : 1, sz = wrap(building.z) < 32 ? -1 : 1;
    for (const side of [0, 1] as const) {
      const nx = side ? sx : 0, nz = side ? 0 : sz;
      const faceX = side ? building.x + sx * building.width / 2 : building.x, faceZ = side ? building.z : building.z + sz * building.depth / 2;
      const face = side ? (sx > 0 ? 1 : 3) : (sz > 0 ? 2 : 0);
      const line = walkingLine(bx, bz, face);
      const ax = side ? line : faceX, az = side ? faceZ : line;
      // Clear of the corners (and their crossings) along the face.
      const along = side ? az - bz * 64 : ax - bx * 64;
      const lo = side ? 7.2 : walkingLine(bx, bz, 3) - bx * 64, hi = side ? 56.8 : walkingLine(bx, bz, 1) - bx * 64;
      if (along < lo + CORNER_CLEAR || along > hi - CORNER_CLEAR) continue;
      const depth = (faceX - ax) * nx * -1 + (faceZ - az) * nz * -1; // walking line to face, metres
      if (depth < LANE_STOP + 0.6) continue;
      let open = true;
      for (let d = 0; d <= depth - LANE_STOP && open; d += 0.3) {
        const x = ax - nx * d, z = az - nz * d;
        if (!citizenPavement(world, x, z)) open = false;
        // The lane is a body wide: check half a shoulder either side.
        else if (!world.canOccupy(x + nz * 0.35, z + nx * 0.35) || !world.canOccupy(x - nz * 0.35, z - nx * 0.35)) open = false;
      }
      if (!open) continue;
      doors.push({ x: faceX + nx * DOORWAY_OUT, z: faceZ + nz * DOORWAY_OUT, nx, nz, ax, az, face, building: building.id });
    }
  }
  cache.set(key, doors);
  return doors;
}

/** The doors on one face of block (bx, bz). */
export function faceDoors(world: Pick<CityWorld, "blocks" | "canOccupy">, bx: number, bz: number, face: number): ShopDoor[] {
  return blockDoors(world, bx, bz).filter(door => door.face === face);
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** How open a door is at `time` (0..1): eased open over 0.5 s, held, eased shut over 0.7 s. */
export function doorGlow(door: Pick<Doorway, "opened" | "hold">, time: number): number {
  const t = time - door.opened;
  return smooth(0, 0.5, t) * (1 - smooth(door.hold, door.hold + 0.7, t));
}
/** True while the door's light is still on the pavement. */
export function doorLit(door: Pick<Doorway, "opened" | "hold"> | undefined, time: number): boolean {
  return door !== undefined && time - door.opened < door.hold + 0.7;
}
