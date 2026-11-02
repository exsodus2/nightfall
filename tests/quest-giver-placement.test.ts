// Where quest givers and quest objects stand. The owner's rule: nobody hands out work from the
// middle of the road. Every standing NPC (src/city/npcs.ts and every registered content pack) and
// every outdoor interactable must be on clear ground, off the carriageway, outside buildings, and
// (for people) clear of shopfront door lanes, corner crossings and each other.
//
// Geometry used (see src/city/driving.ts roadDistance, people.ts / street-doors.ts):
//  - the carriageway is < 6.2 m from a street centre line (the avenue, |x| < 12.4, counts double),
//    pavements lie 7.2-11.5 m out; we ask for roadDistance >= 7.0;
//  - Rootwood Park, the station plazas (within 20 m of a STATION_SITES platform) and the doorsteps of
//    interiors (within 4 m of an entrance) have no road to keep off, so the road rule skips them;
//  - pedestrians cross where the 7.2 m walking lines meet at each corner (14 m out on the avenue):
//    a giver standing within ~2.3 m of that landing blocks the crossing;
//  - a shopfront door lane runs from the walking line straight in to the door (street-doors.ts).

import assert from "node:assert/strict";
import test from "node:test";
import { roadDistance } from "../src/city/driving.ts";
import { interiorPlaces } from "../src/city/interiors.ts";
import { NPCS } from "../src/city/npcs.ts";
import { inPark } from "../src/city/park.ts";
import { blockDoors } from "../src/city/street-doors.ts";
import { BLOCK_SIZE, CityWorld, STATION_SITES } from "../src/city/world.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";

const world = new CityWorld();
const entrances = interiorPlaces(world).map(place => place.entrance);

/** Off the carriageway: roadDistance at least this far from a centre line. */
const MIN_ROAD_DISTANCE = 7.0;
/** Two people closer than this read as one crowd and fight over the talk prompt. */
const MIN_GIVER_SPACING = 3;
/** Within this of a corner's walking-line junction, a person stands on the crossing landing. */
const CROSSING_CLEAR = 9.5;
/** A person this close to a door lane stands in the doorway traffic. */
const DOOR_LANE_CLEAR = 1.0;

interface Spot { what: string; x: number; z: number; person: boolean }

function spots(): Spot[] {
  const out: Spot[] = NPCS.map(npc => ({ what: `npcs.ts ${npc.id}`, x: npc.x, z: npc.z, person: true }));
  const givers = new Set(CONTENT_PACKS.flatMap(pack => (pack.quests ?? []).map(quest => quest.giver)).filter((id): id is string => !!id));
  for (const pack of CONTENT_PACKS) {
    for (const npc of pack.npcs ?? []) out.push({ what: `${pack.id} npc ${npc.id}${givers.has(npc.id) ? " (giver)" : ""}`, x: npc.x, z: npc.z, person: true });
    // Indoor terminals (`place`) live in interior space; their world x/z sit inside the building.
    for (const it of pack.interactables ?? []) if (!it.place) out.push({ what: `${pack.id} object ${it.id}`, x: it.x, z: it.z, person: false });
  }
  return out;
}

const lineDistance = (v: number): number => { const m = ((v % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE; return Math.min(m, BLOCK_SIZE - m); };
const roadExempt = (x: number, z: number): boolean =>
  inPark(x, z)
  || STATION_SITES.some(site => Math.hypot(site.x - x, site.z - z) < 20)
  || entrances.some(door => Math.hypot(door.x - x, door.z - z) < 4);

function insideBuilding(x: number, z: number): boolean {
  return world.nearbyBlocks(x, z, 1).some(block => block.buildings.some(b => Math.abs(x - b.x) < b.width / 2 && Math.abs(z - b.z) < b.depth / 2));
}

/** On a corner's crossing landing: near where the walking lines meet (the avenue's are 14 m out). */
function onCrossing(x: number, z: number): boolean {
  if (inPark(x, z)) return false;
  const across = Math.abs(x) < 32 ? Math.abs(x) - 6.8 : lineDistance(x);
  return across < CROSSING_CLEAR && lineDistance(z) < CROSSING_CLEAR;
}

function doorLane(x: number, z: number): number | null {
  const bx = Math.floor(x / BLOCK_SIZE), bz = Math.floor(z / BLOCK_SIZE);
  for (let ix = bx - 1; ix <= bx + 1; ix++) for (let iz = bz - 1; iz <= bz + 1; iz++) {
    for (const door of blockDoors(world, ix, iz)) {
      const dx = door.x - door.ax, dz = door.z - door.az, length = dx * dx + dz * dz;
      const t = length ? Math.max(0, Math.min(1, ((x - door.ax) * dx + (z - door.az) * dz) / length)) : 0;
      if (Math.hypot(x - door.ax - dx * t, z - door.az - dz * t) < DOOR_LANE_CLEAR) return door.building;
    }
  }
  return null;
}

const where = (spot: Spot): string => `${spot.what} at ${spot.x},${spot.z}`;

test("every NPC and outdoor quest object stands on clear ground, outside any building", () => {
  const list = spots();
  assert.ok(list.length > 30, "found the NPCs and objects");
  const problems = list.flatMap(spot => [
    ...(world.canOccupy(spot.x, spot.z) ? [] : [`${where(spot)} is not walkable`]),
    ...(insideBuilding(spot.x, spot.z) ? [`${where(spot)} is inside a building footprint`] : []),
  ]);
  assert.deepEqual(problems, []);
});

test("nobody gives out work from the road: NPCs and objects keep to the pavement", () => {
  const problems = spots()
    .filter(spot => !roadExempt(spot.x, spot.z) && roadDistance(spot.x, spot.z) < MIN_ROAD_DISTANCE)
    .map(spot => `${where(spot)} is ${roadDistance(spot.x, spot.z).toFixed(1)} m from the centre line (needs ${MIN_ROAD_DISTANCE})`);
  assert.deepEqual(problems, []);
});

test("people keep off corner crossings and shopfront door lanes", () => {
  const problems: string[] = [];
  for (const spot of spots().filter(s => s.person)) {
    if (onCrossing(spot.x, spot.z)) problems.push(`${where(spot)} stands on a corner crossing landing`);
    const lane = doorLane(spot.x, spot.z);
    if (lane !== null) problems.push(`${where(spot)} stands in the door lane of building ${lane}`);
  }
  assert.deepEqual(problems, []);
});

test("no two NPCs stand within 3 m of each other", () => {
  const people = spots().filter(s => s.person);
  const problems: string[] = [];
  people.forEach((a, i) => people.slice(i + 1).forEach(b => {
    const gap = Math.hypot(a.x - b.x, a.z - b.z);
    if (gap < MIN_GIVER_SPACING) problems.push(`${a.what} and ${b.what} are ${gap.toFixed(1)} m apart`);
  }));
  assert.deepEqual(problems, []);
});
