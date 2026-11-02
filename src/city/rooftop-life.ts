import { PropRecorder, type PropCanvas } from "./prop-canvas.ts";
import type { StreetKit, StreetView } from "./street-life.ts";
import { VENUE, heliports, roofSpots, venueLayout, type RoofSpot } from "./architecture.ts";
import { drawHuman, type HumanPose } from "./human-model.ts";
import type { NpcLook } from "./npcs.ts";
import { LINE_PER_METRE } from "./landmarks-scene.ts";
import { SIGN_FORMAT, drawLetterPanel, signStyle } from "./signage.ts";
import { weatherAt } from "./weather.ts";
import { BLOCK_SIZE, DISTRICTS, randomFor, type RGB } from "./world.ts";

/**
 * Life on the roofs (street-life.ts calls this once per frame while recording props): smokers and
 * couples on the parapets, cats, laundry swaying in the wind, dripping water tanks, drone pads with
 * slow approach lights, maintenance workers with torches on the tallest roofs, flags; the animated
 * half of the rooftop venues (architecture.ts builds their static kit in the building batch):
 * each venue's deck, parapet and lit rail, and at the Neon Ward bars lantern strings, bottles,
 * tables, a heater, the name sign on the bulkhead and the drinkers; gardeners among lit glass,
 * farmers under grow lights, the pirate-radio dish and lit shack, pigeons circling their lit
 * loft, embers rising from the forge vents. Each venue reads from the air as a pool of its own
 * light (the deck shades into it with distance); and spinners landing on a few
 * helipads. Everything is deterministic (`randomFor` per roof, the scene clock for motion), drawn
 * only within ROOF_LIFE_REACH of the camera and never on the `low` profile.
 * Motion comfort: every periodic change is listed in ROOF_RATES (none above 0.4 Hz) and is a smooth
 * function of time: nothing blinks, lights swell and fade.
 */
export interface RoofView extends StreetView {
  /** Camera height (m). ActivityView carries it; street-life's StreetView type does not name it. */
  height?: number;
}

const TAU = Math.PI * 2, DEG = 180 / Math.PI;
/** Rooftop life is recorded within this distance (3D, m) of the camera. */
export const ROOF_LIFE_REACH = 180;
/** Spinners are big and rare: drawn to this distance, the far ones as body and lights only. */
export const SPINNER_REACH = 360;
/** Every periodic change on the roofs, in Hz (motion comfort: none above 0.4 Hz). */
export const ROOF_RATES = {
  /** A smoker's ember brightens once every 20 s, a raised-cosine swell over 4 s (2 s up, 2 s down). */
  emberCycle: 1 / 20, emberSwell: 1 / 4,
  laundrySway: 0.14, flagRipple: 0.11, catTail: 0.2, lanternSway: 0.12,
  /** Drone pad approach lights: one swell travels round the four lamps every 8 s. */
  padLights: 1 / 8,
  torchSweep: 0.05, dishSweep: 0.02, bulbShimmer: 0.1, forgeGlow: 0.1,
  /** A bar's patio heater breathes a little brighter and back every 12.5 s. */
  heaterGlow: 0.08,
  /** Each forge ember rises for 14 s; pigeons circle their loft once in about 17 s. */
  embers: 1 / 14, pigeonOrbit: 0.06,
  /** A water tank lets one drop go every 4 s. */
  drip: 0.25,
  spinnerBelly: 0.2,
} as const;
/** The spinner rotor's apparent spin (deg/s): a slow glyph ring, never a strobe. */
export const ROTOR_DEG_PER_S = 9;
/** A spinner's landing cycle (s): approach, sit on the pad, leave, then away until the period ends. */
export const SPINNER_CYCLE = { approach: 30, sit: 60, leave: 30, period: 240 } as const;
/** Where a spinner starts its approach: this far out (m) and this high above the pad. */
const SPINNER_RUN = 140, SPINNER_HIGH = 70;

/** Rooftop life kinds. */
export const LIFE = { SMOKER: 0, COUPLE: 1, CAT: 2, LAUNDRY: 3, DRIP: 4, DRONE_PAD: 5, WORKER: 6, FLAG: 7 } as const;
/** One thing living on a roof: its anchor (feet, or a seated figure's floor level), its facing
 * (degrees for rotateY; figures face -z at 0) and a seed. */
export interface LifeItem { kind: number; x: number; y: number; z: number; facing: number; seed: number }

/** rotateY angle (degrees) that turns a -z-facing model toward (dx, dz) (as the interiors do). */
const heading = (dx: number, dz: number): number => Math.atan2(-dx, -dz) * DEG;
const smooth = (u: number): number => { const k = Math.max(0, Math.min(1, u)); return k * k * (3 - 2 * k); };
const wrap01 = (u: number): number => u - Math.floor(u);

const lives = new WeakMap<RoofSpot, readonly LifeItem[]>();
/**
 * What lives on a roof (deterministic, cached). Placement follows the roof kit's free zones
 * (architecture.ts): the parapet strip at the +x end of the -sz edge (the AC bank runs from the -x
 * end; tanks, greenhouses and chimneys keep off the edge), the -sx edge beside the bulkhead for a
 * laundry line, the (-sx, +sz) corner for a flag, and the +sx middle of Neon Ward roofs for a drone
 * pad. Dark towers stay dark (nothing at all), venues carry their own life (drawVenue), and a
 * helipad roof only a maintenance worker at its edge.
 */
