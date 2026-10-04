// Pack "witness": the protection job. Imani Harrow's witness, Ines Pardo, a Meridian accountant,
// will testify that CorpSec skimmed the flood-evacuation budget. Somebody has hired Ghost knives
// to make sure she doesn't. Keep her alive at the handoff until the transport comes.
//
// How she can die: she is an encounter member (faction "civilian") standing in the crossfire, so a
// careless shotgun blast kills her (failIf: her encounter is cleared), and each wave is on a clock -
// if a wave is still up when it runs out, the knives got past you (timeLimit without onTimeout
// fails the quest). Hidden optional objective: the CorpSec handler watching from up the street is
// the paymaster; killing him and taking his phone pays extra and hurts CorpSec.

import type { Condition, ContentPack, DialogueDefinition, EncounterDefinition, EnemyArchetype, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, bye, ending, inStage, look, member, node } from "./helpers.ts";

const Q = "witness";
const HANDOFF = area(-124, -188, 9);
const CLIENT_DEAD: Condition = { encounterCleared: "witness-client" };

const ines: EnemyArchetype = {
  id: "civ-ines", name: "Ines Pardo (protect her)", faction: "civilian", health: 70, armor: 0, speed: { walk: 1.3, run: 4.2 },
  weapon: "backtick-shiv", reaction: 2, aggression: 0, perception: { sight: 20, fovDegrees: 120, hearing: 20 },
  look: look([150, 120, 90], [60, 44, 34], [196, 160, 132], [255, 220, 180], "bare", "case", "breathe"),
  loot: "no-loot", xp: 0, tags: ["civilian", "client"],
  barks: { alert: ["OH GOD. OH GOD.", "HARROW SAID THIS WOULD BE BORING!"], hurt: ["I'M HIT! I'M ON YOUR SIDE!"], death: ["...the ledger... tell them..."] },
};

const encounters: EncounterDefinition[] = [
  { id: "witness-client", label: "Ines Pardo", area: HANDOFF, hostile: false, members: [member("civ-ines", -120.8, -184.8, FACE.south, { tag: "client" })] },
  {
    id: "witness-wave-1", label: "Hired knives", area: area(-128, -206, 16), hostile: true,
    members: [member("ghost-glitchknife", -128, -214, FACE.south), member("ghost-glitchknife", -135.2, -210, FACE.south), member("ghost-blinker", -120.8, -212, FACE.south)],
  },
  { id: "witness-spotter", label: "The paymaster", area: area(-135, -232, 10), hostile: true, members: [member("corp-handler", -135.2, -232, FACE.south, { tag: "paymaster" })] },
  {
    id: "witness-wave-2", label: "CorpSec cleanup team", area: area(-100, -192, 16), hostile: true,
    members: [member("corp-trooper", -100, -184.8, FACE.west), member("corp-trooper", -104, -199.2, FACE.west), member("corp-shield", -96, -192, FACE.west)],
  },
];

const paymaster = (): QuestDefinition2["stages"][number]["objectives"][number] =>
  ({ id: "paymaster", kind: "kill", text: "Take the paymaster's phone off the handler watching from up the street", count: 1, tag: "paymaster", encounter: "witness-spotter", optional: true, hidden: true });

