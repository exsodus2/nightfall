import assert from "node:assert/strict";
import test from "node:test";
import { QuestBook, QUESTS, type QuestDefinition } from "../src/city/quests.ts";
import { NPCS, nearestNpc, type NpcDefinition } from "../src/city/npcs.ts";
import { CityWorld, districtAt } from "../src/city/world.ts";

const kinds = (book: QuestBook) => book.dialogue?.options.map(o => o.kind) ?? [];
const option = (book: QuestBook, kind: string) => book.dialogue!.options.find(o => o.kind === kind)!.id;

test("NPCs stand on walkable ground in their own district, with clear space around them", () => {
  const world = new CityWorld();
  assert.ok(NPCS.length >= 3);
  assert.equal(new Set(NPCS.map(n => n.id)).size, NPCS.length);
  for (const npc of NPCS) {
    assert.equal(districtAt(npc.x, npc.z).id, npc.district, npc.id);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) assert.ok(world.canOccupy(npc.x + dx, npc.z + dz), `${npc.id} blocked`);
    assert.ok(npc.greeting.length > 0);
  }
});

test("quest definitions reference real NPCs, and each step is in another district", () => {
  for (const quest of QUESTS) {
    const giver = NPCS.find(n => n.id === quest.giver);
    assert.ok(giver, quest.id);
    assert.ok(quest.steps.length > 0 && quest.reward > 0);
    for (const step of quest.steps) {
      const npc = NPCS.find(n => n.id === step.npc);
      assert.ok(npc, step.npc);
      assert.notEqual(npc.district, giver.district);
    }
  }
});

test("the relay chip quest: offer, accept, collect, return and complete", () => {
  const book = new QuestBook();
  assert.equal(book.status("relay-chip"), "available");
  assert.equal(book.marker("mara"), "offer");
  assert.equal(book.marker("juno"), null);
  assert.deepEqual(book.snapshot(null), { credits: 0, log: [], nearbyNpc: null, tracked: null });

  // Before accepting, Juno has nothing for the player.
  book.talk("juno");
  assert.deepEqual(kinds(book), ["leave"]);
  assert.equal(book.choose("leave").dialogue, null);

  const offer = book.talk("mara")!;
  assert.equal(offer.npcName, "Mara Voss");
  assert.equal(offer.district, "Silk Market");
  assert.deepEqual(kinds(book), ["accept", "decline"]);
  const accepted = book.choose(option(book, "accept"));
  assert.equal(accepted.message, "Quest accepted: The Relay Chip");
  assert.deepEqual(accepted.dialogue?.options.map(o => o.kind), ["leave"]);
  assert.equal(book.status("relay-chip"), "active");
  assert.equal(book.marker("mara"), null);
  assert.equal(book.marker("juno"), "objective");
  const juno = NPCS.find(n => n.id === "juno")!;
  assert.deepEqual(book.tracked(), { title: "The Relay Chip", objective: QUESTS[0].steps[0].objective, targetX: juno.x, targetZ: juno.z });
  assert.deepEqual(book.log(), [{ id: "relay-chip", title: "The Relay Chip", status: "active", objective: QUESTS[0].steps[0].objective, targetDistrict: "Neon Ward", reward: 250 }]);
  book.close();

  // Mara only reminds the player while the step is outstanding.
  book.talk("mara");
  assert.deepEqual(kinds(book), ["leave"]);
  book.close();

  book.talk("juno");
  assert.deepEqual(kinds(book), ["continue", "leave"]);
  const collected = book.choose(option(book, "continue"));
  assert.match(collected.message ?? "", /Return the relay chip/);
  assert.equal(book.status("relay-chip"), "ready");
  assert.equal(book.marker("mara"), "turn-in");
  assert.equal(book.marker("juno"), null);
  assert.equal(book.log()[0].status, "ready");
  assert.equal(book.log()[0].targetDistrict, "Silk Market");
  const mara = NPCS.find(n => n.id === "mara")!;
  assert.equal(book.tracked()?.targetX, mara.x);
  book.choose("leave");

  // Talking to Juno again cannot repeat the handover.
  book.talk("juno");
  assert.deepEqual(kinds(book), ["leave"]);
  book.close();

  book.talk("mara");
  assert.deepEqual(kinds(book), ["complete", "leave"]);
  const done = book.choose(option(book, "complete"));
  assert.equal(done.message, "Quest complete: The Relay Chip · +250 cr");
  assert.equal(book.credits, 250);
  assert.equal(book.status("relay-chip"), "complete");
  assert.equal(book.marker("mara"), null);
  assert.equal(book.tracked(), null);
  assert.equal(book.log()[0].status, "complete");
  book.close();

  // Completion is final and pays once.
  book.talk("mara");
  assert.deepEqual(kinds(book), ["leave"]);
  assert.equal(book.choose("complete:relay-chip").dialogue?.npcId, "mara");
  assert.equal(book.credits, 250);
});

