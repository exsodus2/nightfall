import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld, PLAYER_RADIUS, movePlayer, type Player } from "../src/city/world.ts";
import { CityInteriors, INTERIOR_HEIGHT, interiorFixtureLabel, interiorFixtures, interiorLocal, interiorPlaces, interiorWorld, isGroundFloorKind, type GroundFloorKind, type InteriorFixture, type InteriorPlace } from "../src/city/interiors.ts";
import { secretPlaces } from "../src/city/secrets.ts";
import { blockDoors } from "../src/city/street-doors.ts";
import { citizenPavement } from "../src/city/citizen-ai.ts";
import { STATIONS, localToWorld } from "../src/city/metro.ts";
import { SIGNATURE_FIXTURES, groundFloorPlace, groundFloorPlaces, groundFloorPlan, groundFloorsNear, type GroundFloorPlan } from "../src/city/building-interiors.ts";

const world = new CityWorld();
const started = performance.now();
const places = groundFloorPlaces(world);
const plans = new Map<string, GroundFloorPlan>(places.map(place => [place.id, groundFloorPlan(place)]));
const elapsed = performance.now() - started;
const excluded = new Set([...interiorPlaces(world), ...secretPlaces(world)].map(place => place.building));
const SEATS = new Set<InteriorFixture["kind"]>(["seat", "couch", "cushion", "bench", "stool"]);
const RIGHT_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** An independent walkability check: CityInteriors.canOccupy's box test on a 0.25 m grid, flood-filled from the spawn. */
function flood(place: InteriorPlace, fixtures: readonly InteriorFixture[]): { free: (x: number, z: number) => boolean; reached: (x: number, z: number) => boolean; spawn: boolean } {
  const cell = 0.25, hw = place.width / 2, hd = place.depth / 2, r = PLAYER_RADIUS;
  const nx = Math.floor(place.width / cell), nz = Math.floor(place.depth / cell);
  const free = (x: number, z: number) => Math.abs(x) <= hw - r && Math.abs(z) <= hd - r
    && !fixtures.some(f => Math.abs(x - f.x) < f.width / 2 + r && Math.abs(z - f.z) < f.depth / 2 + r);
  const open = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) open[j * nx + i] = free(-hw + (i + 0.5) * cell, -hd + (j + 0.5) * cell) ? 1 : 0;
  const seen = new Uint8Array(nx * nz);
  const start = Math.floor((2 * hd - 2.2) / cell) * nx + Math.floor(hw / cell);
  const spawn = free(0, hd - 2.2) && open[start] === 1;
  const stack = spawn ? [start] : [];
  if (spawn) seen[start] = 1;
  while (stack.length) {
    const c = stack.pop() as number, i = c % nx, j = (c - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, n = b * nx + a;
      if (a >= 0 && a < nx && b >= 0 && b < nz && open[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
    }
  }
  const reached = (x: number, z: number) => {
    const i = Math.floor((x + hw) / cell), j = Math.floor((z + hd) / cell);
    return i >= 0 && i < nx && j >= 0 && j < nz && seen[j * nx + i] === 1;
  };
  return { free, reached, spawn };
}

test("almost every building has a ground floor; venues and secrets keep theirs", () => {
  const eligible = world.buildings.filter(building => !excluded.has(building.id));
  const missing = eligible.filter(building => !groundFloorPlace(world, building));
  const share = 1 - missing.length / eligible.length;
  console.log(`ground floors: ${places.length}/${eligible.length} buildings (${(share * 100).toFixed(2)}%), ${missing.length} without; ${elapsed.toFixed(0)} ms for every place and plan`);
  assert.ok(share >= 0.98, `${(share * 100).toFixed(2)}% of buildings have a ground floor`);
  assert.equal(new Set(places.map(place => place.id)).size, places.length, "ids are unique");
  for (const place of places) {
    assert.equal(place.id, `bldg-${place.building}`);
    assert.ok(isGroundFloorKind(place.kind), place.kind);
    assert.ok(!excluded.has(place.building), `${place.id} is not a venue or secret building`);
    assert.ok(place.name.length > 0 && place.sign.length > 0 && place.sign === place.sign.toUpperCase() && place.sign.length <= 16, place.sign);
    assert.ok(place.description.length > 10);
    assert.equal(place.hidden, undefined);
  }
  for (const id of excluded) {
    const building = world.buildings.find(candidate => candidate.id === id);
    if (building) assert.equal(groundFloorPlace(world, building), null);
  }
  assert.equal(interiorPlaces(world).length, 9, "the venue list is unchanged");
  assert.ok(interiorPlaces(world).every(place => !isGroundFloorKind(place.kind)));
});

test("entrances are walkable, at the building's face, and prefer the drawn shopfront door", () => {
  let onDrawn = 0, withDrawn = 0;
  for (const place of places) {
    const building = world.buildings.find(candidate => candidate.id === place.building);
    assert.ok(building);
    assert.ok(world.canOccupy(place.entrance.x, place.entrance.z), `${place.id} entrance is walkable`);
    assert.equal(world.canOccupy(place.x, place.z), false, "the building stays solid outside");
    assert.ok(RIGHT_ANGLES.some(angle => Math.abs(place.yaw - angle) < 1e-9), `${place.id} yaw ${place.yaw}`);
    const local = interiorLocal(place, place.entrance.x, place.entrance.z);
    assert.ok(Math.abs(local.x) < 1e-6 && local.z > place.depth / 2 && local.z < place.depth / 2 + 3.5, `${place.id} entrance in front of the room's door`);
    assert.ok(place.width >= 8 && place.width <= 24 && place.depth >= 8 && place.depth <= 24, `${place.id} ${place.width}x${place.depth}`);
    // The room stays inside the footprint.
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const corner = interiorWorld(place, x * place.width / 2, z * place.depth / 2);
      assert.ok(Math.abs(corner.x - building.x) <= building.width / 2 + 1e-6 && Math.abs(corner.z - building.z) <= building.depth / 2 + 1e-6, `${place.id} room inside the building`);
    }
    const doors = blockDoors(world, Math.floor(building.x / 64), Math.floor(building.z / 64)).filter(door => door.building === building.id);
    if (doors.some(door => door.nz !== 0)) {
      withDrawn++;
      const normal = { x: Math.sin(place.yaw), z: Math.cos(place.yaw) };
      if (doors.some(door => Math.abs(door.nx - normal.x) < 1e-6 && Math.abs(door.nz - normal.z) < 1e-6)) onDrawn++;
    }
  }
  assert.ok(withDrawn > 0 && onDrawn / withDrawn > 0.95, `${onDrawn}/${withDrawn} entrances use the drawn door`);
});

