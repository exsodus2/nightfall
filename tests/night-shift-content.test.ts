import assert from "node:assert/strict";
import test from "node:test";
import { interiorPlaces } from "../src/city/interiors.ts";
import { CityWorld } from "../src/city/world.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import { NIGHT_SHIFT_GIVER, NIGHT_SHIFT_PACK, NIGHT_SHIFT_VENUES } from "../src/rpg/content/night-shift.ts";
import { ITEMS, xpToNext } from "../src/rpg/items/index.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack } from "../src/rpg/types.ts";

const world = new CityWorld();
const lightJob = "borrowed-light";
const signalJob = "small-hours-signal";
type VenueId = keyof typeof NIGHT_SHIFT_VENUES;

function setup(packs: readonly ContentPack[] = [NIGHT_SHIFT_PACK]) {
  return new RpgSession({ world, packs });
}

function enter(session: RpgSession, venue: VenueId) {
  session.bus.emit({ type: "entered", area: `interior:${venue}` });
}

function acceptLight(session: RpgSession) {
  assert.ok(session.talk(NIGHT_SHIFT_GIVER.id)?.options.some(option => option.id === "accept-light"));
  session.choose("accept-light");
  session.quests.close();
  assert.equal(session.quests.stage(lightJob), "manifest");
}

function finishLight(session: RpgSession) {
  acceptLight(session);
  for (const venue of ["blue-hour", "second-life", "kiln", "glasshouse"] as const) enter(session, venue);
  assert.equal(session.quests.stage(lightJob), "report");
  session.talk(NIGHT_SHIFT_GIVER.id);
  session.choose("report");
  session.quests.close();
  assert.equal(session.quests.status(lightJob), "complete");
}

function signalChoice(session: RpgSession) {
  assert.ok(session.talk(NIGHT_SHIFT_GIVER.id)?.options.some(option => option.id === "accept-signal"));
  session.choose("accept-signal");
  session.quests.close();
  for (const venue of ["undertone", "dead-letter", "blue-hour"] as const) enter(session, venue);
  assert.equal(session.quests.stage(signalJob), "choose-channel");
  session.talk(NIGHT_SHIFT_GIVER.id);
}

function totalXp(session: RpgSession) {
  let total = session.character.xp;
  for (let level = 1; level < session.character.level; level++) total += xpToNext(level);
  return total;
}

test("night-shift and the complete registered content validate with all cross-pack references", () => {
  const packs = [...CONTENT_PACKS, LEGACY_PACK, { id: "item-catalogue", items: ITEMS }];
  assert.deepEqual(validateContent(NIGHT_SHIFT_PACK, packs.filter(pack => pack !== NIGHT_SHIFT_PACK)), []);
  const combined: ContentPack = {
    id: "runtime-content",
    npcs: packs.flatMap(pack => pack.npcs ?? []),
    items: packs.flatMap(pack => pack.items ?? []),
    loot: packs.flatMap(pack => pack.loot ?? []),
    archetypes: packs.flatMap(pack => pack.archetypes ?? []),
    encounters: packs.flatMap(pack => pack.encounters ?? []),
    quests: packs.flatMap(pack => pack.quests ?? []),
    dialogues: packs.flatMap(pack => pack.dialogues ?? []),
    interactables: packs.flatMap(pack => pack.interactables ?? []),
    areas: packs.flatMap(pack => pack.areas ?? []),
    vendors: packs.flatMap(pack => pack.vendors ?? []),
  };
  assert.deepEqual(validateContent(combined), []);
  assert.ok(CONTENT_PACKS.includes(NIGHT_SHIFT_PACK));
});

test("the giver and every venue target are safe, near the real doors and cover all six interiors", () => {
  const venues = interiorPlaces(world);
  assert.equal(venues.length, 6);
  assert.ok(world.canOccupy(NIGHT_SHIFT_GIVER.x, NIGHT_SHIFT_GIVER.z));
  const tea = venues.find(venue => venue.id === "blue-hour");
  assert.ok(tea);
  assert.ok(Math.hypot(NIGHT_SHIFT_GIVER.x - tea.entrance.x, NIGHT_SHIFT_GIVER.z - tea.entrance.z) < 7);
  const visited = new Set<string>();
  for (const quest of NIGHT_SHIFT_PACK.quests ?? []) {
    assert.equal(quest.repeatable, undefined);
    assert.equal(quest.trigger, undefined);
    for (const stage of quest.stages) for (const objective of stage.objectives) {
      assert.notEqual(objective.kind, "reach");
      if (objective.kind !== "visit") continue;
      const venue = venues.find(place => `interior:${place.id}` === objective.area);
      assert.ok(venue, `known venue ${objective.area}`);
      assert.ok(objective.target);
      assert.ok(Math.hypot(objective.target.x - venue.entrance.x, objective.target.z - venue.entrance.z) < 0.02);
      assert.ok(world.canOccupy(objective.target.x, objective.target.z));
      visited.add(venue.id);
    }
  }
  assert.equal(visited.size, 6);
});

