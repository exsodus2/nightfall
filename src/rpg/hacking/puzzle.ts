// The breach minigame: a square grid of two-glyph cells. Trace a path from the entry port (left
// edge) to the core (right edge) one cell at a time; every step must obey the tier's rule, ICE
// cells block (and spread on the harder tiers) and a trace meter fills with time. Mistakes cost
// trace time, never the run; stepping back onto the previous cell undoes a step for free.
//
// Pure and deterministic: createHack(seed, tier) always builds the same grid, every function
// returns a new state (React keeps it in a reducer and only renders it), and the planted solution
// is never blocked, so every grid is solvable.

import type { HackReport, HackTier } from "../types.ts";

export type HackRule = "share" | "chain";
export type HackDir = "up" | "down" | "left" | "right";
export type HackStatus = "running" | "success" | "failed" | "aborted";
export interface HackCell { readonly glyphs: string; readonly ice: boolean }
export interface HackTierSpec {
  size: number;
  rule: HackRule;
  /** Distinct glyphs on the grid (fewer: more legal moves). */
  alphabet: number;
  /** Seconds until the trace completes (before penalties). */
  window: number;
  /** Seconds added to the trace per mistake. */
  penalty: number;
  /** ICE cells at the start. */
  ice: number;
  /** Seconds between ICE spreads (0: ICE stays put). */
  spread: number;
  /** Shortest planted route (cells). */
  minRoute: number;
}

export const HACK_TIERS: Readonly<Record<HackTier, HackTierSpec>> = {
  easy: { size: 6, rule: "share", alphabet: 10, window: 45, penalty: 3, ice: 3, spread: 0, minRoute: 8 },
  medium: { size: 7, rule: "chain", alphabet: 6, window: 55, penalty: 4, ice: 5, spread: 5, minRoute: 10 },
  hard: { size: 8, rule: "chain", alphabet: 5, window: 60, penalty: 5, ice: 7, spread: 3, minRoute: 12 },
};
/** A Splice Deck in the pack widens the trace window by this factor. */
export const SPLICE_WINDOW = 1.35;
/** ICE never covers more than this share of the cells off the planted route. */
const ICE_CAP = 0.45;
const GLYPHS = "0123456789ABCDEF";

export interface HackEvent { kind: "step" | "back" | "mismatch" | "ice"; cell: number; serial: number }
export interface HackState {
  readonly tier: HackTier;
  readonly rule: HackRule;
  readonly size: number;
  readonly cells: readonly HackCell[];
  readonly entry: number;
  readonly core: number;
  /** The traced path, entry first; its last cell is the cursor. */
  readonly path: readonly number[];
  /** The planted route (kept open by the ICE; shown after a failed breach). */
  readonly solution: readonly number[];
  readonly window: number;
  readonly elapsed: number;
  /** Seconds of trace added by mistakes. */
  readonly penalty: number;
  readonly status: HackStatus;
  readonly mistakes: number;
  /** The last move, for feedback (serial increases with every event). */
  readonly event: HackEvent | null;
  readonly splice: boolean;
  /** ICE spreading: seconds between spreads, when the next one is due and the RNG state. */
  readonly spread: number;
  readonly nextSpread: number;
  readonly rng: number;
}

