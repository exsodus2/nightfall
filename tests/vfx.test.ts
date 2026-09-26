import assert from "node:assert/strict";
import test from "node:test";
import { carMotion, dripState, project, rainDrops, signBuzzes, signSeed, sparkBurst, splashPhase } from "../src/city/vfx.ts";

test("wheels spin with the distance rolled, stay put when parked, and brake lights follow deceleration", () => {
  const a = carMotion(9001, 0, 0, Math.PI / 2, 10, 1);
  const b = carMotion(9001, 0.1, 0, Math.PI / 2, 10, 1.01);          // 10 cm forward (+x is forward at yaw pi/2)
  const turned = ((b.spin - a.spin) % 360 + 360) % 360;
  assert.ok(Math.abs(turned - 15) <= 7.5, `0.1 m on a 0.4 m wheel is ~14 degrees, got ${turned}`);
  assert.equal(carMotion(9001, 0.1, 0, Math.PI / 2, 10, 1.01).spin, b.spin, "same clock (reflection pass) leaves the wheel");
  assert.ok(b.blur > 0.3 && b.blur < 0.6, "10 m/s blurs the spokes partly");
  let m = b;
  for (let i = 1; i <= 30; i++) m = carMotion(9001, 0.1 + i * 0.05, 0, Math.PI / 2, Math.max(0, 10 - i * 0.3), 1.01 + i * 0.02);
  assert.ok(m.brake > 0.8, "decelerating lights the brake lights");
  const parked = carMotion(9002, 5, 5, 0, null, 1);
  assert.equal(carMotion(9002, 5, 5, 0, null, 2).spin, parked.spin);
  assert.ok(carMotion(9002, 5, 5, 0, null, 3).brake < 0.05, "a parked car has dark brake lights");
});

test("projection matches the engine camera: ahead is centred, right is right, up is up", () => {
  const cam = { x: 0, y: 2, z: 0, yaw: 0, pitch: 0, fov: 60, aspect: 1.5 };
  const ahead = project(cam, 0, 2, -10);
  assert.ok(ahead && Math.abs(ahead.sx) < 1e-9 && Math.abs(ahead.sy) < 1e-9 && Math.abs(ahead.depth - 10) < 1e-9);
  assert.ok((project(cam, 3, 2, -10)?.sx ?? 0) > 0);
  assert.ok((project(cam, 0, 5, -10)?.sy ?? 0) > 0);
  assert.equal(project(cam, 0, 2, 10), null, "behind the camera");
  const down = project({ ...cam, pitch: 0.3 }, 0, 2, -10);
  assert.ok(down && down.sy > 0, "positive pitch looks down, so a level point rises on screen");
});

test("rain is world-anchored and deterministic: moving the eye does not re-roll drops", () => {
  const a = rainDrops(0, 2.7, 0, 12.5, 10, 2, 2), b = rainDrops(0.7, 2.7, 0.4, 12.5, 10, 2, 2);
  assert.ok(a.length > 40);
  const key = (d: { x: number; y: number; z: number }) => `${d.x.toFixed(4)},${d.y.toFixed(4)},${d.z.toFixed(4)}`;
  const shared = b.filter(d => a.some(e => key(e) === key(d))).length;
  assert.ok(shared > b.length * 0.7, "most drops are the same drops after a small step");
  assert.deepEqual(rainDrops(0, 2.7, 0, 12.5, 10, 2, 2), a);
  assert.ok(a.every(d => d.y > 0));
  const later = rainDrops(0, 2.7, 0, 12.6, 10, 2, 2);
  assert.ok(later.some(d => a.some(e => Math.abs(e.x - d.x) < 0.1 && e.y > d.y)), "drops fall over time");
});

test("splashes, drips and spark bursts are short, periodic events", () => {
  let visible = 0;
  for (let i = 0; i < 1000; i++) if (splashPhase(0.37, i * 0.01, 1) >= 0) visible++;
  assert.ok(visible > 250 && visible < 400, `a 0.32 s splash once a second, got ${visible}`);
  const stages = new Set<string>();
  for (let i = 0; i < 600; i++) stages.add(dripState(0.4, i * 0.01, 4).stage);
  for (const stage of ["bead", "fall", "splash"]) assert.ok(stages.has(stage), stage);
  let sparks = 0;
  for (let i = 0; i < 2000; i++) {
    const burst = sparkBurst(0.61, i * 0.05, 0, 5, 0, 0, 1, 2);
    sparks += burst.length;
    for (const s of burst) assert.ok(s.y >= 0.05 && s.life >= 0 && s.life <= 1);
  }
  assert.ok(sparks > 0, "a buzzing sign sparks now and then");
  assert.equal(typeof signBuzzes(signSeed(10, 5.8, 20)), "boolean");
});
