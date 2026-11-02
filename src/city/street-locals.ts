import { districtAt, randomFor, type CityWorld } from "./world.ts";
import { PARK_INTERIOR, inPark } from "./park.ts";
import { interiorPlaces } from "./interiors.ts";
import { CALM_MIN, CALM_RADIUS, CALM_SPREAD, FLEE_RADIUS, citizenBark, citizenPavement, easeStop, fleeStep, glanceAt, nearestThreat, panicBark, stepBack, type CitizenAwareness, type FleeMotion, type LingeringPlayer, type PerceivedPlayer, type PerceivedThreat } from "./citizen-ai.ts";
import type { Citizen, ResidentRole, ResidentState } from "./people.ts";

/**
 * Standing street life: buskers with an open case, noodle-stall queues that shuffle forward,
 * Spillway protest knots with placards, smokers outside Undertone, umbrella sellers, pairs
 * chatting, people checking a wrist screen, and kids flying kites in Rootwood Park.
 *
 * Everyone here exists from the first frame at a validated pavement spot (no pop-in). Updates are
 * O(1) per local and skipped entirely beyond UPDATE_RADIUS; the only movers are queue customers
 * (served, then wandering off and back) and kite flyers (a slow circle on open lawn).
 */
export interface StreetLocal extends Citizen {
  role: ResidentRole;
  homeX: number; homeZ: number; homeYaw: number;
  /** Shared state of the queue this customer stands in. */
  queue?: QueueState;
  /** Kite flyers: radius of the lawn circle they wander (0 stands still). */
  circle: number;
  /** A kid chasing a drone's shadow: a slow elongated loop on open pavement round home, `along` and
   *  `across` metres on the face's axes (a along it, o out to the street), from `phase`. */
  loop?: { ax: number; az: number; ox: number; oz: number; along: number; across: number; phase: number };
  /** Queue customers walking off or back: remaining waypoints. */
  route: { x: number; z: number }[];
  timer: number;
  /** Only the first of a group speaks for it. */
  speaker: boolean;
  speakAt: number;
  encounters: number;
  /** Scattered from a fight: where they stood (and how) to come back to, how they move, and when
   *  (shared clock; Infinity while the fight is near) they start back. */
  scatter: LocalScatter | undefined;
}
interface LocalScatter extends FleeMotion { fromX: number; fromZ: number; fromYaw: number; fromState: ResidentState; fromGoal: string; awayX: number; awayZ: number; calmAt: number; returning: boolean }
interface QueueState {
  headX: number; headZ: number;
  /** Unit vector from the head of the queue toward its tail. */
  ax: number; az: number;
  /** Unit vector from the stall out toward the street. */
  ox: number; oz: number;
  line: StreetLocal[];
  servedAt: number;
  owner: StreetLocal;
}

export const LOCAL_ID_BASE = 5000;
const UPDATE_RADIUS = 200, BARK_RADIUS = 7, ATTENTION_RADIUS = 5;
const QUEUE_SPACING = 0.85, SHUFFLE_PACE = 0.75, STROLL_PACE = 1.1;
/** Chance per block face of each standing group, by district (Foundry, Neon Ward, Ghost Circuit,
 *  Rain Gardens, Silk Market, Spillway). Ghost Circuit stays sparse; the market and avenue busy. */
const SPOT_ODDS: readonly (readonly [ResidentRole, readonly number[]])[] = [
  ["musician", [0.01, 0.03, 0.008, 0.015, 0.035, 0.025]],
  ["chatter", [0.04, 0.045, 0.012, 0.035, 0.05, 0.04]],
  ["wrist", [0.015, 0.02, 0.02, 0.012, 0.015, 0.015]],
  ["smoker", [0.03, 0.012, 0.006, 0.006, 0.01, 0.025]],
  ["vendor", [0.008, 0.015, 0.006, 0.012, 0.03, 0.01]],
  ["protester", [0, 0, 0, 0, 0, 0.02]],
  // Appended, so the groups above keep their spots: a Spillway street preacher with a few listeners,
  // tired workers sat on a crate (Foundry, Spillway docks), kids chasing a drone's shadow.
  ["preacher", [0, 0, 0, 0, 0, 0.03]],
  ["sitter", [0.03, 0.008, 0.01, 0.012, 0.008, 0.03]],
  ["chaser", [0, 0.012, 0, 0.015, 0.014, 0.006]],
];
/** The kid's loop round the drone's shadow: half-length along the face, half-width, and pace (rad/s). */
const CHASE_ALONG = 3, CHASE_ACROSS = 0.45, CHASE_RATE = 0.42;
const AVENUE_BOOST = 3;

