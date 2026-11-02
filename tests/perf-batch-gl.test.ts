import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { TextmodeShader } from "textmode.js";
import type { BatchCamera, BatchFrame, BuildingChunk } from "../src/city/building-batch.ts";

// building-batch.ts imports its neighbours without extensions (the bundler resolves them).
register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const [{ BuildingBatch, chunkInstanceCount }, { CityWorld }] = await Promise.all([import("../src/city/building-batch.ts"), import("../src/city/world.ts")]);

const STRIDE_BYTES = 16 * 4;
interface Pointer { buffer: object | null; size: number; stride: number; offset: number; enabled: boolean; divisor: number }
interface Vao { attributes: Map<number, Pointer> }
interface Draw { attributes: [number, object | null, number, number, number][]; count: number }

/** Just enough of WebGL2 to follow the batch: vertex array state, bindings, uniform and draw calls. */
class FakeGL {
  readonly ARRAY_BUFFER = 1; readonly FLOAT = 2; readonly TRIANGLES = 3; readonly STATIC_DRAW = 4; readonly CURRENT_PROGRAM = 5;
  readonly VERTEX_ARRAY_BINDING = 6; readonly ACTIVE_TEXTURE = 7; readonly TEXTURE_BINDING_2D = 8; readonly ARRAY_BUFFER_BINDING = 9;
  readonly BLEND = 10; readonly CULL_FACE = 11; readonly DEPTH_TEST = 12; readonly LEQUAL = 13; readonly TEXTURE0 = 100; readonly TEXTURE_2D = 14;
  readonly defaultVao: Vao = { attributes: new Map() };
  vao: Vao = this.defaultVao;
  arrayBuffer: object | null = null;
  program: object | null = null;
  readonly calls = new Map<string, number>();
  readonly draws: Draw[] = [];
  private count(name: string): void { this.calls.set(name, (this.calls.get(name) ?? 0) + 1); }
  private pointer(location: number): Pointer {
    let p = this.vao.attributes.get(location);
    if (!p) { p = { buffer: null, size: 0, stride: 0, offset: 0, enabled: false, divisor: 0 }; this.vao.attributes.set(location, p); }
    return p;
  }
  reset(): void { this.calls.clear(); this.draws.length = 0; }
  getParameter(name: number): unknown {
    if (name === this.VERTEX_ARRAY_BINDING) return this.vao === this.defaultVao ? null : this.vao;
    if (name === this.ARRAY_BUFFER_BINDING) return this.arrayBuffer;
    if (name === this.CURRENT_PROGRAM) return this.program;
    if (name === this.ACTIVE_TEXTURE) return this.TEXTURE0;
    return null;
  }
  isEnabled(): boolean { return false; }
  activeTexture(): void { /* not tracked */ }
  bindTexture(): void { /* not tracked */ }
  useProgram(program: object | null): void { this.program = program; }
  enable(): void { /* not tracked */ }
  disable(): void { /* not tracked */ }
  depthFunc(): void { /* not tracked */ }
  depthMask(): void { /* not tracked */ }
  createVertexArray(): Vao { this.count("createVertexArray"); return { attributes: new Map() }; }
  createBuffer(): object { return {}; }
  bindVertexArray(vao: Vao | null): void { this.count("bindVertexArray"); this.vao = vao ?? this.defaultVao; }
  bindBuffer(_target: number, buffer: object | null): void { this.arrayBuffer = buffer; }
  bufferData(): void { this.count("bufferData"); }
  enableVertexAttribArray(location: number): void { this.pointer(location).enabled = true; }
  vertexAttribPointer(location: number, size: number, _type: number, _normalized: boolean, stride: number, offset: number): void {
    this.count("vertexAttribPointer");
    Object.assign(this.pointer(location), { buffer: this.arrayBuffer, size, stride, offset });
  }
  vertexAttribDivisor(location: number, divisor: number): void { this.pointer(location).divisor = divisor; }
  getUniformLocation(_program: object, name: string): object { return { name }; }
  uniform1f(): void { this.count("uniform"); }
  uniform1i(): void { this.count("uniform"); }
  uniform3f(): void { this.count("uniform"); }
  drawArraysInstanced(_mode: number, _first: number, vertices: number, count: number): void {
    assert.equal(vertices, 36);
    const attributes: Draw["attributes"] = [];
    for (let location = 0; location <= 5; location++) {
      const p = this.vao.attributes.get(location);
      if (!p || !p.enabled) throw Error(`attribute ${location} is not enabled`);
      attributes.push([location, p.buffer, p.offset, p.stride, p.divisor]);
    }
    this.draws.push({ attributes, count });
  }
  deleteBuffer(): void { /* not tracked */ }
  deleteVertexArray(): void { /* not tracked */ }
}

