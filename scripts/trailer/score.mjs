import { writeFile } from "node:fs/promises";
import { BAR, BEAT, DURATION } from "./timeline.mjs";

// The trailer score: an original synthwave cue rendered sample by sample, locked to the cut
// (timeline.mjs). D minor, 96 BPM. No dependencies; writes a 48 kHz stereo 32-bit float WAV.
//   node scripts/trailer/score.mjs [out.wav]
const SR = 48000, N = Math.ceil((DURATION + 0.5) * SR);
const out = process.argv[2] ?? "artifacts/trailer/score.wav";

// ---- buses ------------------------------------------------------------------------------
const dry = [new Float32Array(N), new Float32Array(N)];
const verb = [new Float32Array(N), new Float32Array(N)];   // reverb send
const echo = [new Float32Array(N), new Float32Array(N)];   // ping-pong delay send
const duck = new Float32Array(N).fill(1);                  // sidechain gain from the kick

let seed = 1234567;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rand() * 2 - 1;
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const idx = t => Math.round(t * SR);
const clamp01 = x => Math.max(0, Math.min(1, x));

/** Zavalishin TPT state-variable filter. */
class SVF {
  constructor() { this.a = 0; this.b = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
  run(v, cutoff, q = 0.707) {
    const g = Math.tan(Math.PI * Math.min(Math.max(cutoff, 10), SR * 0.45) / SR), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = v - this.b, v1 = a1 * this.a + a2 * v3, v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    this.lp = v2; this.bp = v1; this.hp = v - k * v1 - v2;
    return v2;
  }
}
const blep = (p, dt) => { if (p < dt) { p /= dt; return p + p - p * p - 1; } if (p > 1 - dt) { p = (p - 1) / dt; return p * p + p + p + 1; } return 0; };
class Saw {
  constructor(phase = rand()) { this.p = phase; }
  next(freq) { const dt = freq / SR; this.p += dt; if (this.p >= 1) this.p -= 1; return 2 * this.p - 1 - blep(this.p, dt); }
}

function mix(i, l, r, sendVerb = 0, sendEcho = 0) {
  if (i < 0 || i >= N) return;
  dry[0][i] += l; dry[1][i] += r;
  if (sendVerb) { verb[0][i] += l * sendVerb; verb[1][i] += r * sendVerb; }
  if (sendEcho) { echo[0][i] += l * sendEcho; echo[1][i] += r * sendEcho; }
}

// ---- harmony ----------------------------------------------------------------------------
const CH = {
  Dm: { pad: [50, 57, 60, 65, 69], root: 38, arp: [62, 65, 69, 72, 74] },
  Bb: { pad: [46, 53, 57, 62, 65], root: 34, arp: [58, 62, 65, 69, 70] },
  F: { pad: [53, 57, 60, 64, 67], root: 41, arp: [60, 65, 67, 69, 72] },
  C: { pad: [48, 55, 60, 62, 64], root: 36, arp: [60, 62, 64, 67, 72] },
};
const LOOP = ["Dm", "Bb", "F", "C"];
const CHORDS = [[3.75, "Dm"], [7.5, "Bb"], [10, "Dm"], [12.5, "Bb"], [15, "F"], [17.5, "C"]];
for (let t = 20; t < 60; t += BAR) CHORDS.push([t, LOOP[Math.round((t - 20) / BAR) % 4]]);
CHORDS.push([60, "Dm"], [62.5, "Bb"], [63.75, "C"], [65, null]);
const FIN = [[66.25, "Dm"], [68.75, "Bb"], [71.25, "F"], [73.75, "C"], [76.25, "Dm"]];
const chordAt = t => { let c = null; for (const [at, name] of [...CHORDS, ...FIN]) if (t >= at) c = name; return c && CH[c]; };

// ---- instruments --------------------------------------------------------------------------
/** Detuned supersaw pad, one note, with its own filter per side. */
function padNote(m, start, end, { gain = 0.03, attack = 1.2, release = 1.6, cutoff = t => 1200, spread = 0.12 } = {}) {
  const saws = [[new Saw(), new Saw(), new Saw()], [new Saw(), new Saw(), new Saw()]], f = [new SVF(), new SVF()];
  const detune = [[-0.11, 0.0, 0.07], [-0.06, 0.02, 0.12]];
  const base = mtof(m), i0 = idx(start), i1 = idx(end + release);
  for (let i = i0; i < i1 && i < N; i++) {
    const t = i / SR, s = t - start;
    const env = Math.min(1, s / attack) * (t > end ? Math.exp(-(t - end) / (release / 4)) : 1);
    const vib = 1 + 0.0018 * Math.sin(2 * Math.PI * 0.21 * t + m);
    const c = cutoff(t);
    const v = [0, 1].map(ch => {
      let x = 0; for (let k = 0; k < 3; k++) x += saws[ch][k].next(base * vib * 2 ** (detune[ch][k] * (1 + spread) / 12));
      return f[ch].run(x, c, 0.6);
    });
    const g = gain * env * duck[i];
    mix(i, v[0] * g, v[1] * g, 0.55, 0);
  }
}
function pads() {
  const all = [...CHORDS, ...FIN];
  for (let n = 0; n < all.length; n++) {
    const [start, name] = all[n]; if (!name) continue;
    const end = n + 1 < all.length ? all[n + 1][0] : DURATION - 1.2;
    const fin = start >= 66;
    const cutoff = t => t < 10 ? 500 + 500 * clamp01((t - 3.75) / 6) : t < 20 ? 1000 + 600 * clamp01((t - 10) / 10) : t < 65 ? 1900 + 900 * clamp01((t - 50) / 10) : 2600 - 1600 * clamp01((t - 76) / 7);
    const gain = (start < 10 ? 0.026 : fin ? 0.034 : 0.022) * (start >= 76 ? 1.1 : 1);
    for (const m of CH[name].pad) padNote(m, start, end, { gain, attack: start < 4 ? 2.5 : fin && start === 66.25 ? 0.02 : 0.35, release: start >= 76 ? 5 : 1.4, cutoff });
    if (fin || start < 10) padNote(CH[name].pad[0] - 12, start, end, { gain: gain * 0.9, attack: start < 4 ? 2.5 : 0.05, release: start >= 76 ? 5 : 1.4, cutoff: () => 500 });
  }
}

/** Sub sine + saw bass, eighths with a filter pluck. */
function bassNote(m, start, dur, { gain = 0.16, open = 1 } = {}) {
  const saw = new Saw(0), f = new SVF(); let ph = 0;
  const freq = mtof(m), i0 = idx(start), i1 = idx(start + dur + 0.12);
  for (let i = i0; i < i1 && i < N; i++) {
    const s = i / SR - start;
    const env = Math.min(1, s / 0.004) * (s > dur ? Math.exp(-(s - dur) / 0.03) : 0.75 + 0.25 * Math.exp(-s / 0.09));
    ph += freq / SR;
    const sub = Math.sin(2 * Math.PI * ph);
    const top = f.run(saw.next(freq), 140 + (500 + 1300 * open) * Math.exp(-s / 0.11), 0.9);
    const v = (0.85 * sub + 0.55 * top) * env * gain * (0.35 + 0.65 * duck[i]);
    mix(i, v, v);
  }
}
function bass() {
  // Intro heartbeat: soft quarter pulses under the pad.
  for (let t = 5; t < 10; t += BEAT) bassNote(chordAt(t).root, t, BEAT * 0.5, { gain: 0.09, open: 0.1 });
  for (let t = 10; t < 20; t += BEAT / 2) bassNote(chordAt(t).root, t, BEAT * 0.35, { gain: 0.08 + 0.04 * clamp01((t - 10) / 10), open: 0.25 });
  for (let t = 20; t < 62.5; t += BEAT / 2) bassNote(chordAt(t).root + (Math.round(t / (BEAT / 2)) % 8 === 7 ? 12 : 0), t, BEAT * 0.42, { gain: 0.125, open: t < 50 ? 0.6 : 1 });
  for (let t = 62.5; t < 65; t += BEAT / 4) bassNote(chordAt(t).root, t, BEAT * 0.2, { gain: 0.12, open: 1.2 });
  // Finale: long sub notes.
  for (const [at, name] of FIN) bassNote(CH[name].root - 12, at, at >= 76 ? 6 : BAR - 0.05, { gain: 0.2, open: 0.05 });
}

/** Plucked arpeggio into the delay. */
function pluck(m, start, { gain = 0.05, bright = 1, pan = 0, decay = 0.2 } = {}) {
  const a = new Saw(0), b = new Saw(0.5), f = new SVF();
  const freq = mtof(m), i0 = idx(start), i1 = idx(start + decay * 5);
  for (let i = i0; i < i1 && i < N; i++) {
    const s = i / SR - start;
    const env = Math.min(1, s / 0.002) * Math.exp(-s / decay);
    const x = f.run(a.next(freq) * 0.6 + b.next(freq * 1.0035) * 0.6, 300 + 3200 * bright * Math.exp(-s / 0.07), 1.1);
    const v = x * env * gain * (0.55 + 0.45 * duck[i]);
    mix(i, v * (1 - pan) , v * (1 + pan), 0.18, 0.32);
  }
}
function arps() {
  const order = [0, 2, 4, 3, 1, 3, 2, 4, 0, 2, 4, 3, 1, 2, 3, 4];
  let k = 0;
  for (let t = 10; t < 62.5; t += BEAT / 4, k++) {
    const c = chordAt(t); if (!c) continue;
    const up = t >= 50 ? 12 : 0;
    const fadeIn = clamp01((t - 10) / 5);
    pluck(c.arp[order[k % 16]] + up * (k % 2), t, { gain: 0.045 * fadeIn * (t >= 20 ? 1.15 : 1), bright: t < 20 ? 0.5 + 0.5 * fadeIn : 1.2, pan: (k % 2 ? 0.35 : -0.35), decay: t < 20 ? 0.16 : 0.13 });
  }
  // Finale: slow eighths that thin out under the end card.
  k = 0;
  for (let t = 66.25; t < 79; t += BEAT / 2, k++) {
    const c = chordAt(t); if (!c) continue;
    const fade = t < 76 ? clamp01((t - 66.25) / 2.5) : clamp01(1 - (t - 76) / 3);
    pluck(c.arp[order[k % 16]] + 12, t, { gain: 0.04 * fade, bright: 0.7, pan: k % 2 ? 0.45 : -0.45, decay: 0.3 });
  }
}

/** Lead: two detuned saws, glide and delayed vibrato. Notes [start, dur, midi]. */
function lead(notes, { gain = 0.05 } = {}) {
  const a = new Saw(), b = new Saw(), f = [new SVF(), new SVF()];
  const i0 = idx(notes[0][0]), last = notes[notes.length - 1], i1 = idx(last[0] + last[1] + 1);
  let freq = mtof(notes[0][2]), noteStart = notes[0][0];
  for (let i = i0; i < i1 && i < N; i++) {
    const t = i / SR;
    let cur = null; for (const n of notes) if (t >= n[0] && t < n[0] + n[1]) cur = n;
    if (cur && cur[0] !== noteStart) noteStart = cur[0];
    const target = cur ? mtof(cur[2]) : freq;
    freq += (target - freq) * (1 - Math.exp(-1 / (SR * 0.035)));
    const s = t - noteStart, held = cur ? 1 : 0;
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * t) * clamp01((s - 0.25) / 0.4);
    const env = held ? Math.min(1, s / 0.03) : 0;
    const x = a.next(freq * vib) + b.next(freq * vib * 1.006);
    const g = gain * smoothEnv(i, env);
    mix(i, f[0].run(x, 2600, 0.8) * g * 0.9, f[1].run(x, 2600, 0.8) * g * 1.1, 0.35, 0.28);
  }
}
let envState = 0;
function smoothEnv(i, target) { envState += (target - envState) * (1 - Math.exp(-1 / (SR * 0.02))); return envState; }

