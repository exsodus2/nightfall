/**
 * Interior room tones: one subtle synthesized bed plus sparse one-shots for each ground-floor kind
 * (interiors.ts GroundFloorKind). Pure Web Audio, no assets. Used by ambience.ts, which owns the
 * context, the master bus and the on/off setting.
 *
 * Cost model: a room's nodes are created lazily on first entry, faded in and out (about 1 s) as the
 * listener moves between rooms, and stopped and disconnected a few seconds after it goes silent, so
 * at most the current room (plus one still fading out) exists. Every bed pulses at or under 0.4 Hz
 * (the comfort rule) and every one-shot is separated by seconds. The random stream is seeded from the
 * venue id (or just the kind), so a room sounds the same on revisit.
 */

type Rng = () => number;

/** Seconds a faded-out room keeps its nodes before they are torn down. */
const TEARDOWN_AFTER = 3;
/** Fade time constant: 95% of the way in about 0.9 s. */
const FADE = 0.3;
const MAX_ONE_SHOTS = 6;
const SCHEDULE_AHEAD = 0.25;

export const ROOM_KINDS = [
  "lobby", "capsule-hotel", "corp-lobby", "arcade", "pawnshop", "machine-shop", "server-hall",
  "shrine", "hydroponics", "laundromat", "market-hall", "chandlery", "apartment", "garage",
  // Upper-floor variants without a ground-floor twin (upper-floors.ts UpperVariant).
  "penthouse", "sky-bar", "plant-deck",
] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export const isRoomKind = (kind: string | null | undefined): kind is RoomKind => !!kind && (ROOM_KINDS as readonly string[]).includes(kind);

/** Upper-floor variant (upper-floors.ts UpperVariant) to the tone it plays. */
const VARIANT_TONE: Readonly<Record<string, RoomKind>> = {
  apartments: "apartment", offices: "corp-lobby", pods: "capsule-hotel", servers: "server-hall",
  penthouse: "penthouse", "sky-bar": "sky-bar", "plant-deck": "plant-deck",
};
/** Same mapping upper-floors.ts uses for a building's middle floors, by ground-floor kind. */
const MIDDLE_TONE: Readonly<Record<string, RoomKind>> = {
  lobby: "apartment", apartment: "apartment", "corp-lobby": "corp-lobby", "capsule-hotel": "capsule-hotel", "server-hall": "server-hall",
};
/** Variants open to the sky: the room bed is lowered and the street comes back (ambience-mix.ts). */
export const isOpenAirVariant = (variant: string | null | undefined): boolean => variant === "sky-bar" || variant === "plant-deck";

/**
 * The tone for where the listener is. Upper floors (floor >= 2, or an id ending `-f<k>`) use their
 * variant when the engine passes it; without one they fall back to the middle-floor mapping for the
 * ground kind (a top floor's variant is seeded in upper-floors.ts, so it needs the engine to say).
 */
export function roomToneKind(venue: string | null | undefined, variant: string | null | undefined, venueId: string | null | undefined, floor: number | null | undefined): string | null {
  if (!venue) return null;
  if (variant && VARIANT_TONE[variant]) return VARIANT_TONE[variant];
  const upper = (floor !== null && floor !== undefined && floor >= 2) || /-f\d+$/.test(venueId ?? "");
  return upper ? MIDDLE_TONE[venue] ?? venue : venue;
}

/** FNV-1a string hash into a mulberry32 stream. */
export function seededRandom(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Builder {
  gain(value?: number): GainNode;
  filter(type: BiquadFilterType, frequency: number, q?: number): BiquadFilterNode;
  osc(type: OscillatorType, frequency: number): OscillatorNode;
  loop(rate?: number): AudioBufferSourceNode;
  /** A sine modulator at `rate` Hz (0.4 or less), swinging `param` by +-`depth`. */
  lfo(rate: number, depth: number, param: AudioParam): void;
  chain(...links: AudioNode[]): void;
  out: GainNode;
}
interface Player {
  tone(type: OscillatorType, from: number, to: number, when: number, level: number, attack: number, decay: number): void;
  burst(type: BiquadFilterType, from: number, to: number, q: number, when: number, level: number, attack: number, decay: number): void;
}
interface EventSpec { gap: readonly [number, number]; play(p: Player, rng: Rng, when: number): void }
interface Recipe { bed(b: Builder, rng: Rng): void; events: readonly EventSpec[] }

function pick<T>(rng: Rng, list: readonly T[]): T { return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]; }