/** Distance to the kerb line of the nearest street, minus the avenue's extra width. */
function offStreet(x: number, z: number): number {
  const sx = Math.round(x / 64) * 64, sz = Math.round(z / 64) * 64;
  return Math.min(Math.abs(x - sx) - (sx === 0 ? 6.65 : 0), Math.abs(z - sz));
}
/** Open pavement, clear of the walkers' line (7.2 m out) and of solids for `radius` around. */
function standable(world: Pick<CityWorld, "canOccupy">, x: number, z: number, radius = 0.45): boolean {
  if (offStreet(x, z) < 7.85 || inPark(x, z)) return false;
  if (!citizenPavement(world, x, z)) return false;
  for (let k = 0; k < 4; k++) if (!world.canOccupy(x + Math.cos(k * Math.PI / 2) * radius, z + Math.sin(k * Math.PI / 2) * radius)) return false;
  return true;
}
const yawOf = (dx: number, dz: number): number => Math.atan2(dx, -dz);

function makeLocal(id: number, role: ResidentRole, x: number, z: number, yaw: number, goal: string, speaker: boolean): StreetLocal {
  return {
    id, x, y: 0, z, yaw, state: "talking", moving: false, seated: false,
    umbrella: (role === "chatter" || role === "wrist" || role === "smoker" || role === "queue" || role === "audience") && id % 3 !== 0 || role === "vendor",
    occupation: "resident", goal, role, district: districtAt(x, z).id, homeX: x, homeZ: z, homeYaw: yaw, circle: 0, route: [], timer: 0, speaker, speakAt: 0, encounters: 0, scatter: undefined,
  };
}

const GOALS: Partial<Record<ResidentRole, string>> = {
  musician: "Busking for the late crowd", chatter: "Catching up with a neighbor", wrist: "Checking messages",
  smoker: "On a smoke break", vendor: "Selling umbrellas", protester: "Protesting the Spillway floods",
  queue: "Queuing for noodles", kite: "Flying a kite", audience: "Listening to a street performer",
  preacher: "Preaching to the river", dancer: "Dancing to Undertone's bass", sitter: "Resting after a long shift",
  chaser: "Chasing a drone's shadow",
};

/**
 * A loose half-ring of `count` listeners round (cx, cz), opening toward the street (o) so walkers
 * on the walking line still pass in front: each 1.7-2 m out, 50-110 degrees off the outward normal,
 * alternating sides, facing the middle. Spots that are not open pavement are skipped.
 */
function audienceRing(world: Pick<CityWorld, "canOccupy">, add: (role: ResidentRole, x: number, z: number, yaw: number, speaker?: boolean) => StreetLocal, cx: number, cz: number, ox: number, oz: number, count: number, seed: number): void {
  const ax = -oz, az = ox;
  let first = true;
  for (let k = 0; k < count; k++) {
    const side = k % 2 ? -1 : 1, angle = (52 + (k >> 1) * 27 + randomFor(seed, k, 321) * 9) * Math.PI / 180 * side;
    const radius = 1.7 + randomFor(seed, k, 322) * 0.3;
    const x = cx + radius * (Math.cos(angle) * ox + Math.sin(angle) * ax), z = cz + radius * (Math.cos(angle) * oz + Math.sin(angle) * az);
    if (!standable(world, x, z, 0.35)) continue;
    add("audience", x, z, yawOf(cx - x, cz - z) + (randomFor(seed, k, 323) - 0.5) * 0.3, first); first = false;
  }
}

