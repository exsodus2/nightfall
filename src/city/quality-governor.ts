// Render profiles and the adaptive quality governor (mobile/iPhone support).
// Pure: no DOM, no textmode. The engine resolves `CitySettings.quality` into a RenderProfile each time
// the quality, the governor level or the orientation changes.

export type QualityPreset = "auto" | "high" | "balanced" | "low";

export interface RenderProfile {
  /** Cell size in CSS pixels (multiplied by pixel density for the atlas). */
  cell: number;
  /** Highest pixel density rendered (a DPR 3 phone renders at 2). */
  maxDensity: number;
  /** Base draw distance in city blocks (altitude adds to it). Desktop presets see across most of
   *  the 24-block city (20 / 16 / 7); distant blocks cost little: building detail retracts by
   *  distance, props, people and signs keep their own short ranges, and the puddle reflection
   *  only draws blocks within MIRROR_REACH (engine.ts). */
  baseRadius: number;
  /** Shorter prop / resident / traffic ranges and no wheel detail (the engine's `view.low`). */
  low: boolean;
  /** Hologram projections and hologram screens (the synth broadcast layer). */
  holograms: boolean;
  /** Lamp-cone and headlight scattering in the material (also needs the effects setting). */
  atmosphere: boolean;
  /** Full reflected scene in puddles; off reflects only the sky dome. */
  reflections: boolean;
  /** Neon-clarity post filter (also needs the effects setting). */
  bloom: boolean;
  /** Rain streaks on the weather overlay. */
  rain: number;
}

const DESKTOP: Record<Exclude<QualityPreset, "auto">, RenderProfile> = {
  high: { cell: 8, maxDensity: 2, baseRadius: 20, low: false, holograms: true, atmosphere: true, reflections: true, bloom: true, rain: 38 },
  balanced: { cell: 12, maxDensity: 2, baseRadius: 16, low: false, holograms: true, atmosphere: true, reflections: true, bloom: true, rain: 38 },
  low: { cell: 16, maxDensity: 2, baseRadius: 7, low: true, holograms: false, atmosphere: false, reflections: true, bloom: false, rain: 18 },
};

/** "Auto" levels, best first. Cells: landscape / portrait (portrait keeps ~49 columns on a phone). */
const AUTO_LEVELS: readonly (RenderProfile & { portraitCell: number })[] = [
  { cell: 10, portraitCell: 8, maxDensity: 2, baseRadius: 8, low: false, holograms: true, atmosphere: true, reflections: true, bloom: true, rain: 30 },
  { cell: 10, portraitCell: 8, maxDensity: 2, baseRadius: 7, low: true, holograms: true, atmosphere: true, reflections: true, bloom: true, rain: 26 },
  { cell: 12, portraitCell: 10, maxDensity: 2, baseRadius: 6, low: true, holograms: true, atmosphere: false, reflections: false, bloom: true, rain: 22 },
  { cell: 14, portraitCell: 12, maxDensity: 2, baseRadius: 5, low: true, holograms: false, atmosphere: false, reflections: false, bloom: false, rain: 16 },
];
export const AUTO_LEVEL_COUNT = AUTO_LEVELS.length;

export function renderProfile(quality: QualityPreset, level: number, portrait: boolean): RenderProfile {
  if (quality !== "auto") return DESKTOP[quality];
  const { portraitCell, ...profile } = AUTO_LEVELS[Math.max(0, Math.min(AUTO_LEVELS.length - 1, Math.round(level)))];
  return portrait ? { ...profile, cell: portraitCell } : profile;
}

/**
 * Desktop presets keep their cell size and effects; when a desktop cannot hold the frame rate the
 * engine runs a second QualityGovernor over DESKTOP_LEVELS and gives up draw distance first (the
 * cost the long view added: distant blocks, holograms and far signs), then full puddle
 * reflections. The draw distance eases (engine.ts), so a step is a slow fog shift, never a pop.
 */
export const DESKTOP_LEVELS: readonly { radius: number; reflections: boolean }[] = [
  { radius: 0, reflections: true },
  { radius: -4, reflections: true },
  { radius: -7, reflections: true },
  { radius: -7, reflections: false },
];
/** A desktop preset at desktop governor `level` (0 = as configured). Phones ("auto") are unchanged. */
export function desktopProfile(profile: RenderProfile, level: number): RenderProfile {
  const step = DESKTOP_LEVELS[Math.max(0, Math.min(DESKTOP_LEVELS.length - 1, Math.round(level)))];
  if (step.radius === 0 && step.reflections) return profile;
  return { ...profile, baseRadius: Math.max(5, profile.baseRadius + step.radius), reflections: profile.reflections && step.reflections };
}

