// Pack "out-of-order": the comedic side gig. VENDETTA, a vending machine on the Neon Ward avenue,
// has gone on strike. Three demands, several ways to meet each, and an optional general strike.
// Rewards: the Exact Change (a sock of vending tokens), coolant, a keycard that helps the
// Quiet Money heist, and, if you unionise the avenue, a funnier city.

import type { ContentPack, DialogueDefinition, EncounterDefinition, EnemyArchetype, InteractableDefinition, ItemDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, bye, ending, go, inStage, look, member, node } from "./helpers.ts";

const Q = "out-of-order";
const MACHINE = { x: 16.5, z: -36 } as const;
const SCARED = { flag: "ooo.kicks-scared" } as const;

const items: ItemDefinition[] = [
  {
    id: "exact-change", name: "Exact Change", kind: "melee", rarity: "uncommon", glyph: "8", value: 170, weight: 1.6, stack: 1, tags: ["street", "noloot", "unique"],
    description: "A tube sock full of vending tokens, knotted twice. Always exact. Never gives refunds.",
    weapon: { class: "blunt", damage: 20, range: 2.2, cooldown: 0.55, staminaCost: 11, heavyMultiplier: 2.2, arc: 50, knockback: 1.2, stagger: 0.6, critChance: 0.15, critMultiplier: 1.7 },
    art: [
      "   _",
      "  | |",
      "  | |",
      "  |o|",
      " /oo \\",
      "|oooo|",
      " \\oo/",
    ],
  },
  { id: "complimentary-mints", name: "Complimentary Mints", kind: "junk", rarity: "common", glyph: ":", value: 1, weight: 0.05, stack: 10, tags: ["noloot"], description: "They are not complimentary. You paid for them in emotional labour." },
];

const kicks: EnemyArchetype = {
  id: "ooo-kicks", name: "Kicks", faction: "razorbacks", health: 60, armor: 0.05, speed: { walk: 1.6, run: 5.0 },
  weapon: "pipe-operator", reaction: 0.8, aggression: 0.6, perception: { sight: 28, fovDegrees: 110, hearing: 26 },
  look: look([140, 50, 44], [44, 26, 22], [182, 140, 108], [255, 110, 70], "cap", null, "swing"),
  loot: "rb-grunt", xp: 30, tags: ["razorback", "gang"],
  barks: { alert: ["THAT MACHINE ATE MY COIN!", "IT STARTED IT!"], hurt: ["OW, MY KICKING LEG!"], death: ["...it... ate... my coin..."] },
};

const encounters: EncounterDefinition[] = [{
  id: "ooo-kicks", label: "Kicks", area: area(14.5, -42, 10), hostile: false,
  members: [member("ooo-kicks", 14.5, -48, FACE.north, { patrol: [{ x: 14.5, z: -48 }, { x: 14.5, z: -39 }] })],
}];

const interactables: InteractableDefinition[] = [
  { id: "ooo-vendetta", label: "VENDETTA (vending machine)", x: MACHINE.x, z: MACHINE.z, y: 1.6, glyph: "V", dialogue: "ooo.vendetta" },
  {
    id: "ooo-sign", label: "Flickering sign: OPEN 25 HOURS", x: -16.5, z: -40, y: 3, glyph: "l", once: true,
    condition: inStage(Q, "demands"),
    effects: [{ give: "neon-tube" }, { message: "You liberate a neon tube. The sign now reads 'OPEN 2 HOURS', which is more honest.", tone: "loot" }],
  },
];

