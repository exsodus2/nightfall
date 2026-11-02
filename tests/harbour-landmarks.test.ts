import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CityWorld, LANDMARKS, PLAYER_RADIUS, RAIL_SOLIDS, RIM_DECK_HEIGHT, SIGHTS, WORLD_EDGE } from "../src/city/world.ts";
import { HARBOUR_COPING, HARBOUR_KERB, HARBOUR_LEVEL, HARBOUR_WALL, harbourZone } from "../src/city/harbour.ts";
import {
  BARRIER, BARRIER_BAYS, BARRIER_PIERS, CABIN_COUNT, CABIN_SPACING, CABLE_LENGTH, CABLE_SPEED, CABLE_TOWERS, CABLEWAY, CHUTE_SCROLL, CRANE,
  FLOOD_WALL, FLOOD_WALL_OUTER, GANGWAY_X, LAMP_BREATH_HZ, MAST_ARM, MAST_LAMP_Y, PYLON_ALONG, PYLON_LINE, QUAY_CRANES, QUAY_KERB, QUAY_POOLS, RADAR_DEG_PER_S, SHIP, SIGHT_SOLIDS,
  TROLLEY_PERIOD, WALL_MAST_ALONG, WALL_MAST_STEP, WATER_POOLS, WATER_Y, breathe, cabinPose, cableHeight, cableZ, craneTrolley, spreaderY,
} from "../src/city/sights.ts";

const world = new CityWorld();
/** The offshore pylons and the flood wall's lamp masts on all four sides (metro-scene.ts `harbour`). */
const harbourPosts = [
  ...PYLON_ALONG.flatMap(along => [[along, -PYLON_LINE], [along, PYLON_LINE], [-PYLON_LINE, along], [PYLON_LINE, along]].map(([x, z]) => ({ x, z, half: 3 }))),
  ...WALL_MAST_ALONG.flatMap(along => [[along, -(FLOOD_WALL + 1)], [along, FLOOD_WALL + 1], [-(FLOOD_WALL + 1), along], [FLOOD_WALL + 1, along]].map(([x, z]) => ({ x, z, half: 0.6 }))),
];
const overlaps = (a: { x: number; z: number; half: number }, b: { x: number; z: number; half: number }, margin: number) =>
  Math.abs(a.x - b.x) < a.half + b.half + margin && Math.abs(a.z - b.z) < a.half + b.half + margin;

test("the harbour frame the sights stand on mirrors harbour.ts and metro-scene.ts", () => {
  assert.equal(QUAY_KERB, WORLD_EDGE + HARBOUR_KERB);
  assert.equal(FLOOD_WALL, WORLD_EDGE + HARBOUR_WALL);
  assert.equal(FLOOD_WALL_OUTER, FLOOD_WALL + HARBOUR_COPING);
  assert.equal(WATER_Y, -HARBOUR_LEVEL);
  const metro = readFileSync(new URL("../src/city/metro-scene.ts", import.meta.url), "utf8");
  assert.equal(Number(/PYLON_OUT = (\d+)/.exec(metro)?.[1]), PYLON_LINE - FLOOD_WALL);
  // Harbour-light: the wall's lamp masts (metro-scene.ts `wallMast`) stand where the ground shader lays their pools.
  assert.equal(Number(/MAST_STEP = (\d+(?:\.\d+)?)/.exec(metro)?.[1]), WALL_MAST_STEP);
  assert.equal(Number(/MAST_Y = (\d+(?:\.\d+)?)/.exec(metro)?.[1]), MAST_LAMP_Y);
  assert.equal(Number(/MAST_REACH = (\d+(?:\.\d+)?)/.exec(metro)?.[1]), MAST_ARM);
  // Masts every 32 m (was 128 m) from corner to corner, symmetric about the centre lines.
  assert.equal(WALL_MAST_STEP, 32);
  assert.equal(WALL_MAST_ALONG[0], -WORLD_EDGE);
  assert.equal(WALL_MAST_ALONG[WALL_MAST_ALONG.length - 1], WORLD_EDGE);
});

