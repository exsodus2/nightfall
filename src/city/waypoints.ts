import { WORLD_EDGE } from "./world.ts";

/**
 * Player waypoints: a pure, DOM-free store shared by the world map, minimap, HUD compass and the
 * 3D beacons (waypoint-scene.ts). Sharing goes through a pluggable WaypointSync: the default is a
 * local (solo) echo; multiplayer can `connect()` a network-backed one. Waypoints can also travel
 * as links (`?wp=x,z,label`) without any server.
 */
export interface Waypoint {
  id: string;
  x: number;
  z: number;
  label: string;
  color: string;
  owner: string;
  shared: boolean;
  createdAt: number;
}

/** Transport for shared waypoints. `publish` adds or replaces one of this player's shared
 * waypoints, `remove` withdraws it, and `subscribe` reports every shared waypoint in the room
 * (this player's own included; the store filters those out by `owner`). */
export interface WaypointSync {
  publish(waypoint: Waypoint): void;
  remove(id: string): void;
  subscribe(onChange: (all: readonly Waypoint[]) => void): () => void;
}

export interface WaypointSeed {
  x: number;
  z: number;
  label?: string;
  color?: string;
  shared?: boolean;
}

export interface WaypointPatch {
  x?: number;
  z?: number;
  label?: string;
  color?: string;
  shared?: boolean;
}

export interface WaypointState {
  readonly waypoints: readonly Waypoint[];
  readonly activeId: string | null;
  readonly version: number;
}

/** Blade Runner 2049 palette: amber, teal, magenta, violet, acid, signal red, bone. */
export const WAYPOINT_COLORS = ["#ffb347", "#4de8e0", "#ff4fa3", "#9d8cff", "#b6ff6a", "#ff5f56", "#eef2dc"] as const;
export const WAYPOINT_LIMIT = 24;
export const LABEL_LIMIT = 40;
export const LOCAL_OWNER = "you";
const PARAM_LIMIT = 200;
const COORD_PATTERN = /^\s*-?\d{1,6}(\.\d{1,3})?\s*$/;
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

const clampCoord = (value: number): number => Math.max(-WORLD_EDGE, Math.min(WORLD_EDGE, value));
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Strips control characters, collapses whitespace and bounds the length. */
export function sanitizeLabel(raw: unknown, fallback = "Waypoint"): string {
  if (typeof raw !== "string") return fallback;
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? Array.from(clean).slice(0, LABEL_LIMIT).join("") : fallback;
}

export function sanitizeColor(raw: unknown, fallback: string = WAYPOINT_COLORS[0]): string {
  return typeof raw === "string" && HEX_PATTERN.test(raw) ? raw.toLowerCase() : fallback;
}

