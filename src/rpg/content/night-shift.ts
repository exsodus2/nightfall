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
  greeting: ["City runs on little favors. Big machines just take the credit.", "Tea's inside. Work's out here."],
};

function visit(id: string, venue: keyof typeof NIGHT_SHIFT_VENUES, text: string): Objective {
  const { x, z } = NIGHT_SHIFT_VENUES[venue];
  return { id, kind: "visit", area: `interior:${venue}`, text, target: { x, z } };
}

const borrowedLight: QuestDefinition2 = {
  id: LIGHT_JOB, title: "Borrowed Light", category: "side", giver: NIGHT_SHIFT_GIVER.id,
  summary: "Connect four night businesses to keep the Glasshouse seedlings alive. No gun required. A little legwork, a little borrowed power.",
  rewardHint: "220 cr, 180 XP, +8 City reputation", recommendedLevel: 1, start: "manifest",
  stages: [
    {
      id: "manifest", journal: "Step inside Blue Hour Tea for the shift manifest. Look for the OPEN doorway beside Mira. Press E to enter; T lists all six venues under Step inside.",
      objectives: [visit("tea-manifest", "blue-hour", "Enter Blue Hour Tea for the manifest")],
      onComplete: [{ message: "Blue Hour: The host slips you a repair chit. 'A grow-light coil. Second Life saved us one.'", tone: "quest" }],
      next: "salvage",
    },
    {
      id: "salvage", journal: "Second Life Salvage in the Spillway has a donor coil. Hand over the repair chit inside. Walk, drive, take the metro, or use T to find the doorway; arriving outside is not enough.",
      objectives: [visit("donor-coil", "second-life", "Collect the reserved coil inside Second Life Salvage")],
      onComplete: [{ message: "Second Life: A mechanic finds your coil beneath a dead kettle. 'Kiln Nine can wake it up.'", tone: "quest" }],
      next: "repair",
    },
    {
      id: "repair", journal: "Carry the donor coil into Kiln Nine in the Foundry. Their night mechanic offered one free repair, provided nobody calls it charity.",
      objectives: [visit("rewound-coil", "kiln", "Bring the coil to the mechanic inside Kiln Nine")],
      onComplete: [{ message: "Kiln Nine: Three turns of copper, one clean spark. 'Good for another winter. Don't tell the kettle.'", tone: "quest" }],
      next: "glasshouse",
    },
    {
      id: "glasshouse", journal: "The repaired coil belongs at the Glasshouse, on the Rain Gardens edge. Take it inside; the grower is waiting to bring the lamps back up.",
      objectives: [visit("warm-seedlings", "glasshouse", "Deliver the repaired coil inside the Glasshouse")],
      onComplete: [
        { setFlag: "night-shift.grow-lights", value: true },
        { message: "Glasshouse: Warm light reaches the seedlings. The grower presses a leaf into your manifest: PAID IN KIND.", tone: "quest" },
      ],
      next: "report",
    },
    {
      id: "report", journal: "The seedlings are warm again. Find Mira Bell outside Blue Hour Tea and settle the shift.",
      objectives: [{ id: "shift-report", kind: "choose", text: "Tell Mira the grow lights are running", dialogue: "ns.mira-light", options: ["report"] }],
      onComplete: [{ outcome: "lit" }],
    },
  ],
  outcomes: {
    lit: {
      title: "One More Winter", journal: "A tea host, a salvager, a mechanic, a grower, and you kept a patch of the city alive. Mira has a use for that kind of network.",
      effects: [{ credits: 220 }, { xp: 180 }, { rep: "civilian", by: 8 }],
    },
  },
};

