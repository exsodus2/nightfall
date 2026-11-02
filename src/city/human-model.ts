import type { PropCanvas } from "./prop-canvas.ts";
import type { NpcLook } from "./npcs.ts";
import type { RGB } from "./world.ts";

export type HumanPaint = (canvas: PropCanvas, color: RGB, glyph: string, gain?: number) => void;
export interface HumanPose {
  time: number;
  seed: number;
  stride: number;
  moving: boolean;
  detail: boolean;
  talking?: boolean;
  phone?: boolean;
  longCoat?: boolean;
  seated?: boolean;
  distant?: boolean;
  /** Held arm poses for street roles: both hands on a crate or cart, strumming, a raised wrist
   *  screen, a cigarette, a placard pole, or a dog lead. Overrides the swing, phone and gesture. */
  arms?: HumanArms;
  /** Chrome right arm with a lit seam (street-level cyborg looks). */
  chrome?: boolean;
  /** Seated hip height (m, default 0.83: a bench). Lower seats (a crate, a step) bend the knees up. */
  seatHeight?: number;
  /** Forward lean of the upper body (degrees), and a head bowed forward (degrees). */
  lean?: number;
  headPitch?: number;
  /** Head turned away from the body's heading (radians, the engine's yaw sense): a glance. */
  glance?: number;
  /** How far the phone is raised, 0..1 (eased by the caller); overrides `phone`. Its screen lights
   *  the face (one glyph) once it is up. */
  phoneLift?: number;
  /** Eased 0..1 weights from the display layer (FigureMotions), each overriding its boolean:
   *  `gait` scales the stride (leg and arm swing, sway, knee) instead of `moving` popping it on and
   *  off; `talk` blends the gesturing arm in and the scanning head out instead of `talking`. */
  gait?: number;
  talk?: number;
  /** The continuous seat blend, 0 standing .. 1 seated (raised-cosine eased by the caller): hips
   *  sink with the feet kept on the floor, thighs swing forward, forearms settle on the lap and long
   *  coat tails fold over the thighs. Takes over from `seated`; `seatHeight` is the hip height at 1. */
  sit?: number;
  /** Extra thigh length (m) at full `sit`, so a deep bench seat's knees clear its front edge. */
  thigh?: number;
  /** How far the held `arms` pose is taken up, 0..1 (default 1): blends from the free arm. */
  hold?: number;
  /** How far the left hand has taken up its carried prop, 0..1 (default 1): an umbrella being
   *  raised as it opens. */
  propHold?: number;
}
export type HumanArms = "carry" | "push" | "strum" | "wrist" | "smoke" | "sign" | "lead" | "kite" | "feed" | "preach" | "dance";
const BOOTS: RGB = [41, 46, 54];
const CHROME: RGB = [150, 162, 176];
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
/** a at k = 0 and b at k = 1, exactly (so the end poses are bit-identical to the unblended ones). */
const mix = (a: number, b: number, k: number): number => a * (1 - k) + b * k;
/** Standing hip height, and the ankle height that keeps the feet planted while sitting down. */
const HIP = 1.19, ANKLE = HIP - 0.53 - 0.53;
/** Scratch colour for the phone-lit face glyph (painters copy the colour, never keep it). */
const FACE_GLOW: [number, number, number] = [0, 0, 0];

/** Upper-arm and forearm pitch (degrees, negative is forward and up) for a held pose. `side` is
 *  -1 for the left arm and +1 for the right. Smooth functions of time only: no snapping. */
