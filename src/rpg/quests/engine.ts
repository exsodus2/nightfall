import { DISTRICTS, districtAt } from "../../city/world.ts";
import { npcById, type NpcDefinition } from "../../city/npcs.ts";
import type { DialogueResult, NpcDialogue, NpcDialogueOption, NpcMarker, QuestLogEntry, QuestObjectiveView, QuestSnapshot } from "../../city/quests.ts";
import type { EventBus } from "../events.ts";
import type {
  Area, ContentPack, DialogueDefinition, DialogueNode, DialogueOptionDef, Effect, EncounterDefinition, EventOf, FlagValue,
  InteractableDefinition, Objective, Point, QuestDefinition2, QuestHost, QuestStage, QuestStatus,
} from "../types.ts";
import { applyEffects, creditsIn, evaluate, splitRef, unmetReason, type EffectContext, type QuestView } from "./conditions.ts";

// The data-driven quest + dialogue runtime. Content (quests, dialogues, interactables, areas) is
// plain data; this class owns the only mutable quest state: flags, per-quest runs, which
// interactables were used, and the open conversation. Other systems report what happened on the bus
// (kills, items, clears); quest effects act on the world through QuestHost.

type NamedArea = Area & { id: string };
type OptionKind = NpcDialogueOption["kind"];
type Tone = "info" | "quest" | "loot" | "danger";

interface ObjectiveState { progress: number; done: boolean }
interface Run {
  status: "active" | "complete" | "failed";
  stage: string;
  objectives: Map<string, ObjectiveState>;
  /** Seconds spent in the current stage (time limits). */
  elapsed: number;
  outcome: string | null;
  /** Every outcome ever reached (repeatable contracts keep history). */
  outcomes: string[];
  completions: number;
  /** Engine time when the run completed or failed (repeat cooldowns). */
  endedAt: number | null;
  journal: string[];
  /** Bumped on every transition so effects that move the quest stop the caller's follow-up. */
  token: number;
  /** A repeatable contract's return has been announced. */
  announced: boolean;
}

type OptionAction =
  | { type: "node"; dialogue: DialogueDefinition; node: DialogueNode; option: DialogueOptionDef }
  | { type: "deliver"; quest: string; objective: string }
  | { type: "offer"; quest: string }
  | { type: "accept"; quest: string }
  | { type: "leave" };
interface Conversation { speaker: string; view: NpcDialogue; actions: Map<string, OptionAction> }

/** Serialized engine state (see `serialize`). */
export interface QuestEngineState {
  version: 1;
  time: number;
  flags: Record<string, FlagValue>;
  cleared: string[];
  used: string[];
  inside: string[];
  tracked: string | null;
  quests: Record<string, { status: Run["status"]; stage: string; elapsed: number; outcome: string | null; outcomes: string[]; completions: number; endedAt: number | null; journal: string[]; objectives: Record<string, [number, boolean]> }>;
}

export interface QuestEngineOptions {
  bus: EventBus;
  host: QuestHost;
  npcs: readonly NpcDefinition[];
  quests?: readonly QuestDefinition2[];
  dialogues?: readonly DialogueDefinition[];
  interactables?: readonly InteractableDefinition[];
  areas?: readonly NamedArea[];
}

const LEAVE_ID = "@leave";
/** Largest dt `update` accepts: a backgrounded tab must not burn a whole time limit in one frame. */
const MAX_DT = 0.5;
const MAX_PASSES = 32;
// Which message a dialogue choice reports when several things happened at once.
const RANK = { update: 1, effect: 2, accepted: 3, ended: 4 } as const;

const isFinite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const within = (area: Area, p: Point) => Math.hypot(p.x - area.x, p.z - area.z) <= area.radius;

/** A data-driven quest, dialogue and world-flag runtime. See src/rpg/quests/AUTHORING.md. */
export class QuestEngine {
  /** Read access to world flags (`setFlag` writes). */
  readonly flags: { get(key: string): FlagValue | undefined; all(): Readonly<Record<string, FlagValue>> };

  private readonly bus: EventBus;
  private readonly host: QuestHost;
  private readonly npcList: NpcDefinition[];
  private readonly questDefs = new Map<string, QuestDefinition2>();
  private readonly dialogueDefs = new Map<string, DialogueDefinition>();
  private readonly interactableDefs = new Map<string, InteractableDefinition>();
  private readonly areaDefs = new Map<string, NamedArea>();
  private readonly encounters = new Map<string, EncounterDefinition>();
  private readonly itemNames = new Map<string, string>();
  /** Quests whose giver offers them through authored dialogue (no auto-generated offer). */
  private readonly authoredOffers = new Set<string>();

  private readonly flagStore = new Map<string, FlagValue>();
  private readonly runs = new Map<string, Run>();
  private readonly cleared = new Set<string>();
  private readonly used = new Set<string>();
  private readonly inside = new Set<string>();
  private time = 0;
  private trackedId: string | null = null;
  private conv: Conversation | null = null;
  private player: Point | null = null;
  private waypointOwner: string | null = null;

  private refreshing = false;
  private dirty = false;
  private pending: { text: string; rank: number }[] | null = null;
  private pendingOpen: { dialogue: string; node?: string } | null = null;
  private readonly statusGuard = new Set<string>();
  private readonly unsubscribe: (() => void)[] = [];

