import assert from "node:assert/strict";
import test from "node:test";
import { roadDistance } from "../src/city/driving.ts";
import { interiorFixtures, interiorLocal, interiorPlaces } from "../src/city/interiors.ts";
import { NPCS } from "../src/city/npcs.ts";
import { BLOCK_SIZE, CityWorld, HALF_BLOCKS } from "../src/city/world.ts";
import { CONTENT_PACKS, MAIN_QUESTLINE_PACKS } from "../src/rpg/content/index.ts";
import { FLAG, ITEM, RAIN, RAIN_QUESTS, SPOTS } from "../src/rpg/content/main-common.ts";
import { ITEMS } from "../src/rpg/items/index.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, Effect, Objective, RpgFrame } from "../src/rpg/types.ts";

// The main questline, "The Rain That Remembers" (docs/story.md): content validity, placement on
// pavements, the writing rules that can be checked mechanically, and full playthroughs of each
// ending with one payout per quest and save/restore mid-act.

const world = new CityWorld();
const MAIN: readonly ContentPack[] = MAIN_QUESTLINE_PACKS;
const ALL: readonly ContentPack[] = [...CONTENT_PACKS, LEGACY_PACK, { id: "item-catalogue", items: ITEMS }];

// ---- Validity -----------------------------------------------------------------------------------

test("every act validates against all other registered content, and every act is registered", () => {
  assert.equal(MAIN.length, 5);
  for (const pack of MAIN) {
    assert.ok(CONTENT_PACKS.includes(pack), `${pack.id} is registered`);
    assert.deepEqual(validateContent(pack, ALL.filter(other => other !== pack)), [], pack.id);
  }
  const quests = MAIN.flatMap(pack => pack.quests ?? []);
  assert.deepEqual(quests.map(quest => quest.id), [...RAIN_QUESTS], "eleven quests in story order");
  assert.ok(quests.length >= 10 && quests.length <= 14);
  for (const quest of quests) {
    assert.equal(quest.category, "story");
    assert.equal(quest.repeatable, undefined, `${quest.id} pays once`);
    assert.equal(quest.trigger, undefined, `${quest.id} never auto-starts from an area`);
  }
});

test("every act ends at least two ways, and the finale has three", () => {
  const quests = new Map(MAIN.flatMap(pack => pack.quests ?? []).map(quest => [quest.id, quest]));
  const endings = (...ids: string[]) => ids.reduce((sum, id) => sum + Object.keys(quests.get(id)?.outcomes ?? {}).length, 0);
  assert.ok(endings(RAIN.undeliverable, RAIN.returnToSender) >= 4);
  assert.ok(endings(RAIN.stationNobody) >= 2);
  assert.ok(endings(RAIN.manifest, RAIN.shed) >= 4);
  assert.ok(endings(RAIN.loom, RAIN.trunk) >= 4);
  assert.deepEqual(Object.keys(quests.get(RAIN.finale)?.outcomes ?? {}).sort(), ["burned", "released", "returned"]);
});

// ---- Writing rules (the checkable parts) ----------------------------------------------------------

/** Every string in a pack, with where it came from. */
function strings(value: unknown, path: string, out: { path: string; text: string }[] = []): { path: string; text: string }[] {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  return out;
}

test("all questline text is printable ASCII with no dashes standing in for punctuation", () => {
  for (const pack of MAIN) {
    for (const { path, text } of strings(pack, pack.id)) {
      assert.ok(/^[\x20-\x7e]*$/.test(text), `${path} is printable ASCII: ${text}`);
      assert.ok(!/ - | -- /.test(text), `${path} uses a dash as punctuation: ${text}`);
    }
  }
});

const PLACES = ["Silk Market", "Lantern Row", "Dead Letter", "Ghost Circuit", "Signal Cathedral", "Silk Harbour", "Low Tide Gate", "Spillway", "Kiln Nine", "Foundry", "Ember Core", "Last Tree", "Rain Gardens", "Spire"];

