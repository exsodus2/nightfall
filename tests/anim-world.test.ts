import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { advanceJourney, doorReveal, easeSlide, journeyLookHeading, RIDE_TURN_ACCEL, RIDE_TURN_RATE, stepRideTurn, WALK_HEIGHT, type Journey, type RideTurn, type Waypoint } from "../src/city/locomotion.ts";
import { ratScale } from "../src/city/street-life.ts";

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const lengthOf = (points: readonly Waypoint[]): number => points.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y, p.z - points[i - 1].z) : 0, 0);
const journeyOf = (mode: Journey["mode"], points: Waypoint[]): Journey => ({ mode, destination: "test", points, segment: 1, travelled: 0, length: lengthOf(points), speed: 0 });

/** Rides a journey with the engine's camera logic; checks every step against the comfort caps. */
function ride(journey: Journey, startHeading: number, frame: (step: number) => number): { turn: RideTurn; peak: number } {
  const position = { ...journey.points[0] };
  const turn: RideTurn = { heading: startHeading, rate: 0, target: startHeading };
  let peak = 0;
  for (let step = 0; step < 20000; step++) {
    const dt = frame(step);
    const done = journey.segment >= journey.points.length || advanceJourney(journey, position, dt).done;
    const before = turn.rate;
    const delta = stepRideTurn(turn, done ? null : journeyLookHeading(journey, position), dt);
    const cap = RIDE_TURN_RATE * Math.min(dt, 0.1);
    assert.ok(Math.abs(delta) <= cap + 1e-9, `step ${step}: turned ${delta.toFixed(4)} rad in ${dt.toFixed(3)} s (cap ${cap.toFixed(4)})`);
    // Ease-in/out: the turn rate itself only changes gradually (the final settle is a tiny sliver).
    assert.ok(Math.abs(turn.rate - before) <= 2 * RIDE_TURN_ACCEL * Math.min(dt, 0.1) + 1e-9, `step ${step}: rate jumped ${before.toFixed(3)} -> ${turn.rate.toFixed(3)}`);
    peak = Math.max(peak, Math.abs(delta) / Math.max(dt, 1e-9));
    if (done && Math.abs(turn.rate) < 1e-9 && Math.abs(wrapAngle(turn.target - turn.heading)) < 1e-6) break;
  }
  return { turn, peak };
}

test("taxi ride heading turns corners at a capped, eased rate and ends along the route", () => {
  const y = WALK_HEIGHT;
  const journey = journeyOf("taxi", [{ x: 0, y, z: 0 }, { x: 0, y, z: -120 }, { x: 120, y, z: -120 }, { x: 120, y, z: 40 }, { x: 60, y, z: 40 }]);
  // Start looking backwards: even the opening turn may not whip round.
  const { turn, peak } = ride(journey, Math.PI, () => 1 / 60);
  assert.ok(peak <= RIDE_TURN_RATE + 1e-6, `peak ${(peak * 180 / Math.PI).toFixed(1)} deg/s`);
  assert.ok(peak > RIDE_TURN_RATE * 0.5, "the camera does follow the route");
  const last = Math.atan2(60 - 120, -(40 - 40));
  assert.ok(Math.abs(wrapAngle(turn.heading - last)) < 0.01, `ends facing ${turn.heading.toFixed(3)}, route ${last.toFixed(3)}`);
});

test("ride heading stays capped with uneven frames, hitches and high refresh rates", () => {
  const y = WALK_HEIGHT;
  for (const frame of [(s: number) => s % 7 === 3 ? 0.25 : 1 / 144, (s: number) => (s % 2 ? 1 / 30 : 1 / 90), () => 1 / 240]) {
    const journey = journeyOf("taxi", [{ x: 0, y, z: 0 }, { x: 0, y, z: -64 }, { x: -64, y, z: -64 }, { x: -64, y, z: -128 }, { x: 0, y, z: -128 }]);
    ride(journey, 0, frame);
  }
});

