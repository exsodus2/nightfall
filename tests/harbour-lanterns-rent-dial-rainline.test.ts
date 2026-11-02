import assert from "node:assert/strict";
import test from "node:test";
import { NPCS } from "../src/city/npcs.ts";
import { BLOCK_SIZE, CityWorld, HALF_BLOCKS } from "../src/city/world.ts";
import { CONTENT_PACKS, HARBOUR_WATCH_PACK, NIGHT_OF_LANTERNS_PACK, OFF_THE_DIAL_PACK, RAINLINE_TICKET_PACK, RENT_IS_DUE_PACK } from "../src/rpg/content/index.ts";
import { HARBOUR_WATCH_SPOTS } from "../src/rpg/content/harbour-watch.ts";
import { ITEMS } from "../src/rpg/items/index.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, Effect, Objective } from "../src/rpg/types.ts";

const world = new CityWorld();
const NEW_PACKS = [HARBOUR_WATCH_PACK, NIGHT_OF_LANTERNS_PACK, RENT_IS_DUE_PACK, OFF_THE_DIAL_PACK, RAINLINE_TICKET_PACK];
const ALL = [...CONTENT_PACKS, LEGACY_PACK, { id: "catalogue", items: ITEMS }];

function merge(packs: readonly ContentPack[]): ContentPack {
  return {
    id: "all-content",
    npcs: packs.flatMap(pack => pack.npcs ?? []), items: packs.flatMap(pack => pack.items ?? []), loot: packs.flatMap(pack => pack.loot ?? []),
    archetypes: packs.flatMap(pack => pack.archetypes ?? []), encounters: packs.flatMap(pack => pack.encounters ?? []), quests: packs.flatMap(pack => pack.quests ?? []),
    dialogues: packs.flatMap(pack => pack.dialogues ?? []), interactables: packs.flatMap(pack => pack.interactables ?? []), areas: packs.flatMap(pack => pack.areas ?? []),
    vendors: packs.flatMap(pack => pack.vendors ?? []),
  };
}

test("the five new quest lines are registered and validate alone and with all content", () => {
  for (const pack of NEW_PACKS) {
    assert.ok(CONTENT_PACKS.includes(pack), pack.id);
    assert.deepEqual(validateContent(pack, ALL.filter(other => other !== pack)), [], pack.id);
  }
  assert.deepEqual(validateContent(merge(ALL)), []);
  const quests = NEW_PACKS.flatMap(pack => pack.quests ?? []);
  assert.equal(quests.length, 5);
  for (const quest of quests) {
    assert.ok(quest.stages.filter(stage => stage.objectives.length).length >= 3, `${quest.id} has at least three playable stages`);
    assert.equal(quest.repeatable, undefined, `${quest.id} pays once`);
    assert.ok(quest.stages.every(stage => stage.timeLimit === undefined && !stage.failIf && !stage.failOnDeath), `${quest.id} cannot fail`);
    for (const stage of quest.stages) assert.ok(stage.journal.trim().length > 10, `${quest.id}:${stage.id} has a journal entry`);
    assert.ok(Object.keys(quest.outcomes).length >= 2, `${quest.id} has more than one ending`);
    // Every credit is paid by an outcome, never by a dialogue option or an object.
    for (const outcome of Object.values(quest.outcomes)) assert.equal(outcome.effects?.filter(effect => "credits" in effect).length, 1, `${quest.id} pays once per ending`);
  }
  const text = JSON.stringify(NEW_PACKS);
  assert.ok(/^[\x20-\x7e]*$/.test(text), "every string is printable ASCII");
  for (const pack of NEW_PACKS) {
    for (const dialogue of pack.dialogues ?? []) for (const node of dialogue.nodes) for (const option of node.options) {
      assert.ok(!option.effects?.some(effect => "credits" in effect), `${dialogue.id}:${option.id} pays nothing directly`);
    }
    for (const object of pack.interactables ?? []) assert.ok(!object.effects?.some(effect => "credits" in effect), `${object.id} pays nothing`);
  }
});

// ---- Placement ---------------------------------------------------------------------------------

/** True when (x, z) connects by walking (1 m grid, 4-neighbour) to the street grid. */
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

interface Spot { what: string; x: number; z: number; exact: boolean }

