import assert from "node:assert/strict";
import test from "node:test";
import { CityPopulation } from "../src/city/people.ts";
import { CityWorld, districtAt } from "../src/city/world.ts";
import { inPark } from "../src/city/park.ts";
import { citizenPavement } from "../src/city/citizen-ai.ts";
import { interiorPlaces } from "../src/city/interiors.ts";
import { blockDoors, doorGlow } from "../src/city/street-doors.ts";

const world = new CityWorld();

test("crowds read per district: a busy avenue and market, a sparse Ghost Circuit", () => {
  const population = new CityPopulation(world);
  const perDistrict = [0, 0, 0, 0, 0, 0];
  for (const person of [...population.walkers, ...population.locals]) perDistrict[districtAt(person.x, person.z).id]++;
  assert.ok(perDistrict[4] > perDistrict[2] * 2, `Silk Market ${perDistrict[4]} vs Ghost Circuit ${perDistrict[2]}`);
  assert.ok(perDistrict[1] > perDistrict[2] * 1.8, `Neon Ward ${perDistrict[1]} vs Ghost Circuit ${perDistrict[2]}`);
  const avenue = population.walkers.filter(p => p.z < 0 && p.z > -700 && Math.abs(p.x) < 64).length / 2;
  const sideStreet = population.walkers.filter(p => p.z < 0 && p.z > -700 && p.x > 128 && p.x < 256).length / 2;
  assert.ok(avenue > sideStreet * 1.4, `avenue ${avenue} vs side street ${sideStreet} per column`);
  // Ids stay unique and clear of the commuters' range (4000+), which speech plates key on.
  const ids = [...population.walkers, ...population.commuters, ...population.locals].map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(population.walkers.length < 4000);
});

test("standing street life is on open pavement with its district's roles", () => {
  const population = new CityPopulation(world);
  const roles = new Map<string, number>();
  for (const local of population.locals) {
    roles.set(local.role, (roles.get(local.role) ?? 0) + 1);
    if (local.role === "kite") { assert.ok(inPark(local.x, local.z)); continue; }
    assert.ok(citizenPavement(world, local.x, local.z), `${local.role} ${local.id} at ${local.x.toFixed(1)},${local.z.toFixed(1)}`);
    if (local.role === "protester") assert.equal(districtAt(local.x, local.z).id, 5, "protests gather in the Spillway");
    if (local.role === "queue") assert.equal(districtAt(local.x, local.z).id, 4, "noodle queues are at Silk Market stalls");
  }
  for (const role of ["musician", "queue", "protester", "smoker", "vendor", "kite", "chatter", "wrist"]) assert.ok((roles.get(role) ?? 0) > 0, `no ${role}`);
  const undertone = interiorPlaces(world).find(place => place.id === "undertone");
  assert.ok(undertone);
  assert.ok(population.locals.some(local => local.role === "smoker" && Math.hypot(local.x - undertone.entrance.x, local.z - undertone.entrance.z) < 5), "smokers outside Undertone");
  const walking = new Set(population.walkers.map(walker => walker.role).filter(Boolean));
  for (const role of ["patrol", "cleaner", "dog", "cyborg", "crate"]) assert.ok(walking.has(role as never), `no walking ${role}`);
});

test("queues shuffle forward and serve customers without anyone jumping", () => {
  const population = new CityPopulation(world);
  const queue = population.locals.find(local => local.role === "queue");
  assert.ok(queue);
  const eye = { x: queue.x, z: queue.z };
  const members = population.locals.filter(local => local.queue === queue.queue);
  let served = 0, shuffled = 0;
  const dt = 1 / 30;
  for (let time = 0; time < 120; time += dt) {
    const before = members.map(member => ({ x: member.x, z: member.z, route: member.route.length }));
    population.update(dt, time, time, eye);
    members.forEach((member, index) => {
      const step = Math.hypot(member.x - before[index].x, member.z - before[index].z);
      assert.ok(step <= 1.2 * dt + 1e-9, `queue member ${member.id} jumped ${step.toFixed(3)} m`);
      if (!before[index].route && member.route.length && !member.queue?.line.includes(member)) served++;
      if (step > 0 && member.queue?.line.includes(member) && !member.route.length) shuffled++;
      assert.ok(citizenPavement(world, member.x, member.z), `queue member ${member.id} left the pavement`);
    });
  }
  assert.ok(served >= 4, `${served} customers served in two minutes`);
  assert.ok(shuffled > 0, "the line shuffles forward");
});

