// Public API of the quest + dialogue runtime (rpg/quests). Other systems import only from here.
//
// Integration (the session wires this):
//  - Solo: `new QuestEngine({ bus, host, npcs: NPCS })`, then `register(LEGACY_PACK)` and every content
//    pack. Call `update(dt, player)` once per frame (after combat/items have emitted their events).
//    Route E-on-NPC to `talk`, dialogue clicks to `choose`, E-on-object to `interact`; the HUD reads
//    `snapshot(nearbyNpc)`, NPC markers `marker(id)`. Effects that open a dialogue outside a click
//    (stage onEnter during `update`) show up in `engine.dialogue`, so poll it after `update`.
//    Quest transitions are announced as bus `message` events; `choose` also returns the most important
//    one as DialogueResult.message (the legacy toast path) - show one or the other, not both.
//  - Party (multiplayer): keep QuestBook + server/room.ts for the legacy talk-step quests and do NOT
//    register LEGACY_PACK (same quest ids). The engine can still run RPG packs locally beside it.

/** The data-driven quest, dialogue, interactable and world-flag runtime. */
export { QuestEngine, type QuestEngineOptions, type QuestEngineState } from "./engine.ts";
/** Pure condition/effect evaluation, for the engine and for unit-testing content. */
export { evaluate, applyEffects, unmetReason, flagOn, splitRef, creditsIn, type ConditionContext, type EffectContext, type QuestView } from "./conditions.ts";
/** Static content checker: returns human-readable errors (empty = OK). */
export { validateContent } from "./validate.ts";
/** The legacy QuestBook quests (relay-chip) converted to QuestEngine content. */
export { LEGACY_PACK, legacyPack, convertLegacyQuest, legacyDialogueId } from "./legacy.ts";
