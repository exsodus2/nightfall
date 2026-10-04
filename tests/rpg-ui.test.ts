import assert from "node:assert/strict";
import test from "node:test";
import { ItemRegistry } from "../src/rpg/items/index.ts";
import {
  bar, buyBlocker, compareStats, comparisonTarget, factionRows, findItemMention, formatDelta, freshFeed, itemStats, parsePrompt, printableArt,
  rarityColor, repMeter, sellPrice, sortStacks, standing, tradeOutcome, type RpgCharacterView,
} from "../src/components/rpg/format.ts";

const items = new ItemRegistry().record();
const def = (id: string) => { const d = items[id]; assert.ok(d, id); return d; };
const row = (id: string, key: string) => itemStats(def(id)).find((r) => r.key === key);

test("stat rows: rate from cooldown, dps with pellets, units", () => {
  const shiv = def("backtick-shiv");
  assert.equal(row("backtick-shiv", "rate")?.value, 1 / shiv.weapon!.cooldown);
  assert.equal(row("backtick-shiv", "dps")?.value, shiv.weapon!.damage / shiv.weapon!.cooldown);
  assert.equal(row("backtick-shiv", "range")?.text, `${shiv.weapon!.range} m`);
  const scatter = def("colon-scatter").weapon!;
  if ((scatter.pellets ?? 1) > 1) assert.equal(row("colon-scatter", "damage")?.text, `${scatter.damage} x${scatter.pellets}`);
  assert.equal(row("firewall-vest", "protection")?.text, "28%");
  assert.equal(row("stim", "heal")?.text, "+35");
  assert.ok(itemStats(def("synth-ration")).some((r) => r.key === "heal" && r.text.includes("/ 15 s")));
  for (const d of Object.values(items)) for (const r of itemStats(d)) assert.match(r.text, /^[\x20-\x7e]+$/, `${d.id} ${r.key}`);
});

test("comparison deltas: direction-aware tones and units", () => {
  const rows = compareStats(itemStats(def("hash-hammer")), itemStats(def("backtick-shiv")));
  const dmg = rows.find((r) => r.key === "damage")!;
  assert.equal(dmg.tone, "better");
  assert.ok(dmg.deltaText?.startsWith("+"));
  const weight = rows.find((r) => r.key === "weight")!;
  assert.equal(weight.tone, "worse"); // heavier is worse
  const stamina = rows.find((r) => r.key === "stamina")!;
  assert.equal(stamina.tone, "worse"); // higher stamina cost is worse
  const same = compareStats(itemStats(def("stim")), itemStats(def("stim")));
  assert.ok(same.filter((r) => r.better).every((r) => r.tone === "same"));
  assert.equal(compareStats(itemStats(def("stim")), null).some((r) => r.tone), false);
  assert.equal(formatDelta("protection", 0.1), "+10%");
  assert.equal(formatDelta("range", -0.4), "-0.4 m");
  assert.equal(formatDelta("weight", 1.25), "+1.25 kg");
});

test("comparison target is the item in the candidate's natural slot", () => {
  const equipped = { melee: "backtick-shiv", body: "mesh-hoodie" };
  assert.equal(comparisonTarget(def("hash-hammer"), equipped, items)?.id, "backtick-shiv");
  assert.equal(comparisonTarget(def("backtick-shiv"), equipped, items), null); // itself
  assert.equal(comparisonTarget(def("riot-helm"), equipped, items), null); // empty head slot
  assert.equal(comparisonTarget(def("firewall-vest"), equipped, items)?.id, "mesh-hoodie");
  assert.equal(comparisonTarget(def("stim"), equipped, items), null);
});

test("feed dedupe: each id once, set pruned to the live feed", () => {
  let seen: Set<number> = new Set();
  const a = { id: 1, text: "a", tone: "info" as const }, b = { id: 2, text: "b", tone: "loot" as const }, c = { id: 3, text: "c", tone: "quest" as const };
  let r = freshFeed([a, b], seen); seen = r.seen;
  assert.deepEqual(r.fresh.map((e) => e.id), [1, 2]);
  r = freshFeed([a, b], seen); seen = r.seen;
  assert.equal(r.fresh.length, 0);
  r = freshFeed([b, c, c], seen); seen = r.seen;
  assert.deepEqual(r.fresh.map((e) => e.id), [3]);
  assert.deepEqual([...seen].sort(), [2, 3]);
  assert.equal(freshFeed(undefined, seen).fresh.length, 0);
});

