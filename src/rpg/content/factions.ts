// Pack "factions": the city's four hostile factions (plus the Choir, the story's cult), their loot,
// and the roaming encounters that make the streets feel lived in. Enemies carry catalogue weapons
// (rpg/items ITEMS) so what they swing is what they drop.
//
// Level curve (places.ts DISTRICT_LEVEL): Razorback pups loiter near the spawn and only fight if
// provoked; real gangs hold the Spillway and the Rain Gardens edge; CorpSec checkpoints guard the
// Spire; the Foundry toll crews hit harder; the Ghost Circuit (Saints and Ghosts) is endgame.

import type { ContentPack, EncounterDefinition, EnemyArchetype, LootTable } from "../types.ts";
import { FACE, area, look, member } from "./helpers.ts";

const SKIN = { pale: [214, 188, 164], tan: [182, 140, 108], brown: [128, 92, 70], deep: [92, 64, 50], grey: [170, 170, 176] } as const;

// ---- Barks (ASCII, short: they float over heads) ---------------------------------------------
const RAZOR = {
  alert: ["OI! WRONG STREET.", "TUSKS OUT!", "FRESH WALLET!", "GET HIM!"],
  hurt: ["THAT'S IT?", "ARGH!", "YOU'RE PAYING FOR THAT."],
  death: ["...tell my mum...", "...ugh", "...not the face..."],
} as const;
const SAINTS = {
  alert: ["UNCLEAN.", "THE FLESH IS WEAK.", "BE PURIFIED.", "KNEEL."],
  hurt: ["PAIN IS DATA.", "I FEEL NOTHING.", "CHROME ENDURES."],
  death: ["...take me... up...", "...ascend...", "...static..."],
} as const;
const CORP = {
  alert: ["CONTACT.", "HOSTILE SIGHTED.", "YOU ARE TRESPASSING.", "STAND DOWN."],
  hurt: ["TAKING FIRE.", "MEDIC.", "OFFICER HIT."],
  death: ["...officer down", "...tell legal...", "...pension..."],
} as const;
const GHOSTS = {
  alert: ["PING.", "FOUND YOU.", "HELLO WORLD.", "YOU'RE ON CAMERA."],
  hurt: ["LAG.", "PACKET LOSS.", "OW. RUDE."],
  death: ["...disconnected", "...404...", "...logging off"],
} as const;
const CHOIR = {
  alert: ["HUSH.", "SHHHH.", "BE STILL.", "LISTEN."],
  hurt: ["...", "HUSH NOW.", "QUIET."],
  death: ["...finally... quiet...", "...", "...thank you..."],
} as const;

// ---- Archetypes ------------------------------------------------------------------------------

const razorbacks: EnemyArchetype[] = [
  {
    id: "rb-pup", name: "Razorback pup", faction: "razorbacks", health: 40, armor: 0, speed: { walk: 1.7, run: 5.4 },
    weapon: "backtick-shiv", reaction: 0.9, aggression: 0.55, perception: { sight: 26, fovDegrees: 100, hearing: 22 },
    look: look([150, 70, 52], [48, 30, 26], SKIN.tan, [255, 130, 90], "cap", null, "sway"),
    loot: "rb-pup", xp: 15, tags: ["razorback", "gang", "pup"],
    barks: { alert: ["WE'RE NOT SCARED OF YOU!", "MY BROTHER'S A BRUTE!"], hurt: ["OW! OW!", "NOT FAIR!"], death: ["...mum..."] },
  },
  {
    id: "rb-thug", name: "Razorback thug", faction: "razorbacks", health: 55, armor: 0.05, speed: { walk: 1.6, run: 5.2 },
    weapon: "pipe-operator", reaction: 0.7, aggression: 0.7, perception: { sight: 32, fovDegrees: 110, hearing: 28 },
    look: look([128, 46, 40], [42, 24, 22], SKIN.tan, [255, 96, 64], "bare", null, "swing"),
    loot: "rb-grunt", xp: 22, tags: ["razorback", "gang"], barks: RAZOR,
  },
  {
    id: "rb-gunner", name: "Razorback gunner", faction: "razorbacks", health: 45, armor: 0, speed: { walk: 1.6, run: 4.6 },
    weapon: "caret-45", reaction: 0.9, aggression: 0.35, perception: { sight: 44, fovDegrees: 100, hearing: 36 },
    look: look([110, 52, 40], [40, 24, 20], SKIN.brown, [255, 140, 60], "cap", null, "scan"),
    loot: "rb-grunt", xp: 28, tags: ["razorback", "gang"], barks: RAZOR,
  },
  {
    id: "rb-brute", name: "Razorback brute", faction: "razorbacks", health: 160, armor: 0.18, speed: { walk: 1.3, run: 4.0 },
    weapon: "hash-hammer", reaction: 0.8, aggression: 0.95, perception: { sight: 28, fovDegrees: 100, hearing: 30 }, scale: 1.25,
    look: look([150, 40, 34], [30, 14, 12], SKIN.deep, [255, 70, 40], "hood", null, "breathe"),
    loot: "rb-heavy", xp: 65, tags: ["razorback", "gang", "heavy"],
    barks: { alert: ["SMASH.", "COME HERE, LITTLE ONE."], hurt: ["TICKLES."], death: ["...heavy... so heavy..."] },
  },
  {
    id: "rb-lieutenant", name: "Razorback lieutenant", faction: "razorbacks", health: 120, armor: 0.12, speed: { walk: 1.7, run: 5.0 },
    weapon: "colon-scatter", reaction: 0.5, aggression: 0.6, perception: { sight: 44, fovDegrees: 130, hearing: 44 },
    look: look([170, 60, 30], [50, 20, 10], SKIN.tan, [255, 170, 40], "cap", "case", "sway"),
    loot: "rb-heavy", xp: 90, tags: ["razorback", "gang", "officer"],
    barks: { alert: ["BOYS! COMPANY!", "THIS CORNER'S TAXED."], hurt: ["YOU'LL BLEED FOR THAT."], death: ["...the Duchess... will hear..."] },
  },
];

