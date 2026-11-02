"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { CityController } from "@/city/engine";
import { ORBIT_DEFAULT_SPEED, ORBIT_MAX_SPEED, ORBIT_MIN_SPEED, clampOrbitSpeed, dragAim, frameToText, orbitStep, photoFilename } from "@/city/photo-mode";
import styles from "./photo-mode.module.css";

/**
 * Photo mode (P): pauses the city, hides every overlay (main[data-photo] in globals.css) and the in-engine
 * HUD layer, frees the mouse, and shows one strip: Save PNG, Copy ASCII (.txt fallback), slow orbit,
 * freeze time, hide controls. P / Done goes back to where you were; Esc leaves to the pause menu
 * (Esc does not count as a user gesture, so it could not recapture the mouse). Leaving restores the
 * camera angle, the HUD and the clock exactly.
 */
interface PhotoSession {
  /** The city was running when photo mode opened: P / Done resumes it. */
  resume: boolean;
  /** Runs instead of resuming (e.g. reopen the settings panel photo mode was started from). */
  after?: () => void;
  start: { yaw: number; pitch: number };
}

export interface PhotoModeOptions {
  controller: RefObject<CityController | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  ready: boolean;
  /** Read when P is pressed: may photo mode open now (no conversation, panel or screen in the way)? */
  canOpen: () => boolean;
  /** Pause the city for the shot; returns true when it was running. */
  pauseCity: () => boolean;
  /** Back to the streets. Called from P / Done, which are user gestures, so the mouse can be recaptured. */
  resumeCity: () => void;
}

export interface PhotoMode {
  active: boolean;
  open: (after?: () => void) => void;
  close: (resume: boolean) => void;
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  orbit: boolean;
  setOrbit: (orbit: boolean) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  frozen: boolean;
  setFrozen: (frozen: boolean) => void;
  status: string;
  savePng: (place: string) => void;
  copyText: (place: string) => void;
  saveText: (place: string) => void;
}

function isTyping(target: EventTarget | null): boolean {
  return (target instanceof HTMLInputElement && target.type !== "range") || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function usePhotoMode(options: PhotoModeOptions): PhotoMode {
  const [session, setSession] = useState<PhotoSession | null>(null);
  const [hidden, setHidden] = useState(false);
  const [orbit, setOrbitState] = useState(false);
  const [speed, setSpeedState] = useState(ORBIT_DEFAULT_SPEED);
  const [frozen, setFrozenState] = useState(false);
  const [status, setStatus] = useState("");
  const [wasReady, setWasReady] = useState(options.ready);
  const opts = useRef(options);
  const sessionRef = useRef<PhotoSession | null>(null);
  const live = useRef({ orbit: false, speed: ORBIT_DEFAULT_SPEED, frozen: false, velocity: 0, dragging: false, aim: { yaw: 0, pitch: 0 } });
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { opts.current = options; });
  useEffect(() => { sessionRef.current = session; }, [session]);

  // A lost WebGL context or a rebuild ends the session: the next engine starts with its HUD shown.
  if (options.ready !== wasReady) {
    setWasReady(options.ready);
    if (!options.ready && session) { setSession(null); setOrbitState(false); setFrozenState(false); }
  }

  const say = useCallback((message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(""), 4500);
  }, []);
  useEffect(() => { const timer = statusTimer; return () => { if (timer.current) clearTimeout(timer.current); }; }, []);

  const open = useCallback((after?: () => void) => {
    const o = opts.current, city = o.controller.current;
    if (sessionRef.current || !city || !o.ready) return;
    const resume = o.pauseCity();
    const start = city.photo({ kind: "hud", visible: false });
    Object.assign(live.current, { orbit: false, frozen: false, velocity: 0, dragging: false, aim: { ...start } });
    const next: PhotoSession = { resume, after, start };
    sessionRef.current = next;
    setSession(next); setHidden(false); setOrbitState(false); setFrozenState(false); setStatus("");
  }, []);

  const close = useCallback((resume: boolean) => {
    const current = sessionRef.current, o = opts.current, city = o.controller.current;
    if (!current) return;
    sessionRef.current = null;
    if (city) {
      city.photo({ kind: "aim", yaw: current.start.yaw, pitch: current.start.pitch });
      city.photo({ kind: "hud", visible: true });
      if (live.current.frozen) city.inspect({ kind: "freeze", value: false });
    }
    Object.assign(live.current, { orbit: false, frozen: false, velocity: 0, dragging: false });
    setSession(null); setOrbitState(false); setFrozenState(false); setHidden(false); setStatus("");
    if (resume && current.resume) o.resumeCity();
    else current.after?.();
  }, []);

  const setOrbit = useCallback((next: boolean) => { live.current.orbit = next; setOrbitState(next); }, []);
  const setSpeed = useCallback((next: number) => { const value = clampOrbitSpeed(next); live.current.speed = value; setSpeedState(value); }, []);
  const setFrozen = useCallback((next: boolean) => {
    live.current.frozen = next; setFrozenState(next);
    opts.current.controller.current?.inspect({ kind: "freeze", value: next });
  }, []);

  // Keys: P opens (when nothing else is in the way); in photo mode P / Esc leave and H hides the strip.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (sessionRef.current) {
        if (event.code === "KeyP" || event.code === "Escape") {
          event.preventDefault(); event.stopImmediatePropagation();
          if (!event.repeat) close(event.code === "KeyP");
        } else if (event.code === "KeyH" && !event.repeat) { event.preventDefault(); setHidden((value) => !value); }
        return;
      }
      if (event.code !== "KeyP" || event.repeat || !opts.current.ready || !opts.current.canOpen()) return;
      event.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, close]);

  // Slow orbit: the camera turns in place, easing up to (and down from) at most 10 deg/s.
  useEffect(() => {
    if (!session) return;
    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      const state = live.current, dt = (now - last) / 1000;
      last = now;
      const step = orbitStep(state.velocity, state.orbit && !state.dragging ? state.speed : 0, dt);
      state.velocity = step.velocity;
      const city = opts.current.controller.current;
      if (step.yaw !== 0 && city) state.aim = city.photo({ kind: "aim", yaw: state.aim.yaw + step.yaw, pitch: state.aim.pitch });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [session]);

  // Drag on the city to frame the shot (the engine ignores pointer input while paused).
  useEffect(() => {
    const canvas = options.canvas.current;
    if (!session || !canvas) return;
    const abort = new AbortController(), state = live.current;
    let drag: { id: number; x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (event) => {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      state.dragging = true;
      try { canvas.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    }, { signal: abort.signal });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const city = opts.current.controller.current;
      const next = dragAim(state.aim.yaw, state.aim.pitch, event.clientX - drag.x, event.clientY - drag.y);
      drag.x = event.clientX; drag.y = event.clientY;
      if (city) state.aim = city.photo({ kind: "aim", ...next });
    }, { signal: abort.signal });
    const end = () => { drag = null; state.dragging = false; };
    canvas.addEventListener("pointerup", end, { signal: abort.signal });
    canvas.addEventListener("pointercancel", end, { signal: abort.signal });
    return () => { abort.abort(); state.dragging = false; };
  }, [session, options.canvas]);

  const savePng = useCallback((place: string) => {
    const canvas = opts.current.canvas.current;
    if (!canvas) return;
    const name = photoFilename(place, new Date(), "png");
    canvas.toBlob((blob) => {
      if (!blob) { say("Couldn't read the frame. Try again in a moment."); return; }
      download(blob, name);
      say(`Saved ${name}`);
    }, "image/png");
  }, [say]);

  const saveText = useCallback((place: string) => {
    const frame = opts.current.controller.current?.photoFrame();
    if (!frame) { say("The frame isn't ready yet."); return; }
    const name = photoFilename(place, new Date(), "txt");
    download(new Blob([frameToText(frame)], { type: "text/plain;charset=utf-8" }), name);
    say(`Saved ${name}`);
  }, [say]);

  const copyText = useCallback((place: string) => {
    const frame = opts.current.controller.current?.photoFrame();
    if (!frame) { say("The frame isn't ready yet."); return; }
    const text = frameToText(frame);
    const fallback = () => {
      const name = photoFilename(place, new Date(), "txt");
      download(new Blob([text], { type: "text/plain;charset=utf-8" }), name);
      say(`Clipboard unavailable. Saved ${name} instead.`);
    };
    if (!navigator.clipboard?.writeText) { fallback(); return; }
    navigator.clipboard.writeText(text).then(() => say(`Copied a ${frame.cols} × ${frame.rows} character frame.`), fallback);
  }, [say]);

  return { active: session !== null, open, close, hidden, setHidden, orbit, setOrbit, speed, setSpeed, frozen, setFrozen, status, savePng, copyText, saveText };
}

