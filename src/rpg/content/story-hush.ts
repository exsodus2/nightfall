// Pack "hush": the main storyline, four quests from the Silk Market to Rootwood Park.
//
// Someone is pulling voices out of the city. Mara's relay chip (the legacy "relay-chip" quest)
// held an index of forty voiceprints, and the people on it are going silent. The trail runs from
// taps on Silk Market street lamps (Dead Air), through the Chrome Saints' Signal Cathedral uplink
// (The Signal Cathedral), to a burned-out Foundry workshop and the seed keeper (Root Access), and
// ends under The Last Tree, where Vesper Kade - once Meridian's emergency-broadcast engineer -
// conducts a choir of stolen voices through the roots (The Hollow Choir, boss fight).
//
// World flags this pack sets for everyone else:
//   hush.ending  "restored" | "kept"   (post-game greetings across the cast)
//   hush.vesper  "spared" | "dead"
//   hush.seed-sold  true               (sold the seed to Mara)

import type { ContentPack, DialogueDefinition, EncounterDefinition, EnemyArchetype, InteractableDefinition, ItemDefinition, LootTable, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, active, area, available, bye, completed, ending, go, inStage, look, member, node } from "./helpers.ts";
import { ARENA, arenaPoint } from "./places.ts";

/** Splits a String.raw art block into rows (drops blank edge rows and trailing spaces / CRs). */
const art = (block: string): readonly string[] => {
  const rows = block.split("\n").map(row => row.replace(/\s+$/, ""));
  while (rows.length && rows[0] === "") rows.shift();
  while (rows.length && rows[rows.length - 1] === "") rows.pop();
  return rows;
};

// ---- Items -----------------------------------------------------------------------------------

const items: ItemDefinition[] = [
  {
    id: "bell-character", name: "Bell Character", kind: "melee", rarity: "legendary", glyph: "7", value: 12000, weight: 5, stack: 1,
    description: "ASCII 0x07: the character that makes the terminal ring. Kade's conductor's bell, cast into a hammer. Every hit rings like a fire alarm in a library.",
    weapon: { class: "blunt", damage: 78, range: 3.0, cooldown: 0.68, staminaCost: 16, heavyMultiplier: 2.6, arc: 100, knockback: 3.4, stagger: 1.2, critChance: 0.12, critMultiplier: 2.0 },
    tags: ["street", "cool", "noloot", "unique"],
    art: art(String.raw`
    _________
   /   BEL   \
  |   0x07    |
  |___________|
       |||
       |||
       |||
      [___]
`),
  },
  {
    id: "choir-mantle", name: "Choir Mantle", kind: "armor", rarity: "legendary", glyph: "U", value: 9500, weight: 4, stack: 1,
    armor: { slot: "body", protection: 0.45 }, tags: ["cool", "tech", "noloot", "unique"],
    description: "Kade's coat, woven from root fibre and dead antenna wire. The lining hums half a second before something hits you.",
    art: art(String.raw`
    .-~~~~~~~~~-.
   /  ) ) ) ) )  \
  |  ( ( ( ( (    |
  |   ) ) ) ) )   |
   \ ( ( ( ( (   /
    '-.._____..-'
`),
  },
  {
    id: "hush-seed", name: "Hush Seed", kind: "junk", rarity: "legendary", glyph: "?", value: 6000, weight: 0.1, stack: 1, tags: ["noloot", "unique", "tech"],
    description: "A crystal the size of a tooth, warm, faintly singing. Forty-one voices are in there. Every broker in the city will ask your price.",
  },
  {
    id: "last-leaf", name: "Last Leaf", kind: "consumable", rarity: "rare", glyph: "f", value: 260, weight: 0.1, stack: 5, tags: ["noloot"],
    consumable: { heal: 120, duration: 20, effect: "regen" },
    description: "A leaf from The Last Tree. Chew it. Tastes like pennies and cut grass; the wound knits over twenty seconds.",
  },
  { id: "tap-log", name: "Tap Work Order", kind: "quest", rarity: "uncommon", glyph: "t", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "WORK ORDER 7-HUSH. INSTALL 3 UNITS, SILK MKT LAMPS. ROUTE: CATHEDRAL UPLINK -> WEST. PAID BY: K." },
  { id: "kade-journal", name: "Kade's Journal", kind: "quest", rarity: "rare", glyph: "j", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "A waterproof notebook in tidy engineer's capitals. The last page just says: THE TREE CAN HOLD THEM." },
];

// ---- Enemies: the Choirmaster and her garden -------------------------------------------------

