// Enemy AI, one fixed tick at a time: perception (sight cone + line of sight, proximity sense),
// the idle / patrol / suspicious / alert / chase / attack / reposition / flee / stagger / dead
// state machine, telegraphed melee swings and aimed gunfire, the attack-token dance (circling
// while waiting for a turn), fleeing at low health and walking home after a leash reset.

import { PLAYER_BODY, PLAYER_HEIGHT, isRanged } from "./constants.ts";
import { hasLineOfSight, raycastWorld } from "./raycast.ts";
import type { Enemy, EnemyAttack, Sim } from "./sim.ts";
import { bossDamage, bossSpeed, newAttack, tickBoss } from "./boss.ts";
import { TICK, angleDiff, clamp, jitter, rayCylinder, turnToward, yawTo } from "./util.ts";

/** Perception runs every PERCEPTION_TICKS ticks per enemy (staggered by enemy). */
const PERCEPTION_TICKS = 4;
/** Seconds without anyone in the group seeing the player before they give up the hunt. */
const GIVE_UP = 12;

export function tickEnemy(sim: Sim, e: Enemy): void {
  if (e.deathTime >= 0) return;
  const dt = TICK;
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (e.bark && sim.time >= e.barkUntil) e.bark = null;
  if (Math.abs(e.vx) + Math.abs(e.vz) > 0.02) {
    const to = sim.tryMove(e.x, e.z, e.vx * dt, e.vz * dt);
    e.x = to.x; e.z = to.z;
    const decay = Math.exp(-8 * dt); e.vx *= decay; e.vz *= decay;
  } else e.vx = e.vz = 0;
  if (e.returning) { returnHome(sim, e); return; }
  if (e.stagger > 0) {
    e.stagger -= dt; e.state = "stagger";
    if (e.stagger <= 0) { e.stagger = 0; e.state = e.alerted ? "chase" : "idle"; }
    return;
  }
  if ((sim.tick + e.slice) % PERCEPTION_TICKS === 0) perceive(sim, e);
  if (!e.alerted || !sim.playerPresent) { unaware(sim, e); return; }
  if (e.reaction > 0) {
    e.reaction -= dt; e.state = "alert";
    e.yaw = turnToward(e.yaw, yawTo(sim.px - e.x, sim.pz - e.z), 6 * dt);
    return;
  }
  if (e.boss && tickBoss(sim, e)) return;
  if (e.attack) { tickAttack(sim, e); return; }
  if (sim.time < e.fleeUntil) { flee(sim, e); return; }
  if (isRanged(e.weapon)) rangedBehaviour(sim, e); else meleeBehaviour(sim, e);
}

// ---- Perception -------------------------------------------------------------------------------

function perceive(sim: Sim, e: Enemy): void {
  e.seesPlayer = false;
  if (!sim.playerPresent) return;
  const p = e.arch.perception, dx = sim.px - e.x, dz = sim.pz - e.z, d = Math.hypot(dx, dz);
  const span = TICK * PERCEPTION_TICKS;
  if (d <= p.sight) {
    const inCone = Math.abs(angleDiff(yawTo(dx, dz), e.yaw)) <= p.fovDegrees * Math.PI / 360 || d < 3.5 || e.alerted;
    const eye = { x: e.x, y: e.height * 0.8, z: e.z };
    if (inCone && hasLineOfSight(sim.world, eye, { x: sim.px, y: Math.min(sim.eye, 2.2), z: sim.pz })) e.seesPlayer = true;
  }
  const group = e.group;
  if (e.seesPlayer) {
    if (group.alerted) { group.lastSeen = sim.time; group.lastKnownX = sim.px; group.lastKnownZ = sim.pz; }
    if (!e.alerted) {
      const rate = d < 6 ? 4 : 0.8 + 3 * (1 - d / p.sight);
      const hostile = sim.hostileOf(group.id);
      e.awareness = Math.min(hostile ? 1 : 0.6, e.awareness + rate * span);
      e.investigate = { x: sim.px, z: sim.pz };
      if (hostile && e.awareness >= 1) sim.alertGroup(group, e);
    }
  } else if (!e.alerted) {
    e.awareness = Math.max(0, e.awareness - 0.15 * span);
    if (e.awareness <= 0.05 && e.investigate && Math.hypot(e.investigate.x - e.x, e.investigate.z - e.z) < 2) e.investigate = null;
  }
  // The whole group lost the player for too long: search over, go home.
  if (group.alerted && sim.time - group.lastSeen > GIVE_UP && e === group.members.find(m => m.deathTime < 0)) sim.resetGroup(group);
}

// ---- Unaware behaviour --------------------------------------------------------------------------

