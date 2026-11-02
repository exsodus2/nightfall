import { parkBlock, parkBlocked } from "./park.ts";

export type RGB = readonly [number, number, number];
/** Rootwood Park (park.ts): bounds, the boss arena and the interior test, for other systems. */
export { PARK, PARK_ARENA, PARK_INTERIOR, inPark, parkBlocked } from "./park.ts";

export interface District {
  id: number;
  name: string;
  description: string;
  color: RGB;
  hex: string;
  x: number;
  z: number;
}

export interface Building {
  id: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  district: number;
  /** Building type 0-7 (BUILDING_TYPES). Also the occlusion family visibility.ts assumes: types 4
   * and 7 have slimmer cores, so every massing family with setbacks is typed 4 or 7. */
  style: number;
  sign: string;
  accent: RGB;
  /** Massing family (FORM): podium towers, ziggurats, twins, megablocks, spires, stacks, lift cores.
   * Optional so hand-made test buildings stay valid; absent means the classic slab. */
  form?: number;
  /** Facade material 0-11 the shader draws on the main mass (architecture.ts SKIN); absent = style. */
  skin?: number;
}

export interface Block {
  x: number;
  z: number;
  buildings: Building[];
}

export interface Landmark {
  id: string;
  name: string;
  description: string;
  x: number;
  z: number;
  arrivalX: number;
  arrivalZ: number;
  color: RGB;
  kind: "spire" | "gate" | "reactor" | "market" | "garden" | "array";
}

export const BLOCK_SIZE = 64;
export const HALF_BLOCKS = 12;
export const WORLD_EDGE = HALF_BLOCKS * BLOCK_SIZE;
export const PLAYER_RADIUS = 0.8;
export const CITY_SEED = 2089;
export const SPAWN = { x: 0, z: 78, yaw: 0.12, pitch: -0.13 };

export const DISTRICTS: readonly District[] = [
  { id: 0, name: "The Foundry", description: "Furnaces, scrapyards and Kiln Nine's workshop", color: [255, 143, 77], hex: "#ff8f4d", x: -512, z: -320 },
  { id: 1, name: "Neon Ward", description: "Towers, signs and CorpSec patrols under the Spire", color: [255, 71, 148], hex: "#ff4794", x: 0, z: -320 },
  { id: 2, name: "Ghost Circuit", description: "Antenna roofs, dead screens and the Signal Cathedral", color: [133, 155, 255], hex: "#859bff", x: 512, z: -320 },
  { id: 3, name: "Rain Gardens", description: "Terrace farms, the Glasshouse nursery and the Last Tree", color: [107, 226, 162], hex: "#6be2a2", x: -512, z: 320 },
  { id: 4, name: "Silk Market", description: "Night stalls, Blue Hour Tea and the contract board", color: [66, 223, 227], hex: "#42dfe3", x: 0, z: 320 },
  { id: 5, name: "The Spillway", description: "Low docks, scaffolding and the Afterlight Arcade", color: [255, 196, 96], hex: "#ffc460", x: 512, z: 320 },
];

export const LANDMARKS: readonly Landmark[] = [
  { id: "spire", name: "Meridian Spire", description: "The tallest tower in Neon Ward. Its crown beacon guides the sky taxis.", x: 32, z: -160, arrivalX: 0, arrivalZ: -128, color: [255, 71, 148], kind: "spire" },
  { id: "gate", name: "Memory Gate", description: "An arch hung with memory tags. Silk Market regulars tie one on for every deal they close.", x: 0, z: 208, arrivalX: 0, arrivalZ: 224, color: [66, 223, 227], kind: "gate" },
  { id: "reactor", name: "The Ember Core", description: "The Foundry's reactor: a plasma sun inside turning rings. It powers the furnaces.", x: -480, z: -288, arrivalX: -512, arrivalZ: -256, color: [255, 143, 77], kind: "reactor" },
  { id: "array", name: "Signal Cathedral", description: "A broadcast array built like a church. Ghost runners tap its feeds.", x: 480, z: -288, arrivalX: 448, arrivalZ: -256, color: [133, 155, 255], kind: "array" },
  { id: "garden", name: "The Last Tree", description: "The only old tree left in the Rain Gardens. Its fruit glows at night.", x: -480, z: 288, arrivalX: -512, arrivalZ: 256, color: [107, 226, 162], kind: "garden" },
  { id: "market", name: "Afterlight Arcade", description: "A pagoda of game floors in the Spillway, open all night.", x: 480, z: 288, arrivalX: 448, arrivalZ: 256, color: [255, 196, 96], kind: "market" },
];

