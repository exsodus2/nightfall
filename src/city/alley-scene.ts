import { PropRecorder, type PropCanvas } from "./prop-canvas.ts";
import { ink, propRange, restorePropRange, type ActivityView } from "./activity.ts";
import { drawLetterPanel } from "./signage.ts";
import { drawHuman } from "./human-model.ts";
import { LINE_PER_METRE } from "./landmarks-scene.ts";
import { alleysOf, type AlleyActor, type AlleyArm, type AlleyPart } from "./alleys.ts";
import { BLOCK_SIZE, type Block } from "./world.ts";

/**
 * Draws the themed alleys (alleys.ts has the layouts) through the instanced prop path. LOD: the
 * mouth hints (lanterns in the theme's colour, a shrine's red frame) reach 170 m, so a street
 * invites turning in; the dressing inside is drawn per part up to its own `near` distance (30-110 m),
 * and the material dissolves each part over the last quarter of that range instead of popping it.
 * Figures, the cat, drips and ripples only within 45 m. Small lights are never thinner than a
 * cell. Comfort: every light breathes at 0.4 Hz or slower; drips fall at 0.7 Hz, steam rises at
 * 0.25 Hz; nothing flashes.
 */

const DETAIL_REACH = 110, MOUTH_REACH = 170, LIFE_REACH = 45, SIGN_REACH = 90;

function drawPart(t: PropCanvas, part: AlleyPart, distance: number, time: number): void {
  let { w, h, d } = part;
  if (part.lit && Math.max(w, h, d) < 0.6) {
    const cell = distance * LINE_PER_METRE;
    w = Math.max(w, cell); h = Math.max(h, cell); d = Math.max(d, cell);
  }
  const gain = part.pulse ? part.gain * (1 + part.pulse.depth * Math.sin(time * part.pulse.rate + part.pulse.phase)) : part.gain;
  propRange(part.near);
  ink(t, part.color, part.glyph, gain);
  t.translate(part.x, -part.y, part.z);
  if (part.round) t.ellipsoid(w / 2, h / 2, d / 2); else t.box(w, h, d);
  t.translate(-part.x, part.y, -part.z);
}

function drawParts(t: PropCanvas, parts: readonly AlleyPart[], view: ActivityView, eyeY: number, time: number): void {
  for (const part of parts) {
    const dx = part.x - view.x, dz = part.z - view.z, dy = part.y - eyeY;
    const distance = Math.sqrt(dx * dx + dz * dz + dy * dy);
    if (distance < part.near) drawPart(t, part, distance, time);
  }
}

