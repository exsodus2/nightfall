// Pack "bounty-board": repeatable contracts from Sable Quist's board in the Silk Market.
//
// Four named marks, one per faction and district. The board posts two at a time and re-rolls:
// the flag `board.roll` (0..3, unset = 0) picks which pair is up, each claimed bounty advances it,
// and Sable will re-roll early for 50 cr. Every contract is `repeatable` (the mark is back on the
// street after the cooldown), and kill objectives count kills (not `clear`, which the quest engine
// remembers forever) so each run tracks its own mark.

import type { Condition, ContentPack, DialogueDefinition, DialogueOptionDef, EncounterDefinition, EnemyArchetype, FactionId, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, available, bye, go, inStage, look, member, node } from "./helpers.ts";

const COOLDOWN = 900;
const ROLL = "board.roll";
const rollIs = (n: number): Condition => (n === 0 ? { not: { flag: ROLL } } : { flag: ROLL, is: n });

interface Mark {
  quest: string; title: string; arch: EnemyArchetype; encounter: EncounterDefinition; slot: number;
  where: string; poster: string; claim: string; level: number; credits: number; xp: number;
  rep: readonly { faction: FactionId; by: number }[];
}

const mark = (id: string, name: string, faction: FactionId, base: Omit<EnemyArchetype, "id" | "name" | "faction" | "loot" | "tags" | "xp">, tags: readonly string[], xp: number): EnemyArchetype =>
  ({ ...base, id, name, faction, loot: "bounty-mark", xp, tags: [...tags, "bounty"] });

