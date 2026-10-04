import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, roadDistance } from "./driving.ts";
import { inPark } from "./park.ts";
import { WALKING_CAR_ROOF_CLEARANCE } from "./walking-collision.ts";
import { PLAYER_RADIUS } from "./world.ts";

interface RoadPoint { x: number; z: number }
export interface RoadPlayer extends RoadPoint { y?: number; mode?: string; place?: string }
export interface RoadResident extends RoadPoint { y: number; next: number; path: readonly { road?: boolean; crossing?: boolean }[] }
export interface RoadPerception { eye: RoadPoint; players?: readonly RoadPlayer[]; residents?: readonly RoadResident[] }

export const ROAD_AWARENESS_RADIUS = 120;
export const MAX_ROAD_PEDESTRIANS = 64;
export const ROAD_PEDESTRIAN_MARGIN = 0.3;
export const ROAD_RESIDENT_RADIUS = 0.5;
export const ROAD_LOOKAHEAD = 80;
const STRIDE = 5;

export function roadLevelPedestrian(person: RoadPlayer): boolean {
  const height = person.y ?? 0;
  return Number.isFinite(person.x) && Number.isFinite(person.z) && Number.isFinite(height) && height >= -0.05 && height < WALKING_CAR_ROOF_CLEARANCE
    && !person.place && (person.mode === undefined || person.mode === "walk") && !inPark(person.x, person.z) && roadDistance(person.x, person.z) < 6.2;
}

export class RoadAwareness {
  private readonly candidates = new Float64Array(MAX_ROAD_PEDESTRIANS * STRIDE);
  private readonly laneCandidates = new Float64Array(MAX_ROAD_PEDESTRIANS * 2);
  private count = 0;
  private laneCount = 0;

  get pedestrianCount(): number { return this.count; }

  set(perception?: RoadPerception): void {
    this.count = 0; this.laneCount = 0;
    if (!perception || !Number.isFinite(perception.eye.x) || !Number.isFinite(perception.eye.z)) return;
    for (const player of perception.players ?? []) this.add(player, PLAYER_RADIUS, 0, perception.eye);
    for (const resident of perception.residents ?? []) {
      if (!Number.isInteger(resident.next) || resident.next < 0) continue;
      const target = resident.path[resident.next];
      if (target?.road && target.crossing === false) this.add(resident, ROAD_RESIDENT_RADIUS, 1, perception.eye);
    }
  }

  private add(person: RoadPlayer, radius: number, priority: number, eye: RoadPoint): void {
    if (!roadLevelPedestrian(person)) return;
    const distance = (person.x - eye.x) ** 2 + (person.z - eye.z) ** 2;
    if (distance > ROAD_AWARENESS_RADIUS ** 2) return;
    let index = 0;
    for (; index < this.count; index++) {
      const offset = index * STRIDE;
      if (this.candidates[offset] === person.x && this.candidates[offset + 1] === person.z) return;
      const previousPriority = this.candidates[offset + 4], previousDistance = this.candidates[offset + 3];
      if (priority < previousPriority || priority === previousPriority && (distance < previousDistance || distance === previousDistance && (person.x < this.candidates[offset] || person.x === this.candidates[offset] && person.z < this.candidates[offset + 1]))) break;
    }
    if (index >= MAX_ROAD_PEDESTRIANS) return;
    const end = Math.min(this.count, MAX_ROAD_PEDESTRIANS - 1);
    for (let slot = end; slot > index; slot--) {
      const offset = slot * STRIDE;
      for (let field = 0; field < STRIDE; field++) this.candidates[offset + field] = this.candidates[offset - STRIDE + field];
    }
    const offset = index * STRIDE;
    this.candidates[offset] = person.x; this.candidates[offset + 1] = person.z; this.candidates[offset + 2] = radius;
    this.candidates[offset + 3] = distance; this.candidates[offset + 4] = priority;
    this.count = Math.min(MAX_ROAD_PEDESTRIANS, this.count + 1);
  }

  selectLane(axis: "x" | "z", line: number): void {
    this.laneCount = 0;
    if (!Number.isFinite(line)) return;
    for (let index = 0; index < this.count; index++) {
      const offset = index * STRIDE, radius = this.candidates[offset + 2];
      const across = this.candidates[offset + (axis === "x" ? 1 : 0)];
      if (Math.abs(across - line) >= CAR_HALF_WIDTH + radius + ROAD_PEDESTRIAN_MARGIN) continue;
      const laneOffset = this.laneCount++ * 2;
      this.laneCandidates[laneOffset] = this.candidates[offset + (axis === "x" ? 0 : 1)];
      this.laneCandidates[laneOffset + 1] = CAR_HALF_LENGTH + radius + ROAD_PEDESTRIAN_MARGIN;
    }
  }

  clearance(along: number, direction: number): number {
    if (!Number.isFinite(along) || direction !== -1 && direction !== 1) return Infinity;
    let clearance = Infinity;
    for (let index = 0; index < this.laneCount; index++) {
      const offset = index * 2, extent = this.laneCandidates[offset + 1];
      const distance = (this.laneCandidates[offset] - along) * direction;
      if (distance > -extent && distance < ROAD_LOOKAHEAD) clearance = Math.min(clearance, Math.max(0, distance - extent));
    }
    return clearance;
  }
}
