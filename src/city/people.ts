import { CityWorld, HALF_BLOCKS, randomFor } from "./world.ts";
import { inPark } from "./park.ts";
import { BENCH, SEATS, STATIONS, PLATFORM_HEIGHT, boardingTrain, localToWorld, seatedYaw, trainAt } from "./metro.ts";
import { CITIZEN_AWARENESS_RADIUS, CitizenAwareness, citizenPavement, perceivedPlayers, type CitizenReaction, type PopulationPerception } from "./citizen-ai.ts";

export type { PerceivedPlayer, PopulationPerception } from "./citizen-ai.ts";

export type ResidentState = "walking" | "waiting" | "browsing" | "talking" | "platform" | "boarding" | "riding" | "alighting" | "lift";
export interface Citizen {
  id: number; x: number; y: number; z: number; yaw: number;
  state: ResidentState; moving: boolean; seated: boolean; umbrella: boolean;
  occupation: "resident" | "courier" | "commuter"; goal: string;
  reaction?: CitizenReaction; attentionYaw?: number; bark?: string; barkUntil?: number;
}
interface Corner { bx: number; bz: number; corner: number }
interface PavementPoint { x: number; z: number; crossing: boolean; road?: boolean; visit?: boolean; axis: "x" | "z" }
interface Walker extends Citizen { node: Corner; path: PavementPoint[]; next: number; timer: number; visits: number; pace: number }
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

/** Residents beyond the simulation radius are advanced on one frame in this many. */
const FAR_SLICES = 8;

export class CityPopulation {
  readonly walkers: Walker[] = [];
  readonly commuters: Commuter[] = [];
  private tick = 0;
  private readonly awareness: CitizenAwareness;
  private readonly world: CityWorld;
  constructor(world: CityWorld) {
    this.world = world;
    this.awareness = new CitizenAwareness(world);
    for (const block of world.blocks.values()) for (let i = 0; i < 6; i++) {
      const id = this.walkers.length, corner = i % 4;
      const node = { bx: block.x, bz: block.z, corner }, end = { ...node, corner: (corner + 1) % 4 };
      const a = pavementPoint(node), b = pavementPoint(end), progress = randomFor(id, 73);
      this.walkers.push({ id, x: a.x + (b.x - a.x) * progress, y: 0, z: a.z + (b.z - a.z) * progress, yaw: 0, state: "walking", moving: true, seated: false, umbrella: id % 3 !== 0, occupation: id % 7 === 0 ? "courier" : "resident", goal: "Visit a neighborhood shop", node: end, path: [{ ...b, crossing: false, axis: a.x === b.x ? "z" : "x" }], next: 0, timer: 0, visits: 0, pace: 1.25 + randomFor(id, 8) * 0.9 });
    }
    for (const station of STATIONS) for (let i = 0; i < 9; i++) {
      const id = 4000 + station.index * 9 + i, door = (i % 3 - 1) * 15;
      const u = 5.1 + Math.floor(i / 3) * 1.1, v = door + (i % 2 ? 0.55 : -0.55), p = localToWorld(station, u, v);
      this.commuters.push({ id, ...p, y: PLATFORM_HEIGHT, yaw: station.yaw - Math.PI / 2, state: "platform", moving: false, seated: false, umbrella: false, occupation: "commuter", goal: `Catch a train to ${STATIONS[(station.index + 1 + i % 3) % 6].name}`, station: station.index, destination: (station.index + 1 + i % 3) % 6, train: null, seat: -1, u, v, door, phase: 0, timer: 0, trips: 0 });
    }
  }

