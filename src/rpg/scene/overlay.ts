// The fast combat HUD: drawn every frame on a flat overlay layer (ortho, origin at the centre, one
// unit per cell, y down - like drawRain / drawRemoteLabels), printable ASCII only:
//   floating damage numbers (rise, hold, dissolve through "@%#*+=-:."; crits in big 3x5 digits;
//   damage to the player in red by the health bar), enemy names + health bars when hurt / locked /
//   near, barks, lock-on brackets, a small crosshair that opens with spread, hit-confirm "x",
//   HP / stamina bars bottom-left, weapon + ammo bottom-right, the boss bar top-centre with phase
//   pips and a chip-damage trail, hurt-direction arcs at the screen edge, and a low-health
//   vignette of red glyph corruption creeping in from the edges (never a full-screen flash).
// Comfort: nothing blinks faster than ~1.2 Hz; hit markers hold then fade so rapid fire keeps them
// steady; the vignette swells slowly.
import type { Textmodifier } from "textmode.js";
import { project, type ViewCamera } from "../../city/vfx.ts";
import type { CombatEffect, EnemyView, ItemDefinition, PlayerCombatView, RpgSnapshot } from "../types.ts";
import { NUMBER_LIFE, asciiBar, numberGain, numberGlyph, numberRise, wrapAngle } from "./anim.ts";
import { RARITY_COLOR, clamp01, factionStyle, hash3, type Rgb } from "./palette.ts";
import { combatHudLayout, fitHudText, hudNumber, type CombatHudLayout, type HudRegion } from "./hud-layout.ts";

/** The subset of textmode the overlay uses (a Textmodifier satisfies it; tests use a text grid). */
export interface OverlayCanvas {
  push(): void;
  pop(): void;
  translate(x?: number, y?: number, z?: number): void;
  rect(width?: number, height?: number): void;
  char(value: string | number): void;
  charColor(r: number, g: number, b: number, a?: number): void;
  cellColor(r: number, g: number, b: number, a?: number): void;
  print(text: string, x: number, y: number, options?: { markup?: boolean }): void;
  printAlign(horizontal: "left" | "center" | "right", vertical?: "top" | "middle" | "bottom"): void;
}
export interface CombatOverlayFrame {
  cam: ViewCamera;
  effects: readonly CombatEffect[];
  enemies: readonly EnemyView[];
  lockTarget: string | null;
  player: PlayerCombatView;
  boss: RpgSnapshot["boss"];
  prompt: string | null;
  visible: (x: number, y: number, z: number) => boolean;
  /** The weapon in hand (name + rarity on the HUD). Optional. */
  weapon?: ItemDefinition | null;
  /** Scene clock (s) for the slow pulses; optional. */
  time?: number;
}

const NO_MARKUP = { markup: false } as const;
const PANEL: Rgb = [4, 9, 14];
const RED: Rgb = [255, 64, 52], WHITE: Rgb = [255, 246, 226], CRIT: Rgb = [255, 212, 64], CYAN: Rgb = [96, 214, 255];
const LOCK: Rgb = [255, 236, 190], PROMPT: Rgb = [150, 255, 222], BOSS: Rgb = [255, 92, 60];

/** Screen layout in overlay cells (exported for tests). Margins keep one cell clear of each edge. */
export function hudLayout(cols: number, rows: number): { left: number; right: number; top: number; bottom: number } {
  return { left: -Math.floor(cols / 2) + 1, right: Math.ceil(cols / 2) - 2, top: -Math.floor(rows / 2) + 1, bottom: Math.ceil(rows / 2) - 2 };
}
/** World point -> overlay cell (null behind the camera). */
export function toCell(cam: ViewCamera, cols: number, rows: number, x: number, y: number, z: number): { gx: number; gy: number; depth: number } | null {
  const p = project(cam, x, y, z);
  return p ? { gx: Math.round(p.sx * cols / 2), gy: Math.round(-p.sy * rows / 2), depth: p.depth } : null;
}

