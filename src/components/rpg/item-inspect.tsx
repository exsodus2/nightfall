"use client";

import type { CSSProperties, ReactNode } from "react";
import type { EquipSlot, ItemDefinition } from "@/rpg/types";
import { EQUIP_SLOTS, compareStats, formatCr, formatNumber, itemStats, kindLabel, printableArt, rarityColor, type RpgCharacterView } from "./format";
import styles from "./rpg.module.css";

/** An item's glyph in its rarity colour (the same character it has on the ground and the HUD). */
export function ItemGlyph({ def, size }: { def: ItemDefinition | undefined; size?: "large" }) {
  return <span className={styles.glyph} data-size={size} style={{ "--rarity": def ? rarityColor(def.rarity) : "#6f9a94" } as CSSProperties} aria-hidden="true">{def?.glyph ?? "?"}</span>;
}

/** Item name in its rarity colour. */
export function ItemName({ def, fallback }: { def: ItemDefinition | undefined; fallback: string }) {
  return <span className={styles.name} style={{ color: def ? rarityColor(def.rarity) : undefined }}>{def?.name ?? fallback}</span>;
}

interface ItemInspectProps {
  def: ItemDefinition;
  count: number;
  character: RpgCharacterView;
  items: Readonly<Record<string, ItemDefinition>>;
  /** Slot the item is equipped in, if any. */
  slot: EquipSlot | null;
  /** What it would replace (comparison column), or null. */
  compare: ItemDefinition | null;
  /** Price line override (vendor: buy / sell price). */
  price?: ReactNode;
  children?: ReactNode;
  headingId?: string;
}

/** Inspect panel: ASCII art, name and rarity, stat table with deltas vs the equipped item,
 * description, value and weight, then the caller's actions. */
export function ItemInspect({ def, count, character, items, slot, compare, price, children, headingId }: ItemInspectProps) {
  const art = printableArt(def.art);
  const rows = compareStats(itemStats(def), compare ? itemStats(compare) : null);
  const color = rarityColor(def.rarity);
  const ammo = def.weapon?.ammo ? items[def.weapon.ammo] : undefined;
  const reserve = def.weapon?.ammo ? character.inventory.filter((stack) => stack.item === def.weapon?.ammo).reduce((sum, stack) => sum + stack.count, 0) : 0;
  const slotInfo = slot ? EQUIP_SLOTS.find((entry) => entry.slot === slot) : null;
  return <div className={styles.inspect} style={{ "--rarity": color } as CSSProperties}>
    <div className={styles.artBox}>
      {art.length ? <pre className={styles.art} aria-hidden="true">{art.join("\n")}</pre> : <span className={styles.artGlyph} aria-hidden="true">{def.glyph}</span>}
      <span className={styles.artCorner} data-corner="tl" /><span className={styles.artCorner} data-corner="br" />
    </div>
    <h3 className={styles.inspectName} id={headingId} style={{ color }}>{def.name}</h3>
    <p className={styles.inspectMeta}>
      <span style={{ color }}>{def.rarity}</span><span>{kindLabel(def)}</span>
      {count > 1 ? <span>x{count}</span> : null}
      {slotInfo ? <span className={styles.equippedTag}>Equipped {slotInfo.key ? `[${slotInfo.key}]` : slotInfo.label}</span> : null}
    </p>
    <table className={styles.stats}>
      {compare ? <caption>vs equipped <span style={{ color: rarityColor(compare.rarity) }}>{compare.name}</span></caption> : null}
      <tbody>
        {rows.map((row) => <tr key={row.key}>
          <th scope="row">{row.label}</th>
          <td>{row.text}</td>
          {compare ? <td className={styles.delta} data-tone={row.tone ?? "none"}>{row.deltaText ?? ""}</td> : null}
        </tr>)}
        {def.weapon?.ammo ? <tr><th scope="row">Ammo</th><td colSpan={compare ? 2 : 1}>{ammo?.name ?? def.weapon.ammo} <small>{character.loaded[def.id] ?? 0}/{def.weapon.magazine ?? 0} loaded, {reserve} spare</small></td></tr> : null}
      </tbody>
    </table>
    <p className={styles.description}>{def.description}</p>
    <p className={styles.value}>{price ?? <><span>Value <b>{formatCr(def.value)}</b> CR</span><span>{formatNumber(def.weight, 2)} kg</span></>}</p>
    {children}
  </div>;
}
