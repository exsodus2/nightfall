import assert from "node:assert/strict";
import test from "node:test";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, DRIVER_EYE_HEIGHT, DriveSession, ParkedCars, carFits, distanceToCar, exitSpot, overlapsBuilding, roadDistance, STATIC_OBSTACLES, stepCar, type DriveCar, type DriveInput } from "../src/city/driving.ts";
import { MouseLook } from "../src/city/locomotion.ts";
import { CityWorld, LAMP_STREETS, WORLD_EDGE, nearestStreetLamps, streetLamp } from "../src/city/world.ts";
import { CityTraffic } from "../src/city/traffic.ts";

const world = new CityWorld();
const parked = new ParkedCars(world);
const car = (x: number, z: number, yaw: number, speed = 0): DriveCar => ({ x, z, yaw, id: 1, speed, steer: 0, yawRate: 0, accel: 0, scraping: false });
const input = (throttle: number, steer = 0, extra: Partial<DriveInput> = {}): DriveInput => ({ throttle, steer, handbrake: false, boost: false, ...extra });
const corners = (c: { x: number; z: number; yaw: number }) => [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]].map(([a, s]) => ({
  x: c.x + Math.sin(c.yaw) * a * CAR_HALF_LENGTH + Math.cos(c.yaw) * s * CAR_HALF_WIDTH,
  z: c.z - Math.cos(c.yaw) * a * CAR_HALF_LENGTH + Math.sin(c.yaw) * s * CAR_HALF_WIDTH,
}));
// stepCar clamps a single frame to 0.15 s, like the engine; longer spans run as frames.
const run = (c: DriveCar, i: DriveInput, seconds: number) => { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) stepCar(world, c, i, 1 / 60); };
const insideBuilding = (x: number, z: number) => world.buildings.some(b => Math.abs(x - b.x) < b.width / 2 && Math.abs(z - b.z) < b.depth / 2);

test("parked cars line the kerbs of every part of the city, never inside a building", () => {
  const cars = parked.all();
  assert.ok(cars.length > 900, `only ${cars.length} parked cars`);
  assert.deepEqual(cars, new ParkedCars(world).all(), "placement is deterministic");
  const occupied = new Set(cars.map(c => `${Math.floor(c.x / 64)},${Math.floor(c.z / 64)}`));
  assert.ok(occupied.size > 400, "cars appear near most blocks");
  for (const c of cars) {
    const road = roadDistance(c.x, c.z);
    assert.ok(road > 4 && road < 6.6, `car ${c.id} at ${c.x},${c.z} is ${road} m from the centre line`);
    assert.ok(carFits(world, c));
    assert.ok(!overlapsBuilding(world, c));
    for (const p of corners(c)) assert.ok(!insideBuilding(p.x, p.z));
    // Parallel to the street it is parked on.
    assert.ok(Math.abs(Math.sin(c.yaw * 2)) < 1e-9);
  }
  const near = parked.nearby(0, 78, 120);
  assert.ok(near.length > 5 && near.every(c => Math.hypot(c.x, c.z - 78) < 120));
});

test("throttle accelerates gently, brakes stop, and S reverses from standstill", () => {
  const c = car(0, 100, 0);
  run(c, input(1), 1);
  assert.ok(c.speed > 5 && c.speed < 10, `1 s of throttle gives ${c.speed}`);
  for (let i = 0; i < 50; i++) stepCar(world, c, input(1), 0.1);
  assert.ok(c.speed > 18 && c.speed <= 25, `top speed ${c.speed}`);
  const boosted = { ...c };
  for (let i = 0; i < 30; i++) stepCar(world, boosted, input(1, 0, { boost: true }), 0.1);
  assert.ok(boosted.speed > c.speed + 5, "boost raises the top speed");
  let t = 0;
  while (c.speed > 0 && t < 5) { stepCar(world, c, input(-1), 0.05); t += 0.05; }
  assert.ok(t < 2.5, `braking from speed took ${t}s`);
  for (let i = 0; i < 20; i++) stepCar(world, c, input(-1), 0.1);
  assert.ok(c.speed < -3 && c.speed >= -8, `reverse ${c.speed}`);
  const coast = car(0, 100, 0, 20);
  run(coast, input(0), 1);
  assert.ok(coast.speed > 15 && coast.speed < 19.5, "coasting decelerates gently");
  const handbrake = car(0, 100, 0, 20);
  run(handbrake, input(0, 0, { handbrake: true }), 1);
  assert.ok(handbrake.speed < 10, "handbrake bites");
});

