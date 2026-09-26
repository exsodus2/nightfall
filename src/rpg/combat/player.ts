// The player's side of combat: stamina economy, melee (light / charged heavy / 3-hit combo),
// block and parry, dodge roll with i-frames, guns (aim, semi / automatic fire, spread, reload),
// quick items, soft lock-on with melee magnetism and ranged aim assist, and taking damage.
// Runs inside Sim's fixed tick; displacement goes through Sim.movePlayer.

import type { ConsumableStats, ItemDefinition, PlayerCombatView, WeaponSlot, WeaponStats } from "../types.ts";
import { FISTS, clampArmor, isRanged } from "./constants.ts";
import { hasLineOfSight, raycastWorld } from "./raycast.ts";
import type { Enemy, Sim, TickInput } from "./sim.ts";
import { TICK, angleDiff, clamp, jitter, rayCylinder, rotateToward, viewDirection, yawTo, type Vec3 } from "./util.ts";

/** Hold the attack button at least this long for a charged heavy attack. */
export const HEAVY_HOLD = 0.35;
/** A block raised at most this long before a hit parries it. */
export const PARRY_WINDOW = 0.18;
export const BLOCK_REDUCTION = 0.7;
export const DODGE_TIME = 0.35;
export const DODGE_IFRAMES = 0.25;
export const DODGE_DISTANCE = 4.2;
export const DODGE_COST = 20;
/** Stamina regenerates after this long without spending any. */
export const STAMINA_DELAY = 1;
const STAMINA_REGEN = 32;
const COMBO_WINDOW = 0.45;
const COMBO_DAMAGE = [1, 1.15, 1.5];
/** Lock-on cone half-angle. */
const LOCK_CONE = 25 * Math.PI / 180;
const LOCK_KEEP = 35 * Math.PI / 180;

type ActionKind = "idle" | "charge" | "light" | "heavy" | "dodge" | "reload" | "hurt" | "switch";
interface Swing { heavy: boolean; combo: number; yaw: number; windup: number; active: number; damage: number; stagger: number; knockback: number; hits: Set<Enemy>; buffered: boolean; magnetX: number; magnetZ: number }
/** What incoming damage looks like to the player's defences. */
export interface IncomingHit { amount: number; source: Enemy | null; fromX: number; fromZ: number; blockable: boolean; parryable: boolean; stagger: number; knockback: number }
export type HitResult = "hit" | "blocked" | "parried" | "evaded" | "dead";

export class PlayerCombat {
  /** -1 until the first tick fills them from the character sheet. */
  health = -1; stamina = -1;
  maxHealth = 100; maxStamina = 100;
  /** False until the maxima were read from the character (a loaded save must not be topped up). */
  synced = false;
  dead = false;
  slot: WeaponSlot = "melee";
  action: ActionKind = "idle";
  actionT = 0; actionDuration = 0;
  swing: Swing | null = null;
  comboNext = 0; comboUntil = -Infinity; lastCombo = 0;
  blocking = false; blockStart = -Infinity; guardBroken = false;
  dodgeX = 0; dodgeZ = 0;
  fireCooldown = 0; bloom = 0; aim = 0; lastShot = -Infinity;
  lastSpend = -Infinity; lastHurt = -Infinity; hitConfirmAt = -Infinity; hurtFrom: number | null = null; poiseUntil = -Infinity;
  shield = 0; shieldUntil = -Infinity;
  hotRate = 0; hotUntil = -Infinity; focusUntil = -Infinity; hasteUntil = -Infinity;
  knockX = 0; knockZ = 0;
  lock: Enemy | null = null;
  private prevHeld = false;
  private lastAmmoMessage = -Infinity;

  // ---- Weapon ---------------------------------------------------------------------------------

