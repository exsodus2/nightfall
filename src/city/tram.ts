import type { RoadAwareness } from "./road-awareness.ts";
import type { Vehicle } from "./traffic.ts";

/**
 * Meridian Avenue tram: a deterministic two-way service on the avenue's rails (the ground shader
 * in materials.ts draws them: rail pairs centred at |x| = 2.4, rails 0.72 either side, broken over
 * each junction). Pure logic, no DOM, no textmode: positions are a function of the shared signal
 * clock (traffic.update's `time`), so multiplayer clients agree.
 *
 * The line is a loop of 20 stop slots: ten southbound (+z, keep left: the x = +2.4 track) and ten
 * northbound (-z, x = -2.4). Every tram runs one leg (two blocks, 128 m) per signal cycle (28 s,
 * people.ts trafficGreen): it pulls away at phase TRAM_DEPART, crosses two junctions inside the
 * avenue's own green plus the all-red either side of it (never during cross-street green), and
 * dwells at the next island platform with its doors open. At each end it reverses (it is double-
 * ended) and crosses over to the other track in the middle of the next block.
 *
 * Off schedule only locally: a tram holds for anything on its rails (cars crossing the avenue, the
 * player's car, walkers on the carriageway, another tram), then catches up at its top speed and
 * snaps back onto the timetable. It never runs ahead of it.
 */

/** Rail-pair centre line (materials.ts: abs(abs(abs(p.x) - 2.4) - 0.72)). */
export const TRAM_TRACK_X = 2.4;
/** Rail to rail. */
export const TRAM_GAUGE = 1.44;
export const TRAM_HALF_WIDTH = 1.3;
/** Three body sections joined by short bellows: 3 x 9.4 + 2 x 0.4 = 29 m, exactly five car
 * footprints (5.8 m, traffic.ts TRAILING) end to end. */
export const TRAM_SECTIONS = 3, TRAM_SECTION_LENGTH = 9.4, TRAM_JOINT = 0.4;
export const TRAM_FOOTPRINTS = 5, TRAM_FOOTPRINT = 5.8;
export const TRAM_LENGTH = 29; // = TRAM_SECTIONS * TRAM_SECTION_LENGTH + (TRAM_SECTIONS - 1) * TRAM_JOINT, exact
/** The signal cycle (people.ts trafficGreen: avenue green 0-11 s, cross streets 14-25 s). */
export const TRAM_CYCLE = 28;
/** Leg length: stops every other block. */
export const TRAM_LEG = 128;
export const TRAM_SLOTS = 20;
export const TRAM_LOOP = TRAM_SLOTS * TRAM_LEG;
/** Signal phase at which every tram pulls away from its stop: its junction crossings then fall in
 * phases 28.3-41.2 (mod 28: the all-red, the avenue's green, the next all-red), never in the cross
 * streets' green (14-25), and it dwells through that green. */
export const TRAM_DEPART = 24.5;
export const TRAM_ACCEL = 1.3, TRAM_TOP = 10;
const ACCEL_TIME = TRAM_TOP / TRAM_ACCEL, ACCEL_DISTANCE = 0.5 * TRAM_ACCEL * ACCEL_TIME * ACCEL_TIME;
/** Seconds from pulling away to stopping at the next platform (the rest of the cycle is dwell). */
export const TRAM_RUN = 2 * ACCEL_TIME + (TRAM_LEG - 2 * ACCEL_DISTANCE) / TRAM_TOP;
export const TRAM_COUNT = 8;
/** First tram id (below traffic.ts TRAFFIC_ID_BASE, above parked 20000+ and remote 60000+ ids). */
export const TRAM_ID_BASE = 90000;
export const isTramId = (id: number): boolean => Math.abs(id) >= TRAM_ID_BASE && Math.abs(id) < TRAM_ID_BASE + 10000;
/** Half the width of an east-west carriageway band a tram must be clear of (lanes at +-3.0, 1.35 half width). */
export const TRAM_CROSSING_HALF = 5.5;
/** Seconds ahead a car about to cross the avenue looks for a tram (at the stop line, and once in the junction). */
export const TRAM_CROSSING_HORIZON = 5, TRAM_RAIL_HORIZON = 2.5;
const CROSSING_HORIZONS: readonly (readonly [number, number])[] = [[TRAM_CROSSING_HORIZON, 1], [TRAM_RAIL_HORIZON, 2]];
/** A car crossing the avenue is clear of the rails while its centre is this far from the avenue's centre line. */
export const TRAM_RAIL_CLEAR = TRAM_TRACK_X + TRAM_HALF_WIDTH + 2.9 + 0.5;
/** Catch-up speed after a hold, and the service braking rate for holds. */
const CATCH_UP = 11, HOLD_BRAKE = 1.8;

