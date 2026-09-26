import { BLOCK_SIZE, DISTRICTS, HALF_BLOCKS, LANDMARKS, WORLD_EDGE, type Building, type CityWorld, type Landmark } from "@/city/world";
import { STATIONS, localToWorld, trainAt, worldToLocal } from "@/city/metro";
import { EW_STREETS, NS_STREETS } from "@/city/streets";
import { formatMetres, type Waypoint } from "@/city/waypoints";
import type { QuestSnapshot } from "@/city/quests";
import { drawQuestLayer } from "./quest-map-layer";

/**
 * The world map, drawn as a terminal: the terrain is a grid of ASCII cells anchored to world
 * coordinates (so panning glides and zooming re-samples the city into characters), redrawn from
 * the world model whenever the view changes, never scaled from a bitmap. Labels, markers, trains,
 * friends and the player are vector overlays drawn every animation frame.
 */

export const CELL_W = 8;
export const CELL_H = 12;
export const MAX_SCALE = 9;
const MONO = '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

export interface MapView { cx: number; cz: number; scale: number; width: number; height: number; dpr: number }
export interface MapFriend { id: string; name?: string; x: number; z: number; yaw?: number; color?: string }

export const toScreen = (view: MapView, x: number, z: number): [number, number] => [view.width / 2 + (x - view.cx) * view.scale, view.height / 2 + (z - view.cz) * view.scale];
export const toWorld = (view: MapView, sx: number, sy: number): [number, number] => [view.cx + (sx - view.width / 2) / view.scale, view.cz + (sy - view.height / 2) / view.scale];
/** Zoomed out far enough to see the whole city with a margin. */
export const minScale = (width: number, height: number): number => Math.max(0.05, Math.min(width, height) / (WORLD_EDGE * 2 + 180));

// ── Cell classification ────────────────────────────────────────────────────────────────────────
const OUTSIDE = -1, STREET = -2, RAIL_H = -3, RAIL_V = -4, RAIL_DOWN = -5, RAIL_UP = -6, PLATFORM = -7, LANDMARK = -20;
const FOOTPRINT: Record<Landmark["kind"], number> = { spire: 13, gate: 0, reactor: 11, array: 10, garden: 9, market: 14 };
const STYLE_FILL = [".", ":", "=", "/", "\"", "x", "'", "~"];
const CORNERS = [{ x: 448, z: -256 }, { x: 448, z: 256 }, { x: -448, z: 256 }, { x: -448, z: -256 }];

function rgb(color: readonly number[], gain: number): string {
  return `rgb(${Math.round(color[0] * gain)},${Math.round(color[1] * gain)},${Math.round(color[2] * gain)})`;
}
const LEVELS = [0.26, 0.4, 0.58, 0.8, 1];
const DISTRICT_INK = DISTRICTS.map((district) => LEVELS.map((gain) => rgb(district.color, gain)));
const STATION_INK = STATIONS.map((station) => rgb(station.color, 0.85));
const LANDMARK_INK = LANDMARKS.map((landmark) => [rgb(landmark.color, 0.7), rgb(landmark.color, 1)]);
const RAIL_INK = "#6fd6c4";
const ROAD_INK = "#2a5a60";
const ROAD_CROSS_INK = "#3a7479";

function railCode(x: number, z: number, halfW: number, halfH: number, halfArc: number): number {
  if (Math.abs(x) <= 448 && (Math.abs(z + 320) < halfH || Math.abs(z - 320) < halfH)) return RAIL_H;
  if (Math.abs(z) <= 256 && (Math.abs(x - 512) < halfW || Math.abs(x + 512) < halfW)) return RAIL_V;
  for (const corner of CORNERS) {
    const dx = x - corner.x, dz = z - corner.z;
    if (Math.sign(dx) !== Math.sign(corner.x) || Math.sign(dz) !== Math.sign(corner.z)) continue;
    if (Math.abs(Math.hypot(dx, dz) - 64) >= halfArc) continue;
    const tx = -dz, tz = dx; // tangent (screen x right, z down)
    if (Math.abs(tz) < Math.abs(tx) * 0.4) return RAIL_H;
    if (Math.abs(tx) < Math.abs(tz) * 0.4) return RAIL_V;
    return tx * tz > 0 ? RAIL_DOWN : RAIL_UP;
  }
  return 0;
}

