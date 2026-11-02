import type { PropCanvas } from "./prop-canvas.ts";
import { wrap } from "./locomotion.ts";
import type { Citizen } from "./people.ts";
import { TRAFFIC_ID_BASE, carKind, longKind, type CarKind, type Vehicle } from "./traffic.ts";
import { drawCitizen } from "./people-scene.ts";
import { LANDMARKS, LAMP_HEAD_HEIGHT, LAMP_STREETS, districtAt, inPark, randomFor, streetLamp, type RGB } from "./world.ts";
import { BUS_STOPS, TAXI_RANK, setRoadWetness } from "./driving.ts";
// VFX: wheels, brake lights, steam, sky trails (vfx-scene.ts).
import { carFx, skyTrail, ventSteam } from "./vfx-scene.ts";
import { drawVehicleHubs, drawVehicleTyres, drawWheelSet } from "./vehicle-wheels.ts";
import { KIT_MID, KIT_NEAR, cellMetres, cellText, drawTramKit, drawVehicleKit, type TramKitState, type VehicleKitScene, type VehicleKitState } from "./vehicle-kit.ts";
import { TRAM_HALF_WIDTH, TRAM_JOINT, TRAM_LEG, TRAM_LENGTH, TRAM_PLATFORM_HALF, TRAM_SECTION_LENGTH, TRAM_STOPS, TRAM_TRACK_X, isTramVehicle, type TramView } from "./tram.ts";
import { ewStreet } from "./streets.ts";
import { rainIntensity } from "./weather.ts";
export { carKind, type CarKind } from "./traffic.ts";
import { LINE_PER_METRE, drawLandmarkStructure, landmarkDetail, setLandmarkEye } from "./landmarks-scene.ts";
import { drawSignalPost, drawStreetLife, type StreetKit } from "./street-life.ts";

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
/** Brightness scale of everything inked next (1 but while a sky craft fades out at its lane's wrap). */
let inkFade = 1;
export function ink(t: PropCanvas, color: RGB, glyph = "#", gain = 1): void {
  const g = gain * inkFade, paper = 0.12 * inkFade;
  t.char(glyph); t.charColor(color[0] * g, color[1] * g, color[2] * g);
  t.cellColor(color[0] * paper, color[1] * paper, color[2] * paper, rangeCode);
}
/** Street life (street-life.ts) paints and sets draw distances through these. */
const STREET_KIT: StreetKit = { paint: ink, range: propRange, restore: restorePropRange };
const CAR_COLORS: readonly RGB[] = [[243, 155, 53], [46, 152, 184], [181, 72, 132], [129, 158, 150], [131, 107, 189], [176, 182, 188], [58, 68, 92], [172, 58, 50]];
const CAB_COLOR: RGB = [243, 155, 53], POLICE_COLOR: RGB = [40, 50, 70];
const GLASS: RGB = [61, 139, 165], HEADLIGHT: RGB = [241, 242, 187], TAIL: RGB = [255, 51, 103], AMBER: RGB = [255, 168, 56], TYRE: RGB = [40, 48, 60];
const BUS_LIVERY: readonly RGB[] = [[46, 152, 184], [214, 120, 40], [96, 196, 140]], BUS_DOORWAY: RGB = [255, 228, 170];
const KIND_COLOR: Partial<Record<CarKind, RGB>> = { corpsec: [56, 62, 74], ambulance: [214, 220, 226], sweeper: [236, 176, 64], wreck: [96, 78, 64], tanker: [176, 182, 188], tuktuk: [66, 200, 210], tram: [214, 64, 132] };
/** Traffic ids carry their kind in the low four bits; the rest picks the paint. */
const paintIndex = (id: number): number => id >= TRAFFIC_ID_BASE ? id >> 4 : id;
/** Body colour drawCar uses for a car id (driving-scene.ts matches the cockpit to it). */
export const carColor = (id: number): RGB => {
  const kind = carKind(id), n = paintIndex(id);
  if (kind === "cab") return CAB_COLOR;
  if (kind === "police") return POLICE_COLOR;
  if (kind === "bus") return BUS_LIVERY[n % BUS_LIVERY.length];
  if (kind === "tuktuk") return n % 3 === 0 ? [236, 72, 150] : n % 3 === 1 ? [250, 206, 70] : [66, 200, 210];
  return KIND_COLOR[kind] ?? CAR_COLORS[n % CAR_COLORS.length];
};
/** Close-range body kit (vehicle-kit.ts): drawActivity sets the eye and weather each frame; drawCar
 * adds the kit to cars within KIT_MID of the eye (beyond it the plain boxes stay as they are). */
const VEHICLE_KIT: VehicleKitScene = { paint: ink, range: propRange, restore: restorePropRange };
const KIT_STATE: VehicleKitState = { distance: Infinity, time: 0, rain: false, neon: [255, 71, 148], occupied: false, beams: 0, doors: false, variant: 0 };
const NEON_ALT: readonly RGB[] = [[255, 71, 148], [66, 223, 227], [133, 155, 255]];
let kitEyeX = 0, kitEyeZ = 0, kitRain = false;
function vehicleKit(t: PropCanvas, x: number, z: number, id: number, kind: CarKind, body: RGB, motion: CarMotionState | undefined, time: number | undefined): void {
  const distance = Math.hypot(x - kitEyeX, z - kitEyeZ);
  if (distance >= KIT_MID) return;
  const n = paintIndex(id), s = KIT_STATE;
  s.distance = distance; s.time = time ?? 0; s.rain = kitRain; s.occupied = motion !== undefined; s.variant = n;
  // Pools ease in with speed (no brightness step as a car pulls away or stops).
  s.beams = motion ? Math.min(1, Math.abs(motion.speed) / 4) : 0; s.door = doorOpen(motion); s.doors = s.door > 0;
  if (distance < KIT_NEAR) {
    // Shoulder highlight: the district's neon on alternate blocks, a cyan/pink/violet sign tone between.
    const bx = Math.floor(x / 64), bz = Math.floor(z / 64);
    s.neon = (bx + bz) & 1 ? districtAt(x, z).color : NEON_ALT[(((bx * 3 + bz * 5) % 3) + 3) % 3];
  }
  drawVehicleKit(t, VEHICLE_KIT, kind, id, body, s);
}
/** Indicator and hazard pulse rate (Hz): at the comfort ceiling (nothing brightens faster than 0.4 Hz). */
export const SIGNAL_RATE = 0.4;
/** Lamp gain of an indicator or hazard at `time`: a raised cosine between 0.55 and 1.15 (a soft
 * swell, never dark-to-bright), phased per car so a queue does not pulse in step. */
