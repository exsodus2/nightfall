import { PropRecorder, type PropCanvas } from "./prop-canvas.ts";
import { ink, propRange, restorePropRange, type ActivityView } from "./activity.ts";
import { drawLetterPanel } from "./signage.ts";
import { LINE_PER_METRE } from "./landmarks-scene.ts";
import { POND } from "./park.ts";
import type { Block, RGB } from "./world.ts";
import type { RpgSession } from "../rpg/session.ts";
import type { FlagValue } from "../rpg/types.ts";
import {
  BENCH_PLAQUE, CARRIAGE, GRAFFITI_WORDS, KOI, LIFT_PANEL, LOST_FOUND, MANHOLE, MIRROR_FRONT, SECRET_FLAGS, SECRET_MOTION, SECRET_SPOTS, SecretWatch, WALL_PROPS,
  graffitiFace, guideLength, guidePoint, guideStep, koiPixels, koiSlot, koiSwim, phoneRinging, rate, roomSecretFor, secretAlleyParts, secretFlag, setSecretFlagReader, wallFrame,
  type SecretPart, type WallFrame,
} from "./secrets.ts";

/**
 * Draws the city's secrets (secrets.ts has the data) through the instanced prop path, and runs their
 * small per-frame logic: the discovery toasts, the payphone's ring, the koi that spell a word for
 * someone who stands still, and the cat that leads the way to its shrine.
 *
 * Budgets: static parts are drawn per part up to their own `near` distance (<= 90 m) and fade like
 * the alley props; animated things (cats, koi, the phone's handset, steam) only within 60 m and not
 * on the low profile, where they hold a still pose instead. Comfort: every motion is listed in
 * SECRET_MOTION (all <= 0.4 Hz); nothing flashes.
 */

const LIFE_REACH = 60, SIGN_REACH = 90;
type FlagGetter = (key: string) => FlagValue | undefined;

// ---- Session hooks (once per session) -------------------------------------------------------------

const watched = new WeakSet<RpgSession>();
/** Subscribes the discovery counter (toasts "A secret: 7/20") and counts hidden rooms on entry. */
function watch(rpg: RpgSession): void {
  if (watched.has(rpg)) return;
  watched.add(rpg);
  const flags = rpg.quests.flags, counter = new SecretWatch(key => flags.get(key));
  setSecretFlagReader(key => flags.get(key));
  rpg.bus.on("flag", event => {
    const text = counter.note(event.key, event.value);
    if (text) rpg.bus.emit({ type: "message", text, tone: "loot" });
  });
  rpg.bus.on("entered", event => {
    const secret = roomSecretFor(event.area);
    if (secret) rpg.quests.setFlag(secretFlag(secret), true);
  });
}

// ---- Per-frame state: the koi and the guide cat ---------------------------------------------------

interface SecretState { lastTime: number; anchorX: number; anchorZ: number; stillSince: number; gather: number; reader: { x: number; z: number } | null; guide: number }
const state: SecretState = { lastTime: NaN, anchorX: NaN, anchorZ: NaN, stillSince: 0, gather: 0, reader: null, guide: 0 };

