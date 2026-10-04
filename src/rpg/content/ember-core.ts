// Pack "ember-core": the defend-the-point wave fight. The Razorbacks' Duchess wants the Ember
// Core's coolant (it sells by the litre in the Spillway). Tomas can't stop three waves of them;
// you can. The last wave brings a brute and a sapper crew on a clock: if they're still standing
// when it runs out, the manifold starts venting and you have seconds to seal it by hand.

import type { ContentPack, DialogueDefinition, EncounterDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, bye, ending, inStage, member, node } from "./helpers.ts";

const Q = "ember-core";
const PLAZA = area(-480, -288, 26, "Ember Core plaza");
const VALVE = { x: -466, z: -284 } as const;

const encounters: EncounterDefinition[] = [
  {
    id: "ec-wave-1", label: "Razorback strippers (north)", area: area(-465, -262, 16), hostile: true,
    members: [member("rb-thug", -470, -262, FACE.south), member("rb-thug", -460, -266, FACE.south), member("rb-thug", -455, -258, FACE.south), member("rb-gunner", -465, -256, FACE.south)],
  },
  {
    id: "ec-wave-2", label: "Razorback crew (south)", area: area(-472, -316, 16), hostile: true,
    members: [member("rb-lieutenant", -478, -320, FACE.north), member("rb-thug", -470, -316, FACE.north), member("rb-thug", -462, -312, FACE.north), member("rb-gunner", -490, -318, FACE.north)],
  },
  {
    id: "ec-wave-3", label: "The Duchess's heavies", area: { ...PLAZA }, hostile: true,
    members: [
      member("rb-brute", -456, -292, FACE.west), member("rb-lieutenant", -458, -302, FACE.west),
      member("rb-gunner", -506, -300, FACE.east), member("rb-gunner", -506, -276, FACE.east), member("rb-thug", -452, -280, FACE.west),
    ],
  },
];

const interactables: InteractableDefinition[] = [{
  id: "ec-valve", label: "Coolant manifold valve (seal it!)", x: VALVE.x, z: VALVE.z, y: 1.2, glyph: "O", once: true,
  condition: inStage(Q, "manifold"),
  effects: [{ message: "You haul the valve shut. The Core's scream drops to a growl.", tone: "quest" }],
}];

