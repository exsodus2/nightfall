import { COMFORT_HZ, activeEvents, type CityEventKind } from "../city/city-events.ts";
import type { QuestLayerView } from "./quest-map-layer.ts";
import { monoWidth, type LabelSpace } from "./world-map-labels.ts";

/**
 * Live city events (city-events.ts) on the world map and the minimap: a calm breathing marker at
 * the running happening's site, its short name when zoomed in, and on the minimap a small edge
 * chevron while the happening is off the local map but within EVENT_CHEVRON_RANGE of the player.
 * The satellite re-entry is sky-wide (no ground anchor), so it is never mapped.
 *
 * Motion comfort: the marker breathes (a smooth swell of size and alpha) at EVENT_BREATH_HZ, well
 * under the events' COMFORT_HZ, and blooms in and fades out with the event's own level. Never a
 * blink, never a flash.
 */

/** Breathing rate of the event marker (Hz); tests keep it at or below COMFORT_HZ (0.4). */
export const EVENT_BREATH_HZ = 0.25;
/** The minimap points at a happening this close (m) when it is off the local map. */
export const EVENT_CHEVRON_RANGE = 300;
/** Event ink: a soft festival pink, apart from quest amber, venue teal and friend violet. */
export const EVENT_INK = "#ff8fcf";
/** The map glyph for a live happening (CP437 sun). */
export const EVENT_GLYPH = "☼";

/** Short names for map labels (the full titles are toast lines). */
export const EVENT_SHORT: Record<CityEventKind, string> = {
  drones: "Drone show",
  lanterns: "Lantern release",
  checkpoint: "CorpSec checkpoint",
  flare: "Ship's flares",
  substation: "Grid fault",
  protest: "Rent march",
  satellite: "Satellite re-entry",
};

export interface MapEvent {
  id: number;
  kind: CityEventKind;
  x: number;
  z: number;
  /** Short map label. */
  label: string;
  /** The full announcement line. */
  title: string;
  /** 0..1 bloom/fade envelope. */
  level: number;
  /** Seconds left. */
  remaining: number;
}

/** The happenings to map at scene time `time`: running, on the ground and not fully faded. */
export function mapEvents(time: number): MapEvent[] {
  const events: MapEvent[] = [];
  for (const event of activeEvents(time)) {
    if (event.kind === "satellite" || event.level <= 0.001) continue;
    events.push({ id: event.id, kind: event.kind, x: event.x, z: event.z, label: EVENT_SHORT[event.kind], title: event.title, level: event.level, remaining: event.end - time });
  }
  return events;
}

/** 0..1, a smooth breath at EVENT_BREATH_HZ (a raised cosine: no edges, no steps). */
export const eventBreath = (time: number): number => 0.5 - 0.5 * Math.cos(time * EVENT_BREATH_HZ * Math.PI * 2);
/** Exposed for the comfort test. */
export const EVENT_COMFORT_HZ = COMFORT_HZ;

export interface EventLayerOptions {
  /** Seconds, for the breath only (any steady clock). */
  time: number;
  /** Draw the short name under the marker. */
  labels: boolean;
  /** Minimap: point at a happening off the local map within EVENT_CHEVRON_RANGE of this position. */
  player?: { x: number; z: number } | null;
  /** Heading-up minimap: the visible area is the inscribed circle, so chevrons sit on it. */
  round?: boolean;
  /** World map: shared label space, so the name steps around other labels. */
  space?: LabelSpace;
}

/** Draw the live happenings. Returns how many markers / chevrons it drew (tests). */
export function drawEventLayer(ctx: CanvasRenderingContext2D, view: QuestLayerView, events: readonly MapEvent[], options: EventLayerOptions): number {
  if (!events.length) return 0;
  const { px, pz, size, extent, centerX, centerZ, full } = view;
  const breath = eventBreath(options.time), c = size / 2;
  let drawn = 0;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const event of events) {
    const inView = options.round ? Math.hypot(event.x - centerX, event.z - centerZ) <= extent * 0.94 : Math.abs(event.x - centerX) <= extent && Math.abs(event.z - centerZ) <= extent;
    if (!inView) {
      const player = options.player;
      if (full || !player || Math.hypot(event.x - player.x, event.z - player.z) > EVENT_CHEVRON_RANGE) continue;
      const angle = Math.atan2(pz(event.z) - c, px(event.x) - c);
      const reach = options.round ? c - 12 : (c - 12) / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
      ctx.save();
      ctx.translate(c + Math.cos(angle) * reach, c + Math.sin(angle) * reach);
      ctx.rotate(angle);
      ctx.globalAlpha = event.level * (0.7 + 0.3 * breath);
      ctx.fillStyle = EVENT_INK;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-1.5, 0); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
      drawn++;
      continue;
    }
    const x = px(event.x), y = pz(event.z), r = full ? 9 : 7;
    // The breathing ring: grows a few pixels and brightens a little, then settles. Never blinks.
    ctx.globalAlpha = event.level * (0.3 + 0.35 * breath);
    ctx.strokeStyle = EVENT_INK; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r + 3 * breath, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = event.level;
    ctx.fillStyle = "#061014";
    ctx.beginPath(); ctx.arc(x, y, r - 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${full ? 13 : 11}px "Cascadia Code", Consolas, monospace`;
    ctx.fillStyle = EVENT_INK;
    ctx.fillText(EVENT_GLYPH, x, y + 0.5);
    if (options.labels) {
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      const ly = options.space ? options.space.place(x, y, monoWidth(event.label, 10), 12, [-r - 9, r + 10], true) ?? y - r - 9 : y - r - 9;
      ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(3, 9, 12, 0.92)";
      ctx.strokeText(event.label, x, ly);
      ctx.fillText(event.label, x, ly);
    }
    drawn++;
  }
  ctx.restore();
  return drawn;
}