export function signalGain(time: number, id: number): number {
  const pulse = 0.5 - 0.5 * Math.cos(2 * Math.PI * SIGNAL_RATE * time + (id & 7) * 0.785);
  return 0.55 + 0.6 * pulse;
}
/** Lamp signals in amber: indicators and hazards (signalGain). */
function signalLamps(t: PropCanvas, signal: number, time: number, id: number, half: number, y: number, front: number, rear: number): void {
  ink(t, AMBER, "o", signalGain(time, id));
  for (const side of signal === 3 ? [-1, 1] : [-1]) { cuboid(t, side * half, y, front, 0.3, 0.2, 0.1); cuboid(t, side * half, y, rear, 0.3, 0.2, 0.1); }
}
/** `reach` (LOD, default 1): scales the draw ranges of cars, people, lamps and street life with the
 *  cell footprint (engine.ts propReach), so they dissolve at about the same size on screen. */
export interface ActivityView { x: number; z: number; yaw: number; height: number; time: number; signalTime?: number; rain: boolean; low: boolean; reach?: number; visible?: (x: number, y: number, z: number, radius?: number) => boolean }
export interface ActivityCounts { cars: number; residents: number }

/** Traffic state drawCar reads: speed and queueing (brake lights), lamp signals, bus doors. */
export interface CarMotionState { speed: number; queued?: boolean; signal?: number; doors?: boolean; /** Bus doors 0..1, eased (traffic.ts busDoorOpen); falls back to `doors`. */ door?: number }
/** Bus door opening 0..1 from the traffic state (eased there; a bare `doors` flag counts as open). */
const doorOpen = (motion: CarMotionState | undefined): number => motion?.door ?? (motion?.doors ? 1 : 0);
/** `motion` (optional): traffic passes its speed and queue state; without it the VFX estimate speed from movement.
 * `time` (optional, the scene clock) runs light bars and lamp signals; without it they stay dark. */
export function drawCar(t: PropCanvas, x: number, y: number, z: number, yaw: number, id: number, detail: boolean, hover = false, motion?: CarMotionState, time?: number): void {
  t.push(); t.translate(x, -y, z); t.rotateY(-yaw * 180 / Math.PI);
  const kind = carKind(id), body = carColor(id), signal = time === undefined ? 0 : motion?.signal ?? 0;
  // Local frame: x right, y up, -z forward (headlights at z = -3). Every body keeps the footprint;
  // buses, trucks and tankers run 5.8 m further back (a second footprint, traffic.ts TRAILING).
  if (!hover && kind !== "sedan" && kind !== "cab" && kind !== "van" && kind !== "pickup" && kind !== "coupe" && kind !== "police") {
    drawSpecialBody(t, kind, id, body, detail, doorOpen(motion), time ?? 0, signal);
    vehicleKit(t, x, z, id, kind, body, motion, time);
    t.pop();
    carFx(x, y, z, yaw, id, detail, motion?.speed ?? null, motion?.queued);
    return;
  }
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
    // White doors and a light bar whose red and blue halves swell alternately (0.38 Hz, smooth: no strobe).
    ink(t, [214, 220, 226], "=", 0.8); for (const s of [-1, 1]) cuboid(t, s * 1.36, 0.95, 0.1, 0.03, 0.55, 2.4);
    const swell = time === undefined ? 0 : Math.sin(time * 2.4);
    ink(t, [255, 60, 70], "=", 0.45 + 0.75 * Math.max(0, swell)); cuboid(t, -0.4, 2.18, 0.2, 0.72, 0.18, 0.4);
    ink(t, [70, 120, 255], "=", 0.45 + 0.75 * Math.max(0, -swell)); cuboid(t, 0.4, 2.18, 0.2, 0.72, 0.18, 0.4);
  }
  if (detail && !hover) {
    // Number plates front and back.
    ink(t, [226, 228, 214], "#", 0.8); for (const s of [-1, 1]) cuboid(t, 0, 0.6, s * 2.92, 0.62, 0.17, 0.03);
  }
  if (signal) signalLamps(t, signal, time ?? 0, id, 1.2, 0.95, -3.0, 3.0);
  // VFX: spinners hover on a cyan underglow strip, bright enough to bloom (read from below).
  if (hover) { ink(t, [70, 226, 255], "=", 1.25); cuboid(t, 0, 0.12, 0.2, 2.0, 0.07, 4.2); }
  if (detail) {
    const outer = propRange(140);
    ink(t, [40, 48, 60], "O"); // tyres: light enough to read against the wet road from a chase camera
    drawVehicleTyres(t);
    drawVehicleHubs(t); // hub caps: own ink, shorter draw distance (vehicle-wheels.ts)
    // Headlight beams are real light now (projected by the material from the car list).
    restorePropRange(outer);
  }
  if (!hover) vehicleKit(t, x, z, id, kind, body, motion, time);
  t.pop();
  if (!hover) carFx(x, y, z, yaw, id, detail, motion?.speed ?? null, motion?.queued); // VFX: spinning wheels + brake lights
}

/** Bodies beyond the original six, in the car's local frame (drawCar). Each stays inside its
 * footprint (two footprints for buses, trucks and tankers) and costs about as much as a car. */
