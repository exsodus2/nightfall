import type { PropCanvas } from "./prop-canvas.ts";
import type { SignFace } from "./signage.ts";
import type { Landmark, RGB } from "./world.ts";

/**
 * The six landmarks as instanced prop geometry (surface 2), recorded once per frame with the other
 * props (activity.ts) and so shared by the reflected and main passes. Each is built from many
 * small parts - setback stages, lattice, rings, glowing cores, catwalks, lanterns - rather than a
 * few big boxes: a prop box carries one glyph on every face, so large plain boxes read as flat
 * slabs close up. Detail is tiered by distance (`LandmarkDetail`): the far silhouette keeps the
 * massing and the bright bands that carry it through the fog; struts, railings, tags and lanterns
 * appear nearer. Everything solid at street level stays inside the landmark's collision square
 * (`CityWorld.canOccupy`: +-14 m spire, +-12 m reactor/array/market, +-4 m tree, the gate posts);
 * wider parts are above head height. Motion is slow (<= 10 deg/s spins, <= 0.4 Hz pulses).
 * The titles are letter panels (`landmarkLabels`), drawn by engine.ts drawLandmark.
 */
export type LandmarkPaint = (canvas: PropCanvas, color: RGB, glyph: string, gain?: number) => void;
/** 0 = far silhouette, 1 = mid (lattice, slits, rings), 2 = near (railings, tags, lanterns). */
export type LandmarkDetail = 0 | 1 | 2;
export const landmarkDetail = (distance: number): LandmarkDetail => distance < 170 ? 2 : distance < 430 ? 1 : 0;

const DEG = 180 / Math.PI;
/** Seed for the title panels: sign mode 0 (a steady tube; marquee scrolling would read as cheap). */
const TITLE_SEED = 0.004;

/** Cell footprint prefilter: metres per character cell at 1 m (a 70 degree view over ~120 rows),
 * slightly under one cell. A part thinner than a cell drops in and out of the cells as the camera
 * moves (crawling, flickering lines), so thin dimensions are widened to about one cell at their
 * distance: a far mast stays a steady one-glyph line. street-life.ts and signage.ts use it too. */
export const LINE_PER_METRE = 0.0105;
/** The current landmark's minimum line width (set by drawLandmarkStructure from its distance). */
let minLine = 0;
const thin = (size: number): number => size < 1 ? Math.max(size, minLine) : size;
function box(t: PropCanvas, x: number, y: number, z: number, w: number, h: number, d: number): void {
  t.translate(x, -y, z); t.box(thin(w), thin(h), thin(d)); t.translate(-x, y, -z);
}
/** A beam of square section `w` from a to b (world metres, y up). */
function strut(t: PropCanvas, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number): void {
  const dx = bx - ax, dy = ay - by, dz = bz - az; // textmode Y points down
  t.push(); t.translate((ax + bx) / 2, -(ay + by) / 2, (az + bz) / 2);
  t.rotateY(Math.atan2(dx, dz) * DEG); t.rotateX(Math.atan2(Math.hypot(dx, dz), dy) * DEG);
  t.box(thin(w), Math.hypot(dx, dy, dz), thin(w)); t.pop();
}
/** A ring (textmode's torus lies in its local XZ plane): tilted `tilt` degrees about X after turning `spin` about Y. */
function ring(t: PropCanvas, x: number, y: number, z: number, radius: number, tube: number, spin = 0, tilt = 0): void {
  t.push(); t.translate(x, -y, z); if (spin) t.rotateY(spin); if (tilt) t.rotateX(tilt); t.torus(radius, Math.max(tube, minLine * 0.5)); t.pop();
}
function ball(t: PropCanvas, x: number, y: number, z: number, rx: number, ry = rx, rz = rx): void {
  const r = minLine * 0.5;
  t.push(); t.translate(x, -y, z); t.ellipsoid(Math.max(rx, r), Math.max(ry, r), Math.max(rz, r)); t.pop();
}
const hash = (a: number, b: number): number => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const SIDES: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** The title panels of a landmark, on the faces of solid parts (so the depth test hides a panel
 * seen from behind). Shared by engine.ts drawLandmark and the tests. */