function unaware(sim: Sim, e: Enemy): void {
  if (e.awareness > 0.35 || e.investigate) {
    e.state = "suspicious";
    const spot = e.investigate;
    if (spot) {
      const far = Math.hypot(spot.x - e.x, spot.z - e.z) > 4;
      // A distant noise is worth a look; something glimpsed nearby is just watched.
      if (far && e.awareness < 0.6) sim.steer(e, spot.x, spot.z, e.arch.speed.walk, "move", 3.5);
      else e.yaw = turnToward(e.yaw, yawTo(spot.x - e.x, spot.z - e.z), 4 * TICK);
      if (!far && e.awareness <= 0.1) e.investigate = null;
    }
    return;
  }
  if (e.patrol && e.patrol.length) {
    e.state = "patrol";
    if (sim.time < e.pauseUntil) return;
    const point = e.patrol[e.patrolIndex % e.patrol.length];
    if (sim.steer(e, point.x, point.z, e.arch.speed.walk, "move", 0.6)) { e.patrolIndex = (e.patrolIndex + 1) % e.patrol.length; e.pauseUntil = sim.time + 1.5 + sim.rng() * 2; }
    return;
  }
  if (Math.hypot(e.homeX - e.x, e.homeZ - e.z) > 1.5) { e.state = "patrol"; sim.steer(e, e.homeX, e.homeZ, e.arch.speed.walk, "move", 1); return; }
  e.state = "idle";
  e.yaw = turnToward(e.yaw, e.homeYaw, 2 * TICK);
}

function returnHome(sim: Sim, e: Enemy): void {
  e.state = "patrol";
  e.health = Math.min(e.maxHealth, e.health + e.maxHealth * 0.2 * TICK);
  if (sim.steer(e, e.homeX, e.homeZ, e.arch.speed.run, "move", 1.2)) {
    e.returning = false; e.health = e.maxHealth; e.state = e.patrol ? "patrol" : "idle"; e.yaw = e.homeYaw;
    e.fleeChecked = false; e.staggerChain = 0; e.ammo = e.weapon.magazine ?? 0;
    if (e.boss) { e.boss.phase = 0; e.boss.cycle = 0; }
  }
}

// ---- Engaged behaviour ------------------------------------------------------------------------

/** Where the enemy believes the player is: live while seen recently, else the last sighting. */
function targetPoint(sim: Sim, e: Enemy): { x: number; z: number; live: boolean } {
  const live = sim.time - e.group.lastSeen < 1;
  return live ? { x: sim.px, z: sim.pz, live } : { x: e.group.lastKnownX, z: e.group.lastKnownZ, live };
}

function searchLastKnown(sim: Sim, e: Enemy, x: number, z: number): void {
  e.state = "chase";
  if (sim.steer(e, x, z, e.arch.speed.run, "move", 2)) e.yaw += TICK * 1.2; // look around
}

function meleeBehaviour(sim: Sim, e: Enemy): void {
  const target = targetPoint(sim, e);
  if (!target.live) { if (e.token) sim.releaseToken(e); searchLastKnown(sim, e, target.x, target.z); return; }
  const d = sim.distanceToPlayer(e), reach = e.weapon.range, speed = bossSpeed(e);
  const hasTurn = e.token === "melee" || !!e.boss;
  if (hasTurn) {
    // A turn that isn't used is handed back so a stuck enemy can't hog it.
    if (!e.boss && sim.time - e.tokenSince > 5) { sim.releaseToken(e); e.cooldown = 1; return; }
    const facing = Math.abs(angleDiff(yawTo(sim.px - e.x, sim.pz - e.z), e.yaw)) < 0.6;
    if (d <= reach + PLAYER_BODY * 0.5 && e.cooldown <= 0 && facing) { startMelee(sim, e); return; }
    e.state = "chase";
    sim.steer(e, sim.px, sim.pz, e.arch.speed.run * speed, d < reach + 2 ? "player" : "move", reach * 0.75);
    return;
  }
  // Waiting for a turn: circle at a respectful distance, facing the player.
  const ring = 4.2 + (e.member % 3) * 0.8;
  if (sim.time >= e.circleFlipAt) { e.circleSide = -e.circleSide; e.circleFlipAt = sim.time + 3 + sim.rng() * 3; }
  if (d > ring + 3) { e.state = "chase"; sim.steer(e, sim.px, sim.pz, e.arch.speed.run * speed, "move", ring); return; }
  const around = yawTo(e.x - sim.px, e.z - sim.pz) + e.circleSide * 0.55;
  const gx = sim.px + Math.sin(around) * ring, gz = sim.pz - Math.cos(around) * ring;
  e.state = "reposition";
  sim.steer(e, gx, gz, e.arch.speed.walk * 1.3 * speed, "player", 0.3);
}