/** One leg's front path: z0 at the start, heading `dir` (+1 = +z), lateral x0 -> x1 over [c0, c1]. */
interface Leg { z0: number; dir: 1 | -1; x0: number; x1: number; c0: number; c1: number }
/** Every tram berths along z in [15, 44] + 128k (the island platform between the tracks): the
 * southbound front at 44 + 128k, the northbound front at 15 + 128k. Both are mid-block, clear of
 * the junction crossing bands either side. */
export const TRAM_PLATFORM_LAST = 44, TRAM_PLATFORM_FIRST = TRAM_PLATFORM_LAST - TRAM_LENGTH;
export const TRAM_PLATFORM_BLOCKS: readonly number[] = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
const straight = (z0: number, dir: 1 | -1): Leg => { const x = dir > 0 ? TRAM_TRACK_X : -TRAM_TRACK_X; return { z0, dir, x0: x, x1: x, c0: 0, c1: 1 }; };
function buildLegs(): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < 9; i++) legs.push(straight(TRAM_PLATFORM_LAST + TRAM_LEG * (i - 4), 1));
  // South end: arrive at z 655..684 on the southbound track, reverse (the old rear leads), cross
  // over between the junctions at 640 and 576 (13 m clear of each), finish at the northbound stop.
  legs.push({ z0: 684 - TRAM_LENGTH, dir: -1, x0: TRAM_TRACK_X, x1: -TRAM_TRACK_X, c0: 28, c1: 66 });
  for (let i = 10; i < 19; i++) legs.push(straight(TRAM_PLATFORM_FIRST + TRAM_LEG * (14 - i), -1));
  // North end: arrive at -625..-596 northbound, reverse, cross over between -576 and -512.
  legs.push({ z0: -596, dir: 1, x0: -TRAM_TRACK_X, x1: TRAM_TRACK_X, c0: 33, c1: 71 });
  return legs;
}
export const TRAM_LEGS: readonly Leg[] = buildLegs();

const wrap = (n: number, length: number): number => ((n % length) + length) % length;
const smooth01 = (u: number): number => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
const clamp01 = (u: number): number => Math.max(0, Math.min(1, u));

/** Distance covered `x` (0..1) of the way through a speed-up whose speed is TOP * smoothstep(x), in
 * units of TOP * ACCEL_TIME: x^3 - x^4 / 2 (0.5 at the end, the old constant-rate ramp's distance). */
const rampDistance = (x: number): number => x * x * x - 0.5 * x * x * x * x;
/** Distance along the leg `u` seconds after pulling away (accelerate, cruise, brake into the stop).
 * Speed-up and braking follow a smoothstep in speed over ACCEL_TIME (acceleration grows from zero,
 * jerk about 1 m/s^3, peak 1.5 x TRAM_ACCEL mid-ramp): the same distance and run time as a
 * constant-rate ramp, so the timetable, stops and junction phases hold (the front reaches the first
 * junction ~0.3 s later and clears the last one earlier), but it no longer lurches off or into a stop. */
