// Where the hackable street furniture stands: wall-mounted ATMs and locked service doors on the
// shopfronts (signage.ts drawShopfront draws them; rpg/content/hacking-targets.ts turns them into
// interactables at exactly these points). Deterministic per building (`randomFor`), pure, and
// cached per world. Also the tiny display store the session writes (an ATM that just paid out, a
// locked one) and the shopfront reads while drawing.

import { interiorPlaces } from "../../city/interiors.ts";
import { SPAWN, randomFor, type Building, type CityWorld } from "../../city/world.ts";
import type { HackTier } from "../types.ts";

export type HackSiteKind = "atm" | "door";
export interface HackSite {
  /** "atm:<building id>" or "door:<building id>": the interactable id and the save key. */
  id: string;
  kind: HackSiteKind;
  tier: HackTier;
  building: number;
  district: number;
  /** Which street face of the building (signage.ts drawShopfront `side`). */
  side: 0 | 1;
  /** Position along the face in the face's frame (m from its centre). */
  along: number;
  /** World position of the interact point, just out from the wall, and the panel's height. */
  x: number; z: number; y: number;
}

/** Per-district odds (Foundry, Neon Ward, Ghost Circuit, Rain Gardens, Silk Market, Spillway):
 * about 60 ATMs, most in the Neon Ward and Silk Market, few in the Ghost Circuit; about 24 doors. */
const ATM_RATE: readonly number[] = [0.028, 0.055, 0.011, 0.024, 0.045, 0.028];
const DOOR_RATE: readonly number[] = [0.011, 0.013, 0.012, 0.009, 0.009, 0.011];
/** Neon Ward doors are corp service terminals (hard); a few elsewhere too. */
const CORP_RATE: readonly number[] = [0.15, 1, 0.3, 0.1, 0.1, 0.1];
/** The ATM sits in the right-hand wall-furniture slot (signage.ts: s * (halfW - 1.35)). */
export const ATM_INSET = 1.35;
/** How far out from the wall the interact point is, and where a player stands to use it. */
const OUT = 0.6, STAND = 1.4;
const SALT = 7717;

const wrap64 = (v: number): number => ((v % 64) + 64) % 64;

/** The face frame drawShopfront uses: centre-line point, the along-wall axis and the outward normal.
 * Rotation as signage.ts: rotateY(side ? sx * 90 : sz > 0 ? 0 : 180), local x -> (cos, -sin), local z -> (sin, cos). */
export function shopFace(building: Building, side: 0 | 1): { front: number; width: number; ux: number; uz: number; nx: number; nz: number } {
  const sx = wrap64(building.x) < 32 ? -1 : 1, sz = wrap64(building.z) < 32 ? -1 : 1;
  const angle = (side ? sx * 90 : sz > 0 ? 0 : 180) * Math.PI / 180;
  const c = Math.round(Math.cos(angle)), s = Math.round(Math.sin(angle));
  return { front: (side ? building.width : building.depth) / 2, width: side ? building.depth : building.width, ux: c, uz: -s, nx: s, nz: c };
}
/** World point of a face-frame point (`along` the wall, `out` from the face plane). */
export function facePoint(building: Building, side: 0 | 1, along: number, out: number): { x: number; z: number } {
  const f = shopFace(building, side);
  return { x: building.x + along * f.ux + (f.front + out) * f.nx, z: building.z + along * f.uz + (f.front + out) * f.nz };
}
/** The shopfront door's width (signage.ts drawShopfront). */
export const shopDoorWidth = (faceWidth: number): number => Math.min(2.4, Math.max(1.6, faceWidth * 0.13));

const cache = new WeakMap<CityWorld, readonly HackSite[]>();
let byBuilding = new Map<number, HackSite>();

