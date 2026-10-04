import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { QuestBook, QUESTS } from "../src/city/quests.ts";
import { NPCS } from "../src/city/npcs.ts";
import { SnapshotBuffer, ServerClock, TELEPORT_DISTANCE, lerpAngle, type PoseSample } from "../src/multiplayer/interpolation.ts";
import {
  CHAT_MAX, NAME_MAX, RateLimiter, checkMove, defaultServerUrl, generateCode, inviteLink, normalizeCode, normalizeServerUrl,
  parsePose, parseQuestIntent, parseWaypoint, sanitizeName, sanitizeText, uniqueName, CODE_ALPHABET, CODE_LENGTH, TELEPORT_COOLDOWN, type PoseMessage,
} from "../src/multiplayer/protocol.ts";
import { localPose, mergeRemoteHeadlights } from "../src/multiplayer/engine-hooks.ts";

const sample = (time: number, x: number, extra: Partial<PoseSample> = {}): PoseSample => ({ time, x, y: 0, z: 0, yaw: 0, pitch: 0, heading: 0, speed: 5, mode: "walk", car: 0, ...extra });
const pose = (x: number, z: number, extra: Partial<PoseMessage> = {}): PoseMessage => ({ x, y: 0, z, yaw: 0, pitch: 0, heading: 0, speed: 0, mode: "walk", car: 0, ...extra });

// ---------------------------------------------------------------------------------------------
// Interpolation

test("snapshot buffer blends between the samples around the render time", () => {
  const buffer = new SnapshotBuffer();
  buffer.push(sample(1, 0));
  buffer.push(sample(1.1, 1));
  buffer.push(sample(1.2, 3));
  assert.equal(buffer.sample(0.5)?.x, 0, "before the first sample: clamped");
  assert.ok(Math.abs(buffer.sample(1.05)!.x - 0.5) < 1e-9);
  assert.ok(Math.abs(buffer.sample(1.15)!.x - 2) < 1e-9);
  // Out-of-order and duplicate samples are ignored.
  buffer.push(sample(1.1, 99));
  buffer.push(sample(1.2, 99));
  assert.ok(Math.abs(buffer.sample(1.15)!.x - 2) < 1e-9);
});

test("snapshot buffer extrapolates briefly, then holds", () => {
  const buffer = new SnapshotBuffer();
  buffer.push(sample(0, 0)); buffer.push(sample(0.1, 1));
  assert.ok(Math.abs(buffer.sample(0.15)!.x - 1.5) < 1e-9, "continues along the last velocity");
  assert.ok(Math.abs(buffer.sample(5)!.x - 3.5) < 1e-9, "at most MAX_EXTRAPOLATION (0.25 s) ahead");
  const still = new SnapshotBuffer();
  still.push(sample(0, 0, { speed: 0 })); still.push(sample(0.1, 1, { speed: 0 }));
  assert.equal(still.sample(0.2)!.x, 1, "a stopped player does not drift");
});

test("teleports snap, idle gaps hold the old pose, angles take the short way round", () => {
  const buffer = new SnapshotBuffer();
  buffer.push(sample(0, 0)); buffer.push(sample(0.1, TELEPORT_DISTANCE + 50));
  assert.equal(buffer.sample(0.05)!.x, 0);
  assert.equal(buffer.sample(0.1)!.x, TELEPORT_DISTANCE + 50);

  const idle = new SnapshotBuffer();
  idle.push(sample(0, 0)); idle.push(sample(5, 4));
  assert.equal(idle.sample(2)!.x, 0, "no slow-motion slide across a 5 s pause");
  assert.ok(idle.sample(4.97)!.x > 0 && idle.sample(4.97)!.x < 4);

  const a = 3.1, b = -3.1;
  const mid = lerpAngle(a, b, 0.5);
  assert.ok(Math.abs(Math.atan2(Math.sin(mid), Math.cos(mid))) > 3.1, "through ±π, not through 0");
});

test("driving on/off switches at the later sample (no half-car blend)", () => {
  const buffer = new SnapshotBuffer();
  buffer.push(sample(0, 0, { mode: "walk" })); buffer.push(sample(0.1, 1, { mode: "drive" }));
  assert.equal(buffer.sample(0.09)!.mode, "walk");
  assert.equal(buffer.sample(0.1)!.mode, "drive");
});

