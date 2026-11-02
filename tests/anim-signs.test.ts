// Sign, ticker, hologram and street-screen animation polish (motion comfort): no brightness term
// runs faster than ~0.4 Hz, nothing switches with a hard step on the clock, and every sawtooth
// cycle fades down before it wraps.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { cityMaterial } = await import("../src/city/materials.ts");
const { SIGN_SHORT, signShortAge, sparkBurst } = await import("../src/city/vfx.ts");

const source = cityMaterial();
function section(from: string, to: string): string {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start > 0 && end > start, `section ${from} .. ${to} not found`);
  return source.slice(start, end);
}
const signs = section("// Signs: real letters.", "// A faint backplate gradient");
const ticker = section("// Ticker band:", "// Hologram screen:");
const screen = section("// Hologram screen:", "// Sky dome:");
const hologram = section("// Hologram: a translucent figure", "// Ticker band:");
const subjects = section("// ---- Holograms: closed-form subjects", "#else");
const MAX_RATE = 2 * Math.PI * 0.4;

/** Every `u_time * k` multiplier: an oscillation sin(u_time * k) runs at k / 2pi Hz. (Scroll
 * speeds in letters/s are bounded the same way, which keeps them calm too.) */
const rates = (glsl: string): number[] => [...glsl.matchAll(/u_time \* ([\d.]+)/g)].map(match => Number(match[1]));

for (const [name, glsl] of [["signs", signs], ["ticker", ticker], ["screen", screen], ["hologram", hologram]] as const) {
  test(`${name}: every time-driven term is at or under 0.4 Hz, with no stepped clock`, () => {
    const found = rates(glsl);
    assert.ok(found.length >= 1, "time terms found");
    for (const rate of found) assert.ok(rate <= MAX_RATE + 1e-9, `${name}: u_time * ${rate} is ${(rate / (2 * Math.PI)).toFixed(2)} Hz`);
    assert.doesNotMatch(glsl, /floor\(u_time/, "no floor() of the clock");
    assert.doesNotMatch(glsl, /step\([^;()]*u_time/, "no step() on the clock");
  });
}

test("sign buzz breathes on slow noise and its short-outs are spaced and eased", () => {
  assert.doesNotMatch(signs, /noise2\(vec2\(u_time \* 2\.0/, "the 2 Hz buzz is gone");
  assert.match(signs, /noise2\(vec2\(u_time \* 0\.35, seed \* 91\.0\)\)/);
  assert.match(signs, /float breath = 0\.18 \*/, "breathing depth at most 20%");
  assert.ok(SIGN_SHORT.period >= 6, "deep flickers at least 6 s apart");
  assert.ok(SIGN_SHORT.ease >= 0.3 && SIGN_SHORT.depth <= 0.35);
  assert.ok(signs.includes(`mod(u_time + seed * ${SIGN_SHORT.offset.toFixed(2)}, ${SIGN_SHORT.period.toFixed(2)} + seed * ${SIGN_SHORT.spread.toFixed(2)})`), "shader and sparks share one cycle");
  // Sparks only fly in the first `burst` seconds of the cycle the tube sags in.
  for (let i = 0; i < 4000; i++) {
    const time = i * 0.05;
    if (sparkBurst(0.61, time, 0, 5, 0, 0, 1, 2).length) assert.ok(signShortAge(0.61, time) <= SIGN_SHORT.burst);
  }
});

test("power-up sweep: letters ease on, the end pulse is one shallow sag, the sign fades before the wrap", () => {
  assert.doesNotMatch(signs, /float\(k\) < sweep/, "no per-letter on/off step");
  assert.match(signs, /smoothstep\(turnOn, turnOn \+ 0\.045, powerPhase\)/, "each letter eases on over ~0.4 s of the ~9 s cycle");
  assert.match(signs, /1\.0 - smoothstep\(0\.85, 1\.0, powerPhase\)/, "fades down over ~1.4 s before fract wraps");
  assert.match(signs, /fract\(u_time \* 0\.11 \+ seed\)/);
});

test("marquee chevrons glide in and out", () => {
  assert.match(signs, /float chevronLit = smoothstep\(0\.0, 0\.12, chevronPhase\)/);
  assert.match(signs, /ink = neon2 \* 1\.3 \* chevronLit/);
});

test("LED ticker band swells slowly and shallowly", () => {
  assert.match(ticker, /float pulse = 0\.92 \+ 0\.08 \* sin\(u_time \* 1\.5 \+ s \* 0\.2\)/);
});

test("street screens: dim cut, rain and fronts never vanish in a frame, radar eases in", () => {
  assert.match(screen, /ink \*= cutDim; paper \*= cutDim; emission \*= cutDim;/);
  assert.match(screen, /\* 1\.8 - 0\.2;/, "rain heads run past the bottom before wrapping");
  assert.doesNotMatch(screen, /behind >= 0\.0 \? exp/, "rain glyphs ease on");
  assert.match(screen, /fract\(u_time \* 0\.012 \+ seed\) \* 1\.8 - 0\.25/, "the weather front leaves before wrapping");
  assert.match(screen, /smoothstep\(5\.88, 6\.2832, behindSweep\)/, "radar leading edge eases up");
});

test("holograms: eased blink, gliding market bars, sin^2 dropouts, pulses fade before wrapping", () => {
  assert.doesNotMatch(subjects, /step\(0\.06, fract\(t/, "no stepped blink");
  assert.doesNotMatch(subjects, /floor\(t \* 0\.4\)/, "bars no longer jump together");
  assert.match(subjects, /barBlend = smoothstep\(0\.8, 1\.0, barClock - barKey\)/);
  assert.match(hologram, /dropBump \* dropBump/);
  assert.match(hologram, /pulse = smoothstep\(0\.5, 0\.88, pulsePhase\) \* \(1\.0 - smoothstep\(0\.88, 1\.0, pulsePhase\)\)/);
});
