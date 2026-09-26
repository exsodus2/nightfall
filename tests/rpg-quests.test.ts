import assert from "node:assert/strict";
import test from "node:test";
import { EventBus } from "../src/rpg/events.ts";
import type { ContentPack, FactionId, GameEvent, ItemDefinition, Point, QuestHost } from "../src/rpg/types.ts";
import { NPCS, type NpcDefinition } from "../src/city/npcs.ts";
import { QuestEngine, LEGACY_PACK, validateContent, evaluate, applyEffects, unmetReason, type ConditionContext, type EffectContext } from "../src/rpg/quests/index.ts";

// ---- Test doubles ---------------------------------------------------------------------------------

class FakeHost implements QuestHost {
  items = new Map<string, number>();
  creditBalance = 0;
  level = 1;
  xpTotal = 0;
  reps = new Map<string, number>();
  stats = { cool: 3, tech: 1, street: 2 };
  spawned: string[] = [];
  clearedSet = new Set<string>();
  waypoint: (Point & { label: string }) | null = null;
  messages: string[] = [];
  private readonly bus: EventBus;
  constructor(bus: EventBus) { this.bus = bus; }
  give(item: string, count: number): void { this.items.set(item, this.count(item) + count); this.bus.emit({ type: "itemAdded", item, count }); }
  take(item: string, count: number): boolean {
    if (this.count(item) < count) return false;
    this.items.set(item, this.count(item) - count); this.bus.emit({ type: "itemRemoved", item, count });
    return true;
  }
  count(item: string): number { return this.items.get(item) ?? 0; }
  credits(delta: number): void { this.creditBalance += delta; }
  xp(amount: number): void { this.xpTotal += amount; }
  rep(faction: FactionId, delta: number): void { this.reps.set(faction, this.reputation(faction) + delta); }
  reputation(faction: FactionId): number { return this.reps.get(faction) ?? 0; }
  stat(name: "cool" | "tech" | "street"): number { return this.stats[name]; }
  spawnEncounter(id: string): void { this.spawned.push(id); }
  despawnEncounter(): void {}
  setHostile(): void {}
  encounterCleared(id: string): boolean { return this.clearedSet.has(id); }
  setWaypoint(point: (Point & { label: string }) | null): void { this.waypoint = point; }
  message(text: string): void { this.messages.push(text); }
}

const npc = (id: string, x: number, z: number): NpcDefinition => ({ id, name: id.toUpperCase(), title: "Test", district: 4, x, z, facing: 0, look: NPCS[0].look, greeting: [`${id} nods.`] });
const item = (id: string, name: string): ItemDefinition => ({ id, name, kind: "quest", rarity: "common", glyph: "*", description: name, value: 1, weight: 0, stack: 99 });

