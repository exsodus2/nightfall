/**
 * Geometry and motion of the edge sights (world.ts SIGHTS): the container ship Nami Maru moored off
 * Silk Harbour with two quay cranes, the Spillway Barrier floodgate off the east coast, and the
 * Rainline cableway along the west coast. Pure data and maths, no drawing (sights-scene.ts draws
 * them; tests/harbour-landmarks.test.ts checks them).
 *
 * Everything stands outside the walkable city (CityWorld.canOccupy stops at WORLD_EDGE - 3): on the
 * harbour quay between the Rim Roads' outer kerb and the flood wall, or in the water beyond it, clear
 * of the Rim Line's outer legs (RAIL_SOLIDS), the flood wall's lamp masts and the offshore pylon line
 * (metro-scene.ts `harbour`).
 *
 * Motion comfort: every motion is slow and smooth. The radar turns at RADAR_DEG_PER_S (<= 10 deg/s),
 * warning lamps breathe at LAMP_BREATH_HZ (<= 0.4 Hz, never fully dark), the crane trolleys run a
 * cosine cycle of TROLLEY_PERIOD seconds, the gondolas glide at CABLE_SPEED and the spillway's water
 * glyphs scroll at CHUTE_SCROLL. No blinking, no strobes.
 */
import { WORLD_EDGE, type RailLeg } from "./world.ts";

// ---- Harbour frame (restated from harbour.ts / metro-scene.ts; the test checks they agree).
/** The Rim Roads' outer kerb: the quay starts here (harbour.ts HARBOUR_ROAD + HARBOUR_KERB). */
export const QUAY_KERB = WORLD_EDGE + 6.6;
/** The flood wall's inner face and its outer (sea) face (harbour.ts HARBOUR_WALL, HARBOUR_COPING). */
export const FLOOD_WALL = WORLD_EDGE + 32;
export const FLOOD_WALL_OUTER = FLOOD_WALL + 2;
/** Top of the flood wall's coping (metro-scene.ts: wall to 5.0 m, coping strip to 5.2 m). */
export const FLOOD_WALL_TOP = 5.2;
/** The water surface (harbour.ts HARBOUR_LEVEL below the street); hulls and piers start below it. */
export const WATER_Y = -1;
export const KEEL_Y = -1.6;
/** Offshore pylon line and the flood wall's lamp masts (metro-scene.ts `harbour`): the masts stand
 * on the wall every WALL_MAST_STEP m from along = -768, the pylons every 128 m from along = -704,
 * PYLON_OUT past the wall. Each mast carries a crossarm with a lamp over the quay and one over the
 * water; harbour.ts lays their light pools on the ground at the same spacing. */
export const PYLON_LINE = FLOOD_WALL + 70;
export const WALL_MAST_STEP = 32;
export const WALL_MAST_ALONG: readonly number[] = Array.from({ length: 2 * WORLD_EDGE / WALL_MAST_STEP + 1 }, (_, k) => -WORLD_EDGE + k * WALL_MAST_STEP);
/** The mast lamps' height and how far each crossarm reaches past the wall's centre, inland and out. */
export const MAST_LAMP_Y = 17.2;
export const MAST_ARM = 3.6;
export const PYLON_ALONG: readonly number[] = Array.from({ length: 12 }, (_, k) => -WORLD_EDGE + 64 + k * 128);

// ---- Motion rates.
export const RADAR_DEG_PER_S = 8;
export const LAMP_BREATH_HZ = 0.3;
export const TROLLEY_PERIOD = 48;
export const CABLE_SPEED = 3;
export const CHUTE_SCROLL = 1.6;

/** A warning lamp's brightness: a slow sine breath between 0.45 and 1 (never dark, never a flash). */
export function breathe(time: number, phase = 0): number {
  return 0.725 + 0.275 * Math.sin(2 * Math.PI * LAMP_BREATH_HZ * time + phase);
}

// ---- The Nami Maru: a 220 m container ship lying off Silk Harbour (x = 0) with her port side to
// the flood wall, bow east. Hull from y = KEEL_Y to the deck; the north side faces the city.
export const SHIP = { x: 0, z: 822, stern: -110, bow: 110, beam: 30, deck: 14 } as const;
/** Container bays on deck: BAY_COUNT bays of BAY_LENGTH from BAY_FROM, three stacks across the beam. */
export const BAY_FROM = -76, BAY_LENGTH = 13, BAY_COUNT = 12, TIER = 2.6;
export const STACK_OFFSETS: readonly number[] = [-10, 0, 10];
/** Gangway from the deck down to the flood wall, then a stair to the quay at GANGWAY_X, landing at GANGWAY_FOOT_Z. */
export const GANGWAY_X = -24, GANGWAY_FOOT_Z = FLOOD_WALL - 6.5;

