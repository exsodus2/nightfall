import assert from "node:assert/strict";
import test from "node:test";
import { CityInteriors, interiorFixtures, interiorLocal, interiorPlaces, interiorWorld } from "../src/city/interiors.ts";
import { CityWorld } from "../src/city/world.ts";
import { DEAD_LETTER_PACK, DEAD_LETTER_STATIONS } from "../src/rpg/content/dead-letter.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import { NIGHT_SHIFT_PACK } from "../src/rpg/content/night-shift.ts";
import { ITEMS, xpToNext } from "../src/rpg/items/index.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld(), questId = "last-good-signal";
const foundVenue = interiorPlaces(world).find(place => place.id === "dead-letter");
assert.ok(foundVenue);
const venue = foundVenue;
type Station = keyof typeof DEAD_LETTER_STATIONS;
const input: RpgFrame["input"] = {
  attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false,
  selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0,
};
const fixtures = interiorFixtures(venue);
const fixtureFor = (station: Station) => fixtures.find(fixture => station === "counter" ? fixture.kind === "counter" : station === "archive" ? fixture.kind === "shelf" && fixture.x < 0 : fixture.kind === "machine" && fixture.x > 0);
const approach = (station: Station) => {
  const fixture = fixtureFor(station);
  assert.ok(fixture);
  return interiorWorld(venue, fixture.x, fixture.z + fixture.depth / 2 + 1.1);
};

function frame(station: Station, place = "dead-letter", mode: RpgFrame["player"]["mode"] = "walk"): RpgFrame {
  return { dt: 0.1, time: 1, input, player: { ...approach(station), eye: 2.7, yaw: venue.yaw, pitch: 0, mode, onFoot: !place, place } };
}

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

function open(session: RpgSession, station: Station) {
  session.close(); session.update(frame(station));
  const dialogue = session.interactNearby();
  assert.equal(dialogue?.npcId, DEAD_LETTER_STATIONS[station].id);
  assert.ok(dialogue);
  return dialogue;
}

function begin(session: RpgSession) {
  assert.ok(open(session, "counter").options.some(option => option.id === "accept-signal"));
  session.choose("accept-signal");
  assert.equal(session.quests.stage(questId), "evidence");
  session.close();
}

function logEvidence(session: RpgSession, stations: readonly ("archive" | "relay")[] = ["archive", "relay"]) {
  for (const station of stations) {
    open(session, station);
    session.choose(station === "archive" ? "confirm-ledger" : "confirm-spool");
    session.close();
  }
  assert.equal(session.quests.stage(questId), "verify");
}

function totalXp(session: RpgSession): number {
  let total = session.character.xp;
  for (let level = 1; level < session.character.level; level++) total += xpToNext(level);
  return total;
}

test("Dead Letter registers and validates against the complete authored content", () => {
  assert.ok(CONTENT_PACKS.includes(DEAD_LETTER_PACK));
  assert.deepEqual(validateContent(DEAD_LETTER_PACK), []);
  const packs = [...CONTENT_PACKS, LEGACY_PACK, { id: "catalogue", items: ITEMS }];
  const combined: ContentPack = {
    id: "all-content", npcs: packs.flatMap(pack => pack.npcs ?? []), items: packs.flatMap(pack => pack.items ?? []),
    loot: packs.flatMap(pack => pack.loot ?? []), archetypes: packs.flatMap(pack => pack.archetypes ?? []),
    encounters: packs.flatMap(pack => pack.encounters ?? []), quests: packs.flatMap(pack => pack.quests ?? []),
    dialogues: packs.flatMap(pack => pack.dialogues ?? []), interactables: packs.flatMap(pack => pack.interactables ?? []),
    areas: packs.flatMap(pack => pack.areas ?? []), vendors: packs.flatMap(pack => pack.vendors ?? []),
  };
  assert.deepEqual(validateContent(combined), []);
  assert.equal(DEAD_LETTER_PACK.quests?.[0].repeatable, undefined);
  assert.equal(DEAD_LETTER_PACK.quests?.[0].trigger, undefined);
  assert.equal(DEAD_LETTER_PACK.quests?.[0].requires, undefined);
});

