import type { CarPose } from "../city/driving";
import { WORLD_EDGE } from "../city/world.ts";
import { MAX_PLAYERS } from "./protocol.ts";
import type { RemoteAvatar } from "./types";

export const MAX_REMOTE_CARS = MAX_PLAYERS - 1;
export const REMOTE_CAR_HEIGHT_TOLERANCE = 0.1;
export type RemoteVehiclePose = Pick<RemoteAvatar, "id" | "x" | "y" | "z" | "heading" | "mode"> & Partial<Pick<RemoteAvatar, "place" | "carrier">>;

interface Candidate { id: string; distance: number; pose: CarPose }

function compare(left: Candidate, right: Candidate): number {
  return left.distance - right.distance || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) || left.pose.x - right.pose.x || left.pose.z - right.pose.z || left.pose.yaw - right.pose.yaw;
}

export function nearbyRemoteCars(remotes: readonly RemoteVehiclePose[], anchor: Pick<CarPose, "x" | "z">, radius: number): CarPose[] {
  if (!Array.isArray(remotes) || !anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.z) || !Number.isFinite(radius) || radius < 0) return [];
  const nearest: Candidate[] = [];
  for (const remote of remotes) {
    if (!remote || typeof remote.id !== "string" || !remote.id || remote.id.length > 64 || remote.mode !== "drive" && remote.mode !== "taxi") continue;
    if (remote.place !== undefined && remote.place !== "" || remote.carrier !== undefined && remote.carrier !== null) continue;
    if (![remote.x, remote.y, remote.z, remote.heading].every(Number.isFinite) || Math.abs(remote.y) > REMOTE_CAR_HEIGHT_TOLERANCE || Math.abs(remote.x) > WORLD_EDGE || Math.abs(remote.z) > WORLD_EDGE) continue;
    const distance = Math.hypot(remote.x - anchor.x, remote.z - anchor.z);
    if (distance > radius) continue;
    const candidate: Candidate = { id: remote.id, distance, pose: { x: remote.x, z: remote.z, yaw: Math.atan2(Math.sin(remote.heading), Math.cos(remote.heading)) } };
    const duplicate = nearest.findIndex(existing => existing.id === remote.id);
    if (duplicate >= 0) {
      if (compare(nearest[duplicate], candidate) <= 0) continue;
      nearest.splice(duplicate, 1);
    }
    let index = 0;
    while (index < nearest.length && compare(nearest[index], candidate) <= 0) index++;
    if (index >= MAX_REMOTE_CARS) continue;
    nearest.splice(index, 0, candidate);
    if (nearest.length > MAX_REMOTE_CARS) nearest.pop();
  }
  return nearest.map(candidate => candidate.pose);
}
