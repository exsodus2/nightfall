// Pack "harbour-watch": "Harbour Watch" on the Silk Harbour quay, under the Rim Line.
// Ines Varga, the night customs clerk, wants the Nami Maru's lights logged from three places: the
// customs scope at the Silk Harbour stairs, the bollard at the quay's east end, and the stretch of
// rim the Rim Line runs along toward Gardens Rim (ride it, or walk the quay road west: both count).
// The three logs show a signal. A deckhand, Kaito Brann, offers an envelope to forget it. Then the
// player files the log with Ines: by the book, clean (bribe kept), or both hands (bribe kept and the
// signal filed anyway). One payout per ending.
// World flag: harbour.watch ("reported" | "pocketed" | "double").
//
// The ship itself (world.ts SIGHTS "ship", z ~ 814) is not walkable; everything here stands on the
// quay (z < 766). Every position is checked walkable by tests/harbour-lanterns-rent-dial-rainline.test.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { Condition, ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, available, bye, ending, flagIs, go, inStage, look, node } from "./helpers.ts";

const QUEST = "harbour-watch";
const TOOK = `${QUEST}.envelope`;
const has = (flag: string): Condition => ({ flag });
const lacks = (flag: string): Condition => ({ not: { flag } });

/** Where things stand on the quay (each is on clear ground; the content test proves it). */
export const HARBOUR_WATCH_SPOTS = {
  ines: { x: 72, z: 748 },
  kaito: { x: -44, z: 736 },
  stairs: { x: 0, z: 763 },
  bollard: { x: 140, z: 760.5 },
  /** The Rim Line runs along z = 768 here; the quay road's edge is at z ~ 765. */
  carriage: { x: -200, z: 764 },
} as const;

const SKIN = { tan: [182, 140, 108], brown: [128, 92, 70] } as const;

export const HARBOUR_WATCH_NPCS: readonly NpcDefinition[] = [
  {
    id: "ines-varga", name: "Ines Varga", title: "Night customs clerk", district: 4, ...HARBOUR_WATCH_SPOTS.ines, facing: FACE.south,
    look: look([46, 58, 72], [210, 200, 170], SKIN.tan, [170, 220, 255], "visor", "case", "scan"),
    greeting: ["Customs never sleeps. Customs just sits very still and writes things down.", "The Nami Maru. Forty thousand tonnes of nobody's business."],
  },
  {
    id: "kaito-brann", name: "Kaito Brann", title: "Nami Maru deckhand", district: 4, ...HARBOUR_WATCH_SPOTS.kaito, facing: FACE.east,
    look: look([92, 70, 48], [30, 24, 18], SKIN.brown, [255, 170, 80], "cap", "bag", "swing"),
    greeting: ["Shore leave. Six hours, then back up the ladder.", "Nice night for standing still."],
  },
];

const INTERACTABLES: readonly InteractableDefinition[] = [
  {
    id: "hw-scope-stairs", label: "Customs scope (Silk Harbour stairs)", ...HARBOUR_WATCH_SPOTS.stairs, glyph: "%",
    condition: { all: [inStage(QUEST, "watch"), lacks(`${QUEST}.stairs`)] },
    effects: [{ message: "LOG 1, the stairs: bridge lit, two greens over a red. Crane lamps steady. Container row nine, stern end: one blue lamp, dark.", tone: "quest" }],
  },
  {
    id: "hw-scope-bollard", label: "Bollard scope (quay, east end)", ...HARBOUR_WATCH_SPOTS.bollard, glyph: "%",
    condition: { all: [inStage(QUEST, "watch"), lacks(`${QUEST}.bollard`)] },
    effects: [{ message: "LOG 2, the east bollard: the blue lamp on row nine is lit now. Off, on, off. Nobody is working that row.", tone: "quest" }],
  },
];

