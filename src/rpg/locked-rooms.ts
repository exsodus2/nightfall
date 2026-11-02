// Locked back rooms: some ground floors (building-interiors.ts `lockBackRoom`) close one back room's
// doorway with a `gate` fixture. A "Hack the lock" terminal stands on the gate's front side (the
// existing breach minigame, src/rpg/hacking); a successful breach opens the gate for the rest of the
// in-game day, and a stash inside holds a small reward, once per building per day, under daily caps.
// Pure (no DOM, no textmode). The session wires three things:
//  - `lockedRoomInteractables(place, ledger, day)` into `interactables(placeId)`;
//  - a successful breach of an id with LOCK_PREFIX -> `unlockGate(spec, ledger, interiors, day)`;
//  - E on a STASH_PREFIX id -> `lootStash(spec, host)`.
// The ledger is its own small save (LOCKED_SAVE_KEY) and clears on day rollover.

import { groundFloorPlan, lockSpots } from "../city/building-interiors.ts";
import { interiorWorld, isGroundFloorKind, type InteriorFixture, type InteriorPlace } from "../city/interiors.ts";
import { PLAYER_RADIUS } from "../city/world.ts";
import type { HackTier, InteractableDefinition } from "./types.ts";

/** Interactable id prefixes: `lock:<building>` (the gate's terminal, also its hacking target id) and `stash:<building>`. */
export const LOCK_PREFIX = "lock:";
export const STASH_PREFIX = "stash:";
export const LOCKED_SAVE_KEY = "nightfall.lockedrooms.v1";
/** One in-game day, in seconds of play time (the same day as ground life). */
export const LOCKED_DAY_SECONDS = 1200;
/** Credits and items all stashes together pay in one day (so 2190 buildings are never a farm). */
export const DAILY_STASH_CREDIT_CAP = 200;
export const DAILY_STASH_ITEM_CAP = 3;

type Tone = "info" | "quest" | "loot" | "danger";

export interface LockedRoomSpec {
  readonly building: number;
  readonly placeId: string;
  readonly tier: HackTier;
  /** The locked room's floorplan label. */
  readonly room: string;
  /** The gate fixture (room space). */
  readonly gate: Pick<InteriorFixture, "x" | "z" | "width" | "depth">;
  /** Where the lock terminal is used: just in front of the gate (room space and world). */
  readonly lock: { readonly x: number; readonly z: number; readonly worldX: number; readonly worldZ: number };
  /** Where the stash is used: free floor inside the locked room. */
  readonly stash: { readonly x: number; readonly z: number; readonly worldX: number; readonly worldZ: number };
}

const specCache = new WeakMap<InteriorPlace, LockedRoomSpec | null>();

/** The place's locked room, or null (not a ground floor, nothing locked). Cached per place. */
export function lockedRoomSpec(place: InteriorPlace): LockedRoomSpec | null {
  if (specCache.has(place)) return specCache.get(place) ?? null;
  const spec = buildSpec(place);
  specCache.set(place, spec);
  return spec;
}

function buildSpec(place: InteriorPlace): LockedRoomSpec | null {
  if (!isGroundFloorKind(place.kind) || place.floor) return null;
  const plan = groundFloorPlan(place), lock = plan.locks?.[0];
  if (!lock) return null;
  const gate = plan.fixtures[lock.fixtureIndex], room = plan.rooms[lock.room];
  if (!gate || gate.kind !== "gate" || !room) return null;
  const spots = lockSpots(place.width / 2, place.depth / 2, plan.fixtures, gate, room);
  if (!spots) return null; // lockBackRoom never locks a room without both spots
  const lockAt = spots.lock, best = spots.stash;
  const lockWorld = interiorWorld(place, lockAt.x, lockAt.z), stashWorld = interiorWorld(place, best.x, best.z);
  return {
    building: place.building, placeId: place.id, tier: lock.tier, room: room.label,
    gate: { x: gate.x, z: gate.z, width: gate.width, depth: gate.depth },
    lock: { x: lockAt.x, z: lockAt.z, worldX: lockWorld.x, worldZ: lockWorld.z },
    stash: { x: best.x, z: best.z, worldX: stashWorld.x, worldZ: stashWorld.z },
  };
}