/** A sample pack exercising every objective kind and both dialogue styles (authored + auto-offer). */
const PACK: ContentPack = {
  id: "sample",
  npcs: [npc("fixer", 10, 10), npc("courier", 20, 20), npc("gatekeeper", 30, 30)],
  items: [item("keycard", "Keycard"), item("chip", "Data chip"), item("lucky-coin", "Lucky coin")],
  encounters: [
    { id: "guards", label: "Vault guards", area: { x: 50, z: 50, radius: 10 }, members: [{ archetype: "guard", x: 50, z: 50 }, { archetype: "guard", x: 52, z: 50 }], hostile: true },
    { id: "rats", label: "Sewer rats", area: { x: -200, z: 0, radius: 10 }, members: [{ archetype: "rat", x: -200, z: 0 }, { archetype: "rat", x: -202, z: 0 }], hostile: true, auto: true, respawn: 30 },
  ],
  areas: [{ id: "plaza", x: 0, z: -50, radius: 6 }],
  interactables: [
    { id: "vent", label: "Vent", x: 60, z: 60, once: true, condition: { quest: "heist", stage: "sneak" }, effects: [{ message: "You squeeze through the vent." }] },
    { id: "tunnel", label: "Old tunnel", x: 62, z: 60, condition: { quest: "heist", stage: "sneak" }, effects: [{ message: "A forgotten tunnel." }] },
    { id: "flare", label: "Distress flare", x: 0, z: 0, once: true, effects: [{ startQuest: "escort" }] },
  ],
  quests: [
    {
      id: "heist", title: "The Heist", category: "story", giver: "fixer", summary: "Crack the vault.", rewardHint: "200-300 cr", start: "briefing",
      stages: [
        { id: "briefing", journal: "The fixer has a plan. Two, actually.", objectives: [{ id: "pick", kind: "choose", text: "Pick a plan", dialogue: "fixer-talk", options: ["plan-loud", "plan-quiet"] }],
          next: [{ if: { flag: "heist.pick", is: "plan-loud" }, stage: "fight" }, { stage: "sneak" }] },
        { id: "fight", journal: "Going in loud.", onEnter: [{ spawn: "guards" }, { waypoint: { x: 50, z: 50, label: "Vault" } }],
          objectives: [
            { id: "guards", kind: "kill", text: "Drop the vault guards", count: 2, encounter: "guards" },
            { id: "keycard", kind: "collect", text: "Lift a keycard", item: "keycard", count: 1, optional: true },
          ], next: "escape" },
        { id: "sneak", journal: "Going in quiet.", mode: "any", objectives: [
          { id: "vent", kind: "interact", text: "Slip in through the vent", object: "vent" },
          { id: "bribe", kind: "choose", text: "Or bribe the gatekeeper", dialogue: "gate-talk", options: ["pay"] },
          { id: "tunnel", kind: "interact", text: "Found an old tunnel", object: "tunnel", hidden: true },
        ], next: "escape" },
        { id: "escape", journal: "Get out before the cops show.", timeLimit: 30, onTimeout: "caught",
          objectives: [{ id: "out", kind: "reach", text: "Reach the getaway van", area: { x: 100, z: 0, radius: 5 } }],
          next: [{ if: { flag: "heist.pick", is: "plan-loud" }, stage: "end-loud" }, { stage: "end-quiet" }] },
        { id: "end-loud", journal: "Loud, but done.", objectives: [], onComplete: [{ outcome: "loud" }] },
        { id: "end-quiet", journal: "Nobody even noticed.", objectives: [], onComplete: [{ outcome: "quiet" }] },
        { id: "caught", journal: "Cornered. Hold out.", failOnDeath: true, objectives: [{ id: "hold", kind: "survive", text: "Hold out", seconds: 5 }], onComplete: [{ outcome: "caught" }] },
      ],
      outcomes: {
        loud: { title: "Smash and grab", journal: "The Razorbacks won't forget this.", effects: [{ credits: 300 }, { rep: "razorbacks", by: -5 }] },
        quiet: { title: "Ghost job", journal: "Clean.", effects: [{ credits: 200 }, { rep: "ghosts", by: 5 }] },
        caught: { title: "Barely out", journal: "No pay, but alive." },
      },
    },
    { id: "sequel", title: "Sequel", category: "side", giver: "fixer", summary: "The fixer has a follow-up for loud people.", requires: { quest: "heist", outcome: "loud" }, start: "meet",
      stages: [{ id: "meet", journal: "Meet the courier.", objectives: [{ id: "meet", kind: "talk", text: "Talk to the courier", npc: "courier" }] }],
      outcomes: { done: { title: "Met", journal: "Done.", effects: [{ xp: 10 }] } } },
    { id: "courier", title: "Chip Run", category: "side", giver: "courier", summary: "Bring two data chips to the fixer.", start: "gather",
      stages: [
        { id: "gather", journal: "Find two chips.", objectives: [{ id: "chips", kind: "collect", text: "Collect data chips", item: "chip", count: 2 }], next: "hand" },
        { id: "hand", journal: "Bring them to the fixer.", objectives: [{ id: "give", kind: "deliver", text: "Deliver the chips to the fixer", item: "chip", count: 2, npc: "fixer" }] },
      ],
      outcomes: { done: { title: "Delivered", journal: "Paid.", effects: [{ credits: 50 }] } } },
    { id: "escort", title: "Escort", category: "side", giver: null, summary: "Walk the VIP home.", start: "walk", onFail: [{ rep: "ghosts", by: -3 }],
      stages: [{ id: "walk", journal: "Keep them alive.", failIf: { flag: "vip.dead" }, objectives: [{ id: "home", kind: "reach", text: "Reach the safehouse", area: { x: 500, z: 500, radius: 4 } }] }],
      outcomes: { safe: { title: "Safe", journal: "Home." } } },
    { id: "timed", title: "Dead Drop", category: "gig", giver: null, summary: "Grab it before it's gone.", trigger: { x: 200, z: 200, radius: 5 }, start: "run",
      stages: [{ id: "run", journal: "Ten seconds.", timeLimit: 10, objectives: [{ id: "drop", kind: "reach", text: "Reach the drop", area: { x: 900, z: 900, radius: 3 } }] }],
      outcomes: { done: { title: "Got it", journal: "Got it." } } },
    { id: "bounty", title: "Rat Bounty", category: "contract", giver: null, summary: "Clear the rats.", trigger: { x: -200, z: 0, radius: 8 }, repeatable: { cooldown: 60 }, start: "hunt",
      stages: [{ id: "hunt", journal: "Kill two rats.", objectives: [{ id: "rats", kind: "kill", text: "Kill rats", archetype: "rat", count: 2 }] }],
      outcomes: { paid: { title: "Paid", journal: "Paid.", effects: [{ credits: 25 }] } } },
  ],
  dialogues: [
    {
      id: "fixer-talk", npc: "fixer", quest: "heist",
      entries: [
        { condition: { quest: "heist", stage: "briefing" }, node: "plan" },
        { condition: { quest: "heist", status: "available" }, node: "offer" },
        { condition: { quest: "heist", status: "active" }, node: "busy" },
        { node: "hello" },
      ],
      nodes: [
        { id: "offer", lines: ["I need a crew for the vault."], options: [
          { id: "accept", label: "I'm in", effects: [{ startQuest: "heist" }], next: "plan" },
          { id: "big-job", label: "Got anything bigger?", condition: { level: 5 }, next: null },
          { id: "secret", label: "I know about the tunnel", condition: { flag: "knows-secret" }, hideIfUnavailable: true, next: null },
          { id: "decline", label: "Not tonight", kind: "decline", next: null },
        ] },
        { id: "plan", lines: ["Loud or quiet?"], options: [
          { id: "plan-loud", label: "Loud", next: "go" },
          { id: "plan-quiet", label: "Quiet", next: "go" },
          { id: "bluff", label: "Talk up your record", next: null, check: { stat: "cool", difficulty: 5, success: "impressed", failure: "unimpressed", bonus: [{ if: { item: "lucky-coin" }, by: 2, label: "Lucky coin" }] } },
        ] },
        { id: "impressed", lines: ["Huh. Maybe you are good."], effects: [{ setFlag: "fixer.impressed" }], options: [{ id: "back", label: "So, the plan", next: "plan" }] },
        { id: "unimpressed", lines: ["Sure you did."], options: [{ id: "back", label: "So, the plan", next: "plan" }] },
        { id: "go", lines: ["Move."], options: [{ id: "leave", label: "Leave", next: null }] },
        { id: "busy", lines: ["Why are you still here?"], options: [{ id: "leave", label: "Leave", next: null }] },
        { id: "hello", lines: ["Quiet night."], options: [{ id: "leave", label: "Leave", next: null }] },
      ],
    },
    {
      id: "gate-talk", npc: "gatekeeper", quest: "heist",
      entries: [{ condition: { quest: "heist", stage: "sneak" }, node: "gate" }],
      nodes: [{ id: "gate", lines: ["Hundred and I look the other way."], options: [
        { id: "pay", label: "Pay 100 cr", condition: { credits: 100 }, effects: [{ credits: -100 }], next: null },
        { id: "leave", label: "Leave", next: null },
      ] }],
    },
  ],
};

