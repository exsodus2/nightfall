import { NPCS } from "../../city/npcs.ts";
import type { Condition, ContentPack, DialogueDefinition, Effect, EncounterDefinition, EnemyArchetype, Objective, QuestDefinition2, QuestStage } from "../types.ts";
import { splitRef } from "./conditions.ts";

// Static checks for content packs: the owner's safety net for writing lots of quests by hand.
// Every message names the pack and the path to the problem ("quest "x" stage "y" objective "z": ...").
//
// References resolve against the pack itself, the context packs (other content, the item database,
// combat archetypes...) and the city's standing NPC cast. Item and archetype ids are only checked when
// at least one item / archetype is known, so a quest-only pack can be checked without the item DB.

const QUEST_STATUSES = new Set(["locked", "available", "active", "complete", "failed"]);
const STATS = new Set(["cool", "tech", "street"]);
const KINDS = new Set(["accept", "decline", "complete", "continue", "leave"]);
const CATEGORIES = new Set(["story", "side", "contract", "gig"]);
const OBJECTIVE_KINDS = new Set(["talk", "kill", "clear", "collect", "deliver", "reach", "visit", "interact", "survive", "choose", "condition"]);

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const text = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;
const countOk = (n: unknown) => finite(n) && Number.isInteger(n) && n >= 1;

/** Returns human-readable problems in `pack` (empty = OK). `context` packs are only used to resolve
 * references (items, encounters, NPCs, quests defined elsewhere); they are not themselves checked. */
