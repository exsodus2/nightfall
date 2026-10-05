// Multiplayer protocol: constants, message shapes and pure validation shared by the Colyseus
// server (server/, run by Node with type stripping) and the browser client. No DOM, no
// Colyseus imports, `.ts` specifiers only, so both sides load the exact same rules.
import { WORLD_EDGE } from "../city/world.ts";
import type { TravelMode } from "../city/locomotion";
import { normalizePlace, validPresence } from "./presence.ts";
import { CARRIER_WALK_SPEED, parseTrainCarrier, validRailPresence, type TrainCarrier } from "./rail.ts";

export const ROOM_NAME = "nightfall";
export const DEFAULT_PORT = 2567;
export const MAX_PLAYERS = 8;
/** Client pose send rate (Hz). The server patches state at 20 Hz; clients render at frame rate. */
export const SEND_RATE = 12;
export const SEND_INTERVAL = 1 / SEND_RATE;
/** Remote players are drawn this far in the past so there are two samples to blend between. */
export const INTERPOLATION_DELAY = 0.16;
export const NAME_MAX = 20;
export const CHAT_MAX = 200;
export const CHAT_HISTORY = 30;
/** Chat: bursts of 5, then one message every 1.5 s. */
export const CHAT_BURST = 5;
export const CHAT_REFILL_SECONDS = 1.5;
export const WAYPOINT_LABEL_MAX = 40;
export const WAYPOINTS_PER_PLAYER = 24;
/** How close (m) a player's last reported position must be to an NPC for a quest action to count. */
export const QUEST_REACH = 14;
export const CODE_LENGTH = 5;
/** No 0/O, 1/I/L: codes are read aloud and typed from chat. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** A dropped connection keeps its seat (and the room, if it was the last player) this long. */
export const RECONNECT_SECONDS = 45;
export const PLAYER_COLORS: readonly string[] = ["#6ff0d0", "#ff5fb4", "#ffb347", "#8fa8ff", "#b6ff6a", "#ff6f61", "#f4e76e", "#c792ff"];

export const MODES = ["walk", "fly", "metro", "taxi", "sky", "drive"] as const satisfies readonly TravelMode[];
export type Mode = (typeof MODES)[number];
export const isMode = (value: unknown): value is Mode => typeof value === "string" && (MODES as readonly string[]).includes(value);

/** Client -> server, ~12 Hz. `y` is the height of the feet (or the vehicle's floor) above the street. */
export interface PoseMessage { x: number; y: number; z: number; yaw: number; pitch: number; heading: number; speed: number; mode: Mode; car: number; place?: string; carrier?: TrainCarrier | null }
export interface QuestIntentMessage { npcId: string; optionId: string }
/** Server -> clients. */
export interface ChatMessage { id: number; from: string; name: string; color: string; text: string; time: number; kind: "chat" | "system" }
export interface QuestEventMessage { name: string; color: string; message: string }
export interface WaypointMessage { id: string; x: number; z: number; label: string; color: string; shared: boolean }

// ---------------------------------------------------------------------------------------------
// Text

// Control characters, bidi overrides/isolates and zero-width marks are removed: they can hide or
// reorder text. React renders the rest as text nodes, so markup is never interpreted.
const INVISIBLE = new RegExp("[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]", "g");

/** Chat text: invisible characters removed, whitespace collapsed, trimmed, clamped by code point. */
export function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  const chars = [...clean];
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : clean;
}
export function sanitizeName(value: unknown): string {
  return sanitizeText(value, NAME_MAX) || "Runner";
}
/** Appends " 2", " 3"… so every name in a room is distinct. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const lower = new Set(taken.map(n => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`, candidate = [...name].slice(0, NAME_MAX - suffix.length).join("") + suffix;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}
export function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}
/** A code a client may ask to (re)open a room under: already normalized, 4-12 characters. */
export function isRoomCode(value: unknown): value is string {
  return typeof value === "string" && value.length >= 4 && normalizeCode(value) === value;
}
export function generateCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return code;
}
export function isHexColor(value: unknown): value is string { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value); }
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(isHexColor(hex) ? hex.slice(1) : "6ff0d0", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------------------------
// Rate limiting

/** Token bucket: `burst` tokens, refilled one per `refillSeconds`. Time in seconds. */
export class RateLimiter {
  private tokens: number;
  private last: number | null = null;
  readonly burst: number;
  readonly refillSeconds: number;
  constructor(burst = CHAT_BURST, refillSeconds = CHAT_REFILL_SECONDS) { this.burst = burst; this.refillSeconds = refillSeconds; this.tokens = burst; }
  take(now: number): boolean {
    if (this.last !== null) this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.last) / this.refillSeconds);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Movement sanity checks (there is no server physics: clients own their movement)

/** Generous top speeds (m/s) per mode, from locomotion/driving/metro, with headroom for boost. */
export const MODE_SPEED: Record<Mode, number> = { walk: 26, fly: 150, metro: 45, taxi: 40, sky: 120, drive: 48 };
export const MAX_HEIGHT = 400;
/** Atlas travel, taxis and station visits move a player instantly; allow one jump this often. */
export const TELEPORT_COOLDOWN = 1.5;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Parses an untrusted pose. Invalid shapes return null; values are clamped into the world. */
export function parsePose(raw: unknown): PoseMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (![m.x, m.y, m.z, m.yaw, m.pitch, m.heading, m.speed].every(finite) || !isMode(m.mode)) return null;
  const n = m as Record<"x" | "y" | "z" | "yaw" | "pitch" | "heading" | "speed", number>;
  const place = normalizePlace(m.place);
  if (place === null || !validPresence({ x: n.x, y: n.y, z: n.z, mode: m.mode, place })) return null;
  const carrier = parseTrainCarrier(m.carrier);
  if (m.carrier !== undefined && m.carrier !== null && !carrier) return null;
  if (!validRailPresence({ x: n.x, y: n.y, z: n.z, mode: m.mode, place, carrier })) return null;
  const speedLimit = carrier ? CARRIER_WALK_SPEED : MODE_SPEED[m.mode];
  return {
    x: clamp(n.x, -WORLD_EDGE, WORLD_EDGE), y: clamp(n.y, 0, MAX_HEIGHT), z: clamp(n.z, -WORLD_EDGE, WORLD_EDGE),
    yaw: wrapAngle(n.yaw), pitch: clamp(n.pitch, -1.6, 1.6), heading: wrapAngle(n.heading),
    speed: clamp(n.speed, -speedLimit, speedLimit), mode: m.mode, car: carrier ? 0 : finite(m.car) ? clamp(Math.floor(m.car), 0, 65535) : 0, place, carrier,
  };
}