/** A murmur bed: formant-filtered noise with two slow swells (no syllable-rate pulsing). */
function murmur(b: Builder, level: number, f1: number, f2: number, rate = 0.9, ceiling = 4000): void {
  const src = b.loop(rate), a = b.filter("bandpass", f1, 4), c = b.filter("bandpass", f2, 6), top = b.filter("lowpass", ceiling);
  const swell = b.gain(level);
  src.connect(a); src.connect(c); a.connect(top); c.connect(top);
  b.chain(top, swell, b.out);
  b.lfo(0.31, level * 0.4, swell.gain); b.lfo(0.17, level * 0.25, swell.gain);
}
/** A steady low hum: a sine and a filtered saw an octave up. */
function hum(b: Builder, hz: number, level: number, cutoff = 220): void {
  const tone = b.filter("lowpass", cutoff, 1.2), g = b.gain(level);
  b.osc("sine", hz).connect(tone); b.osc("sawtooth", hz * 2).connect(tone);
  b.chain(tone, g, b.out);
}
/** Low-passed noise, optionally breathing slowly. */
function air(b: Builder, level: number, cutoff: number, rate = 0.5, breath = 0, breathHz = 0.2): void {
  const g = b.gain(level);
  b.chain(b.loop(rate), b.filter("lowpass", cutoff), g, b.out);
  if (breath > 0) b.lfo(breathHz, level * breath, g.gain);
}

