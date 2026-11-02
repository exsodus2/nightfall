import { trafficGreen } from "./people.ts";
import { DISTRICTS, districtAt, randomFor } from "./world.ts";
import { nearPark, underPark } from "./park.ts";
import { RoadAwareness, type RoadPerception } from "./road-awareness.ts";
import { BUS_STREETS, WRECK_SPOTS, busBerth, hasBusStop } from "./driving.ts";
import { TRAM_RAIL_CLEAR, TramLine, isTramId, type RailObstacle } from "./tram.ts";

/** Body kinds. Every kind keeps the 2.7 x 5.8 m footprint (driving.ts, walking collision); buses,
 * trucks and tankers add a second footprint behind it (a `trailing` vehicle from nearby()). */
export type CarKind = "sedan" | "cab" | "van" | "pickup" | "coupe" | "police" | "bus" | "truck" | "tanker" | "moto" | "scooter" | "tuktuk" | "corpsec" | "ambulance" | "sweeper" | "wreck" | "tram";
const KINDS: readonly CarKind[] = ["sedan", "cab", "van", "pickup", "coupe", "police", "bus", "truck", "tanker", "moto", "scooter", "tuktuk", "corpsec", "ambulance", "sweeper", "wreck"];
/** Traffic and wreck ids carry their kind (id % 16), so a car keeps its body when the player
 * takes it over. Parked (20000+) and remote (60000+) cars keep the original id-derived mix;
 * trams (tram.ts, 90000+) are not in KINDS (their ids are not kind-coded). */
export const TRAFFIC_ID_BASE = 100000;
const kindId = (serial: number, kind: CarKind): number => TRAFFIC_ID_BASE + serial * 16 + KINDS.indexOf(kind);
export function carKind(id: number): CarKind {
  if (id >= TRAFFIC_ID_BASE) return KINDS[id % 16];
  if (isTramId(id)) return "tram";
  if (id % 31 === 7) return "police";
  if (id % 5 === 0) return "cab";
  if (id % 7 === 3) return "van";
  if (id % 7 === 5) return "pickup";
  if (id % 11 === 4) return "coupe";
  return "sedan";
}
export const longKind = (kind: CarKind): boolean => kind === "bus" || kind === "truck" || kind === "tanker";
export const twoWheeler = (kind: CarKind): boolean => kind === "moto" || kind === "scooter";
/** Kinds the player can take over (the cockpit and driving model are a car's). */
export const drivableKind = (kind: CarKind): boolean => !longKind(kind) && !twoWheeler(kind) && kind !== "tuktuk" && kind !== "sweeper" && kind !== "wreck" && kind !== "tram";
/** Length of the second footprint behind a bus, truck or tanker. */
export const TRAILING = 5.8;

// Per-district mix (weights). Buses run on the bus streets (driving.ts BUS_STREETS) instead.
const BASE_MIX: readonly (readonly [CarKind, number])[] = [["sedan", 30], ["cab", 12], ["van", 8], ["pickup", 6], ["coupe", 6], ["police", 2], ["truck", 3], ["tanker", 1], ["moto", 6], ["scooter", 3], ["ambulance", 1]];
const DISTRICT_MIX: readonly (readonly (readonly [CarKind, number])[])[] = [
  [["truck", 7], ["tanker", 4], ["pickup", 5], ["van", 3]], // The Foundry
  [["corpsec", 7], ["police", 3], ["coupe", 6], ["cab", 8], ["moto", 3]], // Neon Ward
  [["moto", 5], ["coupe", 3], ["van", 3]], // Ghost Circuit
  [["scooter", 5], ["pickup", 4], ["van", 3]], // Rain Gardens
  [["tuktuk", 14], ["scooter", 8], ["moto", 3], ["van", 3], ["cab", 2]], // Silk Market
  [["sweeper", 4], ["truck", 4], ["tanker", 3], ["pickup", 4], ["scooter", 3]], // The Spillway
];
function pickKind(district: number, r: number): CarKind {
  const mix = [...BASE_MIX, ...(DISTRICT_MIX[district] ?? [])];
  let total = 0;
  for (const [, weight] of mix) total += weight;
  let at = r * total;
  for (const [kind, weight] of mix) { at -= weight; if (at < 0) return kind; }
  return "sedan";
}
/** Kinds that stay in the district they started in (they turn back at its edge). */
const localKind = (kind: CarKind): boolean => kind === "tuktuk" || kind === "corpsec" || kind === "sweeper";
function cruiseFor(kind: CarKind, r: number): number {
  switch (kind) {
    case "moto": return 11 + r * 3.5; // never above the 15 m/s town limit traffic is held to
    case "scooter": return 8.5 + r * 2.5;
    case "tuktuk": return 7.5 + r * 2;
    case "bus": return 8 + r * 2;
    case "truck": case "tanker": return 8 + r * 3;
    case "sweeper": return 6 + r;
    case "ambulance": return 12 + r * 2.5;
    default: return 9 + r * 6;
  }
}

