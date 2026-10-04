// The Nightfall party room. Authoritative for chat, quests and waypoints; for movement it accepts
// client poses (there is no server physics) but clamps them to the world and to plausible speeds.
import { Room, type Client } from "colyseus";
import { QuestBook } from "../src/city/quests.ts";
import { npcById } from "../src/city/npcs.ts";
import {
  CHAT_HISTORY, CHAT_MAX, MAX_PLAYERS, PLAYER_COLORS, QUEST_REACH, WAYPOINTS_PER_PLAYER, RateLimiter,
  checkMove, generateCode, parsePose, parseQuestIntent, parseWaypoint, parseWaypointId, sanitizeName, sanitizeText, uniqueName, waypointKey,
  type ChatMessage, type PoseMessage, type QuestEventMessage, type WaypointMessage,
} from "../src/multiplayer/protocol.ts";
import { NightfallState, PlayerState, QuestProgressState, WaypointState } from "./state.ts";
import { EXTERIOR_PLACE, STREET_INTERACTION_HEIGHT, samePlace, validPresence, validPresenceTransition } from "../src/multiplayer/presence.ts";
import { railPose, validRailPresence, validRailTransition } from "../src/multiplayer/rail.ts";

interface JoinOptions { name?: unknown; pose?: unknown }
interface PlayerMeta { pose: PoseMessage | null; poseTime: number; teleportTime: number; poses: RateLimiter; chat: RateLimiter; actions: RateLimiter; waypoints: RateLimiter; waypointNotices: RateLimiter; pendingWaypoints: Map<string, WaypointMessage> }

const CODES_KEY = "$nightfall-room-codes";
const SPAWN_POSE: PoseMessage = { x: 0, y: 0, z: 78, yaw: 0.12, pitch: -0.13, heading: 0.12, speed: 0, mode: "walk", car: 0 };

export class NightfallRoom extends Room<NightfallState> {
  maxClients = MAX_PLAYERS;
  state = new NightfallState();
  private readonly book = new QuestBook();
  private readonly meta = new Map<string, PlayerMeta>();
  private readonly history: ChatMessage[] = [];
  private readonly opened = performance.now();
  private chatId = 0;

  /** Milliseconds since the room opened (player `t` stamps and chat times). */
  private now(): number { return performance.now() - this.opened; }

  async onCreate(): Promise<void> {
    // Short, human-friendly room codes (players join with client.joinById(code)).
    const taken = new Set(await this.presence.smembers(CODES_KEY));
    let code = generateCode();
    while (taken.has(code)) code = generateCode();
    await this.presence.sadd(CODES_KEY, code);
    this.roomId = code;
    // schema() leaves primitive fields undefined until assigned.
    this.state.credits = 0;
    this.state.questRevision = 0;
    this.state.worldTimeMs = this.now();
    this.clock.setInterval(() => {
      this.state.worldTimeMs = this.now();
      const now = this.state.worldTimeMs / 1000;
      for (const [owner, meta] of this.meta) this.flushWaypoints(owner, meta, now);
    }, 250);

    this.onMessage("pose", (client, message: unknown) => this.handlePose(client, message));
    this.onMessage("chat", (client, message: unknown) => this.handleChat(client, message));
    this.onMessage("quest", (client, message: unknown) => this.handleQuest(client, message));
    this.onMessage("waypoint:add", (client, message: unknown) => this.handleWaypointAdd(client, message));
    this.onMessage("waypoint:remove", (client, message: unknown) => this.handleWaypointRemove(client, message));
  }

