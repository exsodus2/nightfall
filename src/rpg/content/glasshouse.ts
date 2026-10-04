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
  summary: "Two rainfern trays need different kinds of care. Settle their roots, then give the Glasshouse nursery lamp its night back.",
  rewardHint: "60 cr, 100 XP, neighborhood reputation", recommendedLevel: 1, start: "trays",
  stages: [
    {
      id: "trays", journal: "Neri's two rainfern trays need attention. Left: standing water, so open the drain. Right: dry soil above a full reservoir, so reseat the loose wick. Use the marked planters in either order; reading alone changes nothing.",
      objectives: [
        { id: "left-tray", kind: "choose", text: "Drain the waterlogged left tray", dialogue: LEFT, options: ["drain-left"], target: DOOR },
        { id: "right-tray", kind: "choose", text: "Reseat the dry right tray's wick", dialogue: RIGHT, options: ["seat-wick"], target: DOOR },
      ],
      next: "night",
    },
    {
      id: "night", journal: "Both trays are settled. Return to the growing board on the back counter. The rainfern nursery label calls for sixteen hours of soft light and eight hours of darkness. Restore that timer cycle; no waiting is required.",
      objectives: [{ id: "night-cycle", kind: "choose", text: "Restore the nursery lamp's day-and-night cycle", dialogue: BOARD, options: ["restore-cycle"], target: DOOR }],
      onComplete: [{ outcome: "rested" }],
    },
  ],
  outcomes: {
    rested: {
      title: "Room to Grow", journal: "The left tray can drain, the right tray can drink, and the battery nursery lamp has its night cycle back. Neri marked the care log: ROOTS SETTLED. ONE SHIFT PAID. The main grow-light repairs are a separate job.",
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
        "[Neri's note is weighted with a smooth stone. 'The city counts towers. We count new leaves. Two rainfern trays could use a kind pair of hands.']",
        "Left planter: too much water. Right planter: a loose drinking wick. Then reset this nursery lamp's timer. It has its own battery; the main grow-light repair is another job. One tending shift: 60 cr and 100 XP.",
      ], [
        { id: "accept-care", label: "Take a quiet tending shift.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "trays" },
        LEAVE,
      ]),
      node("trays", [
        "Left tray: open the drain. Right tray: reseat the wick. Either order. The little squares on the floor plan mark both planters.",
        "Then come back here. The nursery label says SIXTEEN HOURS SOFT LIGHT / EIGHT HOURS DARK. 'Even this city should let something sleep.'",
      ], [LEAVE]),
      node("timer", [
        "[Both tray tags are turned to SETTLED. The battery nursery lamp's timer is stuck on DAY.]",
        "RAINFERN NURSERY: 16 HOURS SOFT LIGHT / 8 HOURS DARK. Program the cycle, not the city clock. The night crew will take over from here.",
      ], [
        { id: "restore-cycle", label: "Restore sixteen soft hours, then eight dark. (60 cr, 100 XP)", condition: inStage(QUEST, "night"), kind: "complete", next: "receipt" },
        go("constant-light", "Leave the nursery lamp on all day and night.", "no-rest", { condition: inStage(QUEST, "night") }),
        go("constant-dark", "Switch the nursery lamp off permanently.", "no-morning", { condition: inStage(QUEST, "night") }),
        LEAVE,
      ]),
      node("no-rest", ["The timer preview shows no dark interval. Neri has drawn a tiny bed beside the eight-hour mark. 'Growing is work too.'", "Nothing was changed. Give this nursery a night as well as a day."], [go("retry-timer", "Read the nursery schedule again.", "timer"), LEAVE]),
      node("no-morning", ["The timer preview shows no next morning. Neri's note asks for a rest, not a farewell.", "Nothing was changed. Restore both halves of the nursery schedule."], [go("retry-timer", "Read the nursery schedule again.", "timer"), LEAVE]),
      node("receipt", [
        "CARE LOG: LEFT DRAIN OPEN / RIGHT WICK SEATED / NURSERY CYCLE RESTORED. The timer is programmed; you do not need to wait here.",
        "Neri leaves a clean space beside your mark. 'For the next pair of hands. Thank you for being gentle.' ONE SHIFT PAID. This log stays here; it is not another claim ticket.",
      ], [LEAVE]),
    ],
  },
  {
    id: LEFT, npc: GLASSHOUSE_STATIONS.left.id, quest: QUEST,
    entries: [{ condition: leftPending, node: "wet" }, { condition: active(QUEST), node: "settled" }],
    nodes: [
      node("wet", [
        "[Water stands above the left tray's dark soil. Its drain tab is closed. A rainfern tag reads: LET THE ROOTS BREATHE.]",
        "Neri's penciled arrow points to the drain, not the jug. This tray already had all the weather it needed.",
      ], [
        { id: "drain-left", label: "Open the drain and let the excess run off.", condition: leftPending, next: "settled" },
        go("water-left", "Reach for the watering jug.", "too-wet", { condition: leftPending }),
        LEAVE,
      ]),
      node("too-wet", ["The tag stops you before you pour: STANDING WATER. A second drink will not fix a closed drain.", "Nothing was poured. Try giving the roots some air."], [go("retry-left", "Look at the left tray again.", "wet"), LEAVE]),
      node("settled", ["LEFT TRAY SETTLED. The drain is open; the extra water is back in the catch channel, not around the roots.", "Leave the tag turned over. The other tray and the growing board will show what still needs doing."], [LEAVE]),
    ],
  },
  {
    id: RIGHT, npc: GLASSHOUSE_STATIONS.right.id, quest: QUEST,
    entries: [{ condition: rightPending, node: "dry" }, { condition: active(QUEST), node: "settled" }],
    nodes: [
      node("dry", [
        "[The right tray is pale and dry, but the reservoir below it is full. Its cloth wick has slipped out and curled over the rim.]",
        "A note says: SEAT THE WICK. LET THE TRAY SIP. Neri has crossed out the word FLOOD twice.",
      ], [
        { id: "seat-wick", label: "Seat the loose wick between soil and reservoir.", condition: rightPending, next: "settled" },
        go("flood-right", "Tip the reservoir across the tray.", "too-fast", { condition: rightPending }),
        LEAVE,
      ]),
      node("too-fast", ["You pause at the penciled warning: the tiny seeds would wash to one corner. 'A drink, not a bath.'", "Nothing was tipped. Reconnect the cloth wick instead."], [go("retry-right", "Look at the right tray again.", "dry"), LEAVE]),
      node("settled", ["RIGHT TRAY SETTLED. The wick reaches the reservoir again. The tray can take its water slowly.", "Leave the tag turned over. Once both trays are settled, the lamp timer is on the back counter."], [LEAVE]),
    ],
  },
];

export const GLASSHOUSE_PACK: ContentPack = {
  id: "glasshouse",
  quests: [quest],
  dialogues,
  interactables: Object.values(GLASSHOUSE_STATIONS),
};
