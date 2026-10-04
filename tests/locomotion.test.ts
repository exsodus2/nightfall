import assert from "node:assert/strict";
import test from "node:test";
import { advanceJourney, createJourney, groundRoute, MouseLook, safeLanding, WALK_HEIGHT, type RideMode } from "../src/city/locomotion.ts";
import { CityWorld, DISTRICTS, SPAWN, WORLD_EDGE } from "../src/city/world.ts";

test("fast mouse swipes preserve input regardless of event batching", () => {
  const one = new MouseLook(0, 0), many = new MouseLook(0, 0);
  one.add(1200, 300);
  for (let i = 0; i < 120; i++) many.add(10, 2.5);
  one.update(1 / 30); many.update(1 / 30);
  assert.ok(Math.abs(one.yaw - many.yaw) < 1e-10);
  assert.ok(one.yaw > 0 && one.yaw < one.targetYaw);
  const original = one.targetYaw;
  one.add(NaN, 0); one.add(5000, 0);
  assert.equal(one.targetYaw, original, "OS recenter spikes and invalid deltas are rejected");
});

test("camera smoothing is frame-rate independent and yaw crosses PI without wrapping", () => {
  const slow = new MouseLook(Math.PI - 0.1, 0), fast = new MouseLook(Math.PI - 0.1, 0);
  slow.add(300, 0); fast.add(300, 0);
  for (let i = 0; i < 30; i++) slow.update(1 / 30);
  for (let i = 0; i < 144; i++) fast.update(1 / 144);
  assert.ok(Math.abs(slow.yaw - fast.yaw) < 1e-10);
  assert.ok(slow.yaw > Math.PI);
  slow.add(0, 1700); slow.update(1);
  assert.ok(slow.pitch <= 1.25);
});

test("both taxi modes complete actual routes to every district", () => {
  const world = new CityWorld();
  for (const mode of ["taxi", "sky"] as Exclude<RideMode, "metro">[]) for (const destination of DISTRICTS) {
    const journey = createJourney(mode, { ...SPAWN, distance: 0 }, WALK_HEIGHT, destination.id, world);
    assert.ok(journey);
    const position = { x: SPAWN.x, y: WALK_HEIGHT, z: SPAWN.z };
    let done = false, highest = position.y;
    for (let frame = 0; frame < 15000 && !done; frame++) {
      const previous = { ...position };
      done = advanceJourney(journey, position, 1 / 30).done;
      assert.ok(Math.hypot(position.x - previous.x, position.y - previous.y, position.z - previous.z) < 4, "Ride must not teleport");
      highest = Math.max(highest, position.y);
    }
    assert.ok(done, `${mode} reaches ${destination.name}`);
    assert.ok(Math.abs(position.x - destination.x) < 0.001);
    assert.ok(Math.abs(position.z - destination.z) < 0.001);
    assert.ok(Math.abs(position.y - WALK_HEIGHT) < 0.001);
    if (mode === "sky") assert.equal(highest, 230);
  }
});

test("taxi routes remain on connected streets between every pair of stations", () => {
  const world = new CityWorld();
  for (const start of DISTRICTS) for (const end of DISTRICTS) {
    const points = groundRoute({ ...start, y: WALK_HEIGHT }, { ...end, y: WALK_HEIGHT }, world);
    assert.ok(points);
    for (let segment = 1; segment < points.length; segment++) {
      const a = points[segment - 1], b = points[segment];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
      for (let i = 0; i <= steps; i++) {
        const p = steps ? i / steps : 0;
        assert.ok(world.canOccupy(a.x + (b.x - a.x) * p, a.z + (b.z - a.z) * p));
      }
    }
  }
});

test("ending free flight or a sky ride always finds a safe landing", () => {
  const world = new CityWorld();
  for (const building of world.buildings.filter((_, i) => i % 11 === 0)) {
    const landing = safeLanding(world, building.x, building.z);
    assert.ok(world.canOccupy(landing.x, landing.z));
  }
  const landing = safeLanding(world, WORLD_EDGE + 100, -WORLD_EDGE - 100);
  assert.ok(world.canOccupy(landing.x, landing.z));
});
