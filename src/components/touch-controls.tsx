"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import type { CityController, CitySnapshot } from "@/city/engine";
import { useTouchPrefs } from "./touch-prefs";
import styles from "./touch-controls.module.css";

/**
 * Mobile: phone controls, rendered only on touch-first devices while playing.
 *  - Left half: a floating joystick that appears where the thumb lands. Analog: the push sets the
 *    walking / flying speed; pushing past the ring sprints (in a car: boost). In a car the same stick
 *    steers (left/right) and drives (up = throttle, down = brake then reverse), so one thumb drives.
 *  - Right half: swipe to look, with a speed curve (fast flicks turn further). Optional gyro aim.
 *  - Thumb buttons bottom right (context: Jump / Fly / Rise / Descend / Handbrake / Camera / Interact),
 *    pause and a drawer with Transit, Map, Quests, Radio, Chat, Online and Settings top right.
 * Every pointer is tracked by id, so moving, looking and pressing a button work at the same time.
 * Per-frame input never touches React state: it goes straight to the controller.
 */
export interface TouchControlsProps {
  controller: RefObject<CityController | null>;
  snapshot: CitySnapshot;
  online: boolean;
  radioOpen: boolean;
  onPause: () => void;
  onTransit: () => void;
  onMap: () => void;
  onQuests: () => void;
  onRadio: () => void;
  /** RPG UI: inventory & character screen (omitted until the RPG layer runs). */
  onInventory?: () => void;
  onOnline: () => void;
  onSettings: () => void;
}

const STICK_RADIUS = 56;        // CSS px of travel for full speed
const SPRINT_PUSH = 1.3;        // x radius: past the ring = sprint / boost
const FOLLOW = 2.1;             // x radius: beyond this the stick base follows the thumb
const DEAD_ZONE = 0.12;
const LOOK_GAIN = 3.2;          // swipe px -> mouse px (the engine applies Look sensitivity)
const PITCH_SCALE = 0.8;

type Hold = "jump" | "up" | "down" | "handbrake";

