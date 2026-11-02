// Pack "rim-line": work along the Rim Line, the amber monorail that circles the city edge at
// x, z = +-768. Trains run one way only, clockwise seen from above: Neon Breakwater, Signal Pier,
// Spillway Locks, Low Tide Gate, Silk Harbour, Gardens Rim, Floodgate, Foundry Gate. Every
// direction a character gives follows that order (world.ts STATION_SITES).
//
// Quests:
//  - Brine Run (Salt, Silk Harbour): a crate of water membranes from the harbour crane yard to
//    Agnes Pell at Spillway Locks; Pell can pay cheap or dear, and the Spillway's water price follows.
//  - Mast Tap (Wick, Signal Pier): tap the Meridian harbour mast in the north-east yard, hold the
//    yard while it copies, then decide who hears CorpSec's harbour calls.
//  - The Floodgate Lift (Odile Fenn, Silk Harbour): find the engineer who went to fix Floodgate's
//    lift feed, and decide whether his stationmaster hears the whole story.
// World flags: rim.still ("cheap" | "dear"), rim.mast ("ghost" | "open" | "dark"),
// rim.hollis ("covered" | "reported").
//
// Every position here is checked walkable by tests/content-rim-park-foundry.test.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, DialogueOptionDef, EncounterDefinition, EnemyArchetype, InteractableDefinition, ItemDefinition, LootTable, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, available, bye, ending, flagIs, inStage, look, member, node } from "./helpers.ts";

const BRINE = "brine-run";
const MAST = "mast-tap";
const LIFT = "floodgate-lift";

const SKIN = { pale: [214, 188, 164], tan: [182, 140, 108], brown: [128, 92, 70], deep: [92, 64, 50] } as const;

/** Where things stand on the rim (each is on clear ground; the content test proves it). */
export const RIM_SPOTS = {
  craneCrate: { x: 730, z: 742 },
  craneYard: { x: 736, z: 722 },
  mastBox: { x: 736, z: -731 },
  mastYard: { x: 736, z: -724 },
  liftPanel: { x: -754, z: 20 },
  culvert: { x: -746, z: 64 },
  hollis: { x: -756, z: 72 },
} as const;

// ---- People ------------------------------------------------------------------------------------

export const RIM_NPCS: readonly NpcDefinition[] = [
  {
    id: "odile", name: "Odile Fenn", title: "Rim Line stationmaster", district: 4, x: 16, z: 748, facing: FACE.north,
    look: look([40, 52, 86], [196, 160, 80], SKIN.brown, [255, 196, 90], "cap", "lantern", "scan"),
    greeting: [
      "Silk Harbour, Rim Line, amber platform. Trains run one way round: clockwise.",
      "Gardens Rim is next, then Floodgate. If you want the Locks, that's six stops on, or a long walk east and north. The lift is behind me.",
    ],
  },
  {
    id: "salt", name: "Marisol 'Salt' Duarte", title: "Quay runner", district: 4, x: -20, z: 746, facing: FACE.north,
    look: look([60, 120, 130], [24, 44, 50], SKIN.tan, [120, 230, 255], "cap", "case", "swing"),
    greeting: [
      "Everything on this table fell off a boat, love. I just help it land.",
      "Kelp, rivets, boat hooks and a hood that reads hulls. No refunds, the sea doesn't do refunds.",
    ],
  },
  {
    id: "pell", name: "Agnes Pell", title: "Lockkeeper", district: 5, x: 748, z: -8.5, facing: FACE.west,
    look: look([54, 66, 52], [24, 28, 22], SKIN.pale, [200, 230, 160], "hood", "umbrella", "breathe"),
    greeting: [
      "Thirty years on these gates. The sea has tried to come in nine times. It got in twice.",
      "If you're here about water, keep your voice down. If you're here about the gates, speak up, I'm deaf in the left ear.",
    ],
  },
  {
    id: "wick", name: "Wick", title: "Ghost rigger", district: 2, x: 652, z: -748, facing: FACE.south,
    look: look([30, 34, 44], [10, 12, 18], SKIN.deep, [140, 200, 255], "hood", "antenna", "scan"),
    greeting: [
      "mast in the corner yard is humming on seven-nine tonight.",
      "somebody's talking on it who shouldn't be. not my problem yet.",
    ],
  },
];

// ---- Items: what the jobs hand you -------------------------------------------------------------

const ITEMS: readonly ItemDefinition[] = [
  { id: "membrane-crate", name: "Membrane Crate", kind: "quest", rarity: "uncommon", glyph: "=", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "A sea-crate of desalination membranes, Meridian stencils sanded off. Salt's knots hold the lid shut, badly." },
];

// ---- Enemies: the Razorbacks' tide crews and copper strippers -----------------------------------

const TIDE_BARKS = {
  alert: ["THAT'S OUR CRATE.", "TIDE'S IN, MATE.", "HOOK HIM!"],
  hurt: ["SALT IN IT!", "ME GOOD HOOK!"],
  death: ["...back to the sea...", "...ugh"],
} as const;

