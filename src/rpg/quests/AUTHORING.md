# Writing quests for Nightfall

Quests, dialogue and interactable objects are **plain data** in a `ContentPack`
(types in `src/rpg/types.ts`). You never touch engine code to add one. Write the
data, register the pack, and run `validateContent` on it. The validator finds
typos, dead ends and objectives that can never complete.

```ts
import { validateContent } from "../quests/index.ts";
assert.deepEqual(validateContent(MY_PACK, [ITEMS_PACK, COMBAT_PACK]), []); // put this in a test
```

The second argument lists other packs that references resolve against (the item
database, enemy archetypes, encounters from other packs). The city's standing
NPCs (`src/city/npcs.ts`) are always known. Item and archetype ids are only
checked when at least one item or archetype is known.

## The pieces

| Piece | What it is |
|---|---|
| `QuestDefinition2` | A quest: stages, outcomes, who gives it, what unlocks it. |
| `QuestStage` | One step of the journal. It is done when its objectives are done. |
| `Objective` | One thing to do: talk, kill, clear, collect, deliver, reach, interact, survive, choose, condition. |
| `QuestOutcome` | One way the quest can end, with its own rewards and consequences. |
| `DialogueDefinition` | A conversation tree for one NPC (or one interactable). |
| `InteractableDefinition` | A world object the player presses E on. |
| `EncounterDefinition` | A group of enemies (combat owns these; quests spawn them and count their kills). |
| `Condition` / `Effect` | The shared language for "is this true?" and "make this happen". |

## Quests

```ts
{
  id: "chrome-and-bone",             // unique, kebab-case
  title: "Chrome and Bone",
  category: "story",                 // story | side | contract | gig
  giver: "sable",                    // NPC id, or null (started by a trigger area or an effect)
  summary: "...",                    // offer text when there is no authored dialogue
  requires: { quest: "intro" },      // optional unlock condition
  rewardHint: "~300 cr, reputation", recommendedLevel: 3,
  start: "find",                     // first stage id
  stages: [ ... ],
  outcomes: { mercy: { ... }, blood: { ... } },
  trigger: { x, z, radius },         // optional: auto-start when the player walks in (gigs)
  repeatable: { cooldown: 600 },     // optional: offered again 600 game-seconds after it ends
  onFail: [ ...effects ],            // optional: consequences of failing
}
```

**Stages** run one at a time.

- `objectives`: in `mode: "all"` (the default) every objective without `optional` must be done. In `mode: "any"` the first required objective that gets done wins. Use `"any"` when a stage has several solutions (sneak in, bribe the guard, or find the hidden tunnel).
- `optional: true`: shown in the checklist as optional and never blocks the stage.
- `hidden: true`: not shown until it is done. Use it for secret solutions.
- `target: { x, z }`: where the tracker arrow points. It is inferred for talk, deliver and choose objectives (the NPC), interact (the object), reach and survive (the area), and clear and kill with an `encounter` (the encounter area). Give `collect` and `condition` objectives a `target`, or the tracker has nothing to point at.
- `next`: the next stage id. It can also be a list of branches, `[{ if: cond, stage }, ..., { stage }]`, where the first branch whose condition holds is taken. **Always end the list with a branch that has no `if`.** Leave `next` out to end the quest.
- `onEnter` / `onComplete`: effects. The usual way to end a quest is `onComplete: [{ outcome: "mercy" }]`. If the quest has exactly one outcome, an ending stage uses it automatically.
- `timeLimit` (seconds) + `onTimeout` (stage id): when time runs out, the quest jumps to `onTimeout`. Without `onTimeout`, the quest fails.
- `failIf`: a condition that fails the quest while it holds (for example, the VIP died).
- `failOnDeath: true`: dying during this stage fails the quest.

A stage with **no objectives** completes the moment it is entered. Use one as a router stage that only branches or pays out.

### Objective kinds

| kind | done when |
|---|---|
| `talk { npc }` | The player opens a conversation with the NPC. |
| `kill { count, archetype?, faction?, tag?, encounter? }` | `count` matching `killed` events arrive (kills by the player, or any kill in the named encounter). |
| `clear { encounter }` | The encounter is cleared. |
| `collect { item, count }` | The player **holds** `count` of the item. This is checked live, so dropping the item un-does the objective. |
| `deliver { item, count, npc }` | The player picks "Hand over ..." when talking to the NPC. The items are taken at that moment. |
| `reach { area }` | The player stands inside the circle. |
| `interact { object }` | The player uses the interactable. |
| `survive { seconds, area? }` | The player stays alive for that many seconds (inside the area if one is given). Leaving the area pauses the timer. Dying resets it. |
| `choose { dialogue, options }` | The player picks one of those option ids in that dialogue. |
| `condition { condition }` | The condition holds (checked live). |

