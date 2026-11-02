/**
 * Pure mixing rules for the procedural city ambience (src/audio/ambience.ts). Nothing here touches
 * Web Audio: the engine's frame state goes in, target levels and event decisions come out, so the
 * curves are unit-tested without a browser. Dependency-free on purpose (no city imports) so the
 * synth can be checked in a bare page; ambience-probe.ts reads trains and traffic for the engine.
 */

/** What the engine knows about the listener, sampled with each HUD snapshot (about 6 Hz). */
export interface AmbienceFrame {
  /** District id (world.ts DISTRICTS index); the mix itself blends from x / z near borders. */
  district: number;
  x: number;
  /** Eye height in metres (street level is about 2.7). */
  y: number;
  z: number;
  /** Inside a venue (interiors.active). */
  interior: boolean;
  /** The visual rain setting: the rain bed follows it. */
  rain: boolean;
  /** Optional 0..1 storm strength; without one the bed drifts slowly on its own. */
  weather?: number;
  /** Horizontal speed in m/s (car speed while driving, may be negative in reverse). */
  speed: number;
  /** On foot, standing on something (no footsteps mid-jump or in flight). */
  walking: boolean;
  driving: boolean;
  boost: boolean;
  /** Aboard a monorail carriage, and that train's speed in m/s. */
  riding: boolean;
  ridingSpeed: number;
  /** A station lift is moving. */
  lift: boolean;
  /** Nearest monorail train not ridden (metres, Infinity when none), its speed and whether it is braking for a station. */
  trainDistance: number;
  trainSpeed: number;
  trainBraking: boolean;
  /** Nearest street car, if any is close; `heavy` for a bus, truck or tanker (a deeper, longer pass). */
  car: { id: number; distance: number; speed: number; heavy?: boolean } | null;
  /** Scene time in seconds (drives the slow weather drift). */
  time: number;
  /** Optional 0..1 wind gust (weather.ts gustAt): the wind layer swells with it. */
  gust?: number;
  /** Standing on a station platform: footsteps ring on metal. */
  platform?: boolean;
  /** The running district happening (city-events.ts activeEvents, the satellite excluded), or null. */
  event?: AmbienceCityEvent | null;
  /** The kind of venue the listener is inside (interiors.ts InteriorKind, e.g. "nightclub"); null outdoors. */
  venue?: string | null;
  /** Optional place id (e.g. "bldg-12") and floor number: seed the room tone so a room sounds the same on revisit. */
  venueId?: string | null;
  floor?: number | null;
  /** Upper-floor plan variant (upper-floors.ts upperVariant: "apartments", "sky-bar", ...); null/absent on a ground floor. */
  variant?: string | null;
  /** The floor is open to the sky (upperOpenAir); inferred from `variant` when absent. */
  openAir?: boolean;
  /** Metres from the listener to The Static's street door (Infinity or absent when unknown). */
  club?: number;
}

/** A city event as the ambience hears it: which one, how far its site is and its 0..1 bloom / fade envelope. */
export interface AmbienceCityEvent {
  id: number;
  /** city-events.ts CityEventKind ("substation", "checkpoint", "lanterns", "drones", "flare", "protest", ...). */
  kind: string;
  /** Metres from the listener to the event's anchor. */
  distance: number;
  /** Seconds since it started. */
  age: number;
  level: number;
}

/** Target parameter values for the continuous layers (gains are linear, tones in Hz). */
export interface AmbienceLevels {
  rain: number; rainTone: number;
  hum: number; traffic: number; rumble: number; furnace: number;
  buzz: number; voices: number; voiceTone: number; voicePulse: number;
  crackle: number; insects: number; sizzle: number; water: number;
  carriage: number; engine: number; enginePitch: number; engineTone: number; boost: number;
  train: number; trainTone: number;
  /** Interior treatment: the outdoor bus level, its low-pass corner and the room tone. */
  outdoor: number; muffle: number; room: number;
  /** Harbour: the swell against the flood wall; wind (level and band centre, Hz) rising with gusts. */
  swell: number; wind: number; windTone: number;
  /** City event beds: substation buzz and sparks, the drone swarm, the march, checkpoint radios, a flare's hiss. */
  transformer: number; sparks: number; drones: number; march: number; chatter: number; flareHiss: number;
  /** The Static: its bus level and low-pass corner (only bass leaks through the wall), the synth pad,
   *  the pad's sweeping filter base (Hz) and the crowd inside. */
  club: number; clubTone: number; clubBed: number; clubSweep: number; clubCrowd: number;
}