export function landmarkLabels(landmark: Landmark): SignFace[] {
  const { x, z, color, kind } = landmark;
  const faces: SignFace[] = [];
  const around = (half: number, y: number, width: number, height: number, text: string, sides = SIDES) => {
    for (const [sx, sz] of sides) faces.push({ x: x + sx * half, y, z: z + sz * half, yaw: sx ? sx * 90 : sz > 0 ? 0 : 180, width, height, text, color, seed: TITLE_SEED });
  };
  if (kind === "spire") around(11.12, 9.4, 17, 2.6, "MERIDIAN SPIRE");
  else if (kind === "gate") around(0.56, 17.95, 10.6, 2.8, "MEMORY GATE", [[0, 1], [0, -1]]);
  else if (kind === "reactor") around(10.12, 8.2, 18, 2.7, "THE EMBER CORE");
  else if (kind === "array") around(11.72, 7.5, 15.6, 2.5, "SIGNAL CATHEDRAL");
  else if (kind === "garden") around(5.66, 10.4, 7.6, 1.6, "THE LAST TREE");
  else { around(10.62, 14.75, 16, 2.3, "AFTERLIGHT"); around(10.62, 12.35, 10, 2.3, "ARCADE"); }
  return faces;
}

/** Titles are readable to ~200 m and dissolve (prop range) before their letters alias. */
export const LANDMARK_LABEL_RANGE = 260;
const labelCache = new Map<string, SignFace[]>();
const labelEye = { x: 0, z: 0 };
/** The eye the titles are culled against: activity.ts sets it while recording props, before the
 * landmarks' letter panels are drawn in the same frame. */
export function setLandmarkEye(x: number, z: number): void { labelEye.x = x; labelEye.z = z; }
/** Title panels in range and facing the eye (a panel seen from behind is skipped, not mirrored). */
export function visibleLandmarkLabels(landmark: Landmark): SignFace[] {
  if (Math.hypot(labelEye.x - landmark.x, labelEye.z - landmark.z) > LANDMARK_LABEL_RANGE + 20) return [];
  let faces = labelCache.get(landmark.id);
  if (!faces) { faces = landmarkLabels(landmark); labelCache.set(landmark.id, faces); }
  return faces.filter(face => {
    const angle = face.yaw * Math.PI / 180;
    return (labelEye.x - face.x) * Math.sin(angle) + (labelEye.z - face.z) * Math.cos(angle) > 0;
  });
}

/** `line`: minimum width of thin parts in metres (LINE_PER_METRE x distance; 0 = as modelled). */
export function drawLandmarkStructure(t: PropCanvas, landmark: Landmark, time: number, detail: LandmarkDetail, paint: LandmarkPaint, line = 0): void {
  minLine = line;
  switch (landmark.kind) {
    case "spire": spire(t, landmark, time, detail, paint); break;
    case "gate": gate(t, landmark, time, detail, paint); break;
    case "reactor": reactor(t, landmark, time, detail, paint); break;
    case "array": cathedral(t, landmark, time, detail, paint); break;
    case "garden": tree(t, landmark, time, detail, paint); break;
    default: arcade(t, landmark, time, detail, paint);
  }
  minLine = 0;
}

