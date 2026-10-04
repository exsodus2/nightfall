import type { Condition, ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { LEAVE, active, available, ending, go, inStage, node } from "./helpers.ts";

const QUEST = "the-space-between";
const COUNTER = "undertone.counter", BOOTH = "undertone.booth", ARCHIVE = "undertone.archive";
const DOOR = { x: 45, z: -248.54 };
const rail: Condition = { flag: `${QUEST}.record`, is: "rail-return" };
const rain: Condition = { flag: `${QUEST}.record`, is: "rain-on-tin" };
const railPattern = "ONE HIT / TWO REST / THREE HIT / FOUR REST";
const rainPattern = "ONE REST / TWO HIT / THREE REST / FOUR HIT";

export const UNDERTONE_STATIONS: Readonly<Record<"counter" | "booth" | "archive", InteractableDefinition>> = {
  counter: { id: "undertone-counter", label: "Read Undertone's last-set book", place: "undertone", x: 45, z: -231.89, y: 2.2, glyph: ">", dialogue: COUNTER },
  booth: { id: "undertone-listening-note", label: "Read the listening table's request", place: "undertone", x: 51.8, z: -238.7, y: 2.2, glyph: "+", condition: active(QUEST), dialogue: BOOTH },
  archive: { id: "undertone-sleeve-archive", label: "Compare the quiet record sleeves", place: "undertone", x: 52.6, z: -232.31, y: 2.4, glyph: "=", condition: active(QUEST), dialogue: ARCHIVE },
};

const quest: QuestDefinition2 = {
  id: QUEST, title: "The Space Between", category: "gig", giver: null,
  summary: "Plan Undertone's last listening set on silent cue cards. Read the room's request, choose a quiet pattern, and leave its rests intact.",
  rewardHint: "75 cr, 100 XP, neighborhood reputation; either quiet side pays equally", recommendedLevel: 1, start: "listen",
  stages: [
    {
      id: "listen", journal: "Read and explicitly confirm the request at the left listening table. This is a silent four-slot cue-card exercise: no sound, rhythm timing or waiting is required.",
      objectives: [{ id: "request", kind: "choose", text: "Confirm the listening table's request", dialogue: BOOTH, options: ["confirm-request"], target: DOOR }],
      next: "sleeves",
    },
    {
      id: "sleeves", journal: "The room wants two hits and two rests in each four-slot pattern. At the left archive shelf, choose Rail Return (hits one and three) or Rain on Tin (hits two and four). Both fit and pay equally; Turnstile Rush leaves no rests.",
      objectives: [{ id: "record", kind: "choose", text: "Choose either quiet side at the sleeve archive", dialogue: ARCHIVE, options: ["rail-return", "rain-on-tin"], target: DOOR }],
      next: "program",
    },
    {
      id: "program", journal: "Your chosen side is recorded. Return to the back counter and queue its cue card with both REST slots left empty. Do not auto-fill the silence. Queuing this card does not start audio or change your radio.",
      objectives: [{ id: "last-set", kind: "choose", text: "Queue the chosen side without filling its rests", dialogue: COUNTER, options: ["keep-rests"], target: DOOR }],
      next: [{ if: rail, stage: "rail" }, { stage: "rain" }],
    },
    ending("rail", "A steady return, with space between the steps.", "rail"),
    ending("rain", "An offbeat walk, with room for the rain.", "rain"),
  ],
  outcomes: {
    rail: {
      title: "Homebound", journal: `Rail Return is on the last-set card: ${railPattern}. Two rests kept. One set paid. Undertone leaves the room a little quieter than the street.`,
      effects: [{ credits: 75 }, { xp: 100 }, { rep: "civilian", by: 3 }, { setFlag: "undertone.last-set", value: "rail-return" }],
    },
    rain: {
      title: "Offbeat Footsteps", journal: `Rain on Tin is on the last-set card: ${rainPattern}. Two rests kept. One set paid. Undertone leaves the room a little quieter than the street.`,
      effects: [{ credits: 75 }, { xp: 100 }, { rep: "civilian", by: 3 }, { setFlag: "undertone.last-set", value: "rain-on-tin" }],
    },
  },
};

const dialogues: readonly DialogueDefinition[] = [
  {
    id: COUNTER, npc: UNDERTONE_STATIONS.counter.id, quest: QUEST,
    entries: [
      { condition: available(QUEST), node: "offer" },
      { condition: inStage(QUEST, "listen"), node: "listen" },
      { condition: inStage(QUEST, "sleeves"), node: "archive" },
      { condition: { all: [inStage(QUEST, "program"), rail] }, node: "program-rail" },
      { condition: { all: [inStage(QUEST, "program"), rain] }, node: "program-rain" },
      { condition: { quest: QUEST, outcome: "rail" }, node: "receipt-rail" },
      { condition: { quest: QUEST, outcome: "rain" }, node: "receipt-rain" },
    ],
    nodes: [
      node("offer", [
        "[The last-set book has a note for the night crew: 'The signs outside do enough shouting. Leave two spaces for the rain.']",
        "Plan a side on silent cue cards. Read the left listening table's request, compare the left archive's sleeves, then queue it here. No headphones, stopwatch or music quiz. Either quiet mood earns the same pay.",
      ], [{ id: "accept-set", label: "Plan the last listening set.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "listen" }, LEAVE]),
      node("listen", ["The request card is on the left listening table, nearer the door. Use its Confirm option; reading alone does not log it.", "Four slots. Two breaths. Let the room tell you what it needs."], [LEAVE]),
      node("archive", ["Two hits, two rests. Compare the sleeves on the back-left shelf.", "Rail Return and Rain on Tin both fit. Choose the mood you like; neither pays more."], [LEAVE]),
      node("program-rail", [`CHOSEN SIDE: RAIL RETURN. ${railPattern}.`, "The quiet slots belong to the pattern. Queue the card for the last set; this does not start playback or change your radio."], [
        { id: "keep-rests", label: "Queue Rail Return with both rests intact. (75 cr, 100 XP)", condition: inStage(QUEST, "program"), kind: "complete", next: "receipt-rail" },
        go("fill-rests", "Auto-fill the quiet slots with extra hits.", "no-space", { condition: inStage(QUEST, "program") }), LEAVE,
      ]),
      node("program-rain", [`CHOSEN SIDE: RAIN ON TIN. ${rainPattern}.`, "The quiet slots belong to the pattern. Queue the card for the last set; this does not start playback or change your radio."], [
        { id: "keep-rests", label: "Queue Rain on Tin with both rests intact. (75 cr, 100 XP)", condition: inStage(QUEST, "program"), kind: "complete", next: "receipt-rain" },
        go("fill-rests", "Auto-fill the quiet slots with extra hits.", "no-space", { condition: inStage(QUEST, "program") }), LEAVE,
      ]),
      node("no-space", ["The preview fills all four slots. That leaves no space for the room's two rests.", "Nothing was queued. Silence is part of the side, not a fault to repair."], [
        go("retry-rail", "Return to Rail Return's cue card.", "program-rail", { condition: rail, hideIfUnavailable: true }),
        go("retry-rain", "Return to Rain on Tin's cue card.", "program-rain", { condition: rain, hideIfUnavailable: true }), LEAVE,
      ]),
      node("receipt-rail", [`LAST-SET CARD: RAIL RETURN. ${railPattern}. TWO RESTS KEPT.`, "QUEUED. ONE SET PAID. 'For everyone going home at a different speed.' This card stays in the book; it is not another claim ticket. Your radio is unchanged."], [LEAVE]),
      node("receipt-rain", [`LAST-SET CARD: RAIN ON TIN. ${rainPattern}. TWO RESTS KEPT.`, "QUEUED. ONE SET PAID. 'For everyone taking the long way home.' This card stays in the book; it is not another claim ticket. Your radio is unchanged."], [LEAVE]),
    ],
  },
  {
    id: BOOTH, npc: UNDERTONE_STATIONS.booth.id, quest: QUEST,
    entries: [{ condition: inStage(QUEST, "listen"), node: "request" }, { condition: active(QUEST), node: "logged" }],
    nodes: [
      node("request", [
        "[A cup holds down a four-slot card. Under ONE / TWO / THREE / FOUR someone has written: TWO HITS. TWO RESTS.]",
        "HIT means a mark in that slot. REST means leave it quiet. The hits may land on one and three, or two and four. Both moods are welcome. Read at your own pace; there is nothing to hear or time.",
      ], [{ id: "confirm-request", label: "Confirm: two hits, two rests; either quiet mood.", condition: inStage(QUEST, "listen"), next: "logged" }, LEAVE]),
      node("logged", ["REQUEST LOGGED: TWO HITS / TWO RESTS. One-and-three or two-and-four both fit.", "The back-left archive shelf holds the sleeves. The counter keeps the finished set card."], [LEAVE]),
    ],
  },
  {
    id: ARCHIVE, npc: UNDERTONE_STATIONS.archive.id, quest: QUEST,
    entries: [
      { condition: inStage(QUEST, "listen"), node: "listen-first" },
      { condition: inStage(QUEST, "sleeves"), node: "compare" },
      { condition: { all: [inStage(QUEST, "program"), rail] }, node: "rail-selected" },
      { condition: { all: [inStage(QUEST, "program"), rain] }, node: "rain-selected" },
    ],
    nodes: [
      node("listen-first", ["Three sleeves wait: Rail Return, Rain on Tin, Turnstile Rush.", "Confirm the request at the left listening table first. Picking a record is easier when you know who the quiet is for."], [LEAVE]),
      node("compare", [`RAIL RETURN: ${railPattern}. Homebound and steady.`, `RAIN ON TIN: ${rainPattern}. Footsteps between the signs.`, "TURNSTILE RUSH: HIT / HIT / HIT / HIT. No rests. Choose either quiet side; the pay is equal."], [
        { id: "rail-return", label: "Choose Rail Return: hits one and three, two rests.", condition: inStage(QUEST, "sleeves"), next: "rail-selected" },
        { id: "rain-on-tin", label: "Choose Rain on Tin: hits two and four, two rests.", condition: inStage(QUEST, "sleeves"), next: "rain-selected" },
        go("busy-record", "Choose Turnstile Rush: a hit in every slot.", "too-full", { condition: inStage(QUEST, "sleeves") }), LEAVE,
      ]),
      node("too-full", ["Four hits leave zero rests. Turnstile Rush belongs to a busier room tonight.", "Nothing was selected. Compare the two sleeves that leave the quiet slots intact."], [go("retry-sleeves", "Compare the quiet sides again.", "compare"), LEAVE]),
      node("rail-selected", [`SIDE CHOSEN: RAIL RETURN. ${railPattern}.`, "The selection is recorded, not playing. Return to the back counter and preserve both rests on its cue card."], [LEAVE]),
      node("rain-selected", [`SIDE CHOSEN: RAIN ON TIN. ${rainPattern}.`, "The selection is recorded, not playing. Return to the back counter and preserve both rests on its cue card."], [LEAVE]),
    ],
  },
];

export const UNDERTONE_PACK: ContentPack = { id: "undertone", quests: [quest], dialogues, interactables: Object.values(UNDERTONE_STATIONS) };
