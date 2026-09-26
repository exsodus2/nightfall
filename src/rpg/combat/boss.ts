// Bosses: health-fraction phases (message, reinforcements, speed / damage multipliers) and the
// telegraphed signature attacks listed in BossPhase.attacks. Every signature is dodgeable: a
// ground telegraph (CombatEffect "telegraph") runs to its impact, and the roll's i-frames, running
// out of the marked area, or jumping a shockwave all avoid it. Charges that miss stun the boss.

import { PLAYER_BODY } from "./constants.ts";
import type { Enemy, EnemyAttack, Sim } from "./sim.ts";
import type { CombatEffect } from "../types.ts";
import { TICK, angleDiff, turnToward, yawTo } from "./util.ts";

type Signature = "slam" | "sweep" | "barrage" | "charge" | "summon" | "shockwave";

export function newAttack(kind: EnemyAttack["kind"], windup: number, active: number, recovery: number, yaw: number, damage: number): EnemyAttack {
  return { kind, t: 0, windup, active, recovery, yaw, hit: false, shots: 0, shotTimer: 0, originX: 0, originZ: 0, travelled: 0, damage };
}

/** Boss phase speed multiplier (1 for regular enemies). */
export function bossSpeed(e: Enemy): number {
  return (e.boss ? e.arch.boss?.phases[e.boss.phase]?.speedMultiplier : undefined) ?? 1;
}
/** Boss phase damage multiplier (1 for regular enemies). */
export function bossDamage(e: Enemy): number {
  return (e.boss ? e.arch.boss?.phases[e.boss.phase]?.damageMultiplier : undefined) ?? 1;
}

export const slamRadius = (e: Enemy): number => 4.5 + 1.5 * (e.arch.scale ?? 1);
export const sweepRadius = (e: Enemy): number => e.weapon.range + 2;
const SWEEP_ARC = 1.4;
const CHARGE_LENGTH = 22;
const BARRAGE_ARC = 0.42;

/** Runs the boss layer for one tick. Returns true when it handled the enemy this tick (roar,
 * signature attack); false lets the regular melee AI drive it (chasing, basic swings). */
export function tickBoss(sim: Sim, e: Enemy): boolean {
  const b = e.boss, def = e.arch.boss;
  if (!b || !def) return false;
  const fraction = e.health / e.maxHealth;
  let target = b.phase;
  for (let i = b.phase + 1; i < def.phases.length; i++) if (fraction <= def.phases[i].atHealth) target = i;
  while (b.phase < target) enterPhase(sim, e, b.phase + 1);
  if (sim.time < b.roarUntil) {
    e.state = "alert";
    e.yaw = turnToward(e.yaw, yawTo(sim.px - e.x, sim.pz - e.z), 3 * TICK);
    return true;
  }
  if (e.attack && e.attack.kind !== "melee") { tickSignature(sim, e, e.attack); return true; }
  if (e.attack) return false;
  b.sigTimer -= TICK;
  return b.sigTimer <= 0 && startSignature(sim, e);
}

function enterPhase(sim: Sim, e: Enemy, index: number): void {
  const b = e.boss!, phase = e.arch.boss!.phases[index];
  b.phase = index; b.cycle = 0; b.roarUntil = sim.time + 1.2; b.sigTimer = 1.6;
  e.attack = null; e.stagger = 0;
  if (phase.message) sim.emit({ type: "message", text: phase.message, tone: "danger" });
  if (phase.spawn) summon(sim, e, phase.spawn);
}

function summon(sim: Sim, e: Enemy, encounter: string): void {
  const group = sim.spawnGroup(encounter);
  if (group) { sim.alertGroup(group, null); e.boss!.lastSummon = sim.time; }
}