// ---- Meridian Spire: five setback stages of dark glass, lit slits, an exoskeleton on the lower
// stages, a catwalk, a glowing lantern crown inside an open cage and an antenna mast.
function spire(t: PropCanvas, { x, z, color }: Landmark, time: number, detail: LandmarkDetail, paint: LandmarkPaint): void {
  paint(t, [58, 62, 76], "=");
  box(t, x, 0.8, z, 28, 1.6, 28); box(t, x, 2.2, z, 25.5, 1.2, 25.5);
  const stages: readonly (readonly [number, number])[] = [[22, 40], [19, 34], [15.5, 30], [12, 26], [8.5, 22]];
  let base = 2.8;
  for (let i = 0; i < stages.length; i++) {
    const [w, h] = stages[i], half = w / 2, top = base + h;
    paint(t, i % 2 ? [36, 42, 60] : [30, 36, 52], i % 2 ? ":" : "|");
    box(t, x, base + h / 2, z, w, h, w);
    // A bright setback ledge carries the silhouette at any distance.
    paint(t, color, "=", 0.95); box(t, x, top, z, w + 1.4, 0.55, w + 1.4);
    if (detail > 0) {
      paint(t, [74, 82, 102], "#");
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(t, x + sx * (half + 0.25), base + h / 2, z + sz * (half + 0.25), 1.1, h, 1.1);
      // Lit window slits; the lowest stage keeps its slits above the entrance and title.
      const from = base + (i === 0 ? 13 : 1.5), to = top - 1.5, mid = (from + to) / 2;
      paint(t, i % 2 ? [255, 176, 214] : color, "|", 0.9);
      for (const k of [-0.3, 0, 0.3]) for (const s of [-1, 1]) {
        box(t, x + k * w, mid, z + s * (half + 0.07), 0.45, to - from, 0.14);
        box(t, x + s * (half + 0.07), mid, z + k * w, 0.14, to - from, 0.45);
      }
      if (i < 2) {
        // Cross-bracing on the lower stages, standing off the glass.
        paint(t, [96, 104, 128], "+");
        for (const [sx, sz] of SIDES) {
          const ox = sx * (half + 0.6), oz = sz * (half + 0.6), ax = sz ? half : 0, az = sx ? half : 0;
          strut(t, x + ox - ax, base + 0.5, z + oz - az, x + ox + ax, top - 0.5, z + oz + az, 0.4);
          strut(t, x + ox + ax, base + 0.5, z + oz + az, x + ox - ax, top - 0.5, z + oz - az, 0.4);
        }
      }
    }
    if (i === 0 && detail > 1) {
      // Catwalk round the first setback: deck edge and a railing.
      paint(t, [110, 118, 138], "-");
      for (const [sx, sz] of SIDES) {
        const lx = sx ? 0.25 : w + 3.4, lz = sz ? 0.25 : w + 3.4;
        box(t, x + sx * (half + 1.7), top + 1.1, z + sz * (half + 1.7), lx, 0.12, lz);
        box(t, x + sx * (half + 1.7), top + 0.3, z + sz * (half + 1.7), sx ? 0.5 : w + 3.4, 0.25, sz ? 0.5 : w + 3.4);
      }
    }
    base = top;
  }
  // Entrances under the title: glowing frames on all four faces.
  if (detail > 0) {
    paint(t, color, "#", 0.9);
    for (const [sx, sz] of SIDES) {
      const fx = x + sx * 11.1, fz = z + sz * 11.1, along = (o: number) => [fx + (sz ? o : 0), fz + (sx ? o : 0)] as const;
      for (const o of [-2.3, 2.3]) { const [px, pz] = along(o); box(t, px, 4.6, pz, sx ? 0.2 : 0.4, 3.6, sz ? 0.2 : 0.4); }
      box(t, fx, 6.5, fz, sx ? 0.2 : 5, 0.35, sz ? 0.2 : 5);
    }
  }
  // Lantern crown: a glowing core inside an open cage of four posts.
  const crown = base;
  paint(t, [255, 120, 186], "@", 1.12); box(t, x, crown + 8, z, 4.2, 14, 4.2);
  paint(t, [80, 86, 106], "#");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(t, x + sx * 4, crown + 8, z + sz * 4, 0.8, 16, 0.8);
  box(t, x, crown + 16.5, z, 10, 1, 10);
  // Antenna mast with yards and a slow beacon (0.38 Hz, no strobe).
  paint(t, [96, 102, 120], "|"); box(t, x, crown + 38, z, 0.7, 42, 0.7);
  if (detail > 0) {
    paint(t, [120, 126, 146], "-");
    for (const [h, w] of [[25, 6], [34, 4.2], [43, 2.6]] as const) { box(t, x, crown + h, z, w, 0.3, 0.3); box(t, x, crown + h, z, 0.3, 0.3, w); }
  }
  paint(t, [255, 70, 110], "@", 0.75 + 0.35 * (0.5 + 0.5 * Math.sin(time * 2.4)));
  ball(t, x, crown + 59.6, z, 1.1);
  // Halos: tilted rings precessing slowly round the upper stages.
  paint(t, color, "o", 0.9);
  for (let i = 0; i < 3; i++) ring(t, x, crown - 22 + i * 13, z, 15 - i * 2.4, 0.45, time * (5 + i) + i * 120, 9 - i * 2);
}

