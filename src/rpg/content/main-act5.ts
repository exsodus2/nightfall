// Main questline, Act 5: "The Rain That Remembers" (Rain Gardens -> Meridian Spire -> Silk Market).
// Dr. Odessa Crane, Meridian Climate's director, sends up a lantern at the Last Tree every night for
// her daughter Iris, lost in the Flood her own array caused. She built the archive so the missing
// would be carried by everyone, in the rain; Meridian paid for it because the same signal jams the
// pirate stations. She asks the player to decide its fate at the climate annex under the Spire:
//   release  - every sign and radio speaks with the missing, clearly, for as long as it rains
//   burn     - the archive is purged; the rain is only rain
//   return   - (earned: Bet's Lot Index and the Nami Maru lots unburned) the archive goes to Dead
//              Letter Exchange, one letter per family
// The epilogue hands Lot 77 to Nell and closes the docket with Tilly. rain.ending is the city's state.
// This file also carries every post-game line of the questline's cast.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { Condition, ContentPack, DialogueDefinition, DialogueOptionDef, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { LEAVE, active, bye, ending, flagIs, go, inStage, look, node } from "./helpers.ts";
import { FLAG, ITEM, RAIN, SKIN, SPOTS, endedWith } from "./main-common.ts";

const Q9 = RAIN.lanterns, Q10 = RAIN.finale, Q11 = RAIN.delivery;
type Ending = "released" | "burned" | "returned";
const ENDINGS: readonly Ending[] = ["released", "burned", "returned"];

// ---- People ------------------------------------------------------------------------------------

export const CRANE: NpcDefinition = {
  id: "odessa-crane", name: "Dr. Odessa Crane", title: "Meridian Climate director", district: 3, ...SPOTS.crane, facing: -2.55,
  look: look([150, 156, 170], [50, 54, 64], SKIN.pale, [200, 230, 255], "bare", "lantern", "breathe"),
  greeting: ["I come for the lanterns. One a night.", "Don't let me keep you. Everyone in this city is going somewhere in the rain."],
};

// ---- Objects -----------------------------------------------------------------------------------

const interactables: InteractableDefinition[] = [
  {
    id: "rain-annex", label: "Dr. Crane at the climate annex lectern", ...SPOTS.annex, y: 1.4, glyph: "@",
    condition: inStage(Q10, "annex"), dialogue: "rain.annex",
  },
];

// ---- Quests ------------------------------------------------------------------------------------

const lanterns: QuestDefinition2 = {
  id: Q9, title: "Lanterns for Iris", category: "story", giver: null,
  summary: "Dr. Odessa Crane, the archive's keeper, sends up a lantern at the Last Tree in the Rain Gardens every night. Go and talk to her.",
  requires: { quest: RAIN.trunk }, rewardHint: "600 XP", recommendedLevel: 7, start: "tree",
  stages: [
    {
      id: "tree", journal: "Bet says Dr. Odessa Crane, the archive's keeper, sends up a lantern at the Last Tree in the Rain Gardens every night. Find her by the Tree and talk to her. (Metro: Rain Gardens station.)",
      onEnter: [{ waypoint: { ...SPOTS.crane, label: "Dr. Odessa Crane" } }],
      objectives: [{ id: "crane", kind: "choose", text: "Talk to Dr. Odessa Crane by the Last Tree, Rain Gardens", dialogue: "rain.crane", options: ["listen", "accuse"] }],
    },
  ],
  outcomes: {
    met: {
      title: "Lanterns for Iris",
      journal: "Dr. Odessa Crane makes the weather, and the weather took her daughter. She asked you to meet her at the climate annex lectern at the foot of the Meridian Spire and decide what happens to the archive.",
      effects: [{ xp: 600 }, { startQuest: Q10 }],
    },
  },
};

