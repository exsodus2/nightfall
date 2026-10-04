import assert from "node:assert/strict";
import { test } from "node:test";
import { CityPopulation } from "../src/city/people.ts";
import { CityWorld } from "../src/city/world.ts";

test("crossing decisions use shared signals rather than each client's ambient clock", () => {
  const world = new CityWorld();
  const first = new CityPopulation(world), later = new CityPopulation(world);
  const eye = { x: 0, z: 0 };
  for (let frame = 0; frame < 900; frame++) {
    const time = frame / 20;
    first.update(0.05, time, time + 2, eye, undefined, time);
    later.update(0.05, time + 1013, time + 2, eye, undefined, time);
  }
  assert.deepEqual(later.nearby(0, 0, 1000), first.nearby(0, 0, 1000));
  assert.deepEqual(later.stats(0, 0), first.stats(0, 0));
});
