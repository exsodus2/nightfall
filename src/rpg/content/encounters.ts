// Pack "street-encounters": the city has teeth. Roaming groups placed deliberately in the outer
// districts (never within 40 m of the spawn, a station, a venue door, the park or a quest giver;
// every point is walkable and the leash keeps them off the Silk Market avenue - see
// tests/street-encounters.test.ts), four new fighting forms (rusher, bruiser, drone, shield; see
// rpg/combat/forms.ts), and the Foundry's first real boss, the Foreman, with a repeatable contract.
//
//   Ghost Circuit alleys      Razorback razors in the alley crossing at (608, -416)
//   under the loop viaduct    Razorback overpass crew at (512, -128) ("on the overpass", per chat)
//   Rim Line NE yard approach Razorback yard crew at (704, -576)
//   Low Tide Gate docks       Spillway dock thugs at (704, 576) and the sluice crew at (640, 448)
//   Foundry                   a scrap-drone swarm at (-640, -384), a scrapyard picket at (-320, -512)
//   Neon Ward east            a CorpSec patrol at (192, -480): neutral until provoked
//   Foundry scrapyard         The Foreman at (-576, -640), a dead-end junction off the Rim road
//
// Respawns: 4-8 minutes after a clear, and only out of the player's sight (CombatWorld).

import type { ContentPack, EncounterDefinition, EnemyArchetype, ItemDefinition, LootTable, QuestDefinition2 } from "../types.ts";
import { FACE, area, look, member } from "./helpers.ts";

const SKIN = { pale: [214, 188, 164], tan: [182, 140, 108], brown: [128, 92, 70], deep: [92, 64, 50] } as const;

// ---- Items: enemy-only weapons, the Foreman's prize and drone salvage ---------------------------

const art = (rows: readonly string[]): readonly string[] => rows;

const ITEMS: readonly ItemDefinition[] = [
  {
    id: "scrap-drone-arc", name: "Drone arc emitter", kind: "ranged", rarity: "common", glyph: "*", value: 0, weight: 2, stack: 1, tags: ["noloot", "enemy-only"],
    description: "A drone's welding arc, retuned to throw sparks at people. It does not survive the drone.",
    weapon: { class: "pistol", damage: 6, range: 22, cooldown: 0.3, staminaCost: 0, magazine: 6, reload: 1.6, spread: 0.04, knockback: 0.1, stagger: 0.05 },
  },
  {
    id: "foreman-press", name: "Hydraulic press arm", kind: "melee", rarity: "common", glyph: "P", value: 0, weight: 40, stack: 1, tags: ["noloot", "enemy-only"],
    description: "Half a scrapyard press, bolted to a man. Not something you carry home.",
    weapon: { class: "blunt", damage: 20, range: 3.6, cooldown: 1.6, staminaCost: 0, arc: 70, knockback: 2.2, stagger: 0.6 },
  },
  {
    id: "double-pipe", name: "Double Pipe", kind: "melee", rarity: "epic", glyph: "H", value: 2400, weight: 7, stack: 1, tags: ["unique", "foundry"],
    description: "The Foreman's yard wrench: two pipes welded into one handle. Either the bolt turns or you do.",
    weapon: { class: "blunt", damage: 62, range: 2.8, cooldown: 0.7, staminaCost: 22, heavyMultiplier: 2.6, arc: 75, knockback: 3.2, stagger: 1.2, critChance: 0.1, critMultiplier: 1.9 },
    art: art([
      " _||_",
      "|_||_|",
      "  ||",
      "  ||",
      "  ||",
      " [__]",
    ]),
  },
  {
    id: "gyro-core", name: "Drone gyro core", kind: "junk", rarity: "uncommon", glyph: "@", value: 90, weight: 0.6, stack: 10, tags: ["mod", "salvage"],
    description: "A fist-sized gyroscope still spinning down. Workshops pay for these by the crate.",
  },
  {
    id: "servo-governor", name: "Servo governor mod", kind: "junk", rarity: "rare", glyph: "%", value: 320, weight: 0.4, stack: 5, tags: ["mod", "salvage"],
    description: "A drone's motion governor chip. Kiln Nine's crowd tune prosthetics with these.",
  },
];

// ---- Barks -------------------------------------------------------------------------------------

