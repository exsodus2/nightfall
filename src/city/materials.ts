import { densityRamp } from "./atlas.ts";
import { MESSAGE_ROW, MINI_FONT_OFFSET } from "./scene-data.ts";
import { MESSAGES } from "./messages.ts";
// Signs: a buzzing sign's short-out cycle, shared with its spark bursts (vfx.ts).
import { SIGN_SHORT } from "./vfx.ts";
// VFX agent: SURFACE 8 (wheels, steam, searchlights) lives in vfx-shaders.ts, spliced in below.
import { VFX_GLSL_BRANCH, VFX_GLSL_DECLARATIONS } from "./vfx-shaders.ts";
// Park agent: Rootwood Park's ground (`parkGround`, used by the SURFACE < 1.5 branch) is generated
// from the park layout constants in park.ts.
import { parkGlsl as parkSource } from "./park.ts";
// Compile time: the park's constant-bound loops stay loops (rule 1 below, keepLoops).
const parkGlsl = () => keepLoops(parkSource());
// Ground agent: the harbour's quay and water (`harbourGroundGlsl`, spliced into the ground branch).
import { HARBOUR_KERB, HARBOUR_ROAD, harbourGroundGlsl } from "./harbour.ts";
// Weather agent: the slow weather cycle in GLSL (weatherRain, sheetLightning), a function of u_time.
import { DATA_HAZE, DATA_HAZE_BREATH_GLSL, WEATHER_GLSL, districtSkyLightGlsl } from "./weather.ts"; // Sky agent: district deck light, Cathedral haze

/*
 * SHADER COMPILE TIME - rules for everyone editing GLSL here (measured 2026-10-21 on ANGLE/D3D11).
 * Each city program costs two fxc compiles on a cold visit. The link (in parallel, shader-prewarm.ts)
 * compiles the fragment for o_character alone, so the colour math is dead code there and cheap. The
 * first draw into the three-attachment target recompiles it with all three outputs live, one program
 * after another on the GPU thread: that second compile was ~3/4 of the wait (first draws in Chrome
 * before -> after rule 1: ground 12.8 -> 3.1 s, city 6.8 -> 4.1, facade 6.3 -> 3.3, props 2.1 -> 0.3;
 * holograms 5.4 -> 2.2 s in the native ANGLE harness). Link-only numbers hide it;
 * `scripts/shader-startup-check.mjs --compare...` reports firstDrawMs as well.
 * 1. fxc unrolls every loop whose trip count it can see, and unrolled bodies multiply (the park's 19
 *    path boxes each holding a loop, atmosphere()'s 12 steps x 4 cars, lighting()'s 8 lights x 10
 *    shadow boxes). A loop with no screen derivatives in it (no fwidth/dFdx/dFdy/band()/texture())
 *    takes its bound as KEEP_LOOP(n): the same n plus a uniform nobody sets (GL zero-initializes
 *    uniforms), so it stays a loop. That cut the first draws by 40-85% with identical maths.
 *    GLSL spliced in from other modules goes through keepLoops() (park.ts today).
 * 2. Loops with derivatives inside stay constant (fxc must unroll them). textCoverage's 4 taps also
 *    stay constant: as a loop its inlined `k % int(wrap)` with wrap = 0.0 fails as a divide by zero.
 * 3. Every call is inlined, so a big helper (lighting, textGlyphD, skyColor) costs once per call site.
 * 4. Folded branches (on() -> `if (false)`) and functions they alone call are removed by ANGLE before
 *    fxc runs (checked in the translated HLSL), so SURFACES specialization is real, not a hint.
 * 5. Small constant loops that only fetch (the k <= 2 reflection smears) gained nothing as loops.
 */

/** First scene-data texel of the glyph table: 95 bold ASCII glyphs, then 95 thin ones. */
export const GLYPH_TABLE = 48;

const codes = (ramp: string[]) => ramp.map(c => c.charCodeAt(0)).join(", ");
const BOLD_RAMP = densityRamp(" .:-=+*#%@");
const THIN_RAMP = densityRamp(" .,:;-~=+*", true);
// Named ASCII codes so the GLSL below reads as the characters it draws.
const NAMED: Record<string, string> = {
  SPACE: " ", DOT: ".", COMMA: ",", COLON: ":", SEMI: ";", DASH: "-", UNDER: "_", EQ: "=", PLUS: "+", STAR: "*",
  HASH: "#", AT: "@", PCT: "%", AMP: "&", SLASH: "/", BSLASH: "\\", PIPE: "|", LBR: "[", RBR: "]", QUOTE: "'",
  TICK: "`", EXCL: "!", TILDE: "~", LT: "<", GT: ">", CARET: "^", O: "o", X: "x", DOLLAR: "$", EIGHT: "8",
  CAPB: "B", CAPM: "M", CAPO: "O", CAPW: "W", CAPH: "H", ZERO: "0", ONE: "1", I: "i", LPAR: "(", RPAR: ")", CAPY: "Y",
};
const ASCII_DEFINES = Object.entries(NAMED).map(([name, c]) => `#define A_${name} ${c.charCodeAt(0)}`).join("\n");

/**
 * The city's native ASCII material. One fragment is one character cell. Tone lives mostly in the
 * paper (cell) colour so masses read solid; the glyph is always a real ASCII character chosen for
 * structure: strokes that follow each face's perspective, bold outlines on edges, bracketed lit
 * windows, points of light far away, and text - signs, corner-wrapping tickers and holograms are
 * rendered from an 8x8 font texture, as the characters themselves when small on screen and as
 * ASCII-art letters built from characters when large. Fog fades into the sky colour of the same
 * direction and reaches it exactly at the draw distance, so nothing pops at the edge of the world.
 */
/** Surface ids (SURFACE / u_surface) a material variant can draw. Every branch the variant never
 * needs is compiled out (`if (false)`), which keeps shader compile time - the longest part of the
 * first visit - proportional to what the pass actually draws. Both the link and the first draw
 * (where ANGLE/D3D11 and the driver finish the program) grow faster than the source, so the big
 * families are separate programs and engine.ts switches between them (one batch flush per switch):
 * the ground (GROUND_MATERIAL, main pass only, with the park and the puddle reflections); props,
 * signs, sky, screens and VFX (CITY_MATERIAL, shared by the main and the mirrored pass); the
 * holograms (HOLOGRAM_MATERIAL, both passes); the prop batch only lit props; the building batch
 * (FACADE_MATERIAL) facades and tickers; the reference renderer (`?reference=1`) everything. */
export const SURFACES = {
  all: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  ground: [1],
  scene: [2, 3, 4, 5, 8],
  hologram: [7],
  props: [2],
} as const satisfies Record<string, readonly number[]>;

