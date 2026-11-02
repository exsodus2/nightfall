// Pack "cold-iron": the Foundry's Razorback toll crews against the Ghost Circuit's couriers, a
// three-quest arc that pays off the factions in factions.ts.
//
// Brakka Venn runs the toll on every crate that leaves the Foundry by the Rim Line (Foundry Gate
// station, -768, -640). Nix, the Ghost fixer on the Ghost Circuit (cast.ts), runs couriers.
//  1. Glass on the Stack (Brakka): clear a Ghost relay off the furnace stack in the north-west
//     corner yard. Smash it, or pocket it for Nix (flag foundry.relay: "smashed" | "pocketed").
//  2. Two Ledgers (Nix, after 1): someone in Brakka's crew sells Ghost courier routes to CorpSec.
//     Lift the proof from the lieutenant Kettle's lockbox at the Foundry toll junction and give it
//     to one side (flag foundry.ledger: "nix" | "brakka"). Starts 3.
//  3. Cold Iron: Kettle meets his CorpSec buyers under the furnace stack. Break the meet, then
//     decide who gets Kettle, or talk him into a confession both sides can live with [COOL 4]
//     (flag foundry.truce: "razorbacks" | "ghosts" | "truce").
//
// Every position here is checked walkable by tests/content-rim-park-foundry.test.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, DialogueOptionDef, EncounterDefinition, EnemyArchetype, InteractableDefinition, ItemDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, available, bye, ending, flagIs, go, inStage, look, member, node } from "./helpers.ts";

const STACK = "stack-relay";
const LEDGERS = "two-ledgers";
const IRON = "cold-iron";

export const FOUNDRY_SPOTS = {
  stackYard: { x: -734, z: -726 },
  relay: { x: -736, z: -728 },
  lockbox: { x: -312, z: -178 },
  meet: { x: -722, z: -720 },
  kettle: { x: -720, z: -716 },
} as const;

export const BRAKKA: NpcDefinition = {
  id: "brakka", name: "Brakka Venn", title: "Razorback toll boss", district: 0, x: -748, z: -648.5, facing: FACE.east,
  look: look([120, 40, 30], [210, 170, 90], [128, 92, 70], [255, 160, 50], "bare", "case", "scan"),
  greeting: [
    "Every crate that leaves the Foundry by rail passes my gate, customer. Every crate pays.",
    "That isn't a threat. It's a timetable.",
  ],
};

const ITEMS: readonly ItemDefinition[] = [
  { id: "ghost-relay", name: "Ghost Relay", kind: "quest", rarity: "uncommon", glyph: "t", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "A palm-sized Ghost relay prised off the furnace stack, still logging. Its little screen keeps scrolling toll manifests." },
  { id: "toll-ledger", name: "Toll Ledger", kind: "quest", rarity: "rare", glyph: "L", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "Kettle's copy of the Foundry Gate toll book. In the margins, in pencil: courier routes, pickup times, and payments from a CorpSec harbour desk." },
];

const ARCHETYPES: readonly EnemyArchetype[] = [
  {
    id: "ci-kettle", name: "Kettle", faction: "razorbacks", health: 230, armor: 0.2, speed: { walk: 1.7, run: 5.2 },
    weapon: "modulo", reaction: 0.45, aggression: 0.7, perception: { sight: 46, fovDegrees: 140, hearing: 46 }, scale: 1.1,
    look: look([90, 90, 96], [40, 30, 24], [182, 140, 108], [255, 120, 40], "cap", "case", "sway"),
    loot: "bounty-mark", xp: 260, tags: ["razorback", "gang", "officer"],
    barks: { alert: ["NOBODY WAS SUPPOSED TO COME.", "BRAKKA SENT YOU? NO?"], hurt: ["IT WAS ONLY ROUTES!"], death: ["...I had a buyer..."] },
  },
];

