// The main questline, "The Rain That Remembers": what every act file shares. Quest ids, world
// flags, where everyone stands, the story items and the few phrases several acts repeat.
// The story bible (premise, cast voices, every beat and consequence, the writing rules) is
// docs/story.md. Act files: main-act1.ts .. main-act5.ts.
//
// World flags the questline sets (read by later acts and by post-game lines):
//   rain.nell      "held" | "sealed"         Act 1: let Nell Ashby hold the drive, or courier rules
//   rain.drive     "logged" | "off-book"     Act 1: Dead Letter logged the drive, or nobody did
//   rain.moth      "aired" | "held"          Act 2: Station Nobody broadcast Nell's voicemail, or not
//   rain.window    "played" | "told"         Act 2: Nell heard the tape, or only the news
//   rain.flood-truth  true                   Act 3 (optional): Agnes Pell told you what caused the Flood
//   rain.shipment  "burned" | "through"      Act 3: the Nami Maru lots burned, or went on to Kiln Nine
//   rain.governor  "fitted" | "kept"         Act 4: the Loom's governor went back to Bet, or you kept it
//   rain.trunk     "cut" | "tapped"          Act 4: the CLIMATE breaker thrown, or Moth's tap spliced in
//   rain.lantern   true                      Act 5: you hung a lantern for Iris with Dr. Crane
//   rain.ending    "released" | "burned" | "returned"   Act 5: the city's state after the finale

import type { Condition, ItemDefinition } from "../types.ts";
import { flagIs } from "./helpers.ts";

/** Quest ids, in story order. */
export const RAIN = {
  undeliverable: "rain-undeliverable",
  returnToSender: "rain-return-to-sender",
  stationNobody: "rain-station-nobody",
  lightInWindow: "rain-light-in-the-window",
  manifest: "rain-harbour-manifest",
  shed: "rain-bonded-shed",
  loom: "rain-what-kiln-nine-built",
  trunk: "rain-ember-trunk",
  lanterns: "rain-lanterns-for-iris",
  finale: "rain-that-remembers",
  delivery: "rain-last-delivery",
} as const;

/** Every quest id of the questline, in story order (tests and tooling). */
export const RAIN_QUESTS: readonly string[] = Object.values(RAIN);

/** World flags (see the header). */
export const FLAG = {
  nell: "rain.nell",
  drive: "rain.drive",
  moth: "rain.moth",
  window: "rain.window",
  floodTruth: "rain.flood-truth",
  shipment: "rain.shipment",
  governor: "rain.governor",
  trunk: "rain.trunk",
  lantern: "rain.lantern",
  ending: "rain.ending",
} as const;

/** Item ids. */
export const ITEM = {
  drive: "rain-drive",
  key: "rain-nell-key",
  carrierKey: "rain-carrier-key",
  tape: "rain-tape",
  manifest: "rain-manifest",
  governor: "rain-governor",
  index: "rain-lot-index",
} as const;

/** Where everyone and everything stands. Every outdoor spot is on a pavement, plaza or station
 * forecourt: walkable, at least 7 m from a carriageway centre line, clear of other givers
 * (tests/main-questline.test.ts proves it). Interior spots carry `place`. */
export const SPOTS = {
  // Act 1: Silk Market and Dead Letter Exchange.
  tilly: { x: 16, z: 84 },
  lanternDoor: { x: -72, z: 157 },
  nell: { x: -56, z: 157 },
  deadLetterDoor: { x: 429, z: -247.48 },
  /** Dead Letter's left-hand machine (interiors.ts fixture at 435.05, -237.6; this is its use point). */
  lotReader: { x: 435.05, z: -238.7 },
  // Act 2: the Ghost Circuit.
  moth: { x: 426, z: -309 },
  relay: { x: 521, z: -290 },
  // Act 3: Silk Harbour and Spillway Locks.
  ruben: { x: -119, z: 748 },
  morrow: { x: 757, z: 28 },
  shed: { x: 737, z: 53 },
  // Act 4: the Foundry.
  bet: { x: -541, z: -247 },
  kilnDoor: { x: -531, z: -247.91 },
  breaker: { x: -470, z: -264 },
  // Act 5: the Rain Gardens and the Meridian Spire.
  crane: { x: -466, z: 267 },
  annex: { x: 40, z: -136 },
} as const;

