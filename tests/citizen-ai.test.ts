import assert from "node:assert/strict";
import test from "node:test";
import { CITIZEN_PERSONAL_SPACE, MAX_PERCEIVED_PLAYERS, CitizenAwareness, citizenBark, citizenPavement, perceivedPlayers, type AwarenessTarget, type PerceivedPlayer } from "../src/city/citizen-ai.ts";
import { CityPopulation, type Citizen } from "../src/city/people.ts";
import { CityWorld, DISTRICTS } from "../src/city/world.ts";

const citizen = (id = 1): Citizen => ({ id, x: 71.2, y: 0, z: 90, yaw: Math.PI, state: "walking", moving: false, seated: false, umbrella: false, occupation: "resident", goal: "Walking to the next shop" });
const openWorld = { canOccupy: () => true };
const target: AwarenessTarget = { x: 71.2, z: 110 };

function advance(awareness: CitizenAwareness, person: Citizen, players: readonly PerceivedPlayer[], time: number, dt = 1 / 30): string {
  person.moving = false;
  const response = awareness.update(person, target, dt, time, players, false);
  if (response === "continue") {
    const distance = Math.hypot(target.x - person.x, target.z - person.z), step = Math.min(distance, dt * 1.5);
    if (distance > 0.001) { person.x += (target.x - person.x) / distance * step; person.z += (target.z - person.z) / distance * step; person.moving = true; }
  }
  return response;
}

function singleWalker(world: CityWorld): CityPopulation {
  const population = new CityPopulation(world), person = population.walkers[0];
  population.walkers.splice(1); population.commuters.splice(0);
  Object.assign(person, citizen(), { pace: 1.5, node: { bx: 1, bz: 1, corner: 3 }, path: [{ ...target, crossing: false, axis: "z" }], next: 0, timer: 0 });
  return population;
}

test("awareness retains only eight nearest ground-level players deterministically", () => {
  const players: PerceivedPlayer[] = Array.from({ length: 100 }, (_, index) => ({ id: `player-${String(index).padStart(3, "0")}`, x: index % 20, y: 0, z: Math.floor(index / 20) }));
  players.push({ id: "invalid", x: NaN, z: 0 }, { id: "train-rider", x: 0, z: 0, y: 15 }, { id: "far", x: 200, z: 0 });
  const first = perceivedPlayers({ players }, { x: 0, z: 0 });
  assert.equal(first.length, MAX_PERCEIVED_PLAYERS);
  assert.deepEqual(first, perceivedPlayers({ players: [...players].reverse() }, { x: 0, z: 0 }));
  assert.ok(first.every(player => Math.hypot(player.x, player.z) < 4));
  assert.deepEqual(perceivedPlayers(undefined, { x: 0, z: 0 }), []);
});

test("a greeting is brief and a lingering player cannot retrigger speech", () => {
  const awareness = new CitizenAwareness(openWorld), person = citizen();
  const player = { id: "local", x: 74, z: 92, speed: 0 };
  assert.equal(awareness.update(person, target, 0.1, 0, [player], false), "handled");
  assert.equal(person.reaction, "greeting");
  assert.ok(person.bark && person.bark.length < 70);
  assert.equal(person.attentionYaw, Math.atan2(player.x - person.x, person.z - player.z));
  for (let time = 2; time <= 65; time++) {
    assert.equal(awareness.update(person, target, 0.1, time, [player], false), "continue");
    if (time >= 4) assert.equal(person.bark, undefined);
    assert.equal(person.reaction, undefined);
  }
  awareness.update(person, target, 0.1, 75, [], false);
  assert.equal(awareness.update(person, target, 0.1, 76, [player], false), "handled");
  assert.ok(person.bark);
});

test("street speech is rate-limited across the crowd and has local context", () => {
  const awareness = new CitizenAwareness(openWorld), first = citizen(1), second = citizen(2), third = citizen(4);
  const player = { id: "local", x: 74, z: 92 };
  awareness.update(first, target, 0.1, 0, [player], true);
  awareness.update(second, target, 0.1, 0, [player], true);
  awareness.update(third, target, 0.1, 3, [player], true);
  assert.ok(first.bark); assert.equal(second.bark, undefined); assert.ok(third.bark);
  const lines = DISTRICTS.map(district => citizenBark({ ...first, x: district.x, z: district.z }, 1, false, false));
  assert.equal(new Set(lines).size, 6);
  assert.match(citizenBark({ ...first, occupation: "courier" }, 1, false, false), /parcel/i);
  assert.match(citizenBark({ ...first, occupation: "courier" }, 1, true, true), /fragile/i);
});