export function heldArm(arms: HumanArms, side: number, time: number, seed: number): [number, number] {
  switch (arms) {
    case "carry": return [-32, -58];
    case "push": return [-26, -38];
    case "sign": return [-24, -86];
    case "lead": return side > 0 ? [-16, -22] : [-4, -9];
    case "kite": return side > 0 ? [-62 + Math.sin(time * 1.1 + seed) * 6, -38] : [-12, -20];
    case "strum": return side < 0 ? [-30, -72] : [-14 + Math.sin(time * 7 + seed) * 4, -52 + Math.sin(time * 7 + seed) * 9];
    case "wrist": return side < 0 ? [-22, -88] : [-18, -76];
    // Holding a morsel out to a cat: the right hand forward at chest height, drifting slowly.
    case "feed": return side > 0 ? [-58 + Math.sin(time * 0.9 + seed) * 5, -26] : [-4, -9];
    // A street preacher: right arm raised and slowly sweeping (0.13 Hz), a book held at the chest.
    case "preach": return side > 0 ? [-138 + Math.sin(time * 0.8 + seed) * 14, -22] : [-26, -80];
    // Dancing: both arms up and swaying out of step at 0.4 Hz.
    case "dance": return [-52 + Math.sin(time * 2.6 + seed + side * 1.3) * 22, -66 + Math.sin(time * 2.6 + seed + side) * 24];
    case "smoke": {
      if (side < 0) return [-4, -9];
      // Raise to the mouth for about a second every ~7 s, eased both ways.
      const phase = ((time + seed * 1.7) % 7 + 7) % 7, raise = phase < 1.6 ? Math.sin(clamp01(phase / 1.6) * Math.PI) : 0;
      return [-10 - raise * 22, -40 - raise * 95];
    }
  }
}
const HAIR: readonly RGB[] = [[39, 33, 39], [78, 54, 39], [145, 150, 151], [37, 60, 64]];

function box(canvas: PropCanvas, x: number, y: number, z: number, width: number, height: number, depth: number): void {
  canvas.translate(x, -y, z); canvas.box(width, height, depth); canvas.translate(-x, y, -z);
}
function oval(canvas: PropCanvas, x: number, y: number, z: number, width: number, height: number, depth: number): void {
  canvas.translate(x, -y, z); canvas.ellipsoid(width, height, depth); canvas.translate(-x, y, -z);
}

export function drawHumanHead(canvas: PropCanvas, look: NpcLook, seed: number, detail: boolean, paint: HumanPaint): void {
  const hair = HAIR[Math.abs(Math.floor(seed)) % HAIR.length];
  paint(canvas, look.skin, ":"); oval(canvas, 0, 0, -0.025, 0.205, 0.25, 0.205);
  box(canvas, 0, -0.16, -0.085, 0.27, 0.16, 0.25);
  if (look.headwear === "hood") {
    paint(canvas, look.coat, "%");
    oval(canvas, 0, 0.03, 0.1, 0.29, 0.31, 0.2);
    box(canvas, 0, 0.24, -0.04, 0.53, 0.14, 0.37);
    for (const side of [-1, 1]) box(canvas, side * 0.245, -0.01, -0.025, 0.11, 0.46, 0.36);
  } else {
    paint(canvas, hair, "#"); oval(canvas, 0, 0.18, 0.025, 0.215, 0.115, 0.22);
    if (seed % 3 === 0) box(canvas, -0.15, 0.02, 0.13, 0.13, 0.4, 0.18);
  }
  if (look.headwear === "cap") {
    paint(canvas, look.trim, "="); oval(canvas, 0, 0.23, 0.01, 0.24, 0.12, 0.24);
    box(canvas, 0, 0.2, -0.26, 0.43, 0.05, 0.28);
  } else if (look.headwear === "mask") {
    // A welding mask pushed up off the face: a dark plate over the brow with a band round the back.
    paint(canvas, look.trim, "#"); box(canvas, 0, 0.25, -0.16, 0.44, 0.2, 0.2);
    box(canvas, 0, 0.17, 0.06, 0.46, 0.06, 0.32);
  }
  if (!detail) return;
  if (look.headwear === "mask") { paint(canvas, look.light, "-", 0.75); box(canvas, 0, 0.25, -0.265, 0.3, 0.05, 0.02); }
  // A lit implant at the temple: one small glowing glyph.
  if (look.implant) { paint(canvas, look.light, "*", 1.15); box(canvas, 0.19, 0.06, -0.16, 0.05, 0.05, 0.05); }
  paint(canvas, look.skin, "/"); box(canvas, 0, -0.035, -0.245, 0.075, 0.12, 0.08);
  if (look.headwear === "visor") {
    paint(canvas, BOOTS, "="); box(canvas, 0, 0.065, -0.212, 0.42, 0.115, 0.09);
    paint(canvas, look.light, "-", 0.8); box(canvas, 0, 0.065, -0.263, 0.34, 0.035, 0.03);
    paint(canvas, look.trim, "O"); oval(canvas, 0.225, 0.025, 0, 0.07, 0.13, 0.12);
  } else {
    paint(canvas, hair, "-");
    for (const side of [-1, 1]) {
      box(canvas, side * 0.09, 0.09, -0.205, 0.095, 0.025, 0.025);
      box(canvas, side * 0.09, 0.04, -0.224, 0.045, 0.04, 0.026);
    }
    box(canvas, 0, -0.15, -0.222, 0.11, 0.02, 0.025);
  }
}

