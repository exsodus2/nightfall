// Pack "quiet-money": the heist. Nix wants a Meridian payroll core out of the CorpSec data cradle
// behind the Spire. Go quiet (loop the cameras at the service panel: a tech check, easier with the
// Relay Keycard from VENDETTA or Nix's guard rotation) or go loud (the vault guards, then their
// reinforcements). At the end, the betrayal: Adjutant Sarr is standing right there, and CorpSec
// pays better. Ghost and CorpSec reputation move in opposite directions either way.

import type { ContentPack, DialogueDefinition, EncounterDefinition, InteractableDefinition, ItemDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, area, bye, ending, go, inStage, member, node } from "./helpers.ts";

const Q = "quiet-money";
const QUIET = { flag: "qm.quiet" } as const;

const items: ItemDefinition[] = [
  { id: "vault-core", name: "Payroll Core", kind: "quest", rarity: "epic", glyph: "C", value: 0, weight: 0, stack: 1, tags: ["quest"], description: "A Meridian payroll core in a cold steel sleeve. Eleven years of numbers somebody would kill to keep quiet." },
];

const encounters: EncounterDefinition[] = [
  {
    id: "qm-vault-guards", label: "Data cradle guards", area: area(34, -180, 16), hostile: false,
    members: [
      member("corp-trooper", 30, -180, FACE.north, { patrol: [{ x: 24, z: -180 }, { x: 44, z: -180 }] }),
      member("corp-shield", 50, -178, FACE.west), member("corp-handler", 40, -184, FACE.south),
    ],
  },
  {
    id: "qm-reinforcements", label: "Alarm response", area: area(12, -172, 16), hostile: true,
    members: [member("corp-trooper", 14.5, -166, FACE.north), member("corp-trooper", -14.5, -172, FACE.east), member("corp-shield", 14.5, -176, FACE.east)],
  },
];

const interactables: InteractableDefinition[] = [
  { id: "qm-panel", label: "Cradle service panel", x: 16, z: -182, y: 1.3, glyph: "#", condition: inStage(Q, "breach"), dialogue: "qm.panel" },
  {
    id: "qm-cradle", label: "Data cradle", x: 54, z: -182, y: 1.2, glyph: "C", once: true,
    condition: inStage(Q, "vault"),
    effects: [{ give: "vault-core" }, { message: "The core slides out of the cradle with a sigh of cold air. Somewhere a server notices it's lonely.", tone: "loot" }],
  },
];

const quest: QuestDefinition2 = {
  id: Q, title: "Quiet Money", category: "side", giver: "nix",
  summary: "Lift a Meridian payroll core out of the CorpSec data cradle behind the Spire. Quietly, ideally.",
  rewardHint: "700 cr and an epic blade from Nix - or whatever CorpSec offers", recommendedLevel: 7, start: "breach",
  stages: [
    {
      id: "breach", journal: "The cradle sits on the north side of the Meridian Spire. Loop the cameras at the service panel and walk in - or clear the guards.",
      onEnter: [{ spawn: "qm-vault-guards" }, { waypoint: { x: 16, z: -182, label: "Service panel" } }],
      mode: "any",
      objectives: [
        { id: "quiet", kind: "condition", text: "Loop the cradle cameras at the service panel", condition: QUIET, target: { x: 16, z: -182 } },
        { id: "loud", kind: "clear", text: "Or go loud: clear the cradle guards", encounter: "qm-vault-guards" },
      ],
      next: "vault",
    },
    {
      id: "loud", journal: "Alarms. The guards know, and more are coming up the avenue. Clear them all.",
      onEnter: [{ spawn: "qm-reinforcements" }],
      objectives: [
        { id: "guards", kind: "clear", text: "Clear the cradle guards", encounter: "qm-vault-guards" },
        { id: "response", kind: "clear", text: "Clear the alarm response", encounter: "qm-reinforcements" },
      ],
      next: "vault",
    },
    {
      id: "vault", journal: "The cradle is open. Take the core.",
      objectives: [{ id: "core", kind: "interact", text: "Pull the payroll core from the data cradle", object: "qm-cradle" }],
      next: "deliver",
    },
    {
      id: "deliver", journal: "Nix is waiting on the Ghost Circuit. Adjutant Sarr is standing about thirty metres away. Nobody would ever know. Except everybody.",
      mode: "any",
      objectives: [
        { id: "to-nix", kind: "choose", text: "Bring the core to Nix", dialogue: "qm.nix", options: ["hand-over", "hand-over-clean"] },
        { id: "to-sarr", kind: "choose", text: "Or sell it back to Adjutant Sarr", dialogue: "qm.sarr", options: ["sell-out"] },
      ],
      next: [{ if: { flag: "quiet-money.to-sarr", is: "sell-out" }, stage: "end-betrayed" }, { stage: "end-delivered" }],
    },
    ending("end-delivered", "Nix paid.", "delivered"),
    ending("end-betrayed", "Sarr paid.", "betrayed"),
  ],
  outcomes: {
    delivered: {
      title: "Honour Among Ghosts", journal: "Nix plugged the core in and laughed for a full minute. Eleven years of Meridian payroll fraud, ready to leak. Nix pays in hardware.",
      effects: [{ credits: 700 }, { xp: 1200 }, { give: "null-pointer" }, { rep: "ghosts", by: 15 }, { rep: "corpsec", by: -10 }],
    },
    betrayed: {
      title: "Company Man", journal: "Sarr took the core without a word and paid without a smile. CorpSec will remember the favour. The Ghosts will remember everything else.",
      effects: [{ credits: 1100 }, { xp: 1200 }, { give: "brace-burst" }, { give: "firewall-vest" }, { rep: "corpsec", by: 15 }, { rep: "ghosts", by: -20 }, { setFlag: "qm.betrayed" }],
    },
  },
};

