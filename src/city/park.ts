/**
 * Rootwood Park: a 3x3-block city park around The Last Tree (Rain Gardens), and the future boss
 * arena. Pure data and geometry, no imports, so world.ts (collision, plots), materials.ts (the
 * ground shader, generated from these same constants), park-scene.ts (props), the maps and the
 * RPG systems can all share it without an import cycle.
 *
 * The park spans the blocks between the streets x = -576..-384 and z = 192..384. Those boundary
 * streets keep their traffic, kerbside parking and lamps. Inside, the four old streets
 * (x = -512, -448, z = 256, 320) become 17 m stone promenades; their traffic runs on in an
 * underpass beneath the park, entering and leaving through dark tunnel mouths in eight gatehouses
 * just inside the boundary junctions (traffic.ts hides cars under the lawns). Residents keep
 * walking the old pavement lines (7.2 m off the centre lines), so furniture stays clear of them.
 *
 * Numbers that mirror other modules (rail supports, the station, The Last Tree, Sister Wren) are
 * restated here so this file needs no imports; tests/park.test.ts checks them against the source.
 */

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Circle { x: number; z: number; radius: number }
export type TreeSpecies = "oak" | "pine" | "willow" | "blossom" | "lime";
export interface ParkTree { x: number; z: number; species: TreeSpecies; height: number; canopy: number; seed: number }
export interface ParkLantern { x: number; z: number; kind: "lantern" | "brazier" }
export interface ParkBench { x: number; z: number; yaw: number }
export type SculptureKind = "lotus" | "obelisk" | "koi" | "moth";
export interface ParkSculpture { x: number; z: number; kind: SculptureKind; radius: number; name: string }
/** A tunnel gatehouse: `axis` is the direction its street runs, `side` the boundary it faces
 * (-1: the low boundary street, +1: the high one), `line` the street's centre coordinate. */
export interface ParkGate { axis: "x" | "z"; line: number; side: -1 | 1 }
/** Oriented box footprint: centre, half extents along its own axes, heading (radians, world x->z). */
export interface Footprint { x: number; z: number; hx: number; hz: number; angle: number }
/** An arena seating block (tier 0 is the lowest, nearest the circle). */
export interface ParkSeat extends Footprint { tier: number }
export interface ParkSegment { x0: number; z0: number; x1: number; z1: number }
export interface ParkPath { name: string; points: readonly (readonly [number, number])[]; segments: ParkSegment[] }
export interface ParkPlaza extends Circle { name: string }

/** Street centre lines bounding the park. */
export const PARK: Rect = { minX: -576, maxX: -384, minZ: 192, maxZ: 384 };
/** Lawns begin this far in from the boundary streets' centre lines (road, kerb and pavement first). */
export const PARK_EDGE = 10;
export const PARK_INTERIOR: Rect = { minX: PARK.minX + PARK_EDGE, maxX: PARK.maxX - PARK_EDGE, minZ: PARK.minZ + PARK_EDGE, maxZ: PARK.maxZ - PARK_EDGE };
/** Inside the park's hedged interior (lawns, promenades, water). */
export const inPark = (x: number, z: number): boolean => x > PARK_INTERIOR.minX && x < PARK_INTERIOR.maxX && z > PARK_INTERIOR.minZ && z < PARK_INTERIOR.maxZ;
/** The whole park including its boundary streets' inner halves. */
export const nearPark = (x: number, z: number, margin = 0): boolean => x > PARK.minX - margin && x < PARK.maxX + margin && z > PARK.minZ - margin && z < PARK.maxZ + margin;
/** City blocks (64 m cells) that belong to the park: no building plots. */
export const parkBlock = (bx: number, bz: number): boolean => bx >= PARK.minX / 64 && bx < PARK.maxX / 64 && bz >= PARK.minZ / 64 && bz < PARK.maxZ / 64;

/** The old streets inside the park, now promenades. */
export const PROMENADE_X: readonly number[] = [-512, -448];
export const PROMENADE_Z: readonly number[] = [256, 320];
export const PROMENADE_HALF = 8.5;
/** Residents' pavement lines run this far off every street centre line (people.ts). */
export const WALK_LINE = 7.2;

/** Gatehouse geometry, measured from the boundary street's centre line along the park street:
 * tunnel mouths from GATE_FACE to GATE_FACE + GATE_DEPTH, spanning the carriageway from
 * GATE_INNER (the pedestrian arch on the old centre line stays open) to GATE_OUTER (inside the
 * 7.2 m walking lines). A car lane (3 m out, 2.7 m wide) lies wholly inside a mouth. */
export const GATE_FACE = 13.5, GATE_DEPTH = 8, GATE_INNER = 1.3, GATE_OUTER = 6.6, GATE_HEIGHT = 5.4, GATE_MOUTH = 3.6;
export const PARK_GATES: readonly ParkGate[] = [
  ...PROMENADE_X.flatMap(line => ([-1, 1] as const).map(side => ({ axis: "z" as const, line, side }))),
  ...PROMENADE_Z.flatMap(line => ([-1, 1] as const).map(side => ({ axis: "x" as const, line, side }))),
];
/** Along-street coordinate of a gate's outer face. */
export function gateFace(gate: ParkGate): number {
  const low = gate.axis === "z" ? PARK.minZ : PARK.minX, high = gate.axis === "z" ? PARK.maxZ : PARK.maxX;
  return gate.side < 0 ? low + GATE_FACE : high - GATE_FACE;
}
/** Traffic under the park is drawn only until it is inside a tunnel mouth (car half-length 2.9). */
export const UNDERPASS: Rect = { minX: PARK.minX + GATE_FACE + 5, maxX: PARK.maxX - GATE_FACE - 5, minZ: PARK.minZ + GATE_FACE + 5, maxZ: PARK.maxZ - GATE_FACE - 5 };
export const underPark = (x: number, z: number): boolean => x > UNDERPASS.minX && x < UNDERPASS.maxX && z > UNDERPASS.minZ && z < UNDERPASS.maxZ;

/** Perimeter hedge band, measured in from the boundary streets. */
export const HEDGE_NEAR = 10.5, HEDGE_FAR = 11.7, HEDGE_HEIGHT = 1.25;

/** The boss arena: an open, lit stone circle at the old Hollis Street crossing, south of the tree. */
export const PARK_ARENA: Circle = { x: -500, z: 350, radius: 20 };
/** Stage on the arena's east rim, facing west across the circle. */
export const ARENA_STAGE: Rect = { minX: -476, maxX: -469.5, minZ: 341, maxZ: 359 };
export const ARENA_PILLAR_RADIUS = 23.5;
export const ARENA_SEAT_RADII: readonly number[] = [26.5, 28.5, 30.5];

