import assert from "node:assert/strict";
import test from "node:test";
import { GOVERNOR, QualityGovernor, renderProfile } from "../src/city/quality-governor.ts";

// Feeds `seconds` of frames at a fixed interval; returns the level changes seen.
function run(governor: QualityGovernor, clock: { now: number }, seconds: number, frameMs: number, cpuMs = 4): number[] {
  const changes: number[] = [];
  for (let t = 0; t < seconds * 1000; t += frameMs) {
    clock.now += frameMs;
    const next = governor.sample(frameMs, cpuMs, clock.now);
    if (next !== null) changes.push(next);
  }
  return changes;
}

test("desktop presets keep their cell sizes; auto adapts cells to orientation and never renders at DPR 3", () => {
  assert.equal(renderProfile("high", 0, false).cell, 8);
  assert.equal(renderProfile("balanced", 3, true).cell, 12);
  assert.equal(renderProfile("low", 0, false).cell, 16);
  const landscape = renderProfile("auto", 0, false), portrait = renderProfile("auto", 0, true);
  assert.ok(landscape.cell >= 8 && portrait.cell >= 8 && portrait.cell <= landscape.cell);
  assert.equal(landscape.maxDensity, 2);
  assert.ok(renderProfile("auto", 3, false).cell > landscape.cell, "the lowest level uses bigger cells");
  assert.deepEqual(renderProfile("auto", 99, false), renderProfile("auto", 3, false), "levels clamp");
});

test("steady 60 fps never changes level; sustained slow frames degrade one level per window", () => {
  const clock = { now: 0 }, governor = new QualityGovernor();
  governor.hold(0);
  assert.deepEqual(run(governor, clock, 30, 16.7), []);
  const changes = run(governor, clock, 3 + GOVERNOR.window + 1, 33.4);
  assert.deepEqual(changes, [1]);
});

test("a failed upgrade locks the level: no oscillation", () => {
  const clock = { now: 0 }, governor = new QualityGovernor();
  governor.hold(0);
  run(governor, clock, 8, 33.4);                       // -> level 1
  assert.equal(governor.level, 1);
  const up = run(governor, clock, GOVERNOR.upgradeAfter + 10, 16.7, 3);
  assert.deepEqual(up, [0], "a clean stretch with CPU headroom climbs back once");
  run(governor, clock, 4, 33.4);                       // level 0 fails again right away
  assert.equal(governor.level, 1);
  assert.equal(governor.best, 1, "level 0 is now off-limits");
  assert.deepEqual(run(governor, clock, 120, 16.7, 2), [], "stays put for good");
});

test("no upgrade without CPU headroom, and stalls (hidden tab, atlas rebuild) are ignored", () => {
  const clock = { now: 0 }, governor = new QualityGovernor();
  governor.hold(0);
  run(governor, clock, 8, 33.4);
  assert.deepEqual(run(governor, clock, 60, 16.7, 12), []);
  assert.equal(governor.sample(900, 3, clock.now + 900), null);
});

test("uneven misses on a high-refresh display (18 ms frames, few over the slow line) still degrade by the mean", () => {
  const clock = { now: 0 }, governor = new QualityGovernor();
  governor.hold(0);
  let changes = 0;
  for (let i = 0; i < 600; i++) { const ms = i % 5 === 0 ? 48 : 18.2; clock.now += ms; if (governor.sample(ms, 14, clock.now) !== null) changes++; }
  assert.ok(changes >= 1 && governor.level >= 1, "mean ~24 ms (< 50 fps) lowers quality");
});
