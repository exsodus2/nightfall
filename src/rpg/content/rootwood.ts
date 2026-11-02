// Pack "rootwood": Rootwood Park jobs for its keeper, Billie Achterberg. The park fills the nine
// blocks x -576..-384, z 192..384 in the Rain Gardens (src/city/park.ts): the fountain court at
// (-480, 224), Lantern Walk running north-west from it, the pond and its steps on the east side,
// the Koi Gate and Moth Lamp sculptures, and the south lawn. The Last Tree and the arena belong to
// the main story and are left alone here.
//
// Quests:
//  - Lantern Walk: a Razorback crew is stripping lantern coils; win them back and decide what
//    happens to the boy keeping lookout (flag rootwood.lookout: "spared" | "held").
//  - Survey Stakes (after Lantern Walk): pull Meridian's development stakes and deal with the
//    surveyor by fight, by argument [TECH] or by money (flag rootwood.survey: "scrubbed" | "routed").
//
// Every position here is checked walkable by tests/content-rim-park-foundry.test.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, DialogueOptionDef, EncounterDefinition, InteractableDefinition, ItemDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, available, bye, ending, flagIs, go, inStage, look, member, node } from "./helpers.ts";

const LANTERNS = "lantern-walk";
const SURVEY = "survey-stakes";

export const ROOTWOOD_SPOTS = {
  lanternWalk: { x: -544, z: 226 },
  cart: { x: -532, z: 236 },
  lookout: { x: -528, z: 242 },
  stakePond: { x: -444, z: 252 },
  stakeKoi: { x: -409, z: 296 },
  stakeMoth: { x: -428, z: 360 },
  surveyor: { x: -430, z: 344 },
} as const;

export const BILLIE: NpcDefinition = {
  id: "billie", name: "Wilhelmina 'Billie' Achterberg", title: "Park keeper", district: 3, x: -472, z: 240, facing: FACE.north,
  look: look([70, 110, 60], [40, 56, 30], [214, 188, 164], [190, 255, 150], "cap", "lantern", "breathe"),
  greeting: [
    "Keep to the gravel, please. That moss is older than your grandmother and twice as tired.",
    "Rootwood has forty lanterns, nine hundred trees and one keeper. Guess which one is short-staffed.",
  ],
};

const ITEMS: readonly ItemDefinition[] = [
  { id: "lantern-coil", name: "Lantern Coil", kind: "quest", rarity: "common", glyph: "o", value: 0, weight: 0, stack: 10, tags: ["quest"], description: "A copper glow-coil from a Rootwood Park lantern, its brass cap bent where someone pried it out." },
];

const ENCOUNTERS: readonly EncounterDefinition[] = [
  {
    id: "rw-strippers", label: "Lantern strippers (Lantern Walk)", area: area(ROOTWOOD_SPOTS.lanternWalk.x, ROOTWOOD_SPOTS.lanternWalk.z, 14), hostile: true,
    members: [member("rb-thug", -550, 222, FACE.east), member("rb-thug", -540, 216, FACE.south), member("rb-gunner", -546, 234, FACE.north)],
  },
  {
    id: "rw-survey-detail", label: "Meridian survey detail (south lawn)", area: area(ROOTWOOD_SPOTS.surveyor.x, ROOTWOOD_SPOTS.surveyor.z, 14), hostile: true,
    members: [member("corp-trooper", -438, 340, FACE.east), member("corp-trooper", -422, 342, FACE.west), member("corp-handler", -432, 352, FACE.north)],
  },
];

const stake = (id: string, label: string, at: { x: number; z: number }, where: string): InteractableDefinition => ({
  id, label, ...at, glyph: "!", once: true,
  condition: inStage(SURVEY, "stakes"),
  effects: [{ message: `You pull the survey stake ${where}. Orange paint on the tip: MERIDIAN LAND / LOT 7.`, tone: "quest" }],
});

