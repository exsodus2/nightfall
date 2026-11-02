import { BLOCK_SIZE, HALF_BLOCKS, RAIL_SOLIDS, WORLD_EDGE, blockKey, randomFor, type CityWorld } from "./world.ts";
import { STATIONS, localToWorld } from "./metro.ts";
import { safeLanding } from "./locomotion.ts";
import { inPark } from "./park.ts";
import { easeViewBlend, stepViewBlend, type DriveView } from "./drive-view.ts";

/** Pure vehicle model, parked-car placement and driving camera. No DOM, no textmode:
 * the engine feeds input and dt, reads back a camera pose. Yaw follows the rest of the
 * city: forward = (sin yaw, -cos yaw), right = (cos yaw, sin yaw). */
export interface CarPose { x: number; z: number; yaw: number }
export interface ParkedCar extends CarPose { id: number; /** Left here by the player (traffic treats it as a blocker). */ moved: boolean }
/** `slip`: body yaw minus the direction of travel (radians; the rear stepping out under the
 * handbrake). `kerb`: the centre was over the pavement last step (kerb bumps). */
export interface DriveCar extends CarPose { id: number; speed: number; steer: number; yawRate: number; accel: number; scraping: boolean; slip?: number; kerb?: boolean }
/** `rain`: weather.ts rain intensity 0..1 for this step (default: the last setRoadWetness value). */
export interface DriveInput { throttle: number; steer: number; handbrake: boolean; boost: boolean; rain?: number }
/** Oriented rectangle other than a building: cars, rail pillars, station columns. */
export interface Obstacle { x: number; z: number; yaw: number; halfLength: number; halfWidth: number }
export interface StepResult { impact: number; moved: number }

// Matches drawCar in activity.ts: a 2.7 m x 5.8 m body.
export const CAR_HALF_LENGTH = 2.9;
export const CAR_HALF_WIDTH = 1.35;
// Matches drawCar's proportions (sill 1.43 m, roof 2.1 m): the eye sits in the window, not below it.
export const DRIVER_EYE_HEIGHT = 1.65;
const WHEELBASE = 2.7;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Road surface: weather.ts rain intensity (0.2 drizzle .. 1 downpour), set each frame from the
 * scene (activity.ts drawActivity) and read by stepCar unless the input carries its own. */
let roadRain = 0;
export function setRoadWetness(rain: number): void { roadRain = Number.isFinite(rain) ? clamp(rain, 0, 1) : 0; }
/** 0 dry .. 1 standing water: drizzle barely counts, a downpour fully. */
export function roadWetness(rain: number): number {
  const u = clamp((rain - 0.3) / 0.65, 0, 1);
  return u * u * (3 - 2 * u);
}
/** Lateral grip and braking left on a wet road: gentle (no spin-outs), at most -18 % and -25 %. */
export const wetGrip = (wetness: number): number => 1 - 0.18 * clamp(wetness, 0, 1);
export const wetBraking = (wetness: number): number => 1 - 0.25 * clamp(wetness, 0, 1);
/** Largest slide angle the handbrake allows (radians, about 20 degrees). */
export const MAX_SLIP = 0.35;
export const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Distance to the nearest carriageway centre line, as the road shader measures it (the
 * central avenue is twice as wide). Road < 6.2, kerb 6.2-6.6, pavement beyond. */
