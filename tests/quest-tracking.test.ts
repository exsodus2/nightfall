import assert from "node:assert/strict";
import test from "node:test";
import { interiorPlaces, interiorWorld } from "../src/city/interiors.ts";
import { CityWorld } from "../src/city/world.ts";
import { NIGHT_SHIFT_PACK, NIGHT_SHIFT_VENUES } from "../src/rpg/content/night-shift.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld();
const packs = [NIGHT_SHIFT_PACK];
const input: RpgFrame["input"] = { attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 };
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function startBoth(session: RpgSession) {
  assert.equal(session.quests.start("borrowed-light"), true);
  assert.equal(session.quests.start("relay-chip"), true);
  assert.equal(session.questSnapshot(null).tracked?.id, "relay-chip");
}

test("ledger tracking selects an earlier contract without changing gameplay or opening a conversation", () => {
  const session = new RpgSession({ world, packs });
  startBoth(session);
  const character = session.character.serialize(), before = session.quests.serialize();
  const feed = session.snapshot().feed;
  session.action({ kind: "trackQuest", quest: "borrowed-light" });
  const tracked = session.questSnapshot(null).tracked;
  assert.equal(tracked?.id, "borrowed-light");
  assert.equal(tracked?.targetX, NIGHT_SHIFT_VENUES["blue-hour"].x);
  assert.equal(tracked?.targetZ, NIGHT_SHIFT_VENUES["blue-hour"].z);
  assert.deepEqual(session.quests.serialize(), { ...before, tracked: "borrowed-light" });
  assert.deepEqual(session.character.serialize(), character);
  assert.deepEqual(session.snapshot().feed, feed);
  assert.equal(session.dialogue, null);
  session.action({ kind: "trackQuest", quest: "relay-chip" });
  assert.equal(session.questSnapshot(null).tracked?.id, "relay-chip");
});

test("selected contracts survive saving indoors and reload with a safe doorway return", () => {
  const storage = memory(), session = new RpgSession({ world, packs, storage });
  startBoth(session);
  const place = interiorPlaces(world).find(candidate => candidate.id === "blue-hour");
  assert.ok(place);
  session.update({ dt: 0.1, time: 1, input, player: { ...interiorWorld(place, 0, 2), place: place.id, eye: 2.7, yaw: place.yaw, pitch: 0, mode: "walk", onFoot: false } });
  session.action({ kind: "trackQuest", quest: "borrowed-light" });
  session.save();
  const restored = new RpgSession({ world, packs, storage });
  assert.equal(restored.questSnapshot(null).tracked?.id, "borrowed-light");
  assert.deepEqual(restored.savedPosition, place.entrance);
  assert.deepEqual(restored.quests.serialize(), session.quests.serialize());
  assert.deepEqual(restored.character.serialize(), session.character.serialize());
});

test("ready hand-ins remain trackable, and completed, locked and unknown contracts cannot steal selection", () => {
  const session = new RpgSession({ world, packs });
  startBoth(session);
  session.talk("juno"); session.choose("step-0"); session.close();
  assert.equal(session.questSnapshot(null).log.find(entry => entry.id === "relay-chip")?.status, "ready");
  session.action({ kind: "trackQuest", quest: "borrowed-light" });
  session.action({ kind: "trackQuest", quest: "relay-chip" });
  assert.equal(session.questSnapshot(null).tracked?.id, "relay-chip");
  session.talk("mara"); session.choose("complete"); session.close();
  assert.equal(session.quests.status("relay-chip"), "complete");
  assert.equal(session.questSnapshot(null).tracked?.id, "borrowed-light");
  const before = session.quests.serialize(), character = session.character.serialize();
  for (const quest of ["relay-chip", "small-hours-signal", "missing-contract", "", "borrowed-light"]) {
    session.action({ kind: "trackQuest", quest });
    assert.equal(session.questSnapshot(null).tracked?.id, "borrowed-light");
  }
  assert.deepEqual(session.character.serialize(), character);
  assert.deepEqual(session.quests.serialize(), { ...before, tracked: "borrowed-light" });
});

test("failed tracked contracts fall back to remaining work and cannot be selected again", () => {
  const timed: ContentPack = { id: "tracking-timeout", quests: [{ id: "tracking-timeout", title: "Late train", category: "gig", giver: null, summary: "Reach the platform.", start: "run", stages: [{ id: "run", journal: "The doors are closing.", timeLimit: 0.1, objectives: [{ id: "platform", kind: "reach", text: "Reach the platform", area: { x: 128, z: 128, radius: 2 } }] }], outcomes: { done: { title: "Aboard", journal: "Made it." } } }] };
  const session = new RpgSession({ world, packs: [...packs, timed] });
  assert.equal(session.quests.start("borrowed-light"), true);
  assert.equal(session.quests.start("tracking-timeout"), true);
  session.action({ kind: "trackQuest", quest: "tracking-timeout" });
  session.quests.update(0.2, { x: 12, z: 77 });
  assert.equal(session.quests.status("tracking-timeout"), "failed");
  assert.equal(session.questSnapshot(null).tracked?.id, "borrowed-light");
  session.action({ kind: "trackQuest", quest: "tracking-timeout" });
  assert.equal(session.questSnapshot(null).tracked?.id, "borrowed-light");
});