const INTERACTABLES: readonly InteractableDefinition[] = [
  {
    id: "rw-cart", label: "Scavengers' handcart", ...ROOTWOOD_SPOTS.cart, glyph: "=", once: true,
    condition: inStage(LANTERNS, "cart"),
    effects: [{ give: "lantern-coil", count: 6 }, { message: "Six lantern coils in a feed sack, caps bent, still warm from their lamps.", tone: "quest" }],
  },
  {
    id: "rw-lookout", label: "Boy hiding by the cart", ...ROOTWOOD_SPOTS.lookout, glyph: "@",
    condition: inStage(LANTERNS, "cart"), dialogue: "rw.lookout",
  },
  stake("rw-stake-pond", "Survey stake (Pond steps)", ROOTWOOD_SPOTS.stakePond, "out of the Pond steps"),
  stake("rw-stake-koi", "Survey stake (Koi Gate)", ROOTWOOD_SPOTS.stakeKoi, "from beside the Koi Gate"),
  stake("rw-stake-moth", "Survey stake (Moth Lamp)", ROOTWOOD_SPOTS.stakeMoth, "from under the Moth Lamp"),
  {
    id: "rw-surveyor", label: "Imre Sato, surveyor", ...ROOTWOOD_SPOTS.surveyor, glyph: "@",
    condition: inStage(SURVEY, "crew"), dialogue: "rw.surveyor",
  },
];

const lanternWalk: QuestDefinition2 = {
  id: LANTERNS, title: "Lantern Walk", category: "side", giver: BILLIE.id,
  summary: "Someone is stripping the copper coils out of Rootwood Park's lanterns. Billie the keeper wants them back in their lamps.",
  rewardHint: "180-220 cr, 300 XP, moss poultices", recommendedLevel: 4, start: "walk",
  stages: [
    {
      id: "walk",
      journal: "The lanterns are going dark along Lantern Walk, the gravel path from the fountain court north-west to the park's corner gate. Walk it and find who is pulling the coils.",
      onEnter: [{ waypoint: { ...ROOTWOOD_SPOTS.lanternWalk, label: "Lantern Walk" } }],
      objectives: [{ id: "path", kind: "reach", text: "Walk up Lantern Walk, north-west of the fountain", area: area(ROOTWOOD_SPOTS.lanternWalk.x, ROOTWOOD_SPOTS.lanternWalk.z, 14, "Lantern Walk") }],
      onComplete: [{ spawn: "rw-strippers" }, { message: "Pliers, a ladder, and three Razorbacks with their hands in a lantern. They drop the ladder.", tone: "danger" }],
      next: "strippers",
    },
    {
      id: "strippers",
      journal: "Three Razorbacks are stripping the lanterns on Lantern Walk in Rootwood Park. Stop them before they take the rest.",
      objectives: [{ id: "crew", kind: "clear", encounter: "rw-strippers", text: "Stop the lantern strippers" }],
      next: "cart",
    },
    {
      id: "cart",
      journal: "The strippers left a handcart on Lantern Walk with the coils in a sack, and a boy of about twelve is hiding behind it. Take the coils, then decide what to do with him.",
      objectives: [
        { id: "coils", kind: "interact", object: "rw-cart", text: "Take the coils off the handcart" },
        { id: "boy", kind: "choose", text: "Deal with the boy behind the cart", dialogue: "rw.lookout", options: ["let-go", "hold"], target: ROOTWOOD_SPOTS.lookout },
      ],
      next: "rehang",
    },
    {
      id: "rehang",
      journal: "Bring the six coils back to Billie at the fountain court so they can go back in their lamps.",
      objectives: [{ id: "coils-back", kind: "deliver", text: "Give Billie the six lantern coils (fountain court)", item: "lantern-coil", count: 6, npc: BILLIE.id }],
      next: [{ if: flagIs("lantern-walk.boy", "hold"), stage: "end-held" }, { stage: "end-spared" }],
    },
    ending("end-spared", "The coils are back. The boy went home.", "spared"),
    ending("end-held", "The coils are back. The boy is holding the ladder.", "held"),
  ],
  outcomes: {
    spared: {
      title: "Lanterns Lit", journal: "Lantern Walk is lit again. The boy, Pip, ran back to the Razorbacks with a story about the stranger who let him go. Billie says that kind of story travels.",
      effects: [{ credits: 180 }, { xp: 300 }, { give: "moss-poultice", count: 3 }, { rep: "civilian", by: 3 }, { rep: "razorbacks", by: 3 }, { setFlag: "rootwood.lookout", value: "spared" }],
    },
    held: {
      title: "Ladder Duty", journal: "Lantern Walk is lit again, and Pip rehung every coil himself while Billie held the ladder and lectured him on moss. He's on her payroll now, at pocket-money rates.",
      effects: [{ credits: 220 }, { xp: 300 }, { give: "moss-poultice", count: 3 }, { rep: "civilian", by: 6 }, { rep: "razorbacks", by: -2 }, { setFlag: "rootwood.lookout", value: "held" }],
    },
  },
};

