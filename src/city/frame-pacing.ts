// Even frame pacing. textmode's own limiter keeps the *average* rate at its target, so a 60 fps cap
// on a 120/144 Hz display renders on an uneven 2-3-2-2-3 vsync cadence (or 2-2-3-1 when timestamps
// jitter around 16.7 ms). Uneven cadence is judder, and judder under camera motion is one of the
// strongest motion-sickness triggers. The pacer instead measures the display's refresh period and
// renders on every k-th vsync, with k the smallest divisor that stays under the frame-rate cap.

/** Vsyncs per rendered frame: the highest even rate at or under `capHz` (never below 1). */
export function vsyncsPerFrame(periodMs: number, capHz: number): number {
  if (!(periodMs > 0) || !(capHz > 0)) return 1;
  // 3% slack: a 60.5 Hz panel under a 60 Hz cap still renders every vsync.
  return Math.max(1, Math.ceil(1000 / capHz / periodMs / 1.03));
}

/** Pure pacing state, fed with rAF timestamps: decides which vsyncs render. */
export class VsyncPacer {
  private deltas: number[] = [];
  private readonly sorted: number[] = [];
  private last = -1;
  private lastRender = -1;
  private capHz: number;
  period = 1000 / 60;
  constructor(capHz: number) { this.capHz = capHz; }
  setCap(capHz: number): void { this.capHz = capHz; }
  /** Forget timing history (after the loop was stopped, e.g. a hidden tab). */
  reset(): void { this.last = -1; this.lastRender = -1; }
  get interval(): number { return vsyncsPerFrame(this.period, this.capHz); }
  /** Returns true when this vsync should render a frame. */
  tick(timestamp: number): boolean {
    if (this.last >= 0) {
      const delta = timestamp - this.last;
      // Ignore stalls and doubled callbacks; a median of recent vsync gaps tracks the panel's rate.
      if (delta > 2 && delta < 60) {
        this.deltas.push(delta);
        if (this.deltas.length > 48) this.deltas.shift();
        // Perf: the median comes from a reused scratch copy; this runs on every vsync (up to 240 Hz).
        const sorted = this.sorted;
        sorted.length = 0;
        for (const value of this.deltas) sorted.push(value);
        sorted.sort((a, b) => a - b);
        this.period = sorted[sorted.length >> 1];
      }
    }
    this.last = timestamp;
    if (this.lastRender < 0) { this.lastRender = timestamp; return true; }
    // Count whole vsyncs since the last frame; rounding absorbs timestamp jitter.
    const vsyncs = Math.round((timestamp - this.lastRender) / this.period);
    if (vsyncs < this.interval) return false;
    this.lastRender = timestamp;
    return true;
  }
}

/** Drives `render` from requestAnimationFrame on an even vsync cadence. */
export function createFrameLoop(render: () => void, capHz: number): { start: () => void; stop: () => void; setCap: (capHz: number) => void; readonly running: boolean } {
  const pacer = new VsyncPacer(capHz);
  let handle: number | null = null;
  const frame = (timestamp: number) => {
    handle = requestAnimationFrame(frame);
    if (pacer.tick(timestamp)) render();
  };
  return {
    start() { if (handle === null) { pacer.reset(); handle = requestAnimationFrame(frame); } },
    stop() { if (handle !== null) { cancelAnimationFrame(handle); handle = null; } },
    setCap(next) { pacer.setCap(next); },
    get running() { return handle !== null; },
  };
}
