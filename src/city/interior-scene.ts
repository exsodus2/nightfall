import type { PropCanvas } from "./prop-canvas.ts";
import type { RGB } from "./world.ts";
import { INTERIOR_HEIGHT, facingIn, interiorLocal, interiorOccupant, interiorWorld, isGroundFloorKind, type GroundFloorKind, type InteriorFixture, type InteriorPlace } from "./interiors.ts";
import { groundFloorPlan } from "./building-interiors.ts";
import { floorTitle, upperBackdrop, upperOpenAir, upperVariant, type UpperVariant } from "./upper-floors.ts";
import { drawHuman } from "./human-model.ts";
import { miniFontBytes } from "./mini-font.ts";
import type { InteractableDefinition } from "../rpg/types.ts";
import type { InteriorWorkState, InteriorWorkTag } from "./interior-work-state.ts";
import { SECRET_FLAGS, SECRET_MOTION, isSecretKind, rate, secretFlag, secretFlagValue } from "./secrets.ts";

const WALL: RGB = [72, 84, 98];
const METAL: RGB = [108, 129, 141];
const WOOD: RGB = [151, 110, 78];
const WARM: RGB = [255, 206, 138];
const DARK: RGB = [26, 36, 48];
const SETTLED: RGB = [143, 231, 179];
const LETTERS = miniFontBytes();

/** Surface finishes the interior material draws (carried in the cell colour's blue channel). */
const SURFACE = { tile: 1, planks: 2, grating: 3, plaster: 4, block: 5, glazing: 6, glazedTile: 7, vinyl: 8, panel: 9, foam: 10, polished: 11, concrete: 12, carpet: 13, raised: 14, tatami: 15, skyline: 16, haze: 17, shutter: 18 } as const;
type Surface = (typeof SURFACE)[keyof typeof SURFACE];
/** Arrival fade: 1 except for the first moments of a visit (see `arrivalFade`). */
let fade = 1;
/** Ground-floor fine-detail gain of the fixture being drawn: 1 well inside GROUND_DETAIL_RANGE, easing
 * to 0 over its last 2 m. Lit near-only extras are multiplied by it so they fade in, never pop. */
let detail = 1;
/** How far open (0..1) the lift doors of the fixture being drawn stand (a ride just arrived). */
let liftDoors = 0;
function style(canvas: PropCanvas, color: RGB, glyph: string, emissive = false, surface: Surface | 0 = 0): void {
  canvas.char(glyph);
  canvas.charColor(color[0] * fade, color[1] * fade, color[2] * fade);
  canvas.cellColor(0, 0, surface, emissive ? 0 : 255);
}
/** Each visit (a fixture list made by `CityInteriors.enter`) brightens from a dim doorway view over
 * 0.45 s of wall-clock time, so a frozen scene clock can never hold the room dark. No camera move. */
const ARRIVAL_SECONDS = 0.45;
const arrivals = new WeakMap<readonly InteriorFixture[], number>();
function arrivalFade(fixtures: readonly InteriorFixture[]): number {
  const now = performance.now() / 1000;
  let start = arrivals.get(fixtures);
  if (start === undefined || start > now) { start = now; arrivals.set(fixtures, start); }
  const progress = Math.min(1, (now - start) / ARRIVAL_SECONDS);
  return 0.08 + 0.92 * progress * progress * (3 - 2 * progress);
}
/** After a lift ride (the visit starts at a lift's landing) that lift's doors stand open for 0.5 s,
 * then ease shut over 1.1 s of wall-clock time. 0 for any other lift or visit. */
const LIFT_HOLD_SECONDS = 0.5;
const LIFT_CLOSE_SECONDS = 1.1;
const liftArrivals = new WeakMap<readonly InteriorFixture[], InteriorFixture | null>();
/** The lift the visitor arrived by and how far open its doors stand now, or null. Call every frame of
 * a ground-floor draw (the first frame decides, whether or not the lift is in view). */
function liftArrival(fixtures: readonly InteriorFixture[], eye: { x: number; z: number }): { lift: InteriorFixture; open: number } | null {
  let arrived = liftArrivals.get(fixtures);
  if (arrived === undefined) {
    // First frame of this visit: did the visitor step out of a lift? (ride() sets the landing pose
    // before the first draw; a street entrance starts far from any lift.)
    arrived = fixtures.find(lift => lift.kind === "lift" && Math.hypot(lift.x - eye.x, lift.z - eye.z) < Math.max(lift.width, lift.depth) / 2 + 1.8) ?? null;
    liftArrivals.set(fixtures, arrived);
  }
  const start = arrivals.get(fixtures);
  if (!arrived || start === undefined) return null;
  const k = (performance.now() / 1000 - start - LIFT_HOLD_SECONDS) / LIFT_CLOSE_SECONDS;
  return k >= 1 ? null : { lift: arrived, open: 1 - smooth01(k) };
}
/** Each venue's floor and wall finish. */
function finishes(kind: InteriorPlace["kind"]): { floor: Surface; wall: Surface; floorColor: RGB; wallColor?: RGB } {
  if (isGroundFloorKind(kind)) return GROUND_THEMES[kind];
  switch (kind) {
    case "teahouse": return { floor: SURFACE.planks, wall: SURFACE.plaster, floorColor: [112, 92, 74] };
    case "listening-bar": return { floor: SURFACE.planks, wall: SURFACE.plaster, floorColor: [86, 72, 66] };
    case "workshop": return { floor: SURFACE.grating, wall: SURFACE.block, floorColor: [92, 98, 104] };
    case "salvage": return { floor: SURFACE.grating, wall: SURFACE.block, floorColor: [98, 94, 88] };
    case "conservatory": return { floor: SURFACE.tile, wall: SURFACE.glazing, floorColor: [96, 106, 100] };
    case "noodle-bar": return { floor: SURFACE.tile, wall: SURFACE.glazedTile, floorColor: [104, 88, 80], wallColor: [150, 160, 158] };
    case "clinic": return { floor: SURFACE.vinyl, wall: SURFACE.panel, floorColor: [112, 128, 126], wallColor: [128, 148, 152] };
    case "nightclub": return { floor: SURFACE.tile, wall: SURFACE.foam, floorColor: [52, 48, 60], wallColor: [60, 56, 74] };
    default: return { floor: SURFACE.tile, wall: SURFACE.block, floorColor: [95, 101, 109] };
  }
}

function block(canvas: PropCanvas, x: number, height: number, z: number, width: number, tall: number, depth: number): void {
  canvas.translate(x, -height, z);
  canvas.box(width, tall, depth);
  canvas.translate(-x, height, -z);
}

function lettering(canvas: PropCanvas, text: string, x: number, height: number, z: number, size = 0.38, yaw = 0, exterior = false): void {
  canvas.push(); canvas.translate(x, -height, z); canvas.rotateY(yaw);
  for (const [index, character] of [...text].entries()) {
    if (character === " ") continue;
    canvas.char("#");
    const offset = (index - (text.length - 1) / 2) * size;
    if (exterior) {
      const code = character.charCodeAt(0) - 32;
      const bitmap = LETTERS[code * 2] | (LETTERS[code * 2 + 1] << 8);
      for (let row = 0; row < 5; row++) for (let column = 0; column < 3; column++) {
        if (bitmap & (1 << (14 - row * 3 - column))) block(canvas, offset + (column - 1) * size / 4, (2 - row) * size / 4, 0, size / 4, size / 4, 0.025);
      }
    } else {
      canvas.cellColor(character.charCodeAt(0), 255, 0, 0);
      canvas.translate(offset, 0, 0); canvas.rect(size * 0.8, size * 1.35); canvas.translate(-offset, 0, 0);
    }
  }
  canvas.pop();
}

function plant(canvas: PropCanvas, x: number, z: number, base: number, time: number): void {
  style(canvas, [145, 105, 71], "#"); block(canvas, x, base + 0.25, z, 0.7, 0.5, 0.7);
  style(canvas, [104, 165, 100], "|"); block(canvas, x, base + 0.95, z, 0.12, 1.1, 0.12);
  style(canvas, [120, 210, 147], "*");
  for (let leaf = 0; leaf < 4; leaf++) {
    const angle = leaf * Math.PI * 0.5 + Math.sin(time * 0.4 + x) * 0.05;
    block(canvas, x + Math.cos(angle) * 0.36, base + 0.8 + leaf * 0.16, z + Math.sin(angle) * 0.36, 0.64, 0.18, 0.55);
  }
}

/** A resident's heading toward a room-space point, in the degrees `rotateY` takes (180 faces the door). */
function headingTo(dx: number, dz: number): number { return Math.atan2(-dx, -dz) * 180 / Math.PI; }
/** How far a resident has turned toward a visitor: 0 beyond 4.5 m, 1 within 2.2 m, smooth between. */
function attention(distance: number): number {
  const k = Math.max(0, Math.min(1, (4.5 - distance) / 2.3));
  return k * k * (3 - 2 * k);
}
function resident(canvas: PropCanvas, x: number, z: number, tint: RGB, time: number, seated = false, facing = 180, detail = true, lift = 0): void {
  canvas.push(); canvas.translate(x, -lift, z); canvas.rotateY(facing);
  drawHuman(canvas, { coat: tint, trim: [50, 63, 74], skin: [196, 157, 124], light: WARM, headwear: seated ? "bare" : "cap", prop: null, idle: "breathe" }, { time, seed: Math.floor(Math.abs(x * 7)), stride: 0, moving: false, detail, seated, talking: !seated }, paintResident);
  canvas.pop();
}

function paintResident(canvas: PropCanvas, color: RGB, glyph: string, gain = 1): void {
  style(canvas, [color[0] * gain, color[1] * gain, color[2] * gain], glyph);
}

function fixture(canvas: PropCanvas, item: InteriorFixture, place: InteriorPlace, time: number): void {
  const { x, z, width, depth, height, kind } = item;
  if (kind === "stove") {
    // Steel range with three stock pots over low burner glow.
    style(canvas, [70, 76, 82], "H"); block(canvas, x, height / 2, z, width, height, depth);
    style(canvas, METAL, "-"); block(canvas, x, height + 0.03, z, width + 0.08, 0.06, depth + 0.08);
    for (const pot of STOVE_POTS) {
      const potZ = z + pot * depth;
      style(canvas, [255, 120, 60], "=", true); block(canvas, x, height + 0.08, potZ, 0.62, 0.04, 0.62);
      style(canvas, [168, 172, 176], "O"); canvas.translate(x, -(height + 0.36), potZ); canvas.box(0.56, 0.5, 0.56); canvas.translate(-x, height + 0.36, -potZ);
      style(canvas, [210, 214, 218], "-"); block(canvas, x, height + 0.62, potZ, 0.6, 0.04, 0.6);
    }
    return;
  }
  if (kind === "partition" || kind === "decks" || kind === "riser" || kind === "speaker" || kind === "booth" || kind === "backbar") {
    clubFixture(canvas, item, place, time);
    return;
  }
  if (kind === "stool") {
    style(canvas, METAL, "|"); block(canvas, x, height / 2, z, 0.1, height, 0.1);
    style(canvas, place.color, "o"); block(canvas, x, height - 0.04, z, width, 0.08, depth);
    return;
  }
  if (kind === "bench") {
    // Vinyl triage bench, backrest against the side wall.
    const wallSide = x < 0 ? -1 : 1;
    style(canvas, METAL, "|"); block(canvas, x, height / 2 - 0.05, z, width * 0.8, height - 0.1, depth * 0.9);
    style(canvas, [74, 150, 156], "="); block(canvas, x, height - 0.05, z, width, 0.12, depth);
    block(canvas, x + wallSide * (width / 2 - 0.08), height + 0.4, z, 0.14, 0.75, depth);
    return;
  }
  if (kind === "vending") {
    // Three machines side by side, each a lit window of stock and a coin slot.
    const face = x + (x > 0 ? -1 : 1) * (width / 2 + 0.01);
    style(canvas, [44, 52, 62], "#"); block(canvas, x, height / 2, z, width, height, depth);
    for (let unit = 0; unit < 3; unit++) {
      const unitZ = z + (unit - 1) * depth / 3;
      style(canvas, unit === 1 ? [255, 140, 90] : [110, 210, 240], ":", true); block(canvas, face, 1.55, unitZ, 0.02, 1.3, depth / 3 - 0.35);
      style(canvas, [36, 40, 46], "="); block(canvas, face, 1.25, unitZ, 0.03, 0.05, depth / 3 - 0.4);
      style(canvas, [255, 206, 138], ".", true); block(canvas, face, 0.62, unitZ + depth / 9, 0.03, 0.18, 0.12);
    }
    return;
  }
  if (kind === "post") {
    style(canvas, [196, 206, 210], "H"); block(canvas, x, height / 2, z, width, height, depth);
    style(canvas, [120, 255, 220], "|", true); block(canvas, x + (x < 0 ? 1 : -1) * (width / 2 + 0.01), height / 2, z, 0.02, height - 0.4, 0.12);
    return;
  }
  if (kind === "bed") {
    style(canvas, METAL, "|"); block(canvas, x, height / 2 - 0.1, z, width, height - 0.2, depth);
    style(canvas, [206, 214, 210], "="); block(canvas, x, height - 0.08, z, width - 0.1, 0.16, depth - 0.1);
    style(canvas, [236, 240, 238], "o"); block(canvas, x - width / 2 + 0.4, height + 0.06, z, 0.5, 0.12, depth - 0.4);
    return;
  }
  style(canvas, kind === "planter" ? WOOD : kind === "machine" ? METAL : kind === "seat" ? place.color : WOOD, kind === "machine" ? "H" : "=");
  block(canvas, x, height / 2, z, width, height, depth);
  style(canvas, METAL, "-"); block(canvas, x, height + 0.04, z, width + 0.1, 0.1, depth + 0.1);
  if (kind === "shelf") {
    for (let row = 0; row < 3; row++) {
      style(canvas, DARK, ":"); block(canvas, x, 0.6 + row * 1.0, z + depth / 2 + 0.02, width - 0.18, 0.8, 0.05);
      style(canvas, place.color, place.kind === "relay" ? "=" : "#", place.kind === "relay");
      for (let column = 0; column < 3; column++) block(canvas, x - 0.43 + column * 0.43, 0.5 + row, z + depth / 2 + 0.08, 0.21, place.kind === "relay" ? 0.1 : 0.45, 0.12);
    }
  } else if (kind === "planter") {
    plant(canvas, x - 0.5, z, height, time); plant(canvas, x + 0.5, z + 0.3, height, time + 2);
  } else if (kind === "machine") {
    style(canvas, DARK, ":"); block(canvas, x, height + 0.8, z - 0.4, width * 0.7, 1.55, depth * 0.5);
    style(canvas, place.color, place.kind === "workshop" ? "O" : "=", true);
    block(canvas, x, height + 0.7 + (place.kind === "workshop" ? Math.sin(time) * 0.3 : 0), z + 0.2, width * 0.5, 0.3, 0.1);
    if (place.kind === "salvage") {
      style(canvas, WARM, "O"); block(canvas, x + 0.6, height + 0.35, z + 0.6, 0.45, 0.65, 0.45);
    }
  } else if (kind === "table" || kind === "counter") {
    for (const side of [-1, 1]) {
      style(canvas, WARM, "U"); block(canvas, x + side * width * 0.28, height + 0.17, z, 0.24, 0.28, 0.24);
    }
    style(canvas, place.color, "=", true); block(canvas, x, 0.2, z + depth / 2 + 0.04, width * 0.82, 0.08, 0.08);
  } else if (kind === "seat") {
    style(canvas, place.color, "#"); block(canvas, x, height + 0.55, z - depth / 2 + 0.16, width, 1.1, 0.3);
  }
}

/** The Static's colour wash: four club colours blended smoothly in turn. Motion comfort: nothing in
 * the club strobes or follows a beat. A full wash takes 33 s (8 s per colour), the mirror ball turns
 * 6 degrees a second, the lasers drift over 20 s, a bottle glint walks the shelf every 17 s and the
 * dancers sway at 0.26-0.38 Hz: every rate stays under 0.4 Hz. */
export const CLUB_MOTION = { washHz: 0.03, mirrorDegreesPerSecond: 6, laserHz: 0.05, glintHz: 0.06, swayHz: [0.26, 0.38] } as const;
const CLUB_WASH: readonly RGB[] = [[255, 71, 148], [128, 92, 255], [64, 210, 232], [255, 150, 84]];
const BOTTLES: readonly RGB[] = [[90, 200, 120], [255, 170, 70], [200, 220, 235], [120, 170, 255]];
const COATS: readonly RGB[] = [[60, 60, 72], [120, 50, 60], [50, 80, 100], [90, 80, 60]];
const GREEN_SIGN: RGB = [120, 255, 170];
/** The Static's room layout shared by its fixtures, furnishings and dancers (room space). */
const CLUB = { greenFront: -4.6, greenWall: 4.75, floorZ: -1.6, tile: 1.1, columns: 6, rows: 4, mirrorY: 4.75, mirrorDots: 22, decksZ: -6.3 } as const;
export function clubWash(phase: number): RGB {
  const position = (((phase % 1) + 1) % 1) * CLUB_WASH.length, index = Math.floor(position) % CLUB_WASH.length;
  const blend = position - Math.floor(position), smooth = blend * blend * (3 - 2 * blend);
  const from = CLUB_WASH[index], to = CLUB_WASH[(index + 1) % CLUB_WASH.length];
  return [from[0] + (to[0] - from[0]) * smooth, from[1] + (to[1] - from[1]) * smooth, from[2] + (to[2] - from[2]) * smooth];
}
function gained(color: RGB, gain: number): RGB { return [color[0] * gain, color[1] * gain, color[2] * gain]; }

function clubFixture(canvas: PropCanvas, item: InteriorFixture, place: InteriorPlace, time: number): void {
  const { x, z, width, depth, height, kind } = item;
  if (kind === "partition") {
    style(canvas, finishes(place.kind).wallColor ?? WALL, ":", false, SURFACE.foam); block(canvas, x, height / 2, z, width, height, depth);
    style(canvas, DARK, "="); block(canvas, x, height + 0.04, z, width + 0.04, 0.08, depth + 0.04);
    style(canvas, gained(place.color, 0.55), "=", true); block(canvas, x, 0.08, z, Math.max(0.1, width - 0.1), 0.05, depth + 0.02);
  } else if (kind === "riser") {
    style(canvas, [34, 32, 40], "#"); block(canvas, x, height / 2, z, width, height, depth);
    style(canvas, gained(place.color, 0.6), "-", true); block(canvas, x, height - 0.03, z + depth / 2 + 0.01, width - 0.1, 0.04, 0.02);
  } else if (kind === "decks") {
    // Console, two turntables and the mixer between them; its channel lights drift, never blink.
    style(canvas, [30, 30, 38], "#"); block(canvas, x, height / 2, z, width, height, depth);
    style(canvas, METAL, "-"); block(canvas, x, height + 0.03, z, width + 0.06, 0.06, depth + 0.06);
    style(canvas, [18, 18, 22], "O");
    for (const side of [-1, 1]) { canvas.translate(x + side * 1.35, -(height + 0.1), z - 0.05); canvas.ellipsoid(0.42, 0.05, 0.42); canvas.translate(-(x + side * 1.35), height + 0.1, -(z - 0.05)); }
    style(canvas, [52, 54, 62], "="); block(canvas, x, height + 0.1, z - 0.05, 0.9, 0.1, 0.8);
    for (let channel = 0; channel < 3; channel++) {
      const level = 0.55 + 0.3 * Math.sin(time * Math.PI * 2 * 0.12 + channel * 2.1);
      style(canvas, gained(channel === 1 ? WARM : [120, 255, 200], level), "|", true);
      block(canvas, x + (channel - 1) * 0.24, height + 0.17, z - 0.05, 0.06, 0.04, 0.5);
    }
    style(canvas, gained(clubWash(time * CLUB_MOTION.washHz + 0.5), 0.7), "=", true); block(canvas, x, 0.3, z + depth / 2 + 0.02, width - 0.2, 0.08, 0.02);
  } else if (kind === "speaker") {
    const face = z + depth / 2 + 0.02;
    style(canvas, [22, 24, 30], "#"); block(canvas, x, height / 2, z, width, height, depth);
    style(canvas, [64, 68, 78], "O");
    for (const h of [0.65, 1.55]) { canvas.translate(x, -h, face); canvas.ellipsoid(0.36, 0.36, 0.05); canvas.translate(-x, h, -face); }
    style(canvas, [90, 94, 104], "="); block(canvas, x, 2.25, face, 0.6, 0.2, 0.04);
    style(canvas, gained(place.color, 0.5), "-", true); block(canvas, x, height - 0.06, face, width - 0.16, 0.03, 0.02);
  } else if (kind === "booth") {
    // Two high-backed bench seats facing across a table, open to the room; a candle on the table.
    const tableX = x + (x < 0 ? -1 : 1) * 0.2;
    for (const end of [-1, 1]) {
      style(canvas, [96, 52, 88], "#"); block(canvas, x, 0.24, z + end * (depth / 2 - 0.3), width * 0.9, 0.48, 0.6);
      style(canvas, [70, 40, 64], "#"); block(canvas, x, height / 2, z + end * (depth / 2 - 0.08), width * 0.9, height, 0.16);
    }
    style(canvas, WOOD, "="); block(canvas, tableX, 0.74, z, 0.9, 0.06, 0.95);
    style(canvas, METAL, "|"); block(canvas, tableX, 0.36, z, 0.1, 0.72, 0.1);
    style(canvas, WARM, "o", true); block(canvas, tableX, 0.84, z, 0.08, 0.12, 0.08);
  } else {
    // The back bar: two shelves of bottles. A soft highlight walks along each row (one pass every
    // 17 s, each bottle brightening over about 4 s) so the glass catches the light.
    const face = z + depth / 2, sweep = ((time * CLUB_MOTION.glintHz) % 1 + 1) % 1 * 18 - 6;
    style(canvas, [36, 30, 34], "#"); block(canvas, x, height / 2, z, width, height, depth);
    for (let row = 0; row < 2; row++) {
      style(canvas, gained(WARM, 0.55), "-", true); block(canvas, x, 1.0 + row * 0.75, face + 0.04, width - 0.2, 0.03, 0.06);
      for (let k = 0; k < 6; k++) {
        const glint = Math.exp(-((k - sweep - row * 0.5) ** 2) / 3.2);
        style(canvas, gained(BOTTLES[(k + row) % BOTTLES.length], 0.35 + 0.5 * glint), "|", true);
        block(canvas, x - width / 2 + 0.45 + k * (width - 0.9) / 5, 1.23 + row * 0.75, face + 0.1, 0.14, 0.42, 0.14);
      }
    }
  }
}

/** The Static's furnishings: the dance floor wash, the mirror ball and its dot field, drifting
 * lasers, wall uplights, the queue rope, coat rack and the green room's mirror, sign and alley door. */
