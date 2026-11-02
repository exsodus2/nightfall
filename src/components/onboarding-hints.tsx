"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./photo-mode.module.css";

/**
 * First-visit key hints (desktop): a small card that teaches the keys the walking hint leaves out. Each
 * key dims once used; it stays dismissed after "Got it" or once every key has been tried, and otherwise
 * shows on the first three visits for up to 45 seconds each. Mount only on the client (reads localStorage
 * in its initial state); the hub renders it once the city is ready.
 */
const STORAGE_KEY = "nightfall:onboarding";
const MAX_VISITS = 3;
const VISIBLE_MS = 45_000;
const KEYS = [
  { code: "KeyE", key: "E", label: "interact" },
  { code: "KeyT", key: "T", label: "transit" },
  { code: "KeyM", key: "M", label: "map" },
  { code: "KeyJ", key: "J", label: "quests" },
  { code: "KeyP", key: "P", label: "photo" },
  { code: "KeyR", key: "R", label: "radio" },
] as const;

interface Stored { dismissed: boolean; visits: number }
let countedThisLoad = false;

function readStored(): Stored {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && typeof raw === "object" && "dismissed" in raw && "visits" in raw) {
      const { dismissed, visits } = raw as { dismissed: unknown; visits: unknown };
      return { dismissed: dismissed === true, visits: typeof visits === "number" && Number.isFinite(visits) ? visits : 0 };
    }
  } catch { /* storage unavailable or malformed */ }
  return { dismissed: false, visits: 0 };
}

function writeStored(value: Stored): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* private mode: not remembered */ }
}

export function OnboardingHints({ visible }: { visible: boolean }) {
  const [stored] = useState(readStored);
  const [dismissed, setDismissed] = useState(() => stored.dismissed || stored.visits >= MAX_VISITS);
  const [expired, setExpired] = useState(false);
  const [used, setUsed] = useState<ReadonlySet<string>>(() => new Set());
  const usedRef = useRef<ReadonlySet<string>>(used);
  const remainingRef = useRef(VISIBLE_MS);
  const showing = visible && !dismissed && !expired;

  // One visit per page load, counted the first time the card is actually on screen.
  useEffect(() => {
    if (!showing || countedThisLoad) return;
    countedThisLoad = true;
    writeStored({ dismissed: false, visits: stored.visits + 1 });
  }, [showing, stored]);

  useEffect(() => {
    if (!showing) return;
    // Remaining time carries across hides (indoors, paused, dialogue): only time on screen counts.
    const started = performance.now();
    const timer = setTimeout(() => setExpired(true), Math.max(0, remainingRef.current));
    return () => { clearTimeout(timer); remainingRef.current -= performance.now() - started; };
  }, [showing]);

  // Mark keys as the player uses them; once all of them are known the card retires for good.
  useEffect(() => {
    if (dismissed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!KEYS.some((item) => item.code === event.code) || usedRef.current.has(event.code)) return;
      const next = new Set(usedRef.current).add(event.code);
      usedRef.current = next;
      setUsed(next);
      if (next.size === KEYS.length) { writeStored({ dismissed: true, visits: MAX_VISITS }); setDismissed(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissed]);

  if (!showing) return null;
  const dismiss = () => { writeStored({ dismissed: true, visits: MAX_VISITS }); setDismissed(true); };
  return <aside className={styles.hints} aria-label="Key hints">
    <div className={styles.hintsHead}><span>First night here</span><button type="button" className={styles.hintsClose} onClick={dismiss} aria-label="Dismiss key hints">Got it ×</button></div>
    <ul className={styles.hintsGrid}>
      {KEYS.map((item) => <li key={item.code} data-used={used.has(item.code)}><kbd>{item.key}</kbd>{item.label}</li>)}
    </ul>
  </aside>;
}
