import type { PropCanvas } from "./prop-canvas";
import { cuboid as box, ink, propRange, restorePropRange, type ActivityView } from "./activity";
import {
  ARENA_SEAT_RADII, ARENA_STAGE, BRIDGE, FOUNTAIN, GATE_DEPTH, GATE_HEIGHT, GATE_INNER, GATE_MOUTH, GATE_OUTER, HEDGE_HEIGHT, PARK, PARK_ARENA, PARK_GATES,
  PARK_SCULPTURES, gateFace, parkLayout, parkRandom, type ParkSculpture, type ParkTree,
} from "./park";
import type { RGB } from "./world";

/**
 * Rootwood Park's props (park.ts has the layout): trees of five species, hedges, benches, path
 * lanterns, the footbridge, the fountain, four neon sculptures, the tunnel gatehouses and the
 * arena - pillars, seating, the stage and its broken neon. Everything goes through the instanced
 * PropCanvas path with draw-distance LOD: small details to ~120 m, trunks 250 m, canopies and
 * lights 400 m. No per-frame allocation beyond the few push/pop pairs of rotated pieces nearby.
 *
 * Comfort: nothing sways, spins fast or flashes; neon "breathes" at under 0.3 Hz and the braziers'
 * flames swell by a few centimetres.
 */

const STONE: RGB = [70, 72, 82], STONE_DARK: RGB = [50, 52, 60], MOUTH: RGB = [5, 6, 8], IVY: RGB = [30, 64, 44];
const WOOD: RGB = [116, 84, 58], IRON: RGB = [46, 56, 62], LAMP: RGB = [255, 204, 130], FLAME: RGB = [255, 140, 60];
const MAGENTA: RGB = [255, 64, 170], CYAN: RGB = [70, 230, 255], DEAD_NEON: RGB = [44, 50, 60], TEAL: RGB = [80, 220, 170];
const HEDGE: RGB = [28, 58, 40];

