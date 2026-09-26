// Standalone preview of the RPG scene drawers (not part of the app): records enemies / viewmodel /
// loot / effects into a PropRecorder, rasterises the instances with a tiny software z-buffer into a
// character grid (one cell = one glyph, like textmode), and renders the combat HUD through a text
// OverlayCanvas. Terminal output by default; --html writes artifacts/rpg-preview.html with colours.
//   node --experimental-strip-types scripts/rpg-scene-preview.ts [enemies|attack|death|viewmodel|loot|effects|hud|all] [--html]
import { mkdirSync, writeFileSync } from "node:fs";
import { MESH_BOX, MESH_SPHERE, MESH_TORUS, PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import { project, type ViewCamera } from "../src/city/vfx.ts";
import type { NpcLook } from "../src/city/npcs.ts";
import type { CombatEffect, EnemyView, GroundLootView, ItemDefinition, PlayerCombatView, WeaponClass } from "../src/rpg/types.ts";
import {
  drawCombatOverlay, drawEnemies, drawGroundLoot, drawInteractables, recordCombatEffects, recordViewmodel, resetViewmodel,
  type OverlayCanvas,
} from "../src/rpg/scene/index.ts";

const COLS = 160, ROWS = 45; // terminal cells are ~1:2, so 160 x 45 shows a 16:9 view
type Cell = { ch: string; color: [number, number, number]; depth: number };
class Grid {
  readonly cells: Cell[];
  readonly cols: number;
  readonly rows: number;
  constructor(cols: number, rows: number) { this.cols = cols; this.rows = rows; this.cells = Array.from({ length: cols * rows }, () => ({ ch: " ", color: [0, 0, 0], depth: Infinity })); }
  put(x: number, y: number, ch: string, color: [number, number, number], depth = 0): void {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const c = this.cells[y * this.cols + x];
    if (depth <= c.depth) { c.ch = ch; c.color = color; c.depth = depth; }
  }
  text(): string { let s = ""; for (let y = 0; y < this.rows; y++) { for (let x = 0; x < this.cols; x++) s += this.cells[y * this.cols + x].ch; s += "\n"; } return s; }
  html(): string {
    let s = "";
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) { const c = this.cells[y * this.cols + x]; s += c.ch === " " ? " " : `<span style="color:rgb(${c.color.map(v => Math.round(v)).join(",")})">${c.ch.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")}</span>`; }
      s += "\n";
    }
    return s;
  }
}

// ---- Software rasteriser for PropRecorder instances ----------------------------------------------
const UNIT_BOX: number[][][] = (() => {
  const f = (a: number[], b: number[], c: number[], d: number[]) => [[a, b, c], [a, c, d]];
  return [
    ...f([-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]), ...f([.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]),
    ...f([-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]), ...f([.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]),
    ...f([-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]), ...f([-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]),
  ];
})();
function sphereTris(seg = 10, rings = 6): number[][][] {
  const at = (i: number, j: number) => { const u = i / seg * Math.PI * 2, v = j / rings * Math.PI; return [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)]; };
  const out: number[][][] = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { out.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)], [at(i, j), at(i + 1, j + 1), at(i, j + 1)]); }
  return out;
}
const UNIT_SPHERE = sphereTris();

