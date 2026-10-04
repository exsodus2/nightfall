"use client";

import type { CSSProperties } from "react";
import type { EquipSlot, ItemDefinition } from "@/rpg/types";
import { EQUIP_SLOTS, formatNumber, rarityColor } from "./format";
import { ItemGlyph } from "./item-inspect";
import styles from "./rpg.module.css";

// The figure: H head, B body, M melee hand, S sidearm hand, P primary slung on the back. Each
// placeholder becomes the equipped item's glyph in its rarity colour, or a dim dot when empty.
const FIGURE = [
  "      .---.  P  ",
  "      | H | /   ",
  "      '-+-'/    ",
  "   .---[B]---.  ",
  " M-|   |||   |-S",
  "   '   |||   '  ",
  "      /   \\     ",
  "    _/     \\_   ",
];
const MARKS: Record<string, EquipSlot> = { H: "head", B: "body", M: "melee", S: "sidearm", P: "primary" };

function Figure({ equipped, items }: { equipped: Partial<Record<EquipSlot, string>>; items: Readonly<Record<string, ItemDefinition>> }) {
  return <pre className={styles.figure} aria-hidden="true">{FIGURE.map((line, row) => <span key={row}>{[...line].map((char, col) => {
    const slot = MARKS[char];
    if (!slot) return char;
    const def = equipped[slot] ? items[equipped[slot]] : undefined;
    return <b key={col} style={def ? { color: rarityColor(def.rarity), textShadow: `0 0 8px ${rarityColor(def.rarity)}` } : undefined} data-empty={!def}>{def ? def.glyph : "."}</b>;
  })}{"\n"}</span>)}</pre>;
}

interface PaperDollProps {
  equipped: Partial<Record<EquipSlot, string>>;
  items: Readonly<Record<string, ItemDefinition>>;
  counts: ReadonlyMap<string, number>;
  loaded: Readonly<Record<string, number>>;
  protection: number;
  selected: string | null;
  onSelect: (slot: EquipSlot, item: string | null) => void;
}

/** Equipment: the ASCII figure (decoration) and one button per slot. A filled slot selects its
 * item for inspection; an empty one filters the pack to what fits it. */
export function PaperDoll({ equipped, items, counts, loaded, protection, selected, onSelect }: PaperDollProps) {
  return <aside className={styles.doll} aria-label="Equipment">
    <h3 className={styles.sectionTitle}>Equipped <small>{Math.round(protection * 100)}% protection</small></h3>
    <Figure equipped={equipped} items={items} />
    <ul className={styles.slots}>
      {EQUIP_SLOTS.map(({ slot, label, key, hint }) => {
        const id = equipped[slot];
        const def = id ? items[id] : undefined;
        const count = id ? counts.get(id) ?? 0 : 0;
        const detail = !def ? hint
          : def.weapon?.magazine ? `${loaded[def.id] ?? 0}/${def.weapon.magazine} loaded`
          : def.armor ? `${Math.round(def.armor.protection * 100)}% prot`
          : def.consumable ? `x${count}${count === 0 ? " (empty)" : ""}`
          : `${formatNumber(def.weight)} kg`;
        return <li key={slot}>
          <button type="button" className={styles.slot} data-empty={!def} aria-pressed={!!id && selected === id}
            style={def ? { "--rarity": rarityColor(def.rarity) } as CSSProperties : undefined}
            onClick={() => onSelect(slot, id ?? null)} aria-label={`${label}${key ? ` ${key}` : ""}: ${def?.name ?? "empty"}`}>
            <span className={styles.slotKey}>{key || (slot === "head" ? "HD" : "BD")}</span>
            {def ? <ItemGlyph def={def} /> : <span className={styles.glyph} data-empty="true" aria-hidden="true">.</span>}
            <span className={styles.slotText}><small>{label}</small><strong>{def?.name ?? "Empty"}</strong><em>{detail}</em></span>
          </button>
        </li>;
      })}
    </ul>
  </aside>;
}
