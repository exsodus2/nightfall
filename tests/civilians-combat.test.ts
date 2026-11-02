// Civilians and combat (people.ts, citizen-ai.ts, street-locals.ts, rpg/session.ts): walkers near a
// fight run from it along the pavement and come back 8-15 s after it ends, standing locals scatter
// and return, a swing or shot on or beside a civilian is an assault (once per swing) that turns
// CorpSec hostile, passers-by look over the scene afterwards, and all of it runs on the shared clock.
import assert from "node:assert/strict";
import test from "node:test";
import { CityPopulation } from "../src/city/people.ts";
import { CityWorld, districtAt } from "../src/city/world.ts";
import { CALM_MIN, CALM_SPREAD, RUN_PACE, citizenPavement } from "../src/city/citizen-ai.ts";
import { RpgSession } from "../src/rpg/session.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import type { RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld();
const DT = 1 / 30;
const idle = (): RpgFrame["input"] => ({ attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 });
const frame = (x: number, z: number, input = idle()): RpgFrame => ({ dt: 1 / 60, time: 0, player: { x, z, eye: 2.7, yaw: 0, pitch: 0, mode: "walk", onFoot: true }, input });

/** An ordinary resident walking along a pavement segment in `district`. */
function resident(population: CityPopulation, district: number) {
  const walker = population.walkers.find(w => w.leader < 0 && !w.role && w.occupation === "resident" && districtAt(w.x, w.z).id === district && citizenPavement(world, w.x, w.z) && w.path[w.next] && Math.hypot(w.path[w.next].x - w.x, w.path[w.next].z - w.z) > 3);
  assert.ok(walker, `a resident in district ${district}`);
  return walker;
}

test("walkers within 25 m of a fight run from it along the pavement and head back 8-15 s after it ends", () => {
  const population = new CityPopulation(world), control = new CityPopulation(world);
  const walker = resident(population, 4);
  const start = { x: walker.x, z: walker.z }, target = walker.path[walker.next];
  const length = Math.hypot(target.x - start.x, target.z - start.z);
  // The fight is 8 m ahead along their pavement: away from it is back the way they came.
  const threat = { x: start.x + (target.x - start.x) / length * 8, z: start.z + (target.z - start.z) / length * 8 };
  const eye = { ...start };
  let time = 0, fled = false;
  for (; time < 4; time += DT) {
    const before = { x: walker.x, z: walker.z };
    population.update(DT, time, time, eye, { players: [], threats: [threat] }, time);
    control.update(DT, time, time, eye, { players: [] }, time);
    const step = Math.hypot(walker.x - before.x, walker.z - before.z);
    assert.ok(step <= RUN_PACE * DT + 1e-6, `no jumps: ${step.toFixed(3)} m in a frame`);
    assert.ok(citizenPavement(world, walker.x, walker.z), "runs on open pavement");
    fled ||= walker.panic !== undefined;
  }
  assert.ok(fled && walker.panic, "they panic");
  assert.ok(Math.hypot(walker.x - threat.x, walker.z - threat.z) > 8 + 3, "and get away from the fight");
  assert.notEqual(walker.goal, "Walking to the next shop");
  const quiet = time;
  let headedBack = Infinity;
  for (; time < quiet + 45 && walker.panic; time += DT) {
    const before = { x: walker.x, z: walker.z };
    population.update(DT, time, time, eye, { players: [] }, time);
    control.update(DT, time, time, eye, { players: [] }, time);
    assert.ok(Math.hypot(walker.x - before.x, walker.z - before.z) <= RUN_PACE * DT + 1e-6, "no jumps on the way back");
    if (walker.panic?.returning && headedBack === Infinity) headedBack = time;
  }
  assert.ok(headedBack - quiet >= CALM_MIN - DT && headedBack - quiet <= CALM_MIN + CALM_SPREAD + DT, `heads back ${(headedBack - quiet).toFixed(1)} s after the fight`);
  assert.equal(walker.panic, undefined, "back on their route");
  assert.ok(Math.hypot(walker.x - start.x, walker.z - start.z) < 0.05, "at the spot they left it");
  const resumed = { x: walker.x, z: walker.z };
  for (const end = time + 3; time < end; time += DT) { population.update(DT, time, time, eye, { players: [] }, time); control.update(DT, time, time, eye, { players: [] }, time); }
  assert.ok(Math.hypot(walker.x - resumed.x, walker.z - resumed.z) > 1, "and walk on");
  assert.deepEqual(population.commuters, control.commuters, "commuters are unaffected");
});

test("standing locals scatter from a fight and return to their spot", () => {
  const population = new CityPopulation(world);
  const local = population.locals.find(l => (l.role === "smoker" || l.role === "chatter" || l.role === "wrist") && !l.queue && !l.loop && l.circle === 0);
  assert.ok(local);
  const home = { x: local.x, z: local.z, yaw: local.yaw, state: local.state };
  const eye = { x: local.x, z: local.z }, threat = { x: local.x + 10, z: local.z + 4 };
  let time = 0;
  for (; time < 3; time += DT) {
    const before = { x: local.x, z: local.z };
    population.update(DT, time, time, eye, { players: [], threats: [threat] }, time);
    assert.ok(Math.hypot(local.x - before.x, local.z - before.z) <= RUN_PACE * DT + 1e-6);
  }
  assert.ok(local.scatter, "scattered");
  for (const end = time + 40; time < end && local.scatter; time += DT) population.update(DT, time, time, eye, { players: [] }, time);
  assert.equal(local.scatter, undefined, "back");
  assert.ok(Math.hypot(local.x - home.x, local.z - home.z) < 0.05);
  assert.equal(local.yaw, home.yaw);
  assert.equal(local.state, home.state);
});

