"use client";

import type { QuestSnapshot } from "@/city/quests";

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const RELATIVE = ["ahead", "ahead right", "right", "behind right", "behind", "behind left", "left", "ahead left"] as const;

/** Wrap an angle in radians to (-π, π]. */
function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function octant(angle: number): number {
  return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)}`;
  return (metres / 1000).toFixed(metres < 10000 ? 1 : 0);
}

/**
 * Bearing from the player to a world point. World north is −z; the engine's
 * forward vector is (sin yaw, −cos yaw), so yaw 0 faces north and grows clockwise.
 */
export function bearingTo(fromX: number, fromZ: number, yaw: number, toX: number, toZ: number) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const absolute = Math.atan2(dx, -dz);
  return { distance: Math.hypot(dx, dz), absolute, relative: wrap(absolute - yaw) };
}

export function formatCredits(credits: number): string {
  return Math.round(credits).toLocaleString("en-US");
}

interface QuestTrackerProps {
  quests: QuestSnapshot;
  x: number;
  z: number;
  yaw: number;
  /** Tapping/clicking the HUD opens the quest log (the only route on narrow phones). */
  onOpenLog: () => void;
}

/** Credits, tracked-contract objective and a live bearing to its target. Pure view of the throttled snapshot.
 * (The engine's own interaction prompt already says "Talk to …" near an NPC.) */
export function QuestTracker({ quests, x, z, yaw, onOpenLog }: QuestTrackerProps) {
  const { tracked } = quests;
  const bearing = tracked ? bearingTo(x, z, yaw, tracked.targetX, tracked.targetZ) : null;
  const arrived = !!bearing && bearing.distance < 12;
  const readyCount = quests.log.filter((entry) => entry.status === "ready").length;
  return <button type="button" className="quest-hud" onClick={onOpenLog}>
    <span className="sr-only">Open quest log. </span>
    <span className="quest-credits">
      <span className="quest-credits-label">Credits</span>
      <strong key={quests.credits}>{formatCredits(quests.credits)}</strong>
      <small>CR</small>
      {readyCount ? <span className="quest-ready-count">{readyCount} ready</span> : null}
      <kbd className="quest-log-key" aria-hidden="true">J</kbd>
    </span>
    {tracked && bearing ? <span className="quest-tracker" data-arrived={arrived}>
      <span className="quest-bearing" role="img" aria-label={arrived ? "Target reached." : `${formatDistance(bearing.distance)} ${bearing.distance < 1000 ? "metres" : "kilometres"} ${RELATIVE[octant(bearing.relative)]}.`}>
        <span className="quest-bearing-ring" aria-hidden="true" />
        <span className="quest-bearing-arrow" aria-hidden="true" style={{ transform: `rotate(${(bearing.relative * 180) / Math.PI}deg)` }}>{arrived ? "◆" : "▲"}</span>
      </span>
      <span className="quest-tracker-copy">
        <small>Tracked contract</small>
        <strong>{tracked.title}</strong>
        <span className="quest-objective">{tracked.objective}</span>
      </span>
      <span className="quest-distance" aria-hidden="true">
        {arrived ? "here" : formatDistance(bearing.distance)}
        <small>{arrived ? "" : `${bearing.distance < 1000 ? "m" : "km"} · ${CARDINALS[octant(bearing.absolute)]}`}</small>
      </span>
    </span> : null}
  </button>;
}
