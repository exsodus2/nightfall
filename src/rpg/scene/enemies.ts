// Enemy figures: residents' proportions (people-scene.ts / npc-scene.ts) with faction silhouettes -
// Razorbacks spiked and red, Chrome Saints tall with a halo and visor, CorpSec armoured and blue,
// Ghosts hooded and dark with cyan eyes - a weapon in hand, and readable states:
//   idle breathing, gait from real movement, a clear attack TELEGRAPH (weapon raised, figure heats
//   up, a pulsing "!" overhead), the swing/shot, stagger, a hold-then-fade hit flash (# / @ cells,
//   never strobing), and a ~1.2 s death "de-rasterise" (collapse, then the characters scatter,
//   fall and cool through the density ramp).
// Readability at night: an emissive ground ring and lit seams/eyes in the faction's accent colour
// act as the rim light (optionally the RPG rim surface in rpg-shaders.ts adds a true fresnel rim).
// Everything goes through PropCanvas so enemies batch with the city props (engine recordProps).
import { PropRecorder, type PropCanvas } from "../../city/prop-canvas.ts";
import type { ActivityView } from "../../city/activity.ts";
import type { EnemyView } from "../types.ts";
import {
  DEATH_COLLAPSE, DEATH_TIME, attackPhase, deathParticles, endEnemyFrame, enemyMotion, hitFlash, telegraphPulse,
  type AttackPhase, type DeathParticle, type EnemyMotion,
} from "./anim.ts";
import {
  DEG, RAMP, blob, box, clearPaintMods, factionStyle, glowOf, hashString, mix, paint, paintRange, restorePaintRange, ring,
  setPaintMods, smooth, type FactionStyle, type Rgb,
} from "./palette.ts";
import { RPG_SURFACE } from "./rpg-shaders.ts";
import { defaultWeaponPaint, drawWeaponModel, isRanged, isTwoHanded } from "./weapons.ts";

/** Enemies further than this are not drawn (m). */
export const ENEMY_RANGE = 200;
const DETAIL_RANGE = 90;
const SHOE: Rgb = [28, 30, 36];
const WARN: Rgb = [255, 118, 40];
const VULNERABLE: Rgb = [255, 226, 80];

let rimSurface = false;
/** Opt in to the rim-lit enemy surface once the lead has spliced RPG_GLSL_BRANCH into materials.ts
 * (otherwise SURFACE 9 would fall into the VFX branch and discard). Default off: SURFACE 2 props. */
export function enableEnemyRimLight(on: boolean): void { rimSurface = on; }
function setSurface(t: PropCanvas, surface: number): void {
  if (t instanceof PropRecorder) t.surface = surface; else t.setUniform("u_surface", surface);
}

// Pose, reused (no per-frame allocation). Angles in degrees; rotateX < 0 swings a hanging limb forward.
const pose = { lean: 0, twist: 0, head: 0, armR: 0, armRSide: 0, armL: 0, armLSide: 0, armLYaw: 0, wrist: 0, legL: 0, legR: 0, sink: 0, breathe: 1 };
type Pose = typeof pose;
const weapon = defaultWeaponPaint();
const particles: DeathParticle[] = [];
const NO_ATTACK: AttackPhase = { stage: "none", k: 0 };

