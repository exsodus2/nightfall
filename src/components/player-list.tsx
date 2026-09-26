"use client";

import { MODE_NAMES } from "@/city/locomotion";
import type { RosterEntry } from "@/multiplayer/session";
import styles from "./multiplayer.module.css";

/** Everyone in the room with their colour and what they are doing. Names render as text (no markup). */
export function PlayerList({ roster }: { roster: readonly RosterEntry[] }) {
  return <ul className={styles.roster} aria-label="Players in this room">
    {roster.map((player) => <li key={player.id}>
      <span className={styles.dot} style={{ color: player.color }} aria-hidden="true" />
      <span>{player.name}{player.self ? <span className={styles.you}>you</span> : null}</span>
      <span className={styles.mode}>{MODE_NAMES[player.mode]}</span>
    </li>)}
  </ul>;
}
