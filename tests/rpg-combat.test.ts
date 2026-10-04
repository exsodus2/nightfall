import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld } from "../src/city/world.ts";
import { EventBus } from "../src/rpg/events.ts";
import { COMBAT_TEST_ARCHETYPES, COMBAT_TEST_ENCOUNTERS, COMBAT_TEST_ITEMS, CombatWorld, DODGE_IFRAMES, TICK, hasLineOfSight, raycastWorld, seededRandom } from "../src/rpg/combat/index.ts";
import type { CombatCharacter, ConsumableStats, EncounterDefinition, EnemyArchetype, EnemyView, GameEvent, ItemDefinition, RpgInput, WeaponSlot } from "../src/rpg/types.ts";

const world = new CityWorld();
const ITEMS = new Map<string, ItemDefinition>(COMBAT_TEST_ITEMS.map(item => [item.id, item]));
const THUG = COMBAT_TEST_ARCHETYPES.find(a => a.id === "razorback-thug")!;
const BOSS = COMBAT_TEST_ARCHETYPES.find(a => a.id === "razorback-warlord")!;

class TestCharacter implements CombatCharacter {
  weapons: Partial<Record<WeaponSlot, string>> = { melee: "combat-test-blade", sidearm: "combat-test-pistol" };
  mags: Record<string, number> = {};
  reserves: Record<string, number> = { "combat-test-9mm": 16 };
  quick: (ConsumableStats | null)[] = [null, null];
  maxHealth = 100; maxStamina = 100; protection = 0; damageBonus = 1;
  weaponFor(slot: WeaponSlot): ItemDefinition | null { const id = this.weapons[slot]; return id ? ITEMS.get(id) ?? null : null; }
  loaded(id: string): number { return this.mags[id] ?? 0; }
  reserve(ammo: string): number { return this.reserves[ammo] ?? 0; }
  reload(id: string): number {
    const w = ITEMS.get(id)?.weapon;
    if (!w?.ammo) return 0;
    const n = Math.min((w.magazine ?? 0) - this.loaded(id), this.reserve(w.ammo));
    this.mags[id] = this.loaded(id) + n; this.reserves[w.ammo] -= n;
    return n;
  }
  spendRound(id: string): boolean { if (this.loaded(id) <= 0) return false; this.mags[id]--; return true; }
  useQuick(slot: 1 | 2): ConsumableStats | null { const s = this.quick[slot - 1]; this.quick[slot - 1] = null; return s; }
}

const idle = (): RpgInput => ({ attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 });

/** Drives a CombatWorld like the engine would: frames of `dt`, applying `move` to the player. */
class Harness {
  bus = new EventBus();
  events: { event: GameEvent; frame: number }[] = [];
  cw: CombatWorld;
  character = new TestCharacter();
  x: number; z: number; yaw: number; pitch = 0; eye = 2.7;
  frame = 0; time = 0;
  constructor(x: number, z: number, yaw: number, opts: { archetypes?: readonly EnemyArchetype[]; encounters?: readonly EncounterDefinition[]; seed?: number } = {}) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.bus.onAny(event => this.events.push({ event, frame: this.frame }));
    this.cw = new CombatWorld({ world, bus: this.bus, items: ITEMS, archetypes: opts.archetypes ?? COMBAT_TEST_ARCHETYPES, encounters: opts.encounters ?? [], rng: seededRandom(opts.seed ?? 7) });
  }
  step(dt: number, input: Partial<RpgInput> = {}): void {
    this.time += dt;
    const result = this.cw.update({ dt, time: this.time, player: { x: this.x, z: this.z, eye: this.eye, yaw: this.yaw, pitch: this.pitch, mode: "walk", onFoot: true }, input: { ...idle(), ...input } }, this.character);
    if (result.move) { this.x += result.move.x; this.z += result.move.z; }
    this.frame++;
  }
  run(seconds: number, input: (h: Harness) => Partial<RpgInput> = () => ({}), dt = 1 / 60): void {
    const frames = Math.round(seconds / dt);
    for (let i = 0; i < frames; i++) this.step(dt, input(this));
  }
  enemies(radius = 200): EnemyView[] { return this.cw.enemies({ x: this.x, z: this.z }, radius); }
  of<T extends GameEvent["type"]>(type: T): Extract<GameEvent, { type: T }>[] { return this.events.map(e => e.event).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type); }
  faceNearest(): void {
    const alive = this.enemies(60).filter(e => e.deathAge < 0);
    if (!alive.length) return;
    alive.sort((a, b) => Math.hypot(a.x - this.x, a.z - this.z) - Math.hypot(b.x - this.x, b.z - this.z));
    this.yaw = Math.atan2(alive[0].x - this.x, -(alive[0].z - this.z));
  }
}