test("server clock tracks the smallest delay and ignores jitter spikes", () => {
  const clock = new ServerClock();
  clock.observe(10_000, 100.05); // 50 ms late
  clock.observe(10_100, 100.13); // 30 ms late: adopt at once
  clock.observe(10_200, 100.60); // a 400 ms spike: barely moves
  const offset = 100.13 - 10.1;
  assert.ok(Math.abs(clock.serverNow(101) - (101 - offset)) < 0.01);
});

// ---------------------------------------------------------------------------------------------
// Chat, names, codes

test("chat text is stripped of invisible characters and clamped", () => {
  const rtl = String.fromCharCode(0x202e), zw = String.fromCharCode(0x200b), bell = String.fromCharCode(7);
  assert.equal(sanitizeText(`  hi${bell}${rtl}there${zw}  \n\n friend `, 100), "hi there friend");
  assert.equal(sanitizeText("<img src=x onerror=alert(1)>", 100), "<img src=x onerror=alert(1)>", "markup is kept as text; React escapes it");
  assert.equal(sanitizeText(42, 10), "");
  assert.equal([...sanitizeText("x".repeat(500), CHAT_MAX)].length, CHAT_MAX);
  const emoji = String.fromCodePoint(0x1f303);
  assert.equal(sanitizeText(emoji.repeat(5), 3), emoji.repeat(3), "clamps by code point, never splits a pair");
  assert.equal(sanitizeName("   "), "Runner");
  assert.equal([...sanitizeName("n".repeat(80))].length, NAME_MAX);
  assert.equal(uniqueName("Kai", ["kai", "Kai 2"]), "Kai 3");
  assert.equal(uniqueName("Ren", ["Kai"]), "Ren");
});

test("chat rate limit: a burst, then one message per refill interval", () => {
  const limiter = new RateLimiter(5, 1.5);
  for (let i = 0; i < 5; i++) assert.ok(limiter.take(0), `burst ${i}`);
  assert.equal(limiter.take(0.1), false);
  assert.equal(limiter.take(1.0), false);
  assert.ok(limiter.take(1.7));
  assert.equal(limiter.take(1.8), false);
  assert.ok(limiter.take(100));
});

test("room codes use an unambiguous alphabet", () => {
  let n = 0;
  const code = generateCode(() => (n++ * 0.137) % 1);
  assert.equal(code.length, CODE_LENGTH);
  assert.ok([...code].every(c => CODE_ALPHABET.includes(c)));
  assert.equal(normalizeCode(" ab-cd 3 "), "ABCD3");
});

// ---------------------------------------------------------------------------------------------
// Movement validation

test("poses are parsed defensively and clamped into the world", () => {
  assert.equal(parsePose(null), null);
  assert.equal(parsePose({ x: 1, y: 0, z: 0, yaw: 0, pitch: 0, heading: 0, speed: 0, mode: "teleport" }), null);
  assert.equal(parsePose({ x: Number.NaN, y: 0, z: 0, yaw: 0, pitch: 0, heading: 0, speed: 0, mode: "walk" }), null);
  const clamped = parsePose({ x: 9999, y: -5, z: -9999, yaw: 7, pitch: 9, heading: 0, speed: 999, mode: "walk", car: -3 })!;
  assert.equal(clamped.x, 768); assert.equal(clamped.z, -768); assert.equal(clamped.y, 0);
  assert.ok(clamped.yaw < Math.PI && clamped.pitch <= 1.6 && clamped.speed <= 26 && clamped.car === 0);
});

test("moves beyond a mode's top speed are clamped unless a teleport is due", () => {
  const start = pose(0, 0);
  assert.deepEqual(checkMove(start, pose(2, 0), 0.1, 0), { pose: pose(2, 0), teleported: false, corrected: false });
  const fast = checkMove(start, pose(100, 0), 0.1, 0);
  assert.equal(fast.corrected, true);
  assert.ok(fast.pose.x < 10, "walking 100 m in 0.1 s is pulled back");
  const travel = checkMove(start, pose(500, 0), 0.1, TELEPORT_COOLDOWN + 0.1);
  assert.equal(travel.teleported, true, "atlas travel / taxis may jump once per cooldown");
  assert.equal(travel.pose.x, 500);
  assert.equal(checkMove(start, pose(10, 0, { mode: "fly" }), 0.1, 0).corrected, false, "flight is fast");
});

