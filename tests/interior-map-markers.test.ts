import assert from "node:assert/strict";
import test from "node:test";
import { INTERIOR_USE_MARKER_RADIUS, interiorMapDescription, interiorUseLabel, interiorUseMarkers } from "../src/city/interior-map-markers.ts";
import { interiorLocal, interiorPlaces, interiorWorld, type InteriorPlace } from "../src/city/interiors.ts";
import { CityWorld } from "../src/city/world.ts";
import { DEAD_LETTER_PACK, DEAD_LETTER_STATIONS } from "../src/rpg/content/dead-letter.ts";
import { KILN_WORKBENCH, KILN_WORKBENCH_PACK } from "../src/rpg/content/kiln-workbench.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { InteractableDefinition, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld();
const room = (id: string): InteriorPlace => {
  const place = interiorPlaces(world).find(candidate => candidate.id === id);
  assert.ok(place);
  return place;
};
const venue = room("dead-letter");
const station = (place: InteriorPlace, x: number, z: number, id = "probe"): InteractableDefinition => ({ id, label: `Use ${id}`, place: place.id, ...interiorWorld(place, x, z) });
const input: RpgFrame["input"] = {
  attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false,
  selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0,
};

function open(session: RpgSession, place: InteriorPlace, object: InteractableDefinition) {
  const local = interiorLocal(place, object.x, object.z), approach = interiorWorld(place, local.x, local.z + 1.05);
  session.close();
  session.update({ dt: 0.1, time: 1, input, player: { ...approach, eye: 2.7, yaw: place.yaw, pitch: 0, mode: "walk", onFoot: false, place: place.id } });
  assert.equal(session.interactNearby()?.npcId, object.id);
}

test("markers project rotated rooms without leaking content effects or mutating inputs", () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.31]) {
    const place = { ...venue, yaw };
    const source = Object.freeze({ ...station(place, -2, 3), glyph: "=", effects: [{ setFlag: "private" }] });
    const before = JSON.stringify(source), markers = interiorUseMarkers(place, Object.freeze([source]));
    assert.equal(markers.length, 1);
    assert.ok(Math.abs(markers[0].x + 2) < 0.000001);
    assert.ok(Math.abs(markers[0].z - 3) < 0.000001);
    assert.deepEqual(Object.keys(markers[0]).sort(), ["glyph", "id", "label", "x", "z"]);
    assert.equal(markers[0].glyph, "="); assert.equal(markers[0].id, source.id); assert.equal(markers[0].label, source.label);
    assert.equal(JSON.stringify(source), before);
  }
});

test("identical coordinates outside or in another room cannot create indoor markers", () => {
  const source = station(venue, 0, 0);
  const objects = [{ ...source, id: "outside", place: undefined }, { ...source, id: "street", place: "" }, { ...source, id: "other-room", place: "kiln" }, source];
  assert.deepEqual(interiorUseMarkers(venue, objects).map(marker => marker.id), [source.id]);
  assert.deepEqual(interiorUseMarkers(null, objects), []);
});

test("invalid positions are rejected, while near-wall marker footprints remain inside", () => {
  const invalid = [
    { ...station(venue, 0, 0), x: Number.NaN },
    { ...station(venue, 0, 0), z: Infinity },
    station(venue, venue.width / 2 + 0.01, 0),
    station(venue, 0, -venue.depth / 2 - 0.01),
  ];
  assert.deepEqual(interiorUseMarkers(venue, invalid), []);
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const source = station(venue, side * venue.width / 2, end * venue.depth / 2);
    const [marker] = interiorUseMarkers(venue, [source]);
    assert.ok(marker);
    assert.ok(Math.abs(marker.x) + INTERIOR_USE_MARKER_RADIUS <= venue.width / 2);
    assert.ok(Math.abs(marker.z) + INTERIOR_USE_MARKER_RADIUS <= venue.depth / 2);
  }
  assert.deepEqual(interiorUseMarkers({ ...venue, yaw: Number.NaN }, [station(venue, 0, 0)]), []);
  assert.deepEqual(interiorUseMarkers({ ...venue, width: 1 }, [station(venue, 0, 0)]), []);
});

