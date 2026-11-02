import { DISTRICTS, LINE_DECK_HEIGHT, RAIL_DECK_HALF, RAIL_GEOMETRY, RAIL_SUPPORTS, STATION_SITES, type RailGeometry, type RGB } from "./world.ts";

/** City Loop platforms (and the floor of a train standing at one). Every platform stands 1.2 m
 * above its line's base deck; stations are always at the base height (the profile is flat there). */
export const PLATFORM_HEIGHT = 28.9;
/** Rim Line platforms. */
export const RIM_PLATFORM_HEIGHT = 40.9;
export const TRAIN_EYE_HEIGHT = 2.35;
export const DWELL = 14;
export const TRAINS_PER_LINE = 4;

export interface Pose { x: number; z: number; yaw: number }
/** A point on a line: `rise` is the deck's height above the line's base (0 at every station),
 * `grade` its slope (rise per metre along the direction of travel). */
export interface TrackPose extends Pose { rise: number; grade: number }
/** `line` is the line id, `station`/`next` global STATIONS indices, `floor` the carriage floor
 * height at its centre (it pitches by `grade`: see `floorHeight`), `distance` its track distance. */
export interface Train extends Pose { id: number; line: number; station: number | null; next: number; doors: number; speed: number; remaining: number; progress: number; floor: number; grade: number; distance: number }

const wrap = (n: number, length: number): number => ((n % length) + length) % length;
/** A rounded rectangle (world.ts RailGeometry) from the west end of its north straight, eastbound. */
function roundedLength(g: RailGeometry): number {
  return 2 * (2 * (g.hx - g.radius) + 2 * (g.hz - g.radius)) + 4 * (Math.PI * g.radius / 2);
}
function roundedPose(g: RailGeometry, distance: number, length: number): Pose {
  const R = g.radius, sx = g.hx - R, sz = g.hz - R, arc = Math.PI * R / 2, lx = 2 * sx, lz = 2 * sz;
  let d = wrap(distance, length);
  if (d <= lx) return { x: -sx + d, z: -g.hz, yaw: Math.PI / 2 }; d -= lx;
  if (d <= arc) { const a = -Math.PI / 2 + d / R; return { x: sx + Math.cos(a) * R, z: -sz + Math.sin(a) * R, yaw: Math.PI / 2 + d / R }; } d -= arc;
  if (d <= lz) return { x: g.hx, z: -sz + d, yaw: Math.PI }; d -= lz;
  if (d <= arc) { const a = d / R; return { x: sx + Math.cos(a) * R, z: sz + Math.sin(a) * R, yaw: Math.PI + a }; } d -= arc;
  if (d <= lx) return { x: sx - d, z: g.hz, yaw: Math.PI * 1.5 }; d -= lx;
  if (d <= arc) { const a = Math.PI / 2 + d / R; return { x: -sx + Math.cos(a) * R, z: sz + Math.sin(a) * R, yaw: Math.PI * 1.5 + d / R }; } d -= arc;
  if (d <= lz) return { x: -g.hx, z: sz - d, yaw: Math.PI * 2 }; d -= lz;
  const a = Math.PI + d / R;
  return { x: -sx + Math.cos(a) * R, z: -sz + Math.sin(a) * R, yaw: Math.PI * 2 + d / R };
}
/** Track distance of the point of a rounded rectangle nearest (x, z). */
function roundedDistance(g: RailGeometry, x: number, z: number): number {
  const R = g.radius, sx = g.hx - R, sz = g.hz - R, arc = Math.PI * R / 2, lx = 2 * sx, lz = 2 * sz;
  if (Math.abs(x) <= sx) return z < 0 ? x + sx : lx + arc + lz + arc + sx - x;
  if (Math.abs(z) <= sz) return x > 0 ? lx + arc + z + sz : 2 * lx + lz + 3 * arc + sz - z;
  const ex = Math.sign(x), ez = Math.sign(z), a = Math.atan2(z - ez * sz, x - ex * sx);
  if (ex > 0 && ez < 0) return lx + (a + Math.PI / 2) * R;
  if (ex > 0) return lx + arc + lz + a * R;
  if (ez > 0) return 2 * lx + lz + 2 * arc + (a - Math.PI / 2) * R;
  return 2 * lx + 2 * lz + 3 * arc + (a + Math.PI) * R;
}