test("quest intents and waypoints are validated", () => {
  assert.deepEqual(parseQuestIntent({ npcId: "mara", optionId: "accept:relay-chip" }), { npcId: "mara", optionId: "accept:relay-chip" });
  assert.equal(parseQuestIntent({ npcId: 3 }), null);
  assert.equal(parseQuestIntent({ npcId: "m".repeat(100), optionId: "x" }), null);
  assert.equal(parseWaypoint({ id: "wp-1", x: 800, z: 0 }), null, "outside the city");
  assert.equal(parseWaypoint({ id: "../../x", x: 0, z: 0 }), null, "unsafe id");
  const waypoint = parseWaypoint({ id: "wp-1", x: 10, z: -20, label: "L".repeat(80), color: "red" })!;
  assert.equal([...waypoint.label].length, 40);
  assert.equal(waypoint.color, "#6ff0d0");
});

test("server URLs: explicit, env, remembered, same-host for local pages, nothing for tunnels", () => {
  const local = { protocol: "http:", hostname: "127.0.0.1", search: "", origin: "http://127.0.0.1:3000", pathname: "/" };
  const tunnel = { protocol: "https:", hostname: "city.trycloudflare.com", search: "", origin: "https://city.trycloudflare.com", pathname: "/" };
  assert.equal(defaultServerUrl(local, undefined, null), "ws://127.0.0.1:2567");
  assert.equal(defaultServerUrl({ ...local, hostname: "192.168.1.20" }, undefined, null), "ws://192.168.1.20:2567");
  assert.equal(defaultServerUrl(tunnel, undefined, null), null);
  assert.equal(defaultServerUrl(tunnel, "https://mp.trycloudflare.com", null), "wss://mp.trycloudflare.com");
  assert.equal(defaultServerUrl({ ...tunnel, search: "?room=ABCDE&server=wss%3A%2F%2Fa.ngrok-free.app" }, "https://env.example", null), "wss://a.ngrok-free.app");
  assert.equal(normalizeServerUrl("localhost:2567"), "ws://localhost:2567");
  assert.equal(normalizeServerUrl("abc.trycloudflare.com/"), "wss://abc.trycloudflare.com");
  assert.equal(normalizeServerUrl("ftp://nope"), null);
  assert.equal(inviteLink(local, "ABCDE", "ws://127.0.0.1:2567", undefined), "http://127.0.0.1:3000/?room=ABCDE");
  assert.equal(inviteLink(tunnel, "ABCDE", "wss://mp.trycloudflare.com", undefined), "https://city.trycloudflare.com/?room=ABCDE&server=wss%3A%2F%2Fmp.trycloudflare.com");
});

test("the engine pose: feet height per mode, car heading, remote headlights by distance", () => {
  const base = { x: 1, z: 2, eye: 2.7, yaw: 0.5, pitch: 0, speed: 3, mode: "walk" as const, car: null, rideHeading: null, inTrain: false };
  assert.equal(localPose(base).y, 0);
  assert.equal(localPose({ ...base, mode: "fly", eye: 52.7 }).y, 50);
  const car = { x: 1, z: 2, yaw: 1.2, id: 7, speed: 14, steer: 0, yawRate: 0, accel: 0, scraping: false };
  const driving = localPose({ ...base, mode: "drive", eye: 1.25, car });
  assert.deepEqual([driving.y, driving.heading, driving.speed, driving.car], [0, 1.2, 14, 7]);
  const lights = [{ x: 0, z: 0, yaw: 0, intensity: 1 }, { x: 50, z: 0, yaw: 0, intensity: 1 }];
  const remote = { id: "a", name: "A", color: [1, 2, 3] as const, hex: "#010203", x: 20, y: 0, z: 0, yaw: 0, pitch: 0, heading: 0.3, speed: 9, mode: "drive" as const, car: 1, stride: 0, place: "", carrier: null };
  mergeRemoteHeadlights(lights, [remote, { ...remote, mode: "walk" }], 0, 0, true);
  assert.deepEqual(lights.map(l => l.x), [0, 20, 50]);
});

// ---------------------------------------------------------------------------------------------
// Party quest state