function drawSpecialBody(t: PropCanvas, kind: CarKind, id: number, body: RGB, detail: boolean, door: number, time: number, signal: number): void {
  const n = paintIndex(id);
  // Lamp corners for indicators and hazards: half width, height, front and rear.
  let half = 1.2, lampY = 0.95, front = -3.0, rear = 3.0;
  if (kind === "bus") {
    // A long single-decker: lit saloon windows, route boards front and back, doors on the kerb side.
    ink(t, body, "=", 0.72); cuboid(t, 0, 1.75, 2.85, 2.7, 2.9, 11.6);
    ink(t, [255, 212, 150], "=", 0.95); for (const s of [-1, 1]) cuboid(t, s * 1.36, 2.3, 3.4, 0.03, 0.85, 9.2);
    ink(t, GLASS, "X", 0.8); cuboid(t, 0, 2.15, -3.0, 2.45, 1.3, 0.05);
    ink(t, [255, 184, 60], String(1 + n % 9), 1.25); cuboid(t, 0, 2.98, -3.03, 1.9, 0.34, 0.05); cuboid(t, 0, 2.98, 8.73, 1.3, 0.3, 0.05);
    ink(t, body, "-", 0.5); cuboid(t, 0, 3.27, 3.6, 2.1, 0.14, 5.5);
    if (door > 0.005) {
      // The doorway light swells in from the body's own tone as the doors open (eased in traffic.ts),
      // so nothing steps when they start to part; the kit (vehicle-kit.ts) slides the leaves.
      const lit = BUS_DOORWAY, k = 0.72 + (1.2 - 0.72) * door;
      ink(t, [body[0] + (lit[0] - body[0]) * door, body[1] + (lit[1] - body[1]) * door, body[2] + (lit[2] - body[2]) * door], door < 0.4 ? "=" : "#", k);
      for (const dz of [-1.75, 3.7]) cuboid(t, -1.37, 1.5, dz, 0.04, 2.1, 1.15);
    }
    lights(t, -3.03, 8.73, 0.95, 0.75);
    if (detail) wheels(t, [-1.55, 6.3], 1.2, 0.48);
    lampY = 0.75; rear = 8.73;
  } else if (kind === "truck" || kind === "tanker") {
    // Cab forward over a long chassis: a box body, or a round tank with a walkway and a hazard placard.
    ink(t, kind === "tanker" ? CAR_COLORS[n % CAR_COLORS.length] : body, "=", 0.72); cuboid(t, 0, 1.55, -1.85, 2.6, 2.3, 2.3);
    ink(t, GLASS, "X", 0.8); cuboid(t, 0, 2.1, -3.02, 2.3, 0.8, 0.05);
    ink(t, [44, 48, 56], "#"); cuboid(t, 0, 0.62, 3.1, 2.3, 0.45, 11.2);
    if (kind === "truck") {
      ink(t, [190, 194, 200], "#", 0.62); cuboid(t, 0, 2.15, 4.0, 2.7, 2.9, 9.3);
      ink(t, CAR_COLORS[(n >> 1) % CAR_COLORS.length], "=", 1.0); for (const s of [-1, 1]) cuboid(t, s * 1.36, 1.55, 4.0, 0.03, 0.3, 8.4);
    } else {
      ink(t, body, "O", 0.72); t.translate(0, -2.05, 4.1); t.ellipsoid(1.3, 1.12, 4.55); t.translate(0, 2.05, -4.1);
      ink(t, [60, 64, 72], "-"); cuboid(t, 0, 3.22, 4.1, 0.5, 0.06, 7.5);
      ink(t, AMBER, "#", 1.0); cuboid(t, 0, 2.0, 8.66, 0.55, 0.55, 0.04);
    }
    lights(t, -3.04, 8.7, 0.95, 0.8);
    if (detail) wheels(t, [-1.8, 5.0, 6.6], 1.2, 0.5);
    rear = 8.7;
  } else if (kind === "moto" || kind === "scooter") {
    // A narrow machine and its rider, centred in the footprint.
    const scooter = kind === "scooter";
    ink(t, body, "=", 0.82); cuboid(t, 0, 0.72, 0, 0.32, 0.42, scooter ? 1.5 : 1.9);
    if (scooter) {
      cuboid(t, 0, 0.95, -0.68, 0.5, 0.85, 0.12);
      ink(t, n % 2 ? [66, 223, 227] : [255, 71, 148], "#", 0.95); cuboid(t, 0, 1.35, 0.8, 0.55, 0.5, 0.5);
    } else {
      cuboid(t, 0, 1.02, -0.2, 0.42, 0.28, 0.7);
      ink(t, GLASS, "X", 0.9); cuboid(t, 0, 1.28, -0.78, 0.38, 0.28, 0.08);
    }
    ink(t, [34, 38, 48], "#"); cuboid(t, 0, 1.42, scooter ? 0.15 : 0.2, 0.5, 0.75, 0.4);
    ink(t, CAR_COLORS[(n >> 2) % CAR_COLORS.length], "=", 0.9); cuboid(t, 0, 1.97, 0.12, 0.34, 0.34, 0.36);
    ink(t, [120, 230, 255], "=", 1.1); cuboid(t, 0, 1.99, -0.07, 0.28, 0.11, 0.03);
    ink(t, HEADLIGHT, "@", 1.2); cuboid(t, 0, 1.05, -1.0, 0.22, 0.18, 0.08);
    ink(t, TAIL, "=", 1.2); cuboid(t, 0, 0.98, scooter ? 1.08 : 0.98, 0.22, 0.12, 0.06);
    ink(t, TYRE, "O"); drawWheelSet(t, [-0.75, 0.75], 0, 0.32, 0.07);
    half = 0.3; lampY = 1.05; front = -0.95; rear = 1.0;
  } else if (kind === "tuktuk") {
    // A three-wheeler: open tub, bench, a striped canopy hung with warm string lights.
    ink(t, [40, 44, 52], "#"); cuboid(t, 0, 0.62, 0.3, 1.5, 0.5, 2.6);
    ink(t, body, "=", 0.82); cuboid(t, 0, 1.0, -1.1, 0.9, 0.9, 0.5); cuboid(t, 0, 0.95, 0.95, 1.55, 0.7, 1.2);
    ink(t, body, "#", 0.66); cuboid(t, 0, 2.05, 0.25, 1.68, 0.12, 2.6);
    ink(t, [30, 32, 38], "|"); for (const s of [-1, 1]) for (const dz of [-0.95, 1.45]) cuboid(t, s * 0.78, 1.5, dz, 0.06, 1.0, 0.06);
    ink(t, [255, 196, 96], "o", 1.15); for (const dz of [-1.04, 1.54]) cuboid(t, 0, 1.94, dz, 1.6, 0.06, 0.06);
    ink(t, HEADLIGHT, "@", 1.2); cuboid(t, 0, 1.25, -1.37, 0.25, 0.2, 0.08);
    lights(t, Infinity, 1.62, 0.8, 0.55);
    ink(t, TYRE, "O"); drawWheelSet(t, [-1.25], 0, 0.28, 0.08); drawWheelSet(t, [0.95], 0.72, 0.3, 0.08);
    half = 0.72; lampY = 0.8; front = -1.4; rear = 1.62;
  } else if (kind === "sweeper") {
    // A street-cleaning machine: low cab, hopper, front brushes, an amber beacon and a wet trail.
    ink(t, body, "=", 0.75); cuboid(t, 0, 1.15, 0.6, 2.4, 1.7, 4.4); cuboid(t, 0, 0.85, -2.2, 2.2, 1.1, 1.2);
    ink(t, GLASS, "X", 0.8); cuboid(t, 0, 1.75, -1.7, 2.0, 0.9, 0.9);
    ink(t, [150, 150, 140], "*", 0.9); for (const s of [-1, 1]) cuboid(t, s * 0.95, 0.22, -2.65, 0.7, 0.42, 0.7);
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4); // 0.38 Hz
    ink(t, AMBER, "o", 0.4 + 0.9 * pulse * pulse); cuboid(t, 0, 2.15, -0.6, 0.35, 0.25, 0.35);
    ink(t, [60, 96, 130], "~", 0.85); cuboid(t, 0, 0.03, 4.4, 2.2, 0.02, 3.0);
    lights(t, -2.82, 2.82, 0.9, 0.7);
    if (detail) { ink(t, TYRE, "O"); drawVehicleTyres(t); }
    front = -2.82;
  } else {
    // Car-bodied specials: CorpSec armour, the ambulance, the abandoned wreck.
    ink(t, body, kind === "wreck" ? "%" : "=", kind === "wreck" ? 0.5 : 0.7); cuboid(t, 0, 0.8, 0, 2.7, 1.25, 5.8);
    if (kind === "corpsec") {
      ink(t, body, "#", 0.66); cuboid(t, 0, 1.95, 0.35, 2.66, 1.7, 4.9);
      ink(t, [90, 200, 255], "-", 1.0); cuboid(t, 0, 2.3, -2.12, 2.2, 0.16, 0.05);
      ink(t, [255, 71, 148], "=", 1.15); for (const s of [-1, 1]) cuboid(t, s * 1.345, 1.55, 0.3, 0.03, 0.1, 4.6);
      ink(t, [30, 32, 38], "#"); cuboid(t, 0, 0.75, -3.02, 2.4, 0.45, 0.2);
      const swell = Math.sin(time * 2.4); // 0.38 Hz
      ink(t, [190, 90, 255], "=", 0.4 + 0.8 * Math.max(0, swell)); cuboid(t, 0, 2.86, 0.2, 0.9, 0.14, 0.35);
    } else if (kind === "ambulance") {
      ink(t, body, "#", 0.72); cuboid(t, 0, 1.95, 0.95, 2.66, 1.75, 3.9);
      ink(t, GLASS, "X", 0.75); cuboid(t, 0, 1.75, -1.35, 2.3, 0.8, 0.8);
      ink(t, [235, 52, 60], "=", 1.0); for (const s of [-1, 1]) cuboid(t, s * 1.345, 1.45, 0.4, 0.03, 0.18, 5.0);
      ink(t, [235, 52, 60], "+", 1.1); for (const s of [-1, 1]) cuboid(t, s * 1.35, 2.2, 1.4, 0.03, 0.7, 0.7);
      // Red and white halves swell alternately at 0.38 Hz: slow, smooth, never a strobe.
      const swell = Math.sin(time * 2.4);
      ink(t, [255, 60, 70], "=", 0.45 + 0.75 * Math.max(0, swell)); cuboid(t, -0.45, 2.9, -0.85, 0.8, 0.16, 0.35);
      ink(t, [235, 240, 255], "=", 0.45 + 0.75 * Math.max(0, -swell)); cuboid(t, 0.45, 2.9, -0.85, 0.8, 0.16, 0.35);
    } else {
      ink(t, [34, 40, 46], "/", 0.7); cuboid(t, 0.15, 1.45, 0.5, 2.1, 0.55, 2.3);
      ink(t, body, "%", 0.45); cuboid(t, 0, 1.52, -2.25, 2.3, 0.08, 1.1);
      ink(t, [140, 76, 40], "%", 0.6); cuboid(t, -1.36, 0.7, 1.3, 0.03, 0.5, 1.6);
    }
    if (kind !== "wreck") lights(t, -3, 3, 0.9, 1.0);
    if (detail) { ink(t, TYRE, "O"); drawVehicleTyres(t); if (kind !== "wreck") drawVehicleHubs(t); }
  }
  if (signal) signalLamps(t, signal, time, id, half, lampY, front, rear);
}
/** Paired headlights at `front` (skipped when not finite) and a tail-light bar at `rear`. */
function lights(t: PropCanvas, front: number, rear: number, y: number, spread: number): void {
  if (Number.isFinite(front)) { ink(t, HEADLIGHT, "@", 1.2); for (const side of [-1, 1]) cuboid(t, side * spread, y, front, 0.55, 0.32, 0.12); }
  ink(t, TAIL, "=", 1.2); cuboid(t, 0, y + 0.1, rear, spread * 2 + 0.5, 0.22, 0.12);
}
function wheels(t: PropCanvas, axles: readonly number[], lateral: number, radius: number): void {
  const outer = propRange(140);
  ink(t, TYRE, "O"); drawWheelSet(t, axles, lateral, radius, 0.16);
  restorePropRange(outer);
}