  item(sim: Sim): ItemDefinition | null {
    if (this.slot === "unarmed" || !sim.character) return null;
    const item = sim.character.weaponFor(this.slot);
    return item?.weapon ? item : null;
  }
  stats(sim: Sim): WeaponStats { return this.item(sim)?.weapon ?? FISTS; }
  private melee(sim: Sim): boolean { return !isRanged(this.stats(sim)); }
  private hasted(sim: Sim): boolean { return sim.time < this.hasteUntil; }
  get invulnerable(): boolean { return this.action === "dodge" && this.actionT < DODGE_IFRAMES; }

  private spend(sim: Sim, amount: number): void {
    if (amount <= 0) return;
    this.stamina = Math.max(0, this.stamina - amount); this.lastSpend = sim.time;
  }
  private start(kind: ActionKind, duration: number): void { this.action = kind; this.actionT = 0; this.actionDuration = duration; }
  private cancelToIdle(): void { this.action = "idle"; this.actionT = 0; this.actionDuration = 0; this.swing = null; }

  // ---- Tick -----------------------------------------------------------------------------------

  tick(sim: Sim, input: TickInput): void {
    const ch = sim.character;
    if (ch) {
      const maxHealth = Math.max(1, ch.maxHealth), maxStamina = Math.max(1, ch.maxStamina);
      // A level-up grows the bar and fills the difference.
      if (this.synced && maxHealth > this.maxHealth && !this.dead) this.health += maxHealth - this.maxHealth;
      this.maxHealth = maxHealth; this.maxStamina = maxStamina; this.synced = true;
    }
    if (this.health < 0) this.health = this.maxHealth;
    if (this.stamina < 0) this.stamina = this.maxStamina;
    this.health = Math.min(this.health, this.maxHealth); this.stamina = Math.min(this.stamina, this.maxStamina);
    const held = input.attackHeld;
    const pressed = input.attackPressed || (held && !this.prevHeld);
    const released = input.attackReleased || (!held && this.prevHeld);
    this.prevHeld = held;
    if (this.dead || !sim.onFoot) {
      if (!this.dead) { this.cancelToIdle(); this.blocking = false; }
      this.knockX = this.knockZ = 0; this.lock = null;
      return;
    }
    const now = sim.time;
    this.regenerate(sim);
    // Knockback slides out over ~0.25 s (queued displacement, the engine collides it).
    if (Math.abs(this.knockX) + Math.abs(this.knockZ) > 0.01) {
      sim.movePlayer(this.knockX * TICK, this.knockZ * TICK);
      const decay = Math.exp(-10 * TICK); this.knockX *= decay; this.knockZ *= decay;
    } else this.knockX = this.knockZ = 0;
    this.fireCooldown = Math.max(0, this.fireCooldown - TICK);
    this.bloom = Math.max(0, this.bloom - 2.5 * TICK);
    if (sim.tick % 3 === 0) this.updateLock(sim);

    if (input.select && input.select !== this.slot && this.action !== "dodge") {
      this.slot = input.select; this.swing = null; this.blocking = false; this.lock = null;
      this.start("switch", 0.3);
    }
    if (input.quick && this.action !== "dodge" && ch) this.applyConsumable(sim, ch.useQuick(input.quick));
    if (input.dodge) this.tryDodge(sim, input);

    this.actionT += TICK;
    const melee = this.melee(sim);
    switch (this.action) {
      case "dodge": {
        // Velocity falls linearly to zero: fast out, soft landing. Integrate exactly per tick.
        const peak = 2 * DODGE_DISTANCE / DODGE_TIME;
        const a = Math.min(this.actionT - TICK, DODGE_TIME), b = Math.min(this.actionT, DODGE_TIME);
        const dist = peak * ((b - a) - (b * b - a * a) / (2 * DODGE_TIME));
        if (dist > 0) sim.movePlayer(this.dodgeX * dist, this.dodgeZ * dist);
        if (this.actionT >= DODGE_TIME) this.cancelToIdle();
        break;
      }
      case "hurt": case "switch":
        if (this.actionT >= this.actionDuration) this.cancelToIdle();
        break;
      case "reload":
        if (this.actionT >= this.actionDuration) {
          const item = this.item(sim);
          if (item && ch) ch.reload(item.id);
          this.cancelToIdle();
        }
        break;
      case "light": case "heavy":
        this.tickSwing(sim, pressed);
        break;
      case "charge":
        if (released || !held || this.actionT >= 2) this.releaseCharge(sim);
        break;
      case "idle":
        break;
    }
    if (this.action === "idle") {
      if (melee) {
        const wantBlock = input.altHeld && !this.guardBroken;
        if (!input.altHeld) this.guardBroken = false;
        if (pressed && this.stamina > 0) {
          this.blocking = false;
          this.comboNext = now < this.comboUntil ? Math.min(2, this.lastCombo + 1) : 0;
          if (this.lastCombo >= 2 && now < this.comboUntil) this.comboNext = 0;
          this.start("charge", 2);
          if (!held) this.releaseCharge(sim); // a tap shorter than one frame
        } else if (wantBlock) {
          if (!this.blocking) { this.blocking = true; this.blockStart = now; }
        } else this.blocking = false;
      } else {
        this.blocking = false;
        this.tickGun(sim, input, pressed);
      }
    } else if (this.action !== "charge") this.blocking = false;
    if (melee || this.action !== "idle") this.aim = Math.max(0, this.aim - TICK / 0.15);
    if (this.action === "charge") this.blocking = false;
  }