const dialogues: DialogueDefinition[] = [
  {
    id: "qm.nix", npc: "nix", quest: Q,
    entries: [
      { condition: { all: [inStage(Q, "deliver"), { item: "vault-core" }] }, node: "deliver", priority: 20 },
      { condition: { quest: Q, status: "active" }, node: "plan", priority: 18 },
    ],
    nodes: [
      node("offer", [
        "Meridian keeps a payroll core in a data cradle on the north side of the Spire. It has eleven years of numbers on it that don't add up.",
        "I want it. The Ghosts want it. The public, I think, deserves it.",
        "Quiet is worth more than loud. Loud is still worth something.",
      ], [
        { id: "accept", label: "I'm in.", effects: [{ startQuest: Q }], next: "plan" },
        bye("Too hot for me.", "decline"),
      ]),
      node("plan", [
        "Service panel on the west side of the cradle. Loop the cameras and the guards will wave you through.",
        "A CorpSec keycard would make the panel friendlier. So would knowing the guard rotation, which I happen to sell.",
      ], [
        { id: "rotation", label: "Buy the guard rotation (150 cr).", condition: { all: [{ credits: 150 }, { not: { flag: "qm.rotation" } }] }, hideIfUnavailable: true, effects: [{ credits: -150 }, { setFlag: "qm.rotation" }], next: "rotation" },
        LEAVE,
      ]),
      node("rotation", ["[Nix flicks a file to your comm.] Trooper on the loop, shield by the cradle, handler watching the street. They swap at the half hour. Be the half hour."], [LEAVE]),
      node("deliver", ["You have it. You actually have it. Give."], [
        { id: "hand-over-clean", label: "Hand over the core. Nobody saw a thing. (+250 cr)", kind: "complete", condition: { all: [{ item: "vault-core" }, QUIET] }, hideIfUnavailable: true, effects: [{ take: "vault-core" }, { credits: 250 }], next: "paid-clean" },
        { id: "hand-over", label: "Hand over the core.", kind: "complete", condition: { all: [{ item: "vault-core" }, { not: QUIET }] }, hideIfUnavailable: true, effects: [{ take: "vault-core" }], next: "paid" },
        bye("Not yet."),
      ]),
      node("paid-clean", ["Clean. No alarms, no bodies, no news. Beautiful.", "Bonus for being a ghost. Welcome to the family."], [LEAVE]),
      node("paid", ["Loud. Very loud. I heard it from here.", "Still: it's the core. You're paid."], [LEAVE]),
    ],
  },
  {
    id: "qm.sarr", npc: "sarr", quest: Q,
    entries: [{ condition: { all: [inStage(Q, "deliver"), { item: "vault-core" }] }, node: "offer-back", priority: 20 }],
    nodes: [
      node("offer-back", [
        "Citizen. You are carrying Meridian property. I can see it from here; the sleeve is tagged.",
        "I could have you shot. I would rather have you paid. The Ghosts give you what, seven hundred? Meridian is more generous with its friends.",
      ], [
        { id: "sell-out", label: "Sell the core back to CorpSec.", kind: "complete", condition: { item: "vault-core" }, effects: [{ take: "vault-core" }], next: "bought" },
        bye("It's not for sale."),
      ]),
      node("bought", ["A sensible transaction. Your file will be updated to 'useful'.", "I would stay out of the Ghost Circuit for a while."], [LEAVE]),
    ],
  },
  {
    // Spoken by the service panel. No `quest`: its stage jump is written in full so the
    // validator sees the jump into "loud".
    id: "qm.panel", npc: "qm-panel",
    entries: [{ node: "panel" }],
    nodes: [
      node("panel", ["[A CorpSec service panel. Camera feeds, door relays, a sticker that says DO NOT LICK.]"], [
        {
          id: "loop", label: "Loop the camera feeds.",
          check: {
            stat: "tech", difficulty: 5, success: "looped", failure: "alarm",
            bonus: [{ if: { item: "relay-keycard" }, by: 3, label: "Relay Keycard" }, { if: { flag: "qm.rotation" }, by: 2, label: "Guard rotation" }],
          },
          next: null,
        },
        go("think", "Step back and think.", "think"),
      ]),
      node("think", ["[If you fail the loop the alarm goes. If you don't try, there's always the loud way.]"], [bye("Leave the panel.")]),
      node("looped", ["[The feeds stutter, then show the same empty rain on loop. The guards scratch their necks and look away.]"], [LEAVE], [{ setFlag: "qm.quiet" }]),
      node("alarm", ["[The panel shrieks. Every light on the Spire's north face turns red.]"], [LEAVE], [
        { setFlag: "qm.alarm" }, { hostile: "qm-vault-guards", value: true }, { stage: "quiet-money:loud" }, { message: "ALARM. The cradle guards are coming for you.", tone: "danger" },
      ]),
    ],
  },
];

/** The payroll core heist (Neon Ward / Ghost Circuit, level 7). */
export const QUIET_MONEY_PACK: ContentPack = { id: "quiet-money", items, encounters, interactables, dialogues, quests: [quest] };
