// Events agent: scheduled happenings in the city (no DOM, no textmode). Like weather.ts, every
// answer is a pure function of the scene clock, so a `?clock=` replay shows the same event at the
// same moment and players sharing a clock share the show. city-events-scene.ts draws them.
//
// Schedule: district happenings run in slots of EVENT_PERIOD seconds, each starting at a hashed
// offset inside its slot (so one starts every 3-6 minutes) and lasting 40-120 s. A slot never
// outlasts the gap to the next one, so at most one district happening runs at any time (and so
// never two in one district). The city wakes quietly: nothing before EVENT_OFFSET, which keeps the
// studio clock (45 s) and every baseline capture unchanged. A satellite re-entry is a separate,
// sky-wide lane: one 12 s streak in every SATELLITE_PERIOD window.
//
// Comfort: everything blooms and fades over seconds (`eventLevel`), and every periodic animation
// the scene uses is listed in ANIMATION_HZ, all below COMFORT_HZ. No flashes, no camera effects.

import { LANDMARKS, WORLD_EDGE } from "./world.ts";

export type CityEventKind = "drones" | "lanterns" | "checkpoint" | "flare" | "substation" | "protest" | "satellite";

export interface CityEventSite {
  readonly kind: CityEventKind;
  /** The toast / news line when it starts near the player. */
  readonly title: string;
  /** District id (world.ts DISTRICTS); -1 for the whole sky. */
  readonly district: number;
  /** Anchor on the ground (the satellite is drawn relative to the eye; its anchor is unused). */
  readonly x: number;
  readonly z: number;
  /** Seconds the happening lasts. */
  readonly duration: number;
  /** Seconds to bloom in and to fade out. */
  readonly fade: number;
  /** Announced when the player is this close to the anchor (Infinity: anywhere outdoors). */
  readonly announceRadius: number;
  /** Drawn only while the eye is this close to the anchor. */
  readonly drawRadius: number;
}

export interface CityEvent {
  /** Unique per scheduled instance: slot * 2 for district happenings, slot * 2 + 1 for satellites. */
  readonly id: number;
  readonly kind: CityEventKind;
  readonly title: string;
  readonly district: number;
  readonly x: number;
  readonly z: number;
  readonly start: number;
  readonly end: number;
  /** 0..2^32 hash of the instance, for per-show variety (shape order, bearing). */
  readonly seed: number;
}

export interface ActiveCityEvent extends CityEvent {
  /** Seconds since it started. */
  readonly age: number;
  /** 0..1 through its duration. */
  readonly progress: number;
  /** 0..1 bloom/fade envelope (smooth at both ends). */
  readonly level: number;
}

export const EVENT_PERIOD = 270, EVENT_JITTER = 90, EVENT_OFFSET = 150;
export const SATELLITE_PERIOD = 600, SATELLITE_SECONDS = 12, SATELLITE_OFFSET = 200, SATELLITE_JITTER = 360;
/** Motion comfort: no periodic brightness or motion change faster than this (Hz). */
export const COMFORT_HZ = 0.4;
/** Every periodic rate the scene animates with (Hz). tests/city-events.test.ts keeps them all below COMFORT_HZ. */
export const ANIMATION_HZ = {
  /** Drone lights breathing a little, out of step with each other. */
  droneTwinkle: 0.15,
  /** The drone formation swinging a few degrees side to side. */
  droneSwing: 0.02,
  /** The koi's body wave. */
  koiSwim: 0.1,
  /** A lantern's candle breathing. */
  lanternBreath: 0.2,
  /** Lanterns wandering on the air. */
  lanternWander: 0.05,
  /** The CorpSec roof lamp blending red to blue and back (never on/off). */
  checkpointLamp: 0.25,
  /** A harbour flare's glow wavering. */
  flareWaver: 0.3,
  /** The substation's arc swelling and easing. */
  sparkSwell: 0.35,
  /** Utility van beacons swelling (never flashing). */
  beaconSwell: 0.3,
  /** Placards swaying on their poles. */
  placardSway: 0.2,
  /** The floating letter panels bobbing. */
  panelBob: 0.1,
} as const;
export type AnimationRate = keyof typeof ANIMATION_HZ;

