import assert from "node:assert/strict";
import test from "node:test";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, ParkedCars, exitSpot, type CarPose } from "../src/city/driving.ts";
import { MAX_WALKING_CARS, WALKING_CAR_QUERY_RADIUS, WALKING_CAR_ROOF_CLEARANCE, WalkingCollision } from "../src/city/walking-collision.ts";
import { CityWorld, PLAYER_RADIUS, movePlayer, randomFor, type Player } from "../src/city/world.ts";

const openWorld = { canOccupy: () => true };
const halfWidth = CAR_HALF_WIDTH + PLAYER_RADIUS, halfLength = CAR_HALF_LENGTH + PLAYER_RADIUS;
const playerAt = (x = 0, z = 0, yaw = 0): Player => ({ x, z, yaw, pitch: 0, distance: 0 });
const toWorld = (car: CarPose, side: number, along: number) => ({ x: car.x + Math.cos(car.yaw) * side + Math.sin(car.yaw) * along, z: car.z + Math.sin(car.yaw) * side - Math.cos(car.yaw) * along });
const clearance = (car: CarPose, x: number, z: number) => {
  const relativeX = x - car.x, relativeZ = z - car.z;
  return Math.max(Math.abs(relativeX * Math.cos(car.yaw) + relativeZ * Math.sin(car.yaw)) - halfWidth, Math.abs(relativeX * Math.sin(car.yaw) - relativeZ * Math.cos(car.yaw)) - halfLength);
};

test("walking collision uses the drawn body dimensions plus the player's radius", () => {
  const person = playerAt(4, 0), collision = new WalkingCollision(openWorld, person);
  collision.setCars([{ x: 0, z: 0, yaw: 0 }]);
  assert.equal(collision.canOccupy(halfWidth, 0), true);
  assert.equal(collision.canOccupy(halfWidth - 0.001, 0), false);
  assert.equal(collision.canStep(0, -6, 0, -halfLength), true);
  assert.equal(collision.canStep(0, -6, 0, -halfLength + 0.001), false);
  assert.equal(collision.canStep(-4, 0, -halfWidth + 0.001, 0), false);
  assert.equal(collision.canStep(0, 6, 0, halfLength - 0.001), false);
});

test("rotated cars and opposite headings have identical solid footprints", () => {
  for (let index = 0; index < 120; index++) {
    const car = { x: 90 + randomFor(index, 2) * 10, z: -130 + randomFor(index, 3) * 10, yaw: randomFor(index, 4) * Math.PI * 2 };
    const person = playerAt(car.x, car.z), first = new WalkingCollision(openWorld, person), second = new WalkingCollision(openWorld, person);
    first.setCars([car]); second.setCars([{ ...car, yaw: car.yaw + Math.PI }]);
    for (const side of [-1, 1]) {
      const start = toWorld(car, side * (halfWidth + 1), 0), end = toWorld(car, side * (halfWidth - 0.02), 0);
      assert.equal(first.canStep(start.x, start.z, end.x, end.z), false);
      assert.equal(second.canStep(start.x, start.z, end.x, end.z), false);
    }
    for (let probe = 0; probe < 8; probe++) {
      const start = toWorld(car, randomFor(index, probe, 5) * 10 - 5, randomFor(index, probe, 6) * 12 - 6);
      const end = toWorld(car, randomFor(index, probe, 7) * 10 - 5, randomFor(index, probe, 8) * 12 - 6);
      assert.equal(first.canStep(start.x, start.z, end.x, end.z), second.canStep(start.x, start.z, end.x, end.z));
    }
  }
});

test("swept tests block diagonal corner cuts and permit exact edge sliding", () => {
  const collision = new WalkingCollision(openWorld, playerAt());
  for (const yaw of [0, 0.37, Math.PI / 2, Math.PI * 1.35]) {
    const car = { x: 0, z: 0, yaw }; collision.setCars([car]);
    const first = toWorld(car, halfWidth + 0.1, halfLength - 0.2), second = toWorld(car, halfWidth - 0.2, halfLength + 0.1);
    assert.ok(clearance(car, first.x, first.z) > 0 && clearance(car, second.x, second.z) > 0);
    assert.equal(collision.canStep(first.x, first.z, second.x, second.z), false);
    const edgeStart = toWorld(car, halfWidth, -halfLength - 1), edgeEnd = toWorld(car, halfWidth, halfLength + 1);
    assert.equal(collision.canStep(edgeStart.x, edgeStart.z, edgeEnd.x, edgeEnd.z), true);
    const tangentStart = toWorld(car, halfWidth + 0.2, halfLength - 0.2), tangentEnd = toWorld(car, halfWidth - 0.2, halfLength + 0.2);
    assert.equal(collision.canStep(tangentStart.x, tangentStart.z, tangentEnd.x, tangentEnd.z), true);
  }
});