function tick(rpg: RpgSession, view: ActivityView, time: number): void {
  const flag: FlagGetter = key => rpg.quests.flags.get(key);
  const dt = Number.isFinite(state.lastTime) ? Math.max(0, Math.min(0.25, time - state.lastTime)) : 0;
  if (dt === 0 && time === state.lastTime) return; // the main and reflected passes share a frame
  state.lastTime = time;
  // The payphone rings for the first 30 s of every even minute; the content reads this flag.
  const phone = SECRET_SPOTS.payphone, ringing = Math.hypot(view.x - phone.x, view.z - phone.z) < 30 && phoneRinging(time);
  if (Boolean(flag(SECRET_FLAGS.ringing)) !== ringing) rpg.quests.setFlag(SECRET_FLAGS.ringing, ringing);
  // Koi: stand still near the pond for 20 s and they gather into a word that faces you.
  const nearPond = Math.hypot(view.x - POND.x, view.z - POND.z) < KOI.reach && view.height < 4.5;
  if (!nearPond || !(Math.hypot(view.x - state.anchorX, view.z - state.anchorZ) < 0.35)) { state.anchorX = view.x; state.anchorZ = view.z; state.stillSince = time; }
  const still = nearPond && time - state.stillSince >= KOI.stillSeconds;
  if (still && state.gather === 0) state.reader = { x: view.x, z: view.z };
  state.gather = Math.max(0, Math.min(1, state.gather + (still ? dt / KOI.gatherSeconds : -dt / KOI.scatterSeconds)));
  if (state.gather >= 1 && !flag(secretFlag("koi"))) {
    rpg.bus.emit({ type: "message", text: "In the dark water, the koi spell a word: STAY.", tone: "info" });
    rpg.quests.setFlag(secretFlag("koi"), true);
  }
  // The guide cat: once all three cats know you, it walks ahead of you to its shrine.
  if (guideActive(flag)) state.guide = guideStep(state.guide, view, dt);
}
const guideActive = (flag: FlagGetter): boolean => SECRET_FLAGS.cats.every(key => flag(key)) && !flag(secretFlag("cat"));

// ---- Drawing helpers ------------------------------------------------------------------------------

function box(t: PropCanvas, x: number, y: number, z: number, w: number, h: number, d: number): void {
  t.translate(x, -y, z); t.box(w, h, d); t.translate(-x, y, -z);
}
function blob(t: PropCanvas, x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
  t.translate(x, -y, z); t.ellipsoid(rx, ry, rz); t.translate(-x, y, -z);
}
function drawPart(t: PropCanvas, part: SecretPart, distance: number, time: number): void {
  let { w, h, d } = part;
  if (part.lit && Math.max(w, h, d) < 0.6) { const cell = distance * LINE_PER_METRE; w = Math.max(w, cell); h = Math.max(h, cell); d = Math.max(d, cell); }
  const gain = part.pulse ? part.gain * (1 + part.pulse.depth * Math.sin(time * part.pulse.rate + part.pulse.phase)) : part.gain;
  propRange(part.near);
  ink(t, part.color, part.glyph, gain);
  if (part.round) blob(t, part.x, part.y, part.z, w / 2, h / 2, d / 2); else box(t, part.x, part.y, part.z, w, h, d);
}

function panel(t: PropCanvas, view: ActivityView, face: { x: number; y: number; z: number; yaw: number; width: number; height: number }, text: string, color: RGB): void {
  const distance = Math.hypot(face.x - view.x, face.z - view.z);
  if (distance > SIGN_REACH || (view.visible && !view.visible(face.x, face.y, face.z, face.width))) return;
  const recorder = t instanceof PropRecorder ? t : null, tag = recorder ? recorder.panelTag : -1;
  // Captured with the shop panels (prop-canvas.ts replayPanels; the tag is the distance), as alley signs are.
  if (recorder) recorder.panelTag = distance;
  propRange(SIGN_REACH);
  // Sign shader mode 3 (floor(seed * 97) mod 4): a slow 0.2 Hz breath, never a stutter.
  drawLetterPanel(t, { ...face, text, color, vertical: false, seed: (3.5 + 4 * (text.length % 23)) / 97 });
  if (recorder) recorder.panelTag = tag;
}