const ENCOUNTERS: readonly EncounterDefinition[] = [
  {
    id: "ci-stack-ghosts", label: "Ghost relay crew (furnace stack yard)", area: area(FOUNDRY_SPOTS.stackYard.x, FOUNDRY_SPOTS.stackYard.z, 18), hostile: true,
    members: [member("ghost-blinker", -724, -728, FACE.west), member("ghost-blinker", -746, -720, FACE.east), member("ghost-glitchknife", -726, -748, FACE.south)],
  },
  {
    id: "ci-kettle-meet", label: "Kettle's meet (furnace stack yard)", area: area(FOUNDRY_SPOTS.meet.x, FOUNDRY_SPOTS.meet.z, 16), hostile: true,
    members: [
      member("ci-kettle", -722, -724, FACE.south, { tag: "kettle" }),
      member("corp-trooper", -712, -730, FACE.west), member("corp-trooper", -730, -712, FACE.east), member("rb-thug", -712, -714, FACE.north),
    ],
  },
];

const INTERACTABLES: readonly InteractableDefinition[] = [
  { id: "ci-relay", label: "Ghost relay on the furnace stack", ...FOUNDRY_SPOTS.relay, y: 1.6, glyph: "t", condition: inStage(STACK, "relay"), dialogue: "ci.relay" },
  {
    id: "ci-lockbox", label: "Kettle's lockbox", ...FOUNDRY_SPOTS.lockbox, glyph: "=", once: true,
    condition: inStage(LEDGERS, "lockbox"),
    effects: [{ give: "toll-ledger" }, { message: "The lockbox opens to a bent spoon. Inside: Kettle's toll book, thick with pencil in the margins.", tone: "quest" }],
  },
  { id: "ci-kettle-down", label: "Kettle (on his knees)", ...FOUNDRY_SPOTS.kettle, glyph: "@", condition: inStage(IRON, "kettle"), dialogue: "ci.kettle" },
];

// ---- Quests ------------------------------------------------------------------------------------

const stackRelay: QuestDefinition2 = {
  id: STACK, title: "Glass on the Stack", category: "contract", giver: BRAKKA.id,
  summary: "Brakka Venn says a Ghost relay on the furnace stack is reading her toll manifests. Clear the stack yard and deal with the relay.",
  rewardHint: "280 cr, 420 XP, Razorback reputation", recommendedLevel: 5, start: "yard",
  stages: [
    {
      id: "yard",
      journal: "The furnace stack stands in the north-west corner yard, a hundred metres north of Foundry Gate station along the Rim Road. Brakka says a Ghost crew guards a relay strapped to it.",
      onEnter: [{ waypoint: { ...FOUNDRY_SPOTS.stackYard, label: "Furnace stack yard" } }],
      objectives: [{ id: "arrive", kind: "reach", text: "Go to the furnace stack yard north of Foundry Gate", area: area(FOUNDRY_SPOTS.stackYard.x, FOUNDRY_SPOTS.stackYard.z, 18, "Furnace stack yard") }],
      onComplete: [{ spawn: "ci-stack-ghosts" }, { message: "Someone on the stack ladder says 'ping.' Two more drop out of the steam.", tone: "danger" }],
      next: "ghosts",
    },
    {
      id: "ghosts",
      journal: "A Ghost crew is guarding the relay on the stack. Get them out of the yard.",
      objectives: [{ id: "crew", kind: "clear", encounter: "ci-stack-ghosts", text: "Drive the Ghosts out of the stack yard" }],
      next: "relay",
    },
    {
      id: "relay",
      journal: "The relay is clamped to the south face of the stack at chest height, scrolling Brakka's toll manifests. Smash it as Brakka asked, or pocket it and tell her it's smashed.",
      objectives: [{ id: "fate", kind: "choose", text: "Deal with the relay on the furnace stack", dialogue: "ci.relay", options: ["smash", "pocket"], target: FOUNDRY_SPOTS.relay }],
      next: "report",
    },
    {
      id: "report",
      journal: "Tell Brakka at Foundry Gate station that the stack is clean.",
      objectives: [{ id: "told", kind: "choose", text: "Report to Brakka Venn at Foundry Gate", dialogue: "ci.brakka-stack", options: ["report-smash", "report-pocket"] }],
      next: [{ if: flagIs("stack-relay.fate", "pocket"), stage: "end-pocket" }, { stage: "end-smash" }],
    },
    ending("end-smash", "The relay is scrap and Brakka is pleased.", "smashed"),
    ending("end-pocket", "The relay is in your pocket and Brakka thinks it's scrap.", "pocketed"),
  ],
  outcomes: {
    smashed: {
      title: "Clean Stack", journal: "The Ghost relay is in pieces in the stack yard. Brakka's toll manifests are hers again, and she's started calling you 'friend' instead of 'customer'.",
      effects: [{ credits: 280 }, { xp: 420 }, { rep: "razorbacks", by: 8 }, { rep: "ghosts", by: -5 }, { setFlag: "foundry.relay", value: "smashed" }],
    },
    pocketed: {
      title: "A Quiet Pocket", journal: "Brakka paid for a smashed relay. The relay is in your pocket, still logging. Nix on the Ghost Circuit would like to see it.",
      effects: [{ credits: 280 }, { xp: 420 }, { rep: "razorbacks", by: 4 }, { setFlag: "foundry.relay", value: "pocketed" }],
    },
  },
};