const lineDistance = (v: number): number => { const m = ((v % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE; return Math.min(m, BLOCK_SIZE - m); };
export function roadDistance(x: number, z: number): number {
  return Math.min(Math.abs(x) < 32 ? Math.abs(x) * 0.5 : lineDistance(x), lineDistance(z));
}

/** Separating-axis overlap of two oriented rectangles. */
function rectanglesOverlap(a: Obstacle, b: Obstacle): boolean {
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const yaw of [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2]) {
    const ax = Math.sin(yaw), az = -Math.cos(yaw);
    const project = (r: Obstacle) => {
      const fx = Math.sin(r.yaw), fz = -Math.cos(r.yaw);
      return Math.abs(fx * ax + fz * az) * r.halfLength + Math.abs(fz * ax - fx * az) * r.halfWidth;
    };
    if (Math.abs(dx * ax + dz * az) > project(a) + project(b)) return false;
  }
  return true;
}
/** Another car as an obstacle: a touch inside the drawn body (rounded corners), so pulling
 * out of a kerbside space takes a little steering, not a ten-point turn. */
export const carObstacle = (pose: CarPose): Obstacle => ({ x: pose.x, z: pose.z, yaw: pose.yaw, halfLength: CAR_HALF_LENGTH - 0.2, halfWidth: CAR_HALF_WIDTH - 0.1 });
const carShape = (pose: CarPose): Obstacle => ({ x: pose.x, z: pose.z, yaw: pose.yaw, halfLength: CAR_HALF_LENGTH, halfWidth: CAR_HALF_WIDTH });

/** Exact footprint test against every building near the car. */
export function overlapsBuilding(world: CityWorld, pose: CarPose): boolean {
  const car = carShape(pose), reach = CAR_HALF_LENGTH + 0.5;
  const x0 = Math.floor((pose.x - reach) / BLOCK_SIZE), x1 = Math.floor((pose.x + reach) / BLOCK_SIZE);
  const z0 = Math.floor((pose.z - reach) / BLOCK_SIZE), z1 = Math.floor((pose.z + reach) / BLOCK_SIZE);
  for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
    const block = world.blocks.get(blockKey(bx, bz));
    if (!block) continue;
    for (const b of block.buildings) if (rectanglesOverlap(car, { x: b.x, z: b.z, yaw: 0, halfLength: b.depth / 2, halfWidth: b.width / 2 })) return true;
  }
  return false;
}

// Rail viaduct legs and station street columns (world.ts RAIL_SOLIDS: all on pavements or in
// plazas, never in a carriageway) and the station lift shafts. The walking collision samples
// only the car's body; the exact rectangles here close the gaps.
export const STATIC_OBSTACLES: readonly Obstacle[] = [
  ...RAIL_SOLIDS.map(solid => ({ x: solid.x, z: solid.z, yaw: 0, halfLength: solid.half, halfWidth: solid.half })),
  ...STATIONS.map(station => ({ ...localToWorld(station, 9, 20), yaw: station.yaw, halfLength: 1.8, halfWidth: 1.8 })),
];

/** Buildings, landmarks, world edge and static street furniture. The walking collision
 * (with its 0.8 m margin) samples the body; the exact rectangle test closes the gaps. */
export function carFits(world: CityWorld, pose: CarPose, obstacles: readonly Obstacle[] = []): boolean {
  if (Math.abs(pose.x) > WORLD_EDGE - 4 || Math.abs(pose.z) > WORLD_EDGE - 4) return false;
  const fx = Math.sin(pose.yaw), fz = -Math.cos(pose.yaw);
  for (const along of [-2.1, -1.05, 0, 1.05, 2.1]) for (const side of [-0.55, 0.55]) {
    if (!world.canOccupy(pose.x + fx * along - fz * side, pose.z + fz * along + fx * side)) return false;
  }
  if (overlapsBuilding(world, pose)) return false;
  const car = carShape(pose);
  for (const list of [STATIC_OBSTACLES, obstacles]) for (const o of list) {
    if (Math.abs(o.x - pose.x) < 8 && Math.abs(o.z - pose.z) < 8 && rectanglesOverlap(car, o)) return false;
  }
  return true;
}

/** Arcade-but-grounded car. Fixed small substeps keep acceleration, steering and
 * collisions independent of the frame rate; a slow frame never tunnels into a wall. */