/** A small black cat: sitting (tail curled and swaying at 0.2 Hz) or walking (tail up). */
function drawCat(t: PropCanvas, x: number, y: number, z: number, facing: number, time: number, distance: number, walking: boolean, animate: boolean): void {
  propRange(LIFE_REACH);
  t.push(); t.translate(x, -y, z); t.rotateY(facing);
  if (walking) { ink(t, [22, 22, 28], "|"); for (const side of [-1, 1]) for (const end of [-1, 1]) box(t, side * 0.06, 0.08, end * 0.14, 0.04, 0.16, 0.04); }
  ink(t, [22, 22, 28], "o");
  t.translate(0, walking ? -0.2 : -0.14, 0); t.ellipsoid(0.13, walking ? 0.1 : 0.12, 0.24);
  t.translate(0, walking ? -0.06 : -0.12, -0.24); t.ellipsoid(0.09, 0.08, 0.08);
  if (distance < 15) {
    t.translate(-0.05, -0.08, 0); t.box(0.04, 0.07, 0.03); t.translate(0.1, 0, 0); t.box(0.04, 0.07, 0.03); t.translate(-0.05, 0.08, 0);
    ink(t, [190, 230, 120], ".", 1.0); t.translate(0, 0, -0.08); t.box(0.11, 0.025, 0.02); t.translate(0, 0, 0.08);
  }
  ink(t, [22, 22, 28], "~");
  const sway = animate ? Math.sin(time * rate("tailHz")) * 18 : 0;
  t.translate(0, walking ? -0.05 : 0.2, 0.52); t.rotateY(sway); if (walking) t.rotateX(-50); t.translate(0, 0, 0.12); t.box(0.04, 0.04, Math.max(0.3, distance * LINE_PER_METRE));
  t.pop();
}

// ---- Cached anchors ------------------------------------------------------------------------------

interface Anchors { frames: Map<string, WallFrame>; cats: { key: string; x: number; y: number; z: number; facing: number }[] }
const anchorCache = new WeakMap<ReadonlyMap<string, Block>, Anchors>();
function anchors(blocks: ReadonlyMap<string, Block>): Anchors {
  let found = anchorCache.get(blocks);
  if (found) return found;
  const frames = new Map<string, WallFrame>(), cats: Anchors["cats"] = [];
  for (const spot of WALL_PROPS) {
    const frame = wallFrame(blocks, spot);
    if (!frame) continue;
    frames.set(spot.key, frame);
    if (spot.kind === "cat") cats.push({ key: spot.key, x: spot.x, y: 0.6, z: frame.wallZ + frame.out * 0.4, facing: frame.out > 0 ? 180 : 0 });
  }
  found = { frames, cats };
  anchorCache.set(blocks, found);
  return found;
}

// ---- The scene ------------------------------------------------------------------------------------

/** Draws every secret near the camera and runs the secrets' per-frame logic. Called once per
 * recorded prop pass (engine.ts recordProps). */
