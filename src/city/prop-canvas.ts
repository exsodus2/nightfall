import type { Textmodifier, TextmodeUniformValue } from "textmode.js";

/**
 * The drawing surface props are written against. It is a subset of textmode's API, so the real
 * Textmodifier satisfies it (direct drawing, used for reference checks), while PropRecorder turns
 * the same calls into GPU instances and SignCanvas keeps only the sign panels that need uniforms.
 */
export interface PropCanvas {
  push(): void;
  pop(): void;
  translate(x?: number, y?: number, z?: number): void;
  rotateX(degrees?: number): number | void;
  rotateY(degrees?: number): number | void;
  rotateZ(degrees?: number): number | void;
  scale(x: number, y?: number, z?: number): void;
  box(width?: number, height?: number, depth?: number): void;
  ellipsoid(radiusX?: number, radiusY?: number, radiusZ?: number): void;
  sphere(radius?: number): void;
  torus(radius?: number, tubeRadius?: number): void;
  char(value: string | number): void;
  charColor(r: number, g: number, b: number, a?: number): void;
  cellColor(r: number, g: number, b: number, a?: number): void;
  charRotation(degrees?: number): number | void;
  flipX(toggle?: boolean): boolean | void;
  flipY(toggle?: boolean): boolean | void;
  rect(width?: number, height?: number): void;
  setUniform(name: string, value: TextmodeUniformValue): void;
  setUniforms(uniforms: Record<string, TextmodeUniformValue>): void;
}

export const MESH_BOX = 0, MESH_SPHERE = 1, MESH_TORUS = 2;
/** Floats per instance: origin(3), axes(9), ink(4), paper(4), glyph lo/hi + rotation + flags(4), params(4). */
export const PROP_STRIDE = 28;

interface Style { glyph: readonly [number, number]; ink: [number, number, number, number]; paper: [number, number, number, number]; rotation: number; flip: number }

function copyStyle(target: Style, source: Style): void {
  target.glyph = source.glyph; target.rotation = source.rotation; target.flip = source.flip;
  for (let channel = 0; channel < 4; channel++) { target.ink[channel] = source.ink[channel]; target.paper[channel] = source.paper[channel]; }
}

/** Where captured sign panels are replayed: the real Textmodifier (a subset of its API). */
export interface PanelSink extends Pick<PropCanvas, "push" | "pop" | "charColor" | "cellColor" | "rect" | "setUniform" | "setUniforms"> {
  resetMatrix(): void;
  applyMatrix(matrix: ArrayLike<number>): void;
}

/** A sign-panel call captured by PropRecorder: uniforms, or a rect with its full model matrix and colours. */
interface PanelCommand { tag: number; kind: 0 | 1 | 2; uniforms: Record<string, TextmodeUniformValue> | null; name: string; value: TextmodeUniformValue; matrix: Float64Array; ink: number[]; paper: number[]; width: number; height: number }

/** Records textmode-style prop drawing into per-mesh instance arrays for one GPU draw each. */
export class PropRecorder implements PropCanvas {
  /**
   * Perf: sign panels (rects with per-panel uniforms, which cannot be instanced) are captured while
   * `panelTag` >= 0 and replayed into each render pass with `replayPanels`, instead of walking every
   * shop and station again through textmode's transform stack once per pass. The tag (the caller's
   * distance, say) lets a pass keep a subset exactly as if it had walked only those callers.
   */
  panelTag = -1;
  private readonly panels: PanelCommand[] = [];
  private panelCount = 0;
  readonly data: Float32Array[] = [new Float32Array(4096 * PROP_STRIDE), new Float32Array(2048 * PROP_STRIDE), new Float32Array(64 * PROP_STRIDE)];
  readonly counts = [0, 0, 0];
  surface = 2;
  private readonly matrix = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  private readonly scratch = new Float64Array(16);
  private readonly stack: { matrix: Float64Array; style: Style }[] = [];
  private stackDepth = 0;
  private style: Style = { glyph: [0, 0], ink: [1, 1, 1, 1], paper: [0, 0, 0, 1], rotation: 0, flip: 0 };
  private readonly glyphs = new Map<string, readonly [number, number]>();
  private readonly glyphOf: (character: string) => readonly [number, number, number];
  constructor(glyphOf: (character: string) => readonly [number, number, number]) { this.glyphOf = glyphOf; }