export function roofLife(s: RoofSpot): readonly LifeItem[] {
  const cached = lives.get(s);
  if (cached) return cached;
  const items: LifeItem[] = [];
  lives.set(s, items);
  if (s.dark || s.venue >= 0 || s.w < 8 || s.d < 8) return items;
  const roll = (k: number) => randomFor(s.id, k, 8801);
  const W = s.w / 2, D = s.d / 2, outward = heading(0, -s.sz);
  const edge = (inset: number) => s.z - s.sz * (D - inset);
  const perch = roll(1), along = s.x + (0.72 + roll(2) * 0.12) * W;
  if (s.y > 90 && perch < 0.4) items.push({ kind: LIFE.WORKER, x: along, y: s.y, z: edge(0.7), facing: outward, seed: s.id });
  else if (!s.pad) {
    if (perch < 0.2) items.push({ kind: LIFE.SMOKER, x: along, y: s.y, z: edge(0.6), facing: outward, seed: s.id });
    else if (perch < 0.32) items.push({ kind: LIFE.COUPLE, x: s.x + 0.66 * W, y: s.y - 0.83, z: edge(0.25), facing: outward, seed: s.id });
    else if (perch < 0.42) items.push({ kind: LIFE.CAT, x: s.x + 0.86 * W, y: s.y, z: edge(0.2), facing: heading(1, 0), seed: s.id });
  }
  if (s.pad) return items;
  if (roll(3) < (s.district === 1 || s.district === 2 ? 0.1 : 0.3)) items.push({ kind: LIFE.LAUNDRY, x: s.x - s.sx * (W - 0.45), y: s.y, z: s.z, facing: 0, seed: s.id + 1 });
  if (s.tank && roll(4) < 0.6) items.push({ kind: LIFE.DRIP, x: s.tank[0] + 0.9, y: s.tank[1], z: s.tank[2] + 0.6, facing: 0, seed: s.id + 2 });
  if (s.district === 1 && roll(5) < 0.3) items.push({ kind: LIFE.DRONE_PAD, x: s.x + s.sx * 0.56 * W, y: s.y, z: s.z, facing: 0, seed: s.id + 3 });
  if (roll(6) < 0.22) items.push({ kind: LIFE.FLAG, x: s.x - s.sx * (W - 0.35), y: s.y, z: s.z + s.sz * (D - 0.35), facing: 0, seed: s.id + 4 });
  return items;
}

/** A spinner on its landing cycle: position (m, the skids' underside), heading (rotateY degrees,
 * constant: it flies one straight line in, sits, and carries on out), rotor angle and fade (0..1,
 * eased over the first and last 6 s so it dissolves in and out instead of popping). */
export interface SpinnerState { x: number; y: number; z: number; heading: number; rotor: number; fade: number; phase: "approach" | "sit" | "leave" }
/** Where a heliport's spinner is at `time`, or null while it is away. Approach 30 s (it glides in
 * over the first 22 s and settles straight down for the rest), sit 60 s, leave 30 s (it lifts
 * first, then flies on). */
export function spinnerAt(s: RoofSpot, time: number): SpinnerState | null {
  const { approach, sit, leave, period } = SPINNER_CYCLE;
  const local = wrap01(time / period + randomFor(s.id, 1, 9921)) * period;
  if (local >= approach + sit + leave) return null;
  const bearing = randomFor(s.id, 2, 9922) * TAU, ux = Math.cos(bearing), uz = Math.sin(bearing);
  // It travels toward -u the whole time: in from the +u side, out on the -u side.
  const facing = heading(-ux, -uz), rotor = wrap01(time * ROTOR_DEG_PER_S / 360) * 360;
  let along = 0, lift = 0, fade = 1, phase: SpinnerState["phase"] = "sit";
  if (local < approach) {
    const u = local / approach;
    along = SPINNER_RUN * (1 - smooth(u / 0.75)); lift = SPINNER_HIGH * (1 - smooth(u)); fade = smooth(local / 6); phase = "approach";
  } else if (local >= approach + sit) {
    const t = local - approach - sit, u = t / leave;
    along = -SPINNER_RUN * smooth((u - 0.25) / 0.75); lift = SPINNER_HIGH * smooth(u); fade = smooth((leave - t) / 6); phase = "leave";
  }
  return { x: s.x + ux * along, y: s.y + 0.6 + lift, z: s.z + uz * along, heading: facing, rotor, fade, phase };
}

// --- drawing -------------------------------------------------------------------------------------

function box(t: PropCanvas, x: number, y: number, z: number, w: number, h: number, d: number): void {
  t.translate(x, -y, z); t.box(w, h, d); t.translate(-x, y, -z);
}
function blob(t: PropCanvas, x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
  t.translate(x, -y, z); t.ellipsoid(rx, ry, rz); t.translate(-x, y, -z);
}
/** A straight member from a to b (y up), `w` thick. */
function strut(t: PropCanvas, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number): void {
  const dx = bx - ax, dy = ay - by, dz = bz - az; // textmode Y points down
  t.push(); t.translate((ax + bx) / 2, -(ay + by) / 2, (az + bz) / 2);
  t.rotateY(Math.atan2(dx, dz) * DEG); t.rotateX(Math.atan2(Math.hypot(dx, dz), dy) * DEG);
  t.box(w, Math.hypot(dx, dy, dz), w); t.pop();
}
/** Paper lanterns hang this far apart along their strings (m). */
const LANTERN_STEP = 1.2;
/**
 * A sagging string of paper lanterns from a to b: the wire is a continuous catenary of lit glyphs
 * (one segment per lantern, never thinner than about a cell), a lantern hangs every LANTERN_STEP m
 * and, while the camera is within `poolReach`, a dim pool of each lantern's light lies on the
 * deck under it (`pool`: the deck top, or null for none). `size` scales the lanterns.
 */
function lanternString(t: PropCanvas, kit: StreetKit, a: readonly [number, number, number], b: readonly [number, number, number], sag: number, distance: number, time: number, colors: readonly RGB[], seed: number, pool: number | null, poolReach: number, size = 1): void {
  const at = (s: number): [number, number, number] => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s - sag * 4 * s * (1 - s), a[2] + (b[2] - a[2]) * s];
  const line = Math.max(0.05, distance * LINE_PER_METRE);
  const count = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / LANTERN_STEP));
  kit.paint(t, [255, 168, 96], "-", 0.6);
  for (let k = 0; k < count; k++) strut(t, ...at(k / count), ...at((k + 1) / count), line);
  const r = Math.max(0.17 * size, line * 0.6);
  for (let k = 1; k < count; k++) {
    const [x, y, z] = at(k / count);
    kit.paint(t, colors[(k + seed) % colors.length], "o", 1.1 + 0.1 * Math.sin(time * TAU * ROOF_RATES.bulbShimmer + k * 1.7));
    blob(t, x, y - 0.22 * size, z, r, r * 1.25, r);
  }
  if (pool === null || distance > poolReach + 12) return;
  const keep = kit.range(poolReach);
  for (let k = 1; k < count; k++) {
    const [x, , z] = at(k / count);
    kit.paint(t, colors[(k + seed) % colors.length], ".", 0.5); box(t, x, pool + 0.05, z, 1.1 * size, 0.04, 1.1 * size);
  }
  kit.restore(keep);
}