export function tramLegDistance(u: number): number {
  if (u <= 0) return 0;
  if (u >= TRAM_RUN) return TRAM_LEG;
  if (u < ACCEL_TIME) return TRAM_TOP * ACCEL_TIME * rampDistance(u / ACCEL_TIME);
  if (u < TRAM_RUN - ACCEL_TIME) return ACCEL_DISTANCE + TRAM_TOP * (u - ACCEL_TIME);
  return TRAM_LEG - TRAM_TOP * ACCEL_TIME * rampDistance((TRAM_RUN - u) / ACCEL_TIME);
}
export function tramLegSpeed(u: number): number {
  if (u <= 0 || u >= TRAM_RUN) return 0;
  return TRAM_TOP * smooth01(Math.min(1, u / ACCEL_TIME, (TRAM_RUN - u) / ACCEL_TIME));
}
/** Seconds into the current cycle since the departure phase (0 .. TRAM_CYCLE). */
export const tramCycleTime = (time: number): number => wrap(time - TRAM_DEPART, TRAM_CYCLE);
/** Starting slot of tram `index`, spread round the loop (2 or 3 stops apart). */
export const tramStartSlot = (index: number): number => Math.round(index * TRAM_SLOTS / TRAM_COUNT) % TRAM_SLOTS;
/** Timetabled front position along the loop (unwrapped: grows by one leg per cycle). */
export function tramScheduleArc(index: number, time: number): number {
  const n = Math.floor((time - TRAM_DEPART) / TRAM_CYCLE), u = time - TRAM_DEPART - n * TRAM_CYCLE;
  return (tramStartSlot(index) + n) * TRAM_LEG + tramLegDistance(u);
}
/** Doors 0..1: open through the dwell, shut a second either side of it. */
export function tramDoors(time: number): number {
  const u = tramCycleTime(time);
  return clamp01((u - TRAM_RUN - 0.8) / 0.8) * clamp01((TRAM_CYCLE - 1.2 - u) / 0.8);
}

export interface TramPoint { x: number; z: number; yaw: number }
/** Front path of `leg` at distance `s` (negative: the straight run behind its start). */
export function tramLegPoint(leg: number, s: number, out: TramPoint = { x: 0, z: 0, yaw: 0 }): TramPoint {
  const l = TRAM_LEGS[leg], span = l.c1 - l.c0, u = (s - l.c0) / span;
  out.z = l.z0 + l.dir * s;
  out.x = l.x0 + (l.x1 - l.x0) * smooth01(u);
  const slope = u <= 0 || u >= 1 ? 0 : (l.x1 - l.x0) * 6 * u * (1 - u) / span;
  out.yaw = Math.atan2(slope, -l.dir);
  return out;
}
/** Leg and distance along it of a loop position. */
export function tramLegAt(arc: number): { leg: number; s: number } {
  const a = wrap(arc, TRAM_LOOP), leg = Math.min(TRAM_SLOTS - 1, Math.floor(a / TRAM_LEG));
  return { leg, s: a - leg * TRAM_LEG };
}
/** World z of a loop position's front (the body behind it covers the same z on either side of a reversal). */
export function tramArcZ(arc: number): number {
  const { leg, s } = tramLegAt(arc), l = TRAM_LEGS[leg];
  return l.z0 + l.dir * s;
}
/** Section `k` (0 leads) of a tram whose front is at `arc`: centre and heading along its chord. */
export function tramSectionPose(arc: number, k: number, out: TramPoint): TramPoint {
  const { leg, s } = tramLegAt(arc), offset = k * (TRAM_SECTION_LENGTH + TRAM_JOINT);
  const front = tramLegPoint(leg, s - offset, SCRATCH_A), rear = tramLegPoint(leg, s - offset - TRAM_SECTION_LENGTH, SCRATCH_B);
  out.x = (front.x + rear.x) / 2; out.z = (front.z + rear.z) / 2;
  out.yaw = Math.atan2(front.x - rear.x, -(front.z - rear.z));
  return out;
}
const SCRATCH_A: TramPoint = { x: 0, z: 0, yaw: 0 }, SCRATCH_B: TramPoint = { x: 0, z: 0, yaw: 0 }, SCRATCH_C: TramPoint = { x: 0, z: 0, yaw: 0 };

/** Drawing state of one tram (activity.ts drawTram reads it from the lead vehicle). */
export interface TramView {
  index: number;
  /** Leading section first. Local frame per section: -z forward, +x right (the platform side). */
  sections: TramPoint[];
  speed: number;
  /** 0 shut .. 1 open, platform side. */
  doors: number;
  /** Local side facing the island platform (+1 right, -1 left: the old rear leads after a reversal). */
  doorSide: 1 | -1;
  /** +1 southbound (+z), -1 northbound. */
  heading: 1 | -1;
  braking: boolean;
}
/** The lead footprint (the front 5.8 m) carries the view; four more, `trailing`, cover the body. */
export interface TramVehicle extends Vehicle { kind: "tram"; tram: TramView }
export const isTramVehicle = (vehicle: Vehicle): vehicle is TramVehicle => (vehicle as Partial<TramVehicle>).tram !== undefined;