// Canopy colours stay below the material's emissive threshold (0.64) so they read as dark,
// moonlit masses; only the blossom trees' lit lumps glow faintly.
interface Part { x: number; y: number; z: number; rx: number; ry: number; rz: number; color: RGB; glyph: string }
interface TreeDraw { tree: ParkTree; trunk: Part; canopy: Part[]; detail: Part[]; reach: number }
const SPECIES = {
  oak: { trunk: [58, 44, 36] as RGB, leaf: [30, 62, 44] as RGB, lit: [62, 112, 78] as RGB, glyph: "&" },
  lime: { trunk: [60, 48, 40] as RGB, leaf: [32, 66, 46] as RGB, lit: [64, 114, 80] as RGB, glyph: "&" },
  pine: { trunk: [48, 36, 30] as RGB, leaf: [24, 54, 50] as RGB, lit: [50, 96, 84] as RGB, glyph: "^" },
  willow: { trunk: [62, 52, 40] as RGB, leaf: [58, 86, 50] as RGB, lit: [80, 112, 64] as RGB, glyph: "|" },
  blossom: { trunk: [50, 38, 40] as RGB, leaf: [140, 60, 104] as RGB, lit: [196, 96, 150] as RGB, glyph: "*" },
};
function treeParts(tree: ParkTree): TreeDraw {
  const { x, z, height: h, canopy: c, species } = tree, look = SPECIES[species];
  const r = (salt: number) => parkRandom(x, z, salt), p = (dx: number, y: number, dz: number, rx: number, ry: number, rz: number, color: RGB, glyph = look.glyph): Part => ({ x: x + dx, y, z: z + dz, rx, ry, rz, color, glyph });
  const a = r(21) * Math.PI * 2, ox = Math.cos(a), oz = Math.sin(a);
  let trunk: Part, canopy: Part[], detail: Part[];
  if (species === "pine") {
    trunk = p(0, h * 0.35, 0, 0.4, h * 0.7, 0.4, look.trunk, "|");
    canopy = [p(0, h * 0.36, 0, c, c * 0.62, c, look.leaf), p(ox * 0.3, h * 0.58, oz * 0.3, c * 0.72, c * 0.58, c * 0.72, look.leaf), p(0, h * 0.8, 0, c * 0.44, c * 0.62, c * 0.44, look.leaf)];
    detail = [p(0, h * 0.96, 0, c * 0.18, c * 0.34, c * 0.18, look.lit)];
  } else if (species === "willow") {
    trunk = p(0, h * 0.28, 0, 0.7, h * 0.56, 0.7, look.trunk, "|");
    canopy = [p(0, h * 0.56, 0, c, c * 0.92, c, look.leaf), p(ox * c * 0.3, h * 0.8, oz * c * 0.3, c * 0.62, c * 0.5, c * 0.62, look.lit)];
    detail = [];
  } else if (species === "lime") {
    trunk = p(0, h * 0.24, 0, 0.55, h * 0.48, 0.55, look.trunk, "|");
    canopy = [p(0, h * 0.62, 0, c * 0.82, c * 1.15, c * 0.82, look.leaf)];
    detail = [p(ox * c * 0.2, h * 0.62 + c * 0.9, oz * c * 0.2, c * 0.36, c * 0.3, c * 0.36, look.lit)];
  } else {
    trunk = p(0, h * 0.25, 0, species === "oak" ? 0.75 : 0.45, h * 0.5, species === "oak" ? 0.75 : 0.45, look.trunk, "|");
    canopy = [p(0, h * 0.62, 0, c, c * 0.72, c, look.leaf), p(ox * c * 0.45, h * 0.74, oz * c * 0.45, c * 0.62, c * 0.5, c * 0.62, look.leaf)];
    // The lit edge: moon- and city-lit lumps on the crown, lighter than the mass below.
    detail = [p(-oz * c * 0.4, h * 0.62 + c * 0.55, ox * c * 0.4, c * 0.32, c * 0.24, c * 0.32, look.lit), p(ox * c * 0.6, h * 0.74 + c * 0.35, oz * c * 0.6, c * 0.28, c * 0.2, c * 0.28, look.lit)];
  }
  return { tree, trunk, canopy, detail, reach: c + 1 };
}

let trees: TreeDraw[] | null = null;
function ellipsoid(t: PropCanvas, part: Part): void {
  ink(t, part.color, part.glyph);
  t.translate(part.x, -part.y, part.z); t.ellipsoid(part.rx, part.ry, part.rz); t.translate(-part.x, part.y, -part.z);
}

