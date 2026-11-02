import { ink, propRange, restorePropRange, type ActivityView } from "./activity.ts";
import { LINE_PER_METRE, landmarkDetail, type LandmarkDetail } from "./landmarks-scene.ts";
import { PropRecorder, type PropCanvas } from "./prop-canvas.ts";
import { drawLetterPanel, type SignFace } from "./signage.ts";
import { DISTRICTS, SIGHTS, type RGB, type Sight } from "./world.ts";
import {
  BARRIER, BARRIER_BAYS, BARRIER_CABINS, BARRIER_PIERS, BAY_COUNT, BAY_FROM, BAY_LENGTH, CABIN_COUNT, CABLEWAY, CABLE_LENGTH, CABLE_TOWERS,
  CHUTE_SCROLL, CRANE, CRANE_FLOOD_Z, FLOOD_WALL, FLOOD_WALL_TOP, GANGWAY_FOOT_Z, GANGWAY_X, KEEL_Y, QUAY_CRANES, RADAR_DEG_PER_S, SHIP, STACK_OFFSETS, TIER, TROLLEY_PERIOD, WATER_Y,
  breathe, cabinPose, cableHeight, cableZ, craneTrolley, spreaderY, type QuayCrane,
} from "./sights.ts";

/**
 * The edge sights (world.ts SIGHTS, geometry in sights.ts) as instanced prop geometry, recorded once
 * per frame with the other props (engine.ts recordProps) and so shared by the reflected and main
 * passes. Built like the landmarks (landmarks-scene.ts): many small parts, detail tiered by the
 * distance to the footprint (`landmarkDetail`: far silhouettes a few dozen parts, mid adds bands,
 * windows and lattice, near adds railings, seams, bollards and lines), thin parts widened to about a
 * cell at their own distance so far masts and cables stay steady lines. A sight is drawn only within
 * its reach and when one of its high points is in view. Their titles are letter panels, captured
 * with the shop panels for the main pass.
 */

const DEG = 180 / Math.PI;
/** Titles are big (2.2-4.4 m letters): readable to ~400 m, dissolved by 520 m. */
const SIGHT_TITLE_RANGE = 520;
const TITLE_SEED = 0.004;
let eyeX = 0, eyeZ = 0, minLine = 0;
/** Minimum line width for the parts drawn next, from their distance to the eye. */
function lineAt(x: number, z: number): number { const d = Math.hypot(x - eyeX, z - eyeZ); minLine = d * LINE_PER_METRE; return d; }
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
/** A slab sloping in the x-y plane from (ax, ay) to (bx, by), `width` along z, centred on z. */
function incline(t: PropCanvas, ax: number, ay: number, bx: number, by: number, z: number, width: number, thickness: number): void {
  const dx = bx - ax, dy = by - ay;
  t.push(); t.translate((ax + bx) / 2, -(ay + by) / 2, z); t.rotateZ(Math.atan2(-dy, dx) * DEG);
  t.box(Math.hypot(dx, dy), thin(thickness), width); t.pop();
}
const hash = (a: number, b: number): number => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

const STEEL: RGB = [78, 90, 102], DARK: RGB = [30, 36, 44], CONCRETE: RGB = [86, 94, 96];
const HULL: RGB = [46, 60, 78], HULL_BAND: RGB = [84, 102, 122], BOOT: RGB = [150, 52, 46], RAIL: RGB = [160, 172, 180];
const HOUSE: RGB = [172, 178, 182], WINDOW: RGB = [255, 212, 148], BRIDGE_GLASS: RGB = [150, 226, 255];
const LAMP_WHITE: RGB = [255, 244, 222], LAMP_RED: RGB = [255, 58, 52], LAMP_GREEN: RGB = [80, 255, 150], AMBER: RGB = [255, 170, 60];
const CRANE_PAINT: RGB = [88, 150, 178], SPREADER: RGB = [236, 196, 70];
/** Floodlit concrete (the barrier's piers) and lit falling water (its chute): partly self-lit tones. */
const PIER_WASH: RGB = [255, 204, 148], CHUTE_WHITE: RGB = [212, 236, 246], SAG_DOTS: RGB = [176, 198, 212];
const CONTAINER_COLORS: readonly RGB[] = DISTRICTS.map(district => district.color);
/** The Nami Maru's deck floodlight masts (x), on the bay boundaries, 20 m over the deck. */
const DECK_FLOODS: readonly number[] = [BAY_FROM + 2 * BAY_LENGTH, BAY_FROM + 6 * BAY_LENGTH, BAY_FROM + 10 * BAY_LENGTH];
/** A container top under a deck floodlight: its own paint washed toward the lamp's warm white. */
const floodTint = (color: RGB): RGB => [(color[0] + 255) / 2, (color[1] + 238) / 2, (color[2] + 205) / 2];

/** Distance from the eye to the nearest point of a sight's footprint. */
function footprintDistance(sight: Sight): number {
  return Math.hypot(Math.max(0, Math.abs(eyeX - sight.x) - sight.halfX), Math.max(0, Math.abs(eyeZ - sight.z) - sight.halfZ));
}
type Seen = (x: number, y: number, z: number, radius: number) => boolean;

