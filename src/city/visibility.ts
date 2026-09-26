import type { Building } from "./world";
export interface SightPoint { x: number; y: number; z: number }
/** Conservative segment/AABB visibility for small street-level props. The
 * skyline is never culled with this test: rooftops remain visible above walls. */
export function visibleFrom(eye: SightPoint, target: SightPoint, occluders: readonly Building[]): boolean {
  const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
  for (const b of occluders) {
    let near = 0.001, far = 0.995;
    for (let axis = 0; axis < 3; axis++) {
      const origin = axis === 0 ? eye.x : axis === 1 ? eye.y : eye.z;
      const direction = axis === 0 ? dx : axis === 1 ? dy : dz;
      const min = axis === 0 ? b.x - b.width / 2 : axis === 1 ? 0 : b.z - b.depth / 2;
      const max = axis === 0 ? b.x + b.width / 2 : axis === 1 ? b.height : b.z + b.depth / 2;
      if (Math.abs(direction) < 0.00001) { if (origin < min || origin > max) { near = 2; break; } }
      else { const a = (min - origin) / direction, c = (max - origin) / direction; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); }
      if (near > far) break;
    }
    if (near <= far) return false;
  }
  return true;
}

/** Cull only when a single solid occluder covers the entire expanded building
 * box in BOTH real and reflected views. This removes zero visible geometry. */
export function fullyHidden(eye: SightPoint, target: Building, occluders: readonly Building[]): boolean {
  for (const other of occluders) {
    if (other.id === target.id) continue;
    const scale = other.style === 4 ? 0.55 : other.style === 7 ? 0.64 : 0.89;
    const solid = [{ ...other, x: other.x - (other.style === 4 ? other.width * 0.2 : 0), width: other.width * scale, depth: other.depth * scale }];
    if (visibleFrom(eye, { x: target.x, y: target.height / 2, z: target.z }, solid)) continue;
    let covered = true;
    for (const x of [target.x - target.width / 2 - 3, target.x + target.width / 2 + 3]) {
      for (const z of [target.z - target.depth / 2 - 3, target.z + target.depth / 2 + 3]) {
        for (const y of [0.1, target.height + 24]) {
          if (visibleFrom(eye, { x, y, z }, solid) || visibleFrom({ ...eye, y: -eye.y }, { x, y, z }, solid)) { covered = false; break; }
        }
        if (!covered) break;
      }
      if (!covered) break;
    }
    if (covered) return true;
  }
  return false;
}