/** Ship-to-shore gantry cranes on the quay beside the ship. Legs at x +- legX on the land and sea
 * rails (z = landZ, seaZ); the boom runs from backZ over the quay to tipZ past the ship's far side. */
export interface QuayCrane { x: number; phase: number }
export const QUAY_CRANES: readonly QuayCrane[] = [{ x: -48, phase: 0 }, { x: 52, phase: 0.37 }];
export const CRANE = { legX: 8, landZ: 784, seaZ: 798, portalY: 20, boomY: 44, backZ: 778, tipZ: 852, apexY: 62, trolleyFrom: 788, trolleyTo: 846 } as const;
/** The jib's quay floodlight hangs under the boom here, just landward of the trolley's run. */
export const CRANE_FLOOD_Z = CRANE.landZ - 0.5;
/** The trolley's place on the boom and how far its spreader is lowered (0 raised .. 1 down): it runs
 * a smooth cosine between quay and ship once per TROLLEY_PERIOD and lowers at each end. */
export function craneTrolley(time: number, crane: QuayCrane): { z: number; drop: number; loaded: boolean } {
  const a = 2 * Math.PI * (time / TROLLEY_PERIOD + crane.phase);
  const mid = (CRANE.trolleyFrom + CRANE.trolleyTo) / 2, amp = (CRANE.trolleyTo - CRANE.trolleyFrom) / 2;
  // dz/dt is proportional to sin(a): a box rides back to the quay (z falling), the spreader returns empty.
  return { z: mid - amp * Math.cos(a), drop: 0.5 + 0.5 * Math.cos(2 * a), loaded: Math.sin(a) < 0 };
}
/** Height of the spreader under the trolley: lowered onto the quay (y ~6) or the deck stacks (~30). */
export function spreaderY(z: number, drop: number): number {
  const low = 6 + 24 * Math.min(1, Math.max(0, (z - CRANE.trolleyFrom) / (CRANE.trolleyTo - CRANE.trolleyFrom)));
  const high = CRANE.boomY - 5;
  return high - drop * (high - low);
}

// ---- The Spillway Barrier: a tidal floodgate 100 m off the east coast, parallel to it, seen face-on
// from the Spillway and the Rim Line. Piers every 36 m carry gate towers; the gates fill the bays;
// the spill bay's gate stands low and water pours over it down a chute on the city side. A bridge
// on a stair tower links it to the quay.
export const BARRIER = { x: 905, z: 288, half: 110, thickness: 10, crest: 34, sill: 8, pierHalf: 3.5, pierDepth: 14, towerTop: 44, spillZ: 270, gateTop: 22, chuteFoot: 878, bridgeZ: 306, stairX: 791, stairHalf: 2.5 } as const;
export const BARRIER_PIERS: readonly number[] = [-3, -2, -1, 0, 1, 2, 3].map(k => BARRIER.z + k * 36);
/** Bay centres between neighbouring piers; the control cabins sit over the two end bays. */
export const BARRIER_BAYS: readonly number[] = BARRIER_PIERS.slice(1).map(z => z - 18);
export const BARRIER_CABINS: readonly number[] = [BARRIER_BAYS[0], BARRIER_BAYS[BARRIER_BAYS.length - 1]];

// ---- The Rainline: a gondola line over the water off the west coast, from the Rain Gardens
// (z = +448, lower) up to the Foundry's pylon (z = -448, higher). Two cables GAP apart, four towers,
// parabolic sag between them; cabins every ~80 m around the loop (outbound on the city side).
export const CABLEWAY = { x: -830, gap: 6, gardensZ: 448, foundryZ: -448, gardensY: 53, foundryY: 66, sag: 4, drop: 5.5, terminalHalf: 7 } as const;
export const CABLE_LENGTH = CABLEWAY.gardensZ - CABLEWAY.foundryZ;
/** Towers by distance along the line from the Gardens terminal. */
export const CABLE_TOWERS: readonly number[] = [0, 298, 598, CABLE_LENGTH];
export const CABIN_COUNT = 22;
export const CABIN_SPACING = 2 * CABLE_LENGTH / CABIN_COUNT;
export const cableZ = (s: number): number => CABLEWAY.gardensZ - s;
/** Cable height at distance `s` from the Gardens terminal: a straight climb between the terminals
 * with a parabolic sag of CABLEWAY.sag in the middle of each span. */
