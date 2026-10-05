import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { MESH_BOX, MESH_SPHERE, PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import { BLOCK_SIZE, CityWorld, HALF_BLOCKS, LANDMARKS, PLAYER_RADIUS, blockKey, streetLamp, type Building, type RGB } from "../src/city/world.ts";
import { drawLandmarkStructure, landmarkLabels, type LandmarkPaint } from "../src/city/landmarks-scene.ts";
import { blockHasPlots, cableSpans, drawSignalPost, drawStreetLife, type StreetKit } from "../src/city/street-life.ts";

// signage.ts imports activity.ts without extensions (the bundler resolves them); resolve them here.
register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { drawShop } = await import("../src/city/signage.ts");

const paint: LandmarkPaint = (canvas, color, glyph, gain = 1) => { canvas.char(glyph); canvas.charColor(color[0] * gain, color[1] * gain, color[2] * gain); canvas.cellColor(0, 0, 0); };
const kit: StreetKit = { paint, range: () => 255, restore: () => undefined };
const record = () => new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
const total = (recorder: PropRecorder) => recorder.counts.reduce((sum, count) => sum + count, 0);
const packed = (recorder: PropRecorder) => recorder.data.map((data, mesh) => Array.from(data.slice(0, recorder.counts[mesh] * PROP_STRIDE)));
const world = new CityWorld();

interface Bounds { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
/** World-space boxes around every box and ellipsoid instance (heights up; the recorder stores textmode's Y-down). */
function bounds(recorder: PropRecorder): Bounds[] {
  const out: Bounds[] = [];
  for (const mesh of [MESH_BOX, MESH_SPHERE]) {
    const data = recorder.data[mesh], scale = mesh === MESH_BOX ? 0.5 : 1;
    for (let i = 0; i < recorder.counts[mesh]; i++) {
      const o = i * PROP_STRIDE;
      const half = [0, 1, 2].map(c => scale * (Math.abs(data[o + 3 + c]) + Math.abs(data[o + 6 + c]) + Math.abs(data[o + 9 + c])));
      const x = data[o], y = -data[o + 1], z = data[o + 2];
      out.push({ x0: x - half[0], x1: x + half[0], y0: y - half[1], y1: y + half[1], z0: z - half[2], z1: z + half[2] });
    }
  }
  return out;
}
const hasInk = (recorder: PropRecorder, color: RGB) => recorder.data.some((data, mesh) => Array.from({ length: recorder.counts[mesh] }, (_, i) => i * PROP_STRIDE).some(o => color.every((channel, c) => Math.abs(data[o + 12 + c] - channel / 255) < 1e-6)));

test("landmark titles are letter panels of at most 16 letters, facing out and big enough to read", () => {
  for (const landmark of LANDMARKS) {
    const faces = landmarkLabels(landmark);
    assert.ok(faces.length >= 2, landmark.id);
    for (const face of faces) {
      assert.ok(face.text.length > 0 && face.text.length <= 16, face.text);
      const angle = face.yaw * Math.PI / 180;
      assert.ok((face.x - landmark.x) * Math.sin(angle) + (face.z - landmark.z) * Math.cos(angle) > 0, `${landmark.id}: "${face.text}" faces outward`);
      assert.ok(face.width / face.text.length >= 0.5 && face.height >= 1.5, `${landmark.id}: "${face.text}" letters are readable`);
    }
  }
});

test("landmark structures add detail with proximity within a bounded instance budget", () => {
  for (const landmark of LANDMARKS) {
    const counts = ([0, 1, 2] as const).map(detail => { const recorder = record(); drawLandmarkStructure(recorder, landmark, 12, detail, paint); return total(recorder); });
    assert.ok(counts[0] > 10 && counts[0] <= counts[1] && counts[1] <= counts[2], `${landmark.id}: ${counts.join(" / ")}`);
    assert.ok(counts[2] < 500, `${landmark.id}: ${counts[2]} instances close up`);
    const recorder = record(); drawLandmarkStructure(recorder, landmark, 12, 2, paint);
    for (const data of packed(recorder)) assert.ok(data.every(Number.isFinite), `${landmark.id}: finite geometry`);
  }
});

test("landmark parts at walking height stay inside the landmark's collision footprint", () => {
  const solid = (b: Bounds) => b.y0 < 2.2 && b.y1 > 0.6 && Math.max(b.x1 - b.x0, b.z1 - b.z0) > 0.5;
  for (const landmark of LANDMARKS) {
    if (landmark.kind === "garden") continue; // the trunk's collision is +-4 m; its low roots are underfoot
    const recorder = record(); drawLandmarkStructure(recorder, landmark, 12, 2, paint);
    for (const b of bounds(recorder).filter(solid)) {
      if (landmark.kind === "gate") {
        const post = Math.min(Math.abs((b.x0 + b.x1) / 2 - 10), Math.abs((b.x0 + b.x1) / 2 + 10));
        assert.ok(post + (b.x1 - b.x0) / 2 <= 2.6 + 1e-3 && Math.max(Math.abs(b.z0 - landmark.z), Math.abs(b.z1 - landmark.z)) <= 2.6 + 1e-3, `gate part at x ${b.x0.toFixed(2)}..${b.x1.toFixed(2)}`);
        continue;
      }
      const reach = landmark.kind === "spire" ? 14 : 12;
      for (const value of [b.x0 - landmark.x, b.x1 - landmark.x, b.z0 - landmark.z, b.z1 - landmark.z]) assert.ok(Math.abs(value) <= reach + 1e-3, `${landmark.id}: part reaches ${value.toFixed(2)} m out at ${b.y0.toFixed(1)}-${b.y1.toFixed(1)} m`);
    }
  }
});

test("street life hangs above head height or stays underfoot, deterministically", () => {
  for (const [x, z] of [[-60, 150], [20, -70], [400, 300], [-400, -200], [-200, 100]]) {
    const view = { x, z, time: 37, low: false };
    const first = record(), second = record();
    drawStreetLife(first, view, kit); drawStreetLife(second, view, kit);
    assert.deepEqual(packed(first), packed(second));
    assert.ok(total(first) > 0, `${x},${z}: something drawn`);
    for (const b of bounds(first)) assert.ok(b.y0 >= 2.95 || b.y1 <= 0.5, `${x},${z}: a prop at head height (${b.y0.toFixed(2)}-${b.y1.toFixed(2)} m)`);
  }
});

test("block plots match the world and every cable ends inside a building at both ends", () => {
  const inside = (x: number, z: number) => world.nearbyBlocks(x, z, 1).some(block => block.buildings.some(b => Math.abs(x - b.x) < b.width / 2 && Math.abs(z - b.z) < b.depth / 2));
  let cables = 0;
  for (let bz = -HALF_BLOCKS; bz < HALF_BLOCKS; bz++) for (let bx = -HALF_BLOCKS; bx < HALF_BLOCKS; bx++) {
    assert.equal(blockHasPlots(bx, bz), world.blocks.get(blockKey(bx, bz))?.buildings.length === 4, `block ${bx},${bz}`);
    for (const span of cableSpans(bx, bz)) {
      cables++;
      assert.ok(inside(span.ax, span.az) && inside(span.ex, span.ez), `cable ${span.ax.toFixed(1)},${span.az.toFixed(1)} -> ${span.ex.toFixed(1)},${span.ez.toFixed(1)}`);
      assert.ok(span.y - span.sag > 5, "cables hang high");
    }
  }
  assert.ok(cables > 400, `${cables} cables`);
  assert.equal(BLOCK_SIZE, 64);
});

test("corner signals show amber for the last 2.5 s of each green and walk signals close up", () => {
  const lamp = streetLamp(2, 3);
  const at = (time: number, near = true) => { const recorder = record(); drawSignalPost(recorder, lamp, time, near ? 20 : 120, kit); return recorder; };
  const AMBER: RGB = [255, 190, 70], GREEN: RGB = [88, 255, 163], RED: RGB = [255, 78, 91];
  assert.ok(hasInk(at(5), GREEN) && hasInk(at(5), RED) && !hasInk(at(5), AMBER), "z green, x red");
  assert.ok(hasInk(at(9.5), AMBER) && !hasInk(at(9.5), GREEN), "z amber");
  assert.ok(hasInk(at(12.5), RED) && !hasInk(at(12.5), GREEN) && !hasInk(at(12.5), AMBER), "all red");
  assert.ok(hasInk(at(23), AMBER) && hasInk(at(23), RED), "x amber");
  assert.ok(total(at(5, false)) < total(at(5)), "walk signals and blades only close up");
  for (const b of bounds(at(5))) {
    const onPost = b.x0 >= lamp.postX - 0.33 && b.x1 <= lamp.postX + 0.33 && b.z0 >= lamp.z - 0.36 && b.z1 <= lamp.z + 0.36;
    assert.ok(onPost || b.y0 >= 3.2, `signal part off the post below 3.2 m: ${b.y0.toFixed(2)} m`);
  }
});

test("shopfront clutter at street level stays within the building's collision skin", () => {
  for (const [id, district] of [[3, 4], [4, 3], [6, 0], [7, 1], [9, 2], [10, 5], [12, 4]] as const) {
    const building: Building = { id, x: 19, z: 19, width: 18, depth: 16, height: 60, district, style: 0, sign: "KAI RAMEN", accent: [48, 211, 218] };
    const face = building.z - building.depth / 2, eye = { x: 19, z: 2 };
    for (const distance of [17, 90, 200]) {
      const recorder = record(); drawShop(recorder, building, distance, eye, () => true, 360);
      assert.ok(total(recorder) > 0);
      for (const b of bounds(recorder)) {
        if (b.y0 >= 3.0 || b.y1 <= 0.5 || Math.max(b.x1 - b.x0, b.z1 - b.z0) < 0.5) continue; // overhead, underfoot or small
        assert.ok(b.z0 >= face - PLAYER_RADIUS - 1e-3, `building ${id} at ${distance} m: a ${(b.y1 - b.y0).toFixed(2)} m part reaches ${(face - b.z0).toFixed(2)} m from the face`);
      }
    }
  }
});
