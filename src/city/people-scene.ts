import type { PropCanvas } from "./prop-canvas.ts";
import type { Citizen, Doorway } from "./people.ts";
import { cuboid as box, ink, propRange, restorePropRange } from "./activity.ts";
import { BENCH } from "./metro.ts";
import { randomFor, type RGB } from "./world.ts";
import type { NpcLook } from "./npcs.ts";
import { drawHuman, FigureMotions, type HumanArms, type HumanPaint, type MotionTargets } from "./human-model.ts";
import { drawUmbrella } from "./umbrella-model.ts";
import { doorGlow } from "./street-doors.ts";
import { rainIntensity } from "./weather.ts";

/** The painter for the figure being drawn: `ink`, or a dimmed ink while someone fades through a
 *  doorway (props and all). Module state, reset at the end of every drawCitizen. */
let fadeGain = 1;
const fadedInk: HumanPaint = (canvas, color, glyph, gain = 1) => ink(canvas, [color[0] * fadeGain, color[1] * fadeGain, color[2] * fadeGain], glyph, gain);
let pen: HumanPaint = ink;

/** Rain intensity for the frame (weather.ts is a pure function of the clock; computed once per clock value). */
let rainClock = NaN, rainCached = 0;
function rainLevel(time: number, rain: boolean): number {
  if (!rain) return 0;
  if (time !== rainClock) { rainClock = time; rainCached = rainIntensity(time); }
  return rainCached;
}

const COATS: readonly RGB[] = [[137, 112, 81], [45, 120, 112], [119, 75, 92], [160, 142, 97], [76, 91, 121], [99, 123, 102], [154, 78, 54], [91, 85, 77]];
const SKIN: readonly RGB[] = [[179, 143, 115], [111, 85, 69], [189, 174, 141], [144, 112, 88]];
const LOOKS: readonly NpcLook[] = COATS.map((coat, index) => ({ coat, trim: index % 2 ? [56, 72, 83] : [87, 79, 76], skin: SKIN[index % SKIN.length], light: [135, 199, 190], headwear: index % 4 === 0 ? "hood" : index % 4 === 1 ? "cap" : index % 4 === 2 ? "bare" : "visor", prop: null, idle: "breathe" }));
const RAIN_LOOKS: readonly NpcLook[] = LOOKS.map(look => ({ ...look, prop: "umbrella" }));

/** A seated rider is the same figure as a standing one, eased onto the bench (drawHuman's `sit`):
 *  hips just above the cushion, thighs along it and long enough that the shins and feet drop in
 *  front of its edge, back clear of the backrest (tests/anim-people.test.ts checks the clearance
 *  against metro.ts's BENCH). The origin is the floor under the hips, as for metro.ts's seats. */
export const RIDER_SEAT = { hip: BENCH.top + 0.16, thigh: BENCH.hip - BENCH.front + 0.2 - 0.53 } as const;

/** Role looks: CorpSec armour with a red visor, hi-vis cleaners, chrome-and-neon cyborgs, and the
 *  brighter coats of kids and protesters. Indexed by id so a person keeps their look. */