function startSignature(sim: Sim, e: Enemy): boolean {
  const b = e.boss!, phase = e.arch.boss!.phases[b.phase], list = phase.attacks;
  const d = sim.distanceToPlayer(e), s = bossSpeed(e), dmg = e.weapon.damage * bossDamage(e);
  for (let k = 0; k < list.length; k++) {
    const kind = list[(b.cycle + k) % list.length] as Signature;
    if (!valid(sim, e, kind, d)) continue;
    b.cycle = (b.cycle + k + 1) % list.length;
    const yaw = yawTo(sim.px - e.x, sim.pz - e.z);
    let a: EnemyAttack;
    switch (kind) {
      case "slam": a = newAttack(kind, Math.max(0.8, 1 / s), 0, 1, yaw, dmg * 1.8); break;
      case "sweep": a = newAttack(kind, Math.max(0.6, 0.8 / s), 0, 0.7, yaw, dmg * 1.3); break;
      case "barrage": a = newAttack(kind, 0.7, 0, 0.8, yaw, dmg * 0.5); a.shots = 3; break;
      case "charge": a = newAttack(kind, Math.max(0.7, 0.9 / s), 0, 0.6, yaw, dmg * 1.6); break;
      case "summon": a = newAttack(kind, 1, 0, 0.5, yaw, 0); break;
      case "shockwave": a = newAttack(kind, Math.max(0.7, 0.9 / s), 0, 0.6, yaw, dmg * 1.2); a.shots = b.phase >= 2 ? 2 : 1; break;
    }
    e.attack = a; e.state = "attack";
    return true;
  }
  b.sigTimer = 0.5; // nothing fits right now; try again shortly
  return false;
}

function valid(sim: Sim, e: Enemy, kind: Signature, d: number): boolean {
  switch (kind) {
    case "slam": return d <= slamRadius(e) - 0.8;
    case "sweep": return d <= sweepRadius(e) + 1;
    case "barrage": return d >= 4 && e.seesPlayer;
    case "charge": return d >= 5 && d <= CHARGE_LENGTH && e.seesPlayer;
    case "summon": {
      const spawn = e.arch.boss!.phases[e.boss!.phase].spawn;
      return !!spawn && !sim.groupAlive(spawn) && sim.time - e.boss!.lastSummon > 20;
    }
    case "shockwave": return d <= 20;
  }
}

function finish(sim: Sim, e: Enemy): void {
  const b = e.boss!;
  e.attack = null; e.cooldown = 0.6; e.state = "chase";
  b.sigTimer = Math.max(2.5, 4.5 - b.phase * 0.6) + sim.rng() * 1.5;
}

/** A missed charge (or one that hit a wall): the boss is stunned and takes guaranteed crits. */
function stun(sim: Sim, e: Enemy, seconds: number): void {
  const b = e.boss!;
  e.attack = null; e.stagger = seconds; e.critUntil = sim.time + seconds; e.state = "stagger"; e.lastStaggerAt = sim.time;
  b.sigTimer = seconds + 2.5 + sim.rng();
}