// ---- Memory Gate: a ceremonial gate over the avenue. Plinths, posts with glowing inner seams, a
// tie beam hung with memory tags, an upswept top beam, lanterns and the title tablet.
function gate(t: PropCanvas, { x, z, color }: Landmark, time: number, detail: LandmarkDetail, paint: LandmarkPaint): void {
  paint(t, [52, 64, 70], "=");
  for (const s of [-1, 1]) box(t, x + s * 10, 0.6, z, 4.6, 1.2, 4.6);
  paint(t, [34, 82, 90], "#");
  for (const s of [-1, 1]) { box(t, x + s * 10, 9.7, z, 3, 17, 3); box(t, x + s * 10, 19.2, z, 2.6, 2, 2.6); }
  paint(t, [40, 92, 100], "=");
  box(t, x, 15.2, z, 25.5, 1.2, 1.5);
  // Top beam with upswept ends and a bright cap line.
  paint(t, [26, 48, 56], "#");
  box(t, x, 20.8, z, 25.2, 1.4, 2.6);
  for (const s of [-1, 1]) { t.push(); t.translate(x + s * 14.2, -21.15, z); t.rotateZ(-s * 11); t.box(4.2, 1.3, 2.6); t.pop(); }
  paint(t, color, "=", 1.0); box(t, x, 21.6, z, 25, 0.25, 2.8);
  paint(t, color, "|", 1.05);
  for (const s of [-1, 1]) box(t, x + s * 8.44, 9.4, z, 0.14, 15, 0.5);
  // Title tablet between the beams.
  paint(t, [18, 32, 38], "#"); box(t, x, 17.95, z, 11.6, 4.3, 1);
  paint(t, color, "-", 0.8);
  for (const y of [15.95, 19.95]) box(t, x, y, z, 11.8, 0.18, 1.1);
  if (detail === 0) return;
  // Lanterns under the top beam, either side of the tablet.
  for (const s of [-1, 1]) {
    paint(t, [60, 90, 96], "|"); box(t, x + s * 8.6, 19.2, z, 0.06, 1.6, 0.06);
    paint(t, [190, 250, 255], "@", 0.95); ball(t, x + s * 8.6, 17.7, z, 0.5, 0.75, 0.5);
  }
  if (detail < 2) return;
  // Memory tags hanging from the tie beam: slow sway (0.08 Hz), bottoms above 11 m.
  const tags: readonly RGB[] = [color, [226, 246, 250], [255, 120, 186], color];
  for (let i = 0; i < 16; i++) {
    const px = -7.6 + i * 1.01, length = 1 + hash(i, 3) * 2.2;
    paint(t, tags[i % tags.length], "|", 0.85);
    t.push(); t.translate(x + px, -14.55, z + (i % 2 ? 0.45 : -0.45)); t.rotateX(Math.sin(time * 0.5 + i * 1.7) * 5);
    t.translate(0, length / 2, 0); t.box(thin(0.22), length, thin(0.05)); t.pop();
  }
}