const twoLedgers: QuestDefinition2 = {
  id: LEDGERS, title: "Two Ledgers", category: "contract", giver: "nix", requires: { quest: STACK },
  summary: "Nix says someone in Brakka's toll crew is selling Ghost courier routes to CorpSec. The proof is in the lieutenant Kettle's lockbox.",
  rewardHint: "350 cr, 520 XP, reputation with whoever gets the ledger", recommendedLevel: 6, start: "lockbox",
  stages: [
    {
      id: "lockbox",
      journal: "Kettle, Brakka's lieutenant, keeps a lockbox under the awning on the south-east corner of the Razorback toll junction, on the Foundry's east side one block in from Neon Ward. The toll crew there fights anyone who stops.",
      onEnter: [{ waypoint: { ...FOUNDRY_SPOTS.lockbox, label: "Kettle's lockbox (Foundry toll junction)" } }],
      objectives: [{ id: "box", kind: "interact", object: "ci-lockbox", text: "Open Kettle's lockbox at the Foundry toll junction" }],
      next: "ledger",
    },
    {
      id: "ledger",
      journal: "Kettle's toll book has Ghost courier routes and pickup times pencilled in the margins, and payments from a CorpSec harbour desk. Brakka at Foundry Gate and Nix on the Ghost Circuit both want it. One of them gets it.",
      mode: "any",
      objectives: [
        { id: "to-nix", kind: "deliver", text: "Give the ledger to Nix (Ghost Circuit)", item: "toll-ledger", count: 1, npc: "nix" },
        { id: "to-brakka", kind: "deliver", text: "Or give it to Brakka Venn (Foundry Gate)", item: "toll-ledger", count: 1, npc: BRAKKA.id },
      ],
      next: [{ if: flagIs("two-ledgers.to-nix", true), stage: "end-nix" }, { stage: "end-brakka" }],
    },
    ending("end-nix", "Nix has the ledger.", "nix", [{ message: "Nix reads three pages and goes very still. 'Kettle. He meets his buyers at the furnace stack. Come back when you're ready.'", tone: "quest" }]),
    ending("end-brakka", "Brakka has the ledger.", "brakka", [{ message: "Brakka reads three pages, closes the book and says one word: 'Kettle.'", tone: "quest" }]),
  ],
  outcomes: {
    nix: {
      title: "Ghost Copy", journal: "Nix has proof that Kettle sold Ghost routes to CorpSec out of Brakka's toll book. The Ghosts are changing every route on the west side.",
      effects: [{ credits: 350 }, { xp: 520 }, { rep: "ghosts", by: 10 }, { rep: "razorbacks", by: -8 }, { setFlag: "foundry.ledger", value: "nix" }, { startQuest: IRON }],
    },
    brakka: {
      title: "Brakka's Book", journal: "Brakka has her lieutenant's side ledger. She has stopped smiling at customers. She wants Kettle.",
      effects: [{ credits: 350 }, { xp: 520 }, { rep: "razorbacks", by: 10 }, { rep: "ghosts", by: -6 }, { setFlag: "foundry.ledger", value: "brakka" }, { startQuest: IRON }],
    },
  },
};