export interface Vehicle {
  id: number; x: number; z: number; yaw: number; speed: number;
  /** Stopped and free to take over (drivable kinds only). */
  waiting: boolean;
  /** Lamps: 0 off, 1 left indicator, 3 hazards (activity.ts blinks them below 1 Hz). */
  signal?: number;
  /** The rear footprint of a bus, truck or tanker: solid, never drawn. */
  trailing?: boolean;
  /** Standing still, any kind (brake lights). */
  stopped?: boolean;
  /** A bus at its berth with the doors open. */
  doors?: boolean;
  /** Bus doors 0 shut .. 1 open, eased (busDoorOpen); activity.ts slides the leaves and fades the doorway. */
  door?: number;
}
interface Driver extends Vehicle {
  along: number; cruise: number; kind: CarKind; home: number;
  /** Across the lane line: a bus pulling in to the kerb, a bike filtering on the centre line. */
  offset: number;
  /** Bikes: 0 in the lane .. 1 filtering along the centre line. */
  filter: number;
  /** Buses: 0 in lane .. 1 in at the kerb (progress over BUS_PULL_TRAVEL; the offset is its smoothstep). */
  pull: number;
  /** Eased yaw lean toward a lateral move (radians, + toward increasing offset). */
  lean: number;
  /** Jerk-limited acceleration (easeSpeed). */
  accel: number;
  /** Length of the current dwell (door timing). */
  dwellTotal: number;
  dwell: number; served: number; stall: number; stallPeriod: number; stallAt: number;
  /** Seconds held after the car ahead moved off (queues start one car at a time). */
  react: number; delay: number;
  signal: number; stopped: boolean; doors: boolean;
  /** Joined its lane from a turn this frame (it has already moved). */
  joined: boolean;
  rear: Vehicle | null;
}
interface Lane { axis: "x" | "z"; street: number; direction: number; cars: Driver[]; bus: boolean }
/** A car on a left turn's quarter circle, between lanes. */
interface Turn { car: Driver; from: Lane; to: Lane; along0: number; line0: number; theta: number; yaw0: number; junction: number }
/** Left turns (the kerb-side turn when keeping left) follow a 6 m quarter circle inside the junction. */
const TURN_RADIUS = 6;
const LENGTH = 1472;
const STREET_LIMIT = 11, STREET_COUNT = STREET_LIMIT * 2 + 1;
export const MAX_TRAFFIC_STEP = 0.15;
const wrap = (n: number, length: number): number => ((n % length) + length) % length;
const clamp01 = (u: number): number => u <= 0 ? 0 : u >= 1 ? 1 : u;
/** 0..1 with zero slope at both ends (lateral moves into the kerb or onto the centre line). */
export const smoothstep01 = (u: number): number => { const v = clamp01(u); return v * v * (3 - 2 * v); };

// ---- Motion polish (anim review) ---------------------------------------------------------------
/** Acceleration limits (m/s^2) and the jerk limit (m/s^3): starts, the end of a speed-up and
 * comfortable braking all ease in and out instead of switching on at full strength. */
export const TRAFFIC_ACCEL = 3.5, TRAFFIC_BRAKE = 8, TRAFFIC_JERK = 12;
/** Braking firmer than this bites at once (the car ahead stopped, a light changed close in): queue
 * spacing and the painted crossings come first. */
const FIRM_BRAKE = -5;
/** Speeding up closes the remaining gap to the target speed at this rate (1/s), so it tapers off. */
const SPEED_GAIN = 2.5;
/** One traffic step of `v.speed` toward `target` with a jerk-limited acceleration `v.accel`.
 * Braking still tracks the target exactly (the old rule), only its onset and release are eased. */
export function easeSpeed(v: { speed: number; accel: number }, target: number, span: number): void {
  const diff = target - v.speed;
  const want = diff >= 0 ? Math.min(TRAFFIC_ACCEL, diff * SPEED_GAIN) : Math.max(-TRAFFIC_BRAKE, diff / Math.max(span, 1e-3));
  if (want < FIRM_BRAKE && want < v.accel) v.accel = want;
  else v.accel += Math.max(-TRAFFIC_JERK * span, Math.min(TRAFFIC_JERK * span, want - v.accel));
  v.speed += v.accel * span;
  if (v.speed <= 0) { v.speed = 0; v.accel = Math.max(0, v.accel); }
}
/** Bus doors: 0 shut .. 1 open over BUS_DOOR_TIME at each end of the dwell (raised cosine), from
 * the dwell timer alone; they finish closing as the dwell ends and the bus pulls out. */
export const BUS_DOOR_TIME = 0.8;
export function busDoorOpen(dwell: number, total: number): number {
  if (dwell <= 0 || total <= 0) return 0;
  const raw = Math.min(clamp01((total - dwell) / BUS_DOOR_TIME), clamp01(dwell / BUS_DOOR_TIME));
  return 0.5 - 0.5 * Math.cos(Math.PI * raw);
}
/** A bus pulls in to (and out from) the kerb over this many metres of travel, eased, so it steers
 * across instead of sliding sideways at walking pace; the progress creeps on at BUS_PULL_CREEP m/s
 * while held so it always completes. */
