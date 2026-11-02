import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld, type Player } from "../src/city/world.ts";
import { liftLanding, upperFloorPlace, upperFloorPlan, upperVariant, type UpperVariant } from "../src/city/upper-floors.ts";
import { CityInteriors, GROUND_FLOOR_KINDS, interiorLocal, interiorWorld, type InteriorPlace } from "../src/city/interiors.ts";
import { groundFloorPlaces, groundFloorPlan } from "../src/city/building-interiors.ts";
import { interiorUseMarkers } from "../src/city/interior-map-markers.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { RpgFrame } from "../src/rpg/types.ts";
import {
  DAILY_CREDIT_CAP, DAILY_ITEM_CAP, GROUND_LIFE_PREFIX, UPPER_KEY_BASE, GroundLifeLedger, nearestLandmark, groundLifeInteractable, groundLifeSpec, applyGroundLife,
  type GroundLifeHost, type GroundLifeSpec,
} from "../src/rpg/ground-life.ts";

const world = new CityWorld();
const places = groundFloorPlaces(world);

/** One sample place per ground-floor kind (plus a spread of the rest). */
function samples(): InteriorPlace[] {
  const byKind = new Map<string, InteriorPlace[]>();
  for (const place of places) byKind.set(place.kind, [...(byKind.get(place.kind) ?? []), place]);
  return [...byKind.values()].flatMap(list => [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]]);
}

function fakeHost(day = 0, credits = 1000, capacity = Infinity) {
  const ledger = new GroundLifeLedger(), inventory = new Map<string, number>(), lines: string[] = [];
  let balance = credits, earned = 0, rested = 0;
  const host: GroundLifeHost & { inventory: Map<string, number>; lines: string[]; day: number; readonly earned: number; readonly rested: number } = {
    day,
    get credits() { return balance; },
    get earned() { return earned; },
    get rested() { return rested; },
    ledger, inventory, lines,
    spend: n => { if (balance < n) return false; balance -= n; return true; },
    earn: n => { balance += n; earned += n; },
    give: (item, count) => {
      const held = [...inventory.values()].reduce((a, b) => a + b, 0), fit = Math.max(0, Math.min(count, capacity - held));
      if (fit > 0) inventory.set(item, (inventory.get(item) ?? 0) + fit);
      return fit;
    },
    remove: (item, count) => { const have = inventory.get(item) ?? 0; if (have < count) return false; inventory.set(item, have - count); return true; },
    itemName: item => item,
    rest: () => { rested++; },
    say: text => { lines.push(text); },
  };
  return host;
}

test("every ground-floor kind has a thing to do, deterministic per building", () => {
  const kinds = new Set<string>();
  for (const place of samples()) {
    const spec = groundLifeSpec(place);
    assert.ok(spec, `${place.id} ${place.kind} has a ground-life spec`);
    kinds.add(place.kind);
    assert.equal(spec.id, `${GROUND_LIFE_PREFIX}${place.id}`);
    assert.equal(spec.building, place.building);
    assert.ok(spec.label.length > 3 && spec.label.length <= 28, spec.label);
    // Deterministic: a fresh world gives the same spec for the same building.
    const other = groundFloorPlaces(new CityWorld()).find(candidate => candidate.id === place.id);
    assert.ok(other);
    const again = groundLifeSpec(other);
    assert.deepEqual(again, spec);
    assert.equal(groundLifeSpec(place), spec, "cached per place");
    const interactable = groundLifeInteractable(place);
    assert.ok(interactable && interactable.place === place.id && interactable.x === spec.x && interactable.z === spec.z);
  }
  assert.equal(kinds.size, GROUND_FLOOR_KINDS.length, "every kind was sampled");
});

