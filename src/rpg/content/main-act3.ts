// Main questline, Act 3: "Nami Maru" (Silk Harbour -> Low Tide Gate -> Spillway Locks).
// Ruben Salgado, the Silk Harbour dock boss who ran Jonah's crane crew, signs every night for forty
// sealed "calibration sensor" crates off the Nami Maru. His manifest says where they go, for a
// favour (his book back from the Low Tide Gate dock crew, a street encounter) or a fee. The crates
// go by Rim Line flatcar to a CorpSec bonded shed at Spillway Locks, where Lieutenant Dace Morrow
// runs the checkpoint. Inside: the night's lots, forty drives like the player's. Burn them, or let
// them go on to Kiln Nine. Optionally, Agnes Pell (the Spillway Locks lockkeeper) tells the player
// what really caused the Flood: the Ember Core's reserve was switched to the Spire's new array.
//
// Quests: Harbour Manifest (Ruben), The Bonded Shed (Ruben). Choices: favour or fee (Dock crew
// reputation), talk / bribe / fight past Morrow (Act 1 and 2 choices shift the checks), burn the
// shipment or let it through (rain.shipment, decides whether the quiet ending exists).

import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, EncounterDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, active, area, available, bye, ending, flagIs, go, inStage, look, member, node } from "./helpers.ts";
import { FLAG, ITEM, RAIN, SKIN, SPOTS, begun, beforeFinale } from "./main-common.ts";

const Q4 = RAIN.lightInWindow, Q5 = RAIN.manifest, Q6 = RAIN.shed;
const CHECKPOINT = "rain-checkpoint";
/** The Low Tide Gate dock crew (encounters.ts, auto, respawns): they lifted Ruben's book. */
const DOCK_CREW = "street-lowtide-dock";
const DOCK_CREW_AT = { x: 704, z: 576 };

// ---- People ------------------------------------------------------------------------------------

export const RUBEN: NpcDefinition = {
  id: "ruben-salgado", name: "Ruben Salgado", title: "Silk Harbour dock boss", district: 4, ...SPOTS.ruben, facing: FACE.south,
  look: look([96, 84, 60], [40, 34, 24], SKIN.tan, [255, 180, 90], "cap", "case", "sway"),
  greeting: ["Quay's working. If you're not lifting, stand behind the yellow line.", "I sign for what comes off the ships. That's the whole job. Sign, and don't ask."],
};

export const MORROW: NpcDefinition = {
  id: "dace-morrow", name: "Lt. Dace Morrow", title: "CorpSec checkpoint, Spillway Locks", district: 5, ...SPOTS.morrow, facing: FACE.east,
  look: look([62, 72, 98], [20, 24, 32], SKIN.deep, [120, 200, 255], "visor", null, "breathe"),
  greeting: ["Evening. Nothing to see here. Mostly that's even true.", "Move along, please. I'd like one quiet night before I retire."],
};

// ---- Encounter: Morrow's squad (neutral until you go through them) ------------------------------

const encounters: EncounterDefinition[] = [
  {
    id: CHECKPOINT, label: "CorpSec checkpoint (Spillway Locks)", area: area(751, 22, 14), hostile: false,
    members: [member("corp-shield", 750, 24, FACE.east), member("corp-trooper", 752, 14, FACE.north), member("corp-trooper", 746, 30, FACE.east)],
  },
];

// ---- Objects -----------------------------------------------------------------------------------

const interactables: InteractableDefinition[] = [
  {
    id: "rain-shed", label: "Bonded shed: the night's climate crates", ...SPOTS.shed, y: 1.4, glyph: "=",
    condition: inStage(Q6, "shed"), dialogue: "rain.shed",
  },
];

// ---- Quests ------------------------------------------------------------------------------------

