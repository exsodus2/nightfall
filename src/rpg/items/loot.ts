import type { ItemDefinition, ItemStack, LootEntry, LootTable, Rarity } from "../types.ts";
import { CREDIT_CHIP } from "./catalogue.ts";
import { RARITIES, type ItemRegistry } from "./registry.ts";

// Loot entries name an item id, or one of two indirections so content can stay short and new
// items drop without editing every table:
//   "pool:<rarity>[:<filter>]"  a uniformly random registry item of that rarity; the filter is an
//                               ItemKind, a WeaponClass, "weapon" (melee|ranged) or "gear"
//                               (weapons + armour). Quest items and credit chips never pool.
//   "table:<id>"                rolls another table once (nested drops).
// A table's optional `also` lists tables rolled in addition, which is how a boss guarantees one
// epic-or-better piece on top of its normal drops.

/** Result of a loot roll: merged item stacks plus credits. */
export interface LootRoll { items: ItemStack[]; credits: number }

const pooled = (def: ItemDefinition): boolean => def.kind !== "quest" && def.id !== CREDIT_CHIP && !def.tags?.includes("noloot");
function matchesFilter(def: ItemDefinition, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter === "gear") return def.kind === "melee" || def.kind === "ranged" || def.kind === "armor";
  if (filter === "weapon") return def.kind === "melee" || def.kind === "ranged";
  return def.kind === filter || def.weapon?.class === filter;
}

/** Base loot tables. Weights read like an MMO: commons drop constantly, a rare is a good night,
 * an epic off a street thug is a story, legendaries come from bosses (or very lucky crates). */
