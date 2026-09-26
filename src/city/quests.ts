import { DISTRICTS } from "./world.ts";
import { NPCS, npcById, type NpcDefinition, type NpcQuestLines } from "./npcs.ts";

// UI contract: the engine emits these; the React layer renders them.
export interface NpcDialogueOption {
  id: string; label: string; kind: "accept" | "decline" | "complete" | "continue" | "leave";
  /** Why the option can't be chosen right now (shown greyed out); absent when available. */
  disabled?: string;
  /** A deterministic stat check behind the option: passes when value >= difficulty. */
  check?: { stat: "cool" | "tech" | "street"; value: number; difficulty: number };
}
export interface NpcDialogue { npcId: string; npcName: string; npcTitle: string; district: string; lines: string[]; options: NpcDialogueOption[] }
/** One line of a quest's objective checklist (rpg/quests QuestEngine). */
export interface QuestObjectiveView { text: string; done: boolean; optional: boolean }
export interface QuestLogEntry {
  id: string; title: string; status: "active" | "ready" | "complete" | "failed"; objective: string; targetDistrict: string; reward: number;
  /** Optional extras from the RPG quest engine (the legacy QuestBook leaves them out). */
  objectives?: QuestObjectiveView[];
  category?: string;
  /** Journal entries so far, oldest first. */
  journal?: string[];
  /** Seconds left on a timed stage. */
  timeLeft?: number;
}
export interface QuestSnapshot {
  credits: number; log: QuestLogEntry[]; nearbyNpc: { id: string; name: string } | null;
  tracked: { title: string; objective: string; targetX: number; targetZ: number; id?: string; objectives?: QuestObjectiveView[]; timeLeft?: number } | null;
}

/** One "talk to this NPC" step. Finishing the last step makes the quest ready to hand in. */
export interface QuestStep { npc: string; objective: string; action: string; update: string }
export interface QuestDefinition {
  id: string;
  title: string;
  giver: string;
  reward: number;
  /** Fallback offer text if the giver has no `offer` lines. */
  summary: string;
  steps: readonly QuestStep[];
  returnObjective: string;
  acceptLabel: string;
  declineLabel: string;
  completeLabel: string;
  /** Quests that must be complete before this one is offered. */
  requires?: readonly string[];
}
/** Floating marker above an NPC: a quest to offer, a step to finish here, or a hand-in. */
export type NpcMarker = "offer" | "objective" | "turn-in" | null;
export interface DialogueResult { dialogue: NpcDialogue | null; message: string | null }
interface Progress { status: "active" | "ready" | "complete"; step: number }
/** Multiplayer: the book's progress as plain data. The party server keeps the authoritative copy
 * and clients adopt it with `applyState` (src/multiplayer, server/). */
export interface QuestBookState { credits: number; progress: Readonly<Record<string, Readonly<Progress>>> }

export const QUESTS: readonly QuestDefinition[] = [
  {
    id: "relay-chip", title: "The Relay Chip", giver: "mara", reward: 250,
    summary: "Collect a sealed relay chip from Juno Reyes in Neon Ward and bring it back.",
    steps: [{ npc: "juno", objective: "Meet Juno Reyes under the Meridian Spire in Neon Ward", action: "Take the relay chip", update: "Relay chip collected" }],
    returnObjective: "Return the relay chip to Mara Voss in the Silk Market",
    acceptLabel: "I'll bring it back", declineLabel: "Not tonight", completeLabel: "Hand over the chip",
  },
];

const LEAVE: NpcDialogueOption = { id: "leave", label: "Leave", kind: "leave" };

/** Session quest state and dialogue resolution. No DOM or renderer: the engine asks it
 * what an NPC says and forwards the player's choices. Data-driven, so new quests and
 * NPCs need no engine changes. */
export class QuestBook {
  credits: number;
  readonly npcs: readonly NpcDefinition[];
  readonly quests: readonly QuestDefinition[];
  private readonly progress = new Map<string, Progress>();
  private open: NpcDialogue | null = null;
  private trackedId: string | null = null;

  // Plain fields, not parameter properties: tests run under Node's type stripping.
  constructor(npcs: readonly NpcDefinition[] = NPCS, quests: readonly QuestDefinition[] = QUESTS, credits = 0) {
    this.npcs = npcs; this.quests = quests; this.credits = credits;
  }

