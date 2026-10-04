import type { PropCanvas } from "./prop-canvas";
import type { Citizen } from "./people";
import { cuboid as box, ink, propRange, restorePropRange } from "./activity";
import { SEATED, SEATED_POSE } from "./metro";
import type { RGB } from "./world";
import type { NpcLook } from "./npcs";
import { drawHuman, drawHumanHead } from "./human-model";
import { drawUmbrella } from "./umbrella-model";

const COATS: readonly RGB[] = [[137, 112, 81], [45, 120, 112], [119, 75, 92], [160, 142, 97], [76, 91, 121], [99, 123, 102], [154, 78, 54], [91, 85, 77]];
const SKIN: readonly RGB[] = [[179, 143, 115], [111, 85, 69], [189, 174, 141], [144, 112, 88]];
const TROUSERS: RGB = [62, 71, 78], SHOES: RGB = [36, 40, 44];
const LOOKS: readonly NpcLook[] = COATS.map((coat, index) => ({ coat, trim: index % 2 ? [56, 72, 83] : [87, 79, 76], skin: SKIN[index % SKIN.length], light: [135, 199, 190], headwear: index % 4 === 0 ? "hood" : index % 4 === 1 ? "cap" : index % 4 === 2 ? "bare" : "visor", prop: null, idle: "breathe" }));
const RAIN_LOOKS: readonly NpcLook[] = LOOKS.map(look => ({ ...look, prop: "umbrella" }));

/** A seated rider: hips on the cushion, thighs along it, shins and feet in front of its edge, back
 *  against the backrest (the pose boxes are shared with metro.ts, whose tests keep them clear of
 *  the bench). The origin is the floor under the hips; the caller has already applied the yaw. */
function drawSeated(t: PropCanvas, person: Citizen, coat: RGB, detail: boolean): void {
  ink(t, coat, "H");
  t.translate(0, -SEATED.torso, 0); t.ellipsoid(0.43, 0.68, 0.3); t.translate(0, SEATED.torso, 0);
  t.push(); t.translate(0, -SEATED.head, -0.04);
  drawHumanHead(t, LOOKS[person.id % LOOKS.length], person.id, detail, ink); t.pop();
  if (!detail) return;
  const outer = propRange(150);
  for (const part of SEATED_POSE) {
    if (part.part === "foot") ink(t, SHOES, "=");
    else if (part.part === "arm" || part.part === "forearm") ink(t, coat, "|");
    else ink(t, TROUSERS, part.part === "thigh" ? "=" : "|");
    box(t, part.x, part.y, part.z, part.w, part.h, part.d);
  }
  restorePropRange(outer);
}

export function drawCitizen(t: PropCanvas, person: Citizen, time: number, detail: boolean, rain: boolean): void {
  const coat = COATS[person.id % COATS.length];
  const yaw = !person.moving && person.attentionYaw !== undefined ? person.attentionYaw : person.yaw;
  t.push(); t.translate(person.x, -person.y, person.z); t.rotateY(-yaw * 180 / Math.PI);
  if (person.seated) { drawSeated(t, person, coat, detail); t.pop(); return; }
  const umbrella = rain && person.umbrella && person.y < 1;
  const looks = umbrella ? RAIN_LOOKS : LOOKS;
  drawHuman(t, looks[person.id % looks.length], { time, seed: person.id, stride: time * 4.2 + person.id, moving: person.moving, detail, distant: !detail, longCoat: person.id % 3 === 0, talking: person.reaction === "greeting", phone: !person.moving && !person.reaction && person.id % 3 === 0 }, ink);
  if (detail) {
    const outer = propRange(150);
    if (person.occupation === "courier") {
      ink(t, [211, 154, 64], "#", 0.85); box(t, 0, 1.4, 0.47, 0.7, 0.95, 0.5);
      ink(t, [157, 226, 191], "+"); box(t, 0, 1.7, 0.76, 0.18, 0.16, 0.07);
    }
    if (umbrella) drawUmbrella(t, coat, ink);
    restorePropRange(outer);
  }
  t.pop();
}