test("visits before acceptance, wrong doors, exterior positions and stale choices cannot skip the shift", () => {
  const session = setup();
  for (const venue of Object.keys(NIGHT_SHIFT_VENUES) as VenueId[]) enter(session, venue);
  assert.equal(session.quests.status(signalJob), "locked");
  assert.ok(!session.talk(NIGHT_SHIFT_GIVER.id)?.options.some(option => option.id === "accept-signal"));
  session.choose("accept-signal");
  assert.equal(session.quests.status(signalJob), "locked");
  acceptLight(session);
  session.choose("report");
  enter(session, "glasshouse");
  enter(session, "second-life");
  session.quests.update(0.1, NIGHT_SHIFT_VENUES["blue-hour"]);
  assert.equal(session.quests.stage(lightJob), "manifest");
  enter(session, "blue-hour");
  assert.equal(session.quests.stage(lightJob), "salvage");
  enter(session, "blue-hour");
  assert.equal(session.quests.stage(lightJob), "salvage");
  session.bus.emit({ type: "left", area: "interior:second-life" });
  assert.equal(session.quests.stage(lightJob), "salvage");
  enter(session, "second-life");
  enter(session, "kiln");
  enter(session, "glasshouse");
  assert.equal(session.quests.stage(lightJob), "report");
  assert.equal(session.character.credits, 50, "the return conversation owns payout");
  session.talk(NIGHT_SHIFT_GIVER.id);
  assert.equal(session.quests.status(lightJob), "active", "talking alone is not claiming the reward");
  session.choose("report");
  assert.equal(session.character.credits, 270);
  assert.equal(totalXp(session), 180);
  assert.equal(session.character.reputation("civilian"), 8);
  assert.equal(session.quests.flags.get("night-shift.grow-lights"), true);
  assert.equal(session.quests.status(signalJob), "available");
});

for (const choice of ["public", "dispatch"] as const) {
  test(`the ${choice} channel has an explicit choice, persistent consequences and one payout`, () => {
    const session = setup(CONTENT_PACKS);
    finishLight(session);
    signalChoice(session);
    const options = session.dialogue?.options ?? [];
    assert.ok(options.some(option => option.id === "public" && !option.disabled));
    assert.ok(options.some(option => option.id === "dispatch" && !option.disabled));
    session.choose("leave");
    assert.equal(session.quests.status(signalJob), "active", "thinking it over remains a real option");
    session.talk(NIGHT_SHIFT_GIVER.id);
    session.choose(choice);
    assert.equal(session.quests.outcome(signalJob), choice);
    assert.equal(session.quests.flags.get("night-shift.channel"), choice);
    assert.equal(session.character.credits, choice === "public" ? 450 : 570);
    assert.equal(totalXp(session), 400);
    assert.equal(session.character.reputation("civilian"), choice === "public" ? 18 : 10);
    assert.equal(session.character.reputation("ghosts"), choice === "public" ? 4 : 0);
    assert.equal(session.character.reputation("corpsec"), choice === "dispatch" ? 6 : 0);
    const state = JSON.stringify(session.character.state);
    for (let repeat = 0; repeat < 5; repeat++) {
      session.choose(choice);
      session.choose("accept-light");
      session.choose("accept-signal");
      enter(session, "blue-hour");
      session.talk(NIGHT_SHIFT_GIVER.id);
      session.choose("report");
      session.choose(choice === "public" ? "dispatch" : "public");
      assert.equal(session.quests.start(lightJob), false);
      assert.equal(session.quests.start(signalJob), false);
    }
    assert.equal(JSON.stringify(session.character.state), state);
    assert.equal(session.quests.outcome(signalJob), choice);
    assert.ok(session.dialogue?.lines.some(line => line.includes(choice === "public" ? "cat" : "Drivers")));
  });
}

test("a mid-route save keeps completed handoffs and resumes at the correct doorway without paying again", () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  };
  const first = new RpgSession({ world, packs: [NIGHT_SHIFT_PACK], storage });
  finishLight(first);
  first.talk(NIGHT_SHIFT_GIVER.id);
  first.choose("accept-signal");
  first.quests.close();
  enter(first, "undertone");
  first.save({ ...NIGHT_SHIFT_VENUES.undertone, yaw: 0 });
  const restored = new RpgSession({ world, packs: [NIGHT_SHIFT_PACK], storage });
  assert.equal(restored.quests.status(lightJob), "complete");
  assert.equal(restored.quests.stage(signalJob), "relay");
  assert.equal(restored.quests.flags.get("small-hours-signal.station-ident"), true);
  assert.equal(restored.character.credits, 270);
  const tracked = restored.questSnapshot(null).tracked;
  assert.equal(tracked?.targetX, NIGHT_SHIFT_VENUES["dead-letter"].x);
  assert.equal(tracked?.targetZ, NIGHT_SHIFT_VENUES["dead-letter"].z);
  enter(restored, "undertone");
  assert.equal(restored.quests.stage(signalJob), "relay");
  enter(restored, "dead-letter");
  enter(restored, "blue-hour");
  restored.talk(NIGHT_SHIFT_GIVER.id);
  restored.choose("public");
  restored.save({ x: NIGHT_SHIFT_GIVER.x, z: NIGHT_SHIFT_GIVER.z, yaw: 0 });
  const complete = new RpgSession({ world, packs: [NIGHT_SHIFT_PACK], storage });
  assert.equal(complete.quests.outcome(signalJob), "public");
  assert.equal(complete.quests.flags.get("night-shift.channel"), "public");
  complete.talk(NIGHT_SHIFT_GIVER.id);
  complete.choose("public");
  assert.equal(complete.character.credits, 450);
  assert.equal(totalXp(complete), 400);
});
