// Buffered snapshot interpolation for remote players. Pure (no DOM, no Colyseus): the session
// feeds it server-stamped poses; the renderer samples it every frame slightly in the past.
import { SEND_INTERVAL, type Mode } from "./protocol.ts";
import { samePlace } from "./presence.ts";
import { sameCarrier, type TrainCarrier } from "./rail.ts";

export interface PoseSample { time: number; x: number; y: number; z: number; yaw: number; pitch: number; heading: number; speed: number; mode: Mode; car: number; place?: string; carrier?: TrainCarrier | null }

/** Beyond this jump between consecutive samples (m) a player is snapped, never slid. */
export const TELEPORT_DISTANCE = 60;
/** Past the newest sample, motion continues along the last velocity for at most this long (s). */
export const MAX_EXTRAPOLATION = 0.25;
/** A pause longer than this (s) between samples is treated as standing still until the new one. */
const IDLE_GAP = SEND_INTERVAL * 4;
const CAPACITY = 32;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const lerpAngle = (a: number, b: number, k: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class SnapshotBuffer {
  private readonly samples: PoseSample[] = [];

  get size(): number { return this.samples.length; }
  get newest(): PoseSample | null { return this.samples[this.samples.length - 1] ?? null; }

  /** Adds a sample; equal timestamps replace only a changed place or travel mode. */
  push(sample: PoseSample): void {
    const last = this.newest;
    if (last && sample.time < last.time) return;
    if (last && sample.time === last.time) {
      if (last.mode !== sample.mode || !samePlace(last.place, sample.place) || !sameCarrier(last.carrier, sample.carrier) || (last.speed !== 0 && sample.speed === 0)) this.samples[this.samples.length - 1] = { ...sample, place: sample.place ?? "", carrier: sample.carrier ? { ...sample.carrier } : null };
      return;
    }
    // After an idle gap, hold the old pose until one interval before the new one; otherwise the
    // player would drift across the whole gap in slow motion.
    if (last && sample.time - last.time > IDLE_GAP) this.samples.push({ ...last, time: sample.time - SEND_INTERVAL, speed: 0 });
    this.samples.push({ ...sample, place: sample.place ?? "", carrier: sample.carrier ? { ...sample.carrier } : null });
    if (this.samples.length > CAPACITY) this.samples.splice(0, this.samples.length - CAPACITY);
  }

  /** The pose at `time`: blended between the two samples around it, briefly extrapolated past the
   * newest, clamped to the oldest. Teleports and mode changes switch at the later sample. */
  sample(time: number): PoseSample | null {
    const s = this.samples, n = s.length;
    if (!n) return null;
    if (time <= s[0].time) return { ...s[0], time };
    // Drop what can no longer be needed (keep one sample before `time`).
    let i = n - 1;
    while (i > 0 && s[i].time > time) i--;
    if (i > 1) { s.splice(0, i - 1); i = 1; }
    const a = s[i], b = s[i + 1];
    if (!b) {
      const prev = s[i - 1];
      const ahead = Math.min(time - a.time, MAX_EXTRAPOLATION);
      if (a.carrier) return { ...a, time, speed: time - a.time > MAX_EXTRAPOLATION ? 0 : a.speed };
      if (!prev || jumped(prev, a) || a.speed === 0) return { ...a, time };
      const span = a.time - prev.time;
      if (span <= 0) return { ...a, time };
      const k = ahead / span;
      return { ...a, time, x: a.x + (a.x - prev.x) * k, y: a.y + (a.y - prev.y) * k, z: a.z + (a.z - prev.z) * k };
    }
    if (jumped(a, b)) return { ...a, time };
    const k = (time - a.time) / (b.time - a.time);
    return {
      time, mode: a.mode, car: b.car, place: a.place ?? "", carrier: a.carrier && b.carrier ? { train: a.carrier.train, u: lerp(a.carrier.u, b.carrier.u, k), v: lerp(a.carrier.v, b.carrier.v, k), yaw: lerpAngle(a.carrier.yaw, b.carrier.yaw, k) } : null,
      x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), speed: lerp(a.speed, b.speed, k),
      yaw: lerpAngle(a.yaw, b.yaw, k), heading: lerpAngle(a.heading, b.heading, k), pitch: lerp(a.pitch, b.pitch, k),
    };
  }
}

function jumped(a: PoseSample, b: PoseSample): boolean {
  return (!a.carrier && Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > TELEPORT_DISTANCE) || a.mode !== b.mode || !samePlace(a.place, b.place) || !sameCarrier(a.carrier, b.carrier);
}

/** Relates the server clock (sample stamps, ms) to the local clock (s). The offset follows the
 * smallest observed delay at once and larger ones slowly, so network jitter barely moves it. */
export class ServerClock {
  private offset: number | null = null;
  reset(): void { this.offset = null; }
  observe(serverMs: number, localSeconds: number): void {
    const observed = localSeconds - serverMs / 1000;
    if (this.offset === null || observed < this.offset) this.offset = observed;
    else this.offset += (observed - this.offset) * 0.02;
  }
  /** Server time (s) that corresponds to a local time (s). */
  serverNow(localSeconds: number): number { return localSeconds - (this.offset ?? 0); }
  get ready(): boolean { return this.offset !== null; }
}