const quest: QuestDefinition2 = {
  id: QUEST, title: "Harbour Watch", category: "side", giver: "ines-varga",
  summary: "Log the Nami Maru's lights from three places on the Silk Harbour quay for the night customs clerk, then decide what goes in the log.",
  rewardHint: "160-300 cr, 240 XP; reputation depends on the log", recommendedLevel: 2, start: "watch",
  stages: [
    {
      id: "watch",
      journal: "Ines wants the Nami Maru's lights logged from three places: the customs scope at the Silk Harbour stairs, the bollard scope at the quay's east end, and the stern side, seen from the Rim Line toward Gardens Rim (ride it, or walk the quay road west about two hundred metres).",
      objectives: [
        { id: "stairs", kind: "interact", object: "hw-scope-stairs", text: "Log the ship from the customs scope at the Silk Harbour stairs" },
        { id: "bollard", kind: "interact", object: "hw-scope-bollard", text: "Log the ship from the bollard scope at the quay's east end" },
        { id: "carriage", kind: "reach", area: area(HARBOUR_WATCH_SPOTS.carriage.x, 766, 6, "Rim Line, stern side of the Nami Maru"), text: "Log the stern side from the Rim Line toward Gardens Rim (or the quay road west)" },
      ],
      onComplete: [{ message: "LOG 3 closes it: the blue lamp blinks short-short-long at the quay, and a torch on the quay answers. That is a signal, not a work light.", tone: "quest" }],
      next: "brann",
    },
    {
      id: "brann",
      journal: "Three logs, one pattern: a blue lamp on the stern signals the quay and someone answers. A deckhand on the quay behind the station, Kaito Brann, is waving you over. Hear him out.",
      onEnter: [{ waypoint: { ...HARBOUR_WATCH_SPOTS.kaito, label: "Kaito Brann (quay, behind the station)" } }],
      objectives: [{ id: "offer", kind: "choose", text: "Hear Kaito Brann out on the quay", dialogue: "hw.kaito", options: ["take", "refuse"] }],
      next: "file",
    },
    {
      id: "file",
      journal: "Ines is waiting on the quay east of the station for the logs. What goes in them is up to you.",
      objectives: [{ id: "log", kind: "choose", text: "File the logs with Ines Varga", dialogue: "hw.ines", options: ["file-signal", "file-clean"] }],
      next: [
        { if: flagIs(`${QUEST}.log`, "file-clean"), stage: "end-pocketed" },
        { if: has(TOOK), stage: "end-double" },
        { stage: "end-reported" },
      ],
    },
    ending("end-reported", "The signal went in the log.", "reported"),
    ending("end-pocketed", "The log came back clean.", "pocketed"),
    ending("end-double", "The signal went in the log, and so did Brann's money, into your pocket.", "double"),
  ],
  outcomes: {
    reported: {
      title: "By the Book", journal: "The signal went in the log. A CorpSec launch boarded the Nami Maru at dawn and walked off with six crates of something. Ines paid the watch fee and the dock crews stopped saying hello.",
      effects: [{ credits: 160 }, { xp: 240 }, { rep: "corpsec", by: 5 }, { rep: "dockers", by: -5 }, { setFlag: "harbour.watch", value: "reported" }],
    },
    pocketed: {
      title: "Clean Log", journal: "The log said: lights normal, nothing to report. Ines signed it without reading it. Brann's envelope held two hundred and twenty, and the quay crews nod at you now.",
      effects: [{ credits: 220 }, { xp: 240 }, { rep: "dockers", by: 6 }, { rep: "corpsec", by: -4 }, { setFlag: "harbour.watch", value: "pocketed" }],
    },
    double: {
      title: "Both Hands", journal: "You kept Brann's envelope and filed the signal anyway. CorpSec boarded at dawn, Ines paid the watch fee, and the Nami Maru's crew has your face on a list.",
      effects: [{ credits: 300 }, { xp: 240 }, { rep: "corpsec", by: 3 }, { rep: "dockers", by: -12 }, { setFlag: "harbour.watch", value: "double" }],
    },
  },
};

