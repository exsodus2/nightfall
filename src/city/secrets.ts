import type { FlagValue } from "../rpg/types.ts";
import type { InteriorFixture, InteriorKind, InteriorPlace } from "./interiors.ts";
import { alleysOf, type AlleyArm, type AlleySide } from "./alleys.ts";
import { miniFontBytes } from "./mini-font.ts";
import { POND } from "./park.ts";
import { districtAt, type Block, type CityWorld, type RGB } from "./world.ts";

/**
 * The city's secrets (a Meow Wolf in the rain): twenty small discoveries, each with a payoff.
 * Pure data and logic: where every secret prop stands (secrets-scene.ts draws them), the hidden
 * rooms (`secretPlaces`, entered through the engine's ordinary doorway path but never listed with
 * the nine public venues), and the discovery counter. Content (dialogue, items, interactables)
 * lives in rpg/content/secrets.ts and reads its coordinates from here.
 *
 * Discovery: each secret sets the world flag `secret.<id>`; `SecretWatch` turns the first set of
 * each into a toast "A secret: 7/20 (Name)". Rooms count on entry (`roomSecretFor`).
 *
 * Comfort: every motion here is slow (SECRET_MOTION, all at or under 0.4 Hz); nothing flashes;
 * hidden rooms are reached through a door and the room's own arrival fade, never a cut.
 */

// ---- The twenty secrets ---------------------------------------------------------------------------

export const SECRETS = [
  { id: "fridge", name: "The Fridge", district: 4 },
  { id: "cat", name: "The Cat's Shrine", district: 4 },
  { id: "manhole", name: "Gallery Zero", district: 5 },
  { id: "mirror", name: "The Mirror Shop", district: 1 },
  { id: "payphone", name: "The Ringing Phone", district: 1 },
  { id: "graffiti", name: "We Were Here", district: 4 },
  { id: "vending", name: "The Generous Machine", district: 2 },
  { id: "rooftop", name: "The Fire Escape", district: 5 },
  { id: "carriage", name: "The Still Carriage", district: 0 },
  { id: "studio", name: "The Boarded Door", district: 2 },
  { id: "koi", name: "The Koi", district: 3 },
  { id: "valves", name: "The Pipes Say Hi", district: 5 },
  { id: "lost-found", name: "Lost and Found", district: 4 },
  { id: "pie", name: "Cloud Pie", district: 4 },
  { id: "tiny-door", name: "The Very Small Door", district: 3 },
  { id: "bench", name: "Mira's Bench", district: 3 },
  { id: "drain", name: "The Echo Drain", district: 5 },
  { id: "floor-1210", name: "Floor 1210", district: 1 },
  { id: "rain-counter", name: "The Rain Counter", district: 3 },
  { id: "high-score", name: "Tomorrow's High Score", district: 5 },
] as const;
export type SecretId = (typeof SECRETS)[number]["id"];
export const SECRET_COUNT = SECRETS.length;
export const SECRET_PREFIX = "secret.";
export const secretFlag = (id: SecretId): string => SECRET_PREFIX + id;

const SECRET_IDS: ReadonlySet<string> = new Set(SECRETS.map(secret => secret.id));
/** The secret a flag key marks, or null. */
export function secretOfFlag(key: string): SecretId | null {
  if (!key.startsWith(SECRET_PREFIX)) return null;
  const id = key.slice(SECRET_PREFIX.length);
  return SECRET_IDS.has(id) ? id as SecretId : null;
}
/** How many secrets the flags say were found. */
export function secretsFound(flag: (key: string) => FlagValue | undefined): number {
  let found = 0;
  for (const secret of SECRETS) if (flag(secretFlag(secret.id))) found++;
  return found;
}
export const secretToast = (found: number, name: string): string => `A secret: ${found}/${SECRET_COUNT} (${name})`;

/** Counts each secret once: `note` returns the toast for a flag that newly marks a secret. Flags
 * already set when the watch starts (a loaded save) never toast. */
export class SecretWatch {
  private readonly found = new Set<SecretId>();
  constructor(flag: (key: string) => FlagValue | undefined = () => undefined) {
    for (const secret of SECRETS) if (flag(secretFlag(secret.id))) this.found.add(secret.id);
  }
  get count(): number { return this.found.size; }
  note(key: string, value: FlagValue): string | null {
    const id = secretOfFlag(key);
    if (!id || !value || this.found.has(id)) return null;
    this.found.add(id);
    return secretToast(this.found.size, SECRETS.find(secret => secret.id === id)?.name ?? id);
  }
}

/** Shared read access to world flags for the render path (secrets-scene.ts installs the session's
 * reader; tests and the floorplan code run without one and see every flag unset). */