const boss: EnemyArchetype = {
  id: "choirmaster", name: "Vesper Kade", faction: "choir", health: 2600, armor: 0.2, speed: { walk: 1.8, run: 4.6 },
  weapon: "tilde-whip", reaction: 0.25, aggression: 1, perception: { sight: 60, fovDegrees: 180, hearing: 70 }, scale: 1.7,
  look: look([210, 220, 215], [60, 90, 80], [200, 180, 165], [150, 255, 235], "bare", "antenna", "sway"),
  loot: "choirmaster", xp: 2500, tags: ["choir", "boss"],
  barks: { alert: ["YOU CAME HERE TO MAKE NOISE?"], hurt: ["SHH. SHH.", "YOU'RE OUT OF TUNE."], death: ["...they're... leaving..."] },
  boss: {
    title: "The Choirmaster",
    phases: [
      { atHealth: 1, message: "Vesper Kade lifts a conductor's baton. Forty-one voices come in on the downbeat.", attacks: ["sweep", "barrage", "charge"] },
      { atHealth: 0.7, message: "The roots hum a chord. Hush wardens climb out of the soil.", spawn: "hush-adds-1", speedMultiplier: 1.1, damageMultiplier: 1.15, attacks: ["barrage", "summon", "sweep", "slam"] },
      { atHealth: 0.4, message: "Every stolen voice sings at once. The ground shakes on the beat.", spawn: "hush-adds-2", speedMultiplier: 1.2, damageMultiplier: 1.3, attacks: ["shockwave", "charge", "summon", "barrage", "slam"] },
      { atHealth: 0.15, message: "She is singing with YOUR voice now. Badly.", speedMultiplier: 1.35, damageMultiplier: 1.5, attacks: ["shockwave", "slam", "charge", "sweep"] },
    ],
  },
};

const loot: LootTable[] = [
  /** The boss drop: both unique legendaries, the base "boss-legendary" hoard, and a little extra. */
  {
    id: "choirmaster", rolls: 2, empty: 0, credits: [300, 600], also: ["boss-legendary", "choirmaster-weapon", "choirmaster-armor"],
    entries: [{ item: "last-leaf", weight: 5 }, { item: "encrypted-drive", weight: 4 }, { item: "pool:epic:gear", weight: 3 }],
  },
  { id: "choirmaster-weapon", rolls: 1, empty: 0, entries: [{ item: "bell-character", weight: 1 }] },
  { id: "choirmaster-armor", rolls: 1, empty: 0, entries: [{ item: "choir-mantle", weight: 1 }] },
];

const GATE = arenaPoint(0, 22);
const BOSS_AT = arenaPoint(Math.PI, 10);
const encounters: EncounterDefinition[] = [
  {
    id: "hush-s1-ghosts", label: "Tap installers (Memory Gate)", area: area(0, 228, 14), hostile: true,
    members: [member("ghost-blinker", -6, 226, FACE.north), member("ghost-blinker", 6, 230, FACE.north)],
  },
  {
    id: "hush-s2-guard", label: "Uplink guard (Signal Cathedral)", area: area(504, -300, 14), hostile: false,
    members: [member("cs-saint", 504, -304, FACE.west), member("cs-acolyte", 496, -296, FACE.west), member("cs-acolyte", 510, -296, FACE.west), member("cs-zealot", 510, -314, FACE.north)],
  },
  {
    id: "hush-s3-wardens", label: "Hush wardens (Kade's workshop)", area: area(-384, -160, 16), hostile: true,
    members: [member("choir-warden", -384, -176, FACE.south), member("choir-warden", -384, -144, FACE.north), member("choir-cantor", -376.8, -150, FACE.west)],
  },
  {
    id: "hush-s4-patrol", label: "Choir patrol (Rootwood Park)", area: area(GATE.x, GATE.z - 10, 16), hostile: true,
    members: [
      member("choir-warden", GATE.x - 10, GATE.z - 10, FACE.north, { patrol: [{ x: GATE.x - 14, z: GATE.z - 10 }, { x: GATE.x + 14, z: GATE.z - 10 }] }),
      member("choir-warden", GATE.x + 10, GATE.z - 8, FACE.north),
      member("choir-cantor", GATE.x, GATE.z + 2, FACE.north),
    ],
  },
  { id: "hush-boss", label: "The Choirmaster", area: { ...ARENA }, hostile: true, members: [member("choirmaster", BOSS_AT.x, BOSS_AT.z, FACE.north, { tag: "boss" })] },
  {
    id: "hush-adds-1", label: "Hush wardens", area: { ...ARENA }, hostile: true,
    members: [member("choir-warden", arenaPoint(Math.PI / 2, 18).x, arenaPoint(Math.PI / 2, 18).z), member("choir-warden", arenaPoint(-Math.PI / 2, 18).x, arenaPoint(-Math.PI / 2, 18).z)],
  },
  {
    id: "hush-adds-2", label: "Choir cantors", area: { ...ARENA }, hostile: true,
    members: [
      member("choir-cantor", arenaPoint(Math.PI / 4, 20).x, arenaPoint(Math.PI / 4, 20).z),
      member("choir-cantor", arenaPoint(-Math.PI / 4, 20).x, arenaPoint(-Math.PI / 4, 20).z),
      member("choir-warden", arenaPoint((3 * Math.PI) / 4, 18).x, arenaPoint((3 * Math.PI) / 4, 18).z),
    ],
  },
];

// ---- Interactables -----------------------------------------------------------------------------

