import { AISLE, DOOR, LANE, Layout, OPPOSITE, S, WALL, YAW, clamp, pick, planFromRecipe, seedOf, seeded, type GroundFloorPlan, type Rect, type RoomInfo, type Side, type Spec } from "./building-interiors.ts";
import { interiorLocal, type GroundFloorKind, type InteriorFixture, type InteriorPlace } from "./interiors.ts";
import { DISTRICTS, LANDMARKS, type Building, type CityWorld, type RGB } from "./world.ts";

/**
 * Upper floors: a tall lobby, office tower, capsule hotel, block of flats or server hall has a working
 * lift. Its ground floor (`bldg-<n>`) lists the lift's stops (`InteriorPlace.stops`: 1, a middle floor
 * or two, the top); each upper stop is a place of its own (`bldg-<n>-f<k>`), with a plan built by the
 * same Layout machinery as the ground floors and window walls looking out over the city at that height.
 *
 * Room space as on the ground floor (+z toward the street face). The lift stands in the middle of the
 * +z wall facing -z; a visitor arrives at (0, depth / 2 - 1.5) facing -z, down the floor's clear lane
 * toward the glass. Everything is deterministic (seeded from the building id and floor), lazy and cached.
 *
 * NOTE (import cycle with building-interiors.ts and interiors.ts): nothing imported from those two may
 * be used at module top level here - only inside functions.
 */

/** Height (m) of the ground floor (= INTERIOR_HEIGHT) and of every storey above it. */
export const GROUND_STOREY = 5.8;
export const STOREY = 4;
/** A building taller than this (m) runs its lift (if its ground floor is one of LIFT_KINDS). */
export const LIFT_TOWER_HEIGHT = 25;
/** The walking eye above a floor (engine WALK_HEIGHT). */
const EYE = 2.7;
/** How near (m) the visitor stands to a lift's landing (1 m in front of its doors) to call it. */
export const LIFT_REACH = 1.8;

export const LIFT_KINDS: readonly GroundFloorKind[] = ["lobby", "corp-lobby", "capsule-hotel", "apartment", "server-hall"];

export type UpperVariant = "apartments" | "offices" | "pods" | "servers" | "penthouse" | "sky-bar" | "plant-deck";
/** Top-floor variants that are open to the sky (no ceiling, a parapet instead of window walls). */
const OPEN_AIR: ReadonlySet<UpperVariant> = new Set<UpperVariant>(["sky-bar", "plant-deck"]);
const MIDDLE: Readonly<Record<string, UpperVariant>> = { lobby: "apartments", apartment: "apartments", "corp-lobby": "offices", "capsule-hotel": "pods", "server-hall": "servers" };
const TOPS: Readonly<Record<string, readonly UpperVariant[]>> = {
  lobby: ["penthouse", "sky-bar", "plant-deck"], apartment: ["penthouse", "sky-bar", "plant-deck"], "corp-lobby": ["sky-bar", "penthouse"],
  "capsule-hotel": ["sky-bar", "plant-deck"], "server-hall": ["plant-deck", "sky-bar"],
};

/** Floors a building of `height` m has: the ground floor plus every whole storey under its roof. */
export function storeysOf(height: number): number {
  return 1 + Math.max(0, Math.floor((height - GROUND_STOREY) / STOREY));
}

/** The floors the lift stops at (1 = the ground floor, then a middle floor or two, then the top), or
 * none for a building too low or of a kind without a lift. */
export function liftStops(building: Building, kind: GroundFloorKind): readonly number[] {
  if (!LIFT_KINDS.includes(kind) || building.height <= LIFT_TOWER_HEIGHT) return [];
  const top = storeysOf(building.height);
  if (top < 4) return [];
  const random = seeded(seedOf(building.id, 71));
  const stops = new Set<number>([1]);
  for (const middle of top >= 16 ? [top / 3, (2 * top) / 3] : [top / 2]) stops.add(clamp(Math.round(middle + (random() - 0.5) * 2), 2, top - 1));
  stops.add(top);
  return [...stops].sort((a, b) => a - b);
}

function variantFor(kind: string, building: number, floor: number, top: boolean): UpperVariant {
  if (!top) return MIDDLE[kind] ?? "apartments";
  const options = TOPS[kind] ?? ["penthouse"];
  return options[Math.floor(seeded(seedOf(building, 89))() * options.length) % options.length];
}

