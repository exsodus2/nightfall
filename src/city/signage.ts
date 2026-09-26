import type { PropCanvas } from "./prop-canvas";
import type { Building, RGB } from "./world";
import { cuboid, ink, propAlpha, propRange, restorePropRange } from "./activity";


export interface SignFace { x: number; y: number; z: number; yaw: number; width: number; height: number; text: string; color: RGB; vertical?: boolean }

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
    codes = [...face.text.toUpperCase().slice(0, 12).padEnd(12)].map(c => Math.max(0, " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".indexOf(c)));
    encoded.set(face.text, codes);
  }
  const pack = (offset: number) => codes[offset] + codes[offset + 1] * 64 + codes[offset + 2] * 4096 + codes[offset + 3] * 262144;
  const seed = Math.abs(Math.sin(face.x * 12.9898 + face.z * 78.233 + face.y) * 43758.5453) % 1;
  t.setUniforms({ u_surface: 3, u_text0: pack(0), u_text1: pack(4), u_text2: pack(8), u_textLength: Math.min(12, face.text.length), u_vertical: face.vertical ? 1 : 0, u_signSeed: seed });
  t.push(); t.translate(face.x, -face.y, face.z); t.rotateY(face.yaw);
  t.charColor(...face.color); t.cellColor(3, 8, 12, propAlpha()); t.rect(face.width, face.height); t.pop();
  t.setUniform("u_surface", 2);
}

export function drawShop(t: PropCanvas, building: Building, distance: number, eye: { x: number; z: number }, visible: (x: number, y: number, z: number, radius?: number) => boolean, range = 300): void {
  const { x, z, width, depth, accent, id } = building;
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
  // Recessed shop windows, lintels and illuminated awnings on both street faces.
  for (const side of [0, 1]) {
    if (side ? (eye.x - x) * sx < width / 2 : (eye.z - z) * sz < depth / 2) continue;
    const face = faces[side ? 1 : 0];
    if (!visible(face.x, 3, face.z, (side ? depth : width) / 2 + 1)) continue; // the awning spans the whole face
    t.push(); t.translate(x, 0, z); t.rotateY(side ? sx * 90 : sz > 0 ? 0 : 180);
    const w = side ? depth : width, front = (side ? width : depth) / 2;
    ink(t, [13, 27, 34], "="); cuboid(t, 0, 2.5, front + 0.1, w - 1, 4.4, 0.3);
    ink(t, id % 3 ? [161, 146, 104] : [68, 164, 159], "H", 0.55);
    for (const offset of [-0.3, 0.3]) cuboid(t, offset * w, 2.4, front + 0.35, w * 0.27, 3.1, 0.1);
    ink(t, [17, 30, 35], "|"); cuboid(t, 0, 2.2, front + 0.3, w * 0.19, 4.1, 0.15);
    ink(t, accent, "=", 0.45); cuboid(t, 0, 4.1, front + 1.7, w, 0.24, 3.5);
    ink(t, [248, 206, 137], "-", 0.85); cuboid(t, 0, 3.96, front + 3.3, w * 0.88, 0.12, 0.12);
    if (distance < 140) {
      const storefront = propRange(140);
      ink(t, [57, 73, 77], "=");
      for (const offset of [-0.4, 0.4]) {
        cuboid(t, offset * w, 1, front + 1.3, 1.5, 2, 0.9);
        cuboid(t, offset * w, 7.8, front + 0.7, 2.4, 1.4, 1.2);
      }
      if (id % 3 === 0) {
        ink(t, [181, 113, 71], "#", 0.65); cuboid(t, 0, 1.15, front + 2.6, w * 0.66, 1.7, 1.2);
        ink(t, [245, 188, 108], "O");
        for (let i = -2; i <= 2; i++) cuboid(t, i * 1.5, 3.2, front + 2.8, 0.7, 0.8, 0.7);
      }
      restorePropRange(storefront);
    }
    t.pop();
  }
  restorePropRange(outer);
}