test("long-frame walking and an un-substepped dodge cannot tunnel through a car", () => {
  const person = playerAt(-7, 0, Math.PI / 2), collision = new WalkingCollision(openWorld, person);
  const car = { x: 0, z: 0, yaw: 0 }; collision.setCars([car]);
  assert.equal(collision.canStep(-10, 0, 10, 0), false);
  for (let frame = 0; frame < 20; frame++) {
    const previous = person.x;
    movePlayer(collision, person, 1, 0, true, 9);
    assert.ok(person.x - previous <= 1.1 + 1e-9);
    assert.ok(clearance(car, person.x, person.z) >= -1e-8);
  }
  assert.ok(person.x <= -halfWidth && person.x > -halfWidth - 0.4);
});

test("an overlapping car permits escape but cannot be crossed to its opposite side", () => {
  const person = playerAt(1, 0), collision = new WalkingCollision(openWorld, person);
  collision.setCars([{ x: 0, z: 0, yaw: 0 }]);
  assert.equal(collision.canOccupy(1.2, 0), true);
  assert.equal(collision.canOccupy(0.8, 0), false);
  assert.equal(collision.canOccupy(-5, 0), false);
  assert.equal(collision.canOccupy(1, -0.2), true);
  person.x = 0; person.z = -1;
  assert.equal(collision.canOccupy(0, -1.2), true);
  assert.equal(collision.canOccupy(0, -0.8), false);
  assert.equal(collision.canOccupy(0, 5), false);
  person.z = 0;
  for (let direction = 0; direction < 16; direction++) {
    const angle = direction * Math.PI / 8;
    assert.equal(collision.canOccupy(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2), true, "the exact center has an escape in every direction");
  }
});

test("accepted overlap escapes never worsen penetration anywhere on their segment", () => {
  let accepted = 0;
  for (let index = 0; index < 1500; index++) {
    const car = { x: 70, z: 90, yaw: randomFor(index, 9) * Math.PI * 2 };
    const start = toWorld(car, (randomFor(index, 10) * 2 - 1) * halfWidth * 0.99, (randomFor(index, 11) * 2 - 1) * halfLength * 0.99);
    const person = playerAt(start.x, start.z), collision = new WalkingCollision(openWorld, person); collision.setCars([car]);
    const direction = randomFor(index, 12) * Math.PI * 2, length = 0.1 + randomFor(index, 13) * 5;
    const end = { x: start.x + Math.cos(direction) * length, z: start.z + Math.sin(direction) * length };
    const cardinalMoves = [[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]];
    assert.ok(cardinalMoves.some(([stepX, stepZ]) => collision.canOccupy(start.x + stepX, start.z + stepZ)), "a valid escape always exists");
    if (!collision.canOccupy(end.x, end.z)) continue;
    accepted++;
    let previous = clearance(car, start.x, start.z);
    for (let sample = 1; sample <= 24; sample++) {
      const current = clearance(car, start.x + (end.x - start.x) * sample / 24, start.z + (end.z - start.z) * sample / 24);
      assert.ok(current >= previous - 1e-7);
      previous = current;
    }
  }
  assert.ok(accepted > 400);
});

test("live-position walking escapes overlaps at arbitrary car rotations", () => {
  for (let index = 0; index < 100; index++) {
    const car = { x: 0, z: 0, yaw: randomFor(index, 14) * Math.PI * 2 };
    const side = (randomFor(index, 15) * 2 - 1) * halfWidth * 0.8;
    const along = (randomFor(index, 16) * 2 - 1) * halfLength * 0.8;
    const start = toWorld(car, side, along), sign = side < 0 ? -1 : 1;
    const person = playerAt(start.x, start.z, car.yaw + sign * Math.PI / 2), collision = new WalkingCollision(openWorld, person);
    collision.setCars([car]);
    for (let frame = 0; frame < 25 && clearance(car, person.x, person.z) < 0; frame++) movePlayer(collision, person, 1, 0, false, 0.1);
    assert.ok(clearance(car, person.x, person.z) >= -1e-8, `escaped rotated car ${index}`);
  }
});

