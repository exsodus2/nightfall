import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, Objective, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, available, bye, ending, inStage, look, node } from "./helpers.ts";

const LIGHT_JOB = "borrowed-light";
const SIGNAL_JOB = "small-hours-signal";

export const NIGHT_SHIFT_VENUES = {
  kiln: { name: "Kiln Nine", x: -531, z: -247.91 },
  undertone: { name: "Undertone", x: 45, z: -248.54 },
  "dead-letter": { name: "Dead Letter Exchange", x: 429, z: -247.48 },
  glasshouse: { name: "The Glasshouse", x: -595, z: 200.70 },
  "blue-hour": { name: "Blue Hour Tea", x: -45, z: 73.01 },
  "second-life": { name: "Second Life Salvage", x: 429, z: 246.64 },
} as const;

export const NIGHT_SHIFT_GIVER: NpcDefinition = {
  id: "mira", name: "Mira Bell", title: "Night-shift coordinator", district: 4,
  x: -50, z: 73, facing: FACE.north,
  look: look([178, 118, 64], [48, 52, 58], [160, 110, 81], [255, 205, 125], "cap", "lantern", "breathe"),
  greeting: ["I keep the overnight list for six businesses that can't afford a dispatcher. Mostly it's fuses and lifts home.", "Tea's inside. The clipboard stays out here with me."],
};

function visit(id: string, venue: keyof typeof NIGHT_SHIFT_VENUES, text: string): Objective {
  const { x, z } = NIGHT_SHIFT_VENUES[venue];
  return { id, kind: "visit", area: `interior:${venue}`, text, target: { x, z } };
}

const borrowedLight: QuestDefinition2 = {
  id: LIGHT_JOB, title: "Borrowed Light", category: "side", giver: NIGHT_SHIFT_GIVER.id,
  summary: "The Glasshouse grow lights are dead. Carry a repair chit and a donor coil through four night businesses and get the lamps back on.",
  rewardHint: "220 cr, 180 XP, +8 Civilian reputation", recommendedLevel: 1, start: "manifest",
  stages: [
    {
      id: "manifest", journal: "The shift manifest is inside Blue Hour Tea, through the lit OPEN doorway beside Mira. Press E at the door to go in; T > Step inside lists every venue.",
      objectives: [visit("tea-manifest", "blue-hour", "Enter Blue Hour Tea (Silk Market) and pick up the manifest")],
      onComplete: [{ message: "Blue Hour: The host hands you a repair chit. 'Second Life put a grow-light coil aside for us.'", tone: "quest" }],
      next: "salvage",
    },
    {
      id: "salvage", journal: "Second Life Salvage in the Spillway is holding a donor coil against the chit. Go inside to trade; the counter is past the door. Walk, drive or take the metro.",
      objectives: [visit("donor-coil", "second-life", "Enter Second Life Salvage (The Spillway) and collect the donor coil")],
      onComplete: [{ message: "Second Life: The coil was under a dead kettle. 'Windings are shot. Kiln Nine can rewind it.'", tone: "quest" }],
      next: "repair",
    },
    {
      id: "repair", journal: "Take the donor coil into Kiln Nine in the Foundry. Their night mechanic owes Mira one free repair.",
      objectives: [visit("rewound-coil", "kiln", "Enter Kiln Nine (The Foundry) and get the coil rewound")],
      onComplete: [{ message: "Kiln Nine: Fresh copper, one test spark. 'Good for another winter. Tell Mira we're even.'", tone: "quest" }],
      next: "glasshouse",
    },
    {
      id: "glasshouse", journal: "The rewound coil goes to Neri, the grower at the Glasshouse on the west edge of the Rain Gardens. Take it inside.",
      objectives: [visit("warm-seedlings", "glasshouse", "Enter the Glasshouse (Rain Gardens) and deliver the coil")],
      onComplete: [
        { setFlag: "night-shift.grow-lights", value: true },
        { message: "Glasshouse: The lamps hum up to full. Neri, the grower, stamps your manifest PAID IN KIND and tucks a leaf in it.", tone: "quest" },
      ],
      next: "report",
    },
    {
      id: "report", journal: "The grow lights are back on. Mira is outside Blue Hour Tea with your pay.",
      objectives: [{ id: "shift-report", kind: "choose", text: "Tell Mira Bell (outside Blue Hour Tea) the lamps are on", dialogue: "ns.mira-light", options: ["report"] }],
      onComplete: [{ outcome: "lit" }],
    },
  ],
  outcomes: {
    lit: {
      title: "One More Winter", journal: "The Glasshouse seedlings have light again, for the price of one coil and a lot of walking. Mira wants the same four venues on a shared radio channel next.",
      effects: [{ credits: 220 }, { xp: 180 }, { rep: "civilian", by: 8 }],
    },
  },
};

