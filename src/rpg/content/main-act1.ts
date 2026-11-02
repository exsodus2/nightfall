// Main questline, Act 1: "Return to Sender" (Silk Market -> Dead Letter Exchange, Ghost Circuit).
// The player is a new Dead Letter courier. Tilly Marsh hands them one undeliverable parcel: a wet
// data drive for Jonah Ashby at 9 Lantern Row. The door is condemned; Jonah went missing in the
// Flood six years ago; his mother Nell still sits across the street. The lot reader at Dead Letter
// Exchange names an archive called RAINFALL, a custodian (O. Crane, Meridian Climate) and a ship
// (the Nami Maru), and the drive only plays static. The act ends with Moth of Station Nobody
// hearing the drive and every sign on the Ghost Circuit flickering in time.
//
// Quests: The Undeliverable (Tilly), Return to Sender (Tilly). Choices: let Nell hold the drive or
// keep it sealed (rain.nell), log the drive at the Exchange or keep it off the books (rain.drive).
// Moth's dialogue (which closes Return to Sender and offers Act 2) lives in main-act2.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, active, available, bye, ending, flagIs, go, inStage, look, node } from "./helpers.ts";
import { FLAG, ITEM, RAIN, RAIN_ITEMS, SKIN, SPOTS, beforeFinale } from "./main-common.ts";

const Q1 = RAIN.undeliverable, Q2 = RAIN.returnToSender;

// ---- People ------------------------------------------------------------------------------------

export const TILLY: NpcDefinition = {
  id: "tilly-marsh", name: "Tilly Marsh", title: "Dead Letter dispatcher", district: 4, ...SPOTS.tilly, facing: FACE.west,
  look: look([44, 62, 110], [20, 26, 44], SKIN.tan, [255, 214, 120], "cap", "case", "scan"),
  greeting: ["Dead Letter Exchange, Silk Market drop. Parcels in, couriers out.", "A parcel's a promise. I keep count of promises."],
};

export const NELL: NpcDefinition = {
  id: "nell-ashby", name: "Nell Ashby", title: "Waiting across the street", district: 4, ...SPOTS.nell, facing: FACE.west,
  look: look([120, 96, 86], [60, 44, 40], SKIN.pale, [255, 196, 140], "bare", "umbrella", "breathe"),
  greeting: ["Six years on this chair. The council keeps asking me to move it.", "I'm waiting for somebody. You're not him. That's all right."],
};

// ---- Objects -----------------------------------------------------------------------------------

const interactables: InteractableDefinition[] = [
  {
    id: "rain-lantern-door", label: "Knock at 9 Lantern Row", ...SPOTS.lanternDoor, y: 1.6, glyph: "#",
    condition: inStage(Q1, "door"),
    effects: [
      { message: "The door is boarded over. A council notice, six years old: CONDEMNED AFTER THE FLOOD. NO OCCUPANTS. NO FORWARDING ADDRESS.", tone: "info" },
      { message: "Across the street, a woman on a folding chair is watching you knock.", tone: "quest" },
    ],
  },
  {
    // Dead Letter's left-hand machine (the right-hand one is the bulletin relay).
    id: "rain-lot-reader", label: "Use the lot reader", place: "dead-letter", ...SPOTS.lotReader, y: 2.4, glyph: ">",
    condition: inStage(Q2, "reader"), dialogue: "rain.reader",
  },
];

// ---- Quests ------------------------------------------------------------------------------------