function rasterise(grid: Grid, rec: PropRecorder, cam: ViewCamera): void {
  for (const mesh of [MESH_BOX, MESH_SPHERE, MESH_TORUS]) {
    const data = rec.data[mesh];
    for (let n = 0; n < rec.counts[mesh]; n++) {
      const o = n * PROP_STRIDE;
      const ch = String.fromCharCode(Math.round(data[o + 20] * 255));
      const color: [number, number, number] = [data[o + 12] * 255, data[o + 13] * 255, data[o + 14] * 255];
      let tris: number[][][];
      if (mesh === MESH_TORUS) {
        const R = data[o + 24], tube = data[o + 25], seg = 16, sides = 4, at = (i: number, j: number) => {
          const u = i / seg * Math.PI * 2, v = j / sides * Math.PI * 2, ring = R + tube * Math.cos(v);
          return [ring * Math.cos(u), tube * Math.sin(v), ring * Math.sin(u)];
        };
        tris = [];
        for (let j = 0; j < sides; j++) for (let i = 0; i < seg; i++) tris.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)], [at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
      } else tris = mesh === MESH_BOX ? UNIT_BOX : UNIT_SPHERE;
      for (const tri of tris) {
        const pts = tri.map(l => {
          const x = data[o] + data[o + 3] * l[0] + data[o + 6] * l[1] + data[o + 9] * l[2];
          const y = data[o + 1] + data[o + 4] * l[0] + data[o + 7] * l[1] + data[o + 10] * l[2];
          const z = data[o + 2] + data[o + 5] * l[0] + data[o + 8] * l[1] + data[o + 11] * l[2];
          const p = project(cam, x, -y, z); // recorder space is textmode (y down)
          return p ? { x: (p.sx + 1) / 2 * grid.cols, y: (1 - p.sy) / 2 * grid.rows, d: p.depth } : null;
        });
        if (pts.some(p => !p)) continue;
        const [a, b, c] = pts as { x: number; y: number; d: number }[];
        const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
        if (Math.abs(area) < 1e-9) {
          // Degenerate on screen (thin bar seen edge-on): splat its centre so thin parts still show.
          grid.put(Math.floor((a.x + b.x + c.x) / 3), Math.floor((a.y + b.y + c.y) / 3), ch, color, (a.d + b.d + c.d) / 3);
          continue;
        }
        const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), x1 = Math.min(grid.cols - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
        const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), y1 = Math.min(grid.rows - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
        let hit = false;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) / area, w1 = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) / area, w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          hit = true; grid.put(x, y, ch, color, w0 * a.d + w1 * b.d + w2 * c.d);
        }
        if (!hit && x1 - x0 <= 1 && y1 - y0 <= 1) grid.put(Math.floor((a.x + b.x + c.x) / 3), Math.floor((a.y + b.y + c.y) / 3), ch, color, (a.d + b.d + c.d) / 3);
      }
    }
  }
}

// ---- Text overlay canvas (ortho, origin at the centre) ---------------------------------------------
class TextOverlay implements OverlayCanvas {
  private ch = " "; private fg: [number, number, number] = [255, 255, 255]; private alpha = 255;
  private tx = 0; private ty = 0; private readonly stack: [number, number][] = [];
  private h: "left" | "center" | "right" = "left"; private v: "top" | "middle" | "bottom" = "top";
  private readonly grid: Grid;
  constructor(grid: Grid) { this.grid = grid; }
  push(): void { this.stack.push([this.tx, this.ty]); }
  pop(): void { const s = this.stack.pop(); if (s) [this.tx, this.ty] = s; }
  translate(x = 0, y = 0): void { this.tx += x; this.ty += y; }
  rect(): void { this.plot(this.tx, this.ty, this.ch); }
  char(value: string | number): void { this.ch = String(value); }
  charColor(r: number, g: number, b: number, a = 255): void { this.fg = [r, g, b]; this.alpha = a; }
  cellColor(): void { /* paper is not previewed */ }
  printAlign(h: "left" | "center" | "right", v: "top" | "middle" | "bottom" = "top"): void { this.h = h; this.v = v; }
  print(text: string, x: number, y: number): void {
    const x0 = this.h === "center" ? -Math.floor(text.length / 2) : this.h === "right" ? -text.length : 0;
    for (let i = 0; i < text.length; i++) this.plot(this.tx + x + x0 + i, this.ty + y, text[i]);
  }
  private plot(x: number, y: number, ch: string): void {
    if (ch === " " || this.alpha < 20) return;
    this.grid.put(Math.round(x) + Math.floor(this.grid.cols / 2), Math.round(y) + Math.floor(this.grid.rows / 2), ch, this.fg, -1);
  }
}