test("steering turns the right way, reverses when backing up and tightens at low speed", () => {
  const right = car(0, 100, 0, 8), left = car(0, 100, 0, 8), back = car(0, 100, 0, -4);
  for (let i = 0; i < 10; i++) { stepCar(world, right, input(0.3, 1), 0.05); stepCar(world, left, input(0.3, -1), 0.05); stepCar(world, back, input(-0.3, 1), 0.05); }
  assert.ok(right.yaw > 0.1 && left.yaw < -0.1, "D turns right (clockwise), A left");
  assert.ok(back.yaw < 0, "reversing with right lock swings the nose left");
  const slow = car(0, 100, 0, 5), fast = car(0, 100, 0, 24);
  run(slow, input(0.2, 1), 1); run(fast, input(0.2, 1), 1);
  const radius = (c: DriveCar) => Math.abs(c.speed / c.yawRate);
  assert.ok(radius(slow) < radius(fast) / 3, "lock narrows with speed");
  assert.ok(Math.abs(fast.speed * fast.yawRate) <= 14.01, "lateral grip is capped");
});

test("the model is frame-rate independent", () => {
  const a = car(0, 100, 0), b = car(0, 100, 0);
  for (let i = 0; i < 90; i++) stepCar(world, a, input(1, i > 30 ? 0.6 : 0), 1 / 30);
  for (let i = 0; i < 432; i++) stepCar(world, b, input(1, i > 144 ? 0.6 : 0), 1 / 144);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.6, `drift ${Math.hypot(a.x - b.x, a.z - b.z)}`);
  assert.ok(Math.abs(a.speed - b.speed) < 0.2 && Math.abs(a.yaw - b.yaw) < 0.05);
});

test("ramming, scraping and spinning against buildings never enters a footprint", () => {
  let hits = 0;
  for (const building of world.buildings.filter((_, i) => i % 37 === 0)) {
    for (const approach of [0, 1, 2, 3]) {
      const yaw = approach * Math.PI / 2 + 0.35;
      const start = { x: building.x - Math.sin(yaw) * (building.width / 2 + 12), z: building.z + Math.cos(yaw) * (building.depth / 2 + 12) };
      const c = car(start.x, start.z, yaw, 20);
      if (!carFits(world, c)) continue;
      let impact = 0;
      for (let frame = 0; frame < 120; frame++) {
        const r = stepCar(world, c, input(1, Math.sin(frame * 0.2), { boost: frame % 40 < 20, handbrake: frame % 50 > 44 }), frame % 7 === 0 ? 0.15 : 1 / 60);
        impact = Math.max(impact, r.impact);
        assert.ok(!overlapsBuilding(world, c), `inside building ${building.id}`);
        for (const p of corners(c)) assert.ok(!insideBuilding(p.x, p.z));
        assert.ok(Math.abs(c.x) < WORLD_EDGE && Math.abs(c.z) < WORLD_EDGE);
      }
      if (impact > 0) hits++;
    }
  }
  assert.ok(hits > 20, "the scenarios actually collide");
  const wall = world.buildings[100];
  const c = car(wall.x - wall.width / 2 - 8, wall.z, Math.PI / 2, 20);
  if (carFits(world, c)) {
    let impact = 0;
    for (let i = 0; i < 60; i++) impact = Math.max(impact, stepCar(world, c, input(0), 1 / 60).impact);
    assert.ok(impact > 5 && Math.abs(c.speed) < 5, "a head-on hit costs speed");
  }
});

test("exit spots are walkable and prefer the pavement", () => {
  let pavement = 0;
  const sample = parked.all().filter((_, i) => i % 7 === 0);
  for (const c of sample) {
    const spot = exitSpot(world, c);
    assert.ok(world.canOccupy(spot.x, spot.z), `exit at ${spot.x},${spot.z}`);
    assert.ok(distanceToCar(c, spot.x, spot.z) > 0.5 || roadDistance(spot.x, spot.z) >= 0, "beside the car, not inside it");
    if (roadDistance(spot.x, spot.z) >= 6.6) pavement++;
  }
  assert.equal(pavement, sample.length, "kerb-side cars let the driver out onto the pavement");
  // Even wedged against a tower, the exit resolves to a walkable spot.
  const b = world.buildings[42];
  const wedged = { x: b.x - b.width / 2 - 1.4, z: b.z, yaw: 0 };
  const spot = exitSpot(world, wedged);
  assert.ok(world.canOccupy(spot.x, spot.z));
});