const TAP_TEXT = "Matte box clamped to the lamp post: a receiver, a tooth-sized crystal and a fibre line down the drain. Warm. Humming a lullaby.";
const tap = (id: string, x: number, z: number, extra: string): InteractableDefinition => ({
  id, label: "Humming box on a lamp post", x, z, y: 3.2, glyph: "#", once: true,
  condition: inStage("dead-air", "taps"),
  effects: [{ message: TAP_TEXT, tone: "info" }, { message: extra, tone: "quest" }],
});

const WRECK = arenaPoint(Math.PI, 8);
const HEART = arenaPoint(Math.PI, 5.5);
const interactables: InteractableDefinition[] = [
  tap("hush-tap-gate", 15, 203.5, "You pry the crystal loose. For a second it plays a woman singing about rain, then cuts out."),
  tap("hush-tap-corner", 72.5, 136.5, "The pups on the corner watch you work. 'That's Ghost kit,' one says. 'Don't touch Ghost kit.' You touch it."),
  tap("hush-tap-south", -56, 264, "Scratched inside the lid: the letter K and a small drawing of a tree."),
  {
    id: "hush-uplink", label: "Cathedral uplink console", x: 492, z: -308, y: 1.4, glyph: ">", once: true,
    condition: inStage("signal-cathedral", "uplink"),
    effects: [
      { message: "ROUTING TABLE: 40 INBOUND VOICE CHANNELS, SILK MKT. 1 OUTBOUND TRUNK: WEST. ROOT NODE 'LT-0'.", tone: "info" },
      { message: "OPERATOR: V. KADE, MERIDIAN EMERGENCY BROADCAST (DECOMMISSIONED). STATUS: SINGING.", tone: "quest" },
    ],
  },
  {
    id: "kade-bench", label: "Scorched workbench", x: -391.2, z: -164, y: 1.1, glyph: "=", once: true,
    condition: inStage("root-access", "search"),
    effects: [{ message: "Jars of rainwater, each growing a crystal like the ones in the lamp taps. The labels are names from Mara's index.", tone: "info" }],
  },
  {
    id: "kade-journal-spot", label: "Waterproof notebook", x: -391.2, z: -156, y: 1.0, glyph: "j", once: true,
    condition: inStage("root-access", "search"),
    effects: [
      { give: "kade-journal" },
      { message: "\"Too loud. Every voice in this city, all night. I can hold them. The first cables were laid along the roots, so the roots reach every district. The Last Tree is the oldest antenna we have.\"", tone: "quest" },
    ],
  },
  {
    id: "kade-recorder", label: "Dusty voice recorder", x: -376.8, z: -164, y: 1.2, glyph: "o", once: true,
    condition: inStage("root-access", "search"),
    effects: [{ message: "A woman's voice, calm: \"If you're hearing this, you followed my boxes. Good. The seed keeper by the Last Tree has the wardens' seal. She will never give it to me. She might give it to you.\"", tone: "quest" }],
  },
  {
    id: "hush-warden-gate", label: "Warden gate (the sigil fits)", x: GATE.x, z: GATE.z, y: 2.2, glyph: "S",
    condition: { all: [inStage("hollow-choir", "gate"), { item: "warden-sigil" }] },
    effects: [{ message: "The brass sigil turns with a clunk. The gate swings in. Under the Tree, something starts to sing.", tone: "danger" }],
  },
  {
    // A way back into the fight if the boss was lost (leash reset, reload): re-summons her fresh.
    id: "hush-bell", label: "Ring the warden bell (call her out)", x: GATE.x + 3, z: GATE.z, y: 2.4, glyph: "*",
    condition: { all: [inStage("hollow-choir", "choir"), { not: { encounterCleared: "hush-boss" } }] },
    effects: [{ spawn: "hush-boss" }, { message: "The bell rings out under the roots. The Choirmaster comes to see who rang it.", tone: "danger" }],
  },
  { id: "hush-kade", label: "Vesper Kade, in the wreck of her frame", x: WRECK.x, z: WRECK.z, y: 1.2, glyph: "@", condition: inStage("hollow-choir", "verdict"), dialogue: "hush.kade" },
  { id: "hush-heart", label: "The heart of the roots", x: HEART.x, z: HEART.z, y: 1.0, glyph: "?", condition: inStage("hollow-choir", "seed"), dialogue: "hush.seed" },
];

// ---- Quests ------------------------------------------------------------------------------------

