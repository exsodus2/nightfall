// Weather agent: the slow weather cycle (no imports, no DOM). Everything is a pure function of the
// scene clock, so the rain layer (vfx-scene.ts) and the material shader (WEATHER_GLSL, spliced into
// materials.ts) agree without a uniform, freezing time freezes the weather, and studio replays at a
// given ?clock= always show the same sky.
//
// Comfort: every term changes over seconds to minutes. Rain intensity drifts over ~3-7 minutes,
// gusts build and fall over ~3-8 s, and sheet lightning is one soft 1.8 s swell (a raised cosine:
// no flash, no repeat inside its window) at most once every 71 s.

const TAU = Math.PI * 2;
/** The weather front: three slow waves (period s, amplitude, phase). Phases put the studio clock
 * (45 s) in steady rain for ~4 minutes, then drizzle, then the first downpour ~9 minutes in; after
 * that the waves line up for a brief downpour every ~10-20 minutes (~5% of the time). */
export const WEATHER_WAVES: readonly (readonly [number, number, number])[] = [[437, 0.3, 0.124], [191, 0.17, 2.042], [97, 0.07, 5.45]];
export const LIGHTNING_PERIOD = 71, LIGHTNING_SECONDS = 1.8;

const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 0..~1: the raw front (shared with the shader). */
export function weatherFront(time: number): number {
  let f = 0.5;
  for (const [period, amplitude, phase] of WEATHER_WAVES) f += amplitude * Math.sin(time * TAU / period + phase);
  return f;
}
/** Rain intensity: ~0.2 drizzle, ~0.65 steady rain, 1 downpour. */
export function rainIntensity(time: number): number {
  const f = weatherFront(time);
  return 0.2 + 0.45 * smooth(0.2, 0.62, f) + 0.35 * smooth(0.8, 0.98, f);
}
/** Gusts 0..1: two slow waves multiplied, so a gust builds over a few seconds and most of the time is calm. */
export function gustAt(time: number): number {
  const a = 0.5 + 0.5 * Math.sin(time * TAU / 41 + 0.6), b = 0.5 + 0.5 * Math.sin(time * TAU / 17.3 + 2.1);
  return smooth(0.3, 0.9, a * b);
}
/** Wind at street level (m/s, world x/z): a steady drift, angled further during gusts and downpours. */
export function windAt(time: number): { x: number; z: number } {
  const gust = gustAt(time), rain = rainIntensity(time);
  return { x: 0.9 + gust * (1.6 + 1.6 * rain), z: 0.35 + gust * 0.7 };
}
const fract = (x: number): number => x - Math.floor(x);
/** Distant sheet lightning: 0..1, one smooth swell (raised cosine over LIGHTNING_SECONDS) in some
 * 71 s windows while it rains hard. `azimuth` (radians, atan2(z, x)) is where the clouds glow. */
export function sheetLightning(time: number): { glow: number; azimuth: number } {
  const k = Math.floor(time / LIGHTNING_PERIOD), roll = fract(Math.sin(k * 12.9898 + 4.1) * 43758.5453);
  const start = 10 + roll * 40, u = time - k * LIGHTNING_PERIOD - start;
  const azimuth = roll * 37.0 % TAU;
  if (roll < 0.35 || u < 0 || u > LIGHTNING_SECONDS) return { glow: 0, azimuth };
  return { glow: (0.5 - 0.5 * Math.cos(TAU * u / LIGHTNING_SECONDS)) * smooth(0.5, 0.75, rainIntensity(time)), azimuth };
}

export interface Weather { rain: number; gust: number; wind: { x: number; z: number } }
export function weatherAt(time: number): Weather {
  return { rain: rainIntensity(time), gust: gustAt(time), wind: windAt(time) };
}

/** The same cycle in GLSL (u_time is the scene clock). Unused functions are stripped by the compiler. */
export const WEATHER_GLSL = /* glsl */ `
float weatherRain() {
  float f = 0.5${WEATHER_WAVES.map(([period, amplitude, phase]) => ` + ${amplitude.toFixed(3)} * sin(u_time * ${(TAU / period).toFixed(7)} + ${phase.toFixed(3)})`).join("")};
  return 0.2 + 0.45 * smoothstep(0.2, 0.62, f) + 0.35 * smoothstep(0.8, 0.98, f);
}
// x: glow 0..1, y: azimuth (atan(z, x)) of the lit cloud bank.
vec2 sheetLightning(float rain) {
  float k = floor(u_time / ${LIGHTNING_PERIOD.toFixed(1)}), roll = fract(sin(k * 12.9898 + 4.1) * 43758.5453);
  float u = u_time - k * ${LIGHTNING_PERIOD.toFixed(1)} - (10.0 + roll * 40.0);
  float glow = (roll < 0.35 || u < 0.0 || u > ${LIGHTNING_SECONDS.toFixed(2)}) ? 0.0 : 0.5 - 0.5 * cos(${(TAU / LIGHTNING_SECONDS).toFixed(5)} * u);
  return vec2(glow * smoothstep(0.5, 0.75, rain), mod(roll * 37.0, ${TAU.toFixed(5)}));
}
`;

