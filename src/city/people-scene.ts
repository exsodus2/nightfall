import type { PropCanvas } from "./prop-canvas";
import type { Citizen } from "./people";
import { cuboid as box, ink, propRange, restorePropRange } from "./activity";
import { SEATED, SEATED_POSE } from "./metro";
import type { RGB } from "./world";

const COATS: readonly RGB[] = [[137, 112, 81], [45, 120, 112], [119, 75, 92], [160, 142, 97], [76, 91, 121], [99, 123, 102], [154, 78, 54], [91, 85, 77]];
const SKIN: readonly RGB[] = [[179, 143, 115], [111, 85, 69], [189, 174, 141], [144, 112, 88]];
const TROUSERS: RGB = [62, 71, 78], SHOES: RGB = [36, 40, 44], HAT: RGB = [38, 40, 47];

/** A seated rider: hips on the cushion, thighs along it, shins and feet in front of its edge, back
 *  against the backrest (the pose boxes are shared with metro.ts, whose tests keep them clear of
 *  the bench). The origin is the floor under the hips; the caller has already applied the yaw. */
function drawSeated(t: PropCanvas, person: Citizen, coat: RGB, detail: boolean): void {
  ink(t, coat, "H");
  t.translate(0, -SEATED.torso, 0); t.ellipsoid(0.43, 0.68, 0.3); t.translate(0, SEATED.torso, 0);
  ink(t, SKIN[person.id % SKIN.length], "O");
  t.translate(0, -SEATED.head, -0.04); t.ellipsoid(0.25, 0.32, 0.25); t.translate(0, SEATED.head, 0.04);
  if (!detail) return;
  const outer = propRange(150);
  for (const part of SEATED_POSE) {
    if (part.part === "foot") ink(t, SHOES, "=");
    else if (part.part === "arm" || part.part === "forearm") ink(t, coat, "|");
    else ink(t, TROUSERS, part.part === "thigh" ? "=" : "|");
    box(t, part.x, part.y, part.z, part.w, part.h, part.d);
  }
  ink(t, HAT, "=");
  t.translate(0, -SEATED.hat, 0.01); t.ellipsoid(0.27, 0.12, 0.25); t.translate(0, SEATED.hat, -0.01);
  restorePropRange(outer);
}

export function drawCitizen(t: PropCanvas, person: Citizen, time: number, detail: boolean, rain: boolean): void {
  const coat = COATS[person.id % COATS.length];
  t.push(); t.translate(person.x, -person.y, person.z); t.rotateY(-person.yaw * 180 / Math.PI);
  if (person.seated) { drawSeated(t, person, coat, detail); t.pop(); return; }
  const gait = person.moving ? Math.sin(time * 6.5 + person.id) * 0.33 : 0;
  ink(t, coat, "H");
  t.translate(0, -1.45, 0); t.ellipsoid(0.43, 0.68, 0.3); t.translate(0, 1.45, 0);
  ink(t, SKIN[person.id % SKIN.length], "O");
  t.translate(0, -2.28, -0.04); t.ellipsoid(0.25, 0.32, 0.25); t.translate(0, 2.28, 0.04);
  if (detail) {
    const outer = propRange(150);
    for (const side of [-1, 1]) {
      ink(t, TROUSERS, "|"); box(t, side * 0.22, 0.46, gait * side, 0.28, 0.94, 0.34);
      ink(t, coat, "|"); box(t, side * 0.48, 1.37, -gait * side, 0.2, 0.92, 0.24);
      ink(t, SHOES, "="); box(t, side * 0.22, 0.09, gait * side - 0.07, 0.3, 0.17, 0.49);
    }
    ink(t, HAT, "=");
    t.translate(0, -2.53, 0.01); t.ellipsoid(0.27, 0.12, 0.25); t.translate(0, 2.53, -0.01);
    if (person.occupation === "courier") {
      ink(t, [211, 154, 64], "#", 0.85); box(t, 0, 1.4, 0.47, 0.7, 0.95, 0.5);
      ink(t, [157, 226, 191], "+"); box(t, 0, 1.7, 0.76, 0.18, 0.16, 0.07);
    } else if (!person.moving && person.id % 3 === 0) {
      ink(t, [138, 235, 215], "="); box(t, 0.48, 1.7, -0.36, 0.25, 0.33, 0.06);
    }
    if (rain && person.umbrella && person.y < 1) {
      ink(t, coat, "%", 0.9);
      t.translate(0, -3.04, 0); t.ellipsoid(1.3, 0.23, 1.3); t.translate(0, 3.04, 0);
      ink(t, [123, 147, 141], "|"); box(t, 0.5, 2.25, 0, 0.07, 1.65, 0.07);
    }
    restorePropRange(outer);
  }
  t.pop();
}
