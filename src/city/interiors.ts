import { DISTRICTS, PLAYER_RADIUS, type CityWorld, type Player, type RGB } from "./world.ts";
import { isSecretKind, secretFixtures, secretPlaces } from "./secrets.ts";
import { groundFixtureLabel, groundFloorPlace, groundFloorPlan, groundFloorsNear } from "./building-interiors.ts";
import { LIFT_REACH, floorTitle, liftLanding, upperFloorPlace } from "./upper-floors.ts";

export type InteriorKind = "workshop" | "listening-bar" | "relay" | "conservatory" | "teahouse" | "salvage" | "noodle-bar" | "clinic" | "nightclub"
  // Secrets: hidden rooms (secrets.ts secretPlaces), never listed with the public venues.
  | "secret-diner" | "secret-gallery" | "secret-mirror" | "secret-roof" | "secret-carriage" | "secret-studio"
  // Ground floors: every other building's procedural interior (building-interiors.ts), themed by
  // district and building type. Generated on demand, never listed with the venues.
  | GroundFloorKind;
export type GroundFloorKind = "lobby" | "capsule-hotel" | "corp-lobby" | "arcade" | "pawnshop" | "machine-shop" | "server-hall"
  | "shrine" | "hydroponics" | "laundromat" | "market-hall" | "chandlery" | "apartment" | "garage";
export const GROUND_FLOOR_KINDS: readonly GroundFloorKind[] = ["lobby", "capsule-hotel", "corp-lobby", "arcade", "pawnshop", "machine-shop", "server-hall",
  "shrine", "hydroponics", "laundromat", "market-hall", "chandlery", "apartment", "garage"];
export function isGroundFloorKind(kind: InteriorKind): kind is GroundFloorKind { return (GROUND_FLOOR_KINDS as readonly string[]).includes(kind); }
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
  /** Secrets: a hidden room (secrets.ts). Not in `interiorPlaces`, so no map, list or count shows it. */
  hidden?: true;
  /** Upper floors (upper-floors.ts): the floors a tall building's lift stops at (1 = the ground floor,
   * ascending), on its ground floor and on every upper floor alike. Absent: no working lift. */
  stops?: readonly number[];
  /** Upper floors: this place's floor (>= 2; absent on ground floors and venues), its id
   * `bldg-<building>-f<floor>`, and the height (m) of its floor above the street (the view's eye). */
  floor?: number;
  elevation?: number;
}

/** Every building's place id: `bldg-<building id>` (its ground floor) or `bldg-<id>-f<floor>` (an upper
 * floor, floor >= 2). Canonical: no leading zeros. Whether the building or floor exists is checked by
 * `CityInteriors.placeById`. */
export const BUILDING_PLACE_ID = /^bldg-(0|[1-9]\d{0,5})(?:-f([2-9]|[1-9]\d{1,2}))?$/;

/** A place's title for the HUD: its name, with the floor on upper floors ("Kai Rooms · Floor 12"). */
export function interiorTitle(place: InteriorPlace): string {
  return place.floor ? `${place.name} · ${floorTitle(place)}` : place.name;
}
export interface InteriorFixture {
  kind: "counter" | "table" | "shelf" | "machine" | "planter" | "seat" | "stove" | "stool" | "bench" | "vending" | "post" | "bed"
    | "partition" | "decks" | "riser" | "speaker" | "booth" | "backbar"
    // Ground floors (building-interiors.ts). `wall` is a full-height interior wall segment (rooms are
    // walls with doorway gaps between them); the rest are furniture drawn by interior-scene.ts.
    | "wall" | "cabinet" | "pod" | "locker" | "rack" | "case" | "washer" | "lathe" | "tank" | "altar" | "cushion"
    | "stall" | "crate" | "kitchenette" | "couch" | "desk" | "turnstile" | "lift" | "mailbox" | "sculpture" | "growrack" | "car"
    // A lockable back room's doorway blocker (rpg/locked-rooms.ts): a security shutter filling the gap,
    // solid until the lock is hacked; CityInteriors.openGate removes it from the visit's fixtures.
    | "gate";
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Ground floors: facing in room space (radians, 0 = front toward +z / the street door); absent = 0. */
  yaw?: number;
  /** Ground floors: a per-fixture seed for colour and dressing variation (0..1). */
  seed?: number;
}
export const INTERIOR_HEIGHT = 5.8;
export const INTERIOR_REACH = 3;
/** Metres another door must be nearer than the held one before `nearby` switches to it. */
const NEARBY_MARGIN = 0.4;

