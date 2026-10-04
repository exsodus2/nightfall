import assert from "node:assert/strict";
import test from "node:test";
import {
  WaypointStore, createLocalWaypointSync, encodeWaypointParam, normalizeWaypoint, parseWaypointParam, sanitizeLabel,
  stripWaypointParams, waypointBearing, waypointLink, waypointsFromSearch, WAYPOINT_COLORS, LABEL_LIMIT, LOCAL_OWNER,
  type Waypoint, type WaypointSync,
} from "../src/city/waypoints.ts";
import { WORLD_EDGE } from "../src/city/world.ts";

function counterIds(): () => string { let n = 0; return () => `id-${++n}`; }

/** A fake room: several stores share one list, like a server would. */
function room() {
  const all = new Map<string, Waypoint>();
  const listeners = new Set<(list: readonly Waypoint[]) => void>();
  const emit = () => { for (const listener of listeners) listener([...all.values()]); };
  const sync: WaypointSync = {
    publish(waypoint) { all.set(waypoint.id, { ...waypoint }); emit(); },
    remove(id) { all.delete(id); emit(); },
    subscribe(onChange) { listeners.add(onChange); onChange([...all.values()]); return () => { listeners.delete(onChange); }; },
  };
  return { all, sync, listeners };
}

test("add clamps to the city, names, colours and activates new waypoints", () => {
  const store = new WaypointStore({ createId: counterIds(), now: () => 42 });
  const first = store.add({ x: 5000, z: -12.34 });
  assert.ok(first);
  assert.equal(first.x, WORLD_EDGE);
  assert.equal(first.z, -12.3);
  assert.equal(first.label, "Waypoint 1");
  assert.equal(first.color, WAYPOINT_COLORS[0]);
  assert.equal(first.createdAt, 42);
  assert.equal(first.shared, false);
  assert.equal(store.activeId, first.id);
  const second = store.add({ x: 1, z: 2, label: "  Noodle\n bar ", color: "#ABCDEF" }, false);
  assert.equal(second?.label, "Noodle bar");
  assert.equal(second?.color, "#abcdef");
  assert.equal(store.activeId, first.id, "activate=false keeps the current target");
  assert.equal(store.add({ x: Number.NaN, z: 0 }), null);
  assert.equal(store.list().length, 2);
});

test("state snapshots are stable until something changes, and listeners fire on change", () => {
  const store = new WaypointStore({ createId: counterIds() });
  const before = store.getState();
  assert.equal(store.getState(), before);
  let calls = 0;
  const off = store.subscribe(() => calls++);
  const waypoint = store.add({ x: 0, z: 0 })!;
  assert.notEqual(store.getState(), before);
  assert.equal(store.getState().activeId, waypoint.id);
  store.setActive(waypoint.id); // no-op
  store.update(waypoint.id, { label: "Home" });
  off();
  store.remove(waypoint.id);
  assert.equal(calls, 2);
  assert.equal(store.activeWaypoint(), null);
});

test("update edits own waypoints only; remove clears the active target", () => {
  const store = new WaypointStore({ createId: counterIds() });
  const waypoint = store.add({ x: 10, z: 10 })!;
  const updated = store.update(waypoint.id, { label: "", color: "red", x: Number.POSITIVE_INFINITY });
  assert.equal(updated?.label, waypoint.label, "empty label keeps the old one");
  assert.equal(updated?.color, waypoint.color, "invalid colour ignored");
  assert.equal(updated?.x, 10, "non-finite coordinate ignored");
  assert.equal(store.update("missing", { label: "x" }), null);
  store.remove(waypoint.id);
  assert.equal(store.activeId, null);
  assert.equal(store.list().length, 0);
});

test("the limit evicts the oldest inactive waypoint", () => {
  const store = new WaypointStore({ createId: counterIds(), limit: 3 });
  const a = store.add({ x: 0, z: 0 })!;
  store.add({ x: 1, z: 0 }, false);
  store.add({ x: 2, z: 0 }, false);
  store.add({ x: 3, z: 0 }, false);
  const ids = store.list().map((waypoint) => waypoint.id);
  assert.equal(ids.length, 3);
  assert.ok(ids.includes(a.id), "the active waypoint survives");
  assert.ok(!ids.includes("id-2"));
});

test("sharing publishes to the sync, unsharing and removing withdraw", () => {
  const { all, sync } = room();
  const store = new WaypointStore({ createId: counterIds(), sync, owner: "ann" });
  const local = store.add({ x: 1, z: 1 })!;
  assert.equal(all.size, 0, "unshared waypoints stay private");
  store.setShared(local.id, true);
  assert.equal(all.get(local.id)?.owner, "ann");
  store.update(local.id, { label: "Meet here" });
  assert.equal(all.get(local.id)?.label, "Meet here");
  store.setShared(local.id, false);
  assert.equal(all.size, 0);
  const shared = store.add({ x: 2, z: 2, shared: true })!;
  assert.ok(all.has(shared.id));
  store.remove(shared.id);
  assert.equal(all.size, 0);
  assert.equal(store.list().length, 1, "own echoes are never duplicated");
});

