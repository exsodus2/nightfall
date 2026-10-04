import assert from "node:assert/strict";
import test from "node:test";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from "../src/city/driving.ts";
import { MAX_ROAD_PEDESTRIANS, ROAD_AWARENESS_RADIUS, ROAD_PEDESTRIAN_MARGIN, ROAD_RESIDENT_RADIUS, RoadAwareness, roadLevelPedestrian, type RoadPlayer, type RoadResident } from "../src/city/road-awareness.ts";
import { CityTraffic, MAX_TRAFFIC_STEP, laneLine, stopDistance, type Vehicle } from "../src/city/traffic.ts";
import { WALKING_CAR_ROOF_CLEARANCE } from "../src/city/walking-collision.ts";
import { PLAYER_RADIUS } from "../src/city/world.ts";

const playerExtent = CAR_HALF_LENGTH + PLAYER_RADIUS + ROAD_PEDESTRIAN_MARGIN;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const snapshot = (traffic: CityTraffic) => traffic.nearby(0, 0, 2000).map(car => ({ ...car }));
const heading = (car: Vehicle): { axis: "x" | "z"; direction: number; along: number } => Math.abs(Math.sin(car.yaw)) > 0.5
  ? { axis: "x", direction: Math.sign(Math.sin(car.yaw)), along: car.x }
  : { axis: "z", direction: Math.sign(-Math.cos(car.yaw)), along: car.z };
const forward = (car: Vehicle, distance: number) => ({ x: car.x + Math.sin(car.yaw) * distance, z: car.z - Math.cos(car.yaw) * distance });
const openLaneCar = (traffic: CityTraffic, axis: "x" | "z" = "z", direction = 1): Vehicle => {
  const car = traffic.nearby(0, 0, 330).find(candidate => {
    const lane = heading(candidate);
    return lane.axis === axis && lane.direction === direction && stopDistance(axis, direction, lane.along) > 25 && roadLevelPedestrian(forward(candidate, 16));
  });
  assert.ok(car, `an open ${axis} lane in direction ${direction}`);
  return car;
};
const assertSeparated = (cars: readonly Vehicle[]) => {
  for (let index = 0; index < cars.length; index++) {
    const car = cars[index], alongX = heading(car).axis === "x";
    const halfX = alongX ? CAR_HALF_LENGTH : CAR_HALF_WIDTH, halfZ = alongX ? CAR_HALF_WIDTH : CAR_HALF_LENGTH;
    for (let otherIndex = index + 1; otherIndex < cars.length; otherIndex++) {
      const other = cars[otherIndex], otherAlongX = heading(other).axis === "x";
      const otherHalfX = otherAlongX ? CAR_HALF_LENGTH : CAR_HALF_WIDTH, otherHalfZ = otherAlongX ? CAR_HALF_WIDTH : CAR_HALF_LENGTH;
      assert.ok(Math.abs(car.x - other.x) >= halfX + otherHalfX - 1e-8 || Math.abs(car.z - other.z) >= halfZ + otherHalfZ - 1e-8, `cars ${car.id} and ${other.id} overlap`);
    }
  }
};

test("road awareness ignores kerbs, pavements, park promenades, interiors and airborne travellers", () => {
  for (const x of [64, 67, 70.19, -64, -70.19, 12.39, -12.39]) assert.equal(roadLevelPedestrian({ x, z: 28 }), true, `road x=${x}`);
  for (const x of [70.2, 70.4, 71.2, -70.2, 12.4, -12.4, 14]) assert.equal(roadLevelPedestrian({ x, z: 28 }), false, `kerb or pavement x=${x}`);
  assert.equal(roadLevelPedestrian({ x: -512, z: 256 }), false);
  assert.equal(roadLevelPedestrian({ x: 67, z: 28, y: 1.4, mode: "walk" }), true);
  assert.equal(roadLevelPedestrian({ x: 67, z: 28, y: WALKING_CAR_ROOF_CLEARANCE - 0.001 }), true);
  for (const y of [WALKING_CAR_ROOF_CLEARANCE, 28.9, 90, NaN, Infinity, -1]) assert.equal(roadLevelPedestrian({ x: 67, z: 28, y }), false);
  for (const mode of ["drive", "fly", "metro", "taxi", "lift"]) assert.equal(roadLevelPedestrian({ x: 67, z: 28, mode }), false);
  assert.equal(roadLevelPedestrian({ x: 67, z: 28, place: "blue-hour-tea" }), false);
  for (const point of [{ x: NaN, z: 28 }, { x: 67, z: Infinity }]) assert.equal(roadLevelPedestrian(point), false);
});