test("QuestBook exports and adopts plain party state, validating it", () => {
  const leader = new QuestBook();
  leader.talk("mara"); leader.choose("accept:relay-chip"); leader.close();
  const state = leader.exportState();
  assert.deepEqual(state, { credits: 0, progress: { "relay-chip": { status: "active", step: 0 } } });

  const friend = new QuestBook();
  friend.applyState(state);
  assert.equal(friend.status("relay-chip"), "active");
  assert.equal(friend.marker("juno"), "objective");
  assert.equal(friend.tracked()?.title, "The Relay Chip");

  // Garbage is dropped; an "active" quest past its last step becomes ready.
  friend.applyState({ credits: Number.NaN, progress: { nope: { status: "active", step: 0 }, "relay-chip": { status: "active", step: 99 } } });
  assert.equal(friend.status("relay-chip"), "ready");
  assert.equal(friend.status("nope"), "locked");
  assert.equal(friend.credits, 0);

  // Completion elsewhere clears tracking and pays the shared purse.
  friend.applyState({ credits: 250, progress: { "relay-chip": { status: "complete", step: 1 } } });
  assert.equal(friend.tracked(), null);
  assert.equal(friend.credits, 250);
  assert.equal(friend.marker("mara"), null);
});

test("a stale dialogue option does nothing after the party moved on", () => {
  const book = new QuestBook();
  book.talk("mara");
  assert.equal(book.dialogue?.options[0].id, "accept:relay-chip");
  // Meanwhile a friend accepted it and fetched the chip.
  book.applyState({ credits: 0, progress: { "relay-chip": { status: "ready", step: 1 } } });
  assert.deepEqual(book.choose("accept:relay-chip"), { dialogue: null, message: null });
  assert.equal(book.status("relay-chip"), "ready");
});

// ---------------------------------------------------------------------------------------------
// Integration: the real Colyseus server in-process and two real clients (MultiplayerSession).