/** The first six venues are one per district, in district order. Later venues name their district,
 * may open on the building face away from its nearer block street (`facing`: -1 toward -z), and may
 * use a narrower avenue plot (`minWidth`). Their doorways are anchored to a real walkable face. */
interface VenueSpec { id: string; name: string; sign: string; description: string; kind: InteriorKind; x: number; z: number; district?: number; facing?: 1 | -1; minWidth?: number }
const VENUES: readonly VenueSpec[] = [
  { id: "kiln", name: "Kiln Nine", sign: "KILN NINE", description: "A night shift keeping the old machines running.", kind: "workshop", x: -512, z: -250 },
  { id: "undertone", name: "Undertone", sign: "UNDERTONE", description: "Low lights, listening booths, one more record.", kind: "listening-bar", x: 0, z: -230 },
  { id: "dead-letter", name: "Dead Letter Exchange", sign: "DEAD LETTER", description: "Signals arrive here long after their senders leave.", kind: "relay", x: 448, z: -230 },
  { id: "glasshouse", name: "The Glasshouse", sign: "GLASSHOUSE", description: "Seedlings and grow lamps at the edge of Rootwood.", kind: "conservatory", x: -576, z: 210 },
  { id: "blue-hour", name: "Blue Hour Tea", sign: "BLUE HOUR", description: "Hot tea and a dry seat beside the market.", kind: "teahouse", x: 0, z: 78 },
  { id: "second-life", name: "Second Life Salvage", sign: "SECOND LIFE", description: "Yesterday's machines, waiting for another purpose.", kind: "salvage", x: 448, z: 230 },
  // On the Neon Breakwater Rim Line concourse, 27 m from the station lift (-20, -759): the door
  // faces the station across the cleared plaza, clear of the station columns at z = -759.
  { id: "breakwater-noodle", name: "Breakwater Noodle", sign: "BREAKWATER NOODLE", description: "A long counter, steaming pots and the last train on the wall screen.", kind: "noodle-bar", x: -25, z: -733, district: 1, facing: -1, minWidth: 12 },
  // Beside the Spillway loop station concourse.
  { id: "halfway-clinic", name: "Halfway Clinic", sign: "HALFWAY CLINIC", description: "Triage benches, a scanner arch and a nurse who has seen it all.", kind: "clinic", x: 493, z: 327, district: 5 },
  // A Neon Ward ground-floor club one block off the avenue, midway between Undertone and the Rim
  // Line: building 526 (-45, -403), its door on the block street to the south (-45, -391.6).
  { id: "the-static", name: "The Static", sign: "THE STATIC", description: "A bouncer, a coat check, slow colour on the dance floor and one last set before curfew.", kind: "nightclub", x: -45, z: -392, district: 1 },
];
const placeCache = new WeakMap<CityWorld, readonly InteriorPlace[]>();

