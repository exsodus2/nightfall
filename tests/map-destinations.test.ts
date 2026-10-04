import assert from "node:assert/strict";
import test from "node:test";
import { interiorPlaces } from "../src/city/interiors.ts";
import { QuestBook, type QuestSnapshot } from "../src/city/quests.ts";
import { trackVenueEntrance, waypointAtEntrance } from "../src/city/venue-navigation.ts";
import { WaypointStore, type Waypoint } from "../src/city/waypoints.ts";
import { CityWorld } from "../src/city/world.ts";
import { drawQuestLayer, type QuestLayerView } from "../src/components/quest-map-layer.ts";
import { drawVenueLayer } from "../src/components/venue-map-layer.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import { RpgSession } from "../src/rpg/session.ts";

const world = new CityWorld();
const places = interiorPlaces(world);
const mapView: QuestLayerView = { px: value => value + 800, pz: value => value + 800, centerX: 0, centerZ: 0, extent: 800, size: 1600, full: true };

class MapRecorder {
  fillStyle = "";
  strokeStyle = "";
  font = "";
  lineWidth = 1;
  globalAlpha = 1;
  textAlign: CanvasTextAlign = "center";
  textBaseline: CanvasTextBaseline = "top";
  readonly calls: { name: string; values: (number | string)[] }[] = [];
  save() { this.calls.push({ name: "save", values: [] }); }
  restore() { this.calls.push({ name: "restore", values: [] }); }
  beginPath() { this.calls.push({ name: "beginPath", values: [] }); }
  closePath() { this.calls.push({ name: "closePath", values: [] }); }
  fill() { this.calls.push({ name: "fill", values: [this.fillStyle] }); }
  stroke() { this.calls.push({ name: "stroke", values: [this.strokeStyle] }); }
  fillRect(...values: number[]) { this.calls.push({ name: "fillRect", values }); }
  moveTo(...values: number[]) { this.calls.push({ name: "moveTo", values }); }
  lineTo(...values: number[]) { this.calls.push({ name: "lineTo", values }); }
  arc(...values: number[]) { this.calls.push({ name: "arc", values }); }
  translate(...values: number[]) { this.calls.push({ name: "translate", values }); }
  rotate(...values: number[]) { this.calls.push({ name: "rotate", values }); }
  fillText(...values: (number | string)[]) { this.calls.push({ name: "fillText", values }); }
  strokeText(...values: (number | string)[]) { this.calls.push({ name: "strokeText", values }); }
  context(): CanvasRenderingContext2D { return this as unknown as CanvasRenderingContext2D; }
}

test("map snapshots include every registered citizen and authoritative quest business without mutating progress", () => {
  const session = new RpgSession({ world, packs: CONTENT_PACKS });
  const before = session.quests.serialize();
  const snapshot = session.questSnapshot(null);
  assert.equal(snapshot.markers?.length, session.npcs.length);
  assert.deepEqual(snapshot.markers?.map(marker => marker.id), session.npcs.map(npc => npc.id));
  assert.equal(snapshot.markers?.find(marker => marker.id === "mira")?.state, "offer");
  for (const marker of snapshot.markers ?? []) {
    const npc = session.npcs.find(candidate => candidate.id === marker.id);
    assert.ok(npc);
    assert.equal(marker.state, session.marker(marker.id));
    assert.equal(marker.name, npc.name);
    assert.equal(marker.x, npc.x);
    assert.equal(marker.z, npc.z);
  }
  assert.deepEqual(session.quests.serialize(), before);
});

test("Mira's map offer changes to a hand-in and the next job after actual quest choices", () => {
  const session = new RpgSession({ world, packs: CONTENT_PACKS });
  const state = () => session.questSnapshot(null).markers?.find(marker => marker.id === "mira")?.state;
  assert.equal(state(), "offer");
  session.talk("mira"); session.choose("accept-light"); session.close();
  assert.equal(state(), null);
  for (const place of ["blue-hour", "second-life", "kiln", "glasshouse"]) session.bus.emit({ type: "entered", area: `interior:${place}` });
  assert.equal(state(), "turn-in");
  session.talk("mira"); session.choose("report"); session.close();
  assert.equal(state(), "offer");
  const restored = new RpgSession({ world, packs: CONTENT_PACKS });
  restored.quests.load(session.quests.serialize());
  assert.deepEqual(restored.questSnapshot(null).markers, session.questSnapshot(null).markers);
});

test("the shared map layer uses authoritative markers, distinguishes objectives and never invents fallback offers", () => {
  const base: QuestSnapshot = { credits: 0, log: [], nearbyNpc: null, tracked: null };
  for (const state of ["offer", "objective", "turn-in"] as const) {
    const record = new MapRecorder();
    drawQuestLayer(record.context(), mapView, { ...base, markers: [{ id: "new-citizen", name: "New citizen", x: 23, z: 45, state }] });
    assert.deepEqual(record.calls.filter(call => call.name === "fillText").map(call => call.values), [["New citizen", 823, 835]]);
    assert.equal(record.calls.filter(call => call.name === "fill").length, state === "objective" ? 0 : 1);
    assert.equal(record.calls.filter(call => call.name === "stroke").length, state === "objective" ? 1 : 0);
  }
  const empty = new MapRecorder();
  drawQuestLayer(empty.context(), mapView, { ...base, markers: [] });
  assert.equal(empty.calls.filter(call => call.name === "fill" || call.name === "stroke").length, 0);
  const legacy = new MapRecorder();
  drawQuestLayer(legacy.context(), mapView, new QuestBook().snapshot(null));
  assert.ok(legacy.calls.some(call => call.name === "fillText" && call.values[0] === "Mara Voss"));
});