test("pedestrian clearance is symmetric for both street axes, directions and avenue lanes", () => {
  const awareness = new RoadAwareness();
  for (const axis of ["x", "z"] as const) for (const direction of [-1, 1]) for (const street of [-1, 0, 1]) {
    const line = laneLine(axis, street, direction), along = 160;
    const point = axis === "x" ? { x: along + direction * 20, z: line } : { x: line, z: along + direction * 20 };
    awareness.set({ eye: point, players: [point] });
    awareness.selectLane(axis, line);
    close(awareness.clearance(along, direction), 20 - playerExtent);
    close(awareness.clearance(along + direction * 18, direction), 0);
    close(awareness.clearance(along + direction * 21, direction), 0);
    assert.equal(awareness.clearance(along + direction * 26, direction), Infinity);
    assert.equal(awareness.clearance(along, -direction), Infinity);
    awareness.selectLane(axis, line + 10);
    assert.equal(awareness.clearance(along, direction), Infinity);
  }
  awareness.selectLane("z", NaN);
  assert.equal(awareness.clearance(0, 1), Infinity);
  assert.equal(awareness.clearance(NaN, 1), Infinity);
  assert.equal(awareness.clearance(0, 0), Infinity);
});

test("only admitted crossing residents enter the buffer, with smaller extents than players", () => {
  const awareness = new RoadAwareness(), eye = { x: 67, z: 20 };
  const resident: RoadResident = { ...eye, y: 0, next: 0, path: [{ road: true, crossing: false }] };
  for (const rejected of [
    { ...resident, path: [{ road: true, crossing: true }] },
    { ...resident, path: [{ road: false, crossing: false }] },
    { ...resident, path: [] },
    { ...resident, next: -1 },
    { ...resident, next: NaN },
    { ...resident, y: 28.9 },
  ]) {
    awareness.set({ eye, residents: [rejected] });
    assert.equal(awareness.pedestrianCount, 0);
  }
  awareness.set({ eye, residents: [resident] });
  assert.equal(awareness.pedestrianCount, 1);
  awareness.selectLane("z", 67);
  close(awareness.clearance(0, 1), 20 - CAR_HALF_LENGTH - ROAD_RESIDENT_RADIUS - ROAD_PEDESTRIAN_MARGIN);
  awareness.set({ eye, players: [eye], residents: [resident] });
  assert.equal(awareness.pedestrianCount, 1);
  awareness.selectLane("z", 67);
  close(awareness.clearance(0, 1), 20 - playerExtent);
});

test("candidate retention is bounded, deterministic, nearby and prioritizes real players", () => {
  const players: RoadPlayer[] = Array.from({ length: 180 }, (_, index) => ({ x: 67, z: index - 90 }));
  const eye = { x: 67, z: 0 }, first = new RoadAwareness(), reversed = new RoadAwareness();
  players.push({ x: 67, z: 0 }, { x: 67, z: NaN }, { x: 67, z: ROAD_AWARENESS_RADIUS + 1 });
  first.set({ eye, players }); reversed.set({ eye, players: [...players].reverse() });
  assert.equal(first.pedestrianCount, MAX_ROAD_PEDESTRIANS);
  assert.equal(reversed.pedestrianCount, MAX_ROAD_PEDESTRIANS);
  first.selectLane("z", 67); reversed.selectLane("z", 67);
  for (let along = -150; along < 150; along += 0.7) for (const direction of [-1, 1]) assert.equal(first.clearance(along, direction), reversed.clearance(along, direction));
  const residents = players.map(player => ({ x: player.x, z: player.z, y: 0, next: 0, path: [{ road: true, crossing: false }] }));
  first.set({ eye, players: [{ x: 61, z: 100 }], residents });
  first.selectLane("z", 61);
  close(first.clearance(80, 1), 20 - playerExtent);
  first.set({ eye, players: [{ x: 67, z: ROAD_AWARENESS_RADIUS + 1 }] });
  assert.equal(first.pedestrianCount, 0);
  first.set({ eye: { x: NaN, z: 0 }, players });
  assert.equal(first.pedestrianCount, 0);
});

test("traffic retains the old car-blocker API and ignores invalid timing and candidate data", () => {
  const first = new CityTraffic(), second = new CityTraffic();
  const blockers = [{ x: 67, z: 40 }];
  for (let frame = 0; frame < 100; frame++) {
    first.update(0.1, frame * 0.1, blockers);
    second.update(0.1, frame * 0.1, [...blockers, { x: 67, z: Infinity }, { x: NaN, z: 0 }], { eye: { x: 0, z: 0 }, players: [{ x: NaN, z: 0 }] });
  }
  assert.deepEqual(snapshot(first), snapshot(second));
  const before = snapshot(first);
  for (const dt of [NaN, Infinity, -1, 0]) first.update(dt, 0);
  first.update(0.1, NaN); first.update(0.1, Infinity);
  assert.deepEqual(snapshot(first), before);
  const long = new CityTraffic(), bounded = new CityTraffic();
  long.update(100, 0); bounded.update(MAX_TRAFFIC_STEP, 0);
  assert.deepEqual(snapshot(long), snapshot(bounded));
});

