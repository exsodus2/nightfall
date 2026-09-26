import type { PropCanvas } from "./prop-canvas";
import { cuboid as box, ink, propRange, restorePropRange, type ActivityView } from "./activity";
import { drawLetterPanel } from "./signage";
import { BENCH, BENCH_PARTS, PLATFORM_HEIGHT, STATIONS, TRACK_LENGTH, trackPose, trainAt, type Station, type Train } from "./metro";
import { RAIL_DECK_HEIGHT, RAIL_PORTAL_LATERAL, RAIL_SOFFIT, RAIL_SUPPORTS, STATION_COLUMN_HALF, STATION_COLUMN_U, STATION_COLUMN_V, type RailSupport, type RGB } from "./world";

// Upholstery stays below the material's emissive threshold (0.64) so it is lit, not glowing.
const BENCH_STYLE: Record<string, readonly [RGB, string]> = {
  base: [[50, 55, 63], "|"],
  cushion: [[142, 52, 78], "#"],
  back: [[118, 43, 67], "#"],
  rail: [[150, 128, 84], "="],
  end: [[110, 124, 124], "|"],
  divider: [[110, 124, 124], "="],
};

function stationScene(t: PropCanvas, station: Station, time: number, liftHeight: number): void {
  t.push(); t.translate(station.x, 0, station.z); t.rotateY(-station.yaw * 180 / Math.PI);
  const h = PLATFORM_HEIGHT;
  ink(t, [66, 83, 86], "="); box(t, 6.5, h - 0.7, 0, 7, 1.4, 53);
  ink(t, [239, 181, 76], "-"); box(t, 3.15, h + 0.04, 0, 0.35, 0.08, 52);
  ink(t, [38, 60, 66], "="); box(t, 6.5, h + 5.5, 0, 8.6, 0.6, 56);
  // Street columns: on the pavement, off the walking line and out of every carriageway (world.ts).
  ink(t, [72, 92, 97], "|");
  for (const v of STATION_COLUMN_V) box(t, STATION_COLUMN_U, h / 2, v, STATION_COLUMN_HALF * 2, h, STATION_COLUMN_HALF * 2);
  for (const v of [-24, -12, 12, 24]) {
    ink(t, [72, 92, 97], "|"); box(t, 9.5, h + 2.6, v, 0.35, 5.2, 0.35);
    ink(t, [234, 217, 159], "="); box(t, 6, h + 5.13, v, 4, 0.13, 0.36);
    ink(t, [63, 102, 108], "="); box(t, 8.6, h + 0.6, v + 3, 1.2, 0.25, 4);
    box(t, 9.2, h + 1.2, v + 3, 0.16, 1.2, 4);
  }
  ink(t, [82, 110, 117], "|");
  for (let v = -25; v <= 25; v += 2.5) box(t, 10, h + 0.7, v, 0.08, 1.4, 0.08);
  box(t, 10, h + 1.4, 0, 0.1, 0.1, 52);
  for (const end of [-26.5, 26.5]) box(t, 6.5, h + 1.4, end, 7, 0.1, 0.1);
  // Glass lift cage, open street and platform portals, visible moving cabin.
  ink(t, [72, 111, 120], "|");
  for (const u of [7.3, 10.7]) for (const v of [18.3, 21.7]) box(t, u, h / 2 + 2.4, v, 0.18, h + 4.8, 0.18);
  ink(t, [50, 74, 81], "="); box(t, 9, liftHeight - 0.12, 20, 3.4, 0.25, 3.4);
  box(t, 9, liftHeight + 3.4, 20, 3.4, 0.2, 3.4);
  ink(t, station.color, "="); box(t, 9, liftHeight + 3.26, 20, 2.9, 0.09, 2.9);
  ink(t, [239, 214, 153], "@"); box(t, 7.4, 1.5, 18.2, 0.24, 0.45, 0.12);
  box(t, 7.4, h + 1.5, 18.2, 0.24, 0.45, 0.12);
  drawLetterPanel(t, { x: 9, y: 4.5, z: 22, yaw: 0, width: 6, height: 1.7, text: "LIFT", color: station.color });
  for (const v of [-14, 14]) {
    drawLetterPanel(t, { x: 6.3, y: h + 4.5, z: v, yaw: 0, width: 6, height: 1.15, text: "CITY LOOP", color: [228, 211, 169] });
    drawLetterPanel(t, { x: 6.3, y: h + 3.3, z: v, yaw: 0, width: 6, height: 1, text: station.name.replace("The ", "").slice(0, 12), color: station.color });
  }
  // Signal changes with the timetable; doors are never an unrelated animation.
  const stopped = Array.from({ length: 4 }, (_, i) => trainAt(time, i)).some(train => train.station === station.index && train.doors > 0.85);
  ink(t, stopped ? [81, 238, 173] : [242, 102, 79], "@"); box(t, 3.3, h + 3.8, -25, 0.3, 0.4, 0.3);
  t.pop();
}