const ARCHETYPES: readonly EnemyArchetype[] = [
  {
    id: "rim-tide-hand", name: "Tide hand", faction: "razorbacks", health: 62, armor: 0.05, speed: { walk: 1.6, run: 5.2 },
    weapon: "underscore", reaction: 0.7, aggression: 0.7, perception: { sight: 34, fovDegrees: 120, hearing: 30 },
    look: look([70, 96, 100], [30, 40, 44], SKIN.tan, [255, 120, 80], "cap", null, "swing"),
    loot: "rim-tide", xp: 28, tags: ["razorback", "gang", "rim"], barks: TIDE_BARKS,
  },
  {
    id: "rim-lock-breaker", name: "Lock breaker", faction: "razorbacks", health: 150, armor: 0.16, speed: { walk: 1.3, run: 4.2 },
    weapon: "carriage-return", reaction: 0.8, aggression: 0.9, perception: { sight: 30, fovDegrees: 100, hearing: 30 }, scale: 1.2,
    look: look([110, 80, 50], [40, 28, 18], SKIN.deep, [255, 150, 60], "hood", null, "breathe"),
    loot: "rim-tide-heavy", xp: 64, tags: ["razorback", "gang", "heavy", "rim"],
    barks: { alert: ["COPPER'S MINE.", "OFF THE ROAD."], hurt: ["THAT'LL RUST."], death: ["...should've stayed in the Spillway..."] },
  },
];

const LOOT: readonly LootTable[] = [
  {
    id: "rim-tide", rolls: 1, empty: 0.55, also: ["street-thug"],
    entries: [{ item: "harbour-kelp", weight: 6 }, { item: "pylon-insulator", weight: 4 }, { item: "river-glass", weight: 4, min: 1, max: 3 }, { item: "underscore", weight: 1.5 }, { item: "full-stop", weight: 0.5 }],
  },
  {
    id: "rim-tide-heavy", rolls: 1, empty: 0.4, also: ["gang-lieutenant"],
    entries: [{ item: "carriage-return", weight: 2 }, { item: "pylon-insulator", weight: 4, min: 1, max: 3 }, { item: "port-scanner", weight: 1 }, { item: "flood-wall", weight: 0.4 }],
  },
];

const ENCOUNTERS: readonly EncounterDefinition[] = [
  {
    id: "rim-tide-crew", label: "Razorback tide crew (harbour crane yard)", area: area(RIM_SPOTS.craneYard.x, RIM_SPOTS.craneYard.z, 16), hostile: true,
    members: [member("rim-tide-hand", 726, 716, FACE.south), member("rim-tide-hand", 746, 716, FACE.south), member("rim-lock-breaker", 736, 708, FACE.south)],
  },
  {
    id: "rim-mast-detail", label: "CorpSec maintenance detail (harbour mast)", area: area(RIM_SPOTS.mastYard.x, RIM_SPOTS.mastYard.z, 18), hostile: true,
    members: [member("corp-trooper", 726, -720, FACE.north), member("corp-trooper", 746, -720, FACE.north), member("corp-handler", 736, -714, FACE.north)],
  },
  {
    id: "rim-culvert-crew", label: "Copper strippers (Floodgate culvert)", area: area(RIM_SPOTS.culvert.x, RIM_SPOTS.culvert.z, 12), hostile: true,
    members: [member("rim-tide-hand", -750, 60, FACE.east), member("rim-tide-hand", -736, 68, FACE.west), member("rim-lock-breaker", -742, 70, FACE.north)],
  },
];

// ---- Objects -----------------------------------------------------------------------------------

/** Salvage spots along the rim: one-time pickups that make the long road worth walking. */
const CACHES: readonly InteractableDefinition[] = [
  {
    id: "rim-cache-breakwater", label: "Salvage net on the flood rail", x: -28, z: -752, glyph: "#", once: true,
    effects: [{ give: "pylon-insulator", count: 3 }, { give: "harbour-kelp", count: 2 }, { message: "A fisher's net hung on the Neon Breakwater flood rail: three pylon insulators and some kelp someone forgot.", tone: "loot" }],
  },
  {
    id: "rim-cache-lowtide", label: "Rusted crew locker", x: 748, z: 628, glyph: "#", once: true,
    effects: [{ give: "ammo-pistol", count: 20 }, { give: "sealant-spray", count: 2 }, { give: "harbour-kelp", count: 2 }, { message: "The Low Tide Gate crew locker pops open with a kick: rounds, sealant and lunch.", tone: "loot" }],
  },
  {
    id: "rim-cache-tank", label: "Pump-house shelf (water tower yard)", x: -736, z: 748, glyph: "#", once: true,
    effects: [{ give: "moss-poultice", count: 2 }, { give: "pylon-insulator", count: 2 }, { message: "Under the water tower, a pump-house shelf: two moss poultices in a tin and spare insulators.", tone: "loot" }],
  },
  {
    id: "rim-cache-stack", label: "Stoker's tin (furnace stack yard)", x: -750, z: -750, glyph: "#", once: true,
    effects: [{ give: "kiln-coffee", count: 3 }, { give: "foundry-slag", count: 3 }, { message: "A stoker's tin at the foot of the furnace stack: three flasks of Kiln coffee, still warm, and a fistful of slag.", tone: "loot" }],
  },
];

