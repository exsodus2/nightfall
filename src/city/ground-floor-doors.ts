import type { RGB } from "./world.ts";
import type { InteriorPlace } from "./interiors.ts";
import { ink, propRange, restorePropRange } from "./activity.ts";
import type { PropCanvas } from "./prop-canvas.ts";

/** Ground floors: every building's door gets a soft warm lintel light, but only within this many metres. */
export const GROUND_FLOOR_DOOR_RADIUS = 20;
const MAX_DOORS = 6;
/** Full brightness inside FULL_BY metres, fading smoothly to nothing at the radius. */
const FULL_BY = 14;
const LINTEL: RGB = [255, 196, 128];

type Visible = (x: number, y: number, z: number, radius?: number) => boolean;
/** The slice of CityInteriors this needs (interiors.groundFloorsNear, a spatial-index lookup). */
interface DoorSource { groundFloorsNear(x: number, z: number, radius: number): readonly InteriorPlace[] }

const nearest: InteriorPlace[] = [];
const nearestD: number[] = [];

function lamp(canvas: PropCanvas, color: RGB, gain: number, x: number, y: number, z: number, w: number, h: number, d: number): void {
  ink(canvas, color, "-", gain);
  canvas.push(); canvas.translate(x, -y, z); /* textmode y points down */ canvas.box(w, h, d); canvas.pop();
}

/** A subtle cue for a ground-floor door within ~20 m: a soft warm lintel strip over a faintly lit,
 * district-tinted threshold. The nearest MAX_DOORS are picked first (stable while turning), then
 * frustum-tested. Steady light, fading out over the last metres; street-prop draw range applies. */
export function drawGroundFloorDoors(canvas: PropCanvas, source: DoorSource, eye: { x: number; z: number }, visible: Visible): void {
  const doors = source.groundFloorsNear(eye.x, eye.z, GROUND_FLOOR_DOOR_RADIUS);
  const r2 = GROUND_FLOOR_DOOR_RADIUS * GROUND_FLOOR_DOOR_RADIUS;
  let count = 0;
  for (const place of doors) {
    const dx = place.entrance.x - eye.x, dz = place.entrance.z - eye.z, d = dx * dx + dz * dz;
    if (d >= r2) continue;
    if (count === MAX_DOORS && d >= nearestD[MAX_DOORS - 1]) continue;
    let i = count < MAX_DOORS ? count++ : MAX_DOORS - 1;
    while (i > 0 && nearestD[i - 1] > d) { nearest[i] = nearest[i - 1]; nearestD[i] = nearestD[i - 1]; i--; }
    nearest[i] = place; nearestD[i] = d;
  }
  if (count === 0) return;
  const outer = propRange(GROUND_FLOOR_DOOR_RADIUS);
  for (let n = 0; n < count; n++) {
    const place = nearest[n], { entrance } = place;
    if (!visible(entrance.x, 3, entrance.z, 2)) continue;
    const t = Math.min(1, Math.max(0, (GROUND_FLOOR_DOOR_RADIUS - Math.sqrt(nearestD[n])) / (GROUND_FLOOR_DOOR_RADIUS - FULL_BY)));
    const fade = t * t * (3 - 2 * t);
    if (fade < 0.02) continue;
    canvas.push(); canvas.translate(entrance.x, 0, entrance.z); canvas.rotateY(place.yaw * 180 / Math.PI);
    lamp(canvas, LINTEL, 0.8 * fade, 0, 3.55, -0.62, 2.2, 0.1, 0.12);
    lamp(canvas, LINTEL, 0.35 * fade, 0, 3.4, -0.6, 2.0, 0.06, 0.08);
    lamp(canvas, place.color, 0.55 * fade, 0, 0.06, -0.55, 1.8, 0.05, 0.3);
    canvas.pop();
  }
  restorePropRange(outer);
}
