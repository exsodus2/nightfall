import type { FriendPosition } from "@/multiplayer/types";
import type { QuestLayerView } from "./quest-map-layer";

/** Multiplayer: other players on the minimap / atlas: a heading chevron in their colour, their name
 * on the atlas, and an edge pointer on the minimap when they are off the local map. */
export function drawFriendsLayer(ctx: CanvasRenderingContext2D, view: QuestLayerView, friends: readonly FriendPosition[] | undefined): void {
  if (!friends?.length) return;
  const { px, pz, size, extent, centerX, centerZ, full } = view;
  ctx.save();
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  for (const friend of friends) {
    const x = px(friend.x), z = pz(friend.z);
    const inside = Math.abs(friend.x - centerX) <= extent && Math.abs(friend.z - centerZ) <= extent;
    ctx.fillStyle = friend.color;
    ctx.shadowColor = friend.color;
    ctx.shadowBlur = 8;
    if (inside) {
      ctx.save(); ctx.translate(x, z); ctx.rotate(friend.yaw);
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (full) { ctx.shadowBlur = 0; ctx.fillText(friend.name, x, z - 11); }
    } else if (!full) {
      const angle = Math.atan2(z - size / 2, x - size / 2);
      const reach = (size / 2 - 7) / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
      ctx.beginPath(); ctx.arc(size / 2 + Math.cos(angle) * reach, size / 2 + Math.sin(angle) * reach, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
