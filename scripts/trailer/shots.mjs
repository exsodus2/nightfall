import { look, spline, points, tracking, smooth, smoother, linear, easeOut, easeIn } from "./camera.mjs";
import { trainAt } from "../../src/city/metro.ts";

// Every shot of the trailer. `seconds` includes a short tail handle for dissolves; the cut list in
// edit.mjs decides what is used. `clock` is the simulation time at the first frame (it seeds traffic,
// residents and the monorail timetable), `pose(u)` the camera over u in [0, 1], or `frame(u, s)` raw
// page JS for shots that drive the game itself.
const FPS = 60;
const room = (id, path) => u => `window.__trailer.room(${JSON.stringify(id)}, ${JSON.stringify(path(u))})`;
const key = (type, code) => `window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { code: ${JSON.stringify(code)} }));`;

// Monorail: the train's pose at a shot frame (metro time advances 1/FPS per frame before drawing).
const train = (clock, seconds, id) => u => trainAt(clock + (u * seconds * FPS + 1) / FPS, id);

const SPIRE = [32, 0, -160];

export const SHOTS = [
  // ACT I - arrival
  { name: "s01-market-crane", seconds: 7.25, clock: 64,
    pose: tracking(points([[11.5, 15, 104], [11.5, 7, 92], [11, 2.9, 82]], smoother), points([[6, 0, 40], [5, 2, -20], [4, 5, -110]], smoother)) },
  { name: "s02-holo-globe", seconds: 5.75, clock: 70,
    pose: tracking(points([[15, 37, -110], [9, 47, -142]], smooth), points([[-9, 49, -175], [-10, 52, -174]], smooth)) },
  { name: "s03-neon-aerial", seconds: 5.75, clock: 75,
    pose: spline([[-178, 160, -122, 0.66, 0.36], [-152, 150, -148, 0.72, 0.34]], smooth) },
  // ACT II - the living city
  { name: "s04-crossing", seconds: 4.5, clock: 80,
    pose: spline([[-13, 3.2, 12.5, 0.64, -0.02], [-7, 3.1, 8, 0.8, -0.03]], smooth) },
  { name: "s05-monorail", seconds: 4.5, clock: 59.5,
    pose: u => { const x = 128 + 32 * u; return look([x, 33.5 - 0.8 * u, -327.2], [x + 80, 30.2, -321]); } },
  { name: "s06-carriage", seconds: 3.25, clock: 61, setup: `window.__nightfall.inspect({ kind: "view", id: "carriage" })`, frame: () => "" },
  { name: "s07-drive", seconds: 4.5, clock: 85, preroll: 2.4, drive: { x: -10.4, z: 146.5 } },
  { name: "s08-kiln", seconds: 3.25, clock: 90, frame: room("kiln", spline([[2.2, 2.0, 5.5, -0.22, 0.06], [0.8, 2.3, 2.6, -0.08, 0.04]], smooth)) },
  { name: "s09-holo-jelly", seconds: 4.5, clock: 95,
    pose: tracking(points([[17, 46, 79], [6, 53, 70]], smooth), points([[-11, 55, 45], [-11, 56, 45]], smooth)) },
  { name: "s10-last-tree", seconds: 4.5, clock: 100,
    pose: tracking(points([[-550, 3.0, 219], [-536, 3.6, 233]], smooth), points([[-480, 13, 288], [-480, 15, 288]], smooth)) },
  { name: "s11-memory-gate", seconds: 4.5, clock: 105,
    pose: tracking(points([[1.5, 2.9, 274], [0.5, 3.4, 250]], smooth), points([[0, 9, 200], [0, 9.5, 200]], smooth)) },
  { name: "s12-ember", seconds: 3.25, clock: 110,
    pose: tracking(points([[-444, 43, -233], [-453, 47, -236]], smooth), points([[-480, 22, -288], [-480, 21, -288]], smooth)) },
  // ACT III - rise (fast)
  { name: "s13-fly-canyon", seconds: 3.25, clock: 115,
    pose: tracking(points([[0, 26, -10], [0, 20, -135]], linear), points([[0, 16, -260], [0, 14, -400]], linear)) },
  { name: "s14-holo-bust", seconds: 3.25, clock: 120,
    pose: tracking(points([[-47, 50, -246], [-52, 58, -251]], smooth), points([[-64, 57, -275], [-67.5, 58, -275]], smooth)) },
  { name: "s15-skim", seconds: 3.25, clock: 125,
    pose: spline([[512, 2.75, -380, 0.0, -0.02], [512, 2.75, -470, 0.0, -0.02]], linear) },
  { name: "s16-cockpit", seconds: 2.0, clock: 128, preroll: 2.2, drive: { x: 10.4, z: 91, view: "cockpit", boost: true } },
  { name: "s17-silk-air", seconds: 2.0, clock: 135, pose: spline([[0, 64, 430, 0, 0.22], [0, 58, 405, 0, 0.2]], linear) },
  { name: "s18-spillway", seconds: 2.0, clock: 140, pose: spline([[610, 124, 510, -0.72, 0.36], [590, 118, 488, -0.7, 0.35]], linear) },
  { name: "s19-neon-street", seconds: 2.0, clock: 145, pose: spline([[0, 2.9, -395, 0, -0.06], [0, 2.9, -415, 0, -0.07]], linear) },
  { name: "s20-dive", seconds: 2.75, clock: 150,
    pose: tracking(points([[30, 150, -40], [14, 70, -70]], easeIn), points([[0, 0, -120], [0, 0, -140]], linear)) },
  // ACT IV - finale
  { name: "s21-finale", seconds: 10.5, clock: 155,
    pose: tracking(points([[1, 2.9, -58], [-4, 66, -66], [-24, 124, -92]], smoother), points([[30, 30, -160], [32, 90, -160], [32, 128, -160]], smoother)) },
];

// Shots that drive the real game: a parked car on the avenue, chase camera, foot on the throttle.
for (const shot of SHOTS) if (shot.drive) {
  const { x, z, view = "chase", boost = false } = shot.drive;
  shot.setup = `(() => { const n = window.__nightfall; localStorage.setItem("nightfall.driveView", "${view}");
    n.inspect({ kind: "camera", x: ${x + 1.6 * Math.sign(x || 1) * -1}, height: 2.7, z: ${z}, yaw: 0, pitch: 0 }); n.play(); ${key("keydown", "KeyE")} ${key("keyup", "KeyE")} ${key("keydown", "KeyW")} ${boost ? key("keydown", "ShiftLeft") : ""} })()`;
  shot.frame = () => "";
  shot.teardown = `${key("keyup", "KeyW")} ${key("keyup", "ShiftLeft")} ${key("keydown", "Escape")} ${key("keyup", "Escape")}`;
}

