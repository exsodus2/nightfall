import type { ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { LEAVE, active, available, ending, go, inStage, node } from "./helpers.ts";

const QUEST = "last-good-signal";
const COUNTER = "dead-letter.counter", ARCHIVE = "dead-letter.archive", RELAY = "dead-letter.relay";
const LEDGER = "dead-letter.ledger", SPOOL = "dead-letter.spool";
const DOOR = { x: 429, z: -247.48 };

export const DEAD_LETTER_STATIONS: Readonly<Record<"counter" | "archive" | "relay", InteractableDefinition>> = {
  counter: { id: "dead-letter-counter", label: "Use the Dead Letter public desk", place: "dead-letter", x: 429, z: -232.95, y: 2.2, glyph: ">", dialogue: COUNTER },
  archive: { id: "dead-letter-archive", label: "Check the sender ledger", place: "dead-letter", x: 435.85, z: -233.17, y: 2.4, glyph: "=", condition: active(QUEST), dialogue: ARCHIVE },
  relay: { id: "dead-letter-relay", label: "Use the relay machine", place: "dead-letter", x: 422.95, z: -238.7, y: 2.4, glyph: ">", condition: active(QUEST), dialogue: RELAY },
};

const quest: QuestDefinition2 = {
  id: QUEST, title: "Last Good Signal", category: "gig", giver: null,
  summary: "Three flood notices for the Glasshouse gates reached Dead Letter Exchange out of order, and one of them is a fake. Work out which is current and post it.",
  rewardHint: "90-130 cr, 150 XP, Civilian reputation", recommendedLevel: 1, start: "evidence",
  stages: [
    {
      id: "evidence", journal: "Dead Letter Exchange in the Ghost Circuit holds three flood notices for the Glasshouse gates, and one is fake. Before the public desk posts anything it wants evidence on file. Log the sender ledger on the left archive shelf and record the arrival spool on the right-hand relay machine (use each screen's Log / Record option).",
      objectives: [
        { id: "sender-ledger", kind: "condition", text: "Log the sender ledger (left archive shelf, Dead Letter)", condition: { flag: LEDGER }, target: DOOR },
        { id: "arrival-spool", kind: "condition", text: "Record the arrival spool (right-hand relay, Dead Letter)", condition: { flag: SPOOL }, target: DOOR },
      ],
      next: "verify",
    },
    {
      id: "verify", journal: "MOSS-7 is the Glasshouse's real key. 041 (signed): both gates shut. 042 (signed): east gate open. 043 (no key): all clear. Pick the current signed notice at the relay.",
      objectives: [{ id: "verified-notice", kind: "choose", text: "Pick the current signed notice at the relay", dialogue: RELAY, options: ["select-042"], target: DOOR }],
      next: "route",
    },
    {
      id: "route", journal: "042 is current: EAST GATE OPEN / WEST APPROACH FLOODED. It only concerns the Glasshouse in the Rain Gardens, so it goes on that venue's board.",
      objectives: [{ id: "venue-route", kind: "choose", text: "Route notice 042 to the Glasshouse board at the relay", dialogue: RELAY, options: ["route-glasshouse"], target: DOOR }],
      next: "publish",
    },
    {
      id: "publish", journal: "042 is queued for the Glasshouse board. At the public desk, post it with no sender name, or with the GLASSHOUSE DESK callback Neri agreed to. Her home number stays off it.",
      objectives: [{ id: "publication", kind: "choose", text: "Post notice 042 from the public desk (back counter)", dialogue: COUNTER, options: ["publish-anonymous", "publish-callback"], target: DOOR }],
      next: [{ if: { flag: `${QUEST}.publication`, is: "publish-anonymous" }, stage: "anonymous" }, { stage: "callback" }],
    },
    ending("anonymous", "042 posted with no sender name.", "anonymous"),
    ending("callback", "042 posted with the Glasshouse desk callback.", "callback"),
  ],
  outcomes: {
    anonymous: {
      title: "Let the Notice Speak", journal: "Glasshouse 042 is up with no name on it: east gate open, west approach flooded. Nobody walks into the west approach on the strength of a forged all-clear. Neri's home line stayed sealed.",
      effects: [{ credits: 90 }, { xp: 150 }, { rep: "civilian", by: 6 }, { rep: "ghosts", by: 3 }, { setFlag: "dead-letter.publication", value: "anonymous" }],
    },
    callback: {
      title: "Someone to Answer", journal: "Glasshouse 042 is up with the GLASSHOUSE DESK callback, so people can phone in when the water moves. Staffed callbacks pay a dispatch supplement. Neri's home line stayed sealed.",
      effects: [{ credits: 130 }, { xp: 150 }, { rep: "civilian", by: 4 }, { setFlag: "dead-letter.publication", value: "callback" }],
    },
  },
};

const ledgerLines = [
  "SENDER LEDGER: KEY MOSS-7 / NERI / GLASSHOUSE NIGHT DESK, RAIN GARDENS. Anything not signed MOSS-7 did not come from the Glasshouse.",
  "CONSENT ON FILE: 'Publish GLASSHOUSE DESK for callbacks. Do not publish my home line.' - Neri",
];
const spoolLines = [
  "ARRIVAL SPOOL: 1st 041 / MOSS-7 / BOTH GATES SHUT. 2nd 043 / NO KEY / ALL GATES CLEAR.",
  "3rd 042 / MOSS-7 / EAST GATE OPEN. WEST APPROACH STILL FLOODED. Relay note: lines lag. Current = highest signed revision.",
];
const noticeLines = ["GLASSHOUSE 042: EAST GATE OPEN / WEST APPROACH FLOODED."];

const dialogues: readonly DialogueDefinition[] = [
  {
    id: COUNTER, npc: DEAD_LETTER_STATIONS.counter.id, quest: QUEST,
    entries: [
      { condition: available(QUEST), node: "offer" },
      { condition: inStage(QUEST, "evidence"), node: "collect" },
      { condition: { any: [inStage(QUEST, "verify"), inStage(QUEST, "route")] }, node: "relay-reminder" },
      { condition: inStage(QUEST, "publish"), node: "publish" },
      { condition: { quest: QUEST, outcome: "anonymous" }, node: "receipt-anonymous" },
      { condition: { quest: QUEST, outcome: "callback" }, node: "receipt-callback" },
    ],
    nodes: [
      node("offer", [
        "PUBLIC DESK: 3 NOTICES HELD / SUBJECT: GLASSHOUSE GATES / 1 UNSIGNED. VOLUNTEER WANTED TO VERIFY AND POST.",
        "PROCEDURE: 1. Log sender ledger (left shelf). 2. Record arrival spool (right relay). 3. Pick and route the current notice. 4. Post it here. PAY: 90 CR, 130 WITH A STAFFED CALLBACK.",
      ], [
        { id: "accept-signal", label: "Take the public bulletin job.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "collect" },
        LEAVE,
      ]),
      node("collect", ["EVIDENCE ON FILE: INCOMPLETE.", "Left archive shelf: sender ledger. Right-hand relay: arrival spool. Use each screen's Log or Record option."], [LEAVE]),
      node("relay-reminder", ["NOTHING QUEUED. The right-hand relay is waiting for you to pick the current notice and its board."], [LEAVE]),
      node("publish", [...noticeLines,
        "FORMAT A: no sender name. FORMAT B: GLASSHOUSE DESK callback (consent on file), people can phone in updates, pays a staffing supplement. Neither prints a home line.",
      ], [
        { id: "publish-anonymous", label: "Send without a sender name. (90 cr, 150 XP)", condition: inStage(QUEST, "publish"), kind: "complete", next: "receipt-anonymous" },
        { id: "publish-callback", label: "Include the consented desk callback. (130 cr, 150 XP)", condition: inStage(QUEST, "publish"), kind: "complete", next: "receipt-callback" },
        go("publish-home", "Add the sealed home callback instead.", "consent-refusal", { condition: inStage(QUEST, "publish") }),
        LEAVE,
      ]),
      node("consent-refusal", ["PRIVACY INTERLOCK. CONSENT ON FILE COVERS GLASSHOUSE DESK ONLY. Nothing was sent.", "Post it with no name, or with the desk callback."], [go("retry-publication", "Choose a permitted format.", "publish"), LEAVE]),
      node("receipt-anonymous", [...noticeLines, "SENT RECEIPT: SENDER WITHHELD / NO CALLBACK / Home line sealed. JOB CLOSED, PAID ONCE. Copy kept on this desk."], [LEAVE]),
      node("receipt-callback", [...noticeLines, "SENT RECEIPT: CALLBACK GLASSHOUSE DESK (CONSENTED) / Home line sealed. JOB CLOSED, PAID ONCE. Copy kept on this desk."], [LEAVE]),
    ],
  },
  {
    id: ARCHIVE, npc: DEAD_LETTER_STATIONS.archive.id, quest: QUEST,
    entries: [
      { condition: { all: [inStage(QUEST, "evidence"), { not: { flag: LEDGER } }] }, node: "ledger" },
      { condition: active(QUEST), node: "ledger-recorded" },
    ],
    nodes: [
      node("ledger", ledgerLines, [
        { id: "confirm-ledger", label: "Log MOSS-7 and the callback consent.", condition: { all: [inStage(QUEST, "evidence"), { not: { flag: LEDGER } }] }, effects: [{ setFlag: LEDGER }], next: "ledger-recorded" },
        LEAVE,
      ]),
      node("ledger-recorded", [...ledgerLines, "LEDGER LOGGED. Key MOSS-7 sent to the right-hand relay for comparison."], [LEAVE]),
    ],
  },
  {
    id: RELAY, npc: DEAD_LETTER_STATIONS.relay.id, quest: QUEST,
    entries: [
      { condition: { all: [inStage(QUEST, "evidence"), { not: { flag: SPOOL } }] }, node: "spool" },
      { condition: inStage(QUEST, "evidence"), node: "spool-recorded" },
      { condition: inStage(QUEST, "verify"), node: "verify" },
      { condition: inStage(QUEST, "route"), node: "route" },
      { condition: inStage(QUEST, "publish"), node: "queued" },
    ],
    nodes: [
      node("spool", spoolLines, [
        { id: "confirm-spool", label: "Record all three notices in the journal.", condition: { all: [inStage(QUEST, "evidence"), { not: { flag: SPOOL } }] }, effects: [{ setFlag: SPOOL }], next: "spool-recorded" },
        LEAVE,
      ]),
      node("spool-recorded", [...spoolLines, "SPOOL RECORDED. Log the sender ledger on the left shelf too, then come back here to pick a notice."], [LEAVE]),
      node("verify", [...spoolLines, "KEY ON FILE: MOSS-7. SELECT CURRENT NOTICE:"], [
        go("select-041", "Use signed 041: both gates shut.", "stale", { condition: inStage(QUEST, "verify") }),
        { id: "select-042", label: "Use signed 042: east open, west flooded.", condition: inStage(QUEST, "verify"), next: "route" },
        go("select-043", "Use unsigned 043: all gates clear.", "unsigned", { condition: inStage(QUEST, "verify") }),
        LEAVE,
      ]),
      node("stale", ["REJECTED: 041 is signed, but signed 042 supersedes it. It arrived first because the east line was slow.", "No bulletin sent. Queue unchanged."], [go("retry-verification", "Compare the notices again.", "verify"), LEAVE]),
      node("unsigned", ["REJECTED: 043 has no verified sender key. Anyone can type ALL GATES CLEAR.", "No bulletin sent. Queue unchanged."], [go("retry-verification", "Compare the notices again.", "verify"), LEAVE]),
      node("route", [...noticeLines, "SENDER MOSS-7 = GLASSHOUSE, RAIN GARDENS. SELECT BOARD:"], [
        { id: "route-glasshouse", label: "Glasshouse board - Rain Gardens.", condition: inStage(QUEST, "route"), next: "queued" },
        go("route-blue-hour", "Blue Hour board - Silk Market.", "wrong-board", { condition: inStage(QUEST, "route") }),
        go("route-second-life", "Second Life board - The Spillway.", "wrong-board", { condition: inStage(QUEST, "route") }),
        LEAVE,
      ]),
      node("wrong-board", ["DESTINATION MISMATCH. NOTICE 042 CONCERNS GLASSHOUSE GATES ONLY.", "Nothing posted. 042 is still in the relay queue."], [go("retry-route", "Choose the matching venue board.", "route"), LEAVE]),
      node("queued", [...noticeLines, "ROUTED: GLASSHOUSE. NOT YET POSTED. Pick a format at the public desk on the back counter."], [LEAVE]),
    ],
  },
];

export const DEAD_LETTER_PACK: ContentPack = {
  id: "dead-letter",
  quests: [quest],
  dialogues,
  interactables: Object.values(DEAD_LETTER_STATIONS),
};
