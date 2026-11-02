import assert from "node:assert/strict";
import test from "node:test";
import { fullyHidden, visibleFrom } from "../src/city/visibility.ts";
import type { Building } from "../src/city/world.ts";

// The slab test and both callers exactly as they were before the bounding-box early-out, as the
// reference: the early-out must never change an answer.
function slab(ex: number, ey: number, ez: number, dx: number, dy: number, dz: number, minX: number, maxX: number, maxY: number, minZ: number, maxZ: number): boolean {
  let near = 0.001, far = 0.995;
  if (Math.abs(dx) < 0.00001) { if (ex < minX || ex > maxX) return false; }
  else { const a = (minX - ex) / dx, c = (maxX - ex) / dx; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); if (near > far) return false; }
  if (Math.abs(dy) < 0.00001) { if (ey < 0 || ey > maxY) return false; }
  else { const a = (0 - ey) / dy, c = (maxY - ey) / dy; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); if (near > far) return false; }
  if (Math.abs(dz) < 0.00001) { if (ez < minZ || ez > maxZ) return false; }
  else { const a = (minZ - ez) / dz, c = (maxZ - ez) / dz; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); }
  return near <= far;
}
type Point = { x: number; y: number; z: number };
function referenceVisible(eye: Point, target: Point, occluders: readonly Building[]): boolean {
  const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
  for (const b of occluders) if (slab(eye.x, eye.y, eye.z, dx, dy, dz, b.x - b.width / 2, b.x + b.width / 2, b.height, b.z - b.depth / 2, b.z + b.depth / 2)) return false;
  return true;
}
function referenceHidden(eye: Point, target: Building, occluders: readonly Building[]): boolean {
  const sees = (o: Building, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const scale = o.style === 4 ? 0.55 : o.style === 7 ? 0.64 : 0.89;
    const cx = o.x - (o.style === 4 ? o.width * 0.2 : 0), w = o.width * scale, d = o.depth * scale;
    return !slab(sx, sy, sz, x - sx, y - sy, z - sz, cx - w / 2, cx + w / 2, o.height, o.z - d / 2, o.z + d / 2);
  };
  const x0 = target.x - target.width / 2 - 3, x1 = target.x + target.width / 2 + 3, z0 = target.z - target.depth / 2 - 3, z1 = target.z + target.depth / 2 + 3, y0 = 0.1, y1 = target.height + 24;
  for (const other of occluders) {
    if (other.id === target.id) continue;
    if (sees(other, eye.x, eye.y, eye.z, target.x, target.height / 2, target.z)) continue;
    let covered = true;
    for (let i = 0; i < 8 && covered; i++) {
      const x = i < 4 ? x0 : x1, z = (i & 2) === 0 ? z0 : z1, y = (i & 1) === 0 ? y0 : y1;
      if (sees(other, eye.x, eye.y, eye.z, x, y, z) || sees(other, eye.x, -eye.y, eye.z, x, y, z)) covered = false;
    }
    if (covered) return true;
  }
  return false;
}

let seed = 11;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// Coordinates on a coarse grid, so segment ends often land exactly on box faces (the edge cases).
const coarse = (span: number) => Math.round((random() * 2 - 1) * span * 4) / 4;
const building = (id: number): Building => ({ id, x: coarse(120), z: coarse(120), width: 4 + Math.round(random() * 40), depth: 4 + Math.round(random() * 40), height: Math.round(random() * 90), district: 1, style: Math.floor(random() * 9), accent: [255, 100, 160], sign: "X" });

test("perf: visibleFrom's bounding-box early-out gives the same answer as the full slab test", () => {
  const occluders = Array.from({ length: 160 }, (_, i) => building(i));
  let hidden = 0;
  for (let k = 0; k < 6000; k++) {
    const eye = { x: coarse(130), y: k % 7 === 0 ? -coarse(20) : Math.abs(coarse(40)), z: coarse(130) };
    // Some targets straight above/below or along an axis (the |d| < 1e-5 branches).
    const target = { x: k % 11 === 0 ? eye.x : coarse(130), y: k % 13 === 0 ? eye.y : coarse(60), z: k % 17 === 0 ? eye.z : coarse(130) };
    const expected = referenceVisible(eye, target, occluders);
    if (!expected) hidden++;
    assert.equal(visibleFrom(eye, target, occluders), expected, `eye ${JSON.stringify(eye)} target ${JSON.stringify(target)}`);
  }
  assert.ok(hidden > 0 && hidden < 6000, "the sample exercises both answers");
});

test("perf: fullyHidden's early-out gives the same answer as before", () => {
  for (let k = 0; k < 1500; k++) {
    const occluders = Array.from({ length: 18 }, (_, i) => building(i));
    const target = { ...building(99), x: coarse(400), z: coarse(400) };
    const eye = { x: coarse(30), y: 1 + random() * 60, z: coarse(30) };
    assert.equal(fullyHidden(eye, target, occluders), referenceHidden(eye, target, occluders));
  }
});

// engine.ts culls buildings, blocks and props against the horizontal view cone with shortcuts that
// skip asin/cos: a facing at or above cos(halfFov + 0.25) is always kept, and (buildings beyond
// 55 m) one below cos(halfFov + (0.25 + asin(30 / 55))) always culled. Both rest on Math.cos and
// Math.asin being monotonic over the angles used; this checks the shortcut against the full test.
test("perf: the cone shortcuts in engine.ts agree with the full asin/cos test", () => {
  for (let k = 0; k < 20000; k++) {
    const halfFov = Math.atan(Math.tan((62 + random() * 8) * Math.PI / 360) * (0.4 + random() * 2.2));
    const distance = 55 + random() * 1500 * random() + (k % 5 === 0 ? 1e-9 : 0);
    const coneKeep = Math.cos(halfFov + 0.25), coneCull = Math.cos(halfFov + (0.25 + Math.asin(30 / 55)));
    const full = Math.cos(halfFov + (0.25 + Math.asin(Math.min(1, 30 / Math.max(1, distance)))));
    // Facings right at the full threshold and at both shortcut thresholds, plus random ones.
    for (const facing of [full, coneKeep, coneCull, full * (1 + 1e-16), random() * 2 - 1]) {
      const original = facing < full;
      const shortcut = facing < coneKeep && (facing < coneCull || facing < full);
      assert.equal(shortcut, original, `halfFov ${halfFov} distance ${distance} facing ${facing}`);
    }
    const radius = random() * 20, propLimit = Math.cos(halfFov + 0.25 + Math.asin(Math.min(1, radius / Math.max(distance, 1e-3))));
    for (const facing of [propLimit, coneKeep, random() * 2 - 1]) {
      assert.equal((facing < coneKeep || radius < 0) && facing < propLimit, facing < propLimit);
    }
  }
});
