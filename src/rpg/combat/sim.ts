// Internal combat state shared by the player controller (player.ts), enemy AI (ai.ts) and bosses
// (boss.ts). Not part of the public API: CombatWorld (combat-world.ts) wraps it. Everything here
// advances only in fixed TICK steps, so the same inputs and seed give the same fight whatever the
// frame rate.

import { WALK_HEIGHT } from "../../city/locomotion.ts";
import type { CityWorld } from "../../city/world.ts";
import type { EventBus } from "../events.ts";
import type { CombatCharacter, CombatEffect, EncounterDefinition, EnemyArchetype, EnemyState, GameEvent, ItemDefinition, WeaponSlot, WeaponStats } from "../types.ts";
import { COMBAT_TEST_ITEMS } from "./archetypes.ts";
import { PlayerCombat } from "./player.ts";
import { walkable } from "./raycast.ts";
import { FISTS, MELEE_TOKENS, PLAYER_BODY, RANGED_TOKENS, TOKEN_SPACING, isRanged } from "./constants.ts";
import { TICK, pick, turnToward, yawTo } from "./util.ts";

export type AttackKind = "melee" | "ranged" | "slam" | "sweep" | "barrage" | "charge" | "summon" | "shockwave";
export interface EnemyAttack {
  kind: AttackKind;
  t: number;
  windup: number; active: number; recovery: number;
  /** Committed facing of the swing / dash. */
  yaw: number;
  hit: boolean;
  /** Ranged bursts / barrage volleys still to fire, and the timer to the next. */
  shots: number; shotTimer: number;
  /** Charge: start point and distance run. */
  originX: number; originZ: number; travelled: number;
  damage: number;
}
export interface BossState { phase: number; sigTimer: number; cycle: number; roarUntil: number; lastSummon: number }
export interface Group {
  id: string;
  def: EncounterDefinition;
  members: Enemy[];
  alerted: boolean;
  lastKnownX: number; lastKnownZ: number; lastSeen: number;
}
export interface Enemy {
  id: string;
  arch: EnemyArchetype;
  weapon: WeaponStats;
  group: Group;
  member: number;
  tag: string | undefined;
  x: number; z: number; yaw: number;
  vx: number; vz: number;
  radius: number; height: number;
  health: number; maxHealth: number;
  state: EnemyState;
  awareness: number;
  alerted: boolean;
  reaction: number;
  seesPlayer: boolean;
  /** Point to look at / walk to while suspicious (a noise, a glimpse). */
  investigate: { x: number; z: number } | null;
  homeX: number; homeZ: number; homeYaw: number;
  patrol: readonly { x: number; z: number }[] | null;
  patrolIndex: number; pauseUntil: number;
  attack: EnemyAttack | null;
  cooldown: number;
  token: "melee" | "ranged" | null;
  tokenSince: number;
  waitingSince: number;
  stagger: number;
  staggerChain: number; lastStaggerAt: number;
  critUntil: number;
  hitTime: number; deathTime: number;
  bark: string | null; barkUntil: number; lastBark: number;
  returning: boolean;
  fleeUntil: number; fleeChecked: boolean;
  circleSide: number; circleFlipAt: number;
  avoidSide: number;
  route: { x: number; z: number }[] | null; routeCheck: number; routeGoalX: number; routeGoalZ: number;
  stuck: number; progressX: number; progressZ: number; progressAt: number;
  ammo: number; reloadUntil: number;
  boss: BossState | null;
  slice: number;
}
export interface Projectile { id: number; x: number; y: number; z: number; vx: number; vz: number; radius: number; age: number; life: number; damage: number; owner: Enemy }
export interface Ring { x: number; z: number; radius: number; speed: number; max: number; width: number; damage: number; hit: boolean; owner: Enemy; delay: number; age: number }
interface TransientFx { effect: CombatEffect; life: number }
/** Input as the fixed tick sees it: held state plus presses latched since the previous tick. */
export interface TickInput {
  attackHeld: boolean; attackPressed: boolean; attackReleased: boolean; altHeld: boolean;
  dodge: boolean; reload: boolean; select: WeaponSlot | null; quick: 1 | 2 | null;
  forward: number; strafe: number;
}
export interface ItemLookup { get(id: string): ItemDefinition | undefined }

