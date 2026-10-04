import { NPCS } from "../city/npcs.ts";
import { QUESTS, type QuestSnapshot } from "../city/quests.ts";

const AMBER = "#e6ad62";
const TEAL = "#baf5d7";

export interface QuestLayerView {
  px: (x: number) => number;
  pz: (z: number) => number;
  size: number;
  extent: number;
  centerX: number;
  centerZ: number;
  full: boolean;
}

type GiverState = "offer" | "turn-in" | null;

/** Best-effort marker state from the snapshot log (the engine's QuestBook is not exposed to React). */
function giverState(npcId: string, quests: QuestSnapshot): GiverState {
  let state: GiverState = null;
  for (const quest of QUESTS) {
    if (quest.giver !== npcId) continue;
    const entry = quests.log.find((item) => item.id === quest.id);
    if (entry?.status === "ready") return "turn-in";
    const unlocked = (quest.requires ?? []).every((id) => quests.log.some((item) => item.id === id && item.status === "complete"));
    if (!entry && unlocked) state = "offer";
  }
  return state;
}

function diamond(ctx: CanvasRenderingContext2D, x: number, z: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x, z - radius); ctx.lineTo(x + radius, z); ctx.lineTo(x, z + radius); ctx.lineTo(x - radius, z);
  ctx.closePath();
}

/** Named NPCs, quest givers with open business, and the tracked contract target for the atlas/minimap. */
export function drawQuestLayer(ctx: CanvasRenderingContext2D, view: QuestLayerView, quests: QuestSnapshot): void {
  const { px, pz, size, extent, centerX, centerZ, full } = view;
  const inView = (x: number, z: number) => Math.abs(x - centerX) <= extent && Math.abs(z - centerZ) <= extent;
  const tracked = quests.tracked;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const markers = quests.markers ?? NPCS.map(npc => ({ ...npc, state: giverState(npc.id, quests) }));
  const labels: { left: number; right: number; top: number; bottom: number }[] = [];
  for (const npc of markers) {
    if (!inView(npc.x, npc.z)) continue;
    const state = npc.state;
    const x = px(npc.x), z = pz(npc.z);
    if (state) {
      ctx.fillStyle = state === "turn-in" ? TEAL : AMBER;
      diamond(ctx, x, z, full ? 5 : 4);
      if (state === "objective") { ctx.strokeStyle = AMBER; ctx.lineWidth = 1.5; ctx.stroke(); }
      else ctx.fill();
    } else {
      ctx.fillStyle = "#c9d6cf";
      ctx.beginPath(); ctx.arc(x, z, full ? 2.5 : 2, 0, Math.PI * 2); ctx.fill();
    }
    if (full && state) {
      const halfWidth = npc.name.length * 3.5 + 2;
      let labelY: number | null = null;
      for (let row = 0; row < 5; row++) {
        const bottom = z - 10 - row * 14;
        const bounds = { left: x - halfWidth, right: x + halfWidth, top: bottom - 12, bottom };
        if (labels.some(label => bounds.left < label.right && bounds.right > label.left && bounds.top < label.bottom && bounds.bottom > label.top)) continue;
        if (markers.some(marker => Math.abs(px(marker.x) - x) < halfWidth + 6 && pz(marker.z) + 6 > bounds.top && pz(marker.z) - 6 < bounds.bottom)) continue;
        labels.push(bounds); labelY = bottom; break;
      }
      if (labelY === null) continue;
      ctx.font = "11px monospace";
      ctx.fillStyle = state === "turn-in" ? TEAL : AMBER;
      if (labelY < z - 10) {
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.75;
        ctx.beginPath(); ctx.moveTo(x, z - 7); ctx.lineTo(x, labelY + 3); ctx.stroke();
      }
      ctx.fillText(npc.name, x, labelY);
    }
  }
  if (tracked) {
    const x = px(tracked.targetX), z = pz(tracked.targetZ);
    if (inView(tracked.targetX, tracked.targetZ)) {
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, z, full ? 10 : 8, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(x, z, full ? 15 : 12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (!full) {
      // Off the local map: a chevron on the edge pointing toward the target.
      const angle = Math.atan2(z - size / 2, x - size / 2);
      const reach = (size / 2 - 12) / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
      ctx.translate(size / 2 + Math.cos(angle) * reach, size / 2 + Math.sin(angle) * reach);
      ctx.rotate(angle);
      ctx.fillStyle = AMBER;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -6); ctx.lineTo(-2, 0); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}
