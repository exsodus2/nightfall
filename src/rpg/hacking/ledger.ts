// The hacking economy and its memory: lockouts, ATM payouts with diminishing returns and a
// per-night cap, door back rooms that restock, and whether a breach raised the alarm. Keyed by
// target id on the ledger's own clock (seconds of play, saved with it), so lockouts survive a
// reload. Pure: the session feeds it time and reports and applies what it decides.

import type { HackReport, HackSpec, HackTier } from "../types.ts";

/** localStorage key, beside the RPG save (rpg/items/save.ts SAVE_KEY). */
export const HACK_SAVE_KEY = "nightfall.hacking.v1";
/** One "night" of the per-night cap: half an hour of play. */
export const NIGHT_SECONDS = 1800;
/** Credits ATMs pay out per night, all machines together. */
export const ATM_NIGHT_CAP = 900;
/** A failed breach locks the target this long. */
export const LOCKOUT_SECONDS = 300;
/** Pulling out (Esc) cools the port this long. */
export const ABORT_LOCK_SECONDS = 20;
/** An ATM hacked again within this window pays half for each recent hit. */
export const DIMINISH_SECONDS = 600;
/** A breached back room has something in it again after this long. */
export const RESTOCK_SECONDS = 2700;
/** A breach that finishes with the trace this full still trips the alarm. */
export const SLOW_TRACE = 0.8;
/** ATM float by district (Foundry, Neon Ward, Ghost Circuit, Rain Gardens, Silk Market, Spillway). */
export const ATM_BASE: readonly number[] = [70, 150, 180, 90, 110, 40];
export const ATM_MIN = 40, ATM_MAX = 180;

export interface HackTarget { id: string; kind: HackSpec["kind"]; tier: HackTier; district: number }
export interface HackSettlement {
  outcome: HackReport["outcome"];
  credits: number;
  /** Loot table for the back room (doors), rolled by the session. */
  loot: string | null;
  /** Data shards found (doors). */
  shards: number;
  alarm: boolean;
  /** Seconds the target is now locked (0: free). */
  lock: number;
  title: string;
  lines: string[];
}
interface TargetRecord { lock?: number; hits?: number[]; looted?: number }
interface LedgerData { version: 1; clock: number; earned: number; night: number; targets: Record<string, TargetRecord> }

/** Back-room loot tables (rpg/content/hacking-targets.ts registers them). */
export const BACKROOM_TABLE = "hack.backroom", VAULT_TABLE = "hack.vault";

