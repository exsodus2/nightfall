import assert from "node:assert/strict";
import test from "node:test";
import { exitSpot, ParkedCars } from "../src/city/driving.ts";
import { interiorPlaces } from "../src/city/interiors.ts";
import { advanceJourney, createJourney, groundRoute, safeLanding, WALK_HEIGHT, type Waypoint } from "../src/city/locomotion.ts";
import { localToWorld, STATIONS } from "../src/city/metro.ts";
import { CityWorld, DISTRICTS, SPAWN, WORLD_EDGE } from "../src/city/world.ts";

const world = new CityWorld();
const source = { x: -36, y: WALK_HEIGHT, z: 36 };
const destination = { x: DISTRICTS[4].x, y: WALK_HEIGHT, z: DISTRICTS[4].z };
const playerAt = (point: Waypoint) => ({ x: point.x, z: point.z, yaw: 0, pitch: 0, distance: 0 });

function routeIsClear(points: readonly Waypoint[], collision: Pick<CityWorld, "canOccupy"> = world, spacing = 0.0625): boolean {
  if (!points.every(point => collision.canOccupy(point.x, point.z))) return false;
  for (let segment = 1; segment < points.length; segment++) {
    const first = points[segment - 1], last = points[segment];
    const steps = Math.ceil(Math.hypot(last.x - first.x, last.z - first.z) / spacing);
    for (let step = 1; step < steps; step++) {
      const progress = step / steps;
      if (!collision.canOccupy(first.x + (last.x - first.x) * progress, first.z + (last.z - first.z) * progress)) return false;
    }
  }
  return true;
}

test("taxi pickup rejects the facade-cutting nearest-street connector", () => {
  assert.ok(world.canOccupy(source.x, source.z));
  assert.equal(world.canOccupy(-36, 37.5), false);
  const legacy = groundRoute(source, destination);
  assert.ok(legacy);
  assert.equal(routeIsClear(legacy), false);
  const route = groundRoute(source, destination, world);
  assert.ok(route);
  assert.deepEqual(route[0], source);
  assert.deepEqual(route[route.length - 1], destination);
  assert.ok(routeIsClear(route));
  assert.ok(route.every(point => point.y === WALK_HEIGHT));
  assert.ok(route.slice(1).every((point, index) => point.x === route[index].x || point.z === route[index].z));
});

test("dropoff connectors receive the same collision checks as pickups", () => {
  const route = groundRoute(destination, { ...source, y: 200 }, world);
  assert.ok(route);
  assert.deepEqual(route[0], destination);
  assert.deepEqual(route[route.length - 1], source);
  assert.ok(routeIsClear(route));
});

test("a bounded one-bend connector reaches the road from a world-edge alley", () => {
  const edge = { x: -756, y: WALK_HEIGHT, z: 36 };
  assert.ok(world.canOccupy(edge.x, edge.z));
  for (const endpoint of [{ ...edge, x: -768 }, { ...edge, x: -704 }, { ...edge, z: 0 }, { ...edge, z: 64 }]) {
    assert.equal(routeIsClear([edge, endpoint]), false);
  }
  const route = groundRoute(edge, destination, world);
  assert.ok(route);
  assert.ok(routeIsClear(route));
  assert.ok(route.every(point => Math.abs(point.x) <= WORLD_EDGE - 3 && Math.abs(point.z) <= WORLD_EDGE - 3));
  assert.ok(route.some(point => point.x === -760 && point.z === 36));
});

test("actual taxi frames never enter buildings at fast, slow, or irregular frame rates", () => {
  for (const frameTimes of [[1 / 30], [1 / 120], [1 / 60, 0.09, 0.15, 0.5]]) {
    const journey = createJourney("taxi", playerAt(source), WALK_HEIGHT, 4, world);
    assert.ok(journey);
    const position = { ...source };
    let done = false;
    for (let frame = 0; frame < 30000 && !done; frame++) {
      const previous = { ...position }, elapsed = frameTimes[frame % frameTimes.length];
      done = advanceJourney(journey, position, elapsed).done;
      assert.ok(world.canOccupy(position.x, position.z), `Blocked taxi frame at ${position.x}, ${position.z}`);
      assert.ok(Math.hypot(position.x - previous.x, position.z - previous.z) <= 29 * Math.min(elapsed, 0.15) + 1e-8);
      assert.equal(position.y, WALK_HEIGHT);
    }
    assert.ok(done);
    assert.ok(Math.hypot(position.x - destination.x, position.z - destination.z) < 0.001);
  }
});

