import assert from "node:assert/strict";
import test from "node:test";
import { ORBIT_MAX_SPEED, clampOrbitSpeed, dragAim, frameToText, glyphLookup, orbitStep, photoFilename, plainCharacter, type PhotoFrame } from "../src/city/photo-mode.ts";

/** A frame whose glyph index is the position in `keys` (normalised colours, as textmode reports them). */
function frame(keys: string[], rows: string[][]): PhotoFrame {
  const cols = Math.max(...rows.map(row => row.length));
  const cells = new Uint8Array(cols * rows.length * 4);
  rows.forEach((row, y) => row.forEach((key, x) => {
    const index = keys.indexOf(key), offset = (y * cols + x) * 4;
    cells[offset] = index & 255; cells[offset + 1] = index >> 8; cells[offset + 3] = 255;
  }));
  return { cols, rows: rows.length, cells, glyphs: keys.map((key, index) => [key, [(index & 255) / 255, (index >> 8) / 255, 0]] as const) };
}

test("plainCharacter maps the atlas's thin weight and blank keys to plain text", () => {
  assert.equal(plainCharacter("#"), "#");
  assert.equal(plainCharacter(String.fromCodePoint(0xe000 + ("A".charCodeAt(0) - 32))), "A");
  assert.equal(plainCharacter(String.fromCodePoint(0xe000)), " ");
  assert.equal(plainCharacter(String.fromCodePoint(0xe105)), " ");
  assert.equal(plainCharacter("\u0007"), " ");
  assert.equal(plainCharacter("░"), "░");
});

test("glyphLookup accepts normalised and byte colours, and prefers a printable key on a shared index", () => {
  assert.equal(glyphLookup([["a", [1 / 255, 0, 0]], ["b", [2 / 255, 1 / 255, 0]]]).get(258), "b");
  assert.equal(glyphLookup([["a", [1, 0, 0]], ["b", [2, 1, 0]]]).get(258), "b");
  assert.equal(glyphLookup([["\u0001", [3 / 255, 0, 0]], ["x", [3 / 255, 0, 0]]]).get(3), "x");
});

test("frameToText writes rows top first, trims trailing spaces and blank bottom rows", () => {
  const keys = [" ", "#", ".", String.fromCodePoint(0xe000 + ("|".charCodeAt(0) - 32))];
  const text = frameToText(frame(keys, [
    ["#", ".", " ", " "],
    [" ", keys[3], "#", " "],
    [" ", " ", " ", " "],
  ]));
  assert.equal(text, "#.\n |#\n");
});

test("frameToText decodes glyph indices above 255 and survives a short buffer", () => {
  const keys = Array.from({ length: 300 }, (_, index) => index === 299 ? "@" : String.fromCodePoint(0xe100 + index));
  const full = frame(keys, [["@", "@"]]);
  assert.equal(frameToText(full), "@@\n");
  assert.equal(frameToText({ ...full, cells: full.cells.slice(0, 4) }), "@\n");
});

test("photoFilename slugs the place and stamps local date and time", () => {
  const date = new Date(2026, 9, 21, 22, 5, 9);
  assert.equal(photoFilename("Neon Market", date, "png"), "nightfall-neon-market-2026-10-21-220509.png");
  assert.equal(photoFilename("Café / Ñoño's", date, "txt"), "nightfall-cafe-nono-s-2026-10-21-220509.txt");
  assert.equal(photoFilename("", date, "png"), "nightfall-2026-10-21-220509.png");
});

test("orbit eases up to its speed, never exceeds 10 deg/s, and eases back to rest", () => {
  let velocity = 0;
  const first = orbitStep(velocity, 8, 1 / 60);
  assert.ok(first.velocity > 0 && first.velocity < 1, "starts gently");
  for (let i = 0; i < 600; i++) velocity = orbitStep(velocity, 8, 1 / 60).velocity;
  assert.ok(Math.abs(velocity - 8) < 0.01);
  for (let i = 0; i < 600; i++) assert.ok(orbitStep(velocity, 50, 1 / 60).velocity <= ORBIT_MAX_SPEED);
  const hitch = orbitStep(ORBIT_MAX_SPEED, ORBIT_MAX_SPEED, 2);
  assert.ok(hitch.yaw <= ORBIT_MAX_SPEED * Math.PI / 180 * 0.1 + 1e-9, "a long frame never jumps");
  for (let i = 0; i < 600; i++) velocity = orbitStep(velocity, 0, 1 / 60).velocity;
  assert.equal(velocity, 0);
  assert.equal(clampOrbitSpeed(40), ORBIT_MAX_SPEED);
  assert.equal(clampOrbitSpeed(Number.NaN), 5);
});

test("dragAim turns like mouse look and keeps the engine's pitch limits", () => {
  const aim = dragAim(0, 0, 100, -100);
  assert.ok(aim.yaw > 0 && aim.pitch < 0);
  assert.equal(dragAim(0, 1.1, 0, 10_000).pitch, 1.2);
  assert.equal(dragAim(0, -1.1, 0, -10_000).pitch, -1.3);
});
