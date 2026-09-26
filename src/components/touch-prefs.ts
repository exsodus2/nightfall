"use client";

import { useSyncExternalStore } from "react";

// Mobile: touch-control preferences (gyro aim, look acceleration, look speed), remembered in this browser.
export interface TouchPrefs {
  /** Aim by turning the phone (gyroscope). Off by default; iOS asks for permission on enable. */
  gyro: boolean;
  /** Fast swipes turn further than slow ones. */
  lookAccel: boolean;
  /** Swipe-to-look speed multiplier (on top of Settings -> Look sensitivity). */
  lookSpeed: number;
}
export const DEFAULT_TOUCH_PREFS: TouchPrefs = { gyro: false, lookAccel: true, lookSpeed: 1 };
const KEY = "nightfall.touch.v1";
let current: TouchPrefs = DEFAULT_TOUCH_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function load(): TouchPrefs {
  if (loaded || typeof window === "undefined") return current;
  loaded = true;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw === "object") {
      const value = raw as Partial<Record<keyof TouchPrefs, unknown>>;
      current = {
        gyro: false, // permission is per session on iOS: always start off, the toggle re-requests it
        lookAccel: typeof value.lookAccel === "boolean" ? value.lookAccel : DEFAULT_TOUCH_PREFS.lookAccel,
        lookSpeed: typeof value.lookSpeed === "number" && Number.isFinite(value.lookSpeed) ? Math.max(0.4, Math.min(2.5, value.lookSpeed)) : DEFAULT_TOUCH_PREFS.lookSpeed,
      };
    }
  } catch { /* storage unavailable (private mode): defaults */ }
  return current;
}

export const touchPrefs = {
  get: (): TouchPrefs => load(),
  set(patch: Partial<TouchPrefs>): void {
    current = { ...load(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

export function useTouchPrefs(): TouchPrefs {
  return useSyncExternalStore(touchPrefs.subscribe, touchPrefs.get, () => DEFAULT_TOUCH_PREFS);
}

// ---- touch UI detection (coarse primary pointer), reactive to e.g. an iPad keyboard/trackpad ----
const COARSE = "(pointer: coarse)";
function subscribeCoarse(listener: () => void): () => void {
  const query = matchMedia(COARSE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
export function useTouchUi(): boolean {
  return useSyncExternalStore(subscribeCoarse, () => matchMedia(COARSE).matches, () => false);
}

// ---- gyroscope permission (iOS 13+ needs it from a user gesture; also needs HTTPS) ----
interface PermissionEventConstructor { requestPermission?: () => Promise<"granted" | "denied"> }
export async function requestMotionPermission(): Promise<boolean> {
  if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined") return false;
  const motion = DeviceMotionEvent as unknown as PermissionEventConstructor;
  if (typeof motion.requestPermission !== "function") return true; // Android / desktop: no prompt
  try { return (await motion.requestPermission()) === "granted"; } catch { return false; }
}
export const gyroAvailable = (): boolean => typeof window !== "undefined" && typeof DeviceMotionEvent !== "undefined";