interface TramState { index: number; arc: number; speed: number; still: number; view: TramView; lead: TramVehicle; footprints: Vehicle[] }

/** Departure bell mailbox for the ambience (seconds left to claim it; one bell, not a queue). */
let bellPending = 0;
/** True once after a tram pulled away within 40 m of the listener (ambience.ts polls it). */
export function takeTramBell(): boolean { const ready = bellPending > 0; bellPending = 0; return ready; }
export const TRAM_BELL_RANGE = 40;

/** Obstacles on the rails: car centres, with their heading when known (walkers come through RoadAwareness). */
export interface RailObstacle { x: number; z: number; yaw?: number }
const OBSTACLE_HALF = 2.9;
/** Terminus rule: the hold point (metres into the approach leg; short of the first junction's
 * crossing band on both approaches) and how far into the reversing leg a tram is wholly across. */
const TERMINUS_HOLD = 8, TERMINUS_CLEAR = 71 + TRAM_LENGTH;

export class TramLine {
  private readonly trams: TramState[] = [];
  private readonly busy = new Uint8Array(32);
  private lastTime = NaN;
  constructor() {
    for (let i = 0; i < TRAM_COUNT; i++) {
      const view: TramView = { index: i, sections: [0, 1, 2].map(() => ({ x: 0, z: 0, yaw: 0 })), speed: 0, doors: 0, doorSide: 1, heading: 1, braking: false };
      const id = TRAM_ID_BASE + i * 16;
      const lead: TramVehicle = { id, x: 0, z: 0, yaw: 0, speed: 0, waiting: false, stopped: true, kind: "tram", tram: view };
      const footprints: Vehicle[] = [];
      for (let k = 1; k < TRAM_FOOTPRINTS; k++) footprints.push({ id: -(id + k), x: 0, z: 0, yaw: 0, speed: 0, waiting: false, trailing: true, stopped: true });
      this.trams.push({ index: i, arc: NaN, speed: 0, still: 0, view, lead, footprints });
    }
  }
  /** Loop positions (fronts) of every tram, for checks. */
  arcs(): number[] { return this.trams.map(t => t.arc); }
  views(): readonly TramView[] { return this.trams.map(t => t.view); }

  /** Advances every tram: on the timetable unless something is on its rails. */
  update(dt: number, time: number, obstacles: readonly RailObstacle[] = [], awareness?: RoadAwareness, eye?: { x: number; z: number }): void {
    if (!Number.isFinite(time)) return;
    const span = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    bellPending = Math.max(0, bellPending - span);
    const jumped = !Number.isFinite(this.lastTime) || Math.abs(time - this.lastTime) > 2;
    this.lastTime = time;
    const u = tramCycleTime(time), scheduleSpeed = tramLegSpeed(u), doors = tramDoors(time);
    for (const tram of this.trams) {
      const target = tramScheduleArc(tram.index, time);
      // First frame, a clock jump, or a clock running backwards: take the timetable as it stands.
      if (jumped || !Number.isFinite(tram.arc) || tram.arc > target + 1e-6 || target - tram.arc > TRAM_LOOP / 2) { tram.arc = target; tram.speed = scheduleSpeed; }
      const limit = Math.min(target, this.holdLimit(tram, obstacles, awareness));
      const before = tram.arc, speedBefore = tram.speed;
      if (limit >= target - 1e-9 && target - tram.arc <= scheduleSpeed * span + 0.3) { tram.arc = target; tram.speed = scheduleSpeed; }
      else if (limit > tram.arc) {
        // Chase the (moving) timetable, but brake to a stand short of a hold.
        const behind = target - tram.arc, held = limit < target - 1e-9;
        let want = Math.min(CATCH_UP, scheduleSpeed + Math.sqrt(2 * HOLD_BRAKE * 0.5 * behind));
        if (held) want = Math.min(want, Math.sqrt(2 * HOLD_BRAKE * (limit - tram.arc)));
        tram.speed += Math.max(-3 * span, Math.min(TRAM_ACCEL * span, want - tram.speed));
        tram.arc = Math.min(limit, tram.arc + Math.max(0, tram.speed) * span);
      } else tram.speed = 0;
      if (tram.arc - before < 1e-6) tram.speed = Math.min(tram.speed, 0);
      tram.speed = Math.max(0, tram.speed);
      // The bell: pulling away after standing a while (a dwell or a hold), heard within 40 m.
      if (tram.speed > 0.05 && tram.still > 3 && eye && Number.isFinite(eye.x) && Number.isFinite(eye.z)) {
        const middle = tram.view.sections[1];
        if (Math.hypot(middle.x - eye.x, middle.z - eye.z) < TRAM_BELL_RANGE + TRAM_LENGTH / 2) bellPending = 1.5;
      }
      tram.still = tram.speed < 0.05 ? tram.still + span : 0;
      this.place(tram, tram.arc === target ? doors : 0, tram.speed < speedBefore - 0.01);
    }
    this.markCrossings(time);
  }

