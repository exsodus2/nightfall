import type { PropCanvas } from "./prop-canvas.ts";
import type { Textmodifier } from "textmode.js";
import { districtAt, type Building, type RGB } from "./world.ts";
import { signFaces } from "./signage.ts";
import { visibleFrom } from "./visibility.ts";
import { VFX_MODE, VFX_SURFACE } from "./vfx-shaders.ts";
import { WHEEL_GEOMETRY } from "./vehicle-wheels.ts";
import { carKind, type CarKind } from "./traffic.ts";
import {
  OPEN_HOLOGRAMS, RAIN_FALL, ROOF_HOLO_MIN_HEIGHT, ROOF_HOLO_REACH, carMotion, cellWorld, dripState, endMotionFrame, hash, plotHolograms, project, rainDrops,
  searchlight, signBuzzes, signSeed, sparkBurst, sparkGlyph, splashGlyph, splashPhase, wrap, type HoloSite, type ViewCamera,
} from "./vfx.ts";
import { MESSAGES } from "./messages.ts";
import { weatherAt, type Weather } from "./weather.ts"; // Weather agent: the slow rain / gust cycle
import { LINES, deckHeight, lineDistance, linePose } from "./metro.ts"; // Weather agent: deck runoff
import { RAIL_DECK_HALF } from "./world.ts";

// Scene VFX for the city, drawn with textmode's own primitives and the city material:
//  - spinning wheels and brake lights on every car (traffic, parked, the player's)      -> carFx()
//  - volumetric steam from street vents and food stalls, sweeping searchlights           -> SURFACE 8
//  - sparks from shorting signs, light trails behind sky traffic                         -> props
//  - rain as world-anchored drops projected to the weather layer, splashes on the street
//    and car roofs, drips off awnings and signs, streaks catching nearby neon            -> drawRain()
// Engine hooks: beginVfxFrame() once per frame, flushVfx() at the end of each scenery pass
// (main and reflected), drawRain() in the weather layer. Everything is deterministic in time.

interface Lamp { position: number[]; color: number[] }
export interface VfxFrame {
  cam: ViewCamera;
  /** Scene clock (seconds): drives every effect so freezing time freezes the effects. */
  time: number;
  /** Main grid rows, for the world size of a cell. */
  rows: number;
  rain: boolean;
  low: boolean;
  lamps: readonly Lamp[];
  /** Nearest buildings, for occlusion of overlay effects. */
  near: readonly Building[];
  visible: readonly { building: Building; distance: number }[];
  isVisible: (x: number, y: number, z: number, radius?: number) => boolean;
  /** Street holograms are drawn (the profile's hologram switch); absent means !low. */
  holograms?: boolean;
  /** Binds (true) or unbinds (false) the hologram program for the main pass: holograms are drawn
   * with their own material (engine.ts, materials.ts SURFACES). Absent: the bound material draws them. */
  hologramProgram?: (on: boolean) => void;
}
const EMPTY_CAM: ViewCamera = { x: 0, y: 2.7, z: 0, yaw: 0, pitch: 0, fov: 62, aspect: 1.5 };
let frame: VfxFrame = { cam: EMPTY_CAM, time: 0, rows: 1, rain: false, low: false, lamps: [], near: [], visible: [], isVisible: () => true };
let clock = 0;
let lastRealTime = 0;
const velocity = { x: 0, y: 0, z: 0 };
let lastEye: { x: number; y: number; z: number; clock: number } | null = null;
// Weather agent: this frame's weather (weather.ts, a pure function of the scene clock), and how fast
// the view turns (rad/s of scene time, smoothed): the screen-space rain sheet thins during fast
// turns, where its one-cell streaks would otherwise strobe across the whole view.
let weather: Weather = weatherAt(0);
let turnRate = 0, lastYaw: { yaw: number; time: number } | null = null;

/** Once per frame, before drawing the scene. `dt` is the real frame time in seconds. */
export function beginVfxFrame(next: VfxFrame, dt: number): void {
  frame = next;
  weather = weatherAt(next.time);
  if (!lastYaw || next.time < lastYaw.time || next.time - lastYaw.time > 0.5) { turnRate = 0; lastYaw = { yaw: next.cam.yaw, time: next.time }; }
  else if (next.time > lastYaw.time) {
    const step = next.time - lastYaw.time, turn = Math.abs(Math.atan2(Math.sin(next.cam.yaw - lastYaw.yaw), Math.cos(next.cam.yaw - lastYaw.yaw)));
    turnRate += (Math.min(6, turn / step) - turnRate) * (1 - Math.exp(-step * 10));
    lastYaw = { yaw: next.cam.yaw, time: next.time };
  }
  clock += Math.max(0, Math.min(dt, 0.25));
  endMotionFrame();
  // Camera velocity (smoothed) slants rain streaks when walking, driving or flying. A teleport
  // (studio bookmark, travel) is ignored.
  const now = performance.now() / 1000;
  const realDt = lastRealTime ? now - lastRealTime : 0; lastRealTime = now;
  if (lastEye && realDt > 0) {
    const dx = next.cam.x - lastEye.x, dy = next.cam.y - lastEye.y, dz = next.cam.z - lastEye.z;
    if (Math.hypot(dx, dy, dz) < 6) {
      const k = 1 - Math.exp(-realDt * 8), inv = 1 / Math.max(realDt, 1 / 240);
      velocity.x += (Math.max(-45, Math.min(45, dx * inv)) - velocity.x) * k;
      velocity.y += (Math.max(-45, Math.min(45, dy * inv)) - velocity.y) * k;
      velocity.z += (Math.max(-45, Math.min(45, dz * inv)) - velocity.z) * k;
    } else { velocity.x = velocity.y = velocity.z = 0; }
  }
  lastEye = { x: next.cam.x, y: next.cam.y, z: next.cam.z, clock };
  queue.length = 0; carRoofs.length = 0;
}

