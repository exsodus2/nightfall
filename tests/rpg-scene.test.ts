import assert from "node:assert/strict";
import test from "node:test";
import { MESH_BOX, MESH_TORUS, PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import { project, type ViewCamera } from "../src/city/vfx.ts";
import type { NpcLook } from "../src/city/npcs.ts";
import type { CombatEffect, EnemyView, GroundLootView, ItemDefinition, PlayerCombatView, WeaponClass } from "../src/rpg/types.ts";
import {
  DEATH_TIME, ENEMY_RANGE, NUMBER_LIFE, PILLAR_HEIGHT, RAMP, RARITY_COLOR, TELEGRAPH_HZ, arcGlyph, asciiBar, attackPhase, bigDigits,
  bossBarText, crosshairGap, deathParticles, drawCombatOverlay, drawEnemies, drawGroundLoot, enemyMotion, enemyScreenBox, hitFlash,
  hitMarker, hpLine, hudLayout, numberGlyph, phasePips, recordCombatEffects, recordViewmodel, resetViewmodel, showEnemyLabel,
  strokeGlyph, telegraphPulse, viewmodelState, vignetteStrength, type OverlayCanvas,
} from "../src/rpg/scene/index.ts";

// ---- Fixtures --------------------------------------------------------------------------------------
const LOOK: NpcLook = { coat: [120, 60, 60], trim: [50, 40, 40], skin: [176, 140, 112], light: [255, 90, 60], headwear: "bare", prop: null, idle: "breathe" };
let uid = 0;
function enemy(extra: Partial<EnemyView> = {}): EnemyView {
  return { id: `e${uid++}`, archetype: "a", name: "Razorback Brawler", faction: "razorbacks", x: 0, z: 0, yaw: 0, health: 100, maxHealth: 100, state: "idle", attack: 0, hitAge: Infinity, deathAge: -1, weaponClass: "blade", look: LOOK, bark: null, hostile: true, ...extra };
}
const recorder = () => { const r = new PropRecorder(ch => [ch.charCodeAt(0) / 255, 0, 0]); r.reset(); return r; };
const glyphs = (r: PropRecorder, mesh = MESH_BOX): string[] => Array.from({ length: r.counts[mesh] }, (_, i) => String.fromCharCode(Math.round(r.data[mesh][i * PROP_STRIDE + 20] * 255)));
const origins = (r: PropRecorder, mesh = MESH_BOX): [number, number, number][] => Array.from({ length: r.counts[mesh] }, (_, i) => { const o = i * PROP_STRIDE; return [r.data[mesh][o], r.data[mesh][o + 1], r.data[mesh][o + 2]]; });
const view = (x = 0, z = 10, time = 1) => ({ x, z, yaw: 0, height: 2.7, time, rain: false, low: false });
const camera = (extra: Partial<ViewCamera> = {}): ViewCamera => ({ x: 0, y: 2.7, z: 0, yaw: 0, pitch: 0, fov: 62, aspect: 16 / 9, ...extra });
function player(extra: Partial<PlayerCombatView> = {}): PlayerCombatView {
  return { health: 82, maxHealth: 100, stamina: 60, maxStamina: 100, weapon: "sidearm", weaponItem: "pistol", weaponClass: "pistol", ammo: { loaded: 9, reserve: 48 }, action: "idle", actionProgress: 0, hitConfirmAge: Infinity, hurtAge: Infinity, hurtFrom: null, inCombat: true, dead: false, ...extra };
}
const item = (cls: WeaponClass, automatic = 0): ItemDefinition => ({ id: cls, name: `Test ${cls}`, kind: "ranged", rarity: "rare", glyph: "&", description: "", value: 1, weight: 1, stack: 1, weapon: { class: cls, damage: 10, range: 20, cooldown: 0.2, staminaCost: 0, knockback: 0, stagger: 0, magazine: 12, automatic } });

/** A text-grid OverlayCanvas: every drawn cell lands in `cells` keyed "gx,gy". */
class GridCanvas implements OverlayCanvas {
  readonly cells = new Map<string, { ch: string; color: number[]; alpha: number }>();
  private ch = " "; private color = [255, 255, 255]; private alpha = 255; private tx = 0; private ty = 0;
  private readonly stack: [number, number][] = [];
  private h: "left" | "center" | "right" = "left";
  push(): void { this.stack.push([this.tx, this.ty]); }
  pop(): void { const s = this.stack.pop(); if (s) [this.tx, this.ty] = s; }
  translate(x = 0, y = 0): void { this.tx += x; this.ty += y; }
  rect(): void { this.put(this.tx, this.ty, this.ch); }
  char(v: string | number): void { this.ch = String(v); }
  charColor(r: number, g: number, b: number, a = 255): void { this.color = [r, g, b]; this.alpha = a; }
  cellColor(): void { /* paper not tracked */ }
  printAlign(h: "left" | "center" | "right"): void { this.h = h; }
  print(text: string, x: number, y: number): void {
    const x0 = this.h === "center" ? -Math.floor(text.length / 2) : this.h === "right" ? -text.length : 0;
    for (let i = 0; i < text.length; i++) this.put(this.tx + x + x0 + i, this.ty + y, text[i]);
  }
  private put(x: number, y: number, ch: string): void { if (ch !== " ") this.cells.set(`${Math.round(x)},${Math.round(y)}`, { ch, color: this.color, alpha: this.alpha }); }
  text(): string { return [...this.cells.values()].map(c => c.ch).join(""); }
}
const overlay = (extra: Partial<Parameters<typeof drawCombatOverlay>[3]> = {}) => {
  const g = new GridCanvas();
  drawCombatOverlay(g, 160, 90, { cam: camera({ z: 10 }), effects: [], enemies: [], lockTarget: null, player: player(), boss: null, prompt: null, visible: () => true, time: 1, ...extra });
  return g;
};

// ---- Enemies ----------------------------------------------------------------------------------------
test("every faction records a bounded figure; far and long-dead enemies record nothing", () => {
  for (const faction of ["razorbacks", "chrome-saints", "corpsec", "ghosts", "street"]) {
    const r = recorder();
    drawEnemies(r, view(), [enemy({ faction, x: 1, z: 2, weaponClass: faction === "ghosts" ? "smg" : "pistol", state: "alert" })], 1);
    assert.ok(r.counts[MESH_BOX] > 15, `${faction}: a figure is made of many parts`);
    for (const [x, y, z] of origins(r)) {
      assert.ok(Math.hypot(x - 1, z - 2) < 2.2, `${faction}: parts stay near the body`);
      assert.ok(y <= 0.1 && y > -3.6, `${faction}: parts between the feet and above the head (y down)`);
    }
  }
  const far = recorder(); drawEnemies(far, view(), [enemy({ x: ENEMY_RANGE + 20 })], 1);
  assert.equal(far.counts[MESH_BOX] + far.counts[1] + far.counts[2], 0);
  const gone = recorder(); drawEnemies(gone, view(), [enemy({ deathAge: DEATH_TIME + 0.1, health: 0 })], 1);
  assert.equal(gone.counts[MESH_BOX] + gone.counts[1] + gone.counts[2], 0);
});

test("bosses are drawn bigger with an aura", () => {
  const small = recorder(), big = recorder();
  drawEnemies(small, view(), [enemy({ id: "s" })], 1);
  drawEnemies(big, view(), [enemy({ id: "b", boss: true, scale: 2 })], 1);
  const top = (r: PropRecorder) => Math.min(...origins(r).map(o => o[1]));
  assert.ok(top(big) < top(small) * 1.7, "the boss's head is much higher");
  assert.ok(big.counts[MESH_TORUS] >= small.counts[MESH_TORUS] + 3, "aura rings");
});

test("the attack telegraph shows a warning '!' only during the wind-up, pulsing slower than 3 Hz", () => {
  const e = enemy({ id: "tele", state: "attack", windup: true, attack: 0.5 });
  const r = recorder(); drawEnemies(r, view(), [e], 1);
  assert.ok(glyphs(r).includes("!"));
  const s = recorder(); drawEnemies(s, view(), [{ ...e, windup: false, attack: 0.2 }], 1.1);
  assert.ok(!glyphs(s).includes("!"));
  assert.ok(TELEGRAPH_HZ <= 3);
  for (let t = 0; t < 2; t += 0.01) assert.ok(telegraphPulse(t) >= 0.55 && telegraphPulse(t) <= 1);
});

test("hit flash holds then fades, and rapid hits keep it steady instead of strobing", () => {
  assert.equal(hitFlash(Infinity), 0);
  assert.equal(hitFlash(0), 1);
  assert.equal(hitFlash(0.07), 1);
  assert.ok(hitFlash(0.14) > 0.3 && hitFlash(0.14) < 0.7);
  assert.equal(hitFlash(0.25), 0);
  for (let t = 0; t < 1; t += 0.01) assert.ok(hitFlash(t % 0.1) >= 0.8, "10 hits/s never drops the flash");
  const r = recorder(); drawEnemies(r, view(), [enemy({ hitAge: 0.02 })], 1);
  const flashed = glyphs(r).filter(g => g === "@" || g === "#").length;
  assert.ok(flashed > glyphs(r).length * 0.7, "a fresh hit turns the figure's cells into dense glyphs");
});

test("death de-rasterise: characters scatter, fall and cool through the ramp, then vanish", () => {
  const early = deathParticles("x", 0.3, 1, 30).map(p => ({ ...p }));
  const late = deathParticles("x", 1.0, 1, 30).map(p => ({ ...p }));
  assert.ok(early.length > 10 && late.length > 10);
  for (const p of [...early, ...late]) { assert.ok(RAMP.includes(p.glyph)); assert.ok(p.y >= 0.04); }
  const avg = (ps: typeof early, f: (p: (typeof early)[number]) => number) => ps.reduce((s, p) => s + f(p), 0) / ps.length;
  assert.ok(avg(late, p => p.fade) < avg(early, p => p.fade), "they fade");
  assert.ok(avg(late, p => Math.hypot(p.x, p.z)) > avg(early, p => Math.hypot(p.x, p.z)), "they scatter");
  assert.ok(avg(late, p => RAMP.indexOf(p.glyph)) > avg(early, p => RAMP.indexOf(p.glyph)), "glyphs get sparser");
  assert.deepEqual(deathParticles("x", 0.7, 1, 30).map(p => p.x), deathParticles("x", 0.7, 1, 30).map(p => p.x), "deterministic");
  assert.equal(deathParticles("x", DEATH_TIME, 1, 30).length, 0);
});

test("gait follows real movement; attack phases follow the windup flag or the progress split", () => {
  const e = enemy({ id: "walker" });
  const a = enemyMotion(e, 10).stride;
  const b = enemyMotion({ ...e, x: 0.8 }, 10.5).stride;
  assert.ok(b - a > 2 && b - a < 4, "0.8 m is half a stride (~pi radians)");
  assert.equal(enemyMotion({ ...e, x: 0.8 }, 10.5).stride, b, "same clock leaves the gait");
  assert.equal(enemyMotion({ ...e, x: 300 }, 10.6).stride, b, "teleports don't animate");
  const f = enemy({ id: "fighter", state: "attack" });
  enemyMotion(f, 1);
  assert.equal(attackPhase({ ...f, windup: true, attack: 0.4 }).stage, "windup");
  assert.equal(attackPhase({ ...f, windup: false, attack: 0.1 }).stage, "strike");
  assert.equal(attackPhase({ ...f, windup: false, attack: 0.9 }).stage, "recover");
  assert.equal(attackPhase({ ...f, attack: 0.3 }).stage, "windup", "no flag: the first 55% is the wind-up");
  assert.equal(attackPhase({ ...f, attack: 0.6 }).stage, "strike");
  assert.equal(attackPhase({ ...f, state: "chase" }).stage, "none");
});

// ---- First-person weapon ----------------------------------------------------------------------------
test("the viewmodel sits in the lower right, stays fixed on screen as the camera turns, and barely sways", () => {
  resetViewmodel();
  const screenOf = (cam: ViewCamera) => {
    const r = recorder();
    recordViewmodel(r, cam, player(), item("pistol"), 5);
    const pts = origins(r).map(([x, y, z]) => project(cam, x, -y, z)).filter(p => p !== null);
    return { sx: pts.reduce((s, p) => s + p.sx, 0) / pts.length, sy: pts.reduce((s, p) => s + p.sy, 0) / pts.length, n: pts.length };
  };
  const level = screenOf(camera());
  assert.ok(level.n > 5 && level.sx > 0.2 && level.sy < -0.2, `lower right, got ${level.sx.toFixed(2)}, ${level.sy.toFixed(2)}`);
  const turned = screenOf(camera({ x: 40, z: -12, y: 9, yaw: 2.1, pitch: -0.35 }));
  // Float32 instance data: sub-pixel differences (1e-5 of the half-screen) are rounding, not drift.
  assert.ok(Math.abs(turned.sx - level.sx) < 1e-5 && Math.abs(turned.sy - level.sy) < 1e-5, "camera-attached");
  let minY = Infinity, maxY = -Infinity, minP = Infinity, maxP = -Infinity;
  for (let t = 0; t < 6; t += 0.05) { const s = viewmodelState(player(), item("pistol"), 100 + t).right; minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); minP = Math.min(minP, s.pitchUp); maxP = Math.max(maxP, s.pitchUp); }
  assert.ok(maxY - minY < 0.005 && maxP - minP < 0.7, "idle sway is a few millimetres / under a degree");
});