function setup(pack: ContentPack = PACK) {
  const bus = new EventBus(), host = new FakeHost(bus), events: GameEvent[] = [];
  bus.onAny(e => events.push(e));
  const engine = new QuestEngine({ bus, host, npcs: NPCS });
  engine.register(pack);
  return { bus, host, engine, events };
}
const ids = (engine: QuestEngine) => engine.dialogue?.options.map(o => o.id) ?? [];
const kinds = (engine: QuestEngine) => engine.dialogue?.options.map(o => o.kind) ?? [];
const kill = (bus: EventBus, archetype: string, encounter: string | null) => bus.emit({ type: "killed", enemy: `${archetype}-1`, archetype, faction: "corpsec", tags: [], encounter, x: 0, z: 0, byPlayer: true });
/** Advances the engine in small frames (update clamps dt). */
function run(engine: QuestEngine, seconds: number, at: Point) { for (let t = 0; t < seconds; t += 0.5) engine.update(0.5, at); }

// ---- Content sanity ---------------------------------------------------------------------------------

test("the sample pack and the legacy pack validate cleanly", () => {
  assert.deepEqual(validateContent(PACK), []);
  assert.deepEqual(validateContent(LEGACY_PACK), []);
});

// ---- Branching quest: two paths, two outcomes -------------------------------------------------------