  onJoin(client: Client, options?: JoinOptions): void {
    this.state.worldTimeMs = this.now();
    const names: string[] = [], colors = new Set<string>();
    this.state.players.forEach(player => { names.push(player.name); colors.add(player.color); });
    const player = new PlayerState();
    player.name = uniqueName(sanitizeName(options?.name), names);
    player.color = PLAYER_COLORS.find(color => !colors.has(color)) ?? PLAYER_COLORS[this.state.players.size % PLAYER_COLORS.length];
    const parsed = parsePose(options?.pose) ?? SPAWN_POSE;
    const pose = parsed.carrier ? { ...parsed, ...railPose(parsed.carrier, this.now() / 1000) } : parsed;
    Object.assign(player, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, heading: pose.heading, speed: pose.speed, mode: pose.mode, car: pose.car, t: this.now(), place: pose.place ?? EXTERIOR_PLACE, trainId: pose.carrier?.train ?? -1, trainU: pose.carrier?.u ?? 0, trainV: pose.carrier?.v ?? 0, trainYaw: pose.carrier?.yaw ?? 0 });
    this.state.players.set(client.sessionId, player);
    this.meta.set(client.sessionId, { pose, poseTime: this.now(), teleportTime: -Infinity, poses: new RateLimiter(30, 1 / 40), chat: new RateLimiter(), actions: new RateLimiter(10, 0.5),
      // Joining republishes every shared waypoint at once: the burst must hold a full set.
      waypoints: new RateLimiter(WAYPOINTS_PER_PLAYER, 0.5), waypointNotices: new RateLimiter(1, 2), pendingWaypoints: new Map() });
    client.send("history", this.history);
    this.system(`${player.name} joined the room`);
  }

  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    const theirs: string[] = [];
    this.state.waypoints.forEach((waypoint, id) => { if (waypoint.owner === client.sessionId) theirs.push(id); });
    for (const id of theirs) this.state.waypoints.delete(id);
    if (player) this.system(`${player.name} left the room`);
  }

  async onDispose(): Promise<void> {
    await this.presence.srem(CODES_KEY, this.roomId);
  }

  private handlePose(client: Client, message: unknown): void {
    const meta = this.meta.get(client.sessionId), player = this.state.players.get(client.sessionId);
    const now = this.now();
    if (!meta || !player || !meta.poses.take(now / 1000)) return;
    const next = parsePose(message);
    if (!next || !validPresenceTransition(meta.pose, next) || !validRailTransition(meta.pose, next, now / 1000)) return;
    const canonical = next.carrier ? { ...next, ...railPose(next.carrier, now / 1000) } : next;
    const previous = meta.pose?.carrier ? { ...meta.pose, ...railPose(meta.pose.carrier, now / 1000) } : meta.pose;
    const scopeChanged = !samePlace(meta.pose?.place, next.place);
    const check = scopeChanged ? { pose: canonical, teleported: false, corrected: false } : checkMove(previous, canonical, (now - meta.poseTime) / 1000, (now - meta.teleportTime) / 1000);
    if (!validPresence(check.pose) || !validRailPresence(check.pose) || (check.corrected && (meta.pose?.carrier || next.carrier))) return;
    if (check.teleported) meta.teleportTime = now;
    const pose = check.pose;
    meta.pose = pose; meta.poseTime = now;
    player.x = pose.x; player.y = pose.y; player.z = pose.z; player.yaw = pose.yaw; player.pitch = pose.pitch;
    player.heading = pose.heading; player.speed = pose.speed; player.mode = pose.mode; player.car = pose.car; player.t = now; player.place = pose.place ?? EXTERIOR_PLACE;
    player.trainId = pose.carrier?.train ?? -1; player.trainU = pose.carrier?.u ?? 0; player.trainV = pose.carrier?.v ?? 0; player.trainYaw = pose.carrier?.yaw ?? 0;
  }

  private handleChat(client: Client, message: unknown): void {
    const meta = this.meta.get(client.sessionId), player = this.state.players.get(client.sessionId);
    if (!meta || !player) return;
    const text = sanitizeText(message, CHAT_MAX);
    if (!text) return;
    if (!meta.chat.take(this.now() / 1000)) { client.send("notice", "You're sending messages too fast. Wait a moment."); return; }
    this.post({ id: ++this.chatId, from: client.sessionId, name: player.name, color: player.color, text, time: this.now(), kind: "chat" });
  }

  /** A player chose a dialogue option that changed their local quest state. Replaying it on the
   * room's own QuestBook applies exactly the single-player rules: the option must exist in the
   * dialogue this NPC would open for the party right now, so nothing can be skipped or repeated. */
  private handleQuest(client: Client, message: unknown): void {
    const meta = this.meta.get(client.sessionId), player = this.state.players.get(client.sessionId);
    const intent = parseQuestIntent(message);
    if (!meta || !player || !intent || !meta.actions.take(this.now() / 1000)) return;
    const npc = npcById(this.book.npcs, intent.npcId);
    const reject = (reason: string) => client.send("questRejected", { reason });
    if (!npc || !meta.pose) return reject("Unknown contact.");
    if (meta.pose.place || meta.pose.mode !== "walk" || meta.pose.y > STREET_INTERACTION_HEIGHT || Math.hypot(meta.pose.x - npc.x, meta.pose.z - npc.z) > QUEST_REACH) return reject(`You need to be with ${npc.name}.`);
    this.book.talk(npc.id);
    const result = this.book.choose(intent.optionId);
    this.book.close();
    if (!result.message) return reject("Your party's contract has already moved on.");
    this.syncQuests();
    const event: QuestEventMessage = { name: player.name, color: player.color, message: result.message };
    this.broadcast("quest", event, { except: client });
  }

  private syncQuests(): void {
    const { credits, progress } = this.book.exportState();
    for (const [id, entry] of Object.entries(progress)) {
      const existing = this.state.quests.get(id) ?? new QuestProgressState();
      existing.status = entry.status; existing.step = entry.step;
      if (!this.state.quests.has(id)) this.state.quests.set(id, existing);
    }
    this.state.credits = credits;
    this.state.questRevision++;
  }

  private handleWaypointAdd(client: Client, message: unknown): void {
    const meta = this.meta.get(client.sessionId);
    if (!meta) return;
    const waypoint = parseWaypoint(message, client.sessionId);
    if (!waypoint) { this.waypointNotice(client, meta, "That waypoint could not be shared. Check its position and identifier."); return; }
    if (!waypoint.shared) return;
    const key = waypointKey(client.sessionId, waypoint.id);
    if (!this.state.waypoints.has(key) && !meta.pendingWaypoints.has(key)) {
      const reserved = new Set(meta.pendingWaypoints.keys());
      this.state.waypoints.forEach((state, id) => { if (state.owner === client.sessionId) reserved.add(id); });
      if (reserved.size >= WAYPOINTS_PER_PLAYER) { this.waypointNotice(client, meta, `You can share up to ${WAYPOINTS_PER_PLAYER} waypoints.`); return; }
    }
    meta.pendingWaypoints.set(key, waypoint);
    this.flushWaypoints(client.sessionId, meta, this.now() / 1000);
  }

  private handleWaypointRemove(client: Client, message: unknown): void {
    const meta = this.meta.get(client.sessionId);
    if (!meta) return;
    const id = parseWaypointId(message, client.sessionId);
    if (!id) { this.waypointNotice(client, meta, "Only your own waypoints can be removed."); return; }
    const key = waypointKey(client.sessionId, id);
    meta.pendingWaypoints.delete(key);
    if (this.state.waypoints.get(key)?.owner === client.sessionId) this.state.waypoints.delete(key);
  }

  private flushWaypoints(owner: string, meta: PlayerMeta, now: number): void {
    for (const [key, waypoint] of meta.pendingWaypoints) {
      if (!meta.waypoints.take(now)) break;
      meta.pendingWaypoints.delete(key);
      const existing = this.state.waypoints.get(key);
      const state = existing ?? new WaypointState();
      Object.assign(state, { id: key, x: waypoint.x, z: waypoint.z, label: waypoint.label, color: waypoint.color, owner, shared: true, createdAt: existing?.createdAt ?? Date.now() });
      if (!existing) this.state.waypoints.set(key, state);
    }
  }

  private waypointNotice(client: Client, meta: PlayerMeta, text: string): void {
    if (meta.waypointNotices.take(this.now() / 1000)) client.send("notice", text);
  }

  private system(text: string): void {
    this.post({ id: ++this.chatId, from: "", name: "", color: "", text, time: this.now(), kind: "system" });
  }
  private post(message: ChatMessage): void {
    this.history.push(message);
    if (this.history.length > CHAT_HISTORY) this.history.splice(0, this.history.length - CHAT_HISTORY);
    this.broadcast("chat", message);
  }
}