function landmarkAt(id: string, fallbackX: number, fallbackZ: number): { x: number; z: number } {
  const landmark = LANDMARKS.find(item => item.id === id);
  return landmark ? { x: landmark.x, z: landmark.z } : { x: fallbackX, z: fallbackZ };
}
const GATE = landmarkAt("gate", 0, 208), TREE = landmarkAt("garden", -480, 288);
const CORE = landmarkAt("reactor", -480, -288), ARCADE = landmarkAt("market", 480, 288);

/** The six district happenings, in district order. */
export const EVENT_SITES: readonly CityEventSite[] = [
  // The Foundry: utility crews at a sparking substation in the Ember Core's plaza (a rumour, not a blackout).
  { kind: "substation", title: "Grid fault rumoured in the Foundry: utility crews at the Ember Core", district: 0, x: CORE.x + 14, z: CORE.z + 20, duration: 100, fade: 8, announceRadius: 250, drawRadius: 260 },
  // Neon Ward: a CorpSec checkpoint on the east pavement of the central avenue.
  { kind: "checkpoint", title: "CorpSec checkpoint on the Neon Ward avenue: have your ID ready", district: 1, x: 15.5, z: -300, duration: 110, fade: 6, announceRadius: 250, drawRadius: 220 },
  // Rain Gardens: sky lanterns released around the Last Tree.
  { kind: "lanterns", title: "Sky-lantern release at the Last Tree in the Rain Gardens", district: 3, x: TREE.x, z: TREE.z, duration: 120, fade: 8, announceRadius: 300, drawRadius: 560 },
  // Silk Market: a drone light show behind Memory Gate.
  { kind: "drones", title: "Drone light show over Memory Gate", district: 4, x: GATE.x, z: GATE.z, duration: 96, fade: 8, announceRadius: 350, drawRadius: 650 },
  // Silk Market, harbour side: a ship's flare out beyond the rim.
  { kind: "flare", title: "A ship sends up flares off Silk Harbour", district: 4, x: 40, z: WORLD_EDGE + 220, duration: 72, fade: 6, announceRadius: 520, drawRadius: 1400 },
  // The Spillway: a rent march gathering at the Afterlight Arcade.
  { kind: "protest", title: "Rent march gathering at the Afterlight Arcade", district: 5, x: ARCADE.x - 14, z: ARCADE.z - 18, duration: 100, fade: 6, announceRadius: 250, drawRadius: 220 },
];
export const SATELLITE_SITE: CityEventSite = { kind: "satellite", title: "Satellite re-entry: look up", district: -1, x: 0, z: 0, duration: SATELLITE_SECONDS, fade: 2.5, announceRadius: Infinity, drawRadius: Infinity };
export function eventSite(kind: CityEventKind): CityEventSite {
  return kind === "satellite" ? SATELLITE_SITE : EVENT_SITES.find(site => site.kind === kind) ?? SATELLITE_SITE;
}

/** 0..1 integer hash (no Math.sin, so huge shared clocks stay exact). */
export function eventHash(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** The order of the six happenings in group `g` (slots 6g..6g+5): a seeded shuffle. */
function groupOrder(group: number): number[] {
  const order = [0, 1, 2, 3, 4, 5];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(eventHash(group, 31 + i) * (i + 1));
    const swap = order[i]; order[i] = order[j]; order[j] = swap;
  }
  return order;
}
/** Which happening slot `k` runs (index into EVENT_SITES): never the same one twice in a row. */
export function slotKind(k: number): number {
  const group = Math.floor(k / 6), index = k - group * 6, order = groupOrder(group);
  // Across a group boundary the first two swap if the first would repeat the previous group's last
  // (only positions 0 and 1 ever move, so the previous group's last entry is final).
  if (k > 0 && order[0] === groupOrder(group - 1)[5]) { const swap = order[0]; order[0] = order[1]; order[1] = swap; }
  return order[index];
}