const manifest: QuestDefinition2 = {
  id: Q5, title: "Harbour Manifest", category: "story", giver: RUBEN.id,
  summary: "Ruben Salgado, the Silk Harbour dock boss, signs every night for forty sealed climate crates off the Nami Maru. He'll tell you where they go, for his stolen manifest book back or for a fee.",
  requires: { quest: Q4 }, rewardHint: "300 cr (favour) or a 200 cr fee, 800 XP, Dock crew reputation", recommendedLevel: 4, start: "terms",
  stages: [
    {
      id: "terms", journal: "Ruben Salgado, the dock boss on the Silk Harbour quay, will tell you where the Nami Maru's climate crates go: for his stolen manifest book back, or for a 200 cr dock fee.",
      objectives: [{ id: "terms", kind: "choose", text: "Agree terms with Ruben Salgado on the Silk Harbour quay", dialogue: "rain.ruben", options: ["favour", "pay"] }],
      next: [{ if: flagIs(`${Q5}.terms`, "pay"), stage: "end-paid" }, { stage: "dock-crew" }],
    },
    {
      id: "dock-crew", journal: "The Low Tide Gate dock crew stole Ruben's manifest book to sell back to him. Take it back from them on the docks by Low Tide Gate station, on the Spillway's east rim.",
      onEnter: [{ waypoint: { ...DOCK_CREW_AT, label: "Low Tide Gate dock crew" } }],
      mode: "any",
      objectives: [
        { id: "crew", kind: "clear", text: "Take Ruben's manifest book from the dock crew at Low Tide Gate, The Spillway", encounter: DOCK_CREW },
        // If the crew was already beaten and hasn't come back yet, the book is simply there.
        { id: "shack", kind: "condition", text: "Search the dock crew's shack at Low Tide Gate", hidden: true, condition: { encounterCleared: DOCK_CREW }, target: DOCK_CREW_AT },
      ],
      onComplete: [{ give: ITEM.manifest }, { message: "Ruben's manifest book was in the dock crew's shack, in a bread bag, with a coffee ring on the cover.", tone: "loot" }],
      next: "return",
    },
    {
      id: "return", journal: "You have Ruben's manifest book. Bring it back to him on the Silk Harbour quay, west of Silk Harbour station.",
      onEnter: [{ waypoint: { ...SPOTS.ruben, label: "Ruben Salgado" } }],
      objectives: [{ id: "book", kind: "choose", text: "Give Ruben Salgado his manifest book on the Silk Harbour quay", dialogue: "rain.ruben", options: ["hand-book"] }],
      next: "end-favour",
    },
    ending("end-favour", "Ruben read you his manifest.", "favour"),
    ending("end-paid", "Ruben printed you a copy of his manifest.", "paid"),
  ],
  outcomes: {
    favour: {
      title: "Coffee Ring",
      journal: "Ruben read you his manifest: every night at four the Nami Maru's climate crates go by Rim Line flatcar to a CorpSec bonded shed at Spillway Locks, signed for by Lieutenant Dace Morrow. He paid you for the book.",
      effects: [{ credits: 300 }, { xp: 800 }, { rep: "dockers", by: 10 }],
    },
    paid: {
      title: "Dock Fee",
      journal: "Ruben printed you his manifest for the fee: every night at four the Nami Maru's climate crates go by Rim Line flatcar to a CorpSec bonded shed at Spillway Locks, signed for by Lieutenant Dace Morrow.",
      effects: [{ xp: 800 }, { rep: "dockers", by: 3 }],
    },
  },
};

const bondedShed: QuestDefinition2 = {
  id: Q6, title: "The Bonded Shed", category: "story", giver: RUBEN.id,
  summary: "The climate crates go to a CorpSec bonded shed at Spillway Locks. Get past Lieutenant Dace Morrow's checkpoint and decide what happens to the night's shipment.",
  requires: { quest: Q5 }, rewardHint: "400 cr, 1200 XP, reputation depends on the shipment", recommendedLevel: 5, start: "checkpoint",
  stages: [
    {
      id: "checkpoint", journal: "Ruben's climate crates go to a CorpSec bonded shed at Spillway Locks, on the east rim of The Spillway (Rim Line station of the same name). Get past Lieutenant Dace Morrow's checkpoint on the station forecourt: talk, pay, or go through his squad.",
      onEnter: [{ spawn: CHECKPOINT }, { waypoint: { ...SPOTS.morrow, label: "Lt. Dace Morrow" } }],
      mode: "any",
      objectives: [
        { id: "pass", kind: "choose", text: "Get past Lt. Dace Morrow's checkpoint at Spillway Locks", dialogue: "rain.morrow", options: ["cool-pass", "street-pass", "paid"] },
        { id: "force", kind: "clear", text: "Go through Morrow's CorpSec squad at Spillway Locks", encounter: CHECKPOINT, hidden: true },
      ],
      next: "shed",
    },
    {
      id: "shed", journal: "The bonded shed's side door is on the west side of the Spillway Locks forecourt, with the night's forty crates inside. Decide what happens to them. (Optional: Agnes Pell, the lockkeeper by the station, was on the gates the night of the Flood.)",
      onEnter: [{ waypoint: { ...SPOTS.shed, label: "Bonded shed" } }],
      objectives: [
        { id: "crates", kind: "choose", text: "Decide the fate of the climate crates in the bonded shed, Spillway Locks", dialogue: "rain.shed", options: ["burn", "through"] },
        { id: "pell", kind: "choose", text: "Optional: ask Agnes Pell, the Spillway Locks lockkeeper, about the night of the Flood", dialogue: "rain.pell", options: ["ask-flood"], optional: true },
      ],
      next: [{ if: flagIs(FLAG.shipment, "burned"), stage: "end-burned" }, { stage: "end-through" }],
    },
    ending("end-burned", "The shipment burned.", "burned"),
    ending("end-through", "The shipment went through.", "through"),
  ],
  outcomes: {
    burned: {
      title: "Ash on the Flatcar",
      journal: "The bonded shed burned blue with forty lots inside, and for one second the rain over the Spillway stopped. The manifest's last line named the next stop: KILN NINE, FOUNDRY, ATTN B. KOWALCZYK. She works outside Kiln Nine.",
      effects: [{ credits: 400 }, { xp: 1200 }, { rep: "corpsec", by: -15 }, { rep: "dockers", by: 5 }, { despawn: CHECKPOINT }, { waypoint: { ...SPOTS.bet, label: "Bet Kowalczyk, Kiln Nine" } }],
    },
    through: {
      title: "Forty Lots West",
      journal: "You closed the crates. At four the flatcar took them west along the Rim Line, one of them humming. The manifest's last line named the next stop: KILN NINE, FOUNDRY, ATTN B. KOWALCZYK. She works outside Kiln Nine.",
      effects: [{ credits: 400 }, { xp: 1200 }, { rep: "civilian", by: 5 }, { despawn: CHECKPOINT }, { waypoint: { ...SPOTS.bet, label: "Bet Kowalczyk, Kiln Nine" } }],
    },
  },
};