const INTERACTABLES: readonly InteractableDefinition[] = [
  {
    id: "rim-crate", label: "Salt's crate", ...RIM_SPOTS.craneCrate, glyph: "=", once: true,
    condition: inStage(BRINE, "crane-yard"),
    effects: [{ give: "membrane-crate" }, { message: "You shoulder the crate. It is heavier than Salt said, which is what Salt always says.", tone: "quest" }],
  },
  {
    id: "rim-mast-box", label: "Mast junction box", ...RIM_SPOTS.mastBox, glyph: "%",
    condition: inStage(MAST, "climb"),
    effects: [{ message: "You clip Wick's tap inside the junction box. A green lamp blinks: copying.", tone: "quest" }],
  },
  {
    id: "rim-mast-feed", label: "Wick's tap (mast junction box)", ...RIM_SPOTS.mastBox, glyph: "%",
    condition: inStage(MAST, "route"), dialogue: "rim.mast-feed",
  },
  {
    id: "rim-lift-panel", label: "Floodgate lift service panel", ...RIM_SPOTS.liftPanel, glyph: "?",
    condition: inStage(LIFT, "panel"),
    effects: [{ message: "Service log, H. KEMP: 'Feed cut at the culvert hatch, Rim Road and first cross street south. Going down to look. Back in 20.' Logged two days ago.", tone: "quest" }],
  },
  {
    id: "rim-hollis", label: "Hollis Kemp (tied to the railing)", ...RIM_SPOTS.hollis, glyph: "@",
    condition: inStage(LIFT, "hollis"), dialogue: "rim.hollis",
  },
  ...CACHES,
];

// ---- Quests ------------------------------------------------------------------------------------

const brineRun: QuestDefinition2 = {
  id: BRINE, title: "Brine Run", category: "side", giver: "salt",
  summary: "Carry Salt's crate of water membranes from the harbour crane yard to Agnes Pell at Spillway Locks, then settle the price.",
  rewardHint: "100-240 cr, 260 XP; Pell may pay in kind", recommendedLevel: 3, start: "crane-yard",
  stages: [
    {
      id: "crane-yard",
      journal: "Salt's crate is under the harbour crane in the south-east corner yard, where the quay road turns north. From Silk Harbour, walk or drive east along the quay; the crane is the only thing taller than the lamps.",
      onEnter: [{ waypoint: { ...RIM_SPOTS.craneCrate, label: "Salt's crate (harbour crane yard)" } }],
      objectives: [{ id: "crate", kind: "interact", object: "rim-crate", text: "Pick up Salt's crate under the harbour crane (south-east yard)" }],
      onComplete: [{ spawn: "rim-tide-crew" }, { message: "Boots on gravel behind the crane. A Razorback tide crew followed the crate here.", tone: "danger" }],
      next: "jacked",
    },
    {
      id: "jacked",
      journal: "A Razorback tide crew wants the crate: two boat hooks and a lock breaker, between you and the road north. Put them down before you move.",
      objectives: [{ id: "crew", kind: "clear", encounter: "rim-tide-crew", text: "Drive off the tide crew in the crane yard" }],
      next: "locks",
    },
    {
      id: "locks",
      journal: "Agnes Pell keeps the lock gates at Spillway Locks, halfway up the east Rim Road. She runs the Spillway's water still and is buying the membranes. Hand over the crate and settle the price with her.",
      onEnter: [{ waypoint: { x: 748, z: -8.5, label: "Agnes Pell (Spillway Locks)" } }],
      objectives: [{ id: "price", kind: "choose", text: "Hand the crate to Agnes Pell at Spillway Locks and settle the price", dialogue: "rim.pell-brine", options: ["cheap", "dear"] }],
      next: "report",
    },
    {
      id: "report",
      journal: "The membranes are at the Locks. Salt is at Silk Harbour waiting for her money: ride the Rim Line two stops clockwise from Spillway Locks (Low Tide Gate, then Silk Harbour).",
      objectives: [{ id: "paid", kind: "choose", text: "Collect your fee from Salt at Silk Harbour", dialogue: "rim.salt-brine", options: ["collect-cheap", "collect-dear"] }],
      next: [{ if: flagIs("brine-run.price", "cheap"), stage: "end-cheap" }, { stage: "end-dear" }],
    },
    ending("end-cheap", "Pell paid what she could and the rest in oilskin.", "cheap"),
    ending("end-dear", "Pell paid full price.", "dear"),
  ],
  outcomes: {
    cheap: {
      title: "Water at Cost", journal: "Pell's still runs on new membranes and a litre of clean water still costs one credit in the Spillway. Salt took a short cut of the money; you took Pell's old oilskin.",
      effects: [{ credits: 100 }, { xp: 260 }, { rep: "civilian", by: 8 }, { setFlag: "rim.still", value: "cheap" }],
    },
    dear: {
      title: "Market Rate", journal: "Pell paid two hundred and forty and put half a credit on every litre to cover it. Salt paid you in full and asked when you're free next.",
      effects: [{ credits: 240 }, { xp: 260 }, { rep: "civilian", by: -3 }, { setFlag: "rim.still", value: "dear" }],
    },
  },
};

