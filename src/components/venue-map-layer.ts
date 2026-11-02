import type { InteriorKind, InteriorPlace } from "../city/interiors.ts";
import type { QuestLayerView } from "./quest-map-layer.ts";
import { monoWidth, type LabelSpace } from "./world-map-labels.ts";

/** Doorway ink: venues are teal; a kind with its own ink (the nightclub) stands out from the rest. */
export const VENUE_INK = "#4de8e0";
export const CLUB_INK = "#ff6ad5";
const KIND_INK: Partial<Record<InteriorKind, string>> = { nightclub: CLUB_INK };
export const venueInk = (kind: InteriorKind): string => KIND_INK[kind] ?? VENUE_INK;
/** Directory glyph per venue kind (world-map.tsx): a house, or a note for the club. */
export const venueGlyph = (kind: InteriorKind): string => kind === "nightclub" ? "♫" : "⌂";

/** A small beamed note drawn inside the doorway frame (paths, so it scales with the marker). */
function note(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  const k = radius / 5;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x - 1.6 * k, y + 1.8 * k, 1.3 * k, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 1.8 * k, y + 1.2 * k, 1.3 * k, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = Math.max(0.8, k);
  ctx.beginPath(); ctx.moveTo(x - 0.4 * k, y + 1.8 * k); ctx.lineTo(x - 0.4 * k, y - 2.6 * k); ctx.lineTo(x + 3 * k, y - 3.2 * k); ctx.lineTo(x + 3 * k, y + 1.2 * k); ctx.stroke();
}

export function drawVenueLayer(ctx: CanvasRenderingContext2D, view: QuestLayerView, places: readonly InteriorPlace[], labels = view.full, namedPins: readonly { x: number; z: number }[] = [], space?: LabelSpace): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = '10px "Cascadia Code", Consolas, monospace';
  ctx.lineWidth = 1.5;
  for (const place of places) {
    const entrance = place.entrance;
    if (Math.abs(entrance.x - view.centerX) > view.extent || Math.abs(entrance.z - view.centerZ) > view.extent) continue;
    const screenX = view.px(entrance.x), screenZ = view.pz(entrance.z), radius = view.full ? 5 : 4;
    const ink = venueInk(place.kind);
    ctx.fillStyle = "#061014";
    ctx.fillRect(screenX - radius, screenZ - radius, radius * 2, radius * 2);
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.moveTo(screenX - 2, screenZ + radius); ctx.lineTo(screenX - radius, screenZ + radius); ctx.lineTo(screenX - radius, screenZ - radius);
    ctx.lineTo(screenX + radius, screenZ - radius); ctx.lineTo(screenX + radius, screenZ + radius); ctx.lineTo(screenX + 2, screenZ + radius);
    ctx.stroke();
    if (place.kind === "nightclub") { note(ctx, screenX, screenZ, radius, ink); ctx.lineWidth = 1.5; }
    if (labels && !namedPins.some(pin => Math.hypot(pin.x - entrance.x, pin.z - entrance.z) < 0.15)) {
      // World map: step below / further below / above to clear labels already placed (always drawn).
      const top = space ? (space.place(screenX, screenZ + radius + 11, monoWidth(place.name, 10), 12, [0, 12, -2 * radius - 22], true) ?? screenZ + radius + 11) - 6 : screenZ + radius + 5;
      ctx.strokeStyle = "#061014"; ctx.lineWidth = 3;
      ctx.strokeText(place.name, screenX, top);
      ctx.fillStyle = place.kind === "nightclub" ? "#ffc4ec" : "#baf5d7"; ctx.fillText(place.name, screenX, top);
      ctx.lineWidth = 1.5;
    }
  }
  ctx.restore();
}