test("loud path: choose, fight, optional objective, reach, outcome with rewards and unlocks", () => {
  const { engine, host, bus, events } = setup();
  assert.equal(engine.marker("fixer"), "offer");
  assert.equal(engine.status("sequel"), "locked");

  engine.talk("fixer");
  assert.deepEqual(ids(engine), ["accept", "big-job", "decline"], "hidden option stays hidden");
  assert.equal(engine.dialogue!.options.find(o => o.id === "big-job")!.disabled, "Requires level 5");
  assert.deepEqual(engine.choose("big-job"), { dialogue: engine.dialogue, message: null }, "disabled options do nothing");
  assert.deepEqual(kinds(engine), ["accept", "leave", "decline"], "kinds are inferred when content leaves them out");

  const accepted = engine.choose("accept");
  assert.equal(accepted.message, "Quest accepted: The Heist");
  assert.deepEqual(accepted.dialogue?.lines, ["Loud or quiet?"]);
  assert.equal(engine.status("heist"), "active");
  assert.equal(engine.stage("heist"), "briefing");

  engine.choose("plan-loud");
  assert.equal(engine.flags.get("heist.pick"), "plan-loud", "choose objectives record the option as a flag");
  assert.equal(engine.stage("heist"), "fight");
  assert.deepEqual(host.spawned, ["guards"]);
  assert.deepEqual(host.waypoint, { x: 50, z: 50, label: "Vault" });
  assert.ok(events.some(e => e.type === "questUpdated" && e.stage === "fight"));

  // Optional objective: shown, doesn't block, remembered as a flag.
  let entry = engine.log()[0];
  assert.deepEqual(entry.objectives, [{ text: "Drop the vault guards (0/2)", done: false, optional: false }, { text: "Lift a keycard", done: false, optional: true }]);
  host.give("keycard", 1);
  assert.equal(engine.flags.get("heist.keycard"), true);
  kill(bus, "guard", "guards");
  assert.equal(engine.log()[0].objectives![0].text, "Drop the vault guards (1/2)");
  kill(bus, "guard", "somewhere-else"); // wrong encounter: doesn't count
  assert.equal(engine.stage("heist"), "fight");
  kill(bus, "guard", "guards");
  assert.equal(engine.stage("heist"), "escape");
  const tracked = engine.snapshot(null).tracked!;
  assert.equal(tracked.title, "The Heist");
  assert.deepEqual([tracked.targetX, tracked.targetZ], [100, 0]);
  assert.equal(tracked.timeLeft, 30);

  engine.update(0.2, { x: 100, z: 1 });
  assert.equal(engine.status("heist"), "complete");
  assert.equal(engine.outcome("heist"), "loud");
  assert.equal(host.creditBalance, 300);
  assert.equal(host.reputation("razorbacks"), -5);
  assert.equal(host.waypoint, null, "the quest's waypoint is cleared when it ends");
  entry = engine.log()[0];
  assert.equal(entry.status, "complete");
  assert.equal(entry.objective, "Smash and grab");
  assert.equal(entry.reward, 300);
  assert.ok(events.some(e => e.type === "message" && e.text === "Quest complete: The Heist · +300 cr"));

  // Outcome-gated follow-up, offered on top of the fixer's small talk.
  assert.equal(engine.status("sequel"), "available");
  assert.equal(engine.marker("fixer"), "offer");
  engine.talk("fixer");
  assert.deepEqual(engine.dialogue?.lines, ["Quiet night."]);
  assert.deepEqual(ids(engine), ["@offer:sequel", "leave"]);
  engine.choose("@offer:sequel");
  assert.deepEqual(engine.dialogue?.lines, ["The fixer has a follow-up for loud people."]);
  assert.equal(engine.choose("@accept:sequel").message, "Quest accepted: Sequel");
  assert.equal(engine.marker("courier"), "objective");
  engine.talk("courier"); // talk objective completes on talking
  assert.equal(engine.status("sequel"), "complete");
  assert.equal(host.xpTotal, 10);
});

test("quiet path: any-mode stage, conditional bribe with a disabled reason, different outcome", () => {
  const { engine, host } = setup();
  engine.talk("fixer"); engine.choose("accept"); engine.choose("plan-quiet");
  assert.equal(engine.stage("heist"), "sneak");
  // Hidden objective isn't listed until found.
  assert.deepEqual(engine.log()[0].objectives?.map(o => o.text), ["Slip in through the vent", "Or bribe the gatekeeper"]);
  assert.equal(engine.marker("gatekeeper"), "objective");

  engine.talk("gatekeeper");
  assert.equal(engine.dialogue!.options.find(o => o.id === "pay")!.disabled, "Requires 100 cr");
  engine.close();
  host.creditBalance = 150;
  engine.talk("gatekeeper");
  assert.equal(engine.dialogue!.options.find(o => o.id === "pay")!.disabled, undefined);
  const paid = engine.choose("pay");
  assert.equal(paid.dialogue, null);
  assert.equal(host.creditBalance, 50);
  assert.equal(engine.stage("heist"), "escape", "one solution is enough in an any-mode stage");

  engine.update(0.1, { x: 100, z: 0 });
  assert.equal(engine.outcome("heist"), "quiet");
  assert.equal(host.creditBalance, 250);
  assert.equal(host.reputation("ghosts"), 5);
  assert.equal(engine.status("sequel"), "locked", "the loud-only follow-up stays locked");
});

