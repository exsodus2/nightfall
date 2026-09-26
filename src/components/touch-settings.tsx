"use client";

import { useState } from "react";
import { gyroAvailable, requestMotionPermission, touchPrefs, useTouchPrefs } from "./touch-prefs";

/** Mobile: touch-control options in the Settings panel (only rendered on touch devices). */
export function TouchSettings() {
  const prefs = useTouchPrefs();
  const [gyroNote, setGyroNote] = useState("");
  async function toggleGyro() {
    if (prefs.gyro) { touchPrefs.set({ gyro: false }); setGyroNote(""); return; }
    // iOS: the permission prompt must come from this tap; motion events also need HTTPS.
    const granted = await requestMotionPermission();
    if (!granted) { setGyroNote("Motion access was denied. Enable it in Safari settings (needs HTTPS)."); return; }
    touchPrefs.set({ gyro: true });
    setGyroNote(window.isSecureContext ? "" : "Motion sensors only work over HTTPS (use the tunnel URL).");
  }
  return <div className="touch-settings">
    <h3>Touch controls</h3>
    <p className="touch-settings-intro">Left thumb: the stick appears where you touch; push past its ring to run (in a car: steer and gas/brake, past the ring boosts). Right thumb: swipe to look.</p>
    <label className="sensitivity-setting"><span>Swipe look speed <output>{prefs.lookSpeed.toFixed(1)}×</output></span>
      <input type="range" min="0.4" max="2.5" step="0.1" value={prefs.lookSpeed} onChange={(event) => touchPrefs.set({ lookSpeed: Number(event.target.value) })} />
    </label>
    <button type="button" className="setting-row" role="switch" aria-checked={prefs.lookAccel} onClick={() => touchPrefs.set({ lookAccel: !prefs.lookAccel })}>
      <span><strong>Look acceleration</strong><small>Quick flicks turn further than slow swipes</small></span>
      <span className="toggle-track" data-checked={prefs.lookAccel}><span /></span>
    </button>
    {gyroAvailable() ? <button type="button" className="setting-row" role="switch" aria-checked={prefs.gyro} onClick={() => void toggleGyro()}>
      <span><strong>Gyro aim</strong><small>{gyroNote || "Turn the phone to look around (asks for motion access)"}</small></span>
      <span className="toggle-track" data-checked={prefs.gyro}><span /></span>
    </button> : null}
  </div>;
}