const SKINS: readonly RGB[] = [[196, 157, 124], [150, 108, 80], [224, 186, 150], [110, 78, 60]];
const COATS: readonly RGB[] = [[60, 70, 92], [110, 52, 64], [52, 84, 74], [96, 84, 60], [70, 56, 96], [40, 44, 52]];
function lookFor(seed: number, coat?: RGB, headwear: NpcLook["headwear"] = "bare"): NpcLook {
  const n = Math.abs(Math.floor(seed));
  return { coat: coat ?? COATS[n % COATS.length], trim: [44, 50, 60], skin: SKINS[(n >> 2) % SKINS.length], light: DISTRICTS[n % DISTRICTS.length].color, headwear, prop: null, idle: "breathe" };
}
function figure(t: PropCanvas, kit: StreetKit, x: number, y: number, z: number, facing: number, look: NpcLook, time: number, seed: number, distance: number, pose: Partial<HumanPose> = {}): void {
  t.push(); t.translate(x, -y, z); t.rotateY(facing);
  drawHuman(t, look, { time, seed, stride: 0, moving: false, detail: distance < 18, distant: distance > 45, ...pose }, kit.paint);
  t.pop();
}

/** One roof's life item. */
function drawItem(t: PropCanvas, kit: StreetKit, s: RoofSpot, item: LifeItem, distance: number, time: number, gust: number, wind: { x: number; z: number }): void {
  const line = Math.max(0.06, distance * LINE_PER_METRE), { x, y, z, facing, seed } = item;
  switch (item.kind) {
    case LIFE.SMOKER: {
      figure(t, kit, x, y, z, facing, lookFor(seed), time, seed, distance);
      // The ember: one glyph at the lips, swelling over 2 s and fading over 2 s once every ~20 s.
      const p = wrap01(time * ROOF_RATES.emberCycle + randomFor(seed, 0, 8803)) / ROOF_RATES.emberCycle;
      const swell = p < 1 / ROOF_RATES.emberSwell ? 0.5 - 0.5 * Math.cos(TAU * p * ROOF_RATES.emberSwell) : 0;
      t.push(); t.translate(x, -y, z); t.rotateY(facing);
      kit.paint(t, [255, 128, 64], "*", 0.45 + 0.85 * swell); const size = Math.max(0.1, line); box(t, 0.12, 2.3, -0.32, size, size, size);
      t.pop();
      return;
    }
    case LIFE.COUPLE: {
      // Side by side on the parapet, legs over the edge, one turned a little toward the other.
      // The second sits 0.85 m along the parapet (the figure's right: (cos f, -sin f) for facing f).
      const f = facing / DEG, rx = Math.cos(f), rz = -Math.sin(f);
      for (const k of [0, 1]) {
        const off = k ? 0.85 : 0;
        figure(t, kit, x + rx * off, y, z + rz * off, facing, lookFor(seed + k * 3), time, seed + k, distance, { seated: true, talking: k === 0, glance: k === 0 ? 0.35 : 0 });
      }
      return;
    }
    case LIFE.CAT: {
      if (distance > 70) return;
      t.push(); t.translate(x, -y, z); t.rotateY(facing);
      kit.paint(t, [44, 42, 48], "%"); blob(t, 0, 0.22, 0, 0.17, 0.22, 0.28); blob(t, 0, 0.5, -0.18, 0.12, 0.11, 0.12);
      box(t, -0.06, 0.62, -0.18, 0.05, 0.07, 0.04); box(t, 0.06, 0.62, -0.18, 0.05, 0.07, 0.04);
      // The tail curls round and swishes slowly.
      t.push(); t.translate(0, -0.08, 0.26); t.rotateY(25 * Math.sin(time * TAU * ROOF_RATES.catTail + seed)); t.box(0.05, 0.05, 0.42); t.pop();
      if (distance < 35) { kit.paint(t, [150, 255, 140], ".", 0.9); for (const e of [-0.045, 0.045]) box(t, e, 0.52, -0.29, 0.03, 0.03, 0.02); }
      t.pop();
      return;
    }
    case LIFE.LAUNDRY: {
      if (distance > 120) return;
      // Two posts, a line along z, cloths swinging away from the wind (more in a gust).
      const span = s.d * 0.44, top = y + 2.4;
      kit.paint(t, [58, 60, 66], "|");
      for (const e of [-1, 1]) box(t, x, y + 1.2, z + e * span / 2, 0.08, 2.4, 0.08);
      kit.paint(t, [40, 42, 46], "-"); box(t, x, top, z, Math.max(0.03, line), Math.max(0.03, line), span);
      const lean = Math.sign(wind.x) || 1;
      for (let k = 0; k < 5; k++) {
        const h = 0.6 + randomFor(seed, k, 8805) * 0.6, cz = z - span / 2 + span * (k + 0.5) / 5;
        const swing = lean * (4 + gust * 24) * (0.65 + 0.35 * Math.sin(time * TAU * ROOF_RATES.laundrySway + k * 1.3));
        kit.paint(t, COATS[(seed + k) % COATS.length], k % 2 ? "=" : "#", 0.9);
        t.push(); t.translate(x, -top, cz); t.rotateZ(swing); t.translate(0, h / 2, 0); t.box(Math.max(0.04, line), h, 0.5 + randomFor(seed, k, 8806) * 0.3); t.pop();
      }
      return;
    }
    case LIFE.DRIP: {
      if (distance > 40) return;
      // A drop swells under the tank for 3.2 s, then falls to the roof (gravity, 0.7 s).
      const p = wrap01(time * ROOF_RATES.drip + randomFor(seed, 0, 8807)) / ROOF_RATES.drip;
      kit.paint(t, [36, 52, 64], "_"); box(t, x, s.y + 0.02, z, 0.6, 0.03, 0.45);
      kit.paint(t, [150, 200, 230], ".", 0.85);
      if (p < 3.2) { const r = 0.03 + 0.04 * (p / 3.2); box(t, x, y - r, z, r * 2, r * 2, r * 2); }
      else { const fall = 4.9 * (p - 3.2) * (p - 3.2), dy = y - 0.07 - fall; if (dy > s.y + 0.05) box(t, x, dy, z, 0.06, 0.1, 0.06); }
      return;
    }
    case LIFE.DRONE_PAD: {
      kit.paint(t, [34, 38, 44], "#"); box(t, x, y + 0.03, z, 2.8, 0.06, 2.8);
      kit.paint(t, [170, 180, 196], "+", 0.6); box(t, x, y + 0.07, z, 1.6, 0.03, 0.14); box(t, x, y + 0.07, z, 0.14, 0.03, 1.6);
      // Approach lights: a single soft swell walks round the four corners every 8 s.
      const size = Math.max(0.18, line);
      for (let i = 0; i < 4; i++) {
        const v = 0.5 + 0.5 * Math.cos(TAU * (time * ROOF_RATES.padLights - i / 4));
        kit.paint(t, [255, 190, 96], "o", 0.25 + 0.9 * v * v * v);
        box(t, x + (i === 0 || i === 3 ? -1.3 : 1.3), y + 0.12, z + (i < 2 ? -1.3 : 1.3), size, size, size);
      }
      return;
    }
    case LIFE.WORKER: {
      figure(t, kit, x, y, z, facing, lookFor(seed, [230, 120, 40], "cap"), time, seed, distance, { lean: 12, headPitch: 20 });
      // The torch: a pale shaft from the hand over the parapet and down the facade, sweeping slowly.
      const f = facing / DEG, fx = -Math.sin(f), fz = -Math.cos(f), rx = Math.cos(f), rz = -Math.sin(f);
      const sweep = 25 / DEG * Math.sin(time * TAU * ROOF_RATES.torchSweep + seed);
      const dx = fx * Math.cos(sweep) + rx * Math.sin(sweep), dz = fz * Math.cos(sweep) + rz * Math.sin(sweep);
      const hx = x + rx * 0.35 + fx * 0.35, hz = z + rz * 0.35 + fz * 0.35, hy = y + 1.5;
      kit.paint(t, [255, 236, 190], ":", 0.55); strut(t, hx, hy, hz, hx + dx * 3.4, y - 2.2, hz + dz * 3.4, Math.max(0.12, line));
      kit.paint(t, [255, 244, 210], "*", 1.05); const size = Math.max(0.12, line); box(t, hx, hy, hz, size, size, size);
      return;
    }
    case LIFE.FLAG: {
      if (distance > 150) return;
      const pole = 4.2, color = DISTRICTS[s.district].color;
      kit.paint(t, [70, 74, 80], "|"); box(t, x, y + pole / 2, z, 0.12, pole, 0.12);
      // The cloth streams downwind in two panels, rippling slowly (rotateY(a) turns local +x to
      // (cos a, -sin a), so a = atan2(-wind z, wind x) points it downwind).
      const yaw = Math.atan2(-wind.z, wind.x) * DEG;
      kit.paint(t, color, "=", 0.75);
      t.push(); t.translate(x, -(y + pole - 0.55), z); t.rotateY(yaw + 8 * Math.sin(time * TAU * ROOF_RATES.flagRipple + seed));
      t.translate(0.45, 0, 0); t.box(0.9, 1, Math.max(0.04, line));
      t.translate(0.45, 0, 0); t.rotateY(10 * Math.sin(time * TAU * ROOF_RATES.flagRipple + seed + 1.2)); t.translate(0.4, 0, 0); t.box(0.8, 0.95, Math.max(0.04, line));
      t.pop();
      return;
    }
  }
}

