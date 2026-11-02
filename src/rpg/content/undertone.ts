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
  booth: { id: "undertone-listening-note", label: "Read the regulars' request card", place: "undertone", x: 51.8, z: -238.7, y: 2.2, glyph: "+", condition: active(QUEST), dialogue: BOOTH },
  archive: { id: "undertone-sleeve-archive", label: "Flip through the record sleeves", place: "undertone", x: 52.6, z: -232.31, y: 2.4, glyph: "=", condition: active(QUEST), dialogue: ARCHIVE },
};

const quest: QuestDefinition2 = {
  id: QUEST, title: "The Space Between", category: "gig", giver: null,
  summary: "Undertone's closing DJ is off sick. Fill in the last-set cue card: read the regulars' request, pick a record that fits it, and queue it at the counter.",
  rewardHint: "75 cr, 100 XP, Civilian reputation; either quiet side pays the same", recommendedLevel: 1, start: "listen",
  stages: [
    {
      id: "listen", journal: "Undertone, the listening bar in Neon Ward: Oto, the closing DJ, is off sick, so somebody has to fill in tonight's last-set card. The regulars left a request card on the left listening table, near the door. Read it and confirm it. Everything here is done on paper cue cards.",
      objectives: [{ id: "request", kind: "choose", text: "Confirm the request card on Undertone's left listening table", dialogue: BOOTH, options: ["confirm-request"], target: DOOR }],
      next: "sleeves",
    },
    {
      id: "sleeves", journal: "The request: two hits and two rests per four-beat bar. On the back-left archive shelf, Rail Return (hits on one and three) and Rain on Tin (two and four) both fit and pay the same. Turnstile Rush has no rests.",
      objectives: [{ id: "record", kind: "choose", text: "Pick Rail Return or Rain on Tin at Undertone's sleeve archive", dialogue: ARCHIVE, options: ["rail-return", "rain-on-tin"], target: DOOR }],
      next: "program",
    },
    {
      id: "program", journal: "Record picked. Queue its cue card at the back counter with both REST slots left empty. The house plays the card at closing; nothing plays now.",
      objectives: [{ id: "last-set", kind: "choose", text: "Queue the card at Undertone's back counter, rests left empty", dialogue: COUNTER, options: ["keep-rests"], target: DOOR }],
      next: [{ if: rail, stage: "rail" }, { stage: "rain" }],
    },
    ending("rail", "Rail Return is queued for closing.", "rail"),
    ending("rain", "Rain on Tin is queued for closing.", "rain"),
  ],
  outcomes: {
    rail: {
      title: "Homebound", journal: `Rail Return is on the last-set card: ${railPattern}. Both rests kept, one set paid. The regulars get their slow walk to the last train.`,
      effects: [{ credits: 75 }, { xp: 100 }, { rep: "civilian", by: 3 }, { setFlag: "undertone.last-set", value: "rail-return" }],
    },
    rain: {
      title: "Offbeat Footsteps", journal: `Rain on Tin is on the last-set card: ${rainPattern}. Both rests kept, one set paid. The regulars get the offbeat one they always ask for.`,
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
        "[The last-set book, open at tonight. A note from Oto, the closing DJ: OFF SICK. SOMEONE DO THE LAST CARD. THE REGULARS LEFT A REQUEST ON THE TABLE.]",
        "LAST-SET CARD: 4 SLOTS. Request card on the left table, records on the back-left shelf, card goes in this book. PAY: 75 CR, EITHER RECORD.",
      ], [{ id: "accept-set", label: "Fill in tonight's last-set card.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "listen" }, LEAVE]),
      node("listen", ["LAST-SET CARD: BLANK. REQUEST CARD NOT CONFIRMED.", "The request card is on the left listening table, nearer the door."], [LEAVE]),
      node("archive", ["REQUEST: TWO HITS / TWO RESTS. RECORD: NOT CHOSEN.", "Rail Return and Rain on Tin both fit. Oto's margin note: 'Either. They argue about it every night anyway.'"], [LEAVE]),
      node("program-rail", [`CHOSEN SIDE: RAIL RETURN. ${railPattern}.`, "Two slots marked REST. Leave them empty. The house plays this card at closing."], [
        { id: "keep-rests", label: "Queue Rail Return with both rests intact. (75 cr, 100 XP)", condition: inStage(QUEST, "program"), kind: "complete", next: "receipt-rail" },
        go("fill-rests", "Auto-fill the quiet slots with extra hits.", "no-space", { condition: inStage(QUEST, "program") }), LEAVE,
      ]),
      node("program-rain", [`CHOSEN SIDE: RAIN ON TIN. ${rainPattern}.`, "Two slots marked REST. Leave them empty. The house plays this card at closing."], [
        { id: "keep-rests", label: "Queue Rain on Tin with both rests intact. (75 cr, 100 XP)", condition: inStage(QUEST, "program"), kind: "complete", next: "receipt-rain" },
        go("fill-rests", "Auto-fill the quiet slots with extra hits.", "no-space", { condition: inStage(QUEST, "program") }), LEAVE,
      ]),
      node("no-space", ["AUTO-FILL PREVIEW: HIT / HIT / HIT / HIT. The request card asked for two rests.", "Nothing was queued. The card still has its two empty REST slots."], [
        go("retry-rail", "Return to Rail Return's cue card.", "program-rail", { condition: rail, hideIfUnavailable: true }),
        go("retry-rain", "Return to Rain on Tin's cue card.", "program-rain", { condition: rain, hideIfUnavailable: true }), LEAVE,
      ]),
      node("receipt-rail", [`LAST-SET CARD: RAIL RETURN. ${railPattern}. TWO RESTS KEPT.`, "QUEUED FOR CLOSING. ONE SET PAID. [Oto will find your initials in the book tomorrow.]"], [LEAVE]),
      node("receipt-rain", [`LAST-SET CARD: RAIN ON TIN. ${rainPattern}. TWO RESTS KEPT.`, "QUEUED FOR CLOSING. ONE SET PAID. [Oto will find your initials in the book tomorrow.]"], [LEAVE]),
    ],
  },
  {
    id: BOOTH, npc: UNDERTONE_STATIONS.booth.id, quest: QUEST,
    entries: [{ condition: inStage(QUEST, "listen"), node: "request" }, { condition: active(QUEST), node: "logged" }],
    nodes: [
      node("request", [
        "[A coffee cup holds down a four-slot card. Under ONE / TWO / THREE / FOUR, three different handwritings agree: TWO HITS. TWO RESTS.]",
        "HIT: a beat in that slot. REST: leave it empty. One regular has written 'ONE AND THREE'. Another has crossed it out and written 'TWO AND FOUR'.",
      ], [{ id: "confirm-request", label: "Confirm: two hits, two rests; either quiet mood.", condition: inStage(QUEST, "listen"), next: "logged" }, LEAVE]),
      node("logged", ["REQUEST LOGGED: TWO HITS / TWO RESTS. One-and-three or two-and-four both fit.", "Records: back-left archive shelf. Last-set book: back counter."], [LEAVE]),
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
      node("listen-first", ["Three sleeves face out: Rail Return, Rain on Tin, Turnstile Rush.", "Confirm the request at the left listening table first; the card says what the regulars want."], [LEAVE]),
      node("compare", [`RAIL RETURN: ${railPattern}. Slow, even, a last-train record.`, `RAIN ON TIN: ${rainPattern}. Offbeat, brushed snare, the regulars' favourite argument.`, "TURNSTILE RUSH: HIT / HIT / HIT / HIT. No rests. Sleeve sticker: PEAK HOURS ONLY."], [
        { id: "rail-return", label: "Choose Rail Return: hits one and three, two rests.", condition: inStage(QUEST, "sleeves"), next: "rail-selected" },
        { id: "rain-on-tin", label: "Choose Rain on Tin: hits two and four, two rests.", condition: inStage(QUEST, "sleeves"), next: "rain-selected" },
        go("busy-record", "Choose Turnstile Rush: a hit in every slot.", "too-full", { condition: inStage(QUEST, "sleeves") }), LEAVE,
      ]),
      node("too-full", ["Four hits, zero rests. The request card asked for two of each.", "Nothing was selected. Rail Return and Rain on Tin both have two rests."], [go("retry-sleeves", "Compare the quiet sides again.", "compare"), LEAVE]),
      node("rail-selected", [`SIDE CHOSEN: RAIL RETURN. ${railPattern}.`, "Sleeve pulled. Write it on the cue card at the back counter, rests left empty."], [LEAVE]),
      node("rain-selected", [`SIDE CHOSEN: RAIN ON TIN. ${rainPattern}.`, "Sleeve pulled. Write it on the cue card at the back counter, rests left empty."], [LEAVE]),
    ],
  },
];

export const UNDERTONE_PACK: ContentPack = { id: "undertone", quests: [quest], dialogues, interactables: Object.values(UNDERTONE_STATIONS) };
