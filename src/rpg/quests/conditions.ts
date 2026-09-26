import type { Condition, Effect, FactionId, FlagValue, Point, QuestHost, QuestStatus } from "../types.ts";

// Pure condition / effect evaluation. The quest engine builds a context over its own state; content
// tests can hand in a tiny fake one, so every branch of a quest can be unit-tested without a world.

/** What a condition can learn about one quest. */
export interface QuestView { status: QuestStatus; /** Current (or last) stage, null if never started. */ stage: string | null; /** Every outcome ever reached. */ outcomes: readonly string[] }

/** Everything a condition may read. */
export interface ConditionContext {
  host: Pick<QuestHost, "count" | "creditBalance" | "level" | "reputation" | "encounterCleared">;
  flag(key: string): FlagValue | undefined;
  quest(id: string): QuestView;
  /** Extra encounter-cleared memory (the engine remembers `encounterCleared` events). */
  cleared?(id: string): boolean;
  /** Display names used by `unmetReason`. */
  names?: { item?(id: string): string | undefined; quest?(id: string): string | undefined; faction?(id: FactionId): string | undefined };
}

/** Everything an effect may do. The quest hooks are optional so content tests can stub only what they use. */
export interface EffectContext extends ConditionContext {
  host: QuestHost;
  setFlag(key: string, value: FlagValue): void;
  startQuest?(id: string): void;
  /** `ref` is "stage" (the context quest) or "quest:stage". */
  setStage?(ref: string): void;
  /** `ref` is "outcome" (the context quest) or "quest:outcome". */
  setOutcome?(ref: string): void;
  failQuest?(id: string): void;
  openDialogue?(id: string, node?: string): void;
  /** Routes `message` effects (default: host.message). */
  message?(text: string, tone?: "info" | "quest" | "loot" | "danger"): void;
  /** Routes `waypoint` effects (default: host.setWaypoint). */
  waypoint?(point: Point & { label: string }): void;
}

/** Truthiness of a flag for bare `{ flag }` conditions: unset, false, 0 and "" are off. */
export function flagOn(value: FlagValue | undefined): boolean {
  return value !== undefined && value !== false && value !== 0 && value !== "";
}
function flagNumber(value: FlagValue | undefined): number {
  return typeof value === "number" ? value : value === true ? 1 : 0;
}

/** Splits "quest:id" references; a bare id belongs to `context` (may be null). */
export function splitRef(ref: string, context: string | null): { quest: string | null; id: string } {
  const at = ref.indexOf(":");
  return at < 0 ? { quest: context, id: ref } : { quest: ref.slice(0, at), id: ref.slice(at + 1) };
}

function statusList(condition: Extract<Condition, { quest: string }>): readonly QuestStatus[] | null {
  if (condition.status !== undefined) return typeof condition.status === "string" ? [condition.status] : condition.status;
  // A bare `{ quest }` means "finished it"; stage/outcome checks carry their own meaning.
  return condition.stage === undefined && condition.outcome === undefined ? ["complete"] : null;
}

/** Evaluates a condition. `undefined` always holds.
 * - `{ flag }` alone: truthy; `is`: equals (`is: false` also matches unset); `atLeast`/`atMost`: numeric (unset = 0).
 * - `{ quest }` alone: complete. `stage`: the quest is in that stage (and active, unless `status` says otherwise).
 *   `outcome`: that outcome was ever reached. `status`: one of the listed statuses. */
export function evaluate(condition: Condition | undefined, ctx: ConditionContext): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every(c => evaluate(c, ctx));
  if ("any" in condition) return condition.any.some(c => evaluate(c, ctx));
  if ("not" in condition) return !evaluate(condition.not, ctx);
  if ("flag" in condition) {
    const value = ctx.flag(condition.flag);
    if (condition.is !== undefined) return condition.is === false ? !flagOn(value) : value === condition.is;
    if (condition.atLeast !== undefined || condition.atMost !== undefined) {
      const n = flagNumber(value);
      return (condition.atLeast === undefined || n >= condition.atLeast) && (condition.atMost === undefined || n <= condition.atMost);
    }
    return flagOn(value);
  }
  if ("quest" in condition) {
    const quest = ctx.quest(condition.quest);
    if (condition.outcome !== undefined && !quest.outcomes.includes(condition.outcome)) return false;
    if (condition.stage !== undefined && (quest.stage !== condition.stage || (condition.status === undefined && quest.status !== "active"))) return false;
    const statuses = statusList(condition);
    return !statuses || statuses.includes(quest.status);
  }
  if ("item" in condition) return ctx.host.count(condition.item) >= (condition.count ?? 1);
  if ("credits" in condition) return ctx.host.creditBalance >= condition.credits;
  if ("level" in condition) return ctx.host.level >= condition.level;
  if ("rep" in condition) {
    const rep = ctx.host.reputation(condition.rep);
    return (condition.atLeast === undefined || rep >= condition.atLeast) && (condition.atMost === undefined || rep <= condition.atMost);
  }
  if ("encounterCleared" in condition) return ctx.host.encounterCleared(condition.encounterCleared) || !!ctx.cleared?.(condition.encounterCleared);
  return false;
}