const deadAir: QuestDefinition2 = {
  id: "dead-air", title: "Dead Air", category: "story", giver: "mara",
  summary: "Mara's relay chip held an index of forty voiceprints, and the people on it are losing their voices. Find out who is doing it.",
  requires: { quest: "relay-chip" }, rewardHint: "250 cr, 450 XP", recommendedLevel: 2, start: "lark",
  stages: [
    {
      id: "lark", journal: "Mara says Lark, a busker, lost her voice mid-song at the Memory Gate in the Silk Market. Start with her.",
      objectives: [{ id: "slate", kind: "choose", text: "Talk to Lark the busker at the Memory Gate, Silk Market", dialogue: "hush.lark", options: ["promise"] }],
      next: "taps",
    },
    {
      id: "taps", journal: "Lark wrote that a streetlight by the Memory Gate hummed her song back at her, and that there are boxes on three lights around the Silk Market. Check all three lamps.",
      objectives: [
        { id: "tap-gate", kind: "interact", text: "Open the box on the lamp at the Memory Gate", object: "hush-tap-gate" },
        { id: "tap-corner", kind: "interact", text: "Open the box on the lamp at the Razorback pups' corner, a block north-east of the Memory Gate", object: "hush-tap-corner" },
        { id: "tap-south", kind: "interact", text: "Open the box on the lamp south-west of the Memory Gate", object: "hush-tap-south" },
      ],
      next: "installers",
    },
    {
      id: "installers", journal: "Your comm is full of static. The Ghosts who installed the boxes are at the Memory Gate, and they saw you take them apart.",
      onEnter: [{ spawn: "hush-s1-ghosts" }, { message: "Static on every channel. Two Ghosts at the Memory Gate.", tone: "danger" }],
      objectives: [{ id: "clear", kind: "clear", text: "Take down the Ghost installers at the Memory Gate", encounter: "hush-s1-ghosts" }],
      onComplete: [{ give: "tap-log" }, { message: "One installer had a work order in his pocket. Paid by 'K'.", tone: "loot" }],
      next: "report",
    },
    {
      id: "report", journal: "The work order: three taps, routed through the Signal Cathedral uplink and then west. Paid by 'K'. Take it to Mara Voss on the Silk Market avenue.",
      objectives: [{ id: "deliver", kind: "deliver", text: "Bring the work order to Mara Voss in the Silk Market", item: "tap-log", count: 1, npc: "mara" }],
    },
  ],
  outcomes: {
    done: {
      title: "Somebody Is Listening", journal: "Mara read the work order twice, then burned it. 'Juno Reyes tracks every signal in Neon Ward. Ask her what the Cathedral uplink is carrying.'",
      effects: [{ credits: 250 }, { xp: 450 }, { setFlag: "hush.s1" }, { waypoint: { x: 16, z: -139.5, label: "Juno Reyes" } }],
    },
  },
};

const signalCathedral: QuestDefinition2 = {
  id: "signal-cathedral", title: "The Signal Cathedral", category: "story", giver: "juno",
  summary: "The lamp taps route through the Signal Cathedral's uplink. The Chrome Saints occupy the array and think it talks to God. Read its routing table.",
  requires: { quest: "dead-air" }, rewardHint: "400 cr, Semicolon marksman rifle", recommendedLevel: 6, start: "cathedral",
  stages: [
    {
      id: "cathedral", journal: "Juno wants the routing table off the Signal Cathedral uplink in the Ghost Circuit. Deacon Ferro guards the Cathedral door for the Chrome Saints. Talk, bribe or fight your way past him.",
      onEnter: [{ spawn: "hush-s2-guard" }, { waypoint: { x: 459, z: -265, label: "Deacon Ferro" } }],
      objectives: [{ id: "entry", kind: "choose", text: "Get past Deacon Ferro at the Signal Cathedral, Ghost Circuit", dialogue: "hush.ferro", options: ["granted", "fight"] }],
      next: [{ if: { flag: "signal-cathedral.entry", is: "fight" }, stage: "fight" }, { stage: "uplink" }],
    },
    {
      id: "fight", journal: "Talking failed. Four Saints stand between you and the uplink console.",
      objectives: [{ id: "clear", kind: "clear", text: "Defeat the Saints guarding the Signal Cathedral uplink", encounter: "hush-s2-guard" }],
      next: "uplink",
    },
    {
      id: "uplink", journal: "The uplink console is behind the array, on the north-east side of the Signal Cathedral.",
      objectives: [{ id: "console", kind: "interact", text: "Read the routing table on the uplink console, north-east side of the Signal Cathedral", object: "hush-uplink" }],
      next: "report",
    },
    {
      id: "report", journal: "Forty voice channels in, one trunk out, west to a root node called LT-0. Operator: V. Kade. Tell Juno Reyes, under the Meridian Spire.",
      objectives: [{ id: "report", kind: "choose", text: "Report to Juno Reyes under the Meridian Spire, Neon Ward", dialogue: "hush.juno", options: ["report"] }],
      next: [{ if: { flag: "signal-cathedral.entry", is: "fight" }, stage: "end-bloody" }, { stage: "end-clean" }],
    },
    ending("end-clean", "Juno knew the operator's name.", "clean"),
    ending("end-bloody", "Juno knew the operator's name. She also noticed the chrome filings on your coat.", "bloody"),
  ],
  outcomes: {
    clean: {
      title: "Holy Ground", journal: "The Saints let you in and out. Juno knew the name: Vesper Kade, Meridian's emergency-broadcast engineer, erased from the payroll. Tomas at the Ember Core worked nights with her.",
      effects: [{ credits: 400 }, { xp: 1400 }, { give: "semicolon" }, { rep: "chrome-saints", by: 10 }, { setFlag: "hush.s2" }],
    },
    bloody: {
      title: "Chrome on the Floor", journal: "You took the uplink by force. Juno knew the name: Vesper Kade, Meridian's emergency-broadcast engineer, erased from the payroll. Tomas at the Ember Core worked nights with her.",
      effects: [{ credits: 400 }, { xp: 1500 }, { give: "semicolon" }, { rep: "chrome-saints", by: -20 }, { setFlag: "hush.s2" }],
    },
  },
};

