// Pack "off-the-dial": "Off the Dial" in Ghost Circuit. Vesper Quill runs a pirate transmitter off a
// relay mast east of her corner. Her crystal oscillator went missing when the Razorbacks jumped her
// courier in the alley junction to the north-east (encounters.ts "street-gc-alley", auto, respawns):
// the courier's satchel is still lying in the junction, so the fight is optional but likely. Then
// restore the signal at the mast cabinet (three steps; a wrong step is refused at no cost and can
// be retried), and decide which station gets the frequency.
// World flag: ghost.dial ("open" | "ghosts" | "razorbacks").
//
// Every position is checked walkable by tests/harbour-lanterns-rent-dial-rainline.test.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { Condition, ContentPack, DialogueDefinition, InteractableDefinition, ItemDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, available, bye, ending, flagIs, go, inStage, look, node } from "./helpers.ts";

const QUEST = "off-the-dial";
const CRYSTAL = "crystal-oscillator";
const SEATED = `${QUEST}.seated`, GROUNDED = `${QUEST}.grounded`, CARRIER = `${QUEST}.carrier`;
const has = (flag: string): Condition => ({ flag });
const lacks = (flag: string): Condition => ({ not: { flag } });
const restoring = inStage(QUEST, "restore");

/** Where things stand (each is on clear ground; the content test proves it). */
export const DIAL_SPOTS = {
  vesper: { x: 568.5, z: -352 },
  satchel: { x: 612, z: -418 },
  mast: { x: 632.5, z: -352 },
} as const;

export const DIAL_NPCS: readonly NpcDefinition[] = [
  {
    id: "vesper-quill", name: "Vesper Quill", title: "Pirate radio operator", district: 2, ...DIAL_SPOTS.vesper, facing: FACE.east,
    look: look([36, 30, 52], [12, 10, 20], [150, 112, 90], [200, 120, 255], "hood", "antenna", "scan"),
    greeting: ["You're listening to nothing. Nothing at all. That's the problem.", "Ninety-one three. Used to be mine. Used to be everyone's."],
  },
];

const ITEMS: readonly ItemDefinition[] = [
  { id: CRYSTAL, name: "Crystal Oscillator", kind: "quest", rarity: "rare", glyph: "*", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "A quartz can the size of a thumb, wrapped in tape that says VQ 91.3. The heart of a transmitter." },
];

const INTERACTABLES: readonly InteractableDefinition[] = [
  {
    // The satchel stays until the crystal is in your pack (or seated), so losing it is never final.
    id: "od-satchel", label: "Courier's dropped satchel", ...DIAL_SPOTS.satchel, glyph: "*",
    condition: { all: [{ any: [inStage(QUEST, "retrieve"), restoring] }, lacks(SEATED), { not: { item: CRYSTAL } }] },
    effects: [{ give: CRYSTAL }, { message: "Under a torn satchel in the gutter: a taped quartz can marked VQ 91.3. The Razorbacks took the courier's shoes and missed it.", tone: "loot" }],
  },
  { id: "od-mast", label: "Relay mast cabinet", ...DIAL_SPOTS.mast, glyph: "%", condition: restoring, dialogue: "od.mast" },
];

