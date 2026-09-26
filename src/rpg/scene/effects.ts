// 3D combat effects for the main pass: tracers, sparks, slash ribbons, muzzle flashes, boss
// telegraphs on the ground and glowing projectile orbs. All drawn with the prop surface (bright
// colours = emissive) as boxes at least one character cell thick at their distance, with the stroke
// glyph chosen from the on-screen direction (- / \ |) like the sky-traffic trails in vfx-scene.ts.
// Comfort: every effect is small and localized, fades by age, and pulses no faster than 1.5 Hz.
// Damage numbers are HUD work (overlay.ts); unknown effect kinds are ignored.
import type { Textmodifier } from "textmode.js";
import type { PropCanvas } from "../../city/prop-canvas.ts";
import { cellWorld, project, type ViewCamera } from "../../city/vfx.ts";
import type { CombatEffect } from "../types.ts";
import { DEG, box, clamp01, hash3, paint, paintRange, restorePaintRange, ring, segment, type Rgb } from "./palette.ts";

/** Seconds each effect kind is drawn for (the combat system may drop them earlier). */
export const EFFECT_LIFE = { tracer: 0.14, spark: 0.4, slash: 0.3, muzzle: 0.08, number: 1.1 } as const;
const PLAYER_TRACER: Rgb = [255, 224, 150], ENEMY_TRACER: Rgb = [255, 98, 64];
const SLASH: Rgb = [214, 242, 255], SLASH_HEAVY: Rgb = [255, 198, 120];
const TELEGRAPH: Rgb = [255, 64, 44], TELEGRAPH_HOT: Rgb = [255, 190, 120];
const ORB_ENEMY: Rgb = [255, 84, 160], ORB_PLAYER: Rgb = [110, 236, 255];
const MUZZLE: Rgb = [255, 236, 170];

// Thin geometry is rasterised at cell centres: a bar exactly one cell wide drops cells as it moves,
// so lines are drawn ~1.35 cells thick to stay continuous.
const LINE_CELLS = 1.35;

/** Stroke glyph for a world line as it appears on screen (y up). */
export function strokeGlyph(cam: ViewCamera, ax: number, ay: number, az: number, bx: number, by: number, bz: number): string {
  const a = project(cam, ax, ay, az), b = project(cam, bx, by, bz);
  if (!a || !b) return "-";
  const dx = (b.sx - a.sx) * cam.aspect, dy = b.sy - a.sy;
  const slope = Math.abs(dy) / Math.max(1e-6, Math.abs(dx));
  return slope < 0.41 ? "-" : slope > 2.4 ? "|" : dx * dy > 0 ? "/" : "\\";
}

/** World size of one cell at a point (never below 1.5 cm). */
function cellAt(cam: ViewCamera, rows: number, x: number, y: number, z: number): number {
  return Math.max(0.015, cellWorld(cam.fov, rows, Math.max(0.3, Math.hypot(x - cam.x, y - cam.y, z - cam.z))));
}

/** A line split into pieces each sized to its own distance, so it stays ~1 cell thick end to end. */
function line(t: PropCanvas, cam: ViewCamera, rows: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: Rgb, gain: number, thickCells = 1): void {
  const length = Math.hypot(bx - ax, by - ay, bz - az);
  const pieces = Math.max(1, Math.min(10, Math.ceil(length / 2.5)));
  paint(t, color, strokeGlyph(cam, ax, ay, az, bx, by, bz), gain);
  for (let i = 0; i < pieces; i++) {
    const u0 = i / pieces, u1 = (i + 1) / pieces;
    const x0 = ax + (bx - ax) * u0, y0 = ay + (by - ay) * u0, z0 = az + (bz - az) * u0;
    const x1 = ax + (bx - ax) * u1, y1 = ay + (by - ay) * u1, z1 = az + (bz - az) * u1;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2;
    // Never draw a bar through the viewer's face (own shots start at the gun).
    if (Math.hypot(mx - cam.x, my - cam.y, mz - cam.z) < 0.7) continue;
    segment(t, x0, y0, z0, x1, y1, z1, cellAt(cam, rows, mx, my, mz) * thickCells * LINE_CELLS);
  }
}