  private regenerate(sim: Sim): void {
    const now = sim.time;
    if (now - this.lastSpend >= STAMINA_DELAY && this.stamina < this.maxStamina) {
      const rate = STAMINA_REGEN * (this.blocking ? 0.4 : 1) * (this.hasted(sim) ? 1.5 : 1);
      this.stamina = Math.min(this.maxStamina, this.stamina + rate * TICK);
    }
    if (now < this.hotUntil) this.health = Math.min(this.maxHealth, this.health + this.hotRate * TICK);
    if (now >= this.shieldUntil) this.shield = 0;
    // Out-of-combat recovery: a slow top-up once nothing has happened for a while.
    if (now - this.lastHurt > 8 && now - sim.lastCombatAt > 6 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 4 * TICK);
  }

  private applyConsumable(sim: Sim, stats: ConsumableStats | null): void {
    if (!stats) return;
    const now = sim.time, duration = stats.duration ?? 0;
    if (stats.stamina) this.stamina = Math.min(this.maxStamina, this.stamina + stats.stamina);
    if (stats.effect === "shield") {
      this.shield = Math.max(this.shield, stats.heal ?? 40); this.shieldUntil = now + (duration || 12);
    } else if (stats.heal || stats.effect === "regen") {
      // Heal over time: short for plain medkits, the item's duration for regen.
      const span = Math.max(0.5, duration || 2), total = stats.heal ?? 3 * span;
      this.hotRate = total / span; this.hotUntil = now + span;
    }
    if (stats.effect === "focus") this.focusUntil = now + (duration || 15);
    if (stats.effect === "haste") this.hasteUntil = now + (duration || 15);
  }

  private tryDodge(sim: Sim, input: TickInput): void {
    const cancellable = this.action === "idle" || this.action === "charge" || this.action === "reload" || this.action === "switch"
      || ((this.action === "light" || this.action === "heavy") && this.swing !== null && this.actionT >= this.swing.windup + this.swing.active);
    if (!cancellable || this.stamina < 1) return;
    let f = input.forward, s = input.strafe;
    if (Math.hypot(f, s) < 0.1) { f = -1; s = 0; } // no direction: hop back
    const len = Math.hypot(f, s);
    f /= len; s /= len;
    this.dodgeX = Math.sin(sim.yaw) * f + Math.cos(sim.yaw) * s;
    this.dodgeZ = -Math.cos(sim.yaw) * f + Math.sin(sim.yaw) * s;
    this.spend(sim, DODGE_COST);
    this.swing = null; this.blocking = false;
    this.start("dodge", DODGE_TIME);
  }

