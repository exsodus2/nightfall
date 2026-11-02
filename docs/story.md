# The Rain That Remembers: story bible

Nightfall's main questline. Eleven story quests in five acts, about 60 to 90 minutes, through all six districts. Code: `src/rpg/content/main-common.ts` (ids, flags, positions, items) and `main-act1.ts` to `main-act5.ts` (one pack per act), registered through `main-questline.ts`. Tests: `tests/main-questline.test.ts`.

## Premise

Nightfall never stops raining, because the Meridian Spire's climate array makes the weather.

Six years ago the array was switched on for the first time. It wanted more power than the Ember Core could spare, so the Meridian board sent it the Core's reserve: the reserve that ran the Spillway Barrier's pumps. At ten past one the pumps stopped. At twenty past, the sea came in. Three hundred and twelve people were never found. The inquiry said "act of God". Everyone calls it the Flood.

Dr. Odessa Crane, director of Meridian Climate, built that array. Her daughter Iris was one of the 312. Afterwards Crane bought back everything the missing left behind: phones dredged from the harbour, last calls on dead servers, voicemails nobody answered. Each person became a "lot", a master drive. The lots come in on the container ship Nami Maru, go by Rim Line flatcar to a CorpSec bonded shed at Spillway Locks, and then to Kiln Nine, where the night engineer Bet Kowalczyk built the Loom: a machine that weaves each lot into the array's seeding signal, powered by the Ember Core through a trunk line marked CLIMATE. Every raindrop that hits an antenna carries a sliver. That is the static in every sign and radio in the city: the missing, and every call made to them, too scrambled to understand.

Meridian paid for it because the same signal jams the pirate stations. Crane hid an archive inside a jammer. Nobody consented.

The player is a new courier for Dead Letter Exchange. One lot, Lot 77 (Jonah Ashby, crane operator), fell into a Silk Harbour sorting net and was posted to his last address. It is the parcel nobody will carry.

## Writing rules

Every line in the questline obeys these. New content that touches the story should too.

1. **Who, what, where.** Every quest title, journal entry and objective says plainly who you are helping, what to do and where (a named place from `places.ts`, a venue, or a district plus a landmark), in one or two sentences. A player who reads only the journal can complete the stage. (Tested: every visible objective names a place; every stage journal is one or two sentences, not counting a parenthetical hint.)
2. **Short, in character, answering the obvious.** Dialogue lines are one to three sentences, in the speaker's voice, and answer the obvious questions ("why me?", "what's in it for me?"). No jargon without a payoff in the same scene, and no references to things the player cannot find.
3. **Consistent voices and spellings.** Each named character has a one-line voice note below and keeps it. Names and places are spelled identically everywhere (see the lists below, `cast.ts` and `places.ts`).
4. **Real choices.** At least two endings per act with visible consequences: reputation (factions in `factions.ts`), an item, a changed NPC line, or a world flag. The final choice decides the city's state.
5. **Dry noir, warm underneath.** No gore, no slurs, no real brands. Printable ASCII only, and no dashes standing in for punctuation (tested).

## Cast and voices

New characters (all stand on pavements or forecourts, at least 7 m off the carriageway and 6 m from anyone else; tested):

| Character | Where | Voice |
|---|---|---|
| **Tilly Marsh**, Dead Letter dispatcher (`tilly-marsh`) | Silk Market avenue, east side, just east of spawn | Brisk, counts everything, treats a parcel as a promise; kind under the clipboard. |
| **Nell Ashby**, Jonah's mother (`nell-ashby`) | Silk Market, on a folding chair across Lantern Row from number 9 | Dry, patient, jokes so as not to cry; talks about Jonah in the present tense. |
| **Moth**, Station Nobody (`moth-nobody`) | Ghost Circuit, the pavement beside Ghost Circuit station | Soft, nocturnal, curious; radio sign-offs ("Copy.", "Over."). |
| **Ruben Salgado**, Silk Harbour dock boss (`ruben-salgado`) | Silk Harbour quay, west of Silk Harbour station | Genial, transactional, never raises his voice; carries Jonah like a debt. |
| **Lt. Dace Morrow**, CorpSec checkpoint (`dace-morrow`) | Spillway Locks station forecourt | Polite, tired, procedural; wants a reason he can write down and one quiet night. |
| **Bet Kowalczyk**, Kiln Nine night engineer (`bet-kowalczyk`) | The Foundry, outside Kiln Nine | Blunt, proud of her work, guilty about it; talks in specs. |
| **Dr. Odessa Crane**, Meridian Climate director (`odessa-crane`) | Rain Gardens, by the Last Tree | Precise, calm, grieving; never apologises, explains. |

