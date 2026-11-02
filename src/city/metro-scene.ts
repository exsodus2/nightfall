import type { PropCanvas } from "./prop-canvas.ts";
import { cuboid as box, ink, propRange, restorePropRange, type ActivityView } from "./activity.ts";
import { drawLetterPanel } from "./signage.ts";
import { BENCH, BENCH_PARTS, BOARD_STEP, DWELL, LINES, STATIONS, SUPPORT_SOFFITS, TRAIN_COUNT, deckHeight, departureBoard, linePose, lineStations, nextTrain, trainAt, type NextTrain, type Station, type Train } from "./metro.ts";
import { easeSlide } from "./locomotion.ts";
import { RAIL_PORTAL_LATERAL, RAIL_SUPPORTS, RIM_YARDS, STATION_COLUMN_HALF, STATION_COLUMN_U, STATION_COLUMN_V, WORLD_EDGE, type RailSupport, type RGB, type RimYard } from "./world.ts";

const DEG = 180 / Math.PI;
/** Deck beam segments of every line, about 12 m long, each pitched to the local grade. Built once:
 * the frame only culls them by distance. */
interface DeckSegment { x: number; z: number; y: number; yaw: number; pitch: number; length: number }
const DECK_SEGMENTS: readonly DeckSegment[] = LINES.flatMap(line => {
  const count = Math.ceil(line.length / 12), step = line.length / count;
  return Array.from({ length: count }, (_, i) => {
    const a = linePose(line.id, i * step), b = linePose(line.id, (i + 1) * step);
    const ya = deckHeight(line.id, i * step), yb = deckHeight(line.id, (i + 1) * step), run = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: (ya + yb) / 2, yaw: -Math.atan2(b.x - a.x, a.z - b.z) * DEG, pitch: Math.atan2(yb - ya, run) * DEG, length: Math.hypot(run, yb - ya) };
  });
});

