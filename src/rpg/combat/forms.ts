// Enemy "forms": behaviour families an archetype opts into with a tag ("form:rusher", ...), so
// content stays data and the shared EnemyArchetype contract does not change. Each form changes how
// the AI fights (ai.ts), how hits land on it (sim.ts / player.ts) and how it is drawn (scene).
//   rusher   fast knife fighter: circles close, then a telegraphed lunge across 3-6.5 m
//   bruiser  shotgun heavy: holds ~6 m and shoots, then a telegraphed shoulder rush (stuns on a wall)
//   drone    hovering machine: orbits and strafes, shoots in bursts; melee passes under it
//   shield   shield-bearer: frontal hits glance off; heavy blows break the guard, parries open it

import type { EnemyView } from "../types.ts";

export type EnemyForm = "rusher" | "bruiser" | "drone" | "shield";
export const ENEMY_FORMS: readonly EnemyForm[] = ["rusher", "bruiser", "drone", "shield"];

/** An EnemyView that also names its form. CombatWorld fills `form`; the shared EnemyView contract
 * is unchanged, so anything that builds plain EnemyViews (tests, remote players) still works. */
export type FormedEnemyView = EnemyView & { form?: EnemyForm | null };
/** The form of an enemy view (null for plain figures). */
export function viewForm(e: EnemyView): EnemyForm | null {
  const form = (e as FormedEnemyView).form;
  return form && ENEMY_FORMS.includes(form) ? form : null;
}

/** The archetype tag that selects a form. */
export const formTag = (form: EnemyForm): string => `form:${form}`;

/** The form an archetype's tags select (the first one listed in ENEMY_FORMS wins). */
export function enemyForm(tags: readonly string[] | undefined): EnemyForm | null {
  if (!tags) return null;
  for (const form of ENEMY_FORMS) if (tags.includes(formTag(form))) return form;
  return null;
}

/** Drones: the hull's hit volume spans DRONE_BASE..DRONE_TOP metres above the ground. Melee
 * swings (at most ~1.6 m up) pass beneath it, so a drone has to be shot. */
export const DRONE_BASE = 1.6;
export const DRONE_TOP = 3.2;
/** Shield-bearers turn hits arriving within this half-angle of their facing. */
export const SHIELD_ARC = 65 * Math.PI / 180;
/** A blocked hit keeps this fraction of its damage. */
export const SHIELD_CHIP = 0.15;

/** Rusher lunge: wind-up (crouch), dash speed and the distance band it is used from. */
export const LUNGE = { windup: 0.45, speed: 13, active: 0.3, recovery: 0.75, min: 3, max: 6.5 } as const;
/** Bruiser rush: wind-up (head down, ground line), run speed, length, and the gap between rushes. */
export const RUSH = { windup: 0.7, speed: 10, length: 12, recovery: 0.8, min: 4.5, max: 11, every: 6, damage: 18 } as const;

/** Player melee hit-stop (seconds): the swing and the struck enemy hold for a beat. <= 60 ms. */
export const HIT_STOP = { light: 0.04, heavy: 0.06 } as const;
