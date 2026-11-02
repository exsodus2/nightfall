// Pack "rent-is-due": "Rent Is Due" at the Afterlight Arcade in the Spillway, where the city's rent
// march gathers (city-events.ts "protest"). Dee Okafor organises the march. She needs the placards
// from the print co-op, then help finding the CorpSec informant among the three people who knew
// tonight's route: Pim the printer, Laszlo "from the Low Tide crews" and Oona from the tenants'
// board. Clues come from talking to them; a wrong accusation costs nothing and can be retried.
// Then: expose the informant to the march, or turn him and feed CorpSec the wrong route.
// World flag: spillway.march ("exposed" | "turned").
//
// Every position is checked walkable by tests/harbour-lanterns-rent-dial-rainline.test.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, InteractableDefinition, ItemDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, available, bye, ending, flagIs, go, inStage, look, node } from "./helpers.ts";

const QUEST = "rent-is-due";
const PLACARDS = "placard-bundle";
const VERDICT = `${QUEST}.verdict`;

/** Where things stand around the Arcade (each is on clear ground; the content test proves it). */
export const RENT_SPOTS = {
  dee: { x: 479, z: 248.5 },
  press: { x: 544.5, z: 312.5 },
  pim: { x: 472, z: 263.5 },
  laszlo: { x: 488, z: 264 },
  oona: { x: 500, z: 270 },
} as const;

export const RENT_NPCS: readonly NpcDefinition[] = [
  {
    id: "dee-okafor", name: "Dee Okafor", title: "March organiser", district: 5, ...RENT_SPOTS.dee, facing: FACE.south,
    look: look([196, 150, 40], [40, 36, 30], [104, 72, 56], [255, 214, 90], "cap", "bag", "scan"),
    greeting: ["Rent went up eleven percent in the Spillway this year. Wages went up by a joke.", "We march at the change of shift. Bring a hat. Bring a friend."],
  },
];

const ITEMS: readonly ItemDefinition[] = [
  { id: PLACARDS, name: "Placard Bundle", kind: "quest", rarity: "common", glyph: "#", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "Forty placards tied with tape, ink still tacky: RENT IS DUE. SO ARE YOU, MERIDIAN." },
];

const marcher = (id: string, label: string, spot: { x: number; z: number }, stages: readonly string[]): InteractableDefinition => ({
  id, label, ...spot, glyph: "@", condition: { any: stages.map(stage => inStage(QUEST, stage)) }, dialogue: `rd.${id.slice(3)}`,
});

const INTERACTABLES: readonly InteractableDefinition[] = [
  {
    // Usable to fetch the bundle, and again later if the bundle went missing before the hand-over.
    id: "rd-press", label: "Print co-op shutter (placards)", ...RENT_SPOTS.press, glyph: "#",
    condition: { any: [inStage(QUEST, "press"), { all: [inStage(QUEST, "deliver"), { not: { item: PLACARDS } }] }] },
    effects: [{ give: PLACARDS }, { message: "The co-op shutter rattles up a metre. A hand pushes out a taped bundle of placards and the shutter comes down again.", tone: "quest" }],
  },
  marcher("rd-pim", "Pim (printer, ink to the elbows)", RENT_SPOTS.pim, ["informant"]),
  marcher("rd-laszlo", "Laszlo (dock coat, new boots)", RENT_SPOTS.laszlo, ["informant", "verdict"]),
  marcher("rd-oona", "Oona (tenants' board)", RENT_SPOTS.oona, ["informant"]),
];