/** Deterministic palette colour for a seed (e.g. coordinates of a shared link). */
export function colorFor(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return WAYPOINT_COLORS[(hash >>> 0) % WAYPOINT_COLORS.length];
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = HEX_PATTERN.test(hex) ? parseInt(hex.slice(1), 16) : 0xffb347;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Validates untrusted data (network, storage) into a Waypoint, or null. */
export function normalizeWaypoint(value: unknown): Waypoint | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { id, x, z, owner, createdAt } = record;
  if (typeof id !== "string" || !id || id.length > 80) return null;
  if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return {
    id,
    x: round1(clampCoord(x)),
    z: round1(clampCoord(z)),
    label: sanitizeLabel(record.label),
    color: sanitizeColor(record.color),
    owner: typeof owner === "string" && owner ? owner.slice(0, 64) : "unknown",
    shared: record.shared === true,
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/** Solo sync: shared waypoints simply echo back. Stands in until a network sync is connected. */
export function createLocalWaypointSync(): WaypointSync {
  const shared = new Map<string, Waypoint>();
  const listeners = new Set<(all: readonly Waypoint[]) => void>();
  const emit = () => { const all = [...shared.values()]; for (const listener of listeners) listener(all); };
  return {
    publish(waypoint) { shared.set(waypoint.id, { ...waypoint }); emit(); },
    remove(id) { if (shared.delete(id)) emit(); },
    subscribe(onChange) { listeners.add(onChange); onChange([...shared.values()]); return () => { listeners.delete(onChange); }; },
  };
}

let idCounter = 0;
function defaultId(): string {
  idCounter = (idCounter + 1) % 1296;
  const random = Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
  return `wp-${Date.now().toString(36)}-${idCounter.toString(36)}${random}`;
}

export interface WaypointStoreOptions {
  owner?: string;
  sync?: WaypointSync;
  now?: () => number;
  createId?: () => string;
  limit?: number;
}

export class WaypointStore {
  private readonly mine = new Map<string, Waypoint>();
  private remote: readonly Waypoint[] = [];
  private readonly hidden = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private localSync: WaypointSync;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly limit: number;
  private sync: WaypointSync;
  private unsubscribe: () => void = () => undefined;
  private syncVersion = 0;
  private currentOwner: string;
  private active: string | null = null;
  private state: WaypointState = { waypoints: [], activeId: null, version: 0 };

  constructor(options: WaypointStoreOptions = {}) {
    this.currentOwner = options.owner ?? LOCAL_OWNER;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultId;
    this.limit = options.limit ?? WAYPOINT_LIMIT;
    this.localSync = createLocalWaypointSync();
    this.sync = this.localSync;
    this.connect(options.sync ?? this.localSync);
  }

  get owner(): string { return this.currentOwner; }
  get activeId(): string | null { return this.active; }
  /** True once a sync other than the built-in solo echo is connected. */
  get networked(): boolean { return this.sync !== this.localSync; }

  /** Immutable snapshot; the same object until something changes (useSyncExternalStore-friendly). */
  getState = (): WaypointState => this.state;
  list(): readonly Waypoint[] { return this.state.waypoints; }
  get(id: string): Waypoint | undefined { return this.state.waypoints.find((waypoint) => waypoint.id === id); }
  activeWaypoint(): Waypoint | null { return this.active ? this.get(this.active) ?? null : null; }
  isMine(id: string): boolean { return this.mine.has(id); }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Switches transport (e.g. to a multiplayer room) and republishes this player's shared waypoints.
   * Pass nothing to fall back to solo. Returns a disconnect function. */
  connect(sync: WaypointSync = this.localSync): () => void {
    const version = ++this.syncVersion;
    this.unsubscribe();
    if (sync === this.localSync && this.sync !== this.localSync) this.localSync = sync = createLocalWaypointSync();
    this.sync = sync;
    this.remote = [];
    const unsubscribe = sync.subscribe((all) => { if (version === this.syncVersion) this.receive(all); });
    if (version !== this.syncVersion) { unsubscribe(); return () => undefined; }
    this.unsubscribe = unsubscribe;
    for (const waypoint of this.mine.values()) {
      if (version !== this.syncVersion) break;
      if (waypoint.shared) sync.publish(waypoint);
    }
    if (version === this.syncVersion) this.commit();
    return () => { if (version === this.syncVersion) this.connect(this.localSync); };
  }

  /** Multiplayer identity (e.g. session id or player name). Re-publishes shared waypoints under it. */
  setOwner(owner: string): void {
    const next = owner.trim().slice(0, 64) || LOCAL_OWNER;
    if (next === this.currentOwner) return;
    this.currentOwner = next;
    for (const [id, waypoint] of this.mine) {
      const updated = { ...waypoint, owner: next };
      this.mine.set(id, updated);
      if (updated.shared) { this.sync.remove(id); this.sync.publish(updated); }
    }
    this.receive(this.remote);
  }

  add(seed: WaypointSeed, activate = true): Waypoint | null {
    if (!Number.isFinite(seed.x) || !Number.isFinite(seed.z)) return null;
    // At the limit the oldest inactive waypoint of this player's makes room.
    while (this.mine.size >= this.limit) {
      const oldest = [...this.mine.values()].find((waypoint) => waypoint.id !== this.active) ?? [...this.mine.values()][0];
      this.removeMine(oldest.id);
    }
    const index = this.mine.size;
    const waypoint: Waypoint = {
      id: this.createId(),
      x: round1(clampCoord(seed.x)),
      z: round1(clampCoord(seed.z)),
      label: sanitizeLabel(seed.label, `Waypoint ${index + 1}`),
      color: sanitizeColor(seed.color, WAYPOINT_COLORS[index % WAYPOINT_COLORS.length]),
      owner: this.currentOwner,
      shared: seed.shared === true,
      createdAt: this.now(),
    };
    this.mine.set(waypoint.id, waypoint);
    if (waypoint.shared) this.sync.publish(waypoint);
    if (activate) this.active = waypoint.id;
    this.commit();
    return waypoint;
  }

  /** Edits one of this player's waypoints (remote ones are read-only). */
  update(id: string, patch: WaypointPatch): Waypoint | null {
    const current = this.mine.get(id);
    if (!current) return null;
    const next: Waypoint = {
      ...current,
      x: patch.x !== undefined && Number.isFinite(patch.x) ? round1(clampCoord(patch.x)) : current.x,
      z: patch.z !== undefined && Number.isFinite(patch.z) ? round1(clampCoord(patch.z)) : current.z,
      label: patch.label !== undefined ? sanitizeLabel(patch.label, current.label) : current.label,
      color: patch.color !== undefined ? sanitizeColor(patch.color, current.color) : current.color,
      shared: patch.shared ?? current.shared,
    };
    this.mine.set(id, next);
    if (next.shared) this.sync.publish(next);
    else if (current.shared) this.sync.remove(id);
    this.commit();
    return next;
  }

  setShared(id: string, shared: boolean): Waypoint | null { return this.update(id, { shared }); }

  /** Deletes one of this player's waypoints, or hides someone else's locally. */
  remove(id: string): void {
    if (this.mine.has(id)) this.removeMine(id);
    else if (this.remote.some((waypoint) => waypoint.id === id)) this.hidden.add(id);
    else return;
    if (this.active === id) this.active = null;
    this.commit();
  }

  clear(): void {
    for (const id of [...this.mine.keys()]) this.removeMine(id);
    for (const waypoint of this.remote) this.hidden.add(waypoint.id);
    this.active = null;
    this.commit();
  }

  setActive(id: string | null): void {
    const next = id && this.state.waypoints.some((waypoint) => waypoint.id === id) ? id : null;
    if (next === this.active) return;
    this.active = next;
    this.commit();
  }

  /** This player's waypoints as JSON (for local persistence). */
  serialize(): string {
    return JSON.stringify({ v: 1, active: this.active, waypoints: [...this.mine.values()] });
  }

  /** Restores serialize() output; ignores anything malformed. Returns how many were added. */
  restore(json: string | null): number {
    if (!json) return 0;
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return 0; }
    if (!parsed || typeof parsed !== "object") return 0;
    const record = parsed as { active?: unknown; waypoints?: unknown };
    if (!Array.isArray(record.waypoints)) return 0;
    let added = 0;
    for (const item of record.waypoints.slice(0, this.limit)) {
      const waypoint = normalizeWaypoint(item);
      if (!waypoint || this.mine.has(waypoint.id) || this.mine.size >= this.limit) continue;
      const own = { ...waypoint, owner: this.currentOwner };
      this.mine.set(own.id, own);
      if (own.shared) this.sync.publish(own);
      added++;
    }
    if (typeof record.active === "string" && this.mine.has(record.active)) this.active = record.active;
    if (added) this.commit();
    return added;
  }

  private removeMine(id: string): void {
    const waypoint = this.mine.get(id);
    if (!waypoint) return;
    this.mine.delete(id);
    if (waypoint.shared) this.sync.remove(id);
  }

  private receive(all: readonly Waypoint[]): void {
    const seen = new Set<string>();
    const remote: Waypoint[] = [];
    for (const item of all) {
      const waypoint = normalizeWaypoint(item);
      if (!waypoint || waypoint.owner === this.currentOwner || this.mine.has(waypoint.id) || seen.has(waypoint.id)) continue;
      seen.add(waypoint.id);
      remote.push({ ...waypoint, shared: true });
    }
    this.remote = remote;
    this.commit();
  }

  private commit(): void {
    const waypoints = [...this.mine.values(), ...this.remote.filter((waypoint) => !this.hidden.has(waypoint.id))];
    if (this.active && !waypoints.some((waypoint) => waypoint.id === this.active)) this.active = null;
    this.state = { waypoints, activeId: this.active, version: this.state.version + 1 };
    for (const listener of [...this.listeners]) listener();
  }
}

// ── Links ──────────────────────────────────────────────────────────────────────────────────────

/** `x,z,label` with whole-metre coordinates (the label is percent-encoded when put in a URL). */
export function encodeWaypointParam(waypoint: Pick<Waypoint, "x" | "z" | "label">): string {
  return `${Math.round(waypoint.x)},${Math.round(waypoint.z)},${sanitizeLabel(waypoint.label)}`;
}

/** Parses an already-decoded `wp` value. Rejects anything that is not two plain finite numbers;
 * clamps coordinates to the city; sanitises the label (which may itself contain commas). */
export function parseWaypointParam(value: string | null | undefined): Required<Pick<WaypointSeed, "x" | "z" | "label" | "color">> | null {
  if (typeof value !== "string" || !value || value.length > PARAM_LIMIT) return null;
  const first = value.indexOf(",");
  if (first < 0) return null;
  const second = value.indexOf(",", first + 1);
  const xText = value.slice(0, first);
  const zText = second < 0 ? value.slice(first + 1) : value.slice(first + 1, second);
  if (!COORD_PATTERN.test(xText) || !COORD_PATTERN.test(zText)) return null;
  const x = Number(xText), z = Number(zText);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const cx = round1(clampCoord(x)), cz = round1(clampCoord(z));
  return { x: cx, z: cz, label: sanitizeLabel(second < 0 ? "" : value.slice(second + 1), "Shared waypoint"), color: colorFor(`${Math.round(cx)},${Math.round(cz)}`) };
}

/** Every valid `wp` parameter in a query string (at most 8). */
export function waypointsFromSearch(search: string): Required<Pick<WaypointSeed, "x" | "z" | "label" | "color">>[] {
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return []; }
  const seeds = [];
  for (const value of params.getAll("wp").slice(0, 8)) {
    const seed = parseWaypointParam(value);
    if (seed) seeds.push(seed);
  }
  return seeds;
}

