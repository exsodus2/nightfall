"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalPose } from "@/multiplayer/types";
import type { ConnectRequest, SessionView } from "@/multiplayer/session";
import { CODE_LENGTH, NAME_MAX, defaultServerUrl, inviteLink, normalizeCode, normalizeServerUrl, sanitizeName } from "@/multiplayer/protocol";
import { PlayerList } from "./player-list";
import styles from "./multiplayer.module.css";

const NAME_KEY = "nightfall:mp-name";
const SERVER_KEY = "nightfall:mp-server";
const ENV_URL = process.env.NEXT_PUBLIC_MULTIPLAYER_URL;

function stored(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function store(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* private mode: not remembered */ } }

interface LobbyProps {
  view: SessionView;
  pose: LocalPose;
  onConnect: (request: ConnectRequest) => Promise<boolean>;
  onLeave: () => void;
  onClose: () => void;
  onResume: () => void;
}

/** Online panel: display name, server address, create a room or join one by code, invite friends.
 * Mounted only while open (client-side), so it can read the address bar and storage directly. */
export function MultiplayerLobby({ view, pose, onConnect, onLeave, onClose, onResume }: LobbyProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(() => stored(NAME_KEY) ?? "");
  const [code, setCode] = useState(() => normalizeCode(new URLSearchParams(location.search).get("room") ?? ""));
  const [server, setServer] = useState(() => defaultServerUrl(location, ENV_URL, stored(SERVER_KEY)) ?? "");
  const [copied, setCopied] = useState(false);
  const serverUrl = normalizeServerUrl(server);
  const busy = view.status === "connecting";
  const connected = view.status === "connected";

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input, summary");
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      // Hand focus back only if nothing else took it: Back to the streets focuses the city canvas, and a
      // header button left focused there would swallow Enter (chat) / reopen this panel while playing.
      const active = document.activeElement;
      if (previous instanceof HTMLElement && previous.isConnected && (!active || active === document.body || dialog?.contains(active))) previous.focus();
    };
  }, [onClose]);

  async function connect(join: boolean) {
    if (!serverUrl) return;
    const display = sanitizeName(name);
    store(NAME_KEY, display); store(SERVER_KEY, serverUrl);
    setCopied(false);
    await onConnect({ serverUrl, name: display, code: join ? code : undefined, pose });
  }

  async function copyInvite() {
    if (!view.code || !view.serverUrl) return;
    const link = inviteLink(location, view.code, view.serverUrl, ENV_URL);
    const text = `Join me in Nightfall. Room ${view.code}\n${link}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { window.prompt("Copy this invite:", text); }
  }

  return <div className="panel-backdrop" onClick={onClose}>
    <section className={`side-panel ${styles.lobby}`} role="dialog" aria-modal="true" aria-labelledby="mp-title" tabIndex={-1} ref={dialogRef} onClick={(event) => event.stopPropagation()}>
      <div className="panel-heading"><div><span className="panel-kicker">Nightfall online</span><h2 id="mp-title">{connected ? "Party up." : "Bring a friend."}</h2></div><button className="close-button" onClick={onClose} aria-label="Close online panel">×</button></div>
      <p className="panel-intro">Meet in the streets or step into the same venue. Share chat and map pins with up to eight runners. Your RPG quests, inventory and rewards stay yours.</p>

      {connected && view.code ? <>
        <div className={styles.room}>
          <div><small>Room code</small><strong>{view.code}</strong></div>
          <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={copyInvite}>{copied ? "Invite copied" : "Copy invite"}<span aria-hidden="true">⧉</span></button>
        </div>
        <h3 className="section-title">In this room <span>{view.roster.length} / 8</span></h3>
        <PlayerList roster={view.roster} />
        <p className={styles.hint}>Press <kbd>Enter</kbd> in the city to chat. Friends appear on your minimap and atlas.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onLeave}>Leave room<span aria-hidden="true">↩</span></button>
          <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={onResume}>Back to the city<span aria-hidden="true">↗</span></button>
        </div>
      </> : <>
        <label className={styles.field}><span>Display name <small>{[...name].length}/{NAME_MAX}</small></span>
          <input value={name} maxLength={NAME_MAX * 2} placeholder="Runner" autoComplete="nickname" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={`${styles.field} ${styles.code}`}><span>Room code</span>
          <input value={code} maxLength={12} placeholder={"·".repeat(CODE_LENGTH)} autoComplete="off" spellCheck={false} onChange={(event) => setCode(normalizeCode(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter" && code && serverUrl && !busy) void connect(true); }} />
        </label>
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${code ? styles.buttonPrimary : ""}`} disabled={busy || !serverUrl || !code} onClick={() => void connect(true)}>Join room<span aria-hidden="true">→</span></button>
          <button type="button" className={`${styles.button} ${code ? "" : styles.buttonPrimary}`} disabled={busy || !serverUrl} onClick={() => void connect(false)}>Create room<span aria-hidden="true">+</span></button>
        </div>
        <details className={styles.details} open={!serverUrl}>
          <summary>Server address {serverUrl ? `· ${serverUrl}` : "· needed"}</summary>
          <label className={styles.field}><span>Multiplayer server</span>
            <input value={server} placeholder="wss://your-tunnel.trycloudflare.com" autoComplete="url" spellCheck={false} onChange={(event) => setServer(event.target.value)} />
          </label>
          <p className={styles.hint}>The host runs <code>npm run server</code> (port 2567) and shares its tunnel address. Invite links fill this in for you.</p>
        </details>
      </>}

      {busy ? <p className={styles.status} role="status">Connecting to {view.serverUrl}…</p> : null}
      {view.status === "error" && view.error ? <p className={`${styles.status} ${styles.statusError}`} role="alert">{view.error}</p> : null}
      {!connected ? <button className="primary-button panel-resume" onClick={onResume}>Keep exploring solo <span aria-hidden="true">↗</span></button> : null}
    </section>
  </div>;
}
