// Built-in test roster so combat runs (and is tested) without the content packs. The content agent
// adds the real roster; these ids stay valid. Enemy weapons are item definitions too: CombatWorld
// looks weapons up in the injected item DB first and falls back to COMBAT_TEST_ITEMS.

import type { EncounterDefinition, EnemyArchetype, ItemDefinition } from "../types.ts";

const weapon = (id: string, name: string, glyph: string, kind: "melee" | "ranged", stats: NonNullable<ItemDefinition["weapon"]>, value = 60): ItemDefinition =>
  ({ id, name, kind, rarity: "common", glyph, description: `${name}.`, value, weight: kind === "melee" ? 2 : 3, stack: 1, weapon: stats, tags: ["combat-test"] });

/** Weapons used by the test archetypes plus a starter kit for tests (player side). */
export const COMBAT_TEST_ITEMS: readonly ItemDefinition[] = [
  // Player starter kit (tests / fallback).
  weapon("combat-test-blade", "Starter blade", "/", "melee", { class: "blade", damage: 14, range: 2.4, cooldown: 0.5, staminaCost: 12, heavyMultiplier: 2.2, arc: 55, knockback: 0.8, stagger: 0.35, critChance: 0.08, critMultiplier: 1.8 }),
  weapon("combat-test-pistol", "Test pistol", "r", "ranged", { class: "pistol", damage: 16, range: 24, cooldown: 0.28, staminaCost: 0, magazine: 8, ammo: "combat-test-9mm", reload: 1.4, spread: 0.035, knockback: 0.3, stagger: 0.15, critChance: 0.06, critMultiplier: 1.8 }),
  weapon("combat-test-smg", "Test SMG", "R", "ranged", { class: "smg", damage: 8, range: 18, cooldown: 0.09, staminaCost: 0, magazine: 24, ammo: "combat-test-9mm", reload: 1.8, spread: 0.06, knockback: 0.1, stagger: 0.05, automatic: 11 }),
  weapon("combat-test-shotgun", "Test shotgun", "S", "ranged", { class: "shotgun", damage: 7, range: 10, cooldown: 0.8, staminaCost: 0, magazine: 5, ammo: "combat-test-shells", reload: 2.2, spread: 0.12, pellets: 8, knockback: 1.2, stagger: 0.4 }),
  // Enemy weapons.
  weapon("razorback-pipe", "Rebar pipe", "|", "melee", { class: "blunt", damage: 13, range: 2.2, cooldown: 1.3, staminaCost: 0, arc: 50, knockback: 0.7, stagger: 0.3 }, 20),
  weapon("razorback-pistol", "Zip pistol", "r", "ranged", { class: "pistol", damage: 7, range: 22, cooldown: 0.5, staminaCost: 0, magazine: 8, reload: 1.8, spread: 0.05, knockback: 0.2, stagger: 0.1 }, 40),
  weapon("corpsec-carbine", "CorpSec carbine", "R", "ranged", { class: "rifle", damage: 6, range: 30, cooldown: 0.16, staminaCost: 0, magazine: 24, reload: 2.2, spread: 0.035, knockback: 0.2, stagger: 0.1, automatic: 6 }, 120),
  weapon("corpsec-baton", "Shock baton", "!", "melee", { class: "baton", damage: 12, range: 2.3, cooldown: 1.2, staminaCost: 0, arc: 45, knockback: 0.6, stagger: 0.45 }, 60),
  weapon("warlord-maul", "Warlord's maul", "T", "melee", { class: "blunt", damage: 18, range: 3.4, cooldown: 1.5, staminaCost: 0, arc: 65, knockback: 2, stagger: 0.6 }, 400),
];

const bark = { alert: ["HEY!", "GET HIM!", "YOU'RE DEAD!"], hurt: ["ARGH!", "LUCKY HIT!"], death: ["...ugh"] };

