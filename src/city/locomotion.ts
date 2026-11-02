import { BLOCK_SIZE, DISTRICTS, WORLD_EDGE, type CityWorld, type Player } from "./world.ts";

export type TravelMode = "walk" | "taxi" | "metro" | "sky" | "fly" | "drive"; // "drive": player car (driving.ts)
export type RideMode = "taxi" | "metro" | "sky";
export interface Waypoint { x: number; y: number; z: number }
export interface Journey {
  mode: Exclude<RideMode, "metro">;
  destination: string;
  points: Waypoint[];
  segment: number;
  travelled: number;
  length: number;
  speed: number;
}
export const MODE_NAMES: Record<TravelMode, string> = { walk: "On foot", taxi: "Ground taxi", metro: "Monorail", sky: "Sky taxi", fly: "Free flight", drive: "Driving" };
export const WALK_HEIGHT = 2.7;
export const wrap = (value: number, length: number): number => ((value % length) + length) % length;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Accumulate relative input once; exponential integration is independent of event rate.
 * Keep yaw unwrapped, so crossing ±PI never causes a full turn. */
export class MouseLook {
  yaw: number;
  pitch: number;
  targetYaw: number;
  targetPitch: number;
  constructor(yaw: number, pitch: number) { this.yaw = this.targetYaw = yaw; this.pitch = this.targetPitch = pitch; }
  add(dx: number, dy: number, sensitivity = 1): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    // Ignore impossible OS recenter events, without truncating legitimate fast swipes.
    if (Math.abs(dx) > 1800 || Math.abs(dy) > 1800) return;
    this.targetYaw += dx * 0.00165 * sensitivity;
    this.targetPitch = clamp(this.targetPitch + dy * 0.00165 * sensitivity, -1.35, 1.25);
  }
  update(dt: number): void {
    const alpha = 1 - Math.exp(-32 * Math.max(0, dt));
    this.yaw += (this.targetYaw - this.yaw) * alpha;
    this.pitch += (this.targetPitch - this.pitch) * alpha;
  }
  reset(yaw: number, pitch: number): void { this.yaw = this.targetYaw = yaw; this.pitch = this.targetPitch = pitch; }
  turn(radians: number): void { this.targetYaw += radians; }
}

function nearestStreet(point: Waypoint): Waypoint {
  const x = Math.round(point.x / BLOCK_SIZE) * BLOCK_SIZE;
  const z = Math.round(point.z / BLOCK_SIZE) * BLOCK_SIZE;
  return Math.abs(x - point.x) < Math.abs(z - point.z) ? { x, z: point.z, y: point.y } : { x: point.x, z, y: point.y };
}

const CONNECTOR_OFFSETS = [0, -2, 2, -4, 4, -8, 8, -16, 16, -32, 32] as const;
const GROUND_ROUTE_STEP = 0.25;
type GroundWorld = Pick<CityWorld, "canOccupy">;

function validGroundPoint(point: Waypoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) && Math.abs(point.x) <= WORLD_EDGE && Math.abs(point.z) <= WORLD_EDGE;
}

function compactRoute(points: readonly Waypoint[]): Waypoint[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.z !== points[index - 1].z).map(point => ({ ...point }));
}

function clearGroundRoute(world: GroundWorld, points: readonly Waypoint[]): boolean {
  if (!points.every(point => validGroundPoint(point) && world.canOccupy(point.x, point.z))) return false;
  for (let segment = 1; segment < points.length; segment++) {
    const start = points[segment - 1], end = points[segment];
    const steps = Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / GROUND_ROUTE_STEP);
    for (let step = 1; step < steps; step++) {
      const progress = step / steps;
      if (!world.canOccupy(start.x + (end.x - start.x) * progress, start.z + (end.z - start.z) * progress)) return false;
    }
  }
  return true;
}

function streetConnector(world: GroundWorld, point: Waypoint): Waypoint[] | null {
  const candidates: { points: Waypoint[]; length: number; order: number }[] = [];
  for (const axis of ["x", "z"] as const) for (const offset of CONNECTOR_OFFSETS) {
    const turn = { ...point, [axis]: point[axis] + offset };
    const crossAxis = axis === "x" ? "z" : "x";
    const crossStreet = Math.floor(turn[crossAxis] / BLOCK_SIZE) * BLOCK_SIZE;
    const alongStreet = Math.floor(turn[axis] / BLOCK_SIZE) * BLOCK_SIZE;
    for (const crossOffset of [0, BLOCK_SIZE]) for (const alongOffset of [0, BLOCK_SIZE]) {
      const street = { ...turn, [crossAxis]: crossStreet + crossOffset };
      const intersection = { ...street, [axis]: alongStreet + alongOffset };
      const length = Math.abs(offset) + Math.abs(street[crossAxis] - turn[crossAxis]) + Math.abs(intersection[axis] - street[axis]);
      if (length <= BLOCK_SIZE * 2) candidates.push({ points: [point, turn, street, intersection], length, order: candidates.length });
    }
  }
  candidates.sort((left, right) => left.length - right.length || left.order - right.order);
  for (const candidate of candidates) if (clearGroundRoute(world, candidate.points)) return compactRoute(candidate.points);
  return null;
}