/** Pose for one enemy this frame (exported for tests). */
export function enemyPose(e: EnemyView, motion: EnemyMotion, phase: AttackPhase, time: number, out: Pose = pose): Pose {
  const seed = hashString(e.id) * 6.28;
  const ranged = isRanged(e.weaponClass), two = isTwoHanded(e.weaponClass);
  const ready = e.hostile && (e.state === "alert" || e.state === "chase" || e.state === "attack" || e.state === "reposition");
  out.lean = 0; out.twist = 0; out.head = 0; out.sink = 0; out.wrist = 20;
  out.breathe = 1 + Math.sin(time * 1.6 + seed) * 0.03;
  out.armRSide = 4; out.armLSide = 4; out.armLYaw = 0;
  // Gait: legs swing with the distance actually covered; arms counter-swing; running leans in.
  const walk = Math.min(1, motion.gait), run = Math.max(0, motion.gait - 1);
  const swing = Math.sin(motion.stride) * (24 * walk + 18 * run);
  out.legL = swing; out.legR = -swing;
  out.armL = -swing * 0.7 + Math.sin(time * 1.1 + seed) * 2; out.armR = swing * 0.7 + Math.sin(time * 1.1 + seed + 1) * 2;
  out.lean = run * 9;
  if (e.state === "suspicious") out.head = Math.sin(time * 0.9 + seed) * 35;
  // Weapon stance.
  if (ranged && ready) {
    out.armR = -86; out.armRSide = 0;
    if (two) { out.armL = -78; out.armLSide = 0; out.armLYaw = 26; }
  } else if (!ranged && ready) {
    out.armR = -38 + swing * 0.2; out.wrist = 25;
  } else if (!ranged) out.armR = Math.min(out.armR, -12);
  // Attack: wind-up (the telegraph) raises the weapon, the strike swings it, recovery settles.
  if (phase.stage !== "none") {
    const k = phase.k;
    if (ranged) {
      out.armR = -88; out.armRSide = 0;
      if (two) { out.armL = -80; out.armLSide = 0; out.armLYaw = 26; }
      if (phase.stage === "windup") { out.lean = -2 * k; out.head = 0; }
      else if (phase.stage === "strike") { out.armR = -88 - 10 * (1 - k); out.armL -= 6 * (1 - k); out.lean = -3 * (1 - k); }
    } else if (phase.stage === "windup") {
      const w = smooth(0, 1, k);
      out.armR = -38 - 118 * w; out.twist = -16 * w; out.lean = -6 * w; out.wrist = 25 - 10 * w; out.armL = -30 * w;
    } else if (phase.stage === "strike") {
      const s = 1 - Math.pow(1 - k, 3);
      out.armR = -156 + 140 * s; out.twist = -16 + 36 * s; out.lean = -6 + 16 * s; out.wrist = 15 + 25 * s; out.armL = -30 + 20 * s;
    } else {
      const r = smooth(0, 1, k);
      out.armR = -16 - 22 * r; out.twist = 20 * (1 - r); out.lean = 10 * (1 - r); out.wrist = 40 - 15 * r;
    }
  }
  if (e.state === "stagger") {
    out.lean = -16; out.armRSide = 32; out.armLSide = 32; out.armLYaw = 0; out.armR = -50; out.armL = -40; out.head = 0; out.twist = 0;
    out.legL = 10; out.legR = -6;
  }
  // A fresh hit knocks the upper body back a little (localized; the camera never moves).
  const flash = hitFlash(e.hitAge);
  if (flash > 0) out.lean -= 7 * flash;
  return out;
}

/** Enemy figures for the prop pass (engine recordProps, after NPCs). */
export function drawEnemies(sink: PropCanvas, view: ActivityView, enemies: readonly EnemyView[], time: number): void {
  endEnemyFrame();
  if (!enemies.length) return;
  const outer = paintRange(ENEMY_RANGE);
  if (rimSurface) setSurface(sink, RPG_SURFACE);
  for (const e of enemies) {
    const dx = e.x - view.x, dz = e.z - view.z, distance = Math.hypot(dx, dz);
    if (distance > ENEMY_RANGE) continue;
    const motion = enemyMotion(e, time), phase = attackPhase(e);
    if (e.deathAge >= DEATH_TIME) continue;
    const scale = e.scale ?? 1;
    if (view.visible && distance > 12 && !view.visible(e.x, 2 * scale, e.z, scale)) continue;
    drawEnemy(sink, e, motion, phase, time, distance, Math.atan2(view.x - e.x, e.z - view.z));
  }
  clearPaintMods();
  if (rimSurface) setSurface(sink, 2);
  restorePaintRange(outer);
}