function spots(pack: ContentPack): Spot[] {
  const out: Spot[] = [];
  const npcs = new Map([...NPCS, ...ALL.flatMap(p => p.npcs ?? [])].map(npc => [npc.id, npc]));
  const things = new Map((pack.interactables ?? []).map(it => [it.id, it]));
  const dialogues = new Map(ALL.flatMap(p => p.dialogues ?? []).map(d => [d.id, d]));
  const at = (what: string, p: { x: number; z: number } | undefined, exact = true) => { if (p) out.push({ what, x: p.x, z: p.z, exact }); };
  for (const npc of pack.npcs ?? []) at(`npc ${npc.id}`, npc);
  for (const it of pack.interactables ?? []) at(`interactable ${it.id}`, it);
  const effects = (where: string, list: readonly Effect[] | undefined) => { for (const e of list ?? []) if ("waypoint" in e) at(`${where} waypoint`, e.waypoint); };
  const target = (o: Objective): { x: number; z: number } | undefined => {
    if (o.target) return o.target;
    switch (o.kind) {
      case "talk": case "deliver": return npcs.get(o.npc);
      case "interact": return things.get(o.object);
      case "reach": return o.area;
      case "choose": { const speaker = dialogues.get(o.dialogue)?.npc ?? ""; return npcs.get(speaker) ?? things.get(speaker); }
      default: return undefined;
    }
  };
  for (const quest of pack.quests ?? []) {
    const giver = quest.giver ? npcs.get(quest.giver) : undefined;
    assert.ok(giver, `${quest.id} has a standing giver`);
    for (const stage of quest.stages) {
      effects(`${quest.id}:${stage.id}`, stage.onEnter); effects(`${quest.id}:${stage.id}`, stage.onComplete);
      for (const o of stage.objectives) {
        const p = target(o);
        assert.ok(p, `${quest.id}:${stage.id}:${o.id} has a tracker target`);
        at(`${quest.id}:${stage.id}:${o.id} target`, p, false);
      }
    }
  }
  return out;
}

for (const pack of NEW_PACKS) {
  test(`${pack.id}: every NPC, object and quest target stands on clear ground joined to the streets`, () => {
    const list = spots(pack);
    assert.ok(list.length >= 5);
    for (const spot of list) {
      if (spot.exact) assert.ok(world.canOccupy(spot.x, spot.z), `${spot.what} at ${spot.x},${spot.z} is inside something`);
      assert.ok(reachesStreets(spot.x, spot.z), `${spot.what} at ${spot.x},${spot.z} cannot be walked to from a street`);
    }
  });
}

test("new givers keep 6 m from every other NPC and new objects keep clear of other packs' objects", () => {
  const everyone = [...NPCS, ...ALL.flatMap(pack => pack.npcs ?? [])];
  const outdoor = ALL.flatMap(pack => (pack.interactables ?? []).filter(it => !it.place).map(it => ({ pack: pack.id, it })));
  for (const pack of NEW_PACKS) {
    for (const npc of pack.npcs ?? []) {
      for (const other of everyone) if (other.id !== npc.id) assert.ok(Math.hypot(other.x - npc.x, other.z - npc.z) >= 6, `${npc.id} is too close to ${other.id}`);
      for (const { it } of outdoor) assert.ok(Math.hypot(it.x - npc.x, it.z - npc.z) >= 3, `${npc.id} stands on ${it.id}`);
    }
    for (const object of pack.interactables ?? []) {
      assert.equal(object.place, undefined, `${object.id} is outdoors`);
      for (const other of outdoor) if (other.pack !== pack.id) assert.ok(Math.hypot(other.it.x - object.x, other.it.z - object.z) >= 3, `${object.id} overlaps ${other.it.id}`);
    }
  }
});

// ---- Playthroughs -------------------------------------------------------------------------------

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function session(storage?: ReturnType<typeof memory>): RpgSession { return new RpgSession({ world, packs: CONTENT_PACKS, storage }); }
const options = (s: RpgSession) => s.dialogue?.options ?? [];
const has = (s: RpgSession, id: string) => options(s).some(option => option.id === id && !option.disabled);
const greyed = (s: RpgSession, id: string) => options(s).some(option => option.id === id && option.disabled);
const usable = (s: RpgSession, object: string) => s.quests.interactables().some(it => it.id === object);

