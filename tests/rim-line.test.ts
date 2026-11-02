import assert from "node:assert/strict";
import test from "node:test";
import { LINES, RIM_PLATFORM_HEIGHT, STATIONS, TRAIN_COUNT, TRAINS_PER_LINE, lineStations, linePose, localToWorld, trainAt } from "../src/city/metro.ts";
import { CityPopulation } from "../src/city/people.ts";
import { STATIC_OBSTACLES } from "../src/city/driving.ts";
import { BLOCK_SIZE, CityWorld, RAIL_SOLIDS, RAIL_SUPPORTS, RIM_YARDS, WORLD_EDGE, blockKey, districtAt, rimPlotCleared } from "../src/city/world.ts";
import { blockHasPlots } from "../src/city/street-life.ts";
import { parsePose } from "../src/multiplayer/protocol.ts";
import { RAIL_HEIGHT_SLACK, parseTrainCarrier, railPose, validRailPresence, validRailTransition } from "../src/multiplayer/rail.ts";
import { RAIL_DOWN, RAIL_H, RAIL_UP, RAIL_V, RIM_CODE, isRimCode, railCode } from "../src/components/rail-map-codes.ts";

const world = new CityWorld();
const RIM = LINES[1];

test("the Rim Line has eight stations on the Rim Roads, each on a cross street and named for its district edge", () => {
  const stations = lineStations(1);
  assert.equal(RIM.name, "Rim Line");
  assert.equal(stations.length, 8);
  assert.equal(new Set(STATIONS.map(station => station.name)).size, STATIONS.length, "station names are unique");
  let previous = -1;
  for (const station of stations) {
    assert.equal(Math.max(Math.abs(station.x), Math.abs(station.z)), WORLD_EDGE, `${station.name} is on the edge`);
    const along = Math.abs(station.x) === WORLD_EDGE ? station.z : station.x;
    assert.equal(Math.abs(along % BLOCK_SIZE), 0, `${station.name} is centred on a cross street`);
    assert.equal(station.height, RIM_PLATFORM_HEIGHT);
    assert.equal(station.lineName, "Rim Line");
    // The district is the one the platform (inside the edge) stands in.
    const platform = localToWorld(station, 9, 0);
    assert.equal(districtAt(platform.x, platform.z).id, station.district, station.name);
    assert.ok(station.track > previous, "stations in running order"); previous = station.track;
    const pose = linePose(1, station.track);
    assert.ok(Math.hypot(pose.x - station.x, pose.z - station.z) < 1e-9 && Math.abs(Math.sin(pose.yaw - station.yaw)) < 1e-9 && Math.cos(pose.yaw - station.yaw) > 0);
  }
  assert.ok(RIM.length > 1.8 * LINES[0].length, "the Rim Line is the long way round");
});

test("Rim Line trains and platforms clear every building, and its yards and concourses are kept open", () => {
  const near = (x: number, z: number) => world.nearbyBlocks(x, z, 1).flatMap(block => block.buildings);
  const hits = (x: number, z: number, margin: number) => near(x, z).some(b => Math.abs(x - b.x) < b.width / 2 + margin && Math.abs(z - b.z) < b.depth / 2 + margin);
  for (const line of LINES) {
    for (let d = 0; d < line.length; d += 2) {
      const pose = linePose(line.id, d);
      for (let v = -22; v <= 22; v += 2) for (const u of [-2.9, 0, 2.9]) {
        const p = localToWorld(pose, u, v);
        assert.ok(!hits(p.x, p.z, 0.3), `${line.name} carriage at ${d.toFixed(0)} m (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) hits a building`);
      }
    }
  }
  for (const station of STATIONS) for (let v = -26.5; v <= 26.5; v += 1.5) for (let u = 3; u <= 10.8; u += 1.3) {
    const p = localToWorld(station, u, v);
    assert.ok(!hits(p.x, p.z, 0), `${station.name} platform at ${u},${v} is inside a building`);
  }
  // Corner yards: no plots, no cables, a landmark that blocks walking and driving.
  for (const yard of RIM_YARDS) {
    const bx = Math.floor(yard.x / BLOCK_SIZE), bz = Math.floor(yard.z / BLOCK_SIZE);
    assert.equal(world.blocks.get(blockKey(bx, bz))?.buildings.length, 0, `${yard.kind} yard is clear`);
    assert.equal(blockHasPlots(bx, bz), false);
    assert.equal(world.canOccupy(yard.x, yard.z), false, `${yard.kind} is solid`);
    assert.ok(STATIC_OBSTACLES.some(o => o.x === yard.x && o.z === yard.z), `${yard.kind} stops cars`);
  }
  // Clearing keeps every other building's id, so venues, holograms and signs elsewhere are unchanged.
  const ids = world.buildings.map(b => b.id);
  assert.ok(ids.every((id, i) => i === 0 || id > ids[i - 1]), "ids stay in generation order");
  for (const building of world.buildings) assert.equal(rimPlotCleared(building.x, building.z), false);
  assert.ok(ids[ids.length - 1] + 1 > world.buildings.length, "cleared plots keep their ids");
});