const DIALOGUES: readonly DialogueDefinition[] = [
  {
    id: "hw.ines", npc: "ines-varga", quest: QUEST,
    entries: [
      { condition: available(QUEST), node: "offer" },
      { condition: inStage(QUEST, "watch"), node: "watching" },
      { condition: inStage(QUEST, "brann"), node: "brann" },
      { condition: inStage(QUEST, "file"), node: "file" },
      { condition: { quest: QUEST, outcome: "reported" }, node: "after-reported" },
      { condition: { quest: QUEST, outcome: "pocketed" }, node: "after-pocketed" },
      { condition: { quest: QUEST, outcome: "double" }, node: "after-double" },
      { node: "hub" },
    ],
    nodes: [
      node("hub", ["Customs never sleeps. Customs just sits very still and writes things down."], [LEAVE]),
      node("offer", [
        "[A clerk in a rain visor sits on an upturned crate with a clipboard and a flask.]",
        "The Nami Maru. Moored three nights, papers say rice and pump parts. My scope says somebody on her is busy after midnight.",
        "I need her lights logged from three places: the customs scope at the stairs, the bollard scope at the east end, and her stern side, which you only see from the rim west of here. The Rim Line runs right past it. One fee for the watch.",
      ], [
        { id: "accept-watch", label: "I'll log her lights.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "accepted" },
        bye("Not tonight.", "decline"),
      ]),
      node("accepted", ["Stairs first; the scope's on the rail by the station. Then the east bollard. Then the stern: ride one stop toward Gardens Rim and look left, or walk it.", "Write down what you see, not what you think."], [LEAVE]),
      node("watching", ["Three logs. Stairs, east bollard, stern side. Lights only, no opinions."], [LEAVE]),
      node("brann", ["A deckhand is waving at you from behind the station. Off the Nami Maru, by the coat.", "Go and see what he wants. I'll be here. I'm always here."], [LEAVE]),
      node("file", [
        "Well? What did she show you?",
        "[Ines holds out the clipboard. The log has two boxes: SIGNAL OBSERVED and NOTHING TO REPORT.]",
      ], [
        { id: "file-signal", label: "A blue lamp on the stern, signalling the quay. Log it.", condition: inStage(QUEST, "file"), kind: "complete", next: "filed-signal" },
        { id: "file-clean", label: "Lights normal. Nothing to report.", condition: { all: [inStage(QUEST, "file"), has(TOOK)] }, reason: "You have no reason to lie for anyone", kind: "complete", next: "filed-clean" },
        LEAVE,
      ]),
      node("filed-signal", ["[She writes fast.] Short-short-long. That's the old dock code for 'clear to land'.", "A launch will be alongside her by dawn. Here's your fee. Walk home the long way."], [LEAVE]),
      node("filed-clean", ["Nothing to report. [She signs without looking up.] It's a quiet harbour, mostly.", "Here's your fee for the walk."], [LEAVE]),
      node("after-reported", ["CorpSec took six crates off the Nami Maru at dawn. Nobody's told me what was in them. Nobody ever does."], [LEAVE]),
      node("after-pocketed", ["Quiet night on the log. Quiet nights are my favourite kind."], [LEAVE]),
      node("after-double", ["CorpSec boarded her at dawn. The crew's been asking who did the watch. I said I did it myself.", "You're welcome."], [LEAVE]),
    ],
  },
  {
    id: "hw.kaito", npc: "kaito-brann", quest: QUEST,
    entries: [
      { condition: inStage(QUEST, "brann"), node: "offer" },
      { condition: inStage(QUEST, "file"), node: "waiting" },
      { condition: { quest: QUEST, outcome: "pocketed" }, node: "after-pocketed" },
      { condition: { quest: QUEST, outcome: "double" }, node: "after-double" },
      { condition: { quest: QUEST, outcome: "reported" }, node: "after-reported" },
      { node: "hub" },
    ],
    nodes: [
      node("hub", ["Shore leave. Six hours, then back up the ladder.", "Nice night for standing still."], [LEAVE]),
      node("offer", [
        "[A deckhand in a Nami Maru coat lights a cigarette he does not smoke.]",
        "You've been looking at my ship all night. From the stairs, from the bollard, from the rim. Customs pays you, what, one-sixty?",
        "Row nine is medicine. Clinic antivirals, no Meridian stamp, for the Spillway. If Ines writes 'signal', CorpSec takes it and sells it back to them at four times the price. This envelope says 'lights normal'.",
      ], [
        { id: "take", label: "Take the envelope. (220 cr when the log is filed)", condition: inStage(QUEST, "brann"), effects: [{ setFlag: TOOK }], next: "took" },
        { id: "refuse", label: "Keep your envelope.", condition: inStage(QUEST, "brann"), next: "refused" },
        go("ask", "Medicine. Says you.", "ask", { condition: inStage(QUEST, "brann") }),
        LEAVE,
      ]),
      node("ask", ["Says me. You want to open a crate on the quay with CorpSec watching? Be my guest.", "Envelope's still here."], [go("back", "Back to the envelope.", "offer"), LEAVE]),
      node("took", ["Smart. Tell Ines it was a quiet night and we never met.", "[The envelope is fat. Two hundred and twenty, in fives.]"], [LEAVE]),
      node("refused", ["Your call. It's always somebody's call.", "[He pockets it and walks back toward the ladder.]"], [LEAVE]),
      node("waiting", ["Ines is waiting on you. So am I."], [LEAVE]),
      node("after-pocketed", ["Row nine went up the canal last night. The Spillway clinic says thanks. They don't know who to thank."], [LEAVE]),
      node("after-double", ["[He looks at you for a long time.] Enjoy the money."], [LEAVE]),
      node("after-reported", ["CorpSec's selling antivirals in the Spillway this week. Four times the price. Hope the fee was worth it."], [LEAVE]),
    ],
  },
];

export const HARBOUR_WATCH_PACK: ContentPack = {
  id: "harbour-watch",
  npcs: HARBOUR_WATCH_NPCS,
  interactables: INTERACTABLES,
  quests: [quest],
  dialogues: DIALOGUES,
};
