// Street encounters (rpg/content/encounters.ts) and the combat forms behind them (rpg/combat/forms.ts):
// placement (walkable, outside safe zones, off the avenue), respawn timers and out-of-sight respawns,
// the four forms' telegraphs and hit rules, hit-stop, the Foreman's phases and prize, CorpSec
// responding to crimes, tiered loot odds, and the HUD's threat cue and soft hit vignette.
import assert from "node:assert/strict";
import test from "node:test";
import { interiorPlaces } from "../src/city/interiors.ts";
import { NPCS } from "../src/city/npcs.ts";
import { PARK } from "../src/city/park.ts";
import { CityWorld, SPAWN, STATION_SITES } from "../src/city/world.ts";
import { EventBus } from "../src/rpg/events.ts";
import { COMBAT_TEST_ARCHETYPES, COMBAT_TEST_ITEMS, CombatWorld, HIT_STOP, LEASH, LUNGE, RUSH, SIM_RADIUS, enemyForm, seededRandom, type CombatSave } from "../src/rpg/combat/index.ts";
import { CONTENT_PACKS, FACTIONS_PACK } from "../src/rpg/content/index.ts";
import { FOREMAN_YARD, STREET_ENCOUNTERS_PACK } from "../src/rpg/content/encounters.ts";
import { ITEMS, ItemRegistry, LOOT_TABLES, LootSystem, seededRng } from "../src/rpg/items/index.ts";
import { lootOdds } from "../src/rpg/items/loot.ts";
import { LEGACY_PACK, validateContent } from "../src/rpg/quests/index.ts";
import { combatHudLayout, hitVignetteLevel, hitVignetteTarget, threatAlpha, threatCue, threatCueSlot, THREAT_LIFE } from "../src/rpg/scene/index.ts";
import type { CombatCharacter, ConsumableStats, EncounterDefinition, EnemyArchetype, EnemyView, GameEvent, ItemDefinition, RpgInput, WeaponSlot } from "../src/rpg/types.ts";

const world = new CityWorld();
const PACK = STREET_ENCOUNTERS_PACK;
const ENCOUNTERS = PACK.encounters ?? [];
const ARCHETYPES: readonly EnemyArchetype[] = [...COMBAT_TEST_ARCHETYPES, ...(FACTIONS_PACK.archetypes ?? []), ...(PACK.archetypes ?? [])];
const ITEM_DB = new Map<string, ItemDefinition>([...ITEMS, ...COMBAT_TEST_ITEMS, ...(PACK.items ?? [])].map(item => [item.id, item]));
const arch = (id: string): EnemyArchetype => { const a = ARCHETYPES.find(x => x.id === id); assert.ok(a, id); return a; };
const enc = (id: string): EncounterDefinition => { const e = ENCOUNTERS.find(x => x.id === id); assert.ok(e, id); return e; };

// ---- A small driver (as tests/rpg-combat.test.ts) ----------------------------------------------------

class TestCharacter implements CombatCharacter {
  weapons: Partial<Record<WeaponSlot, string>> = { melee: "combat-test-blade", sidearm: "combat-test-pistol" };
  mags: Record<string, number> = { "combat-test-pistol": 8 };
  reserves: Record<string, number> = { "combat-test-9mm": 40 };
  maxHealth = 100000; maxStamina = 100; protection = 0; damageBonus = 1;
  weaponFor(slot: WeaponSlot): ItemDefinition | null { const id = this.weapons[slot]; return id ? ITEM_DB.get(id) ?? null : null; }
  loaded(id: string): number { return this.mags[id] ?? 0; }
  reserve(ammo: string): number { return this.reserves[ammo] ?? 0; }
  reload(id: string): number {
    const w = ITEM_DB.get(id)?.weapon;
    if (!w?.ammo) return 0;
    const n = Math.min((w.magazine ?? 0) - this.loaded(id), this.reserve(w.ammo));
    this.mags[id] = this.loaded(id) + n; this.reserves[w.ammo] -= n;
    return n;
  }
  spendRound(id: string): boolean { if (this.loaded(id) <= 0) return false; this.mags[id]--; return true; }
  useQuick(): ConsumableStats | null { return null; }
}
const idle = (): RpgInput => ({ attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 });