const RAZOR = {
  alert: ["FRESH CUTS!", "KNIVES OUT, BOYS!", "ON THE OVERPASS, TOURIST?"],
  hurt: ["SCRATCH!", "OI, THAT'S MY GOOD ARM!"],
  death: ["...too slow...", "...tell the Duchess..."],
} as const;
const DOCK = {
  alert: ["DOCK'S CLOSED.", "WRONG PIER, FRIEND.", "TIDE'S OUT. SO ARE YOU."],
  hurt: ["HOLD THE HATCH!", "SALT IN IT!"],
  death: ["...back to the water...", "...ugh..."],
} as const;
const DRONE = {
  alert: ["TRESPASS LOGGED.", "TARGET ACQUIRED.", "PROPERTY OF THE YARD."],
  hurt: ["HULL BREACH.", "*bzzt*"],
  death: ["...power... fail...", "...signal lost..."],
} as const;
const CORP = {
  alert: ["HALT. CORPSEC.", "STAND DOWN, CITIZEN.", "SHIELD UP. ADVANCING."],
  hurt: ["TAKING FIRE.", "HOLD THE LINE."],
  death: ["...officer down...", "...shield... down..."],
} as const;

// ---- Archetypes ----------------------------------------------------------------------------------

const ARCHETYPES: readonly EnemyArchetype[] = [
  // Razorbacks.
  {
    id: "rb-razor", name: "Razorback razor", faction: "razorbacks", health: 50, armor: 0, speed: { walk: 1.9, run: 6.6 },
    weapon: "backtick-shiv", reaction: 0.4, aggression: 0.9, perception: { sight: 36, fovDegrees: 120, hearing: 32 },
    look: look([170, 40, 48], [40, 18, 20], SKIN.tan, [255, 60, 90], "bare", null, "sway"),
    loot: "street-razor", xp: 32, tags: ["razorback", "gang", "form:rusher"], barks: RAZOR,
  },
  {
    id: "rb-scattergun", name: "Razorback scattergun", faction: "razorbacks", health: 130, armor: 0.15, speed: { walk: 1.5, run: 4.2 },
    weapon: "colon-scatter", reaction: 0.7, aggression: 0.6, perception: { sight: 40, fovDegrees: 110, hearing: 36 }, scale: 1.15,
    look: look([120, 40, 34], [40, 22, 20], SKIN.brown, [255, 120, 50], "cap", null, "breathe"),
    loot: "street-bruiser", xp: 60, tags: ["razorback", "gang", "heavy", "form:bruiser"], barks: RAZOR,
  },
  {
    id: "rb-bulwark", name: "Razorback car-door", faction: "razorbacks", health: 110, armor: 0.1, speed: { walk: 1.5, run: 4.4 },
    weapon: "pipe-operator", reaction: 0.6, aggression: 0.7, perception: { sight: 34, fovDegrees: 110, hearing: 30 }, scale: 1.05,
    look: look([136, 52, 42], [44, 26, 22], SKIN.deep, [255, 96, 64], "bare", null, "breathe"),
    loot: "street-shield", xp: 55, tags: ["razorback", "gang", "form:shield"],
    barks: { alert: ["BEHIND THE DOOR, LADS!", "KNOCK KNOCK!"], hurt: ["HA! DENTED!"], death: ["...door's... open..."] },
  },
  // Spillway dockers.
  {
    id: "dock-hand", name: "Dock hand", faction: "dockers", health: 60, armor: 0.05, speed: { walk: 1.6, run: 5 },
    weapon: "pipe-operator", reaction: 0.7, aggression: 0.65, perception: { sight: 32, fovDegrees: 110, hearing: 28 },
    look: look([44, 70, 84], [20, 30, 36], SKIN.pale, [255, 196, 96], "cap", null, "swing"),
    loot: "street-dock", xp: 24, tags: ["dockers", "gang"], barks: DOCK,
  },
  {
    id: "dock-bruiser", name: "Dock bruiser", faction: "dockers", health: 140, armor: 0.15, speed: { walk: 1.5, run: 4.2 },
    weapon: "colon-scatter", reaction: 0.7, aggression: 0.6, perception: { sight: 40, fovDegrees: 110, hearing: 34 }, scale: 1.2,
    look: look([36, 58, 70], [18, 26, 30], SKIN.brown, [255, 176, 70], "bare", null, "breathe"),
    loot: "street-bruiser", xp: 65, tags: ["dockers", "gang", "heavy", "form:bruiser"], barks: DOCK,
  },
  {
    id: "dock-hatchman", name: "Hatch-door hauler", faction: "dockers", health: 120, armor: 0.1, speed: { walk: 1.4, run: 4.2 },
    weapon: "pipe-operator", reaction: 0.6, aggression: 0.7, perception: { sight: 34, fovDegrees: 110, hearing: 30 }, scale: 1.1,
    look: look([52, 64, 72], [22, 28, 32], SKIN.tan, [255, 210, 120], "cap", null, "breathe"),
    loot: "street-shield", xp: 60, tags: ["dockers", "gang", "form:shield"], barks: DOCK,
  },
  // Foundry scrapyard.
  {
    id: "scrap-drone", name: "Scrap drone", faction: "scrappers", health: 40, armor: 0.1, speed: { walk: 2.4, run: 6 },
    weapon: "scrap-drone-arc", reaction: 0.5, aggression: 1, perception: { sight: 46, fovDegrees: 140, hearing: 40 },
    look: look([96, 100, 108], [40, 42, 48], [150, 150, 156], [255, 150, 60], "visor", null, "scan"),
    loot: "street-drone", xp: 35, tags: ["scrapper", "machine", "form:drone"], barks: DRONE,
  },
  {
    id: "scrap-runner", name: "Scrap runner", faction: "scrappers", health: 55, armor: 0.05, speed: { walk: 1.9, run: 6.4 },
    weapon: "backtick-shiv", reaction: 0.45, aggression: 0.9, perception: { sight: 36, fovDegrees: 120, hearing: 32 },
    look: look([140, 92, 46], [52, 36, 24], SKIN.tan, [255, 150, 60], "mask", null, "sway"),
    loot: "street-razor", xp: 32, tags: ["scrapper", "form:rusher"],
    barks: { alert: ["YARD RULES: FINDERS KEEPERS.", "HE'S GOT PARTS!"], hurt: ["OW, HOT!"], death: ["...scrap me..."] },
  },
  // CorpSec.
  {
    id: "corp-bulwark", name: "CorpSec bulwark", faction: "corpsec", health: 150, armor: 0.35, speed: { walk: 1.5, run: 4 },
    weapon: "segfault", reaction: 0.5, aggression: 0.7, perception: { sight: 48, fovDegrees: 120, hearing: 40 }, scale: 1.1,
    look: look([40, 56, 84], [18, 22, 32], SKIN.brown, [96, 180, 255], "visor", null, "breathe"),
    loot: "street-corp", xp: 80, tags: ["corpsec", "security", "heavy", "form:shield"], barks: CORP,
  },
  // The boss.
  {
    id: "foreman", name: "The Foreman", faction: "scrappers", health: 1400, armor: 0.2, speed: { walk: 1.7, run: 4.2 },
    weapon: "foreman-press", reaction: 0.3, aggression: 1, perception: { sight: 50, fovDegrees: 170, hearing: 60 }, scale: 1.7,
    look: look([150, 96, 40], [50, 36, 24], [150, 110, 86], [255, 150, 50], "mask", null, "breathe"),
    loot: "boss-foreman", xp: 700, tags: ["scrapper", "boss", "foreman"],
    barks: { alert: ["SHIFT'S OVER, SCAB.", "YOU'RE ON MY CLOCK NOW."], hurt: ["THAT'LL BUFF OUT.", "OVERTIME, THEN."], death: ["...clock... out..."] },
    boss: {
      title: "Boss of the Scrapyard",
      phases: [
        { atHealth: 1, attacks: ["slam", "sweep", "charge"] },
        { atHealth: 0.6, message: "The Foreman leans on the yard horn. Scrap drones lift off the stacks.", spawn: "foreman-drones", speedMultiplier: 1.1, damageMultiplier: 1.1, attacks: ["barrage", "slam", "summon", "charge"] },
        { atHealth: 0.3, message: "The Foreman vents his press arm. The yard floor rings like a bell: jump the rings.", speedMultiplier: 1.2, damageMultiplier: 1.2, attacks: ["shockwave", "slam", "barrage", "sweep"] },
      ],
    },
  },
];

