/**
 * Procedural city ambience: a layered soundscape synthesized from Web Audio primitives (looped
 * noise, filters, oscillators and envelopes), no downloaded audio and no dependency.
 *
 * The graph is built once, on the first set(true) (always from a player's click, tap or key, so
 * Safari and Chrome allow it), and never before. Continuous layers run at zero gain until the mix
 * calls for them; update() only re-targets their parameters (setTargetAtTime), about six times a
 * second from the engine's HUD snapshot, and schedules short one-shots (footsteps, drips, a car
 * whoosh) slightly ahead on the audio clock. set(false) fades out and suspends the context, so a
 * paused or hidden game costs no audio CPU. The pure rules live in ambience-mix.ts.
 *
 *   rain bed ── outdoor bus ── muffle (low-pass when inside a venue) ──┐
 *   hum, traffic wash, Foundry rumble / furnace, Neon buzz, voices,    ├── master (on/off, radio duck) ── out
 *   Ghost static, insects, sizzle, water, passing train ──────────────┘
 *   engine, boost, carriage rumble, room tone ────────── master
 *   footsteps, doors, lift ding, pickups ── master + a small delay-network room (wetter indoors)
 *   The Static: pulse, synth pad, crowd ── club bus ── club low-pass (bass only through the wall) ── master
 *
 * Inside a venue, room-tones.ts adds a per-kind bed and sparse one-shots (arcade bleeps, shrine bell, ...) to the master.
 * The harbour swell, wind and city-event beds sit on the outdoor bus with the district layers. Every
 * pulsing thing stays at or under 0.4 Hz (the club's thump, the march's chant), the comfort rule.
 */
import {
  CHANT_HZ, CLUB_BEAT, FOGHORN_NEAR, ambienceEdges, ambienceLevels, ambienceOpenAir, ambienceRates, carPass, clamp01, eventCues, foghornGap, harbourNear,
  poissonCount, stepInterval, stepSurface, type AmbienceFrame, type AmbienceLevels, type CarTrack, type StepSurface,
} from "./ambience-mix.ts";
import { createRoomTones, roomToneKind, type RoomTones } from "./room-tones.ts";
import { takeTramBell } from "../city/tram.ts";

export type { AmbienceFrame } from "./ambience-mix.ts";
export type AmbienceEvent =
  | "lift" | "door" | "pickup" | "whoosh" | "squeal" | "step" | "drip" | "chirp" | "gull" | "clack"
  | "rumble" | "foghorn" | "hush" | "thump" | "pulse" | "bell";

export interface Ambience {
  /** On / off (setting, pause, hidden tab). The first set(true) builds the graph: call it from a user gesture. */
  set(enabled: boolean): void;
  /** Radio ducking: 1 normal, e.g. 0.4 while the in-game radio plays. */
  duck(level: number): void;
  /** Re-target the mix from the listener's state; a no-op until the ambience has been switched on. */
  update(frame: AmbienceFrame): void;
  /** A one-shot cue (lift ding, door, pickup, ...); ignored while off. */
  event(kind: AmbienceEvent): void;
  destroy(): void;
  /** Diagnostics for checks: whether the graph exists and how many nodes it holds. */
  stats(): { built: boolean; running: boolean; nodes: number; voices: number };
}

export interface AmbienceOptions {
  /** Context factory (tests and offline checks); defaults to a live AudioContext. */
  context?: () => BaseAudioContext;
  random?: () => number;
}

/** Continuous layers whose gains / tones follow AmbienceLevels. */
type LayerParams = { [K in keyof AmbienceLevels]: AudioParam };

interface Graph {
  ctx: BaseAudioContext;
  master: GainNode;
  outdoor: GainNode;
  near: GainNode;
  send: GainNode;
  club: GainNode;
  noise: AudioBuffer;
  rooms: RoomTones;
  params: LayerParams;
  engineBody: AudioParam;
  nodes: number;
}

