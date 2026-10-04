import assert from "node:assert/strict";
import test from "node:test";
import { CAR_HALF_LENGTH, ParkedCars, carFits, carObstacle, stepCar, type DriveCar } from "../src/city/driving.ts";
import { RoadAwareness } from "../src/city/road-awareness.ts";
import { CityTraffic, stopDistance, type Vehicle } from "../src/city/traffic.ts";
import { WALKING_CAR_ROOF_CLEARANCE, WalkingCollision } from "../src/city/walking-collision.ts";
import { WALK_ARRIVAL_QUERY_RADIUS, canStandAtArrival, findWalkArrival } from "../src/city/walk-arrival.ts";
import { CityWorld, WORLD_EDGE } from "../src/city/world.ts";
import { MAX_REMOTE_CARS, REMOTE_CAR_HEIGHT_TOLERANCE, nearbyRemoteCars, type RemoteVehiclePose } from "../src/multiplayer/remote-vehicles.ts";

const origin = { x: 0, z: 0 };
const remote = (id: string, patch: Partial<RemoteVehiclePose> = {}): RemoteVehiclePose => ({ id, x: 0, y: 0, z: 0, heading: 0, mode: "drive", place: "", carrier: null, ...patch });
const openWorld = { canOccupy: () => true };
const heading = (car: Vehicle): { axis: "x" | "z"; direction: number; along: number } => Math.abs(Math.sin(car.yaw)) > 0.5
  ? { axis: "x", direction: Math.sign(Math.sin(car.yaw)), along: car.x }
  : { axis: "z", direction: Math.sign(-Math.cos(car.yaw)), along: car.z };

test("only finite, exterior, ground-level driving and taxi bodies become obstacles", () => {
  const accepted = [remote("driver", { x: 1 }), remote("taxi", { x: 2, mode: "taxi" }), remote("legacy", { x: 3, place: undefined, carrier: undefined })];
  const rejected = [
    remote("indoor", { place: "blue-hour" }), remote("unknown-room", { place: "not-a-room" }),
    remote("rider", { carrier: { train: 0, u: 0, v: 0, yaw: 0 } }),
    ...(["walk", "fly", "sky", "metro"] as const).map(mode => remote(mode, { mode })),
    ...[NaN, Infinity, -Infinity, WORLD_EDGE + 1].map(x => remote(`bad-x-${x}`, { x })),
    ...[NaN, Infinity, -Infinity, -WORLD_EDGE - 1].map(z => remote(`bad-z-${z}`, { z })),
    ...[NaN, Infinity, -Infinity, REMOTE_CAR_HEIGHT_TOLERANCE + 0.001, -REMOTE_CAR_HEIGHT_TOLERANCE - 0.001, 28.9, 90].map(y => remote(`bad-y-${y}`, { y })),
    ...[NaN, Infinity, -Infinity].map(heading => remote(`bad-heading-${heading}`, { heading })),
    remote(""), remote("x".repeat(65)),
  ];
  assert.deepEqual(nearbyRemoteCars([...rejected, ...accepted], origin, 30), accepted.map(pose => ({ x: pose.x, z: pose.z, yaw: pose.heading })));
  for (const y of [-REMOTE_CAR_HEIGHT_TOLERANCE, REMOTE_CAR_HEIGHT_TOLERANCE]) assert.equal(nearbyRemoteCars([remote("rounding", { y })], origin, 0).length, 1);
  assert.equal(nearbyRemoteCars([remote("edge", { x: WORLD_EDGE })], { x: WORLD_EDGE, z: 0 }, 0).length, 1);
});

test("query bounds are inclusive and invalid anchors or radii cannot create phantom obstacles", () => {
  const exact = remote("edge", { x: 18 }), outside = remote("outside", { x: 18.001 });
  assert.deepEqual(nearbyRemoteCars([outside, exact], origin, 18), [{ x: 18, z: 0, yaw: 0 }]);
  for (const radius of [-1, NaN, Infinity, -Infinity]) assert.deepEqual(nearbyRemoteCars([exact], origin, radius), []);
  for (const anchor of [{ x: NaN, z: 0 }, { x: 0, z: Infinity }]) assert.deepEqual(nearbyRemoteCars([exact], anchor, 30), []);
  assert.deepEqual(nearbyRemoteCars([], origin, 30), []);
});

