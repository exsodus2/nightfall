import assert from "node:assert/strict";
import test from "node:test";
import { SIGNAL_RATE, SKY_WRAP_FADE, signalGain, skyLaneShift, wrapFade } from "../src/city/activity.ts";
import {
  BUS_DOOR_TIME, BUS_PULL_CREEP, BUS_PULL_TRAVEL, CityTraffic, LEAN_MAX, TRAFFIC_ACCEL, TRAFFIC_JERK,
  busDoorOpen, carKind, easeSpeed, smoothstep01, twoWheeler,
} from "../src/city/traffic.ts";
import { TRAM_ACCEL, TRAM_LEG, TRAM_RUN, tramLegDistance, tramLegSpeed } from "../src/city/tram.ts";
import { BOARD_GLIDE, BOARD_RATE, boardEdge } from "../src/city/vehicle-kit.ts";

/** Heading off the nearest lane axis (radians). */
const offSquare = (yaw: number): number => Math.abs(yaw - Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2));

test("bus doors open and close on an eased, monotonic curve from the dwell timer", () => {
  const total = 9, dt = 1 / 120;
  let previous = 0, peak = 0;
  for (let elapsed = dt; elapsed <= total + 1e-9; elapsed += dt) {
    const door = busDoorOpen(total - elapsed, total);
    assert.ok(door >= 0 && door <= 1);
    // Opening never closes again, closing never reopens, and no frame jumps (raised cosine slope cap).
    if (elapsed <= total / 2) assert.ok(door >= previous - 1e-12, `opening at ${elapsed.toFixed(3)}`);
    else assert.ok(door <= previous + 1e-12, `closing at ${elapsed.toFixed(3)}`);
    assert.ok(Math.abs(door - previous) <= (Math.PI / 2) * dt / BUS_DOOR_TIME + 1e-9, "no step");
    peak = Math.max(peak, door);
    previous = door;
  }
  assert.equal(peak, 1);
  // Eased: slower than linear at the very start and end, fully open well inside the dwell.
  assert.ok(busDoorOpen(total - 0.08, total) < 0.08 / BUS_DOOR_TIME);
  assert.ok(busDoorOpen(0.08, total) < 0.08 / BUS_DOOR_TIME);
  assert.equal(busDoorOpen(total / 2, total), 1);
  assert.equal(busDoorOpen(0, total), 0);
});

test("lateral moves smoothstep: buses steer into the kerb, bikes onto the centre line, leaning a few degrees", () => {
  assert.equal(smoothstep01(0), 0); assert.equal(smoothstep01(1), 1); assert.equal(smoothstep01(0.5), 0.5);
  assert.ok(smoothstep01(0.01) < 0.001 && 1 - smoothstep01(0.99) < 0.001, "zero slope at both ends");
  const traffic = new CityTraffic(), span = 1 / 20;
  const before = new Map<number, { x: number; z: number; yaw: number; speed: number }>();
  let berthed = 0, leaned = 0;
  for (let frame = 0; frame < 1600; frame++) {
    const cars = traffic.nearby(0, 0, 5000).filter(car => !car.trailing);
    before.clear();
    for (const car of cars) before.set(car.id, { x: car.x, z: car.z, yaw: car.yaw, speed: car.speed });
    traffic.update(span, frame * span);
    for (const car of traffic.nearby(0, 0, 5000)) {
      const kind = carKind(car.id), was = before.get(car.id);
      if (car.trailing || !was || (kind !== "bus" && !twoWheeler(kind))) continue;
      if (kind !== "bus" && car.signal === 1) continue; // a bike about to turn, or on its turn arc
      const alongX = Math.abs(Math.sin(car.yaw)) > 0.5;
      const along = Math.abs(alongX ? car.x - was.x : car.z - was.z), lateral = Math.abs(alongX ? car.z - was.z : car.x - was.x);
      if (along > 50) continue; // wrapped at the city edge
      if (offSquare(car.yaw) > 0.3) continue; // on a turn arc
      assert.ok(offSquare(car.yaw) <= LEAN_MAX + 1e-9, `${kind} ${car.id} leans ${offSquare(car.yaw)}`);
      if (offSquare(car.yaw) > 0.01) leaned++;
      if (kind === "bus") {
        // Peak smoothstep slope 1.5 over BUS_PULL_TRAVEL metres of travel (creeping when held).
        const travel = Math.max(BUS_PULL_CREEP, Math.abs(was.speed)) * span;
        assert.ok(lateral <= 1.1 * 1.5 * travel / BUS_PULL_TRAVEL + 1e-9, `bus ${car.id} slid ${lateral.toFixed(3)} m sideways`);
        if (car.doors) berthed++;
      }
    }
  }
  assert.ok(berthed > 0, "a bus berthed");
  assert.ok(leaned > 0, "something leaned into a lateral move");
});

