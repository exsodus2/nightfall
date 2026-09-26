import assert from "node:assert/strict";
import test from "node:test";
import { EventBus } from "../src/rpg/events.ts";
import type { GameEvent } from "../src/rpg/types.ts";
import {
  CREDIT_CHIP, Character, ITEMS, ItemRegistry, LOOT_DESPAWN, LootSystem, MAX_LEVEL, SAVE_KEY, Vendors, WorldLoot,
  clearSave, loadSave, rarityTier, seededRng, startingState, writeSave, xpToNext, type SaveGame,
} from "../src/rpg/items/index.ts";

const registry = new ItemRegistry();
const setup = (state?: Parameters<typeof newCharacter>[0]) => newCharacter(state);
function newCharacter(state?: ConstructorParameters<typeof Character>[2]) {
  const bus = new EventBus();
  const events: GameEvent[] = [];
  bus.onAny(e => events.push(e));
  return { c: new Character(registry, bus, state), events, bus };
}
const empty = () => setup({ credits: 0, inventory: [], equipped: {}, loaded: {}, reputation: {} });
const printable = /^[\x20-\x7e]*$/;

test("every catalogue item has a printable glyph, valid art and sane stats", () => {
  const ids = new Set<string>();
  for (const item of ITEMS) {
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`); ids.add(item.id);
    assert.equal(item.glyph.length, 1, item.id);
    assert.match(item.glyph, /^[\x21-\x7e]$/, `${item.id} glyph`);
    for (const text of [item.name, item.description]) assert.match(text, printable, `${item.id} text`);
    if (item.art) {
      assert.ok(item.art.length >= 1 && item.art.length <= 8, `${item.id} art height`);
      for (const row of item.art) { assert.ok(row.length <= 24, `${item.id} art width: "${row}"`); assert.match(row, printable, `${item.id} art`); }
    }
    assert.ok(item.value >= 0 && item.weight >= 0 && item.stack >= 1, item.id);
    if (item.kind === "melee" || item.kind === "ranged") {
      const w = item.weapon;
      assert.ok(w, `${item.id} needs weapon stats`);
      assert.ok(item.art, `${item.id} weapons have art`);
      assert.equal(item.stack, 1);
      assert.ok(w.damage > 0 && w.range > 0 && w.cooldown > 0 && w.staminaCost >= 0 && w.knockback >= 0 && w.stagger >= 0, item.id);
      if (w.critChance !== undefined) assert.ok(w.critChance >= 0 && w.critChance <= 0.5 && (w.critMultiplier ?? 1) >= 1, item.id);
      if (item.kind === "melee") {
        assert.ok(["blade", "blunt", "baton"].includes(w.class) && w.range <= 4 && (w.arc ?? 0) > 0 && (w.heavyMultiplier ?? 0) > 1, item.id);
      } else {
        assert.ok(w.magazine && w.magazine > 0 && w.reload && w.reload > 0 && (w.spread ?? -1) >= 0, item.id);
        assert.equal(registry.get(w.ammo ?? "")?.kind, "ammo", `${item.id} ammo`);
      }
    }
    if (item.kind === "armor") assert.ok(item.armor && item.armor.protection > 0 && item.armor.protection < 0.5, item.id);
    if (item.kind === "consumable") assert.ok(item.consumable, item.id);
  }
  const weapons = ITEMS.filter(i => i.weapon);
  assert.ok(weapons.length >= 16);
  for (const cls of ["blade", "blunt", "baton", "pistol", "smg", "shotgun", "rifle"]) assert.ok(weapons.some(w => w.weapon?.class === cls), cls);
  for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"]) assert.ok(weapons.some(w => w.rarity === rarity), rarity);
  assert.equal(ITEMS.filter(i => i.kind === "ammo").length, 3);
  assert.ok(ITEMS.filter(i => i.kind === "armor").length >= 5);
  assert.ok(ITEMS.filter(i => i.kind === "consumable").length >= 6);
  // Melee-first: the best melee weapon beats the best gun of the same rarity on sustained damage.
  const dps = (id: string) => { const w = registry.require(id).weapon!; return (w.damage * (w.pellets ?? 1)) / w.cooldown; };
  assert.ok(dps("backtick-shiv") * 1.0 > dps("caret-45"), "starter blade out-damages starter pistol");
});

test("registry lookups, overrides and require", () => {
  const r = new ItemRegistry();
  assert.equal(r.get("stim")?.name, "Stim");
  assert.throws(() => r.require("nope"), /nope/);
  r.register([{ ...r.require("stim"), name: "Better Stim" }, { id: "x-test", name: "X", kind: "junk", rarity: "common", glyph: "x", description: "x", value: 1, weight: 0, stack: 1 }]);
  assert.equal(r.require("stim").name, "Better Stim");
  assert.equal(r.all().length, ITEMS.length + 1);
});

test("stacking respects stack size, weight and emits events", () => {
  const { c, events } = empty();
  assert.equal(c.add("stim", 13), 13);
  assert.deepEqual(c.state.inventory.map(s => s.count), [10, 3]);
  assert.equal(c.add("stim", 2), 2);
  assert.deepEqual(c.state.inventory.map(s => s.count), [10, 5]);
  assert.equal(c.count("stim"), 15);
  assert.deepEqual(events.filter(e => e.type === "itemAdded"), [{ type: "itemAdded", item: "stim", count: 13 }, { type: "itemAdded", item: "stim", count: 2 }]);
  assert.equal(c.add("nope"), 0);
  assert.ok(c.remove("stim", 11));
  assert.equal(c.count("stim"), 4);
  assert.ok(!c.remove("stim", 5), "all or nothing");
  assert.deepEqual(events.at(-1), { type: "itemRemoved", item: "stim", count: 11 });
  // Weight: 6 kg hammers into a 45 kg pack.
  assert.equal(c.add("hash-hammer", 10), 7);
  assert.ok(c.weight <= c.capacity);
  assert.equal(c.add("hash-hammer"), 0);
  assert.equal(c.add("warden-sigil"), 1, "quest items always fit");
  // Credit chips never become stacks.
  assert.equal(c.add(CREDIT_CHIP, 30), 30);
  assert.equal(c.credits, 30);
  assert.equal(c.count(CREDIT_CHIP), 0);
});

test("equip picks the slot by kind and class", () => {
  const { c } = empty();
  for (const id of ["backslash", "caret-45", "kernel-panic", "firewall-vest", "riot-helm", "stim", "medkit", "copper-scrap"]) c.add(id);
  assert.ok(!c.equip("null-pointer"), "must own it");
  assert.ok(c.equip("backslash")); assert.equal(c.state.equipped.melee, "backslash");
  assert.ok(c.equip("caret-45")); assert.equal(c.state.equipped.sidearm, "caret-45");
  assert.ok(c.equip("kernel-panic")); assert.equal(c.state.equipped.primary, "kernel-panic");
  assert.ok(c.equip("firewall-vest")); assert.equal(c.state.equipped.body, "firewall-vest");
  assert.ok(c.equip("riot-helm")); assert.equal(c.state.equipped.head, "riot-helm");
  assert.ok(c.equip("stim")); assert.equal(c.state.equipped.quick1, "stim");
  assert.ok(c.equip("medkit")); assert.equal(c.state.equipped.quick2, "medkit");
  assert.ok(!c.equip("copper-scrap"));
  assert.equal(c.weaponFor("melee")?.id, "backslash");
  assert.equal(c.weaponFor("sidearm")?.id, "caret-45");
  assert.equal(c.weaponFor("primary")?.id, "kernel-panic");
  assert.equal(c.weaponFor("unarmed"), null);
  assert.ok(Math.abs(c.protection - 0.38) < 1e-9);
  assert.ok(c.assignQuick("stim", 2));
  assert.equal(c.state.equipped.quick2, "stim");
  assert.equal(c.state.equipped.quick1, undefined, "moved, not duplicated");
  assert.ok(!c.assignQuick("backslash", 1));
  assert.ok(c.unequip("primary"));
  assert.equal(c.weaponFor("primary"), null);
  // Selling/dropping the last copy clears the slot.
  c.remove("backslash");
  assert.equal(c.equipped("melee"), null);
});

test("protection caps at 0.8 and stats come from level and gear tags", () => {
  const r = new ItemRegistry();
  r.register([{ id: "slab", name: "Slab", kind: "armor", rarity: "common", glyph: "S", description: "", value: 1, weight: 0, stack: 1, armor: { slot: "body", protection: 0.7 } },
    { id: "lid", name: "Lid", kind: "armor", rarity: "common", glyph: "L", description: "", value: 1, weight: 0, stack: 1, armor: { slot: "head", protection: 0.5 } }]);
  const c = new Character(r, new EventBus(), { inventory: [{ item: "slab", count: 1 }, { item: "lid", count: 1 }], equipped: { body: "slab", head: "lid" } });
  assert.equal(c.protection, 0.8);
  const { c: s } = empty();
  assert.deepEqual(s.stats, { cool: 1, tech: 1, street: 1 });
  s.add("null-pointer"); s.equip("null-pointer"); // epic, tech + cool
  s.add("riot-helm"); s.equip("riot-helm"); // uncommon, street
  assert.deepEqual(s.stats, { cool: 3, tech: 3, street: 2 });
});

test("ammo: reload from reserve, spend rounds, rounds return when the gun is removed", () => {
  const { c } = empty();
  c.add("caret-45"); c.equip("caret-45");
  assert.equal(c.loaded("caret-45"), 0);
  assert.equal(c.reload("caret-45"), 0, "no ammo");
  c.add("ammo-pistol", 12);
  assert.equal(c.reload("caret-45"), 8);
  assert.equal(c.reserve("ammo-pistol"), 4);
  assert.equal(c.reload("caret-45"), 0, "already full");
  for (let i = 0; i < 3; i++) assert.ok(c.spendRound("caret-45"));
  assert.equal(c.loaded("caret-45"), 5);
  assert.equal(c.reload("caret-45"), 3);
  assert.equal(c.reserve("ammo-pistol"), 1);
  for (let i = 0; i < 8; i++) c.spendRound("caret-45");
  assert.ok(!c.spendRound("caret-45"));
  assert.equal(c.reload("caret-45"), 1);
  c.add("ammo-pistol", 10); c.reload("caret-45");
  assert.equal(c.loaded("caret-45"), 8);
  c.remove("caret-45");
  assert.equal(c.reserve("ammo-pistol"), 11, "loaded rounds go back to the reserve");
  c.add("backslash");
  assert.equal(c.reload("backslash"), 0, "melee never reloads");
});

test("quick slots and inventory use consume items and emit itemUsed", () => {
  const { c, events } = setup();
  assert.equal(c.state.equipped.quick1, "stim");
  assert.deepEqual(c.useQuick(1), { heal: 35 });
  assert.deepEqual(c.useQuick(1), { heal: 35 });
  assert.equal(c.useQuick(1), null, "out of stims");
  assert.equal(c.state.equipped.quick1, "stim", "slot stays assigned for a restock");
  assert.equal(events.filter(e => e.type === "itemUsed").length, 2);
  c.add("stim");
  assert.ok(c.useQuick(1));
  assert.equal(c.useQuick(2)?.effect, "regen");
  assert.equal(c.use("backtick-shiv"), null);
  c.add("focus-chip");
  assert.equal(c.use("focus-chip")?.effect, "focus");
  assert.equal(c.count("focus-chip"), 0);
});

test("starting kit is sensible", () => {
  const { c } = setup();
  assert.equal(c.credits, 50);
  assert.equal(c.level, 1);
  assert.equal(c.weaponFor("melee")?.weapon?.class, "blade");
  assert.equal(c.weaponFor("sidearm")?.weapon?.class, "pistol");
  assert.equal(c.loaded("caret-45"), 8);
  assert.ok(c.reserve("ammo-pistol") > 0);
  assert.equal(c.count("stim"), 2);
  assert.ok(c.protection > 0);
  // The constructor copies: mutating the character never touches a fresh starting state.
  c.add("stim");
  assert.equal(startingState().inventory.find(s => s.item === "stim")?.count, 2);
});

test("credits and reputation", () => {
  const { c } = empty();
  c.addCredits(100);
  assert.ok(c.spend(60));
  assert.ok(!c.spend(41));
  assert.equal(c.credits, 40);
  c.addCredits(-500);
  assert.equal(c.credits, 0);
  assert.equal(c.reputation("razorbacks"), 0);
  assert.equal(c.addReputation("razorbacks", 30), 30);
  assert.equal(c.addReputation("razorbacks", 300), 100);
  assert.equal(c.addReputation("corpsec", -250), -100);
});

test("xp curve rises steadily and level-ups scale the character up to the cap", () => {
  for (let l = 1; l < MAX_LEVEL - 1; l++) assert.ok(xpToNext(l + 1) > xpToNext(l), `curve rises at ${l}`);
  assert.equal(xpToNext(1), 200);
  assert.equal(xpToNext(MAX_LEVEL), 0);
  const { c, events } = empty();
  const hp1 = c.maxHealth, st1 = c.maxStamina, dmg1 = c.damageBonus;
  assert.deepEqual(c.addXp(150), { levelsGained: 0 });
  assert.deepEqual(c.addXp(60), { levelsGained: 1 });
  assert.equal(c.level, 2);
  assert.equal(c.xp, 10);
  assert.ok(c.maxHealth > hp1 && c.maxStamina > st1 && c.damageBonus > dmg1);
  assert.ok(events.some(e => e.type === "message" && /level 2/i.test(e.text)));
  // A big lump crosses several levels at once.
  const gained = c.addXp(xpToNext(2) + xpToNext(3) + xpToNext(4) - 10).levelsGained;
  assert.equal(gained, 3);
  assert.equal(c.level, 5);
  c.addXp(1e9);
  assert.equal(c.level, MAX_LEVEL);
  assert.equal(c.xp, 0);
  assert.deepEqual(c.addXp(500), { levelsGained: 0 });
});

test("loot rolls are deterministic and weighted like an MMO", () => {
  const loot = new LootSystem(registry);
  assert.deepEqual(loot.roll("street-thug", seededRng(7)), loot.roll("street-thug", seededRng(7)));
  assert.deepEqual(loot.roll("missing", seededRng(1)), { items: [], credits: 0 });
  const tally = (table: string, n: number) => {
    const rng = seededRng(42);
    const byTier = [0, 0, 0, 0, 0];
    let credits = 0, drops = 0;
    for (let i = 0; i < n; i++) {
      const r = loot.roll(table, rng);
      credits += r.credits;
      for (const s of r.items) { byTier[rarityTier(registry.require(s.item).rarity)]++; drops++; }
    }
    return { byTier, credits, drops };
  };
  const thug = tally("street-thug", 4000);
  assert.ok(thug.byTier[0] > thug.byTier[1] * 4, `commons dominate ${thug.byTier}`);
  assert.ok(thug.byTier[1] > thug.byTier[2] * 3, `uncommon > rare ${thug.byTier}`);
  assert.ok(thug.byTier[2] > thug.byTier[3], `rare > epic ${thug.byTier}`);
  assert.equal(thug.byTier[4], 0, "street thugs never drop legendaries");
  assert.ok(thug.credits / 4000 > 4 && thug.credits / 4000 < 22);
  const crate = tally("crate-rare", 2000);
  assert.ok(crate.byTier[2] > 0 && crate.drops / 2000 > 2);
  // Bosses always drop something great, plus a pile of credits.
  const rng = seededRng(99);
  for (let i = 0; i < 300; i++) {
    const r = loot.roll("boss-legendary", rng);
    assert.ok(r.items.some(s => rarityTier(registry.require(s.item).rarity) >= 3), `boss roll ${i} had no epic+`);
    assert.ok(r.credits >= 450);
    for (const s of r.items) assert.notEqual(registry.require(s.item).kind, "quest");
  }
});

test("loot tables can nest and pool from content items", () => {
  const r = new ItemRegistry();
  r.register([{ id: "pack-gun", name: "Pack Gun", kind: "ranged", rarity: "legendary", glyph: "P", description: "", value: 1, weight: 1, stack: 1, weapon: { class: "smg", damage: 1, range: 1, cooldown: 1, staminaCost: 0, knockback: 0, stagger: 0, magazine: 1, ammo: "ammo-pistol", reload: 1, spread: 0 } }]);
  const loot = new LootSystem(r, [
    { id: "outer", rolls: 1, empty: 0, entries: [{ item: "table:inner", weight: 1 }], credits: [5, 5] },
    { id: "inner", rolls: 2, empty: 0, entries: [{ item: "pool:legendary:smg", weight: 1 }] },
    { id: "loop", rolls: 1, empty: 0, entries: [{ item: "table:loop", weight: 1 }] },
  ]);
  assert.deepEqual(loot.roll("outer", seededRng(3)), { items: [{ item: "pack-gun", count: 2 }], credits: 5 });
  assert.deepEqual(loot.roll("loop", seededRng(3)), { items: [], credits: 0 }, "cycles terminate");
});

test("world loot scatters onto walkable ground, despawns and picks up", () => {
  const walkable = (x: number) => x >= 0; // everything west of x = 0 is a wall
  const world = new WorldLoot(registry, walkable);
  world.drop(0, 0, [{ item: "stim", count: 2 }, { item: "backslash", count: 1 }, { item: "copper-scrap", count: 3 }], 25);
  const piles = world.views(0, 0, 5);
  assert.equal(piles.length, 4);
  for (const p of piles) { assert.ok(walkable(p.x), `pile at ${p.x}`); assert.ok(Math.hypot(p.x, p.z) < 1.4); }
  assert.ok(new Set(piles.map(p => `${p.x.toFixed(3)},${p.z.toFixed(3)}`)).size > 1, "piles spread out");
  const again = new WorldLoot(registry, walkable);
  again.drop(0, 0, [{ item: "stim", count: 2 }, { item: "backslash", count: 1 }, { item: "copper-scrap", count: 3 }], 25);
  assert.deepEqual(again.views(0, 0, 5), piles, "deterministic scatter");
  const chip = piles.find(p => p.item === CREDIT_CHIP);
  assert.ok(chip && chip.glyph === "$" && chip.count === 25);
  assert.equal(world.nearest(50, 50), null);
  assert.ok(world.nearest(0, 0));

  const { c } = empty();
  assert.deepEqual(world.pickup(chip.id, c), { taken: [], credits: 25, leftover: false });
  assert.equal(c.credits, 25);
  const blade = piles.find(p => p.item === "backslash")!;
  assert.deepEqual(world.pickup(blade.id, c), { taken: [{ item: "backslash", count: 1 }], credits: 0, leftover: false });
  assert.equal(c.count("backslash"), 1);
  assert.equal(world.size, 2);
  assert.deepEqual(world.pickup("loot-999", c), { taken: [], credits: 0, leftover: false });

  // A full pack leaves the rest on the ground.
  const heavy = new WorldLoot(registry);
  heavy.drop(10, 10, [{ item: "hash-hammer", count: 9 }], 0);
  const pile = heavy.nearest(10, 10)!;
  const got = heavy.pickup(pile.id, c);
  assert.ok(got.leftover && got.taken[0].count < 9);
  assert.equal(heavy.nearest(10, 10)!.count, 9 - got.taken[0].count);

  world.update(LOOT_DESPAWN + 1);
  assert.equal(world.size, 0);
  const quest = new WorldLoot(registry);
  quest.drop(0, 0, [{ item: "warden-sigil", count: 1 }], 0);
  quest.update(LOOT_DESPAWN * 5);
  assert.equal(quest.size, 1, "quest items never despawn");
});

test("vendors sell with markup, buy back at 40%, refuse quest items", () => {
  const vendors = new Vendors(registry);
  vendors.register([{ npc: "fixer", stock: ["stim", "ammo-pistol", "backslash", "warden-sigil"], markup: 1.5 }]);
  const stock = vendors.stock("fixer");
  assert.deepEqual(stock.map(o => o.item), ["stim", "ammo-pistol", "backslash"], "quest items are never stocked");
  assert.equal(stock[0].price, Math.ceil(25 * 1.5));
  assert.equal(stock[1].count, 20, "ammo comes by the box");
  assert.deepEqual(vendors.stock("nobody"), []);

  const { c } = empty();
  c.addCredits(100);
  assert.ok(vendors.buy("fixer", "stim", c));
  assert.equal(c.credits, 100 - 38);
  assert.equal(c.count("stim"), 1);
  assert.ok(!vendors.buy("fixer", "backslash", c), "cannot afford");
  assert.equal(c.count("backslash"), 0);
  assert.ok(vendors.buy("fixer", "ammo-pistol", c));
  assert.equal(c.count("ammo-pistol"), 20);
  assert.ok(!vendors.buy("fixer", "medkit", c), "not stocked");

  c.add("backslash");
  const before = c.credits;
  assert.equal(vendors.sell("backslash", 1, c), 360);
  assert.equal(c.credits, before + 360);
  assert.equal(c.count("backslash"), 0);
  c.add("warden-sigil");
  assert.equal(vendors.sell("warden-sigil", 1, c), 0);
  assert.equal(c.count("warden-sigil"), 1);
  assert.equal(vendors.sell("medkit", 1, c), 0, "not owned");
  c.add("copper-scrap", 10);
  assert.equal(vendors.sell("copper-scrap", 50, c), Math.floor(6 * 0.4 * 10), "sells what you have");

  // Full pack: purchase refused and nothing charged.
  const { c: loaded } = empty();
  loaded.addCredits(10_000); loaded.add("hash-hammer", 7);
  vendors.register([{ npc: "smith", stock: ["hash-hammer"] }]);
  const credits = loaded.credits;
  assert.ok(!vendors.buy("smith", "hash-hammer", loaded));
  assert.equal(loaded.credits, credits);
});

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

test("save games round-trip and corrupt saves are rejected", () => {
  const { c } = setup();
  c.addXp(500); c.addReputation("ghosts", 12); c.add("backslash"); c.equip("backslash");
  const save: SaveGame = {
    version: 1, savedAt: 1234, character: c.serialize(), quests: { active: ["q1"] }, flags: { met: true, count: 3, name: "x" },
    discovered: ["park"], encounters: [{ id: "e", cleared: true }], position: { x: 1.5, z: -2, yaw: 0.3 },
  };
  const storage = new MemoryStorage();
  assert.ok(writeSave(storage, save));
  assert.ok(storage.data.has(SAVE_KEY));
  const loaded = loadSave(storage);
  assert.deepEqual(loaded, save);
  const restored = new Character(registry, new EventBus(), loaded!.character);
  assert.deepEqual(restored.serialize(), c.serialize());
  assert.equal(restored.weaponFor("melee")?.id, "backslash");

  assert.equal(loadSave(new MemoryStorage()), null, "no save");
  const bad = (mutate: (s: Record<string, unknown>) => void) => {
    const copy = JSON.parse(JSON.stringify(save)) as Record<string, unknown>;
    mutate(copy);
    storage.setItem(SAVE_KEY, JSON.stringify(copy));
    return loadSave(storage);
  };
  assert.equal(bad(s => { s.version = 0; }), null);
  assert.equal(bad(s => { delete s.savedAt; }), null);
  assert.equal(bad(s => { (s.character as Record<string, unknown>).level = 99; }), null);
  assert.equal(bad(s => { (s.character as Record<string, unknown>).credits = "lots"; }), null);
  assert.equal(bad(s => { (s.character as Record<string, unknown>).inventory = [{ item: "stim", count: -1 }]; }), null);
  assert.equal(bad(s => { (s.character as Record<string, unknown>).equipped = { hands: "stim" }; }), null);
  assert.equal(bad(s => { s.flags = { x: { nested: true } }; }), null);
  assert.equal(bad(s => { s.discovered = [1]; }), null);
  assert.equal(bad(s => { s.position = { x: 1 }; }), null);
  assert.deepEqual(bad(s => { s.position = null; s.extra = "future field"; }), { ...save, position: null });
  storage.setItem(SAVE_KEY, "{not json");
  assert.equal(loadSave(storage), null);

  const throwing = { getItem(): string | null { throw new Error("denied"); }, setItem(): void { throw new Error("full"); }, removeItem(): void { throw new Error("denied"); } };
  assert.equal(loadSave(throwing), null);
  assert.equal(writeSave(throwing, save), false);
  assert.equal(clearSave(throwing), false);
  assert.ok(clearSave(storage));
  assert.equal(loadSave(storage), null);
});
