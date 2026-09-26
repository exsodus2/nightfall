import assert from "node:assert/strict";
import test from "node:test";
import { VsyncPacer, vsyncsPerFrame } from "../src/city/frame-pacing.ts";

test("vsync divisors keep an even cadence under the cap", () => {
  assert.equal(vsyncsPerFrame(1000 / 60, 100), 1);
  assert.equal(vsyncsPerFrame(1000 / 144, 100), 2); // 72 fps
  assert.equal(vsyncsPerFrame(1000 / 120, 100), 2); // 60 fps
  assert.equal(vsyncsPerFrame(1000 / 240, 100), 3); // 80 fps
  assert.equal(vsyncsPerFrame(1000 / 120, 62), 2);
  assert.equal(vsyncsPerFrame(1000 / 60.5, 60), 1);
  assert.equal(vsyncsPerFrame(0, 60), 1);
});

/** Feeds `count` jittered vsyncs at `hz` and returns the vsync gaps between rendered frames. */
function cadence(hz: number, cap: number, jitter: number, count = 600): number[] {
  const pacer = new VsyncPacer(cap), period = 1000 / hz, gaps: number[] = [];
  let last = -1, seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) {
    // The first 120 vsyncs let the pacer learn the refresh period.
    if (pacer.tick(i * period + (random() - 0.5) * 2 * jitter) && i > 120) { if (last >= 0) gaps.push(i - last); last = i; }
  }
  return gaps;
}

test("144 Hz renders every second vsync, with no uneven gaps despite timestamp jitter", () => {
  const gaps = cadence(144, 100, 0.8);
  assert.ok(gaps.length > 100);
  assert.ok(gaps.every(gap => gap === 2), `gaps ${[...new Set(gaps)]}`);
});

test("120 Hz at a 60 fps budget: every second vsync, never 1-3 pairs", () => {
  const gaps = cadence(120, 100, 1.2);
  assert.ok(gaps.every(gap => gap === 2), `gaps ${[...new Set(gaps)]}`);
});

test("60 Hz renders every vsync", () => {
  const gaps = cadence(60, 100, 1.5);
  assert.ok(gaps.every(gap => gap === 1));
});
