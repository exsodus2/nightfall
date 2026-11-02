/**
 * Reads the city for the ambience: the nearest monorail train and street car to the listener, the
 * running city event, the wind's gust and the distance to a venue's door. Called from the engine's
 * HUD snapshot (about 6 Hz), so it stays short loops over 8 trains, the cars traffic.nearby already
 * filtered, at most two active events and the dozen venues.
 */
import { activeEvents } from "../city/city-events.ts";
import { TRAIN_COUNT, trainAt } from "../city/metro.ts";
import { gustAt } from "../city/weather.ts";
import { TRAIN_RANGE, type AmbienceCityEvent, type AmbienceFrame } from "./ambience-mix.ts";

/** The running district happening nearest the listener (the satellite has no sound), or null. Pass
 *  the same clock the events are drawn with (the shared world time in multiplayer, else scene time). */
export function nearestEvent(time: number, x: number, z: number): AmbienceCityEvent | null {
  let best: AmbienceCityEvent | null = null;
  for (const event of activeEvents(time)) {
    if (event.kind === "satellite") continue;
    const distance = Math.hypot(event.x - x, event.z - z);
    if (!best || distance < best.distance) best = { id: event.id, kind: event.kind, distance, age: event.age, level: event.level };
  }
  return best;
}

/** 0..1 wind gust at scene time (weather.ts), for the wind layer. */
export function windGust(time: number): number {
  return Number.isFinite(time) ? gustAt(time) : 0;
}

/** Metres to the nearest street door of a venue of `kind` (interiors.ts places), Infinity when there is none. */
export function venueDistance(places: readonly { kind: string; entrance: { x: number; z: number } }[], kind: string, x: number, z: number): number {
  let best = Infinity;
  for (const place of places) if (place.kind === kind) best = Math.min(best, Math.hypot(place.entrance.x - x, place.entrance.z - z));
  return best;
}

/** Kinds whose pass is a heavy rumble (traffic.ts longKind). */
const HEAVY = new Set(["bus", "truck", "tanker"]);

export interface NearestTrain { distance: number; speed: number; braking: boolean }

/** The closest train (3D, metres) other than `ridden`; braking means it is slowing into a station. */
export function nearestTrain(metroTime: number, x: number, y: number, z: number, ridden: number | null = null): NearestTrain {
  let best: NearestTrain = { distance: Infinity, speed: 0, braking: false };
  for (let id = 0; id < TRAIN_COUNT; id++) {
    if (id === ridden) continue;
    const train = trainAt(metroTime, id);
    const distance = Math.hypot(train.x - x, train.floor + 2 - y, train.z - z);
    if (distance < best.distance) best = { distance, speed: train.speed, braking: train.station === null && train.remaining < 6 && train.speed > 1 && distance < TRAIN_RANGE };
  }
  return best;
}

/** The closest car from a nearby list, if any; `heavy` when it is a bus, truck or tanker. traffic.nearby's
 *  Vehicle type does not declare `kind`, but the lane cars it returns carry it, so it is read when present. */
export function nearestCar(cars: readonly { id: number; x: number; z: number; speed: number; trailing?: boolean; kind?: string }[], x: number, z: number): AmbienceFrame["car"] {
  let best: AmbienceFrame["car"] = null;
  for (const car of cars) {
    if (car.trailing) continue; // a long vehicle's rear footprint shares its front's pass: its negative id would reset the pass tracking
    const distance = Math.hypot(car.x - x, car.z - z);
    if (!best || distance < best.distance) best = { id: car.id, distance, speed: car.speed, heavy: car.kind !== undefined && HEAVY.has(car.kind) };
  }
  return best;
}