function drawEnemy(t: PropCanvas, e: EnemyView, motion: EnemyMotion, phase: AttackPhase, time: number, distance: number, toViewer: number): void {
  const style = factionStyle(e.faction);
  const scale = (e.scale ?? 1) * (style.silhouette === "tall" ? 1.1 : 1);
  const detail = distance < DETAIL_RANGE;
  const dying = e.deathAge >= 0;
  const flash = dying ? 0 : hitFlash(e.hitAge);
  const heat = phase.stage === "windup" ? 0.35 + 0.65 * phase.k : phase.stage === "strike" ? 1 - phase.k * 0.6 : 0;
  // Faction colours with a touch of the archetype's own look for variety within a gang.
  const body = mix(style.body, e.look.coat, 0.18), trim = mix(style.trim, e.look.trim, 0.15);
  t.push(); t.translate(e.x, 0, e.z); t.rotateY(-e.yaw * DEG);

  if (dying) {
    // De-rasterise: first the figure buckles backwards and its cells thin out through the ramp...
    if (e.deathAge < DEATH_COLLAPSE) {
      const k = smooth(0, 1, e.deathAge / DEATH_COLLAPSE);
      setPaintMods(0, 0, 1 - 0.45 * k, RAMP[Math.min(RAMP.length - 1, 2 + Math.floor(k * 4))]);
      t.push(); t.scale(scale); t.translate(0, 0, 0.2 * k); t.rotateX(-68 * k); t.scale(1, 1 - 0.3 * k, 1);
      const p = enemyPose(e, motion, NO_ATTACK, time);
      p.armRSide = 30 * k; p.armLSide = 30 * k;
      drawFigure(t, e, style, body, trim, p, detail, time);
      t.pop();
    }
    // ...then its characters scatter, fall and cool out.
    clearPaintMods();
    const cells = deathParticles(e.id, e.deathAge, scale, detail ? (e.boss ? 56 : 30) : 14, particles);
    const cellSize = Math.max(0.08, distance * 0.014);
    for (const q of cells) {
      paint(t, mix(style.light, body, 0.5 + 0.5 * (1 - q.fade)), q.glyph, 0.35 + q.fade * 0.75);
      const s = Math.max(cellSize, q.size * scale);
      box(t, q.x, q.y, q.z, s, s, s);
    }
    t.pop();
    return;
  }

  // Readability: the emissive ground ring in the faction accent (brighter when they're after you).
  if (e.hostile) {
    const alert = e.state === "alert" || e.state === "chase" || e.state === "attack";
    paint(t, glowOf(style.light), "-", alert ? 0.9 : 0.55);
    ring(t, 0, 0.04, 0, 0.85 * scale, 0.035 * scale);
  }
  if (e.boss) drawAura(t, style, scale, time);

  setPaintMods(flash, heat, 1);
  t.push(); t.scale(scale);
  drawFigure(t, e, style, body, trim, enemyPose(e, motion, phase, time), detail, time);
  t.pop();
  clearPaintMods();

  // Overhead markers face the viewer: the telegraph "!" (smooth 2 Hz swell, warm) or the
  // vulnerable star. They grow with distance so they never shrink under ~2 cells.
  const top = 3.05 * scale + 0.25;
  if (phase.stage === "windup" || e.windup) {
    const size = Math.max(1, Math.min(6, distance / 18)) * (e.boss ? 1.4 : 1);
    t.push(); t.translate(0, -top, 0); t.rotateY(-(toViewer - e.yaw) * DEG); t.scale(size);
    paint(t, WARN, "!", telegraphPulse(time) * 1.05);
    box(t, 0, 0.72, 0, 0.18, 0.56, 0.18); box(t, 0, 0.1, 0, 0.18, 0.18, 0.18);
    t.pop();
  } else if (e.vulnerable) {
    const size = Math.max(1, Math.min(6, distance / 18));
    t.push(); t.translate(0, -(top + 0.3), 0); t.rotateY(time * 60); t.rotateZ(45); t.scale(size);
    paint(t, VULNERABLE, "*", 1); t.box(0.26, 0.26, 0.26);
    t.pop();
  }
  t.pop();
}

/** Boss aura: two slow rings on the ground and one rising around the body, with orbiting motes. */
function drawAura(t: PropCanvas, style: FactionStyle, scale: number, time: number): void {
  const light = glowOf(style.light);
  const breathe = 0.85 + 0.15 * Math.sin(time * 1.3);
  paint(t, light, "=", 0.8 * breathe); ring(t, 0, 0.05, 0, 1.35 * scale, 0.05 * scale);
  paint(t, light, "-", 0.55); ring(t, 0, 0.05, 0, (1.35 + 0.6 * ((time * 0.4) % 1)) * scale, 0.03 * scale);
  const rise = (time * 0.35) % 1;
  paint(t, light, "o", 0.9 - rise * 0.5); ring(t, 0, rise * 2.8 * scale, 0, (0.95 - rise * 0.3) * scale, 0.03 * scale);
  paint(t, light, "*", 0.9);
  for (let i = 0; i < 5; i++) {
    const a = time * 0.8 + i * 1.2566, h = (1 + Math.sin(time * 0.9 + i * 2.1) * 0.6 + 0.6) * scale;
    box(t, Math.cos(a) * 1.1 * scale, h, Math.sin(a) * 1.1 * scale, 0.09 * scale, 0.09 * scale, 0.09 * scale);
  }
}