function tickSignature(sim: Sim, e: Enemy, a: EnemyAttack): void {
  const prev = a.t;
  a.t += TICK;
  e.state = "attack";
  const impact = prev < a.windup && a.t >= a.windup - 1e-9;
  const dx = sim.px - e.x, dz = sim.pz - e.z, d = Math.hypot(dx, dz), toPlayer = yawTo(dx, dz);
  switch (a.kind) {
    case "slam": {
      if (a.t < a.windup) e.yaw = turnToward(e.yaw, toPlayer, 2 * TICK);
      if (impact) {
        const r = slamRadius(e);
        if (d <= r + PLAYER_BODY && sim.playerPresent) sim.player.receive(sim, { amount: a.damage, source: e, fromX: e.x, fromZ: e.z, blockable: false, parryable: false, stagger: 0.5, knockback: 3.5 });
        for (let i = 0; i < 10; i++) sim.addFx({ kind: "spark", x: e.x + Math.sin(i / 10 * Math.PI * 2) * r, y: 0.3, z: e.z - Math.cos(i / 10 * Math.PI * 2) * r, age: 0, color: [255, 150, 60] }, 0.4);
        sim.noise(e.x, e.z, 1);
      }
      if (a.t >= a.windup + a.recovery) finish(sim, e);
      break;
    }
    case "sweep": {
      if (a.t < a.windup * 0.6) { e.yaw = turnToward(e.yaw, toPlayer, 5 * TICK); a.yaw = e.yaw; }
      if (impact) {
        const tolerance = SWEEP_ARC + Math.asin(Math.min(1, PLAYER_BODY / Math.max(d, 1e-3)));
        if (d - PLAYER_BODY <= sweepRadius(e) && Math.abs(angleDiff(toPlayer, a.yaw)) <= tolerance && sim.playerPresent) {
          sim.player.receive(sim, { amount: a.damage, source: e, fromX: e.x, fromZ: e.z, blockable: true, parryable: false, stagger: 0.4, knockback: 2.5 });
        }
        sim.addFx({ kind: "slash", x: e.x + Math.sin(a.yaw) * 2, y: e.height * 0.5, z: e.z - Math.cos(a.yaw) * 2, yaw: a.yaw, age: 0, heavy: true }, 0.3);
      }
      if (a.t >= a.windup + a.recovery) finish(sim, e);
      break;
    }
    case "barrage": {
      e.yaw = turnToward(e.yaw, toPlayer, 3 * TICK); a.yaw = e.yaw;
      if (a.t >= a.windup) {
        a.shotTimer -= TICK;
        if (a.shots > 0 && a.shotTimer <= 0) {
          a.shots--; a.shotTimer = 0.5; a.travelled = a.t;
          const speed = Math.min(14, 10 * bossSpeed(e));
          for (let i = 0; i < 5; i++) {
            const yaw = toPlayer + (i - 2) / 2 * BARRAGE_ARC;
            sim.projectiles.push({ id: sim.newProjectileId(), x: e.x + Math.sin(yaw) * (e.radius + 0.4), y: 1.4, z: e.z - Math.cos(yaw) * (e.radius + 0.4), vx: Math.sin(yaw) * speed, vz: -Math.cos(yaw) * speed, radius: 0.35, age: 0, life: 3.5, damage: a.damage, owner: e });
          }
        }
        if (a.shots <= 0 && a.t >= a.travelled + a.recovery) finish(sim, e);
      }
      break;
    }
    case "charge": {
      if (a.t < a.windup) {
        if (a.t < a.windup * 0.75) { e.yaw = turnToward(e.yaw, toPlayer, 4 * TICK); a.yaw = e.yaw; }
        a.originX = e.x; a.originZ = e.z;
        break;
      }
      const step = 18 * bossSpeed(e) * TICK;
      const to = sim.tryMove(e.x, e.z, Math.sin(a.yaw) * step, -Math.cos(a.yaw) * step);
      const moved = Math.hypot(to.x - e.x, to.z - e.z);
      e.x = to.x; e.z = to.z; a.travelled += moved;
      if (!a.hit && sim.playerPresent && Math.hypot(sim.px - e.x, sim.pz - e.z) <= e.radius + PLAYER_BODY + 0.4) {
        const result = sim.player.receive(sim, { amount: a.damage, source: e, fromX: e.x - Math.sin(a.yaw) * 2, fromZ: e.z + Math.cos(a.yaw) * 2, blockable: false, parryable: false, stagger: 0.6, knockback: 5 });
        if (result !== "evaded") { a.hit = true; e.attack = null; e.cooldown = 0.9; e.boss!.sigTimer = 3.5 + sim.rng(); e.state = "chase"; break; }
      }
      if (moved < step * 0.5) { sim.addFx({ kind: "spark", x: e.x + Math.sin(a.yaw) * e.radius, y: 1.5, z: e.z - Math.cos(a.yaw) * e.radius, age: 0, color: [255, 200, 120] }, 0.4); stun(sim, e, 2.2); break; }
      if (a.travelled >= CHARGE_LENGTH) stun(sim, e, 1.6);
      break;
    }
    case "summon": {
      if (impact) { const spawn = e.arch.boss!.phases[e.boss!.phase].spawn; if (spawn) summon(sim, e, spawn); }
      if (a.t >= a.windup + a.recovery) finish(sim, e);
      break;
    }
    case "shockwave": {
      if (impact) {
        for (let i = 0; i < a.shots; i++) sim.rings.push({ x: e.x, z: e.z, radius: e.radius, speed: 9, max: 24, width: 1, damage: a.damage, hit: false, owner: e, delay: i * 0.7, age: 0 });
        sim.noise(e.x, e.z, 1);
      }
      if (a.t >= a.windup + a.recovery + (a.shots - 1) * 0.7) finish(sim, e);
      break;
    }
    default: finish(sim, e);
  }
}

