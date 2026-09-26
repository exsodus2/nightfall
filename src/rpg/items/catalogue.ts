// The base item catalogue: weapons, ammo, armour, consumables, trade goods and quest placeholders.
// Everything the player reads here is printable ASCII (glyphs, art, names, descriptions) because
// it is drawn in-world through the textmode glyph atlas. Content packs add more via ItemRegistry.
//
// Balance notes (combat is melee-first with soft lock-on; guns are short/mid range):
//  - Melee has no ammo, the best damage per second at each rarity tier and a heavy attack
//    (heavyMultiplier) - a common blade out-damages the common pistol once reloads count.
//  - Guns cost no stamina but eat ammo and reload time; `range` is the falloff distance, kept
//    short (shotgun 8 m .. rifle ~35 m) so fights stay close.
//  - DPS tiers (damage / cooldown, before crits): common ~30-35, uncommon ~35-45, rare ~50-70,
//    epic ~80-100, legendary ~115-120.

import type { ItemDefinition, WeaponClass, WeaponStats } from "../types.ts";

/** Item id of the "$" credit chip: picking it up adds its count as credits, never an inventory stack. */
export const CREDIT_CHIP = "credit-chip";

/** Weapon classes that go in the melee slot. */
export const MELEE_CLASSES: ReadonlySet<WeaponClass> = new Set<WeaponClass>(["blade", "blunt", "baton"]);

/** Splits a String.raw block into art rows: drops the leading/trailing blank line and trailing
 * whitespace (including a CR if the file was saved with CRLF endings). */
const art = (block: string): readonly string[] => {
  const rows = block.split("\n").map(row => row.replace(/\s+$/, ""));
  while (rows.length && rows[0] === "") rows.shift();
  while (rows.length && rows[rows.length - 1] === "") rows.pop();
  return rows;
};

type WeaponSpec = Omit<ItemDefinition, "kind" | "stack" | "weapon"> & { weapon: WeaponStats };
// Weapons never stack; the kind follows the class so equip rules have one source of truth.
const weapon = (spec: WeaponSpec): ItemDefinition => ({ ...spec, kind: MELEE_CLASSES.has(spec.weapon.class) ? "melee" : "ranged", stack: 1 });