const look = (coat: RGB, trim: RGB, light: RGB, headwear: NpcLook["headwear"], index: number): NpcLook => ({ coat, trim, skin: SKIN[index % SKIN.length], light, headwear, prop: null, idle: "breathe" });
const PATROL: readonly NpcLook[] = [0, 1, 2, 3].map(index => ({ ...look([38, 46, 62], [22, 27, 35], [255, 64, 84], "visor", index), idle: "scan" }));
const CLEANER: readonly NpcLook[] = [0, 1, 2, 3].map(index => look([212, 158, 44], [58, 66, 60], [235, 230, 120], index % 2 ? "cap" : "bare", index));
const CYBORG_LIGHTS: readonly RGB[] = [[255, 70, 200], [90, 230, 255], [180, 255, 120], [255, 160, 60]];
const CYBORG: readonly NpcLook[] = CYBORG_LIGHTS.map((light, index) => look(index % 2 ? [44, 42, 56] : [70, 60, 84], [30, 32, 40], light, index % 3 ? "visor" : "bare", index));
const BRIGHT_COATS: readonly RGB[] = [[230, 90, 80], [70, 160, 230], [240, 200, 70], [120, 200, 110], [200, 110, 220], [80, 200, 190]];
const BRIGHT: readonly NpcLook[] = BRIGHT_COATS.map((coat, index) => look(coat, [60, 64, 76], [150, 220, 210], index % 3 === 0 ? "cap" : "bare", index));
const KITES: readonly RGB[] = [[255, 90, 140], [90, 220, 255], [255, 210, 80], [150, 255, 140]];
const PLACARD: RGB = [226, 218, 190], SLOGAN: readonly RGB[] = [[230, 60, 70], [40, 50, 70], [255, 150, 40]];
const DOGS: readonly RGB[] = [[120, 90, 60], [60, 52, 48], [190, 170, 140], [150, 110, 70]];
const WOOD: RGB = [150, 108, 62], METAL: RGB = [96, 112, 122], DARK: RGB = [34, 38, 46];
const WIND_X = 0.8, WIND_Z = -0.6;

/**
 * Street casting by home district (Citizen.district), for about three residents in five without a
 * role: Foundry shift workers with welding masks pushed up; Neon Ward night-shift office workers
 * (charcoal, a lit lanyard) and clubgoers (neon trim, visors); Ghost Circuit loners in hoods with a
 * lit implant; Rain Gardens growers with rakes; Silk Market shoppers with bags and paper lanterns;
 * Spillway dockworkers in hi-vis. Same parts as everyone else: only colours, headwear and a prop.
 */
const cast = (coat: RGB, trim: RGB, light: RGB, headwear: NpcLook["headwear"], index: number, extra: Partial<NpcLook> = {}): NpcLook => ({ ...look(coat, trim, light, headwear, index), ...extra });
const CASTS: readonly (readonly NpcLook[])[] = [
  [cast([92, 70, 52], [48, 40, 36], [255, 150, 60], "mask", 0), cast([70, 64, 58], [40, 38, 36], [255, 120, 50], "mask", 1), cast([110, 84, 56], [52, 44, 38], [255, 170, 80], "cap", 2), cast([84, 76, 70], [44, 40, 38], [255, 140, 60], "mask", 3)],
  [cast([44, 46, 54], [30, 32, 38], [120, 230, 255], "bare", 0), cast([52, 50, 58], [28, 30, 36], [180, 220, 255], "bare", 1), cast([40, 30, 60], [120, 44, 100], [255, 90, 210], "visor", 2), cast([30, 40, 56], [40, 96, 120], [90, 240, 255], "visor", 3), cast([70, 40, 80], [110, 54, 100], [255, 150, 230], "bare", 0)],
  [cast([40, 44, 52], [26, 28, 34], [120, 170, 255], "hood", 0, { implant: true }), cast([52, 48, 60], [30, 30, 38], [150, 255, 200], "hood", 1, { implant: true }), cast([34, 38, 42], [24, 26, 30], [255, 90, 120], "hood", 2, { implant: true })],
  [cast([84, 112, 70], [60, 52, 40], [160, 240, 170], "cap", 0, { prop: "tool" }), cast([110, 92, 60], [62, 70, 50], [190, 250, 160], "bare", 1), cast([70, 98, 80], [56, 50, 42], [150, 230, 190], "hood", 2, { prop: "tool" })],
  [cast([150, 60, 70], [70, 40, 44], [255, 180, 110], "bare", 0, { prop: "bag" }), cast([170, 120, 60], [80, 60, 40], [255, 120, 90], "bare", 1, { prop: "lantern" }), cast([90, 70, 120], [50, 40, 60], [255, 210, 130], "cap", 2, { prop: "bag" }), cast([60, 110, 120], [40, 50, 60], [255, 150, 100], "bare", 3, { prop: "bag" })],
  [cast([230, 120, 40], [52, 58, 62], [240, 250, 220], "cap", 0), cast([220, 190, 50], [50, 56, 60], [240, 250, 220], "cap", 1), cast([70, 80, 90], [44, 50, 56], [255, 200, 90], "hood", 2)],
];
const CASTS_RAIN: readonly (readonly NpcLook[])[] = CASTS.map(looks => looks.map(entry => ({ ...entry, prop: "umbrella" as const })));
/** Dancers and the preacher by role; audiences, sitters and walkers by district casting. */
const PREACHER: NpcLook = { ...look([58, 44, 40], [36, 30, 30], [255, 200, 120], "bare", 1), idle: "breathe" };