/** Draws the park's props. `time` is the scene clock (neon breathing, flames, the koi). */
export function drawPark(t: PropCanvas, view: ActivityView, time: number): void {
  // Nothing of the park reads beyond the canopies' draw distance.
  const dxPark = Math.max(PARK.minX - view.x, 0, view.x - PARK.maxX), dzPark = Math.max(PARK.minZ - view.z, 0, view.z - PARK.maxZ);
  if (Math.hypot(dxPark, dzPark) > 400) return;
  const layout = parkLayout();
  trees ??= layout.trees.map(treeParts);
  const fx = Math.sin(view.yaw), fz = -Math.cos(view.yaw), overhead = view.height > 40;
  // In front of the camera (a generous cone: the engine's field of view plus margin), or close.
  const seen = (x: number, z: number, radius: number, range: number): boolean => {
    const dx = x - view.x, dz = z - view.z, d2 = dx * dx + dz * dz;
    if (d2 > (range + radius) ** 2) return false;
    if (overhead || d2 < 900) return true;
    const d = Math.sqrt(d2);
    return (dx * fx + dz * fz) / d > 0.12 - radius / d;
  };
  const outer = propRange(400);

  // Trees: canopies (400 m), trunks (250 m), lit crown details (120 m).
  for (const tree of trees) {
    if (!seen(tree.tree.x, tree.tree.z, tree.reach, 400)) continue;
    for (const part of tree.canopy) ellipsoid(t, part);
  }
  propRange(250);
  for (const tree of trees) if (seen(tree.tree.x, tree.tree.z, 1, 250)) {
    const k = tree.trunk; ink(t, k.color, k.glyph); box(t, k.x, k.y, k.z, k.rx, k.ry, k.rz);
  }
  propRange(120);
  for (const tree of trees) if (tree.detail.length && seen(tree.tree.x, tree.tree.z, tree.reach, 120)) for (const part of tree.detail) ellipsoid(t, part);

  // Hedges (300 m).
  propRange(300);
  ink(t, HEDGE, "%");
  for (const h of layout.hedges) if (seen(h.x, h.z, Math.max(h.hx, h.hz), 300)) box(t, h.x, HEDGE_HEIGHT / 2, h.z, h.hx * 2, HEDGE_HEIGHT, h.hz * 2);

  // Lanterns: heads read from 400 m as warm points; posts to 220 m, caps to 120 m.
  propRange(400);
  for (const [k, l] of layout.lanterns.entries()) {
    if (!seen(l.x, l.z, 1, 400)) continue;
    if (l.kind === "brazier") {
      const swell = 1 + 0.06 * Math.sin(time * 1.3 + k * 1.7);
      ink(t, FLAME, "*"); t.translate(l.x, -1.75, l.z); t.ellipsoid(0.42, 0.55 * swell, 0.42); t.translate(-l.x, 1.75, -l.z);
    } else { ink(t, LAMP, "@"); box(t, l.x, 3.85, l.z, 0.42, 0.55, 0.42); }
  }
  propRange(220);
  for (const l of layout.lanterns) {
    if (!seen(l.x, l.z, 1, 220)) continue;
    if (l.kind === "brazier") { ink(t, STONE, "#"); box(t, l.x, 0.6, l.z, 0.9, 1.2, 0.9); ink(t, STONE_DARK, "="); t.translate(l.x, -1.3, l.z); t.ellipsoid(0.62, 0.22, 0.62); t.translate(-l.x, 1.3, -l.z); }
    else { ink(t, IRON, "|"); box(t, l.x, 1.8, l.z, 0.16, 3.6, 0.16); }
  }
  propRange(120);
  ink(t, IRON, "^");
  for (const l of layout.lanterns) if (l.kind === "lantern" && seen(l.x, l.z, 1, 120)) box(t, l.x, 4.2, l.z, 0.62, 0.12, 0.62);

  // Benches (120 m): the sitter faces (sin yaw, -cos yaw), local -z.
  for (const b of layout.benches) {
    if (!seen(b.x, b.z, 1, 120)) continue;
    t.push(); t.translate(b.x, 0, b.z); t.rotateY(-b.yaw * 180 / Math.PI);
    ink(t, WOOD, "="); box(t, 0, 0.48, 0, 1.8, 0.1, 0.5); box(t, 0, 0.86, 0.26, 1.8, 0.42, 0.07);
    ink(t, IRON, "|"); for (const side of [-0.78, 0.78]) box(t, side, 0.42, 0.05, 0.08, 0.84, 0.55);
    t.pop();
  }

  drawGatehouses(t, seen);
  drawBridge(t, seen);
  drawFountain(t, seen);
  for (const s of PARK_SCULPTURES) if (seen(s.x, s.z, s.radius + 6, 400)) drawSculpture(t, s, time);
  if (seen(PARK_ARENA.x, PARK_ARENA.z, PARK_ARENA.radius + 12, 400)) drawArena(t, time, seen);
  restorePropRange(outer);
}

type Seen = (x: number, z: number, radius: number, range: number) => boolean;

/** Tunnel gatehouses: dark vehicle mouths either side of a pedestrian arch, ivy on top. The
 * underpass traffic drives into the mouths and vanishes inside the solid dark blocks. */
