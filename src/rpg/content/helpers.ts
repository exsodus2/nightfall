// Tiny pure helpers for writing content packs by hand. Data in, data out: no state, no randomness.

import type { NpcLook } from "../../city/npcs.ts";
import type { Area, Condition, DialogueNode, DialogueOptionDef, Effect, EncounterDefinition, Point, QuestStage } from "../types.ts";

type RGB = readonly [number, number, number];

/** A plain "Leave" option (ends the conversation). */
export const LEAVE: DialogueOptionDef = { id: "leave", label: "Leave", kind: "leave", next: null };
/** A "Leave" option with custom wording. */
export const bye = (label: string, id = "leave"): DialogueOptionDef => ({ id, label, kind: "leave", next: null });
/** A "continue" option that walks to another node. */
export const go = (id: string, label: string, next: string, extra: Partial<DialogueOptionDef> = {}): DialogueOptionDef => ({ id, label, kind: "continue", next, ...extra });
/** A node with lines and options. */
export const node = (id: string, lines: readonly string[], options: readonly DialogueOptionDef[], effects?: readonly Effect[]): DialogueNode =>
  (effects ? { id, lines, options, effects } : { id, lines, options });

/** Quest status shorthands for conditions. */
export const available = (quest: string): Condition => ({ quest, status: "available" });
export const active = (quest: string): Condition => ({ quest, status: "active" });
export const completed = (quest: string): Condition => ({ quest, status: "complete" });
export const inStage = (quest: string, stage: string): Condition => ({ quest, stage });
export const flagIs = (flag: string, is: string | number | boolean): Condition => ({ flag, is });

/** A stage with no objectives that ends the quest with `outcome` the moment it is entered. The
 * pattern for "dialogue decides the ending": options set flags, a stage's `next` branches on
 * them into one of these, and the quest graph (not the dialogue) owns every outcome. */
export function ending(id: string, journal: string, outcome: string, effects: readonly Effect[] = []): QuestStage {
  return { id, journal, objectives: [], onComplete: [...effects, { outcome }] };
}

/** NpcLook in one line: coat, trim, skin, light, headwear, prop, idle. */
export function look(coat: RGB, trim: RGB, skin: RGB, light: RGB, headwear: NpcLook["headwear"], prop: NpcLook["prop"], idle: NpcLook["idle"]): NpcLook {
  return { coat, trim, skin, light, headwear, prop, idle };
}

/** Headings (engine yaw: 0 faces north / -z, PI/2 faces east / +x). */
export const FACE = { north: 0, east: Math.PI / 2, south: Math.PI, west: -Math.PI / 2 } as const;

/** One encounter member. */
export const member = (archetype: string, x: number, z: number, yaw = 0, extra: { patrol?: readonly Point[]; tag?: string } = {}): EncounterDefinition["members"][number] =>
  ({ archetype, x, z, yaw, ...extra });

/** An area literal. */
export const area = (x: number, z: number, radius: number, label?: string): Area => (label ? { x, z, radius, label } : { x, z, radius });