const coldIron: QuestDefinition2 = {
  id: IRON, title: "Cold Iron", category: "story", giver: null,
  summary: "Kettle meets his CorpSec buyers under the furnace stack. Break the meet and decide what happens to him.",
  rewardHint: "400-450 cr, 700-800 XP, a weapon or armour piece", recommendedLevel: 7, start: "brief",
  stages: [
    {
      id: "brief", journal: "Whoever has the ledger wants a word about Kettle.", objectives: [],
      next: [{ if: flagIs("foundry.ledger", "nix"), stage: "brief-nix" }, { stage: "brief-brakka" }],
    },
    {
      id: "brief-nix",
      journal: "Nix wants to talk about Kettle. The fixer is on the west edge of the Ghost Circuit, due east of the Meridian Spire.",
      objectives: [{ id: "plan", kind: "choose", text: "Hear Nix's plan for Kettle", dialogue: "ci.nix", options: ["go-nix"] }],
      next: "meet",
    },
    {
      id: "brief-brakka",
      journal: "Brakka wants to talk about Kettle. She is at Foundry Gate station, as always.",
      objectives: [{ id: "plan", kind: "choose", text: "Hear Brakka's plan for Kettle", dialogue: "ci.brakka-stack", options: ["go-brakka"] }],
      next: "meet",
    },
    {
      id: "meet",
      journal: "Kettle is selling next week's routes to CorpSec buyers under the furnace stack in the north-west corner yard, north of Foundry Gate. Get there before the money changes hands.",
      onEnter: [{ waypoint: { ...FOUNDRY_SPOTS.meet, label: "Kettle's meet (furnace stack yard)" } }],
      objectives: [{ id: "arrive", kind: "reach", text: "Get to the furnace stack yard", area: area(FOUNDRY_SPOTS.meet.x, FOUNDRY_SPOTS.meet.z, 18, "Furnace stack yard") }],
      onComplete: [{ spawn: "ci-kettle-meet" }, { message: "Kettle, two CorpSec buyers in harbour grey and a nervous Razorback with the cash bag. Everyone reaches for something.", tone: "danger" }],
      next: "fight",
    },
    {
      id: "fight",
      journal: "Break up Kettle's meet. Leave Kettle breathing: somebody wants to talk to him.",
      objectives: [{ id: "meet-clear", kind: "clear", encounter: "ci-kettle-meet", text: "Break up the meet under the furnace stack" }],
      next: "kettle",
    },
    {
      id: "kettle",
      journal: "Kettle is on his knees by the stack, out of fight and out of excuses. Brakka wants him. Nix wants him. Or he could sign a confession naming his CorpSec buyer, and both of them get the same copy.",
      objectives: [{ id: "fate", kind: "choose", text: "Decide what happens to Kettle", dialogue: "ci.kettle", options: ["to-brakka", "to-nix", "truce"], target: FOUNDRY_SPOTS.kettle }],
      next: [{ if: flagIs("cold-iron.fate", "to-brakka"), stage: "end-iron" }, { if: flagIs("cold-iron.fate", "to-nix"), stage: "end-wire" }, { stage: "end-truce" }],
    },
    ending("end-iron", "Brakka's crew takes Kettle away.", "iron", [{ message: "Two Razorbacks walk Kettle to Foundry Gate. Brakka's toll book is balanced.", tone: "quest" }]),
    ending("end-wire", "A Ghost van takes Kettle away.", "wire", [{ message: "A van with no plates takes Kettle east. Nix will feed CorpSec false routes through him for a month.", tone: "quest" }]),
    ending("end-truce", "Kettle signs, and leaves on the next train.", "truce", [{ message: "Kettle signs both copies and boards the next Rim Line train with nothing but his jacket. Brakka and Nix each get a copy.", tone: "quest" }]),
  ],
  outcomes: {
    iron: {
      title: "Cold Iron", journal: "Kettle answers to Brakka now. The toll on Foundry Gate is tighter than ever, and Ghost couriers pay it like everyone else. Brakka sent you a saw from her confiscations shelf.",
      effects: [{ credits: 450 }, { xp: 700 }, { give: "modulo" }, { rep: "razorbacks", by: 12 }, { rep: "ghosts", by: -10 }, { setFlag: "foundry.truce", value: "razorbacks" }],
    },
    wire: {
      title: "Hot Wire", journal: "Kettle works for Nix now, whether he likes it or not, feeding CorpSec routes that lead nowhere. Ghost couriers walk past Foundry Gate without paying. Nix sent you a hood that cameras can't read.",
      effects: [{ credits: 450 }, { xp: 700 }, { give: "null-hood" }, { rep: "ghosts", by: 12 }, { rep: "razorbacks", by: -10 }, { setFlag: "foundry.truce", value: "ghosts" }],
    },
    truce: {
      title: "Same Page", journal: "Kettle's confession names the CorpSec harbour desk that paid him. Brakka and Nix have the same copy, the same enemy, and a deal: couriers pass Foundry Gate at half toll. Both of them chipped in for a harpoon rifle off the Silk Harbour quay.",
      effects: [{ credits: 400 }, { xp: 800 }, { give: "line-feed" }, { rep: "razorbacks", by: 5 }, { rep: "ghosts", by: 5 }, { rep: "corpsec", by: -8 }, { setFlag: "foundry.truce", value: "truce" }],
    },
  },
};

