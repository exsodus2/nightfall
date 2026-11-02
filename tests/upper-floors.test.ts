import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld, PLAYER_RADIUS, type Player } from "../src/city/world.ts";
import { BUILDING_PLACE_ID, CityInteriors, INTERIOR_HEIGHT, interiorFixtures, interiorLocal, interiorTitle, interiorWorld, type InteriorFixture, type InteriorPlace } from "../src/city/interiors.ts";
import { S, groundFloorPlaces, groundFloorPlan, planFromRecipe, type GroundFloorPlan, type PlanRecipe } from "../src/city/building-interiors.ts";
import { GROUND_STOREY, LIFT_KINDS, LIFT_TOWER_HEIGHT, STOREY, floorTitle, liftLanding, storeysOf, upperBackdrop, upperFloorPlace, upperFloorPlan, upperOpenAir, upperVariant } from "../src/city/upper-floors.ts";
import { validPresence, validPresenceTransition } from "../src/multiplayer/presence.ts";

const world = new CityWorld();
const grounds = groundFloorPlaces(world);
const towers = grounds.filter(place => place.stops);
const started = performance.now();
const uppers: InteriorPlace[] = towers.flatMap(ground => (ground.stops ?? []).filter(floor => floor > 1).map(floor => upperFloorPlace(world, ground, floor)).filter(place => place !== null));
const plans = new Map<string, GroundFloorPlan>(uppers.map(place => [place.id, upperFloorPlan(place)]));
const elapsed = performance.now() - started;
const SEATS = new Set<InteriorFixture["kind"]>(["seat", "couch", "cushion", "bench", "stool"]);
const RIGHT_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const buildingOf = (place: InteriorPlace) => world.buildings.find(building => building.id === place.building);

/** CityInteriors.canOccupy's box test on a 0.25 m grid, flood-filled from the spawn (as in building-interiors.test.ts). */
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

test("tall lift buildings list their stops; everything else has none", () => {
  console.log(`lift towers: ${towers.length}/${grounds.length} ground floors; ${uppers.length} upper floors, ${elapsed.toFixed(0)} ms for every upper place and plan`);
  assert.ok(towers.length >= 100, `${towers.length} towers with a working lift`);
  for (const ground of grounds) {
    const building = buildingOf(ground);
    assert.ok(building);
    const eligible = (LIFT_KINDS as readonly string[]).includes(ground.kind) && building.height > LIFT_TOWER_HEIGHT;
    if (!eligible) { assert.equal(ground.stops, undefined, `${ground.id} ${ground.kind} ${building.height.toFixed(0)} m has no lift stops`); continue; }
    const stops = ground.stops ?? [];
    const top = storeysOf(building.height);
    assert.ok(stops.length >= 3 && stops.length <= 4, `${ground.id}: ${stops.join(",")}`);
    assert.equal(stops[0], 1);
    assert.equal(stops[stops.length - 1], top, `${ground.id}: the top floor is listed`);
    assert.ok(stops.every((floor, index) => Number.isInteger(floor) && (index === 0 || floor > stops[index - 1])), `${ground.id}: ascending ${stops.join(",")}`);
    // Every listed floor fits under the roof at ~4 m a storey.
    assert.ok(GROUND_STOREY + (top - 1) * STOREY <= building.height + 1e-6, `${ground.id}: floor ${top} fits in ${building.height} m`);
    assert.equal(ground.floor, undefined);
  }
});