// ---- Interactables ---------------------------------------------------------------------------------------

/** The terminal on a locked gate: E opens the breach minigame (kind "terminal"); success opens the gate. */
export function lockInteractable(spec: LockedRoomSpec): InteractableDefinition {
  return { id: `${LOCK_PREFIX}${spec.building}`, label: "Hack the lock", place: spec.placeId, glyph: "#", x: spec.lock.worldX, z: spec.lock.worldZ, y: 1.6, hack: { kind: "terminal", tier: spec.tier } };
}
export function stashInteractable(spec: LockedRoomSpec): InteractableDefinition {
  return { id: `${STASH_PREFIX}${spec.building}`, label: "Open the stash", place: spec.placeId, glyph: "$", x: spec.stash.worldX, z: spec.stash.worldZ, y: 1.2 };
}

/** What the place offers now: the lock terminal while the gate is shut, the stash once it is open and
 * not yet emptied today. Rolls the ledger to `day` first. */
export function lockedRoomInteractables(place: InteriorPlace, ledger: LockedRoomsLedger, day: number): readonly InteractableDefinition[] {
  const spec = lockedRoomSpec(place);
  if (!spec) return [];
  ledger.rollDay(day);
  if (!ledger.isOpen(spec.building)) return [lockInteractable(spec)];
  return ledger.isLooted(spec.building) ? [] : [stashInteractable(spec)];
}

/** The building an interactable id belongs to (`lock:<n>` / `stash:<n>`), or null. */
export function lockedRoomBuilding(id: string): { kind: "lock" | "stash"; building: number } | null {
  const kind = id.startsWith(LOCK_PREFIX) ? "lock" : id.startsWith(STASH_PREFIX) ? "stash" : null;
  if (!kind) return null;
  const building = Number(id.slice(kind === "lock" ? LOCK_PREFIX.length : STASH_PREFIX.length));
  return Number.isInteger(building) && building >= 0 ? { kind, building } : null;
}

// ---- Ledger ------------------------------------------------------------------------------------------------

interface LedgerData { version: 1; day: number; credits: number; items: number; opened: number[]; looted: number[] }
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

/** Which gates are open and which stashes emptied today, and today's reward totals. Everything clears on rollover. */
export class LockedRoomsLedger {
  day = 0;
  credits = 0;
  items = 0;
  private readonly opened = new Set<number>();
  private readonly looted = new Set<number>();

  static parse(text: string | null): LockedRoomsLedger {
    const ledger = new LockedRoomsLedger();
    if (!text) return ledger;
    try {
      const data = JSON.parse(text) as Partial<LedgerData> | null;
      if (!data || data.version !== 1) return ledger;
      ledger.day = count(data.day); ledger.credits = count(data.credits); ledger.items = count(data.items);
      for (const [list, set] of [[data.opened, ledger.opened], [data.looted, ledger.looted]] as const) {
        if (Array.isArray(list)) for (const building of list) if (typeof building === "number" && Number.isInteger(building) && building >= 0) set.add(building);
      }
    } catch { /* a broken ledger starts fresh */ }
    return ledger;
  }
  serialize(): string {
    const data: LedgerData = { version: 1, day: this.day, credits: this.credits, items: this.items, opened: [...this.opened].sort((a, b) => a - b), looted: [...this.looted].sort((a, b) => a - b) };
    return JSON.stringify(data);
  }
  /** Rolls over when the in-game day changed: gates close, stashes refill, totals reset. Returns true when it did. */
  rollDay(day: number): boolean {
    if (this.day === day) return false;
    this.day = day; this.credits = 0; this.items = 0; this.opened.clear(); this.looted.clear();
    return true;
  }
  isOpen(building: number): boolean { return this.opened.has(building); }
  isLooted(building: number): boolean { return this.looted.has(building); }
  open(building: number): void { this.opened.add(building); }
  loot(building: number): void { this.looted.add(building); }
  openBuildings(): readonly number[] { return [...this.opened]; }
}

