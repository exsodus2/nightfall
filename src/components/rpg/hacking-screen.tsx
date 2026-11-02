"use client";

import { useEffect, useReducer, useRef, type CSSProperties } from "react";
import { HACK_TIERS, SPLICE_WINDOW, adjacent, createHack, hackAbort, hackHead, hackHint, hackMove, hackReport, hackRuleText, hackTap, hackTick, hackTimeLeft, hackTrace, hackUndo, type HackDir, type HackState } from "@/rpg/hacking/puzzle";
import type { HackView, RpgUiAction } from "@/rpg/types";
import { useModal } from "./use-modal";
import styles from "./rpg.module.css";

type Step = { type: "move"; dir: HackDir } | { type: "tap"; cell: number } | { type: "undo" } | { type: "tick"; dt: number } | { type: "abort" };
function reduce(state: HackState, step: Step): HackState {
  switch (step.type) {
    case "move": return hackMove(state, step.dir);
    case "tap": return hackTap(state, step.cell);
    case "undo": return hackUndo(state);
    case "tick": return hackTick(state, step.dt);
    case "abort": return hackAbort(state);
  }
}

const KEYS: Readonly<Record<string, HackDir>> = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
const TIER_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;
const BAR = 24;
const traceBar = (trace: number): string => { const filled = Math.round(trace * BAR); return `[${"#".repeat(filled)}${"-".repeat(BAR - filled)}]`; };

function statusLine(state: HackState): string {
  const spec = HACK_TIERS[state.tier];
  if (state.status === "success") return "Core reached. Closing the handshake...";
  if (state.status === "failed") return "Trace complete. The route you needed is marked.";
  switch (state.event?.kind) {
    case "mismatch": return `Wrong link: +${spec.penalty} s on the trace.`;
    case "ice": return `ICE: +${spec.penalty} s on the trace.`;
    case "back": return "Stepped back.";
    case "step": return `${state.path.length - 1} hop${state.path.length === 2 ? "" : "s"} in.`;
    default: return spec.spread ? `ICE spreads every ${spec.spread} s.` : "Trace a path from IN to the CORE.";
  }
}

interface HackingScreenProps {
  hack: HackView;
  act: (action: RpgUiAction) => void;
  /** Dismiss the result (closeHack). */
  onClose: () => void;
}

/**
 * The breach minigame while snapshot.rpg.hack is set. The puzzle itself is pure (rpg/hacking
 * puzzle.ts) and lives in a reducer here; this only renders it, feeds it keys, taps and time, and
 * reports the end to the session, whose settlement comes back as `hack.result`.
 * Keys: arrows / WASD move, Backspace steps back, Esc aborts (or closes the result), Enter closes.
 */