/** Deck height (m): the planking or paving a venue lays over its half of the roof. */
const DECK = 0.14;
/** Venue detail tiers (m from the roof): small things (bottles, glasses, stools, planters, pools of
 * light) dissolve out by VENUE_NEAR; figures, furniture, the parapet wall and guy wires by
 * VENUE_MID; the bar's name sign by VENUE_SIGN. The deck, its lit rail, the lanterns and the lit
 * fittings (windows, heater, grow-light washes) carry on to ROOF_LIFE_REACH. Each tier closes
 * through the prop draw range, so nothing pops. */
const VENUE_NEAR = 80, VENUE_MID = 130, VENUE_SIGN = 160;
/** Each venue kind's deck (`deck` close up, shading into `glow` from 60 to 130 m out, so from the
 * air every venue reads as a pool of its own light on a dark roof), its glyph and the parapet's
 * lit rail. Indexed by VENUE kind. */
const VENUE_LOOK: readonly { deck: RGB; deckGain: number; glow: RGB; glowGain: number; glyph: string; rail: RGB }[] = [
  { deck: [96, 58, 42], deckGain: 0.6, glow: [255, 112, 52], glowGain: 0.5, glyph: ".", rail: [255, 120, 50] }, // forge vent: scorched plate
  { deck: [138, 104, 76], deckGain: 0.8, glow: [255, 150, 90], glowGain: 0.6, glyph: "=", rail: [255, 80, 170] }, // bar: planking
  { deck: [56, 62, 78], deckGain: 0.7, glow: [110, 150, 255], glowGain: 0.5, glyph: "+", rail: [104, 146, 255] }, // pirate radio: grating
  { deck: [60, 74, 64], deckGain: 0.7, glow: [200, 110, 230], glowGain: 0.5, glyph: ":", rail: [140, 255, 190] }, // terrace farm: wet paving
  { deck: [124, 116, 98], deckGain: 0.7, glow: [255, 196, 120], glowGain: 0.55, glyph: ".", rail: [255, 196, 110] }, // garden: pale paving
  { deck: [104, 84, 62], deckGain: 0.7, glow: [255, 180, 100], glowGain: 0.5, glyph: "=", rail: [255, 200, 100] }, // pigeon loft: boards
];
const LANTERNS: readonly RGB[] = [[255, 176, 96], [255, 128, 72], [255, 214, 140], [255, 92, 150]];
const FAIRY: readonly RGB[] = [[255, 214, 140], [255, 176, 96]];
const BOTTLES: readonly RGB[] = [[120, 230, 140], [255, 190, 90], [90, 200, 255], [255, 110, 150], [230, 230, 200]];
const BAR_NAMES: readonly string[] = ["BAR", "SKY", "HIGH", "ROOF", "TOPS", "BAR9"];
const tone = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const signSeeds = new Map<number, number>();
/** A bar sign's seed for the sign shader (materials.ts): one that neither scrolls as a marquee
 * (mode 1) nor carries a dead letter, so the name is always whole and still. */
function barSignSeed(id: number): number {
  const known = signSeeds.get(id);
  if (known !== undefined) return known;
  let seed = 0;
  for (let k = 0; k < 64; k++) {
    const r = randomFor(id, k, 8813);
    if (Math.floor(r * 97) % 4 !== 1 && (r * 17.3) % 1 <= 0.8) { seed = r; break; }
  }
  signSeeds.set(id, seed);
  return seed;
}

/** The animated half of a rooftop venue (its static kit is in the building batch). Every venue
 * lays a deck over its half of the roof (a dark drip edge under it), a parapet with a lit rail
 * round its three roof edges and its own lit fittings; `eye` picks which face of a sign to draw. */