const WEAPONS: readonly ItemDefinition[] = [
  // ---- Melee -------------------------------------------------------------------------------
  weapon({
    id: "backtick-shiv", name: "Backtick Shiv", rarity: "common", glyph: "`", value: 40, weight: 1,
    description: "A sharpened strip of server rack, taped at the grip. Small, quick, and everybody's first.",
    weapon: { class: "blade", damage: 15, range: 2.0, cooldown: 0.42, staminaCost: 7, heavyMultiplier: 2.0, arc: 45, knockback: 0.4, stagger: 0.25, critChance: 0.12, critMultiplier: 1.8 },
    tags: ["street"],
    art: art(String.raw`
    .
   / \
   | |
   | |
   | |
  =====
   |#|
   '-'
`),
  }),
  weapon({
    id: "pipe-operator", name: "Pipe Operator", rarity: "common", glyph: "|", value: 55, weight: 3,
    description: "Two feet of lead pipe. Takes whatever comes in and sends it somewhere else.",
    weapon: { class: "blunt", damage: 22, range: 2.4, cooldown: 0.68, staminaCost: 13, heavyMultiplier: 2.4, arc: 60, knockback: 1.4, stagger: 0.55, critChance: 0.05, critMultiplier: 1.6 },
    tags: ["street"],
    art: art(String.raw`
  ___
 [___]
   |
   |
   |
   |
  _|_
 [___]
`),
  }),
  weapon({
    id: "forward-slash", name: "Forward Slash", rarity: "uncommon", glyph: "/", value: 180, weight: 2,
    description: "A drainage-crew machete with a chipped edge. It only ever cuts one direction, but it cuts.",
    weapon: { class: "blade", damage: 21, range: 2.3, cooldown: 0.5, staminaCost: 10, heavyMultiplier: 2.1, arc: 55, knockback: 0.6, stagger: 0.3, critChance: 0.12, critMultiplier: 1.9 },
    tags: ["street"],
    art: art(String.raw`
            ____
         .-'   /
      .-'     /
   .-'  _____/
   \___/
    //
   //
  []
`),
  }),
  weapon({
    id: "tilde-whip", name: "Tilde Whip", rarity: "uncommon", glyph: "~", value: 220, weight: 1.2,
    description: "Monofilament on a spool handle. Approximately lethal at approximately any distance.",
    weapon: { class: "blade", damage: 17, range: 3.6, cooldown: 0.6, staminaCost: 11, heavyMultiplier: 1.9, arc: 75, knockback: 0.8, stagger: 0.45, critChance: 0.1, critMultiplier: 1.8 },
    tags: ["cool"],
    art: art(String.raw`
  __
 |  |   .~~~~.
 |  |__/      \    ~~.
 |  |          \__/   \
 |__|                  ~
`),
  }),
  weapon({
    id: "segfault", name: "Segfault", rarity: "uncommon", glyph: "!", value: 240, weight: 1.8,
    description: "A shock baton that dumps its whole charge on contact. Targets tend to stop responding.",
    weapon: { class: "baton", damage: 18, range: 2.2, cooldown: 0.55, staminaCost: 10, heavyMultiplier: 2.2, arc: 50, knockback: 0.9, stagger: 0.9, critChance: 0.1, critMultiplier: 1.7 },
    tags: ["tech"],
    art: art(String.raw`
   _/\_
   \  /
    ||
   [##]
   [##]
    ||
   (__)
`),
  }),
  weapon({
    id: "backslash", name: "Backslash", rarity: "rare", glyph: "\\", value: 900, weight: 2.2,
    description: "A folded-steel katana with an escape character etched near the guard. Whatever it touches, it frees.",
    weapon: { class: "blade", damage: 32, range: 2.6, cooldown: 0.48, staminaCost: 11, heavyMultiplier: 2.3, arc: 60, knockback: 0.8, stagger: 0.4, critChance: 0.2, critMultiplier: 2.0 },
    tags: ["cool"],
    art: art(String.raw`
 \\
  \\
   \\
    \\
   =##=
      \\
       \\
        o
`),
  }),
  weapon({
    id: "hash-hammer", name: "Hash Hammer", rarity: "rare", glyph: "#", value: 850, weight: 6,
    description: "A block of tungsten on a steel haft. One-way function: nothing it hits comes back the same.",
    weapon: { class: "blunt", damage: 48, range: 2.6, cooldown: 0.95, staminaCost: 20, heavyMultiplier: 2.6, arc: 70, knockback: 3.0, stagger: 1.1, critChance: 0.08, critMultiplier: 1.8 },
    tags: ["street"],
    art: art(String.raw`
 ##########
 ##########
 ##########
     ||
     ||
     ||
     ||
    [__]
`),
  }),
  weapon({
    id: "ampersand", name: "Ampersand", rarity: "epic", glyph: "&", value: 2600, weight: 2.4,
    description: "Twin short blades, run in parallel. Each cut is followed by another before the first has landed.",
    weapon: { class: "blade", damage: 24, range: 2.2, cooldown: 0.3, staminaCost: 7, heavyMultiplier: 2.0, arc: 65, knockback: 0.5, stagger: 0.3, critChance: 0.22, critMultiplier: 2.0 },
    tags: ["cool", "street"],
    art: art(String.raw`
  /\          /\
  ||          ||
  ||          ||
  ||    &&    ||
 =##=        =##=
  ||          ||
  ()          ()
`),
  }),
  weapon({
    id: "null-pointer", name: "Null Pointer", rarity: "epic", glyph: "0", value: 3200, weight: 1.6,
    description: "A monoblade one molecule wide. It points at nothing, and then so does whatever it hit.",
    weapon: { class: "blade", damage: 46, range: 2.8, cooldown: 0.55, staminaCost: 12, heavyMultiplier: 2.5, arc: 55, knockback: 1.0, stagger: 0.5, critChance: 0.3, critMultiplier: 2.5 },
    tags: ["tech", "cool"],
    art: art(String.raw`
       |
       |
       |
       |
       |
    ==[0]==
      |#|
      |_|
`),
  }),
  weapon({
    id: "at-sigil", name: "@ Sigil", rarity: "legendary", glyph: "@", value: 9000, weight: 2.5,
    description: "A ring-blade that spins on its own field. The old sysops say it was the first address ever assigned.",
    weapon: { class: "blade", damage: 58, range: 3.2, cooldown: 0.5, staminaCost: 12, heavyMultiplier: 2.8, arc: 120, knockback: 2.0, stagger: 0.8, critChance: 0.25, critMultiplier: 2.5 },
    tags: ["cool", "tech", "street"],
    art: art(String.raw`
    .---------.
   /  .----.   \
  |  / @@@@ \   |
  |  \ @@@@ /   |
   \  '----'   /
    '---------'
        ||
       [__]
`),
  }),

  // ---- Ranged ------------------------------------------------------------------------------
  weapon({
    id: "caret-45", name: "Caret .45", rarity: "common", glyph: "^", value: 120, weight: 1.2,
    description: "A boxy street pistol with a notch sight shaped like an up-arrow. Points where you point.",
    weapon: { class: "pistol", damage: 13, range: 16, cooldown: 0.38, staminaCost: 0, magazine: 8, ammo: "ammo-pistol", reload: 1.4, spread: 0.035, knockback: 0.5, stagger: 0.2, critChance: 0.08, critMultiplier: 1.8, automatic: 0 },
    art: art(String.raw`
   ______^_______
  |  ___________|==
  |_|  |_|
    |  |
    |__|
`),
  }),
  weapon({
    id: "quote-magnum", name: "Quote Magnum", rarity: "rare", glyph: "\"", value: 1100, weight: 1.8,
    description: "A six-shot revolver. Every round it fires gets repeated, word for word, in the local news.",
    weapon: { class: "pistol", damage: 36, range: 22, cooldown: 0.7, staminaCost: 0, magazine: 6, ammo: "ammo-pistol", reload: 2.1, spread: 0.025, knockback: 1.4, stagger: 0.5, critChance: 0.18, critMultiplier: 2.0, automatic: 0 },
    tags: ["cool"],
    art: art(String.raw`
    _________________
   |""  _____________|
   |__|(o)(o)
   /  /
  /__/
`),
  }),
  weapon({
    id: "asterisk-smg", name: "Asterisk SMG", rarity: "uncommon", glyph: "*", value: 420, weight: 2.6,
    description: "A stamped-metal bullet hose. Wildcard aim: it matches everything in front of it, eventually.",
    weapon: { class: "smg", damage: 5, range: 12, cooldown: 0.12, staminaCost: 0, magazine: 30, ammo: "ammo-pistol", reload: 2.0, spread: 0.085, knockback: 0.15, stagger: 0.08, critChance: 0.05, critMultiplier: 1.6, automatic: 8 },
    tags: ["street"],
    art: art(String.raw`
  __________________
 |*  ______   ______|=
 |__|  |  |__|
       |  |
       |__|
`),
  }),
  weapon({
    id: "brace-burst", name: "Brace Burst", rarity: "rare", glyph: "{", value: 1300, weight: 2.8,
    description: "A corp-issue compact SMG with a curly stock. Opens a block of fire and closes it neatly.",
    weapon: { class: "smg", damage: 7, range: 14, cooldown: 0.1, staminaCost: 0, magazine: 36, ammo: "ammo-pistol", reload: 1.9, spread: 0.06, knockback: 0.2, stagger: 0.1, critChance: 0.08, critMultiplier: 1.7, automatic: 10 },
    tags: ["tech"],
    art: art(String.raw`
 {===================}
 {  ____  _________  }==
 {_|    ||
        ||
        {}
`),
  }),
  weapon({
    id: "colon-scatter", name: "Colon Scatter", rarity: "uncommon", glyph: ":", value: 380, weight: 3.6,
    description: "A sawn-off pump gun. Splits one argument into several and delivers all of them at once.",
    weapon: { class: "shotgun", damage: 7, range: 8, cooldown: 0.95, staminaCost: 0, magazine: 4, ammo: "ammo-shell", reload: 2.6, spread: 0.14, pellets: 6, knockback: 1.8, stagger: 0.5, critChance: 0.04, critMultiplier: 1.5, automatic: 0 },
    tags: ["street"],
    art: art(String.raw`
  ___________________
 |:  ________________|
 |__|:
  |  |
  |__|
`),
  }),
  weapon({
    id: "kernel-panic", name: "Kernel Panic", rarity: "epic", glyph: "=", value: 3400, weight: 4.2,
    description: "A drum-fed combat shotgun. When it goes off, everything in the room stops at once.",
    weapon: { class: "shotgun", damage: 10, range: 9, cooldown: 0.8, staminaCost: 0, magazine: 6, ammo: "ammo-shell", reload: 2.4, spread: 0.12, pellets: 8, knockback: 3.2, stagger: 0.9, critChance: 0.08, critMultiplier: 1.8, automatic: 0 },
    tags: ["tech", "street"],
    art: art(String.raw`
 ======================
 ======================
 |##|   KERNEL PANIC
 |##|
 /  /
/__/
`),
  }),
  weapon({
    id: "semicolon", name: "Semicolon", rarity: "rare", glyph: ";", value: 1500, weight: 4.5,
    description: "A bolt-action marksman rifle. Ends statements. Forgetting it causes errors further down the line.",
    weapon: { class: "rifle", damage: 44, range: 32, cooldown: 0.95, staminaCost: 0, magazine: 5, ammo: "ammo-rifle", reload: 2.3, spread: 0.01, knockback: 1.2, stagger: 0.4, critChance: 0.22, critMultiplier: 2.2, automatic: 0 },
    tags: ["cool"],
    art: art(String.raw`
          _;_
  _______|___|_______
 |  _________________|=
 |_|   ;
  /  /
 /__/
`),
  }),
  weapon({
    id: "root-prompt", name: "Root Prompt", rarity: "legendary", glyph: ">", value: 11000, weight: 4.8,
    description: "A prototype battle rifle with a blinking cursor in the optic. Whoever holds it has permission for anything.",
    weapon: { class: "rifle", damage: 26, range: 36, cooldown: 0.22, staminaCost: 0, magazine: 24, ammo: "ammo-rifle", reload: 2.2, spread: 0.018, knockback: 0.8, stagger: 0.3, critChance: 0.18, critMultiplier: 2.2, automatic: 4.5 },
    tags: ["tech", "cool"],
    art: art(String.raw`
 root@nightfall:~# _
  ____________________
 |>_  ________________|=
 |__||  |
  /  /  |_|
 /__/
`),
  }),
];

