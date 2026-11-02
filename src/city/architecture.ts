import type { Textmodifier } from "textmode.js";
import { cuboid as box } from "./activity.ts";
import { BLOCK_SIZE, DISTRICTS, FORM, SKIN, randomFor, type Building, type RGB } from "./world.ts";
import { MESSAGES } from "./messages.ts";

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
export const FLAG = {
  CROWN: 1, CORNERS: 2, DIM: 4, STAINS: 8, BANDS: 16,
  /** On a neon part a slow fade; on a tower mass an external glass lift up one face, and on a
   * lattice lift shaft (the lift-core family) its car, both gliding slowly (materials.ts). */
  PULSE: 32,
  /** An unlit tower: few warm windows, no neon. With CROWN its top corner carries one red aviation light. */
  DARK: 64,
  /** Capsule hotel: a dense grid of pod hatches, some showing a red do-not-disturb lamp. */
  CAPSULE: 128,
} as const;
/** Skin 0-15 packed in the paper alpha, 16 steps (materials.ts decodes `(a * 255 - 8) / 16`). */
export const skinAlpha = (skin: number): number => 8 + skin * 16;
/** Share of each district's tall setback/slab towers that stand dark (FLAG.DARK): most in Neon
 * Ward, where every other tower is crowned in neon; none in the low Spillway. */
export const DARK_SHARE: readonly number[] = [0.2, 0.3, 0.2, 0.15, 0.25, 0];
// Each district's skins lean slightly toward its colour: Foundry rust, Ghost Circuit steel blue.
const PAPERS: readonly (readonly RGB[])[] = DISTRICTS.map(district => MASONRY.map((m, skin): RGB => {
  const lean = (i: number) => Math.round(Math.max(8, m[i] + (district.color[i] - 150) * 0.07));
  return skin >= MACHINE ? m : [lean(0), lean(1), lean(2)];
}));

export interface BuildingPart { x: number; y: number; z: number; w: number; h: number; d: number; color: RGB; paper: RGB; alpha: number; surface: number; range: number; message: number }
interface Mass { x: number; z: number; w: number; d: number; y0: number; y1: number; part: number }
const models = new WeakMap<Building, readonly BuildingPart[]>();

/** Rooftop venues, one kind per district (indexed by district id): the static kit is built here in
 * the building batch; the deck, parapet rail, lit fittings and the life (lantern strings, figures,
 * embers, pigeons, the radio dish, the bar's name sign) are recorded per frame within 180 m of the
 * camera by rooftop-life.ts. */
export const VENUE = { FORGE: 0, BAR: 1, RADIO: 2, FARM: 3, GARDEN: 4, LOFT: 5 } as const;
export const VENUE_NAMES: readonly string[] = ["forge vent", "rooftop bar", "pirate radio shack", "terrace farm", "rooftop garden", "pigeon loft"];
/** Share of the venue candidate plots (one plot on every other block, checkerboard) that open one,
 * by district: about 4% of each district's mid-height roofs (a little more for Neon Ward's bars). */
