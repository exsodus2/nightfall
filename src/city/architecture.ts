import type { Textmodifier } from "textmode.js";
import { cuboid as box } from "./activity";
import { DISTRICTS, FORM, SKIN, randomFor, type Building, type RGB } from "./world";
import { MESSAGES } from "./messages";

/** Paper (cell) colour of each facade skin: the mass reads through the paper. 0-7 are the eight
 * building types' facades, 8-11 the extra building skins (world.ts SKIN), 12-15 part materials. */
const MASONRY: readonly RGB[] = [
  [87, 65, 57], [72, 81, 83], [37, 69, 82], [69, 75, 61], [82, 67, 76], [80, 86, 82], [53, 80, 73], [47, 62, 78],
  [86, 62, 50], [31, 50, 66], [77, 79, 81], [54, 73, 57],
  [62, 68, 70], [26, 26, 30], [48, 56, 60], [20, 26, 30],
];
export const BUILDING_TYPES = ["Brick tenement", "Concrete megablock", "Glass office", "Industrial works", "Terraced tower", "Market arcade", "Balcony apartments", "Signal tower"];
/** Part materials the facade shader draws without windows (materials.ts `style >= 12`). */
export const PART_SKIN = { MACHINE: 12, NEON: 13, LATTICE: 14, SCREEN: 15 } as const;
const { MACHINE, NEON, LATTICE, SCREEN } = PART_SKIN;
/** Facade parts (SURFACE 0) carry these shader flags in the ink alpha; tickers (SURFACE 6) use the
 * same channel for their message row. */
export const FLAG = { CROWN: 1, CORNERS: 2, DIM: 4, STAINS: 8, BANDS: 16, PULSE: 32 } as const;
/** Skin 0-15 packed in the paper alpha, 16 steps (materials.ts decodes `(a * 255 - 8) / 16`). */
export const skinAlpha = (skin: number): number => 8 + skin * 16;
// Each district's skins lean slightly toward its colour: Foundry rust, Ghost Circuit steel blue.
const PAPERS: readonly (readonly RGB[])[] = DISTRICTS.map(district => MASONRY.map((m, skin): RGB => {
  const lean = (i: number) => Math.round(Math.max(8, m[i] + (district.color[i] - 150) * 0.07));
  return skin >= MACHINE ? m : [lean(0), lean(1), lean(2)];
}));

export interface BuildingPart { x: number; y: number; z: number; w: number; h: number; d: number; color: RGB; paper: RGB; alpha: number; surface: number; range: number; message: number }
interface Mass { x: number; z: number; w: number; d: number; y0: number; y1: number }
const models = new WeakMap<Building, readonly BuildingPart[]>();

/**
 * Every box of one building, built once and cached: the massing family (world.ts FORM) - slabs,
 * podium towers, ziggurats, twins joined by sky bridges, cantilevers, container megablocks,
 * supertall spires, shanty roofs - then district roof kits (water tanks on stilts, AC banks,
 * chimneys, pipe runs, antenna arrays with aviation lights, billboards, helipads, greenhouses,
 * planters) and facade retrofits (scaffolding, X-bracing, container modules, balconies).
 * Rules every family keeps:
 * - the plot footprint is solid from the ground to at least `anchor` (shopfronts, awnings, fascia
 *   and blade signs, hologram screens hang on it) and collision stays the plot rectangle;
 * - nothing reaches more than 1.2 m past the plot or 11.6 m from its centre (the 26 m plot pitch
 *   leaves the mid-block gap and the viaduct portal legs clear) and nothing overhangs the street
 *   below 30 m;
 * - visibility.ts treats types 7 and 4 as slim cores: every setback family is typed 7 (a centred
 *   0.64 x 0.64 core is solid up to `height`) or 4; the rest keep a 0.89 core. Crowns, twins and
 *   needles may rise above `height`;
 * - thin parts get a draw range from their size (about a third of a cell when they retract), so
 *   sub-cell geometry never crawls in the distance.
 */
