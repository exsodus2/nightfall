import assert from "node:assert/strict";
import test from "node:test";
import { AVENUE_STOP_LINE, CityTraffic, STOP_LINE, stopDistance } from "../src/city/traffic.ts";
import { CityPopulation } from "../src/city/people.ts";
import { ROAD_AWARENESS_RADIUS } from "../src/city/road-awareness.ts";
import { CityWorld } from "../src/city/world.ts";

const wrap = (n: number, length: number): number => ((n % length) + length) % length;
// The closure-based version stopDistance replaced (traffic.ts).
function referenceStopDistance(axis: "x" | "z", direction: number, along: number): number {
  const offset = (distance: number) => axis === "x" && Math.round((along + distance * direction) / 64) === 0 ? AVENUE_STOP_LINE : STOP_LINE;
  const ahead = wrap(-along * direction, 64), first = ahead - offset(ahead);
  return first >= 0 ? first : ahead + 64 - offset(ahead + 64);
}

test("perf: stopDistance without its per-call closure is unchanged", () => {
  for (const axis of ["x", "z"] as const) for (const direction of [-1, 1]) {
    for (let along = -736; along <= 736; along += 0.37) assert.equal(stopDistance(axis, direction, along), referenceStopDistance(axis, direction, along), `${axis} ${direction} ${along}`);
  }
});

test("perf: handing traffic only the residents within the road-awareness radius changes nothing", () => {
  const world = new CityWorld();
  const population = new CityPopulation(world), all = new CityTraffic(), filtered = new CityTraffic();
  const eye = { x: 12, z: 70 };
  let time = 30, crossings = 0;
  for (let frame = 0; frame < 240; frame++) {
    const dt = 1 / 60; time += dt;
    population.update(dt, time, time, eye, { players: [], rain: true });
    const near = population.walkers.filter(walker => (walker.x - eye.x) ** 2 + (walker.z - eye.z) ** 2 <= ROAD_AWARENESS_RADIUS ** 2);
    crossings += near.filter(walker => walker.path[walker.next]?.road).length;
    all.update(dt, time, [], { eye, players: [], residents: population.walkers });
    filtered.update(dt, time, [], { eye, players: [], residents: near });
  }
  assert.ok(crossings > 0, "residents crossed the road near the eye during the run");
  assert.ok(population.walkers.length > 1000);
  assert.deepEqual(filtered.nearby(0, 0, 3000), all.nearby(0, 0, 3000));
});