/** Sentences in a journal line, not counting a trailing parenthetical hint or initials ("Dr.", "O."). */
const sentences = (text: string) => text.replace(/\([^)]*\)/g, "").replace(/\b(?:Dr|Lt|[A-Z])\./g, "").split(/[.!?](?:\s|$)/).filter(s => s.trim()).length;

test("every visible objective names where to go, and every stage journal is one or two plain sentences", () => {
  for (const pack of MAIN) for (const quest of pack.quests ?? []) for (const stage of quest.stages) {
    if (stage.objectives.length) {
      const count = sentences(stage.journal);
      assert.ok(count >= 1 && count <= 2, `${quest.id}:${stage.id} journal is one or two sentences (${count}): ${stage.journal}`);
    }
    for (const objective of stage.objectives) {
      if (objective.hidden) continue;
      assert.ok(PLACES.some(place => objective.text.includes(place)), `${quest.id}:${stage.id}:${objective.id} names a place: ${objective.text}`);
    }
  }
});

// ---- Placement ------------------------------------------------------------------------------------

/** True when (x, z) connects by walking (1 m grid, 4-neighbour) to a street centre line. */
function reachesStreets(x: number, z: number): boolean {
  const limit = HALF_BLOCKS * BLOCK_SIZE - BLOCK_SIZE;
  const onStreet = (cx: number, cz: number) => (Math.abs(cx - Math.round(cx / BLOCK_SIZE) * BLOCK_SIZE) <= 1.5 && Math.abs(cx) <= limit)
    || (Math.abs(cz - Math.round(cz / BLOCK_SIZE) * BLOCK_SIZE) <= 1.5 && Math.abs(cz) <= limit);
  const R = 140, size = R * 2 + 1, seen = new Uint8Array(size * size);
  const ox = Math.round(x), oz = Math.round(z);
  const queue: number[] = [];
  for (let r = 0; r <= 3 && !queue.length; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (world.canOccupy(ox + dx, oz + dz) && !seen[(dz + R) * size + dx + R]) { seen[(dz + R) * size + dx + R] = 1; queue.push(dx, dz); }
  }
  for (let head = 0; head < queue.length; head += 2) {
    const dx = queue[head], dz = queue[head + 1];
    if (onStreet(ox + dx, oz + dz)) return true;
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = dx + sx, nz = dz + sz;
      if (Math.abs(nx) > R || Math.abs(nz) > R) continue;
      const index = (nz + R) * size + nx + R;
      if (seen[index] || !world.canOccupy(ox + nx, oz + nz)) continue;
      seen[index] = 1; queue.push(nx, nz);
    }
  }
  return false;
}

test("givers and outdoor objects stand on pavements: walkable, 7 m off the carriageway, clear of each other", () => {
  const everyone = [...NPCS, ...ALL.flatMap(pack => pack.npcs ?? [])];
  const outdoor = ALL.flatMap(pack => (pack.interactables ?? []).filter(it => !it.place));
  let checked = 0;
  for (const pack of MAIN) {
    for (const npc of pack.npcs ?? []) {
      assert.ok(world.canOccupy(npc.x, npc.z), `${npc.id} at ${npc.x},${npc.z} is walkable`);
      assert.ok(roadDistance(npc.x, npc.z) >= 7, `${npc.id} is ${roadDistance(npc.x, npc.z).toFixed(1)} m from a carriageway centre line`);
      assert.ok(reachesStreets(npc.x, npc.z), `${npc.id} can be walked to`);
      for (const other of everyone) if (other.id !== npc.id) assert.ok(Math.hypot(other.x - npc.x, other.z - npc.z) >= 6, `${npc.id} is too close to ${other.id}`);
      for (const it of outdoor) assert.ok(Math.hypot(it.x - npc.x, it.z - npc.z) >= 3, `${npc.id} stands on ${it.id}`);
      checked++;
    }
    for (const it of (pack.interactables ?? []).filter(object => !object.place)) {
      assert.ok(world.canOccupy(it.x, it.z), `${it.id} at ${it.x},${it.z} is walkable`);
      assert.ok(roadDistance(it.x, it.z) >= 7, `${it.id} is ${roadDistance(it.x, it.z).toFixed(1)} m from a carriageway centre line`);
      assert.ok(reachesStreets(it.x, it.z), `${it.id} can be walked to`);
      for (const npc of everyone) assert.ok(Math.hypot(npc.x - it.x, npc.z - it.z) >= 3, `${it.id} is within 3 m of ${npc.id}`);
      for (const other of outdoor) if (other.id !== it.id) assert.ok(Math.hypot(other.x - it.x, other.z - it.z) >= 3, `${it.id} overlaps ${other.id}`);
      checked++;
    }
    for (const encounter of pack.encounters ?? []) {
      assert.ok(world.canOccupy(encounter.area.x, encounter.area.z), `${encounter.id} centre is walkable`);
      for (const m of encounter.members) assert.ok(world.canOccupy(m.x, m.z), `${encounter.id} member at ${m.x},${m.z} is walkable`);
    }
  }
  // Six outdoor objects since the relay's service hatch joined the hackable cabinet (HACK-HOOK).
  assert.equal(checked, 13, "seven givers and six outdoor objects");
});