class Harness {
  bus = new EventBus();
  events: GameEvent[] = [];
  cw: CombatWorld;
  character = new TestCharacter();
  time = 0;
  x: number; z: number; yaw: number;
  constructor(x: number, z: number, yaw: number, encounters: readonly EncounterDefinition[], archetypes: readonly EnemyArchetype[] = ARCHETYPES) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.bus.onAny(event => this.events.push(event));
    this.cw = new CombatWorld({ world, bus: this.bus, items: ITEM_DB, archetypes, encounters, rng: seededRandom(11) });
  }
  step(input: Partial<RpgInput> = {}, dt = 1 / 60): void {
    this.time += dt;
    const r = this.cw.update({ dt, time: this.time, player: { x: this.x, z: this.z, eye: 2.7, yaw: this.yaw, pitch: 0, mode: "walk", onFoot: true }, input: { ...idle(), ...input } }, this.character);
    if (r.move) { this.x += r.move.x; this.z += r.move.z; }
  }
  run(seconds: number, input: () => Partial<RpgInput> = () => ({})): void { for (let i = 0; i < Math.round(seconds * 60); i++) this.step(input()); }
  enemies(): EnemyView[] { return this.cw.enemies({ x: this.x, z: this.z }, 400); }
  of<T extends GameEvent["type"]>(type: T): Extract<GameEvent, { type: T }>[] { return this.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type); }
  swing(heavy = false): void {
    if (heavy) { this.run(0.5, () => ({ attackHeld: true })); this.step({ attackReleased: true }); }
    else { this.step({ attackHeld: true, attackPressed: true }); this.step({ attackReleased: true }); }
    this.run(0.8);
  }
}
/** A punching bag of an archetype: never notices, never acts on its own. */
const dummy = (id: string, extra: Partial<EnemyArchetype> = {}): EnemyArchetype => ({ ...arch(id), id: `dummy-${id}`, reaction: 1000, perception: { sight: 0.1, fovDegrees: 1, hearing: 0 }, health: 500, ...extra });
const solo = (archetype: string, x: number, z: number, yaw: number, hostile = false): EncounterDefinition =>
  ({ id: `solo-${archetype}`, label: archetype, area: { x: 64, z: 96, radius: 14 }, hostile, members: [{ archetype, x, z, yaw }] });

// ---- Content: registration, validation, placement -------------------------------------------------

test("street encounters: the pack is registered and validates against all content", () => {
  assert.ok(CONTENT_PACKS.includes(PACK));
  const others = [...CONTENT_PACKS.filter(p => p !== PACK), LEGACY_PACK, { id: "catalogue", items: ITEMS }];
  assert.deepEqual(validateContent(PACK, others), []);
  const roaming = ENCOUNTERS.filter(e => e.auto);
  assert.ok(roaming.length >= 8 && roaming.length <= 12, `${roaming.length} roaming encounters`);
  for (const e of roaming) assert.ok(e.respawn !== undefined && e.respawn >= 240 && e.respawn <= 480, `${e.id} respawns 4-8 minutes after a clear`);
  for (const e of ENCOUNTERS) for (const m of e.members) assert.ok(ARCHETYPES.some(a => a.id === m.archetype), `${e.id}: ${m.archetype}`);
});

