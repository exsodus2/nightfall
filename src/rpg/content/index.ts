// Public API of rpg/content: the game's content packs, pure data. The session registers every pack
// (items, loot, vendors, archetypes/encounters, then the whole pack into the QuestEngine). The
// legacy relay-chip quest lives in rpg/quests (LEGACY_PACK) and is not duplicated here; Dead Air
// requires it.

import type { ContentPack } from "../types.ts";
import { BOUNTY_PACK } from "./bounty-board.ts";
import { CAST_PACK } from "./cast.ts";
import { COURIER_PACK } from "./courier.ts"; // Courier: parcel runs between building interiors
import { COLD_CHAIN_PACK } from "./cold-chain.ts";
import { DEAD_LETTER_PACK } from "./dead-letter.ts";
import { EMBER_CORE_PACK } from "./ember-core.ts";
import { FACTIONS_PACK } from "./factions.ts";
import { GLASSHOUSE_PACK } from "./glasshouse.ts";
import { OUT_OF_ORDER_PACK } from "./out-of-order.ts";
import { QUIET_MONEY_PACK } from "./quiet-money.ts";
import { HUSH_PACK } from "./story-hush.ts";
import { NIGHT_SHIFT_PACK } from "./night-shift.ts";
import { KILN_WORKBENCH_PACK } from "./kiln-workbench.ts";
import { TUSK_TAX_PACK } from "./tusk-tax.ts";
import { UNDERTONE_PACK } from "./undertone.ts";
import { THE_STATIC_PACK } from "./the-static.ts";
import { WEATHERMAN_PACK } from "./weatherman.ts";
import { WITNESS_PACK } from "./witness.ts";
import { RIM_LINE_PACK } from "./rim-line.ts";
import { ROOTWOOD_PACK } from "./rootwood.ts";
import { COLD_IRON_PACK } from "./cold-iron.ts";
import { STREET_ENCOUNTERS_PACK } from "./encounters.ts";
import { HARBOUR_WATCH_PACK } from "./harbour-watch.ts";
import { NIGHT_OF_LANTERNS_PACK } from "./night-of-lanterns.ts";
import { RENT_IS_DUE_PACK } from "./rent-is-due.ts";
import { OFF_THE_DIAL_PACK } from "./off-the-dial.ts";
import { RAINLINE_TICKET_PACK } from "./rainline-ticket.ts";
import { HACKING_PACK } from "./hacking-targets.ts"; // Hacking
import { MAIN_QUESTLINE_PACKS } from "./main-questline.ts"; // Main questline: The Rain That Remembers
import { SECRETS_PACK } from "./secrets.ts"; // Secrets: twenty discoveries (city/secrets.ts)

/** Every content pack, in registration order (factions and cast first: others reference them). */
export const CONTENT_PACKS: readonly ContentPack[] = [
  FACTIONS_PACK, CAST_PACK, HUSH_PACK,
  OUT_OF_ORDER_PACK, BOUNTY_PACK, WEATHERMAN_PACK, WITNESS_PACK, QUIET_MONEY_PACK, COLD_CHAIN_PACK, EMBER_CORE_PACK, TUSK_TAX_PACK, NIGHT_SHIFT_PACK, KILN_WORKBENCH_PACK, DEAD_LETTER_PACK, GLASSHOUSE_PACK, UNDERTONE_PACK, THE_STATIC_PACK,
  RIM_LINE_PACK, ROOTWOOD_PACK, COLD_IRON_PACK,
  HARBOUR_WATCH_PACK, NIGHT_OF_LANTERNS_PACK, RENT_IS_DUE_PACK, OFF_THE_DIAL_PACK, RAINLINE_TICKET_PACK,
  STREET_ENCOUNTERS_PACK,
  COURIER_PACK, // Courier: repeatable interior-to-interior parcel runs (Silk Market dispatch terminal)
  HACKING_PACK, // Hacking: Splice Deck, back-room loot, the Second Life parts bin (street targets: session.ts)
  ...MAIN_QUESTLINE_PACKS, // Main questline: The Rain That Remembers, five acts (docs/story.md)
  SECRETS_PACK, // Secrets: the cat, the fridge, the koi and seventeen more
];

/** Individual packs (for tests and tooling). */
export { BOUNTY_PACK, CAST_PACK, COURIER_PACK, COLD_CHAIN_PACK, COLD_IRON_PACK, DEAD_LETTER_PACK, EMBER_CORE_PACK, FACTIONS_PACK, GLASSHOUSE_PACK, HUSH_PACK, KILN_WORKBENCH_PACK, NIGHT_SHIFT_PACK, OUT_OF_ORDER_PACK, QUIET_MONEY_PACK, RIM_LINE_PACK, ROOTWOOD_PACK, THE_STATIC_PACK, TUSK_TAX_PACK, UNDERTONE_PACK, WEATHERMAN_PACK, WITNESS_PACK };
/** Tonight's quest lines around the city events and sights. */
export { HARBOUR_WATCH_PACK, NIGHT_OF_LANTERNS_PACK, OFF_THE_DIAL_PACK, RAINLINE_TICKET_PACK, RENT_IS_DUE_PACK };
/** The named cast and faction display names. */
export { CAST } from "./cast.ts";
export { FACTION_NAMES } from "./factions.ts";
/** The difficulty curve by district and the Rootwood Park boss arena. */
export { ARENA, DISTRICT_LEVEL, arenaPoint } from "./places.ts";
/** The main questline, "The Rain That Remembers" (docs/story.md): one pack per act. */
export { MAIN_ACT1_PACK, MAIN_ACT2_PACK, MAIN_ACT3_PACK, MAIN_ACT4_PACK, MAIN_ACT5_PACK, MAIN_QUESTLINE_PACKS } from "./main-questline.ts";