const AMMO: readonly ItemDefinition[] = [
  { id: "ammo-pistol", name: "Pistol Rounds", kind: "ammo", rarity: "common", glyph: ",", value: 1, weight: 0.01, stack: 240, description: "Loose 11mm rounds for pistols and SMGs. The city's small change." },
  { id: "ammo-shell", name: "12g Shells", kind: "ammo", rarity: "common", glyph: "o", value: 3, weight: 0.04, stack: 60, description: "Red plastic shotgun shells, hand-loaded in somebody's kitchen." },
  { id: "ammo-rifle", name: "Rifle Rounds", kind: "ammo", rarity: "uncommon", glyph: "'", value: 4, weight: 0.03, stack: 120, description: "Long, jacketed rifle cartridges. Corp stock; the serials are filed off." },
];

const ARMOR: readonly ItemDefinition[] = [
  { id: "mesh-hoodie", name: "Mesh Hoodie", kind: "armor", rarity: "common", glyph: "[", value: 60, weight: 1.5, stack: 1, armor: { slot: "body", protection: 0.08 }, tags: ["street"], description: "A hoodie with ballistic mesh sewn into the lining. Stops a knife, mostly." },
  { id: "kevlar-weave", name: "Kevlar Weave", kind: "armor", rarity: "uncommon", glyph: "]", value: 320, weight: 4, stack: 1, armor: { slot: "body", protection: 0.18 }, tags: ["street"], description: "A layered vest cut from old riot stock. Heavy, honest protection." },
  { id: "firewall-vest", name: "Firewall Vest", kind: "armor", rarity: "rare", glyph: "H", value: 1200, weight: 5, stack: 1, armor: { slot: "body", protection: 0.28 }, tags: ["tech"], description: "Ceramic plates on a smart harness that stiffens where the hit is coming. Drops packets. And bullets." },
  {
    id: "chrome-carapace", name: "Chrome Carapace", kind: "armor", rarity: "epic", glyph: "W", value: 3800, weight: 7, stack: 1, armor: { slot: "body", protection: 0.4 }, tags: ["street", "cool"],
    description: "Interlocking chrome shells over a gel undersuit. Chrome Saints kill for these; that is how they get them.",
    art: art(String.raw`
   ___  ____  ___
  /   \/ || \/   \
 |  [=]  ||  [=]  |
  \__|   ||   |__/
     |===||===|
     |___||___|
`),
  },
  { id: "visor-cap", name: "Visor Cap", kind: "armor", rarity: "common", glyph: "n", value: 45, weight: 0.4, stack: 1, armor: { slot: "head", protection: 0.04 }, tags: ["cool"], description: "A cap with a cracked HUD visor. Mainly it keeps the rain off." },
  { id: "riot-helm", name: "Riot Helm", kind: "armor", rarity: "uncommon", glyph: "Q", value: 280, weight: 1.8, stack: 1, armor: { slot: "head", protection: 0.1 }, tags: ["street"], description: "A scuffed CorpSec riot helmet. Somebody scratched the logo off." },
  { id: "halo-rig", name: "Halo Rig", kind: "armor", rarity: "epic", glyph: "A", value: 3000, weight: 1, stack: 1, armor: { slot: "head", protection: 0.18 }, tags: ["tech", "cool"], description: "A ring of sensor nodes that floats a finger's width above the skull and flinches before you do." },
  {
    id: "daemon-crown", name: "Daemon Crown", kind: "armor", rarity: "legendary", glyph: "V", value: 8000, weight: 1.4, stack: 1, armor: { slot: "head", protection: 0.25 }, tags: ["tech", "cool", "street"],
    description: "A black circlet that runs in the background of your mind. It never sleeps, so neither do its reflexes.",
    art: art(String.raw`
  /\    /\    /\
 /  \  /  \  /  \
|    \/ () \/    |
|________________|
`),
  },
];