const DESCRIPTIONS: Readonly<Record<UpperVariant, readonly string[]>> = {
  apartments: ["A corridor of front doors, two of them open, and the city at the end of it.", "Flats stacked over the street; somebody is cooking."],
  offices: ["Desks in rows, screens left on, the skyline doing the overtime.", "An open-plan floor that never quite empties."],
  pods: ["Sleeping pods in rows and a lounge with the best view in the building.", "Pods, lockers and a quiet lounge above the rain."],
  servers: ["Racks humming in cold air, a console and a window nobody looks out of.", "A floor of machines keeping somebody's secrets."],
  penthouse: ["Somebody's penthouse: soft couches, hard light and the whole city underfoot.", "Money, glass and a long view."],
  "sky-bar": ["A bar on the roof, string lights over the rain and the city all the way down.", "Drinks above the weather, the skyline for wallpaper."],
  "plant-deck": ["The roof plant: water tanks, fans and a bench for the night crew.", "A maintenance deck with nobody watching the view."],
};
const LINES: Readonly<Record<UpperVariant, readonly string[]>> = {
  apartments: ["THE LIFT TAKES FOREVER", "MIND THE NOODLES", "RENT WENT UP AGAIN", "I CAN SEE MY OLD BLOCK", "SHH, KID'S ASLEEP"],
  offices: ["DEADLINE WAS YESTERDAY", "ONE MORE REPORT", "COFFEE IS SYNTHETIC", "MEETING IN FIVE", "NOBODY LEAVES FIRST"],
  pods: ["CHECKOUT IS AT NOON", "QUIET HOURS", "BEST VIEW IN TOWN", "POD 14 SNORES"],
  servers: ["DON'T TOUCH THE BLUES", "IT'S COLD FOR A REASON", "UPTIME IS EVERYTHING", "THE FANS NEVER STOP"],
  penthouse: ["YOU'RE NOT ON THE LIST", "ENJOY THE VIEW", "BETTER FROM UP HERE", "PLEASE, NO SHOES"],
  "sky-bar": ["WHAT ARE YOU HAVING?", "LAST ORDERS AT FOUR", "RAIN LOOKS BETTER HERE", "YOU CAN SEE THE SPIRE"],
  "plant-deck": ["MIND THE FANS", "TANK THREE IS LEAKING", "BEST BREAK IN TOWN", "DON'T LEAN ON THE RAIL"],
};
const LIGHTS: Readonly<Record<UpperVariant, RGB>> = {
  apartments: [255, 206, 150], offices: [220, 236, 255], pods: [190, 210, 255], servers: [120, 180, 255],
  penthouse: [255, 214, 170], "sky-bar": [255, 176, 120], "plant-deck": [210, 226, 200],
};
const LABELS: Readonly<Record<UpperVariant, string>> = {
  apartments: "CORRIDOR", offices: "OPEN PLAN", pods: "PODS", servers: "SERVER FLOOR", penthouse: "LIVING", "sky-bar": "BAR", "plant-deck": "ROOF DECK",
};

// ---- Places -----------------------------------------------------------------------------------------

interface UpperInfo { variant: UpperVariant; world: CityWorld }
const placeCache = new WeakMap<InteriorPlace, Map<number, InteriorPlace | null>>();
const infoOf = new WeakMap<InteriorPlace, UpperInfo>();

function buildingOf(world: CityWorld, id: number): Building | null {
  const direct = world.buildings[id];
  return direct?.id === id ? direct : world.buildings.find(candidate => candidate.id === id) ?? null;
}

/** Floor `floor` (>= 2, one of the ground floor's lift stops) of `ground`'s building, made once and
 * cached (the same object every call); null for any other floor. Its entrance stays the building's
 * street entrance: leaving, saving or reconnecting from an upper floor lands on the street. */
export function upperFloorPlace(world: CityWorld, ground: InteriorPlace, floor: number): InteriorPlace | null {
  if (ground.floor !== undefined || !ground.stops || floor < 2 || !ground.stops.includes(floor)) return null;
  let cache = placeCache.get(ground);
  if (!cache) { cache = new Map(); placeCache.set(ground, cache); }
  const cached = cache.get(floor);
  if (cached !== undefined) return cached;
  const building = buildingOf(world, ground.building);
  if (!building) { cache.set(floor, null); return null; }
  const variant = variantFor(ground.kind, ground.building, floor, floor === ground.stops[ground.stops.length - 1]);
  const elevation = OPEN_AIR.has(variant) ? building.height : GROUND_STOREY + (floor - 2) * STOREY;
  const random = seeded(seedOf(ground.building, 101 + floor));
  const place: InteriorPlace = { ...ground, id: `${ground.id}-f${floor}`, floor, elevation, description: pick(DESCRIPTIONS[variant], random) };
  infoOf.set(place, { variant, world });
  cache.set(floor, place);
  return place;
}

/** An upper floor's plan variant (null for ground floors and places not made by upperFloorPlace). */
export function upperVariant(place: InteriorPlace): UpperVariant | null {
  return infoOf.get(place)?.variant ?? null;
}

