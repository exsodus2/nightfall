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
layout(location=0) out vec4 o_character;
layout(location=1) out vec4 o_primaryColor;
layout(location=2) out vec4 o_secondaryColor;
const int LETTERS[95] = int[95](${letters.join(",")});
void main() {
  if (v_cellColor.g > 0.5) {
    int character = clamp(int(v_cellColor.r * 255.0 + 0.5) - 32, 0, 94);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(3.0, 5.0)), ivec2(0), ivec2(2, 4));
    if ((LETTERS[character] & (1 << (14 - pixel.y * 3 - pixel.x))) == 0) discard;
  }
  vec3 position = v_worldPosition;
  vec3 normal = normalize(cross(dFdy(position), dFdx(position)));
  if (dot(normal, u_eye - position) < 0.0) normal = -normal;
  vec3 lightDelta = u_room + vec3(0.0, -4.7, 0.0) - position;
  float diffuse = max(0.0, dot(normal, normalize(lightDelta)));
  float falloff = 1.0 / (1.0 + dot(lightDelta, lightDelta) * 0.012);
  vec3 light = vec3(0.34, 0.38, 0.43) + mix(vec3(1.0, 0.85, 0.67), u_tint, 0.35) * (0.4 + diffuse * 0.8) * falloff;
  float emissive = 1.0 - step(0.5, v_cellColor.a);
  vec3 ink = v_glyphColor.rgb * mix(light * 1.35, vec3(1.3), emissive);
  vec3 paper = v_glyphColor.rgb * mix(light * 0.45, vec3(0.35), emissive);
  if (position.y > -0.05 && normal.y < -0.5) {
    vec2 tile = (position.xz - u_room.xz) / 1.4;
    vec2 edge = abs(fract(tile - 0.5) - 0.5);
    vec2 footprint = max(fwidth(tile), vec2(0.0001));
    float grout = 1.0 - min(smoothstep(0.02, 0.02 + footprint.x, edge.x), smoothstep(0.02, 0.02 + footprint.y, edge.y));
    paper *= 1.0 - grout * 0.3;
    ink *= 1.0 - grout * 0.25;
  }
  int flags = int(v_glyphFlags.r > 0.5) | (int(v_glyphFlags.g > 0.5) << 1) | (int(v_glyphFlags.b > 0.5) << 2);
  o_character = vec4(v_glyphIndex.xy, float(flags) / 255.0, v_glyphFlags.a);
  o_primaryColor = vec4(ink / (1.0 + ink * 0.2), 1.0);
  o_secondaryColor = vec4(paper, 1.0);
}`;
