import assert from "node:assert/strict";
import test from "node:test";
import { interiorMapDescription, interiorUseMarkers } from "../src/city/interior-map-markers.ts";
import { CityInteriors, interiorFixtures, interiorLocal, interiorPlaces, interiorWorld } from "../src/city/interiors.ts";
import { miniFontBytes } from "../src/city/mini-font.ts";
import { CityWorld, PLAYER_RADIUS } from "../src/city/world.ts";
import { GLASSHOUSE_PACK, GLASSHOUSE_STATIONS } from "../src/rpg/content/glasshouse.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import { NIGHT_SHIFT_PACK } from "../src/rpg/content/night-shift.ts";
import { ITEMS, xpToNext } from "../src/rpg/items/index.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld(), questId = "a-little-night";
const foundVenue = interiorPlaces(world).find(place => place.id === "glasshouse");
assert.ok(foundVenue);
const venue = foundVenue, fixtures = interiorFixtures(venue);
type Station = keyof typeof GLASSHOUSE_STATIONS;
const input: RpgFrame["input"] = {
  attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false,
  selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0,
};
const fixtureFor = (station: Station) => fixtures.find(fixture => station === "board" ? fixture.kind === "counter" : fixture.kind === "planter" && (station === "left" ? fixture.x < 0 : fixture.x > 0));
const approach = (station: Station) => {
  const fixture = fixtureFor(station);
  assert.ok(fixture);
  return interiorWorld(venue, fixture.x + (station === "left" ? 1.15 : 0), fixture.z + fixture.depth / 2 + (station === "left" ? 1.2 : 1.1));
};

function frame(station: Station, place = "glasshouse", mode: RpgFrame["player"]["mode"] = "walk"): RpgFrame {
  return { dt: 0.1, time: 1, input, player: { ...approach(station), eye: 2.7, yaw: venue.yaw, pitch: 0, mode, onFoot: !place, place } };
}

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

function open(session: RpgSession, station: Station) {
  session.close(); session.update(frame(station));
  const dialogue = session.interactNearby();
  assert.equal(dialogue?.npcId, GLASSHOUSE_STATIONS[station].id);
  assert.ok(dialogue);
  return dialogue;
}

function begin(session: RpgSession) {
  open(session, "board"); session.choose("accept-care"); session.close();
  assert.equal(session.quests.stage(questId), "trays");
}

function tend(session: RpgSession, stations: readonly ("left" | "right")[] = ["left", "right"]) {
  for (const station of stations) { open(session, station); session.choose(station === "left" ? "drain-left" : "seat-wick"); session.close(); }
  assert.equal(session.quests.stage(questId), "night");
}

function totalXp(session: RpgSession): number {
  let total = session.character.xp;
  for (let level = 1; level < session.character.level; level++) total += xpToNext(level);
  return total;
}

test("Glasshouse registers and validates with every authored pack", () => {
  assert.ok(CONTENT_PACKS.includes(GLASSHOUSE_PACK));
  assert.deepEqual(validateContent(GLASSHOUSE_PACK), []);
  const packs = [...CONTENT_PACKS, LEGACY_PACK, { id: "catalogue", items: ITEMS }];
  const combined: ContentPack = {
    id: "all-content", npcs: packs.flatMap(pack => pack.npcs ?? []), items: packs.flatMap(pack => pack.items ?? []),
    loot: packs.flatMap(pack => pack.loot ?? []), archetypes: packs.flatMap(pack => pack.archetypes ?? []),
    encounters: packs.flatMap(pack => pack.encounters ?? []), quests: packs.flatMap(pack => pack.quests ?? []),
    dialogues: packs.flatMap(pack => pack.dialogues ?? []), interactables: packs.flatMap(pack => pack.interactables ?? []),
    areas: packs.flatMap(pack => pack.areas ?? []), vendors: packs.flatMap(pack => pack.vendors ?? []),
  };
  assert.deepEqual(validateContent(combined), []);
  assert.equal(GLASSHOUSE_PACK.quests?.[0].repeatable, undefined);
  assert.equal(GLASSHOUSE_PACK.quests?.[0].trigger, undefined);
  assert.equal(GLASSHOUSE_PACK.quests?.[0].requires, undefined);
});