function drawVenue(t: PropCanvas, kit: StreetKit, s: RoofSpot, distance: number, time: number, wind: { x: number; z: number }, eye: { x: number; z: number }): void {
  const L = venueLayout(s.w, s.d), y = s.y, line = Math.max(0.06, distance * LINE_PER_METRE);
  const W = s.w / 2, D = s.d / 2, [x0, x1, halfZ] = L.deck, top = y + DECK;
  const at = (ox: number, oz: number): [number, number] => [s.x + s.sx * ox, s.z + s.sz * oz];
  /** A box standing `lift` above the roof at mirrored offset (ox, oz), w along x and d along z. */
  const put = (ox: number, oz: number, w: number, h: number, d: number, lift = 0): void => box(t, s.x + s.sx * ox, y + lift + h / 2, s.z + s.sz * oz, w, h, d);
  /** A dim pool of light on the deck; overlapping pools take different layers (5 cm apart). */
  const pool = (ox: number, oz: number, w: number, d: number, color: RGB, gain: number, layer: number): void => {
    kit.paint(t, color, ".", gain); put(ox, oz, w, 0.04, d, DECK + 0.03 + 0.05 * layer);
  };
  const inward = heading(-s.sx, 0), outward = heading(s.sx, 0);
  const near = distance < VENUE_NEAR + 12, mid = distance < VENUE_MID + 12;
  // The deck: planking or paving over a dark drip edge, shading into the venue's light with distance.
  const look = VENUE_LOOK[s.venue], far = smooth((distance - 60) / 70);
  kit.paint(t, [26, 24, 30], "_"); put((x0 + x1) / 2, 0, x1 - x0 + 0.24, 0.09, 2 * halfZ + 0.24);
  kit.paint(t, tone(look.deck, look.glow, far), look.glyph, look.deckGain + (look.glowGain - look.deckGain) * far);
  put((x0 + x1) / 2, 0, x1 - x0, DECK, 2 * halfZ);
  // The parapet round the venue's three roof edges, and its lit rail (drawn at any distance: from
  // the air it outlines the venue; never thinner than about a cell).
  const along = (x0 + W) / 2, run = W - x0, wall = 0.6, rail = Math.max(0.1, line * 0.8);
  if (mid) {
    const keep = kit.range(VENUE_MID);
    kit.paint(t, [50, 52, 60], "#", 0.7);
    put(W - 0.1, 0, 0.18, wall, 2 * D - 0.02);
    for (const e of [-1, 1]) put(along, e * (D - 0.1), run, wall, 0.18);
    kit.restore(keep);
  }
  kit.paint(t, look.rail, "-", 0.85);
  put(W - 0.1, 0, rail, rail, 2 * D - 0.02, wall);
  for (const e of [-1, 1]) put(along, e * (D - 0.1), run, rail, rail, wall);
  switch (s.venue) {
    case VENUE.BAR: {
      const B = L.bar, [hx, hz] = B.heater;
      // Paper lanterns: one string across the lounge between the poles, one from each pole to the
      // back bar's top corners; their pools of light lie on the deck in two layers (the cross
      // string's under the others where they meet at the poles).
      const [p0x, p0z] = at(B.pole, B.poleZ), [p1x, p1z] = at(B.pole, -B.poleZ), [bx, bz0] = at(B.back, B.span * 0.42), [, bz1] = at(B.back, -B.span * 0.42);
      const poleTop = y + B.poleH, backTop = y + B.backH;
      lanternString(t, kit, [p0x, poleTop, p0z], [p1x, poleTop, p1z], 0.6, distance, time, LANTERNS, 0, top, VENUE_NEAR);
      lanternString(t, kit, [p0x, poleTop, p0z], [bx, backTop, bz0], 0.5, distance, time, LANTERNS, 1, top + 0.05, VENUE_NEAR);
      lanternString(t, kit, [p1x, poleTop, p1z], [bx, backTop, bz1], 0.5, distance, time, LANTERNS, 2, top + 0.05, VENUE_NEAR);
      // The patio heater's glowing column, breathing slowly (at any distance).
      const g = Math.max(0.26, line);
      kit.paint(t, [255, 118, 48], "#", 0.95 + 0.2 * Math.sin(time * TAU * ROOF_RATES.heaterGlow + s.id)); put(hx, hz, g, 0.8, g, DECK + 1.2);
      // The bar's name standing on the bulkhead roof in a dark frame, lit on both faces (signage.ts
      // letter panels, captured with the shop panels; the tag is the distance).
      if (distance < VENUE_SIGN + 12) {
        const keep = kit.range(VENUE_SIGN), bh = L.bulkhead, sign = B.sign;
        kit.paint(t, [30, 28, 36], "#", 0.8);
        put(bh.x, 0, 0.14, sign.h + 0.2, sign.width + 0.2, sign.lift - 0.1);
        for (const e of [-1, 1]) put(bh.x, e * sign.width * 0.35, 0.1, sign.lift - 0.1 - bh.h, 0.1, bh.h);
        const recorder = t instanceof PropRecorder ? t : null, tag = recorder ? recorder.panelTag : -1;
        if (recorder) recorder.panelTag = distance;
        for (const e of [-1, 1]) {
          // Face e looks along e * sx; it is drawn only from in front (12 cm proud of the frame).
          const yaw = e * s.sx * 90, angle = yaw * Math.PI / 180, [fx, fz] = at(bh.x + e * 0.19, 0);
          if ((eye.x - fx) * Math.sin(angle) + (eye.z - fz) * Math.cos(angle) <= 0) continue;
          drawLetterPanel(t, {
            x: fx, y: y + sign.lift + sign.h / 2, z: fz, yaw, width: sign.width, height: sign.h, text: BAR_NAMES[s.id % BAR_NAMES.length],
            color: s.id % 2 ? [90, 230, 255] : DISTRICTS[1].color, seed: barSignSeed(s.id), style: signStyle(SIGN_FORMAT.classic, s.district),
          });
        }
        if (recorder) recorder.panelTag = tag;
        kit.restore(keep);
      }
      if (mid) {
        const keep = kit.range(VENUE_MID);
        // The heater's post, foot and hood.
        kit.paint(t, [60, 60, 66], "|"); put(hx, hz, 0.12, 2.1, 0.12, DECK); put(hx, hz, 0.5, 0.08, 0.5, DECK);
        kit.paint(t, [74, 76, 84], "^"); const [qx, qz] = at(hx, hz); blob(t, qx, top + 2.2, qz, 0.6, 0.12, 0.6);
        // Tables with a lamp on each; a pair seated across each of the first two.
        B.tables.forEach(([tx, tz], i) => {
          kit.paint(t, [64, 54, 52], "o", 0.8); put(tx, tz, 0.08, 0.72, 0.08, DECK); put(tx, tz, 0.84, 0.06, 0.84, DECK + 0.72);
          const c = Math.max(0.12, line * 0.7);
          kit.paint(t, [255, 196, 120], "*", 1.2); put(tx, tz, c, c, c, DECK + 0.78);
          if (i > 1) return;
          for (const e of [-1, 1]) {
            const [fx, fz] = at(tx + e * 0.72, tz), seed = s.id + i * 7 + e + 2;
            figure(t, kit, fx, top, fz, heading(-e * s.sx, 0), lookFor(seed), time, seed, distance, { seated: true, seatHeight: 0.62, talking: e > 0, glance: e * 0.3 });
          }
        });
        // The keeper behind the counter, a drinker on a bar stool and one leaning on the parapet, looking out.
        const [kx, kz] = at(B.keeper, 0), [gx, gz] = at(B.stools, B.span * 0.2), [lx, lz] = at(B.leaner[0], B.leaner[1]);
        figure(t, kit, kx, top, kz, inward, lookFor(s.id, [40, 40, 52]), time, s.id, distance, { talking: true });
        figure(t, kit, gx, top, gz, outward, lookFor(s.id + 5), time, s.id + 5, distance, { seated: true, seatHeight: 0.8, glance: -0.4 });
        figure(t, kit, lx, top, lz, heading(0, s.sz), lookFor(s.id + 9), time, s.id + 9, distance, { lean: 14, headPitch: 10 });
        kit.restore(keep);
      }
      if (near) {
        const keep = kit.range(VENUE_NEAR);
        // Stools: two at each table, two at the bar.
        kit.paint(t, [96, 72, 66], "o", 0.8);
        for (const [tx, tz] of B.tables) for (const e of [-1, 1]) put(tx + e * 0.72, tz, 0.36, 0.6, 0.36, DECK);
        for (const e of [-1, 1]) put(B.stools, e * B.span * 0.2, 0.34, 0.78, 0.34, DECK);
        // The back bar's two shelves of bottles facing the room, each over a lit strip.
        const shelf = B.back - 0.29, seg = B.span * 0.84 / 4, strip = Math.max(0.05, line * 0.5);
        for (let row = 0; row < 2; row++) {
          const lift = 1 + row * 0.5;
          kit.paint(t, [255, 206, 150], "_", 0.9); put(shelf, 0, 0.12, strip, B.span * 0.84, lift - strip);
          for (let k = 0; k < 4; k++) {
            kit.paint(t, BOTTLES[(k + row * 2 + s.id) % BOTTLES.length], "i", 1.1);
            put(shelf, -B.span * 0.42 + seg * (k + 0.5), 0.1, 0.3, seg - 0.12, lift);
          }
        }
        // A glass on the counter at each bar stool.
        kit.paint(t, [255, 200, 140], "i", 0.8);
        for (const e of [-1, 1]) put(B.counter - 0.25, e * B.span * 0.2, 0.12, 0.28, 0.12, 1.4);
        // Planters along the side parapets, clear of the lantern poles.
        for (const e of [-1, 1]) for (let k = 0; k < 3; k++) {
          const px = x0 + 0.7 + k * (W - 3.9 - x0) / 2;
          if (Math.abs(px - B.pole) < 0.8) continue;
          kit.paint(t, [58, 48, 42], "#", 0.7); put(px, e * (D - 0.55), 0.9, 0.45, 0.5, DECK);
          const [qx, qz] = at(px, e * (D - 0.55));
          kit.paint(t, [96, 200, 120], "&", 0.8); blob(t, qx, top + 0.6, qz, 0.42, 0.28, 0.26);
        }
        // Warm pools round the heater and under each table lamp (above the lanterns' pools).
        pool(hx, hz, 2, 2, [255, 120, 60], 0.45, 2);
        for (const [tx, tz] of B.tables) pool(tx, tz, 1.4, 1.4, [255, 190, 120], 0.4, 2);
        kit.restore(keep);
      }
      return;
    }
    case VENUE.GARDEN: {
      const { gardener, lantern, rows, rowX, house } = L.garden, [hx0, hx1, hz0, hz1] = house, hcx = (hx0 + hx1) / 2, hcz = (hz0 + hz1) / 2;
      // The glasshouse lit from inside: plants crowding its panes on the three faces that look
      // over the roof (10 cm proud of the glass), and fairy lights along the eave (any distance).
      kit.paint(t, [150, 226, 120], "&", 0.95);
      put(hcx, hz0 - 0.1, hx1 - hx0 - 0.5, 1.6, 0.05, 0.35);
      for (const e of [-1, 1]) put(e > 0 ? hx1 + 0.1 : hx0 - 0.1, hcz, 0.05, 1.6, hz1 - hz0 - 0.5, 0.35);
      const [ax, az] = at(hx0, hz0 - 0.25), [bx, bz] = at(hx1, hz0 - 0.25);
      lanternString(t, kit, [ax, y + 2.4, az], [bx, y + 2.4, bz], 0.12, distance, time, FAIRY, s.id, null, 0, 0.6);
      // A paper lantern on a crook post, swaying a little.
      const [lx, lz] = at(lantern[0], lantern[1]);
      kit.paint(t, [60, 52, 44], "|"); box(t, lx, y + 1.4, lz, 0.1, 2.8, 0.1); box(t, lx - s.sx * 0.3, y + 2.8, lz, 0.6, 0.08, 0.08);
      const swayX = 0.06 * Math.sin(time * TAU * ROOF_RATES.lanternSway + s.id);
      kit.paint(t, [255, 170, 90], "o", 1.0); const r = Math.max(0.24, line * 0.5); blob(t, lx - s.sx * 0.55 + swayX, y + 2.35, lz, r, Math.max(0.32, r), r);
      if (mid) {
        const keep = kit.range(VENUE_MID), [gx, gz] = at(gardener[0], gardener[1]);
        figure(t, kit, gx, top, gz, heading(0, -s.sz), lookFor(s.id, [52, 84, 74]), time, s.id, distance, { lean: 24, headPitch: 18 });
        kit.restore(keep);
      }
      if (near) {
        const keep = kit.range(VENUE_NEAR);
        // Greens spilling over the planter rows.
        for (const row of rows) for (let k = 0; k < 4; k++) {
          const [qx, qz] = at(rowX[0] + (rowX[1] - rowX[0]) * (k + 0.5) / 4, -row);
          kit.paint(t, k % 2 ? [110, 210, 120] : [170, 220, 100], k % 2 ? "&" : "*", 0.85); blob(t, qx, y + 0.95, qz, (rowX[1] - rowX[0]) / 9, 0.32, 0.5);
        }
        // The glasshouse's light on the paving before it, and the lantern's under it.
        pool(hcx, hz0 - 1, hx1 - hx0, 1.4, [255, 200, 130], 0.45, 0);
        pool(lantern[0] - 0.55, lantern[1], 1.2, 1.2, [255, 170, 90], 0.45, 1);
        kit.restore(keep);
      }
      return;
    }
    case VENUE.FARM: {
      const { racks, rackZ, farmer } = L.farm, wash = Math.min(1.9, W / 2 - 0.75);
      racks.forEach((rx, i) => {
        const glow: RGB = i % 2 ? [110, 130, 255] : [255, 90, 200];
        // The grow lights' pink or blue wash on the deck (any distance: from the air the farm reads
        // as bands of it), and the long light bar along the rack's top.
        pool(rx, 0, wash, rackZ * 2 + 0.6, glow, 0.45, 0);
        kit.paint(t, glow, "=", 1.15); put(rx, 0, 0.8, Math.max(0.1, line * 0.5), rackZ * 2, 1.62);
      });
      if (mid) {
        const keep = kit.range(VENUE_MID), [fx, fz] = at(farmer[0], farmer[1]);
        figure(t, kit, fx, top, fz, heading(0, s.sz), lookFor(s.id, [96, 84, 60], "cap"), time, s.id, distance, { arms: "wrist" });
        kit.restore(keep);
      }
      if (near) {
        // Greens on the rack shelves.
        const keep = kit.range(VENUE_NEAR);
        kit.paint(t, [110, 220, 120], "&", 0.85);
        for (const rx of racks) for (const lift of [0.5, 1.1]) put(rx, 0, 0.8, 0.32, rackZ * 1.9, lift);
        kit.restore(keep);
      }
      return;
    }
    case VENUE.RADIO: {
      const { shack, dishY } = L.radio, [dx, dz] = at(shack[0], shack[1]);
      // The dish sweeps slowly, +-40 degrees over 50 s, tilted up at the sky.
      t.push(); t.translate(dx, -(y + dishY), dz); t.rotateY(heading(s.sx, s.sz) + 40 * Math.sin(time * TAU * ROOF_RATES.dishSweep + s.id)); t.rotateX(-30);
      kit.paint(t, [150, 160, 176], "(", 0.9); t.ellipsoid(1.05, 1.05, 0.22);
      kit.paint(t, [90, 96, 110], "-"); t.translate(0, 0, -0.55); t.box(0.07, 0.07, 0.9);
      kit.paint(t, [255, 70, 60], "*", 0.9); t.translate(0, 0, -0.45); t.box(Math.max(0.12, line), Math.max(0.12, line), Math.max(0.12, line));
      t.pop();
      // An ON AIR lamp over the door, steady.
      const [ox, oz] = at(shack[0], shack[1] - 1.32);
      kit.paint(t, [255, 64, 52], "=", 1.0); box(t, ox, y + 2.05, oz, Math.max(0.6, line), Math.max(0.24, line), 0.05);
      // The shack's lit windows (screens and a desk lamp inside) on its two faces into the roof,
      // 9 cm proud of the tin (any distance).
      kit.paint(t, [150, 200, 255], "#", 1.1);
      put(shack[0], shack[1] + 1.39, 1.8, 1, 0.06, 1);
      put(shack[0] + 1.59, shack[1], 0.06, 1, 1.2, 1);
      if (mid) {
        // Guy wires from the mast, and the operator out by the door with a smoke.
        const keep = kit.range(VENUE_MID), { mast, mastH } = L.radio, [mx, mz] = at(mast[0], mast[1]), a = Math.min(2.5, 0.4 * W);
        kit.paint(t, [70, 76, 90], "-");
        for (const [wx0, wz0] of [[mast[0] - a, mast[1]], [mast[0] + a, mast[1]], [mast[0], mast[1] - 2.5]]) {
          const [wx, wz] = at(wx0, wz0);
          strut(t, mx, y + mastH - 3, mz, wx, top, wz, line);
        }
        const [px, pz] = at(shack[0] + 0.9, shack[1] - 1.9);
        figure(t, kit, px, top, pz, heading(0, -s.sz), lookFor(s.id + 3), time, s.id + 3, distance, { arms: "smoke" });
        kit.restore(keep);
      }
      if (near) {
        const keep = kit.range(VENUE_NEAR);
        pool(shack[0], shack[1] + 2.2, 2.6, 1.4, [120, 170, 255], 0.45, 0);
        pool(shack[0] + 2.2, shack[1], 1.2, 1.8, [120, 170, 255], 0.45, 0);
        kit.restore(keep);
      }
      return;
    }
    case VENUE.LOFT: {
      const { hut, keeper, cageTop } = L.loft, [hx, hz] = at(hut[0], hut[1]);
      // The lit hutch: a warm doorway on the face toward the stairs (any distance) and, close by,
      // a row of glowing nest holes along its front.
      kit.paint(t, [255, 190, 110], "#", 1.1); put(hut[0] - 1.79, hut[1], 0.06, 1.3, 1, DECK);
      if (mid) {
        const keep = kit.range(VENUE_MID), [kx, kz] = at(keeper[0], keeper[1]);
        figure(t, kit, kx, top, kz, heading(hx - kx, hz - kz), lookFor(s.id, [96, 84, 60], "cap"), time, s.id, distance, { arms: "feed" });
        kit.restore(keep);
      }
      if (near) {
        const keep = kit.range(VENUE_NEAR);
        kit.paint(t, [255, 170, 90], "o", 0.95);
        for (let k = 0; k < 4; k++) put(hut[0] - 1.2 + k * 0.8, hut[1] + 1.59, 0.36, 0.3, 0.06, 1.5);
        pool(hut[0] - 2.6, hut[1], 1.6, 1.8, [255, 180, 100], 0.45, 0);
        kit.restore(keep);
      }
      if (distance > 172) return;
      // Pigeons wheeling round the loft: wide slow circles, rising and falling a little.
      const birds = kit.range(160), turn = s.id % 2 ? 1 : -1, size = Math.max(0.5, line);
      kit.paint(t, [150, 150, 162], "v", 0.85);
      for (let i = 0; i < 7; i++) {
        const a = turn * time * TAU * ROOF_RATES.pigeonOrbit + i * TAU / 7 + 0.3 * Math.sin(i * 2.1);
        const radius = 5.5 + 1.2 * Math.sin(time * 0.2 + i), by = y + cageTop + 2.5 + 1.5 * Math.sin(time * 0.25 + i * 1.3);
        const bx = hx + Math.cos(a) * radius, bz = hz + Math.sin(a) * radius;
        if (distance > 40) { box(t, bx, by, bz, size, size * 0.5, size); continue; }
        t.push(); t.translate(bx, -by, bz); t.rotateY(heading(-Math.sin(a) * turn, Math.cos(a) * turn));
        t.box(0.9, 0.04, 0.22); blob(t, 0, 0, 0, 0.12, 0.1, 0.2); t.pop();
      }
      kit.restore(birds);
      return;
    }
    case VENUE.FORGE: {
      const { hood, stackTop } = L.forge, [hx, hz] = at(hood[0], hood[1]), stack = y + stackTop;
      const breathe = Math.sin(time * TAU * ROOF_RATES.forgeGlow + s.id);
      // The forge's warm wash on the roof round the hood, breathing with its glow (any distance).
      pool(hood[0], hood[1], Math.min(5, 0.9 * W - 0.4), Math.min(5, 2 * halfZ), [255, 110, 50], 0.4 + 0.1 * breathe, 0);
      kit.paint(t, [255, 110, 50], "o", 0.5 + 0.2 * breathe); blob(t, hx, stack + 0.4, hz, 0.8, 0.5, 0.8);
      // Embers rising slowly from the stack and drifting downwind, each fading in and out.
      const size = Math.max(0.18, line * 0.9);
      for (let i = 0; i < 8; i++) {
        const a = wrap01(time * ROOF_RATES.embers + i / 8), rise = a / ROOF_RATES.embers;
        const glow = Math.pow(1 - a, 1.5) * smooth(a / 0.08);
        if (glow < 0.05) continue; // born and spent below a visible glow, so nothing pops
        kit.paint(t, i % 3 ? [255, 120, 50] : [255, 180, 90], i % 2 ? "*" : ".", 0.1 + glow);
        box(t, hx + wind.x * rise * 0.12 + 0.4 * Math.sin(time * 0.5 + i * 2.3), stack + rise * 0.8, hz + wind.z * rise * 0.12 + 0.4 * Math.cos(time * 0.43 + i * 1.7), size, size, size);
      }
      return;
    }
  }
}