function landmarkIndex(x: number, z: number): number {
  for (let i = 0; i < LANDMARKS.length; i++) {
    const landmark = LANDMARKS[i];
    if (landmark.kind === "gate") { if (Math.abs(x) < 13.5 && Math.abs(z - landmark.z) < 2.2) return i; continue; }
    const half = FOOTPRINT[landmark.kind];
    if (Math.abs(x - landmark.x) < half && Math.abs(z - landmark.z) < half) return i;
  }
  return -1;
}

function onPlatform(x: number, z: number): number {
  for (let i = 0; i < STATIONS.length; i++) {
    const station = STATIONS[i];
    if (Math.abs(station.x - x) > 40 || Math.abs(station.z - z) > 40) continue;
    const { u, v } = worldToLocal(station, x, z);
    if (u > 3.3 && u < 9.8 && Math.abs(v) < 25.8) return i;
  }
  return -1;
}

/** Lazily rasterised glyph sprites (one per glyph + colour) at device resolution. */
class GlyphAtlas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly slots = new Map<string, number>();
  private readonly perRow = 64;
  readonly cw: number;
  readonly ch: number;
  private readonly font: string;
  constructor(cw: number, ch: number, dpr: number) {
    this.cw = cw; this.ch = ch;
    this.canvas = document.createElement("canvas");
    this.canvas.width = cw * this.perRow;
    this.canvas.height = ch * 48;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.font = `${Math.round(11 * dpr)}px ${MONO}`;
  }
  slot(glyph: string, color: string): number {
    const key = `${glyph}${color}`;
    let slot = this.slots.get(key);
    if (slot !== undefined) return slot;
    slot = this.slots.size;
    if (slot >= this.perRow * 48) return 0;
    this.slots.set(key, slot);
    const x = (slot % this.perRow) * this.cw, y = Math.floor(slot / this.perRow) * this.ch;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, this.cw, this.ch); ctx.clip();
    ctx.font = this.font; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = color;
    ctx.fillText(glyph, x + this.cw / 2, y + this.ch / 2 + 0.5);
    ctx.restore();
    return slot;
  }
  draw(target: CanvasRenderingContext2D, slot: number, x: number, y: number): void {
    target.drawImage(this.canvas, (slot % this.perRow) * this.cw, Math.floor(slot / this.perRow) * this.ch, this.cw, this.ch, x, y, this.cw, this.ch);
  }
}