export function drawHuman(canvas: PropCanvas, look: NpcLook, pose: HumanPose, paint: HumanPaint): void {
  const { time, seed, stride, moving, detail } = pose;
  // Eased weights (or the booleans, as 0/1): the stride phase keeps running, only its amplitude fades.
  const gait = clamp01(pose.gait ?? (moving ? 1 : 0)), talk = clamp01(pose.talk ?? (pose.talking ? 1 : 0));
  const blend = pose.sit !== undefined, sit = clamp01(pose.sit ?? (pose.seated ? 1 : 0));
  const width = 0.94 + (Math.abs(seed) % 4) * 0.035;
  const sway = mix(Math.sin(time * 0.65 + seed) * 0.1, Math.sin(stride), gait);
  const swing = Math.sin(stride) * 25 * gait;
  const breathe = Math.sin(time * 1.5 + seed) * 0.014;
  const seatHeight = pose.seatHeight ?? 0.83;
  canvas.push(); canvas.scale(width, 1, 1);
  if (pose.distant) {
    // A seat blend lowers the silhouette onto the seat and swings the legs forward (`seated`
    // alone keeps the standing silhouette, as before).
    const low = blend ? sit : 0, drop = low ? (HIP - seatHeight) * low : 0;
    paint(canvas, look.coat, "#");
    box(canvas, 0, (pose.longCoat ? mix(1.43, 1.7, low) : 1.7) - drop, 0, 0.76, pose.longCoat ? mix(1.45, 0.95, low) : 0.95, 0.48);
    for (const side of [-1, 1]) {
      box(canvas, side * 0.47, 1.62 - drop, 0, 0.2, 0.86, 0.25);
      paint(canvas, look.trim, "|"); box(canvas, side * 0.19, mix(0.61, 0.33, low), mix(swing * side * 0.004, -(0.5 + (pose.thigh ?? 0)), low), 0.25, mix(1.2, 0.66, low), 0.28);
      paint(canvas, look.coat, "#");
    }
    paint(canvas, look.skin, ":"); oval(canvas, 0, 2.48 - drop, -0.02, 0.21, 0.25, 0.21);
    paint(canvas, look.headwear === "hood" ? look.coat : look.trim, "="); box(canvas, 0, 2.72 - drop, 0, 0.45, 0.13, 0.42);
    canvas.pop(); return;
  }
  // Seated: hips at the seat, thighs forward, shins down to the ground (a low seat shortens them).
  // In between, the hips follow the bent legs so the feet stay on the floor.
  const shinSeat = Math.max(0.2, seatHeight - 0.11), thigh = (pose.thigh ?? 0) * sit;
  const hip = sit === 0 ? HIP : sit === 1 ? seatHeight
    : ANKLE + (0.53 + thigh) * Math.cos(sit * Math.PI / 2) + mix(0.53, shinSeat + 0.01, sit) + (seatHeight - ANKLE - shinSeat - 0.01) * sit;
  for (const side of [-1, 1]) {
    canvas.push(); canvas.translate(side * 0.19, -hip, 0); canvas.rotateX(mix(swing * side, -90, sit));
    paint(canvas, look.trim, "|"); box(canvas, 0, -0.26 - thigh / 2, 0, 0.265, 0.55 + thigh, 0.3);
    canvas.translate(0, 0.53 + thigh, 0);
    canvas.rotateX(mix(mix(3, Math.max(0, -Math.sin(stride) * side) * 32, gait), 90, sit));
    paint(canvas, look.trim, "|"); box(canvas, 0, mix(-0.25, -shinSeat / 2 + 0.01, sit), 0.015, 0.22, mix(0.52, shinSeat, sit), 0.26);
    paint(canvas, BOOTS, "="); box(canvas, 0, mix(-0.53, -shinSeat - 0.01, sit), -0.08, 0.29, 0.18, 0.48);
    if (detail) { paint(canvas, look.trim, "-"); box(canvas, 0, mix(-0.62, -shinSeat - 0.1, sit), -0.09, 0.3, 0.04, 0.49); }
    canvas.pop();
  }
  canvas.push(); canvas.translate(0, -(hip + 0.01), 0); canvas.rotateZ(sway * 1.2); canvas.rotateY(gait * sway * 3);
  if (pose.lean) canvas.rotateX(pose.lean);
  canvas.translate(0, 1.2 - breathe, 0);
  paint(canvas, look.coat, "#");
  box(canvas, 0, 1.24, 0, 0.7, 0.28, 0.47);
  oval(canvas, 0, 1.68, 0, 0.37, 0.43, 0.25);
  oval(canvas, 0, 1.97, 0, 0.47, 0.24, 0.27);
  if (pose.longCoat) {
    for (const side of [-1, 1]) {
      // Seat blend: the tails fold forward over the thighs instead of hanging through the seat.
      canvas.push(); canvas.translate(side * 0.22, -1.37, 0.04); canvas.rotateX(side * swing * 0.28 - (blend ? 88 * sit : 0));
      box(canvas, 0, -0.36, 0.015, 0.39, 0.77, blend ? mix(0.46, 0.32, sit) : 0.46); canvas.pop();
    }
  }
  paint(canvas, look.trim, "="); box(canvas, 0, 1.35, -0.01, 0.74, 0.1, 0.51);
  paint(canvas, look.skin, ":"); box(canvas, 0, 2.23, 0, 0.22, 0.2, 0.22);
  if (detail) {
    paint(canvas, look.trim, "/");
    for (const side of [-1, 1]) {
      canvas.push(); canvas.translate(side * 0.17, -1.98, -0.252); canvas.rotateZ(side * 24);
      box(canvas, 0, 0, 0, 0.16, 0.38, 0.06); canvas.pop();
    }
    box(canvas, -0.22, 1.59, -0.266, 0.2, 0.14, 0.07);
    box(canvas, 0.24, 1.57, -0.266, 0.17, 0.17, 0.08);
    paint(canvas, look.light, "-", 0.7); box(canvas, -0.22, 1.91, -0.285, 0.13, 0.06, 0.025);
    paint(canvas, BOOTS, "="); box(canvas, 0, 1.35, -0.28, 0.13, 0.12, 0.06);
  }
  for (const side of [-1, 1]) {
    const holding = side < 0 && (look.prop === "lantern" || look.prop === "case" || look.prop === "umbrella" || look.prop === "bag" || look.prop === "tool");
    // The free arm (swing, lap, gesture, phone) and the held pose, blended by how far it is held.
    // A dog lead is held only standing still: walking frees the left hand as the gait comes up.
    const held = pose.arms ? heldArm(pose.arms, side, time, seed) : null;
    const hold = held ? clamp01(pose.hold ?? 1) * (pose.arms === "lead" && side < 0 ? 1 - gait : 1) : 0;
    const lift = side < 0 ? 0 : clamp01(pose.phoneLift ?? (pose.phone ? 1 : 0)) * (1 - hold);
    const gesture = side > 0 ? talk * (1 - hold) : 0;
    const carried = holding ? clamp01(pose.propHold ?? 1) : 0, lap = blend ? sit : 0;
    const swung = holding ? mix(-swing * side * 0.7, -4, carried) : -swing * side * 0.7;
    const settled = mix(swung, 12, lap);
    const rest = gesture > 0 ? mix(settled, -20 - Math.sin(time * 1.6 + seed) * 9, gesture) : settled;
    const free = lift > 0 ? rest + (-28 - rest) * lift : rest;
    const upper = held && hold > 0 ? mix(free, held[0], hold) : free;
    const inward = pose.arms === "carry" || pose.arms === "push" || pose.arms === "sign" || (pose.arms === "wrist" || pose.arms === "preach") && side < 0;
    const roll = mix(-side * 4, side * 12, lap);
    canvas.push(); canvas.translate(side * 0.47, -2.01, 0); canvas.rotateZ(hold > 0 ? mix(roll, inward ? side * 14 : -side * 4, hold) : roll); canvas.rotateX(upper);
    const sleeve = pose.chrome && side > 0 ? CHROME : look.coat;
    paint(canvas, sleeve, "|"); box(canvas, 0, -0.22, 0, 0.23, 0.46, 0.28);
    const propFore = look.prop === "umbrella" && side < 0 ? mix(-9, -80, carried) : look.prop === "tool" && side < 0 ? -62 : -9;
    const settledFore = mix(propFore, -62, lap);
    const restFore = gesture > 0 ? mix(settledFore, -48, gesture) : settledFore;
    const freeFore = lift > 0 ? restFore + (-74 - restFore) * lift : restFore;
    canvas.translate(0, 0.43, 0); canvas.rotateX(held && hold > 0 ? mix(freeFore, held[1], hold) : freeFore);
    paint(canvas, sleeve, "|"); box(canvas, 0, -0.2, 0, 0.19, 0.42, 0.23);
    paint(canvas, look.trim, "="); box(canvas, 0, -0.37, 0, 0.205, 0.09, 0.24);
    paint(canvas, pose.chrome && side > 0 ? CHROME : look.skin, ":"); box(canvas, 0, -0.49, -0.01, 0.15, 0.18, 0.18);
    if (detail && pose.chrome && side > 0) { paint(canvas, look.light, "|", 1.1); box(canvas, 0, -0.2, -0.125, 0.04, 0.38, 0.02); }
    // Held-pose lights brighten as the pose is taken up (no pop at a threshold).
    if (detail && pose.arms === "wrist" && side < 0 && hold > 0.2) { paint(canvas, look.light, "=", 1.05 * hold); box(canvas, 0, -0.33, -0.125, 0.14, 0.1, 0.02); }
    if (detail && pose.arms === "smoke" && side > 0 && hold > 0.2) { paint(canvas, [255, 128, 64], "*", 0.8 + 0.5 * clamp01((-upper - 10) / 22)); box(canvas, 0, -0.6, -0.08, 0.04, 0.04, 0.12); }
    if (detail && lift > 0.5) {
      paint(canvas, BOOTS, "#"); box(canvas, 0, -0.54, -0.08, 0.23, 0.31, 0.07);
      paint(canvas, look.light, "=", 0.8); box(canvas, 0, -0.54, -0.123, 0.17, 0.23, 0.018);
    }
    if (detail && side < 0 && look.prop === "bag") {
      // A shopping bag swinging from the hand, its paper catching the stall lights.
      paint(canvas, BOOTS, "|"); box(canvas, 0, -0.62, 0, 0.03, 0.14, 0.12);
      paint(canvas, look.light, "#", 0.72); box(canvas, 0, -0.84, 0, 0.16, 0.34, 0.32);
    }
    if (detail && side < 0 && look.prop === "tool") {
      // A long-handled rake carried at a slant, its head up and forward.
      paint(canvas, [120, 96, 64], "/"); box(canvas, 0, -0.5, -0.1, 0.05, 0.05, 1.7);
      paint(canvas, [96, 108, 112], "="); box(canvas, 0, -0.5, -0.95, 0.36, 0.07, 0.07);
    }
    if (detail && side < 0 && pose.arms === "preach") { paint(canvas, [70, 40, 36], "#"); box(canvas, 0, -0.55, -0.06, 0.2, 0.27, 0.06); }
    if (detail && side > 0 && pose.arms === "feed") { paint(canvas, [210, 190, 150], "o", 0.9); box(canvas, 0, -0.6, -0.06, 0.08, 0.05, 0.08); }
    if (detail && side < 0 && look.prop === "case") {
      paint(canvas, BOOTS, "|"); box(canvas, 0, -0.62, 0, 0.06, 0.15, 0.27);
      paint(canvas, look.trim, "#"); box(canvas, 0, -0.9, 0, 0.2, 0.47, 0.65);
      paint(canvas, look.light, "-", 0.7); box(canvas, -0.11, -0.91, 0, 0.03, 0.05, 0.52);
    }
    if (detail && side < 0 && look.prop === "lantern") {
      paint(canvas, BOOTS, "|"); box(canvas, 0, -0.65, 0, 0.04, 0.24, 0.04);
      paint(canvas, look.light, "@", 0.85); box(canvas, 0, -0.92, 0, 0.25, 0.34, 0.25);
    }
    canvas.pop();
  }
  canvas.push(); canvas.translate(0, -2.49, -0.015);
  // A patrol's slow scan settles to the front while they talk (by the talk weight, not a switch).
  if (look.idle === "scan") { const scan = Math.sin(time * 0.6 + seed) * 24 * (1 - talk); if (scan) canvas.rotateY(scan); }
  if (pose.glance) canvas.rotateY(-pose.glance * 180 / Math.PI);
  const phoneLift = clamp01(pose.phoneLift ?? 0);
  const bow = (pose.headPitch ?? 0) + phoneLift * 14;
  if (bow) canvas.rotateX(bow);
  drawHumanHead(canvas, look, seed, detail, paint);
  // A raised phone's screen lights the face: one soft glyph under the eyes, warming from skin tone
  // to the screen's light as the phone comes up (no brightness pop at a threshold).
  if (detail && phoneLift > 0.3) {
    const k = phoneLift >= 0.8 ? 1 : (phoneLift - 0.3) / 0.5, glow = k * k * (3 - 2 * k);
    for (let channel = 0; channel < 3; channel++) FACE_GLOW[channel] = mix(look.skin[channel], look.light[channel], glow);
    paint(canvas, FACE_GLOW, "'", mix(1, 0.5 + phoneLift * 0.5, glow)); box(canvas, 0, -0.06, -0.255, 0.16, 0.08, 0.02);
  }
  canvas.pop(); canvas.pop(); canvas.pop();
}