export function cityMaterial({ reflections = false, batch = false, opaque = false, lite = false, architecture = false, ground = true, surfaces = SURFACES.all as readonly number[] } = {}): string {
  const includesGround = ground && !architecture;
  // Branch conditions: a surface the variant never draws folds to `false`, so its code is compiled out.
  const drawn = new Set<number>(architecture ? [0, 6] : surfaces);
  const on = (surface: number, test: string) => drawn.has(surface) ? test : "false";
  // An opaque variant (buildings) contains no discard at all, so early depth rejection stays on.
  // Mobile (iPhone agent): `lite` is compiled on touch-first devices only (desktop output is unchanged):
  // a sin-free hash and a 6-step atmosphere integration with 2 headlight beams instead of 12 / 4.
  return withDiscard(opaque, `#version 300 es
precision highp float;
precision highp int;
${reflections ? "#define REFLECTIONS" : ""}
${batch ? "#define BATCH" : ""}
${lite ? "#define LITE" : ""}
${includesGround ? "#define GROUND" : ""}
${drawn.has(7) ? "#define HOLOGRAMS" : ""}
#ifdef LITE
#define ATMOSPHERE_STEPS 6
#define ATMOSPHERE_CARS 2
#else
#define ATMOSPHERE_STEPS 12
#define ATMOSPHERE_CARS 4
#endif
in vec3 v_worldPosition;
in vec2 v_uv;
in vec3 v_glyphIndex;
in vec4 v_glyphColor;
in vec4 v_cellColor;
in vec4 v_glyphFlags;
#ifdef BATCH
flat in float v_surface;
flat in vec3 v_center;
flat in vec3 v_dims;
#define SURFACE v_surface
#else
uniform float u_surface;
#define SURFACE u_surface
#endif
uniform highp sampler2D u_scene;
uniform highp sampler2D u_text;
uniform float u_mirror, u_time, u_rain, u_atmosphere, u_viewRadius, u_fadeIn;
uniform sampler2D u_feedGlyph, u_feedInk, u_feedPaper;
uniform float u_text0, u_text1, u_text2, u_text3, u_textLength, u_vertical, u_signSeed, u_signSpan;
uniform float u_holoRow, u_holoSeed;
uniform vec3 u_holoTint, u_holoTint2;
// Compile time (rule 1 at the top of materials.ts): never set, so always 0. A loop bounded by
// KEEP_LOOP(n) runs n times like before but fxc cannot unroll it.
uniform int u_keepLoop;
#define KEEP_LOOP(n) ((n) + u_keepLoop)
#ifdef REFLECTIONS
uniform sampler2D u_reflectionInk, u_reflectionPaper, u_reflectionGlyph;
// REFLECT: wet-road tunables (ground branch). Fresnel floor/exponent over grazing = 1 - |view.y|;
// reflectivity of plain wet asphalt vs a puddle; the luminance knee that picks light sources out of
// the mirrored scene (diffuse surfaces keep WET_DIFFUSE); the streak tap step in rows (taps at
// 0, +-STEP, +-2 STEP); how much the wet road darkens; the streak's share in paper vs ink; and the
// streak level where '.' starts and where ':' becomes '|'.
#define WET_FRESNEL_MIN 0.1
#define WET_FRESNEL_POW 3.0
#define WET_ASPHALT 0.24
#define WET_PUDDLE 1.0
#define WET_DIFFUSE 0.08
#define WET_KNEE_LO 0.35
#define WET_KNEE_HI 0.85
#define WET_STEP 2
#define WET_DARKEN 0.25
#define WET_PAPER 0.45
#define WET_INK 2.2
#define WET_GLYPH_MIN 0.045
#define WET_GLYPH_BAR 0.16
#endif
layout(location=0) out vec4 o_character;
layout(location=1) out vec4 o_primaryColor;
layout(location=2) out vec4 o_secondaryColor;
${ASCII_DEFINES}
const int BOLD_RAMP[${BOLD_RAMP.length}] = int[${BOLD_RAMP.length}](${codes(BOLD_RAMP)});
const int THIN_RAMP[${THIN_RAMP.length}] = int[${THIN_RAMP.length}](${codes(THIN_RAMP)});
const int MESSAGE_ROW = ${MESSAGE_ROW}, MESSAGE_COUNT = ${MESSAGES.length};
const float PI = 3.14159265;

vec4 datum(int index) { return texelFetch(u_scene, ivec2(index % 16, index / 16), 0); }
vec3 asciiGlyph(int code, bool thin) { return datum(${GLYPH_TABLE} + (thin ? 95 : 0) + clamp(code, 32, 126) - 32).rgb; }
vec3 eyePosition() { return datum(36).xyz * vec3(1.0, 1.0 - u_mirror * 2.0, 1.0); }
#ifdef LITE
// Mobile: fract(sin(x) * 43758) needs an accurate sin at large x (world coordinates, window ids,
// u_time * 14 after an hour of play); low-accuracy GPU sin range reduction turns it into stripes.
// Dave Hoskins' sin-free hash stays random for every input the city feeds it.
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
#else
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
#endif
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float street(float p) { return abs(mod(p + 32.0, 64.0) - 32.0); }
float integral(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x) - a, 0.0, b - a); }
float prefilteredBand(float coordinate, float lower, float upper, float footprint) {
  float width = max(footprint, 0.003);
  return clamp((integral(coordinate + width * 0.5, lower, upper) - integral(coordinate - width * 0.5, lower, upper)) / width, 0.0, 1.0);
}
// Coverage of the periodic band [a,b) over this cell's footprint: stable under motion.
float band(float x, float a, float b) {
  return prefilteredBand(x, a, b, fwidth(x));
}
// Ordered dither threshold of this cell, for dissolves that do not shimmer.
float bayer(vec2 cell) {
  ivec2 q = ivec2(mod(floor(cell), 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[q.y * 4 + q.x]) + 0.5) / 16.0;
}
int boldRamp(float tone) { return BOLD_RAMP[clamp(int(tone * float(BOLD_RAMP.length())), 0, BOLD_RAMP.length() - 1)]; }
int thinRamp(float tone) { return THIN_RAMP[clamp(int(tone * float(THIN_RAMP.length())), 0, THIN_RAMP.length() - 1)]; }
// On-screen direction of the iso-lines of a world coordinate, as the ASCII stroke that draws it.
int strokeFor(float coordinate) {
  vec2 g = vec2(dFdx(coordinate), dFdy(coordinate));
  if (dot(g, g) < 1e-10) return A_DASH;
  float a = mod(atan(g.y, g.x) + PI * 0.5, PI);
  int bin = int(floor(a / PI * 4.0 + 0.5)) % 4;
  return bin == 0 ? A_DASH : bin == 1 ? A_SLASH : bin == 2 ? A_PIPE : A_BSLASH;
}

// ---- Text: an 8x8 ASCII font and a message table in u_text --------------------------------
// Sign panels (signage.ts signStyle): format + 8 x look. Format 0 classic, 1 boxed shop sign with
// a logo, 2 back-lit panel, 3 LED matrix ticker, 4 small insert; look 0 neutral or district + 1.
uniform float u_signStyle;
int textByte(int x, int row) { return int(texelFetch(u_text, ivec2(x, row), 0).r * 255.0 + 0.5); }
int fontBit(int code, int x, int y) {
  int i = (clamp(code, 32, 126) - 32) * 8 + clamp(y, 0, 7);
  return (textByte(i % 64, i / 64) >> (7 - clamp(x, 0, 7))) & 1;
}
// Sign text arrives packed as 6-bit codes (space, A-Z, 0-9) in up to four floats (16 letters;
// u_text3 is read only when u_textLength > 12, so senders of 12 letters need not set it).
int packedChar(int k) {
  if (k < 0 || float(k) >= u_textLength) return A_SPACE;
  uint packed = uint(k < 4 ? u_text0 : k < 8 ? u_text1 : k < 12 ? u_text2 : u_text3);
  int c = int((packed >> uint((k % 4) * 6)) & 63u);
  return c == 0 ? 32 : c <= 26 ? 64 + c : 48 + c - 27;
}
int messageChar(int row, int k) {
  int len = max(1, textByte(0, row)), period = len + 5, i = k % period;
  if (i < 0) i += period;
  return i >= len ? A_SPACE : textByte(1 + i, row);
}
// Market colour class (0 neutral, 1 up, 2 down) of message character k: the class rows follow
// the message rows in the text texture, see scene-data.ts TextData.
int messageClass(int row, int k) {
  int len = max(1, textByte(0, row)), period = len + 5, i = k % period;
  if (i < 0) i += period;
  return i >= len ? 0 : textByte(1 + i, row + MESSAGE_COUNT);
}
// LED feeds (sign format 3): row FEED_ROW + m runs the message table end to end from message m,
// each message in a fixed FEED_SLOT-letter stretch: its words, then a short run of '>' chevrons.
const int FEED_ROW = 4096, FEED_SLOT = 66;
int feedChar(int start, int k) {
  k = max(k, 0);
  int m = k / FEED_SLOT, row = MESSAGE_ROW + (start + m) % MESSAGE_COUNT, i = k - m * FEED_SLOT;
  int len = max(1, textByte(0, row)), gap = i - len;
  if (gap < 0) return textByte(1 + i, row);
  return gap >= 3 && FEED_SLOT - i > 3 && gap % 3 == 0 ? A_GT : A_SPACE;
}
int textCode(vec2 lc, int row, float wrap) {
  int k = int(floor(lc.x));
  if (wrap > 0.0) { k = k % int(wrap); if (k < 0) k += int(wrap); }
  return row < 0 ? packedChar(k) : row >= FEED_ROW ? feedChar(row - FEED_ROW, k) : messageChar(row, k);
}
// 3x5 face: font pixel (x, y) of a glyph, drawn as solid blocks when letters are 5-13 cells tall.
int miniBit(int code, int x, int y) {
  int i = ${MINI_FONT_OFFSET} + (clamp(code, 32, 126) - 32) * 2;
  int bits = textByte(i % 64, i / 64) | (textByte((i + 1) % 64, (i + 1) / 64) << 8);
  return (bits >> (14 - (clamp(y, 0, 4) * 3 + clamp(x, 0, 2)))) & 1;
}
float letterInk(int code, vec2 f) {
  if (code == A_SPACE || f.y < 0.0 || f.y >= 1.0) return 0.0;
  return float(fontBit(code, int(fract(f.x) * 8.0), int(f.y * 8.0)));
}
// Letter-space coordinates: x counts letters, y runs 0..1 down one letter. Supersampled over the
// cell footprint so large text resolves into clean ASCII-art letters rather than aliasing noise.
float textCoverage(vec2 lc, vec2 dx, vec2 dy, int row, float wrap) {
  float c = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 q = lc + dx * (i % 2 == 0 ? -0.25 : 0.25) + dy * (i < 2 ? -0.25 : 0.25);
    c += letterInk(textCode(q, row, wrap), q);
  }
  return c * 0.25;
}
// Picks the character for a text cell. Small letters are written as one real character centred
// on their slot (a readable row, like a terminal); from ~5 cells tall they are drawn in a 3x5 face
// of solid '#' blocks; from ~13 cells as 8x8 ASCII art made of the letter itself, edges thin.
// dx/dy: the per-cell change of lc. Callers whose lc jumps between letters (vertical signs
// stack letters with floor/fract) pass derivatives of the continuous coordinate instead: dFdx
// across the jump is huge, and the samples and size tier on that row then picked stray pieces of
// other letters - broken lines between letters.
// tier: -1 lets each letter pick its own face (below); 0 / 1 / 2 force one face - one character,
// the 3x5 block face, 8x8 ASCII art - for the whole text (shop signs decide once per sign).
int textGlyphTier(vec2 lc, vec2 dx, vec2 dy, int row, float wrap, int tier, out float cover, out bool thinGlyph) {
  thinGlyph = false;
  // Per-cell step of each letter axis along the screen axis it mostly follows: one whole cell
  // moves the coordinate by exactly this much, so an offset divided by it counts cells. (The
  // gradient length overestimates the step on slanted text and lit two cells per slot.)
  float stepX = max(max(abs(dx.x), abs(dy.x)), 1e-4), stepY = max(max(abs(dx.y), abs(dy.y)), 1e-4);
  float letterCells = 1.0 / stepY, slotCells = 1.0 / stepX;
  int code = textCode(lc, row, wrap);
  // Screen offset from this cell to its letter slot's centre, in cells (the one-character tier
  // lights the one cell that contains the slot centre). The full inverse of the cell->letter map:
  // dividing each letter axis by its own step only holds while the text is screen-aligned. Seen
  // at a grazing angle the letter rows slant and recede, each letter axis moves along both screen
  // axes, and the per-axis window spanned two cells along the slant - every letter drawn twice,
  // side by side or stacked. Every point lies in exactly one cell, so this lights exactly one
  // cell per slot (no doubled "MM" pairs) whatever the slant; slots narrower than a cell keep the
  // cell their centre falls in, and the choice only moves by whole cells.
  float jac = dx.x * dy.y - dy.x * dx.y;
  vec2 toSlot = vec2(floor(lc.x) + 0.5 - lc.x, 0.5 - lc.y);
  vec2 fromCentre = abs(jac) > 1e-9 ? vec2(dy.y * toSlot.x - dy.x * toSlot.y, dx.x * toSlot.y - dx.y * toSlot.x) / jac : vec2(1e4);
  // Tier boundaries dissolve instead of popping, a letter at a time: each letter slot has its own
  // threshold, so walking toward a sign its letters change face one by one over ~1.4 cells of
  // letter size (block face) and ~4 (ASCII art) - a few metres - never all at once. Per letter,
  // not per cell: a per-cell dither left signs parked at a boundary as a static mix of two faces
  // inside each letter (unreadable). The ASCII-art face waits until a font pixel spans ~2 cells.
  bool art, block;
  if (tier < 0) {
    int slot = int(floor(lc.x));
    if (wrap > 0.0) { slot = slot % int(wrap); if (slot < 0) slot += int(wrap); }
    // Signs change face as a sweep along the word (left to right, top to bottom), which reads as a
    // deliberate wipe; messages, of unknown length here, in a well-spread golden-ratio order.
    float tierJitter = (row < 0 ? (float(slot) + 0.5) / max(u_textLength, 1.0) : fract(float(slot) * 0.618 + 0.31)) - 0.5;
    float blockFrom = 5.2 + tierJitter * 1.4, artFrom = 15.5 + tierJitter * 4.0;
    // The ASCII-art face draws each letter with the letter itself, so it also needs width: squeezed
    // under ~7.5 cells across, about a cell per font pixel (a sign seen at a grazing angle) its strokes became runs of the same
    // letter side by side - "EE", "MM" - doubled text. Tall narrow letters keep the block face (or,
    // narrower still, one character).
    art = letterCells >= artFrom && slotCells >= 7.5 + tierJitter;
    block = !art && letterCells >= blockFrom && slotCells >= 4.2 + tierJitter * 0.6;
  } else { art = tier == 2; block = tier == 1; }
  if (block) {
    // Mid distance: the 3x5 face as a bitmap of solid blocks - lit pixels are a bold '#', unlit
    // ones blank - so the letter's SHAPE reads (drawn with the letter itself, an N became a pile
    // of N's that read as doubled text). Each cell takes the font pixel its centre falls in: in
    // this tier a pixel spans at least ~1.04 cells both ways (5 rows; 3 columns + 1 of spacing),
    // so none is ever skipped. Sampling the letter's own coordinate, not a per-quad cell count,
    // keeps rows from doubling where neighbouring quads' derivatives disagree (the ticker row
    // that drew its top pixel row twice). The 8x8 face's two-pixel strokes need ~13 cells.
    int col = int(floor(fract(lc.x) * 4.0)), line = int(floor(lc.y * 5.0));
    bool lit = col < 3 && lc.y >= 0.0 && line < 5 && code != A_SPACE && miniBit(code, col, line) == 1;
    cover = lit ? 1.0 : 0.0;
    return lit ? A_HASH : A_SPACE;
  }
  if (!art) {
    // Small (or too narrow for the 3x5 face): one real character per slot, in the cell that
    // contains the slot centre (floor(offset + 0.5) == 0 is half-open, so two neighbours never
    // both claim it). lc.y = -1 marks "no letter".
    bool hit = floor(fromCentre.x + 0.5) == 0.0 && floor(fromCentre.y + 0.5) == 0.0 && lc.y > -0.5;
    cover = hit && code != A_SPACE ? 1.0 : 0.0;
    return code;
  }
  cover = textCoverage(lc, dx, dy, row, wrap);
  if (cover > 0.6) return code == A_SPACE ? A_HASH : code;
  if (cover > 0.3) { thinGlyph = true; return code == A_SPACE ? A_COLON : code; }
  return A_SPACE;
}
int textGlyphD(vec2 lc, vec2 dx, vec2 dy, int row, float wrap, out float cover, out bool thinGlyph) {
  return textGlyphTier(lc, dx, dy, row, wrap, -1, cover, thinGlyph);
}
int textGlyph(vec2 lc, int row, float wrap, out float cover, out bool thinGlyph) {
  return textGlyphD(lc, dFdx(lc), dFdy(lc), row, wrap, cover, thinGlyph);
}
// The camera's focal length in cells, from the per-cell change of the view ray (rayX/rayY: dFdx/
// dFdy of the normalised eye->point direction, taken by the caller in uniform control flow): a
// pinhole camera's ray Jacobian has singular values cos^2(a)/f and cos(a)/f whatever the off-axis
// angle a, so f = s1 / s2^2 is the same in every cell on screen (as the shop signs' signLod).
float cameraFocalCells(vec3 rayX, vec3 rayY) {
  float raySum = dot(rayX, rayX) + dot(rayY, rayY), rayDet = length(cross(rayX, rayY));
  float hi = 0.5 * (sqrt(raySum + 2.0 * rayDet) + sqrt(max(raySum - 2.0 * rayDet, 0.0)));
  float lo = max(rayDet / max(hi, 1e-9), 1e-9);
  return lo / max(hi * hi, 1e-12);
}
// Whole-run legibility of a straight line of text (the signs' rule): the projected letter height
// and slot width at the run's two ends (endA/endB relative to the eye; the farther end is the
// smaller), so every cell of the run computes the same value and words never split into drawn and
// dropped letters. >= 0.5: every letter gets its own cell and is ~2.2+ cells tall; below, the run
// is drawn as a lit band / panel. Distance only - nothing here varies with time.
float textRunLod(vec3 endA, vec3 endB, vec3 letterAxis, vec3 slotAxis, float focal) {
  float distA = max(length(endA), 0.1), distB = max(length(endB), 0.1);
  vec3 viewA = endA / distA, viewB = endB / distB;
  float letterCells = focal * min(length(letterAxis - dot(letterAxis, viewA) * viewA) / distA, length(letterAxis - dot(letterAxis, viewB) * viewB) / distB);
  float slotCells = focal * min(length(slotAxis - dot(slotAxis, viewA) * viewA) / distA, length(slotAxis - dot(slotAxis, viewB) * viewB) / distB);
  return min(smoothstep(1.7, 2.7, letterCells), smoothstep(0.95, 1.45, slotCells));
}

// Shader cost: the subjects below are compiled only into variants that draw holograms (surface 7);
// the others get a stub, since the hologram branch still names holoSubject inside its folded
// if (false). Hologram helpers called directly from main() must live outside this #ifdef.
#ifdef HOLOGRAMS
// ---- Holograms: closed-form subjects ------------------------------------------------------
// Each returns an approximate signed distance in figure units (q: x across, y down, the quad's
// aspect removed; about -0.6..0.6 wide) and a 0..1 "detail" glow for features. Detail outside
// the figure (d > 0) is drawn too (chart lines, rings). No loops (the material's loop and
// texture-call budgets are fixed by tests/building-material.test.ts).
mat2 holoRot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float holoSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0));
}
float holoKoi(vec2 q, float t, out float scales) {
  vec2 k = holoRot(cos(t) * 0.5 + 1.57) * (q - vec2(sin(t) * 0.12, -0.1 + cos(t * 0.7) * 0.26));
  float fish = length(k / vec2(0.3, 0.105)) - 1.0;
  float tail = max(abs(k.y) - (k.x - 0.23) * 0.6 * (1.0 + 0.3 * sin(t * 3.0)), max(0.23 - k.x, k.x - 0.46));
  float fins = length((vec2(k.x + 0.02, abs(k.y) - 0.12)) / vec2(0.07, 0.03)) - 1.0;
  float scaleCoord = k.x * 18.0 + abs(k.y) * 8.0;
  scales = step(fish, 0.0) * prefilteredBand(scaleCoord, 0.0, 0.5, fwidth(scaleCoord)) * 0.55;
  return min(min(fish * 0.1, tail), fins * 0.03);
}
// The 12 edges of a projected cube, corners indexed by bits (x = 1, y = 2, z = 4).
float holoCube(vec2 c, vec2 p0, vec2 p1, vec2 p2, vec2 p3, vec2 p4, vec2 p5, vec2 p6, vec2 p7) {
  float x = min(min(holoSegment(c, p0, p1), holoSegment(c, p2, p3)), min(holoSegment(c, p4, p5), holoSegment(c, p6, p7)));
  float y = min(min(holoSegment(c, p0, p2), holoSegment(c, p1, p3)), min(holoSegment(c, p4, p6), holoSegment(c, p5, p7)));
  float z = min(min(holoSegment(c, p0, p4), holoSegment(c, p1, p5)), min(holoSegment(c, p2, p6), holoSegment(c, p3, p7)));
  return min(x, min(y, z));
}
// Street holograms (vfx-scene.ts) turn to face the viewer; u_holoFrame is the horizontal direction
// their subject faces (zero: the quad's own facing, as for the facade holograms).
uniform vec2 u_holoFrame;
// Turntable angle of the tesseract (yaw) is the slow spin plus the viewer's angle around the
// projection, so walking around it shows its other sides.
vec2 holoTesseractPoint(int i, float t, float yaw, float tilt) {
  vec4 v = vec4(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1), float((i >> 3) & 1)) * 2.0 - 1.0;
  v.xw = holoRot(t * 0.41) * v.xw;
  v.yz = holoRot(t * 0.19) * v.yz;
  vec3 c = v.xyz / (3.1 - v.w);
  c.xz = holoRot(t * 0.27 + yaw) * c.xz;
  c.yz = holoRot(tilt) * c.yz;
  return c.xy * 0.66 / (1.0 + c.z * 0.18);
}
// A 3D point of a subject (x across, y down, z toward the viewer) on its turntable: turned by yaw
// about the vertical, tipped toward the viewer by tilt, with a little perspective.
vec2 holoProject(vec3 v, float yaw, float tilt) {
  v.xz = holoRot(yaw) * v.xz;
  v.yz = holoRot(tilt) * v.yz;
  return v.xy / (1.0 + v.z * 0.22);
}
// The 12 edges of a box lo..hi (y down: lo.y is its top) whose top face is inset by "inset" (x, z).
float holoFrustum(vec2 c, vec3 lo, vec3 hi, vec2 inset, float yaw, float tilt) {
  vec2 p0 = holoProject(vec3(lo.x + inset.x, lo.y, lo.z + inset.y), yaw, tilt), p1 = holoProject(vec3(hi.x - inset.x, lo.y, lo.z + inset.y), yaw, tilt);
  vec2 p2 = holoProject(vec3(lo.x, hi.y, lo.z), yaw, tilt), p3 = holoProject(vec3(hi.x, hi.y, lo.z), yaw, tilt);
  vec2 p4 = holoProject(vec3(lo.x + inset.x, lo.y, hi.z - inset.y), yaw, tilt), p5 = holoProject(vec3(hi.x - inset.x, lo.y, hi.z - inset.y), yaw, tilt);
  vec2 p6 = holoProject(vec3(lo.x, hi.y, hi.z), yaw, tilt), p7 = holoProject(vec3(hi.x, hi.y, hi.z), yaw, tilt);
  return holoCube(c, p0, p1, p2, p3, p4, p5, p6, p7);
}
// One arm or leg of the dancer: upper segment from the root along angle a (0 = hanging down, toward
// +x for side s), the lower one bent by b; z swings it toward or away from the viewer.
float holoLimb(vec2 c, vec3 root, float s, float a, float b, float z, float yaw, float tilt, float upper, float lower, out vec2 tip) {
  vec3 joint = root + vec3(s * sin(a), cos(a), z) * upper;
  vec3 end = joint + vec3(s * sin(a + b), cos(a + b), z * 0.6) * lower;
  vec2 r = holoProject(root, yaw, tilt), j = holoProject(joint, yaw, tilt);
  tip = holoProject(end, yaw, tilt);
  return min(holoSegment(c, r, j), holoSegment(c, j, tip));
}
// phi: the viewer's angle around the projection (0 = in front), elev: how far above it the
// viewer stands (radians, negative from below). 3D subjects add phi to their
// turntable angle - they are objects in the volume, so walking past reveals their sides; flat
// ones foreshorten or turn their back. shade (0..1) dims the parts that face away.
float holoSubject(int kind, vec2 q, float t, float seed, float phi, float elev, out float detail, out float shade) {
  detail = 0.0;
  shade = 1.0;
  if (kind == 0) {
    // A woman's bust that tilts and blinks; her face follows the viewer's angle round her head
    // and from behind only her hair shows.
    vec2 h = holoRot(sin(t * 0.35) * 0.08) * (q - vec2(0.0, -0.3));
    float face = smoothstep(-0.15, 0.35, cos(phi)), turnX = sin(phi) * 0.11;
    float head = length(h / vec2(0.2, 0.27)) - 1.0;
    float hair = max(length((h - vec2(0.0, -0.05)) / vec2(0.27, 0.33)) - 1.0, -(h.y - 0.1 - 0.25 * (1.0 - face)));
    float neck = max(abs(q.x) - 0.075, abs(q.y + 0.02) - 0.1);
    float shoulders = max(length((q - vec2(0.0, 0.34)) / vec2(0.56 * (0.72 + 0.28 * abs(cos(phi))), 0.3)) - 1.0, q.y - 0.52);
    // A blink every ~5.3 s that eases shut and open again over ~0.24 s (a hard step popped the
    // eyes closed for one frame-exact quarter second). 1 open, 0 shut; open at both ends of the
    // cycle, so the fract wrap is invisible.
    float blink = smoothstep(0.0, 0.12, abs(fract(t * 0.19) * 5.263 - 0.15));
    vec2 f = vec2(h.x + turnX, h.y);
    float eyes = (1.0 - smoothstep(0.0, 0.02, length((vec2(abs(f.x), f.y) - vec2(0.075 * (0.6 + 0.4 * abs(cos(phi))), -0.02)) / vec2(1.0, 0.45 * blink + 0.05)) - 0.035)) * step(head, 0.0);
    float lips = (1.0 - smoothstep(0.0, 0.02, length((f - vec2(0.0, 0.14)) / vec2(1.0, 0.45)) - 0.04)) * step(head, 0.0);
    float strandCoord = h.x * 26.0 + sin(h.y * 9.0 + t * 0.4) * 0.8;
    float strands = prefilteredBand(strandCoord, 0.0, 0.3, fwidth(strandCoord)) * step(hair, 0.0) * 0.55;
    detail = max(max(eyes, lips * 0.8) * face, strands * (1.0 - face * 0.7));
    return min(min(head, hair * 0.9), min(neck * 4.0, shoulders)) * 0.22;
  } else if (kind == 1) {
    // Two koi circling each other through the rain.
    float s1 = 0.0, s2 = 0.0;
    float d = min(holoKoi(q, t * 0.5 + phi * 0.5, s1), holoKoi(q, t * 0.5 + phi * 0.5 + 3.14159, s2));
    detail = max(s1, s2);
    return d;
  } else if (kind == 2) {
    // A jellyfish: a pulsing bell trailing seven swaying tentacles.
    float pulse = sin(t * 1.4);
    vec2 c = q - vec2(sin(t * 0.31) * 0.06, -0.45 + pulse * 0.03);
    float w = 0.34 * (1.0 + 0.07 * pulse), hgt = 0.25 * (1.0 - 0.06 * pulse);
    float bell = max(length(c / vec2(w, hgt)) - 1.0, (c.y - 0.025 * sin(c.x * 38.0 + t * 1.5 + phi * 3.0)) / hgt) * hgt;
    float pitch = w * 0.27;
    float strand = clamp(floor(c.x / pitch + 0.5), -3.0, 3.0);
    float sway = sin(c.y * 6.0 - t * 1.6 + strand * 1.3 + phi * 2.0) * 0.05 * smoothstep(0.0, 0.5, c.y);
    float tentacle = abs(c.x - strand * pitch - sway) - 0.013 * (1.0 - smoothstep(0.0, 1.0, c.y));
    tentacle = max(tentacle, max(-c.y, c.y - 0.9 - 0.1 * sin(strand * 2.1)));
    float organs = 1.0 - smoothstep(0.0, 0.025, abs(length(c / vec2(w * 0.55, hgt * 0.6)) - 1.0) * hgt);
    detail = max(organs, (1.0 - smoothstep(0.02, 0.05, length(c - vec2(0.0, -hgt * 0.45))))) * step(bell, 0.0);
    return min(bell, tentacle);
  } else if (kind == 3) {
    // A slowly turning globe: graticule, drifting continents, a tilted orbit ring.
    vec2 c = q - vec2(0.0, -0.12);
    float r = 0.42;
    float sphere = length(c) - r;
    vec2 ringSpace = holoRot(-0.32) * c;
    float ring = abs(length(ringSpace / vec2(1.0, 0.26)) - 0.6) * 0.26 - 0.004;
    // Evaluated everywhere (no branch) so the graticule's derivatives stay defined at the limb.
    vec3 s = vec3(c, sqrt(max(r * r - dot(c, c), 0.0))) / r;
    s.yz = holoRot(0.2 + elev * 0.8) * s.yz;
    s.xz = holoRot(t * 0.22 + phi) * s.xz;
    float lon = atan(s.x, s.z) / (PI / 6.0), lat = asin(clamp(s.y, -1.0, 1.0)) / (PI / 9.0);
    float grid = max(prefilteredBand(lon + 0.05, 0.0, 0.1, min(fwidth(lon), 1.0)), prefilteredBand(lat + 0.05, 0.0, 0.1, fwidth(lat)));
    float land = smoothstep(0.55, 0.62, noise2(s.xy * 2.3 + s.z * 1.7 + seed * 9.0 + 4.0));
    detail = max(land * 0.55, grid * 0.8) * step(sphere, 0.0);
    // The far half of the orbit ring passes behind the globe.
    float ringBehind = step(0.0, -ringSpace.y) * step(sphere, 0.0);
    detail = max(detail, (1.0 - smoothstep(0.0, max(0.012, fwidth(ring) * 1.2), ring)) * (1.0 - ringBehind));
    return sphere;
  } else if (kind == 4) {
    // A rotating tesseract, the classic product-launch hologram: two cubes (the w = -1 and w = +1
    // slices, turning through each other in 4D) and the 8 edges joining them. Unrolled: the
    // material keeps its fixed loop budget.
    vec2 c = q - vec2(0.0, -0.15);
    vec2 a0 = holoTesseractPoint(0, t, phi, 0.22 + elev * 0.8), a1 = holoTesseractPoint(1, t, phi, 0.22 + elev * 0.8), a2 = holoTesseractPoint(2, t, phi, 0.22 + elev * 0.8), a3 = holoTesseractPoint(3, t, phi, 0.22 + elev * 0.8);
    vec2 a4 = holoTesseractPoint(4, t, phi, 0.22 + elev * 0.8), a5 = holoTesseractPoint(5, t, phi, 0.22 + elev * 0.8), a6 = holoTesseractPoint(6, t, phi, 0.22 + elev * 0.8), a7 = holoTesseractPoint(7, t, phi, 0.22 + elev * 0.8);
    vec2 b0 = holoTesseractPoint(8, t, phi, 0.22 + elev * 0.8), b1 = holoTesseractPoint(9, t, phi, 0.22 + elev * 0.8), b2 = holoTesseractPoint(10, t, phi, 0.22 + elev * 0.8), b3 = holoTesseractPoint(11, t, phi, 0.22 + elev * 0.8);
    vec2 b4 = holoTesseractPoint(12, t, phi, 0.22 + elev * 0.8), b5 = holoTesseractPoint(13, t, phi, 0.22 + elev * 0.8), b6 = holoTesseractPoint(14, t, phi, 0.22 + elev * 0.8), b7 = holoTesseractPoint(15, t, phi, 0.22 + elev * 0.8);
    float edge = min(holoCube(c, a0, a1, a2, a3, a4, a5, a6, a7), holoCube(c, b0, b1, b2, b3, b4, b5, b6, b7));
    edge = min(edge, min(min(holoSegment(c, a0, b0), holoSegment(c, a1, b1)), min(holoSegment(c, a2, b2), holoSegment(c, a3, b3))));
    edge = min(edge, min(min(holoSegment(c, a4, b4), holoSegment(c, a5, b5)), min(holoSegment(c, a6, b6), holoSegment(c, a7, b7))));
    float node = min(min(min(length(c - a0), length(c - a1)), min(length(c - a2), length(c - a3))), min(min(length(c - a4), length(c - a5)), min(length(c - a6), length(c - a7))));
    node = min(node, min(min(min(length(c - b0), length(c - b1)), min(length(c - b2), length(c - b3))), min(min(length(c - b4), length(c - b5)), min(length(c - b6), length(c - b7)))));
    detail = 1.0 - smoothstep(0.012, 0.03, node);
    return min(edge - 0.004, node - 0.016);
  } else if (kind == 6) {
    // A dancer turning slowly on the emitter: arms and legs on a ~0.3 Hz beat, one knee lifting at
    // a time, hands and face glowing. A real 3D figure, so her back shows from behind.
    float beat = t * 1.9, yaw = t * 0.3 + phi, lean = elev * 0.7;
    vec2 c = (q - vec2(0.0, -0.1)) / 1.12;
    vec3 hip = vec3(0.04 * sin(beat), 0.2 + 0.018 * sin(beat * 2.0), 0.0);
    vec3 neck = hip + vec3(0.05 * sin(beat + 0.6), -0.4, 0.05 * sin(beat * 0.5));
    vec3 head = neck + vec3(0.02 * sin(beat + 1.0), -0.13, 0.02);
    vec2 hp = holoProject(hip, yaw, lean), np = holoProject(neck, yaw, lean), hd = holoProject(head, yaw, lean);
    vec2 handL, handR, footL, footR;
    float torso = holoSegment(c, np, hp) - 0.05;
    float skull = (length((c - hd) / vec2(0.07, 0.09)) - 1.0) * 0.07;
    float armL = holoLimb(c, neck + vec3(-0.12, 0.04, 0.0), -1.0, 1.1 + 1.2 * (0.5 + 0.5 * sin(beat + 0.4)), 0.4 + 0.5 * sin(beat + 1.9), 0.3 * sin(beat * 0.5), yaw, lean, 0.19, 0.18, handL);
    float armR = holoLimb(c, neck + vec3(0.12, 0.04, 0.0), 1.0, 1.1 + 1.2 * (0.5 + 0.5 * sin(beat + 2.6)), 0.4 + 0.5 * sin(beat + 0.3), -0.3 * sin(beat * 0.5), yaw, lean, 0.19, 0.18, handR);
    float liftL = max(0.0, sin(beat)), liftR = max(0.0, -sin(beat));
    float legL = holoLimb(c, hip + vec3(-0.07, 0.0, 0.0), -1.0, 0.1 + 0.55 * liftL, -0.9 * liftL, 0.25 * liftL, yaw, lean, 0.26, 0.27, footL);
    float legR = holoLimb(c, hip + vec3(0.07, 0.0, 0.0), 1.0, 0.1 + 0.55 * liftR, -0.9 * liftR, 0.25 * liftR, yaw, lean, 0.26, 0.27, footR);
    float ribbon = holoSegment(c, hd + vec2(0.0, -0.02), hd + vec2(-0.16 * sin(yaw) - 0.05 * sin(beat), 0.17)) - 0.012;
    float limbs = min(min(armL, armR), min(legL, legR)) - 0.026;
    detail = max(max(1.0 - smoothstep(0.015, 0.04, length(c - handL)), 1.0 - smoothstep(0.015, 0.04, length(c - handR))),
                 (1.0 - smoothstep(0.0, 0.03, length(c - hd - vec2(0.03 * sin(yaw), 0.0)) - 0.025)) * smoothstep(-0.2, 0.3, cos(yaw)));
    return min(min(torso, skull), min(limbs, ribbon)) * 1.12;
  } else if (kind == 7) {
    // A DNA helix twisting slowly: two strands and their base-pair rungs, the strand nearer the
    // viewer brighter, beads where the rungs meet it.
    vec2 c = q - vec2(0.0, -0.14);
    float twist = 8.0, R = 0.2, a = c.y * twist + t * 0.7 + phi;
    float sx = R * sin(a), sz = cos(a), slope = R * twist * cos(a);
    float stretch = inversesqrt(1.0 + slope * slope);
    float strandA = abs(c.x - sx) * stretch - 0.021 * (1.0 + 0.35 * sz);
    float strandB = abs(c.x + sx) * stretch - 0.021 * (1.0 - 0.35 * sz);
    float rungY = (floor(c.y / 0.075) + 0.5) * 0.075, rungA = rungY * twist + t * 0.7 + phi, rx = R * sin(rungA);
    float rung = holoSegment(c, vec2(-rx, rungY), vec2(rx, rungY)) - 0.007;
    float ends = abs(c.y) - 0.64;
    float bead = min(length(c - vec2(rx, rungY)), length(c + vec2(rx, -rungY))) - 0.03;
    shade = strandA < strandB ? 0.6 + 0.4 * sz : 0.6 - 0.4 * sz;
    shade = rung < min(strandA, strandB) ? 0.7 : shade;
    detail = max((1.0 - smoothstep(0.0, 0.015, bead)) * 0.9, (1.0 - smoothstep(0.0, 0.012, rung)) * 0.35) * step(ends, 0.0);
    return max(min(min(strandA, strandB), min(rung, bead)), ends);
  } else if (kind == 8) {
    // A sports car on a turntable, in wireframe: body and cabin as tapered boxes, four wheel rims,
    // headlights, and the turntable ring under it in perspective.
    vec2 c = q - vec2(0.0, -0.06);
    float yaw = t * 0.3 + phi, tilt = clamp(0.15 + elev, -0.7, 0.9);
    float body = holoFrustum(c, vec3(-0.52, 0.04, -0.21), vec3(0.52, 0.2, 0.21), vec2(0.05, 0.02), yaw, tilt);
    float cabin = holoFrustum(c, vec3(-0.34, -0.11, -0.18), vec3(0.24, 0.04, 0.18), vec2(0.11, 0.04), yaw, tilt);
    vec2 w0 = holoProject(vec3(-0.33, 0.2, -0.22), yaw, tilt), w1 = holoProject(vec3(0.33, 0.2, -0.22), yaw, tilt);
    vec2 w2 = holoProject(vec3(-0.33, 0.2, 0.22), yaw, tilt), w3 = holoProject(vec3(0.33, 0.2, 0.22), yaw, tilt);
    float wheels = min(min(abs(length(c - w0) - 0.07), abs(length(c - w1) - 0.07)), min(abs(length(c - w2) - 0.07), abs(length(c - w3) - 0.07)));
    vec2 l0 = holoProject(vec3(0.52, 0.1, -0.14), yaw, tilt), l1 = holoProject(vec3(0.52, 0.1, 0.14), yaw, tilt);
    vec2 tc = holoProject(vec3(0.0, 0.25, 0.0), yaw, tilt);
    float flatness = max(abs(sin(tilt)), 0.06);
    float table = abs(length((c - tc) / vec2(0.66, 0.66 * flatness)) - 1.0) * 0.66 * flatness - 0.004;
    detail = max(1.0 - smoothstep(0.01, 0.035, min(length(c - l0), length(c - l1))), (1.0 - smoothstep(0.0, 0.01, table)) * 0.7);
    return min(min(body, cabin), wheels) - 0.005;
  } else if (kind == 9) {
    // A noodle-bar advert: a steaming bowl, noodles swirling in the broth, chopsticks dipping
    // in and out, three wisps of steam curling up.
    vec2 c = q - vec2(0.0, 0.12);
    float rim = abs(length(c / vec2(0.44, 0.12)) - 1.0) * 0.12 - 0.004;
    float bowl = max(length((c - vec2(0.0, -0.02)) / vec2(0.44, 0.36)) - 1.0, -c.y) * 0.36;
    float broth = 1.0 - step(1.0, length(c / vec2(0.41, 0.105)));
    float noodleCoord = c.x * 24.0 + sin(c.y * 60.0 + c.x * 8.0 + t * 0.8) * 1.3;
    float noodles = broth * prefilteredBand(noodleCoord, 0.0, 0.35, fwidth(noodleCoord));
    float dip = 0.04 * sin(t * 0.6), lean = 0.12 * sin(phi);
    vec2 tip = vec2(0.05, -0.03 + dip);
    float sticks = min(holoSegment(c, tip, tip + vec2(0.42 + lean, -0.55)), holoSegment(c, tip + vec2(0.08, 0.02), tip + vec2(0.55 + lean, -0.45))) - 0.011;
    float wisps = min(min(abs(c.x + 0.18 + 0.05 * sin(c.y * 9.0 + t * 1.2)), abs(c.x + 0.06 * sin(c.y * 7.0 + t * 0.9 + 2.0))), abs(c.x - 0.18 + 0.05 * sin(c.y * 8.0 + t * 1.05 + 4.0)));
    float steam = (1.0 - smoothstep(0.006, 0.026, wisps)) * smoothstep(0.06, 0.18, -c.y) * (1.0 - smoothstep(0.4, 0.8, -c.y));
    float glaze = prefilteredBand(c.y * 14.0, 0.0, 0.18, fwidth(c.y * 14.0)) * step(bowl, 0.0) * step(0.03, c.y) * 0.5;
    detail = max(max(noodles * 0.85, steam * 0.75), glaze);
    return min(min(rim, bowl), sticks);
  } else if (kind == 10) {
    // Landmark: a giant koi climbing the sky over a rooftop, head up, its body swaying in a slow
    // S (one sway every ~14 s), fins sculling, kohaku patches and scales. A 3D fish: the sway is
    // seen in full from in front and foreshortened from the side, where the body slims.
    vec2 c = q - vec2(0.0, -0.06);
    float side = abs(cos(phi)), along = clamp((0.36 - c.y) / 0.92, 0.0, 1.0);
    float sway = sin(c.y * 3.6 + t * 0.45) * 0.085 * (0.35 + 0.65 * side) * (1.1 - along);
    float x = c.x - sway;
    float girth = 0.16 * (0.7 + 0.3 * side) * sqrt(max(sin(PI * clamp(0.08 + along * 0.92, 0.0, 1.0)), 0.0));
    float body = max((abs(x) - girth) * 0.7, max(c.y - 0.38, -0.58 - c.y));
    float tail = max(abs(x) - 0.03 - (c.y - 0.34) * 0.85, max(0.34 - c.y, c.y - 0.47 - abs(x) * 0.9));
    float scull = 0.03 * sin(t * 0.6);
    float fins = length(vec2(abs(x) - girth - 0.05, c.y + 0.2 + scull) / vec2(0.09, 0.035)) - 1.0;
    vec2 e = vec2(abs(x) - 0.075 * (0.4 + 0.6 * side), c.y + 0.47);
    float eyes = (1.0 - smoothstep(0.012, 0.026, length(e))) * smoothstep(-0.2, 0.3, cos(phi));
    float blotch = smoothstep(0.52, 0.6, noise2(vec2(x * 7.0, c.y * 4.0) + seed * 11.0)) * step(body, 0.0);
    float scaleCoord = c.y * 26.0 + abs(x) * 9.0;
    float scales = step(body, 0.0) * prefilteredBand(scaleCoord, 0.0, 0.45, fwidth(scaleCoord)) * 0.45;
    detail = max(max(eyes, blotch * 0.7), scales);
    shade = 0.75 + 0.25 * side;
    return min(min(body, tail * 0.5), fins * 0.03);
  }
  // A market data panel: framed chart of a drifting price, volume bars, grid. A flat panel, so it
  // narrows when seen from the side.
  vec2 c = q - vec2(0.0, -0.12);
  c.x /= max(abs(cos(phi)), 0.3);
  vec2 e = abs(c) - vec2(0.54, 0.58);
  float frame = abs(length(max(e, 0.0)) + min(max(e.x, e.y), 0.0)) - 0.006;
  float inside = step(max(e.x, e.y), 0.0);
  float x = c.x + 0.5;
  float price = (noise2(vec2(x * 4.0 + t * 0.3, seed * 13.0)) - 0.5) * 0.5 + sin(x * 7.0 + t * 0.4) * 0.06;
  float lineY = -0.08 - price, slope = abs(dFdx(lineY)) / max(abs(dFdx(c.x)), 1e-4);
  float line = abs(c.y - lineY) / sqrt(1.0 + slope * slope) - 0.005;
  float area = step(lineY, c.y) * step(c.y, 0.3) * 0.35;
  float barCoord = x * 22.0;
  // Each bar holds a hashed height for 2.5 s and glides to the next over the last 0.5 s of its
  // period, every bar on its own phase (all bars used to jump together on a shared 2.5 s floor).
  float barClock = t * 0.4 + hash(vec2(floor(barCoord), seed + 5.0));
  float barKey = floor(barClock), barBlend = smoothstep(0.8, 1.0, barClock - barKey);
  float barHeight = 0.05 + 0.12 * mix(hash(vec2(floor(barCoord), barKey + seed)), hash(vec2(floor(barCoord), barKey + 1.0 + seed)), barBlend);
  float bars = step(0.58 - barHeight, c.y) * step(c.y, 0.56) * prefilteredBand(barCoord, 0.15, 0.85, fwidth(barCoord));
  float gridCoord = c.y / 0.15;
  float grid = prefilteredBand(gridCoord, 0.0, 0.06, fwidth(gridCoord)) * 0.3;
  detail = inside * max(max(area, bars * 0.7), max(grid, 1.0 - smoothstep(0.0, max(0.012, fwidth(c.y) * 1.2), line)));
  // From behind only the frame and its grid show, dimmer.
  shade = cos(phi) > 0.0 ? 1.0 : 0.55;
  detail *= cos(phi) > 0.0 ? 1.0 : 0.3;
  return frame;
}
#else
uniform vec2 u_holoFrame;
float holoSubject(int kind, vec2 q, float t, float seed, float phi, float elev, out float detail, out float shade) { detail = 0.0; shade = 1.0; return 1.0; }
#endif

${WEATHER_GLSL}
vec3 skyColor(vec3 direction) {
  float up = -direction.y;
  vec3 zenith = vec3(0.004, 0.006, 0.011);
  // Weather agent: a heavier rain lowers the cloud deck, which catches more of the city's glow
  // (changes over minutes: weather.ts).
  vec3 smog = vec3(0.022, 0.042, 0.052) * (0.88 + 0.24 * weatherRain());
  vec3 sodium = vec3(0.11, 0.055, 0.026);
  vec3 color = mix(zenith, smog, exp(-max(up, 0.0) * 6.0));
  color += sodium * exp(-max(up, 0.0) * 16.0);
  // Sky agent: the horizon takes the colour of the districts ~450 m out along this bearing (weather.ts
  // districtSkyLight), so the far-tower haze (nightHaze, fog) and the skyline band in the sky dome
  // share one tint: orange toward the Foundry, pink over the Neon Ward, green-cyan over the Market.
  // Bearing-only and low-frequency: it cannot alias or slide.
  vec2 horizonAt = eyePosition().xz + direction.xz / max(length(direction.xz), 1e-4) * 450.0;
  vec3 horizonTint = vec3(0);
  ${districtSkyLightGlsl("horizonAt", "horizonTint")}
  color += horizonTint * 0.03 * exp(-abs(up) * 10.0);
  return color * (1.0 - 0.55 * smoothstep(0.0, -0.35, up));
}
// Fog: height haze near the street plus a guaranteed fade into the sky at the draw distance.
// x: the full haze (what fine glyph texture fades by: it would shimmer far away), y: the haze the
// masses and lights see - it levels off at 90%, so towers a kilometre out still read as dark
// silhouettes pricked with lit windows - and z: the edge fade, which alone takes everything into
// the sky over the last ~30% of the draw distance (~400 m on desktop), so nothing pops.
vec3 fogTerms(vec3 p) {
  vec3 eye = eyePosition();
  float distanceToEye = length(p - eye), across = length(p.xz - eye.xz);
  float startHeight = max(0.0, -eye.y), endHeight = max(0.0, -p.y), dh = (endHeight - startHeight) * 0.035;
  float density = exp(-startHeight * 0.035) * (abs(dh) < 0.01 ? 1.0 : (1.0 - exp(-dh)) / dh);
  float haze = 1.0 - exp(-distanceToEye * (0.0006 + density * 0.0014));
  // Weather agent: mist pools over the Rain Gardens and Rootwood Park (x < -256, z > 0): up to 40%
  // more haze on the lowest few metres, building over the first ~50 m from the eye.
  float garden = (1.0 - smoothstep(-300.0, -220.0, p.x)) * smoothstep(-40.0, 40.0, p.z);
  haze = 1.0 - (1.0 - haze) * (1.0 - 0.4 * garden * exp(-endHeight * 0.4) * (1.0 - exp(-distanceToEye * 0.03)));
  float edge = smoothstep(u_viewRadius * 0.68, u_viewRadius * 0.97, across);
  return vec3(haze, haze * 0.9, edge);
}
float fogAmount(vec3 p) {
  vec3 f = fogTerms(p);
  return clamp(1.0 - (1.0 - f.y) * (1.0 - f.z), 0.0, 1.0);
}
// Tone: a gentle Reinhard-style curve, then a soft shoulder on the brightest channel, so saturated
// neon rolls off toward its own hue instead of clipping (a clipped channel skews hue toward white).
// Below 0.8 it is exactly the old curve.
vec3 toneMap(vec3 c) {
  c = c / (1.0 + c * 0.3);
  float m = max(c.r, max(c.g, c.b));
  return m > 0.8 ? c * ((0.8 + 0.2 * (1.0 - exp((0.8 - m) * 5.0))) / m) : c;
}

float blocked(vec3 start, vec3 end) {
  vec3 ray = end - start, inv = sign(ray + 0.00001) / max(abs(ray), vec3(0.00001));
  for (int i = 0; i < KEEP_LOOP(10); i++) {
    vec4 box = datum(i + 16);
    vec3 lo = vec3(box.x - box.z, -datum(i + 26).x, box.y - box.w), hi = vec3(box.x + box.z, 0.0, box.y + box.w);
    vec3 a = (lo - start) * inv, b = (hi - start) * inv, near = min(a, b), far = max(a, b);
    float entry = max(max(near.x, near.y), near.z), leave = min(min(far.x, far.y), far.z);
    if (leave > max(entry, 0.015) && entry < 0.985 && leave > 0.015) return 0.16;
  }
  return 1.0;
}
// Car lights: the nearest cars arrive as (x, z, yaw, intensity) in texels 240-251. Headlights
// throw widening cones along the road that also light walls and props facing them; tail lights
// leave small red pools. Forward is (sin yaw, -cos yaw), the same convention as drawCar.
vec3 carLight(vec3 p, vec3 n, float wet) {
  vec3 sum = vec3(0);
  float height = -p.y;
  if (height > 9.0) return sum;
  for (int i = 0; i < KEEP_LOOP(12); i++) {
    vec4 car = datum(240 + i);
    if (car.w <= 0.0) continue;
    vec2 forward = vec2(sin(car.z), -cos(car.z)), right = vec2(-forward.y, forward.x);
    vec2 d = p.xz - car.xy;
    float along = dot(d, forward) - 2.9, side = dot(d, right);
    if (along > 0.0 && along < 48.0) {
      float width = 0.9 + along * 0.3;
      float beam = (1.0 - smoothstep(width * 0.55, width, abs(side))) * exp(-along * 0.05) * smoothstep(0.0, 1.5, along);
      beam *= 1.0 - smoothstep(0.4 + along * 0.08, 1.2 + along * 0.2, height);
      float facing = abs(n.y) > 0.5 ? 1.0 : max(dot(n.xz, -forward), 0.0);
      sum += vec3(1.0, 0.9, 0.74) * beam * facing * car.w * (1.0 + wet * 0.8);
    } else if (along < -5.4 && along > -12.0) {
      float r = length(vec2(along + 6.4, side));
      sum += vec3(1.0, 0.1, 0.12) * exp(-r * r * 0.35) * 0.35 * car.w * (1.0 - smoothstep(0.0, 1.5, height));
    }
  }
  return sum;
}
vec3 lighting(vec3 p, vec3 n, vec3 albedo, float wet) {
  vec3 eye = normalize(eyePosition() - p);
  vec3 ambient = mix(vec3(0.22, 0.29, 0.37), vec3(0.46, 0.56, 0.64), clamp(-n.y, 0.0, 1.0));
  float moon = max(0.0, dot(n, normalize(vec3(-0.3, -0.8, 0.4))));
  vec3 result = albedo * (ambient + vec3(0.16, 0.21, 0.27) * moon);
  for (int i = 0; i < KEEP_LOOP(8); i++) {
    vec3 delta = datum(i).xyz - p;
    float d2 = dot(delta, delta), radius = datum(i).w;
    float falloff = pow(max(0.0, 1.0 - d2 / (radius * radius)), 2.0) / (1.0 + d2 * 0.023);
    if (falloff < 0.001) continue;
    vec3 l = normalize(delta);
    float diffuse = max(dot(n, l), 0.0), spec = pow(max(dot(n, normalize(l + eye)), 0.0), 70.0) * wet;
    result += datum(i + 8).rgb * (albedo * (0.14 + diffuse) * 3.5 + spec * 1.8) * falloff * blocked(p + n * 0.16, datum(i).xyz);
  }
  float ao = 0.0;
  for (int i = 0; i < KEEP_LOOP(10); i++) {
    vec2 q = abs(p.xz - datum(i + 16).xy) - datum(i + 16).zw;
    ao = max(ao, exp(-length(max(q, 0.0)) * 0.65) * exp(-abs(p.y) * 0.24) * 0.45);
  }
  // Perf: one car-light evaluation (12 cars) serves both terms; it used to be evaluated twice.
  vec3 cars = carLight(p, n, wet);
  result += albedo * cars * 2.4 + cars * wet * 0.05;
  return result * (1.0 - ao);
}
vec3 atmosphere(vec3 p) {
  if (u_atmosphere < 0.5) return vec3(0);
  vec3 origin = eyePosition();
  vec3 ray = p - origin; float rayLength = length(ray), limit = min(rayLength, 170.0);
  vec3 direction = ray / max(rayLength, 0.001), sum = vec3(0);
  // Perf: every medium below (lamp cones under 8.2 m, beacon shafts under 26 m, headlight beams
  // under ~6 m) is exactly zero higher up, so a ray segment that stays above 26.5 m adds nothing.
  if (max(origin.y, origin.y + direction.y * limit) < -26.5) return vec3(0);
  // Perf: loop invariants hoisted - the step length, and the nearest cars' data and headings
  // (a texel fetch, sin and cos per car that used to repeat at every step).
  float stepLength = limit / float(ATMOSPHERE_STEPS);
  vec4 beamCar[ATMOSPHERE_CARS];
  vec2 beamForward[ATMOSPHERE_CARS];
  for (int c = 0; c < KEEP_LOOP(ATMOSPHERE_CARS); c++) { beamCar[c] = datum(240 + c); beamForward[c] = vec2(sin(beamCar[c].z), -cos(beamCar[c].z)); }
  // Midpoint integration through lamp cones, terminated at actual scene depth.
  for (int i = 0; i < KEEP_LOOP(ATMOSPHERE_STEPS); i++) {
    vec3 q = origin + direction * (float(i) + 0.5) * stepLength;
    if (q.y < -26.5) continue; // Perf: above every medium (see above); this step adds exactly zero
    // Lamp heads over the kerb: streetLamp() in world.ts (the central avenue's sit further out).
    vec2 lampCell = floor((q.xz - vec2(5.75, 6.75)) / 64.0 + 0.5);
    vec2 lamp = lampCell * 64.0 + (lampCell.x == 0.0 ? vec2(12.5, 9.5) : vec2(5.75, 6.75));
    float h = 8.0 + q.y;
    float cone = (1.0 - smoothstep(h * 0.24 + 0.25, h * 0.7 + 0.6, length(q.xz - lamp))) * step(0.0, h) * step(h, 8.2) * step(max(abs(lampCell.x), abs(lampCell.y)), 11.5);
    float density = 0.7 + 0.3 * noise2(q.xz * 0.25 + u_time * 0.03);
    sum += vec3(0.9, 0.58, 0.27) * cone * density * 0.012 * stepLength;
    vec2 beacon = vec2(0.0, round(q.z / 128.0) * 128.0 + 32.0); float drop = 26.0 + q.y;
    float shaft = (1.0 - smoothstep(1.0 + drop * 0.1, 2.0 + drop * 0.24, length(q.xz - beacon))) * step(0.0, drop) * step(drop, 26.0);
    sum += vec3(0.11, 0.31, 0.37) * shaft * 0.012 * stepLength;
    // Headlight beams made visible by the rain, for the four nearest cars.
    for (int c = 0; c < KEEP_LOOP(ATMOSPHERE_CARS); c++) {
      vec4 car = beamCar[c];
      if (car.w <= 0.0 || u_rain < 0.5) continue;
      vec2 forward = beamForward[c], d = q.xz - car.xy;
      float along = dot(d, forward) - 2.9, side = dot(d, vec2(-forward.y, forward.x));
      if (along <= 0.0 || along > 40.0) continue;
      float width = 0.5 + along * 0.18, lift = -q.y - 0.8;
      float cone = (1.0 - smoothstep(width * 0.3, width, length(vec2(side, lift * 1.6)))) * exp(-along * 0.07);
      sum += vec3(0.8, 0.74, 0.6) * cone * car.w * 0.007 * stepLength;
    }
  }
  return sum * u_atmosphere;
}
${VFX_GLSL_DECLARATIONS}
${includesGround ? parkGlsl() : ""}
void main() {
  vec3 p = v_worldPosition, eye = eyePosition();
  vec3 n = normalize(cross(dFdy(p), dFdx(p)));
  if (dot(n, eye - p) < 0.0) n = -n;
  vec3 view = normalize(p - eye);
  vec3 sky = skyColor(view);
  float cellWorld = max(length(dFdx(p)), length(dFdy(p)));
  int code = A_SPACE;
  bool thin = false;
  vec3 paper = vec3(0), ink = vec3(0), emission = vec3(0);
  float flags = 0.0;
  bool useCharacter = false, isSky = false, useFeed = false;
  vec3 reflectedGlyph = vec3(0), feedGlyph = vec3(0);
  // Props, signs and screens carry their draw distance in the cell colour's alpha (4 m units;
  // 255 = always drawn) and dissolve over the last stretch of it with an ordered dither.
  if ((SURFACE > 1.5 && SURFACE < 3.5) || (SURFACE > 4.5 && SURFACE < 5.5)) {
    float rangeCode = v_cellColor.a * 255.0;
    if (rangeCode < 254.5) {
      float end = rangeCode * 4.0, fade = 1.0 - smoothstep(end * 0.76, end, length(p.xz - eye.xz));
      if (bayer(gl_FragCoord.xy) > fade) discard;
    }
  }

  if (${on(8, "SURFACE > 7.5")}) {
    // VFX surface (vfx-shaders.ts): spinning wheels, steam volumes, searchlight beams.
${VFX_GLSL_BRANCH}
  } else if (${on(7, "SURFACE > 6.5")}) {
    // Hologram: a translucent figure standing in a projection volume - a bust, koi, a jellyfish,
    // a globe, a tesseract, a data panel, a dancer, a DNA helix, a car on a turntable or a noodle
    // bowl, changing every ~20 s - outlined with ASCII strokes that follow its contour, contour
    // lines inside, a chromatic ghost hanging behind it, and around it a real volume: a projector
    // cone rising from a lit emitter, scan rings travelling up a cylinder of light, a data curtain
    // on the cylinder's far wall, dust motes on both walls, and a slogan crawling in front.
    vec2 uv = v_uv;
    // Landmark holograms (vfx.ts roof sites) pass u_holoSeed = 1 + subject + seed / 2: one fixed
    // subject, no change-overs, no signal dropouts and no slogan - calm at any distance.
    bool landmark = u_holoSeed >= 1.0;
    float seed = landmark ? fract(u_holoSeed) * 2.0 : u_holoSeed, t = u_time + seed * 40.0;
    // The projection volume, reconstructed from the quad itself (exact on a plane, so the facade
    // holograms and the street ones share it): world vectors of one unit of uv across and down,
    // the centre, and the horizontal frame the subject faces.
    vec2 uvX = dFdx(v_uv), uvY = dFdy(v_uv);
    vec3 pX = dFdx(p), pY = dFdy(p);
    float uvDet = uvX.x * uvY.y - uvX.y * uvY.x;
    uvDet = abs(uvDet) < 1e-12 ? 1e-12 : uvDet;
    vec3 axisA = (pX * uvY.y - pY * uvX.y) / uvDet, axisB = (pY * uvX.x - pX * uvY.x) / uvDet;
    float holoW = max(length(axisA), 1e-3), holoH = max(length(axisB), 1e-3);
    vec3 right = axisA / holoW, down = axisB / holoH;
    vec3 centre = p + axisA * (0.5 - v_uv.x) + axisB * (0.5 - v_uv.y);
    vec3 rel = eye - centre, eyeFlat = rel - down * dot(rel, down);
    eyeFlat /= max(length(eyeFlat), 1e-3);
    vec3 facing = cross(right, down);
    facing *= dot(facing, rel) < 0.0 ? -1.0 : 1.0;
    float handed = dot(right, cross(down, facing)) < 0.0 ? -1.0 : 1.0;
    vec3 front = dot(u_holoFrame, u_holoFrame) > 0.25 ? vec3(u_holoFrame.x, 0.0, u_holoFrame.y) : facing;
    vec3 frontRight = handed * cross(down, front);
    // The viewer's angle around the projection: 3D subjects turn by it, layers slide by it.
    float phi = atan(dot(eyeFlat, frontRight), dot(eyeFlat, front)), sinPhi = sin(phi);
    // ...and how far above (or below) it: 3D subjects tip toward the viewer, and the figure is
    // stretched up the quad by 1 / cos(elevation) so it stays round seen from the street below.
    float elev = asin(clamp(-dot(rel, down) / max(length(rel), 1e-3), -1.0, 1.0));
    float upright = max(cos(elev), 0.62);
    // Programme: each projector shows its subjects in turn (a step of 3 through all ten). The last
    // ~3 s of a slot is the change-over: horizontal slices slide aside (easing in and out), and
    // the next subject is projected up from the emitter behind a rising scan line (slow enough
    // that the line takes a few frames to cross each cell: a thin fast line reads as flicker).
    float slotLength = 17.0 + 9.0 * fract(seed * 7.31);
    float slotClock = (u_time + seed * 211.0) / slotLength;
    int slot = int(floor(slotClock));
    float change = landmark ? 0.0 : smoothstep(1.0 - 3.0 / slotLength, 1.0, fract(slotClock));
    float wobble = sin(PI * change);
    // Comfort: no strobing. Rarely (about one 2.5 s slot in 14, ~35 s apart) the signal dips and
    // slices tear sideways a little, easing in and out over the whole slot (sin^2: no kink at
    // either end, ~0.2 Hz).
    float slotTime = u_time * 0.4 + seed * 13.0;
    float dropBump = sin(PI * fract(slotTime));
    float dropout = landmark ? 0.0 : step(0.93, hash(vec2(floor(slotTime), seed * 31.0))) * dropBump * dropBump;
    float glitch = max(dropout * 0.7, wobble);
    // Two tear patterns, each fixed while its own glitch runs and re-rolled only while that glitch
    // is at zero, so torn slices ease aside and back instead of jumping mid-glitch (a shared key
    // switched pattern whenever a dropout began during a change-over).
    float sliceRows = 12.0 + floor(hash(vec2(float(slot), seed)) * 14.0);
    float sliceRnd = hash(vec2(floor(uv.y * sliceRows), float(slot) * 7.0));
    float dropRows = 12.0 + floor(hash(vec2(floor(slotTime), seed + 2.0)) * 14.0);
    float dropRnd = hash(vec2(floor(uv.y * dropRows), floor(slotTime) + seed * 3.0));
    uv.x += (wobble * step(0.62, sliceRnd) * (sliceRnd - 0.81) + dropout * 0.7 * step(0.62, dropRnd) * (dropRnd - 0.81)) * 0.3;
    float wipeLine = mix(1.05, -0.08, smoothstep(0.12, 0.92, change));
    // A ragged edge anchored to the projection's columns (a screen-space dither here crawled as
    // the view moved).
    bool fresh = change > 0.0 && uv.y + (hash(vec2(floor(uv.x * 24.0), seed * 5.0)) - 0.5) * 0.05 > wipeLine;
    int kind = landmark ? int(floor(u_holoSeed)) - 1 : (int(seed * 10.0) + (slot + (fresh ? 1 : 0)) * 3) % 10;
    float wipeFront = change > 0.0 && change < 0.97 ? 1.0 - smoothstep(0.02, 0.045, abs(uv.y - wipeLine)) : 0.0;
    vec2 q = (uv - vec2(0.5, 0.42)) * vec2(1.25, 2.1);
    q.y = (q.y + 0.12) * upright - 0.12;
    float detail = 0.0, shade = 1.0;
    float d = holoSubject(kind, q, t, seed, phi, elev, detail, shade);
    // The ghost: the same figure displaced (first-order, from the figure's own gradient - one
    // evaluation instead of two). It hangs behind the figure, so it slides against it as the
    // viewer walks past, and drifts a little further out during a glitch.
    vec2 qX = dFdx(q), qY = dFdy(q);
    float dX = dFdx(d), dY = dFdy(d), qDet = qX.x * qY.y - qX.y * qY.x;
    vec2 grad = abs(qDet) > 1e-12 ? vec2(dX * qY.y - dY * qX.y, dY * qX.x - dX * qY.x) / qDet : vec2(0.0);
    grad /= max(1.0, length(grad) / 3.0);
    vec2 ghostOffset = vec2(0.03 + 0.08 * sinPhi + 0.03 * glitch, -0.012 + 0.006 * sin(u_time * 0.23 + seed * 5.0));
    float dGhost = d + dot(grad, ghostOffset);
    // Edges prefiltered by the cell footprint: the outline is about one cell wide. Small on screen
    // (under ~40 cells across) the outline and contours thin out, or dense subjects (wireframes)
    // turn into a solid mass of strokes.
    float fw = max(fwidth(d), 1e-3);
    float small = smoothstep(0.012, 0.035, max(length(qX), length(qY)));
    float rimLo = fw * mix(1.0, 0.5, small), rimHi = fw * mix(2.2, 1.3, small) + 0.01 * (1.0 - small);
    float body = 1.0 - smoothstep(-fw, fw, d);
    float rim = 1.0 - smoothstep(rimLo, rimHi, abs(d));
    float contour = prefilteredBand(-d * 12.0, 0.0, 0.2, fw * 12.0) * body * (1.0 - small);
    float ghostBody = 1.0 - smoothstep(-fw, fw, dGhost);
    float ghostRim = 1.0 - smoothstep(rimLo, rimHi, abs(dGhost));
    float ghostSignal = (ghostBody * 0.14 + ghostRim * 0.45) * (1.0 - body) * (1.0 - rim);
    float signal = (body * (0.16 + 0.5 * detail + 0.28 * contour) + rim * 0.95 + (1.0 - body) * detail * 0.75) * shade;
    // Scanlines and a broad interference band, both slow (the band takes ~14 s to climb). The
    // scanlines pass a cell at ~0.35 Hz (at 0.6 a tall hologram's cells beat at 0.6 Hz).
    float scanCoord = uv.y * 46.0 - u_time * 0.35;
    float scan = 0.64 + 0.36 * prefilteredBand(scanCoord, 0.0, 0.5, fwidth(scanCoord));
    float sweep = exp(-pow((fract(uv.y * 0.8 - u_time * 0.07 + seed) - 0.5) * 8.0, 2.0));
    float breathe = 0.84 + 0.16 * sin(u_time * 1.1 + seed * 9.0);
    float level = (1.0 - 0.3 * dropout - 0.25 * wobble) * breathe * (1.0 + 0.4 * sweep);
    // The light cylinder around the axis (radius 0.36 of the width): near and far hits of the view
    // ray, as heights on the quad, in true perspective (rings are ellipses that open as you look
    // down on them and flatten at eye level).
    vec3 oH = rel - down * dot(rel, down), vH = view - down * dot(view, down);
    float cylR = holoW * 0.36, ca = max(dot(vH, vH), 1e-6), cb = dot(oH, vH), cc = dot(oH, oH) - cylR * cylR;
    float disc = cb * cb - ca * cc, root = sqrt(max(disc, 0.0));
    float sNear = (-cb - root) / ca, sFar = (-cb + root) / ca;
    float inCyl = step(0.0, disc), nearOk = inCyl * step(0.0, sNear);
    vec3 hitNear = rel + view * sNear, hitFar = rel + view * sFar;
    float vNear = 0.5 + dot(hitNear, down) / holoH, vFar = 0.5 + dot(hitFar, down) / holoH;
    float vNearFoot = clamp(fwidth(vNear), 0.004, 0.05), vFarFoot = clamp(fwidth(vFar), 0.004, 0.05);
    // World angle of each hit around the axis, unwrapped away from the side it can never be seen
    // on, so patterns on the walls stay put in the world and slide past with true parallax.
    vec3 farFlat = hitFar - down * dot(hitFar, down), nearFlat = hitNear - down * dot(hitNear, down);
    float farAngle = phi + PI + mod(atan(dot(farFlat, frontRight), dot(farFlat, front)) - phi, 2.0 * PI) - PI;
    float nearAngle = phi + mod(atan(dot(nearFlat, frontRight), dot(nearFlat, front)) - phi + PI, 2.0 * PI) - PI;
    // Two scan rings climb from the emitter to the crown, one every ~11 s, each taking ~22 s (on
    // a tall facade hologram that is still under a cell per 0.15 s); where one crosses the
    // figure a bright slice cuts through it.
    float ringClock = u_time * 0.045 + seed * 3.0;
    float ringA = mix(0.95, 0.06, fract(ringClock)), ringB = mix(0.95, 0.06, fract(ringClock + 0.5));
    float fadeA = smoothstep(0.06, 0.3, ringA) * (1.0 - smoothstep(0.82, 0.95, ringA));
    float fadeB = smoothstep(0.06, 0.3, ringB) * (1.0 - smoothstep(0.82, 0.95, ringB));
    float ringFront = nearOk * max((1.0 - smoothstep(vNearFoot * 0.6, vNearFoot * 1.5, abs(vNear - ringA))) * fadeA, (1.0 - smoothstep(vNearFoot * 0.6, vNearFoot * 1.5, abs(vNear - ringB))) * fadeB);
    float ringBack = inCyl * max((1.0 - smoothstep(vFarFoot * 0.6, vFarFoot * 1.5, abs(vFar - ringA))) * fadeA, (1.0 - smoothstep(vFarFoot * 0.6, vFarFoot * 1.5, abs(vFar - ringB))) * fadeB);
    float uvFoot = max(fwidth(uv.y), 0.003);
    float slice = body * max((1.0 - smoothstep(uvFoot * 0.5, uvFoot * 1.5, abs(uv.y - ringA))) * fadeA, (1.0 - smoothstep(uvFoot * 0.5, uvFoot * 1.5, abs(uv.y - ringB))) * fadeB);
    float curtain = 0.0, backMote = 0.0, pulse = 0.0;
#ifndef LITE
    // The data curtain: lit columns on the far wall with slow pulses running down them. Each pulse
    // swells and then fades out before its sawtooth wraps (it used to drop from full in a frame);
    // the fade takes 0.4-1 s at these speeds.
    float colCoord = farAngle * (18.0 / PI), colFoot = min(fwidth(colCoord), 1.0);
    float colRnd = hash(vec2(floor(colCoord), seed * 9.0 + 1.0));
    float pulsePhase = fract(vFar * 5.0 - u_time * (0.12 + 0.18 * colRnd) + colRnd);
    pulse = smoothstep(0.5, 0.88, pulsePhase) * (1.0 - smoothstep(0.88, 1.0, pulsePhase));
    curtain = inCyl * prefilteredBand(colCoord, 0.0, 0.16, colFoot) * step(0.45, colRnd) * smoothstep(0.06, 0.2, vFar) * (1.0 - smoothstep(0.8, 0.95, vFar)) * (0.35 + 0.65 * pulse);
    // Motes drift slowly (a cell every few frames even on a tall facade hologram). A mote glides:
    // the cells within a cell of its point share its light by distance, so it fades from one cell
    // into the next instead of hopping (a hop is a full on/off step in two cells).
    vec2 backGrid = vec2(farAngle * (16.0 / PI), vFar * 26.0 + u_time * 0.3);
    vec2 backFoot = max(fwidth(backGrid), vec2(1e-4));
    float backAway = length((fract(backGrid) - 0.5) / backFoot);
    backMote = inCyl * step(0.93, hash(floor(backGrid) + seed * 23.0)) * (1.0 - smoothstep(0.3, 1.0, backAway)) * (1.0 - smoothstep(0.45, 0.75, max(backFoot.x, backFoot.y))) * step(0.06, vFar) * step(vFar, 0.95);
#endif
    // Dust rising on the near wall: a mote lights the cells within a cell of its grid point (by
    // distance, so it glides between cells) and only appears once its grid is coarser than the
    // cells, so it never aliases.
    vec2 moteGrid = vec2(nearAngle * (14.0 / PI), vNear * 30.0 + u_time * 0.45);
    vec2 moteFoot = max(fwidth(moteGrid), vec2(1e-4));
    float moteAway = length((fract(moteGrid) - 0.5) / moteFoot);
    float mote = nearOk * step(0.94, hash(floor(moteGrid) + seed * 17.0)) * (1.0 - smoothstep(0.3, 1.0, moteAway))
      * (1.0 - smoothstep(0.45, 0.75, max(moteFoot.x, moteFoot.y))) * step(0.06, vNear) * step(vNear, 0.96);
    // The projector cone: a real cone of light from the emitter (closest approach of the view ray
    // to its axis; brightness ~ the chord through it, a brighter skin at its edge), streaked by
    // slowly drifting rays.
    vec3 emitter = centre + down * (0.46 * holoH), w0 = eye - emitter;
    float cbE = -dot(view, down), cdE = dot(view, w0), ceE = -dot(down, w0), cden = max(1.0 - cbE * cbE, 1e-4);
    float along = (ceE - cbE * cdE) / cden, raySpan = max((cbE * ceE - cdE) / cden, 0.0);
    float coneDist = length(w0 + view * raySpan + down * along);
    float coneR = holoW * (0.02 + 0.6 * max(along, 0.0) / holoH);
    float chord = sqrt(max(coneR * coneR - coneDist * coneDist, 0.0)) / max(coneR, 1e-3);
    float coneSpan = smoothstep(0.0, 0.05 * holoH, along) * (1.0 - smoothstep(0.32 * holoH, 0.62 * holoH, along));
    vec2 fromEmitter = vec2(uv.x - 0.5, 0.96 - uv.y);
    float rays = 0.6 + 0.4 * noise2(vec2(fromEmitter.x / max(fromEmitter.y, 0.05) * 9.0, u_time * 0.2 + seed * 7.0));
    float coneLight = (chord * 0.2 + smoothstep(0.0, 0.2, chord) * (1.0 - smoothstep(0.2, 0.5, chord)) * 0.14) * coneSpan * rays;
    // The emitter itself: a lit lens disc (a ray-plane hit, so it is an ellipse from any angle)
    // with a slow halo ring.
    float lensS = -dot(w0, down) / (abs(dot(view, down)) > 1e-4 ? dot(view, down) : 1e-4);
    float lensR = length(w0 + view * lensS) / (holoW * 0.075);
    float lens = step(0.0, lensS) * (1.0 - smoothstep(0.85, 1.0, lensR));
    float halo = step(0.0, lensS) * (1.0 - smoothstep(0.08, 0.2, abs(lensR - 1.6 - 0.25 * sin(u_time * 1.2 + seed * 4.0)))) * 0.6;
    float cover = 0.0;
    bool letterThin = false;
    // The slogan floats in front of the figure (it slides the other way as you walk past). It
    // crawls slowly: at 1.6 letters/s big letters jumped most of a cell per frame and their
    // strokes strobed.
    // The tear glitch moves the slogan as one whole line (the tear of the slice its middle row is
    // in, eased like the figure's): sampled from the per-slice torn uv, slices only ~1.5 letter
    // heights tall cut letters into sideways-shifted strips.
    float sloganSlice = hash(vec2(floor(0.8375 * sliceRows), float(slot) * 7.0)), sloganDrop = hash(vec2(floor(0.8375 * dropRows), floor(slotTime) + seed * 3.0));
    float sloganTear = (wobble * step(0.62, sloganSlice) * (sloganSlice - 0.81) + dropout * 0.7 * step(0.62, sloganDrop) * (sloganDrop - 0.81)) * 0.3;
    vec2 lc = vec2((v_uv.x + sloganTear - 0.05 * sinPhi) * 10.0 + u_time * 0.4 + seed * 40.0, (v_uv.y - 0.79) / 0.095);
    int letter = textGlyph(lc, MESSAGE_ROW + int(u_holoRow), 0.0, cover, letterThin);
    // Whole-slogan legibility (textRunLod over the quad's width at the slogan row): far away its
    // slots fell under a cell and only some letters kept a cell. Below the switch the slogan is
    // not drawn (the projection's own glow stays); around it the slogan cells ease to their paper.
    vec3 sloganMid = centre + axisB * 0.3375 - eye;
    float sloganLod = textRunLod(sloganMid - axisA * 0.5, sloganMid + axisA * 0.5, axisB * 0.095, axisA * 0.1, cameraFocalCells(dFdx(view), dFdy(view)));
    float sloganFade = smoothstep(0.0, 0.22, abs(sloganLod - 0.5));
    bool sloganCell = cover > 0.05 && !landmark;
    if (landmark || sloganLod < 0.5) cover = 0.0;
    float figure = signal * scan * level + slice * 0.5;
    // Strokes need derivatives: taken here, in uniform control flow, before any discard.
    int rimStroke = strokeFor(d), ghostStroke = strokeFor(dGhost), ringStroke = strokeFor(vNear), backStroke = strokeFor(vFar);
    float frontLight = max(ringFront * 0.85, max(lens, halo)) * breathe;
    float backLight = max(ringBack * 0.4, max(curtain * 0.42, backMote * 0.5)) * (1.0 - body) * (1.0 - rim) * (1.0 - 0.7 * small);
    // The slogan glows rather than blazes: its big block letters step a whole cell at a time as
    // the view moves, and at full white those steps were the brightest judder in the street.
    float intensity = max(max(figure, ghostSignal * level), max(cover * breathe * 0.3 * sloganFade, coneLight + mote * 0.6));
    intensity = max(intensity, max(max(frontLight, backLight), wipeFront * 0.8));
    // A plain threshold: a screen-space dither on this breathing, drifting glow made its faint
    // edge sparkle as the view moved.
    if (intensity < 0.14) discard;
    // Two-tone: the first tint low on the figure, shading into the second toward its top and
    // its glowing features. Slogan letters are warm white; the rings and the change-over scan
    // line are pale tint, the far wall the second tint.
    vec3 tint = mix(u_holoTint, u_holoTint2, clamp(0.55 - uv.y * 0.7 + detail * 0.3, 0.0, 0.65));
    vec3 pale = mix(u_holoTint, vec3(1.0), 0.45);
    // Gliding motes: a cell a mote is leaving or entering takes its glyph from just above the
    // discard threshold with its ink faded by the mote's share, so it never pops on at full ink.
    float glide = 1.0;
    if (cover > 0.05) { code = letter; thin = letterThin; tint = vec3(1.0, 0.86, 0.62); }
    else if (wipeFront > 0.5) { code = A_EQ; tint = pale; }
    else if (lens > 0.5) { code = lensR < 0.45 ? A_AT : A_O; tint = vec3(1.0, 0.95, 0.85); }
    else if (ringFront > 0.5) { code = ringStroke == A_DASH ? A_EQ : ringStroke; tint = pale; }
    else if (slice > 0.5) { code = A_EQ; tint = pale; }
    else if (rim > 0.5 && figure > 0.3) { code = rimStroke; }
    else if (body > 0.5 || detail > 0.2) { code = boldRamp(clamp(figure, 0.0, 0.99)); }
    else if (mote > 0.23) { code = A_STAR; thin = true; tint = pale; glide = smoothstep(0.23, 0.75, mote); }
    else if (halo > 0.3) { code = A_DOT; tint = pale; }
    else if (ghostSignal * level > 0.12) { code = ghostRim > 0.5 ? ghostStroke : thinRamp(clamp(ghostSignal * 2.0, 0.0, 0.99)); thin = true; tint = u_holoTint2; }
    else if (ringBack > 0.5) { code = backStroke; thin = true; tint = mix(u_holoTint, u_holoTint2, 0.5); }
    else if (backMote > 0.28) { code = A_DOT; thin = true; tint = u_holoTint2; glide = smoothstep(0.28, 0.75, backMote); }
    else if (curtain > 0.3) { code = pulse > 0.5 ? A_PIPE : A_COLON; thin = true; tint = u_holoTint2; }
    else { code = thinRamp(clamp(coneLight * 3.5, 0.0, 0.99)); thin = true; }
    ink = tint * (0.45 + intensity * 1.5) * glide;
    paper = tint * (0.03 + intensity * 0.12);
    // Around the slogan's switch its letter cells (or, just past it, the figure in those cells)
    // ease onto their paper, so the letters leave at zero contrast instead of popping.
    if (sloganCell) ink = mix(paper, ink, sloganFade);
    emission = ink * 0.5;
  } else if (${on(6, "SURFACE > 5.5")}) {
#ifdef BATCH
    // Ticker band: one message scrolling continuously around every face of the tower, so the
    // letters travel around the corners. Housing rails top and bottom.
    vec3 l = p - v_center, h = v_dims * 0.5;
    float w = 2.0 * h.x, d = 2.0 * h.z;
    float s = abs(n.z) > 0.5 ? (n.z > 0.0 ? l.x + h.x : w + d + (h.x - l.x)) : (n.x > 0.0 ? w + (h.z - l.z) : 2.0 * w + d + (l.z + h.z));
    float v = (l.y + h.y) / (2.0 * h.y);
    vec3 neon = v_glyphColor.rgb;
    int row = MESSAGE_ROW + int(v_glyphColor.a * 255.0 + 0.5);
    float letterWorld = 2.0 * h.y * 0.74;
    float railCells = 0.13 * 2.0 * h.y / max(cellWorld, 0.001);
    // Letter coordinates and their derivatives are taken here, before the rail/letter branch:
    // derivatives inside a branch that the neighbouring cell skipped are undefined, and the row
    // next to each rail read garbage sizes (stray 8x8 letter pieces along the band's top row).
    // The message crawls at 1.6 letters/s (2.2 turned each cell of a near band over more than
    // twice a second).
    vec2 lc = vec2(s / letterWorld + u_time * 1.6, (v - 0.13) / 0.74);
    vec2 lcDx = dFdx(lc), lcDy = dFdy(lc);
    // Whole-face level of detail (the shop signs' rule, textRunLod). A per-letter threshold on the
    // per-cell letter height kept some letters and dropped others along a face seen at a grazing
    // angle (its slots squeezed under a cell lost their one-character cell): "L D F OR A WA M"
    // scattered over staggered rows. Each tower face is one text run, decided once from the face's
    // two ends (world-fixed, distance only), so a face shows every letter or none.
    vec3 faceOut = abs(n.z) > 0.5 ? vec3(0.0, 0.0, sign(n.z) * h.z) : vec3(sign(n.x) * h.x, 0.0, 0.0);
    vec3 faceRun = abs(n.z) > 0.5 ? vec3(h.x, 0.0, 0.0) : vec3(0.0, 0.0, h.z);
    vec3 faceMid = v_center + faceOut - eye;
    float tickerLod = textRunLod(faceMid - faceRun, faceMid + faceRun, vec3(0.0, letterWorld, 0.0), normalize(faceRun + vec3(1e-4)) * letterWorld, cameraFocalCells(dFdx(view), dFdy(view)));
    // Around the switch the face dissolves through a plain lit panel (as signFade on the signs).
    float tickerFade = smoothstep(0.0, 0.22, abs(tickerLod - 0.5));
    // A slow, shallow swell travelling round the band (~0.24 Hz, +-8%); at 0.48 Hz and +-15%
    // the lit inverted stretches visibly throbbed.
    float pulse = 0.92 + 0.08 * sin(u_time * 1.5 + s * 0.2);
    if (abs(n.y) > 0.5) { code = A_EQ; paper = neon * 0.05; ink = neon * 0.25; }
    else if (v < 0.13 || v > 0.87) {
      code = railCells > 0.6 ? A_EQ : A_DASH; ink = neon * 0.55; paper = neon * 0.1;
    } else if (tickerLod < 0.5) {
      // Far tier: a soft lit '=' bar in the text colour along the whole letter row - no letters,
      // no word gaps, no inverted stretches or market colours, so the scroll is invisible here.
      code = A_EQ; thin = false;
      ink = neon * 0.62 * pulse; paper = neon * 0.12; emission = neon * 0.22;
    } else {
      float cover = 0.0;
      code = textGlyphD(lc, lcDx, lcDy, row, 0.0, cover, thin);
      int k = int(floor(lc.x));
      // Market data: a figure signed "+" reads green, "-" red (classes precomputed per character
      // by scene-data.ts marketClasses, so phone numbers and times stay neutral).
      int mark = messageClass(row, k);
      vec3 hue = mark == 1 ? vec3(0.3, 1.0, 0.45) : mark == 2 ? vec3(1.0, 0.24, 0.2) : neon;
      // Now and then a stretch of the message runs inverted (lit band, dark letters); it scrolls
      // with the text, so nothing flashes.
      bool inverted = hash(vec2(floor(float(k) / 9.0), float(row) * 1.7 + v_center.x * 0.013)) > 0.86;
      ink = hue * (0.5 + 1.4 * cover) * pulse;
      paper = hue * (0.04 + 0.16 * cover);
      emission = hue * cover * 0.8;
      if (cover < 0.05) { code = A_SPACE; ink = hue * 0.2; }
      if (inverted) {
        paper = neon * 0.62 * pulse; emission = neon * 0.45;
        ink = cover > 0.05 ? vec3(0.01, 0.015, 0.02) + hue * 0.08 : neon * 0.8;
        if (cover < 0.05) code = A_SPACE;
      }
    }
    // The tier swap happens at zero contrast: the letter row of the whole face eases onto one
    // shared lit-panel paper (inverted stretches included) and back, so the bar and the letters
    // never show at once. Driven by distance only: standing still it holds.
    if (abs(n.y) <= 0.5 && v >= 0.13 && v <= 0.87 && tickerFade < 1.0) {
      paper = mix(neon * 0.14 * pulse, paper, tickerFade);
      ink = mix(paper, ink, tickerFade);
      emission = mix(neon * 0.2, emission, tickerFade);
    }
#endif
  } else if (${on(5, "SURFACE > 4.5")}) {
    // Hologram screen: a street display flipping slowly between channels - the live synth
    // broadcast, falling data rain, an oscilloscope, a district map under a radar sweep, an ad in
    // big letters, and four that read as video: a face cam panning slowly over an ASCII bust, a
    // weather map with a cold front sweeping across, the news (footage box, LIVE tag, headline
    // crawl) and a product turning on a turntable. Every one changes a cell at most a time or two
    // a second. A screen keeps a channel ~9 s; the next one arrives as an ordered-dither wipe
    // running down the panel over ~1 s while the panel is eased down to half brightness - a dim
    // cut, never a flash.
    vec2 uv = v_uv;
    float seed = u_holoSeed;
    // Everything that needs derivatives first, in uniform control flow (during a wipe the
    // channel differs between neighbouring cells).
    vec2 foot = max(fwidth(uv), vec2(1e-4));
    vec2 rainGrid = vec2(12.0, 20.0), rain = uv * rainGrid, rainFoot = foot * rainGrid;
    float adCover = 0.0;
    bool adThin = false;
    int adLetter = textGlyph(vec2(uv.x * 2.4 + u_time * 0.6 + seed * 30.0, (uv.y - 0.3) / 0.4), MESSAGE_ROW + int(u_holoRow), 0.0, adCover, adThin);
    // The news channel's headline crawl (another message), 0.8 letters/s along the lower band.
    float newsCover = 0.0;
    bool newsThin = false;
    int newsLetter = textGlyph(vec2(uv.x * 7.0 + u_time * 0.8 + seed * 20.0, (uv.y - 0.8) / 0.11), MESSAGE_ROW + (int(u_holoRow) + 5) % MESSAGE_COUNT, 0.0, newsCover, newsThin);
    // Whole-line legibility of the advert and the headline (textRunLod across the panel at each
    // text row; the panel's world axes from the quad itself, exact on a plane): a screen seen far
    // or edge-on drew only the letters whose slot still claimed a cell. Below the switch the line
    // is the plain lit panel; around it its letter cells ease onto their paper (adFade/newsFade).
    vec2 scrUvX = dFdx(v_uv), scrUvY = dFdy(v_uv);
    vec3 scrPX = dFdx(p), scrPY = dFdy(p);
    float scrDet = scrUvX.x * scrUvY.y - scrUvX.y * scrUvY.x;
    scrDet = abs(scrDet) < 1e-12 ? 1e-12 : scrDet;
    vec3 scrA = (scrPX * scrUvY.y - scrPY * scrUvX.y) / scrDet, scrB = (scrPY * scrUvX.x - scrPX * scrUvY.x) / scrDet;
    vec3 scrMid = p + scrA * (0.5 - v_uv.x) + scrB * (0.5 - v_uv.y) - eye;
    float scrFocal = cameraFocalCells(dFdx(view), dFdy(view));
    float adLod = textRunLod(scrMid - scrA * 0.5, scrMid + scrA * 0.5, scrB * 0.4, scrA / 2.4, scrFocal);
    float newsLod = textRunLod(scrMid + scrB * 0.355 - scrA * 0.5, scrMid + scrB * 0.355 + scrA * 0.5, scrB * 0.11, scrA / 7.0, scrFocal);
    float adFade = smoothstep(0.0, 0.22, abs(adLod - 0.5)), newsFade = smoothstep(0.0, 0.22, abs(newsLod - 0.5));
    if (adLod < 0.5) adCover = 0.0;
    if (newsLod < 0.5) newsCover = 0.0;
    float clock = u_time / 9.0 + seed * 7.0;
    float wipe = smoothstep(0.0, 0.12, fract(clock));
    // The panel dims to ~45% around each channel change (easing down over ~1.2 s before the wipe
    // and back up after it), so the cut swaps glyphs in a dim panel instead of popping at full
    // brightness. cutAway: seconds from the middle of the wipe (0.54 s into the slot).
    float cutAway = abs(fract(clock - 0.06 + 0.5) - 0.5) * 9.0;
    float cutDim = mix(0.45, 1.0, smoothstep(0.4, 1.6, cutAway));
    bool fresh = uv.y + (bayer(gl_FragCoord.xy) - 0.5) * 0.12 < wipe * 1.2 - 0.06;
    int channel = clamp(int(hash(vec2(floor(clock) - (fresh ? 0.0 : 1.0), seed * 19.0 + 3.0)) * 9.0), 0, 8);
    float edge = step(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)), 0.03);
    vec3 phosphor = mix(vec3(0.1, 0.8, 0.95), vec3(1.0, 0.25, 0.65), step(0.5, fract(seed * 3.7)));
    if (channel == 0) {
      // The synth feed's own cells, re-lit as an emissive panel.
      vec2 size = vec2(textureSize(u_feedInk, 0));
      ivec2 texel = ivec2(clamp(vec2(uv.x, 1.0 - uv.y) * size, vec2(0.0), size - 1.0));
      vec3 feedInk = texelFetch(u_feedInk, texel, 0).rgb, feedPaper = texelFetch(u_feedPaper, texel, 0).rgb;
      feedGlyph = texelFetch(u_feedGlyph, texel, 0).rgb; useFeed = edge < 0.5;
      ink = feedInk * 1.35; paper = feedPaper * 1.3 + feedInk * 0.14;
      emission = feedInk * 0.6;
    } else if (channel == 1) {
      // Data rain: fixed characters per grid cell (drawn in the one screen cell nearest each grid
      // point), lit by heads falling down their columns. Far away it settles to an even shimmer-
      // free texture.
      vec2 vc = floor(rain);
      float speed = 2.0 + 3.0 * hash(vec2(vc.x, seed));
      // The head runs well past the bottom before it wraps (the trail has faded to ~2% by then: at
      // 1.25 the bottom glyphs dropped from ~20% to dark in a frame), and each glyph eases on
      // over ~0.3-0.6 s as the head reaches it instead of snapping to full.
      float head = fract(u_time * speed / rainGrid.y + hash(vec2(vc.x, seed + 3.0))) * 1.8 - 0.2;
      float behind = head - (vc.y + 0.5) / rainGrid.y;
      float glow = smoothstep(-0.06, 0.0, behind) * exp(-max(behind, 0.0) * 6.0);
      bool centre = abs(floor((fract(rain.x) - 0.5) / rainFoot.x + 0.5)) + abs(floor((fract(rain.y) - 0.5) / rainFoot.y + 0.5)) < 0.5;
      bool sharp = max(rainFoot.x, rainFoot.y) < 0.9;
      int glyphs[8] = int[8](A_ZERO, A_ONE, A_COLON, A_EQ, A_PLUS, A_X, A_DOLLAR, A_HASH);
      vec3 green = vec3(0.3, 1.0, 0.55);
      // A glyph's ink follows its glow all the way down (it appears and goes out near black, not
      // at ~40% green), and the white head eases in and out over ~0.3-1 s.
      if (sharp) { code = centre && glow > 0.03 ? glyphs[clamp(int(hash(vc + seed * 7.0) * 8.0), 0, 7)] : A_SPACE; thin = glow < 0.5; }
      else { code = A_COLON; thin = true; glow = 0.25; }
      ink = sharp ? green * (1.9 * glow) + vec3(0.7) * smoothstep(-0.06, 0.0, behind) * (1.0 - smoothstep(0.0, 0.1, behind)) : green * 0.675;
      paper = green * (0.015 + 0.06 * glow);
      emission = green * glow * 0.4;
    } else if (channel == 2) {
      // Oscilloscope: a phosphor trace drawn with the stroke that follows its slope, on a grid.
      float x1 = uv.x + foot.x;
      float y0 = 0.5 + 0.2 * sin(uv.x * 11.0 + u_time * 1.3) * cos(uv.x * 3.7 - u_time * 0.5) + 0.07 * sin(uv.x * 27.0 - u_time * 1.9);
      float y1 = 0.5 + 0.2 * sin(x1 * 11.0 + u_time * 1.3) * cos(x1 * 3.7 - u_time * 0.5) + 0.07 * sin(x1 * 27.0 - u_time * 1.9);
      float slope = (y1 - y0) / foot.y, away = abs(uv.y - y0) / foot.y;
      float trace = 1.0 - smoothstep(0.5 + abs(slope) * 0.5, 1.0 + abs(slope) * 0.5, away);
      float grid = max(prefilteredBand(uv.x * 6.0, 0.0, 0.08, foot.x * 6.0), prefilteredBand(uv.y * 8.0, 0.0, 0.08, foot.y * 8.0));
      vec3 scope = vec3(0.35, 1.0, 0.7);
      code = trace > 0.5 ? (abs(slope) < 0.45 ? A_DASH : abs(slope) > 2.4 ? A_PIPE : slope > 0.0 ? A_BSLASH : A_SLASH) : grid > 0.5 ? A_DOT : A_SPACE;
      thin = trace <= 0.5;
      ink = trace > 0.5 ? scope * 1.8 : scope * 0.35;
      paper = scope * (0.02 + 0.05 * grid + 0.12 * trace);
      emission = scope * trace * 0.6;
    } else if (channel == 3) {
      // District map: street grid, blocks, a radar sweep (one turn per ~9 s) and a target marker.
      vec2 m = uv * vec2(4.0, 6.0);
      float across = prefilteredBand(m.x, 0.0, 0.12, foot.x * 4.0), along = prefilteredBand(m.y, 0.0, 0.12, foot.y * 6.0);
      float block = hash(floor(m) + seed * 5.0);
      vec2 c = (uv - 0.5) * vec2(1.0, 1.5);
      // The sweep's leading edge eases up over ~0.6 s just ahead of the beam and its afterglow
      // decays over ~1.2 s (a cell used to jump from dark to full as the beam reached it).
      float behindSweep = mod(u_time * 0.7 + seed * 6.2832 - atan(c.y, c.x), 6.2832);
      float radar = max(exp(-behindSweep * 1.2), smoothstep(5.88, 6.2832, behindSweep)) * (1.0 - smoothstep(0.45, 0.75, length(c)));
      vec2 target = vec2(0.5 + 0.28 * sin(u_time * 0.21 + seed * 9.0), 0.5 + 0.32 * cos(u_time * 0.17 + seed * 4.0));
      // The marker glides: the cells within a cell of it share it by distance.
      float targetLit = 1.0 - smoothstep(0.3, 1.0, length((uv - target) / foot));
      vec3 mapInk = vec3(0.25, 0.75, 1.0);
      code = across > 0.5 && along > 0.5 ? A_PLUS : across > 0.5 ? A_PIPE : along > 0.5 ? A_DASH : block > 0.72 ? A_COLON : A_SPACE;
      thin = across <= 0.5 && along <= 0.5;
      ink = mapInk * (0.4 + radar * 1.0 + max(across, along) * 0.3);
      paper = mapInk * (0.02 + 0.07 * radar) + vec3(0.02, 0.01, 0.03) * block;
      emission = mapInk * radar * 0.35;
      if (targetLit > 0.5) { code = A_AT; thin = false; }
      ink = mix(ink, vec3(1.0, 0.3, 0.25) * 1.8, targetLit); emission = mix(emission, ink * 0.4, targetLit);
    } else if (channel == 4) {
      // Advert: the tower's message in big letters crawling across a tinted panel.
      code = adCover > 0.05 ? adLetter : A_SPACE; thin = adThin;
      paper = phosphor * (0.07 + 0.08 * uv.y) + phosphor * adCover * 0.12 * adFade;
      ink = adCover > 0.05 ? mix(paper, vec3(1.0, 0.92, 0.75) * (0.8 + adCover), adFade) : phosphor * 0.3;
      emission = phosphor * (0.15 + adCover * 0.5 * adFade);
    } else if (channel == 5) {
      // Face cam: a slow documentary pan and push-in (one sway per ~2 min) over an ASCII bust lit
      // from the side - head, hair, eyes, mouth and shoulders shaded through the bold ramp.
      float pan = u_time * 0.05 + seed * 6.0, zoom = 1.25 + 0.2 * sin(pan * 0.6);
      vec2 f = (uv - vec2(0.5 + 0.1 * sin(pan), 0.4 + 0.06 * sin(pan * 0.7 + 1.0))) * vec2(0.667, 1.0) / (0.22 * zoom);
      float head = length(f / vec2(0.78, 1.0));
      float shoulders = length((f - vec2(0.0, 2.05)) / vec2(1.9, 0.75));
      bool neck = abs(f.x) < 0.34 && f.y > 0.6 && f.y < 1.6;
      vec3 nrm = normalize(vec3(f.x / 0.78, f.y, sqrt(max(1.0 - head * head, 0.0)) + 0.05));
      float lum = head < 1.0 ? max(dot(nrm, normalize(vec3(-0.6, -0.35, 0.72))), 0.0) * 0.85 + 0.1 : neck ? 0.22 : shoulders < 1.0 ? 0.3 + 0.25 * (1.0 - shoulders) : 0.0;
      bool hair = head < 1.06 && f.y < -0.38 + 0.12 * f.x * f.x;
      bool eyeLine = head < 1.0 && length((vec2(abs(f.x), f.y) - vec2(0.3, -0.06)) / vec2(1.0, 0.45)) < 0.11;
      bool mouth = head < 1.0 && abs(f.y - 0.52) < 0.05 && abs(f.x) < 0.22;
      vec3 skin = mix(vec3(1.0, 0.74, 0.58), phosphor, 0.35);
      code = hair ? A_PCT : eyeLine || mouth ? A_DASH : lum > 0.02 ? boldRamp(clamp(lum, 0.0, 0.99)) : A_SPACE;
      thin = !hair && lum < 0.3;
      ink = hair ? phosphor * 0.55 : eyeLine || mouth ? vec3(0.05, 0.04, 0.05) : skin * (0.35 + 1.1 * lum);
      paper = hair ? phosphor * 0.08 : skin * lum * 0.16 + phosphor * 0.03;
      emission = skin * lum * 0.3;
    } else if (channel == 6) {
      // Weather map: a fixed coast, isobars drifting east, a cold front (> teeth on its line)
      // crossing the map in ~45 s with rain behind it, and the low (L) that drives it. The front's
      // cycle runs far enough past the right edge that its rain band and the L have left the
      // panel before it wraps (at 1.5 the rain behind it vanished in a frame); the front line and
      // the L glide between cells and the rain eases in and out at the band's edges.
      vec2 m = uv * vec2(0.667, 1.0);
      float land = noise2(m * 3.2 + seed * 7.0) + (0.5 - uv.x) * 0.35;
      float press = noise2(m * 2.0 + vec2(-u_time * 0.015, seed * 3.0)) * 9.0;
      float isobar = prefilteredBand(press, 0.0, 0.12, max(foot.x, foot.y) * 9.0 * 2.0);
      float frontX = fract(u_time * 0.012 + seed) * 1.8 - 0.25 + 0.1 * sin(uv.y * 5.0 + seed * 4.0);
      float frontLit = 1.0 - smoothstep(0.3, 1.0, abs(uv.x - frontX) / foot.x);
      bool rainy = uv.x < frontX && uv.x > frontX - 0.28 && hash(floor(rain) + 3.1) > 0.55
        && abs(floor((fract(rain.x) - 0.5) / rainFoot.x + 0.5)) + abs(floor((fract(rain.y) - 0.5) / rainFoot.y + 0.5)) < 0.5;
      float rainLit = smoothstep(0.0, 0.03, frontX - uv.x) * smoothstep(0.0, 0.05, uv.x - frontX + 0.28);
      float lowLit = 1.0 - smoothstep(0.3, 1.0, length((uv - vec2(frontX - 0.18, 0.38)) / foot));
      vec3 sea = vec3(0.05, 0.12, 0.3), green = vec3(0.35, 0.8, 0.45), front = vec3(0.35, 0.6, 1.0);
      code = land > 0.53 ? A_DOT : A_SPACE; thin = true;
      ink = land > 0.53 ? green * 0.7 : sea; paper = land > 0.53 ? green * 0.06 : sea * 0.35;
      if (isobar > 0.5) { code = A_TILDE; ink = vec3(0.75, 0.85, 1.0) * 0.8; }
      if (rainy) { code = A_SLASH; ink = mix(ink, vec3(0.4, 0.8, 1.0), rainLit); }
      if (frontLit > 0.5) { code = int(floor(uv.y / foot.y)) % 3 == 0 ? A_GT : A_PIPE; thin = false; }
      ink = mix(ink, front * 1.6, frontLit); paper += front * 0.1 * frontLit;
      if (lowLit > 0.5) { code = 76; thin = false; }
      ink = mix(ink, vec3(1.0, 0.3, 0.25) * 1.8, lowLit);
      emission = ink * 0.25;
    } else if (channel == 7) {
      // News: a footage box (a skyline panning slowly past), a red LIVE tag with a slow lamp,
      // and the headline crawling along the band below.
      vec3 red = vec3(1.0, 0.22, 0.2);
      if (uv.y > 0.76 && uv.y < 0.97) {
        code = newsCover > 0.05 ? newsLetter : A_SPACE; thin = newsThin;
        paper = (uv.y < 0.785 ? red * 0.5 : vec3(0.06, 0.08, 0.2)) + red * 0.04;
        ink = newsCover > 0.05 ? mix(paper, vec3(1.0, 0.95, 0.88) * (0.9 + newsCover), newsFade) : red * 0.4;
        emission = ink * newsCover * 0.3 * newsFade;
      } else if (uv.x < 0.3 && uv.y < 0.1) {
        bool lamp = abs(floor((uv.x - 0.06) / foot.x + 0.5)) + abs(floor((uv.y - 0.05) / foot.y + 0.5)) < 0.5;
        code = lamp ? A_O : A_EQ; thin = !lamp;
        ink = lamp ? vec3(1.0, 0.9, 0.85) * (1.0 + 0.25 * sin(u_time * 1.5)) : red * 1.1; paper = red * 0.45; emission = red * 0.3;
      } else {
        float sx = uv.x + u_time * 0.01 + seed * 3.0;
        float roof = 0.32 + 0.3 * hash(vec2(floor(sx * 9.0), seed * 2.0));
        bool tower = uv.y > roof && uv.y < 0.74;
        bool window = tower && prefilteredBand(sx * 54.0, 0.0, 0.4, foot.x * 54.0) > 0.5 && prefilteredBand(uv.y * 40.0, 0.0, 0.4, foot.y * 40.0) > 0.5;
        code = window ? A_COLON : tower ? A_HASH : A_SPACE; thin = window;
        ink = window ? vec3(1.0, 0.8, 0.45) : vec3(0.18, 0.22, 0.32);
        paper = tower ? vec3(0.04, 0.05, 0.08) : mix(vec3(0.25, 0.1, 0.2), vec3(0.03, 0.04, 0.1), uv.y * 1.4);
        emission = window ? ink * 0.2 : vec3(0.0);
      }
    } else {
      // Product: a can turning on a lit turntable (one turn per ~20 s) - shaded body, label
      // stripes wrapping round it, a fixed highlight, rims and the turntable ring.
      vec2 c = (uv - vec2(0.5, 0.44)) * vec2(0.667, 1.0);
      float around = asin(clamp(c.x / 0.14, -1.0, 1.0)), spin = around + u_time * 0.3 + seed * 6.0;
      bool can = abs(c.x) < 0.14 && abs(c.y) < 0.22;
      float rimTop = abs(length((c - vec2(0.0, -0.22)) / vec2(0.14, 0.03)) - 1.0), rimBase = abs(length((c - vec2(0.0, 0.22)) / vec2(0.14, 0.03)) - 1.0);
      float table = abs(length((c - vec2(0.0, 0.27)) / vec2(0.3, 0.05)) - 1.0);
      float lum = 0.2 + 0.7 * cos(around) * cos(around);
      bool label = abs(c.y) < 0.09, stripe = fract(spin * 0.32 + c.y * 3.0) < 0.5;
      bool shine = abs(around + 0.55) < 0.12;
      code = A_SPACE; thin = true; ink = phosphor * 0.3; paper = phosphor * 0.03 + vec3(0.01, 0.01, 0.02);
      if (table < 0.12) { code = A_EQ; ink = phosphor * 1.2; paper += phosphor * 0.08; }
      if (can) {
        code = shine ? A_PIPE : label ? (stripe ? A_HASH : A_EQ) : boldRamp(clamp(lum * 0.8, 0.0, 0.99)); thin = false;
        vec3 body = label ? (stripe ? vec3(1.0, 0.3, 0.35) : vec3(1.0, 0.92, 0.85)) : vec3(0.75, 0.8, 0.85);
        ink = shine ? vec3(1.2) : body * (0.35 + lum); paper = body * lum * 0.15;
      }
      if (rimTop < 0.25 || (rimBase < 0.25 && c.y > 0.22)) { code = A_O; thin = true; ink = vec3(0.85, 0.9, 0.95) * 0.9; }
      emission = ink * 0.2;
    }
    ink *= cutDim; paper *= cutDim; emission *= cutDim;
    if (edge > 0.5) { code = A_HASH; thin = false; useFeed = false; ink = vec3(0.1, 0.55, 0.62); paper = ink * 0.3; }
  } else if (${on(4, "SURFACE > 3.5")}) {
    // Sky dome: smog lit from below, slow cloud banks, sparse stars through the gaps.
    isSky = true;
    vec3 direction = normalize(p - eye);
    float up = -direction.y;
    paper = skyColor(direction);
    // Weather agent: the cloud deck thickens with the rain (weather.ts, over minutes) and is lit from
    // below by the city - sodium everywhere over the streets, a magenta-teal wash and slow light-
    // pollution curtains over the Neon Ward - and goes dark out over the harbour (+z past the rim,
    // WORLD_EDGE 768), the only sky where stars and the moon's disc show. 'deck' is where the view
    // ray meets the deck ~420 m up; it only feeds low-frequency terms, so it cannot alias.
    float rainNow = weatherRain(), skyAz = atan(direction.z, direction.x);
    vec2 plane = direction.xz / max(up + 0.12, 0.05);
    // Sky agent: the low deck is broad banks (a noise cell spans ~40 deg overhead) plus a finer
    // texture that fades out toward the horizon before it could alias (there the plane compresses).
    // Both drift on one slow wind, ~0.0012 plane units/s = ~0.5 m/s at the deck's 420 m, under a
    // tenth of a cell per second on screen; the texture shears a little against the banks.
    vec2 wind = vec2(0.0012, 0.0004) * u_time;
    float banks = noise2(plane * 1.0 + wind + vec2(3.7, 1.9));
    float fine = noise2(plane * 2.6 + wind * 3.0 + vec2(u_time * 0.0005, 0.0));
    float cover = mix(banks, banks * 0.6 + fine * 0.4, smoothstep(0.1, 0.35, up));
    // ~half the dome is cloud, with real breaks between banks; the rain closes the gaps (weather.ts).
    float clouds = smoothstep(0.42 - 0.1 * rainNow, 0.7 - 0.06 * rainNow, cover) * smoothstep(-0.02, 0.2, up);
    vec2 deck = eye.xz + direction.xz * min(max(420.0 + eye.y, 20.0) / max(up, 0.04), 6000.0);
    float harbour = smoothstep(668.0, 1018.0, deck.y), cityLit = 1.0 - 0.75 * harbour;
    // The Neon Ward (centre 0, -320; ~450 m across) glows over its own patch of sky: overhead from
    // inside it, a dome rising over its bearing from outside, lower the further away you are.
    vec2 toWard = vec2(0.0, -320.0) - eye.xz;
    float wardDistance = length(toWard), facing = dot(direction.xz / max(length(direction.xz), 1e-4), toWard / max(wardDistance, 1.0));
    float neonWard = wardDistance < 450.0 ? 1.0 : smoothstep(cos(min(atan(450.0, wardDistance) * 1.6, 3.0)), 1.0, facing);
    float wardTop = atan(520.0, max(wardDistance - 300.0, 1.0));
    neonWard *= 1.0 - smoothstep(wardTop * 0.5, wardTop * 1.2 + 0.05, asin(clamp(up, -1.0, 1.0)));
    // Curtains: ~20 cells apart in direction space, rising off the skyline, drifting over minutes.
    float curtain = 0.5 + 0.5 * sin(skyAz * 18.0 + noise2(normalize(direction.xz) * 2.0 + u_time * 0.012) * 4.0 + u_time * 0.02);
    float bands = neonWard * curtain * curtain * smoothstep(0.03, 0.12, up) * (1.0 - smoothstep(0.2, 0.55, up));
    paper += mix(vec3(0.15, 0.025, 0.095), vec3(0.02, 0.1, 0.12), 0.5 + 0.5 * sin(skyAz * 3.0 + u_time * 0.01)) * bands * (0.6 + 0.4 * clouds);
    // Sky agent: every district lights the deck from below in its own colour (weather.ts
    // districtSkyLight; the Ward's old magenta wash is now its share of it): 'under' at the patch
    // of deck this ray meets, 'skyline' over the city along this bearing (~280 m and ~640 m out).
    // Low-frequency terms only, and all of it stays well below the neon.
    vec2 bearing = direction.xz / max(length(direction.xz), 1e-4);
    vec2 nearSample = eye.xz + bearing * 280.0, farSample = eye.xz + bearing * 640.0;
    vec3 under = vec3(0), skylineNear = vec3(0), skylineFar = vec3(0);
    ${districtSkyLightGlsl("deck", "under")}
    ${districtSkyLightGlsl("nearSample", "skylineNear")}
    ${districtSkyLightGlsl("farSample", "skylineFar")}
    vec3 skyline = (skylineNear + skylineFar) * 0.5;
    // The low deck's underside: brightest where it is thick, low over the districts, and in the rain.
    // Sky agent: the deck is lit by the district under it ('under') and, low down where the ray
    // meets the deck beyond the city rim, by the skyline's glow along this bearing - so the clouds
    // over the horizon catch the same tint as the haze the far towers stand in. Brightest low and
    // thick; the breaks between banks stay dark, and darken further toward the zenith.
    float lowDeck = exp(-max(up, 0.0) * 2.6);
    vec3 deckLight = (under + skyline * 0.8 * exp(-max(up, 0.0) * 4.0)) * cityLit * (0.85 + 0.3 * rainNow);
    paper *= 1.0 - 0.4 * (1.0 - clouds) * smoothstep(0.08, 0.5, up);
    paper += deckLight * (0.008 + 0.17 * clouds * (0.25 + 0.75 * lowDeck));
    // The banks' own sodium-grey body, so even an unlit stretch of deck reads as cloud, not void.
    paper += (vec3(0.016, 0.017, 0.022) + vec3(0.03, 0.016, 0.008) * lowDeck) * clouds * cityLit;
    // A higher, thinner layer, streaked along the wind and drifting across it over minutes, seen
    // through the gaps of the low deck and lit more faintly.
    float upper = noise2(plane * vec2(0.42, 1.05) + vec2(7.3 - u_time * 0.0045, u_time * 0.003));
    upper = smoothstep(0.52, 0.86, upper) * smoothstep(0.06, 0.35, up) * (1.0 - clouds);
    paper += (under * 0.4 + vec3(0.01, 0.012, 0.018)) * upper * 0.6 * cityLit;
    // The glow band over the skyline: the colour of the districts under the horizon in this bearing.
    float skylineBand = exp(-max(up, 0.0) * 9.0) * smoothstep(-0.04, 0.01, up);
    paper += skyline * skylineBand * (0.11 + 0.06 * clouds);
    // Rain curtains out over the city: broad veils from the deck to the horizon, drifting over
    // minutes, a faint lit density rather than streaks (they are a kilometre away). The noise runs
    // round the bearing circle, so there is no seam behind the viewer.
    float shower = smoothstep(0.45, 0.8, noise2(bearing * 3.0 + vec2(u_time * 0.004, 5.1 - u_time * 0.003)));
    float veil = shower * smoothstep(0.15, 0.7, rainNow) * smoothstep(-0.02, 0.02, up) * (1.0 - smoothstep(0.04, 0.22, up));
    paper = mix(paper, vec3(0.028, 0.032, 0.038) + skyline * 0.07, veil * 0.5);
    // Data haze over the Signal Cathedral (weather.ts DATA_HAZE): a ragged curtain on a ring round
    // it, Ghost Circuit blue fading to teal with height, ray-folded, breathing over 26 s. The ray
    // meets the ring at up to two points (near and far side); everything moves over tens of seconds.
    vec2 hazeRel = eye.xz - vec2(${DATA_HAZE.x.toFixed(1)}, ${DATA_HAZE.z.toFixed(1)});
    float hazeB = dot(hazeRel, direction.xz), hazeA = max(dot(direction.xz, direction.xz), 1e-5);
    float hazeRoot = hazeB * hazeB - hazeA * (dot(hazeRel, hazeRel) - ${(DATA_HAZE.radius * DATA_HAZE.radius).toFixed(1)});
    vec3 hazeLight = vec3(0);
    float dataHaze = 0.0;
    if (hazeRoot > 0.0) {
      hazeRoot = sqrt(hazeRoot);
      // Where the ray only grazes the ring the curtain thins out, so its sides have no hard edge.
      float graze = smoothstep(0.0, 110.0, hazeRoot / hazeA);
      for (int k = 0; k < 2; k++) {
        float reach = (-hazeB + (k == 0 ? -hazeRoot : hazeRoot)) / hazeA;
        if (reach <= 0.0) continue;
        vec2 hit = (hazeRel + direction.xz * reach) / ${DATA_HAZE.radius.toFixed(1)};
        float fold = noise2(hit * 2.0 + vec2(u_time * 0.015, float(k) * 3.0 - u_time * 0.008));
        float rise = (up * reach - eye.y - ${DATA_HAZE.bottom.toFixed(1)} - 50.0 * fold) / ${(DATA_HAZE.top - DATA_HAZE.bottom).toFixed(1)};
        float sheet = smoothstep(0.0, 0.28, rise) * (1.0 - smoothstep(0.35, 1.0, rise)) * graze;
        float rays = 0.5 + 0.5 * sin(atan(hit.y, hit.x) * 14.0 + fold * 5.0 + u_time * 0.03);
        float w = sheet * (0.4 + 0.6 * rays * rays) * (k == 0 ? 1.0 : 0.55);
        dataHaze += w;
        hazeLight += mix(vec3(0.33, 0.42, 1.0), vec3(0.2, 0.85, 0.8), clamp(rise, 0.0, 1.0)) * w;
      }
      float hazeGain = ${DATA_HAZE_BREATH_GLSL} * (1.0 - smoothstep(1300.0, 2200.0, length(hazeRel)));
      dataHaze *= hazeGain; hazeLight *= hazeGain;
      paper += hazeLight * 0.085;
    }
    // A faint moon over the harbour: a halo through the deck, the disc only through its gaps.
    float moon = dot(direction, normalize(vec3(0.3, -0.38, 0.87)));
    paper += vec3(0.05, 0.06, 0.07) * exp((moon - 1.0) * 90.0) * (1.0 - 0.4 * clouds);
    // Distant sheet lightning: one soft 1.8 s swell of a cloud bank (weather.ts), never a flash.
    vec2 flash = sheetLightning(rainNow);
    if (flash.x > 0.0) {
      float off = mod(skyAz - flash.y + PI, 2.0 * PI) - PI;
      paper += vec3(0.09, 0.09, 0.115) * flash.x * exp(-off * off * 5.0) * (0.25 + clouds) * smoothstep(-0.02, 0.15, up) * cityLit;
    }
    paper = min(paper, vec3(0.26)); // Sky agent: the sky never outshines the neon
    // Sky agent: cloud glyphs are calm and few - '.' at a bank's thin edge, '-' through its body,
    // '~' only in the thickest cores - with ink close to paper, so the banks read as soft cloud
    // (the brightness lives in the paper) and nothing shimmers as the view turns. The curtains,
    // rain veils and data haze keep the density ramp where they outweigh the cloud.
    ink = paper * (1.6 - 0.3 * clouds) + vec3(0.004);
    float skyEffects = max(bands * 0.45, max(veil * 0.16, min(dataHaze, 1.0) * 0.4));
    int cloudCode = clouds > 0.82 ? A_TILDE : clouds > 0.55 ? A_DASH : clouds > 0.28 ? A_DOT : A_SPACE;
    code = skyEffects > clouds * 0.7 ? thinRamp(skyEffects) : cloudCode; thin = true;
    // The haze's brightest folds carry sparse bits, fixed in direction space like the stars; their
    // ink rises with the haze, so they fade in and out with its breath instead of popping.
    float bit = hash(floor(vec2(skyAz, asin(clamp(up, -1.0, 1.0))) * 90.0) + 17.0);
    if (dataHaze > 0.45 && bit > 0.93) {
      code = bit > 0.965 ? A_ONE : A_ZERO; thin = false;
      ink = mix(ink, hazeLight / max(dataHaze, 1e-3) * 0.45, smoothstep(0.45, 0.85, dataHaze));
    }
    float disc = smoothstep(0.99968, 0.99982, moon) * (1.0 - 0.8 * clouds);
    if (disc > 0.2) { code = disc > 0.6 ? A_AT : A_O; thin = false; ink = vec3(0.5, 0.54, 0.58) * (0.5 + 0.5 * disc); }
    vec2 starCell = floor(vec2(skyAz, asin(clamp(up, -1.0, 1.0))) * 140.0);
    float star = hash(starCell);
    // Sky agent: a slow 0.06 Hz shimmer of +-10%, never a twinkle. Over the city only the brightest
    // few show, dimly, high up in the clearest breaks (light pollution), and none near the zenith,
    // where the azimuth cells crowd together.
    float starGlow = 0.9 + 0.1 * sin(u_time * 0.35 + star * 90.0);
    if (up > 0.12 && clouds < 0.15 && star > 0.996 && harbour > 0.5 && disc <= 0.2) {
      code = star > 0.9993 ? A_STAR : star > 0.998 ? A_PLUS : A_DOT; thin = star < 0.998;
      ink = vec3(0.55, 0.62, 0.72) * 0.75 * starGlow;
    } else if (up > 0.42 && up < 0.8 && clouds < 0.05 && upper < 0.1 && star > 0.9988 && disc <= 0.2) {
      code = A_DOT; thin = true;
      ink = vec3(0.3, 0.34, 0.4) * starGlow;
    }
    // The endless city: beyond the draw distance a skyline of towers stands on the horizon in every
    // direction, darker than the lit smog behind it, pricked with lit windows and slow red aviation
    // lights. Its grid is sized in screen cells (fwidth), so windows never shrink below a cell.
    float el = asin(clamp(up, -1.0, 1.0)), az = atan(direction.z, direction.x);
    float cellAngle = max(fwidth(el), 1e-4);
    float lot = floor(az / 0.018), lotRnd = hash(vec2(lot, 3.1)), district = hash(vec2(floor(lot / 7.0), 9.7));
    float top = 0.006 + pow(lotRnd, 2.2) * (0.035 + 0.075 * district);
    if (el < top && el > -0.12) {
      float depth = hash(vec2(lot, 5.3));
      vec3 mass = skyColor(direction) * (0.52 + 0.2 * depth) + vec3(0.003, 0.004, 0.006);
      paper = mass; ink = mass * 1.25; code = A_SPACE; thin = true;
      vec2 winCell = floor(vec2(az, el) / (cellAngle * vec2(1.6, 1.4)));
      float w = hash(winCell + lot * 0.37);
      float litShare = 0.16 + 0.2 * district;
      if (el < top - cellAngle * 1.2 && el > 0.0 && w > 1.0 - litShare) {
        code = w > 1.0 - litShare * 0.3 ? A_COLON : A_DOT;
        ink = mix(vec3(0.7, 0.48, 0.26), vec3(0.45, 0.68, 0.88), step(0.8, fract(w * 7.0))) * (0.6 + 0.45 * fract(w * 13.0));
      }
      if (el > top - cellAngle) { paper = mass * 1.35; code = A_UNDER; ink = mass * 2.2; }
      // Aviation beacons on the tallest towers: a slow 0.4 Hz fade, never a strobe.
      if (lotRnd > 0.94 && el > top - cellAngle * 1.1) {
        code = A_DOT; thin = false;
        ink = vec3(0.9, 0.12, 0.1) * (0.35 + 0.65 * (0.5 + 0.5 * sin(u_time * 2.5 + lot)));
      }
    }
  } else if (${on(0, "SURFACE < 0.5")}) {
    // Skin 0-15 rides in the paper alpha (architecture.ts skinAlpha: 8 + skin * 16): the eight
    // building types, then corrugated metal (8), curtain wall (9), panel grid (10), terrace
    // garden (11), and the window-less part materials machinery (12), neon (13), lattice (14) and
    // screen / helipad (15). Per-part flags ride in the ink alpha (architecture.ts FLAG; tickers
    // use that channel for their message row) and only exist in the batch.
    int style = clamp(int(round((v_cellColor.a * 255.0 - 8.0) / 16.0)), 0, 15);
#ifdef BATCH
    int partFlags = int(v_glyphColor.a * 255.0 + 0.5);
    float partSeed = hash(v_center.xz * 0.37 + v_center.y * 0.11);
#else
    int partFlags = 0;
    float partSeed = 0.5;
#endif
    bool roof = abs(n.y) > 0.5;
    float horizontal = abs(n.x) > 0.5 ? p.z : p.x;
    float heightCoord = -p.y;
    vec2 spacing = style == 1 ? vec2(4.8, 6.4) : style == 2 ? vec2(2.4, 3.6) : style == 3 ? vec2(7.0, 8.8) : style == 4 ? vec2(3.4, 4.8) : style == 5 ? vec2(5.2, 5.5) : style == 7 ? vec2(2.1, 6.7)
      : style == 8 ? vec2(6.1, 2.6) : style == 9 ? vec2(1.8, 3.8) : style == 10 ? vec2(3.2, 3.6) : style == 11 ? vec2(3.0, 4.0)
      // Brick storeys of 4 m and balcony storeys of 5 m line up with the fire escapes and balcony
      // slabs architecture.ts builds every 8 m / 5 m.
      : style == 0 ? vec2(2.8, 4.0) : style == 6 ? vec2(2.8, 5.0) : vec2(2.8, 4.2);
    // Capsule hotels (FLAG.CAPSULE, the Spillway): a dense grid of 1.5 x 1.3 m pod hatches.
    bool capsule = (partFlags & 128) != 0;
    if (capsule) spacing = vec2(1.5, 1.3);
    vec2 tile = vec2(horizontal, heightCoord) / spacing;
    // Panel grids stagger their bays floor by floor, like stacked prefab units.
    if (style == 10 && !capsule) tile.x += 0.5 * mod(floor(tile.y), 2.0);
    float windowCells = min(spacing.x, spacing.y) / max(cellWorld, 0.001);
    float facadePlane = floor((abs(n.x) > 0.5 ? p.x : p.z) * 4.0 + 0.5) * 0.25;
    vec2 windowId = floor(tile) + floor(p.xz / 64.0) * 13.7 + vec2(facadePlane * 0.73, abs(n.x) > 0.5 ? 19.17 : 0.0);
    float seed = hash(windowId), seed2 = hash(windowId + 41.3);
    // Glass-heavy skins (2 glass office, 9 curtain wall) open almost the whole bay; corrugated
    // containers get small slits, panel grids small punched windows, gardens wide ones.
    vec2 winX = style == 1 ? vec2(0.42, 0.64) : style == 2 ? vec2(0.06, 0.94) : style == 8 ? vec2(0.36, 0.64) : style == 9 ? vec2(0.04, 0.96) : style == 10 ? vec2(0.3, 0.7) : style == 11 ? vec2(0.1, 0.9) : vec2(0.18, 0.78);
    vec2 winY = style == 2 ? vec2(0.12, 0.92) : style == 3 ? vec2(0.55, 0.73) : style == 8 ? vec2(0.38, 0.66) : style == 9 ? vec2(0.06, 0.95) : style == 10 ? vec2(0.3, 0.68) : style == 11 ? vec2(0.22, 0.78) : vec2(0.22, 0.73);
    if (capsule) { winX = vec2(0.12, 0.88); winY = vec2(0.16, 0.84); }
    vec2 paneSpan = vec2(winX.y - winX.x, winY.y - winY.x);
    vec2 paneFootprint = max(fwidth(tile) / paneSpan, vec2(0.001));
    float paneResolution = 1.0 / max(paneFootprint.x, paneFootprint.y);
    float detail = smoothstep(0.8, 1.9, paneResolution);
    float windowMask = band(tile.x, winX.x, winX.y) * band(tile.y, winY.x, winY.y);
    if (style == 7) windowMask *= band(horizontal / 14.0, 0.18, 0.75);
    // Planters and other boxes lower than a storey carry no windows.
    bool planter = false;
#ifdef BATCH
    planter = v_dims.y < 2.5;
#endif
    if (style >= 12 || planter) windowMask = 0.0;
    // Street level: the first 4.6 m of a box standing on the ground is not an upper storey. Its two
    // street faces sit behind the shopfronts signage.ts draws (a lit shop band shows when those are
    // out of range); the alley and mid-block faces get roller shutters, service doors and vents.
    bool groundFloor = false, streetFace = false, groundBox = false;
#ifdef BATCH
    groundBox = !roof && style < 12 && !planter && abs(v_center.y + v_dims.y * 0.5) < 0.6;
    groundFloor = groundBox && heightCoord < 4.6;
    float sideX = mod(v_center.x, 64.0) < 32.0 ? -1.0 : 1.0, sideZ = mod(v_center.z, 64.0) < 32.0 ? -1.0 : 1.0;
    streetFace = abs(n.x) > 0.5 ? n.x * sideX > 0.0 : n.z * sideZ > 0.0;
#endif
    if (groundFloor) windowMask = 0.0;
    float occupancy = capsule ? 0.52 : style == 2 ? 0.24 : style == 3 ? 0.4 : style == 8 ? 0.28 : style == 9 ? 0.3 : style == 11 ? 0.52 : 0.46;
    bool office = (style == 2 || style == 9 || style == 7) && !capsule;
    float wing = 0.5;
    if (office) {
      // Offices light by storey and wing: runs of seven bays switch on together, others stay dark,
      // so glass towers read as lit floor bands from the air. Fixed per wing - nothing switches.
      wing = hash(vec2(floor(tile.y) * 1.37 + facadePlane * 0.21, floor(tile.x / 7.0) + floor(p.x / 64.0) * 5.1 + floor(p.z / 64.0) * 3.3));
      // Once a storey is under two cells the bands would alias, so they fade to their mean.
      float banded = wing > 0.78 ? 0.86 : wing < 0.42 ? 0.05 : occupancy;
      occupancy = mix(0.21 + 0.36 * occupancy, banded, smoothstep(1.2, 2.4, spacing.y / max(cellWorld, 0.001)));
    }
    // Ghost Circuit's dead towers (FLAG.DIM): few lights, and those cold.
    if ((partFlags & 4) != 0) occupancy *= 0.35;
    // Dark towers (FLAG.DARK): a handful of warm lights in an unlit mass, so the neon reads.
    if ((partFlags & 64) != 0) occupancy *= 0.3;
    float lit = step(1.0 - occupancy, seed);
    // Window life: now and then a lamp goes on or off, fading over ~2 s. Every window runs its own
    // 75 s clock (offset by its seed, so neighbours never switch together, and nothing travels in
    // waves); in any slot about one window in 280 is flipped, so a few hundred windows see roughly
    // one change a minute. Frosted panes (which fade to a different look) never flip.
    // (Only resolved windows pay for the two hashes; no derivatives in here.)
    float lifeClock = u_time * 0.0133 + seed * 7.0, lifeSlot = floor(lifeClock), flip = 0.0;
    if (windowMask > 0.0 && detail > 0.0 && !((style == 2 || style == 9) && seed2 > 0.55 && seed2 <= 0.72)) {
      float flipNow = step(hash(windowId + vec2(lifeSlot * 1.37, lifeSlot * 0.61) + 0.5), 0.0036);
      float flipBefore = step(hash(windowId + vec2(lifeSlot * 1.37 - 1.37, lifeSlot * 0.61 - 0.61) + 0.5), 0.0036);
      flip = mix(flipBefore, flipNow, smoothstep(0.0, 0.027, fract(lifeClock)));
    }
    float litLevel = abs(lit - flip);
    float lights = windowMask * mix(occupancy, litLevel, detail) * (roof ? 0.0 : 1.0);
    // Room kinds behind a lit pane (seeded per window): TV rooms, blinds, curtains, someone at the
    // window, plants. The Rain Gardens (and garden skins) grow plants in far more of their windows.
    float kind = fract(seed2 * 5.73 + seed * 1.9);
    float eyeDist = length(p - eye);
    bool gardens = style == 11 || (p.x < -256.0 && p.z >= 0.0);
    bool plantRoom = !capsule && !office && (gardens ? kind >= 0.6 && kind < 0.95 : kind >= 0.74 && kind < 0.86);
    bool tvRoom = !capsule && !office && kind < 0.16, blindRoom = !capsule && kind >= 0.16 && kind < 0.36;
    bool curtainRoom = !capsule && kind >= 0.36 && kind < 0.54, figureRoom = !capsule && !plantRoom && kind >= 0.54 && kind < 0.74;
    vec3 concrete = v_cellColor.rgb * (0.87 + 0.13 * noise2(p.xz * 0.08 + vec2(p.y * 0.09)));
    // Each massing box weathers a little differently, so podiums, tiers and twins read apart.
    concrete *= 0.92 + 0.12 * partSeed;
    if (!roof && style < 12) {
      // Street grime: walls darken and blotch toward the pavement (paper only, low frequency, and
      // averaged to its mean once a blotch is smaller than a cell).
      float low = 1.0 - smoothstep(0.0, 10.0, heightCoord);
      float blotch = noise2(vec2(horizontal * 0.45, heightCoord * 0.6) + partSeed * 7.0);
      concrete *= 1.0 - low * (0.14 + 0.16 * mix(blotch, 0.5, smoothstep(0.6, 1.6, cellWorld)));
    }
    if (style == 8) {
      // Corrugated containers and shacks: every module its own faded livery.
      vec3 livery[5] = vec3[5](vec3(0.42, 0.2, 0.12), vec3(0.12, 0.3, 0.3), vec3(0.15, 0.2, 0.34), vec3(0.3, 0.29, 0.14), vec3(0.36, 0.13, 0.1));
      concrete = mix(concrete, livery[clamp(int(partSeed * 5.0), 0, 4)], 0.5);
    } else if (style == 12 || style == 14) concrete = mix(concrete, v_glyphColor.rgb * 0.42, 0.45);
    if ((partFlags & 8) != 0 && !roof) {
      // Rain stains (FLAG.STAINS) streak down from the ledges: paper only, and averaged to their
      // mean darkening once a streak is narrower than a cell.
      float streak = smoothstep(0.5, 0.85, noise2(vec2(horizontal * 0.8, heightCoord * 0.035 + partSeed * 9.0)));
      concrete *= 1.0 - 0.2 * mix(streak, 0.25, smoothstep(0.45, 1.1, cellWorld));
    }
    if (style == 8 && !roof) {
      // Rust bleeds down the corrugations from seams and bolt lines (its mean once sub-cell).
      float rust = smoothstep(0.55, 0.9, noise2(vec2(horizontal * 1.1 + partSeed * 13.0, heightCoord * 0.12)));
      concrete = mix(concrete, vec3(0.3, 0.13, 0.05) * (0.8 + 0.4 * partSeed), 0.55 * mix(rust, 0.18, smoothstep(0.35, 0.9, cellWorld)));
    }
    float wetSheen = 0.0;
    if ((style == 0 || style == 1 || style == 4 || style == 5 || style == 6 || style == 10) && !roof && !planter && !groundFloor) {
      // Weep stains: dirt washed off each sill streaks the panel below some windows, fading down.
      // The streaks stay wet and catch the street's sign light (lit3 below); both fade to their
      // mean once a streak is under a cell.
      float below = winY.x - fract(tile.y);
      float weep = band(tile.x, winX.x + 0.08, winX.y - 0.08) * step(0.0, below) * (1.0 - smoothstep(0.0, 0.45, below)) * step(0.45, hash(windowId + 3.1));
      float weepSharp = smoothstep(0.5, 1.5, cellWorld / (spacing.x * 0.3));
      concrete *= 1.0 - 0.22 * mix(weep, 0.1, weepSharp);
      wetSheen = weep * (1.0 - weepSharp);
    }
    // Board-formed concrete (style 1): 2.4 m form panels, two to a storey, each pour a slightly
    // different grey. Static per panel; the tone fades to its mean once a panel is under two cells.
    vec2 formPanel = vec2(horizontal / 2.4, heightCoord / (spacing.y * 0.5));
    if (style == 1 && !roof && !planter) concrete *= 1.0 + (hash(floor(formPanel) + partSeed * 7.3 + facadePlane) - 0.5) * 0.14 * (1.0 - smoothstep(0.7, 1.3, cellWorld));
    float slab = style >= 12 || planter ? 0.0 : band(tile.y, 0.93, 1.0);
    vec3 warm = mix(vec3(0.66, 0.43, 0.21), vec3(0.86, 0.74, 0.5), seed2);
    vec3 windowColor = mix(warm, v_glyphColor.rgb * 0.7, step(style == 7 ? 0.25 : 0.84, seed2));
    if (style == 3) windowColor = mix(vec3(0.38, 0.58, 0.45), warm, step(0.6, seed2));
    if (style == 11) windowColor = mix(vec3(0.5, 0.8, 0.42), warm, step(0.55, seed2));
    if ((partFlags & 4) != 0) windowColor = mix(windowColor, vec3(0.34, 0.5, 0.78), 0.65);
    // Capsule pods: warm reading lights, and a red "do not disturb" lamp on one lit pod in three.
    if (capsule) windowColor = seed2 < 0.36 ? vec3(0.88, 0.14, 0.1) : seed2 < 0.8 ? warm : vec3(0.5, 0.62, 0.72);
    // TV rooms drift slowly between screen blue and a warm scene (one cycle in 4-8 s, at a nearly
    // constant brightness); past ~90 m they settle on the mean, so far windows hold still.
    vec3 tvMean = vec3(0.58, 0.56, 0.66);
    if (tvRoom) {
      float hue = 0.5 + 0.5 * sin(u_time * 1.05 * (0.75 + 0.5 * fract(seed * 23.0)) + seed * 31.0);
      windowColor = mix(tvMean, mix(vec3(0.35, 0.55, 0.95), vec3(0.82, 0.57, 0.38), hue), 1.0 - smoothstep(70.0, 90.0, eyeDist));
    }
    // Curtained rooms glow lower and take on the cloth's colour, at every distance.
    vec3 curtainCloth = mix(vec3(0.55, 0.16, 0.2), vec3(0.2, 0.34, 0.3), fract(seed * 13.0));
    if (curtainRoom) windowColor = mix(windowColor, curtainCloth * 1.3, 0.35) * 0.78;
    if (blindRoom) windowColor *= 0.85;
    float flicker = 0.94 + 0.06 * sin(u_time * 0.24 + seed * 14.0);
    // Ghost Circuit (FLAG.DIM): one lit window in eight is a failing tube that sags to half and
    // back over ~9 s (0.11 Hz) - a slow fade, never a blink.
    if ((partFlags & 4) != 0 && seed2 > 0.875) flicker *= 0.5 + 0.5 * smoothstep(-0.5, 0.5, sin(u_time * 0.7 + seed * 40.0));
    emission = windowColor * lights * flicker;
    // After hours: some dark office floors keep a row of desk lamps burning (per storey and wing,
    // fixed). A faint warm glow in the paper; the pane branch draws the row itself up close. Fades
    // out with the floor bands once a storey is under two cells.
    bool deskRow = office && wing < 0.42 && hash(vec2(wing * 57.0, floor(tile.y) + 3.3)) > 0.45;
    vec3 deskLamp = vec3(0.95, 0.7, 0.38);
    if (deskRow) emission += deskLamp * 0.07 * windowMask * (1.0 - litLevel) * smoothstep(1.2, 2.4, spacing.y / max(cellWorld, 0.001)) * (roof ? 0.0 : 1.0);
    vec3 lit3 = lighting(p, n, concrete * (1.0 - slab * 0.28), roof ? u_rain * 0.65 : 0.12);
    // City glow: sodium and neon light from the street bounces up every facade, strongest low
    // down, plus a cool smog fill from the sky - a lived-in city is never a black void.
    float streetGlow = exp(-heightCoord * 0.04);
    vec3 bounce = vec3(0.2, 0.105, 0.05) * streetGlow + vec3(0.05, 0.07, 0.09) * (0.5 + 0.5 * smoothstep(0.0, 120.0, heightCoord));
    lit3 += concrete * bounce * (roof ? 0.35 : 1.0);
    // Wet weep streaks catch the street's sodium and the signs' colour (steady, paper only).
    lit3 += wetSheen * (bounce * 0.4 + v_glyphColor.rgb * 0.05 * streetGlow) * (0.55 + 0.45 * u_rain);
    // Street level features: kind of 6 m bay (shutter, service door, blank wall with a vent).
    float bayU = fract(horizontal / 6.0 + partSeed * 2.3);
    float bayKind = hash(vec2(floor(horizontal / 6.0 + partSeed * 2.3) + floor(p.x / 64.0) * 7.1 + floor(p.z / 64.0) * 3.9, facadePlane + 2.9));
    // The service doors' caged lamps wash the wall around them (steady, a soft pool).
    if (groundBox && heightCoord < 7.0 && !streetFace && bayKind >= 0.45 && bayKind < 0.72) {
      vec2 lampOffset = vec2((bayU - 0.5) * 6.0, heightCoord - 2.9) / 1.7;
      lit3 += concrete * vec3(1.0, 0.74, 0.42) * 1.6 * exp(-dot(lampOffset, lampOffset));
    }
    float keyLight = clamp(luma(lit3) / max(luma(concrete), 0.02), 0.0, 2.5);
    // Paper carries the mass; glyph contrast rises close to the viewer so near walls are crisp.
    // Comfort: surface texture stays a quiet engraving of the paper (low ink/paper ratio, lowest
    // far away where cells cover the most detail), so a glyph that changes under motion changes
    // little brightness. Structure - slabs, outlines, windows - keeps the stronger contrast.
    float nearness = 1.0 - smoothstep(0.25, 1.6, cellWorld);
    paper = lit3 * mix(0.95, 0.78, nearness) + emission * mix(1.0, 0.5, detail);
    float contrast = mix(1.7, 2.3, nearness) + 0.25 * keyLight;
    float grain = mix(1.3, 1.75, nearness) + 0.15 * keyLight;
    int floorStroke = strokeFor(heightCoord), riseStroke = strokeFor(horizontal);
    // Brick fire escapes (batch only: they need the box): a 5.6 m bay every 19 m on the faces
    // without architecture.ts's built escapes, zig-zag stairs between sill-level landings. The
    // stair strokes are taken here, in uniform flow, from the stairs' own continuous coordinates.
    int stairUp = strokeFor(heightCoord / spacing.y - horizontal / 5.6), stairDown = strokeFor(heightCoord / spacing.y + horizontal / 5.6);
    bool escapeStair = false, escapeLanding = false, stairRising = false;
#ifdef BATCH
    if (style == 0 && !roof && n.z < 0.5 && v_dims.y > 12.0 && heightCoord > 4.6 && heightCoord < -(v_center.y - v_dims.y * 0.5) - 1.5 && windowCells > 2.5) {
      float escU = fract(horizontal / 19.0 + partSeed * 3.7) * 19.0 / 5.6, escV = heightCoord / spacing.y - winY.x + 0.03;
      if (escU < 1.0) {
        float g = fract(escV);
        stairRising = mod(floor(escV), 2.0) < 0.5;
        escapeLanding = g * spacing.y < max(0.3, cellWorld * 0.9);
        escapeStair = abs(escU - (stairRising ? g : 1.0 - g)) * 5.6 / max(cellWorld, 0.001) < 0.7 && escU > 0.04 && escU < 0.96;
      }
    }
#endif
    // Tenement cable bundles: power and data lines sag across some bays between the window heads,
    // pier to pier. One cell thick, drawn only once a bay spans five cells; the stroke follows the
    // sag and is taken here, in uniform flow (the curve is continuous at the piers).
    float pierU = fract(tile.x - (winX.x + winX.y + 1.0) * 0.5);
    float sagCurve = winY.y + 0.17 - 0.4 * pierU * (1.0 - pierU);
    // (Only tenement skins pay for the stroke; style is per box, so the branch is uniform across
    // every 2x2 quad and the derivatives inside it hold.)
    int cableStroke = A_DASH;
    if (style == 0 || style == 5 || style == 6) cableStroke = strokeFor(tile.y - sagCurve);
    vec2 cableId = vec2(floor(tile.x - (winX.x + winX.y + 1.0) * 0.5), floor(tile.y)) + floor(p.xz / 64.0) * 13.7 + facadePlane * 0.73;
    bool cable = (style == 0 || style == 5 || style == 6) && !roof && !groundFloor && !planter && windowCells > 5.0 && partSeed > 0.3
      && abs(fract(tile.y) - sagCurve) * spacing.y / max(cellWorld, 0.001) < 0.55 && hash(cableId + 17.3) > 0.55;
    // External lifts (FLAG.PULSE on a tower mass): a glass shaft up one face, clear of the
    // corners, with a lit car gliding slowly up and down (one ~140 s cycle, under 3 m/s). The
    // shaft only draws while it spans two cells; the car is a solid block, so nothing sub-cell moves.
    bool liftShaft = false, liftRail = false, liftCar = false;
#ifdef BATCH
    float boxBottom = -(v_center.y + v_dims.y * 0.5), boxTop = -(v_center.y - v_dims.y * 0.5);
    float liftTravel = 0.5 + 0.5 * sin(u_time * 0.045 + partSeed * 40.0);
    if ((partFlags & 32) != 0 && style < 12 && !roof && !groundFloor && heightCoord > boxBottom + 0.4) {
      float faceIndex = floor(partSeed * 4.0);
      bool liftFace = abs(n.x) > 0.5 ? faceIndex < 2.0 && n.x * (faceIndex < 1.0 ? 1.0 : -1.0) > 0.0 : faceIndex >= 2.0 && n.z * (faceIndex < 3.0 ? 1.0 : -1.0) > 0.0;
      float faceSpan = abs(n.x) > 0.5 ? v_dims.z : v_dims.x;
      float along = abs(n.x) > 0.5 ? p.z - v_center.z : p.x - v_center.x;
      float shaftAt = (fract(partSeed * 7.3) - 0.5) * max(0.0, faceSpan - 7.0);
      float halfCells = 1.25 / max(cellWorld, 0.001), acrossCells = abs(along - shaftAt) / max(cellWorld, 0.001);
      if (liftFace && halfCells > 1.0 && acrossCells < halfCells) {
        liftShaft = true;
        liftRail = acrossCells > halfCells - 1.0;
        float carY = mix(boxBottom + 1.5, boxTop - 1.8, liftTravel);
        liftCar = abs(heightCoord - carY) < 1.3;
      }
    }
#endif
    if (style >= 12) {
      // Part materials (architecture.ts PART_SKIN): no windows, each its own construction.
      if (style == 13) {
        // Neon tubes and aviation lights, self-lit. FLAG.PULSE fades slowly (0.4 Hz), never blinks.
        float pulse = (partFlags & 32) != 0 ? 0.35 + 0.65 * (0.5 + 0.5 * sin(u_time * 2.5 + partSeed * 6.28)) : 1.0;
        vec3 tube = v_glyphColor.rgb;
        code = A_HASH; thin = false;
        ink = tube * 1.2 * pulse + vec3(0.04); paper = tube * 0.38 * pulse; emission = tube * 0.8 * pulse;
      } else if (style == 14) {
        // Lattice: steel members on a 2.4 m X-braced grid over dark voids, so it reads as open
        // structure. Below ~3 cells a bay becomes one steady texture instead of aliasing members.
        vec2 q = (roof ? p.xz : vec2(horizontal, heightCoord)) / 2.4;
        float bayCells = 2.4 / max(cellWorld, 0.001);
        paper = lit3 * 0.3 + vec3(0.006, 0.009, 0.011);
        // Derivatives and strokes are taken before the per-cell branch (undefined inside it).
        vec2 fw = max(fwidth(q), vec2(1e-4));
        int memberX = strokeFor(q.x), memberY = strokeFor(q.y), braceA = strokeFor(q.x - q.y), braceB = strokeFor(q.x + q.y);
        if (bayCells > 3.0) {
          vec2 f = fract(q), m = min(f, 1.0 - f) / fw;
          float slash = abs(f.x - f.y) / (fw.x + fw.y), back = abs(f.x + f.y - 1.0) / (fw.x + fw.y);
          thin = false; ink = lit3 * contrast * 0.9 + vec3(0.01);
          if (min(m.x, m.y) < 0.7) code = m.x < m.y ? memberX : memberY;
          else if (slash < 0.7 && back < 0.7) code = A_X;
          else if (slash < 0.7) code = braceA;
          else if (back < 0.7) code = braceB;
          else { code = A_SPACE; ink = paper; }
          if (code != A_SPACE) paper = lit3 * 0.62;
        } else {
          code = bayCells > 1.2 ? A_X : A_COLON; thin = true;
          paper = lit3 * 0.45; ink = paper * grain;
        }
#ifdef BATCH
        // An open lift shaft (FLAG.PULSE, the lift-core family): its car glides up and down inside.
        // Only while the car spans two cells, so it never becomes a crawling speck in the distance.
        if ((partFlags & 32) != 0 && !roof && cellWorld < 1.4 && abs(heightCoord - mix(boxBottom + 1.5, boxTop - 5.0, liftTravel)) < 1.4) {
          vec3 car = vec3(1.0, 0.84, 0.59);
          code = cellWorld < 0.5 ? A_HASH : A_PCT; thin = false;
          ink = car * 0.95; paper = car * 0.26 + lit3 * 0.2; emission = car * 0.4;
        }
#endif
      } else if (style == 15) {
        // Screens (billboards) and helipads, laid out in the box's own coordinates.
#ifdef BATCH
        vec3 lp = p - v_center, hd = max(v_dims * 0.5, vec3(0.01));
#else
        vec3 lp = vec3(0.0), hd = vec3(1.0);
#endif
        vec3 tint = v_glyphColor.rgb;
        if (roof) {
          // Helipad: ring and H marked in the pad's light on a dark deck (edge lights: FLAG.CROWN).
          float radius = max(min(hd.x, hd.z), 0.5), r = length(lp.xz) / radius;
          vec2 a = abs(lp.xz) / radius;
          float hMark = step(a.x, 0.32) * step(a.y, 0.4) * max(step(0.2, a.x), step(a.y, 0.055));
          float mark = radius / max(cellWorld, 0.001) > 6.0 ? max(step(abs(r - 0.78), 0.06), hMark) : 0.0;
          paper = lit3 * 0.55 + vec3(0.01);
          code = mark > 0.5 ? A_HASH : cellWorld < 0.6 ? A_PLUS : A_DOT; thin = mark < 0.5;
          ink = mark > 0.5 ? tint * 0.9 : paper * 1.4;
          if (mark > 0.5) paper = mix(paper, tint * 0.25, 0.6);
        } else if ((partFlags & 4) != 0) {
          // A dead screen: dark glass, faintly dotted, no signal.
          code = A_DOT; thin = true;
          paper = vec3(0.012, 0.016, 0.02) + lit3 * 0.15; ink = paper * 1.6;
        } else {
          // Blocky advert panels under fixed scan rows; only the brightness drifts, slowly.
          float faceU = (abs(n.x) > 0.5 ? lp.z / hd.z : lp.x / hd.x) * 0.5 + 0.5, faceV = 0.5 - lp.y / (2.0 * hd.y);
          float block = hash(floor(vec2(faceU * 4.0, faceV * 3.0)) + partSeed * 17.0);
          float art = step(0.4, block), drift = 0.8 + 0.2 * sin(u_time * 0.5 + faceV * 3.0 + partSeed * 6.0);
          vec3 c = mix(tint, tint.gbr, step(0.78, block));
          float scan = band(faceV * hd.y * 2.0 / 0.7, 0.0, 0.5);
          code = art > 0.5 ? (scan > 0.5 && cellWorld < 0.3 ? A_EQ : A_HASH) : A_COLON; thin = art < 0.5;
          ink = c * (0.45 + 0.85 * art) * drift; paper = c * (0.06 + 0.2 * art) * drift + vec3(0.01, 0.014, 0.018);
          emission = c * (0.15 + 0.5 * art) * drift;
        }
      } else {
        // Machinery: ribbed steel tanks, ducts, AC units and chimneys; grilles on top.
        if (roof) { code = cellWorld < 0.6 ? A_HASH : A_PLUS; thin = cellWorld >= 0.6; ink = paper * 1.35; }
        else if (cellWorld < 0.36) { float rib = band(heightCoord / 0.9, 0.0, 0.4); code = rib > 0.5 ? (floorStroke == A_DASH ? A_EQ : floorStroke) : floorStroke; thin = rib <= 0.5; ink = paper * grain; }
        else { code = A_COLON; thin = true; ink = paper * grain; }
      }
    } else if (roof && style == 11) {
      // Roof gardens and planters: foliage over soil, a fixed pattern only resolved up close.
      paper = mix(paper, vec3(0.035, 0.11, 0.055) + lit3 * 0.45, 0.7);
      code = cellWorld < 0.3 ? (hash(floor(p.xz * 2.0)) > 0.5 ? A_STAR : A_AMP) : A_COLON; thin = cellWorld >= 0.3;
      ink = paper * 1.5 + vec3(0.015, 0.05, 0.02);
    } else if (roof) {
      code = cellWorld < 0.5 ? A_HASH : cellWorld < 1.4 ? A_PLUS : A_DOT; thin = cellWorld >= 0.5;
      ink = paper * 1.4;
    } else if (groundFloor && (streetFace ? heightCoord > 0.3 && heightCoord < 4.3
        : bayKind < 0.45 ? bayU > 0.08 && bayU < 0.92 && heightCoord < 3.9
        : bayKind < 0.72 ? (bayU > 0.34 && bayU < 0.66 && heightCoord < 2.6) || (abs(bayU - 0.5) < 0.03 && abs(heightCoord - 2.9) < 0.12)
        : bayU > 0.14 && bayU < 0.36 && heightCoord > 2.2 && heightCoord < 3.1)) {
      if (streetFace) {
        // Behind the shopfronts: warm interior light, only seen once they are out of range.
        vec3 shop = mix(vec3(0.9, 0.62, 0.32), v_glyphColor.rgb, 0.35);
        code = A_COLON; thin = true;
        paper = mix(paper, shop * 0.32, 0.7); ink = shop * 0.7; emission += shop * 0.22;
      } else if (bayKind < 0.45) {
        // A roller shutter under its housing, painted per bay; one in three carries a tag.
        vec3 coats[4] = vec3[4](vec3(0.15, 0.16, 0.17), vec3(0.09, 0.2, 0.2), vec3(0.24, 0.1, 0.08), vec3(0.2, 0.18, 0.1));
        vec3 coat = coats[clamp(int(fract(bayKind * 9.7) * 4.0), 0, 3)];
        bool housing = heightCoord > 3.4;
        paper = coat * (0.35 + 0.45 * keyLight) * (housing ? 0.7 : 1.0) + bounce * coat * 0.5;
        code = housing ? A_HASH : (floorStroke == A_DASH ? A_EQ : floorStroke); thin = !housing && cellWorld > 0.3;
        ink = paper * mix(1.6, 2.1, nearness);
        if (fract(bayKind * 5.3) < 0.33 && !housing) {
          // Graffiti: resolved into letters only up close, its tint otherwise (no sub-cell noise).
          vec3 spray = fract(bayKind * 17.0) < 0.5 ? vec3(0.85, 0.2, 0.62) : fract(bayKind * 29.0) < 0.5 ? vec3(0.4, 0.85, 0.3) : vec3(0.95, 0.78, 0.25);
          float tag = smoothstep(0.58, 0.7, noise2(vec2(horizontal * 0.9, heightCoord * 1.4) + bayKind * 31.0)) * step(0.5, heightCoord) * step(heightCoord, 2.7);
          float sharp = 1.0 - smoothstep(0.25, 0.7, cellWorld);
          paper = mix(paper, spray * 0.4, tag * mix(0.3, 0.75, sharp));
          if (tag * sharp > 0.5) { code = fract(bayKind * 41.0) < 0.5 ? A_PCT : A_AMP; thin = false; ink = spray * 0.9; }
        }
      } else if (bayKind < 0.72) {
        if (heightCoord > 2.6) {
          // A small caged lamp over the service door, steady.
          vec3 lamp = vec3(1.0, 0.74, 0.42);
          code = cellWorld < 0.35 ? A_STAR : A_DOT; thin = false;
          ink = lamp; paper = lamp * 0.18 + paper * 0.5; emission += lamp * 0.3;
        } else {
          // The service door in its dark recess, framed one cell wide at any distance.
          float side = min(bayU - 0.34, 0.66 - bayU) * 6.0 / max(cellWorld, 0.001), head = (2.6 - heightCoord) / max(cellWorld, 0.001);
          paper = lit3 * 0.3 + vec3(0.006, 0.007, 0.008);
          if (min(side, head) < 1.0) { code = side < head ? (bayU < 0.5 ? A_LBR : A_RBR) : floorStroke; thin = false; paper = lit3 * 0.75; ink = lit3 * contrast; }
          else { code = A_PIPE; thin = true; ink = paper * 1.6; }
        }
      } else {
        // A vent grille on the blank bays.
        code = cellWorld < 0.4 ? A_HASH : A_EQ; thin = true;
        paper = lit3 * 0.45; ink = paper * 1.8;
      }
    } else if (liftShaft) {
      // External lift: steel rails at the shaft's edges, dark glass and hoist cables between, and
      // the lit car (it outshines the glass, so its edges never shimmer against it).
      vec3 car = vec3(1.0, 0.84, 0.59);
      if (liftCar && !liftRail) {
        code = cellWorld < 0.5 ? A_HASH : A_PCT; thin = false;
        ink = car * 0.95; paper = car * 0.26 + lit3 * 0.2; emission = car * 0.4;
      } else if (liftRail) {
        code = riseStroke; thin = false;
        paper = lit3 * 0.7 + vec3(0.008, 0.01, 0.012); ink = lit3 * contrast + vec3(0.02, 0.024, 0.028); emission = vec3(0.0);
      } else {
        code = cellWorld < 0.5 ? A_PIPE : A_SPACE; thin = true;
        paper = lit3 * 0.22 + sky * 0.25 + vec3(0.006, 0.01, 0.014); ink = paper * 1.6; emission = vec3(0.0);
      }
    } else if (escapeStair || escapeLanding) {
      // Fire escape iron in front of the wall: landings at sill level, stairs zig-zagging between.
      code = escapeLanding ? (floorStroke == A_DASH ? A_EQ : floorStroke) : stairRising ? stairUp : stairDown; thin = false;
      paper = lit3 * 0.4 + vec3(0.004, 0.005, 0.006); ink = lit3 * contrast * 0.85 + vec3(0.012, 0.014, 0.016);
    } else if (cable) {
      // A sagging cable bundle across the bay, dark against the wall.
      code = cableStroke == A_DASH ? A_UNDER : cableStroke; thin = false;
      paper = lit3 * 0.62; ink = vec3(0.014, 0.016, 0.018) + lit3 * 0.3;
    } else if (style == 6 && !groundFloor && !planter && windowCells > 4.0 && hash(windowId + 9.1) > 0.8 && hash(windowId + floor(fract(tile.x) * 7.0) * 1.7) > 0.3
        && band(tile.y, 0.2, 0.42) * band(tile.x, 0.12, 0.88) > 0.5) {
      // Laundry strung across some balconies, in front of the window: a fixed row of cloths.
      float item = floor(fract(tile.x) * 7.0);
      vec3 cloth = mix(vec3(0.62, 0.2, 0.24), vec3(0.22, 0.42, 0.55), hash(windowId + item)) * (0.6 + 0.4 * hash(windowId + item * 3.0)) + vec3(0.06);
      int kinds[4] = int[4](A_CAPY, A_CAPM, A_LBR, A_CAPW);
      code = kinds[clamp(int(hash(windowId + item * 5.0) * 4.0), 0, 3)]; thin = false;
      ink = cloth * (0.6 + 0.4 * keyLight); paper = cloth * 0.25 * (0.6 + 0.4 * keyLight);
    } else if (windowMask > 0.5 && detail > 0.5) {
      vec2 paneUv = (fract(tile) - vec2(winX.x, winY.x)) / paneSpan;
      vec2 edgeCells = min(paneUv, 1.0 - paneUv) / paneFootprint;
      float frameDetail = smoothstep(2.3, 3.8, paneResolution);
      float frameCover = (1.0 - smoothstep(0.2, 0.9, min(edgeCells.x, edgeCells.y))) * frameDetail;
      bool sideFrame = edgeCells.x < edgeCells.y;
      bool framed = frameCover > 0.45;
      float facing = clamp(-dot(n, view), 0.0, 1.0);
      float grazing = 1.0 - facing, grazing2 = grazing * grazing;
      float fresnel = 0.04 + 0.96 * grazing2 * grazing2 * grazing;
      vec3 reflection = sky * vec3(1.05, 1.62, 1.92) + bounce * 0.16;
      // Curtain walls (2 glass office, 9 curtain wall) mirror the city strongly; punched windows
      // in masonry only hint at it.
      float glassy = style == 2 || style == 9 ? 1.0 : 0.3;
#ifndef LITE
      // The reflected skyline: towers across the street seen in the glass, darker than the lit
      // smog and pricked with windows, the street's glow below them. A function of the reflected
      // direction only, so it slides across the wall as the viewer moves, like a real mirror.
      // (No derivatives in here - this branch differs per cell. The angular footprint of a cell is
      // cellWorld / distance, conservative at grazing angles.) Reflected windows resolve only once
      // each spans two cells; before that they are their average glow.
      vec3 mirrored = reflect(view, n);
      float mirrorEl = asin(clamp(-mirrored.y, -1.0, 1.0)), mirrorAz = atan(mirrored.z, mirrored.x);
      float angularFoot = cellWorld / max(length(p - eye), 1.0);
      float lotIndex = floor(mirrorAz / 0.06), skyline = 0.04 + pow(hash(vec2(lotIndex, 7.3)), 1.8) * 0.32;
      float towerMass = step(mirrorEl, skyline) * step(-0.2, mirrorEl);
      vec2 mirrorWindow = vec2(mirrorAz / 0.011, mirrorEl / 0.014);
      float mirrorSeed = hash(floor(mirrorWindow) + lotIndex * 3.1);
      float windowSharp = 1.0 - smoothstep(0.25, 0.5, angularFoot / 0.011);
      float mirrorLit = mix(0.2, step(0.72, mirrorSeed) * step(0.2, fract(mirrorWindow.x)) * step(0.25, fract(mirrorWindow.y)), windowSharp);
      vec3 mirrorTint = mix(vec3(0.75, 0.5, 0.26), vec3(0.4, 0.7, 0.95), step(0.85, fract(mirrorSeed * 7.0)));
      vec3 towers = sky * 0.55 + vec3(0.004, 0.006, 0.009) + mirrorTint * mirrorLit * 0.35;
      reflection = mix(reflection, towers, towerMass * glassy) + bounce * 0.25 * step(mirrorEl, -0.2) * glassy;
#endif
      float glassMix = 0.1 + 0.76 * fresnel;
      vec2 roomUv = paneUv;
      float roomDetail = smoothstep(3.5, 7.0, paneResolution);
#ifndef LITE
      vec2 viewAcross = vec2(abs(n.x) > 0.5 ? view.z : view.x, -view.y);
      roomUv += clamp(viewAcross / max(facing, 0.24), vec2(-1.2), vec2(1.2)) * vec2(0.13, 0.1) * roomDetail;
#endif
      if (litLevel > 0.02) {
        // One window-like glyph per window, the same in all its cells: a mullioned grid for most, a
        // cross-barred sash for some, blinds for the rest. (Never letters - '@' '8' 'B' 'M' '&' in
        // two-by-two clusters read as stray text across distant towers.)
        code = seed2 < 0.55 ? A_HASH : A_PLUS;
        if (seed2 > 0.8 || blindRoom) code = A_EQ;
        // Capsule hatches: a round port per pod (the red lamp ones zeroed out).
        if (capsule) code = seed2 < 0.36 ? A_ZERO : A_CAPO;
        ink = windowColor * 1.2 * flicker;
        // The sparser '+' sash gets a brighter pane so it holds the same overall glow as '#'.
        paper = mix(paper, windowColor * (code == A_PLUS ? 0.42 : 0.3), 0.8);
        vec3 tint = windowColor;
        float b = 0.65;
#ifdef LITE
        bool rich = false;
        float slatCount = 4.0;
#else
        bool rich = paneResolution > 8.0;
        float slatCount = 7.0;
#endif
        if (!framed && roomDetail > 0.01 && !capsule) {
          vec2 lamp = vec2(0.25 + 0.5 * fract(seed * 7.31), 0.5 + 0.3 * fract(seed * 3.17));
          vec2 d = (roomUv - lamp) * vec2(1.4, 1.9);
          b = 0.42 + 0.58 * exp(-dot(d, d) * 2.6);
          if (tvRoom) {
            // The screen in a corner of the room (its colour drifts in windowColor above).
            vec2 tv = roomUv - vec2(0.8, 0.28);
            b = (0.35 + 0.65 * exp(-dot(tv, tv) * 3.5)) * (0.88 + 0.12 * sin(u_time * 0.9 + seed * 31.0));
          }
          b = mix(0.65, b, roomDetail);
          // The lamp's pool, in window glyphs only (the bold ramp's '%' and '@' read as letters).
          code = b > 0.6 ? A_HASH : b > 0.5 ? A_STAR : A_PLUS;
          ink = mix(ink, tint * (0.55 + 1.1 * b) * flicker, roomDetail);
          paper = mix(paper, tint * (0.08 + 0.34 * b) * flicker, roomDetail);
          if (blindRoom) {
            float slat = prefilteredBand(paneUv.y * slatCount, 0.0, 0.45, paneFootprint.y * slatCount);
            code = slat > 0.5 ? A_EQ : A_DASH; thin = slat <= 0.5;
            ink = mix(ink, tint * (0.4 + 0.9 * b), roomDetail); paper = mix(paper, tint * (0.05 + 0.2 * b), roomDetail);
          } else if (rich && curtainRoom && (paneUv.x < 0.24 || paneUv.x > 0.76)) {
            code = paneUv.x < 0.12 || paneUv.x > 0.88 ? A_PIPE : paneUv.x < 0.5 ? A_LPAR : A_RPAR;
            ink = curtainCloth * (0.5 + 0.6 * b); paper = curtainCloth * 0.12 * (0.5 + b);
          }
          emission = mix(emission, tint * b * 0.6, roomDetail);
        }
        if (!framed && !capsule) {
          // Someone at the window: a still dark figure against the lamp (one in three drifts a cell
          // or so over ~90 s). Only within ~45 m and once the pane spans five cells; the figure is
          // at least a cell and a half wide, and it fades in with distance rather than popping.
          float figureAmount = 0.0;
#ifndef LITE
          if (figureRoom) figureAmount = smoothstep(5.0, 6.5, paneResolution) * (1.0 - smoothstep(38.0, 45.0, eyeDist));
#endif
          // Plants crowd the sill (most of the Rain Gardens' windows), resolved from three cells.
          float plantAmount = plantRoom ? smoothstep(2.5, 3.5, paneResolution) : 0.0;
          if (figureAmount > 0.01) {
            float px = clamp(0.3 + 0.4 * fract(seed * 5.13) + step(0.66, fract(seed * 3.3)) * 0.12 * sin(u_time * 0.07 + seed * 40.0), 0.2, 0.8);
            float headR = max(0.105, 0.6 / paneResolution), bodyHalf = max(0.13, 0.75 / paneResolution);
            vec2 head = (roomUv - vec2(px, 0.66)) * vec2(1.0, 0.8);
            bool headCell = dot(head, head) < headR * headR;
            bool bodyCell = abs(roomUv.x - px) < bodyHalf + 0.06 * (1.0 - smoothstep(0.3, 0.52, roomUv.y)) && roomUv.y < 0.54;
            if (headCell || bodyCell) {
              // A solid dark silhouette (bare paper), not a column of 'M's; the head keeps a faint ring.
              if (figureAmount > 0.5) { code = headCell ? A_O : A_SPACE; thin = false; }
              ink = mix(ink, tint * 0.16, figureAmount); paper = mix(paper, tint * 0.035, figureAmount); emission *= 1.0 - 0.8 * figureAmount;
            }
          } else if (plantAmount > 0.01 && roomUv.y < (gardens ? 0.4 : 0.24)) {
            if (plantAmount > 0.5) { code = rich ? (fract(roomUv.x * 5.0) < 0.5 ? A_STAR : A_CAPY) : A_AMP; thin = false; }
            ink = mix(ink, vec3(0.3, 0.75, 0.4) * (0.5 + 0.7 * b), plantAmount); paper = mix(paper, tint * 0.08 + vec3(0.01, 0.03, 0.015), plantAmount);
          }
        }
        if (litLevel < 0.98) {
          // A lamp switching on or off (window life above): fade to the unlit pane, no step.
          vec3 darkPane = lit3 * 0.21 + vec3(0.008, 0.014, 0.022);
          paper = mix(darkPane, paper, litLevel); ink = mix(darkPane * 1.35, ink, litLevel); emission *= litLevel;
          glassMix = mix(mix(0.25 + 0.7 * fresnel, 0.42 + 0.52 * fresnel, step(0.5, glassy)), glassMix, litLevel);
        }
      } else if (glassy > 0.5 && seed2 > 0.55 && seed2 <= 0.72) {
        // Frosted privacy glass: a milky, evenly lit pane that mirrors much less.
        code = A_COLON; thin = true;
        paper = lit3 * 0.4 + sky * 0.9 + vec3(0.02, 0.026, 0.032);
        ink = paper * 1.25;
        glassMix = 0.12 + 0.4 * fresnel;
      } else {
        code = A_DOT; thin = true;
        paper = lit3 * 0.21 + vec3(0.008, 0.014, 0.022);
        ink = paper * 1.35;
        glassMix = mix(0.25 + 0.7 * fresnel, 0.42 + 0.52 * fresnel, step(0.5, glassy));
        if (paneResolution > 5.0 && seed2 > 0.72) { code = A_EQ; ink = paper * 1.5; }
        // Ghost Circuit's dead towers: some panes are smashed or boarded up.
        if ((partFlags & 4) != 0 && seed2 < 0.16 && paneResolution > 4.0) { code = seed2 < 0.08 ? A_SLASH : A_X; ink = paper * 1.9; glassMix *= 0.5; }
        if (deskRow && !framed) {
          // After hours: a warm row of desk lamps across the dark floor, beaded with the lamps
          // themselves once each spans a couple of cells.
          float desk = prefilteredBand(paneUv.y, 0.2, 0.34, paneFootprint.y);
          if (desk > 0.05) {
            float bead = cellWorld < 0.3 ? step(0.5, fract(horizontal / 1.2 + seed)) : 0.5;
            vec3 glow = deskLamp * (0.3 + 0.5 * bead);
            ink = mix(ink, glow * 1.3, desk); paper += glow * 0.1 * desk; emission += glow * 0.22 * desk;
            if (desk > 0.5) { code = bead > 0.75 ? A_STAR : A_UNDER; thin = bead <= 0.75; }
          }
        }
      }
#ifndef LITE
      vec2 roomEdge = min(roomUv, 1.0 - roomUv);
      float recess = mix(1.0, 0.38 + 0.62 * smoothstep(-0.04, 0.14, min(roomEdge.x, roomEdge.y)), roomDetail);
      paper *= recess; ink *= recess; emission *= recess;
#endif
      paper = mix(paper, reflection, glassMix);
      ink = mix(ink, reflection * 1.22, glassMix);
      emission *= 1.0 - glassMix;
#ifndef LITE
      if (u_rain > 0.5 && !framed) {
        // Rain running down the glass: world-anchored drips in 0.25 m lanes sliding slowly down.
        // A lane is drawn in the one cell column nearest its centre and only while it spans 1.6+
        // cells, so drips never alias; further away the glass is left alone.
        float laneFoot = max(paneFootprint.x * paneSpan.x * spacing.x / 0.25, 1e-3);
        float lane = horizontal / 0.25 + facadePlane * 0.37;
        float laneSeed = hash(vec2(floor(lane), facadePlane + 3.7));
        float drip = fract((heightCoord + u_time * (0.18 + 0.17 * laneSeed)) / 2.6 + laneSeed);
        bool laneCentre = abs(floor((fract(lane) - 0.5) / laneFoot + 0.5)) < 0.5;
        if (laneFoot < 0.62 && laneCentre && laneSeed > 0.45 && drip < 0.22) {
          code = A_PIPE; thin = true;
          ink = mix(ink, reflection * 1.7 + vec3(0.02, 0.03, 0.035), 0.55);
        }
      }
#endif
      float mullionCover = 0.0, transomCover = 0.0;
#ifndef LITE
      float dividerDetail = smoothstep(5.0, 8.0, paneResolution);
      mullionCover = (1.0 - smoothstep(0.2, 0.8, abs(paneUv.x - 0.5) / paneFootprint.x)) * dividerDetail;
      transomCover = (1.0 - smoothstep(0.2, 0.8, abs(paneUv.y - 0.72) / paneFootprint.y)) * dividerDetail;
#endif
      float frame = max(frameCover, max(mullionCover, transomCover));
      vec3 metal = lit3 * 0.58 + bounce * 0.07 + vec3(0.009, 0.014, 0.017);
      paper = mix(paper, metal * 0.52, frame);
      ink = mix(ink, metal * 1.45, frame);
      emission *= 1.0 - frame;
      if (framed) {
        code = sideFrame ? (paneUv.x < 0.5 ? A_LBR : A_RBR) : floorStroke;
        if (max(edgeCells.x, edgeCells.y) < 0.9) code = A_PLUS;
        thin = false;
      } else if (max(mullionCover, transomCover) > 0.45) {
        code = mullionCover > 0.45 && transomCover > 0.45 ? A_PLUS : mullionCover > transomCover ? riseStroke : floorStroke;
        thin = false;
      }
    } else if (detail <= 0.5 && lights > 0.07) {
      // Windows smaller than a cell become points of light instead of aliasing noise. One threshold
      // only (fewer glyph flips while moving); brightness follows the prefiltered light smoothly.
      code = lights > 0.26 ? A_COLON : A_DOT; thin = true;
      ink = windowColor * (0.7 + lights * 1.6);
    } else if (style == 6 && !roof && !groundFloor && !planter && windowCells > 2.5 && band(tile.y, 0.0, 0.2) > 0.5 && hash(vec2(windowId.y, floor(windowId.x / 2.0)) + 5.3) > 0.3) {
      // Balcony fronts under the windows, two bays each: a rail over balusters, in shadow.
      bool rail = band(tile.y, 0.15, 0.2) > 0.5 || windowCells < 5.0;
      code = rail ? (floorStroke == A_DASH ? A_EQ : floorStroke) : riseStroke; thin = !rail;
      paper = lit3 * 0.55 + vec3(0.004, 0.005, 0.006); ink = lit3 * contrast * (rail ? 0.95 : 0.7);
    } else if (slab > 0.45 && windowCells > 1.8) {
      code = floorStroke == A_DASH ? A_EQ : floorStroke;
      ink = paper * contrast * 0.85;
    } else if (!roof && !groundFloor && windowCells > 3.0 && style != 2 && style != 9 && !planter && band(tile.x, winX.x - 0.04, winX.y + 0.04) * band(tile.y, winY.x - 0.07, winY.x) > 0.5) {
      // Window sills: a ledge catching the street light.
      code = floorStroke == A_DASH ? A_UNDER : floorStroke; thin = false;
      paper = lit3 * 0.85 + bounce * concrete * 0.4; ink = paper * contrast;
    } else if (!roof && !groundFloor && windowCells > 3.0 && (style == 0 || style == 4 || style == 5 || style == 6) && !planter && band(tile.x, winX.x - 0.05, winX.y + 0.05) * band(tile.y, winY.y, winY.y + 0.07) > 0.5) {
      // Lintels: a pale stone header over brick windows, a darker cast one on rendered walls.
      code = floorStroke == A_DASH ? A_EQ : floorStroke; thin = style != 0;
      paper = lit3 * (style == 0 ? 1.12 : 0.8) + bounce * concrete * 0.3; ink = paper * contrast * 0.8;
    } else if (!roof && !groundFloor && windowCells > 4.0 && style != 2 && style != 8 && style != 9 && !planter && hash(windowId + 7.7) > 0.8 && band(tile.x, 0.52, 0.8) * band(tile.y, winY.x - 0.24, winY.x - 0.08) > 0.5) {
      // Air-conditioning units hung under some windows.
      float ax = (fract(tile.x) - 0.52) / 0.28;
      code = ax < 0.14 ? A_LBR : ax > 0.86 ? A_RBR : A_HASH; thin = ax >= 0.14 && ax <= 0.86;
      paper = vec3(0.07, 0.08, 0.085) + lit3 * 0.5; ink = paper * 2.2;
    } else if ((style == 0 || style == 5 || style == 6 || style == 10) && !capsule && !roof && !groundFloor && !planter && windowCells > 5.0
        && (min(winX.y + 0.24, 0.99) - winX.y - 0.04) * spacing.x / max(cellWorld, 0.001) > 1.2 && hash(windowId + 12.9) > 0.84
        && band(tile.x, winX.y + 0.04, min(winX.y + 0.24, 0.99)) * band(tile.y, winY.x + 0.12, winY.x + 0.36) > 0.5) {
      // Satellite dishes bolted beside some tenement windows: a pale bowl on a short bracket.
      bool bowl = fract(tile.y) > winY.x + 0.19;
      code = bowl ? A_CAPO : A_PIPE; thin = !bowl;
      paper = lit3 * 0.75 + vec3(0.01); ink = vec3(0.42, 0.45, 0.47) * (0.45 + 0.55 * keyLight) + bounce * 0.4;
    } else if (!roof && style == 11 && (planter || band(tile.y, 0.0, 0.2) > 0.5)) {
      // Terrace gardens: planter troughs under every window row, foliage spilling over.
      paper = mix(paper, vec3(0.035, 0.11, 0.055) + lit3 * 0.45, 0.6);
      code = cellWorld < 0.25 ? (hash(floor(vec2(horizontal, heightCoord) * 2.0)) > 0.5 ? A_STAR : A_AMP) : A_COLON; thin = true;
      ink = paper * 1.45 + vec3(0.01, 0.04, 0.015);
    } else if (!roof && !planter && style != 2 && style != 9 && cellWorld < 0.45 && max(band(horizontal / 23.0 + partSeed, 0.0, 0.35 / 23.0), (style == 3 || style == 8) ? band(horizontal / 31.0 + partSeed * 0.7, 0.0, 0.7 / 31.0) : 0.0) > 0.5) {
      // Drainpipes down every face, and maintenance ladders on works and container stacks.
      bool ladder = (style == 3 || style == 8) && band(horizontal / 31.0 + partSeed * 0.7, 0.0, 0.7 / 31.0) > 0.5;
      code = ladder ? A_CAPH : riseStroke; thin = false;
      paper = lit3 * 0.6 + vec3(0.006, 0.008, 0.009); ink = lit3 * contrast * 0.85;
    } else if (!roof && windowCells > 2.5 && (style == 0 || style == 4 || style == 6) && band(tile.x / 3.0, 0.0, 0.07) > 0.5) {
      // Pilasters every third bay: raised, lit edges.
      code = riseStroke; thin = false;
      paper = lit3 * 0.95; ink = paper * contrast;
    } else {
      // Each architectural family has its own character texture, oriented to the face.
      thin = true;
      // Joint ink: pale grey mortar between bricks, dark recessed form joints in concrete.
      float jointInk = 0.0;
      if (style == 0 && cellWorld < 0.42) {
        // Brick in running bond once a 0.9 m course spans two cells: bed joints, head joints
        // staggered course by course, and a faint per-brick tone (faded in, so nothing pops).
        float course = floor(heightCoord / 0.9), along = horizontal / 1.8 + 0.5 * mod(course, 2.0);
        bool bed = band(heightCoord / 0.9, 0.0, 0.5) > 0.5;
        code = bed ? A_UNDER : band(along, 0.0, 0.16) > 0.5 ? A_PIPE : A_SPACE;
        float fadeIn = 1.0 - smoothstep(0.24, 0.4, cellWorld);
        paper *= 1.0 + (hash(vec2(floor(along), course) + partSeed) - 0.5) * 0.22 * fadeIn;
        jointInk = fadeIn;
      } else if (style == 1 && !planter && cellWorld < 0.55) {
        // Board-formed concrete up close: the form joints, one cell wide, and the tie holes of a
        // 0.6 x 0.8 m grid once they are two cells apart, each in the one cell nearest its centre.
        vec2 joint = abs(fract(formPanel + 0.5) - 0.5) * vec2(2.4, spacing.y * 0.5) / max(cellWorld, 0.001);
        vec2 tie = abs(fract(vec2(horizontal / 0.6, heightCoord / 0.8)) - 0.5) * vec2(0.6, 0.8) / max(cellWorld, 0.001);
        code = A_COLON;
        if (joint.y < 0.5) { code = floorStroke; jointInk = -1.0; }
        else if (joint.x < 0.5) { code = riseStroke; jointInk = -1.0; }
        else if (cellWorld < 0.3 && max(tie.x, tie.y) < 0.5) { code = A_O; jointInk = -1.0; }
      } else if (nearness > 0.3 || windowCells > 2.0) {
        // (Brick further away keeps only its horizontal coursing: alternating rows would alias.)
        code = style == 0 ? A_UNDER
          : style == 1 ? A_COLON : style == 2 ? riseStroke : style == 3 ? riseStroke
          : style == 4 ? A_DOT : style == 5 ? A_PLUS : style == 6 ? floorStroke : style == 7 ? A_EXCL
          // Corrugated sheet ribs only once a rib spans two cells; panel joints on the stagger.
          : style == 8 ? (cellWorld < 0.22 && band(horizontal / 0.5, 0.0, 0.5) > 0.5 ? A_COLON : riseStroke)
          : style == 9 ? floorStroke
          : style == 10 ? (windowCells > 3.0 && max(band(tile.x, 0.0, 0.05), band(tile.y, 0.0, 0.05)) > 0.5 ? A_PLUS : A_DOT)
          : A_DOT;
        // Corrugations catch the light on one flank and fall into shadow on the other, so up close
        // the sheet reads as ribbed (fixed 0.25 m bands, faded in only once each spans 1.4+ cells).
        if (style == 8) paper *= 1.0 + (band(horizontal / 0.5, 0.0, 0.5) - 0.5) * 0.24 * (1.0 - smoothstep(0.12, 0.18, cellWorld));
      } else code = thinRamp(0.2 + 0.25 * keyLight);
      ink = paper * grain;
      if (jointInk > 0.0) ink = mix(ink, vec3(luma(paper)) * grain * 1.25 + vec3(0.012), 0.55 * jointInk);
      else if (jointInk < 0.0) ink = paper * 0.5;
    }
#ifdef BATCH
    // Outline every massing box: corners and parapets drawn with bold strokes.
    vec3 local = (p - v_center) / max(v_dims * 0.5, vec3(0.001));
    vec3 toEdge = (1.0 - abs(local)) * v_dims * 0.5;
    vec3 edgeCells = toEdge / max(fwidth(p), vec3(0.0005));
    float sideEdge = abs(n.x) > 0.5 ? edgeCells.z : abs(n.z) > 0.5 ? edgeCells.x : min(edgeCells.x, edgeCells.z);
    float topEdge = roof ? 99.0 : edgeCells.y;
    if (min(sideEdge, topEdge) < 1.0 && v_dims.y > 2.5) {
      if (roof) code = strokeFor(edgeCells.x < edgeCells.z ? p.x : p.z);
      else code = sideEdge < topEdge ? riseStroke : (floorStroke == A_DASH ? A_EQ : floorStroke);
      if (!roof && sideEdge < 1.0 && topEdge < 1.0) code = A_PLUS;
      thin = false;
      ink = max(paper * 2.3, lit3 * 1.6) + vec3(0.02, 0.035, 0.04);
    }
    // Neon floor bands (FLAG.BANDS) every seven storeys. Prefiltered: once a band is thinner than
    // half a cell it fades into a faint glow in the paper instead of a stripe that breaks up.
    if ((partFlags & 16) != 0 && !roof && style < 12) {
      vec3 tube = v_glyphColor.rgb;
      float stripe = band(heightCoord / 21.0 + partSeed, 0.0, 0.8 / 21.0);
      if (stripe > 0.5) { code = floorStroke == A_DASH ? A_EQ : floorStroke; thin = false; ink = tube * 1.2 + vec3(0.03); paper = tube * 0.3; emission = tube * 0.6; }
      else { paper += tube * stripe * 0.25; emission += tube * stripe * 0.3; }
    }
    // Lit parapets (FLAG.CROWN; on a helipad its edge lights, on a chimney its hot rim) and neon
    // corner strips (FLAG.CORNERS): exactly one cell wide at any distance, so they never alias,
    // and steady - no blinking.
    // A dark tower (FLAG.DARK) has no lit parapet: on its crown mass (FLAG.DARK | FLAG.CROWN) one
    // top corner carries a single red aviation light instead, fading slowly (0.25 Hz), one cell.
    bool darkTower = (partFlags & 64) != 0;
    bool crownEdge = (partFlags & 1) != 0 && !darkTower && (roof ? sideEdge < 1.0 : topEdge < 1.0 && local.y < 0.0);
    bool cornerEdge = (partFlags & 2) != 0 && !darkTower && !roof && sideEdge < 1.0;
    if ((crownEdge || cornerEdge) && style != 13) {
      vec3 tube = v_glyphColor.rgb;
      if (roof) code = strokeFor(edgeCells.x < edgeCells.z ? p.x : p.z);
      else code = crownEdge && topEdge <= sideEdge ? (floorStroke == A_DASH ? A_EQ : floorStroke) : riseStroke;
      thin = false;
      ink = tube * 1.25 + vec3(0.05); paper = tube * 0.24 + paper * 0.4; emission = tube * 0.55;
    }
    vec2 beaconCorner = vec2(fract(partSeed * 3.7) < 0.5 ? -1.0 : 1.0, fract(partSeed * 5.9) < 0.5 ? -1.0 : 1.0);
    bool beacon = darkTower && (partFlags & 1) != 0 && style < 12 && local.x * beaconCorner.x > 0.0 && local.z * beaconCorner.y > 0.0
      && (roof ? edgeCells.x < 1.0 && edgeCells.z < 1.0 : sideEdge < 1.0 && topEdge < 1.0 && local.y < 0.0);
    if (beacon) {
      float glow = 0.35 + 0.65 * (0.5 + 0.5 * sin(u_time * 1.6 + partSeed * 6.28));
      vec3 red = vec3(0.95, 0.13, 0.09);
      code = A_O; thin = false;
      ink = red * (0.4 + 0.8 * glow); paper = red * 0.22 * glow + paper * 0.4; emission = red * 0.5 * glow;
    }
#endif
#ifdef GROUND
  } else if (SURFACE < 1.5) {
    // Harbour (harbour.ts): past the Rim Roads' outer kerb, the quay, the flood wall line and the
    // water, drawn on the strips harbour-scene.ts records around the street plane. Its stroke is
    // measured here, in uniform control flow.
    int quayStroke = strokeFor(max(abs(p.x), abs(p.z)));
    if (max(abs(p.x), abs(p.z)) > ${(HARBOUR_ROAD + HARBOUR_KERB).toFixed(2)}) {${harbourGroundGlsl()}    }
    // Rootwood Park (park.ts) shades its own lawns, paths, plazas, arena and water.
    else if (!parkGround(p, view, cellWorld, code, thin, paper, ink, emission, flags, reflectedGlyph)) {
    float sx = abs(p.x) < 32.0 ? abs(p.x) * 0.5 : street(p.x), sz = street(p.z);
    float road = 1.0 - step(6.2, min(sx, sz));
    vec3 asphalt = mix(vec3(0.11, 0.15, 0.17), vec3(0.047, 0.062, 0.068), road);
    asphalt *= 0.86 + noise2(p.xz * 0.35) * 0.25;
    // Ground (Agent F). Every texture below is either a smooth tone (no aliasing) or a feature at
    // least a few cells across that fades to its average before a cell spans it: the ground is what
    // players stare at most, so nothing here may sparkle while walking.
    // side: distance from the nearest street's centre line; toJunction: from the cross street's.
    float side0 = min(sx, sz), toJunction = max(sx, sz), along0 = sx < sz ? p.z : p.x;
    // Patched asphalt: a repair in some 9 m squares, darker and smoother than the road around it,
    // its edge a soft step a cell or two wide.
    vec2 patchCell = floor(p.xz / 9.0), patchEdge = vec2(1.2, 0.8) + vec2(hash(patchCell + 5.0), hash(patchCell + 11.0)) * vec2(2.2, 2.6) - abs(fract(p.xz / 9.0) - 0.5) * 9.0;
    float patchSeed = road * step(0.74, hash(patchCell + 71.0)), patchDist = min(patchEdge.x, patchEdge.y);
    float patched = patchSeed * smoothstep(-cellWorld, cellWorld, patchDist);
    asphalt *= 1.0 - 0.2 * patched;
    // Wheel paths polished darker down each lane (and wetter in the rain), the gutter darker
    // still where grit and water collect against the kerb.
    float tracks = road * (1.0 - smoothstep(0.22, 0.55 + cellWorld, abs(abs(side0 - 3.1) - 0.8))) * smoothstep(11.0, 15.0, toJunction);
    float gutter = road * smoothstep(5.3, 6.15, side0);
    asphalt *= (1.0 - 0.1 * tracks) * (1.0 - 0.24 * gutter);
    // Pavement: staggered 0.9 x 1.8 m slabs laid along the street, each a slightly different stone
    // (variation gone before a slab shrinks to a cell), grime gathering toward the building line.
    float kerbDist = side0 - 6.6, slabRow = floor(kerbDist / 0.9), slabCol = along0 / 1.8 + 0.5 * mod(slabRow, 2.0);
    float rowJoint = band(kerbDist / 0.9, 0.0, 0.08), colJoint = band(slabCol, 0.0, 0.04);
    float tiles = max(rowJoint, colJoint), paving = 1.0 - road;
    float slabTone = 1.0 + (hash(vec2(slabRow, floor(slabCol)) + 3.0) - 0.5) * 0.18 * (1.0 - smoothstep(0.12, 0.35, cellWorld));
    float grime = paving * smoothstep(7.8, 10.5, side0) * mix(0.6, noise2(p.xz * 0.6 + 9.0), 1.0 - smoothstep(0.5, 1.4, cellWorld));
    asphalt *= mix(1.0, slabTone * (1.0 - tiles * 0.3) * (1.0 - grime * 0.35), paving);
    float line = (1.0 - smoothstep(0.08, 0.24 + fwidth(sx), sx)) * step(12.0, sz) * band(p.z / 12.0, 0.0, 0.5);
    line += (1.0 - smoothstep(0.08, 0.24 + fwidth(sz), sz)) * step(12.0, sx) * band(p.x / 12.0, 0.0, 0.5);
    float crossing = step(9.5, sx) * step(sx, 13.0) * (1.0 - step(6.0, sz)) * band(p.z / 2.0, 0.0, 0.45);
    crossing += step(9.5, sz) * step(sz, 13.0) * (1.0 - step(6.0, sx)) * band(p.x / 2.0, 0.0, 0.45);
    // Street wear (Agent D): worn patches in the paint, prefiltered to its average before a cell
    // spans a patch so the paint never shimmers at a distance.
    float wear = mix(0.78, smoothstep(0.16, 0.6, noise2(p.xz * 0.9 + 17.0)), 1.0 - smoothstep(0.35, 0.9, cellWorld));
    line *= mix(0.42, 1.0, wear); crossing *= mix(0.55, 1.0, wear);
    // A stop bar before each crossing, a worn edge line inside each kerb between junctions, and
    // tactile paving (blister slabs) where the crossings meet the pavement.
    float stopBar = step(13.35, sx) * step(sx, 13.85) * (1.0 - step(5.9, sz)) + step(13.35, sz) * step(sz, 13.85) * (1.0 - step(5.9, sx));
    float edgeWidth = fwidth(side0);
    float edgeLine = road * (1.0 - smoothstep(0.05, 0.05 + edgeWidth, abs(side0 - 5.15))) * min(1.0, 0.1 / max(edgeWidth, 0.001)) * smoothstep(14.0, 15.0, toJunction);
    // Each of these is only a cell or two deep at a distance, and a one-cell line sliding down the
    // screen toggles every cell it crosses: they fade out while still a few cells deep.
    stopBar *= mix(0.5, 1.0, wear) * (1.0 - smoothstep(0.12, 0.25, cellWorld)); edgeLine *= mix(0.35, 0.9, wear);
    float tactile = (step(9.5, sx) * step(sx, 13.0) * step(6.6, sz) * step(sz, 7.5) + step(9.5, sz) * step(sz, 13.0) * step(6.6, sx) * step(sx, 7.5)) * (1.0 - smoothstep(0.2, 0.4, cellWorld));

    float kerb = step(6.2, min(sx, sz)) * step(min(sx, sz), 6.6);
    // Street furniture in the asphalt: drain grates along the kerbs every 16 m away from the
    // junctions, a manhole in one lane of every block, and tram rails down the avenue's median.
    float side = min(sx, sz), alongStreet = sx < sz ? p.z : p.x;
    float grate = step(5.55, side) * step(side, 6.1) * step(14.0, max(sx, sz)) * step(fract((alongStreet + 8.0) / 16.0), 0.055);
    vec2 blockLocal = mod(p.xz, 64.0);
    vec2 manholeOffset = abs(p.x) < 32.0 ? vec2(99.0) : sx < sz ? vec2(mod(p.x + 32.0, 64.0) - 34.4, blockLocal.y - 24.0) : vec2(blockLocal.x - 40.0, mod(p.z + 32.0, 64.0) - 29.6);
    float manhole = length(manholeOffset);
    float railLine = abs(abs(abs(p.x) - 2.4) - 0.72), railWidth = 0.035 + fwidth(p.x) * 1.2;
    float rail = (1.0 - step(4.0, abs(p.x))) * (1.0 - smoothstep(0.035, railWidth, railLine)) * step(13.0, sz) * (1.0 - smoothstep(0.35, 0.8, cellWorld));
    vec3 lit3 = lighting(p, vec3(0, -1, 0), asphalt, u_rain);
    float nearness = 1.0 - smoothstep(0.2, 1.2, cellWorld);
    // Ground agent: crossings and stop bars in a brighter, cooler white so they read from the kerb.
    paper = lit3 * mix(0.8, 0.6, nearness) + line * vec3(0.26, 0.19, 0.08) + crossing * vec3(0.205, 0.225, 0.22) + kerb * vec3(0.02, 0.07, 0.075);
    paper += stopBar * vec3(0.17, 0.19, 0.185) + edgeLine * vec3(0.07, 0.078, 0.075) + tactile * vec3(0.075, 0.055, 0.014);
    // Light reaching the ground here (lamps, cars, occlusion), to light small debris consistently.
    vec3 groundLight = lit3 / max(asphalt, vec3(0.004));
    // Close up only: litter in the gutter and along the kerb - wet leaves and paper scraps, each
    // several cells across and gone before it could shrink to a speck. (No hairline cracks or
    // other one-cell lines: a line one cell wide sliding past toggles every cell it crosses.)
    // Strokes are measured here, in uniform control flow, where screen derivatives are defined.
    int acrossStroke = strokeFor(side0);
    float litter = 0.0, litterKind = 0.0;
    #ifndef LITE
    if (cellWorld < 0.1) {
      vec2 litterCell = floor(p.xz / 0.7), litterCentre = 0.2 + 0.3 * vec2(hash(litterCell + 3.1), hash(litterCell + 8.7));
      float zone = smoothstep(4.9, 5.6, side0) * (1.0 - smoothstep(7.1, 7.7, side0));
      litter = zone * step(0.84, hash(litterCell + 23.0)) * (1.0 - step(0.12, length(fract(p.xz / 0.7) * 0.7 - litterCentre))) * (1.0 - smoothstep(0.06, 0.1, cellWorld));

      litterKind = hash(litterCell + 41.0);
    }
    #endif
    // Grates and covers darken their patch while they span a cell or more (fading out before they
    // could sparkle as sub-cell specks); their glyphs appear closer still.
    paper *= 1.0 - 0.3 * max(grate, 1.0 - smoothstep(0.42, 0.5, manhole)) * (1.0 - smoothstep(0.35, 0.7, cellWorld));
    // A faint oil sheen on the carriageway: low-contrast hue drift, no texture, gone before it could alias.
    float sheen = smoothstep(0.68, 0.9, noise2(p.xz * 0.21 + 40.0)) * road * (1.0 - smoothstep(1.0, 2.5, cellWorld));
    paper += sheen * (0.5 + 0.5 * sin(p.x * 1.1 + p.z * 0.7)) * vec3(0.012, 0.004, 0.02);
    int along = strokeFor(sx < sz ? p.z : p.x);
    if (line > 0.35) { code = A_EQ; ink = vec3(0.62, 0.46, 0.18); }
    else if (crossing > 0.4) { code = A_HASH; ink = paper * 1.75 + vec3(0.01, 0.012, 0.012); }
    else if (stopBar > 0.4) { code = along == A_DASH ? A_EQ : along; ink = paper * 1.75 + vec3(0.01, 0.012, 0.012); }
    else if (kerb > 0.5) { code = along == A_DASH ? A_EQ : along; ink = paper * 2.1; }
    else if (tactile > 0.5) { code = cellWorld < 0.2 ? A_O : A_COLON; thin = true; ink = paper * 1.7 + vec3(0.03, 0.022, 0.004); }
    else if (grate > 0.5 && cellWorld < 0.5) { code = A_HASH; thin = true; ink = paper * 2.0 + vec3(0.01, 0.014, 0.016); }
    else if (manhole < 0.46 && cellWorld < 0.32) { code = manhole > 0.3 ? A_O : A_PLUS; thin = true; ink = paper * 1.9 + vec3(0.01, 0.012, 0.014); }
    // Tram rails: polished steel catching the lamps (and, in the rain, the neon: see below).
    else if (rail > 0.5) { code = strokeFor(p.z); ink = paper * 2.2 + vec3(0.045, 0.052, 0.058) + min(groundLight, vec3(3.0)) * vec3(0.022, 0.02, 0.018); }
    else if (litter > 0.5) {
      // Leaves (amber, olive) or a scrap of paper, lit like the ground under them.
      vec3 albedo = litterKind < 0.35 ? vec3(0.34, 0.2, 0.07) : litterKind < 0.6 ? vec3(0.2, 0.22, 0.09) : vec3(0.3, 0.31, 0.29);
      code = litterKind < 0.6 ? (litterKind < 0.2 ? A_COMMA : litterKind < 0.45 ? A_TILDE : A_TICK) : (litterKind < 0.8 ? A_EQ : A_DASH);
      thin = litterKind < 0.6; ink = albedo * groundLight * 0.9; paper = mix(paper, ink * 0.45, 0.35);
    }
    else if (edgeLine > 0.4 && cellWorld < 0.1) { code = acrossStroke; thin = true; ink = paper * 1.6 + vec3(0.02, 0.022, 0.021); }
    // Comfort: the ground streams past fastest in the lower visual field, so its texture is the
    // faintest in the city - enough to feel speed, not enough to crawl.
    else if (road > 0.5) { code = cellWorld > 0.7 ? A_SPACE : A_DOT; thin = true; ink = paper * 1.45; }
    else if (cellWorld < 0.09 && tiles > 0.35) {

      // Slab joints close up: strokes along each joint, a cross where two meet.
      code = rowJoint > 0.2 && colJoint > 0.2 ? A_PLUS : rowJoint > colJoint ? acrossStroke : along;

      thin = true; ink = paper * 1.5 + vec3(0.018, 0.025, 0.028);
    }
    else { code = cellWorld < 0.3 ? A_SPACE : cellWorld < 1.2 ? along : A_DOT; thin = true; ink = paper * mix(1.3, 1.65, nearness); }
    #ifdef REFLECTIONS
    // Everything below scales with u_rain (wetness, the streaks, the rain rings), so a dry street
    // skips it - and its ten reflection taps per ground cell - outright, with an identical result.
    if (u_rain > 0.001) {
    float pools = noise2(p.xz * vec2(0.43, 0.64)) + noise2(p.xz * 1.13) * 0.12;
    float puddle = smoothstep(0.77, 0.86, pools) * road;
    float grazing = 1.0 - clamp(abs(view.y), 0.0, 1.0);
    // (Agent F: no extra reflectivity in the gutters or wheel paths - the mirrored scene is the
    // busiest thing on the ground while moving, so it stays confined to the puddles.)
    // Weather agent: puddles brim a little in a downpour and dull a little in a drizzle (minutes).
    float rainNow = weatherRain();
    // REFLECT (wet asphalt): the street no longer copies the mirrored scene's colour cells (that read
    // as a blocky grey smear). It reflects LIGHT: bright/emissive content strongly, diffuse surfaces
    // barely, stretched into vertical streaks, broken by a still world-space ripple mask, weighted by
    // a Fresnel term, and drawn with streak glyphs ('|' ':' '.') on dark wet asphalt.
    // Fresnel (softened Schlick): almost nothing looking down at the feet, strong toward the horizon.
    float fresnel = WET_FRESNEL_MIN + (1.0 - WET_FRESNEL_MIN) * pow(grazing, WET_FRESNEL_POW);
    // Plain wet asphalt reflects a little; puddles a lot (and calmly, see the ripple mask).
    float wetness = u_rain * (0.9 + 0.15 * rainNow) * mix(0.4, 1.0, road);
    float reflectivity = wetness * mix(WET_ASPHALT, WET_PUDDLE, puddle) * fresnel;
    // Ripples: still, world-space breakup of the streaks (no time term: the rain rings below are the
    // only motion). Prefiltered to its average before a ripple shrinks to a cell, so nothing crawls.
    float rippleNoise = noise2(p.xz * vec2(1.9, 2.6) + 23.0) * 0.7 + noise2(p.xz * vec2(4.1, 5.3) + 61.0) * 0.3;
    float rippleDetail = 1.0 - smoothstep(0.08, 0.3, cellWorld);
    float ripple = mix(0.72, smoothstep(0.3, 0.72, rippleNoise), rippleDetail);
    ripple = mix(ripple, 1.0, puddle);
    // Vertical streak: five taps down the mirrored column (centre, +-STEP, +-2 STEP rows), each taken
    // as its brighter attachment and weighted toward light sources (a luminance knee), then a
    // tapered max (streak length) blended with the average (a 5-tap vertical filter: no block edges).
    ivec2 reflSize = textureSize(u_reflectionInk, 0);
    ivec2 texel = ivec2(clamp(gl_FragCoord.xy, vec2(0), vec2(reflSize) - 1.0));
    texel.x = reflSize.x - 1 - texel.x;
    // Light-source weighting: diffuse walls keep a sliver (more in a calm puddle), neon/windows/lamps all.
    float dim = mix(WET_DIFFUSE, WET_DIFFUSE * 2.5, puddle);
    // One tap per iteration (row offsets 0, +S, -S, +2S, -2S; average weights 0.3/0.22/0.13, max
    // taper 1/0.8/0.55): two texture calls in the source instead of ten.
    vec3 streakAvg = vec3(0), streakMax = vec3(0);
    for (int k = 0; k < 5; k++) {
      int reach = (k + 1) / 2, rowOffset = (k % 2 == 1 ? 1 : -1) * reach * WET_STEP;
      ivec2 tap = ivec2(texel.x, clamp(texel.y + rowOffset, 0, reflSize.y - 1));
      vec3 c = max(texelFetch(u_reflectionInk, tap, 0).rgb, texelFetch(u_reflectionPaper, tap, 0).rgb);
      c *= dim + smoothstep(WET_KNEE_LO, WET_KNEE_HI, luma(c));
      streakAvg += c * (reach == 0 ? 0.3 : reach == 1 ? 0.22 : 0.13);
      streakMax = max(streakMax, c * (reach == 0 ? 1.0 : reach == 1 ? 0.8 : 0.55));
    }
    vec3 streak = mix(streakAvg, streakMax, 0.6) * vec3(0.85, 0.93, 1.0);
    // Wet asphalt is darker than dry, then carries the streak: in the paper a soft tint (so the
    // cell never turns into a flat colour block), in the ink the bright core drawn as a glyph.
    float wetDark = 1.0 - WET_DARKEN * wetness;
    paper *= wetDark; ink *= wetDark;
    float strength = reflectivity * ripple;
    vec3 wetLight = streak * strength;
    paper += wetLight * WET_PAPER;
    float level = luma(wetLight);
    // Streak glyphs only on bare asphalt and paving (markings, grates, rails keep their glyphs and
    // just take the colour). Ink scales with the level, so a cell crossing a threshold changes
    // glyph at low contrast, never pops.
    bool bareGround = code == A_DOT || code == A_SPACE;
    if (bareGround && level > WET_GLYPH_MIN) {
      float over = smoothstep(WET_GLYPH_MIN, WET_GLYPH_MIN * 3.0, level);
      code = level > WET_GLYPH_BAR ? A_PIPE : level > WET_GLYPH_MIN * 2.0 ? A_COLON : A_DOT;
      thin = level <= WET_GLYPH_BAR;
      ink = mix(ink, paper + wetLight * WET_INK, over);
    } else {
      ink += wetLight * WET_INK * 0.5;
    }
    // Far streaks are light sources: let them survive the haze a little like the lights themselves.
    emission += wetLight * 0.25;
    // Rails and kerb edges catch it brighter: the steel and stone lips are the wettest highlights.
    if (flags == 0.0 && (rail > 0.5 || kerb > 0.5)) ink += streak * (rail > 0.5 ? 0.6 : 0.25) * wetness * (0.3 + 0.7 * fresnel);
    vec2 rainCell = floor(p.xz / 3.0), delta = fract(p.xz / 3.0) - 0.5;
    float ringClock = u_time * 0.7 + hash(rainCell), age = fract(ringClock);
    // Weather agent: a ring plays only while the rain beats a per-cycle roll (drizzle ~50%, steady
    // ~95%), decided between rings, so none is cut off.
    float ring = (1.0 - smoothstep(0.008, 0.05, abs(length(delta) - age * 0.7))) * (1.0 - age) * step(hash(rainCell + vec2(floor(ringClock) * 7.13, 3.7)), 0.3 + rainNow);
    paper += ring * puddle * u_rain * vec3(0.012, 0.027, 0.032);
    if (flags == 0.0 && ring * puddle * u_rain > 0.5 && cellWorld < 0.35) { code = A_O; thin = true; ink = paper * 1.8 + vec3(0.02, 0.04, 0.05); }
    } // u_rain
    #endif
    } // parkGround
#endif
  } else if (${architecture || !drawn.has(3) ? "true" : "SURFACE < 2.5"}) {
    vec3 albedo = v_glyphColor.rgb;
    float emissive = smoothstep(0.64, 0.95, max(albedo.r, max(albedo.g, albedo.b)));
    vec3 lit3 = mix(lighting(p, n, albedo, 0.22), albedo, emissive * 0.9);
    emission = albedo * emissive * 0.7;
    paper = lit3 * 0.5; ink = lit3 * 1.45;
    useCharacter = true;
  } else {
    // Signs: real letters. Each sign has its own behaviour - buzzing, marquee, power-up sweeps,
    // a slow pulse - and its own frame (tube outline, double rail, bulb marquee, brackets) and
    // lettering (neon tube, bulbs or a lit LED face).
    // Distance tiers, all keyed to the letters' size in cells: far away (the whole sign decides,
    // see signLod: letters under ~2.2 cells or slots under ~1.2 cells anywhere along the word)
    // the sign is a glowing panel carrying a dense '=' text band as long as its words, so it reads
    // as a lit sign from across the city; then one real character per slot on a glowing slot;
    // then the 3x5 block face; then 8x8 ASCII-art letters. The panel <-> letters swap dissolves
    // through a plain lit panel (signFade); the letter faces change one letter at a time; frames
    // only appear once the sign is big enough that they no longer eat its letters.
    // Formats (u_signStyle, see signage.ts): classic; boxed shop signs with a logo emblem left of
    // the name; back-lit lightboxes (dark letters on a lit panel); LED matrix tickers running the
    // message feed; small inserts (OPEN, 24H) pulsing slowly. Looks give each district its own
    // lettering: Neon Ward pink/cyan double tubes, Silk Market warm bulbs, Ghost Circuit
    // half-dead tubes with missing letters, Foundry striped stencil plates with hazard rails,
    // the Spillway's cheap cracked lightboxes. None animates faster than the calibrated buzz.
    vec2 uv = v_uv;
    float seed = u_signSeed, len = max(u_textLength, 1.0);
    int style = int(u_signStyle + 0.5), format = style % 8, look = style / 8;
    int mode = int(mod(floor(seed * 97.0), 4.0));
    int frameStyle = int(fract(seed * 13.7) * 4.0), face = int(fract(seed * 3.31) * 3.0);
    if (look == 2) { face = 0; frameStyle = 0; }
    else if (look == 5) { if (fract(seed * 5.1) > 0.35) face = 1; if (fract(seed * 2.7) > 0.5) frameStyle = 2; }
    else if (look == 1) { face = 2; frameStyle = 1; }
    if (look == 3 || look == 1 || format == 1 || format == 2) mode = mode == 1 ? 0 : mode;
    if (format == 3) { mode = -1; frameStyle = 1; face = 2; }
    else if (format == 4) { mode = 3; frameStyle = 0; face = 0; }
    else if (format == 1) frameStyle = 0;
    bool vertical = u_vertical > 0.5;
    // LED tickers read the message feed (FEED_ROW), everything else its own packed letters.
    int textRow = format == 3 ? FEED_ROW + int(fract(seed * 7.3) * float(MESSAGE_COUNT)) : -1;
    float textFrom = format == 1 ? 0.27 : format == 3 ? 0.03 : 0.05, textSpan = format == 1 ? 0.68 : format == 3 ? 0.94 : 0.9;
    // Shop signs (signage.ts) pass u_signSpan: the fraction of the board the word needs at a fixed
    // letter pitch (0.8 of the letter height, the 3x5 face's aspect). The word keeps that pitch and
    // sits centred in its text region instead of stretching its letters apart across the board.
    if (u_signSpan > 0.0 && !vertical) { textFrom += (textSpan - u_signSpan) * 0.5; textSpan = u_signSpan; }
    vec2 lc, lcDx, lcDy;
    float wrap = 0.0, bandCoord;
    if (vertical) {
      float alongRaw = (uv.y - 0.05) / 0.9 * len, along = clamp(alongRaw, 0.0, 0.9999 * len);
      float inside = (uv.x - 0.16) / 0.68;
      lc = vec2(floor(along) + clamp(inside, 0.0, 0.999), inside < 0.0 || inside >= 1.0 ? -1.0 : fract(along) * 1.12 - 0.06);
      // Derivatives of the continuous (inside, along) coordinates: lc itself jumps between letters.
      vec2 c = vec2(inside, alongRaw * 1.12);
      lcDx = dFdx(c); lcDy = dFdy(c);
      bandCoord = along;
    } else {
      lc = vec2((uv.x - textFrom) / textSpan * len, (uv.y - 0.16) / 0.68);
      // Marquees scroll at 1.2 letters/s and the LED feed crawls at 1.1 (u_textLength is the
      // letters across the panel): at 2.4 / 1.4 a near sign's cells turned over 2-5 times a second.
      if (mode == 1) { lc.x += u_time * 1.2; wrap = len + 3.0; }
      if (format == 3) lc = vec2(lc.x + u_time * 1.1 + floor(seed * 50.0) * 7.0, (uv.y - 0.2) / 0.6);
      lcDx = dFdx(lc); lcDy = dFdy(lc);
      bandCoord = lc.x;
    }
    // Whole-sign level of detail. Deciding legibility per cell (per letter) let a sign seen down the
    // street draw some letters and drop others ("L F OR  A WA MO") - its far end, or a slot squeezed
    // under a cell at a grazing angle, fell into the band tier or lost its one-character cell while
    // the rest of the word stayed. So the sign decides once, from one value every cell of the panel
    // computes identically: the projected letter height and slot width at the text's two ends (the
    // farther end is the smaller), from the panel's own world axes (exact on a plane: p is affine in
    // uv) and the camera's focal length in cells. The focal length comes from the per-cell change of
    // the view ray: for a pinhole camera its Jacobian has singular values cos^2(a)/f and cos(a)/f
    // whatever the off-axis angle a, so f = s1 / s2^2 is the same in every cell on screen.
    vec2 signUvX = dFdx(uv), signUvY = dFdy(uv);
    vec3 signPX = dFdx(p), signPY = dFdy(p);
    float signDet = signUvX.x * signUvY.y - signUvX.y * signUvY.x;
    signDet = abs(signDet) < 1e-12 ? 1e-12 : signDet;
    vec3 axisU = (signPX * signUvY.y - signPY * signUvX.y) / signDet, axisV = (signPY * signUvX.x - signPX * signUvY.x) / signDet;
    vec3 signCentre = p - axisU * (uv.x - 0.5) - axisV * (uv.y - 0.5);
    vec3 rayDir = normalize(p - eye), rayX = dFdx(rayDir), rayY = dFdy(rayDir);
    float raySum = dot(rayX, rayX) + dot(rayY, rayY), rayDet = length(cross(rayX, rayY));
    float raySigmaHi = 0.5 * (sqrt(raySum + 2.0 * rayDet) + sqrt(max(raySum - 2.0 * rayDet, 0.0)));
    float raySigmaLo = max(rayDet / max(raySigmaHi, 1e-9), 1e-9);
    float focalCells = raySigmaLo / max(raySigmaHi * raySigmaHi, 1e-12);
    // Letter height and slot width as world vectors; the text runs along axisU (horizontal) or axisV.
    vec3 letterAxis = vertical ? axisV * (0.9 / len / 1.12) : axisV * (format == 3 ? 0.6 : 0.68);
    vec3 slotAxis = vertical ? axisU * 0.68 : axisU * (textSpan / len);
    // A marquee (mode 1) scrolls its letters across the whole board, not just its text span.
    vec3 runAxis = vertical ? axisV * 0.45 : axisU * (mode == 1 ? 0.5 : textSpan * 0.5);
    vec3 endA = signCentre - runAxis - eye, endB = signCentre + runAxis - eye;
    float distA = max(length(endA), 0.1), distB = max(length(endB), 0.1);
    vec3 viewA = endA / distA, viewB = endB / distB;
    float signLetterCells = focalCells * min(length(letterAxis - dot(letterAxis, viewA) * viewA) / distA, length(letterAxis - dot(letterAxis, viewB) * viewB) / distB);
    float signSlotCells = focalCells * min(length(slotAxis - dot(slotAxis, viewA) * viewA) / distA, length(slotAxis - dot(slotAxis, viewB) * viewB) / distB);
    // Legible (every letter gets its own cell, letters at least ~2.2 cells tall: the one-character
    // tier and up) above 0.5, the lit panel with its text band below. Around 0.5 the sign dissolves
    // through a plain lit panel: the outgoing tier's ink eases onto its paper, the glyphs swap at
    // zero contrast, the incoming tier's ink eases up (signFade below) - over ~+-6% of distance
    // (~12 m around a fascia's 100 m swap: seconds of walking, never a frame-to-frame pop).
    float signLod = min(smoothstep(1.7, 2.7, signLetterCells), smoothstep(0.95, 1.45, signSlotCells));
    float signFade = smoothstep(0.0, 0.22, abs(signLod - 0.5));
    float letterCells = 1.0 / max(max(abs(lcDx.y), abs(lcDy.y)), 1e-4);
    vec2 uvFoot = max(fwidth(uv), vec2(1e-4));
    vec2 signCells = 1.0 / uvFoot, edgeCells = min(uv, 1.0 - uv) / uvFoot;
    // The letter face (one character, 3x5 blocks, 8x8 art) is also decided once per sign, from the
    // same sign-wide sizes (the text's smaller end). Per letter, a sign parked between two faces
    // drew half its word in one size and half in the other: a marquee "KITO RADIO" read as big
    // bulb blocks "KIT O" mashed together, then a widely spaced one-character "R A D". The
    // swap dissolves at zero contrast (tierFade, applied with signFade below) over ~+-7% of
    // distance, so the whole word changes face together, never letter by letter.
    float tierBlock = min(signLetterCells / 5.2, signSlotCells / 4.2);
    float tierArt = min(signLetterCells / 15.5, signSlotCells / 7.5);
    int signTier = tierArt >= 1.0 ? 2 : tierBlock >= 1.0 ? 1 : 0;
    float tierFade = smoothstep(0.0, 0.07, abs(tierBlock - 1.0)) * smoothstep(0.0, 0.07, abs(tierArt - 1.0));
    float cover = 0.0;
    bool letterThin = false;
    int letter = textGlyphTier(lc, lcDx, lcDy, textRow, wrap, signTier, cover, letterThin);
    int k = int(floor(lc.x));
    // Boxed signs: a round logo emblem in a square left of the name (radius R = 36% of the height,
    // at most 10% of the width), from the quad's own world size (exact on a plane).
    vec2 logoQ = vec2(9.0), logoDx = vec2(1.0), logoDy = vec2(1.0);
    if (format == 1 && !vertical) {
      vec2 uvX = dFdx(uv), uvY = dFdy(uv);
      vec3 pX = dFdx(p), pY = dFdy(p);
      float uvDet = uvX.x * uvY.y - uvX.y * uvY.x;
      uvDet = abs(uvDet) < 1e-12 ? 1e-12 : uvDet;
      float worldW = length((pX * uvY.y - pY * uvX.y) / uvDet), worldH = length((pY * uvX.x - pX * uvY.x) / uvDet);
      float logoR = max(min(0.36 * worldH, 0.1 * worldW), 1e-3);
      logoQ = vec2((uv.x - 0.15) * worldW, (uv.y - 0.5) * worldH) / logoR;
      logoDx = dFdx(logoQ); logoDy = dFdy(logoQ);
    }
    // The far tier: a sign whose letters cannot all be drawn (signLod < 0.5, decided for the whole
    // sign above) is drawn as a lit text band - a dense '=' wherever this cell's footprint along the text
    // covers a letter, '-' at the edge of a word, blank between words - on glowing glass. Every
    // non-space letter looks the same, so nothing shimmers as letters slide between cells; the
    // band only says "lit lettering here, this long, this colour" until the letters can resolve.
    float bandFoot = max(abs(dFdx(bandCoord)), abs(dFdy(bandCoord)));
    // Whole sign, never letter by letter: a per-letter switch left words half band, half letters.
    bool bandTier = signLod < 0.5;
    int bandA = textCode(vec2(bandCoord - bandFoot * 0.25, 0.5), textRow, wrap), bandB = textCode(vec2(bandCoord + bandFoot * 0.25, 0.5), textRow, wrap);
    int bandInk = int(bandA != A_SPACE) + int(bandB != A_SPACE);
    bool bandRow = vertical ? lc.y > -0.5 : lc.y > -0.08 && lc.y < 1.08;
    if (bandTier) k = int(floor(bandCoord));
    float intensity = 1.0;
    // Comfort: no strobing, no steps, nothing faster than ~0.35 Hz. A failing tube breathes: half
    // its letters sag by up to 18% on slow value noise (~0.35 Hz). Once a short-out cycle (every
    // 8-16 s, in step with its spark bursts, vfx.ts SIGN_SHORT) the whole tube sags to ~70%,
    // easing down over 0.35 s and back up over ~0.9 s.
    if (mode == 0) {
      float breath = 0.18 * smoothstep(0.3, 0.9, noise2(vec2(u_time * 0.35, seed * 91.0))) * step(0.5, hash(vec2(float(k), seed)));
      float shortAge = mod(u_time + seed * ${SIGN_SHORT.offset.toFixed(2)}, ${SIGN_SHORT.period.toFixed(2)} + seed * ${SIGN_SHORT.spread.toFixed(2)});
      float sag = ${SIGN_SHORT.depth.toFixed(2)} * smoothstep(0.0, ${SIGN_SHORT.ease.toFixed(2)}, shortAge) * (1.0 - smoothstep(0.5, 1.4, shortAge));
      intensity = 1.0 - max(breath, sag);
    } else if (mode == 2) {
      // Power-up sweep, one cycle per ~9 s: the letters come on one after another, each easing up
      // over ~0.4 s; the lit sign holds through one shallow ~12% sag (~2.7 s long), then the
      // whole sign eases back down to standby over ~1.4 s before the cycle wraps, so the wrap
      // is invisible (it used to drop every letter to 20% in one frame).
      float powerPhase = fract(u_time * 0.11 + seed);
      float turnOn = 0.05 + 0.45 * (float(k) + 0.5) / len;
      float powered = smoothstep(turnOn, turnOn + 0.045, powerPhase) * (1.0 - smoothstep(0.85, 1.0, powerPhase));
      float swell = sin(PI * clamp((powerPhase - 0.55) / 0.3, 0.0, 1.0));
      intensity = 0.2 + 0.8 * powered * (1.0 - 0.12 * swell * swell);
    }
    else if (mode == 3) intensity = 0.75 + 0.25 * sin(u_time * 1.3 + seed * 20.0);
    // Tired tubes: on about half the buzzing / sweeping signs one letter in ten runs dim -
    // permanently (it never blinks), and still bright enough to read. On a few, one letter is
    // dead outright: an unlit grey tube, the classic missing letter - grey enough that its shape
    // still reads against the glass (near black, it read as a word with a letter cut out).
    bool dead = (mode == 0 || mode == 2) && fract(seed * 17.3) > 0.8 && k == int(fract(seed * 5.9) * len);
    if ((mode == 0 || mode == 2) && fract(seed * 11.0) > 0.5 && hash(vec2(float(k), seed * 3.1)) > 0.9) intensity *= 0.5;
    // Ghost Circuit: half-dead signs - about a fifth of the letters dead, a quarter more running
    // at half power, all of it static (the dead ones never come back, nothing flickers more).
    if (look == 3 && !vertical) {
      float rot = hash(vec2(float(k) + 0.37, seed * 5.7));
      dead = dead || (rot < 0.2 && fract(seed * 4.3) > 0.25);
      if (rot > 0.2 && rot < 0.45) intensity *= 0.45;
    }
    vec3 neon = v_glyphColor.rgb;
    if (mode == 3 && format == 0) neon = mix(neon, neon.gbr, 0.5 + 0.5 * sin(u_time * 0.4 + seed * 7.0));
    // Each sign pairs its letter colour with a second neon for the frame, outlines and arrows;
    // in Neon Ward always the pink / cyan pair.
    vec3 neon2 = mix(neon.brg, neon.gbr, step(0.5, fract(seed * 5.3))) * 0.9 + 0.06;
    if (look == 2) neon2 = neon.r > neon.b ? vec3(0.25, 0.92, 1.0) : vec3(1.0, 0.28, 0.7);
    // Bulb lettering is warm white whatever the sign's colour; the neon tints its glass.
    vec3 letterTint = face == 1 ? mix(vec3(1.0, 0.86, 0.6), neon, 0.25) : neon;
    vec3 glass = vec3(0.012, 0.02, 0.026);
    // Far away the whole panel glows a little (its letters' light averaged), so a distant sign
    // reads as lit glass rather than a dark plate.
    float far = 1.0 - smoothstep(1.5, 6.0, letterCells);
    // Animated chevrons along the bottom margin of some horizontal signs, once the margin is a
    // whole cell tall and each chevron at least two cells wide (so they never alias). They march
    // at 0.35 chevrons/s (a cell sees one every ~2.9 s; at 1.1 they strobed past at 1.1 Hz) and
    // each cell eases its chevron in and out over ~0.35 s instead of switching it.
    float chevronCoord = uv.x * len * 1.5 - u_time * 0.35, chevronFoot = fwidth(chevronCoord);
    float chevronPhase = fract(chevronCoord);
    float chevronLit = smoothstep(0.0, 0.12, chevronPhase) * (1.0 - smoothstep(0.28, 0.4, chevronPhase));
    bool chevron = !vertical && format == 0 && fract(seed * 7.7) > 0.55 && 0.08 / uvFoot.y >= 1.2 && chevronFoot < 0.5
      && uv.y > 0.87 && uv.y < 0.95 && chevronPhase < 0.4;
    // Frames only on signs at least 6 cells across their short side: on smaller ones a border
    // row would replace the letters (far signs used to show nothing but dashes).
    // From 6 cells the frame's ink eases up from its paper over 6-8 cells (frameFade, applied in
    // the frame branch): a smooth fade, where a screen-fixed dithered threshold shimmered in the
    // band of distances it covered.
    float frameCells = min(signCells.x, signCells.y);
    bool framed = frameCells >= 6.0 && min(edgeCells.x, edgeCells.y) < 1.0;
    float frameFade = smoothstep(6.0, 8.0, frameCells);
    // Bulb marquee frames: bulbs are fixed on the sign in world units (a fifth of the board's short
    // side apart, a whole number of them along each rail), so walking toward the sign never
    // re-indexes them and the chase never slides. The bulb ('O') sits in the one cell its centre
    // falls in, the wire between bulbs is dots. At 6+ cells across the short side a bulb pitch is
    // over a cell, so each cell holds at most one bulb. The chase is slow (~1.4 s per bulb).
    float signWorldW = length(axisU), signWorldH = length(axisV);
    float bulbPitch = max(min(signWorldW, signWorldH) * 0.2, 0.05);
    bool railRow = edgeCells.y < 1.0;
    // Both coordinates' derivatives taken unconditionally: a rail row sharing a 2x2 quad with the row
    // inside it would otherwise difference two unrelated coordinates (bulbs flicker solid).
    float railCoord = uv.x * max(1.0, floor(signWorldW / bulbPitch + 0.5)), sideCoord = uv.y * max(1.0, floor(signWorldH / bulbPitch + 0.5));
    float railFoot = fwidth(railCoord), sideFoot = fwidth(sideCoord);
    float bulbCoord = railRow ? railCoord : sideCoord, bulbFoot = max(railRow ? railFoot : sideFoot, 1e-4);
    bool bulbCell = floor(bulbCoord - 0.5 + bulbFoot * 0.5) != floor(bulbCoord - 0.5 - bulbFoot * 0.5);
    float bulbIndex = floor(bulbCoord);
    float bulb = 0.5 + 0.5 * cos(bulbIndex * 0.9 - u_time * 1.6);
    emission = letterTint * cover * intensity;
    if (dead) intensity = 0.0;
    // The logo emblem (boxed signs): logoFoot is one cell in emblem radii.
    float logoFoot = max(max(abs(logoDx.x), abs(logoDy.x)), max(abs(logoDx.y), abs(logoDy.y))), logoR = length(logoQ);
    bool logoHere = format == 1 && !vertical && logoR < 1.0 + logoFoot;
    if (logoHere && !framed) {
      // Far away one symbol glyph in the one cell holding the emblem's centre; from ~2.5 cells of
      // radius a ring drawn with the strokes that follow it round a monogram (the name's first
      // letter: one character, then the 3x5 block face once its pixels span a cell). Static.
      paper = glass + neon2 * (0.06 + 0.06 * far); code = A_SPACE; ink = neon2 * 0.3;
      float logoJac = logoDx.x * logoDy.y - logoDy.x * logoDx.y;
      vec2 toLogo = abs(logoJac) > 1e-9 ? vec2(logoDy.x * logoQ.y - logoDy.y * logoQ.x, logoDx.y * logoQ.x - logoDx.x * logoQ.y) / logoJac : vec2(1e4);
      bool logoCentre = floor(toLogo.x + 0.5) == 0.0 && floor(toLogo.y + 0.5) == 0.0;
      int monogram = packedChar(0);
      int lcol = int(floor((logoQ.x + 0.42) / 0.84 * 3.0)), lline = int(floor((logoQ.y + 0.5) * 5.0));
      if (logoFoot > 0.4) {
        int symbol = int(fract(seed * 23.1) * 6.0);
        if (logoCentre) { code = symbol == 0 ? A_AT : symbol == 1 ? A_AMP : symbol == 2 ? A_DOLLAR : symbol == 3 ? A_PCT : symbol == 4 ? A_STAR : A_CAPO; thin = false; ink = neon2 * 1.5; }
      } else if (abs(logoR - 0.84) < max(0.1, logoFoot * 0.75)) {
        code = abs(logoQ.x) < 0.38 * logoR ? A_DASH : abs(logoQ.y) < 0.38 * logoR ? A_PIPE : logoQ.x * logoQ.y < 0.0 ? A_BSLASH : A_SLASH;
        thin = false; ink = neon2 * 1.35 * max(intensity, 0.5); emission = neon2 * 0.3;
      } else if (logoFoot < 0.18) {
        bool lit = lcol >= 0 && lcol < 3 && lline >= 0 && lline < 5 && miniBit(monogram, lcol, lline) == 1;
        if (lit) { code = A_HASH; thin = false; ink = letterTint * 1.4 * max(intensity, 0.5); paper = glass + neon * 0.12; emission = neon * 0.3; }
      } else if (logoCentre) { code = monogram; thin = false; ink = letterTint * 1.5 * max(intensity, 0.5); }
    } else if (bandTier) {
      // Far tier: the lit text band on a glowing panel (see bandInk above).
      paper = glass + neon * (0.07 + 0.1 * intensity);
      code = A_SPACE; ink = paper;
      if (bandRow && bandInk > 0) {
        code = bandInk == 2 ? A_EQ : A_DASH; thin = false;
        ink = letterTint * (0.75 + 0.55 * intensity) * (bandInk == 2 ? 1.0 : 0.7);
        paper = glass + neon * (0.1 + 0.16 * intensity);
        if (dead) { ink = vec3(0.13, 0.135, 0.15); paper = glass + neon * 0.04; }
      }
      emission = neon * (bandRow ? 0.36 : 0.2) * intensity;
    } else if (framed) {
      bool corner = edgeCells.x < 1.0 && edgeCells.y < 1.0, rail = edgeCells.y < 1.0;
      if (frameStyle == 1) code = corner ? A_HASH : rail ? A_EQ : A_PIPE;
      else if (frameStyle == 2) code = bulbCell ? A_O : A_DOT;
      else if (frameStyle == 3) code = corner ? (uv.x < 0.5 ? A_LBR : A_RBR) : rail ? (uv.y < 0.5 ? A_UNDER : A_DASH) : (uv.x < 0.5 ? A_LBR : A_RBR);
      else code = corner ? A_PLUS : rail ? A_DASH : A_PIPE;
      float lamp = frameStyle == 2 ? (0.45 + 0.75 * bulb) * (bulbCell ? 1.0 : 0.55) : 1.0;
      vec3 frameInk = frameStyle == 2 ? vec3(1.0, 0.82, 0.55) : neon2;
      // Foundry plates: hazard-striped rails, amber and soot, in stripes fixed on the plate (the
      // bulb pitch), not in screen cells (those slid along the rail as you walked).
      if (look == 1 && rail && !corner) { code = A_SLASH; frameInk = mod(bulbIndex, 2.0) < 0.5 ? vec3(1.0, 0.62, 0.16) : vec3(0.16, 0.13, 0.1); }
      // frameFade: from its paper (matching the unframed glass) the frame's ink eases up over 6-8 cells.
      paper = glass + mix(neon * 0.035 * intensity, neon2 * 0.05, frameFade);
      ink = mix(paper, frameInk * 0.55 * (0.6 + 0.4 * max(intensity, 0.4)) * lamp, frameFade);
      emission = frameStyle == 2 ? frameInk * 0.25 * lamp * frameFade : vec3(0.0);
    } else if (chevron) {
      code = A_GT; thin = false;
      ink = neon2 * 1.3 * chevronLit; paper = glass + mix(neon * 0.035 * intensity, neon2 * 0.06, chevronLit); emission = neon2 * 0.3 * chevronLit;
    } else if (cover > 0.05 && letter == A_SPACE) {
      // Large letters: the partly covered cells around each stroke become a thin second-colour
      // outline - a double-stroke tube.
      code = A_COLON; thin = true;
      ink = neon2 * (0.5 + 0.8 * cover) * intensity;
      paper = neon * (0.05 + 0.2 * cover) * intensity + glass;
    } else if (cover > 0.05) {
      // The lettering face: tube letters keep their own glyph, bulb letters become lamps (o / O),
      // the LED face a dense block.
      code = letter;
      if (face == 1 && (letter == A_HASH || (letterCells > 13.0 && cover > 0.6))) code = letter == A_HASH ? A_CAPO : A_O;
      else if (face == 2 && letter == A_HASH) code = format == 3 ? A_O : look == 1 ? A_EQ : A_AT;
      thin = letterThin;
      float lamp = face == 1 ? 0.8 + 0.2 * cos(float(k) * 1.7 - u_time * 1.2) : 1.0;
      ink = letterTint * (0.7 + 1.1 * cover) * intensity * lamp;
      paper = neon * (0.08 + 0.3 * cover) * intensity + glass;
      if (dead) { ink = vec3(0.19, 0.2, 0.22); paper = glass + vec3(0.01); }
    } else {
      code = A_SPACE; paper = glass + neon * 0.035 * intensity; ink = neon * 0.2;
      // The one-character tier: the rest of each letter's slot is softly lit, so the sign keeps
      // its brightness while the letters shrink to one cell each (no dark plate in between).
      bool inSlot = lc.y >= 0.0 && lc.y < 1.0 && fract(lc.x) < 0.82 && letter != A_SPACE;
      if (inSlot && letterCells < 6.4) paper += neon * 0.11 * intensity * (1.0 - smoothstep(5.2, 6.4, letterCells));
      // LED matrix: once letters are block-sized, the unlit diodes of the text rows show as dim
      // dots (one per cell, so the field never crawls).
      if (format == 3 && lc.y >= 0.0 && lc.y < 1.0 && letterCells >= 4.6) { code = A_DOT; thin = true; ink = neon * 0.22; }
    }
    // Back-lit lightboxes: the panel is the light and the letters dark film on it (every tier).
    // Some Spillway boxes are cracked corner to corner: a static dark seam, a dimmer end.
    if (format == 2 && !(framed && !bandTier) && !logoHere) {
      float lightbox = max(intensity, 0.4) * (0.3 + 0.08 * (1.0 - abs(uv.y - 0.5) * 2.0));
      bool cracked = look == 6 && fract(seed * 9.1) > 0.45;
      if (cracked && uv.x > 0.78) lightbox *= 0.6;
      bool film = bandTier ? bandRow && bandInk > 0 : cover > 0.3 && letter != A_SPACE;
      paper = glass + neon * lightbox; emission = neon * 0.3 * max(intensity, 0.4);
      if (film) { ink = neon * 0.05 + vec3(0.012); thin = false; if (!bandTier) code = letter; }
      else { code = A_SPACE; ink = paper; }
      if (cracked && abs(uv.y - 0.1 - uv.x * 0.8 - 0.03 * sin(uv.x * 31.0)) < uvFoot.y * 0.6) { code = A_SLASH; thin = true; ink = neon * 0.06; paper *= 0.7; }
    }
    // A faint backplate gradient (light pooling in the middle of the glass), stronger far away.
    if (!bandTier) paper += neon * (0.012 + 0.08 * far) * (1.0 - abs(uv.y - 0.5) * 1.6) * max(intensity, 0.3);
    // The tier swap (signLod crossing 0.5) happens at zero contrast: the text cells of the whole
    // sign ease their ink onto a shared lit-panel paper and back, so the band and the letters never
    // show at once and nothing pops. Driven by distance only (no time term): walking toward a sign
    // takes several seconds through it, standing still it holds.
    if (signFade < 1.0 && !logoHere && (bandTier || (!framed && !chevron))) {
      if (format != 2) paper = mix(glass + neon * (bandRow ? 0.19 : 0.13) * max(intensity, 0.35), paper, signFade);
      ink = mix(paper, ink, signFade);
    }
    // The letter-face swap (signTier) the same way, but on the sign's own glass: around a tier
    // boundary the text rows settle onto one shared paper and their ink onto it, the whole word
    // swaps face at zero contrast and eases back up.
    if (tierFade < 1.0 && !bandTier && !logoHere && !framed && !chevron) {
      bool textRowCell = vertical ? lc.y > -0.5 : lc.y > -0.08 && lc.y < 1.08;
      if (format != 2) {
        if (textRowCell) paper = mix(glass + neon * 0.1 * max(intensity, 0.35), paper, tierFade);
        emission *= tierFade;
      }
      ink = mix(paper, ink, tierFade);
    }
  }

  // Facade night haze (atmospheric perspective, facades only - signs, tickers and holograms keep
  // their own LOD): past ~60 m walls sink toward a dark haze taken from the sky behind them, and
  // their glyph texture calms (ink settles onto the paper) a little ahead of the mass, so distant
  // towers become dark silhouettes and stop shimmering. Lit cells (windows, neon trims, bands) haze
  // about half as fast and keep half their ink contrast, so the skyline stays dotted with windows
  // and neon lines. Low storeys sit a touch deeper in the street mist than crowns. A pure function
  // of world position and eye: no time term, stable in world space. Nothing changes under 60 m.
  if (${on(0, "SURFACE < 0.5")} && !isSky) {
    float hazeDepth = smoothstep(60.0, 320.0, length(p - eye));
    if (hazeDepth > 0.0) {
      float streetMist = exp(-max(0.0, -p.y) * 0.03);
      float litCell = smoothstep(0.03, 0.25, max(emission.r, max(emission.g, emission.b)));
      vec3 nightHaze = sky * 0.5 + vec3(0.003, 0.006, 0.011);
      float wallHaze = hazeDepth * (0.84 + 0.1 * streetMist), lightHaze = hazeDepth * (0.42 + 0.08 * streetMist);
      paper = mix(paper, nightHaze, mix(wallHaze, lightHaze, litCell));
      ink = mix(ink, paper, mix(min(1.0, hazeDepth * 1.3), hazeDepth * 0.5, litCell));
      emission *= 1.0 - 0.35 * hazeDepth;
    }
  }

  vec3 fogs = isSky ? vec3(0) : fogTerms(p);
  float fog = clamp(1.0 - (1.0 - fogs.y) * (1.0 - fogs.z), 0.0, 1.0);
  // Glyph texture fades by the full haze, a little ahead of the masses (far detail would shimmer);
  // lit windows and neon fade halfway between the two, so they read through the smog without
  // turning into bright blocks. Both still reach the sky at the edge.
  float textureFog = min(1.0, (1.0 - (1.0 - fogs.x) * (1.0 - fogs.z)) * 1.15);
  float lit = smoothstep(0.03, 0.25, max(emission.r, max(emission.g, emission.b)));
  // Distant masses settle a little darker than the sky behind them (a silhouette), then meet it
  // at the edge of the draw distance.
  vec3 fogColor = sky * mix(0.72, 0.9, fogs.z);
  vec3 haze = isSky ? vec3(0) : atmosphere(p);
  // Bright points survive the haze longer than diffuse surfaces, then go dark too.
  vec3 glow = emission * fog * (1.0 - fog) * 0.6;
  paper = mix(paper, fogColor, fog) + glow + haze;
  ink = mix(ink, fogColor, mix(textureFog, fog, lit * 0.5)) + glow + haze;
  paper = toneMap(paper);
  ink = toneMap(ink);
  paper *= u_fadeIn; ink *= u_fadeIn;
  vec3 character = useFeed ? feedGlyph : useCharacter ? v_glyphIndex : asciiGlyph(code, thin);
  if (flags > 0.0) character = reflectedGlyph;
  // Props keep textmode's own glyph transforms (t.charRotation, flipX/Y, invert): spinning wheels etc.
  float rotation = 0.0;
  if (useCharacter) {
    flags = float(int(v_glyphFlags.r > 0.5) | (int(v_glyphFlags.g > 0.5) << 1) | (int(v_glyphFlags.b > 0.5) << 2));
    rotation = clamp(v_glyphFlags.a, 0.0, 1.0);
  }
  o_character = vec4(character.xy, flags / 255.0, rotation);
  o_primaryColor = vec4(ink, 1.0);
  o_secondaryColor = vec4(paper, 1.0);
}`);
}
function withDiscard(opaque: boolean, source: string): string {
  const body = source.replaceAll("discard;", "DISCARD;");
  return body.replace("precision highp int;", `precision highp int;
#define DISCARD ${opaque ? "" : "discard"}`);
}
/** Compile-time rule 1 (top of this file) for GLSL spliced in from another module: every
 * `for (int i = a; i < N; i++)` with a literal or named-constant bound N becomes KEEP_LOOP(N), so
 * fxc keeps it a loop. Bounds read from data (`k < r.y`) are left alone. Only for loops without
 * screen derivatives inside: the park's path, plaza and lantern loops. */