/** Deck height profile: raised-cosine humps (rise > 0) and dips (rise < 0) between stations, as
 * metres along a leg from its first station. Every station keeps at least 70 m of level track on
 * both sides, and no hump touches a corner. Amplitudes are limited by comfort, not looks: at the
 * trains' real speeds (tests/rail-profile.test.ts) the floor never moves vertically faster than
 * 2.5 m/s or accelerates vertically by more than 0.9 m/s^2. A hump of height A over L metres
 * pulls 2 pi^2 A v^2 / L^2 at its crest, so the loop's 448 m legs (crest at ~38 m/s) only take
 * ~2.5 m; the longer sides and the Rim Line's legs take 6-11 m. */
interface Hump { leg: number; from: number; to: number; rise: number }
const LINE_HUMPS: readonly (readonly Hump[])[] = [
  [
    { leg: 0, from: 70, to: 378, rise: 2.5 }, // Foundry -> Neon Ward: up over the Ward's approach
    { leg: 1, from: 70, to: 378, rise: 2.5 }, // Neon Ward -> Ghost Circuit
    { leg: 2, from: 110, to: 603, rise: 6 }, // the Ghost Circuit / Spillway side, between its corners
    { leg: 3, from: 70, to: 378, rise: -2.5 }, // down through the Spillway
    { leg: 4, from: 70, to: 378, rise: 2 }, // Silk Market -> Rain Gardens
    { leg: 5, from: 110, to: 603, rise: 6.5 }, // the long rise along the Gardens / Foundry side
  ],
  [
    { leg: 0, from: 70, to: 570, rise: 6 }, // Neon Breakwater -> Signal Pier
    { leg: 1, from: 175, to: 798, rise: 10 }, // after the north-east corner, high over Ghost Circuit's edge
    { leg: 2, from: 70, to: 570, rise: -6 }, // down past the Spillway Locks
    { leg: 3, from: 175, to: 798, rise: 9 }, // after the south-east corner
    { leg: 4, from: 70, to: 570, rise: 5 }, // Silk Harbour -> Gardens Rim
    { leg: 5, from: 175, to: 798, rise: 8 }, // after the south-west corner
    { leg: 6, from: 70, to: 570, rise: 6 }, // Floodgate -> Foundry Gate
    { leg: 7, from: 175, to: 798, rise: 11 }, // the long climb past the Foundry yards
  ],
];

const ACCELERATION = 3.2, MAX_SPEED = 39;
export interface LineInfo {
  id: number; name: string; short: string; color: RGB; hex: string;
  geometry: RailGeometry; length: number; deck: number; platform: number;
  /** Track distances of its stations, in running order (STATIONS from `firstStation`). */
  stops: readonly number[]; firstStation: number; firstTrain: number; cycle: number;
  /** Lowest and highest carriage floor anywhere on the line (multiplayer height checks). */
  floorRange: readonly [number, number];
}
const LINE_NAMES = [
  { name: "City Loop", short: "CITY LOOP", color: [111, 214, 196] as RGB, hex: "#6fd6c4" },
  { name: "Rim Line", short: "RIM LINE", color: [236, 168, 92] as RGB, hex: "#eca85c" },
];
interface Leg { start: number; length: number; humps: readonly Hump[]; peak: number; ramp: number; cruise: number; duration: number }
const LINE_LEGS: Leg[][] = [];
export const LINES: readonly LineInfo[] = RAIL_GEOMETRY.map((geometry, id) => {
  const length = roundedLength(geometry), firstStation = STATION_SITES.findIndex(site => site.line === id);
  const stops = STATION_SITES.filter(site => site.line === id).map(site => roundedDistance(geometry, site.x, site.z));
  // Short legs use triangular profiles instead of overshooting their station.
  const legs = stops.map((start, i) => {
    const legLength = wrap(stops[(i + 1) % stops.length] - start, length);
    const peak = Math.min(MAX_SPEED, Math.sqrt(legLength * ACCELERATION)), ramp = peak / ACCELERATION, cruise = Math.max(0, (legLength - peak * ramp) / peak);
    return { start, length: legLength, humps: LINE_HUMPS[id].filter(hump => hump.leg === i), peak, ramp, cruise, duration: ramp * 2 + cruise };
  });
  LINE_LEGS.push(legs);
  const platform = id === 0 ? PLATFORM_HEIGHT : RIM_PLATFORM_HEIGHT, humps = LINE_HUMPS[id];
  // A carriage end (22 m from the centre) sits up to 22 x the steepest grade off the centre floor.
  const pitch = 22 * Math.max(0, ...humps.map(hump => Math.abs(hump.rise) * Math.PI / (hump.to - hump.from)));
  const floorRange = [platform + Math.min(0, ...humps.map(hump => hump.rise)) - pitch, platform + Math.max(0, ...humps.map(hump => hump.rise)) + pitch] as const;
  return { id, ...LINE_NAMES[id], geometry, length, deck: LINE_DECK_HEIGHT[id], platform, stops, firstStation, firstTrain: id * TRAINS_PER_LINE, cycle: legs.reduce((sum, leg) => sum + DWELL + leg.duration, 0), floorRange };
});
export const TRAIN_COUNT = LINES.length * TRAINS_PER_LINE;
/** The line a (global) train id runs on; ids outside 0..TRAIN_COUNT - 1 clamp. */
export const lineOfTrain = (id: number): LineInfo => LINES[Math.max(0, Math.min(LINES.length - 1, Math.floor(id / TRAINS_PER_LINE)))];