function clubFurnish(canvas: PropCanvas, place: InteriorPlace, time: number, low: boolean, effects: boolean): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  // Dance floor: a grid of tiles under a slow diagonal colour wash (no tile ever switches).
  const columns = low ? CLUB.columns / 2 : CLUB.columns, rows = low ? CLUB.rows / 2 : CLUB.rows, size = CLUB.tile * CLUB.columns / columns;
  for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) {
    const u = i - (columns - 1) / 2, v = j - (rows - 1) / 2;
    const gain = 0.34 + 0.08 * Math.sin(time * 0.4 + i * 1.3 + j * 0.7);
    style(canvas, gained(clubWash(time * CLUB_MOTION.washHz + (u + v) * 0.05 * size / CLUB.tile), gain), "=", true);
    block(canvas, u * size, 0.012, CLUB.floorZ + v * size, size - 0.06, 0.02, size - 0.06);
  }
  // Lighting truss and the mirror ball hanging over the floor.
  style(canvas, DARK, "=");
  block(canvas, 0, 5.15, CLUB.floorZ, 7.2, 0.1, 0.1); block(canvas, 0, 5.15, CLUB.floorZ, 0.1, 0.1, 5);
  style(canvas, METAL, "|"); block(canvas, 0, 5.3, CLUB.floorZ, 0.03, 0.5, 0.03);
  style(canvas, [196, 200, 214], "*"); canvas.translate(0, -CLUB.mirrorY, CLUB.floorZ); canvas.ellipsoid(0.34, 0.34, 0.34); canvas.translate(0, CLUB.mirrorY, -CLUB.floorZ);
  if (!low && effects) {
    // The ball's reflections (an effect, off with the effects setting): steady dots on the walls, turning with it at 6 degrees a second.
    const spin = time * CLUB_MOTION.mirrorDegreesPerSecond * Math.PI / 180, reachX = halfWidth - 0.2, reachZ = halfDepth - 0.2;
    style(canvas, [176, 182, 206], ".", true);
    for (let k = 0; k < CLUB.mirrorDots; k++) {
      const angle = spin + k * 2.39996, dx = Math.sin(angle), dz = Math.cos(angle);
      const toX = Math.abs(dx) > 1e-6 ? reachX / Math.abs(dx) : Infinity;
      const toZ = Math.abs(dz) > 1e-6 ? (reachZ - Math.sign(dz) * CLUB.floorZ) / Math.abs(dz) : Infinity;
      const reach = Math.min(toX, toZ), slope = 0.06 + ((k * 0.618034) % 1) * 0.3, side = toX < toZ;
      block(canvas, dx * reach, Math.max(0.5, Math.min(5.3, CLUB.mirrorY - slope * reach)), CLUB.floorZ + dz * reach, side ? 0.02 : 0.16, 0.12, side ? 0.16 : 0.02);
    }
  }
  // Three lasers from a head over the booth, fanned toward the street wall above head height,
  // drifting a few degrees over twenty seconds. Steady brightness: they never blink.
  const emitterY = 4.55, emitterZ = -halfDepth + 1.6;
  style(canvas, DARK, "#"); block(canvas, 0, emitterY + 0.1, emitterZ, 0.6, 0.25, 0.4);
  for (let k = 0; k < (effects ? 3 : 0); k++) { // the beams are an effect; the head stays
    const yaw = (k - 1) * 0.4 + 0.2 * Math.sin(time * Math.PI * 2 * CLUB_MOTION.laserHz + k * 2.1);
    const length = Math.min((halfDepth - 0.4 - emitterZ) / Math.cos(yaw), (halfWidth - 0.4) / Math.max(0.001, Math.abs(Math.sin(yaw))));
    canvas.push(); canvas.translate(0, -emitterY, emitterZ); canvas.rotateY(yaw * 180 / Math.PI); canvas.rotateX(-Math.atan2(1 + k * 0.15, length) * 180 / Math.PI);
    style(canvas, gained(clubWash(time * CLUB_MOTION.washHz + k / 3), 0.8), "-", true);
    canvas.translate(0, 0, length / 2); canvas.box(0.08, 0.08, length);
    canvas.pop();
  }
  // Uplights washing the side walls above the booths.
  for (const side of [-1, 1]) for (const k of [0, 1]) {
    style(canvas, gained(clubWash(time * CLUB_MOTION.washHz * 0.8 + side * 0.25 + k * 0.5), 0.3), ":", true);
    block(canvas, side * (halfWidth - 0.19), 2.9, k ? 2.1 : -2.6, 0.02, 2.6, 1.3);
  }
  // The queue rope beside the bouncer, and the coat rack behind the coat check.
  style(canvas, [200, 170, 90], "|"); for (const z of [4, 5.8]) block(canvas, -2, 0.5, z, 0.1, 1, 0.1);
  style(canvas, [170, 40, 60], "~"); block(canvas, -2, 0.88, 4.9, 0.06, 0.06, 1.8);
  style(canvas, METAL, "-"); block(canvas, halfWidth - 0.6, 2, halfDepth - 3.1, 0.05, 0.05, 2.4);
  for (let k = 0; k < COATS.length; k++) { style(canvas, COATS[k], "#"); block(canvas, halfWidth - 0.6, 1.5, halfDepth - 4 + k * 0.6, 0.35, 0.95, 0.4); }
  // The green room: its sign over the opening, a dressing mirror and the alley door on the side wall.
  const signX = (CLUB.greenWall + halfWidth - 1) / 2;
  style(canvas, DARK, " "); block(canvas, signX, 3.3, CLUB.greenFront, 2.5, 0.38, 0.06);
  style(canvas, gained(GREEN_SIGN, 0.85), "=", true); lettering(canvas, "GREEN ROOM", signX, 3.3, CLUB.greenFront + 0.05, 0.21);
  style(canvas, [70, 84, 100], ":"); block(canvas, halfWidth - 0.2, 2, -7.2, 0.03, 1, 1.4);
  style(canvas, WARM, "o", true); for (let bulb = 0; bulb < 4; bulb++) block(canvas, halfWidth - 0.22, 2.58, -7.2 + (bulb - 1.5) * 0.4, 0.06, 0.1, 0.1);
  style(canvas, [70, 60, 56], "#"); block(canvas, halfWidth - 0.2, 1.1, -5.6, 0.06, 2.2, 1.1);
  style(canvas, METAL, "-"); block(canvas, halfWidth - 0.25, 1.05, -5.6, 0.05, 0.06, 0.9);
  style(canvas, gained(GREEN_SIGN, 0.85), "=", true); lettering(canvas, "ALLEY", halfWidth - 0.26, 2.5, -5.6, 0.2, -90);
  // A dim painted line along the right-hand walkway to the green room.
  style(canvas, [92, 150, 120], "-"); block(canvas, 6, 0.012, (2.8 + CLUB.greenFront) / 2, 0.12, 0.02, 2.8 - CLUB.greenFront);
}

export interface InteriorDancer { x: number; z: number; tint: RGB; seed: number; hz: number; facing: number; armsUp: boolean }
const DANCER_SPOTS: readonly (readonly [number, number])[] = [
  [-2.6, -3.1], [1.2, -3.0], [-1.4, -2.4], [2.6, -2.4], [-2.9, -1.4], [1.7, -1.5], [-1.5, -0.6], [2.9, -0.6], [-2.4, 0.3], [1.1, -0.2], [-0.4, -3.5], [2.2, 0.4],
];
const DANCER_TINTS: readonly RGB[] = [[150, 70, 120], [70, 110, 160], [190, 160, 90], [90, 150, 120], [160, 90, 70], [110, 90, 170]];
/** The dancers on The Static's floor, facing the booth (each a little off), swaying slowly. */
export function interiorDancers(place: InteriorPlace): readonly InteriorDancer[] {
  if (place.kind !== "nightclub") return [];
  const [slowest, fastest] = CLUB_MOTION.swayHz;
  return DANCER_SPOTS.map(([x, z], index) => ({
    x, z, tint: DANCER_TINTS[index % DANCER_TINTS.length], seed: index * 1.7, hz: slowest + (fastest - slowest) * (index % 5) / 4,
    facing: headingTo(-x, CLUB.decksZ - z) + ((index * 37) % 50) - 25, armsUp: index % 4 === 1,
  }));
}
/** A light dancer figure (six pieces): hips sway side to side, arms rise and fall on the same slow
 * beat-free rhythm, the whole body turns a little at half that rate. */
function dancer(canvas: PropCanvas, person: InteriorDancer, time: number): void {
  const phase = time * Math.PI * 2 * person.hz + person.seed;
  canvas.push(); canvas.translate(person.x, 0, person.z); canvas.rotateY(person.facing + Math.sin(phase * 0.5) * 10);
  style(canvas, [44, 46, 58], "|");
  for (const side of [-1, 1]) block(canvas, side * 0.16, 0.56, 0, 0.22, 1.12, 0.26);
  canvas.translate(0, -1.1, 0); canvas.rotateZ(Math.sin(phase) * 6);
  style(canvas, person.tint, "#"); block(canvas, 0, 0.45, 0, 0.6, 0.9, 0.36);
  for (const side of [-1, 1]) {
    const raise = person.armsUp ? 135 + 12 * Math.sin(phase + side) : 16 + 20 * (0.5 + 0.5 * Math.sin(phase + side * 0.9));
    canvas.push(); canvas.translate(side * 0.37, -0.82, 0); canvas.rotateZ(-side * raise);
    block(canvas, 0, -0.32, 0, 0.16, 0.64, 0.2);
    canvas.pop();
  }
  style(canvas, [196, 157, 124], ":"); canvas.translate(0, -1.17, 0); canvas.ellipsoid(0.2, 0.24, 0.2);
  canvas.pop();
}

/**
 * Lived-in detail (Agent F): the ceiling fixture the room's light comes from, and each venue's own
 * small props - lanterns, rugs, speakers and record crates, a pegboard and a slow fan, server racks,
 * grow lamps and vines, crates and a wall of old screens. Everything hugs the side walls, the front
 * corners or the ceiling: clear of the fixtures, the USE stations and the walking floor (collision
 * is unchanged). Animation is slow and smooth - pulses over seconds, never a blink.
 */
const SLEEVES: readonly RGB[] = [[190, 70, 90], [70, 140, 190], [210, 180, 90]];
/** Stock pots along the noodle stove, as fractions of its depth from its centre. */
const STOVE_POTS: readonly number[] = [-0.33, 0, 0.33];
/** Clinic scanner sweep: one slow pass up and down every four seconds (0.25 Hz). */
const SCANNER_HZ = 0.25;
function furnish(canvas: PropCanvas, place: InteriorPlace, time: number, low: boolean, effects = true): void {

  const halfWidth = place.width / 2, halfDepth = place.depth / 2, tint = place.color;
  const glow = (color: RGB, gain: number): RGB => [color[0] * gain, color[1] * gain, color[2] * gain];
  if (place.kind === "nightclub") { clubFurnish(canvas, place, time, low, effects); frontWindows(canvas, place, time, low); return; }
  // The ceiling fixture under the room's key light, with its housing.
  style(canvas, DARK, "="); block(canvas, 0, INTERIOR_HEIGHT - 0.12, 0, 2.7, 0.12, 0.8);
  style(canvas, glow(WARM, 0.95), "=", true); block(canvas, 0, INTERIOR_HEIGHT - 0.22, 0, 2.4, 0.06, 0.55);
  const industrial = place.kind === "workshop" || place.kind === "salvage" || place.kind === "relay";
  if (industrial) {
    // Conduit and a duct along the ceiling.
    style(canvas, METAL, "=");
    for (const side of [-1, 1]) block(canvas, side * (halfWidth - 1.1), INTERIOR_HEIGHT - 0.45, 0, 0.16, 0.16, place.depth - 1);
    style(canvas, [60, 72, 84], "#"); block(canvas, -(halfWidth - 2.2), INTERIOR_HEIGHT - 0.6, 0, 0.7, 0.45, place.depth - 1.2);
  }
  const wallZ = (k: number) => 2.6 + k * 1.15; // along the side walls, in front of the fixtures
  if (place.kind === "teahouse") {
    // Paper lanterns hanging down the room, a rug under the tables, cups on the counter.
    for (let k = 0; k < 3; k++) {
      const z = -halfDepth * 0.45 + k * halfDepth * 0.55, x = (k - 1) * 1.6;
      style(canvas, [60, 50, 40], "|"); block(canvas, x, INTERIOR_HEIGHT - 0.55, z, 0.03, 1.1, 0.03);
      style(canvas, glow([255, 150, 96], 0.85 + 0.12 * Math.sin(time * 0.5 + k * 2)), "O", true);
      canvas.translate(x, -(INTERIOR_HEIGHT - 1.4), z); canvas.ellipsoid(0.32, 0.42, 0.32); canvas.translate(-x, INTERIOR_HEIGHT - 1.4, -z);
    }
    style(canvas, [124, 52, 50], "%"); block(canvas, 0, 0.012, 0.7, place.width * 0.62, 0.024, 3.4);
    style(canvas, [168, 128, 88], "="); block(canvas, 0, 0.026, 0.7, place.width * 0.58, 0.01, 3.1);

  } else if (place.kind === "listening-bar") {
    // Speaker stacks in the front corners (cones breathe with the music), crates of records.
    for (const side of [-1, 1]) {
      const x = side * (halfWidth - 1.0), z = halfDepth - 1.2;
      style(canvas, [24, 28, 34], "#"); block(canvas, x, 0.9, z, 1.0, 1.8, 0.8);
      const pulse = 1 + 0.06 * Math.sin(time * 0.94); // a slow 0.15 Hz breath (motion comfort: no fast pulsing)
      style(canvas, [70, 74, 82], "O");
      for (const h of [0.55, 1.3]) { canvas.translate(x, -h, z - 0.42); canvas.ellipsoid(0.3 * pulse, 0.3 * pulse, 0.05); canvas.translate(-x, h, -(z - 0.42)); }
      style(canvas, glow(tint, 0.7), "=", true); block(canvas, x, 1.85, z - 0.41, 0.8, 0.04, 0.02);
    }
    for (let k = 0; k < 3; k++) for (const side of [-1, 1]) {
      style(canvas, WOOD, "#"); block(canvas, side * (halfWidth - 0.6), 0.3, wallZ(k), 0.6, 0.6, 0.8);
      style(canvas, SLEEVES[(k + (side > 0 ? 1 : 0)) % SLEEVES.length], "|");
      block(canvas, side * (halfWidth - 0.6), 0.66, wallZ(k), 0.5, 0.14, 0.72);
    }
  } else if (place.kind === "workshop") {
    // A pegboard of tools on the left wall, gas bottles on the right, a slow ceiling fan.
    style(canvas, [38, 46, 52], ":"); block(canvas, -(halfWidth - 0.22), 2.1, 4.0, 0.05, 1.3, 2.8);
    style(canvas, METAL, "|");
    for (let k = 0; k < 6; k++) block(canvas, -(halfWidth - 0.28), 2.0 + (k % 2) * 0.25, 2.9 + k * 0.42, 0.05, 0.5 + (k % 3) * 0.12, 0.07);
    for (let k = 0; k < 3; k++) {
      const x = halfWidth - 0.55, z = wallZ(k) + 0.3, color: RGB = k === 1 ? [190, 70, 52] : [64, 110, 128];
      style(canvas, color, "|"); canvas.translate(x, -0.75, z); canvas.ellipsoid(0.24, 0.75, 0.24); canvas.translate(-x, 0.75, -z);
    }
    if (!low) {
      canvas.push(); canvas.translate(0, -(INTERIOR_HEIGHT - 0.5), 2.5); canvas.rotateY(time * 15); // 15 deg/s: a lazy turn, no strobing arms overhead
      style(canvas, METAL, "="); canvas.box(2.2, 0.03, 0.22); canvas.box(0.22, 0.03, 2.2);
      canvas.pop();
    }
  } else if (place.kind === "relay") {
    // Racks of receivers along both walls, status lights pulsing slowly out of step.
    for (const side of [-1, 1]) for (let k = 0; k < 2; k++) {
      const x = side * (halfWidth - 0.6), z = wallZ(k * 2);
      style(canvas, [28, 34, 44], "#"); block(canvas, x, 1.5, z, 0.8, 3.0, 1.0);
      for (let row = 0; row < 4; row++) {
        const gain = 0.55 + 0.45 * Math.sin(time * (0.8 + row * 0.13) + k * 1.7 + side + row * 2.1);
        style(canvas, glow(row % 3 === 0 ? [255, 176, 72] : tint, gain), "=", true);
        block(canvas, x - side * 0.41, 0.6 + row * 0.6, z, 0.02, 0.05, 0.6);
      }
    }
    style(canvas, [44, 50, 58], "~"); block(canvas, halfWidth - 1.6, INTERIOR_HEIGHT - 0.7, 0, 0.3, 0.18, place.depth - 1.4);
  } else if (place.kind === "conservatory") {
    // Grow lamps over the planters and vines trailing from the glazing bars.
    for (const side of [-1, 1]) {
      style(canvas, DARK, "|"); block(canvas, side * (halfWidth - 2.2), 4.4, 0.6, 0.03, 1.6, 0.03);
      style(canvas, glow([226, 96, 255], 0.9), "=", true); block(canvas, side * (halfWidth - 2.2), 3.6, 0.6, 1.9, 0.07, 0.18);
    }
    style(canvas, [74, 140, 82], "|");
    for (let k = 0; k < 6; k++) {
      const side = k % 2 ? 1 : -1, z = -halfDepth * 0.2 + Math.floor(k / 2) * 1.6, length = 0.9 + ((k * 7) % 5) * 0.25;
      block(canvas, side * (halfWidth - 0.3), INTERIOR_HEIGHT - 0.2 - length / 2, z, 0.06, length, 0.06);
    }
    for (const side of [-1, 1]) plant(canvas, side * (halfWidth - 1.1), halfDepth - 1.4, 0, time + side);
  } else if (place.kind === "salvage") {
    // Crates stacked against the walls and a wall of old screens, their glow drifting slowly.
    for (let k = 0; k < 3; k++) for (const side of [-1, 1]) {
      const x = side * (halfWidth - 0.75), z = wallZ(k);
      style(canvas, WOOD, "#"); block(canvas, x, 0.45, z, 0.9, 0.9, 0.9);
      if ((k + (side > 0 ? 1 : 0)) % 2 === 0) { style(canvas, [128, 96, 66], "#"); block(canvas, x, 1.2, z + 0.05, 0.7, 0.6, 0.7); }
    }
    // Screens stacked either side of the exit, clear of its frame.
    for (let k = 0; k < (low ? 4 : 6); k++) {

      const side = k % 2 ? 1 : -1, x = side * (k < 4 ? halfWidth - 1.6 - (k >> 1) * 1.45 : halfWidth - 2.3), h = k < 4 ? 2.4 : 3.2, z = halfDepth - 0.55;
      style(canvas, [34, 36, 40], "#"); block(canvas, x, h, z, 1.3, 0.75, 0.5);
      const gain = 0.45 + 0.25 * Math.sin(time * 0.37 + k * 1.9);
      style(canvas, glow(k % 2 ? [120, 200, 220] : tint, gain), ":", true); block(canvas, x, h, z - 0.26, 1.05, 0.55, 0.02);
    }
  } else if (place.kind === "noodle-bar") {
    // Bowls along the counter, bulbs over it, the departures screen over the ledge, a back door.
    const counterX = -halfWidth + 3.4;
    for (const z of [-4.6, -2.6, -0.6, 1.4]) { style(canvas, [230, 226, 214], "u"); block(canvas, counterX + 0.22, 1.18, z, 0.34, 0.14, 0.34); }
    for (const z of [-4.2, -1.4, 1.4]) {
      style(canvas, [60, 50, 40], "|"); block(canvas, counterX, INTERIOR_HEIGHT - 0.5, z, 0.03, 1.0, 0.03);
      style(canvas, glow(WARM, 1), "o", true); block(canvas, counterX, INTERIOR_HEIGHT - 1.1, z, 0.22, 0.24, 0.22);
    }
    const screenX = halfWidth - 0.22;
    style(canvas, DARK, "#"); block(canvas, screenX, 3.0, -1.5, 0.08, 1.45, 2.9);
    style(canvas, [34, 58, 96], ":", true); block(canvas, screenX - 0.05, 3.0, -1.5, 0.02, 1.2, 2.6);
    style(canvas, glow(tint, 0.9), "=", true); lettering(canvas, "LAST TRAIN", screenX - 0.08, 3.35, -1.5, 0.2, -90);
    for (let row = 0; row < 2; row++) {
      style(canvas, row ? [120, 220, 240] : [255, 206, 138], "-", true);
      block(canvas, screenX - 0.07, 2.95 - row * 0.32, -1.5 + (row ? 0.35 : -0.15), 0.02, 0.1, row ? 1.6 : 2.1);
    }
    if (!low) {
      // A ticker crawling along the foot of the screen, one pass every ten seconds.
      const crawl = ((time * 0.1) % 1 + 1) % 1;
      style(canvas, glow([255, 120, 160], 0.85), "=", true); block(canvas, screenX - 0.07, 2.5, -1.5 + 1.0 - crawl * 2.0, 0.02, 0.08, 0.5);
    }
    const doorX = halfWidth - 2.8, backZ = -halfDepth + 0.22;
    style(canvas, [92, 74, 60], "#"); block(canvas, doorX, 1.1, backZ, 1.05, 2.2, 0.06);
    style(canvas, METAL, "|");
    for (const side of [-1, 1]) block(canvas, doorX + side * 0.6, 1.15, backZ + 0.02, 0.1, 2.3, 0.1);
    block(canvas, doorX, 2.33, backZ + 0.02, 1.3, 0.1, 0.1);
    style(canvas, [120, 255, 170], "=", true); block(canvas, doorX, 2.55, backZ + 0.04, 0.42, 0.14, 0.04);
  } else if (place.kind === "clinic") {
    // The scanner arch over the walking line, its sweep bar gliding up and down (0.25 Hz).
    const arch = 0.6;
    style(canvas, [196, 206, 210], "H"); block(canvas, 0, 3.05, arch, 3.5, 0.3, 0.7);
    style(canvas, [120, 255, 220], "=", true); block(canvas, 0, 2.88, arch, 3.0, 0.04, 0.12);
    const sweep = 0.5 - 0.5 * Math.cos(time * Math.PI * 2 * SCANNER_HZ);
    style(canvas, glow([120, 255, 220], 0.9), "-", true); block(canvas, 0, 0.35 + sweep * 2.3, arch, 2.6, 0.05, 0.5);
    // Cool tubes either side of the warm fixture.
    style(canvas, [210, 235, 240], "=", true);
    for (const side of [-1, 1]) block(canvas, side * halfWidth * 0.5, INTERIOR_HEIGHT - 0.18, -1, 0.2, 0.08, 3.4);
    // Curtained bay: a rail around the bed, curtains drawn along the side, bunched at the wall.
    const bayZ = -halfDepth + 3.65, bayX = -halfWidth + 5.1;
    style(canvas, METAL, "-");
    block(canvas, (-halfWidth + bayX) / 2, 2.55, bayZ, bayX + halfWidth, 0.05, 0.05);
    block(canvas, bayX, 2.55, (bayZ - halfDepth) / 2, 0.05, 0.05, bayZ + halfDepth);
    style(canvas, [130, 180, 160], "|");
    block(canvas, -halfWidth + 0.9, 1.45, bayZ, 0.9, 2.1, 0.06);
    block(canvas, -halfWidth + 1.75 + Math.sin(time * 0.3) * 0.03, 1.45, bayZ, 0.8, 2.1, 0.06);
    block(canvas, bayX, 1.45, (bayZ - halfDepth) / 2 + 0.1, 0.06, 2.1, bayZ + halfDepth - 0.4);
    // A painted line from the door to the nurse's desk.
    style(canvas, [255, 196, 96], "=");
    block(canvas, 2.4, 0.012, (halfDepth - 1 - 2.6) / 2, 0.18, 0.02, halfDepth - 1 + 2.6);
    // The desk monitor, a pulse line crossing it slowly.
    const monitorX = halfWidth - 5.6, deskTop = 1.15;
    style(canvas, DARK, "#"); block(canvas, monitorX, deskTop + 0.32, -3.75, 0.72, 0.5, 0.06);
    style(canvas, [120, 255, 170], "-", true); block(canvas, monitorX, deskTop + 0.3, -3.71, 0.6, 0.03, 0.02);
    if (!low) {
      const blip = ((time * 0.4) % 1 + 1) % 1;
      style(canvas, [190, 255, 210], "^", true); block(canvas, monitorX - 0.28 + blip * 0.56, deskTop + 0.36, -3.705, 0.05, 0.14, 0.02);
    }
    plant(canvas, -halfWidth + 1, halfDepth - 1.3, 0, time);
  }
  frontWindows(canvas, place, time, low);
}

/** Night-street windows either side of the exit (not Second Life, whose screens stand there), and a
 * lit threshold under the door so the way out reads from anywhere in the room. */
function frontWindows(canvas: PropCanvas, place: InteriorPlace, time: number, low: boolean): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  style(canvas, WARM, "=", true); block(canvas, 0, 0.012, halfDepth - 0.45, 2.6, 0.02, 0.3);
  if (place.kind === "salvage" || place.kind === "nightclub") return;
  const width = Math.min(2.4, halfWidth - 2.4);
  for (const side of [-1, 1]) {
    const x = side * (1.5 + (halfWidth - 1.5) / 2), z = halfDepth - 0.2;
    style(canvas, DARK, "#"); block(canvas, x, 2.85, z, width + 0.2, 1.5, 0.1);
    style(canvas, [22, 34, 58], " ", true); block(canvas, x, 2.85, z - 0.06, width, 1.25, 0.02);
    for (let k = 0; k < 3; k++) {
      const u = ((k * 0.37 + side * 0.21) % 1 + 1) % 1, v = ((k * 0.61 + 0.3) % 1);
      style(canvas, k === 1 ? place.color : [255, 206, 138], ".", true);
      block(canvas, x + (u - 0.5) * (width - 0.4), 2.4 + v * 0.85, z - 0.07, 0.14, 0.18, 0.01);
    }
    if (!low) {
      // Headlights crossing the street outside, once every twelve seconds or so.
      const phase = ((time * 0.08 + (side > 0 ? 0.37 : 0)) % 1 + 1) % 1;
      const gain = Math.sin(phase * Math.PI) * 0.8;
      style(canvas, [255 * gain, 220 * gain, 160 * gain], "-", true);
      block(canvas, x + (phase - 0.5) * (width - 0.3), 2.35, z - 0.075, 0.3, 0.05, 0.01);
    }
  }
}