test("street encounters: every spawn point is walkable and outside the safe zones", () => {
  const safe: { x: number; z: number; label: string }[] = [{ ...SPAWN, label: "spawn" }];
  for (const s of STATION_SITES) safe.push({ x: s.x, z: s.z, label: `station ${s.name}` });
  for (const p of interiorPlaces(world)) safe.push({ ...p.entrance, label: `door ${p.id}` });
  for (const n of [...NPCS, ...CONTENT_PACKS.flatMap(p => p.npcs ?? [])]) safe.push({ x: n.x, z: n.z, label: `npc ${n.id}` });
  const parkGap = (x: number, z: number) => Math.hypot(Math.max(PARK.minX - x, 0, x - PARK.maxX), Math.max(PARK.minZ - z, 0, z - PARK.maxZ));
  for (const e of ENCOUNTERS) {
    const points = [{ x: e.area.x, z: e.area.z }, ...e.members, ...e.members.flatMap(m => m.patrol ?? [])];
    for (const p of points) {
      assert.ok(world.canOccupy(p.x, p.z), `${e.id}: (${p.x}, ${p.z}) is walkable`);
      for (const s of safe) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) >= 40, `${e.id}: (${p.x}, ${p.z}) is ${Math.hypot(p.x - s.x, p.z - s.z).toFixed(0)} m from ${s.label}`);
      assert.ok(parkGap(p.x, p.z) >= 40, `${e.id}: clear of the park`);
    }
    // A full chase (area + leash) never reaches the Silk Market avenue's carriageway (|x| < 12.4).
    assert.ok(Math.abs(e.area.x) - e.area.radius - LEASH > 12.4, `${e.id}: leash stays off the avenue`);
    // Members start inside their area (so the leash and respawn checks talk about the same place).
    for (const m of e.members) assert.ok(Math.hypot(m.x - e.area.x, m.z - e.area.z) <= e.area.radius, `${e.id}: ${m.archetype} inside the area`);
  }
  // Clear of every other pack's encounters (no accidental double fights).
  const others = CONTENT_PACKS.filter(p => p !== PACK).flatMap(p => p.encounters ?? []);
  for (const e of ENCOUNTERS.filter(x => x.auto)) for (const o of others) {
    const gap = Math.hypot(e.area.x - o.area.x, e.area.z - o.area.z) - e.area.radius - o.area.radius;
    assert.ok(gap >= 30, `${e.id} is ${gap.toFixed(0)} m from ${o.id}`);
  }
});

test("street encounters: forms come from tags and every new form is fielded", () => {
  assert.equal(enemyForm(["razorback", "form:rusher"]), "rusher");
  assert.equal(enemyForm(["razorback"]), null);
  assert.equal(enemyForm(undefined), null);
  const fielded = new Set(ENCOUNTERS.flatMap(e => e.members.map(m => enemyForm(arch(m.archetype).tags))));
  for (const form of ["rusher", "bruiser", "drone", "shield"] as const) assert.ok(fielded.has(form), form);
  // Telegraphs: every new attack winds up for at least 0.4 s.
  assert.ok(LUNGE.windup >= 0.4 && RUSH.windup >= 0.4);
  assert.ok(HIT_STOP.light > 0 && HIT_STOP.heavy <= 0.06);
});

// ---- Loot ----------------------------------------------------------------------------------------------