export function placeLocals(world: CityWorld): StreetLocal[] {
  const locals: StreetLocal[] = [];
  const add = (role: ResidentRole, x: number, z: number, yaw: number, speaker = true): StreetLocal => {
    const local = makeLocal(LOCAL_ID_BASE + locals.length, role, x, z, yaw, GOALS[role] ?? "Out on the street", speaker);
    locals.push(local);
    return local;
  };
  // Block faces: a spot part-way along each face, a little in from the walkers' line.
  for (const block of world.blocks.values()) {
    const district = districtAt(block.x * 64 + 32, block.z * 64 + 32).id;
    const avenue = (district === 1 || district === 4) && (block.x === -1 || block.x === 0);
    for (let face = 0; face < 4; face++) {
      let roll = randomFor(block.x * 4 + face, block.z, 311);
      let role: ResidentRole | null = null;
      for (const [kind, odds] of SPOT_ODDS) {
        const odd = odds[district] * (avenue ? AVENUE_BOOST : 1);
        if (roll < odd) { role = kind; break; }
        roll -= odd;
      }
      if (!role) continue;
      const along = 14 + randomFor(block.x, block.z * 4 + face, 312) * 36;
      // Faces: 0 north, 1 east, 2 south, 3 west. `o` is the outward (street) normal.
      const ox = face === 1 ? 1 : face === 3 ? -1 : 0, oz = face === 0 ? -1 : face === 2 ? 1 : 0;
      const lineX = face === 1 ? block.x * 64 + 64 : face === 3 ? block.x * 64 : block.x * 64 + along;
      const lineZ = face === 0 ? block.z * 64 : face === 2 ? block.z * 64 + 64 : block.z * 64 + along;
      const avenueEdge = ox !== 0 && Math.round(lineX / 64) === 0 ? 6.65 : 0;
      let spot: { x: number; z: number } | null = null;
      for (const inset of [9.2, 8.7, 8.3]) {
        const x = lineX - ox * (inset + avenueEdge), z = lineZ - oz * (inset + avenueEdge);
        if (standable(world, x, z)) { spot = { x, z }; break; }
      }
      if (!spot) continue;
      const ax = -oz, az = ox, out = yawOf(ox, oz);
      const seed = randomFor(block.x, block.z, 313 + face);
      if (role === "chatter") {
        const a = { x: spot.x - ax * 0.55, z: spot.z - az * 0.55 }, b = { x: spot.x + ax * 0.55, z: spot.z + az * 0.55 };
        if (!standable(world, a.x, a.z) || !standable(world, b.x, b.z)) continue;
        add("chatter", a.x, a.z, yawOf(ax, az) - 0.25); add("chatter", b.x, b.z, yawOf(-ax, -az) + 0.2, false);
      } else if (role === "smoker") {
        const a = { x: spot.x - ax * 0.6, z: spot.z - az * 0.6 }, b = { x: spot.x + ax * 0.7, z: spot.z + az * 0.7 };
        if (!standable(world, a.x, a.z) || !standable(world, b.x, b.z)) continue;
        add("smoker", a.x, a.z, out + 0.6); add("smoker", b.x, b.z, out - 0.9, false);
      } else if (role === "protester") {
        // A knot of four to six with placards, facing the street.
        const count = 4 + Math.floor(seed * 3);
        let first = true;
        for (let k = 0; k < count; k++) {
          const angle = (k / count) * Math.PI * 2 + seed * 3, radius = 0.95 + randomFor(k, block.x, block.z) * 0.35;
          const x = spot.x + Math.cos(angle) * radius, z = spot.z + Math.sin(angle) * radius;
          if (!standable(world, x, z, 0.35)) continue;
          add("protester", x, z, out + (randomFor(k, block.z, block.x) - 0.5) * 0.9, first); first = false;
        }
      } else if (role === "chaser") {
        // The kid's whole loop must be open pavement (it runs along the face, clear of the walking line).
        let open = true;
        for (let k = 0; k < 16 && open; k++) {
          const angle = k * Math.PI / 8, x = spot.x + ax * CHASE_ALONG * Math.cos(angle) + ox * CHASE_ACROSS * Math.sin(angle), z = spot.z + az * CHASE_ALONG * Math.cos(angle) + oz * CHASE_ACROSS * Math.sin(angle);
          if (!standable(world, x, z, 0.3)) open = false;
        }
        if (!open) continue;
        const kid = add("chaser", spot.x, spot.z, out);
        kid.loop = { ax, az, ox, oz, along: CHASE_ALONG, across: CHASE_ACROSS, phase: seed * 6.28 };
        kid.state = "walking";
      } else {
        const performer = add(role, spot.x, spot.z, out + (role === "wrist" ? (seed - 0.5) * 2.4 : role === "sitter" ? (seed - 0.5) * 0.8 : (seed - 0.5) * 0.4));
        // Buskers draw a small half-ring of listeners; the Spillway preacher a few more.
        if (role === "musician" && seed > 0.25) audienceRing(world, add, performer.x, performer.z, ox, oz, 2 + Math.floor(seed * 3), block.x * 131 + block.z * 7 + face);
        if (role === "preacher") audienceRing(world, add, performer.x, performer.z, ox, oz, 3 + Math.floor(seed * 2), block.x * 137 + block.z * 11 + face);
      }
    }
  }
  placeQueues(world, add);
  // Smokers by Undertone's door: the listening bar's regulars stepping out between records.
  const undertone = interiorPlaces(world).find(place => place.id === "undertone");
  if (undertone) {
    const { x: ex, z: ez } = undertone.entrance;
    const nx = ex - undertone.x, nz = ez - undertone.z, length = Math.hypot(nx, nz) || 1;
    const ox = nx / length, oz = nz / length, ax = -oz, az = ox;
    let first = true;
    for (const [lateral, outward, turn] of [[-2.4, 0.2, 0.5], [-3.3, 0.9, -0.4], [2.6, 0.4, -0.6]] as const) {
      const x = ex + ax * lateral + ox * outward, z = ez + az * lateral + oz * outward;
      if (!world.canOccupy(x, z) || !citizenPavement(world, x, z)) continue;
      add("smoker", x, z, yawOf(ox, oz) + turn, first); first = false;
    }
    // Dancers by the door, where the bass comes through the wall (the far side first, clear of the smokers).
    first = true;
    let dancers = 0;
    for (const [lateral, outward, turn] of [[4.4, 0.5, 2.6], [5.4, 1.4, -2.2], [6.3, 0.6, 1.9], [3.6, 1.7, -2.8], [-4.8, 1.2, 2.4], [-5.8, 0.4, -2.0]] as const) {
      if (dancers >= 3) break;
      const x = ex + ax * lateral + ox * outward, z = ez + az * lateral + oz * outward;
      if (!world.canOccupy(x, z) || !citizenPavement(world, x, z)) continue;
      dancers++;
      add("dancer", x, z, yawOf(ox, oz) + turn, first); first = false;
    }
  }
  // Kites over Rootwood Park's open lawns in the Rain Gardens.
  let kites = 0;
  for (let attempt = 0; attempt < 60 && kites < 7; attempt++) {
    const x = PARK_INTERIOR.minX + 12 + randomFor(attempt, 17, 401) * (PARK_INTERIOR.maxX - PARK_INTERIOR.minX - 24);
    const z = PARK_INTERIOR.minZ + 12 + randomFor(attempt, 29, 402) * (PARK_INTERIOR.maxZ - PARK_INTERIOR.minZ - 24);
    const circle = 2.4;
    let open = true;
    for (let k = 0; k < 12 && open; k++) for (const reach of [circle - 0.6, circle + 0.6]) if (!world.canOccupy(x + Math.cos(k * Math.PI / 6) * reach, z + Math.sin(k * Math.PI / 6) * reach)) open = false;
    if (!open || locals.some(other => other.role === "kite" && Math.hypot(other.homeX - x, other.homeZ - z) < 14)) continue;
    const kid = add("kite", x + circle, z, 0);
    kid.circle = circle; kid.state = "walking";
    kites++;
  }
  return locals;
}