/** The ASCII terrain: cached into its own canvas and redrawn only when the view changes. */
export class TerrainLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly world: CityWorld;
  private readonly blocks: (readonly Building[])[] = [];
  private atlas: GlyphAtlas | null = null;
  private key = "";
  private codes = new Int32Array(0);

  constructor(world: CityWorld) {
    this.world = world;
    const span = HALF_BLOCKS * 2;
    for (let bz = -HALF_BLOCKS; bz < HALF_BLOCKS; bz++) for (let bx = -HALF_BLOCKS; bx < HALF_BLOCKS; bx++) {
      this.blocks[(bz + HALF_BLOCKS) * span + bx + HALF_BLOCKS] = world.blocks.get(`${bx},${bz}`)?.buildings ?? [];
    }
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  blockBuildings(bx: number, bz: number): readonly Building[] {
    if (bx < -HALF_BLOCKS || bx >= HALF_BLOCKS || bz < -HALF_BLOCKS || bz >= HALF_BLOCKS) return [];
    return this.blocks[(bz + HALF_BLOCKS) * HALF_BLOCKS * 2 + bx + HALF_BLOCKS];
  }

  buildingAt(x: number, z: number): Building | null {
    const bx = Math.floor(x / BLOCK_SIZE), bz = Math.floor(z / BLOCK_SIZE);
    if (bx < -HALF_BLOCKS || bx >= HALF_BLOCKS || bz < -HALF_BLOCKS || bz >= HALF_BLOCKS) return null;
    for (const building of this.blocks[(bz + HALF_BLOCKS) * HALF_BLOCKS * 2 + bx + HALF_BLOCKS]) {
      if (Math.abs(x - building.x) < building.width / 2 && Math.abs(z - building.z) < building.depth / 2) return building;
    }
    return null;
  }

  render(view: MapView): HTMLCanvasElement {
    const { dpr } = view;
    const W = Math.max(1, Math.round(view.width * dpr)), H = Math.max(1, Math.round(view.height * dpr));
    const key = `${view.cx.toFixed(2)},${view.cz.toFixed(2)},${view.scale.toFixed(5)},${W},${H}`;
    if (key === this.key) return this.canvas;
    this.key = key;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const cw = Math.max(4, Math.round(CELL_W * dpr)), ch = Math.max(6, Math.round(CELL_H * dpr));
    if (!this.atlas || this.atlas.cw !== cw || this.atlas.ch !== ch) this.atlas = new GlyphAtlas(cw, ch, dpr);
    const atlas = this.atlas, ctx = this.ctx;
    const pxPerMetre = view.scale * dpr;
    const cellW = cw / pxPerMetre, cellH = ch / pxPerMetre;
    const left = view.cx - W / 2 / pxPerMetre, top = view.cz - H / 2 / pxPerMetre;
    const sx = (x: number) => (x - left) * pxPerMetre, sy = (z: number) => (z - top) * pxPerMetre;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(2, 7, 10, 0.6)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(4, 11, 15, 0.9)";
    ctx.fillRect(sx(-WORLD_EDGE), sy(-WORLD_EDGE), WORLD_EDGE * 2 * pxPerMetre, WORLD_EDGE * 2 * pxPerMetre);
    // Faint district washes under the characters.
    for (const district of DISTRICTS) {
      const x0 = district.x < -100 ? -WORLD_EDGE : district.x > 100 ? 256 : -256, x1 = district.x < -100 ? -256 : district.x > 100 ? WORLD_EDGE : 256;
      const z0 = district.z < 0 ? -WORLD_EDGE : 0, z1 = district.z < 0 ? 0 : WORLD_EDGE;
      ctx.fillStyle = rgb(district.color, 1).replace("rgb", "rgba").replace(")", ",0.035)");
      ctx.fillRect(sx(x0), sy(z0), (x1 - x0) * pxPerMetre, (z1 - z0) * pxPerMetre);
    }

    const i0 = Math.floor(Math.max(left, -WORLD_EDGE) / cellW) - 1, i1 = Math.ceil(Math.min(left + W / pxPerMetre, WORLD_EDGE) / cellW) + 1;
    const j0 = Math.floor(Math.max(top, -WORLD_EDGE) / cellH) - 1, j1 = Math.ceil(Math.min(top + H / pxPerMetre, WORLD_EDGE) / cellH) + 1;
    const cols = Math.max(0, i1 - i0 + 1), rows = Math.max(0, j1 - j0 + 1);
    if (!cols || !rows) return this.canvas;
    if (this.codes.length < cols * rows) this.codes = new Int32Array(cols * rows);
    const codes = this.codes;
    const coarse = cellW > 5.5;
    const halfW = Math.max(2.6, cellW / 2), halfH = Math.max(2.6, cellH / 2), halfArc = Math.max(2.6, Math.max(cellW, cellH) * 0.5);
    for (let j = 0; j < rows; j++) {
      const z0 = (j0 + j) * cellH, zc = z0 + cellH / 2;
      for (let i = 0; i < cols; i++) {
        const x0 = (i0 + i) * cellW, xc = x0 + cellW / 2;
        let code: number;
        if (Math.abs(xc) > WORLD_EDGE || Math.abs(zc) > WORLD_EDGE) code = OUTSIDE;
        else {
          const landmark = landmarkIndex(xc, zc);
          if (landmark >= 0) code = LANDMARK - landmark;
          else {
            code = railCode(xc, zc, halfW, halfH, halfArc);
            if (!code) {
              const platform = coarse ? -1 : onPlatform(xc, zc);
              if (platform >= 0) code = PLATFORM - 100 - platform;
              // Zoomed out, a cell that contains a street centreline is street, so the grid never closes up.
              else if (coarse && (Math.floor(x0 / BLOCK_SIZE) !== Math.floor((x0 + cellW) / BLOCK_SIZE) || Math.floor(z0 / BLOCK_SIZE) !== Math.floor((z0 + cellH) / BLOCK_SIZE))) code = STREET;
              else code = this.buildingAt(xc, zc)?.id ?? STREET;
            }
          }
        }
        codes[j * cols + i] = code;
      }
    }

    const originX = sx(0), originY = sy(0);
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= cols || j >= rows ? OUTSIDE : codes[j * cols + i]);
    const markings = !coarse;
    for (let j = 0; j < rows; j++) {
      const y = Math.round(originY + (j0 + j) * ch);
      const zc = ((j0 + j) + 0.5) * cellH;
      for (let i = 0; i < cols; i++) {
        const code = codes[j * cols + i];
        if (code === OUTSIDE) continue;
        let glyph = "", color = "";
        if (code >= 0) {
          const building = this.world.buildings[code];
          const base = building.height < 60 ? 1 : building.height < 100 ? 2 : 3;
          const ink = DISTRICT_INK[building.district];
          const spanX = building.width / cellW, spanZ = building.depth / cellH;
          if (spanX < 2.6 || spanZ < 2.6) {
            glyph = building.height < 48 ? "=" : building.height < 70 ? "+" : building.height < 100 ? "#" : building.height < 130 ? "%" : "@";
            color = ink[base];
          } else {
            const vertical = at(i - 1, j) !== code || at(i + 1, j) !== code;
            const horizontal = at(i, j - 1) !== code || at(i, j + 1) !== code;
            if (vertical && horizontal) { glyph = "+"; color = ink[Math.min(4, base + 1)]; }
            else if (vertical) { glyph = "|"; color = ink[Math.min(4, base + 1)]; }
            else if (horizontal) { glyph = "-"; color = ink[Math.min(4, base + 1)]; }
            else { glyph = STYLE_FILL[building.style]; color = ink[base - 1]; }
          }
        } else if (code === RAIL_H) { glyph = "═"; color = RAIL_INK; }
        else if (code === RAIL_V) { glyph = "║"; color = RAIL_INK; }
        else if (code === RAIL_DOWN) { glyph = "╲"; color = RAIL_INK; }
        else if (code === RAIL_UP) { glyph = "╱"; color = RAIL_INK; }
        else if (code <= PLATFORM - 100) { glyph = ":"; color = STATION_INK[PLATFORM - 100 - code]; }
        else if (code <= LANDMARK && code > LANDMARK - 10) {
          const index = LANDMARK - code;
          const edge = at(i - 1, j) !== code || at(i + 1, j) !== code || at(i, j - 1) !== code || at(i, j + 1) !== code;
          glyph = edge ? "#" : "@"; color = LANDMARK_INK[index][edge ? 1 : 0];
        } else if (markings) {
          const xc = ((i0 + i) + 0.5) * cellW;
          const nearNs = Math.abs(xc - Math.round(xc / BLOCK_SIZE) * BLOCK_SIZE) < cellW / 2;
          const nearEw = Math.abs(zc - Math.round(zc / BLOCK_SIZE) * BLOCK_SIZE) < cellH / 2;
          if (nearNs && nearEw) { glyph = "+"; color = ROAD_CROSS_INK; }
          else if (nearNs) { glyph = Math.abs(xc) < cellW ? "¦" : ":"; color = ROAD_INK; }
          else if (nearEw) { glyph = (i0 + i) % 2 === 0 ? "-" : " "; color = ROAD_INK; }
        }
        if (!glyph || glyph === " ") continue;
        atlas.draw(ctx, atlas.slot(glyph, color), Math.round(originX + (i0 + i) * cw), y);
      }
    }
    // The city limit as a thin rule.
    ctx.strokeStyle = "rgba(125, 178, 170, 0.35)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeRect(sx(-WORLD_EDGE), sy(-WORLD_EDGE), WORLD_EDGE * 2 * pxPerMetre, WORLD_EDGE * 2 * pxPerMetre);
    return this.canvas;
  }
}