const saints: EnemyArchetype[] = [
  {
    id: "cs-acolyte", name: "Chrome Saint acolyte", faction: "chrome-saints", health: 85, armor: 0.2, speed: { walk: 1.4, run: 4.8 },
    weapon: "segfault", reaction: 0.6, aggression: 0.8, perception: { sight: 38, fovDegrees: 120, hearing: 34 },
    look: look([196, 200, 210], [80, 84, 96], SKIN.pale, [255, 230, 150], "hood", "lantern", "breathe"),
    loot: "saints", xp: 45, tags: ["saint", "cult"], barks: SAINTS,
  },
  {
    id: "cs-zealot", name: "Zealot sniper", faction: "chrome-saints", health: 60, armor: 0.1, speed: { walk: 1.5, run: 4.2 },
    weapon: "semicolon", reaction: 1.0, aggression: 0.15, perception: { sight: 70, fovDegrees: 70, hearing: 30 },
    look: look([160, 166, 180], [60, 64, 76], SKIN.grey, [255, 215, 120], "visor", "antenna", "scan"),
    loot: "saints", xp: 60, tags: ["saint", "cult", "sniper"], barks: SAINTS,
  },
  {
    id: "cs-saint", name: "Chrome Saint", faction: "chrome-saints", health: 240, armor: 0.35, speed: { walk: 1.8, run: 5.6 },
    weapon: "backslash", reaction: 0.35, aggression: 0.9, perception: { sight: 50, fovDegrees: 150, hearing: 50 }, scale: 1.15,
    look: look([228, 230, 236], [120, 110, 80], SKIN.grey, [255, 240, 190], "bare", "lantern", "sway"),
    loot: "saint-elite", xp: 170, tags: ["saint", "cult", "elite"],
    barks: { alert: ["I WAS FLESH ONCE. I REMEMBER THE SHAME.", "COME. BE CORRECTED."], hurt: ["A SCRATCH ON GOD."], death: ["...the chrome... lied..."] },
  },
];