/** mulberry32: [value in 0..1, next state]. */
function mulberry(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

const row = (size: number, cell: number): number => Math.floor(cell / size);
const col = (size: number, cell: number): number => cell % size;
/** The cell one step from `cell` in `dir`, or -1 off the grid. */
export function stepCell(size: number, cell: number, dir: HackDir): number {
  const r = row(size, cell), c = col(size, cell);
  if (dir === "up") return r > 0 ? cell - size : -1;
  if (dir === "down") return r < size - 1 ? cell + size : -1;
  if (dir === "left") return c > 0 ? cell - 1 : -1;
  return c < size - 1 ? cell + 1 : -1;
}
export function neighbours(size: number, cell: number): number[] {
  const out: number[] = [];
  for (const dir of ["up", "down", "left", "right"] as const) { const next = stepCell(size, cell, dir); if (next >= 0) out.push(next); }
  return out;
}
export const adjacent = (size: number, a: number, b: number): boolean => Math.abs(row(size, a) - row(size, b)) + Math.abs(col(size, a) - col(size, b)) === 1;

/** Whether stepping from a cell showing `from` onto one showing `to` obeys `rule`. */
export function fits(rule: HackRule, from: string, to: string): boolean {
  if (rule === "chain") return to[0] === from[1];
  return to.includes(from[0]) || to.includes(from[1]);
}

/** A self-avoiding walk from the left edge to the right edge that never runs alongside itself
 * (no shortcut between its own cells), at least `minLength` cells long. */
function plantRoute(size: number, minLength: number, rand: () => number): number[] {
  const maxLength = size * 3;
  for (let attempt = 0; attempt < 400; attempt++) {
    const start = Math.floor(rand() * size) * size;
    const path = [start], used = new Set(path);
    let head = start;
    while (col(size, head) < size - 1 && path.length < maxLength) {
      const options = neighbours(size, head).filter(next => !used.has(next) && neighbours(size, next).every(n => n === head || !used.has(n)));
      if (!options.length) break;
      // Bias toward the core, with room to wander up and down.
      const weights = options.map(next => col(size, next) > col(size, head) ? 0.42 : col(size, next) < col(size, head) ? 0.1 : 0.48 / 2);
      let pick = rand() * weights.reduce((sum, w) => sum + w, 0), chosen = options[0];
      for (let i = 0; i < options.length; i++) { pick -= weights[i]; if (pick <= 0) { chosen = options[i]; break; } }
      path.push(chosen); used.add(chosen); head = chosen;
    }
    if (col(size, head) === size - 1 && path.length >= minLength) return path;
  }
  // Fallback (never seen in practice): a straight run along one row.
  const r = Math.floor(rand() * size);
  return Array.from({ length: size }, (_, c) => r * size + c);
}

/** Builds the grid for `seed` and `tier`. */
export function createHack(options: { seed: number; tier: HackTier; splice?: boolean }): HackState {
  const spec = HACK_TIERS[options.tier];
  let state = (options.seed >>> 0) || 0x9e3779b9;
  const rand = (): number => { const [value, next] = mulberry(state); state = next; return value; };
  const size = spec.size;
  const pool = [...GLYPHS];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const alphabet = pool.slice(0, spec.alphabet);
  const glyph = (): string => alphabet[Math.floor(rand() * alphabet.length)];
  const solution = plantRoute(size, spec.minRoute, rand);
  // The route's glyph chain a0 a1 ... aL: cell i shows (a_i, a_i+1), so consecutive cells link
  // (chain) and share a glyph (share; shuffled so the shared one is not always in front).
  const links: string[] = [glyph()];
  for (let i = 0; i < solution.length; i++) { let next = glyph(); while (next === links[i]) next = glyph(); links.push(next); }
  const cells: HackCell[] = Array.from({ length: size * size }, () => ({ glyphs: glyph() + glyph(), ice: false }));
  solution.forEach((cell, i) => {
    const pair = links[i] + links[i + 1];
    cells[cell] = { glyphs: spec.rule === "share" && rand() < 0.5 ? pair[1] + pair[0] : pair, ice: false };
  });
  const onRoute = new Set(solution);
  const free = cells.map((_, i) => i).filter(i => !onRoute.has(i));
  for (let k = 0; k < spec.ice && free.length; k++) {
    const at = Math.floor(rand() * free.length);
    cells[free[at]] = { ...cells[free[at]], ice: true };
    free.splice(at, 1);
  }
  return {
    tier: options.tier, rule: spec.rule, size, cells, entry: solution[0], core: solution[solution.length - 1], path: [solution[0]], solution,
    window: spec.window * (options.splice ? SPLICE_WINDOW : 1), elapsed: 0, penalty: 0, status: "running", mistakes: 0, event: null,
    splice: !!options.splice, spread: spec.spread, nextSpread: spec.spread, rng: state,
  };
}

/** How full the trace meter is, 0..1 (1 = traced: the breach failed). */
export const hackTrace = (state: HackState): number => Math.min(1, Math.max(0, (state.elapsed + state.penalty) / state.window));
/** Seconds left before the trace completes. */
export const hackTimeLeft = (state: HackState): number => Math.max(0, state.window - state.elapsed - state.penalty);
export const hackHead = (state: HackState): number => state.path[state.path.length - 1];

const event = (state: HackState, kind: HackEvent["kind"], cell: number): HackEvent => ({ kind, cell, serial: (state.event?.serial ?? 0) + 1 });

function mistake(state: HackState, kind: "mismatch" | "ice", cell: number): HackState {
  const next: HackState = { ...state, penalty: state.penalty + HACK_TIERS[state.tier].penalty, mistakes: state.mistakes + 1, event: event(state, kind, cell) };
  return hackTrace(next) >= 1 ? { ...next, status: "failed" } : next;
}

/** Tries to move the cursor onto `target` (adjacent to the cursor). */
function enter(state: HackState, target: number): HackState {
  const path = state.path, head = hackHead(state);
  if (path.length > 1 && target === path[path.length - 2]) return { ...state, path: path.slice(0, -1), event: event(state, "back", head) };
  if (path.includes(target)) return state; // the trace never crosses itself
  const cell = state.cells[target];
  if (cell.ice) return mistake(state, "ice", target);
  if (!fits(state.rule, state.cells[head].glyphs, cell.glyphs)) return mistake(state, "mismatch", target);
  return { ...state, path: [...path, target], event: event(state, "step", target), status: target === state.core ? "success" : state.status };
}

/** Arrow keys / WASD. */
export function hackMove(state: HackState, dir: HackDir): HackState {
  if (state.status !== "running") return state;
  const target = stepCell(state.size, hackHead(state), dir);
  return target < 0 ? state : enter(state, target);
}
/** Tap on a cell: a neighbour of the cursor moves there (the previous cell steps back). */
export function hackTap(state: HackState, cell: number): HackState {
  if (state.status !== "running" || !(cell >= 0 && cell < state.cells.length) || !adjacent(state.size, hackHead(state), cell)) return state;
  return enter(state, cell);
}
/** Backspace: one step back (free). */
export function hackUndo(state: HackState): HackState {
  if (state.status !== "running" || state.path.length < 2) return state;
  return { ...state, path: state.path.slice(0, -1), event: event(state, "back", hackHead(state)) };
}
/** Esc. */
export function hackAbort(state: HackState): HackState {
  return state.status === "running" ? { ...state, status: "aborted" } : state;
}

/** One ICE cell grows into a free neighbour (never onto the planted route, the trace or the core). */
function spreadIce(state: HackState): HackState {
  const blocked = new Set([...state.solution, ...state.path]);
  const iced = state.cells.reduce((n, c) => n + (c.ice ? 1 : 0), 0);
  let rng = state.rng;
  const next = { ...state, nextSpread: state.nextSpread + state.spread };
  if (iced >= Math.floor((state.cells.length - state.solution.length) * ICE_CAP)) return next;
  const candidates: number[] = [];
  state.cells.forEach((cell, i) => { if (!cell.ice && !blocked.has(i) && neighbours(state.size, i).some(n => state.cells[n].ice)) candidates.push(i); });
  if (!candidates.length) return next;
  const [roll, after] = mulberry(rng);
  rng = after;
  const pick = candidates[Math.floor(roll * candidates.length)];
  const cells = state.cells.slice();
  cells[pick] = { ...cells[pick], ice: true };
  return { ...next, cells, rng };
}

/** Advances the clock: the trace fills and ICE spreads. Large steps (a hidden tab) are clamped. */
export function hackTick(state: HackState, dt: number): HackState {
  if (state.status !== "running" || !(dt > 0)) return state;
  let next: HackState = { ...state, elapsed: state.elapsed + Math.min(dt, 0.5) };
  while (next.spread > 0 && next.elapsed >= next.nextSpread) next = spreadIce(next);
  return hackTrace(next) >= 1 ? { ...next, status: "failed" } : next;
}

/** What the session needs once the run is over (null while running). */
export function hackReport(state: HackState): HackReport | null {
  if (state.status === "running") return null;
  return { outcome: state.status, trace: hackTrace(state), elapsed: state.elapsed, mistakes: state.mistakes };
}

/** The tier's rule in one plain sentence. */
export function hackRuleText(rule: HackRule): string {
  return rule === "chain" ? "Each cell must start with the glyph the last one ended with." : "Each step must share a glyph with the cell you are on.";
}
/** The next move spelled out for the cursor's cell. */
export function hackHint(state: HackState): string {
  const glyphs = state.cells[hackHead(state)].glyphs;
  if (state.rule === "chain") return `Next: a cell starting with ${glyphs[1]}`;
  return glyphs[0] === glyphs[1] ? `Next: a cell with ${glyphs[0]}` : `Next: a cell with ${glyphs[0]} or ${glyphs[1]}`;
}
