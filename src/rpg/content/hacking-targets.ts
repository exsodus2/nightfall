// Hacking content: the ATMs and locked service doors on the shopfronts (positions from
// rpg/hacking/sites.ts, so the props and the E points match), the Splice Deck and where to get it
// (a parts bin on Second Life Salvage's counter, or a back room), and the back-room loot.
//
// The street targets depend on the city, so they are built per world (hackingTargets) and kept by
// the session outside the quest engine: they need no floating marker, the ATM itself is the sign.

import type { CityWorld } from "../../city/world.ts";
import { BACKROOM_TABLE, VAULT_TABLE, hackSites } from "../hacking/index.ts";
import type { ContentPack, DialogueDefinition, InteractableDefinition, ItemDefinition, LootTable } from "../types.ts";
import { LEAVE, bye, node } from "./helpers.ts";

export const SPLICE_DECK = "splice-deck";
const SPLICE_PRICE = 260;

const LABELS = { atm: "Hack the ATM", medium: "Hack the service door", hard: "Hack the corp service terminal" } as const;

/** Every ATM and service door in `world` as an interactable with a `hack` spec. */
export function hackingTargets(world: CityWorld): InteractableDefinition[] {
  return hackSites(world).map(site => ({
    id: site.id, x: site.x, z: site.z, y: site.y, glyph: site.kind === "atm" ? "$" : "#",
    label: site.kind === "atm" ? LABELS.atm : site.tier === "hard" ? LABELS.hard : LABELS.medium,
    hack: { kind: site.kind, tier: site.tier, district: site.district },
  }));
}

const items: ItemDefinition[] = [{
  id: SPLICE_DECK, name: "Splice Deck", kind: "junk", rarity: "rare", glyph: "%", value: 320, weight: 0.4, stack: 1, tags: ["tech", "tool"],
  art: ["  .------------.", "  | [::] [::]  |=", "  |  splice    |=", "  '------------'"],
  description: "A bank-terminal board rebuilt by hand, with a ribbon lead and a crocodile clip. Carried in your pack, it holds the trace back: every breach gets a third more time.",
}];

const loot: LootTable[] = [
  {
    id: BACKROOM_TABLE, rolls: 2, empty: 0.1, credits: [60, 160],
    entries: [
      { item: "ammo-pistol", weight: 6, min: 16, max: 36 }, { item: "ammo-shell", weight: 3, min: 6, max: 12 }, { item: "stim", weight: 3 }, { item: "medkit", weight: 2 },
      { item: "circuit-board", weight: 3 }, { item: "encrypted-drive", weight: 2 }, { item: "pool:rare:gear", weight: 1 }, { item: SPLICE_DECK, weight: 0.5 },
    ],
  },
  {
    id: VAULT_TABLE, rolls: 3, empty: 0.05, credits: [140, 320],
    entries: [
      { item: "ammo-rifle", weight: 4, min: 20, max: 40 }, { item: "ammo-pistol", weight: 3, min: 24, max: 48 }, { item: "encrypted-drive", weight: 4 }, { item: "focus-chip", weight: 2 },
      { item: "medkit", weight: 2 }, { item: "pool:rare:gear", weight: 2 }, { item: "pool:epic:gear", weight: 0.4 }, { item: SPLICE_DECK, weight: 0.8 },
    ],
  },
];

/** The parts bin on Second Life Salvage's counter (right of centre; the room's frame has yaw 0). */
export const SPLICE_BIN: InteractableDefinition = {
  id: "second-life.splice-bin", label: "Look through the bank-parts bin", place: "second-life",
  x: 431.5, z: 233.4, y: 1.7, glyph: "%", dialogue: "second-life.splice",
};

const dialogue: DialogueDefinition = {
  id: "second-life.splice", npc: SPLICE_BIN.id,
  entries: [{ condition: { item: SPLICE_DECK }, node: "owned" }, { node: "offer" }],
  nodes: [
    node("offer", [
      `[A bin of gutted bank terminals. One board has been rebuilt by hand and tagged: SPLICE DECK - ${SPLICE_PRICE}. NO REFUNDS. NO QUESTIONS.]`,
      "Clip it into an ATM or a door panel and the trace takes a third longer to find you. Keep it in your pack; it does the rest.",
    ], [
      {
        id: "buy-splice", label: `Buy the Splice Deck. (${SPLICE_PRICE} cr)`, kind: "accept", condition: { credits: SPLICE_PRICE }, reason: `Needs ${SPLICE_PRICE} cr`,
        effects: [{ credits: -SPLICE_PRICE }, { give: SPLICE_DECK }, { message: "Splice Deck in your pack: every breach gets a third more time.", tone: "loot" }], next: "owned",
      },
      bye("Leave the bin."),
    ]),
    node("owned", ["[The bin is down to scrap. Someone has written on the lid: ONE PER CUSTOMER. WE KNOW WHAT YOU USE THEM FOR.]"], [LEAVE]),
  ],
};

export const HACKING_PACK: ContentPack = { id: "hacking", items, loot, interactables: [SPLICE_BIN], dialogues: [dialogue] };