test("CorpSec patrols walk in pairs on the pavement and never jump", () => {
  const population = new CityPopulation(world);
  const followers = population.walkers.filter(walker => walker.leader >= 0);
  assert.ok(followers.length > 3);
  const follower = followers[0], leader = population.walkers[follower.leader];
  assert.equal(leader.role, "patrol");
  const dt = 1 / 30;
  let worst = 0;
  for (let time = 0; time < 90; time += dt) {
    const eye = { x: leader.x, z: leader.z }, before = { x: follower.x, z: follower.z };
    population.update(dt, time, time, eye);
    const step = Math.hypot(follower.x - before.x, follower.z - before.z);
    assert.ok(step <= 3 * dt + 1e-9, `partner jumped ${step.toFixed(3)} m at ${time.toFixed(2)}`);
    worst = Math.max(worst, Math.hypot(follower.x - leader.x, follower.z - leader.z));
  }
  assert.ok(worst < 4.5, `partner fell ${worst.toFixed(2)} m behind`);
});

test("a player walking a busy pavement hears residents speak, spaced out across the crowd", () => {
  const population = new CityPopulation(world);
  const dt = 1 / 30, speakers = new Set<number>(), starts: number[] = [];
  const spoken = new Map<number, string | undefined>();
  for (let time = 0; time < 40; time += dt) {
    // Up and down the Silk Market avenue pavement at walking pace (6 m/s).
    const leg = (time * 6) % 240, z = 70 + (leg < 120 ? leg : 240 - leg);
    const player = { id: "local", x: 14, y: 0, z, speed: 6 };
    population.update(dt, time, time, player, { players: [player], rain: false });
    for (const person of population.nearby(player.x, player.z, 40)) {
      if (person.bark && person.barkUntil && person.barkUntil > time && spoken.get(person.id) !== person.bark) { speakers.add(person.id); starts.push(time); }
      spoken.set(person.id, person.barkUntil && person.barkUntil > time ? person.bark : undefined);
    }
  }
  assert.ok(speakers.size >= 4, `only ${speakers.size} residents spoke in 40 s of walking`);
  starts.sort((a, b) => a - b);
  for (let index = 1; index < starts.length; index++) assert.ok(starts[index] - starts[index - 1] >= 2.79, "speech is rate-limited across the crowd");
});

test("shop doors sit on a street face with an open lane out to the walking line", () => {
  let doors = 0;
  for (let bx = -4; bx < 4; bx++) for (let bz = -4; bz < 4; bz++) for (const door of blockDoors(world, bx, bz)) {
    doors++;
    const building = world.buildings.find(b => b.id === door.building);
    assert.ok(building && building.id % 3 !== 0, "no doors behind a stall counter");
    // The doorway spot is 0.3 m off the middle of a face, inside the collision skin.
    const off = Math.abs(door.nx) ? Math.abs(door.x - building.x) - building.width / 2 : Math.abs(door.z - building.z) - building.depth / 2;
    assert.ok(Math.abs(off - 0.3) < 1e-6, `door ${door.building} is ${off.toFixed(2)} m off its face`);
    assert.ok(citizenPavement(world, door.ax, door.az), "the lane starts on the walking line");
  }
  assert.ok(doors > 40, `${doors} usable doors`);
  assert.equal(doorGlow({ opened: 10, hold: 1.5 }, 9.9), 0);
  assert.equal(doorGlow({ opened: 10, hold: 1.5 }, 11), 1);
  assert.equal(doorGlow({ opened: 10, hold: 1.5 }, 12.3), 0);
});

