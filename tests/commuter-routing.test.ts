import assert from "node:assert/strict";
import test from "node:test";
import { roadDistance } from "../src/city/driving.ts";
import { PLATFORM_HEIGHT, SEATS, STATIONS, boardingTrain, localToWorld, trainAt } from "../src/city/metro.ts";
import { CityPopulation, type ResidentState } from "../src/city/people.ts";
import { CityWorld } from "../src/city/world.ts";

const world = new CityWorld();

function commuterPopulation(): CityPopulation {
  const population = new CityPopulation(world);
  population.walkers.length = 0;
  return population;
}

function oneBrowsingCommuter(station: number, variant: number): CityPopulation {
  const population = commuterPopulation();
  population.commuters.splice(1);
  Object.assign(population.commuters[0], { id: 4000 + variant, station, state: "browsing", train: null, seat: -1, u: 9, v: 20, y: 0, timer: 0, phase: 0, seated: false, moving: false, ...localToWorld(STATIONS[station], 9, 20) });
  return population;
}

test("all 24 commuter market endpoints and both directions stay on clear pavements", () => {
  for (const station of STATIONS) for (let variant = 0; variant < 4; variant++) {
    const population = oneBrowsingCommuter(station.index, variant), person = population.commuters[0];
    for (let tick = 1; tick <= 100; tick++) population.update(0.1, tick / 10, tick / 10, person);
    assert.equal(person.state, "browsing");
    assert.ok(Math.abs(person.u - (16 + variant)) < 1e-9);
    assert.ok(Math.abs(person.v - (station.x === 0 ? 14 : 10)) < 1e-9, `${station.name} uses the correct avenue width`);
    const entrance = localToWorld(station, 9, 20), market = { x: person.x, z: person.z };
    for (const [start, end] of [[entrance, market], [market, entrance]]) for (let sample = 0; sample <= 100; sample++) {
      const amount = sample / 100, x = start.x + (end.x - start.x) * amount, z = start.z + (end.z - start.z) * amount;
      assert.ok(world.canOccupy(x, z), `${station.name} variant ${variant} path avoids solid scenery`);
      assert.ok(roadDistance(x, z) >= 6.85, `${station.name} variant ${variant} path stays behind the kerb`);
    }
  }
});

test("all 54 natural commuters complete repeated safe market, lift and train cycles over 900 seconds", context => {
  const population = commuterPopulation(), states = new Map<number, Set<ResidentState>>(), visits = new Set<number>(), stations = new Set<number>();
  const liftStarts = new Map<number, { time: number; phase: number; u: number; v: number }>();
  let groundSamples = 0, roadSamples = 0, minimumClearance = Infinity, boardings = 0, finishedLifts = 0;
  assert.equal(population.commuters.length, 54);
  for (const person of population.commuters) states.set(person.id, new Set([person.state]));
  for (let tick = 1; tick <= 9000; tick++) {
    const time = tick / 10, previous = population.commuters.map(person => ({ state: person.state, y: person.y }));
    population.update(0.1, time, time, { x: 0, z: 0 });
    const reserved = new Set<string>();
    population.commuters.forEach((person, index) => {
      states.get(person.id)!.add(person.state);
      assert.ok([person.x, person.y, person.z, person.yaw, person.u, person.v, person.timer].every(Number.isFinite));
      if (person.train !== null) {
        const key = `${person.train}:${person.seat}`, expected = localToWorld(trainAt(time, person.train), person.u, person.v);
        assert.ok(person.seat >= 0 && person.seat < SEATS.length);
        assert.ok(!reserved.has(key), `seat ${key} has only one commuter`); reserved.add(key);
        assert.ok(Math.hypot(person.x - expected.x, person.z - expected.z) < 1e-9);
        assert.equal(person.y, PLATFORM_HEIGHT);
      }
      if (previous[index].state === "platform" && person.state === "boarding") {
        assert.equal(boardingTrain(time, person.station)?.id, person.train); boardings++;
      }
      if (person.state === "lift") {
        if (previous[index].state !== "lift") liftStarts.set(person.id, { time, phase: person.phase, u: person.u, v: person.v });
        const start = liftStarts.get(person.id)!;
        assert.equal(person.phase, start.phase); assert.equal(person.u, start.u); assert.equal(person.v, start.v);
        assert.ok(person.y >= 0 && person.y <= PLATFORM_HEIGHT);
        assert.ok(start.phase === 0 ? person.y <= previous[index].y : person.y >= previous[index].y);
      } else if (previous[index].state === "lift") {
        const start = liftStarts.get(person.id)!;
        assert.ok(Math.abs(time - start.time - 4) < 0.101);
        assert.equal(person.state, start.phase === 0 ? "browsing" : "platform");
        assert.equal(person.y, start.phase === 0 ? 0 : PLATFORM_HEIGHT);
        liftStarts.delete(person.id); finishedLifts++;
      }
      if (person.state === "browsing") {
        assert.equal(person.train, null); assert.equal(person.seat, -1); assert.equal(person.seated, false); assert.equal(person.y, 0);
        assert.ok(world.canOccupy(person.x, person.z), `commuter ${person.id} avoids solid scenery`);
        const clearance = roadDistance(person.x, person.z);
        minimumClearance = Math.min(minimumClearance, clearance); groundSamples++;
        if (clearance < 6.85) roadSamples++;
        visits.add(person.id); stations.add(person.station);
      }
    });
  }
  context.diagnostic(JSON.stringify({ seconds: 900, groundSamples, roadSamples, minimumClearance, boardings, finishedLifts, visits: visits.size, stations: stations.size }));
  assert.equal(roadSamples, 0, "commuters never browse or return through the central avenue road");
  assert.ok(minimumClearance >= 6.85); assert.ok(groundSamples > 80000);
  assert.equal(visits.size, 54); assert.equal(stations.size, 6);
  assert.ok(boardings > 200 && finishedLifts > 400);
  for (const person of population.commuters) {
    assert.ok(person.trips >= 4, `commuter ${person.id} keeps returning to the metro`);
    assert.deepEqual([...states.get(person.id)!].sort(), ["alighting", "boarding", "browsing", "lift", "platform", "riding"]);
  }
});

test("an avenue market pause keeps its state during zero-time updates and resumes the return lift", () => {
  const population = oneBrowsingCommuter(1, 1), person = population.commuters[0];
  for (let tick = 1; tick <= 100; tick++) population.update(0.1, tick / 10, tick / 10, person);
  const paused = { ...person };
  for (let frame = 0; frame < 120; frame++) population.update(0, 10, 10, person);
  assert.deepEqual(person, paused);
  const waitUntil = 22 + person.id % 19;
  for (let tick = 1; tick <= 10; tick++) population.update(0.1, 10 + tick / 10, 10 + tick / 10, person);
  assert.equal(person.state, "browsing"); assert.ok(person.timer > paused.timer && person.timer < waitUntil);
  assert.equal(person.u, paused.u); assert.equal(person.v, paused.v);
  let reachedLift = false;
  for (let tick = 1; tick <= 500 && !reachedLift; tick++) {
    const time = 11 + tick / 10; population.update(0.1, time, time, person);
    reachedLift = population.commuters[0].state === "lift";
  }
  assert.ok(reachedLift); assert.equal(person.phase, 1); assert.equal(person.trips, 1); assert.equal(person.timer, 0);
  assert.ok(Math.hypot(person.u - 9, person.v - 20) < 0.08);
});