function castLook(person: Citizen, umbrella: boolean): NpcLook | null {
  const district = person.district;
  if (district === undefined || person.occupation !== "resident" || randomFor(person.id, 91, 5) >= 0.62) return null;
  const looks = (umbrella ? CASTS_RAIN : CASTS)[district];
  return looks ? looks[person.id % looks.length] : null;
}

function roleLook(person: Citizen, umbrella: boolean): NpcLook {
  const base = (umbrella ? RAIN_LOOKS : LOOKS)[person.id % LOOKS.length];
  const pick = (looks: readonly NpcLook[]) => umbrella ? { ...looks[person.id % looks.length], prop: "umbrella" as const } : looks[person.id % looks.length];
  switch (person.role) {
    case "patrol": return pick(PATROL);
    case "cleaner": return pick(CLEANER);
    case "cyborg": return pick(CYBORG);
    case "kite": case "protester": case "dancer": case "chaser": return pick(BRIGHT);
    case "preacher": return PREACHER;
    case undefined: case "audience": case "sitter": case "chatter": case "wrist": case "queue": return castLook(person, umbrella) ?? base;
    default: return base;
  }
}
function roleArms(person: Citizen): HumanArms | undefined {
  switch (person.role) {
    case "crate": return person.cargo === false ? undefined : "carry";
    case "preacher": return "preach";
    case "dancer": return "dance";
    case "cleaner": return "push";
    case "musician": return "strum";
    case "wrist": return "wrist";
    case "smoker": return "smoke";
    case "protester": return "sign";
    case "dog": return "lead";
    case "kite": return "kite";
    default: return undefined;
  }
}

/** A dog on a lead at its owner's right, trotting while they walk and sitting when they stop
 *  (eased by the owner's gait weight: the trot fades, the haunches settle). */
function drawDog(t: PropCanvas, person: Citizen, time: number, detail: boolean, gait: number): void {
  const coat = DOGS[person.id % DOGS.length], trot = time * 9 + person.id;
  t.push(); t.translate(0.85, 0, -0.6);
  t.rotateX(-14 * (1 - gait));
  pen(t, coat, "#"); box(t, 0, 0.55, 0, 0.3, 0.3, 0.72);
  box(t, 0, 0.8, -0.44, 0.24, 0.24, 0.26);
  if (detail) {
    box(t, 0, 0.75, -0.62, 0.13, 0.11, 0.14);
    pen(t, coat, "^", 0.8); for (const side of [-1, 1]) box(t, side * 0.08, 0.96, -0.42, 0.06, 0.1, 0.05);
    pen(t, coat, "|");
    for (const [x, z, k] of [[-0.1, -0.26, 0], [0.1, -0.26, 1], [-0.1, 0.27, 1], [0.1, 0.27, 0]] as const) {
      t.push(); t.translate(x, -0.42, z); t.rotateX(Math.sin(trot + k * Math.PI) * 26 * gait); box(t, 0, -0.2, 0, 0.07, 0.4, 0.07); t.pop();
    }
    pen(t, coat, "/"); t.push(); t.translate(0, -0.66, 0.38); t.rotateX(-35 + Math.sin(time * 6 + person.id) * 12); box(t, 0, 0.12, 0, 0.05, 0.26, 0.05); t.pop();
    // The lead: a dotted line from the owner's right hand to the collar.
    pen(t, DARK, ".", 1.6);
    const hx = 0.47 - 0.85, hy = 1.22, hz = -0.42 + 0.6;
    for (let k = 1; k < 5; k++) { const f = k / 5; box(t, hx * (1 - f), hy + (0.8 - hy) * f - Math.sin(f * Math.PI) * 0.12, hz + (-0.36 - hz) * f, 0.03, 0.03, 0.03); }
  }
  t.pop();
}