// ---- Cars ---------------------------------------------------------------------------------
/** Where a body's brake lights sit (drawCar's local frame): the bar at `z`, `y`, `width` wide, and
 * the high third light at `highY`, `highZ` (none when `highY` is 0). */
interface TailLamps { z: number; y: number; width: number; highY: number; highZ: number; wheels: boolean }
const CAR_TAIL: TailLamps = { z: 3.1, y: 1, width: 2.36, highY: 2.03, highZ: 1.57, wheels: true };
const TAILS: Partial<Record<CarKind, TailLamps>> = {
  corpsec: { ...CAR_TAIL, highY: 2.85, highZ: 2.82 }, ambulance: { ...CAR_TAIL, highY: 2.85, highZ: 2.92 },
  sweeper: { ...CAR_TAIL, z: 2.9, y: 0.8, highY: 0 }, wreck: { ...CAR_TAIL, wheels: false },
  bus: { z: 8.8, y: 0.85, width: 2.4, highY: 3.0, highZ: 8.77, wheels: false },
  truck: { z: 8.76, y: 0.9, width: 2.1, highY: 3.45, highZ: 8.68, wheels: false }, tanker: { z: 8.76, y: 0.9, width: 2.1, highY: 0, highZ: 0, wheels: false },
  moto: { z: 1.02, y: 0.98, width: 0.24, highY: 0, highZ: 0, wheels: false }, scooter: { z: 1.12, y: 0.98, width: 0.24, highY: 0, highZ: 0, wheels: false },
  tuktuk: { z: 1.68, y: 0.9, width: 1.2, highY: 0, highZ: 0, wheels: false },
};
interface CarItem { x: number; y: number; z: number; yaw: number; spin: number; blur: number; brake: number; wheels: boolean; wheelFade: number; tail: TailLamps }
/** Spinning-wheel quads are drawn within this distance and grow in over the last WHEEL_FADE metres
 * of it (the quad covers the tyre from the hub out), so they never pop onto a car. */
const WHEEL_REACH = 38, WHEEL_FADE = 6;
const queue: CarItem[] = [];
// Car positions for roof splashes, collected as cars are drawn in the main pass.
const carRoofs: { x: number; z: number; yaw: number; id: number }[] = [];

/** Shared by every car drawer (activity.ts drawCar calls it for traffic, parked and player cars):
 * queues the car's spinning wheels (near, with detail) and brake lights for flushVfx(). */
export function carFx(x: number, y: number, z: number, yaw: number, id: number, detail: boolean, speed: number | null, queued = false): void {
  const motion = carMotion(id, x, z, yaw, speed, clock, queued);
  const distance = Math.hypot(x - frame.cam.x, z - frame.cam.z), tail = TAILS[carKind(id)] ?? CAR_TAIL;
  if (y < 1) rainOnCar(x, z, yaw, id);
  const wheels = tail.wheels && detail && y < 1 && distance < WHEEL_REACH && !frame.low;
  if (!wheels && motion.brake < 0.05) return;
  const near = Math.max(0, Math.min(1, (WHEEL_REACH - distance) / WHEEL_FADE));
  queue.push({ x, y, z, yaw, spin: motion.spin, blur: motion.blur, brake: motion.brake, wheels, wheelFade: near * near * (3 - 2 * near), tail });
}

function lit(t: PropCanvas, color: RGB, glyph: string, gain: number, mode = 255): void {
  t.char(glyph); t.charColor(color[0] * gain, color[1] * gain, color[2] * gain);
  t.cellColor(color[0] * 0.12, color[1] * 0.12, color[2] * 0.12, mode);
}
function vfxCell(t: Textmodifier, mode: number, main: RGB, param: number, second: RGB = [0, 0, 0]): void {
  t.charColor(main[0], main[1], main[2], Math.max(0, Math.min(255, param * 255)));
  t.cellColor(second[0], second[1], second[2], mode);
}

function drawCarItems(t: Textmodifier, items: readonly CarItem[]): void {
  // Brake lights: a brighter bar over the tail lights plus the high third light (props surface).
  t.setUniform("u_surface", 2);
  for (const c of items) {
    if (c.brake < 0.05) continue;
    t.push(); t.translate(c.x, -c.y, c.z); t.rotateY(-c.yaw * 180 / Math.PI);
    lit(t, [255, 38, 64], c.brake > 0.55 ? "#" : "=", 0.8 + c.brake * 1.1);
    const lamps = c.tail;
    t.translate(0, -lamps.y, lamps.z); t.box(lamps.width, 0.3, 0.05); t.translate(0, lamps.y, -lamps.z);
    if (lamps.highY > 0) {
      lit(t, [255, 52, 72], "=", 0.6 + c.brake * 1.2);
      t.translate(0, -lamps.highY, lamps.highZ); t.box(0.8, 0.09, 0.05);
    }
    t.pop();
  }
  // Wheels: a quad over each tyre's outer sidewall, rendered by the VFX wheel mode.
  t.setUniform("u_surface", VFX_SURFACE);
  t.char("+");
  for (const c of items) {
    if (!c.wheels || c.wheelFade <= 0.01) continue;
    vfxCell(t, VFX_MODE.wheel, [150, 162, 172], c.blur, [30, 36, 44]);
    t.charRotation(c.spin);
    t.push(); t.translate(c.x, -c.y, c.z); t.rotateY(-c.yaw * 180 / Math.PI);
    for (const side of [-1, 1]) for (const axle of [-1, 1]) {
      const diameter = WHEEL_GEOMETRY.radius * 2 * c.wheelFade;
      t.push(); t.translate(side * (WHEEL_GEOMETRY.lateral + WHEEL_GEOMETRY.halfWidth + 0.015), -WHEEL_GEOMETRY.height, axle * WHEEL_GEOMETRY.axle); t.rotateY(90); t.rect(diameter, diameter); t.pop();
    }
    t.pop();
  }
  t.charRotation(0);
}

