import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Room } from "colyseus.js";

// One server per file: Colyseus' matchmaker is process-wide and does not restart after a shutdown.
const until = async (condition: () => boolean | Promise<boolean>, label: string, timeout = 12000) => {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeout) throw new Error(`timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

test("a dropped connection gets back into the same room, and a room that closed reopens under its code", { timeout: 60000 }, async () => {
  const { matchMaker } = await import("colyseus");
  const { createNightfallServer } = await import("../server/app.ts");
  const { MultiplayerSession } = await import("../src/multiplayer/session.ts");
  const { gameServer, httpServer } = createNightfallServer();
  await gameServer.listen(0, "127.0.0.1");
  const url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const host = new MultiplayerSession(), friend = new MultiplayerSession();
  // Simulates a network drop: the socket closes without the "leaving" handshake.
  const drop = (session: InstanceType<typeof MultiplayerSession>) => (session as unknown as { room: Room | null }).room?.connection.close(3000);
  const rooms = async () => (await matchMaker.query({})).map(room => room.roomId);
  try {
    // Regression: a drop removed the player at once and, if they were alone, disposed the room,
    // so its code was gone and could not be joined or recreated.
    assert.ok(await host.connect({ serverUrl: url, name: "Kai" }));
    const code = host.getView().code!, selfId = host.getView().selfId;
    drop(host);
    await until(() => host.getView().status === "reconnecting", "the drop is noticed");
    assert.equal(host.getView().code, code, "the code stays on screen while reconnecting");
    assert.deepEqual(await rooms(), [code], "the room outlives its only player's drop");
    await until(() => host.getView().status === "connected", "back in the room");
    assert.equal(host.getView().code, code);
    assert.equal(host.getView().selfId, selfId, "the held seat is reclaimed");

    // With a friend watching, the dropped player never leaves the roster.
    assert.ok(await friend.connect({ serverUrl: url, name: "Mira", code }));
    await until(() => friend.getView().roster.length === 2, "both in the room");
    drop(host);
    await until(() => host.getView().status === "reconnecting", "second drop is noticed");
    await until(() => host.getView().status === "connected", "back again");
    assert.equal(friend.getView().roster.length, 2);
    assert.ok(!friend.getView().chat.some(line => /left the room/.test(line.text)), "no leave/join churn for a reconnect");
    await friend.leave();

    // The room itself goes away (e.g. the server restarted): the client reopens it under the same code.
    drop(host);
    await until(() => host.getView().status === "reconnecting", "third drop is noticed");
    await matchMaker.getLocalRoomById(code)?.disconnect();
    await until(() => host.getView().status === "connected", "reopened");
    assert.equal(host.getView().code, code, "the reopened room keeps the shared code");

    // Players can also reopen a closed room by code themselves; an open code is refused.
    const taken = await friend.connect({ serverUrl: url, name: "Mira", code, create: true });
    assert.equal(taken, false);
    assert.match(friend.getView().error ?? "", /already open/);
    await host.leave();
    await until(async () => !(await rooms()).includes(code), "a consented leave closes the empty room");
    assert.ok(await friend.connect({ serverUrl: url, name: "Mira", code, create: true }));
    assert.equal(friend.getView().code, code);
  } finally {
    await friend.leave(); await host.leave();
    await gameServer.gracefullyShutdown(false);
  }
});