// ── Overlays ───────────────────────────────────────────────────────────────────────────────────

export interface OverlayData {
  player: { x: number; z: number; yaw: number };
  metroTime: number;
  quests: QuestSnapshot;
  discovered: readonly string[];
  waypoints: readonly Waypoint[];
  activeId: string | null;
  selectedId: string | null;
  hoverId: string | null;
  friends: readonly MapFriend[];
  time: number;
}

function halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, width = 3): void {
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(3, 9, 12, 0.92)";
  ctx.lineWidth = width;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

const fade = (value: number, from: number, to: number): number => Math.max(0, Math.min(1, (value - from) / (to - from)));

export function waypointAt(view: MapView, waypoints: readonly Waypoint[], sx: number, sy: number): Waypoint | null {
  let best: Waypoint | null = null, bestDistance = 14;
  for (const waypoint of waypoints) {
    const [x, y] = toScreen(view, waypoint.x, waypoint.z);
    const distance = Math.hypot(x - sx, y - 7 - sy);
    if (distance < bestDistance) { best = waypoint; bestDistance = distance; }
  }
  return best;
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, active: boolean, selected: boolean, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  if (active) {
    const pulse = (time * 0.8) % 1;
    ctx.strokeStyle = color; ctx.globalAlpha = 0.6 * (1 - pulse); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 8 + pulse * 18, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Stem and ground tick.
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(0, 0); ctx.lineTo(0, -10); ctx.stroke();
  ctx.shadowColor = color; ctx.shadowBlur = active ? 12 : 6;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, -21); ctx.lineTo(6, -15); ctx.lineTo(0, -9); ctx.lineTo(-6, -15); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#061014";
  ctx.beginPath(); ctx.arc(0, -15, 1.8, 0, Math.PI * 2); ctx.fill();
  if (selected) {
    ctx.setLineDash([3, 3]); ctx.strokeStyle = "#eef2dc"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, -12, 15, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

function edgeChevron(ctx: CanvasRenderingContext2D, view: MapView, x: number, y: number, color: string, label: string): void {
  const cx = view.width / 2, cy = view.height / 2, margin = 22;
  const angle = Math.atan2(y - cy, x - cx);
  const reach = Math.min((cx - margin) / Math.max(1e-6, Math.abs(Math.cos(angle))), (cy - margin) / Math.max(1e-6, Math.abs(Math.sin(angle))));
  const ex = cx + Math.cos(angle) * reach, ey = cy + Math.sin(angle) * reach;
  ctx.save();
  ctx.translate(ex, ey);
  ctx.save(); ctx.rotate(angle);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-2, 0); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.font = `10px ${MONO}`; ctx.textAlign = Math.cos(angle) > 0.3 ? "right" : Math.cos(angle) < -0.3 ? "left" : "center";
  ctx.textBaseline = Math.sin(angle) > 0.3 ? "bottom" : Math.sin(angle) < -0.3 ? "top" : "middle";
  halo(ctx, label, -Math.cos(angle) * 14, -Math.sin(angle) * 14, color);
  ctx.restore();
}

export function drawOverlay(ctx: CanvasRenderingContext2D, view: MapView, data: OverlayData, terrain: TerrainLayer): void {
  const { scale, width, height } = view;
  const px = (x: number) => width / 2 + (x - view.cx) * scale;
  const pz = (z: number) => height / 2 + (z - view.cz) * scale;
  const inside = (sx: number, sy: number, pad = 0) => sx >= -pad && sy >= -pad && sx <= width + pad && sy <= height + pad;
  ctx.textBaseline = "middle";

  // Coordinate rulers along the top and left edges.
  const step = scale > 3 ? 64 : scale > 1 ? 128 : 256;
  ctx.font = `9px ${MONO}`; ctx.fillStyle = "rgba(145, 185, 178, 0.55)"; ctx.strokeStyle = "rgba(145, 185, 178, 0.3)"; ctx.lineWidth = 1;
  ctx.textAlign = "center";
  for (let x = Math.ceil((view.cx - width / 2 / scale) / step) * step; x <= view.cx + width / 2 / scale; x += step) {
    if (Math.abs(x) > WORLD_EDGE) continue;
    const sx = Math.round(px(x)) + 0.5;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, 5); ctx.stroke();
    ctx.fillText(`${Math.abs(x)}${x < 0 ? "W" : x > 0 ? "E" : ""}`, sx, 12);
  }
  ctx.textAlign = "left";
  for (let z = Math.ceil((view.cz - height / 2 / scale) / step) * step; z <= view.cz + height / 2 / scale; z += step) {
    if (Math.abs(z) > WORLD_EDGE) continue;
    const sy = Math.round(pz(z)) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(5, sy); ctx.stroke();
    ctx.fillText(`${Math.abs(z)}${z < 0 ? "N" : z > 0 ? "S" : ""}`, 8, sy);
  }

  // District borders and names: bold when zoomed out, gone once streets take over.
  const districtAlpha = 1 - fade(scale, 1.1, 2.2);
  if (districtAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = districtAlpha * 0.5; ctx.strokeStyle = "#8fb8b0"; ctx.setLineDash([2, 6]); ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of [-256, 256]) { ctx.moveTo(px(x), pz(-WORLD_EDGE)); ctx.lineTo(px(x), pz(WORLD_EDGE)); }
    ctx.moveTo(px(-WORLD_EDGE), pz(0)); ctx.lineTo(px(WORLD_EDGE), pz(0));
    ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = districtAlpha;
    ctx.textAlign = "center";
    const size = Math.round(Math.max(13, Math.min(22, scale * 30)));
    for (const district of DISTRICTS) {
      const x = px(district.x), y = pz(district.z) - 70 * scale;
      if (!inside(x, y, 200)) continue;
      ctx.font = `600 ${size}px ${MONO}`;
      ctx.letterSpacing = `${Math.round(size * 0.35)}px`;
      halo(ctx, district.name.toUpperCase(), x, y, district.hex, 5);
      ctx.letterSpacing = "0px";
      ctx.font = `10px ${MONO}`;
      halo(ctx, district.description, x, y + size * 0.95, "rgba(190, 210, 204, 0.8)");
    }
    ctx.restore();
  }

  // Street names along the streets once blocks are big enough to carry them.
  const streetAlpha = fade(scale, 1.5, 2.3);
  if (streetAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = streetAlpha;
    ctx.font = `10px ${MONO}`; ctx.textAlign = "center";
    const spacing = scale > 5 ? 128 : 256;
    const zs: number[] = [], xs: number[] = [];
    for (let z = Math.floor((view.cz - height / 2 / scale) / spacing) * spacing + 32; z < view.cz + height / 2 / scale; z += spacing) zs.push(z);
    for (let x = Math.floor((view.cx - width / 2 / scale) / spacing) * spacing + 32; x < view.cx + width / 2 / scale; x += spacing) xs.push(x);
    for (let k = -HALF_BLOCKS; k <= HALF_BLOCKS; k++) {
      const line = k * BLOCK_SIZE, sx = px(line), sy = pz(line);
      const avenue = k === 0;
      if (sx > -20 && sx < width + 20) for (const z of zs) {
        if (Math.abs(z) > WORLD_EDGE) continue;
        ctx.save(); ctx.translate(sx, pz(z)); ctx.rotate(-Math.PI / 2);
        halo(ctx, NS_STREETS[k + HALF_BLOCKS].toUpperCase(), 0, 0, avenue ? "#d9c9a0" : "#7fb0aa");
        ctx.restore();
      }
      if (sy > -20 && sy < height + 20) for (const x of xs) {
        if (Math.abs(x) > WORLD_EDGE) continue;
        halo(ctx, EW_STREETS[k + HALF_BLOCKS].toUpperCase(), px(x), sy, "#7fb0aa");
      }
    }
    ctx.restore();
  }

  // Shop signs on individual buildings when zoomed right in.
  if (scale > 4.2) {
    ctx.save();
    ctx.globalAlpha = fade(scale, 4.2, 5.5);
    ctx.font = `9px ${MONO}`; ctx.textAlign = "center";
    const [wx0, wz0] = toWorld(view, 0, 0), [wx1, wz1] = toWorld(view, width, height);
    for (let bz = Math.floor(wz0 / BLOCK_SIZE); bz <= Math.floor(wz1 / BLOCK_SIZE); bz++) for (let bx = Math.floor(wx0 / BLOCK_SIZE); bx <= Math.floor(wx1 / BLOCK_SIZE); bx++) {
      for (const building of terrain.blockBuildings(bx, bz)) {
        const w = building.width * scale;
        if (w < building.sign.length * 6 + 8) continue;
        const x = px(building.x), y = pz(building.z);
        if (!inside(x, y, 40)) continue;
        halo(ctx, building.sign, x, y, DISTRICTS[building.district].hex);
        ctx.font = `8px ${MONO}`;
        halo(ctx, `${Math.round(building.height)} m`, x, y + 11, "rgba(170, 196, 190, 0.8)");
        ctx.font = `9px ${MONO}`;
      }
    }
    ctx.restore();
  }

  // Elevated rail: trains moving along the loop.
  ctx.save();
  for (let id = 0; id < 4; id++) {
    const train = trainAt(data.metroTime, id);
    const front = localToWorld(train, 0, -21.7), rear = localToWorld(train, 0, 21.7);
    const fx = px(front.x), fy = pz(front.z), rx = px(rear.x), ry = pz(rear.z);
    if (!inside(fx, fy, 30) && !inside(rx, ry, 30)) continue;
    ctx.strokeStyle = "#e9fff6"; ctx.shadowColor = "#6fd6c4"; ctx.shadowBlur = 8; ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, Math.min(8, 3.4 * scale));
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(rx, ry); ctx.stroke();
  }
  ctx.restore();

  // Stations.
  ctx.save();
  ctx.textAlign = "center";
  for (const station of STATIONS) {
    const x = px(station.x), y = pz(station.z);
    if (!inside(x, y, 60)) continue;
    ctx.fillStyle = "#061014"; ctx.strokeStyle = station.hex; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(x - 5, y - 5, 10, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = station.hex; ctx.fillRect(x - 2, y - 2, 4, 4);
    if (scale > 0.55) {
      ctx.font = `10px ${MONO}`;
      halo(ctx, `${station.name} Stn`, x, y + (station.z < 0 ? -15 : 16), station.hex);
    }
  }
  ctx.restore();

  // Landmarks.
  ctx.save();
  ctx.textAlign = "center";
  for (const landmark of LANDMARKS) {
    const x = px(landmark.x), y = pz(landmark.z);
    if (!inside(x, y, 80)) continue;
    const found = data.discovered.includes(landmark.id);
    const color = `rgb(${landmark.color.join(",")})`;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = found ? "#eef2dc" : color; ctx.lineWidth = 1.5; ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.strokeRect(-6, -6, 12, 12);
    if (found) { ctx.fillStyle = color; ctx.fillRect(-3, -3, 6, 6); }
    ctx.restore();
    ctx.font = `${scale > 1.4 ? 12 : 11}px ${MONO}`;
    halo(ctx, `${landmark.name}${found ? "  ✓" : ""}`, x, y + 19, found ? "#eef2dc" : color);
  }
  ctx.restore();

  // Named NPCs, quest givers and the tracked quest target (shared with the minimap).
  drawQuestLayer(ctx, { px, pz, size: Math.max(width, height), extent: Math.max(width, height) / 2 / scale, centerX: view.cx, centerZ: view.cz, full: true }, data.quests);

  // Line from the player to the active waypoint.
  const active = data.activeId ? data.waypoints.find((waypoint) => waypoint.id === data.activeId) ?? null : null;
  const playerX = px(data.player.x), playerY = pz(data.player.z);
  if (active) {
    ctx.save();
    ctx.strokeStyle = active.color; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]); ctx.lineDashOffset = -data.time * 18;
    ctx.beginPath(); ctx.moveTo(playerX, playerY); ctx.lineTo(px(active.x), pz(active.z)); ctx.stroke();
    ctx.restore();
  }

  // Friends.
  ctx.save();
  ctx.textAlign = "center";
  for (const friend of data.friends) {
    const x = px(friend.x), y = pz(friend.z);
    if (!inside(x, y, 20)) continue;
    const color = friend.color ?? "#9d8cff";
    ctx.strokeStyle = color; ctx.fillStyle = "#061014"; ctx.lineWidth = 2; ctx.shadowColor = color; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (friend.yaw !== undefined) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(friend.yaw) * 10, y - Math.cos(friend.yaw) * 10); ctx.stroke(); }
    ctx.shadowBlur = 0;
    if (friend.name) { ctx.font = `10px ${MONO}`; halo(ctx, friend.name, x, y - 13, color); }
  }
  ctx.restore();

  // Waypoints.
  ctx.save();
  ctx.textAlign = "center";
  for (const waypoint of data.waypoints) {
    const x = px(waypoint.x), y = pz(waypoint.z);
    const isActive = waypoint.id === data.activeId;
    if (!inside(x, y, 30)) {
      if (isActive) edgeChevron(ctx, view, x, y, waypoint.color, `${waypoint.label} · ${formatMetres(Math.hypot(waypoint.x - data.player.x, waypoint.z - data.player.z))}`);
      continue;
    }
    drawPin(ctx, x, y, waypoint.color, isActive, waypoint.id === data.selectedId, data.time);
    if (isActive || waypoint.id === data.hoverId || waypoint.id === data.selectedId || scale > 1.2) {
      ctx.font = `${isActive ? "600 " : ""}11px ${MONO}`;
      halo(ctx, waypoint.label, x, y + 11, waypoint.color);
    }
  }
  ctx.restore();

  // The player: view cone and heading arrow.
  ctx.save();
  ctx.translate(playerX, playerY);
  ctx.rotate(data.player.yaw);
  const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
  cone.addColorStop(0, "rgba(184, 248, 229, 0.28)"); cone.addColorStop(1, "rgba(184, 248, 229, 0)");
  ctx.fillStyle = cone;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 70, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e6fff5"; ctx.shadowColor = "#85e7d3"; ctx.shadowBlur = 12;
  ctx.strokeStyle = "#061014"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 8); ctx.lineTo(0, 4); ctx.lineTo(-8, 8); ctx.closePath(); ctx.stroke(); ctx.fill();
  ctx.restore();
  if (!inside(playerX, playerY, 0)) edgeChevron(ctx, view, playerX, playerY, "#b8f8e5", "You");
}

