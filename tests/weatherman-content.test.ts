import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld } from "../src/city/world.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import { RpgSession } from "../src/rpg/session.ts";

const world = new CityWorld();
const questId = "weatherman";
const terminalId = "weather-cctv";

function memory() {
  const saved = new Map<string, string>();
  return {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  };
}

function start(session: RpgSession) {
  session.talk("kestrel");
  session.choose("ask-weatherman");
  session.choose("accept");
  session.close();
  assert.equal(session.quests.stage(questId), "investigate");
}

function canUseTerminal(session: RpgSession) {
  return session.quests.interactables().some(object => object.id === terminalId);
}

function footageObjective(session: RpgSession) {
  return session.quests.log().find(quest => quest.id === questId)?.objectives?.find(objective => objective.text === "Recover the arcade's security recording");
}

test("opening the CCTV and leaving or closing the dialogue does not consume it, including after reload", () => {
  const storage = memory();
  const session = new RpgSession({ world, packs: CONTENT_PACKS, storage });
  start(session);
  assert.equal(footageObjective(session)?.done, false);
  for (const close of ["leave", "escape"] as const) {
    assert.ok(session.quests.interact(terminalId)?.options.some(option => option.id === "scrub"));
    if (close === "leave") session.choose("leave");
    else session.close();
    assert.equal(session.dialogue, null);
    assert.equal(canUseTerminal(session), true);
    assert.equal(footageObjective(session)?.done, false);
    assert.equal(session.quests.flags.get("weather.footage"), undefined);
    assert.equal(session.quests.flags.get("weather.hum"), undefined);
  }
  session.save({ x: 466, z: 272, yaw: 0 });
  const restored = new RpgSession({ world, packs: CONTENT_PACKS, storage });
  assert.equal(restored.quests.stage(questId), "investigate");
  assert.equal(canUseTerminal(restored), true);
  assert.equal(footageObjective(restored)?.done, false);
  assert.ok(restored.quests.interact(terminalId)?.options.some(option => option.id === "scrub"));
});

test("old saves with a consumed but unread CCTV can retry without restarting the quest", () => {
  const storage = memory();
  const session = new RpgSession({ world, packs: CONTENT_PACKS, storage });
  start(session);
  const state = session.quests.serialize();
  session.quests.load({ ...state, used: [...state.used, terminalId] });
  session.save({ x: 466, z: 272, yaw: 0 });
  const restored = new RpgSession({ world, packs: CONTENT_PACKS, storage });
  assert.equal(canUseTerminal(restored), true);
  restored.quests.interact(terminalId);
  restored.choose("scrub");
  assert.equal(restored.quests.flags.get("weather.hum"), true);
  assert.equal(canUseTerminal(restored), false);
});

for (const evidence of ["hum", "footage"] as const) {
  test(`recovering ${evidence} grants the clue once, unlocks the right deduction and pays once`, () => {
    const storage = memory();
    const session = new RpgSession({ world, packs: CONTENT_PACKS, storage });
    start(session);
    if (evidence === "footage") session.character.add("focus-chip", 1);
    const clues: string[] = [];
    session.bus.on("flag", event => { if (event.key === "weather.hum" || event.key === "weather.footage") clues.push(event.key); });
    session.quests.interact(terminalId);
    session.choose("scrub");
    assert.equal(session.quests.flags.get(`weather.${evidence}`), true);
    assert.equal(session.quests.flags.get(`weather.${evidence === "hum" ? "footage" : "hum"}`), undefined);
    assert.equal(footageObjective(session)?.done, true);
    assert.equal(canUseTerminal(session), false);
    session.choose("scrub");
    session.choose("leave");
    assert.equal(session.quests.interact(terminalId), null);
    assert.deepEqual(clues, [`weather.${evidence}`]);
    assert.equal(session.character.credits, 50, "reading the terminal pays no credits");
    for (const clue of ["van", "syrup", "ledger"]) session.quests.interact(`weather-${clue}`);
    assert.equal(session.quests.stage(questId), "accuse");
    const deduction = session.talk("kestrel")?.options.find(option => option.id === "accuse-faked");
    assert.ok(deduction && !deduction.disabled);
    session.choose("accuse-faked");
    session.close();
    assert.equal(session.quests.stage(questId), "confront");
    session.talk("nimbus");
    session.choose("busted");
    session.choose("reunite");
    assert.equal(session.quests.outcome(questId), "reunion");
    assert.equal(session.character.credits, 450);
    assert.equal(session.character.reputation("civilian"), 5);
    assert.equal(session.character.count("quote-magnum"), 1);
    const rewarded = JSON.stringify(session.character.state);
    session.choose("reunite");
    assert.equal(session.quests.interact(terminalId), null);
    session.save({ x: 504, z: 262, yaw: 0 });
    const restored = new RpgSession({ world, packs: CONTENT_PACKS, storage });
    assert.equal(restored.quests.flags.get(`weather.${evidence}`), true);
    assert.equal(canUseTerminal(restored), false);
    assert.equal(restored.quests.outcome(questId), "reunion");
    restored.talk("nimbus");
    restored.choose("reunite");
    assert.equal(JSON.stringify(restored.character.state), rewarded);
  });
}

test("the terminal remains recoverable after the investigation advances to the accusation", () => {
  const session = new RpgSession({ world, packs: CONTENT_PACKS });
  start(session);
  session.quests.interact(terminalId);
  session.choose("leave");
  for (const clue of ["van", "syrup", "ledger"]) session.quests.interact(`weather-${clue}`);
  assert.equal(session.quests.stage(questId), "accuse");
  assert.ok(session.talk("kestrel")?.options.find(option => option.id === "accuse-faked")?.disabled);
  session.close();
  session.quests.interact(terminalId);
  session.choose("scrub");
  session.close();
  const deduction = session.talk("kestrel")?.options.find(option => option.id === "accuse-faked");
  assert.ok(deduction && !deduction.disabled);
});
