import { PLATFORM_HEIGHT, canWalkInTrain, localToWorld, trainAt } from "../city/metro.ts";

export const METRO_TIME_OFFSET = 2;
export const RAIL_POSITION_SLACK = 24;
export const RAIL_HEIGHT_SLACK = 0.5;
export const CARRIER_WALK_SPEED = 7;

export interface TrainCarrier { train: number; u: number; v: number; yaw: number }
export interface RailPresence { x: number; y: number; z: number; mode: string; place?: string; carrier?: TrainCarrier | null }

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseTrainCarrier(value: unknown): TrainCarrier | null {
  if (!value || typeof value !== "object") return null;
  const fields = value as Record<string, unknown>;
  if (!finite(fields.train) || !Number.isInteger(fields.train) || fields.train < 0 || fields.train > 3 || !finite(fields.u) || !finite(fields.v) || !finite(fields.yaw)) return null;
  if (!canWalkInTrain(fields.u, fields.v)) return null;
  return { train: fields.train, u: fields.u, v: fields.v, yaw: Math.atan2(Math.sin(fields.yaw), Math.cos(fields.yaw)) };
}

export function sameCarrier(left?: TrainCarrier | null, right?: TrainCarrier | null): boolean {
  return (left?.train ?? -1) === (right?.train ?? -1);
}

export function railPose(carrier: TrainCarrier, roomSeconds: number): { x: number; y: number; z: number; yaw: number; heading: number } {
  const train = trainAt(roomSeconds + METRO_TIME_OFFSET, carrier.train);
  const position = localToWorld(train, carrier.u, carrier.v);
  const yaw = Math.atan2(Math.sin(train.yaw + carrier.yaw), Math.cos(train.yaw + carrier.yaw));
  return { ...position, y: PLATFORM_HEIGHT, yaw, heading: yaw };
}

export function validRailPresence(pose: RailPresence): boolean {
  if (!pose.carrier) return true;
  return !pose.place && pose.mode === "metro" && !!parseTrainCarrier(pose.carrier) && Number.isFinite(pose.y) && Math.abs(pose.y - PLATFORM_HEIGHT) <= RAIL_HEIGHT_SLACK;
}

export function validRailTransition(previous: RailPresence | null, next: RailPresence, roomSeconds: number): boolean {
  if (!validRailPresence(next)) return false;
  if (!next.carrier) return !previous?.carrier || next.mode !== "metro";
  const expected = railPose(next.carrier, roomSeconds);
  if (Math.hypot(next.x - expected.x, next.z - expected.z) > RAIL_POSITION_SLACK) return false;
  if (!previous) return true;
  if (previous.carrier) return sameCarrier(previous.carrier, next.carrier);
  return !previous.place && (previous.mode === "walk" || previous.mode === "metro") && Math.abs(previous.y - PLATFORM_HEIGHT) <= RAIL_HEIGHT_SLACK && Math.hypot(previous.x - expected.x, previous.z - expected.z) <= RAIL_POSITION_SLACK;
}
