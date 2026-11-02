import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { CityWorld, PLAYER_RADIUS } from "../src/city/world.ts";
import { DISTRICT_SIGNS, INSERT_SIGNS, MESSAGES } from "../src/city/messages.ts";

// signage.ts and materials.ts import their neighbours without extensions (the bundler resolves them).
register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { SIGN_FORMAT, signFaces, signStyle } = await import("../src/city/signage.ts");
const { CITY_MATERIAL } = await import("../src/city/materials.ts");

const world = new CityWorld();
const PACKED = /^[A-Z0-9 ]+$/;

test("sign texts fit the 16-letter packed alphabet", () => {
  for (const list of [...DISTRICT_SIGNS, INSERT_SIGNS]) for (const text of list) assert.ok(text.length <= 16 && PACKED.test(text), text);
  assert.equal(DISTRICT_SIGNS.length, 6);
  for (const text of INSERT_SIGNS) assert.ok(text.length <= 10, text);
  for (const b of world.buildings) for (const face of signFaces(b)) if (face.kind !== "ticker") assert.ok(face.text.length <= 16 && PACKED.test(face.text), face.text);
});

test("style packs a format and a district look the shader can decode", () => {
  for (const format of Object.values(SIGN_FORMAT)) for (const district of [undefined, 0, 1, 2, 3, 4, 5]) {
    const style = signStyle(format, district);
    assert.equal(style % 8, format);
    assert.equal(Math.floor(style / 8), district === undefined ? 0 : district + 1);
  }
  assert.ok(CITY_MATERIAL.includes("uniform float u_signStyle;") && CITY_MATERIAL.includes("format = style % 8, look = style / 8"));
});

test("fascias stay faces 0 and 1; tickers, inserts and corner signs go where they fit", () => {
  const kinds = new Set<string>();
  for (const b of world.buildings) {
    const faces = signFaces(b);
    assert.equal(faces[0].kind, "fascia"); assert.equal(faces[1].kind, "fascia");
    for (const face of faces) {
      kinds.add(face.kind ?? "");
      if (face.kind === "ticker") {
        assert.equal(b.id % 3, 0, "tickers hang under drawn fascias only");
        assert.ok(face.columns !== undefined && face.columns >= 8 && face.columns <= 40);
        assert.ok(face.y - face.height / 2 >= 4.7 && face.y + face.height / 2 <= faces[0].y - faces[0].height / 2 + 1e-9, "between the shopfront band and the fascia");
      } else if (face.kind === "insert") {
        assert.notEqual(b.id % 3, 0, "inserts go in the windows of shops without a fascia (the stalls are id % 3 === 0)");
        assert.ok(face.y - face.height / 2 >= 3.0, "above head height");
        // Flat on the window, inside the building's collision skin.
        const out = Math.abs(face.yaw) % 180 === 0 ? Math.abs(face.z - b.z) - b.depth / 2 : Math.abs(face.x - b.x) - b.width / 2;
        assert.ok(out > 0 && out < PLAYER_RADIUS, `insert ${out.toFixed(2)} m out`);
      } else if (face.kind === "corner") {
        assert.ok(face.vertical && Math.abs(b.x) >= 32, "never over the avenue");
        assert.ok(face.y - face.height / 2 >= 12 - 1e-9 && face.y + face.height / 2 <= b.height, "from 12 m up, under the roof");
      }
    }
    const corners = faces.filter(f => f.kind === "corner");
    if (corners.length) {
      assert.equal(corners.length, 2);
      assert.equal(((corners[1].yaw - corners[0].yaw) % 360 + 360) % 360, 180, "back to back");
    }
  }
  for (const kind of ["fascia", "blade", "corner", "ticker", "insert"]) assert.ok(kinds.has(kind), kind);
});

test("every message fits the LED feed slot (materials.ts FEED_SLOT)", () => {
  for (const message of MESSAGES) assert.ok(message.length <= 63);
  assert.ok(CITY_MATERIAL.includes("FEED_ROW = 4096, FEED_SLOT = 66"));
});

// The one-character tier of textGlyphD, mirrored: a cell lights when it contains its letter slot's
// centre, found through the inverse of the cell -> letter map. Text seen at a grazing angle has a
// sheared map (each letter axis moves along both screen axes); the per-axis rule it replaced lit
// two cells per slot there - the doubled letters.
const slotHits = (dx: readonly [number, number], dy: readonly [number, number], inverse: boolean): Map<number, number> => {
  const hits = new Map<number, number>();
  const jac = dx[0] * dy[1] - dy[0] * dx[1];
  const stepX = Math.max(Math.abs(dx[0]), Math.abs(dy[0])), stepY = Math.max(Math.abs(dx[1]), Math.abs(dy[1]));
  for (let cy = -60; cy <= 60; cy++) for (let cx = -60; cx <= 60; cx++) {
    const lx = 3.37 + cx * dx[0] + cy * dy[0], ly = 0.41 + cx * dx[1] + cy * dy[1];
    if (ly < 0 || ly >= 1 || lx < 0 || lx >= 8) continue;
    let fx: number, fy: number;
    if (inverse) {
      const tx = Math.floor(lx) + 0.5 - lx, ty = 0.5 - ly;
      fx = (dy[1] * tx - dy[0] * ty) / jac; fy = (dx[0] * ty - dx[1] * tx) / jac;
    } else { fx = (lx - Math.floor(lx) - 0.5) / stepX; fy = (ly - 0.5) / stepY; }
    if (Math.floor(fx + 0.5) === 0 && Math.floor(fy + 0.5) === 0) hits.set(Math.floor(lx), (hits.get(Math.floor(lx)) ?? 0) + 1);
  }
  return hits;
};

test("small letters resolve to exactly one cell per slot, even at grazing angles", () => {
  const maps: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
    [[0.25, 0], [0, 0.2]], // face on
    [[0.6, 0.18], [0, 0.12]], // receding: rows slant, letters squeezed
    [[0.45, 0.16], [0.05, 0.1]], // receding and looked up at: the slant is steeper than 45 degrees
    [[0.3, -0.21], [0.08, 0.15]],
    [[0.18, 0.05], [-0.04, 0.22]],
  ];
  for (const [dx, dy] of maps) for (const [slot, count] of slotHits(dx, dy, true)) assert.equal(count, 1, `slot ${slot} lit ${count} cells for dx ${dx} dy ${dy}`);
  // The old per-axis rule doubled letters on the steep slant.
  assert.ok([...slotHits([0.45, 0.16], [0.05, 0.1], false).values()].some(count => count > 1));
  assert.ok(CITY_MATERIAL.includes("float jac = dx.x * dy.y - dy.x * dx.y;"));
  // The ASCII-art face needs width too: squeezed letters drew runs of themselves ("EE").
  // (8x8 needs ~a cell per font pixel across: 7.5 cells, the same bound the whole-sign tier uses.)
  assert.ok(CITY_MATERIAL.includes("art = letterCells >= artFrom && slotCells >= 7.5 + tierJitter;"));
  assert.ok(CITY_MATERIAL.includes("float tierArt = min(signLetterCells / 15.5, signSlotCells / 7.5);"));
});
