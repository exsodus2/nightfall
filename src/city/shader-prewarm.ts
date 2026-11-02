/**
 * Cold-start shader compilation in parallel.
 *
 * textmode compiles each program synchronously (compile, then COMPILE_STATUS / LINK_STATUS, which
 * block until the driver finishes), so a first visit links the city's programs one after another
 * while the page's main thread and the GPU process's main thread wait - long enough under GPU
 * contention for the GPU process to be reset ("Shader compilation error: null"). Here the same
 * sources are submitted together through KHR_parallel_shader_compile and polled with
 * COMPLETION_STATUS_KHR, so ANGLE links them on worker threads at once (wall time is the slowest
 * program, not the sum) and the page stays responsive. textmode's own compile of an identical
 * source pair afterwards is a program-cache hit (~0.1-0.2 s, scripts/shader-startup-check.mjs).
 *
 * The prewarm only runs where that cache is known to exist (Chromium) and only when textmode is
 * seen to pass material sources through unchanged; otherwise it is skipped and startup behaves as
 * before. Link errors are left for textmode's own compile to report with its info log.
 */
import type { Textmodifier } from "textmode.js";

export interface ProgramSource { vertex: string; fragment: string }

const PROBE_FRAGMENT = `#version 300 es
precision highp float;
layout(location=0) out vec4 o_character;
layout(location=1) out vec4 o_primaryColor;
layout(location=2) out vec4 o_secondaryColor;
void main() { o_character = vec4(0.0); o_primaryColor = vec4(0.0); o_secondaryColor = vec4(0.0); }`;

/** True where a parallel prewarm is worth doing: Chromium (GPU-process program cache) with the extension. */
export function canPrewarm(gl: WebGL2RenderingContext | null): gl is WebGL2RenderingContext {
  return !!gl && typeof navigator !== "undefined" && /Chrom(e|ium)\//.test(navigator.userAgent) && !!gl.getExtension("KHR_parallel_shader_compile");
}

/** The vertex source textmode pairs with every material shader, captured while it compiles a
 * trivial material; undefined if textmode changed the fragment source on the way (then a prewarm
 * would not hit the cache). */
export async function materialVertex(t: Textmodifier, gl: WebGL2RenderingContext): Promise<string | undefined> {
  const sources: { vertex?: string; fragment?: string } = {};
  const shaderSource = gl.shaderSource;
  gl.shaderSource = (shader: WebGLShader, source: string) => {
    if (gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER) sources.vertex ??= source;
    else sources.fragment ??= source;
    shaderSource.call(gl, shader, source);
  };
  try { (await t.createMaterialShader(PROBE_FRAGMENT)).dispose(); }
  finally { Reflect.deleteProperty(gl, "shaderSource"); if (gl.shaderSource !== shaderSource) gl.shaderSource = shaderSource; }
  return sources.fragment === PROBE_FRAGMENT ? sources.vertex : undefined;
}

/** Submits every program at once and resolves when all have linked and drawn once (or `active()`
 * turns false, or the context is lost). The programs are deleted; the cache keeps the result. */
export async function prewarmPrograms(gl: WebGL2RenderingContext, programs: readonly ProgramSource[], active: () => boolean): Promise<void> {
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  if (!parallel) return;
  const pending: { program: WebGLProgram; shaders: WebGLShader[] }[] = [];
  try {
    for (const { vertex, fragment } of programs) {
      const program = gl.createProgram(), shaders: WebGLShader[] = [];
      if (!program) return;
      pending.push({ program, shaders });
      for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(kind);
        if (!shader) return;
        shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
    }
    // The first draw with a program costs more than its link: ANGLE/D3D11 links the fragment for
    // its first output only and recompiles it with all three live at the first draw into the real
    // layout (materials.ts, compile-time rules), synchronously on the GPU thread; a re-link from the
    // cache skips that only if the cached program has drawn. So each program draws once into a 1x1
    // three-attachment target (the material MRT layout), one fence at a time so no single GPU task
    // runs long - and as soon as its own link is done, so those recompiles overlap the links still
    // running on ANGLE's worker threads instead of waiting for the slowest link.
    const undrawn = new Set(pending.map(({ program }) => program));
    while (undrawn.size) {
      if (!active() || gl.isContextLost()) return;
      const linked = [...undrawn].find(program => gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR));
      if (!linked) { await idle(); continue; }
      undrawn.delete(linked);
      if (gl.getProgramParameter(linked, gl.LINK_STATUS)) { drawOnce(gl, linked); await fence(gl); }
    }
  } finally {
    if (!gl.isContextLost()) for (const { program, shaders } of pending) { for (const shader of shaders) gl.deleteShader(shader); gl.deleteProgram(program); }
  }
}

const idle = () => new Promise<void>(resolve => setTimeout(resolve, 32));

async function fence(gl: WebGL2RenderingContext): Promise<void> {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return;
  gl.flush();
  try { while (!gl.isContextLost() && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) await idle(); }
  finally { gl.deleteSync(sync); }
}

/** One draw call with `program` into a throwaway 1x1 RGBA8 x3 framebuffer. Every piece of GL state
 * it touches is restored, since textmode tracks its own. Attributes stay disabled (constant zero),
 * so the triangle is degenerate: only the shaders' first use matters. */
function drawOnce(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  const saved = {
    framebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
    unit: gl.getParameter(gl.ACTIVE_TEXTURE) as number,
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
  };
  gl.activeTexture(gl.TEXTURE0);
  const texture2d = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const toggles = [gl.SCISSOR_TEST, gl.RASTERIZER_DISCARD, gl.CULL_FACE, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.BLEND].map(cap => [cap, gl.isEnabled(cap)] as const);
  const framebuffer = gl.createFramebuffer(), vao = gl.createVertexArray(), targets: WebGLTexture[] = [];
  try {
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    for (let attachment = 0; attachment < 3; attachment++) {
      const target = gl.createTexture();
      if (!target) return;
      targets.push(target);
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + attachment, gl.TEXTURE_2D, target, 0);
    }
    gl.bindTexture(gl.TEXTURE_2D, null); // no feedback loop through texture unit 0
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    for (const [cap] of toggles) gl.disable(cap);
    gl.viewport(0, 0, 1, 1);
    gl.bindVertexArray(vao);
    gl.useProgram(program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } finally {
    gl.useProgram(saved.program);
    gl.bindVertexArray(saved.vao);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, saved.framebuffer);
    gl.viewport(saved.viewport[0], saved.viewport[1], saved.viewport[2], saved.viewport[3]);
    for (const [cap, enabled] of toggles) if (enabled) gl.enable(cap); else gl.disable(cap);
    gl.bindTexture(gl.TEXTURE_2D, texture2d);
    gl.activeTexture(saved.unit);
    for (const target of targets) gl.deleteTexture(target);
    gl.deleteVertexArray(vao); gl.deleteFramebuffer(framebuffer);
  }
}