let flagReader: ((key: string) => FlagValue | undefined) | null = null;
export function setSecretFlagReader(reader: ((key: string) => FlagValue | undefined) | null): void { flagReader = reader; }
export const secretFlagValue = (key: string): FlagValue | undefined => flagReader?.(key);

// Content flags (rpg/content/secrets.ts) the scenes read.
export const SECRET_FLAGS = {
  hunt: "secrets.hunt", cats: ["secrets.cat1", "secrets.cat2", "secrets.cat3"], words: ["secrets.word1", "secrets.word2", "secrets.word3", "secrets.word4", "secrets.word5", "secrets.word6"],
  valveStep: "secrets.valve-step", ringing: "secrets.phone-ringing", reflectionSold: "secrets.reflection-sold",
} as const;

// ---- Motion (all slow; tests/secrets.test.ts checks every rate) -------------------------------------

/** Every periodic motion or glow in the secrets, in Hz. Nothing flashes; nothing exceeds 0.4 Hz. */
export const SECRET_MOTION = {
  humHz: 0.1, candleHz: 0.3, ringHz: 0.38, ringSignHz: 0.2, tailHz: 0.2, koiSwimHz: 0.016, pipesHz: 0.08, steamHz: 0.2,
  screenHz: 0.12, captureHz: 0.05, leakHz: 0.12, cloudHz: 0.01, clockHz: 0.017, telescopeHz: 0.03, dripHz: 0.35, radioHz: 0.15,
} as const;
const TAU = Math.PI * 2;
/** rad/s of a motion in SECRET_MOTION. */
export const rate = (key: keyof typeof SECRET_MOTION): number => SECRET_MOTION[key] * TAU;

/** The payphone rings for the first 30 s of every even scene-clock minute. */
export const PHONE_RING = { period: 120, length: 30 } as const;
export function phoneRinging(time: number): boolean {
  return ((time % PHONE_RING.period) + PHONE_RING.period) % PHONE_RING.period < PHONE_RING.length;
}

// ---- Alley props ---------------------------------------------------------------------------------

type ArmRef = readonly [bx: number, bz: number, side: AlleySide];
/** The secret alleys: one strange arm per district, plus a few neighbours. All run along x. */
export const SECRET_ARMS = {
  silkKitchen: [0, 1, "e"], silkMarket: [0, 1, "w"], silkShrine: [-1, 1, "e"],
  neonMarket: [0, -4, "e"], ghostShrine: [7, -4, "w"], ghostData: [7, -8, "w"], foundrySquat: [-8, -4, "e"],
  rainGarden: [-8, 1, "e"], rainGarden2: [-8, 2, "w"], spillPipes: [6, 3, "e"], spillData: [7, 3, "w"], spillPipes2: [7, 3, "e"], spillKitchen: [6, 3, "w"],
} as const satisfies Record<string, ArmRef>;
export type SecretArm = keyof typeof SECRET_ARMS;

/** A wall spot: arm, wall (0: the lower-z face, 1: the higher), and x along the arm. */
export interface WallSpot { arm: SecretArm; wall: 0 | 1; x: number }
export type SecretPropKind = "fridge" | "cat" | "shrine" | "payphone" | "vending" | "valves" | "tiny-door" | "cabinet" | "ladder" | "boarded";
export const WALL_PROPS: readonly (WallSpot & { kind: SecretPropKind; key: string })[] = [
  { key: "fridge", kind: "fridge", arm: "silkKitchen", wall: 0, x: 45 },
  { key: "cat1", kind: "cat", arm: "rainGarden2", wall: 1, x: -485 },
  { key: "cat2", kind: "cat", arm: "spillData", wall: 0, x: 472 },
  { key: "cat3", kind: "cat", arm: "silkMarket", wall: 1, x: 28 },
  { key: "shrine", kind: "shrine", arm: "silkShrine", wall: 1, x: -27 },
  { key: "payphone", kind: "payphone", arm: "neonMarket", wall: 0, x: 40 },
  { key: "vending", kind: "vending", arm: "ghostShrine", wall: 1, x: 470 },
  { key: "valves", kind: "valves", arm: "spillPipes", wall: 1, x: 421.8 },
  { key: "tiny-door", kind: "tiny-door", arm: "rainGarden", wall: 0, x: -472 },
  { key: "cabinet", kind: "cabinet", arm: "spillKitchen", wall: 0, x: 406 },
  { key: "ladder", kind: "ladder", arm: "spillPipes2", wall: 1, x: 487 },
  { key: "boarded", kind: "boarded", arm: "ghostData", wall: 1, x: 470 },
];
/** The valve wheels, along the wall from the left (x - 1.8) to the right (x + 1.8). */
export const VALVES = [{ id: "cold", dx: -1.8, color: [80, 170, 255] }, { id: "hot", dx: 0, color: [255, 90, 70] }, { id: "steam", dx: 1.8, color: [220, 226, 230] }] as const satisfies readonly { id: string; dx: number; color: RGB }[];
/** WE WERE HERE AND STILL ARE: one painted word per district, in district order. */
export const GRAFFITI_WORDS: readonly (WallSpot & { word: string; color: RGB })[] = [
  { word: "WE", arm: "foundrySquat", wall: 1, x: -470, color: [255, 150, 70] },
  { word: "WERE", arm: "neonMarket", wall: 1, x: 46, color: [255, 80, 180] },
  { word: "HERE", arm: "ghostShrine", wall: 0, x: 465, color: [130, 170, 255] },
  { word: "AND", arm: "rainGarden", wall: 1, x: -467, color: [120, 240, 170] },
  { word: "STILL", arm: "silkKitchen", wall: 1, x: 41, color: [200, 230, 240] },
  { word: "ARE", arm: "spillPipes", wall: 0, x: 427, color: [255, 200, 100] },
];
/** The storm drain that answers back: flat in the floor at the middle of the Spillway data alley. */
export const DRAIN = { arm: "spillData" as SecretArm, x: 466 };

