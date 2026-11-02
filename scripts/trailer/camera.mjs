// Camera paths for trailer shots. A pose is [x, height, z, yaw, pitch] (yaw 0 looks toward -z,
// positive yaw turns toward +x, positive pitch looks DOWN).

export const smooth = u => u * u * (3 - 2 * u);
export const smoother = u => u * u * u * (u * (u * 6 - 15) + 10);
export const easeOut = u => 1 - (1 - u) ** 3;
export const easeIn = u => u ** 3;
export const linear = u => u;
const clamp01 = u => Math.max(0, Math.min(1, u));

/** Yaw/pitch that look from `from` [x, height, z] at `to` [x, height, z]. */
export function aim(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return [Math.atan2(dx, -dz), -Math.atan2(dy, Math.hypot(dx, dz))];
}
/** A full pose at `from` looking at `to`. */
export const look = (from, to) => [...from, ...aim(from, to)];

function catmull(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** Smooth path through poses (Catmull-Rom, unwrapped yaw), traversed with `ease` over the shot. */
export function spline(poses, ease = smooth) {
  const keys = poses.map(p => [...p]);
  for (let i = 1; i < keys.length; i++) { let d = keys[i][3] - keys[i - 1][3]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; keys[i][3] = keys[i - 1][3] + d; }
  return u => {
    if (keys.length === 1) return keys[0];
    const s = clamp01(ease(clamp01(u))) * (keys.length - 1), i = Math.min(keys.length - 2, Math.floor(s)), f = s - i;
    const k = n => keys[Math.max(0, Math.min(keys.length - 1, n))];
    return keys[0].map((_, c) => catmull(k(i - 1)[c], k(i)[c], k(i + 1)[c], k(i + 2)[c], f));
  };
}

/** Position follows one path while the camera keeps looking at a (possibly moving) target. */
export function tracking(positionPath, targetPath) {
  return u => { const p = positionPath(u), t = targetPath(u); return [p[0], p[1], p[2], ...aim(p, t)]; };
}

/** Linear-ish path through 3D points with easing, for positions or targets. */
export function points(list, ease = smooth) {
  const poses = list.map(p => [...p, 0, 0]);
  const path = spline(poses, ease);
  return u => path(u).slice(0, 3);
}
