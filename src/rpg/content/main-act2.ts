// Main questline, Act 2: "Station Nobody" (Ghost Circuit -> Silk Market -> Silk Harbour).
// Moth runs Station Nobody, a pirate station that records the static the rain makes on the
// city's signs. To decode it she needs Meridian's carrier key card from a weather relay cabinet
// across the street from the Signal Cathedral. Decoded, the first voice is Nell Ashby, the woman
// the player met in Act 1, calling her missing son on the night of the Flood: the rain carries the
// missing, and every call nobody answered. Nell then sends the player to Ruben Salgado, who ran
// Jonah's crane crew at Silk Harbour. The act ends with Ruben watching the Nami Maru's lights.
//
// Quests: Station Nobody (Moth), Light in the Window (Nell). Choices: quiet or forced break-in at
// the relay (a CorpSec response team and -5 CorpSec if forced), Moth airs Nell's voicemail or holds
// it (rain.moth), Nell hears the tape or only the news (rain.window). Ruben's dialogue (which closes
// Light in the Window and offers Act 3) lives in main-act3.ts.

import type { NpcDefinition } from "../../city/npcs.ts";
import type { ContentPack, DialogueDefinition, EncounterDefinition, InteractableDefinition, QuestDefinition2 } from "../types.ts";
import { FACE, LEAVE, active, area, available, bye, ending, flagIs, go, inStage, look, member, node } from "./helpers.ts";
import { FLAG, ITEM, RAIN, SKIN, SPOTS, beforeFinale } from "./main-common.ts";

const Q2 = RAIN.returnToSender, Q3 = RAIN.stationNobody, Q4 = RAIN.lightInWindow;
const RESPONSE = "rain-relay-response";

// ---- People ------------------------------------------------------------------------------------

export const MOTH: NpcDefinition = {
  id: "moth-nobody", name: "Moth", title: "Station Nobody, pirate radio", district: 2, ...SPOTS.moth, facing: FACE.north,
  look: look([58, 52, 70], [22, 20, 30], SKIN.brown, [190, 200, 255], "hood", "antenna", "scan"),
  greeting: ["This is Station Nobody. You're listening to the rain.", "Mind the cables. Mind the puddles. Mostly mind the cables."],
};

// ---- Encounter: the relay alarm's response team ------------------------------------------------

const encounters: EncounterDefinition[] = [
  {
    id: RESPONSE, label: "Meridian response team (weather relay GC-4)", area: area(516, -290, 14), hostile: true,
    members: [member("corp-trooper", 517, -300, FACE.north), member("corp-handler", 517, -280, FACE.south)],
  },
];

// ---- Objects -----------------------------------------------------------------------------------

/** The relay's service hatch: 3.2 m down the pavement from the cabinet (outdoor objects stand at
 * least 3 m apart), on the carriageway side, still 7.4 m off the x = 512 centre line. */
const HATCH = { x: 519.4, z: -292.8 };

const interactables: InteractableDefinition[] = [
  {
    // HACK-HOOK (wired): E on the cabinet opens the breach minigame (src/rpg/hacking). On success the
    // session calls quests.interact("rain-relay"), which applies these effects (the same card and the
    // same `<quest>.relay = "slipped"` record as the "port-open" node's "slipped" option) and emits
    // `interacted`, finishing the stage's "breach" objective. The session drops any dialogue from that
    // path, so the cabinet carries none: the TECH check and the pry live on the service hatch below,
    // which stays usable while the cabinet is locked out after a failed breach.
    id: "rain-relay", label: "Weather relay GC-4 (Meridian Climate)", ...SPOTS.relay, y: 1.3, glyph: ">",
    condition: inStage(Q3, "relay"),
    hack: { kind: "terminal", tier: "medium", district: 2 },
    effects: [
      { give: ITEM.carrierKey }, { setFlag: `${Q3}.relay`, value: "slipped" },
      { message: "CARRIER KEY: RAINFALL/7-ALPHA. The card ejects; the panel clicks shut. Nobody saw.", tone: "quest" },
    ],
  },
  {
    // The dialogue fallback for the relay: the TECH 3 maintenance port and the forced pry ("rain.relay").
    id: "rain-relay-hatch", label: "Weather relay GC-4: service hatch", ...HATCH, y: 0.6, glyph: "#",
    condition: inStage(Q3, "relay"), dialogue: "rain.relay",
  },
];