const rootAccess: QuestDefinition2 = {
  id: "root-access", title: "Root Access", category: "story", giver: "tomas",
  summary: "Vesper Kade used to keep Tomas company on the Ember Core night shift. Her workshop, two streets south-east of the Core in the Foundry, has been empty since it burned.",
  requires: { quest: "signal-cathedral" }, rewardHint: "500 cr, 2200 XP, the Warden Sigil", recommendedLevel: 8, start: "workshop",
  stages: [
    {
      id: "workshop", journal: "Tomas says Vesper Kade's burned-out workshop is two streets east and two south of the Ember Core in the Foundry, past the pipes. Nobody has been inside since the fire.",
      objectives: [{ id: "arrive", kind: "reach", text: "Find Kade's burned-out workshop south-east of the Ember Core, Foundry", area: area(-384, -160, 10) }],
      next: "search",
    },
    {
      id: "search", journal: "Kade's workshop in the Foundry: soot, puddles and the smell of hot glass. Tomas says she wrote everything down. Find her notebook.",
      objectives: [
        { id: "journal", kind: "interact", text: "Find Kade's waterproof notebook in the burned workshop", object: "kade-journal-spot" },
        { id: "bench", kind: "interact", text: "Search the scorched workbench in Kade's workshop", object: "kade-bench", optional: true },
        { id: "recorder", kind: "interact", text: "Play the dusty voice recorder in Kade's workshop", object: "kade-recorder", optional: true },
      ],
      next: "ambush",
    },
    {
      id: "ambush", journal: "Pale figures in hoods step out of the smoke in Kade's workshop, humming. Her Choir guards the place.",
      onEnter: [{ spawn: "hush-s3-wardens" }, { message: "Humming from every direction. Hush wardens in the workshop.", tone: "danger" }],
      objectives: [{ id: "clear", kind: "clear", text: "Fight off the Hush wardens in Kade's workshop", encounter: "hush-s3-wardens" }],
      next: "wren",
    },
    {
      id: "wren", journal: "Kade is using the Last Tree as an antenna. Sister Wren, the seed keeper, holds the seal to the warden gate. Find her by the Last Tree in Rootwood Park, Rain Gardens.",
      onEnter: [{ waypoint: { x: -494, z: 272, label: "Sister Wren" } }],
      objectives: [{ id: "sigil", kind: "choose", text: "Ask Sister Wren for the seal, at the Last Tree in Rootwood Park", dialogue: "hush.wren", options: ["take-sigil", "show-journal"] }],
    },
  ],
  outcomes: {
    done: {
      title: "The Seed Keeper's Seal", journal: "Wren gave you the Warden Sigil. The warden gate is on the north side of the stone circle, south of the Last Tree. Talk to her again when you are ready to go in.",
      effects: [{ credits: 500 }, { xp: 2200 }, { setFlag: "hush.s3" }],
    },
  },
};

