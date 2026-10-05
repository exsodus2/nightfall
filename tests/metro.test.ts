import assert from "node:assert/strict";
import test from "node:test";
import { STATIONS, TRACK_LENGTH, METRO_CYCLE, trackPose, trainAt, boardingTrain, localToWorld, worldToLocal, moveInTrain, canWalkInTrain, doorAt, BENCH, BENCH_PARTS, BENCHES, CARRIAGE_CENTERS, SEATS, SEATED_BODY, SEATED_POSE, seatedBox, seatedYaw, type FurnitureBox, SEAT_LOOK, SEAT_REACH, SEATED_EYE_HEIGHT, TRAIN_EYE_HEIGHT, clampSeatedLook, nearestFreeSeat, seatStand, seatTurnSeconds, seatedEye, windowYaw } from "../src/city/metro.ts";
import { CityPopulation } from "../src/city/people.ts";
import { CityWorld } from "../src/city/world.ts";

test("rounded track preserves position and tangent, including the loop seam", () => {
  for (let d = 0; d < TRACK_LENGTH; d += 0.3) {
    const a = trackPose(d), b = trackPose(d + 0.1);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) <= 0.10001);
    assert.ok(Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw))) < 0.002);
  }
  assert.deepEqual(trackPose(TRACK_LENGTH), trackPose(0));
});
test("every train stops at every station with zero speed before opening doors", () => {
  for (let id = 0; id < 4; id++) {
    const stops = new Set<number>();
    for (let time = 0; time < METRO_CYCLE; time += 0.08) {
      const train = trainAt(time, id), next = trainAt(time + 0.01, id);
      assert.ok(Math.hypot(train.x - next.x, train.z - next.z) < 0.4);
      if (train.doors > 0) { assert.equal(train.speed, 0); assert.notEqual(train.station, null); stops.add(train.station!); }
      if (train.station !== null) { const stop = STATIONS[train.station]; assert.ok(Math.hypot(train.x - stop.x, train.z - stop.z) < 0.001); }
    }
    assert.equal(stops.size, 6);
  }
});
test("boarding uses the same stopped train and requires fully open doors", () => {
  assert.equal(boardingTrain(0, 0), undefined);
  const train = boardingTrain(3, 0);
  assert.equal(train?.id, 0);
  assert.equal(train?.doors, 1);
  assert.equal(boardingTrain(13.5, 0), undefined);
  assert.equal(boardingTrain(17, 0), undefined);
});
test("passenger coordinates remain attached around every track curve", () => {
  for (let d = 0; d < TRACK_LENGTH; d += 1.7) {
    const pose = trackPose(d), point = localToWorld(pose, 1.1, 17.4), local = worldToLocal(pose, point.x, point.z);
    assert.ok(Math.abs(local.u - 1.1) < 1e-10);
    assert.ok(Math.abs(local.v - 17.4) < 1e-10);
  }
});
test("all three carriages have a connected aisle with solid seats, sides and ends", () => {
  const passenger = { train: 0, u: 0, v: 20, yaw: 0 };
  for (let i = 0; i < 600; i++) moveInTrain(passenger, 0, 1, 0, 1 / 60);
  assert.ok(passenger.v < -21 && passenger.v >= -21.7);
  assert.equal(canWalkInTrain(2, 5), false);
  assert.equal(canWalkInTrain(2, 0), true);
  assert.equal(canWalkInTrain(3, 0), false);
  assert.equal(doorAt(15), true);
  assert.equal(doorAt(7.5), false);
});
test("all street lift entrances are reachable outside building collisions", () => {
  const world = new CityWorld();
  for (const station of STATIONS) {
    const entrance = localToWorld(station, 9, 20);
    assert.ok(world.canOccupy(entrance.x, entrance.z), station.name);
  }
});

const overlaps = (a: FurnitureBox, b: FurnitureBox): boolean =>
  Math.abs(a.u - b.u) * 2 < a.w + b.w - 1e-6 && Math.abs(a.y - b.y) * 2 < a.h + b.h - 1e-6 && Math.abs(a.v - b.v) * 2 < a.d + b.d - 1e-6;