test("Rim Line legs straddle the Rim Roads: inner legs on the city pavement collide, outer legs stand on the quay", () => {
  const supports = RAIL_SUPPORTS.filter(support => support.line === 1);
  assert.ok(supports.length > 90);
  for (const support of supports) for (const leg of support.legs) {
    assert.ok(RAIL_SOLIDS.includes(leg));
    if (Math.max(Math.abs(leg.x), Math.abs(leg.z)) > WORLD_EDGE) continue; // the harbour quay, outside the walkable city
    assert.equal(world.canOccupy(leg.x, leg.z), false, `rim leg at ${leg.x},${leg.z} is solid`);
    assert.ok(STATIC_OBSTACLES.some(o => o.x === leg.x && o.z === leg.z));
  }
  const outer = supports.flatMap(support => support.legs).filter(leg => Math.max(Math.abs(leg.x), Math.abs(leg.z)) > WORLD_EDGE);
  assert.ok(outer.length >= 88, "every portal has its outer leg on the quay");
});

test("train ids are global: the Rim Line's 4-7 are valid carriers, floors and platforms are checked per line", () => {
  assert.equal(TRAIN_COUNT, 8);
  for (let id = 0; id < TRAIN_COUNT; id++) assert.equal(trainAt(30, id).line, Math.floor(id / TRAINS_PER_LINE));
  for (const train of [4, 5, 6, 7]) assert.ok(parseTrainCarrier({ train, u: 0, v: 4, yaw: 0 }), `train ${train}`);
  assert.equal(parseTrainCarrier({ train: 8, u: 0, v: 4, yaw: 0 }), null);
  const carrier = { train: 6, u: 0, v: -10, yaw: 0.2 };
  for (let time = 0; time < RIM.cycle; time += 7) {
    const pose = { ...railPose(carrier, time), pitch: 0, speed: 0, mode: "metro" as const, car: 0, place: "", carrier };
    assert.ok(validRailPresence(pose), `rim rider at ${time}`);
    assert.ok(parsePose(pose), `rim rider pose parses at ${time}`);
    assert.ok(validRailTransition(pose, pose, time));
    assert.equal(validRailTransition(pose, { ...pose, y: pose.y + 3 }, time), false, "height must follow the train");
  }
  // Boarding a Rim Line train at one of its stations: from its platform height, not the loop's.
  let docked = 0;
  while (trainAt(docked + 2, 4).station === null || trainAt(docked + 2, 4).doors < 1) docked += 0.5;
  const rider = { train: 4, u: 1.65, v: 0, yaw: 0 }, aboard = { ...railPose(rider, docked), mode: "metro", carrier: rider };
  const platform = { ...aboard, mode: "walk", carrier: null };
  assert.ok(validRailTransition({ ...platform, y: RIM_PLATFORM_HEIGHT }, aboard, docked));
  assert.equal(validRailTransition({ ...platform, y: LINES[0].platform }, aboard, docked), false);
  assert.equal(validRailPresence({ ...aboard, y: RIM.floorRange[1] + RAIL_HEIGHT_SLACK + 0.1 }), false);
});

test("the map draws the Rim Line in its own rail glyphs along its whole length", () => {
  assert.equal(railCode(0, -WORLD_EDGE, 2.6, 2.6, 2.6), RAIL_H + RIM_CODE);
  assert.equal(railCode(WORLD_EDGE, 0, 2.6, 2.6, 2.6), RAIL_V + RIM_CODE);
  assert.equal(railCode(0, -320, 2.6, 2.6, 2.6), RAIL_H);
  assert.equal(railCode(512, 0, 2.6, 2.6, 2.6), RAIL_V);
  assert.equal(railCode(0, 0, 2.6, 2.6, 2.6), 0);
  assert.equal(railCode(0, -740, 2.6, 2.6, 2.6), 0);
  const corner = WORLD_EDGE - 64, diagonal = 64 * Math.SQRT1_2;
  assert.ok([RAIL_DOWN + RIM_CODE, RAIL_UP + RIM_CODE].includes(railCode(corner + diagonal, -corner - diagonal, 2.6, 2.6, 2.6)));
  for (const line of LINES) for (let d = 0; d < line.length; d += 3) {
    const pose = linePose(line.id, d), code = railCode(pose.x, pose.z, 2.6, 2.6, 2.6);
    assert.ok(code !== 0 && isRimCode(code) === (line.id === 1), `${line.name} drawn at ${d}`);
    assert.ok([RAIL_H, RAIL_V, RAIL_DOWN, RAIL_UP].includes(code - (line.id === 1 ? RIM_CODE : 0)));
  }
});

test("Rim Line commuters live at its stations and ride only its trains", () => {
  const population = new CityPopulation(world);
  population.walkers.length = 0;
  const rim = population.commuters.filter(person => STATIONS[person.station].line === 1);
  assert.equal(rim.length, 32);
  for (const station of lineStations(1)) assert.equal(rim.filter(person => person.station === station.index).length, 4);
  let rode = 0;
  for (let tick = 1; tick <= 3000; tick++) {
    const time = tick / 10;
    population.update(0.1, time, time, { x: 0, z: 0 });
    for (const person of population.commuters) {
      const line = STATIONS[person.station].line;
      assert.equal(STATIONS[person.destination].line, line, "destinations stay on the home line");
      if (person.train !== null) { assert.equal(Math.floor(person.train / TRAINS_PER_LINE), line); if (line === 1) rode++; }
    }
  }
  assert.ok(rode > 1000, `rim commuters ride (${rode} samples)`);
});