/** Where the player stands to use each outdoor secret (rpg/content/secrets.ts interactables). */
export const SECRET_SPOTS = {
  cat1: { x: -485, z: 160.7 }, cat2: { x: 472, z: 223.3 }, cat3: { x: 28, z: 98.4 }, shrine: { x: -27, z: 99.1 },
  payphone: { x: 40, z: -225.8 }, vending: { x: 470, z: -220.1 },
  valveCold: { x: 420, z: 227.7 }, valveHot: { x: 421.8, z: 227.7 }, valveSteam: { x: 423.6, z: 227.7 },
  word1: { x: -470, z: -220.3 }, word2: { x: 46, z: -221 }, word3: { x: 465, z: -225.3 }, word4: { x: -467, z: 97.4 }, word5: { x: 41, z: 98.5 }, word6: { x: 427, z: 222.7 },
  tinyDoor: { x: -472, z: 94 }, drain: { x: 466, z: 225.5 }, cabinet: { x: 406, z: 223.4 },
  lift: { x: 16.4, z: -156 }, lostFound: { x: -22.3, z: 312.7 }, bench: { x: -420, z: 242.2 }, gateTag: { x: 14.2, z: 210 },
  rainCounter: { x: -490, z: 157.4 },
} as const satisfies Record<string, { x: number; z: number }>;

/** Street props that are not in an alley (secrets-scene.ts). */
export const LIFT_PANEL = { x: 17.7, z: -156 };
export const LOST_FOUND = { x: -22.3, z: 311, width: 1.8 };
export const BENCH_PLAQUE = { x: -419.95, z: 240.13 };
export const MANHOLE = { x: 480, z: 304.6 };
export const CARRIAGE = { x: -716, z: -722, length: 16, width: 4 };
export const MIRROR_FRONT = { x: -109, face: -264.45 };

/** The guide cat's walk from the third cat (Silk Market) across the avenue to the shrine. */
export const GUIDE_PATH: readonly (readonly [number, number])[] = [[28, 98], [20, 96.6], [10, 96.2], [0, 96], [-10, 95.8], [-20, 97.6], [-25.6, 99.2]];
export function guideLength(): number {
  let length = 0;
  for (let i = 1; i < GUIDE_PATH.length; i++) length += Math.hypot(GUIDE_PATH[i][0] - GUIDE_PATH[i - 1][0], GUIDE_PATH[i][1] - GUIDE_PATH[i - 1][1]);
  return length;
}
/** Point and heading (direction of travel) at distance `s` along the guide path. */
export function guidePoint(s: number): { x: number; z: number; dx: number; dz: number } {
  let left = Math.max(0, s);
  for (let i = 1; i < GUIDE_PATH.length; i++) {
    const [ax, az] = GUIDE_PATH[i - 1], [bx, bz] = GUIDE_PATH[i], length = Math.hypot(bx - ax, bz - az);
    if (left <= length || i === GUIDE_PATH.length - 1) {
      const k = Math.min(1, left / length);
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, dx: (bx - ax) / length, dz: (bz - az) / length };
    }
    left -= length;
  }
  const [x, z] = GUIDE_PATH[GUIDE_PATH.length - 1];
  return { x, z, dx: -1, dz: 0 };
}
/** Distance along the guide path of the point nearest (x, z). */
export function guideProjection(x: number, z: number): number {
  let best = 0, bestDistance = Infinity, start = 0;
  for (let i = 1; i < GUIDE_PATH.length; i++) {
    const [ax, az] = GUIDE_PATH[i - 1], [bx, bz] = GUIDE_PATH[i], vx = bx - ax, vz = bz - az, length = Math.hypot(vx, vz);
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (length * length)));
    const distance = Math.hypot(ax + vx * k - x, az + vz * k - z);
    if (distance < bestDistance) { bestDistance = distance; best = start + k * length; }
    start += length;
  }
  return best;
}
/** The guide's next progress: it keeps ~3 m ahead of a walker within 12 m, never turns back, and
 * walks no faster than 1.6 m/s. */
