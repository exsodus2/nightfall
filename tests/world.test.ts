import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld, DISTRICTS, LANDMARKS, SPAWN, WORLD_EDGE, districtAt, movePlayer } from "../src/city/world.ts";

const world = new CityWorld();

test("city is large and generation is reproducible", () => {
  assert.equal(world.blocks.size, 576);
  assert.ok(world.buildings.length > 2200);
  assert.deepEqual(world.buildings, new CityWorld().buildings);
});

test("spawn, district transit stops and landmark arrivals are walkable", () => {
  assert.ok(world.canOccupy(SPAWN.x, SPAWN.z));
  for (const district of DISTRICTS) assert.ok(world.canOccupy(district.x, district.z), district.name);
  for (const landmark of LANDMARKS) assert.ok(world.canOccupy(landmark.arrivalX, landmark.arrivalZ), landmark.name);
});

test("main streets connect the entire city in both directions", () => {
  for (let street = -11; street <= 11; street++) {
    for (let position = -WORLD_EDGE + 4; position < WORLD_EDGE - 4; position += 4) {
      assert.ok(world.canOccupy(street * 64, position), `north-south ${street},${position}`);
      assert.ok(world.canOccupy(position, street * 64), `east-west ${position},${street}`);
    }
  }
});

test("solid buildings and world edges block walking", () => {
  for (const building of world.buildings) assert.equal(world.canOccupy(building.x, building.z), false);
  assert.equal(world.canOccupy(WORLD_EDGE, 0), false);
  assert.equal(world.canOccupy(0, -WORLD_EDGE), false);
  assert.equal(world.canOccupy(NaN, 0), false);
});

test("movement stays outside buildings when sprinting into a wall", () => {
  const building = world.buildings[100];
  const player = { x: building.x - building.width / 2 - 3, z: building.z, yaw: Math.PI / 2, pitch: 0, distance: 0 };
  for (let i = 0; i < 100; i++) movePlayer(world, player, 1, 0, true, 0.1);
  assert.ok(player.x < building.x - building.width / 2);
  assert.ok(world.canOccupy(player.x, player.z));
});

test("diagonal walking has the same speed and coordinates select the district", () => {
  const straight = { ...SPAWN, distance: 0 };
  const diagonal = { ...SPAWN, distance: 0 };
  movePlayer(world, straight, 1, 0, false, 0.02);
  movePlayer(world, diagonal, 1, 1, false, 0.02);
  assert.ok(Math.abs(straight.distance - diagonal.distance) < 0.00001);
  assert.equal(districtAt(-500, -500).name, "The Foundry");
  assert.equal(districtAt(0, -500).name, "Neon Ward");
  assert.equal(districtAt(500, 500).name, "The Spillway");
});