/** A link to `base`'s page that adds the waypoint when opened: `…/?wp=120,-340,Noodle%20bar`. */
export function waypointLink(base: string, waypoint: Pick<Waypoint, "x" | "z" | "label">): string {
  const url = new URL(base);
  const [x, z, ...label] = encodeWaypointParam(waypoint).split(",");
  return `${url.origin}${url.pathname}?wp=${x},${z},${encodeURIComponent(label.join(","))}`;
}

/** `href` without its `wp` parameters (to tidy the address bar once a link is consumed). */
export function stripWaypointParams(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("wp");
  return url.toString();
}

// ── Geometry shared by the HUD, map and scene ─────────────────────────────────────────────────

/** Bearing from a position to a point. North is −z; yaw 0 faces north and grows clockwise. */
export function waypointBearing(fromX: number, fromZ: number, yaw: number, toX: number, toZ: number): { distance: number; absolute: number; relative: number } {
  const dx = toX - fromX, dz = toZ - fromZ;
  const absolute = Math.atan2(dx, -dz);
  const relative = Math.atan2(Math.sin(absolute - yaw), Math.cos(absolute - yaw));
  return { distance: Math.hypot(dx, dz), absolute, relative };
}

export function formatMetres(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10000 ? 2 : 1)} km`;
}

/** The session's waypoints, shared by the React UI and the renderer. */
export const cityWaypoints = new WaypointStore();