export function buildingParts(b: Building): readonly BuildingPart[] {
  const cached = models.get(b); if (cached) return cached;
  const parts: BuildingPart[] = [];
  const { x, z, width: w, depth: d, height: h, style, id } = b;
  const form = b.form ?? (style === 4 ? FORM.TERRACED : style === 7 ? FORM.SIGNAL : FORM.SLAB);
  const main = b.skin ?? style, district = Math.max(0, Math.min(5, b.district));
  const rnd = (k: number) => randomFor(id, 977, k);
  const papers = PAPERS[district];
  let range = Infinity, surface = 0, tint: RGB = b.accent, message = 0, skin = main, flags = 0;
  // Style is instance data, carried in an otherwise unused material alpha (and flags in the ink
  // alpha). No per-building uniform changes, so textmode can batch entire facades.
  const part = (px: number, py: number, pz: number, pw: number, ph: number, pd: number) => {
    const minor = Math.min(pw, ph, pd), major = Math.max(pw, ph, pd), fine = 360 * Math.max(minor, 0.3 * (pw + ph + pd - minor - major));
    parts.push({ x: px, y: -py, z: pz, w: pw, h: ph, d: pd, color: tint, paper: papers[skin], alpha: skinAlpha(skin), surface, range: fine > 1500 ? range : Math.min(range, fine), message: surface === 6 ? message : flags });
  };
  const masses: Mass[] = [];
  const mass = (mx: number, mz: number, mw: number, md: number, y0: number, y1: number, s = main, f = 0): Mass => {
    const saved = [skin, flags] as const; skin = s; flags = f;
    part(mx, (y0 + y1) / 2, mz, mw, y1 - y0, md);
    [skin, flags] = saved;
    const m = { x: mx, z: mz, w: mw, d: md, y0, y1 }; masses.push(m); return m;
  };
  // Street anchors: blade signs (signage.ts) and hologram screens (engine.ts) hang on the plot face.
  const blade = id % 7 === 0 || (Math.abs(x) < 30 && id % 2 === 0);
  const bladeTop = 8 + b.sign.split(" ")[0].slice(0, 7).length * (id % 4 === 0 ? 4.8 : 3.8) + 1.5;
  const anchor = Math.min(h * 0.72, Math.max(9, blade ? bladeTop : 0, id % 17 === 0 ? 34 : 0));
  const reachX = Math.min(w / 2 + 1.2, 11.6), reachZ = Math.min(d / 2 + 1.2, 11.6);
  const neon = district === 1, ghost = district === 2;
  // Lit parapets and neon corners mark the Neon Ward and Ghost Circuit skylines; the Spillway and
  // Foundry streak with rain stains; half of Ghost Circuit's windows are dead.
  const crown = neon || (ghost && rnd(1) < 0.5) || (district === 4 && rnd(1) < 0.2) ? FLAG.CROWN : 0;
  const weather = (district === 0 || district === 5) && rnd(2) < 0.7 ? FLAG.STAINS : 0;
  const dim = ghost && rnd(3) < 0.5 ? FLAG.DIM : 0;
  const towerFlags = weather | dim | ((neon || ghost) && rnd(5) < 0.4 ? FLAG.BANDS : 0) | (neon && rnd(6) < 0.5 ? FLAG.CORNERS : 0);
  // Podiums are what the player sees from the street, so they keep the tower's own masonry; only
  // glass towers (2, 9) stand on a darker masonry base. The pale skins (1 concrete, 4, 5 arcade)
  // washed out under the street lamps when every podium tower in Neon Ward and Silk Market wore them.
  const podiumSkin = style !== 7 && style !== 4 ? style : main !== 2 && main !== SKIN.CURTAIN ? main : [3, 7, 7, 6, 0, 0][district];
  const roofs: Mass[] = [];
  let top: Mass | undefined, body: Mass | undefined;

  if (form === FORM.TERRACED) {
    const t1 = Math.max(h * 0.46, anchor);
    roofs.push(mass(x, z, w, d, 0, t1, main, weather));
    roofs.push(mass(x - w * 0.1, z, w * 0.8, d * 0.83, t1, h * 0.84, main, weather));
    top = mass(x - w * 0.2, z, w * 0.57, d * 0.62, h * 0.82, h, main, weather | crown);
  } else if (form === FORM.SIGNAL) {
    body = mass(x, z, w, d, 0, h * 0.8, main, towerFlags);
    top = mass(x, z, w * 0.66, d * 0.66, h * 0.8, h * 1.02, main, towerFlags | crown);
    roofs.push(body);
  } else if (form === FORM.PODIUM || form === FORM.SPIRE) {
    const spire = form === FORM.SPIRE;
    const podium = Math.min(h * 0.6, Math.max(anchor, spire ? 24 : 12 + rnd(7) * 14));
    roofs.push(mass(x, z, w, d, 0, podium, podiumSkin, weather));
    const tw = w * (spire ? 0.7 : 0.66 + rnd(8) * 0.12), td = d * (spire ? 0.7 : 0.66 + rnd(9) * 0.14);
    if (spire) {
      // Supertall: a shaft, a slimmer upper shaft, stepped crowns and a lit needle.
      mass(x, z, tw, td, podium, h * 0.62, main, towerFlags | FLAG.CORNERS);
      body = mass(x, z, w * 0.66, d * 0.66, h * 0.62, h, main, towerFlags | FLAG.CORNERS | FLAG.CROWN);
      mass(x, z, w * 0.5, d * 0.5, h, h + 9, main, towerFlags | FLAG.CROWN);
      top = mass(x, z, w * 0.34, d * 0.34, h + 9, h + 16, main, towerFlags | FLAG.CROWN);
    } else {
      body = mass(x, z, tw, td, podium, h, main, towerFlags | crown);
      top = rnd(10) < 0.55 ? mass(x, z, tw * 0.72, td * 0.72, h, h + 5 + rnd(11) * 6, main, towerFlags | crown) : body;
    }
  } else if (form === FORM.ZIGGURAT) {
    const steps = [1, 0.86, 0.74, 0.66], tops = [Math.max(h * 0.34, anchor), h * 0.6, h * 0.82, h];
    let y0 = 0;
    steps.forEach((s, i) => { if (tops[i] <= y0 + 3) return; const tier = mass(x, z, w * s, d * s, y0, tops[i], main, weather | dim | crown); top = tier; roofs.push(tier); y0 = tops[i]; });
    roofs.pop();
  } else if (form === FORM.TWIN) {
    // Twin towers over a podium, joined by a recessed glass core and sky bridges across the notch.
    const alongX = w >= d, L = alongX ? w : d, D = alongX ? d : w;
    const podium = Math.min(h * 0.55, Math.max(anchor, 10 + rnd(7) * 8));
    roofs.push(mass(x, z, w, d, 0, podium, podiumSkin, weather));
    const at = (u: number, v: number) => alongX ? [x + u, z + v] as const : [x + v, z + u] as const;
    const dims = (l: number, dd: number) => alongX ? [l, dd] as const : [dd, l] as const;
    const tall = h * (1.1 + rnd(12) * 0.16), side = rnd(13) < 0.5 ? -1 : 1;
    for (const s of [-1, 1]) {
      const [cx, cz] = at(s * L * 0.31, 0), [bw, bd] = dims(L * 0.38, D * 0.92);
      const t = mass(cx, cz, bw, bd, podium, s === side ? tall : h, main, towerFlags | crown);
      if (s === side) top = t; else roofs.push(t);
    }
    const [cw, cd] = dims(L * 0.26, D * 0.66);
    mass(x, z, cw, cd, podium, h, SKIN.CURTAIN, dim);
    for (const f of [0.38, 0.72]) {
      const y = podium + (h - podium) * f;
      if (y + 3 > h) continue;
      for (const v of [-1, 1]) {
        const [bx, bz] = at(0, v * D * 0.395), [bw, bd] = dims(L * 0.26, D * 0.13);
        flags = FLAG.CROWN; skin = SKIN.CURTAIN; part(bx, y + 1.5, bz, bw, 3, bd); skin = main; flags = 0;
      }
    }
  } else {
    // Slabs: a full podium and a 0.93 body (0.9 for megablocks, whose containers stand proud).
    const inset = form === FORM.MEGABLOCK ? 0.9 : 0.93;
    body = mass(x, z, w * inset, d * inset, 8, h, main, towerFlags | (form === FORM.CANTILEVER ? 0 : crown));
    mass(x, z, w, d, 0, 8, form === FORM.MEGABLOCK ? podiumSkin : main, weather);
    top = body;
    if (form === FORM.SLAB || form === FORM.SHANTY) {
      if (style === 1) {
        for (const s of [-1, 1]) part(x + s * w * 0.42, h / 2, z, w * 0.13, h + 3, d * 1.03);
      } else if (style === 3) {
        skin = MACHINE; tint = [255, 132, 60]; flags = FLAG.CROWN;
        for (const s of [-1, 1]) part(x + s * w * 0.3, h + 8, z, 1.9, 18, 1.9);
        flags = 0; tint = b.accent; skin = main;
      } else if (style === 2) {
        part(x, h + 1.5, z, w + 0.5, 3, d + 0.5);
      }
    }
    const y0 = Math.max(30, h * (0.48 + rnd(8) * 0.12));
    if (form === FORM.CANTILEVER && h - y0 >= 12) {
      // An upper block slides out over one side, its edges lit; floors above step back in.
      const s = rnd(7) < 0.5 ? -1 : 1, y1 = Math.min(h, y0 + Math.max(10, h * 0.2));
      const left = x - s * w * 0.465, right = x + s * reachX;
      mass((left + right) / 2, z, Math.abs(right - left), Math.min(d + 1.2, reachZ * 2), y0, y1, main, towerFlags | FLAG.CORNERS | FLAG.CROWN);
      if (h - y1 > 10 && rnd(9) < 0.6) top = mass(x - s * w * 0.12, z, w * 0.62, d * 0.8, h, h + 4 + rnd(10) * 6, main, towerFlags | crown);
    }
  }
  const crownMass = top ?? masses[masses.length - 1];
  roofs.push(crownMass);

  range = 240;
  // Facade retrofits. Containers on megablocks, X-bracing on works, scaffolding in the Spillway.
  if (form === FORM.MEGABLOCK && body) {
    skin = SKIN.CORRUGATED;
    for (let k = 0; k < 14; k++) {
      const face = Math.floor(rnd(20 + k) * 4), long = rnd(40 + k) < 0.6, y = 10 + Math.floor(rnd(60 + k) * Math.max(1, (h - 14) / 2.7)) * 2.7;
      if (y + 2.6 > h) continue;
      const alongZ = face < 2, s = face % 2 ? 1 : -1, span = long ? 6.1 : 3;
      const extent = alongZ ? d : w, offset = (rnd(80 + k) - 0.5) * Math.max(0, extent * 0.88 - span);
      const proud = Math.min(0.4 + rnd(100 + k) * 0.6, (alongZ ? reachX - w * 0.45 : reachZ - d * 0.45) - 0.4), depth = proud + 0.6;
      if (alongZ) part(x + s * (w * 0.45 + proud - depth / 2), y + 1.3, z + offset, depth, 2.6, span);
      else part(x + offset, y + 1.3, z + s * (d * 0.45 + proud - depth / 2), span, 2.6, depth);
    }
    skin = main;
  }
  if ((form === FORM.MEGABLOCK || (style === 3 && form === FORM.SLAB) || (district === 0 && rnd(14) < 0.35)) && body && body.y1 - body.y0 > 16) {
    // Exposed X-bracing panels on the two side faces.
    skin = LATTICE; tint = [92, 104, 108];
    const y0 = body.y0 + 2, y1 = body.y0 + (body.y1 - body.y0) * (0.5 + rnd(15) * 0.4);
    for (const s of [-1, 1]) part(body.x + s * (body.w / 2 + 0.2), (y0 + y1) / 2, body.z, 0.5, y1 - y0, body.d * 0.62);
    skin = main; tint = b.accent;
  }
  if ((form === FORM.SHANTY || (district === 5 && rnd(16) < 0.4)) && body) {
    // Scaffolding over part of a street face, clear of the awnings below.
    skin = LATTICE; tint = [120, 104, 70];
    const s = rnd(17) < 0.5 ? -1 : 1, sw = w * (0.45 + rnd(18) * 0.35), y1 = 5 + (body.y1 - 5) * (0.3 + rnd(19) * 0.45);
    const proud = Math.min(0.9, reachZ - d * 0.465);
    part(x + (rnd(21) - 0.5) * (w - sw), (5 + y1) / 2, z + s * (d * 0.465 + proud / 2), sw, y1 - 5, proud);
    skin = main; tint = b.accent;
  }
  if ((main === 0 || main === 6) && body && (form === FORM.SLAB || form === FORM.SHANTY || form === FORM.CANTILEVER)) {
    // Deep balcony shadows and continuous fire escapes retain their silhouette.
    for (let y = 10; y < Math.min(h - 1, 58); y += main === 6 ? 5 : 8) {
      range = 240; part(x, y, z + d / 2 + 0.7, w * 0.82, 0.25, 2);
      range = 130;
      part(x, y + 1, z + d / 2 + 1.7, w * 0.82, 0.13, 0.1);
      for (const s of [-1, 1]) part(x + s * w * 0.4, y + 0.5, z + d / 2 + 1.7, 0.12, 1, 0.12);
    }
    range = 240;
  } else if (style === 3 && form === FORM.SLAB) {
    skin = MACHINE; tint = [70, 80, 84];
    for (const s of [-1, 1]) part(x + s * w * 0.4, h * 0.36, z + d * 0.51, 0.7, h * 0.72, 0.7);
    part(x, 14, z + d * 0.52, w * 1.05, 0.7, 0.7);
    skin = main; tint = b.accent;
  }

  // Roof kits, by district. Positions are fractions of the roof (-0.5..0.5), kept inside it.
  const on = (r: Mass, u: number, v: number, pw: number, ph: number, pd: number, lift = 0) =>
    part(r.x + u * Math.max(0, r.w - pw), r.y1 + lift + ph / 2, r.z + v * Math.max(0, r.d - pd), pw, ph, pd);
  const sx = ((x % 64) + 64) % 64 < 32 ? -1 : 1, sz = ((z % 64) + 64) % 64 < 32 ? -1 : 1;
  roofs.forEach((r, index) => {
    const isTop = index === roofs.length - 1, k = 200 + index * 40, area = r.w * r.d;
    if (r.w < 4 || r.d < 4) return;
    flags = 0;
    // Terraces in the Rain Gardens (and some Silk Market roofs) carry planter rows.
    if (!isTop && (district === 3 || rnd(k) < 0.25) && r.y1 < h) {
      skin = SKIN.GARDEN; tint = [107, 226, 162];
      for (const v of [-0.5, 0.5]) on(r, 0, v, r.w * 0.9, 0.9, 1.3);
      skin = main; tint = b.accent;
      return;
    }
    if (!isTop && area < 140) return;
    // Air-conditioning bank.
    skin = MACHINE; tint = [96, 120, 124]; range = 170;
    const units = 2 + Math.floor(rnd(k + 1) * 3);
    for (let i = 0; i < units; i++) on(r, -0.45 + i * 0.22, -0.42 * sz, 1.8, 1.3, 1.6);
    range = 260;
    if (!isTop) { skin = main; tint = b.accent; return; }
    // Stair and lift bulkhead.
    let pad = false;
    if ((neon || ghost) && r.y1 > 88 && r.w >= 11 && r.d >= 11 && rnd(k + 2) < 0.45) {
      // Helipad: H marking and lit edge on the pad's top face (materials.ts SCREEN roof).
      skin = SCREEN; tint = [255, 196, 112]; flags = FLAG.CROWN;
      on(r, 0, 0, r.w * 0.82, 0.6, r.d * 0.82); pad = true; flags = 0;
    } else { skin = main; part(r.x - sx * r.w * 0.22, r.y1 + 1.3, r.z, Math.min(3, r.w * 0.3), 2.6, Math.min(3.5, r.d * 0.3)); }
    const kit = rnd(k + 3);
    if (district === 0 || form === FORM.MEGABLOCK) {
      // Foundry: chimneys with glowing rims and pipe runs.
      skin = MACHINE; tint = [255, 120, 52]; flags = FLAG.CROWN;
      for (let i = 0; i < 1 + Math.floor(kit * 2); i++) on(r, (rnd(k + 4 + i) - 0.5) * 0.8, 0.35 * sz, 1.8, 7 + rnd(k + 6 + i) * 9, 1.8);
      flags = 0; tint = [80, 90, 92];
      on(r, 0.3, 0, 0.7, 0.7, r.d * 0.8, 0.4); on(r, 0, 0.1, r.w * 0.7, 0.7, 0.7, 0.4);
    }
    if (ghost || form === FORM.SIGNAL) {
      // Antenna array: lattice masts of mixed heights, an aviation light on the tallest.
      let tallest = 0, tu = 0, tv = 0;
      for (let i = 0; i < 2 + Math.floor(kit * 3); i++) {
        const u = (rnd(k + 10 + i) - 0.5) * 0.85, v = (rnd(k + 15 + i) - 0.5) * 0.85, mh = 6 + rnd(k + 20 + i) * (form === FORM.SIGNAL ? 22 : 14);
        if (pad && Math.abs(u) < 0.42 && Math.abs(v) < 0.42) continue;
        skin = LATTICE; tint = [120, 136, 150]; on(r, u, v, 0.9, mh, 0.9);
        if (mh > tallest) { tallest = mh; tu = u; tv = v; }
      }
      if (tallest > 0) { skin = NEON; tint = [255, 52, 40]; flags = FLAG.PULSE; on(r, tu, tv, 1.2, 1.2, 1.2, tallest); flags = 0; }
      if (ghost && !pad) { skin = MACHINE; tint = [140, 150, 170]; on(r, -0.3, 0.3 * sz, 2.6, 1.3, 2.6, 0.9); on(r, -0.3, 0.3 * sz, 0.8, 0.9, 0.8); }
    }
    if ((neon && kit < 0.7) || (ghost && kit < 0.35) || (district === 4 && kit < 0.3) || (district === 5 && kit < 0.15)) {
      if (!pad && r.w >= 9 && r.y1 > 26) {
        // Rooftop billboard on lattice legs, facing the nearest street.
        const bw = r.w * 0.8, bh = 4.5 + rnd(k + 30) * 4;
        skin = LATTICE; tint = [90, 100, 106]; on(r, 0, 0.5 * sz, bw, 2.4, 0.5);
        skin = SCREEN; tint = b.accent; flags = ghost || rnd(k + 31) < 0.3 ? FLAG.DIM : 0; on(r, 0, 0.5 * sz, bw, bh, 0.6, 2.4); flags = 0;
      }
    }
    if (district === 4 || district === 5) {
      // Water tank on stilts.
      const u = 0.32 * sx, v = 0.12 * sz;
      skin = LATTICE; tint = [110, 96, 80]; on(r, u, v, 2.2, 2.4, 2.2);
      skin = MACHINE; tint = [122, 92, 66]; on(r, u, v, 2.8, 3.2, 2.8, 2.4);
    }
    if (district === 3 && !pad) {
      // Greenhouse: a glazed hall with a ridge.
      skin = SKIN.CURTAIN; tint = [107, 226, 162];
      on(r, 0.15 * sx, 0.2 * sz, r.w * 0.5, 3.2, r.d * 0.45); on(r, 0.15 * sx, 0.2 * sz, r.w * 0.34, 1.4, r.d * 0.2, 3.2);
    }
    if (form === FORM.SHANTY || (district === 5 && kit > 0.5)) {
      // Shacks of corrugated sheet stacked on the roof.
      skin = SKIN.CORRUGATED; tint = [180, 120, 80];
      for (let i = 0; i < 2 + Math.floor(rnd(k + 40) * 2); i++) {
        const sw = 3 + rnd(k + 41 + i) * 3, sd = 3 + rnd(k + 45 + i) * 2.5, shh = 2.6 + rnd(k + 49 + i) * 0.6;
        on(r, (rnd(k + 53 + i) - 0.5), (rnd(k + 57 + i) - 0.5), sw, shh, sd, i === 2 ? 2.8 : 0);
      }
    }
    if (form === FORM.SIGNAL || form === FORM.SPIRE) {
      // The signal mast / spire needle, lattice with a beacon.
      const mh = form === FORM.SPIRE ? 30 : 20;
      skin = LATTICE; tint = [150, 160, 170]; on(r, 0, 0, 1.3, mh, 1.3);
      skin = NEON; tint = [255, 52, 40]; flags = FLAG.PULSE; on(r, 0, 0, 1.4, 1.4, 1.4, mh); flags = 0;
    }
    skin = main; tint = b.accent;
  });
  range = Infinity; flags = 0; skin = main;
  // News tickers wrap the whole tower, so their text scrolls around the corners. Tall towers
  // carry a giant crown band readable across the city; some podiums carry a street-level one.
  if (b.id % 5 === 0 || Math.abs(x) < 30 && b.id % 3 === 0) {
    surface = 6; message = b.id % MESSAGES.length;
    const crownBand = masses.filter(m => m.y1 >= h - 0.5 && m.y1 - m.y0 > 14 && m.w > 6 && m.d > 6).sort((a, c) => c.w * c.d - a.w * a.d)[0];
    const street = masses.filter(m => m.y0 <= 9 && m.y1 >= 12).sort((a, c) => a.w * a.d - c.w * c.d)[0];
    if (h > 95 && b.id % 2 === 0 && crownBand) part(crownBand.x, crownBand.y1 - 9, crownBand.z, crownBand.w + 0.5, 5, crownBand.d + 0.5);
    else if (street) part(street.x, 10.2, street.z, street.w + 0.5, 2.3, street.d + 0.5);
    surface = 0;
  }
  models.set(b, parts); return parts;
}

/** Top of the highest roof (crowns and twins included; masts, gear and needles excluded). Can be
 * above `height`, which is the top of the solid core visibility.ts relies on. */
export function roofTop(b: Building): number {
  let top = b.height;
  for (const p of buildingParts(b)) if (p.surface === 0 && p.alpha < skinAlpha(PART_SKIN.MACHINE) && p.w > 4 && p.d > 4) top = Math.max(top, -p.y + p.h / 2);
  return top;
}

/** Reference implementation retained for visual equivalence checks. */
export function drawBuilding(t: Textmodifier, b: Building, distance: number): void {
  for (const p of buildingParts(b)) {
    if (distance >= p.range) continue;
    t.setUniform("u_surface",p.surface); t.char("#"); t.charColor(...p.color); t.cellColor(...p.paper,p.alpha);
    box(t,p.x,-p.y,p.z,p.w,p.h,p.d);
  }
}