/** The pond (a lobed ellipse, see pondField) and its footbridge. */
export const POND = { x: -416, z: 224, rx: 16, rz: 14 };
export const BRIDGE = { x0: -431, z0: 211, x1: -401, z1: 237, half: 1.5 };
/** Pond shape: < 1 is water. The shader evaluates the same expression. */
export function pondField(x: number, z: number): number {
  const qx = (x - POND.x) / POND.rx, qz = (z - POND.z) / POND.rz, a = Math.atan2(qz, qx);
  return Math.hypot(qx, qz) / (1 + 0.1 * Math.sin(2 * a + 0.6) + 0.07 * Math.sin(3 * a + 2.1));
}
/** Where the water blocks walking (a little bank margin so feet stay on dry ground). */
export const POND_BLOCK = 1.06;
export const FOUNTAIN: Circle = { x: -480, z: 224, radius: 6 };
/** Water surface inside the fountain basin. */
export const FOUNTAIN_WATER = 5.4;

/** Things other modules own that stand inside the park; everything placed here keeps clear. */
export const LAST_TREE = { x: -480, z: 288 };
const RAIL_ARC = 64, RAIL_ARC_ANGLE = 0.56;
/** Rail legs and station columns in the park (world.ts RAIL_SOLIDS; the test checks them). */
export const PARK_RAIL_SOLIDS: readonly { x: number; z: number; half: number }[] = [
  { x: -521, z: 224, half: 0.65 }, { x: -503, z: 224, half: 0.65 },
  { x: -416, z: 311, half: 0.65 }, { x: -416, z: 329, half: 0.65 },
  { x: -448 - Math.sin(RAIL_ARC_ANGLE) * RAIL_ARC, z: 256 + Math.cos(RAIL_ARC_ANGLE) * RAIL_ARC, half: 0.9 },
  { x: -448 - Math.cos(RAIL_ARC_ANGLE) * RAIL_ARC, z: 256 + Math.sin(RAIL_ARC_ANGLE) * RAIL_ARC, half: 0.9 },
  ...[-24, -16, 16, 24].map(v => ({ x: -448 + v, z: 311, half: 0.55 })),
];
/** Rain Gardens station (x -448, z 320): its lift and the forecourt where commuters browse. */
export const STATION_KEEP: Rect = { minX: -444, maxX: -424, minZ: 296, maxZ: 314 };
/** Named NPCs in the park (npcs.ts): Sister Wren. */
export const PARK_NPCS: readonly { x: number; z: number }[] = [{ x: -494, z: 272 }];

// ---- Paths ---------------------------------------------------------------------------------------
export const PATH_HALF = 1.3;
/** Winding gravel paths, as control points; smoothed into short segments below. */
const PATH_POINTS: readonly { name: string; points: readonly (readonly [number, number])[]; loop?: boolean }[] = [
  { name: "Lantern Walk", points: [[-569, 199], [-558, 208], [-549, 219], [-541, 229], [-530, 237], [-519.5, 241]] },
  { name: "Fountain north", points: [[-480, 213], [-482, 206], [-481, 198]] },
  { name: "Fountain west", points: [[-490.5, 228], [-497, 233], [-504.5, 235.5]] },
  { name: "Fountain east", points: [[-469.5, 227], [-462, 231.5], [-455.5, 232.5]] },
  { name: "Fountain south", points: [[-478.5, 235], [-476, 242], [-477, 248.5]] },
  { name: "Pond bank", points: [215, 190, 165, 140, 115, 90, 65, 40].map(d => [POND.x + 21 * Math.cos(d * Math.PI / 180), POND.z + 19.5 * Math.sin(d * Math.PI / 180)] as const) },
  { name: "Pond bridge", points: [[BRIDGE.x0, BRIDGE.z0], [BRIDGE.x1, BRIDGE.z1]] },
  { name: "Pond walk", points: [[-432, 236.4], [-436.5, 243], [-440.5, 248.5]] },
  { name: "Pond north gate", points: [[BRIDGE.x0, BRIDGE.z0], [-433.5, 205], [-434.5, 198]] },
  { name: "Old Wood", points: [[-569, 290], [-557, 284], [-546, 289], [-536, 297], [-527, 302], [-519.5, 303.5]] },
  { name: "Tree ring", loop: true, points: Array.from({ length: 28 }, (_, i) => [LAST_TREE.x + 19 * Math.cos(i * Math.PI * 2 / 28), LAST_TREE.z + 19 * Math.sin(i * Math.PI * 2 / 28)] as const) },
  { name: "Wren's way", points: [[LAST_TREE.x - 13.4, LAST_TREE.z - 13.4], [-498.5, 269.5], [-503.5, 265]] },
  { name: "Station way", points: [[LAST_TREE.x + 13.4, LAST_TREE.z + 13.4], [-462, 306], [-458.5, 309.5]] },
  { name: "Tree north", points: [[LAST_TREE.x, LAST_TREE.z - 19], [-480.5, 264]] },
  { name: "Tree east", points: [[LAST_TREE.x + 19, LAST_TREE.z], [-456, 288.5]] },
  { name: "Sculpture walk", points: [[-439, 308.5], [-430, 298], [-417, 291], [-406, 281], [-400, 269], [-399.5, 264]] },
  { name: "Arena west", points: [[-569, 378], [-557, 368], [-546, 359], [-535, 352.5], [-521, 350]] },
  { name: "Arena south", points: [[-491, 369.5], [-490, 375], [-489, 380]] },
  { name: "South lawn", points: [[-440, 332], [-430, 342], [-420, 352.5], [-410, 362], [-399, 378]] },
];

/** Catmull-Rom through the control points, cut into ~3 m chords (shader and collision share them). */
function smooth(points: readonly (readonly [number, number])[], loop: boolean): ParkSegment[] {
  const n = points.length, out: ParkSegment[] = [];
  if (n === 2) return [{ x0: points[0][0], z0: points[0][1], x1: points[1][0], z1: points[1][1] }];
  const at = (i: number) => points[loop ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const spans = loop ? n : n - 1;
  let px = points[0][0], pz = points[0][1];
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const steps = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      const x = f(p0[0], p1[0], p2[0], p3[0]), z = f(p0[1], p1[1], p2[1], p3[1]);
      out.push({ x0: px, z0: pz, x1: x, z1: z }); px = x; pz = z;
    }
  }
  return out;
}
export const PARK_PATHS: readonly ParkPath[] = PATH_POINTS.map(p => ({ name: p.name, points: p.points, segments: smooth(p.points, p.loop ?? false) }));