export const VENUE_SHARE: readonly number[] = [0.32, 0.4, 0.5, 0.36, 0.8, 0.28];
/** Venues take mid-height roofs: high enough to overlook the street, low enough to be seen. */
export const VENUE_HEIGHT: readonly [number, number] = [14, 72];
/** The top roof of a building, as rooftop-life.ts needs it. */
export interface RoofSpot {
  id: number; district: number;
  /** Roof centre, size and top (m). */
  x: number; z: number; w: number; d: number; y: number;
  /** The mirroring of the roof kit (+-1). The bulkhead stands on the -sx half, AC banks along the
   * -sz edge (their x half nearest +x stays free), billboards on the +sz edge, water tanks on +sx. */
  sx: number; sz: number;
  /** VENUE kind (its district), or -1. */
  venue: number;
  /** Index range [start, end) of the venue's parts in buildingParts(b). */
  venueParts: readonly [number, number];
  dark: boolean; pad: boolean;
  /** One of the few helipads a spinner lands on (rooftop-life.ts spinnerAt). */
  heliport: boolean;
  /** Water tank on stilts: centre x, underside y, centre z. */
  tank: readonly [number, number, number] | null;
}
/** A point on a roof in its kit's mirrored frame: `f` and `g` run -1..1 across the half width and depth. */
export function roofPoint(r: { x: number; z: number; w: number; d: number; sx: number; sz: number }, f: number, g: number): [number, number] {
  return [r.x + r.sx * f * r.w / 2, r.z + r.sz * g * r.d / 2];
}
const spotBlocks = new Map<number, RoofSpot[]>(), spotHome = new Map<number, number>();
const blockIndex = (bx: number, bz: number): number => (bx + 64) * 256 + (bz + 64);
const NO_SPOTS: readonly RoofSpot[] = [];
function registerSpot(spot: RoofSpot): void {
  const key = blockIndex(Math.floor(spot.x / BLOCK_SIZE), Math.floor(spot.z / BLOCK_SIZE)), home = spotHome.get(spot.id);
  // A rebuilt building (a second CityWorld, a test variant) replaces its earlier entry.
  const old = home === undefined ? undefined : spotBlocks.get(home), at = old ? old.findIndex(s => s.id === spot.id) : -1;
  if (old && at >= 0) old.splice(at, 1);
  const list = spotBlocks.get(key) ?? []; list.push(spot); spotBlocks.set(key, list); spotHome.set(spot.id, key);
  const port = heliportList.findIndex(s => s.id === spot.id);
  if (port >= 0) heliportList.splice(port, 1);
  if (spot.heliport) heliportList.push(spot);
}
const heliportList: RoofSpot[] = [];
/** The helipads a spinner lands on, city-wide (registered with the roofs). */
export function heliports(): readonly RoofSpot[] { return heliportList; }
/** The top roofs of block (bx, bz), registered as buildingParts builds each building (the building
 * batch builds every block at start-up). */
export function roofSpots(bx: number, bz: number): readonly RoofSpot[] {
  return spotBlocks.get(blockIndex(bx, bz)) ?? NO_SPOTS;
}
/** True for the plot that may open a rooftop venue: one plot on every other block (a checkerboard),
 * so no two neighbouring roofs, in a block or across a street, both carry one. */
export function venuePlot(x: number, z: number, district: number): boolean {
  const bx = Math.floor(x / BLOCK_SIZE), bz = Math.floor(z / BLOCK_SIZE);
  if (((bx + bz) & 1) !== 0) return false;
  const plot = (x - bx * BLOCK_SIZE < 32 ? 0 : 1) + (z - bz * BLOCK_SIZE < 32 ? 0 : 2);
  return plot === Math.floor(randomFor(bx, bz, 7731) * 4) && randomFor(bx, bz, 7732) < (VENUE_SHARE[district] ?? 0);
}
/** Share of helipads a spinner lands on (two or three city-wide; tests/rooftop-life.test.ts). */
export const HELIPORT_SHARE = 0.035;
/** Picks three pads spread over Neon Ward and Ghost Circuit: by the Spire, mid Ghost Circuit and its far north. */
const HELIPORT_SALT = 9908;
/** Metre offsets (along the roof kit's mirrored x and z, from the roof centre) of each venue's
 * pieces on a w x d roof: the static kit in buildingParts and the animated life in rooftop-life.ts
 * both read them. Everything sits on the +sx half, clear of the bulkhead on the -sx half. */