const span = (b: FurnitureBox, axis: "u" | "y" | "v"): [number, number] => {
  const size = axis === "u" ? b.w : axis === "y" ? b.h : b.d;
  return [b[axis] - size / 2, b[axis] + size / 2];
};
test("seated riders sit on solid benches, not through them, one per seat in every carriage", () => {
  assert.equal(SEATS.length, 36);
  assert.equal(new Set(SEATS.map(seat => `${seat.u},${seat.v}`)).size, SEATS.length, "every seat is a distinct place");
  const furniture: FurnitureBox[] = BENCHES.flatMap(bench => BENCH_PARTS.map(part => ({ ...part, u: bench.side * part.u, v: bench.v + part.v })));
  for (const center of CARRIAGE_CENTERS) for (const side of [-1, 1]) for (const v of [-1.65, 1.65]) furniture.push({ part: "pole", u: side * 1.8, y: 2.05, v: center + v, w: 0.065, h: 4.1, d: 0.065 });
  const bodies = SEATS.map(seat => [...SEATED_POSE, ...SEATED_BODY].map(box => seatedBox(box, seat.u, seat.v, seat.side)));
  SEATS.forEach((seat, i) => {
    const body = bodies[i], part = (name: string) => body.filter(box => box.part === name);
    for (const box of body) {
      for (const solid of furniture) assert.ok(!overlaps(box, solid), `seat ${i} ${box.part} passes through the ${solid.part}`);
      const [inner, outer] = span(box, "u").map(u => u * seat.side).sort((a, b) => a - b);
      assert.ok(outer <= BENCH.back + 1e-9 && inner > 0.9, `seat ${i} ${box.part} stays between the backrest and the aisle`);
      assert.ok(span(box, "y")[0] >= -1e-9, `seat ${i} ${box.part} stays above the floor`);
      assert.ok(!doorAt(span(box, "v")[0]) && !doorAt(span(box, "v")[1]), `seat ${i} keeps the doorway clear`);
    }
    // Hips and thighs rest on the cushion top, feet on the floor, back against the backrest.
    const cushion = furniture.find(solid => solid.part === "cushion" && Math.sign(solid.u) === seat.side && Math.abs(solid.v - seat.v) < BENCH.length / 2)!;
    assert.ok(Math.abs(span(part("torso")[0], "y")[0] - span(cushion, "y")[1]) < 1e-9, "hips on the cushion");
    for (const thigh of part("thigh")) {
      assert.ok(Math.abs(span(thigh, "y")[0] - span(cushion, "y")[1]) < 1e-9, "thighs on the cushion");
      const [a, b] = span(thigh, "u"), [c, d] = span(cushion, "u");
      assert.ok(Math.min(b, d) - Math.max(a, c) > 0.4, "thighs lie along the seat");
    }
    for (const foot of part("foot")) assert.ok(Math.abs(span(foot, "y")[0]) < 1e-9, "feet on the floor");
    assert.ok(BENCH.back - Math.max(...span(part("torso")[0], "u").map(u => u * seat.side)) < 0.05, "back against the backrest");
    // Facing the aisle: the person's forward vector points to the carriage centre line.
    for (const yaw of [0, 1.1, Math.PI, 4.2]) {
      const pose = { x: 10, z: -4, yaw }, at = localToWorld(pose, seat.u, seat.v), inward = localToWorld(pose, seat.u - seat.side, seat.v);
      const facing = seatedYaw(yaw, seat.side);
      assert.ok(Math.abs(Math.sin(facing) - (inward.x - at.x)) < 1e-9 && Math.abs(-Math.cos(facing) - (inward.z - at.z)) < 1e-9, "seated riders face the aisle");
    }
    for (let j = i + 1; j < SEATS.length; j++) for (const a of body) for (const b of bodies[j]) assert.ok(!overlaps(a, b), `seats ${i} and ${j} overlap`);
  });
});

