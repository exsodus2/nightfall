import { GROUND_FLOOR_KINDS, type GroundFloorKind, type InteriorPlace } from "../city/interiors.ts";
import { groundFloorsInBlock } from "../city/building-interiors.ts";
import { BLOCK_SIZE, type CityWorld } from "../city/world.ts";
import type { QuestLayerView } from "./quest-map-layer.ts";

/**
 * Ground-floor discovery icons (world map + minimap): one small glyph per enterable building at
 * its door, drawn beneath the venue / quest / waypoint markers. Visible places are gathered per
 * viewport change (block range), never per frame, and culled by pixel box when drawn.
 */

/** World map: icons appear once zoomed in past this scale (px per metre). */
export const GROUND_ICON_SCALE = 1.6;
/** Minimap: icon count cap and the minimal zoom (the minimap is always zoomed in). */
export const MINIMAP_ICON_LIMIT = 14;

export const GROUND_GLYPH: Readonly<Record<GroundFloorKind, string>> = {
  lobby: "▪", "capsule-hotel": "▤", "corp-lobby": "♦", arcade: "◘", pawnshop: "$", "machine-shop": "≡", "server-hall": "#",
  shrine: "Ψ", hydroponics: "*", laundromat: "o", "market-hall": "%", chandlery: "±", apartment: "▦", garage: "=",
};
export const GROUND_LABEL: Readonly<Record<GroundFloorKind, string>> = {
  lobby: "Lobby", "capsule-hotel": "Capsule hotel", "corp-lobby": "Corporate lobby", arcade: "Arcade", pawnshop: "Pawnshop", "machine-shop": "Machine shop",
  "server-hall": "Server hall", shrine: "Shrine", hydroponics: "Hydroponics", laundromat: "Laundromat", "market-hall": "Market hall", chandlery: "Chandlery",
  apartment: "Apartments", garage: "Garage",
};
/** Soft inks, kept off the venue teal / club pink so a doorway still reads as the special thing. */
export const GROUND_INK: Readonly<Record<GroundFloorKind, string>> = {
  lobby: "#9fb4bd", "capsule-hotel": "#8fb7e8", "corp-lobby": "#c4b8f0", arcade: "#f0a0d0", pawnshop: "#e8c070", "machine-shop": "#e8946a", "server-hall": "#7ad0f0",
  shrine: "#f0d878", hydroponics: "#8ee08a", laundromat: "#a6e4e0", "market-hall": "#f0b48a", chandlery: "#80b8a8", apartment: "#b8a8a0", garage: "#c8c88a",
};

export const isGroundKind = (kind: string): kind is GroundFloorKind => (GROUND_FLOOR_KINDS as readonly string[]).includes(kind);

// ---- Per-session state ----------------------------------------------------------------------------

const visited = new Set<string>();
/** Remember a ground floor the player has been inside (`snapshot.interior?.id`, ground floors are `bldg-<n>`). */
export function noteGroundVisit(id: string | null | undefined): void { if (id && /^bldg-\d+$/.test(id)) visited.add(id); } // upper floors (bldg-<n>-f<k>) are not doors
export const groundVisited = (id: string): boolean => visited.has(id);
export const groundVisitCount = (): number => visited.size;

// ---- Gathering ------------------------------------------------------------------------------------

interface Gathered { world: CityWorld | null; key: string; list: readonly InteriorPlace[]; complete: boolean }
/** One slot per consumer (world map, minimap) so the two never evict each other. */
const gathered: Record<"map" | "mini", Gathered> = { map: { world: null, key: "", list: [], complete: false }, mini: { world: null, key: "", list: [], complete: false } };

/** Blocks built per call: a pan into new ground fills in over a few frames instead of stalling one. */
const BLOCKS_PER_CALL = 8;
/** Blocks already built through this layer (shared by both consumers; the places themselves live in building-interiors' cache). */
const builtBlocks = new WeakMap<CityWorld, Set<string>>();

/** First time each icon was drawn, for the short fade-in. */
const shownAt = new Map<string, number>();
const FADE_MS = 300;

/**
 * Ground floors whose block touches [x0,x1] x [z0,z1]. Blocks not built yet are built at most
 * BLOCKS_PER_CALL per call (both slots share the same block cache); until the range is complete
 * the list is re-gathered on the next call, so icons appear progressively. Cull by pixel when drawing.
 */