function carriage(t: PropCanvas, train: Train, detailed: boolean): void {
  const outer = propRange(530);
  t.push(); t.translate(train.x, -PLATFORM_HEIGHT, train.z); t.rotateY(-train.yaw * 180 / Math.PI);
  for (const center of [-15, 0, 15]) {
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
      ink(t, [62, 213, 203], "-", 0.85);
      box(t, side * 2.9, 0.35, center, 0.1, 0.16, 14);
      // Doors on the platform side only. Sliding leaves remain visible.
      const opening = side > 0 ? train.doors : 0;
      for (const leaf of [-1, 1]) {
        ink(t, [96, 127, 132], "|", 0.72);
        box(t, side * 2.83, 1.9, center + leaf * (0.65 + opening * 1.35), 0.13, 3.8, 1.26);
        ink(t, [146, 188, 181], "H", 0.65);
        box(t, side * 2.91, 2.45, center + leaf * (0.65 + opening * 1.35), 0.07, 1.25, 0.76);
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
        }
        ink(t, [205, 176, 109], "|");
        for (const v of [-1.65, 1.65]) box(t, side * 1.8, 2.05, center + v, 0.065, 4.1, 0.065);
        propRange(530);
      }
    }
    if (detailed) {
      propRange(150);
      ink(t, [243, 219, 163], "="); box(t, 0, 4.21, center, 0.65, 0.07, 11.6);
      ink(t, [142, 159, 153], "-"); box(t, 0, 3.7, center, 0.055, 0.055, 12.5);
      for (const v of [-5, -3, 3, 5]) {
        ink(t, [194, 173, 114], "O"); box(t, 0, 3.42, center + v, 0.28, 0.32, 0.055);
      }
      drawLetterPanel(t, { x: 0, y: 3.7, z: center - 6.8, yaw: 0, width: 2.3, height: 0.5, text: train.station === null ? "NEXT STOP" : "DOORS OPEN", color: [240, 188, 100] });
      propRange(530);
    }
  }
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
  ink(t, [251, 233, 177], "@");
  for (const side of [-1, 1]) box(t, side * 1.8, 0.7, -22.3, 0.75, 0.35, 0.12);
  ink(t, [241, 64, 70], "="); box(t, 0, 0.7, 22.3, 3, 0.22, 0.12);
  t.pop();
  restorePropRange(outer);
}

/** One viaduct support (world.ts RAIL_SUPPORTS): a portal frame straddling the street, legs on
 *  both pavements, crossbeam and knee brackets under the deck; or a single column with a pier cap. */
function railSupport(t: PropCanvas, support: RailSupport): void {
  ink(t, [49, 70, 78], "|");
  for (const leg of support.legs) box(t, leg.x, RAIL_SOFFIT / 2, leg.z, leg.half * 2, RAIL_SOFFIT, leg.half * 2);
  ink(t, [58, 83, 92], "=");
  if (!support.span) { box(t, support.x, RAIL_SOFFIT - 0.45, support.z, 3.4, 0.9, 3.4); return; }
  const across = RAIL_PORTAL_LATERAL * 2 + 1.3, alongX = support.span === "x";
  box(t, support.x, RAIL_SOFFIT - 0.75, support.z, alongX ? across : 1.5, 1.5, alongX ? 1.5 : across);
  for (const side of [-1, 1]) {
    const offset = side * (RAIL_PORTAL_LATERAL - 1.55);
    box(t, support.x + (alongX ? offset : 0), RAIL_SOFFIT - 2.1, support.z + (alongX ? 0 : offset), alongX ? 1.8 : 1.1, 1.2, alongX ? 1.1 : 1.8);
  }
}

/** `signsOnly` (mobile perf, used by the engine's SignCanvas passes): skip the parts that draw no letter
 *  panels - the viaduct and the distant, undetailed carriages. Output on a SignCanvas is identical. */
export function drawMetroScene(t: PropCanvas, view: ActivityView, metroTime: number, passengerTrain: number | null, liftStation: number | null, liftHeight: number, signsOnly = false): void {
  const outer = propRange(560);
  for (let distance = 0; distance < (signsOnly ? 0 : TRACK_LENGTH); distance += 12) {
    const a = trackPose(distance), b = trackPose(distance + 12);
    if (Math.hypot(view.x - a.x, view.z - a.z) > 560) continue;
    t.push(); t.translate((a.x + b.x) / 2, -RAIL_DECK_HEIGHT, (a.z + b.z) / 2); t.rotateY(-Math.atan2(b.x - a.x, a.z - b.z) * 180 / Math.PI);
    ink(t, [51, 74, 83], "="); box(t, 0, 0, 0, 3.7, 1.5, 12.2);
    ink(t, [91, 140, 143], "-", 0.7);
    for (const u of [-1.3, 1.3]) box(t, u, 0.87, 0, 0.13, 0.13, 12.2);
    t.pop();
  }
  if (!signsOnly) {
    propRange(300);
    for (const support of RAIL_SUPPORTS) if (Math.hypot(view.x - support.x, view.z - support.z) < 300) railSupport(t, support);
    propRange(560);
  }
  propRange(400);
  for (const station of STATIONS) if (Math.hypot(view.x - station.x, view.z - station.z) < 400) stationScene(t, station, metroTime, liftStation === station.index ? liftHeight : 0);
  for (let id = 0; id < 4; id++) {
    const train = trainAt(metroTime, id), distance = Math.hypot(view.x - train.x, view.z - train.z);
    if ((distance < 530 && (!signsOnly || distance < 150)) || passengerTrain === id) carriage(t, train, distance < 150 || passengerTrain === id);
  }
  restorePropRange(outer);
}