test("the three real fixtures have clear approaches, aisles and an unobstructed left-tray interaction", () => {
  const rooms = new CityInteriors(world);
  rooms.active = venue; rooms.fixtures = fixtures;
  for (const station of ["board", "left", "right"] as const) {
    const object = GLASSHOUSE_STATIONS[station], fixture = fixtureFor(station), position = approach(station);
    assert.ok(fixture);
    assert.equal(object.place, venue.id); assert.notEqual(object.once, true); assert.equal(object.effects, undefined);
    assert.ok(rooms.canOccupy(position.x, position.z)); assert.equal(rooms.atExit(position.x, position.z), false);
    assert.ok(Math.hypot(position.x - object.x, position.z - object.z) < 1.3);
    const panel = interiorLocal(venue, object.x, object.z), local = interiorLocal(venue, position.x, position.z);
    assert.ok(Math.abs(panel.x - fixture.x - (station === "left" ? 0.65 : 0)) < 0.02);
    assert.ok(Math.abs(panel.z - fixture.z - fixture.depth / 2 - 0.05) < 0.02);
    for (const other of Object.values(GLASSHOUSE_STATIONS)) if (other.id !== object.id) assert.ok(Math.hypot(position.x - other.x, position.z - other.z) > 2.6);
    for (let step = 0; step <= 80; step++) {
      const across = interiorWorld(venue, local.x * step / 80, local.z);
      const along = interiorWorld(venue, 0, (venue.depth / 2 - 2.2) + (local.z - venue.depth / 2 + 2.2) * step / 80);
      assert.ok(rooms.canOccupy(across.x, across.z)); assert.ok(rooms.canOccupy(along.x, along.z));
    }
  }
  const left = interiorLocal(venue, approach("left").x, approach("left").z);
  assert.ok(Math.hypot(left.x - (-venue.width / 2 + 2.2), left.z - 2.45) > PLAYER_RADIUS + 0.35);
});

test("outside, wrong-room and vehicle coordinates cannot begin the tending shift", () => {
  const session = new RpgSession({ world, packs: [GLASSHOUSE_PACK] });
  assert.deepEqual(session.interactables(), []);
  for (const current of [frame("board", ""), frame("board", "kiln"), frame("board", "missing"), frame("board", "glasshouse", "drive"), frame("board", "glasshouse", "fly")]) {
    session.update(current); assert.equal(session.interactNearby(), null);
  }
  assert.equal(session.quests.status(questId), "available");
  begin(session);
  session.update(frame("left", "")); assert.equal(session.interactNearby(), null);
  session.update(frame("right", "kiln")); assert.equal(session.interactNearby(), null);
});

test("every authored Glasshouse panel glyph has visible pixels in the physical sign font", () => {
  const font = miniFontBytes();
  for (const station of Object.values(GLASSHOUSE_STATIONS)) {
    const glyph = station.glyph;
    assert.ok(glyph && glyph.length === 1);
    const offset = (glyph.charCodeAt(0) - 32) * 2;
    assert.ok(offset >= 0 && offset < font.length);
    assert.notEqual(font[offset] | (font[offset + 1] << 8), 0, station.id);
  }
});

for (const station of ["left", "right"] as const) for (const exit of ["leave", "escape"] as const) test(`${station}: reading then ${exit}, saving and loading cannot silently tend the tray`, () => {
  const storage = memory(), first = new RpgSession({ world, packs: [GLASSHOUSE_PACK], storage });
  begin(first); open(first, station);
  if (exit === "leave") first.choose("leave"); else first.close();
  first.save();
  const restored = new RpgSession({ world, packs: [GLASSHOUSE_PACK], storage });
  assert.deepEqual(restored.savedPosition, venue.entrance);
  assert.equal(restored.quests.flags.get(`${questId}.${station}-tray`), undefined);
  assert.equal(restored.quests.stage(questId), "trays");
  assert.ok(open(restored, station).options.some(option => option.id === (station === "left" ? "drain-left" : "seat-wick")));
  assert.equal(totalXp(restored), 0);
});

for (const firstStation of ["left", "right"] as const) test(`tending ${firstStation} first persists only that tray and leaves the other available`, () => {
  const storage = memory(), first = new RpgSession({ world, packs: [GLASSHOUSE_PACK], storage });
  begin(first); open(first, firstStation); first.choose(firstStation === "left" ? "drain-left" : "seat-wick"); first.close(); first.save();
  const second = new RpgSession({ world, packs: [GLASSHOUSE_PACK], storage });
  assert.equal(second.quests.stage(questId), "trays");
  assert.ok(open(second, firstStation).lines.some(line => line.includes("TRAY SETTLED")));
  assert.deepEqual(second.dialogue?.options.map(option => option.id), ["leave"]);
  const other = firstStation === "left" ? "right" : "left";
  assert.equal(second.quests.flags.get(`${questId}.${other}-tray`), undefined);
  open(second, "board"); second.choose("restore-cycle"); assert.equal(second.quests.stage(questId), "trays");
  open(second, other); second.choose(other === "left" ? "drain-left" : "seat-wick");
  assert.equal(second.quests.stage(questId), "night"); assert.equal(totalXp(second), 0);
});