  // ---- Melee ----------------------------------------------------------------------------------

  private releaseCharge(sim: Sim): void {
    const heavy = this.actionT >= HEAVY_HOLD;
    this.startSwing(sim, heavy, heavy ? 0 : this.comboNext, this.actionT);
  }

  private startSwing(sim: Sim, heavy: boolean, combo: number, charge: number): void {
    const w = this.stats(sim), ch = sim.character;
    const speed = this.hasted(sim) ? 1.2 : 1;
    const duration = (heavy ? w.cooldown * 1.6 : w.cooldown) / speed;
    const windup = duration * (heavy ? 0.22 : 0.3), active = Math.max(3 * TICK, duration * 0.22);
    this.spend(sim, w.staminaCost * (heavy ? 2 : combo === 2 ? 1.2 : 1));
    const mult = heavy ? (w.heavyMultiplier ?? 2) * (1 + 0.25 * clamp((charge - HEAVY_HOLD) / 0.65, 0, 1)) : COMBO_DAMAGE[combo];
    let yaw = sim.yaw, magnetX = 0, magnetZ = 0;
    // Soft lock: the swing turns to the locked target and slides the player into range.
    const target = this.lock;
    if (target && target.deathTime < 0) {
      const dx = target.x - sim.px, dz = target.z - sim.pz, d = Math.hypot(dx, dz);
      if (d < w.range + 4 && Math.abs(angleDiff(yawTo(dx, dz), sim.yaw)) < LOCK_KEEP + 0.2) {
        yaw = yawTo(dx, dz);
        const ideal = w.range * 0.7 + target.radius, slide = clamp(d - ideal, 0, 1.2);
        const ticks = Math.max(1, Math.round(windup / TICK));
        if (d > 1e-3) { magnetX = dx / d * slide / ticks; magnetZ = dz / d * slide / ticks; }
      }
    }
    this.swing = {
      heavy, combo, yaw, windup, active, hits: new Set(), buffered: false, magnetX, magnetZ,
      damage: w.damage * mult * (ch?.damageBonus ?? 1),
      stagger: w.stagger * (heavy ? 2.2 : combo === 2 ? 1.6 : 1),
      knockback: w.knockback * (heavy ? 2 : combo === 2 ? 1.8 : 1),
    };
    this.lastCombo = combo;
    this.start(heavy ? "heavy" : "light", duration);
  }

  private tickSwing(sim: Sim, pressed: boolean): void {
    const swing = this.swing;
    if (!swing) { this.cancelToIdle(); return; }
    const t = this.actionT;
    if (t <= swing.windup && (swing.magnetX || swing.magnetZ)) sim.movePlayer(swing.magnetX, swing.magnetZ);
    if (t > swing.windup && t - TICK <= swing.windup) {
      sim.addFx({ kind: "slash", x: sim.px + Math.sin(swing.yaw) * 1.2, y: sim.eye - 0.9, z: sim.pz - Math.cos(swing.yaw) * 1.2, yaw: swing.yaw, age: 0, heavy: swing.heavy }, 0.25);
    }
    // Hits land only inside the active window.
    if (t > swing.windup && t <= swing.windup + swing.active + 1e-9) this.meleeHits(sim, swing);
    if (pressed && !swing.heavy && t > swing.windup * 0.5 && swing.combo < 2) swing.buffered = true;
    const recovery = this.actionDuration - swing.windup - swing.active;
    if (swing.buffered && t >= swing.windup + swing.active + recovery * 0.35 && this.stamina > 0) {
      this.startSwing(sim, false, swing.combo + 1, 0);
      return;
    }
    if (t >= this.actionDuration) {
      this.comboUntil = sim.time + COMBO_WINDOW;
      this.cancelToIdle();
    }
  }

