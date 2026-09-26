"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  METADATA_URL, NIGHTRIDE_URL, RADIO_STATIONS, REKT_URL, RadioPlayer, VOLUME_STEP,
  cycleStation, formatNowPlaying, loadRadioPrefs, meterString, parseMetadata, saveRadioPrefs, stationIndex, stationLabel, stepVolume, volumeBar,
  type NowPlaying, type RadioPrefs, type RadioStatus,
} from "@/audio/radio";
import styles from "./radio.module.css";

/** Physical keys (event.code). Chosen to avoid the game's WASD / arrows / Shift / Space / Q C F T E M J V / Esc and chat (Enter, Y). */
export const RADIO_KEYS = {
  toggle: ["KeyR"],
  mute: ["KeyN"],
  previous: ["Comma", "BracketLeft"],
  next: ["Period", "BracketRight"],
  volumeDown: ["Minus", "NumpadSubtract"],
  volumeUp: ["Equal", "NumpadAdd"],
} as const;
type RadioAction = keyof typeof RADIO_KEYS;

function actionFor(code: string): RadioAction | null {
  for (const action of Object.keys(RADIO_KEYS) as RadioAction[]) if ((RADIO_KEYS[action] as readonly string[]).includes(code)) return action;
  return null;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

const BANDS = 14;
const STATUS_TEXT: Record<RadioStatus, string> = { off: "Off", tuning: "Tuning", playing: "On air", error: "No signal" };
const FLASH_MS = 2600;

interface RadioProps {
  /** Hotkeys are live (game running or paused without an overlay). The widget stays clickable whenever it is visible. */
  active: boolean;
  /** Show the HUD widget. Audio keeps playing while it is hidden (atlas, settings, quest log…). */
  visible: boolean;
  /** Player is driving: the widget dresses as the car's head unit. */
  driving: boolean;
  /** Radio audible (playing, not muted) - lets the engine duck its rain bed. Pass a stable callback. */
  onAudibleChange?: (audible: boolean) => void;
}

/**
 * Nightride FM in-game radio. Mount once (client only - it reads localStorage in its initial state) and keep it mounted;
 * `visible` hides the widget without stopping playback. Never starts audio without a user gesture.
 */
export function Radio({ active, visible, driving, onAudibleChange }: RadioProps) {
  const [initialPrefs] = useState<RadioPrefs>(loadRadioPrefs);
  const [prefs, setPrefs] = useState<RadioPrefs>(initialPrefs);
  const prefsRef = useRef<RadioPrefs>(initialPrefs);
  const [status, setStatus] = useState<RadioStatus>("off");
  const [meta, setMeta] = useState<ReadonlyMap<string, NowPlaying>>(() => new Map());
  const [flash, setFlash] = useState<{ id: number; label: string; genre: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const playerRef = useRef<RadioPlayer | null>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const widgetRef = useRef<HTMLElement>(null);
  const hiddenPause = useRef(false);

  const station = RADIO_STATIONS[stationIndex(prefs.station)];
  const nowPlaying = meta.get(station.id);
  const track = formatNowPlaying(nowPlaying);
  const on = status !== "off";
  const audible = status === "playing" && !prefs.muted && prefs.volume > 0;

  // ---- actions (called directly from gestures so play() / AudioContext.resume() keep their user activation) ----
  const player = useCallback(() => playerRef.current ?? (playerRef.current = new RadioPlayer(setStatus)), []);
  const update = useCallback((patch: Partial<RadioPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    saveRadioPrefs(next);
    return next;
  }, []);
  const announce = useCallback((id: string) => {
    const target = RADIO_STATIONS[stationIndex(id)];
    setFlash({ id: Date.now(), label: stationLabel(target), genre: target.genre });
  }, []);
  const turnOn = useCallback(() => {
    hiddenPause.current = false;
    const next = update({ on: true });
    player().play(RADIO_STATIONS[stationIndex(next.station)], next.volume, next.muted);
    announce(next.station);
  }, [announce, player, update]);
  const turnOff = useCallback(() => {
    hiddenPause.current = false;
    update({ on: false });
    playerRef.current?.stop();
  }, [update]);
  const tune = useCallback((id: string) => {
    const next = update({ station: id });
    if (playerRef.current && prefsRef.current.on && !hiddenPause.current) player().play(RADIO_STATIONS[stationIndex(id)], next.volume, next.muted);
    announce(id);
  }, [announce, player, update]);
  const setVolume = useCallback((volume: number, muted: boolean) => {
    const next = update({ volume, muted });
    playerRef.current?.setVolume(next.volume, next.muted);
  }, [update]);

  const run = useEffectEvent((action: RadioAction) => {
    const current = prefsRef.current;
    if (action === "toggle") { if (on) turnOff(); else turnOn(); }
    else if (action === "mute") setVolume(current.volume, !current.muted);
    else if (action === "previous" || action === "next") tune(cycleStation(current.station, action === "next" ? 1 : -1));
    else setVolume(stepVolume(current.volume, action === "volumeUp" ? VOLUME_STEP : -VOLUME_STEP), false);
  });

  // ---- hotkeys: work while pointer-locked and moving; ignored while typing (chat) or under a modal dialog ----
  useEffect(() => {
    if (!active) return;
    const handleKey = (event: KeyboardEvent) => {
      const action = actionFor(event.code);
      if (!action || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector("[aria-modal='true']")) return;
      if (event.repeat && action !== "volumeUp" && action !== "volumeDown") return;
      event.preventDefault();
      run(action);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active]);

  // ---- remembered "on": resume on the player's first gesture (browsers block autoplay; we never try before one) ----
  /** Returns true once the gesture has been dealt with (the listener then detaches). */
  const resumeOnGesture = useEffectEvent((event: Event): boolean => {
    if (!prefsRef.current.on || on) return true;
    if (event instanceof KeyboardEvent && (event.code === "Escape" || isTyping(event.target))) return false; // Not a user activation / typing in chat.
    // Mobile (iPhone agent): a touch/pen pointerdown is not a user activation (iOS rejects play() there); its pointerup is.
    if (event instanceof PointerEvent && event.type === "pointerdown" && event.pointerType !== "mouse") return false;
    if (event instanceof KeyboardEvent && actionFor(event.code)) return true; // Radio keys handle themselves.
    if (event.target instanceof Node && widgetRef.current?.contains(event.target)) return true; // So do the widget's buttons.
    turnOn();
    return true;
  });
  useEffect(() => {
    if (!initialPrefs.on) return;
    const handle = (event: Event) => { if (resumeOnGesture(event)) cleanup(); };
    const cleanup = () => { window.removeEventListener("pointerdown", handle, true); window.removeEventListener("pointerup", handle, true); window.removeEventListener("keydown", handle, true); };
    window.addEventListener("pointerdown", handle, true);
    window.addEventListener("pointerup", handle, true); // Mobile: touch activation happens on pointerup
    window.addEventListener("keydown", handle, true);
    return cleanup;
  }, [initialPrefs.on]);

  // ---- optional: pause while the tab is hidden (default keeps playing) ----
  const visibilityChanged = useEffectEvent(() => {
    const current = prefsRef.current;
    if (document.hidden) {
      if (current.pauseHidden && on) { playerRef.current?.stop(); hiddenPause.current = true; }
    } else if (hiddenPause.current) {
      hiddenPause.current = false;
      if (current.on) player().play(RADIO_STATIONS[stationIndex(current.station)], current.volume, current.muted);
    }
  });
  useEffect(() => {
    const handle = () => visibilityChanged();
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, []);

  // ---- now playing: Nightride's public SSE feed (CORS-enabled), connected only while the radio is on ----
  useEffect(() => {
    if (!on || typeof EventSource === "undefined") return;
    const source = new EventSource(METADATA_URL);
    source.onmessage = (event: MessageEvent<string>) => {
      const update = parseMetadata(event.data);
      if (update) setMeta((current) => new Map([...current, ...update]));
    };
    return () => source.close();
  }, [on]);

  // ---- level meter: real spectrum through an AnalyserNode, or a tasteful synthetic one ----
  useEffect(() => {
    const element = meterRef.current;
    if (!element) return;
    if (status !== "playing" || !visible) { element.textContent = meterString(new Float32Array(BANDS).fill(status === "tuning" ? 0.12 : 0)); return; }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const levels = new Float32Array(BANDS);
    const fake = new Float32Array(BANDS);
    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < (reduced ? 480 : 55) || document.hidden) return;
      last = now;
      if (!playerRef.current?.levels(levels)) {
        const beat = Math.pow(Math.max(0, Math.sin(now / 1000 * Math.PI * 2 * 1.9)), 6);
        for (let i = 0; i < BANDS; i++) {
          const shape = 0.78 - (i / BANDS) * 0.5;
          const target = Math.min(1, shape * (0.35 + Math.random() * 0.45) + (i < 4 ? beat * 0.4 : 0));
          fake[i] += (target - fake[i]) * (target > fake[i] ? 0.6 : 0.22);
          levels[i] = fake[i] * (prefsRef.current.muted ? 0.15 : 1);
        }
      }
      element.textContent = meterString(levels);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [status, visible]);

  // ---- the station drawer folds away when the game recaptures the mouse ----
  useEffect(() => {
    const handle = () => { if (document.pointerLockElement) setExpanded(false); };
    document.addEventListener("pointerlockchange", handle);
    return () => document.removeEventListener("pointerlockchange", handle);
  }, []);

  // ---- station flash auto-hide ----
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // ---- rain ducking hook ----
  useEffect(() => { onAudibleChange?.(audible); }, [audible, onAudibleChange]);

  // ---- OS media controls / hardware media keys ----
  const media = useEffectEvent((action: "play" | "pause" | "next" | "previous") => {
    if (action === "play") turnOn();
    else if (action === "pause") turnOff();
    else tune(cycleStation(prefsRef.current.station, action === "next" ? 1 : -1));
  });
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, () => void][] = [["play", () => media("play")], ["pause", () => media("pause")], ["stop", () => media("pause")], ["nexttrack", () => media("next")], ["previoustrack", () => media("previous")]];
    for (const [action, handler] of handlers) { try { session.setActionHandler(action, handler); } catch { /* Unsupported action. */ } }
    return () => { for (const [action] of handlers) { try { session.setActionHandler(action, null); } catch { /* Unsupported action. */ } } };
  }, []);
  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.playbackState = on ? "playing" : "paused";
    if (!on) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: nowPlaying?.title || station.tag, artist: nowPlaying?.artist || station.network, album: stationLabel(station) });
  }, [on, nowPlaying, station]);

  useEffect(() => () => { playerRef.current?.destroy(); playerRef.current = null; }, []);

  const statusText = on ? STATUS_TEXT[status] : prefs.on ? "Standby" : STATUS_TEXT.off;
  const long = track.length > 30;
  const credit = station.network === "Rekt Network" ? { href: REKT_URL, text: "rekt.network" } : { href: NIGHTRIDE_URL, text: "nightride.fm" };

  return <>
    {flash ? <div key={flash.id} className={styles.flash} role="status" aria-live="polite"><span className={styles.flashRule} aria-hidden="true" /><strong>{flash.label}</strong><small>{flash.genre}</small></div> : null}
    <section ref={widgetRef} className={styles.radio} hidden={!visible} data-status={status} data-driving={driving} data-expanded={expanded} aria-label="Radio">
      <div className={styles.head}>
        <span className={styles.kicker}>{driving ? "In-car radio" : "Radio"}<span className={styles.band}>FM</span></span>
        <span className={styles.status} data-status={status}><span className={styles.lamp} aria-hidden="true" />{nowPlaying?.live && on ? "Live" : statusText}</span>
      </div>
      <div className={styles.station}>
        <strong>{station.tag}</strong>
        <small>{station.network} · {stationIndex(station.id) + 1}/{RADIO_STATIONS.length}</small>
      </div>
      <div className={styles.track} title={track || station.genre} data-scroll={long}>
        <span className={styles.trackInner}><span>{on ? track || station.genre : prefs.on ? "Press R or ▶ to resume" : station.genre}</span>{long && on ? <span aria-hidden="true">{track}</span> : null}</span>
      </div>
      <div className={styles.meterRow} aria-hidden="true">
        <span ref={meterRef} className={styles.meter} />
        <span className={styles.volume} data-muted={prefs.muted}>{prefs.muted ? "MUTE" : `${Math.round(prefs.volume * 100)}`.padStart(3, " ")}</span>
      </div>
      <div className={styles.controls}>
        <button type="button" onClick={() => tune(cycleStation(prefs.station, -1))} aria-label="Previous station" title="Previous station ( , or [ )">◂◂</button>
        <button type="button" className={styles.power} onClick={() => (on ? turnOff() : turnOn())} aria-label={on ? "Pause radio" : "Play radio"} aria-pressed={on} title="Play / pause (R)">{on ? "❚❚" : "▶"}</button>
        <button type="button" onClick={() => tune(cycleStation(prefs.station, 1))} aria-label="Next station" title="Next station ( . or ] )">▸▸</button>
        <button type="button" className={styles.mute} onClick={() => setVolume(prefs.volume, !prefs.muted)} aria-label={prefs.muted ? "Unmute radio" : "Mute radio"} aria-pressed={prefs.muted} title="Mute (N)">{prefs.muted ? "×" : "♪"}</button>
        <button type="button" className={styles.expand} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label="Stations and radio options" title="Stations and options">{expanded ? "−" : "≡"}</button>
      </div>
      {expanded ? <div className={styles.drawer}>
        <div className={styles.drawerHead}><span>Stations · {station.network}</span><button type="button" onClick={() => setExpanded(false)} aria-label="Close station list">×</button></div>
        <label className={styles.slider}>
          <span>Volume <output>{prefs.muted ? "muted" : `${Math.round(prefs.volume * 100)}%`}</output></span>
          <input type="range" min="0" max="1" step={VOLUME_STEP} value={prefs.volume} onChange={(event) => setVolume(Number(event.target.value), false)} aria-valuetext={`${Math.round(prefs.volume * 100)} percent`} />
          <span className={styles.volumeBar} aria-hidden="true">{volumeBar(prefs.volume, prefs.muted)}</span>
        </label>
        <button type="button" className={styles.drawerMute} onClick={() => setVolume(prefs.volume, !prefs.muted)} aria-pressed={prefs.muted}>{prefs.muted ? "Unmute" : "Mute"} <kbd>N</kbd></button>
        <ul className={styles.stations} aria-label="Stations">
          {RADIO_STATIONS.map((item) => <li key={item.id}><button type="button" aria-pressed={item.id === station.id} onClick={() => tune(item.id)}>
            <span className={styles.stationTag}>{item.tag}</span>
            <small>{formatNowPlaying(meta.get(item.id)) || item.genre}</small>
          </button></li>)}
        </ul>
        <label className={styles.option}><input type="checkbox" checked={prefs.pauseHidden} onChange={(event) => update({ pauseHidden: event.target.checked })} /> Pause when the tab is hidden</label>
        <p className={styles.keys}><kbd>R</kbd> play/pause <kbd>,</kbd><kbd>.</kbd> station <kbd>-</kbd><kbd>=</kbd> volume <kbd>N</kbd> mute</p>
        <p className={styles.attribution}>Live streams and track data by <a href={NIGHTRIDE_URL} target="_blank" rel="noreferrer">Nightride FM</a> and <a href={REKT_URL} target="_blank" rel="noreferrer">Rekt Network</a>. Support the artists.</p>
      </div> : null}
      <a className={styles.credit} href={credit.href} target="_blank" rel="noreferrer">{credit.text} <span aria-hidden="true">↗</span></a>
    </section>
  </>;
}
