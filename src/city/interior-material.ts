import { miniFontBytes } from "./mini-font.ts";

const font = miniFontBytes();
const letters = Array.from({ length: font.length / 2 }, (_, index) => font[index * 2] | (font[index * 2 + 1] << 8));

export const INTERIOR_MATERIAL = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
in vec3 v_worldPosition;
in vec3 v_glyphIndex;
in vec4 v_glyphColor;
in vec4 v_cellColor;
in vec4 v_glyphFlags;
uniform vec3 u_eye;
uniform vec3 u_room;
uniform vec3 u_tint;
// Upper floors: the district's haze colour (0..1) the far towers outside sink into.
uniform vec3 u_haze;
// Ground floors (interior-scene.ts sets these every room; venues and secrets send u_ground = 0):
// up to eight ceiling lights in world space (x, z, strength 0..1, unused) and their colours (0..1).
uniform float u_ground;
uniform vec4 u_lights[8];
uniform vec3 u_lightColors[8];
layout(location=0) out vec4 o_character;
layout(location=1) out vec4 o_primaryColor;
layout(location=2) out vec4 o_secondaryColor;
const int LETTERS[95] = int[95](${letters.join(",")});
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// Antialiased seam: 1 on the joint lines of a unit grid coordinate, prefiltered by the cell footprint.
float seam(float coordinate, float width) {
  float edge = abs(fract(coordinate - 0.5) - 0.5), footprint = max(fwidth(coordinate), 0.0001);
  return (1.0 - smoothstep(width, width + footprint, edge)) * (1.0 - smoothstep(0.25, 0.5, footprint));
}
// Box-filtered coverage of the band [a, b] (0 <= a < b <= 1, or straddling 0) of a unit-periodic
// coordinate over a footprint of width f: exact average, so edges never step as the view turns.
float bandIntegral(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
float pulse(float x, float a, float b, float f) {
  // A band straddling 0 (a < 0) is shifted half a period so it lies inside 0..1 (GLSL has no recursion).
  if (a < 0.0) { x += 0.5; a += 0.5; b += 0.5; }
  return (bandIntegral(x + f * 0.5, a, b) - bandIntegral(x - f * 0.5, a, b)) / f;
}
void main() {
  float letterVisible = 1.0;
  if (v_cellColor.g > 0.5) {
    int character = clamp(int(v_cellColor.r * 255.0 + 0.5) - 32, 0, 94);
    vec2 font = v_uv * vec2(3.0, 5.0);
    // Ground floors: a letter whose font pixels shrink under a cell can only print as mush, so its ink
    // melts into the sign backing over a footprint band (interior-scene.ts fades signs out on the CPU
    // from the real grid; this smooth safety net never pops).
    vec2 footprint = fwidth(font);
    if (u_ground > 0.5) letterVisible = 1.0 - smoothstep(0.9, 1.2, max(footprint.x, footprint.y));
    ivec2 pixel = clamp(ivec2(font), ivec2(0), ivec2(2, 4));
    if ((LETTERS[character] & (1 << (14 - pixel.y * 3 - pixel.x))) == 0) discard;
  }
  vec3 position = v_worldPosition;
  vec3 normal = normalize(cross(dFdy(position), dFdx(position)));
  if (dot(normal, u_eye - position) < 0.0) normal = -normal;
  // Lighting (Agent F): one ceiling fixture shining down - a soft pool on the floor under it, walls
  // falling off toward the ceiling and the corners - plus the venue's neon spilling low along the
  // walls from the floor strips, over a cool ambient. Height above the floor: Y points down.
  float height = -position.y;
  vec3 lightDelta = u_room + vec3(0.0, -5.3, 0.0) - position;
  float d2 = dot(lightDelta, lightDelta);
  float diffuse = max(0.0, dot(normal, normalize(lightDelta)));
  float cone = mix(0.35, 1.0, smoothstep(0.15, 0.85, normalize(-lightDelta).y));
  float falloff = cone / (1.0 + d2 * 0.016);
  vec2 offset = position.xz - u_room.xz;
  float spill = smoothstep(3.0, 7.5, max(abs(offset.x), abs(offset.y))) * exp(-height * 0.9);
  vec3 light = vec3(0.3, 0.34, 0.4) * mix(1.0, 0.7, smoothstep(3.0, 5.8, height))
    + mix(vec3(1.0, 0.85, 0.67), u_tint, 0.35) * (0.45 + diffuse * 0.9) * falloff
    + u_tint * spill * 0.35;
  if (u_ground > 0.5) {
    // Ground floors: a cool ambient (darker toward the ceiling) high enough that walls, floor and the
    // silhouettes of big furniture always read, and a pool of light under each of the plan's ceiling
    // fixtures, warm or cool by its colour. Strengths fade in and out on the CPU as the nearest eight
    // change, so no pool ever pops.
    light = vec3(0.34, 0.36, 0.42) * mix(1.0, 0.7, smoothstep(2.8, 5.8, height)) + u_tint * 0.06;
    for (int i = 0; i < 8; i++) {
      float strength = u_lights[i].z;
      if (strength <= 0.001) continue;
      vec3 delta = vec3(u_lights[i].x, -5.45, u_lights[i].y) - position;
      float dd = dot(delta, delta);
      float lit = max(0.0, dot(normal, normalize(delta)));
      float pool = mix(0.3, 1.0, smoothstep(0.2, 0.9, normalize(-delta).y)) / (1.0 + dd * 0.042);
      light += u_lightColors[i] * (0.3 + lit * 1.05) * pool * strength;
    }
  }
  float emissive = 1.0 - step(0.5, v_cellColor.a);
  vec3 ink = v_glyphColor.rgb * mix(light * 1.35, vec3(1.3), emissive);
  vec3 paper = v_glyphColor.rgb * mix(light * 0.45, vec3(0.35), emissive);
  // Surface finish, carried in the cell colour's blue channel by interior-scene.ts (letters use
  // red/green instead): 1 stone tiles, 2 floor planks, 3 steel grating, 4 plaster with a dado,
  // 5 block wall, 6 conservatory glazing, 7 glazed tile, 8 sheet vinyl, 9 wipe-clean panels,
  // 10 acoustic foam; ground floors add floors 11 polished stone, 12 concrete, 13 arcade carpet,
  // 14 raised server floor, 15 tatami; 16 skyline tower, 17 sky/haze, 18 security shutter.
  // Every joint is prefiltered and fades before it aliases.
  int surface = v_cellColor.g > 0.5 ? 0 : int(v_cellColor.b * 255.0 + 0.5);
  float shade = 1.0, inkShade = 1.0;
  bool floorFace = position.y > -0.05 && normal.y < -0.5;
  float across = abs(normal.x) > 0.5 ? position.z : position.x;
  if (floorFace && (surface == 1 || surface == 0)) {
    vec2 tile = offset / 1.4;
    float grout = max(seam(tile.x, 0.02), seam(tile.y, 0.02));
    float stone = 1.0 + (hash(floor(tile) + 7.0) - 0.5) * 0.14 * (1.0 - smoothstep(0.15, 0.4, length(fwidth(tile))));
    shade = stone * (1.0 - grout * 0.32); inkShade = 1.0 - grout * 0.25;
  } else if (floorFace && surface == 2) {
    float board = offset.y / 0.24, row = floor(board);
    float joint = offset.x / 2.4 + hash(vec2(row, 3.0));
    float grain = 1.0 + (hash(vec2(row, floor(joint))) - 0.5) * 0.24 * (1.0 - smoothstep(0.15, 0.4, fwidth(board)));
    shade = grain * (1.0 - max(seam(board, 0.04), seam(joint, 0.01)) * 0.4);
    paper *= vec3(1.08, 0.98, 0.86); ink *= vec3(1.08, 0.98, 0.86);
  } else if (floorFace && surface == 3) {
    float mesh = max(seam(offset.x / 0.3, 0.08), seam(offset.y / 0.3, 0.08));
    float plate = max(seam(offset.x / 1.8, 0.012), seam(offset.y / 1.8, 0.012));
    shade = (1.0 - mesh * 0.22) * (1.0 - plate * 0.45); inkShade = 1.0 + mesh * 0.25;
  } else if (surface == 4) {
    float dado = 1.0 - smoothstep(1.05, 1.1, height);
    float rail = 1.0 - smoothstep(0.03, 0.06 + fwidth(height), abs(height - 1.1));
    shade = mix(1.0, 0.78, dado) * (1.0 + rail * 0.45) * (1.0 - seam(across / 1.2, 0.01) * dado * 0.3);
  } else if (surface == 5) {
    float course = height / 0.4, row = floor(course);
    float blockJoint = across / 0.8 + 0.5 * mod(row, 2.0);
    shade = (1.0 + (hash(vec2(row, floor(blockJoint))) - 0.5) * 0.12 * (1.0 - smoothstep(0.15, 0.4, fwidth(course)))) * (1.0 - max(seam(course, 0.03), seam(blockJoint, 0.015)) * 0.35);
    shade *= mix(0.82, 1.0, smoothstep(0.0, 0.8, height)); // grime at the foot of the wall
  } else if (surface == 6) {
    float mullion = max(seam(across / 1.0, 0.035), seam(height / 1.2, 0.03));
    shade = 1.0 + mullion * 0.6; inkShade = 1.0 + mullion * 0.5;
    paper = mix(paper, paper * vec3(0.8, 1.05, 1.0), 1.0 - mullion);
  } else if (floorFace && surface == 8) {
    // Clinic sheet vinyl: faint flecks and a welded seam every two metres.
    vec2 fleckGrid = offset * 5.0;
    float fleck = 1.0 + (hash(floor(fleckGrid) + 3.0) - 0.5) * 0.1 * (1.0 - smoothstep(0.15, 0.4, length(fwidth(fleckGrid))));
    shade = fleck * (1.0 - seam(offset.x / 2.0, 0.006) * 0.3) * 1.06;
  } else if (surface == 7) {
    // Noodle-bar glazed tiles to shoulder height (0.3 m squares), warm painted wall above.
    float tiled = 1.0 - smoothstep(1.45, 1.5 + fwidth(height), height);
    float grout = max(seam(across / 0.3, 0.04), seam(height / 0.3, 0.04)) * tiled;
    shade = mix(0.8, 1.08, tiled) * (1.0 - grout * 0.3); inkShade = 1.0 + grout * 0.3;
    paper = mix(paper * vec3(1.12, 0.8, 0.74), paper, tiled);
  } else if (surface == 9) {
    // Clinic wipe-clean panels: joints every 1.2 m, a dark kick plate and a pale handrail band.
    float kick = 1.0 - smoothstep(0.14, 0.16 + fwidth(height), height);
    float rail = 1.0 - smoothstep(0.04, 0.07 + fwidth(height), abs(height - 0.95));
    shade = (1.0 - seam(across / 1.2, 0.012) * 0.3) * mix(1.0, 0.6, kick) * (1.0 + rail * 0.4);
  } else if (surface == 10) {
    // Nightclub acoustic foam: 0.6 m wedge tiles laid in alternating directions, a dark skirting.
    vec2 cell = vec2(across, height) / 0.6;
    float crisp = 1.0 - smoothstep(0.15, 0.4, length(fwidth(cell)));
    float wedge = mod(floor(cell.x) + floor(cell.y), 2.0) > 0.5 ? fract(cell.x) : fract(cell.y);
    shade = (1.0 + (wedge - 0.5) * 0.28 * crisp) * (1.0 - max(seam(cell.x, 0.02), seam(cell.y, 0.02)) * 0.3 * crisp);
    shade *= mix(0.65, 1.0, smoothstep(0.0, 0.3, height));
  } else if (floorFace && surface == 11) {
    // Corporate polished stone: 2.4 m slabs, hairline joints, a faint sheen toward grazing angles.
    vec2 slab = offset / 2.4;
    float crisp = 1.0 - smoothstep(0.15, 0.4, length(fwidth(slab)));
    float sheen = pow(1.0 - abs(normalize(u_eye - position).y), 3.0);
    shade = (1.0 + (hash(floor(slab) + 11.0) - 0.5) * 0.08 * crisp) * (1.0 - max(seam(slab.x, 0.006), seam(slab.y, 0.006)) * 0.35) * (1.0 + sheen * 0.35);
    inkShade = 1.0 + sheen * 0.2;
  } else if (floorFace && surface == 12) {
    // Garage concrete: blotchy at two scales, saw-cut joints every 4 m, oil-dark toward the bays.
    vec2 coarse = offset / 1.7, fine = offset * 1.6;
    float blotch = (hash(floor(coarse) + 5.0) - 0.5) * 0.14 * (1.0 - smoothstep(0.2, 0.45, length(fwidth(coarse))))
      + (hash(floor(fine) + 9.0) - 0.5) * 0.08 * (1.0 - smoothstep(0.15, 0.4, length(fwidth(fine))));
    shade = (1.0 + blotch) * (1.0 - max(seam(offset.x / 4.0, 0.004), seam(offset.y / 4.0, 0.004)) * 0.4);
  } else if (floorFace && surface == 13) {
    // Arcade carpet: a dark pile with a scatter of neon flecks (pink, cyan, amber) that settle into
    // an even glow before they would shimmer.
    vec2 grid = offset * 3.0;
    float crisp = 1.0 - smoothstep(0.15, 0.4, length(fwidth(grid)));
    float pick = hash(floor(grid) + 17.0);
    vec3 fleck = pick < 0.33 ? vec3(1.0, 0.35, 0.75) : pick < 0.66 ? vec3(0.35, 0.95, 1.0) : vec3(1.0, 0.75, 0.3);
    float on = step(0.72, hash(floor(grid) + 29.0)) * crisp;
    ink = mix(ink, ink * fleck * 1.8, on); paper *= 0.85;
  } else if (floorFace && surface == 14) {
    // Server-hall raised floor: 0.6 m tiles, every third one perforated (a fine dot grid), dark gaps.
    vec2 tile = offset / 0.6;
    float crisp = 1.0 - smoothstep(0.15, 0.4, length(fwidth(tile)));
    float perforated = step(mod(floor(tile.x) + floor(tile.y) * 2.0, 3.0), 0.5);
    vec2 holes = fract(tile * 5.0) - 0.5;
    float dots = perforated * crisp * (1.0 - smoothstep(0.15, 0.25, length(holes))) * (1.0 - smoothstep(0.3, 0.5, length(fwidth(tile * 5.0))));
    shade = (1.0 - max(seam(tile.x, 0.03), seam(tile.y, 0.03)) * 0.45) * (1.0 - dots * 0.35) * mix(1.0, 0.9, perforated * (1.0 - crisp) * 0.6);
  } else if (floorFace && surface == 15) {
    // Shrine tatami: 1.8 x 0.9 m mats turned alternately, dark cloth borders on their long edges.
    vec2 mat = offset / vec2(1.8, 0.9);
    bool turned = mod(floor(offset.x / 1.8) + floor(offset.y / 1.8), 2.0) > 0.5;
    if (turned) mat = offset.yx / vec2(1.8, 0.9);
    float crisp = 1.0 - smoothstep(0.15, 0.4, fwidth(mat.y * 12.0));
    float weave = 1.0 + (fract(mat.y * 12.0) - 0.5) * 0.06 * crisp;
    float border = seam(mat.y, 0.07);
    shade = weave * (1.0 - border * 0.5) * (1.0 - seam(mat.x, 0.01) * 0.3);
    paper *= vec3(1.06, 1.04, 0.84); ink *= vec3(1.04, 1.04, 0.86);
  } else if (surface == 16) {
    // Upper floors (upper-floors.ts): a tower outside the window, scaled toward the eye, in its own
    // colour (the room never lights it). A DARK silhouette carrying a fine grid of small windows (floor
    // pitch in the red channel, held to 1.2..1.8 m at the ring so a near tower never shows giant panes),
    // each lit or dark, warm or cool, by a stable hash of its world cell. Every pane is box-filtered by
    // the cell footprint (exact coverage, no step edges), so turning never crawls and a grid finer than
    // a cell melts into its average. Farther towers sink into the district haze (u_haze); roofs stay dark.
    float pitch = clamp(v_cellColor.r * 4.0, 1.2, 1.8);
    vec2 grid = vec2(across / (pitch * 0.7), height / pitch);
    vec2 gridFootprint = max(fwidth(grid), vec2(0.0001));
    float crisp = 1.0 - smoothstep(0.3, 0.6, max(gridFootprint.x, gridFootprint.y));
    float cover = pulse(grid.x, 0.26, 0.74, gridFootprint.x) * pulse(grid.y, 0.3, 0.74, gridFootprint.y);
    vec2 cellId = floor(grid) + floor(position.xz * 0.05) * 3.7;
    float pick = hash(cellId + 19.0);
    float lit = mix(0.3, step(0.7, hash(cellId)), crisp);
    vec3 warm = v_glyphColor.rgb / max(0.08, max(v_glyphColor.r, max(v_glyphColor.g, v_glyphColor.b)));
    vec3 hue = pick < 0.45 ? warm : pick < 0.72 ? vec3(1.0, 0.66, 0.34) : pick < 0.9 ? vec3(0.62, 0.8, 1.0) : vec3(0.85, 0.95, 1.0);
    hue = mix(vec3(0.8, 0.72, 0.62), hue, crisp) * mix(0.65, 1.0, hash(cellId + 41.0) * crisp + (1.0 - crisp) * 0.5);
    float far = smoothstep(26.0, 46.0, length(position - u_eye));
    float level = max(v_glyphColor.r, max(v_glyphColor.g, v_glyphColor.b)); // the backdrop's own haze gain
    float window = abs(normal.y) > 0.5 ? 0.0 : cover * lit * mix(1.0, 0.6, far);
    vec3 facade = vec3(0.016, 0.02, 0.032) + v_glyphColor.rgb * 0.012;
    facade = mix(facade, u_haze * 0.1 + vec3(0.03, 0.032, 0.045), far * 0.6);
    vec3 glow = hue * level;
    paper = mix(facade, glow * 0.62, window);
    ink = mix(facade * 1.5, glow * 1.1, window);
    if (abs(normal.y) > 0.5) { paper = facade * 0.7; ink = facade; }
  } else if (surface == 17) {
    // Upper floors: the city's glow at the horizon and the overcast over a roof, exactly its colour.
    paper = v_glyphColor.rgb; ink = v_glyphColor.rgb * 1.2;
  } else if (surface == 18) {
    // Ground floors: a locked back room's security shutter (interior-scene.ts gateShutter). Rolled
    // steel slats every 0.3 m (a dark joint, a lit upper lip), and black hazard chevrons over its
    // bottom 0.3 m on the yellow kick band; all prefiltered, melting to their average before aliasing.
    if (height < 0.3) {
      float stripe = (across + height) / 0.3, fw = max(fwidth(stripe), 0.0001);
      float dark = pulse(stripe, 0.0, 0.5, fw);
      shade = mix(1.0, 0.16, dark); inkShade = mix(1.0, 0.8, dark);
    } else {
      float slat = (height - 0.3) / 0.3, fw = max(fwidth(slat), 0.0001);
      float crisp = 1.0 - smoothstep(0.25, 0.5, fw);
      float joint = pulse(slat, -0.06, 0.06, fw), lip = pulse(slat, 0.08, 0.22, fw);
      shade = mix(0.85, 1.0 - joint * 0.55 + lip * 0.22, crisp); inkShade = 1.0 + lip * 0.25 * crisp;
    }
  }
  // Ground-floor walls read as calm painted surfaces: the dot glyph sits close to its cell colour so
  // the structure (seams, rails, dressing) carries the wall instead of glyph noise.
  if (u_ground > 0.5 && surface > 0 && !floorFace && emissive < 0.5) { ink = mix(paper * 1.25, ink, 0.45); paper *= 1.12; }
  paper *= shade; ink *= shade * inkShade;
  if (letterVisible < 1.0) ink = mix(vec3(0.063, 0.075, 0.102) * light * 0.45, ink, letterVisible); // letter melts into the dark sign board

  int flags = int(v_glyphFlags.r > 0.5) | (int(v_glyphFlags.g > 0.5) << 1) | (int(v_glyphFlags.b > 0.5) << 2);
  o_character = vec4(v_glyphIndex.xy, float(flags) / 255.0, v_glyphFlags.a);
  o_primaryColor = vec4(ink / (1.0 + ink * 0.2), 1.0);
  o_secondaryColor = vec4(paper, 1.0);
}`;