export function guideStep(progress: number, walker: { x: number; z: number }, dt: number): number {
  const here = guidePoint(progress), near = Math.hypot(walker.x - here.x, walker.z - here.z) < 12;
  if (!near) return progress;
  const target = Math.min(guideLength(), Math.max(progress, guideProjection(walker.x, walker.z) + 3));
  return Math.min(target, progress + 1.6 * Math.max(0, Math.min(0.25, dt)));
}

// ---- The koi -------------------------------------------------------------------------------------

export const KOI_WORD = "STAY";
export const KOI = { stillSeconds: 20, gatherSeconds: 10, scatterSeconds: 5, reach: 30, pixel: 1.3, rowStretch: 1.7 } as const;
const FONT = miniFontBytes();
/** Letter pixels of the koi word: column and row in a 3x5 grid per letter, one letter gap. */
export function koiPixels(word = KOI_WORD): { column: number; row: number }[] {
  const pixels: { column: number; row: number }[] = [];
  for (const [index, character] of [...word].entries()) {
    const code = character.charCodeAt(0) - 32, bitmap = FONT[code * 2] | (FONT[code * 2 + 1] << 8);
    for (let row = 0; row < 5; row++) for (let column = 0; column < 3; column++) if (bitmap & (1 << (14 - row * 3 - column))) pixels.push({ column: index * 4 + column, row });
  }
  return pixels;
}
/** Where koi `i` swims at `time`: a slow loop inside the pond. */
export function koiSwim(i: number, time: number): { x: number; z: number; dx: number; dz: number } {
  const phase = i * 2.399, speed = rate("koiSwimHz") * (0.7 + (i % 5) * 0.12) * (i % 2 ? 1 : -1), radius = 0.32 + ((i * 37) % 11) / 22;
  const angle = phase + time * speed;
  const x = POND.x + Math.cos(angle) * POND.rx * radius * 0.82, z = POND.z + Math.sin(angle) * POND.rz * radius * 0.82;
  // The direction of travel: the loop's tangent.
  const tx = -Math.sin(angle) * Math.sign(speed) * POND.rx, tz = Math.cos(angle) * Math.sign(speed) * POND.rz, length = Math.hypot(tx, tz) || 1;
  return { x, z, dx: tx / length, dz: tz / length };
}
/** Where koi `i` waits in the word, laid out to read from `viewer` (letters face it, rows run away). */
export function koiSlot(i: number, viewer: { x: number; z: number }): { x: number; z: number } {
  const pixels = koiPixels(), pixel = pixels[i % pixels.length], columns = KOI_WORD.length * 4 - 1;
  let fx = POND.x - viewer.x, fz = POND.z - viewer.z;
  const length = Math.hypot(fx, fz) || 1; fx /= length; fz /= length;
  const rx = -fz, rz = fx, across = (pixel.column - (columns - 1) / 2) * KOI.pixel, away = (2 - pixel.row) * KOI.pixel * KOI.rowStretch;
  return { x: POND.x + rx * across + fx * away, z: POND.z + rz * across + fz * away };
}

// ---- Hidden rooms --------------------------------------------------------------------------------

export type SecretKind = Extract<InteriorKind, `secret-${string}`>;
export const SECRET_KINDS: readonly SecretKind[] = ["secret-diner", "secret-gallery", "secret-mirror", "secret-roof", "secret-carriage", "secret-studio"];
export const isSecretKind = (kind: InteriorKind): kind is SecretKind => kind.startsWith("secret-");

interface RoomSpec { id: string; secret: SecretId; name: string; sign: string; description: string; kind: SecretKind; color: RGB; x: number; z: number; width: number; depth: number; yaw: number; entrance: { x: number; z: number } }
/** The hidden rooms. `name` is also the door ("Enter The Fridge"). Rooms only turn at 0 or PI
 * (the door on the south or north face), so the room's local +z (its door) is world +z or -z. */