/** Props in the person's own frame (origin at the feet, facing -z). Large shapes are kept at every
 *  distance for the silhouette; small parts only close up. */
function drawRoleProps(t: PropCanvas, person: Citizen, time: number, detail: boolean, gait: number): void {
  switch (person.role) {
    case "crate":
      if (person.cargo === false || person.act === "handover") break; // handed over (drawHandover carries it across)
      pen(t, WOOD, "#"); box(t, 0, 1.52, -0.66, 0.78, 0.5, 0.56);
      if (detail) { pen(t, [226, 190, 96], "=", 0.9); box(t, 0, 1.52, -0.95, 0.5, 0.1, 0.02); }
      break;
    case "cleaner":
      pen(t, [62, 108, 120], "#"); box(t, 0, 0.78, -1.45, 0.82, 0.78, 1.0);
      if (detail) {
        pen(t, METAL, "="); box(t, 0, 1.4, -0.66, 0.7, 0.06, 0.06); for (const side of [-1, 1]) box(t, side * 0.32, 1.12, -0.82, 0.05, 0.6, 0.05);
        pen(t, DARK, "o"); for (const side of [-1, 1]) for (const z of [-1.05, -1.85]) box(t, side * 0.36, 0.14, z, 0.08, 0.2, 0.2);
        pen(t, [40, 44, 40], "%"); box(t, 0.12, 1.32, -1.6, 0.4, 0.34, 0.4);
        pen(t, WOOD, "|"); box(t, -0.28, 1.7, -1.8, 0.05, 1.6, 0.05);
      }
      break;
    case "musician":
      // Guitar across the body; open case on the pavement in front with a few coins.
      pen(t, [170, 110, 60], "@"); box(t, 0.08, 1.42, -0.3, 0.5, 0.56, 0.14);
      if (detail) {
        pen(t, [60, 40, 30], "-"); t.push(); t.translate(-0.34, -1.66, -0.36); t.rotateZ(28); box(t, 0, 0, 0, 0.8, 0.07, 0.07); t.pop();
        pen(t, DARK, "="); box(t, 0, 0.07, -1.05, 1.0, 0.12, 0.4);
        pen(t, [150, 40, 70], "%", 0.85); box(t, 0, 0.12, -1.05, 0.88, 0.04, 0.3);
        pen(t, [240, 200, 90], "*", 1.1); box(t, -0.2, 0.16, -1.0, 0.06, 0.03, 0.06); box(t, 0.15, 0.16, -1.12, 0.06, 0.03, 0.06);
      }
      break;
    case "protester": {
      // A placard on a pole, bobbing as they chant.
      const bob = Math.sin(time * 1.4 + person.id * 0.9) * 0.08;
      pen(t, WOOD, "|"); box(t, 0, 2.25 + bob, -0.62, 0.06, 1.9, 0.06);
      pen(t, PLACARD, "#"); box(t, 0, 3.1 + bob, -0.62, 1.15, 0.62, 0.05);
      if (detail) { pen(t, SLOGAN[person.id % SLOGAN.length], "=", 1.05); for (const face of [-0.655, -0.585]) { box(t, 0, 3.17 + bob, face, 0.9, 0.13, 0.02); box(t, -0.1, 2.98 + bob, face, 0.66, 0.09, 0.02); } }
      break;
    }
    case "vendor":
      pen(t, DARK, "#"); box(t, 0.9, 0.35, -0.1, 0.5, 0.7, 0.5);
      if (detail) {
        for (let k = 0; k < 5; k++) { pen(t, COATS[(person.id + k) % COATS.length], "|", 1.1); box(t, 0.78 + (k % 3) * 0.12, 1.0, -0.2 + (k % 2) * 0.2, 0.07, 0.9, 0.07); }
      }
      break;
    case "patrol":
      if (detail) { pen(t, [255, 64, 84], "+", 1.1); box(t, 0.47, 2.15, -0.12, 0.1, 0.08, 0.1); pen(t, DARK, "|"); box(t, -0.52, 1.05, 0, 0.06, 0.6, 0.06); }
      break;
    case "dog": drawDog(t, person, time, detail, gait); break;
    case "preacher":
      // The soapbox (drawCitizen stands the preacher on it).
      pen(t, WOOD, "#"); box(t, 0, 0.2, 0, 0.8, 0.4, 0.6);
      break;
    case "sitter":
      // An upturned crate against the wall to sit on, a lunch tin at its foot.
      pen(t, [104, 80, 52], "#"); box(t, 0, 0.23, 0.12, 0.6, 0.46, 0.5);
      if (detail) { pen(t, METAL, "="); box(t, 0.45, 0.08, -0.15, 0.26, 0.16, 0.18); }
      break;
    default: break;
  }
  if (person.occupation === "courier" && person.role !== "crate" && detail) {
    pen(t, [211, 154, 64], "#", 0.85); box(t, 0, 1.4, 0.47, 0.7, 0.95, 0.5);
    pen(t, [157, 226, 191], "+"); box(t, 0, 1.7, 0.76, 0.18, 0.16, 0.07);
  }
}