const mastTap: QuestDefinition2 = {
  id: MAST, title: "Mast Tap", category: "contract", giver: "wick",
  summary: "Clip a Ghost tap onto the Meridian harbour mast in the north-east yard, hold the yard while it copies the key, then decide who gets to listen.",
  rewardHint: "150-320 cr, 450 XP, reputation depends on who listens", recommendedLevel: 6, start: "climb",
  stages: [
    {
      id: "climb",
      journal: "The Meridian harbour mast stands in the north-east corner yard, about a hundred metres east of Signal Pier along the Rim Road. Clip Wick's tap inside the junction box at its foot.",
      onEnter: [{ waypoint: { ...RIM_SPOTS.mastBox, label: "Harbour mast junction box" } }],
      objectives: [{ id: "clip", kind: "interact", object: "rim-mast-box", text: "Clip the tap onto the mast junction box (north-east yard)" }],
      onComplete: [{ spawn: "rim-mast-detail" }, { message: "The junction box chirps twice. Out on the Rim Road, a CorpSec van door slides open.", tone: "danger" }],
      next: "hold",
    },
    {
      id: "hold",
      journal: "The tap needs forty seconds inside the yard to copy the mast key, and a CorpSec maintenance detail is walking in to check the alarm. Stay in the yard until it finishes, or put the detail down.",
      mode: "any",
      objectives: [
        { id: "sync", kind: "survive", seconds: 40, area: area(RIM_SPOTS.mastYard.x, RIM_SPOTS.mastYard.z, 20, "Harbour mast yard"), text: "Stay in the mast yard while the tap copies (40 s)" },
        { id: "detail", kind: "clear", encounter: "rim-mast-detail", text: "Or drive off the CorpSec detail" },
      ],
      next: "route",
    },
    {
      id: "route",
      journal: "The tap holds the mast key: every CorpSec boat and van on the rim talks through this mast. At the junction box, decide where the copy goes.",
      objectives: [{ id: "feed", kind: "choose", text: "Decide at the junction box who hears the mast", dialogue: "rim.mast-feed", options: ["wick", "open", "dark"], target: RIM_SPOTS.mastBox }],
      next: "report",
    },
    {
      id: "report",
      journal: "Walk back west along the Rim Road to Wick at Signal Pier and tell him where the feed went.",
      objectives: [{ id: "told", kind: "choose", text: "Tell Wick at Signal Pier where the mast feed went", dialogue: "rim.wick-mast", options: ["report-wick", "report-open", "report-dark"] }],
      next: [{ if: flagIs("mast-tap.feed", "wick"), stage: "end-ghost" }, { if: flagIs("mast-tap.feed", "open"), stage: "end-open" }, { stage: "end-dark" }],
    },
    ending("end-ghost", "The Ghosts hear the harbour.", "ghost"),
    ending("end-open", "Everyone on the night channel hears the harbour.", "open"),
    ending("end-dark", "Nobody hears the harbour.", "dark"),
  ],
  outcomes: {
    ghost: {
      title: "Ears on the Harbour", journal: "Wick's people hear every CorpSec harbour call now. Ghost couriers on the rim change routes before the vans arrive.",
      effects: [{ credits: 320 }, { xp: 450 }, { rep: "ghosts", by: 10 }, { rep: "corpsec", by: -6 }, { setFlag: "rim.mast", value: "ghost" }],
    },
    open: {
      title: "Harbour Weather", journal: "The mast feed plays on Mira's open channel at 7.40. Stall keepers hear the raids coming, and so does everyone else. Wick paid less and laughed more than you expected.",
      effects: [{ credits: 220 }, { xp: 450 }, { rep: "civilian", by: 8 }, { rep: "ghosts", by: 4 }, { rep: "corpsec", by: -8 }, { setFlag: "rim.mast", value: "open" }],
    },
    dark: {
      title: "Dead Air", journal: "You pulled the tap and left the mast as you found it. CorpSec logged a false alarm. Wick paid for the walk and not a credit more.",
      effects: [{ credits: 150 }, { xp: 450 }, { rep: "corpsec", by: 3 }, { rep: "ghosts", by: -4 }, { setFlag: "rim.mast", value: "dark" }],
    },
  },
};

