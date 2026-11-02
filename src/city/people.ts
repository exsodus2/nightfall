import { CityWorld, HALF_BLOCKS, districtAt, randomFor } from "./world.ts";
import { placeLocals, updateLocals, type StreetLocal } from "./street-locals.ts";
import { inPark } from "./park.ts";
import { BENCH, LINES, SEATS, STATIONS, boardingTrain, floorHeight, localToWorld, seatedYaw, trainAt, type Train } from "./metro.ts";
import { CALM_MIN, CALM_RADIUS, CALM_SPREAD, CITIZEN_AWARENESS_RADIUS, CITIZEN_PERSONAL_SPACE, CitizenAwareness, FLEE_RADIUS, LingerWatch, MAX_FLEE_TRAIL, MAX_PERCEIVED_THREATS, SAFE_RADIUS, ASSAULT_RADIUS, assaultReaches, citizenPavement, easeStop, fleeStep, glanceAt, nearestThreat, panicBark, perceivedPlayers, perceivedThreats, sceneComment, stepBack, type CitizenReaction, type Panic, type PerceivedAttack, type PerceivedThreat, type PopulationPerception } from "./citizen-ai.ts";
import { doorLit, faceDoors, type Doorway, type ShopDoor } from "./street-doors.ts";
import { rainIntensity } from "./weather.ts";

export type { PerceivedAttack, PerceivedPlayer, PerceivedThreat, PopulationPerception } from "./citizen-ai.ts";
export type { Doorway } from "./street-doors.ts";

/** "inside": through a shop door, out of sight until they come back out. */
export type ResidentState = "walking" | "waiting" | "browsing" | "talking" | "platform" | "boarding" | "riding" | "alighting" | "lift" | "inside";
/** Street roles with their own silhouette, props, pace and lines. Walking roles: patrol (CorpSec,
 *  in pairs), cleaner (with a cart), dog (on a lead), cyborg (chrome arm), crate (courier on foot).
 *  Standing roles (street-locals.ts): musician, queue, protester, smoker, vendor, kite, chatter, wrist,
 *  audience (a half-ring round a busker or preacher), preacher, dancer, sitter (a tired worker on a
 *  crate) and chaser (a kid chasing a drone's shadow). */
export type ResidentRole = "patrol" | "cleaner" | "dog" | "cyborg" | "crate" | "musician" | "queue" | "protester" | "smoker" | "vendor" | "kite" | "chatter" | "wrist" | "audience" | "preacher" | "dancer" | "sitter" | "chaser";
/** A passing moment the drawing shows: sheltering under an awning (checking a phone now and then),
 *  stopping for a word mid-pavement, or a courier handing a crate over at a door. */
export type CitizenAct = "shelter" | "chat" | "handover";
export interface Citizen {
  id: number; x: number; y: number; z: number; yaw: number;
  state: ResidentState; moving: boolean; seated: boolean; umbrella: boolean;
  occupation: "resident" | "courier" | "commuter"; goal: string;
  reaction?: CitizenReaction; attentionYaw?: number; bark?: string; barkUntil?: number;
  role?: ResidentRole;
  /** Home district (0-5): the street casting (looks and props) people-scene.ts draws. */
  district?: number;
  /** 0..1 while stepping through a doorway (undefined: fully there); 0 inside, not drawn. */
  fade?: number;
  /** The shop door in use: where it is, which way it faces and when it opened (its light spill). */
  doorway?: Doorway;
  /** Head turned away from the body's heading (radians): a glance at a player lingering nearby. */
  glance?: number;
  act?: CitizenAct;
  /** Couriers on foot: false once the crate has been handed over (a fresh one is collected indoors). */
  cargo?: boolean;
}
interface Corner { bx: number; bz: number; corner: number }
/** `look`: after a fight, the spot to stop and look over (facing the scene); `slow`: a cautious leg. */
interface PavementPoint { x: number; z: number; crossing: boolean; road?: boolean; visit?: boolean; shelter?: boolean; door?: boolean; handover?: boolean; look?: { x: number; z: number }; slow?: boolean; axis: "x" | "z" }
/** The blocks a resident chooses destinations in: their own district (the avenue strip for Neon
 *  Ward avenue regulars), so each district keeps its own crowd density. */
interface HomeRange { minBx: number; maxBx: number; minBz: number; maxBz: number }
interface Walker extends Citizen {
  node: Corner; path: PavementPoint[]; next: number; timer: number; visits: number; pace: number;
  home: HomeRange;
  /** Index of the walker this one follows (patrol partners), or -1. */
  leader: number;
  /** Recent positions of a leader, for its partner to walk along (never through a wall). */
  trail?: { x: number; z: number }[];
  /** Scene time before which this walker will not stop for another mid-pavement chat. */
  chatAt: number;
  /** Running from a fight nearby (citizen-ai.ts Panic), until back where they left their route. */
  panic: Panic | undefined;
}
/** `seat` indexes SEATS on `train` (-1: none). It is reserved from boarding until the commuter
 *  steps off, so no two riders ever share a seat. */
interface Commuter extends Citizen { station: number; destination: number; train: number | null; seat: number; u: number; v: number; door: number; phase: number; timer: number; trips: number }
export interface PopulationStats { walking: number; waiting: number; visiting: number; riding: number; commuters: number }

/** Shared intersection phases. All-red intervals provide clearance before the
 * other direction starts. Crossing agents finish their crossing once admitted. */
export function trafficGreen(axis: "x" | "z", time: number): boolean {
  const phase = ((time % 28) + 28) % 28;
  return axis === "z" ? phase < 11 : phase >= 14 && phase < 25;
}
export function pedestrianGreen(axis: "x" | "z", time: number): boolean {
  const phase = ((time % 28) + 28) % 28;
  return axis === "x" ? phase >= 14 && phase < 16.5 : phase < 3.5;
}
export function pavementPoint(node: Corner): { x: number; z: number } {
  let x = node.bx * 64 + ([0, 3].includes(node.corner) ? 7.2 : 56.8);
  if (Math.abs(x) < 8) x = Math.sign(x) * 14;
  return { x, z: node.bz * 64 + (node.corner < 2 ? 7.2 : 56.8) };
}
function neighbors(n: Corner): Corner[] {
  const out = [{ ...n, corner: (n.corner + 1) % 4 }, { ...n, corner: (n.corner + 3) % 4 }];
  const left = n.corner === 0 || n.corner === 3, top = n.corner < 2;
  out.push({ bx: n.bx + (left ? -1 : 1), bz: n.bz, corner: [1, 0, 3, 2][n.corner] });
  out.push({ bx: n.bx, bz: n.bz + (top ? -1 : 1), corner: [3, 2, 1, 0][n.corner] });
  return out.filter(p => p.bx >= -HALF_BLOCKS && p.bx < HALF_BLOCKS && p.bz >= -HALF_BLOCKS && p.bz < HALF_BLOCKS);
}
const key = (n: Corner): string => `${n.bx},${n.bz},${n.corner}`;

/** A small A* search over pavement corners. Road crossings are explicit graph
 * edges, so people cannot cut through a tower or wander into a traffic lane. */