/** Road-grid travel with optional static player-footprint clearance; this is not a swept taxi-body test. */
export function groundRoute(start: Waypoint, end: Waypoint, world?: GroundWorld): Waypoint[] | null {
  if (!validGroundPoint(start) || !validGroundPoint(end)) return null;
  const departure = { ...start }, arrival = { ...end, y: start.y };
  if (world && (!world.canOccupy(departure.x, departure.z) || !world.canOccupy(arrival.x, arrival.z))) return null;
  const startStreet = nearestStreet(departure), endStreet = nearestStreet(arrival);
  const startIntersection = { x: Math.round(startStreet.x / BLOCK_SIZE) * BLOCK_SIZE, y: start.y, z: Math.round(startStreet.z / BLOCK_SIZE) * BLOCK_SIZE };
  const endIntersection = { x: Math.round(endStreet.x / BLOCK_SIZE) * BLOCK_SIZE, y: start.y, z: Math.round(endStreet.z / BLOCK_SIZE) * BLOCK_SIZE };
  const direct = compactRoute([departure, startStreet, startIntersection, { x: endIntersection.x, y: start.y, z: startIntersection.z }, endIntersection, endStreet, arrival]);
  if (!world || clearGroundRoute(world, direct)) return direct;
  const pickup = streetConnector(world, departure), dropoff = streetConnector(world, arrival);
  if (!pickup || !dropoff) return null;
  const first = pickup[pickup.length - 1], last = dropoff[dropoff.length - 1];
  for (const corner of [{ x: last.x, y: start.y, z: first.z }, { x: first.x, y: start.y, z: last.z }]) {
    const points = compactRoute([...pickup, corner, ...dropoff.slice().reverse()]);
    if (clearGroundRoute(world, points)) return points;
  }
  return null;
}

export function createJourney(mode: Exclude<RideMode, "metro">, player: Player, height: number, destination: number, world?: GroundWorld): Journey | null {
  if (!Number.isFinite(player.x) || !Number.isFinite(player.z) || !Number.isFinite(height)) return null;
  const stop = DISTRICTS[destination] ?? DISTRICTS[4];
  const start = { x: player.x, y: height, z: player.z };
  const end = { x: stop.x, y: WALK_HEIGHT, z: stop.z };
  let points: Waypoint[];
  if (mode === "sky") {
    // A vertical departure clears every tower before the cross-city flight.
    const altitude = 230;
    points = [start, { ...start, y: altitude }, { ...end, y: altitude }, end];
  } else {
    const route = groundRoute({ ...start, y: WALK_HEIGHT }, end, world);
    if (!route) return null;
    points = route;
  }
  const length = points.reduce((total, p, i) => i === 0 ? 0 : total + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y, p.z - points[i - 1].z), 0);
  return { mode, destination: stop.name, points, segment: 1, travelled: 0, length, speed: 0 };
}

/** Small route steps avoid skipping stations/turns even during a slow frame. */
export function advanceJourney(journey: Journey, position: Waypoint, dt: number): { done: boolean; heading: number | null; speed: number } {
  let remainingTime = clamp(dt, 0, 0.15);
  let heading: number | null = null;
  let speed = journey.mode === "taxi" ? 29 : 100;
  while (remainingTime > 0 && journey.segment < journey.points.length) {
    const target = journey.points[journey.segment];
    const dx = target.x - position.x, dy = target.y - position.y, dz = target.z - position.z;
    const distance = Math.hypot(dx, dy, dz);
    const vertical = Math.abs(dy) > Math.hypot(dx, dz);
    speed = vertical ? journey.mode === "sky" ? 26 : 10 : speed;
    // Slow down for corners/arrival. No abrupt snapping between route segments.
    const desired = Math.min(speed, Math.max(4, Math.sqrt(distance * 12)));
    journey.speed += (desired - journey.speed) * (1 - Math.exp(-3 * remainingTime));
    const step = Math.min(distance, Math.max(1, journey.speed) * remainingTime);
    if (distance > 0.0001) {
      position.x += dx / distance * step;
      position.y += dy / distance * step;
      position.z += dz / distance * step;
      if (Math.hypot(dx, dz) > 0.01) heading = Math.atan2(dx, -dz);
    }
    journey.travelled += step;
    remainingTime -= step / Math.max(1, journey.speed);
    if (distance < 0.0001 || step >= distance - 0.0001) journey.segment++;
    else break;
  }
  return { done: journey.segment >= journey.points.length, heading, speed: journey.speed };
}

/** Smoothstep of a 0..1 fraction, so a slide (door leaves, platform gates) starts and stops at rest.
 * Draw-time only: schedules keep their linear fractions and thresholds. */
