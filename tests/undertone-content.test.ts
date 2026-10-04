import assert from "node:assert/strict";
import test from "node:test";
import { interiorMapDescription, interiorUseMarkers } from "../src/city/interior-map-markers.ts";
import { CityInteriors, interiorFixtures, interiorLocal, interiorPlaces, interiorWorld } from "../src/city/interiors.ts";
import { miniFontBytes } from "../src/city/mini-font.ts";
import { CityWorld, PLAYER_RADIUS } from "../src/city/world.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import { NIGHT_SHIFT_PACK } from "../src/rpg/content/night-shift.ts";
import { UNDERTONE_PACK, UNDERTONE_STATIONS } from "../src/rpg/content/undertone.ts";
import { ITEMS, xpToNext } from "../src/rpg/items/index.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld(), questId = "the-space-between";
const foundVenue = interiorPlaces(world).find(place => place.id === "undertone");
assert.ok(foundVenue);
const venue = foundVenue, fixtures = interiorFixtures(venue);
type Station = keyof typeof UNDERTONE_STATIONS;
const input: RpgFrame["input"] = {
  attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false,
  selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0,
};
const fixtureFor = (station: Station) => fixtures.find(fixture => station === "counter" ? fixture.kind === "counter" : station === "booth" ? fixture.kind === "table" : fixture.kind === "shelf" && fixture.x < 0);
const approach = (station: Station) => {
  const fixture = fixtureFor(station);
  assert.ok(fixture);
  return interiorWorld(venue, fixture.x, fixture.z + fixture.depth / 2 + 1.1);
};

function frame(station: Station, place = "undertone", mode: RpgFrame["player"]["mode"] = "walk"): RpgFrame {
  return { dt: 0.1, time: 1, input, player: { ...approach(station), eye: 2.7, yaw: venue.yaw, pitch: 0, mode, onFoot: !place, place } };
}

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

function open(session: RpgSession, station: Station) {
  session.close(); session.update(frame(station));
  const dialogue = session.interactNearby();
  assert.equal(dialogue?.npcId, UNDERTONE_STATIONS[station].id);
  assert.ok(dialogue);
  return dialogue;
}

function begin(session: RpgSession) {
  open(session, "counter"); session.choose("accept-set"); session.close();
  assert.equal(session.quests.stage(questId), "listen");
}

function confirm(session: RpgSession) {
  open(session, "booth"); session.choose("confirm-request"); session.close();
  assert.equal(session.quests.stage(questId), "sleeves");
}

function totalXp(session: RpgSession): number {
  let total = session.character.xp;
  for (let level = 1; level < session.character.level; level++) total += xpToNext(level);
  return total;
}

test("Undertone registers and validates with every authored pack and needs no timed or external system", () => {
  assert.ok(CONTENT_PACKS.includes(UNDERTONE_PACK));
  assert.deepEqual(validateContent(UNDERTONE_PACK), []);
  const packs = [...CONTENT_PACKS, LEGACY_PACK, { id: "catalogue", items: ITEMS }];
  const combined: ContentPack = {
    id: "all-content", npcs: packs.flatMap(pack => pack.npcs ?? []), items: packs.flatMap(pack => pack.items ?? []),
    loot: packs.flatMap(pack => pack.loot ?? []), archetypes: packs.flatMap(pack => pack.archetypes ?? []),
    encounters: packs.flatMap(pack => pack.encounters ?? []), quests: packs.flatMap(pack => pack.quests ?? []),
    dialogues: packs.flatMap(pack => pack.dialogues ?? []), interactables: packs.flatMap(pack => pack.interactables ?? []),
    areas: packs.flatMap(pack => pack.areas ?? []), vendors: packs.flatMap(pack => pack.vendors ?? []),
  };
  assert.deepEqual(validateContent(combined), []);
  const quest = UNDERTONE_PACK.quests?.[0];
  assert.ok(quest);
  assert.equal(quest.repeatable, undefined); assert.equal(quest.requires, undefined); assert.equal(quest.trigger, undefined);
  assert.ok(quest.stages.every(stage => stage.timeLimit === undefined && stage.objectives.every(objective => objective.kind === "choose")));
  const railEffects = quest.outcomes.rail.effects, rainEffects = quest.outcomes.rain.effects;
  assert.ok(railEffects && rainEffects);
  assert.deepEqual(railEffects.filter(effect => !("setFlag" in effect)), rainEffects.filter(effect => !("setFlag" in effect)));
});

