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
  summary: "The Razorbacks are coming to crack the Ember Core's coolant manifold and sell the coolant. Hold the Core plaza in the Foundry through three waves.",
  rewardHint: "500 cr and the Kernel Panic shotgun (300 cr and a lesser gun if the Core vents)", recommendedLevel: 6, start: "brace",
  onFail: [{ setFlag: "ember.scrammed" }, { rep: "razorbacks", by: 5 }, { message: "The Ember Core scrams. The Foundry goes dark for a night and Spillway stalls start selling coolant.", tone: "danger" }],
  stages: [
    {
      id: "brace", journal: "Tomas says the Razorbacks hit at shift change. Stock up on stims and ammo (Gauge, a block east of the Core, sells ammo), then tell Tomas at the Ember Core you're ready.",
      objectives: [{ id: "ready", kind: "choose", text: "Tell Tomas at the Ember Core you're ready", dialogue: "ec.tomas", options: ["ready"] }],
      next: "wave-1",
    },
    {
      id: "wave-1", journal: "First wave at the Ember Core, coming down the north street: four Razorback strippers with pipes and a pistol.",
      onEnter: [{ spawn: "ec-wave-1" }, { message: "Here they come - north side!", tone: "danger" }],
      objectives: [{ id: "clear", kind: "clear", text: "Stop the first wave on the north street", encounter: "ec-wave-1" }],
      next: "wave-2",
    },
    {
      id: "wave-2", journal: "Second wave at the Ember Core, coming up from the Foundry station to the south: a Razorback lieutenant with a shotgun and his crew.",
      onEnter: [{ spawn: "ec-wave-2" }, { message: "South side! From the station!", tone: "danger" }],
      objectives: [{ id: "clear", kind: "clear", text: "Stop the second wave coming up from the station", encounter: "ec-wave-2" }],
      next: "wave-3",
    },
    {
      id: "wave-3", journal: "The Duchess sent a brute and a sapper crew for the manifold. Kill them all and hold the Ember Core plaza for 45 seconds. If any are still standing after 75 seconds, they crack the manifold.",
      onEnter: [{ spawn: "ec-wave-3" }, { message: "A brute and a sapper crew, all sides. Hold the plaza!", tone: "danger" }],
      timeLimit: 75, onTimeout: "manifold",
      objectives: [
        { id: "clear", kind: "clear", text: "Take down the Duchess's heavies on the plaza", encounter: "ec-wave-3" },
        { id: "hold", kind: "survive", text: "Hold the Ember Core plaza for 45 seconds", seconds: 45, area: PLAZA },
      ],
      next: "report",
    },
    {
      id: "manifold", journal: "They cracked the manifold and coolant is venting. Seal the valve on the east side of the plaza by hand within 40 seconds, or the Core scrams.",
      timeLimit: 40,
      objectives: [
        { id: "valve", kind: "interact", text: "Seal the coolant valve, east side of the plaza", object: "ec-valve" },
        { id: "clear", kind: "clear", text: "Finish off the heavies", encounter: "ec-wave-3" },
      ],
      next: "report",
    },
    {
      id: "report", journal: "The Core is still running. Tell Tomas, by the Ember Core in the Foundry, that the Razorbacks are done.",
      objectives: [{ id: "report", kind: "choose", text: "Tell Tomas at the Ember Core it's over", dialogue: "ec.tomas", options: ["report"] }],
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
      "The Razorbacks want my coolant. Their Duchess cuts it with tap water and sells it in the Spillway at forty a litre.",
      "They'll crack the manifold at shift change. Three crews, maybe four. I'm sixty-eight and I have a lantern.",
      "Hold the plaza for me. I can pay five hundred, and there's something under the furnace I've kept forty years for a day like this.",
    ], [
      { id: "accept", label: "Nobody touches your Core.", effects: [{ startQuest: Q }], next: "brace" },
      bye("Sorry, Tomas.", "decline"),
    ]),
    node("brace", ["Buy stims if you need them. Gauge sells shells from his table a block east of the Core. Tell me when you're ready and I'll open the gates."], [
      { id: "ready", label: "Open the gates. I'm ready.", kind: "continue", next: null },
      bye("Give me a minute."),
    ]),
    node("fighting", ["Behind you! Always behind you!"], [LEAVE]),
    node("report", ["[Tomas lowers the lantern. His hands are shaking.] Is it done?"], [{ id: "report", label: "It's done.", kind: "complete", next: null }]),
  ],
}];

/** Defend the Ember Core (Foundry wave fight, level 6). */
export const EMBER_CORE_PACK: ContentPack = { id: "ember-core", encounters, interactables, dialogues, quests: [quest] };