test("hidden solution, time limit with a timeout branch, survive, and failOnDeath", () => {
  const { engine, bus } = setup();
  engine.talk("fixer"); engine.choose("accept"); engine.choose("plan-quiet");
  assert.ok(engine.interactables().some(i => i.id === "tunnel"));
  assert.equal(engine.interact("tunnel"), null);
  assert.equal(engine.stage("heist"), "escape");
  assert.equal(engine.interactables().some(i => i.id === "vent"), false, "stage-gated interactables disappear");

  run(engine, 29, { x: 0, z: 0 });
  assert.equal(engine.stage("heist"), "escape");
  run(engine, 2, { x: 0, z: 0 });
  assert.equal(engine.stage("heist"), "caught", "timing out jumps to onTimeout");
  run(engine, 3, { x: 0, z: 0 });
  assert.match(engine.log()[0].objectives![0].text, /Hold out \(4\/5s\)/, "the frame after the timeout already counts");
  bus.emit({ type: "playerDied" });
  assert.equal(engine.status("heist"), "failed", "failOnDeath");

  // Same again, but surviving the hold ends in the "caught" outcome.
  const second = setup();
  second.engine.talk("fixer"); second.engine.choose("accept"); second.engine.choose("plan-quiet");
  second.engine.interact("vent");
  assert.equal(second.engine.interact("vent"), null, "once-only interactables are used up");
  run(second.engine, 31, { x: 0, z: 0 });
  run(second.engine, 5.5, { x: 0, z: 0 });
  assert.equal(second.engine.outcome("heist"), "caught");
});

test("a time limit without onTimeout fails the quest; trigger areas start gigs", () => {
  const { engine, events } = setup();
  assert.equal(engine.status("timed"), "available");
  engine.update(0.1, { x: 200, z: 201 });
  assert.equal(engine.status("timed"), "active");
  assert.ok(events.some(e => e.type === "message" && e.text === "New gig: Dead Drop"));
  run(engine, 10.5, { x: 0, z: 0 });
  assert.equal(engine.status("timed"), "failed");
  assert.equal(engine.log().find(e => e.id === "timed")?.status, "failed");
  engine.update(0.1, { x: 200, z: 200 });
  assert.equal(engine.status("timed"), "failed", "non-repeatable quests don't restart");
});

test("failIf fails a quest and applies onFail; interactables start quests", () => {
  const { engine, host } = setup();
  engine.interact("flare");
  assert.equal(engine.status("escort"), "active");
  engine.setFlag("vip.dead", true);
  assert.equal(engine.status("escort"), "failed");
  assert.equal(host.reputation("ghosts"), -3);
});

test("collect and deliver with an auto-generated offer and delivery option", () => {
  const { engine, host } = setup();
  assert.equal(engine.marker("courier"), "offer");
  engine.talk("courier");
  assert.deepEqual(ids(engine), ["@accept:courier", "@decline:courier"]);
  assert.deepEqual(engine.dialogue?.lines, ["Bring two data chips to the fixer."]);
  engine.choose("@accept:courier");
  host.give("chip", 1);
  assert.equal(engine.log()[0].objective, "Collect data chips (1/2)");
  host.give("chip", 1);
  assert.equal(engine.stage("courier"), "hand");
  assert.equal(engine.marker("fixer"), "objective");
  host.take("chip", 1);
  engine.talk("fixer");
  assert.equal(engine.dialogue!.options[0].id, "@deliver:courier:give");
  assert.equal(engine.dialogue!.options[0].disabled, "You have 1/2");
  host.give("chip", 1);
  engine.talk("fixer");
  assert.equal(engine.dialogue!.options[0].label, "Hand over Data chip x2");
  const done = engine.choose("@deliver:courier:give");
  assert.equal(done.message, "Quest complete: Chip Run · +50 cr");
  assert.equal(host.count("chip"), 0);
  assert.equal(host.creditBalance, 50);
  assert.ok(done.dialogue, "the conversation carries on after a delivery");
});

test("stat checks are deterministic thresholds with visible numbers and bonuses", () => {
  const { engine, host } = setup();
  engine.talk("fixer"); engine.choose("accept");
  const bluff = () => engine.dialogue!.options.find(o => o.id === "bluff")!;
  assert.equal(bluff().label, "Talk up your record [COOL 3/5]");
  assert.deepEqual(bluff().check, { stat: "cool", value: 3, difficulty: 5 });
  assert.deepEqual(engine.choose("bluff").dialogue?.lines, ["Sure you did."]);
  engine.choose("back");
  host.give("lucky-coin", 1);
  engine.close(); engine.talk("fixer");
  assert.equal(bluff().label, "Talk up your record [COOL 5/5]");
  assert.deepEqual(engine.choose("bluff").dialogue?.lines, ["Huh. Maybe you are good."]);
  assert.equal(engine.flags.get("fixer.impressed"), true, "node effects apply on entering the node");
});