const finale: QuestDefinition2 = {
  id: Q10, title: "The Rain That Remembers", category: "story", giver: null,
  summary: "At the climate annex under the Meridian Spire, decide what happens to the archive of the missing: release it, burn it, or, if you have earned it, send it home.",
  requires: { quest: Q9 }, rewardHint: "1500 cr, 4000 XP; the city's state depends on your choice", recommendedLevel: 8, start: "annex",
  stages: [
    {
      id: "annex", journal: "Dr. Crane is waiting at the climate annex lectern at the foot of the Meridian Spire in Neon Ward. Decide the archive's fate: release it into the rain, burn it, or (with Bet's Lot Index, and the Nami Maru lots unburned) send every lot home through Dead Letter Exchange.",
      onEnter: [{ waypoint: { ...SPOTS.annex, label: "Climate annex lectern" } }],
      objectives: [
        { id: "verdict", kind: "choose", text: "Decide the archive's fate with Dr. Crane at the climate annex, foot of the Meridian Spire", dialogue: "rain.annex", options: ["release", "burn", "return"] },
        { id: "juno", kind: "choose", text: "Optional: ask Juno Reyes, under the Spire, what the array is doing tonight", dialogue: "rain.juno", options: ["ask-juno"], optional: true },
      ],
      next: [
        { if: { flag: `${Q10}.verdict`, is: "release" }, stage: "end-released" },
        { if: { flag: `${Q10}.verdict`, is: "return" }, stage: "end-returned" },
        { stage: "end-burned" },
      ],
    },
    ending("end-released", "You released the archive.", "released"),
    ending("end-burned", "You burned the archive.", "burned"),
    ending("end-returned", "You sent them home.", "returned"),
  ],
  outcomes: {
    released: {
      title: "The City Remembers",
      journal: "You released the archive. Every sign and radio in Nightfall speaks with the voices of the missing for as long as it rains, which is always. Lot 77 is still in your pocket: Nell Ashby should have it.",
      effects: [{ setFlag: FLAG.ending, value: "released" }, { credits: 1500 }, { xp: 4000 }, { rep: "civilian", by: 15 }, { rep: "ghosts", by: 10 }, { rep: "corpsec", by: -20 }, { startQuest: Q11 }],
    },
    burned: {
      title: "Only Rain",
      journal: "You burned the archive. The static is gone from every sign, and the rain is only rain. Lot 77 is still in your pocket, the last copy of Jonah Ashby: Nell should have it.",
      effects: [{ setFlag: FLAG.ending, value: "burned" }, { credits: 1500 }, { xp: 4000 }, { rep: "corpsec", by: 10 }, { rep: "civilian", by: 5 }, { startQuest: Q11 }],
    },
    returned: {
      title: "Every Letter Home",
      journal: "You sent them home. Dead Letter Exchange is posting three hundred and twelve letters, one per family, and the rain is only rain again. Lot 77 is still in your pocket: Nell Ashby should have it in person.",
      effects: [{ setFlag: FLAG.ending, value: "returned" }, { credits: 1500 }, { xp: 4000 }, { rep: "civilian", by: 20 }, { rep: "ghosts", by: 5 }, { startQuest: Q11 }],
    },
  },
};

const delivery: QuestDefinition2 = {
  id: Q11, title: "Last Delivery", category: "story", giver: null,
  summary: "Lot 77 is still in your pocket. Deliver it by hand to Nell Ashby across the street from 9 Lantern Row, then close the docket with Tilly Marsh.",
  requires: { quest: Q10 }, rewardHint: "200 cr, 500 XP", recommendedLevel: 8, start: "nell",
  stages: [
    {
      id: "nell", journal: "Lot 77 is still in your pocket. Deliver it by hand to Nell Ashby, on her chair across the street from 9 Lantern Row in the Silk Market.",
      onEnter: [{ waypoint: { ...SPOTS.nell, label: "Nell Ashby" } }],
      objectives: [{ id: "drive", kind: "choose", text: "Give Lot 77 to Nell Ashby, across the street from 9 Lantern Row", dialogue: "rain.nell-last", options: ["hand-drive", "hand-both"] }],
      next: "tilly",
    },
    {
      id: "tilly", journal: "Nell has her son's drive. Close Lot 77's docket with Tilly Marsh at the Dead Letter drop on the Silk Market avenue.",
      onEnter: [{ waypoint: { ...SPOTS.tilly, label: "Tilly Marsh" } }],
      objectives: [{ id: "docket", kind: "choose", text: "Close the docket with Tilly Marsh on the Silk Market avenue", dialogue: "rain.tilly-last", options: ["close"] }],
      next: [{ if: endedWith("released"), stage: "end-released" }, { if: endedWith("returned"), stage: "end-returned" }, { stage: "end-burned" }],
    },
    ending("end-released", "Lot 77 delivered.", "released"),
    ending("end-burned", "Lot 77 delivered.", "burned"),
    ending("end-returned", "Lot 77 delivered.", "returned"),
  ],
  outcomes: {
    released: {
      title: "Loud, and Ours",
      journal: "Tilly stamped Lot 77 DELIVERED and pinned it to the top of her board. Across the city every sign is talking. It is still raining in Nightfall; now everyone knows what it says.",
      effects: [{ credits: 200 }, { xp: 500 }],
    },
    burned: {
      title: "Light's On",
      journal: "Tilly stamped Lot 77 DELIVERED and pinned it to the top of her board. The signs only hiss now when they're broken. It is still raining in Nightfall, and the rain doesn't say anything at all.",
      effects: [{ credits: 200 }, { xp: 500 }],
    },
    returned: {
      title: "Signed For",
      journal: "Tilly stamped Lot 77 DELIVERED and pinned it to the top of her board. Tomorrow the queue at Dead Letter Exchange will be round the block, in the rain. It is still raining in Nightfall. It always will be.",
      effects: [{ credits: 200 }, { xp: 500 }],
    },
  },
};

