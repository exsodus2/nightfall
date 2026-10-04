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
  summary: "Calibrate a salvaged shield cell on Kiln Nine's test bench. Read the plate, wire the safe circuit, then run a proof pulse.",
  rewardHint: "One Shield Cell and 120 XP", recommendedLevel: 1, start: "earth",
  stages: [
    {
      id: "earth", journal: "The right-hand machine in Kiln Nine has a calibration plate: EARTH BOND / 12 V AUX / 10 OHM DUMMY LOAD. Ground the bench before applying power.",
      objectives: [{ id: "earth-bond", kind: "choose", text: "Bond the workbench earth bus inside Kiln Nine", dialogue: DIALOGUE, options: ["bond-earth"], target: { x: -531, z: -247.91 } }],
      next: "supply",
    },
    {
      id: "supply", journal: "The earth bond is solid. The cell's stamped input rating is twelve volts. Select the isolated auxiliary feed, not the furnace mains.",
      objectives: [{ id: "aux-feed", kind: "choose", text: "Select the rated supply at the workbench", dialogue: DIALOGUE, options: ["aux-feed"], target: { x: -531, z: -247.91 } }],
      next: "load",
    },
    {
      id: "load", journal: "Twelve volts are stable. The plate calls for a ten-ohm dummy load. The cell must pass on the bench before it goes on anybody's belt.",
      objectives: [{ id: "test-load", kind: "choose", text: "Attach the safe dummy load", dialogue: DIALOGUE, options: ["dummy-load"], target: { x: -531, z: -247.91 } }],
      next: "proof",
    },
    {
      id: "proof", journal: "Earth bonded, auxiliary feed selected, test load attached. Everything reads green. Run the proof pulse and claim the certified cell.",
      objectives: [{ id: "proof-pulse", kind: "choose", text: "Run the workbench proof pulse", dialogue: DIALOGUE, options: ["proof-pulse"], target: { x: -531, z: -247.91 } }],
      onComplete: [{ outcome: "certified" }],
    },
  ],
  outcomes: {
    certified: {
      title: "Certified, Not Fried", journal: "The cell held its field through the proof pulse. Kiln Nine let you keep this one. The old machines respond to patience, not force.",
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
      "[A salvaged shield cell sits in a guarded cradle. The night mechanic has left a note: PROVE IT SAFE, KEEP IT. ONE PER APPRENTICE.]",
      "CALIBRATION PLATE: EARTH BOND / 12 V AUX / 10 OHM DUMMY LOAD. Ground before glow.",
    ], [
      { id: "accept-calibration", label: "Read the plate and start the calibration.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "earth" },
      bye("Leave the bench alone."),
    ]),
    node("earth", [
      "EARTH: OPEN. The green earth bus is unconnected. The painted chassis is insulated from it.",
      "PLATE: Earth bond first. Which connection do you make?",
    ], [
      { id: "bond-earth", label: "Bond the lead to the green earth bus.", condition: inStage(QUEST, "earth"), next: "supply" },
      go("clip-chassis", "Clip it to the painted chassis.", "earth-fault"),
      LEAVE,
    ]),
    node("earth-fault", ["CONTINUITY: FAIL. Paint is an insulator. The interlock keeps the power off; nothing is damaged.", "Find the exposed green earth bus."], [go("retry-earth", "Try the earth connection again.", "earth"), LEAVE]),
    node("supply", ["EARTH: BONDED. Cell rating: 12 V. Two supply switches wait under the guard: AUX 12 V and FURNACE 230 V."], [
      { id: "aux-feed", label: "Select the isolated 12 V auxiliary feed.", condition: inStage(QUEST, "supply"), next: "load" },
      go("furnace-feed", "Select the 230 V furnace feed.", "supply-fault"),
      LEAVE,
    ]),
    node("supply-fault", ["OVERVOLTAGE INTERLOCK. The bench refuses to connect a twelve-volt cell to furnace mains.", "The cell survived. Your dignity will recover."], [go("retry-supply", "Select the correct supply.", "supply"), LEAVE]),
    node("load", ["AUX: 12 V STABLE. The plate specifies a 10 OHM DUMMY LOAD. Beside it hangs a lead marked LIVE BELT RIG."], [
      { id: "dummy-load", label: "Attach the ten-ohm dummy load.", condition: inStage(QUEST, "load"), next: "proof" },
      go("live-rig", "Connect the live belt rig instead.", "load-fault"),
      LEAVE,
    ]),
    node("load-fault", ["UNVERIFIED LOAD. The cradle latch stays closed. Test equipment first, people second.", "The ten-ohm dummy load is bolted to the bench."], [go("retry-load", "Use the bench test load.", "load"), LEAVE]),
    node("proof", ["EARTH: BONDED / AUX: 12 V / LOAD: 10 OHM. All three indicators are green.", "One proof pulse. Then the cell is yours."], [
      { id: "proof-pulse", label: "Run the proof pulse. (Shield Cell + 120 XP)", condition: inStage(QUEST, "proof"), kind: "complete", next: "certified" },
      bye("I'll run the test later."),
    ]),
    node("certified", ["[A thin blue field blooms around the dummy load, holds, then folds neatly back into the cell. The cradle opens.]", "CERTIFIED. Clip the Shield Cell into a quick slot when you need fifteen seconds of protection."], [LEAVE]),
  ],
};

export const KILN_WORKBENCH_PACK: ContentPack = {
  id: "kiln-workbench",
  quests: [quest],
  interactables: [KILN_WORKBENCH],
  dialogues: [dialogue],
};
