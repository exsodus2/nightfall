import type { PropCanvas } from "./prop-canvas";
import { randomFor, type Building, type RGB } from "./world";
import { cuboid, ink, propAlpha, propRange, restorePropRange } from "./activity";
import { LINE_PER_METRE } from "./landmarks-scene";


/** `seed` (optional) fixes the sign's behaviour (the shader's mode is floor(seed * 97) mod 4: 0 steady
 * tube with rare dips, 1 marquee, 2 power-up sweep, 3 slow pulse); by default it hashes the position. */
export interface SignFace { x: number; y: number; z: number; yaw: number; width: number; height: number; text: string; color: RGB; vertical?: boolean; seed?: number }

export function signFaces(building: Building): SignFace[] {
  const { x, z, width, depth, sign, accent, id } = building;
  const bx = ((x % 64) + 64) % 64, bz = ((z % 64) + 64) % 64;
  const sx = bx < 32 ? -1 : 1, sz = bz < 32 ? -1 : 1;
  const faces: SignFace[] = [
    { x, y: 6.4, z: z + sz * (depth / 2 + 0.28), yaw: sz > 0 ? 0 : 180, width: width - 1, height: 4.2, text: sign, color: accent },
    { x: x + sx * (width / 2 + 0.28), y: 6.4, z, yaw: sx * 90, width: depth - 1, height: 4.2, text: sign, color: accent },
  ];
  // Projecting blade signs are rare off the avenue: a few bright ones read better than a wall of them.
  if (id % 7 === 0 || (Math.abs(x) < 30 && id % 2 === 0)) {
    const text = sign.split(" ")[0].slice(0, 7);
    // Projecting blade signs face along the street; their placement is fixed.
    const signX = x + sx * (width / 2 + 3.4);
    // Fewer blade signs, but big enough to read from down the street.
    const height = text.length * (id % 4 === 0 ? 4.8 : 3.8) + 1.5;
    for (const side of [-1, 1]) faces.push({ x: signX, y: 8 + height / 2, z: z + side * 0.24, yaw: side > 0 ? 0 : 180, width: id % 4 === 0 ? 6 : 4.8, height, text, color: accent, vertical: true });
  }
  return faces;
}

const encoded = new Map<string, number[]>();
export function drawLetterPanel(t: PropCanvas, face: SignFace): void {
  let codes = encoded.get(face.text);
  if (!codes) {
    // Up to 16 letters: the sign shader reads u_text3 (letters 12-15) only when u_textLength > 12.
    codes = [...face.text.toUpperCase().slice(0, 16).padEnd(16)].map(c => Math.max(0, " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".indexOf(c)));
    encoded.set(face.text, codes);
  }
  const pack = (offset: number) => codes[offset] + codes[offset + 1] * 64 + codes[offset + 2] * 4096 + codes[offset + 3] * 262144;
  const seed = face.seed ?? Math.abs(Math.sin(face.x * 12.9898 + face.z * 78.233 + face.y) * 43758.5453) % 1;
  t.setUniforms({ u_surface: 3, u_text0: pack(0), u_text1: pack(4), u_text2: pack(8), u_text3: pack(12), u_textLength: Math.min(16, face.text.length), u_vertical: face.vertical ? 1 : 0, u_signSeed: seed });
  t.push(); t.translate(face.x, -face.y, face.z); t.rotateY(face.yaw);
  t.charColor(...face.color); t.cellColor(3, 8, 12, propAlpha()); t.rect(face.width, face.height); t.pop();
  t.setUniform("u_surface", 2);
}