const CONSUMABLES: readonly ItemDefinition[] = [
  {
    id: "stim", name: "Stim", kind: "consumable", rarity: "common", glyph: "+", value: 25, weight: 0.2, stack: 10, consumable: { heal: 35 },
    description: "An auto-injector of street-grade coagulant. Stings. Works.",
    art: art(String.raw`
  _
 |_|
 | |
 |+|
 |_|
  |
`),
  },
  { id: "medkit", name: "Medkit", kind: "consumable", rarity: "uncommon", glyph: "M", value: 80, weight: 0.8, stack: 5, consumable: { heal: 90 }, description: "A clinic trauma pack: sealant foam, nanosutures, a very small painkiller." },
  { id: "synth-ration", name: "Synth Ration", kind: "consumable", rarity: "common", glyph: "_", value: 12, weight: 0.3, stack: 10, consumable: { heal: 30, duration: 15, effect: "regen" }, description: "A grey protein bar. Heals slowly over time, the way food is supposed to." },
  { id: "coolant-can", name: "Coolant Can", kind: "consumable", rarity: "common", glyph: "u", value: 18, weight: 0.3, stack: 10, consumable: { stamina: 60 }, description: "An energy drink marketed to overclockers. Instantly refills stamina." },
  { id: "haste-inhaler", name: "Haste Inhaler", kind: "consumable", rarity: "uncommon", glyph: "i", value: 110, weight: 0.2, stack: 5, consumable: { stamina: 50, duration: 12, effect: "haste" }, description: "Two puffs and the world runs at a lower clock speed than you do." },
  { id: "focus-chip", name: "Focus Chip", kind: "consumable", rarity: "rare", glyph: "%", value: 150, weight: 0.1, stack: 5, consumable: { duration: 20, effect: "focus" }, tags: ["tech"], description: "A single-use wetware chip. For twenty seconds every weak point in the room is highlighted." },
  { id: "shield-cell", name: "Shield Cell", kind: "consumable", rarity: "rare", glyph: ")", value: 180, weight: 0.3, stack: 5, consumable: { duration: 15, effect: "shield" }, tags: ["tech"], description: "Clips to a belt and throws a thin kinetic field around you for fifteen seconds." },
];