export const PARK_PLAZAS: readonly ParkPlaza[] = [
  { name: "Crossroads", x: -512, z: 256, radius: 13 },
  { name: "Pond steps", x: -448, z: 256, radius: 11 },
  { name: "Station forecourt", x: -448, z: 320, radius: 15 },
  { name: "Arena forecourt", x: -512, z: 320, radius: 11 },
  { name: "Fountain court", x: FOUNTAIN.x, z: FOUNTAIN.z, radius: 11 },
];

export const PARK_SCULPTURES: readonly ParkSculpture[] = [
  { kind: "obelisk", x: -549, z: 238, radius: 1.6, name: "Signal Obelisk" },
  { kind: "lotus", x: -541, z: 274, radius: 3.2, name: "Lotus Rings" },
  { kind: "koi", x: -413, z: 301, radius: 2.4, name: "Koi Gate" },
  { kind: "moth", x: -424, z: 365, radius: 2.2, name: "Moth Lamp" },
];

// ---- Geometry helpers ----------------------------------------------------------------------------
export function segmentDistance(x: number, z: number, s: ParkSegment): number {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / l2)) : 0;
  return Math.hypot(x - s.x0 - dx * t, z - s.z0 - dz * t);
}
/** Distance to the nearest gravel path centre line. */
export function pathDistance(x: number, z: number): number {
  let best = Infinity;
  for (const path of PARK_PATHS) for (const s of path.segments) best = Math.min(best, segmentDistance(x, z, s));
  return best;
}
/** Lateral distance to the nearest promenade centre line. */
export function promenadeDistance(x: number, z: number): number {
  return Math.min(...PROMENADE_X.map(line => Math.abs(x - line)), ...PROMENADE_Z.map(line => Math.abs(z - line)));
}
/** Signed distance to the nearest plaza rim (negative inside). */
export function plazaDistance(x: number, z: number): number {
  return Math.min(...PARK_PLAZAS.map(p => Math.hypot(x - p.x, z - p.z) - p.radius));
}
/** Distance to the nearest residents' pavement line inside the park blocks. */
export function walkLineDistance(x: number, z: number): number {
  let best = Infinity;
  for (let line = PARK.minX; line <= PARK.maxX; line += 64) best = Math.min(best, Math.abs(Math.abs(x - line) - WALK_LINE));
  for (let line = PARK.minZ; line <= PARK.maxZ; line += 64) best = Math.min(best, Math.abs(Math.abs(z - line) - WALK_LINE));
  return best;
}
const inRect = (x: number, z: number, r: Rect, margin = 0): boolean => x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin;
function footprintHit(x: number, z: number, f: Footprint, margin: number): boolean {
  const dx = x - f.x, dz = z - f.z, c = Math.cos(f.angle), s = Math.sin(f.angle);
  return Math.abs(dx * c + dz * s) < f.hx + margin && Math.abs(-dx * s + dz * c) < f.hz + margin;
}
/** Deterministic hash in [0, 1). */
export function parkRandom(a: number, b: number, salt = 0): number {
  let v = Math.imul(Math.round(a * 16) ^ 0x2f6b, 374761393) ^ Math.imul(Math.round(b * 16), 668265263) ^ Math.imul(salt + 71, 1274126177);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}
// ---- Layout (trees, lanterns, benches, hedges, obstacles) ---------------------------------------
export interface ParkLayout {
  trees: ParkTree[];
  lanterns: ParkLantern[];
  benches: ParkBench[];
  hedges: Footprint[];
  seats: ParkSeat[];
  pillars: { x: number; z: number; height: number; broken: boolean; angle: number }[];
  /** Everything solid, for collision: circles (trunks, posts, sculptures) and boxes. */
  circles: Circle[];
  boxes: Footprint[];
}

/** Keep-clear test shared by every placed object. `clearance` is the object's own radius; the
 * options are the minimum distances from a path or promenade centre line, a plaza rim (signed)
 * and the pond field that its edge must keep. */
interface Keep { path?: number; promenade?: number; plaza?: number; pond?: number; others?: readonly { x: number; z: number; r: number }[] }
function freeSpot(x: number, z: number, clearance: number, o: Keep = {}): boolean {
  if (!inRect(x, z, PARK_INTERIOR, -(HEDGE_FAR - PARK_EDGE + 0.6 + clearance))) return false;
  if (pathDistance(x, z) < (o.path ?? PATH_HALF + 0.4) + clearance) return false;
  if (promenadeDistance(x, z) < (o.promenade ?? PROMENADE_HALF + 0.4) + clearance) return false;
  if (plazaDistance(x, z) < (o.plaza ?? 0.5) + clearance) return false;
  if (walkLineDistance(x, z) < 1 + clearance) return false;
  if (pondField(x, z) < (o.pond ?? 1.15) + clearance / POND.rz) return false;
  if (Math.hypot(x - PARK_ARENA.x, z - PARK_ARENA.z) < PARK_ARENA.radius + 1 + clearance) return false;
  if (inRect(x, z, ARENA_STAGE, 1.2 + clearance)) return false;
  for (const solid of PARK_RAIL_SOLIDS) if (Math.abs(x - solid.x) < solid.half + 2 + clearance && Math.abs(z - solid.z) < solid.half + 2 + clearance) return false;
  if (inRect(x, z, STATION_KEEP, clearance)) return false;
  for (const npc of PARK_NPCS) if (Math.hypot(x - npc.x, z - npc.z) < 3 + clearance) return false;
  if (Math.hypot(x - LAST_TREE.x, z - LAST_TREE.z) < 8 + clearance) return false;
  for (const s of PARK_SCULPTURES) if (Math.hypot(x - s.x, z - s.z) < s.radius + 2 + clearance) return false;
  for (const other of o.others ?? []) if (Math.hypot(x - other.x, z - other.z) < other.r + clearance) return false;
  return true;
}