  status(questId: string): "available" | "locked" | Progress["status"] {
    const progress = this.progress.get(questId);
    if (progress) return progress.status;
    const quest = this.quest(questId);
    return quest && (quest.requires ?? []).every(id => this.progress.get(id)?.status === "complete") ? "available" : "locked";
  }
  get dialogue(): NpcDialogue | null { return this.open; }

  /** Opens a conversation. The highest-priority quest business with this NPC wins:
   * a hand-in, then a step to finish here, then an offer, then reminders and small talk. */
  talk(npcId: string): NpcDialogue | null {
    const npc = npcById(this.npcs, npcId);
    this.open = npc ? this.resolve(npc) : null;
    return this.open;
  }
  close(): void { this.open = null; }

  /** Applies an option of the open dialogue. Stale or unknown ids are ignored. */
  choose(optionId: string): DialogueResult {
    const current = this.open, option = current?.options.find(o => o.id === optionId);
    if (!current || !option) return { dialogue: current, message: null };
    const npc = npcById(this.npcs, current.npcId)!;
    const quest = this.quest(optionId.slice(optionId.indexOf(":") + 1));
    let lines: string[] | null = null, message: string | null = null;
    if (option.kind === "accept" && quest && this.status(quest.id) === "available" && quest.giver === npc.id) {
      this.progress.set(quest.id, { status: quest.steps.length ? "active" : "ready", step: 0 });
      this.trackedId = quest.id;
      lines = this.lines(npc, quest, "accepted") ?? [quest.steps[0]?.objective ?? quest.returnObjective];
      message = `Quest accepted: ${quest.title}`;
    } else if (option.kind === "continue" && quest && this.stepFor(npc, quest)) {
      const progress = this.progress.get(quest.id)!, step = quest.steps[progress.step];
      progress.step++;
      if (progress.step >= quest.steps.length) progress.status = "ready";
      lines = this.lines(npc, quest, "handover") ?? [this.objective(quest)];
      message = `${step.update}: ${this.objective(quest)}`;
    } else if (option.kind === "complete" && quest && quest.giver === npc.id && this.status(quest.id) === "ready") {
      this.progress.get(quest.id)!.status = "complete";
      this.credits += quest.reward;
      if (this.trackedId === quest.id) this.trackedId = null;
      lines = this.lines(npc, quest, "thanks") ?? ["Thank you."];
      message = `Quest complete: ${quest.title} · +${quest.reward} cr`;
    }
    // Accept, continue and complete answer with a closing line; decline and leave end it.
    this.open = lines ? { ...this.header(npc), lines, options: [LEAVE] } : null;
    return { dialogue: this.open, message };
  }

  marker(npcId: string): NpcMarker {
    let marker: NpcMarker = null;
    for (const quest of this.quests) {
      const status = this.status(quest.id);
      if (quest.giver === npcId && status === "ready") return "turn-in";
      if (status === "active" && quest.steps[this.progress.get(quest.id)!.step]?.npc === npcId) marker = "objective";
      else if (!marker && quest.giver === npcId && status === "available") marker = "offer";
    }
    return marker;
  }

  log(): QuestLogEntry[] {
    return [...this.progress].flatMap(([id, progress]) => {
      const quest = this.quest(id);
      if (!quest) return [];
      const target = this.target(quest);
      return [{ id, title: quest.title, status: progress.status, objective: progress.status === "complete" ? "Completed" : this.objective(quest), targetDistrict: target ? DISTRICTS[target.district].name : "", reward: quest.reward }];
    });
  }

  /** The quest the HUD follows: the last one accepted, else the oldest unfinished. */
  tracked(): QuestSnapshot["tracked"] {
    const id = this.trackedId ?? [...this.progress].find(([, p]) => p.status !== "complete")?.[0];
    const quest = id ? this.quest(id) : undefined, target = quest && this.target(quest);
    return quest && target ? { title: quest.title, objective: this.objective(quest), targetX: target.x, targetZ: target.z } : null;
  }

  snapshot(nearby: NpcDefinition | null): QuestSnapshot {
    return { credits: this.credits, log: this.log(), nearbyNpc: nearby ? { id: nearby.id, name: nearby.name } : null, tracked: this.tracked() };
  }

