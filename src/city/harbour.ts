/**
 * The harbour around the city: past the Rim Roads' outer kerb a concrete quay runs out to the
 * flood wall, and beyond it open water reaches to the edge of the draw distance on all four sides.
 * The ground program shades it (`harbourGroundGlsl`, spliced into the ground branch of
 * materials.ts) on four strips that harbour-scene.ts records around the city's street plane.
 *
 * Pure data and GLSL. Numbers that mirror other modules are restated here and checked by
 * tests/harbour.test.ts: the Rim Roads' centre lines (world.ts WORLD_EDGE), the outer kerb
 * (materials.ts, 6.6 m off a street's centre line) and the flood wall (metro-scene.ts QUAY_OUT,
 * whose quay slab, wall and lamp masts stand on this ground near the view). The lamp pools come
 * from sights.ts (the masts' spacing and the sights' lamps) and the district colours from weather.ts.
 *
 * Light at the edge (Harbour-light pass): the water is a readable dark blue-grey with a swell glyph
 * field, the sky's glow band and the districts' light mirrored into it as a broad smear, a moon
 * path on the south water, warm pools under every mast lamp (every 32 m) and the sights' lamps,
 * and a pale foam line along the wall. No texture reads and no loops are added: every pool is one
 * bounded exp, so the ground program keeps its budgets (tests/building-material.test.ts).
 *
 * Motion comfort: the water is calm. Swell periods are 7-10 s, every wave train fades to its mean
 * before a cell spans a quarter of its length (far water is a smooth tone with a fixed glyph, so
 * nothing crawls), pools drift a metre with the swell's tilt at most, and no term changes faster
 * than ~0.15 Hz. There is no per-frame hash anywhere.
 */
import { MAST_ARM, QUAY_POOLS, SHIP, WALL_MAST_STEP, WATER_POOLS, type LightPool } from "./sights.ts";
import { districtSkyLightGlsl } from "./weather.ts";

/** Rim Roads' centre lines (world.ts WORLD_EDGE). The city's street plane ends here. */
export const HARBOUR_ROAD = 768;
/** The quay begins at the Rim Roads' outer kerb, this far past their centre lines. */
export const HARBOUR_KERB = 6.6;
/** The flood wall's inner face, measured from the Rim Roads' centre lines (metro-scene.ts QUAY_OUT). */
export const HARBOUR_WALL = 32;
/** The flood wall's thickness: its pale coping line, the city's last line seen from far off. */
export const HARBOUR_COPING = 2;
/** Outer extent of the water strips (m from the centre). The fog reaches the sky at 0.97 of the
 *  largest draw distance (23 blocks, 1,472 m), i.e. by 2,196 m from the centre at the latest. */
export const HARBOUR_REACH = 2304;
/** The strips lie this far below the street plane: well clear of the metro's quay slab (top 0.05 m
 *  below the street) and its old water slab (1.7 m below), so no surfaces fight for depth. */
export const HARBOUR_LEVEL = 1;

export type HarbourZone = "city" | "quay" | "wall" | "water";
/** What the ground shader draws at (x, z): mirrors the branches of `harbourGroundGlsl`. */
export function harbourZone(x: number, z: number): HarbourZone {
  const beyond = Math.max(Math.abs(x), Math.abs(z)) - HARBOUR_ROAD;
  if (beyond <= HARBOUR_KERB) return "city";
  if (beyond < HARBOUR_WALL) return "quay";
  if (beyond < HARBOUR_WALL + HARBOUR_COPING) return "wall";
  return "water";
}

/** Axis-aligned ground strips (centre and full size, m) that tile the ring between the city's
 *  street plane (|x|, |z| <= HARBOUR_ROAD) and HARBOUR_REACH without overlapping it or each other. */
export interface HarbourStrip { x: number; z: number; width: number; depth: number }
export const HARBOUR_STRIPS: readonly HarbourStrip[] = (() => {
  const inner = HARBOUR_ROAD, outer = HARBOUR_REACH, middle = (inner + outer) / 2, span = outer - inner;
  return [
    { x: 0, z: -middle, width: outer * 2, depth: span },
    { x: 0, z: middle, width: outer * 2, depth: span },
    { x: -middle, z: 0, width: span, depth: inner * 2 },
    { x: middle, z: 0, width: span, depth: inner * 2 },
  ];
})();