const hollowChoir: QuestDefinition2 = {
  id: "hollow-choir", title: "The Hollow Choir", category: "story", giver: "wren",
  summary: "In the stone circle south of the Last Tree, where its roots surface, Vesper Kade is broadcasting forty-one stolen voices. The Warden Sigil opens the gate. Stop her.",
  requires: { quest: "root-access" }, rewardHint: "1500 cr, 4000 XP, two legendaries: Bell Character and Choir Mantle", recommendedLevel: 10, start: "approach",
  stages: [
    {
      id: "approach", journal: "Sister Wren's sigil opens the warden gate on the north side of the stone circle, south of the Last Tree in Rootwood Park. Choir wardens patrol the paths to it.",
      onEnter: [{ spawn: "hush-s4-patrol" }, { waypoint: { x: GATE.x, z: GATE.z, label: "Warden gate" } }],
      objectives: [
        { id: "gate", kind: "reach", text: "Reach the warden gate, north side of the stone circle in Rootwood Park", area: area(GATE.x, GATE.z, 8) },
        { id: "patrol", kind: "clear", text: "Take out the Choir patrol on the paths north of the warden gate", encounter: "hush-s4-patrol", optional: true },
      ],
      next: "gate",
    },
    {
      id: "gate", journal: "The warden gate on the north side of the stone circle is old brass with a sigil-shaped slot. Use the Warden Sigil on it.",
      objectives: [{ id: "open", kind: "interact", text: "Open the warden gate (north side of the stone circle) with the Warden Sigil", object: "hush-warden-gate" }],
      next: "choir",
    },
    {
      id: "choir", journal: "Vesper Kade is inside a frame of root and antenna wire in the stone circle, singing with forty-one voices. Break it.",
      onEnter: [{ spawn: "hush-boss" }],
      objectives: [{ id: "boss", kind: "kill", text: "Defeat Vesper Kade, the Choirmaster, in the stone circle", count: 1, archetype: "choirmaster", encounter: "hush-boss" }],
      next: "verdict",
    },
    {
      id: "verdict", journal: "The frame in the stone circle is in pieces. Vesper Kade is tangled in the wreck, still breathing. Spare her or finish it.",
      onEnter: [{ message: "The song stops. In the wreck of the frame, someone coughs.", tone: "quest" }],
      objectives: [{ id: "vesper", kind: "choose", text: "Decide what to do with Vesper Kade, in the wreck of her frame in the stone circle", dialogue: "hush.kade", options: ["spare", "finish"] }],
      next: "seed",
    },
    {
      id: "seed", journal: "In the stone circle, where the Last Tree's roots knot together, sits the Hush Seed: a crystal the size of a tooth holding forty-one voices. Crush it to free them, or take it.",
      objectives: [{ id: "heart", kind: "choose", text: "Decide what to do with the Hush Seed, where the roots knot together", dialogue: "hush.seed", options: ["destroy", "take"] }],
      next: [{ if: { flag: "hollow-choir.heart", is: "take" }, stage: "end-kept" }, { stage: "end-restored" }],
    },
    ending("end-restored", "You crushed the seed.", "restored"),
    ending("end-kept", "You pocketed the seed.", "kept"),
  ],
  outcomes: {
    restored: {
      title: "Say Something", journal: "The seed cracked like a knuckle. Across the city, forty-one people cleared their throats at the same moment. One of them started swearing at a cab.",
      effects: [{ setFlag: "hush.ending", value: "restored" }, { xp: 4000 }, { credits: 1500 }, { rep: "civilian", by: 25 }, { give: "last-leaf", count: 3 }, { message: "Somewhere by the Memory Gate, Lark starts to sing.", tone: "quest" }],
    },
    kept: {
      title: "A Quieter City", journal: "You kept the seed. Forty-one voices hum in your pocket, and every broker from the Spire to the Ghost Circuit wants your price.",
      effects: [{ setFlag: "hush.ending", value: "kept" }, { xp: 4000 }, { credits: 1500 }, { rep: "ghosts", by: 10 }, { rep: "corpsec", by: 10 }, { message: "The seed is warm in your pocket and humming a lullaby.", tone: "quest" }],
    },
  },
};

// ---- Dialogues ---------------------------------------------------------------------------------