const BRANDS = ["KAI", "ONO", "MORI", "LOTUS", "AHN", "NOVA", "KITO", "YORI", "TORA", "NAMI", "SOMA", "AKIRA", "MAKO", "LUNA", "SABLE", "KOWLOON", "HANA", "ECHO", "VANTA", "KOI", "FUJI", "MOTEL9", "ORBIT", "SEN", "NORI", "DUSK", "ATLAS", "SEVEN", "JADE", "UMBRA", "MISO", "HONG"];
const TRADES = ["RAMEN", "OPTICS", "RADIO", "BATHS", "ROOMS", "TEA", "REPAIR", "FILM", "CLINIC", "VINYL", "SYNTH", "ARCADE", "COFFEE", "PAWN", "MARKET", "SUSHI", "WORKS", "LAB", "CABLE", "FLORA"];
const ACCENTS: readonly RGB[] = [[48, 211, 218], [255, 66, 145], [241, 164, 78], [117, 149, 209]];

export function randomFor(x: number, z: number, salt = 0): number {
  let value = Math.imul(x ^ CITY_SEED, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(salt, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Street lamps, one per intersection of the x = 64·ix and z = 64·iz streets (the post also
 * carries the crossing's signal head), at the intersection's +x/+z corner. The post stands on
 * the pavement just behind the kerb (road < 6.2 m from the centre line, kerb to 6.6 m, both
 * doubled on the central avenue), off the 7.2 m walking lines and clear of the avenue station's
 * columns; the head hangs LAMP_ARM metres back over the kerb. activity.ts draws the posts,
 * engine.ts lights them (the rain tint reads the same lights) and the lamp cones in
 * materials.ts `atmosphere()` mirror this function - keep all of them in step. */
export const LAMP_ARM = 1;
export const LAMP_HEAD_HEIGHT = 8.2;
/** Street indices with lamps: every street but the world-edge ones. */
export const LAMP_STREETS = HALF_BLOCKS - 1;
export interface StreetLamp { x: number; z: number; postX: number }
export function streetLamp(ix: number, iz: number): StreetLamp {
  const avenue = ix === 0;
  const postX = ix * BLOCK_SIZE + (avenue ? 13.5 : 6.75);
  return { x: postX - LAMP_ARM, z: iz * BLOCK_SIZE + (avenue ? 9.5 : 6.75), postX };
}
/** The `count` lamp heads nearest to (x, z). */
export function nearestStreetLamps(x: number, z: number, count: number): StreetLamp[] {
  const cx = Math.round(x / BLOCK_SIZE), cz = Math.round(z / BLOCK_SIZE), lamps: StreetLamp[] = [];
  for (let iz = cz - 1; iz <= cz + 1; iz++) for (let ix = cx - 1; ix <= cx + 1; ix++) {
    if (Math.abs(ix) <= LAMP_STREETS && Math.abs(iz) <= LAMP_STREETS) lamps.push(streetLamp(ix, iz));
  }
  return lamps.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)).slice(0, count);
}

/** Monorail lines. Each is a rounded rectangle (metro.ts `linePose`): straights along street
 * centre lines, 64 m radius corners, running clockwise seen from above (north side eastbound), so
 * the platforms and doors are always on the right, facing the city centre.
 * - The City Loop runs RAIL_DECK_HEIGHT up along z = ±320 (|x| <= 448) and x = ±512 (|z| <= 256),
 *   turning through the four landmark blocks.
 * - The Rim Line runs RIM_DECK_HEIGHT up along the four Rim Roads at the world edge (x, z = ±768:
 *   no traffic, lamps, parking or cables), turning through the four corner blocks, which are kept
 *   clear as rail yards (`rimPlotCleared`). Its outer legs stand on the harbour quay outside the city.
 * Decks rise and dip between stations (metro.ts `LINE_PROFILES`); legs reach the local soffit.
 * No support stands in a carriageway, a crossing or a junction:
 * - along the streets a portal frame straddles the road at every mid-block, its two legs
 *   RAIL_PORTAL_LATERAL out on both pavements. Plots sit 26 m apart and are at most 22 m wide, so
 *   the mid-block gap between the two buildings is always open; the legs stay clear of the 7.2 m
 *   walking lines, the 5.8 m parking lane and the corner lamps;
 * - on each corner two single columns stand in the landmark plaza or rail yard,
 *   RAIL_ARC_COLUMN_ANGLE into the curve (about 9.8 m in from both streets).
 * Spans stay under 68 m. metro-scene.ts draws these, `CityWorld.canOccupy` and driving.ts
 * STATIC_OBSTACLES collide with them, and tests/rail-supports.test.ts checks every footprint. */
export interface RailGeometry { hx: number; hz: number; radius: number }
export const RAIL_LOOP: RailGeometry = { hx: 512, hz: 320, radius: 64 };
export const RAIL_RIM: RailGeometry = { hx: WORLD_EDGE, hz: WORLD_EDGE, radius: 64 };
export const RAIL_GEOMETRY: readonly RailGeometry[] = [RAIL_LOOP, RAIL_RIM];
export const RAIL_DECK_HEIGHT = 27.7;
/** The Rim Line's base deck: higher, so it looks over the edge towers' podiums and out to sea. */
export const RIM_DECK_HEIGHT = 39.7;
/** Base deck height of each line; platforms stand 1.2 m above it. */
export const LINE_DECK_HEIGHT: readonly number[] = [RAIL_DECK_HEIGHT, RIM_DECK_HEIGHT];
/** Half the 1.5 m deck beam: the soffit (top of every leg and crossbeam) is this far below the deck. */
export const RAIL_DECK_HALF = 0.75;
/** Underside of the City Loop's deck beam at a station (the deck rises and dips between them). */
export const RAIL_SOFFIT = RAIL_DECK_HEIGHT - RAIL_DECK_HALF;
export const RAIL_PORTAL_LATERAL = 9;
export const RAIL_ARC_COLUMN_ANGLE = 0.56;
/** A square footprint, centre and half side. */
export interface RailLeg { x: number; z: number; half: number }
/** `span` is the axis a portal's crossbeam spans (null: a single column under the track). */
export interface RailSupport { line: number; x: number; z: number; span: "x" | "z" | null; legs: readonly RailLeg[] }
function lineSupports(line: number, g: RailGeometry): RailSupport[] {
  const list: RailSupport[] = [];
  const leg = (x: number, z: number, half: number): RailLeg => ({ x, z, half });
  const sx = g.hx - g.radius, sz = g.hz - g.radius;
  for (const side of [-1, 1]) {
    for (let x = -sx + BLOCK_SIZE / 2; x <= sx - BLOCK_SIZE / 2; x += BLOCK_SIZE) { const z = side * g.hz; list.push({ line, x, z, span: "z", legs: [leg(x, z - RAIL_PORTAL_LATERAL, 0.65), leg(x, z + RAIL_PORTAL_LATERAL, 0.65)] }); }
    for (let z = -sz + BLOCK_SIZE / 2; z <= sz - BLOCK_SIZE / 2; z += BLOCK_SIZE) { const x = side * g.hx; list.push({ line, x, z, span: "x", legs: [leg(x - RAIL_PORTAL_LATERAL, z, 0.65), leg(x + RAIL_PORTAL_LATERAL, z, 0.65)] }); }
  }
  const s = Math.sin(RAIL_ARC_COLUMN_ANGLE) * g.radius, c = Math.cos(RAIL_ARC_COLUMN_ANGLE) * g.radius;
  for (const ex of [-1, 1]) for (const ez of [-1, 1]) {
    const cx = ex * sx, cz = ez * sz;
    for (const [dx, dz] of [[s, c], [c, s]]) { const x = cx + ex * dx, z = cz + ez * dz; list.push({ line, x, z, span: null, legs: [leg(x, z, 0.9)] }); }
  }
  return list;
}
export const RAIL_SUPPORTS: readonly RailSupport[] = RAIL_GEOMETRY.flatMap((geometry, line) => lineSupports(line, geometry));
/** Every station, line by line in running order: (x, z) is the platform centre on the track,
 * `yaw` the train's heading there (platform side u = (cos yaw, sin yaw), toward the city centre).
 * metro.ts STATIONS adds track distances, heights and timetables. Loop names are the districts'. */
export interface StationSite { line: number; district: number; name: string; x: number; z: number; yaw: number }
const NORTH = Math.PI / 2, EAST = Math.PI, SOUTH = -Math.PI / 2, WEST = 0;
export const STATION_SITES: readonly StationSite[] = [
  ...[0, 1, 2, 5, 4, 3].map((district, i) => ({ line: 0, district, name: DISTRICTS[district].name, x: i < 3 ? -448 + i * 448 : 448 - (i - 3) * 448, z: i < 3 ? -320 : 320, yaw: i < 3 ? NORTH : SOUTH })),
  // The Rim Line: one stop mid-side and one before each corner, every one on a cross street.
  { line: 1, district: 1, name: "Neon Breakwater", x: 0, z: -WORLD_EDGE, yaw: NORTH },
  { line: 1, district: 2, name: "Signal Pier", x: 640, z: -WORLD_EDGE, yaw: NORTH },
  { line: 1, district: 5, name: "Spillway Locks", x: WORLD_EDGE, z: 0, yaw: EAST },
  { line: 1, district: 5, name: "Low Tide Gate", x: WORLD_EDGE, z: 640, yaw: EAST },
  { line: 1, district: 4, name: "Silk Harbour", x: 0, z: WORLD_EDGE, yaw: SOUTH },
  { line: 1, district: 3, name: "Gardens Rim", x: -640, z: WORLD_EDGE, yaw: SOUTH },
  { line: 1, district: 3, name: "Floodgate", x: -WORLD_EDGE, z: 0, yaw: WEST },
  { line: 1, district: 0, name: "Foundry Gate", x: -WORLD_EDGE, z: -640, yaw: WEST },
];
/** Street-level columns under every station platform, station-local (u from the track toward the
 * platform side, v along it; metro.ts `localToWorld`). At u = 9 they are off the 7.2 m walking
 * line; |v| >= 16 keeps the avenue station's columns out of the double-width carriageway
 * (|x| < 12.4) and clear of its x = 13.5 lamp posts. The lift shaft is at u = 9, v = 20. */
export const STATION_COLUMN_U = 9;
export const STATION_COLUMN_V: readonly number[] = [-24, -16, 16, 24];
export const STATION_COLUMN_HALF = 0.55;
const siteToWorld = (site: StationSite, u: number, v: number): { x: number; z: number } => ({ x: site.x + Math.cos(site.yaw) * u - Math.sin(site.yaw) * v, z: site.z + Math.sin(site.yaw) * u + Math.cos(site.yaw) * v });
/** The four Rim Line corner yards (the corner blocks), each with a landmark at its centre that the
 * ride passes: a lit radio mast, a harbour crane, a water tower and a furnace stack. `half` is the
 * square footprint walkers and cars collide with. */
export interface RimYard { x: number; z: number; kind: "mast" | "crane" | "tank" | "stack"; half: number }
const YARD = WORLD_EDGE - BLOCK_SIZE / 2;
export const RIM_YARDS: readonly RimYard[] = [
  { x: YARD, z: -YARD, kind: "mast", half: 2.5 },
  { x: YARD, z: YARD, kind: "crane", half: 3 },
  { x: -YARD, z: YARD, kind: "tank", half: 6.6 },
  { x: -YARD, z: -YARD, kind: "stack", half: 4 },
];
/** Building plots the Rim Line keeps clear: the corner yards, and its concourses (as the loop's,
 * 28 m either side of the track and 35 m along it from each station). */
export function rimPlotCleared(x: number, z: number): boolean {
  const corner = WORLD_EDGE - BLOCK_SIZE;
  if (Math.abs(x) > corner && Math.abs(z) > corner) return true;
  return STATION_SITES.some(site => {
    if (site.line !== 1) return false;
    const dx = x - site.x, dz = z - site.z;
    return Math.abs(dx * Math.cos(site.yaw) + dz * Math.sin(site.yaw)) < 28 && Math.abs(dx * Math.sin(site.yaw) - dz * Math.cos(site.yaw)) < 35;
  });
}
/** Every street-level solid of the rail lines (viaduct legs, then station columns, then the rim
 * yard landmarks), world space. */
export const RAIL_SOLIDS: readonly RailLeg[] = [
  ...RAIL_SUPPORTS.flatMap(support => support.legs),
  ...STATION_SITES.flatMap(site => STATION_COLUMN_V.map(v => ({ ...siteToWorld(site, STATION_COLUMN_U, v), half: STATION_COLUMN_HALF }))),
  ...RIM_YARDS.map(yard => ({ x: yard.x, z: yard.z, half: yard.half })),
];
/** RAIL_SOLIDS by every block their collision box (with the player's radius) touches. */
const RAIL_SOLIDS_BY_BLOCK = (() => {
  const map = new Map<string, RailLeg[]>();
  for (const solid of RAIL_SOLIDS) {
    const reach = solid.half + PLAYER_RADIUS;
    for (let bz = Math.floor((solid.z - reach) / BLOCK_SIZE); bz <= Math.floor((solid.z + reach) / BLOCK_SIZE); bz++) {
      for (let bx = Math.floor((solid.x - reach) / BLOCK_SIZE); bx <= Math.floor((solid.x + reach) / BLOCK_SIZE); bx++) {
        const key = blockKey(bx, bz), list = map.get(key);
        if (list) list.push(solid); else map.set(key, [solid]);
      }
    }
  }
  return map;
})();

/** Massing families; architecture.ts `buildingParts` turns each into boxes. */
export const FORM = {
  SLAB: 0, TERRACED: 1, SIGNAL: 2, PODIUM: 3, ZIGGURAT: 4, TWIN: 5, CANTILEVER: 6, MEGABLOCK: 7, SPIRE: 8, SHANTY: 9,
  /** Slabs stacked crosswise, each tier offset from the last over a recessed plant floor. */
  STACKED: 10,
  /** A tower beside its exposed lift core: a concrete spine, an open lift shaft and a lit car. */
  CORE: 11,
  /** A slab wrapped in giant billboard screens round its upper corners. */
  WRAPPED: 12,
} as const;
/** Facade materials beyond the eight building types (0-7 share the type's id). */
export const SKIN = { CORRUGATED: 8, CURTAIN: 9, PANEL: 10, GARDEN: 11 } as const;
type Choices = readonly number[];
// District identity in massing. Each row: form weights, then [base height, span, curve], the
// building types for plain slabs, and the facade skins of towers.
const DISTRICT_MASSING: readonly { forms: readonly (readonly [number, number])[]; height: readonly [number, number, number]; types: Choices; towers: Choices }[] = [
  // The Foundry: container megablocks, works and slabs; mid-rise and bulky.
  { forms: [[FORM.MEGABLOCK, 0.3], [FORM.SLAB, 0.27], [FORM.CANTILEVER, 0.1], [FORM.PODIUM, 0.1], [FORM.TERRACED, 0.05], [FORM.SIGNAL, 0.06], [FORM.ZIGGURAT, 0.06], [FORM.STACKED, 0.06]], height: [26, 104, 1.5], types: [3, 1, 0, 3], towers: [1, 10, 3, 8] },
  // Neon Ward: podium towers, twins, cantilevers, billboard-wrapped slabs and the odd supertall spire.
  { forms: [[FORM.PODIUM, 0.235], [FORM.TWIN, 0.13], [FORM.CANTILEVER, 0.13], [FORM.SLAB, 0.15], [FORM.WRAPPED, 0.1], [FORM.CORE, 0.05], [FORM.ZIGGURAT, 0.07], [FORM.SIGNAL, 0.06], [FORM.TERRACED, 0.05], [FORM.SPIRE, 0.025]], height: [40, 140, 1.35], types: [2, 1, 5, 6], towers: [9, 2, 9, 10] },
  // Ghost Circuit: antenna towers, exposed lift cores and cold glass.
  { forms: [[FORM.SIGNAL, 0.2], [FORM.PODIUM, 0.19], [FORM.SLAB, 0.17], [FORM.CORE, 0.09], [FORM.STACKED, 0.05], [FORM.TWIN, 0.09], [FORM.CANTILEVER, 0.09], [FORM.ZIGGURAT, 0.05], [FORM.SPIRE, 0.015], [FORM.MEGABLOCK, 0.055]], height: [34, 130, 1.45], types: [1, 2, 3, 6], towers: [7, 10, 9, 2] },
  // Rain Gardens: terraces, stepped ziggurats and offset stacks carrying planters and greenhouses.
  { forms: [[FORM.TERRACED, 0.28], [FORM.ZIGGURAT, 0.22], [FORM.SLAB, 0.25], [FORM.STACKED, 0.1], [FORM.PODIUM, 0.1], [FORM.TWIN, 0.05]], height: [28, 100, 1.6], types: [6, 0, 5, 2], towers: [11, 4, 9, 11] },
  // Silk Market: dense brick and arcade slabs with water tanks, a few billboard towers.
  { forms: [[FORM.SLAB, 0.37], [FORM.PODIUM, 0.14], [FORM.CANTILEVER, 0.09], [FORM.TERRACED, 0.09], [FORM.MEGABLOCK, 0.09], [FORM.WRAPPED, 0.07], [FORM.STACKED, 0.05], [FORM.ZIGGURAT, 0.05], [FORM.TWIN, 0.05]], height: [30, 112, 1.6], types: [5, 0, 6, 1], towers: [2, 6, 0, 9] },
  // The Spillway: low, patched shanty slabs and scaffolding.
  { forms: [[FORM.SHANTY, 0.45], [FORM.SLAB, 0.3], [FORM.MEGABLOCK, 0.15], [FORM.TERRACED, 0.05], [FORM.SIGNAL, 0.05]], height: [22, 62, 1.7], types: [0, 6, 3, 5], towers: [0, 6, 8, 0] },
];
/** Height, type, massing family and facade of one plot. `random(salt)` is the plot's stream. */
export function districtMassing(district: number, avenue: boolean, random: (salt: number) => number): { height: number; style: number; form: number; skin: number } {
  const row = DISTRICT_MASSING[district], pick = (list: Choices, salt: number) => list[Math.floor(random(salt) * list.length) % list.length];
  let roll = random(0), form: number = FORM.SLAB;
  for (const [candidate, weight] of row.forms) { if (roll < weight) { form = candidate; break; } roll -= weight; }
  const [base, span, curve] = row.height;
  let height = avenue ? 36 + Math.pow(random(1), 1.6) * 88 : base + Math.pow(random(1), curve) * span;
  // Setback families need height to read; low ones stay low.
  if (form === FORM.SPIRE) height = 178 + random(2) * 48;
  else if (form === FORM.PODIUM || form === FORM.TWIN || form === FORM.SIGNAL) height = Math.max(height, 58 + random(2) * 20);
  else if (form === FORM.ZIGGURAT) height = Math.max(height, 46 + random(2) * 16);
  else if (form === FORM.MEGABLOCK) height = Math.min(Math.max(height, 34), 96);
  else if (form === FORM.SHANTY) height = Math.min(height, 46);
  else if (form === FORM.STACKED) height = Math.min(Math.max(height, 46 + random(2) * 26), 120);
  else if (form === FORM.CORE) height = Math.max(height, 64 + random(2) * 30);
  else if (form === FORM.WRAPPED) height = Math.max(height, 52 + random(2) * 24);
  // Types 7 and 4 tell visibility.ts the core is slimmer than the plot (setbacks, notches).
  const slim = form === FORM.PODIUM || form === FORM.ZIGGURAT || form === FORM.TWIN || form === FORM.SPIRE || form === FORM.SIGNAL || form === FORM.STACKED || form === FORM.CORE;
  const style = slim ? 7 : form === FORM.TERRACED ? 4 : form === FORM.WRAPPED ? pick([2, 1, 5], 3) : pick(row.types, 3);
  let skin = style;
  if (slim && form !== FORM.SIGNAL) skin = form === FORM.ZIGGURAT && district !== 3 ? pick([4, 10, 1], 4) : pick(row.towers, 4);
  else if (form === FORM.SIGNAL) skin = district === 2 && random(4) < 0.4 ? SKIN.PANEL : 7;
  else if (form === FORM.TERRACED) skin = district === 3 && random(4) < 0.6 ? SKIN.GARDEN : 4;
  else if (form === FORM.MEGABLOCK) skin = random(4) < 0.5 ? SKIN.PANEL : 1;
  else {
    const swap = random(4);
    if (style === 3 && (district === 0 || district === 5) && swap < 0.5) skin = SKIN.CORRUGATED;
    else if (style === 1 && swap < 0.45) skin = SKIN.PANEL;
    else if (style === 2 && (district === 1 || district === 2) && swap < 0.55) skin = SKIN.CURTAIN;
    else if (district === 3 && swap < 0.35) skin = SKIN.GARDEN;
    else if (district === 5 && swap < 0.3) skin = SKIN.CORRUGATED;
  }
  return { height, style, form, skin };
}

export function districtAt(x: number, z: number): District {
  const column = x < -256 ? 0 : x >= 256 ? 2 : 1;
  return DISTRICTS[column + (z >= 0 ? 3 : 0)];
}

export function blockKey(x: number, z: number): string {
  return `${x},${z}`;
}

export class CityWorld {
  readonly blocks = new Map<string, Block>();
  readonly buildings: Building[] = [];

  constructor() {
    let rimSkipped = 0;
    for (let bz = -HALF_BLOCKS; bz < HALF_BLOCKS; bz++) {
      for (let bx = -HALF_BLOCKS; bx < HALF_BLOCKS; bx++) {
        const buildings: Building[] = [];
        // Landmark blocks, and the nine blocks of Rootwood Park, have no building plots.
        const reserved = parkBlock(bx, bz) || LANDMARKS.some((landmark) => landmark.kind !== "gate" && Math.floor(landmark.x / BLOCK_SIZE) === bx && Math.floor(landmark.z / BLOCK_SIZE) === bz);
        if (!reserved) {
          for (let plot = 0; plot < 4; plot++) {
            const originalX = bx * BLOCK_SIZE + (plot % 2 === 0 ? 19 : 45);
            const avenue = Math.abs(originalX) < 24;
            const x = avenue ? Math.sign(originalX) * 25 : originalX;
            const z = bz * BLOCK_SIZE + (plot < 2 ? 19 : 45);
            // Keep the six station concourses clear at street and platform level.
            if (Math.abs(Math.abs(z) - 320) < 28 && [-448, 0, 448].some(stop => Math.abs(x - stop) < 35)) continue;
            // Rim Line concourses and corner yards: their plots keep their ids, so every other building is unchanged.
            if (rimPlotCleared(x, z)) { rimSkipped++; continue; }
            const district = districtAt(x, z);
            // Variety: a plot that would repeat the family and facade of a neighbour (same block, or
            // facing it across the street) re-rolls its massing, at most twice.
            const near = [...buildings, ...(this.blocks.get(blockKey(bx - 1, bz))?.buildings ?? []), ...(this.blocks.get(blockKey(bx, bz - 1))?.buildings ?? [])]
              .filter(other => Math.abs(other.x - x) < 45 && Math.abs(other.z - z) < 45);
            let massing = districtMassing(district.id, avenue, (salt) => randomFor(bx, bz, 100 + plot * 13 + salt));
            for (let attempt = 1; attempt <= 2 && near.some(other => other.form === massing.form && other.skin === massing.skin); attempt++) {
              massing = districtMassing(district.id, avenue, (salt) => randomFor(bx, bz, 100 + plot * 13 + salt + attempt * 577));
            }
            const building: Building = {
              id: this.buildings.length + rimSkipped,
              x, z, height: massing.height,
              width: avenue ? 13 : 15 + randomFor(bx, bz, plot * 7 + 2) * 7,
              depth: 15 + randomFor(bx, bz, plot * 7 + 3) * 7,
              district: district.id,
              style: massing.style, form: massing.form, skin: massing.skin,
              sign: `${BRANDS[Math.floor(randomFor(bx, bz, plot * 7 + 5) * BRANDS.length)]} ${TRADES[Math.floor(randomFor(bx, bz, plot * 7 + 9) * TRADES.length)]}`,
              accent: randomFor(bx, bz, plot * 7 + 6) > 0.48 ? district.color : ACCENTS[Math.floor(randomFor(bx, bz, plot * 7 + 7) * ACCENTS.length)],
            };
            buildings.push(building);
            this.buildings.push(building);
          }
        }
        this.blocks.set(blockKey(bx, bz), { x: bx, z: bz, buildings });
      }
    }
  }

  nearbyBlocks(x: number, z: number, radius: number): Block[] {
    const blocks: Block[] = [];
    const cx = Math.floor(x / BLOCK_SIZE);
    const cz = Math.floor(z / BLOCK_SIZE);
    for (let bz = cz - radius; bz <= cz + radius; bz++) {
      for (let bx = cx - radius; bx <= cx + radius; bx++) {
        const block = this.blocks.get(blockKey(bx, bz));
        if (block) blocks.push(block);
      }
    }
    return blocks;
  }

  canOccupy(x: number, z: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > WORLD_EDGE - 3 || Math.abs(z) > WORLD_EDGE - 3) return false;
    const bx = Math.floor(x / BLOCK_SIZE);
    const bz = Math.floor(z / BLOCK_SIZE);
    const key = blockKey(bx, bz), block = this.blocks.get(key);
    if (block) {
      for (const building of block.buildings) {
        if (Math.abs(x - building.x) < building.width / 2 + PLAYER_RADIUS && Math.abs(z - building.z) < building.depth / 2 + PLAYER_RADIUS) return false;
      }
    }
    for (const solid of RAIL_SOLIDS_BY_BLOCK.get(key) ?? []) {
      if (Math.abs(x - solid.x) < solid.half + PLAYER_RADIUS && Math.abs(z - solid.z) < solid.half + PLAYER_RADIUS) return false;
    }
    for (const landmark of LANDMARKS) {
      if (landmark.kind === "gate") {
        if ((Math.abs(x - 10) < 2.6 || Math.abs(x + 10) < 2.6) && Math.abs(z - landmark.z) < 2.6) return false;
      } else {
        const radius = landmark.kind === "garden" ? 4 : landmark.kind === "spire" ? 14 : 12;
        if (Math.abs(x - landmark.x) < radius && Math.abs(z - landmark.z) < radius) return false;
      }
    }
    // Rootwood Park: trunks, benches, lanterns, hedges, sculptures, the arena's stage and
    // pillars, the gatehouse tunnel mouths and the pond (the footbridge crosses it).
    if (parkBlocked(x, z, PLAYER_RADIUS)) return false;
    return true;
  }
}

export interface Player {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  distance: number;
}

/** On-foot speeds in m/s. Moderate optic flow keeps first-person ASCII comfortable to watch. */
export const WALK_SPEED = 6;
export const SPRINT_SPEED = 11;

/** `sprint` is a flag or a 0..1 blend from walking to sprinting (the engine eases it). */
export function movePlayer(world: Pick<CityWorld, "canOccupy">, player: Player, forward: number, strafe: number, sprint: boolean | number, dt: number): void {
  const magnitude = Math.hypot(forward, strafe);
  if (magnitude === 0) return;
  const pace = typeof sprint === "number" ? Math.max(0, Math.min(1, sprint)) : sprint ? 1 : 0;
  const speed = (WALK_SPEED + (SPRINT_SPEED - WALK_SPEED) * pace) * Math.min(Math.max(dt, 0), 0.1) / Math.max(1, magnitude);
  const dx = (Math.sin(player.yaw) * forward + Math.cos(player.yaw) * strafe) * speed;
  const dz = (-Math.cos(player.yaw) * forward + Math.sin(player.yaw) * strafe) * speed;
  // Small steps prevent crossing thin obstacles, even after a slow frame.
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.4));
  for (let step = 0; step < steps; step++) {
    const oldX = player.x;
    const oldZ = player.z;
    if (world.canOccupy(player.x + dx / steps, player.z)) player.x += dx / steps;
    if (world.canOccupy(player.x, player.z + dz / steps)) player.z += dz / steps;
    player.distance += Math.hypot(player.x - oldX, player.z - oldZ);
  }
}