const quest: QuestDefinition2 = {
  id: QUEST, title: "Rent Is Due", category: "side", giver: "dee-okafor",
  summary: "Bring the rent march its placards, then find out which of three marchers is feeding CorpSec the route.",
  rewardHint: "150 cr, 260 XP, Civilian reputation; CorpSec will notice", recommendedLevel: 3, start: "press",
  stages: [
    {
      id: "press",
      journal: "The march needs its placards. The print co-op is a shuttered unit about ninety metres south-east of the Afterlight Arcade, on the cross street. Knock on the shutter.",
      onEnter: [{ waypoint: { ...RENT_SPOTS.press, label: "Print co-op (placards)" } }],
      objectives: [{ id: "bundle", kind: "interact", object: "rd-press", text: "Collect the placards from the print co-op" }],
      next: "deliver",
    },
    {
      id: "deliver",
      journal: "Carry the placard bundle back to Dee Okafor at the Afterlight Arcade.",
      objectives: [{ id: "placards", kind: "deliver", item: PLACARDS, count: 1, npc: "dee-okafor", text: "Hand the placards to Dee Okafor at the Arcade" }],
      next: "informant",
    },
    {
      id: "informant",
      journal: "CorpSec has had the route of every march this year. Three people knew tonight's route before it was printed: Pim, Laszlo and Oona, all at the Arcade now. Dee says the leak calls it in on a CorpSec handset (they click twice when they unlock) and claims to work the Low Tide docks, where the crews change shift at four. Talk to them, then tell Dee who it is.",
      objectives: [
        { id: "pim", kind: "interact", object: "rd-pim", text: "Talk to Pim the printer", optional: true },
        { id: "laszlo", kind: "interact", object: "rd-laszlo", text: "Talk to Laszlo from the docks", optional: true },
        { id: "oona", kind: "interact", object: "rd-oona", text: "Talk to Oona from the tenants' board", optional: true },
        { id: "accuse", kind: "choose", text: "Tell Dee Okafor who the informant is", dialogue: "rd.dee", options: ["accuse-laszlo"] },
      ],
      next: "verdict",
    },
    {
      id: "verdict",
      journal: "Laszlo is the leak, and he knows you know. Dee says it's your call: send him off in front of the whole march, or turn him and let CorpSec wait on the wrong street.",
      objectives: [{ id: "verdict", kind: "choose", text: "Settle it with Laszlo at the Arcade", dialogue: "rd.laszlo", options: ["expose", "turn"], target: RENT_SPOTS.laszlo }],
      next: "report",
    },
    {
      id: "report",
      journal: "Tell Dee how it went with Laszlo. The march forms up at the change of shift.",
      objectives: [{ id: "report", kind: "choose", text: "Tell Dee Okafor how it went", dialogue: "rd.dee", options: ["report-expose", "report-turn"] }],
      next: [{ if: flagIs(VERDICT, "expose"), stage: "end-exposed" }, { stage: "end-turned" }],
    },
    ending("end-exposed", "Laszlo was sent off in front of the march.", "exposed"),
    ending("end-turned", "Laszlo sent CorpSec the wrong route.", "turned"),
  ],
  outcomes: {
    exposed: {
      title: "Out in the Rain", journal: "Dee read Laszlo's name out from a crate. He walked off through four hundred people and nobody touched him. The march went the planned way, slower, louder. Dee paid what the tenants' board could.",
      effects: [{ credits: 150 }, { xp: 260 }, { rep: "civilian", by: 6 }, { rep: "corpsec", by: -3 }, { setFlag: "spillway.march", value: "exposed" }],
    },
    turned: {
      title: "Wrong Avenue", journal: "Laszlo sent his handler the old canal route. CorpSec waited there an hour in full kit while the march walked the sluice road singing. Dee paid what the tenants' board could, and kept Laszlo's handset number.",
      effects: [{ credits: 150 }, { xp: 260 }, { rep: "civilian", by: 4 }, { rep: "corpsec", by: -6 }, { setFlag: "spillway.march", value: "turned" }],
    },
  },
};

const informant = inStage(QUEST, "informant");