test("repeatable contracts come back after their cooldown", () => {
  const { engine, bus, host, events } = setup();
  const at = { x: -200, z: 0 };
  engine.update(0.1, at);
  assert.equal(engine.status("bounty"), "active");
  kill(bus, "rat", null); kill(bus, "rat", "rats");
  assert.equal(engine.status("bounty"), "complete");
  assert.equal(host.creditBalance, 25);
  run(engine, 30, { x: 0, z: 0 });
  assert.equal(engine.status("bounty"), "complete", "still cooling down");
  run(engine, 31, { x: 0, z: 0 });
  assert.equal(engine.status("bounty"), "available");
  assert.ok(events.some(e => e.type === "questUpdated" && e.quest === "bounty" && e.status === "available"));
  engine.update(0.1, at);
  assert.equal(engine.status("bounty"), "active");
  kill(bus, "rat", null); kill(bus, "rat", null);
  assert.equal(host.creditBalance, 50);
  assert.deepEqual(evaluate({ quest: "bounty", outcome: "paid" }, { host, flag: () => undefined, quest: () => ({ status: "complete", stage: "hunt", outcomes: ["paid"] }) }), true);
});

test("named areas raise entered / left events", () => {
  const { engine, events } = setup();
  engine.update(0.1, { x: 0, z: -50 });
  engine.update(0.1, { x: 0, z: -48 });
  engine.update(0.1, { x: 0, z: 0 });
  assert.deepEqual(events.filter(e => e.type === "entered" || e.type === "left"), [{ type: "entered", area: "plaza" }, { type: "left", area: "plaza" }]);
});

test("save and load mid-quest, rejecting garbage", () => {
  const first = setup();
  first.engine.talk("fixer"); first.engine.choose("accept"); first.engine.choose("plan-loud");
  kill(first.bus, "guard", "guards");
  first.engine.update(3, { x: 0, z: 0 });
  const saved = JSON.parse(JSON.stringify(first.engine.serialize()));

  const second = setup();
  second.engine.load(saved);
  assert.equal(second.engine.stage("heist"), "fight");
  assert.equal(second.engine.flags.get("heist.pick"), "plan-loud");
  assert.equal(second.engine.log()[0].objectives![0].text, "Drop the vault guards (1/2)");
  kill(second.bus, "guard", "guards");
  assert.equal(second.engine.stage("heist"), "escape");
  assert.equal(second.engine.clock, 0.5);

  second.engine.load({ version: 2, quests: {} });
  assert.equal(second.engine.stage("heist"), "escape", "unknown versions are ignored");
  second.engine.load({ version: 1, time: -5, flags: { ok: 1, bad: {} }, quests: { heist: { status: "weird" }, nope: { status: "active" }, courier: { status: "active", stage: "removed-stage" } } });
  assert.equal(second.engine.status("heist"), "available");
  assert.equal(second.engine.flags.get("ok"), 1);
  assert.equal(second.engine.flags.get("bad"), undefined);
  assert.equal(second.engine.stage("courier"), "gather", "a stage that no longer exists restarts the quest");
  assert.equal(second.engine.clock, 0);
});

// ---- Pure evaluators -------------------------------------------------------------------------------

test("conditions and effects evaluate standalone", () => {
  const bus = new EventBus(), host = new FakeHost(bus), flags = new Map<string, boolean | number | string>();
  const ctx: EffectContext = { host, flag: k => flags.get(k), quest: () => ({ status: "active", stage: "two", outcomes: [] }), setFlag: (k, v) => { flags.set(k, v); } };
  applyEffects([{ setFlag: "met" }, { addFlag: "count", by: 2 }, { addFlag: "count", by: 1 }, { give: "chip", count: 3 }, { credits: 40 }, { rep: "ghosts", by: 2 }, { message: "hi" }], ctx);
  assert.equal(flags.get("count"), 3);
  const c: ConditionContext = ctx;
  assert.equal(evaluate({ all: [{ flag: "met" }, { flag: "count", atLeast: 3 }, { item: "chip", count: 3 }, { credits: 40 }, { rep: "ghosts", atLeast: 2 }] }, c), true);
  assert.equal(evaluate({ flag: "never", is: false }, c), true);
  assert.equal(evaluate({ quest: "x", stage: "two" }, c), true);
  assert.equal(evaluate({ quest: "x" }, c), false, "a bare quest condition means complete");
  assert.equal(evaluate({ not: { any: [{ level: 3 }, { flag: "count", atMost: 1 }] } }, c), true);
  assert.equal(unmetReason({ all: [{ credits: 10 }, { level: 4 }] }, c), "Requires level 4");
  assert.equal(unmetReason({ item: "chip", count: 5 }, c), "Requires chip (3/5)");
  assert.equal(unmetReason({ rep: "chrome-saints", atLeast: 10 }, c), "Requires Chrome Saints reputation 10");
  assert.deepEqual(host.messages, ["hi"]);
});

