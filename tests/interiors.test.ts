import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld, movePlayer, type Player } from "../src/city/world.ts";
import { CityInteriors, interiorFixtures, interiorLocal, interiorPlaces, interiorWorld } from "../src/city/interiors.ts";
import { drawInterior, drawInteriorEntrances, drawInteriorInteractables } from "../src/city/interior-scene.ts";
import { PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import type { InteractableDefinition } from "../src/rpg/types.ts";

const world = new CityWorld();
const places = interiorPlaces(world);
const makePlayer = (): Player => ({ x: 0, z: 78, yaw: 0, pitch: 0, distance: 0 });
const recorder = () => new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);

test("every district has a deterministic, reachable doorway without changing building footprints", () => {
  assert.equal(places.length, 6);
  assert.equal(new Set(places.map(place => place.kind)).size, 6);
  assert.deepEqual(places.map(place => place.district), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(places, interiorPlaces(new CityWorld()));
  assert.equal(places, interiorPlaces(world));
  for (const place of places) {
    assert.ok(world.canOccupy(place.entrance.x, place.entrance.z), place.name);
    assert.equal(world.canOccupy(place.x, place.z), false, "building remains solid outside");
    assert.ok(Math.hypot(place.entrance.x - place.x, place.entrance.z - place.z) < 15);
  }
  assert.ok(Math.hypot(places[4].entrance.x, places[4].entrance.z - 78) < 65, "first interior is near spawn");
});

test("enter, walk, save and exit use the right collision space for both doorway orientations", () => {
  const interiors = new CityInteriors(world);
  for (const place of places) {
    const player = makePlayer();
    assert.equal(interiors.nearby(place.entrance.x, place.entrance.z)?.id, place.id);
    interiors.enter(place, player);
    assert.ok(interiors.canOccupy(player.x, player.z));
    assert.ok(interiors.atExit(player.x, player.z));
    assert.deepEqual(interiors.outdoorPose(player), place.entrance);
    for (let frame = 0; frame < 180; frame++) movePlayer(interiors, player, 1, 0, true, 1 / 60);
    assert.ok(interiors.canOccupy(player.x, player.z), "sprinting stops before the counter");
    assert.ok(interiorLocal(place, player.x, player.z).z < place.depth / 2 - 4, "can walk into room");
    assert.equal(interiors.atExit(player.x, player.z), false);
    for (let frame = 0; frame < 180; frame++) movePlayer(interiors, player, -1, 0, true, 1 / 60);
    assert.ok(interiors.atExit(player.x, player.z), "entrance remains reachable");
    assert.ok(interiors.canOccupy(player.x, player.z));
    interiors.leave(player);
    assert.equal(interiors.active, null);
    assert.equal(interiors.fixtures.length, 0, "room geometry data is released");
    assert.ok(world.canOccupy(player.x, player.z));
    assert.deepEqual({ x: player.x, z: player.z }, { x: place.entrance.x, z: place.entrance.z });
    assert.equal(interiors.outdoorPose(player), player);
  }
});

test("room walls and furniture block long frames and angled movement without trapping the player", () => {
  const interiors = new CityInteriors(world);
  for (const place of places) {
    const player = makePlayer(); interiors.enter(place, player);
    for (const fixture of interiors.fixtures) {
      const centre = interiorWorld(place, fixture.x, fixture.z);
      assert.equal(interiors.canOccupy(centre.x, centre.z), false);
    }
    assert.equal(interiors.canOccupy(NaN, player.z), false);
    for (let frame = 0; frame < 720; frame++) {
      player.yaw = place.yaw + frame / 80;
      movePlayer(interiors, player, 1, Math.sin(frame / 30), true, frame % 5 ? 1 / 60 : 0.15);
      assert.ok(interiors.canOccupy(player.x, player.z), `${place.name}: frame ${frame}`);
    }
    const outside = interiorWorld(place, place.width, place.depth);
    assert.equal(interiors.canOccupy(outside.x, outside.z), false);
    const point = interiorWorld(place, 1.2, -2.3);
    const roundTrip = interiorLocal(place, point.x, point.z);
    assert.ok(Math.abs(roundTrip.x - 1.2) < 1e-10 && Math.abs(roundTrip.z + 2.3) < 1e-10);
  }
});

test("room scenes have bounded geometry, deterministic VFX and reduced detail budgets", () => {
  for (const place of places) {
    const full = recorder(), repeated = recorder(), low = recorder(), noEffects = recorder();
    const fixtures = interiorFixtures(place);
    drawInterior(full, place, fixtures, 45, false);
    drawInterior(repeated, place, fixtures, 45, false);
    drawInterior(low, place, fixtures, 45, true);
    drawInterior(noEffects, place, fixtures, 45, false, false);
    const count = full.counts.reduce((sum, value) => sum + value, 0);
    assert.ok(count > 70 && count < 250, `${place.name}: ${count} primitives`);
    assert.ok(low.counts[0] < full.counts[0]);
    assert.ok(noEffects.counts[0] < low.counts[0]);
    for (let mesh = 0; mesh < full.data.length; mesh++) {
      const end = full.counts[mesh] * PROP_STRIDE;
      assert.deepEqual(full.data[mesh].slice(0, end), repeated.data[mesh].slice(0, end));
      assert.ok(full.data[mesh].slice(0, end).every(Number.isFinite));
    }
  }
});

test("unseen or distant doorways do not generate geometry", () => {
  const far = recorder(), hidden = recorder(), close = recorder();
  drawInteriorEntrances(far, places, { x: 10000, z: 10000 }, () => true);
  drawInteriorEntrances(hidden, places, places[4].entrance, () => false);
  drawInteriorEntrances(close, places, places[4].entrance, () => true);
  assert.equal(far.counts.reduce((sum, value) => sum + value, 0), 0);
  assert.equal(hidden.counts.reduce((sum, value) => sum + value, 0), 0);
  assert.ok(close.counts[0] > 0 && close.counts[0] < 65);
});

test("interior USE panels keep a bounded geometry budget and preserve room-space placement", () => {
  class PanelRecorder extends PropRecorder {
    rectangles = 0;
    override rect(width = 1, height = 1): void { this.rectangles++; super.box(width, height, 0.001); }
  }
  const panelRecorder = () => new PanelRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
  for (const place of places) {
    const items: readonly InteractableDefinition[] = [
      { id: "use", label: "Use terminal", place: place.id, ...interiorWorld(place, -3, -2), glyph: ">", y: 2.6 },
      { id: "default", label: "Default terminal", place: place.id, ...interiorWorld(place, 0, -2) },
      { id: "symbol", label: "Marked terminal", place: place.id, ...interiorWorld(place, 3, -2), glyph: "+", y: 1.8 },
    ];
    const first = panelRecorder(), repeated = panelRecorder(), empty = panelRecorder();
    drawInteriorInteractables(first, place, items);
    drawInteriorInteractables(repeated, place, items);
    drawInteriorInteractables(empty, place, []);
    assert.deepEqual(empty.counts, [0, 0, 0]);
    assert.equal(empty.rectangles, 0);
    assert.equal(first.rectangles, 7, "USE fallback and custom symbols stay bounded to their actual glyph count");
    assert.deepEqual(first.counts, [13, 0, 0], "two solid pieces and at most three letter quads per terminal");
    const end = first.counts[0] * PROP_STRIDE;
    assert.deepEqual(first.data[0].slice(0, end), repeated.data[0].slice(0, end));
    assert.ok(first.data[0].slice(0, end).every(Number.isFinite));
    for (const [index, firstPrimitive] of [0, 5, 10].entries()) {
      const offset = firstPrimitive * PROP_STRIDE, item = items[index], height = item.y ?? 2.4;
      assert.ok(Math.abs(first.data[0][offset] - item.x) < 0.0001);
      assert.ok(Math.abs(first.data[0][offset + 1] + height) < 0.0001);
      assert.ok(Math.abs(first.data[0][offset + 2] - item.z) < 0.0001);
      const letters = index < 2 ? "USE" : "+";
      for (let letter = 0; letter < letters.length; letter++) {
        const glyph = offset + (letter + 1) * PROP_STRIDE;
        assert.equal(Math.round(first.data[0][glyph + 16] * 255), letters.charCodeAt(letter));
        assert.equal(first.data[0][glyph + 17], 1, "the interior shader receives the bitmap-letter mask");
        const local = interiorLocal(place, first.data[0][glyph], first.data[0][glyph + 2]);
        const centre = interiorLocal(place, item.x, item.z);
        assert.ok(Math.abs(local.x - centre.x) < 0.5 && Math.abs(local.z - centre.z - 0.09) < 0.0001);
      }
    }
    first.box(1, 1, 1);
    assert.deepEqual(Array.from(first.data[0].slice(end, end + 3)), [0, 0, 0], "terminal transforms do not leak into the next draw");
  }
});