const JUNK: readonly ItemDefinition[] = [
  { id: "copper-scrap", name: "Copper Scrap", kind: "junk", rarity: "common", glyph: "s", value: 6, weight: 0.3, stack: 50, description: "Stripped wiring, balled up. Every fixer in the city buys copper." },
  { id: "burnt-chip", name: "Burnt Chip", kind: "junk", rarity: "common", glyph: "c", value: 8, weight: 0.05, stack: 50, description: "A fried processor. The gold in the pins is still worth something." },
  { id: "neon-tube", name: "Neon Tube", kind: "junk", rarity: "common", glyph: "l", value: 10, weight: 0.5, stack: 20, description: "A length of sign tubing, still faintly glowing. Sign shops pay for these." },
  { id: "circuit-board", name: "Circuit Board", kind: "junk", rarity: "uncommon", glyph: "b", value: 28, weight: 0.3, stack: 20, description: "An intact logic board from a dead terminal." },
  { id: "data-shard", name: "Data Shard", kind: "junk", rarity: "uncommon", glyph: "d", value: 60, weight: 0.05, stack: 20, description: "A sliver of crystal storage. Nobody asks what is on it; brokers pay by the gram." },
  { id: "encrypted-drive", name: "Encrypted Drive", kind: "junk", rarity: "rare", glyph: "e", value: 240, weight: 0.2, stack: 10, tags: ["tech"], description: "A locked corp drive. Worth a lot to the right broker, and a lot more to the wrong one." },
  { id: "old-world-watch", name: "Old-World Watch", kind: "junk", rarity: "rare", glyph: "w", value: 350, weight: 0.2, stack: 5, description: "A wind-up wristwatch that still keeps time. Collectors in the Spire love these." },
  { id: CREDIT_CHIP, name: "Credit Chip", kind: "junk", rarity: "common", glyph: "$", value: 1, weight: 0, stack: 1_000_000, tags: ["credits"], description: "A bearer credit chip. Picking it up adds its balance to your account." },
];

