import assert from "node:assert/strict";
import test from "node:test";
import { interiorMapDescription, interiorUseMarkers } from "../src/city/interior-map-markers.ts";
import { interiorResidents } from "../src/city/interior-scene.ts";
import { interiorWorkState } from "../src/city/interior-work-state.ts";
import { CityInteriors, interiorFixtures, interiorLocal, interiorPlaces, interiorWorld, type InteriorFixture } from "../src/city/interiors.ts";
import { miniFontBytes } from "../src/city/mini-font.ts";
import { CityWorld, PLAYER_RADIUS } from "../src/city/world.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import { THE_STATIC_PACK, THE_STATIC_STATIONS } from "../src/rpg/content/the-static.ts";
import { ITEMS, xpToNext } from "../src/rpg/items/index.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld(), questId = "last-set-before-curfew";
const foundVenue = interiorPlaces(world).find(place => place.id === "the-static");
assert.ok(foundVenue);
const venue = foundVenue, fixtures = interiorFixtures(venue);
type Station = keyof typeof THE_STATIC_STATIONS;
const STATIONS = ["decks", "bar", "slips"] as const;
const input: RpgFrame["input"] = {
  attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false,
  selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0,
};
const fixtureFor = (station: Station): InteriorFixture | undefined => fixtures.find(fixture =>
  station === "decks" ? fixture.kind === "decks" : station === "bar" ? fixture.kind === "counter" && fixture.x < 0 : fixture.kind === "booth" && fixture.x > 0);
/** Where a visitor stands to use a station: 1.1 m in front of its panel (every panel faces the door). */
const approach = (station: Station) => {
  const panel = interiorLocal(venue, THE_STATIC_STATIONS[station].x, THE_STATIC_STATIONS[station].z);
  return interiorWorld(venue, panel.x, panel.z + 1.1);
};

function frame(station: Station, place = "the-static", mode: RpgFrame["player"]["mode"] = "walk"): RpgFrame {
  return { dt: 0.1, time: 1, input, player: { ...approach(station), eye: 2.7, yaw: venue.yaw, pitch: 0, mode, onFoot: !place, place } };
}

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

function open(session: RpgSession, station: Station) {
  session.close(); session.update(frame(station));
  const dialogue = session.interactNearby();
  assert.ok(dialogue);
  assert.equal(dialogue.npcId, THE_STATIC_STATIONS[station].id);
  return dialogue;
}

function begin(session: RpgSession) {
  open(session, "decks"); session.choose("accept-set"); session.close();
  assert.equal(session.quests.stage(questId), "recover");
}
function bar(session: RpgSession) { open(session, "bar"); session.choose("tidewater-hymn"); session.close(); }
function slips(session: RpgSession) { open(session, "slips"); session.choose("glass-arcade"); session.close(); }
function mixer(session: RpgSession) {
  open(session, "decks"); session.choose("master-zero"); session.choose("ribbon-latch-up"); session.choose("flush-48"); session.close();
}

function totalXp(session: RpgSession): number {
  let total = session.character.xp;
  for (let level = 1; level < session.character.level; level++) total += xpToNext(level);
  return total;
}

test("Last Set Before Curfew registers and validates with every authored pack", () => {
  assert.ok(CONTENT_PACKS.includes(THE_STATIC_PACK));
  assert.deepEqual(validateContent(THE_STATIC_PACK), []);
  const packs = [...CONTENT_PACKS, LEGACY_PACK, { id: "catalogue", items: ITEMS }];
  const combined: ContentPack = {
    id: "all-content", npcs: packs.flatMap(pack => pack.npcs ?? []), items: packs.flatMap(pack => pack.items ?? []),
    loot: packs.flatMap(pack => pack.loot ?? []), archetypes: packs.flatMap(pack => pack.archetypes ?? []),
    encounters: packs.flatMap(pack => pack.encounters ?? []), quests: packs.flatMap(pack => pack.quests ?? []),
    dialogues: packs.flatMap(pack => pack.dialogues ?? []), interactables: packs.flatMap(pack => pack.interactables ?? []),
    areas: packs.flatMap(pack => pack.areas ?? []), vendors: packs.flatMap(pack => pack.vendors ?? []),
  };
  assert.deepEqual(validateContent(combined), []);
  const quest = THE_STATIC_PACK.quests?.[0];
  assert.ok(quest);
  assert.equal(quest.title, "Last Set Before Curfew");
  assert.equal(quest.repeatable, undefined); assert.equal(quest.requires, undefined); assert.equal(quest.trigger, undefined);
  assert.ok(quest.stages.every(stage => stage.timeLimit === undefined));
  const bells = quest.outcomes.bells.effects, bloom = quest.outcomes.bloom.effects;
  assert.ok(bells && bloom);
  assert.deepEqual(bells.filter(effect => !("setFlag" in effect)), bloom.filter(effect => !("setFlag" in effect)), "both closers pay the same");
});

