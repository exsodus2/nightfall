import assert from "node:assert/strict";
import test from "node:test";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, ParkedCars, type CarPose } from "../src/city/driving.ts";
import { interiorPlaces, interiorWorld } from "../src/city/interiors.ts";
import { CityTraffic } from "../src/city/traffic.ts";
import { WALK_ARRIVAL_MAX_CARS, WALK_ARRIVAL_QUERY_RADIUS, WALK_ARRIVAL_RADIUS, canStandAtArrival, findWalkArrival, type WalkArrivalPoint } from "../src/city/walk-arrival.ts";
import { WalkingCollision } from "../src/city/walking-collision.ts";
import { CityWorld, PLAYER_RADIUS, WORLD_EDGE } from "../src/city/world.ts";
import { validPresenceTransition } from "../src/multiplayer/presence.ts";
import { checkMove, parsePose, type PoseMessage } from "../src/multiplayer/protocol.ts";

const openWorld = { canOccupy: () => true };
const halfLength = CAR_HALF_LENGTH + PLAYER_RADIUS, halfWidth = CAR_HALF_WIDTH + PLAYER_RADIUS;
const carReach = Math.hypot(halfLength, halfWidth);
const carPoint = (car: CarPose, side: number, along: number): WalkArrivalPoint => ({ x: car.x + Math.cos(car.yaw) * side + Math.sin(car.yaw) * along, z: car.z + Math.sin(car.yaw) * side - Math.cos(car.yaw) * along });
const poseAt = (point: WalkArrivalPoint, place = ""): PoseMessage => ({ ...point, y: 0, yaw: 0, pitch: 0, heading: 0, speed: 0, mode: "walk", car: 0, place });
const wirePoint = (point: WalkArrivalPoint): WalkArrivalPoint => ({ x: Math.round(point.x * 100) / 100, z: Math.round(point.z * 100) / 100 });

test("standalone arrival clearance uses the expanded rotated footprint, not overlap escape", () => {
  for (let index = 0; index < 40; index++) {
    const car = { x: 75, z: -90, yaw: index * Math.PI / 20 };
    assert.equal(canStandAtArrival(openWorld, car, [car]), false);
    for (const sign of [-1, 1]) {
      assert.equal(canStandAtArrival(openWorld, carPoint(car, sign * halfWidth, 0), [car]), true);
      assert.equal(canStandAtArrival(openWorld, carPoint(car, sign * (halfWidth - 0.0001), 0), [car]), false);
      assert.equal(canStandAtArrival(openWorld, carPoint(car, 0, sign * halfLength), [car]), true);
      assert.equal(canStandAtArrival(openWorld, carPoint(car, 0, sign * (halfLength - 0.0001)), [car]), false);
      assert.equal(canStandAtArrival(openWorld, carPoint(car, sign * (halfWidth - 0.01), halfLength - 0.01), [car]), false);
      assert.equal(canStandAtArrival(openWorld, carPoint(car, sign * (halfWidth + 0.01), halfLength - 0.01), [car]), true);
    }
  }
  const point = { x: 0, z: 0 }, car = { ...point, yaw: 0 }, walking = new WalkingCollision(openWorld, point);
  walking.setCars([car]);
  assert.equal(walking.canOccupy(0, 0), true);
  assert.equal(canStandAtArrival(openWorld, point, [car]), false);
  assert.equal(canStandAtArrival({ canOccupy: () => false }, { x: 20, z: 20 }), false);
});

test("arrival search retains clear anchors and searches nearby samples nearest-first", () => {
  const anchor = { x: 25, z: -15 };
  assert.deepEqual(findWalkArrival(openWorld, anchor), anchor);
  const obstructedWorld = { canOccupy: (x: number) => x >= anchor.x + 1.2 };
  assert.deepEqual(findWalkArrival(obstructedWorld, anchor), { x: anchor.x + 1.5, z: anchor.z });
  for (let index = 0; index < 24; index++) {
    const car = { ...anchor, yaw: index * Math.PI / 12 }, cars = [car];
    const arrival = findWalkArrival(openWorld, anchor, cars);
    assert.ok(arrival);
    assert.ok(Math.hypot(arrival.x - anchor.x, arrival.z - anchor.z) <= WALK_ARRIVAL_RADIUS);
    assert.equal(canStandAtArrival(openWorld, arrival, cars), true);
    assert.deepEqual(anchor, { x: 25, z: -15 });
    assert.deepEqual(cars, [car]);
  }
});