const FALLBACK_ITEMS = new Map(COMBAT_TEST_ITEMS.map(item => [item.id, item]));

export class Sim {
  readonly world: CityWorld;
  readonly bus: EventBus;
  readonly items: ItemLookup;
  readonly rng: () => number;
  readonly archetypes = new Map<string, EnemyArchetype>();
  readonly encounters = new Map<string, EncounterDefinition>();
  readonly groups = new Map<string, Group>();
  enemies: Enemy[] = [];
  /** Encounters currently cleared (one-shot ones stay here forever). */
  readonly cleared = new Set<string>();
  /** Seconds until a cleared roaming encounter respawns. */
  readonly respawn = new Map<string, number>();
  readonly hostility = new Map<string, boolean>();
  projectiles: Projectile[] = [];
  rings: Ring[] = [];
  fx: TransientFx[] = [];
  time = 0;
  tick = 0;
  player: PlayerCombat;
  character: CombatCharacter | null = null;
  // Player pose: the frame's position plus the displacement combat has queued this frame, so
  // every tick sees where the engine will put the player (moves are applied unmodified).
  baseX = 0; baseZ = 0;
  moveX = 0; moveZ = 0;
  eye = WALK_HEIGHT; yaw = 0; pitch = 0;
  onFoot = true;
  /** Player velocity estimated from frame to frame (lead for enemy gunners' inaccuracy). */
  pvx = 0; pvz = 0;
  lastMeleeGrant = -Infinity;
  lastCombatAt = -Infinity;
  private nextId = 1;
  private projectileId = 1;

  constructor(world: CityWorld, bus: EventBus, items: ItemLookup, rng: () => number) {
    this.world = world; this.bus = bus; this.items = items; this.rng = rng;
    this.player = new PlayerCombat();
  }

  get px(): number { return this.baseX + this.moveX; }
  get pz(): number { return this.baseZ + this.moveZ; }
  get playerPresent(): boolean { return this.onFoot && !this.player.dead; }
  emit(event: GameEvent): void { this.bus.emit(event); }
  addFx(effect: CombatEffect, life: number): void { this.fx.push({ effect, life }); if (this.fx.length > 400) this.fx.splice(0, this.fx.length - 400); }
  transientFx(): CombatEffect[] { return this.fx.map(f => f.effect); }
  ageFx(): void {
    for (const f of this.fx) f.effect.age += TICK;
    this.fx = this.fx.filter(f => f.effect.age < f.life);
  }
  newProjectileId(): number { return this.projectileId++; }

  item(id: string): ItemDefinition | undefined { return this.items.get(id) ?? FALLBACK_ITEMS.get(id); }
  weaponOf(itemId: string): WeaponStats { return this.item(itemId)?.weapon ?? FISTS; }
  hostileOf(encounter: string): boolean { return this.hostility.get(encounter) ?? this.encounters.get(encounter)?.hostile ?? true; }

  // ---- Movement -------------------------------------------------------------------------------

