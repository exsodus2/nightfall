import type { Textmodifier } from "textmode.js";
import { cuboid as box } from "./activity";
import type { Building, RGB } from "./world";
import { MESSAGES } from "./messages";

const MASONRY: readonly RGB[] = [[87, 65, 57], [72, 81, 83], [37, 69, 82], [69, 75, 61], [82, 67, 76], [80, 86, 82], [53, 80, 73], [47, 62, 78]];
export const BUILDING_TYPES = ["Brick tenement", "Concrete megablock", "Glass office", "Industrial works", "Terraced tower", "Market arcade", "Balcony apartments", "Signal tower"];

export interface BuildingPart { x: number; y: number; z: number; w: number; h: number; d: number; color: RGB; paper: RGB; alpha: number; surface: number; range: number; message: number }
const models = new WeakMap<Building, readonly BuildingPart[]>();
export function buildingParts(b: Building): readonly BuildingPart[] {
  const cached = models.get(b); if (cached) return cached;
  const parts: BuildingPart[] = [];
  let range = Infinity, surface = 0, tint = b.accent, message = 0;
  const part = (x: number,y: number,z: number,w: number,h: number,d: number) => parts.push({x,y:-y,z,w,h,d,color:tint,paper:MASONRY[b.style],alpha:32+b.style*28,surface,range,message});
  const { x, z, width: w, depth: d, height: h, style } = b;

  // Style is instance data, carried in an otherwise unused material alpha.
  // No per-building uniform changes, so textmode can batch entire facades.

  if (style === 4) {
    part(x, h * 0.23, z, w, h * 0.46, d);
    part(x - w * 0.1, h * 0.65, z, w * 0.8, h * 0.38, d * 0.83);
    part(x - w * 0.2, h * 0.91, z, w * 0.57, h * 0.18, d * 0.62);
  } else if (style === 7) {
    part(x, h * 0.4, z, w, h * 0.8, d);
    part(x, h * 0.91, z, w * 0.66, h * 0.22, d * 0.66);
    part(x, h + 10, z, 0.55, 20, 0.55);
  } else {
    part(x, (h + 8) / 2, z, w * 0.93, h - 8, d * 0.93);
    part(x, 4, z, w, 8, d);
    if (style === 1) {
      for (const side of [-1, 1]) part(x + side * w * 0.42, h / 2, z, w * 0.13, h + 3, d * 1.03);
    } else if (style === 3) {
      for (const side of [-1, 1]) part(x + side * w * 0.3, h + 8, z, 1.9, 18, 1.9);
    } else if (style === 2) {
      part(x, h + 1.5, z, w + 0.5, 3, d + 0.5);
    }
  }
  range = 230;
  if (style === 0 || style === 6) {
    // Deep balcony shadows and continuous fire escapes retain their silhouette.
    for (let y = 10; y < Math.min(h - 1, 58); y += style === 6 ? 5 : 8) {
      part(x, y, z + d / 2 + 0.7, w * 0.82, 0.25, 2);
      {
        range = 130;
        part(x, y + 1, z + d / 2 + 1.7, w * 0.82, 0.13, 0.1);
        for (const side of [-1, 1]) part(x + side * w * 0.4, y + 0.5, z + d / 2 + 1.7, 0.12, 1, 0.12);
        range = 230;
      }
    }
  } else if (style === 3) {
    for (const side of [-1, 1]) part(x + side * w * 0.4, h * 0.36, z + d * 0.51, 0.7, h * 0.72, 0.7);
    part(x, 14, z + d * 0.52, w * 1.05, 0.7, 0.7);
  }
  part(x + w * 0.22, h + 1.3, z, 3, 2.6, 3.5);
  // News tickers wrap the whole tower, so their text scrolls around the corners. Tall towers
  // carry a giant crown band readable across the city; some podiums carry a street-level one.
  if (b.id % 5 === 0 || Math.abs(x) < 30 && b.id % 3 === 0) {
    surface = 6; message = b.id % MESSAGES.length;
    if (h > 95 && b.id % 2 === 0 && style !== 4 && style !== 7) part(x, h - 9, z, w * 0.93 + 0.5, 5, d * 0.93 + 0.5);
    else part(x, 10.2, z, w + 0.5, 2.3, d + 0.5);
    surface = 0;
  }
  range = 130;
  // Roof equipment is shaded metal, with tiny warning lights at the top.
  surface = 2;
  tint = [50, 60, 62]; part(x - w * 0.22, h + 2, z + 1, 3.4, 4, 3.4);
  if (style === 7 || style === 2) {
    tint = [209, 63, 63]; part(x, h + (style === 7 ? 20 : 3.5), z, 0.5, 0.5, 0.5);
  }
  models.set(b, parts); return parts;
}

/** Reference implementation retained for visual equivalence checks. */
export function drawBuilding(t: Textmodifier, b: Building, distance: number): void {
  for (const p of buildingParts(b)) {
    if (distance >= p.range) continue;
    t.setUniform("u_surface",p.surface); t.char("#"); t.charColor(...p.color); t.cellColor(...p.paper,p.alpha);
    box(t,p.x,-p.y,p.z,p.w,p.h,p.d);
  }
}