test("the driving camera follows the car and re-centres only when the mouse is idle", () => {
  const look = new MouseLook(0.4, 0);
  const session = new DriveSession({ x: 0, z: 100, yaw: 0, id: 3 }, look);
  let view = session.update(world, input(1), 1 / 60, look);
  for (let i = 0; i < 240; i++) { view = session.update(world, input(1, i > 200 ? 0.2 : 0), 1 / 60, look); look.update(1 / 60); }
  assert.ok(Math.abs(view.height - DRIVER_EYE_HEIGHT) < 1e-9, "cockpit eye height");
  assert.ok(Math.abs(look.yaw - session.car.yaw) < 0.35, "view has eased back toward the heading");
  assert.equal(view.fovKick, 0, "comfort: no FOV change with speed");
  look.add(400, 0); const offset = look.targetYaw - session.car.yaw;
  session.update(world, input(0), 1 / 60, look);
  assert.ok(Math.abs(look.targetYaw - session.car.yaw - offset) < 0.02, "fresh mouse input is respected");
  session.chase = true;
  for (let i = 0; i < 60; i++) view = session.update(world, input(0), 1 / 60, look);
  assert.ok(Math.hypot(view.x - session.car.x, view.z - session.car.z) > 4, "chase camera sits behind the car");
  assert.ok(world.canOccupy(view.x, view.z));
});

test("cockpit <-> chase eases over ~0.4 s without snapping, shake or pitch bob", () => {
  const look = new MouseLook(0, 0);
  const session = new DriveSession({ x: 0, z: 100, yaw: 0, id: 3 }, look);
  const pose = (v: { x: number; z: number; height: number }) => [v.x - session.car.x, v.z - session.car.z, v.height];
  let view = session.update(world, input(1), 1 / 60, look);
  // Full throttle: the cockpit camera stays rigid (no pitch lean with acceleration, no bob).
  for (let i = 0; i < 90; i++) { view = session.update(world, input(1), 1 / 60, look); assert.equal(view.pitch, look.pitch); assert.equal(view.height, DRIVER_EYE_HEIGHT); }
  for (let i = 0; i < 240; i++) view = session.update(world, input(0, 0, { handbrake: true }), 1 / 60, look);
  assert.equal(session.exterior, false, "cockpit: draw the interior");
  assert.equal(session.toggleView(), "chase");
  const steps: number[] = [];
  let previous = pose(view), frames = 0;
  while (session.blend < 1 && frames < 120) {
    view = session.update(world, input(0), 1 / 60, look); frames++;
    const now = pose(view);
    steps.push(Math.hypot(now[0] - previous[0], now[1] - previous[1], now[2] - previous[2]));
    previous = now;
  }
  assert.ok(frames >= 22 && frames <= 26, `switch takes ~0.4 s (${frames} frames)`);
  assert.ok(steps[0] < 0.1 && steps[steps.length - 1] < 0.1, "eases out of the cockpit and into the chase view");
  assert.ok(Math.max(...steps) < 0.9, "no frame jumps");
  assert.equal(session.exterior, true, "chase: draw the whole body");
  assert.ok(view.height > 3 && Math.hypot(view.x - session.car.x, view.z - session.car.z) > 8, "chase camera frames the whole car from behind and above");
  assert.ok(view.pitch > look.pitch + 0.1, "chase view looks down past the car");
  // Reversing mid-way turns back from where the camera is.
  assert.equal(session.toggleView(), "cockpit");
  for (let i = 0; i < 6; i++) view = session.update(world, input(0), 1 / 60, look);
  const mid = pose(view);
  session.toggleView();
  view = session.update(world, input(0), 1 / 60, look);
  assert.ok(Math.hypot(pose(view)[0] - mid[0], pose(view)[1] - mid[1], pose(view)[2] - mid[2]) < 0.5, "a reversed switch does not jump");
  // A remembered chase view applies at once when getting in.
  const again = new DriveSession({ x: 0, z: 100, yaw: 0, id: 3 }, look, true);
  assert.equal(again.blend, 1); assert.equal(again.exterior, true);
});