test("friends see each other's shared waypoints; remote ones are read-only and can be hidden", () => {
  const { sync } = room();
  const ann = new WaypointStore({ createId: () => `ann-${Math.random()}`, sync, owner: "ann" });
  const bob = new WaypointStore({ createId: () => `bob-${Math.random()}`, sync, owner: "bob" });
  const pin = ann.add({ x: 100, z: -200, label: "Rooftop", shared: true })!;
  const seen = bob.list();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].owner, "ann");
  assert.equal(bob.isMine(pin.id), false);
  assert.equal(bob.update(pin.id, { label: "hacked" }), null);
  bob.setActive(pin.id);
  assert.equal(bob.activeWaypoint()?.label, "Rooftop");
  bob.remove(pin.id);
  assert.equal(bob.list().length, 0, "hidden locally");
  assert.equal(ann.list().length, 1, "still there for its owner");
  assert.equal(bob.activeId, null);
  ann.remove(pin.id);
  assert.equal(ann.list().length, 0);
});

test("incoming network data is validated", () => {
  const { sync } = room();
  const store = new WaypointStore({ sync, owner: "me" });
  sync.publish({ id: "ok", x: 1e9, z: 3, label: "<b>hi</b>", color: "javascript:", owner: "eve", shared: true, createdAt: 1 });
  sync.publish({ id: "bad", x: Number.NaN, z: 0, label: "", color: "", owner: "eve", shared: true, createdAt: 1 } as Waypoint);
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].x, WORLD_EDGE);
  assert.equal(list[0].label, "b hi /b");
  assert.equal(list[0].color, WAYPOINT_COLORS[0]);
  assert.equal(normalizeWaypoint({ id: 5, x: 0, z: 0 }), null);
  assert.equal(normalizeWaypoint(null), null);
});

test("connect switches transport and republishes shared waypoints; setOwner re-owns them", () => {
  const store = new WaypointStore({ createId: counterIds() });
  const shared = store.add({ x: 5, z: 5, shared: true })!;
  store.add({ x: 6, z: 6 });
  const { all, sync } = room();
  const disconnect = store.connect(sync);
  assert.equal(store.networked, true);
  assert.deepEqual([...all.keys()], [shared.id]);
  store.setOwner("session-7");
  assert.equal(all.get(shared.id)?.owner, "session-7");
  assert.equal(store.list().length, 2);
  disconnect();
  assert.equal(store.networked, false);
});

test("local sync echoes to every subscriber", () => {
  const sync = createLocalWaypointSync();
  const seen: number[] = [];
  const off = sync.subscribe((all) => seen.push(all.length));
  sync.publish({ id: "a", x: 0, z: 0, label: "a", color: "#ffffff", owner: "x", shared: true, createdAt: 0 });
  sync.remove("a");
  sync.remove("a");
  off();
  assert.deepEqual(seen, [0, 1, 0]);
});

test("leaving a room does not resurrect shared pins deleted or unshared online", () => {
  const store = new WaypointStore({ createId: counterIds() });
  const removed = store.add({ x: 1, z: 1, label: "Removed", shared: true })!;
  const unshared = store.add({ x: 2, z: 2, label: "Private", shared: true })!;
  store.setOwner("session-a");
  const disconnect = store.connect(createLocalWaypointSync());
  store.remove(removed.id);
  store.setShared(unshared.id, false);
  disconnect();
  store.setOwner(LOCAL_OWNER);
  store.add({ x: 3, z: 3, label: "Solo", shared: true });
  assert.deepEqual(store.list().map(waypoint => waypoint.label), ["Private", "Solo"]);
  assert.ok(store.list().every(waypoint => waypoint.owner === LOCAL_OWNER && store.isMine(waypoint.id)));
  assert.equal(store.get(unshared.id)?.shared, false);
});