export const LOOT_TABLES: readonly LootTable[] = [
  {
    id: "street-thug", rolls: 2, empty: 0.4, credits: [4, 22],
    entries: [
      { item: "ammo-pistol", weight: 24, min: 3, max: 9 },
      { item: "stim", weight: 14 },
      { item: "synth-ration", weight: 10 },
      { item: "coolant-can", weight: 8 },
      { item: "copper-scrap", weight: 22, min: 1, max: 3 },
      { item: "burnt-chip", weight: 16, min: 1, max: 2 },
      { item: "neon-tube", weight: 8 },
      { item: "foundry-slag", weight: 6 },
      { item: "afterlight-token", weight: 5, min: 1, max: 4 },
      { item: "sealant-spray", weight: 5 },
      { item: "hyphen", weight: 2 },
      { item: "pool:common:gear", weight: 7 },
      { item: "pool:uncommon", weight: 6 },
      { item: "pool:rare:gear", weight: 1.5 },
      { item: "pool:epic:gear", weight: 0.25 },
    ],
  },
  {
    id: "gang-lieutenant", rolls: 3, empty: 0.2, credits: [25, 80],
    entries: [
      { item: "ammo-pistol", weight: 16, min: 6, max: 14 },
      { item: "ammo-shell", weight: 10, min: 2, max: 6 },
      { item: "stim", weight: 12, min: 1, max: 2 },
      { item: "medkit", weight: 6 },
      { item: "haste-inhaler", weight: 5 },
      { item: "kiln-coffee", weight: 4 },
      { item: "glare-drops", weight: 3 },
      { item: "moss-poultice", weight: 2 },
      { item: "circuit-board", weight: 8 },
      { item: "query", weight: 1.5 },
      { item: "shebang", weight: 1.5 },
      { item: "data-shard", weight: 6 },
      { item: "pool:common:gear", weight: 6 },
      { item: "pool:uncommon:gear", weight: 8 },
      { item: "pool:rare:gear", weight: 3 },
      { item: "pool:epic:gear", weight: 0.6 },
      { item: "pool:legendary:gear", weight: 0.08 },
    ],
  },
  {
    id: "corpsec", rolls: 3, empty: 0.25, credits: [35, 110],
    entries: [
      { item: "ammo-rifle", weight: 14, min: 4, max: 10 },
      { item: "ammo-pistol", weight: 12, min: 8, max: 16 },
      { item: "stim", weight: 10 },
      { item: "medkit", weight: 7 },
      { item: "shield-cell", weight: 6 },
      { item: "focus-chip", weight: 4 },
      { item: "data-shard", weight: 9 },
      { item: "encrypted-drive", weight: 2 },
      { item: "hologram-gel", weight: 6 },
      { item: "interrupt", weight: 1 },
      { item: "tab-stop", weight: 1.5 },
      { item: "close-brace", weight: 0.05 },
      { item: "kevlar-weave", weight: 3 },
      { item: "riot-helm", weight: 3 },
      { item: "pool:uncommon:gear", weight: 7 },
      { item: "pool:rare:gear", weight: 3.5 },
      { item: "pool:epic:gear", weight: 0.8 },
      { item: "pool:legendary:gear", weight: 0.1 },
    ],
  },
  {
    id: "boss-legendary", rolls: 3, empty: 0, credits: [450, 900], also: ["boss-prize"],
    entries: [
      { item: "medkit", weight: 10, min: 1, max: 2 },
      { item: "shield-cell", weight: 8 },
      { item: "focus-chip", weight: 6 },
      { item: "encrypted-drive", weight: 6, min: 1, max: 2 },
      { item: "ammo-rifle", weight: 5, min: 10, max: 20 },
      { item: "static-jar", weight: 4 },
      { item: "overclock-tab", weight: 4 },
      { item: "pool:rare:gear", weight: 5 },
    ],
  },
  /** One guaranteed epic-or-legendary piece (rolled by boss-legendary). */
  {
    id: "boss-prize", rolls: 1, empty: 0,
    entries: [{ item: "pool:epic:gear", weight: 7 }, { item: "pool:legendary:gear", weight: 3 }],
  },
  {
    id: "crate-common", rolls: 2, empty: 0.25, credits: [0, 15],
    entries: [
      { item: "stim", weight: 14 },
      { item: "synth-ration", weight: 12 },
      { item: "coolant-can", weight: 10 },
      { item: "ammo-pistol", weight: 14, min: 4, max: 10 },
      { item: "ammo-shell", weight: 6, min: 2, max: 4 },
      { item: "copper-scrap", weight: 18, min: 1, max: 4 },
      { item: "neon-tube", weight: 10 },
      { item: "hana-broth", weight: 6 },
      { item: "tea-brick", weight: 6 },
      { item: "river-glass", weight: 6, min: 1, max: 3 },
      { item: "foundry-slag", weight: 5 },
      { item: "rainfern-seeds", weight: 3 },
      { item: "moss-poultice", weight: 3 },
      { item: "circuit-board", weight: 5 },
      { item: "pool:common:gear", weight: 5 },
      { item: "pool:uncommon:gear", weight: 2 },
    ],
  },
  {
    id: "crate-rare", rolls: 3, empty: 0.05, credits: [20, 70],
    entries: [
      { item: "medkit", weight: 8 },
      { item: "shield-cell", weight: 5 },
      { item: "focus-chip", weight: 5 },
      { item: "haste-inhaler", weight: 5 },
      { item: "data-shard", weight: 8 },
      { item: "encrypted-drive", weight: 4 },
      { item: "old-world-watch", weight: 2 },
      { item: "antenna-core", weight: 5 },
      { item: "defrag-patch", weight: 4 },
      { item: "overclock-tab", weight: 3 },
      { item: "glare-drops", weight: 3 },
      { item: "static-jar", weight: 1 },
      { item: "kernel-plate", weight: 1 },
      { item: "ammo-rifle", weight: 6, min: 6, max: 12 },
      { item: "ammo-shell", weight: 6, min: 4, max: 8 },
      { item: "pool:uncommon:gear", weight: 8 },
      { item: "pool:rare:gear", weight: 5 },
      { item: "pool:epic:gear", weight: 1.2 },
      { item: "pool:legendary:gear", weight: 0.15 },
    ],
  },
  // Combat tiers: what a street fight pays by how dangerous the enemy was. Archetype tables (content
  // packs) add their signature drops and roll one of these through `also`.
  /** Tier 1: rushers, dock hands, single drones. Ammo, a stim, pocket change. */
  {
    id: "tier-street", rolls: 1, empty: 0.3, credits: [6, 24],
    entries: [
      { item: "ammo-pistol", weight: 30, min: 4, max: 10 },
      { item: "ammo-shell", weight: 12, min: 2, max: 4 },
      { item: "stim", weight: 20 },
      { item: "copper-scrap", weight: 18, min: 1, max: 3 },
      { item: "circuit-board", weight: 8 },
      { item: "pool:uncommon", weight: 9 },
      { item: "pool:rare:gear", weight: 2.5 },
      { item: "pool:epic:gear", weight: 0.5 },
    ],
  },
  /** Tier 2: bruisers, shield-bearers, gunners with armour. More ammo, real medicine, the odd rare. */
  {
    id: "tier-veteran", rolls: 2, empty: 0.2, credits: [20, 60],
    entries: [
      { item: "ammo-pistol", weight: 18, min: 8, max: 16 },
      { item: "ammo-shell", weight: 14, min: 3, max: 6 },
      { item: "ammo-rifle", weight: 8, min: 4, max: 10 },
      { item: "stim", weight: 16, min: 1, max: 2 },
      { item: "medkit", weight: 7 },
      { item: "haste-inhaler", weight: 5 },
      { item: "defrag-patch", weight: 4 },
      { item: "pool:uncommon:gear", weight: 8 },
      { item: "pool:rare:gear", weight: 4 },
      { item: "pool:epic:gear", weight: 0.8 },
    ],
  },
  /** Tier 3: officers, elite patrols, boss adds. Good consumables and a real shot at an epic. */
  {
    id: "tier-elite", rolls: 2, empty: 0.05, credits: [50, 140],
    entries: [
      { item: "medkit", weight: 10 },
      { item: "shield-cell", weight: 6 },
      { item: "focus-chip", weight: 6 },
      { item: "overclock-tab", weight: 5 },
      { item: "ammo-rifle", weight: 8, min: 8, max: 16 },
      { item: "ammo-shell", weight: 6, min: 4, max: 8 },
      { item: "pool:rare:gear", weight: 7 },
      { item: "pool:epic:gear", weight: 2 },
      { item: "pool:legendary:gear", weight: 0.2 },
    ],
  },
];

