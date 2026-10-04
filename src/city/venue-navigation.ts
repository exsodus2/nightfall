import type { InteriorPlace } from "./interiors.ts";
import type { Waypoint, WaypointStore } from "./waypoints.ts";

export function waypointAtEntrance(waypoint: Waypoint | null, place: InteriorPlace): boolean {
  return !!waypoint && Math.hypot(waypoint.x - place.entrance.x, waypoint.z - place.entrance.z) < 0.15;
}

export function trackVenueEntrance(store: WaypointStore, place: InteriorPlace): Waypoint | null {
  const existing = store.list().find(waypoint => store.isMine(waypoint.id) && waypointAtEntrance(waypoint, place));
  if (existing) { store.setActive(existing.id); return existing; }
  return store.add({ x: place.entrance.x, z: place.entrance.z, label: `${place.name} entrance`, color: "#4de8e0" });
}
