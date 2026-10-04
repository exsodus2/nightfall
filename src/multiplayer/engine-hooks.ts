// Small pure helpers behind the one-line multiplayer hooks in engine.ts.
import type { DriveCar } from "../city/driving";
import type { TravelMode } from "../city/locomotion";
import type { LocalPose, RemoteAvatar } from "./types";
import type { TrainCarrier } from "./rail.ts";
export { METRO_TIME_OFFSET } from "./rail.ts";

const WALK_EYE = 2.7, TRAIN_EYE = 2.35, SKY_CABIN = 1.2;

export interface EngineState { x: number; z: number; eye: number; yaw: number; pitch: number; speed: number; mode: TravelMode; car: DriveCar | null; rideHeading: number | null; inTrain: boolean; place?: string; carrier?: TrainCarrier | null }

/** The local player as others should see them: feet (or vehicle floor) height, body/car heading. */
export function localPose(s: EngineState): LocalPose {
  const vehicle = s.mode === "drive" || s.mode === "taxi" || s.mode === "sky";
  const y = s.mode === "drive" || s.mode === "taxi" ? 0 : s.mode === "sky" ? Math.max(0, s.eye - SKY_CABIN) : Math.max(0, s.eye - (s.inTrain ? TRAIN_EYE : WALK_EYE));
  const heading = s.car ? s.car.yaw : vehicle ? s.rideHeading ?? s.yaw : s.yaw;
  return { x: s.x, y, z: s.z, yaw: s.yaw, pitch: s.pitch, heading, speed: s.car ? s.car.speed : s.speed, mode: s.mode, car: s.car?.id ?? 0, place: s.place ?? "", carrier: s.carrier ?? null };
}

interface Headlight { x: number; z: number; yaw: number; intensity: number }
/** Adds remote players' ground cars to the material's headlight list (nearest first). Entries
 * already there keep their order; remote cars are slotted in by distance after the player's car. */
export function mergeRemoteHeadlights(headlights: Headlight[], remotes: readonly RemoteAvatar[], x: number, z: number, ownCar: boolean): void {
  const start = ownCar ? 1 : 0;
  for (const r of remotes) {
    if (r.mode !== "drive" && r.mode !== "taxi") continue;
    const distance = Math.hypot(r.x - x, r.z - z);
    let i = start;
    while (i < headlights.length && Math.hypot(headlights[i].x - x, headlights[i].z - z) <= distance) i++;
    headlights.splice(i, 0, { x: r.x, z: r.z, yaw: r.heading, intensity: 1 });
  }
}