/** Expected one-shot rates per second (Poisson) for the district colour. */
export interface AmbienceRates { drips: number; chirps: number; gulls: number }

/** District weights, indexed like world.ts DISTRICTS: Foundry, Neon Ward, Ghost Circuit, Rain Gardens, Silk Market, Spillway. */
export type DistrictWeights = readonly [number, number, number, number, number, number];

export const FOUNDRY = 0, NEON = 1, GHOST = 2, GARDENS = 3, MARKET = 4, SPILLWAY = 5;
/** District borders (world.ts districtAt): columns split at x = +-256, rows at z = 0. */
const COLUMN_EDGE = 256, BLEND = 48;
/** Foundry furnace yard (DISTRICTS[0] centre) for the sub-rumble. */
const FOUNDRY_X = -512, FOUNDRY_Z = -320;
/** Trains are heard within this many metres. */
export const TRAIN_RANGE = 60;
/** A car passing closer than this (metres) at speed whooshes; a bus, truck or tanker a little further. */
export const PASS_RANGE = 10, HEAVY_PASS_RANGE = 14;
/** The harbour water's inner edge, max(|x|, |z|) in metres: harbour.ts HARBOUR_ROAD + HARBOUR_WALL +
 *  HARBOUR_COPING (restated so this module stays import-free; tests/ambience-mix.test.ts checks it). */
export const WATER_EDGE = 802;
/** The harbour (swell, gulls, foghorn, exposed wind) is heard within this many metres of the water. */
export const HARBOUR_RANGE = 120;
/** The Static's bass leaks through its wall within this many metres of the street door. */
export const CLUB_RANGE = 25;
/** Seconds between the club's bass thumps: 0.4 Hz, the comfort ceiling for anything pulsing (city-events.ts COMFORT_HZ). */
export const CLUB_BEAT = 2.5;
/** The march's chant swell (Hz), under the same 0.4 Hz ceiling. */
export const CHANT_HZ = 0.35;
/** A foghorn sounds at most this often (seconds), and only this close to the water (harbourNear). */
export const FOGHORN_GAP = 90, FOGHORN_NEAR = 0.35;
/** Flare launches and lantern releases (seconds into the event), city-events-scene.ts flare() / lanterns(). */
export const FLARE_LAUNCHES: readonly number[] = [0, 24], LANTERN_RELEASES: readonly number[] = [1, 20];

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Slow 0..1 storm drift (minutes-long swells) when the engine has no weather value. */
export function weatherDrift(time: number): number {
  const t = Number.isFinite(time) ? time : 0;
  return clamp01(0.55 + 0.28 * Math.sin(t / 97) + 0.17 * Math.sin(t / 41 + 1.3));
}

/** Weights that are exactly one district inside it and cross-fade within 48 m of a border; they sum to 1. */
export function districtWeights(x: number, z: number): DistrictWeights {
  const east = smooth(COLUMN_EDGE - BLEND, COLUMN_EDGE + BLEND, x);
  const west = 1 - smooth(-COLUMN_EDGE - BLEND, -COLUMN_EDGE + BLEND, x);
  const columns = [west, Math.max(0, 1 - west - east), east];
  const south = smooth(-BLEND, BLEND, z); // world z >= 0 is the second row
  const rows = [1 - south, south];
  return [columns[0] * rows[0], columns[1] * rows[0], columns[2] * rows[0], columns[0] * rows[1], columns[1] * rows[1], columns[2] * rows[1]];
}