export function venueLayout(w: number, d: number) {
  const W = w / 2, D = d / 2;
  // The stair bulkhead buildingParts stands on every top roof but a helipad (keep in step with it):
  // centre x, half width along x, half depth along z and height.
  const bulkhead = { x: -0.44 * W, half: Math.min(1.5, 0.3 * W), depth: Math.min(1.75, 0.3 * D), h: 2.6 };
  // The deck rooftop-life.ts lays over the venue: from just clear of the bulkhead to the +sx
  // parapet (x0, x1), and +-z (half depth).
  const deck: readonly [number, number, number] = [bulkhead.x + bulkhead.half + 0.4, W - 0.2, D - 0.2];
  // The bar's lounge: two tables either side of a patio heater, a third nearer the bar on wide roofs.
  const span = Math.min(5, D * 0.9), lounge = (deck[0] + W - 3.6) / 2, near = W - 4.7;
  const tables: (readonly [number, number])[] = [[lounge, -0.45 * D], [lounge, 0.45 * D]];
  if (near - lounge >= 1.8) tables.push([near, 0]);
  const heater: readonly [number, number] = [lounge, 0], leaner: readonly [number, number] = [W - 2, D - 0.5];
  return {
    bulkhead, deck,
    // counter, keeper, back bar (its shelf of bottles faces the bulkhead), the bar stools' line and
    // the counter's length along z; the name sign stands on the bulkhead roof (`sign.lift` up).
    bar: {
      counter: W - 2.2, keeper: W - 1.05, back: W - 0.5, backH: 2.4, stools: W - 3, span, tables, heater, leaner,
      sign: { width: Math.min(3.6, 2 * bulkhead.depth + 0.6), h: 1.4, lift: bulkhead.h + 0.3 },
      pole: 0.05 * W, poleZ: D - 0.2, poleH: 3.4,
    },
    garden: { rows: [D - 0.9, D - 2.9], rowX: [0.05 * W, W - 0.2], house: [0.2 * W, 0.9 * W, 0.1 * D, 0.85 * D], gardener: [0.5 * W, -(D - 1.9)], lantern: [W - 0.4, 0] },
    // (The outer rack keeps clear of the venue parapet rooftop-life.ts runs along the roof edge.)
    farm: { racks: [0.35, W / 2, W - 0.65], rackZ: 0.8 * D, farmer: [(0.35 + W / 2) / 2, 0.3 * D] },
    radio: { shack: [0.55 * W, -0.35 * D], mast: [0.55 * W, 0.55 * D], mastH: 14, dishY: 3.8 },
    loft: { hut: [0.55 * W, 0], pole: [0.25 * W, 0.75 * D], keeper: [0.15 * W, -0.55 * D], cageTop: 3.7 },
    forge: { hood: [0.55 * W, 0], stackTop: 6.1 },
  };
}