/** Tunables (exported for tests). Frame times are wall-clock intervals between rendered frames. */
export const GOVERNOR = {
  window: 2.5,        // seconds per decision window
  warmup: 3,          // seconds ignored after start, resume, resize or a level change
  slowFrame: 24,      // ms: a frame that missed a 60 Hz vsync
  degradeRatio: 0.2,  // share of slow frames that lowers quality...
  degradeMean: 20,    // ...or a mean frame time above this (ms, < 50 fps; catches 120 Hz / uneven misses)
  upgradeMean: 17.6,  // mean frame time needed before climbing back
  upgradeRatio: 0.03, // share of slow frames below which quality may rise again...
  upgradeCpu: 7,      // ...if the engine's CPU time per frame is also below this (ms)
  upgradeAfter: 20,   // seconds of stability before trying a better level
  maxUpgrades: 2,     // total attempts to climb back
} as const;

/**
 * Measured frame time -> level (0 = best). Hysteresis: degrading needs a clearly bad window,
 * upgrading needs a long clean stretch with CPU headroom, and a level that had to be abandoned
 * right after an upgrade becomes the new best allowed level, so it never oscillates.
 */
export class QualityGovernor {
  level = 0;
  /** Last decision window (for diagnostics): share of slow frames and mean CPU ms. */
  lastWindow = { slow: 0, cpu: 0, mean: 0, frames: 0 };
  /** Best level still allowed (raised when an upgrade fails). */
  best = 0;
  private upgrades = 0;
  private windowStart = -1;
  private frames = 0;
  private slow = 0;
  private cpu = 0;
  private time = 0;
  private quietUntil = 0;
  private lastChange = 0;
  private lastWasUpgrade = false;
  private readonly maxLevel: number;
  constructor(maxLevel = AUTO_LEVEL_COUNT - 1) { this.maxLevel = maxLevel; }

  /** Ignore frames for a while (start, resume, resize, atlas rebuild). */
  hold(now: number, seconds: number = GOVERNOR.warmup): void {
    this.quietUntil = Math.max(this.quietUntil, now + seconds * 1000);
    this.windowStart = -1;
  }

  /** One rendered frame. Returns the new level when it changes, otherwise null. `now` in ms. */
  sample(frameMs: number, cpuMs: number, now: number): number | null {
    if (now < this.quietUntil || !(frameMs > 0) || frameMs > 250) return null;
    if (this.windowStart < 0) { this.windowStart = now; this.frames = this.slow = this.cpu = this.time = 0; }
    this.frames++; this.cpu += cpuMs; this.time += frameMs;
    if (frameMs > GOVERNOR.slowFrame) this.slow++;
    if (now - this.windowStart < GOVERNOR.window * 1000 || this.frames < 20) return null;
    const slowRatio = this.slow / this.frames, cpu = this.cpu / this.frames, mean = this.time / this.frames;
    this.windowStart = -1;
    this.lastWindow = { slow: +slowRatio.toFixed(3), cpu: +cpu.toFixed(2), mean: +mean.toFixed(2), frames: this.frames };
    if ((slowRatio > GOVERNOR.degradeRatio || mean > GOVERNOR.degradeMean) && this.level < this.maxLevel) {
      // A level that failed right after climbing to it is off-limits from now on.
      if (this.lastWasUpgrade && now - this.lastChange < GOVERNOR.upgradeAfter * 1000) this.best = this.level + 1;
      return this.change(this.level + 1, now, false);
    }
    if (slowRatio < GOVERNOR.upgradeRatio && mean < GOVERNOR.upgradeMean && cpu < GOVERNOR.upgradeCpu && this.level > this.best
      && this.upgrades < GOVERNOR.maxUpgrades && now - this.lastChange > GOVERNOR.upgradeAfter * 1000) {
      this.upgrades++;
      return this.change(this.level - 1, now, true);
    }
    return null;
  }

  private change(level: number, now: number, upgrade: boolean): number {
    this.level = level; this.lastChange = now; this.lastWasUpgrade = upgrade;
    this.hold(now);
    return level;
  }
}
