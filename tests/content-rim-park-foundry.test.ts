import assert from "node:assert/strict";
import test from "node:test";
import { BLOCK_SIZE, CityWorld, HALF_BLOCKS } from "../src/city/world.ts";
import { CONTENT_PACKS, COLD_IRON_PACK, RIM_LINE_PACK, ROOTWOOD_PACK } from "../src/rpg/content/index.ts";
import { ITEMS } from "../src/rpg/items/index.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, Effect, Objective } from "../src/rpg/types.ts";

const world = new CityWorld();
const NEW_PACKS = [RIM_LINE_PACK, ROOTWOOD_PACK, COLD_IRON_PACK];
const ALL = [...CONTENT_PACKS, LEGACY_PACK, { id: "catalogue", items: ITEMS }];
const NEW_ITEMS = ["underscore", "carriage-return", "full-stop", "modulo", "line-feed", "flood-wall", "port-scanner", "harbour-kelp", "pylon-insulator"];
const DPS_BAND: Record<string, readonly [number, number]> = { common: [28, 36], uncommon: [35, 45], rare: [50, 70], epic: [78, 102], legendary: [112, 122] };

function merge(packs: readonly ContentPack[]): ContentPack {
  return {
    id: "all-content",
    npcs: packs.flatMap(pack => pack.npcs ?? []), items: packs.flatMap(pack => pack.items ?? []), loot: packs.flatMap(pack => pack.loot ?? []),
    archetypes: packs.flatMap(pack => pack.archetypes ?? []), encounters: packs.flatMap(pack => pack.encounters ?? []), quests: packs.flatMap(pack => pack.quests ?? []),
    dialogues: packs.flatMap(pack => pack.dialogues ?? []), interactables: packs.flatMap(pack => pack.interactables ?? []), areas: packs.flatMap(pack => pack.areas ?? []),
    vendors: packs.flatMap(pack => pack.vendors ?? []),
  };
}

test("rim, park and foundry packs are registered and validate alone and with all content", () => {
  for (const pack of NEW_PACKS) {
    assert.ok(CONTENT_PACKS.includes(pack), pack.id);
    assert.deepEqual(validateContent(pack, ALL.filter(other => other !== pack)), [], pack.id);
  }
  assert.deepEqual(validateContent(merge(ALL)), []);
  const quests = NEW_PACKS.flatMap(pack => pack.quests ?? []);
  assert.ok(quests.length >= 8, "eight or more new quests");
  for (const quest of quests) {
    assert.ok(quest.stages.length >= 3, `${quest.id} has at least three stages`);
    for (const stage of quest.stages) assert.ok(stage.journal.trim().length > 10, `${quest.id}:${stage.id} has a journal entry`);
    const choice = quest.stages.some(stage => stage.objectives.some(objective => objective.kind === "choose" && objective.options.length > 1) || stage.mode === "any");
    assert.ok(choice, `${quest.id} has a real choice`);
    assert.ok(Object.keys(quest.outcomes).length >= 2, `${quest.id} has more than one ending`);
  }
});

// ---- Walkability -------------------------------------------------------------------------------

/** True when (x, z) connects by walking (1 m grid, 4-neighbour) to the street grid: a walkable cell
 * on a street centre line inside the city (every multiple of 64 m except the rim edge). */