let cached: ParkLayout | null = null;
/** The park's generated furniture and planting (deterministic, built once). */
export function parkLayout(): ParkLayout {
  if (cached) return cached;
  const lanterns: ParkLantern[] = [], benches: ParkBench[] = [], trees: ParkTree[] = [];
  const placed: { x: number; z: number; r: number }[] = [];
  const addLantern = (x: number, z: number, kind: ParkLantern["kind"] = "lantern") => { lanterns.push({ x, z, kind }); placed.push({ x, z, r: 1.4 }); };

  // Arena braziers first: they frame the fight.
  for (let k = 0; k < 8; k++) {
    const a = (k * 45 + 22.5) * Math.PI / 180;
    addLantern(PARK_ARENA.x + Math.cos(a) * (PARK_ARENA.radius + 1.3), PARK_ARENA.z + Math.sin(a) * (PARK_ARENA.radius + 1.3), "brazier");
  }
  // Promenade lanterns: every 16 m, alternating sides, 9.2 m out (past the walking lines).
  const lanternOk = (x: number, z: number) => freeSpot(x, z, 0.2, { promenade: 8.8, others: placed });
  for (const line of PROMENADE_X) for (let z = PARK.minZ + 26, k = 0; z < PARK.maxZ - 24; z += 16, k++) { const x = line + (k % 2 ? 9.2 : -9.2); if (lanternOk(x, z)) addLantern(x, z); }
  for (const line of PROMENADE_Z) for (let x = PARK.minX + 26, k = 0; x < PARK.maxX - 24; x += 16, k++) { const z = line + (k % 2 ? 9.2 : -9.2); if (lanternOk(x, z)) addLantern(x, z); }
  // Plaza rims.
  for (const plaza of PARK_PLAZAS) for (let k = 0; k < 4; k++) {
    const a = (k * 90 + 45) * Math.PI / 180, x = plaza.x + Math.cos(a) * (plaza.radius + 0.8), z = plaza.z + Math.sin(a) * (plaza.radius + 0.8);
    if (freeSpot(x, z, 0.2, { promenade: PROMENADE_HALF + 0.3, plaza: 0.5, others: placed })) addLantern(x, z);
  }
  // Path lanterns every ~15 m, alternating sides, 2 m off the centre line.
  for (const path of PARK_PATHS) {
    if (path.name === "Pond bridge") continue;
    let run = 7, side = 1;
    for (const s of path.segments) {
      const length = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      run += length;
      if (run < 15) continue;
      run = 0; side = -side;
      const nx = -(s.z1 - s.z0) / length, nz = (s.x1 - s.x0) / length, x = s.x1 + nx * 2.1 * side, z = s.z1 + nz * 2.1 * side;
      if (freeSpot(x, z, 0.2, { path: 1.8, others: placed })) addLantern(x, z);
    }
  }
  // Bridge-end lanterns.
  for (const [x, z] of [[BRIDGE.x0 - 1.6, BRIDGE.z0 + 1.2], [BRIDGE.x1 + 1.6, BRIDGE.z1 - 1.2]]) addLantern(x, z);

  // Benches: beside the promenades (10 m out, facing in), around the plazas and along the paths.
  const benchOk = (x: number, z: number, o: Keep) => freeSpot(x, z, 1.1, { ...o, others: placed });
  const addBench = (x: number, z: number, yaw: number) => { benches.push({ x, z, yaw }); placed.push({ x, z, r: 1.4 }); };
  for (const line of PROMENADE_X) for (let z = PARK.minZ + 34; z < PARK.maxZ - 24; z += 32) for (const side of [-1, 1]) {
    const x = line + side * 10.2; if (benchOk(x, z, { promenade: 8.8 })) addBench(x, z, side < 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  for (const line of PROMENADE_Z) for (let x = PARK.minX + 34; x < PARK.maxX - 24; x += 32) for (const side of [-1, 1]) {
    const z = line + side * 10.2; if (benchOk(x, z, { promenade: 8.8 })) addBench(x, z, side < 0 ? Math.PI : 0);
  }
  for (const plaza of PARK_PLAZAS) for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + 0.35, r = plaza.radius + 1.6, x = plaza.x + Math.cos(a) * r, z = plaza.z + Math.sin(a) * r;
    // Facing the plaza centre: the sitter's forward (sin yaw, -cos yaw) points inward.
    if (benchOk(x, z, { plaza: 0.3 })) addBench(x, z, Math.atan2(plaza.x - x, -(plaza.z - z)));
  }
  for (const path of PARK_PATHS) {
    if (path.name === "Pond bridge") continue;
    let run = 0, side = -1;
    for (const s of path.segments) {
      const length = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      run += length;
      if (run < 19) continue;
      run = 0; side = -side;
      const nx = -(s.z1 - s.z0) / length, nz = (s.x1 - s.x0) / length, mx = (s.x0 + s.x1) / 2, mz = (s.z0 + s.z1) / 2;
      const x = mx + nx * 2.9 * side, z = mz + nz * 2.9 * side;
      if (benchOk(x, z, { path: 1.7, pond: 1.05 })) addBench(x, z, Math.atan2(-nx * side, nz * side));
    }
  }

  // Trees. Allees line the promenades 12.5 m out; groves fill the lawns on a jittered 7 m grid.
  const treeOk = (x: number, z: number, trunk: number, near = 0) => freeSpot(x, z, trunk, { path: PATH_HALF + 1.6 - near, promenade: PROMENADE_HALF + 2.8, plaza: 2.5, others: placed })
    && Math.hypot(x - LAST_TREE.x, z - LAST_TREE.z) > 24 && Math.hypot(x - PARK_ARENA.x, z - PARK_ARENA.z) > 34 && Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) > 13
    && PARK_SCULPTURES.every(s => Math.hypot(x - s.x, z - s.z) > s.radius + 5);
  const addTree = (x: number, z: number, species: TreeSpecies, seed: number) => {
    const r = parkRandom(x, z, 9), size = species === "pine" ? 0.85 + r * 0.35 : 0.8 + r * 0.45;
    const base = { oak: [10, 5.2], pine: [13, 3.4], willow: [10.5, 5.6], blossom: [7.5, 4], lime: [12, 3.9] }[species];
    trees.push({ x, z, species, height: base[0] * size, canopy: base[1] * size, seed });
    placed.push({ x, z, r: { oak: 4.1, pine: 3.2, willow: 4.6, blossom: 3.6, lime: 4.4 }[species] });
  };
  for (const line of PROMENADE_X) for (let z = PARK.minZ + 22; z < PARK.maxZ - 20; z += 12) for (const side of [-1, 1]) {
    const x = line + side * 12.5; if (treeOk(x, z, 0.5)) addTree(x, z, "lime", trees.length);
  }
  for (const line of PROMENADE_Z) for (let x = PARK.minX + 22; x < PARK.maxX - 20; x += 12) for (const side of [-1, 1]) {
    const z = line + side * 12.5; if (treeOk(x, z, 0.5)) addTree(x, z, "lime", trees.length);
  }
  // Willows ring the pond bank.
  for (let k = 0; k < 36; k++) {
    const a = k * Math.PI * 2 / 36 + 0.2, reach = k % 2 ? 1.62 : 1.9, x = POND.x + Math.cos(a) * POND.rx * reach, z = POND.z + Math.sin(a) * POND.rz * reach;
    if (treeOk(x, z, 0.5, 0.6)) addTree(x, z, "willow", trees.length);
  }
  for (let gz = PARK_INTERIOR.minZ + 4; gz < PARK_INTERIOR.maxZ - 2; gz += 5) for (let gx = PARK_INTERIOR.minX + 4; gx < PARK_INTERIOR.maxX - 2; gx += 5) {
    const x = gx + (parkRandom(gx, gz, 1) - 0.5) * 3.6, z = gz + (parkRandom(gx, gz, 2) - 0.5) * 3.6;
    if (!treeOk(x, z, 0.6)) continue;
    // Old Wood (west) grows pines among the oaks; blossom trees gather near the sculptures and the station.
    const r = parkRandom(x, z, 3), west = x < -520 && z > 250 && z < 330, nearArt = PARK_SCULPTURES.some(s => Math.hypot(x - s.x, z - s.z) < 22) || (x > -448 && z > 280 && z < 340);
    const species: TreeSpecies = west ? (r < 0.55 ? "pine" : "oak") : nearArt ? (r < 0.6 ? "blossom" : "oak") : r < 0.2 ? "pine" : r < 0.3 ? "blossom" : "oak";
    // Leave some glades open: a low-frequency mask thins the grid.
    if (parkRandom(Math.floor(x / 23), Math.floor(z / 23), 4) < 0.18 && r < 0.7) continue;
    addTree(x, z, species, trees.length);
  }

  // Perimeter hedge along each side, with gaps for the promenades, the old pavements and every path.
  const hedges: Footprint[] = [];
  const gap = (x: number, z: number) => pathDistance(x, z) < PATH_HALF + 1.1 || promenadeDistance(x, z) < 10;
  const along = (fixed: number, from: number, to: number, horizontal: boolean) => {
    let start: number | null = null;
    const steps = Math.ceil((to - from) / 0.5);
    for (let i = 0; i <= steps + 1; i++) {
      const v = Math.min(to, from + i * 0.5), x = horizontal ? v : fixed, z = horizontal ? fixed : v, open = i > steps || gap(x, z);
      if (!open && start === null) start = v;
      if (open && start !== null) {
        const end = i > steps ? to : v - 0.5;
        if (end - start > 1) {
          const mid = (start + end) / 2, half = (end - start) / 2;
          hedges.push(horizontal ? { x: mid, z: fixed, hx: half, hz: (HEDGE_FAR - HEDGE_NEAR) / 2, angle: 0 } : { x: fixed, z: mid, hx: (HEDGE_FAR - HEDGE_NEAR) / 2, hz: half, angle: 0 });
        }
        start = null;
      }
    }
  };
  const mid = (HEDGE_NEAR + HEDGE_FAR) / 2;
  along(PARK.minZ + mid, PARK.minX + HEDGE_NEAR, PARK.maxX - HEDGE_NEAR, true);
  along(PARK.maxZ - mid, PARK.minX + HEDGE_NEAR, PARK.maxX - HEDGE_NEAR, true);
  along(PARK.minX + mid, PARK.minZ + HEDGE_FAR, PARK.maxZ - HEDGE_FAR, false);
  along(PARK.maxX - mid, PARK.minZ + HEDGE_FAR, PARK.maxZ - HEDGE_FAR, false);

  // Arena: a ring of pillars (some broken), stone seating on the west arc, the stage east.
  const pillars: ParkLayout["pillars"] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * 30 + 15) * Math.PI / 180, x = PARK_ARENA.x + Math.cos(a) * ARENA_PILLAR_RADIUS, z = PARK_ARENA.z + Math.sin(a) * ARENA_PILLAR_RADIUS;
    if (Math.cos(a) > 0.85) continue; // the stage
    // Off every path, promenade and walking line, and clear of the lamp standard at the forecourt.
    // (The x = -512 promenade dissolves into the arena; its walking lines still run through.)
    if (pathDistance(x, z) < PATH_HALF + 1.4 || Math.abs(z - PROMENADE_Z[1]) < PROMENADE_HALF + 1.4 || plazaDistance(x, z) < 1 || walkLineDistance(x, z) < 1.8 || Math.hypot(x + 505.25, z - 326.75) < 3) continue;
    const broken = parkRandom(k, 3, 11) < 0.4;
    pillars.push({ x, z, angle: a, broken, height: broken ? 3 + parkRandom(k, 5, 12) * 3 : 9.5 });
  }
  const seats: ParkSeat[] = [];
  ARENA_SEAT_RADII.forEach((radius, tier) => {
    const pieces = Math.round(radius * 70 * Math.PI / 180 / 3.2);
    for (let k = 0; k < pieces; k++) {
      const a = (145 + (k + 0.5) * 70 / pieces) * Math.PI / 180, x = PARK_ARENA.x + Math.cos(a) * radius, z = PARK_ARENA.z + Math.sin(a) * radius;
      if (pathDistance(x, z) < PATH_HALF + 2 || walkLineDistance(x, z) < 2.2 || plazaDistance(x, z) < 1) continue;
      seats.push({ x, z, hx: 0.85, hz: radius * 70 * Math.PI / 180 / pieces / 2 - 0.1, angle: a, tier });
    }
  });

  const circles: Circle[] = [];
  const boxes: Footprint[] = [];
  for (const tree of trees) circles.push({ x: tree.x, z: tree.z, radius: tree.species === "pine" ? 0.35 : 0.5 });
  for (const l of lanterns) circles.push({ x: l.x, z: l.z, radius: l.kind === "brazier" ? 0.5 : 0.18 });
  for (const b of benches) boxes.push({ x: b.x, z: b.z, hx: 0.95, hz: 0.35, angle: b.yaw }); // long axis along the sitter's right (cos yaw, sin yaw)
  for (const s of PARK_SCULPTURES) circles.push({ x: s.x, z: s.z, radius: s.radius });
  circles.push({ x: FOUNTAIN.x, z: FOUNTAIN.z, radius: FOUNTAIN.radius + 0.4 });
  for (const p of pillars) boxes.push({ x: p.x, z: p.z, hx: 0.75, hz: 0.75, angle: p.angle });
  boxes.push(...hedges, ...seats);
  boxes.push({ x: (ARENA_STAGE.minX + ARENA_STAGE.maxX) / 2, z: (ARENA_STAGE.minZ + ARENA_STAGE.maxZ) / 2, hx: (ARENA_STAGE.maxX - ARENA_STAGE.minX) / 2, hz: (ARENA_STAGE.maxZ - ARENA_STAGE.minZ) / 2, angle: 0 });
  for (const gate of PARK_GATES) for (const f of gateFootprints(gate)) boxes.push(f);
  cached = { trees, lanterns, benches, hedges, seats, pillars, circles, boxes };
  return cached;
}