// ---- drums & effects ------------------------------------------------------------------------
const kicks = [];
function kick(t0, gain = 0.9) {
  kicks.push(t0);
  let ph = 0; const i0 = idx(t0);
  for (let i = i0; i < i0 + idx(0.5) && i < N; i++) {
    const s = i / SR - t0;
    ph += (44 + 120 * Math.exp(-s / 0.03)) / SR;
    const v = (Math.sin(2 * Math.PI * ph) * Math.exp(-s / 0.24) * Math.min(1, s / 0.0015) + noise() * Math.exp(-s / 0.0025) * 0.25) * gain;
    mix(i, v, v);
  }
}
function snare(t0, gain = 0.5, room = 0.32) {
  const f = new SVF(), h = new SVF(); let ph = 0; const i0 = idx(t0);
  for (let i = i0; i < i0 + idx(0.45) && i < N; i++) {
    const s = i / SR - t0;
    ph += (185 + 40 * Math.exp(-s / 0.01)) / SR;
    const n = noise(); f.run(n, 1900, 0.7); h.run(n, 5200, 0.7);
    const v = (Math.sin(2 * Math.PI * ph) * Math.exp(-s / 0.05) * 0.55 + f.bp * Math.exp(-s / 0.15) * 1.3 + h.hp * Math.exp(-s / 0.06) * 0.25) * gain;
    mix(i, v * 0.95, v * 1.05, room);
  }
}
function hat(t0, gain = 0.1, open = false, pan = 0.25) {
  const f = new SVF(); const i0 = idx(t0), len = open ? 0.35 : 0.06;
  for (let i = i0; i < i0 + idx(len) && i < N; i++) {
    const s = i / SR - t0;
    f.run(noise(), 8200, 0.8);
    const v = f.hp * Math.exp(-s / (open ? 0.11 : 0.022)) * gain;
    mix(i, v * (1 - pan), v * (1 + pan), 0.08);
  }
}
function boom(t0, size = 1, gain = 0.8) {
  let ph = 0; const f = new SVF(), i0 = idx(t0);
  for (let i = i0; i < i0 + idx(4 * size) && i < N; i++) {
    const s = i / SR - t0;
    ph += (30 + 70 * Math.exp(-s / 0.18)) / SR;
    const body = Math.sin(2 * Math.PI * ph) * Math.exp(-s / (1.1 * size));
    const air = f.run(noise(), 180 + 1800 * Math.exp(-s / 0.12), 0.7) * Math.exp(-s / (0.5 * size)) * 0.9;
    const v = (body + air) * gain * Math.min(1, s / 0.002);
    mix(i, v, v, 0.45);
  }
}
/** Digital decode chirp for on-screen type. */
function chirp(t0, gain = 0.05, steps = 7) {
  let ph = 0; const i0 = idx(t0);
  for (let k = 0; k < steps; k++) {
    const freq = 1400 + rand() * 2600, a = i0 + idx(k * 0.022), b = a + idx(0.016);
    for (let i = a; i < b && i < N; i++) { ph += freq / SR; const s = (i - a) / SR; const v = (ph % 1 < 0.5 ? 1 : -1) * Math.exp(-s / 0.006) * gain * (1 - k / steps * 0.6); mix(i, v * (k % 2 ? 0.7 : 1.3), v * (k % 2 ? 1.3 : 0.7), 0.2, 0.15); }
  }
}
function typeClick(t0, gain = 0.1) {
  const f = new SVF(), i0 = idx(t0);
  for (let i = i0; i < i0 + idx(0.03) && i < N; i++) {
    const s = i / SR - t0; f.run(noise(), 3400, 1.4);
    const v = (f.bp * 1.6 + Math.sin(2 * Math.PI * 2100 * s) * 0.35) * Math.exp(-s / 0.005) * gain;
    mix(i, v * 1.1, v * 0.9, 0.12);
  }
}
/** Rising noise + pitch sweep, cut dead at `end`. */
function riser(start, end, gain = 0.22) {
  const f = new SVF(), saw = new Saw(), sf = new SVF(); const i0 = idx(start), i1 = idx(end);
  for (let i = i0; i < i1 && i < N; i++) {
    const u = (i - i0) / (i1 - i0), shape = u * u;
    f.run(noise(), 300 * 2 ** (u * 5), 2.2);
    const tone = sf.run(saw.next(mtof(50 + 24 * u * u)), 600 + 5000 * u, 1);
    const tail = Math.min(1, (i1 - i) / (SR * 0.004));
    const v = (f.bp * 1.4 + tone * 0.18) * shape * gain * tail;
    mix(i, v * (1 - 0.3 * Math.sin(u * 40)), v * (1 + 0.3 * Math.sin(u * 40)), 0.25 * (1 - u));
  }
}
/** Reverse-swell into a downbeat (noise + pad bloom), cut at `end`. */
function swell(start, end, gain = 0.12) {
  const f = new SVF(); const i0 = idx(start), i1 = idx(end);
  for (let i = i0; i < i1 && i < N; i++) {
    const u = (i - i0) / (i1 - i0);
    f.run(noise(), 200 + 2500 * u * u, 0.9);
    const v = f.lp * u ** 3 * gain * Math.min(1, (i1 - i) / (SR * 0.003));
    mix(i, v, v, 0.5);
  }
}
/** Rain: pinkish noise, band-limited, with a slow swell. */
function rain(level) {
  const f = [new SVF(), new SVF()], h = [new SVF(), new SVF()]; let p = [0, 0];
  for (let i = 0; i < N; i++) {
    const t = i / SR, g = level(t); if (g <= 0.0001) { continue; }
    for (let ch = 0; ch < 2; ch++) {
      p[ch] = 0.97 * p[ch] + 0.03 * noise() * 8;
      h[ch].run(f[ch].run(p[ch] * 0.6 + noise() * 0.25, 5200, 0.6), 500, 0.6); const x = h[ch].hp;
      // Occasional nearer drops.
      const drop = rand() < 0.0009 ? (rand() - 0.5) * 2.5 : 0;
      dry[ch][i] += (x + drop * 0.25) * g;
    }
  }
}
/** Bell shimmer for the title. */
function shimmer(t0, gain = 0.05) {
  const partials = [[74, 1], [81, 0.6], [86, 0.45], [88, 0.3], [93, 0.2]];
  const i0 = idx(t0);
  for (let i = i0; i < i0 + idx(5) && i < N; i++) {
    const s = i / SR - t0; let v = 0;
    for (const [m, a] of partials) v += Math.sin(2 * Math.PI * mtof(m) * s * (1 + 0.0007 * m)) * a * Math.exp(-s / (2.2 - m / 60));
    v *= gain * Math.min(1, s / 0.004);
    mix(i, v * 0.8, v * 1.2, 0.7, 0.2);
  }
}