/** True for a top floor open to the sky (a roof bar or plant deck). */
export function upperOpenAir(place: InteriorPlace): boolean {
  const variant = upperVariant(place);
  return variant !== null && OPEN_AIR.has(variant);
}

/** "Ground floor", "Floor 12" or "Roof", for `floor` of `place`'s building (default: place's own). */
export function floorTitle(place: InteriorPlace, floor = place.floor ?? 1): string {
  if (floor <= 1) return "Ground floor";
  const stops = place.stops ?? [];
  if (floor === stops[stops.length - 1] && OPEN_AIR.has(variantFor(place.kind, place.building, floor, true))) return "Roof";
  return `Floor ${floor}`;
}

/** Where a lift fixture's visitor stands (1 m out from its doors, room space) and the way it faces. */
export function liftLanding(item: InteriorFixture): { x: number; z: number; fx: number; fz: number } {
  const yaw = item.yaw ?? 0, fx = Math.round(Math.sin(yaw)), fz = Math.round(Math.cos(yaw));
  const extent = Math.abs(fx) * item.width / 2 + Math.abs(fz) * item.depth / 2 + 1;
  return { x: item.x + fx * extent, z: item.z + fz * extent, fx, fz };
}

// ---- Plans ------------------------------------------------------------------------------------------

const planCache = new WeakMap<InteriorPlace, GroundFloorPlan>();

/** An upper floor's layout (room space, the GroundFloorPlan contract), cached per place. */
export function upperFloorPlan(place: InteriorPlace): GroundFloorPlan {
  const cached = planCache.get(place);
  if (cached) return cached;
  const floor = place.floor ?? 2;
  const variant = upperVariant(place) ?? variantFor(place.kind, place.building, floor, false);
  const plan = planFromRecipe(place, {
    seed: seedOf(place.building, 211 + floor),
    partition: layout => partition(layout, variant, place),
    furnish: (layout, room) => furnish(layout, variant, room),
    lines: LINES[variant], light: LIGHTS[variant], label: LABELS[variant],
  });
  planCache.set(place, plan);
  return plan;
}

/** A piece placed without the fit test (the lift: flush in the core between the corridor walls). It
 * counts as structure (owner -1), so furniture keeps a full aisle from it. */
function force(layout: Layout, item: Spec, x: number, z: number, yaw: number, group: number): InteriorFixture {
  const turned = Math.abs(Math.sin(yaw)) > 0.5;
  const fixture: InteriorFixture = { kind: item.kind, x, z, width: turned ? item.d : item.w, depth: turned ? item.w : item.d, height: item.h, seed: Math.round(layout.random() * 1000) / 1000 };
  if (yaw !== 0) fixture.yaw = yaw;
  layout.fixtures.push(fixture);
  layout.groups.push(group);
  layout.owners.push(-1);
  return fixture;
}

/** The lift in the middle of the +z wall (never dropped by the walkability pass) and its landing. */
function core(layout: Layout): void {
  const group = layout.group("LIFT");
  layout.keep.add(group);
  force(layout, S.lift, 0, layout.hd - S.lift.d / 2, Math.PI, group);
  layout.protect.push({ x0: -1.8, x1: 1.8, z0: layout.hd - 4.4, z1: layout.hd + 1 });
}

/** The clear lane from the lift toward the glass, `length` m (the first view). */
function lane(layout: Layout, length: number): void {
  layout.laneZ0 = Math.max(-layout.hd + 2.6, layout.hd - length);
  layout.protect.push({ x0: -1.4, x1: 1.4, z0: layout.laneZ0, z1: layout.hd + 1 });
}

/** A walled room in a back corner (s: -1 left, 1 right), `w` x `d` m with its wall, a doorway in the
 * middle of its front wall; returns the room's inner rectangle. */
function cornerRoom(layout: Layout, s: -1 | 1, w: number, d: number): Rect {
  const { hw, hd } = layout, inner = s * (hw - w), front = -hd + d;
  layout.wall(inner - WALL / 2, inner + WALL / 2, -hd, front - WALL / 2);
  const lo = s < 0 ? -hw : inner - WALL / 2, hi = s < 0 ? inner + WALL / 2 : hw, gap = s < 0 ? (-hw + inner) / 2 : (inner + hw) / 2;
  layout.wall(lo, gap - DOOR / 2, front - WALL / 2, front + WALL / 2);
  layout.wall(gap + DOOR / 2, hi, front - WALL / 2, front + WALL / 2);
  layout.protect.push({ x0: gap - DOOR / 2 - 0.2, x1: gap + DOOR / 2 + 0.2, z0: front - AISLE, z1: front + AISLE });
  return { x0: s < 0 ? -hw : inner + WALL / 2, x1: s < 0 ? inner - WALL / 2 : hw, z0: -hd, z1: front - WALL / 2 };
}

