"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CitySnapshot } from "@/city/engine";
import { DISTRICTS, WORLD_EDGE, districtAt, type CityWorld } from "@/city/world";
import { placeName, streetNameAt } from "@/city/streets";
import { WAYPOINT_COLORS, cityWaypoints, formatMetres, waypointBearing, waypointLink, type Waypoint } from "@/city/waypoints";
import { GROUND_FLOOR_KINDS, interiorPlaces, type GroundFloorKind, type InteriorPlace } from "@/city/interiors";
import { trackVenueEntrance, waypointAtEntrance } from "@/city/venue-navigation";
import { MAX_SCALE, SIGHT_MARK, TerrainLayer, drawOverlay, minScale, toWorld, waypointAt, type MapFriend, type MapView } from "./world-map-render";
import { useWaypointState } from "./use-waypoints";
import { LINES } from "@/city/metro";
import { HARBOUR_REACH, harbourZone } from "@/city/harbour";
import { EVENT_GLYPH, EVENT_INK, mapEvents, type MapEvent } from "./event-map-layer";
import { HARBOUR_ZONE_NAME, SWELL_INK, WALL_INK, sightAt } from "./harbour-map-layer";
import { CLUB_INK, VENUE_INK, venueGlyph, venueInk } from "./venue-map-layer";
import { GROUND_GLYPH, GROUND_ICON_SCALE, GROUND_INK, GROUND_LABEL, groundFloorAt, groundLabel, groundVisitCount, noteGroundVisit, groundFilterMemory } from "./ground-floor-map-layer";
import styles from "./world-map.module.css";

interface WorldMapProps {
  world: CityWorld;
  snapshot: CitySnapshot;
  /** The city keeps running behind the map (opened while playing). */
  live: boolean;
  onClose: () => void;
}

interface Hover { x: number; z: number; district: string; street: string; building: string | null }

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const cardinal = (angle: number): string => CARDINALS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const coordinate = (value: number, positive: string, negative: string): string => `${Math.abs(Math.round(value)).toString().padStart(4, "0")}${value < 0 ? negative : positive}`;

/** Multiplayer: friends' positions from the snapshot (empty when playing solo). */
function friendsOf(snapshot: CitySnapshot): MapFriend[] {
  return (snapshot.friends ?? []).map((friend) => ({ id: friend.id, name: friend.name, x: friend.x, z: friend.z, yaw: friend.yaw, color: friend.color }));
}
const ownerName = (snapshot: CitySnapshot, owner: string): string => snapshot.friends?.find((friend) => friend.id === owner)?.name ?? "a friend";

// The map remembers its zoom, whether it follows you and the legend between openings (per page session).
const memory = { scale: 1.3, follow: true, cx: 0, cz: 0, legend: false };

/** One legend for the side panel and the on-map toggle (L): glyph, its map ink and a short name. */
const LEGEND: readonly { glyph: string; color: string; label: string }[] = [
  { glyph: "▲", color: "#e6fff5", label: "You" },
  { glyph: "◆", color: "#ffb347", label: "Waypoint" },
  { glyph: "═", color: LINES[0].hex, label: LINES[0].name },
  { glyph: "═", color: LINES[1].hex, label: LINES[1].name },
  { glyph: "━", color: "#e9fff6", label: "Train" },
  { glyph: "▣", color: "#42dfe3", label: "Station" },
  { glyph: "◇", color: "#ff4794", label: "Landmark" },
  { glyph: "□", color: SIGHT_MARK[0] ?? "#2f7c80", label: "Harbour sight" },
  { glyph: "⌂", color: VENUE_INK, label: "Venue entrance" },
  { glyph: "♫", color: CLUB_INK, label: "Nightclub" },
  { glyph: "◘", color: GROUND_INK.arcade, label: "Ground floor (zoom in)" },
  { glyph: "◆", color: "#e6ad62", label: "Quest" },
  { glyph: EVENT_GLYPH, color: EVENT_INK, label: "Live event" },
  { glyph: "○", color: "#9d8cff", label: "Friend" },
  { glyph: "#", color: "#ff8f4d", label: "Tower" },
  { glyph: "+", color: "#2d6166", label: "Crossing" },
  { glyph: "─", color: WALL_INK, label: "Flood wall" },
  { glyph: "~", color: SWELL_INK, label: "Harbour water" },
];

