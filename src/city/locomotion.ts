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

/** Route along the connected road grid, including the initial approach to an intersection. */
export function groundRoute(start: Waypoint, end: Waypoint): Waypoint[] {
  const a = nearestStreet(start);
  const b = nearestStreet(end);
  const ai = { x: Math.round(a.x / 64) * 64, y: start.y, z: Math.round(a.z / 64) * 64 };
  const bi = { x: Math.round(b.x / 64) * 64, y: start.y, z: Math.round(b.z / 64) * 64 };
  return [start, a, ai, { x: bi.x, y: start.y, z: ai.z }, bi, b, { ...end, y: start.y }].filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.z - all[i - 1].z) > 0.01);
}

export function createJourney(mode: Exclude<RideMode, "metro">, player: Player, height: number, destination: number): Journey {
  const stop = DISTRICTS[destination] ?? DISTRICTS[4];
  const start = { x: player.x, y: height, z: player.z };
  const end = { x: stop.x, y: WALK_HEIGHT, z: stop.z };
  let points: Waypoint[];
  if (mode === "sky") {
    // A vertical departure clears every tower before the cross-city flight.
    const altitude = 230;
    points = [start, { ...start, y: altitude }, { ...end, y: altitude }, end];
  } else points = groundRoute({ ...start, y: WALK_HEIGHT }, end);
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

