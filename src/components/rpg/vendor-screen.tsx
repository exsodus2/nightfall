"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ItemDefinition, RpgSnapshot, RpgUiAction } from "@/rpg/types";
import { buyBlocker, comparisonTarget, equippedSlots, formatCr, formatNumber, kindLabel, rarityColor, sellPrice, slotBadge, sortStacks, tradeOutcome } from "./format";
import { ItemGlyph, ItemInspect } from "./item-inspect";
import { useModal } from "./use-modal";
import styles from "./rpg.module.css";

type Pick = { side: "buy" | "sell"; item: string };
type Pending = { kind: "buy" | "sell"; item: string; name: string; credits: number; count: number };
const countOf = (rpg: RpgSnapshot, item: string) => rpg.character.inventory.filter((stack) => stack.item === item).reduce((sum, stack) => sum + stack.count, 0);

interface VendorScreenProps {
  rpg: RpgSnapshot;
  vendor: NonNullable<RpgSnapshot["vendor"]>;
  act: (action: RpgUiAction) => void;
  onClose: () => void;
}

/** Trade screen while snapshot.rpg.vendor is set: stock to buy, your pack to sell, inspect with
 * comparison, and a confirmation line read back from the next snapshot. */
export function VendorScreen({ rpg, vendor, act, onClose }: VendorScreenProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useModal(dialogRef, onClose);
  const { character, items } = rpg;
  const [side, setSide] = useState<"buy" | "sell">("buy"); // phones: one list at a time
  const [pick, setPick] = useState<Pick | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const slots = useMemo(() => equippedSlots(character.equipped), [character.equipped]);
  const pack = useMemo(() => sortStacks(character.inventory, items).filter((stack) => items[stack.item]?.kind !== "quest"), [character.inventory, items]);

  // Confirmation: the action lands in a later snapshot; compare credits and counts with the moment
  // it was sent. Nothing changed after a short wait = refused (the vendor or the pack said no).
  const [prevRpg, setPrevRpg] = useState(rpg);
  if (prevRpg !== rpg) {
    setPrevRpg(rpg);
    if (pending) {
      const outcome = tradeOutcome(pending, { credits: pending.credits, count: pending.count }, { credits: character.credits, count: countOf(rpg, pending.item) });
      if (outcome) { setFeedback(outcome); setPending(null); }
    }
  }
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => { setPending(null); setFeedback({ ok: false, text: `${pending.kind === "buy" ? "Couldn't buy" : "Couldn't sell"} ${pending.name}.` }); }, 900);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3200);
    return () => clearTimeout(timer);
  }, [feedback]);

  const send = (kind: "buy" | "sell", item: string, count: number) => {
    const def = items[item];
    setPending({ kind, item, name: def?.name ?? item, credits: character.credits, count: countOf(rpg, item) });
    act(kind === "buy" ? { kind: "buy", item } : { kind: "sell", item, count });
  };

  const current = pick ?? (vendor.stock[0] ? { side: "buy" as const, item: vendor.stock[0].item } : null);
  const def: ItemDefinition | undefined = current ? items[current.item] : undefined;
  const offer = current?.side === "buy" ? vendor.stock.find((entry) => entry.item === current.item) : undefined;
  const owned = current ? countOf(rpg, current.item) : 0;
  const unit = def ? sellPrice(def, 1, vendor.sellRate) : 0;

  return <div className={styles.overlay} data-rpg-screen="vendor" onClick={onClose}>
    <section className={styles.frame} role="dialog" aria-modal="true" aria-labelledby="rpg-vendor-title" tabIndex={-1} ref={dialogRef} onClick={(event) => event.stopPropagation()}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Trade</span>
          <h2 className={styles.title} id="rpg-vendor-title">{vendor.name}</h2>
        </div>
        <div className={styles.tabs} role="group" aria-label="List">
          <button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy<small>{vendor.stock.length}</small></button>
          <button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell<small>{pack.length}</small></button>
        </div>
        <p className={styles.purse}><small>Credits</small>{formatCr(character.credits)}<span>CR</span></p>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Leave the vendor">Leave <span aria-hidden="true">×</span></button>
      </header>
      <div className={styles.tradeBody} data-side={side}>
        <section className={styles.tradeList} data-list="buy" aria-label="For sale">
          <h3 className={styles.sectionTitle}>For sale <small>prices in CR</small></h3>
          <ul className={styles.list}>
            {vendor.stock.map((entry) => {
              const item = items[entry.item];
              const blocked = buyBlocker(item, entry.price, character);
              return <li key={entry.item}>
                <div className={styles.tradeRow} data-selected={current?.side === "buy" && current.item === entry.item} style={{ "--rarity": item ? rarityColor(item.rarity) : "#6f9a94" } as CSSProperties}>
                  <button type="button" className={styles.row} onClick={() => setPick({ side: "buy", item: entry.item })} aria-label={`Inspect ${item?.name ?? entry.item}`}>
                    <ItemGlyph def={item} />
                    <span className={styles.rowLabel}><span className={styles.name} style={{ color: item ? rarityColor(item.rarity) : undefined }}>{item?.name ?? entry.item}</span><small>{item ? kindLabel(item) : ""}</small></span>
                    <span className={styles.price} data-afford={entry.price <= character.credits}>{formatCr(entry.price)}</span>
                  </button>
                  <button type="button" className={styles.tradeButton} disabled={!!blocked || !!pending} title={blocked ?? undefined} onClick={() => send("buy", entry.item, 1)}>Buy</button>
                </div>
              </li>;
            })}
          </ul>
        </section>
        <section className={styles.tradeList} data-list="sell" aria-label="Your items">
          <h3 className={styles.sectionTitle}>Your items <small>vendor pays {Math.round(vendor.sellRate * 100)}%</small></h3>
          <ul className={styles.list}>
            {pack.map((stack) => {
              const item = items[stack.item];
              const each = sellPrice(item, 1, vendor.sellRate);
              const slot = slots.get(stack.item);
              return <li key={stack.item}>
                <div className={styles.tradeRow} data-selected={current?.side === "sell" && current.item === stack.item} style={{ "--rarity": item ? rarityColor(item.rarity) : "#6f9a94" } as CSSProperties}>
                  <button type="button" className={styles.row} onClick={() => setPick({ side: "sell", item: stack.item })} aria-label={`Inspect ${item?.name ?? stack.item}`}>
                    <ItemGlyph def={item} />
                    <span className={styles.rowLabel}><span className={styles.name} style={{ color: item ? rarityColor(item.rarity) : undefined }}>{item?.name ?? stack.item}{stack.count > 1 ? <b> x{stack.count}</b> : null}</span><small>{item ? kindLabel(item) : ""}</small></span>
                    {slot ? <span className={styles.badge} title="Equipped">{slotBadge(slot)}</span> : null}
                    <span className={styles.price} data-afford="true">{each > 0 ? `+${formatCr(each)}` : "-"}</span>
                  </button>
                  <button type="button" className={styles.tradeButton} disabled={each <= 0 || !!pending} onClick={() => send("sell", stack.item, 1)}>Sell</button>
                </div>
              </li>;
            })}
          </ul>
        </section>
        <aside className={styles.inspectPane} aria-label="Item details">
          {def && current ? <ItemInspect def={def} count={owned} character={character} items={items} slot={slots.get(current.item) ?? null} compare={comparisonTarget(def, character.equipped, items)}
            price={current.side === "buy" && offer ? <><span>Price <b>{formatCr(offer.price)}</b> CR</span><span>{owned ? `${owned} owned` : `${formatNumber(def.weight, 2)} kg`}</span></> : <><span>Sells for <b>{formatCr(unit)}</b> CR each</span><span>{owned} owned</span></>}>
            <div className={styles.actions}>
              <div className={styles.actionRow}>
                {current.side === "buy" && offer ? <button type="button" className={styles.action} data-primary="true" disabled={!!buyBlocker(def, offer.price, character) || !!pending} onClick={() => send("buy", current.item, 1)}>Buy for {formatCr(offer.price)} CR</button> : null}
                {current.side === "sell" && owned > 0 ? <>
                  <button type="button" className={styles.action} data-primary="true" disabled={unit <= 0 || !!pending} onClick={() => send("sell", current.item, 1)}>Sell 1 · +{formatCr(unit)}</button>
                  {owned > 1 ? <button type="button" className={styles.action} disabled={unit <= 0 || !!pending} onClick={() => send("sell", current.item, owned)}>Sell all {owned} · +{formatCr(sellPrice(def, owned, vendor.sellRate))}</button> : null}
                </> : null}
              </div>
              {current.side === "buy" && offer ? <p className={styles.note}>{buyBlocker(def, offer.price, character) ?? (def.kind === "ammo" ? "Ammo comes by the box." : `${formatCr(character.credits - offer.price)} CR left after buying.`)}</p> : null}
              {current.side === "sell" && slots.get(current.item) ? <p className={styles.note} data-tone="warn">Equipped: selling the last one takes it off you.</p> : null}
            </div>
          </ItemInspect> : <p className={styles.empty}>Pick an item to inspect it.</p>}
        </aside>
      </div>
      <footer className={styles.footer}>
        <p className={styles.tradeFeedback} role="status" aria-live="polite" data-ok={feedback?.ok ?? "none"}>{pending ? "..." : feedback?.text ?? ""}</p>
        <span className={styles.keys} aria-hidden="true"><span><kbd>Esc</kbd> leave</span></span>
        <button type="button" className={styles.resume} onClick={onClose}>Done trading <span aria-hidden="true">↗</span></button>
      </footer>
    </section>
  </div>;
}