let canvas: OverlayCanvas;
function ink(color: Rgb, alpha = 255, gain = 1): void {
  canvas.charColor(Math.min(255, color[0] * gain), Math.min(255, color[1] * gain), Math.min(255, color[2] * gain), Math.max(0, Math.min(255, alpha)));
}
function paper(alpha: number): void { canvas.cellColor(PANEL[0], PANEL[1], PANEL[2], alpha); }
function clearPaper(): void { canvas.cellColor(0, 0, 0, 0); }
function cell(glyph: string, gx: number, gy: number): void {
  canvas.char(glyph); canvas.push(); canvas.translate(gx, gy); canvas.rect(1, 1); canvas.pop();
}
function text(s: string, x: number, y: number): void { canvas.print(s, x, y, NO_MARKUP); }

/** Combat HUD for the overlay layer. Call after drawRain / drawRemoteLabels. */
export function drawCombatOverlay(t: Textmodifier | OverlayCanvas, cols: number, rows: number, frame: CombatOverlayFrame, layout?: CombatHudLayout): void {
  canvas = t;
  const time = frame.time ?? 0;
  const safeLayout = layout ?? combatHudLayout(cols, rows);
  clearPaper();
  if (!frame.player.dead) drawVignette(cols, rows, frame.player, time);
  drawHurtArcs(cols, rows, frame);
  drawEnemyLabels(cols, rows, frame, time);
  drawNumbers(cols, rows, frame, safeLayout.vitals);
  if (!frame.player.dead) drawCrosshair(rows, frame);
  drawPlayerBars(frame, safeLayout.vitals);
  drawWeaponPanel(frame, safeLayout.weapon);
  if (frame.boss) drawBossBar(frame.boss, safeLayout.boss, frame.time);
  if (frame.prompt) {
    canvas.printAlign("center", "middle");
    ink(PROMPT); paper(170);
    text(/^\[/.test(frame.prompt) ? frame.prompt : `[E] ${frame.prompt}`, 0, Math.round(rows * 0.16));
  }
  canvas.printAlign("left", "top");
  clearPaper();
}

// ---- Damage numbers ----------------------------------------------------------------------------------
const BIG: Record<string, readonly string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"], "1": [".#.", "##.", ".#.", ".#.", "###"], "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", ".##", "..#", "###"], "4": ["#.#", "#.#", "###", "..#", "..#"], "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"], "7": ["###", "..#", ".#.", ".#.", ".#."], "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
};
/** Cells of a big 3x5 number, each drawn with the digit itself (exported for tests). */
export function bigDigits(value: string): { dx: number; dy: number; ch: string; index: number }[] {
  const out: { dx: number; dy: number; ch: string; index: number }[] = [];
  const width = value.length * 4 - 1;
  for (let i = 0; i < value.length; i++) {
    const rowsOf = BIG[value[i]];
    if (!rowsOf) continue;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (rowsOf[y][x] === "#") out.push({ dx: i * 4 + x - Math.floor(width / 2), dy: y - 4, ch: value[i], index: i });
  }
  return out;
}

function drawNumbers(cols: number, rows: number, frame: CombatOverlayFrame, region: HudRegion): void {
  const { cam } = frame;
  const rx = Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
  let playerSlot = 0;
  canvas.printAlign("left", "top");
  for (const e of frame.effects) {
    if (e.kind !== "number" || e.age >= NUMBER_LIFE || e.age < 0) continue;
    const value = String(Math.max(0, Math.round(e.value)));
    const gain = numberGain(e.age), alpha = 255 * Math.min(1, gain);
    if (e.toPlayer) {
      // Damage taken: red, rising from just above the health bar (it has no place in the world view).
      const gx = region.left + Math.min(Math.max(0, region.width - value.length - 1), Math.floor(region.width / 2) + (playerSlot++ % 3) * 6), gy = region.top - 2 - Math.round(numberRise(e.age, e.critical) * 3);
      ink(RED, alpha, e.critical ? 1.2 : 1);
      for (let i = 0; i < value.length + 1; i++) { const g = numberGlyph(e.age, i, i === 0 ? "-" : value[i - 1]); if (g) cell(g, gx + i, gy); }
      continue;
    }
    // Sideways drift per number so a burst doesn't stack into one unreadable pile.
    const drift = (hash3(e.value * 7.3, e.x * 10, e.z * 10) - 0.5) * 0.9;
    const c = toCell(cam, cols, rows, e.x + rx * drift, e.y + numberRise(e.age, e.critical), e.z + rz * drift);
    if (!c || Math.abs(c.gx) > cols / 2 || Math.abs(c.gy) > rows / 2) continue;
    if (e.critical && c.depth < 32) {
      ink(CRIT, alpha, gain);
      for (const d of bigDigits(value)) { const g = numberGlyph(e.age, d.index, d.ch); if (g) cell(g, c.gx + d.dx, c.gy + d.dy); }
    } else {
      ink(e.critical ? CRIT : WHITE, alpha * (c.depth > 45 ? 0.75 : 1), gain);
      const s = e.critical ? value + "!" : value, x0 = c.gx - Math.floor(s.length / 2);
      for (let i = 0; i < s.length; i++) { const g = numberGlyph(e.age, i, s[i]); if (g) cell(g, x0 + i, c.gy); }
    }
  }
}

