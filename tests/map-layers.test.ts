import assert from "node:assert/strict";
import test from "node:test";
import { COMFORT_HZ, EVENT_OFFSET, activeEvents, eventSite, eventSlot, satelliteSlot } from "../src/city/city-events.ts";
import { HARBOUR_REACH, harbourZone } from "../src/city/harbour.ts";
import { interiorPlaces } from "../src/city/interiors.ts";
import { CityWorld, LANDMARKS, SIGHTS, STATION_SITES } from "../src/city/world.ts";
import { EVENT_BREATH_HZ, EVENT_CHEVRON_RANGE, EVENT_INK, drawEventLayer, eventBreath, mapEvents, type MapEvent } from "../src/components/event-map-layer.ts";
import { WALL_INNER, WALL_OUTER, harbourCode, sightCode, waterGlyph, wallGlyph } from "../src/components/harbour-map-layer.ts";
import type { QuestSnapshot } from "../src/city/quests.ts";
import { drawQuestLayer, type QuestLayerView } from "../src/components/quest-map-layer.ts";
import {
  MAP_LANDMARK, MAP_LANDMARK_SPAN, MAP_OUTSIDE, MAP_PLATFORM, MAP_PLATFORM_SPAN, MAP_QUAY, MAP_SIGHT, MAP_SIGHT_SPAN, MAP_STREET,
  MAP_WALL_CORNER, MAP_WALL_H, MAP_WALL_V, MAP_WATER, RAIL_DOWN, RAIL_H, RAIL_UP, RAIL_V, RIM_CODE, codeIndex, isRailCode, railCode,
} from "../src/components/rail-map-codes.ts";
import { CLUB_INK, drawVenueLayer } from "../src/components/venue-map-layer.ts";
import { LabelSpace, monoWidth } from "../src/components/world-map-labels.ts";

class Recorder {
  fillStyle = "";
  strokeStyle = "";
  font = "";
  lineWidth = 1;
  lineJoin = "miter";
  globalAlpha = 1;
  textAlign: CanvasTextAlign = "center";
  textBaseline: CanvasTextBaseline = "top";
  readonly calls: { name: string; values: (number | string)[]; alpha: number }[] = [];
  private push(name: string, values: (number | string)[]) { this.calls.push({ name, values, alpha: this.globalAlpha }); }
  save() { this.push("save", []); }
  restore() { this.push("restore", []); }
  beginPath() { this.push("beginPath", []); }
  closePath() { this.push("closePath", []); }
  fill() { this.push("fill", [this.fillStyle]); }
  stroke() { this.push("stroke", [this.strokeStyle]); }
  fillRect(...values: number[]) { this.push("fillRect", values); }
  moveTo(...values: number[]) { this.push("moveTo", values); }
  lineTo(...values: number[]) { this.push("lineTo", values); }
  arc(...values: number[]) { this.push("arc", values); }
  translate(...values: number[]) { this.push("translate", values); }
  rotate(...values: number[]) { this.push("rotate", values); }
  fillText(...values: (number | string)[]) { this.push("fillText", values); }
  strokeText(...values: (number | string)[]) { this.push("strokeText", values); }
  context(): CanvasRenderingContext2D { return this as unknown as CanvasRenderingContext2D; }
  count(name: string): number { return this.calls.filter(call => call.name === name).length; }
}

/** A 320 px minimap centred on (cx, cz) showing +-124 m, like city-map.tsx. */
function minimap(cx: number, cz: number, full = false): QuestLayerView {
  const size = 320, extent = 124, scale = size / (extent * 2);
  return { px: x => size / 2 + (x - cx) * scale, pz: z => size / 2 + (z - cz) * scale, size, extent, centerX: cx, centerZ: cz, full };
}
const event = (x: number, z: number): MapEvent => ({ id: 2, kind: "drones", x, z, label: "Drone show", title: "Drone light show", level: 1, remaining: 30 });

