// Pure view helpers for the RPG screens (inventory, character sheet, vendor, feed). No React, no
// DOM: tests/rpg-ui.test.ts runs them under node --experimental-strip-types, hence the explicit
// ".ts" imports. Everything the player reads is built from printable ASCII.

import type { EquipSlot, ItemDefinition, ItemStack, Rarity, RpgSnapshot } from "../../rpg/types.ts";
import { RARITY_COLOR, rarityTier, slotFor } from "../../rpg/items/index.ts";

export type RpgCharacterView = RpgSnapshot["character"];
export type FeedEntry = RpgSnapshot["feed"][number];
export type FeedTone = FeedEntry["tone"];

// ---- Rarity & labels --------------------------------------------------------------------------

/** CSS colour of a rarity (from the shared 0..1 RGB table, so names match the in-world beams). */
export function rarityColor(rarity: Rarity): string {
  const [r, g, b] = RARITY_COLOR[rarity] ?? RARITY_COLOR.common;
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** Equipment slots in paper-doll order, with the key that selects / uses them in play. */
export const EQUIP_SLOTS: readonly { slot: EquipSlot; label: string; key: string; hint: string }[] = [
  { slot: "melee", label: "Melee", key: "1", hint: "Blade, blunt, baton" },
  { slot: "sidearm", label: "Sidearm", key: "2", hint: "Pistol" },
  { slot: "primary", label: "Primary", key: "3", hint: "SMG, shotgun, rifle" },
  { slot: "head", label: "Head", key: "", hint: "Helmet, cap, rig" },
  { slot: "body", label: "Body", key: "", hint: "Vest, jacket, plate" },
  { slot: "quick1", label: "Quick", key: "Q", hint: "Consumable" },
  { slot: "quick2", label: "Quick", key: "Z", hint: "Consumable" },
];

const CLASS_LABEL: Record<string, string> = { blade: "Blade", blunt: "Blunt", baton: "Baton", pistol: "Pistol", smg: "SMG", shotgun: "Shotgun", rifle: "Rifle" };

/** "Blade / melee", "Body armour", "Consumable", ... */
export function kindLabel(def: ItemDefinition): string {
  if (def.weapon) return `${CLASS_LABEL[def.weapon.class] ?? def.weapon.class} / ${def.kind === "melee" ? "melee" : "ranged"}`;
  if (def.armor) return def.armor.slot === "head" ? "Head armour" : "Body armour";
  switch (def.kind) {
    case "consumable": return "Consumable";
    case "ammo": return "Ammunition";
    case "mod": return "Weapon mod";
    case "quest": return "Quest item";
    case "junk": return "Trade good";
    default: return def.kind;
  }
}

export type InventoryFilter = "all" | "weapons" | "gear" | "consumables" | "ammo" | "other";
export const INVENTORY_FILTERS: readonly { id: InventoryFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "weapons", label: "Weapons" }, { id: "gear", label: "Armour" },
  { id: "consumables", label: "Use" }, { id: "ammo", label: "Ammo" }, { id: "other", label: "Other" },
];
/** Which filter tab an item belongs to. */
export function filterOf(def: ItemDefinition): Exclude<InventoryFilter, "all"> {
  if (def.weapon) return "weapons";
  if (def.armor) return "gear";
  if (def.kind === "consumable") return "consumables";
  if (def.kind === "ammo") return "ammo";
  return "other";
}
const FILTER_ORDER: Record<Exclude<InventoryFilter, "all">, number> = { weapons: 0, gear: 1, consumables: 2, ammo: 3, other: 4 };

/** Inventory order: weapons, armour, consumables, ammo, the rest; rarest first, then by name.
 * Stacks whose definition is missing sort last (they still render, as unknown items). */
