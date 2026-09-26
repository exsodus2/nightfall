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

test("session lifecycle: leaving mid-connect cancels it; a full set of shared waypoints survives the join burst", { timeout: 30000 }, async () => {
  const { matchMaker } = await import("colyseus");
  const { createNightfallServer } = await import("../server/app.ts");
  const { MultiplayerSession } = await import("../src/multiplayer/session.ts");
  const { gameServer, httpServer } = createNightfallServer();
  await gameServer.listen(0, "127.0.0.1");
  const url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const ghost = new MultiplayerSession(), host = new MultiplayerSession();
  try {
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

    // Regression: joining republishes every shared waypoint at once, but the server metered them
    // with the 10-token quest/action bucket, silently dropping the rest of a full set.
    assert.ok(await host.connect({ serverUrl: url, name: "Kai" }));
    for (let i = 0; i < WAYPOINTS_PER_PLAYER; i++) host.addWaypoint({ id: `wp-${i}`, x: i * 10, z: -i * 10, label: `Stop ${i}`, color: "#ffb347", shared: true });
    await until(() => host.sharedWaypoints().length === WAYPOINTS_PER_PLAYER, "every waypoint of a full set is shared", 3000);
    assert.ok(host.sharedWaypoints().every(w => w.mine));
  } finally {
    await ghost.leave(); await host.leave();
    await gameServer.gracefullyShutdown(false);
  }
});
