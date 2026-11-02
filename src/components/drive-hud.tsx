import type { CitySnapshot } from "@/city/engine";

/** Driving controls strip, shown only while the player drives (snapshot.drive). It takes the
 * walking hint's slot bottom left (globals.css `.drive-hud`; the walking hint hides in a car), and
 * room chat lifts above it, so the two never stack. The camera toggle is a real button: V, the
 * touch Cam button and this all switch the same eased cockpit / chase camera, and the engine
 * remembers the choice for the next car. Touch layouts hide the strip (mobile.css). */
export function DriveHud({ snapshot, onToggleView }: { snapshot: CitySnapshot; onToggleView?: () => void }) {
  const drive = snapshot.drive;
  if (snapshot.mode !== "drive" || !drive) return null;
  const chase = drive.view === "chase";
  // E / get out lives in the interaction prompt and the travel panel.
  const keys: readonly [string, string][] = [["W S", "gas / brake"], ["A D", "steer"], ["Space", "handbrake"], ["Shift", "boost"], ["Esc", "pause"]];
  return <div className="drive-hud" aria-label="Driving controls">
    <div className="drive-hud-row">
      <button type="button" className="drive-hud-camera" onClick={onToggleView} onMouseDown={(event) => event.preventDefault() /* no focus: Space (handbrake) must not press it */} aria-label={`Camera: ${chase ? "chase" : "cockpit"} view. Press V to switch.`} title="Switch camera (V)">
        <kbd>V</kbd><span data-active={!chase}>Cockpit</span><span aria-hidden="true">/</span><span data-active={chase}>Chase</span>
      </button>
      <span className="drive-hud-gear" data-boost={drive.boost}>GEAR {drive.gear}{drive.boost ? " + BOOST" : ""}</span>
    </div>
    <div className="drive-hud-keys">{keys.map(([key, label]) => <span key={key}><kbd>{key}</kbd>{label}</span>)}</div>
  </div>;
}