function accept(s: RpgSession, npc: string, quest: string, acceptId: string) {
  s.talk(npc);
  assert.ok(has(s, acceptId), `${npc} offers ${quest}`);
  s.choose(acceptId);
  s.close();
  assert.equal(s.quests.status(quest), "active");
}
function use(s: RpgSession, object: string, ...picks: string[]) {
  assert.ok(usable(s, object), `${object} is usable`);
  s.quests.interact(object);
  for (const pick of picks) { assert.ok(has(s, pick), `${object} offers ${pick}`); s.choose(pick); }
  s.close();
}
function say(s: RpgSession, npc: string, ...picks: string[]) {
  s.talk(npc);
  for (const pick of picks) { assert.ok(has(s, pick), `${npc} offers ${pick}`); s.choose(pick); }
  s.close();
}
/** After an ending: the giver only says goodbye, and nothing pays twice. */
function settled(s: RpgSession, npc: string, quest: string, acceptId: string) {
  const sheet = s.character.serialize();
  for (let i = 0; i < 2; i++) {
    s.talk(npc);
    assert.ok(!has(s, acceptId));
    assert.deepEqual(options(s).map(option => option.id).filter(id => !id.startsWith("@")), ["leave"]);
    s.close();
  }
  assert.equal(s.quests.start(quest), false);
  assert.deepEqual(s.character.serialize(), sheet);
}

// Harbour Watch.
for (const [envelope, log, outcome, pay] of [["refuse", "file-signal", "reported", 160], ["take", "file-clean", "pocketed", 220], ["take", "file-signal", "double", 300]] as const) {
  test(`Harbour Watch: ${envelope} the envelope, ${log} -> ${outcome}`, () => {
    const s = session();
    assert.ok(!usable(s, "hw-scope-stairs"), "the scopes wait for the job");
    s.talk("kaito-brann"); assert.ok(!has(s, "take"), "Brann has nothing to offer yet"); s.close();
    accept(s, "ines-varga", "harbour-watch", "accept-watch");
    use(s, "hw-scope-stairs");
    assert.ok(!usable(s, "hw-scope-stairs"), "a logged scope stays logged");
    use(s, "hw-scope-bollard");
    assert.equal(s.quests.stage("harbour-watch"), "watch");
    // Walking the quay road west completes the stern-side log as well as riding past it.
    s.quests.update(0.1, { x: HARBOUR_WATCH_SPOTS.carriage.x, z: HARBOUR_WATCH_SPOTS.carriage.z });
    assert.equal(s.quests.stage("harbour-watch"), "brann");
    s.talk("ines-varga"); assert.ok(!has(s, "file-signal"), "nothing to file before Brann"); s.close();
    say(s, "kaito-brann", "ask", "back", envelope);
    assert.equal(s.quests.stage("harbour-watch"), "file");
    s.talk("ines-varga");
    if (envelope === "refuse") assert.ok(greyed(s, "file-clean"), "no reason to lie without the envelope");
    const credits = s.character.credits;
    assert.ok(has(s, log)); s.choose(log); s.close();
    assert.equal(s.quests.outcome("harbour-watch"), outcome);
    assert.equal(s.character.credits - credits, pay);
    assert.equal(s.quests.flags.get("harbour.watch"), outcome);
    settled(s, "ines-varga", "harbour-watch", "accept-watch");
  });
}

test("Harbour Watch: the stern-side log also completes from a Rim Line carriage on the track", () => {
  const s = session();
  accept(s, "ines-varga", "harbour-watch", "accept-watch");
  s.quests.update(0.1, { x: -203, z: 768 });
  assert.equal(s.quests.flags.get("harbour-watch.carriage"), true);
  assert.ok(world.canOccupy(HARBOUR_WATCH_SPOTS.carriage.x, HARBOUR_WATCH_SPOTS.carriage.z), "and the walking spot is on the quay");
});

