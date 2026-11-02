import assert from "node:assert/strict";
import test from "node:test";
import { BUILDING_PLACE_ID } from "../src/city/interiors.ts";
import { citizenPavement } from "../src/city/citizen-ai.ts";
import { CityWorld } from "../src/city/world.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import {
  COURIER_JOBS, COURIER_PACK, DISPATCH, DISPATCH_ID, PICKUP_RADIUS, MAX_LEG, MAX_REWARD, MIN_LEG, OFFERS, POOL_SIZE, SHIFT_COOLDOWN, SHIFT_JOBS,
  courierContext, courierPool, courierReward, generateCourierJob,
} from "../src/rpg/content/courier.ts";
import { ITEMS } from "../src/rpg/items/index.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";

const world = new CityWorld();
const ctx = courierContext(world);

const enter = (session: RpgSession, id: string): void => session.bus.emit({ type: "entered", area: `interior:${id}` });
const takeOptions = (session: RpgSession): string[] => {
  const view = session.quests.interact(DISPATCH_ID);
  const ids = (view?.options ?? []).map(option => option.id).filter(id => id.startsWith("take-"));
  session.quests.close();
  return ids;
};

test("generation is deterministic from (day, counter) and differs across seeds", () => {
  assert.deepEqual(courierPool(ctx), courierPool(courierContext(new CityWorld())));
  assert.deepEqual(generateCourierJob(ctx, 0, 4), COURIER_JOBS[4]);
  const day1 = courierPool(ctx, 1);
  assert.notDeepEqual(day1.map(job => job.stops.map(stop => stop.id)), COURIER_JOBS.map(job => job.stops.map(stop => stop.id)));
  assert.equal(COURIER_JOBS.length, POOL_SIZE);
});

test("every run has distinct stops, valid ids, bounded legs and a distance-scaled capped reward", () => {
  const rewards = new Set<number>();
  for (const job of [...COURIER_JOBS, ...courierPool(ctx, 1)]) {
    assert.ok(job.stops.length === 2 || job.stops.length === 3);
    assert.equal(new Set(job.stops.map(stop => stop.id)).size, job.stops.length, `${job.questId} repeats a door`);
    assert.notEqual(job.stops[0].id, job.stops[job.stops.length - 1].id);
    for (const [i, stop] of job.stops.entries()) {
      assert.match(stop.id, BUILDING_PLACE_ID);
      assert.ok(ctx.interiors.placeById(stop.id), `${stop.id} must resolve`);
      if (stop.floor > 1) assert.ok(stop.id.endsWith(`-f${stop.floor}`));
      if (i > 0) assert.ok(stop.distanceFromPrev >= MIN_LEG - 1 && stop.distanceFromPrev <= MAX_LEG + 1, `${job.questId} leg ${stop.distanceFromPrev}`);
    }
    assert.ok(new Set(job.stops.map(stop => stop.id.replace(/-f\d+$/, ""))).size === job.stops.length);
    assert.ok(job.credits > 0 && job.credits <= MAX_REWARD);
    assert.equal(job.credits, courierReward(job.distance, job.stops.length).credits);
    assert.match(job.summary, /\(.+\) on /);
    rewards.add(job.credits);
  }
  assert.ok(courierReward(1600, 2).credits > courierReward(600, 2).credits);
  assert.equal(courierReward(1e6, 3).credits, MAX_REWARD);
  assert.ok(rewards.size > 3, "rewards should vary with distance");
  assert.ok(COURIER_JOBS.some(job => job.stops.length === 3), "the pool contains chains");
});

test("the pack validates with the full registered content", () => {
  const others = [...CONTENT_PACKS.filter(pack => pack !== COURIER_PACK), LEGACY_PACK, { id: "item-catalogue", items: ITEMS }];
  assert.deepEqual(validateContent(COURIER_PACK, others), []);
});

test("a run completes only by entering the pickup then each drop in order; re-entering a door pays nothing", () => {
  const session = new RpgSession({ world, packs: [...CONTENT_PACKS, LEGACY_PACK] });
  const offered = takeOptions(session);
  assert.equal(offered.length, OFFERS);
  const job = COURIER_JOBS[Number(offered[0].slice("take-".length))];
  const before = session.character.credits;
  session.quests.interact(DISPATCH_ID);
  session.choose(`take-${job.index}`);
  session.quests.close();
  assert.equal(session.quests.stage(job.questId), "pickup");
  const [pickup, ...drops] = job.stops;
  enter(session, drops[0].id); // a drop before the pickup does nothing
  assert.equal(session.quests.stage(job.questId), "pickup");
  enter(session, pickup.id);
  assert.equal(session.quests.stage(job.questId), "drop-1");
  enter(session, pickup.id); // same door again: no progress
  enter(session, pickup.id);
  assert.notEqual(session.quests.status(job.questId), "complete");
  for (const drop of drops) enter(session, drop.id);
  assert.equal(session.quests.status(job.questId), "complete");
  assert.equal(session.character.credits - before, job.credits);
  enter(session, drops[drops.length - 1].id);
  assert.equal(session.character.credits - before, job.credits, "no second payout");
});

test("a shift pays at most SHIFT_JOBS runs, then the board closes until the shift clock cools down", () => {
  const session = new RpgSession({ world, packs: [...CONTENT_PACKS, LEGACY_PACK] });
  const start = session.character.credits;
  let earned = 0;
  for (let n = 0; n < SHIFT_JOBS; n++) {
    const offers = takeOptions(session);
    assert.equal(offers.length, OFFERS, `window ${n}`);
    const job = COURIER_JOBS[Number(offers[0].slice("take-".length))];
    session.quests.interact(DISPATCH_ID);
    session.choose(`take-${job.index}`);
    session.quests.close();
    for (const stop of job.stops) enter(session, stop.id);
    assert.equal(session.quests.status(job.questId), "complete");
    earned += job.credits;
  }
  assert.equal(session.character.credits - start, earned);
  assert.ok(earned <= SHIFT_JOBS * MAX_REWARD);
  assert.deepEqual(takeOptions(session), [], "quota met: nothing offered");
  // The shift clock runs on game time: after the cooldown a new shift can be clocked.
  // (QuestEngine.update clamps each frame to MAX_DT = 0.5 s, so advance in frames, as the game does.)
  for (let t = 0; t <= SHIFT_COOLDOWN + 1; t += 0.5) session.quests.update(0.5, { x: 0, z: 0 });
  const view = session.quests.interact(DISPATCH_ID);
  assert.ok(view?.options.some(option => option.id === "new-shift"));
  session.choose("new-shift");
  session.quests.close();
  assert.ok(takeOptions(session).length > 0);
});

test("the dispatch terminal stands on free pavement, clear of Sable, with pickups inside its radius", () => {
  assert.ok(world.canOccupy(DISPATCH.x, DISPATCH.z), "terminal is inside a building or wall");
  assert.ok(citizenPavement(world, DISPATCH.x, DISPATCH.z), "terminal is on a road");
  const sable = { x: -18, z: 55 };
  assert.ok(Math.hypot(DISPATCH.x - sable.x, DISPATCH.z - sable.z) >= 2, "terminal overlaps Sable");
  const near = ctx.places.filter(place => Math.hypot(place.entrance.x - DISPATCH.x, place.entrance.z - DISPATCH.z) <= PICKUP_RADIUS);
  assert.ok(near.length >= 10, `only ${near.length} pickups within ${PICKUP_RADIUS} m`);
});