const RECIPES: Readonly<Record<RoomKind, Recipe>> = {
  // Cabinet hum with an attract-mode bleep phrase every so often (square voice, pentatonic, seeded).
  arcade: {
    bed(b) { hum(b, 60, 0.011, 260); air(b, 0.004, 900); },
    events: [
      { gap: [6, 14], play(p, rng, when) {
        const root = pick(rng, [392, 440, 523.25]), steps = [1, 1.125, 1.25, 1.5, 1.875, 2];
        const n = 3 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) { const f = root * pick(rng, steps); p.tone("square", f, f, when + i * 0.09, 0.009, 0.004, 0.07); }
      } },
      { gap: [18, 40], play(p, _rng, when) { p.tone("square", 988, 988, when, 0.008, 0.003, 0.06); p.tone("square", 1319, 1319, when + 0.07, 0.008, 0.003, 0.2); } },
    ],
  },
  // A drum turning (low noise swelling at 0.33 Hz) with water in it.
  laundromat: {
    bed(b) {
      const drum = b.gain(0.026);
      b.chain(b.loop(0.35), b.filter("lowpass", 190), drum, b.out);
      b.lfo(0.33, 0.012, drum.gain);
      const water = b.gain(0.006);
      b.chain(b.loop(0.6), b.filter("bandpass", 520, 1.2), water, b.out);
      b.lfo(0.21, 0.004, water.gain);
      hum(b, 50, 0.006, 160);
    },
    events: [
      { gap: [8, 18], play(p, _rng, when) { p.burst("bandpass", 800, 300, 1.4, when, 0.012, 0.5, 1.2); } },
      { gap: [20, 42], play(p, _rng, when) { p.tone("sine", 82, 50, when, 0.02, 0.005, 0.25); p.burst("lowpass", 400, 150, 0.7, when, 0.015, 0.004, 0.15); } },
    ],
  },
  // Fan whoosh, a faint high whine, and the odd drive tick.
  "server-hall": {
    bed(b, rng) {
      const fans = b.gain(0.028), tone = b.filter("bandpass", 900, 0.5);
      b.chain(b.loop(0.8), b.filter("highpass", 200), tone, fans, b.out);
      b.lfo(0.11, 500, tone.frequency); b.lfo(0.07, 0.006, fans.gain);
      const hiss = b.gain(0.005);
      b.chain(b.loop(1.2), b.filter("bandpass", 3200, 0.6), hiss, b.out);
      // Kept under 8 kHz and about 6 dB down: the old 7-10 kHz whine was fatiguing.
      const whine = b.gain(0.0006);
      b.osc("sine", 5800 + rng() * 700).connect(whine); b.osc("sine", 7000 + rng() * 700).connect(whine);
      whine.connect(b.out);
      hum(b, 100, 0.005, 300);
    },
    events: [{ gap: [5, 14], play(p, _rng, when) { p.burst("highpass", 2800, 2800, 0.7, when, 0.007, 0.002, 0.012); } }],
  },
  // A roof bar: soft murmur under wind, the odd glass clink.
  "sky-bar": {
    bed(b) { murmur(b, 0.01, 600, 1500, 0.9, 3200); air(b, 0.01, 700, 0.6, 0.5, 0.15); },
    events: [{ gap: [9, 22], play(p, rng, when) { const f = pick(rng, [2349, 2637, 3136]); p.tone("sine", f, f, when, 0.005, 0.002, 0.3); p.tone("sine", f * 1.51, f * 1.51, when, 0.002, 0.002, 0.18); } }],
  },
  // Wind over a plant roof with faint pumps and the odd gurgle in a tank.
  "plant-deck": {
    bed(b) {
      air(b, 0.014, 600, 0.6, 0.4, 0.12);
      hum(b, 70, 0.007, 240);
      const pump = b.gain(0.004);
      b.chain(b.loop(0.4), b.filter("lowpass", 160), pump, b.out); b.lfo(0.22, 0.003, pump.gain);
    },
    events: [{ gap: [12, 30], play(p, _rng, when) { p.burst("bandpass", 320, 200, 1.5, when, 0.008, 0.2, 0.8); } }],
  },
  // Quiet, airy, deep-pile silence with a slow chord.
  penthouse: {
    bed(b) {
      const tone = b.filter("lowpass", 700, 0.6), g = b.gain(0.004);
      for (const f of [196, 293.7, 392.5]) b.osc("sine", f).connect(tone);
      b.chain(tone, g, b.out); b.lfo(0.1, 0.0015, g.gain);
      air(b, 0.004, 900, 0.7, 0.3, 0.1);
    },
    events: [],
  },
  // A low drone (root, fifth, octave) and a soft bell, struck rarely.
  shrine: {
    bed(b, rng) {
      const root = 49 + rng() * 6, tone = b.filter("lowpass", 420, 0.8), g = b.gain(0.016);
      for (const [mult, detune, lvl] of [[1, 0, 1], [1.5, 0.35, 0.55], [2, -0.3, 0.4], [3.01, 0.2, 0.15]] as const) {
        const o = b.osc("sine", root * mult + detune), og = b.gain(lvl); o.connect(og); og.connect(tone);
      }
      b.chain(tone, g, b.out); b.lfo(0.09, 0.005, g.gain);
      air(b, 0.004, 500);
    },
    events: [{ gap: [14, 32], play(p, rng, when) {
      const f = pick(rng, [392, 523.25, 659.25]);
      p.tone("sine", f, f * 0.998, when, 0.02, 0.004, 3.4); p.tone("sine", f * 2.76, f * 2.75, when, 0.006, 0.003, 1.6); p.tone("sine", f * 4.1, f * 4.08, when, 0.002, 0.003, 0.8);
    } }],
  },
  // A pump's hum, a thin trickle, and sparse drips.
  hydroponics: {
    bed(b) {
      hum(b, 90, 0.011, 400);
      const trickle = b.gain(0.006);
      b.chain(b.loop(1), b.filter("highpass", 2500), b.filter("lowpass", 6000), trickle, b.out);
      b.lfo(0.37, 0.003, trickle.gain);
      const gurgle = b.gain(0.008);
      b.chain(b.loop(0.5), b.filter("bandpass", 420, 2), gurgle, b.out);
      b.lfo(0.23, 0.005, gurgle.gain);
    },
    events: [{ gap: [2.5, 6], play(p, rng, when) { const f = 1400 + rng() * 1400; p.tone("sine", f, f * 0.55, when, 0.012, 0.002, 0.08); } }],
  },
  // A compressor cycling in the next bay and the odd clank (a machine shop rings brighter).
  "machine-shop": { bed: compressorBed(52, 0.014), events: clankEvents(2400, 640, false) },
  garage: { bed: compressorBed(44, 0.016), events: clankEvents(1700, 420, true) },
  // Air conditioning, very quiet; once in a long while, a muffled thud through the wall.
  "capsule-hotel": {
    bed(b) { air(b, 0.012, 420, 0.5, 0.2, 0.13); b.osc("sine", 50).connect(tinyGain(b, 0.004)); },
    events: [{ gap: [30, 70], play(p, _rng, when) { p.tone("sine", 90, 55, when, 0.008, 0.01, 0.18); p.burst("lowpass", 300, 120, 0.7, when, 0.006, 0.01, 0.12); } }],
  },
  // Airy, slow chord tone and noise through a soft band; a distant lift chime now and then.
  "corp-lobby": {
    bed(b) {
      const tone = b.filter("lowpass", 900, 0.6), g = b.gain(0.006);
      for (const f of [220, 329.6, 440.4]) { b.osc("sine", f).connect(tone); }
      b.chain(tone, g, b.out); b.lfo(0.12, 0.002, g.gain);
      const wash = b.gain(0.006);
      b.chain(b.loop(0.7), b.filter("bandpass", 1200, 0.3), wash, b.out); b.lfo(0.08, 0.002, wash.gain);
    },
    events: [{ gap: [25, 55], play(p, _rng, when) { p.tone("sine", 1318.5, 1318.5, when, 0.014, 0.005, 1.3); p.tone("sine", 1046.5, 1046.5, when + 0.3, 0.014, 0.005, 1.6); } }],
  },
  // Murmur beds with creaks. Market-hall: a busier, brighter crowd. Pawnshop: thin murmur and a neon buzz. Chandlery: murmur and slow water.
  "market-hall": { bed(b) { murmur(b, 0.022, 700, 1700, 1, 4500); }, events: creaks(0.012, 12, 28) },
  pawnshop: { bed(b) { murmur(b, 0.011, 560, 1400); b.osc("sine", 120).connect(tinyGain(b, 0.0025)); }, events: creaks(0.016, 8, 20) },
  chandlery: { bed(b) { murmur(b, 0.008, 500, 1200); air(b, 0.01, 320, 0.7, 0.5, 0.17); }, events: creaks(0.02, 7, 18) },
  // A fridge humming over a distant television. Apartments creak a floorboard; a lobby gets a far lift ding.
  apartment: { bed: homeBed, events: creaks(0.012, 15, 35) },
  lobby: {
    bed: homeBed,
    events: [{ gap: [30, 60], play(p, _rng, when) { p.tone("sine", 1318.5, 1318.5, when, 0.008, 0.005, 1.1); p.tone("sine", 1046.5, 1046.5, when + 0.28, 0.008, 0.005, 1.3); } }],
  },
};

