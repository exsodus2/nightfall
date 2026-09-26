import type { CitySnapshot } from "@/city/engine";

const segment = (active: boolean) => ({ padding: "0.1rem 0.45rem", borderRadius: "0.2rem", color: active ? "rgba(8, 20, 24, 0.95)" : "rgba(196, 238, 226, 0.7)", background: active ? "rgba(126, 232, 214, 0.9)" : "transparent", transition: "background-color 0.2s ease, color 0.2s ease" });

/** Driving controls strip, shown only while the player drives (snapshot.drive). Self-contained:
 * bottom left above the walking hints, clear of the steering wheel and the road; no shared CSS.
 * The camera toggle is a real button: V, the touch Cam button and this all switch the same eased
 * cockpit / chase camera, and the engine remembers the choice for the next car. */
export function DriveHud({ snapshot, onToggleView }: { snapshot: CitySnapshot; onToggleView?: () => void }) {
  const drive = snapshot.drive;
  if (snapshot.mode !== "drive" || !drive) return null;
  const chase = drive.view === "chase";
  const keys: readonly [string, string][] = [["W S", "drive / brake"], ["A D", "steer"], ["Space", "handbrake"], ["Shift", "boost"]];  // E / get out lives in the interaction prompt
  return <div aria-label="Driving controls" style={{ position: "fixed", left: "39px", bottom: "104px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.45rem", maxWidth: "min(470px, calc(100vw - 32px))", pointerEvents: "none", font: "500 0.68rem/1.4 var(--font-mono, ui-monospace, monospace)", letterSpacing: "0.04em", color: "rgba(196, 238, 226, 0.78)", textShadow: "0 1px 6px rgba(0, 0, 0, 0.8)" }}>
    <button type="button" onClick={onToggleView} onMouseDown={(event) => event.preventDefault() /* no focus: Space (handbrake) must not press it */} aria-label={`Camera: ${chase ? "chase" : "cockpit"} view. Press V to switch.`} title="Switch camera (V)"
      style={{ pointerEvents: "auto", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.2rem 0.3rem 0.2rem 0.35rem", font: "inherit", letterSpacing: "inherit", color: "inherit", background: "rgba(6, 16, 22, 0.62)", border: "1px solid rgba(126, 232, 214, 0.35)", borderRadius: "0.3rem", textShadow: "none" }}>
      <kbd>V</kbd><span aria-hidden="true">·</span>
      <span style={segment(!chase)}>Cockpit</span><span aria-hidden="true">/</span><span style={segment(chase)}>Chase</span>
    </button>
    <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ color: "rgba(126, 232, 214, 0.95)" }}>{drive.gear}{drive.boost ? " · BOOST" : ""}</span>
      {keys.map(([key, label]) => <span key={key}><kbd>{key}</kbd> {label}</span>)}
    </div>
  </div>;
}