const undeliverable: QuestDefinition2 = {
  id: Q1, title: "The Undeliverable", category: "story", giver: TILLY.id,
  summary: "Tilly Marsh, the Dead Letter dispatcher on the Silk Market avenue, has one parcel nobody will carry: a wet data drive for Jonah Ashby at 9 Lantern Row. Deliver it.",
  rewardHint: "120-180 cr, 150 XP", recommendedLevel: 1, start: "door",
  stages: [
    {
      id: "door", journal: "Deliver Tilly Marsh's wet data drive to Jonah Ashby at 9 Lantern Row, Silk Market. Lantern Row is the first street west of the avenue, a block south of Tilly: knock at number 9.",
      onEnter: [{ give: ITEM.drive }, { waypoint: { ...SPOTS.lanternDoor, label: "9 Lantern Row" } }],
      objectives: [{ id: "knock", kind: "interact", text: "Knock at 9 Lantern Row (first street west of the avenue, Silk Market)", object: "rain-lantern-door" }],
      next: "nell",
    },
    {
      id: "nell", journal: "Nobody has lived at 9 Lantern Row since the Flood. Ask the woman on the folding chair across the street, who has been watching the door, about Jonah Ashby.",
      onEnter: [{ waypoint: { ...SPOTS.nell, label: "The woman across the street" } }],
      objectives: [{ id: "label", kind: "choose", text: "Ask the woman across the street from 9 Lantern Row about Jonah Ashby", dialogue: "rain.nell", options: ["let-hold", "keep-sealed"] }],
      next: "report",
    },
    {
      id: "report", journal: "The drive is addressed to a missing man at a condemned door, and his mother is still waiting across the street. Tell Tilly Marsh at the Dead Letter drop on the Silk Market avenue.",
      onEnter: [{ waypoint: { ...SPOTS.tilly, label: "Tilly Marsh" } }],
      objectives: [{ id: "report", kind: "choose", text: "Report to Tilly Marsh at the Dead Letter drop, Silk Market avenue", dialogue: "rain.tilly", options: ["report"] }],
      next: [{ if: flagIs(FLAG.nell, "held"), stage: "end-held" }, { stage: "end-sealed" }],
    },
    ending("end-held", "Tilly logged the run as undeliverable.", "kind"),
    ending("end-sealed", "Tilly logged the run as undeliverable, by the book.", "book"),
  ],
  outcomes: {
    kind: {
      title: "Somewhere to Come Back To",
      journal: "Nell Ashby held her son's drive and gave you his front-door key for whoever is writing to him. Tilly paid the run and wants the lot code traced at Dead Letter Exchange.",
      effects: [{ credits: 120 }, { xp: 150 }, { rep: "civilian", by: 5 }],
    },
    book: {
      title: "Signed, Sealed, Undelivered",
      journal: "You kept the drive sealed: courier rules. Tilly paid the run with a bonus for procedure and wants the lot code traced at Dead Letter Exchange.",
      effects: [{ credits: 180 }, { xp: 150 }],
    },
  },
};

const returnToSender: QuestDefinition2 = {
  id: Q2, title: "Return to Sender", category: "story", giver: TILLY.id,
  summary: "Lot 77 has no sender, only a lot code. Tilly wants it traced on the lot reader inside Dead Letter Exchange, on the Ghost Circuit.",
  requires: { quest: Q1 }, rewardHint: "150 cr, 300 XP", recommendedLevel: 2, start: "reader",
  stages: [
    {
      id: "reader", journal: "Tilly wants Lot 77 traced. Take the drive inside Dead Letter Exchange on the Ghost Circuit (metro to Ghost Circuit station; the Exchange is a short walk south) and use the lot reader on the left-hand machine.",
      onEnter: [{ waypoint: { ...SPOTS.deadLetterDoor, label: "Dead Letter Exchange" } }],
      objectives: [{ id: "trace", kind: "choose", text: "Use the lot reader inside Dead Letter Exchange, Ghost Circuit", dialogue: "rain.reader", options: ["log-it", "off-book"], target: SPOTS.deadLetterDoor }],
      next: "moth",
    },
    {
      id: "moth", journal: "The lot reader named an archive called RAINFALL, kept by O. Crane of Meridian Climate, and the drive only plays static. Moth of Station Nobody reads static: she broadcasts from the pavement beside Ghost Circuit station.",
      onEnter: [{ waypoint: { ...SPOTS.moth, label: "Moth, Station Nobody" } }],
      objectives: [{ id: "moth", kind: "choose", text: "Show the drive to Moth on the pavement beside Ghost Circuit station", dialogue: "rain.moth", options: ["show-drive"] }],
      next: [{ if: flagIs(FLAG.drive, "logged"), stage: "end-logged" }, { stage: "end-off-book" }],
    },
    ending("end-logged", "Moth heard the drive.", "logged"),
    ending("end-off-book", "Moth heard the drive.", "off-book"),
  ],
  outcomes: {
    logged: {
      title: "On the Books",
      journal: "Dead Letter logged Lot 77 as carried by you, with a courier number. Moth heard the drive and said the rain is reading from the same page. Under the hiss a man laughed, and every sign on the Ghost Circuit flickered in time.",
      effects: [{ credits: 150 }, { xp: 300 }, { rep: "civilian", by: 3 }],
    },
    "off-book": {
      title: "Off the Books",
      journal: "No record of Lot 77 exists but the drive in your pocket. Moth heard it and said the rain is reading from the same page. Under the hiss a man laughed, and every sign on the Ghost Circuit flickered in time.",
      effects: [{ credits: 150 }, { xp: 300 }, { rep: "ghosts", by: 5 }],
    },
  },
};

