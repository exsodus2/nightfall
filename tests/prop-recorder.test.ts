import assert from "node:assert/strict";
import test from "node:test";
import { PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";

const recorder = () => new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
const instance = (canvas: PropRecorder, index: number) => canvas.data[0].slice(index * PROP_STRIDE, (index + 1) * PROP_STRIDE);

function outer(canvas: PropRecorder): void {
  canvas.translate(14, -3, 22); canvas.rotateY(47); canvas.rotateX(-21); canvas.scale(2, 3, 4);
  canvas.char("%"); canvas.charColor(51, 102, 153, 204); canvas.cellColor(25, 50, 75, 100);
  canvas.charRotation(45); canvas.flipX(true); canvas.flipY(false);
}

function inner(canvas: PropRecorder): void {
  canvas.translate(-7, 4, -2); canvas.rotateZ(23); canvas.rotateX(18); canvas.scale(0.5);
  canvas.char("@"); canvas.charColor(255, 120, 80); canvas.cellColor(100, 75, 50, 25);
  canvas.charRotation(-90); canvas.flipX(false); canvas.flipY(true);
}

test("pooled stack restores every transform and glyph style without sibling aliasing", () => {
  const canvas = recorder(), expectedOuter = recorder(), expectedInner = recorder();
  outer(expectedOuter); expectedOuter.box(3, 5, 7);
  outer(expectedInner); inner(expectedInner); expectedInner.box(3, 5, 7);
  outer(canvas);
  for (let sibling = 0; sibling < 20; sibling++) {
    canvas.push(); inner(canvas); canvas.box(3, 5, 7);
    canvas.push(); canvas.translate(100, 200, 300); canvas.char("X"); canvas.charColor(1, 2, 3); canvas.flipX(); canvas.pop();
    canvas.box(3, 5, 7); canvas.pop(); canvas.box(3, 5, 7);
    assert.deepEqual(instance(canvas, sibling * 3), instance(expectedInner, 0));
    assert.deepEqual(instance(canvas, sibling * 3 + 1), instance(expectedInner, 0));
    assert.deepEqual(instance(canvas, sibling * 3 + 2), instance(expectedOuter, 0));
  }
  assert.deepEqual(Array.from(instance(expectedOuter, 0).slice(12, 24)), Array.from(new Float32Array([0.2, 0.4, 0.6, 0.8, 25 / 255, 50 / 255, 75 / 255, 100 / 255, 37 / 255, 0, 0.125, 2])));
});

test("reset abandons pending scopes but preserves current style and surface", () => {
  const canvas = recorder(), expected = recorder();
  canvas.surface = 6;
  outer(canvas); canvas.push(); inner(canvas); canvas.push(); canvas.box();
  inner(expected); expected.reset(); expected.surface = 6; expected.box();
  canvas.reset(); canvas.pop(); canvas.pop(); canvas.box();
  assert.deepEqual(canvas.counts, [1, 0, 0]);
  assert.deepEqual(instance(canvas, 0), instance(expected, 0));
  for (let frame = 0; frame < 80; frame++) {
    canvas.reset();
    for (let depth = 0; depth < frame % 17; depth++) { canvas.push(); canvas.translate(depth, -depth, depth * 2); canvas.rotateY(depth * 7); }
    for (let depth = 0; depth < frame % 17; depth++) canvas.pop();
    canvas.box();
    assert.deepEqual(instance(canvas, 0), instance(expected, 0));
  }
});

test("matrix composition preserves the established post-multiplied column-major arithmetic", () => {
  const canvas = recorder();
  let matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const multiply = (next: number[]) => {
    const result = Array<number>(16).fill(0);
    for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
      result[column * 4 + row] = matrix[row] * next[column * 4] + matrix[4 + row] * next[column * 4 + 1] + matrix[8 + row] * next[column * 4 + 2] + matrix[12 + row] * next[column * 4 + 3];
    }
    matrix = result;
  };
  for (let step = 0; step < 48; step++) {
    const angle = (step * 19 - 137) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
    canvas.rotateX(step * 19 - 137); multiply([1, 0, 0, 0, 0, cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, 1]);
    canvas.rotateY(step * 19 - 137); multiply([cosine, 0, -sine, 0, 0, 1, 0, 0, sine, 0, cosine, 0, 0, 0, 0, 1]);
    canvas.rotateZ(step * 19 - 137); multiply([cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const scale = step % 2 ? 0.98 : 1.02;
    canvas.scale(scale, 1.01, 0.99); multiply([scale, 0, 0, 0, 0, 1.01, 0, 0, 0, 0, 0.99, 0, 0, 0, 0, 1]);
    canvas.translate(0.25, -0.1, 0.5);
    for (let row = 0; row < 3; row++) matrix[12 + row] += matrix[row] * 0.25 + matrix[4 + row] * -0.1 + matrix[8 + row] * 0.5;
    canvas.box(2, 3, 4);
    const expected = new Float32Array([matrix[12], matrix[13], matrix[14], matrix[0] * 2, matrix[1] * 2, matrix[2] * 2, matrix[4] * 3, matrix[5] * 3, matrix[6] * 3, matrix[8] * 4, matrix[9] * 4, matrix[10] * 4]);
    assert.deepEqual(instance(canvas, step).slice(0, 12), expected);
  }
});

test("the batch surface remains unscoped across push and pop", () => {
  const canvas = recorder();
  canvas.surface = 2; canvas.push(); canvas.surface = 6; canvas.pop(); canvas.box();
  assert.equal(instance(canvas, 0)[26], 6);
});

test("warmed fixed-depth transform work creates no additional matrix buffers", () => {
  const original = globalThis.Float64Array;
  const originalSlice = original.prototype.slice;
  let allocations = 0;
  globalThis.Float64Array = new Proxy(original, { construct(target, argumentsList) { allocations++; return Reflect.construct(target, argumentsList); } });
  original.prototype.slice = function(start?: number, end?: number) { allocations++; return originalSlice.call(this, start, end); };
  try {
    const canvas = recorder();
    const frame = () => {
      canvas.reset();
      for (let depth = 0; depth < 12; depth++) { canvas.push(); canvas.translate(1, -2, 3); canvas.rotateX(15); canvas.rotateY(27); canvas.rotateZ(13); canvas.scale(0.99, 1.01, 1); canvas.box(); }
      for (let depth = 0; depth < 12; depth++) canvas.pop();
    };
    frame(); allocations = 0;
    for (let repeat = 0; repeat < 100; repeat++) frame();
    assert.equal(allocations, 0);
  } finally { globalThis.Float64Array = original; original.prototype.slice = originalSlice; }
});