export function drawSights(t: PropCanvas, view: ActivityView): void {
  eyeX = view.x; eyeZ = view.z;
  const reach = view.low ? 560 : 1050 + view.height * 1.6;
  const seen: Seen = (x, y, z, radius) => !view.visible || view.visible(x, y, z, radius);
  const outer = propRange(0);
  for (const sight of SIGHTS) {
    const distance = footprintDistance(sight);
    if (distance > reach) continue;
    const detail = landmarkDetail(distance);
    if (sight.kind === "ship") {
      // Seen if the superstructure, the bow mast or the cranes' booms are.
      if (!seen(SHIP.x - 90, 40, SHIP.z, 30) && !seen(SHIP.x + 40, 26, SHIP.z, 70) && !seen(SHIP.x, 50, CRANE.landZ, 70)) continue;
      ship(t, sight, view.time, detail);
    } else if (sight.kind === "barrier") {
      if (!seen(BARRIER.x, BARRIER.towerTop, BARRIER.z, BARRIER.half) && !seen(BARRIER.x, 20, BARRIER.z, BARRIER.half)) continue;
      barrier(t, view.time, detail);
    } else cableway(t, view.time, view.low, seen);
  }
  minLine = 0;
  titles(t, seen);
  restorePropRange(outer);
}

// ---- Nami Maru and her two quay cranes.
function ship(t: PropCanvas, sight: Sight, time: number, detail: LandmarkDetail): void {
  const { x, z, stern, bow, beam, deck } = SHIP;
  const side = Math.sign(eyeZ - z) || -1, face = z + side * beam / 2;
  lineAt(x, face);
  // Hull: the parallel body, a narrower stern and a three-step bow rising to the forecastle.
  ink(t, HULL, "=");
  box(t, x - 9, (deck + KEEL_Y) / 2, z, 190, deck - KEEL_Y, beam);
  box(t, stern + 3, (deck + 1) / 2, z, 6, deck - 1, beam - 3);
  for (const [x0, x1, w, top] of [[86, 96, 26, 15.5], [96, 104, 19, 16.5], [104, bow, 9, 17]] as const) box(t, (x0 + x1) / 2, (top + KEEL_Y) / 2, z, x1 - x0, top - KEEL_Y, w);
  // Boot topping at the waterline and the pale bulwark line along the deck edge.
  ink(t, BOOT, "=", 0.8); box(t, x - 9, 0.2, z, 190.4, 1.6, beam + 0.3);
  ink(t, RAIL, "-", 0.7); box(t, x - 9, deck + 0.2, face, 190, 0.3, 0.3);
  if (detail >= 1) {
    // Plating bands on the side facing the city; near, vertical plate seams every 12 m.
    ink(t, HULL_BAND, "-", 0.8);
    for (const y of detail === 2 ? [3.6, 7.4, 11.2] : [4.4, 10.4]) box(t, x - 9, y, face, 190, 0.35, 0.12);
    if (detail === 2) { ink(t, DARK, "|"); for (let px = stern + 10; px < 86; px += 12) box(t, px, 6.5, face + side * 0.05, 0.14, deck - 2, 0.1); }
  }
  // Lit porthole rows along the hull, one part a row (the 'o' glyph repeats cell by cell), clear of
  // the name panel (x 46-78); a lamp bar over the name so it reads from the Rim stations.
  ink(t, WINDOW, "o"); box(t, -17, 12.4, face + side * 0.1, 122, 0.6, 0.1);
  if (detail >= 1) box(t, -19, 8.8, face + side * 0.1, 118, 0.6, 0.1);
  ink(t, LAMP_WHITE, "=", 0.8); box(t, 62, 13, face + side * 0.12, 30, 1, 0.14);
  // Superstructure aft: five decks, lit window rows all round, the bridge's bright window band with
  // wings, a radar mast, the funnel.
  const hx = -89;
  ink(t, HOUSE, "#", 0.55); box(t, hx, (deck + 38) / 2, z, 18, 38 - deck, 24);
  box(t, hx + 1, 40, z, 14, 4, beam + 2);
  ink(t, DARK, "="); box(t, hx + 1, 42.3, z, 15, 0.6, beam + 3);
  ink(t, WINDOW, "=");
  for (let k = detail === 0 ? 1 : 0; k < 5; k += detail === 0 ? 2 : 1) box(t, hx, deck + 2.6 + k * 4.8, z, 18.2, 1, 24.2);
  ink(t, BRIDGE_GLASS, "="); box(t, hx + 1, 40.6, z, 14.3, 2, beam + 2.3);
  // Side lights on the bridge wings (port red on the north side, starboard green) and the same pair
  // at the bow and the stern: steady, the ship's brightest marks from across the city.
  ink(t, LAMP_RED, "@");
  box(t, hx + 7, 41.6, z - beam / 2 - 1.6, 0.8, 0.8, 0.8); box(t, bow - 3, 18, z - 3.6, 0.9, 0.9, 0.9); box(t, stern + 2, 14.8, z - beam / 2 + 2.5, 0.9, 0.9, 0.9);
  ink(t, LAMP_GREEN, "@");
  box(t, hx + 7, 41.6, z + beam / 2 + 1.6, 0.8, 0.8, 0.8); box(t, bow - 3, 18, z + 3.6, 0.9, 0.9, 0.9); box(t, stern + 2, 14.8, z + beam / 2 - 2.5, 0.9, 0.9, 0.9);
  ink(t, STEEL, "|"); box(t, hx - 1, 47.4, z, 1.1, 9.6, 1.1);
  if (detail >= 1) { box(t, hx - 1, 49.2, z, 0.5, 0.4, 8); ink(t, DARK, "#"); box(t, hx - 1, 51, z, 1.6, 0.8, 1.6); }
  // The radar bar turns slowly (RADAR_DEG_PER_S).
  ink(t, RAIL, "=", 0.85);
  t.push(); t.translate(hx - 1, -51.7, z); t.rotateY(time * RADAR_DEG_PER_S); t.box(6.5, thin(0.4), thin(0.7)); t.pop();
  ink(t, LAMP_WHITE, "@"); box(t, hx - 1, 53, z, 0.8, 0.8, 0.8);
  ink(t, DARK, "#"); box(t, -104, (deck + 46) / 2, z, 7, 46 - deck, 9);
  ink(t, sight.color, "=", 0.85); box(t, -104, 41, z, 7.3, 2.6, 9.3);
  // Foremast with a steady white masthead lamp.
  ink(t, STEEL, "|"); box(t, 100, 26, z, 0.9, 18, 0.9);
  ink(t, LAMP_WHITE, "@"); box(t, 100, 35.6, z, 0.9, 0.9, 0.9);
  // Deck floodlight masts on the near rail between bays (DECK_FLOODS): far, the lamps alone; nearer,
  // the poles. The bays either side stand in their light: brighter stacks, a warm-lit top.
  ink(t, LAMP_WHITE, "@"); for (const fx of DECK_FLOODS) box(t, fx, deck + 20, z + side * 14.6, 1.1, 0.6, 1.1);
  if (detail >= 1) { ink(t, STEEL, "|"); for (const fx of DECK_FLOODS) box(t, fx, deck + 10, z + side * 14.6, 0.45, 20, 0.45); }
  // Containers: three stacks across each bay, in the districts' colours, two to five high.
  for (let k = 0; k < BAY_COUNT; k++) {
    const bx = BAY_FROM + BAY_LENGTH * (k + 0.5), floodlit = DECK_FLOODS.some(fx => Math.abs(fx - bx) < BAY_LENGTH);
    if (detail === 2) lineAt(bx, face);
    for (let j = 0; j < STACK_OFFSETS.length; j++) {
      if (hash(k, j + 3) < 0.06) continue;
      const tiers = 2 + Math.floor(hash(k, j) * 4), bz = z + STACK_OFFSETS[j], color = CONTAINER_COLORS[Math.floor(hash(k, j + 7) * CONTAINER_COLORS.length)];
      ink(t, color, "|", (floodlit ? 0.72 : 0.42) + hash(k, j + 11) * 0.18); box(t, bx, deck + tiers * TIER / 2, bz, 12.2, tiers * TIER, 9);
      if (floodlit && detail >= 1) { ink(t, floodTint(color), "=", 0.95); box(t, bx, deck + tiers * TIER + 0.08, bz, 12.2, 0.16, 9); }
      if (detail === 2) { ink(t, DARK, "-"); for (let i = 1; i < tiers; i++) box(t, bx, deck + i * TIER, bz, 12.3, 0.12, 9.1); }
    }
  }
  if (detail >= 1) {
    lineAt(GANGWAY_X, FLOOD_WALL);
    // Gangway down to the flood wall, then a stair to the quay.
    ink(t, STEEL, "=");
    strut(t, GANGWAY_X - 14, deck + 0.3, z - beam / 2 - 0.5, GANGWAY_X, FLOOD_WALL_TOP + 0.4, FLOOD_WALL + 1.5, 1.3);
    strut(t, GANGWAY_X, FLOOD_WALL_TOP, FLOOD_WALL, GANGWAY_X, 0.1, GANGWAY_FOOT_Z, 1.2);
    // Mooring lines from bollards on the wall to the bow and stern.
    ink(t, RAIL, "-", 0.6);
    for (const [bx, sx, sy] of [[-100, -106, 13.5], [-76, -96, 13.5], [76, 92, 14.5], [100, 104, 15]] as const) strut(t, bx, FLOOD_WALL_TOP + 0.8, FLOOD_WALL + 1, sx, sy, z - beam / 2 - 0.3, 0.15);
    if (detail === 2) {
      ink(t, RAIL, "-", 0.6); strut(t, GANGWAY_X - 14, deck + 1.4, z - beam / 2 - 0.5, GANGWAY_X, FLOOD_WALL_TOP + 1.5, FLOOD_WALL + 1.5, 0.08);
      ink(t, DARK, "#");
      for (const bx of [-100, -76, -52, 28, 52, 76, 100]) box(t, bx, FLOOD_WALL_TOP + 0.6, FLOOD_WALL + 1, 0.8, 1.2, 0.8);
      ink(t, DARK, "o"); for (let fx = -90; fx <= 90; fx += 20) box(t, fx, 2.2, FLOOD_WALL + 3.5, 2, 3, 2);
      // Deck lamps along the near rail.
      ink(t, WINDOW, "o"); for (let px = -66; px < 86; px += 26) box(t, px, deck + 2.2, face, 0.6, 0.5, 0.6);
    }
  }
  for (const crane of QUAY_CRANES) quayCrane(t, crane, time, detail);
}