export function TouchControls(props: TouchControlsProps) {
  const { controller, snapshot, online, radioOpen } = props;
  const prefs = useTouchPrefs();
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  const [drawer, setDrawer] = useState(false);
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const stick = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const mode = snapshot.mode;

  // Releasing everything when the controls unmount (pause, map, dialogue) stops the player.
  // Held buttons too: their pointerup never arrives once the button is gone (e.g. Rise held while the other
  // thumb opens the map, which keeps the city running), so the engine would keep rising / braking.
  useEffect(() => () => {
    const city = controller.current;
    city?.setTouchMovement(0, 0, false);
    for (const action of ["up", "down", "handbrake"] as const) city?.action(action, false);
  }, [controller]);

  // ---- joystick ----
  function placeStick(ox: number, oy: number, kx: number, ky: number, sprint: boolean): void {
    const base = stickRef.current, knob = knobRef.current;
    if (!base || !knob) return;
    base.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
    base.dataset.active = "true";
    base.dataset.sprint = String(sprint);
    knob.style.transform = `translate3d(${kx}px, ${ky}px, 0)`;
  }
  function releaseStick(): void {
    stick.current = null;
    const base = stickRef.current, knob = knobRef.current;
    if (base) { base.dataset.active = "false"; base.dataset.sprint = "false"; base.style.transform = ""; }
    if (knob) knob.style.transform = "";
    controller.current?.setTouchMovement(0, 0, false);
  }
  function moveStick(x: number, y: number): void {
    const s = stick.current;
    if (!s) return;
    let dx = x - s.ox, dy = y - s.oy, length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS * FOLLOW) { // the base trails the thumb, so a long drag never "runs out"
      const k = (length - STICK_RADIUS * FOLLOW) / length;
      s.ox += dx * k; s.oy += dy * k; dx = x - s.ox; dy = y - s.oy; length = Math.hypot(dx, dy);
    }
    const sprint = length > STICK_RADIUS * SPRINT_PUSH;
    const m = Math.min(1, length / STICK_RADIUS);
    const shaped = m < DEAD_ZONE ? 0 : Math.pow((m - DEAD_ZONE) / (1 - DEAD_ZONE), 1.25);
    const nx = length > 0 ? dx / length : 0, ny = length > 0 ? dy / length : 0;
    const knob = Math.min(length, STICK_RADIUS);
    placeStick(s.ox, s.oy, nx * knob, ny * knob, sprint);
    controller.current?.setTouchMovement(-ny * shaped, nx * shaped, sprint && shaped > 0.5);
  }
  function onMoveDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (stick.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const zone = event.currentTarget.getBoundingClientRect(), margin = STICK_RADIUS + 10;
    // The base appears under the thumb, kept far enough from the edges that the full ring fits.
    const ox = Math.max(zone.left + margin, Math.min(zone.right - margin, event.clientX));
    const oy = Math.max(zone.top + margin, Math.min(zone.bottom - margin, event.clientY));
    stick.current = { id: event.pointerId, ox, oy };
    moveStick(event.clientX, event.clientY);
  }
  function onMoveMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (stick.current?.id === event.pointerId) moveStick(event.clientX, event.clientY);
  }
  function onMoveUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (stick.current?.id === event.pointerId) releaseStick();
  }

  // ---- swipe to look ----
  function onLookDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (look.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    look.current = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp };
  }
  function onLookMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const l = look.current;
    if (!l || l.id !== event.pointerId) return;
    const dx = event.clientX - l.x, dy = event.clientY - l.y, dt = Math.max(1, event.timeStamp - l.t);
    l.x = event.clientX; l.y = event.clientY; l.t = event.timeStamp;
    const { lookAccel, lookSpeed } = prefsRef.current;
    // Precise when slow, up to 2.2x for flicks (px per ms), so a flick can turn around.
    const speed = Math.hypot(dx, dy) / dt;
    const accel = lookAccel ? 1 + 1.2 * Math.min(1, Math.max(0, (speed - 0.25) / 1.6)) : 1;
    const gain = LOOK_GAIN * lookSpeed * accel;
    controller.current?.look(dx * gain, dy * gain * PITCH_SCALE);
  }
  function onLookUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (look.current?.id === event.pointerId) look.current = null;
  }

  // ---- gyro aim (devicemotion rotation rate, mapped to the current screen orientation) ----
  useEffect(() => {
    if (!prefs.gyro) return;
    let last = 0;
    const handle = (event: DeviceMotionEvent) => {
      const rate = event.rotationRate;
      const now = performance.now(), dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (!rate || !dt || rate.beta === null || rate.gamma === null) return;
      const angle = screen.orientation?.angle ?? 0;
      // Degrees/s about the device axes -> yaw (turn) and pitch (tilt) of the camera.
      const beta = rate.beta, gamma = rate.gamma;
      const [yaw, pitch] = angle === 90 ? [-beta, gamma] : angle === 270 ? [beta, -gamma] : angle === 180 ? [gamma, beta] : [-gamma, -beta];
      const toPx = (Math.PI / 180) * dt / 0.00165; // radians -> the engine's mouse units
      controller.current?.look(yaw * toPx, pitch * toPx);
    };
    window.addEventListener("devicemotion", handle);
    return () => window.removeEventListener("devicemotion", handle);
  }, [prefs.gyro, controller]);

  // ---- buttons ----
  const hold = (action: Hold) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.pressed = "true"; controller.current?.action(action, true); },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => { event.currentTarget.dataset.pressed = "false"; controller.current?.action(action, false); },
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => { event.currentTarget.dataset.pressed = "false"; controller.current?.action(action, false); },
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
  });
  // Taps fire on pointerdown (no 300 ms, no lost taps while the other thumb moves).
  const tap = (run: () => void) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => { event.preventDefault(); run(); },
    onClick: (event: ReactMouseEvent) => { if (event.detail === 0) run(); }, // keyboard / assistive activation
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
  });
  const interaction = snapshot.mode === "walk" && snapshot.rpg?.prompt && (!snapshot.interaction || snapshot.interaction === "Take lift to the platform") ? snapshot.rpg.prompt : snapshot.interaction;
  const canInteract = !!interaction && !interaction.startsWith("Walk") && interaction !== "Lift in motion" && interaction !== "Finish combat before entering" && !interaction.startsWith("Slow down");
  const riding = mode === "taxi" || mode === "sky";
  const menu = (label: string, glyph: string, run: () => void, extra?: { pressed?: boolean; hidden?: boolean }) => extra?.hidden ? null
    : <button type="button" aria-pressed={extra?.pressed} onClick={() => { setDrawer(false); run(); }}><span aria-hidden="true">{glyph}</span>{label}</button>;

  return <div className={styles.layer} data-touch-controls data-mode={mode}>
    <div className={styles.moveZone} data-touch-zone="move" onPointerDown={onMoveDown} onPointerMove={onMoveMove} onPointerUp={onMoveUp} onPointerCancel={onMoveUp} onLostPointerCapture={onMoveUp} />
    <div className={styles.lookZone} data-touch-zone="look" onPointerDown={onLookDown} onPointerMove={onLookMove} onPointerUp={onLookUp} onPointerCancel={onLookUp} onLostPointerCapture={onLookUp} />
    <div className={styles.stickHint} aria-hidden="true"><span />{mode === "drive" ? "steer · gas / brake" : "move"}</div>
    <div ref={stickRef} className={styles.stick} data-active="false" data-sprint="false" aria-hidden="true">
      <span className={styles.ring} /><span ref={knobRef} className={styles.knob} />
    </div>

    <div className={styles.top}>
      <button type="button" className={styles.round} data-touch-action="pause" aria-label="Pause" {...tap(props.onPause)}>❚❚</button>
      <button type="button" className={styles.round} data-touch-action="menu" aria-label="Menu" aria-expanded={drawer} {...tap(() => setDrawer((open) => !open))}>{drawer ? "×" : "≡"}</button>
    </div>
    {drawer ? <nav className={styles.drawer} data-touch-drawer aria-label="City menu">
      {menu("Map", "⌖", props.onMap)}
      {menu("Transit", "↗", props.onTransit)}
      {menu("Quests", "◆", props.onQuests)}
      {props.onInventory ? menu("Inventory", "#", props.onInventory) : null}{/* RPG UI */}
      {menu(radioOpen ? "Hide radio" : "Radio", "♪", props.onRadio, { pressed: radioOpen })}
      {menu("Chat", "›", () => window.dispatchEvent(new Event("nightfall:chat-open")), { hidden: !online })}
      {menu("Online", "◉", props.onOnline)}
      {menu("Settings", "☷", props.onSettings)}
    </nav> : null}

    <div className={styles.actions} data-mode={mode}>
      {canInteract ? <button type="button" className={styles.interact} data-touch-action="interact" {...tap(() => controller.current?.interact())}><b>E</b><span>{interaction}</span></button>
        : interaction ? <span className={styles.hint}>{interaction}</span> : null}
      {riding ? <button type="button" className={styles.pill} data-touch-action="exit" {...tap(() => controller.current?.setMode("walk"))}>Exit ride</button> : null}
      {mode === "walk" ? <>
        <button type="button" className={styles.small} data-touch-action="fly" {...tap(() => controller.current?.setMode("fly"))}>Fly</button>
        <button type="button" className={styles.big} data-touch-action="jump" {...hold("jump")}>Jump</button>
      </> : null}
      {mode === "fly" ? <>
        <button type="button" className={styles.small} data-touch-action="land" {...tap(() => controller.current?.setMode("walk"))}>Land</button>
        <div className={styles.column}>
          <button type="button" className={styles.medium} data-touch-action="rise" {...hold("up")}>Rise</button>
          <button type="button" className={styles.medium} data-touch-action="descend" {...hold("down")}>Down</button>
        </div>
      </> : null}
      {mode === "drive" ? <>
        <button type="button" className={styles.small} data-touch-action="camera" {...tap(() => { controller.current?.action("camera", true); })}>Cam</button>
        <button type="button" className={styles.big} data-touch-action="handbrake" {...hold("handbrake")}>Brake</button>
      </> : null}
    </div>
  </div>;
}

/** Portrait on a phone: a gentle, dismissible nudge toward landscape (never blocks play). */
export function RotateHint(): ReactNode {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setDismissed(true), 9000); return () => clearTimeout(timer); }, []);
  if (dismissed) return null;
  return <button type="button" className={styles.rotate} onClick={() => setDismissed(true)} aria-label="Dismiss: rotate to landscape for the widest view">
    <span aria-hidden="true">⟲</span>Rotate for the widest view<small>×</small>
  </button>;
}