  /** Multiplayer: progress and credits as plain data (insertion order is the log order). */
  exportState(): QuestBookState {
    const progress: Record<string, Progress> = {};
    for (const [id, entry] of this.progress) progress[id] = { status: entry.status, step: entry.step };
    return { credits: this.credits, progress };
  }
  /** Multiplayer: adopts an authoritative party state. Unknown quests and statuses are dropped and
   * steps clamped. An open conversation is left alone: `choose` re-checks every transition, so a
   * stale option simply does nothing. */
  applyState(state: QuestBookState): void {
    this.progress.clear();
    for (const [id, entry] of Object.entries(state.progress)) {
      const quest = this.quest(id);
      if (!quest || !(entry.status === "active" || entry.status === "ready" || entry.status === "complete")) continue;
      const step = Math.max(0, Math.min(quest.steps.length, Math.floor(Number.isFinite(entry.step) ? entry.step : 0)));
      // An "active" quest past its last step is ready to hand in.
      this.progress.set(id, { status: entry.status === "active" && step >= quest.steps.length ? "ready" : entry.status, step });
    }
    if (Number.isFinite(state.credits)) this.credits = Math.max(0, state.credits);
    if (this.trackedId && (this.progress.get(this.trackedId)?.status ?? "complete") === "complete") this.trackedId = null;
  }

  private quest(id: string): QuestDefinition | undefined { return this.quests.find(q => q.id === id); }
  private header(npc: NpcDefinition): Omit<NpcDialogue, "lines" | "options"> {
    return { npcId: npc.id, npcName: npc.name, npcTitle: npc.title, district: DISTRICTS[npc.district]?.name ?? "" };
  }
  private lines(npc: NpcDefinition, quest: QuestDefinition, key: keyof NpcQuestLines): string[] | null {
    const lines = npc.quests?.[quest.id]?.[key];
    return lines?.length ? [...lines] : null;
  }
  /** The active step this NPC can complete, if any. */
  private stepFor(npc: NpcDefinition, quest: QuestDefinition): QuestStep | null {
    const progress = this.progress.get(quest.id);
    const step = progress?.status === "active" ? quest.steps[progress.step] : undefined;
    return step?.npc === npc.id ? step : null;
  }
  /** Where the quest sends the player now: the next step's NPC, or the giver once ready. */
  private target(quest: QuestDefinition): NpcDefinition | undefined {
    const progress = this.progress.get(quest.id);
    return npcById(this.npcs, progress?.status === "active" ? quest.steps[progress.step].npc : quest.giver);
  }
  private objective(quest: QuestDefinition): string {
    const progress = this.progress.get(quest.id);
    return progress?.status === "active" ? quest.steps[progress.step].objective : quest.returnObjective;
  }

  private resolve(npc: NpcDefinition): NpcDialogue {
    const header = this.header(npc);
    const own = this.quests.filter(q => q.giver === npc.id);
    const ready = own.find(q => this.status(q.id) === "ready");
    if (ready) return { ...header, lines: this.lines(npc, ready, "turnIn") ?? [ready.returnObjective], options: [{ id: `complete:${ready.id}`, label: `${ready.completeLabel} (+${ready.reward} cr)`, kind: "complete" }, LEAVE] };
    for (const quest of this.quests) {
      const step = this.stepFor(npc, quest);
      if (step) return { ...header, lines: this.lines(npc, quest, "step") ?? [step.objective], options: [{ id: `continue:${quest.id}`, label: step.action, kind: "continue" }, LEAVE] };
    }
    const offer = own.find(q => this.status(q.id) === "available");
    if (offer) return { ...header, lines: this.lines(npc, offer, "offer") ?? [offer.summary], options: [{ id: `accept:${offer.id}`, label: offer.acceptLabel, kind: "accept" }, { id: `decline:${offer.id}`, label: offer.declineLabel, kind: "decline" }] };
    const active = own.find(q => this.status(q.id) === "active");
    if (active) return { ...header, lines: this.lines(npc, active, "reminder") ?? [this.objective(active)], options: [LEAVE] };
    // Afterwards: the most recent finished business with this NPC, else small talk.
    for (const quest of [...this.quests].reverse()) {
      const progress = this.progress.get(quest.id);
      if (!progress) continue;
      const done = quest.giver === npc.id ? progress.status === "complete" && this.lines(npc, quest, "thanks")
        : quest.steps.some((s, i) => s.npc === npc.id && (i < progress.step || progress.status !== "active")) && this.lines(npc, quest, "after");
      if (done) return { ...header, lines: done, options: [LEAVE] };
    }
    return { ...header, lines: [...npc.greeting], options: [LEAVE] };
  }
}
