import type { PropCanvas } from "./prop-canvas.ts";
import type { HumanPaint } from "./human-model.ts";
import type { RGB } from "./world.ts";

function part(canvas: PropCanvas, x: number, y: number, z: number, width: number, height: number, depth: number): void {
  canvas.translate(x, -y, z); canvas.box(width, height, depth); canvas.translate(-x, y, -z);
}

export function drawRearCabin(canvas: PropCanvas, body: RGB, paint: HumanPaint): void {
  canvas.push();
  paint(canvas, [29, 37, 49], "#");
  part(canvas, 0, 0.49, 0.43, 2.42, 0.1, 2.45);
  part(canvas, 0, 0.94, 1.64, 2.42, 0.96, 0.12);
  for (const side of [-1, 1]) {
    part(canvas, side * 1.22, 1.01, 1.25, 0.13, 0.8, 0.72);
    part(canvas, side * 1.16, 1.76, 0.63, 0.12, 0.64, 0.14);
  }
  paint(canvas, [61, 76, 90], "=");
  part(canvas, 0, 0.77, 1.08, 2.16, 0.25, 0.72);
  part(canvas, 0, 1.15, 1.44, 2.16, 0.73, 0.23);
  for (const side of [-1, 1]) {
    part(canvas, side * 0.69, 1.65, 1.4, 0.43, 0.28, 0.22);
    part(canvas, side * 0.55, 0.72, 0.17, 0.73, 0.22, 0.77);
    part(canvas, side * 0.55, 1.06, 0.58, 0.73, 0.68, 0.2);
    part(canvas, side * 0.55, 1.43, 0.6, 0.36, 0.22, 0.2);
  }
  paint(canvas, [110, 128, 142], "-");
  for (const side of [-1, 1]) {
    part(canvas, side * 0.36, 1.15, 1.3, 0.035, 0.63, 0.025);
    part(canvas, side * 1.11, 1.1, 1.18, 0.09, 0.06, 0.26);
  }
  paint(canvas, [31, 43, 56], "=");
  part(canvas, 0, 1.39, 1.76, 2.32, 0.08, 0.54);
  paint(canvas, body, "|", 0.6);
  for (const side of [-1, 1]) {
    canvas.push(); canvas.translate(side * 1.13, -1.75, 1.34); canvas.rotateX(32);
    canvas.box(0.16, 0.84, 0.15); canvas.pop();
  }
  part(canvas, 0, 2.07, 1.12, 2.34, 0.1, 0.16);
  part(canvas, 0, 1.43, 1.59, 2.42, 0.08, 0.13);
  paint(canvas, [84, 107, 118], "-", 0.65);
  for (let strip = 0; strip < 3; strip++) part(canvas, 0, 1.55 + strip * 0.15, 1.51 - strip * 0.11, 2.1, 0.014, 0.014);
  paint(canvas, body, "=", 0.5);
  part(canvas, 0, 1.24, 2.2, 2.6, 0.13, 1.35);
  paint(canvas, [209, 57, 69], "=", 0.6);
  part(canvas, 0, 1.47, 1.55, 0.42, 0.04, 0.055);
  canvas.pop();
}
