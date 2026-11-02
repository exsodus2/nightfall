import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld } from "../src/city/world.ts";
import { interiorFixtures, interiorWorld, type InteriorPlace } from "../src/city/interiors.ts";
import { groundFloorPlaces } from "../src/city/building-interiors.ts";
import { liftLanding, upperFloorPlace } from "../src/city/upper-floors.ts";
import { validPresenceTransition, type PresencePose } from "../src/multiplayer/presence.ts";

const world = new CityWorld();
const ground = groundFloorPlaces(world).find(place => place.stops && place.stops.length >= 3) as InteriorPlace;
const floor = (ground.stops ?? []).find(stop => stop > 1) as number;
const upper = upperFloorPlace(world, ground, floor) as InteriorPlace;

const at = (place: InteriorPlace, x: number, z: number): PresencePose => ({ ...interiorWorld(place, x, z), y: 0, mode: "walk", place: place.id });
const atLift = (place: InteriorPlace): PresencePose => {
  const lift = interiorFixtures(place).find(item => item.kind === "lift");
  assert.ok(lift, `${place.id} has a lift`);
  const landing = liftLanding(lift);
  return at(place, landing.x, landing.z);
};
const street = (place: InteriorPlace): PresencePose => ({ x: place.entrance.x, y: 0, z: place.entrance.z, mode: "walk", place: "" });
/** A spot in the room far from every lift landing. */
function farFromLift(place: InteriorPlace): PresencePose {
  const landing = liftLanding(interiorFixtures(place).find(item => item.kind === "lift") as ReturnType<typeof interiorFixtures>[number]);
  return at(place, landing.x > 0 ? -place.width / 2 + 1.5 : place.width / 2 - 1.5, -place.depth / 2 + 1.5);
}

test("presence: a lift ride between floors is accepted, both ways", () => {
  assert.ok(validPresenceTransition(atLift(ground), atLift(upper)));
  assert.ok(validPresenceTransition(atLift(upper), atLift(ground)));
});

test("presence: teleporting between floors away from a lift is rejected", () => {
  assert.equal(validPresenceTransition(farFromLift(ground), atLift(upper)), false, "boarding from across the room");
  assert.equal(validPresenceTransition(atLift(ground), farFromLift(upper)), false, "arriving across the room");
  assert.equal(validPresenceTransition(farFromLift(upper), farFromLift(ground)), false);
});

test("presence: the street leads to ground floors only", () => {
  const door = at(ground, 0, ground.depth / 2 - 2.2);
  assert.ok(validPresenceTransition(street(ground), door), "street to the ground floor at the door");
  assert.equal(validPresenceTransition(street(ground), atLift(upper)), false, "street to an upper floor");
  assert.equal(validPresenceTransition(street(ground), at(upper, 0, upper.depth / 2 - 2.2)), false);
});

test("presence: nonexistent or non-stop floors are rejected", () => {
  const stops = ground.stops ?? [];
  const missing = Math.max(...stops) + 7;
  assert.equal(validPresenceTransition(atLift(ground), { ...atLift(upper), place: `${ground.id}-f${missing}` }), false);
  const skipped = Array.from({ length: Math.max(...stops) }, (_, index) => index + 2).find(candidate => !stops.includes(candidate));
  if (skipped !== undefined) assert.equal(validPresenceTransition(atLift(ground), { ...atLift(upper), place: `${ground.id}-f${skipped}` }), false);
  assert.equal(validPresenceTransition(atLift(ground), { ...atLift(upper), place: `${ground.id}-f1` }), false, "floor 1 is the ground id");
});