  /** How far the front may go: short of anything on its rails ahead, and the terminus rule. */
  private holdLimit(tram: TramState, obstacles: readonly RailObstacle[], awareness: RoadAwareness | undefined): number {
    const { leg, s } = tramLegAt(tram.arc), l = TRAM_LEGS[leg], front = tramLegPoint(leg, s, SCRATCH_C);
    let gap = Infinity;
    const consider = (x: number, z: number, halfAlong: number, halfAcross: number, margin: number) => {
      const along = (z - front.z) * l.dir;
      if (along < -halfAlong || along > 70) return;
      const lateral = tramLegPoint(leg, s + Math.max(0, along), SCRATCH_A).x;
      if (Math.abs(x - lateral) >= TRAM_HALF_WIDTH + halfAcross) return;
      gap = Math.min(gap, Math.max(0, along - halfAlong - margin));
    };
    for (const o of obstacles) {
      if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
      // A car's footprint (2.9 x 1.35 m halves) turned by its yaw; unknown heading: the larger half both ways.
      const yaw = o.yaw ?? NaN, sin = Math.abs(Math.sin(yaw)), cos = Math.abs(Math.cos(yaw));
      const halfX = Number.isFinite(yaw) ? sin * OBSTACLE_HALF + cos * 1.35 : OBSTACLE_HALF, halfZ = Number.isFinite(yaw) ? cos * OBSTACLE_HALF + sin * 1.35 : OBSTACLE_HALF;
      consider(o.x, o.z, halfZ, halfX, 1.5);
    }
    for (const other of this.trams) {
      if (other === tram || !Number.isFinite(other.arc)) continue;
      for (const section of other.view.sections) consider(section.x, section.z, TRAM_SECTION_LENGTH / 2, TRAM_HALF_WIDTH + 0.4, 3);
    }
    if (awareness) {
      // Walkers on the carriageway (players, crossing residents): RoadAwareness sizes its lane
      // test for a 2.7 m car and its extents from a car's centre, so the centre sits 2.9 m back.
      awareness.selectLane("z", front.x);
      gap = Math.min(gap, awareness.clearance(front.z - l.dir * 2.9, l.dir));
    }
    let limit = tram.arc + gap;
    // Terminus rule: while another tram is reversing at the end it is approaching (until it is wholly
    // across onto the other track), wait short of the junction before the end block. Lockstep keeps
    // trams two stops apart, so this only bites after a hold.
    const next = (leg + 1) % TRAM_SLOTS;
    if (next === 9 || next === 19) {
      const end = next * TRAM_LEG, hold = end - TRAM_LEG + TERMINUS_HOLD, at = wrap(tram.arc, TRAM_LOOP);
      if (at <= hold + 1e-6) {
        for (const other of this.trams) {
          if (other === tram || !Number.isFinite(other.arc)) continue;
          const ahead = wrap(other.arc - hold, TRAM_LOOP);
          if (ahead > 0 && ahead <= TRAM_LEG - TERMINUS_HOLD + TERMINUS_CLEAR) limit = Math.min(limit, tram.arc + (hold - at));
        }
      }
    }
    return limit;
  }