test("retention is nearest-first, deterministic, duplicate-safe and capped at the room's remote player count", () => {
  const poses = Array.from({ length: 100 }, (_, index) => remote(`driver-${index.toString().padStart(3, "0")}`, { x: index - 50, z: 5 }));
  poses.push(remote("duplicate", { x: 2, z: 1 }), remote("duplicate", { x: 1, z: 2 }), remote("duplicate", { x: 100, z: 0 }));
  const before = structuredClone(poses);
  const selected = nearbyRemoteCars(poses, origin, 150);
  assert.equal(selected.length, MAX_REMOTE_CARS);
  assert.deepEqual(selected, nearbyRemoteCars([...poses].reverse(), origin, 150));
  assert.deepEqual(poses, before, "selection never reorders or edits remote snapshots");
  assert.equal(selected.filter(pose => pose.x === 1 && pose.z === 2).length, 1);
  assert.ok(!selected.some(pose => pose.x === 2 && pose.z === 1 || pose.x === 100));
  for (let index = 1; index < selected.length; index++) assert.ok(Math.hypot(selected[index - 1].x, selected[index - 1].z) <= Math.hypot(selected[index].x, selected[index].z));
  assert.ok(selected.every(pose => Math.hypot(pose.x, pose.z) < 7));
});

test("body heading rather than camera look controls the remote car's footprint", () => {
  const pose = { ...remote("looking-sideways", { heading: Math.PI / 2 }), yaw: 0 };
  const [car] = nearbyRemoteCars([pose], origin, 10);
  assert.equal(car.yaw, Math.PI / 2);
  const collision = new WalkingCollision(openWorld, { x: 4, z: 0 });
  collision.setCars([car]);
  assert.equal(collision.canStep(4, 0, 3, 0), false, "the long body extends along x despite the driver's look yaw");
  collision.setCars([{ ...car, yaw: pose.yaw }]);
  assert.equal(collision.canStep(4, 0, 3, 0), true, "the control case really distinguishes chassis and camera angles");
});

test("remote car walking collision blocks swept crossings, permits overlap escape and clears on mode or scope changes", () => {
  const collision = new WalkingCollision(openWorld, { x: -6, z: 0 });
  collision.setCars(nearbyRemoteCars([remote("driver")], origin, 18));
  assert.equal(collision.canStep(-6, 0, 6, 0), false);
  assert.equal(collision.canStep(1, 0, 1.2, 0), true, "an incoming body never traps an overlapping walker");
  assert.equal(collision.canStep(1, 0, 0.8, 0), false);
  collision.setCars(nearbyRemoteCars([remote("driver")], origin, 18), WALKING_CAR_ROOF_CLEARANCE);
  assert.equal(collision.canStep(-6, 0, 6, 0), true, "a walker above the roof retains the existing clearance rule");
  for (const patch of [{ mode: "walk" as const }, { place: "blue-hour" }, { y: 30 }]) {
    collision.setCars(nearbyRemoteCars([remote("driver", patch)], origin, 18));
    assert.equal(collision.canStep(-6, 0, 6, 0), true);
  }
  collision.setCars(nearbyRemoteCars([], origin, 18));
  assert.equal(collision.canStep(-6, 0, 6, 0), true, "disconnect does not retain a cached obstacle");
});

