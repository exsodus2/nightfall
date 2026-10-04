// Pack "cold-chain": the timed delivery. Dr. Juniper Vale grew Tomas a new lung; it has to reach
// the Ember Core, all the way north through Razorback turf, before the cryo-case warms up. Running
// out of time doesn't fail the job - it changes it: a warm lung is a worse lung, and Gauge knows a
// buyer who doesn't care about freshness.

import type { ContentPack, DialogueDefinition, EncounterDefinition, ItemDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, bye, ending, inStage, member, node } from "./helpers.ts";

const Q = "cold-chain";

const items: ItemDefinition[] = [
  { id: "cryo-case", name: "Cryo-Case (lung)", kind: "quest", rarity: "rare", glyph: "X", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "A frosted steel case with a blue indicator and a hand-written label: TOMAS. THIS WAY UP. DO NOT SHAKE. DO NOT OPEN. DO NOT SELL." },
];

const encounters: EncounterDefinition[] = [{
  id: "cc-ambush", label: "Razorbacks who heard about the case", area: area(-448, 0, 16), hostile: true,
  members: [member("rb-thug", -455.2, 6, FACE.south), member("rb-thug", -440.8, -6, FACE.south), member("rb-gunner", -455.2, -8, FACE.south)],
}];

const quest: QuestDefinition2 = {
  id: Q, title: "Cold Chain", category: "side", giver: "juniper",
  summary: "Carry a freshly grown lung from Juniper's clinic in the Rain Gardens to Tomas at the Ember Core before the cryo-case warms up.",
  rewardHint: "300 cr if it arrives cold", recommendedLevel: 4, start: "run",
  stages: [
    {
      id: "run", journal: "The lung is cold for about two and a half minutes. Tomas is at the Ember Core in the Foundry, due north. The Razorbacks have heard there's something valuable in a box.",
      onEnter: [{ give: "cryo-case" }, { spawn: "cc-ambush" }, { waypoint: { x: -498, z: -266, label: "Tomas (Ember Core)" } }],
      timeLimit: 150, onTimeout: "warm",
      objectives: [{ id: "deliver", kind: "deliver", text: "Get the cryo-case to Tomas before it warms up", item: "cryo-case", count: 1, npc: "tomas" }],
      next: "end-fresh",
    },
    {
      id: "warm", journal: "The indicator went from blue to amber. It's still a lung. Just a worse one. Tomas will still take it - and Gauge, next to the Core, knows someone who pays for organs no questions asked.",
      mode: "any",
      objectives: [
        { id: "late", kind: "deliver", text: "Give Tomas the warm lung anyway", item: "cryo-case", count: 1, npc: "tomas" },
        { id: "sell", kind: "choose", text: "Or sell it to Gauge", dialogue: "cc.gauge", options: ["sell"] },
      ],
      next: [{ if: { flag: "cold-chain.sell", is: "sell" }, stage: "end-sold" }, { stage: "end-late" }],
    },
    ending("end-fresh", "The lung arrived cold.", "fresh"),
    ending("end-late", "The lung arrived warm.", "late"),
    ending("end-sold", "The lung went to Gauge.", "sold"),
  ],
  outcomes: {
    fresh: {
      title: "Cold Chain", journal: "Juniper met you at the Core an hour later with a bone saw and a grin. Tomas breathed all the way down for the first time in twenty years.",
      effects: [{ credits: 300 }, { xp: 600 }, { give: "medkit", count: 2 }, { rep: "civilian", by: 5 }, { setFlag: "tomas.lung", value: "new" }],
    },
    late: {
      title: "Room Temperature", journal: "The warm lung took, mostly. Tomas wheezes in B-flat now. He says it's better than wheezing in nothing.",
      effects: [{ credits: 150 }, { xp: 400 }, { setFlag: "tomas.lung", value: "tired" }],
    },
    sold: {
      title: "Spare Parts", journal: "Gauge paid six hundred and didn't ask. Tomas is still waiting for a lung that isn't coming. You could tell him. You don't.",
      effects: [{ credits: 600 }, { xp: 300 }, { setFlag: "tomas.lung", value: "none" }],
    },
  },
};

const dialogues: DialogueDefinition[] = [
  {
    id: "cc.juniper", npc: "juniper", quest: Q,
    entries: [{ condition: { quest: Q, status: "active" }, node: "go", priority: 18 }],
    nodes: [
      node("offer", [
        "Tomas at the Ember Core has been breathing furnace air for forty years. I grew him a new lung. It's in the vat, it's beautiful, and it's dying.",
        "Once it's in the cryo-case you have about two and a half minutes. The Foundry is due north. Razorbacks in between.",
        "Run. Don't shake it. Don't open it. And do NOT sell it.",
      ], [
        { id: "accept", label: "Hand me the case.", effects: [{ startQuest: Q }], next: "go" },
        bye("I'm not a courier.", "decline"),
      ]),
      node("go", ["Why are you still here? GO."], [LEAVE]),
    ],
  },
  {
    id: "cc.gauge", npc: "gauge", quest: Q,
    entries: [{ condition: { all: [inStage(Q, "warm"), { item: "cryo-case" }] }, node: "buyer", priority: 20 }],
    nodes: [
      node("buyer", ["That case is running warm, friend. I can see the amber from here.", "I know a guy. He doesn't care how fresh it is. Six hundred, and I never saw it."], [
        { id: "sell", label: "Sell the lung (+600 cr).", kind: "complete", condition: { item: "cryo-case" }, effects: [{ take: "cryo-case" }], next: "sold" },
        bye("It's Tomas's."),
      ]),
      node("sold", ["Pleasure. Tomas'll live. Probably. People mostly do, until they don't."], [LEAVE]),
    ],
  },
];

/** Deliver the lung before it warms up (Rain Gardens to the Foundry, level 4). */
export const COLD_CHAIN_PACK: ContentPack = { id: "cold-chain", items, encounters, dialogues, quests: [quest] };