function partition(layout: Layout, variant: UpperVariant, place: InteriorPlace): RoomInfo[] {
  const { hw, hd, random } = layout, width = place.width, depth = place.depth;
  const whole: Rect = { x0: -hw, x1: hw, z0: -hd, z1: hd };
  core(layout);
  switch (variant) {
    case "apartments": {
      // A corridor from the lift to the glass, a flat either side through an open door.
      const c = 1.6, lo = -hd + 1.2 + DOOR / 2, hi = hd - 5 - DOOR / 2;
      if (width >= 13 && lo <= hi) {
        const rooms: RoomInfo[] = [{ rect: { x0: -c + WALL / 2, x1: c - WALL / 2, z0: -hd, z1: hd }, role: "front", order: 0, label: "CORRIDOR" }];
        layout.laneZ0 = -hd;
        for (const [order, s] of ([-1, 1] as const).entries()) {
          const gap = lo + (hi - lo) * random(), x = s * c;
          layout.wall(x - WALL / 2, x + WALL / 2, -hd, gap - DOOR / 2);
          layout.wall(x - WALL / 2, x + WALL / 2, gap + DOOR / 2, hd);
          layout.protect.push({ x0: x - AISLE, x1: x + AISLE, z0: gap - DOOR / 2 - 0.2, z1: gap + DOOR / 2 + 0.2 });
          const rect = s < 0 ? { x0: -hw, x1: x - WALL / 2, z0: -hd, z1: hd } : { x0: x + WALL / 2, x1: hw, z0: -hd, z1: hd };
          rooms.push({ rect, role: "side", order, label: `APT ${place.floor ?? 2}${String(order + 1).padStart(2, "0")}` });
        }
        return rooms;
      }
      lane(layout, 9);
      return [{ rect: whole, role: "front", order: 0, label: "STUDIO" }];
    }
    case "offices": {
      lane(layout, 9);
      const front: Rect = { ...whole }, rooms: RoomInfo[] = [];
      if (width >= 14 && depth >= 13) {
        // A meeting room in one back corner, the server closet (two racks wide) in the other.
        const s: -1 | 1 = random() < 0.5 ? -1 : 1, mw = clamp(width * 0.36, 5.6, 7.6), md = clamp(depth * 0.34, 4.8, 6.4);
        rooms.push({ rect: cornerRoom(layout, s, mw, md), role: "back", order: 0, label: "MEETING" });
        let back = -hd + md;
        if (width >= mw + 9.2) {
          const closetDepth = 3.4;
          rooms.push({ rect: cornerRoom(layout, s < 0 ? 1 : -1, 4.82 + WALL / 2, closetDepth), role: "back", order: 1, label: "SERVERS" });
          back = Math.max(back, -hd + closetDepth);
        }
        front.z0 = back + WALL / 2;
      }
      return [{ rect: front, role: "front", order: 0, label: "OPEN PLAN" }, ...rooms];
    }
    case "pods": {
      lane(layout, 8);
      if (depth < 14) return [{ rect: whole, role: "front", order: 0, label: "PODS" }];
      // The lounge across the glass at the back, through a doorway on the lane.
      const zb = -hd + clamp(depth * 0.36, 5.4, 7);
      layout.wall(-hw, -DOOR / 2, zb - WALL / 2, zb + WALL / 2);
      layout.wall(DOOR / 2, hw, zb - WALL / 2, zb + WALL / 2);
      layout.protect.push({ x0: -DOOR / 2 - 0.2, x1: DOOR / 2 + 0.2, z0: zb - AISLE, z1: zb + AISLE });
      return [
        { rect: { ...whole, z0: zb + WALL / 2 }, role: "front", order: 0, label: "PODS" },
        { rect: { ...whole, z1: zb - WALL / 2 }, role: "back", order: 0, label: "LOUNGE" },
      ];
    }
    case "servers":
      lane(layout, 7);
      return [{ rect: whole, role: "front", order: 0, label: "SERVER FLOOR" }];
    case "penthouse": {
      lane(layout, 9);
      if (width >= 14 && depth >= 13) {
        const s: -1 | 1 = random() < 0.5 ? -1 : 1, bw = clamp(width * 0.34, 5.4, 7), bd = clamp(depth * 0.36, 5.2, 7);
        const bedroom = cornerRoom(layout, s, bw, bd);
        return [{ rect: { ...whole, z0: -hd + bd + WALL / 2 }, role: "front", order: 0, label: "LIVING" }, { rect: bedroom, role: "back", order: 0, label: "BEDROOM" }];
      }
      return [{ rect: whole, role: "front", order: 0, label: "LIVING" }];
    }
    case "sky-bar":
      lane(layout, 8);
      return [{ rect: whole, role: "front", order: 0, label: "BAR" }];
    case "plant-deck":
      lane(layout, 8);
      return [{ rect: whole, role: "front", order: 0, label: "ROOF DECK" }];
  }
}