export function drawSecrets(t: PropCanvas, view: ActivityView, time: number, rpg: RpgSession, blocks: ReadonlyMap<string, Block>): void {
  watch(rpg);
  tick(rpg, view, time);
  const flag: FlagGetter = key => rpg.quests.flags.get(key), animate = !view.low;
  const outer = propRange(0), eyeY = view.height, found = anchors(blocks);
  const near = (x: number, z: number, reach: number) => Math.hypot(x - view.x, z - view.z) < reach * (view.reach ?? 1);

  // Static alley props (fridge, shrine, phone, machine, valves, tiny door, cabinet, ladder, boards).
  for (const part of secretAlleyParts(blocks)) {
    const dx = part.x - view.x, dz = part.z - view.z, dy = part.y - eyeY, distance = Math.sqrt(dx * dx + dz * dz + dy * dy);
    if (distance >= part.near || (view.visible && distance > 12 && !view.visible(part.x, part.y, part.z, Math.max(part.w, part.h, part.d)))) continue;
    drawPart(t, part, distance, time);
  }

  // The three cats on their crates; the Silk Market cat leaves its crate to guide you, and once the
  // shrine's bowl is taken it sits by the shrine for good.
  const guiding = guideActive(flag), settled = Boolean(flag(secretFlag("cat")));
  for (const cat of found.cats) {
    if ((guiding || settled) && cat.key === "cat3") continue;
    const distance = Math.hypot(cat.x - view.x, cat.z - view.z);
    if (distance < LIFE_REACH) drawCat(t, cat.x, cat.y, cat.z, cat.facing, time, distance, false, animate);
  }
  if (guiding || settled) {
    const end = guideLength(), progress = settled || !animate ? end : state.guide, at = guidePoint(progress);
    const distance = Math.hypot(at.x - view.x, at.z - view.z), walking = animate && !settled && progress < end - 0.05 && Math.hypot(view.x - at.x, view.z - at.z) < 12;
    // Walking: face the way it goes; waiting: face you.
    const facing = walking ? Math.atan2(-at.dx, -at.dz) * 180 / Math.PI : Math.atan2(-(view.x - at.x), -(view.z - at.z)) * 180 / Math.PI;
    if (distance < LIFE_REACH) drawCat(t, at.x, 0, at.z, facing, time, distance, walking, animate);
  }

  // The payphone's handset jumps a little while it rings, and a RING sign glows over the hood.
  const phoneFrame = found.frames.get("payphone");
  if (phoneFrame && near(phoneFrame.x, phoneFrame.wallZ, LIFE_REACH)) {
    const ringing = phoneRinging(time), z = phoneFrame.wallZ + phoneFrame.out * 0.4;
    propRange(LIFE_REACH);
    ink(t, [30, 30, 34], "=");
    t.push(); t.translate(phoneFrame.x + 0.28, -1.4, z); if (ringing && animate) t.rotateZ(Math.sin(time * rate("ringHz")) * 5); t.box(0.08, 0.36, 0.1); t.pop();
    if (ringing) panel(t, view, { x: phoneFrame.x, y: 2.62, z: phoneFrame.wallZ + phoneFrame.out * 0.06, yaw: phoneFrame.out > 0 ? 0 : 180, width: 0.9, height: 0.3 }, "RING", [140, 220, 255]);
  }

  // Panels: the six painted words, the hidden valve sign, and the small signs on the props.
  for (const [index, spot] of GRAFFITI_WORDS.entries()) {
    const face = graffitiFace(blocks, index);
    if (face && near(face.x, face.z, SIGN_REACH)) panel(t, view, face, spot.word, spot.color);
  }
  const valves = found.frames.get("valves");
  if (valves && flag(secretFlag("valves")) && near(valves.x, valves.wallZ, SIGN_REACH)) panel(t, view, { x: valves.x, y: 4.3, z: valves.wallZ + valves.out * 0.06, yaw: valves.out > 0 ? 0 : 180, width: 7, height: 0.8 }, "THE PIPES SAY HI", [255, 200, 120]);
  const labels: readonly (readonly [key: string, text: string, y: number, width: number, color: RGB])[] = [
    ["vending", "FORTUNA", 2.05, 1.0, [255, 170, 230]], ["ladder", "FIRE ESCAPE", 2.95, 1.6, [120, 255, 150]],
    ["cabinet", "HI SCORE", 1.95, 0.8, [120, 255, 140]], ["boarded", "NOTHING HERE", 2.55, 1.7, [255, 255, 255]],
  ];
  for (const [key, text, y, width, color] of labels) {
    const frame = found.frames.get(key);
    if (frame && near(frame.x, frame.wallZ, SIGN_REACH)) panel(t, view, { x: frame.x, y, z: frame.wallZ + frame.out * (key === "vending" || key === "cabinet" ? 0.82 : 0.08), yaw: frame.out > 0 ? 0 : 180, width, height: 0.26 }, text, color);
  }

  drawStreetProps(t, view, time, animate, near);
  if (animate && near(POND.x, POND.z, LIFE_REACH + POND.rx)) drawKoi(t, view, time);
  restorePropRange(outer);
}

/** Props outside the alleys: the Mirror Shop's front, the lift panel, Lost and Found, Mira's bench,
 * the manhole, and the still carriage in the Foundry Gate yard. */
