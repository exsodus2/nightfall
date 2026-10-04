// Pack "weatherman": the investigation. Dex Solano, the Spillway's pirate weatherman ("RAIN. MORE
// RAIN. BACK TO YOU, NOBODY."), has vanished and his van behind the Afterlight Arcade is shot up.
// Mama Kestrel wants his killer. The clues say something else: nobody killed Dex. Who you accuse
// decides the ending - blame the Razorbacks, blame CorpSec (with evidence), or find the man in
// the raincoat who has been standing by the arcade the whole time.

import type { Condition, ContentPack, DialogueDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { LEAVE, active, bye, ending, go, inStage, node } from "./helpers.ts";

const Q = "weatherman";
const clue = (id: string): Condition => ({ flag: `weather.${id}` });
const CCTV_EVIDENCE: Condition = { any: [clue("footage"), clue("hum")] };
const CAN_EXPOSE: Condition = { all: [clue("van"), clue("syrup"), CCTV_EVIDENCE] };

const spot = (id: string, label: string, x: number, z: number, glyph: string, text: string): InteractableDefinition => ({
  id: `weather-${id}`, label, x, z, y: 1.1, glyph, once: true, condition: active(Q),
  effects: [{ setFlag: `weather.${id}` }, { message: text, tone: "info" }],
});

const interactables: InteractableDefinition[] = [
  spot("van", "Dex's broadcast van", 506, 300, "=", "Bullet holes in the van's side door. The metal is punched outwards. Somebody shot their way OUT of the van, not in."),
  spot("syrup", "Red puddle by the kerb", 470, 314, "~", "A red puddle where the body should be. You dab it. It's cold, sweet and smells of cherry. Slushie syrup, about four litres of it."),
  spot("ledger", "Dex's ledger", 454, 300, "L", "Dex owed the Razorbacks 4,000 cr. The last entry, in fresh ink: 'PAID IN FULL (sort of)'."),
  spot("casings", "Spent casings", 510, 308, ",", "11mm casings, CorpSec pattern - but the stamps are filed off. Cheap copies. Gauge in the Foundry sells these by the bucket."),
  { id: "weather-cctv", label: "Arcade security terminal", x: 466, z: 272, y: 1.4, glyph: ">", condition: { all: [active(Q), { not: CCTV_EVIDENCE }] }, dialogue: "weather.cctv" },
];

const quest: QuestDefinition2 = {
  id: Q, title: "Cloudy, Chance of Murder", category: "side", giver: "kestrel",
  summary: "Dex Solano, the pirate weatherman, is gone and his van is full of holes. Mama Kestrel wants to know who killed him.",
  rewardHint: "150-500 cr, depends who you blame", recommendedLevel: 3, start: "investigate",
  stages: [
    {
      id: "investigate", journal: "Dex broadcast from a van behind the Afterlight Arcade. Search the scene. Look closely: the city lies.",
      onEnter: [{ waypoint: { x: 490, z: 300, label: "Dex's van" } }],
      objectives: [
        { id: "van", kind: "interact", text: "Examine Dex's van", object: "weather-van" },
        { id: "syrup", kind: "interact", text: "Examine the puddle by the kerb", object: "weather-syrup" },
        { id: "ledger", kind: "interact", text: "Read Dex's ledger", object: "weather-ledger" },
        { id: "casings", kind: "interact", text: "Check the spent casings", object: "weather-casings", optional: true },
        { id: "cctv", kind: "condition", text: "Recover the arcade's security recording", condition: CCTV_EVIDENCE, target: { x: 466, z: 272 }, optional: true },
      ],
      next: "accuse",
    },
    {
      id: "accuse", journal: "You've seen enough to have an opinion. Tell Kestrel who did it - and be sure. (You can keep looking first.)",
      objectives: [{ id: "accuse", kind: "choose", text: "Tell Mama Kestrel who killed Dex", dialogue: "weather.kestrel", options: ["accuse-rb", "accuse-corp", "accuse-faked"] }],
      next: [
        { if: { flag: "weatherman.accuse", is: "accuse-faked" }, stage: "confront" },
        { if: { flag: "weatherman.accuse", is: "accuse-corp" }, stage: "end-corpsec" },
        { stage: "end-razorbacks" },
      ],
    },
    {
      id: "confront", journal: "Nobody killed Dex. A man in a raincoat has been humming the weather jingle by the arcade all week. Have a word with Mr. Nimbus.",
      objectives: [{ id: "deal", kind: "choose", text: "Confront Mr. Nimbus", dialogue: "weather.nimbus", options: ["reunite", "bribe", "sell"] }],
      next: [
        { if: { flag: "weatherman.deal", is: "sell" }, stage: "end-sold" },
        { if: { flag: "weatherman.deal", is: "bribe" }, stage: "end-bribed" },
        { stage: "end-reunion" },
      ],
    },
    ending("end-razorbacks", "Kestrel believed you.", "blamed-razorbacks"),
    ending("end-corpsec", "Kestrel believed you.", "blamed-corpsec"),
    ending("end-reunion", "Dex went home.", "reunion"),
    ending("end-bribed", "Dex paid.", "hush-money"),
    ending("end-sold", "The Razorbacks collected.", "sold-out"),
  ],
  outcomes: {
    "blamed-razorbacks": {
      title: "Easy Answer", journal: "Kestrel's nephews went looking for Razorbacks. The Razorbacks went looking for you. Somewhere, a man in a raincoat relaxed.",
      effects: [{ credits: 150 }, { xp: 350 }, { rep: "razorbacks", by: -10 }, { setFlag: "weather.blamed", value: "razorbacks" }],
    },
    "blamed-corpsec": {
      title: "Filed Off", journal: "Kestrel put the casings on every screen in the arcade. CorpSec issued a statement denying everything, which everyone took as a confession.",
      effects: [{ credits: 200 }, { xp: 400 }, { rep: "corpsec", by: -10 }, { setFlag: "weather.blamed", value: "corpsec" }],
    },
    reunion: {
      title: "Back on the Air", journal: "Dex walked into the arcade in his raincoat and Kestrel hit him, then hugged him, then hit him again. Tonight's forecast: rain. He cried reading it.",
      effects: [{ credits: 400 }, { xp: 650 }, { give: "quote-magnum" }, { rep: "civilian", by: 5 }, { setFlag: "weather.dex-back" }],
    },
    "hush-money": {
      title: "Paid to Forget", journal: "Dex paid you five hundred to keep a dead man dead. Kestrel still lights a candle for him. You try not to think about it.",
      effects: [{ credits: 500 }, { xp: 500 }, { setFlag: "weather.bribed" }],
    },
    "sold-out": {
      title: "Debts Are Forever", journal: "The Razorbacks collected their four thousand from a dead man. They paid you a finder's fee and a nod you'll be getting for weeks.",
      effects: [{ credits: 400 }, { xp: 500 }, { rep: "razorbacks", by: 15 }, { setFlag: "weather.dex-taken" }],
    },
  },
};

const dialogues: DialogueDefinition[] = [
  {
    id: "weather.kestrel", npc: "kestrel", quest: Q,
    entries: [{ condition: inStage(Q, "accuse"), node: "accuse", priority: 20 }, { condition: inStage(Q, "investigate"), node: "waiting", priority: 18 }],
    nodes: [
      node("offer", [
        "My weatherman's gone, baby. Dex Solano. Broadcast from a van behind my arcade for eleven years. 'Rain. More rain. Back to you, nobody.'",
        "Van's full of holes and there's red on the kerb. The Razorbacks were on him for money. CorpSec said he jammed their channel.",
        "Find out who killed him. Then I'll decide what to do with them.",
      ], [
        { id: "accept", label: "I'll find out.", effects: [{ startQuest: Q }], next: "accepted" },
        bye("Sorry, Mama.", "decline"),
      ]),
      node("accepted", ["The van's round the back. Don't touch the slushie machine, it bites."], [LEAVE]),
      node("waiting", ["Anything? Don't tell me yet. Tell me when you're sure."], [LEAVE]),
      node("accuse", ["So. Who killed my weatherman?"], [
        { id: "accuse-rb", label: "The Razorbacks. He owed them four thousand.", kind: "complete", next: "rb" },
        { id: "accuse-corp", label: "CorpSec. The casings are theirs.", kind: "complete", condition: clue("casings"), reason: "You have no evidence against CorpSec", next: "corp" },
        { id: "accuse-faked", label: "Nobody. Dex faked it.", kind: "complete", condition: CAN_EXPOSE, reason: "You'd need more than a hunch (the van, the puddle, the footage)", next: "faked" },
        go("think", "Let me look around some more.", "waiting"),
      ]),
      node("rb", ["The Razorbacks. Of course. Of course it was.", "My nephews will take it from here. Here's your money. Go on."], [LEAVE]),
      node("corp", ["CorpSec. Filed-off stamps, the cowards.", "Everyone in the Spillway will know by morning. Here."], [LEAVE]),
      node("faked", ["...Faked it.", "Syrup. Shot his way out. That little - where is he?"], [go("where", "I think he's closer than you'd like.", "where")]),
      node("where", ["Don't tell me. Deal with him. If I see him I'll kill him properly."], [LEAVE]),
    ],
  },
  {
    id: "weather.cctv", npc: "weather-cctv", quest: Q,
    entries: [{ node: "screen" }],
    nodes: [
      node("screen", ["[A cracked terminal. The night of the shooting is a smear of rain and compression noise.]"], [
        { id: "scrub", label: "Clean up the footage.", check: { stat: "tech", difficulty: 3, success: "footage", failure: "static", bonus: [{ if: { item: "focus-chip" }, by: 2, label: "Focus Chip" }] }, next: null },
        bye("Leave it."),
      ]),
      node("footage", ["[Frame by frame: the van door blows outwards. A man in a raincoat steps out, opens an umbrella, pours a slushie on the kerb, and walks off.]", "[He is humming. You know the tune: the weather jingle.]"], [LEAVE], [{ setFlag: "weather.footage" }]),
      node("static", ["[The video is gone. The audio survives: rain, three gunshots from inside the van, and someone humming a jingle as they walk away.]"], [LEAVE], [{ setFlag: "weather.hum" }]),
    ],
  },
  {
    id: "weather.nimbus", npc: "nimbus", quest: Q,
    entries: [{ condition: inStage(Q, "confront"), node: "confront", priority: 20 }],
    nodes: [
      node("confront", ["[Mr. Nimbus adjusts his hood.]", "Can I help you? I'm not a weatherman."], [go("busted", "Nice umbrella, Dex.", "busted")]),
      node("busted", [
        "...How.",
        "[You tell him: the syrup, the door, the humming.]",
        "Fine. FINE. I owed the Razorbacks four thousand. Dead men don't pay. So I died. It was a very good death. Did you see the van?",
      ], [
        { id: "reunite", label: "Kestrel is grieving for you. Go home.", kind: "complete", next: "home" },
        { id: "shake", label: "Pay me and I never saw you.", check: { stat: "cool", difficulty: 3, success: "pays", failure: "refuses" }, next: null },
        { id: "sell", label: "The Razorbacks still want their four thousand.", kind: "complete", next: "sold" },
      ]),
      node("home", ["She's... grieving? For me?", "[He folds the umbrella.] I'll go. She's going to hit me. I deserve to be hit."], [LEAVE]),
      node("pays", ["Five hundred. It's everything I made from being dead.", "Pleasure not seeing you."], [{ id: "bribe", label: "Take the money.", kind: "complete", next: null }]),
      node("refuses", ["Nice try. You're not scary, you're damp."], [go("again", "Let's talk about this again.", "busted")]),
      node("sold", ["No. No no no. You wouldn't.", "[Across the plaza, a Razorback looks up from his phone. You would.]"], [LEAVE]),
    ],
  },
];

/** Who killed the weatherman? (Spillway investigation, level 3.) */
export const WEATHERMAN_PACK: ContentPack = { id: "weatherman", interactables, dialogues, quests: [quest] };