/** The photo-mode strip, bottom centre. Rendered last in <main> and kept visible by [data-photo-ui]. */
export function PhotoStrip({ photo, place, driving }: { photo: PhotoMode; place: string; driving: boolean }) {
  const stripRef = useRef<HTMLElement>(null);
  const { active, hidden } = photo;
  useEffect(() => { if (active && !hidden) stripRef.current?.focus({ preventScroll: true }); }, [active, hidden]);
  if (!photo.active) return null;
  if (photo.hidden) return <button type="button" className={styles.reveal} data-photo-ui onClick={() => photo.setHidden(false)} aria-label="Show photo controls"><kbd>H</kbd> controls</button>;
  return <section ref={stripRef} className={styles.strip} data-photo-ui aria-label="Photo mode" tabIndex={-1}>
    <div className={styles.row}>
      <span className={styles.label} aria-hidden="true">Photo</span>
      <button type="button" className={styles.action} onClick={() => photo.savePng(place)}>Save PNG</button>
      <button type="button" className={styles.action} onClick={() => photo.copyText(place)}>Copy ASCII</button>
      <button type="button" className={styles.action} onClick={() => photo.saveText(place)} aria-label="Save ASCII as a text file">.txt</button>
      <span className={styles.rule} aria-hidden="true" />
      <button type="button" className={styles.toggle} aria-pressed={photo.orbit} disabled={driving} title={driving ? "Orbit is unavailable from the driver's seat" : undefined} onClick={() => photo.setOrbit(!photo.orbit)}>Orbit</button>
      <label className={styles.speed}>
        <span className={styles.srOnly}>Orbit speed</span>
        <input type="range" min={ORBIT_MIN_SPEED} max={ORBIT_MAX_SPEED} step={1} value={photo.speed} disabled={driving} onChange={(event) => photo.setSpeed(Number(event.target.value))} aria-valuetext={`${photo.speed} degrees per second`} />
        <output aria-hidden="true">{photo.speed}°/s</output>
      </label>
      <button type="button" className={styles.toggle} aria-pressed={photo.frozen} onClick={() => photo.setFrozen(!photo.frozen)}>Freeze time</button>
      <span className={styles.rule} aria-hidden="true" />
      <button type="button" className={styles.action} onClick={() => photo.setHidden(true)}>Hide <kbd>H</kbd></button>
      <button type="button" className={styles.done} onClick={() => photo.close(true)}>Done <kbd>P</kbd></button>
    </div>
    <p className={styles.hint}><span>{driving ? "Drag is unavailable while driving." : "Drag the city to frame the shot."}</span><span><kbd>Esc</kbd> pause menu</span></p>
    <p className={styles.status} role="status" aria-live="polite">{photo.status}</p>
  </section>;
}
