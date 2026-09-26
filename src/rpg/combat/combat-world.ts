// CombatWorld: the public face of the combat system. Owns the fixed-tick accumulator, latches the
// frame's input presses into the next tick, manages encounters (spawn, clear, respawn, leash,
// hostility), and builds the views rendering and the HUD read each frame.

import type { CityWorld } from "../../city/world.ts";
import type { EventBus } from "../events.ts";
import type { CombatCharacter, CombatEffect, EncounterDefinition, EnemyArchetype, EnemyView, ItemDefinition, PlayerCombatView, RpgFrame, WeaponSlot } from "../types.ts";
import { tickEnemy } from "./ai.ts";
import { hazardEffects, tickHazards } from "./boss.ts";
import { LEASH, SIM_RADIUS } from "./constants.ts";
import { Sim, type Enemy, type TickInput } from "./sim.ts";
import { MAX_TICKS_PER_FRAME, TICK, clamp, seededRandom } from "./util.ts";

/** Seconds a body stays in the enemy list after death (for the dissolve). */
const CORPSE_TIME = 8;

export interface CombatWorldOptions {
  world: CityWorld;
  bus: EventBus;
  items: { get(id: string): ItemDefinition | undefined };
  archetypes: readonly EnemyArchetype[];
  encounters: readonly EncounterDefinition[];
  rng?: () => number;
}

/** Saved combat progress: cleared one-shot encounters, respawn timers, hostility overrides, vitals. */
export interface CombatSave {
  version: 1;
  cleared: string[];
  respawn: Record<string, number>;
  hostile: Record<string, boolean>;
  health?: number;
  stamina?: number;
}

export class CombatWorld {
  private readonly sim: Sim;
  private acc = 0;
  private pending = { attackPressed: false, attackReleased: false, dodge: false, reload: false, select: null as WeaponSlot | null, quick: null as 1 | 2 | null };
  private lastX = NaN; private lastZ = NaN; private lastMoveX = 0; private lastMoveZ = 0;

  constructor(opts: CombatWorldOptions) {
    this.sim = new Sim(opts.world, opts.bus, opts.items, opts.rng ?? seededRandom(0x5eed));
    this.register({ archetypes: opts.archetypes, encounters: opts.encounters });
  }

  /** Adds archetypes / encounters (content packs); new `auto` encounters spawn immediately. */
  register(pack: { archetypes?: readonly EnemyArchetype[]; encounters?: readonly EncounterDefinition[] }): void {
    for (const a of pack.archetypes ?? []) this.sim.archetypes.set(a.id, a);
    for (const e of pack.encounters ?? []) this.sim.encounters.set(e.id, e);
    for (const e of pack.encounters ?? []) if (e.auto && !this.sim.cleared.has(e.id) && !this.sim.respawn.has(e.id)) this.sim.spawnGroup(e.id);
  }

  /** Spawns an encounter (quest effect). Clears its cleared mark; no-op while it is alive. */
  spawnEncounter(id: string): void {
    if (this.sim.groupAlive(id)) return;
    this.sim.cleared.delete(id); this.sim.respawn.delete(id);
    this.sim.spawnGroup(id);
  }
  /** Removes an encounter's enemies silently (no events) and cancels its respawn. */
  despawnEncounter(id: string): void { this.sim.despawnGroup(id); this.sim.respawn.delete(id); }
  /** Turns an encounter hostile (they attack on sight) or peaceful (they disengage and go home). */
  setHostile(encounter: string, hostile: boolean): void {
    this.sim.hostility.set(encounter, hostile);
    const group = this.sim.groups.get(encounter);
    if (group && !hostile && group.alerted) this.sim.resetGroup(group);
  }
  /** True once every member was killed (until a roaming encounter respawns). */
  encounterCleared(id: string): boolean { return this.sim.cleared.has(id); }
  /** True while the encounter has living members. */
  encounterActive(id: string): boolean { return this.sim.groupAlive(id); }

