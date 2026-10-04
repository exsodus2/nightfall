import type { PropCanvas } from "./prop-canvas.ts";

export const WHEEL_GEOMETRY = { lateral: 1.4, height: 0.46, axle: 1.75, halfWidth: 0.15, radius: 0.4 } as const;

export function drawVehicleTyres(canvas: PropCanvas): void {
  for (const side of [-1, 1]) for (const axle of [-1, 1]) {
    const x = side * WHEEL_GEOMETRY.lateral, z = axle * WHEEL_GEOMETRY.axle;
    canvas.translate(x, -WHEEL_GEOMETRY.height, z);
    canvas.ellipsoid(WHEEL_GEOMETRY.halfWidth, WHEEL_GEOMETRY.radius, WHEEL_GEOMETRY.radius);
    canvas.translate(-x, WHEEL_GEOMETRY.height, -z);
  }
}