test("aiming centres the sights; muzzle flash: one per semi-auto shot, steady for automatic fire", () => {
  resetViewmodel();
  const ads = viewmodelState(player({ aim: 1, action: "aim" }), item("pistol"), 1);
  const s = viewmodelState(player({ aim: 1, action: "aim" }), item("pistol"), 1.5).right;
  const sight = project(camera(), s.x, 2.7 + s.y + 0.087 * 0.8, s.z); // pistol sight height at view scale 0.8
  assert.ok(ads && sight && Math.abs(sight.sx) < 0.03 && Math.abs(sight.sy) < 0.03, "rear sight on the crosshair");
  resetViewmodel();
  const semi = (p: number) => viewmodelState(player({ action: "fire", actionProgress: p }), item("pistol"), 2 + p).flash;
  assert.ok(semi(0.05) > 0.5 && semi(0.5) === 0);
  resetViewmodel();
  for (let p = 0; p <= 1; p += 0.1) assert.ok(viewmodelState(player({ weaponClass: "smg", action: "fire", actionProgress: p }), item("smg", 10), 3 + p).flash >= 0.85);
});

test("melee poses: combo steps differ, block and heavy wind-up move the weapon; fists when unarmed", () => {
  resetViewmodel();
  const melee = (extra: Partial<PlayerCombatView>, t: number) => ({ ...viewmodelState(player({ weaponClass: "blade", weaponItem: "blade", ammo: null, ...extra }), null, t).right });
  const idle = melee({}, 1);
  const strikes = [0, 1, 2].map(combo => { melee({ action: "idle" }, 2 + combo); melee({ action: "light", actionProgress: 0.4, combo }, 2.2 + combo); return melee({ action: "light", actionProgress: 0.4, combo }, 2.5 + combo); });
  assert.ok(Math.abs(strikes[0].x - strikes[1].x) > 0.2 || Math.abs(strikes[0].yawLeft - strikes[1].yawLeft) > 40);
  assert.ok(Math.abs(strikes[2].pitchUp - strikes[0].pitchUp) > 20, "the third hit is an overhead chop");
  melee({ action: "block" }, 6);
  const block = melee({ action: "block" }, 6.5); // after the 0.1 s transition blend
  assert.ok(Math.abs(block.yawLeft - idle.yawLeft) > 40, "block holds the blade across the view");
  const fists = viewmodelState(player({ weaponClass: "fists", weaponItem: null, ammo: null }), null, 8);
  assert.equal(fists.model, "fists"); assert.ok(fists.left, "two fists");
});