function drawGatehouses(t: PropCanvas, seen: Seen): void {
  for (const gate of PARK_GATES) {
    const face = gateFace(gate), mid = gate.side < 0 ? face + GATE_DEPTH / 2 : face - GATE_DEPTH / 2;
    const cx = gate.axis === "z" ? gate.line : mid, cz = gate.axis === "z" ? mid : gate.line;
    if (!seen(cx, cz, 8, 400)) continue;
    // Along/lateral box helper: `a` is along the street, `l` across it.
    const piece = (l: number, y: number, a: number, wl: number, h: number, wa: number) => gate.axis === "z" ? box(t, gate.line + l, y, mid + a, wl, h, wa) : box(t, mid + a, y, gate.line + l, wa, h, wl);
    propRange(400);
    const mouthMid = (GATE_INNER + 0.3 + GATE_OUTER - 1) / 2, mouthWidth = GATE_OUTER - 1 - GATE_INNER - 0.3;
    ink(t, MOUTH, " "); for (const s of [-1, 1]) piece(s * mouthMid, GATE_MOUTH / 2, 0, mouthWidth, GATE_MOUTH, GATE_DEPTH);
    ink(t, STONE, "#");
    for (const s of [-1, 1]) {
      piece(s * (GATE_INNER + 0.15), GATE_MOUTH / 2, 0, 0.3, GATE_MOUTH, GATE_DEPTH);
      piece(s * (GATE_OUTER - 0.5), GATE_HEIGHT / 2, 0, 1, GATE_HEIGHT, GATE_DEPTH);
    }
    ink(t, STONE_DARK, "=");
    piece(0, (GATE_MOUTH + GATE_HEIGHT) / 2, 0, GATE_OUTER * 2, GATE_HEIGHT - GATE_MOUTH, GATE_DEPTH);
    ink(t, TEAL, "=");
    for (const a of [-GATE_DEPTH / 2 - 0.03, GATE_DEPTH / 2 + 0.03]) piece(0, GATE_MOUTH + 0.2, a, GATE_OUTER * 2 - 0.4, 0.12, 0.06);
    propRange(300);
    ink(t, IVY, "%"); piece(0, GATE_HEIGHT + 0.35, 0, GATE_OUTER * 2 + 0.4, 0.7, GATE_DEPTH + 0.4);
  }
}

function drawBridge(t: PropCanvas, seen: Seen): void {
  const cx = (BRIDGE.x0 + BRIDGE.x1) / 2, cz = (BRIDGE.z0 + BRIDGE.z1) / 2, dx = BRIDGE.x1 - BRIDGE.x0, dz = BRIDGE.z1 - BRIDGE.z0, length = Math.hypot(dx, dz);
  if (!seen(cx, cz, length / 2, 300)) return;
  // rotateY(a) takes local x to world (cos a, -sin a).
  t.push(); t.translate(cx, 0, cz); t.rotateY(Math.atan2(-dz, dx) * 180 / Math.PI);
  propRange(300);
  ink(t, WOOD, "="); box(t, 0, 0.32, 0, length + 1.5, 0.24, BRIDGE.half * 2);
  ink(t, STONE, "#"); for (const end of [-1, 1]) box(t, end * (length / 2 + 0.2), 0.3, 0, 1.6, 0.6, BRIDGE.half * 2 + 0.4);
  propRange(150);
  ink(t, [96, 74, 52], "=");
  for (const side of [-1, 1]) {
    box(t, 0, 1.12, side * (BRIDGE.half - 0.08), length, 0.1, 0.1);
    for (let u = -length / 2; u <= length / 2 + 0.01; u += length / 10) box(t, u, 0.72, side * (BRIDGE.half - 0.08), 0.12, 0.8, 0.12);
  }
  t.pop();
}

