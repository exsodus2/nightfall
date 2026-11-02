import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import { ITEMS, LOOT_TABLES } from "../src/rpg/items/index.ts";

// The sprint's additions to the base catalogue (see the balance notes at the top of catalogue.ts).
const NEW_WEAPONS = ["hyphen", "shebang", "open-paren", "query", "tab-stop", "less-than", "interrupt", "fork-bomb", "close-brace"];
const NEW_ARMOUR = ["sandbox-poncho", "patch-notes", "kernel-plate", "root-kit", "welders-mask", "null-hood"];
const NEW_CONSUMABLES = ["hana-broth", "kiln-coffee", "sealant-spray", "defrag-patch", "overclock-tab", "static-jar", "moss-poultice", "glare-drops"];
const NEW_GOODS = ["foundry-slag", "afterlight-token", "river-glass", "tea-brick", "rainfern-seeds", "hologram-gel", "antenna-core"];
const KEEPSAKES = ["choir-tuning-fork", "chrome-rosary", "paid-warrant"];
const DPS_BAND: Record<string, readonly [number, number]> = { common: [28, 36], uncommon: [35, 45], rare: [50, 70], epic: [78, 102], legendary: [112, 122] };
const byId = new Map(ITEMS.map(item => [item.id, item]));

test("content: new weapons sit inside their rarity's DPS tier", () => {
  for (const id of NEW_WEAPONS) {
    const item = byId.get(id), w = item?.weapon;
    assert.ok(item && w, id);
    const dps = w.damage * (w.pellets ?? 1) / w.cooldown;
    const [low, high] = DPS_BAND[item.rarity];
    assert.ok(dps >= low && dps <= high, `${id} (${item.rarity}) dps ${dps.toFixed(1)} outside ${low}-${high}`);
    assert.ok(item.art && item.art.length >= 3, `${id} has real art`);
  }
});

test("content: new armour, consumables and goods use only engine-known slots and effects", () => {
  for (const id of NEW_ARMOUR) assert.ok(byId.get(id)?.armor, id);
  for (const id of NEW_CONSUMABLES) {
    const consumable = byId.get(id)?.consumable;
    assert.ok(consumable && (consumable.heal || consumable.stamina || consumable.effect), id);
    if (consumable.effect) assert.ok(["regen", "focus", "haste", "shield"].includes(consumable.effect) && (consumable.duration ?? 0) > 0, id);
  }
  for (const id of [...NEW_GOODS, ...KEEPSAKES]) assert.equal(byId.get(id)?.kind, "junk", id);
  for (const id of KEEPSAKES) assert.ok(byId.get(id)?.tags?.includes("keepsake"), id);
});

test("content: every new item can actually be found, bought or dropped", () => {
  const tables = [...LOOT_TABLES, ...CONTENT_PACKS.flatMap(pack => pack.loot ?? [])];
  const dropped = new Set(tables.flatMap(table => table.entries.map(entry => entry.item)));
  const sold = new Set(CONTENT_PACKS.flatMap(pack => (pack.vendors ?? []).flatMap(vendor => vendor.stock)));
  for (const id of [...NEW_WEAPONS, ...NEW_ARMOUR, ...NEW_CONSUMABLES, ...NEW_GOODS, ...KEEPSAKES]) {
    assert.ok(dropped.has(id) || sold.has(id), `${id} has no source`);
  }
  // Keepsakes come only from the stories' enemies, never from a shop.
  for (const id of KEEPSAKES) assert.ok(!sold.has(id) && dropped.has(id), id);
});

test("content: every catalogue item is printable ASCII and obtainable", () => {
  const printable = /^[\x20-\x7e]*$/;
  const tables = [...LOOT_TABLES, ...CONTENT_PACKS.flatMap(pack => pack.loot ?? [])];
  const dropped = new Set(tables.flatMap(table => table.entries.map(entry => entry.item)));
  const sold = new Set(CONTENT_PACKS.flatMap(pack => (pack.vendors ?? []).flatMap(vendor => vendor.stock)));
  // Pools ("pool:<rarity>[:filter]") hand out any non-quest item of a rarity, so gear in a pooled
  // rarity counts as obtainable too.
  const pools = [...dropped].filter(id => id.startsWith("pool:")).map(id => id.split(":"));
  const gear = (kind: string) => kind === "melee" || kind === "ranged" || kind === "armor";
  for (const item of ITEMS) {
    assert.ok(printable.test(item.name) && printable.test(item.description) && printable.test(item.glyph), `${item.id} text is printable ASCII`);
    for (const row of item.art ?? []) assert.ok(printable.test(row), `${item.id} art row is printable ASCII: ${row}`);
    if (item.kind === "quest" || item.id === "credit-chip") continue;
    const pooled = pools.some(([, rarity, filter]) => rarity === item.rarity && (!filter || filter === item.kind || filter === item.weapon?.class || filter === "gear" && gear(item.kind) || filter === "weapon" && (item.kind === "melee" || item.kind === "ranged")));
    assert.ok(dropped.has(item.id) || sold.has(item.id) || pooled, `${item.id} has no source`);
  }
});
