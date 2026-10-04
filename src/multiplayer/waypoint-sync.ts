// Colyseus-backed WaypointSync (src/city/waypoints.ts): shared waypoints live in the room state,
// validated by the server (bounds, label length, per-player limit, owner-only removal). The owner
// of every waypoint is the placing player's session id, so pair this with
// `store.setOwner(session.getView().selfId)` (use-multiplayer.ts does both).
import type { Waypoint, WaypointSync } from "../city/waypoints";
import type { MultiplayerSession, SharedWaypoint } from "./session";

const toWaypoint = (w: SharedWaypoint): Waypoint => ({ id: w.id, x: w.x, z: w.z, label: w.label, color: w.color, owner: w.owner, shared: true, createdAt: w.createdAt });

export function createRoomWaypointSync(session: MultiplayerSession): WaypointSync {
  const { serverUrl, code, selfId } = session.getView();
  const current = () => {
    const view = session.getView();
    return !!selfId && view.status === "connected" && view.serverUrl === serverUrl && view.code === code && view.selfId === selfId;
  };
  return {
    publish(waypoint) { if (current() && waypoint.shared && waypoint.owner === selfId) session.addWaypoint({ id: waypoint.id, x: waypoint.x, z: waypoint.z, label: waypoint.label, color: waypoint.color, shared: true }); },
    remove(id) { if (current()) session.removeWaypoint(id); },
    subscribe(onChange) {
      onChange(current() ? session.sharedWaypoints().map(toWaypoint) : []);
      return session.onWaypoints(all => onChange(current() ? all.map(toWaypoint) : []));
    },
  };
}