// ---- The Ember Core: an iron drum carrying a borrowed sun inside a gyroscopic cage - meridian
// rings turning about the core, latitude rings, a tilted orbit ring - with corner stacks and a catwalk.
function reactor(t: PropCanvas, { x, z, color }: Landmark, time: number, detail: LandmarkDetail, paint: LandmarkPaint): void {
  paint(t, [62, 56, 54], "=");
  box(t, x, 1.1, z, 23.6, 2.2, 23.6);
  t.push(); t.translate(x, -1.1, z); t.rotateY(45); t.box(16.9, 2.2, 16.9); t.pop();
  paint(t, [56, 48, 46], "#"); box(t, x, 8.2, z, 20, 12, 20);
  paint(t, color, "=", 0.95); box(t, x, 13.8, z, 20.6, 0.7, 20.6);
  paint(t, [88, 72, 64], "|");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(t, x + sx * 9.6, 8.2, z + sz * 9.6, 1.6, 12.2, 1.6);
  if (detail > 0) {
    // Vent grilles either side of the title.
    paint(t, [255, 120, 50], "=", 0.7);
    for (const [sx, sz] of SIDES) for (const o of [-6.2, 6.2]) box(t, x + sx * 10.06 + (sz ? o : 0), 4.4, z + sz * 10.06 + (sx ? o : 0), sx ? 0.12 : 3.4, 2.2, sz ? 0.12 : 3.4);
  }
  const cy = 24.2;
  // The core: a bright sun girdled by a darker plasma belt and two thin bands, seen through the cage.
  paint(t, [255, 184, 104], "@", 1.05); ball(t, x, cy, z, 6.2);
  paint(t, [255, 120, 50], "*", 0.82); ball(t, x, cy, z, 6.6, 1.1, 6.6);
  if (detail > 0) { paint(t, [255, 150, 70], "-", 0.9); for (const dy of [-3.4, 3.4]) ball(t, x, cy + dy, z, 5.45, 0.35, 5.45); }
  // Latitude rings and struts tying them to the drum.
  paint(t, color, "O", 0.95);
  ring(t, x, cy, z, 10.2, 0.5);
  if (detail > 0) { ring(t, x, cy + 6.5, z, 7.8, 0.35); ring(t, x, cy - 6.5, z, 7.8, 0.35); }
  paint(t, [96, 84, 78], "#");
  for (const [sx, sz] of SIDES) strut(t, x + sx * 8, 14.2, z + sz * 8, x + sx * 9.9, cy, z + sz * 9.9, 0.7);
  // Meridian rings turning slowly about the vertical axis (5 deg/s).
  for (let k = 0; k < (detail > 0 ? 6 : 3); k++) {
    paint(t, k % 2 ? [255, 150, 80] : [104, 92, 86], k % 2 ? "o" : "0", k % 2 ? 0.8 : 1);
    ring(t, x, cy, z, 9.5, 0.32, time * 5 + k * (detail > 0 ? 30 : 60), 90);
  }
  // A tilted orbit ring precessing round it all.
  paint(t, color, "O", 1); ring(t, x, cy, z, 16, 0.7, time * 8, 30);
  // Four stacks on the drum corners with bands and glowing caps.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + sx * 8.7, pz = z + sz * 8.7;
    paint(t, [70, 62, 60], "|"); box(t, px, 30, pz, 1.9, 31.6, 1.9);
    paint(t, [255, 150, 70], "#", 0.9); box(t, px, 46.2, pz, 2.3, 0.8, 2.3);
    if (detail > 0) { paint(t, [110, 96, 88], "="); for (let h = 20; h < 45; h += 6) box(t, px, h, pz, 2.3, 0.35, 2.3); }
  }
  if (detail > 1) {
    // Catwalk ring between the stacks, with its railing.
    paint(t, [120, 108, 100], "-");
    ring(t, x, 18, z, 12.4, 0.28); ring(t, x, 19.1, z, 12.4, 0.1);
    for (const [sx, sz] of SIDES) strut(t, x + sx * 10, 14.2, z + sz * 10, x + sx * 12.4, 17.9, z + sz * 12.4, 0.3);
  }
}