  constructor(opts: QuestEngineOptions) {
    this.bus = opts.bus; this.host = opts.host;
    this.npcList = [...opts.npcs];
    this.register({ id: "base", quests: opts.quests, dialogues: opts.dialogues, interactables: opts.interactables, areas: opts.areas });
    const store = this.flagStore;
    this.flags = { get: key => store.get(key), all: () => Object.fromEntries(store) };

    const bus = this.bus;
    this.unsubscribe.push(
      bus.on("talked", e => this.onTalked(e)),
      bus.on("dialogueChoice", e => this.onChoice(e)),
      bus.on("killed", e => this.onKilled(e)),
      bus.on("encounterCleared", e => { this.cleared.add(e.encounter); this.forObjectives((o, s) => { if (o.kind === "clear" && o.encounter === e.encounter) this.complete(s.quest, o, s.state); }); this.refresh(); }),
      bus.on("interacted", e => { this.forObjectives((o, s) => { if (o.kind === "interact" && o.object === e.object) this.complete(s.quest, o, s.state); }); this.refresh(); }),
      bus.on("itemAdded", () => this.refresh()),
      bus.on("itemRemoved", () => this.refresh()),
      bus.on("entered", event => {
        this.forObjectives((objective, state) => { if (objective.kind === "visit" && objective.area === event.area) this.complete(state.quest, objective, state.state); });
        this.refresh();
      }),
      bus.on("left", () => this.refresh()),
      bus.on("flag", e => { if (this.flagStore.get(e.key) !== e.value) { this.flagStore.set(e.key, e.value); this.refresh(); } }),
      bus.on("playerDied", () => this.onDied()),
    );
  }

  /** Stops listening to the bus. */
  dispose(): void { for (const off of this.unsubscribe.splice(0)) off(); }

  /** Merges a content pack: quests, dialogues, interactables, areas and NPCs replace same-id entries;
   * item names and encounters are remembered for reasons and tracker targets. */
  register(pack: ContentPack): void {
    for (const npc of pack.npcs ?? []) {
      const at = this.npcList.findIndex(n => n.id === npc.id);
      if (at >= 0) this.npcList[at] = npc; else this.npcList.push(npc);
    }
    for (const quest of pack.quests ?? []) this.questDefs.set(quest.id, quest);
    for (const dialogue of pack.dialogues ?? []) this.dialogueDefs.set(dialogue.id, dialogue);
    for (const it of pack.interactables ?? []) this.interactableDefs.set(it.id, it);
    for (const area of pack.areas ?? []) this.areaDefs.set(area.id, area);
    for (const enc of pack.encounters ?? []) this.encounters.set(enc.id, enc);
    for (const item of pack.items ?? []) this.itemNames.set(item.id, item.name);
    this.authoredOffers.clear();
    for (const dialogue of this.dialogueDefs.values()) {
      const effects = dialogue.nodes.flatMap(n => [...(n.effects ?? []), ...n.options.flatMap(o => o.effects ?? [])]);
      for (const effect of effects) if ("startQuest" in effect && this.questDefs.get(effect.startQuest)?.giver === dialogue.npc) this.authoredOffers.add(effect.startQuest);
    }
  }

  /** Every NPC the engine knows (base cast plus content packs). */
  get npcs(): readonly NpcDefinition[] { return this.npcList; }
  /** Registered quest definitions. */
  get quests(): readonly QuestDefinition2[] { return [...this.questDefs.values()]; }
  /** The open conversation, if any. */
  get dialogue(): NpcDialogue | null { return this.conv?.view ?? null; }
  /** Game seconds since the engine started (drives cooldowns and time limits). */
  get clock(): number { return this.time; }

  /** Current status of a quest ("available" again once a repeatable contract's cooldown ends). */
  status(questId: string): QuestStatus {
    const quest = this.questDefs.get(questId), run = this.runs.get(questId);
    if (!quest) return "locked";
    if (run?.status === "active") return "active";
    if (run && !this.repeatReady(quest, run)) return run.status;
    // A quest whose `requires` mentions itself must not recurse forever.
    if (this.statusGuard.has(questId)) return run?.status ?? "locked";
    this.statusGuard.add(questId);
    try { return evaluate(quest.requires, this.effectContext(null)) ? "available" : "locked"; }
    finally { this.statusGuard.delete(questId); }
  }
  /** Current stage id of a started quest. */
  stage(questId: string): string | null { return this.runs.get(questId)?.stage ?? null; }
  /** The outcome the quest ended with most recently. */
  outcome(questId: string): string | null { return this.runs.get(questId)?.outcome ?? null; }

  /** Writes a world flag (emits a `flag` event when it changes). */
  setFlag(key: string, value: FlagValue): void {
    if (this.writeFlag(key, value)) this.refresh();
  }
  /** Stores and announces a flag without re-evaluating quests (safe mid-iteration). Our own `flag`
   * events then find the value already stored, so the bus handler doesn't refresh either. */
  private writeFlag(key: string, value: FlagValue): boolean {
    if (this.flagStore.get(key) === value) return false;
    this.flagStore.set(key, value);
    this.bus.emit({ type: "flag", key, value });
    return true;
  }

  /** Makes a quest the tracked one (HUD tracker and waypoint target). */
  track(questId: string): void { if (this.runs.get(questId)?.status === "active") this.trackedId = questId; }

  /** Starts a quest directly (as a `startQuest` effect would). Returns false if it cannot start now. */
  start(questId: string): boolean { return this.begin(questId, "effect"); }

  // ---- Frame update ------------------------------------------------------------------------------

  /** Per-frame: named-area enter/leave events, trigger-area gigs, reach/survive objectives, time
   * limits and repeat cooldowns. Call once per frame with the player's ground position. */
  update(dt: number, player: Point & { place?: string }): void {
    const step = isFinite(dt) ? Math.max(0, Math.min(MAX_DT, dt)) : 0;
    this.time += step;
    this.player = player.place ? null : { x: player.x, z: player.z };
    for (const area of this.areaDefs.values()) {
      const inside = !player.place && within(area, player);
      if (inside === this.inside.has(area.id)) continue;
      if (inside) this.inside.add(area.id); else this.inside.delete(area.id);
      this.bus.emit({ type: inside ? "entered" : "left", area: area.id });
    }
    for (const quest of this.questDefs.values()) {
      const run = this.runs.get(quest.id);
      if (run && run.status !== "active" && quest.repeatable && !run.announced && this.repeatReady(quest, run)) {
        run.announced = true;
        this.bus.emit({ type: "questUpdated", quest: quest.id, stage: run.stage, status: this.status(quest.id) });
      }
      if (!player.place && quest.trigger && within(quest.trigger, player) && this.status(quest.id) === "available") this.begin(quest.id, "trigger");
    }
    for (const [id, run] of this.runs) {
      if (run.status !== "active") continue;
      run.elapsed += step;
      const stage = this.stageDef(id, run.stage);
      for (const objective of stage?.objectives ?? []) {
        const state = run.objectives.get(objective.id);
        if (!state || state.done || objective.kind !== "survive") continue;
        if (objective.area && (player.place || !within(objective.area, player))) continue;
        state.progress += step;
        if (state.progress >= objective.seconds) this.complete(id, objective, state);
      }
    }
    this.refresh();
    for (const [id, run] of this.runs) {
      const stage = run.status === "active" ? this.stageDef(id, run.stage) : undefined;
      if (stage?.timeLimit !== undefined && run.elapsed >= stage.timeLimit) this.timeout(id, run, stage);
    }
    this.refresh();
    this.flushOpen();
  }