// ---- arrangement --------------------------------------------------------------------------
// Drums first: the kick fills the sidechain the tonal parts read.
for (let t = 20; t < 50; t += BAR) {
  kick(t); kick(t + 2 * BEAT); if ((t - 20) / BAR % 2 === 1) kick(t + 3.5 * BEAT, 0.6);
  snare(t + BEAT); snare(t + 3 * BEAT);
  for (let k = 0; k < 8; k++) hat(t + k * BEAT / 2 + BEAT / 4, 0.07 + (k % 2) * 0.02);
}
for (let t = 50; t < 62.5; t += BAR) {
  for (let b = 0; b < 4; b++) kick(t + b * BEAT);
  snare(t + BEAT, 0.55); snare(t + 3 * BEAT, 0.55);
  for (let k = 0; k < 16; k++) hat(t + k * BEAT / 4, k % 4 === 2 ? 0.12 : 0.06, k % 4 === 2, k % 2 ? 0.3 : -0.3);
}
// Pre-drop: ticking hats and a swell that cuts on the downbeat.
for (let t = 15; t < 20; t += BEAT / 2) hat(t + BEAT / 4, 0.025 + 0.035 * clamp01((t - 15) / 5));
swell(18.75, 20, 0.16);
// Snare roll into the blackout: eighths, sixteenths, thirty-seconds.
for (let t = 62.5, step = BEAT / 2, k = 0; t < 65 - 0.01; t += step, k++) {
  if (t >= 63.75) step = BEAT / 4; if (t >= 64.375) step = BEAT / 8;
  snare(t, 0.18 + 0.35 * clamp01((t - 62.5) / 2.5), 0.2);
}
for (const t of kicks) { const i0 = idx(t); for (let i = i0; i < i0 + idx(0.4) && i < N; i++) { const s = (i - i0) / SR; duck[i] = Math.min(duck[i], 1 - 0.6 * Math.exp(-s / 0.11)); } }

