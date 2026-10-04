import { densityRamp } from "./atlas";
import { MESSAGE_ROW, MINI_FONT_OFFSET } from "./scene-data";
// VFX agent: SURFACE 8 (wheels, steam, searchlights) lives in vfx-shaders.ts, spliced in below.
import { VFX_GLSL_BRANCH, VFX_GLSL_DECLARATIONS } from "./vfx-shaders";
// Park agent: Rootwood Park's ground (`parkGround`, used by the SURFACE < 1.5 branch) is generated
// from the park layout constants in park.ts.
import { parkGlsl } from "./park";

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
  CAPB: "B", CAPM: "M", CAPW: "W", CAPH: "H", ZERO: "0", ONE: "1", I: "i", LPAR: "(", RPAR: ")", CAPY: "Y",
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
export function cityMaterial({ reflections = false, batch = false, opaque = false, lite = false, architecture = false, ground = true } = {}): string {
  const includesGround = ground && !architecture;
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
uniform float u_text0, u_text1, u_text2, u_textLength, u_vertical, u_signSeed;
uniform float u_holoRow, u_holoSeed;
uniform vec3 u_holoTint;
#ifdef REFLECTIONS
uniform sampler2D u_reflectionInk, u_reflectionPaper, u_reflectionGlyph;
#endif
layout(location=0) out vec4 o_character;
layout(location=1) out vec4 o_primaryColor;
layout(location=2) out vec4 o_secondaryColor;
${ASCII_DEFINES}
const int BOLD_RAMP[${BOLD_RAMP.length}] = int[${BOLD_RAMP.length}](${codes(BOLD_RAMP)});
const int THIN_RAMP[${THIN_RAMP.length}] = int[${THIN_RAMP.length}](${codes(THIN_RAMP)});
const int MESSAGE_ROW = ${MESSAGE_ROW};
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
int textByte(int x, int row) { return int(texelFetch(u_text, ivec2(x, row), 0).r * 255.0 + 0.5); }
int fontBit(int code, int x, int y) {
  int i = (clamp(code, 32, 126) - 32) * 8 + clamp(y, 0, 7);
  return (textByte(i % 64, i / 64) >> (7 - clamp(x, 0, 7))) & 1;
}
// Sign text arrives packed as 6-bit codes (space, A-Z, 0-9) in three floats.
int packedChar(int k) {
  if (k < 0 || float(k) >= u_textLength) return A_SPACE;
  uint packed = uint(k < 4 ? u_text0 : k < 8 ? u_text1 : u_text2);
  int c = int((packed >> uint((k % 4) * 6)) & 63u);
  return c == 0 ? 32 : c <= 26 ? 64 + c : 48 + c - 27;
}
int messageChar(int row, int k) {
  int len = max(1, textByte(0, row)), period = len + 5, i = k % period;
  if (i < 0) i += period;
  return i >= len ? A_SPACE : textByte(1 + i, row);
}
int textCode(vec2 lc, int row, float wrap) {
  int k = int(floor(lc.x));
  if (wrap > 0.0) { k = k % int(wrap); if (k < 0) k += int(wrap); }
  return row < 0 ? packedChar(k) : messageChar(row, k);
}
// 3x5 face: font pixel (x, y) of a glyph, used when letters are 5-9 cells tall.
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
// one cell per pixel; from ~9 cells as 8x8 ASCII art made of the letter itself, edges thin.
// dx/dy: the per-cell change of lc. Callers whose lc jumps between letters (vertical signs
// stack letters with floor/fract) pass derivatives of the continuous coordinate instead: dFdx
// across the jump is huge, and the samples and size tier on that row then picked stray pieces of
// other letters - broken lines between letters.
int textGlyphD(vec2 lc, vec2 dx, vec2 dy, int row, float wrap, out float cover, out bool thinGlyph) {
  thinGlyph = false;
  float letterCells = 1.0 / max(length(vec2(dx.y, dy.y)), 1e-4);
  int code = textCode(lc, row, wrap);
  if (letterCells >= 5.2 && letterCells < 9.0) {
    // Mid distance: the 3x5 face with one character cell per font pixel (plus one of spacing).
    int col = int(floor(fract(lc.x) * 4.0)), line = int(floor(lc.y * 6.0));
    cover = col < 3 && line >= 0 && line < 5 && code != A_SPACE ? float(miniBit(code, col, line)) : 0.0;
    return code;
  }
  if (letterCells < 9.0) {
    float stepX = max(length(vec2(dx.x, dy.x)), 1e-4), stepY = 1.0 / letterCells;
    bool column = stepX >= 1.0 || abs(fract(lc.x) - 0.5) <= stepX * 0.5;
    bool line = abs(lc.y - 0.5) <= max(stepY, 0.02) * 0.5 || (stepY >= 1.0 && lc.y >= 0.0 && lc.y <= 1.0);
    cover = column && line && code != A_SPACE ? 1.0 : 0.0;
    return code;
  }
  cover = textCoverage(lc, dx, dy, row, wrap);
  if (cover > 0.6) return code == A_SPACE ? A_HASH : code;
  if (cover > 0.3) { thinGlyph = true; return code == A_SPACE ? A_COLON : code; }
  return A_SPACE;
}
int textGlyph(vec2 lc, int row, float wrap, out float cover, out bool thinGlyph) {
  return textGlyphD(lc, dFdx(lc), dFdy(lc), row, wrap, cover, thinGlyph);
}

vec3 skyColor(vec3 direction) {
  float up = -direction.y;
  vec3 zenith = vec3(0.004, 0.006, 0.011);
  vec3 smog = vec3(0.022, 0.042, 0.052);
  vec3 sodium = vec3(0.11, 0.055, 0.026);
  vec3 color = mix(zenith, smog, exp(-max(up, 0.0) * 6.0));
  color += sodium * exp(-max(up, 0.0) * 16.0);
  return color * (1.0 - 0.55 * smoothstep(0.0, -0.35, up));
}
// Height fog near the street plus a guaranteed fade into the sky at the draw distance.
float fogAmount(vec3 p) {
  vec3 eye = eyePosition();
  float distanceToEye = length(p - eye), across = length(p.xz - eye.xz);
  float startHeight = max(0.0, -eye.y), endHeight = max(0.0, -p.y), dh = (endHeight - startHeight) * 0.035;
  float density = exp(-startHeight * 0.035) * (abs(dh) < 0.01 ? 1.0 : (1.0 - exp(-dh)) / dh);
  float haze = 1.0 - exp(-distanceToEye * (0.0006 + density * 0.0014));
  float edge = smoothstep(u_viewRadius * 0.4, u_viewRadius * 0.97, across);
  return clamp(1.0 - (1.0 - haze) * (1.0 - edge), 0.0, 1.0);
}

float blocked(vec3 start, vec3 end) {
  vec3 ray = end - start, inv = sign(ray + 0.00001) / max(abs(ray), vec3(0.00001));
  for (int i = 0; i < 10; i++) {
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
  for (int i = 0; i < 12; i++) {
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
  for (int i = 0; i < 8; i++) {
    vec3 delta = datum(i).xyz - p;
    float d2 = dot(delta, delta), radius = datum(i).w;
    float falloff = pow(max(0.0, 1.0 - d2 / (radius * radius)), 2.0) / (1.0 + d2 * 0.023);
    if (falloff < 0.001) continue;
    vec3 l = normalize(delta);
    float diffuse = max(dot(n, l), 0.0), spec = pow(max(dot(n, normalize(l + eye)), 0.0), 70.0) * wet;
    result += datum(i + 8).rgb * (albedo * (0.14 + diffuse) * 3.5 + spec * 1.8) * falloff * blocked(p + n * 0.16, datum(i).xyz);
  }
  float ao = 0.0;
  for (int i = 0; i < 10; i++) {
    vec2 q = abs(p.xz - datum(i + 16).xy) - datum(i + 16).zw;
    ao = max(ao, exp(-length(max(q, 0.0)) * 0.65) * exp(-abs(p.y) * 0.24) * 0.45);
  }
  result += albedo * carLight(p, n, wet) * 2.4 + carLight(p, n, wet) * wet * 0.05;
  return result * (1.0 - ao);
}
vec3 atmosphere(vec3 p) {
  if (u_atmosphere < 0.5) return vec3(0);
  vec3 ray = p - eyePosition(); float rayLength = length(ray), limit = min(rayLength, 170.0);
  vec3 direction = ray / max(rayLength, 0.001), sum = vec3(0);
  // Midpoint integration through lamp cones, terminated at actual scene depth.
  for (int i = 0; i < ATMOSPHERE_STEPS; i++) {
    vec3 q = eyePosition() + direction * (float(i) + 0.5) * (limit / float(ATMOSPHERE_STEPS));
    // Lamp heads over the kerb: streetLamp() in world.ts (the central avenue's sit further out).
    vec2 lampCell = floor((q.xz - vec2(5.75, 6.75)) / 64.0 + 0.5);
    vec2 lamp = lampCell * 64.0 + (lampCell.x == 0.0 ? vec2(12.5, 9.5) : vec2(5.75, 6.75));
    float h = 8.0 + q.y;
    float cone = (1.0 - smoothstep(h * 0.24 + 0.25, h * 0.7 + 0.6, length(q.xz - lamp))) * step(0.0, h) * step(h, 8.2) * step(max(abs(lampCell.x), abs(lampCell.y)), 11.5);
    float density = 0.7 + 0.3 * noise2(q.xz * 0.25 + u_time * 0.03);
    sum += vec3(0.9, 0.58, 0.27) * cone * density * 0.012 * (limit / float(ATMOSPHERE_STEPS));
    vec2 beacon = vec2(0.0, round(q.z / 128.0) * 128.0 + 32.0); float drop = 26.0 + q.y;
    float shaft = (1.0 - smoothstep(1.0 + drop * 0.1, 2.0 + drop * 0.24, length(q.xz - beacon))) * step(0.0, drop) * step(drop, 26.0);
    sum += vec3(0.11, 0.31, 0.37) * shaft * 0.012 * (limit / float(ATMOSPHERE_STEPS));
    // Headlight beams made visible by the rain, for the four nearest cars.
    for (int c = 0; c < ATMOSPHERE_CARS; c++) {
      vec4 car = datum(240 + c);
      if (car.w <= 0.0 || u_rain < 0.5) continue;
      vec2 forward = vec2(sin(car.z), -cos(car.z)), d = q.xz - car.xy;
      float along = dot(d, forward) - 2.9, side = dot(d, vec2(-forward.y, forward.x));
      if (along <= 0.0 || along > 40.0) continue;
      float width = 0.5 + along * 0.18, lift = -q.y - 0.8;
      float cone = (1.0 - smoothstep(width * 0.3, width, length(vec2(side, lift * 1.6)))) * exp(-along * 0.07);
      sum += vec3(0.8, 0.74, 0.6) * cone * car.w * 0.007 * (limit / float(ATMOSPHERE_STEPS));
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

  if (${architecture ? "false" : "SURFACE > 7.5"}) {
    // VFX surface (vfx-shaders.ts): spinning wheels, steam volumes, searchlight beams.
${VFX_GLSL_BRANCH}
  } else if (${architecture ? "false" : "SURFACE > 6.5"}) {
    // Hologram: a giant translucent figure - a woman's bust that tilts and blinks, or a koi
    // swimming through the rain - rim-lit, scanlined and glitching, with a slogan crawling below.
    vec2 uv = v_uv;
    float frame = floor(u_time * 14.0);
    // Comfort: glitches are rare and small (no 14 Hz strobing across a whole tower face).
    float glitch = step(0.985, hash(vec2(frame, u_holoSeed))) * (hash(vec2(floor(uv.y * 24.0), frame)) - 0.5) * 0.035;
    uv.x += glitch;
    vec2 q = (uv - vec2(0.5, 0.45)) * vec2(1.25, 2.1);
    float body = 0.0, detail = 0.0;
    if (u_holoSeed < 0.5) {
      float tilt = sin(u_time * 0.35 + u_holoSeed * 6.0) * 0.08;
      vec2 h = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * (q - vec2(0.0, -0.3));
      float head = length(h / vec2(0.2, 0.27)) - 1.0;
      float hair = max(length((h - vec2(0.0, -0.05)) / vec2(0.27, 0.33)) - 1.0, -(h.y - 0.1));
      float neck = max(abs(q.x) - 0.075, abs(q.y + 0.02) - 0.1);
      float shoulders = max(length((q - vec2(0.0, 0.34)) / vec2(0.56, 0.3)) - 1.0, q.y - 0.52);
      float d = min(min(head, hair * 0.9), min(neck * 4.0, shoulders));
      body = 1.0 - smoothstep(-0.02, 0.06, d);
      float rim = 1.0 - smoothstep(0.0, 0.14, abs(d + 0.05));
      float blink = step(0.06, fract(u_time * 0.23 + u_holoSeed));
      float eyes = (1.0 - smoothstep(0.0, 0.02, length((vec2(abs(h.x), h.y) - vec2(0.075, -0.02)) / vec2(1.0, 0.45 * blink + 0.05)) - 0.035)) * step(head, 0.0);
      float lips = (1.0 - smoothstep(0.0, 0.02, length((h - vec2(0.0, 0.14)) / vec2(1.0, 0.45)) - 0.04)) * step(head, 0.0);
      detail = max(rim, max(eyes, lips * 0.8));
    } else {
      float t = u_time * 0.5 + u_holoSeed * 10.0;
      vec2 k = q - vec2(sin(t) * 0.18, cos(t * 0.7) * 0.25);
      float angle = cos(t) * 0.5 + 1.57;
      k = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * k;
      float fish = length(k / vec2(0.34, 0.12)) - 1.0;
      float tail = max(abs(k.y) - (k.x - 0.26) * 0.6 * (1.0 + 0.3 * sin(t * 6.0)), max(0.26 - k.x, k.x - 0.52));
      float d = min(fish, tail * 3.0);
      body = 1.0 - smoothstep(-0.02, 0.05, d);
      detail = max(1.0 - smoothstep(0.0, 0.1, abs(d + 0.04)), step(0.0, -fish) * step(0.5, fract(k.x * 9.0 + k.y * 4.0)) * 0.5);
    }
    float signal = body * (0.35 + 0.65 * detail) * 1.3;
    float scan = 0.55 + 0.45 * step(0.45, fract(uv.y * 34.0 - u_time * 0.9));
    float breathe = 0.78 + 0.22 * sin(u_time * 1.7 + u_holoSeed * 9.0);
    float cover = 0.0;
    bool letterThin = false;
    vec2 lc = vec2(uv.x * 7.0 + u_time * 1.6 + u_holoSeed * 40.0, (uv.y - 0.72) / 0.16);
    int letter = textGlyph(lc, MESSAGE_ROW + int(u_holoRow), 0.0, cover, letterThin);
    float intensity = max(signal * scan, cover) * breathe;
    if (intensity < 0.18 && bayer(gl_FragCoord.xy) > 0.25) discard;
    code = cover > 0.05 ? letter : boldRamp(clamp(signal * scan, 0.0, 0.99));
    thin = cover > 0.05 && letterThin;
    vec3 tint = cover > 0.05 ? vec3(1.0, 0.86, 0.62) : u_holoTint;
    ink = tint * (0.45 + intensity * 1.5);
    paper = tint * (0.03 + intensity * 0.12);
    emission = ink * 0.5;
  } else if (SURFACE > 5.5) {
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
    if (abs(n.y) > 0.5) { code = A_EQ; paper = neon * 0.05; ink = neon * 0.25; }
    else if (v < 0.13 || v > 0.87) {
      code = railCells > 0.6 ? A_EQ : A_DASH; ink = neon * 0.55; paper = neon * 0.1;
    } else {
      float cover = 0.0;
      vec2 lc = vec2(s / letterWorld + u_time * 2.2, (v - 0.13) / 0.74);
      code = textGlyph(lc, row, 0.0, cover, thin);
      float pulse = 0.85 + 0.15 * sin(u_time * 3.0 + s * 0.2);
      ink = neon * (0.5 + 1.4 * cover) * pulse;
      paper = neon * (0.04 + 0.16 * cover);
      emission = neon * cover * 0.8;
      if (cover < 0.05) { code = A_SPACE; ink = neon * 0.2; }
    }
#endif
  } else if (${architecture ? "false" : "SURFACE > 4.5"}) {
    // Hologram screen: the synth feed's own cells, re-lit as emissive panels.
    vec2 size = vec2(textureSize(u_feedInk, 0));
    ivec2 texel = ivec2(clamp(vec2(v_uv.x, 1.0 - v_uv.y) * size, vec2(0.0), size - 1.0));
    vec3 feedInk = texelFetch(u_feedInk, texel, 0).rgb, feedPaper = texelFetch(u_feedPaper, texel, 0).rgb;
    float edge = step(min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y)), 0.03);
    feedGlyph = texelFetch(u_feedGlyph, texel, 0).rgb; useFeed = edge < 0.5;
    ink = feedInk * 1.35; paper = feedPaper * 1.3 + feedInk * 0.14;
    emission = feedInk * 0.6;
    if (edge > 0.5) { code = A_HASH; ink = vec3(0.1, 0.55, 0.62); paper = ink * 0.3; }
  } else if (${architecture ? "false" : "SURFACE > 3.5"}) {
    // Sky dome: smog lit from below, slow cloud banks, sparse stars through the gaps.
    isSky = true;
    vec3 direction = normalize(p - eye);
    float up = -direction.y;
    paper = skyColor(direction);
    vec2 plane = direction.xz / max(up + 0.12, 0.05);
    float clouds = noise2(plane * 1.3 + vec2(u_time * 0.01, 0.0)) * 0.65 + noise2(plane * 3.1 - u_time * 0.006) * 0.35;
    clouds = smoothstep(0.45, 0.9, clouds) * smoothstep(-0.02, 0.25, up);
    paper += vec3(0.026, 0.026, 0.03) * clouds + vec3(0.05, 0.024, 0.012) * clouds * exp(-max(up, 0.0) * 5.0);
    ink = paper * 1.6 + vec3(0.004);
    code = thinRamp(clouds * 0.7); thin = true;
    vec2 starCell = floor(vec2(atan(direction.z, direction.x), asin(clamp(up, -1.0, 1.0))) * 140.0);
    float star = hash(starCell);
    if (up > 0.12 && clouds < 0.15 && star > 0.996) {
      code = star > 0.9993 ? A_STAR : star > 0.998 ? A_PLUS : A_DOT; thin = star < 0.998;
      ink = vec3(0.55, 0.62, 0.72) * (0.5 + 0.5 * sin(u_time * 0.35 + star * 90.0));
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
  } else if (SURFACE < 0.5) {
    int style = clamp(int(round((v_cellColor.a * 255.0 - 32.0) / 28.0)), 0, 7);
    bool roof = abs(n.y) > 0.5;
    float horizontal = abs(n.x) > 0.5 ? p.z : p.x;
    float heightCoord = -p.y;
    vec2 spacing = style == 1 ? vec2(4.8, 6.4) : style == 2 ? vec2(2.4, 3.6) : style == 3 ? vec2(7.0, 8.8) : style == 4 ? vec2(3.4, 4.8) : style == 5 ? vec2(5.2, 5.5) : style == 7 ? vec2(2.1, 6.7) : vec2(2.8, 4.2);
    vec2 tile = vec2(horizontal, heightCoord) / spacing;
    float windowCells = min(spacing.x, spacing.y) / max(cellWorld, 0.001);
    float facadePlane = floor((abs(n.x) > 0.5 ? p.x : p.z) * 4.0 + 0.5) * 0.25;
    vec2 windowId = floor(tile) + floor(p.xz / 64.0) * 13.7 + vec2(facadePlane * 0.73, abs(n.x) > 0.5 ? 19.17 : 0.0);
    float seed = hash(windowId), seed2 = hash(windowId + 41.3);
    vec2 winX = style == 1 ? vec2(0.42, 0.64) : style == 2 ? vec2(0.06, 0.94) : vec2(0.18, 0.78);
    vec2 winY = style == 2 ? vec2(0.12, 0.92) : style == 3 ? vec2(0.55, 0.73) : vec2(0.22, 0.73);
    vec2 paneSpan = vec2(winX.y - winX.x, winY.y - winY.x);
    vec2 paneFootprint = max(fwidth(tile) / paneSpan, vec2(0.001));
    float paneResolution = 1.0 / max(paneFootprint.x, paneFootprint.y);
    float detail = smoothstep(0.8, 1.9, paneResolution);
    float windowMask = band(tile.x, winX.x, winX.y) * band(tile.y, winY.x, winY.y);
    if (style == 7) windowMask *= band(horizontal / 14.0, 0.18, 0.75);
    float occupancy = style == 2 ? 0.24 : style == 3 ? 0.4 : 0.46;
    float lit = step(1.0 - occupancy, seed);
    float lights = windowMask * mix(occupancy, lit, detail) * (roof ? 0.0 : 1.0);
    vec3 concrete = v_cellColor.rgb * (0.87 + 0.13 * noise2(p.xz * 0.08 + vec2(p.y * 0.09)));
    float slab = band(tile.y, 0.93, 1.0);
    vec3 warm = mix(vec3(0.66, 0.43, 0.21), vec3(0.86, 0.74, 0.5), seed2);
    vec3 windowColor = mix(warm, v_glyphColor.rgb * 0.7, step(style == 7 ? 0.25 : 0.84, seed2));
    if (style == 3) windowColor = mix(vec3(0.38, 0.58, 0.45), warm, step(0.6, seed2));
    float flicker = 0.94 + 0.06 * sin(u_time * 0.24 + seed * 14.0);
    emission = windowColor * lights * flicker;
    vec3 lit3 = lighting(p, n, concrete * (1.0 - slab * 0.28), roof ? u_rain * 0.65 : 0.12);
    // City glow: sodium and neon light from the street bounces up every facade, strongest low
    // down, plus a cool smog fill from the sky - a lived-in city is never a black void.
    float streetGlow = exp(-heightCoord * 0.04);
    vec3 bounce = vec3(0.2, 0.105, 0.05) * streetGlow + vec3(0.05, 0.07, 0.09) * (0.5 + 0.5 * smoothstep(0.0, 120.0, heightCoord));
    lit3 += concrete * bounce * (roof ? 0.35 : 1.0);
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
    if (roof) {
      code = cellWorld < 0.5 ? A_HASH : cellWorld < 1.4 ? A_PLUS : A_DOT; thin = cellWorld >= 0.5;
      ink = paper * 1.4;
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
      float glassMix = 0.1 + 0.76 * fresnel;
      vec2 roomUv = paneUv;
      float roomDetail = smoothstep(3.5, 7.0, paneResolution);
#ifndef LITE
      vec2 viewAcross = vec2(abs(n.x) > 0.5 ? view.z : view.x, -view.y);
      roomUv += clamp(viewAcross / max(facing, 0.24), vec2(-1.2), vec2(1.2)) * vec2(0.13, 0.1) * roomDetail;
#endif
      if (lit > 0.5) {
        int fills[8] = int[8](A_HASH, A_AT, A_PCT, A_AMP, A_EIGHT, A_CAPB, A_CAPM, A_CAPW);
        code = fills[clamp(int(seed2 * 8.0), 0, 7)];
        if (seed2 > 0.8) code = A_EQ;
        ink = windowColor * 1.2 * flicker;
        paper = mix(paper, windowColor * 0.3, 0.8);
        if (!framed && roomDetail > 0.01) {
          vec2 lamp = vec2(0.25 + 0.5 * fract(seed * 7.31), 0.5 + 0.3 * fract(seed * 3.17));
          vec2 d = (roomUv - lamp) * vec2(1.4, 1.9);
          float b = 0.42 + 0.58 * exp(-dot(d, d) * 2.6);
          float kind = fract(seed2 * 5.73 + seed * 1.9);
          vec3 tint = windowColor;
#ifdef LITE
          bool rich = false;
          float slatCount = 4.0;
#else
          bool rich = paneResolution > 8.0;
          float slatCount = 7.0;
#endif
          if (kind < 0.16) {
            tint = vec3(0.35, 0.55, 0.95);
            vec2 tv = roomUv - vec2(0.8, 0.28);
            b = (0.35 + 0.65 * exp(-dot(tv, tv) * 3.5)) * (0.88 + 0.12 * sin(u_time * 0.9 + seed * 31.0));
          }
          b = mix(0.65, b, roomDetail);
          code = boldRamp(clamp(0.2 + b * 0.79, 0.0, 0.99));
          ink = mix(ink, tint * (0.55 + 1.1 * b) * flicker, roomDetail);
          paper = mix(paper, tint * (0.08 + 0.34 * b) * flicker, roomDetail);
          if (kind >= 0.16 && kind < 0.36) {
            float slat = prefilteredBand(paneUv.y * slatCount, 0.0, 0.45, paneFootprint.y * slatCount);
            code = slat > 0.5 ? A_EQ : A_DASH; thin = slat <= 0.5;
            ink = mix(ink, tint * (0.4 + 0.9 * b), roomDetail); paper = mix(paper, tint * (0.05 + 0.2 * b), roomDetail);
          } else if (rich && kind >= 0.36 && kind < 0.54 && (paneUv.x < 0.24 || paneUv.x > 0.76)) {
            code = paneUv.x < 0.12 || paneUv.x > 0.88 ? A_PIPE : paneUv.x < 0.5 ? A_LPAR : A_RPAR;
            vec3 cloth = mix(vec3(0.55, 0.16, 0.2), vec3(0.2, 0.34, 0.3), fract(seed * 13.0));
            ink = cloth * (0.5 + 0.6 * b); paper = cloth * 0.12 * (0.5 + b);
          } else if (rich && kind >= 0.54 && kind < 0.74) {
            float px = 0.3 + 0.4 * fract(seed * 5.13);
            vec2 head = (roomUv - vec2(px, 0.66)) * vec2(1.0, 0.8);
            bool body = abs(roomUv.x - px) < 0.13 + 0.06 * (1.0 - smoothstep(0.3, 0.52, roomUv.y)) && roomUv.y < 0.54;
            if (dot(head, head) < 0.011 || body) { code = dot(head, head) < 0.011 ? A_O : A_CAPM; ink = tint * 0.16; paper = tint * 0.035; }
          } else if (rich && kind >= 0.74 && kind < 0.86 && roomUv.y < 0.24) {
            code = fract(roomUv.x * 5.0) < 0.5 ? A_STAR : A_CAPY;
            ink = vec3(0.3, 0.75, 0.4) * (0.5 + 0.7 * b); paper = tint * 0.08;
          }
          emission = mix(emission, tint * b * 0.6, roomDetail);
        }
      } else {
        code = A_DOT; thin = true;
        paper = lit3 * 0.21 + vec3(0.008, 0.014, 0.022);
        ink = paper * 1.35;
        glassMix = 0.25 + 0.7 * fresnel;
        if (paneResolution > 5.0 && seed2 > 0.72) { code = A_EQ; ink = paper * 1.5; }
      }
#ifndef LITE
      vec2 roomEdge = min(roomUv, 1.0 - roomUv);
      float recess = mix(1.0, 0.38 + 0.62 * smoothstep(-0.04, 0.14, min(roomEdge.x, roomEdge.y)), roomDetail);
      paper *= recess; ink *= recess; emission *= recess;
#endif
      paper = mix(paper, reflection, glassMix);
      ink = mix(ink, reflection * 1.22, glassMix);
      emission *= 1.0 - glassMix;
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
    } else if (slab > 0.45 && windowCells > 1.8) {
      code = floorStroke == A_DASH ? A_EQ : floorStroke;
      ink = paper * contrast * 0.85;
    } else if (!roof && windowCells > 3.0 && style != 2 && band(tile.x, winX.x - 0.04, winX.y + 0.04) * band(tile.y, winY.x - 0.07, winY.x) > 0.5) {
      // Window sills: a ledge catching the street light.
      code = floorStroke == A_DASH ? A_UNDER : floorStroke; thin = false;
      paper = lit3 * 0.85 + bounce * concrete * 0.4; ink = paper * contrast;
    } else if (!roof && windowCells > 4.0 && style != 2 && hash(windowId + 7.7) > 0.8 && band(tile.x, 0.52, 0.8) * band(tile.y, winY.x - 0.24, winY.x - 0.08) > 0.5) {
      // Air-conditioning units hung under some windows.
      float ax = (fract(tile.x) - 0.52) / 0.28;
      code = ax < 0.14 ? A_LBR : ax > 0.86 ? A_RBR : A_HASH; thin = ax >= 0.14 && ax <= 0.86;
      paper = vec3(0.07, 0.08, 0.085) + lit3 * 0.5; ink = paper * 2.2;
    } else if (!roof && windowCells > 2.5 && (style == 0 || style == 4 || style == 6) && band(tile.x / 3.0, 0.0, 0.07) > 0.5) {
      // Pilasters every third bay: raised, lit edges.
      code = riseStroke; thin = false;
      paper = lit3 * 0.95; ink = paper * contrast;
    } else {
      // Each architectural family has its own character texture, oriented to the face.
      thin = true;
      if (nearness > 0.3 || windowCells > 2.0) {
        code = style == 0 ? (band(heightCoord / 0.9, 0.0, 0.5) > 0.5 ? A_UNDER : A_PIPE)
          : style == 1 ? A_COLON : style == 2 ? riseStroke : style == 3 ? riseStroke
          : style == 4 ? A_DOT : style == 5 ? A_PLUS : style == 6 ? floorStroke : A_EXCL;
      } else code = thinRamp(0.2 + 0.25 * keyLight);
      ink = paper * grain;
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
#endif
#ifdef GROUND
  } else if (SURFACE < 1.5) {
    // Rootwood Park (park.ts) shades its own lawns, paths, plazas, arena and water.
    if (!parkGround(p, view, cellWorld, code, thin, paper, ink, emission, flags, reflectedGlyph)) {
    float sx = abs(p.x) < 32.0 ? abs(p.x) * 0.5 : street(p.x), sz = street(p.z);
    float road = 1.0 - step(6.2, min(sx, sz));
    vec3 asphalt = mix(vec3(0.11, 0.15, 0.17), vec3(0.047, 0.062, 0.068), road);
    asphalt *= 0.86 + noise2(p.xz * 0.35) * 0.25;
    float tiles = max(band(p.x / 2.0, 0.94, 1.0), band(p.z / 2.0, 0.94, 1.0)); asphalt *= 1.0 - tiles * (1.0 - road) * 0.25;
    float line = (1.0 - smoothstep(0.08, 0.24 + fwidth(sx), sx)) * step(12.0, sz) * band(p.z / 12.0, 0.0, 0.5);
    line += (1.0 - smoothstep(0.08, 0.24 + fwidth(sz), sz)) * step(12.0, sx) * band(p.x / 12.0, 0.0, 0.5);
    float crossing = step(9.5, sx) * step(sx, 13.0) * (1.0 - step(6.0, sz)) * band(p.z / 2.0, 0.0, 0.45);
    crossing += step(9.5, sz) * step(sz, 13.0) * (1.0 - step(6.0, sx)) * band(p.x / 2.0, 0.0, 0.45);
    float kerb = step(6.2, min(sx, sz)) * step(min(sx, sz), 6.6);
    vec3 lit3 = lighting(p, vec3(0, -1, 0), asphalt, u_rain);
    float nearness = 1.0 - smoothstep(0.2, 1.2, cellWorld);
    paper = lit3 * mix(0.8, 0.6, nearness) + line * vec3(0.26, 0.19, 0.08) + crossing * vec3(0.15, 0.17, 0.16) + kerb * vec3(0.02, 0.07, 0.075);
    int along = strokeFor(sx < sz ? p.z : p.x);
    if (line > 0.35) { code = A_EQ; ink = vec3(0.62, 0.46, 0.18); }
    else if (crossing > 0.4) { code = A_HASH; ink = paper * 1.6; }
    else if (kerb > 0.5) { code = along == A_DASH ? A_EQ : along; ink = paper * 2.1; }
    // Comfort: the ground streams past fastest in the lower visual field, so its texture is the
    // faintest in the city - enough to feel speed, not enough to crawl.
    else if (road > 0.5) { code = tiles > 0.3 || cellWorld > 0.7 ? A_SPACE : A_DOT; thin = true; ink = paper * 1.45; }
    else { code = cellWorld < 0.45 ? (tiles > 0.35 ? A_PLUS : A_DOT) : cellWorld < 1.2 ? along : A_DOT; thin = true; ink = paper * mix(1.3, 1.65, nearness); }
    #ifdef REFLECTIONS
    float pools = noise2(p.xz * vec2(0.43, 0.64)) + noise2(p.xz * 1.13) * 0.12;
    float puddle = smoothstep(0.77, 0.86, pools) * road;
    float grazing = 1.0 - clamp(abs(view.y), 0.0, 1.0);
    float reflectivity = u_rain * (0.025 + puddle * 0.58) * (0.28 + 0.72 * pow(grazing, 3.0));
    // Sample the reflected scene's character attachments directly, with no
    // blurry intermediate image or second luminance-to-ASCII conversion.
    ivec2 texel = ivec2(clamp(gl_FragCoord.xy, vec2(0), vec2(textureSize(u_reflectionInk, 0)) - 1.0));
    texel.x = textureSize(u_reflectionInk, 0).x - 1 - texel.x;
    vec3 reflectedInk = texelFetch(u_reflectionInk, texel, 0).rgb, reflectedPaper = texelFetch(u_reflectionPaper, texel, 0).rgb;
    paper = mix(paper, reflectedPaper * vec3(0.8, 0.9, 0.96), reflectivity);
    ink = mix(ink, reflectedInk * vec3(0.8, 0.9, 0.96), reflectivity);
    if (puddle > 0.65 && reflectivity > 0.24) { reflectedGlyph = texelFetch(u_reflectionGlyph, texel, 0).rgb; flags = 4.0; }
    vec2 rainCell = floor(p.xz / 3.0), delta = fract(p.xz / 3.0) - 0.5;
    float age = fract(u_time * 0.7 + hash(rainCell));
    float ring = (1.0 - smoothstep(0.008, 0.05, abs(length(delta) - age * 0.7))) * (1.0 - age);
    paper += ring * puddle * u_rain * vec3(0.012, 0.027, 0.032);
    if (flags == 0.0 && ring * puddle * u_rain > 0.5 && cellWorld < 0.35) { code = A_O; thin = true; ink = paper * 1.8 + vec3(0.02, 0.04, 0.05); }
    #endif
    } // parkGround
#endif
  } else if (${architecture ? "true" : "SURFACE < 2.5"}) {
    vec3 albedo = v_glyphColor.rgb;
    float emissive = smoothstep(0.64, 0.95, max(albedo.r, max(albedo.g, albedo.b)));
    vec3 lit3 = mix(lighting(p, n, albedo, 0.22), albedo, emissive * 0.9);
    emission = albedo * emissive * 0.7;
    paper = lit3 * 0.5; ink = lit3 * 1.45;
    useCharacter = true;
  } else {
    // Signs: real letters. Each sign has its own behaviour - buzzing, marquee, power-up sweeps.
    vec2 uv = v_uv;
    float seed = u_signSeed, len = max(u_textLength, 1.0);
    int mode = int(mod(floor(seed * 97.0), 4.0));
    bool vertical = u_vertical > 0.5;
    vec2 lc, lcDx, lcDy;
    float wrap = 0.0;
    if (vertical) {
      float alongRaw = (uv.y - 0.05) / 0.9 * len, along = clamp(alongRaw, 0.0, 0.9999 * len);
      float inside = (uv.x - 0.16) / 0.68;
      lc = vec2(floor(along) + clamp(inside, 0.0, 0.999), inside < 0.0 || inside >= 1.0 ? -1.0 : fract(along) * 1.12 - 0.06);
      // Derivatives of the continuous (inside, along) coordinates: lc itself jumps between letters.
      vec2 c = vec2(inside, alongRaw * 1.12);
      lcDx = dFdx(c); lcDy = dFdy(c);
    } else {
      lc = vec2((uv.x - 0.05) / 0.9 * len, (uv.y - 0.16) / 0.68);
      if (mode == 1) { lc.x += u_time * 2.4; wrap = len + 3.0; }
      lcDx = dFdx(lc); lcDy = dFdy(lc);
    }
    float cover = 0.0;
    bool letterThin = false;
    int letter = textGlyphD(lc, lcDx, lcDy, -1, wrap, cover, letterThin);
    int k = int(floor(lc.x));
    float intensity = 1.0;
    // Comfort: no hard strobing. A failing tube dips to 60% in brief, slow stutters; the power-up
    // sweep ends in a gentle ~1 Hz pulse instead of a 3 Hz on/off blink.
    if (mode == 0) intensity = 1.0 - 0.4 * step(0.95, noise2(vec2(u_time * 3.5, seed * 91.0))) * step(0.5, hash(vec2(float(k), seed)));
    else if (mode == 2) { float sweep = fract(u_time * 0.11 + seed) * (len + 6.0); intensity = float(k) < sweep ? (sweep > len + 3.0 ? 0.7 + 0.3 * cos((sweep - len - 3.0) * 2.4) : 1.0) : 0.2; }
    else if (mode == 3) intensity = 0.75 + 0.25 * sin(u_time * 1.3 + seed * 20.0);
    vec3 neon = v_glyphColor.rgb;
    if (mode == 3) neon = mix(neon, neon.gbr, 0.5 + 0.5 * sin(u_time * 0.4 + seed * 7.0));
    vec2 edgeCells = min(uv, 1.0 - uv) / max(fwidth(uv), vec2(1e-4));
    emission = neon * cover * intensity;
    if (min(edgeCells.x, edgeCells.y) < 1.0) {
      code = edgeCells.x < 1.0 && edgeCells.y < 1.0 ? A_PLUS : edgeCells.y < 1.0 ? A_DASH : A_PIPE;
      ink = neon * 0.5 * intensity; paper = vec3(0.01, 0.018, 0.024) + neon * 0.05;
    } else if (cover > 0.05) {
      code = letter; thin = letterThin;
      ink = neon * (0.7 + 1.1 * cover) * intensity;
      paper = neon * (0.08 + 0.3 * cover) * intensity + vec3(0.01, 0.016, 0.02);
    } else {
      code = A_SPACE; paper = vec3(0.012, 0.02, 0.026) + neon * 0.035 * intensity; ink = neon * 0.2;
    }
  }

  float fog = isSky ? 0.0 : fogAmount(p);
  vec3 fogColor = sky * 0.9;
  vec3 haze = isSky ? vec3(0) : atmosphere(p);
  // Bright points survive the haze longer than diffuse surfaces, then go dark too.
  vec3 glow = emission * fog * (1.0 - fog) * 0.6;
  paper = mix(paper, fogColor, fog) + glow + haze;
  ink = mix(ink, fogColor, min(1.0, fog * 1.15)) + glow + haze;
  paper = paper / (1.0 + paper * 0.3);
  ink = ink / (1.0 + ink * 0.3);
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

export const CITY_MATERIAL = cityMaterial({ reflections: true });
export const REFLECTION_MATERIAL = cityMaterial({ ground: false });

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
  float vignette = 1.0 - 0.16 * pow(length((v_uv - 0.5) * 1.4), 2.0);
  fragColor = vec4((source.rgb + light * u_strength / 6.0) * vignette, source.a);
}`;
