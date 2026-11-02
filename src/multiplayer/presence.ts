import { BUILDING_PLACE_ID, CityInteriors, INTERIOR_HEIGHT, INTERIOR_REACH, interiorFixtures, interiorLocal, type InteriorPlace } from "../city/interiors.ts";
import { LIFT_REACH, liftLanding } from "../city/upper-floors.ts";
import { CityWorld, PLAYER_RADIUS } from "../city/world.ts";

export const EXTERIOR_PLACE = "";
export const STREET_INTERACTION_HEIGHT = 1.5;
export const INTERIOR_FEET_LIMIT = INTERIOR_HEIGHT - 3.05;
export const PRESENCE_DOOR_REACH = INTERIOR_REACH + 1.5;

export interface PresencePose { x: number; y: number; z: number; mode: string; place?: string }

let city: CityInteriors | null = null;
/** Ground floors look like "bldg-123", upper floors "bldg-123-f12" (interiors.ts BUILDING_PLACE_ID). */
const GROUND_FLOOR_ID = BUILDING_PLACE_ID;

function cityInteriors(): CityInteriors {
  if (!city) city = new CityInteriors(new CityWorld());
  return city;
}

export function normalizePlace(value: unknown): string | null {
  if (value === undefined || value === EXTERIOR_PLACE) return EXTERIOR_PLACE;
  return typeof value === "string" && presencePlace(value) ? value : null;
}

export function presencePlace(place?: string): InteriorPlace | null {
  if (!place) return null;
  // Venues, secret rooms, then ground and upper floors (generated on demand, cached by CityInteriors).
  return cityInteriors().placeById(place);
}

export function samePlace(left?: string, right?: string): boolean {
  return (left ?? EXTERIOR_PLACE) === (right ?? EXTERIOR_PLACE);
}

export function presenceMapPosition(pose: { x: number; z: number; place?: string }): { x: number; z: number } {
  const place = presencePlace(pose.place);
  return place ? { x: place.entrance.x, z: place.entrance.z } : { x: pose.x, z: pose.z };
}

export function validPresence(pose: PresencePose): boolean {
  if (![pose.x, pose.y, pose.z].every(Number.isFinite)) return false;
  const placeId = normalizePlace(pose.place);
  if (placeId === null) return false;
  if (!placeId) return true;
  const place = presencePlace(placeId);
  if (!place || pose.mode !== "walk" || pose.y < 0 || pose.y > INTERIOR_FEET_LIMIT) return false;
  const local = interiorLocal(place, pose.x, pose.z);
  return Math.abs(local.x) <= place.width / 2 - PLAYER_RADIUS + 0.03 && Math.abs(local.z) <= place.depth / 2 - PLAYER_RADIUS + 0.03;
}

function atInteriorDoor(place: InteriorPlace, pose: PresencePose): boolean {
  const local = interiorLocal(place, pose.x, pose.z);
  return Math.abs(local.x) <= 2.75 && local.z >= place.depth / 2 - 4.35;
}

function atStreetDoor(place: InteriorPlace, pose: PresencePose, reach = PRESENCE_DOOR_REACH): boolean {
  return pose.mode === "walk" && pose.y <= STREET_INTERACTION_HEIGHT && Math.hypot(pose.x - place.entrance.x, pose.z - place.entrance.z) <= reach;
}

const landingCache = new WeakMap<InteriorPlace, readonly { x: number; z: number }[]>();

/** A floor's lift landings in room space (cached per place; the plan itself is cached by its module). */
function liftLandings(place: InteriorPlace): readonly { x: number; z: number }[] {
  let landings = landingCache.get(place);
  if (!landings) {
    landings = interiorFixtures(place).filter(item => item.kind === "lift").map(liftLanding);
    landingCache.set(place, landings);
  }
  return landings;
}

function nearLiftLanding(place: InteriorPlace, pose: PresencePose, reach: number): boolean {
  const local = interiorLocal(place, pose.x, pose.z);
  return liftLandings(place).some(landing => Math.hypot(landing.x - local.x, landing.z - local.z) <= reach);
}

/** Floor to floor of one building: the lift stops at both floors, the rider stood at the lift before
 * and steps out at the lift after. Canonical ids only (a pose's place must be the place's own id). */
function validLiftRide(from: InteriorPlace, to: InteriorPlace, previous: PresencePose, next: PresencePose): boolean {
  const fromFloor = from.floor ?? 1, toFloor = to.floor ?? 1;
  if (from.building !== to.building || fromFloor === toFloor || !to.stops || !from.stops) return false;
  if (!from.stops.includes(fromFloor) || !to.stops.includes(toFloor)) return false;
  if (previous.place !== from.id || next.place !== to.id) return false;
  return nearLiftLanding(from, previous, LIFT_REACH + 1) && nearLiftLanding(to, next, LIFT_REACH + 1.5);
}

export function validPresenceTransition(previous: PresencePose | null, next: PresencePose): boolean {
  if (!validPresence(next)) return false;
  if (!previous) return true;
  if (!validPresence(previous)) return false;
  if (samePlace(previous.place, next.place)) return true;
  const from = presencePlace(previous.place), to = presencePlace(next.place);
  // Upper floors: only the lift moves a player between two floors of the same building.
  if (from && to) return validLiftRide(from, to, previous, next);
  if (to) return !to.floor && atStreetDoor(to, previous) && atInteriorDoor(to, next); // The street leads only to ground floors
  return !!from && next.y <= 0.1 && atStreetDoor(from, next, 0.15);
}