/** The two solid tunnel blocks (mouth plus outer pier) of a gatehouse. */
export function gateFootprints(gate: ParkGate): Footprint[] {
  const face = gateFace(gate), alongMid = gate.side < 0 ? face + GATE_DEPTH / 2 : face - GATE_DEPTH / 2;
  const lateralMid = (GATE_INNER + GATE_OUTER) / 2, lateralHalf = (GATE_OUTER - GATE_INNER) / 2;
  return [-1, 1].map(s => gate.axis === "z"
    ? { x: gate.line + s * lateralMid, z: alongMid, hx: lateralHalf, hz: GATE_DEPTH / 2, angle: 0 }
    : { x: alongMid, z: gate.line + s * lateralMid, hx: GATE_DEPTH / 2, hz: lateralHalf, angle: 0 });
}

// Collision grid: 8 m cells listing the solids that reach into them (with the player's radius).
const GRID = 8;
let grid: Map<number, { circles: Circle[]; boxes: Footprint[] }> | null = null;
const cellKey = (cx: number, cz: number) => cx * 4096 + cz;
function collisionGrid(margin: number): Map<number, { circles: Circle[]; boxes: Footprint[] }> {
  if (grid) return grid;
  const map = new Map<number, { circles: Circle[]; boxes: Footprint[] }>();
  const cell = (cx: number, cz: number) => { const k = cellKey(cx, cz); let c = map.get(k); if (!c) map.set(k, c = { circles: [], boxes: [] }); return c; };
  const layout = parkLayout();
  const cover = (x: number, z: number, reach: number, add: (c: { circles: Circle[]; boxes: Footprint[] }) => void) => {
    for (let cz = Math.floor((z - reach) / GRID); cz <= Math.floor((z + reach) / GRID); cz++) for (let cx = Math.floor((x - reach) / GRID); cx <= Math.floor((x + reach) / GRID); cx++) add(cell(cx, cz));
  };
  for (const c of layout.circles) cover(c.x, c.z, c.radius + margin, e => e.circles.push(c));
  for (const b of layout.boxes) cover(b.x, b.z, Math.hypot(b.hx, b.hz) + margin, e => e.boxes.push(b));
  grid = map;
  return map;
}