  /** Advances combat by the frame's dt in fixed 60 Hz ticks. `move` is displacement the engine
   * applies to the player this frame (dodge roll, knockback, lock-on magnetism, body push),
   * already clipped to walkable ground; run it through the engine's collision as usual. */
  update(frame: RpgFrame, character: CombatCharacter): { move: { x: number; z: number } | null } {
    const sim = this.sim, input = frame.input, p = this.pending;
    sim.character = character;
    p.attackPressed ||= input.attackPressed; p.attackReleased ||= input.attackReleased;
    p.dodge ||= input.dodgePressed; p.reload ||= input.reloadPressed;
    if (input.selectSlot) p.select = input.selectSlot;
    if (input.quickUse) p.quick = input.quickUse;
    const dt = Number.isFinite(frame.dt) ? Math.max(0, frame.dt) : 0;
    // Engine-driven velocity (combat's own moves excluded) for enemy gunners' lead error.
    if (Number.isFinite(this.lastX) && dt > 0) {
      const vx = (frame.player.x - (this.lastX + this.lastMoveX)) / dt, vz = (frame.player.z - (this.lastZ + this.lastMoveZ)) / dt;
      const teleport = Math.hypot(vx, vz) > 40;
      sim.pvx = teleport ? 0 : clamp(vx, -20, 20); sim.pvz = teleport ? 0 : clamp(vz, -20, 20);
    }
    sim.baseX = frame.player.x; sim.baseZ = frame.player.z; sim.moveX = 0; sim.moveZ = 0;
    sim.eye = frame.player.eye; sim.yaw = frame.player.yaw; sim.pitch = frame.player.pitch; sim.onFoot = frame.player.onFoot;
    this.acc = Math.min(this.acc + dt, MAX_TICKS_PER_FRAME * TICK);
    for (let n = 0; n < MAX_TICKS_PER_FRAME && this.acc >= TICK - 1e-9; n++) { this.acc -= TICK; this.step(input); }
    this.lastX = frame.player.x; this.lastZ = frame.player.z; this.lastMoveX = sim.moveX; this.lastMoveZ = sim.moveZ;
    return { move: sim.moveX !== 0 || sim.moveZ !== 0 ? { x: sim.moveX, z: sim.moveZ } : null };
  }

  private step(input: RpgFrame["input"]): void {
    const sim = this.sim, p = this.pending;
    sim.tick++; sim.time = sim.tick * TICK;
    const tick: TickInput = {
      attackHeld: input.attackHeld, attackPressed: p.attackPressed, attackReleased: p.attackReleased, altHeld: input.altHeld,
      dodge: p.dodge, reload: p.reload, select: p.select, quick: p.quick, forward: input.forward, strafe: input.strafe,
    };
    p.attackPressed = p.attackReleased = p.dodge = p.reload = false; p.select = null; p.quick = null;
    sim.player.tick(sim, tick);
    this.maintainEncounters();
    sim.allocateTokens();
    const r2 = SIM_RADIUS * SIM_RADIUS;
    for (const e of sim.enemies) {
      if ((e.x - sim.px) ** 2 + (e.z - sim.pz) ** 2 > r2) {
        // Frozen out of range; one walking home just arrives.
        if (e.returning) { e.x = e.homeX; e.z = e.homeZ; e.yaw = e.homeYaw; e.health = e.maxHealth; e.returning = false; e.state = e.patrol ? "patrol" : "idle"; if (e.boss) e.boss.phase = 0; }
        continue;
      }
      tickEnemy(sim, e);
    }
    tickHazards(sim);
    sim.bodyCollisions();
    sim.ageFx();
    if (sim.tick % 30 === 0) sim.enemies = sim.enemies.filter(e => e.deathTime < 0 || sim.time - e.deathTime < CORPSE_TIME);
  }

  private maintainEncounters(): void {
    const sim = this.sim;
    for (const [id, remaining] of sim.respawn) {
      const def = sim.encounters.get(id);
      if (!def) { sim.respawn.delete(id); continue; }
      const left = remaining - TICK;
      // Respawn out of sight, never on top of the player.
      if (left <= 0 && (!sim.playerPresent || Math.hypot(sim.px - def.area.x, sim.pz - def.area.z) > def.area.radius + 60)) {
        sim.respawn.delete(id); sim.cleared.delete(id); sim.spawnGroup(id);
      } else sim.respawn.set(id, Math.max(0, left));
    }
    for (const group of sim.groups.values()) {
      if (!group.alerted) continue;
      const area = group.def.area;
      if (!sim.playerPresent || Math.hypot(sim.px - area.x, sim.pz - area.z) > area.radius + LEASH) sim.resetGroup(group);
    }
  }

  /** The player's combat state for the HUD / first-person weapon. */
  playerView(): PlayerCombatView { return this.sim.player.view(this.sim, this.inCombat()); }

  private inCombat(): boolean {
    const sim = this.sim;
    if (sim.time - sim.lastCombatAt < 5) return true;
    for (const e of sim.enemies) if (e.deathTime < 0 && e.alerted && !e.returning && (e.x - sim.px) ** 2 + (e.z - sim.pz) ** 2 < 60 * 60) return true;
    return false;
  }

  /** Enemies (alive, and dead ones still dissolving) within `radius` of `near`. */
  enemies(near: { x: number; z: number }, radius: number): EnemyView[] {
    const sim = this.sim, out: EnemyView[] = [], r2 = radius * radius, lock = sim.player.lock;
    for (const e of sim.enemies) if ((e.x - near.x) ** 2 + (e.z - near.z) ** 2 <= r2) out.push(this.view(e, e === lock));
    return out;
  }

