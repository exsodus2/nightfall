"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { CitySnapshot } from "@/city/engine";
import { formatMetres, waypointBearing, type Waypoint } from "@/city/waypoints";
import { useWaypointState } from "./use-waypoints";
import styles from "./world-map.module.css";

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const FIELD = Math.PI * 0.55; // half-width of the tape

interface Target { x: number; z: number; color: string }

/** Heading tape: cardinal ticks glide with the camera (interpolated between ~6 Hz snapshots);
 * the active waypoint (and tracked quest target) sit at their bearings, pinned to the edge when behind. */
function CompassTape({ snapshot, waypoint }: { snapshot: CitySnapshot; waypoint: Waypoint }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef<{ snapshot: CitySnapshot; targets: Target[] }>({ snapshot, targets: [] });
  useEffect(() => {
    const quest = snapshot.quests.tracked;
    latest.current = { snapshot, targets: [...(quest ? [{ x: quest.targetX, z: quest.targetZ, color: "#e6ad62" }] : []), { x: waypoint.x, z: waypoint.z, color: waypoint.color }] };
  }, [snapshot, waypoint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let yaw = latest.current.snapshot.yaw, x = latest.current.snapshot.x, z = latest.current.snapshot.z;
    let last = performance.now(), frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const { snapshot: snap, targets } = latest.current;
      const k = 1 - Math.exp(-dt * 12);
      yaw += wrapAngle(snap.yaw - yaw) * k; x += (snap.x - x) * k; z += (snap.z - z) * k;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const toX = (relative: number) => width / 2 + (relative / FIELD) * (width / 2 - 10);
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "rgba(5,13,17,0)"); gradient.addColorStop(0.15, "rgba(5,13,17,0.72)"); gradient.addColorStop(0.85, "rgba(5,13,17,0.72)"); gradient.addColorStop(1, "rgba(5,13,17,0)");
      ctx.fillStyle = gradient; ctx.fillRect(0, 4, width, height - 8);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let degrees = 0; degrees < 360; degrees += 15) {
        const relative = wrapAngle(degrees * Math.PI / 180 - yaw);
        if (Math.abs(relative) > FIELD) continue;
        const sx = toX(relative), fadeOut = 1 - Math.pow(Math.abs(relative) / FIELD, 3);
        const major = degrees % 45 === 0;
        ctx.globalAlpha = fadeOut;
        if (major) {
          ctx.font = `${degrees % 90 === 0 ? "600 " : ""}11px "Cascadia Code", Consolas, monospace`;
          ctx.fillStyle = degrees === 0 ? "#ff6f8f" : "#d6e2da";
          ctx.fillText(CARDINALS[degrees / 45], sx, height / 2 + 1);
        } else {
          ctx.strokeStyle = "#7fa9a1"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(Math.round(sx) + 0.5, height / 2 - 3); ctx.lineTo(Math.round(sx) + 0.5, height / 2 + 4); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      // Centre notch.
      ctx.fillStyle = "#baf5d7";
      ctx.beginPath(); ctx.moveTo(width / 2 - 4, 1); ctx.lineTo(width / 2 + 4, 1); ctx.lineTo(width / 2, 6); ctx.closePath(); ctx.fill();
      for (const target of targets) {
        const relative = wrapAngle(Math.atan2(target.x - x, -(target.z - z)) - yaw);
        const clamped = Math.max(-FIELD, Math.min(FIELD, relative));
        const sx = toX(clamped), sy = height - 5;
        ctx.fillStyle = target.color; ctx.shadowColor = target.color; ctx.shadowBlur = 8;
        ctx.beginPath();
        if (Math.abs(relative) > FIELD) {
          const dir = Math.sign(relative);
          ctx.moveTo(sx + dir * 6, sy - 3); ctx.lineTo(sx - dir * 3, sy - 8); ctx.lineTo(sx - dir * 3, sy + 2);
        } else { ctx.moveTo(sx, sy - 9); ctx.lineTo(sx + 5, sy - 4); ctx.lineTo(sx, sy + 1); ctx.lineTo(sx - 5, sy - 4); }
        ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} className={styles.tape} aria-hidden="true" />;
}

/** Compass + bearing + distance to the active waypoint. Renders nothing without one. */
export function WaypointHud({ snapshot }: { snapshot: CitySnapshot }) {
  const { waypoints, activeId } = useWaypointState();
  const waypoint = activeId ? waypoints.find((item) => item.id === activeId) ?? null : null;
  if (!waypoint) return null;
  const bearing = waypointBearing(snapshot.x, snapshot.z, snapshot.yaw, waypoint.x, waypoint.z);
  const arrived = bearing.distance < 10;
  const turn = Math.abs(bearing.relative) < 0.2 ? "ahead" : `${bearing.relative > 0 ? "right" : "left"} ${Math.round(Math.abs(bearing.relative) * 180 / Math.PI)}°`;
  return <div className={styles.hud} role="status" aria-label={`Waypoint ${waypoint.label}, ${formatMetres(bearing.distance)}, ${arrived ? "arrived" : turn}`} data-waypoint-hud={waypoint.id}>
    <CompassTape snapshot={snapshot} waypoint={waypoint} />
    <div className={styles.hudLine} style={{ "--wp": waypoint.color } as CSSProperties} data-arrived={arrived}>
      <b aria-hidden="true">◆</b><span>{waypoint.label}</span><small>{arrived ? "arrived" : `${formatMetres(bearing.distance)} · ${turn}`}</small>
    </div>
  </div>;
}