export const BUS_PULL_TRAVEL = 14, BUS_PULL_CREEP = 1.2;
/** Bikes (and ambulances) move onto / off the centre line at this rate of `filter` per second. */
export const FILTER_RATE = 1;
/** Yaw lean toward a lateral move: the heading of the path, capped, eased in and out. */
export const LEAN_MAX = 6 * Math.PI / 180;
const LEAN_EASE = 8;
/** Target lean (radians, + toward increasing offset) for a lateral rate at a forward speed. */
export const leanFor = (lateralRate: number, speed: number): number =>
  Math.max(-LEAN_MAX, Math.min(LEAN_MAX, Math.atan2(lateralRate, Math.max(2, Math.abs(speed)))));
/** Where a car waits at a red: its centre this far before the cross street's centre line, so the
 * nose stops behind the painted crossing (9.5-13 m out; 19-26 m across the double-width avenue).
 * Nearer, stopped cars sat on the pedestrians' corner crossing and poked into the avenue's lanes. */
export const STOP_LINE = 16.5, AVENUE_STOP_LINE = 29.5;
/** A car crossing the avenue is clear of its rails and far lanes once its centre is this far past
 * the avenue's centre line (carriageway |x| < 12.4, plus half a car and a margin). */
export const AVENUE_EXIT = 15.8;
/** Distance to the next stop point ahead. Past one, the car is committed to that intersection. */
export function stopDistance(axis: "x" | "z", direction: number, along: number): number {
  const ahead = wrap(-along * direction, 64), first = ahead - stopOffset(axis, direction, along, ahead);
  return first >= 0 ? first : ahead + 64 - stopOffset(axis, direction, along, ahead + 64);
}
/** Perf: stopDistance's stop-line offset `distance` ahead, as a plain function (it was a closure
 *  allocated for every car on every frame). */
function stopOffset(axis: "x" | "z", direction: number, along: number, distance: number): number {
  return axis === "x" && Math.round((along + distance * direction) / 64) === 0 ? AVENUE_STOP_LINE : STOP_LINE;
}
/** Start positions: never inside an intersection or between a stop point and its intersection.
 * One direction starts on red, and cars spawned there drove straight through the cross traffic. */
export function spawnAlong(axis: "x" | "z", direction: number, along: number): number {
  const avenue = (centre: number) => axis === "x" && Math.round(centre / 64) === 0;
  const ahead = wrap(-along * direction, 64), next = along + ahead * direction, previous = next - 64 * direction;
  const stop = avenue(next) ? AVENUE_STOP_LINE : STOP_LINE, exit = (avenue(previous) ? 12.4 : 6.2) + 3.4;
  const placed = ahead < stop ? next - stop * direction : 64 - ahead < exit ? previous + exit * direction : along;
  return wrap(placed + LENGTH / 2, LENGTH) - LENGTH / 2;
}

/** Centre line of a traffic lane. Traffic keeps left on every street (right-hand drive, see
 * DriveSession): heading +z that is +x, heading +x it is -z (east-west streets used to keep right).
 * Kerbside cars park 5.8 m out (driving.ts), so a 2.7 m car must keep within 3.0 m of an ordinary
 * street's centre (at 3.3 m every passing car scraped through them). */
export const laneLine = (axis: "x" | "z", street: number, direction: number): number => street * 64 + (axis === "x" ? -direction : direction) * (street === 0 && axis === "z" ? 5.5 : 3.0);

/** Stateful traffic follows signals and brakes for the car in front. Vehicle
 * positions never jump when a light changes or a new block becomes visible. */