rain(t => t < 20 ? 0.09 * Math.min(1, t / 0.6) * (1 - 0.6 * clamp01((t - 12) / 8)) : t < 65 ? 0.03 : t < 66.25 ? 0.11 : t < 76 ? 0.045 : 0.07 * clamp01((DURATION - 0.3 - t) / 3));
// Cold open: a low drone, typing, then the scramble and a swell into the first shot.
padNote(26, 0.2, 3.6, { gain: 0.05, attack: 2, release: 1.5, cutoff: () => 260 });
const OPEN = "somewhere, after midnight.";
[...OPEN].forEach((ch, i) => typeClick(0.7 + i * 0.075 + (rand() - 0.5) * 0.01, ch === " " ? 0.05 : 0.08 + rand() * 0.04));
chirp(2.95, 0.035, 10);
swell(2.2, 3.75, 0.12);
boom(3.75, 0.8, 0.45);

pads(); bass(); arps();
// Lead over the "FLY" section, two four-bar phrases.
lead([[50, 1.25, 69], [51.25, 1.25, 65], [52.5, 1.875, 74], [54.375, 0.625, 72], [55, 1.25, 72], [56.25, 1.25, 69], [57.5, 2.5, 67],
      [60, 1.25, 69], [61.25, 1.25, 65], [62.5, 1.25, 74], [63.75, 1.25, 76]], { gain: 0.05 });