export function keepLoops(glsl: string): string {
  return glsl.replace(/for \(int (\w+) = (\d+); \1 < (\w+); \1\+\+\)/g, "for (int $1 = $2; $1 < KEEP_LOOP($3); $1++)");
}

/** Everything but the ground, facades and holograms, in the main and the mirrored pass (u_mirror). */
export const CITY_MATERIAL = cityMaterial({ ground: false, surfaces: SURFACES.scene });
/** The street plane (and Rootwood Park) in the main pass; the only variant sampling the reflection. */
export const GROUND_MATERIAL = cityMaterial({ reflections: true, surfaces: SURFACES.ground });
/** Tower and street holograms in both passes (u_mirror selects the pass), see SURFACES. */
export const HOLOGRAM_MATERIAL = cityMaterial({ ground: false, surfaces: SURFACES.hologram });
/** The reference renderer (`?reference=1`) draws buildings through the main material too. */
export const REFERENCE_MATERIAL = cityMaterial({ reflections: true });

// A tight glow on the brightest neon only: the characters underneath stay sharp.
export const CLARITY_FILTER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_radius, u_strength;
out vec4 fragColor;
vec3 bright(vec2 uv) {
  vec3 c = texture(u_texture, uv).rgb;
  return c * smoothstep(0.7, 1.0, max(c.r, max(c.g, c.b)));
}
void main() {
  vec4 source = texture(u_texture, v_uv); vec2 d = u_radius / u_resolution;
  vec3 light = bright(v_uv + vec2(d.x, 0)) + bright(v_uv - vec2(d.x, 0)) + bright(v_uv + vec2(0, d.y)) + bright(v_uv - vec2(0, d.y));
  light += 0.5 * (bright(v_uv + d * 2.0) + bright(v_uv - d * 2.0) + bright(v_uv + vec2(d.x, -d.y) * 2.0) + bright(v_uv + vec2(-d.x, d.y) * 2.0));
  // A faint outer halo about one cell out (a pinwheel of 4 taps, so it has no grid-aligned
  // streaks): neon reads as light in the rain without softening the glyphs themselves.
  light += 0.22 * (bright(v_uv + d * vec2(4.0, 2.0)) + bright(v_uv + d * vec2(-2.0, 4.0)) + bright(v_uv + d * vec2(-4.0, -2.0)) + bright(v_uv + d * vec2(2.0, -4.0)));
  float vignette = 1.0 - 0.16 * pow(length((v_uv - 0.5) * 1.4), 2.0);
  fragColor = vec4((source.rgb + light * u_strength / 6.0) * vignette, source.a);
}`;
