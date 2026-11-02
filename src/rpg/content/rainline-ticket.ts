// Pack "rainline-ticket": "Rainline Ticket" along the west rim. The Rainline cableway (world.ts
// SIGHTS "cableway", x ~ -830, z -462..462, over the water) carries gondolas from the Rain Gardens up
// to the Foundry's pylon. Its engineer, Teodor Lusk, stands at Gardens Rim station and wants three
// fault readings taken from the Rim Road side, south to north: the Gardens anchor post, tower 3,
// and the drive house under the Foundry pylon. The drive house phone then puts the player through
// to Teo to decide: close the line until a splice crew comes, or run it at half load tonight.
// Trains on the Rim Line run clockwise: Gardens Rim, Floodgate, Foundry Gate, so the route follows
// the train. World flag: rainline.state ("closed" | "half").
//
// Every position is checked walkable by tests/harbour-lanterns-rent-dial-rainline.test.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, available, bye, ending, flagIs, inStage, look, node } from "./helpers.ts";

const QUEST = "rainline-ticket";

/** Where things stand on the west Rim Road (each is on clear ground; the content test proves it). */
export const RAINLINE_SPOTS = {
  teo: { x: -628, z: 750 },
  anchor: { x: -754.5, z: 455.5 },
  tower: { x: -759.5, z: 202.5 },
  drive: { x: -755, z: -455.5 },
} as const;

export const RAINLINE_NPCS: readonly NpcDefinition[] = [
  {
    id: "teodor-lusk", name: "Teodor Lusk", title: "Rainline cableway engineer", district: 3, ...RAINLINE_SPOTS.teo, facing: FACE.west,
    look: look([70, 110, 84], [30, 44, 34], [190, 150, 120], [120, 240, 170], "cap", "tool", "sway"),
    greeting: ["Rainline. Forty gondolas, one rope, no holidays.", "If you hear it sing, that's fine. If you hear it stop singing, run."],
  },
];

const INTERACTABLES: readonly InteractableDefinition[] = [
  {
    id: "rl-anchor", label: "Rainline anchor post (tension gauge)", ...RAINLINE_SPOTS.anchor, glyph: "?",
    condition: inStage(QUEST, "anchor"),
    effects: [{ message: "ANCHOR A1: TENSION 41 KN, NOMINAL. Rain in the grease cups, nothing else. Out over the water the gondolas tick past, green lamps in a line.", tone: "quest" }],
  },
  {
    id: "rl-tower", label: "Rainline tower 3 (tension gauge)", ...RAINLINE_SPOTS.tower, glyph: "?",
    condition: inStage(QUEST, "tower"),
    effects: [{ message: "TOWER 3: TENSION 58 KN, HIGH. The haul rope is running tight, as if something up the line is dragging on it.", tone: "quest" }],
  },
  { id: "rl-drive", label: "Rainline drive house (gauge and phone)", ...RAINLINE_SPOTS.drive, glyph: "?", condition: inStage(QUEST, "drive"), dialogue: "rl.drive" },
];

const quest: QuestDefinition2 = {
  id: QUEST, title: "Rainline Ticket", category: "side", giver: "teodor-lusk",
  summary: "Take three fault readings on the Rainline cableway from the west Rim Road, then decide with its engineer whether the line keeps running tonight.",
  rewardHint: "170 cr, 280 XP, Civilian reputation; either call pays the same", recommendedLevel: 4, start: "anchor",
  stages: [
    {
      id: "anchor",
      journal: "Teo wants three readings, south to north. First the Gardens anchor post: walk north up the west Rim Road from Gardens Rim station, about three hundred metres, where the cableway comes ashore.",
      onEnter: [{ waypoint: { ...RAINLINE_SPOTS.anchor, label: "Rainline anchor post" } }],
      objectives: [{ id: "anchor", kind: "interact", object: "rl-anchor", text: "Read the gauge on the Rainline anchor post (west Rim Road)" }],
      next: "tower",
    },
    {
      id: "tower",
      journal: "The anchor reads nominal. Tower 3 is another two hundred and sixty metres north up the Rim Road, before Floodgate station.",
      onEnter: [{ waypoint: { ...RAINLINE_SPOTS.tower, label: "Rainline tower 3" } }],
      objectives: [{ id: "tower", kind: "interact", object: "rl-tower", text: "Read the gauge at Rainline tower 3" }],
      next: "drive",
    },
    {
      id: "drive",
      journal: "Tower 3 reads high: something up the line is dragging. The drive house sits under the Foundry pylon, about four hundred and fifty metres north of Floodgate station. Ride the Rim Line one stop to Foundry Gate and walk back south, or walk it. Read the drive and call Teo on the drive house phone.",
      onEnter: [{ waypoint: { ...RAINLINE_SPOTS.drive, label: "Rainline drive house" } }],
      objectives: [{ id: "call", kind: "choose", text: "Read the drive house gauge and make the call with Teo", dialogue: "rl.drive", options: ["close", "half"], target: RAINLINE_SPOTS.drive }],
      next: [{ if: flagIs(`${QUEST}.call`, "close"), stage: "end-closed" }, { stage: "end-half" }],
    },
    ending("end-closed", "The Rainline is closed until the splice crew comes.", "closed"),
    ending("end-half", "The Rainline runs at half load tonight.", "half"),
  ],
  outcomes: {
    closed: {
      title: "Line Closed", journal: "The Rainline stopped at midnight with every gondola parked. The Foundry night shift walked home along the rim, cursing the rain and you, in that order. Teo wired the fee and booked a splice crew for dawn.",
      effects: [{ credits: 170 }, { xp: 280 }, { rep: "civilian", by: 2 }, { setFlag: "rainline.state", value: "closed" }],
    },
    half: {
      title: "Half Load", journal: "The Rainline ran at half load all night, one gondola in two, with Teo walking the rope from tower to tower. The Foundry night shift got home dry. Teo wired the fee and did not sleep.",
      effects: [{ credits: 170 }, { xp: 280 }, { rep: "civilian", by: 4 }, { setFlag: "rainline.state", value: "half" }],
    },
  },
};

