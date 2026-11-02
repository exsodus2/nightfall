// Main questline, Act 4: "The Loom" (the Foundry: Kiln Nine, the Foreman's scrapyard, the Ember Core).
// The manifest's last stop is Kiln Nine, where night engineer Bet Kowalczyk built the Loom for
// Dr. Crane: the machine that weaves each lot into the Spire's weather signal. Its governor (which
// keeps it on the archive and off the living) was stolen by the Foreman's scrappers. After the
// Foreman, the player gives the governor back (and gets the Lot Index, every name and address in
// the archive) or keeps it. Then Tomas Okafor at the Ember Core tells what the CLIMATE trunk did the
// night of the Flood, and the player throws its breaker (an hour without rain) or splices in Moth's
// tap (Station Nobody can reach every sign). The act ends on the dry hour or Moth's green light.
//
// Quests: What Kiln Nine Built (Bet), The Ember Trunk (Bet). Choices: rain.governor, rain.trunk.
// The Foreman is the street boss in encounters.ts ("foreman-yard", auto, respawns).

import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, active, available, bye, ending, flagIs, go, inStage, look, node } from "./helpers.ts";
import { FLAG, ITEM, RAIN, SKIN, SPOTS, beforeFinale } from "./main-common.ts";

const Q6 = RAIN.shed, Q7 = RAIN.loom, Q8 = RAIN.trunk, Q9 = RAIN.lanterns;
const FOREMAN_YARD = { x: -576, z: -640 };

// ---- People ------------------------------------------------------------------------------------

export const BET: NpcDefinition = {
  id: "bet-kowalczyk", name: "Bet Kowalczyk", title: "Kiln Nine night engineer", district: 0, ...SPOTS.bet, facing: FACE.east,
  look: look([200, 110, 50], [60, 40, 26], SKIN.pale, [255, 170, 80], "mask", "tool", "swing"),
  greeting: ["Kiln Nine. We fix what the Foundry breaks. Mostly.", "Selling scrap, it's the back door. Buying, it's also the back door."],
};

// ---- Objects -----------------------------------------------------------------------------------

const interactables: InteractableDefinition[] = [
  {
    id: "rain-breaker", label: "CLIMATE trunk breaker (yellow)", ...SPOTS.breaker, y: 1.5, glyph: "#",
    condition: inStage(Q8, "trunk"), dialogue: "rain.breaker",
  },
];

// ---- Quests ------------------------------------------------------------------------------------

const kilnNine: QuestDefinition2 = {
  id: Q7, title: "What Kiln Nine Built", category: "story", giver: BET.id,
  summary: "Bet Kowalczyk, Kiln Nine's night engineer, built the Loom that weaves the lots into the rain. The Foreman's scrappers stole its governor, the part that keeps it off the living. Get it back.",
  requires: { quest: Q6 }, rewardHint: "500 cr, 1800 XP, and the Lot Index if Bet gets her governor", recommendedLevel: 6, start: "loom",
  stages: [
    {
      id: "loom", journal: "Bet Kowalczyk, the night engineer outside Kiln Nine in the Foundry, wants you to see the machine she built for Dr. Crane before you fetch it a part. Go inside Kiln Nine.",
      objectives: [{ id: "loom", kind: "visit", area: "interior:kiln", text: "Go inside Kiln Nine (The Foundry) and look at the Loom", target: SPOTS.kilnDoor }],
      onComplete: [{ message: "Kiln Nine: behind the lathes stands a frame of copper combs and forty drive bays, every bay warm. The governor slot is empty, and the frame hums with voices from the street outside.", tone: "quest" }],
      next: "foreman",
    },
    {
      id: "foreman", journal: "The Foreman's scrappers stole the Loom's governor off Bet's van. Take it off him in his dead-end scrapyard in the Foundry's south-west, off the Rim road.",
      onEnter: [{ waypoint: { ...FOREMAN_YARD, label: "The Foreman's scrapyard" } }],
      mode: "any",
      objectives: [
        { id: "foreman", kind: "kill", text: "Take the Loom's governor off the Foreman in his scrapyard, south-west Foundry", count: 1, archetype: "foreman", encounter: "foreman-yard" },
        // If the Foreman was beaten recently and the yard is still empty, the governor is just there.
        { id: "yard", kind: "condition", text: "Search the Foreman's empty scrapyard", hidden: true, condition: { encounterCleared: "foreman-yard" }, target: FOREMAN_YARD },
      ],
      onComplete: [{ give: ITEM.governor }, { message: "The governor was in the Foreman's lunchbox, wrapped in a vest. It's dented.", tone: "loot" }],
      next: "decide",
    },
    {
      id: "decide", journal: "You have the Loom's governor. Give it to Bet outside Kiln Nine to put the Loom back on its leash (she offers the Lot Index in return), or keep it.",
      onEnter: [{ waypoint: { ...SPOTS.bet, label: "Bet Kowalczyk" } }],
      objectives: [{ id: "governor", kind: "choose", text: "Decide about the governor with Bet Kowalczyk outside Kiln Nine", dialogue: "rain.bet", options: ["fit", "keep"] }],
      next: [{ if: flagIs(FLAG.governor, "fitted"), stage: "end-fitted" }, { stage: "end-kept" }],
    },
    ending("end-fitted", "The Loom is back on its leash.", "fitted"),
    ending("end-kept", "The Loom is cold.", "kept"),
  ],
  outcomes: {
    fitted: {
      title: "On the Leash",
      journal: "Bet put the Loom back on its leash: archive only, no living voices. She gave you the Lot Index, every name in the archive and the door it belongs to.",
      effects: [{ credits: 500 }, { xp: 1800 }, { rep: "civilian", by: 5 }],
    },
    kept: {
      title: "Cold Loom",
      journal: "You kept the governor. The Loom stays cold and nothing new goes into the rain, and Dr. Crane will want her part back.",
      effects: [{ credits: 500 }, { xp: 1800 }],
    },
  },
};