function site(world: CityWorld, building: Building, kind: HackSiteKind, tier: HackTier, preferred: 0 | 1): HackSite | null {
  for (const side of [preferred, (1 - preferred) as 0 | 1]) {
    const f = shopFace(building, side);
    if (f.width < 9) continue;
    const along = kind === "atm" ? f.width / 2 - ATM_INSET : 0;
    const stand = facePoint(building, side, along, STAND);
    if (!world.canOccupy(stand.x, stand.z)) continue;
    const at = facePoint(building, side, along, OUT);
    return { id: `${kind}:${building.id}`, kind, tier, building: building.id, district: building.district, side, along, x: at.x, z: at.z, y: kind === "atm" ? 1.5 : 1.4 };
  }
  return null;
}

/** Every hackable site in the city (ATMs, then doors), deterministic; venue buildings are skipped.
 * The building nearest the spawn point always carries an ATM, so a new player finds one at once. */
export function hackSites(world: CityWorld): readonly HackSite[] {
  const cached = cache.get(world);
  if (cached) { byBuilding = new Map(cached.map(s => [s.building, s])); return cached; }
  const venues = new Set(interiorPlaces(world).map(place => place.building));
  const atms: HackSite[] = [], doors: HackSite[] = [];
  let nearest: Building | null = null, nearestDistance = Infinity;
  for (const building of world.buildings) {
    if (venues.has(building.id)) continue;
    const r = (k: number) => randomFor(building.id, SALT, k);
    const preferred: 0 | 1 = r(3) < 0.5 ? 0 : 1;
    const d = Math.hypot(building.x - SPAWN.x, building.z - SPAWN.z);
    if (d < nearestDistance && site(world, building, "atm", "easy", preferred)) { nearest = building; nearestDistance = d; }
    if (r(1) < (ATM_RATE[building.district] ?? 0.02)) {
      const atm = site(world, building, "atm", "easy", preferred);
      if (atm) { atms.push(atm); continue; }
    }
    if (r(2) < (DOOR_RATE[building.district] ?? 0.01)) {
      const door = site(world, building, "door", r(4) < (CORP_RATE[building.district] ?? 0.1) ? "hard" : "medium", preferred);
      if (door) doors.push(door);
    }
  }
  const home: Building | null = nearest;
  if (home && !atms.some(s => s.building === home.id)) {
    const at = doors.findIndex(s => s.building === home.id);
    if (at >= 0) doors.splice(at, 1);
    const atm = site(world, home, "atm", "easy", randomFor(home.id, SALT, 3) < 0.5 ? 0 : 1);
    if (atm) atms.unshift(atm);
  }
  const sites = [...atms, ...doors];
  cache.set(world, sites);
  byBuilding = new Map(sites.map(s => [s.building, s]));
  return sites;
}
/** The ATMs only (the street furniture list rpg/content places interactables on). */
export const atmSites = (world: CityWorld): readonly HackSite[] => hackSites(world).filter(s => s.kind === "atm");
/** The site on a building, if any (after hackSites ran for the current world: the session does at start-up). */
export const hackSiteOn = (building: number): HackSite | undefined => byBuilding.get(building);

// ---- Display state (session writes, signage reads) ---------------------------------------------

/** "paid": the screen shows a cleared glyph for a while and cash pushes out of the slot (0.5 s);
 * "locked": the screen goes dark, then shows a lock glyph until the lockout ends; "open": a door
 * that was breached (its keypad shows green). */
export type HackLook = "paid" | "locked" | "open";
interface LookEntry { look: HackLook; since: number; until: number }
const looks = new Map<string, LookEntry>();
const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/** Shows `look` on a site for `seconds` from now (replacing what it showed). */
export function setHackLook(id: string, look: HackLook, seconds: number, at = now()): void {
  if (!(seconds > 0)) { looks.delete(id); return; }
  looks.set(id, { look, since: at, until: at + seconds });
}
/** What a site shows now and for how long it has (seconds), or null when idle. */
export function hackLook(id: string, at = now()): { look: HackLook; age: number } | null {
  const entry = looks.get(id);
  if (!entry) return null;
  if (at >= entry.until) { looks.delete(id); return null; }
  return { look: entry.look, age: at - entry.since };
}