const f = (n: number): string => { const v = Math.round(n * 1000) / 1000; return Number.isInteger(v) ? `${v}.0` : `${v}`; };

/** The base tone of open water (linear RGB, before the mirror and the lights): a dark blue-grey.
 *  With the mirrored glow and the city's spill the near water comes out ~3-4x the old near-black
 *  (OLD_WATER_DEEP), still darker than the asphalt (materials.ts road tone 0.047, 0.062, 0.068). */
export const WATER_DEEP: readonly [number, number, number] = [0.02, 0.038, 0.05];
export const OLD_WATER_DEEP: readonly [number, number, number] = [0.006, 0.015, 0.021];
/** Mast lamp pools: colour at the centre and the 1/e radius (m), on the quay and on the water. */
export const MAST_POOL = { quay: { color: [0.2, 0.13, 0.06], radius: 4.5 }, water: { color: [0.22, 0.15, 0.075], radius: 3.8 } } as const;

/** GLSL adding each pool's light to `target` at `at` (a vec2 world-xz expression), skipped past 3 radii. */
function poolsGlsl(pools: readonly LightPool[], at: string, target: string): string {
  return pools.map(pool => `
      { vec2 poolD = ${at} - vec2(${f(pool.x)}, ${f(pool.z)}); if (max(abs(poolD.x), abs(poolD.y)) < ${f(pool.radius * 3)}) ${target} += vec3(${pool.color.map(f).join(", ")}) * exp(-dot(poolD, poolD) * ${(1 / pool.radius ** 2).toFixed(5)}); }`).join("");
}
const rgb = (c: readonly number[]): string => `vec3(${c.map(f).join(", ")})`;
const inverseSquare = (radius: number): string => (1 / radius ** 2).toFixed(5);
/** A mast pool's profile along the wall, exp(-x^2 / r^2), averaged over one mast spacing: what it
 *  settles to far off, where a cell spans metres and the 32 m rhythm would otherwise alias. */
const alongAverage = (radius: number): string => (Math.sqrt(Math.PI) * radius / WALL_MAST_STEP).toFixed(4);

/**
 * One ground cell of the harbour, as a GLSL block for the ground branch of the city material. In
 * scope there: p, view, cellWorld, code, thin, paper, ink, flags, reflectedGlyph, u_time, u_rain,
 * the reflection samplers (under REFLECTIONS), and `quayStroke`: strokeFor(max(|x|, |z|)) measured
 * in uniform control flow (this block runs in a branch, where derivatives are not defined).
 */