test("the use point is on reachable free floor next to a fixture of the plan", () => {
  for (const place of samples()) {
    const spec = groundLifeSpec(place) as GroundLifeSpec;
    const interiors = new CityInteriors(world);
    const player: Player = { x: place.entrance.x, z: place.entrance.z, yaw: 0, pitch: 0, distance: 0 };
    interiors.enter(place, player);
    assert.ok(interiors.canOccupy(spec.x, spec.z), `${place.id} ${place.kind}: the use point is standable`);
    const local = interiorLocal(place, spec.x, spec.z);
    assert.ok(Math.abs(local.x - spec.local.x) < 1e-6 && Math.abs(local.z - spec.local.z) < 1e-6);
    const back = interiorWorld(place, spec.local.x, spec.local.z);
    assert.ok(Math.hypot(back.x - spec.x, back.z - spec.z) < 1e-6);
    // Not in the exit strip.
    assert.ok(!(Math.abs(local.x) < 2.4 && local.z > place.depth / 2 - 4), `${place.id}: clear of the exit`);
    const fixture = spec.fixture;
    if (fixture) {
      const plan = groundFloorPlan(place);
      assert.ok(plan.fixtures.some(f => f.kind === fixture.kind && f.x === fixture.x && f.z === fixture.z), `${place.id}: anchored on a plan fixture`);
      const near = Math.hypot(Math.max(0, Math.abs(local.x - fixture.x) - fixture.width / 2), Math.max(0, Math.abs(local.z - fixture.z) - fixture.depth / 2));
      assert.ok(near < 1.6, `${place.id}: stands beside the fixture (${near.toFixed(2)} m)`);
    }
  }
});

test("a sample of all buildings has a reachable use point (spawn flood)", () => {
  let missing = 0;
  for (let index = 0; index < places.length; index += 11) {
    const place = places[index], spec = groundLifeSpec(place);
    if (!spec) { missing++; continue; }
    const interiors = new CityInteriors(world);
    interiors.enter(place, { x: 0, z: 0, yaw: 0, pitch: 0, distance: 0 });
    assert.ok(interiors.canOccupy(spec.x, spec.z), `${place.id} use point standable`);
  }
  assert.equal(missing, 0);
});

test("the RPG layer exposes it, the interior map marks it, and E at the spot uses it", () => {
  const rpg = new RpgSession({ world });
  const place = places.find(candidate => candidate.kind === "arcade") as InteriorPlace;
  const list = rpg.interactables(place.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, `${GROUND_LIFE_PREFIX}${place.id}`);
  assert.deepEqual(rpg.interactables(place.id), list, "stable across calls");
  assert.equal(rpg.interactables("").some(item => item.id.startsWith(GROUND_LIFE_PREFIX)), false, "never listed outdoors");
  const markers = interiorUseMarkers(place, list);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].label, list[0].label);

  const input: RpgFrame["input"] = { attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 };
  const frame = (): RpgFrame => ({ dt: 0.1, time: 1, input, player: { x: list[0].x, z: list[0].z, eye: 1.7, yaw: 0, pitch: 0, mode: "walk", onFoot: false, place: place.id } });
  rpg.update(frame());
  assert.equal(rpg.snapshot().prompt, list[0].label);
  assert.equal(rpg.hasInteraction(), true);
  const before = rpg.character.credits;
  assert.equal(rpg.interactNearby(), null, "a feed line, no dialogue");
  assert.equal(rpg.character.credits <= before + 6, true);
  assert.ok(rpg.snapshot().feed.length > 0, "the result is posted");
});

test("freebies: once per building per day; the daily item cap holds across buildings", () => {
  const host = fakeHost(0);
  const thing = (kind: string, index = 0) => groundLifeSpec(places.filter(place => place.kind === kind)[index]) as GroundLifeSpec;
  const crop = thing("hydroponics");
  applyGroundLife(crop, host);
  applyGroundLife(crop, host);
  applyGroundLife(crop, host);
  const taken = () => [...host.inventory.values()].reduce((a, b) => a + b, 0);
  assert.ok(taken() <= 1, "one find per building per day");
  assert.ok(host.lines.some(line => /already|Nothing|ripe/.test(line)));
  // Many different buildings on one day never exceed the item cap.
  const farm = fakeHost(0);
  const finders = places.filter(place => ["laundromat", "hydroponics", "apartment", "machine-shop", "garage", "server-hall"].includes(place.kind));
  for (const place of finders.slice(0, 400)) applyGroundLife(groundLifeSpec(place) as GroundLifeSpec, farm);
  const found = [...farm.inventory.values()].reduce((a, b) => a + b, 0);
  assert.ok(found <= DAILY_ITEM_CAP, `${found} found, cap ${DAILY_ITEM_CAP}`);
  assert.ok(found > 0, "but something was found");
  // The next day opens the ledger again.
  farm.day = 1;
  const before = found;
  for (const place of finders.slice(0, 400)) applyGroundLife(groundLifeSpec(place) as GroundLifeSpec, farm);
  const after = [...farm.inventory.values()].reduce((a, b) => a + b, 0);
  assert.ok(after > before && after - before <= DAILY_ITEM_CAP);
});