test("all three supported-glyph stations sit on reachable furniture, clear of residents and each other", () => {
  const rooms = new CityInteriors(world), font = miniFontBytes();
  rooms.active = venue; rooms.fixtures = fixtures;
  for (const station of ["counter", "booth", "archive"] as const) {
    const object = UNDERTONE_STATIONS[station], fixture = fixtureFor(station), position = approach(station);
    assert.ok(fixture); assert.ok(object.glyph && object.glyph.length === 1);
    assert.equal(object.place, venue.id); assert.notEqual(object.once, true); assert.equal(object.effects, undefined);
    assert.ok(rooms.canOccupy(position.x, position.z)); assert.equal(rooms.atExit(position.x, position.z), false);
    assert.ok(Math.hypot(position.x - object.x, position.z - object.z) < 1.1);
    const glyph = (object.glyph.charCodeAt(0) - 32) * 2;
    assert.notEqual(font[glyph] | (font[glyph + 1] << 8), 0);
    const panel = interiorLocal(venue, object.x, object.z), local = interiorLocal(venue, position.x, position.z);
    const faceOffset = station === "archive" ? 0.25 : 0.05;
    assert.ok(Math.abs(panel.x - fixture.x) < 0.02 && Math.abs(panel.z - fixture.z - fixture.depth / 2 - faceOffset) < 0.02);
    for (const other of Object.values(UNDERTONE_STATIONS)) if (other.id !== object.id) assert.ok(Math.hypot(position.x - other.x, position.z - other.z) > 2.6);
    for (let step = 0; step <= 80; step++) {
      const across = interiorWorld(venue, local.x * step / 80, local.z);
      const along = interiorWorld(venue, 0, (venue.depth / 2 - 2.2) + (local.z - venue.depth / 2 + 2.2) * step / 80);
      assert.ok(rooms.canOccupy(across.x, across.z)); assert.ok(rooms.canOccupy(along.x, along.z));
    }
    assert.ok(Math.hypot(local.x + 1.5, local.z + venue.depth / 2 - 1.5) > PLAYER_RADIUS + 0.35);
    assert.ok(Math.hypot(local.x - (venue.width / 2 - 2.2), local.z - 0.6) > PLAYER_RADIUS + 0.35);
  }
});

test("the archive panel clears the protruding record spines rather than sharing their depth", () => {
  const fixture = fixtureFor("archive"), station = UNDERTONE_STATIONS.archive;
  assert.ok(fixture);
  const panel = interiorLocal(venue, station.x, station.z);
  const spineFront = fixture.z + fixture.depth / 2 + 0.08 + 0.12 / 2;
  assert.ok(panel.z - 0.15 / 2 > spineFront + 0.02);
});

test("matching coordinates outside, another room and vehicles cannot begin or progress the set", () => {
  const session = new RpgSession({ world, packs: [UNDERTONE_PACK] });
  for (const current of [frame("counter", ""), frame("counter", "kiln"), frame("counter", "unknown"), frame("counter", "undertone", "drive"), frame("counter", "undertone", "fly")]) {
    session.update(current); assert.equal(session.interactNearby(), null);
  }
  assert.equal(session.quests.status(questId), "available");
  begin(session);
  session.update(frame("booth", "")); assert.equal(session.interactNearby(), null);
  session.update(frame("archive", "dead-letter")); assert.equal(session.interactNearby(), null);
  assert.equal(session.quests.stage(questId), "listen");
});

for (const station of ["booth", "archive"] as const) for (const exit of ["leave", "escape"] as const) test(`${station}: reading then ${exit} and reload never confirms the request or chooses a sleeve`, () => {
  const storage = memory(), first = new RpgSession({ world, packs: [UNDERTONE_PACK], storage });
  begin(first); if (station === "archive") confirm(first);
  open(first, station); if (exit === "leave") first.choose("leave"); else first.close(); first.save();
  const restored = new RpgSession({ world, packs: [UNDERTONE_PACK], storage });
  assert.deepEqual(restored.savedPosition, venue.entrance);
  assert.equal(restored.quests.stage(questId), station === "booth" ? "listen" : "sleeves");
  assert.equal(restored.quests.flags.get(`${questId}.${station === "booth" ? "request" : "record"}`), undefined);
  assert.ok(open(restored, station).options.some(option => option.id === (station === "booth" ? "confirm-request" : "rail-return")));
  assert.equal(totalXp(restored), 0);
});

test("stage order and explicit choices reject early, stale and overly busy selections", () => {
  const session = new RpgSession({ world, packs: [UNDERTONE_PACK] }), before = session.character.serialize();
  open(session, "counter"); session.choose("leave"); assert.equal(session.quests.status(questId), "available");
  begin(session); open(session, "archive");
  assert.deepEqual(session.dialogue?.options.map(option => option.id), ["leave"]);
  session.choose("rail-return"); assert.equal(session.quests.stage(questId), "listen");
  open(session, "counter"); session.choose("keep-rests"); assert.equal(session.quests.stage(questId), "listen");
  confirm(session); open(session, "archive"); session.choose("busy-record");
  assert.ok(session.dialogue?.lines.some(line => line.includes("Nothing was selected")));
  assert.equal(session.quests.stage(questId), "sleeves"); assert.equal(session.quests.flags.get(`${questId}.record`), undefined);
  session.choose("retry-sleeves"); session.choose("rail-return");
  assert.equal(session.quests.stage(questId), "program");
  open(session, "archive"); session.choose("rain-on-tin");
  assert.equal(session.quests.flags.get(`${questId}.record`), "rail-return");
  open(session, "counter"); session.choose("fill-rests");
  assert.ok(session.dialogue?.lines.some(line => line.includes("Nothing was queued")));
  assert.deepEqual(session.dialogue?.options.map(option => option.id), ["retry-rail", "leave"]);
  session.choose("retry-rain"); assert.equal(session.quests.stage(questId), "program");
  assert.equal(session.quests.flags.get("undertone.last-set"), undefined);
  assert.deepEqual(session.character.serialize(), before);
});

