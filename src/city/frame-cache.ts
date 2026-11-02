// Perf: per-frame memos for the render loop that allocate nothing in steady state.

/**
 * Prop visibility answers for one frame, keyed by the exact (x, y, z, radius) of the query. It
 * replaces a Map keyed by a template string, which converted four floats to text on every query.
 * Open addressing over typed arrays; `clear()` is O(1) (a generation stamp). Keys compare with
 * `===`, so -0 and 0 are the same query (as their strings were); a NaN key is never found, which
 * only means the caller recomputes it.
 */
export class VisibilityCache {
  private keys: Float64Array;
  private stamps: Uint32Array;
  private values: Uint8Array;
  private mask: number;
  private generation = 1;
  private size = 0;
  private readonly bits = new Float64Array(1);
  private readonly words = new Uint32Array(this.bits.buffer);

  constructor(capacity = 2048) {
    const slots = 1 << Math.ceil(Math.log2(Math.max(16, capacity)));
    this.keys = new Float64Array(slots * 4); this.stamps = new Uint32Array(slots); this.values = new Uint8Array(slots); this.mask = slots - 1;
  }

  /** Forgets every answer (call once per frame). */
  clear(): void {
    this.size = 0;
    if (++this.generation >= 0xffffffff) { this.stamps.fill(0); this.generation = 1; }
  }

  get count(): number { return this.size; }

  /** The stored answer, or undefined. */
  get(x: number, y: number, z: number, radius: number): boolean | undefined {
    for (let slot = this.hash(x, y, z, radius) & this.mask; ; slot = (slot + 1) & this.mask) {
      if (this.stamps[slot] !== this.generation) return undefined;
      const k = slot * 4, keys = this.keys;
      if (keys[k] === x && keys[k + 1] === y && keys[k + 2] === z && keys[k + 3] === radius) return this.values[slot] === 1;
    }
  }

  set(x: number, y: number, z: number, radius: number, visible: boolean): void {
    if ((this.size + 1) * 2 > this.stamps.length) this.grow();
    this.insert(x, y, z, radius, visible ? 1 : 0);
  }

  private insert(x: number, y: number, z: number, radius: number, value: number): void {
    for (let slot = this.hash(x, y, z, radius) & this.mask; ; slot = (slot + 1) & this.mask) {
      const k = slot * 4, keys = this.keys;
      if (this.stamps[slot] !== this.generation) {
        this.stamps[slot] = this.generation; keys[k] = x; keys[k + 1] = y; keys[k + 2] = z; keys[k + 3] = radius; this.values[slot] = value;
        this.size++;
        return;
      }
      if (keys[k] === x && keys[k + 1] === y && keys[k + 2] === z && keys[k + 3] === radius) { this.values[slot] = value; return; }
    }
  }

  private grow(): void {
    const { keys, stamps, values, generation } = this, slots = stamps.length * 2;
    this.keys = new Float64Array(slots * 4); this.stamps = new Uint32Array(slots); this.values = new Uint8Array(slots); this.mask = slots - 1;
    this.size = 0; this.generation = 1;
    for (let slot = 0; slot < stamps.length; slot++) {
      if (stamps[slot] === generation) this.insert(keys[slot * 4], keys[slot * 4 + 1], keys[slot * 4 + 2], keys[slot * 4 + 3], values[slot]);
    }
  }

  private mix(h: number, value: number): number {
    // -0 hashes as 0, matching the === comparison.
    this.bits[0] = value === 0 ? 0 : value;
    h = Math.imul(h ^ this.words[0], 0x9e3779b1);
    h = Math.imul(h ^ this.words[1], 0x85ebca6b);
    return h ^ (h >>> 15);
  }

  private hash(x: number, y: number, z: number, radius: number): number {
    return this.mix(this.mix(this.mix(this.mix(0x811c9dc5, x), y), z), radius) >>> 0;
  }
}

/** Perf: the `count` cars nearest (x, z) into `out` as headlight slots, nearest first; equal
 *  distances keep list order (what a stable sort of the whole list gave). */
const carDistances: number[] = [], carOrder: number[] = [];
export function nearestCars(cars: readonly { x: number; z: number; yaw: number; trailing?: boolean }[], x: number, z: number, count: number, out: { x: number; z: number; yaw: number; intensity: number }[], range = Infinity): void {
  carOrder.length = 0;
  // The nearest excluded car (or the query range): the selected lights fade to nothing by that distance,
  // so a car crossing in or out of the last slot never pops its light pool on or off (animation polish).
  let cutoff = range;
  for (let i = 0; i < cars.length; i++) {
    if (cars[i].trailing) continue; // a long vehicle's rear footprint (traffic.nearby): collision only, no second headlight
    const distance = Math.hypot(cars[i].x - x, cars[i].z - z);
    carDistances[i] = distance;
    if (carOrder.length === count && distance >= carDistances[carOrder[count - 1]]) { if (distance < cutoff) cutoff = distance; continue; }
    let at = carOrder.length;
    while (at > 0 && carDistances[carOrder[at - 1]] > distance) at--;
    carOrder.splice(at, 0, i);
    if (carOrder.length > count) { const dropped = carDistances[carOrder.pop()!]; if (dropped < cutoff) cutoff = dropped; }
  }
  const band = Math.max(8, cutoff * 0.25);
  for (const i of carOrder) out.push({ x: cars[i].x, z: cars[i].z, yaw: cars[i].yaw, intensity: Number.isFinite(cutoff) ? Math.max(0, Math.min(1, (cutoff - carDistances[i]) / band)) : 1 });
}

/**
 * Perf: a conservative view cone for steep views (looking down from the air, where the engine's
 * horizontal cone test is off). It is the cone around the view direction that contains the whole
 * frustum - its half-angle is the half-diagonal of the view plus a margin - so a sphere it rejects
 * is certainly off screen. World axes as in the engine's culling: y up, positive pitch looks down,
 * forward (sin yaw, -cos yaw) on the ground.
 */
export class ViewCone {
  private ex = 0; private ey = 0; private ez = 0;
  private fx = 0; private fy = 0; private fz = 0;
  private half = Math.PI;
  /** `verticalFov` in degrees, `aspect` = width / height, `margin` in radians. */
  set(x: number, y: number, z: number, yaw: number, pitch: number, verticalFov: number, aspect: number, margin = 0.25): void {
    const tanV = Math.tan(verticalFov * Math.PI / 360), tanH = tanV * aspect;
    this.ex = x; this.ey = y; this.ez = z;
    this.fx = Math.sin(yaw) * Math.cos(pitch); this.fy = -Math.sin(pitch); this.fz = -Math.cos(yaw) * Math.cos(pitch);
    this.half = Math.atan(Math.hypot(tanV, tanH)) + margin;
  }
  /** False only when the sphere (centre, radius) lies wholly outside the cone. */
  sees(x: number, y: number, z: number, radius: number): boolean {
    const dx = x - this.ex, dy = y - this.ey, dz = z - this.ez, distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance <= radius) return true;
    const limit = this.half + Math.asin(Math.min(1, radius / distance));
    if (limit >= Math.PI) return true;
    return (dx * this.fx + dy * this.fy + dz * this.fz) / distance >= Math.cos(limit);
  }
}
