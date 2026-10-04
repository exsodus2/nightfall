import { DISTRICTS, PLAYER_RADIUS, type CityWorld, type Player, type RGB } from "./world.ts";

export type InteriorKind = "workshop" | "listening-bar" | "relay" | "conservatory" | "teahouse" | "salvage";
export interface InteriorPlace {
  id: string;
  name: string;
  sign: string;
  description: string;
  kind: InteriorKind;
  district: number;
  color: RGB;
  building: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  yaw: number;
  entrance: { x: number; z: number; yaw: number };
}
export interface InteriorFixture {
  kind: "counter" | "table" | "shelf" | "machine" | "planter" | "seat";
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}
export const INTERIOR_HEIGHT = 5.8;
export const INTERIOR_REACH = 3;

const VENUES: readonly { id: string; name: string; sign: string; description: string; kind: InteriorKind; x: number; z: number }[] = [
  { id: "kiln", name: "Kiln Nine", sign: "KILN NINE", description: "A night shift keeping the old machines running.", kind: "workshop", x: -512, z: -250 },
  { id: "undertone", name: "Undertone", sign: "UNDERTONE", description: "Low lights, listening booths, one more record.", kind: "listening-bar", x: 0, z: -230 },
  { id: "dead-letter", name: "Dead Letter Exchange", sign: "DEAD LETTER", description: "Signals arrive here long after their senders leave.", kind: "relay", x: 448, z: -230 },
  { id: "glasshouse", name: "The Glasshouse", sign: "GLASSHOUSE", description: "Seedlings and grow lamps at the edge of Rootwood.", kind: "conservatory", x: -576, z: 210 },
  { id: "blue-hour", name: "Blue Hour Tea", sign: "BLUE HOUR", description: "Hot tea and a dry seat beside the market.", kind: "teahouse", x: 0, z: 78 },
  { id: "second-life", name: "Second Life Salvage", sign: "SECOND LIFE", description: "Yesterday's machines, waiting for another purpose.", kind: "salvage", x: 448, z: 230 },
];
const placeCache = new WeakMap<CityWorld, readonly InteriorPlace[]>();

export function interiorPlaces(world: CityWorld): readonly InteriorPlace[] {
  const cached = placeCache.get(world);
  if (cached) return cached;
  const places: InteriorPlace[] = [];
  for (const [district, venue] of VENUES.entries()) {
    let best: InteriorPlace | null = null;
    let nearest = Infinity;
    for (const building of world.buildings) {
      if (building.district !== district || building.id % 3 === 0 || building.width < 15) continue;
      const outward = ((building.z % 64) + 64) % 64 < 32 ? -1 : 1;
      const yaw = outward > 0 ? 0 : Math.PI;
      const entrance = { x: building.x, z: building.z + outward * (building.depth / 2 + 1.8), yaw };
      if (!world.canOccupy(entrance.x, entrance.z)) continue;
      const distance = Math.hypot(entrance.x - venue.x, entrance.z - venue.z);
      if (distance >= nearest) continue;
      nearest = distance;
      best = { ...venue, district, color: DISTRICTS[district].color, building: building.id, x: building.x, z: building.z, width: Math.min(18, building.width - 1), depth: Math.min(20, building.depth - 1), yaw, entrance };
    }
    if (best) places.push(best);
  }
  placeCache.set(world, places);
  return places;
}

export function interiorLocal(place: InteriorPlace, x: number, z: number): { x: number; z: number } {
  const cosine = Math.cos(place.yaw), sine = Math.sin(place.yaw);
  return { x: cosine * (x - place.x) - sine * (z - place.z), z: sine * (x - place.x) + cosine * (z - place.z) };
}

export function interiorWorld(place: InteriorPlace, x: number, z: number): { x: number; z: number } {
  const cosine = Math.cos(place.yaw), sine = Math.sin(place.yaw);
  return { x: place.x + cosine * x + sine * z, z: place.z - sine * x + cosine * z };
}

export function interiorFixtures(place: InteriorPlace): readonly InteriorFixture[] {
  const side = place.width / 2 - 1.4, back = -place.depth / 2 + 2.4;
  const social = place.kind === "teahouse" || place.kind === "listening-bar";
  return [
    { kind: "counter", x: 0, z: back + 1.1, width: place.width * 0.57, depth: 1.15, height: 1.5 },
    { kind: "shelf", x: -side, z: back + 0.6, width: 1.5, depth: 2.6, height: 3.4 },
    { kind: "shelf", x: side, z: back + 0.6, width: 1.5, depth: 2.6, height: 3.4 },
    { kind: social ? "table" : place.kind === "conservatory" ? "planter" : "machine", x: -side + 0.8, z: 0.6, width: 2.2, depth: 2.1, height: social ? 1.25 : 1.7 },
    { kind: social ? "seat" : place.kind === "conservatory" ? "planter" : "machine", x: side - 0.8, z: 0.6, width: 2.1, depth: 2.1, height: social ? 0.7 : 1.7 },
  ];
}

export class CityInteriors {
  readonly places: readonly InteriorPlace[];
  active: InteriorPlace | null = null;
  fixtures: readonly InteriorFixture[] = [];

  constructor(world: CityWorld) { this.places = interiorPlaces(world); }

  nearby(x: number, z: number, reach = INTERIOR_REACH): InteriorPlace | null {
    let closest: InteriorPlace | null = null;
    for (const place of this.places) {
      const distance = Math.hypot(x - place.entrance.x, z - place.entrance.z);
      if (distance < reach) { reach = distance; closest = place; }
    }
    return closest;
  }

  enter(place: InteriorPlace, player: Player): void {
    this.active = place;
    this.fixtures = interiorFixtures(place);
    Object.assign(player, interiorWorld(place, 0, place.depth / 2 - 2.2), { yaw: place.yaw, pitch: 0.02 });
  }

  leave(player: Player): void {
    if (!this.active) return;
    Object.assign(player, this.active.entrance, { yaw: this.active.yaw + Math.PI, pitch: 0 });
    this.active = null;
    this.fixtures = [];
  }

  atExit(x: number, z: number): boolean {
    if (!this.active) return false;
    const local = interiorLocal(this.active, x, z);
    return Math.abs(local.x) < 2 && local.z > this.active.depth / 2 - 3.6;
  }

  canOccupy(x: number, z: number): boolean {
    if (!this.active || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const local = interiorLocal(this.active, x, z), radius = PLAYER_RADIUS;
    if (Math.abs(local.x) > this.active.width / 2 - radius || Math.abs(local.z) > this.active.depth / 2 - radius) return false;
    return !this.fixtures.some(fixture => Math.abs(local.x - fixture.x) < fixture.width / 2 + radius && Math.abs(local.z - fixture.z) < fixture.depth / 2 + radius);
  }

  outdoorPose(player: { x: number; z: number; yaw: number }): { x: number; z: number; yaw: number } {
    return this.active?.entrance ?? player;
  }
}
