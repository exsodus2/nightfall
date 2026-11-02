import assert from "node:assert/strict";
import test from "node:test";
import { BUS_STOPS, ParkedCars, WRECK_SPOTS, carFits } from "../src/city/driving.ts";
import { CityTraffic, TRAILING, carKind, drivableKind, longKind, twoWheeler, type CarKind, type Vehicle } from "../src/city/traffic.ts";
import { CityWorld, districtAt } from "../src/city/world.ts";

const world = new CityWorld();
const everyone = (traffic: CityTraffic): Vehicle[] => traffic.nearby(0, 0, 5000);
const kindsIn = (cars: readonly Vehicle[]): Map<CarKind, Vehicle[]> => {
  const kinds = new Map<CarKind, Vehicle[]>();
  for (const car of cars) if (!car.trailing) kinds.set(carKind(car.id), [...(kinds.get(carKind(car.id)) ?? []), car]);
  return kinds;
};

test("traffic mixes buses, lorries, bikes, district specials and edge wrecks; ids keep their kind", () => {
  const traffic = new CityTraffic(), cars = everyone(traffic), kinds = kindsIn(cars);
  for (const kind of ["sedan", "cab", "van", "pickup", "coupe", "police", "bus", "truck", "tanker", "moto", "scooter", "tuktuk", "corpsec", "ambulance", "sweeper", "wreck"] as const) assert.ok((kinds.get(kind)?.length ?? 0) > 0, `some ${kind}`);
  // District specials start in their own district.
  for (const [kind, district] of [["tuktuk", "Silk Market"], ["corpsec", "Neon Ward"], ["sweeper", "The Spillway"]] as const) for (const car of kinds.get(kind) ?? []) assert.equal(districtAt(car.x, car.z).name, district, `${kind} ${car.id}`);
  // Long vehicles add exactly one trailing footprint, 5.8 m behind, with a distinct id.
  const ids = new Set<number>();
  for (const car of cars) { assert.ok(!ids.has(car.id), `duplicate id ${car.id}`); ids.add(car.id); }
  for (const car of cars.filter(c => !c.trailing && longKind(carKind(c.id)))) {
    const rear = cars.find(c => c.id === -car.id);
    assert.ok(rear?.trailing, `rear footprint for ${car.id}`);
    assert.ok(Math.abs(Math.hypot(rear.x - car.x, rear.z - car.z) - TRAILING) < 1e-6);
  }
  // Only car-bodied kinds can be taken over; a bus refuses.
  assert.ok(!drivableKind("bus") && !drivableKind("moto") && !drivableKind("tuktuk") && !drivableKind("wreck") && drivableKind("ambulance") && drivableKind("corpsec"));
  const bus = kinds.get("bus")?.[0];
  assert.ok(bus); assert.equal(traffic.takeOver(bus.id), null);
});

test("wrecks and bus berths keep their kerbs clear of parked cars and fit the street", () => {
  const parked = new ParkedCars(world).all();
  for (const wreck of WRECK_SPOTS) {
    assert.ok(carFits(world, wreck), `wreck at ${wreck.x},${wreck.z} fits`);
    assert.ok(parked.every(car => Math.hypot(car.x - wreck.x, car.z - wreck.z) > 6), "no parked car on a wreck");
  }
  assert.ok(BUS_STOPS.length >= 30, `${BUS_STOPS.length} berths`);
  for (const stop of BUS_STOPS) {
    assert.ok(world.canOccupy(stop.x, stop.z), `shelter at ${stop.x},${stop.z} on open pavement`);
    const mid = stop.block * 64 + 32, across = stop.street * 64;
    for (const car of parked) {
      const along = stop.axis === "x" ? car.x : car.z, lateral = stop.axis === "x" ? car.z : car.x;
      assert.ok(!(Math.abs(along - mid) < 18 && Math.sign(lateral - across) === stop.side && Math.abs(lateral - across) < 8), `parked car ${car.id} in the berth at ${stop.x},${stop.z}`);
    }
  }
});

test("buses dwell at berths with doors open, bikes filter and overtake, cars indicate and turn, local kinds mostly stay home", () => {
  const traffic = new CityTraffic(), start = everyone(traffic);
  const home = new Map(start.map(car => [car.id, districtAt(car.x, car.z).id]));
  const axisOf = (car: Vehicle) => Math.abs(Math.sin(car.yaw)) > 0.5;
  const startAxis = new Map(start.map(car => [car.id, axisOf(car)]));
  const doors = new Set<number>(), filtered = new Set<number>(), turned = new Set<number>(), indicated = new Set<number>();
  for (let frame = 0; frame < 3600; frame++) {
    traffic.update(1 / 20, frame / 20);
    for (const car of everyone(traffic)) {
      if (car.signal === 1) indicated.add(car.id);
      if (frame % 10) continue;
      if (car.doors) { doors.add(car.id); assert.ok(car.speed < 0.7 && carKind(car.id) === "bus"); }
      if (twoWheeler(carKind(car.id)) && Math.abs((axisOf(car) ? car.z : car.x) - Math.round((axisOf(car) ? car.z : car.x) / 64) * 64) < 0.5) filtered.add(car.id);
      if (!car.trailing && startAxis.has(car.id) && startAxis.get(car.id) !== axisOf(car) && Math.abs(Math.sin(2 * car.yaw)) < 1e-6) { turned.add(car.id); assert.ok(indicated.has(car.id), `car ${car.id} turned without indicating`); }
    }
  }
  assert.ok(doors.size >= 10, `${doors.size} buses served a stop`);
  assert.ok(filtered.size >= 10, `${filtered.size} bikes filtered on the centre line`);
  assert.ok(turned.size >= 100, `${turned.size} cars turned`);
  const locals = everyone(traffic).filter(car => !car.trailing && ["tuktuk", "corpsec", "sweeper"].includes(carKind(car.id)));
  const inside = locals.filter(car => districtAt(car.x, car.z).id === home.get(car.id)).length;
  assert.ok(inside >= locals.length * 0.55, `${inside} of ${locals.length} district specials at home`);
});

test("breakdowns put hazards on mid-block, never in the first minute, and clear again", () => {
  const traffic = new CityTraffic();
  let hazards = 0, first = Infinity;
  for (let frame = 0; frame < 600 * 10; frame++) {
    const time = frame / 10;
    traffic.update(0.1, time);
    if (frame % 20) continue;
    const stalled = everyone(traffic).filter(car => car.signal === 3);
    if (stalled.length) { first = Math.min(first, time); hazards = Math.max(hazards, stalled.length); }
    for (const car of stalled) assert.ok(drivableKind(carKind(car.id)) && !car.waiting);
  }
  assert.ok(first >= 60 && hazards > 0, `hazards from ${first}s, at most ${hazards}`);
});