const quest: QuestDefinition2 = {
  id: QUEST, title: "Off the Dial", category: "side", giver: "vesper-quill",
  summary: "Recover a pirate transmitter's crystal from Razorback turf, put the station back on the air, and decide who gets the frequency.",
  rewardHint: "220 cr, 360 XP; reputation depends on who gets 91.3", recommendedLevel: 7, start: "retrieve",
  stages: [
    {
      id: "retrieve",
      journal: "Vesper's courier was jumped in the alley junction about seventy metres north-east of her corner, in Razorback turf. The crystal oscillator was in his satchel. Find it; the Razorbacks there will not ask politely.",
      onEnter: [{ waypoint: { ...DIAL_SPOTS.satchel, label: "Courier's satchel (Razorback alley)" } }],
      objectives: [{ id: "crystal", kind: "collect", item: CRYSTAL, count: 1, text: "Recover the crystal oscillator from the courier's satchel", target: DIAL_SPOTS.satchel }],
      next: "restore",
    },
    {
      id: "restore",
      journal: "Get 91.3 back on the air: the relay mast cabinet is sixty metres east of Vesper's corner. Seat the crystal, ground the mast, and set the carrier. Her card is taped inside the door.",
      onEnter: [{ waypoint: { ...DIAL_SPOTS.mast, label: "Relay mast cabinet" } }],
      objectives: [{ id: "on-air", kind: "condition", condition: has(CARRIER), text: "Restore the signal at the relay mast cabinet", target: DIAL_SPOTS.mast }],
      next: "frequency",
    },
    {
      id: "frequency",
      journal: "91.3 is carrying again, and Vesper says the frequency is yours to give: Mira Bell's night-shift open channel, the Ghost couriers' traffic band, or the Razorbacks' request hour, which might buy the alley some peace.",
      objectives: [{ id: "frequency", kind: "choose", text: "Tell Vesper Quill who gets 91.3", dialogue: "od.vesper", options: ["give-open", "give-ghosts", "give-razor"] }],
      next: [
        { if: flagIs(`${QUEST}.frequency`, "give-open"), stage: "end-open" },
        { if: flagIs(`${QUEST}.frequency`, "give-ghosts"), stage: "end-ghosts" },
        { stage: "end-razor" },
      ],
    },
    ending("end-open", "91.3 carries the night-shift open channel.", "open"),
    ending("end-ghosts", "91.3 carries Ghost courier traffic.", "ghosts"),
    ending("end-razor", "91.3 carries the Razorback request hour.", "razorbacks"),
  ],
  outcomes: {
    open: {
      title: "Open Air", journal: "91.3 carries Mira Bell's night-shift channel now: lift faults, fuse runs, lost cats. Anyone can call in. Vesper paid you and went to bed for the first time in a week.",
      effects: [{ credits: 220 }, { xp: 360 }, { rep: "civilian", by: 6 }, { setFlag: "ghost.dial", value: "open" }],
    },
    ghosts: {
      title: "Courier Band", journal: "91.3 hums with Ghost courier traffic, every word of it encrypted. Vesper paid you, and the couriers in the Circuit wave now. CorpSec has started asking who owns the mast.",
      effects: [{ credits: 220 }, { xp: 360 }, { rep: "ghosts", by: 8 }, { rep: "corpsec", by: -3 }, { setFlag: "ghost.dial", value: "ghosts" }],
    },
    razorbacks: {
      title: "Request Hour", journal: "91.3 plays the Razorback request hour: dedications, threats and one very sincere ballad. Vesper paid you, and the alley has been quieter for her couriers since.",
      effects: [{ credits: 220 }, { xp: 360 }, { rep: "razorbacks", by: 8 }, { rep: "civilian", by: -2 }, { setFlag: "ghost.dial", value: "razorbacks" }],
    },
  },
};

