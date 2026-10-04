import assert from "node:assert/strict";
import test from "node:test";
import { CityInteriors, interiorFixtures, interiorLocal, interiorPlaces, interiorWorld } from "../src/city/interiors.ts";
import { CityWorld } from "../src/city/world.ts";
import { KILN_WORKBENCH, KILN_WORKBENCH_PACK } from "../src/rpg/content/kiln-workbench.ts";
import { NIGHT_SHIFT_PACK } from "../src/rpg/content/night-shift.ts";
import { ITEMS } from "../src/rpg/items/index.ts";
import { validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld();
const kiln = interiorPlaces(world).find(place => place.id === "kiln");
assert.ok(kiln);
const approach = interiorWorld(kiln, kiln.width / 2 - 2.2, 2.8);
const questId = "kiln-calibration";
const input: RpgFrame["input"] = {
  attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false,
  selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0,
};

function frame(place: string | undefined = "kiln", overrides: Partial<RpgFrame["player"]> = {}): RpgFrame {
  return { dt: 0.1, time: 1, input, player: { ...approach, eye: 2.7, yaw: 0, pitch: 0, mode: "walk", onFoot: !place, place, ...overrides } };
}

function memory() {
  const saved = new Map<string, string>();
  return {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  };
}

function begin(session: RpgSession) {
  session.update(frame());
  assert.ok(session.interactNearby()?.options.some(option => option.id === "accept-calibration"));
  session.choose("accept-calibration");
  assert.equal(session.quests.stage(questId), "earth");
}

test("the workbench validates and its panel has a collision-free approach beside the right-hand machine", () => {
  assert.deepEqual(validateContent(KILN_WORKBENCH_PACK, { id: "catalogue", items: ITEMS }), []);
  const rooms = new CityInteriors(world);
  rooms.active = kiln;
  rooms.fixtures = interiorFixtures(kiln);
  assert.ok(rooms.canOccupy(approach.x, approach.z));
  assert.ok(Math.hypot(approach.x - KILN_WORKBENCH.x, approach.z - KILN_WORKBENCH.z) < 2.6);
  const panel = interiorLocal(kiln, KILN_WORKBENCH.x, KILN_WORKBENCH.z);
  const machine = rooms.fixtures.find(fixture => fixture.kind === "machine" && fixture.x > 0);
  assert.ok(machine);
  assert.ok(Math.abs(machine.x - panel.x) < 0.02);
  assert.ok(Math.abs(panel.z - (machine.z + machine.depth / 2)) < 0.1);
});

test("matching XYZ outside, another room, an unknown place or a non-walking mode cannot activate the bench", () => {
  const session = new RpgSession({ world, packs: [KILN_WORKBENCH_PACK] });
  assert.equal(session.interactables().length, 0);
  assert.equal(session.interactables("kiln")[0]?.id, KILN_WORKBENCH.id);
  for (const current of [frame(""), frame("undertone"), frame("missing-room"), frame("kiln", { mode: "fly" }), frame("kiln", { mode: "drive" }), frame("", { onFoot: false })]) {
    session.update(current);
    assert.equal(session.snapshot().prompt, null);
    assert.equal(session.hasInteraction(), false);
    assert.equal(session.interactNearby(), null);
    assert.equal(session.quests.status(questId), "available");
  }
  session.update(frame());
  assert.equal(session.snapshot().prompt, KILN_WORKBENCH.label);
  assert.equal(session.hasInteraction(), true);
  session.update(frame("", { mode: "fly" }));
  assert.equal(session.interactNearby(), null, "a stale indoor prompt is not authorization");
});

test("interior scope blocks exterior objects, pickups and combat even with an incorrect onFoot flag", () => {
  const probe: ContentPack = {
    id: "outside-probe",
    interactables: [{ ...KILN_WORKBENCH, id: "outside-object", label: "Outside only", place: "", dialogue: undefined, condition: undefined, effects: [{ setFlag: "outside.used" }] }],
  };
  const session = new RpgSession({ world, packs: [KILN_WORKBENCH_PACK, probe] });
  session.update({ ...frame("kiln", { onFoot: true }), input: { ...input, attackHeld: true, attackPressed: true, selectSlot: "sidearm", quickUse: 1 } });
  assert.equal(session.snapshot().prompt, KILN_WORKBENCH.label);
  assert.notEqual(session.playerView().action, "light");
  assert.notEqual(session.playerView().action, "fire");
  session.interactNearby();
  assert.equal(session.quests.flags.get("outside.used"), undefined);
  session.close();
  const beforeDrop = session.character.count("stim");
  session.action({ kind: "drop", item: "stim", count: 1 });
  assert.equal(session.character.count("stim"), beforeDrop);
  const street = { x: 11.5, z: 77 };
  session.worldLoot.drop(street.x, street.z, [{ item: "stim", count: 1 }], 0);
  assert.ok(session.groundLoot(street).length > 0);
  session.update({ ...frame("kiln", { ...street, onFoot: true }), input: { ...input, interactPressed: true } });
  assert.equal(session.snapshot().prompt, null);
  assert.equal(session.character.count("stim"), beforeDrop);
  assert.ok(session.groundLoot(street).length > 0);
  session.update(frame(""));
  assert.equal(session.snapshot().prompt, "Outside only");
  session.interactNearby();
  assert.equal(session.quests.flags.get("outside.used"), true);
});

test("indoor coordinates do not activate exterior areas, proximity quests or area-survival objectives", () => {
  const area = { ...approach, radius: 4 };
  const probes: ContentPack = {
    id: "outdoor-proximity",
    areas: [{ id: "outside-area", ...area }],
    quests: [
      {
        id: "outside-trigger", title: "Outside trigger", category: "gig", giver: null, summary: "Stay outside", trigger: area, start: "wait",
        stages: [{ id: "wait", journal: "Wait", objectives: [{ id: "never", kind: "condition", text: "Wait", condition: { flag: "not-set" } }] }],
        outcomes: { done: { title: "Done", journal: "Done" } },
      },
      {
        id: "outside-hold", title: "Outside hold", category: "side", giver: "mara", summary: "Hold outside", start: "hold",
        stages: [{ id: "hold", journal: "Outside only", objectives: [
          { id: "arrive", kind: "reach", text: "Reach outside", area },
          { id: "hold", kind: "survive", text: "Hold outside", area, seconds: 1 },
        ] }],
        outcomes: { done: { title: "Done", journal: "Done" } },
      },
    ],
  };
  const session = new RpgSession({ world, packs: [probes] });
  session.quests.start("outside-hold");
  const entered: string[] = [];
  session.bus.on("entered", event => entered.push(event.area));
  for (let tick = 0; tick < 20; tick++) session.update(frame());
  assert.deepEqual(entered, []);
  assert.equal(session.quests.status("outside-trigger"), "available");
  assert.equal(session.quests.status("outside-hold"), "active");
  assert.equal(session.quests.flags.get("outside-hold.arrive"), undefined);
  assert.equal(session.quests.flags.get("outside-hold.hold"), undefined);
  for (let tick = 0; tick < 12; tick++) session.update(frame(""));
  assert.deepEqual(entered, ["outside-area"]);
  assert.equal(session.quests.status("outside-trigger"), "active");
  assert.equal(session.quests.status("outside-hold"), "complete");
});

test("the calibration diagnoses mistakes without consuming the bench or skipping required steps", () => {
  const session = new RpgSession({ world, packs: [KILN_WORKBENCH_PACK] });
  begin(session);
  for (const step of [
    { stage: "earth", wrong: "clip-chassis", right: "bond-earth" },
    { stage: "supply", wrong: "furnace-feed", right: "aux-feed" },
    { stage: "load", wrong: "live-rig", right: "dummy-load" },
  ]) {
    session.choose(step.wrong);
    assert.equal(session.quests.stage(questId), step.stage);
    assert.equal(session.character.count("shield-cell"), 0);
    session.close();
    assert.ok(session.interactNearby()?.options.some(option => option.id === step.right));
    session.choose("proof-pulse");
    assert.equal(session.quests.stage(questId), step.stage, "future-step options cannot be forged");
    session.choose(step.right);
  }
  assert.equal(session.quests.stage(questId), "proof");
  session.choose("leave");
  assert.equal(session.quests.status(questId), "active");
  assert.equal(session.character.xp, 0);
  assert.equal(session.character.count("shield-cell"), 0);
});

test("leaving and saving mid-calibration restores the step and a safe exterior save position", () => {
  const storage = memory();
  const first = new RpgSession({ world, packs: [KILN_WORKBENCH_PACK], storage });
  begin(first);
  first.choose("bond-earth");
  first.close();
  first.save();
  const restored = new RpgSession({ world, packs: [KILN_WORKBENCH_PACK], storage });
  assert.deepEqual(restored.savedPosition, kiln.entrance);
  assert.equal(restored.quests.stage(questId), "supply");
  restored.update(frame(""));
  assert.equal(restored.interactNearby(), null);
  restored.update(frame());
  assert.ok(restored.interactNearby()?.options.some(option => option.id === "aux-feed"));
  restored.choose("aux-feed");
  restored.choose("dummy-load");
  const result = restored.choose("proof-pulse");
  assert.equal(result.message, null);
  assert.equal(restored.quests.outcome(questId), "certified");
  assert.equal(restored.character.count("shield-cell"), 1);
  assert.equal(restored.character.xp, 120);
  assert.equal(restored.quests.flags.get("kiln.bench-certified"), true);
  assert.equal(restored.interactables("kiln").length, 0);
  const reward = JSON.stringify(restored.character.state);
  for (let repeat = 0; repeat < 4; repeat++) {
    restored.choose("proof-pulse");
    restored.choose("accept-calibration");
    assert.equal(restored.interactNearby(), null);
    assert.equal(restored.quests.start(questId), false);
  }
  restored.save();
  const complete = new RpgSession({ world, packs: [KILN_WORKBENCH_PACK], storage });
  complete.update(frame());
  assert.equal(complete.interactNearby(), null);
  assert.equal(JSON.stringify(complete.character.state), reward);
});

test("session quest notifications use one delivery path without deduplicating separate loot events", () => {
  const session = new RpgSession({ world, packs: [NIGHT_SHIFT_PACK] });
  session.talk("mira");
  assert.equal(session.choose("accept-light").message, null);
  session.close();
  for (const venue of ["blue-hour", "second-life", "kiln", "glasshouse"]) session.bus.emit({ type: "entered", area: `interior:${venue}` });
  session.talk("mira");
  assert.equal(session.choose("report").message, null);
  assert.equal(session.snapshot().feed.filter(message => message.text === "Quest complete: Borrowed Light · +220 cr").length, 1);
  session.bus.emit({ type: "message", text: "+ Stim", tone: "loot" });
  session.bus.emit({ type: "message", text: "+ Stim", tone: "loot" });
  assert.equal(session.snapshot().feed.filter(message => message.text === "+ Stim").length, 2);
});

test("interactable scope validation rejects whitespace and malformed room identifiers", () => {
  for (const place of [" ", "Kiln Nine", "../kiln", "kiln:room"]) {
    const invalid: ContentPack = { ...KILN_WORKBENCH_PACK, interactables: [{ ...KILN_WORKBENCH, place }] };
    assert.ok(validateContent(invalid).some(error => error.includes("place must be a lowercase interior id")));
  }
});
