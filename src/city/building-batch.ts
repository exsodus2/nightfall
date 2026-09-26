import type { TextmodeShader } from "textmode.js";
import { BLOCK_SIZE, type CityWorld } from "./world";
import { buildingParts } from "./architecture";
import { cityMaterial } from "./materials";

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
export const BUILDING_MATERIAL = cityMaterial({ batch: true });
/** Buildings never dissolve, so their program is compiled without discard: early depth rejection stays on. */
export const FACADE_MATERIAL = cityMaterial({ batch: true, opaque: true });

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
/** A city block's slice of the static instance buffer. */
export interface BuildingChunk { bx: number; bz: number; x: number; z: number; start: number; count: number; buildings: number }
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

export function applyBatchUniforms(gl: WebGL2RenderingContext, uniforms: ReadonlyMap<string, WebGLUniformLocation | null>, camera: BatchCamera, frame: BatchFrame): void {
  const location = (name: string) => uniforms.get(name) ?? null;
  const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw), sp = Math.sin(camera.pitch), cp = Math.cos(camera.pitch), m = camera.mirror ? -1 : 1;
  gl.uniform3f(location("u_camera"), camera.x, camera.y, camera.z);
  gl.uniform3f(location("u_forward"), sy * cp, sp * m, -cy * cp);
  gl.uniform3f(location("u_right"), cy * m, 0, sy * m);
  gl.uniform3f(location("u_down"), -sy * sp, cp * m, cy * sp);
  gl.uniform1f(location("u_focal"), 1 / Math.tan(camera.fov * Math.PI / 360)); gl.uniform1f(location("u_aspect"), camera.aspect);
  gl.uniform1i(location("u_scene"), SCENE_UNIT); gl.uniform1i(location("u_text"), TEXT_UNIT);
  gl.uniform1f(location("u_mirror"), camera.mirror ? 1 : 0);
  gl.uniform1f(location("u_time"), frame.time); gl.uniform1f(location("u_rain"), frame.rain ? 1 : 0); gl.uniform1f(location("u_atmosphere"), frame.atmosphere ? 1 : 0);
  gl.uniform1f(location("u_viewRadius"), frame.viewRadius); gl.uniform1f(location("u_fadeIn"), frame.fadeIn);
}


export class BuildingBatch {
  readonly chunks = new Map<string, BuildingChunk>();
  private readonly gl: WebGL2RenderingContext;
  private readonly shader: TextmodeShader;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertices: WebGLBuffer;
  private readonly instances: WebGLBuffer;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  constructor(canvas: HTMLCanvasElement, shader: TextmodeShader, world: CityWorld) {
    const gl = canvas.getContext("webgl2"); if (!gl) throw Error("WebGL2 unavailable");
    this.gl = gl; this.shader = shader;
    const vao = gl.createVertexArray(), vertices = gl.createBuffer(), instances = gl.createBuffer();
    if (!vao || !vertices || !instances) throw Error("Unable to allocate building geometry");
    this.vao = vao; this.vertices = vertices; this.instances = instances;
    // Every part of every building, grouped by block, uploaded once.
    const values: number[] = [];
    for (const block of world.blocks.values()) {
      const start = values.length / STRIDE;
      for (const building of block.buildings) for (const part of buildingParts(building)) {
        values.push(part.x, part.y, part.z, part.w, part.h, part.d, part.color[0] / 255, part.color[1] / 255, part.color[2] / 255, part.message / 255,
          part.paper[0] / 255, part.paper[1] / 255, part.paper[2] / 255, part.alpha / 255, part.surface, part.range === Infinity ? 1e6 : part.range);
      }
      const count = values.length / STRIDE - start;
      if (count) this.chunks.set(`${block.x},${block.z}`, { bx: block.x, bz: block.z, x: (block.x + 0.5) * BLOCK_SIZE, z: (block.z + 0.5) * BLOCK_SIZE, start, count, buildings: block.buildings.length });
    }
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vertices); gl.bufferData(gl.ARRAY_BUFFER, VERTICES, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    for (let location = 1; location <= 5; location++) { gl.enableVertexAttribArray(location); gl.vertexAttribDivisor(location, 1); }
    gl.bindVertexArray(previousVao); gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
    for (const name of BATCH_UNIFORMS) this.uniforms.set(name, gl.getUniformLocation(shader.program, name));
  }
  /** Draws the given blocks in order (callers sort them nearest first). */
  draw(camera: BatchCamera, frame: BatchFrame, chunks: readonly BuildingChunk[]): void {
    if (!chunks.length) return;
    const gl = this.gl;
    withBatchState(gl, this.shader.program, frame, () => {
      applyBatchUniforms(gl, this.uniforms, camera, frame);
      gl.bindVertexArray(this.vao);
      const previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      // WebGL2 has no base-instance draw; re-pointing the per-instance attributes selects a block.
      for (const chunk of chunks) {
        const base = chunk.start * STRIDE * 4;
        for (const [location, size, offset] of LAYOUT) gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, base + offset * 4);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, chunk.count);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
    });
  }
  dispose(): void { this.gl.deleteBuffer(this.vertices); this.gl.deleteBuffer(this.instances); this.gl.deleteVertexArray(this.vao); this.shader.dispose(); }
}
const LAYOUT: readonly (readonly [number, number, number])[] = [[1, 3, 0], [2, 3, 3], [3, 4, 6], [4, 4, 10], [5, 2, 14]];
