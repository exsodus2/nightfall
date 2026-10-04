import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { DriveSession, type DriveCamera, type DriveInput } from "../src/city/driving.ts";
import { MouseLook, WALK_HEIGHT } from "../src/city/locomotion.ts";
import { PLATFORM_HEIGHT, TRAIN_EYE_HEIGHT } from "../src/city/metro.ts";
import { CityWorld } from "../src/city/world.ts";
import { localPose, type EngineState } from "../src/multiplayer/engine-hooks.ts";
import { checkMove, parsePose, type PoseMessage } from "../src/multiplayer/protocol.ts";
import { railPose, type TrainCarrier } from "../src/multiplayer/rail.ts";

const world = new CityWorld();
const resting: DriveInput = { throttle: 0, steer: 0, handbrake: false, boost: false };
const physicalPose = (session: DriveSession, view: DriveCamera) => localPose({ x: view.x, z: view.z, eye: view.height, yaw: view.yaw, pitch: view.pitch, speed: Math.abs(session.car.speed), mode: "drive", car: session.car, rideHeading: null, inTrain: false });
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

test("cockpit, chase and rapid orbit switches publish the stationary car body rather than its camera", () => {
  for (const chase of [false, true]) {
    const look = new MouseLook(0, 0), session = new DriveSession({ x: 0, z: 100, yaw: 0, id: 19 }, look, chase);
    let previous: PoseMessage | null = null;
    let biggestCameraOffset = 0;
    for (let frame = 0; frame < 120; frame++) {
      if ([10, 20, 35, 70].includes(frame)) session.toggleView();
      look.reset(frame % 2 ? Math.PI : -Math.PI / 2, frame % 3 ? 0.2 : -0.1);
      const view = session.update(world, resting, 1 / 60, look), pose = physicalPose(session, view);
      biggestCameraOffset = Math.max(biggestCameraOffset, Math.hypot(view.x - session.car.x, view.z - session.car.z));
      near(pose.x, session.car.x); near(pose.z, session.car.z);
      assert.equal(pose.y, 0);
      assert.equal(pose.heading, session.car.yaw);
      assert.equal(pose.yaw, view.yaw);
      assert.equal(pose.speed, 0);
      assert.equal(pose.car, 19);
      const parsed = parsePose(pose);
      assert.ok(parsed);
      const accepted = checkMove(previous, parsed, 0, 0);
      assert.equal(accepted.corrected, false, "moving the camera must not require a movement correction");
      assert.equal(accepted.teleported, false, "view switches do not consume a teleport allowance");
      previous = parsed;
    }
    assert.ok(biggestCameraOffset > 9, "the camera actually travels outside the vehicle body");
  }
});

test("moving and reversing cars publish signed physical velocity and body heading through view transitions", () => {
  for (const direction of [-1, 1]) {
    const look = new MouseLook(0, 0), session = new DriveSession({ x: 0, z: 100, yaw: 0, id: 37 }, look);
    let previous: PoseMessage | null = null;
    for (let frame = 0; frame < 80; frame++) {
      if (frame === 15 || frame === 50) session.toggleView();
      look.reset(frame % 2 ? -Math.PI / 2 : Math.PI / 2, 0);
      const view = session.update(world, { ...resting, throttle: direction, steer: 0.08 }, 1 / 60, look);
      const pose = physicalPose(session, view), parsed = parsePose(pose);
      assert.ok(parsed);
      near(pose.x, session.car.x); near(pose.z, session.car.z);
      assert.equal(pose.heading, session.car.yaw);
      assert.equal(pose.speed, session.car.speed);
      assert.equal(Math.sign(pose.speed), direction);
      assert.equal(pose.y, 0);
      assert.ok(Math.abs(pose.heading - pose.yaw) > 0.5, "look yaw remains independent of the chassis");
      const accepted = checkMove(previous, parsed, 1 / 60, 0);
      assert.equal(accepted.corrected, false);
      assert.equal(accepted.teleported, false);
      previous = parsed;
    }
  }
});

test("walking, indoor, flight, metro and journey pose coordinates retain their existing meaning", () => {
  const base: EngineState = { x: 25, z: -40, eye: WALK_HEIGHT, yaw: 0.7, pitch: -0.1, speed: 3, mode: "walk", car: null, rideHeading: null, inTrain: false };
  for (const state of [base, { ...base, place: "blue-hour" }, { ...base, mode: "fly" as const, eye: WALK_HEIGHT + 40 }, { ...base, mode: "taxi" as const, eye: 1.65, rideHeading: 1.2 }, { ...base, mode: "sky" as const, eye: 82, rideHeading: -1.1 }]) {
    const pose = localPose(state);
    assert.equal(pose.x, state.x); assert.equal(pose.z, state.z);
    assert.equal(pose.heading, state.rideHeading ?? state.yaw);
    assert.equal(pose.speed, state.speed);
    assert.equal(pose.place, state.place ?? "");
    assert.equal(pose.car, 0);
  }
  assert.equal(localPose({ ...base, mode: "fly", eye: WALK_HEIGHT + 40 }).y, 40);
  assert.equal(localPose({ ...base, mode: "sky", eye: 82 }).y, 80.8);
  const carrier: TrainCarrier = { train: 0, u: 0.4, v: 3, yaw: 0.2 }, location = railPose(carrier, 25);
  const rider = localPose({ ...base, ...location, mode: "metro", eye: PLATFORM_HEIGHT + TRAIN_EYE_HEIGHT, inTrain: true, carrier });
  assert.equal(rider.x, location.x); assert.equal(rider.z, location.z);
  near(rider.y, PLATFORM_HEIGHT);
  assert.deepEqual(rider.carrier, carrier);
  assert.ok(parsePose(rider));
});

test("two real clients keep a stationary driver's body fixed while its camera orbits", { timeout: 15000 }, async () => {
  const { createNightfallServer } = await import("../server/app.ts");
  const { MultiplayerSession } = await import("../src/multiplayer/session.ts");
  const { gameServer, httpServer } = createNightfallServer();
  await gameServer.listen(0, "127.0.0.1");
  const serverUrl = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const driver = new MultiplayerSession(), observer = new MultiplayerSession();
  const look = new MouseLook(0, 0), session = new DriveSession({ x: 0, z: 100, yaw: 0, id: 71 }, look, true);
  const firstView = session.update(world, resting, 1 / 60, look);
  try {
    assert.ok(await driver.connect({ serverUrl, name: "Driver", pose: physicalPose(session, firstView) }));
    assert.ok(await observer.connect({ serverUrl, name: "Observer", code: driver.getView().code! }));
    for (let frame = 0; frame < 16; frame++) {
      look.reset(frame % 2 ? Math.PI : -Math.PI / 2, 0);
      if (frame === 6 || frame === 10) session.toggleView();
      const view = session.update(world, resting, 0.1, look);
      driver.publish(physicalPose(session, view), frame * 0.1);
      await new Promise(resolve => setTimeout(resolve, 70));
      const remote = observer.remotes(performance.now() / 1000 + 0.5).find(avatar => avatar.id === driver.getView().selfId);
      assert.ok(remote);
      near(remote.x, session.car.x); near(remote.z, session.car.z);
      near(remote.heading, session.car.yaw);
      assert.equal(remote.y, 0); assert.equal(remote.speed, 0);
    }
  } finally {
    await driver.leave(); await observer.leave();
    await gameServer.gracefullyShutdown(false);
  }
});