// Upholstery stays below the material's emissive threshold (0.64) so it is lit, not glowing.
const BENCH_STYLE: Record<string, readonly [RGB, string]> = {
  base: [[50, 55, 63], "|"],
  cushion: [[142, 52, 78], "#"],
  back: [[118, 43, 67], "#"],
  rail: [[150, 128, 84], "="],
  end: [[110, 124, 124], "|"],
  divider: [[110, 124, 124], "="],
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smooth = (n: number): number => { const x = clamp01(n); return x * x * (3 - 2 * x); };
/** Station detail draws within these distances of the platform centre (dissolving over the last
 *  quarter: propRange), so only the one or two stations near the view pay for it. */
const STATION_NEAR = 120, STATION_FINE = 60;
/** Platform-edge gates, one per carriage door (metro.ts doorAt), and the railing runs between them
 *  (station-local v; the platform runs from -26.5 to 26.5). */
const GATE_DOORS = [-15, 0, 15] as const, GATE_HALF = 1.4;
const EDGE_RUNS: readonly (readonly [number, number])[] = [[-26.3, -15 - GATE_HALF], [-15 + GATE_HALF, -GATE_HALF], [GATE_HALF, 15 - GATE_HALF], [15 + GATE_HALF, 26.3]];
/** Back-of-platform furniture (u 8.5-10; the lift shaft holds v 18.5-21.5, the windscreen wall v -19 to 16). */
const POST_V = [-24, -12, 12, 24] as const, BENCH_V = [-17, -5, 7] as const, POSTER_V = [-13.6, -9.5, 10.3] as const;
const VENDING_V = [-22.6, 14.6] as const, BIN_V = [-25.2, -2.4, 16.8] as const, ROUTE_MAP_V = 0.5;
/** Ceiling tubes along the canopy, and every light (these plus the cross strips at POST_V) pools on the deck. */
const TUBE_V = [-18, -6, 0, 6] as const, POOL_V = [-24, -18, -12, -6, 0, 6, 12, 24] as const;
/** Short adverts for letter panels (A-Z, 0-9 and spaces, 16 letters at most). */
const ADS: readonly (readonly [string, RGB])[] = [
  ["VOLT COLA", [255, 96, 132]], ["KAIJU NOODLES", [255, 186, 72]], ["SLEEP LATER", [132, 206, 255]],
  ["NEURAL CLINIC 24", [120, 240, 190]], ["RENT A DRONE", [214, 140, 255]], ["HARBOUR INSURE", [250, 220, 120]],
  ["DREAM ARCADE", [255, 120, 200]], ["SYNTH SUSHI", [255, 150, 90]], ["NIGHT SHIFT JOBS", [150, 230, 255]],
];
const VENDING_FRONT: readonly RGB[] = [[86, 186, 226], [236, 104, 140]];
const PRODUCTS: readonly (readonly [RGB, string])[] = [[[255, 92, 120], "0"], [[255, 204, 86], "8"], [[120, 240, 170], "o"]];
/** Sign seed for timetable displays: the sign shader's steady style (no marquee scroll, no colour
 *  cycling, no tired letters; materials.ts sign modes read floor(seed * 97) mod 4 == 0). */
const BOARD_SEED = 0.0425;
const BOARD_AMBER: RGB = [255, 190, 92];
/** Centres short timetable text in a fixed width so the letters never change size as it updates. */
const centred = (text: string, width: number): string => text.padStart(Math.floor((width + text.length) / 2)).padEnd(width);
const scaled = (color: RGB, gain: number): RGB => [color[0] * gain, color[1] * gain, color[2] * gain];

/** One station (station-local u from the track toward the platform side, v along it; platform deck
 *  u 3-10 at `height`). `distance` from the view gates the near detail; `signsOnly` (SignCanvas
 *  passes) skips box-only work, the letter panels stay identical. */
function stationScene(t: PropCanvas, station: Station, time: number, liftHeight: number, distance: number, rain: boolean, signsOnly: boolean): void {
  t.push(); t.translate(station.x, 0, station.z); t.rotateY(-station.yaw * DEG);
  const h = station.height, line = LINES[station.line];
  // The timetable drives the signal, the edge gates and the boards; doors are never an unrelated animation.
  const next = nextTrain(time, station.index), doors = next.docked ? trainAt(time, next.train).doors : 0;
  if (!signsOnly) {
    ink(t, [66, 83, 86], "="); box(t, 6.5, h - 0.7, 0, 7, 1.4, 53);
    ink(t, [239, 181, 76], "-"); box(t, 3.15, h + 0.04, 0, 0.35, 0.08, 52);
    ink(t, [38, 60, 66], "="); box(t, 6.5, h + 5.5, 0, 8.6, 0.6, 56);
    // Street columns: on the pavement, off the walking line and out of every carriageway (world.ts).
    ink(t, [72, 92, 97], "|");
    for (const v of STATION_COLUMN_V) box(t, STATION_COLUMN_U, h / 2, v, STATION_COLUMN_HALF * 2, h, STATION_COLUMN_HALF * 2);
    for (const v of POST_V) {
      ink(t, [72, 92, 97], "|"); box(t, 9.5, h + 2.6, v, 0.35, 5.2, 0.35);
      ink(t, [234, 217, 159], "="); box(t, 6, h + 5.13, v, 4, 0.13, 0.36);
    }
    ink(t, [63, 102, 108], "=");
    for (const v of BENCH_V) { box(t, 8.6, h + 0.6, v, 1.2, 0.25, 4); box(t, 9.2, h + 1.2, v, 0.16, 1.2, 4); }
    ink(t, [82, 110, 117], "|");
    for (let v = -25; v <= 25; v += 2.5) box(t, 10, h + 0.7, v, 0.08, 1.4, 0.08);
    box(t, 10, h + 1.4, 0, 0.1, 0.1, 52);
    for (const end of [-26.5, 26.5]) box(t, 6.5, h + 1.4, end, 7, 0.1, 0.1);
    // A windscreen wall behind the benches (name tiles, posters and the route map hang on it) and
    // service pipes along the back of the canopy.
    ink(t, [54, 66, 70], "#"); box(t, 10.12, h + 1.25, -1.5, 0.12, 2.5, 35);
    ink(t, [76, 88, 90], "="); box(t, 10.3, h + 5, 0, 0.22, 0.22, 54);
    ink(t, [122, 92, 62], "-"); box(t, 9.9, h + 4.95, 0, 0.14, 0.14, 54);
    // Glass lift shaft (corner posts and a machine cap; landing doors near the view) and its cabin.
    // The engine's lift stays at (9, 20): only the drawing changes here.
    ink(t, [72, 111, 120], "|");
    for (const u of [7.5, 10.5]) for (const v of [18.5, 21.5]) box(t, u, h / 2 + 2.4, v, 0.16, h + 4.8, 0.16);
    ink(t, [58, 84, 92], "="); box(t, 9, h + 4.7, 20, 3.3, 0.3, 3.3);
    ink(t, [50, 74, 81], "="); box(t, 9, liftHeight - 0.12, 20, 2.9, 0.25, 2.9);
    box(t, 9, liftHeight + 3.4, 20, 2.9, 0.2, 2.9);
    ink(t, station.color, "="); box(t, 9, liftHeight + 3.26, 20, 2.5, 0.09, 2.5);
    ink(t, [239, 214, 153], "@"); box(t, 7.4, 1.5, 18.9, 0.1, 0.4, 0.14);
    box(t, 7.4, h + 1.5, 18.9, 0.1, 0.4, 0.14);
    if (station.line === 1) rimGallery(t, h, line.color);
  }
  drawLetterPanel(t, { x: 9, y: 4.5, z: 22, yaw: 0, width: 6, height: 1.7, text: "LIFT", color: station.color });
  const name = station.name.replace("The ", "").slice(0, 16);
  for (const v of [-14, 14]) {
    drawLetterPanel(t, { x: 6.3, y: h + 4.5, z: v, yaw: 0, width: 6, height: 1.15, text: line.short, color: line.color });
    drawLetterPanel(t, { x: 6.3, y: h + 3.3, z: v, yaw: 0, width: Math.max(6, name.length * 0.5), height: 1, text: name, color: station.color });
  }
  ink(t, next.docked && doors > 0.85 ? [81, 238, 173] : [242, 102, 79], "@"); box(t, 3.3, h + 3.8, -25, 0.3, 0.4, 0.3);
  if (distance < STATION_NEAR) {
    const outer = propRange(STATION_NEAR);
    platformNear(t, station, time, liftHeight, next, doors, name, signsOnly);
    if (!signsOnly && distance < STATION_FINE) { propRange(STATION_FINE); platformFine(t, station, time, rain); }
    restorePropRange(outer);
  }
  t.pop();
}

/** Near the view: edge gates and tactile strip, furniture, the wall's detail, departure boards and
 *  the lift's landing doors. Station-local, inside stationScene's transform. */
function platformNear(t: PropCanvas, station: Station, time: number, liftHeight: number, next: NextTrain, doors: number, name: string, signsOnly: boolean): void {
  const h = station.height, line = LINES[station.line], stops = lineStations(station.line);
  if (!signsOnly) {
    // Half-height platform-edge gates. Their lit rail shows the line colour, amber while a train is
    // arriving or its doors move, green while they stand open; the leaves slide with the doors.
    const strip: RGB = next.docked ? (doors > 0.85 ? [90, 236, 160] : [255, 176, 70]) : next.seconds <= 12 ? [255, 176, 70] : line.color;
    for (const [a, b] of EDGE_RUNS) {
      ink(t, [52, 84, 92], "|"); box(t, 3.08, h + 0.5, (a + b) / 2, 0.06, 0.9, b - a);
      ink(t, strip, "-", 0.9); box(t, 3.08, h + 1.0, (a + b) / 2, 0.1, 0.06, b - a);
      ink(t, [150, 170, 168], "="); box(t, 3.08, h + 1.1, (a + b) / 2, 0.12, 0.08, b - a);
    }
    for (const d of GATE_DOORS) for (const side of [-1, 1]) {
      ink(t, [44, 58, 64], "#"); box(t, 3.08, h + 0.6, d + side * GATE_HALF, 0.18, 1.2, 0.16);
      ink(t, strip, "@"); box(t, 3.08, h + 1.26, d + side * GATE_HALF, 0.2, 0.12, 0.2);
      ink(t, [112, 150, 156], "|"); box(t, 3.18, h + 0.5, d + side * (GATE_HALF / 2 + easeSlide(doors) * (GATE_HALF - 0.1)), 0.05, 0.95, GATE_HALF - 0.08);
    }
    // Tactile paving: a dotted band just inside the yellow line.
    ink(t, [156, 124, 50], "o"); box(t, 3.55, h + 0.03, 0, 0.4, 0.06, 52);
    // Canopy posts: grimy plinths, a line-colour band, capitals.
    for (const v of POST_V) {
      ink(t, [40, 47, 48], "%"); box(t, 9.5, h + 0.25, v, 0.55, 0.5, 0.55);
      ink(t, line.color, "=", 0.8); box(t, 9.5, h + 2.4, v, 0.42, 0.12, 0.42);
      ink(t, [60, 74, 78], "="); box(t, 9.5, h + 5, v, 0.6, 0.25, 0.6);
    }
    // The wall: a grime band, panel seams, a line-colour trim, poster frames and the route map.
    ink(t, [33, 39, 38], "%"); box(t, 10.03, h + 0.2, -1.5, 0.06, 0.4, 35);
    ink(t, line.color, "-", 0.75); box(t, 10.03, h + 2.46, -1.5, 0.06, 0.06, 35);
    // Brighter toward the canopy lights: a lighter upper band (behind the seams, posters and tiles).
    ink(t, [64, 78, 82], "#"); box(t, 10.045, h + 2.1, -1.5, 0.02, 0.6, 35);
    ink(t, [30, 37, 40], "|");
    for (let v = -16.5; v < 16; v += 2.5) box(t, 10.04, h + 1.25, v, 0.05, 2.5, 0.06);
    ink(t, [20, 24, 28], "#");
    for (const v of POSTER_V) box(t, 10.02, h + 1.35, v, 0.04, 0.75, 2.8);
    ink(t, [24, 30, 36], "#"); box(t, 10, h + 1.5, ROUTE_MAP_V, 0.06, 1.1, 3);
    ink(t, line.color, "=", 0.9); box(t, 9.96, h + 1.95, ROUTE_MAP_V, 0.03, 0.1, 2.8);
    ink(t, line.color, "-", 0.95); box(t, 9.96, h + 1.45, ROUTE_MAP_V, 0.03, 0.06, 2.6);
    stops.forEach((stop, i) => {
      const here = stop.index === station.index, size = here ? 0.26 : 0.15;
      ink(t, here ? [255, 248, 228] : [176, 190, 186], here ? "@" : "o");
      box(t, 9.95, h + 1.45, ROUTE_MAP_V - 1.2 + 2.4 * i / (stops.length - 1), 0.03, size, size);
    });
    ink(t, [255, 176, 70], "^"); box(t, 9.95, h + 1.18, ROUTE_MAP_V - 1.2 + 2.4 * station.stop / (stops.length - 1), 0.03, 0.14, 0.14);
    // Bench armrests, vending machines (lit fronts; the product grid is fine detail), bins.
    ink(t, [110, 124, 124], "|");
    for (const v of BENCH_V) for (const end of [-1, 1]) box(t, 8.6, h + 0.85, v + end * 1.95, 1.2, 0.5, 0.08);
    VENDING_V.forEach((v, i) => {
      ink(t, [38, 44, 56], "#"); box(t, 9.45, h + 1, v, 0.9, 2, 1.1);
      ink(t, VENDING_FRONT[i], "|", 0.9); box(t, 8.99, h + 1.2, v - 0.1, 0.04, 1.2, 0.75);
      ink(t, VENDING_FRONT[(i + 1) % VENDING_FRONT.length], "="); box(t, 8.99, h + 1.92, v, 0.05, 0.18, 1);
      ink(t, [18, 22, 26], "_"); box(t, 8.99, h + 0.35, v - 0.1, 0.05, 0.2, 0.6);
      ink(t, [210, 214, 200], ":"); box(t, 8.99, h + 1.1, v + 0.4, 0.05, 0.4, 0.14);
    });
    for (const v of BIN_V) {
      ink(t, [56, 66, 66], "#"); box(t, 9.1, h + 0.45, v, 0.55, 0.9, 0.55);
      ink(t, [212, 150, 62], "-", 0.8); box(t, 9.1, h + 0.7, v, 0.57, 0.08, 0.57);
      ink(t, [80, 92, 90], "="); box(t, 9.1, h + 0.93, v, 0.62, 0.06, 0.62);
    }
    // Light tubes along the canopy (housing, then the tube).
    for (const v of TUBE_V) {
      ink(t, [40, 50, 54], "="); box(t, 5.6, h + 5.17, v, 0.32, 0.06, 3.4);
      ink(t, [236, 226, 182], "="); box(t, 5.6, h + 5.11, v, 0.16, 0.08, 3.2);
    }
    // Departure board housings, hung from the canopy below the name panels.
    for (const end of [-1, 1]) {
      ink(t, [26, 32, 36], "#"); box(t, 6.3, h + 3.2, end * 6, 4.6, 1.15, 0.2);
      ink(t, [72, 86, 90], "|"); for (const u of [4.6, 8]) box(t, u, h + 4.49, end * 6, 0.06, 1.43, 0.06);
    }
    // Lift landing doors (street and platform, on the shaft's u = 7.5 face): side panels, a lintel,
    // an indicator housing, and two leaves that slide behind the panels as the cabin arrives.
    // The platform camera (inspection.ts "platform", u 7 v 22) stands half a metre from this face,
    // so it is built of readable parts: grimy kick plates, lighter brushed insets, lit line-colour
    // jambs, a call button, a lit lintel strip under a shadow band, and leaves with a centre seal,
    // a vision strip and their own kick plates. Overlays sit 1-3 cm proud of the faces they mark;
    // the leaves' overlays stay inside the panels' depth, so they hide with the leaves.
    for (const level of [0, h]) {
      const open = smooth(1 - Math.abs(liftHeight - level) / 0.8);
      ink(t, [52, 70, 76], "#");
      for (const v of [18.9, 21.1]) box(t, 7.5, level + 1.25, v, 0.1, 2.5, 0.8);
      box(t, 7.5, level + 2.8, 20, 0.12, 0.6, 3);
      box(t, 7.5, level + 3.35, 20, 0.1, 0.5, 0.9);
      ink(t, [30, 36, 38], "%"); for (const v of [18.9, 21.1]) box(t, 7.435, level + 0.15, v, 0.03, 0.3, 0.8);
      ink(t, [74, 94, 100], "="); for (const v of [18.85, 21.15]) box(t, 7.435, level + 1.85, v, 0.03, 0.9, 0.62);
      ink(t, line.color, "|", 0.7); for (const v of [19.27, 20.73]) box(t, 7.435, level + 1.375, v, 0.03, 2.15, 0.06);
      ink(t, line.color, "-", 0.85); box(t, 7.425, level + 2.57, 20, 0.02, 0.05, 2.9);
      ink(t, [32, 40, 44], "%"); box(t, 7.425, level + 3.0, 20, 0.02, 0.2, 3);
      ink(t, [22, 28, 32], "#"); box(t, 7.418, level + 1.25, 21.2, 0.02, 0.4, 0.2);
      ink(t, open > 0.5 ? [90, 236, 160] : [255, 176, 70], "@"); box(t, 7.402, level + 1.3, 21.2, 0.012, 0.09, 0.09);
      for (const side of [-1, 1]) {
        const leaf = 20 + side * (0.35 + open * 0.7);
        ink(t, [128, 156, 160], "|"); box(t, 7.56, level + 1.25, leaf, 0.05, 2.5, 0.69);
        ink(t, [26, 32, 34], "|"); box(t, 7.524, level + 1.4, leaf - side * 0.32, 0.016, 2.2, 0.04);
        ink(t, [30, 44, 52], ":"); box(t, 7.524, level + 1.7, leaf + side * 0.04, 0.016, 1, 0.14);
        ink(t, [46, 54, 56], "%"); box(t, 7.524, level + 0.15, leaf, 0.016, 0.3, 0.69);
      }
    }
    // The shaft's corner posts at the platform: a grimy plinth sleeve and a line-colour band (as the canopy posts).
    for (const u of [7.5, 10.5]) for (const v of [18.5, 21.5]) {
      ink(t, [36, 44, 46], "%"); box(t, u, h + 0.2, v, 0.24, 0.4, 0.24);
      ink(t, line.color, "=", 0.8); box(t, u, h + 2.4, v, 0.21, 0.1, 0.21);
    }
    ink(t, [205, 176, 109], "|");
    box(t, 10.3, liftHeight + 1, 20, 0.06, 0.06, 2.5);
    for (const v of [18.75, 21.25]) box(t, 9.05, liftHeight + 1, v, 2.4, 0.06, 0.06);
  }
  // Departure boards: the next train, truthful to the timetable. The letters change at most once per
  // BOARD_STEP seconds and ease up from a slightly dimmer level when they do (never a blink).
  const board = departureBoard(time, station.index), before = departureBoard(time - BOARD_STEP, station.index);
  const fade = board.status === before.status ? 1 : 0.84 + 0.16 * smooth((time - Math.floor(time / BOARD_STEP) * BOARD_STEP) / 0.6);
  const status = centred(board.status, 13);
  for (const end of [-1, 1]) {
    const z = end * 6.12, yaw = end > 0 ? 0 : 180;
    drawLetterPanel(t, { x: 6.3, y: h + 3.45, z, yaw, width: 4.2, height: 0.46, text: status, color: scaled(BOARD_AMBER, fade), seed: BOARD_SEED });
    drawLetterPanel(t, { x: 6.3, y: h + 2.93, z, yaw, width: 4.2, height: 0.42, text: centred(board.destination, 13), color: line.color, seed: BOARD_SEED });
  }
  // The wall's name tiles (above the benches) and posters, facing the track.
  for (const v of BENCH_V) drawLetterPanel(t, { x: 9.98, y: h + 2.15, z: v, yaw: -90, width: Math.min(4.2, name.length * 0.3 + 0.4), height: 0.4, text: name, color: station.color });
  POSTER_V.forEach((v, i) => {
    const [text, color] = ADS[(station.index * 3 + i) % ADS.length];
    drawLetterPanel(t, { x: 9.98, y: h + 1.35, z: v, yaw: -90, width: 2.6, height: 0.55, text, color });
  });
  // Lift floor indicators over both landings: G (street) or P (platform), wherever the cabin is.
  for (const level of [0, h]) drawLetterPanel(t, { x: 7.42, y: level + 3.35, z: 20, yaw: -90, width: 0.45, height: 0.42, text: liftHeight > h / 2 ? "P" : "G", color: BOARD_AMBER, seed: BOARD_SEED });
  // Where the lift goes, on the landing's near side panel above the call button (steady sign style).
  for (const level of [0, h]) drawLetterPanel(t, { x: 7.41, y: level + 2.05, z: 21.15, yaw: -90, width: 0.6, height: 0.2, text: level > 0 ? "STREET" : "TRAINS", color: line.color, seed: BOARD_SEED });
}

/** Fine detail within STATION_FINE: hazard notches on the edge line, light pools under every lamp
 *  (three nested, brighter patches of deck: a soft falloff), boarding pads at the doors, the vending
 *  machines' product grid, and in rain a few leaks dripping into puddles. Boxes only. */
function platformFine(t: PropCanvas, station: Station, time: number, rain: boolean): void {
  const h = station.height;
  ink(t, [38, 34, 28], "/");
  for (let v = -25; v <= 25; v += 2.5) box(t, 3.22, h + 0.05, v, 0.22, 0.1, 0.6);
  for (const v of POOL_V) {
    // Warmer toward the core (the tubes are warm white); the brightest stays under the emissive threshold.
    ink(t, [76, 96, 98], "="); box(t, 6.2, h + 0.01, v, 5.4, 0.02, 4.8);
    ink(t, [94, 114, 112], "="); box(t, 6.2, h + 0.0175, v, 3.8, 0.035, 3.4);
    ink(t, [118, 134, 124], "="); box(t, 6.2, h + 0.025, v, 2.2, 0.05, 2);
  }
  ink(t, [70, 140, 116], "+");
  for (const d of GATE_DOORS) box(t, 4.3, h + 0.0225, d, 1.1, 0.045, 2.3);
  for (const v of VENDING_V) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const [color, glyph] = PRODUCTS[(r + c + station.index) % PRODUCTS.length];
    ink(t, color, glyph); box(t, 8.955, h + 0.85 + r * 0.32, v - 0.35 + c * 0.25, 0.03, 0.2, 0.17);
  }
  if (!rain) return;
  for (let k = 0; k < 3; k++) {
    const u = 4.6 + ((station.index + k * 3) % 4) * 0.8, v = -20 + ((station.index * 7 + k * 13) % 34);
    ink(t, [30, 48, 58], "~"); box(t, u, h + 0.0325, v, 1.4, 0.065, 1);
    ink(t, [74, 116, 138], "~"); box(t, u + 0.1, h + 0.0375, v - 0.1, 0.6, 0.075, 0.4);
    // A drop falls from a leaking roof seam every 1.3 s (accelerating, as a drop does).
    const fall = ((time / 1.3 + k * 0.37) % 1 + 1) % 1;
    ink(t, [150, 196, 214], "'"); box(t, u, h + 5.1 - 5 * fall * fall, v, 0.05, 0.22, 0.05);
  }
}

