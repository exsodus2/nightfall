import assert from "node:assert/strict";
import test from "node:test";
import { VisibilityCache, nearestCars } from "../src/city/frame-cache.ts";

// A deterministic stream of awkward keys: repeated values, integers, fractions, negatives, -0.
function keys(count: number, seed: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let s = seed;
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let i = 0; i < count; i++) {
    const pick = (scale: number) => { const r = next(); return r < 0.1 ? 0 : r < 0.15 ? -0 : r < 0.4 ? Math.round(r * scale) : (r - 0.5) * scale; };
    out.push([pick(400), pick(6), pick(400), next() < 0.6 ? 0 : pick(8)]);
  }
  return out;
}

test("perf: the visibility cache answers exactly like the string-keyed Map it replaced", () => {
  const cache = new VisibilityCache(16);
  for (let frame = 0; frame < 4; frame++) {
    cache.clear();
    const reference = new Map<string, boolean>();
    for (const [x, y, z, r] of keys(3000, 17 + frame)) {
      const key = `${x},${y},${z},${r}`, expected = reference.get(key);
      assert.equal(cache.get(x, y, z, r), expected, `lookup ${key} on frame ${frame}`);
      if (expected === undefined) {
        const visible = ((x * 7 + z * 3 + y + r) & 1) === 0;
        reference.set(key, visible); cache.set(x, y, z, r, visible);
      }
    }
    assert.equal(cache.count, reference.size, "one entry per distinct key (and -0 is 0)");
  }
});

test("perf: clearing forgets every answer", () => {
  const cache = new VisibilityCache();
  cache.set(1, 2, 3, 0, true); cache.set(-0, 0, 0, 0, false);
  assert.equal(cache.get(1, 2, 3, 0), true);
  assert.equal(cache.get(0, 0, 0, 0), false, "-0 and 0 are the same query");
  cache.clear();
  assert.equal(cache.get(1, 2, 3, 0), undefined);
  assert.equal(cache.count, 0);
});

test("perf: nearestCars picks what a stable sort of every car by distance picks", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    let s = seed;
    const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    // Cars on a coarse grid, so equal distances (ties) are common.
    const cars = Array.from({ length: 60 + seed * 20 }, (_, i) => ({ x: Math.round((next() - 0.5) * 20) * 8, z: Math.round((next() - 0.5) * 20) * 8, yaw: i }));
    for (const count of [0, 1, 12, 500]) {
      const expected = cars.map(car => ({ x: car.x, z: car.z, yaw: car.yaw, distance: Math.hypot(car.x, car.z) }))
        .sort((a, b) => a.distance - b.distance).slice(0, count).map(({ x, z, yaw }) => ({ x, z, yaw }));
      const out: { x: number; z: number; yaw: number; intensity: number }[] = [];
      nearestCars(cars, 0, 0, count, out);
      assert.deepEqual(out.map(({ x, z, yaw }) => ({ x, z, yaw })), expected, `seed ${seed}, ${count} slots`);
      // The farthest slots fade toward the first excluded car, so a car entering or leaving the last
      // slot never pops its light pool: intensities lie in [0, 1] and never rise with distance.
      for (let i = 0; i < out.length; i++) {
        assert.ok(out[i].intensity >= 0 && out[i].intensity <= 1, `intensity ${out[i].intensity}`);
        if (i > 0) assert.ok(out[i].intensity <= out[i - 1].intensity + 1e-9, "fades with distance");
      }
      // A slot fades only as the first excluded car comes within a quarter of its distance (no pop either way).
      if (count > 0 && cars.length > count && out.length === count) {
        const sorted = cars.map(car => Math.hypot(car.x, car.z)).sort((a, b) => a - b), last = sorted[count - 1], nextOut = sorted[count];
        if (nextOut - last < Math.max(8, nextOut * 0.25) * 0.5) assert.ok(out[count - 1].intensity < 1, "the last slot fades as the next car closes in");
      }
    }
  }
});