test("upper floors are places: canonical ids, same footprint, street entrance, rising floors", () => {
  assert.equal(new Set(uppers.map(place => place.id)).size, uppers.length, "ids are unique");
  for (const ground of towers) {
    let previous = 0;
    for (const floor of (ground.stops ?? []).slice(1)) {
      const place = upperFloorPlace(world, ground, floor);
      assert.ok(place, `${ground.id} floor ${floor}`);
      assert.equal(place.id, `bldg-${ground.building}-f${floor}`);
      assert.ok(BUILDING_PLACE_ID.test(place.id));
      assert.equal(place, upperFloorPlace(world, ground, floor), "cached: the same object every call");
      assert.equal(place.floor, floor);
      assert.equal(place.kind, ground.kind);
      assert.deepEqual(place.entrance, ground.entrance, "leaving or saving from an upper floor lands on the street");
      assert.deepEqual([place.x, place.z, place.width, place.depth, place.yaw, place.building], [ground.x, ground.z, ground.width, ground.depth, ground.yaw, ground.building]);
      assert.ok(place.elevation !== undefined && place.elevation > previous && place.elevation <= (buildingOf(ground)?.height ?? 0) + 1e-6, `${place.id} elevation ${place.elevation}`);
      previous = place.elevation ?? 0;
      assert.ok(place.description.length > 10);
      assert.ok(upperVariant(place) !== null);
      if (upperOpenAir(place)) assert.equal(floor, ground.stops?.[ground.stops.length - 1], "only a top floor is open to the sky");
      assert.match(interiorTitle(place), new RegExp(` · (Floor ${floor}|Roof)$`));
      assert.equal(floorTitle(place), upperOpenAir(place) ? "Roof" : `Floor ${floor}`);
    }
    assert.equal(upperFloorPlace(world, ground, 1), null, "floor 1 is the ground floor's own id");
    assert.equal(upperFloorPlace(world, ground, (ground.stops?.[ground.stops.length - 1] ?? 0) + 1), null, "no floor above the top");
  }
  const middle = uppers.filter(place => place.floor !== place.stops?.[place.stops.length - 1]);
  assert.ok(middle.every(place => ({ lobby: "apartments", apartment: "apartments", "corp-lobby": "offices", "capsule-hotel": "pods", "server-hall": "servers" } as Record<string, string>)[place.kind] === upperVariant(place)), "middle floors follow the building's kind");
  assert.ok(new Set(uppers.map(place => upperVariant(place))).size >= 6, "every variant appears");
});

test("ids: canonical, existing floors only, resolved by placeById", () => {
  const interiors = new CityInteriors(world);
  const sample = upperFloorPlaceSample();
  assert.equal(interiors.placeById(sample.id), sample, "the cached object");
  assert.equal(interiors.placeById(`bldg-${sample.building}`)?.id, `bldg-${sample.building}`);
  for (const bad of [`bldg-${sample.building}-f0${sample.floor}`, `bldg-0${sample.building}-f${sample.floor}`, `bldg-${sample.building}-f1`, `bldg-${sample.building}-f0`, `bldg-${sample.building}-f${(sample.floor ?? 0) + 1000}`, `bldg-${sample.building}-F${sample.floor}`, `bldg-${sample.building}-f${sample.floor}-`, `bldg-${sample.building}-f`]) {
    assert.equal(interiors.placeById(bad), null, bad);
  }
  // A floor the lift does not stop at, and an upper floor of a building without a lift.
  const ground = towers.find(place => place.building === sample.building) as InteriorPlace;
  const unlisted = [2, 3, 4, 5, 6].find(floor => !ground.stops?.includes(floor));
  if (unlisted !== undefined) assert.equal(interiors.placeById(`bldg-${sample.building}-f${unlisted}`), null);
  const low = grounds.find(place => !place.stops);
  assert.ok(low);
  assert.equal(interiors.placeById(`bldg-${low.building}-f2`), null);
});

function upperFloorPlaceSample(): InteriorPlace {
  return uppers[Math.floor(uppers.length / 2)];
}