export function sortStacks(stacks: readonly ItemStack[], items: Readonly<Record<string, ItemDefinition>>): ItemStack[] {
  const rank = (stack: ItemStack): [number, number, string] => {
    const def = items[stack.item];
    if (!def) return [9, 0, stack.item];
    return [FILTER_ORDER[filterOf(def)], -rarityTier(def.rarity), def.name];
  };
  // Actions address item ids, so split stacks of one item (ammo past its stack size) show as one row.
  const merged = new Map<string, number>();
  for (const stack of stacks) if (stack.count > 0) merged.set(stack.item, (merged.get(stack.item) ?? 0) + stack.count);
  return [...merged].map(([item, count]) => ({ item, count })).sort((a, b) => {
    const [fa, ra, na] = rank(a), [fb, rb, nb] = rank(b);
    return fa - fb || ra - rb || na.localeCompare(nb);
  });
}

/** Item id -> the equipment slot it occupies (an item may sit in one slot only). */
export function equippedSlots(equipped: Partial<Record<EquipSlot, string>>): Map<string, EquipSlot> {
  const out = new Map<string, EquipSlot>();
  for (const { slot } of EQUIP_SLOTS) { const id = equipped[slot]; if (id && !out.has(id)) out.set(id, slot); }
  return out;
}

/** Short badge for an equipped item in lists: "1", "2", "3", "HD", "BD", "Q", "Z". */
export function slotBadge(slot: EquipSlot): string {
  return slot === "head" ? "HD" : slot === "body" ? "BD" : EQUIP_SLOTS.find((entry) => entry.slot === slot)?.key ?? "";
}

// ---- Numbers & ASCII bars -----------------------------------------------------------------------

/** 12,480 */
export function formatCr(credits: number): string { return Math.round(credits).toLocaleString("en-US"); }
/** 0.3 -> "0.3", 12 -> "12", 2.25 -> "2.3" (kilograms and seconds in the stat tables). */
export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "-";
  const fixed = value.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/** A filled ASCII bar: bar(0.4, 10) = "####......". */
export function bar(fraction: number, width: number, fill = "#", empty = "."): string {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const n = Math.round(f * width);
  return fill.repeat(n) + empty.repeat(Math.max(0, width - n));
}

/** Reputation meter from -100..100 around a centre mark: the negative half fills leftwards from the
 * centre, the positive half rightwards. `half` is the character count of each side. */
export function repMeter(value: number, half = 10): { negative: string; positive: string } {
  const v = Math.max(-100, Math.min(100, Number.isFinite(value) ? value : 0));
  const n = Math.round((Math.abs(v) / 100) * half);
  return v < 0
    ? { negative: ".".repeat(half - n) + "#".repeat(n), positive: ".".repeat(half) }
    : { negative: ".".repeat(half), positive: "#".repeat(n) + ".".repeat(half - n) };
}

/** Standing name for a reputation value. */
export function standing(value: number): { label: string; tone: "hostile" | "cold" | "neutral" | "warm" | "allied" } {
  if (value <= -60) return { label: "Hostile", tone: "hostile" };
  if (value <= -20) return { label: "Unfriendly", tone: "cold" };
  if (value < 20) return { label: "Neutral", tone: "neutral" };
  if (value < 60) return { label: "Friendly", tone: "warm" };
  return { label: "Allied", tone: "allied" };
}