const wait = async (condition: () => boolean, label: string, timeout = 5000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(`timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

test("no server running: connecting fails with a clear message and nothing else happens", { timeout: 15000 }, async () => {
  const { MultiplayerSession } = await import("../src/multiplayer/session.ts");
  const session = new MultiplayerSession();
  assert.equal(await session.connect({ serverUrl: "ws://127.0.0.1:9", name: "Solo" }), false);
  assert.equal(session.getView().status, "error");
  assert.match(session.getView().error ?? "", /Couldn't reach the multiplayer server at ws:\/\/127\.0\.0\.1:9/);
  assert.deepEqual(session.remotes(1), []);
  assert.equal(session.questSync(), null);
  session.publish({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, heading: 0, speed: 0, mode: "walk", car: 0 }, 1); // no-op
  assert.equal(session.sendChat("hi"), false);
});

test("two clients: join by code, see each other move, chat, share quest progress", { timeout: 30000 }, async () => {
  const { createNightfallServer } = await import("../server/app.ts");
  const { MultiplayerSession } = await import("../src/multiplayer/session.ts");
  const { gameServer, httpServer } = createNightfallServer();
  await gameServer.listen(0, "127.0.0.1");
  const url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const mara = NPCS.find(n => n.id === "mara")!, juno = NPCS.find(n => n.id === "juno")!;
  const host = new MultiplayerSession(), guest = new MultiplayerSession();
  try {
    const walk = (x: number, z: number) => ({ x, y: 0, z, yaw: 0, pitch: 0, heading: 0, speed: 0, mode: "walk" as const, car: 0 });
    assert.ok(await host.connect({ serverUrl: url, name: "Kai", pose: walk(mara.x + 1, mara.z) }));
    const code = host.getView().code!;
    assert.match(code, /^[A-Z0-9]{5}$/);
    assert.equal(await guest.connect({ serverUrl: url, name: "Kai", code: "zzzzz" }), false, "unknown code");
    assert.match(guest.getView().error ?? "", /No room with that code/);
    assert.ok(await guest.connect({ serverUrl: url, name: "Kai", code: code.toLowerCase(), pose: walk(juno.x, juno.z) }));
    await wait(() => host.getView().roster.length === 2 && guest.getView().roster.length === 2, "roster");
    assert.deepEqual(guest.getView().roster.map(r => r.name).sort(), ["Kai", "Kai 2"], "names are made unique");

    // Movement: the host walks; the guest's interpolated view follows.
    for (let i = 1; i <= 12; i++) { host.publish(walk(mara.x + 1 + i * 0.5, mara.z), i * 0.1); await new Promise(r => setTimeout(r, 90)); }
    await wait(() => guest.friends().some(f => Math.abs(f.x - (mara.x + 7)) < 0.05), "friend position");
    const later = performance.now() / 1000 + 1;
    const seen = guest.remotes(later);
    assert.equal(seen.length, 1);
    assert.ok(Math.abs(seen[0].x - (mara.x + 7)) < 0.6, `interpolated x ${seen[0].x}`);
    assert.equal(seen[0].name, "Kai");


    // Chat: sanitised, broadcast, rate limited, with join notices.
    guest.sendChat(`hello ${String.fromCharCode(0x202e)}there`);
    await wait(() => host.getView().chat.some(l => l.kind === "chat" && l.text === "hello there"), "chat");
    assert.ok(host.getView().chat.some(l => l.kind === "system" && /Kai 2 joined/.test(l.text)));
    for (let i = 0; i < 8; i++) guest.sendChat(`spam ${i}`);
    await wait(() => guest.getView().chat.some(l => l.kind === "notice"), "rate limit notice");
    assert.ok(host.getView().chat.filter(l => l.text.startsWith("spam")).length < 8);

    // Quests: the host accepts from Mara; both books adopt the party state.
    const events: string[] = [];
    guest.onEvent(e => events.push(e.text));
    host.questIntent("mara", "accept:relay-chip");
    await wait(() => guest.questSync()?.state.progress["relay-chip"]?.status === "active", "quest accepted");
    await wait(() => events.some(e => /Kai · Quest accepted: The Relay Chip/.test(e)), "quest toast");
    const guestBook = new QuestBook();
    guestBook.applyState(guest.questSync()!.state);
    assert.equal(guestBook.marker("juno"), "objective");

    // The host is not at Juno's: the server refuses to advance the step for them.
    const rejected: string[] = [];
    host.onEvent(e => rejected.push(e.text));
    host.questIntent("juno", "continue:relay-chip");
    await wait(() => rejected.some(e => /with Juno/.test(e)), "far from npc");
    // The guest is standing at Juno's and collects the chip; completion needs Mara's hand-in.
    guest.questIntent("juno", "continue:relay-chip");
    await wait(() => host.questSync()?.state.progress["relay-chip"]?.status === "ready", "step done");
    guest.questIntent("mara", `complete:${QUESTS[0].id}`);
    await wait(() => events.some(e => /with Mara Voss/.test(e)), "guest is not at Mara's");
    host.questIntent("mara", "complete:relay-chip");
    await wait(() => guest.questSync()?.state.credits === 250, "shared purse");
    assert.equal(guest.questSync()?.state.progress["relay-chip"]?.status, "complete");
    host.questIntent("mara", "complete:relay-chip");
    await new Promise(r => setTimeout(r, 200));
    assert.equal(guest.questSync()?.state.credits, 250, "pays once");

    // Shared waypoints: validated, visible to everyone, removable only by their owner.
    host.addWaypoint({ id: "wp-a", x: 100, z: -50, label: "Noodles <b>", color: "#ffb347", shared: true });
    host.addWaypoint({ id: "wp-b", x: 5000, z: 0, label: "Nowhere", color: "#ffb347", shared: true });
    await wait(() => guest.sharedWaypoints().length === 1, "waypoint shared");
    assert.deepEqual({ ...guest.sharedWaypoints()[0], owner: "", createdAt: 0 }, { id: `${host.getView().selfId}:wp-a`, x: 100, z: -50, label: "Noodles <b>", color: "#ffb347", owner: "", ownerName: "Kai", mine: false, createdAt: 0 });
    guest.removeWaypoint("wp-a");
    await new Promise(r => setTimeout(r, 200));
    assert.equal(host.sharedWaypoints().length, 1, "not the guest's to remove");
    host.removeWaypoint("wp-a");
    await wait(() => guest.sharedWaypoints().length === 0, "owner removed it");

    // One teleport (atlas travel) is accepted; a second jump inside the cooldown is clamped.
    host.publish(walk(mara.x + 300, mara.z), 20);
    await wait(() => (guest.friends()[0]?.x ?? 0) > mara.x + 290, "teleport accepted");
    host.publish(walk(mara.x + 600, mara.z), 21);
    await new Promise(r => setTimeout(r, 300));
    assert.ok(guest.friends()[0].x < mara.x + 320, "a second instant 300 m jump is pulled back");

    // Leaving removes the player and posts a notice.
    await guest.leave();
    await wait(() => host.getView().roster.length === 1 && host.getView().chat.some(l => /Kai 2 left/.test(l.text)), "leave");
  } finally {
    await host.leave(); await guest.leave();
    await gameServer.gracefullyShutdown(false);
  }
});
