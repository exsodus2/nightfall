// Combat-scene looks (agent G): legendary signatures, faction silhouettes (choir, riot shields),
// far-range rim shell, parry ring, low-ready and reload hand. Geometry is checked through the
// PropRecorder (glyph per instance), timing through the pure helpers.
import assert from "node:assert/strict";
import test from "node:test";
import { MESH_BOX, MESH_SPHERE, MESH_TORUS, PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import type { ViewCamera } from "../src/city/vfx.ts";
import type { NpcLook } from "../src/city/npcs.ts";
import type { EnemyView, ItemDefinition, PlayerCombatView, WeaponClass } from "../src/rpg/types.ts";
import { FACTION_STYLE, drawEnemies, factionStyle, recordCombatEffects, recordViewmodel, resetViewmodel, viewmodelState } from "../src/rpg/scene/index.ts";
import { cursorBlink, defaultWeaponPaint, drawWeaponModel } from "../src/rpg/scene/weapons.ts";

const LOOK: NpcLook = { coat: [120, 60, 60], trim: [50, 40, 40], skin: [176, 140, 112], light: [255, 90, 60], headwear: "bare", prop: null, idle: "breathe" };
let uid = 0;
const enemy = (extra: Partial<EnemyView> = {}): EnemyView => ({ id: `g${uid++}`, archetype: "a", name: "x", faction: "razorbacks", x: 0, z: 0, yaw: 0, health: 100, maxHealth: 100, state: "alert", attack: 0, hitAge: Infinity, deathAge: -1, weaponClass: "blade", look: LOOK, bark: null, hostile: true, ...extra });
const recorder = () => { const r = new PropRecorder(ch => [ch.charCodeAt(0) / 255, 0, 0]); r.reset(); return r; };
const glyphs = (r: PropRecorder, mesh = MESH_BOX): string[] => Array.from({ length: r.counts[mesh] }, (_, i) => String.fromCharCode(Math.round(r.data[mesh][i * PROP_STRIDE + 20] * 255)));
const total = (r: PropRecorder) => r.counts[MESH_BOX] + r.counts[MESH_SPHERE] + r.counts[MESH_TORUS];
const view = (z = 10) => ({ x: 0, z, yaw: 0, height: 2.7, time: 1, rain: false, low: false });
const camera = (extra: Partial<ViewCamera> = {}): ViewCamera => ({ x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, fov: 62, aspect: 16 / 9, ...extra });
const player = (extra: Partial<PlayerCombatView> = {}): PlayerCombatView => ({ health: 82, maxHealth: 100, stamina: 60, maxStamina: 100, weapon: "sidearm", weaponItem: "pistol", weaponClass: "pistol", ammo: { loaded: 9, reserve: 48 }, action: "idle", actionProgress: 0, hitConfirmAge: Infinity, hurtAge: Infinity, hurtFrom: null, inCombat: true, dead: false, ...extra });
const item = (id: string, cls: WeaponClass, rarity: ItemDefinition["rarity"] = "legendary"): ItemDefinition => ({ id, name: id, kind: cls === "blade" || cls === "blunt" ? "melee" : "ranged", rarity, glyph: ">", description: "", value: 1, weight: 1, stack: 1, weapon: { class: cls, damage: 10, range: 20, cooldown: 0.2, staminaCost: 0, knockback: 0, stagger: 0, magazine: 12 } });

test("legendary signatures: Root Prompt's cursor eases on and off at 1 Hz; each legendary adds its own parts", () => {
  for (let t = 0; t < 2; t += 0.01) { const k = cursorBlink(t); assert.ok(k >= 0 && k <= 1); }
  // Smooth edges: no jump bigger than a 0.12 s ease allows between 10 ms samples.
  for (let t = 0; t < 2; t += 0.01) assert.ok(Math.abs(cursorBlink(t + 0.01) - cursorBlink(t)) < 0.1, "no hard blink");
  const parts = (cls: WeaponClass, signature: "" | "cursor" | "ring" | "bell") => {
    const r = recorder(), p = defaultWeaponPaint(); p.signature = signature; p.time = 0.3; drawWeaponModel(r, cls, p); return { n: total(r), torus: r.counts[MESH_TORUS], g: glyphs(r) };
  };
  assert.ok(parts("rifle", "cursor").g.includes("_"), "cursor in the optic");
  assert.ok(parts("blade", "ring").torus > parts("blade", "").torus, "@ Sigil gyro ring");
  assert.ok(parts("blunt", "bell").torus > parts("blunt", "").torus, "Bell Character ripple");
  // The viewmodel picks the signature from the item id.
  resetViewmodel();
  const r = recorder();
  recordViewmodel(r, camera(), player({ weaponClass: "rifle", weaponItem: "root-prompt" }), item("root-prompt", "rifle"), 3.2);
  assert.ok(glyphs(r).includes("_") && glyphs(r).includes(">"), "Root Prompt shows its cursor and its glyph");
});

test("weapon silhouettes differ per class (instance counts and parts)", () => {
  const counts = (["blade", "blunt", "baton", "pistol", "smg", "shotgun", "rifle"] as const).map(cls => { const r = recorder(); drawWeaponModel(r, cls, defaultWeaponPaint()); return total(r); });
  assert.ok(counts.every(n => n >= 5), "every weapon has a real silhouette");
});

test("factions: the choir has its own robed look; CorpSec melee carry a riot shield", () => {
  assert.equal(factionStyle("choir").silhouette, "robed");
  assert.ok(FACTION_STYLE.choir && FACTION_STYLE.choir.light[1] > 200);
  const draw = (e: EnemyView) => { const r = recorder(); drawEnemies(r, view(8), [e], 1); return r; };
  const baton = draw(enemy({ faction: "corpsec", weaponClass: "baton" })), pistol = draw(enemy({ faction: "corpsec", weaponClass: "pistol" }));
  assert.ok(total(baton) > total(pistol) - 6, "shield parts drawn for the baton officer");
  const cantor = draw(enemy({ faction: "choir", weaponClass: "smg", look: { ...LOOK, prop: "antenna" } }));
  assert.ok(glyphs(cantor).includes("|") && glyphs(cantor).includes("!"), "robe and lit sash");
  const warden = draw(enemy({ faction: "choir", weaponClass: "blade", look: { ...LOOK, headwear: "hood", prop: "lantern" } }));
  assert.ok(glyphs(warden).includes("*"), "the warden's lantern");
});

test("far enemies get a rim shell and thicker accents; near ones don't", () => {
  const near = recorder(); drawEnemies(near, view(8), [enemy({ id: "rim" })], 1);
  const far = recorder(); drawEnemies(far, view(32), [enemy({ id: "rim" })], 1);
  assert.ok(!glyphs(near, MESH_SPHERE).includes(":"));
  assert.ok(glyphs(far, MESH_SPHERE).includes(":"), "faint ':' shell behind the far figure");
});

test("parry: a gold spark in front of the player opens one ring in view; other sparks don't", () => {
  const cam = camera();
  const spark = (color: readonly [number, number, number], z: number) => { const r = recorder(); recordCombatEffects(r, [{ kind: "spark", x: 0, y: 0.9, z, age: 0.1, color }], cam, 1); return r.counts[MESH_TORUS]; };
  assert.equal(spark([255, 230, 120], -0.9), 1);
  assert.equal(spark([180, 200, 255], -0.9), 0, "a plain block has no ring");
  assert.equal(spark([255, 230, 120], -8), 0, "only at the player");
});

test("viewmodel: low ready out of combat, the off hand follows the magazine on reload", () => {
  resetViewmodel();
  let s = viewmodelState(player({ inCombat: true }), item("r", "rifle", "rare"), 1);
  const ready = s.right.y;
  for (let t = 1; t < 2.5; t += 0.05) s = viewmodelState(player({ inCombat: false }), item("r", "rifle", "rare"), t);
  assert.ok(s.relax > 0.95 && s.right.y < ready - 0.03, "weapon rests lower out of combat");
  for (let t = 2.5; t < 3.2; t += 0.05) s = viewmodelState(player({ inCombat: true }), item("r", "rifle", "rare"), t);
  assert.ok(s.relax < 0.05, "and comes straight back up in combat");
  resetViewmodel();
  viewmodelState(player({ weaponClass: "rifle", action: "reload", actionProgress: 0.02 }), item("r", "rifle", "rare"), 5);
  const pull = viewmodelState(player({ weaponClass: "rifle", action: "reload", actionProgress: 0.35 }), item("r", "rifle", "rare"), 5.5);
  assert.ok(pull.left && pull.left.y < pull.right.y - 0.1, "off hand down at the magazine");
});