// ---- Validator -------------------------------------------------------------------------------------

test("validateContent catches each class of authoring error", () => {
  const broken: ContentPack = {
    id: "broken",
    items: [item("real-item", "Real")],
    encounters: [{ id: "solo", label: "One guy", area: { x: 0, z: 0, radius: 5 }, members: [{ archetype: "thug", x: 0, z: 0 }], hostile: true }],
    quests: [
      { id: "q1", title: "Q1", category: "side", giver: "nobody", summary: "s", start: "a", stages: [
        { id: "a", journal: "j", objectives: [
          { id: "o1", kind: "collect", text: "t", item: "ghost-item", count: 1 },
          { id: "o2", kind: "kill", text: "t", count: 3, encounter: "solo" },
          { id: "o3", kind: "clear", text: "t", encounter: "nope" },
          { id: "o4", kind: "choose", text: "t", dialogue: "d1", options: ["missing-option"] },
        ], onComplete: [{ startQuest: "missing-quest" }, { stage: "q1:ghost-stage" }], next: "missing-stage" },
        { id: "island", journal: "j", objectives: [{ id: "x", kind: "talk", text: "t", npc: "mara" }] },
        { id: "timed", journal: "j", timeLimit: 5, objectives: [{ id: "s", kind: "survive", text: "t", seconds: 10 }], next: [{ if: { flag: "f" }, stage: "a" }] },
      ], outcomes: { one: { title: "t", journal: "j" }, two: { title: "t", journal: "j" } } },
      { id: "loop", title: "Loop", category: "side", giver: "mara", summary: "s", start: "a", stages: [
        { id: "a", journal: "j", objectives: [{ id: "x", kind: "talk", text: "t", npc: "mara" }], next: "b" },
        { id: "b", journal: "j", objectives: [{ id: "x", kind: "talk", text: "t", npc: "juno" }], next: "a" },
      ], outcomes: { done: { title: "t", journal: "j" } } },
      { id: "multi", title: "Multi", category: "side", giver: "mara", summary: "s", start: "a", stages: [{ id: "a", journal: "j", objectives: [{ id: "x", kind: "talk", text: "t", npc: "mara" }] }], outcomes: { x: { title: "t", journal: "j" }, y: { title: "t", journal: "j" } } },
      { id: "orphan", title: "Orphan", category: "gig", giver: null, summary: "s", start: "a", stages: [{ id: "a", journal: "j", objectives: [{ id: "x", kind: "clear", text: "t", encounter: "solo" }] }], outcomes: { done: { title: "t", journal: "j" } } },
    ],
    dialogues: [{ id: "d1", npc: "ghost-npc", entries: [{ node: "start" }, { node: "no-such-node" }], nodes: [
      { id: "start", lines: ["hi"], options: [{ id: "go", label: "Go", next: "void" }, { id: "@evil", label: "x", next: null }] },
      { id: "lonely", lines: ["nobody comes here"], options: [] },
    ] }],
  };
  const errors = validateContent(broken);
  const expect = (pattern: RegExp) => assert.ok(errors.some(e => pattern.test(e)), `expected ${pattern} in:\n${errors.join("\n")}`);
  expect(/quest "q1" giver: unknown NPC "nobody"/);
  expect(/objective "o1": unknown item "ghost-item"/);
  expect(/objective "o2": can never complete: encounter "solo" is not auto and nothing spawns it/);
  expect(/objective "o2": can never complete: encounter "solo" has only 1 matching member\(s\) for count 3/);
  expect(/objective "o3": unknown encounter "nope"/);
  expect(/objective "o4": dialogue "d1" has no option "missing-option"/);
  expect(/startQuest names unknown quest "missing-quest"/);
  expect(/quest "q1" has no stage "ghost-stage"/);
  expect(/next stage "missing-stage" does not exist/);
  expect(/stage "island": unreachable/);
  expect(/objective "s": can never complete: survive 10s is longer than the stage time limit 5s/);
  expect(/stage "timed": `next` branches have no fallback/);
  expect(/quest "multi" stage "a": ends the quest without an outcome effect/);
  expect(/quest "multi" outcome "y": can never happen/);
  expect(/quest "loop": no path to an outcome/);
  expect(/quest "orphan": can never start/);
  expect(/dialogue "d1": unknown NPC or interactable "ghost-npc"/);
  expect(/dialogue "d1" entry\[1\]: unknown node "no-such-node"/);
  expect(/option "go": points to missing node "void"/);
  expect(/option "@evil": option ids starting with "@" are reserved/);
  expect(/node "lonely": unreachable/);
  // Items resolve through context packs (e.g. the item database).
  const pack: ContentPack = { id: "p", quests: [{ id: "c", title: "C", category: "side", giver: "mara", summary: "s", start: "a", stages: [{ id: "a", journal: "j", objectives: [{ id: "x", kind: "collect", text: "t", item: "real-item", count: 1 }] }], outcomes: { done: { title: "t", journal: "j" } } }] };
  assert.deepEqual(validateContent(pack, broken), []);
  assert.match(validateContent(pack, { id: "items", items: [item("other", "Other")] })[0], /unknown item "real-item"/);
});

