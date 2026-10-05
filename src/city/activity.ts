import type { PropCanvas } from "./prop-canvas";
import { wrap } from "./locomotion";
import type { Citizen } from "./people";
import type { Vehicle } from "./traffic";
import { drawCitizen } from "./people-scene";
import { LANDMARKS, LAMP_HEAD_HEIGHT, LAMP_STREETS, inPark, randomFor, streetLamp, type RGB } from "./world";
// VFX: wheels, brake lights, steam, sky trails (vfx-scene.ts).
import { carFx, skyTrail, ventSteam } from "./vfx-scene";
import { drawVehicleTyres } from "./vehicle-wheels";
import { LINE_PER_METRE, drawLandmarkStructure, landmarkDetail, setLandmarkEye } from "./landmarks-scene";
import { drawSignalPost, drawStreetLife, type StreetKit } from "./street-life";

export function cuboid(t: PropCanvas, x: number, y: number, z: number, w: number, h: number, d: number): void {
  // Only position changes here. An inverse translation avoids copying the
  // complete shader, lighting and style stacks for every instanced cuboid.
  t.translate(x, -y, z); t.box(w, h, d); t.translate(-x, y, -z);
}
// Draw distance of subsequent props, carried in the otherwise unused cell alpha (4 m units).
// The material dissolves props over the last quarter of it; 255 means "always drawn".
let rangeCode = 255;
export function propRange(meters: number): number {
  const previous = rangeCode;
  rangeCode = meters > 0 ? Math.max(1, Math.min(254, Math.round(meters / 4))) : 255;
  return previous;
}
export function restorePropRange(code: number): void { rangeCode = code; }
export const propAlpha = (): number => rangeCode;
export function ink(t: PropCanvas, color: RGB, glyph = "#", gain = 1): void {
  t.char(glyph); t.charColor(color[0] * gain, color[1] * gain, color[2] * gain);
  t.cellColor(color[0] * 0.12, color[1] * 0.12, color[2] * 0.12, rangeCode);
}
/** Street life (street-life.ts) paints and sets draw distances through these. */
const STREET_KIT: StreetKit = { paint: ink, range: propRange, restore: restorePropRange };
const CAR_COLORS: readonly RGB[] = [[243, 155, 53], [46, 152, 184], [181, 72, 132], [129, 158, 150], [131, 107, 189], [176, 182, 188], [58, 68, 92], [172, 58, 50]];
const CAB_COLOR: RGB = [243, 155, 53], POLICE_COLOR: RGB = [40, 50, 70];
export type CarKind = "sedan" | "cab" | "van" | "pickup" | "coupe" | "police";
/** Body type for a car id. Every kind keeps the same 2.7 x 5.8 m footprint (driving.ts collision). */
export function carKind(id: number): CarKind {
  if (id % 31 === 7) return "police";
  if (id % 5 === 0) return "cab";
  if (id % 7 === 3) return "van";
  if (id % 7 === 5) return "pickup";
  if (id % 11 === 4) return "coupe";
  return "sedan";
}
/** Body colour drawCar uses for a car id (driving-scene.ts matches the cockpit to it). */
export const carColor = (id: number): RGB => { const kind = carKind(id); return kind === "cab" ? CAB_COLOR : kind === "police" ? POLICE_COLOR : CAR_COLORS[id % CAR_COLORS.length]; };
export interface ActivityView { x: number; z: number; yaw: number; height: number; time: number; signalTime?: number; rain: boolean; low: boolean; visible?: (x: number, y: number, z: number, radius?: number) => boolean }
export interface ActivityCounts { cars: number; residents: number }

/** `motion` (optional): traffic passes its speed and queue state; without it the VFX estimate speed from movement.
 * `time` (optional, the scene clock) runs police light bars; without it they stay dark. */