// ---- Signal Cathedral: a transmitter built like a cathedral. Nave, corner towers with pinnacles,
// flying buttresses, stained-glass slits and rose windows, a title marquee, and a crown of turning
// dish arms on a mast with ring emitters.
function cathedral(t: PropCanvas, { x, z, color }: Landmark, time: number, detail: LandmarkDetail, paint: LandmarkPaint): void {
  paint(t, [54, 58, 78], "="); box(t, x, 0.8, z, 24, 1.6, 24);
  paint(t, [38, 42, 64], "|"); box(t, x, 23.6, z, 15, 44, 15);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + sx * 8.6, pz = z + sz * 8.6;
    paint(t, [56, 62, 92], "#"); box(t, px, 27.8, pz, 4.6, 52.4, 4.6);
    box(t, px, 55.5, pz, 3.4, 3, 3.4); box(t, px, 58.5, pz, 2.2, 3, 2.2); box(t, px, 62, pz, 1, 4, 1);
    paint(t, [255, 80, 90], "@", 0.7 + 0.3 * Math.sin(time * 2 + sx + sz * 2)); ball(t, px, 64.4, pz, 0.45);
  }
  // Title marquee in front of the towers on all four faces.
  paint(t, [24, 28, 46], "#");
  for (const [sx, sz] of SIDES) box(t, x + sx * 11.2, 7.5, z + sz * 11.2, sx ? 1 : 16.4, 3.2, sz ? 1 : 16.4);
  if (detail > 0) {
    // Stained-glass slits, shimmering slowly between blue and violet.
    for (const [sx, sz] of SIDES) for (const o of [-3.8, 0, 3.8]) {
      const tall = o === 0 ? 26 : 21, k = sx * 3 + sz * 5 + o;
      paint(t, o === 0 ? [196, 128, 255] : color, "#", 0.85 + 0.15 * Math.sin(time * 0.7 + k));
      box(t, x + sx * 7.56 + (sz ? o : 0), 13 + tall / 2, z + sz * 7.56 + (sx ? o : 0), sx ? 0.14 : 1.3, tall, sz ? 0.14 : 1.3);
    }
    // Rose windows: a ring round a glowing boss above the slits.
    for (const [sx, sz] of SIDES) {
      paint(t, [150, 168, 255], "O", 0.95);
      t.push(); t.translate(x + sx * 7.6, -42, z + sz * 7.6); if (sx) t.rotateZ(90); else t.rotateX(90); t.torus(2.6, 0.3); t.pop();
      paint(t, [220, 200, 255], "*", 1); ball(t, x + sx * 7.5, 42, z + sz * 7.5, 1.5);
    }
    // Flying buttresses from piers inside the plinth to the towers.
    paint(t, [70, 76, 104], "/");
    for (const [sx, sz] of SIDES) for (const o of [-4, 4]) {
      const px = x + sx * 11.2 + (sz ? o : 0), pz = z + sz * 11.2 + (sx ? o : 0);
      box(t, px, 2.5, pz, 1.4, 5, 1.4);
      strut(t, px, 5, pz, x + sx * 7.6 + (sz ? o : 0), 30, z + sz * 7.6 + (sx ? o : 0), 0.7);
    }
    // Glowing doorway under each marquee.
    paint(t, color, "#", 0.9);
    for (const [sx, sz] of SIDES) box(t, x + sx * 7.56, 3.4, z + sz * 7.56, sx ? 0.12 : 2.6, 3.6, sz ? 0.12 : 2.6);
  }
  // Crown: transmitter house, mast, turning dish arms (9 deg/s) and ring emitters.
  paint(t, [50, 56, 84], "#"); box(t, x, 47.6, z, 8, 4, 8);
  paint(t, [110, 120, 150], "|"); box(t, x, 75.5, z, 0.9, 52, 0.9);
  paint(t, color, "=", 0.9);
  for (let i = 0; i < 5; i++) { t.push(); t.translate(x, -(66 + i * 5.5), z); t.rotateY(time * 9 + i * 22); t.box(30 - i * 5, thin(0.8), 1.8); t.pop(); }
  if (detail > 0) {
    paint(t, [190, 205, 255], "o", 1);
    for (const [h, r] of [[92, 3], [95, 2.2], [98, 1.4]] as const) ring(t, x, h, z, r, 0.22);
  }
  paint(t, [255, 70, 90], "@", 0.75 + 0.3 * Math.sin(time * 2.2)); ball(t, x, 102.3, z, 0.8);
}