export function harbourGroundGlsl(): string {
  return `
    float beyond = max(abs(p.x), abs(p.z)) - ${f(HARBOUR_ROAD)};
    float alongQuay = abs(p.x) > abs(p.z) ? p.z : p.x;
    float quayNear = 1.0 - smoothstep(0.2, 1.2, cellWorld);
    int quayLine = quayStroke == A_DASH ? A_EQ : quayStroke;
    // The flood wall's lamp masts stand every ${WALL_MAST_STEP} m along it (sights.ts WALL_MAST_ALONG; none past
    // the corners), each with a crossarm lamp ${MAST_ARM} m inland over the quay and one as far out over the water.
    float mastOffset = alongQuay - ${f(WALL_MAST_STEP)} * floor(alongQuay / ${f(WALL_MAST_STEP)} + 0.5);
    float onWall = 1.0 - step(${f(HARBOUR_ROAD + WALL_MAST_STEP / 2)}, abs(alongQuay));
    // Far off (a cell spanning metres) each mast's light settles to its average along the wall.
    float mastFar = smoothstep(3.0, 8.0, cellWorld);
    if (beyond < ${f(HARBOUR_WALL)}) {
      // Quay apron: 4 x 6 m concrete pours, each a slightly different tone (gone before a slab
      // shrinks to a cell), with wide salt stains and an amber safety line inside the flood wall.
      vec2 slab = vec2((beyond - ${f(HARBOUR_KERB)}) / 4.0, alongQuay / 6.0);
      float joint = max(prefilteredBand(slab.x, 0.0, 0.04, cellWorld / 4.0), prefilteredBand(slab.y, 0.0, 0.03, cellWorld / 6.0));
      float pour = 1.0 + (hash(floor(slab) + 13.0) - 0.5) * 0.16 * (1.0 - smoothstep(0.3, 1.0, cellWorld));
      float stain = mix(0.5, noise2(p.xz * 0.12 + 5.0), 1.0 - smoothstep(2.0, 5.0, cellWorld));
      vec3 albedo = vec3(0.125, 0.13, 0.126) * pour * (1.0 - 0.28 * joint) * (1.0 - 0.2 * stain);
      float safety = (1.0 - smoothstep(0.22, 0.32, abs(beyond - ${f(HARBOUR_WALL - 1.5)}))) * (1.0 - smoothstep(0.2, 0.4, cellWorld));
      vec3 lit3 = lighting(p, vec3(0, -1, 0), albedo, u_rain * 0.6);
      // Lamp light on the concrete: a warm pool under every mast's inland lamp and the sights'
      // floodlights (sights.ts QUAY_POOLS: the cranes' jibs, the gangway and barrier stairs).
      float quayAcross = beyond - ${f(HARBOUR_WALL + HARBOUR_COPING / 2 - MAST_ARM)};
      float quayAlong = mix(exp(-mastOffset * mastOffset * ${inverseSquare(MAST_POOL.quay.radius)}), ${alongAverage(MAST_POOL.quay.radius)}, mastFar);
      vec3 quayLight = ${rgb(MAST_POOL.quay.color)} * quayAlong * exp(-quayAcross * quayAcross * ${inverseSquare(MAST_POOL.quay.radius)}) * onWall;${poolsGlsl(QUAY_POOLS, "p.xz", "quayLight")}
      paper = lit3 * mix(0.8, 0.6, quayNear) + safety * vec3(0.15, 0.1, 0.022) + quayLight * (0.6 + 2.4 * albedo.g);
      thin = true;
      if (safety > 0.4) { code = quayLine; thin = false; ink = vec3(0.5, 0.35, 0.1) + paper; }
      else if (joint > 0.35 && cellWorld < 0.12) { code = A_PLUS; ink = paper * 1.5 + vec3(0.016, 0.02, 0.02); }
      else { code = cellWorld < 0.3 ? A_SPACE : cellWorld < 1.4 ? A_DOT : A_SPACE; ink = paper * mix(1.3, 1.6, quayNear); }
    } else if (beyond < ${f(HARBOUR_WALL + HARBOUR_COPING)}) {
      // The flood wall's coping: a steady pale line (the wall itself stands here near the view),
      // warmed at the foot of every lamp mast, so from far off the wall reads as a lit rhythm.
      float mastFoot = mix(exp(-mastOffset * mastOffset * ${inverseSquare(4)}), ${alongAverage(4)}, mastFar) * onWall;
      paper = vec3(0.07, 0.08, 0.078) + vec3(0.1, 0.066, 0.032) * mastFoot;
      code = quayLine; ink = vec3(0.3, 0.34, 0.32) + vec3(0.3, 0.2, 0.08) * mastFoot;
    } else {
      float sea = beyond - ${f(HARBOUR_WALL + HARBOUR_COPING)};
      vec2 q = p.xz;
      float grazing = 1.0 - clamp(abs(view.y), 0.0, 1.0);
      vec3 mirrorDir = reflect(view, vec3(0, -1, 0));
      // Swell: three long wave trains (28, 20 and 13 m; 10, 8.7 and 7.5 s). Each fades to its mean
      // before a cell spans a quarter of its length, so far water is calm, never a crawling pattern.
      float a1 = dot(q, vec2(0.21, 0.09)) - u_time * 0.63;
      float a2 = dot(q, vec2(-0.11, 0.3)) - u_time * 0.72 + 1.7;
      float a3 = dot(q, vec2(0.41, -0.27)) - u_time * 0.84 + 4.1;
      float f1 = 1.0 - smoothstep(4.0, 7.0, cellWorld), f2 = 1.0 - smoothstep(2.8, 5.0, cellWorld), f3 = 1.0 - smoothstep(1.8, 3.2, cellWorld);
      float swell = 0.5 * sin(a1) * f1 + 0.32 * sin(a2) * f2 + 0.18 * sin(a3) * f3;
      float tilt = 0.5 * cos(a1) * f1 + 0.32 * cos(a2) * f2;
      float crest = mix(0.35, smoothstep(0.1, 0.6, swell), f2);
      // Fresnel: looking down into it the water is dark; toward the horizon it is a mirror.
      float fresnel = 0.24 + 0.6 * pow(grazing, 5.0);
      vec3 mirrorPaper = skyColor(mirrorDir) * 1.3, mirrorInk = mirrorPaper * 1.5;
      bool mirrored = false;
      float lightLevel = 0.0;
#ifdef REFLECTIONS
      // The mirrored scene (the rain reflection pass): reflections lean a cell with the swell, slowly,
      // and every bright light stretches into a column (the strongest of a few samples above and
      // below), the way lights smear across a harbour at night.
      ivec2 size = textureSize(u_reflectionInk, 0);
      ivec2 texel = ivec2(clamp(gl_FragCoord.xy + vec2(floor(tilt * 1.2 + 0.5), 0.0), vec2(0), vec2(size) - 1.0));
      texel.x = size.x - 1 - texel.x;
      vec3 rInk = texelFetch(u_reflectionInk, texel, 0).rgb, rPaper = texelFetch(u_reflectionPaper, texel, 0).rgb;
      if (dot(rInk + rPaper, vec3(1)) > 0.003) {
        mirrored = true;
        vec3 column = vec3(0);
        for (int k = 1; k <= 2; k++) {
          float fade = 1.0 - float(k) * 0.3;
          column = max(column, texelFetch(u_reflectionInk, ivec2(texel.x, min(texel.y + k * 2, size.y - 1)), 0).rgb * fade);
          column = max(column, texelFetch(u_reflectionInk, ivec2(texel.x, max(texel.y - k * 2, 0)), 0).rgb * fade);
        }
        mirrorPaper = rPaper * vec3(0.7, 0.84, 0.94) + column * 0.16;
        mirrorInk = max(rInk, column * 0.8) * vec3(0.74, 0.86, 0.94);
        lightLevel = max(luma(rInk), luma(column) * 0.8);
        if (luma(rInk) > 0.14 && cellWorld < 6.0) { reflectedGlyph = texelFetch(u_reflectionGlyph, texel, 0).rgb; flags = 4.0; }
      }
#endif
      // Moonlight (the sky's moon: normalize(0.3, -0.38, 0.87)): a bright path on the south water,
      // broken by the swell crests close in, a soft column far out where the swell has settled.
      vec3 moonDir = normalize(vec3(0.3, -0.38, 0.87));
      float moonAz = dot(normalize(mirrorDir.xz + vec2(1e-5)), normalize(moonDir.xz));
      float moonRise = (mirrorDir.y - moonDir.y) * 2.2;
      float moonlight = exp((moonAz - 1.0) * 200.0) * exp(-moonRise * moonRise) * (0.35 + 0.65 * crest);
      // The skyline's glow mirrored as a broad vertical smear: the sky's sodium horizon and the
      // districts' own colours along the mirrored bearing (the sky dome's skyline glow, weather.ts),
      // drawn down the water by the swell, strongest toward the horizon.
      float mirrorUp = max(-mirrorDir.y, 0.0);
      vec2 glowAt = eye.xz + normalize(mirrorDir.xz + vec2(1e-5)) * 420.0;
      vec3 skylineGlow = vec3(0);
      ${districtSkyLightGlsl("glowAt", "skylineGlow")}
      vec3 glowSmear = (vec3(0.05, 0.03, 0.017) + skylineGlow * 0.09) * exp(-mirrorUp * 4.0) * (0.8 + 0.2 * swell);
      // The city's light spilling over the flood wall onto the near water in the colour of the
      // district behind it (weather.ts), a neon violet drift in places (~300 m along the quay),
      // strongest at the wall and fading over ~90 m.
      vec2 coastAt = clamp(p.xz, vec2(-600.0), vec2(600.0));
      vec3 coastLight = vec3(0);
      ${districtSkyLightGlsl("coastAt", "coastLight")}
      float coast = smoothstep(0.35, 0.75, noise2(vec2(alongQuay * 0.0033, 2.0)));
      vec3 spill = mix(coastLight * 0.05, vec3(0.034, 0.014, 0.04), coast * 0.5) * exp(-sea / 90.0) * (0.85 + 0.15 * swell);
      // Lamp pools: a soft disc under every mast's sea-side lamp and under the sights' lamps
      // (sights.ts WATER_POOLS), each riding the swell (drifting under a metre with its tilt).
      vec2 ride = vec2(0.5, 0.35) * tilt;
      float poolAlong = mastOffset + ride.x, poolAcross = sea - ${f(MAST_ARM - HARBOUR_COPING / 2 + 0.8)} + ride.y;
      poolAlong = mix(exp(-poolAlong * poolAlong * ${inverseSquare(MAST_POOL.water.radius)}), ${alongAverage(MAST_POOL.water.radius)}, mastFar);
      vec3 pools = ${rgb(MAST_POOL.water.color)} * poolAlong * exp(-poolAcross * poolAcross * ${inverseSquare(MAST_POOL.water.radius)}) * onWall;${poolsGlsl(WATER_POOLS, "(p.xz + ride)", "pools")}
      // The Nami Maru's portholes and deck lights spill on the water along her hull.
      vec2 hullD = max(abs(p.xz + ride - vec2(${f(SHIP.x + (SHIP.bow + SHIP.stern) / 2)}, ${f(SHIP.z)})) - vec2(${f((SHIP.bow - SHIP.stern) / 2)}, ${f(SHIP.beam / 2)}), 0.0);
      pools += vec3(0.08, 0.062, 0.036) * exp(-length(hullD) * 0.22);
      float lampLight = luma(pools);
      // WATER_DEEP is an albedo like the quay's: it goes through the same lighting() (ambient, the
      // lamps, the headlights) so the water sits in the same exposure as the asphalt instead of
      // reading as black next to it; the glow smear and the coast spill are scaled to match.
      // (x2.4 after lighting: no lamps reach open water, and a sheet of water at night still carries
      // the whole sky's glow, which the street does not.)
      vec3 deep = lighting(p, vec3(0, -1, 0), ${rgb(WATER_DEEP)} * (1.0 + 0.22 * swell), 0.0) * 2.4;
      paper = mix(deep, mirrorPaper, fresnel * (0.88 + 0.12 * swell)) + spill * 3.0 + glowSmear * (1.4 + 3.0 * fresnel)
            + moonlight * vec3(0.09, 0.1, 0.115) + pools * (0.9 + 0.1 * swell);
      ink = mix(paper * 1.7, mirrorInk, mirrored ? fresnel : 0.25) + vec3(0.012, 0.024, 0.032) + spill * 1.5 + pools * 0.8;
      // Foam: a pale line along the foot of the wall, breathing over ~12 s. Far off it widens to at
      // least a cell (dimmed to match), so it never thins to a flickering thread.
      float foamWidth = 1.6 + cellWorld;
      float foam = (1.0 - smoothstep(0.2, foamWidth, sea)) * (1.6 / foamWidth) * (0.72 + 0.28 * sin(u_time * 0.5 + alongQuay * 0.15));
      paper += foam * vec3(0.05, 0.065, 0.07);
      if (flags == 0.0) {
        thin = true;
        if (moonlight > 0.2 && crest > 0.4) { code = crest > 0.75 ? A_TILDE : A_DASH; ink = paper + vec3(0.42, 0.46, 0.52) * moonlight; }
        // Lamp pools glitter on the crests (the glyph follows the slow swell, never a per-frame hash).
        else if (lampLight > 0.035 && crest > 0.3) { code = crest > 0.7 ? A_TILDE : A_DASH; ink = paper * 1.4 + pools * 2.2; }
        else if (lightLevel > 0.07) { code = A_DASH; ink = max(ink, mirrorInk * 1.2); }
        else if (foam > 0.45) { code = A_TILDE; ink = paper * 1.3 + vec3(0.2, 0.24, 0.26) * foam; }
        // The swell's glyph field: crests '~', the slopes '-', the troughs '.', every feature metres
        // (several cells) across; mid-distance only crests and strokes.
        else if (cellWorld < 1.1) { code = swell > 0.42 ? A_TILDE : swell > 0.06 || tilt > 0.3 ? A_DASH : A_DOT; ink = max(ink, paper * 1.8 + vec3(0.01, 0.018, 0.022)) + crest * vec3(0.01, 0.016, 0.02); }
        else if (cellWorld < 2.6) { code = swell > 0.25 ? A_TILDE : A_DASH; ink = max(ink, paper * 1.7 + vec3(0.008, 0.015, 0.018)); }
        // Far out: a fixed field of faint strokes (a steady glyph cannot crawl), the tone does the rest.
        else { code = A_DASH; ink = mix(paper, ink, 0.55) * 1.3; }
      }
    }
`;
}