// Monorail seats: the player sits on a free bench seat and looks out of the window.
test("the player's seated eye is inside the carriage, clear of benches and poles, at the open window", () => {
  const furniture: FurnitureBox[] = BENCHES.flatMap(bench => BENCH_PARTS.map(part => ({ ...part, u: bench.side * part.u, v: bench.v + part.v })));
  for (const center of CARRIAGE_CENTERS) for (const side of [-1, 1]) for (const v of [-1.65, 1.65]) furniture.push({ part: "pole", u: side * 1.8, y: 2.05, v: center + v, w: 0.065, h: 4.1, d: 0.065 });
  const near = 0.12; // the camera's near plane: nothing solid may come closer than this
  assert.ok(SEATED_EYE_HEIGHT < TRAIN_EYE_HEIGHT - 0.2, "sitting lowers the eye");
  for (const seat of SEATS) {
    const eye = seatedEye(seat), stand = seatStand(seat);
    assert.equal(Math.sign(eye.u), seat.side, `seat ${seat.index} eye on the seat's side`);
    assert.ok(Math.abs(eye.v - seat.v) < 1e-9 && Math.abs(eye.u) < 2.8 - near, `seat ${seat.index} eye inside the sidewall`);
    // Window opening between the lower wall panel (top 1.2) and the upper one (from 3.68).
    assert.ok(eye.y > 1.2 && eye.y < 3.68 && eye.y === SEATED_EYE_HEIGHT, `seat ${seat.index} eye at the window`);
    for (const solid of furniture) {
      const inside = Math.abs(eye.u - solid.u) < solid.w / 2 + near && Math.abs(eye.y - solid.y) < solid.h / 2 + near && Math.abs(eye.v - solid.v) < solid.d / 2 + near;
      assert.ok(!inside, `seat ${seat.index} eye clips the ${solid.part}`);
    }
    // Standing up lands on the walkable aisle right in front of the seat, clear of the doorway.
    assert.ok(canWalkInTrain(stand.u, stand.v), `seat ${seat.index} aisle spot is walkable`);
    assert.ok(Math.abs(stand.v - seat.v) < 1e-9 && Math.sign(stand.u) === seat.side && Math.abs(stand.u) < BENCH.front, `seat ${seat.index} aisle spot in front of the bench`);
    assert.ok(!doorAt(stand.v), `seat ${seat.index} aisle spot is not in a doorway`);
  }
});
test("the seated view looks straight out of the seat's own window, opposite the aisle-facing riders", () => {
  for (const trainYaw of [0, 1.1, Math.PI, 4.2, 7.5]) for (const side of [-1, 1] as const) {
    const pose = { x: -30, z: 12, yaw: trainYaw }, at = localToWorld(pose, 0, 0), out = localToWorld(pose, side, 0);
    const yaw = windowYaw(trainYaw, side);
    assert.ok(Math.abs(Math.sin(yaw) - (out.x - at.x)) < 1e-9 && Math.abs(-Math.cos(yaw) - (out.z - at.z)) < 1e-9, "faces the side window");
    const back = seatedYaw(trainYaw, side) + Math.PI;
    assert.ok(Math.abs(Math.atan2(Math.sin(yaw - back), Math.cos(yaw - back))) < 1e-9, "the window is behind the aisle-facing pose");
  }
});
test("the nearest free seat is found from the aisle, skips taken seats and needs to be within reach", () => {
  for (const seat of SEATS) {
    const stand = seatStand(seat);
    assert.equal(nearestFreeSeat(stand.u, stand.v, () => true)?.index, seat.index, "the seat in front of you");
    assert.equal(nearestFreeSeat(stand.u * 0.5, stand.v + 0.3, () => true)?.index, seat.index, "from beside the aisle centre line");
    const other = nearestFreeSeat(stand.u, stand.v, candidate => candidate.index !== seat.index);
    assert.notEqual(other?.index, seat.index, "a taken seat is never offered");
    if (other) assert.ok(Math.hypot(seatStand(other).u - stand.u, seatStand(other).v - stand.v) <= SEAT_REACH);
  }
  // Doorways are well away from the benches; the far ends of the train have none.
  for (const center of CARRIAGE_CENTERS) assert.equal(nearestFreeSeat(0, center, () => true), null);
  assert.equal(nearestFreeSeat(0, 21.7, () => true), null);
  // Standing on the left half of the aisle picks a left-hand seat, never one across the aisle.
  const left = SEATS.find(seat => seat.side < 0)!;
  assert.equal(nearestFreeSeat(-1, left.v, () => true)?.side, -1);
});
test("the seated look stays within a comfortable range around the window, without unwrapping a full turn", () => {
  for (const trainYaw of [0, 2, -3, 9]) for (const side of [-1, 1] as const) {
    const out = windowYaw(trainYaw, side);
    // Inside the range nothing changes.
    const free = clampSeatedLook(out + 0.8, -0.3, trainYaw, side);
    assert.ok(Math.abs(free.yaw - (out + 0.8)) < 1e-9 && free.pitch === -0.3);
    // Beyond it, yaw stops at ±100° and pitch at ±45° around the slight downward tilt.
    for (const sign of [-1, 1]) {
      const edge = clampSeatedLook(out + sign * 2.6, sign * 1.2, trainYaw, side);
      assert.ok(Math.abs(edge.yaw - (out + sign * SEAT_LOOK.yaw)) < 1e-9, "yaw clamps to the range edge");
      assert.ok(Math.abs(edge.pitch - (SEAT_LOOK.tilt + sign * SEAT_LOOK.pitch)) < 1e-9, "pitch clamps to the range edge");
    }
    // An unwrapped mouse yaw (several turns along) stays on its own branch.
    const turns = out + 6 * Math.PI + 0.4, kept = clampSeatedLook(turns, 0, trainYaw, side);
    assert.ok(Math.abs(kept.yaw - turns) < 1e-9, "no full-turn jump");
  }
  assert.ok(Math.abs(SEAT_LOOK.yaw - 100 * Math.PI / 180) < 1e-12 && Math.abs(SEAT_LOOK.pitch - Math.PI / 4) < 1e-12);
});
test("turning to the window when sitting is eased and never whips the view round (motion comfort)", () => {
  assert.equal(seatTurnSeconds(0), 0.4, "small turns take the 0.4 s of the sit itself");
  assert.equal(seatTurnSeconds(-0.5), 0.4);
  for (let turn = -Math.PI; turn <= Math.PI; turn += 0.05) {
    const seconds = seatTurnSeconds(turn);
    assert.ok(seconds >= 0.4 && seconds <= 1.2);
    // A smoothstep turn peaks at 1.5x its mean angular speed.
    assert.ok(1.5 * Math.abs(turn) / seconds <= 4.3, `peak ${(1.5 * Math.abs(turn) / seconds).toFixed(2)} rad/s for a ${turn.toFixed(2)} rad turn`);
  }
});
test("a seat the player holds is never given to a commuter, and seats commuters hold are refused", () => {
  // Find the first seat commuters take on train 0 when nobody else is aboard...
  const open = new CityPopulation(new CityWorld());
  let first = -1;
  for (let time = 0; time < 400 && first < 0; time += 0.1) {
    open.update(0.1, time, time, { x: 9999, z: 9999 });
    first = open.commuters.find(p => p.train === 0 && p.seat >= 0)?.seat ?? -1;
  }
  assert.ok(first >= 0, "commuters board train 0");
  assert.ok(open.seatTaken(0, first), "a commuter's seat (even while still boarding toward it) is taken for the player");
  // ...then let the player sit there first: the commuters must choose other seats.
  const population = new CityPopulation(new CityWorld());
  population.reservePlayerSeat(0, first);
  let boarded = 0;
  for (let time = 0; time < 400; time += 0.1) {
    population.update(0.1, time, time, { x: 9999, z: 9999 });
    for (const p of population.commuters) if (p.train === 0 && p.seat >= 0) {
      boarded++;
      assert.notEqual(p.seat, first, `a commuter took the player's seat at t=${time.toFixed(1)}`);
    }
    assert.equal(population.seatTaken(0, first), false);
  }
  assert.ok(boarded > 0, "commuters still ride train 0");
  // Releasing the reservation is accepted (and idempotent).
  population.reservePlayerSeat(null); population.reservePlayerSeat(null);
});