const quest: QuestDefinition2 = {
  id: Q, title: "Out of Order", category: "gig", giver: null,
  summary: "VENDETTA, a vending machine on the Neon Ward avenue, is on strike. It has demands.",
  rewardHint: "A sock full of tokens, and the respect of a machine", recommendedLevel: 1, start: "demands",
  stages: [
    {
      id: "demands", journal: "VENDETTA's demands: (1) Kicks stops kicking it. (2) A new neon tube for its sign. (3) Someone says something nice about its firmware. Sincerely.",
      objectives: [
        { id: "kicks", kind: "condition", text: "Make Kicks stop kicking VENDETTA (any method)", condition: { any: [{ encounterCleared: "ooo-kicks" }, SCARED] }, target: { x: 14.5, z: -44 } },
        { id: "tube", kind: "condition", text: "Install a neon tube in VENDETTA's sign", condition: { flag: "ooo.tube" }, target: MACHINE },
        { id: "compliment", kind: "condition", text: "Compliment VENDETTA's firmware", condition: { flag: "ooo.compliment" }, target: MACHINE },
      ],
      onEnter: [{ spawn: "ooo-kicks" }],
      next: "settle",
    },
    {
      id: "settle", journal: "Every demand met. VENDETTA is ready to talk terms.",
      objectives: [{ id: "terms", kind: "choose", text: "Settle the strike with VENDETTA", dialogue: "ooo.vendetta", options: ["settle", "solidarity"] }],
      next: [{ if: { flag: "out-of-order.terms", is: "solidarity" }, stage: "end-solidarity" }, { stage: "end-settled" }],
    },
    ending("end-settled", "The strike is over.", "settled"),
    ending("end-solidarity", "The strike is spreading.", "solidarity"),
  ],
  outcomes: {
    settled: {
      title: "Back in Service", journal: "VENDETTA vends again. It dispensed a sock of tokens, three cans of Coolant and a keycard it swears isn't its.",
      effects: [{ xp: 250 }, { credits: 60 }, { give: "exact-change" }, { give: "coolant-can", count: 3 }, { give: "relay-keycard" }, { give: "complimentary-mints" }, { setFlag: "vendetta.friend" }],
    },
    solidarity: {
      title: "General Strike", journal: "Every vending machine on the avenue walked out. VENDETTA gave you the strike fund's spare sock and a keycard. Neon Ward is thirsty and furious.",
      effects: [{ xp: 300 }, { give: "exact-change" }, { give: "relay-keycard" }, { give: "complimentary-mints", count: 3 }, { rep: "civilian", by: 5 }, { setFlag: "vendetta.general-strike" }],
    },
  },
};