export function groundFloorsInRect(world: CityWorld, slot: "map" | "mini", x0: number, z0: number, x1: number, z1: number): readonly InteriorPlace[] {
  const bx0 = Math.floor(x0 / BLOCK_SIZE), bx1 = Math.floor(x1 / BLOCK_SIZE), bz0 = Math.floor(z0 / BLOCK_SIZE), bz1 = Math.floor(z1 / BLOCK_SIZE);
  const key = `${bx0},${bx1},${bz0},${bz1}`;
  const hit = gathered[slot];
  if (world === hit.world && key === hit.key && hit.complete) return hit.list;
  let built = builtBlocks.get(world);
  if (!built) { built = new Set(); builtBlocks.set(world, built); }
  let budget = BLOCKS_PER_CALL, complete = true;
  const list: InteriorPlace[] = [];
  for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
    const id = `${bx},${bz}`;
    if (!built.has(id)) {
      if (budget <= 0) { complete = false; continue; }
      budget--; built.add(id);
    }
    for (const place of groundFloorsInBlock(world, bx, bz)) list.push(place);
  }
  gathered[slot] = { world, key, list, complete };
  return list;
}

export interface GroundLayerOptions {
  world: CityWorld;
  hidden: ReadonlySet<GroundFloorKind>;
  /** Minimap: cap the icons drawn (nearest to the view centre) and draw fainter. */
  limit?: number;
}

function visiblePlaces(view: QuestLayerView, options: GroundLayerOptions): InteriorPlace[] {
  const pad = 2 / Math.max(0.001, view.size / (view.extent * 2));
  const list = groundFloorsInRect(options.world, options.limit === undefined ? "map" : "mini", view.centerX - view.extent, view.centerZ - view.extent, view.centerX + view.extent, view.centerZ + view.extent);
  const out: InteriorPlace[] = [];
  for (const place of list) {
    if (!isGroundKind(place.kind) || options.hidden.has(place.kind)) continue;
    if (Math.abs(place.entrance.x - view.centerX) > view.extent + pad || Math.abs(place.entrance.z - view.centerZ) > view.extent + pad) continue;
    out.push(place);
  }
  if (options.limit && out.length > options.limit) {
    out.sort((a, b) => Math.hypot(a.entrance.x - view.centerX, a.entrance.z - view.centerZ) - Math.hypot(b.entrance.x - view.centerX, b.entrance.z - view.centerZ));
    out.length = options.limit;
  }
  return out;
}

export function drawGroundFloorLayer(ctx: CanvasRenderingContext2D, view: QuestLayerView, options: GroundLayerOptions): void {
  const places = visiblePlaces(view, options);
  if (!places.length) return;
  const mini = options.limit !== undefined;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${mini ? 9 : 12}px "Cascadia Code", Consolas, monospace`;
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  const now = performance.now();
  for (const place of places) {
    const kind = place.kind as GroundFloorKind;
    const x = view.px(place.entrance.x), y = view.pz(place.entrance.z), seen = visited.has(place.id);
    const glyph = GROUND_GLYPH[kind];
    let first = shownAt.get(place.id);
    if (first === undefined) { first = now; shownAt.set(place.id, now); }
    const fade = Math.min(1, (now - first) / FADE_MS);
    ctx.globalAlpha = fade * (mini ? (seen ? 0.6 : 0.34) : seen ? 1 : 0.58);
    ctx.strokeStyle = "rgba(3, 9, 12, 0.85)";
    ctx.strokeText(glyph, x, y);
    ctx.fillStyle = seen ? "#f4fff8" : GROUND_INK[kind];
    ctx.fillText(glyph, x, y);
  }
  ctx.restore();
}

/** The ground floor icon under a screen point (world map, within `radius` px, default 11), or null. */
export function groundFloorAt(view: QuestLayerView, options: GroundLayerOptions, sx: number, sy: number, radius = 11): InteriorPlace | null {
  let best: InteriorPlace | null = null, bestDistance = radius;
  for (const place of visiblePlaces(view, options)) {
    const distance = Math.hypot(view.px(place.entrance.x) - sx, view.pz(place.entrance.z) - sy);
    if (distance < bestDistance) { best = place; bestDistance = distance; }
  }
  return best;
}

export const groundLabel = (place: InteriorPlace): string => `${place.name} — ${isGroundKind(place.kind) ? GROUND_LABEL[place.kind] : place.kind}${visited.has(place.id) ? " (visited)" : ""}`;

/** Kinds the player has switched off (world map legend); shared so the minimap follows the same filter. */
export const groundFilterMemory: { hidden: ReadonlySet<GroundFloorKind> } = { hidden: new Set() };
