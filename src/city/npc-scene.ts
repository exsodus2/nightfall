import type { PropCanvas } from "./prop-canvas.ts";
import { cuboid as box, ink, propRange, restorePropRange, type ActivityView } from "./activity.ts";
import type { NpcDefinition } from "./npcs.ts";
import type { NpcMarker } from "./quests.ts";
import type { RGB } from "./world.ts";
import { drawHuman, FigureMotions, type FigureDisplay, type MotionTargets } from "./human-model.ts";
import { drawUmbrella } from "./umbrella-model.ts";

// Named characters: residents' proportions, but long bright coats, an emissive seam and a
// lit ring at their feet, an idle animation, and a floating "!" / "?" when they want you.
const MARKERS: Record<Exclude<NpcMarker, null>, { glyph: string; color: RGB }> = {
  offer: { glyph: "!", color: [255, 200, 70] },
  objective: { glyph: "?", color: [96, 240, 255] },
  "turn-in": { glyph: "?", color: [255, 214, 88] },
};
const angleTo = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const smooth = (edge0: number, edge1: number, x: number): number => { const k = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0))); return k * k * (3 - 2 * k); };
/** Display state per named character (bounded; see FigureMotions): starting or ending a
 *  conversation turns them toward you at most 180 deg/s, head first, and the gesture eases in. */
const MOTIONS = new FigureMotions<string>(128);
const TARGET: MotionTargets = { yaw: 0, glance: 0, gait: 0, talk: 0, sit: 0, hold: 0, phone: 0 };

export function drawNpcs(t: PropCanvas, view: ActivityView, npcs: readonly NpcDefinition[], marker: (id: string) => NpcMarker, talking: string | null): void {
  const outer = propRange(0);
  for (const npc of npcs) {
    const distance = Math.hypot(npc.x - view.x, npc.z - view.z);
    if (distance > 420) continue;
    // Turn toward an approaching player; always face them while talking.
    const toPlayer = Math.atan2(view.x - npc.x, npc.z - view.z);
    const attention = talking === npc.id ? 1 : smooth(9, 4, distance);
    const yaw = npc.facing + angleTo(npc.facing, toPlayer) * attention;
    if (distance < 230 && (!view.visible || view.visible(npc.x, 2.5, npc.z))) {
      propRange(230);
      TARGET.yaw = yaw; TARGET.talk = talking === npc.id ? 1 : 0;
      drawNpc(t, npc, MOTIONS.update(npc.id, view.time, npc.x, npc.z, TARGET), view.time, distance < 120);
    }
    const kind = marker(npc.id);
    if (kind) { propRange(0); drawMarker(t, npc, kind, toPlayer, view.time, distance); }
  }
  restorePropRange(outer);
}

function drawNpc(t: PropCanvas, npc: NpcDefinition, shown: Readonly<FigureDisplay>, time: number, detail: boolean): void {
  const { coat, light, prop } = npc.look;
  const phase = npc.x * 0.37 + npc.z * 0.11;
  t.push(); t.translate(npc.x, 0, npc.z); t.rotateY(-shown.yaw * 180 / Math.PI);
  drawHuman(t, npc.look, { time, seed: Math.floor(Math.abs(phase)), stride: 0, moving: false, detail, distant: !detail, talk: shown.talk, longCoat: npc.look.headwear !== "visor", ...(shown.head ? { glance: shown.head } : {}) }, ink);
  if (detail) {
    const outer = propRange(120);
    if (prop === "antenna") {
      ink(t, [70, 82, 96], "|"); box(t, 0.2, 2.45, 0.32, 0.04, 1.3, 0.04);
      // The tip light swells and fades (0.38 Hz) instead of blinking on and off.
      ink(t, light, "*", 0.35 + 0.8 * (0.5 + 0.5 * Math.sin(time * 2.4 + phase))); box(t, 0.2, 3.13, 0.32, 0.12, 0.12, 0.12);
    } else if (prop === "umbrella") {
      drawUmbrella(t, coat, ink, light);
    }
    ink(t, light, "-", 0.75 + Math.sin(time * 2 + phase) * 0.15);
    t.translate(0, -0.03, 0); t.torus(0.95, 0.035); t.translate(0, 0.03, 0);
    restorePropRange(outer);
  }
  t.pop();
}

/** A bobbing emissive "!" or "?" built from boxes, turned toward the viewer so it reads
 * the right way round, plus a faint beacon column that finds them across a district. */
function drawMarker(t: PropCanvas, npc: NpcDefinition, kind: Exclude<NpcMarker, null>, toViewer: number, time: number, distance: number): void {
  const { glyph, color } = MARKERS[kind];
  // Grows with distance so it never shrinks below about two character cells.
  const scale = Math.max(1, Math.min(7, distance / 20));
  const base = (npc.look.prop === "umbrella" ? 3.8 : 3.3) + Math.sin(time * 2.2) * 0.12;
  const gain = 0.9 + Math.sin(time * 2.4) * 0.1; // 0.38 Hz: brightness never pulses faster than 0.4 Hz
  t.push(); t.translate(npc.x, -base, npc.z); t.rotateY(-toViewer * 180 / Math.PI);
  if (distance > 30) { ink(t, color, "|", 0.85); box(t, 0, 30, 0, 0.1 * scale, 56, 0.1 * scale); }
  t.scale(scale);
  ink(t, color, glyph, gain);
  if (glyph === "!") {
    box(t, 0, 0.75, 0, 0.24, 0.75, 0.24);
    box(t, 0, 0.12, 0, 0.24, 0.24, 0.24);
  } else {
    // Local −x is the viewer's right once the marker faces them.
    box(t, 0, 1.05, 0, 0.5, 0.18, 0.2);
    box(t, -0.25, 0.88, 0, 0.18, 0.4, 0.2);
    box(t, -0.1, 0.66, 0, 0.3, 0.16, 0.2);
    box(t, 0, 0.5, 0, 0.18, 0.26, 0.2);
    box(t, 0, 0.12, 0, 0.2, 0.2, 0.2);
  }
  t.pop();
}