test("found credits (arcade wins, mail) are capped per day and the arcade is a net sink", () => {
  const host = fakeHost(0, 100000);
  const arcades = places.filter(place => place.kind === "arcade");
  const spec = groundLifeSpec(arcades[0]) as GroundLifeSpec;
  const start = host.credits;
  for (let play = 0; play < 3000; play++) applyGroundLife(play % 2 ? spec : groundLifeSpec(arcades[play % arcades.length]) as GroundLifeSpec, host);
  assert.ok(host.earned <= DAILY_CREDIT_CAP, `${host.earned} cr won, cap ${DAILY_CREDIT_CAP}`);
  assert.ok(host.credits < start, "3000 credits in, at most the cap back");
  const mail = fakeHost(0);
  for (const place of places.filter(candidate => candidate.kind === "lobby").slice(0, 300)) applyGroundLife(groundLifeSpec(place) as GroundLifeSpec, mail);
  assert.ok(mail.earned <= DAILY_CREDIT_CAP);
});

test("paid uses charge, refuse when broke, and rest heals", () => {
  const pod = groundLifeSpec(places.find(place => place.kind === "capsule-hotel") as InteriorPlace) as GroundLifeSpec;
  const broke = fakeHost(0, 3);
  applyGroundLife(pod, broke);
  assert.equal(broke.rested, 0);
  assert.equal(broke.credits, 3);
  const flush = fakeHost(0, 100);
  applyGroundLife(pod, flush);
  assert.equal(flush.rested, 1);
  assert.equal(flush.credits, 85);
  applyGroundLife(pod, flush);
  assert.equal(flush.credits, 70, "rest is a sink, not rate limited");
  const shop = groundLifeSpec(places.find(place => place.kind === "pawnshop") as InteriorPlace) as GroundLifeSpec;
  const buyer = fakeHost(0, 0);
  applyGroundLife(shop, buyer);
  assert.equal(buyer.inventory.size, 0, "no credits, no goods");
});

test("every kind runs without throwing and posts a line, on many seeds and days", () => {
  for (const place of samples()) {
    const spec = groundLifeSpec(place) as GroundLifeSpec;
    for (let day = 0; day < 4; day++) {
      const host = fakeHost(day, 500);
      for (let use = 0; use < 6; use++) applyGroundLife(spec, host);
      assert.ok(host.lines.length >= 6, `${place.kind} speaks`);
      assert.ok(host.lines.every(line => line.length > 0 && line.length <= 160), `${place.kind} lines are short`);
    }
  }
});

const held = (host: { inventory: Map<string, number> }) => [...host.inventory.values()].reduce((a, b) => a + b, 0);
const first = (kind: string) => groundLifeSpec(places.find(place => place.kind === kind) as InteriorPlace) as GroundLifeSpec;

test("a partial purchase is undone and refunded, never free", () => {
  for (const place of places.filter(candidate => candidate.kind === "chandlery").slice(0, 12)) {
    const spec = groundLifeSpec(place) as GroundLifeSpec;
    const host = fakeHost(0, 100, 0);
    applyGroundLife(spec, host);
    assert.equal(held(host), 0);
    assert.equal(host.credits, 100, "nothing fits: refunded");
    const tight = fakeHost(0, 100, 2); // fits some of a 6-round pack but not all
    applyGroundLife(spec, tight);
    // Either it all fit and was paid for, or nothing was kept and everything refunded.
    assert.ok((tight.credits === 100 && held(tight) === 0 && !tight.lines.some(line => /^- \d+ cr/.test(line))) || (tight.credits < 100 && held(tight) > 0), "no partial freebie");
    const roomy = fakeHost(0, 100);
    applyGroundLife(spec, roomy);
    assert.ok(roomy.credits < 100 && held(roomy) > 0, "a full fit pays");
  }
});

