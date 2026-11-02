import type { PropCanvas } from "./prop-canvas.ts";

export const WHEEL_GEOMETRY = { lateral: 1.4, height: 0.46, axle: 1.75, halfWidth: 0.15, radius: 0.4 } as const;

/** Hub caps: a lighter disc set into each tyre's outer sidewall, behind the VFX wheel quad
 * (vfx-scene.ts, at lateral + halfWidth + 0.015) so near cars keep their spinning wheels. */
const HUB: readonly [number, number, number] = [112, 122, 132];
/** Hub caps dissolve out by this distance (4 m units, the prop range code): beyond it they are
 * smaller than a cell and would wink in and out as the car moves. */
const HUB_RANGE_CODE = 18;
const HUB_INSET = 0.08, HUB_HALF_WIDTH = 0.06, HUB_RADIUS = 0.21;

/** The four tyres, in the current ink. */
export function drawVehicleTyres(canvas: PropCanvas): void {
  for (const side of [-1, 1]) for (const axle of [-1, 1]) {
    const x = side * WHEEL_GEOMETRY.lateral, z = axle * WHEEL_GEOMETRY.axle;
    canvas.translate(x, -WHEEL_GEOMETRY.height, z);
    canvas.ellipsoid(WHEEL_GEOMETRY.halfWidth, WHEEL_GEOMETRY.radius, WHEEL_GEOMETRY.radius);
    canvas.translate(-x, WHEEL_GEOMETRY.height, -z);
  }
}

/** Tyres for the other bodies (buses, lorries, bikes, three-wheelers), in the current ink: a pair at
 * +-`lateral` on each axle (one, centred, when `lateral` is 0). */
export function drawWheelSet(canvas: PropCanvas, axles: readonly number[], lateral: number, radius: number, halfWidth: number): void {
  for (const z of axles) for (const side of lateral === 0 ? [0] : [-1, 1]) {
    const x = side * lateral;
    canvas.translate(x, -radius - 0.06, z);
    canvas.ellipsoid(halfWidth, radius, radius);
    canvas.translate(-x, radius + 0.06, -z);
  }
}

/** The four hub caps, in their own ink and a shorter draw distance (call after drawVehicleTyres,
 * in the car's frame; it leaves the ink changed). */
export function drawVehicleHubs(canvas: PropCanvas): void {
  canvas.char("o");
 canvas.charColor(...HUB); canvas.cellColor(HUB[0] * 0.12, HUB[1] * 0.12, HUB[2] * 0.12, HUB_RANGE_CODE);
  for (const side of [-1, 1]) for (const axle of [-1, 1]) {
    const x = side * (WHEEL_GEOMETRY.lateral + HUB_INSET), z = axle * WHEEL_GEOMETRY.axle;
    canvas.translate(x, -WHEEL_GEOMETRY.height, z);
    canvas.ellipsoid(HUB_HALF_WIDTH, HUB_RADIUS, HUB_RADIUS);
    canvas.translate(-x, WHEEL_GEOMETRY.height, -z);
  }
}