const floodgateLift: QuestDefinition2 = {
  id: LIFT, title: "The Floodgate Lift", category: "side", giver: "odile",
  summary: "Floodgate station's lift is running on its battery and the engineer sent to fix the feed has stopped answering. Find him.",
  rewardHint: "200-300 cr, 380 XP and a piece of kit", recommendedLevel: 4, start: "panel",
  stages: [
    {
      id: "panel",
      journal: "Ride the Rim Line two stops clockwise from Silk Harbour (Gardens Rim, then Floodgate). At street level, read the service log on the panel at the foot of Floodgate's lift shaft.",
      onEnter: [{ waypoint: { ...RIM_SPOTS.liftPanel, label: "Floodgate lift service panel" } }],
      objectives: [{ id: "log", kind: "interact", object: "rim-lift-panel", text: "Read the service log on the Floodgate lift panel" }],
      next: "culvert",
    },
    {
      id: "culvert",
      journal: "Hollis Kemp's last log: the lift's copper feed was cut at the culvert hatch where the Rim Road meets the first cross street south of Floodgate, about sixty metres down the road.",
      onEnter: [{ waypoint: { ...RIM_SPOTS.culvert, label: "Culvert hatch (south of Floodgate)" } }],
      objectives: [{ id: "hatch", kind: "reach", text: "Find the culvert hatch south of Floodgate", area: area(RIM_SPOTS.culvert.x, RIM_SPOTS.culvert.z, 12, "Culvert hatch") }],
      onComplete: [{ spawn: "rim-culvert-crew" }, { message: "Three people are hauling cable out of the hatch by the armful. One of them sees you.", tone: "danger" }],
      next: "strippers",
    },
    {
      id: "strippers",
      journal: "A copper crew is pulling the lift feed out of the culvert. Stop them before the battery runs flat.",
      objectives: [{ id: "crew", kind: "clear", encounter: "rim-culvert-crew", text: "Stop the copper strippers at the culvert" }],
      next: "hollis",
    },
    {
      id: "hollis",
      journal: "Hollis Kemp, Odile's missing engineer, is zip-tied to the culvert railing south of Floodgate, alive and very embarrassed. Hear what he has to say.",
      objectives: [{ id: "verdict", kind: "choose", text: "Talk to Hollis Kemp at the culvert railing", dialogue: "rim.hollis", options: ["cover", "truth"], target: RIM_SPOTS.hollis }],
      next: "report",
    },
    {
      id: "report",
      journal: "The feed is safe. Tell Odile Fenn at Silk Harbour what happened: six stops on round the Rim Line, or a taxi with T.",
      objectives: [{ id: "told", kind: "choose", text: "Report to Odile Fenn at Silk Harbour", dialogue: "rim.odile-lift", options: ["report-cover", "report-truth"] }],
      next: [{ if: flagIs("floodgate-lift.verdict", "cover"), stage: "end-cover" }, { stage: "end-truth" }],
    },
    ending("end-cover", "Odile believes Hollis was jumped.", "covered"),
    ending("end-truth", "Odile knows Hollis sold the feed.", "reported"),
  ],
  outcomes: {
    covered: {
      title: "Back on Shift", journal: "Hollis was on shift by midnight and Floodgate's lift had its feed by morning. Odile wrote 'assault' in the log. You and Hollis know better.",
      effects: [{ credits: 200 }, { xp: 380 }, { rep: "civilian", by: 4 }, { setFlag: "rim.hollis", value: "covered" }],
    },
    reported: {
      title: "In the Log", journal: "Odile suspended Hollis, fixed the feed with the day crew and paid you from the station's float. She keeps a lost-property drawer for people who tell her the truth.",
      effects: [{ credits: 300 }, { xp: 380 }, { give: "port-scanner" }, { rep: "civilian", by: 2 }, { setFlag: "rim.hollis", value: "reported" }],
    },
  },
};

// ---- Dialogue ----------------------------------------------------------------------------------

/** A hub option that opens a quest's offer node while the quest is available. */
const job = (quest: string, label: string, dialogue: string): DialogueOptionDef =>
  ({ id: `ask-${quest}`, label, condition: available(quest), hideIfUnavailable: true, kind: "continue", effects: [{ openDialogue: dialogue, node: "offer" }], next: null });

