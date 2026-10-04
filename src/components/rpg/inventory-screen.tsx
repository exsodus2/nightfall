"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { EquipSlot, ItemDefinition, RpgSnapshot, RpgUiAction } from "@/rpg/types";
import { CharacterSheet } from "./character-sheet";
import {
  INVENTORY_FILTERS, bar, comparisonTarget, equippedSlots, filterOf, formatCr, formatNumber, kindLabel, rarityColor, slotBadge, sortStacks,
  type InventoryFilter,
} from "./format";
import { ItemGlyph, ItemInspect } from "./item-inspect";
import { PaperDoll } from "./paper-doll";
import { useModal } from "./use-modal";
import styles from "./rpg.module.css";

type Tab = "inventory" | "character";
const SLOT_FILTER: Record<EquipSlot, InventoryFilter> = { melee: "weapons", sidearm: "weapons", primary: "weapons", head: "gear", body: "gear", quick1: "consumables", quick2: "consumables" };

interface InventoryScreenProps {
  rpg: RpgSnapshot;
  act: (action: RpgUiAction) => void;
  onClose: () => void;
  onResume: () => void;
}

/** The inventory & character screen (I / Tab): paper doll, pack, item inspect; character tab. */
export function InventoryScreen({ rpg, act, onClose, onResume }: InventoryScreenProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<Tab>("inventory");
  useModal(dialogRef, onClose);
  // C switches tabs wherever focus is inside the screen (or nowhere, after a button unmounted).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyC" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      setTab((current) => current === "inventory" ? "character" : "inventory");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const { character } = rpg;
  const onTabKey = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setTab((current) => current === "inventory" ? "character" : "inventory"); }
  };
  return <div className={styles.overlay} data-rpg-screen="inventory" onClick={onClose}>
    <section className={styles.frame} role="dialog" aria-modal="true" aria-labelledby="rpg-inventory-title" tabIndex={-1} ref={dialogRef} onClick={(event) => event.stopPropagation()}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Personal effects</span>
          <h2 className={styles.title} id="rpg-inventory-title">{tab === "inventory" ? "Inventory" : "Character"}<span>{"//"}</span>Level {character.level}</h2>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="Screen" onKeyDown={onTabKey}>
          {(["inventory", "character"] as const).map((id) => <button key={id} type="button" role="tab" id={`rpg-tab-${id}`} aria-selected={tab === id} aria-controls={`rpg-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>
            {id === "inventory" ? "Inventory" : "Character"}<kbd aria-hidden="true">{id === "inventory" ? "I" : "C"}</kbd>
          </button>)}
        </div>
        <p className={styles.purse}><small>Credits</small>{formatCr(character.credits)}<span>CR</span></p>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close inventory">Close <span aria-hidden="true">×</span></button>
      </header>
      <div className={styles.tabPanel} role="tabpanel" id={`rpg-panel-${tab}`} aria-labelledby={`rpg-tab-${tab}`}>
        {tab === "inventory" ? <InventoryBody rpg={rpg} act={act} /> : <CharacterSheet rpg={rpg} />}
      </div>
      <footer className={styles.footer}>
        <span className={styles.keys} aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> select</span><span><kbd>Enter</kbd> equip / use</span><span><kbd>Q</kbd><kbd>Z</kbd> quick slot</span><span><kbd>Del</kbd> drop</span><span><kbd>C</kbd> character</span><span><kbd>I</kbd> / <kbd>Esc</kbd> close</span>
        </span>
        <button type="button" className={styles.resume} onClick={onResume}>Back to the streets <span aria-hidden="true">↗</span></button>
      </footer>
    </section>
  </div>;
}

interface Row { item: string; count: number; def: ItemDefinition | undefined; slot: EquipSlot | null }

function InventoryBody({ rpg, act }: { rpg: RpgSnapshot; act: (action: RpgUiAction) => void }) {
  const { character, items } = rpg;
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false); // phones: the inspect pane slides over the list
  const [drop, setDrop] = useState<{ item: string; count: number; confirm: boolean } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const slots = useMemo(() => equippedSlots(character.equipped), [character.equipped]);
  const all: Row[] = useMemo(() => sortStacks(character.inventory, items).map((stack) => ({ ...stack, def: items[stack.item], slot: slots.get(stack.item) ?? null })), [character.inventory, items, slots]);
  const counts = useMemo(() => new Map(all.map((row) => [row.item, row.count])), [all]);
  const rows = filter === "all" ? all : all.filter((row) => row.def && filterOf(row.def) === filter);
  const current = rows.find((row) => row.item === selectedId) ?? all.find((row) => row.item === selectedId) ?? rows[0] ?? null;
  const load = character.carry.capacity > 0 ? character.carry.weight / character.carry.capacity : 0;

  const select = (item: string, focus = false) => {
    setSelectedId(item);
    setDrop(null);
    if (focus) listRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(item)}"]`)?.focus();
  };
  const primary = (row: Row | null) => {
    if (!row?.def) return;
    if (row.def.kind === "consumable" && row.def.consumable) act({ kind: "use", item: row.item });
    else if (row.slot && row.slot !== "quick1" && row.slot !== "quick2") act({ kind: "unequip", slot: row.slot });
    else if (row.def.weapon || row.def.armor) act({ kind: "equip", item: row.item });
  };
  const quick = (row: Row | null, slot: 1 | 2) => { if (row?.def?.kind === "consumable" && row.def.consumable) act({ kind: "assignQuick", item: row.item, slot }); };
  const startDrop = (row: Row | null) => { if (row?.def && row.def.kind !== "quest") setDrop({ item: row.item, count: 1, confirm: true }); };

  const onListKey = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (!rows.length) return;
    const index = Math.max(0, rows.findIndex((row) => row.item === current?.item));
    const move = (to: number) => { event.preventDefault(); select(rows[Math.max(0, Math.min(rows.length - 1, to))].item, true); };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(rows.length - 1);
    else if (event.key === "Enter") { event.preventDefault(); if (!event.repeat) primary(current); }
    else if (event.code === "KeyQ") { event.preventDefault(); quick(current, 1); }
    else if (event.code === "KeyZ") { event.preventDefault(); quick(current, 2); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); startDrop(current); }
  };

  return <div className={styles.body} data-sheet={sheet && !!current}>
    <PaperDoll equipped={character.equipped} items={items} counts={counts} loaded={character.loaded} protection={character.protection} selected={current?.item ?? null}
      onSelect={(slot, item) => { if (item && counts.has(item)) { setFilter("all"); select(item); setSheet(true); } else setFilter(SLOT_FILTER[slot]); }} />

    <div className={styles.pack}>
      <div className={styles.packHead}>
        <div className={styles.weight} data-load={load > 1 ? "over" : load > 0.85 ? "heavy" : "ok"}>
          <span>Carry</span>
          <span className={styles.asciiBar} aria-hidden="true">[{bar(load, 24)}]</span>
          <strong>{formatNumber(character.carry.weight)} / {formatNumber(character.carry.capacity)} kg</strong>
        </div>
        <div className={styles.filters} role="group" aria-label="Filter items">
          {INVENTORY_FILTERS.map(({ id, label }) => {
            const n = id === "all" ? all.length : all.filter((row) => row.def && filterOf(row.def) === id).length;
            return <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} disabled={n === 0 && id !== "all"}>{label}<small>{n}</small></button>;
          })}
        </div>
      </div>
      {rows.length === 0 ? <p className={styles.empty}>Nothing here. Enemies drop loot where they fall; press <kbd>E</kbd> over it to pick it up.</p> : null}
      <ul className={styles.list} role="listbox" aria-label="Carried items" ref={listRef} onKeyDown={onListKey}>
        {rows.map((row) => {
          const selected = current?.item === row.item;
          return <li key={row.item} role="presentation">
            <button type="button" role="option" aria-selected={selected} tabIndex={selected ? 0 : -1} data-item={row.item} className={styles.row}
              style={{ "--rarity": row.def ? rarityColor(row.def.rarity) : "#6f9a94" } as CSSProperties}
              onClick={() => { select(row.item); setSheet(true); }} onDoubleClick={() => primary(row)}>
              <ItemGlyph def={row.def} />
              <span className={styles.rowLabel}><span className={styles.name} style={{ color: row.def ? rarityColor(row.def.rarity) : undefined }}>{row.def?.name ?? row.item}</span><small>{row.def ? kindLabel(row.def) : "Unknown item"}</small></span>
              {row.slot ? <span className={styles.badge} title="Equipped">{slotBadge(row.slot)}</span> : null}
              <span className={styles.rowMeta}>{row.count > 1 ? <b>x{row.count}</b> : null}<small>{row.def ? `${formatNumber(row.def.weight * row.count)} kg` : ""}</small></span>
            </button>
          </li>;
        })}
      </ul>
    </div>

    <aside className={styles.inspectPane} aria-label="Item details">
      {current?.def ? <>
        <button type="button" className={styles.sheetBack} onClick={() => setSheet(false)}>‹ Back to the pack</button>
        <ItemInspect def={current.def} count={current.count} character={character} items={items} slot={current.slot} compare={comparisonTarget(current.def, character.equipped, items)} headingId="rpg-inspect-name">
          <ItemActions row={current} drop={drop?.item === current.item ? drop : null} setDrop={setDrop} act={act} primary={primary} quick={quick} equipped={character.equipped} />
        </ItemInspect>
      </> : <p className={styles.empty}>Select an item to inspect it.</p>}
    </aside>
  </div>;
}

