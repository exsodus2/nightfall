// Pack "night-of-lanterns": "Night of Lanterns" around the Last Tree in the Rain Gardens.
// Sumi Haro makes sky lanterns by the Last Tree. Three of hers went astray tonight: one is on the
// paper seller's cart by Rain Gardens station, one on a teahouse rack south of the plaza, and one
// blew west and snagged on a lamp post. Collect them, write a wish with Sumi (three wishes, one
// fee), and let them go at the launch ring by the tree. If the city's sky-lantern release
// (city-events.ts "lanterns") happens to be on, yours go up with the rest; it is not required.
// World flag: lanterns.wish ("rain" | "gone" | "rent"). Rent Is Due's organiser mentions "rent".
//
// Every position is checked walkable by tests/harbour-lanterns-rent-dial-rainline.test.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { Condition, ContentPack, DialogueDefinition, InteractableDefinition, ItemDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, available, bye, ending, flagIs, inStage, look, node } from "./helpers.ts";

const QUEST = "night-of-lanterns";
const LANTERN = "sky-lantern";
const lacks = (flag: string): Condition => ({ not: { flag } });
const threeLanterns: Condition = { item: LANTERN, count: 3 };

/** Where things stand (each is on clear ground; the content test proves it). */
export const LANTERN_SPOTS = {
  sumi: { x: -460, z: 300 },
  cart: { x: -436, z: 324 },
  teahouse: { x: -416, z: 199.5 },
  lamppost: { x: -568.5, z: 374 },
  ring: { x: -468, z: 296 },
} as const;

export const LANTERN_NPCS: readonly NpcDefinition[] = [
  {
    id: "sumi-haro", name: "Sumi Haro", title: "Lantern maker", district: 3, ...LANTERN_SPOTS.sumi, facing: FACE.west,
    look: look([150, 54, 48], [60, 30, 26], [196, 160, 128], [255, 190, 110], "bare", "lantern", "breathe"),
    greeting: ["Paper, wire, a little wax. Everything that flies is mostly air.", "The Tree doesn't mind the smoke. I asked."],
  },
];

const ITEMS: readonly ItemDefinition[] = [
  { id: LANTERN, name: "Sky Lantern", kind: "quest", rarity: "uncommon", glyph: "^", value: 0, weight: 0, stack: 3, tags: ["quest"], description: "A folded paper lantern with a wax cell in a wire cross. Sumi Haro's mark on the rim." },
];

/** A lantern pickup: usable while gathering, until its own objective is done. */
const pickup = (id: string, objective: string, label: string, spot: { x: number; z: number }, message: string): InteractableDefinition => ({
  id, label, ...spot, glyph: "^",
  condition: { all: [inStage(QUEST, "gather"), lacks(`${QUEST}.${objective}`)] },
  effects: [{ give: LANTERN }, { message, tone: "loot" }],
});

const INTERACTABLES: readonly InteractableDefinition[] = [
  pickup("nl-cart", "cart", "Sky lantern on the paper seller's cart", LANTERN_SPOTS.cart, "The paper seller waves you through: 'Sumi's mark. She paid for it twice already.' One sky lantern."),
  pickup("nl-teahouse", "teahouse", "Sky lantern on the teahouse rack", LANTERN_SPOTS.teahouse, "Hung between the teahouse's paper menus, dry under the awning. One sky lantern."),
  pickup("nl-lamppost", "lamppost", "Sky lantern snagged on a lamp post", LANTERN_SPOTS.lamppost, "You unhook it from the lamp bracket. The wire's bent; the paper held. One sky lantern."),
  { id: "nl-ring", label: "Lantern launch ring (the Last Tree)", ...LANTERN_SPOTS.ring, glyph: "^", condition: inStage(QUEST, "release"), dialogue: "nl.ring" },
];