/** Noodle-stall queues along the Silk Market's stall fronts (the shops whose ground floor is a
 *  counter: building ids divisible by three, as drawn by signage.ts). */
function placeQueues(world: CityWorld, add: (role: ResidentRole, x: number, z: number, yaw: number, speaker?: boolean) => StreetLocal): void {
  let queues = 0;
  for (const building of world.buildings) {
    if (queues >= 14 || building.district !== 4 || building.id % 3 !== 0 || randomFor(building.id, 7, 501) > 0.45) continue;
    const wrap = (value: number) => ((value % 64) + 64) % 64;
    const sx = wrap(building.x) < 32 ? -1 : 1, sz = wrap(building.z) < 32 ? -1 : 1;
    const side = randomFor(building.id, 3, 502) < 0.5 ? 0 : 1;
    const ox = side ? sx : 0, oz = side ? 0 : sz;
    const front = side ? building.width / 2 : building.depth / 2;
    const headX = building.x + ox * (front + 1.25), headZ = building.z + oz * (front + 1.25);
    const count = 3 + Math.floor(randomFor(building.id, 9, 503) * 3);
    for (const direction of [1, -1]) {
      const ax = (side ? 0 : 1) * direction, az = (side ? 1 : 0) * direction;
      // Room for the line, one more slot and the lane the served customer leaves by.
      let clear = true;
      for (let k = 0; k <= count + 1 && clear; k++) {
        const x = headX + ax * k * QUEUE_SPACING, z = headZ + az * k * QUEUE_SPACING;
        if (!standable(world, x, z, 0.3)) clear = false;
      }
      if (!clear) continue;
      const line = Array.from({ length: count }, (_, k) => add("queue", headX + ax * k * QUEUE_SPACING, headZ + az * k * QUEUE_SPACING, k === 0 ? yawOf(-ox, -oz) : yawOf(-ax, -az), k === 0));
      const queue: QueueState = { headX, headZ, ax, az, ox, oz, line: [...line], servedAt: 6 + randomFor(building.id, 1, 504) * 6, owner: line[0] };
      for (const member of line) { member.queue = queue; member.state = "waiting"; }
      queues++;
      break;
    }
  }
}

