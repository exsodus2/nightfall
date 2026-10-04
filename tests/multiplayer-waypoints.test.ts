import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { WaypointStore, normalizeWaypoint, LABEL_LIMIT, LOCAL_OWNER, WAYPOINT_LIMIT, type Waypoint } from "../src/city/waypoints.ts";
import { MultiplayerSession } from "../src/multiplayer/session.ts";
import { createRoomWaypointSync } from "../src/multiplayer/waypoint-sync.ts";
import { parseWaypoint, parseWaypointId, waypointKey, WAYPOINT_LABEL_MAX, WAYPOINTS_PER_PLAYER, type WaypointMessage } from "../src/multiplayer/protocol.ts";

const until = async (condition: () => boolean, label: string, timeout = 5000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(`timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const message = (id: string, label = "Meet here"): WaypointMessage => ({ id, x: 10, z: -20, label, color: "#ffb347", shared: true });

function savedPins(): WaypointStore {
  let counter = 0;
  const store = new WaypointStore({ createId: () => `saved-${++counter}` });
  for (let index = 0; index < WAYPOINT_LIMIT; index++) store.add({ x: index * 10, z: -index * 10, label: "L".repeat(LABEL_LIMIT), shared: true });
  return store;
}

test("shared pin limits match the local editor and canonical IDs retain raw-ID compatibility", () => {
  assert.equal(WAYPOINTS_PER_PLAYER, WAYPOINT_LIMIT);
  assert.equal(WAYPOINT_LABEL_MAX, LABEL_LIMIT);
  const owner = "session-a";
  const rawId = "p".repeat(40);
  const key = waypointKey(owner, rawId);
  assert.equal(parseWaypointId(rawId, owner), rawId);
  assert.equal(parseWaypointId(key, owner), rawId);
  assert.equal(parseWaypoint(message(key), owner)?.id, rawId);
  assert.equal(parseWaypoint(message(key)), null, "canonical IDs need an authenticated owner");
  assert.ok(normalizeWaypoint({ ...message(key), owner, createdAt: 1 }), "canonical wire IDs are valid shared store IDs");
  for (const invalid of ["session-b:pin", "session-a:session-b:pin", "session-a:", ":pin", "../pin", "p".repeat(41), null, 7, {}]) {
    assert.equal(parseWaypointId(invalid, owner), null, JSON.stringify(invalid));
  }
  for (const coordinates of [{ x: NaN, z: 0 }, { x: 0, z: Infinity }, { x: 769, z: 0 }]) {
    assert.equal(parseWaypoint({ ...message("pin"), ...coordinates }, owner), null);
  }
});

test("real room waypoints isolate owners, converge under bursts, and retire with their connection", { timeout: 45000 }, async (context) => {
  const { createNightfallServer } = await import("../server/app.ts");
  const { gameServer, httpServer } = createNightfallServer();
  await gameServer.listen(0, "127.0.0.1");
  const serverUrl = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const host = new MultiplayerSession(), guest = new MultiplayerSession();
  const cleanups: Array<() => void> = [];
  try {
    await context.test("identical restored IDs coexist; raw and canonical mutations only affect their owner", async () => {
      assert.ok(await host.connect({ serverUrl, name: "Host" }));
      assert.ok(await guest.connect({ serverUrl, name: "Guest", code: host.getView().code! }));
      const hostId = host.getView().selfId!, guestId = guest.getView().selfId!;
      const own = savedPins(), other = new WaypointStore();
      assert.equal(other.restore(own.serialize()), WAYPOINT_LIMIT);
      own.setOwner(hostId);
      other.setOwner(guestId);
      cleanups.push(own.connect(createRoomWaypointSync(host)), other.connect(createRoomWaypointSync(guest)));
      await until(() => host.sharedWaypoints().length === WAYPOINT_LIMIT * 2 && guest.sharedWaypoints().length === WAYPOINT_LIMIT * 2, "both complete saved sets arrive");
      assert.equal(own.list().length, WAYPOINT_LIMIT * 2);
      assert.equal(other.list().length, WAYPOINT_LIMIT * 2);
      assert.ok(host.sharedWaypoints().every(pin => pin.label.length === LABEL_LIMIT && normalizeWaypoint({ ...pin, shared: true })));
      assert.ok(own.list().filter(pin => own.isMine(pin.id)).every(pin => /^saved-\d+$/.test(pin.id)), "local saved IDs remain unchanged");

      const rawId = "saved-1", hostKey = waypointKey(hostId, rawId), guestKey = waypointKey(guestId, rawId);
      const createdAt = guest.sharedWaypoints().find(pin => pin.id === guestKey)!.createdAt;
      guest.addWaypoint(message(hostKey, "Foreign overwrite"));
      guest.removeWaypoint(hostKey);
      guest.addWaypoint(message(rawId, "Legacy raw update"));
      await until(() => host.sharedWaypoints().find(pin => pin.id === guestKey)?.label === "Legacy raw update", "legacy raw ID update accepted");
      assert.equal(host.sharedWaypoints().find(pin => pin.id === hostKey)?.label, "L".repeat(LABEL_LIMIT));
      assert.equal(host.sharedWaypoints().find(pin => pin.id === guestKey)?.createdAt, createdAt);
      guest.addWaypoint(message(guestKey, "Canonical update"));
      await until(() => host.sharedWaypoints().find(pin => pin.id === guestKey)?.label === "Canonical update", "own canonical update accepted");
      guest.removeWaypoint(rawId);
      await until(() => !host.sharedWaypoints().some(pin => pin.id === guestKey), "legacy raw ID removal accepted");
      assert.ok(host.sharedWaypoints().some(pin => pin.id === hostKey), "raw ID removal cannot touch another owner's colliding ID");
      guest.addWaypoint(message(rawId, "Recreated"));
      await until(() => host.sharedWaypoints().some(pin => pin.id === guestKey), "raw ID can be recreated");
      guest.removeWaypoint(guestKey);
      await until(() => !host.sharedWaypoints().some(pin => pin.id === guestKey), "own canonical removal accepted");
      assert.equal(host.sharedWaypoints().filter(pin => pin.owner === hostId).length, WAYPOINT_LIMIT);
      while (cleanups.length) cleanups.pop()!();
      await host.leave(); await guest.leave();
    });

    await context.test("rapid edits coalesce to their final value; unshare cancels pending work and quota notices are bounded", async () => {
      assert.ok(await host.connect({ serverUrl, name: "Editor" }));
      assert.ok(await guest.connect({ serverUrl, name: "Observer", code: host.getView().code! }));
      const owner = host.getView().selfId!;
      const store = savedPins();
      store.setOwner(owner);
      cleanups.push(store.connect(createRoomWaypointSync(host)));
      await until(() => guest.sharedWaypoints().length === WAYPOINT_LIMIT, "initial full burst");
      const notices: string[] = [], seenLabels: string[] = [];
      cleanups.push(host.onEvent(event => { if (event.kind === "notice") notices.push(event.text); }));
      cleanups.push(guest.onWaypoints(pins => {
        const label = pins.find(pin => pin.id === waypointKey(owner, "saved-1"))?.label;
        if (label && label !== seenLabels.at(-1)) seenLabels.push(label);
        assert.ok(pins.filter(pin => pin.owner === owner).length <= WAYPOINT_LIMIT);
      }));
      for (let index = 0; index < 100; index++) store.update("saved-1", { label: `Typing ${index}` });
      store.update("saved-1", { label: "Final shared label" });
      store.update("saved-2", { label: "Must not reappear" });
      store.setShared("saved-2", false);
      store.update("saved-3", { label: "Another final value" });
      host.addWaypoint(message("replacement", "One available slot"));
      for (let index = 0; index < 100; index++) host.addWaypoint(message(`overflow-${index}`));
      for (let index = 0; index < 30; index++) host.addWaypoint(message("foreign:pin"));
      await until(() => guest.sharedWaypoints().find(pin => pin.id === waypointKey(owner, "saved-1"))?.label === "Final shared label", "coalesced final label reaches peer");
      await until(() => guest.sharedWaypoints().find(pin => pin.id === waypointKey(owner, "saved-3"))?.label === "Another final value", "queued IDs flush fairly");
      await until(() => guest.sharedWaypoints().some(pin => pin.id === waypointKey(owner, "replacement")), "queued add uses the unshared slot");
      assert.equal(guest.sharedWaypoints().length, WAYPOINT_LIMIT);
      assert.ok(!guest.sharedWaypoints().some(pin => pin.id === waypointKey(owner, "saved-2") || pin.id.includes("overflow-")));
      assert.equal(notices.length, 1, "a rejected burst sends one surfaced notice, not one per packet");
      assert.match(notices[0], /up to 24 waypoints/);
      assert.ok(seenLabels.length <= 4, `burst coalesced into ${seenLabels.length} observed labels`);
      host.removeWaypoint("replacement");
      await until(() => guest.sharedWaypoints().length === WAYPOINT_LIMIT - 1, "pending and published adds can be removed");
      await pause(600);
      assert.ok(!guest.sharedWaypoints().some(pin => pin.id === waypointKey(owner, "saved-2")), "unshared pin stays removed after queue drain");

      for (let index = 1; index <= WAYPOINT_LIMIT; index++) host.addWaypoint(message(`saved-${index}`, "Retired pending update"));
      await host.leave();
      await until(() => guest.sharedWaypoints().length === 0, "leaving removes every owned pin and queued edit");
      await pause(600);
      assert.deepEqual(guest.sharedWaypoints(), [], "the old room heartbeat cannot resurrect a departed player's queue");
      while (cleanups.length) cleanups.pop()!();
      await guest.leave();
    });

    await context.test("stale room adapters cannot publish, remove or read a later room; reconnect keeps saved local pins", async () => {
      assert.ok(await host.connect({ serverUrl, name: "Traveller" }));
      const originalCode = host.getView().code!, oldOwner = host.getView().selfId!;
      assert.ok(await guest.connect({ serverUrl, name: "Anchor", code: originalCode }));
      const store = new WaypointStore({ createId: () => "reused-local-id" });
      const local = store.add({ x: 1, z: 2, label: "Original pin", shared: true })!;
      store.setOwner(oldOwner);
      const oldSync = createRoomWaypointSync(host);
      const disconnect = store.connect(oldSync);
      cleanups.push(disconnect);
      const snapshots: Waypoint[][] = [];
      cleanups.push(oldSync.subscribe(pins => snapshots.push([...pins])));
      await until(() => guest.sharedWaypoints().length === 1, "old room receives pin");

      assert.ok(await host.connect({ serverUrl, name: "New room" }));
      const newOwner = host.getView().selfId!, newKey = waypointKey(newOwner, local.id);
      await until(() => guest.sharedWaypoints().length === 0, "old room loses departing owner's pins");
      snapshots.length = 0;
      host.addWaypoint(message(local.id, "New room pin"));
      await until(() => host.sharedWaypoints().some(pin => pin.id === newKey), "new room receives current pin");
      oldSync.publish({ ...local, owner: oldOwner, label: "Stale publish" });
      oldSync.remove(local.id);
      oldSync.publish({ ...local, owner: newOwner, id: "new-owner-spoof" });
      await pause(250);
      assert.deepEqual(host.sharedWaypoints().map(pin => pin.label), ["New room pin"]);
      assert.ok(snapshots.length && snapshots.every(pins => pins.length === 0), "retired adapter never exposes the new room's pins");
      disconnect();
      store.setOwner(LOCAL_OWNER);
      assert.equal(store.list().length, 1);
      assert.equal(store.list()[0].id, local.id);
      assert.equal(store.list()[0].label, "Original pin");

      assert.ok(await host.connect({ serverUrl, name: "Returned", code: originalCode }));
      const returnedOwner = host.getView().selfId!;
      assert.notEqual(returnedOwner, oldOwner);
      store.setOwner(returnedOwner);
      cleanups.push(store.connect(createRoomWaypointSync(host)));
      await until(() => guest.sharedWaypoints().some(pin => pin.id === waypointKey(returnedOwner, local.id)), "returning connection republishes saved raw ID under new owner");
      assert.ok(!guest.sharedWaypoints().some(pin => pin.owner === oldOwner || pin.owner === newOwner));
      assert.equal(store.list().length, 1, "own canonical echo is filtered without duplicate local pins");
      while (cleanups.length) cleanups.pop()!();
    });
  } finally {
    while (cleanups.length) cleanups.pop()!();
    await host.leave(); await guest.leave();
    await gameServer.gracefullyShutdown(false);
  }
});