const DIALOGUES: readonly DialogueDefinition[] = [
  // Hubs: small talk and the doors into the jobs. Quest dialogues use conditional entries, so they win.
  {
    id: "hub.salt", npc: "salt",
    entries: [
      { condition: flagIs("rim.still", "cheap"), node: "after-cheap", priority: 3 },
      { condition: flagIs("rim.still", "dear"), node: "after-dear", priority: 3 },
      { node: "hub" },
    ],
    nodes: [
      node("hub", ["Everything on this table fell off a boat, love. I just help it land.", "Got a job too, if your legs work."], [job(BRINE, "What job?", "rim.salt-brine"), LEAVE]),
      node("after-cheap", ["You let Pell talk you down. I heard. The whole quay heard.", "Still, the Spillway kids are drinking clean, and I suppose I'm a soft touch. Buy something."], [LEAVE]),
      node("after-dear", ["Two-forty. You're my favourite person on this quay.", "Pell says the Spillway's grumbling about the price. The Spillway always grumbles."], [LEAVE]),
    ],
  },
  {
    id: "hub.odile", npc: "odile",
    entries: [
      { condition: flagIs("rim.hollis", "covered"), node: "after-covered", priority: 3 },
      { condition: flagIs("rim.hollis", "reported"), node: "after-reported", priority: 3 },
      { node: "hub" },
    ],
    nodes: [
      node("hub", [
        "Silk Harbour, Rim Line, amber platform. Trains run one way round: clockwise.",
        "Gardens Rim next, then Floodgate, Foundry Gate, Neon Breakwater, Signal Pier, Spillway Locks, Low Tide Gate, and back here. Eight stops. Learn them; the signs fall off in the wind.",
      ], [job(LIFT, "You look like you're counting something.", "rim.odile-lift"), LEAVE]),
      node("after-covered", ["Floodgate lift: in service, battery charging. Hollis is back on nights.", "He's been very polite to me since. I don't trust polite."], [LEAVE]),
      node("after-reported", ["Floodgate lift: in service. Hollis Kemp: suspended, pending.", "I liked him. I liked the lift more."], [LEAVE]),
    ],
  },
  {
    id: "hub.pell", npc: "pell",
    entries: [
      { condition: flagIs("rim.still", "cheap"), node: "after-cheap", priority: 3 },
      { condition: flagIs("rim.still", "dear"), node: "after-dear", priority: 3 },
      { node: "hub" },
    ],
    nodes: [
      node("hub", [
        "Thirty years on these gates. The sea has tried to come in nine times. It got in twice.",
        "Meridian sells the Spillway tap water at four credits a litre, and it comes out brown. I sell clean at one, from a still behind the lock house. Don't tell anyone. Everyone knows.",
      ], [LEAVE]),
      node("after-cheap", ["Still's running sweet. One credit a litre, same as last year.", "Keep the oilskin dry. I mean oiled. You know what I mean."], [LEAVE]),
      node("after-dear", ["Still's running. A credit and a half a litre now.", "People pay. They always do. That's the trouble with water."], [LEAVE]),
    ],
  },
  {
    id: "hub.wick", npc: "wick",
    entries: [
      { condition: flagIs("rim.mast", "ghost"), node: "after-ghost", priority: 3 },
      { condition: flagIs("rim.mast", "open"), node: "after-open", priority: 3 },
      { condition: flagIs("rim.mast", "dark"), node: "after-dark", priority: 3 },
      { node: "hub" },
    ],
    nodes: [
      node("hub", ["mast in the corner yard is humming on seven-nine tonight.", "somebody's talking on it who shouldn't be."], [job(MAST, "Who's talking?", "rim.wick-mast"), LEAVE]),
      node("after-ghost", ["three vans tonight. we heard all three coming.", "ping me if you need a route. you're on the good list."], [LEAVE]),
      node("after-open", ["half the market's listening to corpsec read out plate numbers.", "worst-kept secret on the rim. i love it. i hate it."], [LEAVE]),
      node("after-dark", ["mast's quiet. your choice.", "don't expect me to like it."], [LEAVE]),
    ],
  },

  // Brine Run.
  {
    id: "rim.salt-brine", npc: "salt", quest: BRINE,
    entries: [
      { condition: inStage(BRINE, "report"), node: "report", priority: 22 },
      { condition: { quest: BRINE, status: "active" }, node: "working", priority: 18 },
    ],
    nodes: [
      node("offer", [
        "A Meridian tender lost a crate of desalination membranes off the quay last night. Terrible shame. I found it.",
        "It's under the harbour crane in the south-east corner yard, because CorpSec are walking this quay tonight. Agnes Pell at Spillway Locks is buying. You carry it up the east Rim Road, she pays, I pay you.",
        "Razorbacks have been sniffing round the crane. Bring something with an edge.",
      ], [
        { id: "accept-brine", label: "I'll carry it.", condition: available(BRINE), effects: [{ startQuest: BRINE }], next: "accepted" },
        bye("Not tonight, Salt.", "decline"),
      ]),
      node("accepted", ["Crane yard first: east along the quay road, the corner with the crane.", "Then north to the Locks. The train only goes clockwise, so it's six stops round the long way. Most people drive."], [LEAVE]),
      node("working", ["Crate's under the crane, Pell's at the Locks. That's the whole plan. It's a good plan."], [LEAVE]),
      node("report", ["Well? Did Pell pay, or did she do the voice?"], [
        { id: "collect-cheap", label: "She paid what she had, and gave me her oilskin. (+100 cr)", condition: { all: [inStage(BRINE, "report"), flagIs("brine-run.price", "cheap")] }, hideIfUnavailable: true, kind: "complete", next: "paid-cheap" },
        { id: "collect-dear", label: "Full price. (+240 cr)", condition: { all: [inStage(BRINE, "report"), flagIs("brine-run.price", "dear")] }, hideIfUnavailable: true, kind: "complete", next: "paid-dear" },
        LEAVE,
      ]),
      node("paid-cheap", ["She did the voice. Of course she did.", "Here's a hundred. My cut's thinner than her soup. Next time, let me do the talking."], [LEAVE]),
      node("paid-dear", ["Two hundred and forty! Pell's never paid anyone two-forty for anything.", "Your share. Don't spend it on kelp, I sell kelp."], [LEAVE]),
    ],
  },
  {
    id: "rim.pell-brine", npc: "pell", quest: BRINE,
    entries: [
      { condition: inStage(BRINE, "locks"), node: "crate", priority: 20 },
      { condition: { quest: BRINE, status: "active" }, node: "early", priority: 12 },
    ],
    nodes: [
      node("early", ["Salt's crate? It's under the harbour crane, south-east corner. She sends everyone there. Bring it here when you have it."], [LEAVE]),
      node("crate", [
        "That's Salt's crate. I'd know her knots anywhere; they're terrible.",
        "Membranes for the still. Salt wants two hundred and forty. I have a hundred, and the oilskin that's kept me dry on these gates for thirty years. Or I pay the full two-forty and put half a credit on every litre.",
        "You carried it. Your call.",
      ], [
        { id: "cheap", label: "A hundred and the oilskin. Keep the litre at one credit.", condition: { all: [inStage(BRINE, "locks"), { item: "membrane-crate" }] }, reason: "You need Salt's crate", effects: [{ take: "membrane-crate" }, { give: "flood-wall" }], kind: "complete", next: "cheap-done" },
        { id: "dear", label: "Full price. Salt's paying me out of it.", condition: { all: [inStage(BRINE, "locks"), { item: "membrane-crate" }] }, reason: "You need Salt's crate", effects: [{ take: "membrane-crate" }], kind: "complete", next: "dear-done" },
        bye("Let me think about it."),
      ]),
      node("cheap-done", ["[She takes an oilskin coat off the hook by the lock wheel. Riveted plates are sewn into the lining.]", "Old sea-wall plate. Stops a hook better than it stops rain. Tell Salt her hundred's on the way, and her knots are still terrible."], [LEAVE]),
      node("dear-done", ["Two hundred and forty, counted. I'll put it on the bottles. People will pay.", "Salt's waiting at Silk Harbour. Two stops on the train from here."], [LEAVE]),
    ],
  },

  // Mast Tap.
  {
    id: "rim.wick-mast", npc: "wick", quest: MAST,
    entries: [
      { condition: inStage(MAST, "report"), node: "report", priority: 22 },
      { condition: { quest: MAST, status: "active" }, node: "working", priority: 18 },
    ],
    nodes: [
      node("offer", [
        "the mast in the north-east yard is meridian's harbour net. every corpsec boat and van on the rim talks through it.",
        "lately they use it to find our couriers by their handsets. three of ours picked up this month. i want ears on it.",
        "clip goes in the junction box at the foot. it needs forty seconds to copy the key. the box will scream for help when you open it. stay put anyway.",
        "you're not on any corpsec list yet. three-twenty if the copy comes to me.",
      ], [
        { id: "accept-mast", label: "I'll clip it.", condition: available(MAST), effects: [{ startQuest: MAST }], next: "accepted" },
        bye("Not my fight.", "decline"),
      ]),
      node("accepted", ["east along the rim road, a hundred metres. the yard with the lit mast.", "when it's copied, you'll get a choice at the box. i'd like to think you'll pick me."], [LEAVE]),
      node("working", ["mast. box. forty seconds. then talk to me."], [LEAVE]),
      node("report", ["green light came on at my end. where'd the copy go?"], [
        { id: "report-wick", label: "Straight to you.", condition: { all: [inStage(MAST, "report"), flagIs("mast-tap.feed", "wick")] }, hideIfUnavailable: true, kind: "complete", next: "paid-ghost" },
        { id: "report-open", label: "To Mira's open channel. Everyone hears it.", condition: { all: [inStage(MAST, "report"), flagIs("mast-tap.feed", "open")] }, hideIfUnavailable: true, kind: "complete", next: "paid-open" },
        { id: "report-dark", label: "Nowhere. I pulled the clip.", condition: { all: [inStage(MAST, "report"), flagIs("mast-tap.feed", "dark")] }, hideIfUnavailable: true, kind: "complete", next: "paid-dark" },
        LEAVE,
      ]),
      node("paid-ghost", ["clean copy. i can hear a van on the breakwater asking for coffee.", "three-twenty. you're on the good list now."], [LEAVE]),
      node("paid-open", ["you put corpsec on the tea-house radio.", "...that's either the stupidest or the best thing anyone's done with a tap. two-twenty, and i'm still deciding."], [LEAVE]),
      node("paid-dark", ["you walked all that way to switch it off.", "one-fifty for the walk. don't come back for a while."], [LEAVE]),
    ],
  },
  {
    id: "rim.mast-feed", npc: "rim-mast-feed", quest: MAST,
    entries: [{ condition: inStage(MAST, "route"), node: "box" }],
    nodes: [
      node("box", [
        "[The tap's lamp is solid green. A tiny screen offers three routes for the copied key.]",
        "[1: WICK / GHOST RELAY.  2: NIGHT SHIFT 7.40 / OPEN.  3: WIPE AND PULL CLIP.]",
      ], [
        { id: "wick", label: "Route it to Wick's relay. (Ghosts hear CorpSec)", condition: inStage(MAST, "route"), kind: "complete", next: null },
        { id: "open", label: "Mirror it onto the night shift's open channel. (Everyone hears)", condition: { all: [inStage(MAST, "route"), flagIs("night-shift.channel", "public")] }, reason: "Needs Mira Bell's open channel (Small Hours Signal, kept public)", kind: "complete", next: null },
        { id: "dark", label: "Wipe it and pull the clip. (Nobody hears)", condition: inStage(MAST, "route"), kind: "complete", next: null },
        bye("Not yet."),
      ]),
    ],
  },

  // The Floodgate Lift.
  {
    id: "rim.odile-lift", npc: "odile", quest: LIFT,
    entries: [
      { condition: inStage(LIFT, "report"), node: "report", priority: 22 },
      { condition: { quest: LIFT, status: "active" }, node: "working", priority: 18 },
    ],
    nodes: [
      node("offer", [
        "Floodgate lift has been on battery for fifty-one hours. Somebody cut its copper feed. Battery has about eleven left.",
        "I sent Hollis Kemp, my best engineer, to find the fault. He logged in at the panel two days ago and hasn't answered since.",
        "Two stops clockwise. Find Hollis. Find the fault. In that order, please. Two hundred at least from the station float when it's done.",
      ], [
        { id: "accept-lift", label: "I'll find him.", condition: available(LIFT), effects: [{ startQuest: LIFT }], next: "accepted" },
        bye("Can't right now.", "decline"),
      ]),
      node("accepted", ["Gardens Rim, then Floodgate. The service panel is at the foot of the lift shaft.", "Hollis writes everything on that panel. Everything. It's a habit I encouraged."], [LEAVE]),
      node("working", ["Floodgate. Service panel. Hollis.", "The battery is not getting any fuller while we talk."], [LEAVE]),
      node("report", ["You found him. Is he hurt? What happened to my feed?"], [
        { id: "report-cover", label: "A copper crew jumped him. He's fixing the feed now. (+200 cr)", condition: { all: [inStage(LIFT, "report"), flagIs("floodgate-lift.verdict", "cover")] }, hideIfUnavailable: true, kind: "complete", next: "told-cover" },
        { id: "report-truth", label: "He sold them the feed for his kid's clinic bill. They came back for the rest. (+300 cr)", condition: { all: [inStage(LIFT, "report"), flagIs("floodgate-lift.verdict", "truth")] }, hideIfUnavailable: true, kind: "complete", next: "told-truth" },
        LEAVE,
      ]),
      node("told-cover", ["Jumped. On my line. I'll have the depot put a lock on that hatch.", "Two hundred, from the station float. Thank you for bringing him back."], [LEAVE]),
      node("told-truth", ["...Sold it. For a clinic bill.", "I'll suspend him. I'll also find out which clinic, and what it charges.", "Three hundred from the float. And this: a pilot's hood from lost property. It reads hulls. Nobody has claimed it in a year."], [LEAVE]),
    ],
  },
  {
    id: "rim.hollis", npc: "rim-hollis", quest: LIFT,
    entries: [{ condition: inStage(LIFT, "hollis"), node: "tied" }],
    nodes: [
      node("tied", [
        "[A man in a Rim Line tabard, zip-tied to the culvert railing. His tool belt is empty.]",
        "Thank you. Really. Before you call Odile: that crew were my buyers. I sold them a coil of lift feed last month to pay my kid's clinic bill. They came back for the rest without paying, and tied me up when I said no.",
        "If Odile hears that, I'm finished on the Rim. If she hears I got jumped, I'm back on shift tonight and the feed's fixed by morning.",
      ], [
        { id: "cover", label: "Tell her you got jumped. Fix the feed, and never sell another metre.", condition: inStage(LIFT, "hollis"), effects: [{ give: "carriage-return" }], kind: "complete", next: "covered" },
        { id: "truth", label: "She's hearing all of it. You sold her lift.", condition: inStage(LIFT, "hollis"), kind: "complete", next: "truthful" },
        bye("Wait here."),
      ]),
      node("covered", ["I won't. I swear on the lift.", "[He cuts the last tie and presses a hooked track wrench into your hands.] My spare. Takes the corner off anything. Go on, Odile counts minutes."], [LEAVE]),
      node("truthful", ["...Yeah. Fair. She'd have counted the copper anyway.", "Tell her I'll be at the depot with my badge."], [LEAVE]),
    ],
  },
];

/** Salt's stall: harbour salvage. The rim's only vendor sells what washes up on the quay. */
const VENDORS: NonNullable<ContentPack["vendors"]> = [
  { npc: "salt", markup: 1.2, stock: ["harbour-kelp", "sealant-spray", "coolant-can", "stim", "underscore", "full-stop", "carriage-return", "port-scanner", "sandbox-poncho", "flood-wall", "ammo-pistol", "ammo-shell"] },
];

export const RIM_LINE_PACK: ContentPack = {
  id: "rim-line",
  npcs: RIM_NPCS,
  items: ITEMS,
  archetypes: ARCHETYPES,
  loot: LOOT,
  encounters: ENCOUNTERS,
  interactables: INTERACTABLES,
  quests: [brineRun, mastTap, floodgateLift],
  dialogues: DIALOGUES,
  vendors: VENDORS,
};