test("the Dead Letter lot reader stands inside the room, off the fixtures and apart from the other stations", () => {
  const indoor = MAIN.flatMap(pack => (pack.interactables ?? []).filter(it => it.place));
  assert.deepEqual(indoor.map(it => it.id), ["rain-lot-reader"]);
  for (const it of indoor) {
    const place = interiorPlaces(world).find(p => p.id === it.place);
    assert.ok(place, `${it.place} exists`);
    const local = interiorLocal(place, it.x, it.z);
    assert.ok(Math.abs(local.x) < place.width / 2 - 0.5 && Math.abs(local.z) < place.depth / 2 - 0.5, `${it.id} is inside ${place.id}`);
    for (const f of interiorFixtures(place)) {
      assert.ok(Math.abs(local.x - f.x) > f.width / 2 || Math.abs(local.z - f.z) > f.depth / 2, `${it.id} is not inside a ${f.kind}`);
    }
    for (const other of ALL.flatMap(pack => pack.interactables ?? []).filter(o => o.place === it.place && o.id !== it.id)) {
      assert.ok(Math.hypot(other.x - it.x, other.z - it.z) >= 1.5, `${it.id} is apart from ${other.id}`);
    }
  }
  const door = interiorPlaces(world).find(p => p.id === "dead-letter")?.entrance;
  assert.ok(door && Math.hypot(door.x - SPOTS.deadLetterDoor.x, door.z - SPOTS.deadLetterDoor.z) < 0.05, "the tracker target is the real door");
});

test("every objective has a tracker target and every waypoint is reachable", () => {
  const npcs = new Map([...NPCS, ...ALL.flatMap(pack => pack.npcs ?? [])].map(npc => [npc.id, npc]));
  const things = new Map(ALL.flatMap(pack => pack.interactables ?? []).map(it => [it.id, it]));
  const encounters = new Map(ALL.flatMap(pack => pack.encounters ?? []).map(e => [e.id, e]));
  const dialogues = new Map(ALL.flatMap(pack => pack.dialogues ?? []).map(d => [d.id, d]));
  const target = (o: Objective): { x: number; z: number } | undefined => {
    if (o.target) return o.target;
    switch (o.kind) {
      case "talk": case "deliver": return npcs.get(o.npc);
      case "interact": return things.get(o.object);
      case "reach": case "survive": return o.area;
      case "clear": return encounters.get(o.encounter)?.area;
      case "kill": return o.encounter ? encounters.get(o.encounter)?.area : undefined;
      case "choose": { const speaker = dialogues.get(o.dialogue)?.npc ?? ""; return npcs.get(speaker) ?? things.get(speaker); }
      default: return undefined;
    }
  };
  const waypoints = (effects: readonly Effect[] | undefined) => (effects ?? []).flatMap(e => ("waypoint" in e ? [e.waypoint] : []));
  for (const pack of MAIN) for (const quest of pack.quests ?? []) {
    for (const stage of quest.stages) {
      for (const o of stage.objectives) assert.ok(target(o), `${quest.id}:${stage.id}:${o.id} has a tracker target`);
      for (const w of [...waypoints(stage.onEnter), ...waypoints(stage.onComplete)]) assert.ok(reachesStreets(w.x, w.z), `${quest.id}:${stage.id} waypoint ${w.label}`);
    }
    for (const outcome of Object.values(quest.outcomes)) for (const w of waypoints(outcome.effects)) assert.ok(reachesStreets(w.x, w.z), `${quest.id} outcome waypoint ${w.label}`);
  }
});