// ---- Quests ------------------------------------------------------------------------------------

const stationNobody: QuestDefinition2 = {
  id: Q3, title: "Station Nobody", category: "story", giver: MOTH.id,
  summary: "Moth of Station Nobody can decode the rain's static, but only with Meridian's carrier key card, kept in a weather relay cabinet across the street from the Signal Cathedral.",
  requires: { quest: Q2 }, rewardHint: "250 cr, 600 XP, reputation depends on what Moth does", recommendedLevel: 3, start: "relay",
  stages: [
    {
      // HACK-HOOK (wired, see "rain-relay"): either objective ends the stage. A breach finishes
      // "breach"; the service hatch's dialogue finishes "relay" ("slipped" or "forced").
      id: "relay", journal: "Moth (Station Nobody, beside Ghost Circuit station) needs Meridian's carrier key card from weather relay GC-4: a cabinet in the alley mouth across the street from the Signal Cathedral's east wall. Breach its terminal, or open the service hatch beside it and get the card out quietly or by force.",
      onEnter: [{ waypoint: { ...SPOTS.relay, label: "Weather relay GC-4" } }],
      mode: "any",
      objectives: [
        { id: "breach", kind: "interact", text: "Breach the weather relay's terminal across from the Signal Cathedral's east wall", object: "rain-relay" },
        { id: "relay", kind: "choose", text: "Or work the relay's service hatch across from the Signal Cathedral's east wall", dialogue: "rain.relay", options: ["slipped", "forced"] },
      ],
      next: "decode",
    },
    {
      id: "decode", journal: "You have Meridian's carrier key card. Take it to Moth on the pavement beside Ghost Circuit station so she can decode what the rain is saying.",
      onEnter: [{ waypoint: { ...SPOTS.moth, label: "Moth, Station Nobody" } }],
      objectives: [{ id: "decode", kind: "choose", text: "Bring the key card to Moth beside Ghost Circuit station", dialogue: "rain.moth", options: ["air", "hold"] }],
      next: [{ if: flagIs(FLAG.moth, "aired"), stage: "end-aired" }, { stage: "end-held" }],
    },
    ending("end-aired", "Station Nobody is on the air.", "aired"),
    ending("end-held", "Station Nobody is holding.", "held"),
  ],
  outcomes: {
    aired: {
      title: "On Every Frequency",
      journal: "At three in the morning Station Nobody played Nell Ashby's voicemail on every pirate band in the city. Moth gave you the tape. Nell should hear it from you first: she's on her chair across the street from 9 Lantern Row.",
      effects: [{ credits: 250 }, { xp: 600 }, { give: ITEM.tape }, { rep: "civilian", by: 8 }, { rep: "corpsec", by: -8 }, { waypoint: { ...SPOTS.nell, label: "Nell Ashby" } }],
    },
    held: {
      title: "Holding",
      journal: "Moth is sitting on the decode until you know who is behind it. She gave you the tape. Nell should hear it from you: she's on her chair across the street from 9 Lantern Row.",
      effects: [{ credits: 250 }, { xp: 600 }, { give: ITEM.tape }, { rep: "ghosts", by: 6 }, { waypoint: { ...SPOTS.nell, label: "Nell Ashby" } }],
    },
  },
};