/** `lift` stands a resident on a riser; `detail: false` draws a lighter figure (background people). */
export interface InteriorResident { x: number; z: number; tint: RGB; offset: number; seated: boolean; facing: number; line: string; lift?: number; detail?: boolean }
const LINES: Readonly<Record<InteriorPlace["kind"], readonly [string, string]>> = {
  "workshop": ["MIND THE BENCH", "LONG SHIFT"],
  "listening-bar": ["ONE MORE RECORD", "LISTEN"],
  "relay": ["NO NEW SIGNAL", "STILL WAITING"],
  "conservatory": ["MIND THE ROOTS", "THEY LIKE YOU"],
  "teahouse": ["TEA IS HOT", "STAY DRY"],
  "salvage": ["ALL SOLD AS IS", "LOOK AROUND"],
  "noodle-bar": ["ONE BOWL?", "BEST IN THE WARD"],
  "clinic": ["TAKE A NUMBER", "BEEN HERE HOURS"],
  "nightclub": ["SHORT LINE. GO ON IN", "CURFEW IS AT FOUR"],
  // Secrets: hidden rooms (their residents are set in secretResidents).
  "secret-diner": ["BACK SOON", "PIE?"],
  "secret-gallery": ["...", "..."],
  "secret-mirror": ["EMOCLEW", "WELCOME"],
  "secret-roof": ["...", "..."],
  "secret-carriage": ["IS THIS THE LAST STOP?", "..."],
  "secret-studio": ["...", "..."],
  // Ground floors: fallbacks for a plan resident without a line of their own.
  "lobby": ["MAIL'S IN THE BOX", "LIFT'S SLOW TONIGHT"],
  "capsule-hotel": ["ONE NIGHT? CASH", "QUIET HOURS"],
  "corp-lobby": ["VISITORS SIGN IN", "BADGE, PLEASE"],
  "arcade": ["ONE MORE CREDIT", "HIGH SCORE'S MINE"],
  "pawnshop": ["EVERYTHING HAS A PRICE", "NO REFUNDS"],
  "machine-shop": ["MIND THE CHUCK", "GOGGLES ON"],
  "server-hall": ["DON'T TOUCH THE RACKS", "IT'S ALWAYS COLD"],
  "shrine": ["LIGHT A CANDLE", "SHOES OFF"],
  "hydroponics": ["DON'T STARE AT THE LAMPS", "HARVEST IS TUESDAY"],
  "laundromat": ["SPIN CYCLE'S LONG", "BRING YOUR OWN SOAP"],
  "market-hall": ["FRESH TODAY", "BEST PRICE IN THE HALL"],
  "chandlery": ["ROPE, WAX, LIGHT", "MIND THE NETS"],
  "apartment": ["WRONG FLOOR?", "KEEP IT DOWN"],
  "garage": ["NO PARKING", "SHE'LL RUN AGAIN"],
};
/** Who stands where in each room, and which way they face when nobody is near (180: the door). */
export function interiorResidents(place: InteriorPlace): readonly InteriorResident[] {
  if (isSecretKind(place.kind)) return secretResidents(place); // Secrets
  if (isGroundFloorKind(place.kind)) return groundResidents(place);
  const halfWidth = place.width / 2, halfDepth = place.depth / 2, [first, second] = LINES[place.kind];
  if (place.kind === "noodle-bar") return [
    { x: -halfWidth + 2.6, z: -2.2, tint: place.color, offset: 0, seated: false, facing: -90, line: first },
    { x: -halfWidth + 4.45, z: -0.6, tint: [103, 130, 168], offset: 3, seated: true, facing: 90, line: second },
  ];
  if (place.kind === "nightclub") return [
    // The bouncer by the lobby gap (lets you through with a line), Nova Vex on the riser behind the
    // decks, Rhea behind the bar, and a couple in the left-hand booth.
    { x: -3, z: 4.35, tint: [40, 42, 50], offset: 0, seated: false, facing: 180, line: first },
    { x: -0.8, z: -halfDepth + 1.4, tint: place.color, offset: 2, seated: false, facing: 180, line: "ONE MORE TUNE", lift: 0.45 },
    { x: -halfWidth + 1.6, z: -4.75, tint: [70, 160, 170], offset: 4, seated: false, facing: 180, line: "WHAT ARE YOU HAVING" },
    { x: -halfWidth + 0.9, z: -0.75, tint: [150, 110, 190], offset: 1, seated: true, facing: 180, line: second, detail: false },
    { x: -halfWidth + 0.9, z: 1.15, tint: [200, 150, 90], offset: 5, seated: true, facing: 0, line: "SHH. GOOD SONG", detail: false },
  ];
  if (place.kind === "clinic") return [
    { x: halfWidth - 4.4, z: -4.75, tint: [150, 200, 210], offset: 0, seated: false, facing: 180, line: first },
    { x: -halfWidth + 1.75, z: 1.8, tint: [161, 126, 80], offset: 3, seated: true, facing: -90, line: second },
  ];
  return [
    { x: -1.5, z: -halfDepth + 1.5, tint: place.color, offset: 0, seated: false, facing: 180, line: first },
    place.kind === "listening-bar" || place.kind === "teahouse"
      ? { x: halfWidth - 2.2, z: 0.6, tint: [103, 130, 168], offset: 3, seated: true, facing: 180, line: second }
      : { x: -halfWidth + 2.2, z: 2.45, tint: [161, 126, 80], offset: 3, seated: false, facing: 180, line: second },
  ];
}

/** Residents turn toward a visitor who comes within a few metres (seated ones only partly), and the
 * closest attentive one says a short line over their head, turned to face the visitor. */
/** Per room id: the resident (by index) whose speech board showed last frame, and each ground-floor
 * resident's detail tier, for hysteresis. */
const lastSpeaker = new Map<string, number>();
const residentTiers = new Map<string, Map<number, boolean>>();
function drawResidents(canvas: PropCanvas, place: InteriorPlace, time: number, viewer: { x: number; z: number } | null): void {
  const visitor = viewer ? interiorLocal(place, viewer.x, viewer.z) : null, ground = isGroundFloorKind(place.kind);
  type Speaker = { resident: InteriorResident; index: number; weight: number; dx: number; dz: number };
  let speaker: Speaker | null = null, previous: Speaker | null = null;
  const last = lastSpeaker.get(place.id), tiers = residentTiers.get(place.id) ?? new Map<number, boolean>();
  residentTiers.set(place.id, tiers);
  for (const [index, person] of interiorResidents(place).entries()) {
    let facing = person.facing;
    if (visitor) {
      const dx = visitor.x - person.x, dz = visitor.z - person.z;
      const weight = attention(Math.hypot(dx, dz)) * (person.seated ? 0.6 : 1);
      const turn = ((headingTo(dx, dz) - facing) % 360 + 540) % 360 - 180;
      facing += turn * weight;
      if (weight > 0.5 && (!speaker || weight > speaker.weight)) speaker = { resident: person, index, weight, dx, dz };
      if (weight > 0.5 && index === last) previous = { resident: person, index, weight, dx, dz };
    }
    // Ground floors can seat many people across a big floor: the far ones draw as lighter figures. The
    // tier has 1 m of hysteresis, so a visitor standing near the range never toggles it.
    let full = person.detail ?? true;
    if (full && ground && visitor) {
      const distance = Math.hypot(visitor.x - person.x, visitor.z - person.z), was = tiers.get(index) ?? distance < GROUND_DETAIL_RANGE;
      full = was ? distance < GROUND_DETAIL_RANGE + 0.5 : distance < GROUND_DETAIL_RANGE - 0.5;
      tiers.set(index, full);
    }
    resident(canvas, person.x, person.z, person.tint, time + person.offset, person.seated, facing, full, person.lift ?? 0);
  }
  // Hysteresis: whoever spoke last keeps the board unless another resident is clearly more attentive.
  if (previous && speaker && speaker.weight <= previous.weight + 0.15) speaker = previous;
  if (speaker) lastSpeaker.set(place.id, speaker.index); else lastSpeaker.delete(place.id);
  if (speaker) {
    const { resident: person, dx, dz } = speaker, height = (person.seated ? 2.65 : 3.2) + (person.lift ?? 0), size = 0.12;
    const yaw = Math.atan2(dx, dz) * 180 / Math.PI;
    // Ground floors: the board opens and its rules and letters brighten as attention passes 0.5..0.7.
    if (ground) { groundSign(canvas, person.line, person.x, height, person.z, SPEECH_PIXEL, yaw, WARM, true, smooth01((speaker.weight - 0.5) / 0.2)); return; }
    canvas.push(); canvas.translate(person.x, -height, person.z); canvas.rotateY(yaw);
    style(canvas, DARK, " "); canvas.translate(0, 0, -0.02); canvas.rect(person.line.length * size + 0.2, size * 1.35 + 0.14);
    canvas.pop();
    style(canvas, WARM, "=", true); lettering(canvas, person.line, person.x, height, person.z, size, yaw);
  }
}

// ---- Ground floors: every other building's walkable interior (building-interiors.ts) ---------------
// The plan supplies walls, furniture, rooms, residents and ceiling lights in room space (origin at the
// room centre, +z toward the street door). Each kind has its own finishes and light fittings; each
// fixture is a small characterful object facing its `yaw` and varied by its `seed`. Budget: fixtures
// behind the visitor are skipped, fine dressing only within GROUND_DETAIL_RANGE (never on `low`).
// Motion comfort: every change is a slow eased drift (<= 0.3 Hz, small areas), nothing blinks.

type GroundPlan = ReturnType<typeof groundFloorPlan>;
interface GroundLight { x: number; z: number; color: RGB }
type Fitting = "tube" | "pendant" | "lantern" | "grow" | "ring" | "cage" | "neon";
interface GroundTheme {
  floor: Surface; wall: Surface; floorColor: RGB; wallColor: RGB;
  /** The dark ceiling, and the trim on skirtings, door frames and pilasters. */
  ceiling: RGB; trim: RGB;
  fitting: Fitting;
  /** Slow motes (incense, steam, spores, dust) rising over the nearest fixtures of one kind. */
  motes: { color: RGB; over: InteriorFixture["kind"]; hz: number; glyph: string } | null;
}
const GROUND_THEMES: Readonly<Record<GroundFloorKind, GroundTheme>> = {
  "lobby": { floor: SURFACE.tile, wall: SURFACE.plaster, floorColor: [108, 102, 96], wallColor: [130, 120, 106], ceiling: [30, 29, 32], trim: [92, 74, 58], fitting: "pendant", motes: null },
  "capsule-hotel": { floor: SURFACE.vinyl, wall: SURFACE.panel, floorColor: [104, 114, 126], wallColor: [128, 138, 150], ceiling: [26, 30, 38], trim: [86, 96, 110], fitting: "tube", motes: null },
  "corp-lobby": { floor: SURFACE.polished, wall: SURFACE.glazing, floorColor: [122, 128, 138], wallColor: [96, 112, 130], ceiling: [24, 28, 36], trim: [170, 180, 190], fitting: "ring", motes: null },
  "arcade": { floor: SURFACE.carpet, wall: SURFACE.panel, floorColor: [84, 62, 112], wallColor: [96, 80, 128], ceiling: [24, 20, 34], trim: [72, 58, 100], fitting: "neon", motes: null },
  "pawnshop": { floor: SURFACE.planks, wall: SURFACE.plaster, floorColor: [102, 82, 64], wallColor: [116, 102, 86], ceiling: [24, 21, 19], trim: [80, 60, 44], fitting: "pendant", motes: { color: [200, 180, 150], over: "case", hz: 0.05, glyph: "." } },
  "machine-shop": { floor: SURFACE.grating, wall: SURFACE.block, floorColor: [92, 98, 104], wallColor: [96, 100, 106], ceiling: [20, 24, 28], trim: [180, 150, 60], fitting: "cage", motes: { color: [210, 200, 170], over: "lathe", hz: 0.06, glyph: "." } },
  "server-hall": { floor: SURFACE.raised, wall: SURFACE.panel, floorColor: [112, 122, 136], wallColor: [108, 122, 142], ceiling: [24, 30, 40], trim: [84, 100, 122], fitting: "tube", motes: null },
  "shrine": { floor: SURFACE.tatami, wall: SURFACE.plaster, floorColor: [150, 140, 98], wallColor: [140, 98, 80], ceiling: [24, 17, 15], trim: [130, 36, 32], fitting: "lantern", motes: { color: [200, 190, 180], over: "altar", hz: 0.07, glyph: ":" } },
  "hydroponics": { floor: SURFACE.grating, wall: SURFACE.glazedTile, floorColor: [80, 94, 88], wallColor: [150, 162, 158], ceiling: [18, 20, 22], trim: [60, 80, 70], fitting: "grow", motes: { color: [200, 255, 210], over: "growrack", hz: 0.05, glyph: "." } },
  "laundromat": { floor: SURFACE.vinyl, wall: SURFACE.glazedTile, floorColor: [118, 124, 128], wallColor: [162, 172, 178], ceiling: [24, 28, 32], trim: [80, 140, 170], fitting: "tube", motes: { color: [220, 235, 245], over: "washer", hz: 0.11, glyph: ":" } },
  "market-hall": { floor: SURFACE.tile, wall: SURFACE.block, floorColor: [110, 100, 90], wallColor: [112, 100, 90], ceiling: [20, 18, 20], trim: [90, 70, 50], fitting: "pendant", motes: { color: [255, 220, 170], over: "stall", hz: 0.09, glyph: ":" } },
  "chandlery": { floor: SURFACE.planks, wall: SURFACE.plaster, floorColor: [112, 94, 72], wallColor: [124, 112, 96], ceiling: [24, 21, 19], trim: [70, 90, 110], fitting: "lantern", motes: null },
  "apartment": { floor: SURFACE.planks, wall: SURFACE.plaster, floorColor: [110, 90, 72], wallColor: [132, 124, 114], ceiling: [26, 24, 24], trim: [96, 82, 68], fitting: "pendant", motes: null },
  "garage": { floor: SURFACE.concrete, wall: SURFACE.block, floorColor: [100, 100, 98], wallColor: [92, 94, 96], ceiling: [18, 18, 20], trim: [220, 180, 50], fitting: "cage", motes: { color: [190, 170, 140], over: "car", hz: 0.04, glyph: "." } },
};
/** Fine dressing (buttons, LEDs, goods, seams) and full resident figures only within this range (m). */
const GROUND_DETAIL_RANGE = 11;
const GROUND_LIGHTS = 8;
/** Minimum luminance (0..1) of a ceiling light's colour as sent to the shader. */
const GROUND_LIGHT_LUMA = 0.8;
const ARCADE_INKS: readonly RGB[] = [[255, 71, 148], [64, 210, 232], [255, 196, 96], [133, 155, 255], [107, 226, 162]];
const CABINET_BODIES: readonly RGB[] = [[72, 64, 112], [118, 52, 90], [52, 88, 120], [104, 94, 70]];
const LOCKERS: readonly RGB[] = [[96, 120, 132], [120, 110, 90], [80, 104, 92], [130, 96, 84]];
const GOODS: readonly RGB[] = [[230, 190, 90], [90, 200, 150], [200, 210, 220], [220, 60, 80], [120, 170, 255], [210, 150, 90]];
const CUSHIONS: readonly RGB[] = [[70, 60, 120], [150, 50, 50], [180, 140, 60], [60, 100, 90]];
const STRIPES: readonly RGB[] = [[190, 60, 60], [60, 120, 170], [60, 140, 90], [200, 140, 50]];
const PRODUCE: readonly RGB[] = [[220, 80, 60], [240, 170, 60], [120, 190, 80], [190, 90, 160], [230, 220, 120]];
const CRATES: readonly RGB[] = [[150, 110, 72], [86, 100, 70], [60, 100, 150], [200, 110, 50]];
const UNITS: readonly RGB[] = [[180, 176, 166], [90, 120, 110], [160, 110, 80], [70, 80, 96]];
const FABRICS: readonly RGB[] = [[120, 60, 70], [60, 90, 120], [110, 100, 70], [80, 70, 110], [70, 110, 90]];
const SCREENS: readonly RGB[] = [[110, 200, 255], [120, 255, 170], [255, 196, 120]];
const CARS: readonly RGB[] = [[150, 40, 46], [40, 70, 120], [190, 186, 176], [40, 40, 44], [200, 150, 50], [60, 110, 90]];
const GROW_PINK: RGB = [255, 96, 214];
const LED_GREEN: RGB = [120, 255, 170];
const LACQUER: RGB = [150, 40, 36];
const GOLD: RGB = [206, 166, 80];