test("all three stations sit on real furniture with clear, unambiguous approaches", () => {
  const rooms = new CityInteriors(world);
  rooms.active = venue; rooms.fixtures = fixtures;
  for (const station of ["counter", "archive", "relay"] as const) {
    const object = DEAD_LETTER_STATIONS[station], fixture = fixtureFor(station), position = approach(station);
    assert.ok(fixture);
    assert.equal(object.place, venue.id);
    assert.notEqual(object.once, true);
    assert.ok(rooms.canOccupy(position.x, position.z));
    assert.equal(rooms.atExit(position.x, position.z), false);
    assert.ok(Math.hypot(position.x - object.x, position.z - object.z) < 1.1);
    const local = interiorLocal(venue, object.x, object.z);
    assert.ok(Math.abs(local.x - fixture.x) < 0.02);
    assert.ok(Math.abs(local.z - fixture.z - fixture.depth / 2 - 0.05) < 0.02);
    for (const other of Object.values(DEAD_LETTER_STATIONS)) if (other.id !== object.id) assert.ok(Math.hypot(position.x - other.x, position.z - other.z) > 2.6);
    const from = interiorWorld(venue, 0, local.z + 1.05);
    for (let step = 0; step <= 20; step++) assert.ok(rooms.canOccupy(from.x + (position.x - from.x) * step / 20, from.z + (position.z - from.z) * step / 20));
  }
});

test("the public desk cannot be used outside, in the wrong room, or from a vehicle", () => {
  const session = new RpgSession({ world, packs: [DEAD_LETTER_PACK] });
  assert.equal(session.interactables().length, 0);
  assert.deepEqual(session.interactables("dead-letter").map(object => object.id), [DEAD_LETTER_STATIONS.counter.id]);
  for (const playerFrame of [frame("counter", ""), frame("counter", "kiln"), frame("counter", "missing"), frame("counter", "dead-letter", "drive"), frame("counter", "dead-letter", "fly")]) {
    session.update(playerFrame);
    assert.equal(session.interactNearby(), null);
    assert.equal(session.quests.status(questId), "available");
  }
  begin(session);
  for (const station of ["archive", "relay"] as const) {
    session.update(frame(station, ""));
    assert.equal(session.interactNearby(), null);
  }
  assert.equal(session.quests.flags.get("dead-letter.ledger"), undefined);
  assert.equal(session.quests.flags.get("dead-letter.spool"), undefined);
});

for (const station of ["archive", "relay"] as const) for (const exit of ["leave", "escape"] as const) test(`${station}: ${exit}, save and reload never consumes unread evidence`, () => {
  const storage = memory(), first = new RpgSession({ world, packs: [DEAD_LETTER_PACK], storage });
  const flag = station === "archive" ? "dead-letter.ledger" : "dead-letter.spool";
  const confirm = station === "archive" ? "confirm-ledger" : "confirm-spool";
  begin(first); open(first, station);
  assert.equal(first.quests.flags.get(flag), undefined);
  if (exit === "leave") first.choose("leave"); else first.close();
  first.save();
  const restored = new RpgSession({ world, packs: [DEAD_LETTER_PACK], storage });
  assert.deepEqual(restored.savedPosition, venue.entrance);
  assert.ok(open(restored, station).options.some(option => option.id === confirm));
  restored.choose("publish-anonymous");
  assert.equal(restored.quests.flags.get(flag), undefined);
  restored.choose(confirm);
  assert.equal(restored.quests.flags.get(flag), true);
  assert.equal(restored.quests.stage(questId), "evidence");
  assert.equal(totalXp(restored), 0);
  restored.close(); restored.save();
  const confirmed = new RpgSession({ world, packs: [DEAD_LETTER_PACK], storage });
  assert.equal(confirmed.quests.flags.get(flag), true);
  assert.ok(!open(confirmed, station).options.some(option => option.id === confirm));
});

test("either evidence order works, and glances or forged future choices do not advance the queue", () => {
  for (const stations of [["archive", "relay"], ["relay", "archive"]] as const) {
    const session = new RpgSession({ world, packs: [DEAD_LETTER_PACK] });
    begin(session);
    open(session, "relay"); session.choose("select-042"); session.choose("route-glasshouse");
    assert.equal(session.quests.stage(questId), "evidence");
    logEvidence(session, stations);
    assert.ok(open(session, "relay").options.some(option => option.id === "select-042"));
  }
});

test("stale, unsigned, misrouted and unconsented choices explain the problem and remain retryable", () => {
  const session = new RpgSession({ world, packs: [DEAD_LETTER_PACK] });
  begin(session); logEvidence(session); open(session, "relay");
  const credits = session.character.credits;
  for (const [choice, fragment] of [["select-041", "supersedes"], ["select-043", "no verified sender"]]) {
    session.choose(choice);
    assert.ok(session.dialogue?.lines.some(line => line.includes(fragment)));
    assert.equal(session.quests.stage(questId), "verify");
    session.choose("route-glasshouse"); session.choose("publish-callback");
    assert.equal(session.quests.stage(questId), "verify");
    session.choose("retry-verification");
  }
  session.choose("select-042");
  for (const choice of ["route-blue-hour", "route-second-life"]) {
    session.choose(choice);
    assert.ok(session.dialogue?.lines.some(line => line.includes("DESTINATION MISMATCH")));
    assert.equal(session.quests.stage(questId), "route");
    session.choose("retry-route");
  }
  session.choose("route-glasshouse"); open(session, "counter"); session.choose("publish-home");
  assert.ok(session.dialogue?.lines.some(line => line.includes("PRIVACY INTERLOCK")));
  assert.equal(session.quests.stage(questId), "publish");
  assert.equal(session.quests.flags.get("dead-letter.publication"), undefined);
  assert.equal(session.character.credits, credits);
  assert.equal(totalXp(session), 0);
  session.choose("retry-publication");
  assert.ok(session.dialogue?.options.some(option => option.id === "publish-anonymous"));
});

