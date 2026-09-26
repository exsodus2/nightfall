import { DISTRICTS } from "./world.ts";

export const PLATFORM_HEIGHT = 28.9;
export const TRAIN_EYE_HEIGHT = 2.35;
export const DWELL = 14;
const RADIUS = 64, ARC = Math.PI * RADIUS / 2;
export const TRACK_LENGTH = 2816 + ARC * 4;
const STOPS = [0, 448, 896, 1408 + ARC * 2, 1856 + ARC * 2, 2304 + ARC * 2];
export const STATIONS = [0, 1, 2, 5, 4, 3].map((id, i) => ({ ...DISTRICTS[id], x: i < 3 ? -448 + i * 448 : 448 - (i - 3) * 448, z: i < 3 ? -320 : 320, yaw: i < 3 ? Math.PI / 2 : -Math.PI / 2, track: STOPS[i], index: i }));
export type Station = typeof STATIONS[number];
export interface Pose { x: number; z: number; yaw: number }
export interface Train extends Pose { id: number; station: number | null; next: number; doors: number; speed: number; remaining: number; progress: number }
export interface Passenger { train: number; u: number; v: number; yaw: number }
export const wrapTrack = (n: number, length: number): number => ((n % length) + length) % length;
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

/** Local u is carriage-right; v points toward the rear. The renderer and all
 * boarding/collision calculations use this same transform. */
export function localToWorld(pose: Pose, u: number, v: number): { x: number; z: number } {
  return { x: pose.x + Math.cos(pose.yaw) * u - Math.sin(pose.yaw) * v, z: pose.z + Math.sin(pose.yaw) * u + Math.cos(pose.yaw) * v };
}
export function worldToLocal(pose: Pose, x: number, z: number): { u: number; v: number } {
  const dx = x - pose.x, dz = z - pose.z;
  return { u: Math.cos(pose.yaw) * dx + Math.sin(pose.yaw) * dz, v: -Math.sin(pose.yaw) * dx + Math.cos(pose.yaw) * dz };
}

/** Rounded track corners preserve both position and tangent for riders. */
export function trackPose(distance: number): Pose {
  let d = wrapTrack(distance, TRACK_LENGTH);
  if (d <= 896) return { x: -448 + d, z: -320, yaw: Math.PI / 2 }; d -= 896;
  if (d <= ARC) { const a = -Math.PI / 2 + d / RADIUS; return { x: 448 + Math.cos(a) * RADIUS, z: -256 + Math.sin(a) * RADIUS, yaw: Math.PI / 2 + d / RADIUS }; } d -= ARC;
  if (d <= 512) return { x: 512, z: -256 + d, yaw: Math.PI }; d -= 512;
  if (d <= ARC) { const a = d / RADIUS; return { x: 448 + Math.cos(a) * RADIUS, z: 256 + Math.sin(a) * RADIUS, yaw: Math.PI + a }; } d -= ARC;
  if (d <= 896) return { x: 448 - d, z: 320, yaw: Math.PI * 1.5 }; d -= 896;
  if (d <= ARC) { const a = Math.PI / 2 + d / RADIUS; return { x: -448 + Math.cos(a) * RADIUS, z: 256 + Math.sin(a) * RADIUS, yaw: Math.PI * 1.5 + d / RADIUS }; } d -= ARC;
  if (d <= 512) return { x: -512, z: 256 - d, yaw: Math.PI * 2 }; d -= 512;
  const a = Math.PI + d / RADIUS;
  return { x: -448 + Math.cos(a) * RADIUS, z: -256 + Math.sin(a) * RADIUS, yaw: Math.PI * 2 + d / RADIUS };
}

const ACCELERATION = 3.2, MAX_SPEED = 39;
const legLengths = STOPS.map((d, i) => wrapTrack((STOPS[(i + 1) % 6]) - d, TRACK_LENGTH));
// Short legs use triangular profiles instead of overshooting their station.
const profiles = legLengths.map(length => {
  const peak = Math.min(MAX_SPEED, Math.sqrt(length * ACCELERATION));
  const ramp = peak / ACCELERATION;
  const cruise = Math.max(0, (length - peak * ramp) / peak);
  return { length, peak, ramp, cruise, duration: ramp * 2 + cruise };
});
export const METRO_CYCLE = profiles.reduce((sum, p) => sum + DWELL + p.duration, 0);

