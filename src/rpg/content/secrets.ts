// Pack "secrets": twenty small discoveries in the city (a Meow Wolf in the rain). No quest log, no
// waypoints: odd objects with a USE glyph, a few hidden rooms behind ordinary-looking doors, and a
// counter that says "A secret: 7/20" the first time each is found (city/secrets-scene.ts watches the
// `secret.<id>` flags). Coordinates come from city/secrets.ts, which also draws the props.
//
// Flags this pack writes: secret.<id> (one per secret), secrets.hunt (the diner note), secrets.cat1-3,
// secrets.word1-6, secrets.valve-step, secrets.reflection-sold, and a few visit counters. The scene
// sets secrets.phone-ringing while the payphone rings.

import type { Condition, ContentPack, DialogueDefinition, Effect, InteractableDefinition, ItemDefinition } from "../types.ts";
import type { NpcDefinition } from "../../city/npcs.ts";
import { GRAFFITI_WORDS, SECRET_FLAGS, SECRET_SPOTS, roomPoint, secretFlag, type SecretId } from "../../city/secrets.ts";
import { FACE, LEAVE, bye, go, look, node } from "./helpers.ts";

const found = (id: SecretId): Effect => ({ setFlag: secretFlag(id), value: true });
const flagAt = (flag: string, is: number): Condition => ({ flag, is });
const COUNT = { calls: "secrets.calls", vendTotal: "secrets.vend-total", vendCycle: "secrets.vend-cycle", knocks: "secrets.knocks", shouts: "secrets.shouts", lost: "secrets.lost-visits" } as const;
const ALL_CATS: Condition = { all: SECRET_FLAGS.cats.map((flag): Condition => ({ flag })) };
const ALL_WORDS: Condition = { all: SECRET_FLAGS.words.map((flag): Condition => ({ flag })) };
/** The diner note's five: a train that never leaves, a shop the wrong way round, a room under the
 * water, a chair on a roof, a door with nothing behind it. */
const FIVE: Condition = { all: [{ flag: SECRET_FLAGS.hunt }, ...(["carriage", "mirror", "manhole", "rooftop", "studio"] as const).map((id): Condition => ({ flag: secretFlag(id) }))] };

// ---- Items ----------------------------------------------------------------------------------------

const keepsake = (id: string, name: string, glyph: string, rarity: ItemDefinition["rarity"], description: string): ItemDefinition =>
  ({ id, name, kind: "junk", rarity, glyph, value: 1, weight: 0.05, stack: 1, tags: ["noloot", "unique", "secret"], description });
const trinket = (id: string, name: string, glyph: string, description: string): ItemDefinition =>
  ({ id, name, kind: "junk", rarity: "common", glyph, value: 1, weight: 0.1, stack: 5, tags: ["noloot", "secret"], description });
const items: ItemDefinition[] = [
  keepsake("cats-eye-charm", "Cat's-Eye Charm", "@", "rare", "A green glass marble on a red thread, from a cat's shrine in the Silk Market. Warm, for glass. Worth nothing to anyone but you."),
  keepsake("memory-tag", "Memory Tag", "&", "epic", "A tag from the Memory Gate with your name on it, in your handwriting. You don't remember writing it. WE WERE HERE AND STILL ARE."),
  keepsake("tin-moon", "Tin Moon", "(", "rare", "A small tin moon on a string, the kind they hang in shop windows in stories. The machine said it had been saving it."),
  {
    id: "cloud-pie", name: "Slice of Cloud Pie", kind: "consumable", rarity: "epic", glyph: "%", value: 90, weight: 0.3, stack: 1, tags: ["noloot", "secret"],
    consumable: { heal: 200, duration: 30, effect: "regen" },
    description: "From the diner above the clouds. Tastes like the first warm day of the year. Mends you slowly for half a minute.",
  },
  { id: "warm-can", name: "Warm Can", kind: "consumable", rarity: "common", glyph: "u", value: 1, weight: 0.3, stack: 5, tags: ["noloot", "secret"], consumable: { heal: 15 }, description: "A can of something, warm. The label says DRINK ME OR DON'T." },
  trinket("fortune-wafer", "Fortune Wafer", "o", "The fortune inside reads: YOU WILL PRESS THAT BUTTON AGAIN."),
  trinket("single-sock", "A Single Sock", "s", "Striped. Its partner is out there somewhere, living its best life."),
  trinket("paper-crane", "Paper Crane", "v", "Folded from a parking ticket. It looks ready to leave."),
  trinket("spare-key", "Spare Key", "k", "It opens nothing in this city. You checked."),
];

