import { trafficGreen } from "./people.ts";
import { randomFor } from "./world.ts";

export interface Vehicle { id: number; x: number; z: number; yaw: number; speed: number; waiting: boolean }
interface Driver extends Vehicle { along: number; cruise: number }
interface Lane { axis: "x" | "z"; street: number; direction: number; cars: Driver[] }
const LENGTH = 1472;
const wrap = (n: number, length: number): number => ((n % length) + length) % length;
/** Where a car waits at a red: its centre this far before the cross street's centre line, so the
 * nose stops behind the painted crossing (9.5-13 m out; 19-26 m across the double-width avenue).
 * Nearer, stopped cars sat on the pedestrians' corner crossing and poked into the avenue's lanes. */
export const STOP_LINE = 16.5, AVENUE_STOP_LINE = 29.5;
/** Distance to the next stop point ahead. Past one, the car is committed to that intersection. */
export function stopDistance(axis: "x" | "z", direction: number, along: number): number {
  const offset = (distance: number) => axis === "x" && Math.round((along + distance * direction) / 64) === 0 ? AVENUE_STOP_LINE : STOP_LINE;
  const ahead = wrap(-along * direction, 64), first = ahead - offset(ahead);
  return first >= 0 ? first : ahead + 64 - offset(ahead + 64);
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
  constructor() {
    let id = 0;
    for (const axis of ["x", "z"] as const) for (let street = -11; street <= 11; street++) for (const direction of [-1, 1]) {
      const cars: Driver[] = [];
      for (let i = 0; i < 16; i++) {
        const along = spawnAlong(axis, direction, wrap(i * LENGTH / 16 + street * 23 + (axis === "x" ? 29 : 0), LENGTH) - LENGTH / 2);
        const lane = laneLine(axis, street, direction);
        cars.push({ id, along, x: axis === "x" ? along : lane, z: axis === "z" ? along : lane, yaw: axis === "x" ? direction * Math.PI / 2 : direction < 0 ? 0 : Math.PI, speed: 7, cruise: 9 + randomFor(id++, 57) * 6, waiting: false });
      }
      this.lanes.push({ axis, street, direction, cars });
    }
  }
  /** `blockers` are player cars (driven or left in a lane): traffic queues behind them too. */
  update(dt: number, time: number, blockers: readonly { x: number; z: number }[] = []): void {
    for (const lane of this.lanes) {
      const line = laneLine(lane.axis, lane.street, lane.direction);
      const inLane = blockers.filter(b => Math.abs((lane.axis === "x" ? b.z : b.x) - line) < 2.6).map(b => lane.axis === "x" ? b.x : b.z);
      for (let i = 0; i < lane.cars.length; i++) {
        const car = lane.cars[i], ahead = lane.cars[wrap(i + lane.direction, lane.cars.length)];
        let gap = wrap((ahead.along - car.along) * lane.direction, LENGTH) - 7.5;
        for (const along of inLane) { const d = (along - car.along) * lane.direction; if (d > -2 && d < 80) gap = Math.min(gap, d - 6.5); }
        const stop = stopDistance(lane.axis, lane.direction, car.along);
        let target = Math.min(car.cruise, Math.sqrt(Math.max(0, gap - 1) * 5));
        if (!trafficGreen(lane.axis, time)) target = Math.min(target, Math.sqrt(Math.max(0, stop - 0.35) * 6));
        car.speed += Math.max(-8 * dt, Math.min(3.5 * dt, target - car.speed));
        const clearance = trafficGreen(lane.axis, time) ? gap : Math.min(gap, stop - 0.35);
        const step = Math.min(Math.max(0, clearance), Math.max(0, car.speed) * dt);
        if (step < 0.001) car.speed = 0;
        car.along = wrap(car.along + step * lane.direction + LENGTH / 2, LENGTH) - LENGTH / 2;
        if (lane.axis === "x") car.x = car.along; else car.z = car.along;
        car.waiting = car.speed < 0.3;
      }
    }
  }
  /** The player takes over a stopped car: it leaves its lane for good (driving.ts owns it). */
  takeOver(id: number): Vehicle | null {
    for (const lane of this.lanes) {
      const index = lane.cars.findIndex(car => car.id === id);
      if (index < 0 || lane.cars.length < 3) continue;
      const [car] = lane.cars.splice(index, 1);
      return { id: car.id, x: car.x, z: car.z, yaw: car.yaw, speed: car.speed, waiting: car.waiting };
    }
    return null;
  }
  nearby(x: number, z: number, range: number): Vehicle[] {
    const cars: Vehicle[] = [];
    for (const lane of this.lanes) for (const car of lane.cars) if ((car.x - x) ** 2 + (car.z - z) ** 2 < range * range) cars.push(car);
    return cars;
  }
}