test("walkers politely pass a stationary player and rejoin their pavement route", () => {
  const awareness = new CitizenAwareness(openWorld), person = citizen();
  const players = [{ id: "local", x: 71.2, z: 92 }];
  let yielded = false, sidestepped = false;
  for (let time = 0; time < 10; time += 1 / 30) {
    const before = { x: person.x, z: person.z };
    assert.notEqual(advance(awareness, person, players, time), "turn-back");
    yielded ||= person.reaction === "yielding";
    sidestepped ||= Math.abs(person.x - 71.2) > 1;
    assert.ok(citizenPavement(openWorld, person.x, person.z), "never step into a traffic lane");
    assert.ok(Math.hypot(person.x - players[0].x, person.z - players[0].z) >= CITIZEN_PERSONAL_SPACE);
    assert.ok(Math.hypot(person.x - before.x, person.z - before.z) <= 0.051, "no teleporting");
  }
  assert.ok(yielded && sidestepped);
  assert.ok(person.z > 96);
  assert.ok(Math.abs(person.x - target.x) < 0.001);
  assert.equal(person.reaction, undefined);
});

test("another nearby player cannot conceal a player blocking the path", () => {
  const awareness = new CitizenAwareness(openWorld), person = citizen();
  const players = [{ id: "beside", x: 73, z: 90 }, { id: "blocking", x: 71.2, z: 92.5 }];
  assert.equal(awareness.update(person, target, 0.1, 0, players, false), "handled");
  assert.equal(person.reaction, "yielding");
  assert.equal(person.attentionYaw, Math.PI);
});

test("detours respect solid geometry and long-frame swept collision", () => {
  const world = { canOccupy: (x: number, z: number) => !(x > 72.4 && z > 91 && z < 94) };
  const awareness = new CitizenAwareness(world), person = citizen(), players = [{ id: "local", x: 71.2, z: 92 }];
  let turned = false;
  for (let time = 0; time < 4; time += 0.1) {
    turned ||= awareness.update(person, target, 0.1, time, players, false) === "turn-back";
    assert.equal(person.x, 71.2); assert.equal(person.z, 90);
  }
  assert.ok(turned, "a blocked narrow pavement yields a new route rather than permanent waiting");
  const clear = new CitizenAwareness(openWorld), moving = citizen();
  for (let time = 0; time < 8; time += 1.4) {
    advance(clear, moving, players, time, 1.4);
    assert.ok(citizenPavement(openWorld, moving.x, moving.z));
    assert.ok(Math.hypot(moving.x - players[0].x, moving.z - players[0].z) >= CITIZEN_PERSONAL_SPACE);
  }
});

test("the population turns back from an impassable pavement then resumes its routine", () => {
  const world = new CityWorld();
  world.canOccupy = (x, z) => x >= 71 && x <= 71.4 && z >= 70 && z <= 120;
  const population = singleWalker(world), person = population.walkers[0];
  const perception = { players: [{ id: "local", x: 71.2, z: 92 }] };
  for (let time = 0; time < 8; time += 0.1) {
    population.update(0.1, time, time, { x: 71.2, z: 90 }, perception);
    assert.ok(world.canOccupy(person.x, person.z));
    assert.ok(Math.hypot(person.x - 71.2, person.z - 92) >= CITIZEN_PERSONAL_SPACE);
  }
  assert.ok(person.z < 86, "resumes walking the opposite safe way");
  assert.equal(person.state, "walking");
  assert.ok(person.moving);
});

test("pedestrian awareness never pauses an admitted road crossing", () => {
  const awareness = new CitizenAwareness(openWorld), person = citizen();
  const before = { x: person.x, z: person.z };
  assert.equal(awareness.update(person, { ...target, road: true, crossing: false }, 0.1, 0, [{ id: "local", x: 71.2, z: 91 }], true), "continue");
  assert.equal(person.reaction, undefined);
  assert.equal(person.bark, undefined);
  assert.deepEqual({ x: person.x, z: person.z }, before);
});