export function stepCar(world: CityWorld, car: DriveCar, input: DriveInput, dt: number, obstacles: readonly Obstacle[] = []): StepResult {
  dt = clamp(dt, 0, 0.15);
  const steps = Math.max(1, Math.ceil(dt * 120), Math.ceil(Math.abs(car.speed) * dt / 0.25));
  const h = dt / steps;
  const throttle = clamp(input.throttle, -1, 1), steerInput = clamp(input.steer, -1, 1);
  // Wet roads: a little less lateral grip (mild understeer) and longer braking, never a spin.
  const wetness = roadWetness(input.rain ?? roadRain), grip0 = wetGrip(wetness), brakes = wetBraking(wetness);
  // Other cars that already overlap (traffic that moved into us) never trap the car.
  const blocking = obstacles.filter(o => !rectanglesOverlap(carShape(car), o));
  const stuck = !carFits(world, car, blocking);
  let impact = 0, moved = 0, touching = false, slip = Number.isFinite(car.slip) ? car.slip ?? 0 : 0;
  for (let i = 0; i < steps; i++) {
    const v = car.speed, top = input.boost ? 38 : 25;
    let a: number, braking = false;
    if (throttle > 0 && v >= -0.3) a = (input.boost ? 13 : 8.5) * throttle * (1 - Math.min(1.4, (Math.max(0, v) / top) ** 2));
    else if (throttle < 0 && v <= 0.3) a = 5.5 * throttle * (1 - Math.min(1, (Math.min(0, v) / -8) ** 2));
    else if (throttle !== 0) { a = -Math.sign(v) * 15 * brakes * Math.abs(throttle); braking = true; }
    // Off the throttle: engine braking, growing with road speed.
    else { a = -Math.sign(v) * Math.min(1.1, 0.055 * Math.abs(v)); braking = true; }
    // Rolling resistance and aero drag; the handbrake locks the rear wheels; a sideways slide scrubs speed.
    a -= Math.sign(v) * (0.9 + 0.0035 * v * v + (input.handbrake ? 10 * brakes : 0) + 6 * Math.abs(Math.sin(slip)));
    if (input.handbrake) braking = true;
    let next = v + a * h;
    if (braking && Math.sign(next) !== Math.sign(v) && v !== 0) next = 0;
    car.accel = (next - v) / Math.max(h, 1e-6);
    car.speed = next;

    // Steering eases in (more slowly at speed) and self-centres; lock narrows with speed and
    // lateral grip caps the turn rate.
    const speed = Math.abs(car.speed);
    const rate = steerInput === 0 ? 4.5 : (Math.sign(steerInput) !== Math.sign(car.steer) ? 6 : 3.2) / (1 + speed / 40);
    car.steer += clamp(steerInput - car.steer, -rate * h, rate * h);
    const angle = car.steer * 0.6 / (1 + speed / 9) * (input.handbrake ? 1.3 : 1);
    const grip = (input.handbrake ? 22 : 14) * grip0 / Math.max(speed, 0.5);
    car.yawRate = clamp(car.speed * Math.tan(angle) / WHEELBASE, -grip, grip);

    // The body turns at yawRate; the direction of travel follows it, lagging under the handbrake
    // at speed (the rear steps out a little, eased in and out, capped at MAX_SLIP).
    const follow = input.handbrake && speed > 5 ? 2.5 : 16;
    slip = clamp((slip + car.yawRate * h) * Math.exp(-follow * h), -MAX_SLIP, MAX_SLIP);
    const yaw = car.yaw + car.yawRate * h, course = yaw - slip;
    const dx = Math.sin(course) * car.speed * h, dz = -Math.cos(course) * car.speed * h;
    const intended = Math.hypot(dx, dz);
    if (intended < 1e-9 && Math.abs(yaw - car.yaw) < 1e-12) continue;
    // Full move, then axis slides (all building walls are axis-aligned), then without the turn.
    const tries: CarPose[] = [{ x: car.x + dx, z: car.z + dz, yaw }, { x: car.x + dx, z: car.z, yaw }, { x: car.x, z: car.z + dz, yaw },
      { x: car.x + dx, z: car.z + dz, yaw: car.yaw }, { x: car.x + dx, z: car.z, yaw: car.yaw }, { x: car.x, z: car.z + dz, yaw: car.yaw }];
    const accepted = stuck ? tries[0] : tries.find(pose => carFits(world, pose, blocking));
    if (!accepted) {
      // Head-on: a small bounce, never a position inside the obstacle.
      impact = Math.max(impact, Math.abs(car.speed));
      car.speed *= -0.18;
      slip *= 0.5;
      touching = true;
      continue;
    }
    const travelled = Math.hypot(accepted.x - car.x, accepted.z - car.z);
    if (accepted !== tries[0] && intended > 1e-9) {
      const fraction = travelled / intended;
      // The first touch costs speed in proportion to how square-on it is; scraping keeps bleeding it.
      if (!car.scraping && !touching) { impact = Math.max(impact, Math.abs(car.speed) * (1 - fraction)); car.speed *= 0.55 + 0.45 * fraction; }
      car.speed *= Math.pow(Math.max(fraction, 0.05), h * 3);
      touching = true;
    }
    car.x = accepted.x; car.z = accepted.z; car.yaw = accepted.yaw;
    moved += travelled;
  }
  car.scraping = touching;
  car.slip = slip;
  // Kerb bumps: mounting or leaving the pavement nudges the speed down a little (no camera
  // effect, comfort), once per crossing.
  const kerb = roadDistance(car.x, car.z) > 6.4;
  if (car.kerb !== undefined && kerb !== car.kerb && Math.abs(car.speed) > 1) car.speed -= Math.sign(car.speed) * Math.min(1.2, Math.abs(car.speed) * KERB_BUMP);
  car.kerb = kerb;
  return { impact, moved };
}
/** Share of the speed a kerb crossing costs (at most 1.2 m/s). */
export const KERB_BUMP = 0.06;

