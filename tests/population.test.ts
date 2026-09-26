import assert from "node:assert/strict";
import test from "node:test";
import { CityPopulation, pavementPoint, pavementRoute, pedestrianGreen, trafficGreen } from "../src/city/people.ts";
import { CityWorld } from "../src/city/world.ts";
import { BENCH, PLATFORM_HEIGHT, SEATS, localToWorld, seatedYaw, trainAt } from "../src/city/metro.ts";
import { AVENUE_STOP_LINE, CityTraffic, STOP_LINE, spawnAlong, stopDistance } from "../src/city/traffic.ts";

test("pavement routes stay outside building footprints and cross only at corners", () => {
  const world = new CityWorld();
  for (let bx = -3; bx <= 3; bx++) for (let bz = -3; bz <= 3; bz++) {
    const start = { bx, bz, corner: 0 }, goal = { bx: bx + 2, bz: bz - 2, corner: 2 };
    let previous = pavementPoint(start);
    const route = pavementRoute(start, goal);
    assert.ok(route.length > 0);
    for (const point of route) {
      assert.ok(Math.abs(point.x - previous.x) < 0.001 || Math.abs(point.z - previous.z) < 0.001);
      for (let i = 0; i <= 20; i++) {
        const x = previous.x + (point.x - previous.x) * i / 20, z = previous.z + (point.z - previous.z) * i / 20;
        assert.ok(!world.buildings.some(b => Math.abs(x - b.x) < b.width / 2 && Math.abs(z - b.z) < b.depth / 2), `Blocked route at ${x},${z}`);
      }
      previous = point;
    }
    assert.deepEqual(previous.x, pavementPoint(goal).x);
    assert.deepEqual(previous.z, pavementPoint(goal).z);
  }
});

test("crossing phases leave time to clear the widest road before traffic resumes", () => {
  for (let time = 0; time < 28; time += 0.1) for (const axis of ["x", "z"] as const) {
    if (!pedestrianGreen(axis, time)) continue;
    const duration = (axis === "x" ? 28 : 14.4) / 2.8;
    for (let elapsed = 0; elapsed <= duration; elapsed += 0.1) assert.equal(trafficGreen(axis === "x" ? "z" : "x", time + elapsed), false);
  }
});

test("commuters board open doors, ride, alight, use lifts and return for another trip", () => {
  const population = new CityPopulation(new CityWorld()), seen = new Set<string>();
  // Walkers are outside this camera's simulation neighborhood; commuters run globally.
  for (let time = 0; time < 420; time += 0.1) {
    const previous = population.commuters.map(p => ({ train: p.train, u: p.u, x: p.x, z: p.z, state: p.state }));
    population.update(0.1, time, time, { x: 9999, z: 9999 });
    population.commuters.forEach((p, i) => {
      seen.add(p.state);
      assert.ok(p.y >= 0 && p.y <= PLATFORM_HEIGHT);
      assert.ok(Math.hypot(p.x - previous[i].x, p.z - previous[i].z) < 4.1, "Commuters must move continuously");
      if (previous[i].train === null && p.train !== null) {
        const train = trainAt(time, p.train);
        assert.equal(train.station, p.station);
        assert.ok(train.doors > 0.85);
      }
    });
  }
  for (const state of ["platform", "boarding", "riding", "alighting", "lift", "browsing"]) assert.ok(seen.has(state), state);
  assert.ok(population.commuters.every(p => p.trips >= 1), "Every commuter completes a destination visit");
});

test("traffic stops at signals and resumes without teleporting", () => {
  const traffic = new CityTraffic();
  let stopped = 0, resumed = 0;
  const waiting = new Set<number>();
  for (let time = 0; time < 60; time += 0.1) {
    const previous = new Map(traffic.nearby(0, 0, 2000).map(car => [car.id, { x: car.x, z: car.z }]));
    traffic.update(0.1, time);
    const cars = traffic.nearby(0, 0, 500);
    for (const car of cars) {
      const p = previous.get(car.id)!;
      assert.ok(Math.hypot(car.x - p.x, car.z - p.z) < 1.51);
      if (car.waiting) { stopped++; waiting.add(car.id); }
      else if (waiting.delete(car.id)) resumed++;
    }
  }
  assert.ok(stopped > 0 && resumed > 0, "Signals stop and release traffic");
});

test("residents stop at a shop facing its window, not a heading left over from arrival", () => {
  // Regression: the heading was taken after the step, from the ~zero vector left on arrival, so
  // browsers ended up facing an arbitrary (almost always the same) direction.
  const population = new CityPopulation(new CityWorld());
  const near = population.walkers.filter(p => Math.hypot(p.x, p.z - 78) < 160);
  let checked = 0;
  for (let time = 0; time < 90; time += 1 / 30) {
    const before = near.map(p => p.state);
    population.update(1 / 30, time, time, { x: 0, z: 78 });
    near.forEach((p, i) => {
      if (p.state !== "browsing" || before[i] === "browsing") return;
      const cx = Math.floor(p.x / 64) * 64 + 32 - p.x, cz = Math.floor(p.z / 64) * 64 + 32 - p.z;
      const facing = (Math.sin(p.yaw) * cx - Math.cos(p.yaw) * cz) / Math.hypot(cx, cz);
      assert.ok(facing > 0.9, `resident ${p.id} at ${p.x.toFixed(1)},${p.z.toFixed(1)} faces ${p.yaw.toFixed(2)}, away from the shop`);
      checked++;
    });
  }
  assert.ok(checked > 10, `only ${checked} shop visits observed`);
});

