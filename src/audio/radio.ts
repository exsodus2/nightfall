// In-game radio: Nightride FM station list, preferences, metadata parsing and a small <audio> + Web Audio player.
// Everything above `RadioPlayer` is pure (unit-tested in tests/radio.test.ts); the player touches the DOM only when used.

export type RadioNetwork = "Nightride FM" | "Rekt Network";

export interface RadioStation {
  /** Stream / metadata id: `https://stream.nightride.fm/<id>.mp3`, `station` field of the /meta feed. */
  id: string;
  /** Short channel tag shown in the HUD, e.g. "DARKSYNTH". */
  tag: string;
  genre: string;
  network: RadioNetwork;
}

export const NIGHTRIDE_URL = "https://nightride.fm";
export const REKT_URL = "https://rekt.network";
export const STREAM_BASE = "https://stream.nightride.fm";
/** Server-sent events: `data: [{"station","title","artist",...}]`, sent with `Access-Control-Allow-Origin: *`. */
export const METADATA_URL = "https://nightride.fm/meta";

/** The public channel list on nightride.fm (plus the two Rekt Network channels served from the same stream host).
 * Genres are the stations' own descriptions. Verified 2026-09. */
export const RADIO_STATIONS: readonly RadioStation[] = [
  { id: "nightride", tag: "NIGHTRIDE", genre: "Synthwave / Retrowave / Outrun", network: "Nightride FM" },
  { id: "chillsynth", tag: "CHILLSYNTH", genre: "Chillsynth / Chillwave / Instrumental", network: "Nightride FM" },
  { id: "datawave", tag: "DATAWAVE", genre: "Glitchy Synthwave / IDM / Retro Computing", network: "Nightride FM" },
  { id: "spacesynth", tag: "SPACESYNTH", genre: "Spacesynth / Space Disco / Vocoder Italo", network: "Nightride FM" },
  { id: "darksynth", tag: "DARKSYNTH", genre: "Darksynth / Cyberpunk / Synthmetal", network: "Nightride FM" },
  { id: "horrorsynth", tag: "HORRORSYNTH", genre: "Horrorsynth / Witch House", network: "Nightride FM" },
  { id: "ebsm", tag: "EBSM", genre: "EBSM / Industrial / Clubbing", network: "Nightride FM" },
  { id: "rekt", tag: "REKT", genre: "Dubstep / DnB / Halftime", network: "Rekt Network" },
  { id: "rektory", tag: "REKTORY", genre: "1930s / Reefer Jazz / Fallout", network: "Rekt Network" },
];

export function streamUrl(station: RadioStation): string {
  return `${STREAM_BASE}/${station.id}.mp3`;
}

/** "NIGHTRIDE FM // DARKSYNTH" */
export function stationLabel(station: RadioStation): string {
  return `${station.network.toUpperCase()} // ${station.tag}`;
}

export function stationIndex(id: string): number {
  const index = RADIO_STATIONS.findIndex((station) => station.id === id);
  return index < 0 ? 0 : index;
}

/** Next / previous station id, wrapping around the dial. */
export function cycleStation(id: string, delta: number): string {
  const count = RADIO_STATIONS.length;
  return RADIO_STATIONS[(((stationIndex(id) + delta) % count) + count) % count].id;
}

export const VOLUME_STEP = 0.05;

/** Clamp to [0, 1] on a 5 % grid (keeps repeated -/= presses from drifting). */
export function stepVolume(volume: number, delta: number): number {
  const next = Math.round((volume + delta) / VOLUME_STEP) * VOLUME_STEP;
  return Math.min(1, Math.max(0, Number(next.toFixed(2))));
}

export interface RadioPrefs {
  station: string;
  volume: number;
  muted: boolean;
  /** The radio was on when the player left; it resumes on their first gesture (never autoplays). */
  on: boolean;
  /** Pause while the tab is hidden. Off by default: the radio keeps playing in the background. */
  pauseHidden: boolean;
}

export const DEFAULT_RADIO_PREFS: RadioPrefs = { station: "nightride", volume: 0.6, muted: false, on: false, pauseHidden: false };
export const RADIO_STORAGE_KEY = "nightfall.radio";