const corpsec: EnemyArchetype[] = [
  {
    id: "corp-trooper", name: "CorpSec trooper", faction: "corpsec", health: 95, armor: 0.25, speed: { walk: 1.8, run: 5.0 },
    weapon: "brace-burst", reaction: 0.5, aggression: 0.5, perception: { sight: 56, fovDegrees: 120, hearing: 44 },
    look: look([58, 68, 92], [20, 24, 34], SKIN.tan, [110, 200, 255], "visor", null, "breathe"),
    loot: "corpsec-kit", xp: 50, tags: ["corpsec", "security"], barks: CORP,
  },
  {
    id: "corp-shield", name: "CorpSec shield", faction: "corpsec", health: 150, armor: 0.45, speed: { walk: 1.4, run: 3.8 },
    weapon: "segfault", reaction: 0.6, aggression: 0.85, perception: { sight: 44, fovDegrees: 110, hearing: 40 }, scale: 1.1,
    look: look([44, 52, 70], [18, 20, 28], SKIN.brown, [90, 170, 255], "visor", "case", "breathe"),
    loot: "corpsec-kit", xp: 75, tags: ["corpsec", "security", "heavy"],
    barks: { alert: ["SHIELD UP.", "MOVE ALONG. NOW."], hurt: ["HOLDING."], death: ["...shield... down..."] },
  },
  {
    id: "corp-handler", name: "CorpSec drone-handler", faction: "corpsec", health: 75, armor: 0.2, speed: { walk: 1.7, run: 4.6 },
    weapon: "quote-magnum", reaction: 0.7, aggression: 0.3, perception: { sight: 64, fovDegrees: 160, hearing: 50 },
    look: look([70, 80, 104], [24, 28, 40], SKIN.pale, [140, 230, 255], "visor", "antenna", "scan"),
    loot: "corpsec-kit", xp: 65, tags: ["corpsec", "security", "handler"],
    barks: { alert: ["DRONES HAVE YOU.", "EYES ON TARGET."], hurt: ["FEED'S DOWN!"], death: ["...lost... signal..."] },
  },
];

const ghosts: EnemyArchetype[] = [
  {
    id: "ghost-blinker", name: "Ghost blinker", faction: "ghosts", health: 55, armor: 0.05, speed: { walk: 2.2, run: 6.4 },
    weapon: "asterisk-smg", reaction: 0.4, aggression: 0.25, perception: { sight: 48, fovDegrees: 130, hearing: 52 },
    look: look([30, 30, 40], [12, 12, 18], SKIN.pale, [170, 120, 255], "hood", null, "scan"),
    loot: "ghosts", xp: 55, tags: ["ghost", "hacker"], barks: GHOSTS,
  },
  {
    id: "ghost-glitchknife", name: "Glitch-knife", faction: "ghosts", health: 80, armor: 0.1, speed: { walk: 2.0, run: 6.8 },
    weapon: "ampersand", reaction: 0.3, aggression: 1, perception: { sight: 40, fovDegrees: 140, hearing: 60 },
    look: look([24, 26, 30], [10, 10, 14], SKIN.brown, [120, 255, 170], "hood", null, "sway"),
    loot: "ghosts", xp: 80, tags: ["ghost", "assassin"],
    barks: { alert: ["BEHIND YOU. NO, THE OTHER BEHIND."], hurt: ["TCH."], death: ["...respawn... in... 5..."] },
  },
];

/** The Choir: people who gave their voices to the Choirmaster, and now keep her garden quiet. */
const choir: EnemyArchetype[] = [
  {
    id: "choir-warden", name: "Hush warden", faction: "choir", health: 120, armor: 0.25, speed: { walk: 1.6, run: 5.2 },
    weapon: "forward-slash", reaction: 0.5, aggression: 0.8, perception: { sight: 40, fovDegrees: 140, hearing: 50 },
    look: look([90, 110, 100], [40, 50, 46], SKIN.grey, [120, 255, 220], "hood", "lantern", "breathe"),
    loot: "choir", xp: 75, tags: ["choir", "cult"], barks: CHOIR,
  },
  {
    id: "choir-cantor", name: "Choir cantor", faction: "choir", health: 85, armor: 0.15, speed: { walk: 1.6, run: 4.8 },
    weapon: "asterisk-smg", reaction: 0.7, aggression: 0.4, perception: { sight: 50, fovDegrees: 120, hearing: 44 },
    look: look([120, 130, 126], [50, 56, 54], SKIN.pale, [160, 255, 230], "bare", "antenna", "sway"),
    loot: "choir", xp: 70, tags: ["choir", "cult"], barks: CHOIR,
  },
];

// ---- Loot tables (the base tables in rpg/items loot.ts do the heavy lifting via `also`) --------

