// The first-person weapon: drawn in world space in a frame attached to the camera (like the car
// cockpit in driving-scene.ts), lower right of the view, with the shared ASCII weapon models.
// Motion comfort first: idle sway is a couple of millimetres, there is no walk bob and nothing the
// camera does; all feedback is the weapon's own motion (swings, recoil, flinch) and small lights.
//
// Camera frame: x right, y up (helpers flip to textmode's y-down), z backwards (forward = -z).
// A pose is the grip position plus pitch-up / yaw-left / roll of the weapon (degrees).
import type { Textmodifier } from "textmode.js";
import type { PropCanvas } from "../../city/prop-canvas.ts";
import type { ItemDefinition, PlayerCombatView } from "../types.ts";
import { DEG, RARITY_COLOR, box, clamp01, glowOf, lerp, paint, paintRange, restorePaintRange, segment, smooth, type Rgb } from "./palette.ts";
import { WEAPON_TIP, defaultWeaponPaint, drawWeaponModel, isRanged, type WeaponModel } from "./weapons.ts";

export interface ViewmodelCamera { x: number; y: number; z: number; yaw: number; pitch: number }
/** Grip pose in the camera frame. */
export interface Pose { x: number; y: number; z: number; pitchUp: number; yawLeft: number; roll: number }
/** Everything the draw needs for one frame (exported for tests). */
export interface ViewmodelState {
  model: WeaponModel;
  right: Pose;
  /** The off hand (fists, or the support hand on a long gun); null = out of view. */
  left: Pose | null;
  /** Magazine drop for the reload (m); -1 = out. */
  mag: number;
  /** 0..1 muzzle flash strength. */
  flash: number;
  /** 0..1 energy of lit parts (swinging, charging). */
  charge: number;
}

type Key = readonly [number, number, number, number, number, number];
/** First-person model scale per weapon model (1 = life-size). */
const VIEW_SCALE: Partial<Record<string, number>> = { blade: 0.32, blunt: 0.42, baton: 0.5, pistol: 0.8, smg: 0.72, shotgun: 0.66, rifle: 0.62 };
const P = (k: Key): Pose => ({ x: k[0], y: k[1], z: k[2], pitchUp: k[3], yawLeft: k[4], roll: k[5] });
// Melee keyframes (blade along -z from the grip).
const MELEE_IDLE: Key = [0.34, -0.3, -0.5, 22, 8, 10];
const MELEE_BLOCK: Key = [0.1, -0.13, -0.46, 8, 82, 84];
const LIGHT: readonly (readonly [Key, Key])[] = [
  [[0.36, -0.12, -0.45, 18, -38, 72], [-0.3, -0.26, -0.6, 4, 72, 82]],     // right-to-left slash
  [[-0.14, -0.14, -0.45, 18, 62, -62], [0.46, -0.3, -0.56, 0, -52, -82]], // backhand, left-to-right
  [[0.18, 0.04, -0.38, 96, 10, 0], [0.05, -0.36, -0.62, -36, 6, 0]],      // overhead chop
];
const HEAVY: readonly [Key, Key] = [[0.36, 0.02, -0.42, 70, -10, 35], [-0.26, -0.36, -0.62, -30, 52, 60]];
// Fists (right, left).
const FIST_IDLE: readonly [Key, Key] = [[0.25, -0.27, -0.46, 0, 0, 0], [-0.25, -0.27, -0.46, 0, 0, 0]];
const FIST_BLOCK: readonly [Key, Key] = [[0.1, -0.08, -0.36, 0, 0, -8], [-0.1, -0.08, -0.36, 0, 0, 8]];
const JABS: readonly Key[] = [[0.07, -0.12, -0.68, 0, 0, 0], [-0.06, -0.12, -0.68, 0, 0, 0], [0.05, -0.04, -0.56, 30, 0, 0]];
// Guns: hip pose and aim-down-sights grip heights (so the sight sits on the screen centre).
const HIP: Record<string, Key> = {
  pistol: [0.22, -0.2, -0.46, 0, 3, 0], smg: [0.2, -0.21, -0.5, 0, 3, 0],
  shotgun: [0.2, -0.23, -0.56, 0, 3, 0], rifle: [0.2, -0.23, -0.58, 0, 3, 0],
};
const SIGHT: Record<string, number> = { pistol: 0.087, smg: 0.095, shotgun: 0.088, rifle: 0.122 };

