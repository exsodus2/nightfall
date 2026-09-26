// Public API of the combat system (rpg/combat). Other systems import only from here.

/** World ray cast against building boxes, street solids and the ground; hasLineOfSight / walkable tests. */
export { raycastWorld, hasLineOfSight, walkable, type RayHit } from "./raycast.ts";
/** The combat simulation: player combat, enemy AI, bosses and encounters on a fixed 60 Hz tick. */
export { CombatWorld, type CombatWorldOptions, type CombatSave } from "./combat-world.ts";
/** Built-in test roster: archetypes, their weapons and a starter kit, and test encounters. */
export { COMBAT_TEST_ARCHETYPES, COMBAT_TEST_ENCOUNTERS, COMBAT_TEST_ITEMS } from "./archetypes.ts";
/** Player combat tuning (hold time for heavies, parry window, dodge timing and cost). */
export { HEAVY_HOLD, PARRY_WINDOW, BLOCK_REDUCTION, DODGE_TIME, DODGE_IFRAMES, DODGE_DISTANCE, DODGE_COST, STAMINA_DELAY } from "./player.ts";
/** Encounter / AI tuning: sim radius, leash distance, attack token counts, player body size, fists. */
export { SIM_RADIUS, LEASH, MELEE_TOKENS, RANGED_TOKENS, PLAYER_BODY, FISTS } from "./constants.ts";
/** Fixed simulation step (seconds) and the deterministic default RNG. */
export { TICK, seededRandom } from "./util.ts";