const surveyStakes: QuestDefinition2 = {
  id: SURVEY, title: "Survey Stakes", category: "side", giver: BILLIE.id, requires: { quest: LANTERNS },
  summary: "Meridian surveyors have staked out Rootwood Park for a development tender. Pull the stakes and send the surveyor home with nothing he can use.",
  rewardHint: "260-300 cr, 420 XP", recommendedLevel: 5, start: "stakes",
  stages: [
    {
      id: "stakes",
      journal: "Three Meridian survey stakes: on the Pond steps on the park's east side, beside the Koi Gate sculpture north-east of the park station, and under the Moth Lamp on the south lawn. Pull all three, in any order.",
      objectives: [
        { id: "pond", kind: "interact", object: "rw-stake-pond", text: "Pull the stake on the Pond steps" },
        { id: "koi", kind: "interact", object: "rw-stake-koi", text: "Pull the stake beside the Koi Gate" },
        { id: "moth", kind: "interact", object: "rw-stake-moth", text: "Pull the stake under the Moth Lamp" },
      ],
      next: "crew",
    },
    {
      id: "crew",
      journal: "The surveyor, Imre Sato, is on the south lawn with his tablet, wondering where his stakes went. His readings decide whether the park goes to tender. Change his mind, buy his tablet, or run him off.",
      onEnter: [{ waypoint: { ...ROOTWOOD_SPOTS.surveyor, label: "Imre Sato (south lawn)" } }],
      objectives: [{ id: "lead", kind: "choose", text: "Deal with Imre Sato on the south lawn", dialogue: "rw.surveyor", options: ["logged", "bought", "fight"], target: ROOTWOOD_SPOTS.surveyor }],
      next: [{ if: flagIs("survey-stakes.lead", "fight"), stage: "detail" }, { stage: "report" }],
    },
    {
      id: "detail",
      journal: "Sato called his security detail off the path. Two troopers and a drone handler are coming across the south lawn.",
      objectives: [{ id: "detail-clear", kind: "clear", encounter: "rw-survey-detail", text: "Drive the survey detail out of the park" }],
      next: "report",
    },
    {
      id: "report",
      journal: "The stakes are out and the survey is dead for now. Tell Billie at the fountain court.",
      objectives: [{ id: "told", kind: "choose", text: "Tell Billie at the fountain court how it went", dialogue: "rw.billie-survey", options: ["report-quiet", "report-fight"] }],
      next: [{ if: flagIs("survey-stakes.lead", "fight"), stage: "end-routed" }, { stage: "end-scrubbed" }],
    },
    ending("end-scrubbed", "The survey says the park is unbuildable.", "scrubbed"),
    ending("end-routed", "The survey crew left the park running.", "routed"),
  ],
  outcomes: {
    scrubbed: {
      title: "Unsuitable Ground", journal: "Meridian's file on Rootwood now says 'waterlogged, unstable, unsuitable'. Nobody at Meridian will read it twice. That was the point.",
      effects: [{ credits: 260 }, { xp: 420 }, { rep: "civilian", by: 6 }, { rep: "corpsec", by: -2 }, { setFlag: "rootwood.survey", value: "scrubbed" }],
    },
    routed: {
      title: "Run Off the Lawn", journal: "The survey detail left Rootwood at a run. Meridian will be back with more people, but not this tender, and not this year.",
      effects: [{ credits: 300 }, { xp: 420 }, { rep: "civilian", by: 4 }, { rep: "corpsec", by: -10 }, { setFlag: "rootwood.survey", value: "routed" }],
    },
  },
};

const job = (quest: string, label: string, dialogue: string): DialogueOptionDef =>
  ({ id: `ask-${quest}`, label, condition: available(quest), hideIfUnavailable: true, kind: "continue", effects: [{ openDialogue: dialogue, node: "offer" }], next: null });