function quayCrane(t: PropCanvas, crane: QuayCrane, time: number, detail: LandmarkDetail): void {
  const C = CRANE, cx = crane.x, mz = (C.landZ + C.seaZ) / 2;
  lineAt(cx, mz);
  // The portal legs stand in the jib floodlight's spill: a touch brighter than the lattice above.
  ink(t, CRANE_PAINT, "#", 1.1);
  for (const dx of [-C.legX, C.legX]) for (const lz of [C.landZ, C.seaZ]) box(t, cx + dx, C.portalY / 2, lz, 1.4, C.portalY, 1.4);
  ink(t, CRANE_PAINT, "=");
  for (const lz of [C.landZ, C.seaZ]) box(t, cx, C.portalY + 0.6, lz, 2 * C.legX + 1.6, 1.6, 1.6);
  // Upper legs lean in to the boom girders; the boom runs from the backreach out past the ship.
  ink(t, CRANE_PAINT, "X");
  for (const dx of [-1, 1]) for (const lz of [C.landZ, C.seaZ]) strut(t, cx + dx * C.legX, C.portalY + 1, lz, cx + dx * 4, C.boomY, lz, 1.1);
  if (detail === 0) box(t, cx, C.boomY, (C.backZ + C.tipZ) / 2, 9.2, 2.2, C.tipZ - C.backZ);
  else for (const dx of [-4, 4]) box(t, cx + dx, C.boomY, (C.backZ + C.tipZ) / 2, 1.2, 2.2, C.tipZ - C.backZ);
  // A-frame apex with fore- and backstays.
  for (const dx of [-1, 1]) { strut(t, cx + dx * 4, C.boomY + 1, C.landZ, cx + dx * 3, C.apexY, mz, 1); strut(t, cx + dx * 4, C.boomY + 1, C.seaZ, cx + dx * 3, C.apexY, mz, 1); }
  box(t, cx, C.apexY, mz, 7.2, 1, 1);
  if (detail >= 1) {
    ink(t, STEEL, "-", 0.8);
    for (const dx of [-3, 3]) { strut(t, cx + dx, C.apexY, mz, cx + dx * 4 / 3, C.boomY + 1, C.tipZ - 2, 0.3); strut(t, cx + dx, C.apexY, mz, cx + dx * 4 / 3, C.boomY + 1, C.backZ + 1, 0.3); }
    ink(t, CRANE_PAINT, "="); box(t, cx, C.portalY, mz, 2 * C.legX + 1.6, 1.2, 1.2);
    for (const dx of [-C.legX, C.legX]) box(t, cx + dx, C.portalY, mz, 1.4, 1.4, C.seaZ - C.landZ + 1.4);
  }
  ink(t, HOUSE, "#", 0.5); box(t, cx, C.boomY + 2.9, C.backZ + 5, 10, 3.6, 8);
  if (detail >= 1) { ink(t, WINDOW, "="); box(t, cx, C.boomY + 3.3, C.backZ + 5, 10.2, 0.8, 8.2); }
  // Trolley, operator cab (lit full warm) and spreader on their slow cycle (TROLLEY_PERIOD).
  const trolley = craneTrolley(time, crane), sy = spreaderY(trolley.z, trolley.drop);
  ink(t, DARK, "#"); box(t, cx, C.boomY - 1.8, trolley.z, 6, 1.6, 4);
  ink(t, WINDOW, "="); box(t, cx, C.boomY - 3.4, trolley.z, 2.8, 1.5, 2.8);
  if (detail >= 1) { ink(t, STEEL, "|", 0.7); for (const dx of [-2.5, 2.5]) box(t, cx + dx, (C.boomY - 2.6 + sy) / 2, trolley.z, 0.12, C.boomY - 2.6 - sy, 0.12); }
  ink(t, SPREADER, "=", 0.85); box(t, cx, sy, trolley.z, 12.4, 0.8, 2.6);
  // The colour advances on the trolley's own cycle (craneTrolley: time / TROLLEY_PERIOD + phase), so a
  // box keeps its colour for the whole swing and the next one is new; the integer offset varies cranes.
  if (trolley.loaded) { const color = CONTAINER_COLORS[((Math.floor(time / TROLLEY_PERIOD + crane.phase) + Math.floor(crane.phase * 7)) % CONTAINER_COLORS.length + CONTAINER_COLORS.length) % CONTAINER_COLORS.length]; ink(t, color, "|", 0.55); box(t, cx, sy - 1.7, trolley.z, 12.2, 2.6, 2.44); }
  // A steady red lamp on the apex; warning lamps on both ends of the jib breathing at LAMP_BREATH_HZ
  // (never dark); the jib's floodlight over the quay (its pool: sights.ts QUAY_POOLS) at every tier,
  // the lamps over the ship nearer.
  ink(t, LAMP_RED, "@"); box(t, cx, C.apexY + 1, mz, 0.8, 0.8, 0.8);
  ink(t, LAMP_RED, "@", breathe(time, crane.phase * 6)); box(t, cx, C.boomY + 1.6, C.tipZ, 0.9, 0.9, 0.9); box(t, cx, C.boomY + 1.6, C.backZ, 0.9, 0.9, 0.9);
  ink(t, LAMP_WHITE, "@"); box(t, cx, C.boomY - 1.5, CRANE_FLOOD_Z, 1.4, 0.6, 1.4);
  if (detail >= 1) { ink(t, WINDOW, "@"); for (const fz of [812, 832]) box(t, cx, C.boomY - 1.5, fz, 1.2, 0.5, 1.2); }
}