const quest: QuestDefinition2 = {
  id: Q, title: "Night Witness", category: "side", giver: "harrow",
  summary: "Keep Harrow's witness alive at the handoff until the transport arrives. Somebody has paid a lot of money for the opposite.",
  rewardHint: "450 cr, more if you find out who paid", recommendedLevel: 5, start: "meet",
  onFail: [{ setFlag: "witness.failed" }, { rep: "corpsec", by: 5 }, { message: "Ines Pardo is dead. Somewhere in the Spire, a spreadsheet is safe.", tone: "danger" }],
  stages: [
    {
      id: "meet", journal: "Ines Pardo is waiting at the crossing west of the avenue, north end of Neon Ward. Get there before anyone else does.",
      onEnter: [{ spawn: "witness-client" }],
      objectives: [{ id: "meet", kind: "reach", text: "Meet Ines Pardo at the handoff", area: HANDOFF }],
      next: "hold",
    },
    {
      id: "hold", journal: "Knives out of the rain, from the north. Don't let them reach her - and don't hit her yourself.",
      onEnter: [{ spawn: "witness-wave-1" }, { spawn: "witness-spotter" }, { message: "Movement to the north. They're here for Ines.", tone: "danger" }],
      failIf: CLIENT_DEAD, timeLimit: 100,
      objectives: [{ id: "wave", kind: "clear", text: "Stop the hired knives", encounter: "witness-wave-1" }, paymaster()],
      next: "wave-2",
    },
    {
      id: "wave-2", journal: "The knives failed, so their employer sent the real thing: a CorpSec cleanup team from the east.",
      onEnter: [{ spawn: "witness-wave-2" }, { message: "Boots from the east. CorpSec has stopped pretending.", tone: "danger" }],
      failIf: CLIENT_DEAD, timeLimit: 110,
      objectives: [{ id: "wave", kind: "clear", text: "Break the CorpSec cleanup team", encounter: "witness-wave-2" }, paymaster()],
      next: "extract",
    },
    {
      id: "extract", journal: "Harrow's transport is two minutes out. Stay with Ines.",
      failIf: CLIENT_DEAD,
      objectives: [{ id: "hold", kind: "survive", text: "Stay with Ines until the transport arrives", seconds: 15, area: HANDOFF }, paymaster()],
      onComplete: [{ despawn: "witness-client" }, { message: "A battered cab pulls up. Ines gets in without looking back. The cab is gone before the door closes.", tone: "quest" }],
      next: "report",
    },
    {
      id: "report", journal: "Ines is on her way to the court. Tell Harrow.",
      objectives: [{ id: "report", kind: "choose", text: "Report to Imani Harrow", dialogue: "witness.harrow", options: ["report", "report-proof"] }],
      next: [{ if: { flag: "witness.report", is: "report-proof" }, stage: "end-proof" }, { stage: "end-safe" }],
    },
    ending("end-safe", "Harrow paid.", "safe"),
    ending("end-proof", "Harrow paid, and then some.", "proof"),
  ],
  outcomes: {
    safe: {
      title: "Delivered", journal: "Ines testified. Meridian denied everything. Harrow says that's what winning looks like in this city.",
      effects: [{ credits: 450 }, { xp: 750 }, { rep: "corpsec", by: -5 }],
    },
    proof: {
      title: "Follow the Money", journal: "Ines testified, and the paymaster's phone had the Meridian transfer on it. Harrow hasn't smiled like that in ten years.",
      effects: [{ credits: 800 }, { xp: 950 }, { give: "encrypted-drive" }, { rep: "corpsec", by: -15 }, { setFlag: "witness.proof" }],
    },
  },
};

const dialogues: DialogueDefinition[] = [{
  id: "witness.harrow", npc: "harrow", quest: Q,
  entries: [
    { condition: inStage(Q, "report"), node: "report", priority: 20 },
    { condition: { quest: Q, status: "active" }, node: "go", priority: 18 },
    { condition: { quest: Q, status: "failed" }, node: "failed", priority: 6 },
  ],
  nodes: [
    node("offer", [
      "I have a witness. Ines Pardo, Meridian accounts. She says CorpSec skimmed the flood evacuation budget. She has the numbers.",
      "Somebody has hired Ghost knives to make sure she never says the numbers out loud.",
      "I need her alive at the handoff until my transport arrives. Three minutes, maybe four. It will not be boring.",
    ], [
      { id: "accept", label: "I'll keep her breathing.", effects: [{ startQuest: Q }], next: "go" },
      bye("Find another bodyguard.", "decline"),
    ]),
    node("go", ["Crossing west of the avenue, north end of the ward. Don't shoot the accountant. Accountants are rare."], [LEAVE]),
    node("report", ["You're alive. Is she?"], [
      { id: "report-proof", label: "She's on her way. And I took this off the man who paid for it. (Hand over the phone)", kind: "complete", condition: { flag: "witness.paymaster" }, hideIfUnavailable: true, next: "proof" },
      { id: "report", label: "She's on her way to court.", kind: "complete", condition: { not: { flag: "witness.paymaster" } }, hideIfUnavailable: true, next: "safe" },
    ]),
    node("safe", ["Good. Good. Here - cash, like I promised."], [LEAVE]),
    node("proof", ["[Harrow scrolls. Stops. Scrolls again.] That's a Meridian transfer code. With a name on it.", "I owe you. I'm going to pay you, and then I'm going to keep owing you."], [LEAVE]),
    node("failed", ["I heard.", "Don't. It's the city. It's always the city."], [LEAVE]),
  ],
}];

/** Keep the witness alive (Neon Ward protection job, level 5). */
export const WITNESS_PACK: ContentPack = { id: "witness", archetypes: [ines], encounters, dialogues, quests: [quest] };
