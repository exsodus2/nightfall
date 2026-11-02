import type { PropCanvas } from "./prop-canvas.ts";
import type { HumanPaint } from "./human-model.ts";
import type { RGB } from "./world.ts";

export const UMBRELLA = { x: -0.5, z: -0.48, canopy: 3.12, grip: 1.47, radius: 1.1 } as const;

/** `open` (0..1) spreads the canopy: furled it is a slim cone hugging the shaft, so an umbrella
 *  opening as the rain rises grows over a few seconds instead of popping. */
export function drawUmbrella(canvas: PropCanvas, color: RGB, paint: HumanPaint, rim?: RGB, open = 1): void {
  canvas.push(); canvas.translate(UMBRELLA.x, -UMBRELLA.canopy, UMBRELLA.z);
  const spread = 0.16 + 0.84 * Math.max(0, Math.min(1, open));
  paint(canvas, color, "%", 0.85); canvas.ellipsoid(UMBRELLA.radius * spread, 0.26 + (1 - spread) * 0.3, UMBRELLA.radius * spread);
  const edge = spread < 0.95 ? undefined : rim; // the rim ring only on a fully open canopy
  paint(canvas, [137, 154, 161], "|");
  const length = UMBRELLA.canopy - UMBRELLA.grip;
  canvas.translate(0, length / 2, 0); canvas.box(0.055, length, 0.055); canvas.translate(0, -length / 2, 0);
  canvas.translate(0, -0.29, 0); canvas.box(0.065, 0.2, 0.065); canvas.translate(0, 0.29, 0);
  paint(canvas, [45, 51, 60], "=");
  canvas.translate(0, length, 0); canvas.box(0.09, 0.17, 0.1); canvas.translate(0, -length, 0);
  if (edge) {
    paint(canvas, edge, "-", 0.75);
    canvas.translate(0, 0.025, 0); canvas.torus(UMBRELLA.radius, 0.025);
  }
  canvas.pop();
}