// ---- Dialogue ----------------------------------------------------------------------------------

const job = (quest: string, label: string, dialogue: string): DialogueOptionDef =>
  ({ id: `ask-${quest}`, label, condition: available(quest), hideIfUnavailable: true, kind: "continue", effects: [{ openDialogue: dialogue, node: "offer" }], next: null });

const DIALOGUES: readonly DialogueDefinition[] = [
  {
    id: "hub.brakka", npc: BRAKKA.id,
    entries: [
      { condition: flagIs("foundry.truce", "razorbacks"), node: "after-iron", priority: 4 },
      { condition: flagIs("foundry.truce", "ghosts"), node: "after-wire", priority: 4 },
      { condition: flagIs("foundry.truce", "truce"), node: "after-truce", priority: 4 },
      { node: "hub" },
    ],
    nodes: [
      node("hub", BRAKKA.greeting, [job(STACK, "Anything that needs doing?", "ci.brakka-stack"), LEAVE]),
      node("after-iron", ["Kettle sweeps the toll booth now. Every night. With a very small broom.", "Shop's open, friend. Confiscations only."], [LEAVE]),
      node("after-wire", ["Ghost couriers walk past my gate and wave. Wave.", "I'm still selling. I'm not selling to you at a discount."], [LEAVE]),
      node("after-truce", ["Half toll for the couriers. Half. I wake up at night thinking about the other half.", "But CorpSec's harbour desk has had two very bad weeks, and I enjoyed every day of them."], [LEAVE]),
    ],
  },
  {
    id: "ci.brakka-stack", npc: BRAKKA.id, quest: STACK,
    entries: [
      { condition: inStage(STACK, "report"), node: "report", priority: 22 },
      { condition: { quest: STACK, status: "active" }, node: "working", priority: 18 },
      { condition: inStage(IRON, "brief-brakka"), node: "kettle-plan", priority: 24 },
    ],
    nodes: [
      node("offer", [
        "Somebody strapped a Ghost relay to my furnace stack, in the yard north of here. It reads the toll manifests off every train that leaves this gate.",
        "Ghosts are guarding it. I'd send my own people, but my own people would start a war, and wars are bad for traffic.",
        "Clear the yard. Smash the relay. Two-eighty.",
      ], [
        { id: "accept-stack", label: "I'll clean your stack.", condition: available(STACK), effects: [{ startQuest: STACK }], next: "accepted" },
        bye("Not my business.", "decline"),
      ]),
      node("accepted", ["North along the Rim Road. You can't miss the stack. It's the thing on fire."], [LEAVE]),
      node("working", ["My stack. My manifests. Their relay. Go."], [LEAVE]),
      node("report", ["Well, customer? Is my stack clean?"], [
        { id: "report-smash", label: "Ghosts gone, relay in pieces. (+280 cr)", condition: { all: [inStage(STACK, "report"), flagIs("stack-relay.fate", "smash")] }, hideIfUnavailable: true, kind: "complete", next: "paid" },
        { id: "report-pocket", label: "Ghosts gone, relay in pieces. [Lie] (+280 cr)", condition: { all: [inStage(STACK, "report"), flagIs("stack-relay.fate", "pocket")] }, hideIfUnavailable: true, kind: "complete", next: "paid" },
        LEAVE,
      ]),
      node("paid", ["Two hundred and eighty. Counted, stamped and logged. Everything here is logged.", "Come back if you get bored. I always have work for people who finish things."], [LEAVE]),
      node("kettle-plan", [
        "Kettle. My own lieutenant. Selling routes out of my book to a CorpSec harbour desk.",
        "He's meeting his buyers tonight under the furnace stack, the same yard you cleaned for me. Break the meet. Bring him to his knees. Don't kill him; I want to hear him explain.",
      ], [{ id: "go-brakka", label: "He'll be on his knees.", condition: inStage(IRON, "brief-brakka"), kind: "accept", next: null }]),
    ],
  },
  {
    id: "ci.relay", npc: "ci-relay", quest: STACK,
    entries: [{ condition: inStage(STACK, "relay"), node: "relay" }],
    nodes: [
      node("relay", [
        "[A palm-sized relay clamped to the stack, hot to the touch. Its screen scrolls Brakka's toll manifests: crate numbers, weights, which train.]",
        "[Someone has scratched a word into the casing: NIX.]",
      ], [
        { id: "smash", label: "Smash it on the stack.", condition: inStage(STACK, "relay"), kind: "complete", next: "smashed" },
        { id: "pocket", label: "Pocket it. Brakka doesn't need to know.", condition: inStage(STACK, "relay"), effects: [{ give: "ghost-relay" }], kind: "complete", next: "pocketed" },
        bye("Leave it for now."),
      ]),
      node("smashed", ["[Glass and copper across the gravel. The scrolling stops.]"], [LEAVE]),
      node("pocketed", ["[You pry it off. It keeps logging in your pocket, warm as a hand.]"], [LEAVE]),
    ],
  },
  {
    id: "ci.nix", npc: "nix", quest: LEDGERS,
    // Nix hears the relay in your pocket and brings it up first; otherwise the cast hub's
    // "About the relay on Brakka's stack" option opens the offer.
    entries: [
      { condition: { all: [available(LEDGERS), { item: "ghost-relay" }] }, node: "offer", priority: 16 },
      { condition: { quest: LEDGERS, status: "active" }, node: "working", priority: 18 },
      { condition: inStage(IRON, "brief-nix"), node: "kettle-plan", priority: 24 },
    ],
    nodes: [
      node("offer", [
        "You cleaned Brakka's stack. That was my relay. No hard feelings; I'd have done the same for that money.",
        "Here's why it was there. Somebody in Brakka's crew is selling my couriers' routes to a CorpSec harbour desk, written into her toll book. Three of my people picked up this month.",
        "Her lieutenant, Kettle, keeps a lockbox at the Foundry toll junction. Bring me that book and I pay three-fifty. Bring it to Brakka instead and I'll know.",
      ], [
        { id: "give-relay", label: "I kept your relay. Here. (+120 cr)", condition: { item: "ghost-relay" }, hideIfUnavailable: true, effects: [{ take: "ghost-relay" }, { credits: 120 }, { setFlag: "foundry.relay-returned", value: true }], kind: "continue", next: "relay-read" },
        { id: "accept-ledgers", label: "I'll get the book.", condition: available(LEDGERS), effects: [{ startQuest: LEDGERS }], next: "accepted" },
        bye("Not my war.", "decline"),
      ]),
      node("relay-read", [
        "You kept it. Of course you did. You're the interesting kind.",
        "[Nix scrolls the relay's log.] There. Every manifest with a Ghost route in the margin was keyed in by one login: KETTLE. Brakka's lieutenant. That's the name I needed.",
      ], [
        { id: "accept-ledgers-2", label: "Then I'll get his book.", condition: available(LEDGERS), effects: [{ startQuest: LEDGERS }], next: "accepted" },
        bye("Let me think.", "decline"),
      ]),
      node("accepted", ["Foundry toll junction, south-east corner, under the awning. The toll crew will want to talk. Don't let them.", "Then bring the book here. Or don't. I'll know either way."], [LEAVE]),
      node("working", ["Kettle's lockbox. Foundry toll junction. Then the book comes to me, or it doesn't."], [LEAVE]),
      node("kettle-plan", [
        "Kettle meets his buyers tonight under the furnace stack in the north-west yard. Two from the CorpSec harbour desk, one of his own carrying the cash.",
        "Break it up. Keep Kettle alive. Alive and scared, he can feed CorpSec any route I like for a month.",
      ], [{ id: "go-nix", label: "Alive and scared. Got it.", condition: inStage(IRON, "brief-nix"), kind: "accept", next: null }]),
    ],
  },
  {
    id: "ci.kettle", npc: "ci-kettle-down", quest: IRON,
    entries: [{ condition: inStage(IRON, "kettle"), node: "plead" }],
    nodes: [
      node("plead", [
        "[Kettle is kneeling in the gravel, his cash bag split open beside him.]",
        "Routes. Only routes! Nobody was supposed to get hurt, the desk just wanted to know where the couriers went!",
        "Brakka will feed me to the furnace. Nix will make me a puppet. There has to be a third thing.",
      ], [
        { id: "to-brakka", label: "Brakka's people are on their way. Wait for them.", condition: inStage(IRON, "kettle"), kind: "complete", next: "taken" },
        { id: "to-nix", label: "Nix's van is on its way. Get comfortable.", condition: inStage(IRON, "kettle"), kind: "complete", next: "taken" },
        go("persuade", "Sign a confession naming your buyer. Both of them get a copy, and you get on a train. [COOL 4]", "plead", {
          check: {
            stat: "cool", difficulty: 4, success: "signs", failure: "refuses",
            bonus: [
              { if: { rep: "razorbacks", atLeast: 5 }, by: 1, label: "Brakka trusts you" },
              { if: { rep: "ghosts", atLeast: 5 }, by: 1, label: "Nix trusts you" },
            ],
          },
        }),
      ]),
      node("signs", ["[He looks at the pen for a long time.]", "...A train. Any train. Fine. The desk sergeant's name is Okafor-Lisle, and he pays in harbour scrip. I'll write it twice."], [
        { id: "truce", label: "Write it twice. Then walk to the station.", condition: inStage(IRON, "kettle"), kind: "complete", next: null },
      ]),
      node("refuses", ["A confession? So both of them can hang me with the same rope? No.", "Pick one of them. I'll take my chances."], [go("back", "Have it your way.", "plead")]),
      node("taken", ["[Kettle sags. He doesn't run. There's nowhere on the Rim Road to run to.]"], [LEAVE]),
    ],
  },
];

/** Brakka sells her confiscations: whatever didn't pay the toll. */
const VENDORS: NonNullable<ContentPack["vendors"]> = [
  { npc: BRAKKA.id, markup: 1.3, stock: ["modulo", "query", "colon-scatter", "tab-stop", "kernel-plate", "welders-mask", "patch-notes", "kiln-coffee", "medkit", "ammo-shell", "ammo-rifle"] },
];

export const COLD_IRON_PACK: ContentPack = {
  id: "cold-iron",
  npcs: [BRAKKA],
  items: ITEMS,
  archetypes: ARCHETYPES,
  encounters: ENCOUNTERS,
  interactables: INTERACTABLES,
  quests: [stackRelay, twoLedgers, coldIron],
  dialogues: DIALOGUES,
  vendors: VENDORS,
};
