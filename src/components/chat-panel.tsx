"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom"; // Mobile: open + focus synchronously inside the tap (iOS keyboard)
import { CHAT_MAX } from "@/multiplayer/protocol";
import type { SessionView } from "@/multiplayer/session";
import styles from "./multiplayer.module.css";

interface ChatPanelProps {
  view: SessionView;
  /** Enter opens the chat only while walking around (not in menus or conversations). */
  enabled: boolean;
  onSend: (text: string) => boolean;
}

/** Room chat and roster, bottom left. Enter opens the input; Enter sends, Escape closes. While the
 * input has focus the engine ignores game keys (it skips keyboard events aimed at inputs).
 * Messages are rendered as React text, never as HTML. */
export function ChatPanel({ view, enabled, onSend }: ChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const active = open && enabled;

  useEffect(() => {
    if (!enabled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== "Enter" && event.code !== "NumpadEnter") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) return;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled]);

  useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);
  // Mobile (iPhone agent): iOS only raises the keyboard for a focus() made inside the user's tap, so the
  // touch drawer's Chat button (window "nightfall:chat-open") and the tap target below render the input
  // synchronously and focus it in the same call stack.
  useEffect(() => {
    if (!enabled) return;
    const openNow = () => { flushSync(() => setOpen(true)); inputRef.current?.focus(); };
    window.addEventListener("nightfall:chat-open", openNow);
    return () => window.removeEventListener("nightfall:chat-open", openNow);
  }, [enabled]);
  useEffect(() => { const log = logRef.current; if (log) log.scrollTop = log.scrollHeight; }, [view.chat, active]);

  function close() {
    setOpen(false);
    // Hand the keyboard back to the city (pointer lock, if any, is unaffected).
    document.querySelector<HTMLCanvasElement>(".city-canvas")?.focus();
  }

  function submit() {
    if (draft.trim() && onSend(draft)) setDraft("");
    close();
  }

  const lines = active ? view.chat.slice(-30) : view.chat.slice(-6);
  return <section className={`${styles.chat} ${active ? styles.chatOpen : ""}`} aria-label="Room chat" data-open={active /* Mobile: mobile.css lifts it above the keyboard */}>
    <div className={styles.chatHead}><span>Room</span><strong>{view.code}</strong><span className={styles.rule} /><span>{view.roster.length} online</span></div>
    <div className={styles.hudRoster}>{view.roster.map((player) => <span key={player.id}><span className={styles.dot} style={{ color: player.color }} aria-hidden="true" />{player.name}</span>)}</div>
    <ol className={styles.log} ref={logRef} aria-live="polite" aria-relevant="additions">
      {lines.map((line) => <li key={line.id} className={`${styles.line} ${line.kind === "system" ? styles.system : line.kind === "notice" ? styles.notice : ""}`}>
        {line.kind === "chat" ? <b style={{ color: line.color }}>{line.name}{line.self ? " (you)" : ""}</b> : null}{line.text}
      </li>)}
    </ol>
    {active ? <form className={styles.entry} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label htmlFor="chat-input">Say</label>
      <input id="chat-input" ref={inputRef} value={draft} maxLength={CHAT_MAX} autoComplete="off" spellCheck={false} placeholder="Message the room"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          else if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
        }}
        onBlur={() => setOpen(false)} />
      <small>{CHAT_MAX - draft.length}</small>
    </form> : enabled ? <div className={styles.prompt}><kbd>Enter</kbd> chat{/* Mobile: tappable on touch screens */}<button type="button" data-chat-tap onClick={() => window.dispatchEvent(new Event("nightfall:chat-open"))} style={{ pointerEvents: "auto", marginLeft: 6, padding: "4px 10px", minHeight: 32, background: "#07141acc", border: "1px solid #7fb3ab44", color: "#cfe0d6", font: "inherit" }}>Say something</button></div> : null}
  </section>;
}
