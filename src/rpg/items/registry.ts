import type { EquipSlot, ItemDefinition, Rarity } from "../types.ts";
import { ITEMS, MELEE_CLASSES } from "./catalogue.ts";

/** Rarity tiers from lowest to highest (index = tier). */
export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
/** Numeric tier of a rarity: common 0 .. legendary 4. */
export const rarityTier = (rarity: Rarity): number => RARITIES.indexOf(rarity);
/** MMO-convention rarity colours (0..1 RGB) for names, glyphs and ground beams. */
export const RARITY_COLOR: Readonly<Record<Rarity, readonly [number, number, number]>> = {
  common: [0.82, 0.84, 0.86],
  uncommon: [0.3, 0.95, 0.4],
  rare: [0.3, 0.6, 1],
  epic: [0.75, 0.4, 1],
  legendary: [1, 0.62, 0.15],
};

/** The equipment slot an item goes in by default (quick slots for consumables: quick1). */
export function slotFor(def: ItemDefinition): EquipSlot | null {
  if (def.weapon) {
    if (MELEE_CLASSES.has(def.weapon.class)) return "melee";
    return def.weapon.class === "pistol" ? "sidearm" : "primary";
  }
  if (def.armor) return def.armor.slot;
  if (def.kind === "consumable" && def.consumable) return "quick1";
  return null;
}

/** Item database: the base catalogue plus whatever content packs register later (same id replaces). */
export class ItemRegistry {
  private readonly items = new Map<string, ItemDefinition>();

  constructor(items: readonly ItemDefinition[] = ITEMS) { this.register(items); }

  /** Adds items; a later definition with the same id overrides the earlier one. */
  register(items: readonly ItemDefinition[] | undefined): void {
    for (const item of items ?? []) this.items.set(item.id, item);
  }
  get(id: string): ItemDefinition | undefined { return this.items.get(id); }
  /** Like get, but a missing id is a content bug: throws with the id. */
  require(id: string): ItemDefinition {
    const item = this.items.get(id);
    if (!item) throw new Error(`ItemRegistry: unknown item "${id}"`);
    return item;
  }
  all(): readonly ItemDefinition[] { return [...this.items.values()]; }
  /** Plain record of every definition, for the UI snapshot. */
  record(): Readonly<Record<string, ItemDefinition>> { return Object.fromEntries(this.items); }
}