const STOOL: Spec = { kind: "stool", w: 0.55, d: 0.55, h: 0.78 };
const HIGH_TABLE: Spec = { kind: "table", w: 1.0, d: 1.0, h: 1.05 };
const MEETING_TABLE: Spec = { kind: "table", w: 3.0, d: 1.2, h: 0.78 };
const DINING_TABLE: Spec = { kind: "table", w: 1.4, d: 0.9, h: 0.78 };
/** Facing (degrees, 180 = toward +z, -90 = toward +x) of someone looking along (fx, fz). */
const facing = (fx: number, fz: number): number => Math.round(Math.atan2(-fx, -fz) * 180 / Math.PI);

/** A table with a seat either side along x (`seat`: chair or stool), as one group; a sitter on one. */
function tableSet(layout: Layout, table: Spec, seat: Spec, x: number, z: number, label: string): boolean {
  const group = layout.group(label);
  const placed = layout.put(table, x, z, 0, group);
  if (!placed) return false;
  for (const s of [-1, 1]) {
    const at = x + s * (table.w / 2 + 0.12 + seat.d / 2);
    const chair = layout.put(seat, at, z, s < 0 ? Math.PI / 2 : -Math.PI / 2, group);
    if (chair) layout.spots.push({ x: at, z, facing: facing(-s, 0), seat: chair, staff: false });
  }
  return true;
}

/** A couch against `wall` facing into the room, a low table in front of it (one group). */
function couchSet(layout: Layout, r: Rect, wall: Side, t: number): InteriorFixture | null {
  const couch = layout.seatOnWall(r, wall, S.couch, t, "COUCH");
  if (!couch) return null;
  const fx = Math.round(Math.sin(YAW[wall])), fz = Math.round(Math.cos(YAW[wall])), out = (Math.abs(fx) * couch.width + Math.abs(fz) * couch.depth) / 2 + 0.6 + S.lowTable.d / 2;
  layout.put(S.lowTable, couch.x + fx * out, couch.z + fz * out, YAW[wall], layout.groups[layout.groups.length - 1]);
  return couch;
}

/** One flat off the corridor: kitchenette and couch on the corridor wall, the bed by the window. */
function flat(layout: Layout, r: Rect): void {
  const inner: Side = r.x1 <= 0 ? "right" : "left", outer = OPPOSITE[inner], tOuter = outer === "left" ? 0 : 1;
  if (!layout.onWall(r, inner, S.kitchenette, 0.92, layout.group("KITCHEN"))) layout.onWall(r, inner, S.kitchenette, 0.08, layout.group("KITCHEN"));
  if (!couchSet(layout, r, inner, 0.45)) couchSet(layout, r, inner, 0.25);
  layout.onWall(r, "back", S.bed, tOuter, layout.group("BED"));
  layout.onWall(r, "front", S.planter, tOuter, layout.group());
  layout.onWall(r, "front", S.shelf, 1 - tOuter, layout.group("SHELF"));
}

/** Rows of desks either side of the lane, each with its chair (someone may sit at one). */
function deskRows(layout: Layout, r: Rect): void {
  const desk = S.desk, chair = S.chair, pitch = desk.d + 0.15 + chair.d + AISLE + 0.05;
  for (let z = r.z0 + AISLE + desk.d / 2; z + desk.d / 2 + 0.15 + chair.d <= layout.hd - 0.5; z += pitch) {
    const group = layout.group("DESKS");
    for (const s of [-1, 1]) {
      for (let x = LANE + desk.w / 2; x + desk.w / 2 <= layout.hw + 0.01; x += desk.w + 0.05) {
        if (!layout.put(desk, s * x, z, 0, group)) continue;
        const cz = z + desk.d / 2 + 0.15 + chair.d / 2, seat = layout.put(chair, s * x, cz, Math.PI, group);
        if (seat) layout.spots.push({ x: s * x, z: cz, facing: 0, seat, staff: true });
      }
    }
  }
}