  private meleeHits(sim: Sim, swing: Swing): void {
    const w = this.stats(sim), arc = (w.arc ?? 45) * Math.PI / 180;
    for (const e of sim.enemies) {
      if (e.deathTime >= 0 || swing.hits.has(e)) continue;
      const dx = e.x - sim.px, dz = e.z - sim.pz, d = Math.hypot(dx, dz);
      if (d - e.radius > w.range) continue;
      const tolerance = arc + Math.asin(Math.min(1, e.radius / Math.max(d, 1e-3)));
      if (d > e.radius + 0.3 && Math.abs(angleDiff(yawTo(dx, dz), swing.yaw)) > tolerance) continue;
      swing.hits.add(e);
      const dirX = d > 1e-3 ? dx / d : Math.sin(swing.yaw), dirZ = d > 1e-3 ? dz / d : -Math.cos(swing.yaw);
      const crit = this.rollCrit(sim, w, e);
      const amount = swing.damage * (crit ? w.critMultiplier ?? 1.8 : 1) * (1 - clampArmor(e.arch.armor));
      sim.damageEnemy(e, amount, { critical: crit, byPlayer: true, stagger: swing.stagger, knockback: swing.knockback, dirX, dirZ, heavy: swing.heavy });
      sim.addFx({ kind: "spark", x: e.x - dirX * e.radius, y: e.height * 0.6, z: e.z - dirZ * e.radius, age: 0, color: crit ? [255, 220, 90] : [255, 90, 70] }, 0.3);
      sim.noise(sim.px, sim.pz, 0.3);
    }
  }

  /** Crits: the weapon's chance (+focus), guaranteed on a parried / stunned or unaware target. */
  private rollCrit(sim: Sim, w: WeaponStats, e: Enemy): boolean {
    const roll = sim.rng();
    if (sim.time < e.critUntil || !e.alerted) return true;
    return roll < (w.critChance ?? 0.05) + (sim.time < this.focusUntil ? 0.25 : 0);
  }

  // ---- Guns -----------------------------------------------------------------------------------

  private tickGun(sim: Sim, input: TickInput, pressed: boolean): void {
    const item = this.item(sim), w = this.stats(sim), ch = sim.character;
    const aimTarget = input.altHeld ? 1 : 0;
    this.aim = aimTarget >= this.aim ? Math.min(aimTarget, this.aim + TICK / 0.15) : Math.max(aimTarget, this.aim - TICK / 0.15);
    if (!item || !ch) return;
    const magazine = w.magazine ?? 0, loaded = ch.loaded(item.id), reserve = w.ammo ? ch.reserve(w.ammo) : 0;
    if (input.reload && loaded < magazine && reserve > 0) { this.start("reload", w.reload ?? 1.5); return; }
    const automatic = (w.automatic ?? 0) > 0;
    const trigger = automatic ? input.attackHeld || pressed : pressed;
    if (!trigger || this.fireCooldown > 0) return;
    if (loaded <= 0) {
      if (reserve > 0) this.start("reload", w.reload ?? 1.5);
      else if (sim.time - this.lastAmmoMessage > 2) { this.lastAmmoMessage = sim.time; sim.emit({ type: "message", text: "Out of ammo", tone: "danger" }); }
      return;
    }
    if (!ch.spendRound(item.id)) return;
    this.fireCooldown = automatic ? 1 / (w.automatic ?? 1) : w.cooldown;
    this.shoot(sim, w);
  }