  reset(): void {
    this.counts.fill(0);
    this.matrix.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    this.stackDepth = 0;
    this.panelCount = 0; this.panelTag = -1;
  }
  private panel(kind: 0 | 1 | 2): PanelCommand {
    let command = this.panels[this.panelCount];
    if (!command) { command = { tag: 0, kind, uniforms: null, name: "", value: 0, matrix: new Float64Array(16), ink: [0, 0, 0, 0], paper: [0, 0, 0, 0], width: 0, height: 0 }; this.panels.push(command); }
    this.panelCount++;
    command.tag = this.panelTag; command.kind = kind;
    return command;
  }
  /** Number of captured sign-panel commands this frame (uniform changes and rects). */
  get panelCommands(): number { return this.panelCount; }
  /**
   * Replays the captured sign panels into textmode, in capture order, keeping the commands whose tag
   * passes `keep`. Each rect is drawn the way drawLetterPanel draws it (push, transform, colours,
   * rect, pop), with the recorded matrix applied in one step.
   */
  replayPanels(t: PanelSink, keep: (tag: number) => boolean): void {
    for (let i = 0; i < this.panelCount; i++) {
      const command = this.panels[i];
      if (!keep(command.tag)) continue;
      if (command.kind === 0) { if (command.uniforms) t.setUniforms(command.uniforms); }
      else if (command.kind === 1) t.setUniform(command.name, command.value);
      else {
        const { ink, paper } = command;
        t.push(); t.resetMatrix(); t.applyMatrix(command.matrix);
        t.charColor(ink[0], ink[1], ink[2], ink[3]); t.cellColor(paper[0], paper[1], paper[2], paper[3]);
        t.rect(command.width, command.height); t.pop();
      }
    }
  }
  push(): void {
    let saved = this.stack[this.stackDepth];
    if (!saved) {
      saved = { matrix: new Float64Array(16), style: { glyph: [0, 0], ink: [0, 0, 0, 0], paper: [0, 0, 0, 0], rotation: 0, flip: 0 } };
      this.stack.push(saved);
    }
    saved.matrix.set(this.matrix); copyStyle(saved.style, this.style);
    this.stackDepth++;
  }
  pop(): void {
    if (this.stackDepth === 0) return;
    const saved = this.stack[--this.stackDepth];
    this.matrix.set(saved.matrix); copyStyle(this.style, saved.style);
  }
  // Column-major, post-multiplied - the same convention as textmode's own matrix stack.
  private apply(m: readonly number[]): void {
    const a = this.matrix, out = this.scratch;
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * m[c * 4] + a[4 + r] * m[c * 4 + 1] + a[8 + r] * m[c * 4 + 2] + a[12 + r] * m[c * 4 + 3];
    this.matrix.set(out);
  }
  translate(x = 0, y = 0, z = 0): void { const m = this.matrix; for (let r = 0; r < 3; r++) m[12 + r] += m[r] * x + m[4 + r] * y + m[8 + r] * z; }
  rotateX(degrees = 0): void { if (!degrees) return; const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); this.apply([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
  rotateY(degrees = 0): void { if (!degrees) return; const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); this.apply([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
  rotateZ(degrees = 0): void { if (!degrees) return; const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); this.apply([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  scale(x: number, y?: number, z?: number): void {
    // textmode: scale(s) is uniform, scale(x, y) leaves z at 1.
    const sy = y ?? x, sz = z ?? (y === undefined ? x : 1);
    this.apply([x, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]);
  }
  box(width = 1, height = width, depth = height): void { this.emit(MESH_BOX, width, height, depth, 0, 0); }
  ellipsoid(radiusX = 1, radiusY = radiusX, radiusZ = radiusX): void { this.emit(MESH_SPHERE, radiusX, radiusY, radiusZ, 0, 0); }
  sphere(radius = 1): void { this.emit(MESH_SPHERE, radius, radius, radius, 0, 0); }
  torus(radius = 1, tubeRadius = radius * 0.25): void { this.emit(MESH_TORUS, 1, 1, 1, radius, tubeRadius); }
  char(value: string | number): void {
    const key = String(value);
    let glyph = this.glyphs.get(key);
    if (!glyph) { const color = this.glyphOf(typeof value === "number" ? String.fromCharCode(value) : key); glyph = [color[0], color[1]]; this.glyphs.set(key, glyph); }
    this.style.glyph = glyph;
  }
  charColor(r: number, g: number, b: number, a = 255): void { const i = this.style.ink; i[0] = r / 255; i[1] = g / 255; i[2] = b / 255; i[3] = a / 255; }
  cellColor(r: number, g: number, b: number, a = 255): void { const p = this.style.paper; p[0] = r / 255; p[1] = g / 255; p[2] = b / 255; p[3] = a / 255; }
  charRotation(degrees = 0): void { this.style.rotation = ((degrees % 360) + 360) % 360 / 360; }
  flipX(toggle = true): void { this.style.flip = toggle ? this.style.flip | 2 : this.style.flip & ~2; }
  flipY(toggle = true): void { this.style.flip = toggle ? this.style.flip | 4 : this.style.flip & ~4; }
  // Sign panels need per-panel uniforms: not instanced, but captured for replayPanels while panelTag >= 0.
  rect(width = 1, height = width): void {
    if (this.panelTag < 0) return;
    const command = this.panel(2), s = this.style;
    command.matrix.set(this.matrix); command.width = width; command.height = height;
    for (let channel = 0; channel < 4; channel++) { command.ink[channel] = s.ink[channel] * 255; command.paper[channel] = s.paper[channel] * 255; }
  }
  setUniform(name: string, value: TextmodeUniformValue): void {
    if (this.panelTag < 0) return;
    const command = this.panel(1); command.name = name; command.value = value; command.uniforms = null;
  }
  setUniforms(uniforms: Record<string, TextmodeUniformValue>): void {
    if (this.panelTag < 0) return;
    this.panel(0).uniforms = { ...uniforms };
  }

  private emit(mesh: number, sx: number, sy: number, sz: number, radius: number, tube: number): void {
    let data = this.data[mesh];
    const count = this.counts[mesh];
    if ((count + 1) * PROP_STRIDE > data.length) { const grown = new Float32Array(data.length * 2); grown.set(data); this.data[mesh] = data = grown; }
    const m = this.matrix, s = this.style, o = count * PROP_STRIDE;
    data[o] = m[12]; data[o + 1] = m[13]; data[o + 2] = m[14];
    data[o + 3] = m[0] * sx; data[o + 4] = m[1] * sx; data[o + 5] = m[2] * sx;
    data[o + 6] = m[4] * sy; data[o + 7] = m[5] * sy; data[o + 8] = m[6] * sy;
    data[o + 9] = m[8] * sz; data[o + 10] = m[9] * sz; data[o + 11] = m[10] * sz;
    data.set(s.ink, o + 12); data.set(s.paper, o + 16);
    data[o + 20] = s.glyph[0]; data[o + 21] = s.glyph[1]; data[o + 22] = s.rotation; data[o + 23] = s.flip;
    data[o + 24] = radius; data[o + 25] = tube; data[o + 26] = this.surface; data[o + 27] = 0;
    this.counts[mesh] = count + 1;
  }
}

/** Keeps the transform stack and sign-panel calls of a real Textmodifier, dropping instanced geometry. */
export class SignCanvas implements PropCanvas {
  private readonly t: Textmodifier;
  constructor(t: Textmodifier) { this.t = t; }
  push(): void { this.t.push(); }
  pop(): void { this.t.pop(); }
  translate(x?: number, y?: number, z?: number): void { this.t.translate(x, y, z); }
  rotateX(degrees?: number): void { this.t.rotateX(degrees); }
  rotateY(degrees?: number): void { this.t.rotateY(degrees); }
  rotateZ(degrees?: number): void { this.t.rotateZ(degrees); }
  scale(x: number, y?: number, z?: number): void { this.t.scale(x, y, z); }
  box(): void { /* instanced */ }
  ellipsoid(): void { /* instanced */ }
  sphere(): void { /* instanced */ }
  torus(): void { /* instanced */ }
  char(value: string | number): void { this.t.char(value); }
  charColor(r: number, g: number, b: number, a?: number): void { this.t.charColor(r, g, b, a); }
  cellColor(r: number, g: number, b: number, a?: number): void { this.t.cellColor(r, g, b, a); }
  charRotation(degrees?: number): void { this.t.charRotation(degrees); }
  flipX(toggle?: boolean): void { this.t.flipX(toggle); }
  flipY(toggle?: boolean): void { this.t.flipY(toggle); }
  rect(width?: number, height?: number): void { this.t.rect(width, height); }
  setUniform(name: string, value: TextmodeUniformValue): void { this.t.setUniform(name, value); }
  setUniforms(uniforms: Record<string, TextmodeUniformValue>): void { this.t.setUniforms(uniforms); }
}