// Hits on the words and big moments.
boom(20, 1.2, 0.85); chirp(20, 0.04);
for (const t of [23.75, 30, 33.75]) { boom(t, 0.6, 0.35); chirp(t, 0.035); }
for (const t of [36.6, 40.35, 44.1, 47.75]) chirp(t, 0.022, 5);
for (const t of [10.75, 15.75]) chirp(t + 0.1, 0.02, 6);
boom(50, 1, 0.7); chirp(50, 0.04);
riser(60, 65, 0.26);
boom(66.25, 2.2, 1.0);
shimmer(70.0, 0.045);
chirp(70, 0.03, 9);
boom(76, 1.4, 0.35); chirp(76.25, 0.03, 8); chirp(77.5, 0.02, 6); chirp(78.0, 0.02, 6);

// ---- effects returns & master ---------------------------------------------------------------
// Ping-pong delay, dotted eighth, darkened feedback.
{
  const d = Math.round(BEAT * 0.75 * SR), fb = 0.38, lp = [new SVF(), new SVF()];
  const bufL = new Float32Array(N), bufR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const inL = echo[0][i], inR = echo[1][i];
    const tapL = i >= d ? bufR[i - d] : 0, tapR = i >= d ? bufL[i - d] : 0;
    bufL[i] = inL + lp[0].run(tapL, 3800) * fb; bufR[i] = inR + lp[1].run(tapR, 3800) * fb;
    dry[0][i] += tapL * 0.7; dry[1][i] += tapR * 0.7;
    verb[0][i] += tapL * 0.2; verb[1][i] += tapR * 0.2;
  }
}
// Freeverb-style reverb, large dark room.
{
  const scale = SR / 44100, combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], alls = [556, 441, 341, 225];
  const room = 0.88, damp = 0.35;
  for (let ch = 0; ch < 2; ch++) {
    const spread = ch ? 23 : 0;
    const cb = combs.map(n => ({ buf: new Float32Array(Math.round((n + spread) * scale)), i: 0, store: 0 }));
    const ab = alls.map(n => ({ buf: new Float32Array(Math.round((n + spread) * scale)), i: 0 }));
    const pre = Math.round(0.02 * SR);
    for (let i = 0; i < N; i++) {
      const x = (i >= pre ? verb[ch][i - pre] : 0) * 0.015;
      let y = 0;
      for (const c of cb) { const o = c.buf[c.i]; c.store = o * (1 - damp) + c.store * damp; c.buf[c.i] = x + c.store * room; c.i = (c.i + 1) % c.buf.length; y += o; }
      for (const a of ab) { const o = a.buf[a.i]; a.buf[a.i] = y + o * 0.5; a.i = (a.i + 1) % a.buf.length; y = o - y; }
      dry[ch][i] += y * 0.9;
    }
  }
}
// Master: high-pass, glue saturation, fade, peak normalise to -1 dBFS.
const hp = [new SVF(), new SVF()];
let peak = 0;
for (let ch = 0; ch < 2; ch++) for (let i = 0; i < N; i++) {
  hp[ch].run(dry[ch][i], 28, 0.7);
  const t = i / SR, fade = clamp01((DURATION - 0.2 - t) / 2.6);
  const v = Math.tanh(hp[ch].hp * 1.25) / Math.tanh(1.25) * fade;
  dry[ch][i] = v; peak = Math.max(peak, Math.abs(v));
}
const norm = 0.89 / peak;

// ---- WAV (IEEE float) ---------------------------------------------------------------------
const frames = Math.round(DURATION * SR), data = Buffer.alloc(frames * 8);
for (let i = 0; i < frames; i++) { data.writeFloatLE(dry[0][i] * norm, i * 8); data.writeFloatLE(dry[1][i] * norm, i * 8 + 4); }
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 8, 28); header.writeUInt16LE(8, 32); header.writeUInt16LE(32, 34);
header.write("data", 36); header.writeUInt32LE(data.length, 40);
await writeFile(out, Buffer.concat([header, data]));
console.log(`score: ${out} (${DURATION}s, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS before normalising)`);