export function drawCar(t: PropCanvas, x: number, y: number, z: number, yaw: number, id: number, detail: boolean, hover = false, motion?: { speed: number; queued?: boolean }, time?: number): void {
  t.push(); t.translate(x, -y, z); t.rotateY(-yaw * 180 / Math.PI);
  const kind = carKind(id), body = carColor(id);
  // Local frame: x right, y up, -z forward (headlights at z = -3). Every body keeps the footprint.
  ink(t, body, "=", 0.7);
  cuboid(t, 0, 0.8, 0, 2.7, 1.25, 5.8);
  if (kind === "van") {
    // A tall cargo box behind a short glazed cab.
    ink(t, body, "#", 0.62); cuboid(t, 0, 1.95, 0.95, 2.6, 1.7, 3.8);
    ink(t, [61, 139, 165], "X", 0.75); cuboid(t, 0, 1.75, -1.35, 2.3, 0.8, 0.8);
    if (detail) { ink(t, CAR_COLORS[(id >> 3) % CAR_COLORS.length], "=", 1.05); for (const s of [-1, 1]) cuboid(t, s * 1.31, 2.1, 0.95, 0.03, 0.22, 3.2); }
  } else if (kind === "pickup") {
    // Cab forward, a flatbed with rails and a tarp-covered load behind.
    ink(t, [61, 139, 165], "X", 0.75); cuboid(t, 0, 1.65, -0.75, 2.3, 0.9, 2.0);
    ink(t, body, "|", 0.6); for (const s of [-1, 1]) cuboid(t, s * 1.28, 1.6, 1.7, 0.1, 0.35, 2.6);
    ink(t, [112, 104, 84], "%"); cuboid(t, 0, 1.8, 1.75, 2.0, 0.75, 1.9);
  } else if (kind === "coupe") {
    // A low glasshouse, a rear wing and (on some) a coloured underglow.
    ink(t, [61, 139, 165], "X", 0.75); cuboid(t, 0, 1.55, 0.45, 2.2, 0.65, 2.2);
    ink(t, body, "-", 0.8); cuboid(t, 0, 1.75, 2.7, 2.45, 0.08, 0.35);
    if (!hover && id % 22 === 4) { ink(t, CAR_COLORS[(id >> 2) % CAR_COLORS.length], "=", 1.25); cuboid(t, 0, 0.14, 0, 2.2, 0.05, 4.8); }
  } else {
    ink(t, [61, 139, 165], "X", 0.75);
    cuboid(t, 0, 1.65, 0.25, 2.3, 0.9, 2.6);
  }
  ink(t, [241, 242, 187], "@", 1.2);
  for (const side of [-1, 1]) cuboid(t, side * 0.88, 0.9, -3, 0.65, 0.35, 0.18);
  ink(t, [255, 51, 103], "=", 1.2);
  cuboid(t, 0, 1, 3, 2.3, 0.24, 0.15);
  if (kind === "cab") {
    ink(t, [255, 203, 82], "+"); cuboid(t, 0, 2.3, 0.2, 1, 0.35, 0.7);
    if (detail) { ink(t, [30, 30, 34], "#"); for (const s of [-1, 1]) for (let k = 0; k < 6; k += 2) cuboid(t, s * 1.36, 1.15, -1.5 + k * 0.6, 0.03, 0.2, 0.6); }
  } else if (kind === "police") {
    // White doors and a light bar whose red and blue halves swell alternately (0.8 Hz, smooth: no strobe).
    ink(t, [214, 220, 226], "=", 0.8); for (const s of [-1, 1]) cuboid(t, s * 1.36, 0.95, 0.1, 0.03, 0.55, 2.4);
    const swell = time === undefined ? 0 : Math.sin(time * 5);
    ink(t, [255, 60, 70], "=", 0.45 + 0.75 * Math.max(0, swell)); cuboid(t, -0.4, 2.18, 0.2, 0.72, 0.18, 0.4);
    ink(t, [70, 120, 255], "=", 0.45 + 0.75 * Math.max(0, -swell)); cuboid(t, 0.4, 2.18, 0.2, 0.72, 0.18, 0.4);
  }
  if (detail && !hover) {
    // Number plates front and back.
    ink(t, [226, 228, 214], "#", 0.8); for (const s of [-1, 1]) cuboid(t, 0, 0.6, s * 2.92, 0.62, 0.17, 0.03);
  }
  // VFX: spinners hover on a cyan underglow strip, bright enough to bloom (read from below).
  if (hover) { ink(t, [70, 226, 255], "=", 1.25); cuboid(t, 0, 0.12, 0.2, 2.0, 0.07, 4.2); }
  if (detail) {
    const outer = propRange(140);
    ink(t, [40, 48, 60], "O"); // tyres: light enough to read against the wet road from a chase camera
    drawVehicleTyres(t);
    // Headlight beams are real light now (projected by the material from the car list).
    restorePropRange(outer);
  }
  t.pop();
  if (!hover) carFx(x, y, z, yaw, id, detail, motion?.speed ?? null, motion?.queued); // VFX: spinning wheels + brake lights
}

