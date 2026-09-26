// Tuning constants and tiny weapon helpers shared by the combat modules.

import type { WeaponStats } from "../types.ts";
import { clamp } from "./util.ts";

/** Radius and height of the player's hit cylinder (the body, not the 0.8 m wall margin). */
export const PLAYER_BODY = 0.45;
export const PLAYER_HEIGHT = 2.9;
/** Enemies farther than this from the player are frozen (not simulated). */
export const SIM_RADIUS = 160;
/** Metres beyond an encounter's area at which its enemies give up and go home. */
export const LEASH = 90;
/** At most this many regular melee enemies swing at the player at once (bosses count as one). */
export const MELEE_TOKENS = 2;
export const RANGED_TOKENS = 2;
/** Seconds between two melee enemies starting their approach-and-swing. */
export const TOKEN_SPACING = 0.35;

export const FISTS: WeaponStats = { class: "blunt", damage: 6, range: 1.8, cooldown: 0.42, staminaCost: 7, heavyMultiplier: 1.8, arc: 40, knockback: 0.4, stagger: 0.25, critChance: 0.05, critMultiplier: 1.6 };

export const isRanged = (w: WeaponStats): boolean => w.class === "pistol" || w.class === "smg" || w.class === "shotgun" || w.class === "rifle";
export const clampArmor = (armor: number): number => clamp(armor, 0, 0.9);