  private place(tram: TramState, doors: number, braking: boolean): void {
    const view = tram.view;
    for (let k = 0; k < TRAM_SECTIONS; k++) tramSectionPose(tram.arc, k, view.sections[k]);
    view.speed = tram.speed; view.doors = doors; view.braking = braking;
    view.heading = TRAM_LEGS[tramLegAt(tram.arc).leg].dir;
    // The island platform is towards x = 0; a section's local right is (cos yaw, sin yaw).
    const middle = view.sections[1];
    view.doorSide = -Math.sign(middle.x) * Math.cos(middle.yaw) >= 0 ? 1 : -1;
    // Five car footprints end to end along the path (5.8 m apart, like a bus's rear): the lead one
    // carries the drawing state; the rest are `trailing` (collision only).
    const { leg, s } = tramLegAt(tram.arc), stopped = tram.speed < 0.3;
    for (let f = 0; f < TRAM_FOOTPRINTS; f++) {
      const footprint = f === 0 ? tram.lead : tram.footprints[f - 1];
      const point = tramLegPoint(leg, s - TRAM_FOOTPRINT / 2 - f * TRAM_FOOTPRINT, SCRATCH_C);
      footprint.x = point.x; footprint.z = point.z; footprint.yaw = point.yaw;
      footprint.speed = tram.speed; footprint.stopped = stopped;
    }
  }

  /** Marks the east-west streets a tram occupies or may reach: bit 1 within TRAM_CROSSING_HORIZON
   * (cars wait at the stop line), bit 2 within TRAM_RAIL_HORIZON (cars already in the junction
   * wait short of the rails). */
  private markCrossings(time: number): void {
    this.busy.fill(0);
    for (const tram of this.trams) for (const [horizon, bit] of CROSSING_HORIZONS) {
      const reach = Math.min(tramScheduleArc(tram.index, time + horizon), tram.arc + CATCH_UP * horizon);
      const from = tram.arc - TRAM_LENGTH, to = Math.max(tram.arc, reach);
      let low = Infinity, high = -Infinity;
      for (let a = from; ; a = Math.min(to, a + 6)) {
        const z = tramArcZ(a);
        low = Math.min(low, z); high = Math.max(high, z);
        if (a >= to) break;
      }
      const first = Math.ceil((low - TRAM_CROSSING_HALF) / 64), last = Math.floor((high + TRAM_CROSSING_HALF) / 64);
      for (let street = Math.max(-15, first); street <= Math.min(15, last); street++) this.busy[street + 15] |= bit;
    }
  }
  /** Whether cars on east-west street `street` (z = street * 64) must wait at the stop line before crossing the avenue. */
  crossingBusy(street: number): boolean {
    return Number.isInteger(street) && street >= -15 && street <= 15 && (this.busy[street + 15] & 1) !== 0;
  }
  /** Whether a tram is on, or within a couple of seconds of, the crossing of east-west street `street`. */
  crossingOccupied(street: number): boolean {
    return Number.isInteger(street) && street >= -15 && street <= 15 && (this.busy[street + 15] & 2) !== 0;
  }

  /** Tram footprints within `range` (lead entries carry the drawing state). */
  nearby(x: number, z: number, range: number, out: Vehicle[]): void {
    const r2 = range * range;
    for (const tram of this.trams) {
      if (!Number.isFinite(tram.arc)) continue;
      const middle = tram.view.sections[1];
      if ((middle.x - x) ** 2 + (middle.z - z) ** 2 > (range + TRAM_LENGTH) ** 2) continue;
      // The lead entry draws the whole tram: present while any of it is in range.
      if ((tram.lead.x - x) ** 2 + (tram.lead.z - z) ** 2 < r2 || (middle.x - x) ** 2 + (middle.z - z) ** 2 < r2) out.push(tram.lead);
      for (const footprint of tram.footprints) if ((footprint.x - x) ** 2 + (footprint.z - z) ** 2 < r2) out.push(footprint);
    }
  }
}

/** Island platforms (median, |x| < 1) along z = [18, 44] + 128k: one per stop block. */
export interface TramStop { block: number; z0: number; z1: number; z: number }
export const TRAM_STOPS: readonly TramStop[] = TRAM_PLATFORM_BLOCKS.map(block => {
  const z0 = TRAM_PLATFORM_FIRST + block * TRAM_LEG, z1 = TRAM_PLATFORM_LAST + block * TRAM_LEG;
  return { block, z0, z1, z: (z0 + z1) / 2 };
});
/** Platform island half width: between the two trams' bodies (|x| >= 1.1). */
export const TRAM_PLATFORM_HALF = 0.95;