/** Rim Line stations stand over the harbour: beyond the track (u < -3) a narrow gallery on brackets
 *  from the deck, with an open railing, a lit rail and warm lamps every 8 m. Clear of the carriage
 *  body (|u| <= 2.9) and below its floor. */
function rimGallery(t: PropCanvas, h: number, color: RGB): void {
  ink(t, [46, 58, 62], "="); box(t, -3.95, h - 0.35, 0, 1.5, 0.3, 53);
  for (const v of [-18, 0, 18]) box(t, -2.55, h - 0.62, v, 1.4, 0.2, 0.4);
  // Harbour-light: the handrail is a warm lit strip (it reads as a line of light from the quay and
  // the water), the lamps are larger, and their light lies on the gallery floor.
  ink(t, [255, 214, 160], "=", 0.95); box(t, -4.65, h + 0.8, 0, 0.12, 0.1, 52);
  ink(t, [120, 136, 136], "="); box(t, -4.65, h + 0.3, 0, 0.05, 0.05, 52);
  ink(t, color, "-", 0.9); box(t, -4.63, h + 0.68, 0, 0.06, 0.06, 52);
  ink(t, [255, 200, 140], ".", 0.62); box(t, -3.95, h - 0.18, 0, 1.2, 0.04, 50);
  for (let v = -24; v <= 24; v += 8) {
    ink(t, [70, 82, 84], "|"); box(t, -4.65, h + 1.4, v, 0.12, 3.2, 0.12);
    ink(t, [255, 204, 140], "@"); box(t, -4.45, h + 3, v, 0.6, 0.28, 0.4);
  }
}

