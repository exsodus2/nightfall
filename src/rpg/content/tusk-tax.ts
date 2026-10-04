// Pack "tusk-tax": the negotiation. Gristle, a Razorback lieutenant, is "taxing" the Afterlight
// Arcade thirty percent. Mama Kestrel wants it stopped. Three rounds of talk, each with a choice of
// approach (cool, street, tech - or money); win all three and he folds, win two and you cut a
// deal, win fewer and his crew settles it the old way. Rounds are remembered with one flag each, so
// walking away mid-talk can't be used to re-roll a round: Gristle just skips to his decision.

import type { Condition, ContentPack, DialogueDefinition, DialogueOptionDef, EncounterDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, bye, ending, flagIs, go, inStage, member, node } from "./helpers.ts";

const Q = "tusk-tax";
const won = (round: number): Condition => ({ flag: `tt.r${round}` });
const lost = (round: number): Condition => ({ not: won(round) });
const ALL_THREE: Condition = { all: [won(1), won(2), won(3)] };
const EXACTLY_TWO: Condition = { any: [{ all: [won(1), won(2), lost(3)] }, { all: [won(1), lost(2), won(3)] }, { all: [lost(1), won(2), won(3)] }] };

const encounters: EncounterDefinition[] = [{
  id: "tt-crew", label: "Gristle's crew", area: area(391, 185, 14), hostile: false,
  members: [member("rb-brute", 398, 178, FACE.west), member("rb-thug", 384.8, 178, FACE.south), member("rb-thug", 398, 191.2, FACE.west), member("rb-gunner", 404, 184.8, FACE.west)],
}];

const quest: QuestDefinition2 = {
  id: Q, title: "Tusk Tax", category: "side", giver: "kestrel",
  summary: "Gristle's Razorbacks take thirty percent of the Afterlight Arcade. Talk him out of it. Or don't talk.",
  rewardHint: "300-500 cr, a monofilament whip if he folds", recommendedLevel: 4, start: "talk",
  stages: [
    {
      id: "talk", journal: "Gristle holds the corner west of the Arcade with four of his crew. He likes to talk. Mostly about money.",
      onEnter: [{ spawn: "tt-crew" }, { waypoint: { x: 391.2, z: 184.8, label: "Gristle" } }],
      objectives: [{ id: "talk", kind: "condition", text: "Negotiate with Gristle", condition: { flag: "tt.verdict" }, target: { x: 391.2, z: 184.8 } }],
      next: [{ if: flagIs("tt.verdict", "fight"), stage: "brawl" }, { stage: "report" }],
    },
    {
      id: "brawl", journal: "Talks failed. Gristle ducked behind his crew. Put them down.",
      objectives: [{ id: "clear", kind: "clear", text: "Put down Gristle's crew", encounter: "tt-crew" }],
      next: "report",
    },
    {
      id: "report", journal: "Tell Mama Kestrel how it went.",
      objectives: [{ id: "report", kind: "choose", text: "Report to Mama Kestrel", dialogue: "tt.kestrel", options: ["report"] }],
      next: [{ if: flagIs("tt.verdict", "folded"), stage: "end-folded" }, { if: flagIs("tt.verdict", "deal"), stage: "end-deal" }, { stage: "end-forced" }],
    },
    ending("end-folded", "Gristle folded.", "folded"),
    ending("end-deal", "A deal was struck.", "deal"),
    ending("end-forced", "The crew was broken.", "forced"),
  ],
  outcomes: {
    folded: {
      title: "Tax Exempt", journal: "Gristle dropped the tax and now crosses the street to avoid the Arcade. Kestrel gave you her late husband's whip. 'He'd have liked you. He liked anybody who scared Razorbacks.'",
      effects: [{ credits: 500 }, { xp: 700 }, { give: "tilde-whip" }, { rep: "razorbacks", by: 5 }],
    },
    deal: {
      title: "Five Percent", journal: "Thirty percent became five. Kestrel calls it robbery. She also calls it the best deal the Arcade's had in years.",
      effects: [{ credits: 300 }, { xp: 600 }, { rep: "razorbacks", by: 2 }],
    },
    forced: {
      title: "Paid in Bruises", journal: "Gristle's crew is in the clinic and the tax is off. The Razorbacks will remember the Arcade. And you.",
      effects: [{ credits: 350 }, { xp: 700 }, { rep: "razorbacks", by: -15 }],
    },
  },
};

// A round win: remembers the round and moves on.
const win = (round: number, lines: readonly string[], next: string) => node(`r${round}-win`, lines, [go("on", "...", next)], [{ setFlag: `tt.r${round}` }]);
const lose = (round: number, lines: readonly string[], next: string) => node(`r${round}-lose`, lines, [go("on", "...", next)]);
const check = (id: string, label: string, stat: "cool" | "street" | "tech", difficulty: number, round: number, bonus?: NonNullable<DialogueOptionDef["check"]>["bonus"]): DialogueOptionDef =>
  ({ id, label, check: { stat, difficulty, success: `r${round}-win`, failure: `r${round}-lose`, ...(bonus ? { bonus } : {}) }, next: null });

