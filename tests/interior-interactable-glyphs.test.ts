import assert from "node:assert/strict";
import test from "node:test";
import { drawInteriorInteractables } from "../src/city/interior-scene.ts";
import { interiorPlaces, interiorWorld } from "../src/city/interiors.ts";
import { miniFontBytes } from "../src/city/mini-font.ts";
import { PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import { CityWorld } from "../src/city/world.ts";

class PanelRecorder extends PropRecorder {
  override rect(width = 1, height = 1): void { super.box(width, height, 0.001); }
}

test("blank, unsupported and multi-character station glyphs draw readable bounded USE panels", () => {
  const place = interiorPlaces(new CityWorld())[3], font = miniFontBytes();
  for (const [glyph, expected] of [
    [undefined, "USE"], ["", "USE"], [" ", "USE"], ["~", "USE"], ["_", "USE"],
    ["\n", "USE"], ["\u007f", "USE"], ["✓", "USE"], ["😀", "USE"], ["USE", "USE"], [">", "USE"],
    ["=", "="], ["*", "*"], ["+", "+"], ["a", "a"],
  ] as const) {
    const canvas = new PanelRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
    drawInteriorInteractables(canvas, place, [{ id: "panel", label: "Test station", place: place.id, ...interiorWorld(place, 0, -2), glyph }]);
    assert.deepEqual(canvas.counts, [expected.length + 2, 0, 0], JSON.stringify(glyph));
    for (const [index, character] of [...expected].entries()) {
      const offset = (index + 1) * PROP_STRIDE;
      const code = Math.round(canvas.data[0][offset + 16] * 255);
      assert.equal(code, character.charCodeAt(0));
      assert.equal(canvas.data[0][offset + 17], 1);
      assert.notEqual(font[(code - 32) * 2] | (font[(code - 32) * 2 + 1] << 8), 0);
    }
    assert.ok(canvas.data[0].slice(0, canvas.counts[0] * PROP_STRIDE).every(Number.isFinite));
  }
});