/** A three-car train. `detailed` (near, or ridden) adds the interior; `near` (very near, or ridden)
 *  adds the route maps over the doors and the lit adverts inside. */
function carriage(t: PropCanvas, train: Train, detailed: boolean, near: boolean, time: number): void {
  const outer = propRange(530), line = LINES[train.line], stops = lineStations(train.line);
  // Arrival and departure, in sequence: head and tail lamps ease down once it has stopped and back up
  // before it leaves; door lamps turn amber while the doors move and green once they stand open.
  const dwell = train.station === null ? 0 : Math.min(clamp01((DWELL - train.remaining) / 1.5), clamp01(train.remaining / 1.5));
  const lamp = 1 - 0.3 * smooth(dwell);
  const doorLamp: RGB | null = train.doors >= 0.99 ? [92, 240, 160] : train.doors > 0.01 ? [255, 178, 70] : null;
  // Straps lean back as it pulls away and forward as it brakes: the slope of its speed over the last
  // 1.2 s (a ramp, never a jolt), at most ~0.16 m. Only the straps move; the carriage never tilts.
  const sway = detailed ? Math.max(-0.4, Math.min(0.4, (train.speed - trainAt(time - 1.2, train.id).speed) / 1.2 / 9.8)) * 0.5 : 0;
  // Pitched with the deck (a rigid body about its centre; metro.ts `floorHeight`): local +v is the rear.
  t.push(); t.translate(train.x, -train.floor, train.z); t.rotateY(-train.yaw * DEG); t.rotateX(-Math.atan(train.grade) * DEG);
  [-15, 0, 15].forEach((center, car) => {
    ink(t, [68, 91, 98], "="); box(t, 0, -0.22, center, 5.6, 0.45, 14.2);
    ink(t, [104, 119, 115], "-"); box(t, 0, 4.45, center, 5.65, 0.35, 14.3);
    for (const side of [-1, 1]) {
      ink(t, [83, 116, 124], "=");
      // Sidewalls surround genuinely open window spaces and a sliding door.
      for (const end of [-1, 1]) {
        box(t, side * 2.8, 0.6, center + end * 4.15, 0.15, 1.2, 5.7);
        box(t, side * 2.8, 3.98, center + end * 4.15, 0.15, 0.6, 5.7);
      }
      for (const v of [-6.9, -4.6, -1.4, 1.4, 4.6, 6.9]) box(t, side * 2.8, 2.6, center + v, 0.16, 2.75, 0.17);
      ink(t, line.color, "-", 0.85); // the line's livery stripe
      box(t, side * 2.9, 0.35, center, 0.1, 0.16, 14);
      // Livery: a painted line-colour band under the windows (not across the doors), a lit one along the roof edge.
      ink(t, line.color, "=", 0.62);
      for (const end of [-1, 1]) box(t, side * 2.89, 1, center + end * 4.15, 0.05, 0.22, 5.7);
      ink(t, line.color, "=", 0.9); box(t, side * 2.86, 4.18, center, 0.06, 0.14, 14.2);
      // Doors on the platform side only. Sliding leaves remain visible.
      const opening = side > 0 ? easeSlide(train.doors) : 0; // draw-time ease: the timetable's fraction stays linear
      for (const leaf of [-1, 1]) {
        ink(t, [96, 127, 132], "|", 0.72);
        box(t, side * 2.83, 1.9, center + leaf * (0.65 + opening * 1.35), 0.13, 3.8, 1.26);
        ink(t, [146, 188, 181], "H", 0.65);
        box(t, side * 2.91, 2.45, center + leaf * (0.65 + opening * 1.35), 0.07, 1.25, 0.76);
      }
      if (side > 0 && doorLamp && detailed) { ink(t, doorLamp, "@"); box(t, 2.93, 3.95, center, 0.06, 0.12, 0.5); }
      if (detailed) { ink(t, [150, 128, 72], "#"); box(t, side * 2.35, 0.02, center, 0.8, 0.04, 2.4); } // door threshold plate
      if (near) {
        // Route map over the door: a dark header, the line, its stations left to right in running
        // order (from inside, on either wall), the next stop amber and the current one green.
        propRange(150);
        ink(t, [22, 28, 32], "#"); box(t, side * 2.76, 4.03, center, 0.1, 0.44, 2.6);
        ink(t, line.color, "-"); box(t, side * 2.7, 4.03, center, 0.03, 0.05, 2.2);
        stops.forEach((stop, i) => {
          const here = stop.index === train.station, next = stop.index === train.next, size = here || next ? 0.17 : 0.1;
          ink(t, here ? [120, 240, 170] : next ? [255, 214, 120] : [150, 162, 158], here || next ? "@" : "o");
          box(t, side * 2.69, 4.03, center + side * (-1 + 2 * i / (stops.length - 1)), 0.03, size, size);
        });
        // One lit advert per car and side, on the band above the windows.
        const [text, color] = ADS[(train.id * 3 + car * 2 + (side > 0 ? 1 : 0)) % ADS.length];
        drawLetterPanel(t, { x: side * 2.71, y: 3.98, z: center + side * 4.15, yaw: side > 0 ? -90 : 90, width: 3.2, height: 0.42, text, color });
        propRange(530);
      }
      if (detailed) {
        propRange(150);
        // Solid benches (plinth, cushion, backrest, end screens, armrests) leave a continuous
        // central aisle through all three carriages. Colours and glyphs differ from the floor and
        // walls so the benches read as masses rather than dissolving into the teal interior.
        for (const end of [-1, 1]) for (const part of BENCH_PARTS) {
          const [color, glyph] = BENCH_STYLE[part.part] ?? BENCH_STYLE.base;
          ink(t, color, glyph);
          box(t, side * part.u, part.y, center + end * BENCH.middle + part.v, part.w, part.h, part.d);
          // End screens get a darker inset (slightly thicker than the screen, so it shows on both
          // faces) inside a pale frame: no flat slab beside the seats.
          if (part.part === "end") { ink(t, [76, 88, 90], "#"); box(t, side * part.u, part.y + 0.06, center + end * BENCH.middle + part.v, part.w - 0.22, part.h - 0.38, part.d + 0.04); }
        }
        ink(t, [205, 176, 109], "|");
        for (const v of [-1.65, 1.65]) box(t, side * 1.8, 2.05, center + v, 0.065, 4.1, 0.065);
        // Inside faces of the door leaves (they slide with them, and hide behind the wall pocket when
        // open): a dark rubber seal on the meeting edge and a glazed window. A lit lip frames the
        // window heads under the advert band.
        for (const leaf of [-1, 1]) {
          const at = center + leaf * (0.65 + opening * 1.35);
          ink(t, [24, 28, 30], "|"); box(t, side * 2.7465, 1.9, at - leaf * 0.6, 0.023, 3.7, 0.05);
          ink(t, [34, 52, 60], ":"); box(t, side * 2.7465, 2.45, at, 0.023, 1.2, 0.72);
        }
        ink(t, [118, 140, 138], "-");
        for (const end of [-1, 1]) box(t, side * 2.71, 3.67, center + end * 4.15, 0.05, 0.04, 5.7);
        propRange(530);
      }
    }
    if (detailed) {
      propRange(150);
      ink(t, [243, 219, 163], "="); box(t, 0, 4.21, center, 0.65, 0.07, 11.6);
      ink(t, [142, 159, 153], "-"); box(t, 0, 3.7, center, 0.055, 0.055, 12.5);
      // Hanging straps from the ceiling rail; only their handles sway (see `sway`).
      for (const v of [-5.6, -4.2, -2.8, 2.8, 4.2, 5.6]) {
        ink(t, [142, 159, 153], "|"); box(t, 0, 3.6, center + v + sway * 0.4, 0.04, 0.2, 0.04);
        ink(t, [194, 173, 114], "O"); box(t, 0, 3.4, center + v + sway, 0.26, 0.22, 0.05);
      }
      // Ceiling: panel joints across it and an air vent each side of the light (just under the roof,
      // above the light strip, so they never cross it).
      ink(t, [40, 50, 52], "-");
      for (let k = -3; k <= 3; k++) box(t, 0, 4.262, center + k * 1.85, 5.3, 0.02, 0.05);
      ink(t, [50, 62, 64], "%");
      for (const u of [-1.05, 1.05]) box(t, u, 4.255, center, 0.24, 0.03, 12.4);
      // Floor pattern: a ribbed aisle runner down the middle of each car, with pale edge strips.
      ink(t, [52, 66, 72], ":"); box(t, 0, 0.02, center, 1.1, 0.04, 13.4);
      ink(t, [84, 102, 104], "-");
      for (const u of [-0.58, 0.58]) box(t, u, 0.025, center, 0.05, 0.05, 13.4);
      drawLetterPanel(t, { x: 0, y: 3.7, z: center - 6.8, yaw: 0, width: 2.3, height: 0.5, text: train.station === null ? "NEXT STOP" : "DOORS OPEN", color: [240, 188, 100] });
      propRange(530);
    } else {
      // From afar: a lit interior behind the windows with a few passenger silhouettes against it.
      ink(t, [214, 182, 118], "=", 0.85); box(t, 0, 2.4, center, 0.3, 2.2, 13);
      ink(t, [24, 28, 34], "#");
      for (let k = 0; k < 3; k++) box(t, 0, 2.05, center + ((train.id * 5 + car * 3 + k * 4) % 11) - 5, 1.3, 1.5, 0.45);
    }
  });
  ink(t, [42, 57, 62], "|");
  for (const v of [-7.5, 7.5]) {
    box(t, 0, -0.14, v, 3.2, 0.26, 1.4);
    for (const side of [-1, 1]) box(t, side * 1.8, 2.1, v, 0.16, 4.2, 1.4);
    box(t, 0, 4.2, v, 3.6, 0.18, 1.4);
  }
  // End panels have large clear windscreens, allowing an unobstructed city view.
  for (const v of [-22.1, 22.1]) {
    ink(t, [71, 104, 110], "="); box(t, 0, 0.65, v, 5.6, 1.3, 0.2);
    box(t, 0, 3.9, v, 5.6, 0.65, 0.2);
    for (const u of [-2.6, 2.6]) box(t, u, 2.6, v, 0.3, 2.4, 0.2);
  }
  // Head lamps and top markers at the front (-v), tail lamps at the rear, eased by `lamp`.
  ink(t, [251, 233, 177], "@", lamp);
  for (const side of [-1, 1]) { box(t, side * 1.8, 0.7, -22.3, 0.75, 0.35, 0.12); box(t, side * 2.3, 4.05, -22.28, 0.3, 0.16, 0.08); }
  ink(t, [241, 64, 70], "=", lamp); box(t, 0, 0.7, 22.3, 3, 0.22, 0.12);
  for (const side of [-1, 1]) box(t, side * 2.3, 4.05, 22.28, 0.3, 0.16, 0.08);
  if (detailed) {
    // Destination (the next stop) over the windscreen and on the platform side of the middle car,
    // and the route number under it: each just outside a solid band, so riders never see their backs.
    propRange(150);
    const destination = STATIONS[train.next].name.replace("The ", "").toUpperCase().slice(0, 16);
    drawLetterPanel(t, { x: 0, y: 3.9, z: -22.27, yaw: 180, width: 3.8, height: 0.46, text: destination, color: BOARD_AMBER, seed: BOARD_SEED });
    drawLetterPanel(t, { x: 0, y: 0.95, z: -22.27, yaw: 180, width: 0.9, height: 0.42, text: line.id === 0 ? "C1" : "R2", color: line.color, seed: BOARD_SEED });
    drawLetterPanel(t, { x: 2.92, y: 3.98, z: 4.15, yaw: 90, width: 3.6, height: 0.42, text: destination, color: BOARD_AMBER, seed: BOARD_SEED });
  }
  t.pop();
  restorePropRange(outer);
}