test("a swing or shot on or beside a civilian is an assault; misses and shots into a fighter are not", () => {
  const population = new CityPopulation(world);
  const crowd = [...population.walkers, ...population.locals];
  const walker = population.walkers.find(w => w.leader < 0 && w.y < 0.5 && crowd.every(o => o === w || Math.hypot(o.x - w.x, o.z - w.z) > 16));
  assert.ok(walker, "someone on their own");
  // Facing them (forward is (sin yaw, -cos yaw)) from 1.5 m behind on +z.
  const swing = { x: walker.x, z: walker.z + 1.5, yaw: 0, reach: 1.8, ranged: false };
  const hit = population.assault(swing, 0);
  assert.ok(hit && Math.hypot(hit.x - walker.x, hit.z - walker.z) < 1e-9, "a swing beside them");
  assert.equal(population.assault({ ...swing, yaw: Math.PI }, 0), null, "swinging the other way");
  assert.equal(population.assault({ ...swing, z: walker.z + 5 }, 0), null, "out of reach");
  const shot = { x: walker.x, z: walker.z + 15, yaw: 0, reach: 30, ranged: true };
  assert.ok(population.assault(shot, 0), "a shot down the line of fire");
  assert.equal(population.assault({ ...shot, x: walker.x + 3 }, 0), null, "a shot past them");
  // A fighter between the gun and the civilian takes the shot.
  population.update(0, 0, 0, walker, { players: [], threats: [{ x: walker.x, z: walker.z + 7 }] }, 0);
  assert.equal(population.assault({ ...shot, x: walker.x, z: walker.z + 15 }, 0), null);
  // The assault scares people off the attacker's spot.
  const victim = population.assault(swing, 1);
  assert.ok(victim);
  population.update(DT, 1, 1, walker, { players: [] }, 1);
  assert.ok(walker.panic, "the civilian runs");
});

test("the session reports each swing once, for the engine to check against civilians", () => {
  const rpg = new RpgSession({ world });
  for (let i = 0; i < 10; i++) { rpg.update(frame(11.5, 77)); assert.equal(rpg.takePlayerAttack(), null); }
  let attacks = 0;
  rpg.update(frame(11.5, 77, { ...idle(), attackPressed: true }));
  if (rpg.takePlayerAttack()) attacks++;
  assert.equal(rpg.takePlayerAttack(), null, "taken once");
  for (let i = 0; i < 60; i++) { rpg.update(frame(11.5, 77)); if (rpg.takePlayerAttack()) attacks++; }
  assert.equal(attacks, 1);
});

test("an assault near CorpSec turns the patrol hostile and alerts once", () => {
  const rpg = new RpgSession({ world, packs: CONTENT_PACKS });
  for (let i = 0; i < 30; i++) rpg.update(frame(192, -440));
  const corpsec = () => rpg.enemies({ x: 192, z: -475 }, 70).filter(e => e.faction === "corpsec" && e.deathAge < 0);
  assert.ok(corpsec().length && corpsec().every(e => !e.hostile), "neutral at first");
  assert.equal(rpg.civilianAssault(192, -440), "CorpSec has been alerted");
  assert.ok(corpsec().every(e => e.hostile), "they turn hostile");
  assert.equal(rpg.civilianAssault(192, -440), null, "no second toast");
  assert.equal(rpg.snapshot().feed.filter(f => f.text === "CorpSec is responding").length, 1);
  assert.equal(rpg.civilianAssault(0, 78), null, "a crime across town goes unanswered");
});

test("after a fight a passer-by edges over to look at the scene", () => {
  const population = new CityPopulation(world);
  const anchor = resident(population, 4);
  const scene = { x: anchor.x, z: anchor.z };
  population.update(DT, 0, 0, scene, { players: [], threats: [scene] }, 0);
  let looked = false;
  for (let time = DT; time < 30 && !looked; time += DT) {
    population.update(DT, time, time, scene, { players: [] }, time);
    looked = population.walkers.some(w => !w.panic && (w.goal === "Edging over for a look" || w.goal === "Looking over the scene"));
  }
  assert.ok(looked);
});

test("fight reactions run on the shared clock: clients with different ambient clocks agree", () => {
  const first = new CityPopulation(world), later = new CityPopulation(world);
  const walker = resident(first, 4);
  const eye = { x: walker.x, z: walker.z }, threat = { x: walker.x + 5, z: walker.z + 2 };
  const swing = { x: walker.x + 1, z: walker.z, yaw: -Math.PI / 2, reach: 1.8, ranged: false };
  let reacted = false;
  for (let index = 0; index < 900; index++) {
    const time = index / 20, perception = { players: [], threats: index < 200 ? [threat] : [] };
    first.update(0.05, time, time + 2, eye, perception, time);
    later.update(0.05, time + 1013, time + 2, eye, perception, time);
    if (index === 300) assert.deepEqual(later.assault(swing, time), first.assault(swing, time));
    reacted ||= first.walkers.some(w => w.panic !== undefined);
  }
  assert.ok(reacted, "people reacted");
  assert.deepEqual(later.nearby(eye.x, eye.z, 400), first.nearby(eye.x, eye.z, 400));
  assert.deepEqual(later.stats(eye.x, eye.z), first.stats(eye.x, eye.z));
});