test("indicators and hazards swell at 0.4 Hz or slower, softly", () => {
  assert.ok(SIGNAL_RATE <= 0.4);
  const dt = 1 / 240;
  let low = Infinity, high = -Infinity, rises = 0, previous = signalGain(0, 3);
  for (let time = dt; time <= 20; time += dt) {
    const gain = signalGain(time, 3);
    low = Math.min(low, gain); high = Math.max(high, gain);
    if (previous < 0.85 && gain >= 0.85) rises++;
    assert.ok(Math.abs(gain - previous) <= 0.3 * 2 * Math.PI * SIGNAL_RATE * dt + 1e-9, "a smooth raised cosine");
    previous = gain;
  }
  assert.ok(low >= 0.55 - 1e-9 && high <= 1.15 + 1e-9, `${low}..${high}`);
  assert.ok(rises <= 20 * 0.4 + 1, `${rises} swells in 20 s`);
});

test("sky craft fade out before their lane wraps and in after it; lanes wrap on different lines", () => {
  const length = 1500;
  assert.equal(wrapFade(0, length), 0);
  assert.ok(wrapFade(length - 1e-6, length) < 1e-6);
  assert.equal(wrapFade(SKY_WRAP_FADE, length), 1);
  assert.equal(wrapFade(length / 2, length), 1);
  assert.ok(Math.abs(wrapFade(SKY_WRAP_FADE / 2, length) - 0.5) < 1e-9);
  let previous = 0;
  for (let u = 0; u <= SKY_WRAP_FADE; u += 0.5) { const f = wrapFade(u, length); assert.ok(f >= previous - 1e-12); previous = f; }
  for (let u = length - SKY_WRAP_FADE; u < length; u += 0.5) { const f = wrapFade(u, length); assert.ok(f <= previous + 1e-12); previous = f; }
  const shifts = Array.from({ length: 12 }, (_, lane) => skyLaneShift(lane));
  assert.ok(shifts.every(s => Math.abs(s) <= 120));
  for (let lane = 1; lane < 12; lane++) assert.notEqual(shifts[lane], shifts[lane - 1], `lanes ${lane - 1} and ${lane} wrap on one line`);
  assert.ok(new Set(shifts).size >= 6);
});

test("traffic acceleration is jerk-limited and tapers into the target speed", () => {
  for (const span of [1 / 60, 1 / 20, 0.1, 0.15]) {
    const v = { speed: 0, accel: 0 };
    let reached = Infinity;
    for (let step = 0; step * span < 12; step++) {
      const accel = v.accel;
      easeSpeed(v, 10, span);
      assert.ok(Math.abs(v.accel - accel) <= TRAFFIC_JERK * span + 1e-9, `jerk at ${(step * span).toFixed(2)} s (span ${span})`);
      assert.ok(v.accel <= TRAFFIC_ACCEL + 1e-9 && v.speed <= 10 + 1e-9, "no overshoot");
      if (v.speed >= 9.5 && reached === Infinity) reached = step * span;
    }
    assert.ok(reached < 6, `cruise reached in ${reached} s`);
    // The first step from a standstill moves off gently (not at full acceleration).
    const start = { speed: 0, accel: 0 };
    easeSpeed(start, 10, span);
    assert.ok(start.speed > 0 && start.speed <= TRAFFIC_JERK * span * span + 1e-12);
    // Comfortable braking eases in too; a stop never reverses.
    const slow = { speed: 10, accel: 0 };
    let previousAccel = 0;
    for (let step = 0; step * span < 6; step++) {
      easeSpeed(slow, Math.max(0, 10 - step * span * 3), span);
      // (Firm braking below -5 m/s^2 bites at once, and a car that has stopped holds still.)
      if (slow.speed > 0 && slow.accel > -5) assert.ok(Math.abs(slow.accel - previousAccel) <= TRAFFIC_JERK * span + 1e-9, "braking eases in and out");
      assert.ok(slow.speed >= 0);
      previousAccel = slow.accel;
    }
  }
});

test("trams ease away from and into their stops on the same timetable", () => {
  assert.equal(tramLegDistance(0), 0);
  assert.equal(tramLegDistance(TRAM_RUN), TRAM_LEG);
  const dt = 0.01;
  let peak = 0, previous = 0;
  for (let u = dt; u <= TRAM_RUN; u += dt) {
    const speed = tramLegSpeed(u), accel = (speed - previous) / dt;
    peak = Math.max(peak, Math.abs(accel));
    // Distance is the integral of speed (central difference).
    const slope = (tramLegDistance(u + dt / 2) - tramLegDistance(u - dt / 2)) / dt;
    assert.ok(Math.abs(slope - speed) < 0.02, `speed ${speed} vs slope ${slope} at ${u.toFixed(2)}`);
    previous = speed;
  }
  assert.ok(peak <= 1.5 * TRAM_ACCEL + 0.01, `peak ${peak}`);
  // No lurch: in the first and last 0.2 s the acceleration is a small fraction of the peak.
  assert.ok(tramLegSpeed(0.2) / 0.2 < 0.25 * TRAM_ACCEL);
  assert.ok(tramLegSpeed(TRAM_RUN - 0.2) / 0.2 < 0.25 * TRAM_ACCEL);
});

test("destination boards glide (never swap letters in place at 2 Hz) and fade at their ends", () => {
  assert.ok(BOARD_GLIDE < BOARD_RATE && BOARD_GLIDE <= 0.6);
  assert.equal(boardEdge(0, 8), 0.5);
  assert.equal(boardEdge(-0.5, 8), 0);
  assert.equal(boardEdge(3, 8), 1);
  assert.equal(boardEdge(7.5, 8), 0);
});
