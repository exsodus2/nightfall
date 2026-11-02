import { blockDoors } from "./street-doors.ts";
import { citizenPavement } from "./citizen-ai.ts";
import { STATIONS, localToWorld } from "./metro.ts";
import { secretPlaces } from "./secrets.ts";
import { GROUND_FLOOR_KINDS, INTERIOR_HEIGHT, interiorPlaces, type GroundFloorKind, type InteriorFixture, type InteriorPlace } from "./interiors.ts";
import { BLOCK_SIZE, PLAYER_RADIUS, type Building, type CityWorld, type RGB } from "./world.ts";
import { liftLanding, liftStops, upperFloorPlan } from "./upper-floors.ts";

/**
 * Ground floors: a walkable, themed interior for every building that has no hand-made venue or
 * secret room. Everything here is deterministic (seeded from the building id, no Math.random) and
 * lazy: places are made per 64 m block on first use, plans per place on first use, both cached.
 *
 * NOTE (import cycle with interiors.ts): nothing imported from interiors.ts may be used at module
 * top level here - only inside functions.
 */

/** A room of a ground-floor plan (room space, the rectangle inside its walls). */
export interface GroundRoom { x: number; z: number; width: number; depth: number; label: string }
/** Someone in a ground floor. Standing residents stand on free, reachable floor; seated ones sit on
 * a seat-like fixture (seat, couch, cushion, bench). `facing` in degrees, interior-scene headingTo
 * convention (180 = toward +z, the street door; -90 = toward +x). `offset` is an animation phase. */
export interface GroundResident { x: number; z: number; seated: boolean; facing: number; line: string; tint: RGB; offset: number }
export interface GroundLight { x: number; z: number; color: RGB }
/**
 * A ground floor's layout, in ROOM space (origin at the room centre, +z toward the street door).
 *
 * Fixture contract: `width`/`depth` are ALWAYS the exact room-space bounding box (x extent, z
 * extent), so collision is a plain box test. Ground-floor `yaw` is only ever 0, PI/2, PI or -PI/2;
 * a piece's front faces the room-space direction (sin yaw, cos yaw) (0: toward +z / the door,
 * PI/2: toward +x). For yaw = +-PI/2 the piece's own width runs along room z (its box is swapped).
 * `wall` fixtures are full-height interior walls (axis-aligned, 0.25 m thick).
 */
export interface GroundFloorPlan {
  fixtures: InteriorFixture[]; rooms: GroundRoom[]; residents: GroundResident[]; lights: GroundLight[];
  /** Locked back rooms (rpg/locked-rooms.ts): each one's `gate` fixture fills the doorway (closed in
   * `fixtures`); everything else stays reachable with it shut. Absent: nothing is locked. */
  locks?: GroundLock[];
}
/** A back room behind a hackable gate: the gate's index in `fixtures`, the room's index in `rooms`. */
export interface GroundLock { fixtureIndex: number; room: number; tier: "easy" | "medium" | "hard" }

// Layout kit: exported for upper-floors.ts, which builds its floors with the same machinery.
type FixtureKind = InteriorFixture["kind"];
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Spec { kind: FixtureKind; w: number; d: number; h: number }
export type Side = "back" | "front" | "left" | "right";
type Role = "front" | "back" | "side";
export interface RoomInfo { rect: Rect; role: Role; order: number; label: string }
interface Spot { x: number; z: number; facing: number; seat: InteriorFixture | null; staff: boolean }

/** Gap that keeps an aisle walkable (> 2 x PLAYER_RADIUS with a margin); smaller gaps are not allowed. */
export const AISLE = 2.1;
export const WALL = 0.25;
export const DOOR = 2.4;
const EPS = 0.02;
const CELL = 0.25;
const MAX_ROOM = 22;
/** Edge of the sightline lane plus float slack: furniture beside the lane starts here. */
export const LANE = 1.45;

/** The fixture kinds that make a ground floor read at a glance, per kind: the first view looks for one. */
export const SIGNATURE_FIXTURES: Readonly<Record<GroundFloorKind, readonly InteriorFixture["kind"][]>> = {
  lobby: ["desk", "mailbox"],
  "capsule-hotel": ["desk", "pod"],
  "corp-lobby": ["desk", "sculpture"],
  arcade: ["counter", "cabinet"],
  pawnshop: ["counter", "case"],
  "machine-shop": ["lathe"],
  "server-hall": ["rack", "desk"],
  shrine: ["altar"],
  hydroponics: ["growrack", "tank"],
  laundromat: ["washer"],
  "market-hall": ["stall"],
  chandlery: ["counter"],
  apartment: ["kitchenette", "couch"],
  garage: ["car"],
};

// ---- Seeded randomness ----------------------------------------------------------------------------

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedOf = (id: number, salt: number): number => (Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
export const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));
export const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length) % list.length];
/** interior-scene.ts headingTo: degrees for a resident looking along (dx, dz). */
export const headingTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz) * 180 / Math.PI;

// ---- Kind selection -------------------------------------------------------------------------------

type Weights = Partial<Record<GroundFloorKind, number>>;
/** District themes (0 Foundry, 1 Neon Ward, 2 Ghost Circuit, 3 Rain Gardens, 4 Silk Market, 5 Spillway). */
const DISTRICT_WEIGHTS: readonly Weights[] = [
  { "machine-shop": 3, garage: 3, chandlery: 1, laundromat: 1, pawnshop: 1.5, lobby: 1, "capsule-hotel": 1, apartment: 1, arcade: 0.5, "server-hall": 0.5 },
  { "corp-lobby": 3, arcade: 3, "capsule-hotel": 2, pawnshop: 1, lobby: 1, "server-hall": 1, shrine: 0.6, laundromat: 0.6, apartment: 0.5 },
  { "server-hall": 3, shrine: 2.5, pawnshop: 1.5, arcade: 1, lobby: 1, "machine-shop": 1, "capsule-hotel": 1, apartment: 0.6, laundromat: 0.5 },
  { hydroponics: 3, apartment: 2.5, shrine: 1.5, laundromat: 1, lobby: 1, "market-hall": 1, chandlery: 0.5, garage: 0.5 },
  { "market-hall": 3, pawnshop: 2.5, arcade: 1.5, "capsule-hotel": 1, shrine: 1, laundromat: 1, apartment: 0.6, chandlery: 0.6 },
  { chandlery: 3, laundromat: 2.5, "capsule-hotel": 2, garage: 1, "market-hall": 1, pawnshop: 1, "machine-shop": 0.6, arcade: 0.5, apartment: 0.6 },
];
/** Building types (architecture.ts BUILDING_TYPES). */
const STYLE_BIAS: readonly Weights[] = [
  { lobby: 2.5, apartment: 2.5, laundromat: 2 }, // Brick tenement
  { "capsule-hotel": 3, lobby: 2, laundromat: 1.5 }, // Concrete megablock
  { "corp-lobby": 3, arcade: 1.5, "server-hall": 1.5 }, // Glass office
  { "machine-shop": 3, garage: 3, "server-hall": 1.5, chandlery: 1.5 }, // Industrial works
  { hydroponics: 2, apartment: 1.5, shrine: 1.5 }, // Terraced tower
  { "market-hall": 3, pawnshop: 2, arcade: 2 }, // Market arcade
  { apartment: 3, lobby: 2, laundromat: 1.5 }, // Balcony apartments
  { "server-hall": 3, shrine: 2 }, // Signal tower
];
/** Trades on the facade sign (world.ts TRADES) that suit a kind: the name keeps the sign then. */
const TRADE_KINDS: Readonly<Record<string, readonly GroundFloorKind[]>> = {
  RAMEN: ["market-hall"], SUSHI: ["market-hall"], TEA: ["market-hall", "shrine"], COFFEE: ["market-hall"],
  OPTICS: ["pawnshop", "corp-lobby"], RADIO: ["server-hall", "pawnshop"], BATHS: ["laundromat", "shrine"],
  ROOMS: ["capsule-hotel", "apartment", "lobby"], REPAIR: ["machine-shop", "garage", "pawnshop"], FILM: ["arcade", "corp-lobby"],
  CLINIC: ["lobby", "corp-lobby"], VINYL: ["pawnshop", "arcade"], SYNTH: ["arcade", "server-hall"], ARCADE: ["arcade"],
  PAWN: ["pawnshop"], MARKET: ["market-hall", "chandlery"], WORKS: ["machine-shop", "garage"], LAB: ["server-hall", "hydroponics", "corp-lobby"],
  CABLE: ["server-hall", "chandlery"], FLORA: ["hydroponics", "shrine"],
};
const BIG_KINDS: ReadonlySet<GroundFloorKind> = new Set<GroundFloorKind>(["market-hall", "garage", "corp-lobby"]);

function pickKind(building: Building, neighbours: ReadonlySet<GroundFloorKind>, random: () => number): GroundFloorKind {
  const trade = building.sign.split(" ")[1] ?? "";
  const area = building.width * building.depth;
  const weights = GROUND_FLOOR_KINDS.map(kind => {
    let weight = (DISTRICT_WEIGHTS[building.district]?.[kind] ?? 0.12) * (STYLE_BIAS[building.style]?.[kind] ?? 1);
    if (TRADE_KINDS[trade]?.includes(kind)) weight *= 2.2;
    if (BIG_KINDS.has(kind) && area < 300) weight *= 0.5;
    if (neighbours.has(kind)) weight *= 0.03;
    return weight;
  });
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, weight] of weights.entries()) { roll -= weight; if (roll <= 0) return GROUND_FLOOR_KINDS[index]; }
  return GROUND_FLOOR_KINDS[GROUND_FLOOR_KINDS.length - 1];
}

const kindCache = new WeakMap<CityWorld, Map<number, GroundFloorKind>>();
/** Every building's ground-floor kind, chosen in building order so near neighbours rarely repeat. */
function worldKinds(world: CityWorld): Map<number, GroundFloorKind> {
  const cached = kindCache.get(world);
  if (cached) return cached;
  const kinds = new Map<number, GroundFloorKind>();
  for (const building of world.buildings) {
    const neighbours = new Set<GroundFloorKind>();
    for (const block of world.nearbyBlocks(building.x, building.z, 1)) for (const other of block.buildings) {
      const kind = kinds.get(other.id);
      if (kind && Math.abs(other.x - building.x) < 48 && Math.abs(other.z - building.z) < 48) neighbours.add(kind);
    }
    kinds.set(building.id, pickKind(building, neighbours, seeded(seedOf(building.id, 11))));
  }
  kindCache.set(world, kinds);
  return kinds;
}

// ---- Names and words ------------------------------------------------------------------------------