// ---- The rain counter -----------------------------------------------------------------------------

const npcs: NpcDefinition[] = [{
  id: "sec-rain-counter", name: "Pell Arden", title: "Counts the rain", district: 3, x: SECRET_SPOTS.rainCounter.x, z: SECRET_SPOTS.rainCounter.z, facing: FACE.south,
  look: look([70, 90, 110], [34, 40, 52], [176, 140, 110], [150, 220, 255], "cap", null, "scan"),
  greeting: ["Shh. Counting."],
}];

// ---- Interactables --------------------------------------------------------------------------------

const at = (spot: keyof typeof SECRET_SPOTS) => SECRET_SPOTS[spot];
const inRoom = (room: string, x: number, z: number) => ({ place: room, ...roomPoint(room, x, z) });
const CHALK = "The pipes sigh and fall quiet. Chalked on the wall, very small: COLD, THEN HOT, THEN STEAM.";
const valve = (id: "cold" | "hot" | "steam", spot: keyof typeof SECRET_SPOTS, step: number, right: string, last = false): InteractableDefinition[] => {
  const ready: Condition = step === 0 ? { not: { flag: SECRET_FLAGS.valveStep, atLeast: 1 } } : flagAt(SECRET_FLAGS.valveStep, step);
  return [
    { id: `sec-valve-${id}`, label: `A valve wheel marked ${id.toUpperCase()}`, ...at(spot), y: 1.6, glyph: id[0], condition: ready,
      effects: [{ setFlag: SECRET_FLAGS.valveStep, value: step + 1 }, ...(last ? [found("valves")] : []), { message: right }] },
    { id: `sec-valve-${id}-wrong`, label: `A valve wheel marked ${id.toUpperCase()}`, ...at(spot), y: 1.6, glyph: id[0], condition: { not: ready },
      effects: [{ setFlag: SECRET_FLAGS.valveStep, value: 0 }, { message: CHALK }] },
  ];
};
const word = (index: number): InteractableDefinition => {
  const spot = (["word1", "word2", "word3", "word4", "word5", "word6"] as const)[index];
  return {
    id: `sec-word-${index + 1}`, label: "Paint, high on the wall", ...at(spot), y: 2.6, glyph: "!", once: true,
    effects: [{ setFlag: SECRET_FLAGS.words[index] }, { message: `Painted high on the wall in careful silver letters: ${GRAFFITI_WORDS[index].word}. A small ${index + 1} beside it, like a page number.` }],
  };
};

