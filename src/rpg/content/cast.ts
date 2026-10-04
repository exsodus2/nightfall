// Pack "cast": the named people of the city (twelve new faces across all six districts), their
// shops, and each one's "hub" conversation - small talk, rumours and the doors into their quests.
//
// How the hubs work with the quest packs: a hub's entry is unconditional (plus world-state
// variants), and quest dialogues use conditional entries, so quest business always wins when there
// is some. Offers are hub options that open the quest pack's "offer" node (openDialogue), which
// keeps each storyline's words in its own file. Post-game variants key off the story's world flag
// `hush.ending` ("restored" | "kept"), set at the end of The Hollow Choir.
//
// Vendors: `vendors` below; the session adds the Trade option for vendor NPCs.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { Condition, ContentPack, DialogueDefinition, DialogueNode, DialogueOptionDef } from "../types.ts";
import { FACE, LEAVE, available, flagIs, look, node } from "./helpers.ts";

const SKIN = { pale: [214, 188, 164], tan: [182, 140, 108], brown: [128, 92, 70], deep: [92, 64, 50], grey: [170, 170, 176] } as const;

export const CAST: readonly NpcDefinition[] = [
  // ---- Silk Market (district 4): the safe streets around the spawn --------------------------
  {
    id: "hana", name: "Hana Oduya", title: "Noodle cart", district: 4, x: -14.5, z: 96, facing: FACE.east,
    look: look([230, 120, 60], [60, 40, 30], SKIN.brown, [255, 200, 120], "cap", "lantern", "swing"),
    greeting: ["Broth's been going since before the rain started. Same broth. I just keep adding.", "Eat something. You look like a man who fights on an empty stomach."],
  },
  {
    id: "sable", name: "Sable Quist", title: "Contract clerk", district: 4, x: -14.5, z: 64, facing: FACE.east,
    look: look([60, 60, 70], [20, 20, 24], SKIN.pale, [255, 60, 80], "visor", "case", "scan"),
    greeting: ["Board's open. Names go up, names come down.", "Try not to be one of them."],
  },
  {
    id: "lark", name: "Lark", title: "Busker, voiceless", district: 4, x: 14.5, z: 194, facing: FACE.west,
    look: look([200, 180, 220], [70, 60, 90], SKIN.pale, [220, 170, 255], "bare", "umbrella", "sway"),
    greeting: ["[She taps a chalk slate: SORRY. NO SONGS TODAY. OR YESTERDAY.]"],
  },
  // ---- Neon Ward (district 1) -----------------------------------------------------------------
  {
    id: "harrow", name: "Imani Harrow", title: "Private eye", district: 1, x: -14.5, z: -60, facing: FACE.east,
    look: look([90, 70, 50], [30, 24, 18], SKIN.deep, [255, 210, 140], "cap", "umbrella", "breathe"),
    greeting: ["Twenty years on the force. Then the force got bought.", "Now I work for whoever still pays in cash, and I sleep fine. Mostly."],
  },
  {
    id: "sarr", name: "Adjutant Sarr", title: "CorpSec liaison", district: 1, x: 56, z: -134, facing: FACE.west,
    look: look([60, 70, 96], [18, 22, 30], SKIN.pale, [120, 210, 255], "visor", "antenna", "scan"),
    greeting: ["Citizen. You are standing in a Meridian Security Zone.", "Standing is permitted. For now."],
  },
  // ---- Ghost Circuit (district 2) -------------------------------------------------------------
  {
    id: "nix", name: "Nix", title: "Ghost fixer", district: 2, x: 327.2, z: -160, facing: FACE.west,
    look: look([36, 34, 48], [12, 12, 18], SKIN.brown, [170, 120, 255], "hood", "antenna", "scan"),
    greeting: ["You're not on any list I own.", "That's either very good or very bad. Let's find out which."],
  },
  {
    id: "ferro", name: "Deacon Ferro", title: "Chrome Saints deacon", district: 2, x: 458, z: -262, facing: FACE.south,
    look: look([220, 222, 230], [110, 100, 70], SKIN.grey, [255, 235, 170], "bare", "lantern", "breathe"),
    greeting: ["Flesh rots, friend. Chrome remembers.", "Which would you rather be?"],
  },
  // ---- The Foundry (district 0) ---------------------------------------------------------------
  {
    id: "gauge", name: "Gunnar 'Gauge' Halvorsen", title: "Arms dealer", district: 0, x: -420, z: -300, facing: FACE.east,
    look: look([100, 90, 70], [40, 34, 26], SKIN.pale, [255, 160, 60], "cap", "case", "swing"),
    greeting: ["Everything on the table fires.", "Most of it fires forward. Returns are not accepted, for obvious reasons."],
  },
  // ---- Rain Gardens (district 3) --------------------------------------------------------------
  {
    id: "juniper", name: "Dr. Juniper Vale", title: "Street ripperdoc", district: 3, x: -376.8, z: 200, facing: FACE.west,
    look: look([210, 230, 214], [40, 80, 60], SKIN.tan, [140, 255, 180], "visor", "case", "breathe"),
    greeting: ["Sit. Don't touch anything that's humming.", "Armour, stims, and the occasional organ. Cash only. The organs are cash and a signature."],
  },
  // ---- The Spillway (district 5) --------------------------------------------------------------
  {
    id: "kestrel", name: "Mama Kestrel", title: "Afterlight Arcade owner", district: 5, x: 458, z: 262, facing: FACE.east,
    look: look([255, 190, 90], [80, 50, 20], SKIN.deep, [255, 210, 90], "bare", "lantern", "sway"),
    greeting: ["Open until the end of the world, baby.", "We've had three ends of the world already. Still open."],
  },
  {
    id: "nimbus", name: "Mr. Nimbus", title: "Definitely not a weatherman", district: 5, x: 504, z: 262, facing: FACE.west,
    look: look([110, 120, 140], [40, 44, 54], SKIN.tan, [180, 220, 255], "hood", "umbrella", "scan"),
    greeting: ["Lovely weather. I mean. I wouldn't know.", "I don't do weather. Never have. Why do you ask?"],
  },
  {
    id: "gristle", name: "Gristle", title: "Razorback lieutenant", district: 5, x: 391.2, z: 184.8, facing: FACE.west,
    look: look([170, 60, 30], [50, 20, 10], SKIN.tan, [255, 170, 40], "cap", null, "swing"),
    greeting: ["You lost, or you shopping?", "Either way there's a fee."],
  },
];