test("every upper plan is walkable: the lift in the core, its landing, every room, residents on free floor", () => {
  for (const place of uppers) {
    const plan = plans.get(place.id) as GroundFloorPlan, hw = place.width / 2, hd = place.depth / 2, name = `${place.id} ${upperVariant(place)}`;
    assert.equal(plan, groundFloorPlan(place), `${name}: groundFloorPlan dispatches to the upper plan`);
    assert.deepEqual(interiorFixtures(place), plan.fixtures);
    const check = flood(place, plan.fixtures);
    assert.ok(check.spawn, `${name}: spawn is free`);
    const lifts = plan.fixtures.filter(f => f.kind === "lift");
    assert.equal(lifts.length, 1, `${name}: one lift`);
    assert.ok(Math.abs(lifts[0].x) < 1e-6 && Math.abs(lifts[0].z + lifts[0].depth / 2 - hd) < 1e-6, `${name}: lift in the +z core`);
    const landing = liftLanding(lifts[0]);
    assert.ok(check.free(landing.x, landing.z) && check.reached(landing.x, landing.z), `${name}: lift landing reachable`);
    assert.ok(landing.fz === -1 && landing.fx === 0, `${name}: arrivals face the glass`);
    for (const f of plan.fixtures) {
      assert.ok(Math.abs(f.x) + f.width / 2 <= hw + 0.03 && Math.abs(f.z) + f.depth / 2 <= hd + 0.03, `${name}: ${f.kind} in bounds`);
      assert.ok(f.width > 0 && f.depth > 0 && f.height > 0);
      assert.ok(f.yaw === undefined || RIGHT_ANGLES.some(angle => Math.abs((f.yaw as number) - angle) < 1e-9), `${name}: ${f.kind} yaw`);
      if (f.kind === "wall") assert.equal(f.height, INTERIOR_HEIGHT);
      if (f.kind !== "wall" && f.height > 0.5) assert.ok(f.height < INTERIOR_HEIGHT - 0.5, `${name}: ${f.kind} under the ceiling`);
    }
    assert.ok(plan.rooms.length >= 1 && plan.rooms.length <= 4, `${name}: ${plan.rooms.length} rooms`);
    for (const room of plan.rooms) {
      let reached = false;
      for (let x = room.x - room.width / 2 + 0.125; x < room.x + room.width / 2 && !reached; x += 0.25) {
        for (let z = room.z - room.depth / 2 + 0.125; z < room.z + room.depth / 2 && !reached; z += 0.25) reached = check.reached(x, z);
      }
      assert.ok(reached, `${name}: room ${room.label} reachable`);
    }
    assert.ok(plan.residents.length >= 1 && plan.residents.length <= 4, `${name}: ${plan.residents.length} residents`);
    for (const resident of plan.residents) {
      if (resident.seated) assert.ok(plan.fixtures.some(f => SEATS.has(f.kind) && Math.abs(resident.x - f.x) <= f.width / 2 + 1e-6 && Math.abs(resident.z - f.z) <= f.depth / 2 + 1e-6), `${name}: seated resident on a seat`);
      else assert.ok(check.free(resident.x, resident.z) && check.reached(resident.x, resident.z), `${name}: resident on free floor`);
      assert.ok(Math.hypot(resident.x - landing.x, resident.z - landing.z) > 1.2, `${name}: nobody stands in the lift's doorway`);
      assert.ok(resident.line.length > 0 && resident.line.length <= 22);
    }
    assert.ok(plan.lights.length >= 1 && plan.lights.length <= 6, `${name}: ${plan.lights.length} lights`);
    // The view: furniture fills more than a token amount of every floor (not an empty box).
    assert.ok(plan.fixtures.some(f => f.kind !== "wall" && f.kind !== "lift"), `${name}: furnished`);
  }
});

test("upper places and plans are deterministic and cached", () => {
  const fresh = new CityWorld(), again = groundFloorPlaces(fresh);
  for (let index = 0; index < uppers.length; index += 11) {
    const place = uppers[index], ground = again.find(candidate => candidate.building === place.building) as InteriorPlace;
    const other = upperFloorPlace(fresh, ground, place.floor ?? 0);
    assert.ok(other);
    assert.deepEqual(other, place);
    assert.deepEqual(upperFloorPlan(other), plans.get(place.id));
  }
  assert.equal(upperFloorPlan(uppers[0]), upperFloorPlan(uppers[0]));
  assert.ok(elapsed < 8000, `${elapsed.toFixed(0)} ms`);
});