/** One viaduct support (world.ts RAIL_SUPPORTS): a portal frame straddling the street, legs on
 *  both pavements, crossbeam and knee brackets under the deck; or a single column with a pier cap. */
function railSupport(t: PropCanvas, support: RailSupport, soffit: number): void {
  ink(t, [49, 70, 78], "|");
  for (const leg of support.legs) box(t, leg.x, soffit / 2, leg.z, leg.half * 2, soffit, leg.half * 2);
  ink(t, [58, 83, 92], "=");
  if (!support.span) { box(t, support.x, soffit - 0.45, support.z, 3.4, 0.9, 3.4); return; }
  const across = RAIL_PORTAL_LATERAL * 2 + 1.3, alongX = support.span === "x";
  box(t, support.x, soffit - 0.75, support.z, alongX ? across : 1.5, 1.5, alongX ? 1.5 : across);
  for (const side of [-1, 1]) {
    const offset = side * (RAIL_PORTAL_LATERAL - 1.55);
    box(t, support.x + (alongX ? offset : 0), soffit - 2.1, support.z + (alongX ? 0 : offset), alongX ? 1.8 : 1.1, 1.2, alongX ? 1.1 : 1.8);
  }
}

/** The harbour outside the city edge, under the Rim Line's outer legs: a quay running on from the
 * Rim Roads to a flood wall with lamp masts, dark water beyond and a line of offshore pylons. Drawn
 * in 64 m bays near the view. */