const dialogues: DialogueDefinition[] = [
  {
    id: "hush.mara", npc: "mara", quest: "dead-air",
    entries: [
      { condition: { item: "hush-seed" }, node: "seed", priority: 40 },
      { condition: available("dead-air"), node: "offer", priority: 35 },
      { condition: active("dead-air"), node: "reminder", priority: 34 },
      { condition: { flag: "hush.ending", is: "restored" }, node: "after-restored", priority: 15 },
      { condition: { flag: "hush.ending", is: "kept" }, node: "after-kept", priority: 15 },
      { condition: completed("dead-air"), node: "after", priority: 11 },
    ],
    nodes: [
      node("offer", [
        "That relay chip you carried. I read it. Don't look at me like that, reading things is my job.",
        "It was an index. Forty names, forty voiceprints. Three of the names stopped talking this week.",
        "Not 'stopped talking to me'. Stopped. Talking. One of them sings by the Memory Gate. Sang. Lark.",
      ], [
        { id: "accept", label: "I'll find out who's doing it.", effects: [{ startQuest: "dead-air" }], next: "accepted" },
        bye("Not my problem, Mara.", "decline"),
      ]),
      node("accepted", ["Lark's on the avenue by the Memory Gate. She can't tell you much. She can write, though."], [LEAVE]),
      node("reminder", ["Somebody is pulling voices out of my market, and I can't sell what I can't hear.", "Lark first. She's at the Memory Gate. Then whatever she points you at."], [LEAVE]),
      node("after", ["Juno's under the Meridian Spire in Neon Ward. If anything is riding the Cathedral uplink, she's already logged it."], [LEAVE]),
      node("after-restored", ["Forty-one voices back on the market. My index is worthless now.", "I've never been happier to lose money. Don't tell anyone."], [LEAVE]),
      node("after-kept", ["You're carrying the only copy of forty-one people.", "That makes you the most valuable thing in this market. Try not to get mugged."], [LEAVE]),
      node("seed", ["Is that - you brought it to me.", "I'll give you five thousand for it. And yes, I'll give them back. Eventually. For a fee."], [
        { id: "sell-seed", label: "Sell the Hush Seed (+5000 cr)", kind: "complete", condition: { item: "hush-seed" }, effects: [{ take: "hush-seed" }, { credits: 5000 }, { setFlag: "hush.seed-sold" }, { message: "Mara Voss now owns forty-one voices.", tone: "loot" }], next: "sold" },
        bye("It's not for sale."),
      ]),
      node("sold", ["Pleasure doing business.", "I'll start the bidding at six figures. Some of these people owe me money; now they owe me a voice."], [LEAVE]),
    ],
  },
  {
    id: "hush.lark", npc: "lark", quest: "dead-air",
    entries: [{ condition: inStage("dead-air", "lark"), node: "slate", priority: 20 }, { condition: active("dead-air"), node: "waiting", priority: 18 }],
    nodes: [
      node("slate", ["[Lark wipes the slate with her sleeve and writes fast.]", "[IT WAS RAINING. I WAS SINGING. THE STREETLIGHT HUMMED MY SONG BACK AT ME.]", "[THEN I HAD NO SONG.]"], [
        go("lights", "Which streetlight?", "boxes"),
      ]),
      node("boxes", ["[She points up at the lamp over your head, then two fingers north-east, then one south-west.]", "[BOXES ON THREE LIGHTS. THEY HUM AT NIGHT. NOBODY ELSE HEARS IT.]"], [
        { id: "promise", label: "I'll find your song.", kind: "continue", next: "promised" },
      ]),
      node("promised", ["[She writes: DON'T PROMISE. JUST CHECK THE LIGHTS.]"], [LEAVE]),
      node("waiting", ["[The slate says: THE BOXES. PLEASE.]"], [LEAVE]),
    ],
  },
  {
    id: "hush.juno", npc: "juno", quest: "signal-cathedral",
    entries: [
      { condition: inStage("signal-cathedral", "report"), node: "report", priority: 20 },
      { condition: active("signal-cathedral"), node: "reminder", priority: 18 },
    ],
    nodes: [
      node("offer", [
        "Mara called. She never calls.",
        "Those boxes route to the Signal Cathedral. I can hear it: every night at two, the array sings. Forty voices. Last night, forty-one.",
        "The Chrome Saints squat the place. They think the array talks to God. Get me the routing table off the uplink.",
      ], [
        { id: "accept", label: "Show me where.", effects: [{ startQuest: "signal-cathedral" }], next: "accepted" },
        bye("Later.", "decline"),
      ]),
      node("accepted", ["Ghost Circuit, far north-east. Deacon Ferro runs the door. He likes chrome, money and being right. Pick one."], [LEAVE]),
      node("reminder", ["Signal Cathedral, Ghost Circuit. Get me the routing table off the uplink console. I'll be here."], [LEAVE]),
      node("report", ["Well? What is it singing?"], [
        { id: "report", label: "Forty voices in, one trunk out. West. Operator: V. Kade.", kind: "complete", next: "kade" },
      ]),
      node("kade", ["Kade. Vesper Kade. Meridian emergency broadcast - the woman who built the sirens.", "Meridian erased her after the flood. Tomas at the Ember Core knew the night shift. Ask him."], [LEAVE]),
    ],
  },
  {
    id: "hush.ferro", npc: "ferro", quest: "signal-cathedral",
    entries: [{ condition: inStage("signal-cathedral", "cathedral"), node: "door", priority: 20 }],
    nodes: [
      node("door", [
        "The Signal Runner sent you. She hears the choir too, then.",
        "You want the uplink. The uplink is where the voices ascend. Why should I let flesh touch it?",
      ], [
        { id: "witness", label: "Because I want to witness it.", check: { stat: "cool", difficulty: 5, success: "yes-cool", failure: "no", bonus: [{ if: { rep: "chrome-saints", atLeast: 10 }, by: 2, label: "Saints trust you" }] }, next: null },
        { id: "fence", label: "Somebody is using your church as a fence, Deacon.", check: { stat: "street", difficulty: 5, success: "yes-street", failure: "no" }, next: null },
        { id: "code", label: "Your array is running somebody else's code. Want to see?", check: { stat: "tech", difficulty: 6, success: "yes-tech", failure: "no", bonus: [{ if: { item: "tap-log" }, by: 1, label: "You have the work order" }] }, next: null },
        { id: "tithe", label: "Offer a tithe (300 cr).", condition: { credits: 300 }, effects: [{ credits: -300 }], next: "yes-tithe" },
        { id: "fight", label: "Then I'll take it.", kind: "decline", effects: [{ hostile: "hush-s2-guard", value: true }, { message: "The uplink guard draws steel.", tone: "danger" }], next: null },
      ]),
      node("no", ["No. Go and pray somewhere cheaper."], [go("again", "Hear me out.", "door"), LEAVE]),
      node("yes-cool", ["Hm. You have a still face. Chrome likes a still face.", "Go. Touch nothing holy."], [{ id: "granted", label: "Walk to the uplink.", kind: "continue", next: null }]),
      node("yes-street", ["A fence. In my Cathedral.", "...Go. If you're right, tell me who. If you're wrong, don't come back."], [{ id: "granted", label: "Walk to the uplink.", kind: "continue", next: null }]),
      node("yes-tech", ["You're saying God has a supplier.", "Show me later. Go."], [{ id: "granted", label: "Walk to the uplink.", kind: "continue", next: null }]),
      node("yes-tithe", ["The Saints thank you for your generosity. Chrome is expensive.", "Go."], [{ id: "granted", label: "Walk to the uplink.", kind: "continue", next: null }]),
    ],
  },
  {
    id: "hush.tomas", npc: "tomas", quest: "root-access",
    entries: [{ condition: active("root-access"), node: "reminder", priority: 18 }],
    nodes: [
      node("offer", [
        "Vesper. Vesper Kade. She used to sit where you're standing and listen to the Core breathe.",
        "She could name a failing relay from the street by the pitch it whined at. Said the whole city was too loud to think in.",
        "Her workshop was two streets south-east of here. Nobody's been in since the fire. Nobody wanted to.",
      ], [
        { id: "accept", label: "I'll go in.", effects: [{ startQuest: "root-access" }], next: "accepted" },
        bye("Not yet.", "decline"),
      ]),
      node("accepted", ["Two streets east, then two south, past the pipes. If you hear humming, that's not the Core."], [LEAVE]),
      node("reminder", ["Two streets east, two south, past the pipes. Find her notes. She wrote everything down. Engineers do."], [LEAVE]),
    ],
  },
  {
    id: "hush.wren", npc: "wren", quest: "root-access",
    entries: [
      { condition: inStage("root-access", "wren"), node: "seal", priority: 20 },
      { condition: active("hollow-choir"), node: "go", priority: 18 },
    ],
    nodes: [
      node("seal", [
        "You've been in her workshop. You smell of hot glass.",
        "Yes, I know what Vesper is doing. I've been singing to the Tree every night to drown her out. It isn't working.",
        "You want the wardens' seal.",
      ], [
        { id: "take-sigil", label: "Give me the sigil. I'll end it.", kind: "complete", effects: [{ give: "warden-sigil" }], next: "given" },
        { id: "show-journal", label: "Show her Kade's journal.", kind: "complete", condition: { item: "kade-journal" }, hideIfUnavailable: true, effects: [{ give: "warden-sigil" }, { give: "last-leaf", count: 2 }], next: "read" },
      ]),
      node("given", ["Here. Brass, two kilos, older than the city. Don't drop it in a drain.", "Come back to me when you're ready to open the gate."], [LEAVE]),
      node("read", [
        "[She reads the last page for a long time.]",
        "'The Tree can hold them.' She means the Tree can keep them. Forever, if nobody stops her.",
        "Take the seal. And these leaves - chew them when it hurts. It will hurt.",
      ], [LEAVE]),
      // The finale's offer and the in-quest reminder.
      node("offer", [
        "Tonight the Tree sings loudest. The roots surface in the old stone circle south of it, and the warden gate is on the circle's north side. The sigil opens it.",
        "Vesper is behind it. She was a person once, and a good engineer. Do what you have to. I'm a seed keeper; I don't hand out absolution.",
      ], [
        { id: "accept", label: "I'm ready.", effects: [{ startQuest: "hollow-choir" }], next: "go" },
        bye("Not tonight.", "decline"),
      ]),
      node("go", ["The stone circle, south of the Tree. The gate's on its north side. The wardens hum before they swing. Listen for it."], [LEAVE]),
    ],
  },
  {
    id: "hush.kade", npc: "hush-kade", quest: "hollow-choir",
    entries: [{ node: "wreck" }],
    nodes: [
      node("wreck", [
        "[Vesper Kade is smaller than her frame was. Root fibre is threaded through her sleeves.]",
        "\"You don't hear it, do you. Every voice in this city, all night, screaming into the rain. I made it stop. For forty-one of them, I made it stop.\"",
        "\"Go on, then. Make some noise.\"",
      ], [
        { id: "spare", label: "Walk away. Let her live with the quiet.", kind: "continue", effects: [{ setFlag: "hush.vesper", value: "spared" }], next: "spared" },
        { id: "finish", label: "End it.", kind: "continue", effects: [{ setFlag: "hush.vesper", value: "dead" }, { credits: 300 }, { rep: "chrome-saints", by: 10 }], next: "finished" },
      ]),
      node("spared", ["[She closes her eyes.] \"...Thank you. I think. It's so loud out here.\"", "[She is still lying in the roots when you turn away.]"], [LEAVE]),
      node("finished", ["[It is quick. Her pockets hold 300 credits and a conductor's tuning fork, still humming.]", "[Word will reach the Chrome Saints. They called her a heretic.]"], [LEAVE]),
    ],
  },
  {
    id: "hush.seed", npc: "hush-heart", quest: "hollow-choir",
    entries: [{ node: "heart" }],
    nodes: [
      node("heart", [
        "[Where the roots knot together, a crystal the size of a tooth blinks like a cheap LED. It is warm.]",
        "[Put your ear to it and you hear them: a busker's song, a cab driver swearing, a child counting to ten. Forty-one voices.]",
      ], [
        { id: "destroy", label: "Crush it. Let them go home.", kind: "complete", next: null },
        { id: "take", label: "Take it. It's worth a fortune.", kind: "complete", effects: [{ give: "hush-seed" }], next: null },
      ]),
    ],
  },
];

/** The main storyline: Dead Air -> The Signal Cathedral -> Root Access -> The Hollow Choir. */
export const HUSH_PACK: ContentPack = {
  id: "hush",
  items, loot, archetypes: [boss], encounters, interactables, dialogues,
  quests: [deadAir, signalCathedral, rootAccess, hollowChoir],
  areas: [{ id: "rootwood-arena", ...ARENA }],
};
