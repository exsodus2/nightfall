// Public API of rpg/scene: everything the player SEES of combat and the RPG, in the city's ASCII
// style. Engine integration (the lead):
//   recordProps(sink):  drawEnemies, drawGroundLoot, drawInteractables   (PropCanvas, batched)
//   main pass scenery(false), after props/cockpit, before flushVfx:        drawViewmodel, drawCombatEffects
//   overlay layer (ortho), after drawRemoteLabels:                          drawCombatOverlay
/** Enemy figures (faction silhouettes, weapons, telegraphs, hit flash, death dissolve). */
export { drawEnemies, enableEnemyRimLight, enemyPose, ENEMY_RANGE } from "./enemies.ts";
/** First-person weapon (camera-attached, lower right) and its pose maths. */
export { drawViewmodel, recordViewmodel, viewmodelState, resetViewmodel, type ViewmodelCamera, type ViewmodelState } from "./viewmodel.ts";
/** Ground loot tokens + rarity light pillars, and interactable markers. */
export { drawGroundLoot, drawInteractables, isCredits, LOOT_RANGE, PILLAR_HEIGHT } from "./loot.ts";
/** 3D combat effects: tracers, sparks, slash ribbons, muzzle flashes, telegraphs, projectiles. */
export { drawCombatEffects, recordCombatEffects, drawTelegraph, strokeGlyph, EFFECT_LIFE } from "./effects.ts";
/** Fast combat HUD for the overlay layer. */
export {
  drawCombatOverlay, hudLayout, toCell, bigDigits, showEnemyLabel, enemyScreenBox, crosshairGap, hitMarker, healthColor, hpLine,
  bossBarText, phasePips, arcGlyph, vignetteStrength, type CombatOverlayFrame, type OverlayCanvas,
} from "./overlay.ts";
export { combatHudLayout, fitHudText, hudNumber, type CombatHudLayout, type HudInsets, type HudRegion, type HudViewport } from "./hud-layout.ts";
/** Shared palette: rarity colours (also for React screens), faction styles, the density ramp. */
export { RARITY_COLOR, RARITY_CSS, RARITY_ORDER, rarityTier, FACTION_STYLE, factionStyle, RAMP, type Rgb, type FactionStyle } from "./palette.ts";
/** Timing maths: hit flash, telegraph pulse, death particles, attack phases, damage-number ramp, bars. */
export {
  hitFlash, telegraphPulse, deathParticles, attackPhase, enemyMotion, numberGlyph, numberGain, numberRise, asciiBar,
  DEATH_TIME, NUMBER_LIFE, TELEGRAPH_HZ,
} from "./anim.ts";
/** ASCII weapon models shared by enemies and the viewmodel. */
export { drawWeaponModel, WEAPON_TIP, type WeaponModel, type WeaponPaint } from "./weapons.ts";
/** Optional rim-lit enemy surface for materials.ts (splice like VFX_GLSL_BRANCH, then enableEnemyRimLight(true)). */
export { RPG_GLSL_BRANCH, RPG_SURFACE } from "./rpg-shaders.ts";