// ---- Steam ----------------------------------------------------------------------------------
interface Volume { x: number; y: number; z: number; hx: number; hy: number; hz: number; seed: number; tint: RGB; density: number }
const volumes: Volume[] = [];
/** A street vent's plume (activity.ts calls this for vents near the camera). */
export function ventSteam(x: number, z: number, seed: number): void {
  if (frame.low) return;
  volumes.push({ x, y: 3.4, z, hx: 1.7, hy: 3.4, hz: 1.7, seed, tint: [150, 168, 176], density: 1 });
}
function stallSteam(): void {
  const { cam } = frame;
  for (const { building, distance } of frame.visible) {
    if (distance > 70 || building.id % 3 !== 0) continue;
    const { x, z, width, depth } = building;
    const sx = wrap(x, 64) < 32 ? -1 : 1, sz = wrap(z, 64) < 32 ? -1 : 1;
    for (const side of [0, 1]) {
      if (side ? (cam.x - x) * sx < width / 2 : (cam.z - z) * sz < depth / 2) continue; // same test as drawShop
      const front = (side ? width : depth) / 2 + 3.9;
      const angle = (side ? sx * 90 : sz > 0 ? 0 : 180) * Math.PI / 180;
      const px = x + front * Math.sin(angle), pz = z + front * Math.cos(angle);
      if (!frame.isVisible(px, 3, pz)) continue;
      volumes.push({ x: px, y: 4.1, z: pz, hx: 1.2, hy: 2.1, hz: 1.2, seed: hash(building.id, side, 91), tint: [196, 170, 140], density: 0.8 });
    }
  }
}

// ---- Searchlights -----------------------------------------------------------------------------
const BEAM_LENGTH = 260;
function drawSearchlights(t: Textmodifier): void {
  if (frame.low) return;
  const { time } = frame;
  const sources: { x: number; y: number; z: number; seed: number; d: number }[] = [];
  for (const { building, distance } of frame.visible) {
    if (building.height < 85 || building.id % 13 !== 0) continue;
    sources.push({ x: building.x, y: building.height + 1, z: building.z, seed: hash(building.id, 3, 17), d: distance });
  }
  sources.sort((a, b) => a.d - b.d);
  for (const s of sources.slice(0, 2)) {
    const beam = searchlight(s.seed, time, s.x, s.y, s.z);
    const heading = Math.atan2(beam.dx, beam.dz), tilt = Math.acos(Math.max(-1, Math.min(1, beam.dy)));
    const radius = 2.6;
    t.setUniforms({ u_vfxCenter: [beam.x, -beam.y, beam.z], u_vfxAxis: [beam.dx, -beam.dy, beam.dz], u_vfxHalf: [radius, BEAM_LENGTH, radius], u_vfxSeed: s.seed });
    vfxCell(t, VFX_MODE.beam, [165, 205, 228], 0.8 + 0.3 * weather.rain); // Weather agent: a drizzle thins the beams a little (1 = the old strength)
    const mid = BEAM_LENGTH / 2;
    t.push(); t.translate(beam.x + beam.dx * mid, -(beam.y + beam.dy * mid), beam.z + beam.dz * mid);
    t.rotateY(heading * 180 / Math.PI); t.rotateX(-tilt * 180 / Math.PI);
    const width = radius * (1 + BEAM_LENGTH * 0.011) * 2.6;
    t.box(width, BEAM_LENGTH, width); t.pop();
    // The lamp housing itself.
    t.setUniform("u_surface", 2);
    lit(t, [210, 235, 245], "@", 1.3, 255);
    t.push(); t.translate(s.x, -s.y, s.z); t.box(1.6, 1.2, 1.6); t.pop();
    t.setUniform("u_surface", VFX_SURFACE);
  }
}

// ---- Sparks -----------------------------------------------------------------------------------
function drawSparks(t: Textmodifier): void {
  const { cam, time } = frame;
  for (const { building, distance } of frame.visible) {
    if (distance > 70) continue;
    for (const face of signFaces(building)) {
      if (!face.vertical && building.id % 3 !== 0) continue;
      const seed = signSeed(face.x, face.y, face.z);
      if (!signBuzzes(seed)) continue;
      const angle = face.yaw * Math.PI / 180, nx = Math.sin(angle), nz = Math.cos(angle);
      if ((cam.x - face.x) * nx + (cam.z - face.z) * nz <= 0) continue;
      const bottom = face.y - face.height / 2;
      const sparks = sparkBurst(seed, time, face.x + nx * 0.15, bottom, face.z + nz * 0.15, nx, nz, face.width / 2);
      if (!sparks.length || !frame.isVisible(face.x, face.y, face.z)) continue;
      for (const s of sparks) {
        const size = Math.max(0.07, cellWorld(cam.fov, frame.rows, Math.max(0.5, Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z))) * 1.05);
        const hot = s.life;
        lit(t, hot > 0.6 ? [255, 244, 200] : hot > 0.3 ? [255, 178, 80] : [214, 84, 46], sparkGlyph(s.life), 0.7 + hot * 0.9);
        t.push(); t.translate(s.x, -s.y, s.z); t.box(size, size, size); t.pop();
      }
    }
  }
}

// ---- Sky traffic light trails -----------------------------------------------------------------
const SKY_TRAIL_SEGMENTS = 8;
/** Tail-light streaks behind a sky craft heading `yaw` along a lane (activity.ts calls this per
 * craft; lanes run along x or z). Segments are at least one cell thick at their distance, so the
 * trail never breaks up. */
