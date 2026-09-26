// Dropped items and interactable markers, drawn with prop primitives so they batch with the city.
// Loot: a small floating token showing the item's own glyph ("$" for credit chips), turning slowly
// on its corner; a ground ring; and for rare and better an MMO-style light pillar in the rarity
// colour - visible from across a plaza, pulsing calmly (a 4 s swell, no blinking).
import type { PropCanvas } from "../../city/prop-canvas.ts";
import type { ActivityView } from "../../city/activity.ts";
import type { GroundLootView, InteractableDefinition } from "../types.ts";
import { DEG, RARITY_COLOR, box, glowOf, hashString, paint, paintRange, rarityTier, restorePaintRange, ring, smooth, type Rgb } from "./palette.ts";

export const LOOT_RANGE = 260;
const TOKEN_RANGE = 140;
const CREDIT: Rgb = [255, 214, 90];
/** Pillar height (m) by rarity tier (rare, epic, legendary). */
export const PILLAR_HEIGHT = [0, 0, 7, 10, 15] as const;
const printable = (g: string | undefined, fallback: string): string => g && /^[!-~]$/.test(g) ? g : fallback;
export const isCredits = (l: GroundLootView): boolean => l.glyph === "$" || l.item === "credits" || l.item.startsWith("credit");

/** Ground loot for the prop pass (engine recordProps). */
export function drawGroundLoot(sink: PropCanvas, view: ActivityView, loot: readonly GroundLootView[], time: number): void {
  if (!loot.length) return;
  const outer = paintRange(0);
  for (const l of loot) {
    const distance = Math.hypot(l.x - view.x, l.z - view.z);
    if (distance > LOOT_RANGE) continue;
    const credits = isCredits(l), tier = credits ? 0 : rarityTier(l.rarity);
    const color = credits ? CREDIT : RARITY_COLOR[l.rarity] ?? RARITY_COLOR.common;
    const light = glowOf(color, 250);
    const seed = hashString(l.id) * 6.28;
    const spawn = smooth(0, 0.45, l.age);
    const pulse = 0.86 + 0.14 * Math.sin(time * 1.6 + seed);
    if (tier >= 2) {
      // Light pillar: core column, a sheath that reads against the skyline from afar, rising motes.
      const height = PILLAR_HEIGHT[tier] * smooth(0, 0.8, l.age);
      const core = Math.max(0.08, distance * 0.017); // >= ~1.3 cells wide so the column never breaks up
      paint(sink, light, "|", 1.0 * pulse);
      box(sink, l.x, height / 2, l.z, core, height, core);
      if (distance > 35) { paint(sink, light, ":", 0.7 * pulse); box(sink, l.x, height * 0.35, l.z, core * 2.4, height * 0.7, core * 2.4); }
      if (tier >= 3 && distance < 120) {
        paint(sink, light, "+", 0.95);
        for (let i = 0; i < tier - 1; i++) {
          const phase = (time * 0.22 + i / (tier - 1) + seed) % 1;
          const s = Math.max(0.06, distance * 0.018);
          box(sink, l.x + Math.cos(seed + i * 2.1) * 0.22, phase * height, l.z + Math.sin(seed + i * 2.1) * 0.22, s, s, s);
        }
      }
    }
    if (distance > TOKEN_RANGE) continue;
    if (!view.visible || distance < 12 || view.visible(l.x, 0.6, l.z)) {
      // Ground ring marking the exact spot (wider and brighter for better items).
      paint(sink, light, tier >= 4 ? "*" : "-", 0.55 + tier * 0.1);
      ring(sink, l.x, 0.04, l.z, (0.42 + tier * 0.06) * (0.6 + 0.4 * spawn), Math.max(0.025, distance * 0.004));
      if (tier >= 4) { paint(sink, light, "o", 0.6); ring(sink, l.x, 0.04, l.z, 0.5 + 0.5 * ((time * 0.3 + seed) % 1), Math.max(0.02, distance * 0.003)); }
      // Floating token on its corner, turning slowly; it pops up out of the ground when dropped.
      const size = Math.max(credits ? 0.24 : 0.3, distance * 0.02);
      const lift = (0.2 + 0.4 * spawn) + Math.sin(time * 1.8 + seed) * 0.06;
      paint(sink, tier === 0 && !credits ? color : light, printable(l.glyph, credits ? "$" : "*"), tier === 0 && !credits ? 1.1 : 0.95 * pulse + 0.05);
      sink.push(); sink.translate(l.x, -(lift + size * 0.6), l.z);
      sink.rotateY(time * 40 + seed * DEG); sink.rotateZ(45); sink.rotateX(35.264);
      sink.box(size, size, size);
      sink.pop();
      // Stacks: a second, smaller token orbiting the first.
      if (l.count > 1 && distance < 40) {
        const a = time * 0.9 + seed, s = size * 0.55;
        box(sink, l.x + Math.cos(a) * size, lift + size * 0.4, l.z + Math.sin(a) * size, s, s, s);
      }
    }
  }
  restorePaintRange(outer);
}

const MARK: Rgb = [150, 255, 222];
/** Interaction markers (terminals, crates, bodies...): the object's glyph floating in "[ ]" brackets
 * that face the viewer, bright within reach, a faint diamond further out. Pass only the
 * interactables that are currently available (condition met, not used up). */
export function drawInteractables(sink: PropCanvas, view: ActivityView, list: readonly InteractableDefinition[], time: number): void {
  if (!list.length) return;
  const outer = paintRange(0);
  for (const d of list) {
    const distance = Math.hypot(d.x - view.x, d.z - view.z);
    if (distance > 60) continue;
    const y = d.y ?? 1.5;
    if (view.visible && distance > 10 && !view.visible(d.x, y, d.z)) continue;
    const near = smooth(14, 5, distance);
    const toViewer = Math.atan2(view.x - d.x, d.z - view.z);
    const bob = Math.sin(time * 1.6 + d.x * 0.3) * 0.05;
    const scale = Math.max(1, distance / 9);
    const gain = 0.6 + 0.4 * near + 0.08 * Math.sin(time * 2.2 + d.z);
    sink.push(); sink.translate(d.x, -(y + 0.35 + bob), d.z); sink.rotateY(-toViewer * DEG); sink.scale(scale);
    paint(sink, MARK, printable(d.glyph, "?"), gain);
    if (near > 0.05) {
      sink.box(0.22, 0.22, 0.05);
      paint(sink, MARK, "[", 0.5 + 0.5 * near); box(sink, 0.25, 0, 0, 0.08, 0.3, 0.05);
      paint(sink, MARK, "]", 0.5 + 0.5 * near); box(sink, -0.25, 0, 0, 0.08, 0.3, 0.05);
    } else {
      sink.rotateZ(45); sink.box(0.14, 0.14, 0.05);
    }
    sink.pop();
    if (distance < 20) { paint(sink, MARK, "-", 0.35 + 0.4 * near); ring(sink, d.x, 0.04, d.z, 0.6, 0.025); }
  }
  restorePaintRange(outer);
}