// ---- Dialogue ----------------------------------------------------------------------------------

const dialogues: DialogueDefinition[] = [
  {
    id: "rain.tilly", npc: TILLY.id,
    entries: [
      { condition: { all: [inStage(Q1, "report"), flagIs(FLAG.nell, "held")] }, node: "report-held", priority: 30 },
      { condition: inStage(Q1, "report"), node: "report-sealed", priority: 29 },
      { condition: available(Q1), node: "offer", priority: 20 },
      { condition: active(Q1), node: "q1-working", priority: 18 },
      { condition: available(Q2), node: "offer2", priority: 20 },
      { condition: active(Q2), node: "q2-working", priority: 18 },
      { condition: { all: [{ quest: Q2 }, beforeFinale] }, node: "between", priority: 4 },
    ],
    nodes: [
      node("offer", [
        "You're the new courier. Good. I've got one parcel the regulars won't touch and a run sheet with your name on it.",
        "A data drive, wet through, smells of the harbour. For Jonah Ashby, 9 Lantern Row: first street west of this avenue, a block south.",
        "A hundred and twenty credits when somebody signs for it. Why you? The regulars took one sniff and said no.",
      ], [
        { id: "accept-run", label: "I'll take the run. (120 cr)", condition: available(Q1), effects: [{ startQuest: Q1 }], next: "q1-accepted" },
        bye("Not tonight.", "decline"),
      ]),
      node("q1-accepted", [
        "Signed out to you. Knock, wait, get a signature. If nobody answers, it comes back to me.",
        "Your map has the door marked. Keep it dry; I want to read that harbour stamp properly.",
      ], [LEAVE]),
      node("q1-working", ["9 Lantern Row. First street west of the avenue, a block south. Knock, wait, get a signature."], [LEAVE]),
      node("report-held", ["Back already. Signed for?"], [
        { id: "report", label: "Nobody to sign. Number 9 is condemned. His mother waits across the street; I let her hold it.", condition: inStage(Q1, "report"), kind: "complete", next: "after-held" },
        LEAVE,
      ]),
      node("report-sealed", ["Back already. Signed for?"], [
        { id: "report", label: "Nobody to sign. Number 9 is condemned. His mother waits across the street; I kept it sealed.", condition: inStage(Q1, "report"), kind: "complete", next: "after-sealed" },
        LEAVE,
      ]),
      node("after-held", [
        "You let her hold it. That's not procedure.",
        "...It's the right kind of wrong. Here's your fee.",
        "That label's a lot code, not a postmark. Dead Letter Exchange can trace lot codes.",
      ], [go("next", "Trace it how?", "offer2")]),
      node("after-sealed", [
        "By the book. I'm putting a bonus on your sheet; nobody follows the book any more.",
        "That label's a lot code, not a postmark. Dead Letter Exchange can trace lot codes.",
      ], [go("next", "Trace it how?", "offer2")]),
      node("offer2", [
        "Dead Letter Exchange, on the Ghost Circuit. Metro from Silk Market station to Ghost Circuit; the Exchange is a short walk south of the platform.",
        "Inside, the left-hand machine is a lot reader. Feed it the drive and it'll say whose parcel this really is.",
        "A hundred and fifty for the trace. I don't like an open docket.",
      ], [
        { id: "accept-trace", label: "I'll take it to the Exchange. (150 cr)", condition: available(Q2), effects: [{ startQuest: Q2 }], next: "q2-accepted" },
        bye("Later.", "decline"),
      ]),
      node("q2-accepted", ["The Ghost Circuit is rougher than the market. Walk like you've got somewhere to be. You have."], [LEAVE]),
      node("q2-working", ["Dead Letter Exchange, Ghost Circuit, a short walk south of the station. The lot reader is the left-hand machine. Then go where it points."], [LEAVE]),
      node("between", [
        "Lot 77's docket is still open on my board. I don't close a docket until something's signed for.",
        "Whatever you're chasing, chase it. I'll keep the board.",
      ], [LEAVE]),
    ],
  },
  {
    id: "rain.nell", npc: NELL.id,
    entries: [
      { condition: inStage(Q1, "nell"), node: "ask", priority: 20 },
      { condition: { all: [{ quest: Q1 }, flagIs(FLAG.nell, "held"), beforeFinale] }, node: "between-held", priority: 3 },
      { condition: { all: [{ quest: Q1 }, beforeFinale] }, node: "between-sealed", priority: 2 },
    ],
    nodes: [
      node("ask", [
        "You've got a parcel for number nine. Nobody's brought one in six years.",
        "Jonah Ashby is my son. He went to work the night of the Flood and the water kept him.",
        "Is it from him?",
      ], [go("read", "Read her the label.", "label")]),
      node("label", [
        "[LOT 77. ASHBY, J. 9 LANTERN ROW. No sender. A Silk Harbour sorting stamp, still wet.]",
        "Lot seventy-seven. Like he's something at an auction.",
        "Can I hold it? I won't open it. I just want to hold something with his name on.",
      ], [
        { id: "let-hold", label: "Let her hold it.", condition: inStage(Q1, "nell"), effects: [{ setFlag: FLAG.nell, value: "held" }, { give: ITEM.key }], next: "held" },
        { id: "keep-sealed", label: "Courier rules: it goes to the addressee or back to the office.", condition: inStage(Q1, "nell"), effects: [{ setFlag: FLAG.nell, value: "sealed" }], next: "sealed" },
      ]),
      node("held", [
        "[She holds the drive to her ear like a shell, then gives it back.]",
        "It's raining in there. Of course it is.",
        "Take this too: his door key. I kept it. Whoever's writing to my boy, give them this. Tell them he has somewhere to come back to.",
      ], [bye("I'll find them.")]),
      node("sealed", [
        "Good. Somebody in this city still follows rules.",
        "Take it back to your office, then. If they find who sent it, I'm on this chair. I'm always on this chair.",
      ], [bye("I'll be back.")]),
      node("between-held", ["Still on my chair. Still got his key? Good. You give it to whoever's writing to him."], [LEAVE]),
      node("between-sealed", ["Still on my chair. Did your office find a sender yet?"], [LEAVE]),
    ],
  },
  {
    // The lot reader inside Dead Letter Exchange (spoken by the interactable).
    id: "rain.reader", npc: "rain-lot-reader",
    entries: [{ node: "read" }],
    nodes: [
      node("read", [
        "LOT READER. INSERT ITEM.",
        "[You slot the wet drive. The screen fills one line at a time.]",
        "LOT 77 / ASHBY, JONAH / ARCHIVE: RAINFALL / CUSTODIAN: O. CRANE, MERIDIAN CLIMATE / ARRIVED ON: NAMI MARU / CONTENTS: 1 VOICE",
      ], [go("play", "Play the contents.", "play"), LEAVE]),
      node("play", [
        "[Static. Then every dead radio on the Exchange's shelves starts to hiss with it, in time.]",
        "[Under the hiss, for half a second, a man laughs. Then it's rain on a tin roof again.]",
        "LOG LOT 77 AS UNDELIVERABLE, CARRIED BY COURIER? Y / N",
      ], [
        { id: "log-it", label: "Log it. The Exchange keeps a public record; you keep the drive.", condition: inStage(Q2, "reader"), effects: [{ setFlag: FLAG.drive, value: "logged" }], next: "logged" },
        { id: "off-book", label: "Don't log it. Nobody needs to know this drive exists.", condition: inStage(Q2, "reader"), effects: [{ setFlag: FLAG.drive, value: "off-book" }], next: "unlogged" },
        bye("Think it over."),
      ]),
      node("logged", [
        "LOGGED. RECEIPT PRINTED. COURIER NUMBER ASSIGNED.",
        "[A footnote in biro on the receipt: STATIC? ASK MOTH, STATION NOBODY. PAVEMENT BY GHOST CIRCUIT STATION.]",
      ], [LEAVE]),
      node("unlogged", [
        "SCREEN CLEARED. NO RECORD KEPT.",
        "[Someone has scratched into the casing with a key: STATIC? ASK MOTH. PAVEMENT BY GHOST CIRCUIT STATION.]",
      ], [LEAVE]),
    ],
  },
];

/** Act 1: the people, the parcel and the first trace. Carries every story item. */
export const MAIN_ACT1_PACK: ContentPack = {
  id: "main-act1",
  npcs: [TILLY, NELL],
  items: RAIN_ITEMS,
  interactables,
  quests: [undeliverable, returnToSender],
  dialogues,
};
