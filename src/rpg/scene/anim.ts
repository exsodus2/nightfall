// Pure timing maths for the RPG's visuals: hit flashes, attack phases, gait tracking, the death
// dissolve, damage-number ramps and HUD bars. No textmode, no DOM - unit-tested in
// tests/rpg-scene.test.ts. Comfort rules live here as numbers: nothing blinks faster than ~3 Hz,
// flashes hold then fade (repeated hits keep them lit instead of strobing).
import type { EnemyView } from "../types.ts";
import { RAMP, clamp01, hash3, hashString, smooth } from "./palette.ts";

// ---- Hit flash ----------------------------------------------------------------------------------
/** Seconds a hit flash holds at full strength, then fades over HIT_FADE. */
export const HIT_HOLD = 0.08, HIT_FADE = 0.12;
/** 0..1 hit-flash strength for `hitAge` seconds since the last hit (Infinity = never hit). A hold
 * then a fade: rapid hits (automatic fire) keep it lit steadily instead of strobing. */
export function hitFlash(hitAge: number): number {
  if (!(hitAge >= 0) || hitAge === Infinity) return 0;
  if (hitAge < HIT_HOLD) return 1;
  return clamp01(1 - (hitAge - HIT_HOLD) / HIT_FADE);
}

// ---- Telegraph pulse ------------------------------------------------------------------------------
/** Telegraph "!" pulse rate (Hz): a smooth brightness swell, never a hard on/off blink. */
export const TELEGRAPH_HZ = 2;
/** 0.55..1 brightness of the warning glyph at `time`. */
export const telegraphPulse = (time: number): number => 0.775 + 0.225 * Math.sin(time * Math.PI * 2 * TELEGRAPH_HZ);

// ---- Death dissolve -------------------------------------------------------------------------------
/** Seconds the de-rasterise takes (collapse, then characters scatter, fall and fade). */
export const DEATH_TIME = 1.2;
/** Phase split: body collapses until DEATH_COLLAPSE, then only the scattered characters remain. */
export const DEATH_COLLAPSE = 0.32;
export interface DeathParticle { x: number; y: number; z: number; glyph: string; fade: number; size: number }
/** Deterministic scatter of a dead figure's characters (local frame of the figure, y up):
 * `count` cells start on the body volume, burst outward, fall with a bounce, and cool through the
 * density ramp while dimming. Returns [] once the dissolve is over. */
export function deathParticles(id: string, deathAge: number, scale: number, count: number, out: DeathParticle[] = []): DeathParticle[] {
  // `out` doubles as an object pool: entries are overwritten in place (copy them if you keep them).
  let n = 0;
  if (deathAge < 0 || deathAge >= DEATH_TIME) { out.length = 0; return out; }
  const seed = Math.floor(hashString(id) * 1e6);
  const start = DEATH_COLLAPSE * 0.6;
  const age = deathAge - start;
  if (age < 0) { out.length = 0; return out; }
  const life = DEATH_TIME - start;
  for (let i = 0; i < count; i++) {
    const r = (s: number) => hash3(seed, i, s);
    const delay = r(1) * 0.18, a = age - delay;
    if (a < 0) continue;
    const u = clamp01(a / (life - delay));
    // Start somewhere on the (collapsing) body: height 0.3..2.3 m, slightly flattened already.
    const h0 = (0.3 + r(2) * 2.0) * scale * (1 - 0.35 * smooth(0, DEATH_COLLAPSE, deathAge));
    const angle = r(3) * Math.PI * 2, out0 = r(4) * 0.35 * scale;
    const burst = (0.4 + r(5) * 1.3) * scale, lift = 0.3 + r(6) * 1.6;
    let y = h0 + lift * a - 3.2 * a * a;
    if (y < 0.04) y = 0.04 + Math.abs(y) * 0.06;
    const spread = out0 + burst * a * (y <= 0.1 ? 0.7 : 1);
    const k = Math.min(RAMP.length - 1, Math.floor(u * RAMP.length));
    const q = out[n] ?? (out[n] = { x: 0, y: 0, z: 0, glyph: "", fade: 0, size: 0 });
    q.x = Math.cos(angle) * spread; q.y = y; q.z = Math.sin(angle) * spread; q.glyph = RAMP[k]; q.fade = 1 - u * u; q.size = 0.2 - 0.1 * u;
    n++;
  }
  out.length = n;
  return out;
}

// ---- Enemy motion tracking (gait from real movement, attack phase from the progress value) --------
interface Track { x: number; z: number; time: number; stride: number; speed: number; seen: number; windup: boolean; strikeFrom: number }
const tracks = new Map<string, Track>();
let trackFrame = 0;
/** Metres per full gait cycle (two steps) at walking pace. */
export const STRIDE = 1.6;
export interface EnemyMotion {
  /** Gait phase in radians (advances with distance actually moved). */
  stride: number;
  /** Smoothed ground speed m/s. */
  speed: number;
  /** 0 standing .. 1 walking .. 2 running (blend). */
  gait: number;
}
const motionOut: EnemyMotion = { stride: 0, speed: 0, gait: 0 };
/** Advances an enemy's gait (result object is reused: read it before the next call) from its movement since the previous call (same clock: unchanged, so a
 * second pass over the same frame is harmless). Jumps (spawn, teleport) don't animate. */