function furnish(layout: Layout, variant: UpperVariant, room: RoomInfo): void {
  const L = layout, r = room.rect, random = L.random, cz = (r.z0 + r.z1) / 2;
  const lr: "left" | "right" = random() < 0.5 ? "left" : "right", rl: "left" | "right" = lr === "left" ? "right" : "left";
  const tl = lr === "left" ? 0 : 1, tr = 1 - tl;
  switch (variant) {
    case "apartments":
      if (room.label === "CORRIDOR") return; // kept clear: the walk to the window at its end
      if (room.role === "side") { flat(L, r); return; }
      // A studio across the whole floor.
      L.onWall(r, lr, S.kitchenette, 0.85, L.group("KITCHEN"));
      if (!couchSet(L, r, rl, 0.5)) couchSet(L, r, rl, 0.3);
      L.onWall(r, "back", S.bed, tl, L.group("BED"));
      L.onWall(r, lr, S.shelf, 0.4, L.group("SHELF"));
      L.onWall(r, "back", S.planter, tr, L.group());
      return;
    case "offices":
      if (room.label === "MEETING") {
        // The meeting table against the glass, chairs on the room side: the meeting faces the view.
        const group = L.group("MEETING"), table = L.onWall(r, "back", MEETING_TABLE, r.x0 < 0 ? 0 : 1, group);
        if (table) for (const dx of [-0.8, 0.8]) {
          const z = table.z + table.depth / 2 + 0.15 + S.chair.d / 2, seat = L.put(S.chair, table.x + dx, z, Math.PI, group);
          if (seat) L.spots.push({ x: table.x + dx, z, facing: 0, seat, staff: false });
        }
        L.onWall(r, "front", S.planter, r.x0 < 0 ? 0 : 1, L.group());
        return;
      }
      if (room.label === "SERVERS") { L.wallLine(r, "back", S.rack, "RACKS", 0); return; }
      L.onWall(r, "front", S.vending, tl, L.group("VEND"));
      L.onWall(r, "front", S.planter, tr, L.group());
      deskRows(L, r);
      return;
    case "pods":
      if (room.role === "back") {
        // The lounge: couches on the partition looking out, a vending machine, planters by the glass.
        couchSet(L, r, "front", 0.12);
        couchSet(L, r, "front", 0.88);
        L.onWall(r, lr, S.vending, 0.5, L.group("VEND"));
        L.onWall(r, "back", S.planter, 0, L.group());
        L.onWall(r, "back", S.planter, 1, L.group());
        return;
      }
      L.wallLine(r, "front", S.locker, "LOCKERS", 0.05, 0, 0.3);
      L.wallLine(r, "front", S.locker, "LOCKERS", 0.05, 0.7, 1);
      L.wallLine(r, "left", S.pod, "PODS", 0.05);
      L.wallLine(r, "right", S.pod, "PODS", 0.05);
      L.sideRows(r, S.pod, "PODS", { pair: true, reserve: S.pod.d, gap: 0.05, maxRows: 2 });
      if (room.label === "PODS" && r.z0 <= -L.hd + 0.01) { couchSet(L, r, "back", 0.15); couchSet(L, r, "back", 0.85); }
      return;
    case "servers":
      L.deskWithChair(r, "front", [tl === 0 ? 0.12 : 0.88, tl === 0 ? 0.3 : 0.7], "CONSOLE");
      L.sideRows(r, S.rack, "RACKS", { pair: r.x1 - r.x0 >= 13.5, gap: 0.05 });
      L.wallLine(r, "back", S.tank, "COOLANT", 0.3, 0, 0.3);
      L.wallLine(r, "back", S.tank, "COOLANT", 0.3, 0.7, 1);
      return;
    case "penthouse":
      if (room.label === "BEDROOM") {
        const outer = r.x0 <= -L.hw + 0.01 ? 0 : 1;
        L.onWall(r, "back", S.bed, outer, L.group("BED"));
        L.onWall(r, outer === 0 ? "right" : "left", S.shelf, 0.3, L.group("WARDROBE"));
        L.onWall(r, "front", S.planter, outer, L.group());
        return;
      }
      L.onWall(r, "front", S.kitchenette, tl, L.group("KITCHEN"));
      L.onWall(r, "front", S.shelf, tr, L.group("BAR"));
      // Couches facing the glass beside the lane, a low table between them and the view.
      for (const s of lr === "left" ? [-1, 1] : [1, -1]) {
        const group = L.group("LOUNGE"), x = s * (LANE + 0.25 + S.couch.w / 2), tz = r.z0 + AISLE + S.lowTable.d / 2;
        if (!L.put(S.lowTable, x, tz, 0, group)) continue;
        const z = tz + S.lowTable.d / 2 + 0.6 + S.couch.d / 2, couch = L.put(S.couch, x, z, Math.PI, group);
        if (couch) L.spots.push({ x, z, facing: 0, seat: couch, staff: false });
        break;
      }
      if (!tableSet(L, DINING_TABLE, S.chair, (lr === "left" ? 1 : -1) * (LANE + 2.6), cz + 1.5, "DINING")) tableSet(L, DINING_TABLE, S.chair, (lr === "left" ? 1 : -1) * (LANE + 2.6), cz, "DINING");
      L.firstFit(S.sculpture, [[(lr === "left" ? -1 : 1) * (LANE + 1.4), cz + 2, 0], [(lr === "left" ? 1 : -1) * (LANE + 1.4), cz - 1.5, 0]], "ART");
      L.onWall(r, lr, S.planter, 0, L.group());
      L.onWall(r, rl, S.planter, 0, L.group());
      return;
    case "sky-bar": {
      // The bar along one parapet (staff walkway and a back shelf), stools at it, high tables opposite.
      const counter = L.serviceCounter(r, lr, S.counter, [0.45, 0.6, 0.3], S.shelf, "BAR");
      if (counter) {
        const group = L.groups[L.fixtures.indexOf(counter)], s = lr === "left" ? 1 : -1;
        const x = counter.x + s * (counter.width / 2 + 0.15 + STOOL.d / 2);
        for (const dz of [-1.05, 0, 1.05]) {
          const stool = L.put(STOOL, x, counter.z + dz, 0, group);
          if (stool) L.spots.push({ x, z: counter.z + dz, facing: facing(-s, 0), seat: stool, staff: false });
        }
      }
      const side = lr === "left" ? 1 : -1;
      for (let z = r.z0 + AISLE + 0.5; z < L.hd - 4.6; z += 3.3) tableSet(L, HIGH_TABLE, STOOL, side * (LANE + 2.2), z, "TABLES");
      L.onWall(r, "back", S.planter, 0, L.group());
      L.onWall(r, "back", S.planter, 1, L.group());
      L.onWall(r, rl, S.planter, 0.98, L.group());
      return;
    }
    case "plant-deck":
      L.corner(r, "back", lr, S.tank, 2, 1, "TANKS");
      L.wallLine(r, rl, S.machine, "HVAC", 0.4, 0.05, 0.6);
      L.corner(r, "front", rl, S.crate, 1, 2, "CRATES");
      L.onWall(r, "front", S.locker, tl, L.group("TOOLS"));
      L.seatOnWall(r, lr, S.bench, 0.75, "BENCH");
      return;
  }
}