// ---- Fixtures ---------------------------------------------------------------------------------------
const LOOK: NpcLook = { coat: [120, 60, 60], trim: [50, 40, 40], skin: [176, 140, 112], light: [255, 90, 60], headwear: "bare", prop: null, idle: "breathe" };
function enemy(id: string, faction: string, x: number, z: number, cls: WeaponClass, extra: Partial<EnemyView> = {}): EnemyView {
  return { id, archetype: id, name: id.toUpperCase(), faction, x, z, yaw: 0, health: 60, maxHealth: 100, state: "alert", attack: 0, hitAge: Infinity, deathAge: -1, weaponClass: cls, look: LOOK, bark: null, hostile: true, ...extra };
}
const cam = (x = 0, y = 2.7, z = 8, yaw = 0, pitch = 0.04): ViewCamera => ({ x, y, z, yaw, pitch, fov: 62, aspect: COLS / ROWS / 2 });
const view = (c: ViewCamera, time: number) => ({ x: c.x, z: c.z, yaw: c.yaw, height: c.y, time, rain: false, low: false });
const player = (extra: Partial<PlayerCombatView> = {}): PlayerCombatView => ({
  health: 82, maxHealth: 100, stamina: 60, maxStamina: 100, weapon: "sidearm", weaponItem: "pistol", weaponClass: "pistol", ammo: { loaded: 9, reserve: 48 },
  action: "idle", actionProgress: 0, hitConfirmAge: Infinity, hurtAge: Infinity, hurtFrom: null, inCombat: true, dead: false, ...extra,
});
const ITEM = (cls: WeaponClass, rarity: ItemDefinition["rarity"]): ItemDefinition => ({ id: cls, name: `Test ${cls}`, kind: cls === "blade" || cls === "blunt" || cls === "baton" ? "melee" : "ranged", rarity, glyph: "&", description: "", value: 1, weight: 1, stack: 1, weapon: { class: cls, damage: 10, range: 2, cooldown: 0.5, staminaCost: 5, knockback: 0, stagger: 0, magazine: 12, automatic: cls === "smg" ? 10 : 0 } });

function frame3d(title: string, c: ViewCamera, draw: (rec: PropRecorder) => void): Grid {
  const rec = new PropRecorder(ch => [ch.charCodeAt(0) / 255, 0, 0]);
  rec.reset(); draw(rec);
  const grid = new Grid(COLS, ROWS);
  rasterise(grid, rec, c);
  out.push({ title: `${title}  (${rec.counts.join("/")} box/ellipsoid/torus instances)`, grid });
  return grid;
}
const out: { title: string; grid: Grid }[] = [];