/** The figure in its unit frame (1.0 = resident size; the caller applies scale). */
function drawFigure(t: PropCanvas, e: EnemyView, style: FactionStyle, body: Rgb, trim: Rgb, p: Pose, detail: boolean, time: number): void {
  const sil = style.silhouette;
  const light = glowOf(style.light);
  const torsoW = sil === "spiked" ? 0.5 : sil === "hooded" ? 0.38 : sil === "armoured" ? 0.47 : 0.43;
  // Legs (hip pivots) and boots.
  for (let side = -1; side <= 1; side += 2) {
    t.push(); t.translate(side * 0.2, -0.94, 0); t.rotateX(side < 0 ? p.legL : p.legR);
    paint(t, trim, "|"); box(t, 0, -0.47, 0, 0.27, 0.94, 0.31);
    paint(t, SHOE, "="); box(t, 0, -0.86, -0.08, 0.3, 0.17, 0.48);
    if (sil === "armoured" && detail) { paint(t, style.trim, "#"); box(t, 0, -0.5, -0.17, 0.24, 0.2, 0.06); }
    t.pop();
  }
  // Upper body leans and twists about the hips.
  t.push(); t.translate(0, -0.94, 0); t.rotateX(p.lean); t.rotateY(p.twist); t.translate(0, 0.94, 0);
  paint(t, body, style.glyph);
  blob(t, 0, 1.45, 0, torsoW, 0.66 * p.breathe, 0.31);
  if (sil === "tall" || sil === "hooded") {
    // Long coat / cloak skirt.
    paint(t, sil === "hooded" ? body : trim, sil === "hooded" ? "%" : "|");
    box(t, 0, sil === "hooded" ? 0.72 : 0.9, 0.02, sil === "hooded" ? 0.76 : 0.8, sil === "hooded" ? 0.95 : 0.7, 0.5);
    if (sil === "hooded" && detail) { paint(t, style.trim, "~"); box(t, 0, 0.27, 0.02, 0.78, 0.06, 0.52); }
  }
  // Lit seams down the flanks: the faction's rim light that separates the figure from the street.
  paint(t, light, "|", sil === "hooded" ? 0.55 : 0.75);
  for (let side = -1; side <= 1; side += 2) box(t, side * (torsoW - 0.05), 1.45, -0.18, 0.05, 0.62, 0.05);
  paint(t, trim, "=");
  box(t, 0, 1.0, 0, torsoW * 2 + 0.04, 0.09, 0.62);
  if (sil === "armoured") {
    paint(t, style.trim, "#"); box(t, 0, 1.55, -0.24, 0.66, 0.6, 0.12);
    for (let side = -1; side <= 1; side += 2) box(t, side * 0.57, 1.94, 0, 0.32, 0.2, 0.42);
    if (detail) { paint(t, light, "o", 0.85); box(t, -0.2, 1.72, -0.31, 0.08, 0.08, 0.03); }
  } else if (sil === "spiked") {
    paint(t, style.trim, "#");
    for (let side = -1; side <= 1; side += 2) box(t, side * 0.56, 1.95, 0, 0.36, 0.17, 0.38);
    paint(t, style.detail, "^");
    for (let side = -1; side <= 1; side += 2) for (let k = 0; k < 3; k++) {
      t.push(); t.translate(side * (0.46 + k * 0.1), -2.09, (k - 1) * 0.1); t.rotateZ(side * 20); t.rotateY(45);
      t.box(0.07, 0.24, 0.07); t.pop();
    }
    if (detail) { paint(t, light, "+", 0.9); box(t, 0, 1.0, -0.33, 0.12, 0.1, 0.04); }
  } else if (sil === "tall") {
    paint(t, light, "+", 0.85); box(t, 0, 1.62, -0.3, 0.06, 0.34, 0.04); box(t, 0, 1.68, -0.3, 0.22, 0.06, 0.04);
  }
  drawArms(t, e, style, body, trim, p, detail, time);
  drawHead(t, style, body, p, detail, time);
  t.pop();
}