export function WorldMap({ world, snapshot, live, onClose }: WorldMapProps) {
  const venues = interiorPlaces(world);
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef(snapshot);
  const selectedRef = useRef<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const view = useRef({ cx: memory.follow ? snapshot.x : memory.cx, cz: memory.follow ? snapshot.z : memory.cz, scale: memory.scale, target: memory.scale, follow: memory.follow, anchor: null as null | { sx: number; sy: number; wx: number; wz: number }, width: 1, height: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [follow, setFollow] = useState(memory.follow);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState<{ id: string; link: string; ok: boolean } | null>(null);
  const [legend, setLegend] = useState(memory.legend);
  const [groundHidden, setGroundHidden] = useState<ReadonlySet<GroundFloorKind>>(groundFilterMemory.hidden);
  const groundHiddenRef = useRef<ReadonlySet<GroundFloorKind>>(groundFilterMemory.hidden);
  const pickedGround = useRef<string | null>(null); // tap an icon once to read it, again to track its door
  const toggleLegend = useCallback(() => setLegend((shown) => !shown), []);
  useEffect(() => { memory.legend = legend; }, [legend]);
  useEffect(() => { groundFilterMemory.hidden = new Set(groundHidden); groundHiddenRef.current = groundHidden; }, [groundHidden]);
  const toggleGroundKind = useCallback((kind: GroundFloorKind) => setGroundHidden((hidden) => { const next = new Set(hidden); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; }), []);
  const setAllGround = useCallback((show: boolean) => setGroundHidden(show ? new Set() : new Set(GROUND_FLOOR_KINDS)), []);
  const events = mapEvents(snapshot.signalTime ?? snapshot.sceneTime);
  const { waypoints, activeId } = useWaypointState();
  const selectedWaypoint = selected ? waypoints.find((waypoint) => waypoint.id === selected) ?? null : null;
  const editable = !!selectedWaypoint && cityWaypoints.isMine(selectedWaypoint.id);

  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const clampView = useCallback(() => {
    const v = view.current;
    const low = minScale(v.width, v.height);
    v.scale = Math.max(low, Math.min(MAX_SCALE, v.scale));
    v.target = Math.max(low, Math.min(MAX_SCALE, v.target));
    const limit = WORLD_EDGE + 200; // far enough to centre the harbour sights past the flood wall
    v.cx = Math.max(-limit, Math.min(limit, v.cx));
    v.cz = Math.max(-limit, Math.min(limit, v.cz));
  }, []);

  const zoomBy = useCallback((factor: number, sx?: number, sy?: number) => {
    const v = view.current;
    v.target = Math.max(minScale(v.width, v.height), Math.min(MAX_SCALE, v.target * factor));
    if (sx === undefined || sy === undefined || v.follow) { v.anchor = null; return; }
    const [wx, wz] = toWorld({ ...v, dpr: 1 }, sx, sy);
    v.anchor = { sx, sy, wx, wz };
  }, []);

  const centreOnMe = useCallback(() => {
    const v = view.current;
    v.follow = true; v.anchor = null;
    setFollow(true);
  }, []);

  const showCity = useCallback(() => {
    const v = view.current;
    v.follow = false; v.anchor = null; v.cx = 0; v.cz = 0; v.target = minScale(v.width, v.height);
    setFollow(false);
  }, []);

  // Render loop: interpolated player, smooth zoom, cached ASCII terrain + live overlays.
  useEffect(() => {
    const canvas = canvasRef.current, area = areaRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !area || !ctx) return;
    const terrain = new TerrainLayer(world);
    const player = { x: snapshotRef.current.x, z: snapshotRef.current.z, yaw: snapshotRef.current.yaw };
    let metro = snapshotRef.current.metroTime, lastMetro = metro, lastSnapshot = snapshotRef.current;
    let liveEvents: readonly MapEvent[] = mapEvents(lastSnapshot.signalTime ?? lastSnapshot.sceneTime); // City events (shared clock): re-read once per snapshot
    let last = performance.now(), frame = 0;
    const resize = () => {
      const rect = area.getBoundingClientRect();
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      view.current.width = Math.max(1, rect.width); view.current.height = Math.max(1, rect.height);
      canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
      clampView();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(area);
    resize();
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const snap = snapshotRef.current;
      // Snapshots arrive ~6×/s: ease toward them, snap on teleports.
      if (Math.hypot(snap.x - player.x, snap.z - player.z) > 60) { player.x = snap.x; player.z = snap.z; player.yaw = snap.yaw; }
      const k = 1 - Math.exp(-dt * 11);
      player.x += (snap.x - player.x) * k; player.z += (snap.z - player.z) * k;
      player.yaw += wrapAngle(snap.yaw - player.yaw) * k;
      if (snap !== lastSnapshot) { noteGroundVisit(snap.interior?.id); lastMetro = metro; lastSnapshot = snap; liveEvents = mapEvents(snap.signalTime ?? snap.sceneTime); }
      // Trains keep moving between snapshots while the metro clock is running.
      metro = snap.metroTime > lastMetro ? Math.min(snap.metroTime + 0.35, metro + dt) : snap.metroTime;
      if (metro < snap.metroTime - 1) metro = snap.metroTime;
      const v = view.current;
      if (v.follow) { v.cx += (player.x - v.cx) * Math.min(1, k * 1.6); v.cz += (player.z - v.cz) * Math.min(1, k * 1.6); }
      const ratio = v.target / v.scale;
      if (Math.abs(Math.log(ratio)) > 1e-4) {
        v.scale *= Math.pow(ratio, 1 - Math.exp(-dt * 14));
        if (v.anchor) { v.cx = v.anchor.wx - (v.anchor.sx - v.width / 2) / v.scale; v.cz = v.anchor.wz - (v.anchor.sy - v.height / 2) / v.scale; }
      } else { v.scale = v.target; v.anchor = null; }
      clampView();
      memory.scale = v.target; memory.follow = v.follow; memory.cx = v.cx; memory.cz = v.cz;
      const dpr = canvas.width / Math.max(1, v.width);
      const mapView: MapView = { cx: v.cx, cz: v.cz, scale: v.scale, width: v.width, height: v.height, dpr };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(terrain.render(mapView), 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const state = cityWaypoints.getState();
      drawOverlay(ctx, mapView, {
        player, metroTime: metro, quests: snap.quests, venues, discovered: snap.discovered,
        waypoints: state.waypoints, activeId: state.activeId, selectedId: selectedRef.current, hoverId: hoverRef.current,
        friends: friendsOf(snap), time: now / 1000, events: liveEvents, world, groundHidden: groundHiddenRef.current,
      }, terrain);
      // Scale bar.
      const steps = [5, 10, 25, 50, 100, 250, 500, 1000];
      const metres = steps.filter((step) => step * v.scale <= 130).pop() ?? 5;
      const barX = v.width - 30 - metres * v.scale, barY = v.height - 40;
      ctx.strokeStyle = "#9fcfc3"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(barX, barY - 4); ctx.lineTo(barX, barY); ctx.lineTo(barX + metres * v.scale, barY); ctx.lineTo(barX + metres * v.scale, barY - 4); ctx.stroke();
      ctx.font = '10px "Cascadia Code", Consolas, monospace'; ctx.fillStyle = "#b9d6ce"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(`${metres} m`, barX + metres * v.scale / 2, barY - 5);
    };
    frame = requestAnimationFrame(draw);
    // Wheel zoom toward the cursor (non-passive so the page never scrolls or browser-zooms).
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = area.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
      zoomBy(Math.exp(-Math.max(-400, Math.min(400, delta)) * 0.0018), event.clientX - rect.left, event.clientY - rect.top);
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); area.removeEventListener("wheel", onWheel); };
  }, [world, venues, clampView, zoomBy]);

  // Map-local keys (only while the map is open). M / Esc are handled by useWorldMap.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      let handled = true;
      if (event.code === "Equal" || event.code === "NumpadAdd") zoomBy(1.6);
      else if (event.code === "Minus" || event.code === "NumpadSubtract") zoomBy(1 / 1.6);
      else if (event.code === "KeyH") centreOnMe();
      else if (event.code === "KeyL") { if (!event.repeat) toggleLegend(); }
      else if ((event.code === "Delete" || event.code === "Backspace") && selectedRef.current) { cityWaypoints.remove(selectedRef.current); setSelected(null); }
      // Chat (Enter) would open underneath the map: swallow it while the map is up.
      else if ((event.code === "Enter" || event.code === "NumpadEnter") && !(target instanceof HTMLElement && target.closest("[data-world-map]"))) { /* no-op */ }
      else handled = false;
      if (handled) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [zoomBy, centreOnMe, toggleLegend]);

  // Pointer: drag to pan, pinch to zoom, click to drop / select, right-click to drop / remove.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; pinch: number | null }>({ startX: 0, startY: 0, moved: false, pinch: null });
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null); // Mobile: long press removes a pin
  useEffect(() => () => { if (longPress.current) clearTimeout(longPress.current); }, []); // a pending long press must not remove a pin after the map closes
  const local = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = areaRef.current?.getBoundingClientRect();
    return rect ? [event.clientX - rect.left, event.clientY - rect.top] : [0, 0];
  };
  const mapView = (): MapView => ({ ...view.current, dpr: 1 });
  /** The ground-floor icon under a screen point (only while icons are drawn: zoomed in). */
  const groundAt = (sx: number, sy: number, radius = 11): InteriorPlace | null => {
    const v = view.current;
    if (v.scale < GROUND_ICON_SCALE) return null;
    const layer = { px: (x: number) => v.width / 2 + (x - v.cx) * v.scale, pz: (z: number) => v.height / 2 + (z - v.cz) * v.scale, size: Math.max(v.width, v.height), extent: Math.max(v.width, v.height) / 2 / v.scale, centerX: v.cx, centerZ: v.cz, full: true };
    return groundFloorAt(layer, { world, hidden: groundHiddenRef.current }, sx, sy, radius);
  };
  /** A venue or the tracked quest target within `radius` px: these draw above ground icons and win the tap. */
  const higherMarkerNear = (sx: number, sy: number, radius: number): boolean => {
    const v = view.current;
    const near = (x: number, z: number) => Math.hypot(v.width / 2 + (x - v.cx) * v.scale - sx, v.height / 2 + (z - v.cz) * v.scale - sy) < radius;
    const tracked = snapshotRef.current.quests.tracked;
    if (tracked && near(tracked.targetX, tracked.targetZ)) return true;
    return venues.some(place => near(place.entrance.x, place.entrance.z));
  };

  const drop = (sx: number, sy: number) => {
    const [x, z] = toWorld(mapView(), sx, sy);
    if (Math.abs(x) > WORLD_EDGE || Math.abs(z) > WORLD_EDGE) return;
    const waypoint = cityWaypoints.add({ x, z, label: placeName(x, z) });
    if (waypoint) setSelected(waypoint.id);
  };

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if ((event.target as HTMLElement).closest("button, [data-map-legend]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [sx, sy] = local(event);
    pointers.current.set(event.pointerId, { x: sx, y: sy });
    if (pointers.current.size === 1) {
      gesture.current = { startX: sx, startY: sy, moved: false, pinch: null };
      // Mobile (iPhone agent): touch has no right-click, so a long press on a pin removes it.
      if (longPress.current) clearTimeout(longPress.current);
      if (event.pointerType !== "mouse") longPress.current = setTimeout(() => {
        longPress.current = null;
        if (gesture.current.moved || pointers.current.size !== 1) return;
        const hit = waypointAt(mapView(), cityWaypoints.list(), sx, sy);
        if (!hit) return;
        gesture.current.moved = true; // the release is not a tap
        cityWaypoints.remove(hit.id); setSelected((current) => current === hit.id ? null : current);
        navigator.vibrate?.(12);
      }, 550);
    } else if (pointers.current.size === 2) {
      if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; } // Mobile: pinch, not a long press
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.moved = true;
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const [sx, sy] = local(event);
    const previous = pointers.current.get(event.pointerId);
    if (!previous) {
      // Hover readout (mouse only).
      const [x, z] = toWorld(mapView(), sx, sy);
      const hit = waypointAt(mapView(), cityWaypoints.list(), sx, sy);
      hoverRef.current = hit?.id ?? null;
      const ground = hit || higherMarkerNear(sx, sy, 14) ? null : groundAt(sx, sy, 8);
      if (Math.abs(x) > WORLD_EDGE || Math.abs(z) > WORLD_EDGE) {
        // The harbour: quay, flood wall or open water, and the edge sight under the cursor.
        if (Math.abs(x) > HARBOUR_REACH || Math.abs(z) > HARBOUR_REACH) { setHover(null); return; }
        setHover({ x, z, district: "Harbour", street: HARBOUR_ZONE_NAME[harbourZone(x, z)], building: sightAt(x, z)?.name ?? null });
        return;
      }
      const building = world.buildings.find((item) => Math.abs(item.x - x) < item.width / 2 && Math.abs(item.z - z) < item.depth / 2);
      setHover({ x, z, district: districtAt(x, z).name, street: streetNameAt(x, z), building: ground ? groundLabel(ground) : building ? `${building.sign} · ${Math.round(building.height)} m` : null });
      return;
    }
    pointers.current.set(event.pointerId, { x: sx, y: sy });
    const v = view.current;
    if (pointers.current.size >= 2 && gesture.current.pinch) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const factor = distance / gesture.current.pinch;
      gesture.current.pinch = distance;
      const [wx, wz] = toWorld(mapView(), (a.x + b.x) / 2, (a.y + b.y) / 2);
      v.scale = v.target = Math.max(minScale(v.width, v.height), Math.min(MAX_SCALE, v.scale * factor));
      v.follow = false; setFollow(false);
      v.cx = wx - ((a.x + b.x) / 2 - v.width / 2) / v.scale; v.cz = wz - ((a.y + b.y) / 2 - v.height / 2) / v.scale;
      return;
    }
    const g = gesture.current;
    // Mobile: a finger wobbles more than a mouse; 10 px before a tap becomes a pan.
    if (!g.moved && Math.hypot(sx - g.startX, sy - g.startY) > (event.pointerType === "mouse" ? 4 : 10)) { g.moved = true; if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; } setDragging(true); if (v.follow) { v.follow = false; setFollow(false); } }
    if (g.moved) { v.cx -= (sx - previous.x) / v.scale; v.cz -= (sy - previous.y) / v.scale; v.anchor = null; }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; } // Mobile
    if (pointers.current.size > 0) return;
    setDragging(false);
    if (gesture.current.moved || event.type === "pointercancel") { pickedGround.current = null; return; }
    const [sx, sy] = local(event);
    const hit = waypointAt(mapView(), cityWaypoints.list(), sx, sy);
    // Waypoints, venues and quest markers win; a ground icon needs a tight tap (doors are only 25-50 px apart).
    const reach = event.pointerType === "mouse" ? 6 : 9;
    const ground = hit || higherMarkerNear(sx, sy, 14) ? null : groundAt(sx, sy, reach);
    if (!ground) pickedGround.current = null;
    if (hit) { setSelected(hit.id); cityWaypoints.setActive(hit.id); }
    else if (ground) {
      // Tap an interior icon to read what it is; tap it again to track its door.
      if (pickedGround.current === ground.id) { trackEntrance(ground); pickedGround.current = null; }
      else { pickedGround.current = ground.id; setHover({ x: ground.entrance.x, z: ground.entrance.z, district: DISTRICTS[ground.district].name, street: streetNameAt(ground.entrance.x, ground.entrance.z), building: `${groundLabel(ground)} · tap again to track` }); }
    }
    else drop(sx, sy);
  }

  function onContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if ((event.target as HTMLElement).closest("[data-map-legend]")) return;
    const [sx, sy] = local(event);
    const hit = waypointAt(mapView(), cityWaypoints.list(), sx, sy);
    if (hit) { cityWaypoints.remove(hit.id); if (selected === hit.id) setSelected(null); }
    else drop(sx, sy);
  }

  function copyLink(waypoint: Waypoint) {
    const link = waypointLink(location.href, waypoint);
    const done = (ok: boolean) => setCopied({ id: waypoint.id, link, ok });
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(() => done(true), () => done(false));
    else done(false);
  }

  function trackEntrance(place: InteriorPlace) {
    const waypoint = trackVenueEntrance(cityWaypoints, place);
    if (waypoint) setSelected(waypoint.id);
    const current = view.current;
    current.follow = false; current.anchor = null;
    current.cx = place.entrance.x; current.cz = place.entrance.z;
    current.target = Math.max(current.target, 1.3);
    setFollow(false);
  }

  function showEvent(event: MapEvent) {
    const current = view.current;
    current.follow = false; current.anchor = null;
    current.cx = event.x; current.cz = event.z;
    current.target = Math.max(current.target, 1.1);
    setFollow(false);
  }

  const groundFilter = <div className={styles.groundFilter} data-map-legend role="group" aria-label="Ground floor kinds">
    <button type="button" className={styles.groundChip} aria-pressed={groundHidden.size === 0} onClick={() => setAllGround(groundHidden.size > 0)} title="Show or hide every kind">{groundHidden.size === 0 ? "none" : "all"}</button>
    {GROUND_FLOOR_KINDS.map((kind) => <button key={kind} type="button" className={styles.groundChip} style={{ "--wp": GROUND_INK[kind] } as CSSProperties} aria-pressed={!groundHidden.has(kind)} aria-label={`${GROUND_LABEL[kind]} icons`} title={GROUND_LABEL[kind]} onClick={() => toggleGroundKind(kind)}><b aria-hidden="true">{GROUND_GLYPH[kind]}</b><span>{GROUND_LABEL[kind]}</span></button>)}
  </div>;

  const district = DISTRICTS[snapshot.district];
  const activeWaypoint = activeId ? waypoints.find((waypoint) => waypoint.id === activeId) ?? null : null;

  return <div className={styles.overlay} role="dialog" aria-modal="false" aria-labelledby="world-map-title" data-world-map="open">
    <div className={styles.frame}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>City map / you are in</span>
          <h2 className={styles.title} id="world-map-title">{district.name}<span>/</span>{streetNameAt(snapshot.x, snapshot.z)}</h2>
        </div>
        <div className={styles.status} aria-live="off">
          {live ? <><span className={styles.liveDot} aria-hidden="true" /><span>Live · not paused</span><span>WASD still walks</span></> : <><span className={styles.pausedDot} aria-hidden="true" /><span>City paused</span></>}
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close map">Close <kbd>M</kbd><span aria-hidden="true">×</span></button>
      </header>
      <div className={styles.body}>
        <div
          ref={areaRef}
          className={styles.mapArea}
          data-dragging={dragging}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => { hoverRef.current = null; setHover(null); }}
          onContextMenu={onContextMenu}
        >
          <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label="City map: districts, streets, both rail lines, stations, landmarks, the harbour and its sights, venue entrances, quest markers, live events, waypoints and your position. Click to drop a waypoint." />
          <span className={`${styles.corner} ${styles.cornerTL}`} /><span className={`${styles.corner} ${styles.cornerTR}`} />
          <span className={`${styles.corner} ${styles.cornerBL}`} /><span className={`${styles.corner} ${styles.cornerBR}`} />
          <div className={styles.north} aria-hidden="true">N</div>
          <div className={styles.zoom}>
            <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in" title="Zoom in (+)">+</button>
            <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" title="Zoom out (−)">−</button>
            <div className={styles.zoomRule} />
            <button type="button" onClick={centreOnMe} aria-pressed={follow} aria-label="Centre on me and follow" title="Centre on me (H)">◎</button>
            <button type="button" onClick={showCity} aria-label="Show the whole city" title="Whole city">⤢</button>
            <button type="button" onClick={toggleLegend} aria-pressed={legend} aria-label="Map legend" title="Legend (L)">≡</button>
          </div>
          {legend ? <ul className={styles.mapLegend} aria-label="Map legend" data-map-legend>
            {LEGEND.map((item) => <li key={item.label}><b style={{ color: item.color }} aria-hidden="true">{item.glyph}</b>{item.label}</li>)}
            <li className={styles.groundSpan}>{groundFilter}</li>
          </ul> : null}
          <div className={styles.readout} aria-live="off">
            {hover ? <>
              <span><strong>{coordinate(hover.x, "E", "W")}</strong> <strong>{coordinate(-hover.z, "N", "S")}</strong></span>
              <span>{hover.district}</span>
              <span>{hover.street}</span>
              {hover.building ? <span><strong>{hover.building}</strong></span> : null}
              <span>{formatMetres(Math.hypot(hover.x - snapshot.x, hover.z - snapshot.z))} from you</span>
            </> : <span>{coordinate(snapshot.x, "E", "W")} {coordinate(-snapshot.z, "N", "S")} · you</span>}
            <span className={styles.readoutHint}>click: waypoint · drag: pan · wheel: zoom</span>
          </div>
        </div>

        <aside className={styles.panel} aria-label="Places, waypoints and legend">
          <div className={styles.panelScroll}>
            {events.length ? <>
              <h3 className={styles.sectionTitle}>Happening now <small>live</small></h3>
              <ul className={styles.list} aria-label="Live city events">
                {events.map((event) => <li key={event.id}>
                  <button type="button" className={styles.row} data-event={event.kind} style={{ "--wp": EVENT_INK } as CSSProperties} aria-label={`Show ${event.label} on the map`} onClick={() => showEvent(event)}>
                    <span className={styles.rowGlyph} aria-hidden="true">{EVENT_GLYPH}</span>
                    <span className={styles.rowLabel}>{event.label}<small>{event.title}</small></span>
                    <span className={styles.rowMeta}>{formatMetres(Math.hypot(event.x - snapshot.x, event.z - snapshot.z))}</span>
                  </button>
                </li>)}
              </ul>
            </> : null}
            <h3 className={styles.sectionTitle}>Places to go <small>{venues.length} interiors</small></h3>
            <p className={styles.venueHint}>Track a doorway, then press E there to enter.</p>
            <ul className={styles.list} aria-label="Walkable venues">
              {venues.map(place => <li key={place.id}>
                <button type="button" className={`${styles.row} ${styles.venueRow}`} data-venue={place.id} style={{ "--wp": venueInk(place.kind) } as CSSProperties} aria-label={`Track entrance to ${place.name}`} aria-pressed={waypointAtEntrance(activeWaypoint, place)} onClick={() => trackEntrance(place)}>
                  <span className={styles.rowGlyph} aria-hidden="true">{venueGlyph(place.kind)}</span>
                  <span className={styles.rowLabel}>{place.name}<small>{DISTRICTS[place.district].name}</small></span>
                  <span className={styles.rowMeta}>{waypointAtEntrance(activeWaypoint, place) ? <em>Tracking</em> : null}{formatMetres(Math.hypot(place.entrance.x - snapshot.x, place.entrance.z - snapshot.z))}</span>
                </button>
              </li>)}
            </ul>
            <h3 className={styles.sectionTitle}>Ground floors <small>{groundVisitCount()} visited</small></h3>
            <p className={styles.venueHint}>Every building has a way in. Zoom in to see what is behind each door; icons brighten once you have been inside.</p>
            {groundFilter}
            <h3 className={styles.sectionTitle}>Waypoints <small>{waypoints.length ? `${waypoints.length} set` : "none"}</small></h3>
            {waypoints.length === 0 ? <p className={styles.empty}>Click anywhere on the map to drop a waypoint. It lights a beacon in the city and a heading on your compass.</p> : null}
            {waypoints.length ? <ul className={styles.list}>
              {waypoints.map((waypoint) => {
                const bearing = waypointBearing(snapshot.x, snapshot.z, snapshot.yaw, waypoint.x, waypoint.z);
                const mine = cityWaypoints.isMine(waypoint.id);
                return <li key={waypoint.id}>
                  <button type="button" className={styles.row} style={{ "--wp": waypoint.color } as CSSProperties} aria-current={waypoint.id === selected} onClick={() => setSelected(waypoint.id === selected ? null : waypoint.id)}>
                    <span className={styles.rowGlyph} aria-hidden="true">{waypoint.id === activeId ? "◆" : "◇"}</span>
                    <span className={styles.rowLabel}>{waypoint.label}<small>{mine ? (waypoint.shared ? "shared" : "only you") : `from ${ownerName(snapshot, waypoint.owner)}`}</small></span>
                    <span className={styles.rowMeta}>{waypoint.id === activeId ? <em>TRACKING</em> : null}{formatMetres(bearing.distance)} {cardinal(bearing.absolute)}</span>
                  </button>
                </li>;
              })}
            </ul> : null}

            {selectedWaypoint ? <div className={styles.editor} style={{ "--wp": selectedWaypoint.color } as CSSProperties}>
              {editable ? <>
                <label className={styles.field}>Name
                  <input value={selectedWaypoint.label} maxLength={40} onChange={(event) => cityWaypoints.update(selectedWaypoint.id, { label: event.target.value })} onBlur={(event) => { if (!event.target.value.trim()) cityWaypoints.update(selectedWaypoint.id, { label: placeName(selectedWaypoint.x, selectedWaypoint.z) }); }} />
                </label>
                <div className={styles.field}>Colour
                  <div className={styles.swatches}>{WAYPOINT_COLORS.map((color) => <button key={color} type="button" className={styles.swatch} style={{ "--wp": color } as CSSProperties} aria-label={`Colour ${color}`} aria-pressed={selectedWaypoint.color === color} onClick={() => cityWaypoints.update(selectedWaypoint.id, { color })} />)}</div>
                </div>
              </> : <p className={styles.shareNote}>Shared by <strong>{ownerName(snapshot, selectedWaypoint.owner)}</strong>. Hide it to remove it from your map.</p>}
              <div className={styles.actions}>
                <button type="button" className={styles.action} aria-pressed={activeId === selectedWaypoint.id} onClick={() => cityWaypoints.setActive(activeId === selectedWaypoint.id ? null : selectedWaypoint.id)}>{activeId === selectedWaypoint.id ? "Tracking ◆" : "Track"}</button>
                {editable ? <button type="button" className={styles.action} aria-pressed={selectedWaypoint.shared} onClick={() => cityWaypoints.setShared(selectedWaypoint.id, !selectedWaypoint.shared)}>{selectedWaypoint.shared ? "Shared ✓" : "Share"}</button> : null}
                <button type="button" className={styles.action} onClick={() => copyLink(selectedWaypoint)}>{copied?.id === selectedWaypoint.id && copied.ok ? "Link copied ✓" : "Copy link"}</button>
                <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => { cityWaypoints.remove(selectedWaypoint.id); setSelected(null); }}>{editable ? "Remove" : "Hide"}</button>
              </div>
              {copied?.id === selectedWaypoint.id && !copied.ok ? <input className={styles.linkBox} readOnly value={copied.link} aria-label="Waypoint link" onFocus={(event) => event.target.select()} autoFocus /> : null}
              {editable ? <p className={styles.shareNote}>{cityWaypoints.networked ? "Shared waypoints appear on your friends' maps and compasses." : "Playing solo: sharing takes effect when you join friends. A link works anywhere."}</p> : null}
            </div> : null}
            {activeWaypoint && !selectedWaypoint ? <p className={styles.shareNote} style={{ marginBottom: 18 }}>Tracking <strong>{activeWaypoint.label}</strong>. Follow the beacon in the street, the compass at the top of the screen or the minimap arrow.</p> : null}

            <h3 className={styles.sectionTitle}>Legend</h3>
            <ul className={styles.legend}>
              {LEGEND.map((item) => <li key={item.label}><b style={{ color: item.color }}>{item.glyph}</b>{item.label}</li>)}
            </ul>
            <h3 className={styles.sectionTitle}>Controls</h3>
            <dl className={styles.keys}>
              <dt>Click / right-click</dt><dd>Drop waypoint · right-click a pin removes it</dd>
              <dt>Drag · wheel</dt><dd>Pan · zoom to cursor</dd>
              <dt><kbd>+</kbd> <kbd>−</kbd></dt><dd>Zoom</dd>
              <dt><kbd>H</kbd></dt><dd>Centre on me</dd>
              <dt><kbd>L</kbd></dt><dd>Show / hide the map legend</dd>
              <dt><kbd>Del</kbd></dt><dd>Remove selected waypoint</dd>
              <dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>Keep walking</dd>
              <dt><kbd>M</kbd> <kbd>Esc</kbd></dt><dd>Close map</dd>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  </div>;
}
