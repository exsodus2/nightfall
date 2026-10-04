"use client";

import { useEffect, useRef } from "react";
import type { CitySnapshot } from "@/city/engine";
import { CityWorld, DISTRICTS, LANDMARKS, WORLD_EDGE } from "@/city/world";
import { STATIONS, TRACK_LENGTH, trackPose } from "@/city/metro";
import { interiorPlaces } from "@/city/interiors";
import { drawVenueLayer } from "./venue-map-layer";
import { drawQuestLayer } from "./quest-map-layer"; // Quest UI
import { drawFriendsLayer } from "./friends-map-layer"; // Multiplayer
import { drawWaypointLayer } from "./waypoint-map-layer"; // World map: waypoints + rotating minimap
import type { Waypoint } from "@/city/waypoints";

interface MapProps {
  world: CityWorld | null;
  snapshot: CitySnapshot;
  full?: boolean;
  /** World map: waypoints to draw; the active one gets an edge chevron when off the local map. */
  waypoints?: readonly Waypoint[];
  activeWaypointId?: string | null;
  /** World map: heading-up minimap (the canvas turns with the player; north marker orbits). */
  rotate?: boolean;
}

export function CityMap({ world, snapshot, full = false, waypoints, activeWaypointId = null, rotate = false }: MapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const turned = useRef(0); // World map: unwrapped rotation so CSS never spins the long way round
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !world) return;
    const size = full ? 600 : 320;
    canvas.width = size;
    canvas.height = size;
    const extent = full ? WORLD_EDGE + 40 : 124;
    const scale = size / (extent * 2);
    const centerX = full ? 0 : snapshot.x;
    const centerZ = full ? 0 : snapshot.z;
    const px = (x: number) => size / 2 + (x - centerX) * scale;
    const pz = (z: number) => size / 2 + (z - centerZ) * scale;
    ctx.fillStyle = "#0a181e";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#153039";
    ctx.lineWidth = full ? 1 : 0.75;
    for (let i = -12; i <= 12; i++) {
      ctx.beginPath();
      ctx.moveTo(px(i * 64), pz(-WORLD_EDGE));
      ctx.lineTo(px(i * 64), pz(WORLD_EDGE));
      ctx.moveTo(px(-WORLD_EDGE), pz(i * 64));
      ctx.lineTo(px(WORLD_EDGE), pz(i * 64));
      ctx.stroke();
    }
    for (const building of world.buildings) {
      if (Math.abs(building.x - centerX) > extent + 22 || Math.abs(building.z - centerZ) > extent + 22) continue;
      ctx.fillStyle = full ? `${DISTRICTS[building.district].hex}48` : "#26515a";
      ctx.fillRect(px(building.x - building.width / 2), pz(building.z - building.depth / 2), Math.max(1, building.width * scale), Math.max(1, building.depth * scale));
    }
    for (const landmark of LANDMARKS) {
      if (Math.abs(landmark.x - centerX) > extent || Math.abs(landmark.z - centerZ) > extent) continue;
      const visited = snapshot.discovered.includes(landmark.id);
      ctx.strokeStyle = visited ? "#eef2dc" : `rgb(${landmark.color.join(",")})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(px(landmark.x) - 5, pz(landmark.z) - 5, 10, 10);
      if (full) {
        ctx.fillStyle = "#bacdce";
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.fillText(landmark.name, px(landmark.x), pz(landmark.z) + 22);
      }
    }
    ctx.strokeStyle = "#71d3c17a";
    ctx.lineWidth = full ? 2 : 1;
    ctx.beginPath();
    for (let distance = 0; distance < TRACK_LENGTH; distance += 16) { const point = trackPose(distance); if (distance === 0) ctx.moveTo(px(point.x), pz(point.z)); else ctx.lineTo(px(point.x), pz(point.z)); }
    ctx.closePath(); ctx.stroke();
    for (const station of STATIONS) {
      ctx.fillStyle = station.hex;
      ctx.beginPath(); ctx.arc(px(station.x), pz(station.z), full ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
    }
    const spin = rotate && !full; // World map: heading-up minimap draws its own circle-edge chevrons
    drawVenueLayer(ctx, { px, pz, size, extent, centerX, centerZ, full }, interiorPlaces(world));
    drawQuestLayer(ctx, { px, pz, size, extent, centerX, centerZ, full }, spin ? { ...snapshot.quests, tracked: null } : snapshot.quests); // Quest UI: NPCs + tracked target
    drawFriendsLayer(ctx, { px, pz, size, extent, centerX, centerZ, full }, snapshot.friends); // Multiplayer: friends' positions
    drawWaypointLayer(ctx, { px, pz, size, extent, centerX, centerZ, full }, { waypoints: waypoints ?? [], activeId: activeWaypointId, round: spin, tracked: spin ? snapshot.quests.tracked : null }); // World map
    if (!full) {
      // World map: heading-up turns the canvas (CSS, eased between ~6 Hz snapshots) opposite the yaw.
      const target = spin ? -snapshot.yaw : 0;
      turned.current += Math.atan2(Math.sin(target - turned.current), Math.cos(target - turned.current));
      canvas.style.transform = spin ? `rotate(${turned.current}rad)` : "";
      canvas.style.borderRadius = spin ? "50%" : "";
      canvas.style.transition = spin ? "transform .18s linear" : "";
    }
    const x = px(snapshot.x);
    const z = pz(snapshot.z);
    ctx.save();
    ctx.translate(x, z);
    ctx.rotate(snapshot.yaw);
    ctx.fillStyle = "#b8f8e5";
    ctx.shadowColor = "#85e7d3";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }, [world, snapshot, full, waypoints, activeWaypointId, rotate]);

  return <canvas ref={canvasRef} className={full ? "atlas-canvas" : "minimap-canvas"} role="img" aria-label={full ? "City atlas showing six districts, venue entrances, quest markers, landmarks, and your position" : rotate ? "Nearby streets, venue entrances and your position; your heading is up" : "Nearby streets, venue entrances and your position; north is up"} />;
}