// ---- Dialogue ----------------------------------------------------------------------------------

/** Post-game entries, one node per ending: `after-released`, `after-burned`, `after-returned`. */
function afterEntries(priority: number, extra?: Condition): DialogueDefinition["entries"] {
  return ENDINGS.map(e => ({ condition: extra ? { all: [endedWith(e), extra] } : endedWith(e), node: `after-${e}`, priority }));
}
function afterNodes(lines: Readonly<Record<Ending, readonly string[]>>, options: readonly DialogueOptionDef[] = [LEAVE]) {
  return ENDINGS.map(e => node(`after-${e}`, lines[e], options));
}
/** Opens a cast hub (cast.ts) so post-game lines don't hide the character's usual business. */
const hubOption = (npc: string): DialogueOptionDef => ({ id: "more", label: "Anything else?", kind: "continue", effects: [{ openDialogue: `hub.${npc}`, node: "hub" }], next: null });

const LISTEN = "listen", ACCUSE = "accuse";
const craneChoices: readonly DialogueOptionDef[] = [
  { id: LISTEN, label: "Light a lantern with her for Iris.", condition: inStage(Q9, "tree"), effects: [{ setFlag: FLAG.lantern }], next: "lantern" },
  { id: ACCUSE, label: "Meridian wanted a jammer. You built it out of the dead.", condition: inStage(Q9, "tree"), next: "accused" },
];

