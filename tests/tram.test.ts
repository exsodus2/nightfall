import assert from "node:assert/strict";
import test from "node:test";
import { carFits, carObstacle } from "../src/city/driving.ts";
import { trafficGreen } from "../src/city/people.ts";
import { CityTraffic, carKind, drivableKind, type Vehicle } from "../src/city/traffic.ts";
import {
  TRAM_COUNT, TRAM_CROSSING_HALF, TRAM_CYCLE, TRAM_DEPART, TRAM_GAUGE, TRAM_HALF_WIDTH, TRAM_LEGS, TRAM_LENGTH, TRAM_LOOP, TRAM_PLATFORM_HALF,
  TRAM_RAIL_CLEAR, TRAM_RUN, TRAM_SECTION_LENGTH, TRAM_STOPS, TRAM_TRACK_X, TramLine, isTramVehicle, takeTramBell, tramArcZ, tramCycleTime, tramScheduleArc,
} from "../src/city/tram.ts";
import { CityWorld } from "../src/city/world.ts";

const run = (line: TramLine, from: number, to: number, dt: number, obstacles: { x: number; z: number; yaw?: number }[] = [], eye?: { x: number; z: number }) => {
  for (let time = from; time <= to + 1e-9; time += dt) line.update(dt, time, obstacles, undefined, eye);
};
/** The ground shader's rail mask (materials.ts): abs(abs(abs(x) - 2.4) - 0.72) is 0 on a rail. */
const railLine = (x: number): number => Math.abs(Math.abs(Math.abs(x) - 2.4) - 0.72);

test("the tracks match the ground shader's rails and every stop sits mid-block on them", () => {
  assert.equal(TRAM_TRACK_X, 2.4);
  for (const side of [-1, 1]) for (const rail of [-1, 1]) assert.ok(railLine(side * (TRAM_TRACK_X + rail * TRAM_GAUGE / 2)) < 1e-9, "rails under the wheels");
  // Keep left: southbound (+z) on the +x track, northbound on the -x track; reversing legs cross over.
  for (const leg of TRAM_LEGS) {
    if (leg.x0 === leg.x1) assert.equal(leg.x0, leg.dir * TRAM_TRACK_X);
    else assert.ok(leg.x0 === -leg.x1 && Math.abs(leg.x0) === TRAM_TRACK_X && leg.c1 - leg.c0 >= 30, "crossovers are gentle");
  }
  // The island platform fits between the two trams' bodies, and each one is clear of both junctions.
  assert.ok(TRAM_PLATFORM_HALF < TRAM_TRACK_X - TRAM_HALF_WIDTH);
  assert.equal(TRAM_STOPS.length, 11);
  for (const stop of TRAM_STOPS) {
    const junction = Math.floor(stop.z / 64) * 64;
    assert.ok(stop.z0 - junction >= TRAM_CROSSING_HALF + 4 && junction + 64 - stop.z1 >= TRAM_CROSSING_HALF + 4, `stop at ${stop.z0}..${stop.z1}`);
    assert.ok(Math.abs(stop.z1 - stop.z0 - TRAM_LENGTH) < 1e-9);
  }
  // Mid-dwell, every tram stands on its rails alongside a platform with its doors open.
  const line = new TramLine(), dwell = TRAM_DEPART - 3 + TRAM_CYCLE * 11;
  run(line, dwell - 2, dwell, 0.25);
  for (const view of line.views()) {
    assert.ok(view.doors > 0.99 && view.speed === 0, `tram ${view.index} doors ${view.doors}`);
    // The doors open towards the island (x = 0), also after a reversal at either end.
    const middle = view.sections[1], rightX = Math.cos(middle.yaw);
    assert.ok(view.doorSide * rightX * Math.sign(middle.x) < 0, `tram ${view.index} opens towards the platform`);
    const z = view.sections.map(s => s.z), low = Math.min(...z) - TRAM_SECTION_LENGTH / 2, high = Math.max(...z) + TRAM_SECTION_LENGTH / 2;
    assert.ok(view.sections.every(s => Math.abs(Math.abs(s.x) - TRAM_TRACK_X) < 1e-9), `tram ${view.index} on its rails`);
    assert.ok(TRAM_STOPS.some(stop => Math.abs(low - stop.z0) < 1e-6 && Math.abs(high - stop.z1) < 1e-6), `tram ${view.index} at ${low}..${high} berths at a platform`);
  }
});