/** Validate stored preferences field by field; anything malformed falls back to the default. */
export function parseRadioPrefs(raw: string | null): RadioPrefs {
  if (!raw) return { ...DEFAULT_RADIO_PREFS };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ...DEFAULT_RADIO_PREFS }; }
  if (typeof value !== "object" || value === null) return { ...DEFAULT_RADIO_PREFS };
  const record = value as Record<string, unknown>;
  const station = typeof record.station === "string" && RADIO_STATIONS.some((item) => item.id === record.station) ? record.station : DEFAULT_RADIO_PREFS.station;
  const volume = typeof record.volume === "number" && Number.isFinite(record.volume) ? stepVolume(record.volume, 0) : DEFAULT_RADIO_PREFS.volume;
  const flag = (key: keyof RadioPrefs, fallback: boolean) => typeof record[key] === "boolean" ? record[key] as boolean : fallback;
  return { station, volume, muted: flag("muted", false), on: flag("on", false), pauseHidden: flag("pauseHidden", false) };
}

export function loadRadioPrefs(): RadioPrefs {
  try { return parseRadioPrefs(window.localStorage.getItem(RADIO_STORAGE_KEY)); }
  catch { return { ...DEFAULT_RADIO_PREFS }; }
}

export function saveRadioPrefs(prefs: RadioPrefs): void {
  try { window.localStorage.setItem(RADIO_STORAGE_KEY, JSON.stringify(prefs)); }
  catch { /* Private mode / storage disabled: preferences last for this session only. */ }
}

export interface NowPlaying {
  artist: string;
  title: string;
  /** A live DJ show (the feed marks these with `live` or a `dj` handle). */
  live: boolean;
}

/** Parse one `/meta` SSE message. Returns null for keepalives and malformed payloads. */
export function parseMetadata(data: string): Map<string, NowPlaying> | null {
  if (!data || data === "keepalive") return null;
  let value: unknown;
  try { value = JSON.parse(data); } catch { return null; }
  if (!Array.isArray(value)) return null;
  const result = new Map<string, NowPlaying>();
  for (const entry of value as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.station !== "string") continue;
    const text = (field: unknown) => typeof field === "string" ? field.trim() : "";
    result.set(item.station, { artist: text(item.artist), title: text(item.title), live: item.live === true || typeof item.dj === "string" });
  }
  return result.size ? result : null;
}

export function formatNowPlaying(meta: NowPlaying | undefined): string {
  if (!meta || (!meta.artist && !meta.title)) return "";
  if (!meta.artist) return meta.title;
  if (!meta.title) return meta.artist;
  return `${meta.artist} — ${meta.title}`;
}

const METER_GLYPHS = " ▁▂▃▄▅▆▇█";

/** Levels in [0, 1] → one block glyph per band. */
export function meterString(levels: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < levels.length; i++) {
    const level = Math.min(1, Math.max(0, levels[i]));
    out += METER_GLYPHS[Math.round(level * (METER_GLYPHS.length - 1))];
  }
  return out;
}

/** "▮▮▮▮▮▮▯▯▯▯" style volume bar. */
export function volumeBar(volume: number, muted: boolean, cells = 10): string {
  const filled = muted ? 0 : Math.round(Math.min(1, Math.max(0, volume)) * cells);
  return "▮".repeat(filled) + "▯".repeat(cells - filled);
}

/** Group analyser bins into `bands` roughly log-spaced bands (bass gets fewer bins), normalised to [0, 1]. */
export function binsToBands(bins: ArrayLike<number>, out: Float32Array, usable = 0.72): void {
  const bands = out.length;
  const limit = Math.max(bands, Math.floor(bins.length * usable));
  for (let band = 0; band < bands; band++) {
    const start = Math.floor(Math.pow(limit, band / bands));
    const end = Math.max(start + 1, Math.floor(Math.pow(limit, (band + 1) / bands)));
    let peak = 0;
    for (let i = start; i < end && i < bins.length; i++) peak = Math.max(peak, bins[i]);
    out[band] = Math.pow(peak / 255, 1.6);
  }
}

export type RadioStatus = "off" | "tuning" | "playing" | "error";

/**
 * One <audio> element for the live stream. Nightride's streams send `Access-Control-Allow-Origin: *`, so the element
 * is requested with `crossOrigin="anonymous"` and routed through an AnalyserNode for the level meter and a GainNode
 * for volume (which also works on iOS, where `audio.volume` is read-only). If the CORS request ever fails, the player
 * rebuilds a plain element without Web Audio and the HUD falls back to a synthetic meter; playback always wins.
 */