test("save round trip is small, drops old flags and day rollover clears taken", () => {
  const host = fakeHost(0);
  const finders = places.filter(place => place.kind === "lobby" || place.kind === "hydroponics").slice(0, 300);
  for (const place of finders) applyGroundLife(groundLifeSpec(place) as GroundLifeSpec, host);
  const text = host.ledger.serialize();
  const back = GroundLifeLedger.parse(text);
  assert.equal(back.uses, host.ledger.uses);
  assert.equal(back.serialize(), text);
  assert.ok(text.length < 4000, `ledger is ${text.length} chars`);
  assert.equal(GroundLifeLedger.parse("{broken").uses, 0);
  assert.equal(GroundLifeLedger.parse(JSON.stringify({ gl: 1 })).uses, 0, "unknown shape starts fresh");
  const next = fakeHost(1);
  next.ledger.rollDay(1); next.ledger.take(5); next.ledger.rollDay(1); // same day: kept
  assert.equal(next.ledger.isTaken(5), true);
  next.ledger.rollDay(2);
  assert.equal(next.ledger.takenCount, 0);
});

test("the shrine heals once per building per day; the rumour repeats", () => {
  const shrine = first("shrine");
  const host = fakeHost(0, 100);
  applyGroundLife(shrine, host);
  applyGroundLife(shrine, host);
  applyGroundLife(shrine, host);
  assert.equal(host.rested, 1);
  assert.equal(host.credits, 99);
  host.day = 1;
  applyGroundLife(shrine, host);
  assert.equal(host.rested, 2);
});

test("a full pack does not use up a free find", () => {
  let sawFull = 0;
  for (const kind of ["hydroponics", "laundromat", "apartment", "machine-shop", "server-hall", "lobby"]) {
    for (const place of places.filter(candidate => candidate.kind === kind).slice(0, 8)) {
      const spec = groundLifeSpec(place) as GroundLifeSpec;
      const host = fakeHost(0, 10, 0);
      applyGroundLife(spec, host);
      assert.equal(held(host), 0);
      if (host.lines.some(line => /full/.test(line))) { sawFull++; assert.equal(host.ledger.isTaken(spec.building), false, `${place.id} stays unused`); }
    }
  }
  assert.ok(sawFull > 0, "the full-pack path ran");
});

test("use points stay clear of resident (staff) spots", () => {
  let checked = 0;
  for (let index = 0; index < places.length; index += 7) {
    const place = places[index], spec = groundLifeSpec(place);
    if (!spec) continue;
    const near = groundFloorPlan(place).residents.filter(p => Math.hypot(p.x - spec.local.x, p.z - spec.local.z) < 0.8).length;
    if (near === 0) checked++;
  }
  assert.ok(checked > places.length / 7 * 0.9, `${checked} use points clear of residents`);
});

// ---- Upper floors ---------------------------------------------------------------------------------------

const uppers: InteriorPlace[] = places.filter(place => place.stops).flatMap(ground => (ground.stops ?? []).filter(floor => floor > 1).map(floor => upperFloorPlace(world, ground, floor)).filter((place): place is InteriorPlace => place !== null));
const VARIANTS: readonly UpperVariant[] = ["apartments", "offices", "pods", "servers", "penthouse", "sky-bar", "plant-deck"];
/** Up to `per` floors of every variant. */
function upperSamples(per = 4): InteriorPlace[] {
  const out: InteriorPlace[] = [];
  for (const variant of VARIANTS) out.push(...uppers.filter(place => upperVariant(place) === variant).filter((_, index, list) => index % Math.max(1, Math.floor(list.length / per)) === 0).slice(0, per));
  return out;
}