test("residents walk in and out of shop doors, fading across the threshold, never jumping", () => {
  const population = new CityPopulation(world), eye = { x: 0, z: 78 };
  const near = population.walkers.filter(p => Math.hypot(p.x - eye.x, p.z - eye.z) < 100 && p.leader < 0);
  const wasInside = new Set<number>(), cameOut = new Set<number>();
  const dt = 1 / 30;
  for (let time = 0; time < 240; time += dt) {
    const before = near.map(p => ({ x: p.x, z: p.z, state: p.state }));
    population.update(dt, time, time, eye);
    const listed = new Set(population.nearby(eye.x, eye.z, 200).map(p => p.id));
    near.forEach((p, i) => {
      // Residents further out step on alternate frames (110 m) or one frame in eight (280 m).
      const range = Math.hypot(before[i].x - eye.x, before[i].z - eye.z), frames = range > 280 ? 8 : range > 110 ? 2 : 1;
      assert.ok(Math.hypot(p.x - before[i].x, p.z - before[i].z) <= 2.8 * dt * frames + 1e-9, `resident ${p.id} jumped`);
      if (p.state === "inside") {
        wasInside.add(p.id);
        assert.equal(p.fade, 0);
        assert.equal(p.bark, undefined);
        assert.ok(p.doorway, "an indoor resident keeps the door they went in by");
        if (time - (p.doorway?.opened ?? 0) > (p.doorway?.hold ?? 0) + 0.8 && Math.hypot(p.x - eye.x, p.z - eye.z) < 200) assert.ok(!listed.has(p.id), "not drawn once the door has shut");
      } else if (before[i].state === "inside") cameOut.add(p.id);
      if (p.fade !== undefined) assert.ok(p.fade >= 0 && p.fade <= 1);
    });
  }
  assert.ok(wasInside.size >= 5, `only ${wasInside.size} residents went into a shop`);
  assert.ok(cameOut.size >= 2, `only ${cameOut.size} came back out`);
});

test("buskers and the Spillway preacher draw a half-ring of listeners facing them", () => {
  const population = new CityPopulation(world);
  const performers = population.locals.filter(local => local.role === "musician" || local.role === "preacher");
  const audience = population.locals.filter(local => local.role === "audience");
  assert.ok(audience.length >= 6, `${audience.length} listeners`);
  assert.ok(population.locals.some(local => local.role === "preacher"), "a street preacher in the Spillway");
  for (const listener of audience) {
    const performer = performers.find(p => Math.hypot(p.x - listener.x, p.z - listener.z) < 2.2);
    assert.ok(performer, `listener ${listener.id} has no performer nearby`);
    const dx = performer.x - listener.x, dz = performer.z - listener.z, length = Math.hypot(dx, dz);
    assert.ok((Math.sin(listener.yaw) * dx - Math.cos(listener.yaw) * dz) / length > 0.9, "listeners face the performer");
  }
  for (const role of ["dancer", "sitter", "chaser"]) assert.ok(population.locals.some(local => local.role === role), `no ${role}`);
});

test("a kid chasing a drone's shadow loops slowly on open pavement", () => {
  const population = new CityPopulation(world);
  const kid = population.locals.find(local => local.role === "chaser");
  assert.ok(kid);
  const dt = 1 / 30;
  for (let time = 0; time < 20; time += dt) {
    const before = { x: kid.x, z: kid.z };
    population.update(dt, time, time, { x: kid.homeX, z: kid.homeZ });
    if (time > 0) assert.ok(Math.hypot(kid.x - before.x, kid.z - before.z) <= 1.4 * dt + 1e-9, "the kid runs, never jumps");
    assert.ok(citizenPavement(world, kid.x, kid.z), `kid off the pavement at ${kid.x.toFixed(1)},${kid.z.toFixed(1)}`);
  }
});

test("neighbours walking toward each other sometimes stop for a word, face each other and part", () => {
  let chats = 0;
  for (let pair = 0; pair < 12 && chats < 2; pair++) {
    const population = new CityPopulation(world);
    population.walkers.splice(2); population.commuters.splice(0);
    const [a, b] = population.walkers;
    Object.assign(a, { id: 100 + pair * 2, x: 71.2, z: 84, role: undefined, occupation: "resident", leader: -1, trail: undefined, timer: 0, chatAt: 0, pace: 1.4, path: [{ x: 71.2, z: 112, crossing: false, axis: "z" }], next: 0 });
    Object.assign(b, { id: 101 + pair * 2, x: 71.2, z: 100, role: undefined, occupation: "resident", leader: -1, trail: undefined, timer: 0, chatAt: 0, pace: 1.4, path: [{ x: 71.2, z: 72, crossing: false, axis: "z" }], next: 0 });
    let stopped = false, parted = false;
    for (let time = 0; time < 30; time += 1 / 30) {
      population.update(1 / 30, time, time, { x: 71.2, z: 92 });
      if (a.act === "chat" && b.act === "chat") {
        stopped = true;
        assert.ok(!a.moving && !b.moving);
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.85, "they stop a pace apart");
        assert.ok(Math.sin(a.yaw) * (b.x - a.x) - Math.cos(a.yaw) * (b.z - a.z) > 0, "facing each other");
      } else if (stopped && a.moving && b.moving) parted = true;
    }
    if (stopped) { assert.ok(parted, "they go on their way"); chats++; }
  }
  assert.ok(chats >= 1, "nobody stopped to talk");
});