function profileAt(line: number, distance: number): { rise: number; grade: number } {
  const info = LINES[line];
  for (const leg of LINE_LEGS[line]) {
    const s = wrap(distance - leg.start, info.length);
    if (s >= leg.length) continue;
    let rise = 0, grade = 0;
    for (const hump of leg.humps) {
      if (s <= hump.from || s >= hump.to) continue;
      const span = hump.to - hump.from, phase = (s - hump.from) / span * Math.PI * 2;
      rise += hump.rise * (1 - Math.cos(phase)) / 2; grade += hump.rise * Math.PI / span * Math.sin(phase);
    }
    return { rise, grade };
  }
  return { rise: 0, grade: 0 };
}
/** Position, heading, deck rise and grade of `line` at a track distance. */
export function linePose(line: number, distance: number): TrackPose {
  const info = LINES[line];
  return { ...roundedPose(info.geometry, distance, info.length), ...profileAt(line, distance) };
}
/** Track distance of the point of `line` nearest (x, z). */
export const lineDistance = (line: number, x: number, z: number): number => roundedDistance(LINES[line].geometry, x, z);
/** Deck top height of `line` at a track distance (platforms stand 1.2 m above the base deck). */
export const deckHeight = (line: number, distance: number): number => LINES[line].deck + profileAt(line, distance).rise;
/** Each viaduct support's deck height (world.ts RAIL_SUPPORTS order): its legs reach this soffit. */
export const SUPPORT_SOFFITS: readonly number[] = RAIL_SUPPORTS.map(support => deckHeight(support.line, lineDistance(support.line, support.x, support.z)) - RAIL_DECK_HALF);
/** Floor height at carriage-local v (toward the rear): the carriage is a rigid body pitched by its grade. */
/** Bogie distance from the train's centre along the track (the outer cars' centres). */
const BOGIE = 15;
export const floorHeight = (train: Pick<Train, "floor" | "grade">, v: number): number => train.floor - v * train.grade / Math.hypot(1, train.grade);

const LOOP = LINES[0];
export const TRACK_LENGTH = LOOP.length;
export const STATIONS = STATION_SITES.map((site, index) => {
  const line = LINES[site.line], district = DISTRICTS[site.district];
  return { ...district, ...site, id: district.id, index, stop: index - line.firstStation, lineName: line.name, track: line.stops[index - line.firstStation], height: line.platform };
});
export type Station = typeof STATIONS[number];
/** Station indices of a line, in running order. */
export const lineStations = (line: number): Station[] => STATIONS.filter(station => station.line === line);
export interface Passenger { train: number; u: number; v: number; yaw: number }
export const wrapTrack = wrap;
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

/** A line's track (default the City Loop). Rounded corners preserve both position and tangent for riders. */
export function trackPose(distance: number, line = 0): TrackPose { return linePose(line, distance); }
/** The City Loop's timetable cycle. */
export const METRO_CYCLE = LOOP.cycle;

/** Shared clock: visible rolling stock, boarding doors and passenger carriers
 * are always the same physical train. Door opening/closing precedes movement. Train ids are
 * global: 0-3 run the City Loop, 4-7 the Rim Line, each line's four evenly spaced. */