export const SECRET_ROOMS: readonly RoomSpec[] = [
  { id: "the-fridge", secret: "fridge", name: "The Fridge", sign: "CLOUD NINE DINER", description: "A diner with one stool, above the clouds.", kind: "secret-diner", color: [140, 220, 255], x: 45, z: 87.9, width: 7, depth: 8, yaw: 0, entrance: { x: 45, z: 93.85 } },
  { id: "the-manhole", secret: "manhole", name: "The Manhole", sign: "GALLERY 0", description: "A flooded maintenance gallery. The pipes hum.", kind: "secret-gallery", color: [80, 230, 200], x: 480, z: 297, width: 6, depth: 14, yaw: 0, entrance: { x: 480, z: 304.6 } },
  { id: "the-mirror-shop", secret: "mirror", name: "The Mirror Shop", sign: "POHS RORRIM", description: "Everything here is the other way round.", kind: "secret-mirror", color: [200, 170, 255], x: -109, z: -269.25, width: 9, depth: 9, yaw: 0, entrance: { x: -109, z: -262.65 } },
  { id: "the-fire-escape", secret: "rooftop", name: "The Fire Escape", sign: "ROOF", description: "A roof with a lawn chair, a telescope and a radio.", kind: "secret-roof", color: [255, 190, 120], x: 487, z: 234, width: 12, depth: 12, yaw: Math.PI, entrance: { x: 487, z: 226.2 } },
  { id: "the-still-carriage", secret: "carriage", name: "The Still Carriage", sign: "LAST STOP", description: "A lit carriage that has never left the yard.", kind: "secret-carriage", color: [255, 214, 140], x: -716, z: -722, width: 16, depth: 4, yaw: 0, entrance: { x: -716, z: -718.4 } },
  { id: "the-boarded-door", secret: "studio", name: "The Boarded Door", sign: "THE STUDIO", description: "Tripods, captures and a terminal that remembers who built this.", kind: "secret-studio", color: [120, 255, 170], x: 470, z: -470.2, width: 9, depth: 10, yaw: Math.PI, entrance: { x: 470, z: -477 } },
];
export const SECRET_ROOM_IDS: ReadonlySet<string> = new Set(SECRET_ROOMS.map(room => room.id));
/** The secret a room counts as when the player walks in (`entered` area "interior:<id>"). */
export function roomSecretFor(area: string): SecretId | null {
  const id = area.startsWith("interior:") ? area.slice("interior:".length) : "";
  return SECRET_ROOMS.find(room => room.id === id)?.secret ?? null;
}
/** World point of a room-space point (the same transform as interiors.ts interiorWorld). */
export function roomPoint(id: string, x: number, z: number): { x: number; z: number } {
  const room = SECRET_ROOMS.find(candidate => candidate.id === id);
  if (!room) throw new Error(`unknown secret room ${id}`);
  const cosine = Math.cos(room.yaw), sine = Math.sin(room.yaw);
  return { x: +(room.x + cosine * x + sine * z).toFixed(3), z: +(room.z - sine * x + cosine * z).toFixed(3) };
}

const placeCache = new WeakMap<CityWorld, readonly InteriorPlace[]>();
/** The hidden rooms as interior places (hidden: true). Kept apart from `interiorPlaces`, so the map,
 * "Places to go" and the venue counts never list them; CityInteriors.nearby finds their doors. */
export function secretPlaces(world: CityWorld): readonly InteriorPlace[] {
  const cached = placeCache.get(world);
  if (cached) return cached;
  const places = SECRET_ROOMS.map((room): InteriorPlace => {
    const district = districtAt(room.x, room.z).id;
    const building = world.buildings.find(b => Math.abs(b.x - room.x) < b.width / 2 && Math.abs(b.z - room.z) < b.depth / 2)?.id ?? -1;
    return {
      id: room.id, name: room.name, sign: room.sign, description: room.description, kind: room.kind, district, color: room.color,
      building, x: room.x, z: room.z, width: room.width, depth: room.depth, yaw: room.yaw, entrance: { ...room.entrance, yaw: room.yaw }, hidden: true,
    };
  });
  placeCache.set(world, places);
  return places;
}