const QUAY_OUT = 32, WALL = WORLD_EDGE + QUAY_OUT, PYLON_OUT = 70;
/** Flood-wall lamp masts every MAST_STEP m, lamps MAST_Y up on a crossarm reaching MAST_REACH m
 *  inland and out from the wall's centre (sights.ts WALL_MAST_STEP, MAST_LAMP_Y, MAST_ARM: the
 *  ground shader lays their light pools on the quay and the water at the same places). */
const MAST_STEP = 32, MAST_Y = 17.2, MAST_REACH = 3.6;
const MAST_STEEL: RGB = [70, 82, 84], MAST_LAMP: RGB = [255, 196, 120];
/** One flood-wall lamp mast at `along` on a side; tiered by distance (near: crossarm, two lamps,
 *  bollards and a mooring ring catching their light; mid: pole and one lamp; far: the lamp only). */
function wallMast(t: PropCanvas, view: ActivityView, alongX: boolean, sign: number, along: number): void {
  const across = sign * (WALL + 1), wx = alongX ? along : across, wz = alongX ? across : along;
  const distance = Math.hypot(view.x - wx, view.z - wz);
  if (distance < 320) { ink(t, MAST_STEEL, "|"); box(t, wx, 11, wz, 0.4, 12, 0.4); }
  if (distance >= 200) { ink(t, MAST_LAMP, "@"); box(t, wx, MAST_Y, wz, 1.1, 0.5, 1.1); return; }
  // Across-wall unit (dx, dz) pointing out to sea.
  const dx = alongX ? 0 : sign, dz = alongX ? sign : 0;
  ink(t, MAST_STEEL, "="); box(t, wx, MAST_Y + 0.4, wz, alongX ? 0.3 : 2 * MAST_REACH + 0.6, 0.3, alongX ? 2 * MAST_REACH + 0.6 : 0.3);
  ink(t, MAST_LAMP, "@");
  for (const s of [-1, 1]) box(t, wx + dx * s * MAST_REACH, MAST_Y, wz + dz * s * MAST_REACH, 0.9, 0.45, 0.9);
  if (distance >= 130) return;
  // Bollards on the quay either side of the mast and a mooring ring on the wall's sea face, warm in the lamps' light.
  const bollard = sign * (WALL - 1.4), ring = sign * (WALL + 2.06);
  ink(t, [204, 168, 124], "#");
  for (const s of [-1, 1]) box(t, alongX ? along + s * 6 : bollard, 0.45, alongX ? bollard : along + s * 6, 0.7, 1, 0.7);
  ink(t, [226, 192, 140], "o"); box(t, alongX ? along : ring, 2.4, alongX ? ring : along, alongX ? 0.8 : 0.1, 0.8, alongX ? 0.1 : 0.8);
}
function harbour(t: PropCanvas, view: ActivityView): void {
  for (const side of [0, 1, 2, 3]) {
    const alongX = side < 2, sign = side % 2 === 0 ? -1 : 1, lateral = sign * (WORLD_EDGE + QUAY_OUT / 2);
    for (let along = -WALL + 32; along < WALL; along += 64) {
      const x = alongX ? along : lateral, z = alongX ? lateral : along;
      if (Math.hypot(view.x - x, view.z - z) > 520) continue;
      const w = alongX ? 64 : QUAY_OUT, d = alongX ? QUAY_OUT : 64, wx = alongX ? along : sign * (WALL + 1), wz = alongX ? sign * (WALL + 1) : along;
      ink(t, [34, 42, 46], "="); box(t, x, -0.6, z, w, 1.1, d);
      ink(t, [52, 62, 64], "#"); box(t, wx, 2.2, wz, alongX ? 64 : 2, 5.6, alongX ? 2 : 64);
      ink(t, [92, 104, 98], "-"); box(t, wx, 5.1, wz, alongX ? 64 : 2.3, 0.2, alongX ? 2.3 : 64);
      // The water itself is the ground shader's harbour (harbour.ts / harbour-scene.ts), 1 m under the street plane.
      // Lamp masts on the flood wall every MAST_STEP m, lit warm (steady: no blinking).
      for (let mast = along; mast < along + 64 && mast <= WORLD_EDGE; mast += MAST_STEP) wallMast(t, view, alongX, sign, mast);
      if (((along + WALL) / 64 | 0) % 2 === 1) {
        // Between them, out in the water, a line of power pylons on caissons carrying the city's
        // feed along the coast: the far edge the Rim Line rides beside. Steady red tip lights.
        const px = alongX ? along : sign * (WALL + PYLON_OUT), pz = alongX ? sign * (WALL + PYLON_OUT) : along;
        ink(t, [40, 48, 52], "#"); box(t, px, -0.4, pz, 6, 2.2, 6);
        ink(t, [74, 86, 94], "X"); box(t, px, 13, pz, 3, 26, 3); box(t, px, 30, pz, 1.6, 8, 1.6);
        ink(t, [86, 98, 106], "="); box(t, px, 26.5, pz, alongX ? 1 : 16, 0.8, alongX ? 16 : 1); box(t, px, 32.5, pz, alongX ? 1 : 10, 0.6, alongX ? 10 : 1);
        ink(t, [255, 58, 52], "@"); box(t, px, 34.6, pz, 1.2, 1.2, 1.2);
      }
    }
  }
}