  // ---- Conversation ------------------------------------------------------------------------------

  /** Opens a conversation with an NPC (emits `talked`, which completes talk objectives first). */
  talk(npcId: string): NpcDialogue | null {
    this.conv = null;
    if (!npcById(this.npcList, npcId)) return null;
    this.bus.emit({ type: "talked", npc: npcId });
    this.conv = this.root(npcId);
    this.flushOpen();
    return this.dialogue;
  }

  /** Applies an option of the open conversation. Unknown, stale or disabled ids change nothing. */
  choose(optionId: string): DialogueResult {
    const conv = this.conv, action = conv?.actions.get(optionId), shown = conv?.view.options.find(o => o.id === optionId);
    if (!conv || !action || !shown || shown.disabled) return { dialogue: this.dialogue, message: null };
    this.pending = [];
    let next: Conversation | null = null;
    try {
      if (action.type === "node") {
        const { dialogue, node, option } = action;
        let target = option.next;
        if (option.check) target = this.checkTotal(option.check) >= option.check.difficulty ? option.check.success : option.check.failure;
        this.pendingOpen = null;
        // Effects first so the choice event (and stage branching on it) sees the flags they set.
        this.applyIn(option.effects, dialogue.quest ?? null);
        this.bus.emit({ type: "dialogueChoice", npc: conv.speaker, dialogue: dialogue.id, node: node.id, option: option.id });
        if (this.pendingOpen) next = null;
        else if (target) next = this.showNode(conv.speaker, dialogue, target, []);
      } else if (action.type === "deliver") {
        const quest = this.questDefs.get(action.quest), run = this.runs.get(action.quest);
        const objective = run?.status === "active" ? this.stageDef(action.quest, run.stage)?.objectives.find(o => o.id === action.objective) : undefined;
        const state = objective && run?.objectives.get(objective.id);
        if (quest && objective?.kind === "deliver" && state && !state.done && this.host.take(objective.item, objective.count)) {
          state.progress = objective.count;
          this.complete(quest.id, objective, state);
          this.refresh();
        }
        next = this.root(conv.speaker);
      } else if (action.type === "offer") {
        const npc = npcById(this.npcList, conv.speaker);
        next = npc ? this.offer(npc, action.quest, []) : null;
      } else if (action.type === "accept") {
        const npc = npcById(this.npcList, conv.speaker), quest = this.questDefs.get(action.quest);
        if (npc && quest && this.begin(quest.id, "dialogue")) {
          const lines = npc.quests?.[quest.id]?.accepted ?? [this.primaryText(quest.id) ?? quest.summary];
          next = this.show(conv.speaker, [...lines], [this.leaveOption()]);
        } else next = this.root(conv.speaker);
      }
      this.conv = next;
      this.flushOpen();
      const best = this.pending.reduce<{ text: string; rank: number } | null>((a, b) => (!a || b.rank > a.rank ? b : a), null);
      return { dialogue: this.dialogue, message: best?.text ?? null };
    } finally { this.pending = null; }
  }

  /** Ends the open conversation. */
  close(): void { this.conv = null; }

  /** Interactables whose condition holds and that aren't used up. */
  interactables(): readonly InteractableDefinition[] {
    return [...this.interactableDefs.values()].filter(it => this.interactable(it));
  }

  /** Uses a world object: applies its effects, emits `interacted` and opens its dialogue, if any. */
  interact(id: string): NpcDialogue | null {
    const it = this.interactableDefs.get(id);
    if (!it || !this.interactable(it)) return null;
    if (it.once) this.used.add(id);
    this.pendingOpen = null;
    this.applyIn(it.effects, null);
    this.bus.emit({ type: "interacted", object: id });
    if (it.dialogue && !this.pendingOpen) this.pendingOpen = { dialogue: it.dialogue };
    const opened = !!this.pendingOpen;
    this.flushOpen();
    return opened ? this.dialogue : null;
  }

  // ---- UI snapshots --------------------------------------------------------------------------------

  /** Floating marker above an NPC: a hand-in to the giver, an objective here, or a quest to offer. */
  marker(npcId: string): NpcMarker {
    let marker: NpcMarker = null;
    for (const [id, run] of this.runs) {
      if (run.status !== "active") continue;
      const quest = this.questDefs.get(id)!, stage = this.stageDef(id, run.stage);
      for (const objective of stage?.objectives ?? []) {
        if (objective.hidden || run.objectives.get(objective.id)?.done || this.objectiveNpc(objective) !== npcId) continue;
        if (quest.giver === npcId && stage && this.finalStage(stage)) return "turn-in";
        marker = "objective";
      }
    }
    if (marker) return marker;
    for (const quest of this.questDefs.values()) if (quest.giver === npcId && this.status(quest.id) === "available") return "offer";
    return null;
  }