/** Bus shelters at every berth on the routes (driving.ts BUS_STOPS): a lit roof, a route totem and a bench. */
function drawBusStops(t: PropCanvas, x: number, z: number, reach: number, visible: ActivityView["visible"]): void {
  for (const stop of BUS_STOPS) {
    if (Math.abs(stop.x - x) > reach || Math.abs(stop.z - z) > reach) continue;
    if (visible && !visible(stop.x, 1.5, stop.z, 3)) continue;
    const alongX = stop.axis === "x", w = alongX ? 3.6 : 1.4, d = alongX ? 1.4 : 3.6, back = stop.side * 0.6;
    const bx = stop.x + (alongX ? 0 : back), bz = stop.z + (alongX ? back : 0);
    ink(t, [48, 60, 72], "|"); cuboid(t, alongX ? bx - 1.7 : bx, 1.2, alongX ? bz : bz - 1.7, 0.1, 2.4, 0.1); cuboid(t, alongX ? bx + 1.7 : bx, 1.2, alongX ? bz : bz + 1.7, 0.1, 2.4, 0.1);
    ink(t, [120, 200, 220], "/", 0.45); cuboid(t, bx, 1.3, bz, alongX ? w : 0.05, 1.8, alongX ? 0.05 : d);
    ink(t, [255, 214, 150], "=", 1.05); cuboid(t, stop.x, 2.5, stop.z, w + 0.3, 0.12, d + 0.3);
    ink(t, [70, 74, 82], "="); cuboid(t, bx - (alongX ? 0 : stop.side * 0.35), 0.5, bz - (alongX ? stop.side * 0.35 : 0), alongX ? 2.4 : 0.4, 0.12, alongX ? 0.4 : 2.4);
    const tx = stop.x + (alongX ? 4.5 * stop.direction : 0), tz = stop.z + (alongX ? 0 : 4.5 * stop.direction);
    ink(t, [255, 184, 60], "B", 1.15); cuboid(t, tx, 2.0, tz, 0.5, 0.6, 0.5);
    ink(t, [48, 60, 72], "|"); cuboid(t, tx, 0.85, tz, 0.08, 1.7, 0.08);
  }
}

