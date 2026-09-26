import type { CharacterState, EquipSlot, FlagValue, ItemStack } from "../types.ts";

/** Default localStorage key for the single save slot. */
export const SAVE_KEY = "nightfall.save.v1";

/** Everything needed to resume a game. Subsystems own the opaque parts (quests, encounters). */
export interface SaveGame {
  version: 1;
  savedAt: number;
  character: CharacterState;
  quests: unknown;
  flags: Record<string, FlagValue>;
  discovered: string[];
  encounters: unknown;
  position: { x: number; z: number; yaw: number } | null;
}

// Validation is strict on shape (a wrong type anywhere rejects the save: better a clean new game
// than a half-restored one that crashes mid-fight) but tolerant of extra keys from newer builds.

type Json = Record<string, unknown>;
const EQUIP_SLOTS: ReadonlySet<string> = new Set<EquipSlot>(["melee", "sidearm", "primary", "body", "head", "quick1", "quick2"]);
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isFlag = (v: unknown): v is FlagValue => typeof v === "boolean" || typeof v === "string" || isNum(v);

function numberRecord(v: unknown): Record<string, number> | null {
  if (!isObject(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) { if (!isNum(n)) return null; out[k] = n; }
  return out;
}

function parseCharacter(v: unknown): CharacterState | null {
  if (!isObject(v)) return null;
  const { credits, xp, level, inventory, equipped, loaded, reputation } = v;
  if (!isNum(credits) || credits < 0 || !isNum(xp) || xp < 0) return null;
  if (!isNum(level) || !Number.isInteger(level) || level < 1 || level > 30) return null;
  if (!Array.isArray(inventory)) return null;
  const stacks: ItemStack[] = [];
  for (const s of inventory) {
    if (!isObject(s) || typeof s.item !== "string" || !s.item || !isNum(s.count) || !Number.isInteger(s.count) || s.count < 1) return null;
    stacks.push({ item: s.item, count: s.count });
  }
  if (!isObject(equipped)) return null;
  const slots: Partial<Record<EquipSlot, string>> = {};
  for (const [slot, id] of Object.entries(equipped)) {
    if (!EQUIP_SLOTS.has(slot) || typeof id !== "string") return null;
    slots[slot as EquipSlot] = id;
  }
  const rounds = numberRecord(loaded), rep = numberRecord(reputation);
  if (!rounds || !rep || Object.values(rounds).some(n => n < 0)) return null;
  return { credits, xp, level, inventory: stacks, equipped: slots, loaded: rounds, reputation: rep };
}

/** Validates an already-parsed value as a SaveGame (a clean copy), or null. */
export function parseSave(value: unknown): SaveGame | null {
  if (!isObject(value) || value.version !== 1 || !isNum(value.savedAt)) return null;
  const character = parseCharacter(value.character);
  if (!character) return null;
  if (!isObject(value.flags)) return null;
  const flags: Record<string, FlagValue> = {};
  for (const [k, f] of Object.entries(value.flags)) { if (!isFlag(f)) return null; flags[k] = f; }
  if (!Array.isArray(value.discovered) || !value.discovered.every((d): d is string => typeof d === "string")) return null;
  let position: SaveGame["position"] = null;
  if (value.position !== null && value.position !== undefined) {
    const p = value.position;
    if (!isObject(p) || !isNum(p.x) || !isNum(p.z) || !isNum(p.yaw)) return null;
    position = { x: p.x, z: p.z, yaw: p.yaw };
  }
  return {
    version: 1, savedAt: value.savedAt, character, flags, discovered: [...value.discovered], position,
    // Opaque to this module; their owners validate them when restoring.
    quests: value.quests ?? null, encounters: value.encounters ?? null,
  };
}

/** Reads and validates the save; null when missing, corrupt, from another version, or storage throws. */
export function loadSave(storage: Pick<Storage, "getItem">, key = SAVE_KEY): SaveGame | null {
  try {
    const raw = storage.getItem(key);
    return raw ? parseSave(JSON.parse(raw)) : null;
  } catch { return null; }
}

/** Writes the save; false if storage is unavailable or full (never throws). */
export function writeSave(storage: Pick<Storage, "setItem">, save: SaveGame, key = SAVE_KEY): boolean {
  try { storage.setItem(key, JSON.stringify(save)); return true; } catch { return false; }
}

/** Deletes the save; false if storage throws. */
export function clearSave(storage: Pick<Storage, "removeItem">, key = SAVE_KEY): boolean {
  try { storage.removeItem(key); return true; } catch { return false; }
}
