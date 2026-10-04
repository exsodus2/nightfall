// Where content happens: the recommended level of each district (the city's difficulty curve) and
// the few shared locations several packs use. Every coordinate a pack places is tested for
// walkability (tests/rpg-content.test.ts), so moving something here is safe to try.

import type { Area } from "../types.ts";

/** Recommended player level per district id (world.ts DISTRICTS): safe around the spawn in the
 * Silk Market, harder the further out you walk. Roaming encounters are chosen to match. */
export const DISTRICT_LEVEL: Readonly<Record<number, readonly [number, number]>> = {
  4: [1, 3], // Silk Market (spawn)
  5: [3, 6], // The Spillway
  1: [3, 7], // Neon Ward
  3: [4, 8], // Rain Gardens
  0: [5, 9], // The Foundry
  2: [7, 12], // Ghost Circuit
};

/** The Rootwood Park boss arena, around The Last Tree (-480, 288).
 * SWAP POINT: a teammate is adding Rootwood Park to src/city/world.ts (x -576..-384, z 192..384)
 * with an exported PARK_ARENA. When it lands, replace this literal with
 * `export { PARK_ARENA as ARENA } from "../../city/world.ts";` - every boss / add / interactable
 * position below is derived from ARENA, and the content test re-checks them all. */
export const ARENA: Area = { x: -480, z: 288, radius: 26, label: "Rootwood Park - the Last Tree" };

/** A point at `distance` metres from the arena centre towards `bearing` (radians, 0 = north). */
export function arenaPoint(bearing: number, distance: number): { x: number; z: number } {
  return { x: Math.round((ARENA.x + Math.sin(bearing) * distance) * 10) / 10, z: Math.round((ARENA.z - Math.cos(bearing) * distance) * 10) / 10 };
}