/** The district happening of slot `k` (k >= 0). */
export function eventSlot(k: number): CityEvent {
  const site = EVENT_SITES[slotKind(k)];
  const start = EVENT_OFFSET + k * EVENT_PERIOD + eventHash(k, 7) * EVENT_JITTER;
  return { id: k * 2, kind: site.kind, title: site.title, district: site.district, x: site.x, z: site.z, start, end: start + site.duration, seed: Math.floor(eventHash(k, 11) * 4294967296) };
}
/** The satellite re-entry of window `k` (k >= 0). */
export function satelliteSlot(k: number): CityEvent {
  const start = SATELLITE_OFFSET + k * SATELLITE_PERIOD + eventHash(k, 101) * SATELLITE_JITTER;
  return { id: k * 2 + 1, kind: "satellite", title: SATELLITE_SITE.title, district: -1, x: 0, z: 0, start, end: start + SATELLITE_SECONDS, seed: Math.floor(eventHash(k, 103) * 4294967296) };
}

/** 0..1: blooms in over `fade` seconds, holds, fades out over the last `fade` seconds. */
export function eventLevel(age: number, duration: number, fade: number): number {
  return smooth(age / fade) * smooth((duration - age) / fade);
}

function activate(event: CityEvent, time: number): ActiveCityEvent {
  const site = eventSite(event.kind), age = time - event.start, duration = event.end - event.start;
  return { ...event, age, progress: age / duration, level: eventLevel(age, duration, site.fade) };
}

/** Everything happening at `time` (at most one district happening, plus perhaps a satellite). */
export function activeEvents(time: number): ActiveCityEvent[] {
  const active: ActiveCityEvent[] = [];
  const k = Math.floor((time - EVENT_OFFSET) / EVENT_PERIOD);
  for (const slot of [k - 1, k]) {
    if (slot < 0) continue;
    const event = eventSlot(slot);
    if (time >= event.start && time < event.end) active.push(activate(event, time));
  }
  const s = Math.floor((time - SATELLITE_OFFSET) / SATELLITE_PERIOD);
  if (s >= 0) {
    const event = satelliteSlot(s);
    if (time >= event.start && time < event.end) active.push(activate(event, time));
  }
  return active;
}

/** The happening running in a district at `time` (-1: the sky's satellite), or null. */
export function eventAt(time: number, districtId: number): ActiveCityEvent | null {
  return activeEvents(time).find(event => event.district === districtId) ?? null;
}

/** Every happening that overlaps [from, to), by start time: for tests, tools and a future news ticker. */
export function scheduledEvents(from: number, to: number): CityEvent[] {
  const events: CityEvent[] = [];
  const firstSlot = Math.max(0, Math.floor((from - EVENT_OFFSET - EVENT_JITTER - 120) / EVENT_PERIOD));
  for (let k = firstSlot; k <= Math.floor((to - EVENT_OFFSET) / EVENT_PERIOD); k++) {
    const event = eventSlot(k);
    if (event.end > from && event.start < to) events.push(event);
  }
  const firstSatellite = Math.max(0, Math.floor((from - SATELLITE_OFFSET - SATELLITE_JITTER - SATELLITE_SECONDS) / SATELLITE_PERIOD));
  for (let k = firstSatellite; k <= Math.floor((to - SATELLITE_OFFSET) / SATELLITE_PERIOD); k++) {
    const event = satelliteSlot(k);
    if (event.end > from && event.start < to) events.push(event);
  }
  return events.sort((a, b) => a.start - b.start);
}

/**
 * Announces each happening once: the first frame it is running while the player is outdoors
 * within its announce radius (and not in its last 15 s). engine.ts turns the line into a toast.
 */
export class CityEventWatch {
  private readonly seen = new Set<number>();
  update(time: number, x: number, z: number, quiet: boolean): string | null {
    if (quiet) return null;
    for (const event of activeEvents(time)) {
      if (this.seen.has(event.id) || event.end - time < 15) continue;
      if (Math.hypot(x - event.x, z - event.z) > eventSite(event.kind).announceRadius) continue;
      this.seen.add(event.id);
      if (this.seen.size > 24) { const oldest = this.seen.values().next().value; if (oldest !== undefined) this.seen.delete(oldest); }
      return event.title;
    }
    return null;
  }
}
/** The engine's watch (one city per page). */
export const cityEventWatch = new CityEventWatch();