/** Rim yard landmarks (world.ts RIM_YARDS), seen from the train as it rounds each corner. */
function yard(t: PropCanvas, site: RimYard): void {
  t.push(); t.translate(site.x, 0, site.z);
  ink(t, [44, 52, 56], "="); box(t, 0, 0.4, 0, site.half * 2 + 2, 0.8, site.half * 2 + 2);
  if (site.kind === "mast") {
    // A tapering lattice mast with steady red aircraft lights and a lit antenna tip. Each 12 m
    // section is one solid lattice-textured block (thin members vanish between character cells at
    // the distances the ride sees it from), banded by a lit service ring every fourth section.
    for (let k = 0; k < 12; k++) {
      const w = 2.4 - k * 0.15, y = k * 12;
      ink(t, [96, 108, 122], "X"); box(t, 0, y + 6, 0, w * 2, 12, w * 2);
      ink(t, [80, 92, 104], "="); box(t, 0, y + 12, 0, w * 2 + 0.6, 0.5, w * 2 + 0.6);
      if (k % 4 === 3) {
        ink(t, [196, 214, 230], "=", 0.85); box(t, 0, y + 11.2, 0, w * 2 + 1.6, 0.4, w * 2 + 1.6);
        ink(t, [255, 58, 52], "@"); for (const dx of [-1, 1]) box(t, dx * (w + 0.9), y + 12.3, 0, 1.4, 1.4, 1.4);
      }
    }
    ink(t, [150, 170, 200], "|"); box(t, 0, 150, 0, 0.7, 12, 0.7);
    ink(t, [255, 70, 60], "@"); box(t, 0, 156.8, 0, 2, 2, 2);
    // Warm floodlights at the corners of the base slab, washing up the lattice (steady).
    ink(t, [255, 214, 150], "@"); for (const [x, z] of [[-3.2, -3.2], [-3.2, 3.2], [3.2, -3.2], [3.2, 3.2]]) box(t, x, 1.05, z, 0.5, 0.5, 0.5);
  } else if (site.kind === "crane") {
    // A harbour tower crane: mast, cab, a jib reaching back over the street, counterweights, hook.
    // The jib points diagonally across the corner toward the city: drawn along local +z.
    const top = 64, dx = -Math.sign(site.x), dz = -Math.sign(site.z);
    ink(t, [196, 150, 64], "#"); box(t, 0, top / 2, 0, 2.6, top, 2.6);
    ink(t, [255, 70, 60], "@"); box(t, 0, top + 3.2, 0, 0.7, 0.7, 0.7);
    t.push(); t.rotateY(Math.atan2(dx, dz) * DEG);
    ink(t, [214, 168, 72], "="); box(t, 0, top + 1.2, 14, 1.4, 1.4, 40);
    box(t, 0, top + 1.2, -7, 1.6, 1.6, 14);
    ink(t, [80, 88, 92], "#"); box(t, 0, top - 0.6, -12, 3.6, 2.6, 3.6);
    box(t, 0, top + 0.2, 26, 1.6, 0.6, 1.6); // trolley
    ink(t, [232, 222, 180], "="); box(t, 0, top - 2, 2.6, 2.4, 2.2, 2.4);
    ink(t, [255, 214, 140], "="); box(t, 0, top - 1.7, 3.84, 2, 0.9, 0.06); // lit cab window
    ink(t, [120, 128, 128], "|"); box(t, 0, top - 14, 26, 0.1, 28, 0.1);
    ink(t, [214, 168, 72], "#"); box(t, 0, top - 28.6, 26, 1.2, 1.2, 1.2);
    // Steady walkway lamps along the jib and a red light at its tip.
    ink(t, [255, 206, 130], "@"); for (const z of [8, 18, 28]) box(t, 0, top + 2.1, z, 0.5, 0.4, 0.5);
    ink(t, [255, 70, 60], "@"); box(t, 0, top + 2.2, 34, 0.7, 0.7, 0.7);
    t.pop();
  } else if (site.kind === "tank") {
    // A Rain Gardens water tower: a round tank on four legs with a lit gallery and ivy.
    ink(t, [74, 92, 86], "|"); for (const [x, z] of [[-6, -6], [-6, 6], [6, -6], [6, 6]]) box(t, x, 14, z, 0.9, 28, 0.9);
    ink(t, [64, 80, 74], "-"); for (const y of [9, 19]) { box(t, 0, y, -6, 12, 0.3, 0.3); box(t, 0, y, 6, 12, 0.3, 0.3); box(t, -6, y, 0, 0.3, 0.3, 12); box(t, 6, y, 0, 0.3, 0.3, 12); }
    ink(t, [92, 128, 112], "#"); t.translate(0, -36, 0); t.ellipsoid(9, 8, 9); t.translate(0, 36, 0);
    ink(t, [107, 226, 162], "=", 0.9); box(t, 0, 29, 0, 16, 0.25, 16);
    ink(t, [80, 150, 96], "%"); box(t, 0, 44.5, 0, 3, 1.4, 3);
  } else {
    // A Foundry furnace stack: banded brick chimney, glowing throat.
    for (let k = 0; k < 3; k++) { ink(t, [118, 70, 52], "#"); box(t, 0, k * 24 + 12, 0, 7 - k * 1.4, 24, 7 - k * 1.4); }
    ink(t, [72, 60, 56], "="); for (const y of [24, 48]) box(t, 0, y, 0, 7.6 - (y / 24) * 1.4, 0.8, 7.6 - (y / 24) * 1.4);
    ink(t, [255, 143, 77], "@"); box(t, 0, 72.3, 0, 4.4, 0.6, 4.4);
    ink(t, [255, 96, 60], "*", 0.8); box(t, 0, 73.2, 0, 3.4, 1.2, 3.4);
  }
  t.pop();
}