const smallHoursSignal: QuestDefinition2 = {
  id: SIGNAL_JOB, title: "Small Hours Signal", category: "side", giver: NIGHT_SHIFT_GIVER.id,
  summary: "Build the night shift a radio channel: an ident from Undertone, a frequency from Dead Letter, a receiver at Blue Hour. Then decide who it serves.",
  requires: { quest: LIGHT_JOB }, rewardHint: "180-300 cr, 220 XP, reputation depends on the channel", recommendedLevel: 1, start: "soundcheck",
  stages: [
    {
      id: "soundcheck", journal: "Undertone's sound engineer has cut a station ident. Go inside the listening bar in Neon Ward to collect it; Mira called ahead.",
      objectives: [visit("station-ident", "undertone", "Enter Undertone (Neon Ward) and collect the station ident")],
      onComplete: [{ message: "Undertone: Four piano notes and 'Night shift, go ahead.' The engineer hands you the tape.", tone: "quest" }],
      next: "relay",
    },
    {
      id: "relay", journal: "Dead Letter Exchange in the Ghost Circuit has one spare relay slot. Take the ident inside and get a frequency allocated.",
      objectives: [visit("channel-allocation", "dead-letter", "Enter Dead Letter Exchange (Ghost Circuit) and get a frequency")],
      onComplete: [{ message: "Dead Letter: Two frequencies free. 7.40 is open to anyone; 7.45 is licensed for paid dispatch.", tone: "quest" }],
      next: "handoff",
    },
    {
      id: "handoff", journal: "Take the allocation slip inside Blue Hour Tea. The host has a receiver ready to plug in by the kettle.",
      objectives: [visit("tea-receiver", "blue-hour", "Enter Blue Hour Tea (Silk Market) and set up the receiver")],
      onComplete: [{ message: "Blue Hour: The receiver crackles on beside the kettle. Mira is outside waiting for your call.", tone: "quest" }],
      next: "choose-channel",
    },
    {
      id: "choose-channel", journal: "Open channel: anyone can call in, 180 cr from the shift fund. Licensed dispatch: 300 cr, but CorpSec keeps the call logs. Tell Mira which.",
      objectives: [{ id: "channel", kind: "choose", text: "Pick the channel with Mira Bell outside Blue Hour Tea", dialogue: "ns.mira-signal", options: ["public", "dispatch"] }],
      next: [{ if: { flag: "small-hours-signal.channel", is: "public" }, stage: "open-channel" }, { stage: "dispatch-channel" }],
    },
    ending("open-channel", "7.40 is on the air, open to anyone.", "public"),
    ending("dispatch-channel", "7.45 is on the air for licensed dispatch.", "dispatch"),
  ],
  outcomes: {
    public: {
      title: "Open Line", journal: "The open channel carries lost keys, spare fuses and people needing a lift. Dead Letter's relays keep the logs off the corporate grid. The shift fund paid 180.",
      effects: [{ credits: 180 }, { xp: 220 }, { rep: "civilian", by: 10 }, { rep: "ghosts", by: 4 }, { setFlag: "night-shift.channel", value: "public" }],
    },
    dispatch: {
      title: "On the Clock", journal: "The licensed channel carries overnight dispatch. Drivers get coordinated pickups and the shift got 300, and CorpSec gets a copy of every call.",
      effects: [{ credits: 300 }, { xp: 220 }, { rep: "civilian", by: 2 }, { rep: "corpsec", by: 6 }, { setFlag: "night-shift.channel", value: "dispatch" }],
    },
  },
};

