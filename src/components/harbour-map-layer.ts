import { HARBOUR_COPING, HARBOUR_REACH, HARBOUR_ROAD, HARBOUR_WALL, harbourZone, type HarbourZone } from "../city/harbour.ts";
import { SIGHTS, type Sight } from "../city/world.ts";
import { MAP_OUTSIDE, MAP_QUAY, MAP_SIGHT, MAP_WALL_CORNER, MAP_WALL_H, MAP_WALL_V, MAP_WATER } from "./rail-map-codes.ts";

/**
 * The harbour on the world map (world-map-render.ts): past the Rim Roads' outer kerb a concrete
 * quay, the flood wall as a pale line of box-drawing cells, then open water out to the harbour's
 * reach, with the edge sights (world.ts SIGHTS) standing on it as dim footprints. Everything is
 * classified per character cell from harbour.ts, so it re-samples at every zoom like the city.
 *
 * The water texture is static (the terrain is cached and only redrawn when the view moves): a
 * sparse field of swell glyphs hashed from the cell's world-anchored index, so panning glides and
 * nothing crawls or flickers.
 */

/** The flood wall's coping band, measured from the centre (m). */
export const WALL_INNER = HARBOUR_ROAD + HARBOUR_WALL;
export const WALL_OUTER = WALL_INNER + HARBOUR_COPING;
/** Map ink: dark blue-grey water, a brighter swell crest, pale concrete wall, near-black quay. */
export const WATER_INK = "#25404e";
export const SWELL_INK = "#35596a";
export const WALL_INK = "#b9c6c0";
export const QUAY_INK = "#3a4644";
/** Water fill under the glyphs (the city has its own darker fill). */
export const WATER_FILL = "rgba(9, 22, 31, 0.92)";
export const QUAY_FILL = "rgba(16, 21, 22, 0.92)";

/**
 * The harbour class of a map cell centred at (x, z) whose real half sizes are halfW x halfH (m):
 * a wall cell when the cell overlaps the flood wall's coping (so the line never breaks up when a
 * cell is wider than the 2 m wall), else quay or water; 0 inside the city (the kerb and in), and
 * MAP_OUTSIDE past the harbour's reach.
 */
export function harbourCode(x: number, z: number, halfW: number, halfH: number): number {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > HARBOUR_REACH || az > HARBOUR_REACH) return MAP_OUTSIDE;
  const crossX = ax + halfW > WALL_INNER && ax - halfW < WALL_OUTER && az - halfH < WALL_OUTER;
  const crossZ = az + halfH > WALL_INNER && az - halfH < WALL_OUTER && ax - halfW < WALL_OUTER;
  if (crossX && crossZ) return MAP_WALL_CORNER;
  if (crossX) return MAP_WALL_V;
  if (crossZ) return MAP_WALL_H;
  const zone: HarbourZone = harbourZone(x, z);
  if (zone === "city") return 0;
  return zone === "quay" ? MAP_QUAY : MAP_WATER;
}

/** The edge sight whose footprint covers (x, z), as a map code (MAP_SIGHT - index), or 0. Thin
 * footprints (the cableway) still take a column of cells: the test widens to half a cell. */
export function sightCode(x: number, z: number, halfW: number, halfH: number, sights: readonly Sight[] = SIGHTS): number {
  for (let i = 0; i < sights.length; i++) {
    const sight = sights[i];
    if (Math.abs(x - sight.x) < Math.max(sight.halfX, halfW) && Math.abs(z - sight.z) < Math.max(sight.halfZ, halfH)) return MAP_SIGHT - i;
  }
  return 0;
}

/** The sight under a world point (hover readout), or null. */
export const sightAt = (x: number, z: number, sights: readonly Sight[] = SIGHTS): Sight | null =>
  sights.find((sight) => Math.abs(x - sight.x) < sight.halfX && Math.abs(z - sight.z) < sight.halfZ) ?? null;

/** Fill glyph inside a sight's footprint, by kind (anything new falls back to a dot). */
const SIGHT_FILL: Partial<Record<string, string>> = { ship: "=", barrier: "#", cableway: ":" };
export const sightFill = (sight: Sight): string => SIGHT_FILL[sight.kind] ?? ".";

/**
 * The water glyph of the cell at global (world-anchored) index (i, j): mostly empty, with long
 * swell bands of "-" and their crests as "~". Static: the same cell always draws the same glyph.
 */
export function waterGlyph(i: number, j: number): string {
  const swell = Math.sin(i * 0.31 + j * 0.83) + 0.6 * Math.sin(i * -0.17 + j * 0.47 + 1.7);
  if (swell > 1.3) return "~";
  if (swell > 0.95 && ((i * 3 + j) & 3) === 0) return "-";
  return "";
}

/** The wall cell's glyph: a single pale box-drawing line, cornered where the two sides meet. */
export function wallGlyph(code: number, x: number, z: number): string {
  if (code === MAP_WALL_H) return "─";
  if (code === MAP_WALL_V) return "│";
  return z < 0 ? (x < 0 ? "┌" : "┐") : (x < 0 ? "└" : "┘");
}

/** Hover readout name for a harbour zone. */
export const HARBOUR_ZONE_NAME: Record<HarbourZone, string> = { city: "Rim Road", quay: "Harbour quay", wall: "Flood wall", water: "Open water" };