export function drawShop(t: PropCanvas, building: Building, distance: number, eye: { x: number; z: number }, visible: (x: number, y: number, z: number, radius?: number) => boolean, range = 300): void {
  const { x, z, width, depth, id } = building;
  const faces = signFaces(building);
  const outer = propRange(range);
  // Street fascia signs on about a third of buildings; the rest keep lit shopfronts only.
  for (const face of faces) {
    if (!face.vertical && id % 3 !== 0) continue;
    const angle = face.yaw * Math.PI / 180;
    if ((eye.x - face.x) * Math.sin(angle) + (eye.z - face.z) * Math.cos(angle) > 0 && visible(face.x, face.y, face.z, face.width / 2)) drawLetterPanel(t, face);
  }
  if (distance > 240) { restorePropRange(outer); return; }
  propRange(240);
  const bx = ((x % 64) + 64) % 64, sx = bx < 32 ? -1 : 1;
  const bz = ((z % 64) + 64) % 64, sz = bz < 32 ? -1 : 1;
  // Shopfronts on both street faces: framed windows with lit interiors, a door, an awning or
  // canopy and the street furniture against the wall. Detail is tiered by distance.
  for (const side of [0, 1] as const) {
    if (side ? (eye.x - x) * sx < width / 2 : (eye.z - z) * sz < depth / 2) continue;
    const face = faces[side];
    if (!visible(face.x, 3, face.z, (side ? depth : width) / 2 + 1)) continue; // the awning spans the whole face
    t.push(); t.translate(x, 0, z); t.rotateY(side ? sx * 90 : sz > 0 ? 0 : 180);
    drawShopfront(t, building, side, side ? depth : width, (side ? width : depth) / 2, distance);
    t.pop();
  }
  restorePropRange(outer);
}

/** Free pavement (m) between a street face and the residents' walking line (people.ts
 * pavementPoint: 7.2 m from a street's centre line, 14 m on the avenue), less half a resident. */
export function pavementRoom(building: Building, side: 0 | 1): number {
  const wrap64 = (v: number) => ((v % 64) + 64) % 64;
  if (side) {
    const avenue = Math.abs(building.x) < 32, local = wrap64(building.x);
    return (avenue ? Math.abs(building.x) : Math.min(local, 64 - local)) - building.width / 2 - (avenue ? 14 : 7.2) - 0.5;
  }
  const local = wrap64(building.z);
  return Math.min(local, 64 - local) - building.depth / 2 - 7.2 - 0.5;
}

/** Goods on shop shelves and stall counters, and the paper lanterns. */
const GOODS: readonly RGB[] = [[255, 122, 92], [92, 212, 230], [250, 212, 120], [186, 126, 240], [124, 230, 150], [236, 236, 222], [255, 96, 160]];
const INTERIOR: readonly RGB[] = [[255, 196, 128], [150, 220, 255], [255, 168, 214], [196, 255, 210]];
/** Things standing against a shop wall. All stay within PLAYER_RADIUS (0.8 m) of the face, inside
 * the building's collision skin, so nobody can walk into them and none reach the walking line. */
type WallThing = "vending" | "bags" | "crates" | "planter" | "kiosk" | "bike";
const WALL_THINGS: readonly (readonly WallThing[])[] = [
  ["crates", "vending", "bags", "kiosk"], // The Foundry
  ["vending", "kiosk", "vending", "bags"], // Neon Ward
  ["kiosk", "bags", "crates", "vending"], // Ghost Circuit
  ["planter", "bike", "planter", "vending"], // Rain Gardens
  ["crates", "vending", "planter", "bike"], // Silk Market
  ["bags", "crates", "bike", "bags"], // The Spillway
];

/**
 * One street face, in the face's frame: x along the wall, y up, +z out of the wall from `front`
 * (the face plane). Everything below head height stays within 0.8 m of the face (the collision
 * skin); awnings, lanterns and canopies are above 3.4 m. `w` is the face's width.
 */
