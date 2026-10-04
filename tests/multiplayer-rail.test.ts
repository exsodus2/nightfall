import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { SchemaType } from "@colyseus/schema";
import type { Client as ServerClient } from "colyseus";
import { PLATFORM_HEIGHT, TRAIN_EYE_HEIGHT, trainAt, worldToLocal } from "../src/city/metro.ts";
import { localPose } from "../src/multiplayer/engine-hooks.ts";
import { SnapshotBuffer, type PoseSample } from "../src/multiplayer/interpolation.ts";
import { parsePose, type PoseMessage } from "../src/multiplayer/protocol.ts";
import { CARRIER_WALK_SPEED, METRO_TIME_OFFSET, RAIL_HEIGHT_SLACK, parseTrainCarrier, railPose, sameCarrier, validRailPresence, validRailTransition, type TrainCarrier } from "../src/multiplayer/rail.ts";

const carrier: TrainCarrier = { train: 1, u: 0, v: 4, yaw: 0.3 };
const riderPose = (attached: TrainCarrier, time: number, extra: Partial<PoseMessage> = {}): PoseMessage => ({ ...railPose(attached, time), pitch: 0, speed: 0, mode: "metro", car: 0, place: "", carrier: attached, ...extra });
const sample = (time: number, attached: TrainCarrier, extra: Partial<PoseSample> = {}): PoseSample => ({ ...riderPose(attached, time), time, ...extra });
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const until = async (condition: () => boolean, label: string, timeout = 8000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out: ${label}`);
    await delay(20);
  }
};
const near = (actual: number, expected: number, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test("carrier payloads are optional but strictly validate train, carriage bounds, scope and height", () => {
  for (let train = 0; train < 4; train++) {
    const attached = { ...carrier, train };
    const parsed = parsePose(riderPose(attached, 20));
    assert.ok(parsed?.carrier);
    assert.equal(parsed.carrier.train, train);
    near(parsed.carrier.yaw, attached.yaw);
    assert.equal(parsed.y, PLATFORM_HEIGHT);
  }
  for (const malformed of [null, {}, [], { ...carrier, train: -1 }, { ...carrier, train: 4 }, { ...carrier, train: 1.5 }, { ...carrier, u: 2, v: 5 }, { ...carrier, u: 4 }, { ...carrier, v: 22 }, { ...carrier, yaw: Infinity }]) assert.equal(parseTrainCarrier(malformed), null);
  const valid = riderPose(carrier, 20);
  assert.equal(parsePose({ ...valid, carrier: undefined })?.carrier, null);
  assert.equal(parsePose({ ...valid, carrier: null })?.carrier, null);
  assert.equal(parsePose({ ...valid, carrier: {} }), null);
  assert.equal(parsePose({ ...valid, carrier: false }), null);
  assert.equal(parsePose({ ...valid, mode: "walk" }), null);
  assert.equal(parsePose({ ...valid, mode: "fly" }), null);
  assert.equal(parsePose({ ...valid, place: "kiln" }), null);
  assert.equal(parsePose({ ...valid, y: 0 }), null);
  assert.equal(parsePose({ ...valid, y: PLATFORM_HEIGHT + RAIL_HEIGHT_SLACK + 0.01 }), null);
  assert.equal(parsePose({ ...valid, speed: 99, car: 42 })?.speed, CARRIER_WALK_SPEED);
  assert.equal(parsePose({ ...valid, speed: 99, car: 42 })?.car, 0);
  assert.equal(validRailPresence({ ...valid, place: "blue-hour" }), false);
});

test("normal carrier attachment requires rail-height proximity and cannot switch trains directly", () => {
  const next = riderPose(carrier, 25);
  const platform = { ...next, carrier: null, mode: "walk" };
  assert.ok(validRailTransition(platform, next, 25));
  assert.ok(validRailTransition(next, { ...next, carrier: null, mode: "fly" }, 25));
  assert.equal(validRailTransition({ ...platform, y: 0 }, next, 25), false);
  assert.equal(validRailTransition({ ...platform, mode: "fly" }, next, 25), false);
  assert.equal(validRailTransition({ ...platform, x: platform.x + 100 }, next, 25), false);
  assert.equal(validRailTransition(next, { ...next, x: next.x + 100 }, 25), false);
  assert.equal(validRailTransition(next, riderPose({ ...carrier, train: 0 }, 25), 25), false);
  assert.equal(validRailTransition(next, { ...next, carrier: null }, 25), false);
  assert.equal(sameCarrier(carrier, { ...carrier, u: 1, yaw: 1 }), true);
  assert.equal(sameCarrier(carrier, null), false);
  assert.equal(sameCarrier(undefined, null), true);
});

test("carrier reconstruction follows every curve with fixed local position and relative facing", () => {
  for (let time = 0; time < 700; time += 1.7) {
    const train = trainAt(time + METRO_TIME_OFFSET, carrier.train);
    const position = railPose(carrier, time);
    const local = worldToLocal(train, position.x, position.z);
    near(local.u, carrier.u);
    near(local.v, carrier.v);
    near(Math.atan2(Math.sin(position.yaw - train.yaw), Math.cos(position.yaw - train.yaw)), carrier.yaw);
    assert.equal(position.y, PLATFORM_HEIGHT);
  }
});

test("carriage interpolation blends local movement, holds stale riders aboard and snaps attachment changes", () => {
  const buffer = new SnapshotBuffer();
  buffer.push(sample(0, { ...carrier, u: -0.5, v: 2, yaw: 3.1 }, { speed: 4 }));
  buffer.push(sample(0.1, { ...carrier, u: 0.5, v: 4, yaw: -3.1 }, { speed: 4 }));
  const middle = buffer.sample(0.05)!;
  assert.ok(middle.carrier);
  near(middle.carrier.u, 0);
  near(middle.carrier.v, 3);
  assert.ok(Math.abs(middle.carrier.yaw) > 3.1);
  const stale = buffer.sample(60)!;
  assert.ok(stale.carrier);
  assert.equal(stale.carrier.u, 0.5);
  assert.equal(stale.carrier.v, 4);
  assert.equal(stale.speed, 0);
  const currentTrain = trainAt(60 + METRO_TIME_OFFSET, carrier.train);
  const anchored = railPose(stale.carrier, 60);
  near(worldToLocal(currentTrain, anchored.x, anchored.z).v, 4);
  const transition = new SnapshotBuffer();
  transition.push(sample(0, carrier));
  transition.push(sample(0.1, { ...carrier, train: 0 }));
  assert.equal(transition.sample(0.09)?.carrier?.train, carrier.train);
  assert.equal(transition.sample(0.1)?.carrier?.train, 0);
  transition.push({ ...sample(0.2, carrier), carrier: null, mode: "walk" });
  assert.equal(transition.sample(0.19)?.carrier?.train, 0);
  assert.equal(transition.sample(0.2)?.carrier, null);
  const stopping = new SnapshotBuffer();
  stopping.push(sample(1, carrier, { speed: 4 }));
  stopping.push(sample(1, { ...carrier, u: 0.1 }, { speed: 0 }));
  assert.equal(stopping.sample(1)?.speed, 0);
  assert.equal(stopping.sample(1)?.carrier?.u, 0.1);
});

test("the engine's carrier pose preserves local gait speed and rail floor height", () => {
  const position = railPose(carrier, 25);
  const result = localPose({ ...position, eye: PLATFORM_HEIGHT + TRAIN_EYE_HEIGHT, pitch: 0, speed: 2.5, mode: "metro", car: null, rideHeading: null, inTrain: true, carrier });
  near(result.y, PLATFORM_HEIGHT);
  assert.equal(result.speed, 2.5);
  assert.deepEqual(result.carrier, carrier);
});

test("room clock heartbeats and carrier presence work without movement, with safe transitions and old-server fallback", { timeout: 30000 }, async () => {
  const { createNightfallServer } = await import("../server/app.ts");
  const { MultiplayerSession } = await import("../src/multiplayer/session.ts");
  const { Room } = await import("colyseus");
  const { schema } = await import("@colyseus/schema");
  const { Client } = await import("colyseus.js");
  const LegacyPlayer = schema({ name: "string", color: "string", x: "float32", y: "float32", z: "float32", yaw: "float32", pitch: "float32", heading: "float32", speed: "float32", mode: "string", car: "uint16", t: "float64" });
  const LegacyState = schema({ players: { map: LegacyPlayer } });
  class LegacyRoom extends Room<SchemaType<typeof LegacyState>> {
    state = new LegacyState();
    onCreate(): void { this.roomId = "OLDER"; }
    onJoin(client: ServerClient): void {
      const player = new LegacyPlayer();
      Object.assign(player, { name: "Legacy", color: "#6ff0d0", x: 0, y: 0, z: 78, yaw: 0, pitch: 0, heading: 0, speed: 0, mode: "walk", car: 0, t: 0 });
      this.state.players.set(client.sessionId, player);
    }
    onLeave(client: ServerClient): void { this.state.players.delete(client.sessionId); }
  }
  const { gameServer, httpServer } = createNightfallServer();
  gameServer.define("legacy-clock-test", LegacyRoom);
  await gameServer.listen(0, "127.0.0.1");
  const serverUrl = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const host = new MultiplayerSession(), guest = new MultiplayerSession();
  const legacyHost = await new Client(serverUrl).create<unknown>("legacy-clock-test");
  const hostSeen = () => guest.friends().find(friend => friend.id === host.getView().selfId);
  const now = () => performance.now() / 1000;
  try {
    assert.equal(host.worldTime(now()), null);
    assert.ok(await host.connect({ serverUrl, name: "Rider", pose: riderPose(carrier, 500) }));
    await until(() => host.worldTime(now()) !== null, "clock while alone with no poses");
    const initial = host.worldTime(now())!;
    assert.ok(initial < 0.5, "new room has its own epoch, not the supplied player pose");
    await delay(600);
    assert.ok(host.worldTime(now())! - initial > 0.45, "world heartbeat runs without other players or movement");
    const code = host.getView().code!;
    assert.ok(await guest.connect({ serverUrl, code, name: "Passenger", pose: riderPose({ ...carrier, u: 0.6 }, 800) }));
    await until(() => guest.worldTime(now()) !== null && hostSeen()?.carrier?.train === 1, "late rider joins shared clock");
    near(host.worldTime(now())!, guest.worldTime(now())!, 0.15);
    const before = hostSeen()!;
    await delay(650);
    const later = hostSeen()!;
    assert.ok(Math.hypot(later.x - before.x, later.z - before.z) > 10, "rider follows moving train without new pose packets");
    const moment = now(), seen = guest.remotes(moment).find(remote => remote.id === host.getView().selfId)!;
    const expected = railPose(carrier, guest.worldTime(moment)!);
    near(seen.x, expected.x, 0.02); near(seen.z, expected.z, 0.02);
    assert.equal(seen.speed, 0, "train speed does not animate walking legs");

    host.publish(riderPose({ ...carrier, u: 0.4 }, host.worldTime(now())!, { speed: 4 }), 100);
    host.publish(riderPose({ ...carrier, u: 0.45 }, host.worldTime(now())!, { speed: 0 }), 100.001);
    await until(() => Math.abs((hostSeen()?.carrier?.u ?? Infinity) - 0.45) < 0.01, "stopping bypasses pose throttle");
    host.publish(riderPose({ ...carrier, train: 0 }, host.worldTime(now())!), 101);
    await delay(100);
    assert.equal(hostSeen()?.carrier?.train, 1, "direct train swaps rejected");
    host.publish(riderPose(carrier, host.worldTime(now())!, { y: 0 }), 102);
    host.publish(riderPose(carrier, host.worldTime(now())!, { x: 700, z: 700 }), 103);
    await delay(100);
    near(hostSeen()!.carrier!.u, 0.45, 0.01);

    const detached = riderPose({ ...carrier, u: 0.45 }, host.worldTime(now())!, { carrier: null, mode: "fly" });
    host.publish(detached, 104);
    await until(() => hostSeen()?.mode === "fly" && hostSeen()?.carrier === null, "forced rail exit clears attachment atomically");
    const flying = hostSeen()!;
    host.publish(riderPose(carrier, host.worldTime(now())!), 105);
    await delay(100);
    assert.equal(hostSeen()?.carrier, null, "flying cannot claim a rail carrier");
    near(hostSeen()!.x, flying.x, 0.02);

    assert.ok(await host.connect({ serverUrl, name: "Fresh", pose: riderPose(carrier, 900) }));
    assert.ok(await guest.connect({ serverUrl, code: host.getView().code!, name: "Passenger", pose: riderPose(carrier, 900) }));
    await until(() => guest.worldTime(now()) !== null, "clock after reconnect");
    assert.ok(guest.worldTime(now())! < 0.5, "old room's clock is reset");
    assert.ok(await guest.connect({ serverUrl, code: legacyHost.roomId, name: "Legacy guest" }));
    await until(() => guest.getView().roster.length === 2, "legacy room state");
    assert.equal(guest.worldTime(now()), null, "no heartbeat field means no inferred world clock");
    const legacyRemote = guest.remotes(now())[0];
    assert.equal(legacyRemote.place, "");
    assert.equal(legacyRemote.carrier, null);
    await guest.leave();
    assert.equal(guest.worldTime(now()), null);
  } finally {
    await host.leave(); await guest.leave(); await legacyHost.leave();
    await gameServer.gracefullyShutdown(false);
  }
});