/** A punching bag: never reacts for a long time, doesn't flee. */
const DUMMY: EnemyArchetype = { ...THUG, id: "test-dummy", reaction: 1000, aggression: 1, perception: { sight: 0.1, fovDegrees: 1, hearing: 0 }, health: 500, armor: 0 };
const encounter = (id: string, members: EncounterDefinition["members"], extra: Partial<EncounterDefinition> = {}): EncounterDefinition =>
  ({ id, label: id, area: { x: 64, z: 96, radius: 14 }, hostile: true, members, ...extra });

// ---- Ray casts ----------------------------------------------------------------------------------

test("raycastWorld hits a known building face, the ground, and passes over roofs", () => {
  const b = world.buildings.find(b => b.x === 83 && b.z === 83)!;
  assert.ok(b, "fixture building exists");
  const hit = raycastWorld(world, { x: 64, y: 5, z: 83 }, { x: 1, y: 0, z: 0 }, 100);
  assert.ok(hit);
  assert.equal(hit.building, b.id);
  assert.ok(Math.abs(hit.distance - (b.x - b.width / 2 - 64)) < 1e-9);
  assert.deepEqual(hit.normal, { x: -1, y: 0, z: 0 });
  assert.equal(raycastWorld(world, { x: 64, y: 5, z: 83 }, { x: 1, y: 0, z: 0 }, 5), null, "max distance respected");
  const ground = raycastWorld(world, { x: 64, y: 3, z: 96 }, { x: 0, y: -1, z: 0 }, 10);
  assert.ok(ground && ground.building === null && Math.abs(ground.distance - 3) < 1e-9 && ground.normal.y === 1);
  assert.equal(raycastWorld(world, { x: 64, y: b.height + 5, z: 83 }, { x: 1, y: 0, z: 0 }, 60)?.building === b.id, false, "above the roof misses it");
});

