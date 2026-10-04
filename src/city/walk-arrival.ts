import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, type CarPose } from "./driving.ts";
import { PLAYER_RADIUS, type CityWorld } from "./world.ts";

export interface WalkArrivalPoint { x: number; z: number }

export const WALK_ARRIVAL_RADIUS = 4;
export const WALK_ARRIVAL_MAX_CARS = 64;
const HALF_LENGTH = CAR_HALF_LENGTH + PLAYER_RADIUS;
const HALF_WIDTH = CAR_HALF_WIDTH + PLAYER_RADIUS;
const CAR_REACH = Math.hypot(HALF_LENGTH, HALF_WIDTH);
export const WALK_ARRIVAL_QUERY_RADIUS = WALK_ARRIVAL_RADIUS + CAR_REACH + 0.01;
const EPSILON = 1e-8;
const STRIDE = 4;
const POSITION_ROUNDING_MARGIN = 0.02;
const SEARCH_OFFSETS: readonly WalkArrivalPoint[] = Array.from({ length: 128 }, (_, index) => {
  const radius = Math.min((Math.floor(index / 16) + 1) * 0.5, WALK_ARRIVAL_RADIUS - POSITION_ROUNDING_MARGIN);
  const angle = index % 16 * Math.PI / 8;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
});

interface PreparedCars { poses: Float64Array; count: number }

function validPoint(point: WalkArrivalPoint): boolean {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.z);
}

function prepareCars(anchor: WalkArrivalPoint, cars: readonly CarPose[], radius: number): PreparedCars | null {
  if (!Array.isArray(cars)) return null;
  const poses = new Float64Array(WALK_ARRIVAL_MAX_CARS * STRIDE);
  let count = 0;
  for (const car of cars) {
    if (!car || typeof car !== "object" || !Number.isFinite(car.x) || !Number.isFinite(car.z) || !Number.isFinite(car.yaw)) continue;
    if (Math.hypot(car.x - anchor.x, car.z - anchor.z) > radius + CAR_REACH) continue;
    const sine = Math.sin(car.yaw), cosine = Math.cos(car.yaw);
    let duplicate = false;
    for (let index = 0; index < count; index++) {
      const offset = index * STRIDE;
      if (poses[offset] === car.x && poses[offset + 1] === car.z && Math.abs(sine * poses[offset + 3] - cosine * poses[offset + 2]) < EPSILON) { duplicate = true; break; }
    }
    if (duplicate) continue;
    if (count === WALK_ARRIVAL_MAX_CARS) return null;
    const offset = count++ * STRIDE;
    poses[offset] = car.x; poses[offset + 1] = car.z; poses[offset + 2] = sine; poses[offset + 3] = cosine;
  }
  return { poses, count };
}

function clearPoint(world: Pick<CityWorld, "canOccupy">, x: number, z: number, cars: PreparedCars): boolean {
  if (!world.canOccupy(x, z)) return false;
  for (let index = 0; index < cars.count; index++) {
    const offset = index * STRIDE, relativeX = x - cars.poses[offset], relativeZ = z - cars.poses[offset + 1];
    const side = relativeX * cars.poses[offset + 3] + relativeZ * cars.poses[offset + 2];
    const along = relativeX * cars.poses[offset + 2] - relativeZ * cars.poses[offset + 3];
    if (Math.abs(side) < HALF_WIDTH - EPSILON && Math.abs(along) < HALF_LENGTH - EPSILON) return false;
  }
  return true;
}

export function canStandAtArrival(world: Pick<CityWorld, "canOccupy">, point: WalkArrivalPoint, cars: readonly CarPose[] = []): boolean {
  if (!validPoint(point)) return false;
  const prepared = prepareCars(point, cars, 0);
  return prepared !== null && clearPoint(world, point.x, point.z, prepared);
}

export function findWalkArrival(world: Pick<CityWorld, "canOccupy">, anchor: WalkArrivalPoint, cars: readonly CarPose[] = []): WalkArrivalPoint | null {
  if (!validPoint(anchor)) return null;
  const prepared = prepareCars(anchor, cars, WALK_ARRIVAL_RADIUS);
  if (!prepared) return null;
  if (clearPoint(world, anchor.x, anchor.z, prepared)) return { x: anchor.x, z: anchor.z };
  for (const offset of SEARCH_OFFSETS) {
    const x = anchor.x + offset.x, z = anchor.z + offset.z;
    if (clearPoint(world, x, z, prepared)) return { x, z };
  }
  return null;
}
