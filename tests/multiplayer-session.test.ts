import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { ROOM_NAME, WAYPOINTS_PER_PLAYER } from "../src/multiplayer/protocol.ts";

// One server per file: Colyseus' matchmaker is process-wide and does not restart after a shutdown.
const until = async (condition: () => boolean | Promise<boolean>, label: string, timeout = 8000) => {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeout) throw new Error(`timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

test("session lifecycle: leaving mid-connect cancels it; a full set of shared waypoints survives the join burst", { timeout: 30000 }, async (context) => {
  const { matchMaker } = await import("colyseus");
  const { createNightfallServer } = await import("../server/app.ts");
  const { NightfallRoom } = await import("../server/room.ts");
  const { MultiplayerSession } = await import("../src/multiplayer/session.ts");
  const { gameServer, httpServer } = createNightfallServer();
  await gameServer.listen(0, "127.0.0.1");
  const url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const ghost = new MultiplayerSession(), host = new MultiplayerSession();
  try {
    const immediate = ghost.connect({ serverUrl: url, name: "Cancelled immediately" });
    await ghost.leave();
    assert.equal(await immediate, false, "leave cancels before the first connection await resolves");
    assert.equal(ghost.getView().status, "idle");

    // Regression: leave() while the room was still being created was ignored, so the session
    // attached the room afterwards and sat "connected" (an invisible player in a room) after the
    // player had left or the page had unmounted.
    let left: Promise<void> | null = null;
    const stop = ghost.subscribe(() => { if (!left && ghost.getView().status === "connecting") left = ghost.leave(); });
    const pending = ghost.connect({ serverUrl: url, name: "Ghost" });
    assert.equal(await pending, false, "a cancelled connect reports failure");
    stop();
    await left;
    assert.equal(ghost.getView().status, "idle");
    assert.equal(ghost.connected, false);
    assert.equal(ghost.getView().error, null);
    await until(async () => (await matchMaker.query({ name: ROOM_NAME })).every(room => room.clients === 0), "the cancelled room is left");

    const creationStarted = Promise.withResolvers<void>(), finishCreation = Promise.withResolvers<void>();
    const createRoom = NightfallRoom.prototype.onCreate;
    const delayedCreation = context.mock.method(NightfallRoom.prototype, "onCreate", async function(this: InstanceType<typeof NightfallRoom>) {
      creationStarted.resolve();
      await finishCreation.promise;
      await createRoom.call(this);
    });
    const lateRoom = ghost.connect({ serverUrl: url, name: "Cancelled request" });
    await creationStarted.promise;
    await ghost.leave();
    finishCreation.resolve();
    assert.equal(await lateRoom, false, "a room joined after cancellation is retired rather than attached");
    delayedCreation.mock.restore();
    await until(async () => (await matchMaker.query({ name: ROOM_NAME })).every(room => room.clients === 0), "late server room is left");
    assert.equal(ghost.getView().status, "idle");

    // Regression: joining republishes every shared waypoint at once, but the server metered them
    // with the 10-token quest/action bucket, silently dropping the rest of a full set.
    assert.ok(await host.connect({ serverUrl: url, name: "Kai" }));
    for (let i = 0; i < WAYPOINTS_PER_PLAYER; i++) host.addWaypoint({ id: `wp-${i}`, x: i * 10, z: -i * 10, label: `Stop ${i}`, color: "#ffb347", shared: true });
    await until(() => host.sharedWaypoints().length === WAYPOINTS_PER_PLAYER, "every waypoint of a full set is shared", 3000);
    assert.ok(host.sharedWaypoints().every(w => w.mine));

    const superseded = ghost.connect({ serverUrl: url, name: "Superseded" });
    const latest = ghost.connect({ serverUrl: url, name: "Latest", code: host.getView().code! });
    assert.equal(await superseded, false);
    assert.ok(await latest);
    await until(() => host.getView().roster.length === 2 && ghost.sharedWaypoints().length === WAYPOINTS_PER_PLAYER, "latest room connection wins");
    assert.equal(ghost.getView().code, host.getView().code);
    assert.equal(ghost.getView().roster.find(player => player.self)?.name, "Latest");

    const slowSwitch = ghost.connect({ serverUrl: url, name: "Old switch" });
    const finalSwitch = ghost.connect({ serverUrl: url, name: "Final switch", code: host.getView().code! });
    assert.equal(await slowSwitch, false, "waiting for the previous room to close cannot make an old request win");
    assert.ok(await finalSwitch);
    await until(() => ghost.getView().roster.find(player => player.self)?.name === "Final switch", "latest switch survives older close completion");
    assert.equal(ghost.getView().code, host.getView().code);
    await ghost.leave();

    let leftFromState: Promise<void> | null = null;
    const stopOnRoster = ghost.subscribe(() => {
      if (!leftFromState && ghost.getView().roster.length) leftFromState = ghost.leave();
    });
    await ghost.connect({ serverUrl: url, name: "Retired during state", code: host.getView().code! });
    await until(() => leftFromState !== null, "leave from a synchronous state listener");
    await leftFromState;
    stopOnRoster();
    assert.equal(ghost.getView().status, "idle");
    assert.deepEqual(ghost.sharedWaypoints(), [], "the retired state callback cannot repopulate pins");
    assert.equal(ghost.questSync(), null, "the retired state callback cannot restore party state");
  } finally {
    await ghost.leave(); await host.leave();
    await gameServer.gracefullyShutdown(false);
  }
});
