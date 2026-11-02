# Quest text audit (existing content, 2026-10-22)

Scope: every quest that existed before this sprint. Each one was read the way a player meets it:
offer, journal entries, objectives, choices and endings. The rules applied:

1. The journal entry alone says who, what and where (a named place, district or landmark).
2. The offer answers "why me" and "what do I get", and mentions only things that exist.
3. Names and places are spelled as in `cast.ts`, `npcs.ts` and `world.ts`.
4. There are no dangling threads, and every choice says what it chooses.

Ids, stages, flags, rewards and logic are unchanged. Only text and coordinates moved.
Placement is enforced by `tests/quest-giver-placement.test.ts`.

## Catalogue

| Quest (id) | File | Giver | Place | Premise | What changed |
|---|---|---|---|---|---|
| The Relay Chip (`relay-chip`) | `src/city/quests.ts`, `npcs.ts` | Mara Voss | Silk Market avenue to the Meridian Spire | Fetch a sealed chip from Juno Reyes | The summary now names Mara and the Spire. Mara was on the z = 64 crossing and Juno was on a corner landing; both moved onto the pavement. |
| Dead Air (`dead-air`) | `story-hush.ts` | Mara Voss | Memory Gate, Silk Market | Lark lost her voice; three lamp taps lead to "K" | The pups' corner tap is north-east of the gate, not east (Lark's gesture fixed too). The journals name the Memory Gate and Mara. The corner tap was in the road and moved to the kerb by its lamp. The gate tap was moved 3 m from Lark. |
| The Signal Cathedral (`signal-cathedral`) | `story-hush.ts` | Juno Reyes | Signal Cathedral, Ghost Circuit | Read the uplink routing table | The uplink console is on the cathedral's north-east side, not the west. The first journal says who wants the table. The endings say what Juno knew. Ferro's waypoint follows his new spot. |
| Root Access (`root-access`) | `story-hush.ts` | Tomas Okafor | Kade's workshop, Foundry; Rootwood Park | Search Kade's burned workshop, get Wren's seal | Directions corrected: the workshop is two streets east and two south of the Core, not "one south". Wren is "by the Last Tree in Rootwood Park". |
| The Hollow Choir (`hollow-choir`) | `story-hush.ts`, `places.ts` | Sister Wren | Stone circle south of the Last Tree | Boss: Vesper Kade and the Hush Seed | **Premise fix.** The arena moved to park.ts's pillared stone circle, 60 m south of the Tree. The text still said "under the Tree" and "the gate on the Tree's north side". All of it now says "the stone circle south of the Last Tree, where its roots surface", with the gate on the circle's north side. The ARENA label is now "Rootwood Park - the stone circle". |
| Out of Order (`out-of-order`) | `out-of-order.ts` | VENDETTA (machine) | Neon Ward avenue, just north of the Silk Market | A vending machine's three strike demands | The first journal says who and where. The endings name the machine and the avenue. |
| Wanted: Petrov / Okonkwo-9 / Mirror / Cinder (`bounty-*`) | `bounty-board.ts` | Sable Quist (board) | Four junctions | Repeatable bounty marks | Every "last seen" was checked against the encounter. Petrov's "Razorback corner" is now a real description. Okonkwo is three blocks west of the Spire, not two south-west. Mirror is north of Nix, not south-west. Cinder is south-east of the Ember Core, not north-east. The hunt journal names Sable's board and the pay. |
| Cloudy, Chance of Murder (`weatherman`) | `weatherman.ts` | Mama Kestrel | Behind the Afterlight Arcade, Spillway | Dex the weatherman faked his death | The van, puddle, ledger and casings were on the carriageway and moved to the pavement. The accuse and confront journals name Kestrel, Nimbus and the Arcade. The endings say what you did. The offer adds why you and that she pays. |
| Night Witness (`witness`) | `witness.ts` | Imani Harrow | Crossing two blocks west of the avenue, south Neon Ward | Keep Ines Pardo alive until the cab | The first journal names Harrow's witness. "Transport" is now "cab" everywhere. The offer adds why you and 450 cr. The endings say Ines reached court. Harrow's hub now says "the paymaster's" phone instead of "the spotter's". |
| Quiet Money (`quiet-money`) | `quiet-money.ts` | Nix | CorpSec data cradle north of the Spire | Payroll core heist, then Nix or Sarr | The breach journal says who and where. The deliver journal locates Nix (west edge of Ghost Circuit, due east of the Spire) and Sarr (checkpoint south of the Spire). The old "thirty metres away" was false. The offer adds why you and the pay. |
| Cold Chain (`cold-chain`) | `cold-chain.ts` | Dr. Juniper Vale | Rain Gardens clinic to the Ember Core | Timed lung delivery | The first journal names Juniper. The offer adds why you and the pay. |
| Hold the Ember (`ember-core`) | `ember-core.ts` | Tomas Okafor | Ember Core plaza, Foundry | Three Razorback waves | The wave journals name the Core and the station. The wave-3 survive objective said "while the Core vents", but the Core only vents if you fail. It now reads "Hold the Ember Core plaza for 45 seconds". The offer adds the pay. |
| Tusk Tax (`tusk-tax`) | `tusk-tax.ts` | Mama Kestrel | Gristle's corner, north-west of the Afterlight Arcade | Three-round negotiation | Gristle stood exactly on the crossing landing and moved 4 m along his corner; the waypoint and target follow him. The brawl journal names the place, the endings say what happened, and the offer adds the pay. |
| Borrowed Light (`borrowed-light`) | `night-shift.ts` | Mira Bell | Blue Hour, Second Life, Kiln Nine, Glasshouse | Grow-light coil relay | "The grower" is now Neri, who is named in the Glasshouse and Dead Letter jobs. |
| Small Hours Signal (`small-hours-signal`) | `night-shift.ts` | Mira Bell | Undertone, Dead Letter, Blue Hour | Build the night-shift radio channel | No change. |
| Ground Before Glow (`kiln-calibration`) | `kiln-workbench.ts` | (bench) | Kiln Nine, Foundry | Calibrate a shield cell | The first journal says whose cell it is and where it is. |
| Last Good Signal (`last-good-signal`) | `dead-letter.ts` | (desk) | Dead Letter Exchange, Ghost Circuit | Verify and post a flood notice | The first journal says where you are and why. |
| A Little Night (`a-little-night`) | `glasshouse.ts` | (Neri's board) | The Glasshouse, Rain Gardens | Tend two trays, reset the lamp | No change. |
| The Space Between (`the-space-between`) | `undertone.ts` | (last-set book) | Undertone, Neon Ward | Fill the closing DJ's cue card | The first journal names Oto and the venue. |
| Last Set Before Curfew (`last-set-before-curfew`) | `the-static.ts` | (Nova's decks) | The Static, Neon Ward | Recover three tracks, pick the closer | No change. |
| Brine Run (`brine-run`) | `rim-line.ts` | Salt Duarte | Silk Harbour, crane yard, Spillway Locks | Carry membranes to Agnes Pell | Pell was in the z = 0 cross street and moved 2.5 m onto the pavement; her waypoint follows. |
| Mast Tap (`mast-tap`) | `rim-line.ts` | Wick | Signal Pier and the north-east mast yard | Tap CorpSec's harbour mast | The offer adds why you and 320 cr. |
| The Floodgate Lift (`floodgate-lift`) | `rim-line.ts` | Odile Fenn | Floodgate culvert | Find the missing engineer Hollis Kemp | Odile was in the avenue carriageway and Hollis was tied up in the road; both moved to the pavement. The Hollis journal says who he is and where. The offer adds the pay. |
| Lantern Walk (`lantern-walk`) | `rootwood.ts` | Billie Achterberg | Lantern Walk, Rootwood Park | Recover stolen lantern coils | The journals name Lantern Walk and the park. The offer adds the pay. |
| Survey Stakes (`survey-stakes`) | `rootwood.ts` | Billie Achterberg | Pond steps, Koi Gate, Moth Lamp, south lawn | Pull Meridian's stakes, handle the surveyor | The offer adds the pay. |
| Glass on the Stack (`stack-relay`) | `cold-iron.ts` | Brakka Venn | Furnace stack yard north of Foundry Gate | Clear a Ghost relay | Brakka was in the cross street and moved onto the pavement. |
| Two Ledgers (`two-ledgers`) | `cold-iron.ts` | Nix | Foundry toll junction | Steal Kettle's toll book | No change. |
| Cold Iron (`cold-iron`) | `cold-iron.ts` | (follows Two Ledgers) | Furnace stack yard | Break Kettle's meet and decide his fate | Nix is south-west of the Signal Cathedral, not north-west. His brief now says "west edge of the Ghost Circuit, due east of the Meridian Spire". |

## Givers moved off the road

| NPC | Was | Now | Why |
|---|---|---|---|
| Mara Voss | 14.5, 60 | 18, 55 | In the z = 64 carriageway at the avenue corner |
| Juno Reyes | 15, -137 | 16, -139.5 | On the corner crossing landing |
| Sable Quist | -14.5, 64 | -18, 55 | On the z = 64 centre line |
| Lark | 14.5, 194 | 17, 200.5 | In the z = 192 carriageway; still under her lamp at the Memory Gate |
| Imani Harrow | -14.5, -60 | -18, -56 | In the z = -64 carriageway |
| Adjutant Sarr | 56, -134 | 54, -136.5 | In the z = -128 carriageway |
| Deacon Ferro | 458, -262 | 459, -265 | In the z = -256 carriageway |
| Dr. Juniper Vale | -376.8, 200 | -373.5, 201 | On the corner crossing landing |
| Mama Kestrel | 458, 262 | 459, 266 | In the z = 256 carriageway |
| Mr. Nimbus | 504, 262 | 502, 266 | In the z = 256 carriageway |
| Gristle | 391.2, 184.8 | 392, 181 | Exactly on the corner crossing landing |
| Odile Fenn | 12, 750 | 16, 748 | In the avenue carriageway |
| Agnes Pell | 748, -6 | 748, -8.5 | In the z = 0 carriageway |
| Brakka Venn | -748, -646 | -748, -648.5 | In the z = -640 carriageway |

Objects moved: the corner lamp tap (72.2, 133 to 72.5, 136.5) and the gate lamp tap (15.2, 201 to
15, 203.5). The four weatherman clues each moved 1.5 to 5.5 m onto the pavement around the Arcade
block. Hollis Kemp moved from -756, 66 to -756, 72.