  private shoot(sim: Sim, w: WeaponStats): void {
    const origin: Vec3 = { x: sim.px, y: sim.eye - 0.15, z: sim.pz };
    let dir = viewDirection(sim.yaw, sim.pitch);
    // Aim assist: bend the shot a few degrees toward the soft-locked target's chest.
    const target = this.lock;
    if (target && target.deathTime < 0) {
      const tx = target.x - origin.x, ty = target.height * 0.6 - origin.y, tz = target.z - origin.z, tl = Math.hypot(tx, ty, tz);
      const to = { x: tx / tl, y: ty / tl, z: tz / tl };
      const offset = Math.acos(clamp(dir.x * to.x + dir.y * to.y + dir.z * to.z, -1, 1));
      if (offset < 0.35) dir = rotateToward(dir, to, 0.05 + 0.03 * (1 - this.aim));
    }
    const spread = this.currentSpread(sim);
    const maxDistance = Math.min(140, w.range * 3);
    const hits = new Map<Enemy, { amount: number; dirX: number; dirZ: number }>();
    const muzzle = { x: origin.x + dir.x * 0.6, y: origin.y - 0.25, z: origin.z + dir.z * 0.6 };
    sim.addFx({ kind: "muzzle", ...muzzle, age: 0, enemy: false }, 0.08);
    for (let p = 0; p < Math.max(1, w.pellets ?? 1); p++) {
      const d = jitter(dir, spread, sim.rng);
      const wall = raycastWorld(sim.world, origin, d, maxDistance);
      let best = wall ? wall.distance : maxDistance, victim: Enemy | null = null;
      for (const e of sim.enemies) {
        if (e.deathTime >= 0) continue;
        const t = rayCylinder(origin, d, e.x, e.z, e.radius, e.height, best);
        if (t !== null && t < best) { best = t; victim = e; }
      }
      const end = { x: origin.x + d.x * best, y: origin.y + d.y * best, z: origin.z + d.z * best };
      sim.addFx({ kind: "tracer", from: muzzle, to: end, age: 0, enemy: false }, 0.12);
      if (victim) {
        const falloff = best <= w.range ? 1 : Math.max(0.3, 1 - (best - w.range) / (w.range * 1.5));
        const entry = hits.get(victim) ?? { amount: 0, dirX: d.x, dirZ: d.z };
        entry.amount += w.damage * falloff; hits.set(victim, entry);
      } else if (wall) sim.addFx({ kind: "spark", ...end, age: 0, color: [200, 200, 210] }, 0.25);
    }
    for (const [e, hit] of hits) {
      const crit = this.rollCrit(sim, w, e);
      const amount = hit.amount * (sim.character?.damageBonus ?? 1) * (crit ? w.critMultiplier ?? 1.8 : 1) * (1 - clampArmor(e.arch.armor));
      const dl = Math.hypot(hit.dirX, hit.dirZ) || 1;
      sim.damageEnemy(e, amount, { critical: crit, byPlayer: true, stagger: w.stagger, knockback: w.knockback, dirX: hit.dirX / dl, dirZ: hit.dirZ / dl });
      sim.addFx({ kind: "spark", x: e.x, y: e.height * 0.6, z: e.z, age: 0, color: crit ? [255, 220, 90] : [255, 90, 70] }, 0.3);
    }
    this.bloom = Math.min(1.5, this.bloom + ((w.automatic ?? 0) > 0 ? 0.2 : 0.35));
    this.lastShot = sim.time; sim.lastCombatAt = sim.time;
    sim.noise(sim.px, sim.pz, 1);
  }

  currentSpread(sim: Sim): number {
    const w = this.stats(sim);
    return isRanged(w) ? (w.spread ?? 0.03) * (1 - 0.5 * this.aim) * (1 + this.bloom) : 0;
  }

  // ---- Lock-on --------------------------------------------------------------------------------