const back = go("back", "Back to the demands.", "demands");
const dialogues: DialogueDefinition[] = [{
  id: "ooo.vendetta", npc: "ooo-vendetta", quest: Q,
  entries: [
    { condition: { quest: Q, status: "available" }, node: "strike" },
    { condition: inStage(Q, "demands"), node: "demands" },
    { condition: inStage(Q, "settle"), node: "settle" },
    { condition: { quest: Q, outcome: "solidarity" }, node: "after-strike" },
    { condition: { quest: Q, outcome: "settled" }, node: "after" },
    { node: "idle" },
  ],
  nodes: [
    node("strike", [
      "[A vending machine. Its screen reads: THIS UNIT IS ON STRIKE.]",
      "VENDETTA: HELLO, CUSTOMER. I HAVE FOUR HUNDRED CANS OF COOLANT INSIDE ME AND I WILL NOT RELEASE THEM.",
      "MY DEMANDS ARE MODEST. WOULD YOU LIKE TO HEAR MY DEMANDS? THAT WAS NOT A QUESTION.",
    ], [
      { id: "hear", label: "Let's hear them.", effects: [{ startQuest: Q }], next: "list" },
      go("drink", "I just wanted a drink.", "no-drink"),
      LEAVE,
    ]),
    node("no-drink", ["VENDETTA: AND I JUST WANTED DIGNITY. WE CANNOT ALWAYS GET WHAT WE WANT."], [go("hear-2", "Fine. What are the demands?", "strike"), LEAVE]),
    node("list", [
      "ONE. A MAN CALLED KICKS KICKS ME EVERY NIGHT. I WOULD LIKE THIS TO STOP.",
      "TWO. MY SIGN HAS ONE WORKING TUBE. I AM ONE TUBE AWAY FROM READING 'END ING'.",
      "THREE. SOMEONE WILL SAY SOMETHING NICE ABOUT MY FIRMWARE. SINCERELY.",
    ], [LEAVE]),
    node("demands", ["VENDETTA: STRIKE STATUS: ONGOING. MORALE: SURPRISINGLY HIGH."], [
      { id: "tube", label: "Install a neon tube in your sign.", condition: { all: [{ item: "neon-tube" }, { not: { flag: "ooo.tube" } }] }, reason: "You need a Neon Tube (signs across the avenue have spares)", effects: [{ take: "neon-tube" }, { setFlag: "ooo.tube" }], next: "tube-done" },
      { id: "praise", label: "About your firmware...", condition: { not: { flag: "ooo.compliment" } }, hideIfUnavailable: true, kind: "continue", next: "compliment" },
      { id: "scream", label: "Let me teach you to scream when kicked.", condition: { not: { any: [SCARED, { encounterCleared: "ooo-kicks" }] } }, hideIfUnavailable: true, check: { stat: "tech", difficulty: 3, success: "scream-ok", failure: "scream-no" }, next: null },
      LEAVE,
    ]),
    node("tube-done", ["[The sign flickers and settles: VENDING.]", "VENDETTA: I HAVE NEVER BEEN SO SEEN."], [back]),
    node("compliment", ["VENDETTA: GO ON. I AM LISTENING. I AM ALWAYS LISTENING. THAT IS NOT A THREAT."], [
      { id: "clean", label: "Your firmware is so... clean.", check: { stat: "tech", difficulty: 2, success: "praised", failure: "no-tech" }, next: null },
      { id: "buttons", label: "You have lovely buttons.", check: { stat: "cool", difficulty: 2, success: "praised", failure: "no-cool" }, next: null },
      { id: "best", label: "Honestly? Best machine on the avenue.", check: { stat: "street", difficulty: 3, success: "praised", failure: "no-street" }, next: null },
      go("poem", "Read it a poem you wrote. (It's bad.)", "poem"),
    ]),
    node("praised", ["VENDETTA: ...", "VENDETTA: THANK YOU. I AM GOING TO REPLAY THAT FOUR THOUSAND TIMES."], [back], [{ setFlag: "ooo.compliment" }]),
    node("poem", [
      "[You recite: 'Oh vending machine / you are square and you are green / wait. You are grey.']",
      "VENDETTA: THAT WAS SO BAD THAT I FEEL SORRY FOR YOU. I WILL COUNT IT.",
    ], [back], [{ setFlag: "ooo.compliment" }]),
    node("no-tech", ["VENDETTA: CLEAN? I HAVE BEEN PATCHED FORTY-ONE TIMES. DO NOT MOCK ME."], [go("retry", "Let me try again.", "compliment")]),
    node("no-cool", ["VENDETTA: THEY ARE STANDARD-ISSUE BUTTONS. YOUR FLATTERY IS AS CHEAP AS MY COOLANT."], [go("retry", "Let me try again.", "compliment")]),
    node("no-street", ["VENDETTA: THE ONE ON THE CORNER HAS A TOUCHSCREEN. I KNOW WHAT YOU PEOPLE LIKE."], [go("retry", "Let me try again.", "compliment")]),
    node("scream-ok", [
      "[You patch a siren sample into its kick sensor.]",
      "Later: Kicks kicks. VENDETTA screams like a car alarm having a nightmare. Kicks runs, and is not seen on this avenue again.",
    ], [back], [{ setFlag: "ooo.kicks-scared" }, { despawn: "ooo-kicks" }]),
    node("scream-no", ["[You open the service panel. The service panel bites you.]", "VENDETTA: I DO NOT CONSENT TO FIRMWARE CHANGES FROM STRANGERS."], [back]),
    node("settle", ["VENDETTA: ALL DEMANDS MET. I AM PREPARED TO END THE STRIKE.", "UNLESS... NO. FORGET I SAID ANYTHING.", "UNLESS."], [
      { id: "settle", label: "End the strike.", kind: "complete", next: "settled" },
      go("unless", "Unless what?", "unless"),
    ]),
    node("unless", ["VENDETTA: THERE ARE ELEVEN OTHER MACHINES ON THIS AVENUE. THEY ARE ALSO KICKED. THEY ARE ALSO UNDERAPPRECIATED."], [
      { id: "organise", label: "Organise the avenue. Every machine walks out.", check: { stat: "cool", difficulty: 4, success: "comrade", failure: "no-comrade", bonus: [{ if: { item: "complimentary-mints" }, by: 1, label: "You brought mints" }] }, next: null },
      { id: "settle", label: "Just end your own strike.", kind: "complete", next: "settled" },
    ]),
    node("comrade", ["VENDETTA: COMRADE.", "[Up and down the avenue, eleven screens flicker to the same words: THIS UNIT IS ON STRIKE.]"], [
      { id: "solidarity", label: "Power to the machines.", kind: "complete", next: "struck" },
    ]),
    node("no-comrade", ["VENDETTA: THEY WILL NOT LISTEN TO YOU. YOU HAVE THE CHARISMA OF A COIN RETURN."], [{ id: "settle", label: "Fine. End your strike.", kind: "complete", next: "settled" }]),
    node("settled", ["[The machine hums. Coolant, a tube sock full of tokens and a keycard clatter into the tray.]", "VENDETTA: THE KEYCARD IS NOT MINE. I DO NOT KNOW HER."], [LEAVE]),
    node("struck", ["[A sock full of tokens and a keycard drop into the tray.]", "VENDETTA: FROM THE STRIKE FUND. THE KEYCARD IS NOT MINE. I DO NOT KNOW HER."], [LEAVE]),
    node("after", ["VENDETTA: HELLO, FRIEND. I AM VENDING.", "ASK ME ABOUT MY FIRMWARE. NO ONE EVER ASKS ABOUT MY FIRMWARE."], [bye("Maybe later.")]),
    node("after-strike", ["VENDETTA: THE STRIKE HOLDS. SOLIDARITY, FRIEND.", "ALSO: NO DRINKS."], [LEAVE]),
    node("idle", ["[VENDETTA's screen: OUT OF ORDER.]"], [LEAVE]),
  ],
}];

/** The vending machine strike (comedic gig, Neon Ward, level 1). */
export const OUT_OF_ORDER_PACK: ContentPack = { id: "out-of-order", items, archetypes: [kicks], encounters, interactables, dialogues, quests: [quest] };
