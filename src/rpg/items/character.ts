import type { EventBus } from "../events.ts";
import type { CharacterState, CombatCharacter, ConsumableStats, EquipSlot, FactionId, ItemDefinition, RpgSnapshot, WeaponSlot } from "../types.ts";
import { CREDIT_CHIP } from "./catalogue.ts";
import { rarityTier, slotFor, type ItemRegistry } from "./registry.ts";

/** Level cap. */
export const MAX_LEVEL = 30;
/** Reputation is clamped to this range per faction. */
export const REP_MIN = -100;
export const REP_MAX = 100;
/** Armour protection never exceeds this (combat damage reduction). */
export const PROTECTION_CAP = 0.8;

/** XP needed to go from `level` to the next; 0 at the cap. A power curve like classic MMOs:
 * 200 xp for level 2, ~1.6k at 5, ~5k at 10, ~34k for the last level. */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  const l = Math.max(1, Math.floor(level));
  return Math.round((80 * l ** 1.8 + 120) / 10) * 10;
}

const GEAR_SLOTS: readonly EquipSlot[] = ["melee", "sidearm", "primary", "body", "head"];
const STAT_NAMES = ["cool", "tech", "street"] as const;
type StatName = (typeof STAT_NAMES)[number];

/** A new game's character: a cheap blade, a loaded pistol with spare rounds, a hoodie, two stims
 * and a ration on the quick slots, 50 credits. */
export function startingState(): CharacterState {
  return {
    credits: 50, xp: 0, level: 1,
    inventory: [
      { item: "backtick-shiv", count: 1 }, { item: "caret-45", count: 1 }, { item: "ammo-pistol", count: 24 },
      { item: "mesh-hoodie", count: 1 }, { item: "stim", count: 2 }, { item: "synth-ration", count: 1 },
    ],
    equipped: { melee: "backtick-shiv", sidearm: "caret-45", body: "mesh-hoodie", quick1: "stim", quick2: "synth-ration" },
    loaded: { "caret-45": 8 },
    reputation: {},
  };
}