// ---- The Spillway Barrier.
function barrier(t: PropCanvas, time: number, detail: LandmarkDetail): void {
  const B = BARRIER, x = B.x, length = 2 * B.half, side = Math.sign(eyeX - x) || -1, wall = x + side * B.thickness / 2;
  lineAt(wall, B.z);
  ink(t, CONCRETE, "#", 0.8);
  box(t, x, (B.sill + KEEL_Y) / 2, B.z, B.thickness, B.sill - KEEL_Y, length);
  for (const pz of BARRIER_PIERS) box(t, x, (B.crest + KEEL_Y) / 2, pz, B.pierDepth, B.crest - KEEL_Y, 2 * B.pierHalf);
  ink(t, CONCRETE, "=", 0.9); box(t, x, B.crest - 1.8, B.z, B.pierDepth + 1, 3.6, length + 2 * B.pierHalf);
  // Gates: steel leaves filling the bays to the crest; the spill bay's stands low.
  const gateWidth = 36 - 2 * B.pierHalf;
  ink(t, STEEL, "=", 0.8);
  for (const bz of BARRIER_BAYS) { const top = bz === B.spillZ ? B.gateTop : B.crest - 3.6; box(t, x, (B.sill + top) / 2, bz, B.thickness - 2, top - B.sill, gateWidth); }
  if (detail >= 1) {
    ink(t, DARK, "-");
    for (const bz of BARRIER_BAYS) { const top = bz === B.spillZ ? B.gateTop : B.crest - 3.6; for (let y = B.sill + 4; y < top; y += 4.5) box(t, x + side * (B.thickness / 2 - 1), y, bz, 0.25, 0.4, gateWidth); }
  }
  // Gate towers on the piers, joined by the hoist beam, each with a warning lamp breathing at LAMP_BREATH_HZ.
  ink(t, DARK, "#");
  for (const pz of BARRIER_PIERS) box(t, x, (B.crest + B.towerTop) / 2, pz, 7, B.towerTop - B.crest, 5);
  ink(t, STEEL, "="); box(t, x, B.towerTop - 0.6, B.z, 2.2, 1.2, length);
  ink(t, AMBER, "@", breathe(time));
  for (const pz of BARRIER_PIERS) box(t, x, B.towerTop + 0.9, pz, 1.3, 1.3, 1.3);
  if (detail >= 1) { ink(t, WINDOW, "="); for (const pz of BARRIER_PIERS) box(t, x + side * 3.55, B.crest + 6, pz, 0.1, 4, 0.9); }
  // Floodlit piers: a lamp at each pier's foot on the face toward the viewer, washing it warm, bright
  // low and fading up the face (its pool on the water: sights.ts WATER_POOLS).
  const pierFace = x + side * (B.pierDepth / 2 + 0.06), washTop = B.crest - 3.6, washMid = B.crest * 0.55;
  ink(t, PIER_WASH, "#", 0.8); for (const pz of BARRIER_PIERS) box(t, pierFace, (WATER_Y + washMid) / 2, pz, 0.1, washMid - WATER_Y, 2 * B.pierHalf + 0.1);
  if (detail >= 1) { ink(t, PIER_WASH, "#", 0.68); for (const pz of BARRIER_PIERS) box(t, pierFace, (washMid + washTop) / 2, pz, 0.1, washTop - washMid, 2 * B.pierHalf + 0.1); }
  ink(t, LAMP_WHITE, "@"); for (const pz of BARRIER_PIERS) box(t, x + side * (B.pierDepth / 2 + 1), 1.1, pz, 0.9, 0.9, 0.9);
  // A continuous amber lamp chain along the crest (one part: the 'o' glyph repeats cell by cell). A
  // metre tall, so it is never widened down over the title panel under the crest.
  ink(t, AMBER, "o"); box(t, x + side * (B.pierDepth / 2 + 0.6), B.crest + 0.6, B.z, 0.3, 1, length + 6);
  // Control cabins over the end bays: two lit window rows all round.
  for (const cz of BARRIER_CABINS) {
    ink(t, HOUSE, "#", 0.5); box(t, x, B.crest + 2.6, cz, 9, 5.2, 14);
    ink(t, WINDOW, "="); box(t, x, B.crest + 3.6, cz, 9.2, 1.2, 14.2);
    if (detail >= 1) box(t, x, B.crest + 1.5, cz, 9.2, 1.1, 14.2);
    ink(t, DARK, "="); box(t, x, B.crest + 5.4, cz, 10, 0.4, 15);
  }
  // The spillway: water pours over the low gate and down a chute on the city side. Far, a pale sheet;
  // nearer, streaks of falling-water glyphs scroll slowly down it (CHUTE_SCROLL, low contrast).
  const topX = wall + side * 0.1, footX = B.chuteFoot, chuteWidth = gateWidth - 3;
  lineAt(footX, B.spillZ);
  ink(t, CONCRETE, "=", 0.7); incline(t, topX, B.gateTop - 1, footX, WATER_Y - 0.6, B.spillZ, chuteWidth + 2, 1);
  for (const dz of [-1, 1]) incline(t, topX, B.gateTop + 1, footX, WATER_Y + 1.2, B.spillZ + dz * (chuteWidth / 2 + 0.5), 1, 3);
  // The chute's water catches white light from two lamps on the flanking piers.
  ink(t, CHUTE_WHITE, "|", 0.85); incline(t, topX, B.gateTop - 0.3, footX, WATER_Y + 0.1, B.spillZ, chuteWidth, 0.3);
  ink(t, CHUTE_WHITE, "~", 0.95); box(t, topX, B.gateTop + 0.3, B.spillZ, 1.2, 0.8, chuteWidth);
  ink(t, CHUTE_WHITE, "~", 0.8); box(t, footX + side * 5, WATER_Y + 0.15, B.spillZ, 10, 0.3, chuteWidth + 4);
  ink(t, LAMP_WHITE, "@"); for (const dz of [-1, 1]) box(t, x + side * (B.pierDepth / 2 + 0.6), B.gateTop + 6, B.spillZ + dz * (18 - B.pierHalf + 1.5), 1, 0.7, 1);
  if (detail >= 1) {
    const dx = footX - topX, dy = WATER_Y - B.gateTop, run = Math.hypot(dx, dy), gap = 8, seg = 3;
    ink(t, CHUTE_WHITE, ":", 0.8);
    for (let i = 0; i < 7; i++) {
      const sz = B.spillZ - chuteWidth / 2 + (i + 0.5) * chuteWidth / 7, offset = (time * CHUTE_SCROLL + hash(i, 5) * gap) % gap;
      for (let u = offset - gap; u < run; u += gap) {
        const u0 = Math.max(0, u), u1 = Math.min(run, u + seg);
        if (u1 - u0 < 0.3) continue;
        strut(t, topX + dx * u0 / run, B.gateTop + 0.4 + dy * u0 / run, sz, topX + dx * u1 / run, B.gateTop + 0.4 + dy * u1 / run, sz, 0.35);
      }
    }
  }
  // Catwalk along the city face under the crest, and the access bridge from the stair tower on the quay.
  lineAt(wall, B.z);
  const walkX = x + side * (B.pierDepth / 2 + 1.2);
  if (detail >= 1) { ink(t, STEEL, "="); box(t, walkX, 24, B.z, 2.4, 0.3, length); }
  ink(t, CONCRETE, "#", 0.7); box(t, B.stairX, (B.crest + 2) / 2, B.bridgeZ, 2 * B.stairHalf, B.crest + 2, 2 * B.stairHalf);
  ink(t, WINDOW, "=", 0.6); box(t, B.stairX, B.crest / 2, B.bridgeZ, 2 * B.stairHalf + 0.2, B.crest - 6, 1);
  const bridgeFrom = B.stairX + B.stairHalf, bridgeTo = x - B.pierDepth / 2;
  ink(t, STEEL, "="); box(t, (bridgeFrom + bridgeTo) / 2, B.crest + 0.2, B.bridgeZ, bridgeTo - bridgeFrom, 0.8, 3);
  if (detail >= 1) {
    ink(t, STEEL, "-");
    for (const dz of [-1.5, 1.5]) box(t, (bridgeFrom + bridgeTo) / 2, B.crest + 2.6, B.bridgeZ + dz, bridgeTo - bridgeFrom, 0.3, 0.3);
  }
  if (detail === 2) {
    lineAt(x, B.z);
    ink(t, RAIL, "-", 0.7);
    for (const rx of [x - B.pierDepth / 2 - 0.3, x + B.pierDepth / 2 + 0.3]) box(t, rx, B.crest + 1.1, B.z, 0.12, 0.12, length + 6);
    box(t, walkX + side * 1.1, 25.1, B.z, 0.1, 0.1, length);
    ink(t, RAIL, "|", 0.6);
    for (let pz = B.z - B.half; pz <= B.z + B.half; pz += 11) {
      for (const rx of [x - B.pierDepth / 2 - 0.3, x + B.pierDepth / 2 + 0.3]) box(t, rx, B.crest + 0.55, pz, 0.12, 1.1, 0.12);
      box(t, walkX + side * 1.1, 24.6, pz, 0.1, 1, 0.1);
    }
    for (let bx = bridgeFrom + 6; bx < bridgeTo; bx += 8) for (const dz of [-1.5, 1.5]) box(t, bx, B.crest + 1.4, B.bridgeZ + dz, 0.15, 2.4, 0.15);
    ink(t, WINDOW, "o", 0.8); for (const bz of BARRIER_BAYS) box(t, x + side * (B.pierDepth / 2 + 0.2), B.crest + 2.4, bz, 0.4, 0.4, 0.4);
  }
}

