"use client";

import { useRef } from "react";
import type { RpgSnapshot } from "@/rpg/types";
import { formatCr } from "./format";
import { useModal } from "./use-modal";
import styles from "./rpg.module.css";

// A flat trace after the last beats. Static: no flashing, no motion beyond a slow fade-in (which
// the global reduced-motion rule removes).
const TRACE = "__/\\_____/\\__/\\________________________________________";

/** Shown while snapshot.rpg.combat.dead: what happened, what was lost, and Respawn. Escape does not dismiss it. */
export function DeathScreen({ rpg, place, onRespawn }: { rpg: RpgSnapshot; place: string; onRespawn: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useModal(ref, null);
  const { character } = rpg;
  return <div className={styles.deathBackdrop} data-rpg-screen="dead">
    <section className={styles.death} role="alertdialog" aria-modal="true" aria-labelledby="rpg-death-title" aria-describedby="rpg-death-copy" tabIndex={-1} ref={ref}>
      <p className={styles.deathKicker}><span aria-hidden="true">&gt;</span> vitals feed: signal lost</p>
      <pre className={styles.trace} aria-hidden="true">{TRACE}</pre>
      <h2 id="rpg-death-title" className={styles.deathTitle}>FLATLINED</h2>
      <p id="rpg-death-copy" className={styles.deathCopy}>You went down in {place}. A street medic got to you before the city did.</p>
      <dl className={styles.deathLedger}>
        <div><dt>Lost</dt><dd>Nothing</dd></div>
        <div><dt>Kept</dt><dd>Level {character.level} / {formatCr(character.credits)} CR</dd></div>
        <div><dt>Gear</dt><dd>All equipped items</dd></div>
      </dl>
      <button type="button" className="primary-button" onClick={onRespawn} autoFocus>Respawn <span aria-hidden="true">↻</span></button>
    </section>
  </div>;
}