export function enemyMotion(e: EnemyView, time: number): EnemyMotion {
  let s = tracks.get(e.id);
  if (!s) { s = { x: e.x, z: e.z, time, stride: hashString(e.id) * 6.28, speed: 0, seen: trackFrame, windup: false, strikeFrom: 0 }; tracks.set(e.id, s); }
  const dt = time - s.time;
  if (dt > 0) {
    const moved = Math.hypot(e.x - s.x, e.z - s.z);
    const jump = moved > 14 * dt + 0.5;
    const v = jump ? s.speed : moved / dt;
    s.speed += (v - s.speed) * (1 - Math.exp(-dt * 8));
    if (!jump) s.stride += moved / STRIDE * Math.PI * 2 * (s.speed > 4.5 ? 0.8 : 1);
    s.x = e.x; s.z = e.z; s.time = time;
  } else if (dt < 0) { s.x = e.x; s.z = e.z; s.time = time; }
  s.seen = trackFrame;
  motionOut.gait = s.speed < 0.25 ? 0 : s.speed < 3.2 ? smooth(0.25, 1.4, s.speed) : 1 + smooth(3.2, 5.5, s.speed);
  motionOut.stride = s.stride; motionOut.speed = s.speed;
  return motionOut;
}
/** Call once per frame (drawEnemies does): forgets enemies not seen for ~10 s. */
export function endEnemyFrame(): void {
  trackFrame++;
  if (trackFrame % 600 === 0) for (const [id, s] of tracks) if (trackFrame - s.seen > 600) tracks.delete(id);
}

export type AttackStage = "none" | "windup" | "strike" | "recover";
export interface AttackPhase { stage: AttackStage; /** 0..1 within the stage */ k: number }
/** Fallback split of `attack` (0..1 over the whole attack) when the view has no `windup` flag. */
export const WINDUP_END = 0.55, STRIKE_END = 0.75;
/** Where an attacking enemy is in its attack. With `windup` present it defines the telegraph;
 * the strike + recovery then share the rest of the progress, whether `attack` restarts from 0 for
 * the swing or keeps counting from the end of the wind-up. */
export function attackPhase(e: EnemyView): AttackPhase {
  if (e.state !== "attack" || e.deathAge >= 0) { const s = tracks.get(e.id); if (s) s.windup = false; return { stage: "none", k: 0 }; }
  const a = clamp01(e.attack);
  if (e.windup === undefined) {
    if (a < WINDUP_END) return { stage: "windup", k: a / WINDUP_END };
    if (a < STRIKE_END) return { stage: "strike", k: (a - WINDUP_END) / (STRIKE_END - WINDUP_END) };
    return { stage: "recover", k: (a - STRIKE_END) / (1 - STRIKE_END) };
  }
  const s = tracks.get(e.id);
  if (e.windup) { if (s) s.windup = true; return { stage: "windup", k: a }; }
  if (s) {
    if (s.windup) { s.windup = false; s.strikeFrom = a > 0.5 ? a : 0; }
    if (a < s.strikeFrom) s.strikeFrom = 0;
  }
  const from = s?.strikeFrom ?? 0, k = clamp01((a - from) / Math.max(1e-3, 1 - from));
  return k < 0.4 ? { stage: "strike", k: k / 0.4 } : { stage: "recover", k: (k - 0.4) / 0.6 };
}

// ---- Damage numbers ---------------------------------------------------------------------------------
/** Seconds a floating damage number lives; it holds its digits, then dissolves through RAMP. */
export const NUMBER_LIFE = 1.1, NUMBER_HOLD = 0.5;
/** Height (m) the number has risen at `age` (ease-out). */
export const numberRise = (age: number, critical: boolean): number => (critical ? 1.1 : 0.85) * (1 - Math.pow(1 - clamp01(age / NUMBER_LIFE), 2.2));
/** Glyph shown for character `index` of a number at `age`: the character itself while it holds, then
 * successively sparser ramp characters (staggered along the number), null once gone. */
export function numberGlyph(age: number, index: number, ch: string): string | null {
  if (age < 0) return ch;
  if (age >= NUMBER_LIFE) return null;
  const t = (age - NUMBER_HOLD - index * 0.03) / (NUMBER_LIFE - NUMBER_HOLD - 0.1);
  if (t < 0) return ch;
  const k = Math.floor(t * RAMP.length);
  return k >= RAMP.length ? null : RAMP[k];
}
/** 0..1 brightness of a number at `age` (bright pop, steady, then fade with the ramp). */
export const numberGain = (age: number): number => age < 0.06 ? 1.25 : age < NUMBER_HOLD ? 1 : clamp01(1 - (age - NUMBER_HOLD) / (NUMBER_LIFE - NUMBER_HOLD)) * 0.8 + 0.2;

// ---- HUD bars -------------------------------------------------------------------------------------
/** "[#####-----]" style bar: `width` inner cells, filled in proportion (a sliver of health shows one cell). */
export function asciiBar(value: number, max: number, width: number, fill = "#", empty = "-"): string {
  const f = max > 0 ? clamp01(value / max) : 0;
  let n = Math.round(f * width);
  if (f > 0 && n === 0) n = 1;
  if (f < 1 && n === width) n = width - 1;
  return "[" + fill.repeat(n) + empty.repeat(width - n) + "]";
}
/** Wrap an angle to -PI..PI. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
