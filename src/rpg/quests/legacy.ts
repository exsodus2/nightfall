import { NPCS, type NpcDefinition } from "../../city/npcs.ts";
import { QUESTS, type QuestDefinition } from "../../city/quests.ts";
import type { Condition, ContentPack, DialogueDefinition, DialogueNode, DialogueOptionDef, QuestDefinition2, QuestStage } from "../types.ts";

// The legacy "talk to A, then B, then back to A" quests (src/city/quests.ts QUESTS + the NPC lines in
// src/city/npcs.ts) converted to QuestEngine data. The party server still runs the originals with
// QuestBook; solo play can run these instead and behave the same way (same markers, lines, labels,
// toasts and reward). Stage ids: "step-<i>" for each step, then "return" for the hand-in.

const LEAVE: DialogueOptionDef = { id: "leave", label: "Leave", kind: "leave", next: null };

/** Dialogue id of a legacy quest's conversation with one NPC. */
export function legacyDialogueId(questId: string, npcId: string): string { return `legacy.${questId}.${npcId}`; }

/** Converts one legacy QuestBook quest into a QuestDefinition2 plus per-NPC dialogues. */
export function convertLegacyQuest(quest: QuestDefinition, npcs: readonly NpcDefinition[] = NPCS): { quest: QuestDefinition2; dialogues: DialogueDefinition[] } {
  const stageIds = [...quest.steps.map((_, i) => `step-${i}`), "return"];
  const lines = (npcId: string) => npcs.find(n => n.id === npcId)?.quests?.[quest.id] ?? {};
  const inStage = (stage: string): Condition => ({ quest: quest.id, stage });
  const objectiveOf = (i: number) => (i < quest.steps.length ? quest.steps[i].objective : quest.returnObjective);

  // One dialogue per NPC involved. Entry priorities reproduce QuestBook's order of business:
  // hand-in 50 > step 40 > offer 30 > reminder 20 > afterwards 10.
  const dialogues = new Map<string, { entries: DialogueDefinition["entries"][number][]; nodes: DialogueNode[] }>();
  const dialogueFor = (npcId: string) => {
    let d = dialogues.get(npcId);
    if (!d) { d = { entries: [], nodes: [] }; dialogues.set(npcId, d); }
    return d;
  };

  const stages: QuestStage[] = quest.steps.map((step, i) => {
    const d = dialogueFor(step.npc), said = lines(step.npc), next = objectiveOf(i + 1);
    d.entries.push({ condition: inStage(stageIds[i]), node: `step-${i}`, priority: 40 });
    d.nodes.push(
      { id: `step-${i}`, lines: said.step ?? [step.objective], options: [{ id: `step-${i}`, label: step.action, kind: "continue", effects: [{ message: `${step.update}: ${next}`, tone: "quest" }], next: `handover-${i}` }, LEAVE] },
      { id: `handover-${i}`, lines: said.handover ?? [next], options: [LEAVE] },
    );
    if (said.after?.length) {
      // "Afterwards" = any later stage, or the quest is finished.
      const later: Condition[] = [...stageIds.slice(i + 1).map(inStage), { quest: quest.id, status: "complete" }];
      d.entries.push({ condition: { any: later }, node: `after-${i}`, priority: 10 });
      d.nodes.push({ id: `after-${i}`, lines: said.after, options: [LEAVE] });
    }
    return { id: stageIds[i], journal: step.objective, objectives: [{ id: `step-${i}`, kind: "choose", text: step.objective, dialogue: legacyDialogueId(quest.id, step.npc), options: [`step-${i}`] }], next: stageIds[i + 1] };
  });

  const giver = dialogueFor(quest.giver), said = lines(quest.giver);
  stages.push({
    id: "return", journal: quest.returnObjective,
    objectives: [{ id: "return", kind: "choose", text: quest.returnObjective, dialogue: legacyDialogueId(quest.id, quest.giver), options: ["complete"] }],
    onComplete: [{ outcome: "complete" }],
  });
  giver.entries.push(
    { condition: inStage("return"), node: "turn-in", priority: 50 },
    { condition: { quest: quest.id, status: "available" }, node: "offer", priority: 30 },
  );
  // Reminders name the current objective when the giver has no reminder lines of their own.
  if (said.reminder?.length) giver.entries.push({ condition: { quest: quest.id, status: "active" }, node: "reminder", priority: 20 });
  else quest.steps.forEach((_, i) => giver.entries.push({ condition: inStage(stageIds[i]), node: `reminder-${i}`, priority: 20 }));
  if (said.thanks?.length) giver.entries.push({ condition: { quest: quest.id, status: "complete" }, node: "thanks", priority: 10 });
  giver.nodes.push(
    { id: "offer", lines: said.offer ?? [quest.summary], options: [
      { id: "accept", label: quest.acceptLabel, kind: "accept", effects: [{ startQuest: quest.id }], next: "accepted" },
      { id: "decline", label: quest.declineLabel, kind: "decline", next: null },
    ] },
    { id: "accepted", lines: said.accepted ?? [objectiveOf(0)], options: [LEAVE] },
    { id: "turn-in", lines: said.turnIn ?? [quest.returnObjective], options: [{ id: "complete", label: `${quest.completeLabel} (+${quest.reward} cr)`, kind: "complete", next: "thanks" }, LEAVE] },
    { id: "thanks", lines: said.thanks ?? ["Thank you."], options: [LEAVE] },
    ...(said.reminder?.length ? [{ id: "reminder", lines: said.reminder, options: [LEAVE] }] : quest.steps.map((step, i) => ({ id: `reminder-${i}`, lines: [step.objective], options: [LEAVE] }))),
  );

  return {
    quest: {
      id: quest.id, title: quest.title, category: "side", giver: quest.giver, summary: quest.summary,
      requires: quest.requires?.length ? { all: quest.requires.map(id => ({ quest: id })) } : undefined,
      rewardHint: `${quest.reward} cr`, start: stageIds[0], stages,
      outcomes: { complete: { title: "Completed", journal: (said.thanks ?? ["Paid in full."]).join(" "), effects: [{ credits: quest.reward }] } },
    },
    dialogues: [...dialogues].map(([npc, d]) => ({ id: legacyDialogueId(quest.id, npc), npc, quest: quest.id, entries: d.entries, nodes: d.nodes })),
  };
}

/** Converts a list of legacy quests into one content pack. */
export function legacyPack(quests: readonly QuestDefinition[] = QUESTS, npcs: readonly NpcDefinition[] = NPCS): ContentPack {
  const converted = quests.map(q => convertLegacyQuest(q, npcs));
  return { id: "legacy", quests: converted.map(c => c.quest), dialogues: converted.flatMap(c => c.dialogues) };
}

/** The existing relay-chip quest (and any other legacy QUESTS) as QuestEngine content. */
export const LEGACY_PACK: ContentPack = legacyPack();