function drawFountain(t: PropCanvas, seen: Seen): void {
  const { x, z, radius } = FOUNTAIN;
  if (!seen(x, z, radius, 300)) return;
  propRange(300);
  ink(t, [96, 100, 108], "O"); t.translate(x, -0.45, z); t.torus(radius + 0.4, 0.5); t.translate(-x, 0.45, -z);
  ink(t, STONE, "#"); box(t, x, 0.9, z, 1.2, 1.8, 1.2);
  ink(t, STONE, "="); t.translate(x, -1.85, z); t.ellipsoid(2.3, 0.32, 2.3); t.translate(-x, 1.85, -z);
  ink(t, [190, 240, 255], "*"); t.translate(x, -2.8, z); t.ellipsoid(0.4, 0.9, 0.4); t.translate(-x, 2.8, -z);
  propRange(120);
  ink(t, [150, 220, 235], "|");
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; box(t, x + Math.cos(a) * 2.1, 1.1, z + Math.sin(a) * 2.1, 0.08, 1.3, 0.08); }
}

function drawSculpture(t: PropCanvas, s: ParkSculpture, time: number): void {
  const { x, z } = s, breathe = 0.82 + 0.18 * Math.sin(time * 0.8 + x);
  propRange(400);
  if (s.kind === "obelisk") {
    ink(t, STONE, "#"); box(t, x, 0.3, z, 2.4, 0.6, 2.4);
    ink(t, [40, 44, 58], "#"); box(t, x, 5.6, z, 1.1, 10, 1.1);
    ink(t, MAGENTA, "|", breathe); for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(t, x + a * 0.58, 5.6, z + b * 0.58, 0.12, 9.6, 0.12);
    ink(t, MAGENTA, "^", breathe); box(t, x, 10.9, z, 0.5, 0.6, 0.5);
  } else if (s.kind === "lotus") {
    ink(t, STONE, "#"); box(t, x, 0.4, z, 1.4, 0.8, 1.4); box(t, x, 1.9, z, 0.35, 3, 0.35);
    ink(t, CYAN, "o", breathe);
    for (const [r, y, tilt] of [[3, 1.2, 8], [2.3, 2.5, -10], [1.6, 3.7, 12]]) {
      t.push(); t.translate(x, -y, z); t.rotateX(tilt); t.rotateZ(tilt * 0.6); t.torus(r, 0.16); t.pop();
    }
  } else if (s.kind === "koi") {
    ink(t, STONE, "#"); for (const side of [-1, 1]) box(t, x, 0.3, z + side * 2.6, 1.2, 0.6, 1.2);
    // A standing ring facing east-west, and a koi of light circling it once a minute.
    ink(t, [255, 150, 60], "o", breathe); t.push(); t.translate(x, -3.3, z); t.rotateX(90); t.torus(3, 0.24); t.pop();
    const a = time * 0.1;
    ink(t, [255, 190, 110], ">"); t.translate(x, -3.3 - Math.sin(a) * 2.3, z + Math.cos(a) * 2.3); t.ellipsoid(0.18, 0.35, 0.18); t.translate(-x, 3.3 + Math.sin(a) * 2.3, -(z + Math.cos(a) * 2.3));
  } else {
    ink(t, IRON, "|"); for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(t, x + a * 1.5, 2.2, z + b * 1.5, 0.14, 4.4, 0.14);
    ink(t, IRON, "="); box(t, x, 4.45, z, 3.2, 0.12, 3.2);
    ink(t, [220, 255, 120], "*", breathe); t.translate(x, -2.4, z); t.ellipsoid(0.7, 1.1, 0.7); t.translate(-x, 2.4, -z);
    ink(t, [150, 170, 120], "%");
    for (const side of [-1, 1]) { t.push(); t.translate(x + side * 0.9, -2.6, z); t.rotateZ(side * 25); t.ellipsoid(1.1, 0.8, 0.06); t.pop(); }
  }
}

/** The arena: pillars (some broken, neon strips alive or dead), neon lintels (one hanging),
 * stone seating on the west arc and the stage east with its sigil ring. */
