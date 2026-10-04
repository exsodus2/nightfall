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
    description: "ASCII 0x07: the character that makes the terminal ring. Kade's conductor's bell, cast into a hammer. Every hit is a note nobody can steal.",
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
    description: "Kade's coat, woven from root fibre and dead antenna wire. It hums one low note when something is about to hit you.",
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
    description: "A crystal the size of a tooth, warm, faintly singing. Forty-one voices are in there. Nobody will stop asking you what you want for it.",
  },
  {
    id: "last-leaf", name: "Last Leaf", kind: "consumable", rarity: "rare", glyph: "f", value: 260, weight: 0.1, stack: 5, tags: ["noloot"],
    consumable: { heal: 120, duration: 20, effect: "regen" },
    description: "A leaf from The Last Tree, chewed. Bitter, green, and it closes wounds like it remembers when you did not have them.",
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
  barks: { alert: ["YOU CAME ALL THIS WAY TO MAKE NOISE?"], hurt: ["SHH. SHH.", "YOU'RE OUT OF TUNE."], death: ["...listen... it's so quiet..."] },
  boss: {
    title: "The Choirmaster",
    phases: [
      { atHealth: 1, message: "Vesper Kade lifts a conductor's baton. The rain stops to listen.", attacks: ["sweep", "barrage", "charge"] },
      { atHealth: 0.7, message: "The roots hum. Hush wardens rise out of the soil.", spawn: "hush-adds-1", speedMultiplier: 1.1, damageMultiplier: 1.15, attacks: ["barrage", "summon", "sweep", "slam"] },
      { atHealth: 0.4, message: "Every stolen voice sings at once. The ground keeps time.", spawn: "hush-adds-2", speedMultiplier: 1.2, damageMultiplier: 1.3, attacks: ["shockwave", "charge", "summon", "barrage", "slam"] },
      { atHealth: 0.15, message: "She is singing with YOUR voice now.", speedMultiplier: 1.35, damageMultiplier: 1.5, attacks: ["shockwave", "slam", "charge", "sweep"] },
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

const TAP_TEXT = "A matte box clamped to the lamp post. Inside: a receiver, a crystal the size of a tooth, and a fibre line running down into the drain. It is warm. It is humming a lullaby.";
const tap = (id: string, x: number, z: number, extra: string): InteractableDefinition => ({
  id, label: "Humming box on a lamp post", x, z, y: 3.2, glyph: "#", once: true,
  condition: inStage("dead-air", "taps"),
  effects: [{ message: TAP_TEXT, tone: "info" }, { message: extra, tone: "quest" }],
});

const WRECK = arenaPoint(Math.PI, 8);
const HEART = arenaPoint(Math.PI, 5.5);
const interactables: InteractableDefinition[] = [
  tap("hush-tap-gate", 15.2, 201, "You pry the crystal loose. For a second you hear a woman singing about rain. Then nothing."),
  tap("hush-tap-corner", 72.2, 133, "The pups on the corner watch you work. 'That's Ghost kit,' one says. 'Don't touch Ghost kit.' You touch it."),
  tap("hush-tap-south", -56, 264, "Scratched inside the lid: a K, and a little drawing of a tree."),
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
    effects: [{ message: "Jars of rainwater, each growing a crystal like the lamp taps. The labels are names from Mara's index.", tone: "info" }],
  },
  {
    id: "kade-journal-spot", label: "Waterproof notebook", x: -391.2, z: -156, y: 1.0, glyph: "j", once: true,
    condition: inStage("root-access", "search"),
    effects: [
      { give: "kade-journal" },
      { message: "\"The city is too loud. Every voice is a wound that won't close. I can hold them. The roots run under every district - every cable in this city was laid along them. The Last Tree is the oldest antenna we have.\"", tone: "quest" },
    ],
  },
  {
    id: "kade-recorder", label: "Dusty voice recorder", x: -376.8, z: -164, y: 1.2, glyph: "o", once: true,
    condition: inStage("root-access", "search"),
    effects: [{ message: "A woman's voice, calm: \"If you're hearing this, you followed my boxes. Good. Someone should hear it before it's quiet. The seed keeper has the wardens' seal. She'll never give it to me.\"", tone: "quest" }],
  },
  {
    id: "hush-warden-gate", label: "Warden gate (the sigil fits)", x: GATE.x, z: GATE.z, y: 2.2, glyph: "S",
    condition: { all: [inStage("hollow-choir", "gate"), { item: "warden-sigil" }] },
    effects: [{ message: "The brass sigil turns in the gate with a sound like a held breath let go. Beneath the Tree, something starts to sing.", tone: "danger" }],
  },
  {
    // A way back into the fight if the boss was lost (leash reset, reload): re-summons her fresh.
    id: "hush-bell", label: "Ring the warden bell (call her out)", x: GATE.x + 3, z: GATE.z, y: 2.4, glyph: "*",
    condition: { all: [inStage("hollow-choir", "choir"), { not: { encounterCleared: "hush-boss" } }] },
    effects: [{ spawn: "hush-boss" }, { message: "The bell's note rolls under the roots. The Choirmaster answers.", tone: "danger" }],
  },
  { id: "hush-kade", label: "Vesper Kade, in the wreck of her frame", x: WRECK.x, z: WRECK.z, y: 1.2, glyph: "@", condition: inStage("hollow-choir", "verdict"), dialogue: "hush.kade" },
  { id: "hush-heart", label: "The heart of the roots", x: HEART.x, z: HEART.z, y: 1.0, glyph: "?", condition: inStage("hollow-choir", "seed"), dialogue: "hush.seed" },
];

// ---- Quests ------------------------------------------------------------------------------------

const deadAir: QuestDefinition2 = {
  id: "dead-air", title: "Dead Air", category: "story", giver: "mara",
  summary: "The relay chip was an index of forty voiceprints. The people on it are going silent. Find out who is pulling voices out of the Silk Market.",
  requires: { quest: "relay-chip" }, rewardHint: "250 cr, the start of something", recommendedLevel: 2, start: "lark",
  stages: [
    {
      id: "lark", journal: "Mara says a busker called Lark lost her voice mid-song, by the Memory Gate. Start with her.",
      objectives: [{ id: "slate", kind: "choose", text: "Talk to Lark by the Memory Gate", dialogue: "hush.lark", options: ["promise"] }],
      next: "taps",
    },
    {
      id: "taps", journal: "Lark's slate: THE LIGHT HUMMED MY SONG BACK AT ME. BOXES ON THREE LIGHTS. Find the boxes.",
      objectives: [
        { id: "tap-gate", kind: "interact", text: "Check the lamp by the Memory Gate", object: "hush-tap-gate" },
        { id: "tap-corner", kind: "interact", text: "Check the lamp on the pups' corner (east)", object: "hush-tap-corner" },
        { id: "tap-south", kind: "interact", text: "Check the lamp south-west of the gate", object: "hush-tap-south" },
      ],
      next: "installers",
    },
    {
      id: "installers", journal: "Your comm fills with static. Somebody is jamming it - figures in the rain by the Memory Gate. The installers came to see who's touching their boxes.",
      onEnter: [{ spawn: "hush-s1-ghosts" }, { message: "Static on every channel. Movement by the Memory Gate.", tone: "danger" }],
      objectives: [{ id: "clear", kind: "clear", text: "Deal with the tap installers", encounter: "hush-s1-ghosts" }],
      onComplete: [{ give: "tap-log" }, { message: "One of them carried a work order. Paid by 'K'.", tone: "loot" }],
      next: "report",
    },
    {
      id: "report", journal: "A work order: three taps, routed through the Signal Cathedral uplink, then west. Paid by 'K'. Mara will want this.",
      objectives: [{ id: "deliver", kind: "deliver", text: "Bring the work order to Mara", item: "tap-log", count: 1, npc: "mara" }],
    },
  ],
  outcomes: {
    done: {
      title: "Somebody Is Listening", journal: "Mara read the work order twice, then burned it. 'Juno hears the quiet ones,' she said. 'Go and ask her what the Cathedral has been singing.'",
      effects: [{ credits: 250 }, { xp: 450 }, { setFlag: "hush.s1" }, { waypoint: { x: 15, z: -137, label: "Juno Reyes" } }],
    },
  },
};

const signalCathedral: QuestDefinition2 = {
  id: "signal-cathedral", title: "The Signal Cathedral", category: "story", giver: "juno",
  summary: "The taps route through the Signal Cathedral's uplink. The Chrome Saints squat the array and think it talks to God. Get to the routing table.",
  requires: { quest: "dead-air" }, rewardHint: "400 cr, a marksman rifle", recommendedLevel: 6, start: "cathedral",
  stages: [
    {
      id: "cathedral", journal: "Deacon Ferro keeps the Cathedral for the Chrome Saints. Talk your way to the uplink - or don't.",
      onEnter: [{ spawn: "hush-s2-guard" }, { waypoint: { x: 458, z: -262, label: "Deacon Ferro" } }],
      objectives: [{ id: "entry", kind: "choose", text: "Get past Deacon Ferro at the Signal Cathedral", dialogue: "hush.ferro", options: ["granted", "fight"] }],
      next: [{ if: { flag: "signal-cathedral.entry", is: "fight" }, stage: "fight" }, { stage: "uplink" }],
    },
    {
      id: "fight", journal: "Diplomacy is over. The uplink guard is between you and the console.",
      objectives: [{ id: "clear", kind: "clear", text: "Break the uplink guard", encounter: "hush-s2-guard" }],
      next: "uplink",
    },
    {
      id: "uplink", journal: "The uplink console hums behind the array.",
      objectives: [{ id: "console", kind: "interact", text: "Read the uplink routing table", object: "hush-uplink" }],
      next: "report",
    },
    {
      id: "report", journal: "Forty voices in, one trunk out - west, to a root node called LT-0. Operator: V. Kade. Tell Juno.",
      objectives: [{ id: "report", kind: "choose", text: "Tell Juno what the Cathedral is singing", dialogue: "hush.juno", options: ["report"] }],
      next: [{ if: { flag: "signal-cathedral.entry", is: "fight" }, stage: "end-bloody" }, { stage: "end-clean" }],
    },
    ending("end-clean", "Juno went pale at the name.", "clean"),
    ending("end-bloody", "Juno went pale at the name. Then paler at the blood on your coat.", "bloody"),
  ],
  outcomes: {
    clean: {
      title: "Holy Ground", journal: "The Saints let you walk in and walk out. Juno knew the name Kade: 'Emergency broadcast. Meridian erased her. Ask Tomas - he knew the night shift.'",
      effects: [{ credits: 400 }, { xp: 1400 }, { give: "semicolon" }, { rep: "chrome-saints", by: 10 }, { setFlag: "hush.s2" }],
    },
    bloody: {
      title: "Chrome on the Floor", journal: "You took the uplink by force. Juno knew the name Kade: 'Emergency broadcast. Meridian erased her. Ask Tomas - he knew the night shift.'",
      effects: [{ credits: 400 }, { xp: 1500 }, { give: "semicolon" }, { rep: "chrome-saints", by: -20 }, { setFlag: "hush.s2" }],
    },
  },
};

const rootAccess: QuestDefinition2 = {
  id: "root-access", title: "Root Access", category: "story", giver: "tomas",
  summary: "Vesper Kade used to sit with Tomas and listen to the Ember Core breathe. Her old workshop is two streets east of the Core. Nobody has been in since the fire.",
  requires: { quest: "signal-cathedral" }, rewardHint: "500 cr, the wardens' seal", recommendedLevel: 8, start: "workshop",
  stages: [
    {
      id: "workshop", journal: "Tomas: 'She said every machine hums one note, if you listen long enough.' Find Kade's workshop east of the Core.",
      objectives: [{ id: "arrive", kind: "reach", text: "Find Kade's burned-out workshop", area: area(-384, -160, 10) }],
      next: "search",
    },
    {
      id: "search", journal: "Soot, rainwater, and the smell of hot glass. Search the workshop.",
      objectives: [
        { id: "journal", kind: "interact", text: "Find Kade's notes", object: "kade-journal-spot" },
        { id: "bench", kind: "interact", text: "Search the workbench", object: "kade-bench", optional: true },
        { id: "recorder", kind: "interact", text: "Play the recorder", object: "kade-recorder", optional: true },
      ],
      next: "ambush",
    },
    {
      id: "ambush", journal: "Pale figures step out of the smoke, humming. Kade's Choir keeps her secrets.",
      onEnter: [{ spawn: "hush-s3-wardens" }, { message: "Humming, from every direction. The Choir has found you.", tone: "danger" }],
      objectives: [{ id: "clear", kind: "clear", text: "Survive the Hush wardens", encounter: "hush-s3-wardens" }],
      next: "wren",
    },
    {
      id: "wren", journal: "The Last Tree is the antenna. The seed keeper holds the wardens' seal. Go to Sister Wren in the Rain Gardens.",
      onEnter: [{ waypoint: { x: -494, z: 272, label: "Sister Wren" } }],
      objectives: [{ id: "sigil", kind: "choose", text: "Ask Sister Wren for the wardens' seal", dialogue: "hush.wren", options: ["take-sigil", "show-journal"] }],
    },
  ],
  outcomes: {
    done: {
      title: "The Seed Keeper's Seal", journal: "Wren pressed the Warden Sigil into your hand. 'The gate is on the north side of the roots. Come back when you're ready. Not before.'",
      effects: [{ credits: 500 }, { xp: 2200 }, { setFlag: "hush.s3" }],
    },
  },
};

const hollowChoir: QuestDefinition2 = {
  id: "hollow-choir", title: "The Hollow Choir", category: "story", giver: "wren",
  summary: "Under The Last Tree, Vesper Kade conducts forty-one stolen voices through the roots of the city. The Warden Sigil opens the gate. End the song.",
  requires: { quest: "root-access" }, rewardHint: "Legendary: the Bell Character and the Choir Mantle", recommendedLevel: 10, start: "approach",
  stages: [
    {
      id: "approach", journal: "Rootwood Park after dark. The Choir patrols the paths to the warden gate.",
      onEnter: [{ spawn: "hush-s4-patrol" }, { waypoint: { x: GATE.x, z: GATE.z, label: "Warden gate" } }],
      objectives: [
        { id: "gate", kind: "reach", text: "Reach the warden gate at the roots", area: area(GATE.x, GATE.z, 8) },
        { id: "patrol", kind: "clear", text: "Silence the Choir patrol", encounter: "hush-s4-patrol", optional: true },
      ],
      next: "gate",
    },
    {
      id: "gate", journal: "The gate is brass and older than the city. The sigil fits.",
      objectives: [{ id: "open", kind: "interact", text: "Open the warden gate with the sigil", object: "hush-warden-gate" }],
      next: "choir",
    },
    {
      id: "choir", journal: "The Choirmaster holds court beneath the Tree. Forty-one voices sing through her. Break the frame.",
      onEnter: [{ spawn: "hush-boss" }],
      objectives: [{ id: "boss", kind: "kill", text: "Defeat Vesper Kade, the Choirmaster", count: 1, archetype: "choirmaster", encounter: "hush-boss" }],
      next: "verdict",
    },
    {
      id: "verdict", journal: "The frame is in pieces. Inside it, tangled in root and wire, Vesper Kade is still breathing.",
      onEnter: [{ message: "The song stops. Somewhere in the wreck, someone coughs.", tone: "quest" }],
      objectives: [{ id: "vesper", kind: "choose", text: "Decide what happens to Vesper Kade", dialogue: "hush.kade", options: ["spare", "finish"] }],
      next: "seed",
    },
    {
      id: "seed", journal: "At the heart of the roots, a crystal the size of a tooth holds forty-one voices.",
      objectives: [{ id: "heart", kind: "choose", text: "Decide what happens to the Hush Seed", dialogue: "hush.seed", options: ["destroy", "take"] }],
      next: [{ if: { flag: "hollow-choir.heart", is: "take" }, stage: "end-kept" }, { stage: "end-restored" }],
    },
    ending("end-restored", "You crushed the seed.", "restored"),
    ending("end-kept", "You pocketed the seed.", "kept"),
  ],
  outcomes: {
    restored: {
      title: "Say Something", journal: "The seed cracked like a knuckle. Across the city, forty-one people cleared their throats at the same moment, and the rain sounded like rain again.",
      effects: [{ setFlag: "hush.ending", value: "restored" }, { xp: 4000 }, { credits: 1500 }, { rep: "civilian", by: 25 }, { give: "last-leaf", count: 3 }, { message: "Somewhere by the Memory Gate, Lark starts to sing.", tone: "quest" }],
    },
    kept: {
      title: "A Quieter City", journal: "You kept the seed. Forty-one voices hum in your pocket. The city is a little quieter, and every broker from the Spire to the Circuit wants to know your price.",
      effects: [{ setFlag: "hush.ending", value: "kept" }, { xp: 4000 }, { credits: 1500 }, { rep: "ghosts", by: 10 }, { rep: "corpsec", by: 10 }, { message: "The seed is warm. It is humming a lullaby.", tone: "quest" }],
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
      node("reminder", ["Somebody is pulling voices out of my market, and I can't sell what I can't hear.", "Lark first. Then whatever she points you at."], [LEAVE]),
      node("after", ["Juno hears the quiet ones. If the Cathedral is singing, she'll know the tune."], [LEAVE]),
      node("after-restored", ["Forty-one voices back on the market. My index is worthless now.", "I've never been happier to lose money. Don't tell anyone."], [LEAVE]),
      node("after-kept", ["You're carrying the only copy of forty-one people.", "That makes you the most valuable thing in this market. Try not to get mugged."], [LEAVE]),
      node("seed", ["Is that - you brought it to me.", "I'll give you five thousand for it. And yes, I'll give them back. Eventually. For a fee."], [
        { id: "sell-seed", label: "Sell the Hush Seed (+5000 cr)", kind: "complete", condition: { item: "hush-seed" }, effects: [{ take: "hush-seed" }, { credits: 5000 }, { setFlag: "hush.seed-sold" }, { message: "Mara Voss now owns forty-one voices.", tone: "loot" }], next: "sold" },
        bye("It's not for sale."),
      ]),
      node("sold", ["Pleasure. The rain remembers people who keep their word.", "It remembers people who sell voices too. Just differently."], [LEAVE]),
    ],
  },
  {
    id: "hush.lark", npc: "lark", quest: "dead-air",
    entries: [{ condition: inStage("dead-air", "lark"), node: "slate", priority: 20 }, { condition: active("dead-air"), node: "waiting", priority: 18 }],
    nodes: [
      node("slate", ["[Lark wipes the slate with her sleeve and writes fast.]", "[IT WAS RAINING. I WAS SINGING. THE STREETLIGHT HUMMED MY SONG BACK AT ME.]", "[THEN I HAD NO SONG.]"], [
        go("lights", "Which streetlight?", "boxes"),
      ]),
      node("boxes", ["[She points up at the lamp over your head, then two fingers east, then one south-west.]", "[BOXES ON THREE LIGHTS. THEY HUM AT NIGHT. NOBODY ELSE HEARS IT.]"], [
        { id: "promise", label: "I'll find your song.", kind: "continue", next: "promised" },
      ]),
      node("promised", ["[She writes: DON'T PROMISE. JUST LOOK.]"], [LEAVE]),
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
      node("reminder", ["The Cathedral. The uplink. The routing table. I'll be here, listening."], [LEAVE]),
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
        "Said every machine in the city hums one note if you listen long enough. Said the rain hums it too.",
        "Her workshop was two streets east of here. Nobody's been in since the fire. Nobody wanted to.",
      ], [
        { id: "accept", label: "I'll go in.", effects: [{ startQuest: "root-access" }], next: "accepted" },
        bye("Not yet.", "decline"),
      ]),
      node("accepted", ["East along the street, past the pipes. If you hear humming, that's not the Core."], [LEAVE]),
      node("reminder", ["Find her notes. She wrote everything down. Engineers do."], [LEAVE]),
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
      node("given", ["Here. It's heavier than it looks. Most things that open doors are."], [LEAVE]),
      node("read", [
        "[She reads the last page for a long time.]",
        "'The Tree can hold them.' She never did understand that holding and keeping are different things.",
        "Take the seal. And these leaves - chew them when it hurts. It will hurt.",
      ], [LEAVE]),
      // The finale's offer and the in-quest reminder.
      node("offer", [
        "Tonight the Tree sings loudest. The warden gate is on the north side of the roots. The sigil opens it.",
        "What waits behind it was a person once. Try to remember that. Or don't. I'm a seed keeper, not a priest.",
      ], [
        { id: "accept", label: "I'm ready.", effects: [{ startQuest: "hollow-choir" }], next: "go" },
        bye("Not tonight.", "decline"),
      ]),
      node("go", ["North side of the roots. Mind the ones who hum."], [LEAVE]),
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
      node("spared", ["[She closes her eyes.] \"...Thank you. I think. It's so loud out here.\""], [LEAVE]),
      node("finished", ["[It is quick. Her pockets hold 300 credits and a conductor's tuning fork, still humming.]", "[Word will reach the Chrome Saints. They called her a heretic.]"], [LEAVE]),
    ],
  },
  {
    id: "hush.seed", npc: "hush-heart", quest: "hollow-choir",
    entries: [{ node: "heart" }],
    nodes: [
      node("heart", [
        "[Where the roots knot together, a crystal the size of a tooth pulses in time with nothing.]",
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