/** A kite up in the wind over the kid's lawn, its string drawn as a dotted line from the hand. */
function drawKite(t: PropCanvas, person: Citizen, time: number, detail: boolean): void {
  const color = KITES[person.id % KITES.length];
  const kx = person.x + WIND_X * 9 + Math.sin(time * 0.7 + person.id) * 0.8, kz = person.z + WIND_Z * 9 + Math.cos(time * 0.5 + person.id) * 0.6;
  const ky = 17 + Math.sin(time * 0.9 + person.id * 2) * 0.7;
  t.push(); t.translate(kx, -ky, kz); t.rotateY(Math.atan2(WIND_X, -WIND_Z) * 180 / Math.PI); t.rotateZ(45 + Math.sin(time * 1.3 + person.id) * 8);
  pen(t, color, "#", 1.15); box(t, 0, 0, 0, 1.2, 1.2, 0.08);
  t.pop();
  if (!detail) return;
  const hx = person.x, hy = 1.75, hz = person.z;
  pen(t, [200, 205, 210], ".", 0.9);
  for (let k = 1; k < 9; k++) {
    const f = k / 9, sag = Math.sin(f * Math.PI) * 0.9;
    box(t, hx + (kx - hx) * f, hy + (ky - hy) * f - sag, hz + (kz - hz) * f, 0.04, 0.04, 0.04);
  }
  pen(t, color, "~", 0.9);
  for (let k = 1; k < 4; k++) box(t, kx - WIND_X * k * 0.35, ky - 0.5 - k * 0.32 + Math.sin(time * 3 + k) * 0.05, kz - WIND_Z * k * 0.35, 0.12, 0.08, 0.04);
}

const DEG = 180 / Math.PI;
const smooth = (a: number, b: number, x: number): number => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
/** Warm or cool shop light spilling from an open door (signage.ts lights the panes in these tones). */
const DOOR_LIGHTS: readonly RGB[] = [[255, 196, 128], [150, 220, 255], [255, 168, 214], [196, 255, 210]];
/** Seconds a courier's handover lasts (people.ts HANDOVER_SECONDS). */
const HANDOVER = 5;

/** An open shop door: the doorway lit, widening as it swings open, and a fan of light on the
 *  pavement in front. Eased open over 0.5 s and shut over 0.7 s (street-doors.ts doorGlow): no flash. */