const loot: LootTable[] = [
  {
    id: "rb-pup", rolls: 1, empty: 0.45, credits: [2, 10],
    entries: [{ item: "synth-ration", weight: 6 }, { item: "copper-scrap", weight: 8 }, { item: "burnt-chip", weight: 6 }, { item: "stim", weight: 3 }, { item: "backtick-shiv", weight: 1 }],
  },
  {
    id: "rb-grunt", rolls: 1, empty: 0.88, also: ["street-thug"],
    entries: [{ item: "pipe-operator", weight: 3 }, { item: "caret-45", weight: 2 }, { item: "mesh-hoodie", weight: 2 }, { item: "visor-cap", weight: 1 }],
  },
  {
    id: "rb-heavy", rolls: 1, empty: 0.6, also: ["gang-lieutenant"],
    entries: [{ item: "hash-hammer", weight: 1 }, { item: "colon-scatter", weight: 2 }, { item: "kevlar-weave", weight: 2 }, { item: "ammo-shell", weight: 4, min: 2, max: 6 }],
  },
  {
    id: "saints", rolls: 2, empty: 0.35, credits: [15, 60],
    entries: [
      { item: "stim", weight: 8 }, { item: "medkit", weight: 4 }, { item: "circuit-board", weight: 8 }, { item: "neon-tube", weight: 6 },
      { item: "focus-chip", weight: 2 }, { item: "ammo-rifle", weight: 6, min: 3, max: 8 }, { item: "segfault", weight: 2 },
      { item: "semicolon", weight: 0.6 }, { item: "pool:rare:gear", weight: 2 }, { item: "pool:epic:gear", weight: 0.3 },
    ],
  },
  {
    id: "saint-elite", rolls: 2, empty: 0.1, credits: [60, 160],
    entries: [
      { item: "medkit", weight: 6 }, { item: "shield-cell", weight: 4 }, { item: "backslash", weight: 1 }, { item: "chrome-carapace", weight: 0.6 },
      { item: "pool:rare:gear", weight: 5 }, { item: "pool:epic:gear", weight: 1.2 }, { item: "pool:legendary:gear", weight: 0.1 },
    ],
  },
  {
    id: "corpsec-kit", rolls: 1, empty: 0.85, also: ["corpsec"],
    entries: [{ item: "brace-burst", weight: 2 }, { item: "riot-helm", weight: 3 }, { item: "firewall-vest", weight: 1 }, { item: "quote-magnum", weight: 1 }],
  },
  {
    id: "ghosts", rolls: 2, empty: 0.3, credits: [20, 90],
    entries: [
      { item: "focus-chip", weight: 5 }, { item: "haste-inhaler", weight: 5 }, { item: "data-shard", weight: 10 }, { item: "encrypted-drive", weight: 3 },
      { item: "burnt-chip", weight: 8 }, { item: "asterisk-smg", weight: 1.5 }, { item: "tilde-whip", weight: 1 }, { item: "ampersand", weight: 0.3 },
      { item: "visor-cap", weight: 2 }, { item: "pool:rare:gear", weight: 2.5 }, { item: "pool:epic:gear", weight: 0.5 },
    ],
  },
  {
    id: "choir", rolls: 2, empty: 0.3, credits: [20, 70],
    entries: [
      { item: "data-shard", weight: 6 }, { item: "circuit-board", weight: 6 }, { item: "stim", weight: 8 }, { item: "medkit", weight: 4 },
      { item: "shield-cell", weight: 3 }, { item: "forward-slash", weight: 1.5 }, { item: "pool:rare:gear", weight: 3 }, { item: "pool:epic:gear", weight: 0.6 },
    ],
  },
  /** Named bounty targets: a guaranteed good roll on top of lieutenant loot. */
  {
    id: "bounty-mark", rolls: 2, empty: 0, credits: [80, 200], also: ["gang-lieutenant"],
    entries: [{ item: "pool:rare:gear", weight: 6 }, { item: "pool:epic:gear", weight: 1.5 }, { item: "medkit", weight: 5 }, { item: "encrypted-drive", weight: 3 }],
  },
  /** People you should not be killing drop nothing (it's not that kind of game). */
  { id: "no-loot", rolls: 0, entries: [] },
];

// ---- Roaming world encounters ----------------------------------------------------------------
// `auto` groups that respawn: the city's background violence. Hostile ones attack on sight;
// the rest mind their business unless you start something.