test("all three stations sit on reachable furniture, clear of residents and each other", () => {
  const rooms = new CityInteriors(world), font = miniFontBytes();
  rooms.active = venue; rooms.fixtures = fixtures;
  const spawn = venue.depth / 2 - 2.2;
  for (const station of STATIONS) {
    const object = THE_STATIC_STATIONS[station], fixture = fixtureFor(station), position = approach(station);
    assert.ok(fixture); assert.ok(object.glyph && object.glyph.length === 1);
    assert.equal(object.place, venue.id); assert.notEqual(object.once, true); assert.equal(object.effects, undefined);
    assert.ok(rooms.canOccupy(position.x, position.z), station); assert.equal(rooms.atExit(position.x, position.z), false);
    const glyph = (object.glyph.charCodeAt(0) - 32) * 2;
    assert.notEqual(font[glyph] | (font[glyph + 1] << 8), 0);
    // The panel sits on the fixture's door-facing side, within its width.
    const panel = interiorLocal(venue, object.x, object.z), local = interiorLocal(venue, position.x, position.z);
    assert.ok(Math.abs(panel.z - (fixture.z + fixture.depth / 2 + 0.05)) < 0.02, station);
    assert.ok(Math.abs(panel.x - fixture.x) < fixture.width / 2, station);
    for (const other of Object.values(THE_STATIC_STATIONS)) if (other.id !== object.id) assert.ok(Math.hypot(position.x - other.x, position.z - other.z) > 2.6);
    // Straight walks from the arrival point: down the centre line, then across.
    for (let step = 0; step <= 80; step++) {
      const along = interiorWorld(venue, 0, spawn + (local.z - spawn) * step / 80);
      const across = interiorWorld(venue, local.x * step / 80, local.z);
      assert.ok(rooms.canOccupy(along.x, along.z), `${station} along ${step}`); assert.ok(rooms.canOccupy(across.x, across.z), `${station} across ${step}`);
    }
    for (const person of interiorResidents(venue)) assert.ok(Math.hypot(local.x - person.x, local.z - person.z) > PLAYER_RADIUS + 0.35, station);
  }
});

test("matching coordinates outside, another room and vehicles cannot begin or progress the set", () => {
  const session = new RpgSession({ world, packs: [THE_STATIC_PACK] });
  for (const current of [frame("decks", ""), frame("decks", "undertone"), frame("decks", "unknown"), frame("decks", "the-static", "drive"), frame("decks", "the-static", "fly")]) {
    session.update(current); assert.equal(session.interactNearby(), null);
  }
  assert.equal(session.quests.status(questId), "available");
  begin(session);
  session.update(frame("bar", "")); assert.equal(session.interactNearby(), null);
  session.update(frame("slips", "undertone")); assert.equal(session.interactNearby(), null);
  assert.equal(session.quests.flags.get(`${questId}.slot-7`), undefined);
});

test("every mistake is refused at no cost and can be retried", () => {
  const session = new RpgSession({ world, packs: [THE_STATIC_PACK] }), before = session.character.serialize();
  open(session, "decks"); session.choose("leave"); assert.equal(session.quests.status(questId), "available");
  begin(session);
  // The mixer: master left up, cable taped, wrong flush rates.
  open(session, "decks"); session.choose("master-live");
  assert.ok(session.dialogue?.lines.some(line => line.includes("POP GUARD")));
  assert.equal(session.quests.flags.get(`${questId}.mixer-master`), undefined);
  session.choose("retry-master"); session.choose("master-zero");
  session.choose("ribbon-tape"); assert.equal(session.quests.flags.get(`${questId}.mixer-ribbon`), undefined);
  session.choose("retry-ribbon"); session.choose("ribbon-latch-up");
  for (const wrong of ["flush-44", "flush-96"]) {
    session.choose(wrong); assert.ok(session.dialogue?.lines.some(line => line.includes("CLOCK MISMATCH")));
    assert.equal(session.quests.flags.get(`${questId}.slot-9`), undefined);
    session.choose("retry-clock");
  }
  // The bar and the slips: near misses write nothing.
  open(session, "bar"); session.choose("tidewater-run");
  assert.equal(session.quests.flags.get(`${questId}.slot-7`), undefined); session.choose("retry-bar");
  assert.ok(session.dialogue?.options.some(option => option.id === "tidewater-hymn"));
  open(session, "slips"); session.choose("grass-parade");
  assert.equal(session.quests.flags.get(`${questId}.slot-8`), undefined); session.choose("retry-slips");
  assert.ok(session.dialogue?.options.some(option => option.id === "glass-arcade"));
  // The closer cannot be picked early.
  open(session, "decks"); session.choose("curfew-bells");
  assert.equal(session.quests.stage(questId), "recover"); assert.equal(session.quests.flags.get(`${questId}.closer`), undefined);
  assert.deepEqual(session.character.serialize(), before);
});