function factionName(id: FactionId, ctx: ConditionContext): string {
  return ctx.names?.faction?.(id) ?? id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** A short player-facing reason why a condition fails ("Requires level 5"), or null if it holds.
 * Flags are story-internal, so they only say "Not available yet" - give options a `reason` for better text. */
export function unmetReason(condition: Condition | undefined, ctx: ConditionContext): string | null {
  if (!condition || evaluate(condition, ctx)) return null;
  if ("all" in condition) {
    for (const c of condition.all) { const reason = unmetReason(c, ctx); if (reason) return reason; }
    return "Not available yet";
  }
  if ("any" in condition) {
    const reasons = [...new Set(condition.any.map(c => unmetReason(c, ctx)).filter((r): r is string => !!r))];
    return reasons.length ? reasons.slice(0, 2).join(" or ") : "Not available yet";
  }
  if ("item" in condition) {
    const name = ctx.names?.item?.(condition.item) ?? condition.item, need = condition.count ?? 1;
    return need > 1 ? `Requires ${name} (${ctx.host.count(condition.item)}/${need})` : `Requires ${name}`;
  }
  if ("credits" in condition) return `Requires ${condition.credits} cr`;
  if ("level" in condition) return `Requires level ${condition.level}`;
  if ("rep" in condition) {
    const name = factionName(condition.rep, ctx);
    return condition.atLeast !== undefined && ctx.host.reputation(condition.rep) < condition.atLeast
      ? `Requires ${name} reputation ${condition.atLeast}` : `${name} trust you too much for this`;
  }
  if ("quest" in condition) {
    const title = ctx.names?.quest?.(condition.quest) ?? condition.quest;
    if (condition.stage === undefined && condition.outcome === undefined && condition.status === undefined) return `Requires "${title}" completed`;
    return `Depends on "${title}"`;
  }
  if ("encounterCleared" in condition) return "The area isn't clear yet";
  return "Not available yet";
}

/** Applies effects in order through the context. Quest hooks missing from the context are skipped. */
export function applyEffects(effects: readonly Effect[] | undefined, ctx: EffectContext): void {
  for (const effect of effects ?? []) {
    if ("setFlag" in effect) ctx.setFlag(effect.setFlag, effect.value ?? true);
    else if ("addFlag" in effect) ctx.setFlag(effect.addFlag, flagNumber(ctx.flag(effect.addFlag)) + effect.by);
    else if ("give" in effect) ctx.host.give(effect.give, effect.count ?? 1);
    else if ("take" in effect) ctx.host.take(effect.take, effect.count ?? 1);
    else if ("credits" in effect) ctx.host.credits(effect.credits);
    else if ("xp" in effect) ctx.host.xp(effect.xp);
    else if ("rep" in effect) ctx.host.rep(effect.rep, effect.by);
    else if ("startQuest" in effect) ctx.startQuest?.(effect.startQuest);
    else if ("stage" in effect) ctx.setStage?.(effect.stage);
    else if ("outcome" in effect) ctx.setOutcome?.(effect.outcome);
    else if ("fail" in effect) ctx.failQuest?.(effect.fail);
    else if ("spawn" in effect) ctx.host.spawnEncounter(effect.spawn);
    else if ("despawn" in effect) ctx.host.despawnEncounter(effect.despawn);
    else if ("hostile" in effect) ctx.host.setHostile(effect.hostile, effect.value);
    else if ("waypoint" in effect) { if (ctx.waypoint) ctx.waypoint(effect.waypoint); else ctx.host.setWaypoint(effect.waypoint); }
    else if ("message" in effect) { if (ctx.message) ctx.message(effect.message, effect.tone); else ctx.host.message(effect.message, effect.tone); }
    else if ("openDialogue" in effect) ctx.openDialogue?.(effect.openDialogue, effect.node);
  }
}

/** Sum of `credits` effects (for reward hints and "+250 cr" toasts). */
export function creditsIn(effects: readonly Effect[] | undefined): number {
  let total = 0;
  for (const effect of effects ?? []) if ("credits" in effect) total += effect.credits;
  return total;
}
