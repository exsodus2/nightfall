// Enemy figures: residents' proportions (people-scene.ts / npc-scene.ts) with faction silhouettes -
// Razorbacks spiked and red, Chrome Saints tall with a halo and visor, CorpSec armoured and blue,
// Ghosts hooded and dark with cyan eyes - a weapon in hand, and readable states:
//   idle breathing, gait from real movement, a clear attack TELEGRAPH (weapon raised, figure heats
//   up, a "!" overhead that heats toward the strike), the swing/shot, stagger, a hold-then-fade hit flash (# / @ cells,
//   never strobing), and a ~1.2 s death "de-rasterise" (collapse, then the characters scatter,
//   fall and cool through the density ramp).
// Readability at night: an emissive ground ring and lit seams/eyes in the faction's accent colour
// act as the rim light (optionally the RPG rim surface in rpg-shaders.ts adds a true fresnel rim).
// Everything goes through PropCanvas so enemies batch with the city props (engine recordProps).
import { PropRecorder, type PropCanvas } from "../../city/prop-canvas.ts";
import type { ActivityView } from "../../city/activity.ts";
import type { EnemyView } from "../types.ts";
import { viewForm } from "../combat/forms.ts";
import {
  DEATH_COLLAPSE, DEATH_TIME, attackHeat, attackPhase, deathBodyGain, deathParticles, endEnemyFrame, enemyMotion, hitFlash,
  settlePose, telegraphGlow, telegraphScale, type AttackPhase, type DeathParticle, type EnemyMotion,
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
// guard: 0 shield up .. 1 guard open (shield-bearers); charge: weapon light energy; heat: attack glow.
const pose = { lean: 0, twist: 0, head: 0, armR: 0, armRSide: 0, armL: 0, armLSide: 0, armLYaw: 0, wrist: 0, legL: 0, legR: 0, sink: 0, breathe: 1, guard: 0, charge: 0, heat: 0 };
type Pose = typeof pose;
/** Every pose field eases between frames (settlePose): nothing in the figure steps. */
const POSE_KEYS = Object.keys(pose) as (keyof Pose)[];
// The drone's eased values (heat drives the eye, glow and hover steadiness).
const droneLook = { heat: 0 };
const DRONE_KEYS = Object.keys(droneLook) as (keyof typeof droneLook)[];
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
  out.heat = attackHeat(phase);
  out.charge = e.state === "attack" ? 1 : 0.4 + 0.2 * Math.sin(time * 2); // idle hum ~0.32 Hz
  out.guard = viewForm(e) === "shield" && (!!e.vulnerable || e.state === "stagger") ? 1 : 0;
  out.armRSide = 4; out.armLSide = 4; out.armLYaw = 0;
  // Gait: legs swing with the distance actually covered; arms counter-swing; running leans in.
  const walk = Math.min(1, motion.gait), run = Math.max(0, motion.gait - 1);
  const swing = Math.sin(motion.stride) * (24 * walk + 18 * run);
  out.legL = swing; out.legR = -swing;
  out.armL = -swing * 0.7 + Math.sin(time * 1.1 + seed) * 2; out.armR = swing * 0.7 + Math.sin(time * 1.1 + seed + 1) * 2;
  out.lean = run * 9;
  // A small lift on each step (more when running): the body rides the stride instead of gliding.
  out.sink = -Math.abs(Math.sin(motion.stride)) * (0.025 * walk + 0.05 * run);
  if (e.state === "suspicious") out.head = Math.sin(time * 0.9 + seed) * 35;
  // Weapon stance.
  if (ranged && ready) {
    out.armR = -86; out.armRSide = 0;
    if (two) { out.armL = -78; out.armLSide = 0; out.armLYaw = 26; }
  } else if (!ranged && ready) {
    out.armR = -38 + swing * 0.2; out.wrist = 25;
  } else if (!ranged) out.armR = Math.min(out.armR, -12);
  // CorpSec melee and shield-bearers carry a shield up front; choir wardens hold their lantern out.
  const sil = factionStyle(e.faction).silhouette, form = viewForm(e);
  if ((sil === "armoured" && !ranged) || form === "shield") { out.armL = ready ? -62 : -34; out.armLSide = 0; out.armLYaw = 18; }
  else if (e.look.prop === "lantern" && !two) { out.armL = -48 + Math.sin(time * 1.2 + seed) * 3; out.armLSide = 2; }
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
  // Rushers prowl low with the knife forward; the lunge crouches deep (the telegraph), then springs.
  if (form === "rusher") {
    // (sink is y-down: positive lowers the body into a crouch.)
    if (ready && phase.stage === "none") { out.lean += 10; out.sink += 0.06; out.armR = -52; out.wrist = 30; }
    if (e.attackKind === "lunge" && phase.stage !== "none") {
      const k = phase.k;
      if (phase.stage === "windup") {
        const w = smooth(0, 1, k);
        out.lean = 26 * w; out.sink = 0.2 * w; out.legL = 38 * w; out.legR = -24 * w; out.armR = 30 * w - 40 * (1 - w); out.armL = -40 * w; out.twist = -12 * w;
      } else if (phase.stage === "strike") {
        out.lean = 30; out.sink = 0.12; out.legL = -34; out.legR = 30; out.armR = -96; out.wrist = 10; out.armL = 24; out.twist = 14;
      } else {
        const r = smooth(0, 1, k);
        out.lean = 30 * (1 - r) + 8 * r; out.sink = 0.12 * (1 - r); out.armR = -96 * (1 - r) - 52 * r; out.legL = -34 * (1 - r); out.legR = 30 * (1 - r);
      }
    }
  }
  // Bruisers drop the head and stamp before a rush (stamp ~1.3 Hz, a step not a shake; squared so
  // the foot eases off and back onto the ground), then run shoulder-first with the gun tucked.
  if (form === "bruiser" && e.attackKind === "rush" && phase.stage !== "none") {
    const k = phase.stage === "windup" ? smooth(0, 1, phase.k) : phase.stage === "strike" ? 1 : 1 - smooth(0, 1, phase.k);
    out.lean = Math.max(out.lean, 26 * k); out.head = 0; out.armR = -40 * k - 86 * (1 - k); out.armL = -30 * k; out.armLYaw = 0; out.twist = -18 * k;
    if (phase.stage === "windup") { const lift = Math.max(0, Math.sin(time * 8.2)), stamp = lift * lift * 14 * k; out.legL = stamp; out.legR = -4 * k; }
  }
  if (e.state === "stagger") {
    // Reeling: thrown back, arms out, a slow wobble and the head lolling (1 Hz - not a shake).
    out.lean = -16 + Math.sin(time * 6.3 + seed) * 3; out.armRSide = 32; out.armLSide = 32; out.armLYaw = 0; out.armR = -50; out.armL = -40;
    out.head = Math.sin(time * 4.4 + seed) * 14; out.twist = Math.sin(time * 3.1 + seed) * 6;
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
  if (viewForm(e) === "drone") { drawDrone(t, e, style, phase, time, distance, toViewer); return; }
  const scale = (e.scale ?? 1) * (style.silhouette === "tall" ? 1.1 : 1);
  const detail = distance < DETAIL_RANGE;
  const dying = e.deathAge >= 0;
  const flash = dying ? 0 : hitFlash(e.hitAge);
  // Faction colours with a touch of the archetype's own look for variety within a gang.
  const body = mix(style.body, e.look.coat, 0.18), trim = mix(style.trim, e.look.trim, 0.15);
  t.push(); t.translate(e.x, 0, e.z); t.rotateY(-e.yaw * DEG);

  if (dying) {
    // De-rasterise: first the figure buckles backwards, its cells thin out through the ramp and it
    // fades to nothing by DEATH_COLLAPSE (deathBodyGain)...
    if (e.deathAge < DEATH_COLLAPSE) {
      const k = smooth(0, 1, e.deathAge / DEATH_COLLAPSE);
      setPaintMods(0, 0, deathBodyGain(e.deathAge), RAMP[Math.min(RAMP.length - 1, 2 + Math.floor(k * 4))]);
      t.push(); t.scale(scale); t.translate(0, 0, 0.2 * k); t.rotateX(-68 * k); t.scale(1, 1 - 0.3 * k, 1);
      const p = enemyPose(e, motion, NO_ATTACK, time);
      settlePose(e.id, p, POSE_KEYS, time); // the pose it died in eases out instead of popping
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
  if (e.boss) drawAura(t, e, style, scale, time);
  // Rim light at range: a faint emissive shell just behind the figure (relative to the viewer) and a
  // touch larger, so a lit outline in the faction colour separates it from the street from ~15 m
  // out. Sized to about one cell at its distance; absent up close where the seams do the job.
  const far = smooth(12, 40, distance);
  if (far > 0.02 && e.hostile) {
    const pad = distance * 0.012, back = toViewer - e.yaw;
    t.push(); t.rotateY(-back * DEG); t.translate(0, 0, pad * 1.6); t.rotateY(back * DEG);
    paint(t, glowOf(style.light), ":", 0.45 + 0.5 * far);
    blob(t, 0, 1.45 * scale, 0, 0.5 * scale + pad, 0.72 * scale + pad, 0.36 * scale + pad);
    blob(t, 0, 2.3 * scale, 0, 0.27 * scale + pad, 0.33 * scale + pad, 0.27 * scale + pad);
    box(t, 0, 0.5 * scale, 0, 0.62 * scale + pad * 2, 1.0 * scale + pad, 0.3 * scale + pad);
    t.pop();
  }

  // The pose eases from last frame's (stance switches, stagger, strike snaps never step); heat rides
  // with it so a cancelled attack cools instead of switching off.
  const figurePose = enemyPose(e, motion, phase, time);
  settlePose(e.id, figurePose, POSE_KEYS, time);
  // Far figures are lifted a little (fog and distance would sink their dark coats into the street).
  setPaintMods(flash, figurePose.heat, 1 + 0.5 * far);
  t.push(); t.scale(scale);
  if (figurePose.sink) t.translate(0, figurePose.sink, 0);
  drawFigure(t, e, style, body, trim, figurePose, detail, time, far);
  t.pop();
  clearPaintMods();

  // Overhead markers face the viewer: the telegraph "!" (pops in eased, then heats steadily toward
  // the strike - no oscillation) or the vulnerable star. They grow with distance so they never
  // shrink under ~2 cells.
  const top = 3.05 * scale + 0.25;
  if (phase.stage === "windup" || e.windup) {
    const k = phase.stage === "windup" ? phase.k : Math.max(0, Math.min(1, e.attack));
    const size = Math.max(1, Math.min(6, distance / 18)) * (e.boss ? 1.4 : 1) * telegraphScale(k);
    t.push(); t.translate(0, -top, 0); t.rotateY(-(toViewer - e.yaw) * DEG); t.scale(size);
    paint(t, WARN, "!", telegraphGlow(k));
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
function drawAura(t: PropCanvas, e: EnemyView, style: FactionStyle, scale: number, time: number): void {
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
  if (style.silhouette === "robed") {
    // The Choirmaster's voice: "~" sound rings leave the crown and widen as they rise (one every
    // ~2.5 s, two in flight, fading out - a slow swell, never a blink).
    for (let i = 0; i < 2; i++) {
      const u = (time * 0.4 + i * 0.5 + hashString(e.id)) % 1;
      paint(t, light, u < 0.6 ? "~" : "-", 0.95 * (1 - u));
      ring(t, 0, (2.75 + u * 1.3) * scale, 0, (0.3 + u * 0.9) * scale, (0.04 - u * 0.02) * scale);
    }
  }
}

/** The figure in its unit frame (1.0 = resident size; the caller applies scale). */
function drawFigure(t: PropCanvas, e: EnemyView, style: FactionStyle, body: Rgb, trim: Rgb, p: Pose, detail: boolean, time: number, far = 0): void {
  const sil = style.silhouette;
  const light = glowOf(style.light);
  const torsoW = sil === "spiked" ? 0.5 : sil === "hooded" ? 0.38 : sil === "armoured" ? 0.47 : sil === "robed" ? 0.4 : 0.43;
  // Accent strokes thicken with distance so they stay at least a cell wide (readable at 30 m).
  const thick = 1 + 3 * far;
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
    if (sil === "hooded" && detail) {
      // Tattered hem and a cape off the shoulders: the cloak reads wider than the body.
      paint(t, style.trim, "v"); for (let k = -2; k <= 2; k++) box(t, k * 0.16, 0.2 + (k & 1) * 0.06, 0.02, 0.12, 0.12, 0.5);
      paint(t, body, "%"); box(t, 0, 1.55, 0.2, 0.86, 0.95, 0.08);
    }
  }
  if (sil === "robed") {
    // Floor-length robe flaring at the hem, a lit sash down the front and a brass cincture.
    paint(t, body, "|"); box(t, 0, 0.62, 0.02, 0.86, 1.24, 0.6);
    paint(t, trim, "="); box(t, 0, 0.06, 0.02, 0.98, 0.12, 0.7);
    paint(t, light, "!", 0.8); box(t, 0, 1.0, -0.33, 0.1 * thick, 1.5, 0.04);
    paint(t, style.detail, "=", 0.9); box(t, 0, 1.08, 0, torsoW * 2 + 0.06, 0.08, 0.66);
  }
  // Lit seams down the flanks: the faction's rim light that separates the figure from the street.
  paint(t, light, "|", sil === "hooded" ? 0.55 + 0.25 * far : 0.75 + 0.2 * far);
  for (let side = -1; side <= 1; side += 2) box(t, side * (torsoW - 0.05), 1.45, -0.18, 0.05 * thick, 0.62, 0.05 * thick);
  if (sil === "hooded") drawGlitch(t, e, light, torsoW, time);
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
    paint(t, light, "+", 0.85); box(t, 0, 1.62, -0.3, 0.06 * thick, 0.34, 0.04); box(t, 0, 1.68, -0.3, 0.22, 0.06 * thick, 0.04);
  } else if (sil === "robed") {
    // High collar: a lit ring standing round the neck.
    paint(t, light, "o", 0.9); ring(t, 0, 2.02, 0, 0.2, 0.035 * thick);
  }
  drawArms(t, e, style, body, trim, p, detail);
  drawHead(t, e, style, body, p, detail, time, thick);
  drawFormAccents(t, e, style, trim, detail, time, thick);
  t.pop();
}

/** Form silhouettes on top of the faction body: a rusher's long lit scarf tails (they stream
 * behind it), a bruiser's slab shoulders and shell bandolier. */
function drawFormAccents(t: PropCanvas, e: EnemyView, style: FactionStyle, trim: Rgb, detail: boolean, time: number, thick: number): void {
  const form = viewForm(e), light = glowOf(style.light);
  if (form === "rusher") {
    const sway = Math.sin(time * 4.4 + hashString(e.id) * 6.28) * 6; // ~0.7 Hz
    paint(t, light, "~", 0.85);
    for (let side = -1; side <= 1; side += 2) {
      t.push(); t.translate(side * 0.1, -2.02, 0.26); t.rotateX(32 + sway * side); t.rotateZ(side * 8);
      box(t, 0, -0.32, 0, 0.09 * thick, 0.64, 0.05); t.pop();
    }
  } else if (form === "bruiser") {
    paint(t, trim, "#");
    for (let side = -1; side <= 1; side += 2) box(t, side * 0.64, 1.98, 0, 0.46, 0.3, 0.56);
    if (detail) {
      paint(t, light, "o", 0.8);
      for (let k = 0; k < 5; k++) box(t, -0.3 + k * 0.15, 1.2 + k * 0.14, -0.33, 0.09, 0.09, 0.04);
    }
  }
}

/** A scrap drone: a flat hull hovering at ~2.4 m with four rotor rings, a single lit eye that swells
 * through the shot wind-up (the telegraph), a hanging arc emitter and a soft glow on the ground under
 * it. It bobs slowly (0.2 Hz). Dying, it drops, tilts and comes apart through the same particle
 * dissolve as everyone else. */
function drawDrone(t: PropCanvas, e: EnemyView, style: FactionStyle, phase: AttackPhase, time: number, distance: number, toViewer: number): void {
  const scale = e.scale ?? 1, seed = hashString(e.id) * 6.28, light = glowOf(style.light);
  const metal = mix(style.body, e.look.coat, 0.4), dark = mix(style.trim, [20, 20, 24], 0.4);
  const far = smooth(12, 40, distance), detail = distance < DETAIL_RANGE;
  const dying = e.deathAge >= 0;
  // Heat eases (a cancelled shot cools rather than switching off); while it is up the 0.2 Hz bob
  // calms so the drone visibly steadies to aim.
  droneLook.heat = attackHeat(phase);
  settlePose(e.id, droneLook, DRONE_KEYS, time);
  const heat = droneLook.heat;
  const hover = 2.4 * scale + Math.sin(time * 1.3 + seed) * 0.07 * (1 - 0.6 * heat);
  t.push(); t.translate(e.x, 0, e.z); t.rotateY(-e.yaw * DEG);
  if (dying) {
    if (e.deathAge < DEATH_COLLAPSE) {
      const k = smooth(0, 1, e.deathAge / DEATH_COLLAPSE);
      setPaintMods(0, 0, deathBodyGain(e.deathAge), RAMP[Math.min(RAMP.length - 1, 2 + Math.floor(k * 4))]);
      t.push(); t.translate(0, -hover * (1 - k) - 0.3 * k, 0); t.rotateZ(40 * k); t.rotateX(-25 * k);
      paint(t, metal, "="); blob(t, 0, 0, 0, 0.62 * scale, 0.16 * scale, 0.5 * scale);
      t.pop();
    }
    clearPaintMods();
    const cells = deathParticles(e.id, e.deathAge, scale * 0.8, detail ? 24 : 10, particles);
    const cellSize = Math.max(0.08, distance * 0.014);
    for (const q of cells) {
      paint(t, mix(light, metal, 0.5 + 0.5 * (1 - q.fade)), q.glyph, 0.35 + q.fade * 0.75);
      const s = Math.max(cellSize, q.size * scale);
      box(t, q.x, q.y, q.z, s, s, s);
    }
    t.pop();
    return;
  }
  const windup = phase.stage === "windup" || !!e.windup;
  // Ground: the faction ring (hostile) and the hull's glow pooled beneath it.
  if (e.hostile) {
    const alert = e.state === "alert" || e.state === "chase" || e.state === "attack" || e.state === "reposition";
    paint(t, light, "-", alert ? 0.9 : 0.55); ring(t, 0, 0.04, 0, 0.75 * scale, 0.03 * scale);
  }
  paint(t, light, ".", 0.35 + 0.2 * heat); blob(t, 0, 0.02, 0, 0.55 * scale, 0.01, 0.55 * scale);
  setPaintMods(e.deathAge >= 0 ? 0 : hitFlash(e.hitAge), heat, 1 + 0.5 * far);
  t.push(); t.translate(0, -hover, 0); t.scale(scale);
  // Hull, armour plates and the four rotor arms with spinning rings (slow: the ring turns, it
  // doesn't flicker).
  paint(t, metal, "="); blob(t, 0, 0, 0, 0.55, 0.15, 0.45);
  paint(t, dark, "#"); box(t, 0, 0.12, 0, 0.5, 0.08, 0.38);
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * Math.PI / 2, ax = Math.cos(a) * 0.62, az = Math.sin(a) * 0.52;
    paint(t, dark, "-"); box(t, ax * 0.55, 0.04, az * 0.55, 0.36, 0.05, 0.08);
    t.push(); t.translate(ax, -0.1, az); t.rotateY(time * 140 + i * 45);
    paint(t, metal, "+", 0.9); ring(t, 0, 0, 0, 0.26, 0.025);
    if (detail) { paint(t, light, "-", 0.55); box(t, 0, 0, 0, 0.44, 0.015, 0.04); }
    t.pop();
  }
  // The eye: forward (-z), swelling and heating through the wind-up.
  const eye = 0.13 + 0.07 * heat;
  paint(t, light, "O", 0.75 + 0.3 * heat); blob(t, 0, -0.02, -0.44, eye, eye, eye * 0.7);
  // Arc emitter hanging under the nose.
  paint(t, dark, "|"); box(t, 0, -0.2, -0.3, 0.05, 0.22, 0.05);
  paint(t, light, "*", 0.5 + 0.5 * heat); box(t, 0, -0.33, -0.3, 0.07, 0.07, 0.07);
  t.pop();
  clearPaintMods();
  // Overhead telegraph "!" / vulnerable star, like the walking figures.
  const top = hover + 0.7 * scale;
  if (windup) {
    const k = phase.stage === "windup" ? phase.k : Math.max(0, Math.min(1, e.attack));
    const size = Math.max(1, Math.min(6, distance / 18)) * telegraphScale(k);
    t.push(); t.translate(0, -top, 0); t.rotateY(-(toViewer - e.yaw) * DEG); t.scale(size);
    paint(t, WARN, "!", telegraphGlow(k));
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

/** Ghost glitch: every ~3 s a slice of the figure slips sideways and slides back over a third of a
 * second (a smooth envelope; 0.3 Hz, never a strobe). */
function drawGlitch(t: PropCanvas, e: EnemyView, light: Rgb, torsoW: number, time: number): void {
  const seed = hashString(e.id);
  const u = (time * 0.3 + seed) % 1;
  if (u > 0.11) return;
  const k = Math.sin((u / 0.11) * Math.PI), h = 0.7 + ((Math.floor(time * 0.3 + seed) * 0.37) % 1) * 1.3;
  paint(t, light, "=", 0.35 + 0.4 * k);
  box(t, (seed > 0.5 ? 1 : -1) * 0.22 * k, h, -0.05, torsoW * 2.1, 0.09, 0.5);
}

function drawArms(t: PropCanvas, e: EnemyView, style: FactionStyle, body: Rgb, trim: Rgb, p: Pose, detail: boolean): void {
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
      weapon.charge = p.charge;
      drawWeaponModel(t, e.weaponClass, weapon);
      t.pop();
    } else if (viewForm(e) === "shield") {
      // Shield-bearer: a bigger slab (car door, hatch, riot wall) held upright in front, with a
      // lit rim so its edge reads at range. When the guard is open (vulnerable) it hangs low; p.guard
      // eases it down and back up instead of dropping it in one frame.
      const open = p.guard;
      t.push(); t.translate(0, 0.95, 0); t.rotateX(-p.armL + 55 * open); t.rotateZ(side * p.armLSide); if (p.armLYaw) t.rotateY(-side * p.armLYaw);
      paint(t, mix(style.detail, style.trim, 0.35), style.silhouette === "armoured" ? "#" : "H"); box(t, 0.06, 0.1, -0.16, 0.86, 1.42, 0.07);
      paint(t, glowOf(style.light), "=", 0.9 - 0.45 * open);
      box(t, 0.06, 0.83, -0.2, 0.86, 0.05, 0.03); box(t, 0.06, -0.63, -0.2, 0.86, 0.05, 0.03);
      box(t, 0.48, 0.1, -0.2, 0.05, 1.42, 0.03); box(t, -0.36, 0.1, -0.2, 0.05, 1.42, 0.03);
      paint(t, [20, 22, 26], "o"); box(t, 0.06, 0.45, -0.21, 0.3, 0.16, 0.02);
      t.pop();
    } else if (style.silhouette === "armoured" && !isRanged(e.weaponClass)) {
      // Riot shield, held upright in front whatever the arm is doing; a lit vision slit on top.
      t.push(); t.translate(0, 0.95, 0); t.rotateX(-p.armL); t.rotateZ(side * p.armLSide); if (p.armLYaw) t.rotateY(-side * p.armLYaw);
      paint(t, style.detail, "#"); box(t, 0.04, 0.12, -0.14, 0.66, 1.12, 0.05);
      paint(t, glowOf(style.light), "=", 0.85); box(t, 0.04, 0.5, -0.17, 0.5, 0.06, 0.03);
      paint(t, style.trim, "|"); box(t, 0.37, 0.12, -0.15, 0.04, 1.12, 0.06); box(t, -0.29, 0.12, -0.15, 0.04, 1.12, 0.06);
      t.pop();
    } else if (e.look.prop === "lantern") {
      // The choir warden's lantern, hanging from the off hand (always lit).
      t.push(); t.translate(0, 0.95, 0); t.rotateX(-p.armL);
      paint(t, style.detail, "-"); box(t, 0, -0.16, -0.06, 0.02, 0.14, 0.02);
      paint(t, glowOf(style.light), "*", 0.95); box(t, 0, -0.32, -0.06, 0.16, 0.2, 0.16);
      t.pop();
    }
    t.pop();
  }
}

function drawHead(t: PropCanvas, e: EnemyView, style: FactionStyle, body: Rgb, p: Pose, detail: boolean, time: number, thick = 1): void {
  const light = glowOf(style.light);
  t.push(); t.translate(0, -2.28, -0.03); t.rotateY(p.head);
  switch (style.silhouette) {
    case "robed":
      if (e.look.headwear === "hood") {
        // Warden: a pale peaked hood, the face a dark slot with a lit chant-line across it.
        paint(t, [24, 28, 30], "."); blob(t, 0, 0, 0, 0.22, 0.28, 0.23);
        paint(t, body, "^"); blob(t, 0, 0.08, 0.05, 0.31, 0.42, 0.32);
        box(t, 0, 0.42, 0.06, 0.12, 0.2, 0.12);
        paint(t, light, "-", 1); box(t, 0, 0.0, -0.28, 0.2 * Math.min(1.6, thick), 0.045 * thick, 0.03);
      } else {
        // Cantor / Choirmaster: bare head, lit mouth-grille, a brass tuning-fork crown.
        paint(t, mix(e.look.skin, [150, 156, 160], 0.4), "O"); blob(t, 0, 0, 0, 0.24, 0.3, 0.25);
        paint(t, light, "=", 1); box(t, 0, -0.12, -0.23, 0.18, 0.05 * thick, 0.04);
        paint(t, style.detail, "|", 1);
        for (let k = -1; k <= 1; k++) box(t, k * 0.12, 0.42 + (k === 0 ? 0.08 : 0), 0, 0.035 * thick, k === 0 ? 0.36 : 0.22, 0.035 * thick);
        paint(t, light, "o", 1);
        for (let k = -1; k <= 1; k++) box(t, k * 0.12, 0.6 + (k === 0 ? 0.15 : 0), 0, 0.06 * thick, 0.06 * thick, 0.06 * thick);
      }
      break;
    case "hooded":
      paint(t, style.detail, "."); blob(t, 0, 0, 0, 0.23, 0.3, 0.24);
      paint(t, body, "%"); blob(t, 0, 0.06, 0.06, 0.32, 0.4, 0.33);
      // Two cyan eyes in the dark of the hood - the one thing you see first.
      paint(t, light, "o", 1);
      for (let side = -1; side <= 1; side += 2) box(t, side * 0.085 * Math.min(1.5, thick), 0.02, -0.285, 0.07 * thick, 0.045 * thick, 0.03);
      break;
    case "armoured":
      paint(t, style.trim, "#"); blob(t, 0, 0.02, 0, 0.29, 0.34, 0.3);
      paint(t, light, "=", 1); box(t, 0, 0.02, -0.24, 0.44, 0.1 * thick, 0.08);
      // Riot helmet: a ridge crest and a jaw guard - a heavier, rounder head than anyone's.
      paint(t, style.trim, "#"); box(t, 0, 0.3, 0.0, 0.08, 0.08, 0.52); box(t, 0, -0.2, -0.16, 0.4, 0.12, 0.16);
      if (detail) { paint(t, style.detail, "|"); box(t, 0.24, 0.3, 0.05, 0.03, 0.26, 0.03); }
      break;
    case "tall":
      paint(t, [150, 156, 166], "O"); blob(t, 0, 0, 0, 0.24, 0.31, 0.25);
      paint(t, style.detail, "=", 1); box(t, 0, 0.03, -0.2, 0.46, 0.08, 0.12);
      // Halo: a lit ring floating over the head, turning slowly.
      t.push(); t.translate(0, -0.55, 0.05); t.rotateY(time * 25); t.rotateX(24);
      paint(t, light, "o", 1); t.torus(0.34, 0.03 * thick);
      t.pop();
      break;
    case "spiked":
      paint(t, [150, 118, 96], "O"); blob(t, 0, 0, 0, 0.25, 0.31, 0.25);
      paint(t, light, "^", 1); box(t, 0, 0.36, 0.02, 0.07 * thick, 0.2 * Math.min(1.6, thick), 0.44);
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