const emberTrunk: QuestDefinition2 = {
  id: Q8, title: "The Ember Trunk", category: "story", giver: BET.id,
  summary: "The Ember Core powers the Spire's weather array through a trunk line marked CLIMATE. Ask Tomas Okafor what it did the night of the Flood, then decide what to do with its breaker.",
  requires: { quest: Q7 }, rewardHint: "300 cr, 1000 XP, reputation depends on the breaker", recommendedLevel: 6, start: "tomas",
  stages: [
    {
      id: "tomas", journal: "Bet says the Ember Core powers the Spire's weather array through a trunk line marked CLIMATE. Ask Tomas Okafor, the furnace keeper at the Ember Core in the Foundry, what that trunk did the night of the Flood.",
      // No waypoint: the tracker follows Tomas wherever npcs.ts stands him.
      objectives: [{ id: "tomas", kind: "choose", text: "Ask Tomas Okafor at the Ember Core about the CLIMATE trunk", dialogue: "rain.tomas", options: ["ask-trunk"] }],
      next: "trunk",
    },
    {
      id: "trunk", journal: "The CLIMATE breaker is east of the Ember Core, by the substation cabinets: yellow paint, Tomas's handwriting. Throw it to black out the Spire's array tonight, or leave it on and clip in Moth's tap so Station Nobody can reach every sign in the city.",
      onEnter: [{ waypoint: { ...SPOTS.breaker, label: "CLIMATE breaker" } }],
      objectives: [{ id: "breaker", kind: "choose", text: "Decide at the yellow CLIMATE breaker, east of the Ember Core", dialogue: "rain.breaker", options: ["cut", "tap"] }],
      next: [{ if: flagIs(FLAG.trunk, "cut"), stage: "end-cut" }, { stage: "end-tapped" }],
    },
    ending("end-cut", "The array went dark for a night.", "cut"),
    ending("end-tapped", "Station Nobody is on the trunk.", "tapped"),
  ],
  outcomes: {
    cut: {
      title: "The Dry Hour",
      journal: "You threw the CLIMATE breaker, and for an hour it stopped raining over the Foundry; people came out of doorways to look up. Bet says Dr. Crane sends up a lantern at the Last Tree in the Rain Gardens every night. Go and meet her.",
      effects: [{ credits: 300 }, { xp: 1000 }, { rep: "civilian", by: 5 }, { rep: "corpsec", by: -10 }, { startQuest: Q9 }],
    },
    tapped: {
      title: "On the Trunk",
      journal: "You clipped Moth's tap onto the CLIMATE trunk; Station Nobody can reach every sign the rain touches. Bet says Dr. Crane sends up a lantern at the Last Tree in the Rain Gardens every night. Go and meet her.",
      effects: [{ credits: 300 }, { xp: 1000 }, { rep: "ghosts", by: 8 }, { startQuest: Q9 }],
    },
  },
};

// ---- Dialogue ----------------------------------------------------------------------------------

