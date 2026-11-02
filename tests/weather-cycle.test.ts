import assert from "node:assert/strict";
import test from "node:test";
import { LIGHTNING_SECONDS, WEATHER_GLSL, gustAt, rainIntensity, sheetLightning, weatherAt, windAt } from "../src/city/weather.ts";

const HOURS = 4, STEP = 0.05;

test("the weather cycle drifts between drizzle, steady rain and a brief downpour over minutes", () => {
  let drizzle = 0, steady = 0, downpour = 0, samples = 0, fastest = 0, previous = rainIntensity(0);
  for (let t = STEP; t < HOURS * 3600; t += STEP) {
    const rain = rainIntensity(t);
    assert.ok(rain >= 0.19 && rain <= 1.0001, `rain stays in range at ${t}`);
    if (rain < 0.3) drizzle++; else if (rain > 0.9) downpour++; else if (rain > 0.55) steady++;
    fastest = Math.max(fastest, Math.abs(rain - previous) / STEP); previous = rain; samples++;
  }
  assert.ok(drizzle / samples > 0.12, "drizzle is common");
  assert.ok(steady / samples > 0.3, "steady rain is the usual state");
  assert.ok(downpour / samples > 0.01 && downpour / samples < 0.1, `a downpour is brief (${(downpour / samples * 100).toFixed(1)}%)`);
  assert.ok(fastest < 0.05, `intensity never changes faster than 5% per second (${fastest.toFixed(3)})`);
  const studio = rainIntensity(45);
  assert.ok(studio > 0.55 && studio < 0.8, "the studio clock (45 s) shows steady rain, so captures compare like with like");
});

test("gusts build over seconds and the wind angles the rain without jumps", () => {
  let gusty = 0, samples = 0, fastest = 0, previous = windAt(0);
  for (let t = STEP; t < 3600; t += STEP) {
    const wind = windAt(t);
    if (gustAt(t) > 0.5) gusty++;
    fastest = Math.max(fastest, Math.hypot(wind.x - previous.x, wind.z - previous.z) / STEP); previous = wind; samples++;
    assert.ok(wind.x >= 0.9 - 1e-9 && wind.x < 4.2, "wind blows the same way, harder in a gust");
  }
  assert.ok(gusty / samples > 0.05 && gusty / samples < 0.35, `most of the time is calm (${(gusty / samples * 100).toFixed(1)}% gusty)`);
  assert.ok(fastest < 2.5, `wind changes at most ${fastest.toFixed(2)} m/s per second`);
  assert.deepEqual(weatherAt(123.4), weatherAt(123.4), "a pure function of the scene clock");
});

test("sheet lightning is a single soft swell, never a flash or a repeat at 3 Hz", () => {
  let windows = 0, active = false, start = 0, longest = 0, steepest = 0, previous = 0;
  for (let t = 0; t < HOURS * 3600; t += 0.01) {
    const glow = sheetLightning(t).glow;
    assert.ok(glow >= 0 && glow <= 1);
    steepest = Math.max(steepest, Math.abs(glow - previous) / 0.01); previous = glow;
    if (glow > 0.001 && !active) { active = true; start = t; windows++; }
    if (glow <= 0.001 && active) { active = false; longest = Math.max(longest, t - start); }
  }
  assert.ok(windows > 10, `it happens now and then (${windows} in ${HOURS} h)`);
  assert.ok(longest <= LIGHTNING_SECONDS + 0.02, "each swell lasts at most 1.8 s");
  assert.ok(steepest < 2, `it brightens over ~1 s, not in a frame (${steepest.toFixed(2)} per second)`);
  let gap = Infinity, last = -Infinity;
  for (let t = 0; t < HOURS * 3600; t += 0.05) if (sheetLightning(t).glow > 0.5) { if (t - last > 1) { gap = Math.min(gap, t - last); } last = t; }
  assert.ok(gap > 30, `swells are far apart (${gap.toFixed(0)} s)`);
});

test("the GLSL copy uses the same waves and stays small", () => {
  assert.match(WEATHER_GLSL, /float weatherRain\(\)/);
  assert.match(WEATHER_GLSL, /vec2 sheetLightning\(float rain\)/);
  assert.equal((WEATHER_GLSL.match(/sin\(/g) ?? []).length, 4, "three waves and one hash");
  assert.ok(WEATHER_GLSL.length < 1200);
});