test("most tall ground floors have a lift the visitor can reach", () => {
  let reachable = 0;
  for (const ground of towers) {
    const plan = groundFloorPlan(ground), check = flood(ground, plan.fixtures);
    if (plan.fixtures.some(f => f.kind === "lift" && check.free(liftLanding(f).x, liftLanding(f).z) && check.reached(liftLanding(f).x, liftLanding(f).z))) reachable++;
  }
  console.log(`ground-floor lifts reachable: ${reachable}/${towers.length}`);
  assert.ok(reachable / towers.length >= 0.9, `${reachable}/${towers.length}`);
});

test("every tall building's ground lift is rideable: landing free, reachable, outside the exit strip", () => {
  for (const ground of towers) {
    const plan = groundFloorPlan(ground), check = flood(ground, plan.fixtures), hd = ground.depth / 2;
    const lifts = plan.fixtures.filter(f => f.kind === "lift");
    assert.ok(lifts.length >= 1, `${ground.id}: advertises stops, so it has a lift`);
    const good = lifts.filter(f => {
      const l = liftLanding(f);
      return check.free(l.x, l.z) && check.reached(l.x, l.z) && !(Math.abs(l.x) < 2 && l.z > hd - 3.6);
    });
    assert.ok(good.length >= 1, `${ground.id}: a lift whose landing is reachable and outside the exit strip`);
    const interiors = new CityInteriors(world), player: Player = { x: ground.entrance.x, z: ground.entrance.z, yaw: 0, pitch: 0, distance: 0 };
    interiors.enter(ground, player);
    const pose = interiors.landingPose();
    assert.ok(pose, `${ground.id}: ride lands somewhere`);
    assert.equal(interiors.atExit(pose.x, pose.z), false, `${ground.id}: the landing is not the exit`);
    assert.ok(interiors.liftAt(pose.x, pose.z), `${ground.id}: E at the landing rides`);
  }
});

test("every upper floor has a lift whose landing is reachable from where a ride lands the player", () => {
  const interiors = new CityInteriors(world);
  for (const place of uppers) {
    const plan = plans.get(place.id);
    assert.ok(plan, place.id);
    const lifts = plan.fixtures.filter(f => f.kind === "lift");
    assert.ok(lifts.length >= 1, `${place.id}: has a lift (the only way down)`);
    const check = flood(place, plan.fixtures);
    assert.ok(lifts.some(f => check.free(liftLanding(f).x, liftLanding(f).z) && check.reached(liftLanding(f).x, liftLanding(f).z)), `${place.id}: lift landing reachable`);
    const player: Player = { x: place.entrance.x, z: place.entrance.z, yaw: 0, pitch: 0, distance: 0 };
    interiors.enter(place, player);
    const pose = interiors.landingPose();
    assert.ok(pose, `${place.id}: landing pose exists`);
    assert.ok(interiors.liftAt(pose.x, pose.z), `${place.id}: the landing can ride down`);
  }
});