test("the sights' light pools lie where their lamps shine: on the quay or on open water, soft and modest", () => {
  for (const pool of QUAY_POOLS) assert.equal(harbourZone(pool.x, pool.z), "quay", `quay pool at ${pool.x}, ${pool.z}`);
  for (const pool of WATER_POOLS) assert.equal(harbourZone(pool.x, pool.z), "water", `water pool at ${pool.x}, ${pool.z}`);
  for (const pool of [...QUAY_POOLS, ...WATER_POOLS]) {
    // Soft discs ~6-20 m across (1/e radius 3-10 m), never brighter than a dim lamp-lit surface.
    assert.ok(pool.radius >= 3 && pool.radius <= 10, `radius ${pool.radius}`);
    assert.ok(Math.max(...pool.color) <= 0.25 && Math.min(...pool.color) >= 0);
  }
  // Every pier of the barrier and every Rainline tower has one.
  assert.equal(WATER_POOLS.filter(pool => Math.abs(pool.x - (BARRIER.x - BARRIER.pierDepth / 2 - 4)) < 1e-9).length, BARRIER_PIERS.length);
  assert.equal(WATER_POOLS.filter(pool => pool.x === CABLEWAY.x).length, CABLE_TOWERS.length);
});

test("sights are separate from the landmarks and stand wholly outside the walkable city", () => {
  assert.equal(LANDMARKS.length, 6, "the discovery count stays 6: sights are not landmarks");
  assert.equal(new Set(SIGHTS.map(sight => sight.id)).size, SIGHTS.length);
  for (const sight of SIGHTS) {
    assert.ok(!LANDMARKS.some(landmark => landmark.id === sight.id), sight.id);
    // The footprint's nearest point lies past the Rim Roads' outer kerb on at least one axis.
    const inner = Math.max(Math.abs(sight.x) - sight.halfX, Math.abs(sight.z) - sight.halfZ);
    assert.ok(inner > QUAY_KERB, `${sight.name}: footprint reaches ${inner} m, inside the kerb at ${QUAY_KERB}`);
    for (const building of world.buildings) {
      assert.ok(Math.abs(building.x - sight.x) > building.width / 2 + sight.halfX || Math.abs(building.z - sight.z) > building.depth / 2 + sight.halfZ, `${sight.name} overlaps building ${building.id}`);
    }
  }
});

test("every quay and water footing is clear of the rail legs, the wall masts and the pylons, and unreachable on foot", () => {
  for (const solid of SIGHT_SOLIDS) {
    assert.ok(Math.max(Math.abs(solid.x), Math.abs(solid.z)) - solid.half > QUAY_KERB, `footing at ${solid.x}, ${solid.z} is on the Rim Road`);
    for (const leg of RAIL_SOLIDS) assert.ok(!overlaps(solid, leg, 1), `footing at ${solid.x}, ${solid.z} hits rail solid at ${leg.x}, ${leg.z}`);
    for (const post of harbourPosts) assert.ok(!overlaps(solid, post, 1), `footing at ${solid.x}, ${solid.z} hits harbour post at ${post.x}, ${post.z}`);
    for (const [dx, dz] of [[0, 0], [solid.half, 0], [0, -solid.half], [-solid.half, solid.half]]) assert.equal(world.canOccupy(solid.x + dx, solid.z + dz), false);
  }
  // The walkable city stops PLAYER_RADIUS-ish short of the edge; the quay footings are well beyond it.
  assert.ok(QUAY_KERB > WORLD_EDGE - 3 + PLAYER_RADIUS);
});

