import assert from "node:assert/strict";
import test from "node:test";
import { ViewCone } from "../src/city/frame-cache.ts";

// Points on screen at a depth along the camera's own basis (y up, positive pitch looks down).
function screenPoint(eye: [number, number, number], yaw: number, pitch: number, fov: number, aspect: number, sx: number, sy: number, depth: number): [number, number, number] {
  const f = [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const r = [Math.cos(yaw), 0, Math.sin(yaw)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const tanV = Math.tan(fov * Math.PI / 360), tanH = tanV * aspect;
  return [0, 1, 2].map(i => eye[i] + depth * (f[i] + r[i] * sx * tanH + u[i] * sy * tanV)) as [number, number, number];
}

test("perf: the steep-view cone never rejects anything on screen (conservative)", () => {
  const cone = new ViewCone();
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 400; k++) {
    const eye: [number, number, number] = [random() * 1000 - 500, 20 + random() * 300, random() * 1000 - 500];
    const yaw = random() * Math.PI * 2, pitch = (random() < 0.5 ? -1 : 1) * (0.85 + random() * 0.7), fov = 62, aspect = 1 + random();
    cone.set(eye[0], eye[1], eye[2], yaw, pitch, fov, aspect);
    for (let i = 0; i < 50; i++) {
      const p = screenPoint(eye, yaw, pitch, fov, aspect, random() * 2 - 1, random() * 2 - 1, 0.5 + random() * 1500);
      assert.ok(cone.sees(p[0], p[1], p[2], 0), `on-screen point rejected (yaw ${yaw}, pitch ${pitch})`);
      assert.ok(cone.sees(p[0] + 3, p[1], p[2], 3), "a sphere touching an on-screen point is kept");
    }
  }
});

test("perf: the steep-view cone rejects what is behind or beside a top-down camera", () => {
  const cone = new ViewCone();
  cone.set(0, 230, 0, 0, 1.2, 62, 1.5);
  assert.equal(cone.sees(0, 0, 0, 1), true, "straight below-ahead is in view");
  assert.equal(cone.sees(0, 0, 700, 10), false, "far behind on the ground");
  assert.equal(cone.sees(900, 0, -200, 20), false, "far to the side on the ground");
  assert.equal(cone.sees(0, 0, 700, 800), true, "a sphere containing the view is kept");
});