const DIALOGUES: readonly DialogueDefinition[] = [
  {
    id: "rl.teo", npc: "teodor-lusk", quest: QUEST,
    entries: [
      { condition: available(QUEST), node: "offer" },
      { condition: { quest: QUEST, status: "active" }, node: "working" },
      { condition: { quest: QUEST, outcome: "closed" }, node: "after-closed" },
      { condition: { quest: QUEST, outcome: "half" }, node: "after-half" },
      { node: "hub" },
    ],
    nodes: [
      node("hub", ["Rainline. Forty gondolas, one rope, no holidays."], [LEAVE]),
      node("offer", [
        "[A man in a green cap with a rope gauge on a lanyard, watching the gondolas over the water through binoculars.]",
        "The Rainline's singing flat tonight. Could be the rain. Could be a strand going. I can't leave the station end, so I need legs.",
        "Three readings, south to north along the Rim Road: the anchor post where she comes ashore, tower 3, then the drive house under the Foundry pylon. There's a phone in the drive house. Call me from it and we'll decide what to do.",
      ], [
        { id: "accept-rainline", label: "I'll take your readings.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "accepted" },
        bye("Not tonight.", "decline"),
      ]),
      node("accepted", ["North up the Rim Road. The train goes the same way, Gardens Rim, Floodgate, Foundry Gate. Mind the water side; the rail's low."], [LEAVE]),
      node("working", ["Anchor, tower 3, drive house, in that order. Then the phone."], [LEAVE]),
      node("after-closed", ["Splice crew found three strands cut clean at the drive house. Somebody's been selling my rope by the metre.", "She's back up and singing. In tune."], [LEAVE]),
      node("after-half", ["Walked the rope all night. She held. I've never been so tired or so pleased with a rope."], [LEAVE]),
    ],
  },
  {
    id: "rl.drive", npc: "rl-drive", quest: QUEST,
    entries: [{ condition: inStage(QUEST, "drive"), node: "gauge" }],
    nodes: [
      node("gauge", [
        "DRIVE HOUSE: BULLWHEEL OK. HAUL ROPE STRAND LOSS: 3 OF 36.",
        "Under the inspection lamp the broken strands are cut clean, not frayed. Somebody has been taking cable off the rope at night.",
        "[You pick up the phone. Teo answers before it rings.] Three of thirty-six. Cut? ... Right. Your call, you're looking at it. Close her till the splice crew comes, and the Foundry night shift walks home in the rain. Or half load, one gondola in two, and I walk the rope till dawn.",
      ], [
        { id: "close", label: "Close the line until the splice crew comes.", condition: inStage(QUEST, "drive"), kind: "complete", next: "closed" },
        { id: "half", label: "Run her at half load tonight.", condition: inStage(QUEST, "drive"), kind: "complete", next: "half-load" },
        bye("Let me look again."),
      ]),
      node("closed", ["[On the phone:] Closing. Every gondola to the stations, then the brake. Fee's on its way. Thanks for the legs."], [LEAVE]),
      node("half-load", ["[On the phone:] Half load. I'll walk her from tower to tower. Fee's on its way. If you hear her stop singing, call me."], [LEAVE]),
    ],
  },
];

export const RAINLINE_TICKET_PACK: ContentPack = {
  id: "rainline-ticket",
  npcs: RAINLINE_NPCS,
  interactables: INTERACTABLES,
  quests: [quest],
  dialogues: DIALOGUES,
};