/** True where park furniture, planting or water blocks a walker of radius `margin` at (x, z). */
export function parkBlocked(x: number, z: number, margin: number): boolean {
  if (!nearPark(x, z, 1)) return false;
  if (inPark(x, z) && pondField(x, z) < POND_BLOCK + margin / POND.rz) {
    // The footbridge deck crosses the water.
    const dx = BRIDGE.x1 - BRIDGE.x0, dz = BRIDGE.z1 - BRIDGE.z0, length = Math.hypot(dx, dz);
    const u = ((x - BRIDGE.x0) * dx + (z - BRIDGE.z0) * dz) / length, v = (-(x - BRIDGE.x0) * dz + (z - BRIDGE.z0) * dx) / length;
    if (!(u > 0 && u < length && Math.abs(v) < BRIDGE.half - 0.4)) return true;
  }
  const entry = collisionGrid(margin).get(cellKey(Math.floor(x / GRID), Math.floor(z / GRID)));
  if (!entry) return false;
  for (const c of entry.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.radius + margin) ** 2) return true;
  for (const b of entry.boxes) if (footprintHit(x, z, b, margin)) return true;
  return false;
}

// ---- Ground shader (materials.ts, SURFACE < 1.5) -------------------------------------------------
const f = (n: number): string => { const v = Math.round(n * 1000) / 1000; return Number.isInteger(v) ? `${v}.0` : `${v}`; };
function glslArray(type: string, items: string[]): string { return `${type}[${items.length}](${items.join(", ")})`; }

/** GLSL declarations: the park's constants and `parkGround`, which shades one ground cell of the
 * park (or returns false outside it). Generated from the constants above. */