/** A spinner: a dark body with a lit canopy, tail boom, skids, steady navigation lights, a belly
 * light breathing at 0.2 Hz and, close up, a slow rotor ring (ROTOR_DEG_PER_S). */
function drawSpinner(t: PropCanvas, kit: StreetKit, st: SpinnerState, distance: number, time: number, seed: number): void {
  const line = Math.max(0.06, distance * LINE_PER_METRE), light = Math.max(0.22, line);
  t.push(); t.translate(st.x, -st.y, st.z); t.rotateY(st.heading);
  kit.paint(t, [46, 54, 66], "#"); blob(t, 0, 1.15, 0, 1.25, 0.95, 2.3);
  box(t, 0, 1.35, 3.4, 0.35, 0.35, 3.2); box(t, 0, 1.95, 4.9, 0.12, 1.1, 0.6);
  kit.paint(t, [90, 200, 230], "=", 0.85); blob(t, 0, 1.4, -1.45, 0.85, 0.6, 0.9);
  kit.paint(t, [60, 66, 76], "-");
  for (const side of [-1, 1]) box(t, side * 0.85, 0.08, 0, 0.12, 0.12, 3.2);
  box(t, 0, 2.2, 0, 0.25, 0.4, 0.25);
  kit.paint(t, [255, 60, 60], "*", 1.05); box(t, -1.25, 1.2, 0, light, light, light);
  kit.paint(t, [80, 255, 150], "*", 1.05); box(t, 1.25, 1.2, 0, light, light, light);
  kit.paint(t, [255, 240, 220], "o", 0.6 + 0.35 * Math.sin(time * TAU * ROOF_RATES.spinnerBelly + seed)); box(t, 0, 0.3, 0, light, line, light);
  if (distance < 140) {
    // The rotor: two thin blades and a ring of pale glyphs turning at 9 deg/s.
    t.push(); t.translate(0, -2.45, 0); t.rotateY(st.rotor);
    kit.paint(t, [120, 128, 140], "-", 0.8); t.box(8.4, 0.06, 0.26); t.box(0.26, 0.06, 8.4);
    kit.paint(t, [180, 190, 204], "o", 0.55); const dot = Math.max(0.2, line);
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8; box(t, Math.cos(a) * 4.2, 0, Math.sin(a) * 4.2, dot, dot, dot); }
    t.pop();
  }
  t.pop();
}