const MARKS: readonly Mark[] = [
  {
    quest: "bounty-petrov", title: "Wanted: Two-Stroke Petrov", slot: 0, level: 4, credits: 350, xp: 450, rep: [{ faction: "razorbacks", by: -5 }],
    where: "the Spillway, at the junction east of the Razorback corner",
    poster: "WANTED: 'TWO-STROKE' PETROV. RAZORBACKS. RAN A SCOOTER THROUGH A NOODLE CART. TWICE. 350 CR.",
    claim: "Petrov's scooter keys. Good. The noodle cart sends its regards.",
    arch: mark("bounty-petrov", "Two-Stroke Petrov", "razorbacks", {
      health: 260, armor: 0.15, speed: { walk: 1.8, run: 5.6 }, weapon: "kernel-panic", reaction: 0.45, aggression: 0.75,
      perception: { sight: 44, fovDegrees: 130, hearing: 44 }, scale: 1.1,
      look: look([200, 70, 30], [60, 24, 12], [182, 140, 108], [255, 190, 60], "cap", null, "swing"),
      barks: { alert: ["VROOM VROOM, TOURIST."], hurt: ["MY PAINT JOB!"], death: ["...tell the cart... sorry..."] },
    }, ["razorback", "gang"], 220),
    encounter: {
      id: "bounty-petrov-crew", label: "Petrov's crew", area: area(320, 256, 16), hostile: true,
      members: [member("bounty-petrov", 327.2, 263.2, FACE.west, { tag: "mark" }), member("rb-thug", 312.8, 263.2, FACE.east), member("rb-gunner", 327.2, 248.8, FACE.south)],
    },
  },
  {
    quest: "bounty-okonkwo", title: "Wanted: Handler Okonkwo-9", slot: 1, level: 6, credits: 500, xp: 700, rep: [{ faction: "corpsec", by: 3 }],
    where: "Neon Ward, west of the avenue on the -128 street",
    poster: "WANTED: OKONKWO-9. EX-CORPSEC. SELLS DRONE FEEDS TO ANYONE. YES, CORPSEC POSTED THIS ONE. 500 CR.",
    claim: "CorpSec paid for their own mess. They always do, eventually. Here's your cut.",
    arch: mark("bounty-okonkwo", "Handler Okonkwo-9", "corpsec", {
      health: 220, armor: 0.3, speed: { walk: 1.7, run: 4.8 }, weapon: "brace-burst", reaction: 0.5, aggression: 0.35,
      perception: { sight: 70, fovDegrees: 170, hearing: 55 },
      look: look([80, 60, 100], [26, 20, 34], [214, 188, 164], [200, 140, 255], "visor", "antenna", "scan"),
      barks: { alert: ["I SAW YOU COMING FOUR BLOCKS AGO."], hurt: ["DRONE THREE, WHERE ARE YOU?"], death: ["...feed... ending..."] },
    }, ["corpsec", "handler"], 240),
    encounter: {
      id: "bounty-okonkwo-crew", label: "Okonkwo-9's detail", area: area(-192, -128, 16), hostile: true,
      members: [member("bounty-okonkwo", -184.8, -120.8, FACE.south, { tag: "mark" }), member("corp-trooper", -199.2, -120.8, FACE.east), member("corp-trooper", -184.8, -135.2, FACE.south)],
    },
  },
  {
    quest: "bounty-mirror", title: "Wanted: Mirror", slot: 2, level: 8, credits: 650, xp: 950, rep: [{ faction: "ghosts", by: -5 }],
    where: "the Ghost Circuit, at the junction south-west of the fixer",
    poster: "WANTED: 'MIRROR'. GHOSTS. KNIFE WORK. NOBODY HAS SEEN THE FACE. EVERYBODY HAS SEEN THEIR OWN. 650 CR.",
    claim: "Mirror's blade. Nobody ever got close enough to see it before. I'll sleep better. Slightly.",
    arch: mark("bounty-mirror", "Mirror", "ghosts", {
      health: 210, armor: 0.1, speed: { walk: 2.2, run: 7.0 }, weapon: "null-pointer", reaction: 0.25, aggression: 1,
      perception: { sight: 44, fovDegrees: 160, hearing: 70 },
      look: look([200, 205, 215], [30, 30, 36], [170, 170, 176], [220, 240, 255], "hood", null, "sway"),
      barks: { alert: ["OH. IT'S YOU. IT'S ALWAYS YOU."], hurt: ["CRACKED."], death: ["...seven... years..."] },
    }, ["ghost", "assassin"], 280),
    encounter: {
      id: "bounty-mirror-crew", label: "Mirror and a lookout", area: area(320, -256, 16), hostile: true,
      members: [member("bounty-mirror", 327.2, -248.8, FACE.west, { tag: "mark" }), member("ghost-blinker", 312.8, -263.2, FACE.east)],
    },
  },
  {
    quest: "bounty-cinder", title: "Wanted: Sister Cinder", slot: 3, level: 9, credits: 800, xp: 1100, rep: [{ faction: "chrome-saints", by: -8 }],
    where: "the Foundry, north-east of the Ember Core",
    poster: "WANTED: SISTER CINDER. CHROME SAINTS. 'PURIFIES' THE UNAUGMENTED FROM ROOFTOPS. 800 CR. BRING A HAT.",
    claim: "Cinder's optics. The Saints will call it martyrdom. I'll call it Tuesday. Paid.",
    arch: mark("bounty-cinder", "Sister Cinder", "chrome-saints", {
      health: 200, armor: 0.25, speed: { walk: 1.5, run: 4.4 }, weapon: "semicolon", reaction: 0.6, aggression: 0.2,
      perception: { sight: 80, fovDegrees: 80, hearing: 36 },
      look: look([240, 200, 170], [120, 60, 40], [214, 188, 164], [255, 140, 80], "visor", "antenna", "scan"),
      barks: { alert: ["HOLD STILL. THIS IS HOLY."], hurt: ["FLESH WOUND. YOURS, SOON."], death: ["...burn... bright..."] },
    }, ["saint", "cult", "sniper"], 300),
    encounter: {
      id: "bounty-cinder-crew", label: "Sister Cinder's circle", area: area(-384, -128, 18), hostile: true,
      members: [member("bounty-cinder", -376.8, -120.8, FACE.north, { tag: "mark" }), member("cs-acolyte", -391.2, -120.8, FACE.east), member("cs-acolyte", -376.8, -135.2, FACE.south)],
    },
  },
];

/** A contract is posted while it is available and the board's roll is its slot or the one before. */
const posted = (m: Mark): Condition => ({ all: [available(m.quest), { any: [rollIs(m.slot), rollIs((m.slot + 3) % 4)] }] });