test("awareness and detours are deterministic at an identical clock and input", () => {
  const first = citizen(), second = citizen(), firstAi = new CitizenAwareness(openWorld), secondAi = new CitizenAwareness(openWorld);
  for (let time = 0; time < 15; time += 0.1) {
    const players = [{ id: "local", x: 71.2, z: time < 7 ? 92 : 100 }];
    assert.equal(advance(firstAi, first, players, time, 0.1), advance(secondAi, second, players, time, 0.1));
    assert.deepEqual(first, second);
  }
});

test("far residents keep cheap time-sliced routines without player reactions", () => {
  const world = new CityWorld(), first = singleWalker(world), second = singleWalker(world), eye = { x: 600, z: 600 };
  const perception = { players: [{ id: "local", x: 71.2, z: 92 }] };
  for (let time = 0; time < 2; time += 0.1) {
    first.update(0.1, time, time, eye, perception);
    second.update(0.1, time, time, eye);
  }
  assert.deepEqual(first.walkers, second.walkers);
  assert.ok(first.walkers[0].z > 90);
  assert.equal(first.walkers[0].reaction, undefined);
});

test("an in-flight detour finishes safely after the player leaves perception range", () => {
  const world = new CityWorld(); world.canOccupy = () => true;
  const population = singleWalker(world), person = population.walkers[0];
  population.update(0.1, 0, 0, person, { players: [{ id: "local", x: 71.2, z: 92 }] });
  for (let time = 0.1; time < 10; time += 0.1) {
    population.update(0.1, time, time, { x: 600, z: 600 });
    assert.ok(citizenPavement(world, person.x, person.z));
  }
  assert.ok(person.z > 95);
  assert.ok(Math.abs(person.x - 71.2) < 0.001);
});

test("a detour blocked by a second arrival retraces its safe path", () => {
  const awareness = new CitizenAwareness(openWorld), person = citizen();
  const first = { id: "local", x: 71.2, z: 92 }, players = [first];
  let returning = false, turned = false;
  for (let time = 0; time < 10; time += 0.1) {
    if (time > 1.2 && players.length === 1) players.push({ id: "arrival", x: 72.85, z: 91.5 });
    const response = awareness.update(person, target, 0.1, time, players, false);
    returning ||= time > 4 && person.moving;
    if (response === "turn-back") { turned = true; break; }
    assert.ok(citizenPavement(openWorld, person.x, person.z));
    for (const player of players) assert.ok(Math.hypot(person.x - player.x, person.z - player.z) >= CITIZEN_PERSONAL_SPACE);
  }
  assert.ok(returning && turned);
  assert.ok(Math.hypot(person.x - 71.2, person.z - 90) < 0.001);
});

test("real district pavement detours never cut into buildings, traffic or park solids", () => {
  const world = new CityWorld(), population = new CityPopulation(world);
  let scenarios = 0, passed = 0, rerouted = 0;
  for (const person of population.walkers.filter(walker => walker.id % 47 === 0)) {
    const waypoint = person.path[0];
    if (!waypoint || !world.canOccupy(person.x, person.z)) continue;
    const directionX = waypoint.x - person.x, directionZ = waypoint.z - person.z, distance = Math.hypot(directionX, directionZ);
    if (distance < 13) continue;
    const player = { id: "local", x: person.x + directionX / distance * 2.4, z: person.z + directionZ / distance * 2.4 };
    const awareness = new CitizenAwareness(world);
    let moved = false;
    for (let time = 0; time < 7; time += 0.05) {
      person.moving = false;
      const response = awareness.update(person, waypoint, 0.05, time, [player], false);
      if (response === "turn-back") { rerouted++; break; }
      if (response === "continue") break;
      moved ||= person.moving;
      assert.ok(citizenPavement(world, person.x, person.z));
      assert.ok(Math.hypot(person.x - player.x, person.z - player.z) >= CITIZEN_PERSONAL_SPACE - 0.0001);
    }
    if (moved) passed++;
    scenarios++;
  }
  assert.ok(scenarios >= 50 && passed > 20 && rerouted > 10);
});