const quest: QuestDefinition2 = {
  id: Q, title: "Hold the Ember", category: "side", giver: "tomas",
  summary: "The Razorbacks are coming to crack the Ember Core's coolant manifold. Hold the plaza through three waves.",
  rewardHint: "500 cr and Tomas's old shotgun", recommendedLevel: 6, start: "brace",
  onFail: [{ setFlag: "ember.scrammed" }, { rep: "razorbacks", by: 5 }, { message: "The Ember Core scrams. The Foundry goes dark for a night, and somewhere in the Spillway, coolant goes on sale.", tone: "danger" }],
  stages: [
    {
      id: "brace", journal: "Tomas says they come at shift change. Stock up, then tell him you're ready.",
      objectives: [{ id: "ready", kind: "choose", text: "Tell Tomas you're ready", dialogue: "ec.tomas", options: ["ready"] }],
      next: "wave-1",
    },
    {
      id: "wave-1", journal: "First wave, from the north street. Strippers with pipes.",
      onEnter: [{ spawn: "ec-wave-1" }, { message: "Here they come - north side!", tone: "danger" }],
      objectives: [{ id: "clear", kind: "clear", text: "Break the first wave", encounter: "ec-wave-1" }],
      next: "wave-2",
    },
    {
      id: "wave-2", journal: "Second wave, up from the station. A lieutenant with a shotgun.",
      onEnter: [{ spawn: "ec-wave-2" }, { message: "South side! From the station!", tone: "danger" }],
      objectives: [{ id: "clear", kind: "clear", text: "Break the second wave", encounter: "ec-wave-2" }],
      next: "wave-3",
    },
    {
      id: "wave-3", journal: "The Duchess sent her heavies, and a sapper crew for the manifold. Kill them and hold the plaza while the Core vents - before they get to work.",
      onEnter: [{ spawn: "ec-wave-3" }, { message: "A brute and a sapper crew, all sides. Hold the plaza!", tone: "danger" }],
      timeLimit: 75, onTimeout: "manifold",
      objectives: [
        { id: "clear", kind: "clear", text: "Break the Duchess's heavies", encounter: "ec-wave-3" },
        { id: "hold", kind: "survive", text: "Hold the plaza while the Core vents", seconds: 45, area: PLAZA },
      ],
      next: "report",
    },
    {
      id: "manifold", journal: "They cracked the manifold. Coolant is venting. Seal the valve by hand before the Core scrams.",
      timeLimit: 40,
      objectives: [
        { id: "valve", kind: "interact", text: "Seal the manifold valve", object: "ec-valve" },
        { id: "clear", kind: "clear", text: "Finish the heavies", encounter: "ec-wave-3" },
      ],
      next: "report",
    },
    {
      id: "report", journal: "The Core is breathing. Tell Tomas.",
      objectives: [{ id: "report", kind: "choose", text: "Tell Tomas it's over", dialogue: "ec.tomas", options: ["report"] }],
      next: [{ if: { flag: "ember-core.valve" }, stage: "end-vented" }, { stage: "end-held" }],
    },
    ending("end-held", "The Core never missed a breath.", "held"),
    ending("end-vented", "The Core coughed, but it's breathing.", "vented"),
  ],
  outcomes: {
    held: {
      title: "Not a Drop", journal: "Not one litre lost. Tomas went under the furnace and came back with a drum-fed shotgun wrapped in forty years of oilcloth. 'Kept it for the day I'd need it. Turns out you needed it.'",
      effects: [{ credits: 500 }, { xp: 1100 }, { give: "kernel-panic" }, { rep: "razorbacks", by: -10 }, { setFlag: "ember.defended" }],
    },
    vented: {
      title: "Coughing, Breathing", journal: "The Core lost coolant, but it's still burning. Tomas paid what he could and gave you his second-best gun.",
      effects: [{ credits: 300 }, { xp: 900 }, { give: "colon-scatter" }, { rep: "razorbacks", by: -10 }, { setFlag: "ember.defended" }],
    },
  },
};

const dialogues: DialogueDefinition[] = [{
  id: "ec.tomas", npc: "tomas", quest: Q,
  entries: [
    { condition: inStage(Q, "brace"), node: "brace", priority: 20 },
    { condition: inStage(Q, "report"), node: "report", priority: 20 },
    { condition: { quest: Q, status: "active" }, node: "fighting", priority: 18 },
  ],
  nodes: [
    node("offer", [
      "The Razorbacks want my coolant. Their Duchess sells it in the Spillway for the price of blood.",
      "They'll crack the manifold at shift change. Three crews, maybe four. I'm sixty-eight and I have a lantern.",
      "Hold the plaza for me.",
    ], [
      { id: "accept", label: "Nobody touches your Core.", effects: [{ startQuest: Q }], next: "brace" },
      bye("Sorry, Tomas.", "decline"),
    ]),
    node("brace", ["Buy stims if you need them. Gauge by the station sells shells. Tell me when you're ready and I'll open the gates."], [
      { id: "ready", label: "Open the gates. I'm ready.", kind: "continue", next: null },
      bye("Give me a minute."),
    ]),
    node("fighting", ["Behind you! Always behind you!"], [LEAVE]),
    node("report", ["[Tomas lowers the lantern. His hands are shaking.] Is it done?"], [{ id: "report", label: "It's done.", kind: "complete", next: null }]),
  ],
}];

/** Defend the Ember Core (Foundry wave fight, level 6). */
export const EMBER_CORE_PACK: ContentPack = { id: "ember-core", encounters, interactables, dialogues, quests: [quest] };