test("loot: every table's odds sum to 1, archetype tables exist and the Foreman always drops his wrench", () => {
  const tables = [...LOOT_TABLES, ...CONTENT_PACKS.flatMap(p => p.loot ?? [])];
  for (const table of tables) {
    const odds = lootOdds(table);
    const sum = odds.empty + odds.entries.reduce((s, e) => s + e.p, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${table.id} odds sum to ${sum}`);
  }
  for (const id of ["tier-street", "tier-veteran", "tier-elite"]) assert.ok(LOOT_TABLES.some(t => t.id === id), id);
  const ids = new Set(tables.map(t => t.id));
  for (const a of PACK.archetypes ?? []) assert.ok(ids.has(a.loot), `${a.id} loot ${a.loot}`);
  for (const t of PACK.loot ?? []) {
    for (const other of t.also ?? []) assert.ok(ids.has(other), `${t.id} also ${other}`);
    for (const e of t.entries) if (!e.item.includes(":")) assert.ok(ITEM_DB.has(e.item), `${t.id}: ${e.item}`);
  }
  const loot = new LootSystem(new ItemRegistry([...ITEMS, ...(PACK.items ?? [])]));
  loot.register(PACK.loot);
  for (let seed = 1; seed <= 20; seed++) {
    const roll = loot.roll("boss-foreman", seededRng(seed));
    assert.ok(roll.items.some(s => s.item === "double-pipe"), `seed ${seed}`);
    assert.ok(roll.credits >= 500);
  }
  // The unique sits in the epic DPS band; enemy-only weapons never drop.
  const pipe = ITEM_DB.get("double-pipe")?.weapon;
  assert.ok(pipe && pipe.damage / pipe.cooldown >= 78 && pipe.damage / pipe.cooldown <= 102);
  for (const id of ["scrap-drone-arc", "foreman-press"]) assert.ok(ITEM_DB.get(id)?.tags?.includes("noloot"), id);
});

// ---- Respawn -------------------------------------------------------------------------------------------

test("respawn: a cleared crew waits its timer, then returns only out of the player's sight", () => {
  const defs = [enc("street-gc-overpass")];
  const h = new Harness(512, -60, Math.PI, defs);
  for (const e of h.enemies()) h.cw.damageEnemy(e.id, 10000);
  assert.ok(h.cw.encounterCleared("street-gc-overpass"));
  const save = h.cw.serialize();
  assert.equal(save.respawn["street-gc-overpass"], 360);
  // Timer nearly up, player 90 m away down the same street with a clear view: no respawn.
  const near: CombatSave = { ...save, respawn: { "street-gc-overpass": 0.05 } };
  const seen = new Harness(512, -38, Math.PI, defs);
  seen.cw.load(JSON.parse(JSON.stringify(near)));
  seen.run(1.5);
  assert.equal(seen.cw.encounterActive("street-gc-overpass"), false, "never respawns in view");
  // Round the corner (similar distance, buildings in between): it comes back.
  seen.x = 576; seen.z = -64;
  seen.run(1);
  assert.equal(seen.cw.encounterActive("street-gc-overpass"), true, "respawned out of sight");
  assert.ok(SIM_RADIUS > 100);
});

// ---- Forms ----------------------------------------------------------------------------------------------

test("shield-bearers: frontal hits glance off, a heavy blow breaks the guard, the back is bare", () => {
  const bulwark = dummy("rb-bulwark");
  // In front, facing the player (south): a light hit is mostly blocked.
  const front = new Harness(64, 100, 0, [solo(bulwark.id, 64, 98.2, Math.PI)], [bulwark]);
  front.cw.spawnEncounter(`solo-${bulwark.id}`); front.run(0.2);
  front.swing();
  const blocked = front.of("damaged")[0];
  assert.ok(blocked && blocked.amount < 4, `blocked hit ${blocked?.amount}`);
  // A heavy blow breaks the guard: full damage and the shield-bearer is open (vulnerable).
  front.events = [];
  front.run(1.2);
  front.swing(true);
  const heavy = front.of("damaged")[0];
  assert.ok(heavy && heavy.amount > 20, `heavy hit ${heavy?.amount}`);
  // From behind the shield does nothing.
  const back = new Harness(64, 100, 0, [solo(bulwark.id, 64, 98.2, 0)], [bulwark]);
  back.cw.spawnEncounter(`solo-${bulwark.id}`); back.run(0.2);
  back.swing();
  const bare = back.of("damaged")[0];
  assert.ok(bare && bare.amount > 10, `hit from behind ${bare?.amount}`);
});

test("drones: melee passes under them, a pistol shot brings them down", () => {
  const drone = dummy("scrap-drone");
  const h = new Harness(64, 100, 0, [solo(drone.id, 64, 98.2, Math.PI)], [drone]);
  h.cw.spawnEncounter(`solo-${drone.id}`); h.run(0.2);
  h.swing();
  assert.equal(h.of("damaged").length, 0, "a swing can't reach a hovering drone");
  h.step({ selectSlot: "sidearm" }); h.run(0.5);
  h.step({ attackPressed: true, attackHeld: true }); h.step({ attackReleased: true }); h.run(0.3);
  assert.ok(h.of("damaged").length >= 1, "a shot hits the hull");
});

test("rushers telegraph a lunge for >= 0.4 s with a ground line; bruisers telegraph their rush", () => {
  const watch = (archetype: string, kind: string, z: number, seconds: number) => {
    const h = new Harness(64, 100, Math.PI, [solo(archetype, 64, z, Math.PI, true)]);
    h.cw.spawnEncounter(`solo-${archetype}`); // solo encounters are not `auto`: spawn like the other harness tests
    let run = 0, longest = 0, line = false;
    for (let i = 0; i < seconds * 60 && longest === 0; i++) {
      h.step();
      const e = h.enemies().find(v => v.archetype === archetype && v.deathAge < 0);
      if (e?.attackKind === kind && e.windup) {
        run++;
        line ||= h.cw.effects().some(fx => fx.kind === "telegraph" && fx.shape === "line" && fx.enemy === e.id);
      } else if (run > 0) longest = run;
    }
    return { seconds: longest / 60, line };
  };
  const lunge = watch("rb-razor", "lunge", 94.5, 8);
  assert.ok(lunge.seconds >= 0.4, `lunge wind-up ${lunge.seconds.toFixed(2)} s`);
  assert.ok(lunge.line, "lunge draws a ground line");
  const rush = watch("rb-scattergun", "rush", 92, 14);
  assert.ok(rush.seconds >= 0.4, `rush wind-up ${rush.seconds.toFixed(2)} s`);
  assert.ok(rush.line, "rush draws a ground line");
});

test("hit-stop: a connecting swing holds for 2-3 ticks (<= 60 ms), then carries on", () => {
  const bag = dummy("razorback-thug");
  const h = new Harness(64, 100, 0, [solo(bag.id, 64, 98.2, Math.PI)], [bag]);
  h.cw.spawnEncounter(`solo-${bag.id}`); h.run(0.2);
  h.step({ attackHeld: true, attackPressed: true }); h.step({ attackReleased: true });
  const progress: number[] = [];
  let hitAt = -1;
  for (let i = 0; i < 40; i++) {
    h.step();
    progress.push(h.cw.playerView().actionProgress);
    if (hitAt < 0 && h.of("damaged").length) hitAt = i;
  }
  assert.ok(hitAt >= 0, "the swing connects");
  const held = progress.slice(hitAt).findIndex((p, i, all) => i > 0 && p !== all[i - 1]) - 1;
  assert.ok(held >= 2 && held <= 3, `held ${held} ticks`);
});

// ---- Boss ----------------------------------------------------------------------------------------------

test("the Foreman: phases at 60% and 30%, drones on the horn, a contract that pays", () => {
  const defs = [enc("foreman-yard"), enc("foreman-drones")];
  const h = new Harness(FOREMAN_YARD.x, FOREMAN_YARD.z + 14, 0, defs);
  const boss = h.enemies().find(e => e.archetype === "foreman");
  assert.ok(boss && boss.boss);
  const phases = arch("foreman").boss?.phases ?? [];
  assert.equal(phases.length, 3);
  for (let i = 1; i < phases.length; i++) assert.ok(phases[i].atHealth < phases[i - 1].atHealth);
  h.cw.damageEnemy(boss.id, 1400 * 0.45);
  h.run(0.6); // past its 0.3 s reaction: the phase change happens on the boss's own tick
  assert.equal(h.cw.boss()?.phase, 2);
  assert.ok(h.cw.encounterActive("foreman-drones"), "phase two summons the drones");
  assert.ok(h.of("message").some(m => /yard horn/.test(m.text)));
  h.run(1.5);
  h.cw.damageEnemy(boss.id, 1400 * 0.3);
  h.run(0.3);
  assert.equal(h.cw.boss()?.phase, 3);
  const contract = (PACK.quests ?? []).find(q => q.id === "foreman-contract");
  assert.ok(contract?.trigger && contract.repeatable);
  assert.ok(Math.hypot(contract.trigger.x - FOREMAN_YARD.x, contract.trigger.z - FOREMAN_YARD.z) < 1);
});

// ---- CorpSec -------------------------------------------------------------------------------------------

test("CorpSec patrols are neutral until a crime is reported nearby", () => {
  const h = new Harness(192, -420, Math.PI, [enc("street-corpsec-patrol")]);
  h.run(0.5);
  assert.ok(h.enemies().every(e => !e.hostile), "neutral at first");
  assert.equal(h.cw.reportCrime(0, 78), 0, "a crime across town goes unanswered");
  assert.equal(h.cw.reportCrime(192, -440), 1);
  assert.ok(h.enemies().every(e => e.hostile));
  h.run(1.5);
  assert.ok(h.enemies().some(e => e.state === "alert" || e.state === "chase" || e.state === "attack" || e.state === "reposition"), "they come for the player");
});

// ---- HUD -----------------------------------------------------------------------------------------------

test("HUD: the threat cue eases in and out once per fight and yields to the boss bar", () => {
  const spotter: EnemyView = { id: "t1", archetype: "rb-razor", name: "Razor", faction: "razorbacks", x: 0, z: 0, yaw: 0, health: 50, maxHealth: 50, state: "alert", attack: 0, hitAge: Infinity, deathAge: -1, weaponClass: "blade", look: arch("rb-razor").look, bark: null, hostile: true };
  const calm: EnemyView = { ...spotter, state: "idle" };
  const t0 = 5000;
  assert.equal(threatCue([calm], t0), null);
  const first = threatCue([spotter], t0 + 1);
  assert.ok(first && first.age === 0 && first.faction === "razorbacks");
  assert.equal(threatAlpha(0), 0, "eases in, never pops");
  assert.equal(threatAlpha(1.2), 1);
  assert.equal(threatAlpha(THREAT_LIFE + 0.01), 0);
  assert.equal(threatCue([spotter], t0 + 1 + THREAT_LIFE + 0.5), null, "shown once per fight");
  threatCue([calm], t0 + 10); // fight over...
  assert.equal(threatCue([spotter], t0 + 12), null, "...and no re-trigger within 6 s");
  assert.ok(threatCue([calm], t0 + 13) === null && threatCue([spotter], t0 + 20)?.age === 0, "a new fight cues again");
  const layout = combatHudLayout(160, 90);
  assert.ok(threatCueSlot(layout, false));
  assert.equal(threatCueSlot(layout, true), null);
});

test("HUD: the soft hit vignette eases in over 0.5 s, holds under fire and fades over 0.9 s", () => {
  assert.equal(hitVignetteTarget(Infinity), 0);
  assert.equal(hitVignetteTarget(0.3), 1);
  assert.ok(hitVignetteTarget(1.05) > 0 && hitVignetteTarget(1.05) < 1);
  assert.equal(hitVignetteTarget(1.6), 0);
  // Rapid hits (every 0.15 s) for a second: the level only ever rises gently, never pulses.
  let t = 9000, previous = hitVignetteLevel(Infinity, t);
  for (let i = 0; i < 60; i++) {
    t += 1 / 60;
    const level = hitVignetteLevel((i % 9) / 60, t);
    assert.ok(level >= previous - 1e-9, "no dips under steady fire");
    assert.ok(level - previous <= (1 / 60) / 0.5 + 1e-9, "eases in");
    previous = level;
  }
});