function hash01(n: number): number { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function pick<T>(list: readonly T[], seed: number): T { return list[Math.min(list.length - 1, Math.max(0, Math.floor(seed * list.length)))]; }
/** A per-fixture variation of a colour: a little brighter or darker and warmer or cooler. */
function varied(color: RGB, seed: number, amount = 0.22): RGB {
  const k = 1 + (seed - 0.5) * amount, warm = (hash01(seed * 7.3) - 0.5) * amount * 0.5;
  return [color[0] * k * (1 + warm), color[1] * k, color[2] * k * (1 - warm)];
}
/** A palette blended smoothly in turn (no step ever switches), like the club wash. */
function cycle(palette: readonly RGB[], phase: number): RGB {
  const position = (((phase % 1) + 1) % 1) * palette.length, index = Math.floor(position) % palette.length;
  const blend = position - Math.floor(position), smooth = blend * blend * (3 - 2 * blend);
  const from = palette[index], to = palette[(index + 1) % palette.length];
  return [from[0] + (to[0] - from[0]) * smooth, from[1] + (to[1] - from[1]) * smooth, from[2] + (to[2] - from[2]) * smooth];
}
function mixRGB(a: RGB, b: RGB, k: number): RGB { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
function disc(canvas: PropCanvas, x: number, height: number, z: number, rx: number, ry: number, rz: number): void {
  canvas.translate(x, -height, z); canvas.ellipsoid(rx, ry, rz); canvas.translate(-x, height, -z);
}

function smooth01(k: number): number { const c = Math.max(0, Math.min(1, k)); return c * c * (3 - 2 * c); }

// ---- Ground-floor lettering -----------------------------------------------------------------------
// The interior material prints each letter as a 3x5 bitmap sampled once per cell, so a letter only
// reads while every font pixel spans more than a cell. Ground-floor signs are laid out in font pixels
// (letters 3 px wide on a 4 px pitch, 5 px tall), sit on a dark backing board, and fade in with the
// on-screen size of a font pixel: invisible below SIGN_GONE cells per pixel, full at SIGN_SHARP.
// A sign seen edge-on or from behind (mirrored) is not drawn. The shader also drops letters whose
// pixels fall under a cell (u_ground only), as a safety net for anything not faded here.
/** Cells per metre at 1 m: grid rows / (2 tan(fov / 2)); 100 for 120 rows at the 62 deg interior camera.
 * engine.ts reports the real grid rows each interior frame (rows vary with quality, DPR and aspect). */
let signCellsPerMetre = 100;
export function setInteriorView(rows: number, fovDegrees: number): void {
  const rowCount = Number.isFinite(rows) && rows > 8 ? rows : 120;
  signCellsPerMetre = rowCount / (2 * Math.tan(fovDegrees * Math.PI / 360));
}
const SIGN_GONE = 0.95;
const SIGN_SHARP = 1.35;
/** Eye height of a walking visitor (locomotion.ts WALK_HEIGHT). */
const SIGN_EYE = 2.7;
const SIGN_BACKING: RGB = [16, 19, 26];
/** The visitor's room-space position while a ground floor draws, and the room-space frame of the
 * fixture being drawn (lettering inside a fixture measures its legibility in room space). */
let groundEye: { readonly x: number; readonly z: number } = { x: 0, z: 0 };
let groundFrame: { readonly x: number; readonly z: number; readonly yaw: number } = { x: 0, z: 0, yaw: 0 };
function roomPoint(lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(groundFrame.yaw), s = Math.sin(groundFrame.yaw);
  return { x: groundFrame.x + lx * c + lz * s, z: groundFrame.z - lx * s + lz * c };
}
/** 0..1: how legible a sign facing room-space yaw (degrees) is from the visitor's eye. */
function signGain(x: number, height: number, z: number, yaw: number, pixel: number): number {
  const dx = groundEye.x - x, dy = SIGN_EYE - height, dz = groundEye.z - z;
  const distance = Math.max(0.3, Math.hypot(dx, dy, dz)), r = yaw * Math.PI / 180;
  const facing = (dx * Math.sin(r) + dz * Math.cos(r)) / distance;
  if (facing < 0.25) return 0;
  const along = (dx * Math.cos(r) - dz * Math.sin(r)) / distance, rise = dy / distance;
  const squash = Math.min(Math.sqrt(Math.max(0, 1 - along * along)), Math.sqrt(Math.max(0, 1 - rise * rise)));
  const cells = signCellsPerMetre * pixel * squash / distance;
  return smooth01((cells - SIGN_GONE) / (SIGN_SHARP - SIGN_GONE)) * smooth01((facing - 0.25) / 0.2);
}
/** The largest font pixel (<= most) that fits `text` in `width`, abbreviating to fit: the full text,
 * then without FLOOR/ROOM, then its first word. Null when even that would be smaller than `least`. */
function fitSign(text: string, width: number, most: number, least: number): { text: string; pixel: number } | null {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  for (const option of [words.join(" "), words.filter(word => word !== "FLOOR" && word !== "ROOM").join(" "), words[0] ?? ""]) {
    if (!option) continue;
    const pixel = Math.min(most, width / (4 * option.length - 1));
    if (pixel >= least) return { text: option, pixel };
  }
  return null;
}
/** A sign in the current frame at (x, height, z), facing local yaw (degrees): a dark board, a thin lit
 * rule above and below it, and the letters faded in by legibility. `shown` (0..1, default 1) opens the
 * board: below 1 it is that fraction of its height (eased, never a pop) with rules and letters dimmed. */
function groundSign(canvas: PropCanvas, text: string, x: number, height: number, z: number, pixel: number, yaw: number, color: RGB, backing = true, shown = 1): void {
  if (shown <= 0.01) return;
  const room = roomPoint(x, z), gain = signGain(room.x, height, room.z, yaw + groundFrame.yaw * 180 / Math.PI, pixel) * shown;
  const count = text.length, width = (4 * count - 1) * pixel;
  canvas.push(); canvas.translate(x, -height, z); canvas.rotateY(yaw);
  if (backing) {
    style(canvas, SIGN_BACKING, " "); block(canvas, 0, 0, -0.03, width + 3 * pixel, 9 * pixel * shown, 0.04);
    style(canvas, gained(color, 0.4 * shown), "-", true);
    for (const side of [-1, 1]) block(canvas, 0, side * 4.5 * pixel * shown, -0.005, width + 3 * pixel, Math.max(0.05, pixel * 0.6), 0.012);
  }
  if (backing && gain < 0.98) {
    // Too far to read: each word is a dim lit text bar (like the street signs' panel tier), so a
    // board is never blank; it crossfades with the letters as they come into focus.
    style(canvas, gained(color, 0.32 * (1 - gain) * shown), "=", true);
    let start = 0;
    for (let index = 0; index <= count; index++) {
      if (index < count && text[index] !== " ") continue;
      if (index > start) {
        const from = (start - (count - 1) / 2) * 4 * pixel - 1.5 * pixel, to = (index - 1 - (count - 1) / 2) * 4 * pixel + 1.5 * pixel;
        block(canvas, (from + to) / 2, 0, -0.008, to - from, 2.2 * pixel, 0.01);
      }
      start = index + 1;
    }
  }
  if (gain > 0.02) {
    style(canvas, gained(color, gain), "#", true);
    for (const [index, character] of [...text].entries()) {
      if (character === " ") continue;
      const offset = (index - (count - 1) / 2) * 4 * pixel;
      canvas.cellColor(character.charCodeAt(0), 255, 0, 0);
      canvas.translate(offset, 0, 0); canvas.rect(3 * pixel, 5 * pixel); canvas.translate(-offset, 0, 0);
    }
  }
  canvas.pop();
}

// ---- Ground-floor wall dressing ---------------------------------------------------------------------
// One piece per wall bay (between pilasters) on the side and back walls: posters, notice boards,
// vents, service panels, scrolls and framed art per kind, hung above the furniture.
type Decor = "poster" | "vent" | "notice" | "panel" | "scroll" | "art";
const DECOR: Readonly<Record<GroundFloorKind, readonly Decor[]>> = {
  "lobby": ["notice", "art", "vent"], "capsule-hotel": ["panel", "notice", "vent"], "corp-lobby": ["art", "art", "vent"],
  "arcade": ["poster", "poster", "vent"], "pawnshop": ["notice", "poster", "art"], "machine-shop": ["panel", "notice", "vent"],
  "server-hall": ["panel", "vent", "panel"], "shrine": ["scroll", "scroll", "art"], "hydroponics": ["panel", "vent", "notice"],
  "laundromat": ["notice", "poster", "vent"], "market-hall": ["poster", "notice", "vent"], "chandlery": ["notice", "art", "scroll"],
  "apartment": ["art", "poster", "notice"], "garage": ["notice", "panel", "vent"],
};
/** A high neon line along the shell walls under the ceiling (null: none). */
const CORNICE: Readonly<Partial<Record<GroundFloorKind, RGB>>> = {
  "arcade": [255, 71, 148], "server-hall": [90, 160, 255], "capsule-hotel": [120, 220, 255],
};
const WALL_DADO = 1.1;
/** One wall piece, in a frame whose origin is the wall's inner face and whose +z points into the room. */
function wallDecor(canvas: PropCanvas, decor: Decor, seed: number, theme: GroundTheme, place: InteriorPlace, near: boolean): void {
  switch (decor) {
    case "poster": {
      // A bill in a dark frame; the arcade's are lit boxes. Up close: a big round motif and a title band.
      const glow = place.kind === "arcade", color = glow ? pick(ARCADE_INKS, seed) : varied(pick(GOODS, seed), seed);
      style(canvas, DARK, "#"); block(canvas, 0, 3.0, 0.03, 1.0, 1.36, 0.06);
      style(canvas, glow ? gained(color, 0.55) : color, "%", glow); block(canvas, 0, 3.0, 0.065, 0.84, 1.2, 0.01);
      if (!near) return;
      style(canvas, mixRGB(color, DARK, 0.65), "=", false); block(canvas, 0, 3.42, 0.072, 0.84, 0.22, 0.01);
      style(canvas, glow ? gained(pick(ARCADE_INKS, (seed * 5.3) % 1), 0.8) : mixRGB(color, [235, 230, 215], 0.5), "o", glow); block(canvas, 0, 2.85, 0.074, 0.42, 0.42, 0.01);
      return;
    }
    case "vent":
      style(canvas, gained(METAL, 0.8), "#"); block(canvas, 0, 4.7, 0.025, 1.1, 0.62, 0.05);
      style(canvas, [36, 40, 48], "="); block(canvas, 0, 4.7, 0.055, 0.94, 0.46, 0.01);
      return;
    case "notice": {
      // A cork board with a few pinned sheets.
      style(canvas, [104, 80, 56], "#"); block(canvas, 0, 2.95, 0.025, 1.3, 0.86, 0.05);
      if (!near) return;
      style(canvas, [214, 210, 194], "-");
      for (let k = 0; k < 3; k++) block(canvas, (k - 1) * 0.4 + (hash01(seed * 9 + k) - 0.5) * 0.08, 2.95 + (hash01(seed * 13 + k) - 0.5) * 0.2, 0.055, 0.28, 0.36, 0.01);
      return;
    }
    case "panel":
      // A service panel with a conduit to the ceiling and two status lamps.
      style(canvas, [132, 138, 148], "#"); block(canvas, 0, 2.7, 0.07, 0.7, 0.9, 0.14);
      style(canvas, gained(METAL, 0.85), "|"); block(canvas, 0, (3.15 + INTERIOR_HEIGHT) / 2, 0.045, 0.1, INTERIOR_HEIGHT - 3.15, 0.09);
      if (!near) return;
      style(canvas, [70, 76, 86], "-"); block(canvas, 0, 2.6, 0.142, 0.56, 0.5, 0.01);
      style(canvas, gained(LED_GREEN, 0.7), "o", true); block(canvas, -0.18, 3.0, 0.145, 0.08, 0.08, 0.01);
      style(canvas, gained([255, 176, 72], 0.7), "o", true); block(canvas, 0.0, 3.0, 0.145, 0.08, 0.08, 0.01);
      return;
    case "scroll":
      // A hanging scroll: pale paper between dark rods, one long brush stroke.
      style(canvas, [214, 200, 170], "|"); block(canvas, 0, 3.0, 0.02, 0.6, 1.7, 0.01);
      style(canvas, gained(LACQUER, 0.7), "="); for (const end of [-1, 1]) block(canvas, 0, 3.0 + end * 0.88, 0.03, 0.72, 0.07, 0.05);
      if (near) { style(canvas, [44, 34, 34], ":"); block(canvas, 0, 3.08, 0.03, 0.14, 1.0, 0.01); }
      return;
    case "art": {
      // A framed landscape: dark sky over a coloured ground, in a trim-coloured frame.
      const color = varied(pick(FABRICS, seed), seed);
      style(canvas, theme.trim, "#"); block(canvas, 0, 3.0, 0.03, 1.6, 1.06, 0.06);
      style(canvas, mixRGB(color, DARK, 0.5), "%"); block(canvas, 0, 3.0, 0.065, 1.42, 0.88, 0.01);
      if (near) { style(canvas, gained(color, 1.3), "~"); block(canvas, 0, 2.8, 0.072, 1.42, 0.36, 0.01); }
      return;
    }
  }
}

const groundPlans = new WeakMap<InteriorPlace, GroundPlan>();
function planOf(place: InteriorPlace): GroundPlan {
  let plan = groundPlans.get(place);
  if (!plan) { plan = groundFloorPlan(place); groundPlans.set(place, plan); }
  return plan;
}

function groundResidents(place: InteriorPlace): readonly InteriorResident[] {
  const [first, second] = LINES[place.kind];
  return planOf(place).residents.map((person, index): InteriorResident => ({
    x: person.x, z: person.z, tint: person.tint, offset: person.offset, seated: person.seated, facing: person.facing,
    line: person.line || (index % 2 ? second : first),
  }));
}

/** A doorway between two collinear wall segments (or a wall and the shell): the header above it, its
 * jambs, and the names of the rooms either side, each printed on the face looking away from its room. */
interface Doorway { x: number; z: number; alongX: boolean; gap: number; thick: number; top: number; labels: { text: string; yaw: number; offset: number }[] }
const doorwayCache = new WeakMap<readonly InteriorFixture[], readonly Doorway[]>();
// Above the walking eye (WALK_HEIGHT 2.7) with headroom, so lintels and their signs pass overhead.
const DOOR_HEAD = 3.6;
/** Doorway room names: the widest board (m) and the font pixel (m; a letter is 5 px tall, 4 px pitch). */
const DOOR_SIGN_WIDTH = 2.8;
const DOOR_SIGN_PIXEL = 0.1;
/** The building name on the back wall (corporate lobbies x1.25; abbreviated below 0.75x) and EXIT. */
const BACK_SIGN_PIXEL = 0.22;
const EXIT_SIGN_PIXEL = 0.14;
/** What a ground-floor resident says over their head (letters 0.18 m on a 0.18 m pitch). */
const SPEECH_PIXEL = 0.045;
function doorways(place: InteriorPlace, fixtures: readonly InteriorFixture[], plan: GroundPlan): readonly Doorway[] {
  const cached = doorwayCache.get(fixtures);
  if (cached) return cached;
  const walls = fixtures.filter(item => item.kind === "wall");
  const found: Doorway[] = [];
  const shellX = place.width / 2 - 0.175, shellZ = place.depth / 2 - 0.175;
  const roomAt = (x: number, z: number) => plan.rooms.find(room => Math.abs(x - room.x) < room.width / 2 && Math.abs(z - room.z) < room.depth / 2) ?? null;
  const add = (alongX: boolean, line: number, from: number, to: number, thick: number, top: number) => {
    const gap = to - from;
    if (gap < 0.6 || gap > 3.2) return;
    const middle = (from + to) / 2, x = alongX ? middle : line, z = alongX ? line : middle;
    const labels: Doorway["labels"] = [];
    for (const side of [-1, 1]) {
      const probe = thick / 2 + 0.7, room = roomAt(alongX ? x : x + side * probe, alongX ? z + side * probe : z);
      if (!room || !room.label) continue;
      // Print on the opposite face, facing away from the room: rotateY(yaw) turns +z to (sin, cos).
      labels.push({ text: room.label.toUpperCase(), yaw: alongX ? (side < 0 ? 0 : 180) : (side < 0 ? 90 : -90), offset: -side * (thick / 2 + 0.02) });
    }
    found.push({ x, z, alongX, gap, thick, top, labels });
  };
  for (const [i, a] of walls.entries()) {
    const aX = a.width >= a.depth, aLine = aX ? a.z : a.x, aThick = aX ? a.depth : a.width;
    const aFrom = (aX ? a.x : a.z) - (aX ? a.width : a.depth) / 2, aTo = aFrom + (aX ? a.width : a.depth);
    const shell = aX ? shellX : shellZ;
    if (aFrom > -shell + 0.3) add(aX, aLine, -shell, aFrom, aThick, a.height);
    if (aTo < shell - 0.3) add(aX, aLine, aTo, shell, aThick, a.height);
    for (const b of walls.slice(i + 1)) {
      const bX = b.width >= b.depth;
      if (bX !== aX || Math.abs((bX ? b.z : b.x) - aLine) > 0.15) continue;
      const bFrom = (bX ? b.x : b.z) - (bX ? b.width : b.depth) / 2, bTo = bFrom + (bX ? b.width : b.depth);
      if (bFrom >= aTo) add(aX, aLine, aTo, bFrom, aThick, Math.min(a.height, b.height));
      else if (aFrom >= bTo) add(aX, aLine, bTo, aFrom, aThick, Math.min(a.height, b.height));
    }
  }
  // A wall end facing the shell may be closed by a perpendicular wall instead; keep a doorway only if
  // its opening is really open (no other wall crosses the gap's middle).
  const open = found.filter(door => !walls.some(item => Math.abs(door.x - item.x) < item.width / 2 - 0.05 && Math.abs(door.z - item.z) < item.depth / 2 - 0.05));
  doorwayCache.set(fixtures, open);
  return open;
}

function groundWall(canvas: PropCanvas, item: InteriorFixture, theme: GroundTheme): void {
  const { x, z, width, depth, height } = item;
  style(canvas, theme.wallColor, ".", false, theme.wall); block(canvas, x, height / 2, z, width, height, depth);
  style(canvas, gained(theme.trim, 0.6), "="); block(canvas, x, 0.08, z, width + 0.03, 0.16, depth + 0.03);
  style(canvas, theme.trim, "="); block(canvas, x, WALL_DADO, z, width + 0.03, 0.12, depth + 0.03);
  if (height < INTERIOR_HEIGHT - 0.2) { style(canvas, theme.trim, "="); block(canvas, x, height - 0.04, z, width + 0.04, 0.08, depth + 0.04); }
}

function groundDoorway(canvas: PropCanvas, door: Doorway, theme: GroundTheme, near: boolean, low: boolean): void {
  const { x, z, alongX, gap, thick, top } = door;
  const across = (w: number, d: number): [number, number] => alongX ? [w, d] : [d, w];
  if (top > DOOR_HEAD + 0.1) {
    const [w, d] = across(gap, thick);
    style(canvas, theme.wallColor, ".", false, theme.wall); block(canvas, x, (top + DOOR_HEAD) / 2, z, w, top - DOOR_HEAD, d);
  }
  style(canvas, theme.trim, "|");
  const [lw, ld] = across(gap + 0.16, thick + 0.06); block(canvas, x, DOOR_HEAD + 0.05, z, lw, 0.1, ld);
  for (const side of [-1, 1]) {
    const [jw, jd] = across(0.08, thick + 0.06), along = side * (gap / 2 + 0.02);
    block(canvas, alongX ? x + along : x, DOOR_HEAD / 2, alongX ? z : z + along, jw, DOOR_HEAD, jd);
  }
  if (top < DOOR_HEAD + 0.85 || (!near && low)) return;
  // Room names over the doorway: up to 0.3 m per letter on a board (drawn at any distance so it
  // never pops), the letters fading in within about 5-7 m.
  for (const label of door.labels) {
    const fit = fitSign(label.text, Math.min(DOOR_SIGN_WIDTH, gap + 1.2), DOOR_SIGN_PIXEL, DOOR_SIGN_PIXEL * 0.65);
    if (!fit) continue;
    const lx = alongX ? x : x + label.offset, lz = alongX ? z + label.offset : z;
    // Out from the wall face along the label's facing so the board never sinks into the wall.
    const r = label.yaw * Math.PI / 180, out = 0.04;
    groundSign(canvas, fit.text, lx + Math.sin(r) * out, DOOR_HEAD + 0.12 + 4.5 * fit.pixel, lz + Math.cos(r) * out, fit.pixel, label.yaw, WARM);
  }
}

/** A ceiling fitting at one of the plan's lights, in that light's colour. */
function groundFitting(canvas: PropCanvas, fitting: Fitting, x: number, z: number, color: RGB, time: number, seed: number, near: boolean): void {
  const top = INTERIOR_HEIGHT;
  switch (fitting) {
    case "tube":
      style(canvas, DARK, "="); block(canvas, x, top - 0.1, z, 1.7, 0.08, 0.3);
      style(canvas, color, "=", true); block(canvas, x, top - 0.17, z, 1.5, 0.05, 0.14);
      return;
    case "pendant":
      style(canvas, DARK, "|"); block(canvas, x, top - 0.5, z, 0.03, 1.0, 0.03);
      style(canvas, [56, 50, 44], "^"); block(canvas, x, top - 1.08, z, 0.52, 0.2, 0.52);
      style(canvas, color, "o", true); block(canvas, x, top - 1.23, z, 0.22, 0.1, 0.22);
      return;
    case "lantern":
      style(canvas, DARK, "|"); block(canvas, x, top - 0.45, z, 0.03, 0.9, 0.03);
      style(canvas, gained(color, 0.86 + 0.08 * Math.sin(time * 0.5 + seed * 6.3)), "O", true); disc(canvas, x, top - 1.3, z, 0.3, 0.4, 0.3);
      if (near) { style(canvas, DARK, "="); block(canvas, x, top - 0.9, z, 0.24, 0.06, 0.24); block(canvas, x, top - 1.71, z, 0.24, 0.06, 0.24); }
      return;
    case "grow":
      style(canvas, DARK, "="); block(canvas, x, top - 0.6, z, 2.3, 0.1, 0.36);
      style(canvas, color, "=", true); block(canvas, x, top - 0.67, z, 2.1, 0.04, 0.26);
      if (near) { style(canvas, METAL, "|"); for (const side of [-1, 1]) block(canvas, x + side * 0.9, top - 0.28, z, 0.02, 0.56, 0.02); }
      return;
    case "ring":
      style(canvas, color, "=", true);
      for (const side of [-1, 1]) { block(canvas, x, top - 0.25, z + side * 0.8, 1.7, 0.06, 0.1); block(canvas, x + side * 0.8, top - 0.25, z, 0.1, 0.06, 1.5); }
      if (near) { style(canvas, METAL, "|"); for (const side of [-1, 1]) block(canvas, x + side * 0.8, top - 0.12, z, 0.02, 0.24, 0.02); }
      return;
    case "cage":
      style(canvas, DARK, "|"); block(canvas, x, top - 0.38, z, 0.03, 0.76, 0.03);
      style(canvas, [74, 74, 78], "^"); block(canvas, x, top - 0.82, z, 0.62, 0.16, 0.62);
      style(canvas, color, "o", true); block(canvas, x, top - 0.95, z, 0.22, 0.1, 0.22);
      if (near) { style(canvas, METAL, "#"); block(canvas, x, top - 1.02, z, 0.3, 0.1, 0.3); }
      return;
    case "neon":
      // Two bare tubes, the plan's colour and a pink twin, breathing very slowly out of step.
      style(canvas, gained(color, 0.82 + 0.1 * Math.sin(time * 0.35 + seed * 5)), "=", true); block(canvas, x, top - 0.14, z - 0.2, 2.2, 0.05, 0.05);
      style(canvas, gained(ARCADE_INKS[0], 0.75 + 0.1 * Math.sin(time * 0.35 + seed * 5 + 2.1)), "=", true); block(canvas, x, top - 0.14, z + 0.2, 2.2, 0.05, 0.05);
      return;
  }
}

function cabinet(canvas: PropCanvas, w: number, d: number, h: number, seed: number, time: number, near: boolean): void {
  // An upright arcade cabinet, front toward local +z (the aisle): a deep base, the control deck jutting
  // out at waist height, a recessed screen in attract mode (its colour drifts over ~30 s) in the
  // shallower upper body, and the lit marquee overhanging the top. Neon T-moulding traces the front
  // and top edges of each side so the stepped profile reads down a dim aisle.
  const body = varied(pick(CABINET_BODIES, seed), seed), ink = pick(ARCADE_INKS, (seed * 3.7) % 1), screen = cycle(ARCADE_INKS, time * 0.035 + seed);
  const back = -d / 2, front = d / 2, deck = Math.min(1.0, h * 0.5), marquee = Math.min(0.34, h * 0.18);
  const baseFront = front - 0.12, upperFront = front - 0.32, hoodFront = front - 0.06, upperTall = h - marquee - deck;
  style(canvas, body, "#");
  block(canvas, 0, deck / 2, (back + baseFront) / 2, w, deck, baseFront - back);
  block(canvas, 0, deck + upperTall / 2, (back + upperFront) / 2, w, upperTall, upperFront - back);
  block(canvas, 0, h - marquee / 2, (back + hoodFront) / 2, w, marquee, hoodFront - back);
  style(canvas, [58, 60, 76], "="); block(canvas, 0, deck + 0.06, (upperFront + front) / 2, w * 0.98, 0.12, front - upperFront);
  style(canvas, gained(ink, 0.95), "=", true); block(canvas, 0, h - marquee / 2, hoodFront + 0.012, w * 0.9, marquee * 0.72, 0.02);
  const screenTall = upperTall * 0.62, screenY = deck + 0.1 + upperTall * 0.45;
  style(canvas, [8, 8, 14], " "); block(canvas, 0, screenY, upperFront + 0.01, w * 0.86, screenTall + 0.1, 0.02);
  style(canvas, gained(screen, 0.95), ":", true); block(canvas, 0, screenY, upperFront + 0.024, w * 0.72, screenTall, 0.01);
  if (!near) return;
  // Near extras: the lit ones scale with `detail`, fading in over the last 2 m of the range.
  style(canvas, gained(ink, 0.7 * detail), "|", true);
  for (const side of [-1, 1]) {
    const sx = side * (w / 2 + 0.012);
    block(canvas, sx, deck / 2, baseFront - 0.04, 0.025, deck, 0.08);
    block(canvas, sx, deck + upperTall / 2, upperFront - 0.04, 0.025, upperTall, 0.08);
    block(canvas, sx, h - 0.05, (back + hoodFront) / 2, 0.025, 0.1, hoodFront - back);
  }
  style(canvas, gained(cycle(ARCADE_INKS, time * 0.035 + seed + 0.4), detail), "@", true); block(canvas, 0, screenY - screenTall * 0.1, upperFront + 0.03, 0.14, 0.16, 0.01);
  for (const [k, offset] of [0.06, 0.2].entries()) { style(canvas, gained(ARCADE_INKS[(k + Math.floor(seed * 5)) % ARCADE_INKS.length], detail), "o", true); block(canvas, offset, deck + 0.14, (upperFront + front) / 2 + 0.04, 0.09, 0.04, 0.09); }
  style(canvas, DARK, "|"); block(canvas, -w * 0.22, deck + 0.2, (upperFront + front) / 2, 0.04, 0.16, 0.04);
  style(canvas, [220, 40, 60], "o"); block(canvas, -w * 0.22, deck + 0.3, (upperFront + front) / 2, 0.09, 0.09, 0.09);
  style(canvas, [30, 30, 40], "#"); block(canvas, 0, deck * 0.45, baseFront + 0.01, w * 0.3, deck * 0.3, 0.02);
  style(canvas, gained(WARM, 0.6 * detail), "-", true); block(canvas, -w * 0.06, deck * 0.5, baseFront + 0.024, 0.06, 0.1, 0.01); block(canvas, w * 0.06, deck * 0.5, baseFront + 0.024, 0.06, 0.1, 0.01);
}

function pod(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean): void {
  // A capsule-hotel pod stack: one or two hatches, each a dark mouth with a lit strip above and below;
  // an occupied pod has its blind down and a warm line of light under it. A ladder to the upper one.
  const levels = h > 1.7 ? 2 : 1, level = h / levels, front = d / 2;
  style(canvas, varied([188, 192, 196], seed, 0.12), "#"); block(canvas, 0, h / 2, 0, w, h, d);
  for (let l = 0; l < levels; l++) {
    const middle = l * level + level * 0.52, occupied = hash01(seed * 31 + l) > 0.45, strip: RGB = hash01(seed * 17 + l) > 0.3 ? [120, 220, 255] : [255, 196, 120];
    style(canvas, [16, 20, 28], " "); block(canvas, 0, middle, front + 0.005, w * 0.78, level * 0.6, 0.02);
    if (occupied) {
      style(canvas, varied([120, 130, 150], hash01(seed + l)), "|"); block(canvas, 0, middle + 0.02, front + 0.012, w * 0.74, level * 0.52, 0.01);
      style(canvas, gained(WARM, 0.6), "-", true); block(canvas, 0, middle - level * 0.26, front + 0.014, w * 0.7, 0.03, 0.01);
    } else if (near) {
      style(canvas, [210, 214, 220], "="); block(canvas, -w * 0.25, middle - level * 0.2, front - 0.1, w * 0.22, 0.08, 0.16);
    }
    style(canvas, gained(strip, occupied ? 0.9 : 0.5), "=", true);
    block(canvas, 0, middle + level * 0.33, front + 0.016, w * 0.82, 0.035, 0.01);
    if (near) block(canvas, 0, middle - level * 0.33, front + 0.016, w * 0.82, 0.035, 0.01);
  }
  if (levels > 1 && near) { style(canvas, METAL, "H"); block(canvas, w * 0.4, h * 0.45, front + 0.1, 0.24, h * 0.88, 0.04); }
}

function locker(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean): void {
  const doors = Math.max(1, Math.round(w / 0.45)), door = w / doors, front = d / 2 + 0.006;
  style(canvas, varied(pick(LOCKERS, seed), seed), "#"); block(canvas, 0, h / 2, 0, w, h, d);
  style(canvas, DARK, "|"); for (let k = 1; k < doors; k++) block(canvas, -w / 2 + k * door, h / 2, front, 0.03, h - 0.1, 0.01);
  if (h > 1.4) { style(canvas, DARK, "-"); block(canvas, 0, h / 2, front, w, 0.03, 0.01); }
  if (!near) return;
  style(canvas, gained(DARK, 1.3), "=");
  for (let k = 0; k < doors; k++) block(canvas, -w / 2 + (k + 0.5) * door, h - 0.18, front + 0.004, door * 0.5, 0.1, 0.01);
  style(canvas, [200, 200, 196], ".");
  for (let k = 0; k < doors; k++) block(canvas, -w / 2 + (k + 0.8) * door, h * 0.38, front + 0.006, 0.04, 0.1, 0.02);
}

function rack(canvas: PropCanvas, w: number, d: number, h: number, seed: number, time: number, near: boolean): void {
  // A row of server racks (one bay per ~0.6 m): a steel frame with a pale top cap, slotted grille
  // doors, and a lit LED column per bay breathing slowly out of step (0.1-0.19 Hz, never blinking).
  // Up close: bay posts, a second LED column, amber status pairs and the cold-aisle line in front.
  const front = d / 2, bays = Math.max(1, Math.round(w / 0.6)), bay = w / bays;
  const led: RGB = seed > 0.35 ? [90, 255, 160] : [110, 180, 255];
  style(canvas, [74, 84, 102], "#"); block(canvas, 0, h / 2, 0, w, h, d);
  style(canvas, [128, 140, 158], "="); block(canvas, 0, h - 0.05, 0, w + 0.03, 0.1, d + 0.03);
  style(canvas, [46, 54, 68], "="); block(canvas, 0, h * 0.47, front + 0.005, w - 0.06, h * 0.84, 0.01);
  // Far: the first of each bay's two columns, at its near position and phase; the second fades in.
  const columns = near ? 2 : 1;
  for (let b = 0; b < bays; b++) for (let c = 0; c < columns; c++) {
    const k = b * 2 + c, gain = (0.62 + 0.2 * Math.sin(time * Math.PI * 2 * (0.1 + 0.03 * (k % 4)) + seed * 9 + k * 1.7)) * (c ? detail : 1);
    const lx = -w / 2 + (b + 0.5) * bay + (c - 0.5) * bay * 0.4;
    style(canvas, gained(led, gain), ":", true); block(canvas, lx, h * 0.48, front + 0.012, 0.09, h * 0.66, 0.01);
  }
  if (!near) return;
  style(canvas, [104, 116, 134], "|"); for (let b = 1; b < bays; b++) block(canvas, -w / 2 + b * bay, h * 0.47, front + 0.012, 0.07, h * 0.86, 0.02);
  style(canvas, gained([255, 176, 72], 0.8 * detail), "o", true);
  for (let b = 0; b < bays; b++) block(canvas, -w / 2 + (b + 0.5) * bay, h * 0.9, front + 0.014, 0.12, 0.06, 0.01);
  style(canvas, gained([90, 160, 255], 0.35 * detail), "-", true); block(canvas, 0, 0.012, front + 0.3, w * 0.9, 0.02, 0.05);
}

function glassCase(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean, place: InteriorPlace): void {
  // A display case: a wooden base, steel corner posts, a glass lid lit from inside, goods on show.
  const base = Math.min(0.9, h * 0.62);
  style(canvas, varied([92, 66, 48], seed), "#"); block(canvas, 0, base / 2, 0, w, base, d);
  style(canvas, [150, 190, 205], ":", false, SURFACE.glazing); block(canvas, 0, h - 0.01, 0, w, 0.02, d);
  style(canvas, gained(WARM, 0.7), "-", true); block(canvas, 0, h - 0.05, 0, w * 0.9, 0.02, 0.04);
  if (!near) { style(canvas, place.color, "o"); block(canvas, 0, base + 0.1, 0, w * 0.5, 0.2, d * 0.4); return; }
  style(canvas, METAL, "|");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(canvas, sx * (w / 2 - 0.03), (base + h) / 2, sz * (d / 2 - 0.03), 0.04, h - base, 0.04);
  const count = Math.max(2, Math.min(5, Math.round(w / 0.4)));
  for (let k = 0; k < count; k++) {
    style(canvas, pick(GOODS, hash01(seed * 13 + k)), pick(["o", "*", "%", "&", "$"], hash01(seed * 7 + k)));
    block(canvas, -w / 2 + (k + 0.5) * w / count, base + 0.1, (hash01(seed * 3 + k) - 0.5) * d * 0.4, Math.min(0.2, w / count * 0.7), 0.12 + hash01(seed + k * 2) * 0.12, 0.16);
  }
}

function washer(canvas: PropCanvas, w: number, d: number, h: number, seed: number, time: number, near: boolean): void {
  // A front-loader (a dryer stacked on it when tall): porthole ring and glass; a running drum shows
  // soapy water whose glow drifts gently (0.3 Hz, small), an idle one dark glass. A green readout.
  const units = h > 1.6 ? 2 : 1, unit = h / units, front = d / 2, radius = Math.min(w, unit) * 0.33;
  style(canvas, varied([206, 212, 214], seed, 0.12), "#"); block(canvas, 0, h / 2, 0, w, h, d);
  for (let u = 0; u < units; u++) {
    const centre = u * unit + unit * 0.46, running = hash01(seed * 13 + u) > 0.35;
    style(canvas, [88, 94, 102], "O"); disc(canvas, 0, centre, front + 0.02, radius, radius, 0.04);
    style(canvas, gained(running ? [140, 200, 235] : [44, 56, 70], running ? 0.5 + 0.08 * Math.sin(time * Math.PI * 2 * 0.3 + seed * 7 + u) : 0.25), running ? "~" : ":", true);
    disc(canvas, 0, centre, front + 0.045, radius * 0.72, radius * 0.72, 0.03);
    if (!near) continue;
    style(canvas, DARK, "="); block(canvas, 0, (u + 1) * unit - 0.1, front + 0.006, w * 0.9, 0.12, 0.01);
    if (running) { style(canvas, gained(LED_GREEN, 0.85), "-", true); block(canvas, w * 0.25, (u + 1) * unit - 0.1, front + 0.012, 0.18, 0.05, 0.01); }
  }
}

function lathe(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean): void {
  // A lathe along its width: legs, chip tray, the bed, headstock with chuck, workpiece, tailstock.
  const paint = varied([86, 110, 96], seed), top = Math.max(1.1, h * 0.8);
  style(canvas, [60, 66, 72], "#"); for (const side of [-1, 1]) block(canvas, side * w * 0.35, 0.4, 0, 0.3, 0.8, d * 0.8);
  style(canvas, [50, 54, 58], "="); block(canvas, 0, 0.82, 0, w, 0.06, d);
  style(canvas, paint, "="); block(canvas, 0, 0.98, -d * 0.1, w * 0.95, 0.26, d * 0.45);
  style(canvas, paint, "#"); block(canvas, -w * 0.36, top - 0.2, -d * 0.05, w * 0.24, 0.62, d * 0.7);
  style(canvas, [170, 176, 182], "O"); disc(canvas, -w * 0.22, top - 0.2, 0, 0.08, 0.2, 0.2);
  style(canvas, [200, 204, 210], "="); block(canvas, -w * 0.04, top - 0.2, 0, w * 0.3, 0.08, 0.08);
  style(canvas, paint, "#"); block(canvas, w * 0.3, top - 0.27, 0, w * 0.14, 0.36, d * 0.4);
  if (!near) return;
  style(canvas, METAL, "|"); block(canvas, -w * 0.36, top + 0.35, -d * 0.3, 0.04, 0.5, 0.04);
  style(canvas, gained(WARM, 0.9), "o", true); block(canvas, -w * 0.3, top + 0.55, -d * 0.15, 0.14, 0.1, 0.14);
  style(canvas, [220, 180, 50], "/"); block(canvas, 0, 0.3, d * 0.4 + 0.006, w * 0.5, 0.08, 0.01);
  style(canvas, gained([120, 255, 140], 0.8), "o", true); block(canvas, -w * 0.3, top - 0.05, d * 0.3 + 0.006, 0.06, 0.06, 0.02);
  style(canvas, gained([255, 80, 60], 0.8), "o", true); block(canvas, -w * 0.24, top - 0.05, d * 0.3 + 0.006, 0.06, 0.06, 0.02);
}

function tank(canvas: PropCanvas, w: number, d: number, h: number, seed: number, time: number, near: boolean, effects: boolean, place: InteriorPlace): void {
  // A glass tank on a plinth: a faint glowing water volume with a brighter surface, steel corners;
  // up close a few weeds and bubbles rising slowly (one every five seconds per column).
  const base = Math.min(0.7, h * 0.3), water = Math.max(0.2, h - base - 0.12);
  const tone: RGB = place.kind === "hydroponics" ? [90, 190, 130] : [60, 150, 200];
  style(canvas, [40, 46, 54], "#"); block(canvas, 0, base / 2, 0, w, base, d);
  style(canvas, gained(tone, 0.4), "~", true); block(canvas, 0, base + water / 2, 0, w - 0.08, water, d - 0.08);
  style(canvas, gained(mixRGB(tone, [220, 240, 255], 0.5), 0.6), "~", true); block(canvas, 0, base + water + 0.01, 0, w - 0.1, 0.02, d - 0.1);
  if (!near) return;
  style(canvas, METAL, "|");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(canvas, sx * (w / 2 - 0.02), base + (h - base) / 2, sz * (d / 2 - 0.02), 0.04, h - base, 0.04);
  style(canvas, [60, 150, 80], "|"); for (const k of [-1, 1]) block(canvas, k * w * 0.25, base + water * 0.3, -d * 0.2, 0.06, water * 0.55, 0.06);
  if (!effects) return;
  for (let k = 0; k < 3; k++) {
    const phase = ((time * 0.2 + k * 0.33 + seed) % 1 + 1) % 1;
    // Zero at the phase wrap (no top-to-bottom jump) and faded in with the near tier.
    style(canvas, gained([210, 240, 255], 0.55 * Math.sin(phase * Math.PI) * detail), "o", true);
    block(canvas, w * 0.3 - k * 0.08, base + 0.1 + phase * (water - 0.2), (k - 1) * 0.1, 0.05, 0.05, 0.05);
  }
}

function altar(canvas: PropCanvas, w: number, d: number, h: number, seed: number, time: number, near: boolean): void {
  // A street shrine altar: lacquered steps with a gold rim, a row of small old screens glowing in
  // slowly drifting colours, candles whose flames breathe (0.17 Hz), incense, and a torii frame behind.
  const top = Math.max(0.6, Math.min(h, 1.2));
  style(canvas, gained(LACQUER, 0.6), "#"); block(canvas, 0, 0.2, 0, w, 0.4, d);
  style(canvas, LACQUER, "#"); block(canvas, 0, 0.4 + (top - 0.4) / 2, -d * 0.1, w * 0.86, top - 0.4, d * 0.7);
  style(canvas, GOLD, "="); block(canvas, 0, top + 0.02, -d * 0.1, w * 0.9, 0.04, d * 0.74);
  // Far: the middle of the three screens only (same place, same colour); the outer two fade in.
  for (let k = 0; k < 3; k++) {
    if (!near && k !== 1) continue;
    const cx = (k - 1) * w * 0.3;
    style(canvas, [30, 30, 34], "#"); block(canvas, cx, top + 0.2, -d * 0.25, 0.36, 0.34, 0.3);
    style(canvas, gained(cycle([[255, 170, 90], [120, 220, 240], [255, 90, 140]], time * 0.03 + seed + k * 0.3), (0.75 + 0.08 * Math.sin(time * 0.6 + k)) * (k === 1 ? 1 : detail)), ":", true);
    block(canvas, cx, top + 0.21, -d * 0.25 + 0.155, 0.28, 0.24, 0.01);
  }
  if (!near) return;
  for (let k = 0; k < 5; k++) {
    const cx = (k - 2) * w * 0.16, tall = 0.14 + 0.05 * (k % 2);
    style(canvas, [236, 228, 210], "|"); block(canvas, cx, top + tall / 2, d * 0.15, 0.05, tall, 0.05);
    style(canvas, gained([255, 180, 90], (0.85 + 0.12 * Math.sin(time * 1.1 + k * 1.9)) * detail), "o", true); block(canvas, cx, top + tall + 0.04, d * 0.15, 0.05, 0.07, 0.05);
  }
  style(canvas, [120, 90, 70], "|"); for (const k of [-1, 1]) block(canvas, k * w * 0.42, top + 0.15, d * 0.05, 0.02, 0.3, 0.02);
  const back = -d / 2 + 0.08;
  style(canvas, LACQUER, "|"); for (const side of [-1, 1]) block(canvas, side * (w / 2 - 0.06), 1.3, back, 0.12, 2.6, 0.12);
  style(canvas, LACQUER, "="); block(canvas, 0, 2.62, back, w * 1.15, 0.14, 0.16);
  style(canvas, [30, 24, 22], "="); block(canvas, 0, 2.38, back, w * 0.98, 0.08, 0.1);
}

function stall(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean, place: InteriorPlace): void {
  // A market stall: a counter of produce under a striped canopy on four posts, a bulb under it.
  const counter = Math.min(1.0, Math.max(0.8, h * 0.4)), canopy = Math.max(2.2, Math.min(h, 2.8));
  const stripe = pick(STRIPES, seed), cloth: RGB = [228, 222, 206];
  style(canvas, varied(WOOD, seed), "#"); block(canvas, 0, counter / 2, d * 0.1, w, counter, d * 0.6);
  style(canvas, [170, 140, 100], "="); block(canvas, 0, counter + 0.02, d * 0.1, w + 0.06, 0.04, d * 0.64);
  style(canvas, METAL, "|"); for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(canvas, sx * (w / 2 - 0.05), canopy / 2, sz * (d / 2 - 0.05), 0.06, canopy, 0.06);
  const stripes = near ? 5 : 1;
  for (let s = 0; s < stripes; s++) { style(canvas, near ? (s % 2 ? cloth : stripe) : stripe, "="); block(canvas, -w / 2 + (s + 0.5) * w / stripes, canopy + 0.05, 0, w / stripes, 0.08, d + 0.2); }
  style(canvas, stripe, "v"); block(canvas, 0, canopy - 0.08, d / 2 + 0.1, w + 0.02, 0.18, 0.02);
  style(canvas, DARK, "|"); block(canvas, 0, canopy - 0.15, 0, 0.02, 0.26, 0.02);
  style(canvas, gained(WARM, 1), "o", true); block(canvas, 0, canopy - 0.34, 0, 0.14, 0.16, 0.14);
  if (!near) { style(canvas, place.color, "o"); block(canvas, 0, counter + 0.12, d * 0.15, w * 0.8, 0.2, d * 0.4); return; }
  for (let k = 0; k < 4; k++) { style(canvas, pick(PRODUCE, hash01(seed * 5 + k)), "o"); block(canvas, -w * 0.36 + k * w * 0.24, counter + 0.12, d * 0.15, w * 0.18, 0.2, d * 0.4); }
}

function crate(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean): void {
  const stack = h > 1.1 ? 2 : 1, each = h / stack;
  for (let s = 0; s < stack; s++) {
    const color = varied(pick(CRATES, (seed + s * 0.37) % 1), seed), shrink = s ? 0.88 : 1, offset = s ? (seed - 0.5) * 0.15 : 0;
    style(canvas, color, "#"); block(canvas, offset, s * each + each / 2, 0, w * shrink, each - 0.02, d * shrink);
    if (near) { style(canvas, gained(color, 0.7), "="); block(canvas, offset, s * each + each / 2, d * shrink / 2 + 0.005, w * shrink * 0.9, 0.06, 0.01); }
  }
}

function kitchenette(canvas: PropCanvas, w: number, d: number, h: number, seed: number, time: number, near: boolean): void {
  // Base units with a worktop, sink and hob, wall cupboards above the back, a microwave clock, and
  // a fridge at one end when there is room.
  const base = 0.9, unit = varied(pick(UNITS, seed), seed);
  style(canvas, unit, "#"); block(canvas, 0, base / 2, 0, w, base, d);
  style(canvas, [190, 186, 176], "="); block(canvas, 0, base + 0.02, 0.02, w + 0.04, 0.04, d + 0.04);
  if (h > 1.6) { style(canvas, unit, "#"); block(canvas, 0, 2.05, -d / 2 + 0.18, w, 0.7, 0.35); }
  if (w >= 2.2) {
    style(canvas, [200, 204, 206], "#"); block(canvas, w / 2 - 0.35, 0.95, 0, 0.66, 1.9, d);
    style(canvas, METAL, "|"); block(canvas, w / 2 - 0.62, 1.2, d / 2 + 0.01, 0.03, 0.5, 0.02);
  }
  if (!near) return;
  style(canvas, DARK, "|"); for (let k = 1; k * 0.6 < w - 0.3; k++) block(canvas, -w / 2 + k * 0.6, base * 0.5, d / 2 + 0.005, 0.02, base - 0.1, 0.01);
  style(canvas, [40, 46, 52], "="); block(canvas, -w * 0.2, base + 0.045, 0, 0.5, 0.01, d * 0.6);
  style(canvas, METAL, "|"); block(canvas, -w * 0.2, base + 0.18, -d * 0.32, 0.04, 0.26, 0.04);
  style(canvas, [60, 60, 64], "o"); block(canvas, w * 0.1, base + 0.06, 0, 0.5, 0.04, d * 0.6);
  if (hash01(seed * 19) > 0.5) { style(canvas, gained([255, 110, 60], 0.45 + 0.05 * Math.sin(time * 0.8 + seed * 4)), "o", true); block(canvas, w * 0.1, base + 0.085, 0, 0.2, 0.01, 0.2); }
  style(canvas, [30, 30, 34], "#"); block(canvas, -w * 0.38, base + 0.18, -d * 0.15, 0.5, 0.3, 0.35);
  style(canvas, gained(LED_GREEN, 0.8), "-", true); block(canvas, -w * 0.38 + 0.15, base + 0.25, -d * 0.15 + 0.18, 0.12, 0.04, 0.01);
}

function couch(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean): void {
  const fabric = varied(pick(FABRICS, seed), seed), back = Math.max(0.85, h);
  style(canvas, fabric, "#"); block(canvas, 0, 0.22, 0.05, w, 0.44, d * 0.9);
  style(canvas, gained(fabric, 1.15), "="); block(canvas, 0, 0.5, 0.1, w - 0.36, 0.14, d * 0.7);
  style(canvas, fabric, "#"); block(canvas, 0, back / 2, -d / 2 + 0.15, w, back, 0.3);
  for (const side of [-1, 1]) block(canvas, side * (w / 2 - 0.1), 0.35, 0.05, 0.2, 0.7, d * 0.9);
  if (!near) return;
  const seats = Math.max(1, Math.round((w - 0.36) / 0.7));
  style(canvas, gained(fabric, 0.7), "|"); for (let k = 1; k < seats; k++) block(canvas, -(w - 0.36) / 2 + k * (w - 0.36) / seats, 0.58, 0.1, 0.02, 0.02, d * 0.7);
  style(canvas, pick(FABRICS, (seed * 5.3) % 1), "o"); block(canvas, -w / 2 + 0.42, 0.75, -d / 2 + 0.38, 0.35, 0.3, 0.12);
}

function desk(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean, place: InteriorPlace): void {
  // A reception desk (lobbies: a solid front with a lit strip, the screen facing the clerk behind)
  // or a work desk (legs, the screen facing the front).
  const reception = place.kind === "corp-lobby" || place.kind === "lobby" || place.kind === "capsule-hotel";
  const top: RGB = place.kind === "corp-lobby" ? [214, 218, 222] : varied(WOOD, seed);
  const screenZ = reception ? -d * 0.1 : -d * 0.25, facing = reception ? -1 : 1, monitor = Math.min(0.7, w * 0.5);
  if (reception) {
    style(canvas, top, "#"); block(canvas, 0, h / 2, 0, w, h, d);
    style(canvas, gained(place.color, 0.8), "=", true); block(canvas, 0, h * 0.35, d / 2 + 0.01, w * 0.9, 0.04, 0.01);
  } else {
    style(canvas, top, "="); block(canvas, 0, h - 0.03, 0, w, 0.06, d);
    style(canvas, gained(top, 0.7), "#"); block(canvas, 0, h / 2, -d / 2 + 0.05, w * 0.9, h - 0.1, 0.04);
    if (near) { style(canvas, METAL, "|"); for (const side of [-1, 1]) block(canvas, side * (w / 2 - 0.05), h / 2, d / 2 - 0.08, 0.05, h - 0.06, 0.05); }
  }
  style(canvas, [30, 32, 38], "#"); block(canvas, 0, h + 0.28, screenZ, monitor, 0.42, 0.04);
  style(canvas, gained(pick(SCREENS, seed), 0.7), ":", true); block(canvas, 0, h + 0.3, screenZ + facing * 0.025, monitor * 0.88, 0.34, 0.01);
  if (!near) return;
  style(canvas, [50, 52, 58], "="); block(canvas, 0, h + 0.02, screenZ - facing * 0.3, 0.45, 0.02, 0.15);
  style(canvas, [220, 216, 200], "="); block(canvas, w * 0.3, h + 0.01, 0, 0.25, 0.01, 0.3);
  style(canvas, pick(GOODS, seed), "u"); block(canvas, -w * 0.32, h + 0.06, screenZ - facing * 0.25, 0.08, 0.1, 0.08);
}

function turnstile(canvas: PropCanvas, w: number, d: number, seed: number, near: boolean): void {
  // Security gates: steel pedestals at each lane edge, a green reader on top, glass flaps in each lane.
  const lanes = Math.max(1, Math.round(w / 0.9)), lane = w / lanes;
  for (let p = 0; p <= lanes; p++) {
    const px = Math.max(-w / 2 + 0.1, Math.min(w / 2 - 0.1, -w / 2 + p * lane));
    style(canvas, varied([180, 186, 192], seed, 0.08), "H"); block(canvas, px, 0.5, 0, 0.2, 1.0, d);
    style(canvas, gained(LED_GREEN, 0.85), "=", true); block(canvas, px, 1.02, d * 0.25, 0.14, 0.03, 0.2);
  }
  if (!near) return;
  style(canvas, [150, 200, 215], ":", false, SURFACE.glazing);
  for (let l = 0; l < lanes; l++) for (const side of [-1, 1]) block(canvas, -w / 2 + (l + 0.5) * lane + side * lane * 0.22, 0.75, 0, lane * 0.3, 0.5, 0.03);
}

function lift(canvas: PropCanvas, w: number, d: number, h: number, seed: number, time: number, near: boolean, current: number | null = null): void {
  // Lift doors in a steel frame, a floor indicator above that steps one floor every four seconds
  // (ping-ponging through the building), and a call button. A working lift (upper-floors.ts) shows
  // the floor it is on, steady.
  const door = Math.min(w * 0.7, 1.4), front = d / 2, tall = Math.min(2.4, h - 0.4);
  style(canvas, [60, 66, 74], "#"); block(canvas, 0, h / 2, 0, w, h, d);
  style(canvas, [170, 176, 184], "|");
  for (const side of [-1, 1]) block(canvas, side * (door / 2 + 0.06), tall / 2, front + 0.01, 0.1, tall, 0.03);
  block(canvas, 0, tall + 0.05, front + 0.01, door + 0.22, 0.1, 0.03);
  // The two door panels slide apart into the frame by `liftDoors` (a ride just arrived: open, then
  // easing shut), showing the dark car with its warm light; shut, the gap is the centre seam.
  const open = liftDoors, panel = (door / 2 - 0.01) * (1 - 0.85 * open), gap = Math.max(0.02, door - 0.01 - 2 * panel);
  style(canvas, [150, 156, 164], "|", false, SURFACE.panel);
  for (const side of [-1, 1]) block(canvas, side * (door / 2 - 0.005 - panel / 2), tall / 2, front + 0.006, panel, tall - 0.04, 0.02);
  style(canvas, DARK, "|"); block(canvas, 0, tall / 2, front + 0.012, gap, tall - 0.04, 0.01);
  if (open > 0.01) { style(canvas, gained(WARM, 0.3 * open), ":", true); block(canvas, 0, tall * 0.45, front + 0.0185, gap * 0.8, tall * 0.8, 0.003); }
  style(canvas, gained(WARM, 0.8), "o", true); block(canvas, door / 2 + 0.3, 1.1, front + 0.01, 0.08, 0.12, 0.02);
  // The floor indicator is drawn at every distance (its own legibility fade carries it) and always
  // two digits wide, so the board and arrow never shift between floors 9 and 10.
  const pixel = 0.06;
  if (current !== null) { groundSign(canvas, `${current}`.padStart(2, " "), -0.1, tall + 0.42, front + 0.06, pixel, 0, [255, 176, 72]); return; }
  const step = Math.floor(time / 4 + seed * 40), floors = 7 + Math.floor(seed * 9), cycleLength = floors * 2 - 2;
  const position = ((step % cycleLength) + cycleLength) % cycleLength, floor = position < floors ? position : cycleLength - position;
  groundSign(canvas, `${floor + 1}`.padStart(2, " "), -0.1, tall + 0.42, front + 0.06, pixel, 0, [255, 176, 72]);
  style(canvas, gained([255, 176, 72], 0.9), position < floors - 1 ? "^" : "v", true); block(canvas, 7 * pixel / 2 + 0.06, tall + 0.42, front + 0.035, 0.12, 0.14, 0.01);
}

/** The locked back room's lock light (rgb) and how slowly it breathes (Hz; motion comfort: under 0.4). */
const LOCK_RED: RGB = [255, 46, 52];
const LOCK_BREATH_HZ = 0.25;
function gateShutter(canvas: PropCanvas, w: number, d: number, seed: number, time: number, near: boolean): void {
  // A locked back room's security shutter filling its doorway (front +z faces the open floor): steel
  // guide channels, a roll housing under the lintel with a lit strip, a slatted steel curtain whose
  // slats and bottom hazard chevrons the material draws (surface 18), a lock plate left of centre with
  // a keypad and a red lamp breathing at 0.25 Hz, and LOCKED stencilled across the top. The gate is
  // gone from the fixtures once unlocked, so it is only ever drawn shut.
  const top = DOOR_HEAD, face = d * 0.3, curtain = w - 0.12;
  style(canvas, gained(METAL, 0.75), "|");
  for (const side of [-1, 1]) block(canvas, side * (w / 2 - 0.05), top / 2, 0, 0.1, top, d + 0.04);
  style(canvas, [46, 52, 60], "#"); block(canvas, 0, top - 0.17, 0, w, 0.34, d + 0.12);
  const strip: RGB = seed > 0.5 ? [255, 190, 110] : [170, 215, 255];
  style(canvas, gained(strip, 0.75), "=", true); block(canvas, 0, top - 0.37, d / 2 + 0.05, curtain * 0.92, 0.05, 0.03);
  style(canvas, varied([74, 82, 94], seed, 0.16), "-", false, SURFACE.shutter);
  block(canvas, 0, (0.3 + top - 0.34) / 2, 0, curtain, top - 0.34 - 0.3, 2 * face);
  style(canvas, [226, 178, 40], "=", false, SURFACE.shutter); block(canvas, 0, 0.15, 0, curtain, 0.3, 2 * face + 0.01);
  style(canvas, [36, 40, 46], "="); block(canvas, 0, 0.31, 0, curtain + 0.02, 0.04, 2 * face + 0.03); // the bottom bar's lip
  // The lock plate: a brushed panel, a dark keypad window, a card slot and the lamp.
  const px = -0.55, plate = 1.4;
  style(canvas, [150, 156, 166], "#", false, SURFACE.panel); block(canvas, px, plate, face + 0.02, 0.3, 0.5, 0.04);
  style(canvas, [24, 28, 34], "#"); block(canvas, px, plate - 0.04, face + 0.041, 0.22, 0.28, 0.005);
  style(canvas, [20, 22, 26], "-"); block(canvas, px, plate - 0.21, face + 0.041, 0.16, 0.025, 0.005);
  const breath = 0.5 - 0.5 * Math.cos(time * Math.PI * 2 * LOCK_BREATH_HZ + seed * 6.28);
  style(canvas, gained(LOCK_RED, 0.45 + 0.4 * breath), "o", true); block(canvas, px, plate + 0.17, face + 0.043, 0.09, 0.07, 0.01);
  if (near) {
    // Keypad keys (3 x 4), dimly backlit, fading in with the near tier.
    style(canvas, gained([150, 200, 220], 0.5 * detail), ".", true);
    for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) block(canvas, px + (column - 1) * 0.065, plate + 0.06 - row * 0.06, face + 0.045, 0.045, 0.04, 0.005);
  }
  // Per-gate dressing: a pale notice plate, a floor hasp at the bottom bar.
  if (seed > 0.4) {
    const nh = 1.55 + hash01(seed * 5.1) * 0.4;
    style(canvas, [196, 192, 176], "#"); block(canvas, 0.55, nh, face + 0.012, 0.42, 0.3, 0.01);
    if (near) { style(canvas, [180, 40, 40], "="); block(canvas, 0.55, nh + 0.1, face + 0.018, 0.42, 0.07, 0.004); }
  }
  if (hash01(seed * 9.7) > 0.45) { style(canvas, gained(METAL, 0.9), "#"); block(canvas, 0.3 - hash01(seed * 3.3) * 0.6, 0.38, face + 0.03, 0.14, 0.18, 0.06); }
  groundSign(canvas, "LOCKED", 0, 2.85, face + 0.06, 0.075, 0, LOCK_RED);
}

function mailbox(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean): void {
  // A bank of mail slots: brass or steel doors in a grid, a slot along each row.
  const metal: RGB = seed > 0.5 ? [160, 136, 84] : [120, 130, 140], front = d / 2;
  style(canvas, varied(metal, seed, 0.1), "#"); block(canvas, 0, h / 2, 0, w, h, d);
  const rows = Math.max(1, Math.min(8, Math.round(h * 0.85 / 0.25))), columns = Math.max(1, Math.min(10, Math.round(w / 0.3))), bottom = h * 0.12, row = (h * 0.85) / rows;
  style(canvas, DARK, "-");
  for (let r = 0; r <= (near ? rows : 1); r++) block(canvas, 0, near ? bottom + r * row : h * 0.5, front + 0.005, w - 0.06, 0.02, 0.01);
  if (!near) return;
  style(canvas, DARK, "|"); for (let c = 1; c < columns; c++) block(canvas, -w / 2 + c * w / columns, bottom + rows * row / 2, front + 0.005, 0.02, rows * row, 0.01);
  style(canvas, [24, 24, 26], "-"); for (let r = 0; r < rows; r++) block(canvas, 0, bottom + (r + 0.7) * row, front + 0.008, w - 0.12, 0.025, 0.01);
}

function sculpture(canvas: PropCanvas, w: number, d: number, h: number, seed: number, time: number, near: boolean, place: InteriorPlace): void {
  // A holographic corporate sculpture: a white plinth with a projector ring and a twisted column of
  // light slices turning 8 degrees a second, its glow breathing over twelve seconds.
  const plinth = Math.min(0.9, h * 0.3), holo = mixRGB(place.color, [120, 230, 255], 0.55);
  const gain = 0.62 + 0.1 * Math.sin(time * Math.PI * 2 * 0.08 + seed * 6), span = Math.max(0.6, Math.min(h, 3.4) - plinth - 0.2);
  style(canvas, [200, 206, 212], "#"); block(canvas, 0, plinth / 2, 0, w * 0.7, plinth, d * 0.7);
  style(canvas, gained(holo, 0.9), "=", true); block(canvas, 0, plinth + 0.02, 0, w * 0.5, 0.04, d * 0.5);
  // Seven slices up close; far, slices 1, 3 and 5 alone, where they stand up close (the others fade in).
  const slices = 7, size = Math.min(w, d) * 0.5;
  canvas.push(); canvas.translate(0, -(plinth + 0.15), 0); canvas.rotateY(time * 8 + seed * 360);
  for (let s = 0; s < slices; s++) {
    if (!near && s % 2 === 0) continue;
    const y = (s + 0.5) * span / slices, width = size * (0.45 + 0.55 * Math.sin(Math.PI * (s + 0.5) / slices));
    canvas.push(); canvas.translate(0, -y, 0); canvas.rotateY(s * 18);
    style(canvas, gained(holo, gain * (0.7 + 0.3 * s / slices) * (s % 2 ? 1 : detail)), s % 2 ? "+" : "=", true);
    canvas.box(width, span / slices * 0.3, width * 0.22); canvas.box(width * 0.22, span / slices * 0.3, width);
    canvas.pop();
  }
  canvas.pop();
}

function growrack(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean): void {
  // Tiers of trays, leafy green under a pink grow bar each.
  const tiers = Math.max(2, Math.min(4, Math.floor(h / 0.6))), tier = (h - 0.3) / tiers;
  style(canvas, METAL, "|");
  for (const sx of [-1, 1]) for (const sz of near ? [-1, 1] : [0]) block(canvas, sx * (w / 2 - 0.03), h / 2, sz * (d / 2 - 0.03), 0.05, h, near ? 0.05 : d);
  for (let t = 0; t < tiers; t++) {
    const y = 0.25 + t * tier;
    style(canvas, [60, 50, 40], "="); block(canvas, 0, y, 0, w, 0.08, d);
    const leaf = varied([90, 190, 100], hash01(seed * 11 + t), 0.3);
    if (near) {
      for (let k = 0; k < 3; k++) { style(canvas, leaf, k % 2 ? "&" : "*"); block(canvas, (k - 1) * w * 0.31, y + 0.12 + hash01(seed + t * 3 + k) * 0.06, 0, w * 0.29, 0.16 + hash01(seed * 2 + t + k) * 0.1, d * 0.8); }
    } else { style(canvas, leaf, "*"); block(canvas, 0, y + 0.15, 0, w * 0.92, 0.2, d * 0.8); }
    style(canvas, gained(GROW_PINK, 0.9), "=", true); block(canvas, 0, y + tier - 0.08, 0, w * 0.9, 0.03, 0.12);
  }
}

function car(canvas: PropCanvas, w: number, d: number, seed: number, near: boolean): void {
  // A parked car along its longer side: body, glasshouse, four wheels, cold headlamps, dim tail lamps,
  // and the painted bay lines either side.
  const turned = w > d, width = turned ? d : w, length = turned ? w : d;
  if (turned) canvas.rotateY(90);
  const paint = varied(pick(CARS, seed), seed), clear = 0.22, body = 0.62;
  style(canvas, [210, 200, 120], "="); for (const side of [-1, 1]) block(canvas, side * (width / 2 + 0.3), 0.012, 0, 0.08, 0.02, length * 1.05);
  style(canvas, paint, "#"); block(canvas, 0, clear + body / 2, 0, width * 0.96, body, length * 0.96);
  style(canvas, gained(paint, 0.85), "#"); block(canvas, 0, clear + body + 0.25, -length * 0.06, width * 0.84, 0.5, length * 0.48);
  style(canvas, [40, 60, 84], ":", false, SURFACE.glazing);
  for (const end of [-1, 1]) block(canvas, 0, clear + body + 0.25, -length * 0.06 + end * (length * 0.24 + 0.005), width * 0.76, 0.4, 0.01);
  for (const side of [-1, 1]) block(canvas, side * (width * 0.42 + 0.005), clear + body + 0.27, -length * 0.06, 0.01, 0.36, length * 0.42);
  style(canvas, [22, 22, 26], "O");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) disc(canvas, sx * width * 0.46, 0.3, sz * length * 0.3, 0.12, 0.3, 0.3);
  style(canvas, [230, 226, 200], "o"); for (const side of [-1, 1]) block(canvas, side * width * 0.32, clear + body * 0.6, length * 0.48 + 0.005, 0.2, 0.1, 0.02);
  style(canvas, gained([255, 40, 50], 0.35), "=", true); for (const side of [-1, 1]) block(canvas, side * width * 0.32, clear + body * 0.6, -length * 0.48 - 0.005, 0.24, 0.08, 0.02);
  if (!near) return;
  style(canvas, METAL, "o"); for (const sx of [-1, 1]) for (const sz of [-1, 1]) disc(canvas, sx * (width * 0.46 + 0.02), 0.3, sz * length * 0.3, 0.11, 0.12, 0.12);
  style(canvas, [230, 226, 210], "="); block(canvas, 0, clear + 0.2, length * 0.48 + 0.01, 0.4, 0.12, 0.01);
  style(canvas, DARK, "="); for (const end of [-1, 1]) block(canvas, 0, clear + 0.08, end * length * 0.48, width * 0.98, 0.12, 0.08);
}