// ---- The Rainline cableway. Detail is per tower, span segment and cabin (the line is 900 m long).
function cableway(t: PropCanvas, time: number, low: boolean, seen: Seen): void {
  const C = CABLEWAY;
  const spans = CABLE_TOWERS.slice(1).map((b, i) => {
    const a = CABLE_TOWERS[i], mid = (a + b) / 2;
    return { a, b, seen: seen(C.x, cableHeight(mid), cableZ(mid), (b - a) / 2) };
  });
  CABLE_TOWERS.forEach((s, i) => { if (spans[Math.max(0, i - 1)].seen || spans[Math.min(spans.length - 1, i)].seen) cableTower(t, s, i === 0 || i === CABLE_TOWERS.length - 1); });
  for (const span of spans) {
    if (!span.seen) continue;
    const near = landmarkDetail(lineAt(C.x, cableZ((span.a + span.b) / 2)) - (span.b - span.a) / 2);
    const count = near === 2 ? 12 : near === 1 ? 8 : 5;
    // Near, a faint dotted line under the city-side cable traces its sag (the '.' repeats cell by cell).
    const dotted = near === 2 ? (Math.sign(eyeX - C.x) || 1) * C.gap / 2 : 0;
    for (let k = 0; k < count; k++) {
      const s0 = span.a + (span.b - span.a) * k / count, s1 = span.a + (span.b - span.a) * (k + 1) / count;
      lineAt(C.x, cableZ((s0 + s1) / 2));
      ink(t, STEEL, "-", 0.75);
      for (const dx of [-C.gap / 2, C.gap / 2]) strut(t, C.x + dx, cableHeight(s0), cableZ(s0), C.x + dx, cableHeight(s1), cableZ(s1), 0.2);
      if (dotted !== 0) { ink(t, SAG_DOTS, ".", 0.6); strut(t, C.x + dotted, cableHeight(s0) - 0.7, cableZ(s0), C.x + dotted, cableHeight(s1) - 0.7, cableZ(s1), 0.25); }
    }
  }
  for (let i = 0; i < CABIN_COUNT; i++) {
    const cabin = cabinPose(time, i);
    if (cabin.hidden) continue;
    const span = spans.find(item => cabin.s <= item.b) ?? spans[spans.length - 1];
    if (!span.seen) continue;
    const distance = lineAt(cabin.x, cabin.z), detail = landmarkDetail(distance);
    if (low && detail === 0 && i % 2 === 1) continue;
    const top = cabin.y + 1.3, cable = cableHeight(cabin.s);
    ink(t, DISTRICTS[3].color, "#", 0.4); box(t, cabin.x, cabin.y, cabin.z, 2.6, 2.6, 3.4);
    // Windows at full warm brightness; near, riders' silhouettes against them: a dark block through the
    // cabin, a hair wider than the lit band so it shows on both sides (at least a cell wide, so one
    // rider at the near tier's far end, two closer in).
    ink(t, WINDOW, "="); box(t, cabin.x, cabin.y + 0.3, cabin.z, 2.7, 1, 3.5);
    if (detail === 2) {
      ink(t, DARK, "#");
      const riders = minLine < 0.9 ? 2 : 1;
      for (let r = 0; r < riders; r++) box(t, cabin.x, cabin.y + 0.25, cabin.z + (riders === 1 ? 0.6 : r * 1.6 - 0.8) * (hash(i, 21) < 0.5 ? -1 : 1), 2.75, 0.8, 0.5);
    }
    if (detail >= 1) { ink(t, STEEL, "|", 0.8); box(t, cabin.x, (top + cable) / 2, cabin.z, 0.15, cable - top, 0.15); }
    if (detail === 2) { ink(t, DARK, "#"); box(t, cabin.x, top + 0.15, cabin.z, 2.2, 0.3, 3); box(t, cabin.x, cable, cabin.z, 0.5, 0.5, 1.2); }
  }
}
function cableTower(t: PropCanvas, s: number, terminal: boolean): void {
  const C = CABLEWAY, x = C.x, z = cableZ(s), top = cableHeight(s) + 1.2;
  const detail = landmarkDetail(lineAt(x, z));
  ink(t, DARK, "#"); box(t, x, -0.6, z, 12, 2.4, 12);
  ink(t, STEEL, "X");
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) strut(t, x + dx * 5, 0.5, z + dz * 5, x + dx * 1.6, top - 1, z + dz * 1.6, 1.1);
  if (detail >= 1) {
    ink(t, STEEL, "=");
    for (const f of [0.33, 0.66]) { const h = 0.5 + (top - 1.5) * f, w = 2 * (5 - 3.4 * f); box(t, x, h, z, w, 0.5, w); }
  }
  ink(t, STEEL, "="); box(t, x, top, z, C.gap + 4, 1.2, 2);
  ink(t, LAMP_RED, "@"); for (const dx of [-1, 1]) box(t, x + dx * (C.gap / 2 + 2), top + 1, z, 0.8, 0.8, 0.8);
  if (!terminal) {
    // Line towers: a lamp ring under the head and one round the caisson ('o' all round a thin shell;
    // their light on the water: sights.ts WATER_POOLS).
    ink(t, WINDOW, "o"); box(t, x, top - 2.2, z, 4.6, 0.5, 4.6); box(t, x, 0.75, z, 12.3, 0.3, 12.3);
    return;
  }
  // Terminal housing round the bullwheels, two lit bands all round; the cabins turn inside it.
  ink(t, HOUSE, "#", 0.5); box(t, x, top - 1, z, 16, 12, 2 * C.terminalHalf);
  ink(t, WINDOW, "="); box(t, x, top - 3.5, z, 16.2, 1.6, 2 * C.terminalHalf + 0.2);
  if (detail >= 1) box(t, x, top - 5.6, z, 16.2, 1, 2 * C.terminalHalf + 0.2); // under the RAINLINE title
  ink(t, DISTRICTS[3].color, "=", 0.8); box(t, x, top + 5.2, z, 17, 0.6, 2 * C.terminalHalf + 1);
  // The terminal building on the caisson, lit windows all round, and the lit lift shaft up the tower.
  ink(t, HOUSE, "#", 0.5); box(t, x, 4.4, z, 13, 7.6, 13);
  ink(t, WINDOW, "="); box(t, x, 4.6, z, 13.2, 1.4, 13.2);
  ink(t, WINDOW, "|", 0.9); box(t, x, (8.2 + top - 7) / 2, z, 1.2, top - 15.2, 1.2);
}