function rangedBehaviour(sim: Sim, e: Enemy): void {
  const w = e.weapon, target = targetPoint(sim, e);
  // reloadUntil is -Infinity while not reloading.
  if (e.ammo <= 0 && e.reloadUntil === -Infinity) { e.reloadUntil = sim.time + (w.reload ?? 2); if (e.token) sim.releaseToken(e); }
  if (e.reloadUntil !== -Infinity && sim.time >= e.reloadUntil) { e.ammo = w.magazine ?? 8; e.reloadUntil = -Infinity; }
  if (!target.live) { if (e.token) sim.releaseToken(e); searchLastKnown(sim, e, target.x, target.z); return; }
  const d = sim.distanceToPlayer(e);
  const preferred = clamp(w.range * 0.55, 7, 18) * (1.2 - e.arch.aggression * 0.4);
  const reloading = e.reloadUntil !== -Infinity;
  if (e.token === "ranged" && !reloading && e.seesPlayer && d <= w.range * 1.1 && e.cooldown <= 0 && e.ammo > 0) { startRanged(sim, e); return; }
  if (e.token === "ranged" && sim.time - e.tokenSince > 4) sim.releaseToken(e);
  if (!e.seesPlayer || d > w.range * 0.95) { e.state = "chase"; sim.steer(e, sim.px, sim.pz, e.arch.speed.run, "move", Math.min(preferred, 5)); return; }
  e.state = "reposition";
  if (d < preferred * 0.55) {
    // Too close: back off, facing the player.
    const ax = e.x - sim.px, az = e.z - sim.pz, al = Math.hypot(ax, az) || 1;
    sim.steer(e, e.x + ax / al * 3, e.z + az / al * 3, e.arch.speed.walk * 1.5, "player", 0.1);
  } else {
    // Strafe sideways in short hops to stay a moving target.
    if (sim.time >= e.circleFlipAt) { e.circleSide = -e.circleSide; e.circleFlipAt = sim.time + 1.5 + sim.rng() * 2.5; }
    const side = yawTo(sim.px - e.x, sim.pz - e.z) + e.circleSide * Math.PI / 2;
    sim.steer(e, e.x + Math.sin(side) * 2, e.z - Math.cos(side) * 2, e.arch.speed.walk, "player", 0.1);
  }
}

function flee(sim: Sim, e: Enemy): void {
  if (e.token) sim.releaseToken(e);
  e.state = "flee";
  const ax = e.x - sim.px, az = e.z - sim.pz, al = Math.hypot(ax, az) || 1;
  sim.steer(e, e.x + ax / al * 6, e.z + az / al * 6, e.arch.speed.run, "move", 0.1);
  if (sim.time >= e.fleeUntil - TICK) e.cooldown = 0.5;
}

// ---- Attacks ----------------------------------------------------------------------------------

function startMelee(sim: Sim, e: Enemy): void {
  const w = e.weapon, speed = bossSpeed(e);
  // The wind-up is the telegraph: never shorter than 0.45 s so it reads at a few cells tall.
  const windup = (e.boss ? clamp(w.cooldown * 0.5, 0.6, 0.9) : clamp(w.cooldown * 0.45, 0.45, 0.8)) / Math.sqrt(speed);
  e.attack = newAttack("melee", windup, 0.12, 0.5, e.yaw, w.damage * bossDamage(e));
  e.state = "attack";
}

function startRanged(sim: Sim, e: Enemy): void {
  const w = e.weapon, automatic = (w.automatic ?? 0) > 0;
  const attack = newAttack("ranged", 0.55, 0, 0.35, e.yaw, w.damage * bossDamage(e));
  attack.shots = Math.min(e.ammo, automatic ? 4 : w.class === "shotgun" ? 1 : 2);
  attack.shotTimer = 0;
  e.attack = attack; e.state = "attack";
}

function finishAttack(sim: Sim, e: Enemy): void {
  const w = e.weapon;
  e.attack = null;
  sim.releaseToken(e);
  e.cooldown = (isRanged(w) ? 1.1 + sim.rng() * 1.2 : w.cooldown * 0.3 + 0.3 + sim.rng() * 0.8) * (1.4 - e.arch.aggression * 0.6);
  // Bosses swing big and slow: their signatures set the pace, basic swings fill the gaps.
  if (e.boss) e.cooldown *= 1.2;
  e.state = "chase";
}

function tickAttack(sim: Sim, e: Enemy): void {
  const a = e.attack;
  if (!a) return;
  a.t += TICK;
  e.state = "attack";
  if (a.kind === "melee") tickMeleeAttack(sim, e, a);
  else if (a.kind === "ranged") tickRangedAttack(sim, e, a);
}