/** Meridian Avenue trams (tram.ts): silver over a magenta lower body, a lit saloon band, cabs at
 * both ends. Far: three boxes per section plus lamps. Within 140 m: skirt, bellows, roof pods and
 * the pantograph (with a soft spark glow now and then); within 70 m the doors; within KIT_MID the
 * kit (vehicle-kit.ts drawTramKit: window posts, boards, passengers). */
const TRAM_BODY: RGB = [192, 198, 204], TRAM_LOWER: RGB = [214, 64, 132], TRAM_SKIRT: RGB = [36, 40, 48], TRAM_WINDOW: RGB = [255, 214, 158];
const TRAM_SIGN: RGB = [80, 220, 200], TRAM_STEEL: RGB = [78, 84, 96];
const tramTerminus = (z: number): string => "T1 " + ewStreet(z).name.toUpperCase().replace(/ (STREET|ROW|LINE|LANE|ROAD)$/, "");
const TRAM_DESTINATIONS = { north: tramTerminus(-640), south: tramTerminus(640) };
const TRAM_STOP_NAMES: readonly string[] = TRAM_STOPS.map(stop => "T1 " + ewStreet(stop.block * TRAM_LEG).name.toUpperCase());
const TRAM_KIT: TramKitState = { distance: Infinity, time: 0, rain: false, section: 0, sections: 3, length: TRAM_SECTION_LENGTH, destination: "", serial: 0 };
function drawTram(t: PropCanvas, tram: TramView, view: ActivityView, reach: number): void {
  const middle = tram.sections[1], time = view.time;
  if (view.visible && !view.visible(middle.x, 2, middle.z, TRAM_LENGTH / 2 + 1)) return;
  const distance = Math.hypot(middle.x - view.x, middle.z - view.z), detail = distance < 140 * reach, doorsDrawn = distance < 70 * reach;
  const half = TRAM_SECTION_LENGTH / 2, last = tram.sections.length - 1;
  // Tail lamps brighten as it slows (eased with speed: no step when it stops).
  const tail = 0.85 + 0.45 * Math.max(0, 1 - tram.speed / 4);
  for (let k = 0; k <= last; k++) {
    const s = tram.sections[k];
    t.push(); t.translate(s.x, 0, s.z); t.rotateY(-s.yaw * 180 / Math.PI);
    ink(t, TRAM_LOWER, "=", 0.7); cuboid(t, 0, 1.15, 0, 2.6, 0.9, TRAM_SECTION_LENGTH);
    ink(t, TRAM_WINDOW, "=", 0.95); cuboid(t, 0, 2.25, 0, 2.64, 1.3, TRAM_SECTION_LENGTH - 0.5);
    ink(t, TRAM_BODY, "=", 0.62); cuboid(t, 0, 3.1, 0, 2.6, 0.4, TRAM_SECTION_LENGTH);
    // Cabs at both ends (double-ended): windscreen and board; headlights lead, tail lamps trail.
    for (const end of k === 0 && k === last ? [-1, 1] : k === 0 ? [-1] : k === last ? [1] : []) {
      const face = end * (half + 0.03);
      ink(t, GLASS, "X", 0.8); cuboid(t, 0, 2.25, face, 2.3, 1.2, 0.05);
      ink(t, [255, 184, 60], "T", 1.2); cuboid(t, 0, 3.0, face + end * 0.01, 1.8, 0.3, 0.05);
      if (end < 0) { ink(t, HEADLIGHT, "@", 1.2); for (const side of [-1, 1]) cuboid(t, side * 0.82, 0.95, face - 0.03, 0.5, 0.28, 0.1); }
      else { ink(t, TAIL, "=", tail); for (const side of [-1, 1]) cuboid(t, side * 0.82, 0.95, face + 0.03, 0.5, 0.24, 0.1); }
    }
    if (detail) {
      ink(t, TRAM_SKIRT, "#", 0.85); cuboid(t, 0, 0.42, 0, 2.5, 0.44, TRAM_SECTION_LENGTH - 0.3);
      if (k < last) { ink(t, [24, 26, 30], "#", 0.9); cuboid(t, 0, 1.8, half + TRAM_JOINT / 2, 2.3, 2.7, TRAM_JOINT + 0.1); }
      if (k === 1) {
        // Pantograph: a base on the roof, two arms meeting at the knee, the pan under the wire.
        ink(t, [140, 146, 156], "#", 0.75); cuboid(t, 0, 3.42, 0, 1.0, 0.25, 1.4);
        ink(t, [150, 156, 166], "|", 0.9);
        for (const [y, angle] of [[3.96, 30], [5.08, -30]] as const) { t.push(); t.translate(0, -y, 0); t.rotateX(angle); t.box(0.1, 1.3, 0.1); t.pop(); }
        ink(t, [170, 176, 186], "-", 0.95); cuboid(t, 0, 5.66, 0, 1.7, 0.08, 0.8);
      } else { ink(t, [140, 146, 156], "#", 0.75); cuboid(t, 0, 3.45, 0, 1.5, 0.3, 2.6); }
    }
    if (doorsDrawn) {
      // Two doors a side per section; the platform side (tram.doorSide) slides open at a stop.
      for (const dz of [-2.4, 2.4]) for (const side of [-1, 1]) {
        // tram.doors ramps linearly over 0.8 s (the timetable's fraction); the leaves ease (raised
        // cosine, the bus doors' curve) so they start and stop gently.
        const open = side === tram.doorSide ? 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, tram.doors))) : 0, leaf = 0.65 * (1 - open);
        if (open < 0.98) { ink(t, [26, 30, 36], "|", 1); for (const l of [-1, 1]) cuboid(t, side * 1.315, 1.45, dz + l * (0.65 - leaf / 2), 0.03, 2.2, leaf); }
        if (open > 0.02) { ink(t, [255, 228, 170], "#", 1.2); cuboid(t, side * 1.312, 1.45, dz, 0.035, 2.2, 1.3 * open); }
      }
    }
    const near = Math.hypot(s.x - view.x, s.z - view.z);
    if (near < KIT_MID) {
      const state = TRAM_KIT;
      state.distance = near; state.time = time; state.rain = view.rain; state.section = k; state.sections = last + 1;
      state.destination = tram.heading > 0 ? TRAM_DESTINATIONS.south : TRAM_DESTINATIONS.north; state.serial = tram.index;
      drawTramKit(t, VEHICLE_KIT, TRAM_BODY, state);
    }
    t.pop();
  }
  // A soft blue glow at the pan now and then while running: one smooth 2.4 s swell every 7 s,
  // never a flash (comfort: nothing pulses faster than 0.4 Hz).
  if (detail && tram.speed > 2) {
    const w = (((time + tram.index * 1.9) % 7) + 7) % 7 / 2.4;
    if (w < 1) {
      const glow = Math.sin(Math.PI * w) ** 2 * Math.min(1, (tram.speed - 2) / 4);
      ink(t, [170, 205, 255], "*", 1.4 * glow); cuboid(t, middle.x, 5.72, middle.z, 0.3, 0.3, 0.3);
      ink(t, [120, 160, 255], ".", 0.35 * glow); cuboid(t, middle.x, 5.72, middle.z, 1.1, 0.8, 1.1);
    }
  }
}