// ---- Dialogue ----------------------------------------------------------------------------------

const PAID_LINES = [
  "Every night at four the climate crates go by Rim Line flatcar to a CorpSec bonded shed at Spillway Locks.",
  "Lieutenant Dace Morrow signs for them there. Then they go on somewhere he doesn't write down.",
];

const dialogues: DialogueDefinition[] = [
  {
    id: "rain.ruben", npc: RUBEN.id,
    entries: [
      { condition: inStage(Q4, "ruben"), node: "nell", priority: 30 },
      { condition: inStage(Q5, "terms"), node: "terms", priority: 26 },
      { condition: inStage(Q5, "return"), node: "book", priority: 26 },
      { condition: available(Q5), node: "offer", priority: 22 },
      { condition: active(Q5), node: "q5-working", priority: 20 },
      { condition: available(Q6), node: "offer6", priority: 22 },
      { condition: active(Q6), node: "q6-working", priority: 20 },
      { condition: { all: [flagIs(FLAG.shipment, "burned"), beforeFinale] }, node: "after-burned", priority: 4 },
      { condition: { all: [flagIs(FLAG.shipment, "through"), beforeFinale] }, node: "after-through", priority: 4 },
    ],
    nodes: [
      node("nell", [
        "Nell sent you. Nell doesn't send people. She sits.",
        "Jonah was the best crane hand I had. I sent him up the high gantry at one in the morning because the ship was late and Meridian pays by the hour.",
        "Whatever you want to know, ask. I owe that family more than I can sign for.",
      ], [{ id: "nell-sent", label: "What comes off the Nami Maru every night?", condition: inStage(Q4, "ruben"), kind: "complete", next: "offer" }, LEAVE]),
      node("offer", [
        "Forty crates, every night at two, stencilled CALIBRATION SENSORS, CLIMATE. Sealed. I sign; I don't open.",
        "My manifest book says where they go after. Two nights ago the Low Tide Gate dock crew lifted it off my desk to sell it back to me.",
        "Get it back and I'll pay you three hundred and read you every line. Or pay the dock fee, two hundred, and I'll print you a copy. Fees keep my crew paid. I'm not proud of it.",
      ], [
        { id: "favour", label: "I'll get your book back from the Low Tide Gate crew. (300 cr)", condition: available(Q5), effects: [{ startQuest: Q5 }], next: "favour-ok" },
        { id: "pay", label: "Pay the dock fee. (-200 cr)", condition: { all: [available(Q5), { credits: 200 }] }, effects: [{ startQuest: Q5 }, { credits: -200 }], next: "paid-ok" },
        bye("Later.", "decline"),
      ]),
      node("terms", ["Book or fee. Either way I'll tell you where the crates go."], [
        { id: "favour", label: "I'll get your book back from the Low Tide Gate crew. (300 cr)", condition: inStage(Q5, "terms"), next: "favour-ok" },
        { id: "pay", label: "Pay the dock fee. (-200 cr)", condition: { all: [inStage(Q5, "terms"), { credits: 200 }] }, effects: [{ credits: -200 }], next: "paid-ok" },
        LEAVE,
      ]),
      node("favour-ok", [
        "Low Tide Gate, out on the Spillway docks by the Rim Line station of the same name. Four of them. They don't talk; they throw things.",
        "Bring the book back here. I'll be on the quay.",
      ], [LEAVE]),
      node("paid-ok", ["[He counts it twice, then prints a page from a machine that has seen better decades.]", ...PAID_LINES], [go("next", "What happens at the shed?", "offer6")]),
      node("q5-working", ["Low Tide Gate dock crew, on the Spillway docks by the Rim Line station. My book's got a coffee ring on the cover. Bring it here."], [LEAVE]),
      node("book", ["That's my coffee ring. Hand it over."], [
        { id: "hand-book", label: "Give Ruben his manifest book. (+300 cr)", condition: { all: [inStage(Q5, "return"), { item: ITEM.manifest }] }, reason: "You need the manifest book", effects: [{ take: ITEM.manifest }], kind: "complete", next: "read" },
        LEAVE,
      ]),
      node("read", ["[He reads with one finger, like a man reading a will.]", ...PAID_LINES], [go("next", "What happens at the shed?", "offer6")]),
      node("offer6", [
        "Morrow's a decent man in a bad uniform. He'll let a courier through if the courier gives him a reason he can write down.",
        "The shed's the side door on the west of the Spillway Locks forecourt, by the Rim Line station. What you do inside is your business. Four hundred when you come back with an answer, whatever it is.",
      ], [
        { id: "accept-shed", label: "I'm going to Spillway Locks. (400 cr)", condition: available(Q6), effects: [{ startQuest: Q6 }], next: "q6-accepted" },
        bye("Not yet.", "decline"),
      ]),
      node("q6-accepted", ["Spillway Locks is on the east rim. The Rim Line only runs one way round, so it's a long ride; most people drive."], [LEAVE]),
      node("q6-working", ["Spillway Locks, east rim. Morrow's checkpoint is on the station forecourt; the shed's the side door on its west side."], [LEAVE]),
      node("after-burned", ["You burned them. I signed for forty crates of ash this morning.", "Nobody's asked me about it. That's how I know someone important is angry."], [LEAVE]),
      node("after-through", ["Forty crates went through on the flatcar last night, same as always.", "Except now I know what I'm signing. It doesn't make the pen any lighter."], [LEAVE]),
    ],
  },
  {
    id: "rain.morrow", npc: MORROW.id,
    entries: [
      { condition: inStage(Q6, "checkpoint"), node: "stop", priority: 30 },
      { condition: inStage(Q6, "shed"), node: "past", priority: 25 },
      { condition: { all: [flagIs(FLAG.shipment, "burned"), beforeFinale] }, node: "after-burned", priority: 4 },
      { condition: { all: [flagIs(FLAG.shipment, "through"), beforeFinale] }, node: "after-through", priority: 4 },
    ],
    nodes: [
      node("stop", [
        "Evening. This forecourt is a Meridian bonded area from two until five.",
        "I need a reason I can write down. 'Curious' isn't a reason. 'Lost' is, but you don't look lost.",
      ], [
        {
          id: "courier", label: "Climate courier, here for the lot count.", next: null,
          check: {
            stat: "cool", difficulty: 4, success: "cool-ok", failure: "no",
            bonus: [
              { if: flagIs(FLAG.drive, "logged"), by: 2, label: "The Exchange logged you as a courier" },
              { if: flagIs(FLAG.moth, "aired"), by: -1, label: "On alert since Station Nobody's broadcast" },
            ],
          },
        },
        {
          id: "dock", label: "Ruben Salgado sent me to count his crates.", next: null,
          check: { stat: "street", difficulty: 4, success: "street-ok", failure: "no", bonus: [{ if: { rep: "dockers", atLeast: 10 }, by: 2, label: "The dock crew vouch for you" }] },
        },
        { id: "paid", label: "Offer him 300 cr for a long cigarette break.", condition: { all: [inStage(Q6, "checkpoint"), { credits: 300 }] }, effects: [{ credits: -300 }], next: "bribed" },
        { id: "fight", label: "Go through his squad.", kind: "decline", condition: inStage(Q6, "checkpoint"), effects: [{ hostile: CHECKPOINT, value: true }, { message: "Morrow steps back and folds his arms. 'Not paid enough for this.' His squad draws.", tone: "danger" }], next: null },
        LEAVE,
      ]),
      node("cool-ok", [
        "'Lot count.' He writes it down, and seems relieved to have something to write.",
        "Go on. The shed's the side door on the west of the forecourt. Don't lick the crates.",
      ], [{ id: "cool-pass", label: "Walk to the shed.", kind: "continue", condition: inStage(Q6, "checkpoint"), next: null }]),
      node("street-ok", [
        "Ruben. Course it is. He counts those crates like they owe him money.",
        "Go on. Side door, west of the forecourt.",
      ], [{ id: "street-pass", label: "Walk to the shed.", kind: "continue", condition: inStage(Q6, "checkpoint"), next: null }]),
      node("bribed", ["[He pockets it without looking.]", "I'm going to stand over here and think about my pension for ten minutes."], [LEAVE]),
      node("no", ["No. Try a better reason, or try the station cafe. It's warmer."], [go("again", "Let me try that again.", "stop"), LEAVE]),
      node("past", ["You've had your reason. The shed's the side door, west of the forecourt. I'm not watching."], [LEAVE]),
      node("after-burned", ["Somebody burned my shed. My report says 'electrical fault'.", "I've always liked the word 'electrical'. It covers so much."], [LEAVE]),
      node("after-through", ["Forty lots, signed and sent. Quiet night.", "I like quiet nights. They're the only ones I get home from."], [LEAVE]),
    ],
  },
  {
    // The bonded shed's crates (spoken by the interactable).
    id: "rain.shed", npc: "rain-shed",
    entries: [{ node: "crates" }],
    nodes: [
      node("crates", [
        "[Forty crates stencilled CALIBRATION SENSORS. Inside each, in wet foam, a drive like yours, labelled LOT, a number and a name.]",
        "[LOT 112: QUIROGA, R. LOT 113: OKONJO, P. LOT 114: VANCE, MILLIE, AGE 9.]",
        "[A drum of flare fuel stands by the door. The Rim Line flatcar is due at four.]",
      ], [
        { id: "burn", label: "Burn the shipment. Nobody else gets woven into the rain tonight. (-15 CorpSec, +5 Dock crew)", condition: inStage(Q6, "shed"), effects: [{ setFlag: FLAG.shipment, value: "burned" }], next: "burning" },
        { id: "through", label: "Close the crates and let them go. Those are people's last words. (+5 Civilians)", condition: inStage(Q6, "shed"), effects: [{ setFlag: FLAG.shipment, value: "through" }], next: "closing" },
        bye("Not yet."),
      ]),
      node("burning", [
        "[The flare fuel catches blue. The foam goes up, then the drives, one label at a time.]",
        "[For one second the rain over the Spillway stops. Then it starts again, a little thinner.]",
      ], [LEAVE]),
      node("closing", [
        "[You close the lids. At four the flatcar takes the crates west along the Rim Line, toward the Foundry.]",
        "[One of them is humming.]",
      ], [LEAVE]),
    ],
  },
  {
    // Agnes Pell (rim-line.ts) knows what caused the Flood. Once heard, the flag unlocks a line for
    // Tomas in Act 4 and an option in the finale's narration.
    id: "rain.pell", npc: "pell",
    entries: [{ condition: { all: [begun(Q6), { not: { flag: FLAG.floodTruth } }] }, node: "intro", priority: 13 }],
    nodes: [
      node("intro", [
        "[Agnes Pell squints across the forecourt at the CorpSec shed.]",
        "You've been in that shed. Asking questions, are you? Ask a useful one.",
      ], [
        { id: "ask-flood", label: "What happened on these gates the night of the Flood?", effects: [{ setFlag: FLAG.floodTruth }], next: "flood" },
        LEAVE,
      ]),
      node("flood", [
        "I was on these gates. At ten past one the Barrier pumps lost power. Not a fault: the Ember Core's reserve was switched up a trunk line to the Meridian Spire. They were testing a new weather array.",
        "Twenty past one, the sea came in. Three hundred and twelve people.",
        "The inquiry said 'act of God'. God doesn't sign for power. Somebody at Meridian did.",
      ], [LEAVE]),
    ],
  },
];

/** Act 3: the harbour, the checkpoint and the shipment. */
export const MAIN_ACT3_PACK: ContentPack = {
  id: "main-act3",
  npcs: [RUBEN, MORROW],
  encounters,
  interactables,
  quests: [manifest, bondedShed],
  dialogues,
};