test("cars wait behind the painted crossings and never drive through each other, from the first frame", () => {
  // Regressions: every red stopped cars with their nose 6.4 m from the intersection centre: on the
  // residents' corner crossing (7.2 m) and, at the avenue, 0.4 m inside its moving lanes. And cars
  // spawned inside intersections (or past a red stop point) drove through the cross traffic.
  assert.equal(stopDistance("z", -1, 64 + STOP_LINE + 5), 5);
  assert.equal(stopDistance("x", 1, -AVENUE_STOP_LINE - 5), 5, "the avenue's stop is further out");
  assert.equal(stopDistance("x", 1, -STOP_LINE + 1), 64 - 1, "past the stop point: committed, next one counts");
  assert.equal(spawnAlong("x", 1, -20), -AVENUE_STOP_LINE, "no spawn between a stop point and its intersection");
  assert.ok(Math.abs(spawnAlong("z", 1, 64 + 3) - (64 + 6.2 + 3.4)) < 1e-9, "no spawn inside an intersection");
  assert.equal(spawnAlong("z", 1, 40), 40);
  const traffic = new CityTraffic();
  const box = (car: { x: number; z: number; yaw: number }) => Math.abs(Math.sin(car.yaw)) > 0.5 ? { hx: 2.8, hz: 1.3 } : { hx: 1.3, hz: 2.8 };
  let waited = 0;
  for (let time = 0; time < 60; time += 0.1) {
    traffic.update(0.1, time);
    const cars = traffic.nearby(0, 0, 330); // the avenue and a few ordinary intersections
    cars.forEach((car, i) => {
      const a = box(car);
      for (const other of cars.slice(i + 1)) {
        const b = box(other);
        assert.ok(Math.abs(other.x - car.x) >= a.hx + b.hx || Math.abs(other.z - car.z) >= a.hz + b.hz, `cars ${car.id} and ${other.id} overlap at t=${time.toFixed(2)}`);
      }
      if (!car.waiting) return;
      waited++;
      const alongX = Math.abs(Math.sin(car.yaw)) > 0.5, along = alongX ? car.x : car.z;
      const nearest = Math.round(along / 64) * 64, nose = Math.abs(along - nearest) - 2.9;
      assert.ok(nose > (alongX && nearest === 0 ? 26 : 13), `car ${car.id} waits with its nose ${nose.toFixed(2)} m from the intersection`);
    });
  }
  assert.ok(waited > 0);
});

test("the streets around a player who stays put do not empty over time", () => {
  // Regression: residents beyond 280 m were frozen outright, so every one who wandered out stayed
  // out; after 20 minutes near the spawn only 41 of 226 were left within drawing range.
  const population = new CityPopulation(new CityWorld()), eye = { x: 0, z: 78 };
  const around = () => population.walkers.filter(p => Math.hypot(p.x - eye.x, p.z - eye.z) < 220).length;
  const start = around();
  for (let time = 0; time < 900; time += 0.1) population.update(0.1, time, time, eye);
  assert.ok(around() > start * 0.75, `${around()} of ${start} residents left nearby`);
});

test("every rider has a seat of their own and stays on it through stops, straights and curves", () => {
  // Regression: all boarders of a door went to the same spot (two per carriage), stacked into each
  // other and sank through the bench.
  const population = new CityPopulation(new CityWorld()), trains = new Set<number>();
  let riding = 0, curving = 0, sitting = 0;
  const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  for (let time = 0; time < 600; time += 0.1) {
    population.update(0.1, time, time, { x: 9999, z: 9999 });
    const taken = new Set<string>();
    for (const p of population.commuters) {
      if (p.seat >= 0) {
        assert.notEqual(p.train, null, "only people on a train hold a seat");
        const key = `${p.train}:${p.seat}`;
        assert.ok(!taken.has(key), `two riders share seat ${key} at t=${time.toFixed(1)}`);
        taken.add(key);
      }
      if (!p.seated) { assert.notEqual(p.state, "riding"); continue; }
      assert.ok(p.seat >= 0 && p.train !== null);
      const seat = SEATS[p.seat], train = trainAt(time, p.train);
      assert.equal(p.y, PLATFORM_HEIGHT);
      assert.ok(Math.abs(angle(p.yaw - seatedYaw(train.yaw, seat.side))) < 1e-9, "seated riders face the aisle");
      const at = localToWorld(train, p.u, p.v);
      assert.ok(Math.hypot(at.x - p.x, at.z - p.z) < 1e-9, "riders move and turn with their carriage");
      if (p.state === "riding") {
        assert.equal(p.u, seat.u); assert.equal(p.v, seat.v);
        riding++; trains.add(p.train);
        if (train.station === null && Math.abs(Math.sin(2 * train.yaw)) > 0.05) curving++;
      } else {
        // Sitting down or getting up: backing straight onto / off the seat, in front of the bench.
        sitting++;
        assert.ok(Math.abs(p.v - seat.v) < 0.1 && Math.sign(p.u) === seat.side);
        assert.ok(Math.abs(p.u) >= BENCH.stand - 0.1 && Math.abs(p.u) <= BENCH.hip + 1e-9);
      }
    }
  }
  assert.equal(trains.size, 4, "riders sit in all four trains");
  assert.ok(curving > 0 && sitting > 0 && riding > 1000, `${riding} riding, ${curving} on curves, ${sitting} sitting down`);
});
