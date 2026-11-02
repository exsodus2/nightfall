// Combat animation polish: views interpolate between fixed ticks, nothing pulses faster than the
// comfort ceiling, warnings brighten with progress, the weapon swap lowers then raises, the hurt
// flinch is an eased impulse, the death collapse fades to nothing and enemy poses ease.
import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld } from "../src/city/world.ts";
import { EventBus } from "../src/rpg/events.ts";
import { COMBAT_TEST_ARCHETYPES, COMBAT_TEST_ITEMS, CombatWorld, TICK, seededRandom } from "../src/rpg/combat/index.ts";
import type { CombatCharacter, ConsumableStats, EncounterDefinition, EnemyView, ItemDefinition, PlayerCombatView, RpgInput, WeaponSlot } from "../src/rpg/types.ts";
import {
  DEATH_COLLAPSE, FLINCH_TIME, HEARTBEAT_HZ, LOCK_BREATHE_HZ, MAX_PULSE_HZ, SWAP_LOWER, SWAP_RAISE, TELEGRAPH_HZ, attackHeat,
  deathBodyGain, flinch, heartbeat, lockAlpha, resetSettledPoses, settlePose, swapDepth, telegraphEdge, telegraphGlow, telegraphPulse,
  telegraphScale, type AttackStage,
} from "../src/rpg/scene/anim.ts";
import { resetViewmodel, viewmodelState } from "../src/rpg/scene/index.ts";

const world = new CityWorld();
const ITEMS = new Map<string, ItemDefinition>(COMBAT_TEST_ITEMS.map(item => [item.id, item]));

