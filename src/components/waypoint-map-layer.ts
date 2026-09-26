import type { Waypoint } from "@/city/waypoints";
import type { QuestLayerView } from "./quest-map-layer";

interface WaypointLayerOptions {
  waypoints: readonly Waypoint[];
  activeId: string | null;
  /** Heading-up minimap: the visible area is the inscribed circle, so chevrons sit on it. */
  round: boolean;
  /** Round mode draws the tracked quest target too (quest-map-layer's square-edge chevron would be masked). */
  tracked: { targetX: number; targetZ: number } | null;
}

const QUEST_AMBER = "#e6ad62";

function chevron(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, reach: number, color: string, scale = 1): void {
  ctx.save();
  ctx.translate(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -7); ctx.lineTo(-1.5, 0); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** Minimap / small-atlas waypoints: a diamond pin per waypoint, the active one ringed, and an edge
 * chevron (square or circle edge) pointing at the active waypoint when it is off the local map. */
export function drawWaypointLayer(ctx: CanvasRenderingContext2D, view: QuestLayerView, options: WaypointLayerOptions): void {
  const { px, pz, size, extent, centerX, centerZ, full } = view;
  const { waypoints, activeId, round, tracked } = options;
  const c = size / 2;
  const inView = (x: number, z: number) => round ? Math.hypot(x - centerX, z - centerZ) <= extent * 0.94 : Math.abs(x - centerX) <= extent && Math.abs(z - centerZ) <= extent;
  const edge = (x: number, z: number, color: string, scale = 1) => {
    const angle = Math.atan2(pz(z) - c, px(x) - c);
    const reach = round ? c - 13 : (c - 13) / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
    chevron(ctx, c, c, angle, reach, color, scale);
  };
  ctx.save();
  if (round) {
    // North marker on the rim; it orbits as the canvas turns with the player.
    ctx.font = "bold 22px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#061014"; ctx.beginPath(); ctx.arc(c, 20, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff6f8f"; ctx.fillText("N", c, 21);
  }
  if (tracked) {
    if (inView(tracked.targetX, tracked.targetZ)) {
      ctx.strokeStyle = QUEST_AMBER; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px(tracked.targetX), pz(tracked.targetZ), 8, 0, Math.PI * 2); ctx.stroke();
    } else edge(tracked.targetX, tracked.targetZ, QUEST_AMBER, 0.85);
  }
  for (const waypoint of waypoints) {
    const active = waypoint.id === activeId;
    if (!inView(waypoint.x, waypoint.z)) {
      if (active && !full) edge(waypoint.x, waypoint.z, waypoint.color, 1.15);
      continue;
    }
    const x = px(waypoint.x), y = pz(waypoint.z), r = full ? 5 : active ? 6 : 4.5;
    ctx.fillStyle = waypoint.color; ctx.shadowColor = waypoint.color; ctx.shadowBlur = active ? 10 : 5;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    if (active) {
      ctx.strokeStyle = waypoint.color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
