import { TRAIN_COUNT, canWalkInTrain, floorHeight, lineOfTrain, localToWorld, trainAt } from "../city/metro.ts";

export const METRO_TIME_OFFSET = 2;
export const RAIL_POSITION_SLACK = 24;
export const RAIL_HEIGHT_SLACK = 0.5;
/** Extra height allowance against the expected carriage floor: decks rise and dip between stations
 * (at most ~2.5 m/s vertically), so a pose a little behind the room clock may be this far off. */
export const RAIL_RISE_SLACK = 2;
export const CARRIER_WALK_SPEED = 7;

export interface TrainCarrier { train: number; u: number; v: number; yaw: number }
export interface RailPresence { x: number; y: number; z: number; mode: string; place?: string; carrier?: TrainCarrier | null }

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Train ids are global (metro.ts): 0-3 the City Loop, 4-7 the Rim Line. */
export function parseTrainCarrier(value: unknown): TrainCarrier | null {
  if (!value || typeof value !== "object") return null;
  const fields = value as Record<string, unknown>;
  if (!finite(fields.train) || !Number.isInteger(fields.train) || fields.train < 0 || fields.train >= TRAIN_COUNT || !finite(fields.u) || !finite(fields.v) || !finite(fields.yaw)) return null;
  if (!canWalkInTrain(fields.u, fields.v)) return null;
  return { train: fields.train, u: fields.u, v: fields.v, yaw: Math.atan2(Math.sin(fields.yaw), Math.cos(fields.yaw)) };
}

export function sameCarrier(left?: TrainCarrier | null, right?: TrainCarrier | null): boolean {
  return (left?.train ?? -1) === (right?.train ?? -1);
}

/** The rider's world pose; `y` is the carriage floor under them (it follows the deck's rise and grade). */
export function railPose(carrier: TrainCarrier, roomSeconds: number): { x: number; y: number; z: number; yaw: number; heading: number } {
  const train = trainAt(roomSeconds + METRO_TIME_OFFSET, carrier.train);
  const position = localToWorld(train, carrier.u, carrier.v);
  const yaw = Math.atan2(Math.sin(train.yaw + carrier.yaw), Math.cos(train.yaw + carrier.yaw));
  return { ...position, y: floorHeight(train, carrier.v), yaw, heading: yaw };
}

/** Time-free check: the height is somewhere the carrier's line can put a carriage floor. */
export function validRailPresence(pose: RailPresence): boolean {
  if (!pose.carrier) return true;
  const carrier = parseTrainCarrier(pose.carrier);
  if (!carrier || pose.place || pose.mode !== "metro" || !Number.isFinite(pose.y)) return false;
  const [low, high] = lineOfTrain(carrier.train).floorRange;
  return pose.y >= low - RAIL_HEIGHT_SLACK && pose.y <= high + RAIL_HEIGHT_SLACK;
}

export function validRailTransition(previous: RailPresence | null, next: RailPresence, roomSeconds: number): boolean {
  if (!validRailPresence(next)) return false;
  if (!next.carrier) return !previous?.carrier || next.mode !== "metro";
  const expected = railPose(next.carrier, roomSeconds);
  if (Math.hypot(next.x - expected.x, next.z - expected.z) > RAIL_POSITION_SLACK || Math.abs(next.y - expected.y) > RAIL_HEIGHT_SLACK + RAIL_RISE_SLACK) return false;
  if (!previous) return true;
  if (previous.carrier) return sameCarrier(previous.carrier, next.carrier);
  // Boarding: from that line's platform (trains stand level at stations).
  return !previous.place && (previous.mode === "walk" || previous.mode === "metro") && Math.abs(previous.y - lineOfTrain(next.carrier.train).platform) <= RAIL_HEIGHT_SLACK && Math.hypot(previous.x - expected.x, previous.z - expected.z) <= RAIL_POSITION_SLACK;
}