export function parkGlsl(): string {
  const layout = parkLayout();
  const segments: string[] = [], ranges: string[] = [], boxes: string[] = [];
  for (const path of PARK_PATHS) {
    ranges.push(`ivec2(${segments.length}, ${path.segments.length})`);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const s of path.segments) {
      segments.push(`vec4(${f(s.x0)}, ${f(s.z0)}, ${f(s.x1)}, ${f(s.z1)})`);
      x0 = Math.min(x0, s.x0, s.x1); z0 = Math.min(z0, s.z0, s.z1); x1 = Math.max(x1, s.x0, s.x1); z1 = Math.max(z1, s.z0, s.z1);
    }
    const m = PATH_HALF + 1;
    boxes.push(`vec4(${f(x0 - m)}, ${f(z0 - m)}, ${f(x1 + m)}, ${f(z1 + m)})`);
  }
  const plazas = PARK_PLAZAS.map(p => `vec3(${f(p.x)}, ${f(p.z)}, ${f(p.radius)})`);
  const lanterns = layout.lanterns.map(l => `vec3(${f(l.x)}, ${f(l.z)}, ${l.kind === "brazier" ? "1.0" : "0.0"})`);
  return `// ---- Rootwood Park ground (generated from park.ts) ----
const vec4 PARK_RECT = vec4(${f(PARK_INTERIOR.minX)}, ${f(PARK_INTERIOR.minZ)}, ${f(PARK_INTERIOR.maxX)}, ${f(PARK_INTERIOR.maxZ)});
const vec4 PARK_STREETS = vec4(${f(PARK.minX)}, ${f(PARK.minZ)}, ${f(PARK.maxX)}, ${f(PARK.maxZ)});
const vec4 PARK_PROMENADES = vec4(${f(PROMENADE_X[0])}, ${f(PROMENADE_X[1])}, ${f(PROMENADE_Z[0])}, ${f(PROMENADE_Z[1])});
const float PARK_PROMENADE_HALF = ${f(PROMENADE_HALF)}, PARK_GATE_FACE = ${f(GATE_FACE)}, PARK_PATH_HALF = ${f(PATH_HALF)};
const int PARK_PATH_COUNT = ${PARK_PATHS.length};
const ivec2 PARK_PATH_RANGE[${PARK_PATHS.length}] = ${glslArray("ivec2", ranges)};
const vec4 PARK_PATH_BOX[${PARK_PATHS.length}] = ${glslArray("vec4", boxes)};
const vec4 PARK_SEGS[${segments.length}] = ${glslArray("vec4", segments)};
const int PARK_PLAZA_COUNT = ${plazas.length};
const vec3 PARK_PLAZAS[${plazas.length}] = ${glslArray("vec3", plazas)};
const int PARK_LANTERN_COUNT = ${lanterns.length};
const vec3 PARK_LANTERNS[${lanterns.length}] = ${glslArray("vec3", lanterns)};
const vec3 PARK_ARENA = vec3(${f(PARK_ARENA.x)}, ${f(PARK_ARENA.z)}, ${f(PARK_ARENA.radius)});
const vec4 PARK_POND = vec4(${f(POND.x)}, ${f(POND.z)}, ${f(POND.rx)}, ${f(POND.rz)});
const vec3 PARK_FOUNTAIN = vec3(${f(FOUNTAIN.x)}, ${f(FOUNTAIN.z)}, ${f(FOUNTAIN_WATER)});
float parkPond(vec2 q) {
  vec2 d = (q - PARK_POND.xy) / PARK_POND.zw;
  float a = atan(d.y, d.x);
  return length(d) / (1.0 + 0.1 * sin(2.0 * a + 0.6) + 0.07 * sin(3.0 * a + 2.1));
}
float parkSegment(vec2 q, vec4 s) {
  vec2 d = s.zw - s.xy, r = q - s.xy;
  return length(r - d * clamp(dot(r, d) / max(dot(d, d), 1e-4), 0.0, 1.0));
}
// One ground cell of Rootwood Park: water (the pond and the fountain basin, mirroring the city),
// the arena's flagstones and broken neon ring, stone plazas and promenades, winding gravel paths
// and quiet lawns, all warmed by the lanterns. Returns false outside the park.
bool parkGround(vec3 p, vec3 view, float cellWorld, inout int code, inout bool thin, inout vec3 paper, inout vec3 ink, inout vec3 emission, inout float flags, inout vec3 reflectedGlyph) {
  vec2 q = p.xz;
  if (q.x <= PARK_RECT.x || q.x >= PARK_RECT.z || q.y <= PARK_RECT.y || q.y >= PARK_RECT.w) return false;
  float latNS = min(abs(q.x - PARK_PROMENADES.x), abs(q.x - PARK_PROMENADES.y));
  float latEW = min(abs(q.y - PARK_PROMENADES.z), abs(q.y - PARK_PROMENADES.w));
  float alongNS = min(q.y - PARK_STREETS.y, PARK_STREETS.w - q.y), alongEW = min(q.x - PARK_STREETS.x, PARK_STREETS.z - q.x);
  // The carriageway runs on (city ground) into the gatehouse tunnel mouths.
  if ((latNS < 6.6 && alongNS < PARK_GATE_FACE) || (latEW < 6.6 && alongEW < PARK_GATE_FACE)) return false;
  float nearness = 1.0 - smoothstep(0.2, 1.2, cellWorld);
  float lateral = min(latNS, latEW);
  float path = 1e3;
  for (int i = 0; i < PARK_PATH_COUNT; i++) {
    vec4 b = PARK_PATH_BOX[i];
    if (q.x < b.x || q.y < b.y || q.x > b.z || q.y > b.w) continue;
    ivec2 r = PARK_PATH_RANGE[i];
    for (int k = 0; k < r.y; k++) path = min(path, parkSegment(q, PARK_SEGS[r.x + k]));
  }
  float plaza = 1e3;
  for (int i = 0; i < PARK_PLAZA_COUNT; i++) plaza = min(plaza, length(q - PARK_PLAZAS[i].xy) - PARK_PLAZAS[i].z);
  vec2 ad = q - PARK_ARENA.xy;
  float arenaR = length(ad), pond = parkPond(q), basin = length(q - PARK_FOUNTAIN.xy);
  // Lantern pools: small, warm, soft-edged (braziers a little larger and redder).
  vec3 warm = vec3(0);
  for (int i = 0; i < PARK_LANTERN_COUNT; i++) {
    vec3 l = PARK_LANTERNS[i];
    vec2 d = q - l.xy; float d2 = dot(d, d), reach = l.z > 0.5 ? 110.0 : 70.0;
    if (d2 < reach) { float w = 1.0 - d2 / reach; warm += (l.z > 0.5 ? vec3(1.0, 0.5, 0.2) : vec3(1.0, 0.68, 0.36)) * w * w; }
  }
  float wobble = noise2(q * 0.31) - 0.5;
  bool water = pond < 1.0 || basin < PARK_FOUNTAIN.z;
  vec3 albedo; float wet = u_rain * 0.35;
  int kind = 0; // 0 lawn, 1 path, 2 promenade, 3 plaza, 4 arena, 5 water, 6 bank
  if (water) kind = 5;
  else if (pond < 1.12) kind = 6;
  else if (arenaR < PARK_ARENA.z + 1.0) kind = 4;
  else if (plaza < 0.0) kind = 3;
  else if (lateral < PARK_PROMENADE_HALF) kind = 2;
  else if (path < PARK_PATH_HALF + wobble * 0.4) kind = 1;
  float grain = noise2(q * 1.7 + 11.0);
  if (kind == 0) {
    float tone = noise2(q * 0.045) * 0.6 + noise2(q * 0.21 + 3.0) * 0.4;
    albedo = mix(vec3(0.052, 0.1, 0.07), vec3(0.085, 0.142, 0.09), tone);
    // Lawn edges soften into the gravel.
    albedo = mix(albedo, vec3(0.12, 0.115, 0.095), (1.0 - smoothstep(PARK_PATH_HALF, PARK_PATH_HALF + 0.8, path)) * 0.35);
    float n = noise2(q * 0.9 + 7.0);
    if (cellWorld < 0.5) code = n < 0.3 ? A_QUOTE : n < 0.58 ? A_COMMA : n < 0.84 ? 34 : A_SEMI;
    else if (cellWorld < 1.3) code = n < 0.5 ? A_COMMA : A_QUOTE;
    else code = n > 0.62 ? A_DOT : A_SPACE;
    thin = true;
  } else if (kind == 1) {
    albedo = vec3(0.165, 0.15, 0.122) * (0.9 + 0.2 * grain);
    code = cellWorld < 0.6 ? (grain > 0.56 ? A_COLON : A_DOT) : cellWorld < 1.3 ? A_DOT : A_SPACE;
    if (path > PARK_PATH_HALF - 0.35 + wobble * 0.4 && cellWorld < 0.9) code = A_COMMA;
    thin = true; wet = u_rain * 0.5;
  } else if (kind == 2) {
    albedo = vec3(0.14, 0.135, 0.124) * (0.9 + 0.2 * grain);
    float kerb = step(PARK_PROMENADE_HALF - 0.45, lateral);
    if (kerb > 0.5 && cellWorld < 1.4) { int s = strokeFor(lateral); code = s == A_DASH ? A_EQ : s; albedo *= 1.25; }
    else { code = cellWorld < 0.6 ? (grain > 0.62 ? A_COLON : A_DOT) : cellWorld < 1.3 ? A_DOT : A_SPACE; thin = true; }
    wet = u_rain * 0.6;
  } else if (kind == 3) {
    albedo = vec3(0.13, 0.142, 0.15) * (0.92 + 0.16 * grain);
    float tiles = max(band(q.x / 2.4, 0.92, 1.0), band(q.y / 2.4, 0.92, 1.0));
    if (plaza > -0.55 && cellWorld < 1.4) { int s = strokeFor(plaza); code = s == A_DASH ? A_EQ : s; albedo *= 1.3; }
    else { code = cellWorld < 0.45 ? (tiles > 0.35 ? A_PLUS : A_DOT) : cellWorld < 1.2 ? A_DOT : A_SPACE; thin = true; }
    wet = u_rain * 0.7;
  } else if (kind == 4) {
    // Flagstones in concentric rings with radial joints; a broken neon ring; a faint inner sigil.
    albedo = vec3(0.12, 0.122, 0.138) * (0.9 + 0.2 * grain) * (1.0 - 0.25 * smoothstep(0.55, 0.8, noise2(q * 0.19)));
    float angle = atan(ad.y, ad.x);
    float ringJoint = band(arenaR / 2.6, 0.9, 1.0), radialJoint = band(angle * max(arenaR, 1.0) / 3.1, 0.92, 1.0) * step(3.0, arenaR);
    code = cellWorld < 0.5 ? (ringJoint > 0.4 ? strokeFor(arenaR) : radialJoint > 0.4 ? strokeFor(angle) : A_DOT) : cellWorld < 1.2 ? A_DOT : A_SPACE;
    thin = true; wet = u_rain * 0.7;
    float seg = floor((angle + PI) / (2.0 * PI) * 40.0);
    float neonBand = (1.0 - smoothstep(0.2, 0.2 + fwidth(arenaR), abs(arenaR - 17.6)));
    float alive = step(0.3, hash(vec2(seg, 7.0)));
    if (neonBand > 0.3) {
      float breathe = 0.78 + 0.22 * sin(u_time * 0.9 + seg * 1.7);
      vec3 neon = mix(vec3(1.0, 0.24, 0.62), vec3(0.3, 0.9, 1.0), step(0.82, hash(vec2(seg, 3.0))));
      int s = strokeFor(arenaR); code = s == A_DASH ? A_EQ : s; thin = false;
      albedo = mix(albedo, neon * 0.06, 1.0 - alive);
      emission = neon * alive * breathe * 0.9;
    }
    if (abs(arenaR - 6.0) < 0.22 || (arenaR < 6.0 && abs(ad.y) < 0.2) || (arenaR < 6.0 && abs(ad.x) < 0.2)) { code = strokeFor(abs(arenaR - 6.0) < 0.22 ? arenaR : abs(ad.x) < 0.2 ? q.x : q.y); thin = false; albedo = vec3(0.07, 0.16, 0.17); }
    if (arenaR > PARK_ARENA.z) { int s = strokeFor(arenaR); code = s == A_DASH ? A_EQ : s; thin = false; albedo = vec3(0.12, 0.12, 0.13); }
  } else if (kind == 6) {
    albedo = vec3(0.115, 0.105, 0.088) * (0.85 + 0.3 * grain);
    code = cellWorld < 0.7 ? (grain > 0.5 ? A_COLON : A_DOT) : A_DOT; thin = true; wet = u_rain * 0.8;
  } else {
    albedo = mix(vec3(0.01, 0.026, 0.034), vec3(0.02, 0.04, 0.045), smoothstep(0.6, 1.0, basin < PARK_FOUNTAIN.z ? 1.0 : pond));
    wet = 1.0;
  }
  vec3 lit3 = lighting(p, vec3(0, -1, 0), albedo, wet);
  paper = lit3 * mix(0.8, 0.6, nearness) + albedo * warm * 0.9 + warm * 0.012;
  ink = paper * (kind == 0 ? mix(1.45, 1.85, nearness) : mix(1.4, 1.8, nearness)) + warm * 0.02;
  if (kind == 4 && emission != vec3(0)) { paper += emission * 0.18; ink = emission * 1.1 + paper; }
  if (kind == 5) {
    // Water: slow ~ ripples over a mirror of the city (the rain reflection pass), or of the sky and
    // the lanterns when that pass is not drawn.
    float t = u_time * 0.05;
    float ripple = noise2(q * vec2(0.34, 0.85) + vec2(t, t * 0.4)) * 0.65 + noise2(q * 1.3 - vec2(t * 0.6, 0.0)) * 0.35;
    float grazing = 1.0 - clamp(abs(view.y), 0.0, 1.0);
    float reflectivity = 0.42 + 0.4 * pow(grazing, 2.0);
    vec3 mirrorPaper = skyColor(reflect(view, vec3(0, -1, 0))) * 1.4 + warm * 0.05, mirrorInk = mirrorPaper * 1.6;
    bool mirrored = false;
#ifdef REFLECTIONS
    ivec2 size = textureSize(u_reflectionInk, 0);
    ivec2 texel = ivec2(clamp(gl_FragCoord.xy + vec2(floor((ripple - 0.5) * 2.4 + 0.5), 0.0), vec2(0), vec2(size) - 1.0));
    texel.x = size.x - 1 - texel.x;
    vec3 rInk = texelFetch(u_reflectionInk, texel, 0).rgb, rPaper = texelFetch(u_reflectionPaper, texel, 0).rgb;
    if (dot(rInk + rPaper, vec3(1)) > 0.003) {
      mirrored = true; mirrorPaper = rPaper * vec3(0.72, 0.86, 0.94) + warm * 0.03; mirrorInk = rInk * vec3(0.72, 0.86, 0.94);
      if (ripple < 0.47 && cellWorld < 1.6) { reflectedGlyph = texelFetch(u_reflectionGlyph, texel, 0).rgb; flags = 4.0; }
    }
#endif
    paper = mix(paper, mirrorPaper, reflectivity);
    ink = mix(paper * 1.5, mirrorInk, mirrored ? reflectivity : 0.3);
    if (flags == 0.0) {
      code = cellWorld < 1.4 ? (ripple > 0.58 ? A_TILDE : ripple > 0.44 ? A_DASH : A_SPACE) : (ripple > 0.6 ? A_DASH : A_SPACE);
      thin = true;
      ink = max(ink, paper * 1.6 + vec3(0.006, 0.012, 0.014));
    }
    // Rain rings on the water.
    vec2 rainCell = floor(q / 3.0), delta = fract(q / 3.0) - 0.5;
    float age = fract(u_time * 0.7 + hash(rainCell));
    float ring = (1.0 - smoothstep(0.008, 0.05, abs(length(delta) - age * 0.7))) * (1.0 - age) * u_rain;
    paper += ring * vec3(0.012, 0.027, 0.032);
    if (flags == 0.0 && ring > 0.5 && cellWorld < 0.35) { code = A_O; ink = paper * 1.8 + vec3(0.02, 0.04, 0.05); }
  }
  return true;
}
`;
}
