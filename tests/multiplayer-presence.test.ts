import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { CityWorld } from "../src/city/world.ts";
import { interiorPlaces, interiorWorld, type InteriorPlace } from "../src/city/interiors.ts";
import { NPCS } from "../src/city/npcs.ts";
import { localPose } from "../src/multiplayer/engine-hooks.ts";
import { ServerClock, SnapshotBuffer, type PoseSample } from "../src/multiplayer/interpolation.ts";
import { MODES, parsePose, type PoseMessage } from "../src/multiplayer/protocol.ts";
import { EXTERIOR_PLACE, INTERIOR_FEET_LIMIT, normalizePlace, presenceMapPosition, presencePlace, samePlace, validPresence, validPresenceTransition } from "../src/multiplayer/presence.ts";

const places = interiorPlaces(new CityWorld());
const pose = (positionX: number, positionZ: number, extra: Partial<PoseMessage> = {}): PoseMessage => ({ x: positionX, y: 0, z: positionZ, yaw: 0, pitch: 0, heading: 0, speed: 0, mode: "walk", car: 0, ...extra });
const outside = (place: InteriorPlace): PoseMessage => pose(place.entrance.x, place.entrance.z);
const inside = (place: InteriorPlace, localX = 0, localZ = place.depth / 2 - 2.2): PoseMessage => {
  const point = interiorWorld(place, localX, localZ);
  return pose(point.x, point.z, { place: place.id });
};
const sample = (time: number, positionX: number, extra: Partial<PoseSample> = {}): PoseSample => ({ ...pose(positionX, 0), speed: 5, time, ...extra });
const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const until = async (condition: () => boolean, label: string, timeout = 8000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out: ${label}`);
    await pause(20);
  }
};

test("presence identifiers default legacy clients to the street and map indoor friends to their doorway", () => {
  assert.equal(normalizePlace(undefined), EXTERIOR_PLACE);
  assert.equal(normalizePlace(""), EXTERIOR_PLACE);
  for (const invalid of [null, false, 0, {}, [], "unknown", "KILN", "kiln ", "../kiln"]) assert.equal(normalizePlace(invalid), null);
  assert.ok(samePlace(undefined, ""));
  assert.equal(samePlace("kiln", "undertone"), false);
  assert.equal(presencePlace(), null);
  assert.equal(presencePlace("unknown"), null);
  for (const place of places) {
    assert.equal(normalizePlace(place.id), place.id);
    assert.equal(presencePlace(place.id)?.building, place.building);
    const roomPose = inside(place);
    assert.deepEqual(presenceMapPosition(roomPose), { x: place.entrance.x, z: place.entrance.z });
    assert.equal(roomPose.place, place.id);
    assert.deepEqual(presenceMapPosition(outside(place)), { x: place.entrance.x, z: place.entrance.z });
  }
});

test("all six rooms accept bounded walking poses and reject forged locations, modes and height", () => {
  assert.equal(places.length, 6);
  assert.equal(parsePose(pose(0, 78))?.place, EXTERIOR_PLACE);
  assert.equal(parsePose(pose(9000, -9000))?.x, 768);
  assert.equal(parsePose({ ...pose(0, 78), place: null }), null);
  for (const place of places) {
    const entry = inside(place);
    assert.ok(validPresence(entry));
    assert.equal(parsePose(entry)?.place, place.id);
    assert.ok(validPresenceTransition(null, entry));
    assert.equal(parsePose({ ...entry, place: "unknown" }), null);
    assert.equal(parsePose({ ...entry, mode: "drive" }), null);
    assert.equal(parsePose({ ...entry, mode: "fly" }), null);
    assert.equal(parsePose({ ...entry, y: -0.01 }), null);
    assert.equal(parsePose({ ...entry, y: INTERIOR_FEET_LIMIT + 0.01 }), null);
    assert.equal(parsePose({ ...entry, x: Number.NaN }), null);
    assert.equal(parsePose({ ...entry, ...interiorWorld(place, place.width / 2, 0) }), null);
    assert.equal(parsePose({ ...entry, ...interiorWorld(place, 0, -place.depth / 2) }), null);
    const other = places.find(candidate => candidate.id !== place.id)!;
    assert.equal(parsePose({ ...inside(other), place: place.id }), null);
  }
});

test("entering requires the venue doorway; forced exits return only to that same doorway", () => {
  for (const place of places) {
    const street = outside(place), entry = inside(place), back = inside(place, 0, -place.depth / 2 + 1);
    assert.ok(validPresenceTransition(street, entry));
    assert.ok(validPresenceTransition(entry, street));
    assert.ok(validPresenceTransition(back, street), "transit and flight may escape from the back of a room");
    assert.ok(validPresenceTransition({ ...back, y: 2.5 }, street));
    assert.ok(validPresenceTransition(entry, back));
    assert.equal(validPresenceTransition(street, back), false);
    assert.equal(validPresenceTransition({ ...street, x: street.x + 8 }, entry), false);
    assert.equal(validPresenceTransition({ ...street, mode: "fly" }, entry), false);
    assert.equal(validPresenceTransition({ ...street, y: 20 }, entry), false);
    assert.equal(validPresenceTransition(back, { ...street, x: street.x + 1 }), false);
    assert.equal(validPresenceTransition(back, { ...street, mode: "fly" }), false);
    assert.equal(validPresenceTransition(back, { ...street, y: 1 }), false);
    const other = places.find(candidate => candidate.id !== place.id)!;
    assert.equal(validPresenceTransition(entry, inside(other)), false);
    assert.equal(validPresenceTransition(back, outside(other)), false);
  }
});

test("local poses carry venue presence without changing legacy locomotion", () => {
  const state = { x: 1, z: 2, eye: 2.7, yaw: 0.2, pitch: 0, speed: 0, mode: "walk" as const, car: null, rideHeading: null, inTrain: false };
  assert.equal(localPose(state).place, "");
  assert.equal(localPose({ ...state, place: "kiln" }).place, "kiln");
  assert.equal(localPose({ ...state, place: "kiln" }).y, 0);
});

test("place and transport transitions snap instead of blending or extrapolating through walls", () => {
  const buffer = new SnapshotBuffer();
  buffer.push(sample(0, 0));
  buffer.push(sample(0.1, 8, { place: "kiln" }));
  assert.equal(buffer.sample(0.09)?.place, "");
  assert.equal(buffer.sample(0.09)?.x, 0);
  assert.equal(buffer.sample(0.1)?.place, "kiln");
  assert.equal(buffer.sample(0.5)?.x, 8);
  buffer.push(sample(0.6, 3));
  assert.equal(buffer.sample(0.59)?.place, "kiln");
  assert.equal(buffer.sample(0.6)?.place, "");
  assert.equal(buffer.sample(0.9)?.x, 3);
  for (const mode of MODES.filter(candidate => candidate !== "walk")) {
    const transport = new SnapshotBuffer();
    transport.push(sample(0, 0));
    transport.push(sample(0.1, 12, { mode, y: 20 }));
    assert.equal(transport.sample(0.09)?.mode, "walk");
    assert.equal(transport.sample(0.09)?.y, 0);
    assert.equal(transport.sample(0.1)?.mode, mode);
    assert.equal(transport.sample(0.4)?.x, 12);
  }
  const sameTimestamp = new SnapshotBuffer();
  sameTimestamp.push(sample(1, 0));
  sameTimestamp.push(sample(1, 4, { place: "kiln" }));
  assert.equal(sameTimestamp.sample(1)?.place, "kiln");
  sameTimestamp.push(sample(0.9, 0));
  assert.equal(sameTimestamp.sample(2)?.place, "kiln");
});

test("a server clock reset immediately adopts the next room's epoch", () => {
  const clock = new ServerClock();
  clock.observe(600000, 610);
  assert.equal(clock.ready, true);
  clock.reset();
  assert.equal(clock.ready, false);
  clock.observe(0, 610.1);
  assert.equal(clock.serverNow(610.1), 0);
  assert.ok(Math.abs(clock.serverNow(610.2) - 0.1) < 1e-9);
});

test("two clients share room presence, reject invalid scope changes, and reconnect without a stale clock", { timeout: 30000 }, async () => {
  const { createNightfallServer } = await import("../server/app.ts");
  const { MultiplayerSession } = await import("../src/multiplayer/session.ts");
  const { gameServer, httpServer } = createNightfallServer();
  await gameServer.listen(0, "127.0.0.1");
  const serverUrl = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const host = new MultiplayerSession(), guest = new MultiplayerSession();
  const place = places[4], other = places[0];
  const hostSeen = () => guest.friends().find(friend => friend.id === host.getView().selfId);
  const guestSeen = () => host.friends().find(friend => friend.id === guest.getView().selfId);
  try {
    assert.ok(await host.connect({ serverUrl, name: "Host", pose: outside(place) }));
    const code = host.getView().code!;
    assert.ok(await guest.connect({ serverUrl, code, name: "Guest", pose: inside(place) }));
    await until(() => host.getView().roster.length === 2 && guest.getView().roster.length === 2, "initial roster");
    assert.equal(hostSeen()?.place, "");
    assert.equal(guestSeen()?.place, place.id);
    assert.equal(guest.getView().roster.find(player => player.self)?.place, place.id);
    assert.equal(host.remotes(performance.now() / 1000 + 1)[0]?.place, place.id);

    host.publish(outside(place), 100);
    host.publish(inside(place), 100.001);
    await until(() => hostSeen()?.place === place.id, "entry bypasses pose throttle");
    assert.ok(samePlace(hostSeen()?.place, guestSeen()?.place));
    assert.equal(guest.getView().roster.find(player => !player.self)?.place, place.id);
    assert.equal(guest.remotes(performance.now() / 1000 + 1)[0]?.place, place.id);

    host.publish(inside(other), 101);
    await pause(100);
    assert.equal(hostSeen()?.place, place.id, "direct room swaps are rejected");
    host.publish({ ...inside(place), x: 700, z: 700 }, 102);
    host.publish({ ...inside(place), mode: "fly" }, 103);
    await pause(100);
    assert.equal(hostSeen()?.place, place.id);
    assert.ok(Math.hypot(hostSeen()!.x - inside(place).x, hostSeen()!.z - inside(place).z) < 0.02);

    const notices: string[] = [];
    host.onEvent(event => notices.push(event.text));
    host.questIntent("mara", "accept:relay-chip");
    await until(() => notices.some(message => message.includes("with Mara")), "indoor street quest rejected");
    assert.equal(host.questSync()?.state.progress["relay-chip"], undefined);

    const back = inside(place, 0, -place.depth / 2 + 1);
    host.publish(back, 104);
    await until(() => Math.hypot((hostSeen()?.x ?? Infinity) - back.x, (hostSeen()?.z ?? Infinity) - back.z) < 0.02, "walk to the back of the room");
    host.publish(outside(place), 104.001);
    await until(() => hostSeen()?.place === "", "forced doorway exit bypasses movement clipping and throttle");
    assert.ok(Math.hypot(hostSeen()!.x - place.entrance.x, hostSeen()!.z - place.entrance.z) < 0.02);

    await host.leave();
    assert.ok(await host.connect({ serverUrl, code, name: "Host", pose: inside(other) }));
    await until(() => hostSeen()?.place === other.id && guestSeen()?.place === place.id, "different interior presence");
    assert.equal(samePlace(hostSeen()?.place, guestSeen()?.place), false);

    const mara = NPCS.find(npc => npc.id === "mara")!;
    await host.leave();
    assert.ok(await host.connect({ serverUrl, code, name: "Host", pose: pose(mara.x, mara.z, { y: 50 }) }));
    const before = notices.length;
    host.questIntent("mara", "accept:relay-chip");
    await until(() => notices.length > before, "street quest at wrong height rejected");
    assert.equal(host.questSync()?.state.progress["relay-chip"], undefined);

    await pause(800);
    host.publish(pose(mara.x, mara.z, { y: 50 }), 200);
    await until(() => guest.remotes(performance.now() / 1000 + 1)[0]?.y === 50, "old room clock observed");
    assert.ok(await host.connect({ serverUrl, name: "New host", pose: pose(0, 78) }));
    assert.ok(await guest.connect({ serverUrl, code: host.getView().code!, name: "Guest", pose: pose(0, 78) }));
    await until(() => guest.getView().roster.length === 2 && hostSeen()?.x === 0, "new room roster");
    host.publish(pose(1, 78, { speed: 5 }), 300);
    await until(() => hostSeen()?.x === 1, "first movement in new room");
    await pause(180);
    host.publish(pose(2, 78, { speed: 5 }), 300.2);
    await until(() => hostSeen()?.x === 2, "second movement in new room");
    const interpolated = guest.remotes(performance.now() / 1000)[0];
    assert.ok(interpolated && interpolated.x < 2.1, `new room uses its own clock: ${interpolated?.x}`);
    await guest.leave();
    assert.deepEqual(guest.remotes(performance.now() / 1000), []);
    assert.deepEqual(guest.friends(), []);
    await until(() => host.getView().roster.length === 1, "guest cleanup");
  } finally {
    await host.leave();
    await guest.leave();
    await gameServer.gracefullyShutdown(false);
  }
});
