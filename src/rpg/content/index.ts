// Public API of rpg/content: the game's content packs, pure data. The session registers every pack
// (items, loot, vendors, archetypes/encounters, then the whole pack into the QuestEngine). The
// legacy relay-chip quest lives in rpg/quests (LEGACY_PACK) and is not duplicated here; Dead Air
// requires it.

import type { ContentPack } from "../types.ts";
import { BOUNTY_PACK } from "./bounty-board.ts";
import { CAST_PACK } from "./cast.ts";
import { COLD_CHAIN_PACK } from "./cold-chain.ts";
import { EMBER_CORE_PACK } from "./ember-core.ts";
import { FACTIONS_PACK } from "./factions.ts";
import { OUT_OF_ORDER_PACK } from "./out-of-order.ts";
import { QUIET_MONEY_PACK } from "./quiet-money.ts";
import { HUSH_PACK } from "./story-hush.ts";
import { NIGHT_SHIFT_PACK } from "./night-shift.ts";
import { KILN_WORKBENCH_PACK } from "./kiln-workbench.ts";
import { TUSK_TAX_PACK } from "./tusk-tax.ts";
import { WEATHERMAN_PACK } from "./weatherman.ts";
import { WITNESS_PACK } from "./witness.ts";

/** Every content pack, in registration order (factions and cast first: others reference them). */
export const CONTENT_PACKS: readonly ContentPack[] = [
  FACTIONS_PACK, CAST_PACK, HUSH_PACK,
  OUT_OF_ORDER_PACK, BOUNTY_PACK, WEATHERMAN_PACK, WITNESS_PACK, QUIET_MONEY_PACK, COLD_CHAIN_PACK, EMBER_CORE_PACK, TUSK_TAX_PACK, NIGHT_SHIFT_PACK, KILN_WORKBENCH_PACK,
];

/** Individual packs (for tests and tooling). */
export { BOUNTY_PACK, CAST_PACK, COLD_CHAIN_PACK, EMBER_CORE_PACK, FACTIONS_PACK, HUSH_PACK, KILN_WORKBENCH_PACK, NIGHT_SHIFT_PACK, OUT_OF_ORDER_PACK, QUIET_MONEY_PACK, TUSK_TAX_PACK, WEATHERMAN_PACK, WITNESS_PACK };
/** The named cast and faction display names. */
export { CAST } from "./cast.ts";
export { FACTION_NAMES } from "./factions.ts";
/** The difficulty curve by district and the Rootwood Park boss arena. */
export { ARENA, DISTRICT_LEVEL, arenaPoint } from "./places.ts";