test("mistakes explain the different needs without costs, damage or stage skips", () => {
  const session = new RpgSession({ world, packs: [GLASSHOUSE_PACK] });
  const before = session.character.serialize();
  begin(session);
  for (const [station, wrong, retry, fragment] of [
    ["left", "water-left", "retry-left", "Nothing was poured"],
    ["right", "flood-right", "retry-right", "Nothing was tipped"],
  ] as const) {
    open(session, station); session.choose(wrong);
    assert.ok(session.dialogue?.lines.some(line => line.includes(fragment)));
    assert.equal(session.quests.flags.get(`${questId}.${station}-tray`), undefined);
    session.choose("restore-cycle"); assert.equal(session.quests.stage(questId), "trays");
    session.choose(retry);
    assert.ok(session.dialogue?.options.some(option => option.id === (station === "left" ? "drain-left" : "seat-wick")));
  }
  tend(session); open(session, "board");
  for (const wrong of ["constant-light", "constant-dark"]) {
    session.choose(wrong);
    assert.ok(session.dialogue?.lines.some(line => line.includes("Nothing was changed")));
    assert.equal(session.quests.stage(questId), "night"); session.choose("retry-timer");
  }
  assert.deepEqual(session.character.serialize(), before);
  assert.equal(session.quests.flags.get("glasshouse.nursery-tended"), undefined);
});

test("the saved timer stage pays once and keeps a readable care receipt after reload", () => {
  const storage = memory(), first = new RpgSession({ world, packs: [GLASSHOUSE_PACK], storage });
  begin(first); tend(first); open(first, "board"); first.choose("constant-light"); first.close(); first.save();
  const restored = new RpgSession({ world, packs: [GLASSHOUSE_PACK], storage });
  assert.equal(restored.quests.stage(questId), "night");
  assert.ok(open(restored, "board").options.some(option => option.id === "restore-cycle"));
  const credits = restored.character.credits;
  assert.equal(restored.choose("restore-cycle").message, null);
  assert.equal(restored.quests.outcome(questId), "rested");
  assert.equal(restored.character.credits, credits + 60); assert.equal(totalXp(restored), 100);
  assert.equal(restored.character.reputation("civilian"), 3);
  assert.equal(restored.quests.flags.get("glasshouse.nursery-tended"), true);
  assert.equal(restored.snapshot().feed.filter(message => message.text.startsWith("Quest complete: A Little Night")).length, 1);
  const reward = restored.character.serialize();
  for (let retry = 0; retry < 3; retry++) {
    const receipt = open(restored, "board");
    assert.ok(receipt.lines.some(line => line.includes("CARE LOG")));
    assert.deepEqual(receipt.options.map(option => option.id), ["leave"]);
    restored.choose("accept-care"); restored.choose("restore-cycle");
    assert.equal(restored.quests.start(questId), false);
    assert.deepEqual(restored.character.serialize(), reward);
  }
  restored.close(); restored.save();
  const complete = new RpgSession({ world, packs: [GLASSHOUSE_PACK], storage });
  assert.ok(open(complete, "board").lines.some(line => line.includes("ONE SHIFT PAID")));
  assert.deepEqual(complete.character.serialize(), reward);
});

test("existing generic floorplan markers automatically follow board, trays and receipt", () => {
  const session = new RpgSession({ world, packs: [GLASSHOUSE_PACK] });
  const markers = () => interiorUseMarkers(venue, session.interactables(venue.id));
  assert.deepEqual(markers().map(marker => marker.id), [GLASSHOUSE_STATIONS.board.id]);
  begin(session);
  assert.deepEqual(markers().map(marker => marker.id), Object.values(GLASSHOUSE_STATIONS).map(object => object.id));
  const description = interiorMapDescription(venue, markers());
  for (const station of Object.values(GLASSHOUSE_STATIONS)) assert.ok(description.includes(station.label));
  assert.deepEqual(interiorUseMarkers(venue, session.interactables("kiln")), []);
  tend(session); open(session, "board"); session.choose("restore-cycle");
  assert.deepEqual(markers().map(marker => marker.id), [GLASSHOUSE_STATIONS.board.id]);
});

test("nursery care and Night Shift main grow-light repairs remain independent in either order", () => {
  for (const nurseryFirst of [false, true]) {
    const session = new RpgSession({ world, packs: [GLASSHOUSE_PACK, NIGHT_SHIFT_PACK] });
    const finishNursery = () => { begin(session); tend(session); open(session, "board"); session.choose("restore-cycle"); session.close(); };
    if (nurseryFirst) { finishNursery(); assert.equal(session.quests.flags.get("night-shift.grow-lights"), undefined); }
    session.talk("mira"); session.choose("accept-light"); session.close();
    for (const place of ["blue-hour", "second-life", "kiln", "glasshouse"]) session.bus.emit({ type: "entered", area: `interior:${place}` });
    assert.equal(session.quests.stage("borrowed-light"), "report");
    assert.equal(session.quests.flags.get("night-shift.grow-lights"), true);
    if (!nurseryFirst) { assert.equal(session.quests.status(questId), "available"); finishNursery(); }
    session.talk("mira"); session.choose("report"); session.close();
    assert.equal(session.quests.status("borrowed-light"), "complete");
    assert.equal(session.quests.status(questId), "complete");
    assert.equal(session.quests.flags.get("night-shift.grow-lights"), true);
  }
});