test("all-blocked searches fail in bounded work without returning an overlap or a distant fallback", () => {
  const anchor = { x: 0, z: 0 };
  const cars = [-3, 0, 3].flatMap(x => [-3, 0, 3].map(z => ({ x, z, yaw: 0 })));
  assert.equal(findWalkArrival(openWorld, anchor, cars), null);
  let visits = 0, furthest = 0;
  const noLocalGround = { canOccupy: (x: number, z: number) => { visits++; furthest = Math.max(furthest, Math.hypot(x, z)); return Math.hypot(x, z) > WALK_ARRIVAL_RADIUS; } };
  assert.equal(findWalkArrival(noLocalGround, anchor), null);
  assert.equal(visits, 129);
  assert.ok(furthest <= WALK_ARRIVAL_RADIUS);
});

test("car-query radius covers rotated corners beyond the long half-extent and strict query bounds", () => {
  assert.ok(carReach > halfLength);
  assert.ok(WALK_ARRIVAL_QUERY_RADIUS > WALK_ARRIVAL_RADIUS + carReach);
  const anchor = { x: 0, z: 0 }, onlyCandidate = { x: WALK_ARRIVAL_RADIUS - 0.02, z: 0 };
  const blocker = { x: onlyCandidate.x + carReach - 0.005, z: 0, yaw: Math.atan2(halfLength, halfWidth) };
  assert.ok(blocker.x > WALK_ARRIVAL_RADIUS + halfLength);
  const queried = [blocker].filter(car => Math.hypot(car.x - anchor.x, car.z - anchor.z) < WALK_ARRIVAL_QUERY_RADIUS);
  assert.equal(queried.length, 1);
  assert.equal(canStandAtArrival(openWorld, onlyCandidate, queried), false);
  const constrainedWorld = { canOccupy: (x: number, z: number) => x >= onlyCandidate.x - 0.001 && Math.abs(z) < 0.001 };
  assert.deepEqual(findWalkArrival(constrainedWorld, anchor), onlyCandidate);
  assert.equal(findWalkArrival(constrainedWorld, anchor, queried), null);
});

test("deduplication is deterministic, dense overflow fails closed, and distant cars do not fill the budget", () => {
  const anchor = { x: 0, z: 0 }, car = { ...anchor, yaw: 0 };
  const duplicates = Array.from({ length: 200 }, (_, index) => ({ ...car, yaw: index % 4 * Math.PI }));
  const expected = findWalkArrival(openWorld, anchor, [car]);
  assert.ok(expected);
  assert.deepEqual(findWalkArrival(openWorld, anchor, duplicates), expected);
  assert.deepEqual(findWalkArrival(openWorld, anchor, [...duplicates].reverse()), expected);
  const dense = Array.from({ length: WALK_ARRIVAL_MAX_CARS }, (_, index) => ({ x: index / 100, z: 0, yaw: 0 }));
  assert.ok(findWalkArrival(openWorld, anchor, dense));
  assert.deepEqual(findWalkArrival(openWorld, anchor, dense), findWalkArrival(openWorld, anchor, [...dense].reverse()));
  const overflow = [...dense, { x: 0.7, z: 0, yaw: 0 }];
  assert.equal(findWalkArrival(openWorld, anchor, overflow), null);
  assert.equal(findWalkArrival(openWorld, anchor, [...overflow].reverse()), null);
  assert.equal(canStandAtArrival(openWorld, { x: 3.95, z: 0 }, overflow), false);
  const distant = Array.from({ length: 200 }, (_, index) => ({ x: WALK_ARRIVAL_QUERY_RADIUS + 10 + index, z: 0, yaw: 0 }));
  assert.deepEqual(findWalkArrival(openWorld, anchor, [...distant, car]), expected);
});