// Night of Lanterns.
for (const [wish, outcome] of [["wish-rain", "rain"], ["wish-gone", "gone"], ["wish-rent", "rent"]] as const) {
  test(`Night of Lanterns: ${wish} -> ${outcome}, one equal fee`, () => {
    const s = session();
    accept(s, "sumi-haro", "night-of-lanterns", "accept-lanterns");
    assert.ok(!usable(s, "nl-ring"), "the ring waits for the wish");
    for (const pickup of ["nl-lamppost", "nl-cart", "nl-teahouse"]) { use(s, pickup); assert.ok(!usable(s, pickup), `${pickup} is used up`); }
    assert.equal(s.character.count("sky-lantern"), 3);
    assert.equal(s.quests.stage("night-of-lanterns"), "wish");
    // Without all three lanterns the wish is refused, not lost.
    s.character.remove("sky-lantern", 1);
    s.talk("sumi-haro"); assert.ok(greyed(s, wish)); s.close();
    s.character.add("sky-lantern", 1);
    say(s, "sumi-haro", wish);
    assert.equal(s.quests.stage("night-of-lanterns"), "release");
    const credits = s.character.credits;
    use(s, "nl-ring", "release");
    assert.equal(s.character.count("sky-lantern"), 0);
    assert.equal(s.quests.outcome("night-of-lanterns"), outcome);
    assert.equal(s.character.credits - credits, 90);
    assert.equal(s.quests.flags.get("lanterns.wish"), outcome);
    assert.ok(!usable(s, "nl-ring"));
    settled(s, "sumi-haro", "night-of-lanterns", "accept-lanterns");
  });
}

// Rent Is Due.
for (const [verdict, report, outcome] of [["expose", "report-expose", "exposed"], ["turn", "report-turn", "turned"]] as const) {
  test(`Rent Is Due: wrong guesses cost nothing, then ${verdict} -> ${outcome}`, () => {
    const s = session();
    assert.ok(!usable(s, "rd-laszlo"), "the marchers only stand there during the job");
    accept(s, "dee-okafor", "rent-is-due", "accept-rent");
    use(s, "rd-press");
    assert.equal(s.character.count("placard-bundle"), 1);
    assert.equal(s.quests.stage("rent-is-due"), "deliver");
    // A lost bundle can be fetched again.
    s.character.remove("placard-bundle", 1);
    use(s, "rd-press");
    assert.ok(!usable(s, "rd-press"), "one bundle at a time");
    say(s, "dee-okafor", "@deliver:rent-is-due:placards");
    assert.equal(s.character.count("placard-bundle"), 0);
    assert.equal(s.quests.stage("rent-is-due"), "informant");
    for (const marcher of ["rd-pim", "rd-oona", "rd-laszlo"]) use(s, marcher);
    const sheet = s.character.serialize();
    say(s, "dee-okafor", "accuse", "accuse-pim", "again-pim", "accuse-oona", "again-oona");
    assert.equal(s.quests.stage("rent-is-due"), "informant");
    assert.deepEqual(s.character.serialize(), sheet);
    say(s, "dee-okafor", "accuse", "accuse-laszlo");
    assert.equal(s.quests.stage("rent-is-due"), "verdict");
    assert.ok(!usable(s, "rd-pim") && usable(s, "rd-laszlo"));
    use(s, "rd-laszlo", verdict);
    assert.equal(s.quests.stage("rent-is-due"), "report");
    const credits = s.character.credits;
    say(s, "dee-okafor", report);
    assert.equal(s.quests.outcome("rent-is-due"), outcome);
    assert.equal(s.character.credits - credits, 150);
    assert.equal(s.quests.flags.get("spillway.march"), outcome);
    settled(s, "dee-okafor", "rent-is-due", "accept-rent");
  });
}

test("Rent Is Due: after the march, Dee remembers a rent wish from the Last Tree", () => {
  const s = session();
  accept(s, "sumi-haro", "night-of-lanterns", "accept-lanterns");
  for (const pickup of ["nl-cart", "nl-teahouse", "nl-lamppost"]) use(s, pickup);
  say(s, "sumi-haro", "wish-rent");
  use(s, "nl-ring", "release");
  assert.equal(s.quests.flags.get("lanterns.wish"), "rent");
  accept(s, "dee-okafor", "rent-is-due", "accept-rent");
  s.talk("dee-okafor"); assert.ok(!s.dialogue?.lines.some(line => line.includes("LET THE RENT FALL")), "not while the job runs"); s.close();
  use(s, "rd-press");
  say(s, "dee-okafor", "@deliver:rent-is-due:placards");
  say(s, "dee-okafor", "accuse", "accuse-laszlo");
  use(s, "rd-laszlo", "turn");
  say(s, "dee-okafor", "report-turn");
  assert.equal(s.quests.outcome("rent-is-due"), "turned");
  s.talk("dee-okafor");
  assert.ok(s.dialogue?.lines.some(line => line.includes("LET THE RENT FALL")));
  s.close();
});