// ---- Loot: each archetype's signature drops on top of a combat tier (rpg/items loot.ts) --------

const LOOT: readonly LootTable[] = [
  { id: "street-razor", rolls: 1, empty: 0.75, also: ["tier-street"], entries: [{ item: "backtick-shiv", weight: 3 }, { item: "ammo-pistol", weight: 4, min: 3, max: 6 }, { item: "stim", weight: 3 }] },
  { id: "street-dock", rolls: 1, empty: 0.7, also: ["tier-street"], entries: [{ item: "pipe-operator", weight: 2 }, { item: "copper-scrap", weight: 4, min: 1, max: 3 }, { item: "ammo-shell", weight: 3, min: 2, max: 4 }] },
  { id: "street-bruiser", rolls: 1, empty: 0.6, also: ["tier-veteran"], entries: [{ item: "colon-scatter", weight: 2 }, { item: "ammo-shell", weight: 6, min: 4, max: 8 }, { item: "stim", weight: 3 }] },
  { id: "street-shield", rolls: 1, empty: 0.6, also: ["tier-veteran"], entries: [{ item: "pipe-operator", weight: 2 }, { item: "kevlar-weave", weight: 1 }, { item: "stim", weight: 4 }, { item: "ammo-pistol", weight: 3, min: 4, max: 8 }] },
  { id: "street-drone", rolls: 1, empty: 0.4, also: ["tier-street"], entries: [{ item: "gyro-core", weight: 6 }, { item: "circuit-board", weight: 6 }, { item: "servo-governor", weight: 1 }, { item: "ammo-pistol", weight: 3, min: 3, max: 8 }] },
  { id: "street-corp", rolls: 1, empty: 0.6, also: ["tier-elite"], entries: [{ item: "segfault", weight: 1 }, { item: "riot-helm", weight: 2 }, { item: "ammo-rifle", weight: 4, min: 6, max: 12 }] },
  {
    id: "boss-foreman", rolls: 3, empty: 0, credits: [500, 900], also: ["foreman-prize", "boss-prize"],
    entries: [
      { item: "medkit", weight: 8, min: 1, max: 2 }, { item: "shield-cell", weight: 5 }, { item: "servo-governor", weight: 4, min: 1, max: 2 },
      { item: "gyro-core", weight: 5, min: 2, max: 4 }, { item: "ammo-shell", weight: 4, min: 6, max: 12 }, { item: "overclock-tab", weight: 3 },
    ],
  },
  /** The unique: the Foreman always drops his wrench. */
  { id: "foreman-prize", rolls: 1, empty: 0, entries: [{ item: "double-pipe", weight: 1 }] },
];