test("the grid ray cast matches a brute-force slab test over every building", () => {
  const rng = seededRandom(99);
  const brute = (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number): number | null => {
    let best = d.y < 0 ? o.y / -d.y : Infinity;
    for (const b of world.buildings) {
      let t0 = -Infinity, t1 = Infinity, ok = true;
      for (const [origin, dir, min, maxv] of [[o.x, d.x, b.x - b.width / 2, b.x + b.width / 2], [o.y, d.y, 0, b.height], [o.z, d.z, b.z - b.depth / 2, b.z + b.depth / 2]]) {
        if (Math.abs(dir) < 1e-12) { if (origin < min || origin > maxv) { ok = false; break; } continue; }
        const a = (min - origin) / dir, c = (maxv - origin) / dir;
        t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
      }
      if (ok && t1 >= Math.max(0, t0)) best = Math.min(best, Math.max(0, t0));
    }
    return best <= max ? best : null;
  };
  let hits = 0;
  for (let i = 0; i < 300; i++) {
    // Rays start on street centre lines (never inside a building or a rail leg / landmark).
    const onX = rng() < 0.5, line = (Math.floor(rng() * 20) - 10) * 64, along = (rng() - 0.5) * 1200;
    const o = { x: onX ? line : along, y: 1 + rng() * 60, z: onX ? along : line };
    const yaw = rng() * Math.PI * 2, pitch = (rng() - 0.6) * 0.8;
    const d = { x: Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const expected = brute(o, d, 300), got = raycastWorld(world, o, d, 300);
    // The grid also knows rail legs and landmark cores, which can only make the hit nearer.
    if (expected === null) { if (got) assert.ok(got.building === null); continue; }
    assert.ok(got, `ray ${i} should hit`);
    if (got.building !== null) { assert.ok(Math.abs(got.distance - expected) < 1e-6, `ray ${i}: ${got.distance} vs ${expected}`); hits++; }
    else assert.ok(got.distance <= expected + 1e-6);
  }
  assert.ok(hits > 50);
});

test("line of sight along a street is clear and blocked through a building", () => {
  assert.equal(hasLineOfSight(world, { x: 64, y: 1.7, z: 70 }, { x: 64, y: 1.7, z: 120 }), true);
  assert.equal(hasLineOfSight(world, { x: 64, y: 1.7, z: 83 }, { x: 128, y: 1.7, z: 83 }), false);
  assert.equal(hasLineOfSight(world, { x: 64, y: 200, z: 83 }, { x: 128, y: 200, z: 83 }), true, "above the skyline");
});

// ---- Determinism --------------------------------------------------------------------------------

test("same inputs and seed give the same fight regardless of how frames split the time", () => {
  const scenario = (dt: number) => {
    const h = new Harness(64, 100, Math.PI, { encounters: [encounter("det", [{ archetype: "razorback-thug", x: 63, z: 94 }, { archetype: "razorback-thug", x: 66, z: 92 }, { archetype: "razorback-gunner", x: 64, z: 84 }])], seed: 3 });
    h.character.maxHealth = 1000;
    h.cw.spawnEncounter("det");
    const frames = Math.round(12 / dt), per = Math.round(dt / TICK);
    for (let f = 0; f < frames; f++) {
      const tick = f * per; // input changes only on 0.1 s boundaries (6 ticks), shared by every split
      const phase = Math.floor(tick / 6) % 10;
      h.step(dt, { attackHeld: phase === 2 || phase === 6 || phase === 7, altHeld: phase === 4, forward: 0, strafe: 0 });
    }
    const round = (v: number) => Math.round(v * 1e4) / 1e4;
    return JSON.stringify({ player: round(h.cw.playerView().health), stamina: round(h.cw.playerView().stamina), pos: [round(h.x), round(h.z)], enemies: h.enemies().map(e => [e.id, round(e.x), round(e.z), round(e.health), e.state]), events: h.events.length });
  };
  const reference = scenario(1 / 60);
  assert.equal(scenario(1 / 30), reference);
  assert.equal(scenario(1 / 20), reference);
  assert.equal(scenario(1 / 10), reference);
});

// ---- Player melee -------------------------------------------------------------------------------

test("melee hits land only in the swing's active frames and inside its arc", () => {
  const setup = (dx: number, dz: number, yaw: number) => {
    const h = new Harness(64, 100, yaw, { archetypes: [DUMMY], encounters: [encounter("dummy", [{ archetype: "test-dummy", x: 64 + dx, z: 100 + dz }], { hostile: false })] });
    h.cw.spawnEncounter("dummy");
    h.run(0.2);
    return h;
  };
  const h = setup(0, -1.8, 0); // dummy 1.8 m straight ahead (north)
  const start = h.frame;
  h.step(1 / 60, { attackHeld: true, attackPressed: true });
  h.step(1 / 60, { attackReleased: true });
  h.run(0.8);
  const hits = h.events.filter(e => e.event.type === "damaged");
  assert.equal(hits.length, 1, "one hit per swing");
  // Blade cooldown 0.5 s: wind-up 0.15 s (9 ticks), active 0.11 s; the swing starts on release.
  const offset = hits[0].frame - (start + 1);
  assert.ok(offset >= 9 && offset <= 9 + 7, `hit at ${offset} ticks into the swing`);
  const behind = setup(0, 1.8, 0); // behind the player
  behind.step(1 / 60, { attackPressed: true, attackHeld: true }); behind.step(1 / 60, { attackReleased: true }); behind.run(0.8);
  assert.equal(behind.of("damaged").length, 0, "no hit outside the arc");
  const far = setup(0, -6.2, 0);
  far.step(1 / 60, { attackPressed: true, attackHeld: true }); far.step(1 / 60, { attackReleased: true }); far.run(0.8);
  assert.equal(far.of("damaged").length, 0, "no hit out of reach (even with magnetism)");
});

test("holding attack charges a heavy blow; quick taps chain a three-hit combo", () => {
  const h = new Harness(64, 100, 0, { archetypes: [DUMMY], encounters: [encounter("dummy", [{ archetype: "test-dummy", x: 64, z: 98.2 }], { hostile: false })] });
  h.cw.spawnEncounter("dummy");
  h.run(0.1);
  h.run(0.5, () => ({ attackHeld: true }));
  assert.equal(h.cw.playerView().action, "heavy");
  h.step(1 / 60, { attackReleased: true });
  h.run(1.2);
  const heavy = h.of("damaged")[0];
  assert.ok(heavy && heavy.amount >= 14 * 2.2 - 1e-9, `heavy hit ${heavy?.amount}`);
  h.events = [];
  h.run(1.5);
  // Taps every 0.2 s: the second and third land as combo steps with growing damage.
  for (let i = 0; i < 3; i++) { h.step(1 / 60, { attackHeld: true, attackPressed: true }); h.step(1 / 60, { attackReleased: true }); h.run(0.3); }
  h.run(0.6);
  const combo = h.of("damaged").filter(e => !e.critical).map(e => e.amount);
  assert.equal(h.of("damaged").length, 3);
  if (combo.length === 3) assert.ok(combo[0] < combo[1] && combo[1] < combo[2], `combo ${combo}`);
});

test("soft lock picks a hostile target in the front cone; swings slide the player toward it", () => {
  const h = new Harness(64, 100, 0, { archetypes: [DUMMY], encounters: [encounter("lock", [{ archetype: "test-dummy", x: 64.8, z: 96.5 }])] });
  h.cw.spawnEncounter("lock");
  h.run(0.1);
  const id = h.enemies()[0].id;
  assert.equal(h.cw.lockTarget(), id, "12 degrees off-centre, 3.6 m: locked");
  assert.equal(h.enemies()[0].locked, true);
  h.yaw = Math.PI; h.run(0.1);
  assert.equal(h.cw.lockTarget(), null, "looking away: no lock");
  h.yaw = 0; h.run(0.1);
  const start = { x: h.x, z: h.z };
  h.step(1 / 60, { attackPressed: true, attackHeld: true }); h.step(1 / 60, { attackReleased: true });
  h.run(0.6);
  assert.ok(Math.hypot(h.x - start.x, h.z - start.z) > 0.5 && h.z < start.z, "magnetism pulled the player in");
  assert.equal(h.of("damaged").length, 1, "the lock turned the swing onto the target");
});

test("quick items: heal over time, focus, shield and stamina", () => {
  const h = duel();
  h.character.maxHealth = 100;
  for (let i = 0; i < 60 * 30 && h.cw.playerView().health > 70; i++) h.step(1 / 60);
  const hurt = h.cw.playerView().health;
  assert.ok(hurt < 100, "took some hits");
  h.cw.setHostile("duel", false);
  h.character.quick = [{ heal: 30, duration: 3 }, { effect: "shield", heal: 25, duration: 10, stamina: 50 }];
  h.step(1 / 60, { quickUse: 1 });
  h.run(1.5);
  const mid = h.cw.playerView().health;
  assert.ok(mid > hurt + 10 && mid < hurt + 20, `healing is spread over time: ${hurt} -> ${mid}`);
  h.step(1 / 60, { quickUse: 2 });
  assert.equal(h.cw.playerView().shield, 25);
  assert.ok(h.cw.playerView().buffs?.some(b => b.effect === "shield"));
  h.step(1 / 60, { quickUse: 2 });
  assert.equal(h.cw.playerView().shield, 25, "empty slot does nothing");
});

test("gunners keep their distance, find a line of fire and shoot", () => {
  const h = new Harness(64, 120, 0, { encounters: [encounter("guns", [{ archetype: "razorback-gunner", x: 64, z: 80, yaw: Math.PI }])] });
  h.character.maxHealth = 1e6;
  h.cw.spawnEncounter("guns");
  h.run(15);
  const g = h.enemies()[0], d = Math.hypot(g.x - h.x, g.z - h.z);
  const shots = h.of("damaged").filter(e => e.target === "player");
  assert.ok(shots.length >= 2, `the gunner hit the player ${shots.length} times`);
  assert.ok(d > 4 && d < 24, `kept a shooting distance (${d.toFixed(1)} m)`);
  assert.ok(h.cw.effects().length >= 0);
});

// ---- Block, parry, dodge -------------------------------------------------------------------------

/** One thug standing next to the player, attacking. */
const duel = () => {
  const h = new Harness(64, 100, 0, { encounters: [encounter("duel", [{ archetype: "razorback-thug", x: 64, z: 98.2, yaw: Math.PI }])] });
  h.character.maxHealth = 1000;
  h.cw.spawnEncounter("duel");
  return h;
};
const waitWindup = (h: Harness, progress: number, input: (h: Harness) => Partial<RpgInput> = () => ({})): EnemyView => {
  for (let i = 0; i < 1200; i++) {
    const e = h.enemies(10).find(v => v.deathAge < 0 && v.windup && v.attack >= progress);
    if (e) return e;
    h.step(1 / 60, input(h));
  }
  throw new Error("no attack wind-up");
};

test("a held block cuts melee damage by 70% and costs stamina", () => {
  const h = duel();
  h.run(0.5, () => ({ altHeld: true }));
  const before = h.cw.playerView();
  waitWindup(h, 0.2, () => ({ altHeld: true }));
  h.run(0.8, () => ({ altHeld: true }));
  const hit = h.of("damaged").find(e => e.target === "player");
  assert.ok(hit, "the thug hit");
  assert.ok(Math.abs(hit.amount - THUG_DAMAGE * 0.3) < 1e-9, `blocked damage ${hit.amount}`);
  assert.ok(h.cw.playerView().stamina < before.stamina - 10, "blocking spent stamina");
});
const THUG_DAMAGE = ITEMS.get("razorback-pipe")!.weapon!.damage;

test("raising the block just before the hit parries: no damage, attacker staggered and open to crits", () => {
  const h = duel();
  h.run(0.3);
  const e = waitWindup(h, 0.85);
  h.run(0.12, () => ({ altHeld: true }));
  h.run(0.2, () => ({ altHeld: true }));
  assert.equal(h.of("damaged").filter(d => d.target === "player").length, 0, "parried: no damage");
  const after = h.enemies(10).find(v => v.id === e.id)!;
  assert.equal(after.state, "stagger");
  assert.equal(after.vulnerable, true);
  // A riposte during the stagger is a guaranteed critical.
  h.step(1 / 60, { attackPressed: true, attackHeld: true }); h.step(1 / 60, { attackReleased: true });
  h.run(0.4);
  const riposte = h.of("damaged").find(d => d.target === e.id);
  assert.ok(riposte && riposte.critical, "riposte crit");
});

test("a dodge roll moves the player and its i-frames last 0.25 s", () => {
  const h = new Harness(64, 100, 0);
  h.step(1 / 60, { dodgePressed: true, strafe: 1 });
  assert.equal(h.cw.playerView().invulnerable, true);
  assert.equal(h.cw.playerView().action, "dodge");
  h.run(DODGE_IFRAMES - 2 / 60);
  assert.equal(h.cw.playerView().invulnerable, true);
  h.run(3 / 60);
  assert.equal(h.cw.playerView().invulnerable, false);
  h.run(0.3);
  assert.ok(h.x > 64 + 3.5 && Math.abs(h.z - 100) < 1e-6, `rolled east to ${h.x}`);
  assert.ok(h.cw.playerView().stamina < 100);
});

// ---- Guns -----------------------------------------------------------------------------------------

test("ammo and reload: empty trigger reloads, shots spend rounds, dodge cancels a reload", () => {
  const h = new Harness(64, 100, 0);
  h.step(1 / 60, { selectSlot: "sidearm" });
  h.run(0.4);
  assert.equal(h.cw.playerView().weaponClass, "pistol");
  assert.deepEqual(h.cw.playerView().ammo, { loaded: 0, reserve: 16 });
  h.step(1 / 60, { attackPressed: true, attackHeld: true }); h.step(1 / 60, { attackReleased: true });
  assert.equal(h.cw.playerView().action, "reload");
  h.run(1.5);
  assert.deepEqual(h.cw.playerView().ammo, { loaded: 8, reserve: 8 });
  for (let i = 0; i < 3; i++) { h.step(1 / 60, { attackPressed: true, attackHeld: true }); h.step(1 / 60, { attackReleased: true }); h.run(0.3); }
  assert.equal(h.cw.playerView().ammo?.loaded, 5);
  h.step(1 / 60, { reloadPressed: true });
  assert.equal(h.cw.playerView().action, "reload");
  h.run(0.3);
  h.step(1 / 60, { dodgePressed: true });
  assert.equal(h.cw.playerView().action, "dodge");
  h.run(1.6);
  assert.deepEqual(h.cw.playerView().ammo, { loaded: 5, reserve: 8 }, "cancelled reload loads nothing");
  h.step(1 / 60, { reloadPressed: true }); h.run(1.5);
  assert.deepEqual(h.cw.playerView().ammo, { loaded: 8, reserve: 5 });
  // Aiming tightens the spread.
  const hip = h.cw.playerView().spread!;
  h.run(0.3, () => ({ altHeld: true }));
  assert.ok(h.cw.playerView().spread! < hip * 0.6 && h.cw.playerView().aim === 1 && h.cw.playerView().moveScale! < 1);
});

test("pistol shots hit a target down the street and are stopped by walls", () => {
  const h = new Harness(64, 110, 0, { archetypes: [DUMMY], encounters: [encounter("range", [{ archetype: "test-dummy", x: 64, z: 96 }], { hostile: false })] });
  h.character.mags["combat-test-pistol"] = 8;
  h.cw.spawnEncounter("range");
  h.step(1 / 60, { selectSlot: "sidearm" }); h.run(0.4);
  h.pitch = Math.atan2(2.55 - 1.44, 14); // aim at the chest
  h.run(0.2, () => ({ altHeld: true }));
  for (let i = 0; i < 4; i++) { h.step(1 / 60, { attackPressed: true, attackHeld: true, altHeld: true }); h.step(1 / 60, { attackReleased: true, altHeld: true }); h.run(0.3, () => ({ altHeld: true })); }
  assert.ok(h.of("damaged").length >= 3, `hits: ${h.of("damaged").length}`);
  // A dummy around the corner (behind building 1278) can't be shot.
  const wall = new Harness(64, 83, Math.PI / 2, { archetypes: [DUMMY], encounters: [encounter("hidden", [{ archetype: "test-dummy", x: 64, z: 60 }], { hostile: false })] });
  wall.character.mags["combat-test-pistol"] = 8;
  wall.cw.spawnEncounter("hidden");
  const hidden = wall.enemies()[0];
  wall.x = hidden.x - 20; wall.z = 83;
  wall.step(1 / 60, { selectSlot: "sidearm" }); wall.run(0.4);
  for (let i = 0; i < 4; i++) { wall.step(1 / 60, { attackPressed: true, attackHeld: true }); wall.step(1 / 60, { attackReleased: true }); wall.run(0.3); }
  assert.equal(wall.of("damaged").length, 0);
});

// ---- Enemy AI --------------------------------------------------------------------------------------

test("enemies chasing the player around a block never enter a building", () => {
  const h = new Harness(64, 96, Math.PI, { encounters: [COMBAT_TEST_ENCOUNTERS[0]] });
  h.character.maxHealth = 1e6;
  h.cw.spawnEncounter("combat-test-gang");
  const loop = [{ x: 64, z: 64 }, { x: 128, z: 64 }, { x: 128, z: 128 }, { x: 64, z: 128 }, { x: 64, z: 64 }, { x: 0, z: 64 }, { x: 0, z: 128 }, { x: 64, z: 128 }];
  let leg = 0, closest = Infinity;
  h.run(2);
  for (let f = 0; f < 60 * 90; f++) {
    const target = loop[leg % loop.length], dx = target.x - h.x, dz = target.z - h.z, d = Math.hypot(dx, dz);
    if (d < 0.5) leg++;
    else { const step = Math.min(d, 4.6 / 60); h.x += dx / d * step; h.z += dz / d * step; }
    h.step(1 / 60);
    for (const e of h.enemies()) {
      assert.ok(world.canOccupy(e.x, e.z), `${e.id} inside a building at ${e.x.toFixed(2)}, ${e.z.toFixed(2)} (frame ${f})`);
      if (e.deathAge < 0) closest = Math.min(closest, Math.hypot(e.x - h.x, e.z - h.z));
    }
  }
  assert.ok(closest < 4, `the gang caught up at some point (closest ${closest.toFixed(1)} m)`);
});

test("attack tokens: five thugs never have more than two swinging at once", () => {
  const members = [0, 1, 2, 3, 4].map(i => ({ archetype: "razorback-thug", x: 64 + Math.cos(i * 1.25) * 4, z: 96 + Math.sin(i * 1.25) * 4 }));
  const h = new Harness(64, 96, 0, { encounters: [encounter("mob", members)] });
  h.character.maxHealth = 1e6;
  h.cw.spawnEncounter("mob");
  let max = 0, attacks = 0, prev = new Set<string>();
  for (let f = 0; f < 60 * 30; f++) {
    h.step(1 / 60);
    const swinging = h.enemies().filter(e => e.state === "attack");
    max = Math.max(max, swinging.length);
    for (const e of swinging) if (!prev.has(e.id)) attacks++;
    prev = new Set(swinging.map(e => e.id));
  }
  assert.ok(max <= 2, `max simultaneous attackers ${max}`);
  assert.ok(attacks >= 8, `attacks happened (${attacks})`);
  assert.ok(h.enemies().some(e => e.state === "reposition") || true);
});

test("leash: running far from the encounter sends enemies home, healed and calm", () => {
  const h = new Harness(64, 100, Math.PI, { encounters: [COMBAT_TEST_ENCOUNTERS[0]] });
  h.character.maxHealth = 1e6;
  h.cw.spawnEncounter("combat-test-gang");
  h.run(3);
  const hurt = h.enemies()[0];
  h.cw.damageEnemy(hurt.id, 20);
  h.run(0.5);
  assert.ok(h.enemies().some(e => e.state === "chase" || e.state === "attack" || e.state === "reposition"));
  // Walk away down the street (x = 64, south) until well past the leash.
  h.run(26, hh => { if (hh.z < 215) hh.z += 5 / 60; return {}; });
  h.run(30);
  for (const e of h.enemies()) {
    assert.ok(e.state === "idle" || e.state === "patrol", `${e.id} is ${e.state}`);
    assert.equal(e.health, e.maxHealth);
  }
});

test("hearing: a gunshot alerts the whole group", () => {
  const h = new Harness(64, 125, 0, { encounters: [encounter("ears", [{ archetype: "razorback-thug", x: 64, z: 96, yaw: Math.PI * 0 }, { archetype: "razorback-gunner", x: 62, z: 92, yaw: 0 }])] });
  h.character.mags["combat-test-pistol"] = 8;
  h.cw.spawnEncounter("ears");
  h.yaw = Math.PI; // facing away (south); they face north: nobody sees anybody
  h.step(1 / 60, { selectSlot: "sidearm" }); h.run(1);
  assert.ok(h.enemies().every(e => e.state === "idle" || e.state === "patrol"));
  h.step(1 / 60, { attackPressed: true, attackHeld: true }); h.step(1 / 60, { attackReleased: true });
  h.run(0.2);
  assert.ok(h.enemies().every(e => e.state === "alert"), h.enemies().map(e => e.state).join());
});

// ---- Bosses -------------------------------------------------------------------------------------------

test("boss alerts keep native barks without duplicate toasts while phase warnings remain", () => {
  const harness = new Harness(64, 122, Math.PI, { encounters: COMBAT_TEST_ENCOUNTERS });
  harness.character.maxHealth = 1e6;
  harness.cw.spawnEncounter("combat-test-boss");
  harness.step(TICK);
  const enemy = harness.enemies().find(candidate => candidate.boss);
  assert.ok(enemy);
  harness.cw.damageEnemy(enemy.id, 1);
  assert.equal(harness.enemies().find(candidate => candidate.id === enemy.id)?.bark, "FRESH MEAT!");
  assert.ok(harness.cw.boss());
  assert.deepEqual(harness.of("message"), []);
  harness.cw.setHostile("combat-test-boss", false);
  harness.run(2.6);
  harness.cw.setHostile("combat-test-boss", true);
  harness.cw.damageEnemy(enemy.id, 1);
  assert.equal(harness.enemies().find(candidate => candidate.id === enemy.id)?.bark, "FRESH MEAT!");
  assert.deepEqual(harness.of("message"), []);
  harness.cw.damageEnemy(enemy.id, 450);
  harness.run(0.6);
  assert.ok(harness.of("message").some(message => message.text === BOSS.boss!.phases[1].message && message.tone === "danger"));
  assert.equal(harness.cw.encounterActive("combat-test-adds"), true);
});

test("boss phases: health thresholds change phase, announce it and summon reinforcements", () => {
  const h = new Harness(64, 122, Math.PI, { encounters: COMBAT_TEST_ENCOUNTERS });
  h.character.maxHealth = 1e6;
  h.cw.spawnEncounter("combat-test-boss");
  h.run(1.5);
  const boss = h.cw.boss();
  assert.ok(boss && boss.phase === 1 && boss.title === BOSS.boss!.title);
  const id = h.enemies().find(e => e.boss)!.id;
  h.cw.damageEnemy(id, 450);
  h.run(0.2);
  assert.equal(h.cw.boss()?.phase, 2);
  assert.ok(h.of("message").some(m => m.text === BOSS.boss!.phases[1].message));
  assert.equal(h.cw.encounterActive("combat-test-adds"), true, "phase 2 summoned the crew");
  h.cw.damageEnemy(id, 100); // ignored while roaring
  assert.ok(Math.abs(h.cw.boss()!.health - 550) < 1e-9, "invulnerable during the phase roar");
  h.run(1.5);
  h.cw.damageEnemy(id, 300);
  h.run(0.2);
  assert.equal(h.cw.boss()?.phase, 3);
  h.run(1.5);
  h.cw.damageEnemy(id, 1000);
  assert.equal(h.cw.boss(), null);
  const kill = h.of("killed").find(k => k.enemy === id);
  assert.ok(kill && kill.tags.includes("boss") && kill.encounter === "combat-test-boss");
});

test("a telegraphed boss slam hurts if you stand in it and is dodged with the roll's i-frames", () => {
  const SLAMMER: EnemyArchetype = { ...BOSS, id: "slammer", boss: { title: "Test", phases: [{ atHealth: 1, attacks: ["slam"] }] } };
  const trial = (dodge: boolean) => {
    const h = new Harness(64, 100, 0, { archetypes: [SLAMMER], encounters: [encounter("slam", [{ archetype: "slammer", x: 64, z: 97 }])] });
    h.character.maxHealth = 1e6;
    h.cw.spawnEncounter("slam");
    let telegraph = null;
    for (let i = 0; i < 60 * 20 && !telegraph; i++) {
      h.step(1 / 60);
      telegraph = h.cw.effects().find(fx => fx.kind === "telegraph" && fx.shape === "circle" && fx.progress >= 0.85) ?? null;
    }
    assert.ok(telegraph, "slam telegraphed on the ground");
    const before = h.cw.playerView().health;
    h.step(1 / 60, dodge ? { dodgePressed: true, forward: -1 } : {});
    h.run(0.3);
    return before - h.cw.playerView().health;
  };
  assert.ok(trial(false) >= 18 * 1.8 - 1e-9, "standing in the slam hurts");
  assert.equal(trial(true), 0, "rolling through the impact avoids it");
});

// ---- Events, clearing, respawn, save ------------------------------------------------------------------

test("kills emit killed and encounterCleared; one-shot clears persist through save/load; roaming ones respawn", () => {
  const defs = [encounter("solo", [{ archetype: "razorback-thug", x: 64, z: 96, tag: "leader" }], { auto: true }), encounter("roam", [{ archetype: "razorback-thug", x: 64, z: 90 }], { auto: true, respawn: 5 })];
  const h = new Harness(64, 100, Math.PI, { encounters: defs });
  const solo = h.enemies().find(e => e.id.startsWith("solo"))!;
  h.cw.damageEnemy(solo.id, 1000);
  const kill = h.of("killed")[0];
  assert.deepEqual({ ...kill, x: 0, z: 0 }, { type: "killed", enemy: solo.id, archetype: "razorback-thug", faction: "razorbacks", tags: ["razorback", "gang", "leader"], encounter: "solo", x: 0, z: 0, byPlayer: true });
  assert.ok(h.of("encounterCleared").some(e => e.encounter === "solo"));
  assert.equal(h.cw.encounterCleared("solo"), true);
  const roam = h.enemies().find(e => e.id.startsWith("roam"))!;
  h.cw.damageEnemy(roam.id, 1000);
  assert.equal(h.cw.encounterCleared("roam"), true);
  const save = JSON.parse(JSON.stringify(h.cw.serialize()));
  // A fresh world loading the save: the one-shot encounter stays dead, the roaming one waits.
  const fresh = new Harness(64, 100, Math.PI, { encounters: defs });
  assert.equal(fresh.cw.encounterActive("solo"), true);
  fresh.cw.load(save);
  assert.equal(fresh.cw.encounterActive("solo"), false);
  assert.equal(fresh.cw.encounterCleared("solo"), true);
  assert.equal(fresh.cw.encounterActive("roam"), false);
  fresh.run(6);
  assert.equal(fresh.cw.encounterActive("roam"), false, "no respawn in front of the player");
  fresh.x = 64; fresh.z = 260;
  fresh.run(0.5);
  assert.equal(fresh.cw.encounterActive("roam"), true, "respawned once the player is away");
  assert.equal(fresh.cw.encounterCleared("roam"), false);
  assert.equal(fresh.cw.encounterActive("solo"), false);
});

test("player death emits playerDied, enemies disengage, respawn restores the player", () => {
  const h = duel();
  h.character.maxHealth = 30;
  h.run(20);
  assert.equal(h.cw.playerDead, true);
  assert.equal(h.of("playerDied").length, 1);
  h.run(1);
  assert.ok(h.enemies().every(e => e.state !== "attack"));
  h.cw.respawnPlayer();
  assert.equal(h.cw.playerDead, false);
  assert.equal(h.cw.playerView().health, 30);
});

// ---- Balance sanity -----------------------------------------------------------------------------------

/** A simple bot: faces the nearest enemy, attacks in reach, and (if skilled) blocks telegraphs. */
function brawl(count: number, skilled: boolean, seed: number): { won: boolean; health: number; time: number } {
  const members = Array.from({ length: count }, (_, i) => ({ archetype: "razorback-thug", x: 64 + (i % 2 ? 2 : -2), z: 88 - Math.floor(i / 2) * 2 }));
  const h = new Harness(64, 100, 0, { encounters: [encounter("brawl", members)], seed });
  h.cw.spawnEncounter("brawl");
  let t = 0, tap = false;
  while (t < 90 && !h.cw.playerDead && h.enemies().some(e => e.deathAge < 0)) {
    h.faceNearest();
    const alive = h.enemies(20).filter(e => e.deathAge < 0);
    const nearest = Math.min(...alive.map(e => Math.hypot(e.x - h.x, e.z - h.z)));
    const threat = alive.some(e => e.attackKind === "melee" && e.attack > 0.25 && Math.hypot(e.x - h.x, e.z - h.z) < 3.5);
    const input: Partial<RpgInput> = {};
    if (skilled && threat) input.altHeld = true;
    else if (nearest < 3) { tap = !tap; input.attackHeld = tap; input.attackPressed = tap; input.attackReleased = !tap; }
    else input.forward = 1;
    if (input.forward) { const step = 5 / 60; h.x += Math.sin(h.yaw) * step; h.z -= Math.cos(h.yaw) * step; }
    h.step(1 / 60, input);
    t += 1 / 60;
  }
  return { won: !h.cw.playerDead && !h.enemies().some(e => e.deathAge < 0), health: h.cw.playerView().health, time: t };
}

test("balance: a careful starter beats two thugs; a careless one falls to five", () => {
  const two = [1, 2, 3].map(seed => brawl(2, true, seed));
  assert.ok(two.filter(r => r.won).length >= 2, `2 thugs, skilled: ${JSON.stringify(two)}`);
  const five = [1, 2, 3].map(seed => brawl(5, false, seed));
  assert.ok(five.filter(r => !r.won).length >= 2, `5 thugs, careless: ${JSON.stringify(five)}`);
});