export function trainAt(time: number, id = 0): Train {
  const line = lineOfTrain(id), legs = LINE_LEGS[line.id], count = legs.length;
  let clock = wrap(time + (id - line.firstTrain) * line.cycle / TRAINS_PER_LINE, line.cycle);
  // The three-car set rides on bogies under its outer cars: its floor is the mean of the deck
  // there and its pitch the chord between them, so a change of curvature under one bogie eases in
  // instead of jolting the carriage ends (vertical motion stays continuous everywhere aboard).
  const at = (distance: number, rest: Pick<Train, "station" | "next" | "doors" | "speed" | "remaining" | "progress">): Train => {
    const pose = linePose(line.id, distance), front = profileAt(line.id, distance + BOGIE), rear = profileAt(line.id, distance - BOGIE);
    return { ...pose, ...rest, grade: (front.rise - rear.rise) / (2 * BOGIE), id, line: line.id, floor: line.platform + (front.rise + rear.rise) / 2, distance: wrap(distance, line.length) };
  };
  for (let i = 0; i < count; i++) {
    const leg = legs[i], next = line.firstStation + (i + 1) % count;
    if (clock <= DWELL) return at(leg.start, { station: line.firstStation + i, next, doors: Math.min(clamp(clock / 1.3, 0, 1), clamp((DWELL - clock) / 1.3, 0, 1)), speed: 0, remaining: DWELL - clock, progress: 0 });
    clock -= DWELL;
    if (clock <= leg.duration) {
      const { peak, ramp, cruise, duration, length } = leg;
      let distance: number, speed: number;
      if (clock < ramp) { speed = ACCELERATION * clock; distance = ACCELERATION * clock * clock / 2; }
      else if (clock < ramp + cruise) { speed = peak; distance = peak * ramp / 2 + peak * (clock - ramp); }
      else { const left = Math.max(0, duration - clock); speed = ACCELERATION * left; distance = length - ACCELERATION * left * left / 2; }
      return at(leg.start + distance, { station: null, next, doors: 0, speed, remaining: duration - clock, progress: distance / length });
    }
    clock -= leg.duration;
  }
  return at(legs[0].start, { station: line.firstStation, next: line.firstStation + 1 % count, doors: 0, speed: 0, remaining: 0, progress: 0 });
}
/** The trains of a station's line at `time`. */
function lineTrains(time: number, station: number): Train[] {
  const line = LINES[STATIONS[station]?.line ?? 0];
  return Array.from({ length: TRAINS_PER_LINE }, (_, k) => trainAt(time, line.firstTrain + k));
}
export function stationArrival(time: number, station: number): { train: Train; seconds: number } {
  const trains = lineTrains(time, station), line = LINES[STATIONS[station]?.line ?? 0];
  const docked = trains.find(t => t.station === station);
  if (docked) return { train: docked, seconds: 0 };
  for (let seconds = 1; seconds <= Math.ceil(line.cycle / TRAINS_PER_LINE) + 2; seconds++) {
    for (let k = 0; k < TRAINS_PER_LINE; k++) { const train = trainAt(time + seconds, line.firstTrain + k); if (train.station === station) return { train, seconds }; }
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

/** The player's seat. A seated rider's eyes sit just above the backrest rail (head centre
 *  SEATED.head, minus a little), so the open window above the backrest fills the view. */
export const SEATED_EYE_HEIGHT = SEATED.head - 0.04;
/** How far (to the aisle spot in front of a seat) the player can reach to sit down. */
export const SEAT_REACH = 1.5;
/** Seated look range around the window direction, and the default slight downward tilt toward
 *  the street. Generous but bounded, so the head never turns through the backrest. */
export const SEAT_LOOK = { yaw: 100 * Math.PI / 180, pitch: 45 * Math.PI / 180, tilt: -0.12 } as const;
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
/** The aisle spot in front of a seat: where a rider stands before sitting and after rising.
 *  Always inside the walkable aisle (canWalkInTrain). */
export const seatStand = (seat: Seat): { u: number; v: number } => ({ u: seat.side * BENCH.stand, v: seat.v });
/** Seated eye, carriage-local (y up from the floor): above the hips, a hand's width toward the
 *  aisle from the head centre, clear of the cushion, backrest and rail. */
export const seatedEye = (seat: Seat): { u: number; v: number; y: number } => ({ u: seat.side * (BENCH.hip - 0.1), v: seat.v, y: SEATED_EYE_HEIGHT });
/** Looking straight out of the side window behind a seat on `side` (the opposite of seatedYaw). */
export const windowYaw = (trainYaw: number, side: number): number => trainYaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
/** Seconds the view takes to turn to the window when sitting down: the 0.4 s of the sit itself for
 *  small turns, longer for big ones, so the (smoothstep) turn never peaks above ~250 degrees/s
 *  (motion comfort: a half turn in 0.4 s would whip the view round). */
export const seatTurnSeconds = (turn: number): number => Math.max(0.4, Math.abs(turn) * 0.35);
/** Nearest seat that `free` accepts, measured to its aisle spot, within `reach` of (u, v). */
export function nearestFreeSeat(u: number, v: number, free: (seat: Seat) => boolean, reach = SEAT_REACH): Seat | null {
  let best: Seat | null = null, bestDistance = reach;
  for (const seat of SEATS) {
    const stand = seatStand(seat), distance = Math.hypot(u - stand.u, v - stand.v);
    if (distance <= bestDistance && free(seat)) { best = seat; bestDistance = distance; }
  }
  return best;
}
/** Keeps a seated look (unwrapped world yaw, pitch) within SEAT_LOOK around the window; the
 *  returned yaw stays on the caller's unwrapped branch, so it never jumps a full turn. */
export function clampSeatedLook(yaw: number, pitch: number, trainYaw: number, side: number): { yaw: number; pitch: number } {
  const delta = angleDelta(windowYaw(trainYaw, side), yaw);
  return { yaw: yaw - delta + clamp(delta, -SEAT_LOOK.yaw, SEAT_LOOK.yaw), pitch: clamp(pitch, SEAT_LOOK.tilt - SEAT_LOOK.pitch, SEAT_LOOK.tilt + SEAT_LOOK.pitch) };
}

export function moveInTrain(passenger: Passenger, yaw: number, forward: number, strafe: number, dt: number): void {
  const angle = yaw - passenger.yaw, step = 4.5 * Math.min(0.15, dt) / Math.max(1, Math.hypot(forward, strafe));
  const du = (Math.sin(angle) * forward + Math.cos(angle) * strafe) * step;
  const dv = (-Math.cos(angle) * forward + Math.sin(angle) * strafe) * step;
  if (canWalkInTrain(passenger.u + du, passenger.v)) passenger.u += du;
  if (canWalkInTrain(passenger.u, passenger.v + dv)) passenger.v += dv;
}
export function boardingTrain(time: number, station: number): Train | undefined {
  return lineTrains(time, station).find(t => t.station === station && t.doors > 0.85);
}

/** The next train at a station, read straight off the timetable (no search, cheap enough per
 *  frame): `docked` while one stands there, `seconds` then being its dwell left, else the seconds
 *  until the next one arrives. Agrees with `stationArrival` and `trainAt` (tests/metro.test.ts). */
export interface NextTrain { train: number; seconds: number; docked: boolean }
export function nextTrain(time: number, station: number): NextTrain {
  const site = STATIONS[station] ?? STATIONS[0], line = LINES[site.line], legs = LINE_LEGS[line.id];
  let arrive = 0; // clock (seconds into a train's cycle) at which it reaches this stop
  for (let i = 0; i < site.stop; i++) arrive += DWELL + legs[i].duration;
  let best: NextTrain = { train: line.firstTrain, seconds: Infinity, docked: false };
  for (let k = 0; k < TRAINS_PER_LINE; k++) {
    const since = wrap(wrap(time + k * line.cycle / TRAINS_PER_LINE, line.cycle) - arrive, line.cycle);
    if (since <= DWELL) return { train: line.firstTrain + k, seconds: DWELL - since, docked: true };
    if (line.cycle - since < best.seconds) best = { train: line.firstTrain + k, seconds: line.cycle - since, docked: false };
  }
  return best;
}
/** Departure board refresh: letters change at most once per this many seconds (motion comfort). */
export const BOARD_STEP = 2;
/** What a platform's departure board shows at `time`: the timetable read at the start of the
 *  current BOARD_STEP, so the text is truthful to within the step and never changes faster.
 *  Letters only (the sign shader draws A-Z, 0-9 and spaces). */
export function departureBoard(time: number, station: number): { status: string; destination: string } {
  const step = Math.floor(time / BOARD_STEP) * BOARD_STEP, next = nextTrain(step, station);
  const site = STATIONS[station] ?? STATIONS[0], stops = lineStations(site.line);
  const destination = stops[(site.stop + 1) % stops.length].name.replace("The ", "").toUpperCase().slice(0, 16);
  const s = Math.max(0, Math.ceil(next.seconds));
  if (next.docked) return { status: s <= 3 ? "DOORS CLOSING" : `DEPARTS ${s}S`, destination };
  if (s <= 12) return { status: "ARRIVING", destination };
  return { status: s >= 60 ? `NEXT ${Math.floor(s / 60)}M ${String(s % 60).padStart(2, "0")}S` : `NEXT ${s}S`, destination };
}
