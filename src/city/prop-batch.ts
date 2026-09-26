import type { TextmodeShader } from "textmode.js";
import { MESH_BOX, MESH_SPHERE, MESH_TORUS, PROP_STRIDE, type PropRecorder } from "./prop-canvas";
import { applyBatchUniforms, BATCH_UNIFORMS, withBatchState, type BatchCamera, type BatchFrame } from "./building-batch";

// Props (people, cars, street furniture, stations, NPCs) recorded by PropRecorder and drawn with
// one instanced call per mesh into textmode's native character/colour framebuffer, using the same
// city material as everything else (surface 2: the prop's own glyph, colours and transforms).
export const PROP_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_vertex;
layout(location=1) in vec3 a_origin;
layout(location=2) in vec3 a_axisX;
layout(location=3) in vec3 a_axisY;
layout(location=4) in vec3 a_axisZ;
layout(location=5) in vec4 a_ink;
layout(location=6) in vec4 a_paper;
layout(location=7) in vec4 a_glyph;
layout(location=8) in vec4 a_params;
uniform vec3 u_camera, u_right, u_down, u_forward;
uniform float u_focal, u_aspect;
uniform int u_mesh;
out vec3 v_worldPosition;
out vec2 v_uv;
out vec3 v_glyphIndex;
out vec4 v_glyphColor, v_cellColor, v_glyphFlags;
flat out float v_surface;
flat out vec3 v_center, v_dims;
void main() {
  vec3 local = a_vertex;
  if (u_mesh == ${MESH_TORUS}) {
    // textmode's torus: ring in the local XZ plane, radius measured to the outer edge.
    // a_vertex = (cos u, sin u, v): u around the ring, v around the tube.
    float tube = a_params.y, ring = max(a_params.x - tube, 0.0) + tube * cos(a_vertex.z);
    local = vec3(ring * a_vertex.x, tube * sin(a_vertex.z), ring * a_vertex.y);
  }
  vec3 world = a_origin + a_axisX * local.x + a_axisY * local.y + a_axisZ * local.z, p = world - u_camera;
  float depth = dot(p, u_forward), near = 0.12, far = 1800.0;
  gl_Position = vec4(dot(p, u_right) * u_focal / u_aspect, -dot(p, u_down) * u_focal, depth * (far + near) / (far - near) - 2.0 * far * near / (far - near), depth);
  v_worldPosition = world; v_uv = vec2(0);
  v_glyphIndex = vec3(a_glyph.xy, 0.0); v_glyphColor = a_ink; v_cellColor = a_paper;
  int flip = int(a_glyph.w + 0.5);
  v_glyphFlags = vec4(float(flip & 1), float((flip >> 1) & 1), float((flip >> 2) & 1), a_glyph.z);
  v_surface = a_params.z; v_center = a_origin; v_dims = vec3(0.0);
}`;

function boxMesh(): Float32Array {
  const q = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
  return new Float32Array([
    ...q([-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]), ...q([.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]),
    ...q([-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]), ...q([.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]),
    ...q([-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]), ...q([-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]),
  ]);
}
// Unit sphere (radius 1); ellipsoids scale it by their radii through the instance axes.
function sphereMesh(segments = 12, rings = 7): Float32Array {
  const out: number[] = [];
  const at = (i: number, j: number) => { const u = (i / segments) * Math.PI * 2, v = (j / rings) * Math.PI; return [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)]; };
  for (let j = 0; j < rings; j++) for (let i = 0; i < segments; i++) out.push(...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1));
  return new Float32Array(out);
}
// Torus parameters per vertex: (cos u, sin u) around the ring and the tube angle; the vertex
// shader applies each instance's ring and tube radius.
function torusMesh(segments = 18, sides = 6): Float32Array {
  const out: number[] = [];
  const at = (i: number, j: number) => { const u = (i / segments) * Math.PI * 2, v = (j / sides) * Math.PI * 2; return [Math.cos(u), Math.sin(u), v]; };
  for (let j = 0; j < sides; j++) for (let i = 0; i < segments; i++) out.push(...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1));
  return new Float32Array(out);
}

interface MeshSet { vao: WebGLVertexArrayObject; vertices: WebGLBuffer; instances: WebGLBuffer; vertexCount: number; capacity: number; count: number }

export class PropBatch {
  private readonly gl: WebGL2RenderingContext;
  private readonly shader: TextmodeShader;
  private readonly meshes: MeshSet[] = [];
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  constructor(canvas: HTMLCanvasElement, shader: TextmodeShader) {
    const gl = canvas.getContext("webgl2"); if (!gl) throw Error("WebGL2 unavailable");
    this.gl = gl; this.shader = shader;
    // Created once at setup; binding queries here are not on the per-frame path.
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    for (const mesh of [boxMesh(), sphereMesh(), torusMesh()]) {
      const vao = gl.createVertexArray(), vertices = gl.createBuffer(), instances = gl.createBuffer();
      if (!vao || !vertices || !instances) throw Error("Unable to allocate prop geometry");
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, instances); gl.bufferData(gl.ARRAY_BUFFER, 1024 * PROP_STRIDE * 4, gl.DYNAMIC_DRAW);
      for (const [location, size, offset] of [[1, 3, 0], [2, 3, 3], [3, 3, 6], [4, 3, 9], [5, 4, 12], [6, 4, 16], [7, 4, 20], [8, 4, 24]]) {
        gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, PROP_STRIDE * 4, offset * 4); gl.vertexAttribDivisor(location, 1);
      }
      this.meshes.push({ vao, vertices, instances, vertexCount: mesh.length / 3, capacity: 1024, count: 0 });
    }
    gl.bindVertexArray(previousVao); gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
    for (const name of [...BATCH_UNIFORMS, "u_mesh"]) this.uniforms.set(name, gl.getUniformLocation(shader.program, name));
  }
  /** Uploads what the recorder captured this frame (once; both render passes reuse it). */
  upload(recorder: PropRecorder): void {
    const gl = this.gl;
    // ARRAY_BUFFER_BINDING is answered client-side (no GPU round trip); restore it for textmode.
    const previous = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    [MESH_BOX, MESH_SPHERE, MESH_TORUS].forEach(kind => {
      const mesh = this.meshes[kind], count = recorder.counts[kind];
      mesh.count = count;
      if (!count) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instances);
      if (count > mesh.capacity) { mesh.capacity = Math.max(count, mesh.capacity * 2); gl.bufferData(gl.ARRAY_BUFFER, mesh.capacity * PROP_STRIDE * 4, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, recorder.data[kind], 0, count * PROP_STRIDE);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, previous);
  }
  draw(camera: BatchCamera, frame: BatchFrame): void {
    if (!this.meshes.some(mesh => mesh.count > 0)) return;
    const gl = this.gl;
    withBatchState(gl, this.shader.program, frame, () => {
      applyBatchUniforms(gl, this.uniforms, camera, frame);
      for (let kind = 0; kind < this.meshes.length; kind++) {
        const mesh = this.meshes[kind];
        if (!mesh.count) continue;
        gl.uniform1i(this.uniforms.get("u_mesh") ?? null, kind);
        gl.bindVertexArray(mesh.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.vertexCount, mesh.count);
      }
    });
  }
  dispose(): void {
    for (const mesh of this.meshes) { this.gl.deleteBuffer(mesh.vertices); this.gl.deleteBuffer(mesh.instances); this.gl.deleteVertexArray(mesh.vao); }
    this.shader.dispose();
  }
}