  /** Quest log entries, in the order quests were started. */
  log(): QuestLogEntry[] {
    return [...this.runs].flatMap(([id, run]) => {
      const quest = this.questDefs.get(id);
      if (!quest) return [];
      const stage = this.stageDef(id, run.stage), outcome = run.outcome ? quest.outcomes[run.outcome] : undefined;
      const target = run.status === "active" ? this.primaryTarget(id) : null;
      const giver = quest.giver ? npcById(this.npcList, quest.giver) : undefined;
      const place = target ?? giver ?? null;
      const entry: QuestLogEntry = {
        id, title: quest.title,
        status: run.status === "active" ? (this.ready(id, run) ? "ready" : "active") : run.status,
        objective: run.status === "complete" ? outcome?.title ?? "Completed" : run.status === "failed" ? "Failed" : this.primaryText(id) ?? stage?.journal ?? "",
        targetDistrict: place ? DISTRICTS[districtAt(place.x, place.z).id]?.name ?? "" : "",
        reward: run.status === "complete" ? creditsIn(outcome?.effects) : this.rewardOf(quest),
        category: quest.category,
        journal: [...run.journal],
      };
      if (run.status === "active") {
        entry.objectives = this.objectiveViews(id, run);
        if (stage?.timeLimit !== undefined) entry.timeLeft = Math.max(0, stage.timeLimit - run.elapsed);
      }
      return [entry];
    });
  }

  /** The quest the HUD follows: the one last started / tracked, else the oldest active one. */
  tracked(): QuestSnapshot["tracked"] {
    const active = [...this.runs].filter(([, r]) => r.status === "active").map(([id]) => id);
    const id = this.trackedId && active.includes(this.trackedId) ? this.trackedId : active[0];
    if (!id) return null;
    const quest = this.questDefs.get(id)!, run = this.runs.get(id)!, target = this.primaryTarget(id);
    if (!target) return null;
    const stage = this.stageDef(id, run.stage);
    const tracked: NonNullable<QuestSnapshot["tracked"]> = { title: quest.title, objective: this.primaryText(id) ?? stage?.journal ?? "", targetX: target.x, targetZ: target.z, id, objectives: this.objectiveViews(id, run) };
    if (stage?.timeLimit !== undefined) tracked.timeLeft = Math.max(0, stage.timeLimit - run.elapsed);
    return tracked;
  }

  /** The same snapshot shape the legacy QuestBook produced, for the React HUD. */
  snapshot(nearby: NpcDefinition | null): QuestSnapshot {
    return { credits: this.host.creditBalance, log: this.log(), nearbyNpc: nearby ? { id: nearby.id, name: nearby.name } : null, tracked: this.tracked() };
  }

  // ---- Save / load ---------------------------------------------------------------------------------

  /** Plain, JSON-safe state (version 1). The open conversation is not saved. */
  serialize(): QuestEngineState {
    const quests: QuestEngineState["quests"] = {};
    for (const [id, run] of this.runs) {
      const objectives: Record<string, [number, boolean]> = {};
      for (const [oid, s] of run.objectives) objectives[oid] = [s.progress, s.done];
      quests[id] = { status: run.status, stage: run.stage, elapsed: run.elapsed, outcome: run.outcome, outcomes: [...run.outcomes], completions: run.completions, endedAt: run.endedAt, journal: [...run.journal], objectives };
    }
    return { version: 1, time: this.time, flags: Object.fromEntries(this.flagStore), cleared: [...this.cleared], used: [...this.used], inside: [...this.inside], tracked: this.trackedId, quests };
  }

  /** Restores `serialize` output. Anything malformed or referring to content that no longer exists
   * is dropped (a quest whose saved stage was removed restarts that quest at its first stage). */
  load(state: unknown): void {
    if (!isRecord(state) || state.version !== 1) return;
    this.flagStore.clear(); this.runs.clear(); this.cleared.clear(); this.used.clear(); this.inside.clear();
    this.conv = null; this.trackedId = null; this.pendingOpen = null;
    this.time = isFinite(state.time) && state.time >= 0 ? state.time : 0;
    if (isRecord(state.flags)) for (const [k, v] of Object.entries(state.flags)) if (typeof v === "boolean" || typeof v === "string" || isFinite(v)) this.flagStore.set(k, v);
    for (const id of strings(state.cleared)) this.cleared.add(id);
    for (const id of strings(state.used)) if (this.interactableDefs.has(id)) this.used.add(id);
    for (const id of strings(state.inside)) if (this.areaDefs.has(id)) this.inside.add(id);
    if (isRecord(state.quests)) for (const [id, raw] of Object.entries(state.quests)) {
      const quest = this.questDefs.get(id);
      if (!quest || !isRecord(raw) || !(raw.status === "active" || raw.status === "complete" || raw.status === "failed")) continue;
      const known = typeof raw.stage === "string" && quest.stages.some(s => s.id === raw.stage);
      const stage = known ? raw.stage as string : quest.start;
      const run: Run = {
        status: raw.status, stage, objectives: new Map(), elapsed: known && isFinite(raw.elapsed) ? Math.max(0, raw.elapsed) : 0,
        outcome: typeof raw.outcome === "string" && raw.outcome in quest.outcomes ? raw.outcome : null,
        outcomes: strings(raw.outcomes).filter(o => o in quest.outcomes),
        completions: isFinite(raw.completions) ? Math.max(0, Math.floor(raw.completions)) : 0,
        endedAt: isFinite(raw.endedAt) ? raw.endedAt : raw.status === "active" ? null : this.time,
        journal: strings(raw.journal), token: 0, announced: false,
      };
      for (const objective of this.stageDef(id, stage)?.objectives ?? []) {
        const saved = known && isRecord(raw.objectives) ? raw.objectives[objective.id] : undefined;
        const [progress, done] = Array.isArray(saved) ? saved : [0, false];
        run.objectives.set(objective.id, { progress: isFinite(progress) ? Math.max(0, progress) : 0, done: done === true });
      }
      if (run.status !== "active" && quest.repeatable && this.repeatReady(quest, run)) run.announced = true;
      this.runs.set(id, run);
    }
    if (typeof state.tracked === "string" && this.runs.get(state.tracked)?.status === "active") this.trackedId = state.tracked;
    this.refresh();
  }

  // ---- Bus handlers --------------------------------------------------------------------------------