// Placeholders the content pack's quests can hand out; they weigh nothing, cannot be sold and
// never despawn on the ground (see WorldLoot).
const QUEST_ITEMS: readonly ItemDefinition[] = [
  { id: "relay-keycard", name: "Relay Keycard", kind: "quest", rarity: "uncommon", glyph: "k", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "A magstripe keycard for a CorpSec relay station." },
  { id: "encrypted-ledger", name: "Encrypted Ledger", kind: "quest", rarity: "rare", glyph: "L", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "A gang ledger on an old tablet. Somebody will want this back." },
  { id: "halo-fragment", name: "Halo Fragment", kind: "quest", rarity: "rare", glyph: "Y", value: 0, weight: 0, stack: 5, tags: ["quest"], description: "A shard of a Chrome Saint halo, still warm." },
  { id: "warden-sigil", name: "Warden Sigil", kind: "quest", rarity: "epic", glyph: "S", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "A heavy brass seal stamped with the old park wardens' crest." },
];

/** The base catalogue: 18 weapons, 3 ammo types, 8 armour pieces, 7 consumables, trade goods and quest placeholders. */
export const ITEMS: readonly ItemDefinition[] = [...WEAPONS, ...AMMO, ...ARMOR, ...CONSUMABLES, ...JUNK, ...QUEST_ITEMS];