test("map cell codes never collide: rail, harbour, platforms, landmarks and sights each own their range", () => {
  const loop = [RAIL_H, RAIL_V, RAIL_DOWN, RAIL_UP];
  const fixed = [MAP_OUTSIDE, MAP_STREET, ...loop, ...loop.map(code => code + RIM_CODE), MAP_QUAY, MAP_WALL_H, MAP_WALL_V, MAP_WALL_CORNER, MAP_WATER];
  assert.equal(new Set(fixed).size, fixed.length, "fixed codes are distinct");
  assert.ok(fixed.every(code => code < 0), "buildings own every code >= 0");
  assert.ok(STATION_SITES.length <= MAP_PLATFORM_SPAN && LANDMARKS.length <= MAP_LANDMARK_SPAN && SIGHTS.length <= MAP_SIGHT_SPAN);
  const ranges = [[MAP_PLATFORM, MAP_PLATFORM_SPAN], [MAP_LANDMARK, MAP_LANDMARK_SPAN], [MAP_SIGHT, MAP_SIGHT_SPAN]] as const;
  for (const [base, span] of ranges) {
    for (const code of fixed) assert.equal(codeIndex(code, base, span), -1, `${code} is outside the range at ${base}`);
    for (const [otherBase, otherSpan] of ranges) {
      if (otherBase === base) continue;
      assert.equal(codeIndex(base, otherBase, otherSpan), -1);
      assert.equal(codeIndex(base - span + 1, otherBase, otherSpan), -1);
    }
    for (const index of [0, 1, span - 1]) assert.equal(codeIndex(base - index, base, span), index);
  }
  for (const code of [MAP_QUAY, MAP_WALL_H, MAP_WALL_V, MAP_WALL_CORNER, MAP_WATER, MAP_OUTSIDE, MAP_STREET]) assert.equal(isRailCode(code), false);
  for (const code of fixed.slice(2, 10)) assert.equal(isRailCode(code), true);
  // The Rim Line still classifies as rail out on the city edge, where the harbour begins.
  assert.ok(isRailCode(railCode(768, 0, 3, 3, 3)));
});

test("water cells lie wholly outside the quay and the flood wall reads as one unbroken line", () => {
  assert.equal(harbourCode(0, 0, 4, 6), 0, "the city is not harbour");
  assert.equal(harbourCode(770, 0, 0.5, 0.5), 0, "the Rim Road up to its kerb is city");
  assert.equal(harbourCode(785, 10, 0.5, 0.5), MAP_QUAY);
  assert.equal(harbourCode(-1200, 300, 4, 6), MAP_WATER);
  assert.equal(harbourCode(HARBOUR_REACH + 10, 0, 4, 6), MAP_OUTSIDE);
  for (const [halfW, halfH] of [[0.45, 0.65], [2, 3], [8, 12], [20, 30]]) {
    for (let x = -1100; x <= 1100; x += 3.7) for (let z = -1100; z <= 1100; z += 5.3) {
      const code = harbourCode(x, z, halfW, halfH);
      const ax = Math.abs(x), az = Math.abs(z);
      if (code === MAP_WATER) assert.ok(ax - halfW >= WALL_OUTER || az - halfH >= WALL_OUTER, `water at ${x}, ${z} overlaps the quay or wall`);
      if (code === MAP_QUAY) { assert.equal(harbourZone(x, z), "quay"); assert.ok(Math.max(ax, az) < WALL_INNER); }
    }
    // Walking along each side just past the wall's inner face, every cell is wall.
    const reach = 760 - Math.max(halfW, halfH); // clear of the corners, where the two sides meet
    for (let along = -reach; along <= reach; along += halfH) {
      assert.equal(harbourCode(WALL_INNER + 1, along, halfW, halfH), MAP_WALL_V, `east wall at ${along} (${halfW} m cells)`);
      assert.equal(harbourCode(along, -(WALL_INNER + 1), halfW, halfH), MAP_WALL_H, `north wall at ${along}`);
    }
    assert.equal(harbourCode(WALL_INNER + 1, WALL_INNER + 1, halfW, halfH), MAP_WALL_CORNER);
  }
  assert.equal(wallGlyph(MAP_WALL_CORNER, -900, -900), "┌");
  assert.equal(wallGlyph(MAP_WALL_CORNER, 900, 900), "┘");
});