// ---- Playthroughs ---------------------------------------------------------------------------------

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const session = (storage?: ReturnType<typeof memory>) => new RpgSession({ world, packs: CONTENT_PACKS, storage });
const options = (s: RpgSession) => s.dialogue?.options ?? [];
const has = (s: RpgSession, id: string) => options(s).some(option => option.id === id && !option.disabled);

/** Picks an enabled option of the open conversation. */
function pick(s: RpgSession, id: string) {
  assert.ok(has(s, id), `option ${id} is offered: ${options(s).map(o => `${o.id}${o.disabled ? "(off)" : ""}`).join(", ")}`);
  s.choose(id);
}
function talk(s: RpgSession, npc: string, ...steps: string[]) {
  assert.ok(s.talk(npc), `${npc} answers`);
  for (const step of steps) pick(s, step);
  s.close();
}
function operate(s: RpgSession, object: string, ...steps: string[]) {
  assert.ok(s.quests.interactables().some(it => it.id === object), `${object} is usable`);
  s.quests.interact(object);
  for (const step of steps) pick(s, step);
  s.close();
}
const stage = (s: RpgSession, quest: string) => s.quests.stage(quest);
const flag = (s: RpgSession, key: string) => s.quests.flags.get(key);

/** Act 1 for both of its choices. */
function act1(s: RpgSession, hold: boolean, log: boolean) {
  talk(s, "tilly-marsh", "accept-run");
  assert.equal(stage(s, RAIN.undeliverable), "door");
  assert.equal(s.character.count(ITEM.drive), 1, "Tilly hands over the drive");
  operate(s, "rain-lantern-door");
  assert.equal(stage(s, RAIN.undeliverable), "nell");
  talk(s, "nell-ashby", "read", hold ? "let-hold" : "keep-sealed");
  assert.equal(s.character.count(ITEM.key), hold ? 1 : 0);
  // The report pays, then Tilly offers the trace in the same conversation.
  talk(s, "tilly-marsh", "report", "next", "accept-trace");
  assert.equal(s.quests.outcome(RAIN.undeliverable), hold ? "kind" : "book");
  assert.equal(stage(s, RAIN.returnToSender), "reader");
  assert.deepEqual(s.interactables("dead-letter").map(it => it.id).filter(id => id.startsWith("rain-")), ["rain-lot-reader"]);
  operate(s, "rain-lot-reader", "play", log ? "log-it" : "off-book");
  assert.equal(stage(s, RAIN.returnToSender), "moth");
  talk(s, "moth-nobody", "show-drive", "how", "accept-key");
  assert.equal(s.quests.outcome(RAIN.returnToSender), log ? "logged" : "off-book");
  assert.equal(stage(s, RAIN.stationNobody), "relay");
}

