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
    weapon: { class: "baton", damage: 20, range: 2.2, cooldown: 0.55, staminaCost: 10, heavyMultiplier: 2.2, arc: 50, knockback: 0.9, stagger: 0.9, critChance: 0.1, critMultiplier: 1.7 },
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

  // ---- Sprint additions: more of the city's punctuation ------------------------------------
  weapon({
    id: "hyphen", name: "Hyphen", rarity: "common", glyph: "-", value: 35, weight: 0.6,
    description: "A Silk Market box cutter with snap-off segments. Break off a dull bit and it is sharp again.",
    weapon: { class: "blade", damage: 13, range: 1.9, cooldown: 0.4, staminaCost: 6, heavyMultiplier: 2.0, arc: 40, knockback: 0.3, stagger: 0.2, critChance: 0.14, critMultiplier: 1.8 },
    tags: ["street"],
    art: art(String.raw`
  ________________
 |####|___________\
 |####|-----------'
   ''
`),
  }),
  weapon({
    id: "shebang", name: "Shebang", rarity: "common", glyph: "h", value: 110, weight: 3,
    description: "A two-shot pipe gun from a Spillway garage. The first line tells it what to run; the second is usually you.",
    weapon: { class: "shotgun", damage: 6, range: 7, cooldown: 1.0, staminaCost: 0, magazine: 2, ammo: "ammo-shell", reload: 2.2, spread: 0.16, pellets: 6, knockback: 1.4, stagger: 0.4, critChance: 0.03, critMultiplier: 1.5, automatic: 0 },
    tags: ["street"],
    art: art(String.raw`
  #!_______________
 |___|=============O
    | |  (tape)
   /  /
  /__/
`),
  }),
  weapon({
    id: "open-paren", name: "Open Paren", rarity: "uncommon", glyph: "(", value: 200, weight: 1.4,
    description: "A Rain Gardens pruning sickle with a hooked edge. It opens things and never gets round to closing them.",
    weapon: { class: "blade", damage: 19, range: 2.5, cooldown: 0.48, staminaCost: 9, heavyMultiplier: 2.1, arc: 70, knockback: 0.5, stagger: 0.3, critChance: 0.14, critMultiplier: 1.9 },
    tags: ["street", "cool"],
    art: art(String.raw`
      .--.
     /    '
    (
     \
      '-.
        |#|
        |#|
        '-'
`),
  }),
  weapon({
    id: "query", name: "Query", rarity: "uncommon", glyph: "?", value: 210, weight: 3.2,
    description: "A crowbar bent into a question mark. The answer is usually the door, or whoever is behind it.",
    weapon: { class: "blunt", damage: 28, range: 2.4, cooldown: 0.7, staminaCost: 13, heavyMultiplier: 2.3, arc: 55, knockback: 1.6, stagger: 0.7, critChance: 0.06, critMultiplier: 1.7 },
    tags: ["street"],
    art: art(String.raw`
    .---.
   /     \
         |
        /
       |
       |
       |
       V
`),
  }),
  weapon({
    id: "tab-stop", name: "Tab Stop", rarity: "uncommon", glyph: "T", value: 400, weight: 4,
    description: "A lever-action carbine from the Foundry gun club. Each pull of the lever moves the target one column to the right.",
    weapon: { class: "rifle", damage: 30, range: 28, cooldown: 0.8, staminaCost: 0, magazine: 6, ammo: "ammo-rifle", reload: 2.5, spread: 0.012, knockback: 1.0, stagger: 0.35, critChance: 0.18, critMultiplier: 2.0, automatic: 0 },
    tags: ["cool"],
    art: art(String.raw`
  ____________________
 |TAB  _______________|=
 |___||
  /  / \_/
 /__/
`),
  }),
  weapon({
    id: "less-than", name: "Less Than", rarity: "rare", glyph: "<", value: 950, weight: 2.6,
    description: "A cleaver off a Silk Market noodle stall, rebalanced for people. Whatever it hits ends up less than it was.",
    weapon: { class: "blade", damage: 36, range: 2.3, cooldown: 0.6, staminaCost: 13, heavyMultiplier: 2.4, arc: 65, knockback: 1.2, stagger: 0.6, critChance: 0.16, critMultiplier: 2.0 },
    tags: ["street"],
    art: art(String.raw`
  ____________
 |            |
 |   <        |________
 |____________|=======]
`),
  }),
  weapon({
    id: "interrupt", name: "Interrupt", rarity: "rare", glyph: "I", value: 1000, weight: 1.9,
    description: "A CorpSec cattle prod with the safety ground off. It does not stop people so much as pause them mid-thought.",
    weapon: { class: "baton", damage: 29, range: 2.3, cooldown: 0.5, staminaCost: 11, heavyMultiplier: 2.2, arc: 50, knockback: 1.0, stagger: 1.3, critChance: 0.12, critMultiplier: 1.8 },
    tags: ["tech"],
    art: art(String.raw`
   ^   ^
   |___|
    |#|
   [###]
    | |
    | |
   (___)
`),
  }),
  weapon({
    id: "fork-bomb", name: "Fork Bomb", rarity: "epic", glyph: "y", value: 3300, weight: 3,
    description: "A Ghost-built machine pistol on a forked stock. Every trigger pull spawns two more, until something runs out of memory.",
    weapon: { class: "smg", damage: 9, range: 13, cooldown: 0.1, staminaCost: 0, magazine: 40, ammo: "ammo-pistol", reload: 2.1, spread: 0.07, knockback: 0.2, stagger: 0.1, critChance: 0.1, critMultiplier: 1.8, automatic: 10 },
    tags: ["tech"],
    art: art(String.raw`
   y   y   y
  _\|/_______________
 |y  ______  ________|=
 |__|     |__|
           ||
           ||
`),
  }),
  weapon({
    id: "close-brace", name: "Close Brace", rarity: "legendary", glyph: "}", value: 10000, weight: 7,
    description: "A tower hammer with a curled steel guard, lifted from the Meridian lobby's display case. It ends every block it enters.",
    weapon: { class: "blunt", damage: 104, range: 2.8, cooldown: 0.9, staminaCost: 22, heavyMultiplier: 2.6, arc: 85, knockback: 3.4, stagger: 1.2, critChance: 0.1, critMultiplier: 2.0 },
    tags: ["street", "cool"],
    art: art(String.raw`
  .------------.
  |  } } } } } |
  '-----.  .---'
        |  |
        |  |
        |  |
       [____]
`),
  }),

  // ---- Rim Line additions: harbour, lock and foundry-gate kit ------------------------------
  weapon({
    id: "underscore", name: "Underscore", rarity: "common", glyph: "_", value: 50, weight: 2.2,
    description: "A Low Tide Gate boat hook with the pole cut down to arm's length. It draws a line under whatever it reaches.",
    weapon: { class: "blade", damage: 20, range: 2.8, cooldown: 0.62, staminaCost: 9, heavyMultiplier: 2.1, arc: 50, knockback: 0.9, stagger: 0.35, critChance: 0.08, critMultiplier: 1.7 },
    tags: ["street"],
    art: art(String.raw`
     __
    /  |
   |   '
    \_
      |
      |
      |
  ____|____
`),
  }),
  weapon({
    id: "carriage-return", name: "Carriage Return", rarity: "uncommon", glyph: "J", value: 260, weight: 4.4,
    description: "A Rim Line track wrench, a metre of hooked steel. Swing it out and it brings you back to the start of the line.",
    weapon: { class: "blunt", damage: 30, range: 2.6, cooldown: 0.75, staminaCost: 14, heavyMultiplier: 2.4, arc: 60, knockback: 1.8, stagger: 0.75, critChance: 0.06, critMultiplier: 1.7 },
    tags: ["street"],
    art: art(String.raw`
      ___
     |   |
     |   |
     |  _|
     | |
     | |
  ___| |
  \____/
`),
  }),
  weapon({
    id: "full-stop", name: "Full Stop", rarity: "uncommon", glyph: ".", value: 380, weight: 2.4,
    description: "A Silk Harbour hull riveter rechambered for 11mm. Every shot ends a sentence, usually the other person's.",
    weapon: { class: "pistol", damage: 27, range: 18, cooldown: 0.66, staminaCost: 0, magazine: 7, ammo: "ammo-pistol", reload: 1.8, spread: 0.03, knockback: 1.1, stagger: 0.4, critChance: 0.12, critMultiplier: 1.9, automatic: 0 },
    tags: ["street"],
    art: art(String.raw`
   _____________
  |[o]  ________|.
  |___||
    | |
    |_|
`),
  }),
  weapon({
    id: "modulo", name: "Modulo", rarity: "rare", glyph: "%", value: 1050, weight: 3.6,
    description: "A Foundry Gate cut-off saw bolted to a short pole. Whatever it goes through, it leaves the remainder.",
    weapon: { class: "blade", damage: 38, range: 2.4, cooldown: 0.62, staminaCost: 14, heavyMultiplier: 2.3, arc: 75, knockback: 1.1, stagger: 0.6, critChance: 0.14, critMultiplier: 2.0 },
    tags: ["street", "tech"],
    art: art(String.raw`
    .-'''-.
   / o   / \
  |     /   |
   \   /  o/
    '-+--'
      |#|
      |#|
      '-'
`),
  }),
  weapon({
    id: "line-feed", name: "Line Feed", rarity: "epic", glyph: "L", value: 3600, weight: 5.2,
    description: "A Silk Harbour harpoon rifle that fires steel bolts on a reel. It takes a target down to the next line, and drags.",
    weapon: { class: "rifle", damage: 70, range: 32, cooldown: 0.8, staminaCost: 0, magazine: 3, ammo: "ammo-rifle", reload: 2.8, spread: 0.008, knockback: 2.6, stagger: 0.9, critChance: 0.2, critMultiplier: 2.2, automatic: 0 },
    tags: ["street", "cool"],
    art: art(String.raw`
  ____(@)___________
 |LF ______________|>--
 |__||   ~~~
   / /
  /_/
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
  { id: "sandbox-poncho", name: "Sandbox Poncho", kind: "armor", rarity: "common", glyph: "U", value: 70, weight: 1.2, stack: 1, armor: { slot: "body", protection: 0.09 }, tags: ["street"], description: "A rubberised Spillway rain poncho with ceramic chips glued inside. Light, cheap, and better than a hoodie against a knife." },
  { id: "patch-notes", name: "Patch Notes", kind: "armor", rarity: "uncommon", glyph: "P", value: 300, weight: 3, stack: 1, armor: { slot: "body", protection: 0.17 }, tags: ["street"], description: "A courier's jacket covered in sewn-on armour patches. Each one fixes a different way of getting hurt." },
  { id: "kernel-plate", name: "Kernel Plate", kind: "armor", rarity: "rare", glyph: "K", value: 1350, weight: 6.5, stack: 1, armor: { slot: "body", protection: 0.3 }, tags: ["street"], description: "A Foundry-forged chest plate stamped KERNEL. It runs at the lowest level and takes the worst of every hit." },
  {
    id: "root-kit", name: "Root Kit", kind: "armor", rarity: "epic", glyph: "R", value: 3500, weight: 4, stack: 1, armor: { slot: "body", protection: 0.36 }, tags: ["tech", "cool"],
    description: "A Ghost-made harness of hidden plates that installs itself over your clothes, hides from scanners, and is very hard to remove.",
    art: art(String.raw`
   .--------------.
   |[]  ~root~  []|
   |  |========|  |
   |[]|  ####  |[]|
   '--'========'--'
`),
  },
  { id: "welders-mask", name: "Welder's Mask", kind: "armor", rarity: "uncommon", glyph: "D", value: 260, weight: 1.4, stack: 1, armor: { slot: "head", protection: 0.11 }, tags: ["street"], description: "A Kiln Nine welding mask with the shade glass swapped for a cheap HUD. You see less, and less of you gets hit." },
  { id: "null-hood", name: "Null Hood", kind: "armor", rarity: "rare", glyph: "N", value: 1100, weight: 0.6, stack: 1, armor: { slot: "head", protection: 0.14 }, tags: ["tech", "cool"], description: "A hood lined with signal-dead mesh. Ghost Circuit cameras cannot find a face under it. Knives have more luck." },
  { id: "flood-wall", name: "Flood Wall", kind: "armor", rarity: "rare", glyph: "B", value: 1250, weight: 6, stack: 1, armor: { slot: "body", protection: 0.29 }, tags: ["street"], description: "A lock-keeper's oilskin with riveted plate from the old sea wall sewn into the lining. Built to hold back the tide, rated for rather less." },
  { id: "port-scanner", name: "Port Scanner", kind: "armor", rarity: "uncommon", glyph: "z", value: 290, weight: 0.9, stack: 1, armor: { slot: "head", protection: 0.1 }, tags: ["tech"], description: "A harbour pilot's hood with a hull scanner scrolling across the brow. Reads every open port on the quay, and the occasional open mouth." },
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
  { id: "hana-broth", name: "Hana's Broth", kind: "consumable", rarity: "common", glyph: "v", value: 15, weight: 0.4, stack: 10, consumable: { heal: 40, duration: 20, effect: "regen" }, description: "A paper cup of pork-bone broth from Hana Oduya's noodle cart in the Silk Market. Heals slowly for twenty seconds." },
  { id: "kiln-coffee", name: "Kiln Coffee", kind: "consumable", rarity: "common", glyph: "m", value: 14, weight: 0.3, stack: 10, consumable: { heal: 10, stamina: 45 }, description: "Foundry night-shift coffee, brewed on a furnace pipe. Restores stamina and a little feeling in the hands." },
  { id: "sealant-spray", name: "Sealant Spray", kind: "consumable", rarity: "common", glyph: "f", value: 14, weight: 0.2, stack: 10, consumable: { heal: 25 }, description: "A can of wound sealant meant for pipes. Juniper says never to use it on people. Juniper sells it to people." },
  { id: "defrag-patch", name: "Defrag Patch", kind: "consumable", rarity: "uncommon", glyph: "a", value: 95, weight: 0.05, stack: 5, consumable: { duration: 25, effect: "focus" }, tags: ["tech"], description: "A dermal patch that tidies your attention into one block. Weak points stand out for twenty-five seconds." },
  { id: "overclock-tab", name: "Overclock Tab", kind: "consumable", rarity: "rare", glyph: "x", value: 160, weight: 0.05, stack: 5, consumable: { stamina: 80, duration: 16, effect: "haste" }, tags: ["tech"], description: "A bitter tab that runs your nerves past spec: a big stamina refill and faster feet for sixteen seconds. Nix sells them by the strip in Ghost Circuit." },
  { id: "static-jar", name: "Static Jar", kind: "consumable", rarity: "epic", glyph: "j", value: 420, weight: 0.5, stack: 3, consumable: { duration: 22, effect: "shield" }, tags: ["tech"], description: "A jar of Ghost Circuit static. Uncork it and the air around you stiffens into a field for twenty-two seconds." },
  { id: "moss-poultice", name: "Moss Poultice", kind: "consumable", rarity: "uncommon", glyph: "G", value: 70, weight: 0.2, stack: 5, consumable: { heal: 30, duration: 30, effect: "regen" }, description: "Rain Gardens moss packed in gauze and soaked in something green. Slap it on the wound: some health now, more over thirty seconds." },
  { id: "glare-drops", name: "Glare Drops", kind: "consumable", rarity: "uncommon", glyph: "E", value: 85, weight: 0.05, stack: 5, consumable: { duration: 18, effect: "focus" }, tags: ["street"], description: "Neon Ward eye drops for sign fitters who stare at tubes all night. For eighteen seconds every weak point stands out like a lit sign." },
  { id: "harbour-kelp", name: "Harbour Kelp", kind: "consumable", rarity: "common", glyph: "k", value: 16, weight: 0.3, stack: 10, consumable: { heal: 35, stamina: 20, duration: 25, effect: "regen" }, description: "Salted kelp strips sold in paper twists on the Silk Harbour quay. A little breath back at once, then slow healing over twenty-five seconds of chewing." },
];

const JUNK: readonly ItemDefinition[] = [
  { id: "copper-scrap", name: "Copper Scrap", kind: "junk", rarity: "common", glyph: "s", value: 6, weight: 0.3, stack: 50, description: "Stripped wiring, balled up. Every fixer in the city buys copper." },
  { id: "burnt-chip", name: "Burnt Chip", kind: "junk", rarity: "common", glyph: "c", value: 8, weight: 0.05, stack: 50, description: "A fried processor. The gold in the pins is still worth something." },
  { id: "neon-tube", name: "Neon Tube", kind: "junk", rarity: "common", glyph: "l", value: 10, weight: 0.5, stack: 20, description: "A length of sign tubing, still faintly glowing. Sign shops pay for these." },
  { id: "circuit-board", name: "Circuit Board", kind: "junk", rarity: "uncommon", glyph: "b", value: 28, weight: 0.3, stack: 20, description: "An intact logic board from a dead terminal." },
  { id: "data-shard", name: "Data Shard", kind: "junk", rarity: "uncommon", glyph: "d", value: 60, weight: 0.05, stack: 20, description: "A sliver of crystal storage. Nobody asks what is on it; brokers pay by the gram." },
  { id: "encrypted-drive", name: "Encrypted Drive", kind: "junk", rarity: "rare", glyph: "e", value: 240, weight: 0.2, stack: 10, tags: ["tech"], description: "A locked corp drive. Worth a lot to the right broker, and a lot more to the wrong one." },
  { id: "old-world-watch", name: "Old-World Watch", kind: "junk", rarity: "rare", glyph: "w", value: 350, weight: 0.2, stack: 5, description: "A wind-up wristwatch that still keeps time. Collectors in the Spire love these." },
  // District trade goods: what each part of town leaves lying around.
  { id: "foundry-slag", name: "Foundry Slag", kind: "junk", rarity: "common", glyph: "g", value: 9, weight: 0.8, stack: 30, description: "A fist-sized lump of glassy furnace slag. Kiln Nine buys it back to line the moulds." },
  { id: "afterlight-token", name: "Afterlight Token", kind: "junk", rarity: "common", glyph: "p", value: 5, weight: 0.01, stack: 50, description: "A brass Afterlight Arcade token. Good for one game in the Spillway, or a few credits from a collector." },
  { id: "river-glass", name: "River Glass", kind: "junk", rarity: "common", glyph: "O", value: 7, weight: 0.05, stack: 30, description: "Bottle glass the Spillway river has worn smooth. Stall keepers string it into charms." },
  { id: "tea-brick", name: "Tea Brick", kind: "junk", rarity: "common", glyph: "Z", value: 14, weight: 0.4, stack: 20, description: "A pressed brick of Blue Hour's house tea. In the Silk Market it spends almost like money." },
  { id: "rainfern-seeds", name: "Rainfern Seeds", kind: "junk", rarity: "uncommon", glyph: "r", value: 24, weight: 0.02, stack: 20, description: "A twist of paper holding rainfern seeds from the Rain Gardens. Rooftop growers pay well for them." },
  { id: "hologram-gel", name: "Hologram Gel", kind: "junk", rarity: "uncommon", glyph: "q", value: 32, weight: 0.3, stack: 20, description: "A projector cartridge from a dead Neon Ward billboard. Sign shops refill them and sell the ads twice." },
  { id: "antenna-core", name: "Antenna Core", kind: "junk", rarity: "uncommon", glyph: "t", value: 45, weight: 0.4, stack: 20, tags: ["tech"], description: "The ferrite heart of a Ghost Circuit rooftop antenna, still faintly warm. Ghost fixers buy them by the dozen." },
  { id: "pylon-insulator", name: "Pylon Insulator", kind: "junk", rarity: "uncommon", glyph: "8", value: 38, weight: 0.7, stack: 20, description: "A stack of ceramic discs off one of the offshore power pylons, crusted with salt. Kiln Nine grinds them into mould grit; the Ghosts want the copper core." },
  // Keepsakes: rare drops tied to the city's stories. Worth more to collectors than to fixers.
  { id: "choir-tuning-fork", name: "Choir Tuning Fork", kind: "junk", rarity: "rare", glyph: "F", value: 260, weight: 0.2, stack: 5, tags: ["keepsake"], description: "A steel fork stamped with the Hollow Choir's mark. Strike it and anyone from the Choir within earshot turns their head." },
  { id: "chrome-rosary", name: "Chrome Rosary", kind: "junk", rarity: "rare", glyph: "C", value: 300, weight: 0.3, stack: 5, tags: ["keepsake"], description: "Chrome bearings strung on fibre-optic. Chrome Saints count prayers on it; collectors in the Spire count credits." },
  { id: "paid-warrant", name: "Paid Warrant", kind: "junk", rarity: "rare", glyph: "X", value: 180, weight: 0.01, stack: 10, tags: ["keepsake"], description: "A bounty warrant off Sable's board, stamped PAID. Fixers frame them. Some frame their own." },
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

/** The base catalogue: 32 weapons, 3 ammo types, 16 armour pieces, 16 consumables, trade goods, keepsakes and quest placeholders. */
export const ITEMS: readonly ItemDefinition[] = [...WEAPONS, ...AMMO, ...ARMOR, ...CONSUMABLES, ...JUNK, ...QUEST_ITEMS];
