import { RAIL_GEOMETRY, type RailGeometry } from "../city/world.ts";

/** Map cell classes for the monorail (world-map-render.ts): the City Loop's straights, verticals and
 * the two diagonals of its corners; the Rim Line uses the same shifted by RIM_CODE. All negative,
 * clear of the renderer's other cell codes (listed below; tests/map-layers.test.ts keeps them apart). */
export const RAIL_H = -3, RAIL_V = -4, RAIL_DOWN = -5, RAIL_UP = -6;
export const RIM_CODE = -9;

// ── Every other terrain cell class of the world map (world-map-render.ts) ─────────────────────────
// Buildings use their id (>= 0). Rail: -3 .. -6 (City Loop) and -12 .. -15 (Rim Line).
/** Not drawn (past the harbour, or off the map). */
export const MAP_OUTSIDE = -1;
/** Street or plaza (road markings when zoomed in). */
export const MAP_STREET = -2;
/** Harbour (harbour-map-layer.ts): quay apron, the flood wall's three line cells and open water. */
export const MAP_QUAY = -30, MAP_WALL_H = -31, MAP_WALL_V = -32, MAP_WALL_CORNER = -33, MAP_WATER = -34;
/** Indexed classes: entry i of a list is `base - i`, for i < span. */
export const MAP_PLATFORM = -107, MAP_PLATFORM_SPAN = 93;   // station platforms (STATIONS), -107 .. -199
export const MAP_LANDMARK = -200, MAP_LANDMARK_SPAN = 800;  // LANDMARKS, -200 .. -999
export const MAP_SIGHT = -1000, MAP_SIGHT_SPAN = 1000;      // edge SIGHTS (ship, barrier, cableway), -1000 .. -1999
/** Index into an indexed class (`base - index`), or -1 when the code is not in that class. */
export const codeIndex = (code: number, base: number, span: number): number => (code <= base && code > base - span ? base - code : -1);

/** One line's rounded rectangle (world.ts RAIL_GEOMETRY): straights, then the four corner arcs. */
function lineCode(g: RailGeometry, x: number, z: number, halfW: number, halfH: number, halfArc: number): number {
  const sx = g.hx - g.radius, sz = g.hz - g.radius;
  if (Math.abs(x) <= sx && (Math.abs(z + g.hz) < halfH || Math.abs(z - g.hz) < halfH)) return RAIL_H;
  if (Math.abs(z) <= sz && (Math.abs(x - g.hx) < halfW || Math.abs(x + g.hx) < halfW)) return RAIL_V;
  for (const [cx, cz] of [[sx, -sz], [sx, sz], [-sx, sz], [-sx, -sz]]) {
    const dx = x - cx, dz = z - cz;
    if (Math.sign(dx) !== Math.sign(cx) || Math.sign(dz) !== Math.sign(cz)) continue;
    if (Math.abs(Math.hypot(dx, dz) - g.radius) >= halfArc) continue;
    const tx = -dz, tz = dx; // tangent (screen x right, z down)
    if (Math.abs(tz) < Math.abs(tx) * 0.4) return RAIL_H;
    if (Math.abs(tx) < Math.abs(tz) * 0.4) return RAIL_V;
    return tx * tz > 0 ? RAIL_DOWN : RAIL_UP;
  }
  return 0;
}

/** The rail class of a map cell centred at (x, z) with the given half sizes: a loop code, a loop code
 * plus RIM_CODE on the Rim Line, or 0 off the track. */
export function railCode(x: number, z: number, halfW: number, halfH: number, halfArc: number): number {
  for (let line = 0; line < RAIL_GEOMETRY.length; line++) {
    const code = lineCode(RAIL_GEOMETRY[line], x, z, halfW, halfH, halfArc);
    if (code) return line === 0 ? code : code + RIM_CODE;
  }
  return 0;
}
/** Rim Line cells carry RIM_CODE on top of a loop code. */
export const isRimCode = (code: number): boolean => code <= RAIL_H + RIM_CODE && code >= RAIL_UP + RIM_CODE;
/** Any rail cell, either line. */
export const isRailCode = (code: number): boolean => (code <= RAIL_H && code >= RAIL_UP) || isRimCode(code);