/** Act 2: the relay (quietly if the stat allows, else by force), the decode and Nell. */
function act2(s: RpgSession, air: boolean, play: boolean, force: boolean) {
  // The cabinet ("rain-relay") is a hack target now; the TECH check and the pry moved to its
  // service hatch (HACK-HOOK). tests/main-hack-hook.test.ts covers the breach path.
  s.quests.interact("rain-relay-hatch");
  if (force) pick(s, "forced");
  else {
    pick(s, "port");
    if (has(s, "slipped")) pick(s, "slipped");
    else pick(s, "forced");
  }
  s.close();
  assert.equal(s.character.count(ITEM.carrierKey), 1);
  assert.equal(stage(s, RAIN.stationNobody), "decode");
  talk(s, "moth-nobody", "know", "drive", air ? "air" : "hold");
  assert.equal(s.quests.outcome(RAIN.stationNobody), air ? "aired" : "held");
  assert.equal(s.character.count(ITEM.tape), 1);
  assert.equal(s.character.count(ITEM.carrierKey), 0);
  talk(s, "nell-ashby", "accept-window", play ? "play" : "told", "jonah");
  assert.equal(flag(s, FLAG.window), play ? "played" : "told");
  assert.equal(stage(s, RAIN.lightInWindow), "ruben");
}

test("the quiet road: hold, log, hold, play, favour, bribe, let it through, fit, tap, send them home", () => {
  const s = session();
  const start = s.character.credits;
  act1(s, true, true);
  act2(s, false, true, false);
  // Act 3: Ruben's favour, then a bribe at the checkpoint and the optional word with Agnes Pell.
  talk(s, "ruben-salgado", "nell-sent", "favour");
  assert.equal(s.quests.outcome(RAIN.lightInWindow), "done");
  assert.equal(stage(s, RAIN.manifest), "dock-crew");
  s.bus.emit({ type: "encounterCleared", encounter: "street-lowtide-dock" });
  assert.equal(stage(s, RAIN.manifest), "return");
  assert.equal(s.character.count(ITEM.manifest), 1);
  talk(s, "ruben-salgado", "hand-book", "next", "accept-shed");
  assert.equal(s.quests.outcome(RAIN.manifest), "favour");
  assert.equal(stage(s, RAIN.shed), "checkpoint");
  talk(s, "dace-morrow", "paid");
  assert.equal(stage(s, RAIN.shed), "shed");
  talk(s, "pell", "ask-flood");
  assert.equal(flag(s, FLAG.floodTruth), true);
  operate(s, "rain-shed", "through");
  assert.equal(s.quests.outcome(RAIN.shed), "through");
  // Act 4: the Loom, the Foreman, the governor back to Bet, then Tomas (who already knows Pell told you).
  talk(s, "bet-kowalczyk", "what", "accept-loom");
  s.bus.emit({ type: "entered", area: "interior:kiln" });
  assert.equal(stage(s, RAIN.loom), "foreman");
  s.bus.emit({ type: "killed", enemy: "foreman-1", archetype: "foreman", faction: "scrappers", tags: ["boss"], encounter: "foreman-yard", x: -576, z: -640, byPlayer: true });
  assert.equal(stage(s, RAIN.loom), "decide");
  talk(s, "bet-kowalczyk", "fit", "more", "accept-trunk");
  assert.equal(s.character.count(ITEM.index), 1);
  assert.equal(s.character.count(ITEM.governor), 0);
  s.talk("tomas");
  assert.ok(s.dialogue?.lines.some(line => line.includes("Agnes Pell")), "Tomas knows Pell told you");
  pick(s, "ask-trunk");
  s.close();
  operate(s, "rain-breaker", "tap");
  assert.equal(s.quests.outcome(RAIN.trunk), "tapped");
  // Act 5: Crane at the Tree (with Lot 77), Juno, and the third way at the annex.
  assert.equal(stage(s, RAIN.lanterns), "tree");
  talk(s, "odessa-crane", "why", "lot77", "listen");
  assert.equal(flag(s, FLAG.lantern), true);
  assert.equal(stage(s, RAIN.finale), "annex");
  talk(s, "juno", "ask-juno");
  operate(s, "rain-annex", "return");
  assert.equal(flag(s, FLAG.ending), "returned");
  talk(s, "nell-ashby", "hand-both");
  assert.equal(s.character.count(ITEM.drive), 0);
  assert.equal(s.character.count(ITEM.key), 0);
  talk(s, "tilly-marsh", "close");
  assert.equal(s.quests.outcome(RAIN.delivery), "returned");
  for (const quest of RAIN_QUESTS) assert.equal(s.quests.status(quest), "complete", quest);

  // One payout per quest: every outcome's credits, minus the 300 cr bribe.
  assert.equal(s.character.credits - start, 120 + 150 + 250 + 100 + 300 + 400 - 300 + 500 + 300 + 1500 + 200);
  assert.equal(s.character.reputation("ghosts"), 6 + 8 + 5);
  assert.equal(s.character.reputation("dockers"), 10);
  const state = JSON.stringify(s.character.state);
  for (const [npc, ids] of [["tilly-marsh", ["report", "accept-run", "close"]], ["ruben-salgado", ["hand-book", "favour"]], ["bet-kowalczyk", ["fit", "keep"]], ["nell-ashby", ["hand-drive", "hand-both"]]] as const) {
    s.talk(npc);
    for (const id of ids) s.choose(id);
    s.close();
  }
  for (const object of ["rain-annex", "rain-shed", "rain-breaker", "rain-relay", "rain-relay-hatch"]) assert.equal(s.quests.interact(object), null, `${object} is gone`);
  for (const quest of RAIN_QUESTS) assert.equal(s.quests.start(quest), false);
  assert.equal(JSON.stringify(s.character.state), state, "nothing pays twice");
  // The world remembers: post-game lines.
  s.talk("nell-ashby");
  assert.ok(s.dialogue?.lines.some(line => line.includes("booth")));
  s.close();
  s.talk("moth-nobody");
  assert.ok(s.dialogue?.lines.some(line => line.includes("delivery list")));
  s.close();
});