Every finished objective sets the flag **`<questId>.<objectiveId>`**: `true`, or,
for `choose`, the id of the option picked. Branch on it:
`{ if: { flag: "chrome-and-bone.verdict", is: "spare" }, stage: "report-mercy" }`.

### Outcomes and unlocking

`outcomes` maps ids to `{ title, journal, effects }`. The title is shown in the
log. The journal is the closing line. The effects are the rewards and
consequences: credits, xp, reputation, items and flags.

Later content can check how a quest ended:

- `{ quest: "chrome-and-bone" }`: the quest was completed, by any outcome.
- `{ quest: "chrome-and-bone", outcome: "mercy" }`: it ever ended with this outcome. This also works for repeatables.
- `{ quest: "chrome-and-bone", stage: "decide" }`: the quest is in this stage right now.
- `{ quest: "x", status: ["active", "complete"] }`: the quest has any of the listed statuses.

## Dialogue

```ts
{
  id: "cab.rook", npc: "rook",          // npc: an NPC id or an interactable id
  quest: "chrome-and-bone",             // bare `stage` / `outcome` effects in here refer to this quest
  entries: [                            // where the conversation opens
    { condition: { quest: "chrome-and-bone", stage: "find" }, node: "ask", priority: 10 },
  ],
  nodes: [
    { id: "ask", lines: ["..."], effects: [], options: [
      { id: "pay",  label: "Pay 50 cr", condition: { credits: 50 }, effects: [{ credits: -50 }], next: "told" },
      { id: "lean", label: "Lean on him", next: null,
        check: { stat: "street", difficulty: 4, success: "cracks", failure: "clams-up",
                 bonus: [{ if: { rep: "razorbacks", atMost: -10 }, by: 2, label: "Razorbacks hate you" }] } },
      { id: "leave", label: "Leave", next: null },
    ] },
  ],
}
```

