// The narrow surface the engine sees. engine.ts only talks to a MultiplayerLink (implemented by
// MultiplayerSession in session.ts), so solo play never loads Colyseus.
import type { QuestBookState } from "../city/quests";
import type { RGB } from "../city/world";
import type { Mode } from "./protocol";
import type { TrainCarrier } from "./rail";

/** Published by the engine every frame (the link throttles). `y` is the feet / vehicle floor height. */
export interface LocalPose { x: number; y: number; z: number; yaw: number; pitch: number; heading: number; speed: number; mode: Mode; car: number; place?: string; carrier?: TrainCarrier | null }

/** A remote player's interpolated pose for this frame. `stride` is a walk-cycle phase in radians. */
export interface RemoteAvatar {
  id: string; name: string; color: RGB; hex: string;
  x: number; y: number; z: number; yaw: number; pitch: number; heading: number; speed: number; mode: Mode; car: number;
  stride: number; place: string; carrier: TrainCarrier | null;
}

/** Friends for the minimap / atlas (also in CitySnapshot.friends). */
export interface FriendPosition { id: string; name: string; color: string; x: number; z: number; yaw: number; mode: Mode; place: string; carrier: TrainCarrier | null }

/** The party quest state; `key` changes whenever the engine should adopt it again. */
export interface PartyQuestSync { key: number; state: QuestBookState }

export interface MultiplayerLink {
  publish(pose: LocalPose, now: number): void;
  worldTime(now: number): number | null;
  /** Interpolated remote players at local time `now` (seconds, performance.now() / 1000). */
  remotes(now: number): readonly RemoteAvatar[];
  friends(): readonly FriendPosition[];
  questSync(): PartyQuestSync | null;
  /** A dialogue choice that changed quest state locally; the server validates and shares it. */
  questIntent(npcId: string, optionId: string): void;
}