test("item mentions pick the longest name; prompts split key, text and rarity", () => {
  assert.equal(findItemMention("Picked up Hash Hammer x1", items)?.name, "Hash Hammer");
  assert.equal(findItemMention("Picked up Hash Hammer x1", items)?.rarity, "rare");
  assert.equal(findItemMention("Nothing to see", items), null);
  assert.deepEqual(parsePrompt("E  Pick up Backslash [rare]"), { key: "E", text: "Pick up Backslash", rarity: "rare" });
  assert.deepEqual(parsePrompt("Search the crate"), { key: "E", text: "Search the crate", rarity: null });
  assert.deepEqual(parsePrompt("[E] Open [terminal]"), { key: "E", text: "Open [terminal]", rarity: null });
});

test("ASCII helpers: bars, reputation meter, standings, art", () => {
  assert.equal(bar(0.5, 10), "#####.....");
  assert.equal(bar(2, 4), "####");
  assert.equal(bar(Number.NaN, 3), "...");
  assert.deepEqual(repMeter(50, 10), { negative: "..........", positive: "#####....." });
  assert.deepEqual(repMeter(-100, 4), { negative: "####", positive: "...." });
  assert.equal(standing(-60).label, "Hostile");
  assert.equal(standing(0).label, "Neutral");
  assert.equal(standing(75).label, "Allied");
  assert.deepEqual(printableArt(["ab█c  ", "x".repeat(30)]), ["ab c", "x".repeat(24)]);
  const rows = factionRows({ razorbacks: 20, player: 100, "neon-choir": -5 });
  assert.equal(rows[0].id, "razorbacks");
  assert.ok(rows.some((r) => r.id === "neon-choir") && !rows.some((r) => r.id === "player"));
  assert.match(rarityColor("legendary"), /^rgb\(255 158 38\)$/);
});

test("inventory sort merges split stacks and orders weapons, armour, consumables", () => {
  const sorted = sortStacks([{ item: "stim", count: 2 }, { item: "ammo-pistol", count: 240 }, { item: "ammo-pistol", count: 10 }, { item: "backtick-shiv", count: 1 }, { item: "at-sigil", count: 1 }, { item: "mesh-hoodie", count: 1 }], items);
  assert.deepEqual(sorted.map((s) => s.item), ["at-sigil", "backtick-shiv", "mesh-hoodie", "stim", "ammo-pistol"]);
  assert.equal(sorted.find((s) => s.item === "ammo-pistol")?.count, 250);
});

test("trading: sell price, buy blockers and outcome lines", () => {
  assert.equal(sellPrice(def("medkit"), 2, 0.4), Math.floor(80 * 0.4 * 2));
  assert.equal(sellPrice(def("relay-keycard"), 1, 0.4), 0);
  const sheet = { credits: 100, carry: { weight: 44.5, capacity: 45 } } as RpgCharacterView;
  assert.equal(buyBlocker(def("medkit"), 120, sheet), "Not enough credits");
  assert.equal(buyBlocker(def("medkit"), 80, sheet), "Too heavy to carry");
  assert.equal(buyBlocker(def("focus-chip"), 80, sheet), null);
  assert.deepEqual(tradeOutcome({ kind: "buy", item: "stim", name: "Stim" }, { credits: 100, count: 0 }, { credits: 69, count: 1 }), { ok: true, text: "Bought Stim  -31 CR" });
  assert.deepEqual(tradeOutcome({ kind: "sell", item: "stim", name: "Stim" }, { credits: 0, count: 3 }, { credits: 30, count: 0 }), { ok: true, text: "Sold Stim x3  +30 CR" });
  assert.equal(tradeOutcome({ kind: "buy", item: "stim", name: "Stim" }, { credits: 1, count: 0 }, { credits: 1, count: 0 }), null);
});