/** The Spire plaza taxi rank's sign (driving.ts TAXI_RANK): a cab-yellow board on a post at the
 * rank's head, TAXI in one-cell letters on both faces once it fits. */
function drawTaxiRank(t: PropCanvas, view: ActivityView, reach: number): void {
  const { x, z } = TAXI_RANK, distance = Math.hypot(x - view.x, z - view.z);
  if (distance > 160 * reach || (view.visible && !view.visible(x, 2, z, 2))) return;
  ink(t, [48, 60, 72], "|"); cuboid(t, x, 1.3, z, Math.max(0.1, distance * LINE_PER_METRE), 2.6, 0.1);
  ink(t, [255, 203, 82], "+", 1.1); cuboid(t, x, 2.85, z, 0.16, 0.6, 1.4);
  const cell = cellMetres(distance);
  if (4 * cell * 1.15 <= 1.3) for (const side of [-1, 1]) cellText(t, VEHICLE_KIT, "TAXI", [40, 30, 10], 1.1, cell, x + side * 0.09, 2.85, z, "z", -side, Math.min(cell, 0.4));
}

/** The tram line's fixed parts: island platforms with a lit shelter, a T totem and a name board;
 * centre poles with cantilever arms and the contact wires over both tracks (each wire segment at
 * least a cell thick at its distance, so it never breaks into dashes). */
function drawTramLine(t: PropCanvas, view: ActivityView, reach: number): void {
  const { x, z } = view, range = (view.low ? 120 : 200) * reach;
  if (Math.abs(x) > range) return;
  for (let i = 0; i < TRAM_STOPS.length; i++) {
    const stop = TRAM_STOPS[i];
    if (Math.abs(stop.z - z) > range + 15) continue;
    if (view.visible && !view.visible(0, 1.5, stop.z, 15)) continue;
    const distance = Math.hypot(x, stop.z - z), zc = stop.z, post = Math.max(0.12, distance * LINE_PER_METRE);
    ink(t, [74, 78, 86], "=", 0.9); cuboid(t, 0, 0.13, zc, TRAM_PLATFORM_HALF * 2, 0.26, stop.z1 - stop.z0 + 1);
    ink(t, [48, 60, 72], "|"); for (const dz of [-3.6, 3.6]) cuboid(t, 0, 1.53, zc + dz, post, 2.55, post);
    ink(t, [255, 214, 150], "=", 1.05); cuboid(t, 0, 2.85, zc, 1.8, 0.12, 8.4);
    ink(t, [120, 200, 220], "/", 0.45); cuboid(t, 0, 1.5, zc, 0.05, 1.8, 6.8);
    if (distance < 120 * reach) {
      ink(t, [70, 74, 82], "="); for (const side of [-1, 1]) cuboid(t, side * 0.45, 0.68, zc, 0.36, 0.1, 3.0);
      ink(t, [214, 170, 60], ":", 0.6); for (const side of [-1, 1]) cuboid(t, side * (TRAM_PLATFORM_HALF - 0.12), 0.265, zc, 0.22, 0.01, stop.z1 - stop.z0);
    }
    // Totem at each end of the platform: the line's big T over a post.
    for (const tz of [stop.z0 + 1.2, stop.z1 - 1.2]) {
      ink(t, TRAM_SIGN, "T", 1.15); cuboid(t, 0, 2.35, tz, 0.55, 0.65, 0.55);
      ink(t, [48, 60, 72], "|"); cuboid(t, 0, 1.05, tz, Math.max(0.1, distance * LINE_PER_METRE), 1.95, 0.1);
    }
    if (distance < KIT_MID + 20) {
      // Name board along the roof's spine; one-cell letters on both faces once the name fits.
      ink(t, [18, 22, 30], "#"); cuboid(t, 0, 3.2, zc, 1.0, 0.42, 6.4);
      const cell = cellMetres(distance), name = TRAM_STOP_NAMES[i];
      if (name.length * cell * 1.15 <= 6.2) for (const side of [-1, 1]) cellText(t, VEHICLE_KIT, name, TRAM_SIGN, 1.2, cell, side * 0.515, 3.2, zc, "z", -side, Math.min(cell, 0.34));
    }
  }
  // Overhead line within ~130 m: a centre pole and cantilever every half block (clear of the
  // junctions), contact wires in 32 m segments.
  const wireRange = Math.min(range, 130);
  if (Math.abs(x) > wireRange) return;
  const first = Math.max(-11, Math.floor((z - wireRange) / 64)), lastBlock = Math.min(10, Math.floor((z + wireRange) / 64));
  for (let block = first; block <= lastBlock; block++) for (const offset of [14, 50]) { // either side of the platforms (z 15..44), 14 m clear of the junctions
    const pz = block * 64 + offset, distance = Math.hypot(x, pz - z);
    if (distance > wireRange || (view.visible && !view.visible(0, 3, pz, 4))) continue;
    const width = Math.max(0.2, distance * LINE_PER_METRE);
    ink(t, [53, 83, 105], "|"); cuboid(t, 0, 3.05, pz, width, 6.1, width);
    ink(t, TRAM_STEEL, "-", 0.9); cuboid(t, 0, 5.98, pz, (TRAM_TRACK_X + TRAM_HALF_WIDTH) * 2, Math.max(0.1, distance * LINE_PER_METRE), Math.max(0.1, distance * LINE_PER_METRE));
  }
  for (let segment = Math.floor((z - wireRange) / 32); segment * 32 <= z + wireRange; segment++) {
    const z0 = Math.max(-704, segment * 32), z1 = Math.min(704, segment * 32 + 32);
    if (z1 <= z0) continue;
    const mid = (z0 + z1) / 2, gap = Math.max(0, Math.abs(mid - z) - (z1 - z0) / 2);
    for (const track of [-TRAM_TRACK_X, TRAM_TRACK_X]) {
      const distance = Math.hypot(track - x, gap), width = Math.max(0.05, cellMetres(distance));
      ink(t, TRAM_STEEL, "-", 0.85); cuboid(t, track, 5.75, mid, width, width, z1 - z0);
    }
  }
}