/** `gain` scales the trail's light (activity.ts passes the lane's wrap fade, so trails dissolve with their craft). */
export function skyTrail(t: PropCanvas, x: number, y: number, z: number, index: number, yaw = Math.PI / 2, gain = 1): void {
  const { cam } = frame;
  const bx = -Math.sin(yaw), bz = Math.cos(yaw), alongX = Math.abs(bx) > 0.5;
  const a = project(cam, x + bx * 12, y, z + bz * 12), b = project(cam, x, y, z);
  let glyph = "-";
  if (a && b) {
    const dx = (b.sx - a.sx) * cam.aspect, dy = b.sy - a.sy;
    const slope = Math.abs(dy) / Math.max(1e-6, Math.abs(dx));
    glyph = slope < 0.41 ? "-" : slope > 2.4 ? "|" : dx * dy > 0 ? "/" : "\\";
  }
  const depth = Math.max(1, Math.hypot(x - cam.x, y - cam.y, z - cam.z));
  const thick = Math.max(0.2, cellWorld(cam.fov, frame.rows, depth) * 1.1);
  // Sky agent: longer trails that fade out smoothly, tinted by role (activity.ts drawSkyTraffic:
  // i % 8 of 2 and 5 are cargo lifters, 6 the police spinner) - amber running lights for cargo, a
  // steady pale blue for the police (never a red/blue alternation), red or cyan for the rest.
  const role = index % 8, color: RGB = role === 2 || role === 5 ? [255, 168, 72] : role === 6 ? [160, 196, 255] : index % 2 ? [255, 64, 96] : [120, 205, 255];
  for (let k = 0; k < SKY_TRAIL_SEGMENTS; k++) {
    const fade = 1 - k / SKY_TRAIL_SEGMENTS;
    lit(t, color, k < 5 ? glyph : ".", (0.25 + fade * fade * 0.8) * gain); // the last few segments dissolve into dots
    const back = 3.2 + k * 2.6;
    t.push(); t.translate(x + bx * back, -(y + 0.7), z + bz * back); t.box(alongX ? 2.6 : thick, thick, alongX ? thick : 2.6); t.pop();
  }
}

// ---- Street holograms -------------------------------------------------------------------------
// Low projections seen from the pavement (vfx.ts plotHolograms / OPEN_HOLOGRAMS): over shopfronts,
// in alley mouths, over the avenue and on plaza pedestals. Each is one quad turned to face the
// viewer; the material (SURFACE 7) renders the subject as a 3D object facing `yaw`, so walking
// round one shows its sides, plus its light cylinder, scan rings, cone and emitter lens.
const HOLO_TINTS: readonly (readonly [RGB, RGB])[] = [
  [[0.25, 0.85, 1], [1, 0.3, 0.72]], [[1, 0.3, 0.72], [0.3, 0.6, 1]], [[1, 0.62, 0.26], [1, 0.25, 0.4]],
  [[0.45, 1, 0.6], [0.2, 0.7, 1]], [[0.7, 0.45, 1], [0.25, 0.95, 0.9]], [[0.3, 0.75, 1], [0.95, 0.85, 0.35]],
  [[1, 0.85, 0.5], [0.3, 0.9, 1]], [[0.4, 0.95, 0.95], [1, 0.45, 0.3]],
];
const HOLO_RANGE = 260, HOLO_MAX = 10;
const plotSites = new WeakMap<Building, HoloSite[]>();
const sitesOf = (building: Building): HoloSite[] => {
  let sites = plotSites.get(building);
  if (!sites) { sites = plotHolograms(building); plotSites.set(building, sites); }
  return sites;
};
const holoQueue: { site: HoloSite; distance: number }[] = [];
function drawStreetHolograms(t: Textmodifier): void {
  if (frame.low || frame.holograms === false) return;
  const { cam } = frame;
  holoQueue.length = 0;
  const consider = (s: HoloSite) => {
    const distance = Math.hypot(s.x - cam.x, s.z - cam.z);
    // Rooftop holograms (vfx.ts ROOF_*) are landmark-scale: seen from across the city, not just the street.
    if (distance > (s.mount === "roof" ? ROOF_HOLO_REACH : HOLO_RANGE) || !frame.isVisible(s.x, s.y + s.height / 2, s.z, s.width / 2)) return;
    holoQueue.push({ site: s, distance });
  };
  for (const { building, distance } of frame.visible) {
    if (distance < HOLO_RANGE + 20) for (const s of sitesOf(building)) consider(s);
    else if (distance < ROOF_HOLO_REACH + 20 && building.height >= ROOF_HOLO_MIN_HEIGHT) for (const s of sitesOf(building)) if (s.mount === "roof") consider(s);
  }
  for (const s of OPEN_HOLOGRAMS) consider(s);
  // The nearest few street projections plus every rooftop one, drawn far to near so overlapping
  // projections layer correctly.
  holoQueue.sort((a, b) => a.distance - b.distance);
  let street = 0;
  const shown = holoQueue.filter(({ site }) => site.mount === "roof" || street++ < HOLO_MAX).reverse();
  if (!shown.length) return;
  frame.hologramProgram?.(true);
  t.setUniform("u_surface", 7);
  for (const { site: s } of shown) {
    const [tint, tint2] = HOLO_TINTS[s.tint % HOLO_TINTS.length];
    const front = s.yaw * Math.PI / 180;
    t.setUniforms({ u_holoSeed: s.seed, u_holoRow: ((s.row % MESSAGES.length) + MESSAGES.length) % MESSAGES.length, u_holoTint: [...tint], u_holoTint2: [...tint2], u_holoFrame: [Math.sin(front), Math.cos(front)] });
    // The emitter sits 4 % of the height above the quad's lower edge (the material's uv.y = 0.96).
    const centre = s.y - s.height * 0.04 + s.height / 2;
    t.push(); t.translate(s.x, -centre, s.z); t.rotateY(Math.atan2(cam.x - s.x, cam.z - s.z) * 180 / Math.PI);
    t.rect(s.width, s.height); t.pop();
  }
  t.setUniforms({ u_holoFrame: [0, 0] });
  frame.hologramProgram?.(false);
  // The hardware that projects them: lit props.
  t.setUniform("u_surface", 2);
  for (const { site: s, distance } of shown) {
    if (distance > 200 || s.mount === "roof") continue; // roof projectors are part of the tower crown; no pole from the deck
    const [tint] = HOLO_TINTS[s.tint % HOLO_TINTS.length];
    const glow: RGB = [tint[0] * 255, tint[1] * 255, tint[2] * 255];
    const thick = Math.max(0.08, cellWorld(cam.fov, frame.rows, Math.max(1, distance)) * 0.9);
    if (s.mount === "wall") {
      // A bracket from the facade under the fascia's top to a projector pod.
      const dx = s.x - s.anchorX, dz = s.z - s.anchorZ, length = Math.hypot(dx, dz);
      lit(t, [70, 82, 92], "=", 0.7);
      t.push(); t.translate((s.x + s.anchorX) / 2, -(s.y - 0.32), (s.z + s.anchorZ) / 2); t.rotateY(Math.atan2(dx, dz) * 180 / Math.PI);
      t.box(Math.max(0.16, thick), Math.max(0.16, thick), length); t.pop();
    } else if (s.mount === "cable") {
      // A catenary across the street or alley, the pod hanging in the middle.
      lit(t, [52, 62, 70], s.spanAxis === "x" ? "-" : "|", 0.65);
      t.push(); t.translate(s.x, -(s.y + 0.05), s.z);
      if (s.spanAxis === "x") t.box(s.span * 2, thick, thick); else t.box(thick, thick, s.span * 2);
      t.pop();
    } else {
      // A pedestal: dark plinth, a lit trim band, the lens ring on top.
      lit(t, [40, 48, 56], "#", 0.6);
      t.push(); t.translate(s.x, -(s.y / 2), s.z); t.box(1.5, s.y, 1.5); t.pop();
      lit(t, glow, "=", 0.9);
      t.push(); t.translate(s.x, -(s.y * 0.72), s.z); t.box(1.56, Math.max(0.07, thick), 1.56); t.pop();
    }
    // The projector pod (the material draws its lit lens on top).
    lit(t, [86, 98, 108], "#", 0.75);
    t.push(); t.translate(s.x, -(s.y - 0.22), s.z); t.box(s.mount === "plinth" ? 0.9 : 0.8, 0.34, s.mount === "plinth" ? 0.9 : 0.8); t.pop();
    lit(t, glow, "o", 1.1);
    t.push(); t.translate(s.x, -(s.y - 0.02), s.z); t.box(0.5, Math.max(0.06, thick * 0.6), 0.5); t.pop();
  }
}