function tinyGain(b: Builder, level: number): GainNode { const g = b.gain(level); g.connect(b.out); return g; }

function compressorBed(hz: number, level: number): (b: Builder) => void {
  return (b) => {
    const tone = b.filter("lowpass", 170, 1), g = b.gain(level);
    b.osc("sawtooth", hz).connect(tone); b.osc("sine", hz / 2).connect(tone);
    b.chain(tone, g, b.out); b.lfo(0.22, level * 0.35, g.gain);
    air(b, 0.011, 320, 0.5, 0.4, 0.17);
  };
}
function clankEvents(ring: number, pitch: number, wrench: boolean): readonly EventSpec[] {
  const clank = (p: Player, when: number, level: number): void => {
    p.burst("bandpass", ring, ring * 0.75, 8, when, level, 0.002, 0.35);
    p.tone("triangle", pitch, pitch * 0.94, when, level * 0.8, 0.002, 0.45);
  };
  const list: EventSpec[] = [{ gap: [9, 25], play(p, rng, when) { clank(p, when, 0.016); if (wrench && rng() < 0.4) clank(p, when + 0.31, 0.006); } }];
  if (wrench) list.push({ gap: [20, 40], play(p, _rng, when) { p.burst("highpass", 4200, 3500, 0.7, when, 0.012, 0.01, 0.25); } });
  return list;
}
function creaks(level: number, min: number, max: number): readonly EventSpec[] {
  return [{ gap: [min, max], play(p, rng, when) { const f = 300 + rng() * 200; p.burst("bandpass", f * 1.3, f * 0.8, 12, when, level, 0.15, 0.5); } }];
}
function homeBed(b: Builder): void {
  hum(b, 50, 0.011, 200);
  murmur(b, 0.005, 650, 1500, 0.8, 1800);
}

interface Room {
  kind: RoomKind;
  key: string;
  out: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  rng: Rng;
  next: number[];
  leftAt: number;
  /** The level last scheduled on `out` (NaN: nothing yet), so automation is only added on a change. */
  level: number;
}

export interface RoomTones {
  /** Re-target from the tone the listener is in (null: none); `id` seeds it (place id, plus floor when known); `level` (0..1, default 1) scales the bed (lower on an open roof). */
  update(kind: string | null | undefined, id: string | null | undefined, now: number, level?: number): void;
  /** Tear everything down (sound off, destroy). */
  dispose(): void;
  /** Live rooms and the audio nodes they hold, for diagnostics. */
  stats(): { rooms: number; nodes: number };
}