/** 1 at street level, easing to 0.3 high above the roofs (street layers thin out up there). */
export function streetPresence(y: number): number {
  return 1 - 0.7 * smooth(18, 120, y);
}

/** 0..1 nearness to the harbour water: 1 on the quay and out over the water, 0 more than HARBOUR_RANGE inland. */
export function harbourNear(x: number, z: number): number {
  const reach = Math.max(Math.abs(x), Math.abs(z));
  if (!Number.isFinite(reach)) return 0;
  return 1 - smooth(0, HARBOUR_RANGE, WATER_EDGE - reach);
}

/** How far each happening is heard (metres); the satellite and unknown kinds are silent. */
export function eventRange(kind: string): number {
  switch (kind) {
    case "substation": case "checkpoint": case "protest": return 150;
    case "lanterns": return 200;
    case "drones": return 240;
    case "flare": return 450; // out over the water: heard from the quay and the rim roads
    default: return 0;
  }
}

/** 0..1 nearness to the frame's event site (full inside 30 % of its range), ignoring its envelope. */
function eventNearness(event: AmbienceCityEvent): number {
  const range = eventRange(event.kind);
  if (!(range > 0) || !Number.isFinite(event.distance)) return 0;
  return 1 - smooth(range * 0.3, range, Math.abs(event.distance));
}

/** 0..1 presence of a `kind` of happening for the listener: nearness times its bloom / fade envelope. */
export function eventPresence(frame: AmbienceFrame, kind: string): number {
  const event = frame.event;
  if (!event || event.kind !== kind) return 0;
  return clamp01(event.level) * eventNearness(event);
}

/** 1 while one of the flares is climbing (the first 8 s after each launch), easing in and out. */
export function flareClimb(age: number): number {
  let climb = 0;
  for (const launch of FLARE_LAUNCHES) climb = Math.max(climb, smooth(launch - 0.5, launch + 0.5, age) * (1 - smooth(launch + 6, launch + 10, age)));
  return climb;
}

/** 0..1 how far a distance is through a range (Infinity is out of range, NaN counts as far). */
const through = (distance: number, range: number): number => Number.isNaN(distance) ? 1 : Math.min(1, Math.max(0, distance / range));

/** 0..1 leak of The Static's bass onto the street: full by the door, gone by CLUB_RANGE or above the first floor. */
export function clubLeak(frame: AmbienceFrame): number {
  const distance = frame.club ?? Infinity;
  if (frame.interior || !Number.isFinite(distance)) return 0;
  return (1 - smooth(4, CLUB_RANGE, Math.abs(distance))) * (1 - smooth(6, 14, frame.y));
}

/** Footstep surface: metal on a station platform, wet in the rain outdoors, dry otherwise. */
export type StepSurface = "dry" | "wet" | "metal";
export function stepSurface(frame: AmbienceFrame): StepSurface {
  if (frame.platform) return "metal";
  return frame.rain && !frame.interior ? "wet" : "dry";
}

/** Seconds to the next foghorn after one sounds: never under FOGHORN_GAP, up to three and a half minutes. */
export function foghornGap(random: number): number {
  return FOGHORN_GAP + 120 * clamp01(random);
}

/** Inside, but on a floor open to the sky (a roof bar or plant deck). */
export function ambienceOpenAir(frame: AmbienceFrame): boolean {
  return frame.interior && (frame.openAir ?? (frame.variant === "sky-bar" || frame.variant === "plant-deck"));
}