test("every upper-floor variant has one themed thing to do, deterministic, with a distinct key", () => {
  const seen = new Set<UpperVariant>(), keys = new Set<number>();
  for (const place of upperSamples()) {
    const variant = upperVariant(place) as UpperVariant;
    const spec = groundLifeSpec(place) as GroundLifeSpec;
    assert.ok(spec, `${place.id} ${variant}`);
    seen.add(variant);
    assert.equal(spec.id, `${GROUND_LIFE_PREFIX}${place.id}`);
    assert.equal(spec.floor, place.floor);
    assert.equal(spec.key, UPPER_KEY_BASE + place.building * 100 + (place.floor as number));
    assert.ok(!keys.has(spec.key), "keys are unique per building and floor");
    keys.add(spec.key);
    assert.ok(spec.label.length > 3 && spec.label.length <= 28, spec.label);
    assert.equal(groundLifeSpec(place), spec, "cached");
    const fresh = new CityWorld(), ground = groundFloorPlaces(fresh).find(candidate => candidate.id === `bldg-${place.building}`) as InteriorPlace;
    assert.deepEqual(groundLifeSpec(upperFloorPlace(fresh, ground, place.floor as number) as InteriorPlace), spec, "same in a fresh world");
    const interactable = groundLifeInteractable(place);
    assert.ok(interactable && interactable.place === place.id && interactable.x === spec.x && interactable.z === spec.z);
  }
  assert.equal(seen.size, VARIANTS.length, "every variant sampled");
  const grounds = new Set(places.map(place => groundLifeSpec(place)?.key));
  assert.ok([...keys].every(key => !grounds.has(key)), "upper keys never collide with ground keys");
});

test("an upper floor's use point is reachable free floor beside a plan fixture, clear of the lift landing and residents", () => {
  for (const place of upperSamples(6)) {
    const spec = groundLifeSpec(place) as GroundLifeSpec, plan = upperFloorPlan(place);
    const ground = places.find(candidate => candidate.id === `bldg-${place.building}`) as InteriorPlace;
    const interiors = new CityInteriors(world);
    const player: Player = { x: ground.entrance.x, z: ground.entrance.z, yaw: 0, pitch: 0, distance: 0 };
    interiors.enter(place, player);
    assert.ok(interiors.canOccupy(spec.x, spec.z), `${place.id} ${upperVariant(place)}: use point standable`);
    const local = interiorLocal(place, spec.x, spec.z);
    assert.ok(Math.abs(local.x - spec.local.x) < 1e-6 && Math.abs(local.z - spec.local.z) < 1e-6);
    for (const lift of plan.fixtures.filter(f => f.kind === "lift")) {
      const landing = liftLanding(lift);
      assert.ok(Math.hypot(local.x - landing.x, local.z - landing.z) >= 1.5 - 1e-9, `${place.id}: clear of the lift landing`);
    }
    if (spec.fixture) {
      const fixture = spec.fixture;
      assert.ok(plan.fixtures.some(f => f.kind === fixture.kind && f.x === fixture.x && f.z === fixture.z), `${place.id}: anchored on a plan fixture`);
      const near = Math.hypot(Math.max(0, Math.abs(local.x - fixture.x) - fixture.width / 2), Math.max(0, Math.abs(local.z - fixture.z) - fixture.depth / 2));
      assert.ok(near < 1.6, `${place.id}: beside the fixture (${near.toFixed(2)} m)`);
    }
    const crowded = plan.residents.filter(r => Math.hypot(local.x - r.x, local.z - r.z) < 0.8).length;
    assert.ok(crowded === 0, `${place.id}: clear of residents`);
  }
});

test("a broad sample of upper floors always has a use point", () => {
  let missing = 0;
  for (let index = 0; index < uppers.length; index += 3) if (!groundLifeSpec(uppers[index])) missing++;
  assert.equal(missing, 0);
});

test("the RPG layer lists an upper floor's thing and only there", () => {
  const rpg = new RpgSession({ world });
  const place = uppers[0];
  const list = rpg.interactables(place.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, `${GROUND_LIFE_PREFIX}${place.id}`);
  assert.equal(rpg.interactables(`bldg-${place.building}`).every(item => item.id !== list[0].id), true);
});

function upperOf(variant: UpperVariant, index = 0): GroundLifeSpec {
  return groundLifeSpec(uppers.filter(place => upperVariant(place) === variant)[index]) as GroundLifeSpec;
}

