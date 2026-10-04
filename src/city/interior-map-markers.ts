import type { InteractableDefinition } from "../rpg/types.ts";
import { interiorLocal, type InteriorPlace } from "./interiors.ts";

export interface InteriorUseMarker {
  readonly id: string;
  readonly label: string;
  readonly glyph: string;
  readonly x: number;
  readonly z: number;
}

export const INTERIOR_USE_MARKER_RADIUS = 0.85;
const MAX_MARKERS = 3;
type Station = Pick<InteractableDefinition, "id" | "label" | "place" | "glyph" | "x" | "z">;

export function interiorUseMarkers(place: InteriorPlace | null, stations: readonly Station[]): readonly InteriorUseMarker[] {
  if (!place || ![place.x, place.z, place.yaw, place.width, place.depth].every(Number.isFinite)) return [];
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  if (Math.min(halfWidth, halfDepth) <= INTERIOR_USE_MARKER_RADIUS) return [];
  const markers: InteriorUseMarker[] = [], seen = new Set<string>();
  for (const station of stations) {
    if (station.place !== place.id || !station.id || !station.label.trim() || seen.has(station.id)) continue;
    const local = interiorLocal(place, station.x, station.z);
    if (!Number.isFinite(local.x) || !Number.isFinite(local.z) || Math.abs(local.x) > halfWidth + 0.000001 || Math.abs(local.z) > halfDepth + 0.000001) continue;
    const glyph = station.glyph && /^[!-~]$/.test(station.glyph) ? station.glyph : ">";
    markers.push({
      id: station.id, label: station.label, glyph,
      x: Math.max(-halfWidth + INTERIOR_USE_MARKER_RADIUS, Math.min(halfWidth - INTERIOR_USE_MARKER_RADIUS, local.x)),
      z: Math.max(-halfDepth + INTERIOR_USE_MARKER_RADIUS, Math.min(halfDepth - INTERIOR_USE_MARKER_RADIUS, local.z)),
    });
    seen.add(station.id);
    if (markers.length === MAX_MARKERS) break;
  }
  return markers;
}

export function interiorUseLabel(place: InteriorPlace, marker: InteriorUseMarker): string {
  const horizontal = marker.x < -place.width / 6 ? "left" : marker.x > place.width / 6 ? "right" : "center";
  const vertical = marker.z < -place.depth / 6 ? "back" : marker.z > place.depth / 6 ? "front" : "middle";
  const region = vertical === "middle" && horizontal === "center" ? "center" : `${vertical} ${horizontal}`;
  return `${marker.label} (${region})`;
}

export function interiorMapDescription(place: InteriorPlace, markers: readonly InteriorUseMarker[]): string {
  const stations = markers.length ? `Usable stations: ${markers.map(marker => interiorUseLabel(place, marker)).join("; ")}. Amber squares mark the stations. Approach one to interact.` : "No usable stations in this room.";
  return `${place.name} floor plan. The exit is at the bottom. ${stations}`;
}