test("the three tracks come back in any order and the mixer remembers its progress across a reload", () => {
  const storage = memory();
  let session = new RpgSession({ world, packs: [THE_STATIC_PACK], storage });
  begin(session); slips(session);
  open(session, "decks"); session.choose("master-zero"); session.close(); session.save();
  session = new RpgSession({ world, packs: [THE_STATIC_PACK], storage });
  assert.equal(session.quests.stage(questId), "recover");
  assert.equal(session.quests.flags.get(`${questId}.slot-8`), true);
  assert.ok(open(session, "decks").options.some(option => option.id === "ribbon-latch-up"), "the mixer reopens at step 2");
  session.choose("ribbon-latch-up"); session.choose("flush-48");
  assert.ok(session.dialogue?.lines.some(line => line.includes("LANTERN STATIC")));
  assert.equal(session.quests.stage(questId), "recover", "slot 7 is still missing");
  open(session, "decks"); assert.ok(session.dialogue?.lines.some(line => line.includes("Rhea at the bar has slot seven")));
  bar(session);
  assert.equal(session.quests.stage(questId), "closer");
  assert.equal(totalXp(session), 0); assert.equal(session.character.credits, new RpgSession({ world, packs: [THE_STATIC_PACK] }).character.credits);
});

test("reading a station then leaving and reloading never records a track", () => {
  for (const station of ["bar", "slips"] as const) for (const exit of ["leave", "escape"] as const) {
    const storage = memory(), first = new RpgSession({ world, packs: [THE_STATIC_PACK], storage });
    begin(first);
    open(first, station); if (exit === "leave") first.choose("leave"); else first.close(); first.save();
    const restored = new RpgSession({ world, packs: [THE_STATIC_PACK], storage });
    assert.deepEqual(restored.savedPosition, venue.entrance);
    assert.equal(restored.quests.flags.get(`${questId}.${station === "bar" ? "slot-7" : "slot-8"}`), undefined);
    assert.ok(open(restored, station).options.some(option => option.id === (station === "bar" ? "tidewater-hymn" : "glass-arcade")));
  }
});

for (const [choice, outcome, closer] of [["curfew-bells", "bells", "CURFEW BELLS"], ["static-bloom", "bloom", "STATIC BLOOM"]] as const) {
  test(`${choice}: one equal payout and a closer that persists`, () => {
    const storage = memory();
    let session = new RpgSession({ world, packs: [THE_STATIC_PACK], storage });
    begin(session); mixer(session); bar(session); slips(session); session.save();
    session = new RpgSession({ world, packs: [THE_STATIC_PACK], storage });
    assert.equal(session.quests.stage(questId), "closer");
    const credits = session.character.credits;
    open(session, "decks"); assert.equal(session.choose(choice).message, null);
    assert.equal(session.quests.outcome(questId), outcome); assert.equal(session.quests.flags.get("the-static.closer"), choice);
    assert.equal(session.character.credits, credits + 110); assert.equal(totalXp(session), 140); assert.equal(session.character.reputation("civilian"), 3);
    assert.equal(session.snapshot().feed.filter(message => message.text.startsWith("Quest complete: Last Set Before Curfew")).length, 1);
    const reward = session.character.serialize();
    for (let retry = 0; retry < 3; retry++) {
      const receipt = open(session, "decks");
      assert.ok(receipt.lines.some(line => line.includes(closer) && line.includes("TIDEWATER HYMN")));
      assert.deepEqual(receipt.options.map(option => option.id), ["leave"]);
      session.choose("accept-set"); session.choose("curfew-bells"); session.choose("static-bloom");
      assert.equal(session.quests.start(questId), false); assert.deepEqual(session.character.serialize(), reward);
    }
    session.close(); session.save();
    const complete = new RpgSession({ world, packs: [THE_STATIC_PACK], storage });
    assert.equal(complete.quests.flags.get("the-static.closer"), choice);
    assert.ok(open(complete, "decks").lines.some(line => line.includes(closer)));
    assert.deepEqual(complete.character.serialize(), reward);
  });
}

test("floorplan USE squares and the decks readout follow the quest", () => {
  const session = new RpgSession({ world, packs: [THE_STATIC_PACK] });
  const markers = () => interiorUseMarkers(venue, session.interactables(venue.id));
  const readout = () => interiorWorkState(venue.id, session.quests)?.tags.map(tag => tag.text);
  assert.deepEqual(markers().map(marker => marker.id), [THE_STATIC_STATIONS.decks.id]);
  assert.deepEqual(readout(), ["0/3"]);
  begin(session);
  assert.deepEqual(markers().map(marker => marker.id), Object.values(THE_STATIC_STATIONS).map(station => station.id));
  const description = interiorMapDescription(venue, markers());
  for (const station of Object.values(THE_STATIC_STATIONS)) assert.ok(description.includes(station.label));
  bar(session); assert.deepEqual(readout(), ["1/3"]);
  slips(session); mixer(session); assert.deepEqual(readout(), ["CLOSER"]);
  open(session, "decks"); session.choose("static-bloom");
  assert.deepEqual(readout(), ["BLOOM"]);
  assert.equal(interiorWorkState(venue.id, session.quests)?.tags[0].settled, true);
  assert.deepEqual(markers().map(marker => marker.id), [THE_STATIC_STATIONS.decks.id]);
  assert.deepEqual(interiorUseMarkers(venue, session.interactables("undertone")), []);
});