export function ambienceLevels(frame: AmbienceFrame): AmbienceLevels {
  const w = districtWeights(frame.x, frame.z);
  const street = streetPresence(frame.y);
  const weather = clamp01(frame.weather ?? weatherDrift(frame.time));
  const speed = Math.abs(frame.speed);
  const foundryNear = 1 - smooth(80, 460, Math.hypot(frame.x - FOUNDRY_X, frame.z - FOUNDRY_Z));
  const marketShare = w[MARKET] / Math.max(0.001, w[MARKET] + w[NEON]);
  const trainFar = through(frame.trainDistance, TRAIN_RANGE);
  const train = frame.riding ? 0 : (1 - trainFar) ** 2 * (0.25 + 0.75 * clamp01(frame.trainSpeed / 12));
  // Harbour and wind: exposure is the rim (more up on the Rim Line deck, 40 m) and any great height.
  const sea = harbourNear(frame.x, frame.z), gust = clamp01(frame.gust ?? 0.3), deck = smooth(20, 40, frame.y);
  const exposure = sea * (1 + 0.6 * deck) + 0.3 * smooth(30, 90, frame.y);
  const flare = eventPresence(frame, "flare");
  const inClub = frame.interior && frame.venue === "nightclub", leak = clubLeak(frame);
  const open = ambienceOpenAir(frame) ? 1 : 0;
  return {
    rain: frame.rain ? 0.15 * (0.45 + 0.55 * weather) : 0,
    rainTone: 900 + 2600 * weather,
    hum: 0.03 * street * (1 + 0.5 * w[NEON] + 0.4 * w[FOUNDRY] - 0.5 * w[GARDENS]),
    traffic: 0.05 * street * (1 - 0.6 * w[GARDENS]) * (frame.driving ? 0.5 : 1),
    rumble: 0.09 * foundryNear,
    furnace: 0.045 * w[FOUNDRY] * street,
    buzz: (0.012 * w[NEON] + 0.004 * w[MARKET]) * street,
    voices: (0.045 * w[NEON] + 0.065 * w[MARKET]) * street * (1 - 0.35 * weather),
    voiceTone: 520 + 380 * marketShare,
    voicePulse: 0.3 + 0.5 * marketShare,
    crackle: 0.03 * w[GHOST] * street,
    insects: 0.01 * w[GARDENS] * street * (1 - 0.6 * weather),
    sizzle: 0.016 * w[MARKET] * street,
    water: (0.07 * w[SPILLWAY] + 0.02 * w[GARDENS]) * street,
    carriage: frame.riding ? 0.11 * (0.4 + 0.6 * clamp01(frame.ridingSpeed / 18)) : 0,
    engine: frame.driving ? 0.045 + 0.04 * clamp01(speed / 40) + (frame.boost ? 0.02 : 0) : 0,
    enginePitch: Math.min(230, 38 + speed * 3.2) * (frame.driving && frame.boost ? 1.08 : 1),
    engineTone: 260 + Math.min(40, speed) * 28 + (frame.boost ? 400 : 0),
    boost: frame.driving && frame.boost ? 0.03 : 0,
    train: 0.14 * train,
    trainTone: 250 + 950 * (1 - trainFar),
    // Open-air floors (roof bar, plant deck) let the street back in: brighter, louder, a little wind.
    outdoor: frame.interior ? 0.2 + 0.5 * open : 1,
    muffle: frame.interior ? 650 + 4350 * open : 18000,
    room: frame.interior ? 0.03 * (1 - 0.5 * open) : 0,
    swell: 0.06 * sea * (1 - 0.4 * deck),
    wind: (0.006 + 0.03 * gust) * (0.35 + 0.65 * exposure) + 0.012 * open,
    windTone: 280 + 520 * gust,
    transformer: 0.028 * eventPresence(frame, "substation") * street,
    sparks: 0.02 * eventPresence(frame, "substation") * street,
    drones: 0.02 * eventPresence(frame, "drones"), // up in the sky: not thinned by height
    march: 0.06 * eventPresence(frame, "protest") * street,
    chatter: 0.022 * eventPresence(frame, "checkpoint") * street,
    flareHiss: 0.02 * flare * (0.25 + 0.75 * flareClimb(frame.event?.age ?? 0)),
    club: inClub ? 0.45 : 0.25 * leak,
    clubTone: inClub ? 900 : 150,
    clubBed: inClub ? 0.012 : 0.012 * leak,
    clubSweep: inClub ? 560 : 320,
    clubCrowd: inClub ? 0.1 : 0,
  };
}

