import type { GroundLootView, ItemStack } from "../types.ts";
import { CREDIT_CHIP } from "./catalogue.ts";
import type { Character } from "./character.ts";
import type { ItemRegistry } from "./registry.ts";
import { hashSeed, seededRng } from "./rng.ts";

/** Seconds before ground loot disappears (quest items never do). */
export const LOOT_DESPAWN = 180;
/** Default pickup reach in metres. */
export const PICKUP_RANGE = 2.2;

interface GroundItem { id: string; x: number; z: number; item: string; count: number; age: number }
/** What a pickup moved into the character. `leftover`: part of the pile stayed (carry limit). */
export interface PickupResult { taken: ItemStack[]; credits: number; leftover: boolean }

/** Items lying on the ground: drops from enemies and crates, and things the player threw away.
 * Each stack is its own pile, scattered a little around the drop point so a kill reads as a
 * spill of glyphs; placement is deterministic (seeded by the pile id) and only on walkable ground. */
export class WorldLoot {
  private readonly registry: ItemRegistry;
  private readonly canOccupy: (x: number, z: number) => boolean;
  private readonly piles = new Map<string, GroundItem>();
  private serial = 0;

  /** `canOccupy` is the world's walkability test (world.canOccupy); scatter never leaves it. */
  constructor(registry: ItemRegistry, canOccupy: (x: number, z: number) => boolean = () => true) {
    this.registry = registry; this.canOccupy = canOccupy;
  }

  /** Drops stacks (and credits, as a "$" credit chip) around (x, z). Unknown items are skipped. */
  drop(x: number, z: number, items: readonly ItemStack[], credits: number): void {
    const stacks: ItemStack[] = [];
    if (credits > 0) stacks.push({ item: CREDIT_CHIP, count: Math.floor(credits) });
    for (const stack of items) if (stack.count > 0 && this.registry.get(stack.item)) stacks.push({ item: stack.item, count: Math.floor(stack.count) });
    // A lone pile lands on the spot; a spill spreads out so the glyphs do not overlap.
    const scatter = stacks.length > 1;
    for (const stack of stacks) {
      const id = `loot-${++this.serial}`;
      const spot = scatter ? this.scatter(id, x, z) : { x, z };
      this.piles.set(id, { id, x: spot.x, z: spot.z, item: stack.item, count: stack.count, age: 0 });
    }
  }

  private scatter(id: string, x: number, z: number): { x: number; z: number } {
    const rng = seededRng(hashSeed(id));
    const angle = rng() * Math.PI * 2;
    const radius = 0.35 + rng() * 0.9;
    // Try the chosen spot, then rotate and pull in towards the centre until one is walkable.
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = angle + attempt * 2.4;
      const r = radius * (1 - attempt / 8);
      const px = x + Math.sin(a) * r, pz = z - Math.cos(a) * r;
      if (this.canOccupy(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }

  update(dt: number): void {
    for (const pile of this.piles.values()) {
      pile.age += dt;
      if (pile.age > LOOT_DESPAWN && this.registry.get(pile.item)?.kind !== "quest") this.piles.delete(pile.id);
    }
  }

  /** The closest pile within `range` of (x, z), or null. */
  nearest(x: number, z: number, range = PICKUP_RANGE): GroundLootView | null {
    let best: GroundItem | null = null, bestD = range;
    for (const pile of this.piles.values()) {
      const d = Math.hypot(pile.x - x, pile.z - z);
      if (d <= bestD) { best = pile; bestD = d; }
    }
    return best ? this.view(best) : null;
  }

  /** Moves a pile into the character: credit chips become credits; items stop at carry capacity
   * and the rest stays on the ground. */
  pickup(id: string, character: Character): PickupResult {
    const pile = this.piles.get(id);
    if (!pile) return { taken: [], credits: 0, leftover: false };
    if (pile.item === CREDIT_CHIP) {
      character.addCredits(pile.count);
      this.piles.delete(id);
      return { taken: [], credits: pile.count, leftover: false };
    }
    const added = character.add(pile.item, pile.count);
    pile.count -= added;
    const leftover = pile.count > 0;
    if (!leftover) this.piles.delete(id);
    return { taken: added > 0 ? [{ item: pile.item, count: added }] : [], credits: 0, leftover };
  }

  /** Piles within `radius` of (x, z) for rendering. */
  views(x: number, z: number, radius: number): GroundLootView[] {
    const out: GroundLootView[] = [];
    for (const pile of this.piles.values()) if (Math.hypot(pile.x - x, pile.z - z) <= radius) out.push(this.view(pile));
    return out;
  }
  get size(): number { return this.piles.size; }
  clear(): void { this.piles.clear(); }

  private view(pile: GroundItem): GroundLootView {
    const def = this.registry.get(pile.item);
    return {
      id: pile.id, x: pile.x, z: pile.z, item: pile.item,
      name: def?.name ?? pile.item, glyph: def?.glyph ?? "?", rarity: def?.rarity ?? "common",
      count: pile.count, age: pile.age,
    };
  }
}