test("venue markers use the six real doorway positions, cull off-map rooms and keep minimap labels quiet", () => {
  assert.equal(places.length, 6);
  const full = new MapRecorder();
  drawVenueLayer(full.context(), mapView, places);
  assert.deepEqual(full.calls.filter(call => call.name === "fillText").map(call => call.values[0]), places.map(place => place.name));
  assert.deepEqual(full.calls.filter(call => call.name === "fillRect").map(call => call.values), places.map(place => [mapView.px(place.entrance.x) - 5, mapView.pz(place.entrance.z) - 5, 10, 10]));
  for (const place of places) {
    const local = new MapRecorder();
    drawVenueLayer(local.context(), { ...mapView, centerX: place.entrance.x, centerZ: place.entrance.z, extent: 2, full: false }, places);
    assert.equal(local.calls.filter(call => call.name === "fillRect").length, 1);
    assert.equal(local.calls.filter(call => call.name === "fillText").length, 0);
  }
  assert.ok(full.calls.flatMap(call => call.values).filter(value => typeof value === "number").every(Number.isFinite));
  assert.equal(full.calls.filter(call => call.name === "save").length, full.calls.filter(call => call.name === "restore").length);
  const pinned = new MapRecorder();
  drawVenueLayer(pinned.context(), mapView, places, true, [places[0].entrance]);
  assert.equal(pinned.calls.filter(call => call.name === "fillRect").length, 6);
  assert.equal(pinned.calls.filter(call => call.name === "fillText").length, 5);
  assert.ok(!pinned.calls.some(call => call.name === "fillText" && call.values[0] === places[0].name));
});

test("crowded quest-giver names take bounded separate rows instead of painting over one another", () => {
  const record = new MapRecorder();
  const markers = ["Mara Voss", "Sable Quist", "Mira Bell"].map((name, index) => ({ id: name, name, x: index * 20, z: 0, state: "offer" as const }));
  drawQuestLayer(record.context(), mapView, { credits: 0, log: [], nearbyNpc: null, tracked: null, markers });
  const labels = record.calls.filter(call => call.name === "fillText").map(call => ({ name: String(call.values[0]), x: Number(call.values[1]), y: Number(call.values[2]) }));
  assert.equal(labels.length, 3);
  for (const [index, label] of labels.entries()) {
    assert.ok(label.y <= 790 && label.y >= 734);
    for (const other of labels.slice(index + 1)) assert.ok(Math.abs(label.y - other.y) >= 12 || Math.abs(label.x - other.x) >= (label.name.length + other.name.length) * 3.5 + 4);
  }
});

test("directory tracking targets walkable entrances, persists and reuses renamed or shared personal pins", () => {
  let identifier = 0;
  const store = new WaypointStore({ createId: () => `venue-${++identifier}` });
  for (const place of places) {
    const waypoint = trackVenueEntrance(store, place);
    assert.ok(waypoint);
    assert.equal(waypointAtEntrance(waypoint, place), true);
    assert.ok(world.canOccupy(waypoint.x, waypoint.z));
    assert.notEqual(waypoint.x === place.x && waypoint.z === place.z, true);
    assert.equal(waypoint.shared, false);
    assert.equal(store.activeId, waypoint.id);
    assert.equal(trackVenueEntrance(store, place)?.id, waypoint.id);
    store.update(waypoint.id, { label: "Meet the night shift", shared: true });
    assert.equal(trackVenueEntrance(store, place)?.label, "Meet the night shift");
    assert.equal(store.get(waypoint.id)?.shared, true);
  }
  assert.equal(store.list().length, 6);
  const restored = new WaypointStore();
  restored.restore(store.serialize());
  for (const place of places) assert.ok(restored.list().some(waypoint => waypointAtEntrance(waypoint, place)));
});

test("a friend's doorway pin remains untouched when choosing a private route there", () => {
  const place = places[0];
  const remote: Waypoint = { id: "friend:door", owner: "friend", ...place.entrance, label: "My workshop", color: "#ffb347", shared: true, createdAt: 1 };
  const store = new WaypointStore({ sync: { publish() {}, remove() {}, subscribe(listener) { listener([remote]); return () => undefined; } } });
  const own = trackVenueEntrance(store, place);
  assert.ok(own);
  assert.notEqual(own.id, remote.id);
  assert.equal(own.shared, false);
  assert.equal(store.activeId, own.id);
  assert.equal(store.get(remote.id)?.label, "My workshop");
  assert.equal(store.list().length, 2);
});