export function pavementRoute(start: Corner, goal: Corner): PavementPoint[] {
  const frontier: Corner[] = [start], came = new Map<string, Corner>(), costs = new Map([[key(start), 0]]);
  const estimate = (n: Corner) => Math.abs(n.bx - goal.bx) + Math.abs(n.bz - goal.bz);
  while (frontier.length) {
    frontier.sort((a, b) => (costs.get(key(a)) ?? 0) + estimate(a) * 2 - (costs.get(key(b)) ?? 0) - estimate(b) * 2);
    const current = frontier.shift()!;
    if (key(current) === key(goal)) {
      const nodes = [current]; let previous = current;
      while (key(previous) !== key(start)) { const p = came.get(key(previous)); if (!p) break; nodes.unshift(p); previous = p; }
      return nodes.slice(1).map((node, i) => {
        const point = pavementPoint(node), before = pavementPoint(nodes[i]);
        // Crossing an old street inside Rootwood Park is a stroll over a promenade: no traffic, no signal.
        const across = (node.bx !== nodes[i].bx || node.bz !== nodes[i].bz) && !inPark((point.x + before.x) / 2, (point.z + before.z) / 2);
        return { ...point, crossing: across, road: across, axis: Math.abs(point.x - before.x) > 1 ? "x" : "z" };
      });
    }
    for (const next of neighbors(current)) {
      const cost = (costs.get(key(current)) ?? 0) + (next.bx !== current.bx || next.bz !== current.bz ? 1.2 : 1);
      if (cost >= (costs.get(key(next)) ?? Infinity)) continue;
      came.set(key(next), current); costs.set(key(next), cost); frontier.push(next);
    }
  }
  return [];
}

/** Commuters living at each station of a line (metro.ts LINES order). */
const COMMUTERS_PER_STATION: readonly number[] = [9, 4];
/** The station `k` stops further along the same line. */
function stopAfter(station: number, k: number): number {
  const at = STATIONS[station], line = LINES[at.line], count = line.stops.length;
  return line.firstStation + (at.stop + k) % count;
}

/** Residents beyond the simulation radius are advanced on one frame in this many. */
const FAR_SLICES = 8;
/** Beyond this (m), residents are small on screen: they step on alternate frames (a 5 cm step at
 *  walking pace, well under a cell at that range), halving the near-field update cost. */
const MID_RADIUS = 110;
const FAR_RADIUS = 280;
/** Residents per block by district (Foundry, Neon Ward, Ghost Circuit, Rain Gardens, Silk Market,
 *  Spillway), plus the extra crowd on the Neon Ward avenue and around the central Silk Market. */
const DISTRICT_DENSITY: readonly number[] = [5, 6, 3, 5, 8, 5];
const AVENUE_EXTRA = 4, MARKET_EXTRA = 2;
/** Chance per walker of each walking role, by district. Patrol leaders bring a partner. */
const ROLE_ODDS: readonly (readonly [ResidentRole, readonly number[]])[] = [
  ["patrol", [0.015, 0.05, 0, 0, 0.015, 0.01]],
  ["cleaner", [0.03, 0.025, 0.04, 0.02, 0.03, 0.02]],
  ["dog", [0.02, 0.03, 0.02, 0.08, 0.05, 0.03]],
  ["cyborg", [0.03, 0.07, 0.12, 0.01, 0.03, 0.05]],
];
const PAIR_GAP = 1.3, PAIR_SHOULDER = 0.8;
/** A resident crossing a doorway fades over this distance from the door (m). */
const FADE_DEPTH = 0.9;
/** A courier hands a crate over standing this far out from the doorway, for this long (s). */
const HANDOVER_OUT = 1.1, HANDOVER_SECONDS = 5;
/** Mid-pavement chats: only walkers within MEET_RADIUS of the eye (at most MAX_STROLLERS), meeting
 *  head-on within MEET_GAP of each other. */
const MEET_RADIUS = 45, MEET_GAP = 1.7, MAX_STROLLERS = 48;
/** At most this many walkers run from fights at once (the rest carry on). */
const MAX_PANICKING = 64;
/** An assault on a civilian scares people off the attacker's spot for this long (s). */
const CRIME_SECONDS = 6;
/** A fight is over once no threat has been seen for AFTERMATH_DELAY s; then up to two passers-by
 *  within BYSTANDER_RADIUS edge over for a look and the nearest CorpSec pair within PATROL_REACH
 *  (by route length) walks over. */
const AFTERMATH_DELAY = 6, BYSTANDER_RADIUS = 45, BYSTANDER_ROUTE = 50, PATROL_REACH = 70;

function homeRange(bx: number, bz: number, avenue: boolean): HomeRange {
  const column = bx < -4 ? 0 : bx < 4 ? 1 : 2;
  return {
    minBx: avenue ? -1 : [-11, -4, 4][column], maxBx: avenue ? 0 : [-5, 3, 10][column],
    minBz: bz < 0 ? -11 : 0, maxBz: bz < 0 ? -1 : 10,
  };
}

