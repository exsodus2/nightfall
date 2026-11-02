import type { Condition, ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { LEAVE, active, available, completed, go, inStage, node } from "./helpers.ts";

const QUEST = "a-little-night";
const BOARD = "glasshouse.board", LEFT = "glasshouse.left-tray", RIGHT = "glasshouse.right-tray";
const DOOR = { x: -595, z: 200.7 };
const leftDone: Condition = { flag: `${QUEST}.left-tray`, is: "drain-left" };
const rightDone: Condition = { flag: `${QUEST}.right-tray`, is: "seat-wick" };
const leftPending: Condition = { all: [inStage(QUEST, "trays"), { not: leftDone }] };
const rightPending: Condition = { all: [inStage(QUEST, "trays"), { not: rightDone }] };

export const GLASSHOUSE_STATIONS: Readonly<Record<"board" | "left" | "right", InteractableDefinition>> = {
  board: { id: "glasshouse-growing-board", label: "Read Neri's growing board", place: "glasshouse", x: -595, z: 214.88, y: 2.2, glyph: ">", dialogue: BOARD },
  left: { id: "glasshouse-left-tray", label: "Tend the left rainfern tray", place: "glasshouse", x: -588.95, z: 209.3, y: 2.2, glyph: "=", condition: active(QUEST), dialogue: LEFT },
  right: { id: "glasshouse-right-tray", label: "Tend the right rainfern tray", place: "glasshouse", x: -601.7, z: 209.3, y: 2.2, glyph: "*", condition: active(QUEST), dialogue: RIGHT },
};

const quest: QuestDefinition2 = {
  id: QUEST, title: "A Little Night", category: "gig", giver: null,
  summary: "Neri left a tending shift on the Glasshouse growing board: fix two rainfern trays, then reset the nursery lamp timer.",
  rewardHint: "60 cr, 100 XP, Civilian reputation", recommendedLevel: 1, start: "trays",
  stages: [
    {
      id: "trays", journal: "Glasshouse, Rain Gardens. Left rainfern tray: waterlogged, drain shut. Right tray: dry, its wick has slipped out of the reservoir. Fix both, in either order, at the marked planters.",
      objectives: [
        { id: "left-tray", kind: "choose", text: "Open the drain on the left rainfern tray, Glasshouse conservatory", dialogue: LEFT, options: ["drain-left"], target: DOOR },
        { id: "right-tray", kind: "choose", text: "Reseat the wick on the right rainfern tray, Glasshouse conservatory", dialogue: RIGHT, options: ["seat-wick"], target: DOOR },
      ],
      next: "night",
    },
    {
      id: "night", journal: "Both trays are fixed. Set the nursery lamp on the growing board (back counter) to the label's cycle: 16 hours light, 8 dark. The timer runs on its own once set.",
      objectives: [{ id: "night-cycle", kind: "choose", text: "Set the nursery lamp timer to 16 on / 8 off at the Glasshouse growing board", dialogue: BOARD, options: ["restore-cycle"], target: DOOR }],
      onComplete: [{ outcome: "rested" }],
    },
  ],
  outcomes: {
    rested: {
      title: "Room to Grow", journal: "Left tray draining, right tray drinking, nursery lamp back on 16/8. Neri's care log now reads ROOTS SETTLED. ONE SHIFT PAID.",
      effects: [{ credits: 60 }, { xp: 100 }, { rep: "civilian", by: 3 }, { setFlag: "glasshouse.nursery-tended" }],
    },
  },
};

const dialogues: readonly DialogueDefinition[] = [
  {
    id: BOARD, npc: GLASSHOUSE_STATIONS.board.id, quest: QUEST,
    entries: [
      { condition: available(QUEST), node: "offer" },
      { condition: inStage(QUEST, "trays"), node: "trays" },
      { condition: inStage(QUEST, "night"), node: "timer" },
      { condition: completed(QUEST), node: "receipt" },
    ],
    nodes: [
      node("offer", [
        "[A note under a stone, in Neri's square capitals: TENDING SHIFT. LEFT TRAY DROWNING. RIGHT TRAY THIRSTY. LAMP TIMER STUCK ON DAY. 60 CR + 100 XP. - N.]",
        "[Underneath, smaller: The nursery lamp runs off its own battery. Don't touch the big grow lights, Mira's people are on those.]",
      ], [
        { id: "accept-care", label: "Take the tending shift. (60 cr, 100 XP)", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "trays" },
        LEAVE,
      ]),
      node("trays", [
        "TO DO: LEFT TRAY - OPEN THE DRAIN. RIGHT TRAY - PUT THE WICK BACK IN THE RESERVOIR. Any order. Both planters are marked on the floor plan.",
        "THEN: lamp timer, here. Label says 16 HOURS LIGHT / 8 HOURS DARK.",
      ], [LEAVE]),
      node("timer", [
        "[Both tray tags are flipped to SETTLED. The nursery lamp timer reads DAY / DAY / DAY.]",
        "RAINFERN NURSERY: 16 H LIGHT / 8 H DARK. Ferns that never get a dark period stop putting out new fronds.",
      ], [
        { id: "restore-cycle", label: "Set 16 hours light, 8 hours dark. (60 cr, 100 XP)", condition: inStage(QUEST, "night"), kind: "complete", next: "receipt" },
        go("constant-light", "Leave the nursery lamp on all day and night.", "no-rest", { condition: inStage(QUEST, "night") }),
        go("constant-dark", "Switch the nursery lamp off permanently.", "no-morning", { condition: inStage(QUEST, "night") }),
        LEAVE,
      ]),
      node("no-rest", ["TIMER PREVIEW: 24 H LIGHT / 0 H DARK. Neri has written next to the dial: NO. THEY NEED THE DARK HOURS.", "Nothing was changed. The label wants 16 light, 8 dark."], [go("retry-timer", "Read the nursery schedule again.", "timer"), LEAVE]),
      node("no-morning", ["TIMER PREVIEW: 0 H LIGHT. A tray of seedlings with no light at all is a tray of compost by Friday.", "Nothing was changed. The label wants 16 light, 8 dark."], [go("retry-timer", "Read the nursery schedule again.", "timer"), LEAVE]),
      node("receipt", [
        "CARE LOG: LEFT DRAIN OPEN / RIGHT WICK SEATED / NURSERY TIMER 16-8. TIMER RUNNING.",
        "[Neri has initialled your line and drawn a small fern next to it.] ONE SHIFT PAID.",
      ], [LEAVE]),
    ],
  },
  {
    id: LEFT, npc: GLASSHOUSE_STATIONS.left.id, quest: QUEST,
    entries: [{ condition: leftPending, node: "wet" }, { condition: active(QUEST), node: "settled" }],
    nodes: [
      node("wet", [
        "[A centimetre of water sits on top of the left tray's soil. The drain tab underneath is shut. The fronds are going yellow at the base.]",
        "Tag, in pencil: ROOT ROT IF LEFT. OPEN THE DRAIN.",
      ], [
        { id: "drain-left", label: "Open the drain and let the excess run off.", condition: leftPending, next: "settled" },
        go("water-left", "Reach for the watering jug.", "too-wet", { condition: leftPending }),
        LEAVE,
      ]),
      node("too-wet", ["You lift the jug. The tag is right in front of you: STANDING WATER. MORE WATER WILL NOT HELP.", "Nothing was poured. The drain tab is under the lip of the tray."], [go("retry-left", "Look at the left tray again.", "wet"), LEAVE]),
      node("settled", ["LEFT TRAY SETTLED. Drain open. The water runs off into the catch channel and the soil surface shows again.", "Tag flipped. Check the right tray, then the growing board."], [LEAVE]),
    ],
  },
  {
    id: RIGHT, npc: GLASSHOUSE_STATIONS.right.id, quest: QUEST,
    entries: [{ condition: rightPending, node: "dry" }, { condition: active(QUEST), node: "settled" }],
    nodes: [
      node("dry", [
        "[The right tray's soil is pale and cracked. The reservoir underneath is full. Its cloth wick has slipped out and is hanging over the rim.]",
        "Tag: SEEDS SOWN THURSDAY. WICK-FED ONLY. DO NOT FLOOD. Neri has underlined FLOOD twice.",
      ], [
        { id: "seat-wick", label: "Push the wick back down between soil and reservoir.", condition: rightPending, next: "settled" },
        go("flood-right", "Tip the reservoir across the tray.", "too-fast", { condition: rightPending }),
        LEAVE,
      ]),
      node("too-fast", ["You tilt the reservoir and stop. Thursday's seeds are sitting loose on top; a flood would wash them into one corner.", "Nothing was tipped. The wick is the grey cloth strip hanging off the rim."], [go("retry-right", "Look at the right tray again.", "dry"), LEAVE]),
      node("settled", ["RIGHT TRAY SETTLED. The wick is back in the reservoir. A dark damp line is already creeping up into the soil.", "Tag flipped. Once both trays are done, the lamp timer is on the back counter."], [LEAVE]),
    ],
  },
];

export const GLASSHOUSE_PACK: ContentPack = {
  id: "glasshouse",
  quests: [quest],
  dialogues,
  interactables: Object.values(GLASSHOUSE_STATIONS),
};
