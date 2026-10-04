import assert from "node:assert/strict";
import test from "node:test";
import { drawHuman, type HumanPaint } from "../src/city/human-model.ts";
import { drawUmbrella, UMBRELLA } from "../src/city/umbrella-model.ts";
import { drawVehicleTyres, WHEEL_GEOMETRY } from "../src/city/vehicle-wheels.ts";
import { drawRearCabin } from "../src/city/vehicle-cabin.ts";
import { MESH_BOX, MESH_SPHERE, MESH_TORUS, PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import type { NpcLook } from "../src/city/npcs.ts";

const LOOK: NpcLook = { coat: [170, 75, 110], trim: [55, 62, 75], skin: [186, 144, 109], light: [86, 220, 226], headwear: "hood", idle: "breathe", prop: "case" };
const paint: HumanPaint = (canvas, color, glyph, gain = 1) => { canvas.char(glyph); canvas.charColor(color[0] * gain, color[1] * gain, color[2] * gain); canvas.cellColor(0, 0, 0); };
const record = () => new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
const origins = (recorder: PropRecorder, mesh: number) => Array.from({ length: recorder.counts[mesh] }, (_, index) => Array.from(recorder.data[mesh].slice(index * PROP_STRIDE, index * PROP_STRIDE + 3)));

test("character LOD preserves a complete silhouette within a bounded geometry budget", () => {
  for (const headwear of ["hood", "visor", "cap", "bare"] as const) {
    const near = record(), far = record();
    const pose = { time: 10, seed: 4, stride: 0.7, moving: true, detail: true, longCoat: true };
    drawHuman(near, { ...LOOK, headwear }, pose, paint);
    drawHuman(far, { ...LOOK, headwear }, { ...pose, detail: false, distant: true }, paint);
    const count = near.counts.reduce((sum, value) => sum + value, 0);
    assert.ok(count > 35 && count < 70);
    assert.ok(far.counts.reduce((sum, value) => sum + value, 0) <= 8);
    const points = [...origins(near, MESH_BOX), ...origins(near, MESH_SPHERE)];
    for (const [x, y, z] of points) {
      assert.ok(Math.abs(x) < 0.95 && Math.abs(z) < 1.1);
      assert.ok(y < 0.1 && y > -2.95);
    }
    const feet = origins(far, MESH_BOX).filter(point => point[1] > -0.9);
    assert.equal(feet.length, 2, "distant people retain both legs");
  }
});

test("idle gestures keep feet planted and recorded poses repeat at a fixed clock", () => {
  const first = record(), later = record(), repeat = record();
  const pose = { time: 12, seed: 5, stride: 0, moving: false, detail: true, talking: true };
  drawHuman(first, LOOK, pose, paint);
  drawHuman(later, LOOK, { ...pose, time: 13 }, paint);
  drawHuman(repeat, LOOK, pose, paint);
  for (const mesh of [MESH_BOX, MESH_SPHERE]) {
    const end = first.counts[mesh] * PROP_STRIDE;
    assert.deepEqual(first.data[mesh].slice(0, end), repeat.data[mesh].slice(0, end));
  }
  assert.deepEqual(first.data[MESH_BOX].slice(0, PROP_STRIDE * 8), later.data[MESH_BOX].slice(0, PROP_STRIDE * 8));
  assert.notDeepEqual(first.data[MESH_BOX].slice(PROP_STRIDE * 8, PROP_STRIDE * first.counts[MESH_BOX]), later.data[MESH_BOX].slice(PROP_STRIDE * 8, PROP_STRIDE * later.counts[MESH_BOX]));
});

test("umbrella shaft and horizontal rim are centred on the canopy", () => {
  const recorder = record(); drawUmbrella(recorder, LOOK.coat, paint, LOOK.light);
  const canopy = origins(recorder, MESH_SPHERE)[0];
  for (const origin of origins(recorder, MESH_BOX)) {
    assert.ok(Math.abs(origin[0] - canopy[0]) < 1e-6 && Math.abs(origin[2] - canopy[2]) < 1e-6);
  }
  const rim = recorder.data[MESH_TORUS];
  assert.ok(Math.abs(rim[0] - UMBRELLA.x) < 1e-6 && Math.abs(rim[2] - UMBRELLA.z) < 1e-6);
  assert.equal(rim[7], 1, "torus Y axis stays upright, keeping its ring horizontal");
  assert.equal(rim[8], 0);
});

test("tyres are four round sidewalls, with no opaque square backing", () => {
  const recorder = record(); drawVehicleTyres(recorder);
  assert.equal(recorder.counts[MESH_BOX], 0);
  assert.equal(recorder.counts[MESH_SPHERE], 4);
  for (let wheel = 0; wheel < 4; wheel++) {
    const offset = wheel * PROP_STRIDE, data = recorder.data[MESH_SPHERE];
    assert.ok(Math.abs(Math.abs(data[offset]) - WHEEL_GEOMETRY.lateral) < 1e-6);
    assert.ok(Math.abs(data[offset + 7] - data[offset + 11]) < 1e-6, "circular YZ sidewall");
    assert.ok(data[offset + 3] < data[offset + 7], "tyre is narrow along its axle");
  }
});

test("rear cabin encloses the lower rear while leaving a view through the rear window", () => {
  const recorder = record(); drawRearCabin(recorder, [50, 135, 175], paint);
  const points = origins(recorder, MESH_BOX);
  assert.ok(points.some(([, height, depth]) => depth > 2 && height < -1.1), "rear deck");
  assert.ok(points.filter(([, height, depth]) => depth > 1 && height < -1.5).length >= 5, "rear headrests and window frame");
  assert.ok(points.some(([, height, depth]) => depth > 1.5 && height > -1.1), "rear bulkhead");
  assert.ok(recorder.counts[MESH_BOX] < 40);
  for (let index = 0; index < recorder.counts[MESH_BOX]; index++) {
    const offset = index * PROP_STRIDE, data = recorder.data[MESH_BOX];
    if (data[offset + 2] > 0.4 && data[offset + 2] < 0.9 && Math.abs(data[offset]) < 0.9) assert.ok(-data[offset + 1] + Math.abs(data[offset + 7]) / 2 < 1.6, "front seats remain below the driver's rearward sightline");
    if (data[offset + 2] > 1.2 && data[offset + 1] < -1.5 && Math.abs(data[offset]) < 0.1) assert.ok(Math.abs(data[offset + 7]) < 0.2, "centre of the rear glass is not an opaque panel");
  }
});