/** Skin tones used by the questline's cast. */
export const SKIN = { pale: [214, 188, 164], tan: [182, 140, 108], brown: [128, 92, 70], deep: [92, 64, 50] } as const;

/** Condition shorthands. */
export const endedWith = (value: "released" | "burned" | "returned"): Condition => flagIs(FLAG.ending, value);
/** The finale is over (any ending). */
export const finished: Condition = { flag: FLAG.ending };
/** The finale has not happened yet. */
export const beforeFinale: Condition = { not: { flag: FLAG.ending } };
/** A quest is active or complete (it has been started and not failed). */
export const begun = (quest: string): Condition => ({ quest, status: ["active", "complete"] });

/** The story items. Quest items weigh nothing; the governor and the index have resale value
 * because the player may keep them. */
export const RAIN_ITEMS: readonly ItemDefinition[] = [
  {
    id: ITEM.drive, name: "Wet Drive (Lot 77)", kind: "quest", rarity: "rare", glyph: "d", value: 0, weight: 0, stack: 1, tags: ["quest"],
    description: "A data drive, wet through, that smells of the harbour. The label: LOT 77. ASHBY, J. 9 LANTERN ROW. No sender. Plugged into anything, it plays static.",
  },
  {
    id: ITEM.key, name: "Nell's Key", kind: "quest", rarity: "uncommon", glyph: "k", value: 0, weight: 0, stack: 1, tags: ["quest"],
    description: "A front-door key on a bootlace. The paper tag says JONAH in a mother's capitals. The door it opens has been boarded up for six years.",
  },
  {
    id: ITEM.carrierKey, name: "Carrier Key Card", kind: "quest", rarity: "uncommon", glyph: "c", value: 0, weight: 0, stack: 1, tags: ["quest"],
    description: "A Meridian Climate key card from weather relay GC-4. Printed on the back: RAINFALL/7-ALPHA. The code that scrambles the weather signal.",
  },
  {
    id: ITEM.tape, name: "Station Nobody Tape", kind: "quest", rarity: "uncommon", glyph: "t", value: 0, weight: 0, stack: 1, tags: ["quest"],
    description: "A cassette in Moth's handwriting: FIRST VOICE. NELL ASHBY, 01:04, NIGHT OF THE FLOOD. 'Jonah, love, it's Mum. I've left the light on.'",
  },
  {
    id: ITEM.manifest, name: "Ruben's Manifest Book", kind: "quest", rarity: "uncommon", glyph: "m", value: 0, weight: 0, stack: 1, tags: ["quest"],
    description: "Silk Harbour's night manifest, in a bread bag. Every night: 40 x CALIBRATION SENSORS (CLIMATE), Nami Maru to Spillway Locks bonded shed, signed R. SALGADO.",
  },
  {
    id: ITEM.governor, name: "Loom Governor", kind: "junk", rarity: "epic", glyph: "g", value: 1200, weight: 2, stack: 1, tags: ["tech", "noloot", "unique"],
    description: "A brass-cased limiter from Kiln Nine's Loom, dented where the Foreman's scrappers dropped it. Without it the Loom reads every voice off every antenna. Worth a lot to the right buyer.",
  },
  {
    id: ITEM.index, name: "Lot Index", kind: "quest", rarity: "epic", glyph: "i", value: 0, weight: 0, stack: 1, tags: ["quest"],
    description: "Bet Kowalczyk's copy of the archive's catalogue: three hundred and twelve lots, each with a name and the last address it should have gone to.",
  },
];
