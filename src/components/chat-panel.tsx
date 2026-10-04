"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom"; // Mobile: open + focus synchronously inside the tap (iOS keyboard)
import { CHAT_MAX } from "@/multiplayer/protocol";
import type { SessionView } from "@/multiplayer/session";
import { ChatAttention, CHAT_UNREAD_LIMIT, chatRoomKey } from "./chat-attention";
import styles from "./multiplayer.module.css";

interface ChatPanelProps {
  view: SessionView;
  /** Enter opens the chat only while walking around (not in menus or conversations). */
  enabled: boolean;
  onSend: (text: string) => boolean;
  attention?: ChatAttention;
}

/** Room chat and roster, bottom left. Enter opens the input; Enter sends, Escape closes. While the
 * input has focus the engine ignores game keys (it skips keyboard events aimed at inputs).
 * Messages are rendered as React text, never as HTML. */
export function ChatPanel(props: ChatPanelProps) {
  const [localAttention] = useState(() => new ChatAttention());
  return <RoomChatPanel key={chatRoomKey(props.view)} {...props} attention={props.attention ?? localAttention} />;
}

function RoomChatPanel({ view, enabled, onSend, attention }: ChatPanelProps & { attention: ChatAttention }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const composing = useRef(false);
  const compositionSubmit = useRef(false);
  const active = open && enabled;
  const room = chatRoomKey(view);
  const messages = view.chat;
  const summary = useSyncExternalStore(attention.subscribe, attention.getSnapshot, attention.getSnapshot);
  const unread = summary.room === room ? summary.unread : 0;
  const preview = summary.room === room && !active ? summary.preview : null;

  useEffect(() => { attention.observe(room, messages, active, performance.now()); }, [attention, room, messages, active]);
  useEffect(() => {
    if (!summary.preview) return;
    const timer = setTimeout(() => attention.expire(performance.now()), Math.max(0, summary.expiresAt - performance.now()));
    return () => clearTimeout(timer);
  }, [attention, summary.preview, summary.expiresAt]);

  const openNow = useCallback(() => {
    if (!enabled) return;
    attention.observe(room, messages, true, performance.now());
    flushSync(() => setOpen(true));
    inputRef.current?.focus();
  }, [enabled, attention, room, messages]);

  useEffect(() => {
    if (!enabled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== "Enter" && event.code !== "NumpadEnter") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement || target instanceof HTMLElement && target.isContentEditable) return;
      if (event.isComposing || event.keyCode === 229 || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      openNow();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled, openNow]);

  useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);
  // Mobile (iPhone agent): iOS only raises the keyboard for a focus() made inside the user's tap, so the
  // touch drawer's Chat button (window "nightfall:chat-open") and the tap target below render the input
  // synchronously and focus it in the same call stack.
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("nightfall:chat-open", openNow);
    return () => window.removeEventListener("nightfall:chat-open", openNow);
  }, [enabled, openNow]);
  useEffect(() => { const log = logRef.current; if (log) log.scrollTop = log.scrollHeight; }, [view.chat, active]);

  function close() {
    composing.current = false;
    compositionSubmit.current = false;
    setOpen(false);
    // Hand the keyboard back to the city (pointer lock, if any, is unaffected).
    document.querySelector<HTMLCanvasElement>(".city-canvas")?.focus();
  }

  function submit() {
    if (composing.current || compositionSubmit.current) return;
    if (draft.trim() && onSend(draft)) setDraft("");
    close();
  }

  const lines = active ? view.chat : view.chat.slice(-6);
  const unreadLabel = unread ? `, ${unread === CHAT_UNREAD_LIMIT ? "at least " : ""}${unread} unread ${unread === 1 ? "message" : "messages"}` : "";
  return <section ref={sectionRef} className={`${styles.chat} ${active ? styles.chatOpen : ""}`} aria-label="Room chat" data-open={active} data-enabled={enabled} data-unread={unread}
    onKeyDown={(event) => { if (event.target instanceof HTMLButtonElement && (event.key === "Enter" || event.key === " ")) event.stopPropagation(); }}>
    <div className={styles.mobileSummary}>
      <button type="button" className={styles.chatLauncher} data-chat-launcher aria-label={`Open room chat${unreadLabel}`} aria-expanded={active} aria-controls="room-chat-log" onClick={openNow}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Z" /><path d="M8 8h8M8 12h5" /></svg>
        {unread ? <span className={styles.unread} aria-hidden="true">{unread === CHAT_UNREAD_LIMIT ? "99+" : unread}</span> : null}
      </button>
      {preview && enabled ? <button type="button" className={styles.chatPreview} data-chat-preview aria-label={`Read room message from ${preview.name}: ${preview.text}`} onClick={openNow}>
        <b style={{ color: preview.color }}>{preview.name}</b><span>{preview.text}</span>
      </button> : null}
      <span className={styles.announcement} role="status" aria-live="polite" aria-atomic="true">{preview ? `${preview.name}: ${preview.text}` : ""}</span>
    </div>
    <div className={styles.chatHead}><span>Room</span><strong>{view.code}</strong><span className={styles.rule} /><span>{view.roster.length} online</span>{active ? <button type="button" className={styles.chatClose} data-chat-close aria-label="Close room chat" onClick={close}>×</button> : null}</div>
    <div className={styles.hudRoster}>{view.roster.map((player) => <span key={player.id}><span className={styles.dot} style={{ color: player.color }} aria-hidden="true" />{player.name}</span>)}</div>
    <ol id="room-chat-log" className={styles.log} ref={logRef} aria-live="polite" aria-relevant="additions">
      {lines.map((line) => <li key={line.id} className={`${styles.line} ${line.kind === "system" ? styles.system : line.kind === "notice" ? styles.notice : ""}`}>
        {line.kind === "chat" ? <b style={{ color: line.color }}>{line.name}{line.self ? " (you)" : ""}</b> : null}{line.text}
      </li>)}
    </ol>
    {active ? <form className={styles.entry} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label htmlFor="chat-input">Say</label>
      <input id="chat-input" name="message" ref={inputRef} value={draft} maxLength={CHAT_MAX} autoComplete="off" spellCheck={false} enterKeyHint="send" placeholder="Message the room"
        onChange={(event) => setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) { if (event.key === "Enter") compositionSubmit.current = true; return; }
          compositionSubmit.current = false;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); submit(); }
        }}
        onKeyUp={() => { compositionSubmit.current = false; }}
        onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !sectionRef.current?.contains(event.relatedTarget)) { composing.current = false; compositionSubmit.current = false; setOpen(false); } }} />
      <small>{CHAT_MAX - draft.length}</small>
      <button type="submit" className={styles.chatSend}>Send</button>
    </form> : enabled ? <div className={styles.prompt}><kbd>Enter</kbd> chat</div> : null}
  </section>;
}