test("malformed poses are ignored, invalid anchors fail, and world-edge corrections stay local", () => {
  const anchor = { x: 0, z: 0 };
  const malformed = [null, undefined, {}, { x: NaN, z: 0, yaw: 0 }, { x: 0, z: Infinity, yaw: 0 }, { x: 0, z: 0, yaw: NaN }, { x: "0", z: 0, yaw: 0 }] as unknown as CarPose[];
  assert.deepEqual(findWalkArrival(openWorld, anchor, malformed), anchor);
  assert.equal(canStandAtArrival(openWorld, anchor, malformed), true);
  assert.equal(findWalkArrival(openWorld, anchor, null as unknown as CarPose[]), null);
  assert.equal(canStandAtArrival(openWorld, anchor, null as unknown as CarPose[]), false);
  for (const point of [{ x: NaN, z: 0 }, { x: 0, z: Infinity }, null as unknown as WalkArrivalPoint]) {
    assert.equal(findWalkArrival(openWorld, point), null);
    assert.equal(canStandAtArrival(openWorld, point), false);
  }
  const world = new CityWorld();
  for (const sign of [-1, 1]) {
    const edge = { x: sign * (WORLD_EDGE - 2), z: 0 }, result = findWalkArrival(world, edge);
    assert.ok(result && world.canOccupy(result.x, result.z));
    assert.ok(Math.hypot(result.x - edge.x, result.z - edge.z) <= WALK_ARRIVAL_RADIUS);
    assert.equal(findWalkArrival(world, { x: sign * (WORLD_EDGE + 100), z: 0 }), null);
  }
});

test("generated parked-car centres and nearby traffic resolve to truly clear local ground", () => {
  const world = new CityWorld(), parked = new ParkedCars(world), traffic = new CityTraffic();
  const sample = parked.all().filter((_, index) => index % 11 === 0);
  assert.ok(sample.length > 80);
  for (const car of sample) {
    const cars = [...parked.nearby(car.x, car.z, WALK_ARRIVAL_QUERY_RADIUS), ...traffic.nearby(car.x, car.z, WALK_ARRIVAL_QUERY_RADIUS)];
    const result = findWalkArrival(world, car, cars);
    assert.ok(result, `local arrival beside parked car ${car.id}`);
    assert.ok(world.canOccupy(result.x, result.z));
    assert.equal(canStandAtArrival(world, result, cars), true);
    assert.ok(Math.hypot(result.x - car.x, result.z - car.z) <= WALK_ARRIVAL_RADIUS);
  }
});

test("all six canonical room exits can publish a safe exterior correction without changing the protocol", () => {
  const world = new CityWorld(), venues = interiorPlaces(world);
  assert.equal(venues.length, 6);
  for (const place of venues) {
    const blocker = { ...place.entrance, yaw: place.yaw + Math.PI / 2 };
    const corrected = findWalkArrival(world, place.entrance, [blocker]);
    assert.ok(corrected, place.id);
    assert.equal(canStandAtArrival(world, corrected, [blocker]), true);
    const interior = poseAt(interiorWorld(place, 0, place.depth / 2 - 2.2), place.id);
    const doorway = parsePose(poseAt(wirePoint(place.entrance))), exterior = parsePose(poseAt(wirePoint(corrected)));
    assert.ok(doorway && exterior);
    assert.equal(validPresenceTransition(interior, doorway), true);
    assert.equal(validPresenceTransition(interior, exterior), false, "the canonical doorway must still be published first");
    assert.equal(validPresenceTransition(doorway, exterior), true);
    const checked = checkMove(doorway, exterior, 0, 0);
    assert.equal(checked.corrected, false);
    assert.equal(checked.teleported, false);
    assert.deepEqual(checked.pose, exterior);
  }
});

test("outer-ring corrections preserve the zero-time server slack after centimetre wire rounding", () => {
  const anchor = { x: 113.0047, z: -237.0043 };
  for (let index = 0; index < 16; index++) {
    const angle = index * Math.PI / 8, forwardX = Math.cos(angle), forwardZ = Math.sin(angle);
    const constrainedWorld = { canOccupy: (x: number, z: number) => (x - anchor.x) * forwardX + (z - anchor.z) * forwardZ > 3.975 };
    const corrected = findWalkArrival(constrainedWorld, anchor);
    assert.ok(corrected);
    const before = parsePose(poseAt(wirePoint(anchor))), after = parsePose(poseAt(wirePoint(corrected)));
    assert.ok(before && after);
    assert.equal(checkMove(before, after, 0, 0).corrected, false);
    assert.ok(Math.hypot(corrected.x - anchor.x, corrected.z - anchor.z) < WALK_ARRIVAL_RADIUS);
  }
});
