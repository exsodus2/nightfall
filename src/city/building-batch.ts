import type { TextmodeShader } from "textmode.js";
import { BLOCK_SIZE, type CityWorld } from "./world.ts";
import { buildingParts } from "./architecture.ts";
import { SURFACES, cityMaterial } from "./materials.ts";

// Every building part in the city lives in one static instance buffer, uploaded once and grouped
// by city block. Each frame the engine picks the blocks in range and in view and draws them
// nearest first (so the depth test rejects hidden facades before the expensive material runs),
// one instanced call per block. Nothing is rebuilt or re-uploaded per frame; detail parts fade
// out by distance in the vertex shader. Same box geometry and material as the reference renderer.
export const BUILDING_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_vertex;
layout(location=1) in vec3 a_center;
layout(location=2) in vec3 a_dimensions;
layout(location=3) in vec4 a_ink;
layout(location=4) in vec4 a_paper;
layout(location=5) in vec2 a_surfaceRange;
uniform vec3 u_camera, u_right, u_down, u_forward;
uniform float u_focal, u_aspect;
out vec3 v_worldPosition;
out vec2 v_uv;
out vec3 v_glyphIndex;
out vec4 v_glyphColor, v_cellColor, v_glyphFlags;
flat out float v_surface;
flat out vec3 v_center, v_dims;
void main() {
  // Detail parts retract toward their centre as they approach their LOD distance.
  float range=a_surfaceRange.y, reach=length(a_center.xz-u_camera.xz);
  vec3 dims=a_dimensions*(range>1e5 ? 1.0 : 1.0-smoothstep(range*0.7,range,reach));
  vec3 world=a_center+a_vertex*dims, p=world-u_camera;
  float depth=dot(p,u_forward), near=0.12, far=1800.0;
  gl_Position=vec4(dot(p,u_right)*u_focal/u_aspect,-dot(p,u_down)*u_focal,depth*(far+near)/(far-near)-2.0*far*near/(far-near),depth);
  v_worldPosition=world; v_uv=vec2(0); v_glyphIndex=vec3(0);
  v_glyphColor=a_ink; v_cellColor=a_paper; v_glyphFlags=vec4(0); v_surface=a_surfaceRange.x;
  v_center=a_center; v_dims=dims;
}`;
/** The prop batch's material: lit props only (PropRecorder.surface), so it compiles quickly. */
export const BUILDING_MATERIAL = cityMaterial({ batch: true, ground: false, surfaces: SURFACES.props });
/** Buildings never dissolve, so their program is compiled without discard: early depth rejection stays on. */
export const FACADE_MATERIAL = cityMaterial({ batch: true, opaque: true, architecture: true });

const VERTICES = new Float32Array([
  -.5,-.5,.5, .5,-.5,.5, .5,.5,.5, -.5,-.5,.5, .5,.5,.5, -.5,.5,.5,
  .5,-.5,-.5, -.5,-.5,-.5, -.5,.5,-.5, .5,-.5,-.5, -.5,.5,-.5, .5,.5,-.5,
  -.5,-.5,-.5, -.5,-.5,.5, -.5,.5,.5, -.5,-.5,-.5, -.5,.5,.5, -.5,.5,-.5,
  .5,-.5,.5, .5,-.5,-.5, .5,.5,-.5, .5,-.5,.5, .5,.5,-.5, .5,.5,.5,
  -.5,-.5,-.5, .5,-.5,-.5, .5,-.5,.5, -.5,-.5,-.5, .5,-.5,.5, -.5,-.5,.5,
  -.5,.5,.5, .5,.5,.5, .5,.5,-.5, -.5,.5,.5, .5,.5,-.5, -.5,.5,-.5,
]);
const STRIDE = 16;
export interface BatchCamera { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; aspect: number; mirror: boolean }
/** Per-pass inputs shared by every raw instanced draw that uses the city material. */
export interface BatchFrame { scene: WebGLTexture; text: WebGLTexture; time: number; rain: boolean; atmosphere: boolean; viewRadius: number; fadeIn: number }
/** A city block's slice of the static instance buffer. Its instances are sorted by draw range,
 *  longest first, so the ones that can still show from a camera are always a prefix (see
 *  chunkInstanceCount); `ranges` mirrors that order and `reach` is the farthest part centre from
 *  the block centre (x, z). */
export interface BuildingChunk { bx: number; bz: number; x: number; z: number; start: number; count: number; buildings: number; ranges: Float32Array; reach: number }

/** Far LOD. Every part with a finite draw range (roof kits, retrofits, signs, fascias, thin parts:
 *  about five in six of all parts, almost all of them 360 m or less) retracts to nothing in the
 *  vertex shader by that range, and chunkInstanceCount stops submitting it once that is true for
 *  every part centre in its block. So far blocks draw their main masses (plus ticker bands, wrap
 *  screens and the few parts whose fine size gives them up to 1500 m) and nothing pops: an
 *  instance is only dropped when it is already zero-sized. Main masses never retract, so the
 *  skyline and the lit-window texture are unchanged at distance.
 *  FAR_LOD_BLOCKS optionally caps every finite range as well, so that past it only main masses
 *  draw. Off: a 12-block cap pulls the 700-1500 m retractions nearer, where they are bigger on
 *  screen, and measured +3% walk shimmer for about 1k fewer instances. */
export const FAR_LOD_BLOCKS: number = Infinity;
const FAR_LOD_RANGE = FAR_LOD_BLOCKS * BLOCK_SIZE;
/** A part's draw range as stored in the instance buffer (1e6 = never retracts). */
export function lodRange(range: number): number { return range === Infinity ? 1e6 : Math.min(range, FAR_LOD_RANGE); }

/** How many of a chunk's instances can be non-degenerate from a camera at (x, z): those whose draw
 *  range exceeds the nearest any part centre of the block can be. The vertex shader zeroes a part's
 *  size once its centre is `range` away, so the rest would only cost vertex work. 1 m of slack
 *  covers float32 rounding in the shader. */
export function chunkInstanceCount(chunk: BuildingChunk, x: number, z: number): number {
  const cutoff = Math.hypot(chunk.x - x, chunk.z - z) - chunk.reach - 1;
  if (cutoff <= 0) return chunk.count;
  const ranges = chunk.ranges;
  let low = 0, high = ranges.length;
  while (low < high) { const mid = (low + high) >> 1; if (ranges[mid] > cutoff) low = mid + 1; else high = mid; }
  return low;
}

/** Packs every building part, grouped by block and sorted longest range first within a block. */
export function packBuildingChunks(world: CityWorld): { values: Float32Array; chunks: Map<string, BuildingChunk> } {
  const values: number[] = [], chunks = new Map<string, BuildingChunk>();
  for (const block of world.blocks.values()) {
    const start = values.length / STRIDE, x = (block.x + 0.5) * BLOCK_SIZE, z = (block.z + 0.5) * BLOCK_SIZE;
    // Stable sort: parts of equal range keep their authored order (masses before their details).
    const parts = block.buildings.flatMap(building => buildingParts(building).map(part => ({ part, range: lodRange(part.range) }))).sort((a, b) => b.range - a.range);
    let reach = 0;
    for (const { part, range } of parts) {
      values.push(part.x, part.y, part.z, part.w, part.h, part.d, part.color[0] / 255, part.color[1] / 255, part.color[2] / 255, part.message / 255,
        part.paper[0] / 255, part.paper[1] / 255, part.paper[2] / 255, part.alpha / 255, part.surface, range);
      reach = Math.max(reach, Math.hypot(part.x - x, part.z - z));
    }
    if (parts.length) chunks.set(`${block.x},${block.z}`, { bx: block.x, bz: block.z, x, z, start, count: parts.length, buildings: block.buildings.length, ranges: Float32Array.from(parts, p => p.range), reach });
  }
  return { values: new Float32Array(values), chunks };
}
export const BATCH_UNIFORMS = ["u_camera", "u_right", "u_down", "u_forward", "u_focal", "u_aspect", "u_scene", "u_text", "u_mirror", "u_time", "u_rain", "u_atmosphere", "u_viewRadius", "u_fadeIn"] as const;
const SCENE_UNIT = 15, TEXT_UNIT = 14;

/** Runs a raw draw inside textmode's layer pass and restores every binding it touches, so native
 *  geometry, compositing, synth and filters continue through their public API. Depth state is
 *  textmode's default inside a layer pass (LEQUAL, writes on); it is set rather than queried,
 *  because those queries force a synchronous round trip to the GPU process. */
export function withBatchState(gl: WebGL2RenderingContext, program: WebGLProgram, frame: BatchFrame, draw: () => void): void {
  const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
  const active = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  const blend = gl.isEnabled(gl.BLEND), cull = gl.isEnabled(gl.CULL_FACE), depth = gl.isEnabled(gl.DEPTH_TEST);
  gl.activeTexture(gl.TEXTURE0 + TEXT_UNIT);
  const previousText = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.bindTexture(gl.TEXTURE_2D, frame.text);
  gl.activeTexture(gl.TEXTURE0 + SCENE_UNIT);
  const previousScene = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.bindTexture(gl.TEXTURE_2D, frame.scene);
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  draw();
  gl.bindTexture(gl.TEXTURE_2D, previousScene);
  gl.activeTexture(gl.TEXTURE0 + TEXT_UNIT); gl.bindTexture(gl.TEXTURE_2D, previousText);
  gl.activeTexture(active);
  gl.bindVertexArray(previousVao); gl.useProgram(previousProgram);
  if (!depth) gl.disable(gl.DEPTH_TEST);
  if (blend) gl.enable(gl.BLEND);
  if (cull) gl.enable(gl.CULL_FACE);
}

/**
 * The values last sent to one batch program's uniforms. Uniform values live in the program, and
 * only the batch that owns a program sets them, so a value equal to the last one sent needs no GL
 * call (most of them hold between the mirrored and the main pass, or for the whole session). NaN
 * means "never sent" (a NaN value is always sent). The doubles are compared exactly, -0 apart from
 * 0, which is stricter than comparing what GL stores (float32).
 */
export class BatchUniformCache {
  readonly values = new Float64Array(BATCH_SLOTS).fill(NaN);
  /** Sends uniform1f / uniform1i when the value changed; true when a call was made. */
  scalar(gl: WebGL2RenderingContext, location: WebGLUniformLocation | null, slot: number, value: number, integer = false): boolean {
    const values = this.values;
    if (same(values[slot], value)) return false;
    values[slot] = value;
    if (integer) gl.uniform1i(location, value); else gl.uniform1f(location, value);
    return true;
  }
  vec3(gl: WebGL2RenderingContext, location: WebGLUniformLocation | null, slot: number, x: number, y: number, z: number): boolean {
    const values = this.values;
    if (same(values[slot], x) && same(values[slot + 1], y) && same(values[slot + 2], z)) return false;
    values[slot] = x; values[slot + 1] = y; values[slot + 2] = z;
    gl.uniform3f(location, x, y, z);
    return true;
  }
}
const same = (sent: number, value: number) => Object.is(sent, value) && !Number.isNaN(value);
// Slots in BatchUniformCache.values: four vec3s, then the scalars.
const S_CAMERA = 0, S_FORWARD = 3, S_RIGHT = 6, S_DOWN = 9, S_FOCAL = 12, S_ASPECT = 13, S_SCENE = 14, S_TEXT = 15;
const S_MIRROR = 16, S_TIME = 17, S_RAIN = 18, S_ATMOSPHERE = 19, S_VIEW_RADIUS = 20, S_FADE_IN = 21, BATCH_SLOTS = 22;

/** Sets the camera and frame uniforms of a batch program (the program must be in use). With a
 *  cache, values unchanged since that program's last draw are skipped (same program state). */
export function applyBatchUniforms(gl: WebGL2RenderingContext, uniforms: ReadonlyMap<string, WebGLUniformLocation | null>, camera: BatchCamera, frame: BatchFrame, cache: BatchUniformCache = new BatchUniformCache()): void {
  const location = (name: string) => uniforms.get(name) ?? null;
  const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw), sp = Math.sin(camera.pitch), cp = Math.cos(camera.pitch), m = camera.mirror ? -1 : 1;
  cache.vec3(gl, location("u_camera"), S_CAMERA, camera.x, camera.y, camera.z);
  cache.vec3(gl, location("u_forward"), S_FORWARD, sy * cp, sp * m, -cy * cp);
  cache.vec3(gl, location("u_right"), S_RIGHT, cy * m, 0, sy * m);
  cache.vec3(gl, location("u_down"), S_DOWN, -sy * sp, cp * m, cy * sp);
  cache.scalar(gl, location("u_focal"), S_FOCAL, 1 / Math.tan(camera.fov * Math.PI / 360)); cache.scalar(gl, location("u_aspect"), S_ASPECT, camera.aspect);
  cache.scalar(gl, location("u_scene"), S_SCENE, SCENE_UNIT, true); cache.scalar(gl, location("u_text"), S_TEXT, TEXT_UNIT, true);
  cache.scalar(gl, location("u_mirror"), S_MIRROR, camera.mirror ? 1 : 0);
  cache.scalar(gl, location("u_time"), S_TIME, frame.time); cache.scalar(gl, location("u_rain"), S_RAIN, frame.rain ? 1 : 0); cache.scalar(gl, location("u_atmosphere"), S_ATMOSPHERE, frame.atmosphere ? 1 : 0);
  cache.scalar(gl, location("u_viewRadius"), S_VIEW_RADIUS, frame.viewRadius); cache.scalar(gl, location("u_fadeIn"), S_FADE_IN, frame.fadeIn);
}


export class BuildingBatch {
  readonly chunks = new Map<string, BuildingChunk>();
  private readonly gl: WebGL2RenderingContext;
  private readonly shader: TextmodeShader;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertices: WebGLBuffer;
  private readonly instances: WebGLBuffer;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly uniformCache = new BatchUniformCache();
  /** Per-block VAOs (see draw), keyed by the stable chunk objects in `chunks`. */
  private readonly chunkVaos = new Map<BuildingChunk, WebGLVertexArrayObject>();
  private vaoBudget = VAO_BUDGET;
  constructor(canvas: HTMLCanvasElement, shader: TextmodeShader, world: CityWorld) {
    const gl = canvas.getContext("webgl2"); if (!gl) throw Error("WebGL2 unavailable");
    this.gl = gl; this.shader = shader;
    const vao = gl.createVertexArray(), vertices = gl.createBuffer(), instances = gl.createBuffer();
    if (!vao || !vertices || !instances) throw Error("Unable to allocate building geometry");
    this.vao = vao; this.vertices = vertices; this.instances = instances;
    // Every part of every building, grouped by block, uploaded once.
    const { values, chunks } = packBuildingChunks(world);
    for (const [key, chunk] of chunks) this.chunks.set(key, chunk);
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vertices); gl.bufferData(gl.ARRAY_BUFFER, VERTICES, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances); gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
    for (let location = 1; location <= 5; location++) { gl.enableVertexAttribArray(location); gl.vertexAttribDivisor(location, 1); }
    gl.bindVertexArray(previousVao); gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
    for (const name of BATCH_UNIFORMS) this.uniforms.set(name, gl.getUniformLocation(shader.program, name));
  }
  /** Draws the given blocks in order (callers sort them nearest first). */
  draw(camera: BatchCamera, frame: BatchFrame, chunks: readonly BuildingChunk[]): void {
    if (!chunks.length) return;
    const gl = this.gl;
    withBatchState(gl, this.shader.program, frame, () => {
      applyBatchUniforms(gl, this.uniforms, camera, frame, this.uniformCache);
      // WebGL2 has no base-instance draw. Perf: each block gets its own VAO with the per-instance
      // attributes pointed at its slice, so a block draw is one bind and one draw instead of five
      // vertexAttribPointer calls. VAOs are built lazily, at most VAO_BUDGET per pass (no hitch
      // when a wide view first opens); until a block has one it is drawn the old way, re-pointing
      // the shared VAO (same buffer, same offsets: identical output). Far blocks submit only the
      // prefix of parts still drawn at their distance (far LOD).
      let previousBuffer: WebGLBuffer | null | undefined, sharedBound = false;
      for (const chunk of chunks) {
        const count = chunkInstanceCount(chunk, camera.x, camera.z);
        if (!count) continue;
        let vao = this.chunkVaos.get(chunk);
        if (!vao && this.vaoBudget > 0) {
          if (previousBuffer === undefined) previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
          vao = this.buildChunkVao(chunk) ?? undefined;
          sharedBound = false;
        }
        if (vao) { gl.bindVertexArray(vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, count); sharedBound = false; continue; }
        if (!sharedBound) {
          if (previousBuffer === undefined) previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
          gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.instances); sharedBound = true;
        }
        const base = chunk.start * STRIDE * 4;
        for (let i = 0; i < LAYOUT.length; i++) { const [location, size, offset] = LAYOUT[i]; gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, base + offset * 4); }
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, count);
      }
      if (previousBuffer !== undefined) gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
    });
    this.vaoBudget = VAO_BUDGET;
  }
  /** One block's VAO: the shared box vertices plus its slice of the instance buffer. Leaves the VAO
   *  bound and ARRAY_BUFFER pointing at the instance buffer (the caller restores it). */
  private buildChunkVao(chunk: BuildingChunk): WebGLVertexArrayObject | null {
    const gl = this.gl, vao = gl.createVertexArray();
    this.vaoBudget--;
    if (!vao) return null;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    const base = chunk.start * STRIDE * 4;
    for (const [location, size, offset] of LAYOUT) {
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, base + offset * 4); gl.vertexAttribDivisor(location, 1);
    }
    this.chunkVaos.set(chunk, vao);
    return vao;
  }
  dispose(): void {
    for (const vao of this.chunkVaos.values()) this.gl.deleteVertexArray(vao);
    this.chunkVaos.clear();
    this.gl.deleteBuffer(this.vertices); this.gl.deleteBuffer(this.instances); this.gl.deleteVertexArray(this.vao); this.shader.dispose();
  }
}
/** Block VAOs built per pass at most (each is about 20 cheap GL calls, once per block for the
 *  life of the context; VAOs die with the context, and a lost context rebuilds the whole city). */
const VAO_BUDGET = 48;
const LAYOUT: readonly (readonly [number, number, number])[] = [[1, 3, 0], [2, 3, 3], [3, 4, 6], [4, 4, 10], [5, 2, 14]];