// ---- Titles: letter panels on solid faces (the depth test hides one seen from behind).
let titleCache: SignFace[] | null = null;
function titleFaces(): SignFace[] {
  if (titleCache) return titleCache;
  const faces: SignFace[] = [];
  const [vessel, gate, line] = ["ship", "barrier", "cableway"].map(id => SIGHTS.find(sight => sight.id === id));
  if (vessel) {
    const name = vessel.name.toUpperCase(), color: RGB = [214, 236, 255];
    // Harbour-light: larger (32 x 5 m) under a lamp bar (ship()), so it reads from the Rim stations.
    for (const side of [-1, 1]) faces.push({ x: 62, y: 9.6, z: SHIP.z + side * (SHIP.beam / 2 + 0.08), yaw: side < 0 ? 180 : 0, width: 32, height: 5, text: name, color, seed: TITLE_SEED });
    faces.push({ x: SHIP.stern - 0.08, y: 9.5, z: SHIP.z, yaw: -90, width: 12, height: 2.2, text: name, color, seed: TITLE_SEED });
  }
  if (gate) faces.push({ x: BARRIER.x - BARRIER.pierDepth / 2 - 0.58, y: BARRIER.crest - 1.8, z: BARRIER.z, yaw: -90, width: 44, height: 3, text: gate.name.toUpperCase(), color: gate.color, seed: TITLE_SEED });
  if (line) {
    for (const s of [0, CABLE_LENGTH]) faces.push({ x: CABLEWAY.x + 8.08, y: cableHeight(s) + 2.6, z: cableZ(s), yaw: 90, width: 13, height: 2.2, text: "RAINLINE", color: line.color, seed: TITLE_SEED });
  }
  titleCache = faces;
  return faces;
}
function titles(t: PropCanvas, seen: Seen): void {
  const recorder = t instanceof PropRecorder ? t : null, tag = recorder?.panelTag ?? -1;
  propRange(SIGHT_TITLE_RANGE);
  for (const face of titleFaces()) {
    const distance = Math.hypot(eyeX - face.x, eyeZ - face.z), angle = face.yaw * Math.PI / 180;
    if (distance > SIGHT_TITLE_RANGE + 20 || (eyeX - face.x) * Math.sin(angle) + (eyeZ - face.z) * Math.cos(angle) <= 0) continue;
    if (!seen(face.x, face.y, face.z, face.width / 2)) continue;
    // Captured with the shop panels (prop-canvas.ts replayPanels; the tag is the distance).
    if (recorder) recorder.panelTag = distance;
    drawLetterPanel(t, face);
  }
  if (recorder) recorder.panelTag = tag;
}