test("places and plans are deterministic", () => {
  const again = groundFloorPlaces(new CityWorld());
  assert.deepEqual(again, places);
  for (let index = 0; index < again.length; index += 7) assert.deepEqual(groundFloorPlan(again[index]), plans.get(again[index].id));
  assert.equal(groundFloorPlan(places[0]), groundFloorPlan(places[0]), "plans are cached");
});

test("every plan is walkable: spawn, exit strip, every room, residents on free floor, fixtures in bounds", () => {
  for (const place of places) {
    const plan = plans.get(place.id) as GroundFloorPlan, hw = place.width / 2, hd = place.depth / 2, name = `${place.id} ${place.kind}`;
    const check = flood(place, plan.fixtures);
    assert.ok(check.spawn, `${name}: spawn is free`);
    assert.ok(check.reached(0, hd - 3.4) && check.reached(-1.5, hd - 2.2) && check.reached(1.5, hd - 2.2), `${name}: exit strip reachable`);
    for (const f of plan.fixtures) {
      assert.ok(Math.abs(f.x) + f.width / 2 <= hw + 0.03 && Math.abs(f.z) + f.depth / 2 <= hd + 0.03, `${name}: ${f.kind} in bounds`);
      assert.ok(!(Math.abs(f.x) - f.width / 2 < 2 && f.z + f.depth / 2 > hd - 3.6), `${name}: ${f.kind} clear of the exit strip`);
      assert.ok(f.width > 0 && f.depth > 0 && f.height > 0);
      assert.ok(f.yaw === undefined || RIGHT_ANGLES.some(angle => Math.abs((f.yaw as number) - angle) < 1e-9), `${name}: ${f.kind} yaw`);
      if (f.kind === "wall") assert.equal(f.height, INTERIOR_HEIGHT);
    }
    assert.ok(plan.rooms.length >= 1 && plan.rooms.length <= 4, `${name}: ${plan.rooms.length} rooms`);
    for (const [roomIndex, room] of plan.rooms.entries()) {
      assert.ok(Math.abs(room.x) + room.width / 2 <= hw + 1e-6 && Math.abs(room.z) + room.depth / 2 <= hd + 1e-6, `${name}: room ${room.label} in bounds`);
      if (plan.locks?.some(lock => lock.room === roomIndex)) continue; // a locked back room is optional while its gate is shut
      let reached = false;
      for (let x = room.x - room.width / 2 + 0.125; x < room.x + room.width / 2 && !reached; x += 0.25) {
        for (let z = room.z - room.depth / 2 + 0.125; z < room.z + room.depth / 2 && !reached; z += 0.25) reached = check.reached(x, z);
      }
      assert.ok(reached, `${name}: room ${room.label} reachable`);
    }
    assert.ok(plan.residents.length >= 1 && plan.residents.length <= 4, `${name}: ${plan.residents.length} residents`);
    for (const resident of plan.residents) {
      if (resident.seated) {
        assert.ok(plan.fixtures.some(f => SEATS.has(f.kind) && Math.abs(resident.x - f.x) <= f.width / 2 + 1e-6 && Math.abs(resident.z - f.z) <= f.depth / 2 + 1e-6), `${name}: seated resident on a seat`);
      } else {
        assert.ok(check.free(resident.x, resident.z) && check.reached(resident.x, resident.z), `${name}: resident at ${resident.x.toFixed(2)},${resident.z.toFixed(2)} on free floor`);
      }
      assert.ok(Number.isFinite(resident.facing) && resident.line.length > 0 && resident.line.length <= 22);
    }
    assert.ok(plan.lights.length >= 2 && plan.lights.length <= 6, `${name}: ${plan.lights.length} lights`);
    for (const light of plan.lights) assert.ok(Math.abs(light.x) <= hw && Math.abs(light.z) <= hd);
  }
});

