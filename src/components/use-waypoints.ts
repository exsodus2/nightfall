"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { cityWaypoints, stripWaypointParams, waypointsFromSearch, type WaypointState } from "@/city/waypoints";

const STORAGE_KEY = "nightfall.waypoints.v1";

/** The session's waypoints (re-renders only when they change). */
export function useWaypointState(): WaypointState {
  return useSyncExternalStore(cityWaypoints.subscribe, cityWaypoints.getState, cityWaypoints.getState);
}

/**
 * Once per page: restores this viewer's waypoints from localStorage and keeps storage up to date;
 * once the city is `ready`, adds any `?wp=x,z,label` link waypoints (then tidies the address bar).
 */
export function useWaypointSession(ready: boolean, onLinkWaypoint: (label: string) => void): void {
  const notify = useRef(onLinkWaypoint);
  const consumed = useRef(false);
  useEffect(() => { notify.current = onLinkWaypoint; }, [onLinkWaypoint]);

  useEffect(() => {
    try { cityWaypoints.restore(localStorage.getItem(STORAGE_KEY)); } catch { /* storage unavailable */ }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => { try { localStorage.setItem(STORAGE_KEY, cityWaypoints.serialize()); } catch { /* storage unavailable */ } };
    const unsubscribe = cityWaypoints.subscribe(() => { if (timer) clearTimeout(timer); timer = setTimeout(save, 250); });
    return () => { unsubscribe(); if (timer) { clearTimeout(timer); save(); } };
  }, []);

  useEffect(() => {
    if (!ready || consumed.current) return;
    consumed.current = true;
    const seeds = waypointsFromSearch(location.search);
    seeds.forEach((seed, index) => {
      // Re-opening the same link re-targets the existing waypoint instead of duplicating it.
      const existing = cityWaypoints.list().find((waypoint) => Math.round(waypoint.x) === Math.round(seed.x) && Math.round(waypoint.z) === Math.round(seed.z) && waypoint.label === seed.label);
      if (existing) { if (index === 0) cityWaypoints.setActive(existing.id); }
      else cityWaypoints.add(seed, index === 0);
      notify.current(seed.label);
    });
    if (seeds.length) {
      try { window.history.replaceState(null, "", stripWaypointParams(location.href)); } catch { /* ignore */ }
    }
  }, [ready]);
}