// ---- Hubs --------------------------------------------------------------------------------------

type Variant = { condition: Condition; lines: readonly string[]; priority?: number };
const RESTORED: Condition = flagIs("hush.ending", "restored");
const KEPT: Condition = flagIs("hush.ending", "kept");

/** An option that opens another dialogue's node (a quest pack's offer), shown only while it applies. */
export function opens(id: string, label: string, dialogue: string, nodeId: string, condition: Condition): DialogueOptionDef {
  return { id, label, condition, hideIfUnavailable: true, kind: "continue", effects: [{ openDialogue: dialogue, node: nodeId }], next: null };
}
/** A job offer: shown while the quest is available, opens its offer node. */
const job = (quest: string, label: string, dialogue: string): DialogueOptionDef => opens(`ask-${quest}`, label, dialogue, "offer", available(quest));

/** A hub dialogue: greeting lines + options, with world-state variants that keep the same options.
 * Variant entries are conditional, so they win over the plain hub; give legacy-cast hubs a higher
 * priority to beat the legacy relay-chip lines. */
function hub(npc: string, lines: readonly string[], options: readonly DialogueOptionDef[], variants: readonly Variant[] = [], base?: { condition: Condition; priority: number }, extra: readonly DialogueNode[] = []): DialogueDefinition {
  const all = [...options, LEAVE];
  const nodes: DialogueNode[] = [node("hub", lines, all), ...variants.map((v, i) => node(`hub-${i}`, v.lines, all)), ...extra];
  return {
    id: `hub.${npc}`, npc,
    entries: [
      ...variants.map((v, i) => ({ condition: v.condition, node: `hub-${i}`, priority: v.priority ?? 5 })),
      base ? { condition: base.condition, node: "hub", priority: base.priority } : { node: "hub" },
    ],
    nodes,
  };
}

/** Rumours Hana passes on: cheap hints that point at the side quests. */
const RUMOURS: readonly DialogueOptionDef[] = [
  { id: "rumour", label: "Heard anything?", kind: "continue", next: "rumours" },
];