export function HackingScreen({ hack, act, onClose }: HackingScreenProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [state, dispatch] = useReducer(reduce, hack, (view: HackView) => createHack({ seed: view.seed, tier: view.tier, splice: view.splice }));
  const result = hack.result;
  const running = state.status === "running";
  useModal(dialogRef, () => { if (result) onClose(); else dispatch({ type: "abort" }); });

  // Time: the trace fills and ICE spreads while running (10 Hz is plenty for a meter).
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const timer = setInterval(() => { const now = performance.now(); dispatch({ type: "tick", dt: (now - last) / 1000 }); last = now; }, 100);
    return () => clearInterval(timer);
  }, [running]);

  // The end of the run goes to the session once.
  const sent = useRef(false);
  useEffect(() => {
    const report = hackReport(state);
    if (!report || sent.current) return;
    sent.current = true;
    act({ kind: "hackResult", attempt: hack.attempt, report });
  }, [state, act, hack.attempt]);

  // Keys (capture: the screen owns the keyboard while open; Esc and Tab stay with useModal).
  const live = useRef({ result, onClose });
  useEffect(() => { live.current = { result, onClose }; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
      event.stopImmediatePropagation();
      const dir = KEYS[event.code];
      if (dir) { event.preventDefault(); if (!event.repeat) dispatch({ type: "move", dir }); return; }
      if (event.code === "Backspace") { event.preventDefault(); dispatch({ type: "undo" }); return; }
      if ((event.code === "Enter" || event.code === "NumpadEnter" || event.code === "Space") && live.current.result) { event.preventDefault(); live.current.onClose(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  const size = state.size, head = hackHead(state), trace = hackTrace(state);
  const onPath = new Set(state.path), route = state.status === "failed" ? new Set(state.solution) : null;
  const previous = state.path.length > 1 ? state.path[state.path.length - 2] : -1;
  const hit = state.event && (state.event.kind === "mismatch" || state.event.kind === "ice") ? state.event : null;
  const tone = trace > 0.85 ? "danger" : trace > 0.6 ? "warn" : "calm";
  const headGlyphs = state.cells[head].glyphs;
  const close = () => { if (result) onClose(); else dispatch({ type: "abort" }); };

  return <div className={styles.overlay} data-rpg-screen="hacking">
    <section className={`${styles.frame} ${styles.hackFrame}`} role="dialog" aria-modal="true" aria-labelledby="rpg-hack-title" tabIndex={-1} ref={dialogRef}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Breach // {TIER_NAME[hack.tier]}</span>
          <h2 className={styles.title} id="rpg-hack-title">{hack.label}</h2>
        </div>
        {hack.splice ? <span className={styles.badge} title={`Splice Deck: the trace window is ${Math.round((SPLICE_WINDOW - 1) * 100)}% wider`}>SPLICE +{Math.round((SPLICE_WINDOW - 1) * 100)}%</span> : null}
        <p className={styles.hackTrace} data-tone={tone} role="meter" aria-label="Trace" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(trace * 100)}>
          <small>Trace</small><span className={styles.asciiBar}>{traceBar(trace)}</span><b>{Math.ceil(hackTimeLeft(state))} s</b>
        </p>
        <button type="button" className={styles.close} onClick={close} aria-label={result ? "Close" : "Abort the breach"}>{result ? "Close" : "Abort"} <span aria-hidden="true">×</span></button>
      </header>
      <div className={styles.hackBody}>
        <div className={styles.hackStage}>
          <div className={styles.hackGrid} style={{ "--size": size } as CSSProperties} data-status={state.status} role="grid" aria-label={`Breach grid, ${size} by ${size}`}>
            {Array.from({ length: size }, (_, r) => <div className={styles.hackRow} role="row" key={r}>
              <span className={styles.hackPort} aria-hidden="true">{state.entry === r * size ? "IN" : ""}</span>
              {Array.from({ length: size }, (_, c) => {
                const i = r * size + c, cell = state.cells[i], isHead = i === head;
                const near = running && adjacent(size, head, i) && (!onPath.has(i) || i === previous);
                return <button type="button" role="gridcell" tabIndex={-1} key={i} className={styles.hackCell}
                  data-ice={cell.ice} data-path={onPath.has(i)} data-head={isHead} data-core={i === state.core} data-entry={i === state.entry} data-near={near}
                  data-route={!!route?.has(i) && !onPath.has(i)} data-hit={hit?.cell === i}
                  aria-label={`${cell.ice ? "ICE" : cell.glyphs}${isHead ? ", cursor" : ""}${i === state.core ? ", core" : ""}${i === state.entry ? ", entry" : ""}`}
                  onClick={() => dispatch({ type: "tap", cell: i })}>
                  {cell.ice ? "##" : <><span data-key={isHead && state.rule === "share"}>{cell.glyphs[0]}</span><span data-key={isHead}>{cell.glyphs[1]}</span></>}
                </button>;
              })}
              <span className={styles.hackPort} aria-hidden="true">{state.core === r * size + size - 1 ? "CORE" : ""}</span>
            </div>)}
            {hit ? <span key={hit.serial} className={styles.hackWash} aria-hidden="true" /> : null}
          </div>
        </div>
        <aside className={styles.hackSide} aria-label="Breach status">
          {result ? <div className={styles.hackResult} data-outcome={result.outcome} role="status">
            <span className={styles.hackResultGlyph} aria-hidden="true">{result.outcome === "success" ? "[ OPEN ]" : "[ LOCKED ]"}</span>
            <h3>{result.title}</h3>
            <ul>{result.lines.map((line, k) => <li key={k}>{line}</li>)}</ul>
            {result.alarm ? <p className={styles.note} data-tone="warn">Alarm raised. Move on.</p> : null}
          </div> : <>
            <h3 className={styles.sectionTitle}>Rule</h3>
            <p className={styles.hackRule}>{hackRuleText(state.rule)}</p>
            <p className={styles.hackHint} aria-live="polite">{running ? hackHint(state) : state.status === "success" ? "Handshake..." : "Traced."}</p>
            <p className={styles.hackStatus} data-tone={hit ? "warn" : state.status === "failed" ? "danger" : "calm"}>{statusLine(state)}</p>
            <p className={styles.note}>On the cursor: <b className={styles.hackKeyGlyphs}>{headGlyphs}</b></p>
          </>}
          <ul className={styles.hackLegend} aria-label="Legend">
            <li><span className={styles.hackChip} data-chip="head">{headGlyphs}</span>cursor</li>
            <li><span className={styles.hackChip} data-chip="path">::</span>your trace</li>
            <li><span className={styles.hackChip} data-chip="ice">##</span>ICE: blocked{HACK_TIERS[hack.tier].spread ? ", spreads" : ""}</li>
            <li><span className={styles.hackChip} data-chip="core">{state.cells[state.core].glyphs}</span>core</li>
          </ul>
          {!result ? <div className={styles.hackButtons}>
            <button type="button" className={styles.action} disabled={!running || state.path.length < 2} onClick={() => dispatch({ type: "undo" })}>Step back</button>
            <button type="button" className={styles.action} disabled={!running} onClick={() => dispatch({ type: "abort" })}>Abort</button>
          </div> : null}
        </aside>
      </div>
      <footer className={styles.footer}>
        <span className={styles.keys} aria-hidden="true">
          <span><kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> / <kbd>WASD</kbd> move</span>
          <span><kbd>Backspace</kbd> step back</span>
          <span><kbd>Esc</kbd> {result ? "close" : "abort"}</span>
          <span>Mistakes cost trace time, never the run.</span>
        </span>
        {result ? <button type="button" className={styles.resume} onClick={onClose}>Done <span aria-hidden="true">↗</span></button> : null}
      </footer>
    </section>
  </div>;
}