Existing characters the questline uses (their own files own their positions and other lines):

| Character | Role here | Voice (as established) |
|---|---|---|
| **Agnes Pell**, lockkeeper (`pell`, `rim-line.ts`) | Optional: tells what really caused the Flood (Act 3) | Thirty years on the gates; blunt, deaf in the left ear. |
| **Tomas Okafor**, furnace keeper (`tomas`, `npcs.ts`) | Tells what the CLIMATE trunk did (Act 4); post-game lines | Gruff; listens to machines more than people. |
| **Juno Reyes**, signal runner (`juno`, `npcs.ts`) | Optional word before the finale; post-game lines | Laconic; logs every feed that goes dead. |

Mentioned but not met: Jonah Ashby (crane four, Lot 77), Iris Crane (Lot 1).

## Places (canonical spellings)

Silk Market, 9 Lantern Row (the first street west of the Silk Market avenue), Dead Letter Exchange, Ghost Circuit station, the Signal Cathedral, weather relay GC-4 (across the street from the Cathedral's east wall), Silk Harbour, the Nami Maru, Low Tide Gate, Spillway Locks, the bonded shed, Kiln Nine, the Foreman's scrapyard, the Ember Core, the CLIMATE breaker, the Rain Gardens, the Last Tree, the Meridian Spire, the climate annex (at the Spire's foot), Neon Ward.

## World flags

| Flag | Values | Set by |
|---|---|---|
| `rain.nell` | `held`, `sealed` | Act 1: let Nell hold the drive, or courier rules |
| `rain.drive` | `logged`, `off-book` | Act 1: log the drive at Dead Letter or not |
| `rain.moth` | `aired`, `held` | Act 2: Station Nobody broadcasts Nell's voicemail or holds it |
| `rain.window` | `played`, `told` | Act 2: Nell hears the tape, or only the news |
| `rain.flood-truth` | `true` | Act 3, optional: Agnes Pell's account of the Flood |
| `rain.shipment` | `burned`, `through` | Act 3: burn the Nami Maru lots, or let them go to Kiln Nine |
| `rain.governor` | `fitted`, `kept` | Act 4: the Loom's governor back to Bet, or kept |
| `rain.trunk` | `cut`, `tapped` | Act 4: throw the CLIMATE breaker, or clip in Moth's tap |
| `rain.lantern` | `true` | Act 5: you lit a lantern for Iris with Crane |
| `rain.ending` | `released`, `burned`, `returned` | Act 5: **the city's state** |

## Act 1: Return to Sender (Silk Market, Ghost Circuit)

**1. The Undeliverable** (giver Tilly Marsh; level 1; 120 or 180 cr, 150 XP)
- Tilly hands over the wet drive (Lot 77) for Jonah Ashby, 9 Lantern Row. Why you: the regulars took one sniff and said no.
- Knock at 9 Lantern Row: boarded, CONDEMNED AFTER THE FLOOD.
- Nell Ashby, across the street, is Jonah's mother. **Choice:** let her hold it (she gives you Jonah's key "for whoever is writing to him"; +5 Civilians) or keep it sealed (courier rules; Tilly pays a 60 cr bonus).
- Report to Tilly. The label is a lot code, not a postmark.

**2. Return to Sender** (giver Tilly; level 2; 150 cr, 300 XP)
- Inside Dead Letter Exchange, the lot reader (left-hand machine) prints: LOT 77 / ASHBY, JONAH / ARCHIVE: RAINFALL / CUSTODIAN: O. CRANE, MERIDIAN CLIMATE / ARRIVED ON: NAMI MARU. The drive plays static; every dead radio in the room hisses along; a man laughs.
- **Choice:** log it (a courier number: +3 Civilians, and later +1 at the relay and +2 at Morrow's checkpoint) or keep it off the books (+5 Ghosts).
- The receipt (or a scratched note) points to Moth. She hears the drive: "Your drive and the rain are reading from the same page."
- **Act image:** under the hiss a man laughs, and every sign on the Ghost Circuit flickers in time.

## Act 2: Station Nobody (Ghost Circuit, Silk Market, Silk Harbour)

**3. Station Nobody** (giver Moth; level 3; 250 cr, 600 XP)
- Moth needs Meridian's carrier key card from weather relay GC-4. The relay is the questline's **terminal break-in**: the cabinet itself runs the hacking minigame (a medium-tier breach; success takes the key quietly), and the service hatch beside it keeps the old ways in: work the maintenance port (TECH 3, +1 if logged; a failure costs nothing and offers retry) or pry it open (tamper alarm, a Meridian response team, -5 CorpSec). A failed or locked-out hack leaves the hatch.
- Moth decodes. **The first voice is Nell Ashby**, whom the player has met: "Jonah, love, it's Mum. The water's at the step. I've left the light on." The rain carries the missing and every call nobody answered. The header names RAINFALL, 312 lots, the Nami Maru, Kiln Nine, the Spire and O. Crane. The drive is a master copy; it only plays where it was made.
- **Choice:** Moth airs Nell's voicemail on every pirate band (+8 Civilians, -8 CorpSec; Morrow's checkpoint is on alert, -1 on the cool check) or holds it (+6 Ghosts). Either way you get the tape and Moth's clip-on tap.
- **Act image (aired):** people stop under the Ghost Circuit's signs to listen. (Held): Moth switches off, the rain goes back to hissing.

**4. Light in the Window** (giver Nell; level 3; 100 cr, 400 XP)
- **Choice:** play Nell the tape, or tell her plainly. Her later lines differ.
- Jonah ran crane four at Silk Harbour the night of the Flood, unloading the Nami Maru. Ruben Salgado ran the crew and "paid for a funeral with nobody in it".
- Ruben: "I sent him up the high gantry at one in the morning because the ship was late and Meridian pays by the hour."
- **Act image:** Ruben watches the Nami Maru's lights. "She came back without him. She always comes back."

## Act 3: Nami Maru (Silk Harbour, The Spillway)

**5. Harbour Manifest** (giver Ruben; level 4; 800 XP)
- Forty sealed crates come off the Nami Maru every night, stencilled CALIBRATION SENSORS, CLIMATE. **Choice:** win back Ruben's manifest book from the Low Tide Gate dock crew (the street encounter at Low Tide Gate; 300 cr, +10 Dock crew) or pay the 200 cr dock fee (+3 Dock crew).
- The manifest: every night at four the crates go by Rim Line flatcar to a CorpSec bonded shed at Spillway Locks, signed for by Lt. Dace Morrow.

**6. The Bonded Shed** (giver Ruben; level 5; 400 cr, 1200 XP)
- Morrow's checkpoint: COOL 4 as a climate courier (+2 if logged, -1 if Moth aired), STREET 4 as Ruben's man (+2 with Dock crew 10+), a 300 cr bribe, or go through his squad (he folds his arms: "Not paid enough for this."). A failed check costs nothing.
- Optional: Agnes Pell tells what caused the Flood (sets `rain.flood-truth`; Tomas then says "Agnes Pell's told you already").
- Inside the shed: forty drives, each a name. LOT 114: VANCE, MILLIE, AGE 9. **Choice:** burn the shipment (-15 CorpSec, +5 Dock crew; those forty voices are gone) or let it through (+5 Civilians; required for the quiet ending).
- **Act image (burned):** the shed burns blue and for one second the rain over the Spillway stops. (Through): the flatcar takes the crates west; one of them is humming.

## Act 4: The Loom (The Foundry)

**7. What Kiln Nine Built** (giver Bet; level 6; 500 cr, 1800 XP)
- Bet greets you by what you did at the shed (a hungry Loom listens to the street; a fed one grows).
- Inside Kiln Nine: the Loom, forty warm drive bays, the governor slot empty.
- The Foreman (the Foundry street boss) stole the governor, which keeps the Loom on the archive and off the living. Beat him in his scrapyard.
- **Choice:** give Bet the governor (she gives you the **Lot Index**, every name and the door it belongs to; +5 Civilians) or keep it (an epic part worth 1200 cr; the Loom stays cold).

**8. The Ember Trunk** (giver Bet; level 6; 300 cr, 1000 XP)
- Tomas Okafor at the Ember Core: the night of the Flood, the board sent the Core's reserve up the CLIMATE trunk to the new array, and the Barrier pumps stopped.
- **Choice** at the yellow CLIMATE breaker east of the Core: throw it (+5 Civilians, -10 CorpSec) or clip in Moth's tap (+8 Ghosts).
- **Act image (cut):** for an hour it stops raining over the Foundry; people come out of doorways and look up. (Tapped): a green light, and Moth: "Every sign in the city, whenever you want it."

## Act 5: The Rain That Remembers (Rain Gardens, Neon Ward, Silk Market)

**9. Lanterns for Iris** (starts when Act 4 ends; level 7; 600 XP)
- Dr. Crane at the Last Tree: "My array caused the Flood, and the Flood took my daughter, Iris. There. Now you don't have to work it out." "It isn't consent. I know. Neither was the Flood."
- With Lot 77 in your pocket she knows it by heart: "Ma, I'm on the high gantry, don't wait up. I'll bring breakfast." Then the wind.
- **Choice:** light a lantern with her for Iris, or accuse her ("Meridian wanted a jammer. You built it out of the dead."). Either way: "Come to the Spire."

**10. The Rain That Remembers** (starts when Act 5's first quest ends; level 8; 1500 cr, 4000 XP)
- Optional: Juno Reyes under the Spire: "Whoever's at that annex lectern is about to say something to the whole city. Make it worth hearing."
- At the climate annex lectern, the final choice (`rain.ending`):
  - **Release** (+15 Civilians, +10 Ghosts, -20 CorpSec): every sign, radio and ad screen speaks with the missing, clearly, for as long as it rains. Crane: "Iris. There you are."
  - **Burn** (+10 CorpSec, +5 Civilians): Crane presses the key herself. The hiss thins to nothing; the rain is only rain. It is very quiet.
  - **Send them home** (earned: Bet's Lot Index and the Nami Maru lots unburned; shown greyed with that reason otherwise; +20 Civilians, +5 Ghosts): the archive goes to Dead Letter Exchange, one letter per family. Tomorrow there will be a queue in the rain, everyone holding a ticket with a name on it.

**11. Last Delivery** (starts at once; level 8; 200 cr, 500 XP)
- Nell, by ending: she heard Jonah from the bus-stop timetable screen (released); the signs went quiet and she misses them (burned); a letter from the Exchange said the master copy was with the courier (returned). Give her the drive, and Jonah's key back if she gave it to you; she hangs it by the boarded door and sets a lamp in the window.
- Tilly stamps Lot 77 DELIVERED and pins it to the top of her board. "Some letters you deliver. Some you just carry until you can."
- **Final image:** it is still raining in Nightfall. (Released) Now everyone knows what it says. (Burned) The rain doesn't say anything at all. (Returned) The queue at Dead Letter will be round the block.

## Consequences at a glance

| Earlier choice | Where it shows |
|---|---|
| Nell held the drive | Jonah's key (given back in the epilogue); Nell's lines |
| Drive logged | +1 TECH at the relay, +2 COOL at Morrow's checkpoint |
| Moth aired | -1 COOL at the checkpoint; Moth's lines |
| Dock crew 10+ (Ruben's favour) | +2 STREET at the checkpoint |
| Flood truth from Pell | Tomas's Act 4 lines |
| Shipment burned | Bet's greeting; the quiet ending is closed |
| Governor fitted | Lot Index (needed for the quiet ending) |
| Governor kept | You keep a 1200 cr part; the quiet ending is closed |
| `rain.ending` | Post-game lines for Tilly, Nell, Moth, Ruben, Morrow, Bet, Crane, Juno and Tomas |

## Notes for the next writer

- **The relay is wired to the hacking minigame.** `rain-relay` in `main-act2.ts` carries `hack: { kind: "terminal", tier: "medium", district: 2 }`; a successful breach applies the same effects as the dialogue's `port-open` node. The dialogue (TECH check, pry) lives on `rain-relay-hatch` next to it, so nothing dead-ends.
- **The Hollow Choir** (`story-hush.ts`, starting from Mara Voss) is a separate, earlier storyline about stolen voices under the Last Tree. Both mention the Flood; neither depends on the other. Post-game lines on shared characters (Juno, Tomas) defer to the Hollow Choir's lines when both apply.
- Positions live in `SPOTS` (`main-common.ts`). Move one there and the placement test re-checks it.
- Every quest pays once, every stage can be retried (failed checks loop back, fights respawn or have an empty-yard fallback), and progress lives in quest stages and the flags above, so saves restore mid-act.
