import type { PropCanvas } from "./prop-canvas";
import type { Textmodifier } from "textmode.js";
import type { Building, RGB } from "./world";
import { signFaces } from "./signage";
import { visibleFrom } from "./visibility";
import { VFX_MODE, VFX_SURFACE } from "./vfx-shaders";
import {
  RAIN_FALL, RAIN_WIND, carMotion, cellWorld, dripState, endMotionFrame, hash, project, rainDrops, searchlight, signBuzzes,
  signSeed, sparkBurst, sparkGlyph, splashGlyph, splashPhase, wrap, type ViewCamera,
} from "./vfx";

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
  isVisible: (x: number, y: number, z: number) => boolean;
}
const EMPTY_CAM: ViewCamera = { x: 0, y: 2.7, z: 0, yaw: 0, pitch: 0, fov: 62, aspect: 1.5 };
let frame: VfxFrame = { cam: EMPTY_CAM, time: 0, rows: 1, rain: false, low: false, lamps: [], near: [], visible: [], isVisible: () => true };
let clock = 0;
let lastRealTime = 0;
const velocity = { x: 0, y: 0, z: 0 };
let lastEye: { x: number; y: number; z: number; clock: number } | null = null;

/** Once per frame, before drawing the scene. `dt` is the real frame time in seconds. */
export function beginVfxFrame(next: VfxFrame, dt: number): void {
  frame = next;
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
interface CarItem { x: number; y: number; z: number; yaw: number; spin: number; blur: number; brake: number; wheels: boolean }
const queue: CarItem[] = [];
// Car positions for roof splashes, collected as cars are drawn in the main pass.
const carRoofs: { x: number; z: number; yaw: number; id: number }[] = [];

/** Shared by every car drawer (activity.ts drawCar calls it for traffic, parked and player cars):
 * queues the car's spinning wheels (near, with detail) and brake lights for flushVfx(). */
export function carFx(x: number, y: number, z: number, yaw: number, id: number, detail: boolean, speed: number | null, queued = false): void {
  const motion = carMotion(id, x, z, yaw, speed, clock, queued);
  const distance = Math.hypot(x - frame.cam.x, z - frame.cam.z);
  if (y < 1) rainOnCar(x, z, yaw, id);
  const wheels = detail && y < 1 && distance < 38 && !frame.low;
  if (!wheels && motion.brake < 0.05) return;
  queue.push({ x, y, z, yaw, spin: motion.spin, blur: motion.blur, brake: motion.brake, wheels });
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
    t.translate(0, -1, 3.1); t.box(2.36, 0.3, 0.05); t.translate(0, 1, -3.1);
    lit(t, [255, 52, 72], "=", 0.6 + c.brake * 1.2);
    t.translate(0, -2.03, 1.57); t.box(0.8, 0.09, 0.05);
    t.pop();
  }
  // Wheels: a quad over each tyre's outer sidewall, rendered by the VFX wheel mode.
  t.setUniform("u_surface", VFX_SURFACE);
  t.char("+");
  for (const c of items) {
    if (!c.wheels) continue;
    vfxCell(t, VFX_MODE.wheel, [150, 162, 172], c.blur, [30, 36, 44]);
    t.charRotation(c.spin);
    t.push(); t.translate(c.x, -c.y, c.z); t.rotateY(-c.yaw * 180 / Math.PI);
    for (const side of [-1, 1]) for (const front of [-1.75, 1.75]) {
      t.push(); t.translate(side * 1.565, -0.46, front); t.rotateY(90); t.rect(0.82, 0.82); t.pop();
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
    vfxCell(t, VFX_MODE.beam, [165, 205, 228], 1);
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
/** Tail-light streaks behind a spinner moving along +x (activity.ts calls this per sky car).
 * Segments are at least one cell thick at their distance, so the trail never breaks up. */
export function skyTrail(t: PropCanvas, x: number, y: number, z: number, index: number): void {
  const { cam } = frame;
  const a = project(cam, x - 12, y, z), b = project(cam, x, y, z);
  let glyph = "-";
  if (a && b) {
    const dx = (b.sx - a.sx) * cam.aspect, dy = b.sy - a.sy;
    const slope = Math.abs(dy) / Math.max(1e-6, Math.abs(dx));
    glyph = slope < 0.41 ? "-" : slope > 2.4 ? "|" : dx * dy > 0 ? "/" : "\\";
  }
  const depth = Math.max(1, Math.hypot(x - cam.x, y - cam.y, z - cam.z));
  const thick = Math.max(0.2, cellWorld(cam.fov, frame.rows, depth) * 1.1);
  for (let k = 0; k < 6; k++) {
    const fade = 1 - k / 6;
    lit(t, index % 2 ? [255, 64, 96] : [120, 205, 255], glyph, 0.35 + fade * 0.8);
    t.push(); t.translate(x - 3.2 - k * 2.4, -(y + 0.7), z); t.box(2.4, thick, thick); t.pop();
  }
}

/** End of each scenery pass (main and reflected): draws everything queued this pass. */
export function flushVfx(t: Textmodifier, mirror: boolean): void {
  if (!mirror) stallSteam();
  drawCarItems(t, queue);
  t.setUniform("u_surface", VFX_SURFACE);
  for (const v of volumes) {
    t.setUniforms({ u_vfxCenter: [v.x, -v.y, v.z], u_vfxHalf: [v.hx, v.hy, v.hz], u_vfxSeed: v.seed });
    vfxCell(t, VFX_MODE.steam, v.tint, v.density);
    t.push(); t.translate(v.x, -v.y, v.z); t.box(v.hx * 2, v.hy * 2, v.hz * 2); t.pop();
  }
  if (!mirror) drawSearchlights(t);
  t.setUniform("u_surface", 2);
  drawSparks(t);
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
  const sheet = Math.round(count * 0.45);
  const focal = rows / 2 / Math.tan(cam.fov * Math.PI / 360);
  for (let i = 0; i < sheet; i++) {
    const depth = 0.4 + hash(i, 21, 1) * 0.6;
    const px = wrap(hash(i, 3, 1) * cols + time * 2 * depth - cam.yaw * focal, cols) - cols / 2;
    const py = wrap(hash(i, 7, 1) * rows + time * (18 + 16 * depth), rows) - rows / 2;
    cell(i % 3 ? "|" : "'", px, py, [72, 112, 138], 30 + depth * 40);
  }

  // 2. World-anchored drops near the eye: projected streaks, slanted by wind and camera motion.
  const exposure = 1 / 20;
  const vx = RAIN_WIND.x - velocity.x, vy = -RAIN_FALL - velocity.y, vz = RAIN_WIND.z - velocity.z;
  const drops = rainDrops(cam.x, cam.y, cam.z, time, low ? 8 : 12, low ? 2.6 : 2.1, low ? 1 : 3);
  for (const d of drops) {
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
      cell(near < 0.3 && k < n - 1 ? "'" : glyph, gx, gy, color, (85 + near * 115) * (0.6 + 0.4 * f)); // Comfort: fainter streaks
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
      const phase = splashPhase(hash(tx, tz, 43), time, 0.55 + hash(tx, tz, 44) * 0.6);
      if (phase < 0) continue;
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

  function drip(x: number, z: number, edge: number, seed: number, base: readonly number[]): void {
    const state = dripState(seed, time, edge);
    if (state.stage === "none") return;
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