  /** Best hostile target in a ~25 degree cone within weapon range + a bit, with LOS; the current
   * target is kept with some hysteresis so the lock doesn't flicker between two enemies. */
  private updateLock(sim: Sim): void {
    const w = this.stats(sim), ranged = isRanged(w);
    const range = ranged ? Math.max(12, w.range * 1.25) : w.range + 4;
    const eye = { x: sim.px, y: sim.eye, z: sim.pz };
    let best: Enemy | null = null, bestScore = Infinity;
    for (const e of sim.enemies) {
      if (e.deathTime >= 0 || !sim.hostileOf(e.group.id)) continue;
      const dx = e.x - sim.px, dz = e.z - sim.pz, d = Math.hypot(dx, dz);
      const current = e === this.lock;
      if (d > range * (current ? 1.3 : 1)) continue;
      const angle = Math.max(0, Math.abs(angleDiff(yawTo(dx, dz), sim.yaw)) - Math.asin(Math.min(1, e.radius / Math.max(d, 1e-3))));
      if (angle > (current ? LOCK_KEEP : LOCK_CONE)) continue;
      if (!hasLineOfSight(sim.world, eye, { x: e.x, y: e.height * 0.6, z: e.z })) continue;
      const score = angle / LOCK_CONE + d / range * 0.6 - (current ? 0.3 : 0);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    this.lock = best;
  }

  // ---- Taking damage --------------------------------------------------------------------------

  receive(sim: Sim, hit: IncomingHit): HitResult {
    if (this.dead) return "dead";
    if (this.invulnerable) return "evaded";
    const now = sim.time, ch = sim.character;
    const fromYaw = yawTo(hit.fromX - sim.px, hit.fromZ - sim.pz);
    let amount = hit.amount * (1 - clamp(ch?.protection ?? 0, 0, 0.8));
    let blocked = false;
    sim.lastCombatAt = now;
    if (this.blocking && hit.blockable && Math.abs(angleDiff(fromYaw, sim.yaw)) <= 1.35) {
      if (hit.parryable && now - this.blockStart <= PARRY_WINDOW + 1e-9) {
        sim.addFx({ kind: "spark", x: sim.px + Math.sin(fromYaw) * 0.9, y: sim.eye - 0.8, z: sim.pz - Math.cos(fromYaw) * 0.9, age: 0, color: [255, 230, 120] }, 0.35);
        return "parried";
      }
      const fists = this.item(sim) === null;
      amount *= 1 - (fists ? 0.5 : BLOCK_REDUCTION);
      this.spend(sim, hit.amount * 0.9 + 5);
      blocked = true;
      sim.addFx({ kind: "spark", x: sim.px + Math.sin(fromYaw) * 0.9, y: sim.eye - 0.8, z: sim.pz - Math.cos(fromYaw) * 0.9, age: 0, color: [180, 200, 255] }, 0.25);
      if (this.stamina <= 0) { this.guardBroken = true; this.blocking = false; this.swing = null; this.start("hurt", 0.8); }
    }
    if (this.shield > 0) { const absorbed = Math.min(this.shield, amount); this.shield -= absorbed; amount -= absorbed; }
    this.health -= amount; this.lastHurt = now; this.hurtFrom = fromYaw;
    sim.emit({ type: "damaged", target: "player", amount, source: hit.source?.id ?? "world", x: sim.px, z: sim.pz, critical: false });
    sim.addFx({ kind: "number", x: sim.px, y: sim.eye - 0.4, z: sim.pz, value: Math.round(amount), critical: false, age: 0, toPlayer: true }, 1);
    const knock = hit.knockback * (blocked ? 0.4 : 1);
    if (knock > 0) {
      const d = Math.hypot(sim.px - hit.fromX, sim.pz - hit.fromZ) || 1;
      this.knockX += (sim.px - hit.fromX) / d * knock * 10; this.knockZ += (sim.pz - hit.fromZ) / d * knock * 10;
    }
    if (this.health <= 0) { this.die(sim); return "dead"; }
    // Flinch: interrupts charging / wind-ups / reloads, with a poise window against stun-lock.
    if (!blocked && hit.stagger >= 0.3 && now >= this.poiseUntil && this.action !== "hurt") {
      const interruptible = this.action === "charge" || this.action === "reload" || this.action === "idle" || this.action === "switch"
        || ((this.action === "light" || this.action === "heavy") && this.swing !== null && this.actionT < this.swing.windup);
      if (interruptible) { this.swing = null; this.blocking = false; this.start("hurt", 0.3); this.poiseUntil = now + 1.2; }
    }
    return blocked ? "blocked" : "hit";
  }

  private die(sim: Sim): void {
    this.health = 0; this.dead = true; this.swing = null; this.blocking = false; this.lock = null;
    this.action = "idle"; this.knockX = this.knockZ = 0;
    sim.emit({ type: "playerDied" });
  }

  respawn(): void {
    this.dead = false; this.health = this.maxHealth; this.stamina = this.maxStamina;
    this.cancelToIdle(); this.blocking = false; this.guardBroken = false; this.shield = 0; this.hotUntil = -Infinity;
    this.focusUntil = -Infinity; this.hasteUntil = -Infinity; this.knockX = this.knockZ = 0; this.poiseUntil = -Infinity;
    this.hurtFrom = null; this.comboUntil = -Infinity; this.aim = 0; this.bloom = 0;
  }

  // ---- View -----------------------------------------------------------------------------------

  view(sim: Sim, inCombat: boolean): PlayerCombatView {
    const item = this.item(sim), w = this.stats(sim), ch = sim.character, now = sim.time;
    const ranged = isRanged(w);
    let action: PlayerCombatView["action"] = "idle", progress = this.actionDuration > 0 ? clamp(this.actionT / this.actionDuration, 0, 1) : 0;
    if (this.dead) action = "dead";
    else if (this.action === "dodge" || this.action === "hurt" || this.action === "reload" || this.action === "light" || this.action === "heavy") action = this.action;
    else if (this.action === "charge") { action = this.actionT >= 0.15 ? "heavy" : "idle"; progress = 0; }
    else if (this.blocking) action = "block";
    else if (ranged && now - this.lastShot < 0.1) action = "fire";
    else if (ranged && this.aim > 0.5) action = "aim";
    if (action === "idle" || action === "block" || action === "aim" || action === "fire") progress = action === "aim" ? this.aim : 0;
    const charge = this.action === "charge" ? clamp(this.actionT / HEAVY_HOLD, 0, 1) : 0;
    let moveScale = 1;
    if (this.action === "dodge") moveScale = 0;
    else if (this.action === "hurt") moveScale = 0.4;
    else if (this.blocking) moveScale = 0.5;
    else if (this.action === "charge") moveScale = 0.7;
    else if (this.action === "reload") moveScale = 0.85;
    else if (ranged) moveScale = 1 - 0.4 * this.aim;
    if (this.hasted(sim)) moveScale *= 1.25;
    const buffs: { effect: "regen" | "focus" | "haste" | "shield"; remaining: number }[] = [];
    if (now < this.hotUntil) buffs.push({ effect: "regen", remaining: this.hotUntil - now });
    if (now < this.focusUntil) buffs.push({ effect: "focus", remaining: this.focusUntil - now });
    if (now < this.hasteUntil) buffs.push({ effect: "haste", remaining: this.hasteUntil - now });
    if (this.shield > 0 && now < this.shieldUntil) buffs.push({ effect: "shield", remaining: this.shieldUntil - now });
    return {
      health: this.health < 0 ? this.maxHealth : this.health, maxHealth: this.maxHealth, stamina: this.stamina < 0 ? this.maxStamina : this.stamina, maxStamina: this.maxStamina,
      weapon: this.slot, weaponItem: item?.id ?? null, weaponClass: item ? w.class : "fists",
      ammo: ranged && item && ch ? { loaded: ch.loaded(item.id), reserve: w.ammo ? ch.reserve(w.ammo) : 0 } : null,
      action, actionProgress: progress,
      hitConfirmAge: now - this.hitConfirmAt, hurtAge: now - this.lastHurt, hurtFrom: this.hurtFrom,
      inCombat, dead: this.dead,
      aim: this.aim, spread: this.currentSpread(sim), moveScale, lock: this.lock?.id ?? null,
      combo: this.swing?.combo ?? this.lastCombo, charge, blocking: this.blocking, invulnerable: this.invulnerable,
      shield: this.shield, buffs,
    };
  }
}