/** Bus routes (traffic.ts): both directions of these streets carry buses, which pull in at a lit
 * shelter every other block. Kept clear of the park, the avenue and the station concourses. */
export const BUS_STREETS: readonly { axis: "x" | "z"; street: number }[] = [{ axis: "x", street: -3 }, { axis: "x", street: 2 }, { axis: "z", street: -5 }, { axis: "z", street: 5 }];
/** A bus berth: `along` is the bus's front-segment centre when it has pulled in; `x, z` the shelter
 * on the pavement beside its doors, `yaw` the bus heading. `side` is the kerb (sign across the street). */
export interface BusStop { axis: "x" | "z"; street: number; direction: number; block: number; along: number; side: number; x: number; z: number; yaw: number }
/** Berths repeat every other block, 6 m past mid-block, so the 11.6 m bus is clear of both corners. */
export const busBerth = (block: number, direction: number): number => block * BLOCK_SIZE + 32 + direction * 6;
export const BUS_STOPS: readonly BusStop[] = BUS_STREETS.flatMap(({ axis, street }) => [-1, 1].flatMap(direction => {
  const side = axis === "x" ? -direction : direction, stops: BusStop[] = [];
  for (let block = -10; block <= 10; block += 2) {
    const along = busBerth(block, direction), mid = block * BLOCK_SIZE + 32;
    const lateral = street * BLOCK_SIZE + side * 8.4;
    const x = axis === "x" ? mid : lateral, z = axis === "x" ? lateral : mid;
    if (STATIONS.some(s => Math.abs(x - s.x) < 52 && Math.abs(z - s.z) < 52)) continue;
    // Not inside the avenue's stop line (traffic.ts AVENUE_STOP_LINE, 29.5 m): a bus pulling away
    // from there was already past it and crossed the avenue (and its tram rails) on red.
    if (axis === "x" && Math.abs(along) < 32) continue;
    stops.push({ axis, street, direction, block, along, side, x, z, yaw: axis === "x" ? direction * Math.PI / 2 : direction < 0 ? 0 : Math.PI });
  }
  return stops;
}));
const busStopKey = (axis: "x" | "z", street: number, direction: number, block: number): number => ((axis === "x" ? 1 : 2) * 64 + street + 32) * 4096 + (direction + 1) * 1024 + block + 512;
const BUS_STOP_KEYS = new Set(BUS_STOPS.map(s => busStopKey(s.axis, s.street, s.direction, s.block)));
export const hasBusStop = (axis: "x" | "z", street: number, direction: number, block: number): boolean => BUS_STOP_KEYS.has(busStopKey(axis, street, direction, block));
/** Abandoned wrecks on the city's outer streets (traffic.ts reports them as solid, undrivable
 * vehicles). Half up on the kerb and a little askew, clear of the passing lane. */
export const WRECK_SPOTS: readonly CarPose[] = ([["x", 11, 1, -6], ["x", -11, -1, 3], ["z", 11, 1, -2], ["z", -11, -1, 5], ["x", 10, -1, 7], ["z", -10, 1, -8], ["x", -10, 1, -4]] as const).map(([axis, street, side, block], i) => {
  const along = block * BLOCK_SIZE + 32, lateral = street * BLOCK_SIZE + side * 6.3, skew = (i % 2 ? 1 : -1) * 0.09;
  return axis === "z" ? { x: lateral, z: along, yaw: (side < 0 ? 0 : Math.PI) + skew } : { x: along, z: lateral, yaw: -side * Math.PI / 2 + skew };
});

/** A taxi rank on the avenue's east kerb beside the Spire plaza (world.ts LANDMARKS "spire",
 * block z -192..-128): four cabs nose to tail, heading south; `x, z` is the rank sign at its head. */