function drawStreetProps(t: PropCanvas, view: ActivityView, time: number, animate: boolean, near: (x: number, z: number, reach: number) => boolean): void {
  if (near(MIRROR_FRONT.x, MIRROR_FRONT.face, 100)) {
    const { x, face } = MIRROR_FRONT;
    propRange(100);
    ink(t, [200, 170, 255], "|", 0.95);
    for (const side of [-1, 1]) box(t, x + side * 1.2, 2.0, face + 0.1, 0.14, 3.7, 0.16);
    box(t, x, 3.87, face + 0.1, 2.5, 0.14, 0.16);
    ink(t, [16, 18, 30], " "); box(t, x, 1.9, face + 0.05, 2.1, 3.6, 0.06);
    panel(t, view, { x, y: 4.6, z: face + 0.12, yaw: 0, width: 3.6, height: 0.6 }, "POHS RORRIM", [200, 170, 255]);
    panel(t, view, { x: x + 1.9, y: 2.6, z: face + 0.12, yaw: 0, width: 1.0, height: 0.3 }, "NEPO", [255, 210, 160]);
  }
  if (near(LIFT_PANEL.x, LIFT_PANEL.z, 70)) {
    propRange(70);
    ink(t, [60, 64, 72], "#"); box(t, LIFT_PANEL.x, 0.75, LIFT_PANEL.z, 0.3, 1.5, 0.35);
    ink(t, [255, 220, 150], ".", 0.95); for (let k = 0; k < 6; k++) box(t, LIFT_PANEL.x - 0.16, 0.7 + k * 0.1, LIFT_PANEL.z, 0.02, 0.05, 0.05);
    panel(t, view, { x: LIFT_PANEL.x - 0.17, y: 1.38, z: LIFT_PANEL.z, yaw: -90, width: 0.34, height: 0.14 }, "1210", [255, 120, 180]);
  }
  if (near(LOST_FOUND.x, LOST_FOUND.z, 80)) {
    const { x, z, width } = LOST_FOUND;
    propRange(80);
    ink(t, [80, 70, 60], "#"); box(t, x, 0.55, z, width, 1.1, 0.7);
    ink(t, [200, 190, 170], "="); box(t, x, 1.12, z, width + 0.1, 0.05, 0.8);
    ink(t, [50, 48, 46], "#"); box(t, x, 1.4, z - 0.45, width, 2.8, 0.08);
    const things: readonly RGB[] = [[200, 60, 60], [80, 140, 220], [230, 200, 90], [120, 200, 120], [220, 220, 220]];
    for (const [k, color] of things.entries()) { ink(t, color, "o"); box(t, x - 0.7 + k * 0.35, 1.6 + (k % 2) * 0.5, z - 0.36, 0.2, 0.22, 0.1); }
    panel(t, view, { x, y: 2.6, z: z - 0.38, yaw: 0, width: 1.8, height: 0.3 }, "LOST AND FOUND", [255, 220, 150]);
  }
  if (near(BENCH_PLAQUE.x, BENCH_PLAQUE.z, 40)) {
    propRange(40);
    ink(t, [255, 200, 120], "=", 0.9); box(t, BENCH_PLAQUE.x, 0.82, BENCH_PLAQUE.z, 0.22, 0.08, 0.22);
    ink(t, [255, 120, 160], "*", 0.95); for (let k = 0; k < 3; k++) box(t, BENCH_PLAQUE.x + 0.35 + k * 0.06, 0.52, BENCH_PLAQUE.z + (k - 1) * 0.06, 0.06, 0.06, 0.06);
  }
  if (near(MANHOLE.x, MANHOLE.z, 70)) {
    propRange(70);
    ink(t, [64, 66, 70], "#"); blob(t, MANHOLE.x, 0.015, MANHOLE.z, 0.5, 0.015, 0.5);
    ink(t, [80, 230, 200], ".", 0.9); for (let k = 0; k < 6; k++) box(t, MANHOLE.x + Math.cos(k * 1.05) * 0.28, 0.035, MANHOLE.z + Math.sin(k * 1.05) * 0.28, 0.05, 0.01, 0.05);
    if (animate && near(MANHOLE.x, MANHOLE.z, LIFE_REACH)) {
      // A slow wisp of steam (one puff every 5 s), above the cover, never a flash.
      for (let k = 0; k < 3; k++) {
        const phase = ((time * SECRET_MOTION.steamHz + k / 3) % 1 + 1) % 1, r = 0.2 + phase * 0.35;
        ink(t, [120, 140, 140], phase < 0.5 ? ":" : ".", 0.5 - phase * 0.3); blob(t, MANHOLE.x, 0.4 + phase * 2.2, MANHOLE.z, r, r * 0.8, r);
      }
    }
  }
  if (near(CARRIAGE.x, CARRIAGE.z, 160)) {
    const { x, z, length, width } = CARRIAGE, door = z + width / 2;
    propRange(160);
    ink(t, [70, 66, 62], "="); for (const side of [-1, 1]) box(t, x, 0.04, z + side * 0.75, length + 10, 0.08, 0.12);
    ink(t, [40, 40, 44], "#"); for (const end of [-1, 1]) box(t, x + end * (length / 2 - 2.5), 0.4, z, 2.4, 0.6, width - 0.6);
    ink(t, [128, 58, 48], "#"); box(t, x, 2.15, z, length, 2.9, width);
    ink(t, [90, 92, 96], "="); box(t, x, 3.66, z, length - 0.4, 0.14, width - 0.4);
    ink(t, [255, 214, 140], "=", 0.92); for (const side of [-1, 1]) box(t, x, 2.3, z + side * (width / 2 + 0.01), length - 1.2, 0.7, 0.02);
    ink(t, [255, 226, 170], "#", 1.0); box(t, x, 1.6, door + 0.02, 1.3, 2.0, 0.02);
    panel(t, view, { x, y: 3.25, z: door + 0.04, yaw: 0, width: 2.2, height: 0.34 }, "LAST STOP", [255, 170, 60]);
  }
}