const clockText = (seconds: number): string => {
  const s = Math.ceil(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s`;
};
export { clockText as hackClockText };

export class HackLedger {
  /** Seconds of play the ledger has seen. */
  clock = 0;
  /** ATM credits paid out this night. */
  earned = 0;
  night = 0;
  private readonly targets = new Map<string, TargetRecord>();

  static parse(text: string | null): HackLedger {
    const ledger = new HackLedger();
    if (!text) return ledger;
    try {
      const data = JSON.parse(text) as Partial<LedgerData> | null;
      if (!data || data.version !== 1) return ledger;
      if (Number.isFinite(data.clock) && (data.clock ?? 0) >= 0) ledger.clock = data.clock ?? 0;
      ledger.night = Math.floor(ledger.clock / NIGHT_SECONDS);
      if (data.night === ledger.night && Number.isFinite(data.earned)) ledger.earned = Math.max(0, data.earned ?? 0);
      for (const [id, raw] of Object.entries(data.targets ?? {})) {
        if (!raw || typeof raw !== "object") continue;
        const record: TargetRecord = {};
        if (Number.isFinite(raw.lock)) record.lock = raw.lock;
        if (Number.isFinite(raw.looted)) record.looted = raw.looted;
        if (Array.isArray(raw.hits)) record.hits = raw.hits.filter(t => Number.isFinite(t)).slice(-8);
        ledger.targets.set(id, record);
      }
    } catch { /* a broken ledger starts fresh */ }
    return ledger;
  }
  serialize(): string {
    // Only what still matters: running locks, recent hits, back rooms still restocking.
    const targets: Record<string, TargetRecord> = {};
    for (const [id, record] of this.targets) {
      const keep: TargetRecord = {};
      if ((record.lock ?? 0) > this.clock) keep.lock = record.lock;
      const hits = record.hits?.filter(t => this.clock - t < DIMINISH_SECONDS);
      if (hits?.length) keep.hits = hits;
      if (record.looted !== undefined && this.clock - record.looted < RESTOCK_SECONDS) keep.looted = record.looted;
      if (Object.keys(keep).length) targets[id] = keep;
    }
    const data: LedgerData = { version: 1, clock: this.clock, earned: this.earned, night: this.night, targets };
    return JSON.stringify(data);
  }

  tick(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.clock += dt;
    const night = Math.floor(this.clock / NIGHT_SECONDS);
    if (night !== this.night) { this.night = night; this.earned = 0; }
  }

  private record(id: string): TargetRecord {
    let record = this.targets.get(id);
    if (!record) { record = {}; this.targets.set(id, record); }
    return record;
  }
  lockRemaining(id: string): number { return Math.max(0, (this.targets.get(id)?.lock ?? 0) - this.clock); }
  lock(id: string, seconds: number): void { if (seconds > 0) this.record(id).lock = this.clock + seconds; }
  /** Seconds until a breached back room has anything in it again (0: ready). */
  restockRemaining(id: string): number {
    const looted = this.targets.get(id)?.looted;
    return looted === undefined ? 0 : Math.max(0, looted + RESTOCK_SECONDS - this.clock);
  }
  /** ATM hits on `id` within the diminishing window. */
  recentHits(id: string): number { return this.targets.get(id)?.hits?.filter(t => this.clock - t < DIMINISH_SECONDS).length ?? 0; }

  /** Why the target cannot be hacked right now, or null when it can (the E prompt and the feed say it). */
  blocked(target: Pick<HackTarget, "id" | "kind">): string | null {
    const lock = this.lockRemaining(target.id);
    if (lock > 0) return `Locked out (${clockText(lock)})`;
    if (target.kind === "door") { const wait = this.restockRemaining(target.id); if (wait > 0) return `Back room cleaned out (${clockText(wait)})`; }
    if (target.kind === "atm" && this.earned >= ATM_NIGHT_CAP) return "Card pattern flagged: ATMs pay again next night";
    return null;
  }

  /** What an ATM would pay now: its district's float (40-180 cr), halved per recent hit. */
  atmQuote(target: HackTarget, roll: number): number {
    const base = ATM_BASE[target.district] ?? 80;
    const full = Math.min(ATM_MAX, Math.max(ATM_MIN, Math.round(base * (0.85 + 0.3 * Math.min(1, Math.max(0, roll))))));
    return Math.round(full * 0.5 ** this.recentHits(target.id));
  }

  /** Settles a finished attempt: decides pay, loot, alarm and lockout, and remembers them. */
  settle(target: HackTarget, report: HackReport, roll: number): HackSettlement {
    const base = { outcome: report.outcome, credits: 0, loot: null, shards: 0, alarm: false, lock: 0 };
    if (report.outcome === "aborted") {
      this.lock(target.id, ABORT_LOCK_SECONDS);
      return { ...base, lock: ABORT_LOCK_SECONDS, title: "Disconnected", lines: [`You pulled the splice before the trace closed. The port cools for ${ABORT_LOCK_SECONDS} s.`] };
    }
    if (report.outcome === "failed") {
      this.lock(target.id, LOCKOUT_SECONDS);
      const what = target.kind === "atm" ? "The ATM blanked its screen and called it in." : target.kind === "door" ? "The door panel locked out and phoned home." : "The terminal dropped the session and logged your port.";
      return { ...base, alarm: true, lock: LOCKOUT_SECONDS, title: "Trace complete", lines: [what, `Locked for ${clockText(LOCKOUT_SECONDS)}.`] };
    }
    const alarm = report.trace >= SLOW_TRACE;
    const slow = alarm ? ["Too slow: the trace finished its handshake. Someone has your location."] : [];
    if (target.kind === "atm") {
      const hits = this.recentHits(target.id);
      const quote = this.atmQuote(target, roll);
      const credits = Math.max(0, Math.min(quote, ATM_NIGHT_CAP - this.earned));
      this.earned += credits;
      const record = this.record(target.id);
      record.hits = [...(record.hits ?? []), this.clock].slice(-8);
      const lines = [`${credits} cr dispensed.`];
      if (hits > 0) lines.push("This machine was emptied recently: it only had a partial float.");
      if (this.earned >= ATM_NIGHT_CAP) lines.push("The banks flagged tonight's pattern. ATMs pay again next night.");
      return { ...base, credits, alarm, title: "Access granted", lines: [...lines, ...slow] };
    }
    if (target.kind === "door") {
      this.record(target.id).looted = this.clock;
      const vault = target.tier === "hard";
      return { ...base, loot: vault ? VAULT_TABLE : BACKROOM_TABLE, shards: vault ? 2 : 1, alarm, title: vault ? "Corp vault open" : "Back room open", lines: [vault ? "The service terminal folds. Behind it: a cage of company property." : "The lock clicks. Shelves, a strongbox and a rack of drives.", ...slow] };
    }
    return { ...base, alarm, title: "Access granted", lines: ["The terminal is yours.", ...slow] };
  }
}