/**
 * Every box of one building, built once and cached: the massing family (world.ts FORM) - slabs,
 * podium towers, ziggurats, twins joined by sky bridges, cantilevers, container megablocks,
 * supertall spires, shanty roofs, crosswise stacks, towers with exposed lift cores, billboard-
 * wrapped slabs - then district roof kits (water tanks on stilts, AC banks, chimneys, pipe runs,
 * antenna arrays with aviation lights, billboards, helipads, greenhouse clusters, planters) and
 * facade retrofits (scaffolding, X-bracing, container modules, balconies, screen wraps).
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
    // A dark tower's raised masses lose their neon (crown, corners, bands); its street base stays lit.
    if (dark && y0 > 0) f = (f & ~(FLAG.CROWN | FLAG.CORNERS | FLAG.BANDS)) | FLAG.DARK;
    const saved = [skin, flags] as const; skin = s; flags = f;
    const index = parts.length;
    part(mx, (y0 + y1) / 2, mz, mw, y1 - y0, md);
    [skin, flags] = saved;
    const m = { x: mx, z: mz, w: mw, d: md, y0, y1, part: index }; masses.push(m); return m;
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
  // Not every tower glows: a share of the tall ones stand dark between the neon ones (contrast is
  // what makes the neon read), each with a single red aviation light on its crown.
  const darkForm = form === FORM.PODIUM || form === FORM.TWIN || form === FORM.CANTILEVER || form === FORM.SLAB || form === FORM.CORE || form === FORM.ZIGGURAT || form === FORM.STACKED;
  const dark = darkForm && h > 48 && rnd(37) < DARK_SHARE[district];
  // Spillway capsule hotels: a slab whose body is a grid of sleeping pods.
  const capsule = district === 5 && (form === FORM.SLAB || form === FORM.SHANTY) && h > 24 && rnd(38) < 0.35;
  // External glass lifts climbing one face of some tall towers (the car is drawn by the shader).
  const lift = (district === 0 || neon || ghost || district === 4) && (form === FORM.PODIUM || form === FORM.TWIN || form === FORM.SLAB || form === FORM.CANTILEVER) && h > 56 && rnd(39) < 0.3;
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
        flags = dark ? FLAG.DARK : FLAG.CROWN; skin = SKIN.CURTAIN; part(bx, y + 1.5, bz, bw, 3, bd); skin = main; flags = 0;
      }
    }
  } else if (form === FORM.STACKED) {
    // Slabs stacked crosswise over a full-plot base: each tier turns 90 degrees and shifts off
    // centre, set on a recessed plant floor (a dark machinery band), and above 30 m its long side
    // oversails the plot by a metre. Tiers alternate facade, so the stack reads as separate blocks.
    // Every tier (0.76 x full, offset 0.05) and plant floor (0.68) still contains the 0.64 core.
    const base = Math.min(h * 0.45, Math.max(anchor, 10 + rnd(7) * 8));
    roofs.push(mass(x, z, w, d, 0, base, podiumSkin, weather));
    const tiers = Math.max(2, Math.min(4, Math.round((h - base) / 22)));
    const alt = district === 3 ? SKIN.GARDEN : main === SKIN.CURTAIN || main === 2 ? SKIN.PANEL : SKIN.CURTAIN;
    const turn = rnd(30) < 0.5 ? 0 : 1, gap = 1.8;
    let y0 = base;
    for (let i = 0; i < tiers; i++) {
      const y1 = i === tiers - 1 ? h : base + (h - base) * (i + 1) / tiers, last = i === tiers - 1;
      mass(x, z, w * 0.68, d * 0.68, y0, y0 + gap, MACHINE);
      const alongX = (i + turn) % 2 === 0, shift = (rnd(31 + i) < 0.5 ? -1 : 1) * 0.05, oversail = y0 + gap >= 30 ? 2 : 0;
      const tw = alongX ? Math.min(w + oversail, reachX * 2) : w * 0.76, td = alongX ? d * 0.76 : Math.min(d + oversail, reachZ * 2);
      const tier = mass(x + (alongX ? 0 : shift * w), z + (alongX ? shift * d : 0), tw, td, y0 + gap, y1, i % 2 ? alt : main, towerFlags | (last || neon ? crown : 0));
      if (last) top = tier;
      else {
        // The ends left uncovered by the crosswise tier above carry AC units, or planters in the gardens.
        const garden = district === 3;
        range = garden ? 240 : 170; skin = garden ? SKIN.GARDEN : MACHINE; tint = garden ? [107, 226, 162] : [96, 120, 124];
        for (const s of [-1, 1]) {
          const along = (alongX ? tw : td) / 2 - 1.1;
          const ux = alongX ? tier.x + s * along : tier.x, uz = alongX ? tier.z : tier.z + s * along;
          if (garden) part(ux, y1 + 0.45, uz, alongX ? 1.4 : tw * 0.8, 0.9, alongX ? td * 0.8 : 1.4);
          else part(ux, y1 + 0.65, uz, 1.6, 1.3, 1.6);
        }
        range = Infinity; skin = main; tint = b.accent;
      }
      body = tier; y0 = y1;
    }
  } else if (form === FORM.CORE) {
    // A tower beside its exposed lift core: a concrete spine rising past the roof as the lift
    // overrun, an open lattice shaft on its outer face (inside the plot, so collision is unchanged)
    // and one lit car parked in it. Tower (-0.5..0.2) and spine (0.16..0.36, 0.68 deep) cover the core.
    const alongX = w >= d, s = rnd(13) < 0.5 ? -1 : 1, L = alongX ? w : d, D = alongX ? d : w;
    const at = (u: number, v: number) => alongX ? [x + s * u, z + v] as const : [x + v, z + s * u] as const;
    const dims = (l: number, dd: number) => alongX ? [l, dd] as const : [dd, l] as const;
    const podium = Math.min(h * 0.4, Math.max(anchor, 9 + rnd(7) * 6));
    roofs.push(mass(x, z, w, d, 0, podium, podiumSkin, weather));
    const [tx, tz] = at(-0.15 * L, 0), [tw, td] = dims(0.7 * L, D * 0.94);
    body = top = mass(tx, tz, tw, td, podium, h, main, towerFlags | crown);
    const [cx, cz] = at(0.26 * L, 0), [cw, cd] = dims(0.2 * L, D * 0.68);
    const overrun = h + 4 + rnd(32) * 5;
    mass(cx, cz, cw, cd, podium, overrun, 1, towerFlags & ~FLAG.BANDS);
    const shaft = 0.14 * L - 0.14, [hx, hz] = at(0.36 * L + shaft / 2, 0), [hw, hd] = dims(shaft, 2.4);
    // FLAG.PULSE: the lift car is drawn on the shaft's own faces by the facade shader, gliding
    // slowly between the podium and the top floor (no separate part, so nothing z-fights).
    skin = LATTICE; tint = [120, 132, 140]; flags = FLAG.PULSE; part(hx, (podium + overrun - 1) / 2, hz, hw, overrun - 1 - podium, hd); flags = 0;
    range = Infinity; skin = main; tint = b.accent;
  } else {
    // Slabs: a full podium and a 0.93 body (0.9 for megablocks, whose containers stand proud).
    const inset = form === FORM.MEGABLOCK ? 0.9 : 0.93;
    body = mass(x, z, w * inset, d * inset, 8, h, capsule ? SKIN.PANEL : main, towerFlags | (form === FORM.CANTILEVER ? 0 : crown) | (capsule ? FLAG.CAPSULE : 0));
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
  // The dark tower's aviation light rides on its crown mass; the lift climbs the main shaft.
  if (dark && (parts[crownMass.part].message & FLAG.DARK) !== 0) parts[crownMass.part].message |= FLAG.CROWN;
  const liftMass = body ?? top;
  if (lift && liftMass && liftMass.y1 - liftMass.y0 > 30) parts[liftMass.part].message |= FLAG.PULSE;

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
  if ((form === FORM.MEGABLOCK || (style === 3 && form === FORM.SLAB) || (district === 0 && rnd(14) < 0.35)) && form !== FORM.STACKED && form !== FORM.CORE && body && body.y1 - body.y0 > 16) {
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
  if (form === FORM.WRAPPED && body) {
    // Billboard wrap: screens round one upper corner (both faces meeting there), neon-framed
    // (FLAG.CROWN lights the top edge, FLAG.CORNERS the sides), sometimes a band lower on the far
    // face. They sit on the 0.93 body inside the plot, above every street anchor.
    const ux = rnd(22) < 0.5 ? -1 : 1, uz = rnd(23) < 0.5 ? -1 : 1;
    const y0 = Math.max(anchor + 4, h * (0.4 + rnd(24) * 0.15)), y1 = Math.min(h - 2, y0 + 14 + rnd(25) * 14);
    const tx = Math.max(0.3, w * 0.035 - 0.06), tz = Math.max(0.3, d * 0.035 - 0.06);
    if (y1 - y0 > 8) {
      const spanZ = d * (0.55 + rnd(26) * 0.3), spanX = w * (0.55 + rnd(27) * 0.3);
      range = Infinity; skin = SCREEN; flags = FLAG.CROWN | FLAG.CORNERS | (ghost && rnd(28) < 0.5 ? FLAG.DIM : 0);
      tint = rnd(29) < 0.5 ? b.accent : DISTRICTS[district].color;
      // The x face's panel runs to the corner of the z face's panel, so the wrap has no notch.
      part(x + ux * (w * 0.465 + tx / 2 + 0.03), (y0 + y1) / 2, z + uz * (d / 2 - 0.03 - spanZ / 2), tx, y1 - y0, spanZ);
      part(x + ux * (w * 0.465 - spanX / 2), (y0 + y1) / 2, z + uz * (d * 0.465 + tz / 2 + 0.03), spanX, y1 - y0, tz);
      if (rnd(34) < 0.4 && y0 - anchor > 9) {
        const band = 4 + rnd(35) * 2, yb = anchor + 3 + rnd(36) * (y0 - anchor - 4 - band);
        part(x - ux * (w * 0.465 + tx / 2 + 0.03), yb + band / 2, z, tx, band, d * 0.8);
      }
      range = 240; flags = 0; skin = main; tint = b.accent;
    }
  }
  if ((main === 0 || main === 6) && body && !capsule && (form === FORM.SLAB || form === FORM.SHANTY || form === FORM.CANTILEVER)) {
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
  const venueSlot = venuePlot(x, z, district);
  // The top roof, recorded for rooftop-life.ts once the kits are built.
  // (A holder object: the forEach callback below fills it, and locals assigned in a callback would
  // not be seen by the type checker's flow analysis afterwards.)
  const spot: { roof?: Mass; venue: number; parts: readonly [number, number]; pad: boolean; tank: readonly [number, number, number] | null } = { venue: -1, parts: [0, 0], pad: false, tank: null };
  // A venue's kit, in metres along the mirrored roof axes (venueLayout), on the +sx half clear of the bulkhead.
  const venueKit = (r: Mass, kind: number) => {
    const L = venueLayout(r.w, r.d);
    const put = (ox: number, oz: number, pw: number, ph: number, pd: number, lift = 0) => part(r.x + sx * ox, r.y1 + lift + ph / 2, r.z + sz * oz, pw, ph, pd);
    range = 260; flags = 0;
    if (kind === VENUE.BAR) {
      // Neon Ward rooftop bar: a counter with a lit strip round its foot, the back bar behind the
      // keeper and two lantern poles (rooftop-life.ts lays the deck, hangs the lanterns, shelves
      // the bottles, sets out the tables and heater, lights the name sign on the bulkhead and
      // seats the drinkers). Five parts, as many as the edge sign it replaced.
      const { counter, back, backH, span, pole, poleZ, poleH } = L.bar;
      skin = MACHINE; tint = [72, 46, 64]; put(counter, 0, 1, 1.4, span * 0.9);
      skin = NEON; tint = b.accent; put(counter, 0, 1.06, 0.16, span * 0.9 + 0.06, 0.18);
      skin = MACHINE; tint = [52, 40, 50]; put(back, 0, 0.45, backH, span * 0.84);
      skin = LATTICE; tint = [80, 86, 92]; for (const s of [-1, 1]) put(pole, s * poleZ, 0.25, poleH, 0.25);
    } else if (kind === VENUE.GARDEN) {
      // Silk Market roof garden: two planter rows and a glasshouse glowing warm from inside.
      const { rows, rowX, house } = L.garden, [x0, x1, z0, z1] = house;
      skin = SKIN.GARDEN; tint = [107, 226, 162];
      for (const row of rows) put((rowX[0] + rowX[1]) / 2, -row, rowX[1] - rowX[0], 0.8, 1.1);
      skin = SKIN.CURTAIN; tint = [255, 214, 140]; put((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, 2.3, z1 - z0);
      skin = NEON; tint = [96, 150, 84]; put((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) * 0.5, 0.5, (z1 - z0) * 0.9, 2.3);
    } else if (kind === VENUE.FARM) {
      // Rain Gardens terrace farm: grow-light racks, pink and blue, steady.
      const { racks, rackZ } = L.farm;
      racks.forEach((rx, i) => {
        skin = LATTICE; tint = [96, 112, 104]; put(rx, 0, 0.7, 1.8, rackZ * 2);
        skin = NEON; tint = i % 2 ? [110, 130, 255] : [255, 90, 200]; put(rx, 0, 0.55, 0.45, rackZ * 2, 1.8);
      });
    } else if (kind === VENUE.RADIO) {
      // Ghost Circuit pirate radio: a tin shack, a mast with its red light and the dish mount
      // (rooftop-life.ts turns the dish).
      const { shack, mast, mastH } = L.radio;
      skin = SKIN.CORRUGATED; tint = [150, 150, 170]; put(shack[0], shack[1], 3, 2.4, 2.6);
      skin = MACHINE; tint = [110, 116, 130]; put(shack[0], shack[1], 0.4, 1, 0.4, 2.4);
      skin = LATTICE; tint = [120, 136, 150]; put(mast[0], mast[1], 0.7, mastH, 0.7);
      skin = NEON; tint = [255, 52, 40]; flags = FLAG.PULSE; put(mast[0], mast[1], 0.9, 0.9, 0.9, mastH); flags = 0;
    } else if (kind === VENUE.LOFT) {
      // Spillway pigeon loft: a timber hut, its wire fly cage and a perch pole.
      const { hut, pole } = L.loft;
      skin = SKIN.CORRUGATED; tint = [170, 120, 80]; put(hut[0], hut[1], 3.4, 2.2, 3);
      skin = LATTICE; tint = [130, 120, 100]; put(hut[0], hut[1], 3.6, 1.5, 3.2, 2.2); put(pole[0], pole[1], 0.2, 4.5, 0.2);
    } else {
      // Foundry forge vent: a squat hood, its ember-lit grate and a stack with a hot rim
      // (rooftop-life.ts lifts a slow plume of embers from it).
      const { hood } = L.forge;
      skin = MACHINE; tint = [70, 64, 60]; put(hood[0], hood[1], 3, 1.6, 3);
      skin = NEON; tint = [255, 96, 40]; put(hood[0], hood[1], 3.2, 0.35, 3.2);
      skin = MACHINE; tint = [255, 120, 52]; flags = FLAG.CROWN; put(hood[0], hood[1], 1.4, 4.5, 1.4, 1.6); flags = 0;
    }
    skin = main; tint = b.accent;
  };
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
    // A rooftop venue trades the roof's furniture (AC bank, billboard, tank, greenhouses, shacks,
    // antennas, chimneys) for its own kit, so the batch stays near its part budget.
    const venue = isTop && venueSlot && !dark && form !== FORM.SIGNAL && form !== FORM.SPIRE && r.y1 >= VENUE_HEIGHT[0] && r.y1 <= VENUE_HEIGHT[1] && r.w >= 9 && r.d >= 9 ? district : -1;
    if (venue < 0) {
      // Air-conditioning bank.
      skin = MACHINE; tint = [96, 120, 124]; range = 170;
      const units = 2 + Math.floor(rnd(k + 1) * 3);
      for (let i = 0; i < units; i++) on(r, -0.45 + i * 0.22, -0.42 * sz, 1.8, 1.3, 1.6);
    }
    range = 260;
    if (!isTop) { skin = main; tint = b.accent; return; }
    // Stair and lift bulkhead.
    let pad = false;
    if ((neon || ghost) && !dark && r.y1 > 88 && r.w >= 11 && r.d >= 11 && rnd(k + 2) < 0.45) {
      // Helipad: H marking and lit edge on the pad's top face (materials.ts SCREEN roof).
      skin = SCREEN; tint = [255, 196, 112]; flags = FLAG.CROWN;
      on(r, 0, 0, r.w * 0.82, 0.6, r.d * 0.82); pad = true; flags = 0;
    } else {
      // (venueLayout's `bulkhead` restates this box for the venues' signs and decks.)
      skin = main; part(r.x - sx * r.w * 0.22, r.y1 + 1.3, r.z, Math.min(3, r.w * 0.3), 2.6, Math.min(3.5, r.d * 0.3));
    }
    spot.roof = r; spot.pad = pad;
    if (venue >= 0) {
      const start = parts.length;
      venueKit(r, venue);
      spot.venue = venue; spot.parts = [start, parts.length];
      return;
    }
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
    // (Dark towers carry no lit billboard: their crown stays dark but for the aviation light.)
    if (!dark && ((neon && kit < 0.7) || (ghost && kit < 0.35) || (district === 4 && kit < 0.3) || (district === 5 && kit < 0.15))) {
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
      spot.tank = [r.x + u * Math.max(0, r.w - 2.8), r.y1 + 2.4, r.z + v * Math.max(0, r.d - 2.8)];
    }
    if ((district === 3 || (district === 4 && kit > 0.78)) && !pad) {
      // Greenhouse cluster: glazed halls of mixed sizes, each with a ridge; big roofs carry three.
      skin = SKIN.CURTAIN; tint = [107, 226, 162];
      const halls = district === 4 ? 1 : area > 190 ? 3 : area > 120 ? 2 : 1;
      const layout: readonly (readonly [number, number, number, number, number])[] = [[0.15, 0.2, 0.5, 0.45, 3.2], [-0.3, 0.45, 0.3, 0.28, 2.6], [0.42, -0.3, 0.26, 0.24, 2.3]];
      for (let i = 0; i < halls; i++) {
        const [u, v, fw, fd, gh] = layout[i];
        const hx = r.x + u * sx * r.w * (1 - fw), hz = r.z + v * sz * r.d * (1 - fd);
        part(hx, r.y1 + gh / 2, hz, r.w * fw, gh, r.d * fd); part(hx, r.y1 + gh * 1.22, hz, r.w * fw * 0.68, gh * 0.44, r.d * fd * 0.44);
      }
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
  const roof = spot.roof;
  if (roof) {
    const heliport = spot.pad && randomFor(id, 0, HELIPORT_SALT) < HELIPORT_SHARE;
    registerSpot({ id, district, x: roof.x, z: roof.z, w: roof.w, d: roof.d, y: roof.y1, sx, sz, venue: spot.venue, venueParts: spot.parts, dark, pad: spot.pad, heliport, tank: spot.tank });
  }
  range = Infinity; flags = 0; skin = main;
  // News tickers wrap the whole tower, so their text scrolls around the corners. Tall towers
  // carry a giant crown band readable across the city; some podiums carry a street-level one.
  if (b.id % 5 === 0 || Math.abs(x) < 30 && b.id % 3 === 0) {
    surface = 6; message = b.id % MESSAGES.length;
    const crownBand = masses.filter(m => m.y1 >= h - 0.5 && m.y1 - m.y0 > 14 && m.w > 6 && m.d > 6).sort((a, c) => c.w * c.d - a.w * a.d)[0];
    const street = masses.filter(m => m.y0 <= 9 && m.y1 >= 12).sort((a, c) => a.w * a.d - c.w * c.d)[0];
    if (h > 95 && b.id % 2 === 0 && crownBand && !dark) part(crownBand.x, crownBand.y1 - 9, crownBand.z, crownBand.w + 0.5, 5, crownBand.d + 0.5);
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