function slotOf(queue: QueueState, index: number): { x: number; z: number } {
  return { x: queue.headX + queue.ax * index * QUEUE_SPACING, z: queue.headZ + queue.az * index * QUEUE_SPACING };
}

/** Moves toward (x, z) at `pace`; true on arrival. Faces the direction of travel. */
function stepToward(local: StreetLocal, x: number, z: number, pace: number, dt: number): boolean {
  const dx = x - local.x, dz = z - local.z, distance = Math.hypot(dx, dz);
  if (distance < 0.03) { local.moving = false; return true; }
  const step = Math.min(distance, pace * dt);
  local.x += dx / distance * step; local.z += dz / distance * step;
  local.yaw = yawOf(dx, dz); local.moving = true;
  return step >= distance;
}

function updateQueue(queue: QueueState, dt: number, time: number, world: Pick<CityWorld, "canOccupy">): void {
  // Serve the front customer: they step out to the lane and stroll off down the pavement.
  const front = queue.line[0];
  if (time >= queue.servedAt && queue.line.length >= 2 && front && !front.moving && !front.scatter && Math.hypot(front.x - queue.headX, front.z - queue.headZ) < 0.1) {
    queue.line.shift();
    const lane = { x: queue.headX + queue.ox * 1.1, z: queue.headZ + queue.oz * 1.1 };
    const route = [lane];
    let reach = 0;
    for (let k = 1; k <= 14; k++) {
      const x = lane.x - queue.ax * k, z = lane.z - queue.az * k;
      if (!citizenPavement(world, x, z)) break;
      reach = k;
    }
    if (reach >= 4) route.push({ x: lane.x - queue.ax * reach, z: lane.z - queue.az * reach });
    front.route = route; front.timer = 0; front.state = "walking"; front.goal = "Eating noodles on the go";
    queue.servedAt = time + 7 + randomFor(front.id, Math.floor(time), 505) * 7;
  } else if (queue.line.length < 2) queue.servedAt = Math.max(queue.servedAt, time + 4);
  queue.line.forEach((member, index) => {
    if (member.route.length || member.scatter) return;
    const slot = slotOf(queue, index);
    const arrived = stepToward(member, slot.x, slot.z, SHUFFLE_PACE, dt);
    if (arrived) {
      member.yaw = index === 0 ? yawOf(-queue.ox, -queue.oz) : yawOf(-queue.ax, -queue.az);
      member.state = "waiting"; member.goal = GOALS.queue ?? "";
    }
  });
}