test("the timetable is a function of the shared clock: frame rate and join time do not matter", () => {
  const steady = new TramLine(), late = new TramLine();
  run(steady, 0, 300, 1 / 60);
  run(late, 170, 300, 1 / 13);
  const time = 300 + 1e-9;
  steady.update(1 / 60, time); late.update(1 / 13, time);
  assert.deepEqual(late.arcs(), steady.arcs());
  assert.deepEqual(late.views(), steady.views());
  steady.arcs().forEach((arc, index) => assert.ok(Math.abs(arc - tramScheduleArc(index, time)) < 1e-9));
  assert.equal(tramCycleTime(TRAM_DEPART + TRAM_CYCLE * 5), 0);
  assert.ok(TRAM_RUN < TRAM_CYCLE - 5, "a dwell of several seconds at every stop");
});

test("trams stay more than a tram length apart and cross junctions only outside the cross streets' green", () => {
  const line = new TramLine();
  let checked = 0;
  for (let frame = 0; frame <= (TRAM_LOOP / 128) * TRAM_CYCLE * 10; frame++) {
    const time = frame / 10;
    line.update(0.1, time);
    const views = line.views();
    for (let i = 0; i < views.length; i++) {
      for (const section of views[i].sections) {
        // Junction crossing bands (the east-west carriageways) are tram-free while cross traffic has green.
        const junction = Math.round(section.z / 64) * 64;
        if (Math.abs(junction) <= 704 && Math.abs(section.z - junction) < TRAM_CROSSING_HALF + TRAM_SECTION_LENGTH / 2) assert.ok(!trafficGreen("x", time), `tram ${i} in the junction at z=${junction}, t=${time}`);
        for (let k = i + 1; k < views.length; k++) for (const other of views[k].sections) {
          if (Math.abs(other.x - section.x) < 2 * TRAM_HALF_WIDTH + 0.2) { assert.ok(Math.abs(other.z - section.z) > TRAM_LENGTH, `trams ${i} and ${k} at t=${time}`); checked++; }
        }
      }
    }
  }
  assert.ok(checked > 1000);
  assert.equal(line.views().length, TRAM_COUNT);
});

test("a tram holds for a car on its rails, the one behind holds for it, then both rejoin the timetable", () => {
  const line = new TramLine(), start = TRAM_DEPART + TRAM_CYCLE * 20 - 1;
  run(line, start - 1, start, 0.1);
  // A car broken down across the southbound track, 40 m ahead of a dwelling southbound tram.
  const index = line.views().findIndex(view => view.heading > 0 && view.sections[0].z < 400 && view.sections[0].z > -400);
  assert.ok(index >= 0);
  const front = tramArcZ(line.arcs()[index]), car = { x: TRAM_TRACK_X + 0.5, z: front + 40, yaw: Math.PI / 2 };
  for (let time = start; time < start + 120; time += 0.1) {
    line.update(0.1, time, [car]);
    const z = tramArcZ(line.arcs()[index]);
    assert.ok(car.z - z >= 1.35 + 1.4, `front ${z.toFixed(2)} vs car ${car.z}`);
    const views = line.views();
    for (const a of views) for (const b of views) if (a !== b) for (const s of a.sections) for (const o of b.sections) {
      if (Math.abs(s.x - o.x) < 2 * TRAM_HALF_WIDTH) assert.ok(Math.abs(s.z - o.z) >= TRAM_SECTION_LENGTH, "held trams never run into each other");
    }
  }
  assert.ok(tramScheduleArc(index, start + 120) - line.arcs()[index] > 100, "it was held");
  let rejoined = Infinity;
  for (let time = start + 120; time < start + 900; time += 0.1) {
    line.update(0.1, time);
    if (line.arcs().every((arc, i) => Math.abs(arc - tramScheduleArc(i, time)) < 1e-9)) { rejoined = time; break; }
  }
  assert.ok(rejoined < start + 900, "back on the timetable once the rails are clear");
});