export function interiorPlaces(world: CityWorld): readonly InteriorPlace[] {
  const cached = placeCache.get(world);
  if (cached) return cached;
  const places: InteriorPlace[] = [];
  const taken = new Set<number>();
  for (const [index, spec] of VENUES.entries()) {
    const { district: chosen, facing, minWidth, ...venue } = spec;
    const district = chosen ?? index;
    let best: InteriorPlace | null = null;
    let nearest = Infinity;
    for (const building of world.buildings) {
      if (building.district !== district || building.id % 3 === 0 || building.width < (minWidth ?? 15) || taken.has(building.id)) continue;
      const outward = facing ?? (((building.z % 64) + 64) % 64 < 32 ? -1 : 1);
      const yaw = outward > 0 ? 0 : Math.PI;
      const entrance = { x: building.x, z: building.z + outward * (building.depth / 2 + 1.8), yaw };
      if (!world.canOccupy(entrance.x, entrance.z)) continue;
      const distance = Math.hypot(entrance.x - venue.x, entrance.z - venue.z);
      if (distance >= nearest) continue;
      nearest = distance;
      best = { ...venue, district, color: DISTRICTS[district].color, building: building.id, x: building.x, z: building.z, width: Math.min(18, building.width - 1), depth: Math.min(20, building.depth - 1), yaw, entrance };
    }
    if (best) { places.push(best); taken.add(best.building); }
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
  if (isSecretKind(place.kind)) return secretFixtures(place); // Secrets
  // Ground floors: the cached plan's fixtures, in a fresh list (a visit's list carries its occupant).
  if (isGroundFloorKind(place.kind)) return groundFloorPlan(place).fixtures.slice();
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  if (place.kind === "noodle-bar") {
    // A long counter down the left side with the kitchen (stove and pots) behind it, four stools
    // in front, a standing ledge on the right wall. The middle aisle stays open to the back door.
    return [
      { kind: "counter", x: -halfWidth + 3.4, z: -1.4, width: 1.0, depth: Math.min(8.6, place.depth - 6), height: 1.1 },
      { kind: "stove", x: -halfWidth + 0.85, z: -2.2, width: 1.3, depth: Math.min(6, place.depth - 8.6), height: 0.95 },
      ...[-4.6, -2.6, -0.6, 1.4].map((z): InteriorFixture => ({ kind: "stool", x: -halfWidth + 4.45, z, width: 0.55, depth: 0.55, height: 0.75 })),
      { kind: "table", x: halfWidth - 0.65, z: -1.5, width: 0.9, depth: 5, height: 1.1 },
    ];
  }
  if (place.kind === "clinic") {
    // Triage benches on the left wall, the nurse's desk back right, a vending wall on the right,
    // a scanner arch (two posts) on the walking line and a curtained bay in the back-left corner.
    return [
      { kind: "counter", x: halfWidth - 4.4, z: -3.6, width: 4.4, depth: 1.1, height: 1.15 },
      { kind: "bench", x: -halfWidth + 1.6, z: -2.2, width: 1.1, depth: 3, height: 0.72 },
      { kind: "bench", x: -halfWidth + 1.6, z: 1.8, width: 1.1, depth: 3, height: 0.72 },
      { kind: "vending", x: halfWidth - 0.85, z: 1.8, width: 1.3, depth: 4.6, height: 2.5 },
      { kind: "post", x: -1.55, z: 0.6, width: 0.4, depth: 0.7, height: 2.9 },
      { kind: "post", x: 1.55, z: 0.6, width: 0.4, depth: 0.7, height: 2.9 },
      { kind: "bed", x: -halfWidth + 3.2, z: -halfDepth + 2.25, width: 3.2, depth: 1.6, height: 0.7 },
    ];
  }
  if (place.kind === "nightclub") {
    // The Static (room space, +z toward the street door). A lobby behind a partition with a centre
    // gap (bouncer on its left, coat check on the right); the main floor with the bar facing the
    // door from the back left, the raised DJ booth between two speaker stacks at the back, a booth
    // on each side wall; the green room in the back-right corner, reached along the right-hand
    // walkway. The dance floor in the middle is open floor, not furniture.
    const lobby = 3.4, greenFront = -4.6, greenWall = 4.75;
    return [
      { kind: "partition", x: -(halfWidth + 2.2) / 2, z: lobby, width: halfWidth - 2.2, depth: 0.3, height: 3 },
      { kind: "partition", x: (halfWidth + 2.2) / 2, z: lobby, width: halfWidth - 2.2, depth: 0.3, height: 3 },
      { kind: "counter", x: halfWidth - 2.1, z: halfDepth - 3.1, width: 1, depth: 2.6, height: 1.15 },
      { kind: "counter", x: -halfWidth + 2.4, z: -3.4, width: 4.4, depth: 1, height: 1.15 },
      { kind: "backbar", x: -halfWidth + 2.4, z: -5.9, width: 4.4, depth: 0.7, height: 2.6 },
      ...[-halfWidth + 1.3, -halfWidth + 2.1].map((x): InteriorFixture => ({ kind: "stool", x, z: -2.35, width: 0.55, depth: 0.55, height: 0.8 })),
      { kind: "decks", x: 0, z: -6.3, width: 4.6, depth: 1.4, height: 1.25 },
      { kind: "riser", x: 0, z: -halfDepth + 1.05, width: 5.2, depth: 2.1, height: 0.45 },
      { kind: "speaker", x: -3.4, z: -6.6, width: 1.1, depth: 1.2, height: 2.6 },
      { kind: "speaker", x: 3.4, z: -6.6, width: 1.1, depth: 1.2, height: 2.6 },
      { kind: "partition", x: greenWall, z: (greenFront - halfDepth) / 2, width: 0.3, depth: halfDepth + greenFront, height: 3 },
      { kind: "partition", x: halfWidth - 0.5, z: greenFront, width: 1, depth: 0.3, height: 3 },
      { kind: "seat", x: (greenWall + halfWidth) / 2 + 0.05, z: -halfDepth + 0.6, width: 2.6, depth: 0.9, height: 0.7 },
      { kind: "booth", x: halfWidth - 0.95, z: -1.4, width: 1.9, depth: 2.6, height: 1.3 },
      { kind: "booth", x: -halfWidth + 0.95, z: 0.2, width: 1.9, depth: 2.6, height: 1.3 },
    ];
  }
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

/** Short floorplan label for a fixture, and where to print it (room space); null for small pieces. */
export function interiorFixtureLabel(place: InteriorPlace, item: InteriorFixture): { text: string; x: number; z: number } | null {
  const at = (text: string, x = item.x, z = item.z) => ({ text, x, z });
  // Ground floors: one label per group of pieces (building-interiors.ts), walls and small pieces none.
  if (isGroundFloorKind(place.kind)) return groundFixtureLabel(item);
  switch (item.kind) {
    case "counter": return at(place.kind === "clinic" ? "DESK" : place.kind === "nightclub" ? (item.x < 0 ? "BAR" : "COATS") : "COUNTER");
    case "decks": return at("DECKS");
    case "booth": return at("BOOTH");
    case "stove": return at("POTS");
    case "table": return at(place.kind === "noodle-bar" ? "LEDGE" : "TABLE");
    case "seat": return at(place.kind === "nightclub" ? "GREEN RM" : "SEATS");
    case "shelf": return at("SHELF");
    case "planter": return at("BED");
    case "machine": return at(place.kind === "salvage" ? "BENCH" : "RIG");
    case "bench": return item.z < 0 ? at("TRIAGE") : null;
    case "vending": return at("VEND");
    case "post": return item.x < 0 ? at("SCANNER", 0, item.z - 0.9) : null;
    case "bed": return at("BAY");
    default: return null;
  }
}

/** Who is standing in a room, keyed by the fixture list `CityInteriors.enter` made for that visit.
 * Lets the room scene turn residents toward the visitor and fade in on arrival without a new engine
 * parameter; a fixture list made anywhere else (tests, floorplans) has no occupant. */
const occupants = new WeakMap<readonly InteriorFixture[], Pick<Player, "x" | "z" | "yaw">>();
export function interiorOccupant(fixtures: readonly InteriorFixture[]): Pick<Player, "x" | "z" | "yaw"> | null {
  return occupants.get(fixtures) ?? null;
}

/** The player yaw that looks into a room from its door (room -z). movePlayer's forward is
 * (sin yaw, -cos yaw) while room +z maps to (sin place.yaw, cos place.yaw), so the two agree for
 * rooms turned 0 or PI (every venue and secret) and are mirrored for ground floors turned +-PI/2. */
export function facingIn(place: InteriorPlace): number {
  return Math.abs(Math.sin(place.yaw)) < 1e-9 ? place.yaw : -place.yaw;
}

export class CityInteriors {
  readonly places: readonly InteriorPlace[];
  active: InteriorPlace | null = null;
  /** The player standing in the active room (the engine's own pose object), for room tools and checks. */
  visitor: Player | null = null;
  fixtures: readonly InteriorFixture[] = [];

  /** Secrets: hidden rooms; their doors are found by `nearby` like any venue's, but never listed. */
  readonly secrets: readonly InteriorPlace[];

  private readonly world: CityWorld;

  constructor(world: CityWorld) { this.world = world; this.places = interiorPlaces(world); this.secrets = secretPlaces(world); }

  /** Ground floors (building-interiors.ts) whose entrance is within `radius` of (x, z), nearest
   * first: every other building's door, for door markers. Indexed by 64 m block, built lazily. */
  /** Any enterable place by id: a venue, a secret room or a ground floor (`bldg-<building id>`, built
   * and cached on demand). Null for unknown ids. Returns the same object every call. */
  placeById(id: string): InteriorPlace | null {
    const listed = this.places.find(place => place.id === id) ?? this.secrets.find(place => place.id === id);
    if (listed) return listed;
    const match = BUILDING_PLACE_ID.exec(id);
    if (!match) return null;
    const buildingId = Number(match[1]);
    const building = this.world.buildings[buildingId]?.id === buildingId ? this.world.buildings[buildingId] : this.world.buildings.find(candidate => candidate.id === buildingId);
    const ground = building ? groundFloorPlace(this.world, building) : null;
    // Upper floors: only a floor the building's lift stops at (made once, cached by upper-floors.ts).
    return ground && match[2] !== undefined ? upperFloorPlace(this.world, ground, Number(match[2])) : ground;
  }

  groundFloorsNear(x: number, z: number, radius: number): readonly InteriorPlace[] {
    return groundFloorsNear(this.world, x, z, radius);
  }

  /** The door within `reach` of (x, z), nearest first, with hysteresis: the door returned last time,
   * while still in reach, is kept unless another is nearer by more than NEARBY_MARGIN, so the prompt
   * never flips frame to frame between two adjacent doors. */
  nearby(x: number, z: number, reach = INTERIOR_REACH): InteriorPlace | null {
    let closest: InteriorPlace | null = null, best = reach, held: { place: InteriorPlace; distance: number } | null = null;
    const last = this.lastNearby;
    for (const list of [this.places, this.secrets, groundFloorsNear(this.world, x, z, reach)]) for (const place of list) {
      const distance = Math.hypot(x - place.entrance.x, z - place.entrance.z);
      if (distance >= reach) continue;
      if (place.id === last) held = { place, distance };
      if (distance < best) { best = distance; closest = place; }
    }
    if (held && best >= held.distance - NEARBY_MARGIN) closest = held.place;
    this.lastNearby = closest?.id ?? null;
    return closest;
  }
  private lastNearby: string | null = null;

  enter(place: InteriorPlace, player: Player): void {
    this.active = place;
    this.fixtures = interiorFixtures(place);
    occupants.set(this.fixtures, player);
    if (this.unlockedGates.has(place.id)) this.dropGates();
    this.visitor = player;
    Object.assign(player, interiorWorld(place, 0, place.depth / 2 - 2.2), { yaw: facingIn(place), pitch: 0.02 });
  }

  // ---- Removable door blockers (rpg/locked-rooms.ts) ----------------------------------------------

  /** Places (ids) whose `gate` fixtures are open: the RPG layer fills it from its daily ledger. */
  private readonly unlockedGates = new Set<string>();
  /** Opens `place`'s gates: removed from the active visit now and from every later visit. */
  openGates(placeId: string): void {
    this.unlockedGates.add(placeId);
    if (this.active?.id === placeId) this.dropGates();
  }
  /** Closes every gate again (a new in-game day); the next visit rebuilds them. */
  closeAllGates(): void { this.unlockedGates.clear(); }
  gatesOpen(placeId: string): boolean { return this.unlockedGates.has(placeId); }
  /** Drops the visit's gate fixtures in place (the list's identity carries the occupant and render caches). */
  private dropGates(): void {
    const list = this.fixtures as InteriorFixture[];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === "gate") list.splice(i, 1);
  }

  leave(player: Player): void {
    if (!this.active) return;
    Object.assign(player, this.active.entrance, { yaw: facingIn(this.active) + Math.PI, pitch: 0 });
    this.active = null;
    this.visitor = null;
    this.fixtures = [];
  }

  atExit(x: number, z: number): boolean {
    if (!this.active) return false;
    if (this.active.floor && this.fixtures.some(item => item.kind === "lift")) return false; // Upper floors: the lift is the way down (a floor without one keeps the stairs-out exit)
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

  // ---- Upper floors: the lift (upper-floors.ts) ---------------------------------------------------

  /** The lift the visitor at (x, z) can call: this floor and the next stop it goes to (the stops in
   * turn, upward; the top floor's lift goes back to the ground floor). Null away from a lift or in a
   * building whose lift does not run. */
  liftAt(x: number, z: number): { current: number; next: number } | null {
    const place = this.active;
    if (!place?.stops || place.stops.length < 2) return null;
    const local = interiorLocal(place, x, z);
    if (!this.fixtures.some(item => item.kind === "lift" && Math.hypot(liftLanding(item).x - local.x, liftLanding(item).z - local.z) < LIFT_REACH)) return null;
    const current = place.floor ?? 1, index = place.stops.indexOf(current);
    return { current, next: place.stops[(index + 1) % place.stops.length] };
  }

  /** The prompt at a lift ("Take the lift ▲ Floor 12", "Take the lift ▼ Ground floor"), else null. */
  liftPrompt(x: number, z: number): string | null {
    const lift = this.liftAt(x, z);
    if (!lift || !this.active) return null;
    return `Take the lift ${lift.next > lift.current ? "▲" : "▼"} ${floorTitle(this.active, lift.next)}`;
  }

  /** Rides the lift from the visitor's floor to its next stop: the same building's next floor becomes
   * the active room (a new visit: the scene's arrival fade plays, nothing moves the camera) and the
   * visitor steps out 1 m in front of the lift there, facing into the room. Null when not at a lift. */
  ride(player: Player): InteriorPlace | null {
    const lift = this.liftAt(player.x, player.z), from = this.active;
    if (!lift || !from) return null;
    const place = this.placeById(lift.next === 1 ? `bldg-${from.building}` : `bldg-${from.building}-f${lift.next}`);
    if (!place) return null;
    const before = { x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch };
    this.enter(place, player);
    const landing = this.landingPose();
    if (!landing) { this.enter(from, player); Object.assign(player, before); return null; } // nowhere to step out: the doors stay shut
    Object.assign(player, landing);
    return place;
  }

  /** The world pose 1 m in front of the active room's first lift with free floor there, facing into
   * the room (where a ride arrives); null in a room without one. */
  landingPose(): { x: number; z: number; yaw: number; pitch: number } | null {
    const place = this.active;
    if (!place) return null;
    for (const item of this.fixtures) {
      if (item.kind !== "lift") continue;
      const landing = liftLanding(item), at = interiorWorld(place, landing.x, landing.z);
      if (!this.canOccupy(at.x, at.z)) continue;
      // Room direction (fx, fz) as a player yaw (movePlayer's forward is (sin yaw, -cos yaw)).
      const c = Math.cos(place.yaw), s = Math.sin(place.yaw), wx = c * landing.fx + s * landing.fz, wz = -s * landing.fx + c * landing.fz;
      return { x: at.x, z: at.z, yaw: Math.atan2(wx, -wz), pitch: 0.02 };
    }
    return null;
  }
}