const interactables: InteractableDefinition[] = [
  // The three cats, and the shrine one of them leads you to.
  { id: "sec-cat-1", label: "A black cat on a crate", ...at("cat1"), y: 1.1, glyph: "c", once: true,
    effects: [{ setFlag: SECRET_FLAGS.cats[0] }, { message: "The black cat blinks at you, slowly: a cat's hello. It has two cousins in other alleys. They talk." }] },
  { id: "sec-cat-2", label: "A black cat on a crate", ...at("cat2"), y: 1.1, glyph: "c", once: true,
    effects: [{ setFlag: SECRET_FLAGS.cats[1] }, { message: "The black cat sniffs your hand and approves. Somewhere, another cat is waiting for news of you." }] },
  { id: "sec-cat-3", label: "A black cat on a crate", ...at("cat3"), y: 1.1, glyph: "c", once: true,
    effects: [{ setFlag: SECRET_FLAGS.cats[2] }, { message: "The black cat looks at you, then across the avenue, then at you again. If its cousins vouch for you, it will show you the way." }] },
  { id: "sec-shrine-bowl", label: "An offering bowl at a cat shrine", ...at("shrine"), y: 1.3, glyph: "*", once: true, condition: ALL_CATS,
    effects: [{ give: "cats-eye-charm" }, found("cat"), { message: "In the bowl, among the coins: a green glass eye on a red thread. The cat watches you take it, and allows it.", tone: "loot" }] },
  { id: "sec-shrine", label: "A small shrine to a cat", ...at("shrine"), y: 1.3, glyph: "*", condition: { not: ALL_CATS },
    effects: [{ message: "A shrine to a cat, with an offering bowl and a candle. A card reads: SHE COMES WITH FRIENDS OR NOT AT ALL." }] },
  // A payphone that rings on even minutes, a generous machine, a very small door, a drain that answers.
  { id: "sec-payphone", label: "A payphone", ...at("payphone"), y: 1.8, glyph: "P", effects: [{ addFlag: COUNT.calls, by: 1 }], dialogue: "sec.payphone" },
  { id: "sec-vending", label: "FORTUNA (vending machine)", ...at("vending"), y: 1.8, glyph: "V", effects: [{ addFlag: COUNT.vendTotal, by: 1 }, { addFlag: COUNT.vendCycle, by: 1 }], dialogue: "sec.vending" },
  { id: "sec-tiny-door", label: "A very small door", ...at("tinyDoor"), y: 0.9, glyph: "d", effects: [{ addFlag: COUNT.knocks, by: 1 }], dialogue: "sec.tiny-door" },
  { id: "sec-drain", label: "A storm drain", ...at("drain"), y: 0.8, glyph: "o", effects: [{ addFlag: COUNT.shouts, by: 1 }], dialogue: "sec.drain" },
  { id: "sec-cabinet", label: "An unplugged arcade cabinet", ...at("cabinet"), y: 2.2, glyph: "H", dialogue: "sec.cabinet" },
  { id: "sec-lift", label: "A service lift panel", ...at("lift"), y: 1.7, glyph: "#", dialogue: "sec.lift" },
  { id: "sec-lost-found", label: "Lost and Found", ...at("lostFound"), y: 1.6, glyph: "?", effects: [{ addFlag: COUNT.lost, by: 1 }], dialogue: "sec.lost-found" },
  { id: "sec-bench", label: "A brass plaque on a bench", ...at("bench"), y: 1.2, glyph: "=", dialogue: "sec.bench" },
  // Three valves, in the right order.
  ...valve("cold", "valveCold", 0, "COLD turns with a groan. Somewhere deep, a pipe hums one low note."),
  ...valve("hot", "valveHot", 1, "HOT turns. A second note joins the first, a little higher."),
  ...valve("steam", "valveSteam", 2, "STEAM turns. The three notes settle into a chord, and high on the wall a sign you never noticed glows softly awake.", true),
  // WE WERE HERE AND STILL ARE: six words, then a tag at the Memory Gate.
  ...[0, 1, 2, 3, 4, 5].map(word),
  { id: "sec-gate-tag", label: "A blank memory tag on the Memory Gate", ...at("gateTag"), y: 2.2, glyph: "&", once: true, condition: ALL_WORDS,
    effects: [{ give: "memory-tag" }, found("graffiti"), { message: "WE WERE HERE AND STILL ARE. You tie a blank tag to the gate among the thousand others. When you look again, it has your name on it, in your handwriting.", tone: "loot" }] },
  // The Fridge: a note and a pie.
  { id: "sec-diner-note", label: "A note on the counter", ...inRoom("the-fridge", 0.9, -1.85), y: 1.4, glyph: "n", dialogue: "sec.note" },
  { id: "sec-diner-pie", label: "A slice of pie under a glass dome", ...inRoom("the-fridge", -1.3, -1.85), y: 1.6, glyph: "%", once: true, condition: FIVE,
    effects: [{ give: "cloud-pie" }, found("pie"), { message: "The dome lifts. The pie is still warm. A card underneath: FOR THE ONE WHO FOUND ALL FIVE. - THE COOK", tone: "loot" }] },
  { id: "sec-diner-dome", label: "A glass dome", ...inRoom("the-fridge", -1.3, -1.85), y: 1.6, glyph: "%", condition: { all: [{ not: FIVE }, { not: { flag: secretFlag("pie") } }] },
    effects: [{ message: "The dome is fogged from inside and will not lift. A card underneath: FOR THE ONE WHO FINDS ALL FIVE." }] },
  // The Manhole, the Mirror Shop, the Fire Escape, the Still Carriage, the Boarded Door.
  { id: "sec-logbook", label: "A maintenance logbook", ...inRoom("the-manhole", 1.5, -5.15), y: 1.4, glyph: "L", dialogue: "sec.logbook" },
  { id: "sec-mirror-counter", label: "The counter", ...inRoom("the-mirror-shop", -2.3, -2.3), y: 1.5, glyph: "M", dialogue: "sec.mirror" },
  { id: "sec-telescope", label: "A telescope", ...inRoom("the-fire-escape", 2.5, -2.8), y: 1.9, glyph: "T", dialogue: "sec.telescope" },
  { id: "sec-radio", label: "A radio on a crate", ...inRoom("the-fire-escape", -3.6, -1.4), y: 1.2, glyph: "r",
    effects: [{ message: "The radio plays a song you almost know, in a key that doesn't exist yet." }] },
  { id: "sec-chair", label: "A lawn chair", ...inRoom("the-fire-escape", -1.6, -0.9), y: 1.2, glyph: "h",
    effects: [{ message: "You sit in the lawn chair. The city hums below. For a minute, nobody needs anything from you." }] },
  { id: "sec-passenger", label: "The passenger", ...inRoom("the-still-carriage", -5.6, -0.4), y: 1.7, glyph: "?", dialogue: "sec.passenger" },
  { id: "sec-terminal", label: "A terminal", ...inRoom("the-boarded-door", 0, -3), y: 1.7, glyph: "t", dialogue: "sec.credits" },
  { id: "sec-camera", label: "A camera on a tripod", ...inRoom("the-boarded-door", 2.8, 0.1), y: 1.9, glyph: "o",
    effects: [{ message: "Through the viewfinder: this room, from slightly to the left. The frame is labelled agent-secrets.png." }] },
];