export function createRoomTones(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer): RoomTones {
  const rooms = new Map<string, Room>();
  let shots = 0;
  /** Bumped by dispose(): a late onended from a disposed room's one-shots must not decrement the next room's count. */
  let generation = 0;

  function build(kind: RoomKind, key: string, now: number): Room {
    const out = ctx.createGain(); out.gain.value = 0; out.connect(dest);
    const room: Room = { kind, key, out, sources: [], nodes: [out], rng: seededRandom(key), next: [], leftAt: Infinity, level: Number.NaN };
    const track = <T extends AudioNode>(node: T): T => { room.nodes.push(node); return node; };
    const builder: Builder = {
      out,
      gain: (value = 0) => { const g = track(ctx.createGain()); g.gain.value = value; return g; },
      filter: (type, frequency, q = 0.7) => { const f = track(ctx.createBiquadFilter()); f.type = type; f.frequency.value = frequency; f.Q.value = q; return f; },
      osc: (type, frequency) => { const o = track(ctx.createOscillator()); o.type = type; o.frequency.value = frequency; o.start(); room.sources.push(o); return o; },
      loop: (rate = 1) => {
        const s = track(ctx.createBufferSource()); s.buffer = noise; s.loop = true; s.playbackRate.value = rate;
        s.start(0, room.rng() * noise.duration * 0.9); room.sources.push(s); return s;
      },
      lfo(rate, depth, param) { const l = this.osc("sine", Math.min(0.4, rate)), amount = this.gain(depth); l.connect(amount); amount.connect(param); },
      chain: (...links) => { for (let i = 0; i < links.length - 1; i++) links[i].connect(links[i + 1]); },
    };
    const recipe = RECIPES[kind];
    recipe.bed(builder, room.rng);
    room.next = recipe.events.map((spec) => now + 2 + room.rng() * spec.gap[1] * 0.6);
    return room;
  }

  function oneShot(room: Room, make: (out: GainNode) => AudioScheduledSourceNode[], when: number, level: number, attack: number, decay: number): void {
    if (shots >= MAX_ONE_SHOTS) return;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(level, when + attack);
    env.gain.setTargetAtTime(0, when + attack, Math.max(0.005, decay / 4));
    env.connect(room.out);
    const sources = make(env), end = when + attack + decay * 1.3 + 0.05;
    shots += 1;
    const born = generation;
    let ended = false;
    for (const s of sources) {
      s.stop(end);
      s.onended = () => { if (ended) return; ended = true; if (born === generation) shots = Math.max(0, shots - 1); env.disconnect(); for (const x of sources) x.disconnect(); };
    }
  }
  function playerFor(room: Room): Player {
    return {
      tone(type, from, to, when, level, attack, decay) {
        oneShot(room, (out) => {
          const o = ctx.createOscillator(); o.type = type;
          o.frequency.setValueAtTime(from, when);
          if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), when + attack + decay);
          o.connect(out); o.start(when); return [o];
        }, when, level, attack, decay);
      },
      burst(type, from, to, q, when, level, attack, decay) {
        oneShot(room, (out) => {
          const s = ctx.createBufferSource(); s.buffer = noise; s.loop = attack + decay > 0.4;
          const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
          f.frequency.setValueAtTime(from, when);
          if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), when + attack + decay);
          s.connect(f); f.connect(out); s.start(when, room.rng() * 1.5); return [s];
        }, when, level, attack, decay);
      },
    };
  }

  function teardown(room: Room): void {
    for (const s of room.sources) { try { s.stop(); } catch { /* already stopped */ } }
    for (const n of room.nodes) n.disconnect();
    rooms.delete(room.key);
  }

  return {
    update(kind, id, now, level = 1) {
      const target = isRoomKind(kind) ? kind : null;
      const key = target ? `${target}:${id ?? ""}` : "";
      for (const room of rooms.values()) {
        if (room.key === key) continue;
        if (room.leftAt === Infinity) { room.leftAt = now; room.level = 0; room.out.gain.setTargetAtTime(0, now, FADE); }
        else if (now - room.leftAt > TEARDOWN_AFTER) teardown(room);
      }
      if (!target) return;
      let room = rooms.get(key);
      if (!room) { room = build(target, key, now); rooms.set(key, room); }
      room.leftAt = Infinity;
      const want = Math.max(0, Math.min(1, level));
      if (room.level !== want) { room.level = want; room.out.gain.setTargetAtTime(want, now, FADE); }
      const specs = RECIPES[target].events, player = playerFor(room);
      for (let i = 0; i < specs.length; i++) {
        if (now < room.next[i] - SCHEDULE_AHEAD) continue;
        const when = Math.max(now + 0.02, room.next[i]);
        specs[i].play(player, room.rng, when);
        const [min, max] = specs[i].gap;
        room.next[i] = Math.max(now, when) + min + room.rng() * (max - min);
      }
    },
    dispose() { for (const room of [...rooms.values()]) teardown(room); generation += 1; shots = 0; },
    stats() { let nodes = 0; for (const room of rooms.values()) nodes += room.nodes.length; return { rooms: rooms.size, nodes }; },
  };
}