// ---- Encounters ------------------------------------------------------------------------------------

/** The Foreman's scrapyard: a dead-end junction deep in the Foundry, off the Rim road. */
export const FOREMAN_YARD = area(-576, -640, 22, "The Foreman's scrapyard");

const ENCOUNTERS: readonly EncounterDefinition[] = [
  {
    id: "street-gc-alley", label: "Razorback razors (Ghost Circuit alleys)", area: area(608, -416, 14), auto: true, respawn: 300, hostile: true,
    members: [
      member("rb-razor", 608, -404, FACE.south), member("rb-razor", 596, -416, FACE.east),
      member("rb-gunner", 620, -416, FACE.west), member("rb-bulwark", 608, -416, FACE.north),
    ],
  },
  {
    id: "street-gc-overpass", label: "Razorback overpass crew (Ghost Circuit)", area: area(512, -128, 16), auto: true, respawn: 360, hostile: true,
    members: [
      member("rb-scattergun", 512, -112, FACE.south),
      member("rb-razor", 504, -136, FACE.north, { patrol: [{ x: 504, z: -144 }, { x: 504, z: -112 }] }),
      member("rb-gunner", 520, -120, FACE.west),
    ],
  },
  {
    id: "street-rim-yard", label: "Razorback yard crew (Rim Line, north-east)", area: area(704, -576, 16), auto: true, respawn: 420, hostile: true,
    members: [
      member("rb-bulwark", 704, -560, FACE.south), member("rb-razor", 698, -584, FACE.north),
      member("rb-scattergun", 710, -568, FACE.west), member("rb-gunner", 712, -584, FACE.north),
    ],
  },
  {
    id: "street-lowtide-dock", label: "Dock thugs (Low Tide Gate)", area: area(704, 576, 16), auto: true, respawn: 300, hostile: true,
    members: [
      member("dock-bruiser", 704, 590, FACE.north), member("dock-hatchman", 698, 570, FACE.south),
      member("dock-hand", 710, 582, FACE.west), member("dock-hand", 690, 576, FACE.east),
    ],
  },
  {
    id: "street-sluice", label: "Dock crew (Spillway sluice)", area: area(640, 448, 16), auto: true, respawn: 360, hostile: true,
    members: [
      member("dock-hatchman", 640, 432, FACE.north), member("dock-bruiser", 652, 448, FACE.west),
      member("dock-hand", 632, 440, FACE.east, { patrol: [{ x: 632, z: 440 }, { x: 632, z: 460 }] }), member("dock-hand", 648, 456, FACE.south),
    ],
  },
  {
    id: "street-foundry-drones", label: "Scrap drone swarm (Foundry)", area: area(-640, -384, 18), auto: true, respawn: 300, hostile: true,
    members: [member("scrap-drone", -632, -392, FACE.west), member("scrap-drone", -648, -376, FACE.east), member("scrap-drone", -626, -380, FACE.south)],
  },
  {
    id: "street-foundry-picket", label: "Scrapyard picket (Foundry)", area: area(-320, -512, 16), auto: true, respawn: 300, hostile: true,
    members: [
      member("scrap-drone", -312, -504, FACE.north), member("scrap-drone", -328, -520, FACE.south),
      member("scrap-runner", -320, -500, FACE.north), member("scrap-runner", -308, -516, FACE.west),
    ],
  },
  {
    // Neutral: they walk their beat until you hit one of them or hurt a civilian nearby.
    id: "street-corpsec-patrol", label: "CorpSec patrol (Neon Ward east)", area: area(192, -480, 24), auto: true, respawn: 300, hostile: false,
    members: [
      member("corp-bulwark", 192, -480, FACE.north, { patrol: [{ x: 192, z: -448 }, { x: 192, z: -512 }] }),
      member("corp-trooper", 186, -460, FACE.north, { patrol: [{ x: 186, z: -444 }, { x: 186, z: -508 }] }),
      member("corp-trooper", 198, -502, FACE.south),
    ],
  },
  {
    id: "foreman-yard", label: "The Foreman's scrapyard (Foundry)", area: FOREMAN_YARD, auto: true, respawn: 480, hostile: true,
    members: [member("foreman", -576, -640, FACE.north, { tag: "boss" })],
  },
  {
    // Phase-two reinforcements (spawned by the Foreman's yard horn).
    id: "foreman-drones", label: "The Foreman's drones", area: FOREMAN_YARD, hostile: true,
    members: [member("scrap-drone", -568, -650, FACE.north), member("scrap-drone", -584, -632, FACE.south)],
  },
];