// ---- The Last Tree: root flares, a twisting trunk, six limbs, layered canopy clusters, glowing
// fruit on threads, hanging title boards and the light ring of the path around it.
function tree(t: PropCanvas, { x, z, color }: Landmark, time: number, detail: LandmarkDetail, paint: LandmarkPaint): void {
  paint(t, [84, 62, 46], "%");
  for (let k = 0; k < 7; k++) {
    const a = k * 2 * Math.PI / 7 + 0.3, c = Math.cos(a), s = Math.sin(a);
    strut(t, x + c * 1.4, 1.2, z + s * 1.4, x + c * 5.6, 0.1, z + s * 5.6, 0.8);
  }
  paint(t, [72, 54, 40], "|");
  for (let i = 0; i < 4; i++) { const w = 3.9 - i * 0.5; t.push(); t.translate(x, -(i * 5.5 + 2.75), z); t.rotateY(i * 17); t.box(w, 5.7, w); t.pop(); }
  const limbs: [number, number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3 + 0.26, reach = 8.5 + (k % 2) * 2.2, lift = 24 + (k % 3) * 2;
    const ex = x + Math.cos(a) * reach, ez = z + Math.sin(a) * reach;
    paint(t, [78, 58, 42], "/"); strut(t, x + Math.cos(a), 15.5 + (k % 2) * 3, z + Math.sin(a), ex, lift, ez, 1.1);
    limbs.push([ex, lift, ez]);
  }
  // Canopy: dark outer clusters with lighter inner ones, plus a crown.
  paint(t, [44, 96, 68], "&");
  for (const [ex, ey, ez] of limbs) ball(t, ex, ey + 1.2, ez, 5.4, 3.3, 5.4);
  ball(t, x, 30.5, z, 6.4, 4.2, 6.4);
  if (detail > 0) {
    paint(t, [70, 142, 100], "%");
    for (let k = 0; k < 6; k++) { const [ex, ey, ez] = limbs[k]; ball(t, (ex + x) / 2, ey + 3.2, (ez + z) / 2, 4.2, 2.6, 4.2); }
  }
  // Bioluminescent fruit, breathing slowly out of phase (<= 0.15 Hz).
  for (let i = 0; i < 18; i++) {
    const [ex, ey, ez] = limbs[i % 6], ox = (hash(i, 1) - 0.5) * 6, oz = (hash(i, 2) - 0.5) * 6, drop = 1.6 + hash(i, 4) * 2.2;
    const fy = ey - 1.6 - drop;
    if (detail > 1) { paint(t, [80, 120, 96], "|"); box(t, ex + ox, ey - 1.6 - drop / 2, ez + oz, 0.05, drop, 0.05); }
    paint(t, [150, 255, 196], "o", 0.78 + 0.28 * (0.5 + 0.5 * Math.sin(time * 0.9 + i * 2.1)));
    ball(t, ex + ox, fy, ez + oz, 0.38);
  }
  // Title boards hung on chains from the lowest limbs, facing the four paths.
  for (const [sx, sz] of SIDES) {
    const bx = x + sx * 5.4, bz = z + sz * 5.4;
    paint(t, [40, 56, 46], "#"); box(t, bx, 10.4, bz, sx ? 0.4 : 8, 2.1, sz ? 0.4 : 8);
    if (detail > 0) { paint(t, [96, 110, 100], "|"); for (const o of [-3.4, 3.4]) box(t, bx + (sz ? o : 0), 16.7, bz + (sx ? o : 0), 0.06, 10.5, 0.06); }
  }
  if (detail > 0) { paint(t, color, "-", 0.75); ring(t, x, 0.06, z, 19, 0.22); }
}

