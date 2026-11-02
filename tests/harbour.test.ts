import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { HARBOUR_COPING, HARBOUR_KERB, HARBOUR_LEVEL, HARBOUR_REACH, HARBOUR_ROAD, HARBOUR_STRIPS, HARBOUR_WALL, MAST_POOL, OLD_WATER_DEEP, WATER_DEEP, harbourGroundGlsl, harbourZone } = await import("../src/city/harbour.ts");
const { WALL_MAST_STEP } = await import("../src/city/sights.ts");
const { WORLD_EDGE } = await import("../src/city/world.ts");
const { GROUND_MATERIAL, SURFACES, cityMaterial } = await import("../src/city/materials.ts");
// engine.ts needs a browser; its draw distance cap is read from the source instead.
const MAX_DRAW_BLOCKS = Number(/MAX_DRAW_BLOCKS = (\d+)/.exec(readFileSync(new URL("../src/city/engine.ts", import.meta.url), "utf8"))?.[1]);

test("harbour constants mirror the world, the street shader and the metro's quay", () => {
  assert.equal(HARBOUR_ROAD, WORLD_EDGE);
  // materials.ts: the kerb runs 6.2-6.6 m off a street's centre line.
  assert.equal(HARBOUR_KERB, 6.6);
  const metro = readFileSync(new URL("../src/city/metro-scene.ts", import.meta.url), "utf8");
  const quayOut = /QUAY_OUT = (\d+(?:\.\d+)?)/.exec(metro);
  assert.ok(quayOut, "metro-scene.ts QUAY_OUT not found");
  assert.equal(HARBOUR_WALL, Number(quayOut[1]));
  // The metro's quay slab tops out 0.05 m below the street and its old water slab 1.7 m below:
  // the strips keep clear of both by more than the depth buffer resolves at 500 m.
  assert.ok(HARBOUR_LEVEL > 0.5 && HARBOUR_LEVEL < 1.2);
});

test("the water reaches past the farthest fog edge", () => {
  // Fog meets the sky at 0.97 of the draw distance; the player never leaves the city square.
  assert.ok(MAX_DRAW_BLOCKS > 0);
  assert.ok(HARBOUR_REACH > WORLD_EDGE + MAX_DRAW_BLOCKS * 64 * 0.97);
});

test("the strips tile the ring around the street plane exactly, without overlaps", () => {
  const rects = HARBOUR_STRIPS.map(s => ({ x0: s.x - s.width / 2, x1: s.x + s.width / 2, z0: s.z - s.depth / 2, z1: s.z + s.depth / 2 }));
  const area = rects.reduce((sum, r) => sum + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
  assert.equal(area, (2 * HARBOUR_REACH) ** 2 - (2 * HARBOUR_ROAD) ** 2);
  for (const r of rects) {
    assert.ok(r.x0 >= -HARBOUR_REACH && r.x1 <= HARBOUR_REACH && r.z0 >= -HARBOUR_REACH && r.z1 <= HARBOUR_REACH);
    // Never over the street plane (|x|, |z| < HARBOUR_ROAD).
    const overlapX = Math.min(r.x1, HARBOUR_ROAD) - Math.max(r.x0, -HARBOUR_ROAD), overlapZ = Math.min(r.z1, HARBOUR_ROAD) - Math.max(r.z0, -HARBOUR_ROAD);
    assert.ok(overlapX <= 0 || overlapZ <= 0);
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    assert.ok(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 0 || Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) <= 0, `strips ${i} and ${j} overlap`);
  }
});

test("zones run city, quay, flood wall, water outward on every side", () => {
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const at = (beyond: number) => harbourZone(sx * (HARBOUR_ROAD + beyond) + sz * 100, sz * (HARBOUR_ROAD + beyond) + sx * 100);
    assert.equal(at(0), "city");
    assert.equal(at(HARBOUR_KERB + 1), "quay");
    assert.equal(at(HARBOUR_WALL + HARBOUR_COPING / 2), "wall");
    assert.equal(at(HARBOUR_WALL + HARBOUR_COPING + 1), "water");
    assert.equal(at(900), "water");
  }
  assert.equal(harbourZone(0, 0), "city");
  assert.equal(harbourZone(HARBOUR_ROAD + 200, HARBOUR_ROAD + 200), "water");
});

test("the water is calm: every time-driven term has a period of 6 s or more", () => {
  const glsl = harbourGroundGlsl();
  const rates = [...glsl.matchAll(/u_time \* ([\d.]+)/g)].map(match => Number(match[1]));
  assert.ok(rates.length >= 4);
  for (const rate of rates) assert.ok(2 * Math.PI / rate >= 6, `u_time * ${rate} has a ${(2 * Math.PI / rate).toFixed(1)} s period`);
});

test("the harbour block takes no screen derivatives (it runs in a branch)", () => {
  assert.doesNotMatch(harbourGroundGlsl(), /dFdx|dFdy|fwidth|strokeFor|\bband\(/);
});

test("harbour light keeps the ground program's budgets: no new texture reads, loops or per-frame hashes", () => {
  const glsl = harbourGroundGlsl();
  // The five reflection taps and the one column loop predate the lamp pools (tests/building-material.test.ts pins the program).
  assert.equal((glsl.match(/\b(?:texture|texelFetch)\s*\(/g) ?? []).length, 5);
  assert.equal((glsl.match(/\bfor\s*\(/g) ?? []).length, 1);
  assert.doesNotMatch(glsl, /hash\([^)]*u_time/);
  // The mast pools repeat at the masts' spacing (sights.ts WALL_MAST_STEP) and settle to their mean far off.
  assert.ok(glsl.includes(`floor(alongQuay / ${WALL_MAST_STEP}.0 + 0.5)`));
  assert.match(glsl, /mastFar = smoothstep\(/);
  for (const pool of [MAST_POOL.quay, MAST_POOL.water]) assert.ok(pool.radius >= 3 && pool.radius <= 5, "soft discs 6-10 m across");
});

test("the water is a readable dark blue-grey, still darker than the asphalt", () => {
  const luma = ([r, g, b]: readonly number[]) => 0.299 * r + 0.587 * g + 0.114 * b;
  assert.ok(luma(WATER_DEEP) >= 2.5 * luma(OLD_WATER_DEEP), "a few times the old near-black");
  assert.ok(luma(WATER_DEEP) < luma([0.047, 0.062, 0.068]), "under the road's dark asphalt tone (materials.ts)");
  assert.ok(WATER_DEEP[2] > WATER_DEEP[1] && WATER_DEEP[1] > WATER_DEEP[0], "blue-grey");
});

test("both ground programs (desktop and lite) shade the harbour", () => {
  const block = harbourGroundGlsl().trim().slice(0, 60);
  assert.ok(GROUND_MATERIAL.includes(block));
  assert.ok(cityMaterial({ reflections: true, lite: true, surfaces: SURFACES.ground }).includes(block));
  assert.ok(GROUND_MATERIAL.includes(`> ${(HARBOUR_ROAD + HARBOUR_KERB).toFixed(2)})`));
});
