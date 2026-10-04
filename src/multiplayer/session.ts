// Browser side of multiplayer: one Colyseus connection, remote-player interpolation, chat, the
// party quest state and shared waypoints. The engine sees it only as a MultiplayerLink; React
// subscribes to a small immutable view. colyseus.js is imported on demand, so solo play never
// downloads it and a missing server can only produce an error message.
import type { Room } from "colyseus.js";
import type { QuestBookState } from "../city/quests";
import { ServerClock, SnapshotBuffer } from "./interpolation.ts";
import { CHAT_MAX, INTERPOLATION_DELAY, ROOM_NAME, SEND_INTERVAL, hexToRgb, isMode, normalizeCode, sanitizeText, type ChatMessage, type Mode, type QuestEventMessage, type WaypointMessage } from "./protocol.ts";
import type { FriendPosition, LocalPose, MultiplayerLink, PartyQuestSync, RemoteAvatar } from "./types";
import { EXTERIOR_PLACE, normalizePlace, samePlace } from "./presence.ts";
import { parseTrainCarrier, railPose, sameCarrier, type TrainCarrier } from "./rail.ts";

// Room state as the client decodes it (reflected schema instances; only what we read).
interface MapView<V> { forEach(callback: (value: V, key: string) => void): void; get(key: string): V | undefined; readonly size: number }
interface PlayerView { name: string; color: string; x: number; y: number; z: number; yaw: number; pitch: number; heading: number; speed: number; mode: string; car: number; t: number; place?: string; trainId?: number; trainU?: number; trainV?: number; trainYaw?: number }
interface QuestView { status: string; step: number }
interface WaypointView { id: string; x: number; z: number; label: string; color: string; owner: string; shared: boolean; createdAt: number }
interface StateView { players?: MapView<PlayerView>; quests?: MapView<QuestView>; credits?: number; questRevision?: number; waypoints?: MapView<WaypointView>; worldTimeMs?: number }

export type SessionStatus = "idle" | "connecting" | "connected" | "error";
export interface ChatLine { id: string; kind: "chat" | "system" | "notice"; name: string; color: string; text: string; self: boolean }
export interface RosterEntry { id: string; name: string; color: string; mode: Mode; self: boolean; place: string }
export interface SessionView { status: SessionStatus; error: string | null; code: string | null; serverUrl: string | null; selfId: string | null; roster: readonly RosterEntry[]; chat: readonly ChatLine[] }
/** One-off notifications for toasts. */
export interface SessionEvent { kind: "quest" | "notice" | "disconnected"; text: string }
export interface SharedWaypoint { id: string; x: number; z: number; label: string; color: string; owner: string; ownerName: string; mine: boolean; createdAt: number }
export interface ConnectRequest { serverUrl: string; name: string; code?: string; pose?: LocalPose }

interface RemoteEntry { id: string; name: string; hex: string; buffer: SnapshotBuffer; lastT: number; stride: number; lastNow: number; latest: PlayerView }

const CHAT_KEEP = 60;
const round = (value: number, digits = 100) => Math.round(value * digits) / digits;

function describeError(error: unknown, serverUrl: string, joining: boolean): string {
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code: unknown }).code) : NaN;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (code === 4212 || /not found|invalid room/i.test(message)) return joining ? "No room with that code. Check the code, or create a new room." : message;
  if (/full|locked/i.test(message)) return "That room is full.";
  if (message && !/^(Failed to fetch|Network|xhr|undefined)/i.test(message) && Number.isFinite(code)) return message;
  return `Couldn't reach the multiplayer server at ${serverUrl}. Is \`npm run server\` running, and is the address (or tunnel) right?`;
}