export class CityTraffic {
  private readonly lanes: Lane[] = [];
  private readonly roadAwareness = new RoadAwareness();
  private readonly blockerAlong: number[] = [];
  private readonly junctions = new Uint8Array(STREET_COUNT * STREET_COUNT);
  private readonly turning: Turn[] = [];
  private readonly departing: Driver[] = [];
  /** Meridian Avenue trams (tram.ts) and what stands on their rails this frame. */
  private readonly trams = new TramLine();
  private readonly railPoints: RailObstacle[] = [];
  get tramLine(): TramLine { return this.trams; }
  private readonly wrecks: Vehicle[] = WRECK_SPOTS.map((spot, i) => ({ id: kindId(5000 + i, "wreck"), x: spot.x, z: spot.z, yaw: spot.yaw, speed: 0, waiting: false, stopped: true }));
  constructor() {
    let serial = 0;
    for (const axis of ["x", "z"] as const) for (let street = -STREET_LIMIT; street <= STREET_LIMIT; street++) for (const direction of [-1, 1]) {
      const cars: Driver[] = [], bus = BUS_STREETS.some(route => route.axis === axis && route.street === street);
      for (let i = 0; i < 16; i++) {
        const along = spawnAlong(axis, direction, wrap(i * LENGTH / 16 + street * 23 + (axis === "x" ? 29 : 0), LENGTH) - LENGTH / 2);
        const lane = laneLine(axis, street, direction), x = axis === "x" ? along : lane, z = axis === "z" ? along : lane;
        const home = districtAt(x, z).id, kind = bus && i % 4 === 1 ? "bus" : pickKind(home, randomFor(serial, 91, 7));
        const id = kindId(serial++, kind), yaw = axis === "x" ? direction * Math.PI / 2 : direction < 0 ? 0 : Math.PI;
        const car: Driver = {
          id, along, x, z, yaw, speed: 7, cruise: cruiseFor(kind, randomFor(id, 57)), waiting: false, kind, home, offset: 0, filter: 0,
          pull: 0, lean: 0, accel: 0, dwellTotal: 0, door: 0, dwell: 0, served: -999, stall: 0, stallPeriod: -1, stallAt: Infinity, react: 0, delay: 0.35 + randomFor(id, 59) * 0.55,
          signal: 0, stopped: false, doors: false, joined: false, rear: null,
        };
        if (longKind(kind)) car.rear = { id: -id, x, z, yaw, speed: 7, waiting: false, trailing: true };
        placeRear(car);
        cars.push(car);
      }
      this.lanes.push({ axis, street, direction, cars, bus });
    }
  }
  private lane(axis: "x" | "z", street: number, direction: number): Lane {
    return this.lanes[(axis === "x" ? 0 : STREET_COUNT * 2) + (street + STREET_LIMIT) * 2 + (direction > 0 ? 1 : 0)];
  }
  private mark(axis: "x" | "z", street: number, along: number): void {
    const crossing = Math.round(along / 64);
    if (Math.abs(crossing) > STREET_LIMIT || Math.abs(along - crossing * 64) >= (axis === "x" && crossing === 0 ? AVENUE_STOP_LINE : STOP_LINE)) return;
    const streetX = axis === "x" ? crossing : street, streetZ = axis === "z" ? crossing : street;
    this.junctions[(streetZ + STREET_LIMIT) * STREET_COUNT + streetX + STREET_LIMIT] |= axis === "x" ? 1 : 2;
  }
  /** Whether `car` means to turn left at `crossing` (the indicator starts 40 m out). */
  private wantsTurn(car: Driver, lane: Lane, crossing: number): boolean {
    if (longKind(car.kind) || car.filter > 0 || Math.abs(crossing) > STREET_LIMIT) return false;
    if ((lane.axis === "x" && crossing === 0) || (lane.axis === "z" && lane.street === 0)) return false; // the avenue
    const jx = (lane.axis === "x" ? crossing : lane.street) * 64, jz = (lane.axis === "z" ? crossing : lane.street) * 64;
    if (nearPark(jx, jz, 14)) return false;
    if (localKind(car.kind)) {
      const line = lane.street * 64, leaves = (blocks: number) => {
        const next = (crossing + lane.direction * (blocks - 0.5)) * 64;
        // The lane wraps at the city edge: that counts as leaving too.
        return Math.abs(next) > STREET_LIMIT * 64 || districtAt(lane.axis === "x" ? next : line, lane.axis === "x" ? line : next).id !== car.home;
      };
      if (leaves(1)) return true;
      // A turn can be refused (no room in the lane it joins), so the block before the edge turns half the time.
      if (leaves(2)) return randomFor(car.id, crossing * 7 + 3, 131) < 0.6;
      if (districtAt(car.x, car.z).id !== car.home) {
        // Outside home: keep on if already heading back towards it, otherwise turn.
        const home = DISTRICTS[car.home];
        return ((lane.axis === "x" ? home.x - car.x : home.z - car.z) * lane.direction) <= 0;
      }
    }
    return randomFor(car.id, crossing * 7 + 3, 131) < (localKind(car.kind) ? 0.3 : 0.16);
  }
  /** Starts a left turn if the lane it joins has room; the caller removes the car from its lane. */
  private beginTurn(car: Driver, lane: Lane, crossing: number, overshoot: number): boolean {
    const axis2 = lane.axis === "x" ? "z" : "x", d2 = lane.axis === "x" ? -lane.direction : lane.direction;
    const to = this.lane(axis2, crossing, d2), line0 = laneLine(lane.axis, lane.street, lane.direction);
    if (lane.cars.length <= 6 || to.cars.length >= 26) return false;
    const exit = line0 + d2 * TURN_RADIUS;
    for (const other of to.cars) {
      const ahead = wrap((other.along - exit) * d2, LENGTH);
      if (ahead < (localKind(car.kind) ? 11 : 16) + (other.rear ? TRAILING : 0) || ahead > LENGTH - 11) return false;
    }
    for (const turn of this.turning) if (turn.to === to && turn.theta < 1.2) return false;
    const junction = ((lane.axis === "z" ? crossing : lane.street) + STREET_LIMIT) * STREET_COUNT + (lane.axis === "x" ? crossing : lane.street) + STREET_LIMIT;
    this.turning.push({ car, from: lane, to, along0: laneLine(axis2, crossing, d2) - lane.direction * TURN_RADIUS, line0, theta: Math.max(0, overshoot) / TURN_RADIUS, yaw0: car.yaw, junction });
    car.signal = 1; car.waiting = false;
    return true;
  }
  /** Advances cars on their turn arcs; a finished turn joins its new lane in order. */
  private stepTurns(span: number, blockers: readonly { x: number; z: number }[]): void {
    for (let i = this.turning.length - 1; i >= 0; i--) {
      const turn = this.turning[i], { car } = turn, d = turn.from.direction, d2 = turn.to.direction;
      let target = Math.min(car.cruise, 6.5);
      const early = turn.theta < 0.8;
      this.roadAwareness.selectLane(early ? turn.from.axis : turn.to.axis, early ? turn.line0 : laneLine(turn.to.axis, turn.to.street, d2));
      let gap = early ? this.roadAwareness.clearance(turn.along0 + d * TURN_RADIUS * Math.sin(turn.theta), d) : this.roadAwareness.clearance(turn.line0 + d2 * TURN_RADIUS * (1 - Math.cos(turn.theta)), d2);
      const fx = Math.sin(car.yaw), fz = -Math.cos(car.yaw);
      for (const b of blockers) {
        if (!Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
        const ahead = (b.x - car.x) * fx + (b.z - car.z) * fz, side = (b.x - car.x) * fz - (b.z - car.z) * fx;
        if (ahead > -2 && ahead < 14 && Math.abs(side) < 2.6) gap = Math.min(gap, ahead - 6.5);
      }
      if (!early) {
        // Joining: keep a car length behind whatever is ahead in the new lane.
        const at = turn.line0 + d2 * TURN_RADIUS * (1 - Math.cos(turn.theta));
        for (const other of turn.to.cars) {
          const ahead = wrap((other.along - at) * d2, LENGTH);
          if (ahead < 60) gap = Math.min(gap, ahead - 7.5 - (other.rear ? TRAILING : 0));
        }
      }
      target = Math.min(target, Math.sqrt(Math.max(0, gap - 1) * 5));
      easeSpeed(car, target, span);
      const step = Math.min(Math.max(0, gap), Math.max(0, car.speed) * span);
      // Held by the gap (not merely creeping off from a standstill): stop dead.
      if (step < 0.001 && gap <= car.speed * span) { car.speed = 0; car.accel = 0; }
      turn.theta += step / TURN_RADIUS;
      car.stopped = car.speed < 0.3; car.waiting = false; car.signal = 1;
      if (turn.theta >= Math.PI / 2) {
        this.turning.splice(i, 1);
        const lane = turn.to, line = laneLine(lane.axis, lane.street, d2);
        car.along = wrap(turn.line0 + d2 * (TURN_RADIUS + (turn.theta - Math.PI / 2) * TURN_RADIUS) + LENGTH / 2, LENGTH) - LENGTH / 2;
        car.yaw = lane.axis === "x" ? d2 * Math.PI / 2 : d2 < 0 ? 0 : Math.PI;
        if (lane.axis === "x") { car.x = car.along; car.z = line; } else { car.z = car.along; car.x = line; }
        car.signal = 0; car.offset = 0; car.lean = 0; car.pull = 0; car.joined = true;
        const n = lane.cars.length;
        let at = n;
        for (let k = 0; k < n; k++) {
          const a = lane.cars[k].along, span2 = n === 1 ? LENGTH : wrap(lane.cars[(k + 1) % n].along - a, LENGTH);
          if (wrap(car.along - a, LENGTH) < span2) { at = k + 1; break; }
        }
        lane.cars.splice(at, 0, car);
        continue;
      }
      const a = turn.along0 + d * TURN_RADIUS * Math.sin(turn.theta), across = turn.line0 + d2 * TURN_RADIUS * (1 - Math.cos(turn.theta));
      if (turn.from.axis === "x") { car.x = a; car.z = across; } else { car.z = a; car.x = across; }
      car.yaw = turn.yaw0 - turn.theta;
    }
  }
  /** `blockers` are player cars (driven or left in a lane): traffic queues behind them too. */
  update(dt: number, time: number, blockers: readonly { x: number; z: number }[] = [], perception?: RoadPerception): void {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(time)) return;
    const span = Math.min(dt, MAX_TRAFFIC_STEP);
    this.roadAwareness.set(perception);
    this.junctions.fill(0);
    const rail = this.railPoints;
    rail.length = 0;
    for (const lane of this.lanes) for (const car of lane.cars) {
      this.mark(lane.axis, lane.street, car.along);
      if (car.rear) this.mark(lane.axis, lane.street, car.along - TRAILING * lane.direction);
      // Cross traffic on the avenue's rails (committed past its stop line): the trams hold for it.
      if (lane.axis === "x" && Math.abs(car.along) < 8) rail.push(car);
      if (lane.axis === "x" && car.rear && Math.abs(car.rear.x) < 8) rail.push(car.rear);
    }
    for (const turn of this.turning) this.junctions[turn.junction] |= 3;
    this.stepTurns(span, blockers);
    for (const blocker of blockers) if (Math.abs(blocker.x) < 8) rail.push(blocker);
    this.trams.update(span, time, rail, this.roadAwareness, perception?.eye);
    for (const lane of this.lanes) {
      const line = laneLine(lane.axis, lane.street, lane.direction), green = trafficGreen(lane.axis, time);
      const kerb = Math.sign(line - lane.street * 64) || 1, dir = lane.direction, n = lane.cars.length;
      // Bikes filter only in the +1 direction of each street, so two never meet on the centre line;
      // never on the avenue, whose centre carries the tram rails.
      const filtering = dir > 0 && !(lane.axis === "z" && lane.street === 0);
      if (filtering) for (let i = 0; i < n; i++) {
        // A bike that has passed the car ahead of it (or been passed while filtering) swaps places in the queue.
        const car = lane.cars[i], j = wrap(i + dir, n), ahead = lane.cars[j];
        if ((car.filter > 0.02 || ahead.filter > 0.02) && ahead !== car && wrap((ahead.along - car.along) * dir, LENGTH) > LENGTH - 30) { lane.cars[i] = ahead; lane.cars[j] = car; }
      }
      this.blockerAlong.length = 0;
      for (const blocker of blockers) {
        if (Number.isFinite(blocker.x) && Number.isFinite(blocker.z) && Math.abs((lane.axis === "x" ? blocker.z : blocker.x) - line) < 2.6) this.blockerAlong.push(lane.axis === "x" ? blocker.x : blocker.z);
      }
      for (const turn of this.turning) {
        // A turning car holds the lane it leaves until it is mostly round, and the lane it joins from then on.
        if (turn.from === lane && turn.theta < 1.2) this.blockerAlong.push(turn.along0 + dir * TURN_RADIUS * Math.sin(turn.theta));
        else if (turn.to === lane && turn.theta > 0.4) this.blockerAlong.push(turn.line0 + dir * TURN_RADIUS * (1 - Math.cos(turn.theta)));
      }
      this.roadAwareness.selectLane(lane.axis, line);
      this.departing.length = 0;
      for (let i = 0; i < lane.cars.length; i++) {
        // Ambulances filter along the centre line like bikes: the traffic ahead slows and lets them by.
        const car = lane.cars[i], bike = filtering && (twoWheeler(car.kind) || car.kind === "ambulance");
        if (car.joined) { car.joined = false; continue; }
        const offset0 = car.offset; // for the lateral lean
        let gap: number;
        if (bike) {
          // Past slow or queued traffic a bike filters along the centre line, then tucks back in.
          const laneGap = this.gapAhead(lane, i, car, true, false), laneSpeed = this.aheadSpeed, centreGap = this.gapAhead(lane, i, car, false, true);
          const nearJunction = Math.abs(car.along - Math.round(car.along / 64) * 64) < 14;
          let filter = car.filter > 0.5;
          if (!filter && laneGap < 14 && laneSpeed < car.cruise - 3 && centreGap > 10 && !nearJunction) filter = true;
          else if (filter && laneGap > 16 && this.clearBehind(lane, i, car)) filter = false;
          car.filter = Math.max(0, Math.min(1, car.filter + (filter ? span : -span) * FILTER_RATE));
          gap = Math.min(car.filter < 0.98 ? laneGap : Infinity, car.filter > 0.02 ? centreGap : Infinity);
        } else gap = this.gapAhead(lane, i, car, true, false);
        const queued = gap < 3; // held close behind another vehicle
        for (const along of this.blockerAlong) { const d = (along - car.along) * dir; if (d > -2 && d < 80) gap = Math.min(gap, d - 6.5); }
        gap = Math.min(gap, this.roadAwareness.clearance(car.along, dir));
        const stop = stopDistance(lane.axis, dir, car.along);
        const crossing = Math.round((car.along + stop * dir) / 64);
        const streetX = lane.axis === "x" ? crossing : lane.street, streetZ = lane.axis === "z" ? crossing : lane.street;
        const occupied = Math.abs(crossing) <= STREET_LIMIT && (this.junctions[(streetZ + STREET_LIMIT) * STREET_COUNT + streetX + STREET_LIMIT] & (lane.axis === "x" ? 2 : 1)) !== 0;
        // Crossing the avenue: wait for a tram on (or about to reach) the rails, and never stop on
        // them: go only when the car ahead has left room past the avenue's far lanes (or is moving off).
        // (The car ahead keeps moving while this one crosses: credit it in proportion to their speeds.)
        const avenue = lane.axis === "x" && crossing === 0, exit = AVENUE_EXIT - car.along * dir;
        const yieldTram = avenue && (this.trams.crossingBusy(lane.street) || gap + exit * Math.min(1, this.aheadSpeed / Math.max(car.speed, 4)) < exit);
        const canEnter = green && !occupied && !yieldTram;
        // Already past the stop line (held in the junction behind another car): stay short of the
        // rails while a tram is on, or about to reach, this crossing.
        if (lane.axis === "x" && !avenue && this.trams.crossingOccupied(lane.street)) {
          const toRails = -car.along * dir - TRAM_RAIL_CLEAR;
          if (toRails > -0.5 && toRails < AVENUE_STOP_LINE) gap = Math.min(gap, Math.max(0, toRails));
        }
        let target =Math.min(car.filter > 0.02 ? Math.min(car.cruise, 8) : car.cruise, Math.sqrt(Math.max(0, gap - 1) * 5));
        if (!canEnter) target = Math.min(target, Math.sqrt(Math.max(0, stop - 0.35) * 6));
        // Ambulance behind (in lane or filtering past): slow, indicate toward the kerb, let it through.
        let yielding = false;
        if (filtering && !bike && car.kind !== "bus") {
          for (let k = 1; k <= 2 && k < n; k++) {
            const other = lane.cars[wrap(i - k * dir, n)], behind = wrap((car.along - other.along) * dir, LENGTH);
            if (other.kind === "ambulance" && behind > 0 && behind < 40) { yielding = true; break; }
          }
          if (yielding) target = Math.min(target, 4);
        }
        this.berthing = false;
        if (lane.bus && car.kind === "bus") target = this.busStop(lane, car, span, target, kerb);
        // The occasional breakdown: hazards on, stopped mid-block for a while (never in the first minute).
        if (drivableKind(car.kind)) {
          const period = Math.floor(time / 240);
          if (period !== car.stallPeriod) { car.stallPeriod = period; car.stallAt = randomFor(car.id, period, 67) < 0.025 ? period * 240 + 60 + randomFor(car.id, period, 71) * 170 : Infinity; }
          if (time >= car.stallAt) { car.stallAt = Infinity; if (stop > 30 && car.speed > 2) car.stall = 12 + randomFor(car.id, period, 73) * 8; }
        }
        if (car.stall > 0) { car.stall -= span; target = 0; }
        // Queues move off one car at a time: a car held behind another waits a beat after it pulls away.
        if (queued && car.speed < 0.05 && target > 0.6) { car.react += span; if (car.react < car.delay) target = 0; } else car.react = 0;
        easeSpeed(car, target, span);
        const clearance = canEnter ? gap : Math.min(gap, stop - 0.35);
        const step = Math.min(Math.max(0, clearance), Math.max(0, car.speed) * span);
        // Held by the gap or the stop line (not merely creeping off from a standstill): stop dead.
        if (step < 0.001 && clearance <= car.speed * span) { car.speed = 0; car.accel = 0; }
        car.along = wrap(car.along + step * dir + LENGTH / 2, LENGTH) - LENGTH / 2;
        // 0.25 m short of the centre line: clear of both lanes. Eased, so the bike steers across.
        if (bike) car.offset = -kerb * 2.75 * smoothstep01(car.filter);
        if (lane.axis === "x") { car.x = car.along; car.z = line + car.offset; } else { car.z = car.along; car.x = line + car.offset; }
        if (car.offset !== offset0 || car.lean !== 0) {
          // Lean into a lateral move along the path's heading (capped, eased; exactly square again after).
          const want = car.offset !== offset0 && span > 0 ? leanFor((car.offset - offset0) / span, car.speed) : 0;
          car.lean += (want - car.lean) * (1 - Math.exp(-span * LEAN_EASE));
          if (want === 0 && Math.abs(car.lean) < 1e-4) car.lean = 0;
          const base = lane.axis === "x" ? dir * Math.PI / 2 : dir < 0 ? 0 : Math.PI;
          car.yaw = car.lean === 0 ? base : base + (lane.axis === "x" ? dir : -dir) * car.lean;
        }
        placeRear(car);
        car.stopped = car.speed < 0.3;
        car.waiting = car.stopped && car.stall <= 0 && drivableKind(car.kind);
        car.signal = car.stall > 0 ? 3 : this.berthing || yielding ? 1 : 0; // a bus pulling in (or a car letting an ambulance by) indicates toward the kerb
        // Left turns: indicate from 40 m out, leave the lane at the arc's start.
        const toCentre = wrap(-car.along * dir, 64);
        if (car.stall <= 0 && toCentre < 40 && toCentre > 1) {
          const junction = Math.round((car.along + toCentre * dir) / 64);
          if (this.wantsTurn(car, lane, junction)) {
            car.signal = 1;
            const axis2 = lane.axis === "x" ? "z" : "x", d2 = lane.axis === "x" ? -dir : dir;
            const remaining = (laneLine(axis2, junction, d2) - dir * TURN_RADIUS - car.along) * dir;
            if (remaining <= 0 && remaining > -2.5 && car.speed > 0.5 && this.beginTurn(car, lane, junction, -remaining)) this.departing.push(car);
          }
        }
      }
      for (const car of this.departing) lane.cars.splice(lane.cars.indexOf(car), 1);
    }
  }
  private aheadSpeed = 0;
  /** Set by busStop while the bus slows into a berth (doors still shut): its kerb-side indicator runs. */
  private berthing = false;
  /** Gap to the first car ahead sharing this car's line (in lane, or a bike on the centre line).
   * A car up to 30 m behind (a bike just past it) counts as overlapping. */
  private gapAhead(lane: Lane, i: number, car: Driver, onLane: boolean, onCentre: boolean): number {
    const n = lane.cars.length;
    for (let k = 1; k < Math.min(n, 7); k++) {
      const other = lane.cars[wrap(i + k * lane.direction, n)];
      if (!((onLane && other.filter < 0.98) || (onCentre && other.filter > 0.02))) continue;
      const distance = wrap((other.along - car.along) * lane.direction, LENGTH);
      this.aheadSpeed = other.speed;
      return (distance > LENGTH - 30 ? distance - LENGTH : distance) - 7.5 - (other.rear ? TRAILING : 0);
    }
    this.aheadSpeed = 99;
    return 120;
  }
  /** Room for a filtering bike to tuck back in: the nearest in-lane car behind is 9 m back. */
  private clearBehind(lane: Lane, i: number, car: Driver): boolean {
    const n = lane.cars.length;
    for (let k = 1; k < Math.min(n, 7); k++) {
      const other = lane.cars[wrap(i - k * lane.direction, n)];
      if (other.filter >= 0.98) continue;
      const behind = wrap((car.along - other.along) * lane.direction, LENGTH);
      return behind > 9 && behind < LENGTH - 30;
    }
    return true;
  }
  /** Buses slow into each berth on their route, pull in to the kerb, open up for 7-11 s and pull out. */
  private busStop(lane: Lane, car: Driver, span: number, target: number, kerb: number): number {
    const dir = lane.direction, first = busBerth(0, dir);
    const distance = wrap((first - car.along) * dir, 128), block = Math.round((car.along + distance * dir - first) / 64);
    let pull = 0;
    if (car.dwell > 0) { car.dwell -= span; target = 0; pull = 1; }
    else if (distance < 34 && car.served !== block && hasBusStop(lane.axis, lane.street, dir, block)) {
      target = Math.min(target, Math.sqrt(Math.max(0, distance - 0.15) * 2.2));
      if (distance < 24) { pull = 1; this.berthing = distance > 0.7; }
      if (distance < 0.7 && car.speed < 0.7) { car.dwell = car.dwellTotal = 7 + randomFor(car.id, block, 79) * 4; car.served = block; }
    }
    // In to the kerb and out again over BUS_PULL_TRAVEL metres of travel, eased at both ends.
    const travel = Math.max(BUS_PULL_CREEP, Math.abs(car.speed)) * span / BUS_PULL_TRAVEL;
    car.pull = pull > car.pull ? Math.min(pull, car.pull + travel) : Math.max(pull, car.pull - travel);
    car.offset = kerb * 1.1 * smoothstep01(car.pull);
    car.doors = car.dwell > 0;
    car.door = busDoorOpen(car.dwell, car.dwellTotal);
    return target;
  }
  /** The player takes over a stopped car: it leaves its lane for good (driving.ts owns it). */
  takeOver(id: number): Vehicle | null {
    for (const lane of this.lanes) {
      const index = lane.cars.findIndex(car => car.id === id);
      if (index < 0 || lane.cars.length < 3 || !drivableKind(lane.cars[index].kind)) continue;
      const [car] = lane.cars.splice(index, 1);
      return { id: car.id, x: car.x, z: car.z, yaw: car.yaw, speed: car.speed, waiting: car.waiting };
    }
    return null;
  }
  /** Cars in range, except those in the underpass beneath Rootwood Park: the park's streets are
   * promenades, and their lanes run on underground between the gatehouse tunnel mouths (park.ts).
   * A car is dropped only once it is wholly inside a mouth, so it drives into the dark, not away.
   * Long vehicles add their rear footprint (`trailing`), and the outer streets' wrecks are included. */
  nearby(x: number, z: number, range: number): Vehicle[] {
    const cars: Vehicle[] = [], r2 = range * range;
    for (const lane of this.lanes) for (const car of lane.cars) {
      if ((car.x - x) ** 2 + (car.z - z) ** 2 < r2 && !underPark(car.x, car.z)) cars.push(car);
      const rear = car.rear;
      if (rear && (rear.x - x) ** 2 + (rear.z - z) ** 2 < r2 && !underPark(rear.x, rear.z)) cars.push(rear);
    }
    for (const turn of this.turning) if ((turn.car.x - x) ** 2 + (turn.car.z - z) ** 2 < r2) cars.push(turn.car);
    for (const wreck of this.wrecks) if ((wreck.x - x) ** 2 + (wreck.z - z) ** 2 < r2) cars.push(wreck);
    // Trams: a lead entry (kind "tram", carrying the articulated body for drawing) plus six
    // `trailing` footprints, solid like a bus's rear (driving, walking, remote cars).
    this.trams.nearby(x, z, range, cars);
    return cars;
  }
}

/** Keeps a long vehicle's rear footprint 5.8 m behind its front one. */
function placeRear(car: Driver): void {
  const rear = car.rear;
  if (!rear) return;
  // Long vehicles never turn, so their heading is square to the lane but for a bus's few-degree lean
  // into the kerb: the solid rear footprint stays in line with the front (clear of the centre line).
  const square = Math.round(car.yaw / (Math.PI / 2)) * (Math.PI / 2);
  rear.x = car.x - Math.sin(square) * TRAILING; rear.z = car.z + Math.cos(square) * TRAILING;
  rear.yaw = car.yaw; rear.speed = car.speed; rear.stopped = car.stopped;
}