const FLAVOUR: Readonly<Record<GroundFloorKind, readonly string[]>> = {
  lobby: ["Residences", "Court", "House"], "capsule-hotel": ["Capsules", "Pods", "Sleep Inn"], "corp-lobby": ["Holdings", "Systems", "Group"],
  arcade: ["Arcade", "Game Floor", "Coin-Op"], pawnshop: ["Pawn", "Loans", "Exchange"], "machine-shop": ["Machine Shop", "Works", "Tooling"],
  "server-hall": ["Data Hall", "Node", "Relay"], shrine: ["Shrine", "Chapel", "Sanctum"], hydroponics: ["Greens", "Hydro", "Grow House"],
  laundromat: ["Laundry", "Wash", "Launderette"], "market-hall": ["Market", "Food Hall", "Bazaar"], chandlery: ["Chandlery", "Ship Stores", "Supply"],
  apartment: ["Flats", "Walk-up", "Rooms"], garage: ["Garage", "Motor Works", "Auto"],
};
const DESCRIPTIONS: Readonly<Record<GroundFloorKind, readonly string[]>> = {
  lobby: ["Mailboxes, a tired lift and a bench nobody sits on.", "The building's front room: post, lifts and gossip."],
  "capsule-hotel": ["Stacked sleep pods by the hour, lockers by the day.", "A reception desk and a wall of quiet capsules."],
  "corp-lobby": ["Polished stone, badge gates and a smile at reception.", "A corporate atrium built to make you wait."],
  arcade: ["Cabinet rows, prize counter and the hum of attract modes.", "Coin-op glow and a high score nobody has beaten."],
  pawnshop: ["Glass cases, a caged till and nothing with a receipt.", "Second-hand everything, priced by mood."],
  "machine-shop": ["Lathes, swarf and a radio that only gets static.", "A shop floor that still makes things by hand."],
  "server-hall": ["Rack rows humming in the cold.", "A data hall where the lights blink for nobody."],
  shrine: ["Candles, cushions and a quiet nobody owns.", "A small shrine squeezed in between the signs."],
  hydroponics: ["Grow racks under magenta light, tanks gurgling.", "Rooftop greens grown indoors, sold by the bunch."],
  laundromat: ["Rows of washers, one bench and the smell of soap.", "Spin cycles and small talk, open all night."],
  "market-hall": ["Stall rows, steam and haggling under one roof.", "A covered market where every stall shouts."],
  chandlery: ["Rope, lamps, crates and dry goods for the docks.", "Ship stores for boats that rarely leave."],
  apartment: ["Somebody's flat. The door was open.", "A ground-floor flat: kettle on, shoes by the door."],
  garage: ["A car on blocks, a tool wall and crates of parts.", "A repair bay that smells of oil and patience."],
};
const LINES: Readonly<Record<GroundFloorKind, readonly string[]>> = {
  lobby: ["LIFT'S OUT AGAIN", "MAIL CAME. BILLS.", "WIPE YOUR FEET", "WHO ARE YOU VISITING"],
  "capsule-hotel": ["PODS BY THE HOUR", "LOCKERS ARE EXTRA", "QUIET AFTER TEN", "CHECKOUT IS NOON"],
  "corp-lobby": ["DO YOU HAVE A BADGE", "APPOINTMENTS ONLY", "SMILE. CAMERAS.", "WE VALUE YOUR TIME"],
  arcade: ["ONE MORE CREDIT", "HIGH SCORE IS MINE", "TOKENS AT THE DESK", "DON'T TILT IT"],
  pawnshop: ["CASH FOR ANYTHING", "NO REFUNDS", "IT WORKED YESTERDAY", "LOOK, DON'T TOUCH"],
  "machine-shop": ["MIND THE CHUCK", "GOGGLES ON", "BACK IN AN HOUR", "TOLERANCE IS TIGHT"],
  "server-hall": ["DON'T UNPLUG THAT", "IT'S MEANT TO HUM", "KEEP IT COLD", "UPTIME IS SACRED"],
  shrine: ["LIGHT ONE FOR THEM", "SHOES OFF", "SIT A WHILE", "THE SIGNAL LISTENS"],
  hydroponics: ["MIND THE ROOTS", "LIGHTS ON TILL SIX", "TASTE THE BASIL", "PH IS PERFECT"],
  laundromat: ["DRYER FOUR EATS COINS", "SPIN CYCLE. WAIT.", "NOT MY SOCK", "SOAP'S BY THE DOOR"],
  "market-hall": ["FRESH TODAY. MOSTLY.", "TWO FOR ONE", "TRY BEFORE YOU BUY", "CASH OR CHIP"],
  chandlery: ["ROPE BY THE METRE", "TIDE'S COMING IN", "EVERYTHING FLOATS", "DRY GOODS IN BACK"],
  apartment: ["YOU LOST?", "KETTLE'S ON", "RENT'S DUE FRIDAY", "SHOES OFF, PLEASE"],
  garage: ["SHE'LL RUN. SOMEDAY", "HAND ME THE TEN", "NO PARKING", "OIL'S FRESH"],
};
/** Front room, the two back rooms, the side room. */
const ROOM_LABELS: Readonly<Record<GroundFloorKind, readonly [string, string, string, string]>> = {
  lobby: ["LOBBY", "MAIL ROOM", "SUPER", "OFFICE"], "capsule-hotel": ["RECEPTION", "PODS", "PODS B", "LOCKERS"],
  "corp-lobby": ["ATRIUM", "LIFTS", "SECURITY", "WAITING"], arcade: ["GAME FLOOR", "PRIZES", "BACK ROOM", "RHYTHM"],
  pawnshop: ["SHOP", "STOCK", "CAGE", "REPAIRS"], "machine-shop": ["SHOP FLOOR", "STORES", "TOOL ROOM", "OFFICE"],
  "server-hall": ["CONTROL", "HALL A", "HALL B", "COLD ROOM"], shrine: ["SANCTUARY", "VESTRY", "RELIQUARY", "QUIET ROOM"],
  hydroponics: ["GROW FLOOR", "NURSERY", "TANKS", "SEED ROOM"], laundromat: ["WASH FLOOR", "DRYERS", "STORE", "FOLDING"],
  "market-hall": ["HALL", "KITCHEN", "STORE", "STALLS"], chandlery: ["SHOP", "STORES", "LOFT", "ROPE ROOM"],
  apartment: ["LIVING", "BEDROOM", "STUDY", "KITCHEN"], garage: ["BAY", "PARTS", "OFFICE", "PAINT"],
};
const LIGHTS: Readonly<Record<GroundFloorKind, RGB>> = {
  lobby: [255, 222, 176], "capsule-hotel": [150, 200, 255], "corp-lobby": [228, 238, 255], arcade: [255, 92, 200], pawnshop: [255, 200, 120],
  "machine-shop": [255, 172, 92], "server-hall": [92, 162, 255], shrine: [255, 150, 70], hydroponics: [206, 96, 255], laundromat: [218, 248, 255],
  "market-hall": [255, 190, 110], chandlery: [255, 210, 150], apartment: [255, 198, 148], garage: [240, 230, 200],
};
export const COATS: readonly RGB[] = [[103, 130, 168], [150, 110, 190], [200, 150, 90], [70, 160, 170], [150, 200, 210], [180, 92, 82], [120, 150, 110], [90, 90, 104]];

const title = (word: string): string => word.charAt(0) + word.slice(1).toLowerCase();

// ---- Places and entrances -------------------------------------------------------------------------

const excludedCache = new WeakMap<CityWorld, ReadonlySet<number>>();
function excludedBuildings(world: CityWorld): ReadonlySet<number> {
  let set = excludedCache.get(world);
  if (!set) { set = new Set([...interiorPlaces(world), ...secretPlaces(world)].map(place => place.building)); excludedCache.set(world, set); }
  return set;
}

/** An entrance keeps this far (m) from every lift, secret door and venue door (their E prompts reach ~3.3 m). */
const DOOR_CLEARANCE = 3.5;
/** Sideways steps (m) along a face tried when the middle of it is blocked or crowded. */
const SLIDES: readonly number[] = [0, 1.5, -1.5, 3, -3];

const rivalCache = new WeakMap<CityWorld, readonly { x: number; z: number }[]>();
/** Doors an entrance must keep clear of: station lifts, secret room doors, hand-made venue doors. */
function rivalDoors(world: CityWorld): readonly { x: number; z: number }[] {
  let doors = rivalCache.get(world);
  if (!doors) {
    doors = [
      ...STATIONS.map(station => localToWorld(station, 9, 20)),
      ...secretPlaces(world).map(place => place.entrance),
      ...interiorPlaces(world).map(place => place.entrance),
    ];
    rivalCache.set(world, doors);
  }
  return doors;
}

/**
 * The entrance 1.8 m out of face (nx, nz), `slide` m along it from the middle, if it and a short
 * approach are walkable pavement (not a carriageway, which world.canOccupy does not know) and clear
 * of every other door.
 */
function openFace(world: CityWorld, building: Building, nx: number, nz: number, slide: number): { x: number; z: number } | null {
  const half = nx !== 0 ? building.width / 2 : building.depth / 2;
  const tx = -nz, tz = nx, fx = building.x + nx * half + tx * slide, fz = building.z + nz * half + tz * slide;
  // The leave pose stands on the entrance: it and a shoulder either side must be pavement (not road).
  for (const [out, side] of [[1.8, 0], [1.8, 0.45], [1.8, -0.45]] as const) {
    if (!citizenPavement(world, fx + nx * out + tx * side, fz + nz * out + tz * side)) return null;
  }
  const entrance = { x: fx + nx * 1.8, z: fz + nz * 1.8 };
  if (rivalDoors(world).some(door => Math.hypot(door.x - entrance.x, door.z - entrance.z) < DOOR_CLEARANCE)) return null;
  return entrance;
}

