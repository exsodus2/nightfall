import assert from "node:assert/strict";
import test from "node:test";
import { AMBIENCE_VOLUME, createAmbience } from "../src/audio/ambience.ts";
import type { AmbienceFrame } from "../src/audio/ambience-mix.ts";

/** A minimal stand-in for Web Audio: records parameter targets and node wiring, plays nothing. */
class FakeParam {
  value = 0;
  targets: number[] = [];
  setTargetAtTime(value: number): this { this.targets.push(value); this.value = value; return this; }
  setValueAtTime(value: number): this { this.value = value; return this; }
  linearRampToValueAtTime(value: number): this { this.value = value; return this; }
  exponentialRampToValueAtTime(value: number): this { this.value = value; return this; }
}
class FakeNode {
  static created = 0;
  type = "";
  loop = false;
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = 0;
  outputs: FakeNode[] = [];
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  readonly playbackRate = new FakeParam();
  readonly delayTime = new FakeParam();
  constructor() { FakeNode.created++; }
  connect(target: FakeNode | FakeParam): FakeNode | FakeParam { if (target instanceof FakeNode) this.outputs.push(target); return target; }
  disconnect(): void { this.outputs = []; }
  start(): void { this.started++; }
  stop(): void { /* ended later by the test */ }
}
class FakeContext {
  sampleRate = 8000;
  currentTime = 0;
  state = "running";
  resumed = 0;
  suspended = 0;
  closed = 0;
  destination = new FakeNode();
  gains: FakeNode[] = [];
  oscillators: FakeNode[] = [];
  createGain(): FakeNode { const node = new FakeNode(); this.gains.push(node); return node; }
  createBiquadFilter(): FakeNode { return new FakeNode(); }
  createOscillator(): FakeNode { const node = new FakeNode(); this.oscillators.push(node); return node; }
  createBufferSource(): FakeNode { return new FakeNode(); }
  createDelay(): FakeNode { return new FakeNode(); }
  createBuffer(_channels: number, length: number, rate: number): { duration: number; getChannelData: () => Float32Array } {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  async resume(): Promise<void> { this.resumed++; }
  async suspend(): Promise<void> { this.suspended++; }
  async close(): Promise<void> { this.closed++; }
}

function harness(): { ambience: ReturnType<typeof createAmbience>; contexts: FakeContext[] } {
  const contexts: FakeContext[] = [];
  let seed = 1;
  const random = (): number => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const ambience = createAmbience({ context: () => { const ctx = new FakeContext(); contexts.push(ctx); return ctx as unknown as BaseAudioContext; }, random });
  return { ambience, contexts };
}

const frame = (patch: Partial<AmbienceFrame> = {}): AmbienceFrame => ({
  district: 1, x: 0, y: 2.7, z: -320, interior: false, rain: true, weather: 0.5, speed: 0, walking: true, driving: false, boost: false,
  riding: false, ridingSpeed: 0, lift: false, trainDistance: Infinity, trainSpeed: 0, trainBraking: false, car: null, time: 0, ...patch,
});

/** The master gain: the only gain wired straight to the destination. */
function master(ctx: FakeContext): FakeNode {
  const node = ctx.gains.find((gain) => gain.outputs.includes(ctx.destination));
  assert.ok(node, "master gain");
  return node;
}

test("nothing is created before the first set(true): updates, events and ducking stay silent", () => {
  const { ambience, contexts } = harness();
  ambience.update(frame());
  ambience.event("lift");
  ambience.duck(0.4);
  ambience.set(false);
  assert.equal(contexts.length, 0);
  assert.deepEqual(ambience.stats(), { built: false, running: false, nodes: 0, voices: 0 });
});

test("the first set(true) builds one compact graph and fades the master to the duck level", () => {
  const { ambience, contexts } = harness();
  ambience.duck(0.4);
  ambience.set(true);
  ambience.set(true);
  assert.equal(contexts.length, 1);
  const ctx = contexts[0];
  assert.ok(ctx.resumed >= 1, "resumed from the gesture");
  const stats = ambience.stats();
  assert.ok(stats.built && stats.running);
  assert.ok(stats.nodes > 30 && stats.nodes < 170, `${stats.nodes} nodes`);
  assert.equal(master(ctx).gain.targets.at(-1), AMBIENCE_VOLUME * 0.4);
  ambience.duck(1);
  assert.equal(master(ctx).gain.targets.at(-1), AMBIENCE_VOLUME);
  ambience.destroy();
});

test("set(false) fades to silence and later updates do not touch the graph", () => {
  const { ambience, contexts } = harness();
  ambience.set(true);
  ambience.update(frame());
  const ctx = contexts[0];
  ambience.set(false);
  assert.equal(master(ctx).gain.targets.at(-1), 0);
  const before = FakeNode.created;
  ambience.update(frame({ speed: 3 }));
  ambience.event("pickup");
  assert.equal(FakeNode.created, before, "no one-shots while off");
  ambience.destroy();
  assert.equal(ctx.closed, 1);
  ambience.set(true);
  assert.equal(contexts.length, 1, "destroyed ambience never rebuilds");
});

test("walking schedules footsteps; standing does not", () => {
  const { ambience } = harness();
  ambience.set(true);
  ambience.update(frame({ speed: 0 }));
  assert.equal(ambience.stats().voices, 0);
  ambience.update(frame({ speed: 3 }));
  assert.ok(ambience.stats().voices > 0, "a step is queued");
  ambience.destroy();
});

test("events play only while on, and the voice pool is capped", () => {
  const { ambience } = harness();
  ambience.set(true);
  for (let i = 0; i < 100; i++) ambience.event("pickup");
  assert.ok(ambience.stats().voices <= 24);
  ambience.destroy();
});

test("a redundant set(true) keeps the edge state: the door plays on leaving a venue too", () => {
  const { ambience } = harness();
  ambience.set(true);
  ambience.update(frame({ interior: false, walking: false }));
  ambience.update(frame({ interior: true, walking: false, time: 1 }));
  const afterEnter = ambience.stats().voices;
  assert.ok(afterEnter >= 1, "entering plays a door");
  ambience.set(true); // engine.ts leaveInterior() re-applies the setting while already on
  ambience.update(frame({ interior: false, walking: false, time: 2 }));
  assert.ok(ambience.stats().voices > afterEnter, "leaving plays a door as well");
  ambience.destroy();
});

/** One-shot oscillators that ended on `hz` (tone() ramps to its end frequency; the fake keeps the last value). */
const toneCount = (ctx: FakeContext, type: string, hz: number): number => ctx.oscillators.filter((node) => node.type === type && node.frequency.value === hz).length;

test("by The Static's door the bass pulse thumps CLUB_BEAT (2.5 s) apart; far from it, none", () => {
  const { ambience, contexts } = harness();
  ambience.set(true);
  const ctx = contexts[0];
  const quiet = { walking: false, rain: false };
  const pulses = (): number => toneCount(ctx, "sine", 42); // the pulse's 64 -> 42 Hz drop (the door's thunk ends on 44)
  ambience.update(frame({ ...quiet, club: 30 }));
  assert.equal(pulses(), 0, "out of range");
  ctx.currentTime = 0.2; ambience.update(frame({ ...quiet, club: 3, time: 0.2 }));
  assert.equal(pulses(), 1, "a thump by the door");
  for (const t of [0.4, 1, 1.6, 2.2]) { ctx.currentTime = t; ambience.update(frame({ ...quiet, club: 3, time: t })); }
  assert.equal(pulses(), 1, "nothing faster than 0.4 Hz");
  ctx.currentTime = 2.6; ambience.update(frame({ ...quiet, club: 3, time: 2.6 }));
  assert.equal(pulses(), 2, "the next beat");
  ctx.currentTime = 3; ambience.update(frame({ ...quiet, interior: true, venue: "nightclub", club: Infinity, time: 3 }));
  ctx.currentTime = 5.3; ambience.update(frame({ ...quiet, interior: true, venue: "nightclub", club: Infinity, time: 5.3 }));
  assert.equal(pulses(), 3, "and inside");
  ambience.destroy();
});

test("a foghorn sounds near the harbour, never twice within FOGHORN_GAP, and never inland", () => {
  const { ambience, contexts } = harness();
  ambience.set(true);
  const ctx = contexts[0];
  const horns = (): number => toneCount(ctx, "triangle", 85);
  const quay = (t: number): AmbienceFrame => frame({ x: 40, z: -790, walking: false, rain: false, time: t });
  ambience.update(quay(0));
  assert.equal(horns(), 0, "not straight away");
  ctx.currentTime = 76; ambience.update(quay(76));
  assert.equal(horns(), 1);
  ctx.currentTime = 76 + 89; ambience.update(quay(76 + 89));
  assert.equal(horns(), 1, "at least 90 s apart");
  ctx.currentTime = 76 + 211; ambience.update(quay(76 + 211));
  assert.equal(horns(), 2);
  ctx.currentTime = 1000; ambience.update(frame({ walking: false, rain: false, time: 1000 }));
  assert.equal(horns(), 2, "not inland");
  ambience.destroy();
});