function updateQueueWanderer(local: StreetLocal, queue: QueueState, dt: number, time: number): void {
  if (local.timer > 0) {
    local.timer -= dt; local.moving = false;
    if (local.timer <= 0) {
      // Back for seconds: along the lane to the end of the line.
      const tail = slotOf(queue, queue.line.length);
      local.route = [{ x: tail.x + queue.ox * 1.1, z: tail.z + queue.oz * 1.1 }];
      queue.line.push(local);
      local.state = "walking"; local.goal = "Back in the queue";
    }
    return;
  }
  const target = local.route[0];
  if (stepToward(local, target.x, target.z, STROLL_PACE, dt)) {
    local.route.shift();
    if (!local.route.length && !queue.line.includes(local)) {
      local.timer = 16 + randomFor(local.id, Math.floor(time), 506) * 24;
      local.state = "browsing"; local.goal = "Eating noodles on the go";
    }
  }
}

/** Where a kite flyer or a drone-chasing kid is on their loop at `time` (heading as yaw); null for
 *  everyone else (they stand, or queue). */
function patternAt(local: StreetLocal, time: number): { x: number; z: number; yaw: number } | null {
  if (local.circle > 0) {
    const angle = time * 0.36 + local.id * 1.3;
    return { x: local.homeX - local.circle + Math.cos(angle) * local.circle, z: local.homeZ + Math.sin(angle) * local.circle, yaw: yawOf(-Math.sin(angle), Math.cos(angle)) };
  }
  if (!local.loop) return null;
  const { ax, az, ox, oz, along, across, phase } = local.loop, angle = time * CHASE_RATE + phase;
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: local.homeX + ax * along * c + ox * across * s, z: local.homeZ + az * along * c + oz * across * s, yaw: yawOf(-ax * along * s + ox * across * c, -az * along * s + oz * across * c) };
}

/** Locals further than this from the eye (m) ignore fights (threats are all near the eye). */
const SCATTER_EYE = 110;
/** A scattered local moves at most this far (m) from their spot, in one straight run. */
const SCATTER_DISTANCE = 7;

/**
 * A standing local within FLEE_RADIUS of a fight leaves their spot: an eased run of up to
 * SCATTER_DISTANCE along open pavement, away from it (the tired sitter just keeps low where they
 * are), then watches. 8-15 s after nothing is within CALM_RADIUS they walk back (kids and kite
 * flyers rejoin their loop where it has got to) and pick up where they left off. True while
 * scattered. Shared clock only.
 */
function scatter(local: StreetLocal, dt: number, time: number, threats: readonly PerceivedThreat[], world: Pick<CityWorld, "canOccupy">, awareness: CitizenAwareness): boolean {
  const index = nearestThreat(threats, local.x, local.z), threat = index >= 0 ? threats[index] : undefined;
  const distance = threat ? (threat.x - local.x) ** 2 + (threat.z - local.z) ** 2 : Infinity;
  let state = local.scatter;
  if (!state) {
    if (!threat || distance > FLEE_RADIUS ** 2) return false;
    state = { fromX: local.x, fromZ: local.z, fromYaw: local.yaw, fromState: local.state, fromGoal: local.goal, awayX: threat.x, awayZ: threat.z, dirX: 0, dirZ: 0, speed: 0, calmAt: Infinity, returning: false };
    local.scatter = state;
    local.goal = local.role === "sitter" ? "Keeping low" : "Getting out of the way";
    local.glance = undefined;
    const roll = Math.floor(time);
    if (local.speaker && randomFor(local.id, roll, 62) < 0.5) awareness.say(local, panicBark(local, false, roll), time);
  }
  if (threat && distance <= CALM_RADIUS ** 2) {
    state.calmAt = Infinity;
    if (distance <= FLEE_RADIUS ** 2) { state.awayX = threat.x; state.awayZ = threat.z; state.returning = false; }
  } else if (state.calmAt === Infinity) state.calmAt = time + CALM_MIN + randomFor(local.id, Math.floor(time), 63) * CALM_SPREAD;
  if (state.returning || time >= state.calmAt) {
    state.returning = true; local.reaction = undefined; local.attentionYaw = undefined;
    const pose = patternAt(local, time);
    if (local.role === "sitter" || stepBack(local, state, pose ? pose.x : state.fromX, pose ? pose.z : state.fromZ, pose ? 2.4 : STROLL_PACE, dt)) {
      local.yaw = pose ? pose.yaw : state.fromYaw; local.state = state.fromState; local.goal = state.fromGoal; local.moving = pose !== null;
      local.scatter = undefined;
    } else local.state = "walking";
    return true;
  }
  if (dt > 0 && local.role !== "sitter") {
    const x = local.x, z = local.z, headingX = state.dirX, headingZ = state.dirZ;
    const room = (local.x - state.fromX) ** 2 + (local.z - state.fromZ) ** 2 < SCATTER_DISTANCE ** 2;
    if (room && distance < FLEE_RADIUS ** 2 && fleeStep(world, local, state, state.awayX, state.awayZ, dt)) {
      // One straight run only, so the walk back is a straight line too: a turn ends it.
      if ((headingX || headingZ) && (state.dirX !== headingX || state.dirZ !== headingZ)) { local.x = x; local.z = z; state.dirX = headingX; state.dirZ = headingZ; state.speed = 0; local.moving = false; }
    } else easeStop(world, local, state, dt);
  } else local.moving = false;
  local.state = local.moving ? "walking" : "waiting";
  if (!local.moving) {
    local.reaction = "noticing";
    local.attentionYaw = yawOf(state.awayX - local.x, state.awayZ - local.z);
  } else { local.reaction = undefined; local.attentionYaw = undefined; }
  return true;
}

