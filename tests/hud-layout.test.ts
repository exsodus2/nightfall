import assert from "node:assert/strict";
import test from "node:test";
import { combatHudLayout, drawCombatOverlay, fitHudText, hudNumber, type CombatHudLayout, type HudRegion, type HudViewport, type OverlayCanvas } from "../src/rpg/scene/index.ts";
import type { ItemDefinition, PlayerCombatView } from "../src/rpg/types.ts";

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