test("the ship lies off the flood wall, clear of the pylon line, with the cranes on the quay", () => {
  const north = SHIP.z - SHIP.beam / 2, south = SHIP.z + SHIP.beam / 2;
  assert.ok(north > FLOOD_WALL_OUTER + 2, "fender gap to the flood wall");
  for (const along of PYLON_ALONG) if (Math.abs(along - SHIP.x) < (SHIP.bow - SHIP.stern) / 2 + 3) assert.ok(south < PYLON_LINE - 3 - 10, `pylon at x = ${along}`);
  for (const crane of QUAY_CRANES) {
    assert.ok(CRANE.landZ - 1 > QUAY_KERB && CRANE.seaZ + 1 < FLOOD_WALL, "crane rails on the quay");
    // The backreach stays off the Rim Line's deck (track on the Rim Road's centre line, ~2 m half-width).
    assert.ok(CRANE.backZ - WORLD_EDGE > 8);
    assert.ok(CRANE.boomY > RIM_DECK_HEIGHT && CRANE.tipZ > south);
    // The crane's legs straddle a stretch of quay away from the gangway stair.
    assert.ok(Math.abs(crane.x - GANGWAY_X) > CRANE.legX + 4);
  }
  for (let i = 0; i < SIGHT_SOLIDS.length; i++) for (let j = i + 1; j < SIGHT_SOLIDS.length; j++) assert.ok(!overlaps(SIGHT_SOLIDS[i], SIGHT_SOLIDS[j], 1), `footings ${i} and ${j} overlap`);
  const ship = SIGHTS.find(sight => sight.kind === "ship");
  assert.ok(ship);
  assert.ok(ship.z - ship.halfZ <= CRANE.backZ && ship.z + ship.halfZ >= CRANE.tipZ, "the footprint covers the cranes' booms");
  assert.ok(ship.halfX >= (SHIP.bow - SHIP.stern) / 2);
});

test("the barrier's piers and gates line up and it stays clear of the pylons and the Rim Line", () => {
  assert.equal(BARRIER_PIERS.length, BARRIER_BAYS.length + 1);
  assert.ok(BARRIER_BAYS.includes(BARRIER.spillZ), "the spill bay is a bay");
  assert.ok(BARRIER.x - BARRIER.pierDepth / 2 > PYLON_LINE + 10, "the barrier stands beyond the pylon line");
  assert.ok(BARRIER.chuteFoot > PYLON_LINE + 3 + 1, "the chute lands beyond the pylons' caissons");
  assert.ok(BARRIER_PIERS[0] - BARRIER.pierHalf >= BARRIER.z - BARRIER.half - 4 && BARRIER_PIERS[BARRIER_PIERS.length - 1] + BARRIER.pierHalf <= BARRIER.z + BARRIER.half + 4, "piers span the barrier");
  // The access bridge (crest height, 3 m wide) passes between the pylons and the wall masts.
  for (const along of PYLON_ALONG) assert.ok(Math.abs(along - BARRIER.bridgeZ) > 10, `bridge vs pylon at ${along}`);
  for (const along of WALL_MAST_ALONG) assert.ok(Math.abs(along - BARRIER.bridgeZ) > 3, `bridge vs wall mast at ${along}`);
  assert.ok(BARRIER.stairX - BARRIER.stairHalf > WORLD_EDGE + HARBOUR_KERB + 3);
  const barrier = SIGHTS.find(sight => sight.kind === "barrier");
  assert.ok(barrier);
  assert.ok(barrier.x - barrier.halfX <= BARRIER.stairX - BARRIER.stairHalf && barrier.x + barrier.halfX >= BARRIER.x + BARRIER.pierDepth / 2);
});