/** Advances the standing crowd near the eye and lets the nearest speak (rate-limited crowd-wide
 *  through the walkers' awareness). Distant locals are not touched. */
export function updateLocals(locals: readonly StreetLocal[], dt: number, time: number, eye: { x: number; z: number }, players: readonly PerceivedPlayer[], rain: boolean, awareness: CitizenAwareness, world: Pick<CityWorld, "canOccupy">, still: readonly LingeringPlayer[] = [], threats: readonly PerceivedThreat[] = []): void {
  for (const local of locals) {
    const eyeDistance = (local.x - eye.x) ** 2 + (local.z - eye.z) ** 2;
    if (eyeDistance > UPDATE_RADIUS ** 2) continue;
    // A fight nearby: off their spot (or down low) until it has been over a while (shared clock).
    if ((local.scatter || threats.length && eyeDistance < SCATTER_EYE ** 2) && scatter(local, dt, time, threats, world, awareness)) continue;
    if (dt > 0) {
      if (local.queue) {
        if (local === local.queue.owner) updateQueue(local.queue, dt, time, world);
        if (local.route.length || local.timer > 0) updateQueueWanderer(local, local.queue, dt, time);
      } else {
        // Kite flyers jog a slow lap of their lawn, string hand up; the kid runs a long slow loop after
        // the drone's shadow (1.3 m/s at most, heading continuous).
        const pose = patternAt(local, time);
        if (pose) { local.x = pose.x; local.z = pose.z; local.yaw = pose.yaw; local.moving = true; }
      }
    }
    local.attentionYaw = undefined; local.reaction = undefined;
    // Someone has been standing about near the group: the odd glance over (eased, staggered).
    local.glance = still.length && !local.moving && eyeDistance < 400 ? glanceAt(local, still, time) || undefined : undefined;
    if (!players.length || eyeDistance > 40 ** 2) continue;
    let nearest: PerceivedPlayer | undefined, nearestDistance = BARK_RADIUS ** 2;
    for (const player of players) {
      const distance = (player.x - local.x) ** 2 + (player.z - local.z) ** 2;
      if (distance < nearestDistance && (player.speed ?? 0) < 7) { nearest = player; nearestDistance = distance; }
    }
    if (!nearest) continue;
    // Groups wrapped up in something (a chat, a protest, a performance, a dance) keep facing it.
    if (nearestDistance < ATTENTION_RADIUS ** 2 && !local.moving && local.role !== "protester" && local.role !== "chatter" && local.role !== "audience" && local.role !== "preacher" && local.role !== "dancer") {
      local.attentionYaw = yawOf(nearest.x - local.x, nearest.z - local.z);
      local.reaction = "noticing";
    }
    if (local.speaker && time >= local.speakAt && awareness.say(local, citizenBark(local, local.encounters + 1, false, rain), time)) {
      local.encounters++;
      local.speakAt = time + 40 + randomFor(local.id, local.encounters, 507) * 25;
    }
  }
}