export class CityPopulation {
  readonly walkers: Walker[] = [];
  readonly commuters: Commuter[] = [];
  /** Standing street life: buskers, queues, protests, smokers, sellers, kites (street-locals.ts). */
  readonly locals: StreetLocal[];
  private tick = 0;
  private raining = false;
  /** Rain intensity 0..1 (weather.ts; 0 with rain switched off): ~0.2 drizzle, ~0.65 rain, 1 downpour. */
  private rainLevel = 0;
  /** Scene clock of the last update (nearby() keeps residents in a lit doorway until it shuts). */
  /** The shared clock of the last update (signalTime): door timestamps are kept on it. */
  private clock = 0;
  private readonly linger = new LingerWatch();
  /** Walkers near the eye who could stop for a word (bounded; reused every frame). */
  private readonly strollers: Walker[] = [];
  private readonly awareness: CitizenAwareness;
  private readonly world: CityWorld;
  /** Fighting near the eye this frame (nearest MAX_PERCEIVED_THREATS, plus a fresh assault; reused). */
  private readonly threats: PerceivedThreat[] = [];
  /** Walkers currently running from (or waiting out, or walking back from) a fight. */
  private panicking = 0;
  /** The last assault on a civilian: the attacker's spot, scary until `until` (shared clock). */
  private crime: { x: number; z: number; until: number } | null = null;
  /** The fight in progress (the threats' centre when last seen), for the bystanders afterwards. */
  private fight: { x: number; z: number; seen: number } | null = null;
  constructor(world: CityWorld) {
    this.world = world;
    this.awareness = new CitizenAwareness(world);
    for (const block of world.blocks.values()) {
      const district = districtAt(block.x * 64 + 32, block.z * 64 + 32).id;
      const avenue = district === 1 && (block.x === -1 || block.x === 0);
      const count = DISTRICT_DENSITY[district] + (avenue ? AVENUE_EXTRA : 0) + (district === 4 && (block.x === -1 || block.x === 0) ? MARKET_EXTRA : 0);
      const home = homeRange(block.x, block.z, avenue);
      for (let i = 0; i < count; i++) {
        const id = this.walkers.length, corner = i % 4;
        const node = { bx: block.x, bz: block.z, corner }, end = { ...node, corner: (corner + 1) % 4 };
        const a = pavementPoint(node), b = pavementPoint(end), progress = randomFor(id, 73);
        const courier = id % 7 === 0;
        let role: ResidentRole | undefined = courier && randomFor(id, 98) < 0.45 ? "crate" : undefined;
        if (!courier) {
          let roll = randomFor(id, 97);
          for (const [kind, odds] of ROLE_ODDS) { if (roll < odds[district]) { role = kind; break; } roll -= odds[district]; }
        }
        const pace = role === "patrol" ? 1.15 : role === "cleaner" ? 0.8 : role === "crate" ? 1.45 : 1.25 + randomFor(id, 8) * 0.9;
        // Perf: one literal (same keys, same order) for every walker keeps the update loop's
        // property access monomorphic; adding `trail` later or spreading made it polymorphic.
        const make = (walkerId: number, f: number, leader: number, trail: Walker["trail"]): Walker => ({ id: walkerId, x: a.x + (b.x - a.x) * f, y: 0, z: a.z + (b.z - a.z) * f, yaw: 0, state: "walking", moving: true, seated: false, umbrella: walkerId % 3 !== 0 && role !== "patrol" && role !== "cleaner" && role !== "crate", occupation: courier ? "courier" : "resident", goal: role === "patrol" ? "On patrol" : role === "cleaner" ? "Sweeping the pavement" : "Visit a neighborhood shop", reaction: undefined, attentionYaw: undefined, bark: undefined, barkUntil: undefined, role, district, fade: undefined, doorway: undefined, glance: undefined, act: undefined, cargo: role === "crate" ? true : undefined, node: end, path: leader < 0 ? [{ ...b, crossing: false, axis: a.x === b.x ? "z" : "x" }] : [], next: 0, timer: 0, visits: 0, pace, home, leader, trail, chatAt: 0, panic: undefined });
        this.walkers.push(make(id, progress, -1, role === "patrol" ? [] : undefined));
        // A patrol partner starts a pace behind on the same pavement and walks the leader's trail.
        if (role === "patrol") this.walkers.push(make(id + 1, Math.max(0, progress - PAIR_GAP / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z))), id, undefined));
      }
    }
    this.locals = placeLocals(world);
    // Nine commuters per City Loop station, four per Rim Line station (its trains run every ~90 s).
    for (const station of STATIONS) for (let i = 0; i < COMMUTERS_PER_STATION[station.line]; i++) {
      const id = 4000 + station.index * 9 + i, door = (i % 3 - 1) * 15, destination = stopAfter(station.index, 1 + i % 3);
      const u = 5.1 + Math.floor(i / 3) * 1.1, v = door + (i % 2 ? 0.55 : -0.55), p = localToWorld(station, u, v);
      this.commuters.push({ id, ...p, y: station.height, yaw: station.yaw - Math.PI / 2, state: "platform", moving: false, seated: false, umbrella: false, occupation: "commuter", goal: `Catch a train to ${STATIONS[destination].name}`, station: station.index, destination, train: null, seat: -1, u, v, door, phase: 0, timer: 0, trips: 0 });
    }
  }

  update(dt: number, time: number, metroTime: number, eye: { x: number; z: number }, perception?: PopulationPerception, signalTime = time): void {
    const tick = this.tick++, slice = tick % FAR_SLICES;
    const players = perceivedPlayers(perception, eye);
    if (perception) this.raining = perception.rain ?? false;
    // Decisions and stored timestamps run on the shared clock (signalTime: the room's world time online),
    // so every client agrees on umbrellas, door visits and pavement chats (tests/shared-signals.test.ts).
    this.rainLevel = this.raining ? rainIntensity(signalTime) : 0;
    this.clock = signalTime;
    // Awareness, glances and barks also run on the shared clock (never the ambient `time`).
    const still = this.linger.observe(players, signalTime);
    // Fighting nearby (perception) and a fresh assault on a civilian: people run from these.
    const threats = perceivedThreats(perception, eye, this.threats);
    if (this.crime && (signalTime >= this.crime.until || signalTime < this.crime.until - CRIME_SECONDS)) this.crime = null;
    if (this.crime) { threats.unshift({ x: this.crime.x, z: this.crime.z }); if (threats.length > MAX_PERCEIVED_THREATS + 1) threats.pop(); }
    this.watchFight(threats, signalTime);
    const strollers = this.strollers, meet = tick % 4 === 0 && dt > 0;
    strollers.length = 0;
    for (const person of this.walkers) {
      let span = dt;
      const eyeDistance = (person.x - eye.x) ** 2 + (person.z - eye.z) ** 2;
      // Perf: only touch residents with something to clear (most are far away and quiet).
      if (eyeDistance > CITIZEN_AWARENESS_RADIUS ** 2 && !person.panic && (person.reaction !== undefined || person.attentionYaw !== undefined || person.bark !== undefined)) this.awareness.clear(person, signalTime);
      if (person.glance !== undefined) person.glance = undefined;
      // Standing about near someone who has lingered: a glance over now and then.
      if (still.length && eyeDistance < 400 && (person.state === "browsing" || person.state === "talking" || person.state === "waiting")) { const glance = glanceAt(person, still, signalTime); if (glance) person.glance = glance; }
      // Out of range: a cheap, time-sliced update. Freezing them outright made the edge of the
      // simulated area a trap: residents who wandered out never came back and the streets emptied.
      if (eyeDistance > FAR_RADIUS ** 2) {
        if (person.id % FAR_SLICES !== slice) continue;
        span = dt * FAR_SLICES;
      } else if (eyeDistance > MID_RADIUS ** 2 && dt > 0) {
        if ((person.id + tick) % 2) continue;
        span = dt * 2;
      }
      if (person.trail) {
        const last = person.trail[person.trail.length - 1];
        if (!last || (last.x - person.x) ** 2 + (last.z - person.z) ** 2 > 0.16) { person.trail.push({ x: person.x, z: person.z }); if (person.trail.length > 8) person.trail.shift(); }
      }
      if (person.leader >= 0) { this.follow(person, this.walkers[person.leader], span, eyeDistance > FAR_RADIUS ** 2, players); continue; }
      person.moving = false;
      if (person.doorway) this.keepDoorway(person, signalTime);
      if (person.state === "inside") {
        if (person.timer > 0) { person.timer -= span; continue; }
        // Back out through the same door: it opens again and they fade in across the threshold.
        person.state = "walking"; person.goal = person.role === "crate" ? "Off with a fresh crate" : "Leaving a shop";
        if (person.doorway) { person.doorway.opened = signalTime; person.doorway.hold = 1.4; }
        if (person.role === "crate") person.cargo = true;
      }
      // A fight nearby: run from it along the pavement, wait it out, then walk back (shared clock).
      if ((person.panic || threats.length && eyeDistance < MID_RADIUS ** 2) && this.flee(person, span, signalTime, threats)) continue;
      if (perception && eyeDistance <= CITIZEN_AWARENESS_RADIUS ** 2 || this.awareness.hasDetour(person.id)) {
        const response = this.awareness.update(person, person.path[person.next], span, signalTime, eyeDistance <= CITIZEN_AWARENESS_RADIUS ** 2 ? players : [], perception?.rain ?? false);
        if (response === "turn-back") { this.turnBack(person); continue; }
        if (response === "handled") continue;
      } else this.awareness.clear(person, signalTime);
      if (person.timer > 0) {
        person.timer -= span;
        if (person.timer <= 0 && person.act !== undefined) {
          if (person.act === "handover") { person.cargo = false; person.goal = "Crate delivered"; }
          person.act = undefined;
        }
        continue;
      }
      if (person.next >= person.path.length) {
        person.visits++;
        const dx = Math.floor(randomFor(person.id, person.visits, 21) * 5) - 2;
        const dz = Math.floor(randomFor(person.id, person.visits, 47) * 5) - 2;
        const { home } = person;
        const destination = { bx: Math.max(home.minBx, Math.min(home.maxBx, person.node.bx + dx)), bz: Math.max(home.minBz, Math.min(home.maxBz, person.node.bz + dz)), corner: (person.node.corner + 1 + person.visits % 3) % 4 };
        person.path = pavementRoute(person.node, destination); person.node = destination; person.next = 0;
        const corner = pavementPoint(destination), nextCorner = pavementPoint({ ...destination, corner: (destination.corner + 1) % 4 });
        const shop = { x: (corner.x + nextCorner.x) / 2, z: (corner.z + nextCorner.z) / 2, crossing: false, axis: (corner.x === nextCorner.x ? "z" : "x") as "x" | "z" };
        // Caught in the rain without an umbrella: wait it out tucked in against the shopfronts. As the
        // rain rises more give up on it; in a downpour even some with umbrellas duck under an awning.
        const shelter = this.seeksShelter(person) ? this.shelterPoint(shop) : null;
        const door = shelter ? null : this.doorFor(person, destination);
        if (door) {
          // In through a shopfront door (or, for a courier with a crate, a handover on its step) and back out.
          const lane = { x: door.ax, z: door.az, crossing: false, axis: shop.axis };
          const step = person.role === "crate" && person.cargo !== false
            ? { x: door.x + door.nx * HANDOVER_OUT, z: door.z + door.nz * HANDOVER_OUT, crossing: false, axis: shop.axis, handover: true }
            : { x: door.x, z: door.z, crossing: false, axis: shop.axis, door: true };
          person.path.push(lane, step, { ...lane }, { ...corner, crossing: false, axis: shop.axis });
        } else person.path.push(shelter ? { ...shelter, crossing: false, axis: shop.axis, visit: true, shelter: true } : { ...shop, visit: true }, { ...corner, crossing: false, axis: shop.axis });
        person.state = person.visits % 3 === 0 ? "talking" : "browsing";
        person.goal = person.occupation === "courier" ? "Delivering a parcel" : inPark(shop.x, shop.z) ? "Strolling in Rootwood Park" : person.state === "talking" ? "Meeting a neighbor" : "Browsing the local shops";
        person.state = "walking";
        continue;
      }
      const target = person.path[person.next], distance = Math.sqrt((target.x - person.x) ** 2 + (target.z - person.z) ** 2); // Perf: sqrt, not hypot, in the hot loop
      // The flag clears only after entry, allowing the crossing to complete if
      // the signal changes while the person is already in the crosswalk.
      if (target.crossing) {
        if (!pedestrianGreen(target.axis, signalTime)) { person.state = "waiting"; person.goal = "Waiting for the crossing signal"; continue; }
        target.crossing = false; person.state = "walking";
      }
      const step = Math.min(distance, (target.road ? 2.8 : target.slow ? Math.min(person.pace, 0.85) : person.pace) * span);
      if (distance > 0.001) {
        // Heading from before the step: on arrival the remaining vector is ~0 and atan2 of it is noise.
        person.yaw = Math.atan2(target.x - person.x, person.z - target.z);
        person.x += (target.x - person.x) / distance * step; person.z += (target.z - person.z) / distance * step;
        person.moving = true; person.state = "walking";
        person.goal = target.slow ? "Edging over for a look" : person.occupation === "courier" ? "On a delivery round" : person.role === "patrol" ? "On patrol" : person.role === "cleaner" ? "Sweeping the pavement" : person.role === "dog" ? "Walking the dog" : "Walking to the next shop";
      }
      if (distance < 0.04 || step >= distance) {
        person.next++;
        const ahead = person.path[person.next];
        if (ahead && (ahead.door || ahead.handover)) {
          // At the lane: the door ahead swings open (its light spills out) as they walk up to it.
          const nx = target.x - ahead.x, nz = target.z - ahead.z, length = Math.sqrt(nx * nx + nz * nz) || 1;
          const out = ahead.handover ? HANDOVER_OUT : 0;
          person.doorway = { x: ahead.x - nx / length * out, z: ahead.z - nz / length * out, nx: nx / length, nz: nz / length, opened: signalTime + (ahead.handover ? length / person.pace - 0.3 : Math.max(0, length / person.pace - 1.2)), hold: ahead.handover ? HANDOVER_SECONDS : 1.5 };
        }
        if (target.door) {
          // Through the door: out of sight for a while (a courier just drops the parcel inside).
          person.state = "inside"; person.moving = false; person.fade = 0; person.bark = undefined; person.barkUntil = undefined;
          // (Normally set at the lane; kept as a fallback: the door faces back the way they came.)
          person.doorway ??= { x: target.x, z: target.z, nx: -Math.sin(person.yaw), nz: Math.cos(person.yaw), opened: signalTime - 1, hold: 1.5 };
          person.goal = person.occupation === "courier" ? "Dropping off a parcel" : "Inside a shop";
          person.timer = person.occupation === "courier" ? 4 + randomFor(person.id, person.visits, 6) * 4 : 10 + randomFor(person.id, person.visits, 6) * 35;
        } else if (target.handover) {
          // On the step, facing the door: someone comes to it and takes the crate.
          if (person.doorway) { person.yaw = Math.atan2(-person.doorway.nx, person.doorway.nz); person.doorway.opened = signalTime; person.doorway.hold = HANDOVER_SECONDS; }
          person.state = "talking"; person.moving = false; person.act = "handover"; person.goal = "Handing over a crate"; person.timer = HANDOVER_SECONDS;
        } else if (target.shelter) {
          // Face the street from under the awning and watch the rain for a while.
          const cx = Math.floor(person.x / 64) * 64 + 32 - person.x, cz = Math.floor(person.z / 64) * 64 + 32 - person.z;
          person.yaw = Math.abs(cx) > Math.abs(cz) ? Math.atan2(-Math.sign(cx), 0) : Math.atan2(0, Math.sign(cz));
          person.state = "waiting"; person.moving = false; person.act = "shelter"; person.goal = "Sheltering from the rain"; person.timer = 14 + randomFor(person.id, person.visits, 5) * 20;
        } else if (target.look) {
          // After a fight: stop short of the scene, look it over (a passer-by says something), move on.
          person.yaw = Math.atan2(target.look.x - person.x, person.z - target.look.z);
          person.state = "browsing"; person.moving = false;
          const patrol = person.role === "patrol", roll = Math.floor(signalTime);
          person.goal = patrol ? "Securing the scene" : "Looking over the scene";
          person.timer = patrol ? 12 + randomFor(person.id, roll, 71) * 6 : 4 + randomFor(person.id, roll, 71) * 2.5;
          if (!patrol) this.awareness.say(person, sceneComment(person, roll), signalTime);
        } else if (target.visit) { person.state = "browsing"; person.moving = false; person.goal = person.occupation === "courier" ? "Dropping off a parcel" : person.role === "patrol" ? "Watching the street" : "Browsing the shop window"; person.timer = person.occupation === "courier" ? 3 : 5 + randomFor(person.id, person.visits) * 18; person.yaw += Math.PI / 2; }
      }
      if (meet && person.moving && eyeDistance < MEET_RADIUS ** 2 && !person.role && person.occupation === "resident" && !target.road && !person.doorway && signalTime >= person.chatAt && strollers.length < MAX_STROLLERS) strollers.push(person);
    }
    if (strollers.length > 1) this.meetings(strollers, signalTime);
    for (const person of this.commuters) this.updateCommuter(person, dt, metroTime);
    // Shared clock: queue timers and routes must agree between clients (tests/shared-signals.test.ts).
    updateLocals(this.locals, dt, signalTime ?? time, eye, players, this.raining, this.awareness, this.world, still, threats);
  }

  /**
   * The player's swing or shot (the engine passes RpgSession.takePlayerAttack, so once each): when it
   * lands on or within ASSAULT_RADIUS of a civilian (a walker or a standing local; commuters are up on
   * the platforms), people nearby run from the attacker's spot for CRIME_SECONDS and the civilian's
   * position is returned for RpgSession.civilianAssault; otherwise null. One pass over the street
   * crowd per attack, no per-frame work.
   */
  assault(attack: PerceivedAttack | null, signalTime: number): { x: number; z: number } | null {
    if (!attack || !Number.isFinite(attack.x) || !Number.isFinite(attack.z) || !Number.isFinite(attack.yaw)) return null;
    const reach = (attack.ranged ? Math.max(ASSAULT_RADIUS, attack.reach) : ASSAULT_RADIUS) + 0.5;
    let victim: Citizen | null = null, best = reach * reach;
    for (const group of [this.walkers, this.locals]) for (const person of group) {
      const distance = (person.x - attack.x) ** 2 + (person.z - attack.z) ** 2;
      if (distance > best || person.y > 0.5 || person.state === "inside" || person.fade === 0) continue;
      if (assaultReaches(attack, person.x, person.z, this.threats)) { victim = person; best = distance; }
    }
    if (!victim) return null;
    this.crime = { x: attack.x, z: attack.z, until: signalTime + CRIME_SECONDS };
    return { x: victim.x, z: victim.z };
  }

  /**
   * A walker near a fight (within FLEE_RADIUS of the nearest threat) drops what they were doing,
   * shouts now and then, and runs off along open pavement (eased up to a run; citizen-ai.ts
   * fleeStep), stopping to watch once SAFE_RADIUS away. 8-15 s after nothing is within CALM_RADIUS
   * they walk back along the trail they ran to the spot they left their route, and carry on. CorpSec
   * on the beat stand and watch instead. Returns true when it handled the walker this frame.
   */
  private flee(person: Walker, span: number, time: number, threats: readonly PerceivedThreat[]): boolean {
    const index = nearestThreat(threats, person.x, person.z), threat = index >= 0 ? threats[index] : undefined;
    const distance = threat ? (threat.x - person.x) ** 2 + (threat.z - person.z) ** 2 : Infinity;
    let panic = person.panic;
    if (!panic) {
      if (!threat || distance > FLEE_RADIUS ** 2 || person.leader >= 0 || person.y > 0.5 || person.fade !== undefined || !citizenPavement(this.world, person.x, person.z)) return false;
      if (person.role === "patrol") {
        person.moving = false; person.reaction = "noticing"; person.goal = "Watching the fight";
        person.attentionYaw = Math.atan2(threat.x - person.x, person.z - threat.z);
        return true;
      }
      if (this.panicking >= MAX_PANICKING) return false;
      panic = { fromX: threat.x, fromZ: threat.z, dirX: 0, dirZ: 0, speed: person.state === "walking" ? person.pace : 0, calmAt: Infinity, trail: [{ x: person.x, z: person.z }], returning: false };
      person.panic = panic; this.panicking++;
      person.timer = 0; person.act = undefined; person.state = "walking"; person.glance = undefined; person.reaction = undefined; person.attentionYaw = undefined;
      person.goal = "Running from the fight";
      const roll = Math.floor(time), crime = this.crime !== null && threat.x === this.crime.x && threat.z === this.crime.z;
      if (randomFor(person.id, roll, 60) < 0.45) this.awareness.say(person, panicBark(person, crime, roll), time);
    }
    if (threat && distance <= CALM_RADIUS ** 2) {
      panic.calmAt = Infinity;
      if (distance <= FLEE_RADIUS ** 2) { panic.fromX = threat.x; panic.fromZ = threat.z; panic.returning = false; }
    } else if (panic.calmAt === Infinity) panic.calmAt = time + CALM_MIN + randomFor(person.id, Math.floor(time), 61) * CALM_SPREAD;
    if ((person.barkUntil ?? 0) <= time) { person.bark = undefined; person.barkUntil = undefined; }
    if (panic.returning || time >= panic.calmAt) {
      // Calm again: back along the trail they ran, at their own pace, to where they left the route.
      if (!panic.returning) { panic.returning = true; person.goal = "Heading back"; }
      person.state = "walking"; person.reaction = undefined; person.attentionYaw = undefined;
      const point = panic.trail[panic.trail.length - 1];
      if (stepBack(person, panic, point.x, point.z, person.pace, span)) {
        panic.trail.pop();
        if (!panic.trail.length) { person.panic = undefined; this.panicking--; person.goal = "Back on the way"; }
      }
      return true;
    }
    const near = threat !== undefined && distance < SAFE_RADIUS ** 2;
    const fromX = person.x, fromZ = person.z, headingX = panic.dirX, headingZ = panic.dirZ;
    if (near && panic.trail.length < MAX_FLEE_TRAIL && fleeStep(this.world, person, panic, panic.fromX, panic.fromZ, span)) {
      person.state = "walking"; person.reaction = undefined; person.attentionYaw = undefined; person.goal = "Running from the fight";
      // A turn: the corner goes on the trail, so the walk back never cuts it.
      if ((headingX || headingZ) && (panic.dirX !== headingX || panic.dirZ !== headingZ)) panic.trail.push({ x: fromX, z: fromZ });
    } else {
      easeStop(this.world, person, panic, span);
      if (!person.moving) {
        person.state = "waiting"; person.reaction = "noticing";
        person.goal = near ? "Ducking for cover" : "Keeping clear of the fight";
        person.attentionYaw = Math.atan2(panic.fromX - person.x, person.z - panic.fromZ);
      }
    }
    const last = panic.trail[panic.trail.length - 1];
    if (person.moving && (last.x - person.x) ** 2 + (last.z - person.z) ** 2 >= 1 && panic.trail.length < MAX_FLEE_TRAIL + 4) panic.trail.push({ x: person.x, z: person.z });
    return true;
  }

  /** Tracks the fight near the eye; once it has been over AFTERMATH_DELAY s, the aftermath plays out. */
  private watchFight(threats: readonly PerceivedThreat[], time: number): void {
    if (threats.length) {
      let x = 0, z = 0;
      for (const threat of threats) { x += threat.x; z += threat.z; }
      if (!this.fight) this.fight = { x: 0, z: 0, seen: 0 };
      this.fight.x = x / threats.length; this.fight.z = z / threats.length; this.fight.seen = time;
    } else if (this.fight && (time - this.fight.seen >= AFTERMATH_DELAY || time < this.fight.seen)) {
      if (time >= this.fight.seen) this.aftermath(this.fight, time);
      this.fight = null;
    }
  }

  /**
   * After a fight: one or two passers-by within BYSTANDER_RADIUS edge over to the scene, look it over,
   * say something and go back the way they came; and the nearest CorpSec pair whose next leg can reach
   * the scene walks over to secure it. Routes are at most two straight pavement legs inserted ahead of
   * the walker's current waypoint (no new path search). Once per fight.
   */
  private aftermath(scene: { x: number; z: number }, time: number): void {
    const bystanders: Walker[] = [], distances: number[] = [];
    let patrol: Walker | undefined, patrolDistance = PATROL_REACH ** 2;
    for (const person of this.walkers) {
      const distance = (person.x - scene.x) ** 2 + (person.z - scene.z) ** 2;
      if (distance > PATROL_REACH ** 2 || person.leader >= 0 || person.panic || person.y > 0.5 || person.doorway || person.state === "inside") continue;
      const target = person.path[person.next];
      if (target && (target.road || target.look || target.slow)) continue;
      if (person.role === "patrol") { if (distance < patrolDistance) { patrol = person; patrolDistance = distance; } continue; }
      if (person.role || person.occupation !== "resident" || person.state !== "walking" || person.timer > 0 || distance > BYSTANDER_RADIUS ** 2 || distance < 16) continue;
      let index = bystanders.length;
      while (index > 0 && distances[index - 1] > distance) index--;
      if (index >= 4) continue;
      bystanders.splice(index, 0, person); distances.splice(index, 0, distance);
      if (bystanders.length > 4) { bystanders.pop(); distances.pop(); }
    }
    const wanted = 1 + (randomFor(Math.floor(scene.x), Math.floor(scene.z), 70 + Math.floor(time) % 97) < 0.5 ? 1 : 0);
    let sent = 0;
    for (const person of bystanders) if (sent < wanted && this.visitScene(person, scene, 3, BYSTANDER_ROUTE, true)) sent++;
    if (patrol) this.visitScene(patrol, scene, 4, PATROL_REACH, false);
  }

  /** Inserts a trip to (and back from) the scene ahead of the walker's next waypoint; false when the
   *  pavement does not allow one. */
  private visitScene(person: Walker, scene: { x: number; z: number }, stop: number, limit: number, bystander: boolean): boolean {
    const legs = this.approach(person, scene, stop, limit);
    if (!legs) return false;
    const point = (x: number, z: number, from: { x: number; z: number }, extra: { slow?: boolean; look?: { x: number; z: number } }): PavementPoint => ({ x, z, crossing: false, axis: Math.abs(x - from.x) > Math.abs(z - from.z) ? "x" : "z", ...extra });
    const trip: PavementPoint[] = [];
    let from: { x: number; z: number } = { x: person.x, z: person.z };
    legs.forEach((leg, index) => { trip.push(point(leg.x, leg.z, from, { slow: bystander, look: index === legs.length - 1 ? { x: scene.x, z: scene.z } : undefined })); from = leg; });
    const back = [...legs.slice(0, -1).reverse(), { x: person.x, z: person.z }];
    for (const leg of back) { trip.push(point(leg.x, leg.z, from, {})); from = leg; }
    person.path.splice(person.next, 0, ...trip);
    person.timer = 0; person.act = undefined; person.state = "walking";
    person.goal = bystander ? "Edging over for a look" : "Answering a call";
    return true;
  }

  /** Up to two straight legs of open pavement from `from` to within about `stop` m of `to` (straight,
   *  or an L either way round), at most `limit` m in all and ending within 12 m of `to`; the best
   *  (closest) of the three, or null. */
  private approach(from: { x: number; z: number }, to: { x: number; z: number }, stop: number, limit: number): { x: number; z: number }[] | null {
    let best: { x: number; z: number }[] | null = null, bestGap = 12;
    for (const corners of [[to], [{ x: to.x, z: from.z }, to], [{ x: from.x, z: to.z }, to]]) {
      const legs: { x: number; z: number }[] = [];
      let at = from, length = 0, ok = true;
      for (let index = 0; index < corners.length && ok; index++) {
        const last = index === corners.length - 1, goal = corners[index];
        const dx = goal.x - at.x, dz = goal.z - at.z, distance = Math.sqrt(dx * dx + dz * dz);
        if (distance < 0.5) continue;
        const want = last ? Math.max(0, distance - stop) : distance;
        const reach = this.clearRun(at, dx / distance, dz / distance, want);
        if (!last && reach < want) ok = false;
        else if (reach >= 0.5) { at = { x: at.x + dx / distance * reach, z: at.z + dz / distance * reach }; legs.push(at); length += reach; }
      }
      if (!ok || !legs.length || length > limit) continue;
      const gap = Math.sqrt((at.x - to.x) ** 2 + (at.z - to.z) ** 2);
      if (gap < bestGap) { bestGap = gap; best = legs; }
    }
    return best;
  }

  /** How far (m, up to `length`) open pavement runs from `from` along the unit heading (0.5 m samples). */
  private clearRun(from: { x: number; z: number }, dirX: number, dirZ: number, length: number): number {
    let clear = 0;
    for (let along = 0.5; along < length + 0.5; along += 0.5) {
      const at = Math.min(along, length);
      if (!citizenPavement(this.world, from.x + dirX * at, from.z + dirZ * at)) return Math.max(0, clear - 0.3);
      clear = at;
    }
    return clear;
  }

  /** Umbrella-less residents shelter once the rain is more than a drizzle; in a downpour about half
   *  of those with umbrellas do too. Deterministic per resident and visit. */
  private seeksShelter(person: Walker): boolean {
    if (!this.raining || person.role || person.occupation !== "resident") return false;
    const roll = randomFor(person.id, person.visits, 24);
    if (!person.umbrella) return roll < 0.35 + 0.65 * Math.min(1, Math.max(0, (this.rainLevel - 0.25) / 0.35));
    return this.rainLevel > 0.82 && roll < 0.5;
  }

  /** A shopfront door on the destination face to go in through, for about two visits in five (most
   *  of a courier's), or null. Patrols, cleaners and dog walkers keep to the pavement. */
  private doorFor(person: Walker, destination: Corner): ShopDoor | null {
    if (person.role && person.role !== "crate" && person.role !== "cyborg") return null;
    if (randomFor(person.id, person.visits, 23) >= (person.occupation === "courier" ? 0.8 : 0.42)) return null;
    const doors = faceDoors(this.world, destination.bx, destination.bz, destination.corner);
    if (!doors.length) return null;
    return doors[Math.floor(randomFor(person.id, person.visits, 25) * doors.length) % doors.length];
  }

  /** Fades a resident across a doorway's threshold and forgets the door once they are clear of it
   *  and its light has gone. */
  private keepDoorway(person: Walker, time: number): void {
    const door = person.doorway;
    if (!door) return;
    const distance = Math.sqrt((person.x - door.x) ** 2 + (person.z - door.z) ** 2);
    if (person.state !== "inside") person.fade = distance >= FADE_DEPTH ? undefined : distance / FADE_DEPTH;
    if (distance > FADE_DEPTH + 0.4 && !doorLit(door, time)) person.doorway = undefined;
  }

  /**
   * Two neighbours walking toward each other on the same pavement stop for a word, face each other
   * for 7-13 s and go on their way. A sweep over at most MAX_STROLLERS walkers near the eye, sorted
   * along x (insertion sort): only pairs within MEET_GAP on x are compared, so no all-pairs work.
   */
  private meetings(strollers: Walker[], time: number): void {
    for (let i = 1; i < strollers.length; i++) {
      const walker = strollers[i];
      let j = i - 1;
      while (j >= 0 && strollers[j].x > walker.x) { strollers[j + 1] = strollers[j]; j--; }
      strollers[j + 1] = walker;
    }
    for (let i = 0; i < strollers.length; i++) {
      const a = strollers[i];
      if (a.state !== "walking") continue;
      for (let j = i + 1; j < strollers.length && strollers[j].x - a.x < MEET_GAP; j++) {
        const b = strollers[j];
        if (b.state !== "walking") continue;
        const dx = b.x - a.x, dz = b.z - a.z, distance = Math.sqrt(dx * dx + dz * dz);
        if (distance < 0.9 || distance > MEET_GAP) continue;
        // Heading toward each other: opposite headings, each with the other ahead.
        const ax = Math.sin(a.yaw), az = -Math.cos(a.yaw), bx = Math.sin(b.yaw), bz = -Math.cos(b.yaw);
        if (ax * bx + az * bz > -0.8 || ax * dx + az * dz <= 0 || bx * dx + bz * dz >= 0) continue;
        const low = Math.min(a.id, b.id), high = Math.max(a.id, b.id), window = Math.floor(time / 30);
        a.chatAt = b.chatAt = time + 25; // one roll per encounter
        if (randomFor(low, high, 4800 + window) >= 0.35) continue;
        const hold = 7 + randomFor(low, high, 4801) * 6;
        for (const [self, other] of [[a, b], [b, a]] as const) {
          self.state = "talking"; self.moving = false; self.act = "chat"; self.timer = hold; self.chatAt = time + hold + 90;
          self.goal = "Stopping for a word with a neighbor";
          self.yaw = Math.atan2(other.x - self.x, self.z - other.z);
        }
        break;
      }
    }
  }

  /** A spot up to 1.8 m in from the pavement line toward the shopfronts, still on open pavement. */
  private shelterPoint(shop: { x: number; z: number }): { x: number; z: number } | null {
    const cx = Math.floor(shop.x / 64) * 64 + 32 - shop.x, cz = Math.floor(shop.z / 64) * 64 + 32 - shop.z;
    const nx = Math.abs(cx) > Math.abs(cz) ? Math.sign(cx) : 0, nz = nx ? 0 : Math.sign(cz);
    let best: { x: number; z: number } | null = null;
    for (let inset = 0.3; inset <= 1.8; inset += 0.3) {
      const x = shop.x + nx * inset, z = shop.z + nz * inset;
      if (!citizenPavement(this.world, x, z) || inPark(x, z)) break;
      best = { x, z };
    }
    return best && Math.hypot(best.x - shop.x, best.z - shop.z) > 0.8 ? best : null;
  }

  /** A patrol partner: walks the leader's trail a pace behind, at their shoulder where the pavement
   *  allows. Speed follows the gap smoothly, so the gait never toggles while the pair walks. */
  private follow(person: Walker, leader: Walker, span: number, far: boolean, players: readonly { x: number; z: number }[]): void {
    const trail = leader.trail ?? [];
    let tx = leader.x, tz = leader.z, travelled = 0;
    for (let index = trail.length - 1; index >= 0 && travelled < PAIR_GAP; index--) {
      travelled += Math.hypot(trail[index].x - tx, trail[index].z - tz); tx = trail[index].x; tz = trail[index].z;
    }
    const sx = Math.cos(leader.yaw) * PAIR_SHOULDER, sz = Math.sin(leader.yaw) * PAIR_SHOULDER;
    if (leader.moving && citizenPavement(this.world, tx + sx, tz + sz) && citizenPavement(this.world, (tx + leader.x) / 2 + sx, (tz + leader.z) / 2 + sz)) { tx += sx; tz += sz; }
    person.state = leader.state; person.goal = leader.goal; person.reaction = leader.reaction; person.attentionYaw = leader.attentionYaw;
    const dx = tx - person.x, dz = tz - person.z, distance = Math.sqrt(dx * dx + dz * dz);
    if (far) { person.x = tx; person.z = tz; person.yaw = leader.yaw; person.moving = leader.moving; return; }
    // Keeps up over a crossing (the leader hurries across at 2.8 m/s) without breaking into a run.
    const speed = Math.min(distance * 2.5, distance > 1.8 ? 3 : leader.pace * 1.7);
    const step = Math.min(distance, speed * span);
    const nx = person.x + dx / Math.max(distance, 1e-6) * step, nz = person.z + dz / Math.max(distance, 1e-6) * step;
    const blocked = players.some(player => (player.x - nx) ** 2 + (player.z - nz) ** 2 < CITIZEN_PERSONAL_SPACE ** 2);
    person.moving = speed > 0.35 && !blocked;
    if (!person.moving) return;
    person.yaw = Math.atan2(dx, -dz);
    person.x = nx; person.z = nz;
  }

  private turnBack(person: Walker): void {
    const target = person.path[person.next];
    if (!target || target.road) return;
    const directionX = target.x - person.x, directionZ = target.z - person.z;
    const candidates = Array.from({ length: 4 }, (_, corner) => {
      const node = { bx: Math.floor(person.x / 64), bz: Math.floor(person.z / 64), corner };
      return { node, point: pavementPoint(node) };
    }).filter(({ point }) => (point.x - person.x) * directionX + (point.z - person.z) * directionZ < -0.01)
      .sort((first, second) => Math.hypot(first.point.x - person.x, first.point.z - person.z) - Math.hypot(second.point.x - person.x, second.point.z - person.z));
    for (const { node, point } of candidates) {
      const steps = Math.ceil(Math.hypot(point.x - person.x, point.z - person.z) / 0.25);
      let clear = true;
      for (let index = 1; index <= steps; index++) {
        if (!citizenPavement(this.world, person.x + (point.x - person.x) * index / steps, person.z + (point.z - person.z) * index / steps)) { clear = false; break; }
      }
      if (!clear) continue;
      person.node = node; person.path = [{ ...point, crossing: false, axis: Math.abs(directionX) > Math.abs(directionZ) ? "x" : "z" }]; person.next = 0;
      person.state = "walking"; person.goal = "Taking the quieter way around";
      return;
    }
  }

  /** Monorail seats: the seat the player sits on (engine.ts), skipped by freeSeat. */
  private playerSeat: { train: number; seat: number } | null = null;
  /** Reserves `seat` on `train` for the player; `null` (or seat < 0) releases it. Idempotent. */
  reservePlayerSeat(train: number | null, seat = -1): void {
    this.playerSeat = train === null || seat < 0 ? null : { train, seat };
  }
  /** A commuter sits on, or is boarding toward, `seat` on `train` (the player may not take it). */
  seatTaken(train: number, seat: number): boolean {
    return this.commuters.some(o => o.train === train && o.seat === seat);
  }

  /** A free seat on `train`, preferring the carriage behind the commuter's door. */
  private freeSeat(p: Commuter, train: number): number {
    const taken = new Set(this.commuters.filter(o => o !== p && o.train === train && o.seat >= 0).map(o => o.seat));
    if (this.playerSeat?.train === train) taken.add(this.playerSeat.seat);
    let best = -1, bestScore = Infinity;
    for (const seat of SEATS) {
      if (taken.has(seat.index)) continue;
      const score = (seat.carriage === p.door ? 0 : 100) + Math.abs(seat.v - p.door) + randomFor(p.id, p.trips, seat.index) * 3;
      if (score < bestScore) { best = seat.index; bestScore = score; }
    }
    return best;
  }

  // Perf: trains are a pure function of the clock; commuters ask for the same few trains many
  // times per update, so they are memoized for the current clock value.
  private readonly trains = new Map<number, Train>();
  private readonly boardings = new Map<number, Train | undefined>();
  private trainClock = NaN;
  private trainOf(time: number, id: number): Train {
    if (time !== this.trainClock) { this.trains.clear(); this.boardings.clear(); this.trainClock = time; }
    let train = this.trains.get(id);
    if (!train) { train = trainAt(time, id); this.trains.set(id, train); }
    return train;
  }
  private boardingOf(time: number, station: number): Train | undefined {
    if (time !== this.trainClock) { this.trains.clear(); this.boardings.clear(); this.trainClock = time; }
    if (!this.boardings.has(station)) this.boardings.set(station, boardingTrain(time, station));
    return this.boardings.get(station);
  }

  private updateCommuter(p: Commuter, dt: number, time: number): void {
    const station = STATIONS[p.station];
    p.moving = false;
    const walk = (u: number, v: number, speed = 1.8, face = true): boolean => {
      const du = u - p.u, dv = v - p.v, distance = Math.sqrt(du * du + dv * dv), step = Math.min(distance, speed * dt);
      if (distance > 0.01) { p.u += du / distance * step; p.v += dv / distance * step; p.moving = face; if (face) p.yaw = (p.train === null ? station.yaw : this.trainOf(time, p.train).yaw) + Math.atan2(du, -dv); }
      return distance < 0.08 || step >= distance;
    };
    const seat = p.seat >= 0 ? SEATS[p.seat] : null;
    if (p.state === "platform") {
      p.seated = false; p.y = station.height;
      if (walk(5.0 + (p.id % 3) * 0.7, p.door)) {
        const train = this.boardingOf(time, p.station);
        const free = train && train.remaining > 5 + (p.id % 3) * 0.5 ? this.freeSeat(p, train.id) : -1;
        // A full train is let go; the commuter waits for the next one.
        if (train && free >= 0) { p.state = "boarding"; p.train = train.id; p.seat = free; p.phase = 0; p.goal = "Boarding the train"; }
      }
    } else if (p.state === "boarding" && seat) {
      const train = this.trainOf(time, p.train!);
      if (p.u > 2.4 && (train.station !== p.station || train.doors < 0.85)) { p.train = null; p.seat = -1; p.state = "platform"; }
      // In through the door, along the aisle, stand in front of the seat, then sit back onto it.
      else if (p.phase === 0) { if (walk(0.6, p.door, 2.5)) p.phase = 1; }
      else if (p.phase === 1) { if (walk(seat.side * 0.6, seat.v)) p.phase = 2; }
      else if (p.phase === 2) { if (walk(seat.side * BENCH.stand, seat.v, 1.2)) { p.phase = 3; p.seated = true; p.yaw = seatedYaw(train.yaw, seat.side); } }
      else {
        p.seated = true; p.yaw = seatedYaw(train.yaw, seat.side);
        if (walk(seat.u, seat.v, 1.6, false)) { p.state = "riding"; p.goal = `Riding to ${STATIONS[p.destination].name}`; }
      }
    } else if (p.state === "riding" && seat) {
      const train = this.trainOf(time, p.train!);
      p.seated = true; p.u = seat.u; p.v = seat.v; p.yaw = seatedYaw(train.yaw, seat.side);
      if (train.station === p.destination && train.doors > 0.85) { p.state = "alighting"; p.phase = 0; p.station = p.destination; p.goal = "Getting off at work"; }
    } else if (p.state === "alighting" && seat) {
      if (p.phase === 0) {
        // Rise forward off the seat, still facing the aisle, then stand.
        p.yaw = seatedYaw(this.trainOf(time, p.train!).yaw, seat.side);
        if (walk(seat.side * BENCH.stand, seat.v, 1.6, false)) { p.seated = false; p.phase = 1; }
      }
      else if (p.phase === 1) { if (walk(seat.side * 0.6, seat.v, 2.3)) p.phase = 2; }
      else if (p.phase === 2) { if (walk(0.6, p.door, 2.3)) p.phase = 3; }
      else if (p.phase === 3) {
        const train = this.trainOf(time, p.train!);
        // Doors shut first: back to the reserved seat and on to the next stop.
        if (train.station !== p.station || train.doors < 0.85) { p.state = "boarding"; p.phase = 1; p.destination = stopAfter(p.station, 1); }
        else if (walk(4.8, p.door, 2.5)) { p.train = null; p.seat = -1; p.phase = 4; }
      }
    } else if (p.state === "alighting") {
      p.seated = false;
      if (walk(9, 20)) { p.state = "lift"; p.timer = 0; p.phase = 0; }
    } else if (p.state === "lift") {
      // The lift ride eases in and out (a raised cosine over the 4 s), as the player's own lift does.
      p.timer += dt; const ride = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, p.timer / 4)); p.y = station.height * (p.phase === 0 ? 1 - ride : ride);
      if (p.timer >= 4) { p.timer = 0; p.state = p.phase === 0 ? "browsing" : "platform"; p.goal = p.phase === 0 ? "Stopping at the station market" : `Heading home on the ${station.lineName}`; }
    } else if (p.state === "browsing") {
      p.y = 0;
      if (p.timer < 22 + p.id % 19) { walk(16 + p.id % 4, station.x === 0 ? 14 : 10); p.timer += dt; }
      else if (walk(9, 20)) {
        p.state = "lift"; p.phase = 1; p.timer = 0; p.trips++;
        p.destination = stopAfter(p.station, 1 + (p.id + p.trips) % 3);
      }
    }
    if (p.train === null) Object.assign(p, localToWorld(station, p.u, p.v));
    else {
      // Aboard (or stepping aboard): on the carriage floor, which rises and dips with the deck.
      const train = this.trainOf(time, p.train);
      Object.assign(p, localToWorld(train, p.u, p.v));
      p.y = floorHeight(train, p.v);
    }
  }

  nearby(x: number, z: number, radius: number): Citizen[] {
    const nearby: Citizen[] = [], squared = radius * radius;
    for (const group of [this.walkers, this.commuters, this.locals]) for (const p of group) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 >= squared) continue;
      // Indoors: kept only while their doorway is still lit (the drawing shows just its light).
      if (p.state === "inside" && !doorLit(p.doorway, this.clock)) continue;
      nearby.push(p);
    }
    return nearby;
  }
  stats(x: number, z: number): PopulationStats {
    const people = this.nearby(x, z, 250);
    return { walking: people.filter(p => p.moving).length, waiting: people.filter(p => p.state === "waiting" || p.state === "platform").length, visiting: people.filter(p => p.state === "browsing" || p.state === "talking").length, riding: this.commuters.filter(p => p.train !== null).length, commuters: this.commuters.length };
  }
}