function tickMeleeAttack(sim: Sim, e: Enemy, a: EnemyAttack): void {
  const w = e.weapon, dx = sim.px - e.x, dz = sim.pz - e.z, d = Math.hypot(dx, dz);
  // Tracks the player through most of the wind-up, then commits: a late sidestep or roll dodges.
  if (a.t < a.windup * 0.65) { e.yaw = turnToward(e.yaw, yawTo(dx, dz), 6 * TICK); a.yaw = e.yaw; }
  const activeStart = a.windup, activeEnd = a.windup + a.active;
  if (a.t > activeStart && a.t <= activeEnd + 1e-9) {
    if (d > w.range * 0.6) { const to = sim.tryMove(e.x, e.z, Math.sin(a.yaw) * 3 * TICK, -Math.cos(a.yaw) * 3 * TICK); e.x = to.x; e.z = to.z; }
    if (!a.hit) {
      const arc = (w.arc ?? 45) * Math.PI / 180 + Math.asin(Math.min(1, PLAYER_BODY / Math.max(d, 1e-3)));
      if (d - PLAYER_BODY <= w.range + 0.2 && Math.abs(angleDiff(yawTo(dx, dz), a.yaw)) <= arc && sim.playerPresent) {
        a.hit = true;
        const result = sim.player.receive(sim, { amount: a.damage, source: e, fromX: e.x, fromZ: e.z, blockable: true, parryable: true, stagger: w.stagger, knockback: w.knockback });
        if (result === "parried") {
          const stun = e.boss ? 0.9 : 1.2;
          e.attack = null; sim.releaseToken(e);
          e.stagger = stun; e.critUntil = sim.time + stun + 0.3; e.state = "stagger"; e.lastStaggerAt = sim.time;
          e.cooldown = 1.5;
          return;
        }
      }
    }
  }
  if (a.t >= a.windup + a.active + a.recovery) finishAttack(sim, e);
}

function tickRangedAttack(sim: Sim, e: Enemy, a: EnemyAttack): void {
  const w = e.weapon, dx = sim.px - e.x, dz = sim.pz - e.z;
  e.yaw = turnToward(e.yaw, yawTo(dx, dz), 5 * TICK);
  if (a.t < a.windup) return;
  if (a.shots > 0) {
    a.shotTimer -= TICK;
    if (a.shotTimer <= 0) {
      a.shots--; e.ammo--;
      a.shotTimer = (w.automatic ?? 0) > 0 ? 1 / (w.automatic ?? 1) : Math.max(w.cooldown, 0.25);
      enemyShot(sim, e, a.damage);
      if (a.shots <= 0) a.t = a.windup; // recovery counts from the last shot
    }
    return;
  }
  if (a.t >= a.windup + a.recovery) finishAttack(sim, e);
}

/** One hitscan shot at the player: base inaccuracy grows with range and with the player's
 * lateral speed, so strafing and cover both matter; dodge i-frames make it whiff. */
function enemyShot(sim: Sim, e: Enemy, damage: number): void {
  const w = e.weapon;
  const origin = { x: e.x + Math.sin(e.yaw) * 0.5, y: e.height * 0.65, z: e.z - Math.cos(e.yaw) * 0.5 };
  const target = { x: sim.px, y: Math.min(sim.eye - 1.1, 1.6), z: sim.pz };
  const tx = target.x - origin.x, ty = target.y - origin.y, tz = target.z - origin.z, tl = Math.hypot(tx, ty, tz) || 1;
  const dir = { x: tx / tl, y: ty / tl, z: tz / tl };
  const lateral = Math.abs(sim.pvx * dir.z - sim.pvz * dir.x);
  const spread = (w.spread ?? 0.04) * 1.4 + 0.02 + lateral * 0.006;
  sim.addFx({ kind: "muzzle", ...origin, age: 0, enemy: true }, 0.08);
  for (let p = 0; p < Math.max(1, w.pellets ?? 1); p++) {
    const d = jitter(dir, spread, sim.rng), maxDistance = Math.min(120, w.range * 2.5);
    const wall = raycastWorld(sim.world, origin, d, maxDistance);
    const limit = wall ? wall.distance : maxDistance;
    const t = sim.playerPresent ? rayCylinder(origin, d, sim.px, sim.pz, PLAYER_BODY, PLAYER_HEIGHT, limit) : null;
    const end = t ?? limit;
    sim.addFx({ kind: "tracer", from: origin, to: { x: origin.x + d.x * end, y: origin.y + d.y * end, z: origin.z + d.z * end }, age: 0, enemy: true }, 0.12);
    if (t !== null) {
      const falloff = t <= w.range ? 1 : Math.max(0.3, 1 - (t - w.range) / (w.range * 1.5));
      sim.player.receive(sim, { amount: damage * falloff, source: e, fromX: e.x, fromZ: e.z, blockable: false, parryable: false, stagger: w.stagger, knockback: w.knockback * 0.5 });
    }
  }
}