/** `signsOnly` (mobile perf, used by the engine's SignCanvas passes): skip the parts that draw no letter
 *  panels - the viaduct and the distant, undetailed carriages. Output on a SignCanvas is identical. */
export function drawMetroScene(t: PropCanvas, view: ActivityView, metroTime: number, passengerTrain: number | null, liftStation: number | null, liftHeight: number, signsOnly = false): void {
  const outer = propRange(560);
  if (!signsOnly) {
    for (const segment of DECK_SEGMENTS) {
      if (Math.abs(view.x - segment.x) > 560 || Math.abs(view.z - segment.z) > 560 || Math.hypot(view.x - segment.x, view.z - segment.z) > 560) continue;
      t.push(); t.translate(segment.x, -segment.y, segment.z); t.rotateY(segment.yaw); t.rotateX(-segment.pitch);
      ink(t, [51, 74, 83], "="); box(t, 0, 0, 0, 3.7, 1.5, segment.length + 0.2);
      ink(t, [91, 140, 143], "-", 0.7);
      for (const u of [-1.3, 1.3]) box(t, u, 0.87, 0, 0.13, 0.13, segment.length + 0.2);
      t.pop();
    }
    propRange(300);
    RAIL_SUPPORTS.forEach((support, i) => { if (Math.hypot(view.x - support.x, view.z - support.z) < 300) railSupport(t, support, SUPPORT_SOFFITS[i]); });
    // The harbour and the yards only matter near the edge; the yards' landmarks show from far off.
    if (Math.max(Math.abs(view.x), Math.abs(view.z)) > WORLD_EDGE - 520) { propRange(520); harbour(t, view); }
    propRange(900);
    for (const site of RIM_YARDS) if (Math.hypot(view.x - site.x, view.z - site.z) < 900) yard(t, site);
    propRange(560);
  }
  propRange(400);
  for (const station of STATIONS) {
    const distance = Math.hypot(view.x - station.x, view.z - station.z);
    if (distance < 400) stationScene(t, station, metroTime, liftStation === station.index ? liftHeight : 0, distance, view.rain, signsOnly);
  }
  for (let id = 0; id < TRAIN_COUNT; id++) {
    const train = trainAt(metroTime, id), distance = Math.hypot(view.x - train.x, view.z - train.z), ridden = passengerTrain === id;
    if ((distance < 530 && (!signsOnly || distance < 150)) || ridden) carriage(t, train, distance < 150 || ridden, distance < 40 || ridden, metroTime);
  }
  restorePropRange(outer);
}