const KOI_INKS: readonly RGB[] = [[255, 140, 60], [235, 232, 220], [255, 196, 80], [255, 110, 70]];
/** The pond's koi: slow loops, or the word once someone has stood still long enough. */
function drawKoi(t: PropCanvas, view: ActivityView, time: number): void {
  const count = koiPixels().length, blend = state.gather * state.gather * (3 - 2 * state.gather), reader = state.reader ?? view;
  // In the word every koi points away from the reader, up its letter.
  const away = Math.atan2(-(POND.x - reader.x), -(POND.z - reader.z));
  propRange(LIFE_REACH);
  for (let i = 0; i < count; i++) {
    const swim = koiSwim(i, time), slot = koiSlot(i, reader);
    const x = swim.x + (slot.x - swim.x) * blend, z = swim.z + (slot.z - swim.z) * blend;
    const distance = Math.hypot(x - view.x, z - view.z);
    if (distance > LIFE_REACH) continue;
    // Heading in rotateY radians (a figure faces -z at 0), turned smoothly from the swim to the word.
    const swimming = Math.atan2(-swim.dx, -swim.dz), turn = Math.atan2(Math.sin(away - swimming), Math.cos(away - swimming));
    ink(t, KOI_INKS[i % KOI_INKS.length], "o", 0.6 + 0.3 * blend);
    t.push(); t.translate(x, -0.03, z); t.rotateY((swimming + turn * blend) * 180 / Math.PI);
    t.ellipsoid(0.11, 0.035, 0.28);
    if (distance < 25) { t.translate(0, 0, 0.32); t.box(0.14, 0.02, 0.1); }
    t.pop();
  }
}