const DIALOGUES: readonly DialogueDefinition[] = [
  {
    id: "hub.billie", npc: BILLIE.id,
    entries: [
      { condition: flagIs("rootwood.survey", "scrubbed"), node: "after-scrubbed", priority: 4 },
      { condition: flagIs("rootwood.survey", "routed"), node: "after-routed", priority: 4 },
      { condition: flagIs("rootwood.lookout", "held"), node: "after-held", priority: 3 },
      { condition: flagIs("rootwood.lookout", "spared"), node: "after-spared", priority: 3 },
      { node: "hub" },
    ],
    nodes: [
      node("hub", BILLIE.greeting, [job(LANTERNS, "Need a hand?", "rw.billie-lanterns"), job(SURVEY, "What's wrong now?", "rw.billie-survey"), LEAVE]),
      node("after-held", ["Pip is up a ladder on the east path, polishing lantern glass. He complains the whole time. He hasn't missed a day.", "Mind the moss."], [job(SURVEY, "What's wrong now?", "rw.billie-survey"), LEAVE]),
      node("after-spared", ["Lantern Walk is lit. I've had no more Razorbacks in it, which is either your doing or luck.", "Mind the moss."], [job(SURVEY, "What's wrong now?", "rw.billie-survey"), LEAVE]),
      node("after-scrubbed", ["Meridian sent a letter regretting that the ground is unsuitable. I had it framed.", "Mind the moss. It's what saved us."], [LEAVE]),
      node("after-routed", ["There's a CorpSec drone stuck in the oak by the pond. It's been there three days. The rooks have adopted it.", "Mind the moss."], [LEAVE]),
    ],
  },
  {
    id: "rw.billie-lanterns", npc: BILLIE.id, quest: LANTERNS,
    entries: [{ condition: { quest: LANTERNS, status: "active" }, node: "working", priority: 18 }],
    nodes: [
      node("offer", [
        "Somebody is pulling the copper coils out of my lanterns. Six gone this week, all on Lantern Walk, the path from here north-west to the corner gate.",
        "A dark path in a park at night is how people get hurt. Find who's doing it, stop them, and bring the coils back to me. I'll do the ladder. The park fund pays, mostly in fountain coins.",
      ], [
        { id: "accept-lanterns", label: "I'll walk the path.", condition: available(LANTERNS), effects: [{ startQuest: LANTERNS }], next: "accepted" },
        bye("Not tonight.", "decline"),
      ]),
      node("accepted", ["North-west from the fountain, follow the lanterns that still work.", "When you reach the ones that don't, you've found them."], [LEAVE]),
      node("working", ["Six coils. Lantern Walk. I'm not going anywhere; I'm the keeper."], [LEAVE]),
    ],
  },
  {
    id: "rw.lookout", npc: "rw-lookout", quest: LANTERNS,
    entries: [{ condition: inStage(LANTERNS, "cart"), node: "boy" }],
    nodes: [
      node("boy", [
        "[A boy of about twelve in a Razorback jacket three sizes too big. He is holding a pair of pliers like a knife.]",
        "I just watch for the keeper! I don't even touch the lanterns! They pay me in noodles!",
      ], [
        { id: "let-go", label: "Drop the pliers and go home. Don't come back with tools.", condition: inStage(LANTERNS, "cart"), kind: "complete", next: "gone" },
        { id: "hold", label: "You're coming with me. You can explain it to the keeper.", condition: inStage(LANTERNS, "cart"), kind: "complete", next: "held" },
        bye("Stay there."),
      ]),
      node("gone", ["[The pliers hit the gravel. He's gone between the trees before they stop bouncing.]", "[A voice from the dark:] My name's Pip! I owe you one! Probably!"], [LEAVE]),
      node("held", ["Aw, not the keeper. She talks about MOSS.", "[He follows you, dragging his feet as loudly as possible.]"], [LEAVE]),
    ],
  },
  {
    id: "rw.billie-survey", npc: BILLIE.id, quest: SURVEY,
    entries: [
      { condition: inStage(SURVEY, "report"), node: "report", priority: 22 },
      { condition: { quest: SURVEY, status: "active" }, node: "working", priority: 18 },
    ],
    nodes: [
      node("offer", [
        "Someone has been driving orange-tipped stakes into my park at night. Meridian Land. Lot 7.",
        "Three of them: on the Pond steps, by the Koi Gate, under the Moth Lamp. That's a development survey. If it says the ground is good, Rootwood goes to tender and the trees go to chips.",
        "Pull the stakes. Then find the surveyor and make sure his tablet says something useless. The park fund will cover it, same coins as last time.",
      ], [
        { id: "accept-survey", label: "I'll pull them.", condition: available(SURVEY), effects: [{ startQuest: SURVEY }], next: "accepted" },
        bye("Later.", "decline"),
      ]),
      node("accepted", ["The Pond steps are east of here, past the bridge. The Koi Gate is up by the station. The Moth Lamp is down on the south lawn."], [
        go("who-held", "How did you find the stakes?", "found-held", { condition: flagIs("rootwood.lookout", "held"), hideIfUnavailable: true }),
        go("who-spared", "How did you find the stakes?", "found-spared", { condition: flagIs("rootwood.lookout", "spared"), hideIfUnavailable: true }),
        LEAVE,
      ]),
      node("found-held", ["Pip found them on his ladder round. He's been very proud about it. Loudly.", "He also says the south lawn floods every spring. He's right. Remember that when you meet the surveyor."], [LEAVE]),
      node("found-spared", ["A note on my bench this morning, in pencil: MEN IN ORANGE PUT STIKS IN THE GRASS AT NITE. P.", "Your lookout boy. Spelling's terrible. Eyes are good."], [LEAVE]),
      node("working", ["Stakes out, then the surveyor. He'll be the one in the orange vest looking confused."], [LEAVE]),
      node("report", ["Well? Is my park still a park?"], [
        { id: "report-quiet", label: "His survey says the ground is unsuitable. (+260 cr)", condition: { all: [inStage(SURVEY, "report"), { not: flagIs("survey-stakes.lead", "fight") }] }, hideIfUnavailable: true, kind: "complete", next: "quiet" },
        { id: "report-fight", label: "His detail left at a run. So did he. (+300 cr)", condition: { all: [inStage(SURVEY, "report"), flagIs("survey-stakes.lead", "fight")] }, hideIfUnavailable: true, kind: "complete", next: "loud" },
        LEAVE,
      ]),
      node("quiet", ["Unsuitable. Ha! I've been calling this ground unsuitable for building for twenty years.", "Two-sixty from the park fund. The fund is mostly coins from the fountain. Don't tell the wishers."], [LEAVE]),
      node("loud", ["I heard it from the fountain. So did the rooks.", "Three hundred. They'll be back one day, with more people. But not this year."], [LEAVE]),
    ],
  },
  {
    id: "rw.surveyor", npc: "rw-surveyor", quest: SURVEY,
    entries: [{ condition: inStage(SURVEY, "crew"), node: "ask" }],
    nodes: [
      node("ask", [
        "[A man in an orange Meridian Land vest, holding a tablet to the sky for signal.]",
        "Have you seen three survey stakes? About so high, orange tips. I put them in on Tuesday and now they're... you have them under your arm.",
        "Look, I measure things. I don't decide what they become. If the readings say firm ground, the park goes to tender. That's not personal.",
      ], [
        go("argue", "The pond floods this whole lawn every spring. Log it as unsuitable. [TECH 3]", "ask", {
          check: { stat: "tech", difficulty: 3, success: "convinced", failure: "unconvinced", bonus: [{ if: flagIs("rootwood.lookout", "held"), by: 1, label: "Pip mapped the wet ground" }] },
        }),
        { id: "bought", label: "Two hundred credits for that tablet, and you lost it in the pond. (-200 cr)", condition: { credits: 200 }, effects: [{ credits: -200 }], kind: "complete", next: "sold" },
        { id: "fight", label: "Get out of the park. Now.", effects: [{ spawn: "rw-survey-detail" }], kind: "complete", next: "called" },
        bye("I'll think about it."),
      ]),
      node("convinced", ["[He looks at the lawn. He looks at the pond, which is higher than the lawn.]", "...Huh. That would explain the wet socks. All right. 'Waterlogged, unstable, unsuitable.' Nobody upstairs reads past the first word anyway."], [
        { id: "logged", label: "Good man.", condition: inStage(SURVEY, "crew"), kind: "complete", next: null },
      ]),
      node("unconvinced", ["My readings say firm. Your feelings say soft. My readings get paid.", "If you want to make a better argument, make it in credits."], [go("back", "Fine. Let's talk money.", "ask")]),
      node("sold", ["[He looks at the credits, then at the pond. He throws the tablet in. It sinks with a sad little chime.]", "Oops. I'll tell them the park ate it. It's that kind of park."], [LEAVE]),
      node("called", ["[He taps his collar.] Detail to the south lawn, please. We have a situation with a member of the public.", "[He walks very quickly away from you.]"], [LEAVE]),
    ],
  },
];

export const ROOTWOOD_PACK: ContentPack = {
  id: "rootwood",
  npcs: [BILLIE],
  items: ITEMS,
  encounters: ENCOUNTERS,
  interactables: INTERACTABLES,
  quests: [lanternWalk, surveyStakes],
  dialogues: DIALOGUES,
};
