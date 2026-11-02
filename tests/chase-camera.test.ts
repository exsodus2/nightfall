import assert from "node:assert/strict";
import test from "node:test";
import { CAR_HALF_WIDTH, DRIVER_EYE_HEIGHT, DriveSession, ParkedCars, carFits, type DriveCamera, type DriveInput } from "../src/city/driving.ts";
import { MouseLook } from "../src/city/locomotion.ts";
import { CityWorld } from "../src/city/world.ts";

const world = new CityWorld();
const wallYaw = 19 * Math.PI / 16;
/** Free length of the chase boom from (x, z) toward view yaw `yaw`, probed as driving.ts does. */
const boomFree = (x: number, z: number, yaw: number) => {
  let free = 0;
  for (let d = 0; d <= 9.5; d += 0.5) { if (!world.canOccupy(x - Math.sin(yaw) * d, z + Math.cos(yaw) * d)) break; free = d; }
  return free;
};
// A parked car with a facade a few metres behind it along wallYaw and open street along yaw 0.
// Chosen by geometry rather than by id, so parked-car numbering (stations, plots) can change;
// the car this test was written against (-58.2, -37) is preferred while it still qualifies.
const car = new ParkedCars(world).all()
  .filter(candidate => boomFree(candidate.x, candidate.z, wallYaw) < 5 && boomFree(candidate.x, candidate.z, 0) >= 9.5)
  .sort((a, b) => Math.hypot(a.x + 58.2, a.z + 37) - Math.hypot(b.x + 58.2, b.z + 37))[0]!;
const input: DriveInput = { throttle: 0, steer: 0, handbrake: false, boost: false };
const distance = (view: DriveCamera, session: DriveSession) => Math.hypot(view.x - session.car.x, view.z - session.car.z);
const safe = (view: DriveCamera) => assert.ok(world.canOccupy(view.x, view.z), `camera entered a solid at ${view.x},${view.z}`);

test("remembered chase view contracts before returning its first camera beside a facade", () => {
  assert.ok(car && carFits(world, car));
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const look = new MouseLook(wallYaw, 0), session = new DriveSession(car, look, true);
    const view = session.update(world, input, dt, look);
    safe(view);
    assert.ok(distance(view, session) < 9, "the obstructed boom retracts immediately");
    assert.equal(session.blend, 1);
    assert.equal(view.height, 3.6);
    assert.equal(view.fovKick, 0);
    assert.equal(session.car.x, car.x); assert.equal(session.car.z, car.z);
  }
});

test("tight but valid driven cars can retract the boom below its old unsafe minimum", () => {
  const building = world.buildings.find(candidate => candidate.id === 1078)!;
  const clearance = CAR_HALF_WIDTH + 0.01;
  const poses = [
    { x: building.x - building.width / 2 - clearance, z: building.z, yaw: 0, lookYaw: -Math.PI / 2 },
    { x: building.x + building.width / 2 + clearance, z: building.z, yaw: 0, lookYaw: Math.PI / 2 },
    { x: building.x, z: building.z - building.depth / 2 - clearance, yaw: Math.PI / 2, lookYaw: 0 },
    { x: building.x, z: building.z + building.depth / 2 + clearance, yaw: Math.PI / 2, lookYaw: Math.PI },
  ];
  for (const pose of poses) for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    assert.ok(carFits(world, pose));
    assert.ok(world.canOccupy(pose.x, pose.z));
    const look = new MouseLook(pose.lookYaw, 0), session = new DriveSession({ ...pose, id: -1 }, look, true);
    const view = session.update(world, input, dt, look);
    safe(view);
    assert.ok(distance(view, session) <= 0.5 + 1e-8);
    assert.equal(view.height, 3.6);
    assert.equal(view.fovKick, 0);
  }
});

test("fast mouse orbits never retain an unsafe boom length from the previous view direction", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const look = new MouseLook(0, 0), session = new DriveSession(car, look, true);
    safe(session.update(world, input, dt, look));
    look.add(-1700, 0);
    let contracted = false;
    for (let frame = 0; frame < Math.ceil(0.6 / dt); frame++) {
      look.update(dt);
      const view = session.update(world, input, dt, look);
      safe(view);
      contracted ||= distance(view, session) < 6;
    }
    assert.ok(contracted, "the orbit actually faces the nearby wall");
    assert.equal(session.car.x, car.x); assert.equal(session.car.z, car.z);
  }
});

test("cockpit-to-chase blending and mid-transition reversals stay outside nearby buildings", () => {
  const look = new MouseLook(wallYaw, -0.08), session = new DriveSession(car, look);
  const cockpit = session.update(world, input, 1 / 60, look);
  assert.equal(cockpit.height, DRIVER_EYE_HEIGHT);
  assert.equal(cockpit.pitch, look.pitch);
  assert.equal(session.exterior, false);
  session.toggleView();
  for (let frame = 0; frame < 60; frame++) {
    if (frame === 10 || frame === 16) session.toggleView();
    const view = session.update(world, input, 1 / 60, look);
    safe(view);
    assert.ok(view.height >= DRIVER_EYE_HEIGHT && view.height <= 3.6);
    assert.equal(view.fovKick, 0);
  }
  assert.equal(session.blend, 1);
  session.toggleView();
  let restored = cockpit;
  for (let frame = 0; frame < 30; frame++) { restored = session.update(world, input, 1 / 60, look); safe(restored); }
  assert.equal(session.blend, 0); assert.equal(session.exterior, false);
  assert.equal(restored.height, DRIVER_EYE_HEIGHT);
  assert.equal(restored.x, cockpit.x); assert.equal(restored.z, cockpit.z);
  assert.equal(restored.pitch, look.pitch);
});

test("returning to a clear street extends the chase boom gently and frame-rate independently", () => {
  const afterSecond: number[] = [];
  for (const frameRate of [30, 60, 144]) {
    const look = new MouseLook(wallYaw, 0), session = new DriveSession(car, look, true);
    const obstructed = session.update(world, input, 1 / 60, look);
    const before = distance(obstructed, session);
    look.reset(0, 0);
    let previous = before;
    for (let frame = 0; frame < frameRate; frame++) {
      const view = session.update(world, input, 1 / frameRate, look), current = distance(view, session);
      safe(view);
      assert.ok(current > previous && current < 9.5, "boom expansion is eased rather than snapped");
      assert.ok(current - previous < 0.5, "clear-space expansion remains comfortable");
      previous = current;
    }
    afterSecond.push(previous);
    assert.ok(Math.abs(previous - (before + (9.5 - before) * (1 - Math.exp(-2.5)))) < 1e-8);
  }
  assert.ok(Math.max(...afterSecond) - Math.min(...afterSecond) < 1e-8);
});
