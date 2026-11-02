// Other players in the 3D city: an ASCII "runner" figure (or their car / taxi) per remote avatar,
// plus a floating name tag. Geometry is written against PropCanvas, so it records into the GPU
// prop instances like residents; the tags need textmode's print and are drawn directly.
import type { Textmodifier } from "textmode.js";
import { cuboid as box, drawCar, ink, propRange, restorePropRange, type ActivityView } from "../city/activity.ts";
import type { PropCanvas } from "../city/prop-canvas.ts";
import type { RGB } from "../city/world.ts";
import { project, type ViewCamera } from "../city/vfx.ts";
import type { RemoteAvatar } from "./types.ts";
import { drawHuman, FigureMotions, type HumanPaint, type MotionTargets } from "../city/human-model.ts";

const DEG = 180 / Math.PI;
const PANTS: RGB = [44, 50, 60];
const SKINS: readonly RGB[] = [[179, 143, 115], [111, 85, 69], [189, 174, 141], [144, 112, 88]];
const HEADWEAR = ["visor", "cap", "hood", "bare"] as const;
/** Bodies dissolve near this distance (m); tags stay readable further out. */
const BODY_RANGE = 420;
const TAG_RANGE = 360;

const dim = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
function hash(id: string): number { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Car ids for remote vehicles, clear of local traffic/parked ids (the VFX key per-car state by id).
 * `car % 5` keeps the body colour of the car they took; taxis use colour 0 with the roof sign. */
const remoteCarId = (avatar: RemoteAvatar, taxi: boolean) => 60000 + (hash(avatar.id) % 1000) * 5 + (taxi ? 0 : avatar.car % 5);
const inVehicle = (avatar: RemoteAvatar) => avatar.mode === "drive" || avatar.mode === "taxi" || avatar.mode === "sky";

/** Bodies and cars. Called once per frame from the prop pass (engine recordProps). */
export function drawRemotePlayers(t: PropCanvas, view: ActivityView, remotes: readonly RemoteAvatar[]): void {
  if (!remotes.length) return;
  const outer = propRange(BODY_RANGE);
  for (const r of remotes) {
    const distance = Math.hypot(r.x - view.x, r.z - view.z);
    if (distance > BODY_RANGE) continue;
    if (view.visible && distance > 12 && !view.visible(r.x, r.y + 2, r.z)) continue;
    if (r.mode === "drive" || r.mode === "taxi") drawCar(t, r.x, 0, r.z, r.heading, remoteCarId(r, r.mode === "taxi"), distance < 140, false, { speed: r.speed });
    else if (r.mode === "sky") drawCar(t, r.x, Math.max(0, r.y), r.z, r.heading, remoteCarId(r, true), false, true);
    else drawRunner(t, r, view.time, distance < (view.low ? 28 : 48));
  }
  restorePropRange(outer);
}

/** Per-peer stride weight (bounded; see FigureMotions): a stop arrives as one packet with speed 0,
 *  so the gait eases out over 0.25 s (and in again) instead of the legs snapping together. Their
 *  heading is already interpolated between packets and is drawn as it is. */
const GAITS = new FigureMotions<string>(256);
const GAIT_TARGET: MotionTargets = { yaw: 0, glance: 0, gait: 0, talk: 0, sit: 0, hold: 0, phone: 0 };

function drawRunner(t: PropCanvas, r: RemoteAvatar, time: number, detail: boolean, paint: HumanPaint = ink): void {
  const flying = r.mode === "fly" && r.y > 0.6;
  const moving = Math.abs(r.speed) > 0.4;
  GAIT_TARGET.yaw = r.heading; GAIT_TARGET.gait = moving && !flying ? 1 : 0;
  const gait = GAITS.update(r.id, time, r.x, r.z, GAIT_TARGET).gait;
  const bob = !flying ? Math.abs(Math.cos(r.stride)) * 0.06 * gait : 0;
  const seed = hash(r.id), jacket = dim(r.color, 0.42), trim = r.color;
  t.push(); t.translate(r.x, -(r.y + bob), r.z); t.rotateY(-r.heading * DEG);
  // Flight: lean into the direction of travel, legs trailing, a hover ring and thruster glow.
  if (flying) { t.translate(0, -1.2, 0); t.rotateX(-Math.min(1, Math.abs(r.speed) / 60) * 38 - 6); t.translate(0, 1.2, 0); }
  drawHuman(t, { coat: jacket, trim: PANTS, skin: SKINS[(seed >>> 8) % SKINS.length], light: trim, headwear: HEADWEAR[(seed >>> 4) % HEADWEAR.length], idle: "breathe", prop: null }, { time, seed, stride: r.stride, moving: moving && !flying, gait, detail, distant: !detail }, paint);
  if (detail) {
    const outer = propRange(150);
    // Ring swell on the clock alone (0.38 Hz): stride no longer speeds it up while they run.
    paint(t, trim, "-", 0.8 + Math.sin(time * 2.4 + (seed % 7)) * 0.12);
    t.translate(0, -0.04, 0); t.torus(0.8, 0.035); t.translate(0, 0.04, 0);
    if (flying) {
      // Thruster glow: a slow swell (0.38 Hz), not a 3 Hz flicker (motion comfort: no strobing).
      paint(t, trim, "*", 1.4 + Math.sin(time * 2.4) * 0.12);
      for (const side of [-1, 1]) box(t, side * 0.2, -0.12, 0.1, 0.16, 0.28 + Math.sin(time * 2.4 + side) * 0.08, 0.16);
    }
    restorePropRange(outer);
  }
  t.pop();
}

const indoorPaint: HumanPaint = (canvas, color, glyph, gain = 1) => {
  canvas.char(glyph); canvas.charColor(color[0] * gain, color[1] * gain, color[2] * gain); canvas.cellColor(0, 0, 0, 255);
};

export function drawInteriorPlayers(canvas: PropCanvas, remotes: readonly RemoteAvatar[], time: number): void {
  for (const remote of remotes) drawRunner(canvas, remote, time, true, indoorPaint);
}

/** What the overlay pass needs to place name tags: this frame's remotes and camera. */
export interface RemoteLabelFrame { remotes: readonly RemoteAvatar[]; cam: ViewCamera; visible?: (x: number, y: number, z: number) => boolean }

/** Name tags on the flat overlay layer (ortho, origin at the centre, one unit per cell): the head
 * position is projected with the engine camera and the name printed on whole cells, so tags stay
 * crisp at any distance. Behind buildings they dim instead of vanishing, which helps find friends;
 * far away they add the distance. */
export function drawRemoteLabels(t: Textmodifier, cols: number, rows: number, frame: RemoteLabelFrame | null): void {
  if (!frame?.remotes.length) return;
  t.printAlign("center", "middle");
  for (const r of frame.remotes) {
    const distance = Math.hypot(r.x - frame.cam.x, r.z - frame.cam.z);
    if (distance > TAG_RANGE || distance < 1.2) continue;
    const top = (r.mode === "sky" ? Math.max(0, r.y) + 2.6 : inVehicle(r) ? 2.9 : r.y + 3.05);
    const p = project(frame.cam, r.x, top, r.z);
    if (!p) continue;
    const gx = Math.round(p.sx * cols / 2), gy = Math.round(-p.sy * rows / 2) - 1;
    if (Math.abs(gx) > cols / 2 + 8 || Math.abs(gy) > rows / 2) continue;
    const seen = !frame.visible || distance < 12 || frame.visible(r.x, top - 1, r.z);
    const gain = seen ? 1 : 0.45;
    t.charColor(r.color[0] * gain, r.color[1] * gain, r.color[2] * gain);
    t.cellColor(r.color[0] * 0.08, r.color[1] * 0.08, r.color[2] * 0.08, seen ? 200 : 110);
    t.print(distance > 60 ? `${r.name} ${Math.round(distance)}m` : r.name, gx, gy, { markup: false });
  }
  t.cellColor(0, 0, 0, 0);
}