/** Furniture (collision and floorplan labels) of a hidden room, in room space (+z: the door). */
export function secretFixtures(place: InteriorPlace): readonly InteriorFixture[] {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  switch (place.kind) {
    case "secret-diner": return [
      { kind: "counter", x: 0, z: -2.2, width: 4.4, depth: 0.8, height: 1.05 },
      { kind: "stool", x: 0, z: -1.25, width: 0.5, depth: 0.5, height: 0.75 },
      { kind: "backbar", x: 0, z: -halfDepth + 0.4, width: 5.4, depth: 0.6, height: 1.3 },
      { kind: "table", x: halfWidth - 0.9, z: 0.4, width: 1.0, depth: 1.2, height: 0.75 },
    ];
    case "secret-gallery": return [
      { kind: "table", x: 1.5, z: -halfDepth + 1.4, width: 1.2, depth: 0.9, height: 0.9 },
      { kind: "machine", x: -1.9, z: -2.5, width: 1.0, depth: 1.4, height: 1.6 },
    ];
    case "secret-mirror": return [
      { kind: "partition", x: 0, z: -1.6, width: 0.12, depth: 5.0, height: 3 },
      { kind: "counter", x: -2.3, z: -2.9, width: 2.4, depth: 0.8, height: 1.1 },
      { kind: "counter", x: 2.3, z: -2.9, width: 2.4, depth: 0.8, height: 1.1 },
      { kind: "shelf", x: -halfWidth + 0.5, z: 0.4, width: 0.7, depth: 2.6, height: 2.6 },
      { kind: "shelf", x: halfWidth - 0.5, z: 0.4, width: 0.7, depth: 2.6, height: 2.6 },
    ];
    case "secret-roof": return [
      { kind: "seat", x: -2, z: -2, width: 0.8, depth: 1.4, height: 0.5 },
      { kind: "table", x: -3.6, z: -2, width: 0.6, depth: 0.6, height: 0.6 },
      { kind: "post", x: 2.5, z: -3.5, width: 0.6, depth: 0.6, height: 1.4 },
      { kind: "machine", x: 3.9, z: 2.2, width: 2.2, depth: 2.2, height: 2.6 },
    ];
    case "secret-carriage": return [
      { kind: "seat", x: -4.7, z: -1.65, width: 5.2, depth: 0.6, height: 0.5 },
      { kind: "seat", x: 4.7, z: -1.65, width: 5.2, depth: 0.6, height: 0.5 },
      { kind: "seat", x: -5.0, z: 1.65, width: 4.6, depth: 0.6, height: 0.5 },
      { kind: "seat", x: 5.0, z: 1.65, width: 4.6, depth: 0.6, height: 0.5 },
    ];
    case "secret-studio": return [
      { kind: "counter", x: 0, z: -halfDepth + 1.4, width: 3.2, depth: 0.9, height: 0.8 },
      { kind: "table", x: -halfWidth + 1.2, z: 1.2, width: 1.4, depth: 2.2, height: 0.8 },
    ];
    default: return [];
  }
}

// ---- Alley prop geometry -------------------------------------------------------------------------

export interface SecretPart {
  x: number; y: number; z: number; w: number; h: number; d: number;
  color: RGB; glyph: string; gain: number; near: number; round: boolean; lit: boolean;
  pulse?: { rate: number; depth: number; phase: number };
  /** Which prop it belongs to (secrets-scene.ts draws some only while a flag holds). */
  key: string;
  arm?: SecretArm; wall?: 0 | 1;
}
export interface WallFrame { arm: SecretArm; wall: 0 | 1; x: number; wallZ: number; out: 1 | -1; alley: AlleyArm }

/** The arm of a secret alley (null when the world has no such arm). */
export function secretArm(blocks: ReadonlyMap<string, Block>, arm: SecretArm): AlleyArm | null {
  const [bx, bz, side] = SECRET_ARMS[arm];
  return alleysOf(blocks, bx, bz).find(candidate => candidate.side === side) ?? null;
}
export function wallFrame(blocks: ReadonlyMap<string, Block>, spot: WallSpot): WallFrame | null {
  const alley = secretArm(blocks, spot.arm);
  if (!alley || alley.axis !== "x") return null;
  const wallZ = spot.wall === 0 ? alley.mid - alley.width / 2 : alley.mid + alley.width / 2;
  return { arm: spot.arm, wall: spot.wall, x: spot.x, wallZ, out: spot.wall === 0 ? 1 : -1, alley };
}

const METAL: RGB = [62, 68, 76], DARK: RGB = [30, 34, 40], WOOD: RGB = [112, 84, 58], WARM: RGB = [255, 200, 130];
type PartOptions = { gain?: number; near?: number; round?: boolean; lit?: boolean; pulse?: SecretPart["pulse"] };
function partIn(list: SecretPart[], frame: WallFrame, key: string, u: number, v: number, y: number, along: number, depth: number, h: number, color: RGB, glyph: string, options: PartOptions = {}): void {
  const gain = options.gain ?? 0.85;
  list.push({
    x: frame.x + u, y, z: frame.wallZ + frame.out * Math.max(v, depth / 2 + 0.02), w: along, h, d: depth, color, glyph, gain, near: options.near ?? 70,
    round: options.round ?? false, lit: options.lit ?? gain >= 0.9, ...(options.pulse ? { pulse: options.pulse } : {}), key, arm: frame.arm, wall: frame.wall,
  });
}

