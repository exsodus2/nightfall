import { BLOCK_SIZE, HALF_BLOCKS, districtAt } from "./world.ts";

/** Street names for the map. Streets run along every block boundary (multiples of BLOCK_SIZE);
 * north–south streets are indexed west → east, east–west streets north → south (north is −z). */
export const NS_STREETS: readonly string[] = [
  "West Rim Road", "Kiln Street", "Slag Row", "Cinder Street", "Anvil Way", "Bellows Lane", "Ashfall Street",
  "Hollis Street", "Lantern Row", "Ozu Street", "Kowloon Street", "Paper Moon Lane",
  "Meridian Avenue",
  "Hanami Street", "Vesper Street", "Juniper Row", "Pale Street", "Static Way", "Relay Street",
  "Carrier Row", "Obi Street", "Cathode Lane", "Dusk Street", "Low Tide Row", "East Rim Road",
];
export const EW_STREETS: readonly string[] = [
  "North Rim Road", "Kestrel Street", "Sodium Street", "Furnace Row", "Chrome Street", "Sable Street",
  "Cobalt Street", "Ember Line", "Neon Parade", "Mori Street", "Aerial Row", "Umbra Street",
  "Canal Street",
  "Lotus Street", "Silk Row", "Mako Street", "Fern Street", "Loop Line", "Monsoon Street",
  "Arcade Row", "Jade Street", "Umbrella Lane", "Spillway Street", "Tidewater Row", "South Rim Road",
];

const lineIndex = (value: number): number => Math.max(-HALF_BLOCKS, Math.min(HALF_BLOCKS, Math.round(value / BLOCK_SIZE)));

export function nsStreet(x: number): { name: string; x: number } {
  const index = lineIndex(x);
  return { name: NS_STREETS[index + HALF_BLOCKS], x: index * BLOCK_SIZE };
}
export function ewStreet(z: number): { name: string; z: number } {
  const index = lineIndex(z);
  return { name: EW_STREETS[index + HALF_BLOCKS], z: index * BLOCK_SIZE };
}

/** The nearest street, or a corner ("A & B") when close to both. */
export function streetNameAt(x: number, z: number): string {
  const ns = nsStreet(x), ew = ewStreet(z);
  const dx = Math.abs(x - ns.x), dz = Math.abs(z - ew.z);
  if (dx < 14 && dz < 14) return `${ns.name} & ${ew.name}`;
  return dx <= dz ? ns.name : ew.name;
}

/** A human label for a spot: "Street, District". */
export function placeName(x: number, z: number): string {
  return `${streetNameAt(x, z)}, ${districtAt(x, z).name}`;
}