// ---- Legacy compatibility --------------------------------------------------------------------------

test("the legacy relay chip quest plays the same in QuestEngine", () => {
  const { engine, host } = setup(LEGACY_PACK);
  const juno = NPCS.find(n => n.id === "juno")!, mara = NPCS.find(n => n.id === "mara")!;
  assert.equal(engine.status("relay-chip"), "available");
  assert.equal(engine.marker("mara"), "offer");
  assert.equal(engine.marker("juno"), null);
  assert.deepEqual(engine.snapshot(null), { credits: 0, log: [], nearbyNpc: null, tracked: null });

  engine.talk("juno");
  assert.deepEqual(kinds(engine), ["leave"]);
  assert.deepEqual(engine.dialogue?.lines, juno.greeting);
  assert.equal(engine.choose(engine.dialogue!.options[0].id).dialogue, null);

  const offer = engine.talk("mara")!;
  assert.equal(offer.npcName, "Mara Voss");
  assert.equal(offer.district, "Silk Market");
  assert.deepEqual(offer.lines, mara.quests!["relay-chip"].offer);
  assert.deepEqual(kinds(engine), ["accept", "decline"]);
  const accepted = engine.choose("accept");
  assert.equal(accepted.message, "Quest accepted: The Relay Chip");
  assert.deepEqual(accepted.dialogue?.options.map(o => o.kind), ["leave"]);
  assert.equal(engine.status("relay-chip"), "active");
  assert.equal(engine.marker("mara"), null);
  assert.equal(engine.marker("juno"), "objective");
  const tracked = engine.snapshot(null).tracked!;
  assert.deepEqual([tracked.title, tracked.objective, tracked.targetX, tracked.targetZ], ["The Relay Chip", "Meet Juno Reyes under the Meridian Spire in Neon Ward", juno.x, juno.z]);
  const entry = engine.log()[0];
  assert.deepEqual([entry.id, entry.status, entry.targetDistrict, entry.reward], ["relay-chip", "active", "Neon Ward", 250]);
  engine.close();

  engine.talk("mara");
  assert.deepEqual(kinds(engine), ["leave"], "reminder only");
  engine.close();

  engine.talk("juno");
  assert.deepEqual(kinds(engine), ["continue", "leave"]);
  const collected = engine.choose("step-0");
  assert.match(collected.message ?? "", /^Relay chip collected: Return the relay chip/);
  assert.equal(engine.log()[0].status, "ready");
  assert.equal(engine.log()[0].targetDistrict, "Silk Market");
  assert.equal(engine.marker("mara"), "turn-in");
  assert.equal(engine.marker("juno"), null);
  assert.equal(engine.snapshot(null).tracked?.targetX, mara.x);
  engine.close();

  engine.talk("juno");
  assert.deepEqual(kinds(engine), ["leave"], "the handover can't repeat");
  engine.close();

  engine.talk("mara");
  assert.deepEqual(kinds(engine), ["complete", "leave"]);
  assert.equal(engine.dialogue!.options[0].label, "Hand over the chip (+250 cr)");
  const done = engine.choose("complete");
  assert.equal(done.message, "Quest complete: The Relay Chip · +250 cr");
  assert.equal(host.creditBalance, 250);
  assert.equal(engine.status("relay-chip"), "complete");
  assert.equal(engine.marker("mara"), null);
  assert.equal(engine.snapshot(null).tracked, null);
  assert.equal(engine.log()[0].status, "complete");
  engine.close();

  engine.talk("mara");
  assert.deepEqual(kinds(engine), ["leave"]);
  assert.deepEqual(engine.dialogue?.lines, mara.quests!["relay-chip"].thanks);
  engine.choose("complete");
  assert.equal(host.creditBalance, 250, "pays once");
});