/** Records the effects into any PropCanvas (drawCombatEffects passes the Textmodifier). */
export function recordCombatEffects(t: PropCanvas, effects: readonly CombatEffect[], cam: ViewCamera, time: number, rows = 90): void {
  const outer = paintRange(0);
  for (const effect of effects) {
    switch (effect.kind) {
      case "tracer": {
        const k = effect.age / EFFECT_LIFE.tracer;
        if (k >= 1 || k < 0) break;
        const { from: a, to: b } = effect;
        // The round's streak runs out along the line, then the trail fades.
        const head = Math.min(1, k / 0.35), tail = Math.max(0, head - 0.45 - k * 0.4);
        const color = effect.enemy ? ENEMY_TRACER : PLAYER_TRACER;
        line(t, cam, rows, a.x + (b.x - a.x) * tail, a.y + (b.y - a.y) * tail, a.z + (b.z - a.z) * tail,
          a.x + (b.x - a.x) * head, a.y + (b.y - a.y) * head, a.z + (b.z - a.z) * head, color, 1.05 - k * 0.6);
        break;
      }
      case "spark": {
        const life = EFFECT_LIFE.spark, k = effect.age / life;
        if (k >= 1 || k < 0) break;
        const sx = Math.floor(effect.x * 10), sz = Math.floor(effect.z * 10);
        for (let i = 0; i < 7; i++) {
          const r = (s: number) => hash3(sx + i * 17, sz, s);
          const a = r(1) * Math.PI * 2, out = 1.2 + r(2) * 2.4, up = 0.6 + r(3) * 2.2, age = effect.age * (0.8 + r(4) * 0.4);
          const x = effect.x + Math.cos(a) * out * age, z = effect.z + Math.sin(a) * out * age;
          const y = Math.max(0.03, effect.y + up * age - 4.9 * age * age);
          const heat = 1 - k;
          paint(t, heat > 0.6 ? [255, 246, 214] : effect.color, heat > 0.72 ? "*" : heat > 0.45 ? "+" : heat > 0.22 ? "'" : ".", 0.55 + heat * 0.6);
          const s = cellAt(cam, rows, x, y, z) * LINE_CELLS;
          box(t, x, y, z, s, s, s);
        }
        break;
      }
      case "slash": {
        const life = EFFECT_LIFE.slash;
        if (effect.age >= life || effect.age < 0) break;
        const radius = effect.heavy ? 1.9 : 1.4, span = (effect.heavy ? 75 : 60) / DEG;
        const head = Math.min(1, effect.age / 0.1), tail = Math.max(0, (effect.age - 0.07) / (life - 0.07));
        const y0 = effect.y > 0.3 ? effect.y : 1.3;
        const fx = Math.sin(effect.yaw), fz = -Math.cos(effect.yaw), rx = Math.cos(effect.yaw), rz = Math.sin(effect.yaw);
        const color = effect.heavy ? SLASH_HEAVY : SLASH;
        const pieces = 12;
        for (let i = 0; i < pieces; i++) {
          const u0 = i / pieces, u1 = (i + 1) / pieces;
          if (u1 < tail || u0 > head) continue;
          // The arc runs right -> left across the attacker's front, dipping diagonally.
          const a0 = span * (1 - 2 * u0), a1 = span * (1 - 2 * u1);
          const p0x = effect.x + (Math.sin(a0) * rx + Math.cos(a0) * fx) * radius, p0z = effect.z + (Math.sin(a0) * rz + Math.cos(a0) * fz) * radius, p0y = y0 + Math.sin(a0) * radius * 0.32;
          const p1x = effect.x + (Math.sin(a1) * rx + Math.cos(a1) * fx) * radius, p1z = effect.z + (Math.sin(a1) * rz + Math.cos(a1) * fz) * radius, p1y = y0 + Math.sin(a1) * radius * 0.32;
          // Fresh end bright and thick, older end thin and dim.
          const fresh = clamp01(1 - (head - (u0 + u1) / 2) * 1.6);
          paint(t, color, strokeGlyph(cam, p0x, p0y, p0z, p1x, p1y, p1z), 0.45 + 0.7 * fresh);
          segment(t, p0x, p0y, p0z, p1x, p1y, p1z, cellAt(cam, rows, (p0x + p1x) / 2, (p0y + p1y) / 2, (p0z + p1z) / 2) * (LINE_CELLS + fresh * (effect.heavy ? 1.5 : 0.8)));
        }
        break;
      }
      case "muzzle": {
        const k = effect.age / EFFECT_LIFE.muzzle;
        if (k >= 1 || k < 0) break;
        // The player's own flash is part of the first-person weapon.
        if (!effect.enemy && Math.hypot(effect.x - cam.x, effect.y - cam.y, effect.z - cam.z) < 1.8) break;
        const s = Math.max(0.12, cellAt(cam, rows, effect.x, effect.y, effect.z) * 2.2) * (1.2 - k * 0.5);
        const toCam = Math.atan2(cam.x - effect.x, effect.z - cam.z);
        t.push(); t.translate(effect.x, -effect.y, effect.z); t.rotateY(-toCam * DEG);
        paint(t, MUZZLE, "*", 1.1 - k * 0.4); t.box(s, s, s * 0.5);
        paint(t, MUZZLE, "-", 0.9 - k * 0.4); t.box(s * 2.4, s * 0.3, s * 0.3);
        paint(t, MUZZLE, "|", 0.9 - k * 0.4); t.box(s * 0.3, s * 2.4, s * 0.3);
        t.pop();
        break;
      }
      case "telegraph": drawTelegraph(t, cam, rows, effect, time); break;
      case "projectile": {
        const r = effect.radius > 0 ? effect.radius : 0.3;
        const color = effect.enemy ? ORB_ENEMY : ORB_PLAYER;
        const glow = 0.9 + 0.1 * Math.sin(time * 6 + effect.id);
        paint(t, color, "@", glow); box(t, effect.x, effect.y, effect.z, r * 1.2, r * 1.2, r * 1.2);
        paint(t, color, "O", 0.75); t.push(); t.translate(effect.x, -effect.y, effect.z); t.rotateY(time * 90); t.rotateX(90); t.torus(r * 1.15, r * 0.12); t.pop();
        // A short cooling trail behind it, and a ground marker under it so it can be dodged.
        const speed = Math.hypot(effect.vx, effect.vz) || 1, bx = -effect.vx / speed, bz = -effect.vz / speed;
        const trail = "*+:.";
        for (let i = 0; i < 4; i++) {
          const d = r * (1.2 + i * 1.1), s = Math.max(cellAt(cam, rows, effect.x, effect.y, effect.z), r * (0.7 - i * 0.14));
          paint(t, color, trail[i], 0.85 - i * 0.16);
          box(t, effect.x + bx * d, effect.y, effect.z + bz * d, s, s, s);
        }
        paint(t, color, ".", 0.5); ring(t, effect.x, 0.05, effect.z, r * 1.4, Math.max(0.03, r * 0.1));
        break;
      }
      default:
        break; // "number" is drawn by the overlay; unknown kinds from newer combat code are skipped.
    }
  }
  restorePaintRange(outer);
}