test("sky bar: a paid drink heals, once per building per day, with the floor and the view in the line", () => {
  const spec = upperOf("sky-bar"), host = fakeHost(0, 100);
  applyGroundLife(spec, host);
  assert.equal(host.credits, 88);
  assert.equal(host.rested, 1);
  assert.ok(host.lines.some(line => line.includes(spec.floorName)), "mentions the floor");
  applyGroundLife(spec, host);
  assert.equal(host.credits, 88, "second drink the same day is refused, not charged");
  assert.equal(host.rested, 1);
  host.day = 1;
  applyGroundLife(spec, host);
  assert.equal(host.credits, 76, "a new day, a new round");
  const broke = fakeHost(0, 3);
  applyGroundLife(spec, broke);
  assert.equal(broke.credits, 3);
  assert.equal(broke.rested, 0);
});

test("penthouse: free, names the nearest landmark, pays a little XP once a day", () => {
  const spec = upperOf("penthouse"), host = fakeHost(0, 0);
  let xp = 0;
  host.xp = amount => { xp += amount; };
  applyGroundLife(spec, host);
  assert.equal(xp, 10);
  const near = nearestLandmark(spec.x, spec.z);
  assert.ok(host.lines.some(line => line.includes(near.name) && line.includes(near.direction)), "rumour line names landmark and direction");
  assert.ok(host.lines.some(line => line.includes(spec.floorName)), "mentions the floor");
  applyGroundLife(spec, host);
  assert.equal(xp, 10, "reward once per day");
  assert.ok(host.credits <= DAILY_CREDIT_CAP);
  assert.equal(host.credits, host.earned);
  host.day = 1;
  applyGroundLife(spec, host);
  assert.equal(xp, 20);
});

test("nearestLandmark bearings: north is -z", () => {
  const spire = nearestLandmark(32, -100);
  assert.equal(spire.name, "Meridian Spire");
  assert.equal(spire.direction, "north");
});

test("offices, apartments, pods, servers and plant decks: daily limits and sinks hold", () => {
  const total = (host: ReturnType<typeof fakeHost>) => [...host.inventory.values()].reduce((a, b) => a + b, 0);
  // Offices and plant decks: at most one find per floor per day.
  for (const variant of ["offices", "plant-deck"] as const) {
    const spec = upperOf(variant), host = fakeHost(0);
    for (let i = 0; i < 6; i++) applyGroundLife(spec, host);
    assert.ok(total(host) <= 1 && host.earned <= 4, `${variant}: one find a day`);
    assert.ok(host.lines.length >= 6, `${variant}: always a line`);
  }
  // The daily caps hold across many floors.
  const cap = fakeHost(0);
  const offices = uppers.filter(place => upperVariant(place) === "offices");
  for (const place of offices) applyGroundLife(groundLifeSpec(place) as GroundLifeSpec, cap);
  assert.ok(total(cap) <= DAILY_ITEM_CAP && cap.earned <= DAILY_CREDIT_CAP, "daily caps hold across floors");
  // Apartments: always a resident line; a gift is rare and at most one a day.
  const apt = upperOf("apartments"), aptHost = fakeHost(0);
  for (let i = 0; i < 40; i++) applyGroundLife(apt, aptHost);
  assert.ok(aptHost.lines.length >= 40);
  assert.ok(total(aptHost) <= 1, "one gift per floor per day");
  // Pods rest for 15 cr; servers lock out after a take.
  const pod = upperOf("pods"), podHost = fakeHost(0, 15);
  applyGroundLife(pod, podHost);
  assert.equal(podHost.credits, 0);
  assert.equal(podHost.rested, 1);
  applyGroundLife(pod, podHost);
  assert.equal(podHost.rested, 1, "short on credits: no rest");
  const server = upperOf("servers"), serverHost = fakeHost(0);
  for (let i = 0; i < 5; i++) applyGroundLife(server, serverHost);
  assert.ok(total(serverHost) <= 1);
  assert.match(serverHost.lines[serverHost.lines.length - 1], /locked you out/);
});

test("ledger: upper keys are stored as plain numbers and round-trip", () => {
  const ledger = new GroundLifeLedger(), a = upperOf("sky-bar").key, b = upperOf("penthouse").key;
  ledger.take(a); ledger.take(b); ledger.take(12);
  const back = GroundLifeLedger.parse(ledger.serialize());
  assert.ok(back.isTaken(a) && back.isTaken(b) && back.isTaken(12));
  assert.equal(back.takenCount, 3);
  assert.ok(ledger.serialize().length < 200, "the save stays small");
});