const contract = (m: Mark): QuestDefinition2 => ({
  id: m.quest, title: m.title, category: "contract", giver: "sable",
  summary: m.poster, rewardHint: `${m.credits} cr (+100 cr if the whole crew goes down)`, recommendedLevel: m.level,
  repeatable: { cooldown: COOLDOWN }, start: "hunt",
  stages: [
    {
      id: "hunt", journal: `${m.arch.name} was last seen in ${m.where}.`,
      onEnter: [{ spawn: m.encounter.id }, { waypoint: { x: m.encounter.area.x, z: m.encounter.area.z, label: m.arch.name } }],
      objectives: [
        { id: "mark", kind: "kill", text: `Take down ${m.arch.name}`, count: 1, tag: "mark", encounter: m.encounter.id },
        // Counts every kill in the encounter, the mark included: a clean sweep pays a bonus.
        { id: "crew", kind: "kill", text: "Leave none of the crew standing", count: m.encounter.members.length, encounter: m.encounter.id, optional: true },
      ],
      next: "claim",
    },
    {
      id: "claim", journal: `${m.arch.name} is down. Sable pays on proof.`,
      objectives: [{ id: "claim", kind: "choose", text: "Claim the bounty from Sable", dialogue: "bounty.sable", options: [`claim-${m.slot}`, `claim-${m.slot}-full`] }],
    },
  ],
  outcomes: {
    claimed: {
      title: "Bounty Claimed", journal: m.claim,
      effects: [{ credits: m.credits }, { xp: m.xp }, ...m.rep.map(r => ({ rep: r.faction, by: r.by })), { setFlag: ROLL, value: (m.slot + 1) % 4 }, { addFlag: "board.claimed", by: 1 }],
    },
  },
});

// The board: posted contracts, claims (a bonus for a clean sweep), and the paid re-roll.
const take = (m: Mark): DialogueOptionDef => ({
  id: `take-${m.slot}`, label: `${m.poster}`, condition: posted(m), hideIfUnavailable: true, kind: "accept",
  effects: [{ startQuest: m.quest }], next: "taken",
});
const claims = (m: Mark): DialogueOptionDef[] => {
  const inClaim = inStage(m.quest, "claim"), sweep: Condition = { flag: `${m.quest}.crew` };
  return [
    { id: `claim-${m.slot}-full`, label: `Claim ${m.arch.name} - and the whole crew (+100 cr)`, condition: { all: [inClaim, sweep] }, hideIfUnavailable: true, kind: "complete", effects: [{ credits: 100 }], next: "paid" },
    { id: `claim-${m.slot}`, label: `Claim ${m.arch.name}`, condition: { all: [inClaim, { not: sweep }] }, hideIfUnavailable: true, kind: "complete", next: "paid" },
  ];
};
const rerolls: DialogueOptionDef[] = [0, 1, 2, 3].map(n => ({
  id: `reroll-${n}`, label: "Re-roll the board (50 cr)", condition: { all: [rollIs(n), { credits: 50 }] }, hideIfUnavailable: true,
  kind: "continue", effects: [{ credits: -50 }, { setFlag: ROLL, value: (n + 1) % 4 }], next: "board",
}));

const board: DialogueDefinition = {
  id: "bounty.sable", npc: "sable",
  entries: [{ condition: { any: MARKS.map(m => inStage(m.quest, "claim")) }, node: "board", priority: 20 }],
  nodes: [
    node("board", [
      "[The board: rain-streaked paper under a sheet of plastic, most of it crossed out in red.]",
      "Sable: Two up tonight. Pick one, or pay me to pin up something else.",
    ], [...MARKS.flatMap(claims), ...MARKS.map(take), ...rerolls, go("rules", "How does this work?", "rules"), LEAVE]),
    node("rules", [
      "You pick a name. You find the name. The name stops being a problem. I pay.",
      "Names come back, by the way. This city grows new ones like mould. Check again later.",
    ], [go("back", "Show me the board.", "board"), LEAVE]),
    node("taken", ["It's on your tracker. Try to bring back something I can prove."], [bye("On my way.")]),
    node("paid", ["Paid. The board says thank you. The board doesn't talk, so I'm saying it for it.", "New names go up in a while."], [go("back", "Show me the board.", "board"), LEAVE]),
  ],
};

/** Repeatable bounty contracts on Sable's board. */
export const BOUNTY_PACK: ContentPack = {
  id: "bounty-board",
  archetypes: MARKS.map(m => m.arch),
  encounters: MARKS.map(m => m.encounter),
  quests: MARKS.map(contract),
  dialogues: [board],
};
