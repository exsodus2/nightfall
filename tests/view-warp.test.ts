import assert from "node:assert/strict";
import test from "node:test";
import { rotationWarp, warpPoint } from "../src/city/view-warp.ts";

const F = 800;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("no remainder: the warp is the identity", () => {
  const warp = rotationWarp(0.7, -0.2, 0.7, -0.2);
  for (const p of [{ x: 0, y: 0 }, { x: 700, y: -300 }, { x: -512, y: 480 }]) {
    const s = warpPoint(warp, F, p);
    close(s.x, p.x); close(s.y, p.y);
  }
});

test("at the centre it matches the old sub-cell glide (turn right / look down)", () => {
  const dy = 0.0009, dp = 0.0007;
  const s = warpPoint(rotationWarp(1.2 + dy, 0.1 + dp, 1.2, 0.1), F, { x: 0, y: 0 });
  close(s.x, dy * F, 0.01); // turned further right than rendered: show what is right of centre
  close(s.y, -dp * F, 0.01); // looked further down: show what is below centre (y up)
});

test("toward the edges a yaw remainder moves points by the exact perspective amount", () => {
  const delta = 0.002;
  for (const x of [-900, -400, 0, 400, 900]) {
    const s = warpPoint(rotationWarp(delta, 0, 0, 0), F, { x, y: 0 });
    close(Math.atan(s.x / F), Math.atan(x / F) + delta, 1e-9);
    close(s.y, 0);
  }
  // The edge moves faster than the centre (sec^2): this is what the old uniform offset missed.
  const centre = warpPoint(rotationWarp(delta, 0, 0, 0), F, { x: 0, y: 0 }).x;
  const edge = warpPoint(rotationWarp(delta, 0, 0, 0), F, { x: 900, y: 0 }).x - 900;
  assert.ok(edge > centre * 2);
});