/** Faction names and one-line blurbs for the character sheet (unknown ids get a generic line). */
export const FACTIONS: Readonly<Record<string, { name: string; blurb: string }>> = {
  razorbacks: { name: "Razorbacks", blurb: "Street gang out of the flooded underpasses. Loud, loyal, and quick with a pipe." },
  "chrome-saints": { name: "Chrome Saints", blurb: "A chromed-up cult that trades flesh for halos and believes the grid is listening." },
  corpsec: { name: "CorpSec", blurb: "Private security for the towers. They keep the peace they are paid to keep." },
  ghosts: { name: "Ghosts", blurb: "Netrunners nobody has seen twice. They sell secrets and buy silence." },
  civilian: { name: "Civilians", blurb: "Vendors, commuters and night-shift workers. The city remembers who helped." },
};
/** The factions the sheet always lists, in order, even at 0; any other rated faction follows. */
export const FACTION_ORDER: readonly string[] = ["razorbacks", "chrome-saints", "corpsec", "ghosts", "civilian"];
export function factionInfo(id: string): { name: string; blurb: string } {
  return FACTIONS[id] ?? { name: id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "), blurb: "Little is known about where you stand with them." };
}
/** Factions to show: the known ones, then any other the character has a rating with ("player" never). */
export function factionRows(reputation: Readonly<Record<string, number>>): { id: string; value: number }[] {
  const ids = [...FACTION_ORDER, ...Object.keys(reputation).filter((id) => !FACTION_ORDER.includes(id) && id !== "player").sort()];
  return ids.map((id) => ({ id, value: reputation[id] ?? 0 }));
}

/** Item art rows made safe to print: anything outside printable ASCII becomes a space, at most
 * 24 x 8 like the content rule, trailing whitespace trimmed. */
export function printableArt(art: readonly string[] | undefined): string[] {
  if (!art?.length) return [];
  return art.slice(0, 8).map((row) => row.replace(/[^\x20-\x7e]/g, " ").slice(0, 24).replace(/\s+$/, ""));
}

// ---- Stat tables & comparison -----------------------------------------------------------------------

export interface StatRow {
  key: string;
  label: string;
  /** Numeric value used for comparisons (NaN for text-only rows). */
  value: number;
  text: string;
  /** Which direction is an improvement; omitted for rows that are not compared. */
  better?: "higher" | "lower";
}

const EFFECT_LABEL: Record<string, string> = { regen: "Regeneration", focus: "Focus (weak points)", haste: "Haste", shield: "Kinetic shield" };

/** The stat table for an item's inspect panel. Rates are attacks (or rounds) per second from the
 * cooldown / automatic fire; DPS counts pellets but not crits, reloads or the heavy attack. */
export function itemStats(def: ItemDefinition): StatRow[] {
  const rows: StatRow[] = [];
  const w = def.weapon;
  if (w) {
    const pellets = Math.max(1, w.pellets ?? 1);
    const rate = w.automatic && w.automatic > 0 ? w.automatic : w.cooldown > 0 ? 1 / w.cooldown : 0;
    rows.push({ key: "damage", label: "Damage", value: w.damage * pellets, text: pellets > 1 ? `${formatNumber(w.damage)} x${pellets}` : formatNumber(w.damage), better: "higher" });
    rows.push({ key: "dps", label: "Damage / s", value: w.damage * pellets * rate, text: formatNumber(w.damage * pellets * rate, 0), better: "higher" });
    rows.push({ key: "rate", label: w.automatic ? "Fire rate" : "Attack rate", value: rate, text: `${formatNumber(rate, 2)} /s${w.automatic ? " auto" : ""}`, better: "higher" });
    rows.push({ key: "range", label: w.class === "blade" || w.class === "blunt" || w.class === "baton" ? "Reach" : "Range", value: w.range, text: `${formatNumber(w.range)} m`, better: "higher" });
    if (w.staminaCost > 0) rows.push({ key: "stamina", label: "Stamina / hit", value: w.staminaCost, text: formatNumber(w.staminaCost), better: "lower" });
    if (w.heavyMultiplier) rows.push({ key: "heavy", label: "Heavy attack", value: w.heavyMultiplier, text: `x${formatNumber(w.heavyMultiplier)}`, better: "higher" });
    if (w.magazine) rows.push({ key: "magazine", label: "Magazine", value: w.magazine, text: `${w.magazine}`, better: "higher" });
    if (w.reload) rows.push({ key: "reload", label: "Reload", value: w.reload, text: `${formatNumber(w.reload)} s`, better: "lower" });
    if (w.critChance) rows.push({ key: "crit", label: "Critical", value: w.critChance, text: `${Math.round(w.critChance * 100)}% x${formatNumber(w.critMultiplier ?? 1)}`, better: "higher" });
    if (w.stagger) rows.push({ key: "stagger", label: "Stagger", value: w.stagger, text: `${formatNumber(w.stagger, 2)} s`, better: "higher" });
  }
  if (def.armor) rows.push({ key: "protection", label: "Protection", value: def.armor.protection, text: `${Math.round(def.armor.protection * 100)}%`, better: "higher" });
  const c = def.consumable;
  if (c) {
    if (c.heal) rows.push({ key: "heal", label: c.effect === "regen" ? "Heals over time" : "Heals", value: c.heal, text: `+${c.heal}${c.effect === "regen" && c.duration ? ` / ${formatNumber(c.duration)} s` : ""}`, better: "higher" });
    if (c.stamina) rows.push({ key: "staminaGain", label: "Stamina", value: c.stamina, text: `+${c.stamina}`, better: "higher" });
    if (c.effect && c.effect !== "regen") rows.push({ key: "effect", label: EFFECT_LABEL[c.effect] ?? c.effect, value: c.duration ?? Number.NaN, text: c.duration ? `${formatNumber(c.duration)} s` : "yes", better: c.duration ? "higher" : undefined });
  }
  rows.push({ key: "weight", label: "Weight", value: def.weight, text: `${formatNumber(def.weight, 2)} kg`, better: "lower" });
  return rows;
}

export interface ComparedRow extends StatRow {
  /** Difference to the equipped item's row with the same key; undefined when not comparable. */
  delta?: number;
  deltaText?: string;
  tone?: "better" | "worse" | "same";
}

/** Rows of `item` annotated against `baseline` (the item currently in the same slot). */
export function compareStats(item: readonly StatRow[], baseline: readonly StatRow[] | null): ComparedRow[] {
  if (!baseline) return item.map((row) => ({ ...row }));
  const base = new Map(baseline.map((row) => [row.key, row]));
  return item.map((row) => {
    const other = base.get(row.key);
    if (!row.better || !other || !Number.isFinite(row.value) || !Number.isFinite(other.value)) return { ...row };
    const delta = row.value - other.value;
    const scale = Math.max(Math.abs(row.value), Math.abs(other.value), 1e-9);
    if (Math.abs(delta) / scale < 0.005) return { ...row, delta: 0, deltaText: "=", tone: "same" };
    const good = row.better === "higher" ? delta > 0 : delta < 0;
    return { ...row, delta, deltaText: formatDelta(row.key, delta), tone: good ? "better" : "worse" };
  });
}

/** "+12", "-0.4 m", "+8%": the delta in the row's own unit. */
export function formatDelta(key: string, delta: number): string {
  const sign = delta > 0 ? "+" : "-";
  const a = Math.abs(delta);
  switch (key) {
    case "protection": return `${sign}${Math.round(a * 100)}%`;
    case "range": return `${sign}${formatNumber(a)} m`;
    case "reload": case "effect": return `${sign}${formatNumber(a)} s`;
    case "stagger": return `${sign}${formatNumber(a, 2)} s`;
    case "crit": return `${sign}${Math.round(a * 100)}%`;
    case "rate": return `${sign}${formatNumber(a, 2)} /s`;
    case "heavy": return `${sign}${formatNumber(a, 2)}`;
    case "weight": return `${sign}${formatNumber(a, 2)} kg`;
    default: return `${sign}${formatNumber(a, a < 10 ? 1 : 0)}`;
  }
}

/** The item a candidate would replace: whatever sits in its natural slot now (null if that is the
 * candidate itself, the slot is empty, or the item does not equip). */
export function comparisonTarget(def: ItemDefinition, equipped: Partial<Record<EquipSlot, string>>, items: Readonly<Record<string, ItemDefinition>>): ItemDefinition | null {
  if (!def.weapon && !def.armor) return null;
  const slot = slotFor(def);
  if (!slot) return null;
  const current = equipped[slot];
  if (!current || current === def.id) return null;
  return items[current] ?? null;
}

// ---- Feed, prompt, trading ------------------------------------------------------------------------------

/** New feed entries (ids not seen before), in order, and the updated seen-set. The set is pruned to
 * ids still in the feed so it never grows without bound; the feed only ever drops its oldest entries. */
export function freshFeed(feed: readonly FeedEntry[] | undefined, seen: ReadonlySet<number>): { fresh: FeedEntry[]; seen: Set<number> } {
  const next = new Set<number>();
  const fresh: FeedEntry[] = [];
  for (const entry of feed ?? []) {
    if (next.has(entry.id)) continue; // duplicate id inside one feed: show once
    next.add(entry.id);
    if (!seen.has(entry.id)) fresh.push(entry);
  }
  return { fresh, seen: next };
}

/** The longest item name mentioned in a message ("Picked up Hash Hammer" -> Hash Hammer), for
 * rarity-colouring loot toasts. Names shorter than 3 characters are ignored (too many false hits). */
export function findItemMention(text: string, items: Readonly<Record<string, ItemDefinition>>): { name: string; rarity: Rarity; index: number } | null {
  let best: { name: string; rarity: Rarity; index: number } | null = null;
  const lower = text.toLowerCase();
  for (const def of Object.values(items)) {
    if (def.name.length < 3 || (best && def.name.length <= best.name.length)) continue;
    const index = lower.indexOf(def.name.toLowerCase());
    if (index >= 0) best = { name: text.slice(index, index + def.name.length), rarity: def.rarity, index };
  }
  return best;
}

const RARITY_NAMES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
/** Splits "E  Pick up Backslash [rare]" into the key, the text and the trailing rarity tag. */
export function parsePrompt(prompt: string): { key: string; text: string; rarity: Rarity | null } {
  let text = prompt.trim();
  let key = "E";
  const keyMatch = /^\[?([A-Z])\]?\s{1,}(?=\S)/.exec(text);
  if (keyMatch && text.length > keyMatch[0].length) { key = keyMatch[1]; text = text.slice(keyMatch[0].length); }
  let rarity: Rarity | null = null;
  const tag = /\s*\[([a-z]+)\]\s*$/i.exec(text);
  if (tag && (RARITY_NAMES as readonly string[]).includes(tag[1].toLowerCase())) { rarity = tag[1].toLowerCase() as Rarity; text = text.slice(0, tag.index); }
  return { key, text, rarity };
}

/** What a vendor pays for `count` of an item at `sellRate` (quest items and worthless junk: 0). */
export function sellPrice(def: ItemDefinition | undefined, count: number, sellRate: number): number {
  if (!def || def.kind === "quest" || def.value <= 0 || def.tags?.includes("credits")) return 0;
  return Math.floor(def.value * sellRate * Math.max(0, count));
}

/** Why a purchase cannot go through right now (null: it can). */
export function buyBlocker(def: ItemDefinition | undefined, price: number, character: RpgCharacterView, count = 1): string | null {
  if (price > character.credits) return "Not enough credits";
  if (def && def.weight > 0 && character.carry.weight + def.weight * count > character.carry.capacity + 1e-6) return "Too heavy to carry";
  return null;
}

/** Feedback line after a trade: compares the sheet before and after the action. */
export function tradeOutcome(
  action: { kind: "buy" | "sell"; item: string; name: string },
  before: { credits: number; count: number },
  after: { credits: number; count: number },
): { ok: boolean; text: string } | null {
  const credits = after.credits - before.credits;
  const count = after.count - before.count;
  if (action.kind === "buy" && count > 0) return { ok: true, text: `Bought ${action.name}${count > 1 ? ` x${count}` : ""}  -${formatCr(-credits)} CR` };
  if (action.kind === "sell" && count < 0) return { ok: true, text: `Sold ${action.name}${-count > 1 ? ` x${-count}` : ""}  +${formatCr(credits)} CR` };
  return null;
}