// ---- Afterlight Arcade: a lacquered pagoda of five lit tiers over an open arcade with a glowing
// market hall inside; upswept eaves, lantern strings and a golden finial.
function arcade(t: PropCanvas, { x, z, color }: Landmark, time: number, detail: LandmarkDetail, paint: LandmarkPaint): void {
  paint(t, [74, 62, 50], "="); box(t, x, 0.4, z, 24, 0.8, 24);
  paint(t, [236, 168, 96], "=", 0.68); box(t, x, 4.55, z, 13, 7.5, 13);
  paint(t, [86, 40, 42], "#");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(t, x + sx * 10.4, 5.2, z + sz * 10.4, 2.6, 8.8, 2.6);
  if (detail > 0) {
    paint(t, [102, 48, 50], "|");
    for (const [sx, sz] of SIDES) for (const o of [-3.8, 3.8]) box(t, x + sx * 10.4 + (sz ? o : 0), 5.2, z + sz * 10.4 + (sx ? o : 0), 1, 8.8, 1);
    // Market stalls glowing inside the hall's arcade.
    paint(t, [255, 206, 120], "#", 0.9);
    for (const [sx, sz] of SIDES) box(t, x + sx * 6.56, 2.6, z + sz * 6.56, sx ? 0.12 : 9, 1.6, sz ? 0.12 : 9);
  }
  paint(t, [70, 34, 36], "=");
  for (const [sx, sz] of SIDES) box(t, x + sx * 10.4, 9.95, z + sz * 10.4, sx ? 1.3 : 22.4, 1.3, sz ? 1.3 : 22.4);
  for (let i = 0; i < 5; i++) {
    const eave = 27 - i * 4.6, ey = 10.9 + i * 6.2, body = Math.max(3, eave - 6), half = eave / 2;
    paint(t, [48, 30, 32], "="); box(t, x, ey, z, eave, 0.6, eave);
    // Lit soffit edges carry the tiers at any distance.
    paint(t, color, "-", 0.95);
    for (const [sx, sz] of SIDES) box(t, x + sx * (half - 0.2), ey - 0.42, z + sz * (half - 0.2), sx ? 0.3 : eave, 0.2, sz ? 0.3 : eave);
    paint(t, i % 2 ? [92, 38, 44] : [80, 34, 40], "|"); box(t, x, ey + 3.1, z, body, 5.6, body);
    if (i > 0 || detail === 0) {
      paint(t, [255, 200, 112], "#", 0.9);
      for (const [sx, sz] of SIDES) box(t, x + sx * (body / 2 + 0.05), ey + 3.1, z + sz * (body / 2 + 0.05), sx ? 0.1 : body * 0.8, 1.2, sz ? 0.1 : body * 0.8);
    }
    if (detail > 0) {
      paint(t, [64, 38, 38], "/");
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) strut(t, x + sx * (half - 0.5), ey, z + sz * (half - 0.5), x + sx * (half + 0.9), ey + 1.3, z + sz * (half + 0.9), 0.4);
    }
    if (detail > 1) {
      // A lantern under each eave corner, swaying slowly.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lx = x + sx * (half - 0.8), lz = z + sz * (half - 0.8), swing = Math.sin(time * 0.7 + i + sx * 2 + sz) * 0.12;
        paint(t, [90, 60, 50], "|"); box(t, lx, ey - 1, lz, 0.05, 1.4, 0.05);
        paint(t, [255, 86, 62], "o", 0.95); ball(t, lx + swing, ey - 2, lz, 0.42, 0.62, 0.42);
      }
    }
  }
  if (detail > 1) {
    // Drooping lantern strings along the first eave.
    for (const [sx, sz] of SIDES) for (let k = 1; k < 8; k++) {
      const s = k / 8, along = (s - 0.5) * 26, droop = Math.sin(Math.PI * s) * 1.1;
      paint(t, k % 2 ? [255, 196, 96] : [255, 96, 80], "o", 0.95);
      ball(t, x + sx * 13.3 + (sz ? along : 0), 10.1 - droop, z + sz * 13.3 + (sx ? along : 0), 0.3, 0.42, 0.3);
    }
  }
  // Finial: rings and a golden orb.
  const top = 10.9 + 4 * 6.2 + 5.9;
  paint(t, [255, 210, 120], "|", 0.9); box(t, x, top + 4, z, 0.5, 8, 0.5);
  paint(t, color, "O", 1); for (const h of [1.5, 3.2, 4.8]) ring(t, x, top + h, z, 1.7 - h * 0.18, 0.18);
  paint(t, [255, 222, 140], "@", 1.05); ball(t, x, top + 8.4, z, 0.75);
}
