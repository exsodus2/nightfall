import assert from "node:assert/strict";
import test from "node:test";
import { KERB_BUMP, MAX_SLIP, carFits, roadDistance, roadWetness, setRoadWetness, stepCar, wetBraking, wetGrip, type DriveCar, type DriveInput } from "../src/city/driving.ts";
import { CityWorld } from "../src/city/world.ts";

const world = new CityWorld();
const car = (x: number, z: number, yaw: number, speed = 0): DriveCar => ({ x, z, yaw, id: 1, speed, steer: 0, yawRate: 0, accel: 0, scraping: false });
const input = (throttle: number, steer = 0, extra: Partial<DriveInput> = {}): DriveInput => ({ throttle, steer, handbrake: false, boost: false, ...extra });
const run = (c: DriveCar, i: DriveInput, seconds: number) => { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) stepCar(world, c, i, 1 / 60); };
// The avenue's open carriageway (x = 0, mid-block), long enough to brake and turn on.
const OPEN = { x: 0, z: 96 };

test("wetness scales grip and braking gently: drizzle barely, a downpour by a fifth", () => {
  assert.ok(roadWetness(0.2) < 0.01, "drizzle is a dry road");
  assert.equal(roadWetness(1), 1);
  for (let rain = 0; rain <= 1; rain += 0.05) {
    const w = roadWetness(rain);
    assert.ok(w >= 0 && w <= 1 && roadWetness(rain + 0.05) >= w - 1e-12, "monotonic, bounded");
    assert.ok(wetGrip(w) >= 0.82 && wetGrip(w) <= 1 && wetBraking(w) >= 0.75 && wetBraking(w) <= 1);
  }
  assert.equal(wetGrip(0), 1); assert.equal(wetBraking(0), 1);
});

test("in a downpour the car brakes longer and understeers a little, but never spins", () => {
  const stop = (rain: number) => {
    const c = car(OPEN.x, OPEN.z + 40, 0, 20);
    let travelled = 0;
    for (let i = 0; i < 600 && c.speed > 0; i++) travelled += stepCar(world, c, input(-1, 0, { rain }), 1 / 60).moved;
    return travelled;
  };
  const dry = stop(0), wet = stop(1);
  assert.ok(wet > dry * 1.1 && wet < dry * 1.45, `braking from 20 m/s: ${dry.toFixed(1)} m dry, ${wet.toFixed(1)} m wet`);
  // Same steady full-lock turn: a wider circle on the wet road, and the lateral grip cap holds.
  const turn = (rain: number) => { const c = car(OPEN.x, OPEN.z, 0, 18); run(c, input(0.35, 1, { rain }), 0.8); return c; };
  const dryTurn = turn(0), wetTurn = turn(1);
  assert.ok(Math.abs(wetTurn.yawRate) < Math.abs(dryTurn.yawRate), "wet: less yaw rate (understeer)");
  assert.ok(Math.abs(wetTurn.speed * wetTurn.yawRate) <= 14 * wetGrip(1) + 0.01);
  // Handbrake and full lock in the wet at speed: the slide stays capped and the car keeps its heading
  // within a gentle arc rather than spinning round.
  const c = car(OPEN.x, OPEN.z + 40, 0, 20);
  let maxSlip = 0;
  for (let i = 0; i < 60; i++) { stepCar(world, c, input(0, 1, { rain: 1, handbrake: true }), 1 / 60); maxSlip = Math.max(maxSlip, Math.abs(c.slip ?? 0)); }
  assert.ok(maxSlip <= MAX_SLIP + 1e-9, `slip ${maxSlip}`);
  assert.ok(Math.abs(c.yaw) < Math.PI / 2, `yawed ${c.yaw.toFixed(2)} rad in a second`);
});

test("the handbrake steps the rear out a little at speed, eased, and it settles once released", () => {
  const sliding = car(OPEN.x, OPEN.z + 40, 0, 20), gripping = car(OPEN.x, OPEN.z + 40, 0, 20);
  run(sliding, input(0, 0.8, { handbrake: true }), 0.6);
  run(gripping, input(0, 0.8), 0.6);
  assert.ok(Math.abs(sliding.slip ?? 0) > 0.12, `handbrake slip ${sliding.slip}`);
  assert.ok(Math.abs(gripping.slip ?? 0) < 0.07, `normal cornering slip ${gripping.slip}`);
  // Eased, not snapped: one frame later the slide has barely changed; half a second after release it is gone.
  const before = sliding.slip ?? 0;
  stepCar(world, sliding, input(0, 0), 1 / 60);
  assert.ok(Math.abs((sliding.slip ?? 0) - before) < Math.abs(before) * 0.5);
  run(sliding, input(0, 0), 0.5);
  assert.ok(Math.abs(sliding.slip ?? 0) < 0.02);
  // A slow handbrake turn barely slides.
  const slow = car(OPEN.x, OPEN.z + 40, 0, 4);
  run(slow, input(0, 1, { handbrake: true }), 0.3);
  assert.ok(Math.abs(slow.slip ?? 0) < 0.08);
});

test("engine braking slows a coasting car a little more at speed than at a crawl", () => {
  const fast = car(OPEN.x, OPEN.z + 40, 0, 20), slow = car(OPEN.x, OPEN.z + 40, 0, 3);
  run(fast, input(0), 1); run(slow, input(0), 1);
  assert.ok(fast.speed < 20 - (0.9 + 0.0035 * 400) && fast.speed > 15, `coast from 20: ${fast.speed}`);
  assert.ok(slow.speed > 1.5, `coast from 3: ${slow.speed}`);
});

test("mounting the kerb nudges the speed only", () => {
  // The avenue's east kerb (|x| 12.4-13.2), mid-block, where the pavement behind it is open.
  let start: { x: number; z: number } | null = null;
  for (let z = 80; z < 112 && !start; z += 1) {
    const road = { x: 12, z }, pavement = { x: 13.4, z };
    if (carFits(world, { ...road, yaw: Math.PI / 2 }) && carFits(world, { ...pavement, yaw: Math.PI / 2 })) start = road;
  }
  assert.ok(start, "an open kerb");
  assert.ok(roadDistance(start.x, start.z) < 6.2);
  const bumped = { ...car(start.x, start.z, Math.PI / 2, 8), kerb: false }, unseen = car(start.x, start.z, Math.PI / 2, 8);
  stepCar(world, bumped, input(0), 0.15); stepCar(world, unseen, input(0), 0.15);
  assert.ok(roadDistance(bumped.x, bumped.z) > 6.4, "crossed onto the pavement");
  assert.ok(Math.abs(unseen.speed - bumped.speed - unseen.speed * KERB_BUMP) < 0.05, `bump ${unseen.speed - bumped.speed}`);
  assert.equal(bumped.yaw, unseen.yaw);
  assert.equal(bumped.kerb, true);
});

test("the scene's rain sets the road for steps that carry no rain of their own", () => {
  const dry = car(OPEN.x, OPEN.z + 40, 0, 20), wet = car(OPEN.x, OPEN.z + 40, 0, 20);
  setRoadWetness(0); run(dry, input(-1), 0.5);
  setRoadWetness(1); run(wet, input(-1), 0.5);
  setRoadWetness(0);
  assert.ok(wet.speed > dry.speed + 0.5, "longer braking on the wet road");
  setRoadWetness(NaN);
  const reset = car(OPEN.x, OPEN.z + 40, 0, 20); run(reset, input(-1), 0.5);
  assert.ok(Math.abs(reset.speed - dry.speed) < 1e-9, "an invalid rain value is a dry road");
});