const lightInWindow: QuestDefinition2 = {
  id: Q4, title: "Light in the Window", category: "story", giver: "nell-ashby",
  summary: "The first voice in the rain was Nell Ashby's, calling her missing son. She is on her chair across the street from 9 Lantern Row. Tell her.",
  requires: { quest: Q3 }, rewardHint: "100 cr, 400 XP", recommendedLevel: 3, start: "listen",
  stages: [
    {
      id: "listen", journal: "Moth's first decoded voice was Nell Ashby's, calling her son Jonah on the night of the Flood. Tell Nell, on her chair across the street from 9 Lantern Row in the Silk Market: play her the tape, or tell her plainly.",
      objectives: [{ id: "tell", kind: "choose", text: "Tell Nell Ashby what's in the rain, across the street from 9 Lantern Row", dialogue: "rain.nell-window", options: ["play", "told"] }],
      next: "ruben",
    },
    {
      id: "ruben", journal: "Jonah ran crane four at Silk Harbour, and his old crew boss, Ruben Salgado, still runs the quay and signs for the Nami Maru's cargo. Find Ruben on the quay west of Silk Harbour station, at the south end of the avenue.",
      onEnter: [{ waypoint: { ...SPOTS.ruben, label: "Ruben Salgado" } }],
      objectives: [{ id: "ruben", kind: "choose", text: "Ask Ruben Salgado on the Silk Harbour quay what he signs for", dialogue: "rain.ruben", options: ["nell-sent"] }],
    },
  ],
  outcomes: {
    done: {
      title: "Crane Four",
      journal: "Ruben Salgado looked out at the Nami Maru's deck lights. 'She came back without him,' he said. 'She always comes back.'",
      effects: [{ credits: 100 }, { xp: 400 }],
    },
  },
};

// ---- Dialogue ----------------------------------------------------------------------------------