/** Edge sights: harbour-scale structures that give the city's edge a skyline of its own, seen from
 * the Rim Line and the Rim Roads. Unlike LANDMARKS they stand wholly outside the walkable city (on
 * the harbour quay past the Rim Roads' outer kerb, or in the water beyond the flood wall), so they
 * reserve no plot, need no collision and are not counted as discoveries. `x, z` is the centre of
 * the footprint and `halfX, halfZ` its half extents. sights.ts holds their geometry and motion,
 * sights-scene.ts draws them. */
export interface Sight { id: string; name: string; description: string; x: number; z: number; halfX: number; halfZ: number; color: RGB; kind: "ship" | "barrier" | "cableway" }
export const SIGHTS: readonly Sight[] = [
  { id: "ship", name: "Nami Maru", description: "A container ship moored off Silk Harbour, worked all night by two quay cranes.", x: 0, z: 814, halfX: 112, halfZ: 39, color: [66, 223, 227], kind: "ship" },
  { id: "barrier", name: "Spillway Barrier", description: "The tidal floodgate off the Spillway: sluice gates, control cabins and a spillway chute.", x: 851, z: 288, halfX: 66, halfZ: 112, color: [255, 196, 96], kind: "barrier" },
  { id: "cableway", name: "Rainline Cableway", description: "Gondolas riding the coast from the Rain Gardens up to the Foundry's pylon.", x: -830, z: 0, halfX: 10, halfZ: 462, color: [107, 226, 162], kind: "cableway" },
];