function drawArms(t: PropCanvas, e: EnemyView, style: FactionStyle, body: Rgb, trim: Rgb, p: Pose, detail: boolean, time: number): void {
  const skin = e.look.skin;
  const gloves = style.silhouette === "armoured" || style.silhouette === "tall";
  for (let side = -1; side <= 1; side += 2) {
    const right = side > 0;
    // Shoulder: yaw inward (support hand on a long gun), abduct (stagger flail), then lift.
    t.push(); t.translate(side * 0.52, -1.9, 0);
    if (!right && p.armLYaw) t.rotateY(side * p.armLYaw);
    t.rotateZ(-side * (right ? p.armRSide : p.armLSide)); t.rotateX(right ? p.armR : p.armL);
    paint(t, style.silhouette === "armoured" ? trim : body, "|"); box(t, 0, -0.45, 0, 0.2, 0.9, 0.24);
    paint(t, gloves ? style.trim : skin, "o"); box(t, 0, -0.95, 0, 0.14, 0.14, 0.16);
    if (right) {
      // The weapon, in the hand frame: guns lie along the arm, melee weapons across the fist.
      t.push(); t.translate(0, 0.96, 0);
      const ranged = isRanged(e.weaponClass);
      if (ranged) t.rotateX(90); else t.rotateX(p.wrist);
      t.scale(1.3);
      weapon.metal = style.silhouette === "tall" ? [196, 204, 214] : [128, 134, 144];
      weapon.dark = [40, 44, 52];
      weapon.trim = glowOf(style.light);
      weapon.glyph = ""; weapon.mag = 0; weapon.detail = detail;
      weapon.charge = e.state === "attack" ? 1 : 0.4 + 0.2 * Math.sin(time * 2);
      drawWeaponModel(t, e.weaponClass, weapon);
      t.pop();
    }
    t.pop();
  }
}

function drawHead(t: PropCanvas, style: FactionStyle, body: Rgb, p: Pose, detail: boolean, time: number): void {
  const light = glowOf(style.light);
  t.push(); t.translate(0, -2.28, -0.03); t.rotateY(p.head);
  switch (style.silhouette) {
    case "hooded":
      paint(t, style.detail, "."); blob(t, 0, 0, 0, 0.23, 0.3, 0.24);
      paint(t, body, "%"); blob(t, 0, 0.06, 0.06, 0.32, 0.4, 0.33);
      // Two cyan eyes in the dark of the hood - the one thing you see first.
      paint(t, light, "o", 1);
      for (let side = -1; side <= 1; side += 2) box(t, side * 0.085, 0.02, -0.285, 0.07, 0.045, 0.03);
      break;
    case "armoured":
      paint(t, style.trim, "#"); blob(t, 0, 0.02, 0, 0.29, 0.34, 0.3);
      paint(t, light, "=", 1); box(t, 0, 0.02, -0.24, 0.44, 0.1, 0.08);
      if (detail) { paint(t, style.detail, "|"); box(t, 0.24, 0.3, 0.05, 0.03, 0.26, 0.03); }
      break;
    case "tall":
      paint(t, [150, 156, 166], "O"); blob(t, 0, 0, 0, 0.24, 0.31, 0.25);
      paint(t, style.detail, "=", 1); box(t, 0, 0.03, -0.2, 0.46, 0.08, 0.12);
      // Halo: a lit ring floating over the head, turning slowly.
      t.push(); t.translate(0, -0.55, 0.05); t.rotateY(time * 25); t.rotateX(24);
      paint(t, light, "o", 1); t.torus(0.32, 0.028);
      t.pop();
      break;
    case "spiked":
      paint(t, [150, 118, 96], "O"); blob(t, 0, 0, 0, 0.25, 0.31, 0.25);
      paint(t, light, "^", 1); box(t, 0, 0.36, 0.02, 0.07, 0.18, 0.44);
      paint(t, [30, 26, 26], "="); box(t, 0, 0.04, -0.21, 0.4, 0.07, 0.1);
      paint(t, light, ".", 0.9);
      for (let side = -1; side <= 1; side += 2) box(t, side * 0.09, 0.04, -0.26, 0.05, 0.03, 0.02);
      break;
    default:
      paint(t, [160, 128, 104], "O"); blob(t, 0, 0, 0, 0.25, 0.31, 0.25);
      paint(t, [36, 38, 46], "="); blob(t, 0, 0.22, 0.02, 0.27, 0.12, 0.26);
      paint(t, light, "-", 0.85); box(t, 0, 0.03, -0.22, 0.34, 0.05, 0.04);
  }
  t.pop();
}
