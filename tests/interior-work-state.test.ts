import assert from "node:assert/strict";
import test from "node:test";
import { interiorLocal, interiorPlaces, interiorWorld } from "../src/city/interiors.ts";
import { interiorWorkState, type InteriorWorkReader } from "../src/city/interior-work-state.ts";
import { CityWorld } from "../src/city/world.ts";
import { DEAD_LETTER_PACK, DEAD_LETTER_STATIONS } from "../src/rpg/content/dead-letter.ts";
import { GLASSHOUSE_PACK, GLASSHOUSE_STATIONS } from "../src/rpg/content/glasshouse.ts";
import { KILN_WORKBENCH, KILN_WORKBENCH_PACK } from "../src/rpg/content/kiln-workbench.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { InteractableDefinition, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld(), places = interiorPlaces(world);
const packs = [GLASSHOUSE_PACK, KILN_WORKBENCH_PACK, DEAD_LETTER_PACK];
const input: RpgFrame["input"] = {
  attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false,
  selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0,
};

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

function open(session: RpgSession, station: InteractableDefinition) {
  const place = places.find(venue => venue.id === station.place);
  assert.ok(place);
  const local = interiorLocal(place, station.x, station.z);
  session.close();
  session.update({ dt: 0.1, time: 1, input, player: { ...interiorWorld(place, local.x, local.z + 1.05), eye: 2.7, yaw: place.yaw, pitch: 0, mode: "walk", onFoot: false, place: place.id } });
  assert.equal(session.interactNearby()?.npcId, station.id);
}

function restore(session: RpgSession, storage: ReturnType<typeof memory>) {
  session.close(); session.save();
  return new RpgSession({ world, packs, storage });
}

function state(session: RpgSession, place: string) {
  const before = session.quests.serialize(), character = session.character.serialize();
  const result = interiorWorkState(place, session.quests);
  assert.deepEqual(session.quests.serialize(), before);
  assert.deepEqual(session.character.serialize(), character);
  assert.ok(result);
  assert.equal(result.place, place);
  return result;
}

test("exterior, unused and unavailable rooms do not inspect unrelated quest state", () => {
  const fail = (): never => { throw Error("Unexpected quest read"); };
  const reader: InteriorWorkReader = { flags: { get: fail }, status: fail, stage: fail };
  for (const place of [undefined, null, "", "undertone", "blue-hour", "second-life", "missing"]) assert.equal(interiorWorkState(place, reader), null);
  for (const status of ["locked", "failed"] as const) for (const place of ["glasshouse", "kiln", "dead-letter"]) {
    assert.equal(interiorWorkState(place, { ...reader, status: () => status }), null);
  }
});

test("wrong flag values and unstarted work never claim a completed fixture", () => {
  const flags = new Map<string, boolean | string>([
    ["a-little-night.left-tray", "water-left"], ["a-little-night.right-tray", true], ["glasshouse.nursery-tended", "true"],
    ["kiln-calibration.earth-bond", "clip-chassis"], ["kiln-calibration.aux-feed", "aux-feed"], ["kiln-calibration.test-load", "dummy-load"], ["kiln.bench-certified", "true"],
    ["dead-letter.publication", "home"], ["last-good-signal.venue-route", "route-blue-hour"],
  ]);
  const reader: InteriorWorkReader = { flags, status: () => "complete", stage: () => "publish" };
  assert.deepEqual(interiorWorkState("glasshouse", reader)?.tags.map(tag => tag.text), ["DRAIN", "WICK", "DAY"]);
  assert.equal(interiorWorkState("kiln", reader)?.tags[0].text, "0/3");
  assert.equal(interiorWorkState("dead-letter", reader)?.tags[0].text, "HOLD");
  assert.equal(interiorWorkState("dead-letter", { ...reader, status: () => "active" })?.tags[0].text, "HOLD");
  const unread: InteriorWorkReader = { flags: { get: () => { throw Error("An unstarted quest has no fixture progress"); } }, status: () => "available", stage: () => null };
  for (const place of ["glasshouse", "kiln", "dead-letter"]) assert.ok(interiorWorkState(place, unread));
});