// ---- Loot, effects ---------------------------------------------------------------------------------
test("ground loot: rare and better get a rarity light pillar; credits show '$'", () => {
  const loot = (rarity: GroundLootView["rarity"], extra: Partial<GroundLootView> = {}): GroundLootView => ({ id: rarity, x: 0, z: 0, item: "x", name: rarity, glyph: "%", rarity, count: 1, age: 5, ...extra });
  const tallest = (l: GroundLootView) => { const r = recorder(); drawGroundLoot(r, view(), [l], 1); let h = 0; for (let i = 0; i < r.counts[MESH_BOX]; i++) h = Math.max(h, Math.abs(r.data[MESH_BOX][i * PROP_STRIDE + 7])); return { h, g: glyphs(r) }; };
  assert.ok(tallest(loot("common")).h < 1 && tallest(loot("uncommon")).h < 1);
  assert.ok(Math.abs(tallest(loot("rare")).h - PILLAR_HEIGHT[2]) < 0.01);
  assert.ok(tallest(loot("legendary")).h > tallest(loot("epic")).h);
  assert.ok(tallest(loot("common", { item: "credits", glyph: "$" })).g.includes("$"));
  for (const c of Object.values(RARITY_COLOR)) assert.equal(c.length, 3);
});

test("effects: tracers run along their line, telegraphs draw rings, unknown kinds are ignored", () => {
  const cam = camera({ z: 10 });
  const r = recorder();
  recordCombatEffects(r, [{ kind: "tracer", from: { x: -5, y: 1.5, z: 0 }, to: { x: 5, y: 1.5, z: 0 }, age: 0.1, enemy: true }], cam, 1);
  assert.ok(r.counts[MESH_BOX] > 0);
  for (let i = 0; i < r.counts[MESH_BOX]; i++) { const o = i * PROP_STRIDE, d = r.data[MESH_BOX]; assert.ok(Math.abs(d[o + 9]) > 0.5 && Math.abs(d[o + 10]) < 1e-6 && Math.abs(d[o + 11]) < 1e-6, "segment z axis along +-x"); }
  assert.ok(glyphs(r).every(g => g === "-"), "a level line across the view draws '-'");
  const t = recorder();
  recordCombatEffects(t, [{ kind: "telegraph", shape: "circle", x: 0, z: 0, yaw: 0, radius: 4, width: 0, arc: 0, progress: 0.5, age: 0.3, enemy: "b" }], cam, 1);
  assert.ok(t.counts[MESH_TORUS] >= 2, "outline + progress ring");
  const u = recorder();
  const unknown = { kind: "lightning", x: 0, y: 0, z: 0, age: 0 } as unknown as CombatEffect;
  recordCombatEffects(u, [unknown, { kind: "number", x: 0, y: 1, z: 0, value: 5, critical: false, age: 0.1, toPlayer: false }], cam, 1);
  assert.equal(u.counts[0] + u.counts[1] + u.counts[2], 0);
  assert.equal(strokeGlyph(cam, 0, 0, 0, 0, 3, 0), "|");
});