export function cableHeight(s: number): number {
  const along = Math.min(CABLE_LENGTH, Math.max(0, s));
  const base = CABLEWAY.gardensY + (CABLEWAY.foundryY - CABLEWAY.gardensY) * along / CABLE_LENGTH;
  for (let i = 1; i < CABLE_TOWERS.length; i++) {
    const a = CABLE_TOWERS[i - 1], b = CABLE_TOWERS[i];
    if (along <= b) { const u = (along - a) / (b - a); return base - 4 * CABLEWAY.sag * u * (1 - u); }
  }
  return base;
}
export interface CabinPose { x: number; y: number; z: number; s: number; outbound: boolean; hidden: boolean }
/** Cabin `index` at `time`: x, z on its cable, y the cabin body's centre; `hidden` inside a terminal. */
export function cabinPose(time: number, index: number): CabinPose {
  const loop = 2 * CABLE_LENGTH;
  const p = (((time * CABLE_SPEED + index * CABIN_SPACING) % loop) + loop) % loop;
  const outbound = p < CABLE_LENGTH, s = outbound ? p : loop - p;
  return {
    x: CABLEWAY.x + (outbound ? 1 : -1) * CABLEWAY.gap / 2, y: cableHeight(s) - CABLEWAY.drop, z: cableZ(s), s, outbound,
    hidden: s < CABLEWAY.terminalHalf || s > CABLE_LENGTH - CABLEWAY.terminalHalf,
  };
}

// ---- Light the sights throw on the ground: soft discs that harbour.ts bakes into the ground shader
// (no texture reads, no loops: each pool is one bounded exp). Water pools ride the swell there.
/** A soft disc of light on the quay or the water: centre (x, z), 1/e radius (m), linear RGB added. */
export interface LightPool { x: number; z: number; radius: number; color: readonly [number, number, number] }
const FLOOD_LIGHT = [0.2, 0.16, 0.1] as const, WARM_LIGHT = [0.2, 0.13, 0.06] as const;
/** On the quay: under each crane's jib floodlight, at the gangway stair's foot and the barrier stair. */
export const QUAY_POOLS: readonly LightPool[] = [
  ...QUAY_CRANES.map(crane => ({ x: crane.x, z: CRANE_FLOOD_Z + 4.5, radius: 6.5, color: FLOOD_LIGHT })),
  { x: GANGWAY_X, z: GANGWAY_FOOT_Z - 2.5, radius: 3.5, color: WARM_LIGHT },
  { x: BARRIER.stairX - BARRIER.stairHalf - 3, z: BARRIER.bridgeZ, radius: 4, color: WARM_LIGHT },
];
/** On the water: the barrier's pier floodlights (city face), the spillway's lit foam, the Rainline's
 * tower lamp rings and terminals, and the Nami Maru's red bow and stern lights on the city side. */
export const WATER_POOLS: readonly LightPool[] = [
  ...BARRIER_PIERS.map(z => ({ x: BARRIER.x - BARRIER.pierDepth / 2 - 4, z, radius: 4.5, color: [0.18, 0.12, 0.055] as const })),
  { x: BARRIER.chuteFoot - 5, z: BARRIER.spillZ, radius: 9, color: [0.13, 0.16, 0.17] as const },
  ...CABLE_TOWERS.map((s, i) => ({ x: CABLEWAY.x, z: cableZ(s), radius: i === 0 || i === CABLE_TOWERS.length - 1 ? 10 : 7.5, color: [0.13, 0.11, 0.075] as const })),
  { x: SHIP.bow - 4, z: SHIP.z - 9, radius: 3.5, color: [0.16, 0.02, 0.02] as const },
  { x: SHIP.stern + 3, z: SHIP.z - SHIP.beam / 2 - 1, radius: 3.5, color: [0.16, 0.02, 0.02] as const },
];

/** Ground footprints of the sights' parts that stand on the quay (crane legs, the gangway stair, the
 * barrier's stair tower) and in the water (the cableway's tower caissons), world space. */
export const SIGHT_SOLIDS: readonly RailLeg[] = [
  ...QUAY_CRANES.flatMap(crane => [-CRANE.legX, CRANE.legX].flatMap(dx => [CRANE.landZ, CRANE.seaZ].map(z => ({ x: crane.x + dx, z, half: 0.8 })))),
  { x: GANGWAY_X, z: (FLOOD_WALL + GANGWAY_FOOT_Z) / 2, half: (FLOOD_WALL - GANGWAY_FOOT_Z) / 2 },
  { x: BARRIER.stairX, z: BARRIER.bridgeZ, half: BARRIER.stairHalf },
  ...CABLE_TOWERS.map(s => ({ x: CABLEWAY.x, z: cableZ(s), half: 6 })),
];