test("traffic passes kerbside parked cars without driving through them", () => {
  // Regression: lanes 3.3 m from the centre line and cars parked 5.8 m out overlapped by 0.2 m, so
  // every passing car scraped through every parked car on an ordinary street.
  const traffic = new CityTraffic();
  const extent = (c: { yaw: number }) => Math.abs(Math.sin(c.yaw)) > 0.5 ? [CAR_HALF_LENGTH, CAR_HALF_WIDTH] : [CAR_HALF_WIDTH, CAR_HALF_LENGTH];
  let passed = 0;
  for (let time = 0; time < 30; time += 0.1) {
    traffic.update(0.1, time);
    for (const moving of traffic.nearby(0, 0, 3000)) for (const still of parked.nearby(moving.x, moving.z, 8)) {
      const [ax, az] = extent(moving), [bx, bz] = extent(still);
      const clear = Math.abs(moving.x - still.x) >= ax + bx || Math.abs(moving.z - still.z) >= az + bz;
      assert.ok(clear, `traffic car ${moving.id} at ${moving.x.toFixed(1)},${moving.z.toFixed(1)} overlaps parked car ${still.id}`);
      passed++;
    }
  }
  assert.ok(passed > 1000, `only ${passed} close passes`);
});

test("traffic and kerbside parking keep left on every street, matching the right-hand-drive cockpit", () => {
  // Regression: east-west streets drove (and parked) on the right, north-south ones on the left.
  const leftOfHeading = (c: { x: number; z: number; yaw: number }) => {
    const alongX = Math.abs(Math.sin(c.yaw)) > 0.5;
    const offset = alongX ? c.z - Math.round(c.z / 64) * 64 : c.x - Math.round(c.x / 64) * 64;
    const right = alongX ? Math.sin(c.yaw) : Math.cos(c.yaw); // lateral part of right = (cos yaw, sin yaw)
    return offset * right < 0;
  };
  for (const c of new CityTraffic().nearby(0, 0, 3000)) assert.ok(leftOfHeading(c), `traffic car ${c.id} at ${c.x.toFixed(1)},${c.z.toFixed(1)} keeps right`);
  for (const c of parked.all()) assert.ok(leftOfHeading(c), `parked car ${c.id} at ${c.x.toFixed(1)},${c.z.toFixed(1)} faces against its kerb's traffic`);
});

test("street lamps stand on the pavement, clear of buildings, columns and parked cars", () => {
  const cars = new ParkedCars(world).all();
  for (let iz = -LAMP_STREETS; iz <= LAMP_STREETS; iz++) for (let ix = -LAMP_STREETS; ix <= LAMP_STREETS; ix++) {
    const lamp = streetLamp(ix, iz), where = `lamp ${ix},${iz}`;
    assert.ok(roadDistance(lamp.postX, lamp.z) >= 6.6, `${where}: post in the road`);
    assert.ok(roadDistance(lamp.x, lamp.z) >= 5.5, `${where}: head over the lanes`);
    assert.ok(world.canOccupy(lamp.postX, lamp.z), `${where}: post inside a building`);
    // The arm runs from 2.25 m in front of the post to 0.25 m behind it, 0.7 m deep.
    for (const o of STATIC_OBSTACLES) {
      const r = Math.max(o.halfLength, o.halfWidth);
      assert.ok(o.x + r < lamp.postX - 2.25 - 0.2 || o.x - r > lamp.postX + 0.25 + 0.2 || Math.abs(o.z - lamp.z) > r + 0.35 + 0.2, `${where}: touches a pillar`);
    }
    for (const car of cars) assert.ok(Math.hypot(car.x - lamp.postX, car.z - lamp.z) > CAR_HALF_LENGTH + 0.5, `${where}: in a parking space`);
  }
  assert.deepEqual(nearestStreetLamps(3, 70, 1)[0], streetLamp(0, 1));
  assert.deepEqual(nearestStreetLamps(-60, 130, 2), [streetLamp(-1, 2), streetLamp(-1, 1)]);
});