class TestCharacter implements CombatCharacter {
  weapons: Partial<Record<WeaponSlot, string>> = { melee: "combat-test-blade", sidearm: "combat-test-pistol" };
  mags: Record<string, number> = {};
  reserves: Record<string, number> = { "combat-test-9mm": 16 };
  quick: (ConsumableStats | null)[] = [null, null];
  maxHealth = 1000; maxStamina = 100; protection = 0; damageBonus = 1;
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

/** A thug 12 m north of a player who never moves (yaw 0 faces -z, toward it). */
function fight() {
  const encounter: EncounterDefinition = { id: "interp", label: "interp", area: { x: 64, z: 96, radius: 14 }, hostile: true, members: [{ archetype: "razorback-thug", x: 64, z: 98, yaw: Math.PI }] };
  const cw = new CombatWorld({ world, bus: new EventBus(), items: ITEMS, archetypes: COMBAT_TEST_ARCHETYPES, encounters: [encounter], rng: seededRandom(11) });
  cw.spawnEncounter("interp");
  const character = new TestCharacter();
  let time = 0;
  const frame = (dt: number) => {
    time += dt;
    cw.update({ dt, time, player: { x: 64, z: 110, eye: 2.7, yaw: 0, pitch: 0, mode: "walk", onFoot: true }, input: idle() }, character);
  };
  const view = (): EnemyView => cw.enemies({ x: 64, z: 110 }, 200)[0];
  return { cw, frame, view };
}

// ---- Interpolation ------------------------------------------------------------------------------------
test("enemy views interpolate between ticks by acc / TICK; clocks run on between ticks", () => {
  const { cw, frame, view } = fight();
  let checked = 0;
  for (let i = 0; i < 600 && checked < 3; i++) {
    frame(TICK);
    const v0 = view(); // acc ~ 0: the previous tick's pose
    frame(TICK / 2); // no tick runs: half way
    const half = view();
    frame(TICK / 2); // one tick runs: acc ~ 0 again, the next pose
    const v1 = view();
    const moved = Math.hypot(v1.x - v0.x, v1.z - v0.z);
    if (moved < 1e-3 || v0.state !== v1.state) continue;
    assert.ok(Math.abs(half.x - (v0.x + v1.x) / 2) < 1e-9 && Math.abs(half.z - (v0.z + v1.z) / 2) < 1e-9, "half a tick in, the view is half way between the ticks");
    checked++;
  }
  assert.equal(checked, 3, "the thug chased (moved between ticks)");
  // Ages advance with the leftover acc, not in 1/60 s steps.
  cw.damageEnemy(view().id, 1e5);
  frame(TICK);
  const d0 = view().deathAge;
  frame(TICK / 2);
  const d1 = view().deathAge;
  assert.ok(d0 >= 0 && Math.abs(d1 - d0 - TICK / 2) < 1e-9, `death age ran on by half a tick (${d0} -> ${d1})`);
});

test("at 144 Hz a chasing enemy moves every frame (no 60 Hz judder: frames without a tick still move)", () => {
  const { frame, view } = fight();
  for (let i = 0; i < 1200 && view().state !== "chase"; i++) frame(1 / 144);
  assert.equal(view().state, "chase", "the thug gave chase");
  let last = view(), total = 0, still = 0, frames = 0;
  for (let i = 0; i < 30 && view().state === "chase"; i++) {
    frame(1 / 144);
    const v = view(), d = Math.hypot(v.x - last.x, v.z - last.z);
    total += d; frames++;
    if (d < 1e-6) still++;
    last = v;
  }
  assert.ok(frames >= 10 && total > 0.1, `it ran (${total.toFixed(2)} m over ${frames} frames)`);
  // Unsmoothed, ~60% of 144 Hz frames have no tick and would not move at all.
  assert.ok(still <= 2, `${still} of ${frames} frames stood still`);
});

// ---- Comfort rates ----------------------------------------------------------------------------------
/** Local maxima of f over [0, seconds) sampled at 1 kHz. */
function peaks(f: (t: number) => number, seconds: number): number {
  let n = 0, a = f(0), b = f(0.001);
  for (let t = 0.002; t < seconds; t += 0.001) { const c = f(t); if (b > a && b >= c) n++; a = b; b = c; }
  return n;
}

test("no pulse runs faster than 0.4 Hz: lock-on breathe, heartbeat, telegraph swell", () => {
  assert.ok(MAX_PULSE_HZ <= 0.4);
  assert.ok(LOCK_BREATHE_HZ <= 0.3 && HEARTBEAT_HZ <= MAX_PULSE_HZ && TELEGRAPH_HZ <= MAX_PULSE_HZ);
  assert.ok(peaks(lockAlpha, 20) <= 0.3 * 20 + 1, "lock bracket breathes at most 0.3 Hz");
  assert.ok(peaks(t => heartbeat(t, 1), 20) <= MAX_PULSE_HZ * 20 + 1, "heartbeat at most 0.4 Hz");
  assert.ok(peaks(telegraphPulse, 20) <= MAX_PULSE_HZ * 20 + 1);
  for (let t = 0; t < 10; t += 0.01) {
    assert.ok(lockAlpha(t) >= 200 && lockAlpha(t) <= 255, "a steady bracket: never dims below ~80%");
    assert.ok(heartbeat(t, 1) >= 0.75 && heartbeat(t, 1) <= 1, "soft heartbeat depth");
  }
  // Falling health deepens the beat instead of speeding it up.
  let deep = 1, shallow = 1;
  for (let t = 0; t < 3; t += 0.01) { deep = Math.min(deep, heartbeat(t, 1)); shallow = Math.min(shallow, heartbeat(t, 0.2)); }
  assert.ok(deep < shallow, "deeper at low health");
});

test("telegraphs brighten monotonically with progress (no oscillator) and the '!' eases in", () => {
  for (let k = 0; k < 1; k += 0.01) {
    assert.ok(telegraphGlow(k + 0.01) >= telegraphGlow(k) - 1e-12, "the '!' heats toward the strike");
    assert.ok(telegraphEdge(k + 0.01) >= telegraphEdge(k) - 1e-12, "the ground outline brightens toward impact");
    assert.ok(telegraphScale(k + 0.01) >= telegraphScale(k) - 1e-12);
  }
  assert.ok(telegraphGlow(0) > 0.5, "readable from the first frame");
  assert.ok(telegraphScale(0) > 0.4 && telegraphScale(0) < 1 && Math.abs(telegraphScale(0.2) - 1) < 1e-9, "pops in over the first fifth");
  // Attack heat is continuous across the stage changes.
  const heat = (stage: AttackStage, k: number) => attackHeat({ stage, k });
  assert.equal(heat("windup", 0), 0);
  assert.ok(Math.abs(heat("windup", 1) - heat("strike", 0)) < 1e-9);
  assert.ok(Math.abs(heat("strike", 1) - heat("recover", 0)) < 1e-9);
  assert.ok(Math.abs(heat("recover", 1)) < 1e-9 && heat("none", 0) === 0);
});

// ---- Death, flinch, pose settling -----------------------------------------------------------------------
test("the death collapse fades the body to nothing by DEATH_COLLAPSE", () => {
  assert.equal(deathBodyGain(0), 1);
  for (let a = 0; a < DEATH_COLLAPSE; a += 0.005) assert.ok(deathBodyGain(a + 0.005) <= deathBodyGain(a) + 1e-12, "only fades");
  assert.ok(deathBodyGain(DEATH_COLLAPSE - 1e-4) < 0.01, "at nothing as it ends");
  assert.equal(deathBodyGain(DEATH_COLLAPSE), 0);
});

test("the hurt flinch is an eased impulse: starts and ends at rest, no jumps", () => {
  assert.equal(flinch(0), 0);
  assert.equal(flinch(FLINCH_TIME), 0);
  assert.equal(flinch(Infinity), 0);
  let peak = 0, peakAt = 0;
  for (let t = 0; t < FLINCH_TIME; t += 0.001) {
    const v = flinch(t);
    if (v > peak) { peak = v; peakAt = t; }
    assert.ok(Math.abs(flinch(t + 0.001) - v) < 0.03, "smooth");
  }
  assert.ok(peak > 0.99 && peakAt < 0.1, "a quick nudge that settles");
});

test("settlePose eases a stepped value, repeats at the same time and snaps after a gap", () => {
  resetSettledPoses();
  const p = { a: 0 };
  settlePose("s", p, ["a"], 1); assert.equal(p.a, 0);
  p.a = 1; settlePose("s", p, ["a"], 1 + 1 / 60);
  const first = p.a;
  assert.ok(first > 0.1 && first < 0.5, `eases instead of stepping (${first})`);
  p.a = 1; settlePose("s", p, ["a"], 1 + 1 / 60);
  assert.equal(p.a, first, "a second pass at the same time gives the same result");
  let t = 1 + 1 / 60;
  for (let i = 0; i < 30; i++) { t += 1 / 60; p.a = 1; settlePose("s", p, ["a"], t); }
  assert.ok(p.a > 0.999, "arrives within half a second");
  p.a = -5; settlePose("s", p, ["a"], t + 2);
  assert.equal(p.a, -5, "a long gap snaps");
});

// ---- Weapon swap ----------------------------------------------------------------------------------------
const view = (extra: Partial<PlayerCombatView> = {}): PlayerCombatView => ({ health: 82, maxHealth: 100, stamina: 60, maxStamina: 100, weapon: "sidearm", weaponItem: "combat-test-pistol", weaponClass: "pistol", ammo: { loaded: 8, reserve: 16 }, action: "idle", actionProgress: 0, hitConfirmAge: Infinity, hurtAge: Infinity, hurtFrom: null, inCombat: true, dead: false, ...extra });
const PISTOL = ITEMS.get("combat-test-pistol")!, BLADE = ITEMS.get("combat-test-blade")!;
const BLADE_VIEW: Partial<PlayerCombatView> = { weapon: "melee", weaponItem: "combat-test-blade", weaponClass: "blade", ammo: null };

test("a weapon swap lowers the old weapon, swaps out of view, then raises the new one", () => {
  // The combat system's switch takes 0.3 s; the drawn swap matches it.
  assert.ok(Math.abs(SWAP_LOWER + SWAP_RAISE - 0.3) < 1e-9);
  resetViewmodel();
  const y0 = viewmodelState(view(), PISTOL, 1).right.y;
  const samples: { t: number; y: number; model: string; swap: number; item: string | null }[] = [];
  const start = viewmodelState(view(BLADE_VIEW), BLADE, 1.5); // the swap starts here
  assert.ok(start.model === "pistol" && start.swap === 0, "the first frame of a swap still shows the pistol at rest");
  for (let i = 0; i < 46; i++) {
    const t = 0.005 + i * 0.01; // offset so no sample sits exactly on the lower / raise boundary
    const s = viewmodelState(view(BLADE_VIEW), BLADE, 1.5 + t);
    samples.push({ t, y: s.right.y, model: s.model, swap: s.swap, item: s.item?.id ?? null });
  }
  const lowering = samples.filter(s => s.t < SWAP_LOWER - 1e-6);
  assert.ok(lowering.length > 5 && lowering.every(s => s.model === "pistol" && s.item === "combat-test-pistol"), "the pistol stays drawn while it lowers");
  for (let i = 1; i < lowering.length; i++) assert.ok(lowering[i].y < lowering[i - 1].y + 1e-4, "lowering only goes down");
  assert.ok(lowering[lowering.length - 1].y < y0 - 0.25, "nearly out of view at the bottom");
  const after = samples.filter(s => s.t >= SWAP_LOWER);
  assert.ok(after.every(s => s.model === "blade" && s.item === "combat-test-blade"), "the blade comes up, never the pistol again");
  for (let i = 1; i < after.length; i++) assert.ok(after[i].swap <= after[i - 1].swap + 1e-12, "raising only goes up");
  assert.ok(Math.max(...samples.map(s => s.swap)) > 0.95 && samples[samples.length - 1].swap === 0, "down to the bottom and fully back");
  for (let i = 1; i < samples.length; i++) assert.ok(Math.abs(samples[i].swap - samples[i - 1].swap) < 0.25, "no jumps in the swap depth");
  const rest = viewmodelState(view(BLADE_VIEW), BLADE, 3).right.y;
  assert.ok(Math.abs(samples[samples.length - 1].y - rest) < 0.01, "ends at the blade's rest pose");
});

test("a swap started mid-raise lowers from where the weapon is (no pop)", () => {
  resetViewmodel();
  viewmodelState(view(), PISTOL, 1);
  viewmodelState(view(BLADE_VIEW), BLADE, 2);
  const mid = viewmodelState(view(BLADE_VIEW), BLADE, 2 + SWAP_LOWER + 0.06).swap;
  assert.ok(mid > 0.05 && mid < 0.9, "mid-raise");
  const again = viewmodelState(view(), PISTOL, 2 + SWAP_LOWER + 0.07);
  assert.ok(Math.abs(again.swap - mid) < 0.1 && again.model === "blade", "the blade lowers again from where it was");
  const pure = swapDepth(0.01, mid);
  assert.ok(pure.lowering && pure.depth >= mid);
});