for (const outcome of ["anonymous", "callback"] as const) test(`${outcome}: route progress survives reload, pays once, and leaves a readable receipt`, () => {
  const storage = memory(), first = new RpgSession({ world, packs: [DEAD_LETTER_PACK], storage });
  begin(first); logEvidence(first); open(first, "relay"); first.choose("select-042");
  first.close(); first.save();
  const restored = new RpgSession({ world, packs: [DEAD_LETTER_PACK], storage });
  assert.equal(restored.quests.stage(questId), "route");
  assert.ok(open(restored, "relay").options.some(option => option.id === "route-glasshouse"));
  restored.choose("route-glasshouse"); restored.choose("leave"); restored.save();
  const publishing = new RpgSession({ world, packs: [DEAD_LETTER_PACK], storage });
  assert.equal(publishing.quests.stage(questId), "publish");
  open(publishing, "counter");
  const credits = publishing.character.credits;
  const result = publishing.choose(`publish-${outcome}`);
  assert.equal(result.message, null);
  assert.equal(publishing.quests.outcome(questId), outcome);
  assert.equal(publishing.character.credits, credits + (outcome === "anonymous" ? 90 : 130));
  assert.equal(totalXp(publishing), 150);
  assert.equal(publishing.character.reputation("civilian"), outcome === "anonymous" ? 6 : 4);
  assert.equal(publishing.character.reputation("ghosts"), outcome === "anonymous" ? 3 : 0);
  assert.equal(publishing.quests.flags.get("dead-letter.publication"), outcome);
  assert.equal(publishing.snapshot().feed.filter(message => message.text.startsWith("Quest complete: Last Good Signal")).length, 1);
  assert.deepEqual(publishing.interactables("dead-letter").map(object => object.id), [DEAD_LETTER_STATIONS.counter.id]);
  const reward = JSON.stringify(publishing.character.state);
  for (let retry = 0; retry < 3; retry++) {
    const receipt = open(publishing, "counter");
    assert.ok(receipt.lines.some(line => line.includes("SENT RECEIPT")));
    assert.ok(receipt.lines.some(line => line.includes("Home line sealed")));
    publishing.choose("publish-anonymous"); publishing.choose("publish-callback"); publishing.choose("accept-signal");
    assert.equal(publishing.quests.start(questId), false);
  }
  publishing.close(); publishing.save();
  const complete = new RpgSession({ world, packs: [DEAD_LETTER_PACK], storage });
  assert.ok(open(complete, "counter").lines.some(line => line.includes("SENT RECEIPT")));
  assert.equal(JSON.stringify(complete.character.state), reward);
});

test("Night Shift can route through Dead Letter while the bulletin job is active", () => {
  const session = new RpgSession({ world, packs: [DEAD_LETTER_PACK, NIGHT_SHIFT_PACK] });
  begin(session);
  session.talk("mira"); session.choose("accept-light"); session.close();
  for (const place of ["blue-hour", "second-life", "kiln", "glasshouse"]) session.bus.emit({ type: "entered", area: `interior:${place}` });
  session.talk("mira"); session.choose("report"); session.close();
  session.talk("mira"); session.choose("accept-signal"); session.close();
  session.bus.emit({ type: "entered", area: "interior:undertone" });
  assert.equal(session.quests.stage("small-hours-signal"), "relay");
  session.bus.emit({ type: "entered", area: "interior:dead-letter" });
  assert.equal(session.quests.stage("small-hours-signal"), "handoff");
  assert.equal(session.quests.stage(questId), "evidence");
  assert.equal(session.quests.flags.get("dead-letter.ledger"), undefined);
  session.bus.emit({ type: "entered", area: "interior:blue-hour" });
  session.talk("mira"); session.choose("public"); session.close();
  logEvidence(session); open(session, "relay"); session.choose("select-042"); session.choose("route-glasshouse");
  open(session, "counter"); session.choose("publish-callback");
  assert.equal(session.quests.flags.get("night-shift.channel"), "public");
  assert.equal(session.quests.outcome("small-hours-signal"), "public");
  assert.equal(session.quests.outcome(questId), "callback");
});