test("kinds vary within every district and between neighbours", () => {
  for (let district = 0; district < 6; district++) {
    const kinds = new Set(places.filter(place => place.district === district).map(place => place.kind));
    assert.ok(kinds.size >= 5, `district ${district}: ${[...kinds].join(", ")}`);
  }
  let pairs = 0, repeats = 0;
  for (const block of world.blocks.values()) {
    const kinds = block.buildings.map(building => groundFloorPlace(world, building)?.kind).filter(kind => kind !== undefined);
    for (let a = 0; a < kinds.length; a++) for (let b = a + 1; b < kinds.length; b++) { pairs++; if (kinds[a] === kinds[b]) repeats++; }
  }
  assert.ok(repeats / pairs < 0.1, `${repeats}/${pairs} same-block neighbours share a kind`);
});

test("CityInteriors finds, enters and leaves ground floors", () => {
  const interiors = new CityInteriors(world);
  for (let index = 0; index < places.length; index += 23) {
    const place = places[index];
    assert.equal(interiors.nearby(place.entrance.x, place.entrance.z)?.id, place.id, `${place.id} door is found`);
    assert.ok(interiors.groundFloorsNear(place.entrance.x, place.entrance.z, 3).some(other => other.id === place.id));
    assert.ok(groundFloorsNear(world, place.entrance.x, place.entrance.z, 3).includes(place));
    const player: Player = { x: place.entrance.x, z: place.entrance.z, yaw: 0, pitch: 0, distance: 0 };
    interiors.enter(place, player);
    assert.deepEqual(interiors.fixtures, plans.get(place.id)?.fixtures);
    assert.ok(interiors.canOccupy(player.x, player.z), `${place.id} spawn`);
    assert.ok(interiors.atExit(player.x, player.z));
    for (let frame = 0; frame < 20; frame++) movePlayer(interiors, player, 1, 0, false, 1 / 60);
    assert.ok(interiorLocal(place, player.x, player.z).z < place.depth / 2 - 2.3, `${place.id}: forward walks into the room`);
    for (const fixture of interiors.fixtures) {
      const centre = interiorWorld(place, fixture.x, fixture.z);
      assert.equal(interiors.canOccupy(centre.x, centre.z), false, `${place.id}: ${fixture.kind} is solid`);
    }
    interiors.leave(player);
    assert.deepEqual({ x: player.x, z: player.z }, { x: place.entrance.x, z: place.entrance.z });
    // Leaving faces away from the building.
    const out = { x: Math.sin(player.yaw), z: -Math.cos(player.yaw) }, normal = { x: Math.sin(place.yaw), z: Math.cos(place.yaw) };
    assert.ok(out.x * normal.x + out.z * normal.z > 0.99, `${place.id}: leaves facing the street`);
  }
});

test("ground-floor labels: one per group, none for walls", () => {
  let labelled = 0;
  for (const place of places) {
    const fixtures = interiorFixtures(place);
    const labels = fixtures.map(item => interiorFixtureLabel(place, item)).filter(label => label !== null);
    if (labels.length) labelled++;
    for (const item of fixtures) if (item.kind === "wall") assert.equal(interiorFixtureLabel(place, item), null);
    for (const label of labels) assert.ok(label.text.length > 0 && label.text.length <= 12 && Math.abs(label.x) <= place.width / 2 && Math.abs(label.z) <= place.depth / 2);
  }
  assert.ok(labelled / places.length > 0.95, `${labelled}/${places.length} plans have labels`);
});

test("generating every place and plan stays fast", () => {
  assert.ok(elapsed < 8000, `${elapsed.toFixed(0)} ms`);
  const before = performance.now();
  const fresh = new CityWorld();
  for (let x = -700; x <= 700; x += 140) for (let z = -700; z <= 700; z += 140) groundFloorsNear(fresh, x, z, 3);
  assert.ok(performance.now() - before < 3000, "door lookups stay cheap");
});