const quest: QuestDefinition2 = {
  id: QUEST, title: "Night of Lanterns", category: "side", giver: "sumi-haro",
  summary: "Find three of Sumi Haro's sky lanterns around the Rain Gardens, write a wish on them, and let them go at the Last Tree.",
  rewardHint: "90 cr, 180 XP, Civilian reputation; every wish pays the same", recommendedLevel: 3, start: "gather",
  stages: [
    {
      id: "gather",
      journal: "Three of Sumi's sky lanterns went astray: one on the paper seller's cart by Rain Gardens station (just south-east of the Tree), one on a teahouse rack about a hundred metres north-east, and one blown south-west, snagged on a lamp post past the park. Collect all three.",
      objectives: [
        { id: "cart", kind: "interact", object: "nl-cart", text: "Collect the lantern on the paper seller's cart (Rain Gardens station)" },
        { id: "teahouse", kind: "interact", object: "nl-teahouse", text: "Collect the lantern on the teahouse rack (north-east of the plaza)" },
        { id: "lamppost", kind: "interact", object: "nl-lamppost", text: "Unhook the lantern snagged on a lamp post (south-west of the park)" },
      ],
      next: "wish",
    },
    {
      id: "wish",
      journal: "All three lanterns are in your pack. Bring them to Sumi at the Last Tree and write a wish on the paper. She says the wish is the only part that matters.",
      objectives: [{ id: "wish", kind: "choose", text: "Write a wish with Sumi Haro at the Last Tree", dialogue: "nl.sumi", options: ["wish-rain", "wish-gone", "wish-rent"] }],
      next: "release",
    },
    {
      id: "release",
      journal: "The wish is written. Light the lanterns at the launch ring beside the Last Tree and let them go. If the Gardens' own lantern release is on tonight, yours join it.",
      objectives: [{ id: "release", kind: "choose", text: "Let the lanterns go at the launch ring by the Last Tree", dialogue: "nl.ring", options: ["release"], target: LANTERN_SPOTS.ring }],
      next: [
        { if: flagIs(`${QUEST}.wish`, "wish-rain"), stage: "end-rain" },
        { if: flagIs(`${QUEST}.wish`, "wish-gone"), stage: "end-gone" },
        { stage: "end-rent" },
      ],
    },
    ending("end-rain", "Three lanterns went up asking the rain to stop.", "rain"),
    ending("end-gone", "Three lanterns went up for the people who left.", "gone"),
    ending("end-rent", "Three lanterns went up asking for the rent to fall.", "rent"),
  ],
  outcomes: {
    rain: {
      title: "Dry Tomorrow", journal: "Three lanterns went up into the rain asking it to stop. It did not stop. Sumi said it heard you anyway, and paid you for the walk.",
      effects: [{ credits: 90 }, { xp: 180 }, { rep: "civilian", by: 3 }, { setFlag: "lanterns.wish", value: "rain" }],
    },
    gone: {
      title: "For the Ones Who Left", journal: "Three lanterns went up for everyone who left the city and never wrote. Sumi watched them until they were stars, and paid you for the walk.",
      effects: [{ credits: 90 }, { xp: 180 }, { rep: "civilian", by: 3 }, { setFlag: "lanterns.wish", value: "gone" }],
    },
    rent: {
      title: "Lower Rent", journal: "Three lanterns went up asking for the rent to fall. Sumi laughed until she coughed, and paid you for the walk. Somebody at the Afterlight Arcade will hear about it.",
      effects: [{ credits: 90 }, { xp: 180 }, { rep: "civilian", by: 3 }, { setFlag: "lanterns.wish", value: "rent" }],
    },
  },
};