test("traffic brakes for walking players in every lane without reversing, then releases smoothly", () => {
  for (const axis of ["x", "z"] as const) for (const direction of [-1, 1]) {
    const traffic = new CityTraffic(), car = openLaneCar(traffic, axis, direction), player = forward(car, 16);
    const signalTime = axis === "x" ? 14 : 0;
    let stopped = false;
    for (let frame = 0; frame < 150; frame++) {
      const before = heading(car).along;
      traffic.update(0.1, signalTime, [], { eye: player, players: [{ ...player, y: 1.3, mode: "walk" }] });
      const movement = (heading(car).along - before) * direction;
      assert.ok(movement >= -1e-8 && movement <= 1.51, "forward-only bounded movement");
      const distance = (axis === "x" ? player.x - car.x : player.z - car.z) * direction;
      assert.ok(distance >= playerExtent - 1e-8, "the car does not enter the player's footprint");
      stopped ||= car.waiting;
    }
    assert.ok(stopped && car.waiting);
    const held = { x: car.x, z: car.z };
    traffic.update(0.1, signalTime);
    assert.ok(car.speed > 0 && car.speed <= 0.35 + 1e-8, "release uses the normal acceleration limit");
    assert.ok(Math.hypot(car.x - held.x, car.z - held.z) > 0);
  }
});

test("a person appearing inside the front bumper stops motion without a backward correction", () => {
  const traffic = new CityTraffic(), car = openLaneCar(traffic), person = forward(car, 1.5), previous = { x: car.x, z: car.z };
  traffic.update(0.15, 0, [], { eye: person, players: [person] });
  close(car.x, previous.x); close(car.z, previous.z);
  assert.equal(car.speed, 0); assert.equal(car.waiting, true);
  for (let frame = 0; frame < 15; frame++) traffic.update(0.15, 0, [], { eye: person, players: [person] });
  close(car.x, previous.x); close(car.z, previous.z);
  traffic.update(0.1, 0);
  assert.ok(car.speed > 0 && car.speed <= 0.35 + 1e-8);
});

test("pedestrians do not acquire the larger following distance reserved for player cars", () => {
  const pedestrians = new CityTraffic(), vehicles = new CityTraffic();
  const firstCar = openLaneCar(pedestrians), secondCar = vehicles.nearby(0, 0, 330).find(car => car.id === firstCar.id);
  assert.ok(secondCar);
  const blocker = forward(firstCar, 16);
  for (let frame = 0; frame < 160; frame++) {
    pedestrians.update(0.1, 0, [], { eye: blocker, players: [blocker] });
    vehicles.update(0.1, 0, [blocker]);
  }
  assert.ok(firstCar.waiting && secondCar.waiting);
  assert.ok(firstCar.z - secondCar.z > 2, "pedestrians are not treated as six-metre cars");
});

test("a pedestrian-held junction blocks perpendicular arrivals and drains without deadlock", () => {
  const traffic = new CityTraffic();
  let held: Vehicle | undefined;
  for (let frame = 0; frame < 200 && !held; frame++) {
    traffic.update(0.05, 0);
    held = traffic.nearby(128, 128, 150).find(car => {
      const lane = heading(car);
      return lane.axis === "z" && lane.direction === 1 && Math.abs(car.x) > 20 && Math.abs(car.z - Math.round(car.z / 64) * 64) < 1;
    });
  }
  assert.ok(held, "a car actually enters the junction");
  const junction = { x: Math.round(held.x / 64) * 64, z: Math.round(held.z / 64) * 64 };
  const person = forward(held, 1.5), heldPosition = { x: held.x, z: held.z };
  let waitingAcross = false;
  for (let frame = 0; frame < 260; frame++) {
    traffic.update(0.05, 14, [], { eye: person, players: [person] });
    close(held.x, heldPosition.x); close(held.z, heldPosition.z);
    const cars = traffic.nearby(junction.x, junction.z, 80);
    assertSeparated(cars);
    waitingAcross ||= cars.some(car => heading(car).axis === "x" && Math.abs(car.z - junction.z) < 6 && car.waiting && Math.abs(car.x - junction.x) < 20);
  }
  assert.ok(waitingAcross, "perpendicular green traffic waits outside the occupied junction");
  let crossed = false;
  for (let frame = 0; frame < 360; frame++) {
    traffic.update(0.05, 14);
    const cars = traffic.nearby(junction.x, junction.z, 80);
    assertSeparated(cars);
    crossed ||= cars.some(car => heading(car).axis === "x" && Math.abs(car.z - junction.z) < 6 && Math.abs(car.x - junction.x) < 1);
  }
  assert.ok(held.z > heldPosition.z + 18, "the previously committed car clears even though its light is now red");
  assert.ok(crossed, "perpendicular traffic resumes after clearance");
});
