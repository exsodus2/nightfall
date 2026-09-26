import assert from "node:assert/strict";
import test from "node:test";
import { STATIONS, TRACK_LENGTH, localToWorld, trackPose } from "../src/city/metro.ts";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, ParkedCars, STATIC_OBSTACLES, roadDistance } from "../src/city/driving.ts";
import { pavementPoint } from "../src/city/people.ts";
import { BLOCK_SIZE, CityWorld, HALF_BLOCKS, LAMP_STREETS, LANDMARKS, PLAYER_RADIUS, RAIL_SOLIDS, RAIL_SUPPORTS, STATION_COLUMN_HALF, STATION_COLUMN_U, STATION_COLUMN_V, streetLamp, type RailLeg } from "../src/city/world.ts";

const world = new CityWorld();
interface Rect { x0: number; x1: number; z0: number; z1: number }
const rect = (leg: RailLeg, margin = 0): Rect => ({ x0: leg.x - leg.half - margin, x1: leg.x + leg.half + margin, z0: leg.z - leg.half - margin, z1: leg.z + leg.half + margin });
const overlap = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const name = (leg: RailLeg): string => `leg at ${leg.x.toFixed(1)},${leg.z.toFixed(1)}`;
/** Every point of a footprint on a 5 cm grid, edges included. */
function* footprint(leg: RailLeg): Generator<[number, number]> {
  const n = Math.ceil(leg.half * 2 / 0.05);
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) yield [leg.x - leg.half + i * leg.half * 2 / n, leg.z - leg.half + j * leg.half * 2 / n];
}
/** The ground shader's street distances (materials.ts, `SURFACE < 1.5`): the avenue is double width. */
const line = (v: number): number => { const m = ((v % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE; return Math.min(m, BLOCK_SIZE - m); };
const streetDistances = (x: number, z: number): [number, number] => [Math.abs(x) < 32 ? Math.abs(x) * 0.5 : line(x), line(z)];
const inCrossing = (x: number, z: number): boolean => {
  const [sx, sz] = streetDistances(x, z);
  return (sx >= 9.5 && sx <= 13 && sz < 6) || (sz >= 9.5 && sz <= 13 && sx < 6);
};

test("rail supports are portals across the streets and plaza columns on the corners, never unsupported for long", () => {
  const portals = RAIL_SUPPORTS.filter(s => s.span), columns = RAIL_SUPPORTS.filter(s => !s.span);
  assert.equal(portals.length, 44);
  assert.equal(columns.length, 8);
  const along: number[] = [];
  for (const support of RAIL_SUPPORTS) {
    let best = Infinity, at = 0;
    for (let d = 0; d < TRACK_LENGTH; d += 0.05) { const p = trackPose(d), gap = Math.hypot(p.x - support.x, p.z - support.z); if (gap < best) { best = gap; at = d; } }
    assert.ok(best < 0.05, `support at ${support.x},${support.z} is ${best} m off the track`);
    along.push(at);
    if (support.span) {
      assert.equal(support.legs.length, 2);
      // Legs either side of the track, square to it, equally far out.
      const [a, b] = support.legs, pose = trackPose(at);
      const dx = b.x - a.x, dz = b.z - a.z;
      assert.ok(Math.abs(dx * Math.sin(pose.yaw) - dz * Math.cos(pose.yaw)) < 1e-6, "the portal is square to the track");
      assert.ok(Math.abs((a.x + b.x) / 2 - support.x) < 1e-9 && Math.abs((a.z + b.z) / 2 - support.z) < 1e-9, "the track runs through the middle of the portal");
    }
  }
  along.sort((a, b) => a - b);
  const spans = along.map((d, i) => (i + 1 < along.length ? along[i + 1] : along[0] + TRACK_LENGTH) - d);
  assert.ok(Math.max(...spans) < 68, `longest span ${Math.max(...spans).toFixed(1)} m`);
});

test("station street columns match the platform layout the renderer draws", () => {
  const stationColumns = RAIL_SOLIDS.slice(RAIL_SUPPORTS.flatMap(s => s.legs).length);
  assert.equal(stationColumns.length, STATIONS.length * STATION_COLUMN_V.length);
  for (const station of STATIONS) for (const v of STATION_COLUMN_V) {
    const p = localToWorld(station, STATION_COLUMN_U, v);
    assert.ok(stationColumns.some(c => Math.hypot(c.x - p.x, c.z - p.z) < 1e-9 && c.half === STATION_COLUMN_HALF), `${station.name} column at v ${v}`);
  }
  for (const solid of RAIL_SOLIDS) assert.ok(STATIC_OBSTACLES.some(o => o.x === solid.x && o.z === solid.z && o.halfLength === solid.half), `${name(solid)} is a driving obstacle`);
});

test("every pillar and portal leg stands off the road, out of crossings, lamps, parking and buildings", () => {
  const lamps: Rect[] = [];
  for (let iz = -LAMP_STREETS; iz <= LAMP_STREETS; iz++) for (let ix = -LAMP_STREETS; ix <= LAMP_STREETS; ix++) {
    // Post, signal box and the arm reaching back over the kerb (activity.ts).
    const lamp = streetLamp(ix, iz);
    lamps.push({ x0: Math.min(lamp.postX - 0.325, lamp.x - 1.25), x1: lamp.postX + 0.325, z0: lamp.z - 0.35, z1: lamp.z + 0.35 });
  }
  // Every kerbside space ParkedCars may use, taken or not (driving.ts): along 18.5 + 8.5 k, 5.8 m out.
  const slots: Rect[] = [];
  for (let block = -HALF_BLOCKS; block < HALF_BLOCKS; block++) for (let street = -(HALF_BLOCKS - 1); street <= HALF_BLOCKS - 1; street++) {
    for (const axis of ["z", "x"] as const) for (const side of [-1, 1]) for (let slot = 0; slot < 4; slot++) {
      const along = block * BLOCK_SIZE + 18.5 + slot * 8.5, lateral = street * BLOCK_SIZE + side * (axis === "z" && street === 0 ? 10.4 : 5.8);
      slots.push(axis === "z"
        ? { x0: lateral - CAR_HALF_WIDTH, x1: lateral + CAR_HALF_WIDTH, z0: along - CAR_HALF_LENGTH, z1: along + CAR_HALF_LENGTH }
        : { x0: along - CAR_HALF_LENGTH, x1: along + CAR_HALF_LENGTH, z0: lateral - CAR_HALF_WIDTH, z1: lateral + CAR_HALF_WIDTH });
    }
  }
  const cars = new ParkedCars(world).all();
  for (const leg of RAIL_SOLIDS) {
    for (const [x, z] of footprint(leg)) {
      assert.ok(roadDistance(x, z) >= 6.6, `${name(leg)}: ${x.toFixed(2)},${z.toFixed(2)} is on the road or kerb (${roadDistance(x, z).toFixed(2)} m from the centre line)`);
      const [sx, sz] = streetDistances(x, z);
      assert.ok(Math.min(sx, sz) >= 6.6, `${name(leg)}: on the carriageway as the ground shader draws it`);
      assert.ok(!inCrossing(x, z), `${name(leg)}: in a pedestrian crossing`);
    }
    const r = rect(leg, 0.3);
    for (const lamp of lamps) assert.ok(!overlap(r, lamp), `${name(leg)}: touches a street lamp`);
    for (const slot of slots) assert.ok(!overlap(r, slot), `${name(leg)}: in a kerbside parking space`);
    for (const car of cars) {
      const alongX = Math.abs(Math.sin(car.yaw)) > 0.5, hx = alongX ? CAR_HALF_LENGTH : CAR_HALF_WIDTH, hz = alongX ? CAR_HALF_WIDTH : CAR_HALF_LENGTH;
      assert.ok(!overlap(r, { x0: car.x - hx, x1: car.x + hx, z0: car.z - hz, z1: car.z + hz }), `${name(leg)}: parked car ${car.id} against it`);
    }
    for (const b of world.buildings) assert.ok(!overlap(rect(leg), { x0: b.x - b.width / 2, x1: b.x + b.width / 2, z0: b.z - b.depth / 2, z1: b.z + b.depth / 2 }), `${name(leg)}: inside building ${b.id}`);
    // Landmarks: towers, rings and plates reach 19.3 m out; the reactor's side stacks stand at (±18, -8).
    for (const landmark of LANDMARKS) {
      if (landmark.kind === "gate") continue;
      const nearX = Math.max(r.x0, Math.min(landmark.x, r.x1)), nearZ = Math.max(r.z0, Math.min(landmark.z, r.z1));
      assert.ok(Math.hypot(nearX - landmark.x, nearZ - landmark.z) > 19.5, `${name(leg)}: inside ${landmark.name}`);
      if (landmark.kind === "reactor") for (const i of [-1, 1]) assert.ok(!overlap(r, { x0: landmark.x + i * 18 - 2, x1: landmark.x + i * 18 + 2, z0: landmark.z - 10, z1: landmark.z - 6 }), `${name(leg)}: in a reactor stack`);
    }
    // The player and cars collide with it.
    assert.equal(world.canOccupy(leg.x, leg.z), false, `${name(leg)}: walkable`);
    assert.equal(world.canOccupy(leg.x + leg.half + PLAYER_RADIUS - 0.01, leg.z), false);
  }
});

test("residents' pavement lines, crossings and the station lifts pass clear of every leg", () => {
  // Walkers follow straight lines between pavement corners (people.ts); a person is ~0.4 m wide.
  const segments: [{ x: number; z: number }, { x: number; z: number }][] = [];
  for (let bz = -HALF_BLOCKS; bz < HALF_BLOCKS; bz++) for (let bx = -HALF_BLOCKS; bx < HALF_BLOCKS; bx++) for (let corner = 0; corner < 4; corner++) {
    const a = pavementPoint({ bx, bz, corner });
    segments.push([a, pavementPoint({ bx, bz, corner: (corner + 1) % 4 })]);
    const left = corner === 0 || corner === 3, top = corner < 2;
    segments.push([a, pavementPoint({ bx: bx + (left ? -1 : 1), bz, corner: [1, 0, 3, 2][corner] })]);
    segments.push([a, pavementPoint({ bx, bz: bz + (top ? -1 : 1), corner: [3, 2, 1, 0][corner] })]);
  }
  for (const leg of RAIL_SOLIDS) {
    const r = rect(leg, 0.4);
    for (const [a, b] of segments) {
      if (Math.min(a.x, b.x) > r.x1 || Math.max(a.x, b.x) < r.x0 || Math.min(a.z, b.z) > r.z1 || Math.max(a.z, b.z) < r.z0) continue;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
      for (let i = 0; i <= steps; i++) {
        const x = a.x + (b.x - a.x) * i / steps, z = a.z + (b.z - a.z) * i / steps;
        assert.ok(!(x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1), `${name(leg)}: on the walking line ${a.x},${a.z} -> ${b.x},${b.z}`);
      }
    }
  }
  for (const station of STATIONS) {
    const lift = localToWorld(station, 9, 20);
    assert.ok(world.canOccupy(lift.x, lift.z), `${station.name} lift`);
  }
});