for (const final of ["burn", "release"] as const) {
  test(`the hard road: seal, off the books, force, air, tell, pay, fight, burn, keep, cut, then ${final}`, () => {
    const s = session();
    const start = s.character.credits;
    act1(s, false, false);
    act2(s, true, false, true);
    talk(s, "ruben-salgado", "nell-sent", "pay", "next", "accept-shed");
    assert.equal(s.quests.outcome(RAIN.manifest), "paid");
    // Through Morrow's squad.
    s.talk("dace-morrow");
    pick(s, "fight");
    s.close();
    assert.equal(stage(s, RAIN.shed), "checkpoint");
    s.bus.emit({ type: "encounterCleared", encounter: "rain-checkpoint" });
    assert.equal(stage(s, RAIN.shed), "shed");
    operate(s, "rain-shed", "burn");
    assert.equal(s.quests.outcome(RAIN.shed), "burned");
    // Bet greets the burner differently, and the Foreman may already be gone.
    s.talk("bet-kowalczyk");
    assert.ok(s.dialogue?.lines.some(line => line.includes("burned")));
    pick(s, "what");
    pick(s, "accept-loom");
    s.close();
    s.bus.emit({ type: "entered", area: "interior:kiln" });
    s.bus.emit({ type: "killed", enemy: "foreman-1", archetype: "foreman", faction: "scrappers", tags: ["boss"], encounter: "foreman-yard", x: -576, z: -640, byPlayer: true });
    talk(s, "bet-kowalczyk", "keep", "more", "accept-trunk");
    assert.equal(s.character.count(ITEM.governor), 1, "the governor is yours to keep or sell");
    assert.equal(s.character.count(ITEM.index), 0);
    s.talk("tomas");
    assert.ok(!s.dialogue?.lines.some(line => line.includes("Agnes Pell")));
    pick(s, "ask-trunk");
    s.close();
    operate(s, "rain-breaker", "cut");
    assert.equal(s.quests.outcome(RAIN.trunk), "cut");
    s.talk("odessa-crane");
    pick(s, "why");
    assert.ok(has(s, "lot77"));
    pick(s, "accuse");
    s.close();
    // The third way has to be earned: it is shown, greyed, with the reason.
    s.quests.interact("rain-annex");
    const quiet = options(s).find(option => option.id === "return");
    assert.match(String(quiet?.disabled ?? ""), /Lot Index/, "send them home is shown greyed out, with its reason");
    pick(s, final);
    s.close();
    assert.equal(flag(s, FLAG.ending), final === "burn" ? "burned" : "released");
    s.talk("nell-ashby");
    assert.ok(!has(s, "hand-both"), "no key to give back");
    pick(s, "hand-drive");
    s.close();
    talk(s, "tilly-marsh", "close");
    assert.equal(s.quests.outcome(RAIN.delivery), final === "burn" ? "burned" : "released");
    assert.equal(s.character.credits - start, 180 + 150 + 250 + 100 - 200 + 0 + 400 + 500 + 300 + 1500 + 200);
    assert.equal(s.character.reputation("dockers"), 3 + 5);
  });
}