function drawArena(t: PropCanvas, time: number, seen: Seen): void {
  const layout = parkLayout(), breathe = 0.8 + 0.2 * Math.sin(time * 0.9);
  propRange(400);
  for (const [k, p] of layout.pillars.entries()) {
    ink(t, STONE, "#"); box(t, p.x, p.height / 2, p.z, 1.5, p.height, 1.5);
    const alive = parkRandom(k, 1, 31) > 0.3;
    ink(t, alive ? CYAN : DEAD_NEON, "|", alive ? breathe : 1);
    box(t, p.x - Math.cos(p.angle) * 0.8, p.height / 2, p.z - Math.sin(p.angle) * 0.8, 0.14, p.height - 1, 0.14);
  }
  // Neon lintels between neighbouring intact pillars; every third one hangs from a broken end.
  for (let k = 0; k + 1 < layout.pillars.length; k++) {
    const a = layout.pillars[k], b = layout.pillars[k + 1];
    if (a.broken || b.broken || b.angle - a.angle > 0.6) continue;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, length = Math.hypot(b.x - a.x, b.z - a.z);
    t.push(); t.translate(mx, -(a.height - 0.4), mz); t.rotateY(Math.atan2(-(b.z - a.z), b.x - a.x) * 180 / Math.PI);
    if (k % 3 === 2) t.rotateZ(14);
    ink(t, MAGENTA, "=", breathe); t.box(length - 1.4, 0.22, 0.22);
    t.pop();
  }
  // Stage: platform, a lit front edge, backdrop and the sigil ring facing the circle.
  const sx = (ARENA_STAGE.minX + ARENA_STAGE.maxX) / 2, sz = (ARENA_STAGE.minZ + ARENA_STAGE.maxZ) / 2, depth = ARENA_STAGE.maxX - ARENA_STAGE.minX, width = ARENA_STAGE.maxZ - ARENA_STAGE.minZ;
  ink(t, [64, 62, 70], "#"); box(t, sx, 0.55, sz, depth, 1.1, width);
  ink(t, STONE_DARK, "#"); box(t, ARENA_STAGE.maxX - 0.3, 4.4, sz, 0.6, 8.8, width + 2);
  ink(t, MAGENTA, "=", breathe); box(t, ARENA_STAGE.minX - 0.05, 1.05, sz, 0.08, 0.12, width);
  ink(t, MAGENTA, "O", breathe); t.push(); t.translate(ARENA_STAGE.maxX - 0.7, -5.2, sz); t.rotateZ(90); t.torus(3.6, 0.22); t.pop();
  // The fallen ring, leaning against the backdrop, dead but for a faint glow.
  ink(t, [40, 110, 130], "o"); t.push(); t.translate(ARENA_STAGE.maxX - 1.6, -3.4, sz - 6.2); t.rotateZ(72); t.rotateX(18); t.torus(2.2, 0.16); t.pop();
  propRange(150);
  // Seating tiers: rising blocks on the west arc.
  for (const seat of layout.seats) {
    if (!seen(seat.x, seat.z, 2, 150)) continue;
    const h = 0.45 * (seat.tier + 1);
    t.push(); t.translate(seat.x, 0, seat.z); t.rotateY(-seat.angle * 180 / Math.PI);
    ink(t, [84, 84, 92], "="); box(t, 0, h / 2, 0, seat.hx * 2, h, seat.hz * 2);
    t.pop();
  }
  // Rubble and a fallen neon tube where the broken pillars came down.
  for (const [k, p] of layout.pillars.entries()) {
    if (!p.broken) continue;
    const ox = Math.cos(p.angle + 0.5) * 2.2, oz = Math.sin(p.angle + 0.5) * 2.2;
    ink(t, STONE, "#"); t.push(); t.translate(p.x + ox, -0.5, p.z + oz); t.rotateY(k * 37); t.rotateZ(80); t.box(1.3, 3, 1.3); t.pop();
    ink(t, k % 2 ? CYAN : MAGENTA, "=", 0.6); t.push(); t.translate(p.x - oz * 0.8, -0.15, p.z + ox * 0.8); t.rotateY(k * 53); t.box(3.2, 0.16, 0.16); t.pop();
  }
  void ARENA_SEAT_RADII;
}