// ---------------------------------------------------------------------------------------------
// Display-layer easing. The simulation steps people's logical state (a 90-degree turn at a corner,
// moving -> standing, standing -> seated, a held pose taken up); the drawing eases what is shown,
// per figure, from the scene clock alone, so every blend is frame-rate independent and a frame
// drawn twice (mirror and main pass) comes out the same both times.

/** Body turn: a critically damped follow on the shortest arc (spring time TURN_SMOOTH), hard-capped
 *  at TURN_RATE (180 deg/s); the head leads it by up to HEAD_LEAD. */
export const TURN_RATE = Math.PI, TURN_SMOOTH = 0.15, HEAD_LEAD = Math.PI / 6;
/** Turn acceleration: full TURN_RATE is reached in TURN_SMOOTH seconds (rad/s^2). */
export const TURN_ACCEL = TURN_RATE / TURN_SMOOTH;
const HEAD_RATE = 9, HEAD_SPEED = 2 * Math.PI;
/** Seconds for each 0..1 weight to ramp all the way, both ways. */
export const GAIT_SECONDS = 0.25, TALK_SECONDS = 0.4, SIT_SECONDS = 0.4, HOLD_SECONDS = 0.35, PHONE_SECONDS = 0.5;
/** A jump further than this in one frame (a doorway, a respawn), a gap longer than RESET_SECONDS
 *  without being drawn, or the clock running backwards restarts the figure at its logical state;
 *  figures not drawn for FORGET_SECONDS are dropped. */