test("a failed tech check at the relay offers the retry and the forced way, and costs nothing", () => {
  const s = session();
  act1(s, true, false);
  const before = JSON.stringify(s.character.state);
  s.quests.interact("rain-relay-hatch"); // the TECH check lives on the service hatch (HACK-HOOK)
  pick(s, "port");
  if (has(s, "slipped")) return; // a strong enough character simply gets in
  assert.ok(has(s, "retry") && has(s, "forced"));
  pick(s, "retry");
  assert.ok(has(s, "port"));
  s.close();
  assert.equal(JSON.stringify(s.character.state), before);
  assert.equal(stage(s, RAIN.stationNobody), "relay");
});

test("a save in the middle of Act 3 restores stages, flags and items, and the act finishes without paying twice", () => {
  const storage = memory();
  const first = session(storage);
  act1(first, true, true);
  act2(first, true, true, true);
  talk(first, "ruben-salgado", "nell-sent", "favour");
  assert.equal(stage(first, RAIN.manifest), "dock-crew");
  const credits = first.character.credits;
  first.save({ ...SPOTS.ruben, yaw: 0 });

  const restored = session(storage);
  assert.equal(restored.quests.stage(RAIN.manifest), "dock-crew");
  assert.equal(restored.quests.outcome(RAIN.undeliverable), "kind");
  assert.equal(restored.quests.flags.get(FLAG.nell), "held");
  assert.equal(restored.quests.flags.get(FLAG.drive), "logged");
  assert.equal(restored.quests.flags.get(FLAG.moth), "aired");
  assert.equal(restored.character.count(ITEM.drive), 1);
  assert.equal(restored.character.count(ITEM.key), 1);
  assert.equal(restored.character.credits, credits);
  const tracked = restored.questSnapshot(null).tracked;
  assert.ok(tracked, "the questline is tracked after a reload");
  restored.bus.emit({ type: "encounterCleared", encounter: "street-lowtide-dock" });
  talk(restored, "ruben-salgado", "hand-book");
  assert.equal(restored.quests.outcome(RAIN.manifest), "favour");
  assert.equal(restored.character.credits, credits + 300);
  restored.talk("ruben-salgado");
  restored.choose("hand-book");
  restored.close();
  assert.equal(restored.character.credits, credits + 300);
});

// ---- HACK-HOOK: the relay cabinet is a hacking terminal ----------------------------------------------

const idle: RpgFrame["input"] = { attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 };
/** A frame with the player standing on the relay cabinet (closer than any street hack target). */
const atRelay = (): RpgFrame => ({ dt: 0.1, time: 1, input: idle, player: { x: SPOTS.relay.x, z: SPOTS.relay.z, eye: 2.7, yaw: 0, pitch: 0, mode: "walk", onFoot: true, place: "" } });

