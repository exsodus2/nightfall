// Other players in the 3D city: an ASCII "runner" figure (or their car / taxi) per remote avatar,
// plus a floating name tag. Geometry is written against PropCanvas, so it records into the GPU
// prop instances like residents; the tags need textmode's print and are drawn directly.
import type { Textmodifier } from "textmode.js";
import { cuboid as box, drawCar, ink, propRange, restorePropRange, type ActivityView } from "../city/activity";
import type { PropCanvas } from "../city/prop-canvas";
import type { RGB } from "../city/world";
import { project, type ViewCamera } from "../city/vfx";
import type { RemoteAvatar } from "./types";

const DEG = 180 / Math.PI;
const SHOE: RGB = [30, 32, 38];
const PANTS: RGB = [44, 50, 60];
const SKIN: RGB = [176, 140, 112];
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
    else drawRunner(t, r, view.time, distance < 150);
  }
  restorePropRange(outer);
}

function drawRunner(t: PropCanvas, r: RemoteAvatar, time: number, detail: boolean): void {
  const flying = r.mode === "fly" && r.y > 0.6;
  const moving = Math.abs(r.speed) > 0.4;
  const gait = !flying && moving ? Math.sin(r.stride) * Math.min(0.42, 0.18 + Math.abs(r.speed) * 0.02) : 0;
  const bob = !flying && moving ? Math.abs(Math.cos(r.stride)) * 0.06 : 0;
  const jacket = dim(r.color, 0.42), trim = r.color;
  t.push(); t.translate(r.x, -(r.y + bob), r.z); t.rotateY(-r.heading * DEG);
  // Flight: lean into the direction of travel, legs trailing, a hover ring and thruster glow.
  if (flying) { t.translate(0, -1.2, 0); t.rotateX(-Math.min(1, Math.abs(r.speed) / 60) * 38 - 6); t.translate(0, 1.2, 0); }
  for (const side of [-1, 1]) {
    const swing = flying ? 0.18 : gait * side;
    ink(t, PANTS, "|"); box(t, side * 0.2, 0.47, swing, 0.26, 0.92, 0.3);
    ink(t, SHOE, "="); box(t, side * 0.2, 0.08, swing - 0.08, 0.28, 0.16, 0.46);
  }
  // Short jacket with a lit collar and a stripe down each side in the player's colour.
  ink(t, jacket, "H");
  t.translate(0, -1.45, 0); t.ellipsoid(0.45, 0.62, 0.31); t.translate(0, 1.45, 0);
  ink(t, trim, "|", 1.15);
  for (const side of [-1, 1]) box(t, side * 0.34, 1.45, -0.2, 0.06, 0.7, 0.05);
  box(t, 0, 2.02, 0, 0.5, 0.07, 0.34);
  for (const side of [-1, 1]) {
    const swing = flying ? -20 : -gait * side * 70;
    t.push(); t.translate(side * 0.52, -1.9, 0); t.rotateX(swing);
    ink(t, jacket, "|"); box(t, 0, -0.44, 0, 0.19, 0.88, 0.23);
    ink(t, SKIN, "o"); box(t, 0, -0.94, 0, 0.13, 0.13, 0.15);
    t.pop();
  }
  // Head with a wraparound visor in the player's colour: distinct from residents and NPCs.
  t.push(); t.translate(0, -2.3, -0.03);
  ink(t, SKIN, "O"); t.ellipsoid(0.24, 0.31, 0.25);
  ink(t, [26, 30, 38], "%"); t.translate(0, -0.12, 0.05); t.ellipsoid(0.27, 0.22, 0.27); t.translate(0, 0.12, -0.05);
  ink(t, trim, "=", 1.3); box(t, 0, 0.02, -0.17, 0.5, 0.1, 0.16);
  t.pop();
  if (detail) {
    const outer = propRange(150);
    ink(t, trim, "-", 0.8 + Math.sin(time * 2.4 + r.stride * 0.1) * 0.12);
    t.translate(0, -0.04, 0); t.rotateX(90); t.torus(0.8, 0.035); t.rotateX(-90); t.translate(0, 0.04, 0);
    if (flying) {
      ink(t, trim, "*", 1.4 + Math.sin(time * 18) * 0.3);
      for (const side of [-1, 1]) box(t, side * 0.2, -0.12, 0.1, 0.16, 0.16 + Math.abs(Math.sin(time * 23 + side)) * 0.25, 0.16);
    }
    restorePropRange(outer);
  }
  t.pop();
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
    t.print(distance > 60 ? `${r.name} ${Math.round(distance)}m` : r.name, gx, gy);
  }
  t.cellColor(0, 0, 0, 0);
}