export function drawRooftopLife(t: PropCanvas, view: RoofView, kit: StreetKit): void {
  if (view.low) return;
  const { x, z, time } = view, eye = view.height ?? 2;
  const { gust, wind } = weatherAt(time);
  const outer = kit.range(ROOF_LIFE_REACH);
  const cx = Math.floor(x / BLOCK_SIZE), cz = Math.floor(z / BLOCK_SIZE), radius = Math.ceil(ROOF_LIFE_REACH / BLOCK_SIZE);
  for (let bz = cz - radius; bz <= cz + radius; bz++) for (let bx = cx - radius; bx <= cx + radius; bx++) {
    for (const s of roofSpots(bx, bz)) {
      // Dark towers stay dark: nothing lit, nobody about.
      if (s.dark) continue;
      const distance = Math.hypot(s.x - x, s.y - eye, s.z - z);
      if (distance > ROOF_LIFE_REACH || (view.visible && !view.visible(s.x, s.y + 2, s.z, Math.hypot(s.w, s.d) / 2 + 4))) continue;
      if (s.venue >= 0) { drawVenue(t, kit, s, distance, time, wind, view); continue; }
      for (const item of roofLife(s)) drawItem(t, kit, s, item, distance, time, gust, wind);
    }
  }
  // Spinners: dissolved in over their first 6 s and out over their last (the draw range closes on them).
  for (const s of heliports()) {
    const st = spinnerAt(s, time);
    if (!st) continue;
    const distance = Math.hypot(st.x - x, st.y - eye, st.z - z);
    if (distance > SPINNER_REACH || (view.visible && !view.visible(st.x, st.y + 1.5, st.z, 6))) continue;
    kit.range(st.fade >= 1 ? SPINNER_REACH : Math.min(SPINNER_REACH, distance / (1 - 0.25 * st.fade)));
    drawSpinner(t, kit, st, distance, time, s.id);
  }
  kit.restore(outer);
}
