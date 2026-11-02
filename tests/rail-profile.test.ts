import assert from "node:assert/strict";
import test from "node:test";
import { DWELL, LINES, STATIONS, SUPPORT_SOFFITS, TRAIN_COUNT, TRAINS_PER_LINE, deckHeight, floorHeight, lineDistance, linePose, trainAt, wrapTrack } from "../src/city/metro.ts";
import { LINE_DECK_HEIGHT, RAIL_DECK_HALF, RAIL_SUPPORTS } from "../src/city/world.ts";

// Monorail deck height profile (metro.ts LINE_HUMPS): level at every station, smooth between them,
// and gentle enough for a first-person rider whose eye follows the floor (motion comfort).

test("every station sits at its line's base height with at least 70 m of level track either side", () => {
  for (const station of STATIONS) {
    const line = LINES[station.line];
    assert.equal(station.height, line.platform);
    for (let s = -70; s <= 70; s += 0.5) {
      const pose = linePose(line.id, station.track + s);
      assert.equal(pose.rise, 0, `${station.name} ${s} m`);
      assert.equal(pose.grade, 0, `${station.name} ${s} m`);
    }
  }
  // A train standing at a platform is level with it, doors to doors.
  for (let id = 0; id < TRAIN_COUNT; id++) for (let time = 0; time < LINES[Math.floor(id / TRAINS_PER_LINE)].cycle; time += 0.5) {
    const train = trainAt(time, id);
    if (train.station === null) continue;
    assert.equal(train.floor, STATIONS[train.station].height);
    for (const v of [-21, 0, 21]) assert.equal(floorHeight(train, v), STATIONS[train.station].height);
  }
});

test("the deck rises and dips smoothly: continuous height and grade, grades the slope of the height", () => {
  for (const line of LINES) {
    let previous = linePose(line.id, 0), low = 0, high = 0;
    for (let d = 0.25; d <= line.length; d += 0.25) {
      const pose = linePose(line.id, d);
      assert.ok(Math.abs(pose.rise - previous.rise) < 0.03, `${line.name} height jumps at ${d}`);
      assert.ok(Math.abs(pose.grade - previous.grade) < 0.002, `${line.name} grade jumps at ${d}`);
      const slope = (linePose(line.id, d + 0.01).rise - linePose(line.id, d - 0.01).rise) / 0.02;
      assert.ok(Math.abs(slope - pose.grade) < 1e-4, `${line.name} grade matches the slope at ${d}`);
      assert.ok(Math.abs(pose.grade) < 0.075, `${line.name} grade ${pose.grade} at ${d}`);
      low = Math.min(low, pose.rise); high = Math.max(high, pose.rise);
      previous = pose;
    }
    // Visible relief on both lines; the Rim Line's longer legs carry the bigger humps.
    assert.ok(high >= (line.id === 0 ? 6 : 10) && low <= (line.id === 0 ? -2 : -5), `${line.name} relief ${low}..${high}`);
    assert.ok(line.floorRange[0] <= line.platform + low && line.floorRange[1] >= line.platform + high);
  }
});

test("riders feel gentle vertical motion at real train speeds, everywhere in the carriage", () => {
  const dt = 0.05;
  for (let id = 0; id < TRAIN_COUNT; id++) {
    const line = LINES[Math.floor(id / TRAINS_PER_LINE)];
    let worstSpeed = 0, worstAcceleration = 0;
    for (const v of [-21.5, 0, 21.5]) {
      const floor = (time: number) => floorHeight(trainAt(time, id), v);
      for (let time = 0; time < line.cycle; time += dt) {
        const before = floor(time - dt), now = floor(time), after = floor(time + dt);
        worstSpeed = Math.max(worstSpeed, Math.abs(after - before) / (2 * dt));
        worstAcceleration = Math.max(worstAcceleration, Math.abs(after - 2 * now + before) / (dt * dt));
      }
    }
    assert.ok(worstSpeed < 2.5, `train ${id}: vertical speed ${worstSpeed.toFixed(2)} m/s`);
    assert.ok(worstAcceleration < 0.9, `train ${id}: vertical acceleration ${worstAcceleration.toFixed(2)} m/s^2`);
  }
});

test("every support and leg reaches the deck above it, wherever the deck has risen or dipped", () => {
  RAIL_SUPPORTS.forEach((support, i) => {
    const distance = lineDistance(support.line, support.x, support.z), pose = linePose(support.line, distance);
    assert.ok(Math.hypot(pose.x - support.x, pose.z - support.z) < 1e-6, "the support stands under the track");
    assert.ok(Math.abs(SUPPORT_SOFFITS[i] - (LINE_DECK_HEIGHT[support.line] + pose.rise - RAIL_DECK_HALF)) < 1e-9);
    assert.ok(Math.abs(SUPPORT_SOFFITS[i] - (deckHeight(support.line, distance) - RAIL_DECK_HALF)) < 1e-9);
  });
  // Some legs really do differ from the base height (the profile reached the supports).
  for (const line of LINES) {
    const soffits = SUPPORT_SOFFITS.filter((_, i) => RAIL_SUPPORTS[i].line === line.id);
    assert.ok(Math.max(...soffits) - Math.min(...soffits) > 6, `${line.name} legs vary`);
  }
});

test("timetables are unchanged by the profile: stops, dwell and continuous motion on both lines", () => {
  for (let id = 0; id < TRAIN_COUNT; id++) {
    const line = LINES[Math.floor(id / TRAINS_PER_LINE)], stops = new Set<number>();
    let dwelling = 0;
    for (let time = 0; time < line.cycle; time += 0.1) {
      const train = trainAt(time, id), next = trainAt(time + 0.1, id);
      assert.equal(train.line, line.id);
      assert.ok(Math.hypot(next.x - train.x, next.z - train.z, next.floor - train.floor) < 4.1, "no jumps");
      assert.ok(Math.abs(wrapTrack(next.distance - train.distance + line.length / 2, line.length) - line.length / 2) < 4.1);
      if (train.station !== null) { stops.add(train.station); dwelling++; }
    }
    assert.equal(stops.size, line.stops.length, `train ${id} serves every station of the ${line.name}`);
    assert.ok(Math.abs(dwelling * 0.1 - line.stops.length * DWELL) < line.stops.length * 0.25);
  }
});