/** Shared clock: visible rolling stock, boarding doors and passenger carriers
 * are always the same physical train. Door opening/closing precedes movement. */
export function trainAt(time: number, id = 0): Train {
  let clock = wrapTrack(time + id * METRO_CYCLE / 4, METRO_CYCLE);
  for (let i = 0; i < 6; i++) {
    const profile = profiles[i], next = (i + 1) % 6;
    if (clock <= DWELL) return { ...trackPose(STOPS[i]), id, station: i, next, doors: Math.min(clamp(clock / 1.3, 0, 1), clamp((DWELL - clock) / 1.3, 0, 1)), speed: 0, remaining: DWELL - clock, progress: 0 };
    clock -= DWELL;
    if (clock <= profile.duration) {
      const { peak, ramp, cruise, duration, length } = profile;
      let distance: number, speed: number;
      if (clock < ramp) { speed = ACCELERATION * clock; distance = ACCELERATION * clock * clock / 2; }
      else if (clock < ramp + cruise) { speed = peak; distance = peak * ramp / 2 + peak * (clock - ramp); }
      else { const left = Math.max(0, duration - clock); speed = ACCELERATION * left; distance = length - ACCELERATION * left * left / 2; }
      return { ...trackPose(STOPS[i] + distance), id, station: null, next, doors: 0, speed, remaining: duration - clock, progress: distance / length };
    }
    clock -= profile.duration;
  }
  return { ...trackPose(0), id, station: 0, next: 1, doors: 0, speed: 0, remaining: 0, progress: 0 };
}
export function stationArrival(time: number, station: number): { train: Train; seconds: number } {
  const trains = Array.from({ length: 4 }, (_, id) => trainAt(time, id));
  const docked = trains.find(t => t.station === station);
  if (docked) return { train: docked, seconds: 0 };
  for (let seconds = 1; seconds <= Math.ceil(METRO_CYCLE / 4) + 2; seconds++) {
    for (let id = 0; id < 4; id++) { const train = trainAt(time + seconds, id); if (train.station === station) return { train, seconds }; }
  }
  return { train: trains[0], seconds: 60 };
}
export function doorAt(v: number): boolean { return [-15, 0, 15].some(center => Math.abs(v - center) < 1.15); }
export function canWalkInTrain(u: number, v: number): boolean {
  if (Math.abs(v) > 21.7 || Math.abs(u) > 2.27) return false;
  if (Math.abs(u) > 1.28 && !doorAt(v)) return false; // seats and end bulkheads
  return true;
}
/** Axis-aligned box, centre + size. Carriage-local furniture uses u (across), y (up from the
 *  floor), v (along); a person-local pose uses x (right), y, z (+z is the back, -z forward). */
export interface FurnitureBox { part: string; u: number; y: number; v: number; w: number; h: number; d: number }
export interface PoseBox { part: string; x: number; y: number; z: number; w: number; h: number; d: number }
export interface Seat { index: number; side: 1 | -1; carriage: number; u: number; v: number }

export const CARRIAGE_CENTERS = [-15, 0, 15] as const;
/** Seating: each carriage has four three-seat benches against the sidewalls, clear of the doors,
 *  poles and pillars. metro-scene.ts draws exactly these boxes, people-scene.ts draws the seated
 *  pose below, and people.ts assigns commuters to SEATS; tests check the pose never enters the
 *  bench. `hip` is where a seated body's centre sits (its back just touches the backrest). */
