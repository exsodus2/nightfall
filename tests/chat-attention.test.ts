import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { ChatAttention, CHAT_ATTENTION_LIMIT, CHAT_PREVIEW_MS, CHAT_UNREAD_LIMIT, chatRoomKey } from "../src/components/chat-attention.ts";
import type { ChatLine } from "../src/multiplayer/session.ts";

const room = chatRoomKey({ serverUrl: "ws://localhost:3002", code: "ABCDE", selfId: "self" });
const message = (id: number, extra: Partial<ChatLine> = {}): ChatLine => ({ id: `c${id}`, kind: "chat", name: "Runner", color: "#6ff0d0", text: `Message ${id}`, self: false, ...extra });

test("old history never previews or creates unread before or after a live message", () => {
  for (const late of [false, true]) {
    const attention = new ChatAttention();
    const history = [message(1, { history: true }), message(2, { history: true })];
    if (!late) attention.observe(room, history, false, 0);
    attention.observe(room, [message(3)], false, 10);
    const live = attention.getSnapshot();
    assert.equal(live.unread, 1);
    assert.equal(live.preview?.id, "c3");
    attention.observe(room, history, false, 20);
    assert.equal(attention.getSnapshot(), live);
    attention.observe(room, [...history, message(3, { history: true })], false, 30);
    assert.equal(attention.getSnapshot(), live);
    attention.observe(room, [...history, message(3), message(4)], false, 40);
    assert.equal(attention.getSnapshot().unread, 2);
    assert.equal(attention.getSnapshot().preview?.id, "c4");
  }
  const attention = new ChatAttention();
  attention.observe(room, [message(1, { history: true })], false, 0);
  attention.observe(room, [message(1)], false, 10);
  assert.equal(attention.getSnapshot().unread, 0);
  assert.equal(attention.getSnapshot().preview, null);
});

test("system, notice and own messages do not expand closed chat", () => {
  const attention = new ChatAttention();
  attention.observe(room, [message(1, { kind: "system" }), message(2, { kind: "notice" }), message(3, { self: true })], false, 10);
  assert.deepEqual(attention.getSnapshot(), { room, unread: 0, preview: null, expiresAt: 0 });
  attention.observe(room, [message(4)], false, 20);
  const live = attention.getSnapshot();
  attention.observe(room, [message(5, { kind: "system" }), message(6, { self: true })], false, 50);
  assert.equal(attention.getSnapshot(), live);
});

test("preview expiry leaves unread intact and duplicate snapshots never extend its life", () => {
  const attention = new ChatAttention();
  attention.observe(room, [message(1), message(1), message(2)], false, 100);
  assert.equal(attention.getSnapshot().unread, 2);
  assert.equal(attention.getSnapshot().preview?.id, "c2");
  assert.equal(attention.getSnapshot().expiresAt, 100 + CHAT_PREVIEW_MS);
  const live = attention.getSnapshot();
  attention.observe(room, [message(1), message(2)], false, 500);
  attention.expire(100 + CHAT_PREVIEW_MS - 1);
  assert.equal(attention.getSnapshot(), live);
  attention.expire(100 + CHAT_PREVIEW_MS);
  assert.equal(attention.getSnapshot().unread, 2);
  assert.equal(attention.getSnapshot().preview, null);
  attention.observe(room, [message(1), message(2)], false, 100 + CHAT_PREVIEW_MS + 1);
  assert.equal(attention.getSnapshot().preview, null);
});

test("panel subscriptions may unmount and remount without losing unread or reviving old previews", () => {
  const attention = new ChatAttention();
  let notifications = 0;
  const stop = attention.subscribe(() => { notifications++; });
  attention.observe(room, [message(1)], false, 0);
  stop();
  attention.observe(room, [message(1)], false, CHAT_PREVIEW_MS + 1);
  assert.equal(attention.getSnapshot().unread, 1);
  assert.equal(attention.getSnapshot().preview, null);
  assert.equal(notifications, 1);
  const resumed = attention.subscribe(() => { notifications++; });
  attention.observe(room, [message(1), message(2)], false, CHAT_PREVIEW_MS + 2);
  assert.equal(attention.getSnapshot().unread, 2);
  assert.equal(attention.getSnapshot().preview?.id, "c2");
  assert.equal(notifications, 2);
  resumed();
});

test("opening marks messages read, including arrivals while reading, until new closed-chat messages", () => {
  const attention = new ChatAttention();
  attention.observe(room, [message(1)], false, 0);
  attention.observe(room, [message(1)], true, 1);
  assert.deepEqual(attention.getSnapshot(), { room, unread: 0, preview: null, expiresAt: 0 });
  attention.observe(room, [message(1), message(2)], true, 2);
  attention.observe(room, [message(1), message(2)], false, 3);
  assert.equal(attention.getSnapshot().unread, 0);
  attention.observe(room, [message(1), message(2), message(3)], false, 4);
  assert.equal(attention.getSnapshot().unread, 1);
  assert.equal(attention.getSnapshot().preview?.id, "c3");
});

