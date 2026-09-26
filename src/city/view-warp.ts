// Smooth turning without edge jitter.
//
// The city renders with yaw and pitch snapped to whole-cell steps, so characters re-sample only once
// per cell of rotation instead of every frame. The sub-cell remainder used to be applied as a uniform
// layer offset, which is exact only at the screen centre: under perspective, points near the edges
// move up to sec^2 faster, so the periphery slid too slowly and then jumped almost a cell at every
// snap - a sawtooth jitter in peripheral vision. A pure camera rotation is exactly a homography of
// the image, so this filter re-projects every pixel from the snapped render to the true view
// direction instead. Nearest sampling keeps every glyph pixel-crisp; at the centre it is the same
// integer-pixel glide as the old offset.

type Vec3 = [number, number, number];

/** Camera basis (right, up, forward) for yaw (+ turns right) and pitch (+ looks down). */
function basis(yaw: number, pitch: number): [Vec3, Vec3, Vec3] {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return [[cy, 0, -sy], [sy * sp, cp, cy * sp], [sy * cp, -sp, cy * cp]];
}
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rows of the matrix taking a true-view ray (x right, y up, z forward) into the rendered view. */
export function rotationWarp(yaw: number, pitch: number, viewYaw: number, viewPitch: number): [Vec3, Vec3, Vec3] {
  const view = basis(viewYaw, viewPitch), actual = basis(yaw, pitch);
  const row = (axis: Vec3): Vec3 => [dot(axis, actual[0]), dot(axis, actual[1]), dot(axis, actual[2])];
  return [row(view[0]), row(view[1]), row(view[2])];
}

/** Where the output pixel `p` (pixels from the view centre, y up) is found in the rendered image. */
export function warpPoint(warp: readonly Vec3[], focal: number, p: { x: number; y: number }): { x: number; y: number } {
  const d: Vec3 = [p.x, p.y, focal];
  const s = warp.map(row => dot(row, d));
  return { x: focal * s[0] / s[2], y: focal * s[1] / s[2] };
}

// Each character cell moves as one rigid block, by the whole-pixel displacement of its own centre:
// glyphs are never stretched or torn by the re-projection (a per-pixel warp would duplicate and drop
// pixel columns that crawl across the image while turning).
export const VIEW_WARP_FILTER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec3 u_row0, u_row1, u_row2;
uniform float u_focal, u_cell;
uniform vec2 u_origin; // bottom-left corner of the character grid, in pixels
out vec4 fragColor;
vec2 project(mat3 m, vec2 p, vec2 centre) {
  vec3 v = m * vec3(p - centre, u_focal);
  return centre + u_focal * v.xy / max(v.z, 1e-3);
}
void main() {
  vec2 size = vec2(textureSize(u_texture, 0)), centre = size * 0.5;
  mat3 toView = transpose(mat3(u_row0, u_row1, u_row2));   // output ray -> rendered view
  mat3 toOutput = mat3(u_row0, u_row1, u_row2);             // its inverse (a rotation)
  vec2 p = v_uv * size;
  vec2 cell = floor((project(toView, p, centre) - u_origin) / u_cell);   // the rendered cell seen here
  vec2 cellCentre = u_origin + (cell + 0.5) * u_cell;
  vec2 shift = floor(project(toOutput, cellCentre, centre) - cellCentre + 0.5);
  ivec2 texel = ivec2(clamp(floor(p - shift), vec2(0.0), size - 1.0));
  fragColor = texelFetch(u_texture, texel, 0);
}`;
