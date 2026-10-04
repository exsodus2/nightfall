import { INTERIOR_HEIGHT, INTERIOR_REACH, interiorLocal, interiorPlaces, type InteriorPlace } from "../city/interiors.ts";
import { CityWorld, PLAYER_RADIUS } from "../city/world.ts";

export const EXTERIOR_PLACE = "";
export const STREET_INTERACTION_HEIGHT = 1.5;
export const INTERIOR_FEET_LIMIT = INTERIOR_HEIGHT - 3.05;
export const PRESENCE_DOOR_REACH = INTERIOR_REACH + 1.5;

export interface PresencePose { x: number; y: number; z: number; mode: string; place?: string }

let venues: ReadonlyMap<string, InteriorPlace> | null = null;

function venueMap(): ReadonlyMap<string, InteriorPlace> {
  if (!venues) venues = new Map(interiorPlaces(new CityWorld()).map(place => [place.id, place]));
  return venues;
}

export function normalizePlace(value: unknown): string | null {
  if (value === undefined || value === EXTERIOR_PLACE) return EXTERIOR_PLACE;
  return typeof value === "string" && venueMap().has(value) ? value : null;
}

export function presencePlace(place?: string): InteriorPlace | null {
  return place ? venueMap().get(place) ?? null : null;
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

export function validPresenceTransition(previous: PresencePose | null, next: PresencePose): boolean {
  if (!validPresence(next)) return false;
  if (!previous) return true;
  if (!validPresence(previous)) return false;
  if (samePlace(previous.place, next.place)) return true;
  const from = presencePlace(previous.place), to = presencePlace(next.place);
  if (from && to) return false;
  if (to) return atStreetDoor(to, previous) && atInteriorDoor(to, next);
  return !!from && next.y <= 0.1 && atStreetDoor(from, next, 0.15);
}