test("declining or leaving at any step changes nothing", () => {
  const book = new QuestBook();
  book.talk("mara");
  const declined = book.choose(option(book, "decline"));
  assert.deepEqual(declined, { dialogue: null, message: null });
  assert.equal(book.status("relay-chip"), "available");
  assert.equal(book.marker("mara"), "offer");

  book.talk("mara"); book.choose("leave");
  assert.equal(book.status("relay-chip"), "available");

  book.talk("mara"); book.choose(option(book, "accept")); book.choose("leave");
  book.talk("juno"); book.choose("leave");
  assert.equal(book.status("relay-chip"), "active");
  book.talk("juno"); book.close();
  assert.equal(book.status("relay-chip"), "active");

  book.talk("juno"); book.choose(option(book, "continue")); book.close();
  book.talk("mara"); book.choose("leave");
  assert.equal(book.status("relay-chip"), "ready");
  assert.equal(book.credits, 0);
});

test("options only apply to the open dialogue", () => {
  const book = new QuestBook();
  assert.deepEqual(book.choose("accept:relay-chip"), { dialogue: null, message: null });
  book.talk("juno");
  book.choose("accept:relay-chip");
  assert.equal(book.status("relay-chip"), "available");
  assert.equal(book.talk("nobody"), null);
});

test("the book is data-driven: multi-step quests, prerequisites and fallback lines", () => {
  const npc = (id: string, district: number): NpcDefinition => ({ id, name: id.toUpperCase(), title: "Test", district, x: 0, z: 0, facing: 0, look: NPCS[0].look, greeting: [`${id} says hi`] });
  const npcs = [npc("a", 0), npc("b", 1), npc("c", 2)];
  const base = { reward: 10, summary: "Do it.", returnObjective: "Go back to A", acceptLabel: "Yes", declineLabel: "No", completeLabel: "Done" };
  const quests: QuestDefinition[] = [
    { ...base, id: "first", title: "First", giver: "a", steps: [{ npc: "b", objective: "See B", action: "Take", update: "Took" }, { npc: "c", objective: "See C", action: "Take", update: "Took" }] },
    { ...base, id: "second", title: "Second", giver: "a", reward: 5, requires: ["first"], steps: [{ npc: "c", objective: "See C again", action: "Take", update: "Took" }] },
  ];
  const book = new QuestBook(npcs, quests, 100);
  assert.equal(book.status("second"), "locked");
  assert.deepEqual(book.talk("a")?.lines, ["Do it."]);
  book.choose("accept:first");
  // Steps must be done in order.
  assert.deepEqual(book.talk("c")?.lines, ["c says hi"]);
  book.talk("b"); book.choose("continue:first");
  assert.equal(book.status("first"), "active");
  assert.equal(book.marker("c"), "objective");
  book.talk("c"); book.choose("continue:first");
  assert.equal(book.status("first"), "ready");
  book.talk("a"); book.choose("complete:first");
  assert.equal(book.credits, 110);
  assert.equal(book.status("second"), "available");
  assert.equal(book.marker("a"), "offer");
  book.talk("a"); book.choose("accept:second");
  assert.equal(book.tracked()?.objective, "See C again");
  assert.deepEqual(book.log().map(e => e.status), ["complete", "active"]);
});

test("the nearest NPC is found only within talking range", () => {
  const mara = NPCS.find(n => n.id === "mara")!;
  assert.equal(nearestNpc(NPCS, mara.x + 2, mara.z)?.npc.id, "mara");
  assert.equal(nearestNpc(NPCS, mara.x + 3.5, mara.z), null);
});