test("sky taxi turns toward its flight line during the climb, within the cap", () => {
  const start = { x: 0, y: 40, z: 0 }, end = { x: -500, y: WALK_HEIGHT, z: 300 };
  const journey = journeyOf("sky", [start, { ...start, y: 230 }, { ...end, y: 230 }, end]);
  const cruise = Math.atan2(end.x - start.x, -(end.z - start.z));
  const look = journeyLookHeading(journey, { ...start });
  assert.ok(look !== null && Math.abs(wrapAngle(look - cruise)) < 1e-9, "a vertical climb already looks along the coming flight line");
  const { turn } = ride(journey, cruise + Math.PI, () => 1 / 60);
  assert.ok(Math.abs(wrapAngle(turn.heading - cruise)) < 0.01, "the landing keeps the flight heading (no turn on the vertical descent)");
});

test("look-ahead blends into the next street only over the last metres of a segment", () => {
  const y = WALK_HEIGHT;
  const journey = journeyOf("taxi", [{ x: 0, y, z: 0 }, { x: 0, y, z: -100 }, { x: 100, y, z: -100 }]);
  assert.equal(journeyLookHeading(journey, { x: 0, y, z: -50 }), 0);
  const mid = journeyLookHeading(journey, { x: 0, y, z: -92.5 }) ?? NaN;
  assert.ok(mid > 0.1 && mid < Math.PI / 2 - 0.1, `half-way into the blend: ${mid}`);
  assert.ok(Math.abs((journeyLookHeading(journey, { x: 0, y, z: -99.999 }) ?? NaN) - Math.PI / 2) < 1e-3);
});

test("door and gate easing is monotonic, starts and stops at rest and reaches 0 and 1", () => {
  assert.equal(easeSlide(0), 0);
  assert.equal(easeSlide(1), 1);
  assert.equal(easeSlide(-2), 0);
  assert.equal(easeSlide(3), 1);
  assert.equal(easeSlide(Number.NaN), 0);
  let previous = 0;
  for (let i = 1; i <= 1000; i++) {
    const value = easeSlide(i / 1000);
    assert.ok(value >= previous, `not monotonic at ${i / 1000}`);
    previous = value;
  }
  assert.ok(easeSlide(0.02) < 0.002 && easeSlide(0.98) > 0.998, "no hard start or stop");
  // The interior exit fade: near-dark to full, monotonic.
  assert.ok(doorReveal(0) <= 0.1 && doorReveal(1) === 1);
  for (let i = 1; i <= 100; i++) assert.ok(doorReveal(i / 100) >= doorReveal((i - 1) / 100));
});

test("rats shrink into drains at the ends of their run and the alley crossing", () => {
  for (const run of [0, 22, 44]) assert.ok(ratScale(run) < 1e-9, `visible at ${run}`);
  assert.equal(ratScale(11), 1);
  assert.equal(ratScale(33), 1);
  for (let run = 0.01; run <= 44; run += 0.01) assert.ok(Math.abs(ratScale(run) - ratScale(run - 0.01)) < 0.02, `size jumps at ${run.toFixed(2)} m`);
});

test("CSS: no stepped blinks; looping animations stay at or under 0.4 Hz; reduced motion honoured", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(file => file.endsWith(".css"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const css = readFileSync(join(root, file), "utf8");
    for (const match of css.matchAll(/animation\s*:\s*([^;}]+)/g)) {
      const value = match[1];
      for (const part of value.split(/,(?![^(]*\))/)) { // commas between animations, not inside cubic-bezier()
        const seconds = /(?:^|\s)(\d*\.?\d+)(ms|s)\b/.exec(part.trim());
        const duration = seconds ? Number(seconds[1]) / (seconds[2] === "ms" ? 1000 : 1) : 0;
        if (/steps\(/.test(part)) assert.ok(duration >= 2.5, `${file}: stepped animation "${part.trim()}" above 0.4 Hz`);
        if (/\binfinite\b/.test(part)) assert.ok(duration >= 2.5, `${file}: looping animation "${part.trim()}" above 0.4 Hz`);
      }
    }
  }
  assert.match(readFileSync(join(root, "app", "globals.css"), "utf8"), /@media \(prefers-reduced-motion: reduce\)[^}]*animation: none !important/);
});
