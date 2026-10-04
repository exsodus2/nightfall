import type { ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { LEAVE, active, available, ending, go, inStage, node } from "./helpers.ts";

const QUEST = "last-good-signal";
const COUNTER = "dead-letter.counter", ARCHIVE = "dead-letter.archive", RELAY = "dead-letter.relay";
const LEDGER = "dead-letter.ledger", SPOOL = "dead-letter.spool";
const DOOR = { x: 429, z: -247.48 };

export const DEAD_LETTER_STATIONS: Readonly<Record<"counter" | "archive" | "relay", InteractableDefinition>> = {
  counter: { id: "dead-letter-counter", label: "Read the Dead Letter public desk", place: "dead-letter", x: 429, z: -232.95, y: 2.2, glyph: ">", dialogue: COUNTER },
  archive: { id: "dead-letter-archive", label: "Check the signed-sender ledger", place: "dead-letter", x: 435.85, z: -233.17, y: 2.4, glyph: "=", condition: active(QUEST), dialogue: ARCHIVE },
  relay: { id: "dead-letter-relay", label: "Inspect the public relay queue", place: "dead-letter", x: 422.95, z: -238.7, y: 2.4, glyph: ">", condition: active(QUEST), dialogue: RELAY },
};

const quest: QuestDefinition2 = {
  id: QUEST, title: "Last Good Signal", category: "gig", giver: null,
  summary: "Three notices arrived out of order at Dead Letter Exchange. Verify the sender, find the current warning, and decide how the neighborhood hears it.",
  rewardHint: "90–130 cr, 150 XP, neighborhood reputation", recommendedLevel: 1, start: "evidence",
  stages: [
    {
      id: "evidence", journal: "Dead Letter's public desk needs a verified bulletin. Log the sender key and consent from the left archive shelf, then record the three notices at the right-hand relay machine. Opening a screen alone does not log it.",
      objectives: [
        { id: "sender-ledger", kind: "condition", text: "Log the sender ledger at the left archive shelf", condition: { flag: LEDGER }, target: DOOR },
        { id: "arrival-spool", kind: "condition", text: "Record the notices at the right-hand relay", condition: { flag: SPOOL }, target: DOOR },
      ],
      next: "verify",
    },
    {
      id: "verify", journal: "MOSS-7 is the Glasshouse's verified key. Notice 041 closes both gates; signed 042 reopens only the east gate; unsigned 043 claims every gate is clear. At the relay, select the newest notice with a verified sender.",
      objectives: [{ id: "verified-notice", kind: "choose", text: "Select the current signed notice at the relay", dialogue: RELAY, options: ["select-042"], target: DOOR }],
      next: "route",
    },
    {
      id: "route", journal: "Notice 042 is authentic: EAST GATE OPEN / WEST APPROACH FLOODED. MOSS-7 belongs to the Glasshouse in Rain Gardens. Put the bulletin on that venue's local board, not a citywide all-clear.",
      objectives: [{ id: "venue-route", kind: "choose", text: "Route notice 042 to the correct venue board", dialogue: RELAY, options: ["route-glasshouse"], target: DOOR }],
      next: "publish",
    },
    {
      id: "publish", journal: "The verified Glasshouse bulletin is queued. Return to the public desk. Send a concise notice without a sender name, or include the consented GLASSHOUSE DESK callback. Neri's home line stays sealed either way.",
      objectives: [{ id: "publication", kind: "choose", text: "Publish the verified bulletin at the public desk", dialogue: COUNTER, options: ["publish-anonymous", "publish-callback"], target: DOOR }],
      next: [{ if: { flag: `${QUEST}.publication`, is: "publish-anonymous" }, stage: "anonymous" }, { stage: "callback" }],
    },
    ending("anonymous", "A useful warning, with no name attached.", "anonymous"),
    ending("callback", "A useful warning and a consented desk callback.", "callback"),
  ],
  outcomes: {
    anonymous: {
      title: "Let the Notice Speak", journal: "Glasshouse 042 went out without a sender name: east gate open, west approach flooded. The Ghost Circuit kept the message useful and the sender quiet. Neri's home line stayed sealed.",
      effects: [{ credits: 90 }, { xp: 150 }, { rep: "civilian", by: 6 }, { rep: "ghosts", by: 3 }, { setFlag: "dead-letter.publication", value: "anonymous" }],
    },
    callback: {
      title: "Someone to Answer", journal: "Glasshouse 042 went out with the consented GLASSHOUSE DESK callback. Residents can report changing conditions, and the staffed callback earns a dispatch supplement. Neri's home line stayed sealed.",
      effects: [{ credits: 130 }, { xp: 150 }, { rep: "civilian", by: 4 }, { setFlag: "dead-letter.publication", value: "callback" }],
    },
  },
};

const ledgerLines = [
  "VERIFIED KEY: MOSS-7. Neri, Glasshouse night desk, Rain Gardens. A higher number is not proof of a sender.",
  "CONSENT: 'You may publish GLASSHOUSE DESK for callbacks. My home line stays sealed.' — Neri",
];
const spoolLines = [
  "ARRIVAL SPOOL: 041 / MOSS-7 / BOTH GATES SHUT. Then 043 / NO KEY / ALL GATES CLEAR.",
  "Last arrival: 042 / MOSS-7 / EAST GATE OPEN. WEST APPROACH STILL FLOODED. Revision numbers, not arrival order, establish the latest signed notice.",
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
        "[The public desk blinks: THREE NOTICES HELD. In the Ghost Circuit, late is normal. Wrong gets people hurt.]",
        "Check the left archive's sender ledger and the right relay's arrival spool. Find the latest signed warning, route it, then bring it here. No timer. No guessing fee.",
      ], [
        { id: "accept-signal", label: "Take the public bulletin job.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "collect" },
        LEAVE,
      ]),
      node("collect", ["Left archive: sender key and callback consent. Right relay: three notices in the order they arrived.", "Use each screen's Log or Record option. The desk pays for a verified bulletin, not a quick glance."], [LEAVE]),
      node("relay-reminder", ["The right-hand relay still needs your selection. Verify the newest signed notice, then select its venue board."], [LEAVE]),
      node("publish", [...noticeLines,
        "Two public formats. A nameless notice keeps the sender quiet. The consented GLASSHOUSE DESK callback lets residents report changes and earns a staffing supplement. Neither publishes a home line.",
      ], [
        { id: "publish-anonymous", label: "Send without a sender name. (90 cr, 150 XP)", condition: inStage(QUEST, "publish"), kind: "complete", next: "receipt-anonymous" },
        { id: "publish-callback", label: "Include the consented desk callback. (130 cr, 150 XP)", condition: inStage(QUEST, "publish"), kind: "complete", next: "receipt-callback" },
        go("publish-home", "Add the sealed home callback instead.", "consent-refusal", { condition: inStage(QUEST, "publish") }),
        LEAVE,
      ]),
      node("consent-refusal", ["PRIVACY INTERLOCK. Consent covers GLASSHOUSE DESK, not a home line. Nothing was sent.", "Use a nameless notice or the consented venue callback."], [go("retry-publication", "Choose a permitted format.", "publish"), LEAVE]),
      node("receipt-anonymous", [...noticeLines, "SENT RECEIPT: Sender name withheld. No callback published. Home line sealed. One public job, one payment. The warning stays on this desk for anyone to read."], [LEAVE]),
      node("receipt-callback", [...noticeLines, "SENT RECEIPT: Callback GLASSHOUSE DESK, by permission. Home line sealed. One public job, one payment. The warning stays on this desk for anyone to read."], [LEAVE]),
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
      node("ledger-recorded", [...ledgerLines, "LEDGER LOGGED. The right-hand relay can compare that key with the arrival spool."], [LEAVE]),
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
      node("spool-recorded", [...spoolLines, "SPOOL RECORDED. Compare the sender ledger from the left archive, then reopen this relay to select a notice."], [LEAVE]),
      node("verify", [...spoolLines, "Logged key: MOSS-7. Which notice is the current authenticated warning?"], [
        go("select-041", "Use signed 041: both gates shut.", "stale", { condition: inStage(QUEST, "verify") }),
        { id: "select-042", label: "Use signed 042: east open, west flooded.", condition: inStage(QUEST, "verify"), next: "route" },
        go("select-043", "Use unsigned 043: all gates clear.", "unsigned", { condition: inStage(QUEST, "verify") }),
        LEAVE,
      ]),
      node("stale", ["041 has a valid key, but signed 042 supersedes it. The newest signed revision wins, not the first arrival.", "No bulletin sent. The queue is intact."], [go("retry-verification", "Compare the notices again.", "verify"), LEAVE]),
      node("unsigned", ["043 has no verified sender key. A bigger number does not make an all-clear trustworthy.", "No bulletin sent. The queue is intact."], [go("retry-verification", "Compare the notices again.", "verify"), LEAVE]),
      node("route", [...noticeLines, "Sender MOSS-7 belongs to the Glasshouse in Rain Gardens. Which local board gets the warning?"], [
        { id: "route-glasshouse", label: "Glasshouse board — Rain Gardens.", condition: inStage(QUEST, "route"), next: "queued" },
        go("route-blue-hour", "Blue Hour board — Silk Market.", "wrong-board", { condition: inStage(QUEST, "route") }),
        go("route-second-life", "Second Life board — The Spillway.", "wrong-board", { condition: inStage(QUEST, "route") }),
        LEAVE,
      ]),
      node("wrong-board", ["DESTINATION MISMATCH. This is a Glasshouse gate notice, not a citywide all-clear. Keep unrelated boards clear.", "The relay kept the verified notice in its queue."], [go("retry-route", "Choose the matching venue board.", "route"), LEAVE]),
      node("queued", [...noticeLines, "ROUTED: GLASSHOUSE. Return to the public desk at the back counter to choose the bulletin format. Nothing has been published yet."], [LEAVE]),
    ],
  },
];

export const DEAD_LETTER_PACK: ContentPack = {
  id: "dead-letter",
  quests: [quest],
  dialogues,
  interactables: Object.values(DEAD_LETTER_STATIONS),
};