export class MultiplayerSession implements MultiplayerLink {
  private room: Room<StateView> | null = null;
  private view: SessionView = { status: "idle", error: null, code: null, serverUrl: null, selfId: null, roster: [], chat: [] };
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: SessionEvent) => void>();
  private readonly waypointListeners = new Set<(all: readonly SharedWaypoint[]) => void>();
  private readonly remotesById = new Map<string, RemoteEntry>();
  private readonly clock = new ServerClock();
  private readonly worldClock = new ServerClock();
  private lastWorldStamp = -1;
  private remoteList: RemoteAvatar[] = [];
  private friendList: FriendPosition[] = [];
  private waypointList: SharedWaypoint[] = [];
  private waypointSignature = "";
  private rosterSignature = "";
  private quest: PartyQuestSync | null = null;
  private questRevision = -1;
  private lastSend = -Infinity;
  private lastMode: Mode | null = null;
  private lastPlace = EXTERIOR_PLACE;
  private lastCarrier: TrainCarrier | null = null;
  private lastSpeed = 0;
  private attempt = 0;

  // ---- React ------------------------------------------------------------------------------
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getView = (): SessionView => this.view;
  onEvent(listener: (event: SessionEvent) => void): () => void { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener); }; }
  get connected(): boolean { return this.view.status === "connected"; }

  private update(patch: Partial<SessionView>): void {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
  private emit(event: SessionEvent): void { for (const listener of this.eventListeners) listener(event); }
  private addChat(line: ChatLine): void { this.update({ chat: [...this.view.chat, line].slice(-CHAT_KEEP) }); }

  // ---- Connection ---------------------------------------------------------------------------
  /** Creates a room (no code) or joins one by code. Never throws: failures land in the view. */
  async connect(request: ConnectRequest): Promise<boolean> {
    await this.leave();
    const attempt = ++this.attempt;
    const joining = !!request.code;
    this.update({ status: "connecting", error: null, serverUrl: request.serverUrl, chat: [] });
    try {
      const { Client } = await import("colyseus.js");
      // ngrok's free tier shows a browser warning page unless this header is sent (the server allows it).
      const headers: Record<string, string> = /ngrok/i.test(request.serverUrl) ? { "ngrok-skip-browser-warning": "1" } : {};
      const client = new Client(request.serverUrl, { headers });
      const options = { name: request.name, pose: request.pose };
      const room = joining ? await client.joinById<StateView>(normalizeCode(request.code ?? ""), options) : await client.create<StateView>(ROOM_NAME, options);
      if (attempt !== this.attempt) { void room.leave(true); return false; }
      this.attach(room);
      this.update({ status: "connected", code: room.roomId, selfId: room.sessionId, error: null });
      return true;
    } catch (error) {
      if (attempt === this.attempt) this.update({ status: "error", error: describeError(error, request.serverUrl, joining) });
      return false;
    }
  }

  async leave(): Promise<void> {
    // Also cancels a connect still in flight: its room is left as soon as it arrives.
    this.attempt++;
    const room = this.room;
    this.detach();
    this.update({ status: "idle", code: null, selfId: null, roster: [], error: null });
    if (room) await room.leave(true).catch(() => undefined);
  }

  private attach(room: Room<StateView>): void {
    this.room = room;
    room.onStateChange((state) => this.onState(state));
    room.onMessage("chat", (message: ChatMessage) => this.addChat({ id: `c${message.id}`, kind: message.kind, name: message.name, color: message.color, text: sanitizeText(message.text, CHAT_MAX), self: message.from === room.sessionId }));
    room.onMessage("history", (messages: ChatMessage[]) => {
      if (!Array.isArray(messages)) return;
      this.update({ chat: messages.map(m => ({ id: `c${m.id}`, kind: m.kind, name: m.name, color: m.color, text: sanitizeText(m.text, CHAT_MAX), self: m.from === room.sessionId })) });
    });
    room.onMessage("notice", (text: string) => { this.addChat({ id: `n${performance.now()}`, kind: "notice", name: "", color: "", text: sanitizeText(text, CHAT_MAX), self: false }); });
    room.onMessage("quest", (event: QuestEventMessage) => this.emit({ kind: "quest", text: `${sanitizeText(event.name, 24)} · ${sanitizeText(event.message, 120)}` }));
    room.onMessage("questRejected", (message: { reason?: string }) => {
      // Re-adopt the authoritative state: the optimistic local change was refused.
      if (this.quest) this.quest = { key: this.quest.key + 1, state: this.quest.state };
      this.emit({ kind: "notice", text: sanitizeText(message?.reason ?? "The party's quest state changed.", 120) });
    });
    room.onLeave((code) => {
      if (this.room !== room) return;
      this.detach();
      const consented = code === 4000;
      this.update({ status: consented ? "idle" : "error", code: null, selfId: null, roster: [], error: consented ? null : "Disconnected from the room. The server may have stopped; you can rejoin with the same code." });
      if (!consented) this.emit({ kind: "disconnected", text: "Multiplayer disconnected. Still exploring solo." });
    });
    room.onError((_code, message) => this.emit({ kind: "notice", text: `Multiplayer error: ${sanitizeText(message ?? "unknown", 120)}` }));
  }

  private detach(): void {
    this.room?.removeAllListeners();
    this.room = null;
    this.remotesById.clear(); this.remoteList = []; this.friendList = [];
    this.quest = null; this.questRevision = -1; this.rosterSignature = ""; this.lastMode = null;
    this.clock.reset(); this.lastSend = -Infinity; this.lastPlace = EXTERIOR_PLACE;
    this.worldClock.reset(); this.lastWorldStamp = -1; this.lastCarrier = null; this.lastSpeed = 0;
    if (this.waypointList.length) { this.waypointList = []; this.waypointSignature = ""; this.notifyWaypoints(); }
  }

  private onState(state: StateView): void {
    const room = this.room;
    if (!room || !state.players) return;
    const now = performance.now() / 1000, selfId = room.sessionId;
    if (typeof state.worldTimeMs === "number" && Number.isFinite(state.worldTimeMs) && state.worldTimeMs >= 0 && state.worldTimeMs > this.lastWorldStamp) {
      this.worldClock.observe(state.worldTimeMs, now);
      this.lastWorldStamp = state.worldTimeMs;
    }
    const roster: RosterEntry[] = [], friends: FriendPosition[] = [], seen = new Set<string>();
    state.players.forEach((player, id) => {
      const mode: Mode = isMode(player.mode) ? player.mode : "walk";
      const place = normalizePlace(player.place) ?? EXTERIOR_PLACE;
      const carrier = mode === "metro" && !place ? parseTrainCarrier({ train: player.trainId, u: player.trainU, v: player.trainV, yaw: player.trainYaw }) : null;
      roster.push({ id, name: player.name, color: player.color, mode, self: id === selfId, place });
      if (id === selfId) return;
      seen.add(id);
      friends.push({ id, name: player.name, color: player.color, x: player.x, z: player.z, yaw: player.yaw, mode, place, carrier });
      let entry = this.remotesById.get(id);
      if (!entry) { entry = { id, name: player.name, hex: player.color, buffer: new SnapshotBuffer(), lastT: -1, stride: 0, lastNow: now, latest: player }; this.remotesById.set(id, entry); }
      entry.name = player.name; entry.hex = player.color; entry.latest = player;
      if (player.t !== entry.lastT || !samePlace(entry.buffer.newest?.place, place) || entry.buffer.newest?.mode !== mode || !sameCarrier(entry.buffer.newest?.carrier, carrier) || (entry.buffer.newest?.speed !== 0 && player.speed === 0)) {
        entry.lastT = player.t;
        this.clock.observe(player.t, now);
        entry.buffer.push({ time: player.t / 1000, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, heading: player.heading, speed: player.speed, mode, car: player.car, place, carrier });
      }
    });
    for (const id of [...this.remotesById.keys()]) if (!seen.has(id)) this.remotesById.delete(id);
    this.friendList = friends;
    const signature = roster.map(r => `${r.id}|${r.name}|${r.color}|${r.mode}|${r.place}`).join(";");
    if (signature !== this.rosterSignature) { this.rosterSignature = signature; this.update({ roster }); }

    // Party quests: adopt on every accepted transition.
    const revision = state.questRevision ?? 0;
    if (revision !== this.questRevision && state.quests) {
      this.questRevision = revision;
      const progress: Record<string, { status: "active" | "ready" | "complete"; step: number }> = {};
      state.quests.forEach((entry, id) => { if (entry.status === "active" || entry.status === "ready" || entry.status === "complete") progress[id] = { status: entry.status, step: entry.step }; });
      const questState: QuestBookState = { credits: state.credits ?? 0, progress };
      this.quest = { key: (this.quest?.key ?? 0) + 1, state: questState };
    }

    // Shared waypoints.
    if (state.waypoints) {
      const list: SharedWaypoint[] = [];
      state.waypoints.forEach((w) => list.push({ id: w.id, x: w.x, z: w.z, label: w.label, color: w.color, owner: w.owner, ownerName: state.players?.get(w.owner)?.name ?? "", mine: w.owner === selfId, createdAt: w.createdAt }));
      const signature = list.map(w => `${w.id}|${w.x}|${w.z}|${w.label}|${w.color}|${w.ownerName}`).join(";");
      if (signature !== this.waypointSignature) { this.waypointSignature = signature; this.waypointList = list; this.notifyWaypoints(); }
    }
  }

  // ---- Chat ---------------------------------------------------------------------------------
  sendChat(text: string): boolean {
    const clean = sanitizeText(text, CHAT_MAX);
    if (!clean || !this.room) return false;
    this.room.send("chat", clean);
    return true;
  }

  // ---- MultiplayerLink (engine) ---------------------------------------------------------------
  publish(pose: LocalPose, now: number): void {
    if (!this.room) return;
    const place = normalizePlace(pose.place);
    if (place === null) return;
    const carrier = parseTrainCarrier(pose.carrier);
    if (pose.carrier && !carrier) return;
    const speed = round(pose.speed), stopped = speed === 0 && this.lastSpeed !== 0;
    if (now - this.lastSend < SEND_INTERVAL && pose.mode === this.lastMode && place === this.lastPlace && sameCarrier(carrier, this.lastCarrier) && !stopped) return;
    this.lastSend = now; this.lastMode = pose.mode; this.lastPlace = place; this.lastCarrier = carrier; this.lastSpeed = speed;
    this.room.send("pose", { x: round(pose.x), y: round(pose.y), z: round(pose.z), yaw: round(pose.yaw, 1000), pitch: round(pose.pitch, 1000), heading: round(pose.heading, 1000), speed, mode: pose.mode, car: pose.car, place, carrier });
  }

  worldTime(now: number): number | null {
    return this.room && this.worldClock.ready ? Math.max(0, this.worldClock.serverNow(now)) : null;
  }

  remotes(now: number): readonly RemoteAvatar[] {
    if (!this.room || !this.remotesById.size) return this.remoteList.length ? (this.remoteList = []) : this.remoteList;
    const renderTime = this.clock.serverNow(now) - INTERPOLATION_DELAY;
    const worldTime = this.worldTime(now);
    const list: RemoteAvatar[] = [];
    for (const entry of this.remotesById.values()) {
      const pose = entry.buffer.sample(renderTime);
      if (!pose) continue;
      const dt = Math.min(0.2, Math.max(0, now - entry.lastNow)); entry.lastNow = now;
      entry.stride += Math.min(Math.abs(pose.speed), 20) * dt * 1.15;
      const position = pose.carrier && worldTime !== null ? railPose(pose.carrier, worldTime) : pose;
      list.push({ id: entry.id, name: entry.name, hex: entry.hex, color: hexToRgb(entry.hex), x: position.x, y: position.y, z: position.z, yaw: position.yaw, pitch: pose.pitch, heading: position.heading, speed: pose.speed, mode: pose.mode, car: pose.car, stride: entry.stride, place: pose.place ?? EXTERIOR_PLACE, carrier: pose.carrier ?? null });
    }
    this.remoteList = list;
    return list;
  }

  friends(): readonly FriendPosition[] {
    const worldTime = this.worldTime(performance.now() / 1000);
    return worldTime === null ? this.friendList : this.friendList.map(friend => friend.carrier ? { ...friend, ...railPose(friend.carrier, worldTime) } : friend);
  }
  questSync(): PartyQuestSync | null { return this.quest; }
  questIntent(npcId: string, optionId: string): void { this.room?.send("quest", { npcId, optionId }); }

  // ---- Shared waypoints (waypoint-sync.ts) ---------------------------------------------------
  sharedWaypoints(): readonly SharedWaypoint[] { return this.waypointList; }
  onWaypoints(listener: (all: readonly SharedWaypoint[]) => void): () => void { this.waypointListeners.add(listener); return () => { this.waypointListeners.delete(listener); }; }
  private notifyWaypoints(): void { for (const listener of this.waypointListeners) listener(this.waypointList); }
  addWaypoint(waypoint: WaypointMessage): void { this.room?.send("waypoint:add", waypoint); }
  removeWaypoint(id: string): void { this.room?.send("waypoint:remove", id); }
}
