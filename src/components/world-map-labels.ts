/**
 * Cheap label collision avoidance for the world map overlay (world-map-render.ts): each label
 * reserves its screen box; a later label tries a few row offsets and takes the first free one.
 * Monospace text is measured by character count (no measureText per frame). Pure, so tests can
 * drive it without a canvas.
 */

export interface LabelBox { x0: number; y0: number; x1: number; y1: number }

/** Width of `text` set in a monospace font of `size` px (Cascadia / Consolas advance ~0.6 em). */
export const monoWidth = (text: string, size: number): number => text.length * size * 0.6;

export class LabelSpace {
  private readonly boxes: LabelBox[] = [];

  get count(): number { return this.boxes.length; }

  /** True when the box overlaps nothing reserved so far. */
  free(box: LabelBox): boolean {
    for (const other of this.boxes) if (box.x0 < other.x1 && box.x1 > other.x0 && box.y0 < other.y1 && box.y1 > other.y0) return false;
    return true;
  }

  reserve(box: LabelBox): void { this.boxes.push(box); }

  /**
   * Place a centred label of the given size whose vertical centre is `y + offset` for the first
   * offset that is free, reserve it and return that centre. With `force`, a label that fits
   * nowhere still takes the first offset (it is reserved too); otherwise null (skip drawing it).
   */
  place(x: number, y: number, width: number, height: number, offsets: readonly number[], force = false): number | null {
    const box = (cy: number): LabelBox => ({ x0: x - width / 2 - 2, y0: cy - height / 2, x1: x + width / 2 + 2, y1: cy + height / 2 });
    for (const offset of offsets) {
      const candidate = box(y + offset);
      if (this.free(candidate)) { this.reserve(candidate); return y + offset; }
    }
    if (!force || !offsets.length) return null;
    this.reserve(box(y + offsets[0]));
    return y + offsets[0];
  }
}