// Off the Dial.
for (const [give, outcome, faction] of [["give-open", "open", "civilian"], ["give-ghosts", "ghosts", "ghosts"], ["give-razor", "razorbacks", "razorbacks"]] as const) {
  test(`Off the Dial: every wrong step at the mast is refused, the mast remembers across a reload, ${give} -> ${outcome}`, () => {
    const storage = memory();
    let s = session(storage);
    accept(s, "vesper-quill", "off-the-dial", "accept-dial");
    assert.ok(!usable(s, "od-mast"), "the mast waits for the crystal");
    use(s, "od-satchel");
    assert.equal(s.character.count("crystal-oscillator"), 1);
    assert.equal(s.quests.stage("off-the-dial"), "restore");
    assert.ok(!usable(s, "od-satchel"), "one crystal");
    const sheet = s.character.serialize();
    use(s, "od-mast", "seat-three", "retry-seat");
    assert.deepEqual(s.character.serialize(), sheet);
    use(s, "od-mast", "seat-nine", "power-now", "retry-ground");
    assert.equal(s.character.count("crystal-oscillator"), 0);
    s.save();
    s = session(storage);
    assert.equal(s.quests.stage("off-the-dial"), "restore");
    s.quests.interact("od-mast");
    assert.ok(has(s, "clip-strap"), "the mast reopens at step 2");
    s.choose("clip-strap"); s.choose("tune-931"); s.choose("retry-tune");
    assert.equal(s.quests.stage("off-the-dial"), "restore");
    s.choose("tune-913"); s.close();
    assert.equal(s.quests.stage("off-the-dial"), "frequency");
    const credits = s.character.credits, rep = s.character.reputation(faction);
    say(s, "vesper-quill", give);
    assert.equal(s.quests.outcome("off-the-dial"), outcome);
    assert.equal(s.character.credits - credits, 220);
    assert.ok(s.character.reputation(faction) > rep);
    assert.equal(s.quests.flags.get("ghost.dial"), outcome);
    settled(s, "vesper-quill", "off-the-dial", "accept-dial");
  });
}

test("Off the Dial: a crystal dropped before it is seated can be picked up again at the satchel", () => {
  const s = session();
  accept(s, "vesper-quill", "off-the-dial", "accept-dial");
  use(s, "od-satchel");
  s.character.remove("crystal-oscillator", 1);
  s.quests.interact("od-mast");
  assert.ok(greyed(s, "seat-nine"));
  s.close();
  use(s, "od-satchel");
  use(s, "od-mast", "seat-nine");
  assert.equal(s.quests.flags.get("off-the-dial.seated"), true);
  assert.ok(!usable(s, "od-satchel"));
});

// Rainline Ticket.
for (const [call, outcome] of [["close", "closed"], ["half", "half"]] as const) {
  test(`Rainline Ticket: readings south to north, then ${call} -> ${outcome}`, () => {
    const s = session();
    accept(s, "teodor-lusk", "rainline-ticket", "accept-rainline");
    assert.ok(!usable(s, "rl-tower") && !usable(s, "rl-drive"), "readings go in order");
    use(s, "rl-anchor"); assert.equal(s.quests.stage("rainline-ticket"), "tower");
    use(s, "rl-tower"); assert.equal(s.quests.stage("rainline-ticket"), "drive");
    s.quests.interact("rl-drive"); s.choose("leave");
    assert.equal(s.quests.stage("rainline-ticket"), "drive", "walking away from the phone decides nothing");
    const credits = s.character.credits;
    use(s, "rl-drive", call);
    assert.equal(s.quests.outcome("rainline-ticket"), outcome);
    assert.equal(s.character.credits - credits, 170);
    assert.equal(s.quests.flags.get("rainline.state"), outcome);
    assert.ok(!usable(s, "rl-drive"));
    settled(s, "teodor-lusk", "rainline-ticket", "accept-rainline");
  });
}
