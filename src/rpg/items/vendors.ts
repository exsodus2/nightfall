import type { ContentPack } from "../types.ts";
import { CREDIT_CHIP } from "./catalogue.ts";
import type { Character } from "./character.ts";
import type { ItemRegistry } from "./registry.ts";

/** Vendors pay this fraction of an item's value. */
export const SELL_RATE = 0.4;
/** Ammo is sold in boxes of this many rounds (one purchase). */
export const AMMO_BUNDLE = 20;

type VendorDef = NonNullable<ContentPack["vendors"]>[number];
/** One line of a vendor's stock: `count` units for `price` credits. */
export interface VendorOffer { item: string; price: number; count: number }

/** NPC shops: fixed stock with a per-vendor markup. Anyone buys anything sellable (quest items
 * and credit chips excepted) at SELL_RATE of its value. */
export class Vendors {
  private readonly registry: ItemRegistry;
  private readonly defs = new Map<string, VendorDef>();

  constructor(registry: ItemRegistry) { this.registry = registry; }

  /** Adds vendors from a content pack; the same NPC replaces its earlier stock. */
  register(defs: ContentPack["vendors"]): void {
    for (const def of defs ?? []) this.defs.set(def.npc, def);
  }
  isVendor(npc: string): boolean { return this.defs.has(npc); }

  /** What an NPC sells, priced (value x markup, ammo per box); empty if not a vendor. */
  stock(npc: string): VendorOffer[] {
    const def = this.defs.get(npc);
    if (!def) return [];
    const markup = def.markup ?? 1;
    const out: VendorOffer[] = [];
    for (const id of def.stock) {
      const item = this.registry.get(id);
      if (!item || item.kind === "quest" || id === CREDIT_CHIP) continue;
      const count = item.kind === "ammo" ? Math.min(AMMO_BUNDLE, item.stack) : 1;
      out.push({ item: id, count, price: Math.max(1, Math.ceil(item.value * count * markup)) });
    }
    return out;
  }

  /** Buys one offer (one item, or a box of ammo). Fails without credits or carry room; nothing is charged then. */
  buy(npc: string, item: string, character: Character): boolean {
    const offer = this.stock(npc).find(o => o.item === item);
    if (!offer || character.credits < offer.price) return false;
    const def = this.registry.get(item);
    // Check the whole purchase fits before charging, so a full pack never eats credits.
    if (def && def.weight > 0 && character.weight + def.weight * offer.count > character.capacity + 1e-6) return false;
    if (!character.spend(offer.price)) return false;
    const added = character.add(item, offer.count);
    if (added < offer.count) {
      if (added > 0) character.remove(item, added);
      character.addCredits(offer.price);
      return false;
    }
    return true;
  }

  /** Price a vendor pays for `count` of an item (0 if unsellable). */
  sellPrice(item: string, count = 1): number {
    const def = this.registry.get(item);
    if (!def || def.kind === "quest" || item === CREDIT_CHIP || def.value <= 0) return 0;
    return Math.floor(def.value * SELL_RATE * count);
  }

  /** Sells up to `count` owned units; returns credits gained (0 if unsellable or not owned). */
  sell(item: string, count: number, character: Character): number {
    const n = Math.min(Math.floor(count), character.count(item));
    const price = this.sellPrice(item, n);
    if (n <= 0 || price <= 0 || !character.remove(item, n)) return 0;
    character.addCredits(price);
    return price;
  }
}