// ---- Sky agent: the city's light on the cloud deck -------------------------------------------
// Each district lights the smog over it in its own colour (world.ts DISTRICTS, in id order: the
// Foundry, Neon Ward, Ghost Circuit / Rain Gardens, Silk Market, the Spillway), scaled by how much
// light it throws up: the Ward's signs most, the Foundry's furnaces next, the dark Gardens least.
// Districts blend over ~170 m across their borders and the glow dies out past the city rim, so the
// deck never shows a hard edge. The material shader (materials.ts sky dome) samples it where the
// view ray meets the deck and at two points along the bearing for the skyline band.
export const SKY_DISTRICT_COLORS: readonly (readonly [number, number, number])[] = [
  [255, 143, 77], [255, 71, 148], [133, 155, 255], [107, 226, 162], [66, 223, 227], [255, 196, 96],
];
export const SKY_DISTRICT_GLOW: readonly number[] = [0.9, 1, 0.6, 0.45, 0.75, 0.6];
/** Column edges (x) and the north/south border (z) the blend straddles, and the rim fade (m). */
export const SKY_BLEND = { west: [-340, -170], east: [170, 340], south: [-90, 90], rim: [640, 980] } as const;

/** 0..1 weights of the west, middle and east columns and the southern row at (x, z). */
function districtWeights(x: number, z: number): { west: number; mid: number; east: number; south: number; inside: number } {
  const west = 1 - smooth(SKY_BLEND.west[0], SKY_BLEND.west[1], x), east = smooth(SKY_BLEND.east[0], SKY_BLEND.east[1], x);
  return { west, mid: 1 - west - east, east, south: smooth(SKY_BLEND.south[0], SKY_BLEND.south[1], z), inside: 1 - smooth(SKY_BLEND.rim[0], SKY_BLEND.rim[1], Math.max(Math.abs(x), Math.abs(z))) };
}
const skyTint = (id: number): [number, number, number] => {
  const [r, g, b] = SKY_DISTRICT_COLORS[id], k = SKY_DISTRICT_GLOW[id] / 255;
  return [r * k, g * k, b * k];
};
/** The light the districts throw on the deck over (x, z), linear RGB 0..1 (the shader's twin). */
export function districtSkyLight(x: number, z: number): [number, number, number] {
  const w = districtWeights(x, z), out: [number, number, number] = [0, 0, 0];
  const north = [skyTint(0), skyTint(1), skyTint(2)], southRow = [skyTint(3), skyTint(4), skyTint(5)], column = [w.west, w.mid, w.east];
  for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[k] += column[c] * (north[c][k] * (1 - w.south) + southRow[c][k] * w.south);
  return [out[0] * w.inside, out[1] * w.inside, out[2] * w.inside];
}
const vec3 = (c: readonly number[]): string => `vec3(${c.map(v => v.toFixed(4)).join(", ")})`;
const f = (v: number): string => v.toFixed(1);
/** GLSL statements that set the vec3 `target` to districtSkyLight(q.x, q.y) (q a vec2 world xz).
 * Statements, not a function, so the sky dome can splice it into its own branch. */
export function districtSkyLightGlsl(q: string, target: string): string {
  return `{
      float dWest = 1.0 - smoothstep(${f(SKY_BLEND.west[0])}, ${f(SKY_BLEND.west[1])}, ${q}.x), dEast = smoothstep(${f(SKY_BLEND.east[0])}, ${f(SKY_BLEND.east[1])}, ${q}.x), dMid = 1.0 - dWest - dEast;
      ${target} = mix(${vec3(skyTint(0))} * dWest + ${vec3(skyTint(1))} * dMid + ${vec3(skyTint(2))} * dEast,
                 ${vec3(skyTint(3))} * dWest + ${vec3(skyTint(4))} * dMid + ${vec3(skyTint(5))} * dEast, smoothstep(${f(SKY_BLEND.south[0])}, ${f(SKY_BLEND.south[1])}, ${q}.y))
             * (1.0 - smoothstep(${f(SKY_BLEND.rim[0])}, ${f(SKY_BLEND.rim[1])}, max(abs(${q}.x), abs(${q}.y))));
    }`;
}

// ---- Sky agent: the data haze over the Signal Cathedral ---------------------------------------
// A faint aurora of broadcast spill: a ragged curtain on a ring round the Cathedral (world.ts
// LANDMARKS "array"), ~200-420 m up, that breathes in and out over DATA_HAZE_PERIOD seconds.
export const DATA_HAZE = { x: 480, z: -288, radius: 150, bottom: 200, top: 420 } as const;
export const DATA_HAZE_PERIOD = 26;
/** Phase of the breath: the studio clock (45 s) catches it rising, about three quarters full. */
export const DATA_HAZE_PHASE = 2.2;
/** 0.45..1: how strongly the haze glows at scene time `time` (a single slow sine: no flicker). */
export function dataHazeBreath(time: number): number {
  return 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * TAU / DATA_HAZE_PERIOD + DATA_HAZE_PHASE));
}
/** The same breath in GLSL (u_time is the scene clock). */
export const DATA_HAZE_BREATH_GLSL = `(0.45 + 0.55 * (0.5 + 0.5 * sin(u_time * ${(TAU / DATA_HAZE_PERIOD).toFixed(6)} + ${DATA_HAZE_PHASE.toFixed(3)})))`;