type TelegraphEffect = Extract<CombatEffect, { kind: "telegraph" }>;
/** Boss attack warnings flat on the ground: an outline of the danger zone and a fill that grows to
 * the edge as the impact nears (MMO-style), warming from red toward white-hot in the last 20%. */
export function drawTelegraph(t: PropCanvas, cam: ViewCamera, rows: number, e: TelegraphEffect, time: number): void {
  const progress = clamp01(e.progress);
  const hot = clamp01((progress - 0.8) / 0.2);
  const pulse = 0.82 + 0.18 * Math.sin(time * Math.PI * 2 * 1.5);
  const edge: Rgb = [TELEGRAPH[0] + (TELEGRAPH_HOT[0] - TELEGRAPH[0]) * hot, TELEGRAPH[1] + (TELEGRAPH_HOT[1] - TELEGRAPH[1]) * hot, TELEGRAPH[2] + (TELEGRAPH_HOT[2] - TELEGRAPH[2]) * hot];
  const y = 0.06, r = Math.max(0.2, e.radius);
  const fx = Math.sin(e.yaw), fz = -Math.cos(e.yaw), rx = Math.cos(e.yaw), rz = Math.sin(e.yaw);
  const tube = (x: number, z: number) => Math.max(0.05, cellAt(cam, rows, x, y, z) * 0.7);
  switch (e.shape) {
    case "circle": {
      paint(t, edge, "=", pulse); ring(t, e.x, y, e.z, r, tube(e.x + r, e.z));
      if (progress > 0.02) {
        paint(t, edge, "o", 0.7 + 0.3 * progress); ring(t, e.x, y, e.z, r * progress, tube(e.x, e.z) * 0.8);
        paint(t, edge, ".", 0.35 + 0.3 * progress); t.push(); t.translate(e.x, -y + 0.01, e.z); t.ellipsoid(r * progress, 0.012, r * progress); t.pop();
      }
      break;
    }
    case "ring": {
      // Expanding shockwave: the band to jump or dodge through.
      const w = Math.max(0.2, e.width);
      paint(t, edge, "O", 1); ring(t, e.x, y + 0.1, e.z, r, Math.max(w * 0.5, tube(e.x + r, e.z)));
      paint(t, edge, "~", 0.55); ring(t, e.x, y, e.z, Math.max(0.2, r - w), tube(e.x + r, e.z) * 0.6);
      break;
    }
    case "arc": {
      const half = Math.max(0.05, Math.min(Math.PI, e.arc)), steps = Math.max(4, Math.min(16, Math.round(half * 8)));
      const at = (a: number, d: number): [number, number] => [e.x + (Math.sin(a) * rx + Math.cos(a) * fx) * d, e.z + (Math.sin(a) * rz + Math.cos(a) * fz) * d];
      for (const reach of progress > 0.02 ? [r, r * progress] : [r]) {
        const outline = reach === r;
        for (let i = 0; i < steps; i++) {
          const [x0, z0] = at(-half + (2 * half * i) / steps, reach), [x1, z1] = at(-half + (2 * half * (i + 1)) / steps, reach);
          line(t, cam, rows, x0, y, z0, x1, y, z1, edge, outline ? pulse : 0.6 + 0.4 * progress, outline ? 1 : 0.8);
        }
      }
      for (let side = -1; side <= 1; side += 2) { const [x1, z1] = at(side * half, r); line(t, cam, rows, e.x, y, e.z, x1, y, z1, edge, pulse * 0.9); }
      break;
    }
    case "line": {
      const w = Math.max(0.4, e.width) / 2, len = r;
      const c = (along: number, across: number): [number, number] => [e.x + fx * along + rx * across, e.z + fz * along + rz * across];
      const [ax, az] = c(0, -w), [bx, bz] = c(len, -w), [cx, cz] = c(len, w), [dx, dz] = c(0, w);
      line(t, cam, rows, ax, y, az, bx, y, bz, edge, pulse); line(t, cam, rows, dx, y, dz, cx, y, cz, edge, pulse);
      line(t, cam, rows, bx, y, bz, cx, y, cz, edge, pulse); line(t, cam, rows, ax, y, az, dx, y, dz, edge, pulse * 0.8);
      if (progress > 0.02) {
        const [px, pz] = c(len * progress, -w), [qx, qz] = c(len * progress, w);
        line(t, cam, rows, px, y, pz, qx, y, qz, edge, 0.7 + 0.3 * progress, 1.4);
        const [mx, mz] = c(len * progress, 0);
        line(t, cam, rows, e.x, y, e.z, mx, y, mz, edge, 0.4 + 0.3 * progress, 0.8);
      }
      break;
    }
    default:
      break;
  }
}

/** Combat effects in the main pass (after the viewmodel / before flushVfx; u_surface 2).
 * `rows` = main grid rows (sizes lines to one cell). */
export function drawCombatEffects(t: Textmodifier, effects: readonly CombatEffect[], cam: ViewCamera, time: number, rows = 90): void {
  if (!effects.length) return;
  t.setUniform("u_surface", 2);
  recordCombatEffects(t, effects, cam, time, rows);
}