test("the cableway runs over the water at 50-70 m, clear of every building, deck and pylon", () => {
  assert.ok(Math.abs(CABLEWAY.x) - CABLEWAY.gap / 2 - 2 > FLOOD_WALL_OUTER, "cables outside the flood wall");
  assert.ok(Math.abs(CABLEWAY.x) + CABLEWAY.gap / 2 + 12 < PYLON_LINE - 8, "cables inside the pylon line and its crossarms");
  assert.ok(Math.abs(CABLEWAY.x) - WORLD_EDGE > 40, "well clear of the Rim Line deck");
  let lowest = Infinity, highest = -Infinity;
  for (let s = 0; s <= CABLE_LENGTH; s += 2) { const y = cableHeight(s); lowest = Math.min(lowest, y); highest = Math.max(highest, y); }
  assert.ok(lowest >= 50 && highest <= 70, `cable between ${lowest} and ${highest} m`);
  // Cabins hang below the cable: their floor stays far above the wall masts (17 m) and pylons (~35 m).
  assert.ok(lowest - CABLEWAY.drop - 1.3 > 40);
  // No building near the line reaches the cabins (the line is over water, so none is near at all).
  for (const building of world.buildings) {
    if (Math.abs(building.x - CABLEWAY.x) < building.width / 2 + 40) assert.ok(building.height < lowest - CABLEWAY.drop - 10, `building ${building.id}`);
  }
  for (const s of CABLE_TOWERS) {
    const z = cableZ(s);
    assert.ok(Math.abs(z) <= WORLD_EDGE - 200, "towers stay off the corner yards");
    for (const along of PYLON_ALONG) assert.ok(Math.abs(along - z) > 6 || Math.abs(CABLEWAY.x) + 6 < PYLON_LINE - 8);
  }
  const line = SIGHTS.find(sight => sight.kind === "cableway");
  assert.ok(line && line.halfZ >= CABLE_LENGTH / 2 + CABLEWAY.terminalHalf);
});

test("every animation is slow: spins, breaths, trolleys, gondolas and the spillway's water", () => {
  assert.ok(RADAR_DEG_PER_S <= 10);
  assert.ok(LAMP_BREATH_HZ <= 0.4);
  assert.ok(TROLLEY_PERIOD >= 30 && TROLLEY_PERIOD <= 60);
  assert.ok(CHUTE_SCROLL <= 2.5);
  // Lamps breathe, never go dark or jump.
  let min = Infinity, max = -Infinity, step = 0;
  for (let time = 0; time < 20; time += 0.05) {
    const b = breathe(time); min = Math.min(min, b); max = Math.max(max, b);
    step = Math.max(step, Math.abs(breathe(time + 0.05) - b));
  }
  assert.ok(min >= 0.4 && max <= 1 && step < 0.05, `breath ${min}-${max}, step ${step}`);
  // Trolleys stay on the boom and move under 5 m/s; the spreader under 5 m/s too.
  for (const crane of QUAY_CRANES) {
    for (let time = 0; time < TROLLEY_PERIOD; time += 0.1) {
      const a = craneTrolley(time, crane), b = craneTrolley(time + 0.1, crane);
      assert.ok(a.z >= CRANE.trolleyFrom - 1e-9 && a.z <= CRANE.trolleyTo + 1e-9);
      assert.ok(Math.abs(b.z - a.z) / 0.1 < 5);
      assert.ok(Math.abs(spreaderY(b.z, b.drop) - spreaderY(a.z, a.drop)) / 0.1 < 5);
      assert.ok(spreaderY(a.z, a.drop) > 3 && spreaderY(a.z, a.drop) < CRANE.boomY);
    }
  }
  // Gondolas: ~80 m apart, gliding at CABLE_SPEED along the cable, never jumping outside a terminal.
  assert.ok(CABLE_SPEED <= 4 && CABIN_SPACING > 70 && CABIN_SPACING < 90);
  for (let i = 0; i < CABIN_COUNT; i++) {
    for (let time = 0; time < 700; time += 0.5) {
      const a = cabinPose(time, i), b = cabinPose(time + 0.5, i);
      if (a.hidden || b.hidden) continue;
      const speed = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.5;
      assert.ok(speed < CABLE_SPEED * 1.1, `cabin ${i} at ${time}: ${speed} m/s`);
      assert.ok(Math.abs(a.y - (cableHeight(a.s) - CABLEWAY.drop)) < 1e-9);
    }
  }
});
