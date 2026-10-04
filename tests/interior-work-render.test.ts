import assert from "node:assert/strict";
import test from "node:test";
import { drawInterior, drawInteriorInteractables, drawInteriorWork } from "../src/city/interior-scene.ts";
import { INTERIOR_HEIGHT, interiorFixtures, interiorLocal, interiorPlaces, type InteriorPlace } from "../src/city/interiors.ts";
import { interiorWorkState, type InteriorWorkState } from "../src/city/interior-work-state.ts";
import { miniFontBytes } from "../src/city/mini-font.ts";
import { PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import { CityWorld } from "../src/city/world.ts";
import { DEAD_LETTER_STATIONS } from "../src/rpg/content/dead-letter.ts";
import { GLASSHOUSE_STATIONS } from "../src/rpg/content/glasshouse.ts";
import { KILN_WORKBENCH } from "../src/rpg/content/kiln-workbench.ts";
import type { FlagValue, QuestStatus } from "../src/rpg/types.ts";

class SceneRecorder extends PropRecorder {
  rectangles = 0;
  boxes = 0;
  override rect(width = 1, height = 1): void { this.rectangles++; super.box(width, height, 0.001); }
  override box(width = 1, height = width, depth = height): void { this.boxes++; super.box(width, height, depth); }
}

const places = interiorPlaces(new CityWorld()), font = miniFontBytes();
const recorder = () => new SceneRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
const objects = (place: InteriorPlace) => place.id === "glasshouse" ? Object.values(GLASSHOUSE_STATIONS) : place.id === "kiln" ? [KILN_WORKBENCH] : Object.values(DEAD_LETTER_STATIONS);
const data = (canvas: SceneRecorder, mesh = 0) => canvas.data[mesh].slice(0, canvas.counts[mesh] * PROP_STRIDE);

function state(place: string, flags: Readonly<Record<string, FlagValue>> = {}, status: QuestStatus = "active", stage: string | null = null): InteriorWorkState {
  const result = interiorWorkState(place, { flags: { get: key => flags[key] }, status: () => status, stage: () => stage });
  assert.ok(result);
  return result;
}

const left = { "a-little-night.left-tray": "drain-left" }, right = { "a-little-night.right-tray": "seat-wick" };
const earth = { "kiln-calibration.earth-bond": "bond-earth" }, supply = { "kiln-calibration.aux-feed": "aux-feed" }, load = { "kiln-calibration.test-load": "dummy-load" };
const variants = [
  state("glasshouse"), state("glasshouse", left), state("glasshouse", right), state("glasshouse", { ...left, ...right }),
  state("glasshouse", { ...left, ...right, "glasshouse.nursery-tended": true }, "complete"),
  state("kiln"), state("kiln", earth), state("kiln", { ...earth, ...supply }), state("kiln", { ...earth, ...supply, ...load }),
  state("kiln", { ...earth, ...supply, ...load, "kiln.bench-certified": true }, "complete"),
  state("dead-letter"), state("dead-letter", { "last-good-signal.venue-route": "route-glasshouse" }, "active", "publish"),
  state("dead-letter", { "dead-letter.publication": "anonymous" }, "complete"), state("dead-letter", { "dead-letter.publication": "callback" }, "complete"),
];

test("work labels use supported finite quads within fixed full and low geometry budgets", () => {
  for (const work of variants) for (const low of [false, true]) {
    const place = places.find(venue => venue.id === work.place);
    assert.ok(place);
    const fixtures = interiorFixtures(place), before = JSON.stringify(fixtures), canvas = recorder(), repeated = recorder();
    drawInteriorWork(canvas, place, fixtures, work, low); drawInteriorWork(repeated, place, fixtures, work, low);
    assert.equal(JSON.stringify(fixtures), before);
    assert.equal(canvas.boxes, 0);
    assert.equal(canvas.rectangles, canvas.counts[0]);
    assert.deepEqual(canvas.counts.slice(1), [0, 0]);
    assert.ok(canvas.counts[0] > 0 && canvas.counts[0] <= (low ? 15 : 21), `${work.place}: ${canvas.counts[0]}`);
    assert.deepEqual(data(canvas), data(repeated));
    assert.ok(data(canvas).every(Number.isFinite));
    let letters = "";
    for (let primitive = 0; primitive < canvas.counts[0]; primitive++) {
      const offset = primitive * PROP_STRIDE, local = interiorLocal(place, canvas.data[0][offset], canvas.data[0][offset + 2]);
      const halfWidth = Math.hypot(canvas.data[0][offset + 3], canvas.data[0][offset + 5]) / 2;
      const halfDepth = Math.hypot(canvas.data[0][offset + 9], canvas.data[0][offset + 11]) / 2;
      const height = -canvas.data[0][offset + 1], halfHeight = Math.abs(canvas.data[0][offset + 7]) / 2;
      assert.ok(Math.abs(local.x) + halfWidth < place.width / 2);
      assert.ok(Math.abs(local.z) + halfDepth < place.depth / 2);
      assert.ok(height - halfHeight > 0 && height + halfHeight < INTERIOR_HEIGHT);
      if (canvas.data[0][offset + 17] > 0.5) {
        const code = Math.round(canvas.data[0][offset + 16] * 255);
        letters += String.fromCharCode(code);
        assert.ok(code >= 33 && code < 127);
        assert.notEqual(font[(code - 32) * 2] | (font[(code - 32) * 2 + 1] << 8), 0);
      }
      for (const object of objects(place)) {
        const panel = interiorLocal(place, object.x, object.z);
        const coversPanel = Math.abs(local.x - panel.x) < halfWidth + 0.825 && Math.abs(height - (object.y ?? 2.4)) < halfHeight + 0.475;
        if (coversPanel) assert.ok(local.z + halfDepth < panel.z + 0.075, "mounts stay behind USE panels and all lettering stays above them");
      }
    }
    assert.equal(letters, work.tags.map(mark => (low ? mark.compact : mark.text) + (mark.detail ?? "")).join(""));
    canvas.box(1, 1, 1);
    const offset = (canvas.counts[0] - 1) * PROP_STRIDE;
    assert.deepEqual(Array.from(canvas.data[0].slice(offset, offset + 3)), [0, 0, 0]);
  }
});

test("missing, stale-room and unsupported-fixture work creates no geometry", () => {
  for (const place of places) {
    const empty = recorder(), stale = recorder(), absent = recorder(), work = state(place.id === "glasshouse" ? "kiln" : "glasshouse");
    drawInteriorWork(empty, place, interiorFixtures(place), null, false);
    drawInteriorWork(stale, place, interiorFixtures(place), work, false);
    drawInteriorWork(absent, place, [], { place: "glasshouse", tags: state("glasshouse").tags }, true);
    for (const canvas of [empty, stale, absent]) assert.deepEqual(canvas.counts, [0, 0, 0]);
  }
});

test("work is static with effects disabled and never changes existing room or USE geometry", () => {
  for (const work of variants.filter(variant => variant.tags.some(mark => mark.settled))) for (const low of [false, true]) {
    const place = places.find(venue => venue.id === work.place);
    assert.ok(place);
    const fixtures = interiorFixtures(place), plain = recorder(), decorated = recorder(), added = recorder();
    drawInterior(plain, place, fixtures, 45, low, false);
    drawInterior(decorated, place, fixtures, 45, low, false, work);
    drawInteriorWork(added, place, fixtures, work, low);
    for (let mesh = 0; mesh < plain.data.length; mesh++) {
      assert.equal(decorated.counts[mesh], plain.counts[mesh] + added.counts[mesh]);
      assert.deepEqual(data(decorated, mesh).slice(0, plain.counts[mesh] * PROP_STRIDE), data(plain, mesh));
      assert.deepEqual(data(decorated, mesh).slice(plain.counts[mesh] * PROP_STRIDE), data(added, mesh));
    }
    const later = recorder();
    drawInterior(later, place, fixtures, 120, low, false, work);
    assert.deepEqual(data(later).slice(-added.counts[0] * PROP_STRIDE), data(added));
    const panels = recorder(), together = recorder();
    drawInteriorInteractables(panels, place, objects(place));
    drawInteriorWork(together, place, fixtures, work, low);
    drawInteriorInteractables(together, place, objects(place));
    assert.deepEqual(data(together).slice(added.counts[0] * PROP_STRIDE), data(panels));
  }
});