export function easeSlide(fraction: number): number {
  const x = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Stepping out of an interior (effects on): the street comes up from near-dark over this long. */
export const DOOR_FADE_SECONDS = 0.4;
/** Street brightness for a door-fade progress 0..1: from 8% to full, eased at both ends, monotonic. */
export function doorReveal(progress: number): number {
  return 0.08 + 0.92 * easeSlide(progress);
}

const wrapAngle = (radians: number): number => Math.atan2(Math.sin(radians), Math.cos(radians));
/** Ride camera (taxi and sky taxi): the most it ever turns, in radians per second (75 deg/s). */
export const RIDE_TURN_RATE = 75 * Math.PI / 180;
/** How quickly the ride camera's turn rate builds and dies away (rad/s^2): ease-in and ease-out. */
export const RIDE_TURN_ACCEL = 2.4;
/** Metres before a corner over which the ride camera starts to look into the next street. */
export const RIDE_LOOK_AHEAD = 15;
export interface RideTurn { heading: number; rate: number; target: number }

/** Steer the ride camera toward `target` (null: keep the last target) with a capped, eased angular
 * speed: the rate ramps up and down at RIDE_TURN_ACCEL, never exceeds RIDE_TURN_RATE, and brakes so
 * it settles on the target without overshooting. Returns the yaw change for this step (radians), to
 * add on top of the viewer's own mouse-look offset. */
export function stepRideTurn(turn: RideTurn, target: number | null, dt: number): number {
  if (target !== null && Number.isFinite(target)) turn.target = target;
  const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
  if (step <= 0) return 0;
  const error = wrapAngle(turn.target - turn.heading);
  // The braking curve in discrete steps (lands on the target without overshoot at this dt), capped.
  const half = RIDE_TURN_ACCEL * step / 2;
  const desired = Math.sign(error) * Math.min(RIDE_TURN_RATE, Math.sqrt(half * half + 2 * RIDE_TURN_ACCEL * Math.abs(error)) - half);
  turn.rate = clamp(turn.rate + clamp(desired - turn.rate, -RIDE_TURN_ACCEL * step, RIDE_TURN_ACCEL * step), -RIDE_TURN_RATE, RIDE_TURN_RATE);
  let delta = turn.rate * step;
  // Arrive exactly: the last sliver is taken whole, and the rate winds down under the same
  // acceleration limit instead of dropping to zero in one step (no felt jolt at the end of a turn).
  if (delta * error > 0 && Math.abs(delta) >= Math.abs(error)) delta = error;
  else if (Math.abs(error) < 1e-6) delta = 0;
  if (delta === error || Math.abs(error) < 1e-6) turn.rate -= clamp(turn.rate, -RIDE_TURN_ACCEL * step, RIDE_TURN_ACCEL * step);
  turn.heading = wrapAngle(turn.heading + delta);
  return delta;
}

/** The heading a ride camera should face: along the current segment, blending into the next
 * horizontal segment over the last RIDE_LOOK_AHEAD metres, and toward the coming flight line for a
 * whole vertical climb. Null keeps the current heading (a final descent, a finished journey). */
export function journeyLookHeading(journey: Journey, position: Waypoint): number | null {
  const target = journey.points[journey.segment];
  if (!target) return null;
  const after = journey.points[journey.segment + 1];
  let next: number | null = null;
  if (after) {
    const nx = after.x - target.x, nz = after.z - target.z, flat = Math.hypot(nx, nz);
    if (flat > 0.01 && flat >= Math.abs(after.y - target.y)) next = Math.atan2(nx, -nz);
  }
  const dx = target.x - position.x, dy = target.y - position.y, dz = target.z - position.z, flat = Math.hypot(dx, dz);
  if (flat <= 0.01 || Math.abs(dy) > flat) return next;
  const current = Math.atan2(dx, -dz);
  if (next === null) return current;
  const remaining = Math.hypot(dx, dy, dz);
  if (remaining >= RIDE_LOOK_AHEAD) return current;
  return wrapAngle(current + wrapAngle(next - current) * easeSlide(1 - remaining / RIDE_LOOK_AHEAD));
}

export function safeLanding(world: CityWorld, x: number, z: number): { x: number; z: number } {
  x = clamp(x, -WORLD_EDGE + 5, WORLD_EDGE - 5);
  z = clamp(z, -WORLD_EDGE + 5, WORLD_EDGE - 5);
  if (world.canOccupy(x, z)) return { x, z };
  const sx = clamp(Math.round(x / 64) * 64, -WORLD_EDGE + 64, WORLD_EDGE - 64);
  const sz = clamp(Math.round(z / 64) * 64, -WORLD_EDGE + 64, WORLD_EDGE - 64);
  if (world.canOccupy(sx, z)) return { x: sx, z };
  if (world.canOccupy(x, sz)) return { x, z: sz };
  return { x: sx, z: sz };
}