for (const [record, outcome, title, pattern] of [
  ["rail-return", "rail", "RAIL RETURN", "ONE HIT / TWO REST / THREE HIT / FOUR REST"],
  ["rain-on-tin", "rain", "RAIN ON TIN", "ONE REST / TWO HIT / THREE REST / FOUR HIT"],
] as const) test(`${record}: selection and failed autofill reload safely, then one equal payout leaves the correct persistent receipt`, () => {
  const storage = memory();
  let session = new RpgSession({ world, packs: [UNDERTONE_PACK], storage });
  begin(session); confirm(session); open(session, "archive"); session.choose(record); session.close(); session.save();
  session = new RpgSession({ world, packs: [UNDERTONE_PACK], storage });
  assert.equal(session.quests.flags.get(`${questId}.record`), record);
  assert.ok(open(session, "counter").lines.some(line => line.includes(title) && line.includes(pattern)));
  session.choose("fill-rests"); session.close(); session.save();
  session = new RpgSession({ world, packs: [UNDERTONE_PACK], storage });
  assert.equal(session.quests.stage(questId), "program");
  const credits = session.character.credits;
  open(session, "counter"); assert.equal(session.choose("keep-rests").message, null);
  assert.equal(session.quests.outcome(questId), outcome); assert.equal(session.quests.flags.get("undertone.last-set"), record);
  assert.equal(session.character.credits, credits + 75); assert.equal(totalXp(session), 100); assert.equal(session.character.reputation("civilian"), 3);
  assert.equal(session.snapshot().feed.filter(message => message.text.startsWith("Quest complete: The Space Between")).length, 1);
  const reward = session.character.serialize();
  for (let retry = 0; retry < 3; retry++) {
    const receipt = open(session, "counter");
    assert.ok(receipt.lines.some(line => line.includes(title) && line.includes(pattern)));
    assert.ok(receipt.lines.some(line => line.includes("ONE SET PAID")));
    assert.deepEqual(receipt.options.map(option => option.id), ["leave"]);
    session.choose("accept-set"); session.choose("keep-rests");
    assert.equal(session.quests.start(questId), false); assert.deepEqual(session.character.serialize(), reward);
  }
  session.close(); session.save();
  const complete = new RpgSession({ world, packs: [UNDERTONE_PACK], storage });
  assert.ok(open(complete, "counter").lines.some(line => line.includes(pattern)));
  assert.deepEqual(complete.character.serialize(), reward);
});

test("generic floorplan markers cover all three activities and retain only the receipt", () => {
  const session = new RpgSession({ world, packs: [UNDERTONE_PACK] });
  const markers = () => interiorUseMarkers(venue, session.interactables(venue.id));
  assert.deepEqual(markers().map(marker => marker.id), [UNDERTONE_STATIONS.counter.id]);
  begin(session);
  assert.deepEqual(markers().map(marker => marker.id), Object.values(UNDERTONE_STATIONS).map(station => station.id));
  const description = interiorMapDescription(venue, markers());
  for (const station of Object.values(UNDERTONE_STATIONS)) assert.ok(description.includes(station.label));
  confirm(session); open(session, "archive"); session.choose("rain-on-tin"); open(session, "counter"); session.choose("keep-rests");
  assert.deepEqual(markers().map(marker => marker.id), [UNDERTONE_STATIONS.counter.id]);
  assert.deepEqual(interiorUseMarkers(venue, session.interactables("blue-hour")), []);
});

test("Night Shift's Undertone ident remains independent of the quiet-set job", () => {
  const session = new RpgSession({ world, packs: [UNDERTONE_PACK, NIGHT_SHIFT_PACK] });
  begin(session);
  session.talk("mira"); session.choose("accept-light"); session.close();
  for (const place of ["blue-hour", "second-life", "kiln", "glasshouse"]) session.bus.emit({ type: "entered", area: `interior:${place}` });
  session.talk("mira"); session.choose("report"); session.close(); session.talk("mira"); session.choose("accept-signal"); session.close();
  assert.equal(session.quests.stage("small-hours-signal"), "soundcheck");
  session.bus.emit({ type: "entered", area: "interior:undertone" });
  assert.equal(session.quests.stage("small-hours-signal"), "relay");
  assert.equal(session.quests.stage(questId), "listen"); assert.equal(session.quests.flags.get(`${questId}.request`), undefined);
  confirm(session); open(session, "archive"); session.choose("rail-return"); open(session, "counter"); session.choose("keep-rests");
  assert.equal(session.quests.stage("small-hours-signal"), "relay"); assert.equal(session.quests.status(questId), "complete");
});