const smallHoursSignal: QuestDefinition2 = {
  id: SIGNAL_JOB, title: "Small Hours Signal", category: "side", giver: NIGHT_SHIFT_GIVER.id,
  summary: "Turn the night shift's loose favors into a working radio channel. Who gets to listen is your call.",
  requires: { quest: LIGHT_JOB }, rewardHint: "180-300 cr, 220 XP, reputation depends on the channel", recommendedLevel: 1, start: "soundcheck",
  stages: [
    {
      id: "soundcheck", journal: "Undertone can cut a clean station ident. Meet its sound engineer inside the listening bar in Neon Ward. Mira has already called ahead.",
      objectives: [visit("station-ident", "undertone", "Collect the station ident inside Undertone")],
      onComplete: [{ message: "Undertone: Four notes, then a warm voice: 'Still here. Still listening.' The engineer hands over the recording.", tone: "quest" }],
      next: "relay",
    },
    {
      id: "relay", journal: "Dead Letter Exchange in the Ghost Circuit has room for one more signal. Take the ident inside and get a channel allocation.",
      objectives: [visit("channel-allocation", "dead-letter", "Route the recording through Dead Letter Exchange")],
      onComplete: [{ message: "Dead Letter: Two frequencies are clear. One is open to everyone; the other pays for licensed dispatch traffic.", tone: "quest" }],
      next: "handoff",
    },
    {
      id: "handoff", journal: "Bring the allocation inside Blue Hour Tea. The host will put the receiver by the kettle while you and Mira decide who the channel is for.",
      objectives: [visit("tea-receiver", "blue-hour", "Bring the receiver online inside Blue Hour Tea")],
      onComplete: [{ message: "Blue Hour: The receiver warms up beside the kettle. Mira is outside, waiting for your decision.", tone: "quest" }],
      next: "choose-channel",
    },
    {
      id: "choose-channel", journal: "Mira can keep the channel open for neighborhood requests, or license it to the overnight dispatch service. The open channel builds trust; dispatch pays more and answers to CorpSec.",
      objectives: [{ id: "channel", kind: "choose", text: "Choose a channel with Mira outside Blue Hour Tea", dialogue: "ns.mira-signal", options: ["public", "dispatch"] }],
      next: [{ if: { flag: "small-hours-signal.channel", is: "public" }, stage: "open-channel" }, { stage: "dispatch-channel" }],
    },
    ending("open-channel", "An open frequency for anyone who needs a hand.", "public"),
    ending("dispatch-channel", "A licensed frequency for the overnight drivers.", "dispatch"),
  ],
  outcomes: {
    public: {
      title: "Still Listening", journal: "The channel is open: lost keys, spare fuses, someone who needs a ride. Ghost relays keep the logs off the corporate grid. The shift fund paid what it could.",
      effects: [{ credits: 180 }, { xp: 220 }, { rep: "civilian", by: 10 }, { rep: "ghosts", by: 4 }, { setFlag: "night-shift.channel", value: "public" }],
    },
    dispatch: {
      title: "On the Clock", journal: "The channel carries verified overnight dispatch. Drivers get coordinated pickups and the shift gets paid, but CorpSec keeps the frequency logs. Mira's kettle stays on either way.",
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
        "The Glasshouse grow lights went out. The seedlings don't have savings, so we're passing the hat.",
        "Blue Hour has the manifest. Second Life has a coil. Kiln Nine can fix it. Then the Glasshouse. No fighting, no deadline. Two-twenty when you're back.",
      ], [
        { id: "accept-light", label: "I'll make the rounds. (220 cr)", condition: available(LIGHT_JOB), effects: [{ startQuest: LIGHT_JOB }], next: "accepted" },
        bye("Not this shift.", "decline"),
      ]),
      node("accepted", [
        "Start through that OPEN door. The tea host knows you're coming.",
        "Take any route you like. T has the metro and the venue list; E gets you through their doors. J keeps the shift notes.",
      ], [LEAVE]),
      node("working", ["Follow the shift notes. Step inside each place; shouting through the window doesn't count.", "I'm not going anywhere. Somebody has to mind the rain."], [LEAVE]),
      node("report", ["That leaf in the manifest. The grower only does that when things are looking up.", "Are the lamps running?"], [
        { id: "report", label: "Warm seedlings. One more winter. (+220 cr)", condition: inStage(LIGHT_JOB, "report"), kind: "complete", next: "paid" },
        LEAVE,
      ]),
      node("paid", ["Then here's your share. Four businesses, one working circuit. That's a city, when it's doing its job.", "I've got an idea for keeping them talking. Ask when you're ready for another round."], [LEAVE]),
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
        "Last job needed four favors and a courier. Next time, I'd rather we could just call each other.",
        "Undertone can make an ident. Dead Letter has a relay. Bring it back to the tea house, and we'll decide whose voices get through.",
      ], [
        { id: "accept-signal", label: "Let's get the night shift talking.", condition: available(SIGNAL_JOB), effects: [{ startQuest: SIGNAL_JOB }], next: "accepted" },
        bye("Let me finish my tea.", "decline"),
      ]),
      node("accepted", ["Undertone first, then Dead Letter, then inside Blue Hour.", "No rush. A signal's only useful if somebody is still there to hear it."], [LEAVE]),
      node("working", ["Undertone makes it sound human. Dead Letter makes it travel. Blue Hour gives it somewhere to land.", "Your journal has the next stop."], [LEAVE]),
      node("channel", [
        "We have one receiver and two offers. Open neighborhood radio: anybody can ask for help. The shift fund can spare 180.",
        "Or licensed dispatch. Drivers get reliable pickups, we get 300, CorpSec gets the traffic logs. Less noise. Less privacy.",
        "You carried it. Which city do we put on the air?",
      ], [
        { id: "public", label: "Keep it public. (+180 cr; +10 City, +4 Ghosts)", condition: inStage(SIGNAL_JOB, "choose-channel"), kind: "complete", next: "public" },
        { id: "dispatch", label: "License dispatch. (+300 cr; +2 City, +6 CorpSec)", condition: inStage(SIGNAL_JOB, "choose-channel"), kind: "complete", next: "dispatch" },
        bye("I need to think."),
      ]),
      node("public", ["[Four notes drift out of the tea house. A voice asks if anyone has a spare fuse.]", "We do, actually. Funny how that works."], [LEAVE]),
      node("dispatch", ["[Four notes, then a driver checking in for the overnight shift.]", "One less person driving blind. I'll keep a paper list for the people without a license."], [LEAVE]),
      node("after-public", ["Someone called in a lost cat. Someone else called in a found cat. Different cats.", "Still. They're talking."], [LEAVE]),
      node("after-dispatch", ["Dispatch is busy. Drivers are getting home on time.", "I keep the tea-house door open for the calls the licensed channel won't take."], [LEAVE]),
    ],
  },
];

export const NIGHT_SHIFT_PACK: ContentPack = {
  id: "night-shift",
  npcs: [NIGHT_SHIFT_GIVER],
  quests: [borrowedLight, smallHoursSignal],
  dialogues,
};