const dialogues: DialogueDefinition[] = [
  {
    id: "rain.moth", npc: MOTH.id,
    entries: [
      { condition: inStage(Q2, "moth"), node: "first", priority: 30 },
      { condition: inStage(Q3, "decode"), node: "decode", priority: 30 },
      { condition: available(Q3), node: "offer", priority: 22 },
      { condition: active(Q3), node: "working", priority: 20 },
      { condition: { all: [flagIs(FLAG.moth, "aired"), beforeFinale] }, node: "after-aired", priority: 4 },
      { condition: { all: [flagIs(FLAG.moth, "held"), beforeFinale] }, node: "after-held", priority: 4 },
    ],
    nodes: [
      node("first", [
        "You're dripping on my cables.",
        "I'm Moth. This is Station Nobody: pirate radio for nobody in particular. I record the static the rain makes on every sign in the city. Three years of it.",
        "The Exchange sent you. What have you got?",
      ], [{ id: "show-drive", label: "Show her the wet drive.", condition: inStage(Q2, "moth"), kind: "complete", next: "heard" }, LEAVE]),
      node("heard", [
        "[She plugs the drive into a tape deck held together with tape. Static.]",
        "Same hiss as the signs. Same key, same tempo. Your drive and the rain are reading from the same page.",
        "O. Crane, Meridian Climate. Meridian makes the weather from the top of the Spire. Copy that.",
      ], [go("how", "Can you read it?", "offer")]),
      node("offer", [
        "Not without the carrier key: the code Meridian scrambles the weather signal with.",
        "There's a Meridian weather relay cabinet in the alley mouth across the street from the Signal Cathedral's east wall. The key card lives inside. Bring it here.",
        "Why you? You're already wet, and the drive came to you. Station Nobody pays cash: two hundred and fifty.",
      ], [
        { id: "accept-key", label: "I'll get the key card. (250 cr)", condition: available(Q3), effects: [{ startQuest: Q3 }], next: "accepted" },
        bye("Not yet.", "decline"),
      ]),
      node("accepted", [
        "The cabinet has a maintenance port, if you're good with your hands, and a tamper alarm if you're not.",
        "Copy. I'll be here. The station has the only dry ceiling on the block.",
      ], [LEAVE]),
      node("working", ["Weather relay cabinet, in the alley mouth across the street from the Cathedral's east wall. Key card inside. Over."], [LEAVE]),
      node("decode", [
        "You got it. Hand it over; mind the cables.",
        "[Moth slots the card. The hiss thins like fog lifting off water.]",
        "[A woman's voice, close and tired: 'Jonah, love, it's Mum. The water's at the step. I've left the light on. Ring me when you're off the crane.']",
      ], [go("know", "I know that voice.", "nell-voice")]),
      node("nell-voice", [
        "[You know it. You talked to her tonight, across the street from 9 Lantern Row.]",
        "Nell Ashby? Then that isn't a missing person. It's a call to one. The rain is carrying the calls nobody answered, and the voices of the people who couldn't.",
        "[The header scrolls past: ARCHIVE RAINFALL / 312 LOTS / ARRIVE ON NAMI MARU / WOVEN AT KILN NINE / BROADCAST FROM THE MERIDIAN SPIRE / CUSTODIAN O. CRANE]",
      ], [go("drive", "And my drive?", "choice")]),
      node("choice", [
        "Your drive won't play here. It's a master copy; it only plays through the machine that made it.",
        "I could put Nell's voicemail on the air tonight, every pirate band in Nightfall. People deserve to know what's in their rain.",
        "Or I sit on it until we know who's doing this and why. Your call. You found it.",
      ], [
        { id: "air", label: "Put it on the air. The city should know. (+8 Civilians, -8 CorpSec)", condition: inStage(Q3, "decode"), effects: [{ take: ITEM.carrierKey }, { setFlag: FLAG.moth, value: "aired" }], next: "aired" },
        { id: "hold", label: "Hold it until we know who's doing this. (+6 Ghosts)", condition: inStage(Q3, "decode"), effects: [{ take: ITEM.carrierKey }, { setFlag: FLAG.moth, value: "held" }], next: "held" },
        bye("Give me a minute."),
      ]),
      node("aired", [
        "Copy. Station Nobody, three a.m., all frequencies.",
        "[At three, Nell Ashby's voicemail plays on every pirate band in the city. On the Ghost Circuit, people stop under the signs to listen.]",
        "Take the tape, and this clip-on tap: if you ever find the cable that feeds all this, clip it on and I'll ride it. Nell should hear the tape from a person before she hears it from a lamp post.",
      ], [LEAVE]),
      node("held", [
        "Copy. Holding.",
        "[Moth switches the deck off. The rain goes back to hissing.]",
        "Take the tape, and this clip-on tap: if you ever find the cable that feeds all this, clip it on and I'll ride it. Nell should hear the tape from a person.",
      ], [LEAVE]),
      node("after-aired", [
        "People keep coming to the station asking which frequency the dead are on.",
        "I tell them: all of them, if you listen. It isn't a comfort. It's just true.",
      ], [LEAVE]),
      node("after-held", ["Still holding. Holding is harder than broadcasting. Nobody tells you that."], [LEAVE]),
    ],
  },
  {
    // Weather relay GC-4's service hatch (spoken by the "rain-relay-hatch" interactable).
    // HACK-HOOK (wired): a successful breach of the cabinet ("rain-relay") does what "port-open" ->
    // "slipped" does through the cabinet's own effects; this dialogue is the no-hack fallback.
    id: "rain.relay", npc: "rain-relay-hatch",
    entries: [{ node: "panel" }],
    nodes: [
      node("panel", [
        "MERIDIAN CLIMATE / WEATHER RELAY GC-4 / AUTHORISED ACCESS ONLY",
        "[A service hatch under the cabinet: a keypad, a maintenance port and a tamper alarm the size of a fist.]",
      ], [
        {
          id: "port", label: "Work the maintenance port quietly", next: null,
          check: { stat: "tech", difficulty: 3, success: "port-open", failure: "port-locked", bonus: [{ if: flagIs(FLAG.drive, "logged"), by: 1, label: "Courier number from the Exchange" }] },
        },
        {
          id: "forced", label: "Pry the cabinet open (trips the alarm; -5 CorpSec)", condition: inStage(Q3, "relay"),
          effects: [{ give: ITEM.carrierKey }, { spawn: RESPONSE }, { rep: "corpsec", by: -5 }, { message: "The tamper alarm screams. A Meridian response team is coming up the street.", tone: "danger" }],
          next: "pried",
        },
        LEAVE,
      ]),
      node("port-open", [
        "[The port takes your handshake. The screen scrolls, then holds.]",
        "CARRIER KEY: RAINFALL/7-ALPHA. EJECT CARD? Y / N",
      ], [{ id: "slipped", label: "Take the card and close the panel.", condition: inStage(Q3, "relay"), effects: [{ give: ITEM.carrierKey }], next: "closed" }]),
      node("closed", ["[The panel clicks shut. Nobody saw. Nobody ever looks at weather equipment.]"], [LEAVE]),
      node("port-locked", [
        "ACCESS DENIED. TWO ATTEMPTS REMAINING BEFORE LOCKOUT.",
        "[It's bluffing. Probably. A better hand with circuits, or better gear, would get through.]",
      ], [
        go("retry", "Try the port again.", "panel"),
        {
          id: "forced", label: "Pry the cabinet open (trips the alarm; -5 CorpSec)", condition: inStage(Q3, "relay"),
          effects: [{ give: ITEM.carrierKey }, { spawn: RESPONSE }, { rep: "corpsec", by: -5 }, { message: "The tamper alarm screams. A Meridian response team is coming up the street.", tone: "danger" }],
          next: "pried",
        },
        LEAVE,
      ]),
      node("pried", [
        "[The door bends, the alarm screams, and the key card drops into your hand.]",
        "[Boots on the pavement: a Meridian response team, coming up the street from the Cathedral. Get the card to Moth.]",
      ], [LEAVE]),
    ],
  },
  {
    id: "rain.nell-window", npc: "nell-ashby",
    entries: [
      { condition: inStage(Q4, "listen"), node: "tell", priority: 24 },
      { condition: available(Q4), node: "offer", priority: 22 },
      { condition: active(Q4), node: "working", priority: 20 },
      { condition: { all: [flagIs(FLAG.window, "played"), beforeFinale] }, node: "after-played", priority: 5 },
      { condition: { all: [flagIs(FLAG.window, "told"), beforeFinale] }, node: "after-told", priority: 5 },
    ],
    nodes: [
      node("offer", [
        "You're back. You've got the face the harbour office had, six years ago.",
        "Whatever you found, say it plain. I've had six years of people saying it fancy.",
      ], [
        { id: "accept-window", label: "Tell her what's in the rain.", condition: available(Q4), effects: [{ startQuest: Q4 }], next: "tell" },
        bye("Not yet.", "decline"),
      ]),
      node("tell", ["Go on, then."], [
        { id: "play", label: "Play her the Station Nobody tape.", condition: { all: [inStage(Q4, "listen"), { item: ITEM.tape }] }, reason: "You need Moth's tape", effects: [{ setFlag: FLAG.window, value: "played" }], next: "played" },
        { id: "told", label: "Tell her plainly, without the tape.", condition: inStage(Q4, "listen"), effects: [{ setFlag: FLAG.window, value: "told" }], next: "told" },
        bye("Give me a minute."),
      ]),
      node("played", [
        "[Her own voice comes out of the little speaker: 'I've left the light on.' She mouths the last line along with it.]",
        "I rang him eleven times that night. I didn't think any of them went anywhere.",
        "So somebody kept them. Somebody kept my calls and not my son.",
      ], [go("jonah", "Tell me about Jonah.", "jonah")]),
      node("told", [
        "[She listens to all of it without blinking.]",
        "My voice. In the rain. Six years I've sat under it with an umbrella.",
        "Don't play it me. I know what I said.",
      ], [go("jonah", "Tell me about Jonah.", "jonah")]),
      node("jonah", [
        "Jonah ran crane four at Silk Harbour. The night of the Flood he was unloading the Nami Maru. The ship came back. He didn't.",
        "Ruben Salgado ran that crew. He still runs the quay, west of Silk Harbour station. He paid for a funeral with nobody in it.",
        "If those drives come in on that ship, Ruben signs for them. Go and ask him what he signs for.",
      ], [bye("I'll go to the harbour.")]),
      node("working", ["Ruben Salgado. Silk Harbour quay, west of the station: straight down the avenue to the sea. He'll be shouting at a crane."], [LEAVE]),
      node("after-played", ["I keep the tape in my coat. I don't play it. I just like knowing where it is."], [LEAVE]),
      node("after-told", ["I sit under the rain now and listen for myself. Haven't heard me yet. Probably for the best."], [LEAVE]),
    ],
  },
];

/** Act 2: Station Nobody and the first voice. */
export const MAIN_ACT2_PACK: ContentPack = {
  id: "main-act2",
  npcs: [MOTH],
  encounters,
  interactables,
  quests: [stationNobody, lightInWindow],
  dialogues,
};