export const TELEPORT_METRES = 3, RESET_SECONDS = 0.5, FORGET_SECONDS = 2;

/** What the simulation says this frame. `yaw` is the body heading (radians, engine sense);
 *  `glance` an extra head turn; the rest are 0..1 targets (usually 0 or 1). */
export interface MotionTargets { yaw: number; glance: number; gait: number; talk: number; sit: number; hold: number; phone: number }
/** What to draw: the eased yaw, the head's turn from the body (radians) and the eased weights
 *  (smoothstep; `sit` raised cosine). `arms` remembers the last held pose so it can ease out. */
export interface FigureDisplay { yaw: number; head: number; gait: number; talk: number; sit: number; hold: number; phone: number; arms: HumanArms | undefined }
interface MotionValues { yaw: number; spin: number; head: number; gait: number; talk: number; sit: number; hold: number; phone: number }
interface FigureMotion { born: number; base: number; at: number; x: number; z: number; from: MotionValues; now: MotionValues; out: FigureDisplay }

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
export const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const approach = (value: number, target: number, dt: number, seconds: number): number => value + clamp(target - value, -dt / seconds, dt / seconds);
const smoothWeight = (u: number): number => u * u * (3 - 2 * u);
const values = (): MotionValues => ({ yaw: 0, spin: 0, head: 0, gait: 0, talk: 0, sit: 0, hold: 0, phone: 0 });

