// Room state, synchronised to every client by Colyseus (@colyseus/schema 3). Defined with
// schema() rather than decorators because Node runs this file with plain type stripping.
import { schema, type SchemaType } from "@colyseus/schema";

export const PlayerState = schema({
  name: "string",
  color: "string",
  x: "float32",
  y: "float32",
  z: "float32",
  yaw: "float32",
  pitch: "float32",
  /** Body / car heading (radians, engine yaw convention). */
  heading: "float32",
  speed: "float32",
  mode: "string",
  /** Car id: picks the body colour when driving. */
  car: "uint16",
  /** Server time (ms since the room opened) of the last accepted pose. */
  t: "float64",
  place: "string",
  trainId: "int8",
  trainU: "float32",
  trainV: "float32",
  trainYaw: "float32",
}, "PlayerState");
export type PlayerState = SchemaType<typeof PlayerState>;

export const QuestProgressState = schema({
  status: "string",
  step: "uint8",
}, "QuestProgressState");
export type QuestProgressState = SchemaType<typeof QuestProgressState>;

export const WaypointState = schema({
  id: "string",
  x: "float32",
  z: "float32",
  label: "string",
  color: "string",
  /** Session id of the player who placed it; only they can remove it. */
  owner: "string",
  shared: "boolean",
  createdAt: "float64",
}, "WaypointState");
export type WaypointState = SchemaType<typeof WaypointState>;

export const NightfallState = schema({
  players: { map: PlayerState },
  /** Party quest progress, keyed by quest id, in acceptance order. */
  quests: { map: QuestProgressState },
  /** Shared party purse. */
  credits: "uint32",
  /** Bumped on every accepted quest transition. */
  questRevision: "uint32",
  waypoints: { map: WaypointState },
  worldTimeMs: "float64",
}, "NightfallState");
export type NightfallState = SchemaType<typeof NightfallState>;