// ---- Foundry embers ---------------------------------------------------------------------------
// A few sparks of ash drifting up through the Foundry's streets from the furnaces: world-anchored
// (a 6 m grid around the camera, so walking never re-rolls them), each a one-cell glyph rising at
// ~1 m/s with a slow sway, fading in and out over its 9-14 s life - no flashes, no strobing.
const EMBER_GRID = 6, EMBER_REACH = 6;
function drawEmbers(t: Textmodifier): void {
  const { cam, time } = frame;
  const district = frame.low ? -1 : districtAt(cam.x, cam.z).id;
  if (district === 3) { drawMotes(t); return; }
  if (district !== 0) return;
  const gx = Math.floor(cam.x / EMBER_GRID), gz = Math.floor(cam.z / EMBER_GRID);
  for (let i = -EMBER_REACH; i <= EMBER_REACH; i++) for (let j = -EMBER_REACH; j <= EMBER_REACH; j++) {
    const cx = gx + i, cz = gz + j;
    if (hash(cx, cz, 401) > 0.5) continue;
    const period = 9 + hash(cx, cz, 402) * 5, age = wrap(time + hash(cx, cz, 403) * period, period), life = age / period;
    const x = (cx + hash(cx, cz, 404)) * EMBER_GRID + Math.sin(age * 0.9 + cx) * 0.6 + age * 0.25;
    const z = (cz + hash(cx, cz, 405)) * EMBER_GRID + Math.cos(age * 0.7 + cz) * 0.6;
    const y = 0.6 + age * (0.8 + hash(cx, cz, 406) * 0.5);
    if (insideBuilding(x, z)) continue;
    const distance = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    const glow = Math.min(1, Math.sin(Math.PI * life) * 1.4) * (1 - Math.min(1, Math.max(0, distance / (EMBER_GRID * EMBER_REACH) - 0.5) * 2));
    if (glow < 0.12) continue;
    const size = Math.max(0.05, cellWorld(cam.fov, frame.rows, Math.max(0.5, distance)) * 1.15);
    lit(t, life < 0.4 ? [255, 190, 96] : [235, 104, 52], glow > 0.5 ? "*" : "+", 0.45 + glow * 0.75);
    t.push(); t.translate(x, -y, z); t.box(size, size, size); t.pop();
  }
}
// Weather agent: Rain Gardens motes - specks of mist and pollen hanging over the terraces and the
// park, on the same world-anchored grid as the embers but sparser, dimmer and slower: each drifts
// downwind at walking-pace-over-a-minute speed, bobs by a few centimetres and fades in and out
// over 12-18 s. One dim cell each, never brighter than the street lamps that light them.
function drawMotes(t: Textmodifier): void {
  const { cam, time } = frame;
  const gx = Math.floor(cam.x / EMBER_GRID), gz = Math.floor(cam.z / EMBER_GRID);
  for (let i = -EMBER_REACH; i <= EMBER_REACH; i++) for (let j = -EMBER_REACH; j <= EMBER_REACH; j++) {
    const cx = gx + i, cz = gz + j;
    if (hash(cx, cz, 411) > 0.38) continue;
    const period = 12 + hash(cx, cz, 412) * 6, age = wrap(time + hash(cx, cz, 413) * period, period), life = age / period;
    const x = (cx + hash(cx, cz, 414)) * EMBER_GRID + Math.sin(age * 0.31 + cx) * 0.5 + age * 0.11; // the calm wind's drift: a gust
    const z = (cz + hash(cx, cz, 415)) * EMBER_GRID + Math.cos(age * 0.27 + cz) * 0.5 + age * 0.04;   // here would jerk (drift = age x wind)
    const y = 0.5 + hash(cx, cz, 416) * 1.9 + Math.sin(age * 0.6 + cz) * 0.08;
    if (insideBuilding(x, z)) continue;
    const distance = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    const glow = Math.sin(Math.PI * life) * (1 - Math.min(1, Math.max(0, distance / (EMBER_GRID * EMBER_REACH) - 0.4) * 2));
    if (glow < 0.15 || distance < 1.2) continue;
    const size = Math.max(0.05, cellWorld(cam.fov, frame.rows, Math.max(0.5, distance)) * 1.1);
    lit(t, hash(cx, cz, 417) > 0.6 ? [190, 236, 200] : [150, 196, 186], ".", 0.3 + glow * 0.4);
    t.push(); t.translate(x, -y, z); t.box(size, size, size); t.pop();
  }
}