export const TAXI_RANK = { axis: "z", street: 0, side: 1, block: -3, x: 13.2, z: -143 } as const;
/** Rank cabs: parked ids never use a multiple of 5 (tint 1-4), and carKind reads id % 5 === 0 as
 * a cab unless id % 31 === 7 (police): these clear both. */
export const taxiRankId = (slot: number): number => {
  let id = 45000 + slot * 5;
  while (id % 31 === 7) id += 20;
  return id;
};
/** Parked cars along the kerbs of every block: deterministic, a handful per block.
 * They never sit in a crossing, an intersection, a station concourse or a building,
 * and the driver can always step out onto the pavement. */
export class ParkedCars {
  private readonly byBlock = new Map<string, ParkedCar[]>();
  constructor(world: CityWorld) {
    let serial = 0;
    for (let bz = -HALF_BLOCKS; bz < HALF_BLOCKS; bz++) for (let bx = -HALF_BLOCKS; bx < HALF_BLOCKS; bx++) {
      for (const axis of ["z", "x"] as const) {
        const street = axis === "z" ? bx : bz;
        if (Math.abs(street) > HALF_BLOCKS - 1) continue;
        // Four spaces per kerb, 8.5 m apart: room to pull out between neighbours.
        for (const side of [-1, 1]) for (let slot = 0; slot < 4; slot++) {
          // The taxi rank in front of the Spire plaza: all four spaces, always cabs.
          const rank = axis === TAXI_RANK.axis && street === TAXI_RANK.street && side === TAXI_RANK.side && bz === TAXI_RANK.block;
          if (!rank && randomFor(bx * 5 + slot, bz * 3 + side, axis === "z" ? 811 : 823) > 0.2) continue;
          const along = (axis === "z" ? bz : bx) * BLOCK_SIZE + 18.5 + slot * 8.5;
          const lateral = street * BLOCK_SIZE + side * (axis === "z" && street === 0 ? 10.4 : 5.8);
          // Cross streets meet the double-width avenue with crossings out to |x| = 26.
          if (axis === "x" && Math.abs(along) < 31) continue;
          const pose = axis === "z" ? { x: lateral, z: along, yaw: side < 0 ? 0 : Math.PI } : { x: along, z: lateral, yaw: -side * Math.PI / 2 };
          if (STATIONS.some(s => Math.abs(pose.x - s.x) < 40 && Math.abs(pose.z - s.z) < 40)) continue;
          // Bus berths and wrecks keep their stretch of kerb.
          if (BUS_STOPS.some(s => s.axis === axis && s.street === street && s.side === side && Math.abs(along - (s.block * BLOCK_SIZE + 32)) < 18)) continue;
          if (WRECK_SPOTS.some(w => Math.abs(w.x - pose.x) < 9 && Math.abs(w.z - pose.z) < 9)) continue;
          // Rootwood Park's streets are promenades (its boundary streets keep their kerbside cars).
          if (inPark(pose.x, pose.z)) continue;
          // Only where the pavement is wide enough for the driver to step out beside the car.
          if (!carFits(world, pose)) continue;
          const exit = exitSpot(world, pose);
          if (roadDistance(exit.x, exit.z) < 6.6) continue;
          if (rank) { this.add({ ...pose, id: taxiRankId(slot), moved: false }); continue; }
          const tint = Math.floor(randomFor(serial, 5, 829) * 4) + 1;
          this.add({ ...pose, id: 20000 + serial++ * 5 + tint, moved: false });
        }
      }
    }
  }
  private add(car: ParkedCar): void {
    const key = blockKey(Math.floor(car.x / BLOCK_SIZE), Math.floor(car.z / BLOCK_SIZE));
    const list = this.byBlock.get(key);
    if (list) list.push(car); else this.byBlock.set(key, [car]);
  }
  all(): ParkedCar[] { return [...this.byBlock.values()].flat(); }
  nearby(x: number, z: number, range: number): ParkedCar[] {
    const out: ParkedCar[] = [], r = Math.ceil(range / BLOCK_SIZE);
    const cx = Math.floor(x / BLOCK_SIZE), cz = Math.floor(z / BLOCK_SIZE);
    for (let bz = cz - r; bz <= cz + r; bz++) for (let bx = cx - r; bx <= cx + r; bx++) {
      for (const car of this.byBlock.get(blockKey(bx, bz)) ?? []) if ((car.x - x) ** 2 + (car.z - z) ** 2 < range * range) out.push(car);
    }
    return out;
  }
  /** Remove a car the player is getting into. */
  take(car: ParkedCar): void {
    for (const list of this.byBlock.values()) { const i = list.indexOf(car); if (i >= 0) { list.splice(i, 1); return; } }
  }
  /** A car the player leaves stays exactly where it stopped. */
  park(car: CarPose & { id: number }): ParkedCar {
    const parked = { x: car.x, z: car.z, yaw: car.yaw, id: car.id, moved: true };
    this.add(parked);
    return parked;
  }
}