  /** Moves a body by (dx, dz) in small axis-separated steps that never leave walkable ground. */
  tryMove(x: number, z: number, dx: number, dz: number): { x: number; z: number } {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
    for (let i = 0; i < steps; i++) {
      if (this.world.canOccupy(x + dx / steps, z)) x += dx / steps;
      if (this.world.canOccupy(x, z + dz / steps)) z += dz / steps;
    }
    return { x, z };
  }
  /** Queues player displacement (dodge, knockback, magnetism, body push), clipped to walkable. */
  movePlayer(dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    const to = this.tryMove(this.px, this.pz, dx, dz);
    this.moveX = to.x - this.baseX; this.moveZ = to.z - this.baseZ;
  }
  /** Nearest walkable point to (x, z), searching outwards (spawn points placed in a wall). */
  nearestWalkable(x: number, z: number): { x: number; z: number } {
    if (this.world.canOccupy(x, z)) return { x, z };
    for (let r = 1; r <= 16; r += 1) for (let a = 0; a < 16; a++) {
      const px = x + Math.cos(a / 16 * Math.PI * 2) * r, pz = z + Math.sin(a / 16 * Math.PI * 2) * r;
      if (this.world.canOccupy(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }

  /** Street-grid detour for when the straight line to the goal crosses a building: onto the
   * nearest street centre line, along the grid, off at the goal's street. Centre lines are clear. */
  streetRoute(ax: number, az: number, bx: number, bz: number): { x: number; z: number }[] {
    const snap = (x: number, z: number) => {
      const sx = Math.round(x / 64) * 64, sz = Math.round(z / 64) * 64;
      return Math.abs(x - sx) < Math.abs(z - sz) ? { x: sx, z } : { x, z: sz };
    };
    const a = snap(ax, az), b = snap(bx, bz);
    const ai = { x: Math.round(a.x / 64) * 64, z: Math.round(a.z / 64) * 64 };
    const bi = { x: Math.round(b.x / 64) * 64, z: Math.round(b.z / 64) * 64 };
    const sameStreet = (a.x === b.x && Math.abs(a.x - Math.round(a.x / 64) * 64) < 1e-6) || (a.z === b.z && Math.abs(a.z - Math.round(a.z / 64) * 64) < 1e-6);
    const raw = sameStreet ? [a, b, { x: bx, z: bz }] : [a, ai, { x: bi.x, z: ai.z }, bi, b, { x: bx, z: bz }];
    const points = raw.filter((p, i) => i === 0 || Math.hypot(p.x - raw[i - 1].x, p.z - raw[i - 1].z) > 0.5);
    // Skip leading points the body can already walk past directly.
    while (points.length > 1 && walkable(this.world, ax, az, points[1].x, points[1].z)) points.shift();
    return points;
  }

  /** Steers an enemy toward (tx, tz) at `speed`: street detours around blocks, probe-based local
   * avoidance, separation from other enemies, and a personal-space stop at the player. Returns
   * true once within `stopAt` of the goal. `face`: "move" turns to the heading, "player" keeps
   * facing the player (circling, backing off). */
  steer(e: Enemy, tx: number, tz: number, speed: number, face: "move" | "player", stopAt = 0.3): boolean {
    const dt = TICK;
    const dist = Math.hypot(tx - e.x, tz - e.z);
    let dirX = 0, dirZ = 0;
    const arrived = dist <= stopAt;
    if (!arrived) {
      // Re-plan occasionally or when the goal moved: straight when walkable, else streets.
      if (this.time >= e.routeCheck || Math.hypot(tx - e.routeGoalX, tz - e.routeGoalZ) > 6) {
        e.routeCheck = this.time + 0.6 + (e.slice % 4) * 0.05; e.routeGoalX = tx; e.routeGoalZ = tz;
        e.route = walkable(this.world, e.x, e.z, tx, tz) ? null : this.streetRoute(e.x, e.z, tx, tz);
      }
      let gx = tx, gz = tz;
      if (e.route && e.route.length) {
        while (e.route.length > 1 && Math.hypot(e.route[0].x - e.x, e.route[0].z - e.z) < 1.5) e.route.shift();
        gx = e.route[0].x; gz = e.route[0].z;
      }
      const gd = Math.hypot(gx - e.x, gz - e.z) || 1;
      dirX = (gx - e.x) / gd; dirZ = (gz - e.z) / gd;
      // Local avoidance: probe ahead; rotate the heading until the probe is clear.
      const clear = (x: number, z: number) => this.world.canOccupy(e.x + x * 0.7, e.z + z * 0.7) && this.world.canOccupy(e.x + x * 1.5, e.z + z * 1.5);
      if (!clear(dirX, dirZ)) {
        let found = false;
        for (const angle of [0.4, 0.8, 1.2, 1.6, 2.1, 2.6]) {
          for (const side of [e.avoidSide, -e.avoidSide]) {
            const c = Math.cos(angle * side), s = Math.sin(angle * side);
            const rx = dirX * c - dirZ * s, rz = dirX * s + dirZ * c;
            if (clear(rx, rz)) { dirX = rx; dirZ = rz; found = true; e.avoidSide = side; break; }
          }
          if (found) break;
        }
      }
    }
    // Separation from nearby enemies (a pack spreads out instead of stacking).
    let sepX = 0, sepZ = 0;
    for (const o of this.enemies) {
      if (o === e || o.deathTime >= 0) continue;
      const ox = e.x - o.x, oz = e.z - o.z, limit = e.radius + o.radius + 0.6;
      if (Math.abs(ox) > limit || Math.abs(oz) > limit) continue;
      const d = Math.hypot(ox, oz);
      if (d < limit) {
        const w = (1 - d / limit) * 1.6;
        if (d > 1e-4) { sepX += ox / d * w; sepZ += oz / d * w; } else { sepX += Math.cos(e.slice) * w; sepZ += Math.sin(e.slice) * w; }
      }
    }
    let vx = dirX * (arrived ? 0 : 1) + sepX, vz = dirZ * (arrived ? 0 : 1) + sepZ;
    // Personal space: never press into the player (body collision does the rest).
    if (this.playerPresent) {
      const ppx = this.px - e.x, ppz = this.pz - e.z, pd = Math.hypot(ppx, ppz);
      if (pd < e.radius + PLAYER_BODY + 0.35 && pd > 1e-4) {
        const toward = (vx * ppx + vz * ppz) / pd;
        if (toward > 0) { vx -= ppx / pd * toward; vz -= ppz / pd * toward; }
      }
    }
    const vl = Math.hypot(vx, vz);
    if (vl > 1e-4) {
      const scale = speed * Math.min(1, vl) * (arrived ? 0.5 : Math.min(1, dist / 0.6 + 0.3)) / vl;
      const to = this.tryMove(e.x, e.z, vx * scale * dt, vz * scale * dt);
      e.x = to.x; e.z = to.z;
      if (face === "move" && !arrived && Math.hypot(dirX, dirZ) > 0.5) e.yaw = turnToward(e.yaw, yawTo(dirX, dirZ), 8 * dt);
    }
    if (face === "player" && this.playerPresent) e.yaw = turnToward(e.yaw, yawTo(this.px - e.x, this.pz - e.z), 7 * dt);
    // Stuck detection: little progress while trying to move -> swap avoidance side, force a route.
    if (!arrived && speed > 0.5) {
      if (this.time - e.progressAt > 1.2) {
        const moved = Math.hypot(e.x - e.progressX, e.z - e.progressZ);
        if (moved < speed * 0.25) { e.avoidSide = -e.avoidSide; e.route = this.streetRoute(e.x, e.z, tx, tz); e.routeCheck = this.time + 2.5; e.circleSide = -e.circleSide; }
        e.progressX = e.x; e.progressZ = e.z; e.progressAt = this.time;
      }
    } else { e.progressX = e.x; e.progressZ = e.z; e.progressAt = this.time; }
    return arrived;
  }

  // ---- Encounters -----------------------------------------------------------------------------

  groupAlive(id: string): boolean {
    const group = this.groups.get(id);
    return !!group && group.members.some(m => m.deathTime < 0);
  }

  spawnGroup(id: string): Group | null {
    const def = this.encounters.get(id);
    if (!def || this.groupAlive(id)) return null;
    this.despawnGroup(id);
    const group: Group = { id, def, members: [], alerted: false, lastKnownX: def.area.x, lastKnownZ: def.area.z, lastSeen: -Infinity };
    def.members.forEach((member, index) => {
      const arch = this.archetypes.get(member.archetype);
      if (!arch) return;
      const at = this.nearestWalkable(member.x, member.z), scale = arch.scale ?? 1, weapon = this.weaponOf(arch.weapon);
      const e: Enemy = {
        id: `${id}#${this.nextId++}`, arch, weapon, group, member: index, tag: member.tag,
        x: at.x, z: at.z, yaw: member.yaw ?? 0, vx: 0, vz: 0, radius: 0.45 * scale, height: 2.4 * scale,
        health: arch.health, maxHealth: arch.health, state: member.patrol?.length ? "patrol" : "idle",
        awareness: 0, alerted: false, reaction: 0, seesPlayer: false, investigate: null,
        homeX: at.x, homeZ: at.z, homeYaw: member.yaw ?? 0, patrol: member.patrol?.length ? member.patrol : null, patrolIndex: 0, pauseUntil: 0,
        attack: null, cooldown: 0, token: null, tokenSince: 0, waitingSince: this.time, stagger: 0, staggerChain: 0, lastStaggerAt: -Infinity, critUntil: -Infinity,
        hitTime: -Infinity, deathTime: -1, bark: null, barkUntil: 0, lastBark: -Infinity, returning: false, fleeUntil: -Infinity, fleeChecked: false,
        circleSide: index % 2 ? 1 : -1, circleFlipAt: this.time + 3 + this.rng() * 3, avoidSide: index % 2 ? -1 : 1,
        route: null, routeCheck: 0, routeGoalX: Infinity, routeGoalZ: Infinity, stuck: 0, progressX: at.x, progressZ: at.z, progressAt: this.time,
        ammo: weapon.magazine ?? 0, reloadUntil: -Infinity,
        boss: arch.boss ? { phase: 0, sigTimer: 3.5, cycle: 0, roarUntil: -Infinity, lastSummon: -Infinity } : null,
        slice: this.nextId % 12,
      };
      group.members.push(e); this.enemies.push(e);
    });
    if (!group.members.length) return null;
    this.groups.set(id, group);
    return group;
  }

  despawnGroup(id: string): void {
    const group = this.groups.get(id);
    if (!group) return;
    for (const m of group.members) if (m.token) m.token = null;
    this.enemies = this.enemies.filter(e => e.group !== group);
    this.projectiles = this.projectiles.filter(p => p.owner.group !== group);
    this.rings = this.rings.filter(r => r.owner.group !== group);
    this.groups.delete(id);
  }

  /** The whole group turns on the player (with staggered reaction delays so they don't move as one). */
  alertGroup(group: Group, spotter: Enemy | null): void {
    if (!this.playerPresent || !this.hostileOf(group.id)) return;
    const first = !group.alerted;
    group.alerted = true; group.lastKnownX = this.px; group.lastKnownZ = this.pz; group.lastSeen = this.time;
    let barked = false;
    for (const m of group.members) {
      if (m.deathTime >= 0 || m.alerted) continue;
      m.returning = false; m.alerted = true; m.awareness = 1; m.investigate = null;
      m.reaction = m.arch.reaction + (m === spotter ? 0 : 0.25 + this.rng() * 0.5);
      m.state = "alert";
      if (!barked && (m === spotter || !spotter)) { this.bark(m, "alert", 1); barked = true; }
    }
    if (first) {
      const boss = group.members.find(m => m.boss && m.deathTime < 0);
      if (boss?.arch.barks?.alert?.length) this.emit({ type: "message", text: `${boss.arch.name}: ${pick(boss.arch.barks.alert, this.rng)}`, tone: "danger" });
    }
  }

  /** Enemies lose interest: walk home, heal on the way, forget the player. */
  resetGroup(group: Group): void {
    group.alerted = false; group.lastSeen = -Infinity;
    for (const m of group.members) {
      if (m.deathTime >= 0) continue;
      m.alerted = false; m.awareness = 0; m.attack = null; m.token = null; m.stagger = 0; m.investigate = null;
      m.returning = true; m.state = "patrol"; m.route = null; m.routeCheck = 0; m.fleeUntil = -Infinity; m.fleeChecked = false;
      if (m.boss) { m.boss.sigTimer = 3.5; m.boss.roarUntil = -Infinity; }
    }
    this.projectiles = this.projectiles.filter(p => p.owner.group !== group);
    this.rings = this.rings.filter(r => r.owner.group !== group);
  }

  /** A sound at (x, z): enemies within `loudness` x their hearing radius react; hostile groups
   * turn on the player (a gunshot gives away where you are), others only look. */
  noise(x: number, z: number, loudness: number): void {
    for (const group of this.groups.values()) {
      if (group.alerted) continue;
      const hostile = this.hostileOf(group.id);
      for (const m of group.members) {
        if (m.deathTime >= 0 || m.returning) continue;
        const r = m.arch.perception.hearing * loudness;
        if ((m.x - x) ** 2 + (m.z - z) ** 2 > r * r) continue;
        if (hostile) { this.alertGroup(group, m); break; }
        m.investigate = { x, z }; m.awareness = Math.max(m.awareness, 0.5);
      }
    }
  }

  bark(e: Enemy, kind: "alert" | "hurt" | "death", chance: number): void {
    if (this.time - e.lastBark < 2.5 && kind !== "death") return;
    const line = pick(e.arch.barks?.[kind], this.rng);
    if (!line || this.rng() > chance) return;
    e.bark = line; e.barkUntil = this.time + (kind === "death" ? 2.5 : 1.8); e.lastBark = this.time;
  }

  // ---- Damage ---------------------------------------------------------------------------------

  /** Applies damage to an enemy: numbers, provocation, stagger with diminishing returns, knockback,
   * flee checks and death (killed / encounterCleared events). */
  damageEnemy(e: Enemy, amount: number, opts: { critical: boolean; byPlayer: boolean; stagger: number; knockback: number; dirX: number; dirZ: number; heavy?: boolean; parry?: boolean }): void {
    if (e.deathTime >= 0) return;
    if (e.boss && this.time < e.boss.roarUntil) {
      this.addFx({ kind: "spark", x: e.x, y: e.height * 0.6, z: e.z, age: 0, color: [150, 150, 170] }, 0.3);
      return;
    }
    amount = Math.max(0, amount);
    e.health -= amount; e.hitTime = this.time;
    this.emit({ type: "damaged", target: e.id, amount, source: opts.byPlayer ? "player" : "world", x: e.x, z: e.z, critical: opts.critical });
    this.addFx({ kind: "number", x: e.x, y: e.height + 0.3, z: e.z, value: Math.round(amount), critical: opts.critical, age: 0, toPlayer: false }, 1);
    if (opts.byPlayer) {
      this.lastCombatAt = this.time; this.player.hitConfirmAt = this.time;
      if (!this.hostileOf(e.group.id)) this.hostility.set(e.group.id, true);
      if (e.returning) { e.returning = false; }
      if (!e.group.alerted) this.alertGroup(e.group, e);
      else if (!e.alerted) { e.alerted = true; e.reaction = 0.2; }
      e.group.lastSeen = this.time; e.group.lastKnownX = this.px; e.group.lastKnownZ = this.pz;
    }
    if (e.health <= 0) { this.kill(e, opts.byPlayer); return; }
    // Stagger: bosses shrug off light hits; everyone gets diminishing returns so no stun-lock.
    let s = opts.stagger;
    if (e.boss) s = opts.parry ? s : opts.heavy ? s * 0.35 : 0;
    if (this.time - e.lastStaggerAt < 2) e.staggerChain++; else e.staggerChain = 0;
    s *= Math.pow(0.6, e.staggerChain);
    // Poise: past 40% of a melee wind-up (and through the active frames) light hits don't
    // interrupt - the enemy trades blows, so mashing into a telegraph gets punished.
    const a = e.attack;
    const committed = !!a && a.t >= a.windup * (a.kind === "melee" ? 0.4 : 1) && a.t < a.windup + a.active;
    if (committed && !opts.heavy && !opts.parry) s = 0;
    if (s >= 0.08) {
      e.stagger = Math.max(e.stagger, s); e.lastStaggerAt = this.time; e.state = "stagger";
      if (e.attack && e.attack.kind !== "charge") e.attack = null;
      if (e.token) e.token = null;
    }
    const knock = opts.knockback * (e.boss ? 0.15 : 1);
    if (knock > 0) { e.vx += opts.dirX * knock * 8; e.vz += opts.dirZ * knock * 8; }
    this.bark(e, "hurt", 0.3);
    if (!e.fleeChecked && !e.boss && e.health < e.maxHealth * 0.3) {
      e.fleeChecked = true;
      if (this.rng() > e.arch.aggression + 0.25) { e.fleeUntil = this.time + 4 + this.rng() * 3; e.attack = null; e.token = null; }
    }
  }

  kill(e: Enemy, byPlayer: boolean): void {
    e.health = 0; e.state = "dead"; e.deathTime = this.time; e.attack = null; e.token = null; e.stagger = 0;
    this.bark(e, "death", 1);
    const group = e.group;
    this.emit({ type: "killed", enemy: e.id, archetype: e.arch.id, faction: e.arch.faction, tags: [...(e.arch.tags ?? []), ...(e.tag ? [e.tag] : [])], encounter: group.id, x: e.x, z: e.z, byPlayer });
    if (e.boss) {
      this.projectiles = this.projectiles.filter(p => p.owner !== e);
      this.rings = this.rings.filter(r => r.owner !== e);
    }
    if (this.groups.get(group.id) === group && group.members.every(m => m.deathTime >= 0)) {
      this.cleared.add(group.id);
      if (group.def.respawn !== undefined) this.respawn.set(group.id, Math.max(0, group.def.respawn));
      this.emit({ type: "encounterCleared", encounter: group.id });
    }
  }

  // ---- Token system (fairness: only a couple of enemies attack at once) ------------------------

  allocateTokens(): void {
    if (!this.playerPresent) return;
    let melee = 0, ranged = 0;
    for (const e of this.enemies) {
      if (e.deathTime >= 0) continue;
      if (e.boss && e.alerted) melee++;
      else if (e.token === "melee") melee++;
      else if (e.token === "ranged") ranged++;
    }
    if (melee < MELEE_TOKENS && this.time - this.lastMeleeGrant >= TOKEN_SPACING) {
      let best: Enemy | null = null, bestScore = Infinity;
      for (const e of this.enemies) {
        if (e.token || e.boss || !this.eligible(e) || isRanged(e.weapon)) continue;
        const d = Math.hypot(this.px - e.x, this.pz - e.z);
        if (d > 16) continue;
        const score = d - (this.time - e.waitingSince) * 1.5;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (best) { best.token = "melee"; best.tokenSince = this.time; this.lastMeleeGrant = this.time; }
    }
    if (ranged < RANGED_TOKENS) {
      for (const e of this.enemies) {
        if (ranged >= RANGED_TOKENS) break;
        if (e.token || e.boss || !this.eligible(e) || !isRanged(e.weapon) || !e.seesPlayer || this.time < e.reloadUntil || e.ammo <= 0) continue;
        e.token = "ranged"; e.tokenSince = this.time; ranged++;
      }
    }
  }
  private eligible(e: Enemy): boolean {
    return e.deathTime < 0 && e.alerted && !e.returning && e.reaction <= 0 && e.stagger <= 0 && e.cooldown <= 0 && this.time >= e.fleeUntil && this.hostileOf(e.group.id);
  }
  releaseToken(e: Enemy): void { if (e.token) { e.token = null; e.waitingSince = this.time; } }

  /** Body collision: enemies push the player (and are pushed a little) out of their radius. */
  bodyCollisions(): void {
    if (!this.playerPresent) return;
    for (const e of this.enemies) {
      if (e.deathTime >= 0) continue;
      const dx = this.px - e.x, dz = this.pz - e.z, limit = e.radius + PLAYER_BODY;
      if (Math.abs(dx) > limit || Math.abs(dz) > limit) continue;
      const d = Math.hypot(dx, dz);
      if (d >= limit) continue;
      const nx = d > 1e-4 ? dx / d : -Math.sin(e.yaw), nz = d > 1e-4 ? dz / d : Math.cos(e.yaw);
      const overlap = limit - d, playerShare = e.boss ? 0.9 : 0.6;
      this.movePlayer(nx * overlap * playerShare, nz * overlap * playerShare);
      const to = this.tryMove(e.x, e.z, -nx * overlap * (1 - playerShare), -nz * overlap * (1 - playerShare));
      e.x = to.x; e.z = to.z;
    }
  }

  distanceToPlayer(e: Enemy): number { return Math.hypot(this.px - e.x, this.pz - e.z); }
  /** True when the player's head is above the ground (jumping clears shockwaves). */
  get airborne(): boolean { return this.eye > WALK_HEIGHT + 0.45; }
}