const DIALOGUES: readonly DialogueDefinition[] = [
  {
    id: "rd.dee", npc: "dee-okafor", quest: QUEST,
    entries: [
      { condition: available(QUEST), node: "offer" },
      { condition: inStage(QUEST, "press"), node: "press" },
      { condition: inStage(QUEST, "deliver"), node: "deliver" },
      { condition: informant, node: "leak" },
      { condition: inStage(QUEST, "verdict"), node: "verdict" },
      { condition: inStage(QUEST, "report"), node: "report" },
      // Night of Lanterns' rent wish reaches the march once the march is done.
      { condition: { all: [{ quest: QUEST, status: "complete" }, flagIs("lanterns.wish", "rent")] }, node: "hub-lantern", priority: 5 },
      { condition: { quest: QUEST, outcome: "exposed" }, node: "after-exposed" },
      { condition: { quest: QUEST, outcome: "turned" }, node: "after-turned" },
      { node: "hub" },
    ],
    nodes: [
      node("hub", ["Rent went up eleven percent in the Spillway this year. Wages went up by a joke.", "We march at the change of shift."], [LEAVE]),
      node("hub-lantern", ["Somebody sent three sky lanterns up from the Last Tree asking for the rent to fall.", "We put it on a placard. LET THE RENT FALL. Best one we've got."], [LEAVE]),
      node("offer", [
        "[A woman in a yellow cap stands on a milk crate, counting heads.]",
        "Rent march forms up here at the change of shift. My placards are sitting in the print co-op down the road because the printer won't open the shutter for anyone in a CorpSec postcode, which is everyone.",
        "Fetch them for me. And then I've got a worse job, if you're still around.",
      ], [
        { id: "accept-rent", label: "I'll get your placards.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "accepted" },
        bye("Not my rent.", "decline"),
      ]),
      node("accepted", ["South-east down the cross street, a shuttered unit. Knock twice; say Dee sent you."], [LEAVE]),
      node("press", ["Print co-op, south-east down the cross street. Knock twice."], [LEAVE]),
      node("deliver", ["Have you got them? Forty placards, taped."], [LEAVE]),
      node("leak", [
        "CorpSec has had the route of every march this year, before we've printed it. Somebody here is a leak.",
        "Three people knew tonight's route: Pim, who prints for us; Laszlo, who says he's Low Tide dock crew; and Oona from the tenants' board. My cousin works the CorpSec desk. She says the tip comes in on one of their own handsets, the kind that click twice when they unlock.",
        "Talk to them. Then tell me who.",
      ], [
        go("accuse", "I know who it is.", "accuse", { condition: informant }),
        LEAVE,
      ]),
      node("accuse", ["Go on. Say it quietly."], [
        go("accuse-pim", "Pim.", "wrong-pim", { condition: informant }),
        { id: "accuse-laszlo", label: "Laszlo.", condition: informant, kind: "complete", next: "right" },
        go("accuse-oona", "Oona.", "wrong-oona", { condition: informant }),
        bye("Not yet."),
      ]),
      node("wrong-pim", ["Pim? Pim hates CorpSec more than he hates me, and he carries a pager, not a handset.", "Think again. Nobody's been told anything."], [go("again-pim", "Let me think again.", "accuse"), LEAVE]),
      node("wrong-oona", ["Oona's phone is a borrowed brick with a cracked screen. She's behind on her own rent; that's why she's twitchy.", "Think again. Nobody's been told anything."], [go("again-oona", "Let me think again.", "accuse"), LEAVE]),
      node("right", ["[She doesn't look at him.] Low Tide crews change at four. Everyone on that dock knows it.", "Your call how this ends. Shame him in front of the march, or turn him. Talk to him."], [LEAVE]),
      node("verdict", ["Laszlo's still here. He knows. Go and settle it."], [LEAVE]),
      node("report", ["Well?"], [
        { id: "report-expose", label: "He's leaving. Read his name out if you like.", condition: { all: [inStage(QUEST, "report"), flagIs(VERDICT, "expose")] }, hideIfUnavailable: true, kind: "complete", next: "paid-exposed" },
        { id: "report-turn", label: "He's sending CorpSec the canal route.", condition: { all: [inStage(QUEST, "report"), flagIs(VERDICT, "turn")] }, hideIfUnavailable: true, kind: "complete", next: "paid-turned" },
        LEAVE,
      ]),
      node("paid-exposed", ["[She climbs back on the crate and reads one name, loud.] Here. It's what the board could spare. Pick up a placard."], [LEAVE]),
      node("paid-turned", ["The canal route. [She grins.] Let them stand in the wet for once. Here. It's what the board could spare."], [LEAVE]),
      node("after-exposed", ["No sirens on the route tonight. First time this year."], [LEAVE]),
      node("after-turned", ["CorpSec spent an hour guarding a canal. My cousin says the sergeant's still angry."], [LEAVE]),
    ],
  },
  {
    id: "rd.pim", npc: "rd-pim", quest: QUEST,
    entries: [{ condition: informant, node: "pim" }],
    nodes: [
      node("pim", [
        "[A short man with ink to the elbows. A pager on his belt buzzes; he ignores it.]",
        "I print what Dee gives me and I burn the plates after. The route? Dee told me Tuesday. I told nobody, because I don't talk to anybody, because people are like this.",
        "If you want a leak, look at the one in the new boots.",
      ], [LEAVE]),
    ],
  },
  {
    id: "rd.oona", npc: "rd-oona", quest: QUEST,
    entries: [{ condition: informant, node: "oona" }],
    nodes: [
      node("oona", [
        "[A tall woman holding a cracked borrowed phone in both hands. She jumps when you speak.]",
        "Sorry. Sorry. I'm on the tenants' board and I'm three months behind myself. If my landlord sees me here I'm out by Friday.",
        "Laszlo? He's nice. He says he's Low Tide crew. He says his shift changes at midnight.",
      ], [LEAVE]),
    ],
  },
  {
    id: "rd.laszlo", npc: "rd-laszlo", quest: QUEST,
    entries: [{ condition: inStage(QUEST, "verdict"), node: "caught" }, { condition: informant, node: "chat" }],
    nodes: [
      node("chat", [
        "[A broad man in a dock coat and boots too clean for any dock. Something in his pocket clicks twice.]",
        "Laszlo. Low Tide crews, eleven years. Night shift. We change at midnight.",
        "Big turnout tonight. Which way are we walking, do you know?",
      ], [LEAVE]),
      node("caught", [
        "[He's already sweating.] All right. All right. They pay my rent. That's the joke, isn't it? They pay my rent to tell them about the rent march.",
        "What happens now?",
      ], [
        { id: "expose", label: "You walk away. Dee reads your name out.", condition: inStage(QUEST, "verdict"), kind: "complete", next: "walk" },
        { id: "turn", label: "You send your handler the canal route. Tonight and every night.", condition: inStage(QUEST, "verdict"), kind: "complete", next: "turned" },
        bye("Stay here."),
      ]),
      node("walk", ["[He nods, and goes, and doesn't look back.]"], [LEAVE]),
      node("turned", ["[He thumbs the handset. It clicks twice.] Canal route. Sent. They'll stand there all night.", "Don't tell Dee I said thank you."], [LEAVE]),
    ],
  },
];

export const RENT_IS_DUE_PACK: ContentPack = {
  id: "rent-is-due",
  npcs: RENT_NPCS,
  items: ITEMS,
  interactables: INTERACTABLES,
  quests: [quest],
  dialogues: DIALOGUES,
};