// ---- Enemy names, bars, barks and the lock-on brackets ------------------------------------------------
/** Whether an enemy's name + health bar shows (exported for tests). */
export function showEnemyLabel(e: EnemyView, distance: number, locked: boolean): boolean {
  if (e.deathAge >= 0) return false;
  if (locked) return distance < 90;
  if (distance > 45) return false;
  return e.health < e.maxHealth || distance < 9;
}
function drawEnemyLabels(cols: number, rows: number, frame: CombatOverlayFrame, time: number): void {
  const { cam } = frame;
  const lock = frame.lockTarget ?? frame.player.lock ?? null;
  canvas.printAlign("center", "middle");
  for (const e of frame.enemies) {
    const distance = Math.hypot(e.x - cam.x, e.z - cam.z);
    const locked = e.id === lock || !!e.locked;
    const scale = e.scale ?? 1;
    if (locked && e.deathAge < 0) drawLock(cam, cols, rows, e, time);
    const bossBarred = !!frame.boss && (e.boss || e.name === frame.boss.name);
    if (!showEnemyLabel(e, distance, locked) && !(e.bark && distance < 25 && e.deathAge < 0)) continue;
    const head = toCell(cam, cols, rows, e.x, 3.05 * scale + 0.45, e.z);
    if (!head || Math.abs(head.gx) > cols / 2 + 6 || Math.abs(head.gy) > rows / 2) continue;
    const seen = distance < 10 || frame.visible(e.x, 2 * scale, e.z);
    if (!seen && !locked) continue;
    const far = distance > 25, dim = seen ? 1 : 0.5;
    let row = head.gy;
    if (showEnemyLabel(e, distance, locked) && !bossBarred) {
      const bar = asciiBar(e.health, e.maxHealth, far ? 6 : 10);
      ink(e.hostile ? RED : [196, 196, 186], (far ? 190 : 245) * dim); paper(110 * dim);
      text(e.vulnerable ? `*${bar}*` : bar, head.gx, row);
      ink(factionStyle(e.faction).hud, 235 * dim); paper(0);
      row -= 1; text(e.name, head.gx, row);
    }
    if (e.bark && distance < 25) {
      ink(WHITE, 220 * dim); paper(120 * dim);
      row -= 1; text(`"${e.bark}"`, head.gx, row);
    }
  }
  clearPaper();
}
/** Screen box of an enemy figure in overlay cells (exported for tests). */
export function enemyScreenBox(cam: ViewCamera, cols: number, rows: number, e: EnemyView): { x0: number; x1: number; y0: number; y1: number } | null {
  const scale = e.scale ?? 1;
  const top = toCell(cam, cols, rows, e.x, 2.75 * scale, e.z), feet = toCell(cam, cols, rows, e.x, 0.05, e.z);
  if (!top || !feet) return null;
  const height = Math.max(2, feet.gy - top.gy), half = Math.max(2, Math.round(height * 0.3));
  const cx = Math.round((top.gx + feet.gx) / 2);
  return { x0: cx - half, x1: cx + half, y0: top.gy - 1, y1: feet.gy + 1 };
}
function drawLock(cam: ViewCamera, cols: number, rows: number, e: EnemyView, time: number): void {
  const b = enemyScreenBox(cam, cols, rows, e);
  if (!b || b.x1 < -cols / 2 || b.x0 > cols / 2) return;
  ink(LOCK, 200 + 55 * Math.sin(time * Math.PI * 2)); clearPaper();
  const mid = Math.round((b.y0 + b.y1) / 2);
  cell("[", b.x0, mid); cell("]", b.x1, mid);
  cell("+", b.x0, b.y0); cell("-", b.x0 + 1, b.y0); cell("+", b.x1, b.y0); cell("-", b.x1 - 1, b.y0);
  cell("+", b.x0, b.y1); cell("-", b.x0 + 1, b.y1); cell("+", b.x1, b.y1); cell("-", b.x1 - 1, b.y1);
}