interface ItemActionsProps {
  row: Row;
  drop: { item: string; count: number; confirm: boolean } | null;
  setDrop: (drop: { item: string; count: number; confirm: boolean } | null) => void;
  act: (action: RpgUiAction) => void;
  primary: (row: Row) => void;
  quick: (row: Row, slot: 1 | 2) => void;
  equipped: Partial<Record<EquipSlot, string>>;
}

function ItemActions({ row, drop, setDrop, act, primary, quick, equipped }: ItemActionsProps) {
  const def = row.def;
  if (!def) return null;
  const consumable = def.kind === "consumable" && !!def.consumable;
  const gear = !!(def.weapon || def.armor);
  const worn = !!row.slot && row.slot !== "quick1" && row.slot !== "quick2";
  const n = drop ? Math.min(row.count, Math.max(1, drop.count)) : 1;
  return <div className={styles.actions}>
    <div className={styles.actionRow}>
      {gear ? <button type="button" className={styles.action} data-primary="true" onClick={() => primary(row)}>{worn ? "Unequip" : "Equip"}</button> : null}
      {consumable ? <button type="button" className={styles.action} data-primary="true" onClick={() => primary(row)}>Use</button> : null}
      {consumable ? <>
        <button type="button" className={styles.action} aria-pressed={equipped.quick1 === row.item} onClick={() => equipped.quick1 === row.item ? act({ kind: "unequip", slot: "quick1" }) : quick(row, 1)}>{equipped.quick1 === row.item ? "Clear Q" : "Assign to Q"}</button>
        <button type="button" className={styles.action} aria-pressed={equipped.quick2 === row.item} onClick={() => equipped.quick2 === row.item ? act({ kind: "unequip", slot: "quick2" }) : quick(row, 2)}>{equipped.quick2 === row.item ? "Clear Z" : "Assign to Z"}</button>
      </> : null}
      {def.kind !== "quest" && !drop ? <button type="button" className={styles.action} data-danger="true" onClick={() => setDrop({ item: row.item, count: 1, confirm: true })}>Drop</button> : null}
    </div>
    {def.kind === "quest" ? <p className={styles.note}>Quest item: it stays with you until the job is done.</p> : null}
    {drop ? <div className={styles.dropRow} role="group" aria-label="Drop">
      {row.count > 1 ? <span className={styles.stepper}>
        <button type="button" aria-label="One fewer" onClick={() => setDrop({ ...drop, count: Math.max(1, n - 1) })} disabled={n <= 1}>-</button>
        <output aria-live="polite">{n}</output>
        <button type="button" aria-label="One more" onClick={() => setDrop({ ...drop, count: Math.min(row.count, n + 1) })} disabled={n >= row.count}>+</button>
        <button type="button" onClick={() => setDrop({ ...drop, count: row.count })} disabled={n >= row.count}>All</button>
      </span> : null}
      <button type="button" className={styles.action} data-danger="true" autoFocus onClick={() => { act({ kind: "drop", item: row.item, count: n }); setDrop(null); }}>Drop {n > 1 ? `${n} ` : ""}{worn ? "(equipped)" : ""}</button>
      <button type="button" className={styles.action} onClick={() => setDrop(null)}>Keep</button>
    </div> : null}
  </div>;
}
