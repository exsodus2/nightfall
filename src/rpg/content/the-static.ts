import type { Condition, ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { LEAVE, active, available, ending, go, inStage, node } from "./helpers.ts";

// "Last Set Before Curfew" at The Static, the Neon Ward nightclub (interiors.ts "the-static",
// building 526: room space maps to world space as (-45 + x, -403 + z), the door faces +z).
// Nova Vex's set-list drive is corrupted. Three tracks come back three ways, in any order: Rhea at
// the bar remembers one request, the slips in the right-hand booth hold another, and the mixer's cue
// buffer holds the third once the mixer is repaired (three steps; every wrong step is refused
// with no cost and can be retried). Then the player picks the closing track: two moods, one fee.

const QUEST = "last-set-before-curfew";
const DECKS = "static.decks", BAR = "static.bar", SLIPS = "static.slips";
const SLOT_7 = `${QUEST}.slot-7`, SLOT_8 = `${QUEST}.slot-8`, SLOT_9 = `${QUEST}.slot-9`;
const MASTER = `${QUEST}.mixer-master`, RIBBON = `${QUEST}.mixer-ribbon`;
const DOOR = { x: -45, z: -391.59 };
const has = (flag: string): Condition => ({ flag });
const lacks = (flag: string): Condition => ({ not: { flag } });
const recovering = inStage(QUEST, "recover");
const bells: Condition = { flag: `${QUEST}.closer`, is: "curfew-bells" };

export const THE_STATIC_STATIONS: Readonly<Record<"decks" | "bar" | "slips", InteractableDefinition>> = {
  decks: { id: "the-static-decks", label: "Talk to Nova Vex at the decks", place: "the-static", x: -43.7, z: -408.55, y: 2.2, glyph: ">", dialogue: DECKS },
  bar: { id: "the-static-bar", label: "Ask Rhea at the bar", place: "the-static", x: -50.7, z: -405.85, y: 2.2, glyph: "=", condition: active(QUEST), dialogue: BAR },
  slips: { id: "the-static-slips", label: "Read the request slips in the booth", place: "the-static", x: -37.1, z: -403.05, y: 2, glyph: "+", condition: active(QUEST), dialogue: SLIPS },
};

const SET_LIST = "SET LIST: 07 T?DEW?TER ?YMN / 08 GL?SS ?RC?DE / 09 ???????? (CUE BUFFER) / 10 CLOSER: OPEN.";
const RESTORED = "SET LIST: 07 TIDEWATER HYMN / 08 GLASS ARCADE / 09 LANTERN STATIC / 10 CLOSER: OPEN.";

const quest: QuestDefinition2 = {
  id: QUEST, title: "Last Set Before Curfew", category: "gig", giver: null,
  summary: "Nova Vex's set-list drive at The Static is corrupted an hour before curfew. Recover the last three tracks from the bar, the request slips and the mixer, then choose how the night ends.",
  rewardHint: "110 cr, 140 XP, Civilian reputation; either closer pays the same", recommendedLevel: 1, start: "recover",
  stages: [
    {
      id: "recover", journal: "The Static, Neon Ward. Three tracks are missing from Nova's set list. Rhea at the bar (back left) remembers slot 7's request, the slips in the right-hand booth hold slot 8, and slot 9 is stuck in the mixer's cue buffer at the decks: repair the mixer to read it.",
      objectives: [
        { id: "bar-request", kind: "condition", text: "Ask Rhea at The Static's bar which track the dock crew requested (slot 7)", condition: has(SLOT_7), target: DOOR },
        { id: "booth-slips", kind: "condition", text: "Match a request slip in the right-hand booth to slot 8", condition: has(SLOT_8), target: DOOR },
        { id: "cue-buffer", kind: "condition", text: "Repair the mixer at the decks and read slot 9 from its cue buffer", condition: has(SLOT_9), target: DOOR },
      ],
      next: "closer",
    },
    {
      id: "closer", journal: "All three tracks are back. Slot 10 is the closer, and Nova says it is your call: Curfew Bells sends everyone home slow and warm, Static Bloom gives them one last lift on the way out. Both are good endings.",
      objectives: [{ id: "closer", kind: "choose", text: "Pick the closing track with Nova at the decks", dialogue: DECKS, options: ["curfew-bells", "static-bloom"], target: DOOR }],
      next: [{ if: bells, stage: "bells" }, { stage: "bloom" }],
    },
    ending("bells", "Curfew Bells closes the set.", "bells"),
    ending("bloom", "Static Bloom closes the set.", "bloom"),
  ],
  outcomes: {
    bells: {
      title: "Home Slow", journal: "Curfew Bells closed The Static's last set before curfew. The floor slowed, coats came off the rack and the bouncer held the door for everyone. One fee paid.",
      effects: [{ credits: 110 }, { xp: 140 }, { rep: "civilian", by: 3 }, { setFlag: "the-static.closer", value: "curfew-bells" }],
    },
    bloom: {
      title: "One Last Lift", journal: "Static Bloom closed The Static's last set before curfew. The room went up one more time and walked out into the rain still humming it. One fee paid.",
      effects: [{ credits: 110 }, { xp: 140 }, { rep: "civilian", by: 3 }, { setFlag: "the-static.closer", value: "static-bloom" }],
    },
  },
};

const dialogues: readonly DialogueDefinition[] = [
  {
    id: DECKS, npc: THE_STATIC_STATIONS.decks.id, quest: QUEST,
    entries: [
      { condition: available(QUEST), node: "offer" },
      { condition: { all: [recovering, lacks(SLOT_9), lacks(MASTER)] }, node: "master" },
      { condition: { all: [recovering, lacks(SLOT_9), lacks(RIBBON)] }, node: "ribbon" },
      { condition: { all: [recovering, lacks(SLOT_9)] }, node: "clock" },
      { condition: recovering, node: "waiting" },
      { condition: inStage(QUEST, "closer"), node: "closer" },
      { condition: { quest: QUEST, outcome: "bells" }, node: "receipt-bells" },
      { condition: { quest: QUEST, outcome: "bloom" }, node: "receipt-bloom" },
    ],
    nodes: [
      node("offer", [
        "[Nova Vex keeps the room moving on one deck. The other channel is dead, and the drive in the mixer reads CORRUPT.]",
        "Nova: 'Curfew's at four and the drive ate my last three tracks. Rhea at the bar heard one request all night. The slips in the booth have another. The third is stuck in this mixer. Get them back and the closer is your call.'",
        `${SET_LIST} PAY: 110 CR.`,
      ], [{ id: "accept-set", label: "Recover the last three tracks.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "master" }, LEAVE]),
      node("master", [
        "MIXER: CH2 NO SIGNAL / CUE BUFFER LOCKED, 1 TRACK HELD.",
        "Taped to the mixer, a service card: 1. MASTER SEND TO ZERO BEFORE YOU TOUCH A CABLE. 2. RESEAT THE CH2 RIBBON, LATCH SIDE UP. 3. FLUSH THE CUE BUFFER AT THE HOUSE CLOCK.",
      ], [
        { id: "master-zero", label: "Pull the master send to zero first.", condition: { all: [recovering, lacks(SLOT_9), lacks(MASTER)] }, effects: [{ setFlag: MASTER }], next: "ribbon" },
        go("master-live", "Reseat the cable with the master still up.", "master-fault", { condition: recovering }),
        LEAVE,
      ]),
      node("master-fault", [
        "POP GUARD. A soft thump rolls through the subs and half the floor looks up at the booth. Nothing broke; the guard held the cable dead.",
        "Nova, not unkindly: 'Card says zero first.'",
      ], [go("retry-master", "Start again from step 1.", "master"), LEAVE]),
      node("ribbon", [
        "MASTER: ZERO. CH2: NO SIGNAL. The ribbon connector sits half out of its socket. The board's silk-screen arrow says LATCH UP.",
      ], [
        { id: "ribbon-latch-up", label: "Reseat the ribbon latch side up until it clicks.", condition: { all: [recovering, has(MASTER), lacks(RIBBON)] }, effects: [{ setFlag: RIBBON }], next: "clock" },
        go("ribbon-tape", "Tape it down the way it is.", "ribbon-fault", { condition: recovering }),
        LEAVE,
      ]),
      node("ribbon-fault", [
        "CH2: A CRACKLE, THEN NOTHING. Tape doesn't make a contact. It peels off clean; nothing is damaged.",
        "The silk-screen arrow still says LATCH UP.",
      ], [go("retry-ribbon", "Reseat the ribbon properly.", "ribbon"), LEAVE]),
      node("clock", [
        "CH2: SIGNAL. CUE BUFFER: LOCKED, 1 TRACK HELD. Flush rate dial: 44.1 KHZ / 48 KHZ / 96 KHZ.",
        "A sticker on the rack, in Nova's handwriting: HOUSE CLOCK 48K. EVERYTHING ELSE SOUNDS WRONG.",
      ], [
        { id: "flush-48", label: "Flush the cue buffer at 48 kHz.", condition: { all: [recovering, has(RIBBON), lacks(SLOT_9)] }, effects: [{ setFlag: SLOT_9 }], next: "cue-read" },
        go("flush-44", "Flush it at 44.1 kHz.", "clock-fault", { condition: recovering }),
        go("flush-96", "Flush it at 96 kHz.", "clock-fault", { condition: recovering }),
        LEAVE,
      ]),
      node("clock-fault", [
        "CLOCK MISMATCH. The buffer previews a semitone off in the headphones only. The floor never hears it, and the track is still held.",
        "The rack sticker says 48K.",
      ], [go("retry-clock", "Set the dial again.", "clock"), LEAVE]),
      node("cue-read", [
        "CUE BUFFER FLUSHED: LANTERN STATIC. SLOT 09 RESTORED.",
        "Nova: 'That's the one I cued before the drive died. Rhea and the booth have the other two.'",
      ], [go("to-closer", "All three are back. Talk about the closer.", "closer", { condition: inStage(QUEST, "closer"), hideIfUnavailable: true }), LEAVE]),
      node("waiting", [
        "MIXER: OK. SLOT 09: LANTERN STATIC.",
        "Nova: 'Rhea at the bar has slot seven. The slips in the right-hand booth have slot eight. Bring me both.'",
      ], [LEAVE]),
      node("closer", [
        RESTORED,
        "Nova: 'Two ways to end a night. Curfew Bells sends them home slow and warm. Static Bloom gives them one last lift on the way out. Both are good closers. Your call.'",
      ], [
        { id: "curfew-bells", label: "Close on Curfew Bells: slow and warm. (110 cr, 140 XP)", condition: inStage(QUEST, "closer"), kind: "complete", next: "receipt-bells" },
        { id: "static-bloom", label: "Close on Static Bloom: one last lift. (110 cr, 140 XP)", condition: inStage(QUEST, "closer"), kind: "complete", next: "receipt-bloom" },
        LEAVE,
      ]),
      node("receipt-bells", [
        "SET LIST: 07 TIDEWATER HYMN / 08 GLASS ARCADE / 09 LANTERN STATIC / 10 CURFEW BELLS.",
        "CLOSED BEFORE CURFEW. ONE FEE PAID. Nova: 'Slow and warm. They'll sleep well.'",
      ], [LEAVE]),
      node("receipt-bloom", [
        "SET LIST: 07 TIDEWATER HYMN / 08 GLASS ARCADE / 09 LANTERN STATIC / 10 STATIC BLOOM.",
        "CLOSED BEFORE CURFEW. ONE FEE PAID. Nova: 'One last lift. They'll be humming it on the night bus.'",
      ], [LEAVE]),
    ],
  },
  {
    id: BAR, npc: THE_STATIC_STATIONS.bar.id, quest: QUEST,
    entries: [{ condition: { all: [recovering, lacks(SLOT_7)] }, node: "ask" }, { condition: active(QUEST), node: "logged" }],
    nodes: [
      node("ask", [
        "[Rhea dries a glass under the bottle shelf.] 'Slot seven? The dock crew asked for the same one all night. Slow, a ferry horn on the drop. Tidewater something.'",
        "Nova's list reads 07 T?DEW?TER ?YMN. Rhea counts off the Tidewater tracks she knows: TIDEWATER HYMN, TIDEWATER RUN.",
      ], [
        { id: "tidewater-hymn", label: "Tidewater Hymn: it fits T?DEW?TER ?YMN.", condition: { all: [recovering, lacks(SLOT_7)] }, effects: [{ setFlag: SLOT_7 }], next: "logged" },
        go("tidewater-run", "Tidewater Run.", "bar-miss", { condition: recovering }),
        LEAVE,
      ]),
      node("bar-miss", [
        "'Run? No, that one's fast. The crew wanted slow.' RUN doesn't fit the gaps in ?YMN either. Nothing written down.",
      ], [go("retry-bar", "Ask her again.", "ask"), LEAVE]),
      node("logged", [
        "SLOT 07: TIDEWATER HYMN.",
        "Rhea: 'Tell Nova the dock crew tips in fish. Don't ask.'",
      ], [LEAVE]),
    ],
  },
  {
    id: SLIPS, npc: THE_STATIC_STATIONS.slips.id, quest: QUEST,
    entries: [{ condition: { all: [recovering, lacks(SLOT_8)] }, node: "slips" }, { condition: active(QUEST), node: "slip-logged" }],
    nodes: [
      node("slips", [
        "[Napkin slips tucked behind the booth's backrest, three handwritings.] SLIP A: GLASS ARCADE PLS. SLIP B: GRASS PARADE!!! SLIP C: glass arcade, the long mix.",
        "Nova's list reads 08 GL?SS ?RC?DE.",
      ], [
        { id: "glass-arcade", label: "Glass Arcade, long mix: two slips, and it fits GL?SS ?RC?DE.", condition: { all: [recovering, lacks(SLOT_8)] }, effects: [{ setFlag: SLOT_8 }], next: "slip-logged" },
        go("grass-parade", "Grass Parade: the loudest slip.", "slip-miss", { condition: recovering }),
        LEAVE,
      ]),
      node("slip-miss", [
        "GRASS PARADE doesn't fit GL?SS ?RC?DE: the R and the P are in the wrong places. Somebody's joke. Nothing written down.",
      ], [go("retry-slips", "Read the slips again.", "slips"), LEAVE]),
      node("slip-logged", [
        "SLOT 08: GLASS ARCADE (LONG MIX). The other slips go in the bin.",
      ], [LEAVE]),
    ],
  },
];

export const THE_STATIC_PACK: ContentPack = { id: "the-static", quests: [quest], dialogues, interactables: Object.values(THE_STATIC_STATIONS) };