// ---- The view: the real city outside the glass -----------------------------------------------------

/** A tower outside the window, scaled toward the eye (room space; y = height of its centre above the
 * floor). `pitch` is its floor-to-floor spacing at that scale, for the lit window grid. */
export interface BackdropTower { x: number; y: number; z: number; w: number; h: number; d: number; color: RGB; pitch: number }
/** A lit shape outside: a rooftop sign, an aircraft lamp, the Spire's setback lines and crown. */
export interface BackdropGlow { x: number; y: number; z: number; w: number; h: number; d: number; color: RGB }
export interface Backdrop { towers: readonly BackdropTower[]; glows: readonly BackdropGlow[]; haze: RGB }

/** Every outside building is scaled about the room-centre eye (a homothety about the eye keeps its
 * image from there exact) so that its nearest point lands on a ring this near/far (m) by its real
 * distance: nearer buildings stay in front of farther ones and nothing comes into the room. */
const RING_NEAR = 24;
const RING_FAR = 40;
/** Scaled boxes are cut to this square (m) round the room centre, inside the interior camera's 60 m
 * far plane; the city-glow octagon (interior-scene.ts HAZE_RING 47) stands behind every near face. */
const VIEW_LIMIT = 42;
/** World range (m) of buildings shown, and how far above/below the eye a scaled box may reach. */
const VIEW_RANGE = 380;
const VERTICAL_CLIP = 42;
const MAX_TOWERS = 170;
/** Lit shapes outside never shrink below this (m; about a cell at the ring), so none can shimmer. */
const GLOW_MIN = 0.5;
const WINDOW_LIGHT: RGB = [255, 196, 130];

const backdropCache = new WeakMap<InteriorPlace, Backdrop>();
const mixRGB = (a: RGB, b: RGB, k: number, gain = 1): RGB => [(a[0] + (b[0] - a[0]) * k) * gain, (a[1] + (b[1] - a[1]) * k) * gain, (a[2] + (b[2] - a[2]) * k) * gain];