const blendPose = (a: Pose, b: Pose, k: number, out: Pose): Pose => {
  out.x = lerp(a.x, b.x, k); out.y = lerp(a.y, b.y, k); out.z = lerp(a.z, b.z, k);
  out.pitchUp = lerp(a.pitchUp, b.pitchUp, k); out.yawLeft = lerp(a.yawLeft, b.yawLeft, k); out.roll = lerp(a.roll, b.roll, k);
  return out;
};
const copyPose = (a: Pose, out: Pose): Pose => blendPose(a, a, 0, out);
const keyBlend = (a: Key, b: Key, k: number, out: Pose): Pose => {
  out.x = lerp(a[0], b[0], k); out.y = lerp(a[1], b[1], k); out.z = lerp(a[2], b[2], k);
  out.pitchUp = lerp(a[3], b[3], k); out.yawLeft = lerp(a[4], b[4], k); out.roll = lerp(a[5], b[5], k);
  return out;
};
const easeOut = (k: number): number => 1 - Math.pow(1 - clamp01(k), 3);

// Transition state: when the action changes, blend from what was on screen over 0.1 s so poses
// never pop; the swing timings themselves stay exact.
const memo = { action: "", item: "" as string | null, changed: -1, switched: -1e9, lastTime: 0, combo: 0, lightStart: -1 };
const shown = { right: P(MELEE_IDLE), left: P(FIST_IDLE[1]) };
const from = { right: P(MELEE_IDLE), left: P(FIST_IDLE[1]) };
const target = { right: P(MELEE_IDLE), left: P(FIST_IDLE[1]) };
const state: ViewmodelState = { model: "fists", right: shown.right, left: shown.left, mag: 0, flash: 0, charge: 0 };
const BLEND = 0.1, SWITCH = 0.3;

/** Resets the transition memory (tests, respawn). */
export function resetViewmodel(): void { memo.action = ""; memo.item = ""; memo.changed = -1; memo.switched = -1e9; memo.combo = 0; memo.lightStart = -1; }