function makePlace(world: CityWorld, building: Building): InteriorPlace | null {
  if (excludedBuildings(world).has(building.id)) return null;
  const bx = Math.floor(building.x / BLOCK_SIZE), bz = Math.floor(building.z / BLOCK_SIZE);
  const wrap = (value: number) => ((value % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE;
  const sx = wrap(building.x) < BLOCK_SIZE / 2 ? -1 : 1, sz = wrap(building.z) < BLOCK_SIZE / 2 ? -1 : 1;
  // North/south faces first (room yaw 0 or PI, like every venue and secret room): the drawn
  // shopfront door on the block street (street-doors.ts), that street face anyway (stalls), the back
  // face; then the east/west faces (yaw +-PI/2) the same way.
  const drawn = new Set(blockDoors(world, bx, bz).filter(door => door.building === building.id).map(door => `${door.nx},${door.nz}`));
  const faces: (readonly [number, number])[] = [[0, sz], [0, -sz], [sx, 0], [-sx, 0]];
  faces.sort((a, b) => (a[0] !== 0 ? 2 : 0) - (b[0] !== 0 ? 2 : 0) + (drawn.has(`${a[0]},${a[1]}`) ? 0 : 1) - (drawn.has(`${b[0]},${b[1]}`) ? 0 : 1));
  for (const [nx, nz] of faces) {
    const along = nx !== 0 ? building.depth : building.width, across = nx !== 0 ? building.width : building.depth;
    // The room may slide along the face within the footprint's slack to dodge a crowded door.
    const room = Math.min(MAX_ROOM, along - 1), slack = (along - room) / 2 - 0.05;
    let slide = 0, entrance: { x: number; z: number } | null = null;
    for (const step of SLIDES) {
      if (Math.abs(step) > slack) continue;
      entrance = openFace(world, building, nx, nz, step);
      if (entrance) { slide = step; break; }
    }
    if (!entrance) continue;
    const kind = worldKinds(world).get(building.id) ?? "lobby";
    const random = seeded(seedOf(building.id, 23));
    const [brand = "", trade = ""] = building.sign.split(" ");
    const name = TRADE_KINDS[trade]?.includes(kind) ? `${title(brand)} ${title(trade)}` : `${title(brand)} ${pick(FLAVOUR[kind], random)}`;
    const short = `${brand} ${name.split(" ")[1] ?? ""}`.toUpperCase().trim();
    const sign = name.length <= 16 ? name.toUpperCase() : short.length <= 16 ? short : brand;
    const yaw = Math.atan2(nx, nz);
    // Upper floors: a tall lobby, office, hotel, block of flats or server hall has a working lift.
    const stops = liftStops(building, kind);
    return {
      ...(stops.length > 1 ? { stops } : {}),
      id: `bldg-${building.id}`, name, sign, description: pick(DESCRIPTIONS[kind], random), kind, district: building.district, color: building.accent,
      building: building.id, x: building.x - nz * slide, z: building.z + nx * slide, width: Math.min(MAX_ROOM, along - 1), depth: Math.min(MAX_ROOM, across - 1), yaw,
      // The player's yaw facing the building (movePlayer: forward is (sin, -cos)), as for venues.
      entrance: { x: entrance.x, z: entrance.z, yaw: nx !== 0 ? -yaw : yaw },
    };
  }
  return null;
}

const placeCache = new WeakMap<CityWorld, Map<number, InteriorPlace | null>>();
/** The ground floor of `building` (null for venue and secret buildings, or with no reachable face). */
export function groundFloorPlace(world: CityWorld, building: Building): InteriorPlace | null {
  let cache = placeCache.get(world);
  if (!cache) { cache = new Map(); placeCache.set(world, cache); }
  const cached = cache.get(building.id);
  if (cached !== undefined) return cached;
  let place = makePlace(world, building);
  // No dead lifts: a building advertises stops only when its ground floor has a lift the visitor can ride.
  if (place?.stops && !liftRideable(place, groundFloorPlan(place))) {
    const plain: InteriorPlace = { ...place };
    delete plain.stops;
    place = plain;
  }
  cache.set(building.id, place);
  return place;
}

const blockCache = new WeakMap<CityWorld, Map<string, readonly InteriorPlace[]>>();
/** The ground floors of block (bx, bz) (64 m grid), built on first use and cached per world. */
export function groundFloorsInBlock(world: CityWorld, bx: number, bz: number): readonly InteriorPlace[] {
  let cache = blockCache.get(world);
  if (!cache) { cache = new Map(); blockCache.set(world, cache); }
  const key = `${bx},${bz}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const places: InteriorPlace[] = [];
  for (const building of world.blocks.get(key)?.buildings ?? []) {
    const place = groundFloorPlace(world, building);
    if (place) places.push(place);
  }
  cache.set(key, places);
  return places;
}

/** Ground floors whose entrance is within `radius` of (x, z), nearest first. */
export function groundFloorsNear(world: CityWorld, x: number, z: number, radius: number): InteriorPlace[] {
  const found: { place: InteriorPlace; distance: number }[] = [];
  // Entrances sit 1.8 m out of a face, and buildings stand >= 8 m inside their block: an entrance
  // is always in its building's block.
  for (let bz = Math.floor((z - radius) / BLOCK_SIZE); bz <= Math.floor((z + radius) / BLOCK_SIZE); bz++) {
    for (let bx = Math.floor((x - radius) / BLOCK_SIZE); bx <= Math.floor((x + radius) / BLOCK_SIZE); bx++) {
      for (const place of groundFloorsInBlock(world, bx, bz)) {
        const distance = Math.hypot(place.entrance.x - x, place.entrance.z - z);
        if (distance < radius) found.push({ place, distance });
      }
    }
  }
  return found.sort((a, b) => a.distance - b.distance).map(entry => entry.place);
}

/** Every building's ground floor (tests, audits). Builds all places. */
export function groundFloorPlaces(world: CityWorld): InteriorPlace[] {
  const places: InteriorPlace[] = [];
  for (const building of world.buildings) {
    const place = groundFloorPlace(world, building);
    if (place) places.push(place);
  }
  return places;
}

// ---- Layout ---------------------------------------------------------------------------------------

const spec = (kind: FixtureKind, w: number, d: number, h: number): Spec => ({ kind, w, d, h });
// Own width (along a wall / row), own depth (out from the wall), height.
export const S = {
  cabinet: spec("cabinet", 1.0, 0.9, 1.95), pod: spec("pod", 1.3, 2.2, 2.5), locker: spec("locker", 2.4, 0.6, 2.1),
  rack: spec("rack", 2.4, 1.0, 2.5), glassCase: spec("case", 1.7, 0.8, 1.1), washer: spec("washer", 0.85, 0.8, 1.05),
  lathe: spec("lathe", 2.2, 0.9, 1.3), tank: spec("tank", 1.4, 1.4, 2.1), altar: spec("altar", 2.6, 1.0, 1.2),
  cushion: spec("cushion", 0.7, 0.7, 0.25), stall: spec("stall", 2.6, 1.6, 2.4), crate: spec("crate", 1.0, 1.0, 0.9),
  kitchenette: spec("kitchenette", 2.8, 0.7, 2.2), couch: spec("couch", 2.2, 0.9, 0.8), desk: spec("desk", 1.8, 0.8, 0.8),
  reception: spec("desk", 3.0, 1.0, 1.1), turnstile: spec("turnstile", 0.35, 1.1, 1.05), lift: spec("lift", 2.0, 0.5, 3.0),
  mailbox: spec("mailbox", 3.0, 0.4, 1.8), sculpture: spec("sculpture", 1.2, 1.2, 2.6), growrack: spec("growrack", 3.4, 0.9, 2.4),
  car: spec("car", 2.0, 4.4, 1.5), counter: spec("counter", 3.2, 1.0, 1.1), shelf: spec("shelf", 1.6, 0.6, 2.6),
  bench: spec("bench", 2.2, 0.7, 0.5), table: spec("table", 1.4, 0.9, 0.8), lowTable: spec("table", 1.2, 0.7, 0.45),
  workbench: spec("table", 2.4, 0.9, 1.0), chair: spec("seat", 0.6, 0.6, 0.5), bed: spec("bed", 1.6, 2.1, 0.6),
  planter: spec("planter", 1.0, 1.0, 1.4), vending: spec("vending", 1.2, 0.8, 2.2), candle: spec("post", 0.18, 0.18, 1.0),
  stove: spec("stove", 1.6, 0.8, 0.95), machine: spec("machine", 1.6, 1.2, 1.7),
} as const;
export const YAW: Readonly<Record<Side, number>> = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };
/** Degrees a resident at a wall faces to look into the room. */
export const INTO: Readonly<Record<Side, number>> = { back: 180, front: 0, left: -90, right: 90 };
export const OPPOSITE: Readonly<Record<Side, Side>> = { back: "front", front: "back", left: "right", right: "left" };

export class Layout {
  readonly fixtures: InteriorFixture[] = [];
  readonly groups: number[] = [];
  /** The room each fixture was placed in (-1: walls); the aisle rule only applies within a room. */
  readonly owners: number[] = [];
  /** The room being furnished. */
  room = 0;
  readonly labels = new Map<number, string>();
  readonly protect: Rect[] = [];
  readonly spots: Spot[] = [];
  readonly hw: number;
  readonly hd: number;
  readonly random: () => number;
  hasBack = false;
  /** Far end (smallest z) of the sightline lane, set by partition. */
  laneZ0 = 0;
  /** The group of the last signature piece placed. */
  lastGroup = 0;
  /** Groups the walkability pass never drops (an upper floor's lift: the only way back down). */
  readonly keep = new Set<number>();
  private next = 1;

  constructor(hw: number, hd: number, random: () => number) { this.hw = hw; this.hd = hd; this.random = random; }

  group(label?: string): number { const group = this.next++; if (label) this.labels.set(group, label); return group; }

  wall(x0: number, x1: number, z0: number, z1: number): void {
    if (x1 - x0 < 0.1 || z1 - z0 < 0.1) return;
    this.fixtures.push({ kind: "wall", x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0, height: INTERIOR_HEIGHT });
    this.groups.push(0);
    this.owners.push(-1);
  }

  /** A box fits when it is inside the room, off the protected floor, and either touches or keeps a
   * full aisle from every other group (no dead slivers a body cannot pass). */
  fits(x: number, z: number, w: number, d: number, group: number): boolean {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    if (x0 < -this.hw - EPS || x1 > this.hw + EPS || z0 < -this.hd - EPS || z1 > this.hd + EPS) return false;
    for (const gap of [x0 + this.hw, this.hw - x1, z0 + this.hd, this.hd - z1]) if (gap > 0.05 && gap < AISLE) return false;
    for (const zone of this.protect) if (x0 < zone.x1 && x1 > zone.x0 && z0 < zone.z1 && z1 > zone.z0) return false;
    for (const [index, other] of this.fixtures.entries()) {
      const gx = Math.abs(other.x - x) - (other.width + w) / 2, gz = Math.abs(other.z - z) - (other.depth + d) / 2;
      if (gx < -EPS && gz < -EPS) return false;
      if (this.groups[index] === group || (this.owners[index] !== -1 && this.owners[index] !== this.room)) continue;
      // A wall only diagonally near (past its end, e.g. a back room's divider beyond the partition)
      // leaves no sliver: doorways keep their own protect zones.
      if (other.kind === "wall" && gx > 0 && gz > 0) continue;
      const gap = Math.max(gx, gz);
      if (gap > 0.05 && gap < AISLE) return false;
    }
    return true;
  }

  put(item: Spec, x: number, z: number, yaw: number, group: number): InteriorFixture | null {
    const turned = Math.abs(Math.sin(yaw)) > 0.5;
    const width = turned ? item.d : item.w, depth = turned ? item.w : item.d;
    if (!this.fits(x, z, width, depth, group)) return null;
    const fixture: InteriorFixture = { kind: item.kind, x, z, width, depth, height: item.h, seed: Math.round(this.random() * 1000) / 1000 };
    if (yaw !== 0) fixture.yaw = yaw;
    this.fixtures.push(fixture);
    this.groups.push(group);
    this.owners.push(this.room);
    return fixture;
  }

  /** A point `out` metres from wall `side` of `r`, at `pos` along it. */
  point(r: Rect, side: Side, pos: number, out: number): { x: number; z: number } {
    switch (side) {
      case "back": return { x: pos, z: r.z0 + out };
      case "front": return { x: pos, z: r.z1 - out };
      case "left": return { x: r.x0 + out, z: pos };
      case "right": return { x: r.x1 - out, z: pos };
    }
  }
  span(r: Rect, side: Side): [number, number] { return side === "back" || side === "front" ? [r.x0, r.x1] : [r.z0, r.z1]; }

  /** Where along wall `side` a piece `w` wide sits at `t` (0..1), snapped flush into a corner
   * when it would leave a gap too narrow to walk through. */
  along(r: Rect, side: Side, w: number, t: number): number {
    const [lo, hi] = this.span(r, side);
    const pos = lo + w / 2 + (hi - lo - w) * t, low = pos - w / 2 - lo < AISLE, high = hi - pos - w / 2 < AISLE;
    if (low && (!high || t < 0.5)) return lo + w / 2;
    if (high) return hi - w / 2;
    return pos;
  }

  /** One piece against wall `side` centred `pos` along it, `inset` off it, facing into the room. */
  wallAt(r: Rect, side: Side, item: Spec, pos: number, group: number, inset = 0): InteriorFixture | null {
    const at = this.point(r, side, pos, inset + item.d / 2);
    return this.put(item, at.x, at.z, YAW[side], group);
  }

  /** One piece against wall `side`, `t` (0..1) along it, `inset` off it, facing into the room. */
  onWall(r: Rect, side: Side, item: Spec, t: number, group: number, inset = 0): InteriorFixture | null {
    const [lo, hi] = this.span(r, side);
    if (hi - lo < item.w) return null;
    return this.wallAt(r, side, item, this.along(r, side, item.w, t), group, inset);
  }

  /** Pieces in a line along wall `side` (from..to of its length, flush into a corner when the end
   * is near one), skipping spots that do not fit. */
  wallLine(r: Rect, side: Side, item: Spec, label: string, gap = 0.1, from = 0, to = 1, group = this.group(label)): number {
    const [lo, hi] = this.span(r, side);
    let start = lo + (hi - lo) * from, end = lo + (hi - lo) * to;
    if (start - lo < AISLE) start = lo;
    if (hi - end < AISLE) end = hi;
    let placed = 0;
    for (let pos = start + item.w / 2; pos + item.w / 2 <= end + EPS; pos += item.w + gap) {
      if (this.wallAt(r, side, item, pos, group)) placed++;
    }
    return placed;
  }

  /** A seat against a wall, with someone who may sit on it. */
  seatOnWall(r: Rect, side: Side, item: Spec, t: number, label: string): InteriorFixture | null {
    const seat = this.onWall(r, side, item, t, this.group(label));
    if (seat) this.spots.push({ x: seat.x, z: seat.z, facing: INTO[side], seat, staff: false });
    return seat;
  }

  /** A counter parallel to a wall with a staff walkway (and optional backing shelf) behind it. */
  serviceCounter(r: Rect, side: Side, counter: Spec, ts: readonly number[], backing: Spec | null, label: string): InteriorFixture | null {
    const [lo, hi] = this.span(r, side);
    if (hi - lo < counter.w) return null;
    const behind = (backing?.d ?? 0), inset = behind + AISLE + 0.05;
    for (const t of ts) {
      const group = this.group(label), pos = this.along(r, side, counter.w, t);
      const placed = this.wallAt(r, side, counter, pos, group, inset);
      if (!placed) continue;
      if (backing) this.wallAt(r, side, backing, pos, group);
      const at = this.point(r, side, pos, behind + (AISLE + 0.05) / 2);
      this.spots.push({ x: at.x, z: at.z, facing: INTO[side], seat: null, staff: true });
      return placed;
    }
    return null;
  }

  /** A desk against a wall with a chair in front of it (someone may sit facing the desk). */
  deskWithChair(r: Rect, side: Side, ts: readonly number[], label: string, desk: Spec = S.desk): boolean {
    const [lo, hi] = this.span(r, side);
    if (hi - lo < desk.w) return false;
    for (const t of ts) {
      const group = this.group(label), pos = this.along(r, side, desk.w, t);
      const placed = this.wallAt(r, side, desk, pos, group);
      if (!placed) continue;
      const at = this.point(r, side, pos, desk.d + 0.15 + S.chair.d / 2);
      const chair = this.put(S.chair, at.x, at.z, YAW[OPPOSITE[side]], group);
      if (chair) this.spots.push({ x: chair.x, z: chair.z, facing: INTO[OPPOSITE[side]], seat: chair, staff: true });
      return true;
    }
    return false;
  }

  /** A grid of small pieces as one group, centred on (cx, cz). */
  cluster(item: Spec, cx: number, cz: number, cols: number, rows: number, gap: number, label: string, yaw = 0, seatFacing: number | null = null): number {
    const group = this.group(label);
    const turned = Math.abs(Math.sin(yaw)) > 0.5, w = turned ? item.d : item.w, d = turned ? item.w : item.d;
    let placed = 0;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x = cx + (col - (cols - 1) / 2) * (w + gap), z = cz + (row - (rows - 1) / 2) * (d + gap);
      const fixture = this.put(item, x, z, yaw, group);
      if (!fixture) continue;
      placed++;
      if (seatFacing !== null && (row + col) % 2 === 0) this.spots.push({ x, z, facing: seatFacing, seat: fixture, staff: false });
    }
    return placed;
  }

  /** A cluster tucked into a corner of `r` ("back"/"front" + "left"/"right"). */
  corner(r: Rect, end: "back" | "front", side: "left" | "right", item: Spec, cols: number, rows: number, label: string): number {
    const w = cols * item.w + (cols - 1) * 0.1, d = rows * item.d + (rows - 1) * 0.1;
    const cx = side === "left" ? r.x0 + w / 2 : r.x1 - w / 2, cz = end === "back" ? r.z0 + d / 2 : r.z1 - d / 2;
    return this.cluster(item, cx, cz, cols, rows, 0.1, label);
  }

  /**
   * Island rows filling the middle of `r`: rows run along `axis` ("z": parallel to the side walls),
   * `margin` from the walls across them and `marginAlong` from the end walls, AISLE between rows.
   * `pair` puts pieces back to back (facing both aisles); single rows face +x / +z (alternating
   * with `alternate`).
   */
  rows(r: Rect, item: Spec, axis: "x" | "z", label: string, options: { pair?: boolean; margin?: number; marginAlong?: number; gap?: number; alternate?: boolean; maxRows?: number } = {}): number {
    const margin = options.margin ?? AISLE, marginAlong = options.marginAlong ?? AISLE, gap = options.gap ?? 0.1;
    const thick = item.d * (options.pair ? 2 : 1);
    const [acrossLo, acrossHi] = axis === "z" ? [r.x0, r.x1] : [r.z0, r.z1];
    const [alongLo, alongHi] = axis === "z" ? [r.z0, r.z1] : [r.x0, r.x1];
    const avail = acrossHi - acrossLo - 2 * margin, length = alongHi - alongLo - 2 * marginAlong;
    if (avail < thick || length < item.w) return 0;
    const count = Math.min(options.maxRows ?? 8, Math.floor((avail + AISLE) / (thick + AISLE)));
    const n = Math.floor((length + gap) / (item.w + gap));
    const first = acrossLo + margin + (avail - (count * thick + (count - 1) * AISLE)) / 2 + thick / 2;
    const start = alongLo + marginAlong + (length - (n * item.w + (n - 1) * gap)) / 2 + item.w / 2;
    const plus = axis === "z" ? Math.PI / 2 : 0, minus = axis === "z" ? -Math.PI / 2 : Math.PI;
    let placed = 0;
    for (let k = 0; k < count; k++) {
      const across = first + k * (thick + AISLE), group = this.group(label);
      const parts: readonly (readonly [number, number])[] = options.pair
        ? [[-item.d / 2, minus], [item.d / 2, plus]]
        : [[0, options.alternate && k % 2 === 1 ? minus : plus]];
      for (let i = 0; i < n; i++) {
        const along = start + i * (item.w + gap);
        for (const [offset, yaw] of parts) {
          const x = axis === "z" ? across + offset : along, z = axis === "z" ? along : across + offset;
          if (this.put(item, x, z, yaw, group)) placed++;
        }
      }
    }
    return placed;
  }

  /**
   * A kind's signature piece (or `count` of them side by side), placed FIRST so it claims the spot the
   * first view looks at: centred on the lane axis just beyond the protected walk, then further back
   * toward the back wall, then flanking the lane (so a doorway on the axis stays open). It faces the
   * street door; `staff` adds a standing spot behind it. Returns the first piece, `lastGroup` its group.
   */
  signature(r: Rect, item: Spec, label: string, options: { count?: number; gap?: number; yaws?: readonly number[]; group?: number; staff?: boolean } = {}): InteriorFixture | null {
    const count = options.count ?? 1, gap = options.gap ?? 0.06, group = options.group ?? this.group(label);
    const sign = this.random() < 0.5 ? 1 : -1;
    for (let step = 0; step <= 48; step++) {
      for (const yaw of options.yaws ?? [0]) {
        const turned = Math.abs(Math.sin(yaw)) > 0.5;
        const unitW = turned ? item.d : item.w, unitD = turned ? item.w : item.d;
        const W = count * unitW + (count - 1) * gap;
        const z = step === 48 ? r.z0 + unitD / 2 : this.laneZ0 - unitD / 2 - 0.01 - step * 0.25;
        if (z - unitD / 2 < r.z0 - EPS) continue;
        // Centred first, then outward in 0.25 m steps either side (a back-room doorway's clear zone may
        // block the obvious spots); `fits` keeps the lane and doorways clear.
        const xs = [0];
        for (let o = 0.25; o <= Math.max(0, (r.x1 - r.x0) / 2 - W / 2); o += 0.25) xs.push(sign * o, -sign * o);
        for (const x of xs) {
          if (!this.fits(x, z, W, unitD, group)) continue;
          let first: InteriorFixture | null = null;
          for (let i = 0; i < count; i++) {
            const placed = this.put(item, x - W / 2 + unitW / 2 + i * (unitW + gap), z, yaw, group);
            first = first ?? placed;
          }
          if (!first) continue;
          this.lastGroup = group;
          if (options.staff) this.spots.push({ x, z: z - unitD / 2 - 0.6, facing: 180, seat: null, staff: true });
          return first;
        }
      }
    }
    // Nowhere for the full piece (e.g. between two back-room doorways' clear zones): a narrower one.
    if (item.w > 1.3 && item.kind !== "car") return this.signature(r, { ...item, w: Math.max(1.2, item.w * 0.65) }, label, { ...options, group });
    return null;
  }

  /**
   * Rows filling both side zones of the front room: columns run along z, the first one `LANE` off the
   * axis (so the sightline lane stays clear and the aisle beside it is >= 2.8 m), the rest AISLE apart.
   * `reserve` keeps that much floor against each side wall for wall furniture placed afterwards.
   * `pair` puts pieces back to back; single rows face the lane (alternating with `alternate`).
   */
  sideRows(r: Rect, item: Spec, label: string, options: { pair?: boolean; reserve?: number; marginAlong?: number; gap?: number; alternate?: boolean; maxRows?: number } = {}): number {
    const reserve = options.reserve ?? 0, gap = options.gap ?? 0.1, marginAlong = options.marginAlong ?? AISLE;
    const thick = item.d * (options.pair ? 2 : 1);
    const alongLo = r.z0 + marginAlong, length = r.z1 - alongLo;
    if (length < item.w) return 0;
    const n = Math.floor((length + gap) / (item.w + gap));
    let placed = 0;
    for (const sign of [-1, 1]) {
      const avail = (sign < 0 ? -r.x0 : r.x1) - LANE - reserve;
      const count = Math.min(options.maxRows ?? 4, Math.floor(avail / (thick + AISLE)));
      for (let k = 0; k < count; k++) {
        const group = this.group(label), inner = LANE + k * (thick + AISLE);
        const toward = (-sign * Math.PI) / 2, away = (sign * Math.PI) / 2;
        const parts: readonly (readonly [number, number])[] = options.pair
          ? [[inner + item.d / 2, toward], [inner + item.d * 1.5, away]]
          : [[inner + item.d / 2, options.alternate && k % 2 === 1 ? away : toward]];
        for (let i = 0; i < n; i++) {
          const z = alongLo + item.w / 2 + i * (item.w + gap);
          for (const [out, yaw] of parts) if (this.put(item, sign * out, z, yaw, group)) placed++;
        }
      }
    }
    return placed;
  }

  /** The first candidate spot where `item` fits, as its own group. */
  firstFit(item: Spec, candidates: readonly (readonly [number, number, number])[], label: string): InteriorFixture | null {
    for (const [x, z, yaw] of candidates) {
      const group = this.group(label);
      const placed = this.put(item, x, z, yaw, group);
      if (placed) return placed;
    }
    return null;
  }
}

// ---- Rooms ----------------------------------------------------------------------------------------

/** Walls and rooms: a front room, then maybe one or two back rooms and a side room (1-4 rooms). */
function partition(layout: Layout, kind: GroundFloorKind, width: number, depth: number): RoomInfo[] {
  const { hw, hd, random } = layout;
  const labels = ROOM_LABELS[kind];
  const front: Rect = { x0: -hw, x1: hw, z0: -hd, z1: hd };
  // The visitor's spawn and the exit strip stay clear.
  layout.protect.push({ x0: -2.8, x1: 2.8, z0: hd - 5.2, z1: hd + 1 });
  let backWall: number | null = null;
  if (depth >= 13.5 && random() < 0.85) {
    // Never nearer the spawn (hd - 2.2) than 6.5 m: the first view and walk are open.
    backWall = Math.min(-hd + clamp(depth * (0.3 + random() * 0.12), 4.8, 8), hd - 9.7); // >= 7.5 m from the spawn: room for the lane (6.2 m) and a signature piece flush on the wall
    front.z0 = backWall + WALL / 2;
  }
  // The sightline: a clear lane straight ahead of the spawn, 6 m long (to the back wall, or to the
  // last 3.2 m of a room with none, so a back-wall counter still fits).
  layout.laneZ0 = Math.max(backWall === null ? -hd + 3.2 : backWall + WALL / 2, hd - 8.45); // the walk test: 5.4 m ahead of the spawn plus a body radius
  layout.protect.push({ x0: -1.4, x1: 1.4, z0: layout.laneZ0, z1: hd + 1 }); // 6 m ahead of the spawn plus a body radius
  const sideWidth = clamp(width * 0.3, 4.4, 6);
  let side: { s: 1 | -1; x: number; z0: number; z1: number } | null = null;
  if (width >= 15.5 && hw - sideWidth >= 3.2 && random() < 0.5) {
    const z0 = backWall === null ? -hd : backWall + WALL / 2, z1 = hd - 4.6;
    if (z1 - WALL / 2 - z0 >= 4.6) {
      const s = random() < 0.5 ? -1 : 1;
      side = { s, x: s * (hw - sideWidth), z0, z1 };
      if (s > 0) front.x1 = side.x - WALL / 2; else front.x0 = side.x + WALL / 2;
    }
  }
  const rooms: RoomInfo[] = [{ rect: front, role: "front", order: 0, label: labels[0] }];
  if (backWall !== null) {
    layout.hasBack = true;
    const z1 = backWall - WALL / 2;
    const split = width >= 15 && random() < 0.6;
    const at = (random() - 0.5) * width * 0.2;
    const backs: Rect[] = split
      ? [{ x0: -hw, x1: at - WALL / 2, z0: -hd, z1 }, { x0: at + WALL / 2, x1: hw, z0: -hd, z1 }]
      : [{ x0: -hw, x1: hw, z0: -hd, z1 }];
    if (split) layout.wall(at - WALL / 2, at + WALL / 2, -hd, z1);
    const gaps = backs.map(r => {
      const lo = Math.max(r.x0, front.x0) + DOOR / 2 + 0.3, hi = Math.min(r.x1, front.x1) - DOOR / 2 - 0.3;
      const roll = random();
      // A single back room is entered straight ahead of the spawn, so the view runs through its door.
      return lo <= hi ? (split ? lo + (hi - lo) * (0.25 + roll * 0.5) : clamp(0, lo, hi)) : (r.x0 + r.x1) / 2;
    }).sort((a, b) => a - b);
    let x = -hw;
    for (const gap of gaps) {
      layout.wall(x, gap - DOOR / 2, backWall - WALL / 2, backWall + WALL / 2);
      x = gap + DOOR / 2;
      layout.protect.push({ x0: gap - DOOR / 2 - 0.2, x1: gap + DOOR / 2 + 0.2, z0: backWall - AISLE, z1: backWall + AISLE });
    }
    layout.wall(x, hw, backWall - WALL / 2, backWall + WALL / 2);
    backs.forEach((rect, order) => rooms.push({ rect, role: "back", order, label: labels[1 + order] }));
  }
  if (side) {
    const { s, x, z0, z1 } = side, gap = (z0 + z1 - WALL / 2) / 2;
    layout.wall(x - WALL / 2, x + WALL / 2, z0, gap - DOOR / 2);
    layout.wall(x - WALL / 2, x + WALL / 2, gap + DOOR / 2, z1 - WALL / 2);
    layout.wall(s > 0 ? x - WALL / 2 : -hw, s > 0 ? hw : x + WALL / 2, z1 - WALL / 2, z1 + WALL / 2);
    layout.protect.push({ x0: x - AISLE, x1: x + AISLE, z0: gap - DOOR / 2 - 0.2, z1: gap + DOOR / 2 + 0.2 });
    rooms.push({ rect: { x0: s > 0 ? x + WALL / 2 : -hw, x1: s > 0 ? hw : x - WALL / 2, z0, z1: z1 - WALL / 2 }, role: "side", order: 0, label: labels[3] });
  }
  return rooms;
}

// ---- Furniture ------------------------------------------------------------------------------------

function furnish(layout: Layout, kind: GroundFloorKind, room: RoomInfo): void {
  const L = layout, r = room.rect, random = L.random;
  const rw = r.x1 - r.x0, rd = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const lr: "left" | "right" = random() < 0.5 ? "left" : "right", rl: "left" | "right" = lr === "left" ? "right" : "left";
  const front = room.role === "front", back = room.role === "back", side = room.role === "side";
  const storeRoom = () => {
    L.wallLine(r, "back", S.shelf, "SHELVES", 0.1, 0.05, 0.75);
    L.corner(r, "back", lr, S.crate, 2, 1, "CRATES");
    L.corner(r, "front", rl, S.crate, 1, 2, "CRATES");
  };
  const office = (label: string) => {
    L.deskWithChair(r, "back", [0.3, 0.7, 0.5], label);
    L.onWall(r, lr, S.shelf, 0.5, L.group("SHELF"));
    L.onWall(r, rl, S.vending, 0.2, L.group("VEND"));
  };
  switch (kind) {
    case "lobby":
      if (front) {
        L.signature(r, S.reception, "DESK", { staff: true });
        if (!L.hasBack) for (const t of [0.2, 0.8]) L.onWall(r, "back", S.lift, t, L.group("LIFT"));
        else L.onWall(r, "back", S.lift, random() < 0.5 ? 0.1 : 0.9, L.group("LIFT"));
        L.wallLine(r, lr, S.mailbox, "MAIL", 0.1, 0.1, 0.9);
        L.seatOnWall(r, rl, S.bench, 0.5, "BENCH");
        L.onWall(r, rl, S.planter, 1, L.group());
        L.onWall(r, rl, S.planter, 0, L.group());
      } else if (back && room.order === 0) { L.wallLine(r, "back", S.mailbox, "MAIL", 0.1, 0, 0.6); L.corner(r, "back", rl, S.crate, 1, 2, "STORE"); }
      else office("SUPER");
      break;
    case "capsule-hotel":
      if (front) {
        L.signature(r, S.reception, "RECEPTION", { staff: true });
        L.wallLine(r, rl, S.pod, "PODS", 0.05);
        L.wallLine(r, lr, S.locker, "LOCKERS", 0.05, 0, 0.3);
        L.wallLine(r, lr, S.pod, "PODS", 0.05, 0.3, 1);
      } else if (back) {
        const group = L.group("PODS");
        for (const wall of ["left", "back", "right"] as const) L.wallLine(r, wall, S.pod, "PODS", 0.05, 0, 1, group);
      } else { L.wallLine(r, "back", S.locker, "LOCKERS", 0.05); L.seatOnWall(r, side && r.x0 < 0 ? "left" : "right", S.bench, 0.6, "BENCH"); }
      break;
    case "corp-lobby":
      if (front) {
        const desk = L.signature(r, S.reception, "RECEPTION", { staff: true });
        if (desk) {
          // The sculpture stands beside the desk, outside the lane.
          const sign = desk.x >= 0 ? 1 : -1;
          for (const s of [sign, -sign]) if (L.put(S.sculpture, desk.x + s * (desk.width / 2 + 0.9), desk.z, 0, L.lastGroup)) break;
        }
        if (!L.hasBack) for (const t of [0, 1]) L.onWall(r, "back", S.lift, t, L.group("LIFT"));
        if (rd >= 9) {
          const group = L.group("GATES"), pitch = S.turnstile.w + 2.3, n = Math.floor(rw / pitch), z = r.z0 + rd * 0.5;
          for (let i = 0; i < n; i++) L.put(S.turnstile, r.x0 + (rw - (n - 1) * pitch) / 2 + i * pitch, z, 0, group);
        }
        L.seatOnWall(r, lr, S.couch, 0.7, "COUCH");
        L.onWall(r, lr, S.planter, 1, L.group());
        L.onWall(r, rl, S.planter, 0.6, L.group());
        if (!desk) L.firstFit(S.sculpture, [[cx - rw * 0.22, r.z0 + rd * 0.72, 0], [cx + rw * 0.22, r.z0 + rd * 0.72, 0], [cx, r.z0 + rd * 0.3, 0]], "ART");
      } else if (back && room.order === 0) {
        for (const t of [0.2, 0.8]) L.onWall(r, "back", S.lift, t, L.group("LIFT"));
        L.seatOnWall(r, lr, S.bench, 0.5, "BENCH");
      } else if (back) { L.deskWithChair(r, "back", [0.5, 0.2, 0.8], "SECURITY"); L.wallLine(r, lr, S.locker, "LOCKERS", 0.05, 0, 0.7); }
      else { L.seatOnWall(r, r.x0 < 0 ? "left" : "right", S.couch, 0.5, "COUCH"); L.onWall(r, "back", S.planter, 0.5, L.group()); }
      break;
    case "arcade":
      if (front || side) {
        if (front) L.signature(r, S.counter, "PRIZES", { staff: true });
        L.wallLine(r, "left", S.cabinet, "GAMES", 0.12);
        L.wallLine(r, "right", S.cabinet, "GAMES", 0.12);
        if (front) L.sideRows(r, S.cabinet, "GAMES", { pair: rw >= 12.5, reserve: S.cabinet.d });
      } else if (room.order === 0) { L.serviceCounter(r, "back", S.counter, [0.5, 0.3, 0.7], S.shelf, "PRIZES"); L.onWall(r, lr, S.vending, 0.2, L.group("VEND")); }
      else { L.corner(r, "back", lr, S.crate, 2, 2, "CRATES"); L.firstFit(S.table, [[cx, cz, 0]], "TABLE"); }
      break;
    case "pawnshop":
      if (front) {
        L.signature(r, S.counter, "CAGE", { staff: true });
        L.wallLine(r, "left", S.shelf, "SHELVES", 0.1, 0.05, 0.95);
        L.wallLine(r, "right", S.shelf, "SHELVES", 0.1, 0.05, 0.95);
        L.sideRows(r, S.glassCase, "CASES", { reserve: S.shelf.d, gap: 0.08, maxRows: 2, alternate: true });
      } else if (back && room.order === 1) { L.serviceCounter(r, "back", S.counter, [0.5, 0.3, 0.7], S.shelf, "CAGE"); L.wallLine(r, lr, S.glassCase, "CASES", 0.08, 0, 0.6); }
      else if (back) storeRoom();
      else { L.deskWithChair(r, "back", [0.5], "REPAIRS", S.workbench); L.wallLine(r, r.x0 < 0 ? "left" : "right", S.shelf, "SHELVES", 0.1, 0.1, 0.6); }
      break;
    case "machine-shop":
      if (front) {
        L.signature(r, S.lathe, "LATHES", { count: 2, gap: 0.5 });
        L.wallLine(r, lr, S.workbench, "BENCH", 0.2, 0.1, 0.9);
        L.wallLine(r, rl, S.shelf, "TOOLS", 0.1, 0.1, 0.7);
        L.corner(r, "back", rl, S.crate, 2, 1, "CRATES");
        L.sideRows(r, S.lathe, "LATHES", { reserve: S.workbench.d, gap: 0.6, alternate: true });
      } else if (back && room.order === 0) storeRoom();
      else if (back) { L.wallLine(r, "back", S.workbench, "BENCH", 0.2, 0.05, 0.6); L.onWall(r, lr, S.machine, 0.4, L.group("PRESS")); }
      else office("OFFICE");
      break;
    case "server-hall":
      if (front) {
        L.signature(r, S.desk, "CONSOLE", { staff: true });
        L.sideRows(r, S.rack, "RACKS", { pair: rw >= 13.5, reserve: S.rack.d, gap: 0.05 });
        L.wallLine(r, "left", S.rack, "RACKS", 0.05);
        L.wallLine(r, "right", S.rack, "RACKS", 0.05);
        L.wallLine(r, "back", S.rack, "RACKS", 0.05);
      } else if (back) L.rows(r, S.rack, "z", "RACKS", { pair: rw >= 9, margin: AISLE, marginAlong: AISLE, gap: 0.05, alternate: true });
      else L.wallLine(r, r.x0 < 0 ? "left" : "right", S.tank, "COOLANT", 0.3);
      break;
    case "shrine": {
      const altarWall: Side = side ? (r.x0 < 0 ? "left" : "right") : "back";
      if (front || (back && room.order === 1) || side) {
        const big = front ? S.altar : spec("altar", 1.8, 0.8, 1.0);
        const group = L.group(front ? "ALTAR" : "SHRINE");
        let altar: InteriorFixture | null = front ? L.signature(r, big, "ALTAR", { group }) : null;
        if (altar) {
          // Framed at the end of the first view: candles beside the altar, cushions in two groups either side of the lane.
          for (const s of [-1, 1]) L.put(S.candle, altar.x + s * (big.w / 2 + 0.35), altar.z, 0, group);
          const rowsOf = 2, zc = altar.z + big.d / 2 + AISLE + 0.1 + (rowsOf * S.cushion.d + (rowsOf - 1) * 0.3) / 2;
          for (const s of [-1, 1]) L.cluster(S.cushion, s * (LANE + 0.35 + 0.5), zc, 2, rowsOf, 0.3, "CUSHIONS", 0, headingTo(0, -1));
          L.onWall(r, "left", S.planter, 0.9, L.group());
          L.onWall(r, "right", S.planter, 0.9, L.group());
          break;
        }
        for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) if ((altar = L.onWall(r, altarWall, big, t, group))) break;
        if (altar) {
          // Candles flank the altar against the wall; cushions face it an aisle away.
          const along = altarWall === "back" ? altar.x : altar.z, into = altarWall === "back" ? [0, 1] : altarWall === "left" ? [1, 0] : [-1, 0];
          for (const s of [-1, 1]) {
            const at = L.point(r, altarWall, along + s * (big.w / 2 + 0.35), S.candle.d / 2);
            L.put(S.candle, at.x, at.z, 0, group);
          }
          const cols = front ? (rw > 12 ? 4 : 3) : 2, rows = front ? 2 : 1;
          const at = L.point(r, altarWall, along, big.d + AISLE + 0.1 + (rows * S.cushion.d + (rows - 1) * 0.3) / 2);
          L.cluster(S.cushion, at.x, at.z, altarWall === "back" ? cols : rows, altarWall === "back" ? rows : cols, 0.3, "CUSHIONS", 0, headingTo(-into[0], -into[1]));
        }
        if (front) { L.onWall(r, "left", S.planter, 0.9, L.group()); L.onWall(r, "right", S.planter, 0.9, L.group()); }
      } else { L.wallLine(r, "back", S.shelf, "SHELVES", 0.1, 0.1, 0.7); L.seatOnWall(r, lr, S.bench, 0.5, "BENCH"); }
      break;
    }
    case "hydroponics":
      if (front) {
        const rack = L.signature(r, S.growrack, "GROW");
        if (rack) {
          // A reservoir tank beside the grow rack, outside the lane.
          const sign = rack.x >= 0 ? 1 : -1;
          for (const s of [sign, -sign]) if (L.put(S.tank, rack.x + s * (rack.width / 2 + 0.8), rack.z, 0, L.lastGroup)) break;
        }
        if (!L.hasBack) L.wallLine(r, "back", S.tank, "TANKS", 0.3, 0.1, 0.9);
        L.wallLine(r, lr, S.workbench, "POTTING", 0.2, 0.2, 0.8);
        L.sideRows(r, S.growrack, "GROW", { reserve: S.workbench.d, marginAlong: L.hasBack ? AISLE : S.tank.d + AISLE, gap: 0.1, alternate: true });
      } else if (back && room.order === 0) { L.wallLine(r, "back", S.planter, "NURSERY", 0.2); L.rows(r, S.growrack, "x", "GROW", { margin: S.planter.d + AISLE, maxRows: 1 }); }
      else if (back) { L.wallLine(r, "back", S.tank, "TANKS", 0.3); L.onWall(r, lr, S.tank, 0.3, L.group("TANK")); }
      else { L.wallLine(r, "back", S.shelf, "SEEDS", 0.1); L.firstFit(S.table, [[cx, cz + 0.5, 0]], "TABLE"); }
      break;
    case "laundromat":
      if (front || (back && room.order === 0)) {
        if (front) L.signature(r, S.washer, "WASHERS", { count: 4 });
        if (front) for (const t of [0, 1]) L.seatOnWall(r, "front", S.bench, t, "BENCH");
        L.wallLine(r, "left", S.washer, front ? "WASHERS" : "DRYERS", 0.06, 0, front ? 1 : 0.9);
        L.wallLine(r, "right", S.washer, front ? "WASHERS" : "DRYERS", 0.06, 0, front ? 1 : 0.9);
        if (back) L.wallLine(r, "back", S.washer, "DRYERS", 0.06, 0.2, 0.8);
        if (front) {
          L.onWall(r, "back", S.vending, L.hasBack ? 0 : 0.5, L.group("SOAP"));
          L.sideRows(r, S.washer, "WASHERS", { pair: rw >= 12, reserve: S.washer.d, gap: 0.06 });
        }
      } else if (back) storeRoom();
      else { L.firstFit(S.workbench, [[cx, cz, 0], [cx, cz, Math.PI / 2]], "FOLDING"); L.seatOnWall(r, "back", S.bench, 0.5, "BENCH"); }
      break;
    case "market-hall":
      if (front || side) {
        if (front) L.signature(r, S.stall, "STALLS", { staff: true });
        L.wallLine(r, "left", S.stall, "STALLS", 0.3);
        L.wallLine(r, "right", S.stall, "STALLS", 0.3);
        if (front) L.sideRows(r, S.stall, "STALLS", { pair: rw >= 17.5, reserve: S.stall.d, gap: 0.3 });
      } else if (room.order === 0) {
        L.wallLine(r, "back", S.stove, "STOVES", 0.2, 0.05, 0.55);
        L.onWall(r, "back", S.counter, 0.95, L.group("PREP"));
        L.onWall(r, lr, S.shelf, 0.3, L.group("SHELF"));
      } else storeRoom();
      break;
    case "chandlery":
      if (front) {
        L.wallLine(r, "left", S.shelf, "SHELVES", 0.1, 0.05, 0.95);
        L.wallLine(r, "right", S.shelf, "SHELVES", 0.1, 0.05, 0.95);
        L.signature(r, S.counter, "COUNTER", { staff: true });
        const z = r.z0 + rd * 0.55;
        L.cluster(S.crate, cx - rw * 0.18, z, 2, 2, 0.1, "ROPE");
        L.cluster(S.crate, cx + rw * 0.18, z, 1, 2, 0.1, "LAMPS");
      } else if (back) {
        L.rows(r, S.crate, "x", "CRATES", { margin: AISLE, marginAlong: AISLE, gap: 0.1, maxRows: 1 });
        L.wallLine(r, "back", S.shelf, "STORES", 0.1, 0, 0.5);
      } else { L.corner(r, "back", r.x0 < 0 ? "left" : "right", S.crate, 2, 2, "ROPE"); L.wallLine(r, r.x0 < 0 ? "left" : "right", S.shelf, "SHELVES", 0.1, 0.5, 1); }
      break;
    case "apartment":
      if (front) {
        const kitchen = L.signature(r, S.kitchenette, "KITCHEN");
        const couch = L.seatOnWall(r, lr, S.couch, 0.55, "COUCH");
        if (couch) { const out = lr === "left" ? 1 : -1; L.put(S.lowTable, couch.x + out * (couch.width / 2 + 0.6 + S.lowTable.d / 2), couch.z, YAW[lr], L.groups[L.groups.length - 1]); }
        if (!kitchen) L.onWall(r, "back", S.kitchenette, lr === "left" ? 0.95 : 0.05, L.group("KITCHEN"));
        L.onWall(r, rl, S.shelf, 0.6, L.group("SHELF"));
        if (!L.hasBack) L.onWall(r, rl, S.bed, 0.05, L.group("BED"));
        L.onWall(r, rl, S.planter, 1, L.group());
      } else if (back && room.order === 0) { L.onWall(r, "back", S.bed, random() < 0.5 ? 0.15 : 0.85, L.group("BED")); L.onWall(r, lr, S.shelf, 0.4, L.group("SHELF")); }
      else if (back) { L.deskWithChair(r, "back", [0.5, 0.3], "DESK"); L.onWall(r, lr, S.shelf, 0.5, L.group("BOOKS")); }
      else { L.onWall(r, r.x0 < 0 ? "left" : "right", S.kitchenette, 0.5, L.group("KITCHEN")); L.firstFit(S.table, [[cx, r.z0 + rd * 0.3, 0]], "TABLE"); }
      break;
    case "garage":
      if (front) {
        const limit = L.hd - 5.2 - S.car.d / 2 - 0.1, mid = Math.min((r.z0 + L.hd - 5.2) / 2, limit);
        // Nose-on at the end of the lane in a deep room, otherwise broadside across it.
        const car = L.signature(r, S.car, "CAR", { yaws: [0, Math.PI / 2, -Math.PI / 2] }) ?? L.firstFit(S.car, [[cx, mid, 0], [cx, mid, Math.PI], [cx - rw * 0.2, cz, Math.PI / 2], [cx + rw * 0.2, cz, -Math.PI / 2]], "CAR");
        if (car) L.spots.push({ x: car.x + car.width / 2 + 1.1, z: car.z, facing: 90, seat: null, staff: true });
        L.wallLine(r, lr, S.shelf, "TOOLS", 0.05, 0.05, 0.75);
        L.onWall(r, rl, S.workbench, 0.3, L.group("BENCH"));
        L.corner(r, "back", rl, S.crate, 2, 1, "PARTS");
        L.onWall(r, rl, S.machine, 0.9, L.group("COMPRESSOR"));
      } else if (back && room.order === 0) storeRoom();
      else if (back) office("OFFICE");
      else { L.onWall(r, "back", S.machine, 0.5, L.group("SPRAY")); L.corner(r, "front", r.x0 < 0 ? "left" : "right", S.crate, 1, 2, "PAINT"); }
      break;
  }
}

// ---- Walkability ----------------------------------------------------------------------------------

interface Grid { nx: number; nz: number; hw: number; hd: number; reach: Uint8Array }

/** Cells (CELL m) whose centre a body can stand on (the same box test as CityInteriors.canOccupy),
 * flood-filled from the spawn. */
function reachable(hw: number, hd: number, fixtures: readonly InteriorFixture[]): Grid | null {
  const nx = Math.floor((2 * hw) / CELL), nz = Math.floor((2 * hd) / CELL), r = PLAYER_RADIUS;
  const blocked = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = -hw + (i + 0.5) * CELL, z = -hd + (j + 0.5) * CELL;
    if (Math.abs(x) > hw - r || Math.abs(z) > hd - r) blocked[j * nx + i] = 1;
  }
  for (const f of fixtures) {
    const i0 = Math.max(0, Math.floor((f.x - f.width / 2 - r + hw) / CELL - 0.5)), i1 = Math.min(nx - 1, Math.ceil((f.x + f.width / 2 + r + hw) / CELL - 0.5));
    const j0 = Math.max(0, Math.floor((f.z - f.depth / 2 - r + hd) / CELL - 0.5)), j1 = Math.min(nz - 1, Math.ceil((f.z + f.depth / 2 + r + hd) / CELL - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -hw + (i + 0.5) * CELL, z = -hd + (j + 0.5) * CELL;
      if (Math.abs(x - f.x) < f.width / 2 + r && Math.abs(z - f.z) < f.depth / 2 + r) blocked[j * nx + i] = 1;
    }
  }
  const si = Math.floor(hw / CELL), sj = Math.floor((2 * hd - 2.2) / CELL);
  if (si < 0 || si >= nx || sj < 0 || sj >= nz || blocked[sj * nx + si]) return null;
  const reach = new Uint8Array(nx * nz), queue = new Int32Array(nx * nz);
  let head = 0, tail = 0;
  reach[sj * nx + si] = 1; queue[tail++] = sj * nx + si;
  while (head < tail) {
    const cell = queue[head++], i = cell % nx, j = (cell - i) / nx;
    const visit = (next: number) => { if (!blocked[next] && !reach[next]) { reach[next] = 1; queue[tail++] = next; } };
    if (i > 0) visit(cell - 1);
    if (i < nx - 1) visit(cell + 1);
    if (j > 0) visit(cell - nx);
    if (j < nz - 1) visit(cell + nx);
  }
  return { nx, nz, hw, hd, reach };
}

function reachAt(grid: Grid, x: number, z: number): boolean {
  const i = Math.floor((x + grid.hw) / CELL), j = Math.floor((z + grid.hd) / CELL);
  return i >= 0 && i < grid.nx && j >= 0 && j < grid.nz && grid.reach[j * grid.nx + i] === 1;
}

function roomReached(grid: Grid, rect: Rect): boolean {
  const i0 = Math.max(0, Math.ceil((rect.x0 + grid.hw) / CELL - 0.5)), i1 = Math.min(grid.nx - 1, Math.floor((rect.x1 + grid.hw) / CELL - 0.5));
  const j0 = Math.max(0, Math.ceil((rect.z0 + grid.hd) / CELL - 0.5)), j1 = Math.min(grid.nz - 1, Math.floor((rect.z1 + grid.hd) / CELL - 0.5));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (grid.reach[j * grid.nx + i]) return true;
  return false;
}

/** True when (x, z) is clear of every fixture by a body's radius (CityInteriors.canOccupy's test). */
function standable(hw: number, hd: number, fixtures: readonly InteriorFixture[], x: number, z: number): boolean {
  const r = PLAYER_RADIUS;
  if (Math.abs(x) > hw - r || Math.abs(z) > hd - r) return false;
  return !fixtures.some(f => Math.abs(x - f.x) < f.width / 2 + r && Math.abs(z - f.z) < f.depth / 2 + r);
}

// ---- Plans ----------------------------------------------------------------------------------------

const planCache = new WeakMap<InteriorPlace, GroundFloorPlan>();
const labelMap = new WeakMap<InteriorFixture, { text: string; x: number; z: number }>();

/** The ground floor's layout (cached per place). Only meaningful for ground-floor kinds. */
export function groundFloorPlan(place: InteriorPlace): GroundFloorPlan {
  if (place.floor) return upperFloorPlan(place); // Upper floors: their own plans (upper-floors.ts, cached there)
  const cached = planCache.get(place);
  if (cached) return cached;
  const plan = buildPlan(place);
  planCache.set(place, plan);
  return plan;
}

/** Floorplan label for a ground-floor fixture (one per group of pieces, at the group's centre). */
export function groundFixtureLabel(item: InteriorFixture): { text: string; x: number; z: number } | null {
  return labelMap.get(item) ?? null;
}

/** A tall building's lift (upper-floors.ts liftStops) on a ground floor whose kind placed none: the
 * front room's back wall near a corner, else a side wall. Added last, so it is the first piece the
 * walkability pass drops if it ever blocked the way. */
function addLift(layout: Layout, rooms: readonly RoomInfo[]): void {
  if (layout.fixtures.some(item => item.kind === "lift")) return;
  const front = rooms.find(room => room.role === "front");
  if (!front) return;
  layout.room = rooms.indexOf(front);
  const sides: readonly (readonly [Side, number])[] = [["back", 0.05], ["back", 0.95], ["back", 0.5], ["left", 0.15], ["right", 0.15], ["left", 0.5], ["right", 0.5]];
  for (const [side, t] of sides) if (layout.onWall(front.rect, side, S.lift, t, layout.group("LIFT"))) return;
}

/** The ground floor's exit zone (CityInteriors.atExit): |x| < 2 and z within 3.6 m of the front wall. */
const EXIT_HALF = 2, EXIT_DEPTH = 3.6;
function inExitStrip(hd: number, x: number, z: number): boolean {
  return Math.abs(x) < EXIT_HALF + 0.3 && z > hd - EXIT_DEPTH - 0.3;
}

/** True when a ground floor's lift can be ridden: some lift whose landing is free, reached from the
 * spawn and outside the exit zone (where interact() would leave instead). */
function liftRideable(place: InteriorPlace, plan: GroundFloorPlan): boolean {
  const hw = place.width / 2, hd = place.depth / 2, grid = reachable(hw, hd, plan.fixtures);
  if (!grid) return false;
  return plan.fixtures.some(item => {
    if (item.kind !== "lift") return false;
    const l = liftLanding(item);
    return !inExitStrip(hd, l.x, l.z) && standable(hw, hd, plan.fixtures, l.x, l.z) && reachAt(grid, l.x, l.z);
  });
}

/** A tall building's lift, placed before any furniture: the front room's walls first (then any room's),
 * against a wall with a clear standing spot (liftLanding) that is then protected from furniture. A
 * strict pass keeps the usual aisles; a relaxed pass only needs the box and its landing to be free. */
function placeLift(layout: Layout, rooms: readonly RoomInfo[]): void {
  const order = [...rooms.keys()].sort((a, b) => (rooms[a].role === "front" ? 0 : 1) - (rooms[b].role === "front" ? 0 : 1) || a - b);
  // Never the front wall: its landing sits in the exit strip, where E means "leave", not "ride".
  const sides: readonly Side[] = ["back", "left", "right"];
  const spots = [0.05, 0.95, 0.5, 0.25, 0.75];
  const margin = PLAYER_RADIUS + 0.1;
  const landingFree = (item: InteriorFixture, rect: Rect): boolean => {
    const l = liftLanding(item);
    if (inExitStrip(layout.hd, l.x, l.z) || (Math.abs(item.x) - item.width / 2 < EXIT_HALF + 0.3 && item.z + item.depth / 2 > layout.hd - EXIT_DEPTH - 0.3)) return false;
    if (l.x - margin < rect.x0 || l.x + margin > rect.x1 || l.z - margin < rect.z0 || l.z + margin > rect.z1) return false;
    return !layout.fixtures.some(other => other !== item && Math.abs(l.x - other.x) < other.width / 2 + margin && Math.abs(l.z - other.z) < other.depth / 2 + margin);
  };
  const accept = (item: InteriorFixture): void => {
    const l = liftLanding(item);
    layout.protect.push({ x0: l.x - 0.9, x1: l.x + 0.9, z0: l.z - 0.9, z1: l.z + 0.9 });
  };
  for (const strict of [true, false]) {
    for (const index of order) {
      const rect = rooms[index].rect;
      layout.room = index;
      for (const side of sides) {
        for (const t of spots) {
          const [lo, hi] = layout.span(rect, side);
          if (hi - lo < S.lift.w) continue;
          const pos = layout.along(rect, side, S.lift.w, t), at = layout.point(rect, side, pos, S.lift.d / 2), yaw = YAW[side];
          const turned = Math.abs(Math.sin(yaw)) > 0.5, width = turned ? S.lift.d : S.lift.w, depth = turned ? S.lift.w : S.lift.d;
          let item: InteriorFixture | null = null;
          const group = layout.group("LIFT");
          if (strict) item = layout.put(S.lift, at.x, at.z, yaw, group);
          else if (!layout.protect.some(zone => at.x - width / 2 < zone.x1 && at.x + width / 2 > zone.x0 && at.z - depth / 2 < zone.z1 && at.z + depth / 2 > zone.z0)
            && at.x - width / 2 >= -layout.hw - EPS && at.x + width / 2 <= layout.hw + EPS && at.z - depth / 2 >= -layout.hd - EPS && at.z + depth / 2 <= layout.hd + EPS
            && !layout.fixtures.some(other => Math.abs(other.x - at.x) < (other.width + width) / 2 - EPS && Math.abs(other.z - at.z) < (other.depth + depth) / 2 - EPS)) {
            item = { kind: S.lift.kind, x: at.x, z: at.z, width, depth, height: S.lift.h, seed: Math.round(layout.random() * 1000) / 1000 };
            if (yaw !== 0) item.yaw = yaw;
            layout.fixtures.push(item); layout.groups.push(group); layout.owners.push(index);
          }
          if (!item) continue;
          if (landingFree(item, rect)) { accept(item); return; }
          const at2 = layout.fixtures.indexOf(item);
          layout.fixtures.splice(at2, 1); layout.groups.splice(at2, 1); layout.owners.splice(at2, 1);
        }
      }
    }
  }
}

function buildPlan(place: InteriorPlace): GroundFloorPlan {
  const kind: GroundFloorKind = (GROUND_FLOOR_KINDS as readonly string[]).includes(place.kind) ? place.kind as GroundFloorKind : "lobby";
  let infos: RoomInfo[] = [];
  const plan = planFromRecipe(place, {
    seed: seedOf(place.building, 37),
    partition: layout => (infos = partition(layout, kind, place.width, place.depth)),
    early: place.stops && place.stops.length > 1 ? placeLift : undefined,
    furnish: (layout, room) => furnish(layout, kind, room),
    finish: place.stops && place.stops.length > 1 ? addLift : undefined,
    lines: LINES[kind], light: LIGHTS[kind], label: ROOM_LABELS[kind][0],
  });
  return lockBackRoom(place, kind, plan, infos);
}

// ---- Locked back rooms ----------------------------------------------------------------------------

/** Kinds whose back rooms may be locked (hackable), and how hard the lock is. */
export const LOCKABLE: Readonly<Partial<Record<GroundFloorKind, GroundLock["tier"]>>> = {
  "corp-lobby": "hard", "server-hall": "hard", "pawnshop": "medium", "machine-shop": "medium", "capsule-hotel": "easy", "garage": "easy",
};
/** Chance a fitting building with a lockable back room has one locked (about a fifth of fitting buildings in all). */
export const LOCK_CHANCE = 0.3;

/** Locks one back room of `plan` (deterministic per building): a `gate` fixture fills its doorway gap in
 * the back wall. Skipped (plan returned as is) when the kind does not fit, there is no back room, the
 * room holds the lift, or closing it would leave the plan without a free resident. Nothing else changes:
 * the doorway only ever led into that one room, so every other room, the spawn, the exit strip and the
 * lift stay reachable with the gate shut. Residents inside the room move out of the plan. */
/** Locked rooms: where the "Hack the lock" terminal stands (in front of the shutter, reachable with it
 * shut) and where the stash sits (inside the room, reachable once the shutter is gone). Shared by
 * lockBackRoom (no lock without both) and locked-rooms.ts, so they always agree. Room space. */
export function lockSpots(hw: number, hd: number, fixtures: readonly InteriorFixture[], gate: InteriorFixture, room: { x: number; z: number; width: number; depth: number }): { lock: { x: number; z: number }; stash: { x: number; z: number } } | null {
  const r = PLAYER_RADIUS;
  const standable = (x: number, z: number) => Math.abs(x) <= hw - r - 0.1 && Math.abs(z) <= hd - r - 0.1
    && !fixtures.some(item => Math.abs(x - item.x) < item.width / 2 + r + 0.1 && Math.abs(z - item.z) < item.depth / 2 + r + 0.1);
  const shut = reachable(hw, hd, fixtures), open = reachable(hw, hd, fixtures.filter(item => item !== gate));
  if (!shut || !open) return null;
  const frontZ = gate.z + gate.depth / 2 + r + 0.45;
  let lock: { x: number; z: number } | null = null;
  for (let dz = 0; dz <= 1.2 && !lock; dz += 0.3) for (const dx of [0, -0.6, 0.6, -1.2, 1.2]) {
    const x = gate.x + dx, z = frontZ + dz;
    if (standable(x, z) && reachAt(shut, x, z)) { lock = { x, z }; break; }
  }
  if (!lock) return null;
  const x0 = room.x - room.width / 2, x1 = room.x + room.width / 2, z0 = room.z - room.depth / 2, z1 = room.z + room.depth / 2;
  let stash: { x: number; z: number } | null = null, best = Infinity;
  for (let z = z0 + 0.5; z <= z1 - 0.5; z += 0.25) for (let x = x0 + 0.5; x <= x1 - 0.5; x += 0.25) {
    const d = Math.hypot(x - room.x, z - room.z);
    if (d >= best || !standable(x, z) || !reachAt(open, x, z) || reachAt(shut, x, z)) continue;
    if (!fixtures.every(item => item.kind === "wall" || item === gate || Math.hypot(item.x - x, item.z - z) > 0.6)) continue;
    stash = { x, z }; best = d;
  }
  return stash ? { lock, stash } : null;
}

function lockBackRoom(place: InteriorPlace, kind: GroundFloorKind, plan: GroundFloorPlan, infos: readonly RoomInfo[]): GroundFloorPlan {
  const tier = LOCKABLE[kind];
  if (!tier || infos.length !== plan.rooms.length) return plan;
  const random = seeded(seedOf(place.building, 911));
  if (random() >= LOCK_CHANCE) return plan;
  const backs = infos.map((info, index) => ({ info, index })).filter(entry => entry.info.role === "back");
  if (!backs.length) return plan;
  const { info, index } = pick(backs, random);
  const rect = info.rect, wallZ = rect.z1 + WALL / 2;
  if (plan.fixtures.some(item => item.kind === "lift" && item.x > rect.x0 && item.x < rect.x1 && item.z > rect.z0 && item.z < rect.z1)) return plan;
  // The doorway: the gap of DOOR metres between two back-wall segments, inside this room's span.
  const segments = plan.fixtures.filter(item => item.kind === "wall" && Math.abs(item.z - wallZ) < 1e-6 && Math.abs(item.depth - WALL) < 1e-6).sort((a, b) => a.x - b.x);
  let gap: { x0: number; x1: number } | null = null;
  for (let i = 0; i + 1 < segments.length && !gap; i++) {
    const x0 = segments[i].x + segments[i].width / 2, x1 = segments[i + 1].x - segments[i + 1].width / 2;
    if (Math.abs(x1 - x0 - DOOR) < 0.05 && (x0 + x1) / 2 > rect.x0 && (x0 + x1) / 2 < rect.x1) gap = { x0, x1 };
  }
  if (!gap) return plan;
  const inRoom = (x: number, z: number) => x > rect.x0 && x < rect.x1 && z > rect.z0 && z < rect.z1;
  const gate: InteriorFixture = { kind: "gate", x: (gap.x0 + gap.x1) / 2, z: wallZ, width: gap.x1 - gap.x0, depth: WALL, height: INTERIOR_HEIGHT, seed: Math.round(random() * 1000) / 1000 };
  const fixtures = [...plan.fixtures, gate];
  // Residents stay only where the shut gate leaves them reachable: standing ones on a reachable cell,
  // seated ones (their chair blocks its own cell) with a reachable cell within arm's reach of the seat.
  const grid = reachable(place.width / 2, place.depth / 2, fixtures);
  if (!grid) return plan;
  const reaches = (resident: GroundResident): boolean => {
    if (inRoom(resident.x, resident.z)) return false;
    if (!resident.seated) return reachAt(grid, resident.x, resident.z);
    for (let k = 0; k < 8; k++) {
      const angle = k * Math.PI / 4;
      if (reachAt(grid, resident.x + Math.cos(angle) * 0.9, resident.z + Math.sin(angle) * 0.9)) return true;
    }
    return false;
  };
  const residents = plan.residents.filter(reaches);
  if (!residents.length) return plan;
  // The terminal and the stash (lockSpots) must both exist, or the room would be sealed for good / empty.
  if (!lockSpots(place.width / 2, place.depth / 2, fixtures, gate, plan.rooms[index])) return plan;
  labelMap.set(gate, { text: "LOCKED", x: gate.x, z: gate.z + 0.8 });
  return { ...plan, fixtures, residents, locks: [{ fixtureIndex: fixtures.length - 1, room: index, tier }] };
}

/** What a plan is made from: walls and rooms, each room's furniture, an optional last touch; then the
 * shared walkability, label, resident and light passes (ground floors and upper-floors.ts). */
export interface PlanRecipe {
  seed: number;
  partition: (layout: Layout) => RoomInfo[];
  furnish: (layout: Layout, room: RoomInfo) => void;
  /** Runs after the partition, before any furniture (an upper floor's or tall building's lift). */
  early?: (layout: Layout, rooms: readonly RoomInfo[]) => void;
  finish?: (layout: Layout, rooms: readonly RoomInfo[]) => void;
  /** Residents' lines, the ceiling lights' colour and the fallback room's label. */
  lines: readonly string[];
  light: RGB;
  label: string;
}

/** A plan from a recipe, in room space (see GroundFloorPlan); not cached here. */
export function planFromRecipe(place: InteriorPlace, recipe: PlanRecipe): GroundFloorPlan {
  const random = seeded(recipe.seed);
  const hw = place.width / 2, hd = place.depth / 2;
  const layout = new Layout(hw, hd, random);
  let rooms = recipe.partition(layout);
  recipe.early?.(layout, rooms);
  for (const [index, room] of rooms.entries()) { layout.room = index; recipe.furnish(layout, room); }
  recipe.finish?.(layout, rooms);

  // Walkability: drop the latest furniture groups until the spawn and every room are reachable.
  let fixtures = layout.fixtures.slice(), groups = layout.groups.slice();
  let openRoom = false;
  const settle = (): Grid => {
    for (;;) {
      const grid = reachable(hw, hd, fixtures);
      if (grid && rooms.every(room => roomReached(grid, room.rect))) return grid;
      const last = Math.max(0, ...groups.filter(group => !layout.keep.has(group)));
      if (last <= 0) {
        // Walls alone fail (should not happen): one open room. Kept pieces (an upper floor's forced
        // lift, the only way down) stay; if even they block the way, nothing does.
        const keepKept = !openRoom && layout.keep.size > 0;
        openRoom = true;
        const survivors = keepKept ? fixtures.map((_, index) => layout.keep.has(groups[index])) : fixtures.map(() => false);
        fixtures = fixtures.filter((_, index) => survivors[index]);
        groups = groups.filter((_, index) => survivors[index]);
        rooms = [{ rect: { x0: -hw, x1: hw, z0: -hd, z1: hd }, role: "front", order: 0, label: recipe.label }];
      } else {
        const keep = groups.map(group => group !== last);
        fixtures = fixtures.filter((_, index) => keep[index]);
        groups = groups.filter((_, index) => keep[index]);
      }
    }
  };
  const reach = settle();
  const kept = new Set(fixtures);

  // Labels: one per surviving labelled group, at the group's centre, not repeating a nearby label.
  const printed: { text: string; x: number; z: number }[] = [];
  for (const [group, text] of layout.labels) {
    const members = fixtures.filter((_, index) => groups[index] === group);
    if (!members.length) continue;
    const x0 = Math.min(...members.map(f => f.x - f.width / 2)), x1 = Math.max(...members.map(f => f.x + f.width / 2));
    const z0 = Math.min(...members.map(f => f.z - f.depth / 2)), z1 = Math.max(...members.map(f => f.z + f.depth / 2));
    const label = { text, x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
    if (printed.some(other => other.text === text && Math.hypot(other.x - label.x, other.z - label.z) < 4)) continue;
    printed.push(label);
    labelMap.set(members[0], label);
  }

  // Residents: staff at counters and desks, someone seated, then people on open floor.
  const spawnZ = hd - 2.2;
  const inProtect = (x: number, z: number) => layout.protect.some(zone => x > zone.x0 && x < zone.x1 && z > zone.z0 && z < zone.z1);
  const freeSpot = (x: number, z: number) => standable(hw, hd, fixtures, x, z) && reachAt(reach, x, z) && !inProtect(x, z) && Math.hypot(x, z - spawnZ) > 2.5;
  const residents: GroundResident[] = [];
  const target = Math.min(4, 1 + Math.floor(random() * 3) + (place.width * place.depth > 300 ? 1 : 0));
  const lines = recipe.lines.slice();
  const add = (x: number, z: number, seated: boolean, facing: number) => {
    if (residents.length >= target || residents.some(other => Math.hypot(other.x - x, other.z - z) < 1.3)) return;
    const line = lines.splice(Math.floor(random() * lines.length) % Math.max(1, lines.length), 1)[0] ?? recipe.lines[0];
    const tint = residents.length === 0 ? place.color : pick(COATS, random);
    residents.push({ x, z, seated, facing: Math.round(facing), line, tint, offset: residents.length * 2 + Math.floor(random() * 2) });
  };
  const staff = layout.spots.filter(spot => spot.staff && (spot.seat ? kept.has(spot.seat) : freeSpot(spot.x, spot.z)));
  if (staff.length) { const spot = pick(staff, random); add(spot.x, spot.z, spot.seat !== null, spot.facing); }
  const seats = layout.spots.filter(spot => !spot.staff && spot.seat && kept.has(spot.seat));
  if (seats.length && random() < 0.7) { const spot = pick(seats, random); add(spot.x, spot.z, true, spot.facing); }
  const furniture = fixtures.filter(f => f.kind !== "wall");
  for (let attempt = 0; attempt < 60 && residents.length < target; attempt++) {
    const room = pick(rooms, random).rect;
    const x = room.x0 + 0.8 + random() * Math.max(0, room.x1 - room.x0 - 1.6), z = room.z0 + 0.8 + random() * Math.max(0, room.z1 - room.z0 - 1.6);
    if (!freeSpot(x, z)) continue;
    let facing = 180, best = 3.5;
    for (const f of furniture) {
      const distance = Math.hypot(f.x - x, f.z - z);
      if (distance < best) { best = distance; facing = headingTo(f.x - x, f.z - z); }
    }
    add(x, z, false, facing);
  }
  // Never an empty room: the first free spot on a 0.5 m lattice, back of the room first.
  for (let z = -hd + 1; z < hd - 1 && !residents.length; z += 0.5) {
    for (let x = -hw + 1; x < hw - 1 && !residents.length; x += 0.5) if (freeSpot(x, z)) add(x, z, false, 180);
  }

  // Lights: one per room, two down a deep front room (2-6 in all).
  const color = recipe.light;
  const lights: GroundLight[] = [];
  for (const room of rooms) {
    const { x0, x1, z0, z1 } = room.rect, x = (x0 + x1) / 2;
    if (room.role === "front" && (z1 - z0 > 9 || rooms.length === 1)) lights.push({ x, z: z0 + (z1 - z0) * 0.3, color }, { x, z: z0 + (z1 - z0) * 0.72, color });
    else lights.push({ x, z: (z0 + z1) / 2, color });
  }

  return {
    fixtures,
    rooms: rooms.map(room => ({ x: (room.rect.x0 + room.rect.x1) / 2, z: (room.rect.z0 + room.rect.z1) / 2, width: room.rect.x1 - room.rect.x0, depth: room.rect.z1 - room.rect.z0, label: room.label })),
    residents,
    lights: lights.slice(0, 6),
  };
}
