import type { InteriorPlace } from "../city/interiors.ts";
import type { QuestLayerView } from "./quest-map-layer.ts";

export function drawVenueLayer(ctx: CanvasRenderingContext2D, view: QuestLayerView, places: readonly InteriorPlace[], labels = view.full, namedPins: readonly { x: number; z: number }[] = []): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = '10px "Cascadia Code", Consolas, monospace';
  ctx.lineWidth = 1.5;
  for (const place of places) {
    const entrance = place.entrance;
    if (Math.abs(entrance.x - view.centerX) > view.extent || Math.abs(entrance.z - view.centerZ) > view.extent) continue;
    const screenX = view.px(entrance.x), screenZ = view.pz(entrance.z), radius = view.full ? 5 : 4;
    ctx.fillStyle = "#061014";
    ctx.fillRect(screenX - radius, screenZ - radius, radius * 2, radius * 2);
    ctx.strokeStyle = "#4de8e0";
    ctx.beginPath();
    ctx.moveTo(screenX - 2, screenZ + radius); ctx.lineTo(screenX - radius, screenZ + radius); ctx.lineTo(screenX - radius, screenZ - radius);
    ctx.lineTo(screenX + radius, screenZ - radius); ctx.lineTo(screenX + radius, screenZ + radius); ctx.lineTo(screenX + 2, screenZ + radius);
    ctx.stroke();
    if (labels && !namedPins.some(pin => Math.hypot(pin.x - entrance.x, pin.z - entrance.z) < 0.15)) {
      ctx.strokeStyle = "#061014"; ctx.lineWidth = 3;
      ctx.strokeText(place.name, screenX, screenZ + radius + 5);
      ctx.fillStyle = "#baf5d7"; ctx.fillText(place.name, screenX, screenZ + radius + 5);
      ctx.lineWidth = 1.5;
    }
  }
  ctx.restore();
}
