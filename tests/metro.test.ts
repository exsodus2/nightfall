import assert from "node:assert/strict";
import test from "node:test";
import { STATIONS, TRACK_LENGTH, METRO_CYCLE, trackPose, trainAt, boardingTrain, localToWorld, worldToLocal, moveInTrain, canWalkInTrain, doorAt, BENCH, BENCH_PARTS, BENCHES, CARRIAGE_CENTERS, SEATS, SEATED_BODY, SEATED_POSE, seatedBox, seatedYaw, type FurnitureBox } from "../src/city/metro.ts";
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
