"use client";
import { useState, useSyncExternalStore, type RefObject } from "react";
import type { CityController, CitySnapshot } from "@/city/engine";
import { SCENE_VIEWS } from "@/city/inspection";

const subscribe = () => () => {};
const enabled = () => new URLSearchParams(window.location.search).get("studio") === "1";
const server = () => false;

/** A deliberately opt-in local art-direction and QA workbench. URL bookmarks
 * are reproducible in the screenshot runner and useful to a human reviewer. */
export function SceneStudio({ city, snapshot, onExplore }: { city: RefObject<CityController | null>; snapshot: CitySnapshot; onExplore: () => void }) {
  const active = useSyncExternalStore(subscribe, enabled, server);
  const [view, setView] = useState(() => typeof window === "undefined" ? "market" : new URLSearchParams(location.search).get("view") ?? "market");
  const [frozen, setFrozen] = useState(true);
  const [clock, setClock] = useState(() => typeof window === "undefined" ? 45 : Number(new URLSearchParams(location.search).get("clock") ?? 45));
  const [collapsed, setCollapsed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("Copy this camera link");
  if (!active) return null;
  const p = snapshot.population;
  return <aside className="scene-studio" aria-label="Scene inspection tools">
    <button className="studio-heading" onClick={() => setCollapsed(!collapsed)}>Scene lab <span>{collapsed ? "+" : "−"}</span></button>
    {!collapsed ? <div className="studio-body">
      <label>Camera bookmark<select value={view} onChange={event => setView(event.target.value)}>{SCENE_VIEWS.map(preset => <option key={preset.id} value={preset.id}>{preset.title}</option>)}</select></label>
      <div className="studio-buttons"><button onClick={() => city.current?.inspect({ kind: "view", id: view })}>Inspect view</button><button onClick={onExplore}>Walk / look</button></div>
      <label>Simulation time <input type="number" min="0" max="600" step="1" value={clock} onChange={event => setClock(Number(event.target.value))} /></label>
      <div className="studio-buttons"><button onClick={() => city.current?.inspect({ kind: "clock", seconds: clock })}>Rebuild at time</button><button onClick={() => city.current?.inspect({ kind: "step", seconds: 10 })}>Advance 10s</button></div>
      <label className="studio-check"><input type="checkbox" checked={frozen} onChange={event => { setFrozen(event.target.checked); city.current?.inspect({ kind: "freeze", value: event.target.checked }); }} />Freeze simulation, keep camera free</label>
      <dl><dt>Frame rate</dt><dd>{snapshot.fps} fps</dd><dt>Clock / metro</dt><dd>{snapshot.sceneTime.toFixed(1)} / {snapshot.metroTime.toFixed(1)}s</dd><dt>Buildings drawn</dt><dd>{snapshot.visibleBuildings}</dd><dt>Nearby traffic / people</dt><dd>{snapshot.cars} / {snapshot.residents}</dd><dt>Walking / waiting</dt><dd>{p.walking} / {p.waiting}</dd><dt>Shopping / talking</dt><dd>{p.visiting}</dd><dt>On trains</dt><dd>{p.riding} of {p.commuters} commuters</dd></dl>
      <button className="studio-copy" onClick={async () => {
        const url = new URL(location.href); url.search = new URLSearchParams({ studio: "1", view, clock: String(snapshot.sceneTime.toFixed(1)), camera: [snapshot.x, snapshot.altitude, snapshot.z, snapshot.yaw, snapshot.pitch].map(n => n.toFixed(3)).join(",") }).toString();
        try { await navigator.clipboard.writeText(url.toString()); setCopyStatus("Camera link copied"); }
        catch { history.replaceState(null, "", url); setCopyStatus("Link ready in address bar"); }
        setTimeout(() => setCopyStatus("Copy this camera link"), 2400);
      }}>{copyStatus}</button>
      <small>Use <code>npm run audit:visual</code> for the comparison gallery. Add <code>&amp;clean=1</code> to a link for a clear view.</small>
    </div> : null}
  </aside>;
}