/** Time constants (seconds) for re-targeting; most layers glide, the car engine follows the pedal. */
const GLIDE: Partial<Record<keyof AmbienceLevels, number>> = { engine: 0.08, enginePitch: 0.08, engineTone: 0.08, boost: 0.1, train: 0.25, trainTone: 0.25, outdoor: 0.25, muffle: 0.25, carriage: 0.4 };
/** Overall level: the full mix sits a little under the old single rain bed plus street colour. */
export const AMBIENCE_VOLUME = 0.6;
const MAX_VOICES = 24;
const SCHEDULE_AHEAD = 0.25;

type LiveContext = BaseAudioContext & Pick<AudioContext, "resume" | "suspend" | "close">;
const isLive = (ctx: BaseAudioContext): ctx is LiveContext => typeof (ctx as Partial<AudioContext>).close === "function" && typeof (ctx as Partial<AudioContext>).suspend === "function";

function defaultContext(): BaseAudioContext | null {
  if (typeof window === "undefined") return null;
  const Constructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Constructor ? new Constructor() : null;
}

export function createAmbience(options: AmbienceOptions = {}): Ambience {
  const random = options.random ?? Math.random;
  let graph: Graph | null = null;
  let on = false;
  let destroyed = false;
  let duckLevel = 1;
  let previous: AmbienceFrame | null = null;
  let lastTick = -1;
  let nextStep = 0;
  let nextClack = 0;
  let nextPulse = 0;
  /** Audio-clock time of the next foghorn (0: not yet scheduled); always FOGHORN_GAP or more after the last. */
  let nextHorn = 0;
  let surface: StepSurface = "dry";
  let car: CarTrack | null = null;
  let voices = 0;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;

  function build(): Graph | null {
    let ctx: BaseAudioContext | null;
    try { ctx = options.context ? options.context() : defaultContext(); } catch { return null; }
    if (!ctx) return null;
    let nodes = 0;
    const count = <T extends AudioNode>(node: T): T => { nodes += 1; return node; };
    const gain = (value = 0): GainNode => { const node = count(ctx.createGain()); node.gain.value = value; return node; };
    const filter = (type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode => {
      const node = count(ctx.createBiquadFilter()); node.type = type; node.frequency.value = frequency; node.Q.value = q; return node;
    };
    const osc = (type: OscillatorType, frequency: number): OscillatorNode => {
      const node = count(ctx.createOscillator()); node.type = type; node.frequency.value = frequency; node.start(); return node;
    };
    // Two seconds of white noise feeds every noise layer (each loop starts at its own offset and rate).
    const rate = ctx.sampleRate;
    const noise = ctx.createBuffer(1, rate * 2, rate);
    const white = noise.getChannelData(0);
    for (let i = 0; i < white.length; i++) white[i] = random() * 2 - 1;
    // Sparse clicks for Ghost Circuit static (a dead channel crackling).
    const crackle = ctx.createBuffer(1, rate * 2, rate);
    const clicks = crackle.getChannelData(0);
    for (let i = 0; i < clicks.length; i++) if (random() < 0.0016) clicks[i] = (random() * 2 - 1) * (0.4 + random() * 0.6);
    const loop = (buffer: AudioBuffer, playbackRate = 1): AudioBufferSourceNode => {
      const node = count(ctx.createBufferSource()); node.buffer = buffer; node.loop = true; node.playbackRate.value = playbackRate;
      node.start(0, random() * buffer.duration * 0.9); return node;
    };
    /** Tremolo: `node` passes at `base` gain, swung by +-`depth` from `lfo`. */
    const tremolo = (lfo: AudioNode, base: number, depth: number): { node: GainNode; depth: GainNode } => {
      const node = gain(base), amount = gain(depth); lfo.connect(amount); amount.connect(node.gain); return { node, depth: amount };
    };
    const chain = (...links: AudioNode[]): void => { for (let i = 0; i < links.length - 1; i++) links[i].connect(links[i + 1]); };

    const master = gain(0);
    master.connect(ctx.destination);
    const muffle = filter("lowpass", 18000, 0.5);
    const outdoor = gain(1);
    chain(outdoor, muffle, master);
    // A small room: two cross-fed delays through a low-pass (cheaper than a convolver).
    const send = gain(0.12), roomIn = filter("lowpass", 2600), wet = gain(0.45);
    const d1 = count(ctx.createDelay(0.2)), d2 = count(ctx.createDelay(0.2));
    d1.delayTime.value = 0.037; d2.delayTime.value = 0.053;
    const f1 = gain(0.42), f2 = gain(0.38);
    chain(send, roomIn); roomIn.connect(d1); roomIn.connect(d2);
    chain(d1, f1, d2); chain(d2, f2, d1);
    d1.connect(wet); d2.connect(wet); wet.connect(master);
    const near = gain(1);
    near.connect(master); near.connect(send);

    // Slow and fast modulators shared by the layers.
    const lfoA = osc("sine", 0.07), lfoB = osc("sine", 0.19), lfoC = osc("sine", 0.41), syllable = osc("sine", 3.7), chirr = osc("square", 22);

    // Rain bed: band-limited noise whose brightness follows the storm.
    const rain = gain(), rainTone = filter("lowpass", 2000, 0.6);
    chain(loop(noise), filter("highpass", 300), rainTone, rain, outdoor);
    // City hum: a transformer drone (mains fundamental and harmonic through a resonant low-pass).
    const hum = gain(), humTone = filter("lowpass", 240, 5);
    osc("sawtooth", 55).connect(humTone); osc("sine", 110).connect(humTone);
    chain(humTone, hum, outdoor);
    // Distant traffic wash: low noise swelling slowly.
    const traffic = gain(), wash = tremolo(lfoA, 0.65, 0.35);
    chain(loop(noise, 0.5), filter("lowpass", 260), wash.node, traffic, outdoor);
    // Foundry: a sub-rumble near the furnaces and a breathing furnace roar inside the district.
    const rumble = gain();
    osc("sine", 36).connect(rumble); chain(loop(noise, 0.4), filter("lowpass", 90), rumble); rumble.connect(outdoor);
    const furnace = gain(), roar = tremolo(lfoC, 0.6, 0.4);
    chain(loop(noise, 0.8), filter("bandpass", 160, 0.8), roar.node, furnace, outdoor);
    // Neon Ward: sign buzz (a high-passed 120 Hz square) and crowd murmur (formant-filtered noise
    // with a syllable-rate tremolo, brighter and choppier in the Silk Market).
    const buzz = gain(), flicker = tremolo(lfoB, 0.8, 0.2);
    chain(osc("square", 120), filter("highpass", 1800, 1.5), flicker.node, buzz, outdoor);
    const voices = gain(), formant1 = filter("bandpass", 600, 4), formant2 = filter("bandpass", 1500, 6), talk = tremolo(syllable, 0.6, 0.3);
    const crowd = loop(noise, 0.9);
    crowd.connect(formant1); crowd.connect(formant2);
    formant1.connect(talk.node); formant2.connect(talk.node); chain(talk.node, voices, outdoor);
    // Ghost Circuit: crackling static over a thin hiss.
    const staticGain = gain();
    chain(loop(crackle), filter("bandpass", 2600, 1), staticGain);
    const hiss = gain(0.25); chain(loop(noise, 1.1), filter("highpass", 5000), hiss, staticGain);
    staticGain.connect(outdoor);
    // Rain Gardens: insects (a high tone chopped at 22 Hz).
    const insects = gain(), chop = tremolo(chirr, 0.5, 0.5);
    chain(osc("sine", 4300), chop.node, insects, outdoor);
    // Silk Market stall sizzle: bright noise swelling.
    const sizzle = gain(), fry = tremolo(lfoB, 0.55, 0.45);
    chain(loop(noise, 1.3), filter("highpass", 4500), fry.node, sizzle, outdoor);
    // Spillway water lapping (low noise with a slosh band, slowly rocking).
    const water = gain(), lap = tremolo(lfoB, 0.55, 0.45);
    const waterSource = loop(noise, 0.7), waterLow = filter("lowpass", 420), slosh = filter("bandpass", 900, 2);
    waterSource.connect(waterLow); waterSource.connect(slosh); waterLow.connect(lap.node); slosh.connect(lap.node);
    chain(lap.node, water, outdoor);
    // A passing monorail: a broad whoosh band that rises as it nears, plus a faint motor whine.
    const train = gain(), trainTone = filter("bandpass", 400, 0.9);
    loop(noise, 0.9).connect(trainTone);
    const whine = gain(0.15); chain(osc("sawtooth", 92), whine, trainTone);
    chain(trainTone, train, outdoor);
    // Riding: the carriage's low rumble (rail joints are one-shots).
    const carriage = gain();
    chain(loop(noise, 0.6), filter("lowpass", 150), carriage); osc("sine", 47).connect(carriage);
    carriage.connect(master);
    // The player's car: two detuned oscillators through a pedal-tracking low-pass, and a boost roar.
    const engine = gain(), engineTone = filter("lowpass", 400, 2), cylinder = osc("sawtooth", 40), body = osc("square", 20);
    const bodyLevel = gain(0.5);
    cylinder.connect(engineTone); chain(body, bodyLevel, engineTone); chain(engineTone, engine, master);
    const boost = gain(); chain(loop(noise, 1), filter("bandpass", 900, 0.7), boost, master);
    // Inside a venue: a quiet room tone (the outdoor bus is muffled above).
    const room = gain(); chain(loop(noise, 0.3), filter("lowpass", 200), room); osc("sine", 60).connect(room); room.connect(master);

    // Harbour swell: low wash and a slap band against the flood wall, rising and falling over 7-10 s
    // (two slow LFOs, 7.7 s and 9.5 s, summed into one depth so the swells never repeat exactly).
    const swellA = osc("sine", 0.13), swellB = osc("sine", 0.105);
    const swell = gain(), heave = tremolo(swellA, 0.5, 0.25);
    swellB.connect(heave.depth);
    const sea = loop(noise, 0.55), seaLow = filter("lowpass", 340), seaSlap = filter("bandpass", 720, 1.6);
    sea.connect(seaLow); sea.connect(seaSlap); seaLow.connect(heave.node); seaSlap.connect(heave.node);
    chain(heave.node, swell, outdoor);
    // Wind: a broad noise band whose level and centre follow the gusts (strongest on the rim and the Rim Line deck).
    const wind = gain(), windTone = filter("bandpass", 380, 0.6);
    chain(loop(noise, 0.45), windTone, wind, outdoor);
    // City events (city-events.ts), each a soft bed near its site. Substation: a 100 Hz transformer
    // buzz and spitting sparks.
    const transformer = gain(); chain(osc("sawtooth", 100), filter("bandpass", 300, 1.4), transformer, outdoor);
    const sparks = gain(), spit = tremolo(lfoC, 0.5, 0.5); chain(loop(crackle, 1.7), filter("highpass", 1800), spit.node, sparks, outdoor);
    // Drone show: a hovering swarm, a chorus of slightly detuned sines (beating well under 1 Hz).
    const drones = gain(), hover = tremolo(lfoA, 0.16, 0.05);
    for (const f of [196, 196.45, 293.7, 294, 392.3]) osc("sine", f).connect(hover.node);
    chain(hover.node, drones, outdoor);
    // Rent march: the crowd formants again, swelling with a slow chant (CHANT_HZ, under 0.4 Hz).
    const march = gain(), chant = tremolo(osc("sine", CHANT_HZ), 0.55, 0.45);
    chain(talk.node, chant.node, march, outdoor);
    // CorpSec checkpoint: radio chatter, a telephone band burbling at 5 Hz and keyed on and off slowly.
    const chatter = gain(), squelch = tremolo(osc("sine", 5.3), 0.5, 0.5), keyed = tremolo(lfoB, 0.5, 0.5);
    chain(loop(noise, 1.05), filter("bandpass", 1700, 4), squelch.node, keyed.node, chatter, outdoor);
    // Harbour flares: a distant hiss, loudest while a flare climbs.
    const flareHiss = gain(); chain(loop(noise, 1.2), filter("highpass", 2600), filter("lowpass", 7000), flareHiss, outdoor);
    // The Static: a club bus through its own low-pass (outside only the bass leaks through the wall)
    // carrying the slow pulse (one-shots), a synth pad under a slow filter sweep, and the crowd inside.
    const club = gain(), clubTone = filter("lowpass", 150, 0.8);
    chain(club, clubTone, master);
    const pad = gain(), padTone = filter("lowpass", 520, 3), sweep = gain(260);
    lfoA.connect(sweep); sweep.connect(padTone.frequency); // a 14 s sweep
    for (const f of [110, 110.7, 130.81, 164.81, 165.4]) osc("sawtooth", f).connect(padTone);
    chain(padTone, pad, club);
    const clubCrowd = gain(); chain(talk.node, clubCrowd, club);

    const params: LayerParams = {
      rain: rain.gain, rainTone: rainTone.frequency, hum: hum.gain, traffic: traffic.gain, rumble: rumble.gain, furnace: furnace.gain,
      buzz: buzz.gain, voices: voices.gain, voiceTone: formant1.frequency, voicePulse: talk.depth.gain,
      crackle: staticGain.gain, insects: insects.gain, sizzle: sizzle.gain, water: water.gain,
      carriage: carriage.gain, engine: engine.gain, enginePitch: cylinder.frequency, engineTone: engineTone.frequency, boost: boost.gain,
      train: train.gain, trainTone: trainTone.frequency, outdoor: outdoor.gain, muffle: muffle.frequency, room: room.gain,
      swell: swell.gain, wind: wind.gain, windTone: windTone.frequency,
      transformer: transformer.gain, sparks: sparks.gain, drones: drones.gain, march: march.gain, chatter: chatter.gain, flareHiss: flareHiss.gain,
      club: club.gain, clubTone: clubTone.frequency, clubBed: pad.gain, clubSweep: padTone.frequency, clubCrowd: clubCrowd.gain,
    };
    return { ctx, master, outdoor, near, send, club, noise, rooms: createRoomTones(ctx, master, noise), params, engineBody: body.frequency, nodes };
  }

  /** A one-shot through `dest`; cleans itself up when it ends. */
  function voice(start: (ctx: BaseAudioContext, out: GainNode) => AudioScheduledSourceNode[], dest: AudioNode, when: number, level: number, attack: number, decay: number): void {
    if (!graph || voices >= MAX_VOICES) return;
    const ctx = graph.ctx, out = ctx.createGain();
    out.gain.setValueAtTime(0, when);
    out.gain.linearRampToValueAtTime(level, when + attack);
    out.gain.setTargetAtTime(0, when + attack, Math.max(0.005, decay / 4));
    out.connect(dest);
    const sources = start(ctx, out);
    if (sources.length === 0) { out.disconnect(); return; }
    const end = when + attack + decay * 1.3 + 0.05;
    voices += 1;
    let ended = false;
    for (const source of sources) {
      source.stop(end);
      source.onended = () => { if (ended) return; ended = true; voices = Math.max(0, voices - 1); out.disconnect(); for (const s of sources) s.disconnect(); };
    }
  }
  function tone(type: OscillatorType, from: number, to: number, dest: AudioNode, when: number, level: number, attack: number, decay: number): void {
    voice((ctx, out) => {
      const node = ctx.createOscillator(); node.type = type;
      node.frequency.setValueAtTime(from, when);
      if (to !== from) node.frequency.exponentialRampToValueAtTime(Math.max(1, to), when + attack + decay);
      node.connect(out); node.start(when); return [node];
    }, dest, when, level, attack, decay);
  }
  function burst(type: BiquadFilterType, from: number, to: number, q: number, dest: AudioNode, when: number, level: number, attack: number, decay: number): void {
    voice((ctx, out) => {
      if (!graph) return [];
      const node = ctx.createBufferSource(); node.buffer = graph.noise;
      node.loop = attack + decay > 0.4; // a long swell must not run off the end of the 2 s buffer mid-fade (a click)
      const shape = ctx.createBiquadFilter(); shape.type = type; shape.Q.value = q;
      shape.frequency.setValueAtTime(from, when);
      if (to !== from) shape.frequency.exponentialRampToValueAtTime(Math.max(20, to), when + attack + decay);
      node.connect(shape); shape.connect(out); node.start(when, random() * 1.5); return [node];
    }, dest, when, level, attack, decay);
  }

  function play(kind: AmbienceEvent, when: number): void {
    if (!graph) return;
    const { near, outdoor, master, club } = graph, r = random();
    switch (kind) {
      case "step": {
        // Dry: a soft scuff and heel. Wet: plus a short splash band. Metal (a platform): lighter, with a faint ring.
        const metal = surface === "metal";
        burst("lowpass", metal ? 1500 : 800, metal ? 600 : 300, 0.7, near, when, 0.05 * (0.8 + 0.4 * r) * (metal ? 0.7 : 1), 0.004, 0.09);
        tone("sine", metal ? 120 : 95, metal ? 80 : 60, near, when, metal ? 0.025 : 0.035, 0.004, 0.07);
        if (surface === "wet") burst("bandpass", 2400, 1500, 1.2, near, when + 0.012, 0.016, 0.003, 0.07);
        if (metal) { const f = 410 + r * 40; tone("triangle", f, f * 0.97, near, when + 0.003, 0.008, 0.003, 0.16); }
        break;
      }
      case "rumble": burst("bandpass", 1100, 260, 0.9, outdoor, when, 0.1, 0.4, 1.1); tone("sine", 68, 46, outdoor, when, 0.04, 0.3, 1.2); break;
      case "foghorn": tone("triangle", 87, 85, outdoor, when, 0.03, 1.4, 4.5); tone("triangle", 130.5, 128, outdoor, when + 0.05, 0.015, 1.5, 4.2); tone("sine", 43.5, 43, outdoor, when, 0.03, 1.4, 4.5); break;
      case "hush": burst("lowpass", 1600, 500, 0.5, outdoor, when, 0.045, 1.2, 2.8); break;
      case "thump": tone("sine", 72, 36, outdoor, when, 0.05, 0.02, 0.7); burst("lowpass", 380, 120, 0.7, outdoor, when, 0.035, 0.015, 0.5); break;
      case "pulse": tone("sine", 64, 42, club, when, 0.2, 0.02, 0.45); burst("lowpass", 160, 90, 0.7, club, when, 0.05, 0.01, 0.2); break;
      case "lift": tone("sine", 1318.5, 1318.5, near, when, 0.045, 0.005, 1.1); tone("sine", 1046.5, 1046.5, near, when + 0.28, 0.045, 0.005, 1.4); break;
      case "door": burst("lowpass", 420, 200, 0.7, near, when, 0.11, 0.006, 0.2); tone("sine", 72, 44, near, when, 0.07, 0.005, 0.22); burst("highpass", 3200, 3200, 0.7, near, when + 0.02, 0.025, 0.002, 0.03); break;
      case "pickup": tone("triangle", 880, 880, near, when, 0.03, 0.004, 0.16); tone("triangle", 1318.5, 1318.5, near, when + 0.07, 0.03, 0.004, 0.16); tone("triangle", 1760, 1760, near, when + 0.14, 0.03, 0.004, 0.22); break;
      case "whoosh": burst("bandpass", 2200, 450, 1.2, outdoor, when, 0.09, 0.22, 0.55); break;
      case "squeal": tone("sine", 2950, 2720, outdoor, when, 0.014, 0.35, 1.4); tone("sine", 4410, 4100, outdoor, when + 0.1, 0.006, 0.3, 1.1); break;
      case "drip": { const f = 1300 + r * 1700; tone("sine", f, f * 0.55, outdoor, when, 0.025, 0.002, 0.07); break; }
      case "chirp": { const f = 1700 + r * 1600; tone("square", f, f * (0.6 + random() * 0.9), outdoor, when, 0.008, 0.003, 0.11); if (random() < 0.4) tone("square", f * 1.2, f, outdoor, when + 0.13, 0.006, 0.003, 0.08); break; }
      case "gull": tone("triangle", 1500, 1000, outdoor, when, 0.016, 0.03, 0.33); tone("triangle", 1450, 950, outdoor, when + 0.28, 0.013, 0.03, 0.3); break;
      case "clack": burst("lowpass", 900, 500, 0.7, master, when, 0.05, 0.003, 0.05); burst("lowpass", 900, 500, 0.7, master, when + 0.11, 0.045, 0.003, 0.05); break;
      // A tram pulling away (tram.ts): two slow, soft strikes of a small bell (a fundamental and its
      // inharmonic 2.76x partial), 0.8 s apart, ringing out over a couple of seconds.
      case "bell": for (const at of [0, 0.8]) { tone("sine", 988, 986, outdoor, when + at, 0.03, 0.004, 1.8); tone("sine", 2727, 2720, outdoor, when + at, 0.009, 0.003, 0.9); } break;
    }
  }

  function setMaster(): void {
    if (!graph) return;
    graph.master.gain.setTargetAtTime(on ? AMBIENCE_VOLUME * duckLevel : 0, graph.ctx.currentTime, on ? 0.6 : 0.25);
  }

  return {
    set(enabled) {
      const wasOn = on;
      on = enabled && !destroyed;
      if (!on && !graph) return;
      if (!graph) {
        graph = build();
        if (!graph) return;
      }
      const { ctx } = graph;
      clearTimeout(suspendTimer);
      if (on) {
        // Edges restart fresh only on an off-to-on transition: a redundant set(true) (leaving a venue,
        // a settings change) must keep the previous frame, or the next door / lift / brake edge is lost.
        if (!wasOn) { previous = null; lastTick = -1; nextStep = 0; nextClack = 0; nextPulse = 0; car = null; }
        if (isLive(ctx)) void ctx.resume().catch(() => undefined);
      } else if (isLive(ctx)) {
        // After the fade, stop the clock entirely (hidden tabs, pause, the setting off).
        suspendTimer = setTimeout(() => { if (!on && graph && isLive(graph.ctx)) { graph.rooms.dispose(); void graph.ctx.suspend().catch(() => undefined); } }, 1200);
      }
      setMaster();
    },
    duck(level) {
      duckLevel = clamp01(level);
      setMaster();
    },
    update(frame) {
      if (!graph || !on) return;
      const { ctx, params } = graph, now = ctx.currentTime;
      const levels = ambienceLevels(frame);
      for (const key of Object.keys(params) as (keyof AmbienceLevels)[]) {
        const value = levels[key];
        if (Number.isFinite(value)) params[key].setTargetAtTime(value, now, GLIDE[key] ?? 0.8);
      }
      // Per-kind room tones (room-tones.ts); null outdoors and in the club, which has its own bus.
      // Upper floors take their variant's tone; open roofs lower the bed so the street and wind carry it.
      graph.rooms.update(frame.interior ? roomToneKind(frame.venue, frame.variant, frame.venueId, frame.floor) : null, frame.interior ? [frame.venueId, frame.floor].filter((v) => v !== undefined && v !== null).join("@") : null, now, ambienceOpenAir(frame) ? 0.5 : 1);
      graph.send.gain.setTargetAtTime(frame.interior ? 0.55 : 0.12, now, 0.3);
      graph.engineBody.setTargetAtTime(levels.enginePitch / 2, now, GLIDE.enginePitch ?? 0.08); // the engine's body, an octave under
      const edges = ambienceEdges(previous, frame);
      if (edges.ding) play("lift", now + 0.02);
      if (edges.door) play("door", now + 0.02);
      if (edges.squeal) play("squeal", now + 0.05);
      const cues = eventCues(previous, frame);
      if (cues.hush) play("hush", now + 0.05);
      if (cues.thump) play("thump", now + 0.05);
      const passing = carPass(car, frame.interior || frame.riding ? null : frame.car, frame.speed);
      car = passing.track;
      if (passing.pass) play(frame.car?.heavy ? "rumble" : "whoosh", now + 0.02);
      // A tram pulled away within 40 m (tram.ts posts it from the traffic update, on the shared clock).
      if (takeTramBell() && !frame.interior) play("bell", now + 0.05);
      // A foghorn out on the water, once in a long while, heard only near the harbour.
      if (!frame.interior && harbourNear(frame.x, frame.z) > FOGHORN_NEAR) {
        if (nextHorn === 0) nextHorn = now + 25 + random() * 50;
        else if (now >= nextHorn) { play("foghorn", now + 0.05); nextHorn = now + foghornGap(random()); }
      }
      // The Static's slow bass pulse (CLUB_BEAT apart: 0.4 Hz), while the club bus is audible.
      if (levels.club > 0.002) {
        if (nextPulse < now) nextPulse = now + 0.05;
        while (nextPulse < now + SCHEDULE_AHEAD) { play("pulse", nextPulse); nextPulse += CLUB_BEAT; }
      } else nextPulse = 0;
      // Footsteps, scheduled a little ahead on the audio clock at the walking cadence.
      surface = stepSurface(frame);
      const interval = frame.walking && !frame.driving && !frame.riding && !frame.lift ? stepInterval(frame.speed) : null;
      if (interval === null) nextStep = 0;
      else {
        if (nextStep < now) nextStep = now + 0.04;
        while (nextStep < now + SCHEDULE_AHEAD) { play("step", nextStep); nextStep += interval * (0.94 + random() * 0.12); }
      }
      // Rail joints under a moving carriage.
      if (frame.riding && frame.ridingSpeed > 2) {
        if (nextClack < now) nextClack = now + 0.1;
        while (nextClack < now + SCHEDULE_AHEAD) { play("clack", nextClack); nextClack += 16 / frame.ridingSpeed; }
      } else nextClack = 0;
      // District colour one-shots at their Poisson rates over the time since the last update.
      const dt = lastTick < 0 ? 0 : Math.min(0.5, Math.max(0, now - lastTick));
      lastTick = now;
      const rates = ambienceRates(frame);
      for (const [kind, rate] of [["drip", rates.drips], ["chirp", rates.chirps], ["gull", rates.gulls]] as const) {
        const n = poissonCount(rate, dt, random());
        for (let i = 0; i < n; i++) play(kind, now + 0.02 + random() * dt);
      }
      previous = frame;
    },
    event(kind) {
      if (!graph || !on) return;
      play(kind, graph.ctx.currentTime + 0.01);
    },
    destroy() {
      destroyed = true; on = false;
      clearTimeout(suspendTimer);
      if (graph && isLive(graph.ctx)) void graph.ctx.close().catch(() => undefined);
      graph?.rooms.dispose();
      graph = null;
    },
    stats() {
      return { built: graph !== null, running: on, nodes: graph?.nodes ?? 0, voices };
    },
  };
}
