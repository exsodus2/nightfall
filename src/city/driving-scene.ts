import type { PropCanvas } from "./prop-canvas";
import type { Textmodifier } from "textmode.js";
import { carColor, cuboid as box, drawCar, ink, propRange, restorePropRange, type ActivityView } from "./activity";
import { DRIVER_EYE_HEIGHT, type DriveCar, type ParkedCar } from "./driving";
import { steeringWheelAngle } from "./drive-view";
import { drawRearCabin } from "./vehicle-cabin";

/** Parked cars along the kerbs, plus the player's car: the whole body once the camera is outside
 * it (chase view), or the cockpit around the driver's eye. */
export function drawDriving(t: PropCanvas, view: ActivityView, parked: readonly ParkedCar[], car: DriveCar | null, exterior: boolean, mirror: boolean): void {
  const outer = propRange(view.low ? 90 : 140);
  for (const c of parked) {
    if (view.visible && !view.visible(c.x, 2, c.z, 2.5)) continue;
    drawCar(t, c.x, 0, c.z, c.yaw, c.id, Math.hypot(c.x - view.x, c.z - view.z) < 70);
  }
  // The player's own car never dissolves with distance and is never culled.
  propRange(0);
  if (car && exterior) drawCar(t, car.x, 0, car.z, car.yaw, car.id, true, false, { speed: car.speed });
  else if (car && !mirror) drawCockpit(t, car);
  restorePropRange(outer);
}