test("three unique labeled markers retain author order and safe one-character glyphs", () => {
  const first = station(venue, -2, -2, "first"), second = station(venue, 2, 2, "second"), third = station(venue, 0, 0, "third");
  const markers = interiorUseMarkers(venue, [{ ...first, label: " " }, first, first, { ...second, glyph: "=" }, { ...third, glyph: "unsafe text" }, station(venue, 1, 1, "fourth")]);
  assert.deepEqual(markers.map(marker => marker.id), ["first", "second", "third"]);
  assert.deepEqual(markers.map(marker => marker.glyph), [">", "=", ">"]);
  for (const glyph of [undefined, "", " ", "\n", "◆"]) assert.equal(interiorUseMarkers(venue, [{ ...first, glyph }])[0].glyph, ">");
});

test("descriptions name available actions and room-relative directions without color alone", () => {
  const markers = interiorUseMarkers(venue, [station(venue, -5, -4, "ledger"), station(venue, 5, 1, "relay"), station(venue, 0, 0, "center")]);
  assert.equal(interiorUseLabel(venue, markers[0]), "Use ledger (back left)");
  assert.equal(interiorUseLabel(venue, markers[1]), "Use relay (middle right)");
  assert.equal(interiorUseLabel(venue, markers[2]), "Use center (center)");
  const description = interiorMapDescription(venue, markers);
  assert.ok(description.includes("The exit is at the bottom"));
  for (const marker of markers) assert.ok(description.includes(marker.label));
  assert.ok(description.includes("Approach one to interact"));
  assert.ok(interiorMapDescription(venue, []).includes("No usable stations"));
});

test("Kiln markers disappear when the real workbench completes", () => {
  const place = room("kiln"), session = new RpgSession({ world, packs: [KILN_WORKBENCH_PACK] });
  const markers = () => interiorUseMarkers(place, session.interactables(place.id));
  assert.deepEqual(markers().map(marker => marker.id), [KILN_WORKBENCH.id]);
  open(session, place, KILN_WORKBENCH);
  for (const choice of ["accept-calibration", "bond-earth", "aux-feed", "dummy-load", "proof-pulse"]) session.choose(choice);
  assert.equal(session.quests.status("kiln-calibration"), "complete");
  assert.deepEqual(markers(), []);
});

test("Dead Letter markers follow the actual one-to-three-to-receipt lifecycle", () => {
  const session = new RpgSession({ world, packs: [DEAD_LETTER_PACK] });
  const markers = () => interiorUseMarkers(venue, session.interactables(venue.id));
  assert.deepEqual(markers().map(marker => marker.id), [DEAD_LETTER_STATIONS.counter.id]);
  open(session, venue, DEAD_LETTER_STATIONS.counter); session.choose("accept-signal");
  assert.deepEqual(markers().map(marker => marker.id), Object.values(DEAD_LETTER_STATIONS).map(object => object.id));
  for (const marker of markers()) {
    assert.ok(Math.abs(marker.x) + INTERIOR_USE_MARKER_RADIUS <= venue.width / 2);
    assert.ok(Math.abs(marker.z) + INTERIOR_USE_MARKER_RADIUS <= venue.depth / 2);
  }
  open(session, venue, DEAD_LETTER_STATIONS.archive); session.choose("confirm-ledger");
  open(session, venue, DEAD_LETTER_STATIONS.relay); session.choose("confirm-spool");
  open(session, venue, DEAD_LETTER_STATIONS.relay); session.choose("select-042"); session.choose("route-glasshouse");
  open(session, venue, DEAD_LETTER_STATIONS.counter); session.choose("publish-anonymous");
  assert.equal(session.quests.status("last-good-signal"), "complete");
  assert.deepEqual(markers().map(marker => marker.id), [DEAD_LETTER_STATIONS.counter.id]);
  assert.equal(interiorMapDescription(venue, markers()).includes(DEAD_LETTER_STATIONS.archive.label), false);
});