/** One-shot rates per second for the district colour (drips, radio chirps, gulls). */
export function ambienceRates(frame: AmbienceFrame): AmbienceRates {
  if (frame.interior) return { drips: 0, chirps: 0, gulls: 0 };
  const w = districtWeights(frame.x, frame.z), street = streetPresence(frame.y);
  const weather = frame.rain ? clamp01(frame.weather ?? weatherDrift(frame.time)) : 0;
  const sea = harbourNear(frame.x, frame.z);
  return {
    drips: (0.9 * w[GARDENS] + 0.25 * weather) * street,
    chirps: (0.35 * w[GHOST] + 0.3 * eventPresence(frame, "checkpoint")) * street, // CorpSec radios key up at the checkpoint
    gulls: (0.07 * w[SPILLWAY] + 0.12 * sea) * street,
  };
}

/** One-shot cues from a happening: a hush as each batch of lanterns lifts, a soft thump at each flare launch.
 *  An event first seen within a second of its start counts from its start; one walked into later does not replay. */
export function eventCues(previous: AmbienceFrame | null, frame: AmbienceFrame): { hush: boolean; thump: boolean } {
  const event = frame.event;
  if (!event || frame.interior || eventNearness(event) < 0.05) return { hush: false, thump: false };
  const last = previous?.event;
  const before = last && last.id === event.id ? last.age : event.age < 1 ? -Infinity : event.age;
  const crossed = (marks: readonly number[]): boolean => marks.some((mark) => before < mark && event.age >= mark);
  return { hush: event.kind === "lanterns" && crossed(LANTERN_RELEASES), thump: event.kind === "flare" && crossed(FLARE_LAUNCHES) };
}

/** Seconds between footsteps at a walking speed, or null when standing (below 0.6 m/s). */
export function stepInterval(speed: number): number | null {
  const s = Math.abs(speed);
  if (!Number.isFinite(s) || s < 0.6) return null;
  return Math.max(0.26, Math.min(0.62, 0.62 - s * 0.05));
}

/** How many Poisson events fall in `dt` seconds at `rate` per second (capped at 3), from one uniform draw. */
export function poissonCount(rate: number, dt: number, random: number): number {
  const mean = Math.max(0, rate) * Math.max(0, dt);
  if (mean <= 0) return 0;
  let p = Math.exp(-mean), cumulative = p, k = 0;
  while (random > cumulative && k < 3) { k += 1; p *= mean / k; cumulative += p; }
  return k;
}

/** The closest street car's track between samples. */
export interface CarTrack { id: number; distance: number; closest: number; passed: boolean }

/**
 * A car "passes" once: the same car came within PASS_RANGE (HEAVY_PASS_RANGE for a bus, truck or tanker) and is now pulling away, fast enough
 * (relative to the listener) to whoosh. Returns the next track and whether to play the whoosh.
 */
export function carPass(track: CarTrack | null, car: AmbienceFrame["car"], listenerSpeed: number): { track: CarTrack | null; pass: boolean } {
  if (!car) return { track: null, pass: false };
  if (!track || track.id !== car.id) return { track: { id: car.id, distance: car.distance, closest: car.distance, passed: false }, pass: false };
  const closest = Math.min(track.closest, car.distance);
  const receding = car.distance > track.distance + 0.05;
  const fast = Math.abs(car.speed) + Math.abs(listenerSpeed) * 0.5 > 5;
  const pass = !track.passed && receding && closest < (car.heavy ? HEAVY_PASS_RANGE : PASS_RANGE) && fast;
  return { track: { id: car.id, distance: car.distance, closest, passed: track.passed || pass }, pass };
}

/** Edge triggers between two samples: lift start / stop dings, door thunks, a brake squeal per approach. */
export function ambienceEdges(previous: AmbienceFrame | null, frame: AmbienceFrame): { ding: boolean; door: boolean; squeal: boolean } {
  if (!previous) return { ding: false, door: false, squeal: false };
  return {
    ding: previous.lift !== frame.lift,
    door: previous.interior !== frame.interior,
    squeal: frame.trainBraking && !previous.trainBraking && frame.trainDistance < TRAIN_RANGE && !frame.riding,
  };
}
