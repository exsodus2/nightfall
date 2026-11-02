import assert from "node:assert/strict";
import test from "node:test";
import { ALLEY_THEMES, FLUSH_THEMES, GROUND_TOP, MOUTH_CLEAR, alleyTheme, alleysOf, alleyNameAt, type AlleyArm, type AlleyPart } from "../src/city/alleys.ts";
import { BLOCK_SIZE, CityWorld, HALF_BLOCKS } from "../src/city/world.ts";
import { streetNameAt } from "../src/city/streets.ts";

const world = new CityWorld();
const arms: AlleyArm[] = [];
for (let bz = -HALF_BLOCKS; bz < HALF_BLOCKS; bz++) for (let bx = -HALF_BLOCKS; bx < HALF_BLOCKS; bx++) arms.push(...alleysOf(world.blocks, bx, bz));
const flat = (p: AlleyPart) => p.y + p.h / 2 <= 0.2;
const ground = (p: AlleyPart) => p.y - p.h / 2 < GROUND_TOP && !flat(p);
/** Across-coordinate extent of a part relative to the arm's centre line, and its along-axis extent. */
const across = (arm: AlleyArm, p: AlleyPart): [number, number] => arm.axis === "z" ? [p.x - p.w / 2 - arm.mid, p.x + p.w / 2 - arm.mid] : [p.z - p.d / 2 - arm.mid, p.z + p.d / 2 - arm.mid];
const along = (arm: AlleyArm, p: AlleyPart): [number, number] => arm.axis === "z" ? [p.z - p.d / 2, p.z + p.d / 2] : [p.x - p.w / 2, p.x + p.w / 2];

test("alley themes: every arm of a block differs, and facing arms across a street differ", () => {
  for (let bz = -HALF_BLOCKS; bz < HALF_BLOCKS; bz++) for (let bx = -HALF_BLOCKS; bx < HALF_BLOCKS; bx++) {
    const themes = (["n", "s", "w", "e"] as const).map(side => alleyTheme(bx, bz, side));
    assert.equal(new Set(themes).size, 4, `block ${bx},${bz}: ${themes.join(" ")}`);
    assert.notEqual(alleyTheme(bx, bz, "n"), alleyTheme(bx, bz - 1, "s"), `north arm of ${bx},${bz} repeats the arm across its street`);
    assert.notEqual(alleyTheme(bx, bz, "w"), alleyTheme(bx - 1, bz, "e"), `west arm of ${bx},${bz} repeats the arm across its street`);
  }
  const seen = new Set(arms.map(arm => arm.theme));
  for (const theme of ALLEY_THEMES) assert.ok(seen.has(theme), `${theme} appears somewhere`);
  assert.ok(arms.length > 1000, `most blocks have four arms (${arms.length})`);
});

test("alley props keep a 1.8 m walking line open and stay clear of the street and the buildings", () => {
  for (const arm of arms) {
    const half = arm.width / 2;
    let fromA = 0, fromB = 0;
    for (const part of [...arm.parts, ...arm.mouth].filter(ground)) {
      const [lo, hi] = across(arm, part);
      if ((lo + hi) / 2 < 0) fromA = Math.max(fromA, hi + half); else fromB = Math.max(fromB, half - lo);
      // Along the arm: never in the walking lines or the portal legs at the mouth.
      const [a0, a1] = along(arm, part), base = (arm.axis === "z" ? arm.bz : arm.bx) * BLOCK_SIZE;
      assert.ok(a0 - base >= MOUTH_CLEAR - 1e-6 && base + BLOCK_SIZE - a1 >= MOUTH_CLEAR - 1e-6, `${arm.theme} part at ${part.x.toFixed(1)},${part.z.toFixed(1)} is in the street`);
      // Not buried in a building (flush to the faces is fine).
      for (const b of world.blocks.get(`${arm.bx},${arm.bz}`)?.buildings ?? []) {
        const overlapX = Math.min(part.x + part.w / 2, b.x + b.width / 2) - Math.max(part.x - part.w / 2, b.x - b.width / 2);
        const overlapZ = Math.min(part.z + part.d / 2, b.z + b.depth / 2) - Math.max(part.z - part.d / 2, b.z - b.depth / 2);
        assert.ok(overlapX < 0.05 || overlapZ < 0.05, `${arm.theme} part inside building ${b.id}`);
      }
    }
    assert.ok(arm.width - fromA - fromB >= 1.8 - 1e-6, `${arm.theme} arm at ${arm.cx.toFixed(0)},${arm.cz.toFixed(0)} leaves ${(arm.width - fromA - fromB).toFixed(2)} m`);
  }
});

test("alleys are calm, modest and announced at the mouth", () => {
  for (const arm of arms) {
    const counts = arm.parts.length + arm.mouth.length;
    assert.ok(counts <= 160, `${arm.theme} arm has ${counts} parts`);
    assert.ok(arm.mouth.some(p => p.round && p.gain >= 1), `${arm.theme} arm has a lantern at its mouth`);
    for (const part of [...arm.parts, ...arm.mouth]) if (part.pulse) assert.ok(part.pulse.rate <= 2.5 && part.pulse.depth <= 0.25, "lights breathe at 0.4 Hz or slower, gently");
    assert.ok(arm.actors.filter(a => a.kind === "figure").length <= 2, "one or two figures at most");
    // The narrow avenue-side arms only take the flat-on-the-wall themes.
    if (arm.width < 3.4) assert.ok(FLUSH_THEMES.includes(arm.theme), `narrow arm got ${arm.theme}`);
  }
  const arm = arms.find(a => a.side === "n" && a.bx > 2 && Math.abs(a.mid - (a.bx * BLOCK_SIZE + 32)) < 1.5) ?? arms[0];
  assert.match(alleyNameAt(arm.mid, arm.bz * BLOCK_SIZE + 20) ?? "", /Alley|Gallery/);
  assert.match(streetNameAt(arm.mid, arm.bz * BLOCK_SIZE + 20), / off /, "the map names the alley and its street");
  assert.equal(alleyNameAt(arm.bx * BLOCK_SIZE + 2, arm.bz * BLOCK_SIZE + 2), null, "streets are not alleys");
});