function propParts(list: SecretPart[], frame: WallFrame, kind: SecretPropKind, key: string): void {
  const p = (u: number, v: number, y: number, along: number, depth: number, h: number, color: RGB, glyph: string, options?: PartOptions) => partIn(list, frame, key, u, v, y, along, depth, h, color, glyph, options);
  switch (kind) {
    case "fridge": {
      // A tall, old, humming fridge: body, a door seam, a chrome handle, magnets and a note, and a
      // cold glow breathing under it (0.1 Hz).
      p(0, 0.38, 0.98, 0.95, 0.72, 1.95, [196, 204, 198], "#", { gain: 0.78 });
      p(0, 0.75, 1.32, 0.9, 0.02, 0.03, [90, 96, 94], "-", { near: 30 });
      p(0.36, 0.78, 1.0, 0.05, 0.06, 0.55, [220, 230, 236], "|", { gain: 0.95, near: 40 });
      p(-0.2, 0.75, 1.62, 0.16, 0.02, 0.2, [250, 240, 200], "=", { gain: 0.9, near: 25 });
      p(-0.05, 0.75, 1.75, 0.07, 0.02, 0.07, [255, 90, 90], "o", { gain: 0.95, near: 20 });
      p(0, 0.6, 0.02, 1.2, 0.5, 0.02, [140, 220, 255], "-", { gain: 0.95, near: 40, pulse: { rate: rate("humHz"), depth: 0.2, phase: 0 } });
      return;
    }
    case "cat": {
      // A crate the cat sits on (secrets-scene.ts draws the cat itself).
      p(0, 0.4, 0.3, 0.6, 0.6, 0.6, [124, 96, 62], "#");
      return;
    }
    case "shrine": {
      // A low red altar, a lit offering bowl, a cat figurine and a candle (0.3 Hz).
      p(0, 0.3, 0.45, 0.9, 0.5, 0.9, [150, 40, 42], "#", { gain: 0.8 });
      p(0, 0.3, 0.92, 1.0, 0.56, 0.06, [200, 160, 90], "=", { near: 40 });
      p(0.15, 0.32, 1.02, 0.26, 0.2, 0.12, [255, 200, 110], "o", { gain: 1.0, round: true, near: 60 });
      p(-0.28, 0.25, 1.12, 0.12, 0.12, 0.3, [20, 20, 24], "o", { round: true, near: 30 });
      p(0.38, 0.22, 1.05, 0.05, 0.05, 0.16, [240, 230, 210], "|", { near: 25 });
      p(0.38, 0.22, 1.18, 0.06, 0.06, 0.08, [255, 170, 60], "*", { gain: 1.0, near: 40, pulse: { rate: rate("candleHz"), depth: 0.2, phase: 1 } });
      return;
    }
    case "payphone": {
      p(0, 0.22, 1.85, 0.8, 0.44, 0.9, [60, 120, 150], "#", { gain: 0.8 });
      p(0, 0.15, 1.3, 0.38, 0.26, 0.7, METAL, "H");
      p(0, 0.3, 2.32, 0.7, 0.06, 0.1, [140, 220, 255], "=", { gain: 0.92, near: 60 });
      return;
    }
    case "vending": {
      p(0, 0.4, 0.95, 1.0, 0.8, 1.9, [70, 40, 90], "#", { gain: 0.8 });
      p(-0.12, 0.81, 1.15, 0.6, 0.02, 1.2, [255, 170, 230], "=", { gain: 0.95, near: 80, pulse: { rate: rate("screenHz"), depth: 0.08, phase: 2 } });
      p(0.36, 0.81, 1.2, 0.14, 0.02, 0.3, [120, 255, 200], ".", { gain: 1.0, near: 30 });
      p(0, 0.81, 0.35, 0.7, 0.02, 0.2, DARK, " ", { near: 30 });
      return;
    }
    case "valves": {
      // A pipe along the wall, three stubs and three wheels (cold, hot, steam).
      p(0, 0.12, 1.15, 5.2, 0.2, 0.2, [104, 66, 46], "=");
      for (const valve of VALVES) {
        p(valve.dx, 0.25, 1.38, 0.12, 0.3, 0.3, METAL, "|", { near: 40 });
        p(valve.dx, 0.42, 1.5, 0.5, 0.06, 0.5, valve.color, "O", { gain: 0.9, round: true, near: 50 });
      }
      return;
    }
    case "tiny-door": {
      // A door 60 cm tall with a lit window and a doormat (the mat is flat on the floor).
      p(0, 0.04, 0.31, 0.44, 0.05, 0.62, [70, 52, 40], "#");
      p(0, 0.07, 0.32, 0.34, 0.02, 0.52, [150, 60, 60], "#", { near: 30 });
      p(0, 0.09, 0.47, 0.1, 0.01, 0.1, WARM, "o", { gain: 1.0, near: 40 });
      p(0.12, 0.09, 0.3, 0.03, 0.02, 0.03, [230, 200, 90], ".", { gain: 0.95, near: 15 });
      p(0, 0.25, 0.01, 0.5, 0.3, 0.02, [120, 90, 60], "%", { near: 25 });
      return;
    }
    case "cabinet": {
      p(0, 0.38, 0.9, 0.8, 0.75, 1.8, [40, 40, 70], "#", { gain: 0.8 });
      p(0, 0.76, 1.3, 0.56, 0.02, 0.44, [120, 255, 140], "=", { gain: 0.95, near: 70, pulse: { rate: rate("screenHz"), depth: 0.1, phase: 0.5 } });
      p(0, 0.6, 0.95, 0.7, 0.32, 0.08, DARK, "o", { near: 30 });
      return;
    }
    case "ladder": {
      // A fire-escape ladder up to a landing, rails lit by a small green lamp: the marked way up.
      for (const side of [-1, 1]) p(side * 0.28, 0.22, 3.4, 0.06, 0.06, 6.8, METAL, "|", { near: 80 });
      for (let rung = 0; rung < 18; rung++) p(0, 0.22, 0.3 + rung * 0.36, 0.56, 0.05, 0.05, [90, 96, 104], "-", { near: 50 });
      p(0, 0.6, 6.85, 2.4, 1.1, 0.08, METAL, "#");
      p(0, 0.3, 2.45, 0.14, 0.1, 0.14, [120, 255, 150], "o", { gain: 1.0, near: 90, round: true });
      return;
    }
    case "boarded": {
      // A boarded-up doorway; a thin warm line of light leaks from under it (0.12 Hz).
      p(0, 0.05, 1.1, 1.2, 0.06, 2.2, [44, 38, 34], "#");
      for (const [y, tilt] of [[0.5, 0], [1.2, 0], [1.9, 0]] as const) p(tilt, 0.1, y, 1.36, 0.05, 0.2, WOOD, "=");
      p(0, 0.09, 0.03, 1.1, 0.02, 0.04, WARM, "-", { gain: 1.0, near: 60, pulse: { rate: rate("leakHz"), depth: 0.2, phase: 0 } });
      return;
    }
  }
}