function groundVending(canvas: PropCanvas, w: number, d: number, h: number, seed: number, near: boolean): void {
  const units = Math.max(1, Math.round(w / 0.9)), unit = w / units, front = d / 2;
  style(canvas, [44, 52, 62], "#"); block(canvas, 0, h / 2, 0, w, h, d);
  for (let u = 0; u < units; u++) {
    const ux = -w / 2 + (u + 0.5) * unit;
    style(canvas, (u + Math.floor(seed * 2)) % 2 ? [255, 140, 90] : [110, 210, 240], ":", true); block(canvas, ux, h * 0.62, front + 0.01, unit - 0.25, h * 0.5, 0.02);
    if (near) { style(canvas, WARM, ".", true); block(canvas, ux + unit * 0.3, h * 0.3, front + 0.015, 0.1, 0.16, 0.01); }
  }
}

function groundBench(canvas: PropCanvas, w: number, d: number, h: number, place: InteriorPlace): void {
  style(canvas, METAL, "|"); block(canvas, 0, h / 2 - 0.05, 0, w * 0.9, h - 0.1, d * 0.8);
  style(canvas, gained(place.color, 0.6), "="); block(canvas, 0, h - 0.05, 0, w, 0.12, d);
  block(canvas, 0, h + 0.4, -d / 2 + 0.08, w, 0.75, 0.14);
}