test("cars yield to trams at the avenue crossings, never stand on the rails, and the player's car collides with trams", () => {
  const traffic = new CityTraffic();
  const box = (car: Vehicle) => Math.abs(Math.sin(car.yaw)) > 0.5 ? { hx: 2.9, hz: 1.35 } : { hx: 1.35, hz: 2.9 };
  let crossings = 0;
  const side = new Map<number, number>();
  for (let frame = 0; frame < 10 * 600; frame++) {
    traffic.update(0.1, frame / 10);
    if (frame % 3) continue;
    const vehicles = traffic.nearby(0, 0, 1200), trams = vehicles.filter(v => carKind(v.id) === "tram");
    assert.equal(trams.filter(v => !v.trailing).length, TRAM_COUNT);
    for (const car of vehicles) {
      if (carKind(car.id) === "tram") continue;
      const b = box(car), alongX = Math.abs(Math.sin(car.yaw)) > 0.5;
      for (const tram of trams) assert.ok(Math.abs(tram.x - car.x) >= TRAM_HALF_WIDTH + b.hx || Math.abs(tram.z - car.z) >= 2.9 + b.hz, `car ${car.id} hits tram ${tram.id} at t=${frame / 10}`);
      if (alongX && car.stopped) assert.ok(Math.abs(car.x) >= TRAM_RAIL_CLEAR - 0.6, `car ${car.id} stopped on the rails at x=${car.x.toFixed(2)}`);
      if (alongX && !car.trailing) { const before = side.get(car.id); if (before !== undefined && before * car.x < 0 && Math.abs(car.x) < 4) crossings++; side.set(car.id, car.x); }
    }
  }
  assert.ok(crossings > 100, `${crossings} cars crossed the avenue`);
  // Trams are solid along their whole length (driving.ts obstacles), and can never be taken over.
  const world = new CityWorld(), lead = traffic.nearby(0, 0, 2000).find(isTramVehicle);
  assert.ok(lead && !drivableKind(carKind(lead.id)) && traffic.takeOver(lead.id) === null);
  const middle = lead.tram.sections[1], fx = Math.sin(middle.yaw), fz = -Math.cos(middle.yaw);
  for (let along = -TRAM_LENGTH / 2 + 1; along <= TRAM_LENGTH / 2 - 1; along += 1) {
    const x = middle.x + fx * along, z = middle.z + fz * along;
    assert.equal(carFits(world, { x, z, yaw: middle.yaw + Math.PI / 2 }, traffic.nearby(x, z, 20).map(carObstacle)), false, `a car fits inside the tram ${along} m from its middle`);
  }
});

test("a tram pulling away rings the bell for a listener within 40 m only", () => {
  const near = new TramLine(), far = new TramLine(), start = TRAM_DEPART + TRAM_CYCLE * 30 - 6;
  run(near, start - 1, start, 0.1); run(far, start - 1, start, 0.1);
  const view = near.views()[0], eye = { x: 8, z: view.sections[1].z }, away = { x: 8, z: view.sections[1].z + 300 };
  takeTramBell();
  let rang = false, rangFar = false;
  for (let time = start; time < start + 10; time += 0.1) {
    far.update(0.1, time, [], undefined, away); rangFar ||= takeTramBell();
    near.update(0.1, time, [], undefined, eye); rang ||= takeTramBell();
  }
  assert.ok(rang, "the bell rang as the tram pulled away");
  assert.ok(!rangFar, "no bell 300 m away");
});