const hubs: DialogueDefinition[] = [
  hub("hana", CAST[0].greeting, RUMOURS, [
    { condition: RESTORED, lines: ["Lark sang at my cart last night. Whole queue went quiet to listen. Good quiet.", "Your bowl's on the house. Don't argue, I'm old."] },
    { condition: KEPT, lines: ["Quiet night. They're all quiet nights now.", "Eat. You look like you're carrying something heavy."] },
    { condition: flagIs("vendetta.general-strike", true), lines: ["Every vending machine on the avenue is on strike. Business has never been better.", "Whoever organised that, I owe them a bowl."], priority: 2 },
  ], undefined, [
    node("rumours", [
      "Kestrel down at the Afterlight is looking for somebody with a spine. Her weatherman vanished, and the Razorbacks are squeezing her.",
      "The vending machine up the avenue in Neon Ward has stopped vending. It says it's on strike. I say it's haunted.",
      "And Tomas at the Ember Core coughs like a broken fan. Juniper in the Gardens says she can fix that. For a price.",
    ], [{ id: "thanks", label: "Thanks, Hana.", kind: "leave", next: null }]),
  ]),
  hub("sable", CAST[1].greeting, [opens("board", "Show me the board.", "bounty.sable", "board", { level: 1 })], [
    { condition: RESTORED, lines: ["Forty-one people walked into the market this week and bought things out loud.", "Good for trade. Bad for my nerves. Board's open."] },
    { condition: KEPT, lines: ["Board's open. It's always open. The city's just quieter about it now."] },
  ]),
  hub("lark", CAST[2].greeting, [], [
    { condition: RESTORED, lines: ["[Lark is singing. It's a song about rain, which is cheating, but nobody minds.]", "Hey. HEY. It's you. I got my voice back and I have been using ALL of it."], priority: 8 },
    { condition: KEPT, lines: ["[She taps the slate. The chalk is worn down to a stub: STILL NOTHING. THEY SAY IT'S GONE FOR GOOD.]", "[Underneath, smaller: DO YOU KNOW WHERE IT WENT?]"], priority: 8 },
  ]),
  hub("harrow", CAST[3].greeting, [job("witness", "Got any work, detective?", "witness.harrow")], [
    { condition: RESTORED, lines: ["Heard you went into the park and came out with the city's voice in your pocket.", "Don't let it go to your head. The rain doesn't care who you are."] },
    { condition: flagIs("witness.proof", true), lines: ["Ines testified. Meridian's lawyers are billing overtime.", "That phone you pulled off the spotter? Best evidence I've had in ten years."], priority: 3 },
  ]),
  hub("sarr", CAST[4].greeting, [], [
    { condition: { quest: "quiet-money", outcome: "betrayed" }, lines: ["Asset. Your cooperation has been logged.", "Your file now says 'useful'. Try to keep it that way."], priority: 3 },
    { condition: KEPT, lines: ["Our analysts are very interested in a certain seed.", "When you're ready to discuss a price, Meridian is ready to be generous. Generously."] },
  ]),
  hub("nix", CAST[5].greeting, [job("quiet-money", "Heard you have a job.", "qm.nix")], [
    { condition: { quest: "quiet-money", outcome: "betrayed" }, lines: ["Oh, look. It's the CorpSec asset.", "I'll still sell to you. At prices that reflect my feelings."], priority: 4 },
    { condition: { quest: "quiet-money", outcome: "delivered" }, lines: ["My favourite contractor. The core had eleven years of Meridian payroll fraud on it.", "The Ghosts are going to have a very merry leak."], priority: 3 },
    { condition: KEPT, lines: ["That seed you're carrying. I can hear it from here. Forty-one voices on a chip the size of a tooth.", "If you ever want to sell, I don't ask questions. I just ask forty thousand."] },
  ]),
  hub("ferro", CAST[6].greeting, [], [
    { condition: flagIs("signal-cathedral.entry", "fight"), lines: ["You spilled chrome on holy ground.", "The Saints do not forgive. They do, however, forget. Eventually. Walk carefully."], priority: 3 },
    { condition: RESTORED, lines: ["The array no longer sings at night. The acolytes say God has gone quiet.", "I say God was never the one singing."] },
  ]),
  hub("gauge", CAST[7].greeting, [], [
    { condition: { quest: "cold-chain", outcome: "sold" }, lines: ["That lung you sold me? Bought a crate of rifle rounds with it.", "Don't look at me like that. Tomas is old. Rounds are forever."], priority: 3 },
  ]),
  hub("juniper", CAST[8].greeting, [job("cold-chain", "Need anything carried?", "cc.juniper")], [
    { condition: flagIs("tomas.lung", "new"), lines: ["Tomas sent me a thank-you note. Written in soot, but still.", "Good work. Organs are hard. Couriers are harder."], priority: 3 },
    { condition: flagIs("tomas.lung", "none"), lines: ["The lung never reached Tomas.", "I don't need to know where it went. I just won't be asking you again."], priority: 3 },
  ]),
  hub("kestrel", CAST[9].greeting, [
    job("weatherman", "Anything I can do for you, Mama?", "weather.kestrel"),
    job("tusk-tax", "The Razorbacks bothering you?", "tt.kestrel"),
  ], [
    { condition: flagIs("weather.dex-back", true), lines: ["Dex is back on the air. Forecast: rain. He cried reading it.", "You brought my weatherman home, baby. Free credits on every machine. Forever."], priority: 3 },
    { condition: RESTORED, lines: ["The arcade's loud again. Kids screaming at cabinets, cabinets screaming back.", "Music to me."] },
  ]),
  hub("nimbus", CAST[10].greeting, [], [
    { condition: flagIs("weather.dex-back", true), lines: ["Tonight's forecast: rain, with a chance of more rain, clearing to rain by morning.", "It's good to be back. Tell Kestrel I said... no, I'll tell her. Out loud. On air."], priority: 3 },
    { condition: flagIs("weather.dex-taken", true), lines: ["[Mr. Nimbus has a black eye and a much smaller umbrella.]", "Paid in full. Actually, this time. Thanks for nothing."], priority: 3 },
    { condition: flagIs("weather.bribed", true), lines: ["Ah. My business associate.", "Lovely weather we're not having."], priority: 3 },
  ]),
  hub("gristle", CAST[11].greeting, [], [
    { condition: flagIs("tt.verdict", "fight"), lines: ["You. I'm not talking to you.", "My lawyer's talking to you. My lawyer is a brick. Watch your windows."], priority: 3 },
    { condition: flagIs("tt.verdict", "folded"), lines: ["The arcade? Never heard of it. Don't know where it is. Couldn't find it with a map.", "...Are we good?"], priority: 3 },
  ]),
  // Base cast (src/city/npcs.ts). Juno's legacy lines outlive the relay chip, so her hub is
  // conditional on it being done and outranks them; Tomas and Wren have no legacy lines.
  hub("juno", ["Every tower in this ward is shouting. I just listen for the quiet ones."], [job("signal-cathedral", "Mara says you've been listening.", "hush.juno")], [
    { condition: { all: [RESTORED, flagIs("hush.vesper", "spared")] }, lines: ["Someone's broadcasting lullabies on the old emergency band. Two a.m., every night.", "Sounds like an apology. I let it play."], priority: 16 },
    { condition: RESTORED, lines: ["The quiet ones are loud again. I can't get any sleep. I love it."], priority: 15 },
    { condition: KEPT, lines: ["The towers still have a hole in them, forty-one voices wide.", "You did what you thought was right. I'm still listening for them."], priority: 15 },
  ], { condition: { quest: "relay-chip" }, priority: 12 }),
  hub("tomas", ["Forty years I've kept the Ember Core burning.", "They say it's automated now. Somebody still has to listen to it breathe."], [
    job("ember-core", "You look worried, Tomas.", "ec.tomas"),
    job("root-access", "Did you know a Vesper Kade?", "hush.tomas"),
  ], [
    { condition: flagIs("tomas.lung", "new"), lines: ["I can breathe all the way down. Forgot what that was like.", "The Core sounds different with two good lungs listening."], priority: 2 },
    { condition: flagIs("tomas.lung", "tired"), lines: ["The lung works. Mostly. I wheeze in B-flat now.", "Juniper says that's not a medical term. I say it's accurate."], priority: 2 },
    { condition: RESTORED, lines: ["Vesper used to say every machine in the city hums one note.", "Tonight the Core hums something new. I think it's relief."], priority: 4 },
  ]),
  hub("wren", ["The Last Tree was here before the first foundation.", "Stand under it a while. It doesn't ask for anything."], [job("hollow-choir", "Is the Tree ready?", "hush.wren")], [
    { condition: RESTORED, lines: ["Listen. The Tree is humming on its own again. No borrowed voices.", "Thank you. It won't say it, so I will."], priority: 5 },
    { condition: KEPT, lines: ["The roots are quiet. Too quiet. Like a held breath.", "Whatever you took from the heart of it - keep it dry."], priority: 5 },
  ]),
];