/** One plan fixture, turned to its yaw (footprint dimensions swap at a quarter turn: the footprint
 * stays the axis-aligned box collision uses) and varied by its seed. */
function groundFixture(canvas: PropCanvas, item: InteriorFixture, place: InteriorPlace, time: number, nearness: number, effects: boolean, doors = 0): void {
  // `nearness` (0..1, see `detail`): the near tier draws from its first sliver, its lit extras scaled by it.
  const near = nearness > 0;
  detail = nearness; liftDoors = doors;
  const yaw = item.yaw ?? 0, turned = Math.abs(Math.sin(yaw)) > 0.7;
  const w = turned ? item.depth : item.width, d = turned ? item.width : item.depth, h = item.height, seed = item.seed ?? 0.5;
  canvas.push(); canvas.translate(item.x, 0, item.z); if (yaw) canvas.rotateY(yaw * 180 / Math.PI);
  groundFrame = { x: item.x, z: item.z, yaw };
  switch (item.kind) {
    case "cabinet": cabinet(canvas, w, d, h, seed, time, near); break;
    case "pod": pod(canvas, w, d, h, seed, near); break;
    case "locker": locker(canvas, w, d, h, seed, near); break;
    case "rack": rack(canvas, w, d, h, seed, time, near); break;
    case "case": glassCase(canvas, w, d, h, seed, near, place); break;
    case "washer": washer(canvas, w, d, h, seed, time, near); break;
    case "lathe": lathe(canvas, w, d, h, seed, near); break;
    case "tank": tank(canvas, w, d, h, seed, time, near, effects, place); break;
    case "altar": altar(canvas, w, d, h, seed, time, near); break;
    case "cushion": {
      const color = varied(pick(CUSHIONS, seed), seed);
      style(canvas, color, "="); block(canvas, 0, Math.max(h, 0.1) / 2, 0, w, Math.max(h, 0.1), d);
      if (near) { style(canvas, gained(color, 1.3), "+"); block(canvas, 0, Math.max(h, 0.1) + 0.005, 0, 0.08, 0.01, 0.08); }
      break;
    }
    case "stall": stall(canvas, w, d, h, seed, near, place); break;
    case "crate": crate(canvas, w, d, h, seed, near); break;
    case "kitchenette": kitchenette(canvas, w, d, h, seed, time, near); break;
    case "couch": couch(canvas, w, d, h, seed, near); break;
    case "desk": desk(canvas, w, d, h, seed, near, place); break;
    case "turnstile": turnstile(canvas, w, d, seed, near); break;
    case "lift": lift(canvas, w, d, h, seed, time, near, place.stops ? place.floor ?? 1 : null); break;
    case "mailbox": mailbox(canvas, w, d, h, seed, near); break;
    case "sculpture": sculpture(canvas, w, d, h, seed, time, near, place); break;
    case "growrack": growrack(canvas, w, d, h, seed, near); break;
    case "car": car(canvas, w, d, seed, near); break;
    case "vending": groundVending(canvas, w, d, h, seed, near); break;
    case "bench": groundBench(canvas, w, d, h, place); break;
    case "gate": gateShutter(canvas, w, d, seed, time, near); break;
    default: fixture(canvas, { ...item, x: 0, z: 0, width: w, depth: d }, place, time);
  }
  groundFrame = ROOM_FRAME; detail = 1; liftDoors = 0;
  canvas.pop();
}
const ROOM_FRAME: { readonly x: number; readonly z: number; readonly yaw: number } = { x: 0, z: 0, yaw: 0 };

/** Sends the shader the eight lights nearest the visitor. Each fades by its distance short of the
 * ninth nearest, so a light leaving the set has already faded to nothing: pools never pop. */
function groundLights(canvas: PropCanvas, place: InteriorPlace, plan: GroundPlan, eye: { x: number; z: number }, fallback: RGB): void {
  const lights: readonly GroundLight[] = plan.lights.length ? plan.lights : [{ x: 0, z: 0, color: fallback }];
  const order = lights.map((light, index) => ({ index, distance: Math.hypot(light.x - eye.x, light.z - eye.z) })).sort((a, b) => a.distance - b.distance);
  const cut = order.length > GROUND_LIGHTS ? order[GROUND_LIGHTS].distance : Infinity;
  const positions: number[][] = [], colors: number[][] = [];
  for (let i = 0; i < GROUND_LIGHTS; i++) {
    const entry = order[i];
    if (!entry) { positions.push([0, 0, 0, 0]); colors.push([0, 0, 0]); continue; }
    const light = lights[entry.index], world = interiorWorld(place, light.x, light.z);
    positions.push([world.x, world.z, Math.max(0, Math.min(1, (cut - entry.distance) / 3)), 0]);
    // Saturated fittings (server blue, arcade pink) are lifted to a common luminance so their pools
    // light the room as well as the warm and white ones do; hue is kept.
    const [r, g, b] = light.color, luma = Math.max(1, 0.3 * r + 0.59 * g + 0.11 * b) / 255;
    const boost = Math.max(1, GROUND_LIGHT_LUMA / luma);
    colors.push([r / 255 * boost, g / 255 * boost, b / 255 * boost]);
  }
  canvas.setUniforms({ u_ground: 1, u_lights: positions, u_lightColors: colors });
}

/** Light colours for each kind's fittings when a plan gives none. */
const FALLBACK_LIGHT: RGB = [255, 214, 160];

// ---- Upper floors (upper-floors.ts): window walls and the city outside -------------------------------
// An upper floor's outer walls are glass between a sill and a header, split by mullions, with the lift
// core solid in the middle of the +z wall; a roof (sky bar, plant deck) has a parapet and no ceiling.
// Outside, the real city stands scaled toward the eye (upperBackdrop): one box per tower, its lit
// window grid drawn and prefiltered by the interior material (surface 16), steady rooftop signs and
// aircraft lamps, bands of city glow at the horizon (surface 17). Nothing outside moves; rain on the
// glass is still, its sheen breathing at 0.1 Hz.

const UPPER_THEMES: Readonly<Record<UpperVariant, GroundTheme>> = {
  apartments: { floor: SURFACE.planks, wall: SURFACE.plaster, floorColor: [110, 90, 72], wallColor: [132, 124, 114], ceiling: [26, 24, 24], trim: [96, 82, 68], fitting: "pendant", motes: null },
  offices: { floor: SURFACE.polished, wall: SURFACE.panel, floorColor: [112, 118, 128], wallColor: [118, 128, 140], ceiling: [24, 28, 36], trim: [150, 160, 172], fitting: "tube", motes: null },
  pods: GROUND_THEMES["capsule-hotel"],
  servers: GROUND_THEMES["server-hall"],
  penthouse: { floor: SURFACE.polished, wall: SURFACE.plaster, floorColor: [128, 118, 108], wallColor: [140, 130, 120], ceiling: [22, 20, 22], trim: [170, 136, 76], fitting: "ring", motes: null },
  "sky-bar": { floor: SURFACE.planks, wall: SURFACE.block, floorColor: [96, 80, 66], wallColor: [84, 80, 78], ceiling: [20, 20, 24], trim: [200, 150, 80], fitting: "lantern", motes: null },
  "plant-deck": { floor: SURFACE.grating, wall: SURFACE.block, floorColor: [84, 88, 92], wallColor: [84, 80, 78], ceiling: [20, 20, 24], trim: [220, 180, 50], fitting: "cage", motes: null },
};
/** Window wall: sill and head heights (m; the head clears a walking eye), mullion pitch, roof parapet. */
const UPPER_SILL = 0.9;
const UPPER_HEAD = 3.9;
const UPPER_MULLION = 1.6;
const UPPER_PARAPET = 1.1;
/** Half-width (m) of the solid lift core in the +z wall (a roof's lift hut is narrower). */
const UPPER_CORE = 2.6;
const ROOF_HUT = 1.6;
/** Rain on the glass: drawn within this range (m) of the eye, where a streak is wider than a cell. */
const RAIN_RANGE = 5.5;
const RAIN: RGB = [150, 176, 214];
const UPPER_EYE = 2.7;
/** City glow bands round the horizon: an octagon this far out (m), behind every scaled tower. */
const HAZE_RING = 47;
/** Bands (degrees above the eye, from..to, glow gain): brightest just over the horizon, fading up into
 * the night and down into the street haze. Each band is added over SKY_NIGHT. */
const HAZE_BANDS: readonly (readonly [number, number, number])[] = [
  [-16, -7, 0.05], [-7, -3, 0.09], [-3, -1, 0.14], [-1, 1.5, 0.2], [1.5, 4, 0.13], [4, 9, 0.075], [9, 16, 0.04], [16, 26, 0.02], [26, 40, 0.008],
];
const SKY_NIGHT: RGB = [6, 8, 15];
/** The streets far below (m under the eye, under the clipped tower bases), avenue pitch and width (m). */
const STREET_DEPTH = 42;
const STREET_PITCH = 11;
const STREET_WIDTH = 1.6;
/** Lowest and highest eye height (m) a visitor reaches indoors (crouch .. top of a jump), for culling. */
const CULL_EYE_LOW = 1.6;
const CULL_EYE_HIGH = 4.6;
/** Neon trims round the crowns of some towers outside. */
const SKYLINE_NEON: readonly RGB[] = [[255, 70, 160], [70, 220, 255], [170, 110, 255], [255, 170, 60], [90, 255, 190]];

/** One box along a wall: `alongX` walls run along x at z = `at` (else along z at x = `at`). */
function wallPiece(canvas: PropCanvas, alongX: boolean, at: number, u: number, y: number, length: number, tall: number, thick: number): void {
  if (alongX) block(canvas, u, y, at, length, tall, thick);
  else block(canvas, at, y, u, thick, tall, length);
}

function windowShell(canvas: PropCanvas, place: InteriorPlace, theme: GroundTheme, roof: boolean, eye: { x: number; z: number }, time: number, rain: boolean): void {
  const hw = place.width / 2, hd = place.depth / 2, core = roof ? ROOF_HUT : UPPER_CORE, thick = 0.35;
  const runs: readonly (readonly [boolean, number, number, number])[] = [
    [true, -hd, -hw, hw], [false, -hw, -hd, hd], [false, hw, -hd, hd], [true, hd, -hw, -core], [true, hd, core, hw],
  ];
  // Window frames: a cool anodised grey, lighter than the walls and far brighter than the dark city,
  // so every bay reads as an opening in the wall with the view standing well behind it.
  const sill = roof ? UPPER_PARAPET : UPPER_SILL, frame: RGB = [84, 92, 106];
  for (const [alongX, at, a, b] of runs) {
    const length = b - a, mid = (a + b) / 2, inward = at < 0 ? 1 : -1;
    if (length < 0.05) continue;
    style(canvas, theme.wallColor, ".", false, theme.wall);
    wallPiece(canvas, alongX, at, mid, sill / 2, length, sill, thick);
    if (!roof) wallPiece(canvas, alongX, at, mid, (UPPER_HEAD + INTERIOR_HEIGHT) / 2, length, INTERIOR_HEIGHT - UPPER_HEAD, thick);
    style(canvas, roof ? gained(theme.trim, 0.7) : frame, "=");
    wallPiece(canvas, alongX, at, mid, sill + 0.05, length, 0.1, thick + 0.12);
    if (roof) continue;
    // A pale sill board standing proud into the room under every bay, and a dark soffit over it.
    style(canvas, mixRGB(theme.trim, [200, 204, 210], 0.35), "=");
    wallPiece(canvas, alongX, at + inward * (thick / 2 + 0.14), mid, UPPER_SILL + 0.03, length, 0.06, 0.28);
    style(canvas, gained(theme.ceiling, 1.4), "-");
    wallPiece(canvas, alongX, at + inward * (thick / 2 + 0.08), mid, UPPER_HEAD + 0.06, length, 0.12, 0.16);
    const panels = Math.max(1, Math.round(length / UPPER_MULLION)), pitch = length / panels;
    style(canvas, frame, "|");
    // Mullions and the head rail stay about a cell wide even across the room (no thin lines to shimmer);
    // deep enough that their sides show at an angle, so a bay is framed even seen edge-on.
    for (let k = 0; k <= panels; k++) wallPiece(canvas, alongX, at, a + k * pitch, (UPPER_SILL + UPPER_HEAD) / 2, 0.2, UPPER_HEAD - UPPER_SILL, 0.36);
    wallPiece(canvas, alongX, at, mid, UPPER_HEAD - 0.08, length, 0.16, 0.36);
    if (!rain) continue;
    // Still rain trails on the nearest panes, fading out with distance before they could shrink below a cell.
    for (let k = 0; k < panels; k++) {
      const u = a + (k + 0.5) * pitch, distance = alongX ? Math.hypot(u - eye.x, at - eye.z) : Math.hypot(at - eye.x, u - eye.z);
      if (distance > RAIN_RANGE) continue;
      for (let j = 0; j < 3; j++) {
        const seed = hash01(k * 3.17 + j * 7.73 + at * 0.37 + (alongX ? 1.3 : 2.9)), long = 0.3 + hash01(seed * 11.1) * 0.9;
        const top = UPPER_SILL + 0.6 + hash01(seed * 5.3) * (UPPER_HEAD - UPPER_SILL - 0.9);
        const gain = (1 - distance / RAIN_RANGE) * (0.3 + 0.08 * Math.sin(time * 0.6 + seed * 6.28));
        style(canvas, gained(RAIN, gain), "|", true);
        wallPiece(canvas, alongX, at, a + k * pitch + (0.15 + 0.7 * seed) * pitch, top - long / 2, 0.07, long, 0.03);
      }
    }
  }
  style(canvas, theme.wallColor, ".", false, theme.wall);
  if (!roof) {
    // The lift core and the floor's name over the lift, read on turning round from the glass.
    block(canvas, 0, INTERIOR_HEIGHT / 2, hd, 2 * core, INTERIOR_HEIGHT, thick);
    groundSign(canvas, floorTitle(place).toUpperCase(), 0, 4.45, hd - thick / 2 - 0.065, 0.11, 180, gained(place.color, 1.1));
    return;
  }
  // The roof's lift hut: cheeks either side of the doors, a lintel with ROOF on it, a flat top.
  for (const side of [-1, 1]) block(canvas, side * 1.3, 1.75, hd - 0.45, 0.6, 3.5, 0.9);
  block(canvas, 0, 3.3, hd - 0.45, 2.0, 0.5, 0.9);
  style(canvas, gained(theme.trim, 0.6), "="); block(canvas, 0, 3.58, hd - 0.45, 3.3, 0.16, 1.0);
  groundSign(canvas, floorTitle(place).toUpperCase(), 0, 3.3, hd - 0.92, 0.08, 180, gained(place.color, 1.1));
}

/** A roof's string of steady bulbs across the deck at a plan light, wall to wall. */
function roofBulbs(canvas: PropCanvas, z: number, color: RGB, halfWidth: number): void {
  style(canvas, mixRGB(color, WARM, 0.5), "o", true);
  for (let bx = -halfWidth + 0.8; bx <= halfWidth - 0.8; bx += 1.2) block(canvas, bx, 3.2 - 0.25 * Math.cos((bx / halfWidth) * Math.PI / 2), z, 0.2, 0.2, 0.2);
}

/** The city outside (surfaces 16 and 17 carry their own colour: nothing in the room lights them). */
function backdropPaint(canvas: PropCanvas, color: RGB, surface: Surface, pitch = 0): void {
  canvas.char(".");
  canvas.charColor(color[0] * fade, color[1] * fade, color[2] * fade);
  canvas.cellColor(Math.round(Math.max(0, Math.min(1, pitch / 4)) * 255), 0, surface, 0);
}

function drawBackdrop(canvas: PropCanvas, place: InteriorPlace, eye: { x: number; z: number }, behind: (x: number, z: number, radius: number) => boolean, low: boolean, roof: boolean): void {
  const view = upperBackdrop(place);
  if (!view) return;
  canvas.setUniforms({ u_haze: [view.haze[0] / 255, view.haze[1] / 255, view.haze[2] / 255] });
  // Sky: a district-tinted glow at the horizon fading up into a dark night (and down into the streets'
  // haze), as fixed bands on an octagon far outside every window; an overcast lid over a roof.
  const span = 2 * HAZE_RING * Math.tan(Math.PI / 8) + 0.6, tint = mixRGB([255, 150, 110], view.haze, 0.5);
  for (let side = 0; side < 8; side++) {
    const angle = side * Math.PI / 4, x = Math.sin(angle) * HAZE_RING, z = -Math.cos(angle) * HAZE_RING;
    if (behind(x, z, span / 2)) continue;
    canvas.push(); canvas.translate(x, 0, z); canvas.rotateY(-side * 45);
    for (const [from, to, gain] of HAZE_BANDS) {
      const y0 = UPPER_EYE + HAZE_RING * Math.tan(from * Math.PI / 180), y1 = UPPER_EYE + HAZE_RING * Math.tan(to * Math.PI / 180);
      backdropPaint(canvas, [tint[0] * gain + SKY_NIGHT[0], tint[1] * gain + SKY_NIGHT[1], tint[2] * gain + SKY_NIGHT[2]], SURFACE.haze);
      block(canvas, 0, (y0 + y1) / 2, 0, span, y1 - y0, 0.4);
    }
    canvas.pop();
  }
  if (roof) { backdropPaint(canvas, mixRGB([30, 26, 40], view.haze, 0.12), SURFACE.haze); block(canvas, 0, UPPER_EYE + 24, 0, 70, 0.4, 70); }
  // Far below, under the clipped tower bases: the streets (a looking-down view is never a void). A dim
  // ground glow crossed by a fixed grid of sodium-lit avenues, each wide enough (>= 2 cells from the
  // window) to hold still as the view turns.
  const ground = UPPER_EYE - STREET_DEPTH;
  backdropPaint(canvas, [tint[0] * 0.05 + 8, tint[1] * 0.05 + 10, tint[2] * 0.05 + 16], SURFACE.haze); block(canvas, 0, ground - 0.2, 0, 84, 0.4, 84);
  if (!low) {
    backdropPaint(canvas, gained(mixRGB([255, 170, 90], tint, 0.3), 0.32), SURFACE.haze);
    for (let k = -3; k <= 3; k++) {
      const at = k * STREET_PITCH + STREET_PITCH * 0.37;
      block(canvas, at, ground + 0.05, 0, STREET_WIDTH, 0.1, 84);
      block(canvas, 0, ground + 0.05, at, 84, 0.1, STREET_WIDTH);
    }
  }
  // Nothing outside can be seen above the window head or below the sill except at the angle those make
  // from the nearest glass: pieces wholly beyond that cone are skipped (no draw, and never a pop, since
  // they could not have shown). Tested at the lowest and highest eye a visitor reaches (crouch, jump):
  // the tests are linear in eye height, so their ends bound every height between. A roof has open sky.
  const toGlass = Math.max(0.3, Math.min(place.width / 2 - Math.abs(eye.x), place.depth / 2 - Math.abs(eye.z)));
  const sill = roof ? UPPER_PARAPET : UPPER_SILL;
  const hidden = (x: number, y: number, z: number, w: number, h: number, d: number): boolean => {
    const reach = Math.max(toGlass, Math.hypot(x - eye.x, z - eye.z) - Math.hypot(w, d) / 2);
    const over = !roof && (y - h / 2 - CULL_EYE_LOW) / reach > (UPPER_HEAD - CULL_EYE_LOW) / toGlass;
    const under = (y + h / 2 - CULL_EYE_HIGH) / reach < -(CULL_EYE_HIGH - sill) / toGlass;
    return over || under;
  };
  const towers = low ? view.towers.slice(0, 70) : view.towers;
  for (const [index, tower] of towers.entries()) {
    if (behind(tower.x, tower.z, Math.max(tower.w, tower.d) * 0.71) || hidden(tower.x, tower.y, tower.z, tower.w, tower.h, tower.d)) continue;
    backdropPaint(canvas, tower.color, SURFACE.skyline, tower.pitch);
    block(canvas, tower.x, tower.y, tower.z, tower.w, tower.h, tower.d);
    // A neon trim round the crown of about one tower in four (steady; none where the top is cut off).
    const top = tower.y + tower.h / 2, seed = hash01(index * 3.71 + tower.x * 0.13 + tower.z * 0.07);
    if (low || seed > 0.26 || top > UPPER_EYE + 40 || tower.h < 2) continue;
    const level = Math.min(1, Math.max(tower.color[0], tower.color[1], tower.color[2]) / 200);
    style(canvas, gained(pick(SKYLINE_NEON, hash01(seed * 17.9)), 0.4 + 0.5 * level), "=", true);
    // About two cells tall at any distance (a fixed size per tower, measured from the room centre).
    const band = Math.min(tower.h, 0.022 * Math.hypot(tower.x, tower.z));
    block(canvas, tower.x, top - band * 0.6, tower.z, tower.w + 0.04, band, tower.d + 0.04);
  }
  for (const glow of view.glows) {
    if (behind(glow.x, glow.z, Math.max(glow.w, glow.d) * 0.71) || hidden(glow.x, glow.y, glow.z, glow.w, glow.h, glow.d)) continue;
    style(canvas, glow.color, "=", true);
    block(canvas, glow.x, glow.y, glow.z, glow.w, glow.h, glow.d);
  }
}