test("the walkability fallback keeps a forced lift instead of deleting every fixture", () => {
  const place = upperFloorPlaceSample(), hd = place.depth / 2;
  const recipe: PlanRecipe = {
    seed: 7,
    // A full-width wall across the room: the back half is unreachable and nothing but walls (and the kept lift) exist.
    partition: layout => {
      layout.wall(-layout.hw, layout.hw, -0.1, 0.1);
      const group = layout.group("LIFT");
      layout.keep.add(group);
      layout.fixtures.push({ kind: "lift", x: 0, z: hd - S.lift.d / 2, width: S.lift.w, depth: S.lift.d, height: S.lift.h, yaw: Math.PI, seed: 0.5 });
      layout.groups.push(group); layout.owners.push(-1);
      return [
        { rect: { x0: -layout.hw, x1: layout.hw, z0: 0.1, z1: hd }, role: "front", order: 0, label: "FRONT" },
        { rect: { x0: -layout.hw, x1: layout.hw, z0: -hd, z1: -0.1 }, role: "back", order: 0, label: "BACK" },
      ];
    },
    furnish: () => undefined,
    lines: ["HELLO"], light: [255, 255, 255], label: "OPEN",
  };
  const plan = planFromRecipe(place, recipe);
  assert.equal(plan.fixtures.filter(f => f.kind === "wall").length, 0, "the blocking wall is gone");
  const lifts = plan.fixtures.filter(f => f.kind === "lift");
  assert.equal(lifts.length, 1, "the forced lift survives");
  const check = flood(place, plan.fixtures), landing = liftLanding(lifts[0]);
  assert.ok(check.spawn && check.free(landing.x, landing.z) && check.reached(landing.x, landing.z), "its landing is reachable");
});

test("the lift rides every stop in turn and back to the ground floor", () => {
  const interiors = new CityInteriors(world);
  let rode = 0;
  for (const ground of towers.filter((_, index) => index % 9 === 0)) {
    const player: Player = { x: ground.entrance.x, z: ground.entrance.z, yaw: 0, pitch: 0, distance: 0 };
    interiors.enter(ground, player);
    const pose = interiors.landingPose();
    if (!pose) continue; // a ground lift the walkability pass dropped
    Object.assign(player, pose);
    assert.equal(interiors.atExit(player.x, player.z), false);
    const stops = ground.stops ?? [];
    for (let step = 1; step <= stops.length; step++) {
      const lift = interiors.liftAt(player.x, player.z);
      assert.ok(lift, `${interiors.active?.id}: standing at the lift`);
      const expected = stops[step % stops.length];
      assert.equal(lift.next, expected);
      assert.match(interiors.liftPrompt(player.x, player.z) ?? "", expected > lift.current ? /▲/ : /▼/);
      const place = interiors.ride(player);
      assert.ok(place);
      assert.equal(interiors.active, place);
      assert.equal(place.id, expected === 1 ? ground.id : `${ground.id}-f${expected}`);
      assert.ok(interiors.canOccupy(player.x, player.z), `${place.id}: arrives on free floor`);
      assert.ok(interiors.liftAt(player.x, player.z), `${place.id}: arrives at the lift`);
      if (place.floor) {
        assert.equal(interiors.atExit(player.x, player.z), false, "no street door upstairs");
        assert.deepEqual(interiors.outdoorPose(player), ground.entrance, "a save upstairs restores on the street");
        // Arrivals face into the room, toward the glass at -z.
        const forward = interiorLocal(place, player.x + Math.sin(player.yaw), player.z - Math.cos(player.yaw)), here = interiorLocal(place, player.x, player.z);
        assert.ok(forward.z - here.z < -0.99, `${place.id}: faces into the room`);
      }
      rode++;
    }
    assert.equal(interiors.active?.id, ground.id);
    interiors.leave(player);
  }
  assert.ok(rode > 30, `${rode} rides`);
  // Leaving an upper floor any other way (flight, travel) puts the visitor on the street.
  const place = upperFloorPlaceSample(), player: Player = { x: 0, z: 0, yaw: 0, pitch: 0, distance: 0 };
  interiors.enter(place, player);
  interiors.leave(player);
  assert.deepEqual({ x: player.x, z: player.z }, { x: place.entrance.x, z: place.entrance.z });
});