  private view(e: Enemy, locked: boolean): EnemyView {
    const sim = this.sim, a = e.attack;
    let attack = 0;
    if (a) attack = a.t < a.windup ? a.t / a.windup : a.t <= a.windup + a.active || a.shots > 0 ? 1 : clamp(1 - (a.t - a.windup - a.active) / Math.max(a.recovery, 1e-3), 0, 1);
    return {
      id: e.id, archetype: e.arch.id, name: e.arch.name, faction: e.arch.faction,
      x: e.x, z: e.z, yaw: e.yaw, health: Math.max(0, e.health), maxHealth: e.maxHealth, state: e.state,
      attack, hitAge: sim.time - e.hitTime, deathAge: e.deathTime >= 0 ? sim.time - e.deathTime : -1,
      weaponClass: e.weapon.class, look: e.arch.look, bark: e.bark, hostile: sim.hostileOf(e.group.id),
      windup: !!a && a.t < a.windup, attackKind: a?.kind ?? null, locked, vulnerable: sim.time < e.critUntil,
      boss: !!e.boss, scale: e.arch.scale ?? 1,
    };
  }

  /** Transient effects (tracers, sparks, slashes, numbers, muzzle flashes) plus live boss
   * telegraphs, shockwave rings and projectiles. */
  effects(): readonly CombatEffect[] { return [...this.sim.transientFx(), ...hazardEffects(this.sim)]; }

  /** The current soft lock-on target's enemy id. */
  lockTarget(): string | null { const lock = this.sim.player.lock; return lock && lock.deathTime < 0 ? lock.id : null; }

  /** The engaged boss nearest the player, for the boss health bar (phase is 1-based). */
  boss(): { name: string; title: string; health: number; maxHealth: number; phase: number } | null {
    const sim = this.sim;
    let best: Enemy | null = null, bestD = 80;
    for (const e of sim.enemies) {
      if (!e.boss || e.deathTime >= 0 || !e.alerted || e.returning) continue;
      const d = Math.hypot(e.x - sim.px, e.z - sim.pz);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best ? { name: best.arch.name, title: best.arch.boss?.title ?? "", health: Math.max(0, best.health), maxHealth: best.maxHealth, phase: (best.boss?.phase ?? 0) + 1 } : null;
  }

  /** Revives the player at full health (the engine moves them to the respawn point). */
  respawnPlayer(): void {
    this.sim.player.respawn();
    this.sim.projectiles = []; this.sim.rings = [];
  }
  get playerDead(): boolean { return this.sim.player.dead; }

  /** Direct damage to an enemy (scripted events, explosions, tests). */
  damageEnemy(id: string, amount: number, byPlayer = true): void {
    const e = this.sim.enemies.find(m => m.id === id);
    if (e) this.sim.damageEnemy(e, amount, { critical: false, byPlayer, stagger: 0, knockback: 0, dirX: 0, dirZ: 0 });
  }

  serialize(): CombatSave {
    const sim = this.sim;
    return {
      version: 1, cleared: [...sim.cleared], respawn: Object.fromEntries(sim.respawn), hostile: Object.fromEntries(sim.hostility),
      health: sim.player.dead || sim.player.health < 0 ? sim.player.maxHealth : sim.player.health, stamina: Math.max(0, sim.player.stamina),
    };
  }

  /** Restores a save: cleared encounters stay gone, roaming ones wait out their timers. */
  load(state: unknown): void {
    if (!state || typeof state !== "object") return;
    const s = state as Partial<Record<keyof CombatSave, unknown>>, sim = this.sim;
    sim.cleared.clear(); sim.respawn.clear(); sim.hostility.clear();
    if (Array.isArray(s.cleared)) for (const id of s.cleared) if (typeof id === "string") sim.cleared.add(id);
    if (s.respawn && typeof s.respawn === "object") for (const [id, t] of Object.entries(s.respawn)) if (typeof t === "number" && Number.isFinite(t)) sim.respawn.set(id, Math.max(0, t));
    if (s.hostile && typeof s.hostile === "object") for (const [id, h] of Object.entries(s.hostile)) if (typeof h === "boolean") sim.hostility.set(id, h);
    for (const [id, def] of sim.encounters) {
      if (sim.cleared.has(id) || sim.respawn.has(id)) sim.despawnGroup(id);
      else if (def.auto && !sim.groupAlive(id)) sim.spawnGroup(id);
    }
    if (typeof s.health === "number" && Number.isFinite(s.health) && s.health > 0) { sim.player.health = s.health; sim.player.synced = false; }
    if (typeof s.stamina === "number" && Number.isFinite(s.stamina)) sim.player.stamina = Math.max(0, s.stamina);
  }
}