// ---- Dialogues ------------------------------------------------------------------------------------

const RINGING: Condition = { flag: SECRET_FLAGS.ringing, is: true };
const dialogues: DialogueDefinition[] = [
  {
    id: "sec.payphone", npc: "sec-payphone",
    entries: [
      { condition: { all: [RINGING, flagAt(COUNT.calls, 1)] }, node: "call-1", priority: 3 },
      { condition: { all: [RINGING, flagAt(COUNT.calls, 2)] }, node: "call-2", priority: 2 },
      { condition: RINGING, node: "call-3", priority: 1 },
      { node: "tone" },
    ],
    nodes: [
      node("call-1", [
        "[You lift the receiver. Rain on the line, then a voice, mid-sentence:]",
        "'...so if you find this, the broth is still on the stove. Turn it down, don't let it boil over. I'll be back for the night market. Tell them I'll be back.'",
        "[The line goes quiet, the way a held breath goes quiet.]",
      ], [bye("Hang up gently.")], [found("payphone")]),
      node("call-2", [
        "[A child's voice, very close to the mouthpiece:]",
        "'Is this the weather? Can you make it stop raining on Thursday? Only Thursday. That's when the kites are.'",
        "[Click.]",
      ], [bye("Hang up.")], [found("payphone")]),
      node("call-3", [
        "[Nobody speaks. Somewhere on the line a radio plays a station that went off the air years ago, and someone hums along, a little flat, very happy.]",
        "[After a while they say, to someone else: 'No, leave it. Somebody's listening.']",
      ], [bye("Listen a moment longer, then hang up.")], [found("payphone"), { setFlag: COUNT.calls, value: 0 }]),
      node("tone", ["[Dial tone. Scratched into the plastic, many times, by many hands: WAIT. IT RINGS EVERY OTHER MINUTE.]"], [LEAVE]),
    ],
  },
  {
    id: "sec.vending", npc: "sec-vending",
    entries: [
      { condition: flagAt(COUNT.vendTotal, 100), node: "thanks", priority: 9 },
      { condition: flagAt(COUNT.vendTotal, 7), node: "rare", priority: 8 },
      ...[2, 3, 4, 5].map(cycle => ({ condition: flagAt(COUNT.vendCycle, cycle), node: `vend-${cycle}` })),
      { node: "vend-1" },
    ],
    nodes: [
      node("vend-1", ["FORTUNA: HELLO. YOU LOOK LIKE YOU NEED A WARM CAN.", "[A warm can rolls into the tray. You did not press anything.]"], [bye("Thank the machine.")], [{ give: "warm-can" }, found("vending")]),
      node("vend-2", ["FORTUNA: TODAY'S FORTUNE IS INSIDE A WAFER. TOMORROW'S IS INSIDE YOU. THAT IS NOT A THREAT."], [bye("Thank the machine.")], [{ give: "fortune-wafer" }, found("vending")]),
      node("vend-3", ["FORTUNA: SOMEONE LEFT THIS IN ME. I THINK IT WANTS TO SEE THE WORLD.", "[A single striped sock drops into the tray.]"], [bye("Thank the machine.")], [{ give: "single-sock" }, found("vending")]),
      node("vend-4", ["FORTUNA: FOLDED IT MYSELF. I HAVE NO HANDS. DO NOT ASK HOW."], [bye("Thank the machine.")], [{ give: "paper-crane" }, found("vending")]),
      node("vend-5", ["FORTUNA: A KEY. I DO NOT KNOW WHAT IT OPENS. NEITHER DOES ANYONE. THAT IS THE FUN OF IT."], [bye("Thank the machine.")], [{ give: "spare-key" }, found("vending"), { setFlag: COUNT.vendCycle, value: 0 }]),
      node("rare", ["FORTUNA: ...", "FORTUNA: I HAVE BEEN SAVING THIS. I THINK IT IS FOR YOU.", "[A small tin moon on a string drops into the tray.]"], [bye("Thank the machine. Properly.")], [{ give: "tin-moon" }, found("vending")]),
      node("thanks", ["FORTUNA: ONE HUNDRED VISITS.", "FORTUNA: NOBODY HAS EVER COME BACK ONE HUNDRED TIMES. THANK YOU.", "[Nothing drops into the tray. The machine just hums, warmly, for a while.]"], [bye("You're welcome.")], [found("vending")]),
    ],
  },
  {
    id: "sec.tiny-door", npc: "sec-tiny-door",
    entries: [{ condition: flagAt(COUNT.knocks, 2), node: "knock-2" }, { condition: { flag: COUNT.knocks, atLeast: 3 }, node: "knock-3" }, { node: "knock-1" }],
    nodes: [
      node("knock-1", ["[You knock. Somewhere very small, someone says: 'Not today, thank you.']"], [bye("Leave them be.")], [found("tiny-door")]),
      node("knock-2", ["[You knock again. A pause. Then: 'We said not today. It is still today.']"], [bye("Fair.")], [found("tiny-door")]),
      node("knock-3", [
        "[The tiny door opens a crack. A tiny hand passes out a cup of tea the size of a thimble, steaming.]",
        "'There. Now go away. Kindly.'",
        "[The door shuts. The tea is excellent.]",
      ], [bye("Thank the door.")], [found("tiny-door"), { setFlag: COUNT.knocks, value: 2 }]),
    ],
  },
  {
    id: "sec.drain", npc: "sec-drain",
    entries: [{ condition: flagAt(COUNT.shouts, 2), node: "drain-2" }, { condition: flagAt(COUNT.shouts, 3), node: "drain-3" }, { condition: { flag: COUNT.shouts, atLeast: 4 }, node: "drain-4" }, { node: "drain-1" }],
    nodes: [
      node("drain-1", ["[You lean over the drain and say hello.]", "[From far below, after a long time: 'hello.' Then, more quietly: 'who is this?']"], [bye("Step back.")], [found("drain")]),
      node("drain-2", ["[You call your name into the drain.]", "[The drain says it back, slowly, as if trying it on.]"], [bye("It suits you both.")], [found("drain")]),
      node("drain-3", ["[You ask the drain how it is.]", "[Below, water moves. 'Wet. Thank you for asking. Nobody asks.']"], [bye("Any time.")], [found("drain")]),
      node("drain-4", ["[You listen at the drain.]", "[Somewhere under the Spillway, someone is singing the numbers station's numbers, softly, like a lullaby.]"], [bye("Let them sing.")], [found("drain"), { setFlag: COUNT.shouts, value: 0 }]),
    ],
  },
  {
    id: "sec.cabinet", npc: "sec-cabinet", entries: [{ node: "scores" }],
    nodes: [node("scores", [
      "[An arcade cabinet, unplugged, still lit. The attract screen cycles the high scores:]",
      "1. YOU ........ 999,999   (dated next Thursday)",
      "2. KOWA SYSTEMS ... 12",
      "3. THE CAT ...... 1",
      "[You have never played this game. Apparently you will.]",
    ], [bye("Make a note: Thursday.")], [found("high-score")])],
  },
  {
    id: "sec.lift", npc: "sec-lift", entries: [{ node: "panel" }],
    nodes: [
      node("panel", ["[A service panel at the foot of the Spire. Buttons for floors 1 to 1209. Below them, one more button, unlabelled. Someone has scratched 1210 beside it.]"], [go("press", "Press it.", "pressed"), LEAVE]),
      node("pressed", [
        "[The button lights. Nothing happens for a long time.]",
        "[Then, very faintly, from somewhere high above: lift music. It is your favourite song. You have never heard it before.]",
      ], [bye("Wait for a lift that isn't coming.")], [found("floor-1210")]),
    ],
  },
  {
    id: "sec.lost-found", npc: "sec-lost-found",
    entries: [...[2, 3, 4, 5].map(visit => ({ condition: flagAt(COUNT.lost, visit), node: `lost-${visit}` })), { condition: { flag: COUNT.lost, atLeast: 6 }, node: "lost-6" }, { node: "lost-1" }],
    nodes: [
      ["One red glove, left hand. Its tag: 'Waved goodbye with the other one. Didn't see them again.'"],
      ["An umbrella with one spoke missing. Its tag: 'Kept three people dry at once on the Rim Line platform, the night the lifts failed.'"],
      ["A cassette, labelled FOR THE NIGHT SHIFT, SIDE B ONLY. Its tag: 'Side A was too sad. We kept the B.'"],
      ["A pair of glasses with no lenses. Its tag: 'Owner says they see fine. Owner just likes the frames.'"],
      ["A house key on a ring shaped like a fish. Its tag: 'The house is gone. The key still turns, if you hold it in the rain.'"],
      ["A note that says I FOUND YOUR NOTE. Its tag: 'We don't know whose note it was. We are holding both.'"],
    ].map((lines, index) => node(`lost-${index + 1}`, ["[Lost and Found. Nobody at the counter. A card by the bell: TAKE ONLY WHAT IS YOURS.]", ...lines], [bye("Leave it for its owner.")],
      index === 5 ? [found("lost-found"), { setFlag: COUNT.lost, value: 0 }] : [found("lost-found")])),
  },
  {
    id: "sec.bench", npc: "sec-bench", entries: [{ node: "plaque" }],
    nodes: [
      node("plaque", ["[A small brass plaque on the bench: FOR MIRA, WHO WAITED HERE EVERY NIGHT. SIT A WHILE.]"], [go("sit", "Sit a while.", "sat"), LEAVE]),
      node("sat", [
        "[You sit. The rain eases, or seems to.]",
        "[Beside you, someone who isn't there says: 'Oh, good. I hate waiting alone.']",
        "[You stay until the koi come up to see who is sitting with Mira.]",
      ], [bye("Stand, slowly.")], [found("bench")]),
    ],
  },
  {
    id: "sec.rain-counter", npc: "sec-rain-counter",
    entries: [{ condition: { not: { flag: secretFlag("rain-counter") } }, node: "first" }, { node: "again" }],
    nodes: [
      node("first", [
        "PELL: Four million, one hundred and six thousand, two hundred and... no. Don't talk. Two hundred and twelve.",
        "PELL: I count the rain in this alley. Someone has to. The city counts everything else.",
      ], [go("why", "Why count the rain?", "why"), go("help", "Can I help?", "help"), LEAVE], [found("rain-counter")]),
      node("why", ["PELL: Because every drop came a long way to land here, and nobody notices them one at a time.", "PELL: Two hundred and thirteen."], [LEAVE]),
      node("help", ["PELL: Take the left side of the alley. Don't count the ones that land on the cat. The cat counts those.", "[You count eleven. Pell writes them down, gravely.]"], [bye("Eleven. You're welcome.")]),
      node("again", ["PELL: Four million, one hundred and nine thousand. It's picking up.", "PELL: Thank you for not interrupting. Mostly."], [LEAVE]),
    ],
  },
  {
    id: "sec.note", npc: "sec-diner-note",
    entries: [{ condition: { not: { flag: SECRET_FLAGS.hunt } }, node: "note" }, { node: "reread" }],
    nodes: [
      node("note", [
        "[A note on a napkin, in pencil:]",
        "'FIVE THINGS IN THIS CITY ARE NOT WHERE THEY SHOULD BE.'",
        "'A train that never leaves. A shop that faces the wrong way. A room under the water. A chair on a roof. A door with nothing behind it.'",
        "'Find all five and the pie is yours. - The Cook (back soon)'",
      ], [{ id: "pocket", label: "Pocket the note.", effects: [{ setFlag: SECRET_FLAGS.hunt }], next: null }]),
      node("reread", [
        "'...a train that never leaves. A shop that faces the wrong way. A room under the water. A chair on a roof. A door with nothing behind it.'",
        "[Under it, smaller: 'The numbers on the towers are letters. The cats know the way. Mind the koi.']",
      ], [LEAVE]),
    ],
  },
  {
    id: "sec.logbook", npc: "sec-logbook", entries: [{ node: "log" }],
    nodes: [node("log", [
      "MAINTENANCE LOG, GALLERY 0.",
      "NIGHT 1: Water level fine.",
      "NIGHT 400: Water level fine. The pipes are humming again. Nice tune.",
      "NIGHT 9,001: Somebody left the numbers station on. It's spelling something. Leaving it on.",
      "NIGHT 9,002: If you're reading this, you can read the numbers. Hello. Mind the third rung.",
    ], [bye("Add a line: 'Hello back.'")])],
  },
  {
    id: "sec.mirror", npc: "sec-mirror-counter",
    entries: [{ condition: { not: { flag: SECRET_FLAGS.reflectionSold } }, node: "offer" }, { node: "after" }],
    nodes: [
      node("offer", [
        "[The keeper leans over the counter and speaks, very politely, backwards:]",
        "'?NOITCELFER RUOY LLES OT EKIL UOY DLUOW'",
        "[In the glass, their reflection says the same thing forwards: 'Would you like to sell your reflection?']",
      ], [
        { id: "sell", label: "Sell your reflection (150 cr).", effects: [{ credits: 150 }, { setFlag: SECRET_FLAGS.reflectionSold }], next: "sold" },
        go("what", "What would you even do with it?", "what"),
        LEAVE,
      ]),
      node("what", ["'.SGNIHT SEOD TI .GNIHTON'", "[The reflection translates: 'Nothing. It does things.']"], [go("back", "Back.", "offer")]),
      node("sold", [
        "[The keeper reaches into the glass in front of you, folds something twice and tucks it into a drawer. They pay you in coins that are warm on one side.]",
        "'!UOY KNAHT'",
        "[When you look at the glass again, the shop is there. You aren't.]",
      ], [bye("Leave, slightly lighter.")]),
      node("after", ["'.KCAB EMOCLEW'", "[In the glass, the keeper's reflection waves. Yours doesn't. You don't have one any more.]"], [LEAVE]),
    ],
  },
  {
    id: "sec.telescope", npc: "sec-telescope", entries: [{ node: "look" }],
    nodes: [node("look", [
      "[You put your eye to the telescope and turn it slowly around the city.]",
      "North: the Meridian Spire's beacon, a pink star that doesn't twinkle.",
      "West: the Ember Core, a coal held in a fist of rings.",
      "East: the Signal Cathedral, breathing static into the cloud.",
      "South: the Afterlight Arcade, small as a lantern. On a roof beside it, someone with a telescope is looking at you.",
      "[They wave. You wave back.]",
    ], [bye("Leave the telescope pointed at them.")])],
  },
  {
    id: "sec.passenger", npc: "sec-passenger",
    entries: [{ condition: { not: { flag: "secrets.passenger-met" } }, node: "ask" }, { node: "again" }],
    nodes: [
      node("ask", ["[An old woman in a good coat, a paper ticket held in both hands.]", "'Excuse me. Is this the last stop?'"], [
        go("yes", "Yes. This is the last stop.", "yes"), go("no", "No. It keeps going.", "no"), go("where", "Where were you going?", "where"),
      ], [{ setFlag: "secrets.passenger-met" }]),
      node("yes", ["'Oh. Then I suppose I should get off.'", "[She doesn't move.]", "'I've been saying that for a while. It's warm in here, and nobody needs anything.'"], [bye("Sit with her for a stop that never comes.")]),
      node("no", ["'Good. I like it here.' [She smooths the ticket on her knee.] 'Wake me when we arrive.'"], [LEAVE]),
      node("where", ["'Home. I forget which one. There were several, and they all had a kettle.'"], [go("back", "Is this the last stop?", "yes"), LEAVE]),
      node("again", ["'Is this the last stop?' [She smiles; she knows you now.] 'Don't answer. I like the asking.'"], [LEAVE]),
    ],
  },
  {
    id: "sec.credits", npc: "sec-terminal", entries: [{ node: "credits" }],
    nodes: [node("credits", [
      "NIGHTFALL // THE STUDIO // BUILD NOTES",
      "Made by the owner, who wanted a city to get lost in, and a lead who kept it standing up.",
      "With SECRETS (the strange bits), INTERIOR (the rooms), CIVILIANS (the people), TRAM (the wheels), ROOFTOP (the skyline), SHADER-STARTUP (the light), MAP (the way), STORY (the voices), GIVERS (the favours), HACKING (the doors) and PERF (the frames).",
      "And you, for looking behind a boarded door. Thank you for playing.",
    ], [bye("Log off.")])],
  },
];

/** The city's secrets (twenty discoveries; city/secrets.ts has the places, the props and the counter). */
export const SECRETS_PACK: ContentPack = { id: "secrets", items, npcs, interactables, dialogues };
