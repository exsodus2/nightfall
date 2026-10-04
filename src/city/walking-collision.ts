import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, type CarPose } from "./driving.ts";
import { PLAYER_RADIUS, type CityWorld, type Player } from "./world.ts";

export const MAX_WALKING_CARS = 24;
export const WALKING_CAR_QUERY_RADIUS = 18;
export const WALKING_CAR_ROOF_CLEARANCE = 2.2;
const HALF_WIDTH = CAR_HALF_WIDTH + PLAYER_RADIUS;
const HALF_LENGTH = CAR_HALF_LENGTH + PLAYER_RADIUS;
const REACH = Math.hypot(HALF_WIDTH, HALF_LENGTH);
const EPSILON = 1e-8;
const STRIDE = 6;

function crossesCar(side: number, along: number, sideStep: number, alongStep: number): boolean {
  let entry = 0, exit = 1;
  if (Math.abs(sideStep) < EPSILON) {
    if (Math.abs(side) >= HALF_WIDTH - EPSILON) return false;
  } else {
    const first = (-HALF_WIDTH - side) / sideStep, second = (HALF_WIDTH - side) / sideStep;
    entry = Math.max(entry, Math.min(first, second)); exit = Math.min(exit, Math.max(first, second));
  }
  if (Math.abs(alongStep) < EPSILON) {
    if (Math.abs(along) >= HALF_LENGTH - EPSILON) return false;
  } else {
    const first = (-HALF_LENGTH - along) / alongStep, second = (HALF_LENGTH - along) / alongStep;
    entry = Math.max(entry, Math.min(first, second)); exit = Math.min(exit, Math.max(first, second));
  }
  return entry < exit - EPSILON && exit > EPSILON && entry < 1 - EPSILON;
}

function escapingCar(side: number, along: number, sideStep: number, alongStep: number): boolean {
  const sideGap = Math.abs(side) - HALF_WIDTH, alongGap = Math.abs(along) - HALF_LENGTH;
  const gap = Math.max(sideGap, alongGap);
  let slope = -Infinity;
  if (sideGap >= gap - EPSILON) slope = Math.abs(side) < EPSILON ? Math.abs(sideStep) : Math.sign(side) * sideStep;
  if (alongGap >= gap - EPSILON) slope = Math.max(slope, Math.abs(along) < EPSILON ? Math.abs(alongStep) : Math.sign(along) * alongStep);
  if (slope < -EPSILON) return false;
  return slope > EPSILON || side * sideStep / (HALF_WIDTH * HALF_WIDTH) + along * alongStep / (HALF_LENGTH * HALF_LENGTH) >= -EPSILON;
}

export class WalkingCollision {
  private readonly world: Pick<CityWorld, "canOccupy">;
  private readonly player: Pick<Player, "x" | "z">;
  private readonly cars = new Float64Array(MAX_WALKING_CARS * STRIDE);
  private count = 0;
  private feetHeight = 0;

  constructor(world: Pick<CityWorld, "canOccupy">, player: Pick<Player, "x" | "z">) { this.world = world; this.player = player; }

  get carCount(): number { return this.count; }

  setCars(cars: readonly CarPose[], feetHeight = 0): void {
    this.count = 0;
    this.feetHeight = Number.isFinite(feetHeight) ? Math.max(0, feetHeight) : 0;
    if (!Number.isFinite(this.player.x) || !Number.isFinite(this.player.z)) return;
    for (const car of cars) {
      if (!Number.isFinite(car.x) || !Number.isFinite(car.z) || !Number.isFinite(car.yaw)) continue;
      const distance = (car.x - this.player.x) ** 2 + (car.z - this.player.z) ** 2;
      if (distance > WALKING_CAR_QUERY_RADIUS ** 2) continue;
      const yaw = ((car.yaw % Math.PI) + Math.PI) % Math.PI;
      let index = 0, duplicate = false;
      for (; index < this.count; index++) {
        const offset = index * STRIDE;
        if (this.cars[offset] === car.x && this.cars[offset + 1] === car.z && Math.abs(this.cars[offset + 5] - yaw) < EPSILON) { duplicate = true; break; }
        const before = distance < this.cars[offset + 4] || distance === this.cars[offset + 4] && (car.x < this.cars[offset] || car.x === this.cars[offset] && (car.z < this.cars[offset + 1] || car.z === this.cars[offset + 1] && yaw < this.cars[offset + 5]));
        if (before) break;
      }
      if (duplicate || index >= MAX_WALKING_CARS) continue;
      const end = Math.min(this.count, MAX_WALKING_CARS - 1);
      for (let slot = end; slot > index; slot--) {
        const offset = slot * STRIDE;
        for (let field = 0; field < STRIDE; field++) this.cars[offset + field] = this.cars[offset - STRIDE + field];
      }
      const offset = index * STRIDE;
      this.cars[offset] = car.x; this.cars[offset + 1] = car.z;
      this.cars[offset + 2] = Math.sin(yaw); this.cars[offset + 3] = Math.cos(yaw);
      this.cars[offset + 4] = distance; this.cars[offset + 5] = yaw;
      this.count = Math.min(MAX_WALKING_CARS, this.count + 1);
    }
  }

  canOccupy(x: number, z: number): boolean { return this.canStep(this.player.x, this.player.z, x, z); }

  canStep(fromX: number, fromZ: number, x: number, z: number): boolean {
    if (!Number.isFinite(fromX) || !Number.isFinite(fromZ) || !Number.isFinite(x) || !Number.isFinite(z) || !this.world.canOccupy(x, z)) return false;
    if (this.feetHeight >= WALKING_CAR_ROOF_CLEARANCE) return true;
    const stepX = x - fromX, stepZ = z - fromZ;
    for (let index = 0; index < this.count; index++) {
      const offset = index * STRIDE, carX = this.cars[offset], carZ = this.cars[offset + 1];
      if (Math.min(fromX, x) > carX + REACH || Math.max(fromX, x) < carX - REACH || Math.min(fromZ, z) > carZ + REACH || Math.max(fromZ, z) < carZ - REACH) continue;
      const sine = this.cars[offset + 2], cosine = this.cars[offset + 3];
      const relativeX = fromX - carX, relativeZ = fromZ - carZ;
      const side = relativeX * cosine + relativeZ * sine, along = relativeX * sine - relativeZ * cosine;
      const sideStep = stepX * cosine + stepZ * sine, alongStep = stepX * sine - stepZ * cosine;
      if (Math.abs(side) < HALF_WIDTH - EPSILON && Math.abs(along) < HALF_LENGTH - EPSILON) {
        if (!escapingCar(side, along, sideStep, alongStep)) return false;
      } else if (crossesCar(side, along, sideStep, alongStep)) return false;
    }
    return true;
  }
}