function drawDoorLight(t: PropCanvas, door: Doorway, time: number, seed: number): void {
  const glow = doorGlow(door, time);
  if (glow < 0.03) return;
  const color = DOOR_LIGHTS[Math.abs(seed) % DOOR_LIGHTS.length];
  t.push(); t.translate(door.x, 0, door.z); t.rotateY(Math.atan2(door.nx, door.nz) * DEG);
  ink(t, color, "#", 0.5 + 0.7 * glow); box(t, 0, 1.35, -0.14, 0.1 + 1.15 * glow, 2.5, 0.05);
  for (let k = 0; k < 3; k++) { ink(t, color, k ? "." : ":", (1.0 - k * 0.28) * glow); box(t, 0, 0.025, 0.2 + k * 0.62, 1.2 + k * 0.5, 0.02, 0.6); }
  t.pop();
}

/** A courier's handover at a door: someone steps into the lit doorway, takes the crate and goes back
 *  in with it. `u` is 0..1 through the handover. The receiver fades in and out like anyone at a door. */
function drawHandover(t: PropCanvas, person: Citizen, door: Doorway, u: number, time: number, detail: boolean): void {
  const presence = smooth(0.04, 0.24, u) * (1 - smooth(0.8, 0.97, u));
  const across = smooth(0.36, 0.56, u);
  const face = Math.atan2(door.nx, -door.nz);
  if (presence > 0.03) {
    fadeGain = presence; pen = presence < 0.999 ? fadedInk : ink;
    t.push(); t.translate(door.x, 0, door.z); t.rotateY(-face * DEG);
    // Reaching out for the crate as it comes across (eased), rather than snapping to the carry.
    drawHuman(t, LOOKS[(person.id + 3) % LOOKS.length], { time, seed: person.id + 7, stride: 0, moving: false, detail, distant: !detail, arms: "carry", hold: smooth(0.24, 0.42, u) }, pen);
    t.pop();
  }
  // The crate: held out by the courier, passed across, then carried in by the receiver.
  const crate = u < 0.56 ? 1 : presence;
  if (crate > 0.03) {
    fadeGain = crate; pen = crate < 0.999 ? fadedInk : ink;
    const out = 0.62 - across * 0.2, cx = door.x + door.nx * out, cz = door.z + door.nz * out;
    t.push(); t.translate(cx, -(1.52 - across * 0.06), cz); t.rotateY(-face * DEG);
    pen(t, WOOD, "#"); t.box(0.78, 0.5, 0.56);
    t.pop();
  }
  fadeGain = 1; pen = ink;
}

/** A kid's quarry: a drone's shadow on the pavement a couple of metres ahead, and the drone over it
 *  with its two running lights. */
function drawChase(t: PropCanvas, person: Citizen, time: number, detail: boolean, yaw: number): void {
  // `yaw` is the kid's displayed (eased) heading, so the drone swings round with them, not ahead of them.
  const ahead = 1.8, sx = person.x + Math.sin(yaw) * ahead, sz = person.z - Math.cos(yaw) * ahead;
  pen(t, [10, 12, 16], "%", 1); box(t, sx, 0.025, sz, 0.8, 0.02, 0.62);
  const y = 5.6 + Math.sin(time * 0.9 + person.id) * 0.25;
  t.push(); t.translate(sx, -y, sz); t.rotateY(-yaw * DEG);
  pen(t, [44, 50, 58], "#"); t.box(0.6, 0.14, 0.6);
  if (detail) {
    pen(t, [255, 70, 80], "*", 1.1); t.translate(-0.4, 0, 0); t.box(0.12, 0.12, 0.12);
    pen(t, [80, 255, 150], "*", 1.1); t.translate(0.8, 0, 0); t.box(0.12, 0.12, 0.12);
  }
  t.pop();
}

/** A phone checked now and then while waiting: raised for ~5 s of every 13-16 s, eased up and down. */
function phoneCycle(id: number, time: number): number {
  const period = 13 + (id % 4), phase = ((time + id * 2.3) % period + period) % period;
  return smooth(2.5, 3.4, phase) * (1 - smooth(8.4, 9.3, phase));
}