const roaming: EncounterDefinition[] = [
  {
    id: "roam-rb-pups", label: "Razorback pups (Silk Market)", area: area(72, 138, 12), auto: true, respawn: 180, hostile: false,
    members: [member("rb-pup", 71.2, 135.2, FACE.west), member("rb-pup", 71.2, 141, FACE.north), member("rb-pup", 77, 135.2, FACE.south)],
  },
  {
    id: "roam-rb-corner", label: "Razorback corner crew (Spillway)", area: area(327, 140, 16), auto: true, respawn: 240, hostile: true,
    members: [
      member("rb-thug", 327.2, 135.2, FACE.south),
      member("rb-thug", 327.2, 150, FACE.north, { patrol: [{ x: 327.2, z: 142 }, { x: 327.2, z: 170 }] }),
      member("rb-gunner", 336, 135.2, FACE.west),
    ],
  },
  {
    id: "roam-rb-yard", label: "Razorback yard (Spillway station)", area: area(430, 298, 18), auto: true, respawn: 360, hostile: true,
    members: [member("rb-brute", 430, 300, FACE.north), member("rb-thug", 420, 296, FACE.east), member("rb-gunner", 440, 292, FACE.west), member("rb-thug", 424, 306, FACE.north)],
  },
  {
    id: "roam-rb-toll", label: "Razorback toll gate (Foundry)", area: area(-320, -192, 16), auto: true, respawn: 300, hostile: true,
    members: [
      member("rb-lieutenant", -312.8, -199.2, FACE.west), member("rb-thug", -327.2, -184.8, FACE.east),
      member("rb-thug", -312.8, -184.8, FACE.south), member("rb-gunner", -327.2, -199.2, FACE.north),
    ],
  },
  {
    id: "roam-rb-scavs", label: "Razorback scavengers (Rain Gardens)", area: area(-320, 128, 14), auto: true, respawn: 240, hostile: true,
    members: [member("rb-thug", -312.8, 120.8, FACE.south), member("rb-thug", -327.2, 135.2, FACE.east), member("rb-gunner", -312.8, 135.2, FACE.west)],
  },
  {
    id: "roam-corp-checkpoint", label: "CorpSec checkpoint (Meridian Spire)", area: area(0, -116, 16), auto: true, respawn: 300, hostile: false,
    members: [member("corp-trooper", -14.5, -118, FACE.south), member("corp-trooper", 14.5, -118, FACE.south), member("corp-shield", 14.5, -110, FACE.south)],
  },
  {
    id: "roam-corp-patrol", label: "CorpSec patrol (Neon Ward)", area: area(-71, -96, 22), auto: true, respawn: 300, hostile: false,
    members: [
      member("corp-trooper", -71.2, -84, FACE.north, { patrol: [{ x: -71.2, z: -80 }, { x: -71.2, z: -112 }] }),
      member("corp-trooper", -56.8, -110, FACE.south, { patrol: [{ x: -56.8, z: -112 }, { x: -56.8, z: -80 }] }),
      member("corp-handler", -71.2, -96, FACE.east),
    ],
  },
  {
    id: "roam-saints-sermon", label: "Chrome Saints sermon (Signal Cathedral)", area: area(480, -262, 16), auto: true, respawn: 420, hostile: false,
    members: [member("cs-saint", 486, -262, FACE.south), member("cs-acolyte", 470, -264, FACE.north), member("cs-acolyte", 500, -266, FACE.north), member("cs-acolyte", 480, -254, FACE.north)],
  },
  {
    id: "roam-saints-zealots", label: "Zealot overwatch (Ghost Circuit)", area: area(576, -192, 20), auto: true, respawn: 360, hostile: true,
    members: [
      member("cs-zealot", 583.2, -212, FACE.north), member("cs-zealot", 568.8, -172, FACE.south),
      member("cs-acolyte", 576, -192, FACE.east, { patrol: [{ x: 583.2, z: -192 }, { x: 568.8, z: -192 }] }), member("cs-acolyte", 583.2, -184.8, FACE.west),
    ],
  },
  {
    id: "roam-ghost-cell", label: "Ghost cell (Ghost Circuit)", area: area(384, -128, 16), auto: true, respawn: 300, hostile: true,
    members: [member("ghost-blinker", 391.2, -120.8, FACE.west), member("ghost-blinker", 376.8, -135.2, FACE.east), member("ghost-glitchknife", 391.2, -135.2, FACE.north)],
  },
  {
    id: "roam-ghost-lurkers", label: "Ghost lurkers (Neon Ward)", area: area(-128, -256, 14), auto: true, respawn: 300, hostile: true,
    members: [member("ghost-blinker", -120.8, -248.8, FACE.west), member("ghost-blinker", -135.2, -263.2, FACE.east)],
  },
];

/** Factions, their loot and the roaming encounters. */
export const FACTIONS_PACK: ContentPack = {
  id: "factions",
  archetypes: [...razorbacks, ...saints, ...corpsec, ...ghosts, ...choir],
  loot,
  encounters: roaming,
};

/** Display names for faction ids (reputation screens, reward hints). */
export const FACTION_NAMES: Readonly<Record<string, string>> = {
  razorbacks: "Razorbacks", "chrome-saints": "Chrome Saints", corpsec: "CorpSec", ghosts: "Ghosts", choir: "The Choir", civilian: "The City",
};