function reachesStreets(x: number, z: number): boolean {
  const limit = HALF_BLOCKS * BLOCK_SIZE - BLOCK_SIZE;
  const onStreet = (cx: number, cz: number) => (Math.abs(cx - Math.round(cx / BLOCK_SIZE) * BLOCK_SIZE) <= 1.5 && Math.abs(cx) <= limit)
    || (Math.abs(cz - Math.round(cz / BLOCK_SIZE) * BLOCK_SIZE) <= 1.5 && Math.abs(cz) <= limit);
  const R = 140, size = R * 2 + 1, seen = new Uint8Array(size * size);
  const ox = Math.round(x), oz = Math.round(z);
  const queue: number[] = [];
  // Start from the nearest walkable cell within 3 m (interactables may sit on a prop's edge).
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
  const npcs = new Map([...ALL.flatMap(p => p.npcs ?? []), ...(pack.npcs ?? [])].map(npc => [npc.id, npc]));
  const things = new Map((pack.interactables ?? []).map(it => [it.id, it]));
  const encounters = new Map((pack.encounters ?? []).map(enc => [enc.id, enc]));
  const dialogues = new Map(ALL.flatMap(p => p.dialogues ?? []).map(d => [d.id, d]));
  const at = (what: string, p: { x: number; z: number } | undefined, exact = true) => { if (p) out.push({ what, x: p.x, z: p.z, exact }); };
  for (const npc of pack.npcs ?? []) at(`npc ${npc.id}`, npc);
  for (const it of pack.interactables ?? []) at(`interactable ${it.id}`, it);
  for (const enc of pack.encounters ?? []) {
    at(`encounter ${enc.id} centre`, enc.area);
    enc.members.forEach((m, i) => { at(`encounter ${enc.id} member ${i}`, m); for (const p of m.patrol ?? []) at(`encounter ${enc.id} patrol`, p); });
  }
  const effects = (where: string, list: readonly Effect[] | undefined) => { for (const e of list ?? []) if ("waypoint" in e) at(`${where} waypoint`, e.waypoint); };
  const target = (o: Objective): { x: number; z: number } | undefined => {
    if (o.target) return o.target;
    switch (o.kind) {
      case "talk": case "deliver": return npcs.get(o.npc);
      case "interact": return things.get(o.object);
      case "reach": return o.area;
      case "survive": return o.area;
      case "clear": return encounters.get(o.encounter)?.area;
      case "kill": return o.encounter ? encounters.get(o.encounter)?.area : undefined;
      case "choose": { const speaker = dialogues.get(o.dialogue)?.npc ?? ""; return npcs.get(speaker) ?? things.get(speaker); }
      default: return undefined;
    }
  };
  for (const quest of pack.quests ?? []) {
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
  test(`${pack.id}: every NPC, object, enemy and quest target stands on clear ground joined to the streets`, () => {
    const list = spots(pack);
    assert.ok(list.length > 10);
    for (const spot of list) {
      if (spot.exact) assert.ok(world.canOccupy(spot.x, spot.z), `${spot.what} at ${spot.x},${spot.z} is inside something`);
      assert.ok(reachesStreets(spot.x, spot.z), `${spot.what} at ${spot.x},${spot.z} cannot be walked to from a street`);
    }
  });
}

// ---- Items -------------------------------------------------------------------------------------

test("the rim items fit their tiers, have sources and are printable", () => {
  const byId = new Map(ITEMS.map(item => [item.id, item]));
  const packs = merge(CONTENT_PACKS);
  const sold = new Set((packs.vendors ?? []).flatMap(vendor => vendor.stock));
  const dropped = new Set((packs.loot ?? []).flatMap(table => table.entries.map(entry => entry.item)));
  const given = new Set(JSON.stringify(packs).match(/"give":"[a-z0-9-]+"/g)?.map(match => match.slice(8, -1)) ?? []);
  for (const id of NEW_ITEMS) {
    const item = byId.get(id);
    assert.ok(item, id);
    assert.ok(sold.has(id) || dropped.has(id) || given.has(id), `${id} can be found, bought or earned`);
    const w = item.weapon;
    if (w) {
      const dps = w.damage * (w.pellets ?? 1) / w.cooldown, [low, high] = DPS_BAND[item.rarity];
      assert.ok(dps >= low && dps <= high, `${id} dps ${dps.toFixed(1)} inside ${item.rarity}`);
    }
  }
  // Salt's stall is a rim vendor and sells the harbour kit.
  const salt = (packs.vendors ?? []).find(vendor => vendor.npc === "salt");
  assert.ok(salt && ["harbour-kelp", "underscore", "full-stop", "port-scanner"].every(id => salt.stock.includes(id)));
});

// ---- Playthroughs -------------------------------------------------------------------------------

function session(): RpgSession { return new RpgSession({ world, packs: CONTENT_PACKS }); }
const options = (s: RpgSession) => s.dialogue?.options ?? [];
const has = (s: RpgSession, id: string) => options(s).some(option => option.id === id && !option.disabled);

function accept(s: RpgSession, npc: string, quest: string, acceptId: string) {
  s.talk(npc);
  assert.ok(has(s, `ask-${quest}`), `${npc} offers ${quest}`);
  s.choose(`ask-${quest}`);
  assert.ok(has(s, acceptId), `${quest} offer opens`);
  s.choose(acceptId);
  s.close();
  assert.equal(s.quests.status(quest), "active");
}
function use(s: RpgSession, object: string, option?: string) {
  assert.ok(s.quests.interactables().some(it => it.id === object), `${object} is usable`);
  s.quests.interact(object);
  if (option) { assert.ok(has(s, option), `${object} offers ${option}`); s.choose(option); }
  s.close();
}
const cleared = (s: RpgSession, encounter: string) => s.bus.emit({ type: "encounterCleared", encounter });
function report(s: RpgSession, npc: string, option: string) {
  s.talk(npc);
  assert.ok(has(s, option), `${npc} takes report ${option}`);
  s.choose(option);
  s.close();
}

for (const price of ["cheap", "dear"] as const) {
  test(`Brine Run: the ${price} price changes the pay, the oilskin and the Spillway's water`, () => {
    const s = session();
    accept(s, "salt", "brine-run", "accept-brine");
    s.talk("pell");
    assert.ok(!has(s, price), "Pell cannot be paid before the crate is collected");
    s.close();
    use(s, "rim-crate");
    assert.equal(s.character.count("membrane-crate"), 1);
    assert.equal(s.quests.stage("brine-run"), "jacked");
    cleared(s, "rim-tide-crew");
    s.talk("pell"); s.choose(price); s.close();
    assert.equal(s.character.count("membrane-crate"), 0);
    assert.equal(s.character.count("flood-wall"), price === "cheap" ? 1 : 0);
    const before = s.character.credits;
    report(s, "salt", `collect-${price}`);
    assert.equal(s.quests.outcome("brine-run"), price);
    assert.equal(s.character.credits - before, price === "cheap" ? 100 : 240);
    assert.equal(s.quests.flags.get("rim.still"), price);
  });
}

test("Mast Tap: the open-channel route needs Mira's public channel; holding the yard copies the key", () => {
  const s = session();
  accept(s, "wick", "mast-tap", "accept-mast");
  use(s, "rim-mast-box");
  assert.equal(s.quests.stage("mast-tap"), "hold");
  for (let t = 0; t < 30; t++) s.quests.update(1, { x: 736, z: -650 });
  assert.equal(s.quests.stage("mast-tap"), "hold", "leaving the yard pauses the copy");
  for (let t = 0; t < 410; t++) s.quests.update(0.1, { x: 736, z: -724 });
  assert.equal(s.quests.stage("mast-tap"), "route");
  s.quests.interact("rim-mast-feed");
  assert.ok(options(s).some(option => option.id === "open" && option.disabled), "open route greyed out without the night-shift channel");
  s.choose("wick"); s.close();
  report(s, "wick", "report-wick");
  assert.equal(s.quests.outcome("mast-tap"), "ghost");
  assert.equal(s.quests.flags.get("rim.mast"), "ghost");
  assert.equal(s.character.reputation("ghosts"), 10);
});

test("The Floodgate Lift: covering for Hollis earns his wrench and Odile's lighter purse", () => {
  const s = session();
  accept(s, "odile", "floodgate-lift", "accept-lift");
  use(s, "rim-lift-panel");
  s.quests.update(0.1, { x: -746, z: 64 });
  assert.equal(s.quests.stage("floodgate-lift"), "strippers");
  cleared(s, "rim-culvert-crew");
  use(s, "rim-hollis", "cover");
  assert.equal(s.character.count("carriage-return"), 1);
  report(s, "odile", "report-cover");
  assert.equal(s.quests.outcome("floodgate-lift"), "covered");
  assert.equal(s.quests.flags.get("rim.hollis"), "covered");
});

test("Lantern Walk then Survey Stakes: holding Pip changes Billie's story, and buying the tablet ends it quietly", () => {
  const s = session();
  accept(s, "billie", "lantern-walk", "accept-lanterns");
  s.quests.update(0.1, { x: -544, z: 226 });
  cleared(s, "rw-strippers");
  use(s, "rw-cart");
  use(s, "rw-lookout", "hold");
  assert.equal(s.character.count("lantern-coil"), 6);
  s.talk("billie");
  assert.ok(has(s, "@deliver:lantern-walk:coils-back"));
  s.choose("@deliver:lantern-walk:coils-back"); s.close();
  assert.equal(s.quests.outcome("lantern-walk"), "held");
  assert.equal(s.quests.flags.get("rootwood.lookout"), "held");

  accept(s, "billie", "survey-stakes", "accept-survey");
  for (const stake of ["rw-stake-pond", "rw-stake-koi", "rw-stake-moth"]) use(s, stake);
  assert.equal(s.quests.stage("survey-stakes"), "crew");
  s.quests.interact("rw-surveyor");
  const argue = options(s).find(option => option.id === "argue");
  assert.ok(argue && /TECH/.test(argue.label), "the tech check is shown up front");
  s.close();
  const credits = s.character.credits;
  assert.ok(credits >= 200, "Lantern Walk paid enough for the bribe");
  use(s, "rw-surveyor", "bought");
  assert.equal(s.character.credits, credits - 200);
  assert.equal(s.quests.stage("survey-stakes"), "report");
  report(s, "billie", "report-quiet");
  assert.equal(s.quests.outcome("survey-stakes"), "scrubbed");
});

test("Cold Iron arc: a pocketed relay pays at Nix, the ledger goes to the Ghosts, and Kettle goes with it", () => {
  const s = session();
  accept(s, "brakka", "stack-relay", "accept-stack");
  s.quests.update(0.1, { x: -734, z: -726 });
  cleared(s, "ci-stack-ghosts");
  use(s, "ci-relay", "pocket");
  assert.equal(s.character.count("ghost-relay"), 1);
  report(s, "brakka", "report-pocket");
  assert.equal(s.quests.outcome("stack-relay"), "pocketed");

  s.talk("nix");
  const credits = s.character.credits;
  assert.ok(has(s, "give-relay"), "Nix opens with the relay in your pocket");
  s.choose("give-relay");
  assert.equal(s.character.credits - credits, 120);
  s.choose("accept-ledgers-2"); s.close();
  assert.equal(s.quests.status("two-ledgers"), "active");
  use(s, "ci-lockbox");
  s.talk("nix");
  s.choose("@deliver:two-ledgers:to-nix"); s.close();
  assert.equal(s.quests.outcome("two-ledgers"), "nix");
  assert.equal(s.quests.status("cold-iron"), "active");
  assert.equal(s.quests.stage("cold-iron"), "brief-nix");

  report(s, "nix", "go-nix");
  s.quests.update(0.1, { x: -722, z: -720 });
  cleared(s, "ci-kettle-meet");
  s.quests.interact("ci-kettle-down");
  s.choose("persuade");
  assert.ok(s.dialogue?.lines.some(line => line.includes("same rope")), "a weak COOL check is refused, and the other choices stay open");
  s.choose("back");
  s.choose("to-nix"); s.close();
  assert.equal(s.quests.outcome("cold-iron"), "wire");
  assert.equal(s.quests.flags.get("foundry.truce"), "ghosts");
  assert.equal(s.character.count("null-hood"), 1);
});