export function drawActivity(t: PropCanvas, view: ActivityView, vehicles: readonly Vehicle[], citizens: readonly Citizen[]): ActivityCounts {
  const { x, z, time, low } = view, reach = view.reach ?? 1;
  kitEyeX = x; kitEyeZ = z; kitRain = view.rain; // vehicle kit tiers (vehicleKit)
  const counts = { cars: vehicles.length, residents: citizens.length };
  const inRange = (px: number, pz: number, distance: number) => Math.hypot(px - x, pz - z) < distance;
  const outer = propRange((low ? 160 : 280) * reach);
  const motion: CarMotionState = { speed: 0 };
  // Driving: the road's wetness for the car's grip (weather.ts downpours; a no-op unless driving).
  setRoadWetness(view.rain ? rainIntensity(view.signalTime ?? time) : 0);
  for (const car of vehicles) {
    if (car.trailing) continue; // a long vehicle's rear footprint: drawn with its front
    if (isTramVehicle(car)) { drawTram(t, car.tram, view, reach); continue; } // the whole articulated tram
    const long = car.id >= TRAFFIC_ID_BASE && longKind(carKind(car.id));
    if (view.visible && !(long ? view.visible(car.x - Math.sin(car.yaw) * 2.9, 2, car.z + Math.cos(car.yaw) * 2.9, 6.5) : view.visible(car.x, 2, car.z, 2.5))) continue;
    motion.speed = car.speed; motion.queued = car.stopped ?? car.waiting; motion.signal = car.signal; motion.doors = car.doors; motion.door = car.door;
    drawCar(t, car.x, 0, car.z, car.yaw, car.id, inRange(car.x, car.z, 140 * reach), false, motion, time);
  }
  drawBusStops(t, x, z, (low ? 120 : 200) * reach, view.visible);
  drawTramLine(t, view, reach);
  drawTaxiRank(t, view, reach);
  propRange((low ? 110 : 220) * reach);
  for (const person of citizens) {
    if (view.visible && !view.visible(person.x, person.y + 2.5, person.z)) continue;
    drawCitizen(t, person, time, inRange(person.x, person.z, (low ? 28 : 48) * reach), view.rain, view.signalTime ?? time);
  }
  const bx = Math.floor(x / 64), bz = Math.floor(z / 64);
  const lampSpan = reach > 1 ? Math.ceil(2 * reach) : 2;
  for (let iz = bz - lampSpan; iz <= bz + lampSpan; iz++) for (let ix = bx - lampSpan; ix <= bx + lampSpan; ix++) {
    if (Math.abs(ix) > LAMP_STREETS || Math.abs(iz) > LAMP_STREETS) continue;
    // Post on the pavement behind the kerb, head over the kerb (streetLamp in world.ts).
    const lamp = streetLamp(ix, iz), lx = lamp.postX, lz = lamp.z;
    if (!inRange(lx, lz, 220 * reach)) continue;
    if (view.visible && !view.visible(lx, LAMP_HEAD_HEIGHT, lz)) continue;
    propRange(220 * reach);
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
  // The Spire and the Cathedral rise far above the roofs, so their crowns, beams and halos stay
  // drawn to about a kilometre (the desktop draw distance now reaches 20-23 blocks); the rest
  // are hidden behind nearer buildings from that far anyway.
  const landmarkReach = (low ? 380 : 740) + view.height * 1.6;
  const tallReach = low ? 520 : 1000 + view.height * 1.6;
  for (const landmark of LANDMARKS) {
    const distance = Math.hypot(landmark.x - x, landmark.z - z);
    if (distance < (landmark.kind === "spire" || landmark.kind === "array" ? tallReach : landmarkReach)) drawLandmarkStructure(t, landmark, time, landmarkDetail(distance), ink, distance * LINE_PER_METRE);
  }
  drawSkyTraffic(t, time, inRange);
  restorePropRange(outer);
  return counts;
}

/** Sky lanes, all above the Rim Line deck (>= 68 m): spinners, cargo lifters and police spinners
 * with a slowly sweeping searchlight run east-west and north-south at five heights; an advertising
 * blimp drifts higher with a ticker; delivery drones swarm over the two harbour stations. */
const SKY_CRAFT = 24, SKY_HEIGHTS: readonly number[] = [68, 78, 90, 102, 114];
/** Sky craft and blimps fade out over the last SKY_WRAP_FADE metres before their lane wraps and in
 * over the first after it (a smoothstep), instead of vanishing and appearing at the wrap line. */
export const SKY_WRAP_FADE = 60;
/** 0..1 visibility of a craft `u` metres into a lane `length` long (0 at the wrap itself). */
export function wrapFade(u: number, length: number): number {
  const e = Math.max(0, Math.min(1, Math.min(u, length - u) / SKY_WRAP_FADE));
  return e * e * (3 - 2 * e);
}
/** Per-lane shift of the wrap line (-120 .. +120 m), so the lanes do not all wrap on one line. */
export const skyLaneShift = (lane: number): number => (((lane * 53) % 7) - 3) * 40;
/** Fades the craft drawn next: dims its ink and closes its draw range on it (the ordered-dither
 * dissolve the rooftop spinners use), so it thins and darkens rather than popping. */
function skyFade(x: number, z: number, fade: number, reach: number): void {
  inkFade = fade;
  if (fade >= 1) { propRange(reach); return; }
  const distance = Math.max(8, Math.hypot(x - kitEyeX, z - kitEyeZ));
  propRange(Math.min(reach, distance / (1 - 0.24 * fade)));
}
const TICKER = "  NIGHTFALL // RAIN TONIGHT // KIRIN NOODLE BAR OPEN // CORPSEC IS WATCHING // SILK MARKET 24H //";
function drawSkyTraffic(t: PropCanvas, time: number, inRange: (px: number, pz: number, distance: number) => boolean): void {
  propRange(500);
  for (let i = 0; i < SKY_CRAFT; i++) {
    // Twelve fixed lanes over every other street, two craft each; every third lane runs north-south.
    // Lanes alternate direction and sit at five heights; each lane wraps on its own line (skyLaneShift).
    const lane = i % 12, alongZ = lane % 3 === 2, direction = lane % 2 ? -1 : 1, speed = 16 + (i * 7) % 11;
    const u = wrap(time * speed + i * 139 + (i >= 12 ? 750 : 0), 1500);
    const along = (u - 750 + skyLaneShift(lane)) * direction;
    const cross = (lane - 5.5) * 128;
    const px = alongZ ? cross : along, pz = alongZ ? along : cross, py = SKY_HEIGHTS[(i * 3) % SKY_HEIGHTS.length];
    if (!inRange(px, pz, 500)) continue;
    const fade = wrapFade(u, 1500);
    if (fade <= 0) continue;
    skyFade(px, pz, fade, 500);
    const yaw = alongZ ? (direction > 0 ? Math.PI : 0) : direction * Math.PI / 2;
    const role = i % 8;
    if (role === 2 || role === 5) drawCargoLifter(t, px, py, pz, yaw, i);
    else if (role === 6) {
      drawCar(t, px, py, pz, yaw, 7, false, true, undefined, time); // id 7: a police body
      drawSearchBeam(t, px, py, pz, yaw, time + i * 3.1);
    } else drawCar(t, px, py, pz, yaw, i, false, true, undefined, time);
    inkFade = 1; propRange(500);
    skyTrail(t, px, py, pz, i, yaw, fade); // VFX: tail-light streaks, dissolving with the craft at the lane's wrap
  }
  // The blimp: slow, high, its ticker gliding along the band (see drawBlimp).
  for (const [lane, bz] of [[0, -224], [1, 352]]) {
    const u = wrap(time * 2.2 + 300 + lane * 850, 1700), bx = (u - 850 + (lane ? 70 : -60)) * (lane ? -1 : 1);
    const fade = wrapFade(u, 1700);
    if (fade <= 0 || !inRange(bx, bz, 700)) continue;
    skyFade(bx, bz, fade, 500);
    drawBlimp(t, bx, 138 + lane * 10, bz, time + lane * 20);
    inkFade = 1; propRange(500);
  }
  for (const harbour of [{ x: 0, z: 812 }, { x: 0, z: -812 }]) if (inRange(harbour.x, harbour.z, 420)) drawDroneSwarm(t, harbour.x, harbour.z, time);
}
function drawCargoLifter(t: PropCanvas, x: number, y: number, z: number, yaw: number, i: number): void {
  t.push(); t.translate(x, -y, z); t.rotateY(-yaw * 180 / Math.PI);
  ink(t, [52, 58, 68], "#", 0.8); cuboid(t, 0, 0, 0, 4.6, 0.5, 7.2);
  ink(t, [70, 226, 255], "o", 1.1); for (const sx of [-1, 1]) for (const sz of [-1, 1]) cuboid(t, sx * 2.7, -0.1, sz * 3.1, 1.5, 0.3, 1.5);
  ink(t, [40, 44, 52], "|"); for (const sx of [-1, 1]) cuboid(t, sx * 0.9, -1.0, 0, 0.06, 1.6, 0.06);
  ink(t, CAR_COLORS[i % CAR_COLORS.length], "#", 0.7); cuboid(t, 0, -3.0, 0, 2.5, 2.5, 6.2);
  ink(t, [255, 64, 80], "=", 1.1); cuboid(t, -2.4, 0.1, -3.4, 0.3, 0.2, 0.3);
  ink(t, [80, 255, 140], "=", 1.1); cuboid(t, 2.4, 0.1, -3.4, 0.3, 0.2, 0.3);
  t.pop();
}
/** A police spinner's searchlight: a pale shaft angled down and ahead, sweeping side to side at 0.1 Hz. */
function drawSearchBeam(t: PropCanvas, x: number, y: number, z: number, yaw: number, time: number): void {
  t.push(); t.translate(x, -(y - 0.3), z);
  t.rotateY(-(yaw + Math.sin(time * 0.63) * 0.7) * 180 / Math.PI); t.rotateX(-38);
  ink(t, [150, 200, 255], ":", 0.42); cuboid(t, 0, 0, -26, 0.9, 0.9, 52);
  ink(t, [220, 240, 255], "@", 1.1); cuboid(t, 0, 0, -0.6, 0.6, 0.6, 0.5);
  t.pop();
}
function drawBlimp(t: PropCanvas, x: number, y: number, z: number, time: number): void {
  t.push(); t.translate(x, -y, z); t.rotateY(90); // long axis along its east-west track
  ink(t, [70, 66, 84], "O", 0.75); t.ellipsoid(6, 6, 21);
  ink(t, [44, 46, 56], "#"); cuboid(t, 0, -6.6, 2, 2.6, 1.6, 6);
  ink(t, [255, 71, 148], "=", 0.9); for (const s of [-1, 1]) cuboid(t, s * 4.2, 3.6, 17, 0.2, 4, 5);
  // Ticker: a band of letter panels on both flanks. The letters glide along the band at 0.6 letters a
  // second and the end panels fade in and out, so nothing on the skyline swaps or steps (comfort rule:
  // no brightness steps above 0.4 Hz; the old version swapped every glyph at 2 Hz).
  const pos = time * 0.6, offset = Math.floor(pos), slide = pos - offset;
  for (let k = 0; k <= 16; k++) {
    const glyph = TICKER[(offset + k) % TICKER.length];
    if (glyph === " ") continue;
    const u = k - slide, edge = Math.min(1, u + 0.5, 16.5 - u);
    if (edge <= 0) continue;
    ink(t, [255, 196, 96], glyph, 1.15 * edge);
    // A flank at x = s * r reads left to right toward -s * z (vehicle-kit.ts cellText); it ran mirrored.
    for (const s of [-1, 1]) cuboid(t, s * 6.05, 0, -s * (u - 7.5) * 1.6, 0.05, 1.6, 1.4);
  }
  t.pop();
}
/** Delivery drones: two loose rings orbiting over a harbour station, each drone a body, a lit rotor
 * disc and a parcel. */
function drawDroneSwarm(t: PropCanvas, cx: number, cz: number, time: number): void {
  for (let k = 0; k < 10; k++) {
    const ring = k % 2, a = time * (ring ? 0.22 : -0.17) + k * 0.63, r = ring ? 46 : 28;
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r, py = 70 + ring * 6 + Math.sin(time * 0.8 + k) * 1.2;
    ink(t, [40, 44, 52], "#"); cuboid(t, px, py, pz, 0.7, 0.25, 0.7);
    ink(t, [70, 226, 255], "-", 1.0); cuboid(t, px, py + 0.22, pz, 1.4, 0.05, 1.4);
    ink(t, [196, 160, 110], "%", 0.8); cuboid(t, px, py - 0.45, pz, 0.45, 0.45, 0.45);
  }
}
