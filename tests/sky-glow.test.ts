import assert from "node:assert/strict";
import test from "node:test";
import { DISTRICTS } from "../src/city/world.ts";
import {
  DATA_HAZE, DATA_HAZE_BREATH_GLSL, DATA_HAZE_PERIOD, SKY_DISTRICT_COLORS, SKY_DISTRICT_GLOW, dataHazeBreath, districtSkyLight, districtSkyLightGlsl,
} from "../src/city/weather.ts";

test("the cloud deck is lit in each district's own colour", () => {
  assert.deepEqual(SKY_DISTRICT_COLORS.map(c => [...c]), DISTRICTS.map(d => [...d.color]), "the palette follows world.ts DISTRICTS");
  for (const district of DISTRICTS) {
    const light = districtSkyLight(district.x, district.z), glow = SKY_DISTRICT_GLOW[district.id];
    district.color.forEach((c, k) => assert.ok(Math.abs(light[k] - c / 255 * glow) < 1e-6, `${district.name} lights its own deck`));
  }
  const ward = districtSkyLight(0, -320);
  assert.ok(ward[0] > ward[1] && ward[2] > ward[1], "the Neon Ward's deck is magenta");
});

test("district light blends across borders and dies out past the rim", () => {
  let steepest = 0;
  for (let x = -1100; x <= 1100; x += 2) {
    for (const z of [-320, -2, 0, 2, 320]) {
      const a = districtSkyLight(x, z), b = districtSkyLight(x + 2, z);
      for (let k = 0; k < 3; k++) { assert.ok(a[k] >= 0 && a[k] <= 1); steepest = Math.max(steepest, Math.abs(a[k] - b[k]) / 2); }
    }
  }
  assert.ok(steepest < 0.01, `no hard edge in the deck (${steepest.toFixed(4)} per metre)`);
  assert.deepEqual(districtSkyLight(1200, 0), [0, 0, 0], "no city glow out over the water");
  assert.deepEqual(districtSkyLight(0, -1200), [0, 0, 0]);
});

test("the GLSL statements carry the same palette and blend", () => {
  const glsl = districtSkyLightGlsl("deck", "under");
  assert.match(glsl, /under = mix\(/);
  assert.match(glsl, /deck\.x/);
  assert.match(glsl, /deck\.y/);
  const [r, g, b] = districtSkyLight(0, -320);
  assert.ok(glsl.includes(`vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`), "the Ward's tint is spliced in");
});

test("the Cathedral's data haze breathes slowly and never flickers", () => {
  let steepest = 0, low = 1, high = 0, previous = dataHazeBreath(0);
  for (let t = 0.05; t < 600; t += 0.05) {
    const v = dataHazeBreath(t);
    steepest = Math.max(steepest, Math.abs(v - previous) / 0.05); previous = v;
    low = Math.min(low, v); high = Math.max(high, v);
  }
  assert.ok(DATA_HAZE_PERIOD >= 20 && DATA_HAZE_PERIOD <= 30, "one breath every 20-30 s");
  assert.ok(steepest < 0.1, `it changes over seconds (${steepest.toFixed(3)} per second)`);
  assert.ok(low >= 0.449 && high <= 1.0001 && high - low > 0.5, "it swells and fades but never vanishes");
  assert.ok(dataHazeBreath(45) > 0.6, "the studio clock (45 s) catches it well lit");
  assert.match(DATA_HAZE_BREATH_GLSL, /sin\(u_time \* 0\.241661 \+ 2\.200\)/);
  assert.ok(DATA_HAZE.top > DATA_HAZE.bottom && DATA_HAZE.bottom > 150, "the haze hangs above the towers");
});