/** One step of every channel from `from` over `dt` seconds toward `target`, written into `now`. */
function stepMotion(from: Readonly<MotionValues>, target: Readonly<MotionTargets>, dt: number, now: MotionValues): void {
  // Body yaw on the shortest arc: the turn rate ramps up and down under TURN_ACCEL (full rate in
  // TURN_SMOOTH seconds) along the discrete braking curve, so it never overshoots, never exceeds
  // TURN_RATE and lands the same at any frame rate (the same profile as the ride camera).
  const error = wrapAngle(target.yaw - from.yaw), half = TURN_ACCEL * dt / 2;
  const desired = Math.sign(error) * Math.min(TURN_RATE, Math.sqrt(half * half + 2 * TURN_ACCEL * Math.abs(error)) - half);
  let spin = clamp(from.spin + clamp(desired - from.spin, -TURN_ACCEL * dt, TURN_ACCEL * dt), -TURN_RATE, TURN_RATE);
  let delta = (from.spin + spin) * 0.5 * dt; // trapezoidal: exact under constant acceleration, so coarse frames land where fine ones do
  if (delta * error > 0 && Math.abs(delta) >= Math.abs(error)) delta = error;
  else if (Math.abs(error) < 1e-6) delta = 0;
  if (delta === error || Math.abs(error) < 1e-6) spin -= clamp(spin, -TURN_ACCEL * dt, TURN_ACCEL * dt); // settle without a jolt
  now.yaw = wrapAngle(from.yaw + delta); now.spin = spin;
  // The head leads the turn (up to HEAD_LEAD) plus any glance, eased and speed-capped.
  const lead = clamp(wrapAngle(target.yaw - now.yaw), -HEAD_LEAD, HEAD_LEAD) + target.glance;
  now.head = from.head + clamp((lead - from.head) * (1 - Math.exp(-HEAD_RATE * dt)), -HEAD_SPEED * dt, HEAD_SPEED * dt);
  now.gait = approach(from.gait, target.gait, dt, GAIT_SECONDS);
  now.talk = approach(from.talk, target.talk, dt, TALK_SECONDS);
  now.sit = approach(from.sit, target.sit, dt, SIT_SECONDS);
  now.hold = approach(from.hold, target.hold, dt, HOLD_SECONDS);
  now.phone = approach(from.phone, target.phone, dt, PHONE_SECONDS);
}