const dialogues: DialogueDefinition[] = [
  {
    id: "tt.kestrel", npc: "kestrel", quest: Q,
    entries: [{ condition: inStage(Q, "report"), node: "report", priority: 20 }, { condition: { quest: Q, status: "active" }, node: "waiting", priority: 17 }],
    nodes: [
      node("offer", [
        "Gristle. Razorback lieutenant. He takes thirty percent of my arcade every week and calls it a tax.",
        "Thirty percent! The city only takes twenty and at least the city pretends to fix the lights.",
        "Talk to him. You look like you can talk. If you can't talk, you look like you can do the other thing.",
      ], [
        { id: "accept", label: "I'll have a word.", effects: [{ startQuest: Q }], next: "waiting" },
        bye("Not my business, Mama.", "decline"),
      ]),
      node("waiting", ["Gristle's on the corner west of here with his crew. Be polite first. It confuses them."], [LEAVE]),
      node("report", ["Well? Do I still owe that pig thirty percent?"], [{ id: "report", label: "Tell her how it went.", kind: "complete", next: "paid" }]),
      node("paid", ["[She counts out credits from a jar marked TAXES.] This jar is yours now, baby. It was always going somewhere."], [LEAVE]),
    ],
  },
  {
    id: "tt.gristle", npc: "gristle", quest: Q,
    entries: [
      { condition: { all: [inStage(Q, "talk"), { flag: "tt.started" }] }, node: "resume", priority: 21 },
      { condition: inStage(Q, "talk"), node: "open", priority: 20 },
    ],
    nodes: [
      node("open", ["Kestrel sent a tourist. Cute.", "You've got three chances to say something interesting. Then I go back to being rich."], [go("start", "Let's talk about the Arcade.", "r1")], [{ setFlag: "tt.started" }]),
      node("resume", ["Walked off mid-sentence. Rude.", "Now we skip to the part where I decide."], [go("decide", "Go on, then.", "verdict")]),
      node("r1", ["Round one. Why should I listen to you?"], [
        check("bluff", "Kestrel's under the Duchess's protection now. Didn't you get the memo?", "cool", 3, 1),
        check("founders", "Founders' rule: nobody taxes the Arcade. Your own mother signed it.", "street", 4, 1),
      ]),
      win(1, ["...The Duchess. Right. Nobody tells me anything.", "Fine. Keep talking."], "r2"),
      lose(1, ["[Gristle laughs.] Nice try. My mother can't write."], "r2"),
      node("r2", ["Round two. What's in it for me?"], [
        check("books", "Your crew is skimming the Duchess. I've seen the books. So could she.", "tech", 3, 2, [{ if: { rep: "razorbacks", atLeast: 10 }, by: 1, label: "Razorback friends" }]),
        check("fame", "Kestrel puts your face on the high-score screen. Forever.", "cool", 4, 2),
        { id: "pay", label: "Two hundred credits, and you forget the Arcade exists.", condition: { credits: 200 }, effects: [{ credits: -200 }], next: "r2-win" },
      ]),
      win(2, ["[He goes quiet in the way men go quiet when they're counting.]", "...Go on."], "r3"),
      lose(2, ["What's in it for me is thirty percent. Next."], "r3"),
      node("r3", ["Round three. [He leans in close. His breath smells of tusk polish.]"], [
        check("stare", "Don't blink.", "street", 5, 3),
        check("story", "Tell him what happened to the last lieutenant who taxed the Arcade.", "cool", 5, 3),
        check("earpieces", "Hijack his crew's earpieces to play the Arcade jingle on a loop.", "tech", 4, 3),
      ]),
      win(3, ["[Gristle blinks first.]", "...Okay. Okay."], "verdict"),
      lose(3, ["[You blink first. Gristle grins with every tooth he has left.]"], "verdict"),
      node("verdict", ["[Gristle chews it over, and possibly his tongue.]"], [
        { id: "fold", label: "Watch him fold.", condition: ALL_THREE, hideIfUnavailable: true, next: "folded" },
        { id: "shake", label: "Shake on five percent.", condition: EXACTLY_TWO, hideIfUnavailable: true, next: "deal" },
        { id: "brace", label: "...Uh oh.", condition: { not: { any: [ALL_THREE, EXACTLY_TWO] } }, hideIfUnavailable: true, next: "fight" },
      ]),
      node("folded", ["The Arcade? Never heard of it. Couldn't find it with a map. We're done here."], [LEAVE], [{ setFlag: "tt.verdict", value: "folded" }]),
      node("deal", ["Five percent. And I get to play the cabinets for free.", "Don't tell the Duchess."], [LEAVE], [{ setFlag: "tt.verdict", value: "deal" }]),
      node("fight", ["Boys. Teach the tourist about taxes."], [LEAVE], [{ setFlag: "tt.verdict", value: "fight" }, { hostile: "tt-crew", value: true }]),
    ],
  },
];

/** Talk down the Razorback tax on the Arcade (Spillway negotiation, level 4). */
export const TUSK_TAX_PACK: ContentPack = { id: "tusk-tax", encounters, dialogues, quests: [quest] };