/** Pose of the first-person weapon this frame (pure apart from the transition memory). */
export function viewmodelState(combat: PlayerCombatView, weapon: ItemDefinition | null, time: number): ViewmodelState {
  const model: WeaponModel = combat.weaponClass === "fists" ? "fists" : weapon?.weapon?.class ?? combat.weaponClass;
  const p = clamp01(combat.actionProgress);
  // Combo step: from the combat view, else counted from consecutive light attacks.
  if (combat.action === "light" && memo.action !== "light") {
    memo.combo = time - memo.lightStart < 1.1 ? (memo.combo + 1) % 3 : 0;
    memo.lightStart = time;
  } else if (combat.action === "light") memo.lightStart = time;
  const combo = Math.max(0, Math.min(2, Math.floor(combat.combo ?? memo.combo)));
  if (combat.weaponItem !== memo.item) { if (memo.item !== "") memo.switched = time; memo.item = combat.weaponItem; }
  if (combat.action !== memo.action) {
    copyPose(shown.right, from.right); copyPose(shown.left, from.left);
    memo.changed = memo.action === "" ? -1 : time; memo.action = combat.action;
  }
  state.model = model; state.mag = 0; state.flash = 0; state.charge = 0;
  const R = target.right, L = target.left;
  let left = model === "fists";
  const ranged = isRanged(model);

  if (model === "fists") {
    keyBlend(FIST_IDLE[0], FIST_IDLE[0], 0, R); keyBlend(FIST_IDLE[1], FIST_IDLE[1], 0, L);
    if (combat.action === "light") {
      // Jab / cross / uppercut: out fast, back slower.
      const out = p < 0.35 ? easeOut(p / 0.35) : 1 - smooth(0.35, 1, p);
      if (combo === 1) keyBlend(FIST_IDLE[1], JABS[1], out, L);
      else keyBlend(FIST_IDLE[0], JABS[combo], out, R);
    } else if (combat.action === "heavy" || (combat.charge ?? 0) > 0) {
      const wind = Math.max(combat.charge ?? 0, p < 0.5 ? p / 0.5 : 1);
      const hit = combat.action === "heavy" && p >= 0.5 ? (p < 0.7 ? easeOut((p - 0.5) / 0.2) : 1 - smooth(0.7, 1, p)) : 0;
      keyBlend(FIST_IDLE[0], [0.42, -0.15, -0.3, 0, 0, -20], smooth(0, 1, wind) * (1 - hit), R);
      if (hit > 0) keyBlend([0.42, -0.15, -0.3, 0, 0, -20], [-0.02, -0.1, -0.7, 0, 0, 0], hit, R);
    } else if (combat.action === "block" || combat.blocking) {
      keyBlend(FIST_BLOCK[0], FIST_BLOCK[0], 0, R); keyBlend(FIST_BLOCK[1], FIST_BLOCK[1], 0, L);
    }
  } else if (!ranged) {
    keyBlend(MELEE_IDLE, MELEE_IDLE, 0, R);
    if (combat.action === "light") {
      const [a, b] = LIGHT[combo];
      if (p < 0.2) keyBlend(MELEE_IDLE, a, smooth(0, 1, p / 0.2), R);
      else if (p < 0.5) keyBlend(a, b, easeOut((p - 0.2) / 0.3), R);
      else keyBlend(b, MELEE_IDLE, smooth(0.5, 1, p), R);
      state.charge = p > 0.15 && p < 0.6 ? 1 : 0.3;
    } else if (combat.action === "heavy" || (combat.charge ?? 0) > 0) {
      const wind = Math.max(combat.charge ?? 0, combat.action === "heavy" ? Math.min(1, p / 0.5) : 0);
      if (combat.action === "heavy" && p >= 0.5) {
        if (p < 0.72) keyBlend(HEAVY[0], HEAVY[1], easeOut((p - 0.5) / 0.22), R);
        else keyBlend(HEAVY[1], MELEE_IDLE, smooth(0.72, 1, p), R);
      } else keyBlend(MELEE_IDLE, HEAVY[0], smooth(0, 1, wind), R);
      state.charge = 0.4 + 0.6 * wind;
    } else if (combat.action === "block" || combat.blocking) keyBlend(MELEE_BLOCK, MELEE_BLOCK, 0, R);
  } else {
    const hip = HIP[model] ?? HIP.pistol;
    keyBlend(hip, hip, 0, R);
    const aim = clamp01(combat.aim ?? (combat.action === "aim" ? 1 : 0));
    if (aim > 0) keyBlend(hip, [0, -(SIGHT[model] ?? 0.09) * (VIEW_SCALE[model] ?? 0.7) - 0.004, hip[2] + 0.06, 0, 0, 0], smooth(0, 1, aim), R); // sight on the crosshair at view scale
    left = model !== "pistol" || aim > 0.5;
    if (combat.action === "fire") {
      // Recoil: the weapon kicks back and its muzzle rises, then settles (no camera kick).
      const kick = Math.pow(1 - p, 3);
      R.z += 0.045 * kick; R.pitchUp += 7 * kick; R.y += 0.01 * kick;
      const auto = (weapon?.weapon?.automatic ?? 0) > 0;
      // Automatic fire holds one steady flash instead of strobing per round.
      state.flash = auto ? 0.85 + 0.15 * (1 - p) : p < 0.3 ? 1 - p / 0.3 : 0;
    } else if (combat.action === "reload") {
      const tilt = smooth(0, 0.2, p) * (1 - smooth(0.8, 1, p));
      R.y -= 0.07 * tilt; R.roll += 32 * tilt; R.pitchUp += 12 * tilt; R.x -= 0.03 * tilt;
      state.mag = p < 0.1 ? 0 : p < 0.42 ? smooth(0.1, 0.42, p) * 0.35 : p < 0.48 ? -1 : p < 0.78 ? 0.3 * (1 - smooth(0.48, 0.78, p)) : 0;
      left = true;
    }
  }
  if (!left) keyBlend(FIST_IDLE[1], FIST_IDLE[1], 0, L);
  // Support hand on long guns sits under the barrel, following the gun.
  if (ranged && left) { L.x = R.x - 0.06; L.y = R.y + 0.0; L.z = R.z - (model === "pistol" ? 0.02 : 0.24); L.pitchUp = R.pitchUp; L.yawLeft = R.yawLeft; L.roll = R.roll; }

  // Whole-rig modifiers.
  const dodge = combat.action === "dodge" ? Math.sin(Math.PI * p) : 0;
  const hurt = combat.hurtAge < 0.3 ? 1 - combat.hurtAge / 0.3 : 0;
  const lower = (combat.dead || combat.action === "dead" ? 0.55 : 0) + (1 - smooth(0, SWITCH, time - memo.switched)) * 0.4;
  // Idle sway: two millimetres and a third of a degree, slow. Nothing more (comfort).
  const dy = -0.12 * dodge - 0.03 * hurt - lower + Math.sin(time * 1.4) * 0.002;
  const dPitch = -4 * hurt + Math.sin(time * 1.1) * 0.3, dRoll = 10 * dodge + 6 * hurt;
  R.y += dy; R.x += 0.04 * dodge; R.roll += dRoll; R.pitchUp += dPitch;
  L.y += dy; L.x += 0.04 * dodge; L.roll += dRoll; L.pitchUp += dPitch;
  const k = memo.changed < 0 ? 1 : smooth(0, BLEND, time - memo.changed);
  blendPose(from.right, R, k, shown.right);
  blendPose(from.left, L, k, shown.left);
  state.right = shown.right;
  state.left = left || model === "fists" ? shown.left : null;
  memo.lastTime = time;
  return state;
}

const JACKET: Rgb = [44, 50, 62], GLOVE: Rgb = [66, 56, 48], KNUCKLE: Rgb = [120, 104, 90];
const FLASH: Rgb = [255, 236, 170];
const paintOpts = defaultWeaponPaint();