export interface PoseCheck { pose: PoseMessage; teleported: boolean; corrected: boolean }
/** Accepts `next` if reachable from `prev` in `dt` seconds at the mode's top speed (with slack).
 * Otherwise one teleport is allowed per TELEPORT_COOLDOWN; beyond that the move is clamped. */
export function checkMove(prev: PoseMessage | null, next: PoseMessage, dt: number, sinceTeleport: number): PoseCheck {
  if (!prev) return { pose: next, teleported: false, corrected: false };
  const dx = next.x - prev.x, dy = next.y - prev.y, dz = next.z - prev.z, distance = Math.hypot(dx, dy, dz);
  const reach = Math.max(MODE_SPEED[next.mode], MODE_SPEED[prev.mode]) * 1.5 * Math.max(0, Math.min(dt, 1)) + 4;
  if (distance <= reach) return { pose: next, teleported: false, corrected: false };
  if (sinceTeleport >= TELEPORT_COOLDOWN) return { pose: next, teleported: true, corrected: false };
  const k = reach / distance;
  return { pose: { ...next, x: prev.x + dx * k, y: prev.y + dy * k, z: prev.z + dz * k }, teleported: false, corrected: true };
}

// ---------------------------------------------------------------------------------------------
// Messages from clients

export function parseQuestIntent(raw: unknown): QuestIntentMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const { npcId, optionId } = raw as Record<string, unknown>;
  if (typeof npcId !== "string" || typeof optionId !== "string" || npcId.length > 40 || optionId.length > 80) return null;
  return { npcId, optionId };
}

/** Waypoints: ids are client-made, so they are restricted to a safe alphabet. */
export function parseWaypointId(value: unknown, owner?: string): string | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const prefix = owner ? `${owner}:` : "";
  const id = prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : null;
}

export function waypointKey(owner: string, id: string): string { return `${owner}:${id}`; }

export function parseWaypoint(raw: unknown, owner?: string): WaypointMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = parseWaypointId(m.id, owner);
  if (!id || !finite(m.x) || !finite(m.z)) return null;
  if (Math.abs(m.x) > WORLD_EDGE || Math.abs(m.z) > WORLD_EDGE) return null;
  return { id, x: m.x, z: m.z, label: sanitizeText(m.label, WAYPOINT_LABEL_MAX) || "Waypoint", color: isHexColor(m.color) ? m.color.toLowerCase() : "#6ff0d0", shared: m.shared !== false };
}

// ---------------------------------------------------------------------------------------------
// Connection URLs

export interface PageLocation { protocol: string; hostname: string; search: string; origin: string; pathname: string }
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.local)$/i;

/** Accepts "host:port", "http(s)://…" or "ws(s)://…"; returns a normalised ws(s):// URL or null. */
export function normalizeServerUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `${/^(localhost|127\.|\[?::1)/i.test(text) ? "ws" : "wss"}://${text}`);
    const protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : null;
    if (!protocol || !url.hostname) return null;
    return `${protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
}

/** Server URL to try first: `?server=`, then NEXT_PUBLIC_MULTIPLAYER_URL, then a remembered one,
 * then the same host on port 2567 when the page itself is local (localhost / LAN). Opened through
 * a tunnel with none of those, there is nothing sensible to guess: returns null (ask the player). */
export function defaultServerUrl(page: PageLocation, env: string | undefined, remembered: string | null): string | null {
  const query = new URLSearchParams(page.search).get("server");
  for (const candidate of [query, env, remembered]) { const url = candidate ? normalizeServerUrl(candidate) : null; if (url) return url; }
  if (PRIVATE_HOST.test(page.hostname)) return `${page.protocol === "https:" ? "wss" : "ws"}://${page.hostname.includes(":") && !page.hostname.startsWith("[") ? `[${page.hostname}]` : page.hostname}:${DEFAULT_PORT}`;
  return null;
}

/** Invite link: this page plus the room code, and the server URL unless the friend would work it out anyway. */
export function inviteLink(page: PageLocation, code: string, serverUrl: string, env: string | undefined): string {
  const params = new URLSearchParams({ room: code });
  const guessed = defaultServerUrl({ ...page, search: "" }, env, null);
  if (guessed !== serverUrl) params.set("server", serverUrl);
  return `${page.origin}${page.pathname}?${params.toString()}`;
}