  private onTalked(e: EventOf<"talked">): void {
    this.forObjectives((o, s) => { if (o.kind === "talk" && o.npc === e.npc) this.complete(s.quest, o, s.state); });
    this.refresh();
  }
  private onChoice(e: EventOf<"dialogueChoice">): void {
    this.forObjectives((o, s) => {
      if (o.kind === "choose" && o.dialogue === e.dialogue && o.options.includes(e.option)) this.complete(s.quest, o, s.state, e.option);
    });
    this.refresh();
  }
  private onKilled(e: EventOf<"killed">): void {
    this.forObjectives((o, s) => {
      if (o.kind !== "kill" || (!e.byPlayer && o.encounter === undefined)) return;
      if ((o.archetype !== undefined && o.archetype !== e.archetype) || (o.faction !== undefined && o.faction !== e.faction)
        || (o.tag !== undefined && !e.tags.includes(o.tag)) || (o.encounter !== undefined && o.encounter !== e.encounter)) return;
      s.state.progress++;
      if (s.state.progress >= o.count) this.complete(s.quest, o, s.state);
    });
    this.refresh();
  }
  private onDied(): void {
    for (const [id, run] of this.runs) {
      if (run.status !== "active") continue;
      const stage = this.stageDef(id, run.stage);
      if (stage?.failOnDeath) { this.fail(id, run); continue; }
      // A hold has to be survived in one go.
      for (const objective of stage?.objectives ?? []) {
        const state = run.objectives.get(objective.id);
        if (objective.kind === "survive" && state && !state.done) state.progress = 0;
      }
    }
    this.refresh();
  }

  /** Calls `fn` for every unfinished objective of every active quest's current stage. */
  private forObjectives(fn: (objective: Objective, at: { quest: string; state: ObjectiveState }) => void): void {
    for (const [id, run] of this.runs) {
      if (run.status !== "active") continue;
      for (const objective of this.stageDef(id, run.stage)?.objectives ?? []) {
        const state = run.objectives.get(objective.id);
        if (state && !state.done) fn(objective, { quest: id, state });
      }
    }
  }

  // ---- Quest state machine -------------------------------------------------------------------------

  /** Latches an objective done and records it as the flag "<quest>.<objective>" (the chosen option id
   * for `choose`), so later stages, dialogue and outcomes can branch on how the player got here. */
  private complete(questId: string, objective: Objective, state: ObjectiveState, value: FlagValue = true): void {
    if (state.done) return;
    state.done = true;
    if (objective.kind === "survive") state.progress = objective.seconds;
    this.dirty = true;
    this.writeFlag(`${questId}.${objective.id}`, value);
  }