export class RadioPlayer {
  private audio: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array<ArrayBuffer> | null = null;
  private useWebAudio = true;
  private wanted = false;
  private station: RadioStation = RADIO_STATIONS[0];
  private volume = DEFAULT_RADIO_PREFS.volume;
  private muted = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private played = false;
  private readonly onStatus: (status: RadioStatus) => void;

  constructor(onStatus: (status: RadioStatus) => void) {
    this.onStatus = onStatus;
  }

  /** True when real spectrum data is available (otherwise draw a synthetic meter). */
  get analysing(): boolean { return !!this.analyser && this.useWebAudio; }

  /** Must be called from a user gesture the first time (creates / resumes the AudioContext). */
  play(station: RadioStation, volume: number, muted: boolean): void {
    this.wanted = true;
    this.station = station;
    this.volume = volume;
    this.muted = muted;
    this.clearRetry();
    this.retries = 0;
    this.start();
  }

  stop(): void {
    this.wanted = false;
    this.clearRetry();
    const audio = this.audio;
    if (audio) {
      audio.pause();
      // Drop the live connection rather than buffering a stale stream in the background.
      audio.removeAttribute("src");
      audio.load();
    }
    this.onStatus("off");
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.applyVolume();
  }

  /** Fill `out` with band levels. Returns false when no analyser is available. */
  levels(out: Float32Array): boolean {
    if (!this.analyser || !this.bins || !this.useWebAudio) return false;
    this.analyser.getByteFrequencyData(this.bins);
    binsToBands(this.bins, out);
    return true;
  }

  destroy(): void {
    this.stop();
    this.audio?.remove();
    this.audio = null;
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }

  private element(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const audio = new Audio();
    audio.preload = "none";
    if (this.useWebAudio) audio.crossOrigin = "anonymous";
    audio.addEventListener("playing", () => { if (this.wanted) { this.played = true; this.retries = 0; this.onStatus("playing"); } });
    audio.addEventListener("waiting", () => { if (this.wanted) this.onStatus("tuning"); });
    audio.addEventListener("stalled", () => { if (this.wanted && audio.paused) this.onStatus("tuning"); });
    // A live stream "ends" only when the connection drops: reconnect.
    audio.addEventListener("ended", () => this.failed(audio));
    audio.addEventListener("error", () => this.failed(audio));
    this.audio = audio;
    if (this.useWebAudio) this.connect(audio);
    return audio;
  }

  private connect(audio: HTMLAudioElement): void {
    try {
      const context = this.context ?? new AudioContext();
      this.context = context;
      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      const gain = context.createGain();
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      this.analyser = analyser;
      this.gain = gain;
      this.bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      // No Web Audio: the element plays directly and uses its own volume.
      this.useWebAudio = false;
      this.analyser = null;
      this.gain = null;
    }
  }

  private start(): void {
    const audio = this.element();
    this.applyVolume();
    if (this.context && this.context.state !== "running") void this.context.resume().catch(() => undefined);
    const url = streamUrl(this.station);
    // Always reconnect to the live edge (a paused live stream would otherwise resume from a stale buffer).
    audio.src = url;
    this.onStatus("tuning");
    audio.play().catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return; // Superseded by a newer station change.
      if (cause instanceof DOMException && cause.name === "NotAllowedError") { this.wanted = false; this.onStatus("off"); return; } // No user gesture yet.
      this.failed(audio);
    });
  }

  private applyVolume(): void {
    const level = this.muted ? 0 : this.volume;
    const audio = this.audio;
    if (this.gain && this.context && this.useWebAudio) {
      if (audio) audio.volume = 1;
      this.gain.gain.setTargetAtTime(level * level, this.context.currentTime, 0.05); // Perceptual (squared) curve.
    } else if (audio) {
      audio.volume = level * level;
    }
  }

  private failed(audio: HTMLAudioElement): void {
    if (!this.wanted || audio !== this.audio) return;
    if (this.useWebAudio && !this.played) {
      // The CORS-mode request never produced audio: rebuild a plain element without the analyser (synthetic meter).
      this.useWebAudio = false;
      audio.pause();
      audio.removeAttribute("src");
      audio.remove();
      this.audio = null;
      this.analyser = null;
      this.gain = null;
      this.start();
      return;
    }
    this.onStatus("error");
    if (this.retries >= 6) return;
    this.retries += 1;
    this.clearRetry();
    this.retryTimer = setTimeout(() => { if (this.wanted) this.start(); }, Math.min(15000, 1500 * 2 ** this.retries));
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