/** End of each scenery pass (main and reflected): draws everything queued this pass. */
export function flushVfx(t: Textmodifier, mirror: boolean): void {
  if (!mirror) stallSteam();
  drawCarItems(t, queue);
  t.setUniform("u_surface", VFX_SURFACE);
  // Weather agent: plumes lean downwind (local units at the top of the volume), further in a gust.
  const windSpeed = Math.hypot(weather.wind.x, weather.wind.z) || 1, lean = (0.32 + 0.38 * weather.gust) / windSpeed;
  const steamAxis = [weather.wind.x * lean, 0, weather.wind.z * lean];
  for (const v of volumes) {
    t.setUniforms({ u_vfxCenter: [v.x, -v.y, v.z], u_vfxHalf: [v.hx, v.hy, v.hz], u_vfxAxis: steamAxis, u_vfxSeed: v.seed });
    vfxCell(t, VFX_MODE.steam, v.tint, v.density);
    t.push(); t.translate(v.x, -v.y, v.z); t.box(v.hx * 2, v.hy * 2, v.hz * 2); t.pop();
  }
  if (!mirror) { drawSearchlights(t); drawStreetHolograms(t); }
  t.setUniform("u_surface", 2);
  drawSparks(t);
  if (!mirror) drawEmbers(t);
  queue.length = 0; volumes.length = 0;
}

// ---- Rain (weather layer: ortho, grid origin at the centre, y down) ---------------------------
function lampLight(x: number, y: number, z: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  for (const lamp of frame.lamps) {
    const dx = lamp.position[0] - x, dy = -lamp.position[1] - y, dz = lamp.position[2] - z, radius = lamp.position[3];
    const d2 = dx * dx + dy * dy + dz * dz;
    const f = Math.pow(Math.max(0, 1 - d2 / (radius * radius)), 2) / (1 + d2 * 0.023);
    r += lamp.color[0] * f; g += lamp.color[1] * f; b += lamp.color[2] * f;
  }
  return [r, g, b];
}
function insideBuilding(x: number, z: number): boolean {
  for (const b of frame.near) if (Math.abs(x - b.x) < b.width / 2 && Math.abs(z - b.z) < b.depth / 2) return true;
  return false;
}