test("nearest candidate retention is capped, deterministic and ignores malformed or duplicate cars", () => {
  const cars: CarPose[] = Array.from({ length: 70 }, (_, index) => ({ x: 4 + index / 10, z: index % 3, yaw: index / 10 }));
  cars.push({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: Math.PI }, { x: NaN, z: 0, yaw: 0 }, { x: WALKING_CAR_QUERY_RADIUS + 10, z: 0, yaw: 0 });
  const person = playerAt(), first = new WalkingCollision(openWorld, person), second = new WalkingCollision(openWorld, person);
  first.setCars(cars); second.setCars([...cars].reverse());
  assert.equal(first.carCount, MAX_WALKING_CARS); assert.equal(second.carCount, MAX_WALKING_CARS);
  assert.equal(first.canStep(-5, 0, 0, 0), false, "last-listed nearest car is retained");
  for (let index = 0; index < 100; index++) {
    const x = randomFor(index, 17) * 16 - 8, z = randomFor(index, 18) * 16 - 8;
    assert.equal(first.canStep(-10, -10, x, z), second.canStep(-10, -10, x, z));
  }
  first.setCars([{ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: Math.PI }]);
  assert.equal(first.carCount, 1);
  first.setCars([]); assert.equal(first.carCount, 0); assert.equal(first.canStep(-5, 0, 5, 0), true);
});

test("roof clearance affects cars only and never bypasses fixed world solids", () => {
  const world = { canOccupy: (x: number) => x < 5 }, person = playerAt(-5, 0), collision = new WalkingCollision(world, person);
  const cars = [{ x: 0, z: 0, yaw: 0 }];
  collision.setCars(cars, WALKING_CAR_ROOF_CLEARANCE - 0.01);
  assert.equal(collision.canOccupy(4, 0), false);
  collision.setCars(cars, WALKING_CAR_ROOF_CLEARANCE);
  assert.equal(collision.canOccupy(4, 0), true);
  assert.equal(collision.canOccupy(6, 0), false);
  assert.equal(collision.canOccupy(NaN, 0), false);
  collision.setCars(cars, NaN);
  assert.equal(collision.canOccupy(4, 0), false);
  person.x = 0;
  assert.equal(collision.canOccupy(6, 0), false, "overlap escape cannot ignore buildings");
});

test("escaping an overlapping car cannot enter another vehicle", () => {
  const person = playerAt(1, 0), collision = new WalkingCollision(openWorld, person);
  collision.setCars([{ x: 0, z: 0, yaw: 0 }, { x: 4, z: 0, yaw: 0 }]);
  assert.equal(collision.canOccupy(1.4, 0), true);
  assert.equal(collision.canOccupy(2.4, 0), false);
  assert.equal(collision.canOccupy(1, -0.4), true);
  person.x = 7;
  collision.setCars([{ x: 6, z: 0, yaw: Math.PI / 4 }]);
  const options = [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]];
  assert.ok(options.some(([stepX, stepZ]) => collision.canOccupy(person.x + stepX, person.z + stepZ)), "a traffic car moving over the player does not permanently trap them");
});

test("real parked cars remain solid while every existing driver exit stays usable", () => {
  const world = new CityWorld(), parked = new ParkedCars(world);
  let checked = 0;
  for (const car of parked.all().filter((_, index) => index % 7 === 0)) {
    const exit = exitSpot(world, car), person = playerAt(exit.x, exit.z), collision = new WalkingCollision(world, person);
    collision.setCars(parked.nearby(person.x, person.z, 12));
    assert.ok(clearance(car, exit.x, exit.z) >= -1e-8);
    assert.equal(collision.canOccupy(exit.x, exit.z), true);
    assert.equal(collision.canOccupy(car.x, car.z), false);
    checked++;
  }
  assert.ok(checked > 100);
});
