import type { ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { LEAVE, available, bye, go, inStage, node } from "./helpers.ts";

const QUEST = "kiln-calibration";
const DIALOGUE = "kiln.bench";

export const KILN_WORKBENCH: InteractableDefinition = {
  id: "kiln-workbench", label: "Calibrate the Kiln Nine workbench", place: "kiln",
  x: -536.41, z: -238.7, y: 2.4, glyph: ">",
  condition: { not: { quest: QUEST, status: "complete" } }, dialogue: DIALOGUE,
};

const quest: QuestDefinition2 = {
  id: QUEST, title: "Ground Before Glow", category: "gig", giver: null,
  summary: "Kiln Nine's night mechanic left a salvaged shield cell on the test bench. Wire it up by the calibration plate, pass the proof pulse, keep the cell.",
  rewardHint: "One Shield Cell and 120 XP", recommendedLevel: 1, start: "earth",
  stages: [
    {
      id: "earth", journal: "Kiln Nine's night mechanic left a shield cell on the right-hand test bench inside the workshop (the Foundry). Prove it safe and it's yours. The plate reads EARTH BOND / 12 V AUX / 10 OHM DUMMY LOAD. Step one: earth the bench.",
      objectives: [{ id: "earth-bond", kind: "choose", text: "Earth the test bench (right-hand machine, Kiln Nine)", dialogue: DIALOGUE, options: ["bond-earth"], target: { x: -531, z: -247.91 } }],
      next: "supply",
    },
    {
      id: "supply", journal: "Earth bonded. The cell is stamped 12 V input. Pick the matching supply switch on the bench.",
      objectives: [{ id: "aux-feed", kind: "choose", text: "Switch the Kiln Nine bench to the 12 V auxiliary feed", dialogue: DIALOGUE, options: ["aux-feed"], target: { x: -531, z: -247.91 } }],
      next: "load",
    },
    {
      id: "load", journal: "12 V is steady. The plate wants a 10 ohm dummy load on the output before anything live gets connected.",
      objectives: [{ id: "test-load", kind: "choose", text: "Clip the 10 ohm dummy load to the Kiln Nine bench output", dialogue: DIALOGUE, options: ["dummy-load"], target: { x: -531, z: -247.91 } }],
      next: "proof",
    },
    {
      id: "proof", journal: "Earth, supply and load all read green. Run the proof pulse to release the cell.",
      objectives: [{ id: "proof-pulse", kind: "choose", text: "Run the proof pulse at the Kiln Nine bench", dialogue: DIALOGUE, options: ["proof-pulse"], target: { x: -531, z: -247.91 } }],
      onComplete: [{ outcome: "certified" }],
    },
  ],
  outcomes: {
    certified: {
      title: "Certified, Not Fried", journal: "The cell held its field for the full proof pulse and the cradle let go of it. The mechanic's note was right: one per apprentice, and this one's yours.",
      effects: [{ give: "shield-cell" }, { xp: 120 }, { setFlag: "kiln.bench-certified", value: true }],
    },
  },
};

const dialogue: DialogueDefinition = {
  id: DIALOGUE, npc: KILN_WORKBENCH.id, quest: QUEST,
  entries: [
    { condition: available(QUEST), node: "offer" },
    { condition: inStage(QUEST, "earth"), node: "earth" },
    { condition: inStage(QUEST, "supply"), node: "supply" },
    { condition: inStage(QUEST, "load"), node: "load" },
    { condition: inStage(QUEST, "proof"), node: "proof" },
    { condition: { quest: QUEST, status: "complete" }, node: "certified" },
  ],
  nodes: [
    node("offer", [
      "[A salvaged shield cell sits in a locked cradle. Taped to the guard, in grease pencil: PROVE IT SAFE, KEEP IT. ONE PER APPRENTICE. - D.]",
      "CALIBRATION PLATE: EARTH BOND / 12 V AUX / 10 OHM DUMMY LOAD.",
    ], [
      { id: "accept-calibration", label: "Start the calibration.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "earth" },
      bye("Leave the bench alone."),
    ]),
    node("earth", [
      "EARTH: OPEN. Two places to clip the earth lead: the bare green earth bus, or the painted bench chassis.",
      "PLATE STEP 1: EARTH BOND.",
    ], [
      { id: "bond-earth", label: "Clip the lead to the green earth bus.", condition: inStage(QUEST, "earth"), next: "supply" },
      go("clip-chassis", "Clip it to the painted chassis.", "earth-fault"),
      LEAVE,
    ]),
    node("earth-fault", ["CONTINUITY: FAIL. The paint insulates the chassis. INTERLOCK: POWER HELD. NO DAMAGE.", "The green earth bus is the bare copper strip along the back."], [go("retry-earth", "Try the earth connection again.", "earth"), LEAVE]),
    node("supply", ["EARTH: BONDED. CELL INPUT: 12 V. Two switches under the guard: AUX 12 V and FURNACE 230 V."], [
      { id: "aux-feed", label: "Throw the AUX 12 V switch.", condition: inStage(QUEST, "supply"), next: "load" },
      go("furnace-feed", "Throw the FURNACE 230 V switch.", "supply-fault"),
      LEAVE,
    ]),
    node("supply-fault", ["OVERVOLTAGE INTERLOCK. 230 V REFUSED ON A 12 V CELL. NO DAMAGE.", "Somebody has scratched 'NICE TRY' into the switch plate."], [go("retry-supply", "Select the correct supply.", "supply"), LEAVE]),
    node("load", ["AUX: 12 V STABLE. OUTPUT: OPEN. Bolted to the bench: a 10 OHM DUMMY LOAD. Hanging next to it: a lead marked LIVE BELT RIG."], [
      { id: "dummy-load", label: "Clip on the 10 ohm dummy load.", condition: inStage(QUEST, "load"), next: "proof" },
      go("live-rig", "Connect the live belt rig instead.", "load-fault"),
      LEAVE,
    ]),
    node("load-fault", ["UNVERIFIED LOAD. CRADLE LATCH HELD. Below the rig hook: TEST ON THE DUMMY. NOT ON A PERSON.", "The 10 ohm dummy load is the ceramic block bolted to the bench."], [go("retry-load", "Use the bench test load.", "load"), LEAVE]),
    node("proof", ["EARTH: BONDED / AUX: 12 V / LOAD: 10 OHM. ALL GREEN.", "PROOF PULSE READY. CRADLE RELEASES ON PASS."], [
      { id: "proof-pulse", label: "Run the proof pulse. (Shield Cell + 120 XP)", condition: inStage(QUEST, "proof"), kind: "complete", next: "certified" },
      bye("I'll run the test later."),
    ]),
    node("certified", ["[A thin blue field swells around the dummy load, holds for fifteen seconds, and folds back into the cell. The cradle clicks open.]", "CERTIFIED. Put it in a quick slot (Q or Z) for fifteen seconds of kinetic shield when it counts."], [LEAVE]),
  ],
};

export const KILN_WORKBENCH_PACK: ContentPack = {
  id: "kiln-workbench",
  quests: [quest],
  interactables: [KILN_WORKBENCH],
  dialogues: [dialogue],
};