const DIALOGUES: readonly DialogueDefinition[] = [
  {
    id: "od.vesper", npc: "vesper-quill", quest: QUEST,
    entries: [
      { condition: available(QUEST), node: "offer" },
      { condition: inStage(QUEST, "retrieve"), node: "retrieve" },
      { condition: restoring, node: "restore" },
      { condition: inStage(QUEST, "frequency"), node: "frequency" },
      { condition: { quest: QUEST, outcome: "open" }, node: "after-open" },
      { condition: { quest: QUEST, outcome: "ghosts" }, node: "after-ghosts" },
      { condition: { quest: QUEST, outcome: "razorbacks" }, node: "after-razor" },
      { node: "hub" },
    ],
    nodes: [
      node("hub", ["You're listening to nothing. Nothing at all. That's the problem."], [LEAVE]),
      node("offer", [
        "[A woman in a hood with an antenna taped to her shoulder, holding a dead handset to her ear out of habit.]",
        "Ninety-one three. Pirate carrier off the relay mast east of here. Six years on air. Last night my courier was bringing the crystal back from the tuner and the Razorbacks jumped him in the alley junction north-east.",
        "He's fine. Shoeless, but fine. The satchel's still in the gutter. Get me the crystal and help me put it back, and the frequency's yours to give away. I'm tired of owning it.",
      ], [
        { id: "accept-dial", label: "I'll get your crystal.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "accepted" },
        bye("Not in Razorback turf.", "decline"),
      ]),
      node("accepted", ["North-east, the alley junction. They hang about there. You don't have to fight them. You probably will."], [LEAVE]),
      node("retrieve", ["The satchel's in the junction, north-east. Taped quartz can, says VQ on it."], [LEAVE]),
      node("restore", ["Mast cabinet, east. Crystal in, strap on, carrier set. My card's on the door. Read the card."], [LEAVE]),
      node("frequency", [
        "[Her handset crackles, then plays a clean tone.] There it is. Ninety-one three.",
        "I said it's yours to give. Mira Bell's open channel, so anyone with a radio can call for help. The Ghost couriers, who'd pay for a clean band. Or the Razorbacks, who'd stop jumping my couriers if they had a request hour.",
      ], [
        { id: "give-open", label: "Mira Bell's open channel. Anyone can call in.", condition: inStage(QUEST, "frequency"), kind: "complete", next: "paid-open" },
        { id: "give-ghosts", label: "The Ghost couriers.", condition: inStage(QUEST, "frequency"), kind: "complete", next: "paid-ghosts" },
        { id: "give-razor", label: "The Razorbacks' request hour.", condition: inStage(QUEST, "frequency"), kind: "complete", next: "paid-razor" },
        bye("Let me think."),
      ]),
      node("paid-open", ["Lift faults and lost cats. [She smiles.] Good. That's what radio is for. Here's your fee."], [LEAVE]),
      node("paid-ghosts", ["They'll pay rent on it, at least. Here's your fee. Don't tell me what they say on it."], [LEAVE]),
      node("paid-razor", ["Dedications and threats. [She laughs.] Fine. If it keeps my couriers in their shoes. Here's your fee."], [LEAVE]),
      node("after-open", ["Somebody called in a flood on the open channel last night. Three people turned up with buckets."], [LEAVE]),
      node("after-ghosts", ["The band's full every night. Clicks and hums. I don't listen."], [LEAVE]),
      node("after-razor", ["Request hour had a ballad last night. A real one. I nearly cried. Don't tell them."], [LEAVE]),
    ],
  },
  {
    id: "od.mast", npc: "od-mast", quest: QUEST,
    entries: [
      { condition: { all: [restoring, lacks(SEATED)] }, node: "seat" },
      { condition: { all: [restoring, lacks(GROUNDED)] }, node: "ground" },
      { condition: { all: [restoring, lacks(CARRIER)] }, node: "tune" },
      { condition: restoring, node: "on-air" },
    ],
    nodes: [
      node("seat", [
        "CABINET OPEN. OSCILLATOR SOCKET: EMPTY. CARRIER: OFF.",
        "Vesper's card, taped inside the door: 1. CRYSTAL IN, NOTCH TO 9 O'CLOCK. 2. CLIP THE STRAP BEFORE POWER. 3. CARRIER 91.3 (NOT 93.1).",
      ], [
        { id: "seat-nine", label: "Seat the crystal, notch to 9 o'clock.", condition: { all: [restoring, lacks(SEATED), { item: CRYSTAL }] }, reason: "You need the crystal oscillator", effects: [{ take: CRYSTAL }, { setFlag: SEATED }], next: "ground" },
        go("seat-three", "Seat it notch to 3 o'clock.", "seat-fault", { condition: restoring }),
        LEAVE,
      ]),
      node("seat-fault", ["It won't go in that way. The pins don't meet. Nothing bent.", "The card says 9 o'clock."], [go("retry-seat", "Try again.", "seat"), LEAVE]),
      node("ground", ["OSCILLATOR: SEATED. CARRIER: OFF.", "The grounding strap hangs loose from the mast leg. A sticker under it: CLIP ME OR THE MAST CLIPS YOU."], [
        { id: "clip-strap", label: "Clip the strap to the mast leg.", condition: { all: [restoring, has(SEATED), lacks(GROUNDED)] }, effects: [{ setFlag: GROUNDED }], next: "tune" },
        go("power-now", "Power it up now.", "ground-fault", { condition: restoring }),
        LEAVE,
      ]),
      node("ground-fault", ["The breaker trips with a bang that echoes down the alley. Nothing burned; the breaker did its job.", "The strap's still hanging there."], [go("retry-ground", "Reset the breaker.", "ground"), LEAVE]),
      node("tune", ["GROUND: OK. CARRIER: STANDBY. Dial: 91.3 / 93.1."], [
        { id: "tune-913", label: "Set the carrier to 91.3.", condition: { all: [restoring, has(GROUNDED), lacks(CARRIER)] }, effects: [{ setFlag: CARRIER }], next: "on-air" },
        go("tune-931", "Set it to 93.1.", "tune-fault", { condition: restoring }),
        LEAVE,
      ]),
      node("tune-fault", ["93.1: a CorpSec traffic band. The cabinet mutes itself before it says a word. Nothing went out.", "The card says 91.3."], [go("retry-tune", "Set the dial again.", "tune"), LEAVE]),
      node("on-air", ["CARRIER: 91.3. ON AIR.", "Somewhere west, Vesper's handset will be playing a clean tone."], [LEAVE]),
    ],
  },
];

export const OFF_THE_DIAL_PACK: ContentPack = {
  id: "off-the-dial",
  npcs: DIAL_NPCS,
  items: ITEMS,
  interactables: INTERACTABLES,
  quests: [quest],
  dialogues: DIALOGUES,
};