test("retired transport callbacks and cleanup cannot change the current room", () => {
  const listeners: Array<(all: readonly Waypoint[]) => void> = [];
  const transport: WaypointSync = {
    publish() {},
    remove() {},
    subscribe(listener) { listeners.push(listener); return () => undefined; },
  };
  const store = new WaypointStore();
  const firstDisconnect = store.connect(transport);
  const secondDisconnect = store.connect(transport);
  const pin: Waypoint = { id: "old-session:pin", x: 1, z: 2, label: "Retired room", color: "#ffb347", owner: "old-session", shared: true, createdAt: 0 };
  listeners[0]([pin]);
  assert.deepEqual(store.list(), []);
  firstDisconnect();
  assert.equal(store.networked, true, "cleanup belongs to one connection, not a reused transport object");
  listeners[1]([{ ...pin, id: "new-session:pin", owner: "new-session", label: "Current room" }]);
  assert.equal(store.list()[0]?.label, "Current room");
  secondDisconnect();
  listeners[1]([pin]);
  assert.equal(store.networked, false);
  assert.deepEqual(store.list(), []);
});

test("serialize / restore round-trips own waypoints and ignores junk", () => {
  const store = new WaypointStore({ createId: counterIds() });
  store.add({ x: 1, z: 2, label: "One" });
  const two = store.add({ x: 3, z: 4, label: "Two", color: "#4de8e0" })!;
  const json = store.serialize();
  const copy = new WaypointStore();
  assert.equal(copy.restore(json), 2);
  assert.equal(copy.activeId, two.id);
  assert.deepEqual(copy.list().map((waypoint) => waypoint.label), ["One", "Two"]);
  assert.equal(copy.restore(json), 0, "no duplicates");
  assert.equal(new WaypointStore().restore("{not json"), 0);
  assert.equal(new WaypointStore().restore(JSON.stringify({ waypoints: [{ id: "x" }, 7] })), 0);
  assert.equal(new WaypointStore().restore(null), 0);
});

test("parseWaypointParam accepts x,z,label and rejects unsafe input", () => {
  assert.deepEqual({ ...parseWaypointParam("120,-340,Noodle bar"), color: "" }, { x: 120, z: -340, label: "Noodle bar", color: "" });
  assert.equal(parseWaypointParam("1.5,2,Label, with, commas")?.label, "Label, with, commas");
  assert.equal(parseWaypointParam("10,20")?.label, "Shared waypoint");
  assert.equal(parseWaypointParam("10,20,")?.label, "Shared waypoint");
  assert.equal(parseWaypointParam("99999,-99999,edge")?.x, WORLD_EDGE);
  assert.equal(parseWaypointParam("99999,-99999,edge")?.z, -WORLD_EDGE);
  assert.equal(parseWaypointParam("a\u0000b".replace("a", "1,2,")) ?.label, "b");
  for (const bad of ["", "12", "NaN,1,x", "Infinity,0,x", "1e3,0,x", "0x10,0,x", ",,x", "1,,x", " ,1,x", "1;2,3", "1234567,0,x", "x".repeat(300)]) {
    assert.equal(parseWaypointParam(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseWaypointParam(null), null);
  assert.equal(parseWaypointParam(`1,2,${"L".repeat(150)}`)?.label.length, LABEL_LIMIT);
  assert.ok(WAYPOINT_COLORS.includes(parseWaypointParam("1,2,x")!.color as typeof WAYPOINT_COLORS[number]));
});

test("links round-trip through a real URL, and wp params can be stripped", () => {
  const link = waypointLink("http://127.0.0.1:3000/?studio=1&view=market#x", { x: 120.4, z: -339.6, label: "Kai Ramen & Tea" });
  assert.equal(link, "http://127.0.0.1:3000/?wp=120,-340,Kai%20Ramen%20%26%20Tea");
  const url = new URL(link);
  const [seed] = waypointsFromSearch(url.search);
  assert.equal(seed.x, 120);
  assert.equal(seed.z, -340);
  assert.equal(seed.label, "Kai Ramen & Tea");
  assert.equal(waypointsFromSearch("?wp=1,2,a&wp=bad&wp=3,4,b").length, 2);
  assert.equal(waypointsFromSearch("?wp=1%2C2%2Cencoded")[0].label, "encoded");
  assert.equal(encodeWaypointParam({ x: 1.6, z: -0.4, label: "a\tb" }), "2,0,a b");
  assert.equal(stripWaypointParams("http://h/?wp=1,2,a&studio=1&wp=3,4,b"), "http://h/?studio=1");
  assert.equal(sanitizeLabel("   "), "Waypoint");
});

test("bearing follows the engine's yaw convention", () => {
  const north = waypointBearing(0, 0, 0, 0, -100);
  assert.equal(north.distance, 100);
  assert.ok(Math.abs(north.relative) < 1e-9);
  const east = waypointBearing(0, 0, 0, 100, 0);
  assert.ok(Math.abs(east.relative - Math.PI / 2) < 1e-9);
  const behind = waypointBearing(0, 0, Math.PI / 2, -100, 0);
  assert.ok(Math.abs(Math.abs(behind.relative) - Math.PI) < 1e-9);
});