  update(dt: number, time: number, metroTime: number, eye: { x: number; z: number }, perception?: PopulationPerception, signalTime = time): void {
    const slice = this.tick++ % FAR_SLICES;
    const players = perceivedPlayers(perception, eye);
    for (const person of this.walkers) {
      let span = dt;
      const eyeDistance = (person.x - eye.x) ** 2 + (person.z - eye.z) ** 2;
      if (eyeDistance > CITIZEN_AWARENESS_RADIUS ** 2) this.awareness.clear(person, time);
      // Out of range: a cheap, time-sliced update. Freezing them outright made the edge of the
      // simulated area a trap: residents who wandered out never came back and the streets emptied.
      if (eyeDistance > 280 ** 2) {
        if (person.id % FAR_SLICES !== slice) continue;
        span = dt * FAR_SLICES;
      }
      person.moving = false;
      if (perception && eyeDistance <= CITIZEN_AWARENESS_RADIUS ** 2 || this.awareness.hasDetour(person.id)) {
        const response = this.awareness.update(person, person.path[person.next], span, time, eyeDistance <= CITIZEN_AWARENESS_RADIUS ** 2 ? players : [], perception?.rain ?? false);
        if (response === "turn-back") { this.turnBack(person); continue; }
        if (response === "handled") continue;
      } else this.awareness.clear(person, time);
      if (person.timer > 0) { person.timer -= span; continue; }
      if (person.next >= person.path.length) {
        person.visits++;
        const dx = Math.floor(randomFor(person.id, person.visits, 21) * 5) - 2;
        const dz = Math.floor(randomFor(person.id, person.visits, 47) * 5) - 2;
        const destination = { bx: Math.max(-11, Math.min(10, person.node.bx + dx)), bz: Math.max(-11, Math.min(10, person.node.bz + dz)), corner: (person.node.corner + 1 + person.visits % 3) % 4 };
        person.path = pavementRoute(person.node, destination); person.node = destination; person.next = 0;
        const corner = pavementPoint(destination), nextCorner = pavementPoint({ ...destination, corner: (destination.corner + 1) % 4 });
        const shop = { x: (corner.x + nextCorner.x) / 2, z: (corner.z + nextCorner.z) / 2, crossing: false, axis: (corner.x === nextCorner.x ? "z" : "x") as "x" | "z" };
        person.path.push({ ...shop, visit: true }, { ...corner, crossing: false, axis: shop.axis });
        person.state = person.visits % 3 === 0 ? "talking" : "browsing";
        person.goal = person.occupation === "courier" ? "Delivering a parcel" : inPark(shop.x, shop.z) ? "Strolling in Rootwood Park" : person.state === "talking" ? "Meeting a neighbor" : "Browsing the local shops";
        person.state = "walking";
        continue;
      }
      const target = person.path[person.next], distance = Math.hypot(target.x - person.x, target.z - person.z);
      // The flag clears only after entry, allowing the crossing to complete if
      // the signal changes while the person is already in the crosswalk.
      if (target.crossing) {
        if (!pedestrianGreen(target.axis, signalTime)) { person.state = "waiting"; person.goal = "Waiting for the crossing signal"; continue; }
        target.crossing = false; person.state = "walking";
      }
      const step = Math.min(distance, (target.road ? 2.8 : person.pace) * span);
      if (distance > 0.001) {
        // Heading from before the step: on arrival the remaining vector is ~0 and atan2 of it is noise.
        person.yaw = Math.atan2(target.x - person.x, person.z - target.z);
        person.x += (target.x - person.x) / distance * step; person.z += (target.z - person.z) / distance * step;
        person.moving = true; person.state = "walking";
        person.goal = person.occupation === "courier" ? "On a delivery round" : "Walking to the next shop";
      }
      if (distance < 0.04 || step >= distance) {
        person.next++;
        if (target.visit) { person.state = "browsing"; person.moving = false; person.goal = person.occupation === "courier" ? "Dropping off a parcel" : "Browsing the shop window"; person.timer = person.occupation === "courier" ? 3 : 5 + randomFor(person.id, person.visits) * 18; person.yaw += Math.PI / 2; }
      }
    }
    for (const person of this.commuters) this.updateCommuter(person, dt, metroTime);
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

  private updateCommuter(p: Commuter, dt: number, time: number): void {
    const station = STATIONS[p.station];
    p.moving = false;
    const walk = (u: number, v: number, speed = 1.8, face = true): boolean => {
      const du = u - p.u, dv = v - p.v, distance = Math.hypot(du, dv), step = Math.min(distance, speed * dt);
      if (distance > 0.01) { p.u += du / distance * step; p.v += dv / distance * step; p.moving = face; if (face) p.yaw = (p.train === null ? station.yaw : trainAt(time, p.train).yaw) + Math.atan2(du, -dv); }
      return distance < 0.08 || step >= distance;
    };
    const seat = p.seat >= 0 ? SEATS[p.seat] : null;
    if (p.state === "platform") {
      p.seated = false; p.y = PLATFORM_HEIGHT;
      if (walk(5.0 + (p.id % 3) * 0.7, p.door)) {
        const train = boardingTrain(time, p.station);
        const free = train && train.remaining > 5 + (p.id % 3) * 0.5 ? this.freeSeat(p, train.id) : -1;
        // A full train is let go; the commuter waits for the next one.
        if (train && free >= 0) { p.state = "boarding"; p.train = train.id; p.seat = free; p.phase = 0; p.goal = "Boarding the train"; }
      }
    } else if (p.state === "boarding" && seat) {
      const train = trainAt(time, p.train!);
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
      const train = trainAt(time, p.train!);
      p.seated = true; p.u = seat.u; p.v = seat.v; p.yaw = seatedYaw(train.yaw, seat.side);
      if (train.station === p.destination && train.doors > 0.85) { p.state = "alighting"; p.phase = 0; p.station = p.destination; p.goal = "Getting off at work"; }
    } else if (p.state === "alighting" && seat) {
      if (p.phase === 0) {
        // Rise forward off the seat, still facing the aisle, then stand.
        p.yaw = seatedYaw(trainAt(time, p.train!).yaw, seat.side);
        if (walk(seat.side * BENCH.stand, seat.v, 1.6, false)) { p.seated = false; p.phase = 1; }
      }
      else if (p.phase === 1) { if (walk(seat.side * 0.6, seat.v, 2.3)) p.phase = 2; }
      else if (p.phase === 2) { if (walk(0.6, p.door, 2.3)) p.phase = 3; }
      else if (p.phase === 3) {
        const train = trainAt(time, p.train!);
        // Doors shut first: back to the reserved seat and on to the next stop.
        if (train.station !== p.station || train.doors < 0.85) { p.state = "boarding"; p.phase = 1; p.destination = (p.station + 1) % 6; }
        else if (walk(4.8, p.door, 2.5)) { p.train = null; p.seat = -1; p.phase = 4; }
      }
    } else if (p.state === "alighting") {
      p.seated = false;
      if (walk(9, 20)) { p.state = "lift"; p.timer = 0; p.phase = 0; }
    } else if (p.state === "lift") {
      p.timer += dt; p.y = PLATFORM_HEIGHT * (p.phase === 0 ? 1 - Math.min(1, p.timer / 4) : Math.min(1, p.timer / 4));
      if (p.timer >= 4) { p.timer = 0; p.state = p.phase === 0 ? "browsing" : "platform"; p.goal = p.phase === 0 ? "Stopping at the station market" : "Heading home on the loop"; }
    } else if (p.state === "browsing") {
      p.y = 0;
      if (p.timer < 22 + p.id % 19) { walk(16 + p.id % 4, station.x === 0 ? 14 : 10); p.timer += dt; }
      else if (walk(9, 20)) {
        p.state = "lift"; p.phase = 1; p.timer = 0; p.trips++;
        p.destination = (p.station + 1 + (p.id + p.trips) % 3) % 6;
      }
    }
    const carrier = p.train === null ? STATIONS[p.station] : trainAt(time, p.train);
    Object.assign(p, localToWorld(carrier, p.u, p.v));
  }

  nearby(x: number, z: number, radius: number): Citizen[] {
    const nearby: Citizen[] = [], squared = radius * radius;
    for (const group of [this.walkers, this.commuters]) for (const p of group) if ((p.x - x) ** 2 + (p.z - z) ** 2 < squared) nearby.push(p);
    return nearby;
  }
  stats(x: number, z: number): PopulationStats {
    const people = this.nearby(x, z, 250);
    return { walking: people.filter(p => p.moving).length, waiting: people.filter(p => p.state === "waiting" || p.state === "platform").length, visiting: people.filter(p => p.state === "browsing" || p.state === "talking").length, riding: this.commuters.filter(p => p.train !== null).length, commuters: this.commuters.length };
  }
}