const scenes: Record<string, () => void> = {
  enemies() {
    const c = cam(0, 2.2, 7.5);
    frame3d("Factions: Razorback blade, Chrome Saint rifle, CorpSec baton, Ghost smg (alert), plain pistol", c, rec => drawEnemies(rec, view(c, 1), [
      enemy("razor", "razorbacks", -4.2, 0, "blade"), enemy("saint", "chrome-saints", -1.8, 0, "rifle"),
      enemy("corp", "corpsec", 0.6, 0, "baton"), enemy("ghost", "ghosts", 3, 0, "smg"), enemy("thug", "street", 5.2, 0, "pistol", { state: "idle" }),
    ], 1));
    const side = cam(-7, 2.2, 0, Math.PI / 2 * -1 + Math.PI, 0.04);
    const s2 = { ...side, yaw: Math.PI / 2 };
    frame3d("Side view (from -x): aiming pose, weapons in hand", { ...s2, x: -7, z: 0 }, rec => drawEnemies(rec, view({ ...s2, x: -7, z: 0 }, 1), [
      enemy("saint", "chrome-saints", 0, -2.5, "rifle"), enemy("razor", "razorbacks", 0, 0.5, "blade"), enemy("ghost", "ghosts", 0, 3, "shotgun"),
    ], 1));
    frame3d("Boss (scale 1.8, aura) + hit flash on the left figure", cam(0, 2.6, 9), rec => drawEnemies(rec, view(cam(0, 2.6, 9), 2), [
      enemy("boss", "razorbacks", 1.5, 0, "blunt", { boss: true, scale: 1.8 }), enemy("hurt", "corpsec", -3, 0, "pistol", { hitAge: 0.03 }),
    ], 2));
  },
  attack() {
    const c = { ...cam(-6, 2.2, 0), yaw: Math.PI / 2 };
    for (const [label, e] of [["wind-up 0.3 (telegraph !)", { windup: true, attack: 0.3 }], ["wind-up 1.0", { windup: true, attack: 1 }], ["strike", { windup: false, attack: 0.15 }], ["recover", { windup: false, attack: 0.8 }]] as const) {
      frame3d(`Razorback blade attack: ${label}`, c, rec => drawEnemies(rec, view(c, 3), [enemy("atk", "razorbacks", 0, 0, "blade", { state: "attack", yaw: -Math.PI / 2, ...e })], 3));
    }
  },
  death() {
    const c = cam(0, 2.2, 6);
    for (const age of [0.12, 0.3, 0.6, 1.0]) frame3d(`Death de-rasterise at ${age}s`, c, rec => drawEnemies(rec, view(c, 5), [enemy(`dead`, "chrome-saints", 0, 0, "rifle", { deathAge: age, health: 0 })], 5));
  },
  viewmodel() {
    const c = cam(0, 2.7, 0, 0, 0);
    const cases: [string, WeaponClass | "fists", Partial<PlayerCombatView>][] = [
      ["pistol idle (rare)", "pistol", {}], ["pistol ADS", "pistol", { aim: 1, action: "aim" }], ["smg firing", "smg", { action: "fire", actionProgress: 0.1 }],
      ["shotgun reload 0.3", "shotgun", { action: "reload", actionProgress: 0.3 }], ["rifle idle (legendary)", "rifle", {}],
      ["blade idle (epic)", "blade", {}], ["blade light #1 strike", "blade", { action: "light", actionProgress: 0.35, combo: 0 }], ["blade overhead #3", "blade", { action: "light", actionProgress: 0.25, combo: 2 }],
      ["blade block", "blade", { action: "block" }], ["blunt heavy wind-up", "blunt", { action: "heavy", actionProgress: 0.45 }], ["baton idle", "baton", {}],
      ["fists idle", "fists", { weaponClass: "fists" }], ["fists jab", "fists", { weaponClass: "fists", action: "light", actionProgress: 0.3, combo: 0 }],
    ];
    for (const [label, cls, extra] of cases) {
      resetViewmodel();
      const item = cls === "fists" ? null : ITEM(cls, label.includes("legendary") ? "legendary" : label.includes("epic") ? "epic" : "rare");
      const p = player({ weaponClass: cls, weaponItem: item?.id ?? null, ammo: cls === "fists" || !item || item.kind === "melee" ? null : { loaded: 9, reserve: 48 }, ...extra });
      frame3d(`Viewmodel: ${label}`, c, rec => { recordViewmodel(rec, c, p, item, 10); recordViewmodel(rec, c, p, item, 10.5); rec.reset(); recordViewmodel(rec, c, p, item, 10.5); });
    }
  },
  loot() {
    const c = cam(0, 2.7, 9, 0, -0.1);
    const loot: GroundLootView[] = (["common", "uncommon", "rare", "epic", "legendary"] as const).map((rarity, i) => ({ id: `l${i}`, x: -4 + i * 2, z: 0, item: `i${i}`, name: rarity, glyph: "%", rarity, count: 1, age: 3 }));
    loot.push({ id: "cr", x: 5, z: 1.5, item: "credits", name: "120 cr", glyph: "$", rarity: "common", count: 120, age: 3 });
    frame3d("Loot: common..legendary + credits (pillars for rare+)", c, rec => { drawGroundLoot(rec, view(c, 4), loot, 4); drawInteractables(rec, view(c, 4), [{ id: "term", label: "Terminal", x: -6, z: 2, glyph: ">" }], 4); });
  },
  effects() {
    const c = cam(0, 5, 12, 0, 0.3);
    const fx: CombatEffect[] = [
      { kind: "telegraph", shape: "circle", x: -4, z: 0, yaw: 0, radius: 3, width: 0, arc: 0, progress: 0.6, age: 0.5, enemy: "boss" },
      { kind: "telegraph", shape: "arc", x: 3.5, z: 0, yaw: 0, radius: 4, width: 0, arc: 0.8, progress: 0.4, age: 0.5, enemy: "boss" },
      { kind: "telegraph", shape: "line", x: 0, z: 4, yaw: Math.PI, radius: 5, width: 1.6, arc: 0, progress: 0.7, age: 0.5, enemy: "boss" },
      { kind: "slash", x: 0, y: 1.5, z: -2, yaw: Math.PI, age: 0.09, heavy: false },
      { kind: "tracer", from: { x: -6, y: 1.5, z: -3 }, to: { x: 6, y: 1.8, z: -4 }, age: 0.06, enemy: true },
      { kind: "projectile", id: 1, x: 2, y: 1.4, z: 3, vx: -3, vz: 1, radius: 0.35, age: 0.5, enemy: true },
      { kind: "spark", x: -1, y: 1.2, z: 1, age: 0.1, color: [255, 180, 80] },
    ];
    frame3d("Effects: telegraph circle / arc / line, slash, tracer, projectile, sparks", c, rec => recordCombatEffects(rec, fx, c, 3, ROWS));
  },
  hud() {
    const c = cam(0, 2.7, 8, 0, 0.02);
    const grid = new Grid(COLS, ROWS);
    const enemies = [enemy("razor", "razorbacks", -2, 0, "blade", { name: "Razorback Brawler", bark: "Fresh meat!" }), enemy("corp", "corpsec", 2.5, -1, "pistol", { name: "CorpSec Officer", locked: true, health: 30 })];
    const effects: CombatEffect[] = [
      { kind: "number", x: -2, y: 2, z: 0, value: 24, critical: false, age: 0.2, toPlayer: false },
      { kind: "number", x: 2.5, y: 2.2, z: -1, value: 88, critical: true, age: 0.3, toPlayer: false },
      { kind: "number", x: 0, y: 2, z: 8, value: 12, critical: false, age: 0.3, toPlayer: true },
    ];
    drawCombatOverlay(new TextOverlay(grid), COLS, ROWS, {
      cam: c, effects, enemies, lockTarget: "corp", player: player({ health: 22, hurtAge: 0.3, hurtFrom: Math.PI / 2, hitConfirmAge: 0.05, spread: 0.03 }),
      boss: { name: "Mother Rust", title: "Queen of the Scrapyard", health: 620, maxHealth: 1000, phase: 1, phases: 3 }, prompt: "Open crate", visible: () => true,
      weapon: ITEM("pistol", "rare"), time: 2.3,
    });
    out.push({ title: "HUD overlay (low health vignette, hurt from the right, lock on CorpSec, crit, boss bar)", grid });
  },
};

const args = process.argv.slice(2);
const which = args.find(a => !a.startsWith("--")) ?? "all";
for (const [name, run] of Object.entries(scenes)) if (which === "all" || which === name) run();
if (args.includes("--html")) {
  mkdirSync("artifacts", { recursive: true });
  writeFileSync("artifacts/rpg-preview.html", `<!doctype html><meta charset="utf-8"><title>RPG scene preview</title><body style="background:#05080c;color:#ccc;font:12px/1.0 monospace">${out.map(o => `<h3 style="font:13px sans-serif;color:#9cf">${o.title}</h3><pre style="line-height:1.0;letter-spacing:0">${o.grid.html()}</pre>`).join("")}</body>`);
  console.log(`wrote artifacts/rpg-preview.html (${out.length} frames)`);
} else for (const o of out) console.log(`== ${o.title}\n${o.grid.text()}`);