function drawActor(t: PropCanvas, actor: AlleyActor, distance: number, time: number): void {
  const cell = distance * LINE_PER_METRE;
  switch (actor.kind) {
    case "figure": {
      propRange(LIFE_REACH);
      t.push(); t.translate(actor.x, 0, actor.z); t.rotateY(actor.facing);
      drawHuman(t, actor.look, { time, seed: actor.seed, stride: 0, moving: false, detail: distance < 20, distant: distance > 30, seated: actor.seated, ...(actor.arms ? { arms: actor.arms } : {}) }, ink);
      t.pop();
      return;
    }
    case "cat": {
      if (distance > 30) return;
      propRange(30);
      t.push(); t.translate(actor.x, -actor.y, actor.z); t.rotateY(actor.facing);
      ink(t, actor.color, "o");
      t.translate(0, -0.14, 0); t.ellipsoid(0.13, 0.12, 0.24);
      t.translate(0, -0.12, -0.24); t.ellipsoid(0.09, 0.08, 0.08);
      if (distance < 15) {
        t.translate(-0.05, -0.08, 0); t.box(0.04, 0.07, 0.03); t.translate(0.1, 0, 0); t.box(0.04, 0.07, 0.03); t.translate(-0.05, 0.08, 0);
        // Eyes catching the light, and a tail that sways slowly (0.2 Hz) over the bin's edge.
        ink(t, [190, 230, 120], ".", 1.0); t.translate(0, 0, -0.08); t.box(0.11, 0.025, 0.02); t.translate(0, 0, 0.08);
      }
      ink(t, actor.color, "~");
      t.translate(0, 0.2, 0.52); t.rotateY(Math.sin(time * 1.3 + actor.seed) * 18); t.translate(0, 0, 0.12); t.box(0.04, 0.04, Math.max(0.3, cell));
      t.pop();
      return;
    }
    case "drip": {
      if (distance > 25) return;
      // A drop falls from the pipe to the floor every 1.4 s.
      const fall = ((time * 0.7 + actor.seed) % 1 + 1) % 1, y = actor.y * (1 - fall * fall), size = Math.max(0.05, cell);
      propRange(25);
      ink(t, [150, 200, 230], "'", 0.9);
      t.translate(actor.x, -y, actor.z); t.box(size, size * 1.6, size); t.translate(-actor.x, y, -actor.z);
      return;
    }
    case "ripple": {
      if (distance > 60) return;
      const offset = Math.sin(time * 0.35 + actor.seed) * actor.span / 2, band = Math.max(0.12, cell);
      const x = actor.axis === "x" ? actor.x + offset : actor.x, z = actor.axis === "z" ? actor.z + offset : actor.z;
      propRange(60);
      ink(t, [70, 122, 150], "-", 0.85);
      t.translate(x, -0.056, z); t.box(actor.axis === "x" ? band : actor.length, 0.01, actor.axis === "z" ? band : actor.length); t.translate(-x, 0.056, -z);
      return;
    }
    case "steam": {
      // Kitchen extractor steam: three soft puffs rising from the fan and swelling, one every 1.3 s
      // (a 4 s cycle), all above head height. Drawn as props (a vfx-scene volume reads as a wall up close).
      propRange(LIFE_REACH);
      for (let k = 0; k < 3; k++) {
        const phase = ((time * 0.25 + actor.seed + k / 3) % 1 + 1) % 1, r = 0.28 + phase * 0.45, y = 3.6 + phase * 2.6;
        ink(t, [128, 136, 142], phase < 0.5 ? ":" : ".", 0.62 - phase * 0.3);
        t.translate(actor.x, -y, actor.z); t.ellipsoid(r, r * 0.8, r); t.translate(-actor.x, y, -actor.z);
      }
      return;
    }
  }
}

function drawSigns(t: PropCanvas, arm: AlleyArm, view: ActivityView): void {
  const recorder = t instanceof PropRecorder ? t : null;
  for (const sign of arm.signs) {
    const distance = Math.hypot(sign.x - view.x, sign.z - view.z);
    if (distance > SIGN_REACH) continue;
    const tag = recorder ? recorder.panelTag : -1;
    // Captured with the shop panels (prop-canvas.ts replayPanels; the tag is the distance).
    if (recorder) recorder.panelTag = distance;
    propRange(SIGN_REACH);
    drawLetterPanel(t, sign);
    if (recorder) recorder.panelTag = tag;
  }
}

/** Draws every themed alley arm near the camera. `blocks` is CityWorld.blocks. */
export function drawAlleys(t: PropCanvas, view: ActivityView, time: number, blocks: ReadonlyMap<string, Block>): void {
  const scale = view.reach ?? 1, low = view.low;
  const mouthReach = (low ? 120 : MOUTH_REACH) * scale, detailReach = (low ? 75 : DETAIL_REACH) * scale;
  const eyeY = view.height, outer = propRange(0);
  const cx = Math.floor(view.x / BLOCK_SIZE), cz = Math.floor(view.z / BLOCK_SIZE), radius = Math.ceil(mouthReach / BLOCK_SIZE);
  for (let bz = cz - radius; bz <= cz + radius; bz++) for (let bx = cx - radius; bx <= cx + radius; bx++) {
    for (const arm of alleysOf(blocks, bx, bz)) {
      const toArm = Math.hypot(arm.cx - view.x, arm.cz - view.z) - arm.radius;
      if (toArm > mouthReach) continue;
      if (view.visible && !view.visible(arm.cx, 4, arm.cz, arm.radius + 2)) continue;
      drawParts(t, arm.mouth, view, eyeY, time);
      if (toArm > detailReach) continue;
      drawParts(t, arm.parts, view, eyeY, time);
      drawSigns(t, arm, view);
      if (toArm > LIFE_REACH) continue;
      for (const actor of arm.actors) {
        const distance = Math.hypot(actor.x - view.x, actor.z - view.z);
        if (distance < LIFE_REACH) drawActor(t, actor, distance, time);
      }
    }
  }
  restorePropRange(outer);
}