test("venues, station approaches, and parked-car exits have clear pickup and dropoff paths", () => {
  const approaches = STATIONS.map(station => {
    const lift = localToWorld(station, 9, 20);
    return safeLanding(world, lift.x, lift.z);
  });
  const exits = new ParkedCars(world).all().filter((_, index) => index % 83 === 0).slice(0, 20).map(car => exitSpot(world, car));
  const points = [...interiorPlaces(world).map(place => place.entrance), ...approaches, ...exits];
  assert.equal(interiorPlaces(world).length, 6);
  for (const [index, point] of points.entries()) {
    const start = { x: point.x, z: point.z, y: WALK_HEIGHT };
    const end = { x: DISTRICTS[index % DISTRICTS.length].x, z: DISTRICTS[index % DISTRICTS.length].z, y: WALK_HEIGHT };
    for (const [departure, arrival] of [[start, end], [end, start]]) {
      const route = groundRoute(departure, arrival, world);
      assert.ok(route, `No route at ${point.x}, ${point.z}`);
      assert.ok(routeIsClear(route), `Blocked route at ${point.x}, ${point.z}`);
    }
  }
});

test("already-clear legacy road-grid routes stay unchanged", () => {
  for (const start of DISTRICTS) for (const end of DISTRICTS) {
    const departure = { x: start.x, z: start.z, y: WALK_HEIGHT }, arrival = { x: end.x, z: end.z, y: WALK_HEIGHT };
    assert.deepEqual(groundRoute(departure, arrival, world), groundRoute(departure, arrival));
  }
});

test("taxi planning fails closed at disconnected legal sources and blocked endpoints", () => {
  for (const point of [{ x: -540, y: WALK_HEIGHT, z: 212 }, { x: -412, y: WALK_HEIGHT, z: 228 }]) {
    assert.ok(world.canOccupy(point.x, point.z));
    assert.equal(groundRoute(point, destination, world), null);
    assert.equal(groundRoute(destination, point, world), null);
    assert.equal(createJourney("taxi", playerAt(point), WALK_HEIGHT, 4, world), null);
  }
  const blocked = { x: -36, y: WALK_HEIGHT, z: 37.5 };
  assert.equal(groundRoute(blocked, destination, world), null);
  assert.equal(groundRoute(destination, blocked, world), null);
});

test("fixed connector candidates have bounded work and never fall back through obstacles", () => {
  let queries = 0;
  const islands = { canOccupy: (x: number, z: number) => {
    queries++;
    return Math.hypot(x - source.x, z - source.z) < 0.1 || Math.hypot(x - destination.x, z - destination.z) < 0.1;
  } };
  assert.equal(groundRoute(source, destination, islands), null);
  assert.ok(queries < 1000, `Unexpected route-planning work: ${queries}`);
  assert.ok(queries > 2);
});

test("planning validates malformed input, preserves inputs, and makes deterministic paths", () => {
  for (const coordinate of [NaN, Infinity, -Infinity, Number.MAX_VALUE, WORLD_EDGE + 1]) {
    for (const axis of ["x", "z"] as const) {
      assert.equal(groundRoute({ ...source, [axis]: coordinate }, destination, world), null);
      assert.equal(groundRoute(source, { ...destination, [axis]: coordinate }, world), null);
    }
  }
  for (const height of [NaN, Infinity, -Infinity]) {
    assert.equal(groundRoute({ ...source, y: height }, destination, world), null);
    assert.equal(createJourney("taxi", playerAt(source), height, 4, world), null);
    assert.equal(createJourney("sky", playerAt(source), height, 4, world), null);
  }
  const frozenStart = Object.freeze({ ...source }), frozenEnd = Object.freeze({ ...destination });
  const first = groundRoute(frozenStart, frozenEnd, world);
  assert.ok(first);
  assert.deepEqual(groundRoute(frozenStart, frozenEnd, world), first);
  first[0].x++;
  assert.deepEqual(frozenStart, source);
  assert.deepEqual(frozenEnd, destination);
});

test("clearance is the supplied static player footprint, not a full taxi-body sweep", () => {
  const corridor = { canOccupy: (x: number, z: number) => Math.abs(x) < 0.1 && z >= 0 && z <= 64 };
  const route = groundRoute({ x: 0, y: WALK_HEIGHT, z: 0 }, { x: 0, y: WALK_HEIGHT, z: 64 }, corridor);
  assert.ok(route);
  assert.ok(routeIsClear(route, corridor));
});

test("sky journeys keep their original elevated path and do not run ground routing", () => {
  let queries = 0;
  const blockedWorld = { canOccupy: () => { queries++; return false; } };
  const player = { ...SPAWN, distance: 0 };
  const original = createJourney("sky", player, 47, 4);
  const withGroundWorld = createJourney("sky", player, 47, 4, blockedWorld);
  assert.ok(original);
  assert.deepEqual(withGroundWorld, original);
  assert.deepEqual(original.points.map(point => point.y), [47, 230, 230, WALK_HEIGHT]);
  assert.equal(queries, 0);
});