// ---- HUD ------------------------------------------------------------------------------------------------
test("damage numbers hold their digits, then dissolve through the ramp in order", () => {
  assert.equal(numberGlyph(0.2, 0, "7"), "7");
  const seen: string[] = [];
  for (let a = 0; a < NUMBER_LIFE; a += 0.005) { const g = numberGlyph(a, 0, "7"); if (g && g !== "7" && seen[seen.length - 1] !== g) seen.push(g); }
  assert.deepEqual(seen, [...RAMP]);
  assert.equal(numberGlyph(NUMBER_LIFE, 0, "7"), null);
  assert.ok(bigDigits("88").length === 26, "3x5 digits");
  const g = overlay({ effects: [{ kind: "number", x: 0, y: 1.5, z: 0, value: 88, critical: true, age: 0.1, toPlayer: false }] });
  assert.ok([...g.cells.values()].filter(c => c.ch === "8").length >= 20, "a crit is printed big");
});

test("bars, layout and HUD strings", () => {
  assert.equal(asciiBar(82, 100, 10), "[########--]");
  assert.equal(asciiBar(1, 100, 10), "[#---------]", "a sliver of health still shows");
  assert.equal(asciiBar(99, 100, 10), "[#########-]", "never full until full");
  assert.equal(hpLine(82, 100, 10), "HP [########--] 82/100");
  assert.equal(bossBarText(50, 70, 100, 10), "[#####==---]");
  assert.equal(phasePips(1, 3), "* @ o");
  const L = hudLayout(160, 90);
  assert.deepEqual(L, { left: -79, right: 78, top: -44, bottom: 43 });
  assert.ok(crosshairGap(0.01, 62, 90) <= crosshairGap(0.05, 62, 90));
  assert.equal(hitMarker(0.05), 1); assert.equal(hitMarker(0.4), 0);
  assert.equal(vignetteStrength(50, 100), 0); assert.ok(vignetteStrength(10, 100) > 0.6);
  assert.equal(arcGlyph(0, 10, 10), "-"); assert.equal(arcGlyph(Math.PI / 2, 10, 10), "|");
});