const world = new CityWorld();
const gl = new FakeGL();
const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement;
const shader = { program: {}, dispose: () => undefined } as unknown as TextmodeShader;
const batch = new BuildingBatch(canvas, shader, world);
const frame: BatchFrame = { scene: {} as WebGLTexture, text: {} as WebGLTexture, time: 12, rain: true, atmosphere: true, viewRadius: 900, fadeIn: 1 };
const camera: BatchCamera = { x: 40, y: 1.7, z: -30, yaw: 0.4, pitch: -0.05, fov: 70, aspect: 1.5, mirror: false };
const chunks: BuildingChunk[] = [...batch.chunks.values()].sort((a, b) => Math.hypot(a.x - camera.x, a.z - camera.z) - Math.hypot(b.x - camera.x, b.z - camera.z)).slice(0, 220);

// Where each drawn block's instance attributes must point: its slice of the one instance buffer.
function expected(): { offset: number; count: number }[] {
  return chunks.map(chunk => ({ offset: chunk.start * STRIDE_BYTES, count: chunkInstanceCount(chunk, camera.x, camera.z) })).filter(d => d.count > 0);
}

test("block VAOs and the re-pointing fallback draw the same slices, and the bindings are restored", () => {
  const want = expected(), outsideBuffer = {}, outsideVao = gl.createVertexArray();
  assert.ok(want.length > 120, "enough blocks to need several passes of VAO building");
  for (let pass = 0; pass < 8; pass++) {
    gl.bindVertexArray(outsideVao); gl.bindBuffer(gl.ARRAY_BUFFER, outsideBuffer); gl.reset();
    batch.draw(camera, frame, chunks);
    assert.equal(gl.draws.length, want.length);
    gl.draws.forEach((draw, i) => {
      assert.equal(draw.count, want[i].count);
      const [vertex, ...instanced] = draw.attributes;
      assert.equal(vertex[2], 0); assert.equal(vertex[3], 12); assert.equal(vertex[4], 0);
      const instanceBuffer = instanced[0][1];
      assert.notEqual(instanceBuffer, vertex[1]);
      const layout = [0, 3, 6, 10, 14];
      instanced.forEach(([, buffer, offset, stride, divisor], k) => {
        assert.equal(buffer, instanceBuffer); assert.equal(stride, STRIDE_BYTES); assert.equal(divisor, 1);
        assert.equal(offset, want[i].offset + layout[k] * 4);
      });
    });
    assert.equal(gl.vao, outsideVao, "VAO binding restored");
    assert.equal(gl.arrayBuffer, outsideBuffer, "ARRAY_BUFFER binding restored");
  }
  // Every block has its VAO now: no attribute re-pointing, one bind and one draw per block.
  gl.reset(); batch.draw(camera, frame, chunks);
  assert.equal(gl.calls.get("vertexAttribPointer") ?? 0, 0);
  assert.equal(gl.calls.get("createVertexArray") ?? 0, 0);
  assert.equal(gl.calls.get("uniform") ?? 0, 0, "an identical pass sends no uniforms");
});

test("a changed camera re-sends only the uniforms that changed", () => {
  gl.reset(); batch.draw({ ...camera, mirror: true }, frame, chunks);
  // u_forward, u_right, u_down and u_mirror differ in the mirrored pass; position, lens and frame do not.
  assert.equal(gl.calls.get("uniform"), 4);
  gl.reset(); batch.draw({ ...camera, mirror: true }, { ...frame, time: 13 }, chunks);
  assert.equal(gl.calls.get("uniform"), 1);
});
