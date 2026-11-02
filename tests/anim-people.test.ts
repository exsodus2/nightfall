import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { drawHuman, FigureMotions, FORGET_SECONDS, GAIT_SECONDS, HEAD_LEAD, SIT_SECONDS, TURN_RATE, wrapAngle, type HumanPaint, type HumanPose, type MotionTargets } from "../src/city/human-model.ts";
import { MESH_BOX, MESH_SPHERE, PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import { BENCH, BENCH_PARTS } from "../src/city/metro.ts";
import type { NpcLook } from "../src/city/npcs.ts";
import type { Citizen } from "../src/city/people.ts";

// people-scene.ts pulls in the activity layer, which may still use extensionless imports.
register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { drawCitizen, easedCitizens, RIDER_SEAT } = await import("../src/city/people-scene.ts");

const LOOK: NpcLook = { coat: [170, 75, 110], trim: [55, 62, 75], skin: [186, 144, 109], light: [86, 220, 226], headwear: "hood", idle: "breathe", prop: null };
const paint: HumanPaint = (canvas, color, glyph, gain = 1) => { canvas.char(glyph); canvas.charColor(color[0] * gain, color[1] * gain, color[2] * gain); canvas.cellColor(0, 0, 0); };
const record = () => new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
const targets = (extra: Partial<MotionTargets> = {}): MotionTargets => ({ yaw: 0, glance: 0, gait: 0, talk: 0, sit: 0, hold: 0, phone: 0, ...extra });
const packed = (recorder: PropRecorder) => recorder.data.map((data, mesh) => Array.from(data.slice(0, recorder.counts[mesh] * PROP_STRIDE)));
const human = (pose: Partial<HumanPose>, look: NpcLook = LOOK) => { const recorder = record(); drawHuman(recorder, look, { time: 12, seed: 4, stride: 0.9, moving: false, detail: true, ...pose }, paint); return recorder; };
const citizen = (extra: Partial<Citizen>): Citizen => ({ id: 101, x: 0, y: 0, z: 0, yaw: 0, state: "walking", moving: false, seated: false, umbrella: false, occupation: "resident", goal: "", ...extra });

test("the displayed yaw never turns faster than the cap, takes the short way round, and settles", () => {
  for (const dt of [1 / 144, 1 / 60, 1 / 24, 0.1]) {
    const motions = new FigureMotions<number>();
    let time = 10, yaw = motions.update(1, time, 0, 0, targets()).yaw;
    for (const goal of [Math.PI / 2, -Math.PI / 2, Math.PI, 0.3, -2.9, 2.9]) {
      let travelled = 0;
      for (let step = 0; step < Math.round(2 / dt); step++) {
        time += dt;
        const shown = motions.update(1, time, 0, 0, targets({ yaw: goal }));
        const turn = Math.abs(wrapAngle(shown.yaw - yaw));
        assert.ok(turn <= TURN_RATE * dt + 1e-9, `turned ${turn} rad in ${dt} s`);
        assert.ok(Math.abs(shown.head) <= HEAD_LEAD + 1e-9, "the head leads by at most 30 degrees");
        travelled += turn; yaw = shown.yaw;
      }
      assert.ok(Math.abs(wrapAngle(yaw - goal)) < 1e-3, `settles on ${goal} at dt ${dt}`);
      if (goal === 2.9) assert.ok(travelled < 0.49, "-2.9 to 2.9 turns the short way (0.48 rad), not round");
    }
  }
});

test("a turn looks the same at any frame rate", () => {
  const after = (dt: number): number => {
    const motions = new FigureMotions<number>();
    let time = 0; motions.update(1, time, 0, 0, targets());
    let yaw = 0;
    while (time < 0.4 - 1e-9) { time += dt; yaw = motions.update(1, time, 0, 0, targets({ yaw: Math.PI / 2 })).yaw; }
    return yaw;
  };
  assert.ok(Math.abs(after(1 / 120) - after(1 / 24)) < 0.06);
  assert.ok(Math.abs(after(1 / 120) - after(1 / 60)) < 0.02);
});

test("a newcomer starts at its logical state, and a teleport or a long gap restarts it there", () => {
  const motions = new FigureMotions<number>();
  const first = motions.update(7, 3, 10, 10, targets({ yaw: 2, gait: 1, sit: 1, hold: 1 }));
  assert.ok(Math.abs(first.yaw - 2) < 1e-12 && first.gait === 1 && Math.abs(first.sit - 1) < 1e-12 && first.hold === 1 && first.head === 0, "no spin-in, no ramp-in");
  // Still within its first frame (the mirror pass draws it again): it is still new.
  assert.ok(Math.abs(motions.update(7, 3, 10, 10, targets({ yaw: -1 })).yaw + 1) < 1e-12);
  motions.update(7, 3.05, 10.1, 10, targets({ yaw: -1, gait: 1 }));
  const turning = motions.update(7, 3.1, 10.2, 10, targets({ yaw: -1 + Math.PI / 2, gait: 1 }));
  assert.ok(Math.abs(wrapAngle(turning.yaw + 1)) <= TURN_RATE * 0.05 + 1e-9, "a snap of the logical yaw is eased");
  const jumped = motions.update(7, 3.15, 30, 10, targets({ yaw: 0.5 }));
  assert.ok(Math.abs(jumped.yaw - 0.5) < 1e-12 && jumped.gait === 0, "a jump of more than 3 m restarts at the logical state");
  assert.ok(Math.abs(motions.update(7, 9, 30, 10, targets({ yaw: 1.5 })).yaw - 1.5) < 1e-12, "so does a long gap without being drawn");
});

test("drawing the same frame twice (mirror and main pass) gives the same display", () => {
  const motions = new FigureMotions<number>();
  motions.update(3, 1, 0, 0, targets({ gait: 1 }));
  motions.update(3, 1.02, 0, 0, targets({ gait: 1 }));
  const first = { ...motions.update(3, 1.04, 0, 0, targets({ yaw: 2, sit: 1, talk: 1 })) };
  const again = { ...motions.update(3, 1.04, 0, 0, targets({ yaw: 2, sit: 1, talk: 1 })) };
  assert.deepEqual(again, first);
});

/** Ramps target from 1 to 0 (or 0 to 1) and returns the eased weight each frame. */
function ramp(channel: "gait" | "sit", from: number, dt: number, seconds: number): number[] {
  const motions = new FigureMotions<number>(), seen: number[] = [];
  const goal = (value: number): MotionTargets => channel === "gait" ? targets({ gait: value }) : targets({ sit: value });
  let time = 0; motions.update(1, time, 0, 0, goal(from));
  for (let frame = 0; frame < Math.round(seconds / dt); frame++) { time += dt; seen.push(motions.update(1, time, 0, 0, goal(1 - from))[channel]); }
  return seen;
}

test("the gait weight ramps over a quarter second each way, eased, at any frame rate", () => {
  for (const dt of [1 / 120, 1 / 60, 1 / 30]) for (const from of [1, 0]) {
    const seen = ramp("gait", from, dt, 0.5), at = (seconds: number) => seen[Math.round(seconds / dt) - 1];
    let previous = from;
    for (const weight of seen) {
      assert.ok(from ? weight <= previous + 1e-12 : weight >= previous - 1e-12, "monotone");
      assert.ok(Math.abs(weight - previous) <= 1.5 * dt / GAIT_SECONDS + 1e-9, "no step larger than the eased ramp allows");
      previous = weight;
    }
    assert.ok(Math.abs(at(GAIT_SECONDS / 2) - 0.5) < 0.1, "half way at half the ramp");
    assert.ok(Math.abs(at(GAIT_SECONDS * 0.2) - from) > 0.04 && Math.abs(at(GAIT_SECONDS * 0.2) - from) < 0.25, "eased out of the start");
    assert.equal(at(GAIT_SECONDS + 2 * dt), 1 - from, "done just after 0.25 s");
  }
});

test("the seat blend takes 0.4 s on a raised cosine, both ways", () => {
  for (const dt of [1 / 120, 1 / 60, 1 / 30]) for (const from of [0, 1]) {
    const seen = ramp("sit", from, dt, 0.6), at = (seconds: number) => seen[Math.round(seconds / dt) - 1];
    const cosine = (seconds: number) => { const u = Math.min(1, seconds / SIT_SECONDS), k = 0.5 - 0.5 * Math.cos(Math.PI * u); return from ? 1 - k : k; };
    for (const seconds of [0.1, 0.2, 0.3]) assert.ok(Math.abs(at(seconds) - cosine(seconds)) < 0.02, `raised cosine at ${seconds} s`);
    assert.ok(Math.abs(at(SIT_SECONDS + 2 * dt) - (1 - from)) < 1e-12, "done just after 0.4 s");
    for (let index = 1; index < seen.length; index++) assert.ok(Math.abs(seen[index] - seen[index - 1]) <= Math.PI / 2 * dt / SIT_SECONDS + 1e-9);
  }
});

test("display state stays bounded: a cap on entries, and figures that left are forgotten", () => {
  const motions = new FigureMotions<number>(64);
  for (let id = 0; id < 500; id++) motions.update(id, 1, id, 0, targets());
  assert.ok(motions.size <= 64);
  for (let time = 1; time < 1 + FORGET_SECONDS + 1.5; time += 0.1) motions.update(0, time, 0, 0, targets());
  assert.equal(motions.size, 1);
  // The people layer's own map, through drawCitizen: thousands of passers-by over a minute.
  for (let second = 0; second < 60; second++) for (let k = 0; k < 120; k++) {
    drawCitizen(record(), citizen({ id: second * 120 + k, x: k * 4, moving: k % 2 === 0 }), 100 + second, false, false);
  }
  assert.ok(easedCitizens() <= 1024 && easedCitizens() < 400, `eased citizens ${easedCitizens()}`);
});

test("blend weights at their ends reproduce the existing poses exactly", () => {
  assert.deepEqual(packed(human({ moving: false, gait: 1 })), packed(human({ moving: true })));
  assert.deepEqual(packed(human({ moving: true, gait: 0 })), packed(human({ moving: false })));
  assert.deepEqual(packed(human({ talk: 1 })), packed(human({ talking: true })));
  assert.deepEqual(packed(human({ sit: 0, longCoat: true })), packed(human({ longCoat: true })));
  assert.deepEqual(packed(human({ sit: 0, distant: true })), packed(human({ distant: true })));
  assert.deepEqual(packed(human({ arms: "wrist", hold: 1 })), packed(human({ arms: "wrist" })));
  assert.deepEqual(packed(human({ arms: "carry", hold: 0 })), packed(human({})));
  assert.deepEqual(packed(human({ propHold: 1 }, { ...LOOK, prop: "umbrella" })), packed(human({}, { ...LOOK, prop: "umbrella" })));
});

/** Axis-aligned bounds of every recorded box (axes are full sizes) and ellipsoid (axes are radii;
 *  its exact half-extent is the length of each row), in person space (y up). */
function bounds(recorder: PropRecorder): { min: number[]; max: number[] }[] {
  const out: { min: number[]; max: number[] }[] = [];
  for (const mesh of [MESH_BOX, MESH_SPHERE]) for (let index = 0; index < recorder.counts[mesh]; index++) {
    const d = recorder.data[mesh], o = index * PROP_STRIDE;
    const centre = [d[o], -d[o + 1], d[o + 2]];
    const extent = [0, 1, 2].map(axis => mesh === MESH_BOX
      ? 0.5 * (Math.abs(d[o + 3 + axis]) + Math.abs(d[o + 6 + axis]) + Math.abs(d[o + 9 + axis]))
      : Math.hypot(d[o + 3 + axis], d[o + 6 + axis], d[o + 9 + axis]));
    out.push({ min: centre.map((value, axis) => value - extent[axis]), max: centre.map((value, axis) => value + extent[axis]) });
  }
  return out;
}

test("a seated rider stays clear of the bench and its neighbours' dividers, and feet stay planted while sitting", () => {
  const rider = (sit: number, extra: Partial<HumanPose> = {}, look: NpcLook = LOOK) => human({ sit, seatHeight: RIDER_SEAT.hip, thigh: RIDER_SEAT.thigh, ...extra }, look);
  for (const k of [-1, 0, 1]) {
    // Bench parts in the rider's frame: +z back toward the wall, +x their right (-v for a +1 side seat).
    const parts = BENCH_PARTS.map(part => ({ part: part.part, min: [-(part.v + part.d / 2) + k * BENCH.pitch, part.y - part.h / 2, part.u - part.w / 2 - BENCH.hip], max: [-(part.v - part.d / 2) + k * BENCH.pitch, part.y + part.h / 2, part.u + part.w / 2 - BENCH.hip] }));
    for (const headwear of ["hood", "visor", "cap", "bare", "mask"] as const) for (const extra of [{}, { longCoat: true }, { phoneLift: 1 }, { distant: true, detail: false }, { distant: true, detail: false, longCoat: true }]) {
      for (const seed of [3, 4]) for (const box of bounds(rider(1, { seed, ...extra }, { ...LOOK, headwear }))) for (const part of parts) {
        const overlaps = [0, 1, 2].every(axis => box.min[axis] < part.max[axis] - 0.005 && part.min[axis] < box.max[axis] - 0.005);
        assert.ok(!overlaps, `${headwear} ${JSON.stringify(extra)} seat ${k}: a part at [${box.min.map(v => v.toFixed(2))}]-[${box.max.map(v => v.toFixed(2))}] enters the ${part.part}`);
      }
    }
  }
  for (const sit of [0, 0.25, 0.5, 0.75, 1]) {
    const lowest = Math.min(...bounds(rider(sit)).map(box => box.min[1]));
    assert.ok(lowest > -0.06 && lowest < 0.1, `feet on the floor at sit ${sit} (lowest ${lowest.toFixed(3)})`);
  }
  const top = (sit: number) => Math.max(...bounds(rider(sit)).map(box => box.max[1]));
  assert.ok(top(1) < top(0) - 0.4, "seated is lower than standing");
});

/** Largest per-frame movement (m) of any recorded part across a scripted run at 60 fps. */
function largestStep(clock: number, seconds: number, at: (elapsed: number) => Partial<Citizen>, base: Partial<Citizen>): { step: number; compared: number; top: number } {
  let previous: number[][] | null = null, step = 0, compared = 0, top = 0;
  for (let frame = 0; frame <= Math.round(seconds * 60); frame++) {
    const elapsed = frame / 60, recorder = record();
    drawCitizen(recorder, citizen({ ...base, ...at(elapsed) }), clock + elapsed, true, false);
    const parts = [MESH_BOX, MESH_SPHERE].flatMap(mesh => Array.from({ length: recorder.counts[mesh] }, (_, index) => [mesh, recorder.data[mesh][index * PROP_STRIDE], recorder.data[mesh][index * PROP_STRIDE + 1], recorder.data[mesh][index * PROP_STRIDE + 2]]));
    top = Math.max(...parts.map(part => -part[2]));
    if (previous && previous.length === parts.length && previous.every((part, index) => part[0] === parts[index][0])) {
      compared++;
      for (let index = 0; index < parts.length; index++) step = Math.max(step, Math.hypot(parts[index][1] - previous[index][1], parts[index][2] - previous[index][2], parts[index][3] - previous[index][3]));
    }
    previous = parts;
  }
  return { step, compared, top };
}

test("citizens' bodies never pop: turns, stops, talk turns, greetings and sitting down all ease", () => {
  const corner = largestStep(200, 1.6, elapsed => ({ yaw: elapsed < 0.5 ? 0 : Math.PI / 2 }), { id: 211, moving: true });
  const stop = largestStep(210, 2, elapsed => ({ moving: elapsed < 0.5, ...(elapsed < 0.5 ? {} : { attentionYaw: Math.PI }) }), { id: 212 });
  const greeting = largestStep(220, 3, elapsed => (elapsed > 0.5 && elapsed < 2 ? { reaction: "greeting", attentionYaw: -Math.PI / 2 } : {}), { id: 214 });
  const chatter = largestStep(230, 16, () => ({}), { id: 217, role: "chatter" });
  const rider = largestStep(250, 2.4, elapsed => ({ seated: elapsed > 0.4 && elapsed < 1.4, yaw: elapsed > 0.4 ? Math.PI / 2 : 0 }), { id: 218, occupation: "commuter" });
  for (const [name, run, limit] of [["corner", corner, 0.15], ["stop", stop, 0.15], ["greeting", greeting, 0.15], ["chatter", chatter, 0.05], ["rider", rider, 0.15]] as const) {
    assert.ok(run.compared > 50, `${name}: frames compared`);
    assert.ok(run.step < limit, `${name}: a part moved ${run.step.toFixed(3)} m in one frame`);
  }
  const seated = largestStep(260, 1.2, () => ({ seated: true }), { id: 219, occupation: "commuter" });
  assert.ok(seated.top < 2.45, `a seated rider sits (top ${seated.top.toFixed(2)} m)`);
});
