import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { TextmodeUniformValue } from "textmode.js";
import type { PropCanvas } from "../src/city/prop-canvas.ts";

// signage.ts and materials.ts import their neighbours without extensions (the bundler resolves them).
register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { SIGN_FORMAT, drawLetterPanel, signStyle, signTextWords } = await import("../src/city/signage.ts");
const { CITY_MATERIAL } = await import("../src/city/materials.ts");

test("packed-letter words: only those the shader can read for the panel's length", () => {
  assert.equal(signTextWords(0, 0), 0);
  assert.equal(signTextWords(1, 0), 1);
  assert.equal(signTextWords(4, 0), 1);
  assert.equal(signTextWords(5, 0), 2);
  assert.equal(signTextWords(8, 0), 2);
  assert.equal(signTextWords(12, signStyle(SIGN_FORMAT.boxed, 2)), 3);
  assert.equal(signTextWords(13, 0), 4);
  assert.equal(signTextWords(16, 0), 4);
  assert.equal(signTextWords(22, 0), 4); // columns past 16 keep reading u_text3
  assert.equal(signTextWords(4.5, 0), 2);
  // LED tickers read the message feed, never packed letters.
  assert.equal(signTextWords(16, signStyle(SIGN_FORMAT.led)), 0);
  assert.equal(signTextWords(16, signStyle(SIGN_FORMAT.led, 3)), 0);
});

test("the sign shader still guards every packed-word read by u_textLength (else words must not be skipped)", () => {
  const reads = CITY_MATERIAL.replace(/\/\/[^\n]*/g, "").match(/u_text[0-3]/g) ?? [];
  // Declaration (4) plus the single read site in packedChar (4).
  assert.equal(reads.length, 8);
  assert.match(CITY_MATERIAL, /if \(k < 0 \|\| float\(k\) >= u_textLength\) return A_SPACE;\s*uint packed = uint\(k < 4 \? u_text0 : k < 8 \? u_text1 : k < 12 \? u_text2 : u_text3\);/);
  assert.match(CITY_MATERIAL, /int textRow = format == 3 \? FEED_ROW/);
});

test("drawLetterPanel sends only the readable words", () => {
  const sent: Record<string, TextmodeUniformValue>[] = [];
  const noop = () => undefined;
  const canvas: PropCanvas = {
    push: noop, pop: noop, translate: noop, rotateX: noop, rotateY: noop, rotateZ: noop, scale: noop, box: noop, ellipsoid: noop, sphere: noop, torus: noop,
    char: noop, charColor: noop, cellColor: noop, charRotation: noop, flipX: noop, flipY: noop, rect: noop, setUniform: noop,
    setUniforms: uniforms => { sent.push(uniforms); },
  };
  const face = { x: 1, y: 2, z: 3, yaw: 0, width: 4, height: 1, color: [200, 100, 50] as [number, number, number] };
  drawLetterPanel(canvas, { ...face, text: "BAR" });
  drawLetterPanel(canvas, { ...face, text: "NOODLE HOUSE" });
  drawLetterPanel(canvas, { ...face, text: "SILK MARKET STAL" });
  drawLetterPanel(canvas, { ...face, text: "NEWS", style: signStyle(SIGN_FORMAT.led), columns: 16 });
  const words = (u: Record<string, TextmodeUniformValue>) => ["u_text0", "u_text1", "u_text2", "u_text3"].filter(k => k in u);
  assert.deepEqual(words(sent[0]), ["u_text0"]);
  assert.deepEqual(words(sent[1]), ["u_text0", "u_text1", "u_text2"]);
  assert.deepEqual(words(sent[2]), ["u_text0", "u_text1", "u_text2", "u_text3"]);
  assert.deepEqual(words(sent[3]), []);
  // B=2, A=1, R=18, space=0: same packing as before.
  assert.equal(sent[0].u_text0, 2 + 1 * 64 + 18 * 4096);
  for (const u of sent) { assert.equal(u.u_surface, 3); assert.ok("u_textLength" in u && "u_vertical" in u && "u_signSeed" in u && "u_signStyle" in u); }
});