// ---- The contract ------------------------------------------------------------------------------------

/** Walking into the scrapyard's reach posts the contract; it comes back 15 minutes after it pays. */
const CONTRACT: QuestDefinition2 = {
  id: "foreman-contract", title: "Contract: The Foreman", category: "contract", giver: null,
  summary: "A price on the Foundry's scrapyard boss: he strips anyone who wanders into his yard, and the Kiln crowd want their junction back.",
  rewardHint: "600 cr, 500 XP, his wrench", recommendedLevel: 7, repeatable: { cooldown: 900 },
  trigger: { x: FOREMAN_YARD.x, z: FOREMAN_YARD.z, radius: 70 }, start: "hunt",
  stages: [
    {
      id: "hunt", journal: "The Foreman holds the dead-end junction in the Foundry's south-west, off the Rim road. Phase two brings his drones; phase three shakes the ground in rings you can jump.",
      onEnter: [{ waypoint: { x: FOREMAN_YARD.x, z: FOREMAN_YARD.z, label: "The Foreman" } }],
      objectives: [{ id: "foreman", kind: "kill", text: "Take down the Foreman in his scrapyard", count: 1, archetype: "foreman", target: { x: FOREMAN_YARD.x, z: FOREMAN_YARD.z } }],
      onComplete: [{ outcome: "paid" }],
    },
  ],
  outcomes: {
    paid: {
      title: "Contract Paid", journal: "The Foreman clocked out. The contract paid on the spot; the yard will find a new boss soon enough.",
      effects: [{ credits: 600 }, { xp: 500 }, { message: "Contract paid: 600 cr. The yard horn goes quiet.", tone: "loot" }],
    },
  },
};

/** Street encounters, their archetypes, loot and the Foreman contract. */
export const STREET_ENCOUNTERS_PACK: ContentPack = {
  id: "street-encounters",
  items: ITEMS,
  loot: LOOT,
  archetypes: ARCHETYPES,
  encounters: ENCOUNTERS,
  quests: [CONTRACT],
};