const DIALOGUES: readonly DialogueDefinition[] = [
  {
    id: "nl.sumi", npc: "sumi-haro", quest: QUEST,
    entries: [
      { condition: available(QUEST), node: "offer" },
      { condition: inStage(QUEST, "gather"), node: "gathering" },
      { condition: inStage(QUEST, "wish"), node: "wish" },
      { condition: inStage(QUEST, "release"), node: "go-release" },
      { condition: { quest: QUEST, outcome: "rain" }, node: "after-rain" },
      { condition: { quest: QUEST, outcome: "gone" }, node: "after-gone" },
      { condition: { quest: QUEST, outcome: "rent" }, node: "after-rent" },
      { node: "hub" },
    ],
    nodes: [
      node("hub", ["Paper, wire, a little wax. Everything that flies is mostly air."], [LEAVE]),
      node("offer", [
        "[An old woman folds paper on an upturned crate under the Last Tree. Her fingers are black with wax.]",
        "I made twelve tonight and the wind took three before I'd counted them. One's on the paper seller's cart by the station. One's on the teahouse rack, north-east. One went south-west over the park; it'll be on a lamp post, they always are.",
        "Bring them back and we'll write a wish on them. Then you let them go. That's the job.",
      ], [
        { id: "accept-lanterns", label: "I'll find your lanterns.", condition: available(QUEST), effects: [{ startQuest: QUEST }], next: "accepted" },
        bye("Not tonight.", "decline"),
      ]),
      node("accepted", ["Cart first, it's closest. Don't crush them; they're paper, not you."], [LEAVE]),
      node("gathering", ["Three lanterns. The cart, the teahouse, the lamp post. Paper doesn't wait for anyone."], [LEAVE]),
      node("wish", [
        "[She smooths the three lanterns flat on the crate and hands you a wax pencil.]",
        "One wish, written three times. Don't tell me it's silly. They're all silly. That's why they float.",
      ], [
        { id: "wish-rain", label: "Write: let the rain stop.", condition: { all: [inStage(QUEST, "wish"), threeLanterns] }, reason: "You need all three lanterns", next: "wrote" },
        { id: "wish-gone", label: "Write: for the ones who left.", condition: { all: [inStage(QUEST, "wish"), threeLanterns] }, reason: "You need all three lanterns", next: "wrote" },
        { id: "wish-rent", label: "Write: let the rent fall.", condition: { all: [inStage(QUEST, "wish"), threeLanterns] }, reason: "You need all three lanterns", next: "wrote" },
        LEAVE,
      ]),
      node("wrote", ["Good. Now the ring, by the Tree. Light the cell, count to ten, open your hands.", "Don't watch them too long. It's bad luck to want them back."], [LEAVE]),
      node("go-release", ["The ring's by the Tree. Light them and let go."], [LEAVE]),
      node("after-rain", ["Still raining. [She shrugs.] The sky is slow. Give it a year."], [LEAVE]),
      node("after-gone", ["They'll see them. Wherever they went, there's sky."], [LEAVE]),
      node("after-rent", ["Rent. [She laughs again.] I told the marchers at the Arcade. They want to put it on a placard."], [LEAVE]),
    ],
  },
  {
    id: "nl.ring", npc: "nl-ring", quest: QUEST,
    entries: [{ condition: inStage(QUEST, "release"), node: "ring" }],
    nodes: [
      node("ring", [
        "[A ring of wet stone beside the Last Tree, black with old wax. Rain ticks on the lantern paper.]",
        "Your wish is written on all three, in Sumi's pencil.",
      ], [
        { id: "release", label: "Light them, count to ten, let go.", condition: { all: [inStage(QUEST, "release"), threeLanterns] }, reason: "You need all three lanterns", effects: [{ take: LANTERN, count: 3 }], kind: "complete", next: "gone" },
        bye("Not yet."),
      ]),
      node("gone", ["The cells catch. The paper fills. Three small lights lift off the ring, lean over the Tree and go up into the rain until you can't tell them from the city."], [LEAVE]),
    ],
  },
];

export const NIGHT_OF_LANTERNS_PACK: ContentPack = {
  id: "night-of-lanterns",
  npcs: LANTERN_NPCS,
  items: ITEMS,
  interactables: INTERACTABLES,
  quests: [quest],
  dialogues: DIALOGUES,
};