function drawGroundFloor(canvas: PropCanvas, place: InteriorPlace, fixtures: readonly InteriorFixture[], time: number, low: boolean, effects: boolean, viewer: { x: number; z: number } | null): void {
  if (!isGroundFloorKind(place.kind)) return;
  // Upper floors (upper-floors.ts): their own finishes, window walls, the lift core, the city outside.
  const variant = upperVariant(place), upper = place.floor !== undefined, roof = upperOpenAir(place);
  const theme = variant ? UPPER_THEMES[variant] : GROUND_THEMES[place.kind], plan = planOf(place);
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  const eye = viewer ? interiorLocal(place, viewer.x, viewer.z) : { x: 0, z: halfDepth - 2.2 };
  groundLights(canvas, place, plan, eye, FALLBACK_LIGHT);
  // The visitor's facing in room space, to skip whatever is wholly behind them (only when the
  // viewer is the room's occupant, whose yaw we know; the camera never sees behind itself).
  const occupant = interiorOccupant(fixtures);
  let forward: { x: number; z: number } | null = null;
  if (occupant && viewer && occupant.x === viewer.x && occupant.z === viewer.z) {
    const fx = Math.sin(occupant.yaw), fz = -Math.cos(occupant.yaw), c = Math.cos(place.yaw), s = Math.sin(place.yaw);
    forward = { x: c * fx - s * fz, z: s * fx + c * fz };
  }
  const behind = (x: number, z: number, radius: number) => !!forward && (x - eye.x) * forward.x + (z - eye.z) * forward.z < -(radius + 1.2);
  // Near tier: 0 beyond GROUND_DETAIL_RANGE, easing to 1 over the 2 m inside it (lit extras fade by it).
  const nearness = (x: number, z: number) => low ? 0 : smooth01((GROUND_DETAIL_RANGE - Math.hypot(x - eye.x, z - eye.z)) / 2);
  const close = (x: number, z: number) => nearness(x, z) > 0;
  const arrival = viewer ? liftArrival(fixtures, eye) : null;

  canvas.push(); canvas.translate(place.x, 0, place.z); canvas.rotateY(place.yaw * 180 / Math.PI);
  // Shell: floor, outer walls, the dark ceiling, pilasters and the district's neon skirting strip.
  style(canvas, theme.floorColor, ".", false, theme.floor); block(canvas, 0, -0.15, 0, place.width, 0.3, place.depth);
  groundEye = eye; groundFrame = ROOM_FRAME;
  if (upper) windowShell(canvas, place, theme, roof, eye, time, effects && !low);
  else {
    style(canvas, theme.wallColor, ".", false, theme.wall);
    for (const side of [-1, 1]) {
      block(canvas, side * halfWidth, INTERIOR_HEIGHT / 2, 0, 0.35, INTERIOR_HEIGHT, place.depth);
      block(canvas, 0, INTERIOR_HEIGHT / 2, side * halfDepth, place.width, INTERIOR_HEIGHT, 0.35);
    }
  }
  if (!roof) { style(canvas, theme.ceiling, "-"); block(canvas, 0, INTERIOR_HEIGHT + 0.1, 0, place.width, 0.2, place.depth); }
  style(canvas, gained(theme.trim, 0.8), "|");
  const bays = Math.max(1, Math.round(place.depth / 4.5));
  if (!roof) for (const side of [-1, 1]) for (let k = 1; k < bays; k++) block(canvas, side * (halfWidth - 0.22), INTERIOR_HEIGHT / 2, -halfDepth + k * place.depth / bays, 0.14, INTERIOR_HEIGHT, 0.16);
  style(canvas, gained(place.color, 0.8), "=", true);
  for (const side of [-1, 1]) block(canvas, side * (halfWidth - 0.3), 0.25, 0, 0.08, 0.12, place.depth - 0.6);
  // Wall structure on the side and back walls: a dado rail, a dark cornice band under the ceiling
  // and, for the neon kinds, a lit line under the cornice.
  const inner = 0.175, cornice = CORNICE[place.kind];
  if (!upper) { // upper floors: glass from the sill up, no dado rail across the view
    style(canvas, theme.trim, "=");
    for (const side of [-1, 1]) block(canvas, side * (halfWidth - inner - 0.04), WALL_DADO, 0, 0.08, 0.12, place.depth - 0.4);
    block(canvas, 0, WALL_DADO, -halfDepth + inner + 0.04, place.width - 0.4, 0.12, 0.08);
  }
  if (!roof) {
    style(canvas, gained(theme.trim, 0.45), "=");
    for (const side of [-1, 1]) block(canvas, side * (halfWidth - inner - 0.06), INTERIOR_HEIGHT - 0.2, 0, 0.12, 0.3, place.depth - 0.3);
    block(canvas, 0, INTERIOR_HEIGHT - 0.2, -halfDepth + inner + 0.06, place.width - 0.3, 0.3, 0.12);
  }
  if (cornice && !roof) {
    style(canvas, gained(cornice, 0.7), "=", true);
    for (const side of [-1, 1]) block(canvas, side * (halfWidth - inner - 0.05), INTERIOR_HEIGHT - 0.43, 0, 0.06, 0.12, place.depth - 0.4);
    block(canvas, 0, INTERIOR_HEIGHT - 0.43, -halfDepth + inner + 0.05, place.width - 0.4, 0.12, 0.06);
  }
  // The building's name on the back wall (corporate lobbies make a show of it): the brand word alone
  // when the full name would be too small to read, faded in as the visitor comes close enough.
  const sign = place.sign && !upper ? fitSign(place.sign, Math.min(place.width * 0.45, 7), /* seen whole from the door, clear of side-room walls */ place.kind === "corp-lobby" ? BACK_SIGN_PIXEL * 1.2 : BACK_SIGN_PIXEL, BACK_SIGN_PIXEL * 0.6) : null;
  const signWords = place.sign.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (sign && sign.text.split(" ").length < signWords.length && signWords.length === 2) {
    // A two-word name too long for one line: stack it (brand above, trade below) rather than drop a word.
    const maxWidth = Math.min(place.width * 0.45, 7), longest = Math.max(...signWords.map(word => word.length));
    const pixel = Math.min(BACK_SIGN_PIXEL, 0.16 /* two rows fit under the ceiling */, maxWidth / (4 * longest - 1)), row = 7 * pixel;
    signWords.forEach((word, line) => groundSign(canvas, word, 0, 4.3 + (0.5 - line) * row, -halfDepth + inner + 0.065, pixel, 0, gained(place.color, 1.1)));
  } else if (sign) groundSign(canvas, sign.text, 0, 4.3, -halfDepth + inner + 0.065, sign.pixel, 0, gained(place.color, 1.1));
  // Wall dressing, one piece per bay (never on `low`): its frame at any distance, its detail within range.
  const walls = fixtures.filter(item => item.kind === "wall"), decorSet = DECOR[place.kind];
  const decorAt = (x: number, z: number, yaw: number, seed: number, onBack: boolean): void => {
    if (low || upper || behind(x, z, 1)) return; // upper floors: glass walls, nothing hung on them
    if (walls.some(item => Math.abs(item.x - x) < item.width / 2 + 0.95 && Math.abs(item.z - z) < item.depth / 2 + 0.95)) return;
    const decor = pick(decorSet, seed);
    if (onBack && decor === "vent") return; // the name board hangs there
    canvas.push(); canvas.translate(x, 0, z); canvas.rotateY(yaw);
    wallDecor(canvas, decor, hash01(seed * 17.3), theme, place, close(x, z));
    canvas.pop();
  };
  const salt = place.x * 0.0137 + place.z * 0.0071;
  for (const side of [-1, 1]) for (let k = 0; k < bays; k++) {
    decorAt(side * (halfWidth - inner), -halfDepth + (k + 0.5) * place.depth / bays, side < 0 ? 90 : -90, hash01(k * 7.13 + side * 3.1 + salt), false);
  }
  const backBays = Math.max(1, Math.round(place.width / 4.5));
  for (let k = 0; k < backBays; k++) decorAt(-halfWidth + (k + 0.5) * place.width / backBays, -halfDepth + inner, 0, hash01(k * 5.71 + 11.3 + salt), true);
  if (!upper) {
    style(canvas, [38, 77, 87], "="); block(canvas, 0, 2.1, halfDepth - 0.24, 2.8, 4.2, 0.12);
    groundSign(canvas, "EXIT", 0, 4.65, halfDepth - 0.36, EXIT_SIGN_PIXEL, 180, WARM);
    style(canvas, WARM, "=", true);
    for (const side of [-1, 1]) block(canvas, side * 1.5, 2.2, halfDepth - 0.3, 0.12, 4.4, 0.14);
  }
  // Interior walls, their doorways, then the furniture.
  for (const item of fixtures) {
    if (item.kind !== "wall" || behind(item.x, item.z, Math.max(item.width, item.depth) / 2)) continue;
    groundWall(canvas, item, theme);
  }
  for (const door of doorways(place, fixtures, plan)) {
    if (behind(door.x, door.z, door.gap)) continue;
    groundDoorway(canvas, door, theme, close(door.x, door.z), low);
  }
  for (const item of fixtures) {
    if (item.kind === "wall" || behind(item.x, item.z, Math.hypot(item.width, item.depth) / 2 + item.height * 0.5)) continue;
    groundFixture(canvas, item, place, time, nearness(item.x, item.z), effects, arrival?.lift === item ? arrival.open : 0);
  }
  // Ceiling fittings at the plan's lights.
  const lights: readonly GroundLight[] = plan.lights.length ? plan.lights : [{ x: 0, z: 0, color: FALLBACK_LIGHT }];
  for (const [index, light] of lights.entries()) {
    if (behind(light.x, light.z, 1.5)) continue;
    if (roof) { roofBulbs(canvas, light.z, light.color, halfWidth); continue; } // open sky: a string of bulbs, no fitting
    groundFitting(canvas, theme.fitting, light.x, light.z, light.color, time, hash01(index + 0.5), close(light.x, light.z));
  }
  // Slow motes over the nearest few fixtures of the kind's own (incense, steam, spores, dust).
  if (effects && theme.motes) {
    const { color, over, hz, glyph } = theme.motes, perAnchor = low ? 2 : 5;
    // Each anchor's motes are phased by its own seed (not its distance rank, which swaps as the visitor
    // walks), fade in over the 2 m inside the 12 m reach, and the fourth-nearest's gain is what the
    // nearest three fade against, so an anchor leaving the set has already faded out. Gain is zero at
    // the phase wrap: a mote never jumps from the top back to the bottom while lit.
    const ranked = fixtures.filter(item => item.kind === over).map(item => ({ item, distance: Math.hypot(item.x - eye.x, item.z - eye.z) }))
      .filter(entry => entry.distance < 12).sort((a, b) => a.distance - b.distance);
    const cut = ranked.length > 3 ? ranked[3].distance : 12;
    for (const { item, distance } of ranked.slice(0, 3)) for (let k = 0; k < perAnchor; k++) {
      const a = (item.seed ?? hash01(item.x * 1.37 + item.z * 0.71)) * 7.3;
      const reach = smooth01((12 - distance) / 2) * smooth01((cut - distance) / 1.5);
      const phase = ((time * hz + k * 0.618 + a * 0.29) % 1 + 1) % 1, drift = Math.sin(time * 0.3 + k * 2.4 + a);
      const gain = Math.sin(phase * Math.PI) * 0.51 * reach;
      if (gain < 0.004) continue;
      style(canvas, gained(color, gain), glyph, true);
      block(canvas, item.x + drift * item.width * 0.3, item.height + 0.25 + phase * 2.2, item.z + Math.cos(k * 1.7 + time * 0.12) * item.depth * 0.3, 0.12 + phase * 0.2, 0.12, 0.08);
    }
  }
  if (upper) drawBackdrop(canvas, place, eye, behind, low, roof);
  else if (halfWidth >= 3.7) frontWindows(canvas, place, time, low);
  else { style(canvas, WARM, "=", true); block(canvas, 0, 0.012, halfDepth - 0.45, 2.6, 0.02, 0.3); } // too narrow for windows: just the lit threshold
  drawResidents(canvas, place, time, viewer);
  canvas.pop();
}

export function drawInterior(canvas: PropCanvas, place: InteriorPlace, fixtures: readonly InteriorFixture[], time: number, low: boolean, effects = true, work: InteriorWorkState | null = null, viewer: { x: number; z: number } | null = interiorOccupant(fixtures)): void {
  fade = viewer && effects ? arrivalFade(fixtures) : 1;
  if (isGroundFloorKind(place.kind)) { drawGroundFloor(canvas, place, fixtures, time, low, effects, viewer); fade = 1; drawInteriorWork(canvas, place, fixtures, work, low); return; }
  canvas.setUniforms({ u_ground: 0 }); // the ground-floor light pools stay off in venues and secrets
  if (isSecretKind(place.kind)) { drawSecretRoom(canvas, place, fixtures, time, low, effects, viewer); fade = 1; return; } // Secrets: hidden rooms
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  canvas.push(); canvas.translate(place.x, 0, place.z); canvas.rotateY(place.yaw * 180 / Math.PI);
  const finish = finishes(place.kind);
  style(canvas, finish.floorColor, ".", false, finish.floor); block(canvas, 0, -0.15, 0, place.width, 0.3, place.depth);
  style(canvas, finish.wallColor ?? WALL, ":", false, finish.wall);
  for (const side of [-1, 1]) {
    block(canvas, side * halfWidth, INTERIOR_HEIGHT / 2, 0, 0.35, INTERIOR_HEIGHT, place.depth);
    block(canvas, 0, INTERIOR_HEIGHT / 2, side * halfDepth, place.width, INTERIOR_HEIGHT, 0.35);
  }
  style(canvas, [41, 52, 66], "-"); block(canvas, 0, INTERIOR_HEIGHT + 0.1, 0, place.width, 0.2, place.depth);
  style(canvas, METAL, "|");
  for (const side of [-1, 1]) for (let panel = -1; panel <= 1; panel++) block(canvas, side * (halfWidth - 0.22), 2.6, panel * place.depth * 0.3, 0.14, 5.2, 0.16);
  style(canvas, place.color, "=", true);
  for (const side of [-1, 1]) {
    block(canvas, side * (halfWidth - 0.3), 0.25, 0, 0.08, 0.12, place.depth - 0.6);
    block(canvas, side * 2.9, 5.5, 0, 0.3, 0.12, place.depth * 0.58);
  }
  style(canvas, DARK, " "); block(canvas, 0, 3.85, -halfDepth + 0.22, place.width * 0.78, 1.6, 0.12);
  style(canvas, place.color, "=", true);
  lettering(canvas, place.sign, 0, 3.85, -halfDepth + 0.3, Math.min(0.62, place.width * 0.64 / place.sign.length));
  style(canvas, [38, 77, 87], "="); block(canvas, 0, 2.1, halfDepth - 0.24, 2.8, 4.2, 0.12);
  style(canvas, WARM, "=", true);
  lettering(canvas, "EXIT", 0, 4.65, halfDepth - 0.34, 0.44, 180);
  for (const side of [-1, 1]) block(canvas, side * 1.5, 2.2, halfDepth - 0.3, 0.12, 4.4, 0.14);
  for (const item of fixtures) fixture(canvas, item, place, time);
  furnish(canvas, place, time, low, effects);

  drawResidents(canvas, place, time, viewer);
  const dancers = interiorDancers(place);
  for (const person of low ? dancers.slice(0, 7) : dancers) dancer(canvas, person, time);
  if (place.kind === "listening-bar") {
    for (let bar = 0; bar < 9; bar++) {
      const height = 0.3 + (Math.sin(time * 1.3 + bar * 0.7) + 1) * 0.32;
      style(canvas, place.color, "=", true); block(canvas, (bar - 4) * 0.5, 2.1 + height / 2, -halfDepth + 0.3, 0.28, height, 0.05);
    }
  }
  if (effects) {
    const count = low ? 6 : 18;
    const stove = fixtures.find(item => item.kind === "stove");
    const steam = place.kind === "teahouse" || place.kind === "workshop" || !!stove;
    for (let particle = 0; particle < count; particle++) {
      const phase = ((time * (steam ? 0.17 : 0.06) + particle * 0.618) % 1 + 1) % 1;
      const drift = Math.sin(time * 0.3 + particle * 2.4);
      // Steam over the stock pots, else over the counter; drifting motes elsewhere.
      const x = stove ? stove.x + drift * 0.2 : steam ? drift * 0.45 + (particle % 2 ? -1 : 1) * place.width * 0.16 : drift * (halfWidth - 1);
      const z = stove ? stove.z + STOVE_POTS[particle % STOVE_POTS.length] * stove.depth + drift * 0.1 : steam ? -halfDepth + 3.5 : Math.cos(particle * 1.7 + time * 0.12) * (halfDepth - 1.2);
      const tint = steam ? WARM : place.color;
      const gain = Math.sin(phase * Math.PI) * 0.6 + 0.12;
      style(canvas, [tint[0] * gain, tint[1] * gain, tint[2] * gain], steam ? ":" : ".", true);
      block(canvas, x, 1.8 + phase * 2.9, z, steam ? 0.18 + phase * 0.3 : 0.09, 0.15, 0.08);
    }
  }
  canvas.pop();
  fade = 1;
  drawInteriorWork(canvas, place, fixtures, work, low);
}

function workFixture(fixtures: readonly InteriorFixture[], target: InteriorWorkTag["fixture"]): InteriorFixture | null {
  for (const item of fixtures) {
    if (target === "counter" && item.kind === "counter") return item;
    if (target === "left-planter" && item.kind === "planter" && item.x < 0) return item;
    if (target === "right-planter" && item.kind === "planter" && item.x > 0) return item;
    if (target === "right-machine" && item.kind === "machine" && item.x > 0) return item;
    if (target === "decks" && item.kind === "decks") return item;
  }
  return null;
}

function workPanel(canvas: PropCanvas, x: number, height: number, z: number, width: number, tall: number): void {
  canvas.translate(x, -height, z); canvas.rect(width, tall); canvas.translate(-x, height, -z);
}

export function drawInteriorWork(canvas: PropCanvas, place: InteriorPlace, fixtures: readonly InteriorFixture[], work: InteriorWorkState | null, low: boolean): void {
  if (!work || work.place !== place.id) return;
  canvas.push(); canvas.translate(place.x, 0, place.z); canvas.rotateY(place.yaw * 180 / Math.PI);
  for (const mark of work.tags) {
    const item = workFixture(fixtures, mark.fixture);
    if (!item) continue;
    const text = low ? mark.compact : mark.text, size = item.kind === "machine" || mark.detail ? 0.12 : 0.14;
    const width = Math.max(0.75, (text.length + (mark.detail ? mark.detail.length + 0.5 : 0)) * size + 0.24);
    const bottom = item.kind === "machine" ? 2.91 : 2.73, tall = item.kind === "machine" ? 0.24 : 0.28;
    const height = bottom + tall / 2, front = item.z + item.depth / 2;
    const horizontal = item.x + (mark.fixture === "left-planter" ? 0.65 : 0);
    style(canvas, METAL, "|"); workPanel(canvas, horizontal, (item.height + bottom) / 2, front - 0.18, 0.07, bottom - item.height);
    style(canvas, DARK, " "); workPanel(canvas, horizontal, height, front - 0.06, width, tall);
    style(canvas, mark.settled ? SETTLED : WARM, "=", true);
    lettering(canvas, text, horizontal - (mark.detail ? (mark.detail.length + 0.5) * size / 2 : 0), height, front - 0.025, size);
    if (mark.detail) lettering(canvas, mark.detail, horizontal + (text.length + 0.5) * size / 2, height, front - 0.025, size);
    if (!low) {
      style(canvas, mark.settled ? SETTLED : WARM, "=", true);
      workPanel(canvas, horizontal, bottom + 0.0075, front - 0.025, width - 0.16, 0.015);
    }
  }
  canvas.pop();
}

export function drawInteriorEntrances(canvas: PropCanvas, places: readonly InteriorPlace[], eye: { x: number; z: number }, visible: (x: number, y: number, z: number, radius?: number) => boolean): void {
  for (const place of places) {
    const { entrance } = place;
    if (Math.hypot(eye.x - entrance.x, eye.z - entrance.z) > 100 || !visible(entrance.x, 3, entrance.z, 2)) continue;
    canvas.push(); canvas.translate(entrance.x, 0, entrance.z); canvas.rotateY(place.yaw * 180 / Math.PI);
    style(canvas, [255, 206, 138], "|");
    for (const side of [-1, 1]) block(canvas, side * 1.2, 2.0, -0.65, 0.14, 3.7, 0.16);
    block(canvas, 0, 3.87, -0.65, 2.5, 0.14, 0.16);
    style(canvas, [16, 25, 32], " "); block(canvas, 0, 3.0, -0.55, 2.1, 0.95, 0.12);
    style(canvas, place.color, "="); lettering(canvas, "OPEN", 0, 3, -0.47, 0.4, 0, true);
    canvas.pop();
  }
}

export function drawInteriorInteractables(canvas: PropCanvas, place: InteriorPlace, items: readonly InteractableDefinition[]): void {
  canvas.push(); canvas.translate(place.x, 0, place.z); canvas.rotateY(place.yaw * 180 / Math.PI);
  for (const item of items) {
    const local = interiorLocal(place, item.x, item.z), height = item.y ?? 2.4;
    const glyph = item.glyph ?? "", glyphIndex = (glyph.charCodeAt(0) - 32) * 2;
    const supported = glyph.length === 1 && glyphIndex >= 0 && glyphIndex < LETTERS.length && (LETTERS[glyphIndex] | (LETTERS[glyphIndex + 1] << 8)) !== 0;
    style(canvas, DARK, " "); block(canvas, local.x, height, local.z, 1.65, 0.95, 0.15);
    style(canvas, WARM, ">", true);
    lettering(canvas, supported && glyph !== ">" ? glyph : "USE", local.x, height + 0.06, local.z + 0.09, 0.31);
    block(canvas, local.x, height - 0.36, local.z + 0.09, 1.3, 0.04, 0.04);
  }
  canvas.pop();
}

// ---- Secrets: the hidden rooms (secrets.ts) --------------------------------------------------------
// Each room draws its own shell (a carriage is low and narrow, the roof has no ceiling). The arrival
// fade applies as in every venue; every motion is slow (secrets.ts SECRET_MOTION); nothing flashes.

const SKY: RGB = [16, 28, 56];
const glowOf = (color: RGB, gain: number): RGB => [color[0] * gain, color[1] * gain, color[2] * gain];
const CAPTURE_INKS: readonly RGB[] = [[255, 143, 77], [255, 71, 148], [133, 155, 255], [107, 226, 162], [66, 223, 227], [255, 196, 96]];

function secretResidents(place: InteriorPlace): readonly InteriorResident[] {
  const halfDepth = place.depth / 2;
  // The Mirror Shop's keeper and their reflection (the one in the glass speaks forwards).
  if (place.kind === "secret-mirror") return [
    { x: -2.3, z: -halfDepth + 0.8, tint: [120, 90, 160], offset: 0, seated: false, facing: 180, line: "EMOCLEW" },
    { x: 2.3, z: -halfDepth + 0.8, tint: [120, 90, 160], offset: 0, seated: false, facing: 180, line: "WELCOME" },
  ];
  if (place.kind === "secret-carriage") return [
    { x: -5.6, z: -1.45, tint: [96, 110, 150], offset: 2, seated: true, facing: 180, line: "IS THIS THE LAST STOP?" },
  ];
  return [];
}

interface SecretShell { floor: RGB; floorSurface: Surface; wall: RGB; wallSurface: Surface; height: number; ceiling: RGB }
function secretShell(canvas: PropCanvas, place: InteriorPlace, shell: SecretShell): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2, height = shell.height;
  style(canvas, shell.floor, ".", false, shell.floorSurface); block(canvas, 0, -0.15, 0, place.width, 0.3, place.depth);
  style(canvas, shell.wall, ":", false, shell.wallSurface);
  for (const side of [-1, 1]) {
    block(canvas, side * halfWidth, height / 2, 0, 0.35, height, place.depth);
    block(canvas, 0, height / 2, side * halfDepth, place.width, height, 0.35);
  }
  style(canvas, shell.ceiling, "-"); block(canvas, 0, height + 0.1, 0, place.width, 0.2, place.depth);
  // The way out: a lit threshold and EXIT over the door.
  style(canvas, WARM, "=", true); block(canvas, 0, 0.012, halfDepth - 0.45, 2.2, 0.02, 0.3);
  style(canvas, [38, 60, 70], "="); block(canvas, 0, 1.1, halfDepth - 0.22, 1.6, 2.2, 0.1);
  style(canvas, WARM, "=", true); lettering(canvas, "EXIT", 0, Math.min(height - 0.35, 2.6), halfDepth - 0.3, 0.26, 180);
}

/** The Fridge's window: the city from above the clouds, on the left wall, facing into the room. */
function skyWindow(canvas: PropCanvas, x: number, time: number, low: boolean): void {
  const z0 = -2.4, z1 = 2.2, y0 = 0.95, y1 = 2.65, span = z1 - z0, tall = y1 - y0, zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
  style(canvas, [64, 70, 78], "#"); block(canvas, x - 0.03, yc, zc, 0.1, tall + 0.2, span + 0.2);
  style(canvas, SKY, " ", true); block(canvas, x + 0.03, yc, zc, 0.02, tall, span);
  style(canvas, [200, 214, 255], ".", true);
  for (let k = 0; k < (low ? 6 : 14); k++) block(canvas, x + 0.05, y0 + 0.85 + ((k * 0.37) % 1) * 0.75, z0 + 0.2 + ((k * 0.61) % 1) * (span - 0.4), 0.01, 0.04, 0.04);
  // Tower tops through the cloud sea; the tallest wears the Spire's beacon.
  for (const [z, top, beacon] of [[-1.5, 0.55, false], [-0.2, 1.05, true], [1.2, 0.4, false]] as const) {
    style(canvas, [26, 32, 48], "#"); block(canvas, x + 0.05, y0 + top / 2, z, 0.01, top, 0.22);
    if (beacon) { style(canvas, [255, 80, 160], "o", true); block(canvas, x + 0.06, y0 + top + 0.04, z, 0.01, 0.07, 0.07); }
  }
  // The cloud sea, drifting across the window and fading in and out at the frame (no popping).
  for (let k = 0; k < (low ? 5 : 9); k++) {
    const u = ((k / 9 + time * SECRET_CLOUD_SPEED) % 1 + 1) % 1, gain = Math.sin(u * Math.PI) * 0.85, y = y0 + 0.22 + (k % 3) * 0.09, z = z0 + u * span;
    style(canvas, glowOf([196, 206, 220], gain), "o", true);
    canvas.translate(x + 0.06, -y, z); canvas.ellipsoid(0.01, 0.16, 0.42); canvas.translate(-(x + 0.06), y, -z);
  }
}
/** Window widths per second the clouds drift (one crossing every 100 s). */
const SECRET_CLOUD_SPEED = rate("cloudHz") / (Math.PI * 2);

