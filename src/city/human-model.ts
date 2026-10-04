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
}
const BOOTS: RGB = [41, 46, 54];
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
  }
  if (!detail) return;
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
  const width = 0.94 + (Math.abs(seed) % 4) * 0.035;
  const sway = moving ? Math.sin(stride) : Math.sin(time * 0.65 + seed) * 0.1;
  const swing = moving ? Math.sin(stride) * 25 : 0;
  const breathe = Math.sin(time * 1.5 + seed) * 0.014;
  canvas.push(); canvas.scale(width, 1, 1);
  if (pose.distant) {
    paint(canvas, look.coat, "#");
    box(canvas, 0, pose.longCoat ? 1.43 : 1.7, 0, 0.76, pose.longCoat ? 1.45 : 0.95, 0.48);
    for (const side of [-1, 1]) {
      box(canvas, side * 0.47, 1.62, 0, 0.2, 0.86, 0.25);
      paint(canvas, look.trim, "|"); box(canvas, side * 0.19, 0.61, swing * side * 0.004, 0.25, 1.2, 0.28);
      paint(canvas, look.coat, "#");
    }
    paint(canvas, look.skin, ":"); oval(canvas, 0, 2.48, -0.02, 0.21, 0.25, 0.21);
    paint(canvas, look.headwear === "hood" ? look.coat : look.trim, "="); box(canvas, 0, 2.72, 0, 0.45, 0.13, 0.42);
    canvas.pop(); return;
  }
  for (const side of [-1, 1]) {
    canvas.push(); canvas.translate(side * 0.19, pose.seated ? -0.83 : -1.19, 0); canvas.rotateX(pose.seated ? -90 : swing * side);
    paint(canvas, look.trim, "|"); box(canvas, 0, -0.26, 0, 0.265, 0.55, 0.3);
    canvas.translate(0, 0.53, 0);
    canvas.rotateX(pose.seated ? 90 : moving ? Math.max(0, -Math.sin(stride) * side) * 32 : 3);
    paint(canvas, look.trim, "|"); box(canvas, 0, pose.seated ? -0.35 : -0.25, 0.015, 0.22, pose.seated ? 0.72 : 0.52, 0.26);
    paint(canvas, BOOTS, "="); box(canvas, 0, pose.seated ? -0.73 : -0.53, -0.08, 0.29, 0.18, 0.48);
    if (detail) { paint(canvas, look.trim, "-"); box(canvas, 0, pose.seated ? -0.82 : -0.62, -0.09, 0.3, 0.04, 0.49); }
    canvas.pop();
  }
  canvas.push(); canvas.translate(0, pose.seated ? -0.84 : -1.2, 0); canvas.rotateZ(sway * 1.2); canvas.rotateY(moving ? sway * 3 : 0); canvas.translate(0, 1.2 - breathe, 0);
  paint(canvas, look.coat, "#");
  box(canvas, 0, 1.24, 0, 0.7, 0.28, 0.47);
  oval(canvas, 0, 1.68, 0, 0.37, 0.43, 0.25);
  oval(canvas, 0, 1.97, 0, 0.47, 0.24, 0.27);
  if (pose.longCoat) {
    for (const side of [-1, 1]) {
      canvas.push(); canvas.translate(side * 0.22, -1.37, 0.04); canvas.rotateX(side * swing * 0.28);
      box(canvas, 0, -0.36, 0.015, 0.39, 0.77, 0.46); canvas.pop();
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
    const holding = side < 0 && (look.prop === "lantern" || look.prop === "case" || look.prop === "umbrella");
    const phone = side > 0 && pose.phone;
    const gesture = side > 0 && pose.talking;
    const upper = phone ? -28 : gesture ? -20 - Math.sin(time * 1.6) * 9 : holding ? -4 : -swing * side * 0.7;
    canvas.push(); canvas.translate(side * 0.47, -2.01, 0); canvas.rotateZ(-side * 4); canvas.rotateX(upper);
    paint(canvas, look.coat, "|"); box(canvas, 0, -0.22, 0, 0.23, 0.46, 0.28);
    canvas.translate(0, 0.43, 0); canvas.rotateX(phone ? -74 : gesture ? -48 : look.prop === "umbrella" && side < 0 ? -80 : -9);
    paint(canvas, look.coat, "|"); box(canvas, 0, -0.2, 0, 0.19, 0.42, 0.23);
    paint(canvas, look.trim, "="); box(canvas, 0, -0.37, 0, 0.205, 0.09, 0.24);
    paint(canvas, look.skin, ":"); box(canvas, 0, -0.49, -0.01, 0.15, 0.18, 0.18);
    if (detail && phone) {
      paint(canvas, BOOTS, "#"); box(canvas, 0, -0.54, -0.08, 0.23, 0.31, 0.07);
      paint(canvas, look.light, "=", 0.8); box(canvas, 0, -0.54, -0.123, 0.17, 0.23, 0.018);
    }
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
  if (look.idle === "scan" && !pose.talking) canvas.rotateY(Math.sin(time * 0.6 + seed) * 24);
  drawHumanHead(canvas, look, seed, detail, paint);
  canvas.pop(); canvas.pop(); canvas.pop();
}