/** Pairs talk in turns (street chatters and neighbours stopped mid-pavement), the speaker changing
 *  every ~7.5 s: a weight linear in the same sine, centred where it used to switch (0.1), which the
 *  display smoothsteps. The preacher, and anyone greeting, talk throughout. */
function talkTarget(person: Citizen, time: number): number {
  if (person.role === "chatter" || person.act === "chat") return Math.max(0, Math.min(1, (Math.sin(time * 0.42 + (person.id % 2) * Math.PI) - 0.1) / 0.5 + 0.5));
  return person.role === "preacher" || person.reaction === "greeting" ? 1 : 0;
}

/** Display state per citizen id (bounded; see FigureMotions), and the reused per-call targets. */
const MOTIONS = new FigureMotions<number>();
const TARGET: MotionTargets = { yaw: 0, glance: 0, gait: 0, talk: 0, sit: 0, hold: 0, phone: 0 };
/** How many citizens the draw layer is easing (tests: it stays bounded). */
export const easedCitizens = (): number => MOTIONS.size;

/** How far an umbrella is open in rain of intensity `level`: each owner has their own threshold,
 *  so umbrellas go up one by one as the rain rises (and each opens over a few seconds of it). */
function umbrellaOpen(id: number, level: number): number {
  return smooth(0, 1, (level - (0.18 + randomFor(id, 77, 3) * 0.45)) / 0.06);
}

/** In rain, walkers on the pavement beside the kerb step in round the puddles there: a 0.4 m eased
 *  sidestep over 3 m of pavement. Puddles sit at fixed spots and deepen with the rain. Returns the
 *  sideways offset (world x or z, by the walker's heading). */
function puddleStep(person: Citizen, level: number): number {
  const alongZ = Math.abs(Math.cos(person.yaw)) > 0.7;
  const across = alongZ ? person.x : person.z, along = alongZ ? person.z : person.x;
  const street = Math.round(across / 64) * 64, kerb = Math.abs(across - street) - (alongZ && street === 0 ? 6.65 : 0);
  if (kerb < 6.85 || kerb > 8.2) return 0;
  const cell = Math.floor(along / 7), centre = cell * 7 + 2 + randomFor(cell, street, 61) * 3, u = (along - centre) / 1.5;
  const local = ((centre % 64) + 64) % 64;
  if (Math.abs(u) >= 1 || local < 12.5 || local > 51.5) return 0; // no puddles at the corners, where walkers turn
  const depth = smooth(0, 1, (0.6 * level - randomFor(cell, street, 62) * 0.5) / 0.08);
  return depth * 0.42 * (0.5 + 0.5 * Math.cos(Math.PI * u)) * Math.sign(across - street);
}