function secretDiner(canvas: PropCanvas, place: InteriorPlace, time: number, low: boolean): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2, height = 3.2;
  secretShell(canvas, place, { floor: [196, 192, 182], floorSurface: SURFACE.tile, wall: [150, 196, 200], wallSurface: SURFACE.glazedTile, height, ceiling: [60, 70, 80] });
  if (!low) {
    style(canvas, [36, 38, 44], ".", false, SURFACE.tile);
    for (let i = 0; i < place.width; i++) for (let j = 0; j < place.depth; j++) if ((i + j) % 2 === 0) block(canvas, -halfWidth + 0.5 + i, 0.006, -halfDepth + 0.5 + j, 1, 0.012, 1);
  }
  style(canvas, [220, 240, 255], "=", true); for (const z of [-2, 1.2]) block(canvas, 0, height - 0.05, z, 3, 0.06, 0.2);
  // The counter (red, chrome-topped) and its one stool.
  style(canvas, [176, 52, 60], "#"); block(canvas, 0, 0.5, -2.2, 4.4, 1.0, 0.8);
  style(canvas, [214, 218, 222], "="); block(canvas, 0, 1.03, -2.2, 4.6, 0.06, 0.95);
  style(canvas, [150, 156, 160], "-"); block(canvas, 0, 0.18, -1.76, 4.4, 0.05, 0.05);
  style(canvas, [160, 166, 170], "|"); block(canvas, 0, 0.36, -1.25, 0.08, 0.72, 0.08);
  style(canvas, [200, 50, 60], "O"); canvas.translate(0, -0.76, -1.25); canvas.ellipsoid(0.24, 0.06, 0.24); canvas.translate(0, 0.76, 1.25);
  // The backbar: a coffee urn, cups, and the menu board above.
  style(canvas, [120, 130, 136], "#"); block(canvas, 0, 0.65, -halfDepth + 0.4, 5.4, 1.3, 0.6);
  style(canvas, [200, 160, 90], "o"); canvas.translate(-2, -1.6, -halfDepth + 0.45); canvas.ellipsoid(0.22, 0.32, 0.22); canvas.translate(2, 1.6, halfDepth - 0.45);
  style(canvas, [236, 232, 220], "u"); for (let k = 0; k < 4; k++) block(canvas, 0.6 + k * 0.32, 1.38, -halfDepth + 0.4, 0.14, 0.14, 0.14);
  style(canvas, DARK, " "); block(canvas, 0, 2.35, -halfDepth + 0.22, 5, 0.95, 0.08);
  style(canvas, place.color, "=", true); lettering(canvas, place.sign, 0, 2.55, -halfDepth + 0.3, 0.28);
  style(canvas, WARM, "=", true); lettering(canvas, "PIE 0 CR. COFFEE ALWAYS", 0, 2.12, -halfDepth + 0.3, 0.16);
  // Pie under a glass dome on the counter (the dome stays once the pie is taken), and the note.
  style(canvas, [150, 200, 220], ":", true); canvas.translate(-1.3, -1.25, -2.2); canvas.ellipsoid(0.3, 0.22, 0.3); canvas.translate(1.3, 1.25, 2.2);
  if (!secretFlagValue(secretFlag("pie"))) {
    style(canvas, [230, 170, 90], "%"); canvas.translate(-1.3, -1.1, -2.2); canvas.ellipsoid(0.22, 0.05, 0.22); canvas.translate(1.3, 1.1, 2.2);
  }
  style(canvas, [245, 240, 220], "="); block(canvas, 0.9, 1.07, -2.2, 0.3, 0.01, 0.22);
  skyWindow(canvas, -halfWidth + 0.2, time, low);
  // A table by the right wall: napkins, a sugar jar, a jukebox glowing in the corner.
  style(canvas, [176, 52, 60], "#"); block(canvas, halfWidth - 0.9, 0.36, 0.4, 0.9, 0.72, 1.1);
  style(canvas, [214, 218, 222], "="); block(canvas, halfWidth - 0.9, 0.75, 0.4, 1.0, 0.05, 1.2);
  style(canvas, [230, 230, 236], "#"); block(canvas, halfWidth - 0.9, 0.86, 0.1, 0.14, 0.18, 0.1);
  style(canvas, glowOf([255, 150, 210], 0.85 + 0.1 * Math.sin(time * rate("screenHz"))), "=", true); block(canvas, halfWidth - 0.55, 0.75, halfDepth - 1.4, 0.7, 1.5, 0.6);
}

function secretGallery(canvas: PropCanvas, place: InteriorPlace, time: number, low: boolean): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2, height = 3.4;
  secretShell(canvas, place, { floor: [24, 58, 70], floorSurface: SURFACE.tile, wall: [64, 76, 78], wallSurface: SURFACE.block, height, ceiling: [36, 44, 48] });
  // Standing water either side of a grated walkway.
  style(canvas, [30, 90, 110], "~", true); for (const side of [-1, 1]) block(canvas, side * (halfWidth - 0.75), 0.01, 0, 1.2, 0.02, place.depth - 0.6);
  style(canvas, [74, 82, 88], "#", false, SURFACE.grating); block(canvas, 0, 0.02, 0, 3.2, 0.04, place.depth - 0.8);
  style(canvas, [52, 60, 64], "="); for (let z = -halfDepth + 1; z < halfDepth - 0.5; z += 2.5) block(canvas, 0, height - 0.15, z, place.width, 0.3, 0.3);
  // Pipes along both walls, glowing and breathing out of step (0.08 Hz).
  for (const side of [-1, 1]) for (const [k, y] of [0.7, 1.5, 2.6].entries()) {
    style(canvas, glowOf([80, 230, 200], 0.72 + 0.2 * Math.sin(time * rate("pipesHz") + side * 1.3 + k * 2.1)), "=", true);
    block(canvas, side * (halfWidth - 0.32), y, 0, 0.18, 0.18, place.depth - 0.8);
  }
  // The rung ladder back up to the street, a coin of light at its top.
  style(canvas, METAL, "|"); for (const side of [-1, 1]) block(canvas, 1.8 + side * 0.25, 1.6, halfDepth - 0.35, 0.05, 3.2, 0.05);
  style(canvas, METAL, "-"); for (let rung = 0; rung < 9; rung++) block(canvas, 1.8, 0.3 + rung * 0.34, halfDepth - 0.35, 0.5, 0.05, 0.05);
  style(canvas, glowOf(WARM, 0.8), "o", true); canvas.translate(1.8, -(height + 0.05), halfDepth - 0.8); canvas.ellipsoid(0.35, 0.03, 0.35); canvas.translate(-1.8, height + 0.05, -(halfDepth - 0.8));
  // A valve housing with a gauge, and the logbook on a crate under a lamp.
  style(canvas, [90, 96, 100], "H"); block(canvas, -1.9, 0.8, -2.5, 1.0, 1.6, 1.4);
  style(canvas, [255, 200, 100], "o", true); canvas.translate(-1.38, -1.3, -2.5); canvas.ellipsoid(0.02, 0.16, 0.16); canvas.translate(1.38, 1.3, 2.5);
  style(canvas, WOOD, "#"); block(canvas, 1.5, 0.45, -halfDepth + 1.4, 1.2, 0.9, 0.9);
  style(canvas, [235, 225, 200], "="); block(canvas, 1.5, 0.92, -halfDepth + 1.4, 0.4, 0.04, 0.3);
  style(canvas, WARM, "o", true); canvas.translate(1.9, -1.15, -halfDepth + 1.2); canvas.ellipsoid(0.12, 0.14, 0.12); canvas.translate(-1.9, 1.15, halfDepth - 1.2);
  style(canvas, DARK, " "); block(canvas, 0, 2.4, -halfDepth + 0.22, 2.6, 0.6, 0.08);
  style(canvas, place.color, "=", true); lettering(canvas, place.sign, 0, 2.4, -halfDepth + 0.3, 0.32);
  // Drips from the vault into the water (a fall every ~3 s each; motion only, no light change).
  if (!low) for (let k = 0; k < 3; k++) {
    const fall = ((time * SECRET_DRIP_RATE + k * 0.37) % 1 + 1) % 1, y = (height - 0.3) * (1 - fall * fall);
    style(canvas, [150, 210, 230], "'", true); block(canvas, (k % 2 ? 1 : -1) * (halfWidth - 0.8), y, -halfDepth + 2 + k * 3.6, 0.05, 0.08, 0.05);
  }
}
const SECRET_DRIP_RATE = rate("dripHz") / (Math.PI * 2);

function paintReflection(canvas: PropCanvas, color: RGB, glyph: string, gain = 1): void {
  style(canvas, [color[0] * gain * 0.62, color[1] * gain * 0.68, color[2] * gain * 0.92], glyph);
}
function secretMirror(canvas: PropCanvas, place: InteriorPlace, fixtures: readonly InteriorFixture[], time: number, viewer: { x: number; z: number } | null): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2, height = 3.8;
  secretShell(canvas, place, { floor: [92, 80, 70], floorSurface: SURFACE.planks, wall: [96, 84, 110], wallSurface: SURFACE.plaster, height, ceiling: [50, 44, 60] });
  // The glass down the middle of the shop, a bright edge where it meets the aisle.
  style(canvas, glowOf([120, 140, 190], 0.3), ":", true, SURFACE.glazing); block(canvas, 0, 1.5, -1.6, 0.04, 3, 5);
  style(canvas, [200, 220, 255], "|", true); block(canvas, 0, 1.5, 0.9, 0.06, 3, 0.06); block(canvas, 0, 3.02, -1.6, 0.08, 0.06, 5);
  // Both halves are one shop and its reflection: counters, shelves of the same goods, two clocks
  // (one runs the other way round; a full turn takes a minute).
  const goods: readonly RGB[] = [[230, 120, 90], [120, 200, 230], [240, 220, 120]];
  for (const side of [-1, 1]) {
    style(canvas, [60, 48, 80], "#"); block(canvas, side * 2.3, 0.55, -2.9, 2.4, 1.1, 0.8);
    style(canvas, [200, 190, 170], "="); block(canvas, side * 2.3, 1.12, -2.9, 2.5, 0.05, 0.9);
    style(canvas, WOOD, "#"); block(canvas, side * (halfWidth - 0.5), 1.3, 0.4, 0.7, 2.6, 2.6);
    for (let row = 0; row < 3; row++) for (let k = 0; k < 3; k++) {
      style(canvas, goods[(row + k) % goods.length], "o"); block(canvas, side * (halfWidth - 0.88), 0.6 + row * 0.8, -0.5 + k * 0.9, 0.2, 0.3, 0.35);
    }
    canvas.push(); canvas.translate(side * 2.3, -2.8, -halfDepth + 0.25);
    style(canvas, [230, 226, 210], "O"); canvas.ellipsoid(0.35, 0.35, 0.03);
    style(canvas, DARK, "|"); canvas.translate(0, 0, 0.04); canvas.rotateZ(side * time * 360 * SECRET_MOTION.clockHz); canvas.translate(0, -0.13, 0); canvas.box(0.04, 0.26, 0.02);
    canvas.pop();
  }
  // Signs: backwards on this side, true in the glass.
  style(canvas, place.color, "=", true);
  lettering(canvas, "POHS RORRIM", -2.3, 3.45, -halfDepth + 0.3, 0.3); lettering(canvas, "MIRROR SHOP", 2.3, 3.45, -halfDepth + 0.3, 0.3);
  style(canvas, WARM, "=", true);
  lettering(canvas, "SNOITCELFER YUB EW", -2.3, 0.75, -2.47, 0.11); lettering(canvas, "WE BUY REFLECTIONS", 2.3, 0.75, -2.47, 0.11);
  // You, in the glass, until you sell it: a dimmer figure at your mirrored place, turned the mirrored way.
  if (!viewer || secretFlagValue(SECRET_FLAGS.reflectionSold)) return;
  const local = interiorLocal(place, viewer.x, viewer.z);
  if (local.z > 0.9 || local.z < -4.1 || Math.abs(local.x) < 0.4) return;
  const yaw = interiorOccupant(fixtures)?.yaw ?? facingIn(place), dx = Math.sin(yaw), dz = -Math.cos(yaw);
  const lx = Math.cos(place.yaw) * dx - Math.sin(place.yaw) * dz, lz = Math.sin(place.yaw) * dx + Math.cos(place.yaw) * dz;
  canvas.push(); canvas.translate(-local.x, 0, local.z); canvas.rotateY(Math.atan2(lx, -lz) * 180 / Math.PI);
  drawHuman(canvas, { coat: [70, 74, 96], trim: [40, 44, 56], skin: [190, 160, 130], light: [160, 190, 255], headwear: "hood", prop: null, idle: "breathe" }, { time, seed: 7, stride: 0, moving: false, detail: true }, paintReflection);
  canvas.pop();
}

function skyline(canvas: PropCanvas, low: boolean): void {
  const count = low ? 10 : 18;
  for (let k = 0; k < count; k++) {
    const angle = k / count * Math.PI * 2 + 0.3 * Math.sin(k * 1.7), radius = 24 + (k * 7 % 5) * 4;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius, width = 6 + (k * 3 % 4) * 2, top = -6 + (k * 5 % 8) * 4, base = -40;
    style(canvas, [22, 26, 36], "#"); block(canvas, x, (top + base) / 2, z, width, top - base, width);
    const fx = -x / radius, fz = -z / radius;
    style(canvas, glowOf(CAPTURE_INKS[k % CAPTURE_INKS.length], 0.75), ".", true);
    for (let j = 0; j < (low ? 2 : 5); j++) {
      const slide = (j * 1.7) % 3 - 1.5;
      block(canvas, x + fx * (width / 2 + 0.05) + fz * slide, top - 1.5 - j * 2.2, z + fz * (width / 2 + 0.05) - fx * slide, 0.6, 0.4, 0.6);
    }
  }
  // The Spire, far off to the north, its beacon steady; stars over everything.
  style(canvas, [30, 26, 40], "#"); block(canvas, 6, -5, -50, 4, 70, 4);
  style(canvas, [255, 71, 148], "o", true); canvas.translate(6, -30.5, -50); canvas.ellipsoid(0.9, 0.9, 0.9); canvas.translate(-6, 30.5, 50);
  if (!low) {
    style(canvas, [190, 200, 255], ".", true);
    for (let k = 0; k < 24; k++) { const r = 20 + (k * 13 % 25); block(canvas, Math.cos(k * 2.4) * r, 34 + (k * 7 % 9), Math.sin(k * 2.4) * r, 0.3, 0.3, 0.3); }
  }
}

function secretRoof(canvas: PropCanvas, place: InteriorPlace, time: number, low: boolean): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  // Tar roof and a parapet; no ceiling (the sky is the sky).
  style(canvas, [50, 52, 56], ".", false, SURFACE.grating); block(canvas, 0, -0.15, 0, place.width, 0.3, place.depth);
  style(canvas, [84, 80, 76], ":", false, SURFACE.block);
  for (const side of [-1, 1]) { block(canvas, side * halfWidth, 0.55, 0, 0.35, 1.1, place.depth); block(canvas, 0, 0.55, side * halfDepth, place.width, 1.1, 0.35); }
  // The stair hut with the way back down the fire escape.
  style(canvas, [70, 66, 64], "#", false, SURFACE.block); block(canvas, 0, 1.4, halfDepth - 0.4, 3.4, 2.8, 0.8);
  style(canvas, [38, 60, 70], "="); block(canvas, 0, 1.05, halfDepth - 0.82, 1.2, 2.1, 0.06);
  style(canvas, WARM, "=", true); lettering(canvas, "EXIT", 0, 2.45, halfDepth - 0.86, 0.26, 180); block(canvas, 0, 0.012, halfDepth - 1.15, 1.6, 0.02, 0.3);
  // A striped lawn chair, a radio on a crate (its dial breathing), a telescope on a tripod.
  style(canvas, METAL, "|"); block(canvas, -2, 0.22, -2, 0.7, 0.04, 1.3);
  for (let k = 0; k < 4; k++) { style(canvas, k % 2 ? [235, 225, 200] : [220, 80, 70], "="); block(canvas, -2, 0.3 + k * 0.02, -2.5 + k * 0.32, 0.66, 0.03, 0.3); }
  style(canvas, [220, 80, 70], "="); block(canvas, -2, 0.62, -1.38, 0.66, 0.6, 0.06);
  style(canvas, WOOD, "#"); block(canvas, -3.6, 0.3, -2, 0.6, 0.6, 0.6);
  style(canvas, [60, 60, 66], "#"); block(canvas, -3.6, 0.75, -2, 0.42, 0.28, 0.2);
  style(canvas, glowOf([255, 190, 110], 0.8 + 0.15 * Math.sin(time * rate("radioHz"))), "o", true); block(canvas, -3.5, 0.78, -1.89, 0.12, 0.08, 0.02);
  style(canvas, METAL, "|"); for (let leg = 0; leg < 3; leg++) { const a = leg * Math.PI * 2 / 3; block(canvas, 2.5 + Math.cos(a) * 0.18, 0.6, -3.5 + Math.sin(a) * 0.18, 0.04, 1.2, 0.04); }
  canvas.push(); canvas.translate(2.5, -1.35, -3.5); canvas.rotateY(Math.sin(time * rate("telescopeHz")) * 6); canvas.rotateX(-14);
  style(canvas, [190, 196, 204], "="); canvas.box(0.16, 0.16, 1.0); canvas.translate(0, 0, -0.55); style(canvas, [80, 150, 220], "o", true); canvas.box(0.14, 0.14, 0.04); canvas.pop();
  // A water tank on legs, an antenna, and a string of steady lights.
  style(canvas, [104, 66, 46], "#"); block(canvas, 3.9, 1.6, 2.2, 2.0, 1.9, 2.0);
  style(canvas, METAL, "|"); for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as const) block(canvas, 3.9 + dx, 0.33, 2.2 + dz, 0.08, 0.66, 0.08);
  block(canvas, -halfWidth + 1, 2.5, -halfDepth + 1, 0.06, 5, 0.06);
  style(canvas, [255, 90, 80], "o", true); block(canvas, -halfWidth + 1, 5.05, -halfDepth + 1, 0.14, 0.14, 0.14);
  style(canvas, [50, 50, 50], "-"); block(canvas, 0, 2.6, -1, place.width - 1, 0.02, 0.02);
  style(canvas, WARM, "o", true); for (let k = 0; k < 9; k++) block(canvas, -halfWidth + 1 + k * 1.25, 2.52, -1, 0.1, 0.12, 0.1);
  skyline(canvas, low);
}

function secretCarriage(canvas: PropCanvas, place: InteriorPlace, fixtures: readonly InteriorFixture[], low: boolean): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2, height = 2.6;
  secretShell(canvas, place, { floor: [70, 74, 84], floorSurface: SURFACE.vinyl, wall: [150, 154, 140], wallSurface: SURFACE.panel, height, ceiling: [120, 120, 110] });
  style(canvas, [255, 236, 190], "=", true); for (const side of [-1, 1]) block(canvas, 0, height - 0.06, side * 0.9, place.width - 2, 0.05, 0.16);
  // Windows down both sides: dark panes with the yard's lamps standing still outside.
  for (const side of [-1, 1]) for (let k = 0; k < 6; k++) {
    const x = -6.5 + k * 2.6;
    if (side > 0 && Math.abs(x) < 1.4) continue;
    const z = side * (halfDepth - 0.19);
    style(canvas, [20, 30, 50], " ", true); block(canvas, x, 1.6, z, 1.9, 0.8, 0.02);
    style(canvas, glowOf(WARM, 0.7), ".", true); block(canvas, x + ((k * 37) % 3 - 1) * 0.4, 1.45 + (k % 2) * 0.25, z - side * 0.01, 0.08, 0.08, 0.01);
  }
  // Bench seats with backs, poles and hanging straps.
  for (const item of fixtures) if (item.kind === "seat") {
    style(canvas, [60, 80, 140], "#"); block(canvas, item.x, 0.25, item.z, item.width, 0.5, item.depth);
    block(canvas, item.x, 0.8, item.z + Math.sign(item.z) * 0.25, item.width, 0.6, 0.1);
  }
  style(canvas, METAL, "|"); for (const x of [-6, -3, 3, 6]) for (const side of [-1, 1]) block(canvas, x, height / 2, side * 1.15, 0.05, height, 0.05);
  if (!low) { style(canvas, [200, 200, 190], "o"); for (let x = -halfWidth + 1.5; x < halfWidth - 1; x += 1.5) for (const side of [-1, 1]) block(canvas, x, height - 0.45, side * 0.6, 0.12, 0.12, 0.02); }
  // The destination board over the far seats.
  style(canvas, DARK, " "); block(canvas, 0, 2.15, -halfDepth + 0.2, 2.6, 0.4, 0.06);
  style(canvas, [255, 170, 60], "=", true); lettering(canvas, place.sign, 0, 2.15, -halfDepth + 0.25, 0.22);
}

function tripod(canvas: PropCanvas, x: number, z: number, yaw: number): void {
  style(canvas, METAL, "|");
  for (let leg = 0; leg < 3; leg++) { const a = leg * Math.PI * 2 / 3 + yaw; block(canvas, x + Math.cos(a) * 0.22, 0.65, z + Math.sin(a) * 0.22, 0.04, 1.3, 0.04); }
  canvas.push(); canvas.translate(x, -1.45, z); canvas.rotateY(yaw * 180 / Math.PI);
  style(canvas, [40, 42, 48], "#"); canvas.box(0.32, 0.22, 0.24);
  canvas.translate(0, 0, -0.18); canvas.box(0.12, 0.12, 0.14);
  style(canvas, [255, 60, 60], "o", true); canvas.translate(0.12, -0.09, 0.14); canvas.box(0.04, 0.04, 0.02);
  canvas.pop();
}
function secretStudio(canvas: PropCanvas, place: InteriorPlace, time: number, low: boolean): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2, height = 3.6;
  secretShell(canvas, place, { floor: [70, 58, 50], floorSurface: SURFACE.planks, wall: [80, 90, 88], wallSurface: SURFACE.plaster, height, ceiling: [40, 46, 48] });
  // The wall of captures: small frames, each a street at night in a district's colour, glowing up
  // and down over twenty seconds.
  for (let row = 0; row < (low ? 2 : 4); row++) for (let column = 0; column < 7; column++) {
    const x = -3 + column, y = 0.95 + row * 0.6, index = row * 7 + column, gain = 0.55 + 0.2 * Math.sin(time * rate("captureHz") + index * 0.9);
    style(canvas, DARK, " "); block(canvas, x, y, -halfDepth + 0.22, 0.86, 0.5, 0.04);
    style(canvas, glowOf(CAPTURE_INKS[index % CAPTURE_INKS.length], gain), "=", true); block(canvas, x, y - 0.1, -halfDepth + 0.25, 0.78, 0.16, 0.02);
    style(canvas, [20, 24, 30], "#"); block(canvas, x - 0.2 + (index % 3) * 0.2, y + 0.06, -halfDepth + 0.26, 0.12, 0.26, 0.01);
  }
  style(canvas, place.color, "=", true); lettering(canvas, place.sign, 0, 3.3, -halfDepth + 0.3, 0.3);
  // The desk and its terminal (a steady green screen), a table of printouts, a plant.
  style(canvas, WOOD, "#"); block(canvas, 0, 0.4, -halfDepth + 1.4, 3.2, 0.8, 0.9);
  style(canvas, [30, 34, 40], "#"); block(canvas, 0, 1.15, -halfDepth + 1.25, 0.8, 0.55, 0.3);
  style(canvas, [120, 255, 170], "=", true); block(canvas, 0, 1.15, -halfDepth + 1.42, 0.7, 0.45, 0.02);
  style(canvas, [60, 64, 70], "#"); block(canvas, 0, 0.82, -halfDepth + 1.62, 0.6, 0.03, 0.2);
  style(canvas, WOOD, "#"); block(canvas, -halfWidth + 1.2, 0.4, 1.2, 1.4, 0.8, 2.2);
  style(canvas, [236, 232, 220], "="); for (let k = 0; k < 5; k++) block(canvas, -halfWidth + 1.0 + (k % 2) * 0.4, 0.82 + k * 0.01, 0.4 + k * 0.35, 0.3, 0.01, 0.4);
  plant(canvas, halfWidth - 0.8, -halfDepth + 0.8, 0, time);
  // The audit cameras on their tripods, each with a steady red dot.
  for (const [x, z, yaw] of [[-2.6, -1.2, 0.5], [2.8, -0.6, -0.6], [1.4, 2.0, 2.8], [-1.6, 1.8, -2.6]] as const) tripod(canvas, x, z, yaw);
}

function drawSecretRoom(canvas: PropCanvas, place: InteriorPlace, fixtures: readonly InteriorFixture[], time: number, low: boolean, effects: boolean, viewer: { x: number; z: number } | null): void {
  const clock = effects ? time : 0;
  canvas.push(); canvas.translate(place.x, 0, place.z); canvas.rotateY(place.yaw * 180 / Math.PI);
  switch (place.kind) {
    case "secret-diner": secretDiner(canvas, place, clock, low); break;
    case "secret-gallery": secretGallery(canvas, place, clock, low); break;
    case "secret-mirror": secretMirror(canvas, place, fixtures, clock, viewer); break;
    case "secret-roof": secretRoof(canvas, place, clock, low); break;
    case "secret-carriage": secretCarriage(canvas, place, fixtures, low); break;
    case "secret-studio": secretStudio(canvas, place, clock, low); break;
    default: break;
  }
  drawResidents(canvas, place, time, viewer);
  canvas.pop();
}