test("overlay: HP / ammo / boss / prompt drawn inside the grid in printable ASCII", () => {
  const g = overlay({ boss: { name: "Mother Rust", title: "Queen of Scrap", health: 500, maxHealth: 1000, phase: 1, phases: 3 }, prompt: "Open crate", weapon: item("pistol") });
  const all = g.text();
  assert.ok(/^[ -~]*$/.test(all), "printable ASCII only");
  for (const key of g.cells.keys()) { const [x, y] = key.split(",").map(Number); assert.ok(x >= -80 && x < 80 && y >= -45 && y < 45, `cell ${key} on the grid`); }
  const row = (y: number) => [...g.cells.entries()].filter(([k]) => Number(k.split(",")[1]) === y).sort((a, b) => Number(a[0].split(",")[0]) - Number(b[0].split(",")[0])).map(([, c]) => c.ch).join("");
  assert.match(row(42), /^HP\[#+-+\]82\/100/);
  assert.match(row(43), /9\/48$/);
  assert.match(row(-44), /MOTHERRUST-QueenofScrap/);
  assert.ok(all.includes("[E]Opencrate"));
});

test("overlay: labels when hurt/near/locked, lock brackets frame the target, hurt arcs on the damage side", () => {
  const cam = camera({ z: 10 });
  const hurt = enemy({ id: "lab", health: 40, x: 0, z: 0 });
  assert.ok(showEnemyLabel(hurt, 10, false));
  assert.ok(!showEnemyLabel(enemy(), 20, false), "healthy and not near: no bar");
  assert.ok(showEnemyLabel(enemy(), 70, true), "locked shows further");
  const g = overlay({ enemies: [hurt], lockTarget: "lab" });
  assert.ok(g.text().includes("RazorbackBrawler"));
  const box = enemyScreenBox(cam, 160, 90, hurt);
  assert.ok(box && g.cells.get(`${box.x0},${Math.round((box.y0 + box.y1) / 2)}`)?.ch === "[" && g.cells.get(`${box.x1},${Math.round((box.y0 + box.y1) / 2)}`)?.ch === "]");
  const right = overlay({ player: player({ hurtAge: 0.1, hurtFrom: Math.PI / 2 }) });
  const red = [...right.cells.entries()].filter(([, c]) => c.color[0] > 200 && c.color[1] < 100);
  assert.ok(red.length > 5 && red.every(([k]) => Number(k.split(",")[0]) > 40), "damage from the right lights the right edge");
});