const partCache = new WeakMap<ReadonlyMap<string, Block>, readonly SecretPart[]>();
/** Every static secret prop in the alleys, in world space (cached per city). */
export function secretAlleyParts(blocks: ReadonlyMap<string, Block>): readonly SecretPart[] {
  const cached = partCache.get(blocks);
  if (cached) return cached;
  const parts: SecretPart[] = [];
  for (const spot of WALL_PROPS) {
    const frame = wallFrame(blocks, spot);
    if (frame) propParts(parts, frame, spot.kind, spot.key);
  }
  const drainFrame = wallFrame(blocks, { arm: DRAIN.arm, wall: 0, x: DRAIN.x });
  if (drainFrame) {
    const z = drainFrame.alley.mid;
    parts.push({ x: DRAIN.x, y: 0.015, z, w: 0.9, h: 0.03, d: 0.6, color: [70, 74, 80], glyph: "#", gain: 0.8, near: 40, round: false, lit: false, key: "drain", arm: DRAIN.arm });
    parts.push({ x: DRAIN.x, y: 0.035, z, w: 0.7, h: 0.01, d: 0.4, color: [20, 24, 28], glyph: "=", gain: 0.8, near: 25, round: false, lit: false, key: "drain", arm: DRAIN.arm });
  }
  partCache.set(blocks, parts);
  return parts;
}

/** Where to draw a graffiti word: on its wall above head height, facing into the alley. */
export function graffitiFace(blocks: ReadonlyMap<string, Block>, index: number): { x: number; y: number; z: number; yaw: number; width: number; height: number } | null {
  const spot = GRAFFITI_WORDS[index], frame = spot ? wallFrame(blocks, spot) : null;
  if (!spot || !frame) return null;
  return { x: spot.x, y: 3.7, z: frame.wallZ + frame.out * 0.06, yaw: frame.out > 0 ? 0 : 180, width: spot.word.length * 0.62 + 0.4, height: 0.9 };
}