function drawShopfront(t: PropCanvas, building: Building, side: 0 | 1, w: number, front: number, distance: number): void {
  const { id, accent, district } = building;
  const r = (k: number) => randomFor(id, side * 31 + 7, k);
  // Detail tiers, prefiltered by cell footprint (about distance x LINE_PER_METRE metres per cell): small
  // parts appear only close up; lines that stay (neon, light edges) are widened to about a cell.
  const near = distance < 30, close = distance < 80, mid = distance < 140, stall = id % 3 === 0;
  const line = distance * LINE_PER_METRE, glowLine = (cap: number) => Math.min(cap, Math.max(0.08, line));
  const interior = INTERIOR[Math.floor(r(1) * INTERIOR.length)];
  const door = Math.min(2.4, Math.max(1.6, w * 0.13)), halfW = w / 2;
  const paneFrom = door / 2 + 0.55, paneTo = halfW - 0.85, pane = Math.max(0.6, paneTo - paneFrom);
  // Recess, pilasters and fascia: the frame the shopfront sits in (below the fascia sign, 4.3-8.5 m).
  ink(t, [13, 27, 34], "="); cuboid(t, 0, 2.5, front + 0.06, w - 1, 4.4, 0.12);
  ink(t, [32, 40, 46], "#");
  for (const s of [-1, 1]) cuboid(t, s * (halfW - 0.3), 2.35, front + 0.22, 0.6, 4.7, 0.44);
  ink(t, [28, 36, 42], "="); cuboid(t, 0, 4.45, front + 0.22, w, 0.5, 0.44);
  // Lit interiors behind the glass (low ink contrast; the frames carry the structure).
  ink(t, interior, ":", 0.58);
  for (const s of [-1, 1]) cuboid(t, s * (paneFrom + pane / 2), 2.4, front + 0.14, pane, 2.5, 0.05);
  ink(t, interior, "|", 0.42); cuboid(t, 0, 1.75, front + 0.14, door - 0.3, 3.1, 0.05);
  // A neon tube under the fascia: the light the shopfront's glow comes from.
  ink(t, accent, "-", 1.15); cuboid(t, 0, 3.98, front + 0.48, w * 0.86, glowLine(1.9), glowLine(1.9));
  if (near) {
    // Window frames and mullions, the door frame and its little lit plate.
    const bar = Math.max(0.12, line);
    ink(t, [46, 58, 64], "|");
    for (const s of [-1, 1]) {
      const centre = s * (paneFrom + pane / 2), bars = Math.max(1, Math.round(pane / 1.4));
      for (let k = 0; k <= bars; k++) cuboid(t, centre - pane / 2 + (pane * k) / bars, 2.4, front + 0.19, bar, 2.65, 0.08);
      ink(t, [52, 64, 70], "=");
      cuboid(t, centre, 1.08, front + 0.24, pane + 0.25, 0.16, 0.3);
      cuboid(t, centre, 3.0, front + 0.19, pane, 0.08, 0.07);
      cuboid(t, centre, 3.7, front + 0.2, pane + 0.2, 0.14, 0.12);
      ink(t, [46, 58, 64], "|");
    }
    for (const s of [-1, 1]) cuboid(t, s * door / 2, 1.75, front + 0.19, bar, 3.3, 0.1);
    cuboid(t, 0, 3.4, front + 0.19, door, 0.14, 0.1);
    ink(t, accent, "=", 1.05); cuboid(t, 0, 3.78, front + 0.24, door * 0.8, 0.3, 0.05);
  }
  if (near) {
    // Shelves of goods in the windows (the stall's counter takes the left window instead).
    for (const s of [-1, 1]) {
      if (stall && s < 0) continue;
      const centre = s * (paneFrom + pane / 2), count = Math.max(2, Math.floor(pane / 0.65));
      for (const shelf of [1.55, 2.45]) {
        ink(t, [70, 78, 82], "="); cuboid(t, centre, shelf, front + 0.2, pane * 0.92, 0.05, 0.22);
        for (let k = 0; k < count; k++) {
          const g = r(10 + k + shelf * 7), h = 0.18 + g * 0.3, along = centre - pane * 0.42 + (pane * 0.84 * (k + 0.5)) / count;
          ink(t, GOODS[Math.floor(g * 97) % GOODS.length], g > 0.5 ? "#" : "=", 0.72);
          cuboid(t, along, shelf + 0.025 + h / 2, front + 0.21, Math.min(0.42, pane * 0.84 / count - 0.08), h, 0.16);
        }
      }
    }
  }
  // Overhead: awning, canopy or lantern line, by building and district.
  const awning = district === 4 && id % 2 === 0 ? 3 : Math.floor(r(2) * 3);
  if (awning === 0) {
    // A striped fabric awning sloping down from the fascia; scalloped valance close up.
    const reach = 3.0, slope = 11, stripes = distance < 70 ? Math.max(4, Math.round(w / 1.15)) : 1;
    for (let k = 0; k < stripes; k++) {
      const span = w / stripes, cx = -halfW + span * (k + 0.5);
      if (stripes === 1) ink(t, accent, "|", 0.5); else ink(t, k % 2 ? [214, 208, 190] : accent, k % 2 ? "=" : "|", k % 2 ? 0.42 : 0.55);
      t.push(); t.translate(cx, -4.3, front + 0.45); t.rotateX(-slope); t.translate(0, 0, reach / 2); t.box(span * 0.995, 0.1, reach); t.pop();
    }
    const edge = front + 0.45 + reach * Math.cos(slope * Math.PI / 180), lip = 4.3 - reach * Math.sin(slope * Math.PI / 180);
    if (near) for (let k = 0; k < stripes; k++) {
      const span = w / stripes;
      ink(t, k % 2 ? [214, 208, 190] : accent, "v", k % 2 ? 0.42 : 0.55);
      cuboid(t, -halfW + span * (k + 0.5), lip - 0.2, edge, span * 0.8, 0.32, 0.05);
    }
    ink(t, [248, 206, 137], "-", 0.85); cuboid(t, 0, lip - 0.06, edge - 0.15, w * 0.88, glowLine(1.3), glowLine(1.3));
    if (near) { ink(t, [60, 66, 70], "/"); for (const s of [-1, 1]) strutLocal(t, s * (halfW - 0.4), 3.3, front + 0.4, s * (halfW - 0.4), lip, edge - 0.1, 0.07); }
  } else if (awning === 1) {
    // A flat steel canopy on tie rods, lit from beneath.
    ink(t, [54, 62, 68], "="); cuboid(t, 0, 4.15, front + 1.55, w, 0.16, 2.6);
    ink(t, [248, 214, 160], "-", 1.05); cuboid(t, 0, 4.03, front + 2.75, w * 0.9, glowLine(1.9), glowLine(1.9));
    if (near) {
      ink(t, [74, 82, 88], "/");
      for (const s of [-0.35, 0.35]) strutLocal(t, s * w, 5.8, front + 0.2, s * w, 4.2, front + 2.8, 0.06);
      ink(t, [255, 236, 200], "o", 1.1);
      for (const s of [-0.3, -0.1, 0.1, 0.3]) cuboid(t, s * w, 4.03, front + 1.6, 0.25, 0.05, 0.25);
    }
  } else if (awning === 2) {
    // A short glass canopy with a light along its edge.
    ink(t, [104, 158, 176], "/", 0.42); cuboid(t, 0, 4.05, front + 1.05, w * 0.8, 0.06, 1.6);
    ink(t, accent, "-", 1.05); cuboid(t, 0, 4.0, front + 1.85, w * 0.8, glowLine(1.9), glowLine(1.9));
  }
  if (awning === 3 && !mid) {
    // Far off, a lantern line is a warm line along the fascia (single lanterns would blink in and out).
    ink(t, [255, 140, 80], "o", 0.9); cuboid(t, 0, 3.8, front + 0.9, w * 0.86, glowLine(1.5), glowLine(1.5));
  } else if (awning === 3 || (stall && close)) {
    // Paper lanterns on a line along the fascia, swaying in no wind (static: no motion to watch).
    const count = Math.max(3, Math.floor(w / 1.8)), out = awning === 3 ? 0.9 : awning === 0 ? 2.7 : awning === 1 ? 2.6 : 1.6;
    // Lantern bottoms stay above 3.1 m, clear of a walking eye (2.7 m).
    const hang = awning === 3 ? 4.2 : awning === 0 ? 3.85 : 4.0;
    if (awning === 3 && near) { ink(t, [40, 36, 34], "-"); cuboid(t, 0, hang + 0.02, front + out, w * 0.92, 0.04, 0.04); }
    for (let k = 0; k < count; k++) {
      const along = -halfW * 0.86 + (w * 0.86 * (k + 0.5)) / count;
      if (near) { ink(t, [60, 50, 40], "|"); cuboid(t, along, hang - 0.08, front + out, 0.03, 0.16, 0.03); }
      ink(t, k % 3 === 1 ? [255, 196, 96] : [255, 86, 64], "o", 1.0);
      const radius = Math.min(awning === 3 ? 0.7 : 0.4, Math.max(0.24, line * 0.5));
      ellipsoidLocal(t, along, hang - 0.45, front + out, radius, Math.max(0.3, radius), radius);
    }
  }
  if (!close) return;
  // Air conditioners high on the wall (above the fascia sign, which spans 4.3-8.5 m), dripping pipes.
  for (const s of [-1, 1]) {
    if (r(3 + s) < 0.35) continue;
    const ax = s * w * (0.22 + r(5 + s) * 0.18), ay = 9.4 + Math.floor(r(6 + s) * 3) * 3;
    ink(t, [92, 100, 104], "#"); cuboid(t, ax, ay, front + 0.4, 1.3, 0.85, 0.8);
    ink(t, [40, 46, 50], "@"); cuboid(t, ax + 0.18, ay, front + 0.81, 0.6, 0.6, 0.04);
    if (near) { ink(t, [70, 76, 80], "|"); cuboid(t, ax - 0.5, ay - 1.2, front + 0.3, 0.05, 1.6, 0.05); }
  }
  // Against the wall, either side of the windows: district street furniture.
  const things = WALL_THINGS[district] ?? WALL_THINGS[1];
  for (const s of [-1, 1]) {
    const pick = r(20 + s);
    if (pick < 0.3 || (stall && s < 0)) continue;
    drawWallThing(t, things[Math.floor(pick * 13) % things.length], s * (halfW - 1.35), front, r(24 + s), near);
  }
  if (stall) {
    // A street-food counter against the left window: counter, top, menu light, bowls and a pot.
    const cx = -(paneFrom + pane / 2), cw = Math.min(pane + 0.4, 4.4);
    ink(t, [124, 76, 50], "#", 0.9); cuboid(t, cx, 0.55, front + 0.42, cw, 1.1, 0.7);
    ink(t, [196, 160, 120], "=", 0.8); cuboid(t, cx, 1.14, front + 0.43, cw + 0.12, 0.08, 0.72);
    if (distance < 60) { ink(t, [255, 214, 140], "=", 1.05); cuboid(t, cx, 2.95, front + 0.17, cw * 0.8, 0.6, 0.04); }
    if (near) {
      ink(t, [210, 214, 206], "o", 0.8);
      for (let k = 0; k < 3; k++) ellipsoidLocal(t, cx - cw * 0.3 + k * cw * 0.2, 1.24, front + 0.5, 0.15, 0.08, 0.15);
      ink(t, [130, 136, 140], "#"); cuboid(t, cx + cw * 0.32, 1.38, front + 0.42, 0.42, 0.4, 0.42);
      // Stools only where the pavement is wide: small (0.34 m) clutter, never a wall to walk into.
      if (pavementRoom(building, side) > 1.8) for (let k = 0; k < 3; k++) {
        const seat = cx - cw * 0.3 + k * cw * 0.3;
        ink(t, [60, 62, 66], "|"); cuboid(t, seat, 0.32, front + 1.2, 0.06, 0.64, 0.06);
        ink(t, [150, 60, 54], "o"); cuboid(t, seat, 0.68, front + 1.2, 0.34, 0.08, 0.34);
      }
    }
  }
  if (district === 0) {
    // The Foundry: a service pipe along the wall over the fascia, with a downpipe at one end.
    ink(t, [104, 86, 74], "="); cuboid(t, 0, 5.45, front + 0.32, w - 0.6, Math.min(2, Math.max(0.28, line)), 0.28);
    ink(t, [96, 80, 70], "|"); cuboid(t, (r(30) < 0.5 ? -1 : 1) * (halfW - 0.75), 2.7, front + 0.32, Math.min(1, Math.max(0.26, line)), 5.4, 0.26);
  } else if (district === 2) {
    // Ghost Circuit: sagging cable bundles across the wall.
    ink(t, [40, 50, 66], "~");
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) {
      const y = 5.5 + k * 0.28;
      strutLocal(t, 0, y - 0.35, front + 0.36, s * (halfW - 0.6), y, front + 0.36, Math.max(0.06, line));
    }
  } else if (district === 3 && near) {
    // Rain Gardens: moss hanging from the fascia.
    ink(t, [70, 150, 96], "|", 0.85);
    for (let k = 0; k < 9; k++) { const length = 0.35 + r(40 + k) * 0.8; cuboid(t, -halfW + 0.8 + (w - 1.6) * (k / 8), 4.6 - length / 2, front + 0.46, 0.1, length, 0.04); }
  } else if (district === 1 && near) {
    // Neon Ward: a small projecting neon blade beside the door (within the wall's skin).
    ink(t, id % 2 ? [255, 96, 196] : [96, 236, 255], "|", 1.15); cuboid(t, door / 2 + 0.35, 2.9, front + 0.5, 0.1, 1.5, 0.5);
  }
}