function settle(values: MotionValues, target: Readonly<MotionTargets>): void {
  values.yaw = wrapAngle(target.yaw); values.spin = 0; values.head = target.glance;
  values.gait = clamp01(target.gait); values.talk = clamp01(target.talk); values.sit = clamp01(target.sit);
  values.hold = clamp01(target.hold); values.phone = clamp01(target.phone);
}

/** Per-figure display state, keyed by the figure's id. Bounded: figures not drawn for
 *  FORGET_SECONDS are swept (about once a second of clock) and the map never exceeds `limit`. */
export class FigureMotions<K> {
  private readonly figures = new Map<K, FigureMotion>();
  private readonly limit: number;
  private swept = Number.NaN;
  constructor(limit = 1024) { this.limit = Math.max(1, limit); }
  get size(): number { return this.figures.size; }

  /** The eased display for `key` at clock `time`, standing at (x, z). A figure seen for the first
   *  time (or still within its first frame's clock) shows its logical state exactly: no spin-in. */
  update(key: K, time: number, x: number, z: number, target: Readonly<MotionTargets>): FigureDisplay {
    if (!(time >= this.swept && time - this.swept < 1)) this.sweep(time, FORGET_SECONDS);
    let figure = this.figures.get(key);
    if (!figure) {
      if (this.figures.size >= this.limit) this.evict(time);
      figure = { born: time, base: time, at: time, x, z, from: values(), now: values(), out: { yaw: 0, head: 0, gait: 0, talk: 0, sit: 0, hold: 0, phone: 0, arms: undefined } };
      this.figures.set(key, figure);
      this.restart(figure, time, target);
    } else if (time === figure.born || time < figure.at || time - figure.at > RESET_SECONDS || Math.hypot(x - figure.x, z - figure.z) > TELEPORT_METRES) {
      this.restart(figure, time, target);
    } else {
      // A new frame: this frame starts from the last one. A repeat of the same frame recomputes from
      // the same start, so it comes out identical.
      if (time !== figure.at) { Object.assign(figure.from, figure.now); figure.base = figure.at; figure.at = time; }
      stepMotion(figure.from, target, time - figure.base, figure.now);
    }
    figure.x = x; figure.z = z;
    const { now, out } = figure;
    out.yaw = now.yaw; out.head = now.head;
    out.gait = smoothWeight(now.gait); out.talk = smoothWeight(now.talk); out.hold = smoothWeight(now.hold); out.phone = smoothWeight(now.phone);
    out.sit = 0.5 - 0.5 * Math.cos(Math.PI * now.sit);
    if (out.hold === 0) out.arms = undefined;
    return out;
  }

  private restart(figure: FigureMotion, time: number, target: Readonly<MotionTargets>): void {
    figure.born = figure.base = figure.at = time;
    settle(figure.now, target); Object.assign(figure.from, figure.now);
    figure.out.arms = undefined;
  }

  /** Drops figures not drawn within `stale` seconds of `time` (either way: a clock reset too). */
  private sweep(time: number, stale: number): void {
    this.swept = time;
    for (const [key, figure] of this.figures) if (Math.abs(time - figure.at) > stale) this.figures.delete(key);
  }

  /** Full: drop the long-unseen first, then the oldest entries, to make room for one more. */
  private evict(time: number): void {
    this.sweep(time, 0.25);
    for (const key of this.figures.keys()) {
      if (this.figures.size < this.limit) break;
      this.figures.delete(key);
    }
  }
}
