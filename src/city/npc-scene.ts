import type { PropCanvas } from "./prop-canvas";
import { cuboid as box, ink, propRange, restorePropRange, type ActivityView } from "./activity";
import type { NpcDefinition } from "./npcs";
import type { NpcMarker } from "./quests";
import type { RGB } from "./world";

// Named characters: residents' proportions, but long bright coats, an emissive seam and a
// lit ring at their feet, an idle animation, and a floating "!" / "?" when they want you.
const MARKERS: Record<Exclude<NpcMarker, null>, { glyph: string; color: RGB }> = {
  offer: { glyph: "!", color: [255, 200, 70] },
  objective: { glyph: "?", color: [96, 240, 255] },
  "turn-in": { glyph: "?", color: [255, 214, 88] },
};
const SHOE: RGB = [30, 32, 38];
const angleTo = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const smooth = (edge0: number, edge1: number, x: number): number => { const k = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0))); return k * k * (3 - 2 * k); };

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
      drawNpc(t, npc, yaw, view.time, distance < 120, talking === npc.id);
    }
    const kind = marker(npc.id);
    if (kind) { propRange(0); drawMarker(t, npc, kind, toPlayer, view.time, distance); }
  }
  restorePropRange(outer);
}

function drawNpc(t: PropCanvas, npc: NpcDefinition, yaw: number, time: number, detail: boolean, talking: boolean): void {
  const { coat, trim, skin, light, headwear, prop, idle } = npc.look;
  const phase = npc.x * 0.37 + npc.z * 0.11;
  const breathe = 1 + Math.sin(time * 1.6 + phase) * (idle === "breathe" ? 0.045 : 0.02);
  t.push(); t.translate(npc.x, 0, npc.z); t.rotateY(-yaw * 180 / Math.PI);
  // Weight shifts from foot to foot rather than a walking gait.
  if (idle === "sway") t.rotateZ(Math.sin(time * 1.1 + phase) * 2.6);
  ink(t, SHOE, "=");
  for (const side of [-1, 1]) box(t, side * 0.2, 0.08, -0.06, 0.3, 0.16, 0.46);
  ink(t, trim, "|");
  for (const side of [-1, 1]) box(t, side * 0.2, 0.55, 0, 0.26, 0.9, 0.3);
  // Knee-length coat: skirt box under an ellipsoid torso, with a lit seam down the front.
  ink(t, coat, "H");
  box(t, 0, 0.95, 0, 0.84, 0.76, 0.5);
  t.translate(0, -1.5, 0); t.ellipsoid(0.46, 0.66 * breathe, 0.32); t.translate(0, 1.5, 0);
  ink(t, light, "|");
  box(t, 0, 0.95, -0.27, 0.07, 0.72, 0.04);
  box(t, 0, 1.55, -0.34, 0.07, 0.5, 0.04);
  box(t, 0, 2.02, 0, 0.52, 0.06, 0.36);
  ink(t, trim, "=");
  box(t, 0, 1.3, 0, 0.88, 0.08, 0.54);
  // Arms. While talking the right hand gestures; the left carries the prop.
  for (const side of [-1, 1]) {
    const lift = talking && side > 0 ? -38 + Math.sin(time * 3.1) * 12 : Math.sin(time * 1.1 + phase + side) * 2;
    t.push(); t.translate(side * 0.52, -1.9, 0); t.rotateX(lift);
    ink(t, coat, "|"); box(t, 0, -0.45, 0, 0.2, 0.9, 0.24);
    ink(t, skin, "o"); box(t, 0, -0.96, 0, 0.14, 0.14, 0.16);
    t.pop();
  }
  // Head, which the scanner turns slowly from side to side.
  t.push(); t.translate(0, -2.3, -0.03);
  if (idle === "scan" && !talking) t.rotateY(Math.sin(time * 0.7 + phase) * 38);
  ink(t, skin, "O"); t.ellipsoid(0.24, 0.31, 0.25);
  if (headwear === "hood") {
    ink(t, coat, "%"); t.translate(0, -0.06, 0.07); t.ellipsoid(0.31, 0.38, 0.31); t.translate(0, 0.06, -0.07);
  } else if (headwear === "visor") {
    ink(t, [38, 40, 47], "="); t.translate(0, -0.2, 0.02); t.ellipsoid(0.26, 0.13, 0.25); t.translate(0, 0.2, -0.02);
    ink(t, light, "="); box(t, 0, 0.03, -0.19, 0.46, 0.09, 0.14);
  } else if (headwear === "cap") {
    ink(t, trim, "="); box(t, 0, 0.26, 0, 0.5, 0.13, 0.5);
    box(t, 0, 0.2, -0.32, 0.46, 0.04, 0.26);
    ink(t, light, "-"); box(t, 0, 0.26, -0.26, 0.3, 0.05, 0.02);
  } else {
    ink(t, [214, 212, 200], "~"); t.translate(0, -0.2, 0.02); t.ellipsoid(0.26, 0.13, 0.26); t.translate(0, 0.2, -0.02);
  }
  t.pop();
  if (detail) {
    const outer = propRange(120);
    if (prop === "case") {
      ink(t, [40, 44, 54], "#"); box(t, -0.62, 0.8, 0, 0.13, 0.46, 0.62);
      ink(t, light, "-"); box(t, -0.69, 0.86, 0, 0.02, 0.05, 0.5);
    } else if (prop === "antenna") {
      ink(t, [70, 82, 96], "|"); box(t, 0.2, 2.45, 0.32, 0.04, 1.3, 0.04);
      if (Math.sin(time * 4 + phase) > 0) { ink(t, light, "*"); box(t, 0.2, 3.13, 0.32, 0.12, 0.12, 0.12); }
    } else if (prop === "lantern") {
      t.push(); t.translate(-0.52, -0.98, -0.05); t.rotateX(Math.sin(time * 1.8 + phase) * 18);
      ink(t, [70, 60, 50], "|"); box(t, 0, -0.14, 0, 0.03, 0.28, 0.03);
      ink(t, light, "@", 0.95 + Math.sin(time * 9 + phase) * 0.05); box(t, 0, -0.42, 0, 0.22, 0.3, 0.22);
      t.pop();
    } else if (prop === "umbrella") {
      // An LED umbrella: always open, with a lit rim.
      ink(t, [150, 160, 150], "|"); box(t, -0.45, 2.1, 0, 0.05, 1.6, 0.05);
      ink(t, coat, "%", 0.8); t.translate(-0.45, -2.95, 0); t.ellipsoid(1.25, 0.22, 1.25);
      ink(t, light, "o"); t.translate(0, 0.1, 0); t.rotateX(90); t.torus(1.2, 0.04); t.rotateX(-90); t.translate(0.45, 2.85, 0);
    }
    ink(t, light, "-", 0.75 + Math.sin(time * 2 + phase) * 0.15);
    t.translate(0, -0.03, 0); t.rotateX(90); t.torus(0.95, 0.035); t.rotateX(-90); t.translate(0, 0.03, 0);
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
  const gain = 0.9 + Math.sin(time * 3.5) * 0.1;
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
