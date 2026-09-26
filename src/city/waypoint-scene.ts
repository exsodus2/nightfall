import type { PropCanvas } from "./prop-canvas";
import { propAlpha, propRange, restorePropRange } from "./activity";
import { cityWaypoints, hexToRgb, type Waypoint } from "./waypoints";

/** What the beacons need from the frame: eye position and scene clock. (The engine's `view` fits.) */
export interface WaypointView { x: number; z: number; height: number; time: number }

type RGB = readonly [number, number, number];
const MAX_BEACONS = 12;

function ink(t: PropCanvas, color: RGB, glyph: string, gain: number): void {
  // Every channel stays emissive (the material glows bright albedo), however far the beacon is.
  t.char(glyph);
  t.charColor(Math.min(255, color[0] * gain), Math.min(255, color[1] * gain), Math.min(255, color[2] * gain));
  t.cellColor(color[0] * 0.16, color[1] * 0.16, color[2] * 0.16, propAlpha());
}

function box(t: PropCanvas, x: number, y: number, z: number, w: number, h: number, d: number): void {
  t.translate(x, -y, z); t.box(w, h, d); t.translate(-x, y, -z);
}

function ring(t: PropCanvas, x: number, y: number, z: number, radius: number, tube: number): void {
  t.push(); t.translate(x, -y, z); t.rotateX(90); t.torus(radius, tube); t.pop();
}

/** Brighten toward white so dim palette colours still read as light. */
function lightOf(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex);
  const peak = Math.max(r, g, b, 1), lift = 255 / peak;
  return [r * lift, g * lift, b * lift];
}

/**
 * Tall light beacons for waypoints, drawn with prop primitives (thin boxes and torus rings, bright
 * emissive colours, propRange(0) so they never dissolve). Past `viewDistance * 0.36` a beacon is
 * drawn at that distance along the true bearing and scaled down by the same factor: it keeps its
 * angular size and direction but stays inside the fog, so it can be seen from anywhere in the city.
 */
export function drawWaypoints(t: PropCanvas, view: WaypointView, waypoints: readonly Waypoint[], activeId: string | null = null, viewDistance = 700): void {
  if (!waypoints.length) return;
  const outer = propRange(0);
  const proxyLimit = Math.max(110, viewDistance * 0.36);
  const nearest = waypoints
    .map((waypoint) => ({ waypoint, distance: Math.hypot(waypoint.x - view.x, waypoint.z - view.z) }))
    .sort((a, b) => (a.waypoint.id === activeId ? -1 : b.waypoint.id === activeId ? 1 : a.distance - b.distance))
    .slice(0, MAX_BEACONS);
  for (const { waypoint, distance } of nearest) {
    const active = waypoint.id === activeId;
    const color = lightOf(waypoint.color);
    const proxy = Math.min(distance, proxyLimit);
    const k = distance > 0.01 ? proxy / distance : 1;
    const x = view.x + (waypoint.x - view.x) * k, z = view.z + (waypoint.z - view.z) * k;
    // Real-world size, shrunk with the proxy; widths never drop under about one character cell.
    const height = (active ? 320 : 170) * k;
    const cell = Math.max(0.35, proxy * 0.011);
    const core = Math.max((active ? 0.5 : 0.35) * k, cell * (active ? 1.1 : 0.8));
    const pulse = 0.92 + Math.sin(view.time * 3 + waypoint.createdAt % 7) * 0.08;
    // Standing inside the beacon: only the ground rings, so the column does not fill the view.
    if (distance < 4) { ink(t, color, "-", 0.95); ring(t, waypoint.x, 0.06, waypoint.z, active ? 3.4 : 2.4, 0.07); continue; }
    // Core light column; from further away a sheath makes it read against the skyline.
    ink(t, color, "|", 1.05 * pulse);
    box(t, x, height / 2, z, core, height, core);
    if (distance > 90) { ink(t, color, ":", 0.8); box(t, x, height * 0.3, z, core * 2.2, height * 0.6, core * 2.2); }
    // Rings rising up the column.
    const rings = active ? 4 : 2;
    for (let i = 0; i < rings; i++) {
      const phase = (view.time * 0.18 + i / rings) % 1;
      ink(t, color, "o", 1.1 - phase * 0.3);
      ring(t, x, phase * height * 0.85, z, Math.max(core * 3.2, (active ? 3.2 : 2.2) * k) * (1 - phase * 0.5), Math.max(0.08 * k, cell * 0.35));
    }
    // Cap light.
    ink(t, color, "#", 1.1);
    box(t, x, height, z, core * 2.2, core * 2.2, core * 2.2);
    if (distance > proxyLimit) continue;
    // Close by: a spinning diamond at head height and a ground ring marking the exact spot.
    const bob = Math.sin(view.time * 2.2) * 0.25;
    t.push();
    t.translate(x, -(4.2 + bob), z);
    t.rotateY(view.time * 70);
    t.rotateZ(45); t.rotateX(35.264);
    ink(t, color, "*", 1.15);
    t.box(1.1, 1.1, 1.1);
    t.pop();
    ink(t, color, "-", 0.95);
    ring(t, x, 0.06, z, active ? 3.4 : 2.4, 0.07);
    ring(t, x, 0.06, z, (active ? 3.4 : 2.4) * (0.35 + ((view.time * 0.6) % 1) * 0.65), 0.05);
  }
  restorePropRange(outer);
}

/** Engine hook: every waypoint in the session store (active one tallest). */
export function drawWaypointBeacons(t: PropCanvas, view: WaypointView, viewDistance?: number): void {
  drawWaypoints(t, view, cityWaypoints.list(), cityWaypoints.activeId, viewDistance);
}