// ---- Crosshair + hit confirm -----------------------------------------------------------------------------
/** Crosshair gap in cells for a spread (radians) at this view (exported for tests). */
export function crosshairGap(spread: number, fov: number, rows: number): number {
  const focal = rows / 2 / Math.tan(fov * Math.PI / 360);
  return Math.max(1, Math.min(8, Math.round(spread * focal)));
}
/** 0..1 hit-marker strength: holds 0.12 s then fades by 0.3 s (steady under rapid fire). */
export const hitMarker = (age: number): number => age < 0.12 ? 1 : clamp01(1 - (age - 0.12) / 0.18);
function drawCrosshair(rows: number, frame: CombatOverlayFrame): void {
  const p = frame.player;
  const ranged = p.weaponClass === "pistol" || p.weaponClass === "smg" || p.weaponClass === "shotgun" || p.weaponClass === "rifle";
  clearPaper();
  if (ranged) {
    const gap = crosshairGap(p.spread ?? (p.aim ? 0.01 : 0.04), frame.cam.fov, rows);
    ink(WHITE, 200);
    cell("-", -gap, 0); cell("-", gap, 0); cell("|", 0, -Math.ceil(gap / 2)); cell("|", 0, Math.ceil(gap / 2));
    ink(WHITE, 150); cell(".", 0, 0);
  } else {
    ink(WHITE, p.inCombat ? 170 : 90); cell(p.inCombat ? "+" : ".", 0, 0);
  }
  const hit = hitMarker(p.hitConfirmAge);
  if (hit > 0) { ink(WHITE, 255 * hit); cell("x", -1, -1); cell("x", 1, -1); cell("x", -1, 1); cell("x", 1, 1); }
}