/** The part of CityInteriors the lock flow drives (interiors.ts openGates / closeAllGates). */
export interface GateHost { openGates(placeId: string): void; closeAllGates(): void }

/** Opens a gate for the day: remembered in the ledger and removed from the live visit and later ones. */
export function unlockGate(spec: LockedRoomSpec, ledger: LockedRoomsLedger, interiors: GateHost, day: number): void {
  if (ledger.rollDay(day)) interiors.closeAllGates();
  ledger.open(spec.building);
  interiors.openGates(spec.placeId);
}
/** Puts the engine's gates in line with the ledger (after a load or a day rollover): shut all, reopen today's. */
export function syncGates(ledger: LockedRoomsLedger, interiors: GateHost, day: number): void {
  ledger.rollDay(day);
  interiors.closeAllGates();
  for (const building of ledger.openBuildings()) interiors.openGates(`bldg-${building}`);
}

// ---- Reward ----------------------------------------------------------------------------------------------

export interface StashHost {
  /** In-game day index (play time / LOCKED_DAY_SECONDS). */
  readonly day: number;
  earn(amount: number): void;
  /** Adds items; returns how many fit. */
  give(item: string, count: number): number;
  itemName(item: string): string;
  readonly ledger: LockedRoomsLedger;
  say(text: string, tone: Tone): void;
}

const CREDITS: Readonly<Record<HackTier, readonly [number, number]>> = { easy: [25, 40], medium: [45, 75], hard: [80, 130] };
const ITEMS: Readonly<Record<HackTier, readonly string[]>> = {
  easy: ["copper-scrap", "burnt-chip", "neon-tube"],
  medium: ["circuit-board", "hologram-gel", "stim"],
  hard: ["data-shard", "circuit-board", "stim"],
};

function hash(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) { h ^= part | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; }
  return h >>> 0;
}

/** The credits a stash of this building and tier holds (before the daily cap): deterministic per building and day. */
export function stashCredits(building: number, tier: HackTier, day: number): number {
  const [lo, hi] = CREDITS[tier];
  return lo + hash(building, day, 0x1f3d) % (hi - lo + 1);
}

/** Empties the stash once per building per day: credits (capped), then one item (capped). Never throws. */
export function lootStash(spec: LockedRoomSpec, host: StashHost): void {
  const ledger = host.ledger;
  ledger.rollDay(host.day);
  if (!ledger.isOpen(spec.building)) { host.say("The shutter is still down.", "info"); return; }
  if (ledger.isLooted(spec.building)) { host.say("Already cleaned out today.", "info"); return; }
  // The item first: a full pack leaves the whole stash (credits too) for later, never half-paid.
  let itemLine = "";
  if (ledger.items < DAILY_STASH_ITEM_CAP) {
    const pool = ITEMS[spec.tier], item = pool[hash(spec.building, host.day, 0x77) % pool.length];
    if (host.give(item, 1) <= 0) { host.say("Your pack is full. The stash stays shut.", "info"); return; }
    ledger.items += 1; itemLine = `+ ${host.itemName(item)}`; host.say(itemLine, "loot");
  }
  const credits = Math.max(0, Math.min(stashCredits(spec.building, spec.tier, host.day), DAILY_STASH_CREDIT_CAP - ledger.credits));
  if (credits > 0) { host.earn(credits); ledger.credits += credits; host.say(`+ ${credits} cr`, "loot"); }
  ledger.loot(spec.building);
  if (credits <= 0 && !itemLine) host.say("The stash is empty: the city has been through here today.", "info");
  else host.say(`The ${spec.room.toLowerCase()} was worth the lock.`, "info");
}