function drawWallThing(t: PropCanvas, thing: WallThing, x: number, front: number, seed: number, near: boolean): void {
  if (thing === "vending") {
    const body: RGB = seed < 0.33 ? [178, 46, 58] : seed < 0.66 ? [44, 92, 168] : [196, 200, 204];
    ink(t, body, "#", 0.75); cuboid(t, x, 0.98, front + 0.38, 0.95, 1.95, 0.7);
    ink(t, seed < 0.5 ? [120, 236, 255] : [255, 220, 150], "=", 1.05); cuboid(t, x - 0.08, 1.35, front + 0.74, 0.62, 0.8, 0.03);
    if (near) { ink(t, [30, 34, 40], "-"); cuboid(t, x, 0.42, front + 0.74, 0.62, 0.16, 0.03); }
  } else if (thing === "bags") {
    ink(t, [34, 46, 40], "%");
    for (let k = 0; k < 3; k++) ellipsoidLocal(t, x - 0.35 + k * 0.35, 0.3 + (k === 1 ? 0.18 : 0), front + 0.38, 0.34, 0.3, 0.3);
  } else if (thing === "crates") {
    ink(t, [120, 92, 62], "#");
    cuboid(t, x - 0.2, 0.3, front + 0.38, 0.65, 0.6, 0.65); cuboid(t, x + 0.42, 0.25, front + 0.38, 0.5, 0.5, 0.6);
    if (near) cuboid(t, x - 0.12, 0.82, front + 0.38, 0.5, 0.44, 0.55);
  } else if (thing === "planter") {
    ink(t, [76, 84, 80], "="); cuboid(t, x, 0.3, front + 0.36, 1.5, 0.6, 0.62);
    ink(t, [64, 140, 92], "&"); ellipsoidLocal(t, x, 0.86, front + 0.36, 0.72, 0.45, 0.32);
  } else if (thing === "kiosk") {
    ink(t, [54, 62, 74], "#"); cuboid(t, x, 0.75, front + 0.32, 0.7, 1.5, 0.5);
    ink(t, seed < 0.5 ? [104, 210, 255] : [196, 140, 255], "=", 0.95); cuboid(t, x, 1.15, front + 0.58, 0.5, 0.42, 0.03);
  } else {
    // A bicycle leaning on the wall: two wheels in the wall's plane and a frame (thin parts: close up only).
    if (!near) return;
    ink(t, [40, 44, 50], "O");
    for (const s of [-1, 1]) { t.push(); t.translate(x + s * 0.5, -0.36, front + 0.35); t.rotateX(90); t.torus(0.33, 0.03); t.pop(); }
    ink(t, [200, 70, 60], "/"); strutLocal(t, x - 0.5, 0.36, front + 0.35, x + 0.12, 0.78, front + 0.35, 0.05); strutLocal(t, x + 0.12, 0.78, front + 0.35, x + 0.5, 0.36, front + 0.35, 0.05);
  }
}

/** Beam of square section `w` between two points of the current frame (y up). */
function strutLocal(t: PropCanvas, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number): void {
  const dx = bx - ax, dy = ay - by, dz = bz - az; // textmode Y points down
  t.push(); t.translate((ax + bx) / 2, -(ay + by) / 2, (az + bz) / 2);
  t.rotateY(Math.atan2(dx, dz) * 180 / Math.PI); t.rotateX(Math.atan2(Math.hypot(dx, dz), dy) * 180 / Math.PI);
  t.box(w, Math.hypot(dx, dy, dz), w); t.pop();
}
function ellipsoidLocal(t: PropCanvas, x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
  t.translate(x, -y, z); t.ellipsoid(rx, ry, rz); t.translate(-x, y, -z);
}