// ---- Player bars, weapon panel, boss bar ------------------------------------------------------------------
/** Health bar colour: green -> amber -> red. */
export function healthColor(fraction: number): Rgb {
  const f = clamp01(fraction);
  return f > 0.5 ? [Math.round(120 + (1 - f) * 2 * 135), 236, 110] : [255, Math.round(70 + f * 2 * 166), 60];
}
/** "HP [########--] 82/100" (exported for tests). */
export const hpLine = (health: number, max: number, width = 20): string => `HP ${asciiBar(health, max, width)} ${Math.max(0, Math.ceil(health))}/${Math.round(max)}`;
function drawPlayerBars(frame: CombatOverlayFrame, region: HudRegion): void {
  if (!region.height) return;
  const p = frame.player;
  canvas.printAlign("left", "top");
  paper(150);
  ink(healthColor(p.health / Math.max(1, p.maxHealth)));
  const shield = p.shield ?? 0;
  const health = `${hudNumber(p.health)}/${hudNumber(p.maxHealth)}`;
  const shieldLabel = shield > 0 ? ` +${hudNumber(shield)}` : "";
  const protection = health.length + shieldLabel.length + 3 <= region.width ? shieldLabel : "";
  const healthWidth = Math.min(20, region.width - health.length - protection.length - 6);
  const healthLine = healthWidth >= 4 ? `HP ${asciiBar(p.health, p.maxHealth, healthWidth)} ${health}${protection}` : `HP ${health}${protection}`;
  text(fitHudText(healthLine, region.width), region.left, region.top);
  if (region.height < 2) return;
  const low = p.stamina < p.maxStamina * 0.2;
  ink(low ? [230, 170, 70] : CYAN, low ? 200 : 235);
  let buffs = "";
  for (let index = 0; index < Math.min(4, p.buffs?.length ?? 0); index++) {
    const buff = p.buffs![index];
    buffs += `${buffs ? " " : ""}${buff.effect.toUpperCase()} ${hudNumber(buff.remaining)}s`;
  }
  const buffBudget = buffs ? Math.max(0, Math.min(32, region.width - 12)) : 0;
  const staminaWidth = Math.max(1, Math.min(20, region.width - 5 - (buffBudget ? buffBudget + 1 : 0)));
  text(fitHudText(`ST ${asciiBar(p.stamina, p.maxStamina, staminaWidth, "=", ".")}${buffBudget ? ` ${fitHudText(buffs, buffBudget)}` : ""}`, region.width), region.left, region.top + 1);
}
function drawWeaponPanel(frame: CombatOverlayFrame, region: HudRegion): void {
  if (!region.height) return;
  const p = frame.player, w = frame.weapon ?? null;
  canvas.printAlign("right", "top");
  paper(150);
  const name = fitHudText(p.weaponClass === "fists" ? "FISTS" : w?.name ?? p.weaponClass, region.width).toUpperCase();
  ink(w ? RARITY_COLOR[w.rarity] ?? WHITE : WHITE, 235);
  if (region.height > 1 || !p.ammo) text(name, region.left + region.width, region.top + (!p.ammo && region.height > 1 ? 1 : 0));
  if (!p.ammo) return;
  const { loaded, reserve } = p.ammo, mag = w?.weapon?.magazine ?? Math.max(loaded, 1);
  const count = `${hudNumber(loaded)} / ${hudNumber(reserve)}`;
  let ammo = count;
  if (p.action === "reload") {
    ink(CYAN, 235);
    ammo += region.width >= count.length + 7 ? " RELOAD" : " R";
    const barWidth = Math.min(8, region.width - ammo.length - 3);
    if (barWidth >= 4) ammo += ` ${asciiBar(p.actionProgress, 1, barWidth, "=", ".")}`;
  } else if (loaded === 0) {
    ink(RED, 245);
    ammo = `${count} ${reserve > 0 ? "[R]" : "EMPTY"}`;
  } else {
    ink(loaded <= Math.max(1, mag * 0.25) ? [255, 180, 70] : WHITE, 245);
  }
  text(fitHudText(ammo, region.width), region.left + region.width, region.top + region.height - 1);
}
// Chip-damage trail on the boss bar: the lost chunk stays lighter for a moment, then drains.
const trail = { name: "", value: 0, at: 0, clock: 0 };
/** Boss bar cells: "#" health, "=" recent damage, "-" empty (exported for tests). */
export function bossBarText(health: number, trailValue: number, max: number, width: number): string {
  const h = Math.round(clamp01(health / max) * width), tr = Math.max(h, Math.round(clamp01(trailValue / max) * width));
  return "[" + "#".repeat(h) + "=".repeat(tr - h) + "-".repeat(width - tr) + "]";
}
/** Phase pips: passed "*", current "@", to come "o" (phase is 0-based). */
export function phasePips(phase: number, phases: number): string {
  let s = "";
  for (let i = 0; i < phases; i++) s += (i ? " " : "") + (i < phase ? "*" : i === phase ? "@" : "o");
  return s;
}
function drawBossBar(boss: NonNullable<RpgSnapshot["boss"]>, region: HudRegion, time: number | undefined): void {
  if (!region.height) return;
  const dt = time === undefined ? 1 / 60 : Math.max(0, Math.min(0.25, time - trail.clock));
  trail.clock = time ?? trail.clock + dt;
  if (trail.name !== boss.name || boss.health > trail.value) { trail.name = boss.name; trail.value = boss.health; trail.at = trail.clock; }
  else if (trail.clock - trail.at > 0.6) trail.value += (boss.health - trail.value) * (1 - Math.exp(-dt * 5));
  else if (boss.health >= trail.value) trail.at = trail.clock;
  const width = Math.max(1, Math.min(60, region.width - 2)), center = region.left + Math.floor(region.width / 2);
  canvas.printAlign("center", "top");
  paper(150);
  ink(BOSS, 250); text(fitHudText(`${boss.name.toUpperCase()} - ${boss.title}`, region.width), center, region.top);
  if (region.height < 2) return;
  ink(BOSS, 245); text(fitHudText(bossBarText(boss.health, trail.value, Math.max(1, boss.maxHealth), width), region.width), center, region.top + 1);
  if (region.height < 3) return;
  const phases = Math.max(boss.phases ?? 3, boss.phase + 1);
  const pips = phases <= Math.min(8, Math.floor((region.width + 1) / 2)) ? phasePips(boss.phase, phases) : `PH ${hudNumber(boss.phase + 1)}/${hudNumber(phases)}`;
  ink([255, 190, 150], 220); paper(0); text(fitHudText(pips, region.width), center, region.top + 2);
}

