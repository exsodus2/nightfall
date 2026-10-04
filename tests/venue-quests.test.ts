import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld } from "../src/city/world.ts";
import { RpgSession } from "../src/rpg/session.ts";
import { validateContent } from "../src/rpg/quests/index.ts";
import type { ContentPack } from "../src/rpg/types.ts";

const world = new CityWorld();
const pack: ContentPack = {
  id: "venue-test",
  quests: [{
    id: "venue-tour", title: "Two Doors", category: "side", giver: "mara", summary: "Visit two rooms.", start: "visit",
    stages: [{ id: "visit", journal: "Go inside, not just past the door.", objectives: [
      { id: "tea", kind: "visit", area: "interior:blue-hour", text: "Enter Blue Hour", target: { x: -45, z: 73.01 } },
      { id: "bar", kind: "visit", area: "interior:undertone", text: "Enter Undertone", target: { x: 45, z: -248.54 } },
    ] }],
    outcomes: { done: { title: "Night people", journal: "Both doors were open.", effects: [{ credits: 80 }] } },
  }],
};

test("venue objectives require matching entry after acceptance, not proximity or past visits", () => {
  assert.deepEqual(validateContent(pack), []);
  const session = new RpgSession({ world, packs: [pack] });
  session.bus.emit({ type: "entered", area: "interior:blue-hour" });
  assert.ok(session.quests.start("venue-tour"));
  session.quests.update(0.1, { x: -45, z: 73.01 });
  assert.equal(session.quests.flags.get("venue-tour.tea"), undefined);
  session.bus.emit({ type: "entered", area: "interior:kiln" });
  session.bus.emit({ type: "left", area: "interior:blue-hour" });
  assert.equal(session.quests.flags.get("venue-tour.tea"), undefined);
  session.bus.emit({ type: "entered", area: "interior:blue-hour" });
  assert.equal(session.quests.flags.get("venue-tour.tea"), true);
  assert.equal(session.quests.status("venue-tour"), "active");
  session.bus.emit({ type: "entered", area: "interior:undertone" });
  assert.equal(session.quests.status("venue-tour"), "complete");
  const credits = session.character.credits;
  for (let repeat = 0; repeat < 8; repeat++) session.bus.emit({ type: "entered", area: "interior:undertone" });
  assert.equal(session.character.credits, credits, "duplicate entry cannot pay twice");
});

test("completed venue visits survive save/restore with their doorway navigation targets", () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
  const first = new RpgSession({ world, packs: [pack], storage });
  first.quests.start("venue-tour");
  first.bus.emit({ type: "entered", area: "interior:blue-hour" });
  first.save({ x: -45, z: 73.01, yaw: 0 });
  const restored = new RpgSession({ world, packs: [pack], storage });
  assert.equal(restored.quests.flags.get("venue-tour.tea"), true);
  assert.equal(restored.quests.status("venue-tour"), "active");
  const tracked = restored.questSnapshot(null).tracked;
  assert.ok(tracked);
  assert.equal(tracked.targetX, 45);
  assert.equal(tracked.targetZ, -248.54);
  restored.bus.emit({ type: "entered", area: "interior:undertone" });
  assert.equal(restored.quests.status("venue-tour"), "complete");
});

test("visit authoring rejects blank area ids", () => {
  const invalid: ContentPack = { ...pack, quests: pack.quests?.map(quest => ({ ...quest, stages: [{ ...quest.stages[0], objectives: [{ id: "missing", kind: "visit", area: " ", text: "Missing place" }] }] })) };
  assert.ok(validateContent(invalid).some(error => error.includes("visit needs a named area id")));
});