export function validateContent(pack: ContentPack, context?: ContentPack | readonly ContentPack[]): string[] {
  const errors: string[] = [];
  const others = context === undefined ? [] : Array.isArray(context) ? context as readonly ContentPack[] : [context as ContentPack];
  const all = [pack, ...others.filter(p => p !== pack)];
  const err = (where: string, message: string) => errors.push(`${pack.id || "(pack)"}: ${where}: ${message}`);
  const q = (id: string) => JSON.stringify(id);

  // ---- Known ids -----------------------------------------------------------------------------------
  const npcIds = new Set([...NPCS.map(n => n.id), ...all.flatMap(p => (p.npcs ?? []).map(n => n.id))]);
  const itemIds = new Set(all.flatMap(p => (p.items ?? []).map(i => i.id)));
  const archetypes = new Map<string, EnemyArchetype>(all.flatMap(p => (p.archetypes ?? []).map(a => [a.id, a] as const)));
  const encounters = new Map<string, EncounterDefinition>(all.flatMap(p => (p.encounters ?? []).map(e => [e.id, e] as const)));
  const quests = new Map<string, QuestDefinition2>(all.flatMap(p => (p.quests ?? []).map(x => [x.id, x] as const)));
  const dialogues = new Map<string, DialogueDefinition>(all.flatMap(p => (p.dialogues ?? []).map(d => [d.id, d] as const)));
  const interactables = new Set(all.flatMap(p => (p.interactables ?? []).map(i => i.id)));
  const lootTables = all.flatMap(p => p.loot ?? []);
  // Pack definitions win over context ones with the same id (that's what register() does too).
  for (const x of pack.quests ?? []) quests.set(x.id, x);
  for (const d of pack.dialogues ?? []) dialogues.set(d.id, d);
  for (const e of pack.encounters ?? []) encounters.set(e.id, e);

  const knownItem = (id: string, where: string) => { if (itemIds.size && !itemIds.has(id)) err(where, `unknown item ${q(id)}`); };
  const knownNpc = (id: string, where: string, allowObject = false) => {
    if (!npcIds.has(id) && !(allowObject && interactables.has(id))) err(where, `unknown ${allowObject ? "NPC or interactable" : "NPC"} ${q(id)}`);
  };
  const knownEncounter = (id: string, where: string) => { if (!encounters.has(id)) err(where, `unknown encounter ${q(id)}`); };

  // ---- Duplicate ids within the pack ---------------------------------------------------------------
  const dupes = (kind: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!text(id)) err(kind, "an entry has an empty id");
      else if (seen.has(id)) err(`${kind} ${q(id)}`, "duplicate id");
      seen.add(id);
    }
  };
  dupes("quest", (pack.quests ?? []).map(x => x.id));
  dupes("dialogue", (pack.dialogues ?? []).map(x => x.id));
  dupes("interactable", (pack.interactables ?? []).map(x => x.id));
  dupes("area", (pack.areas ?? []).map(x => x.id));
  dupes("npc", (pack.npcs ?? []).map(x => x.id));
  dupes("encounter", (pack.encounters ?? []).map(x => x.id));

  // ---- Everything any effect anywhere does (for "can this ever happen?" checks) --------------------
  const everyEffect: { effects: readonly Effect[]; quest: string | null }[] = [];
  for (const p of all) {
    for (const x of p.quests ?? []) {
      everyEffect.push({ effects: x.onFail ?? [], quest: x.id });
      for (const o of Object.values(x.outcomes ?? {})) everyEffect.push({ effects: o.effects ?? [], quest: x.id });
      for (const s of x.stages ?? []) everyEffect.push({ effects: [...(s.onEnter ?? []), ...(s.onComplete ?? [])], quest: x.id });
    }
    for (const d of p.dialogues ?? []) for (const n of d.nodes ?? []) {
      everyEffect.push({ effects: n.effects ?? [], quest: d.quest ?? null });
      for (const o of n.options ?? []) everyEffect.push({ effects: o.effects ?? [], quest: d.quest ?? null });
    }
    for (const i of p.interactables ?? []) everyEffect.push({ effects: i.effects ?? [], quest: null });
  }
  const flat = everyEffect.flatMap(e => e.effects.map(effect => ({ effect, quest: e.quest })));
  const started = new Set(flat.flatMap(({ effect }) => ("startQuest" in effect ? [effect.startQuest] : [])));
  const spawned = new Set(flat.flatMap(({ effect }) => ("spawn" in effect ? [effect.spawn] : [])));
  const given = new Set(flat.flatMap(({ effect }) => ("give" in effect ? [effect.give] : [])));
  const itemSources = new Set([...given, ...lootTables.flatMap(t => t.entries.map(e => e.item)), ...all.flatMap(p => (p.vendors ?? []).flatMap(v => v.stock))]);

  /** Resolves a stage/outcome reference like the engine does; reports problems. */
  const resolve = (ref: string, context: string | null, kind: "stage" | "outcome", where: string): { quest: string; id: string } | null => {
    if (!text(ref)) { err(where, `empty ${kind} reference`); return null; }
    const has = (x: QuestDefinition2, id: string) => (kind === "stage" ? (x.stages ?? []).some(s => s.id === id) : id in (x.outcomes ?? {}));
    const { quest, id } = splitRef(ref, context);
    if (quest) {
      const def = quests.get(quest);
      if (!def) { err(where, `${kind} ${q(ref)} names unknown quest ${q(quest)}`); return null; }
      if (!has(def, id)) { err(where, `quest ${q(quest)} has no ${kind} ${q(id)}`); return null; }
      return { quest, id };
    }
    const owners = [...quests.values()].filter(x => has(x, id));
    if (owners.length === 1) return { quest: owners[0].id, id };
    err(where, owners.length ? `${kind} ${q(id)} is ambiguous (in ${owners.map(x => q(x.id)).join(", ")}): write "quest:${id}" or set the dialogue's quest` : `no quest has a ${kind} ${q(id)}`);
    return null;
  };

  // External jumps into a quest (from dialogues, interactables, other quests) make stages reachable.
  const externalStages = new Map<string, Set<string>>();
  const externalOutcomes = new Map<string, Set<string>>();
  const usedOutcomes = new Map<string, Set<string>>();
  const mark = (map: Map<string, Set<string>>, quest: string, id: string) => { const set = map.get(quest) ?? new Set(); set.add(id); map.set(quest, set); };
  const dialogueOptionIds = (d: DialogueDefinition) => new Set((d.nodes ?? []).flatMap(n => (n.options ?? []).map(o => o.id)));
  const openedNodes = new Map<string, Set<string>>();

  function checkCondition(c: Condition | undefined, where: string): void {
    if (c === undefined) return;
    if (typeof c !== "object" || c === null) { err(where, "condition is not an object"); return; }
    if ("all" in c) { if (!Array.isArray(c.all) || !c.all.length) err(where, "`all` needs at least one condition"); else c.all.forEach((x, i) => checkCondition(x, `${where} all[${i}]`)); return; }
    if ("any" in c) { if (!Array.isArray(c.any) || !c.any.length) err(where, "`any` needs at least one condition"); else c.any.forEach((x, i) => checkCondition(x, `${where} any[${i}]`)); return; }
    if ("not" in c) { checkCondition(c.not, `${where} not`); return; }
    if ("flag" in c) { if (!text(c.flag)) err(where, "empty flag name"); return; }
    if ("quest" in c) {
      const def = quests.get(c.quest);
      if (!def) { err(where, `condition names unknown quest ${q(c.quest)}`); return; }
      if (c.stage !== undefined && !(def.stages ?? []).some(s => s.id === c.stage)) err(where, `quest ${q(c.quest)} has no stage ${q(c.stage)}`);
      if (c.outcome !== undefined && !(c.outcome in (def.outcomes ?? {}))) err(where, `quest ${q(c.quest)} has no outcome ${q(c.outcome)}`);
      const statuses = c.status === undefined ? [] : typeof c.status === "string" ? [c.status] : c.status;
      for (const s of statuses) if (!QUEST_STATUSES.has(s)) err(where, `unknown quest status ${q(s)}`);
      return;
    }
    if ("item" in c) { knownItem(c.item, where); if (c.count !== undefined && !(finite(c.count) && c.count >= 0)) err(where, "item count must be >= 0"); return; }
    if ("credits" in c) { if (!finite(c.credits)) err(where, "credits must be a number"); return; }
    if ("level" in c) { if (!finite(c.level)) err(where, "level must be a number"); return; }
    if ("rep" in c) { if (!text(c.rep)) err(where, "empty faction"); if (c.atLeast === undefined && c.atMost === undefined) err(where, "rep condition needs atLeast or atMost"); return; }
    if ("encounterCleared" in c) { knownEncounter(c.encounterCleared, where); return; }
    err(where, `unrecognised condition ${JSON.stringify(c)}`);
  }

  function checkEffects(effects: readonly Effect[] | undefined, where: string, context: string | null): void {
    (effects ?? []).forEach((e, i) => {
      const at = `${where} effect[${i}]`;
      if (typeof e !== "object" || e === null) { err(at, "effect is not an object"); return; }
      if ("setFlag" in e) { if (!text(e.setFlag)) err(at, "empty flag name"); }
      else if ("addFlag" in e) { if (!text(e.addFlag)) err(at, "empty flag name"); if (!finite(e.by)) err(at, "addFlag needs a numeric `by`"); }
      else if ("give" in e || "take" in e) {
        const item = "give" in e ? e.give : e.take;
        knownItem(item, at);
        if (e.count !== undefined && !countOk(e.count)) err(at, "count must be a whole number >= 1");
      }
      else if ("credits" in e) { if (!finite(e.credits)) err(at, "credits must be a number"); }
      else if ("xp" in e) { if (!finite(e.xp) || e.xp < 0) err(at, "xp must be a number >= 0"); }
      else if ("rep" in e) { if (!text(e.rep)) err(at, "empty faction"); if (!finite(e.by)) err(at, "rep needs a numeric `by`"); }
      else if ("startQuest" in e) { if (!quests.has(e.startQuest)) err(at, `startQuest names unknown quest ${q(e.startQuest)}`); }
      else if ("stage" in e) { const r = resolve(e.stage, context, "stage", at); if (r && r.quest !== context) mark(externalStages, r.quest, r.id); }
      else if ("outcome" in e) {
        const r = resolve(e.outcome, context, "outcome", at);
        if (r) { mark(usedOutcomes, r.quest, r.id); if (r.quest !== context) mark(externalOutcomes, r.quest, r.id); }
      }
      else if ("fail" in e) { if (!quests.has(e.fail)) err(at, `fail names unknown quest ${q(e.fail)}`); }
      else if ("spawn" in e) knownEncounter(e.spawn, at);
      else if ("despawn" in e) knownEncounter(e.despawn, at);
      else if ("hostile" in e) { knownEncounter(e.hostile, at); if (typeof e.value !== "boolean") err(at, "hostile needs a boolean `value`"); }
      else if ("waypoint" in e) { if (!finite(e.waypoint?.x) || !finite(e.waypoint?.z)) err(at, "waypoint needs numeric x and z"); if (!text(e.waypoint?.label)) err(at, "waypoint needs a label"); }
      else if ("message" in e) { if (!text(e.message)) err(at, "empty message"); }
      else if ("openDialogue" in e) {
        const d = dialogues.get(e.openDialogue);
        if (!d) err(at, `openDialogue names unknown dialogue ${q(e.openDialogue)}`);
        else if (e.node !== undefined) {
          if (!(d.nodes ?? []).some(n => n.id === e.node)) err(at, `dialogue ${q(d.id)} has no node ${q(e.node)}`);
          else mark(openedNodes, d.id, e.node);
        }
      }
      else err(at, `unrecognised effect ${JSON.stringify(e)}`);
    });
  }

  // ---- NPCs, areas, interactables ------------------------------------------------------------------
  for (const npc of pack.npcs ?? []) {
    const at = `npc ${q(npc.id)}`;
    if (!finite(npc.x) || !finite(npc.z)) err(at, "needs numeric x and z");
    if (!text(npc.name)) err(at, "needs a name");
    if (!Array.isArray(npc.greeting) || !npc.greeting.length) err(at, "needs at least one greeting line");
  }
  for (const area of pack.areas ?? []) {
    const at = `area ${q(area.id)}`;
    if (!finite(area.x) || !finite(area.z)) err(at, "needs numeric x and z");
    if (!finite(area.radius) || area.radius <= 0) err(at, "radius must be > 0");
  }
  for (const it of pack.interactables ?? []) {
    const at = `interactable ${q(it.id)}`;
    if (!finite(it.x) || !finite(it.z)) err(at, "needs numeric x and z");
    if (!text(it.label)) err(at, "needs a label");
    if (it.place !== undefined && it.place !== "" && (typeof it.place !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(it.place))) err(at, "place must be a lowercase interior id or empty for the exterior");
    if (it.dialogue !== undefined && !dialogues.has(it.dialogue)) err(at, `unknown dialogue ${q(it.dialogue)}`);
    if (it.glyph !== undefined && !/^[\x21-\x7e]$/.test(it.glyph)) err(at, "glyph must be one printable ASCII character");
    if (!it.dialogue && !(it.effects ?? []).length) err(at, "does nothing: give it effects or a dialogue");
    checkCondition(it.condition, `${at} condition`);
    checkEffects(it.effects, at, null);
  }

  // ---- Dialogues -----------------------------------------------------------------------------------
  for (const d of pack.dialogues ?? []) {
    const at = `dialogue ${q(d.id)}`;
    knownNpc(d.npc, at, true);
    if (d.quest !== undefined && !quests.has(d.quest)) err(at, `unknown quest ${q(d.quest)}`);
    const nodes = new Map((d.nodes ?? []).map(n => [n.id, n] as const));
    dupes(`${at} node`, (d.nodes ?? []).map(n => n.id));
    if (!(d.entries ?? []).length) err(at, "needs at least one entry");
    (d.entries ?? []).forEach((e, i) => {
      if (!nodes.has(e.node)) err(`${at} entry[${i}]`, `unknown node ${q(e.node)}`);
      checkCondition(e.condition, `${at} entry[${i}] condition`);
    });
    for (const node of d.nodes ?? []) {
      const nat = `${at} node ${q(node.id)}`;
      if (!Array.isArray(node.lines) || !node.lines.length || node.lines.some(l => typeof l !== "string")) err(nat, "needs at least one line");
      checkEffects(node.effects, nat, d.quest ?? null);
      dupes(`${nat} option`, (node.options ?? []).map(o => o.id));
      for (const o of node.options ?? []) {
        const oat = `${nat} option ${q(o.id)}`;
        if (o.id?.startsWith("@")) err(oat, "option ids starting with \"@\" are reserved for the engine");
        if (!text(o.label)) err(oat, "needs a label");
        if (o.kind !== undefined && !KINDS.has(o.kind)) err(oat, `unknown kind ${q(o.kind)}`);
        if (o.next !== null && o.next !== undefined && !nodes.has(o.next)) err(oat, `points to missing node ${q(o.next)}`);
        if (o.next === undefined) err(oat, "needs `next` (a node id, or null to end the conversation)");
        if (o.check) {
          if (!STATS.has(o.check.stat)) err(oat, `unknown stat ${q(o.check.stat)}`);
          if (!finite(o.check.difficulty)) err(oat, "check difficulty must be a number");
          if (!nodes.has(o.check.success)) err(oat, `check success points to missing node ${q(o.check.success)}`);
          if (!nodes.has(o.check.failure)) err(oat, `check failure points to missing node ${q(o.check.failure)}`);
          (o.check.bonus ?? []).forEach((b, i) => { checkCondition(b.if, `${oat} bonus[${i}]`); if (!finite(b.by)) err(`${oat} bonus[${i}]`, "bonus needs a numeric `by`"); });
        }
        checkCondition(o.condition, `${oat} condition`);
        checkEffects(o.effects, oat, d.quest ?? null);
      }
    }
  }
  // Node reachability needs every openDialogue reference, so it runs after all effects were walked.
  const walkLater: (() => void)[] = [];
  walkLater.push(() => {
    for (const d of pack.dialogues ?? []) {
      const nodes = new Map((d.nodes ?? []).map(n => [n.id, n] as const));
      const seen = new Set<string>([...(d.entries ?? []).map(e => e.node), ...(openedNodes.get(d.id) ?? [])]);
      const queue = [...seen];
      while (queue.length) {
        const node = nodes.get(queue.pop()!);
        for (const o of node?.options ?? []) for (const next of [o.next, o.check?.success, o.check?.failure]) {
          if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      for (const id of nodes.keys()) if (!seen.has(id)) err(`dialogue ${q(d.id)} node ${q(id)}`, "unreachable: no entry or option leads here");
    }
  });

  // ---- Quests --------------------------------------------------------------------------------------
  function checkObjective(o: Objective, where: string, stage: QuestStage): void {
    if (!text(o.text)) err(where, "needs player-facing text");
    if (o.target && (!finite(o.target.x) || !finite(o.target.z))) err(where, "target needs numeric x and z");
    const noSource = (item: string) => {
      if (itemIds.has(item) && lootTables.length && !itemSources.has(item)) err(where, `can never complete: nothing gives, drops or sells item ${q(item)}`);
    };
    switch (o.kind) {
      case "talk": knownNpc(o.npc, where); break;
      case "kill": {
        if (!countOk(o.count)) err(where, "count must be a whole number >= 1");
        if (o.archetype !== undefined && archetypes.size && !archetypes.has(o.archetype)) err(where, `unknown archetype ${q(o.archetype)}`);
        const matches = (m: EncounterDefinition["members"][number]) => {
          const arch = archetypes.get(m.archetype);
          return (o.archetype === undefined || m.archetype === o.archetype) && (o.tag === undefined || m.tag === o.tag || !!arch?.tags?.includes(o.tag))
            && (o.faction === undefined || !arch || arch.faction === o.faction);
        };
        if (o.encounter !== undefined) {
          const enc = encounters.get(o.encounter);
          if (!enc) err(where, `unknown encounter ${q(o.encounter)}`);
          else {
            if (!enc.auto && !spawned.has(enc.id)) err(where, `can never complete: encounter ${q(enc.id)} is not auto and nothing spawns it`);
            const n = enc.members.filter(matches).length;
            if (enc.respawn === undefined && finite(o.count) && n < o.count) err(where, `can never complete: encounter ${q(enc.id)} has only ${n} matching member(s) for count ${o.count}`);
          }
        } else if (o.archetype !== undefined && encounters.size && ![...encounters.values()].some(e => e.members.some(m => m.archetype === o.archetype))) {
          err(where, `can never complete: no encounter contains archetype ${q(o.archetype)}`);
        }
        break;
      }
      case "clear": {
        const enc = encounters.get(o.encounter);
        if (!enc) err(where, `unknown encounter ${q(o.encounter)}`);
        else if (!enc.auto && !spawned.has(enc.id)) err(where, `can never complete: encounter ${q(enc.id)} is not auto and nothing spawns it`);
        break;
      }
      case "collect": knownItem(o.item, where); if (!countOk(o.count)) err(where, "count must be a whole number >= 1"); noSource(o.item); break;
      case "deliver":
        knownItem(o.item, where); knownNpc(o.npc, where); noSource(o.item);
        if (!countOk(o.count)) err(where, "count must be a whole number >= 1");
        break;
      case "reach": if (!o.area || !finite(o.area.x) || !finite(o.area.z) || !finite(o.area.radius) || o.area.radius <= 0) err(where, "reach needs an area with x, z and radius > 0"); break;
      case "visit": if (!text(o.area)) err(where, "visit needs a named area id"); break;
      case "interact": if (!interactables.has(o.object)) err(where, `unknown interactable ${q(o.object)}`); break;
      case "survive":
        if (!finite(o.seconds) || o.seconds <= 0) err(where, "seconds must be > 0");
        if (o.area && (!finite(o.area.radius) || o.area.radius <= 0)) err(where, "survive area radius must be > 0");
        if (finite(stage.timeLimit) && finite(o.seconds) && o.seconds > stage.timeLimit) err(where, `can never complete: survive ${o.seconds}s is longer than the stage time limit ${stage.timeLimit}s`);
        break;
      case "choose": {
        const d = dialogues.get(o.dialogue);
        if (!d) err(where, `unknown dialogue ${q(o.dialogue)}`);
        else {
          const ids = dialogueOptionIds(d);
          if (!o.options?.length) err(where, "choose needs at least one option id");
          for (const id of o.options ?? []) if (!ids.has(id)) err(where, `dialogue ${q(d.id)} has no option ${q(id)}`);
        }
        break;
      }
      case "condition": checkCondition(o.condition, `${where} condition`); break;
      default: err(where, `unknown objective kind ${q(String((o as { kind?: unknown }).kind))}`);
    }
  }

  for (const quest of pack.quests ?? []) {
    const at = `quest ${q(quest.id)}`;
    const stages = new Map((quest.stages ?? []).map(s => [s.id, s] as const));
    const outcomes = Object.keys(quest.outcomes ?? {});
    if (!text(quest.title)) err(at, "needs a title");
    if (!text(quest.summary)) err(at, "needs a summary");
    if (!CATEGORIES.has(quest.category)) err(at, `unknown category ${q(String(quest.category))}`);
    if (quest.giver !== null) knownNpc(quest.giver, `${at} giver`);
    if (quest.giver === null && !quest.trigger && !started.has(quest.id)) err(at, "can never start: no giver, no trigger area and no startQuest effect");
    if (quest.trigger && (!finite(quest.trigger.x) || !finite(quest.trigger.z) || !finite(quest.trigger.radius) || quest.trigger.radius <= 0)) err(`${at} trigger`, "needs x, z and radius > 0");
    if (quest.repeatable && (!finite(quest.repeatable.cooldown) || quest.repeatable.cooldown < 0)) err(`${at} repeatable`, "cooldown must be a number >= 0");
    checkCondition(quest.requires, `${at} requires`);
    checkEffects(quest.onFail, `${at} onFail`, quest.id);
    if (!(quest.stages ?? []).length) err(at, "needs at least one stage");
    dupes(`${at} stage`, (quest.stages ?? []).map(s => s.id));
    if (!stages.has(quest.start)) err(at, `start stage ${q(quest.start)} does not exist`);
    if (!outcomes.length) err(at, "needs at least one outcome");
    for (const [id, o] of Object.entries(quest.outcomes ?? {})) {
      if (!text(o.title) || !text(o.journal)) err(`${at} outcome ${q(id)}`, "needs a title and journal text");
      checkEffects(o.effects, `${at} outcome ${q(id)}`, quest.id);
    }
    for (const stage of quest.stages ?? []) {
      const sat = `${at} stage ${q(stage.id)}`;
      if (stage.id?.includes(":")) err(sat, "stage ids may not contain \":\"");
      if (!text(stage.journal)) err(sat, "needs journal text");
      if (stage.mode !== undefined && stage.mode !== "all" && stage.mode !== "any") err(sat, `unknown mode ${q(String(stage.mode))}`);
      dupes(`${sat} objective`, (stage.objectives ?? []).map(o => o.id));
      const objectives = stage.objectives ?? [];
      if (objectives.length && objectives.every(o => o.optional)) err(sat, "completes immediately: every objective is optional (make at least one required)");
      for (const o of objectives) {
        if (!OBJECTIVE_KINDS.has(o.kind)) { err(`${sat} objective ${q(o.id)}`, `unknown objective kind ${q(String(o.kind))}`); continue; }
        checkObjective(o, `${sat} objective ${q(o.id)}`, stage);
      }
      if (typeof stage.next === "string") { if (!stages.has(stage.next)) err(sat, `next stage ${q(stage.next)} does not exist`); }
      else if (Array.isArray(stage.next)) {
        if (!stage.next.length) err(sat, "`next` branch list is empty");
        stage.next.forEach((b, i) => { if (!stages.has(b.stage)) err(`${sat} next[${i}]`, `stage ${q(b.stage)} does not exist`); checkCondition(b.if, `${sat} next[${i}] if`); });
        if (stage.next.length && stage.next.every(b => b.if !== undefined)) err(sat, "`next` branches have no fallback: end the list with a branch without `if`");
      }
      if (stage.timeLimit !== undefined && (!finite(stage.timeLimit) || stage.timeLimit <= 0)) err(sat, "timeLimit must be > 0 seconds");
      if (stage.onTimeout !== undefined) {
        if (!stages.has(stage.onTimeout)) err(sat, `onTimeout stage ${q(stage.onTimeout)} does not exist`);
        if (stage.timeLimit === undefined) err(sat, "onTimeout without a timeLimit never fires");
      }
      checkCondition(stage.failIf, `${sat} failIf`);
      checkEffects(stage.onEnter, `${sat} onEnter`, quest.id);
      checkEffects(stage.onComplete, `${sat} onComplete`, quest.id);
    }
  }

  // ---- Quest graphs (need every external stage/outcome reference collected above) -----------------
  for (const quest of pack.quests ?? []) {
    const at = `quest ${q(quest.id)}`;
    const stages = new Map((quest.stages ?? []).map(s => [s.id, s] as const));
    if (!stages.has(quest.start)) continue;
    const ownJumps = (s: QuestStage) => [...(s.onEnter ?? []), ...(s.onComplete ?? [])].flatMap(e => {
      if (!("stage" in e)) return [];
      const { quest: owner, id } = splitRef(e.stage, quest.id);
      return owner === quest.id && stages.has(id) ? [id] : [];
    });
    const edges = (s: QuestStage) => [
      ...(typeof s.next === "string" ? [s.next] : Array.isArray(s.next) ? s.next.map(b => b.stage) : []),
      ...(s.onTimeout ? [s.onTimeout] : []), ...ownJumps(s),
    ].filter(id => stages.has(id));
    const setsOutcome = (s: QuestStage) => [...(s.onEnter ?? []), ...(s.onComplete ?? [])].some(e => "outcome" in e && splitRef(e.outcome, quest.id).quest === quest.id);
    const terminal = (s: QuestStage) => s.next === undefined || (Array.isArray(s.next) && s.next.every(b => b.if !== undefined));
    const outcomes = Object.keys(quest.outcomes ?? {});

    // Reachability from the start stage and from outside jumps.
    const reachable = new Set<string>([quest.start, ...(externalStages.get(quest.id) ?? [])]);
    const queue = [...reachable];
    while (queue.length) for (const next of edges(stages.get(queue.pop()!)!)) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    for (const id of stages.keys()) if (!reachable.has(id)) err(`${at} stage ${q(id)}`, "unreachable: no next, branch, onTimeout or stage effect leads here");

    // Every reachable stage must be able to reach an ending (unless dialogue/other content ends it).
    if (!(externalOutcomes.get(quest.id)?.size)) {
      const ends = new Set([...stages.values()].filter(s => terminal(s) || setsOutcome(s)).map(s => s.id));
      let grew = true;
      while (grew) {
        grew = false;
        for (const s of stages.values()) if (!ends.has(s.id) && edges(s).some(n => ends.has(n))) { ends.add(s.id); grew = true; }
      }
      if (!ends.has(quest.start)) err(at, "no path to an outcome: every route from the start loops forever");
      else for (const id of reachable) if (!ends.has(id)) err(`${at} stage ${q(id)}`, "dead end: no route from here reaches an outcome");
    }
    // Endings that don't name an outcome only make sense when there is exactly one.
    if (outcomes.length > 1) {
      for (const s of stages.values()) if (reachable.has(s.id) && terminal(s) && !setsOutcome(s)) err(`${at} stage ${q(s.id)}`, `ends the quest without an outcome effect (quest has ${outcomes.length} outcomes: add { outcome: "..." } to onComplete)`);
      const used = usedOutcomes.get(quest.id) ?? new Set<string>();
      for (const o of outcomes) if (!used.has(o)) err(`${at} outcome ${q(o)}`, "can never happen: no effect sets it");
    }
  }
  for (const later of walkLater) later();
  return errors;
}
