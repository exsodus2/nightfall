import assert from "node:assert/strict";
import test from "node:test";
import { combatHudLayout, drawCombatOverlay, fitHudText, hudNumber, toCell, type CombatHudLayout, type CombatOverlayFrame, type HudRegion, type HudViewport, type OverlayCanvas } from "../src/rpg/scene/index.ts";
import { combatLabelRow } from "../src/rpg/scene/hud-layout.ts";
import type { EnemyView, ItemDefinition, PlayerCombatView } from "../src/rpg/types.ts";

interface Box { left: number; top: number; width: number; height: number }
const overlaps = (first: Box, second: Box): boolean => first.left < second.left + second.width && second.left < first.left + first.width && first.top < second.top + second.height && second.top < first.top + first.height;
const grid = (viewport: HudViewport) => ({ columns: Math.floor(viewport.width / 12), rows: Math.floor(viewport.height / 12) });
function pixels(region: HudRegion, viewport: HudViewport): Box {
  const { columns, rows } = grid(viewport);
  return { left: (region.left + Math.floor(columns / 2)) * viewport.width / columns, top: (region.top + Math.floor(rows / 2)) * viewport.height / rows, width: region.width * viewport.width / columns, height: region.height * viewport.height / rows };
}
const viewports: readonly HudViewport[] = [
  { width: 1440, height: 960, touch: false },
  { width: 1920, height: 1080, touch: false },
  { width: 1024, height: 600, touch: false },
  { width: 800, height: 400, touch: false },
  { width: 393, height: 852, touch: true },
  { width: 320, height: 568, touch: true },
  { width: 852, height: 393, touch: true },
  { width: 568, height: 320, touch: true },
  { width: 480, height: 320, touch: true },
  { width: 480, height: 375, touch: true },
  { width: 640, height: 360, touch: true },
  { width: 700, height: 390, touch: true },
  { width: 430, height: 932, touch: true, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
  { width: 932, height: 430, touch: true, insets: { top: 0, bottom: 21, left: 59, right: 59 } },
];

test("combat HUD regions remain deterministic, bounded and separate across desktop and phone viewports", () => {
  for (const viewport of viewports) {
    const { columns, rows } = grid(viewport), layout = combatHudLayout(columns, rows, viewport);
    assert.deepEqual(layout, combatHudLayout(columns, rows, viewport));
    const regions = Object.values(layout);
    for (const region of regions) {
      assert.ok(Object.values(region).every(Number.isInteger));
      assert.ok(region.width > 0 && region.height > 0);
      assert.ok(region.left >= -Math.floor(columns / 2) && region.left + region.width <= Math.ceil(columns / 2));
      assert.ok(region.top >= -Math.floor(rows / 2) && region.top + region.height <= Math.ceil(rows / 2));
      const box = pixels(region, viewport);
      assert.ok(box.left >= (viewport.insets?.left ?? 0) && box.left + box.width <= viewport.width - (viewport.insets?.right ?? 0));
      assert.ok(box.top >= (viewport.insets?.top ?? 0) && box.top + box.height <= viewport.height - (viewport.insets?.bottom ?? 0));
    }
    assert.ok(!overlaps(layout.vitals, layout.weapon), JSON.stringify({ viewport, layout }));
    assert.ok(!overlaps(layout.vitals, layout.boss));
    assert.ok(!overlaps(layout.weapon, layout.boss));
  }
});

test("desktop rail clears footer, walking hints and minimap while the boss clears header and quest panel", () => {
  for (const viewport of viewports.filter(viewport => !viewport.touch)) {
    const { columns, rows } = grid(viewport), layout = combatHudLayout(columns, rows, viewport);
    const footer = { left: 0, top: viewport.height - (viewport.height <= 550 ? 32 : 42), width: viewport.width, height: 42 };
    const hint = { left: 24, top: viewport.height - 90, width: 310, height: 18 };
    const map = { left: viewport.width - 240, top: viewport.height - 330, width: 220, height: viewport.height <= 550 ? 262 : 244 };
    for (const region of [layout.vitals, layout.weapon]) {
      const box = pixels(region, viewport);
      assert.ok(!overlaps(box, footer), JSON.stringify({ viewport, box, footer }));
      assert.ok(!overlaps(box, hint));
      assert.ok(!overlaps(box, map));
    }
    const boss = pixels(layout.boss, viewport);
    assert.ok(boss.top >= (viewport.height <= 550 ? 90 : 120));
    assert.ok(boss.left >= 340, "boss title stays to the right of the quest column");
  }
});

test("mobile panels clear the fixed joystick, thumb buttons, minimap and top controls", () => {
  for (const viewport of viewports.filter(viewport => viewport.touch)) {
    const { columns, rows } = grid(viewport), layout = combatHudLayout(columns, rows, viewport);
    const inset = { left: 0, right: 0, top: 0, bottom: 0, ...viewport.insets };
    const portrait = viewport.height > viewport.width;
    const controlsWidth = Math.min(360, viewport.width * (portrait ? 0.5 : 0.6));
    const buttons = { left: viewport.width - inset.right - 16 - controlsWidth, top: viewport.height - inset.bottom - 150, width: controlsWidth, height: 140 };
    const joystick = { left: inset.left + 16, top: viewport.height - inset.bottom - 150, width: 146, height: 138 };
    const map = { left: viewport.width - inset.right - 116, top: inset.top + 64, width: 104, height: 142 };
    const topButtons = { left: viewport.width - inset.right - 110, top: inset.top + 10, width: 100, height: 44 };
    for (const region of Object.values(layout)) {
      const box = pixels(region, viewport);
      for (const reserved of [buttons, joystick, map, topButtons]) assert.ok(!overlaps(box, reserved), JSON.stringify({ viewport, box, reserved }));
    }
  }
});

interface PrintedText { text: string; left: number; top: number; width: number; height: number }
class TextRecorder implements OverlayCanvas {
  readonly prints: PrintedText[] = [];
  private alignment: "left" | "center" | "right" = "left";
  push(): void {}
  pop(): void {}
  translate(): void {}
  rect(): void {}
  char(): void {}
  charColor(): void {}
  cellColor(): void {}
  printAlign(alignment: "left" | "center" | "right"): void { this.alignment = alignment; }
  print(text: string, x: number, y: number): void {
    const offset = this.alignment === "right" ? text.length : this.alignment === "center" ? Math.floor(text.length / 2) : 0;
    this.prints.push({ text, left: x - offset, top: y, width: text.length, height: 1 });
  }
}
const player: PlayerCombatView = { health: 82, maxHealth: 100, stamina: 60, maxStamina: 100, shield: 15, weapon: "sidearm", weaponItem: "pistol", weaponClass: "pistol", ammo: { loaded: 9, reserve: 48 }, action: "idle", actionProgress: 0, hitConfirmAge: Infinity, hurtAge: Infinity, hurtFrom: null, inCombat: true, dead: false };
const weapon: ItemDefinition = { id: "pistol", name: "Prototype " + "heavy-duty-".repeat(50), kind: "ranged", rarity: "rare", glyph: "&", description: "", value: 1, weight: 1, stack: 1 };
const within = (text: PrintedText, region: HudRegion) => text.left >= region.left && text.left + text.width <= region.left + region.width && text.top >= region.top && text.top + text.height <= region.top + region.height;
function render(viewport: HudViewport, state: PlayerCombatView = player): { recorder: TextRecorder; layout: CombatHudLayout } {
  const { columns, rows } = grid(viewport), layout = combatHudLayout(columns, rows, viewport), recorder = new TextRecorder();
  drawCombatOverlay(recorder, columns, rows, { cam: { x: 0, y: 2.7, z: 0, yaw: 0, pitch: 0, fov: 62, aspect: viewport.width / viewport.height }, effects: [], enemies: [], lockTarget: null, player: state, boss: { name: "Mother Rust ".repeat(30), title: "Queen of Scrap".repeat(30), health: 500, maxHealth: 1000, phase: 24, phases: 40 }, prompt: null, visible: () => true, weapon, time: 1 }, layout);
  return { recorder, layout };
}

test("long names, buffs, boss phases and reload bars stay bounded without dropping HP or ammo numbers", () => {
  for (const viewport of viewports) for (const action of ["idle", "reload"] as const) {
    const { recorder, layout } = render(viewport, { ...player, action, buffs: Array.from({ length: 1000 }, () => ({ effect: "focus" as const, remaining: 12 })) });
    assert.equal(recorder.prints.length, 7, "persistent HUD needs only seven text submissions");
    for (const text of recorder.prints) {
      assert.match(text.text, /^[ -~]*$/);
      assert.ok(Object.values(layout).some(region => within(text, region)), JSON.stringify({ viewport, text, layout }));
      assert.ok(text.width <= 64);
    }
    assert.ok(recorder.prints[0].text.includes("82/100"), recorder.prints[0].text);
    assert.ok(recorder.prints[3].text.includes("9 / 48"), recorder.prints[3].text);
    if (action === "reload") assert.ok(recorder.prints[3].text.includes("R"));
    assert.ok(recorder.prints[2].text.endsWith("..."));
    assert.ok(recorder.prints[4].text.endsWith("..."));
    assert.equal(recorder.prints[6].text, "PH 25/40");
  }
});

test("empty magazines keep numeric reserves and fittings remain safe for degenerate input", () => {
  for (const viewport of viewports) {
    const { recorder } = render(viewport, { ...player, ammo: { loaded: 0, reserve: 48 } });
    assert.ok(recorder.prints[3].text.includes("0 / 48"));
  }
  assert.equal(fitHudText("Prototype weapon", 10), "Prototy...");
  assert.equal(fitHudText("A\nB☂", 4), "A?B?");
  assert.equal(fitHudText("long", 2), "..");
  assert.equal(fitHudText("none", 0), "");
  assert.equal(hudNumber(12000), "12k");
  assert.equal(hudNumber(12_000_000), "12m");
  assert.equal(hudNumber(Infinity), "0");
  for (const size of [0, 1, 2, 4, 10, NaN, Infinity]) {
    const layout = combatHudLayout(size, size, { width: size, height: size, touch: true, insets: { top: Infinity, right: -10 } });
    assert.ok(Object.values(layout).every(region => Object.values(region).every(Number.isFinite)));
  }
});

test("projected labels keep their anchor unless a visible HUD region conflicts", () => {
  const layout: CombatHudLayout = { vitals: { left: -8, top: 0, width: 16, height: 2 }, weapon: { left: 20, top: 5, width: 10, height: 2 }, boss: { left: -8, top: -5, width: 16, height: 3 } };
  assert.equal(combatLabelRow(0, 3, 6, 1, 30, layout, true), 3);
  assert.equal(combatLabelRow(0, 0, 6, 1, 30, layout, true), -1);
  assert.equal(combatLabelRow(0, -5, 6, 1, 30, layout, false), -5);
  assert.equal(combatLabelRow(0, -5, 6, 1, 30, layout, true), -6);
  assert.equal(combatLabelRow(18, 0, 6, 1, 30, layout, true), 0);
  assert.equal(combatLabelRow(0, -20, 6, 1, 30, layout, true), -20);
  const blocked = { ...layout, vitals: { left: -20, top: -5, width: 40, height: 11 } };
  assert.equal(combatLabelRow(0, 0, 6, 1, 30, blocked, true), null);
  assert.equal(combatLabelRow(0, 0, 6, 1, Infinity, layout, true), null);
  assert.equal(combatLabelRow(NaN, 0, 6, 1, 30, layout, true), null);
});

test("label placement is deterministic and only searches within four rows of its world anchor", () => {
  for (const viewport of viewports) {
    const { columns, rows } = grid(viewport), layout = combatHudLayout(columns, rows, viewport);
    for (let index = 0; index < 200; index++) {
      const center = index * 37 % columns - Math.floor(columns / 2), top = index * 17 % rows - Math.floor(rows / 2);
      const width = 4 + index % 24, height = 1 + index % 3, bossVisible = index % 2 === 0;
      const placed = combatLabelRow(center, top, width, height, rows, layout, bossVisible);
      assert.equal(placed, combatLabelRow(center, top, width, height, rows, layout, bossVisible));
      const obstacles = bossVisible ? Object.values(layout) : [layout.vitals, layout.weapon];
      const original = { left: center - Math.floor(width / 2), top, width, height };
      if (!obstacles.some(obstacle => overlaps(original, obstacle))) assert.equal(placed, top);
      if (placed === null) continue;
      assert.ok(Math.abs(placed - top) <= 4);
      assert.ok(obstacles.every(obstacle => !overlaps({ ...original, top: placed }, obstacle)));
      if (placed !== top) assert.ok(placed >= -Math.floor(rows / 2) && placed + height <= Math.ceil(rows / 2));
    }
  }
});

const labelledEnemy: EnemyView = {
  id: "label", archetype: "guard", name: "Guard", faction: "corpsec", x: 0, z: -12, yaw: Math.PI, health: 40, maxHealth: 100, state: "alert", attack: 0, hitAge: Infinity, deathAge: -1, weaponClass: "pistol", bark: "KEEP MOVING.", hostile: true,
  look: { coat: [50, 60, 70], trim: [20, 30, 40], skin: [160, 120, 90], light: [100, 200, 255], headwear: "cap", prop: null, idle: "scan" },
};
const labelFrame = (viewport: HudViewport, enemies: readonly EnemyView[] = [labelledEnemy]): CombatOverlayFrame => ({
  cam: { x: 0, y: 2.7, z: 0, yaw: 0, pitch: 0, fov: 62, aspect: viewport.width / viewport.height }, effects: [], enemies, lockTarget: null, player, boss: null, prompt: null, visible: () => true, weapon, time: 1,
});

test("non-conflicting enemy health, name and bark retain their original desktop positions", () => {
  const viewport = viewports[0], { columns, rows } = grid(viewport), frame = labelFrame(viewport), recorder = new TextRecorder();
  const head = toCell(frame.cam, columns, rows, labelledEnemy.x, 3.5, labelledEnemy.z);
  assert.ok(head);
  drawCombatOverlay(recorder, columns, rows, frame, combatHudLayout(columns, rows, viewport));
  const projected = recorder.prints.slice(0, -4);
  assert.equal(projected.length, 3);
  assert.equal(projected[0].top, head.gy);
  assert.equal(projected[1].top, head.gy - 1);
  assert.equal(projected[2].top, head.gy - 2);
  for (const text of projected) assert.equal(text.left + Math.floor(text.width / 2), head.gx);
});

test("compact native labels clear all persistent panels without adding text submissions", () => {
  const viewport = { width: 480, height: 320, touch: true }, { columns, rows } = grid(viewport), layout = combatHudLayout(columns, rows, viewport);
  const frame = { ...labelFrame(viewport), boss: { name: "Brakka", title: "Warlord", health: 999, maxHealth: 1000, phase: 1 } };
  const recorder = new TextRecorder();
  drawCombatOverlay(recorder, columns, rows, frame, layout);
  const projected = recorder.prints.slice(0, -7);
  assert.ok(projected.length > 0 && projected.length <= 3);
  assert.ok(projected.some(text => text.text.startsWith("[####")), "enemy health remains visible");
  for (const text of projected) for (const region of Object.values(layout)) assert.ok(!overlaps(text, region), JSON.stringify({ text, region }));
  const crowded = new TextRecorder();
  drawCombatOverlay(crowded, columns, rows, { ...frame, enemies: Array.from({ length: 100 }, (_, index) => ({ ...labelledEnemy, id: `label-${index}` })) }, layout);
  assert.ok(crowded.prints.length <= 307);
});

test("optional barks yield before enemy health and names when only a small HUD gap remains", () => {
  const viewport = { width: 480, height: 320, touch: true }, { columns, rows } = grid(viewport), frame = labelFrame(viewport);
  const head = toCell(frame.cam, columns, rows, labelledEnemy.x, 3.5, labelledEnemy.z);
  assert.ok(head);
  const obstacleTop = -Math.floor(rows / 2);
  const layout: CombatHudLayout = {
    vitals: { left: -20, top: obstacleTop, width: 40, height: head.gy - 1 - obstacleTop },
    weapon: { left: -20, top: head.gy + 1, width: 40, height: Math.ceil(rows / 2) - head.gy - 1 },
    boss: { left: 0, top: 0, width: 1, height: 0 },
  };
  const recorder = new TextRecorder();
  drawCombatOverlay(recorder, columns, rows, frame, layout);
  const projected = recorder.prints.slice(0, -4);
  assert.equal(projected.length, 2);
  assert.ok(projected.some(text => text.text === "Guard"));
  assert.ok(projected.some(text => text.text.startsWith("[####")));
  assert.ok(projected.every(text => !text.text.includes("KEEP MOVING")));
  const healthOnly = new TextRecorder();
  drawCombatOverlay(healthOnly, columns, rows, frame, { ...layout, vitals: { ...layout.vitals, height: layout.vitals.height + 1 } });
  const lastCue = healthOnly.prints.slice(0, -4);
  assert.equal(lastCue.length, 1);
  assert.ok(lastCue[0].text.startsWith("[####"));
  assert.equal(lastCue[0].top, head.gy);
});