/** Rain for the weather layer. `count` is the old screen-space streak budget (0 = no rain). */
export function drawRain(t: Textmodifier, cols: number, rows: number, count: number): void {
  if (count <= 0) return;
  const { cam, time, low } = frame;
  const eye = { x: cam.x, y: cam.y, z: cam.z };
  const occluders = frame.near.slice(0, 14);
  const toGrid = (sx: number, sy: number) => ({ gx: sx * cols / 2, gy: -sy * rows / 2 });
  const onScreen = (gx: number, gy: number) => Math.abs(gx) < cols / 2 + 1 && Math.abs(gy) < rows / 2 + 1;
  const cell = (glyph: string, gx: number, gy: number, color: readonly number[], alpha: number) => {
    t.char(glyph); t.charColor(Math.min(255, color[0]), Math.min(255, color[1]), Math.min(255, color[2]), Math.max(0, Math.min(255, alpha)));
    t.push(); t.translate(Math.round(gx), Math.round(gy)); t.rect(1, 1); t.pop();
  };
  const tint = (x: number, y: number, z: number, base: readonly number[], gain: number) => {
    const l = lampLight(x, y, z);
    return [(base[0] + l[0] * 190) * gain, (base[1] + l[1] * 190) * gain, (base[2] + l[2] * 190) * gain];
  };
  t.cellColor(0, 0, 0, 0);

  // 1. A faint far sheet in screen space for depth beyond the near drops. Comfort: it turns with
  // the world at the camera's own focal rate (a distant layer), not at a fraction of it - a sheet
  // sliding slower than the city reads as glued to your head and fights the sense of turning.
  // Weather agent: the sheet's size follows the rain (drizzle ~55%, steady 100%, downpour ~135%;
  // the extra streaks are always the same ones, so the count drifts over minutes without a pop),
  // a gust shears it by its sideways component (which changes over seconds), and a fast turn fades
  // it - a far layer of one-cell streaks sweeping across the view is the rain's main turn shimmer.
  const { rain, wind } = weather;
  const sheet = Math.round(count * 0.45 * (0.35 + rain));
  const focal = rows / 2 / Math.tan(cam.fov * Math.PI / 360);
  const gustSide = (wind.x - 0.9) * Math.cos(cam.yaw) + (wind.z - 0.35) * Math.sin(cam.yaw);
  const shear = Math.max(-0.6, Math.min(0.6, gustSide * 0.18));
  const sheetFade = 1 - 0.6 * Math.max(0, Math.min(1, (turnRate - 0.4) / 1.2));
  for (let i = 0; i < sheet; i++) {
    const depth = 0.4 + hash(i, 21, 1) * 0.6;
    const py = wrap(hash(i, 7, 1) * rows + time * (14 + 12 * depth), rows) - rows / 2;
    const px = wrap(hash(i, 3, 1) * cols + time * 2 * depth - cam.yaw * focal + (py + rows / 2) * shear * depth, cols) - cols / 2;
    // Each streak leans at its own shear threshold (0.15-0.45), so a gust tips the sheet over a
    // streak at a time instead of every glyph changing in one frame.
    const lean = 0.15 + hash(i, 11, 1) * 0.3;
    cell(i % 3 ? (shear > lean ? "\\" : shear < -lean ? "/" : "|") : "'", px, py, [72, 112, 138], (30 + depth * 40) * sheetFade);
  }

  // 2. World-anchored drops near the eye: projected streaks, slanted by wind and camera motion.
  // Weather agent: four drops per tile, each shown while the rain is heavier than its own seed
  // (fading over a 0.15 band), so a drizzle keeps ~30% of them, steady rain ~70%, a downpour all.
  const exposure = 1 / 20, density = 0.12 + 0.88 * rain;
  const vx = wind.x - velocity.x, vy = -RAIN_FALL - velocity.y, vz = wind.z - velocity.z;
  const drops = rainDrops(cam.x, cam.y, cam.z, time, low ? 8 : 12, low ? 2.6 : 2.1, low ? 1 : 4, wind);
  for (const d of drops) {
    const shown = low ? 1 : Math.min(1, (density - d.seed) / 0.15);
    if (shown <= 0) continue;
    const head = project(cam, d.x, d.y, d.z);
    if (!head || Math.abs(head.sx) > 1.1 || Math.abs(head.sy) > 1.1) continue;
    const tail = project(cam, d.x - vx * exposure, d.y - vy * exposure, d.z - vz * exposure);
    if (!tail) continue;
    if (!visibleFrom(eye, d, occluders) || insideBuilding(d.x, d.z)) continue;
    const a = toGrid(tail.sx, tail.sy), b = toGrid(head.sx, head.sy);
    const dx = b.gx - a.gx, dy = b.gy - a.gy, length = Math.hypot(dx, dy);
    const slope = Math.abs(dx) / Math.max(1e-6, Math.abs(dy));
    const glyph = slope < 0.42 ? "|" : slope > 2.4 ? "-" : dx * dy > 0 ? "\\" : "/";
    const n = Math.max(1, Math.min(5, Math.round(length)));
    const near = 1 - Math.min(1, (head.depth - 1) / 11);
    const color = tint(d.x, d.y, d.z, [120, 160, 186], 0.8 + near * 0.5);
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 1 : k / (n - 1);
      const gx = a.gx + dx * f, gy = a.gy + dy * f;
      if (!onScreen(gx, gy)) continue;
      cell(near < 0.3 && k < n - 1 ? "'" : glyph, gx, gy, color, (85 + near * 115) * (0.6 + 0.4 * f) * shown); // Comfort: fainter streaks
    }
  }

  // 3. Splashes on the street, world-anchored sites ahead of the camera.
  const reach = low ? 10 : 15, tile = 2.2; // Comfort: sparser, fainter splashes (less ground flicker)
  const fx = Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  for (let tz = Math.floor((cam.z - reach) / tile); tz <= Math.floor((cam.z + reach) / tile); tz++) {
    for (let tx = Math.floor((cam.x - reach) / tile); tx <= Math.floor((cam.x + reach) / tile); tx++) {
      const x = (tx + hash(tx, tz, 41)) * tile, z = (tz + hash(tx, tz, 42)) * tile;
      const ahead = (x - cam.x) * fx + (z - cam.z) * fz;
      if (ahead < 0.8 || Math.hypot(x - cam.x, z - cam.z) > reach) continue;
      const rate = 0.55 + hash(tx, tz, 44) * 0.6, phase = splashPhase(hash(tx, tz, 43), time, rate);
      if (phase < 0 || !splashes(tx * 7919 + tz, hash(tx, tz, 43), rate)) continue;
      const p = project(cam, x, 0.03, z);
      if (!p || insideBuilding(x, z) || !visibleFrom(eye, { x, y: 0.05, z }, occluders)) continue;
      const g = toGrid(p.sx, p.sy);
      if (!onScreen(g.gx, g.gy)) continue;
      const near = 1 - Math.min(1, p.depth / reach);
      cell(splashGlyph(phase), g.gx, g.gy, tint(x, 0.2, z, [96, 134, 158], 0.8 + near * 0.4), (60 + near * 95) * (1 - phase * 0.5));
    }
  }

  // 4. Splashes on car roofs and bonnets (every car near the camera).
  for (const item of carRoofs) {
    const c = Math.cos(item.yaw), s = Math.sin(item.yaw);
    for (let k = 0; k < 5; k++) {
      const lx = (k % 2 ? 0.55 : -0.55) + (hash(item.id, k, 51) - 0.5) * 0.4, lz = k === 4 ? -2.2 : -0.8 + (k >> 1) * 1.6;
      const x = item.x + lx * c - lz * s, z = item.z + lx * s + lz * c, y = k === 4 ? 1.45 : 2.12;
      const phase = splashPhase(hash(item.id, k, 52), time, 0.9 + hash(item.id, k, 53));
      if (phase < 0) continue;
      const p = project(cam, x, y, z);
      if (!p) continue;
      const g = toGrid(p.sx, p.sy);
      if (!onScreen(g.gx, g.gy)) continue;
      cell(phase < 0.4 ? "'" : ".", g.gx, g.gy, tint(x, y, z, [110, 150, 172], 1), 170 * (1 - phase * 0.5));
    }
  }
  carRoofs.length = 0;

  // 5. Drips off awning edges and sign bottoms: a bead forms, falls, splashes.
  if (low) return;
  deckRunoff();
  for (const { building, distance } of frame.visible) {
    if (distance > 45) continue;
    const { x, z, width, depth, id } = building;
    const sx = wrap(x, 64) < 32 ? -1 : 1, sz = wrap(z, 64) < 32 ? -1 : 1;
    for (const side of [0, 1]) {
      if (side ? (cam.x - x) * sx < width / 2 : (cam.z - z) * sz < depth / 2) continue;
      const w = side ? depth : width, front = (side ? width : depth) / 2 + 3.45;
      const angle = (side ? sx * 90 : sz > 0 ? 0 : 180) * Math.PI / 180, ca = Math.cos(angle), sa = Math.sin(angle);
      const sites = Math.min(9, Math.floor(w / 1.3));
      for (let k = 0; k < sites; k++) {
        const lx = (k + 0.5) / sites * w - w / 2 + (hash(id, k, 61 + side) - 0.5) * 0.6;
        drip(x + lx * ca + front * sa, z - lx * sa + front * ca, 3.97, hash(id, k, 63 + side), [104, 140, 160]);
      }
    }
    for (const face of signFaces(building)) {
      if (!face.vertical && id % 3 !== 0) continue;
      const angle = face.yaw * Math.PI / 180, nx = Math.sin(angle), nz = Math.cos(angle);
      if ((cam.x - face.x) * nx + (cam.z - face.z) * nz <= 0) continue;
      const sites = face.vertical ? 1 : 3;
      for (let k = 0; k < sites; k++) {
        const along = sites === 1 ? 0 : ((k + 0.5) / sites - 0.5) * face.width * 0.8;
        drip(face.x + nz * along + nx * 0.2, face.z - nx * along + nz * 0.2, face.y - face.height / 2, hash(id, k, 71 + Math.round(face.yaw)), [face.color[0] * 0.55, face.color[1] * 0.55, face.color[2] * 0.55]);
      }
    }
  }

  // Weather agent: a splash or drip cycle plays only while the rain is heavier than a per-cycle roll
  // (drizzle ~50%, steady ~95%, downpour all). The roll changes only between cycles, so a drop never
  // vanishes mid-fall and the share drifts with the weather over minutes.
  function splashes(site: number, seed: number, rate: number): boolean {
    return hash(site, Math.floor(time * rate + seed * 17.13), 45) < 0.3 + rain;
  }
  // Runoff off the monorail decks: beads along both deck edges and a line of splashes on the street
  // below each edge, within ~40 m. (No falling streak: from 26-40 m a drop crosses the view in a
  // few frames, which reads as a flicker, not a drip.)
  function deckRunoff(): void {
    for (const line of LINES) {
      const along = lineDistance(line.id, cam.x, cam.z), pose = linePose(line.id, along);
      if (Math.hypot(pose.x - cam.x, pose.z - cam.z) > 40) continue;
      const ahead = linePose(line.id, along + 1), ax = ahead.x - pose.x, az = ahead.z - pose.z, al = Math.hypot(ax, az) || 1;
      const nx = -az / al, nz = ax / al;
      for (let k = -10; k <= 10; k++) {
        const d = Math.round(along / 2.5) * 2.5 + k * 2.5, site = linePose(line.id, d), edge = deckHeight(line.id, d) - RAIL_DECK_HALF;
        for (const side of [-1, 1]) {
          const x = site.x + nx * 1.85 * side, z = site.z + nz * 1.85 * side, id = Math.round(d / 2.5) * 2 + (side > 0 ? 1 : 0) + line.id * 100000;
          const seed = hash(id, 7, 81), rate = 0.35 + seed * 0.4, phase = splashPhase(seed, time, rate, 0.5);
          if (phase >= 0 && splashes(id, seed, rate) && !insideBuilding(x, z)) {
            const p = project(cam, x, 0.03, z);
            const g = p && p.depth < 40 ? toGrid(p.sx, p.sy) : null;
            if (g && onScreen(g.gx, g.gy) && visibleFrom(eye, { x, y: 0.05, z }, occluders)) cell(splashGlyph(phase), g.gx, g.gy, tint(x, 0.2, z, [96, 134, 158], 1), 150 * (1 - phase * 0.5));
          }
          const bead = wrap(time * rate + seed * 17.13 + 0.5, 1); // a bead swells on the edge between splashes
          if (bead > 0.55) {
            const p = project(cam, x, edge - 0.05, z);
            const g = p && p.depth < 40 ? toGrid(p.sx, p.sy) : null;
            if (g && onScreen(g.gx, g.gy)) cell(bead > 0.85 ? "'" : ".", g.gx, g.gy, tint(x, edge, z, [104, 140, 160], 1), 60 + (bead - 0.55) * 300);
          }
        }
      }
    }
  }

  function drip(x: number, z: number, edge: number, seed: number, base: readonly number[]): void {
    const state = dripState(seed, time, edge);
    if (state.stage === "none") return;
    // Same cycle as dripState (period 1.8 + 2.6 seed, offset 31.7 seed); awnings keep dripping in a drizzle.
    if (hash(Math.round(seed * 1e6), Math.floor((time + seed * 31.7) / (1.8 + seed * 2.6)), 46) > 0.45 + 0.7 * rain) return;
    const y = state.stage === "splash" ? 0.03 : edge - state.drop - 0.05;
    const p = project(cam, x, y, z);
    if (!p || p.depth > 45) return;
    const g = toGrid(p.sx, p.sy);
    if (!onScreen(g.gx, g.gy) || !visibleFrom(eye, { x, y: Math.max(0.1, y), z }, occluders)) return;
    const color = tint(x, y, z, base, 1);
    if (state.stage === "bead") cell(state.phase > 0.6 ? "'" : ".", g.gx, g.gy, color, 60 + state.phase * 150);
    else if (state.stage === "fall") cell(state.phase < 0.3 ? "'" : "|", g.gx, g.gy, color, 200);
    else if (state.phase < 1) cell(splashGlyph(state.phase), g.gx, g.gy, color, 190 * (1 - state.phase * 0.5));
  }
}

/** Records a car near the camera for rain splashes on its roof (called from carFx callers). */
export function rainOnCar(x: number, z: number, yaw: number, id: number): void {
  if (!frame.rain || carRoofs.length > 24) return;
  if ((x - frame.cam.x) ** 2 + (z - frame.cam.z) ** 2 > 22 * 22) return;
  if (!carRoofs.some(c => c.id === id)) carRoofs.push({ x, z, yaw, id });
}