// ---- Hurt direction + low-health vignette -------------------------------------------------------------------
/** Stroke glyph along an edge ellipse at angle a (0 = top, clockwise; grid y down). */
export function arcGlyph(a: number, ax: number, ay: number): string {
  const dx = Math.cos(a) * ax, dy = Math.sin(a) * ay;
  const slope = Math.abs(dy) / Math.max(1e-6, Math.abs(dx));
  return slope < 0.41 ? "-" : slope > 2.4 ? "|" : dx * dy > 0 ? "\\" : "/";
}
function drawHurtArcs(cols: number, rows: number, frame: CombatOverlayFrame): void {
  const p = frame.player;
  if (p.hurtFrom === null || !(p.hurtAge < 1.2)) return;
  const rel = wrapAngle(p.hurtFrom - frame.cam.yaw), k = 1 - p.hurtAge / 1.2;
  clearPaper();
  for (let ring = 0; ring < 2; ring++) {
    const ax = cols / 2 - 3 - ring, ay = rows / 2 - 2 - ring;
    for (let j = -6; j <= 6; j++) {
      const a = rel + j * 0.045;
      const fade = k * (1 - Math.abs(j) / 7) * (ring ? 0.6 : 1);
      if (fade <= 0.02) continue;
      ink(RED, 255 * fade);
      cell(arcGlyph(a, ax, ay), Math.round(Math.sin(a) * ax), Math.round(-Math.cos(a) * ay));
    }
  }
}
const CORRUPT = "#%&$@!?/\\<>*;:";
/** Low-health vignette strength 0..1 (starts under 35% health). */
export const vignetteStrength = (health: number, max: number): number => clamp01(1 - health / Math.max(1, max) / 0.35);
function drawVignette(cols: number, rows: number, p: PlayerCombatView, time: number): void {
  const s = vignetteStrength(p.health, p.maxHealth);
  if (s <= 0) return;
  // Elliptical: the corners corrupt first and most, the middle of each edge only lightly, the
  // centre of the view never. A slow heartbeat swell (~1.1 Hz, smooth) - never a flash.
  const beat = 0.72 + 0.28 * Math.pow(0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 1.1), 3);
  const hw = cols / 2, hh = rows / 2, r0 = 1.18 - 0.36 * s;
  const L = hudLayout(cols, rows);
  const x0 = L.left - 1, x1 = L.right + 1;
  clearPaper();
  canvas.printAlign("left", "top");
  const segmentOf = (y: number, from: number, to: number): string => {
    let out = "";
    for (let x = from; x <= to; x++) {
      const r = Math.hypot(x / hw, y / hh);
      const density = r <= r0 ? 0 : Math.min(1, (r - r0) / (1.45 - r0)) * (0.3 + 0.45 * s);
      // Each cell re-rolls about once a second, out of step with its neighbours: a slow crawl.
      const h = hash3(x, y, Math.floor(time * 1.2 + hash3(x, y, 7) * 3));
      out += h < density ? CORRUPT[Math.floor(hash3(x, y, 11 + Math.floor(time * 0.6)) * CORRUPT.length)] : " ";
    }
    return out;
  };
  for (let y = L.top - 1; y <= L.bottom + 1; y++) {
    const ny = y / hh;
    const edge = Math.abs(ny) >= r0 ? 0 : Math.floor(hw * Math.sqrt(r0 * r0 - ny * ny));
    ink(RED, (150 + 90 * s) * beat, 0.8 + 0.2 * Math.abs(ny));
    if (edge <= 0) { text(segmentOf(y, x0, x1), x0, y); continue; }
    if (-edge > x0) text(segmentOf(y, x0, -edge), x0, y);
    if (edge < x1) text(segmentOf(y, edge, x1), edge, y);
  }
}