const dialogues: DialogueDefinition[] = [
  {
    id: "rain.crane", npc: CRANE.id,
    entries: [
      { condition: inStage(Q9, "tree"), node: "meet", priority: 30 },
      { condition: active(Q10), node: "go-spire", priority: 20 },
      ...afterEntries(6),
    ],
    nodes: [
      node("meet", [
        "You must be the courier. Bet called. Bet always calls.",
        "I'm Odessa Crane. I make the weather. My array caused the Flood, and the Flood took my daughter, Iris. There. Now you don't have to work it out.",
      ], [go("why", "Why put them in the rain?", "why")]),
      node("why", [
        "Because nobody kept them. Three hundred and twelve people, and the city kept a plaque.",
        "Their phones went into the harbour; their last calls sat on a dead server. I bought it all back, lot by lot, and put them where everyone would carry them: in the rain.",
        "It isn't consent. I know. Neither was the Flood.",
      ], [{ id: "lot77", label: "Show her Lot 77.", condition: { item: ITEM.drive }, hideIfUnavailable: true, kind: "continue", next: "jonah" }, ...craneChoices]),
      node("jonah", [
        "Lot seventy-seven. Jonah Ashby, crane four. Twelve minutes past one in the morning.",
        "He says: 'Ma, I'm on the high gantry, don't wait up. I'll bring breakfast.' Then the wind.",
        "That drive is a master copy. It only plays at the Spire.",
      ], craneChoices),
      node("lantern", [
        "[She hands you a paper lantern from the maker by the Tree. You light it together. It climbs into the rain and doesn't go out, which should be impossible.]",
        "Come to the Spire: the climate annex lectern, at its foot in Neon Ward. See the archive before you decide what to do with it.",
        "I won't stop you. I'm too tired, and you've earned the right.",
      ], [LEAVE]),
      node("accused", [
        "Yes. Meridian wanted a jammer to bury the pirate stations. I gave them one and hid the dead inside it. Everybody got what they paid for.",
        "Come to the Spire: the climate annex lectern, at its foot in Neon Ward. Decide there. I won't stop you.",
      ], [LEAVE]),
      node("go-spire", ["Go on. I'll be at the annex lectern before you; Meridian has a car for everything."], [LEAVE]),
      ...afterNodes({
        released: ["I hear her every night now, from the bus shelter on the corner. She's telling a friend a joke she never finished.", "It's loud. I thought it would be unbearable. It's only unbearable some of the time."],
        burned: ["The lanterns go up quieter now.", "I'm still the director of Meridian Climate. I make the weather. It's only weather now."],
        returned: ["Dead Letter sent me a ticket this morning. LOT 1: CRANE, IRIS. I haven't collected it.", "I will. Tonight, maybe. After the lantern."],
      }),
    ],
  },
  {
    // The finale: Dr. Crane at the annex lectern (spoken by the interactable).
    id: "rain.annex", npc: "rain-annex",
    entries: [{ node: "lectern" }],
    nodes: [
      node("lectern", [
        "[A brushed-steel lectern under the Meridian Spire, its screen a slow fall of names. Dr. Crane stands beside it in a wet coat.]",
        "This is the archive: three hundred and twelve lots, and every call nobody answered.",
        "Open it, and every sign and radio in Nightfall speaks with their voices, clearly, for as long as it rains. Burn it, and the rain is only rain. Or tell me there's a third way. I've looked for six years.",
      ], [
        { id: "release", label: "Release the archive. Let the city remember. (+Civilians, +Ghosts, -20 CorpSec)", condition: inStage(Q10, "annex"), next: "released" },
        { id: "burn", label: "Burn the archive. Let them rest, and let the city sleep. (+10 CorpSec, +5 Civilians)", condition: inStage(Q10, "annex"), next: "burned" },
        {
          id: "return", label: "Send them home: route every lot to Dead Letter Exchange, one letter per family. (+20 Civilians, +5 Ghosts)",
          condition: { all: [inStage(Q10, "annex"), { item: ITEM.index }, flagIs(FLAG.shipment, "through")] },
          reason: "Needs Bet's Lot Index, and the Nami Maru lots unburned",
          next: "returned",
        },
        bye("Not yet."),
      ]),
      node("released", [
        "[Crane keys the release. The names stop falling and start speaking.]",
        "[Across Nightfall every sign, every radio and every ad screen clears its throat. Then the voices come through: a crane hand, a nurse, a boy counting to ten, a mother saying she's left the light on. Somewhere on a pirate band, Moth starts reading the names between them.]",
        "Crane, very quietly: 'Iris. There you are.'",
      ], [LEAVE]),
      node("burned", [
        "[Crane's hand hovers over the key. Then she presses it herself. 'If it has to be done, I'll be the one who did it.']",
        "[The names on the screen go out one row at a time. The hiss in every sign in the city thins to nothing.]",
        "[For the first time in six years the rain is only rain. It is very quiet.]",
      ], [LEAVE]),
      node("returned", [
        "[You set Bet's Lot Index on the lectern. Crane reads the first page and makes a sound that might be a laugh.]",
        "'Addresses. You brought them addresses.' She routes the archive to Dead Letter Exchange: three hundred and twelve lots, three hundred and twelve letters.",
        "[The hiss in the signs fades. Tomorrow there will be a queue at the Exchange in the rain, and everyone in it will be holding a ticket with a name on it.]",
      ], [LEAVE]),
    ],
  },
  {
    // Juno Reyes (src/city/npcs.ts) under the Spire: an optional word before the finale, then post-game.
    id: "rain.juno", npc: "juno",
    entries: [
      { condition: { all: [inStage(Q10, "annex"), { not: { flag: `${Q10}.juno` } }] }, node: "array", priority: 25 },
      ...afterEntries(14),
    ],
    nodes: [
      node("array", [
        "The array's pushing three times its usual signal tonight. Every dead feed on this block is breathing.",
        "Whoever's at that annex lectern is about to say something to the whole city. Make it worth hearing.",
      ], [{ id: "ask-juno", label: "I'll try.", kind: "continue", next: null }]),
      ...afterNodes({
        released: ["Every dead feed on this block came back at once. I've stopped logging them.", "I've started listening."],
        burned: ["The feeds went flat. Clean signal, all night.", "I miss the noise, and I hate that I miss it."],
        returned: ["Half the signs on this block run Dead Letter's delivery list now. Lot numbers and names, scrolling all night.", "Best thing Meridian ever broadcast, and they didn't write a word of it."],
      }, [hubOption("juno"), LEAVE]),
    ],
  },
  {
    id: "rain.nell-last", npc: "nell-ashby",
    entries: [
      ...ENDINGS.map(e => ({ condition: { all: [inStage(Q11, "nell"), endedWith(e)] }, node: `deliver-${e}`, priority: 30 })),
      { condition: active(Q11), node: "q11-tilly", priority: 20 },
      ...afterEntries(8, { quest: Q11 }),
    ],
    nodes: [
      ...ENDINGS.map(e => node(`deliver-${e}`, {
        released: [
          "I heard him. At the bus stop, out of the timetable screen: 'Ma, I'm on the high gantry, don't wait up.'",
          "Half the street was crying. The other half were laughing at a cab driver who swears. It was loud. It was ours.",
          "Give it here, then.",
        ],
        burned: [
          "The signs went quiet last night. My voice isn't up there any more, is it. Nor his.",
          "Don't be sorry. Six years I asked the rain to stop talking. I just didn't think I'd miss it.",
          "Give it here. A label with his name on is still a label with his name on.",
        ],
        returned: [
          "A letter came this morning from Dead Letter Exchange. LOT 77, ASHBY, JONAH. It said the master copy was with the courier.",
          "So it's you. You're the courier. Took your time.",
        ],
      }[e], [
        { id: "hand-drive", label: "Give Nell the drive.", condition: inStage(Q11, "nell"), effects: [{ take: ITEM.drive }], next: "window" },
        { id: "hand-both", label: "Give Nell the drive, and Jonah's key back.", condition: { all: [inStage(Q11, "nell"), { item: ITEM.key }] }, hideIfUnavailable: true, effects: [{ take: ITEM.drive }, { take: ITEM.key }], next: "window-key" },
        bye("In a moment."),
      ])),
      node("window", [
        "[She crosses the street and sets the drive on the sill of 9 Lantern Row, behind the boards, where a window used to be. She clicks on a little battery lamp beside it.]",
        "There. Light's on.",
      ], [LEAVE]),
      node("window-key", [
        "[She weighs the key in her palm, then crosses the street and hangs it on a nail by the boarded door of 9 Lantern Row. The drive goes on the sill beside it, with a little battery lamp.]",
        "There. Light's on. Door's locked. He knows where the key is.",
      ], [LEAVE]),
      node("q11-tilly", ["Go on, tell your office it's signed for. I'm not going anywhere."], [LEAVE]),
      ...afterNodes({
        released: ["[Nell is on her chair, head tilted toward the bus shelter's screen.]", "He's on at about one most nights. I don't need the tape any more."],
        burned: ["[The little lamp is still on in the window of 9 Lantern Row.]", "I'm moving the chair indoors next week. The council's very pleased. I'm not."],
        returned: ["[Nell wears the drive on a string around her neck.]", "The Exchange played it for me in a booth, with tea. Twelve seconds. I've got it by heart. Don't ask me to say it."],
      }),
    ],
  },
  {
    id: "rain.tilly-last", npc: "tilly-marsh",
    entries: [
      { condition: inStage(Q11, "tilly"), node: "docket", priority: 30 },
      { condition: active(Q11), node: "q11-nell", priority: 20 },
      ...afterEntries(8, { quest: Q11 }),
    ],
    nodes: [
      node("docket", [
        "Lot 77. Signed for?",
        "...Signed for. Six years late and by the wrong hand, but signed for.",
        "Courier fee, as promised: two hundred. Plus interest. I'm counting the interest as interest.",
      ], [{ id: "close", label: "Close the docket. (+200 cr)", condition: inStage(Q11, "tilly"), kind: "complete", next: "closed" }, LEAVE]),
      node("closed", [
        "[Tilly stamps the docket DELIVERED and pins it to the top of her board, where it'll get rained on.]",
        "There. Some letters you deliver. Some you just carry until you can.",
      ], [LEAVE]),
      node("q11-nell", ["Lot 77 goes to Nell Ashby by hand. Then you come back and I close the docket. Docket rules."], [LEAVE]),
      ...afterNodes({
        released: ["Every parcel scanner in the drop hums along with the signs now. I've stopped minding.", "Lot 77's docket stays pinned to the top of my board."],
        burned: ["Quiet in the drop since the signs stopped talking.", "Lot 77's docket stays pinned to the top of my board."],
        returned: ["The Exchange has me on double shifts: three hundred and twelve letters, every one signed for in person. I've never been so tired or so happy.", "Lot 77's docket stays pinned to the top of my board."],
      }),
    ],
  },
  // ---- Post-game lines for the rest of the questline's cast -------------------------------------
  {
    id: "rain.moth-after", npc: "moth-nobody", entries: afterEntries(6),
    nodes: afterNodes({
      released: ["Station Nobody doesn't need to play the static any more. The static plays itself.", "I read the names out between the voices. Somebody has to."],
      burned: ["The rain's clean. My tapes are the only record left of what it used to say.", "I'm not going to play them. I'm just going to keep them. That's different. I think."],
      returned: ["Dead Letter asked me to read the delivery list on air, one name a night.", "We're on number forty. Copy."],
    }),
  },
  {
    id: "rain.ruben-after", npc: "ruben-salgado", entries: afterEntries(6),
    nodes: afterNodes({
      released: ["The cranes have voices now. Crane four says 'don't wait up' at about one in the morning.", "The crew stop work and let it."],
      burned: ["The Nami Maru came in last night with no climate crates.", "First time in six years I signed for nothing. Felt like the lightest thing I ever lifted."],
      returned: ["Dead Letter sent a van for the last of the lots, with a clerk who said 'please'.", "Nell came down to the quay yesterday. First time in six years. We had a coffee. Don't make it a thing."],
    }),
  },
  {
    id: "rain.morrow-after", npc: "dace-morrow", entries: afterEntries(6),
    nodes: afterNodes({
      released: ["The forecourt speakers keep reading names.", "I've stopped writing them down. Somebody else is listening now."],
      burned: ["They closed the bonded shed and gave me a desk. A dry desk.", "I'm going to retire at it."],
      returned: ["Dead Letter vans through my checkpoint all night. I wave them on.", "Best paperwork I've ever signed."],
    }),
  },
  {
    id: "rain.bet-after", npc: "bet-kowalczyk", entries: afterEntries(6),
    nodes: afterNodes({
      released: ["Every antenna in the Foundry is talking.", "I keep a radio on in the workshop anyway. Seems rude not to."],
      burned: ["Crane told me to strip the Loom for parts. I've stripped the parts.", "I can't bring myself to take the frame down."],
      returned: ["The Loom prints delivery labels for the Exchange now. Three hundred and twelve of them.", "Best thing I ever built did one useful thing at the end. That's more than most."],
    }),
  },
  {
    id: "rain.tomas-after", npc: "tomas", entries: afterEntries(3),
    nodes: afterNodes({
      released: ["The Core's running warm. All those voices cost power, and nobody's minding the bill.", "I hear the Flood night shift on the substation speaker. Good lads. Terrible singers."],
      burned: ["The CLIMATE trunk's cold. The Core breathes easier without it.", "It's only weather now. I'll take it."],
      returned: ["The trunk's on half load. Crane sent me a letter, an actual paper letter, saying sorry.", "I've put it under the gauge."],
    }, [hubOption("tomas"), LEAVE]),
  },
];

/** Act 5: the keeper, the finale, the last delivery and the post-game lines. */
export const MAIN_ACT5_PACK: ContentPack = {
  id: "main-act5",
  npcs: [CRANE],
  interactables,
  quests: [lanterns, finale, delivery],
  dialogues,
};