  /** Re-evaluates live objectives, failure conditions and stage completion until nothing changes. */
  private refresh(): void {
    if (this.refreshing) { this.dirty = true; return; }
    this.refreshing = true;
    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        this.dirty = false;
        for (const id of [...this.runs.keys()]) {
          const run = this.runs.get(id)!;
          if (run.status === "active") this.step(id, run);
        }
        if (!this.dirty) break;
      }
    } finally { this.refreshing = false; }
  }

  private step(questId: string, run: Run): void {
    const stage = this.stageDef(questId, run.stage);
    if (!stage) { this.fail(questId, run); return; }
    const ctx = this.effectContext(questId);
    for (const objective of stage.objectives) {
      const state = run.objectives.get(objective.id);
      if (!state) continue;
      if (objective.kind === "collect") {
        // Live: dropping the item un-finishes the objective until the stage completes.
        state.progress = Math.min(objective.count, this.host.count(objective.item));
        const had = state.done;
        state.done = state.progress >= objective.count;
        if (state.done && !had) this.writeFlag(`${questId}.${objective.id}`, true);
      } else if (objective.kind === "condition") {
        const had = state.done;
        state.done = evaluate(objective.condition, ctx);
        if (state.done && !had) this.writeFlag(`${questId}.${objective.id}`, true);
      } else if (!state.done && objective.kind === "clear" && (this.cleared.has(objective.encounter) || this.host.encounterCleared(objective.encounter))) this.complete(questId, objective, state);
      else if (!state.done && objective.kind === "reach" && this.player && within(objective.area, this.player)) this.complete(questId, objective, state);
    }
    if (run.status !== "active" || run.stage !== stage.id) return;
    if (stage.failIf && evaluate(stage.failIf, ctx)) { this.fail(questId, run); return; }
    const required = stage.objectives.filter(o => !o.optional);
    const finished = (o: Objective) => run.objectives.get(o.id)?.done === true;
    const done = stage.mode === "any" ? required.length === 0 || required.some(finished) : required.every(finished);
    if (done) this.completeStage(questId, run, stage);
  }

  private completeStage(questId: string, run: Run, stage: QuestStage): void {
    const token = ++run.token;
    this.dirty = true;
    this.applyIn(stage.onComplete, questId);
    if (run.status !== "active" || run.token !== token) return; // the effects already moved the quest
    const next = typeof stage.next === "string" ? stage.next
      : stage.next?.find(branch => evaluate(branch.if, this.effectContext(questId)))?.stage;
    if (next) this.enterStage(questId, run, next, true);
    else this.finish(questId, run, null);
  }

  private enterStage(questId: string, run: Run, stageId: string, announce: boolean): void {
    const quest = this.questDefs.get(questId)!, stage = this.stageDef(questId, stageId);
    if (!stage) { this.fail(questId, run); return; }
    run.stage = stageId; run.token++; run.elapsed = 0;
    run.objectives = new Map(stage.objectives.map(o => [o.id, { progress: 0, done: false }]));
    run.journal.push(stage.journal);
    this.dirty = true;
    this.bus.emit({ type: "questUpdated", quest: questId, stage: stageId, status: "active" });
    const token = run.token;
    if (announce) this.note(`${quest.title}: ${this.primaryText(questId) ?? stage.journal}`, RANK.update, "quest");
    this.applyIn(stage.onEnter, questId);
    if (run.token === token) this.refresh();
  }

  private finish(questId: string, run: Run, outcomeId: string | null): void {
    const quest = this.questDefs.get(questId)!, keys = Object.keys(quest.outcomes);
    const id = outcomeId && outcomeId in quest.outcomes ? outcomeId : keys[0] ?? null;
    const outcome = id ? quest.outcomes[id] : undefined;
    run.status = "complete"; run.outcome = id; run.completions++; run.endedAt = this.time; run.token++; run.announced = false;
    if (id && !run.outcomes.includes(id)) run.outcomes.push(id);
    if (outcome) run.journal.push(outcome.journal);
    this.ended(questId);
    this.bus.emit({ type: "questUpdated", quest: questId, stage: run.stage, status: "complete" });
    const credits = creditsIn(outcome?.effects);
    this.note(`Quest complete: ${quest.title}${credits > 0 ? ` · +${credits} cr` : ""}`, RANK.ended, "quest");
    this.applyIn(outcome?.effects, questId);
    this.dirty = true;
  }

  private fail(questId: string, run: Run): void {
    if (run.status !== "active") return;
    const quest = this.questDefs.get(questId)!;
    run.status = "failed"; run.endedAt = this.time; run.token++; run.announced = false;
    this.ended(questId);
    this.bus.emit({ type: "questUpdated", quest: questId, stage: run.stage, status: "failed" });
    this.note(`Quest failed: ${quest.title}`, RANK.ended, "danger");
    this.applyIn(quest.onFail, questId);
    this.dirty = true;
  }

  private timeout(questId: string, run: Run, stage: QuestStage): void {
    if (stage.onTimeout && this.stageDef(questId, stage.onTimeout)) {
      this.note(`${this.questDefs.get(questId)!.title}: time's up`, RANK.update, "danger");
      this.enterStage(questId, run, stage.onTimeout, false);
    } else this.fail(questId, run);
  }

  private ended(questId: string): void {
    if (this.trackedId === questId) this.trackedId = null;
    if (this.waypointOwner === questId) { this.waypointOwner = null; this.host.setWaypoint(null); }
  }

  /** Starts (or restarts a cooled-down repeatable) quest. `requires` gates offers and triggers; a
   * content `startQuest` effect is trusted to have checked what it needs. */
  private begin(questId: string, via: "dialogue" | "trigger" | "effect"): boolean {
    const quest = this.questDefs.get(questId);
    if (!quest || !quest.stages.some(s => s.id === quest.start)) return false;
    const previous = this.runs.get(questId);
    if (previous?.status === "active" || (previous && !this.repeatReady(quest, previous))) return false;
    if (via !== "effect" && this.status(questId) !== "available") return false;
    const run: Run = { status: "active", stage: quest.start, objectives: new Map(), elapsed: 0, outcome: null, outcomes: previous?.outcomes ?? [], completions: previous?.completions ?? 0, endedAt: null, journal: [], token: 0, announced: false };
    this.runs.set(questId, run);
    this.trackedId = questId;
    this.note(via === "trigger" ? `New ${quest.category}: ${quest.title}` : `Quest accepted: ${quest.title}`, RANK.accepted, "quest");
    this.enterStage(questId, run, quest.start, false);
    return true;
  }

  private repeatReady(quest: QuestDefinition2, run: Run): boolean {
    return !!quest.repeatable && run.status !== "active" && run.endedAt !== null && this.time >= run.endedAt + Math.max(0, quest.repeatable.cooldown);
  }

  // ---- Effects ------------------------------------------------------------------------------------

  private effectContext(questId: string | null): EffectContext {
    return {
      host: this.host,
      flag: key => this.flagStore.get(key),
      quest: id => this.questView(id),
      cleared: id => this.cleared.has(id),
      names: { item: id => this.itemNames.get(id), quest: id => this.questDefs.get(id)?.title },
      setFlag: (key, value) => this.setFlag(key, value),
      startQuest: id => { this.begin(id, "effect"); },
      setStage: ref => {
        const target = this.resolveRef(ref, questId, "stage");
        const run = target && this.runs.get(target.quest);
        if (target && run?.status === "active") this.enterStage(target.quest, run, target.id, true);
      },
      setOutcome: ref => {
        const target = this.resolveRef(ref, questId, "outcome");
        const run = target && this.runs.get(target.quest);
        if (target && run?.status === "active") this.finish(target.quest, run, target.id);
      },
      failQuest: id => { const run = this.runs.get(id); if (run) this.fail(id, run); },
      openDialogue: (id, node) => { this.pendingOpen = { dialogue: id, node }; },
      message: (text, tone) => { this.host.message(text, tone); this.pending?.push({ text, rank: RANK.effect }); },
      waypoint: point => { this.waypointOwner = questId; this.host.setWaypoint(point); },
    };
  }
  private applyIn(effects: readonly Effect[] | undefined, questId: string | null): void {
    if (effects?.length) applyEffects(effects, this.effectContext(questId));
  }

  /** "quest:id" or a bare id in the context quest; with no context, the first active quest that has it. */
  private resolveRef(ref: string, context: string | null, kind: "stage" | "outcome"): { quest: string; id: string } | null {
    const has = (q: string, id: string) => { const def = this.questDefs.get(q); return !!def && (kind === "stage" ? def.stages.some(s => s.id === id) : id in def.outcomes); };
    const { quest, id } = splitRef(ref, context);
    if (quest) return has(quest, id) ? { quest, id } : null;
    for (const [q, run] of this.runs) if (run.status === "active" && has(q, id)) return { quest: q, id };
    return null;
  }

  private questView(id: string): QuestView {
    const run = this.runs.get(id);
    return { status: this.status(id), stage: run?.stage ?? null, outcomes: run?.outcomes ?? [] };
  }

  private note(text: string, rank: number, tone: Tone): void {
    this.bus.emit({ type: "message", text, tone });
    this.pending?.push({ text, rank });
  }

  // ---- Dialogue assembly ---------------------------------------------------------------------------

  /** What an NPC (or interactable) says when first addressed: the best authored entry, else an
   * auto-generated offer, reminder, thanks or greeting. Deliveries are always offered on top. */
  private root(speaker: string): Conversation | null {
    const npc = npcById(this.npcList, speaker);
    const deliveries = this.deliverOptions(speaker);
    const offers = npc ? this.autoOffers(npc.id) : [];
    const entry = this.entryFor(speaker);
    if (entry) {
      const extra: [NpcDialogueOption, OptionAction][] = offers.map(q => [{ id: `@offer:${q}`, label: `Ask about work: ${this.questDefs.get(q)!.title}`, kind: "continue" }, { type: "offer", quest: q }]);
      return this.showNode(speaker, entry.dialogue, entry.node, [...deliveries, ...extra]);
    }
    if (!npc) return null;
    if (offers.length) return this.offer(npc, offers[0], deliveries);
    return this.show(speaker, this.fallbackLines(npc), [...deliveries, this.leaveOption()]);
  }

  private entryFor(speaker: string): { dialogue: DialogueDefinition; node: string } | null {
    const candidates: { dialogue: DialogueDefinition; entry: DialogueDefinition["entries"][number]; order: number }[] = [];
    for (const dialogue of this.dialogueDefs.values()) {
      if (dialogue.npc !== speaker) continue;
      for (const entry of dialogue.entries) candidates.push({ dialogue, entry, order: candidates.length });
    }
    candidates.sort((a, b) => Number(!a.entry.condition) - Number(!b.entry.condition) || (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || a.order - b.order);
    for (const { dialogue, entry } of candidates) {
      const ctx = this.effectContext(dialogue.quest ?? null);
      if (evaluate(entry.condition, ctx) && dialogue.nodes.some(n => n.id === entry.node)) return { dialogue, node: entry.node };
    }
    return null;
  }

  private showNode(speaker: string, dialogue: DialogueDefinition, nodeId: string, prefix: [NpcDialogueOption, OptionAction][]): Conversation | null {
    const node = dialogue.nodes.find(n => n.id === nodeId);
    if (!node) return null;
    this.applyIn(node.effects, dialogue.quest ?? null);
    const ctx = this.effectContext(dialogue.quest ?? null);
    const options: [NpcDialogueOption, OptionAction][] = [...prefix];
    for (const option of node.options) {
      const ok = evaluate(option.condition, ctx);
      if (!ok && option.hideIfUnavailable) continue;
      const view: NpcDialogueOption = { id: option.id, label: option.label, kind: option.kind ?? inferKind(option) };
      if (option.check) {
        const value = this.checkTotal(option.check);
        view.label = `${option.label} [${option.check.stat.toUpperCase()} ${value}/${option.check.difficulty}]`;
        view.check = { stat: option.check.stat, value, difficulty: option.check.difficulty };
      }
      if (!ok) view.disabled = option.reason ?? unmetReason(option.condition, ctx) ?? "Not available yet";
      options.push([view, { type: "node", dialogue, node, option }]);
    }
    if (!options.length) options.push(this.leaveOption());
    return this.show(speaker, [...node.lines], options);
  }

  private offer(npc: NpcDefinition, questId: string, extra: [NpcDialogueOption, OptionAction][]): Conversation {
    const quest = this.questDefs.get(questId)!;
    const lines = npc.quests?.[questId]?.offer ?? [quest.summary, ...(quest.rewardHint ? [`Reward: ${quest.rewardHint}`] : [])];
    const level = quest.recommendedLevel && quest.recommendedLevel > this.host.level ? ` (level ${quest.recommendedLevel} advised)` : "";
    return this.show(npc.id, [...lines], [
      [{ id: `@accept:${questId}`, label: `Take the job${level}`, kind: "accept" }, { type: "accept", quest: questId }],
      [{ id: `@decline:${questId}`, label: "Not now", kind: "decline" }, { type: "leave" }],
      ...extra,
    ]);
  }

  private show(speaker: string, lines: string[], options: [NpcDialogueOption, OptionAction][]): Conversation {
    const npc = npcById(this.npcList, speaker), it = this.interactableDefs.get(speaker);
    const place = npc ?? it;
    const view: NpcDialogue = {
      npcId: speaker, npcName: npc?.name ?? it?.label ?? speaker, npcTitle: npc?.title ?? "",
      district: npc ? DISTRICTS[npc.district]?.name ?? "" : place ? DISTRICTS[districtAt(place.x, place.z).id]?.name ?? "" : "",
      lines, options: options.map(([o]) => o),
    };
    return { speaker, view, actions: new Map(options.map(([o, a]) => [o.id, a])) };
  }

  private leaveOption(): [NpcDialogueOption, OptionAction] { return [{ id: LEAVE_ID, label: "Leave", kind: "leave" }, { type: "leave" }]; }

  /** Opens a dialogue requested by an `openDialogue` effect or an interactable. */
  private flushOpen(): void {
    for (let guard = 0; this.pendingOpen && guard < 8; guard++) {
      const { dialogue: id, node } = this.pendingOpen;
      this.pendingOpen = null;
      const dialogue = this.dialogueDefs.get(id);
      if (!dialogue) continue;
      const ctx = this.effectContext(dialogue.quest ?? null);
      const start = node ?? dialogue.entries.find(e => evaluate(e.condition, ctx))?.node;
      const opened = start ? this.showNode(dialogue.npc, dialogue, start, []) : null;
      if (opened) this.conv = opened;
    }
    this.pendingOpen = null;
  }

  private deliverOptions(speaker: string): [NpcDialogueOption, OptionAction][] {
    const options: [NpcDialogueOption, OptionAction][] = [];
    this.forObjectives((o, s) => {
      if (o.kind !== "deliver" || o.npc !== speaker) return;
      const have = this.host.count(o.item), name = this.itemNames.get(o.item) ?? o.item;
      const view: NpcDialogueOption = { id: `@deliver:${s.quest}:${o.id}`, label: `Hand over ${name}${o.count > 1 ? ` x${o.count}` : ""}`, kind: "complete" };
      if (have < o.count) view.disabled = `You have ${have}/${o.count}`;
      options.push([view, { type: "deliver", quest: s.quest, objective: o.id }]);
    });
    return options;
  }

  private autoOffers(npcId: string): string[] {
    return [...this.questDefs.values()].filter(q => q.giver === npcId && !this.authoredOffers.has(q.id) && this.status(q.id) === "available").map(q => q.id);
  }

  /** No authored entry: remind about the giver's running quest, thank for a finished one, or small talk. */
  private fallbackLines(npc: NpcDefinition): string[] {
    for (const [id, run] of this.runs) {
      const quest = this.questDefs.get(id);
      if (quest?.giver === npc.id && run.status === "active") return [...(npc.quests?.[id]?.reminder ?? [this.primaryText(id) ?? quest.summary])];
    }
    for (const [id, run] of [...this.runs].reverse()) {
      const thanks = npc.quests?.[id]?.thanks;
      if (this.questDefs.get(id)?.giver === npc.id && run.status === "complete" && thanks?.length) return [...thanks];
    }
    return [...npc.greeting];
  }

  private checkTotal(check: NonNullable<DialogueOptionDef["check"]>): number {
    const ctx = this.effectContext(null);
    return (this.host.stat(check.stat) || 0) + (check.bonus ?? []).reduce((sum, b) => sum + (evaluate(b.if, ctx) ? b.by : 0), 0);
  }

  private interactable(it: InteractableDefinition): boolean {
    return !(it.once && this.used.has(it.id)) && evaluate(it.condition, this.effectContext(null));
  }

  // ---- Objective presentation ----------------------------------------------------------------------

  private stageDef(questId: string, stageId: string): QuestStage | undefined {
    return this.questDefs.get(questId)?.stages.find(s => s.id === stageId);
  }

  /** A stage that ends the quest when done (the giver hand-in is a "turn-in"). */
  private finalStage(stage: QuestStage): boolean {
    return stage.next === undefined || (stage.onComplete ?? []).some(e => "outcome" in e);
  }

  /** Ready = only a hand-in at the giver is left in the final stage. */
  private ready(questId: string, run: Run): boolean {
    const quest = this.questDefs.get(questId)!, stage = this.stageDef(questId, run.stage);
    if (!stage || !quest.giver || !this.finalStage(stage)) return false;
    const open = stage.objectives.filter(o => !o.optional && !run.objectives.get(o.id)?.done);
    return open.length > 0 && open.every(o => this.objectiveNpc(o) === quest.giver);
  }

  /** The NPC an objective is completed with, if any. */
  private objectiveNpc(objective: Objective): string | null {
    if (objective.kind === "talk" || objective.kind === "deliver") return objective.npc;
    if (objective.kind === "choose") return this.dialogueDefs.get(objective.dialogue)?.npc ?? null;
    return null;
  }

  /** Where the tracker should point for an objective: its explicit target, else what it involves. */
  private targetOf(objective: Objective): Point | null {
    if (objective.target) return objective.target;
    const npc = this.objectiveNpc(objective);
    const place = npc ? npcById(this.npcList, npc) ?? this.interactableDefs.get(npc) : undefined;
    if (place) return { x: place.x, z: place.z };
    if (objective.kind === "interact") { const it = this.interactableDefs.get(objective.object); return it ? { x: it.x, z: it.z } : null; }
    if (objective.kind === "reach") return objective.area;
    if (objective.kind === "survive" && objective.area) return objective.area;
    if ((objective.kind === "clear" || objective.kind === "kill") && objective.encounter) { const enc = this.encounters.get(objective.encounter); return enc ? { x: enc.area.x, z: enc.area.z } : null; }
    return null;
  }

  /** Unfinished visible objectives, required ones first. */
  private openObjectives(questId: string): Objective[] {
    const run = this.runs.get(questId), stage = run && this.stageDef(questId, run.stage);
    if (!run || !stage) return [];
    const open = stage.objectives.filter(o => !o.hidden && !run.objectives.get(o.id)?.done);
    return [...open.filter(o => !o.optional), ...open.filter(o => o.optional)];
  }
  private primaryText(questId: string): string | null {
    const run = this.runs.get(questId), first = this.openObjectives(questId)[0];
    return first && run ? this.objectiveText(first, run.objectives.get(first.id)) : null;
  }
  private primaryTarget(questId: string): Point | null {
    for (const objective of this.openObjectives(questId)) { const target = this.targetOf(objective); if (target) return { x: target.x, z: target.z }; }
    return null;
  }
  private objectiveText(objective: Objective, state: ObjectiveState | undefined): string {
    const progress = state?.progress ?? 0;
    if ((objective.kind === "kill" || objective.kind === "collect") && objective.count > 1) return `${objective.text} (${Math.min(progress, objective.count)}/${objective.count})`;
    if (objective.kind === "deliver" && objective.count > 1 && !state?.done) return `${objective.text} (${Math.min(this.host.count(objective.item), objective.count)}/${objective.count})`;
    if (objective.kind === "survive" && !state?.done) return `${objective.text} (${Math.floor(progress)}/${objective.seconds}s)`;
    return objective.text;
  }
  private objectiveViews(questId: string, run: Run): QuestObjectiveView[] {
    const stage = this.stageDef(questId, run.stage);
    return (stage?.objectives ?? []).flatMap(o => {
      const state = run.objectives.get(o.id), done = state?.done === true;
      return o.hidden && !done ? [] : [{ text: this.objectiveText(o, state), done, optional: o.optional === true }];
    });
  }
  private rewardOf(quest: QuestDefinition2): number {
    return Math.max(0, ...Object.values(quest.outcomes).map(o => creditsIn(o.effects)));
  }
}

/** Option styling when content doesn't say: starting a quest reads as accept, an outcome as complete. */
function inferKind(option: DialogueOptionDef): OptionKind {
  const effects = option.effects ?? [];
  if (effects.some(e => "startQuest" in e)) return "accept";
  if (effects.some(e => "outcome" in e)) return "complete";
  if (option.next === null && !effects.length && !option.check) return "leave";
  return "continue";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