test("real-world arrivals avoid an exterior remote body and remain independent of the viewer's current interior", () => {
  const world = new CityWorld(), parked = new ParkedCars(world), traffic = new CityTraffic();
  const localCars = [...parked.nearby(0, 0, WALK_ARRIVAL_QUERY_RADIUS), ...traffic.nearby(0, 0, WALK_ARRIVAL_QUERY_RADIUS)];
  assert.deepEqual(findWalkArrival(world, origin, localCars), origin, "the original arrival selects the remote car's center");
  const cars = nearbyRemoteCars([remote("street"), remote("indoors", { place: "blue-hour" })], origin, WALK_ARRIVAL_QUERY_RADIUS);
  assert.equal(cars.length, 1);
  const arrival = findWalkArrival(world, origin, [...localCars, ...cars]);
  assert.ok(arrival);
  assert.ok(Math.hypot(arrival.x, arrival.z) > 2 && Math.hypot(arrival.x, arrival.z) <= 4);
  assert.ok(canStandAtArrival(world, arrival, [...localCars, ...cars]));
  assert.equal(canStandAtArrival(world, origin, cars), false);
  assert.deepEqual(findWalkArrival(world, origin, nearbyRemoteCars([remote("street", { x: 30 })], origin, WALK_ARRIVAL_QUERY_RADIUS)), origin, "a fresh event query releases the old arrival when the remote moves away");
  const blocked = { canOccupy: (x: number, z: number) => Math.abs(x) < 0.1 && Math.abs(z) < 0.1 };
  assert.equal(findWalkArrival(blocked, origin, cars), null, "a blocked landing remains a bounded failure, not a far teleport");
});

test("driven cars use the same remote footprint as walking without trapping or pushing the remote", () => {
  const world = new CityWorld();
  const snapshot = remote("stopped-driver"), before = structuredClone(snapshot);
  const obstacles = nearbyRemoteCars([snapshot], { x: 0, z: 10 }, 260).map(carObstacle);
  const car: DriveCar = { x: 0, z: 10, yaw: 0, id: 1, speed: 0, steer: 0, yawRate: 0, accel: 0, scraping: false };
  assert.ok(carFits(world, car, obstacles));
  let impact = 0;
  for (let frame = 0; frame < 240; frame++) {
    impact = Math.max(impact, stepCar(world, car, { throttle: 1, steer: 0, handbrake: false, boost: false }, 1 / 60, obstacles).impact);
    assert.ok(car.z >= CAR_HALF_LENGTH + obstacles[0].halfLength - 1e-8);
  }
  assert.ok(impact > 0);
  assert.deepEqual(snapshot, before, "local collision never mutates another player's body");
  const stoppedAt = car.z;
  for (let frame = 0; frame < 60; frame++) stepCar(world, car, { throttle: 1, steer: 0, handbrake: false, boost: false }, 1 / 60, nearbyRemoteCars([], origin, 260).map(carObstacle));
  assert.ok(car.z < stoppedAt - 1, "the obstacle disappears immediately with the remote");
});

test("local traffic yields to remote ground vehicles in both road axes and directions, then releases smoothly", () => {
  for (const axis of ["x", "z"] as const) for (const direction of [-1, 1]) {
    const traffic = new CityTraffic();
    const car = traffic.nearby(0, 0, 330).find(candidate => {
      const lane = heading(candidate);
      return lane.axis === axis && lane.direction === direction && stopDistance(axis, direction, lane.along) > 25;
    });
    assert.ok(car);
    const body = remote("driver", { x: car.x + Math.sin(car.yaw) * 16, z: car.z - Math.cos(car.yaw) * 16, heading: car.yaw });
    const blockers = nearbyRemoteCars([body], body, 260);
    const pedestrians = new RoadAwareness();
    pedestrians.set({ eye: body, players: [body] });
    assert.equal(pedestrians.pedestrianCount, 0, "a vehicle is not also treated as a person");
    for (let frame = 0; frame < 150; frame++) {
      const previous = heading(car).along;
      traffic.update(0.1, axis === "x" ? 14 : 0, blockers);
      const movement = (heading(car).along - previous) * direction;
      assert.ok(movement >= -1e-8 && movement <= 1.51);
      const gap = ((axis === "x" ? body.x : body.z) - heading(car).along) * direction;
      assert.ok(gap >= 6.5 - 1e-8);
    }
    assert.ok(car.waiting);
    traffic.update(0.1, axis === "x" ? 14 : 0, []);
    assert.ok(car.speed > 0 && car.speed <= 0.35 + 1e-8);
  }
});