/** Moves boss projectiles and shockwave rings and resolves their hits on the player. */
export function tickHazards(sim: Sim): void {
  const kept = [];
  for (const p of sim.projectiles) {
    p.age += TICK; p.x += p.vx * TICK; p.z += p.vz * TICK;
    if (p.age >= p.life || !sim.world.canOccupy(p.x, p.z)) { sim.addFx({ kind: "spark", x: p.x, y: p.y, z: p.z, age: 0, color: [255, 120, 60] }, 0.25); continue; }
    if (sim.playerPresent && Math.hypot(sim.px - p.x, sim.pz - p.z) <= p.radius + PLAYER_BODY) {
      const result = sim.player.receive(sim, { amount: p.damage, source: p.owner, fromX: p.x - p.vx, fromZ: p.z - p.vz, blockable: true, parryable: false, stagger: 0.2, knockback: 0.6 });
      if (result !== "evaded") { sim.addFx({ kind: "spark", x: p.x, y: p.y, z: p.z, age: 0, color: [255, 120, 60] }, 0.25); continue; }
    }
    kept.push(p);
  }
  sim.projectiles = kept;
  const rings = [];
  for (const r of sim.rings) {
    r.age += TICK;
    if (r.delay > 0) { r.delay -= TICK; rings.push(r); continue; }
    r.radius += r.speed * TICK;
    if (r.radius > r.max) continue;
    if (!r.hit && sim.playerPresent && !sim.airborne) {
      const d = Math.hypot(sim.px - r.x, sim.pz - r.z);
      if (Math.abs(d - r.radius) <= r.width / 2 + PLAYER_BODY) {
        const result = sim.player.receive(sim, { amount: r.damage, source: r.owner, fromX: r.x, fromZ: r.z, blockable: false, parryable: false, stagger: 0.3, knockback: 2 });
        if (result !== "evaded") r.hit = true;
      }
    }
    rings.push(r);
  }
  sim.rings = rings;
}

/** Ground telegraphs for boss wind-ups, live shockwave rings and projectiles, for rendering. */
export function hazardEffects(sim: Sim): CombatEffect[] {
  const out: CombatEffect[] = [];
  for (const e of sim.enemies) {
    const a = e.attack;
    if (!e.boss || e.deathTime >= 0 || !a || a.kind === "melee" || a.kind === "ranged") continue;
    const progress = Math.min(1, a.t / a.windup), base = { kind: "telegraph" as const, x: e.x, z: e.z, yaw: a.yaw, age: a.t, progress, enemy: e.id, width: 0, arc: 0 };
    if (a.t >= a.windup && a.kind !== "charge") continue;
    switch (a.kind) {
      case "slam": out.push({ ...base, shape: "circle", radius: slamRadius(e) }); break;
      case "sweep": out.push({ ...base, shape: "arc", radius: sweepRadius(e), arc: SWEEP_ARC }); break;
      case "barrage": out.push({ ...base, shape: "arc", radius: 14, arc: BARRAGE_ARC }); break;
      case "charge": out.push({ ...base, x: a.t < a.windup ? e.x : a.originX, z: a.t < a.windup ? e.z : a.originZ, shape: "line", radius: CHARGE_LENGTH, width: e.radius * 2 + 1 }); break;
      case "summon": case "shockwave": out.push({ ...base, shape: "circle", radius: 2.5 }); break;
    }
  }
  for (const r of sim.rings) if (r.delay <= 0) out.push({ kind: "telegraph", shape: "ring", x: r.x, z: r.z, yaw: 0, radius: r.radius, width: r.width, arc: 0, progress: r.radius / r.max, age: r.age, enemy: r.owner.id });
  for (const p of sim.projectiles) out.push({ kind: "projectile", id: p.id, x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz, radius: p.radius, age: p.age, enemy: true });
  return out;
}