/** Shops: street food in the Silk Market, arms in the Foundry, armour and meds in the Gardens,
 * tech on the Ghost Circuit. Prices are value x markup (ammo sells in boxes). */
const vendors: NonNullable<ContentPack["vendors"]> = [
  { npc: "hana", markup: 1.1, stock: ["synth-ration", "stim", "coolant-can", "medkit", "haste-inhaler", "neon-tube"] },
  {
    npc: "gauge", markup: 1.25,
    stock: ["pipe-operator", "forward-slash", "segfault", "hash-hammer", "caret-45", "asterisk-smg", "colon-scatter", "quote-magnum", "semicolon", "ammo-pistol", "ammo-shell", "ammo-rifle"],
  },
  { npc: "juniper", markup: 1.2, stock: ["mesh-hoodie", "kevlar-weave", "firewall-vest", "visor-cap", "riot-helm", "stim", "medkit", "shield-cell"] },
  { npc: "nix", markup: 1.35, stock: ["focus-chip", "shield-cell", "haste-inhaler", "tilde-whip", "brace-burst", "halo-rig", "ammo-pistol"] },
];

/** Named NPCs, their shops and hub conversations. */
export const CAST_PACK: ContentPack = { id: "cast", npcs: CAST, vendors, dialogues: hubs };