test("the water texture is static, sparse and only swell glyphs", () => {
  let marked = 0;
  for (let i = -60; i < 60; i++) for (let j = -60; j < 60; j++) {
    const glyph = waterGlyph(i, j);
    assert.ok(["", "-", "~"].includes(glyph));
    assert.equal(glyph, waterGlyph(i, j));
    if (glyph) marked++;
  }
  const share = marked / (120 * 120);
  assert.ok(share > 0.03 && share < 0.3, `swell glyphs cover ${share}`);
});

test("every edge sight claims its footprint, thin ones at least a column of cells", () => {
  for (const [index, sight] of SIGHTS.entries()) {
    assert.equal(sightCode(sight.x, sight.z, 0.5, 0.5), MAP_SIGHT - index, sight.id);
    assert.equal(harbourCode(sight.x, sight.z, 0.5, 0.5) !== 0, true, `${sight.id} stands on the harbour`);
  }
  assert.equal(sightCode(0, 0, 8, 12), 0);
  const thin = { id: "t", name: "Thin", description: "", x: -830, z: 0, halfX: 2, halfZ: 100, color: [1, 2, 3] as [number, number, number], kind: "cableway" as const };
  assert.equal(sightCode(-830 + 6, 0, 8, 12, [thin]), MAP_SIGHT, "a 4 m wide footprint still fills a 16 m cell");
  assert.equal(sightCode(-830 + 6, 0, 0.5, 0.5, [thin]), 0);
});

test("event markers appear only while a ground happening is running, never for the satellite", () => {
  assert.deepEqual(mapEvents(EVENT_OFFSET - 1), []);
  const first = eventSlot(0), site = eventSite(first.kind);
  const during = mapEvents(first.start + site.fade + 1);
  assert.equal(during.length, 1);
  assert.equal(during[0].kind, first.kind);
  assert.equal(during[0].x, first.x);
  assert.ok(during[0].label.length > 0 && during[0].label.length <= 20);
  assert.ok(!mapEvents(first.start - 0.5).some(item => item.id === first.id));
  assert.ok(!mapEvents(first.end + 0.5).some(item => item.id === first.id));
  const satellite = satelliteSlot(0);
  assert.ok(activeEvents(satellite.start + 6).some(item => item.kind === "satellite"));
  assert.ok(!mapEvents(satellite.start + 6).some(item => item.kind === "satellite"));
});

test("the event marker breathes calmly: at or below the comfort rate and smooth frame to frame", () => {
  assert.ok(EVENT_BREATH_HZ <= COMFORT_HZ);
  let previous = eventBreath(0), largest = 0;
  for (let frame = 1; frame < 60 * 12; frame++) {
    const value = eventBreath(frame / 60);
    assert.ok(value >= 0 && value <= 1);
    largest = Math.max(largest, Math.abs(value - previous));
    previous = value;
  }
  assert.ok(largest < 0.03, `largest per-frame change ${largest}`);
});