const dialogues: readonly DialogueDefinition[] = [
  {
    id: "ns.mira-light", npc: NIGHT_SHIFT_GIVER.id, quest: LIGHT_JOB,
    entries: [
      { condition: inStage(LIGHT_JOB, "report"), node: "report", priority: 12 },
      { condition: { quest: LIGHT_JOB, status: "active" }, node: "working", priority: 10 },
      { condition: available(LIGHT_JOB), node: "offer", priority: 10 },
    ],
    nodes: [
      node("offer", [
        "The Glasshouse grow lights blew a coil on Tuesday. Two hundred seedlings, three days of reserve battery. We're passing the hat.",
        "Manifest from Blue Hour, coil from Second Life, rewind at Kiln Nine, then the Glasshouse. Nobody's shooting at anybody. Two-twenty when you're back.",
      ], [
        { id: "accept-light", label: "I'll make the rounds. (220 cr)", condition: available(LIGHT_JOB), effects: [{ startQuest: LIGHT_JOB }], next: "accepted" },
        bye("Not this shift.", "decline"),
      ]),
      node("accepted", [
        "Blue Hour first. That OPEN door behind me. The host knows your face now.",
        "T has the metro and the venue list. E gets you through a door. J if you forget the order.",
      ], [LEAVE]),
      node("working", ["Check your notes, J. Each stop means going inside; nobody hands coils out the window.", "I'll be here. I'm always here."], [LEAVE]),
      node("report", ["Is that a leaf in my manifest? Neri only does that when the lamps come on.", "Are they running?"], [
        { id: "report", label: "Lamps on, seedlings warm. (+220 cr)", condition: inStage(LIGHT_JOB, "report"), kind: "complete", next: "paid" },
        LEAVE,
      ]),
      node("paid", ["Two-twenty, counted twice. The salvager wants the kettle back, by the way. I said no.", "Next problem: those four places only talk when someone walks between them. I want them on a radio. Ask when you've slept."], [LEAVE]),
    ],
  },
  {
    id: "ns.mira-signal", npc: NIGHT_SHIFT_GIVER.id, quest: SIGNAL_JOB,
    entries: [
      { condition: inStage(SIGNAL_JOB, "choose-channel"), node: "channel", priority: 30 },
      { condition: { quest: SIGNAL_JOB, status: "active" }, node: "working", priority: 20 },
      { condition: available(SIGNAL_JOB), node: "offer", priority: 15 },
      { condition: { quest: SIGNAL_JOB, outcome: "public" }, node: "after-public", priority: 4 },
      { condition: { quest: SIGNAL_JOB, outcome: "dispatch" }, node: "after-dispatch", priority: 4 },
    ],
    nodes: [
      node("offer", [
        "Last job took four venues and one courier with sore feet. I'd rather they could just call each other.",
        "Undertone records an ident, Dead Letter finds us a frequency, Blue Hour gets the receiver. Then we decide who's allowed on it.",
      ], [
        { id: "accept-signal", label: "I'll set up the channel.", condition: available(SIGNAL_JOB), effects: [{ startQuest: SIGNAL_JOB }], next: "accepted" },
        bye("Let me finish my tea.", "decline"),
      ]),
      node("accepted", ["Undertone in Neon Ward first, then Dead Letter on the Ghost Circuit, then back inside Blue Hour.", "No deadline. The receiver's been in a box since spring."], [LEAVE]),
      node("working", ["Ident from Undertone, frequency from Dead Letter, receiver at Blue Hour. In that order.", "J has the next stop."], [LEAVE]),
      node("channel", [
        "Two offers on one receiver. Open channel: anyone calls in for a fuse or a lift. The shift fund can spare 180.",
        "Licensed dispatch: drivers get proper pickups and we get 300, but CorpSec keeps the call logs.",
        "You did the walking. Which one goes on the air?",
      ], [
        { id: "public", label: "Keep it public. (+180 cr; +10 Civilians, +4 Ghosts)", condition: inStage(SIGNAL_JOB, "choose-channel"), kind: "complete", next: "public" },
        { id: "dispatch", label: "License dispatch. (+300 cr; +2 Civilians, +6 CorpSec)", condition: inStage(SIGNAL_JOB, "choose-channel"), kind: "complete", next: "dispatch" },
        bye("I need to think."),
      ]),
      node("public", ["[Four piano notes from the tea house. Then a voice: anyone got a 5-amp fuse on Silk Market?]", "We do, actually. Second drawer. Go on, call him back."], [LEAVE]),
      node("dispatch", ["[Four piano notes, then a driver: 'Unit nine, clear for the Spillway run.']", "Drivers will get home on time. I'll keep a paper list for the calls they won't take."], [LEAVE]),
      node("after-public", ["Someone called in a lost cat. Someone else called in a found cat. Different cats.", "Both of them got collected. I'm counting it."], [LEAVE]),
      node("after-dispatch", ["Drivers are getting home on time. Nine units on the board tonight.", "The tea-house door stays open for the calls the licensed channel won't take."], [LEAVE]),
    ],
  },
];

export const NIGHT_SHIFT_PACK: ContentPack = {
  id: "night-shift",
  npcs: [NIGHT_SHIFT_GIVER],
  quests: [borrowedLight, smallHoursSignal],
  dialogues,
};