/** The city outside an upper floor's windows, built once per place (null on ground floors). */
export function upperBackdrop(place: InteriorPlace): Backdrop | null {
  const info = infoOf.get(place);
  if (!info || place.elevation === undefined) return null;
  const cached = backdropCache.get(place);
  if (cached) return cached;
  const eyeHeight = place.elevation + EYE, turned = Math.abs(Math.sin(place.yaw)) > 0.5;
  const ring = (d: number) => RING_NEAR + (RING_FAR - RING_NEAR) * clamp((d - 8) / (VIEW_RANGE - 8), 0, 1);
  const haze = (d: number) => 1 - 0.62 * clamp((d - 30) / (VIEW_RANGE - 30), 0, 1);
  /** Distance (m) from the room centre to the nearest point of a footprint (centre lx, lz; half sizes hx, hz). */
  const nearest = (lx: number, lz: number, hx: number, hz: number) => Math.hypot(Math.max(0, Math.abs(lx) - hx), Math.max(0, Math.abs(lz) - hz));
  const towers: BackdropTower[] = [], glows: BackdropGlow[] = [];
  // A footprint scaled by s (room-space centre and sizes; bottom..top world heights), cut to the view.
  const scaled = (lx: number, lz: number, w: number, d: number, bottom: number, top: number, s: number) => {
    const y0 = Math.max(EYE + s * (bottom - eyeHeight), EYE - VERTICAL_CLIP), y1 = Math.min(EYE + s * (top - eyeHeight), EYE + VERTICAL_CLIP);
    const x0 = Math.max((lx - w / 2) * s, -VIEW_LIMIT), x1 = Math.min((lx + w / 2) * s, VIEW_LIMIT);
    const z0 = Math.max((lz - d / 2) * s, -VIEW_LIMIT), z1 = Math.min((lz + d / 2) * s, VIEW_LIMIT);
    return y1 - y0 < 0.05 || x1 - x0 < 0.05 || z1 - z0 < 0.05 ? null : { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y: (y0 + y1) / 2, h: y1 - y0 };
  };
  const lit = (box: { x: number; y: number; z: number; w: number; h: number; d: number }, color: RGB): BackdropGlow =>
    ({ x: box.x, y: box.y, z: box.z, w: Math.max(GLOW_MIN, box.w), h: Math.max(GLOW_MIN, box.h), d: Math.max(GLOW_MIN, box.d), color });
  const near = info.world.buildings.filter(building => building.id !== place.building).map(building => {
    const local = interiorLocal(place, building.x, building.z), w = turned ? building.depth : building.width, d = turned ? building.width : building.depth;
    return { building, local, w, d, distance: nearest(local.x, local.z, w / 2, d / 2) };
  }).filter(({ building, local, distance }) => distance > 1 && Math.hypot(local.x, local.z) < VIEW_RANGE && (building.height - eyeHeight) / distance > -0.5)
    .sort((a, b) => a.distance - b.distance).slice(0, MAX_TOWERS);
  for (const { building, local, w, d, distance } of near) {
    const s = ring(distance) / distance, gain = haze(distance);
    const box = scaled(local.x, local.z, w, d, 0, building.height, s);
    if (!box) continue;
    towers.push({ ...box, color: mixRGB(WINDOW_LIGHT, building.accent, 0.3, gain), pitch: 3.6 * s });
    // A rooftop sign on every third tower, an aircraft lamp on the tall ones (both steady).
    const roof = EYE + s * (building.height - eyeHeight);
    if (roof > EYE + VERTICAL_CLIP - 1) continue;
    const sign = building.id % 3 === 0 ? Math.max(GLOW_MIN, 2.4 * s) : 0;
    if (sign) glows.push(lit({ x: box.x, y: roof + sign / 2, z: box.z, w: box.w * 0.6, h: sign, d: box.d * 0.6 }, mixRGB(building.accent, WINDOW_LIGHT, 0, 0.55 + 0.35 * gain)));
    if (building.height > 80) {
      const lamp = Math.max(GLOW_MIN, 1.6 * s);
      glows.push(lit({ x: box.x, y: roof + sign + lamp / 2, z: box.z, w: lamp, h: lamp, d: lamp }, [230 * gain, 50 * gain, 70 * gain]));
    }
  }
  // The Meridian Spire wherever it stands: its stacked stages, the lit setback lines, the crown.
  const spire = LANDMARKS.find(landmark => landmark.kind === "spire");
  if (spire) {
    const local = interiorLocal(place, spire.x, spire.z), distance = nearest(local.x, local.z, 11, 11);
    if (distance > 8) {
      const s = ring(Math.min(distance, VIEW_RANGE)) / distance, gain = haze(Math.min(distance, VIEW_RANGE));
      let base = 2.8;
      for (const [w, h] of [[22, 40], [19, 34], [15.5, 30], [12, 26], [8.5, 22]] as const) {
        const box = scaled(local.x, local.z, w, w, base, base + h, s);
        if (box) towers.push({ ...box, color: mixRGB(WINDOW_LIGHT, spire.color, 0.55, gain * 0.8), pitch: 3.6 * s });
        const ledge = scaled(local.x, local.z, w + 1.4, w + 1.4, base + h - 0.3, base + h + 0.3, s);
        if (ledge) glows.push(lit(ledge, mixRGB(spire.color, WINDOW_LIGHT, 0, gain)));
        base += h;
      }
      const crown = scaled(local.x, local.z, 3, 3, base, base + 6, s);
      if (crown) glows.push(lit(crown, [255, 90, 170]));
    }
  }
  const backdrop: Backdrop = { towers, glows, haze: DISTRICTS[place.district]?.color ?? WINDOW_LIGHT };
  backdropCache.set(place, backdrop);
  return backdrop;
}