test("Glasshouse tags follow explicit care, safe mistakes, partial reloads and the restored cycle", () => {
  const storage = memory();
  let session = new RpgSession({ world, packs, storage });
  const text = () => state(session, "glasshouse").tags.map(tag => tag.text);
  assert.deepEqual(text(), ["DRAIN", "WICK", "DAY"]);
  open(session, GLASSHOUSE_STATIONS.board); session.choose("leave");
  assert.deepEqual(text(), ["DRAIN", "WICK", "DAY"]);
  open(session, GLASSHOUSE_STATIONS.board); session.choose("accept-care");
  open(session, GLASSHOUSE_STATIONS.left); session.choose("water-left");
  assert.deepEqual(text(), ["DRAIN", "WICK", "DAY"]);
  session = restore(session, storage);
  assert.deepEqual(text(), ["DRAIN", "WICK", "DAY"]);
  open(session, GLASSHOUSE_STATIONS.left); session.choose("drain-left");
  assert.deepEqual(text(), ["OK", "WICK", "DAY"]);
  session = restore(session, storage);
  assert.deepEqual(text(), ["OK", "WICK", "DAY"]);
  open(session, GLASSHOUSE_STATIONS.right); session.choose("flood-right");
  assert.deepEqual(text(), ["OK", "WICK", "DAY"]);
  session.choose("retry-right"); session.choose("seat-wick");
  assert.deepEqual(text(), ["OK", "OK", "DAY"]);
  open(session, GLASSHOUSE_STATIONS.board);
  for (const wrong of ["constant-light", "constant-dark"]) {
    session.choose(wrong); assert.deepEqual(text(), ["OK", "OK", "DAY"]); session.choose("retry-timer");
  }
  session.choose("restore-cycle");
  assert.deepEqual(text(), ["OK", "OK", "16/8"]);
  assert.ok(state(session, "glasshouse").tags.every(tag => tag.settled));
  session = restore(session, storage);
  assert.deepEqual(text(), ["OK", "OK", "16/8"]);
  open(session, GLASSHOUSE_STATIONS.board); session.choose("leave");
  assert.deepEqual(text(), ["OK", "OK", "16/8"]);
});

test("Kiln plate counts only safe connections and keeps PASS after the USE panel disappears", () => {
  const storage = memory();
  let session = new RpgSession({ world, packs, storage });
  const text = () => state(session, "kiln").tags[0].text;
  open(session, KILN_WORKBENCH); session.close();
  assert.equal(text(), "0/3");
  open(session, KILN_WORKBENCH); session.choose("accept-calibration");
  for (const [wrong, retry, correct, before, after] of [
    ["clip-chassis", "retry-earth", "bond-earth", "0/3", "1/3"],
    ["furnace-feed", "retry-supply", "aux-feed", "1/3", "2/3"],
    ["live-rig", "retry-load", "dummy-load", "2/3", "READY"],
  ]) {
    open(session, KILN_WORKBENCH); session.choose(wrong); assert.equal(text(), before);
    session.choose(retry); session.choose(correct); assert.equal(text(), after);
    session = restore(session, storage); assert.equal(text(), after);
  }
  open(session, KILN_WORKBENCH); session.choose("proof-pulse");
  assert.equal(text(), "PASS");
  assert.ok(state(session, "kiln").tags[0].settled);
  assert.deepEqual(session.interactables("kiln"), []);
  session = restore(session, storage); assert.equal(text(), "PASS");
});

for (const [choice, detail] of [["publish-anonymous", "ANON"], ["publish-callback", "DESK"]] as const) test(`Dead Letter ${detail} receipt appears only after verification, routing and consented publication`, () => {
  const storage = memory();
  let session = new RpgSession({ world, packs, storage });
  const text = () => state(session, "dead-letter").tags[0].text;
  open(session, DEAD_LETTER_STATIONS.counter); session.close(); assert.equal(text(), "HOLD");
  open(session, DEAD_LETTER_STATIONS.counter); session.choose("accept-signal");
  open(session, DEAD_LETTER_STATIONS.archive); session.choose("confirm-ledger");
  session = restore(session, storage); assert.equal(text(), "HOLD");
  open(session, DEAD_LETTER_STATIONS.relay); session.choose("confirm-spool");
  open(session, DEAD_LETTER_STATIONS.relay);
  for (const wrong of ["select-041", "select-043"]) {
    session.choose(wrong); assert.equal(text(), "HOLD"); session.choose("retry-verification");
  }
  session.choose("select-042"); assert.equal(text(), "HOLD");
  session.choose("route-blue-hour"); assert.equal(text(), "HOLD");
  session.choose("retry-route"); session.choose("route-glasshouse"); assert.equal(text(), "QUEUE");
  session = restore(session, storage); assert.equal(text(), "QUEUE");
  open(session, DEAD_LETTER_STATIONS.counter); session.choose("publish-home"); assert.equal(text(), "QUEUE");
  session.choose("retry-publication"); session.choose(choice);
  assert.equal(text(), "SENT"); assert.equal(state(session, "dead-letter").tags[0].detail, detail);
  session = restore(session, storage);
  open(session, DEAD_LETTER_STATIONS.counter); session.choose("leave");
  assert.equal(text(), "SENT"); assert.equal(state(session, "dead-letter").tags[0].detail, detail);
});