/** Distance from a point to a car's body (0 inside). */
export function distanceToCar(car: CarPose, x: number, z: number): number {
  const dx = x - car.x, dz = z - car.z;
  const along = dx * Math.sin(car.yaw) - dz * Math.cos(car.yaw), side = dx * Math.cos(car.yaw) + dz * Math.sin(car.yaw);
  return Math.hypot(Math.max(0, Math.abs(along) - CAR_HALF_LENGTH), Math.max(0, Math.abs(side) - CAR_HALF_WIDTH));
}

/** Where the driver steps out: beside a door, on the pavement when the kerb is there. */
export function exitSpot(world: CityWorld, car: CarPose): { x: number; z: number } {
  const fx = Math.sin(car.yaw), fz = -Math.cos(car.yaw);
  const candidates: { x: number; z: number; score: number }[] = [];
  // Pavements can be narrow: step a little further out if the first spot meets a facade.
  const spots: [number, number, number][] = [[0, -4.3, -0.5], [0, 4.3, -0.5]];
  for (const reach of [2.3, 3.1, 3.9]) for (const along of [-0.2, 1.6]) spots.push([reach, along, 0.3 - reach * 0.05], [-reach, along, 0.2 - reach * 0.05]);
  for (const [side, along, preference] of spots) {
    const x = car.x + fx * along - fz * side, z = car.z + fz * along + fx * side;
    if (!world.canOccupy(x, z)) continue;
    const road = roadDistance(x, z);
    candidates.push({ x, z, score: (road >= 6.6 ? 10 : 0) + road * 0.1 + preference });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? safeLanding(world, car.x, car.z);
}

/** Minimal view of MouseLook the camera needs (see locomotion.ts). */
export interface LookState { yaw: number; pitch: number; targetYaw: number; targetPitch: number }
export interface DriveCamera { x: number; z: number; height: number; yaw: number; pitch: number; fovKick: number }

// Chase camera: far and high enough that the whole car sits in the lower middle of the screen
// with the road ahead above it; the view aims past the car, not at its roof.
const CHASE_DISTANCE = 9.5;
const CHASE_HEIGHT = 3.6;
const CHASE_AIM_HEIGHT = 0.9;
const CHASE_AIM_AHEAD = 3.5;
/** The exterior body replaces the cockpit once the camera is this far outside the car's box
 * (roof 2.1 m, see drawCar), so the near plane never cuts into it. */
const EXTERIOR_MARGIN = 0.35;
const CAR_ROOF = 2.1;

/** A driving session: the car plus a calm cockpit / chase camera. Mouse look keeps
 * working; after a short idle the view eases back toward the heading, leading into turns.
 * `chase` is the chosen view; the camera eases between the two over DRIVE_VIEW_TRANSITION. */
export class DriveSession {
  readonly car: DriveCar;
  chase: boolean;
  /** Kept for the engine's projection; always 0 (comfort: no FOV pumping with speed or boost). */
  readonly fovKick = 0;
  private idle = 10;
  private expectYaw = NaN;
  private expectPitch = NaN;
  private lookAhead = 0;
  private chaseDistance = CHASE_DISTANCE;
  private progress: number;
  private outside: boolean;
  constructor(car: CarPose & { id: number }, look: LookState, chase = false) {
    // Unwrap the car heading next to the current view so nothing spins on entry.
    const yaw = look.yaw + angleDelta(look.yaw, car.yaw);
    this.car = { x: car.x, z: car.z, yaw, id: car.id, speed: 0, steer: 0, yawRate: 0, accel: 0, scraping: false };
    // The remembered view applies at once when getting in: no transition on entry.
    this.chase = chase; this.progress = chase ? 1 : 0; this.outside = chase;
  }
  /** Switches cockpit <-> chase (eased); returns the newly chosen view. */
  toggleView(): DriveView { this.chase = !this.chase; return this.chase ? "chase" : "cockpit"; }
  /** Eased camera position between the views: 0 cockpit, 1 chase. */
  get blend(): number { return easeViewBlend(this.progress); }
  /** True once the camera is outside the car: draw the whole body instead of the cockpit. */
  get exterior(): boolean { return this.outside; }
  update(world: CityWorld, input: DriveInput, dt: number, look: LookState, obstacles: readonly Obstacle[] = []): DriveCamera & StepResult {
    dt = clamp(dt, 0, 0.15);
    if (Math.abs(look.targetYaw - this.expectYaw) > 1e-7 || Math.abs(look.targetPitch - this.expectPitch) > 1e-7) this.idle = 0;
    else this.idle += dt;
    const before = this.car.yaw;
    const result = stepCar(world, this.car, input, dt, obstacles);
    const turn = this.car.yaw - before;
    look.yaw += turn; look.targetYaw += turn;
    this.progress = stepViewBlend(this.progress, this.chase, dt);
    const blend = easeViewBlend(this.progress);
    const speed = Math.abs(this.car.speed), pace = Math.min(1, speed / 25);
    const smooth = (rate: number) => 1 - Math.exp(-rate * dt);
    this.lookAhead += (clamp(this.car.yawRate * 0.3, -0.28, 0.28) - this.lookAhead) * smooth(2.5);
    if (this.idle > 0.9) {
      const ease = smooth(1.5 * Math.min(1, (this.idle - 0.9) / 0.8));
      look.targetYaw += angleDelta(look.targetYaw, this.car.yaw + this.lookAhead) * ease;
      look.targetPitch += (0.05 - 0.03 * blend - look.targetPitch) * ease;
    }
    this.expectYaw = look.targetYaw; this.expectPitch = look.targetPitch;
    // Comfort (a tester got dizzy): the camera is rigidly attached to the car. No road shake, no
    // impact bump, no pitch lean under braking or power, no FOV change with speed or boost.
    const yaw = look.yaw, fx = Math.sin(this.car.yaw), fz = -Math.cos(this.car.yaw);
    // Right-hand drive (traffic keeps left): the seat sits right of centre, just behind the middle.
    const seatX = this.car.x + fz * -0.45 - fx * 0.15, seatZ = this.car.z + fx * 0.45 - fz * 0.15;
    // Chase camera orbits with the view yaw and pulls in rather than entering a building (tracked
    // in both views, so a switch starts from a safe distance).
    const want = CHASE_DISTANCE + pace, bx = -Math.sin(yaw), bz = Math.cos(yaw);
    let free = 0;
    for (let distance = 0; distance <= want; distance += 0.5) { if (!world.canOccupy(this.car.x + bx * distance, this.car.z + bz * distance)) break; free = distance; }
    this.chaseDistance = free < this.chaseDistance ? free : this.chaseDistance + (free - this.chaseDistance) * smooth(2.5);
    const chaseX = this.car.x + bx * this.chaseDistance, chaseZ = this.car.z + bz * this.chaseDistance;
    const chaseTilt = Math.atan2(CHASE_HEIGHT - CHASE_AIM_HEIGHT, this.chaseDistance + CHASE_AIM_AHEAD);
    // The switch is a straight, eased move between the two poses (both collision-safe; the line
    // between them stays over the car and the free chase ray).
    const x = seatX + (chaseX - seatX) * blend, z = seatZ + (chaseZ - seatZ) * blend;
    const height = DRIVER_EYE_HEIGHT + (CHASE_HEIGHT - DRIVER_EYE_HEIGHT) * blend;
    const along = (x - this.car.x) * fx + (z - this.car.z) * fz, side = (x - this.car.x) * -fz + (z - this.car.z) * fx;
    this.outside = height > CAR_ROOF + EXTERIOR_MARGIN || Math.abs(along) > CAR_HALF_LENGTH + EXTERIOR_MARGIN || Math.abs(side) > CAR_HALF_WIDTH + EXTERIOR_MARGIN;
    return { ...result, x, z, height, yaw, pitch: look.pitch + chaseTilt * blend, fovKick: 0 };
  }
}
