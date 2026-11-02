import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld, movePlayer, RAIL_SOLIDS, STATION_SITES, type Player } from "../src/city/world.ts";
import { CityInteriors, interiorFixtureLabel, interiorFixtures, interiorLocal, interiorPlaces, interiorWorld, type InteriorPlace } from "../src/city/interiors.ts";
import { CLUB_MOTION, clubWash, drawInterior, drawInteriorEntrances, drawInteriorInteractables, interiorDancers, interiorResidents } from "../src/city/interior-scene.ts";
import { PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import type { InteractableDefinition } from "../src/rpg/types.ts";

const world = new CityWorld();
const places = interiorPlaces(world);
const makePlayer = (): Player => ({ x: 0, z: 78, yaw: 0, pitch: 0, distance: 0 });
const recorder = () => new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);

test("every district has a deterministic, reachable doorway without changing building footprints", () => {
  assert.equal(places.length, 9);
  assert.equal(new Set(places.map(place => place.kind)).size, 9);
  assert.equal(new Set(places.map(place => place.building)).size, 9, "one venue per building");
  assert.deepEqual(places.map(place => place.district), [0, 1, 2, 3, 4, 5, 1, 5, 1]);
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
    // The Static carries a dance floor, a mirror-ball dot field and a crowd: a larger, still bounded budget.
    assert.ok(count > 70 && count < (place.kind === "nightclub" ? 460 : 250), `${place.name}: ${count} primitives`);
    assert.ok(low.counts[0] < full.counts[0]);
    // Effects off drops the motes (and the club's mirror dots and laser beams); the club's low profile
    // also halves its dancers and floor tiles, so there the comparison is against the full budget.
    assert.ok(noEffects.counts[0] < (place.kind === "nightclub" ? full.counts[0] : low.counts[0]));
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

test("Breakwater Noodle opens onto the Rim Line concourse and Halfway Clinic onto the Spillway", () => {
  const noodle = places.find(place => place.id === "breakwater-noodle"), clinic = places.find(place => place.id === "halfway-clinic");
  const rim = STATION_SITES.find(site => site.name === "Neon Breakwater"), loop = STATION_SITES.find(site => site.line === 0 && site.district === 5);
  assert.ok(noodle && clinic && rim && loop);
  assert.equal(noodle.district, 1);
  assert.equal(clinic.district, 5);
  assert.ok(Math.hypot(noodle.entrance.x - rim.x, noodle.entrance.z - rim.z) < 45, "noodle door faces the rim station");
  assert.ok(Math.hypot(clinic.entrance.x - loop.x, clinic.entrance.z - loop.z) < 60, "clinic door is by the Spillway station");
  for (const place of [noodle, clinic]) {
    for (const solid of RAIL_SOLIDS) assert.ok(Math.hypot(solid.x - place.entrance.x, solid.z - place.entrance.z) > solid.half + 3, `${place.id} clear of rail solids`);
    for (const other of places) if (other !== place) assert.ok(Math.hypot(other.entrance.x - place.entrance.x, other.entrance.z - place.entrance.z) > 30);
  }
  const labels = (place: InteriorPlace) => interiorFixtures(place).flatMap(item => interiorFixtureLabel(place, item)?.text ?? []);
  assert.deepEqual(labels(noodle), ["COUNTER", "POTS", "LEDGE"]);
  assert.deepEqual(labels(clinic), ["DESK", "TRIAGE", "VEND", "SCANNER", "BAY"]);
  for (const place of places) assert.ok(labels(place).length >= 3, `${place.id} floorplan is labelled`);
});

test("residents turn toward a close visitor and say a line; a distant visitor changes nothing", () => {
  class RectRecorder extends PropRecorder {
    rectangles = 0;
    override rect(): void { this.rectangles++; }
  }
  const counting = () => new RectRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
  for (const place of places) {
    const fixtures = interiorFixtures(place), alone = counting(), far = counting(), near = counting();
    const [first] = interiorResidents(place);
    drawInterior(alone, place, fixtures, 45, false, false, null, null);
    drawInterior(far, place, fixtures, 45, false, false, null, interiorWorld(place, 0, place.depth / 2 - 1));
    drawInterior(near, place, fixtures, 45, false, false, null, interiorWorld(place, first.x + 1.2, first.z + 0.6));
    assert.deepEqual(far.counts, alone.counts, place.id);
    assert.deepEqual(far.data[0].slice(0, far.counts[0] * PROP_STRIDE), alone.data[0].slice(0, alone.counts[0] * PROP_STRIDE));
    const spoken = first.line.replaceAll(" ", "").length + 1;
    assert.equal(near.rectangles, alone.rectangles + spoken, `${place.id}: a backing plate and one quad per letter`);
    assert.equal(far.rectangles, alone.rectangles);
    assert.ok(near.data[0].slice(0, near.counts[0] * PROP_STRIDE).every(Number.isFinite));
  }
});

test("a visit fades in from the doorway without changing room geometry", () => {
  const interiors = new CityInteriors(world);
  for (const place of places.slice(6)) {
    const player = makePlayer();
    interiors.enter(place, player);
    const visit = recorder(), plain = recorder(), settled = recorder(), still = recorder();
    drawInterior(visit, place, interiors.fixtures, 45, false);
    drawInterior(plain, place, interiorFixtures(place), 45, false, true, null, null);
    assert.deepEqual(visit.counts, plain.counts);
    assert.notDeepEqual(visit.data[0].slice(0, visit.counts[0] * PROP_STRIDE), plain.data[0].slice(0, plain.counts[0] * PROP_STRIDE), "the first frame is dimmed");
    drawInterior(settled, place, interiors.fixtures, 45, false, false);
    // The same viewer in both: residents near the doorway (the club's bouncer) turn toward a visitor, which is attention, not the fade.
    drawInterior(still, place, interiorFixtures(place), 45, false, false, null, player);
    assert.deepEqual(settled.data[0].slice(0, settled.counts[0] * PROP_STRIDE), still.data[0].slice(0, still.counts[0] * PROP_STRIDE), "no fade without effects");
    interiors.leave(player);
  }
});

const club = places.find(place => place.id === "the-static");

test("The Static opens on a Neon Ward street with a lobby, main floor, booths and a reachable green room", () => {
  assert.ok(club);
  assert.equal(club.kind, "nightclub"); assert.equal(club.district, 1); assert.equal(club.name, "The Static");
  assert.ok(world.canOccupy(club.entrance.x, club.entrance.z), "the street doorway is walkable");
  for (const solid of RAIL_SOLIDS) assert.ok(Math.hypot(solid.x - club.entrance.x, solid.z - club.entrance.z) > solid.half + 3, "clear of rail solids");
  for (const other of places) if (other !== club) assert.ok(Math.hypot(other.entrance.x - club.entrance.x, other.entrance.z - club.entrance.z) > 30, other.id);
  const labels = interiorFixtures(club).flatMap(item => interiorFixtureLabel(club, item)?.text ?? []);
  assert.deepEqual([...new Set(labels)].sort(), ["BAR", "BOOTH", "COATS", "DECKS", "GREEN RM"]);
  const interiors = new CityInteriors(world), player = makePlayer();
  interiors.enter(club, player);
  assert.ok(interiors.atExit(player.x, player.z), "arrival stands on the exit strip");
  const free = (x: number, z: number) => { const point = interiorWorld(club, x, z); return interiors.canOccupy(point.x, point.z); };
  // The lobby partition leaves a centre gap; the bar, decks, riser, speakers, booths and sofa are solid.
  assert.ok(free(0, 3.4)); assert.equal(free(-4, 3.4), false); assert.equal(free(4, 3.4), false);
  assert.ok(free(0, -1.6), "the dance floor is open floor");
  for (const [x, z] of [[0, -6.3], [0, -8], [-6.6, -3.4], [-3.4, -6.6], [3.4, -6.6], [8.05, -1.4], [-8.05, 0.2], [6.9, -8.5], [6.9, 6]]) assert.equal(free(x, z), false, `${x}, ${z}`);
  // A continuous walk: door to dance floor, across to the right-hand walkway, down it into the green room.
  for (let z = 6.9; z >= 1; z -= 0.1) assert.ok(free(0, z), `centre line ${z}`);
  for (let x = 0; x <= 6.2; x += 0.1) assert.ok(free(x, 1), `cross ${x}`);
  for (let z = 1; z >= -6.8; z -= 0.1) assert.ok(free(6.2, z), `walkway ${z}`);
  assert.ok(interiorLocal(club, player.x, player.z).z > club.depth / 2 - 3.6);
  interiors.leave(player);
});

test("The Static's light moves slowly: no strobe, no beat flashes, nothing above 0.4 Hz", () => {
  assert.ok(club);
  assert.ok(CLUB_MOTION.washHz * 4 <= 1 / 3, "each colour-to-colour wash takes at least three seconds");
  assert.ok(CLUB_MOTION.mirrorDegreesPerSecond <= 10);
  for (const rate of [CLUB_MOTION.washHz, CLUB_MOTION.laserHz, CLUB_MOTION.glintHz, ...CLUB_MOTION.swayHz]) assert.ok(rate > 0 && rate <= 0.4);
  assert.deepEqual(clubWash(0), clubWash(1)); assert.deepEqual(clubWash(0.25), clubWash(-0.75));
  const dancers = interiorDancers(club);
  assert.ok(dancers.length >= 10 && dancers.length <= 16);
  for (const person of dancers) assert.ok(person.hz > 0 && person.hz <= 0.4);
  assert.deepEqual(interiorDancers(places[0]), []);
  assert.ok(interiorResidents(club).length >= 5, "bouncer, DJ, bartender and a couple in a booth");
  // Frame to frame at 30 fps for twenty seconds, no colour moves by 2% and nothing jumps.
  const fixtures = interiorFixtures(club);
  let previous: PropRecorder | null = null, largestInk = 0, largestMove = 0;
  for (let frame = 0; frame <= 600; frame++) {
    const canvas = recorder();
    drawInterior(canvas, club, fixtures, 30 + frame / 30, false, false, null, null);
    if (previous) for (let mesh = 0; mesh < canvas.data.length; mesh++) {
      assert.equal(canvas.counts[mesh], previous.counts[mesh]);
      for (let offset = 0; offset < canvas.counts[mesh] * PROP_STRIDE; offset += PROP_STRIDE) {
        for (let k = 0; k < 3; k++) largestMove = Math.max(largestMove, Math.abs(canvas.data[mesh][offset + k] - previous.data[mesh][offset + k]));
        for (let k = 12; k < 16; k++) largestInk = Math.max(largestInk, Math.abs(canvas.data[mesh][offset + k] - previous.data[mesh][offset + k]));
      }
    }
    previous = canvas;
  }
  assert.ok(largestInk < 0.02, `largest colour step ${largestInk}`);
  assert.ok(largestMove < 0.12, `largest per-frame move ${largestMove} m`);
});