const DEG = 180 / Math.PI;
/** Cockpit-local point: x right, height up, z toward the rear (the drawCar frame). */
type Point = readonly [number, number, number];
/** A box of cross-section w x d stretched from a to b (any direction). */
function strut(t: PropCanvas, a: Point, b: Point, w: number, d: number): void {
  const dx = b[0] - a[0], dy = a[1] - b[1], dz = b[2] - a[2]; // textmode Y points down
  t.push(); t.translate((a[0] + b[0]) / 2, -(a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  t.rotateY(Math.atan2(dx, dz) * DEG); t.rotateX(Math.atan2(Math.hypot(dx, dz), dy) * DEG);
  t.box(w, Math.hypot(dx, dy, dz), d); t.pop();
}

// Driver's eye (see DriveSession): 0.45 m right of centre, 0.15 m behind the middle.
const EYE: Point = [0.45, DRIVER_EYE_HEIGHT, 0.15];
// The wheel hub sits 0.6 m ahead of and 0.3 m below the eye, on a column raked 25 degrees up
// from horizontal toward the driver. textmode's torus radius is measured to the tube centreline.
const HUB: Point = [EYE[0], EYE[1] - 0.3, EYE[2] - 0.6];
const COLUMN_RAKE = 25;
const RIM = 0.14, TUBE = 0.02, GRIP = RIM;

function drawCockpit(t: PropCanvas, car: DriveCar): void {
  t.push(); t.translate(car.x, 0, car.z); t.rotateY(-car.yaw * 180 / Math.PI);
  const body = carColor(car.id);
  // Bonnet: sloping down from the scuttle to the nose so the road shows from ~9 m ahead, with
  // bright crease lines along its edges and a lip at the nose so its outline reads.
  t.push(); t.translate(0, -1.25, -1.98); t.rotateX(6.7);
  ink(t, body, "=", 0.5); t.box(2.62, 0.12, 1.88);
  ink(t, body, "-", 0.95);
  for (const side of [-1, 1]) { t.translate(side * 1.25, -0.07, 0); t.box(0.1, 0.03, 1.86); t.translate(-side * 1.25, 0.07, 0); }
  t.translate(0, -0.06, -0.93); t.box(2.5, 0.04, 0.05);
  t.pop();
  // Dashboard across the car, a lighter crash pad along its rear edge, the instrument binnacle
  // with its glowing display, and the centre screen.
  ink(t, [24, 33, 48], "#");
  box(t, 0, 1.205, -0.87, 2.44, 0.31, 0.5);
  ink(t, [46, 60, 78], "-");
  box(t, 0, 1.365, -0.63, 2.4, 0.03, 0.05);
  ink(t, [18, 26, 38], "=");
  box(t, EYE[0], 1.41, -0.78, 0.4, 0.1, 0.28);
  ink(t, [66, 223, 227], "=", 0.9);
  box(t, EYE[0], 1.385, -0.645, 0.3, 0.03, 0.02);
  ink(t, [212, 92, 190], "=", 0.5);
  box(t, -0.06, 1.28, -0.615, 0.18, 0.1, 0.02);
  // Doors below the window line, with the sill rail on top; the side windows are open glass.
  ink(t, [28, 36, 50], "#");
  for (const side of [-1, 1]) box(t, side * 1.26, 0.98, 0.0, 0.08, 0.84, 2.1);
  ink(t, body, "=", 0.8);
  for (const side of [-1, 1]) box(t, side * 1.23, 1.405, -0.02, 0.14, 0.04, 2.06);
  // A-pillars rake back from the scuttle to the roof; the header and roof rails close the glass,
  // the rear-view mirror hangs from the header, the wing mirrors sit outside the pillar bases.
  ink(t, body, "|", 0.45);
  for (const side of [-1, 1]) strut(t, [side * 1.2, 1.36, -1.12], [side * 1.12, 2.06, -0.62], 0.11, 0.13);
  box(t, 0, 2.07, -0.56, 2.3, 0.1, 0.2);
  for (const side of [-1, 1]) box(t, side * 1.13, 2.07, 0.3, 0.09, 0.08, 1.7);
  ink(t, [20, 26, 36], "=");
  box(t, 0, 2.11, 0.35, 2.2, 0.03, 1.8);
  box(t, 0.02, 1.96, -0.58, 0.26, 0.07, 0.03);
  ink(t, [120, 170, 190], "/", 0.35);
  box(t, 0.02, 1.96, -0.563, 0.22, 0.05, 0.005);
  ink(t, body, "=", 0.7);
  for (const side of [-1, 1]) {
    box(t, side * 1.47, 1.52, -0.98, 0.26, 0.15, 0.1);
    strut(t, [side * 1.27, 1.47, -0.98], [side * 1.36, 1.5, -0.98], 0.05, 0.05);
  }
  ink(t, [120, 170, 190], "/", 0.45);
  for (const side of [-1, 1]) box(t, side * 1.47, 1.52, -0.925, 0.22, 0.11, 0.01);
  drawRearCabin(t, body, ink);
  drawSteeringWheel(t, car.steer);
  t.pop();
}

/** The wheel turns about its own column: move to the hub, tilt the ring (textmode's torus lies in
 * its local XZ plane, axis Y) so its axis runs along the raked column, then rotate about that axis
 * by the steering angle. Rim, spokes, hub, the top marker and the driver's hands turn together. */
function drawSteeringWheel(t: PropCanvas, steer: number): void {
  const tilt = COLUMN_RAKE - 90; // local Y -> down-forward along the column (Y is down)
  const turn = steeringWheelAngle(steer);
  t.push(); t.translate(HUB[0], -HUB[1], HUB[2]); t.rotateX(tilt);
  // Column shroud from the hub into the dash (does not turn).
  ink(t, [26, 34, 46], "#");
  t.translate(0, 0.16, 0); t.box(0.08, 0.3, 0.08); t.translate(0, -0.16, 0);
  t.rotateY(turn);
  ink(t, [58, 70, 86], "O", 1.1);
  t.torus(RIM, TUBE);
  // Three spokes (left, right, bottom) and the hub; local -Z is 12 o'clock, +X is 3 o'clock.
  ink(t, [96, 112, 128], "=", 0.9);
  t.box(GRIP * 2, 0.018, 0.035);
  t.translate(0, 0, GRIP / 2); t.box(0.035, 0.018, GRIP); t.translate(0, 0, -GRIP / 2);
  ink(t, [36, 46, 60], "#");
  t.ellipsoid(0.06, 0.028, 0.055);
  ink(t, [66, 223, 227], "+", 0.9);
  t.translate(0, -0.03, 0); t.box(0.03, 0.006, 0.03); t.translate(0, 0.03, 0);
  // 12 o'clock stripe: shows how far the wheel is turned.
  ink(t, [255, 176, 72], "|", 1.1);
  t.translate(0, 0, -GRIP); t.box(0.024, TUBE * 1.6, TUBE * 1.6); t.translate(0, 0, GRIP);
  // Gloved hands at a quarter to three.
  ink(t, [118, 88, 70], "@", 0.9);
  for (const side of [-1, 1]) { t.translate(side * GRIP, 0, -0.02); t.ellipsoid(0.042, 0.04, 0.062); t.translate(-side * GRIP, 0, 0.02); }
  t.pop();
  // Forearms follow the hands (computed in the cockpit frame) back to elbows below the view.
  const a = tilt / DEG, b = turn / DEG;
  ink(t, [46, 54, 72], "#");
  for (const side of [-1, 1]) {
    const lx = side * GRIP * Math.cos(b) - 0.02 * Math.sin(b), lz = -side * GRIP * Math.sin(b) - 0.02 * Math.cos(b);
    const hand: Point = [HUB[0] + lx, HUB[1] + Math.sin(a) * lz, HUB[2] + Math.cos(a) * lz];
    strut(t, [EYE[0] + side * 0.34, EYE[1] - 0.66, EYE[2] + 0.02], hand, 0.075, 0.075);
  }
}

/** Speed and gear, printed on the transparent overlay layer (ortho, origin at the centre). */
export function drawDriveDashboard(t: Textmodifier, rows: number, car: DriveCar, boosting: boolean): void {
  const kmh = Math.round(Math.abs(car.speed) * 3.6).toString().padStart(3, "0");
  const gear = car.speed < -0.3 ? "R" : Math.abs(car.speed) < 0.3 ? "N" : "D";
  t.charColor(169, 231, 210); t.cellColor(0, 0, 0, 0); t.printAlign("center", "middle");
  t.print(`${kmh} KM/H   ${gear}${boosting ? "   BOOST" : ""}`, 0, rows / 2 - 2);
}