- **Which dialogue opens:** all dialogues for the NPC are pooled. Entries that have a condition are tried before entries without one, then by higher `priority`, then in the order they are written. If no entry matches, the engine falls back as follows: it offers the NPC's quests (see below), reminds the player of the NPC's running quest, thanks them for a finished one, or uses the NPC's `greeting`.
- **Unavailable options:** an option whose `condition` fails is shown **greyed out with a reason**, such as "Requires 50 cr" or "Requires level 5". Set `reason: "..."` to write your own reason, which is best for flag conditions. They otherwise only say "Not available yet". Set `hideIfUnavailable: true` for secrets.
- **Stat checks:** checks are deterministic, with no dice. The check passes when `stat + bonuses >= difficulty`. The label shows both numbers up front ("Lean on him [STREET 4/4]"), so the player always knows what will happen. A failure node should offer another way forward, such as paying, fighting or leaving.
- `next: null` ends the conversation. Option effects run first, then the choice is reported (so a `choose` objective's branch sees the flags those effects set), then the next node opens.
- **Node `effects` run every time the node is shown.** Put one-time rewards on options, or guard them with a flag.
- `kind` sets the option's style (accept / decline / complete / continue / leave). When you leave it out, the kind is inferred: an option with a `startQuest` effect is accept, an option with an `outcome` effect is complete, and a bare `next: null` option is leave.
- Option ids starting with `@` are reserved: the engine adds its own options (`@deliver:...`, `@offer:...`, `@accept:...`, `@leave`).

**Offers without writing dialogue:** if a quest has a `giver`, and no dialogue for
that NPC contains `{ startQuest: <id> }`, the engine writes the offer itself. It
uses the NPC's `quests[id].offer` lines, or `summary` + `rewardHint`, with
Accept and Decline options. If the NPC also has authored dialogue, the engine
adds an "Ask about work: <title>" option instead. **Deliveries** always appear on
top of the NPC's first node as "Hand over <item> xN". They are greyed out with
"You have 1/3" until the player holds enough.

## Interactables

```ts
{ id: "bound-leader", label: "Bone crew leader", x: 130, z: 70, glyph: "@",
  condition: { quest: "chrome-and-bone", stage: "decide" },   // only usable while this holds
  effects: [ ... ], dialogue: "cab.leader", once: true }
```

When the player uses an interactable, the engine applies its effects, emits
`interacted` (which completes `interact` objectives) and then opens its
dialogue, if it has one. `once: true` uses it up.

## Conditions and effects (cheat sheet)

**Conditions:**

- `{ flag, is?, atLeast?, atMost? }`: a bare flag means truthy; `is: false` also matches an unset flag.
- `{ quest, status?, stage?, outcome? }`
- `{ item, count? }`
- `{ credits }`
- `{ level }`
- `{ rep, atLeast?, atMost? }`
- `{ encounterCleared }`
- `{ all: [...] }`, `{ any: [...] }`, `{ not: ... }`

**Effects:**

- `{ setFlag, value? }` and `{ addFlag, by }`
- `{ give, count? }` and `{ take, count? }`
- `{ credits }`, `{ xp }`, `{ rep, by }`
- `{ startQuest }`
- `{ stage }` or `{ stage: "quest:stage" }`
- `{ outcome }` or `{ outcome: "quest:outcome" }`
- `{ fail: questId }`
- `{ spawn }`, `{ despawn }`, `{ hostile, value }`
- `{ waypoint: { x, z, label } }`: cleared automatically when the quest ends.
- `{ message, tone? }`
- `{ openDialogue, node? }`

Inside a quest's own stages and outcomes, a bare `stage` or `outcome` refers to
that quest. Inside a dialogue, it refers to the dialogue's `quest`. Anywhere
else, write `"quest:id"`.

## Worked example: "Chrome and Bone"

This quest has a persuasion check (or a bribe), a trip to a hideout, a fight with
an optional pickup, a choice with consequences, and two outcomes that later
content can react to.

```ts
export const CHROME_AND_BONE: ContentPack = {
  id: "chrome-and-bone",
  npcs: [
    { id: "sable", name: "Sable Okoro", title: "Ghost fixer", district: 4, x: 20, z: 70, facing: 0,
      look: { coat: [70, 70, 90], trim: [30, 30, 40], skin: [150, 110, 90], light: [180, 120, 255], headwear: "hood", prop: null, idle: "scan" },
      greeting: ["Rain's good cover. Keep walking unless you're working."] },
    { id: "rook", name: "Rook", title: "Informant", district: 4, x: 60, z: 70, facing: 1.5,
      look: { coat: [90, 80, 60], trim: [40, 30, 20], skin: [190, 150, 120], light: [255, 200, 90], headwear: "cap", prop: null, idle: "sway" },
      greeting: ["I don't know you."] },
  ],
  items: [{ id: "bone-ledger", name: "Bone ledger", kind: "quest", rarity: "rare", glyph: "=", description: "Names, debts, dates.", value: 0, weight: 0.2, stack: 1 }],
  encounters: [{
    id: "bone-crew", label: "Bone crew", area: { x: 130, z: 64, radius: 14 }, hostile: true,   // not auto: the quest spawns it
    members: [{ archetype: "razorback-thug", x: 126, z: 60 }, { archetype: "razorback-thug", x: 134, z: 66 }, { archetype: "razorback-boss", x: 130, z: 70, tag: "leader" }],
  }],
  interactables: [{
    id: "bound-leader", label: "Bone crew leader", x: 130, z: 70, glyph: "@",
    condition: { quest: "chrome-and-bone", stage: "decide" }, dialogue: "cab.leader",
  }],
  quests: [{
    id: "chrome-and-bone", title: "Chrome and Bone", category: "story", giver: "sable",
    summary: "A Razorback crew is stripping chrome off Ghost couriers. Sable wants it stopped.",
    rewardHint: "~300 cr, reputation", recommendedLevel: 3, start: "find",
    stages: [
      { id: "find", journal: "Rook knows where the Bone crew sleeps. Get it out of him.",
        // Two ways through Rook's dialogue: paying, or passing the street check.
        objectives: [{ id: "lead", kind: "choose", text: "Get the hideout from Rook", dialogue: "cab.rook", options: ["pay", "lean-pass"] }],
        next: "hideout" },
      { id: "hideout", journal: "The crew holds a lot off the east avenue.",
        onEnter: [{ waypoint: { x: 130, z: 64, label: "Bone crew hideout" } }],
        objectives: [{ id: "arrive", kind: "reach", text: "Find the hideout", area: { x: 130, z: 64, radius: 20 } }],
        onComplete: [{ spawn: "bone-crew" }],           // the fight starts when you arrive
        next: "fight" },
      { id: "fight", journal: "They saw you coming.", failOnDeath: true,
        objectives: [
          { id: "clear", kind: "clear", text: "Take down the Bone crew", encounter: "bone-crew" },
          { id: "ledger", kind: "collect", text: "Grab their ledger", item: "bone-ledger", count: 1, optional: true, target: { x: 132, z: 72 } },
        ],
        next: "decide" },
      { id: "decide", journal: "Their leader is on his knees. Your call.",
        objectives: [{ id: "verdict", kind: "choose", text: "Decide the leader's fate", dialogue: "cab.leader", options: ["spare", "finish"] }],
        // The choose objective stored the picked option in the flag "chrome-and-bone.verdict".
        next: [{ if: { flag: "chrome-and-bone.verdict", is: "spare" }, stage: "report-mercy" }, { stage: "report-blood" }] },
      { id: "report-mercy", journal: "Tell Sable you let him walk.", objectives: [{ id: "tell", kind: "talk", text: "Report to Sable", npc: "sable" }], onComplete: [{ outcome: "mercy" }] },
      { id: "report-blood", journal: "Tell Sable it's done.", objectives: [{ id: "tell", kind: "talk", text: "Report to Sable", npc: "sable" }], onComplete: [{ outcome: "blood" }] },
    ],
    outcomes: {
      mercy: { title: "Mercy", journal: "The crew scattered. The Ghosts noticed you showed mercy.", effects: [{ credits: 200 }, { rep: "ghosts", by: 10 }, { rep: "razorbacks", by: 5 }] },
      blood: { title: "Blood", journal: "The Bone crew is finished. Sable paid extra.", effects: [{ credits: 300 }, { rep: "ghosts", by: 5 }, { rep: "razorbacks", by: -15 }] },
    },
  }],
  dialogues: [
    { id: "cab.sable", npc: "sable", quest: "chrome-and-bone",
      entries: [
        { condition: { quest: "chrome-and-bone", status: "available" }, node: "offer" },
        { condition: { quest: "chrome-and-bone", status: "active" }, node: "waiting" },
        { condition: { quest: "chrome-and-bone", outcome: "mercy" }, node: "after-mercy" },
        { condition: { quest: "chrome-and-bone", outcome: "blood" }, node: "after-blood" },
      ],
      nodes: [
        { id: "offer", lines: ["A Razorback crew is stripping chrome off my couriers.", "Rook knows where they sleep. Make it stop."], options: [
          { id: "accept", label: "I'll handle it", effects: [{ startQuest: "chrome-and-bone" }], next: "go" },
          { id: "decline", label: "Not my war", kind: "decline", next: null },
        ] },
        { id: "go", lines: ["Rook drinks on the corner by the noodle stand. Be persuasive."], options: [{ id: "leave", label: "Leave", next: null }] },
        { id: "waiting", lines: ["Well?"], options: [{ id: "leave", label: "Leave", next: null }] },
        { id: "after-mercy", lines: ["You let one walk. Word travels. Maybe that's good."], options: [{ id: "leave", label: "Leave", next: null }] },
        { id: "after-blood", lines: ["Clean work. Messy, but clean."], options: [{ id: "leave", label: "Leave", next: null }] },
      ] },
    { id: "cab.rook", npc: "rook", quest: "chrome-and-bone",
      entries: [{ condition: { quest: "chrome-and-bone", stage: "find" }, node: "ask" }],
      nodes: [
        { id: "ask", lines: ["Bone crew? Never heard of them.", "...Information costs."], options: [
          { id: "pay", label: "Pay 50 cr", condition: { credits: 50 }, effects: [{ credits: -50 }], next: "told" },
          { id: "lean", label: "Lean on him", next: null,
            check: { stat: "street", difficulty: 4, success: "cracks", failure: "clams-up", bonus: [{ if: { rep: "razorbacks", atMost: -10 }, by: 2, label: "Razorbacks hate you" }] } },
          { id: "leave", label: "Leave", next: null },
        ] },
        { id: "cracks", lines: ["Fine! The lot off the east avenue. You didn't hear it from me."], options: [{ id: "lean-pass", label: "Good choice", next: null }] },
        { id: "clams-up", lines: ["You don't scare me."], options: [{ id: "back", label: "Fine. Let's talk money", next: "ask" }] },
        { id: "told", lines: ["East avenue. The lot with the burned-out bus."], options: [{ id: "leave", label: "Leave", next: null }] },
      ] },
    { id: "cab.leader", npc: "bound-leader", quest: "chrome-and-bone",   // spoken by the interactable
      entries: [{ node: "plead" }],
      nodes: [{ id: "plead", lines: ["Wait - wait. I got a kid in Neon Ward."], options: [
        { id: "spare", label: "Walk away and don't come back", effects: [{ setFlag: "bone-leader.alive" }], next: null },
        { id: "finish", label: "End it", kind: "complete", next: null },
      ] }],
    },
  ],
};
```

Consequences can reach further than the outcome effects. A later quest can use
`requires: { quest: "chrome-and-bone", outcome: "mercy" }`. Another NPC's
dialogue entry can check `{ flag: "bone-leader.alive" }`. The Razorback
reputation change can gate vendors and encounters.

## Checklist before you ship a pack

1. Give every id a prefix unique to the pack. For example, the dialogue ids here start with `cab.`.
2. Run `validateContent(pack, [itemsPack, combatPack])` in a test and assert it returns `[]`.
3. Play the quest in a test with `QuestEngine` and a fake `QuestHost` (see `tests/rpg-quests.test.ts`). Walk each branch to its outcome.
4. Keep every text the player reads in the world (interactable labels and glyphs) to printable ASCII.