const EXPLAIN = [
  "I'm Bet Kowalczyk, night engineer. I built the Loom for Dr. Odessa Crane, here in Kiln Nine. It weaves the lots into the Spire's weather signal.",
  "Its governor keeps it on the archive and off the living. Two nights ago the Foreman's scrappers lifted the governor off our van. Without it the Loom reads everyone.",
  "Get it back and I'll tell you what I know about Crane, and pay you five hundred. Why you? Because nobody at Meridian can know it's missing.",
];

const dialogues: DialogueDefinition[] = [
  {
    id: "rain.bet", npc: BET.id,
    entries: [
      { condition: inStage(Q7, "decide"), node: "decide", priority: 30 },
      { condition: { all: [available(Q7), flagIs(FLAG.shipment, "burned")] }, node: "offer-burned", priority: 22 },
      { condition: available(Q7), node: "offer-through", priority: 21 },
      { condition: inStage(Q7, "loom"), node: "q7-loom", priority: 20 },
      { condition: inStage(Q7, "foreman"), node: "q7-foreman", priority: 20 },
      { condition: available(Q8), node: "offer8", priority: 22 },
      { condition: active(Q8), node: "q8-working", priority: 20 },
      { condition: { all: [{ quest: Q8 }, flagIs(FLAG.governor, "fitted"), beforeFinale] }, node: "after-fitted", priority: 4 },
      { condition: { all: [{ quest: Q8 }, flagIs(FLAG.governor, "kept"), beforeFinale] }, node: "after-kept", priority: 4 },
    ],
    nodes: [
      node("offer-burned", [
        "You're the one who burned the Spillway shed. Dr. Crane's been on the phone all night.",
        "No lots came in, so the Loom went hungry. A hungry Loom starts listening to whatever's nearest: every antenna in the Foundry.",
      ], [go("what", "What's the Loom?", "explain")]),
      node("offer-through", [
        "The flatcar came in on time. Forty lots. The Loom's fed.",
        "That's the problem. You don't feed a thing like that and expect it to stay small.",
      ], [go("what", "What's the Loom?", "explain")]),
      node("explain", EXPLAIN, [
        { id: "accept-loom", label: "I'll get the governor back. (500 cr)", condition: available(Q7), effects: [{ startQuest: Q7 }], next: "q7-accepted" },
        bye("Not yet.", "decline"),
      ]),
      node("q7-accepted", ["First go inside and look at it. I want you to know what you're fetching a part for."], [LEAVE]),
      node("q7-loom", ["Inside Kiln Nine, behind the lathes. You'll hear it before you see it."], [LEAVE]),
      node("q7-foreman", ["The Foreman holds the dead-end scrapyard in the Foundry's south-west, off the Rim road. Big man, bigger press arm. Jump the rings when he slams."], [LEAVE]),
      node("decide", [
        "You got it. Is it dented? It's dented. It'll do.",
        "Give it here and the Loom goes back on its leash: archive only, no living voices. And you get the Lot Index: every name, and the door it should have gone home to.",
        "Or keep it. Without it I won't run the Loom, and nothing new goes into the rain. Crane will notice by morning, and she'll want it back.",
      ], [
        { id: "fit", label: "Give Bet the governor. (Lot Index, +5 Civilians)", condition: { all: [inStage(Q7, "decide"), { item: ITEM.governor }] }, reason: "You need the Loom Governor", effects: [{ take: ITEM.governor }, { give: ITEM.index }, { setFlag: FLAG.governor, value: "fitted" }], next: "fitted" },
        { id: "keep", label: "Keep the governor.", condition: inStage(Q7, "decide"), effects: [{ setFlag: FLAG.governor, value: "kept" }], next: "kept" },
        bye("Let me think."),
      ]),
      node("fitted", [
        "[She seats the governor with the heel of her hand. Inside Kiln Nine, the Loom's hum drops to a murmur.]",
        "Here. The Lot Index. Three hundred and twelve names and the doors they belonged to. I copied it the night I worked out what I'd built.",
      ], [go("more", "What else do you know?", "offer8")]),
      node("kept", [
        "Then the Loom stays cold. Fine. Maybe that's right.",
        "Stay somewhere public for a few nights.",
      ], [go("more", "What else do you know?", "offer8")]),
      node("offer8", [
        "The Loom's the pen. The Ember Core is the ink. Every night Crane draws power off the Core up a trunk line marked CLIMATE.",
        "Tomas Okafor has kept the Core's valves for forty years. He was on shift the night of the Flood. Ask him what that trunk did. Three hundred for your trouble.",
      ], [
        { id: "accept-trunk", label: "I'll ask Tomas. (300 cr)", condition: available(Q8), effects: [{ startQuest: Q8 }], next: "q8-accepted" },
        bye("Not yet.", "decline"),
      ]),
      node("q8-accepted", ["The Ember Core is the plasma sun just east of here. Tomas is the one shouting at a valve."], [LEAVE]),
      node("q8-working", ["Tomas Okafor, at the Ember Core. Then the CLIMATE breaker; he'll tell you where it is."], [LEAVE]),
      node("after-fitted", ["The Loom's on its leash. Crane hasn't called.", "That's either very good or very bad."], [LEAVE]),
      node("after-kept", ["The Loom's cold. It's very quiet in there.", "I didn't know I'd miss the hum."], [LEAVE]),
    ],
  },
  {
    // Tomas Okafor (src/city/npcs.ts) at the Ember Core. Only while The Ember Trunk needs him.
    id: "rain.tomas", npc: "tomas",
    entries: [
      { condition: { all: [inStage(Q8, "tomas"), { flag: FLAG.floodTruth }] }, node: "trunk-known", priority: 31 },
      { condition: inStage(Q8, "tomas"), node: "trunk", priority: 30 },
      { condition: inStage(Q8, "trunk"), node: "where", priority: 26 },
    ],
    nodes: [
      node("trunk", [
        "The CLIMATE trunk. I wondered when somebody would ask.",
        "The night of the Flood, Meridian switched their new weather array on for the first time. It wanted more than the Core could spare, so the board sent it the reserve: the reserve that ran the Spillway Barrier pumps.",
        "Ten past one, the pumps stopped. Twenty past, the water came in. I watched the gauge do it.",
      ], [{ id: "ask-trunk", label: "Where's the trunk's breaker?", condition: inStage(Q8, "tomas"), kind: "complete", next: "where" }, LEAVE]),
      node("trunk-known", [
        "Agnes Pell's told you already. I can see it on you. She's not wrong; she's never wrong.",
        "The night of the Flood the board sent the Core's reserve up that trunk to Meridian's new array: the reserve that ran the Barrier pumps.",
        "I watched the gauge do it. Forty years on these valves, and that's the gauge I remember.",
      ], [{ id: "ask-trunk", label: "Where's the trunk's breaker?", condition: inStage(Q8, "tomas"), kind: "complete", next: "where" }, LEAVE]),
      node("where", [
        "East of the Core, by the substation cabinets. Big breaker, yellow paint, CLIMATE in my handwriting.",
        "Throw it and the array goes dark for a night. Leave it and it keeps raining. I've been leaving it for six years. Your turn.",
      ], [LEAVE]),
    ],
  },
  {
    // The CLIMATE breaker (spoken by the interactable).
    id: "rain.breaker", npc: "rain-breaker",
    entries: [{ node: "breaker" }],
    nodes: [
      node("breaker", [
        "[A yellow breaker the size of a door, CLIMATE in marker pen. The cable hums so hard you feel it in your teeth.]",
        "[Moth, faint on your comm: 'If you clip the tap on, I can ride it. Every receiver the rain reaches, I reach. Over.']",
      ], [
        { id: "cut", label: "Throw the breaker. Let the Spire go dark for a night. (+5 Civilians, -10 CorpSec)", condition: inStage(Q8, "trunk"), effects: [{ setFlag: FLAG.trunk, value: "cut" }], next: "dark" },
        { id: "tap", label: "Leave it on and clip in Moth's tap. (+8 Ghosts)", condition: inStage(Q8, "trunk"), effects: [{ setFlag: FLAG.trunk, value: "tapped" }], next: "tapped" },
        bye("Not yet."),
      ]),
      node("dark", [
        "[The breaker drops with a sound like a door slamming in another building.]",
        "[Then something you have never heard in this city: nothing. The rain over the Foundry stops. People come out of doorways and look up.]",
      ], [LEAVE]),
      node("tapped", [
        "[You clip Moth's tap onto the trunk. A green light.]",
        "[Moth: 'Station Nobody is on the trunk. Every sign in the city, whenever you want it. Copy.']",
      ], [LEAVE]),
    ],
  },
];

/** Act 4: the Loom, the Foreman and the trunk. */
export const MAIN_ACT4_PACK: ContentPack = {
  id: "main-act4",
  npcs: [BET],
  interactables,
  quests: [kilnNine, emberTrunk],
  dialogues,
};
