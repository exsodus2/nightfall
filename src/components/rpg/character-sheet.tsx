"use client";

import type { RpgSnapshot } from "@/rpg/types";
import { bar, factionInfo, factionRows, formatCr, formatNumber, repMeter, standing } from "./format";
import styles from "./rpg.module.css";

const STATS: readonly { id: "cool" | "tech" | "street"; label: string; blurb: string }[] = [
  { id: "cool", label: "Cool", blurb: "Nerve and charm: talk past doormen, bluff, keep your voice level." },
  { id: "tech", label: "Tech", blurb: "Terminals, locks, drones and anything with a firmware update." },
  { id: "street", label: "Street", blurb: "Knowing people, reading gangs, and being taken seriously." },
];
const STAT_PIPS = 12;

/** Character tab: level and xp, vitals, dialogue stats, and faction standing as ASCII meters. */
export function CharacterSheet({ rpg }: { rpg: RpgSnapshot }) {
  const { character, combat } = rpg;
  const xpFraction = character.xpToNext > 0 ? character.xp / character.xpToNext : 1;
  return <div className={styles.sheet}>
    <section className={styles.sheetCol} aria-label="Level and vitals">
      <div className={styles.level}>
        <span className={styles.levelNumber}><small>Level</small>{String(character.level).padStart(2, "0")}</span>
        <div className={styles.xp}>
          <span className={styles.asciiBar} aria-hidden="true">[{bar(xpFraction, 28)}]</span>
          <p>{character.xpToNext > 0 ? <><b>{formatCr(character.xp)}</b> / {formatCr(character.xpToNext)} XP <span>{formatCr(Math.max(0, character.xpToNext - character.xp))} to level {character.level + 1}</span></> : <b>Maximum level</b>}</p>
        </div>
      </div>
      <h3 className={styles.sectionTitle}>Vitals</h3>
      <dl className={styles.vitals}>
        <div><dt>Health</dt><dd><span className={styles.asciiBar} data-tone="health" aria-hidden="true">{bar(combat.maxHealth > 0 ? combat.health / combat.maxHealth : 0, 14)}</span>{Math.round(combat.health)} / {character.maxHealth}</dd></div>
        <div><dt>Stamina</dt><dd><span className={styles.asciiBar} data-tone="stamina" aria-hidden="true">{bar(combat.maxStamina > 0 ? combat.stamina / combat.maxStamina : 0, 14)}</span>{Math.round(combat.stamina)} / {character.maxStamina}</dd></div>
        <div><dt>Protection</dt><dd>{Math.round(character.protection * 100)}%<small>damage reduction from armour</small></dd></div>
        <div><dt>Carry</dt><dd>{formatNumber(character.carry.weight)} / {formatNumber(character.carry.capacity)} kg</dd></div>
      </dl>
      <h3 className={styles.sectionTitle}>Stats <small>checks in conversation</small></h3>
      <ul className={styles.statList}>
        {STATS.map(({ id, label, blurb }) => {
          const value = character.stats[id];
          return <li key={id}>
            <span className={styles.statName}>{label}</span>
            <span className={styles.pips} aria-hidden="true">{"#".repeat(Math.min(STAT_PIPS, value))}<i>{".".repeat(Math.max(0, STAT_PIPS - value))}</i></span>
            <strong>{value}</strong>
            <p>{blurb}</p>
          </li>;
        })}
      </ul>
    </section>
    <section className={styles.sheetCol} aria-label="Reputation">
      <h3 className={styles.sectionTitle}>Reputation <small>-100 .. +100</small></h3>
      <ul className={styles.repList}>
        {factionRows(character.reputation).map(({ id, value }) => {
          const info = factionInfo(id);
          const meter = repMeter(value);
          const stand = standing(value);
          return <li key={id} data-tone={stand.tone}>
            <div className={styles.repHead}><strong>{info.name}</strong><span className={styles.repStanding}>{stand.label}</span><b>{value > 0 ? `+${value}` : value}</b></div>
            <span className={styles.repMeter} role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={value} aria-label={`${info.name} reputation ${value}, ${stand.label}`}>
              <span aria-hidden="true">[<i data-side="neg">{meter.negative}</i>|<i data-side="pos">{meter.positive}</i>]</span>
            </span>
            <p>{info.blurb}</p>
          </li>;
        })}
      </ul>
    </section>
  </div>;
}