test("multiplayer: upper-floor presence is valid and only the lift moves between floors", () => {
  const place = upperFloorPlaceSample(), ground = towers.find(candidate => candidate.building === place.building) as InteriorPlace;
  const inside = (room: InteriorPlace) => ({ ...interiorWorld(room, 0, room.depth / 2 - 2.2), y: 0, mode: "walk", place: room.id });
  assert.ok(validPresence(inside(place)));
  // Floor changes are only valid at the lifts (presence.ts validLiftRide): stand at each floor's lift landing.
  const atLift = (room: InteriorPlace) => {
    const lift = interiorFixtures(room).find(item => item.kind === "lift");
    assert.ok(lift, `${room.id} has a lift`);
    const landing = liftLanding(lift);
    return { ...interiorWorld(room, landing.x, landing.z), y: 0, mode: "walk", place: room.id };
  };
  assert.ok(validPresenceTransition(atLift(ground), atLift(place)), "ground floor to upper floor by the lift");
  assert.ok(validPresenceTransition(atLift(place), atLift(ground)), "and back down");
  assert.equal(validPresenceTransition(inside(ground), inside(place)), false, "never between floors away from the lift");
  const elsewhere = towers.find(candidate => candidate.building !== place.building) as InteriorPlace;
  assert.equal(validPresenceTransition(inside(place), inside(elsewhere)), false, "never into another building");
  assert.ok(validPresenceTransition(inside(place), { x: place.entrance.x, y: 0, z: place.entrance.z, mode: "walk", place: "" }), "out to the street entrance");
  assert.equal(validPresence({ ...inside(place), place: `bldg-${place.building}-f1` }), false);
});

test("the view: the real city scaled into a ring outside the glass, stable and inside the far plane", () => {
  let checked = 0;
  for (let index = 0; index < uppers.length; index += 17) {
    const place = uppers[index], view = upperBackdrop(place);
    assert.ok(view, place.id);
    assert.equal(view, upperBackdrop(place), "built once");
    assert.ok(view.towers.length >= 10, `${place.id}: ${view.towers.length} towers`);
    for (const tower of view.towers) {
      // Its nearest point outside the room (half-diagonal <= 15.6 m) on the ring, its farthest inside the far plane.
      const near = Math.hypot(Math.max(0, Math.abs(tower.x) - tower.w / 2), Math.max(0, Math.abs(tower.z) - tower.d / 2));
      const far = Math.hypot(Math.abs(tower.x) + tower.w / 2, Math.abs(tower.z) + tower.d / 2);
      assert.ok(near >= 23.9 && far < 60, `${place.id}: tower from ${near.toFixed(1)} to ${far.toFixed(1)} m`);
      assert.ok(tower.y - tower.h / 2 >= 2.7 - 42.01 && tower.y + tower.h / 2 <= 2.7 + 42.01, `${place.id}: tower clipped to the view`);
      assert.ok(tower.pitch > 0 && tower.color.every(channel => channel >= 0 && channel <= 255));
    }
    for (const glow of view.glows) assert.ok(glow.w >= 0.45 && glow.h >= 0.45 && glow.d >= 0.45, `${place.id}: lit shapes never shrink below a cell`);
    checked++;
  }
  assert.ok(checked > 10);
  // Higher floors see more sky: the share of towers rising above the eye falls with height.
  const above = (place: InteriorPlace) => { const view = upperBackdrop(place); return view ? view.towers.filter(tower => tower.y + tower.h / 2 > 2.7).length / Math.max(1, view.towers.length) : 0; };
  const pairs = towers.slice(0, 40).map(ground => (ground.stops ?? []).slice(1).map(floor => upperFloorPlace(world, ground, floor)).filter(place => place !== null));
  let falls = 0, total = 0;
  for (const floors of pairs) if (floors.length >= 2) { total++; if (above(floors[floors.length - 1]) <= above(floors[0])) falls++; }
  assert.ok(total > 5 && falls / total > 0.75, `${falls}/${total} top floors see fewer towers above the eye than the middle floor`);
});