/** One roll of a table as probabilities: the chance of nothing plus each entry's chance (weight
 * share of the non-empty part). They always sum to 1, which the loot tests assert per table. */
export function lootOdds(table: LootTable): { empty: number; entries: { item: string; p: number }[] } {
  const total = table.entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
  if (total <= 0) return { empty: 1, entries: table.entries.map(e => ({ item: e.item, p: 0 })) };
  const empty = Math.min(1, Math.max(0, table.empty ?? 0));
  return { empty, entries: table.entries.map(e => ({ item: e.item, p: (1 - empty) * Math.max(0, e.weight) / total })) };
}

// Nested tables ("table:" entries and `also`) are cut off below this depth so a cyclic content
// pack cannot hang the game.
const MAX_DEPTH = 4;
const int = (rng: () => number, min: number, max: number): number => (max <= min ? min : min + Math.floor(rng() * (max - min + 1)));

/** Weighted loot tables. Deterministic for a given rng sequence and registry contents. */
export class LootSystem {
  private readonly registry: ItemRegistry;
  private readonly tables = new Map<string, LootTable>();

  constructor(registry: ItemRegistry, tables: readonly LootTable[] = LOOT_TABLES) {
    this.registry = registry;
    this.register(tables);
  }
  /** Adds tables; the same id replaces. */
  register(tables: readonly LootTable[] | undefined): void {
    for (const table of tables ?? []) this.tables.set(table.id, table);
  }
  table(id: string): LootTable | undefined { return this.tables.get(id); }

  /** Rolls a table; unknown tables drop nothing. Same-item results are merged into one stack. */
  roll(tableId: string, rng: () => number): LootRoll {
    const counts = new Map<string, number>();
    const credits = this.rollInto(tableId, rng, counts, 0);
    return { items: [...counts].map(([item, count]) => ({ item, count })), credits };
  }

  private rollInto(tableId: string, rng: () => number, out: Map<string, number>, depth: number): number {
    const table = this.tables.get(tableId);
    if (!table || depth > MAX_DEPTH) return 0;
    let credits = table.credits ? int(rng, Math.floor(table.credits[0]), Math.floor(table.credits[1])) : 0;
    const total = table.entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
    for (let r = 0; r < table.rolls; r++) {
      if (rng() < (table.empty ?? 0) || total <= 0) continue;
      const entry = this.pick(table.entries, total, rng());
      if (entry) credits += this.resolve(entry, rng, out, depth);
    }
    for (const other of table.also ?? []) credits += this.rollInto(other, rng, out, depth + 1);
    return credits;
  }

  private pick(entries: readonly LootEntry[], total: number, u: number): LootEntry | null {
    let t = u * total;
    for (const entry of entries) {
      t -= Math.max(0, entry.weight);
      if (t < 0) return entry;
    }
    return entries.length ? entries[entries.length - 1] : null;
  }

  private resolve(entry: LootEntry, rng: () => number, out: Map<string, number>, depth: number): number {
    const count = int(rng, Math.max(1, Math.floor(entry.min ?? 1)), Math.max(1, Math.floor(entry.max ?? entry.min ?? 1)));
    if (entry.item.startsWith("table:")) {
      let credits = 0;
      for (let i = 0; i < count; i++) credits += this.rollInto(entry.item.slice(6), rng, out, depth + 1);
      return credits;
    }
    let id = entry.item;
    if (id.startsWith("pool:")) {
      const [, rarity, filter] = id.split(":");
      if (!RARITIES.includes(rarity as Rarity)) return 0;
      const pool = this.registry.all().filter(def => def.rarity === rarity && pooled(def) && matchesFilter(def, filter));
      if (!pool.length) return 0;
      id = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))].id;
    }
    if (id === CREDIT_CHIP) return count;
    if (!this.registry.get(id)) return 0;
    out.set(id, (out.get(id) ?? 0) + count);
    return 0;
  }
}