/** Places the camera frame (textmode y down). */
function cameraFrame(t: PropCanvas, cam: ViewmodelCamera): void {
  t.translate(cam.x, -cam.y, cam.z); t.rotateY(-cam.yaw * DEG); t.rotateX(cam.pitch * DEG);
}
function poseFrame(t: PropCanvas, p: Pose): void {
  t.translate(p.x, -p.y, p.z); t.rotateY(p.yawLeft); t.rotateX(-p.pitchUp); t.rotateZ(p.roll);
}

/** Sleeve from off-screen (below and behind the grip) to the hand. */
function forearm(t: PropCanvas, hand: Pose, side: number): void {
  segment(t, hand.x + side * 0.1, hand.y - 0.34, hand.z + 0.3, hand.x + side * 0.01, hand.y - 0.03, hand.z + 0.05, 0.085);
}
function fist(t: PropCanvas, hand: Pose): void {
  t.push(); poseFrame(t, hand);
  paint(t, GLOVE, "#"); box(t, 0, 0, 0, 0.09, 0.085, 0.11);
  paint(t, KNUCKLE, "o"); box(t, 0, 0.012, -0.056, 0.085, 0.05, 0.012);
  t.pop();
}

/** Records the viewmodel into any PropCanvas (drawViewmodel passes the Textmodifier). */
export function recordViewmodel(t: PropCanvas, cam: ViewmodelCamera, combat: PlayerCombatView, weapon: ItemDefinition | null, time: number): ViewmodelState {
  const s = viewmodelState(combat, weapon, time);
  const outer = paintRange(0);
  t.push(); cameraFrame(t, cam);
  // Forearms reach from off-screen (below and behind the grip) to the hands.
  paint(t, JACKET, "|");
  forearm(t, s.right, 1);
  if (s.left) forearm(t, s.left, -1);
  if (s.model === "fists") {
    fist(t, s.right);
    if (s.left) fist(t, s.left);
  } else {
    const item = weapon?.weapon ? weapon : null;
    const rarity = item?.rarity ?? "common";
    paintOpts.metal = [150, 158, 168]; paintOpts.dark = [40, 44, 52];
    paintOpts.trim = rarity === "common" ? RARITY_COLOR.common : glowOf(RARITY_COLOR[rarity], 245);
    paintOpts.glyph = item?.glyph && /^[!-~]$/.test(item.glyph) ? item.glyph : "";
    paintOpts.mag = s.mag; paintOpts.detail = true; paintOpts.charge = s.charge;
    t.push(); poseFrame(t, s.right);
    // The models are life-size (enemies carry them); at arm's length, half a metre from the eye, a
    // 0.9 m blade would sweep half the screen, so the first-person copy is drawn smaller - the
    // weapon frames the view instead of blocking it.
    t.push(); t.scale(VIEW_SCALE[s.model] ?? 0.7);
    drawWeaponModel(t, s.model, paintOpts);
    t.pop();
    // Hand on the grip.
    paint(t, GLOVE, "#");
    if (isRanged(s.model)) box(t, 0, -0.035, 0.018, 0.06, 0.07, 0.065); else box(t, 0, 0, 0.04, 0.075, 0.075, 0.1);
    if (s.flash > 0 && isRanged(s.model)) {
      // Muzzle flash: a small bright "*" burst at the muzzle, localized - never a screen flash.
      const tip = WEAPON_TIP[s.model as keyof typeof WEAPON_TIP];
      const size = 0.035 + 0.03 * s.flash;
      paint(t, FLASH, "*", 0.7 + 0.3 * s.flash);
      box(t, tip[0], tip[1], tip[2] - size * 0.6, size, size, size * 1.4);
      paint(t, FLASH, "+", 0.6 * s.flash + 0.3);
      box(t, tip[0], tip[1], tip[2] - size * 0.6, size * 2.2, size * 0.25, size * 0.4);
      box(t, tip[0], tip[1], tip[2] - size * 0.6, size * 0.25, size * 2.2, size * 0.4);
    }
    t.pop();
    if (s.left && isRanged(s.model)) {
      t.push(); poseFrame(t, s.left);
      paint(t, GLOVE, "#"); box(t, 0, 0.0, 0, 0.07, 0.06, 0.09);
      t.pop();
    }
  }
  t.pop();
  restorePaintRange(outer);
  return s;
}

/** First-person weapon, main pass (after props, before VFX; u_surface 2). `cam` is the TRUE camera
 * (player yaw/pitch, eye height in metres, y up) so the weapon stays fixed on screen after the
 * view-warp re-projection. */
export function drawViewmodel(t: Textmodifier, cam: ViewmodelCamera, combat: PlayerCombatView, weapon: ItemDefinition | null, time: number): void {
  t.setUniform("u_surface", 2);
  recordViewmodel(t, cam, combat, weapon, time);
}
