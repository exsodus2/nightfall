// Public API of rpg/items: item database, the Character sheet, loot tables, ground loot, vendors
// and save games. Other systems import from here only.

/** Base item catalogue, the "$" credit chip id and the melee weapon classes. */
export { ITEMS, CREDIT_CHIP, MELEE_CLASSES } from "./catalogue.ts";
/** Item registry plus rarity helpers and the default slot rule. */
export { ItemRegistry, RARITIES, RARITY_COLOR, rarityTier, slotFor } from "./registry.ts";
/** Character sheet (implements CombatCharacter), the xp curve and a new game's state. */
export { Character, MAX_LEVEL, PROTECTION_CAP, REP_MAX, REP_MIN, startingState, xpToNext } from "./character.ts";
/** Weighted loot tables and the base table set. */
export { LOOT_TABLES, LootSystem, type LootRoll } from "./loot.ts";
/** Items lying in the world, with scatter, despawn and pickup. */
export { LOOT_DESPAWN, PICKUP_RANGE, WorldLoot, type PickupResult } from "./world-loot.ts";
/** NPC shops: stock, buying and selling. */
export { AMMO_BUNDLE, SELL_RATE, Vendors, type VendorOffer } from "./vendors.ts";
/** Save games in a Storage-like object; never throws. */
export { SAVE_KEY, clearSave, loadSave, parseSave, writeSave, type SaveGame } from "./save.ts";
/** Deterministic PRNG helpers (seed loot rolls, tests). */
export { hashSeed, seededRng } from "./rng.ts";