/** `shared` is the clock the population decides on (signalTime): door lights, handovers and the rain level follow it. */
export function drawCitizen(t: PropCanvas, person: Citizen, time: number, detail: boolean, rain: boolean, shared = time): void {
  // Someone using a shop door: its light first; indoors, that light is all there is to see.
  if (person.doorway && person.act !== "handover") drawDoorLight(t, person.doorway, shared, person.id);
  if (person.fade === 0) return;
  const coat = COATS[person.id % COATS.length];
  const level = rainLevel(shared, rain);
  const role = person.role, kid = role === "kite" || role === "chaser";
  const sitter = role === "sitter", shelter = person.act === "shelter";
  const open = rain && person.umbrella && person.y < 1 ? umbrellaOpen(person.id, level) : 0;
  const umbrella = open > 0;
  const handover = person.act === "handover" && person.doorway ? Math.max(0, Math.min(1, (shared - person.doorway.opened) / HANDOVER)) : -1;
  const arms = handover > 0.58 || umbrella && role !== "vendor" ? undefined : roleArms(person);
  const idle = !person.moving && !person.reaction && !arms;
  const held = arms ?? (idle && person.id % 5 === 1 && role !== "chatter" && role !== "audience" && !sitter && !shelter ? "wrist" : undefined);
  // What the simulation says, eased for display (see FigureMotions): the body turns toward its
  // heading (or whoever it is attending to) at no more than 180 deg/s with the head leading, the
  // stride, seat, held pose and phone ease in and out, and a newcomer starts as it is.
  TARGET.yaw = !person.moving && person.attentionYaw !== undefined ? person.attentionYaw : person.yaw;
  TARGET.glance = person.glance && (person.moving || person.attentionYaw === undefined) ? person.glance : 0;
  TARGET.gait = person.moving ? 1 : 0;
  TARGET.talk = talkTarget(person, time);
  TARGET.sit = person.seated ? 1 : 0;
  TARGET.hold = held ? 1 : 0;
  TARGET.phone = shelter ? phoneCycle(person.id, time) : idle && person.id % 3 === 0 && !sitter && role !== "audience" ? 1 : 0;
  const shown = MOTIONS.update(person.id, time, person.x, person.z, TARGET);
  if (held) shown.arms = held;
  const yaw = shown.yaw, gait = shown.gait;
  let px = person.x, pz = person.z;
  if (level > 0 && gait > 0 && !role && person.y < 0.5) {
    const step = puddleStep(person, level) * gait;
    if (Math.abs(Math.cos(person.yaw)) > 0.7) px += step; else pz += step;
  }
  fadeGain = person.fade ?? 1; pen = fadeGain < 0.999 ? fadedInk : ink;
  t.push(); t.translate(px, -person.y, pz); t.rotateY(-yaw * DEG);
  if (kid) t.scale(0.64, 0.64, 0.64);
  // The preacher stands on a soapbox; dancers bob (0.8 Hz, 5 cm) and turn a little with the beat.
  const lift = role === "preacher" ? 0.4 : role === "dancer" ? 0.05 * (0.5 - 0.5 * Math.cos(time * 5.2 + person.id)) : 0;
  if (role === "dancer") t.rotateY(Math.sin(time * 1.3 + person.id) * 14);
  if (lift) t.translate(0, -lift, 0);
  drawHuman(t, roleLook(person, umbrella), {
    time, seed: person.id, stride: time * (kid ? 5.4 : 4.2) + person.id, moving: person.moving, gait, detail, distant: !detail,
    longCoat: person.id % 3 === 0 && role !== "patrol" && !kid && !sitter, talk: shown.talk,
    phoneLift: shown.phone,
    arms: held ?? shown.arms, hold: shown.hold,
    chrome: role === "cyborg",
    // The umbrella hand comes up as the canopy opens.
    ...(umbrella ? { propHold: smooth(0, 0.3, open) } : {}),
    // A tired worker slumps on the crate, head down; listeners nod along, slowly.
    ...(sitter ? { seated: true, seatHeight: 0.5, lean: 16, headPitch: 22 } : role === "audience" ? { headPitch: 5 + Math.sin(time * 1.1 + person.id) * 5 } : {}),
    // Riders ease onto (and up off) the bench.
    ...(person.seated || shown.sit > 0 ? { sit: shown.sit, seatHeight: RIDER_SEAT.hip, thigh: RIDER_SEAT.thigh } : {}),
    ...(shown.head ? { glance: shown.head } : {}),
  }, pen);
  if (lift) t.translate(0, lift, 0);
  const outer = propRange(150);
  drawRoleProps(t, person, time, detail, gait);
  if (detail && umbrella) drawUmbrella(t, coat, pen, undefined, open);
  restorePropRange(outer);
  t.pop();
  if (role === "kite") drawKite(t, person, time, detail);
  else if (role === "chaser") drawChase(t, person, time, detail, yaw);
  if (handover >= 0 && person.doorway) { drawDoorLight(t, person.doorway, time, person.id); drawHandover(t, person, person.doorway, handover, time, detail); }
  fadeGain = 1; pen = ink;
}