const finiteOr = (value: number | undefined, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** The player's character sheet: inventory with stacks and carry weight, equipment, ammo, credits,
 * xp/levels, reputation and dialogue stats. Implements what combat needs (CombatCharacter).
 * Inventory changes are announced on the bus (itemAdded / itemRemoved / itemUsed) so quests can
 * track them. Equipped items stay in the inventory; equipment slots hold item ids. */
export class Character implements CombatCharacter {
  readonly state: CharacterState;
  private readonly registry: ItemRegistry;
  private readonly bus: EventBus;

  /** No state: a new game with the starting kit. A (partial) state: restore it, filling gaps with empty defaults. */
  constructor(registry: ItemRegistry, bus: EventBus, state?: Partial<CharacterState>) {
    this.registry = registry; this.bus = bus;
    const s = state ?? startingState();
    // Deep copies: the caller's object (a save, a test fixture) must not alias live state.
    this.state = {
      credits: Math.max(0, Math.floor(finiteOr(s.credits, 0))),
      xp: Math.max(0, finiteOr(s.xp, 0)),
      level: Math.min(MAX_LEVEL, Math.max(1, Math.floor(finiteOr(s.level, 1)))),
      inventory: (s.inventory ?? []).filter(stack => stack.count > 0).map(stack => ({ item: stack.item, count: Math.floor(stack.count) })),
      equipped: { ...(s.equipped ?? {}) },
      loaded: { ...(s.loaded ?? {}) },
      reputation: { ...(s.reputation ?? {}) },
    };
  }

  // ---- Inventory --------------------------------------------------------------------------

  count(item: string): number {
    let n = 0;
    for (const stack of this.state.inventory) if (stack.item === item) n += stack.count;
    return n;
  }
  get weight(): number {
    let w = 0;
    for (const stack of this.state.inventory) w += (this.registry.get(stack.item)?.weight ?? 0) * stack.count;
    return w;
  }
  /** Kilograms the character can carry; grows a little with level. */
  get capacity(): number { return 45 + (this.state.level - 1) * 1.5; }
  get carry(): { weight: number; capacity: number } { return { weight: Math.round(this.weight * 100) / 100, capacity: this.capacity }; }

  /** Adds up to `count`, topping up existing stacks before opening new ones. Stops at carry
   * capacity (quest items always fit). Returns how many were added. Credit chips become credits. */
  add(item: string, count = 1): number {
    const def = this.registry.get(item);
    const n = Math.floor(count);
    if (!def || !(n > 0)) return 0;
    if (item === CREDIT_CHIP) { this.addCredits(n); return n; }
    let fit = n;
    if (def.kind !== "quest" && def.weight > 0) fit = Math.min(n, Math.floor((this.capacity - this.weight) / def.weight + 1e-6));
    if (fit <= 0) return 0;
    const stackSize = Math.max(1, Math.floor(def.stack));
    let left = fit;
    for (const stack of this.state.inventory) {
      if (left <= 0) break;
      if (stack.item !== item || stack.count >= stackSize) continue;
      const put = Math.min(left, stackSize - stack.count);
      stack.count += put; left -= put;
    }
    while (left > 0) {
      const put = Math.min(left, stackSize);
      this.state.inventory.push({ item, count: put }); left -= put;
    }
    // Convenience: a consumable picked up while a quick slot is empty goes straight onto it.
    if (def.kind === "consumable" && def.consumable && this.slotOf(item) === null) {
      if (!this.state.equipped.quick1) this.state.equipped.quick1 = item;
      else if (!this.state.equipped.quick2) this.state.equipped.quick2 = item;
    }
    this.bus.emit({ type: "itemAdded", item, count: fit });
    return fit;
  }

  /** Removes exactly `count` (all or nothing). Removing the last copy unequips it from gear slots
   * (quick slots stay assigned so a restock refills them) and returns a weapon's loaded rounds
   * to the ammo reserve. */
  remove(item: string, count = 1): boolean {
    const n = Math.floor(count);
    if (!(n > 0) || this.count(item) < n) return false;
    let left = n;
    const inv = this.state.inventory;
    for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
      if (inv[i].item !== item) continue;
      const take = Math.min(left, inv[i].count);
      inv[i].count -= take; left -= take;
      if (inv[i].count <= 0) inv.splice(i, 1);
    }
    this.bus.emit({ type: "itemRemoved", item, count: n });
    if (this.count(item) === 0) {
      for (const slot of GEAR_SLOTS) if (this.state.equipped[slot] === item) delete this.state.equipped[slot];
      const rounds = this.state.loaded[item] ?? 0;
      delete this.state.loaded[item];
      const ammo = this.registry.get(item)?.weapon?.ammo;
      if (ammo && rounds > 0) this.add(ammo, rounds);
    }
    return true;
  }

  // ---- Equipment --------------------------------------------------------------------------

  /** Equips an owned item in its natural slot (weapon class / armour slot); consumables go on
   * the first free quick slot (or quick1). Returns false if not owned or not equippable. */
  equip(item: string): boolean {
    const def = this.registry.get(item);
    if (!def || this.count(item) <= 0) return false;
    const slot = slotFor(def);
    if (!slot) return false;
    if (slot === "quick1") {
      const current = this.slotOf(item);
      if (current === "quick1" || current === "quick2") return true;
      return this.assignQuick(item, !this.state.equipped.quick1 || this.state.equipped.quick2 ? 1 : 2);
    }
    this.state.equipped[slot] = item;
    return true;
  }
  unequip(slot: EquipSlot): boolean {
    if (!this.state.equipped[slot]) return false;
    delete this.state.equipped[slot];
    return true;
  }
  /** Puts an owned consumable on quick slot 1 or 2 (moving it off the other one). */
  assignQuick(item: string, slot: 1 | 2): boolean {
    const def = this.registry.get(item);
    if (!def || def.kind !== "consumable" || !def.consumable || this.count(item) <= 0) return false;
    const key: EquipSlot = slot === 1 ? "quick1" : "quick2";
    const other: EquipSlot = slot === 1 ? "quick2" : "quick1";
    if (this.state.equipped[other] === item) delete this.state.equipped[other];
    this.state.equipped[key] = item;
    return true;
  }
  /** The item in a slot. Quick slots keep their item when it runs out (count may be 0). */
  equipped(slot: EquipSlot): ItemDefinition | null {
    const id = this.state.equipped[slot];
    return id ? this.registry.get(id) ?? null : null;
  }
  /** The slot an item is equipped in, if any. */
  slotOf(item: string): EquipSlot | null {
    for (const [slot, id] of Object.entries(this.state.equipped) as [EquipSlot, string | undefined][]) if (id === item) return slot;
    return null;
  }
  weaponFor(slot: WeaponSlot): ItemDefinition | null {
    if (slot === "unarmed") return null;
    const def = this.equipped(slot);
    return def?.weapon ? def : null;
  }

  // ---- Ammo -------------------------------------------------------------------------------

  loaded(weaponItem: string): number { return this.state.loaded[weaponItem] ?? 0; }
  reserve(ammoItem: string): number { return this.count(ammoItem); }
  /** Tops the magazine up from reserve; returns rounds moved (0 for melee, a full mag or no ammo). */
  reload(weaponItem: string): number {
    const stats = this.registry.get(weaponItem)?.weapon;
    if (!stats?.ammo || !stats.magazine) return 0;
    const need = stats.magazine - this.loaded(weaponItem);
    const n = Math.min(need, this.reserve(stats.ammo));
    if (n <= 0 || !this.remove(stats.ammo, n)) return 0;
    this.state.loaded[weaponItem] = this.loaded(weaponItem) + n;
    return n;
  }
  spendRound(weaponItem: string): boolean {
    const n = this.loaded(weaponItem);
    if (n <= 0) return false;
    this.state.loaded[weaponItem] = n - 1;
    return true;
  }

  // ---- Consumables ------------------------------------------------------------------------

  /** Uses one of the quick slot's consumable; its stats (for combat to apply), or null if empty. */
  useQuick(slot: 1 | 2): ConsumableStats | null {
    const id = this.state.equipped[slot === 1 ? "quick1" : "quick2"];
    return id ? this.use(id) : null;
  }
  /** Uses one owned consumable from the inventory; returns its stats, or null. Emits itemUsed. */
  use(item: string): ConsumableStats | null {
    const def = this.registry.get(item);
    if (!def || def.kind !== "consumable" || !def.consumable || !this.remove(item, 1)) return null;
    this.bus.emit({ type: "itemUsed", item });
    return def.consumable;
  }

  // ---- Credits, xp, reputation ------------------------------------------------------------

  get credits(): number { return this.state.credits; }
  /** Adds credits (negative takes, never below 0). */
  addCredits(n: number): void {
    if (!Number.isFinite(n)) return;
    this.state.credits = Math.max(0, Math.floor(this.state.credits + n));
  }
  /** Pays `n` credits if affordable. */
  spend(n: number): boolean {
    if (!Number.isFinite(n) || n < 0 || this.state.credits < n) return false;
    this.state.credits = Math.floor(this.state.credits - n);
    return true;
  }

  get level(): number { return this.state.level; }
  get xp(): number { return this.state.xp; }
  get xpToNext(): number { return xpToNext(this.state.level); }
  /** Grants xp, levelling up as often as it covers (announced with a message); excess past the cap is dropped. */
  addXp(n: number): { levelsGained: number } {
    if (!(n > 0) || this.state.level >= MAX_LEVEL) return { levelsGained: 0 };
    const before = this.state.level;
    this.state.xp += n;
    while (this.state.level < MAX_LEVEL && this.state.xp >= xpToNext(this.state.level)) {
      this.state.xp -= xpToNext(this.state.level);
      this.state.level++;
    }
    if (this.state.level >= MAX_LEVEL) this.state.xp = 0;
    const levelsGained = this.state.level - before;
    if (levelsGained > 0) this.bus.emit({ type: "message", text: `LEVEL UP -- level ${this.state.level}. Max health ${this.maxHealth}.`, tone: "info" });
    return { levelsGained };
  }

  reputation(faction: FactionId): number { return this.state.reputation[faction] ?? 0; }
  /** Changes a faction's standing, clamped to -100..100; returns the new value. */
  addReputation(faction: FactionId, by: number): number {
    const next = Math.min(REP_MAX, Math.max(REP_MIN, this.reputation(faction) + (Number.isFinite(by) ? by : 0)));
    this.state.reputation[faction] = next;
    return next;
  }

  // ---- Derived stats ----------------------------------------------------------------------

  get maxHealth(): number { return 100 + (this.state.level - 1) * 8; }
  get maxStamina(): number { return 100 + (this.state.level - 1) * 3; }
  get protection(): number {
    let p = 0;
    for (const slot of ["body", "head"] as const) p += this.equipped(slot)?.armor?.protection ?? 0;
    return Math.min(PROTECTION_CAP, p);
  }
  /** +3% outgoing damage per level above 1. */
  get damageBonus(): number { return 1 + (this.state.level - 1) * 0.03; }
  /** Dialogue check stats: 1 + one per five levels, +1 per equipped gear piece tagged with the
   * stat (+2 for epic/legendary gear). Roughly 1..12 over a playthrough. */
  get stats(): { cool: number; tech: number; street: number } {
    const base = 1 + Math.floor((this.state.level - 1) / 5);
    const out: Record<StatName, number> = { cool: base, tech: base, street: base };
    for (const slot of GEAR_SLOTS) {
      const def = this.equipped(slot);
      if (!def?.tags) continue;
      const bonus = rarityTier(def.rarity) >= 3 ? 2 : 1;
      for (const name of STAT_NAMES) if (def.tags.includes(name)) out[name] += bonus;
    }
    return out;
  }

  /** Deep copy of the sheet for saving. */
  serialize(): CharacterState {
    const s = this.state;
    return {
      credits: s.credits, xp: s.xp, level: s.level,
      inventory: s.inventory.map(stack => ({ ...stack })),
      equipped: { ...s.equipped }, loaded: { ...s.loaded }, reputation: { ...s.reputation },
    };
  }
  /** The character part of the UI snapshot. */
  sheet(): RpgSnapshot["character"] {
    return { ...this.serialize(), maxHealth: this.maxHealth, maxStamina: this.maxStamina, protection: this.protection, xpToNext: this.xpToNext, stats: this.stats, carry: this.carry };
  }
}
