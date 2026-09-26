/** Driving camera preference (cockpit / chase) and the eased blend between the two views.
 * Pure helpers plus a guarded localStorage wrapper; nothing here touches the DOM at import time. */
export type DriveView = "cockpit" | "chase";
export const DRIVE_VIEW_STORAGE_KEY = "nightfall.driveView";
/** Seconds a cockpit <-> chase switch takes. */
export const DRIVE_VIEW_TRANSITION = 0.4;

/** Anything but the literal "chase" (missing, corrupt, an old format) means the cockpit. */
export const parseDriveView = (raw: unknown): DriveView => raw === "chase" ? "chase" : "cockpit";

export function loadDriveView(): DriveView {
  try { return parseDriveView(window.localStorage.getItem(DRIVE_VIEW_STORAGE_KEY)); }
  catch { return "cockpit"; }
}
export function saveDriveView(view: DriveView): void {
  try { window.localStorage.setItem(DRIVE_VIEW_STORAGE_KEY, view); }
  catch { /* Private mode / storage disabled: the view is remembered for this session only. */ }
}

/** Linear progress (0 cockpit .. 1 chase) toward the chosen view, at a fixed pace: a switch never snaps,
 * and reversing mid-way turns back from where the camera is. */
export function stepViewBlend(progress: number, chase: boolean, dt: number, duration = DRIVE_VIEW_TRANSITION): number {
  const step = Math.max(0, dt) / Math.max(1e-3, duration);
  return chase ? Math.min(1, progress + step) : Math.max(0, progress - step);
}
/** Smoothstep: zero velocity at both ends, so the camera eases out of one view and into the other. */
export const easeViewBlend = (progress: number): number => { const p = Math.max(0, Math.min(1, progress)); return p * p * (3 - 2 * p); };

/** Steering-wheel rotation either side of centre at full lock (270 degrees lock-to-lock). */
export const STEERING_WHEEL_LOCK = 135;
/** Wheel rotation in degrees about its column for a steer value (-1 full left .. 1 full right),
 * in the sign textmode's rotateY needs inside the cockpit frame (negative turns the rim clockwise
 * as the driver sees it). */
export const steeringWheelAngle = (steer: number): number => { const s = Math.max(-1, Math.min(1, steer)); return s === 0 ? 0 : -s * STEERING_WHEEL_LOCK; };