export const BENCH = { top: 0.5, front: 1.6, back: 2.42, wall: 2.7, hip: 2.1, stand: 1.1, middle: 4, length: 4.5, pitch: 1.4 } as const;
/** One bench, u always positive (mirrored per side), v relative to the bench middle. */
export const BENCH_PARTS: readonly FurnitureBox[] = [
  { part: "base", u: (1.75 + BENCH.wall) / 2, y: 0.15, v: 0, w: BENCH.wall - 1.75, h: 0.3, d: 4.3 },
  { part: "cushion", u: (BENCH.front + BENCH.back) / 2, y: (0.3 + BENCH.top) / 2, v: 0, w: BENCH.back - BENCH.front, h: BENCH.top - 0.3, d: 4.4 },
  { part: "back", u: (BENCH.back + BENCH.wall) / 2, y: (0.3 + 1.75) / 2, v: 0, w: BENCH.wall - BENCH.back, h: 1.45, d: 4.4 },
  { part: "rail", u: (2.4 + 2.72) / 2, y: 1.8, v: 0, w: 0.32, h: 0.1, d: 4.5 },
  ...[-1, 1].map(end => ({ part: "end", u: (BENCH.front + BENCH.wall) / 2, y: 0.575, v: end * 2.2, w: BENCH.wall - BENCH.front, h: 1.15, d: 0.1 })),
  ...[-1, 1].map(end => ({ part: "divider", u: (1.75 + BENCH.back) / 2, y: BENCH.top + 0.15, v: end * BENCH.pitch / 2, w: BENCH.back - 1.75, h: 0.3, d: 0.08 })),
];
/** Every bench's middle, as (side, carriage centre, v). */
export const BENCHES = CARRIAGE_CENTERS.flatMap(center => ([1, -1] as const).flatMap(side => [-1, 1].map(end => ({ side, carriage: center, v: center + end * BENCH.middle }))));
export const SEATS: readonly Seat[] = BENCHES.flatMap(bench => [-1, 0, 1].map(k => ({ side: bench.side, carriage: bench.carriage, u: bench.side * BENCH.hip, v: bench.v + k * BENCH.pitch }))).map((seat, index) => ({ index, ...seat }));
/** Seated body, person-local, origin on the floor under the hips' centre. Thighs lie along the
 *  cushion, shins drop in front of its edge, feet rest flat on the floor, forearms on the lap. */
export const SEATED = { torso: BENCH.top + 0.68, head: BENCH.top + 1.51, hat: BENCH.top + 1.76 } as const;
export const SEATED_POSE: readonly PoseBox[] = [-1, 1].flatMap(side => [
  { part: "thigh", x: side * 0.2, y: BENCH.top + 0.13, z: -0.3, w: 0.28, h: 0.26, d: 0.6 },
  { part: "shin", x: side * 0.2, y: 0.38, z: -0.67, w: 0.26, h: 0.48, d: 0.26 },
  { part: "foot", x: side * 0.2, y: 0.085, z: -0.78, w: 0.3, h: 0.17, d: 0.4 },
  { part: "arm", x: side * 0.48, y: 1.34, z: -0.02, w: 0.2, h: 0.76, d: 0.24 },
  { part: "forearm", x: side * 0.38, y: 0.86, z: -0.34, w: 0.18, h: 0.16, d: 0.52 },
]);
/** The torso and head ellipsoids' bounding boxes, for overlap checks. */
export const SEATED_BODY: readonly PoseBox[] = [
  { part: "torso", x: 0, y: SEATED.torso, z: 0, w: 0.86, h: 1.36, d: 0.6 },
  { part: "head", x: 0, y: SEATED.head, z: -0.04, w: 0.5, h: 0.64, d: 0.5 },
];
/** A seated person's box in carriage coordinates: they face the aisle, so their +z (back) points
 *  to the wall on their side and their right (+x) points along -side * v. */
export function seatedBox(box: PoseBox, u: number, v: number, side: 1 | -1): FurnitureBox {
  return { part: box.part, u: u + side * box.z, y: box.y, v: v - side * box.x, w: box.d, h: box.h, d: box.w };
}
/** Facing the aisle from a seat on `side`. */
export const seatedYaw = (trainYaw: number, side: number): number => trainYaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);

export function moveInTrain(passenger: Passenger, yaw: number, forward: number, strafe: number, dt: number): void {
  const angle = yaw - passenger.yaw, step = 4.5 * Math.min(0.15, dt) / Math.max(1, Math.hypot(forward, strafe));
  const du = (Math.sin(angle) * forward + Math.cos(angle) * strafe) * step;
  const dv = (-Math.cos(angle) * forward + Math.sin(angle) * strafe) * step;
  if (canWalkInTrain(passenger.u + du, passenger.v)) passenger.u += du;
  if (canWalkInTrain(passenger.u, passenger.v + dv)) passenger.v += dv;
}
export function boardingTrain(time: number, station: number): Train | undefined {
  return Array.from({ length: 4 }, (_, id) => trainAt(time, id)).find(t => t.station === station && t.doors > 0.85);
}