/** Test archetypes: two Razorbacks (melee, ranged), a CorpSec trooper, a boss and its adds. */
export const COMBAT_TEST_ARCHETYPES: readonly EnemyArchetype[] = [
  {
    id: "razorback-thug", name: "Razorback thug", faction: "razorbacks", health: 75, armor: 0.05,
    speed: { walk: 1.6, run: 5.2 }, weapon: "razorback-pipe", reaction: 0.6, aggression: 0.7,
    perception: { sight: 36, fovDegrees: 110, hearing: 30 },
    look: { coat: [120, 44, 40], trim: [40, 24, 22], skin: [180, 140, 110], light: [255, 90, 60], headwear: "bare", prop: null, idle: "swing" },
    loot: "razorback-common", xp: 25, tags: ["razorback", "gang"], barks: bark,
  },
  {
    id: "razorback-gunner", name: "Razorback gunner", faction: "razorbacks", health: 45, armor: 0,
    speed: { walk: 1.6, run: 4.6 }, weapon: "razorback-pistol", reaction: 0.9, aggression: 0.35,
    perception: { sight: 48, fovDegrees: 100, hearing: 40 },
    look: { coat: [96, 40, 44], trim: [36, 22, 24], skin: [160, 120, 96], light: [255, 120, 60], headwear: "cap", prop: null, idle: "scan" },
    loot: "razorback-common", xp: 30, tags: ["razorback", "gang"], barks: bark,
  },
  {
    id: "corpsec-trooper", name: "CorpSec trooper", faction: "corpsec", health: 90, armor: 0.25,
    speed: { walk: 1.8, run: 5 }, weapon: "corpsec-carbine", reaction: 0.5, aggression: 0.55,
    perception: { sight: 60, fovDegrees: 120, hearing: 45 },
    look: { coat: [60, 70, 90], trim: [20, 24, 32], skin: [170, 140, 120], light: [120, 200, 255], headwear: "visor", prop: "antenna", idle: "breathe" },
    loot: "corpsec-common", xp: 45, tags: ["corpsec"],
    barks: { alert: ["CONTACT.", "HOSTILE SIGHTED."], hurt: ["TAKING FIRE."], death: ["...officer down"] },
  },
  {
    id: "razorback-warlord", name: "Brakka", faction: "razorbacks", health: 1000, armor: 0.15,
    speed: { walk: 1.8, run: 4.4 }, weapon: "warlord-maul", reaction: 0.3, aggression: 1,
    perception: { sight: 50, fovDegrees: 160, hearing: 60 }, scale: 1.6,
    look: { coat: [150, 30, 30], trim: [30, 10, 10], skin: [170, 120, 90], light: [255, 60, 40], headwear: "hood", prop: null, idle: "breathe" },
    loot: "boss-warlord", xp: 600, tags: ["razorback", "boss"],
    barks: { alert: ["FRESH MEAT!"], hurt: ["IS THAT ALL?"], death: ["...the tusks... break..."] },
    boss: {
      title: "Razorback Warlord",
      phases: [
        { atHealth: 1, attacks: ["slam", "sweep", "charge"] },
        { atHealth: 0.6, message: "Brakka roars for his crew!", spawn: "combat-test-adds", speedMultiplier: 1.15, damageMultiplier: 1.1, attacks: ["barrage", "charge", "summon", "sweep"] },
        { atHealth: 0.3, message: "Brakka's tusks glow white-hot!", speedMultiplier: 1.3, damageMultiplier: 1.25, attacks: ["shockwave", "slam", "barrage", "charge"] },
      ],
    },
  },
];

/** A roaming test gang on the x = 64 street, a boss arena and the boss's reinforcements. */
export const COMBAT_TEST_ENCOUNTERS: readonly EncounterDefinition[] = [
  {
    id: "combat-test-gang", label: "Razorback corner crew", area: { x: 64, z: 96, radius: 14 }, hostile: true,
    members: [
      { archetype: "razorback-thug", x: 62, z: 92, yaw: 0, patrol: [{ x: 62, z: 84 }, { x: 62, z: 104 }] },
      { archetype: "razorback-thug", x: 66, z: 98, yaw: Math.PI },
      { archetype: "razorback-gunner", x: 64, z: 110, yaw: 0 },
    ],
  },
  {
    id: "combat-test-boss", label: "The Warlord's crossing", area: { x: 64, z: 128, radius: 18 }, hostile: true,
    members: [{ archetype: "razorback-warlord", x: 64, z: 132, yaw: 0, tag: "boss" }],
  },
  {
    id: "combat-test-adds", label: "Warlord's crew", area: { x: 64, z: 128, radius: 18 }, hostile: true,
    members: [{ archetype: "razorback-thug", x: 60, z: 140 }, { archetype: "razorback-thug", x: 68, z: 140 }],
  },
];
