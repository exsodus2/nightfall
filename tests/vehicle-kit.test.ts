import assert from "node:assert/strict";
import test from "node:test";
import { MESH_BOX, PROP_STRIDE, PropRecorder, type PropCanvas } from "../src/city/prop-canvas.ts";
import type { RGB } from "../src/city/world.ts";
import type { CarKind } from "../src/city/traffic.ts";
import {
  BOARD_RATE, KIT_MID, KIT_NEAR, LIVERY_WORDS, boardWindow, cellMetres, destinationText, drawVehicleKit, kitTier, letterStrokes, plateText,
  type VehicleKitScene, type VehicleKitState,
} from "../src/city/vehicle-kit.ts";

const record = () => new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
interface TestScene extends VehicleKitScene { code: number }
function scene(): TestScene {
  const s: TestScene = {
    code: 255,
    paint(canvas: PropCanvas, color: RGB, glyph: string, gain = 1): void { canvas.char(glyph); canvas.charColor(color[0] * gain, color[1] * gain, color[2] * gain); canvas.cellColor(0, 0, 0, s.code); },
    range(metres: number): number { const previous = s.code; s.code = Math.max(1, Math.min(254, Math.round(metres / 4))); return previous; },
    restore(code: number): void { s.code = code; },
  };
  return s;
}
const state = (distance: number, extra: Partial<VehicleKitState> = {}): VehicleKitState => ({ distance, time: 12, rain: true, neon: [255, 71, 148], occupied: true, beams: 0, doors: false, variant: 5, ...extra });
const total = (recorder: PropRecorder) => recorder.counts.reduce((sum, value) => sum + value, 0);
const origins = (recorder: PropRecorder) => Array.from({ length: recorder.counts[MESH_BOX] }, (_, i) => Array.from(recorder.data[MESH_BOX].slice(i * PROP_STRIDE, i * PROP_STRIDE + 3)));
const KINDS: readonly CarKind[] = ["sedan", "cab", "van", "pickup", "coupe", "police", "bus", "truck", "tanker", "tuktuk", "corpsec", "ambulance"];

test("kit tiers: full kit near, panels at mid, nothing far", () => {
  assert.equal(kitTier(5), 2);
  assert.equal(kitTier(KIT_NEAR - 0.01), 2);
  assert.equal(kitTier(KIT_NEAR), 1);
  assert.equal(kitTier(KIT_MID - 0.01), 1);
  assert.equal(kitTier(KIT_MID), 0);
  assert.ok(cellMetres(0) > 0 && Math.abs(cellMetres(20) - 0.21) < 1e-9);
});

test("far vehicles record no kit; mid stays small; near stays bounded", () => {
  for (const kind of KINDS) {
    const far = record(), mid = record(), near = record();
    drawVehicleKit(far, scene(), kind, 100000 + 37 * 16, [131, 107, 189], state(KIT_MID + 1));
    drawVehicleKit(mid, scene(), kind, 100000 + 37 * 16, [131, 107, 189], state(35));
    drawVehicleKit(near, scene(), kind, 100000 + 37 * 16, [131, 107, 189], state(8));
    assert.equal(total(far), 0, `${kind}: far adds nothing`);
    assert.ok(total(mid) <= 22, `${kind}: mid panels only (${total(mid)})`);
    assert.ok(total(near) >= total(mid), `${kind}: near adds detail`);
    assert.ok(total(near) <= 130, `${kind}: near kit bounded (${total(near)})`);
  }
  // The wreck keeps its plain boxes at any range.
  const wreck = record();
  drawVehicleKit(wreck, scene(), "wreck", 100000 + 15, [96, 78, 64], state(4));
  assert.equal(total(wreck), 0);
});

test("kit parts stay on the body (footprint, ground to roof) and the caller's range is restored", () => {
  for (const kind of KINDS) {
    const canvas = record(), s = scene();
    drawVehicleKit(canvas, s, kind, 100000 + 9 * 16, [46, 152, 184], state(6, { beams: 0 }));
    const long = kind === "bus" || kind === "truck" || kind === "tanker";
    for (const [x, y, z] of origins(canvas)) {
      assert.ok(Math.abs(x) < 1.8, `${kind}: x ${x}`);
      assert.ok(y <= 0 && y > -3.8, `${kind}: y ${y}`);
      assert.ok(z > -3.3 && z < (long ? 9.0 : 3.2), `${kind}: z ${z}`);
    }
    assert.equal(s.code, 255, `${kind}: range restored`);
  }
});

test("headlight pools only for moving cars, on the road ahead", () => {
  const parked = record(), moving = record();
  drawVehicleKit(parked, scene(), "sedan", 100000 + 4 * 16, [46, 152, 184], state(30, { beams: 0, rain: false }));
  drawVehicleKit(moving, scene(), "sedan", 100000 + 4 * 16, [46, 152, 184], state(30, { beams: 1, rain: false }));
  assert.equal(total(moving) - total(parked), 2);
  const pools = origins(moving).filter(([, y]) => y > -0.05);
  assert.equal(pools.length, 2);
  for (const [, , z] of pools) assert.ok(z < -3);
});

test("number plates and destination boards", () => {
  for (let id = 100000; id < 100400; id += 7) assert.match(plateText(id), /^[A-Z]{2}\d{2}$/);
  assert.equal(plateText(100123), plateText(100123));
  for (let route = 0; route < 6; route++) {
    const text = destinationText(route);
    assert.ok(text.endsWith("   "));
    const [from, to] = text.trim().split(" VIA ");
    assert.notEqual(from, to);
  }
  // Short text sits still and centred; long text scrolls at BOARD_RATE letters a second.
  assert.equal(boardWindow("BUS   ", 0, 7), "  BUS  ");
  assert.equal(boardWindow("BUS   ", 9, 7), "  BUS  ");
  const text = destinationText(2);
  assert.equal(boardWindow(text, 0, 6), text.slice(0, 6));
  assert.equal(boardWindow(text, 1 / BOARD_RATE, 6), text.slice(1, 7));
  assert.equal(boardWindow(text, 0, 0), "");
});

test("livery letters exist for every livery word and fit the 3x5 grid", () => {
  for (const word of LIVERY_WORDS) for (const letter of word) {
    const strokes = letterStrokes(letter);
    assert.ok(strokes.length >= 3, `${letter} has strokes`);
    for (const [column, row, length] of strokes) {
      assert.ok(column >= 0 && column + length <= 3 && row >= 0 && row < 5 && length >= 1);
    }
  }
});