test("the first view is open: a clear lane straight ahead of the spawn", () => {
  let checked = 0;
  for (const place of places) {
    const plan = plans.get(place.id) as GroundFloorPlan, hw = place.width / 2, hd = place.depth / 2, name = `${place.id} ${place.kind}`;
    const spawnZ = hd - 2.2, r = PLAYER_RADIUS;
    const standable = (x: number, z: number) => Math.abs(x) <= hw - r && Math.abs(z) <= hd - r
      && !plan.fixtures.some(f => Math.abs(x - f.x) < f.width / 2 + r && Math.abs(z - f.z) < f.depth / 2 + r);
    let z = spawnZ;
    while (standable(0, z - 0.05)) z -= 0.05;
    // 6 m ahead (5.4 allows for a partition wall's thickness), or up to 3.2 m short of the back wall in a shallow room.
    const reach = Math.max(spawnZ - 5.4, -hd + 3.2 + r + 0.1);
    assert.ok(z <= reach, `${name}: walks ${(spawnZ - z).toFixed(1)} m ahead of the spawn`);
    checked++;
  }
  assert.equal(checked, places.length);
});

test("the first view frames the kind's signature piece, ahead of the spawn and unobstructed", () => {
  let framed = 0;
  const misses: string[] = [];
  for (const place of places) {
    assert.ok(isGroundFloorKind(place.kind));
    const plan = plans.get(place.id) as GroundFloorPlan, spawnZ = place.depth / 2 - 2.2;
    const signature = SIGNATURE_FIXTURES[place.kind as GroundFloorKind];
    assert.ok(signature.length > 0);
    const walls = plan.fixtures.filter(f => f.kind === "wall");
    const seen = plan.fixtures.some(f => {
      if (!signature.includes(f.kind)) return false;
      const ahead = spawnZ - f.z;
      // Within the view cone: any part of the piece closer to the axis than 0.45 x its distance.
      if (ahead < 3 || ahead > 12 || Math.max(0, Math.abs(f.x) - f.width / 2) >= 0.45 * ahead) return false;
      const tx = Math.min(f.x + f.width / 2, Math.max(f.x - f.width / 2, 0));
      for (let step = 1; step < 100; step++) {
        const t = step / 100, px = tx * t, pz = spawnZ + (f.z - spawnZ) * t;
        if (walls.some(w => Math.abs(px - w.x) < w.width / 2 && Math.abs(pz - w.z) < w.depth / 2)) return false;
      }
      return true;
    });
    if (seen) framed++; else misses.push(`${place.id} ${place.kind} ${place.width}x${place.depth}`);
  }
  const rate = framed / places.length;
  console.log(`signature framed in the first view: ${framed}/${places.length} (${(rate * 100).toFixed(1)}%)${misses.length ? `; misses: ${misses.slice(0, 8).join(", ")}` : ""}`);
  assert.ok(rate >= 0.95, `${(rate * 100).toFixed(1)}% of ground floors frame their signature piece: ${misses.slice(0, 8).join(", ")}`);
});

test("entrances and the pose just outside them are on pavement, never in a carriageway", () => {
  for (const place of places) {
    const out = { x: place.entrance.x + Math.sin(place.yaw) * 0.8, z: place.entrance.z + Math.cos(place.yaw) * 0.8 };
    assert.ok(citizenPavement(world, place.entrance.x, place.entrance.z), `${place.id} entrance is pavement`);
    // The leave pose is the entrance itself (pavement); a step further out may be the kerb, but never a wall.
    assert.ok(world.canOccupy(out.x, out.z), `${place.id} the step outside the door is open`);
  }
});

test("entrances keep clear of station lifts, secret doors and venue doors", () => {
  const rivals = [
    ...STATIONS.map(station => ({ name: station.name, ...localToWorld(station, 9, 20) })),
    ...secretPlaces(world).map(place => ({ name: place.id, x: place.entrance.x, z: place.entrance.z })),
    ...interiorPlaces(world).map(place => ({ name: place.id, x: place.entrance.x, z: place.entrance.z })),
  ];
  for (const place of places) for (const rival of rivals) {
    assert.ok(Math.hypot(place.entrance.x - rival.x, place.entrance.z - rival.z) >= 3.2, `${place.id} entrance crowds ${rival.name}`);
  }
});

test("a place and its plan do not depend on which buildings were asked for first", () => {
  const fresh = new CityWorld();
  const sample = world.buildings.filter((_, index) => index % 97 === 0).reverse();
  for (const building of sample) {
    const place = groundFloorPlace(fresh, building), expected = places.find(candidate => candidate.building === building.id) ?? null;
    assert.deepEqual(place, expected);
    if (place) assert.deepEqual(groundFloorPlan(place), plans.get(place.id));
  }
});