test("the minimap marks a happening in view, points at one within range and ignores one far away", () => {
  const player = { x: 100, z: 100 };
  const inView = new Recorder();
  assert.equal(drawEventLayer(inView.context(), minimap(100, 100), [event(130, 90)], { time: 1, labels: false, player }), 1);
  assert.ok(inView.count("arc") >= 2 && inView.count("fillText") === 1, "ring, disc and glyph");
  const near = new Recorder();
  assert.equal(drawEventLayer(near.context(), minimap(100, 100), [event(100 + EVENT_CHEVRON_RANGE - 20, 100)], { time: 1, labels: false, player }), 1);
  assert.equal(near.count("arc"), 0);
  assert.equal(near.count("fill"), 1, "one chevron");
  assert.ok(near.calls.some(call => call.name === "fill" && call.values[0] === EVENT_INK));
  const far = new Recorder();
  assert.equal(drawEventLayer(far.context(), minimap(100, 100), [event(100 + EVENT_CHEVRON_RANGE + 40, 100)], { time: 1, labels: false, player }), 0);
  const atlas = new Recorder();
  assert.equal(drawEventLayer(atlas.context(), minimap(0, 0, true), [event(400, 0)], { time: 1, labels: true }), 0, "the full map draws no chevrons");
  const labelled = new Recorder();
  drawEventLayer(labelled.context(), minimap(0, 0, true), [event(10, 0)], { time: 1, labels: true });
  assert.ok(labelled.calls.some(call => call.name === "fillText" && call.values[0] === "Drone show"));
  assert.equal(labelled.count("save"), labelled.count("restore"));
});

test("labels step aside instead of painting over one another", () => {
  const space = new LabelSpace();
  assert.equal(space.place(100, 100, monoWidth("Signal Cathedral", 11), 13, [19, -19]), 119);
  assert.equal(space.place(105, 100, monoWidth("Ghost Circuit Stn", 10), 12, [19, -19]), 81);
  assert.equal(space.place(100, 100, 60, 12, [19, -19]), null, "a yielding label is skipped");
  assert.equal(space.place(100, 100, 60, 12, [19, -19], true), 119, "a forced label keeps its first spot");
  assert.equal(space.count, 3);
  assert.equal(space.place(400, 100, 60, 12, [0]), 100);
});

test("quest names step over labels the world map placed first, and still draw when boxed in", () => {
  const view: QuestLayerView = { px: x => x + 800, pz: z => z + 800, centerX: 0, centerZ: 0, extent: 800, size: 1600, full: true };
  const quests: QuestSnapshot = { credits: 0, log: [], nearbyNpc: null, tracked: null, markers: [{ id: "n", name: "New citizen", x: 23, z: 45, state: "offer" }] };
  const names = (record: Recorder) => record.calls.filter(call => call.name === "fillText").map(call => call.values);
  const free = new Recorder();
  drawQuestLayer(free.context(), view, quests, new LabelSpace());
  assert.deepEqual(names(free), [["New citizen", 823, 835]], "an empty space changes nothing");
  const blocked = new Recorder(), space = new LabelSpace();
  space.reserve({ x0: 780, y0: 820, x1: 870, y1: 836 });
  drawQuestLayer(blocked.context(), view, quests, space);
  assert.deepEqual(names(blocked), [["New citizen", 823, 807]]);
  const boxed = new Recorder(), full = new LabelSpace();
  full.reserve({ x0: 0, y0: 0, x1: 1600, y1: 1600 });
  drawQuestLayer(boxed.context(), view, quests, full);
  assert.deepEqual(names(boxed), [["New citizen", 823, 835]], "boxed in, it falls back to its usual row");
});

test("the nightclub's doorway has its own ink and note without adding labels or boxes", () => {
  const places = interiorPlaces(new CityWorld());
  const club = places.find(place => place.kind === "nightclub");
  assert.ok(club, "The Static is a mapped venue");
  const record = new Recorder();
  const view: QuestLayerView = { px: x => x + 800, pz: z => z + 800, centerX: 0, centerZ: 0, extent: 800, size: 1600, full: true };
  drawVenueLayer(record.context(), view, places);
  assert.ok(record.calls.some(call => call.name === "stroke" && call.values[0] === CLUB_INK));
  assert.equal(record.count("fillRect"), places.length);
  assert.deepEqual(record.calls.filter(call => call.name === "fillText").map(call => call.values[0]), places.map(place => place.name));
  const spaced = new Recorder(), space = new LabelSpace();
  drawVenueLayer(spaced.context(), view, places, true, [], space);
  assert.equal(spaced.count("fillText"), places.length, "venue names are always drawn, shifted if need be");
});