export function drawActivity(t: PropCanvas, view: ActivityView, vehicles: readonly Vehicle[], citizens: readonly Citizen[]): ActivityCounts {
  const { x, z, time, low } = view;
  const counts = { cars: vehicles.length, residents: citizens.length };
  const inRange = (px: number, pz: number, distance: number) => Math.hypot(px - x, pz - z) < distance;
  const outer = propRange(low ? 160 : 280);
  for (const car of vehicles) {
    if (view.visible && !view.visible(car.x, 2, car.z, 2.5)) continue;
    drawCar(t, car.x, 0, car.z, car.yaw, car.id, inRange(car.x, car.z, 140), false, { speed: car.speed, queued: car.waiting }, time);
  }
  propRange(low ? 110 : 220);
  for (const person of citizens) {
    if (view.visible && !view.visible(person.x, person.y + 2.5, person.z)) continue;
    drawCitizen(t, person, time, inRange(person.x, person.z, low ? 28 : 48), view.rain);
  }
  const bx = Math.floor(x / 64), bz = Math.floor(z / 64);
  for (let iz = bz - 2; iz <= bz + 2; iz++) for (let ix = bx - 2; ix <= bx + 2; ix++) {
    if (Math.abs(ix) > LAMP_STREETS || Math.abs(iz) > LAMP_STREETS) continue;
    // Post on the pavement behind the kerb, head over the kerb (streetLamp in world.ts).
    const lamp = streetLamp(ix, iz), lx = lamp.postX, lz = lamp.z;
    if (!inRange(lx, lz, 220)) continue;
    if (view.visible && !view.visible(lx, LAMP_HEAD_HEIGHT, lz)) continue;
    propRange(220);
    ink(t, [53, 83, 105], "|");
    // Prefiltered: the post is never thinner than about a cell, so it does not break up into dashes.
    const post = Math.max(0.22, Math.hypot(lx - x, lz - z) * LINE_PER_METRE);
    cuboid(t, lx, LAMP_HEAD_HEIGHT / 2, lz, post, LAMP_HEAD_HEIGHT, post);
    ink(t, [252, 199, 121], "=");
    cuboid(t, lamp.x, LAMP_HEAD_HEIGHT, lz, 2.5, 0.3, 0.7);
    // Rootwood Park: the four crossings inside it are promenade plazas. Their lamps stay (lit by
    // the engine, mirrored by the material's lamp haze) as park lamp standards: no signal head,
    // no steam vent, a warm lantern cap and a dark-green post.
    if (inPark(lx, lz)) {
      ink(t, [212, 168, 104], "o"); cuboid(t, lamp.x, LAMP_HEAD_HEIGHT + 0.45, lz, 0.9, 0.6, 0.9);
      ink(t, [40, 58, 50], "#"); cuboid(t, lx, 0.5, lz, 0.6, 1, 0.6);
      continue;
    }
    // Signal heads for both streets (red / amber / green), walk signals and sign blades (street-life.ts).
    drawSignalPost(t, lamp, view.signalTime ?? time, Math.hypot(lx - x, lz - z), STREET_KIT);
    // Steam escaping street vents: a volumetric plume drawn by the VFX pass (vfx-scene.ts).
    if (!low && inRange(lx, lz, 100)) ventSteam(ix * 64 + 9.3, iz * 64 + 11, randomFor(ix, iz));
  }
  // Alley and street cables with lanterns, laundry and banners; drones; rats (street-life.ts).
  drawStreetLife(t, view, STREET_KIT);
  // Landmarks: instanced structure, detail tiered by distance (landmarks-scene.ts). Fog reaches the
  // sky colour at the draw distance (11 blocks on desktop, 5 on reduced profiles, more with height).
  setLandmarkEye(x, z);
  propRange(0);
  const landmarkReach = (low ? 380 : 740) + view.height * 1.6;
  for (const landmark of LANDMARKS) {
    const distance = Math.hypot(landmark.x - x, landmark.z - z);
    if (distance < landmarkReach) drawLandmarkStructure(t, landmark, time, landmarkDetail(distance), ink, distance * LINE_PER_METRE);
  }
  // High traffic lanes remain visible between the towers, including from sky taxis.
  propRange(500);
  for (let i = 0; i < 12; i++) {
    const px = wrap(time * (18 + i) + i * 139, 1500) - 750;
    const pz = Math.round(z / 128) * 128 + ((i % 5) - 2) * 128;
    if (!inRange(px, pz, 500)) continue;
    drawCar(t, px, 68 + (i % 3) * 18, pz, Math.PI / 2, i, false, true, undefined, time);
    skyTrail(t, px, 68 + (i % 3) * 18, pz, i); // VFX: tail-light streaks
  }
  restorePropRange(outer);
  return counts;
}