test("HACK-HOOK: the relay carries a medium terminal hack and Act 2 still validates", () => {
  const pack = MAIN.find(p => (p.interactables ?? []).some(it => it.id === "rain-relay"));
  assert.ok(pack, "an act owns the relay");
  assert.deepEqual(validateContent(pack, ALL.filter(other => other !== pack)), [], pack.id);
  const relay = pack.interactables?.find(it => it.id === "rain-relay");
  assert.deepEqual(relay?.hack, { kind: "terminal", tier: "medium", district: 2 });
  assert.equal(relay?.dialogue, undefined, "a breach never opens a dialogue, so the cabinet carries none");
  assert.equal(pack.interactables?.find(it => it.id === "rain-relay-hatch")?.dialogue, "rain.relay", "the TECH check and the pry live on the hatch");
});

test("HACK-HOOK: a breach of the relay advances Station Nobody like the quiet port, once", () => {
  // The dialogue path, for comparison: the TECH check if the stat allows, else the pry.
  const quiet = session();
  act1(quiet, true, false);
  quiet.quests.interact("rain-relay-hatch");
  pick(quiet, "port");
  const slipped = has(quiet, "slipped");
  pick(quiet, slipped ? "slipped" : "forced");
  quiet.close();

  const s = session();
  act1(s, true, false);
  const credits = s.character.credits;
  s.update(atRelay());
  assert.equal(s.interactNearby(), null, "E on the cabinet opens the breach screen, not a dialogue");
  const view = s.snapshot().hack;
  assert.ok(view);
  assert.deepEqual([view.target, view.kind, view.tier], ["rain-relay", "terminal", "medium"]);
  s.action({ kind: "hackResult", attempt: view.attempt, report: { outcome: "success", trace: 0.2, elapsed: 14, mistakes: 0 } });
  assert.equal(s.snapshot().hack?.result?.outcome, "success");
  assert.equal(s.snapshot().hack?.result?.alarm, false);
  s.action({ kind: "closeHack" });

  assert.equal(stage(s, RAIN.stationNobody), stage(quiet, RAIN.stationNobody));
  assert.equal(stage(s, RAIN.stationNobody), "decode");
  assert.equal(s.character.count(ITEM.carrierKey), quiet.character.count(ITEM.carrierKey));
  assert.equal(s.character.count(ITEM.carrierKey), 1);
  assert.equal(flag(s, `${RAIN.stationNobody}.relay`), "slipped", "recorded as the quiet way in");
  if (slipped) assert.equal(flag(s, `${RAIN.stationNobody}.relay`), flag(quiet, `${RAIN.stationNobody}.relay`));
  assert.equal(s.dialogue, null, "no dialogue left open behind the breach screen");
  assert.equal(s.character.credits, credits, "a terminal breach pays nothing itself");
  for (const object of ["rain-relay", "rain-relay-hatch"]) assert.equal(s.quests.interact(object), null, `${object} is gone`);
  assert.equal(s.character.count(ITEM.carrierKey), 1, "nothing pays twice");
  talk(s, "moth-nobody", "know", "drive", "air");
  assert.equal(s.quests.outcome(RAIN.stationNobody), "aired");
});

test("HACK-HOOK: a failed breach locks the cabinet, and the service hatch still gets the card out", () => {
  const s = session();
  act1(s, true, false);
  s.update(atRelay());
  s.interactNearby();
  const view = s.snapshot().hack;
  assert.ok(view);
  s.action({ kind: "hackResult", attempt: view.attempt, report: { outcome: "failed", trace: 1, elapsed: 40, mistakes: 3 } });
  assert.equal(s.snapshot().hack?.result?.outcome, "failed");
  s.action({ kind: "closeHack" });
  s.update(atRelay());
  s.interactNearby();
  assert.equal(s.snapshot().hack, null, "locked out: no second breach screen");
  assert.equal(stage(s, RAIN.stationNobody), "relay");
  assert.equal(s.character.count(ITEM.carrierKey), 0);
  assert.ok(s.quests.interact("rain-relay-hatch"), "the hatch opens its dialogue");
  pick(s, "forced");
  s.close();
  assert.equal(stage(s, RAIN.stationNobody), "decode");
  assert.equal(s.character.count(ITEM.carrierKey), 1);
});