test("room, server and connection changes reset unread and allow reused wire IDs", () => {
  const attention = new ChatAttention();
  const contexts = [
    { serverUrl: "ws://localhost:3002", code: "ABCDE", selfId: "self" },
    { serverUrl: "ws://localhost:3002", code: "FGHIJ", selfId: "self" },
    { serverUrl: "ws://localhost:3003", code: "FGHIJ", selfId: "self" },
    { serverUrl: "ws://localhost:3003", code: "FGHIJ", selfId: "reconnected" },
  ];
  for (const context of contexts) {
    const nextRoom = chatRoomKey(context);
    attention.observe(nextRoom, [message(1, { history: true })], false, 0);
    assert.deepEqual(attention.getSnapshot(), { room: nextRoom, unread: 0, preview: null, expiresAt: 0 });
    attention.observe(nextRoom, [message(2)], false, 1);
    assert.equal(attention.getSnapshot().unread, 1);
  }
  attention.observe(null, [message(3)], false, 2);
  assert.deepEqual(attention.getSnapshot(), { room: null, unread: 0, preview: null, expiresAt: 0 });
  assert.equal(chatRoomKey({ ...contexts[0], selfId: null }), null);
  assert.notEqual(chatRoomKey({ serverUrl: "a/b", code: "c", selfId: "d" }), chatRoomKey({ serverUrl: "a", code: "b/c", selfId: "d" }));
});

test("message history and unread work stay bounded with old numeric IDs still deduplicated", () => {
  const attention = new ChatAttention();
  for (let id = 1; id <= 300; id++) attention.observe(room, [message(id)], false, id);
  assert.equal(attention.getSnapshot().unread, CHAT_UNREAD_LIMIT);
  const live = attention.getSnapshot();
  attention.observe(room, [message(1), message(300)], false, 301);
  assert.equal(attention.getSnapshot(), live);
  const incoming = Array.from({ length: 300 }, (_, index) => message(index + 301));
  const fresh = new ChatAttention();
  fresh.observe(room, incoming, false, 302);
  assert.equal(fresh.getSnapshot().unread, CHAT_ATTENTION_LIMIT);
  assert.equal(fresh.getSnapshot().preview?.id, "c600");
});

test("invalid clocks do not create immortal previews or affect unread delivery", () => {
  const attention = new ChatAttention();
  attention.observe(room, [message(1)], false, NaN);
  assert.equal(attention.getSnapshot().unread, 1);
  assert.equal(attention.getSnapshot().preview, null);
  attention.observe(room, [message(2)], false, 10);
  attention.expire(NaN);
  assert.equal(attention.getSnapshot().preview?.id, "c2");
  attention.observe(room, [message(2)], false, Infinity);
  assert.equal(attention.getSnapshot().preview, null);
});

test("real sessions distinguish historical chat from incoming and self messages", { timeout: 15000 }, async () => {
  const { createNightfallServer } = await import("../server/app.ts");
  const { MultiplayerSession } = await import("../src/multiplayer/session.ts");
  const { gameServer, httpServer } = createNightfallServer();
  await gameServer.listen(0, "127.0.0.1");
  const serverUrl = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const host = new MultiplayerSession(), guest = new MultiplayerSession();
  const wait = async (predicate: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!predicate()) { assert.ok(Date.now() < deadline, "message arrived"); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  try {
    assert.ok(await host.connect({ serverUrl, name: "Host" }));
    host.sendChat("Old conversation");
    await wait(() => host.getView().chat.some(line => line.text === "Old conversation"));
    assert.ok(await guest.connect({ serverUrl, name: "Guest", code: host.getView().code ?? undefined }));
    await wait(() => guest.getView().chat.some(line => line.text === "Old conversation"));
    assert.equal(guest.getView().chat.find(line => line.text === "Old conversation")?.history, true);
    const attention = new ChatAttention();
    attention.observe(chatRoomKey(guest.getView()), guest.getView().chat, false, 0);
    assert.equal(attention.getSnapshot().unread, 0);
    host.sendChat("Fresh message");
    await wait(() => guest.getView().chat.some(line => line.text === "Fresh message"));
    assert.notEqual(guest.getView().chat.find(line => line.text === "Fresh message")?.history, true);
    attention.observe(chatRoomKey(guest.getView()), guest.getView().chat, false, 1);
    assert.equal(attention.getSnapshot().unread, 1);
    guest.sendChat("My own message");
    await wait(() => guest.getView().chat.some(line => line.text === "My own message"));
    assert.equal(guest.getView().chat.find(line => line.text === "My own message")?.self, true);
    attention.observe(chatRoomKey(guest.getView()), guest.getView().chat, false, 2);
    assert.equal(attention.getSnapshot().unread, 1);
  } finally { await guest.leave(); await host.leave(); await gameServer.gracefullyShutdown(false); }
});
