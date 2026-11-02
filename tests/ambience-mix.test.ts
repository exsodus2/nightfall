import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANT_HZ, CLUB_BEAT, CLUB_RANGE, FLARE_LAUNCHES, FOGHORN_GAP, FOUNDRY, GARDENS, HARBOUR_RANGE, MARKET, NEON, PASS_RANGE, SPILLWAY, TRAIN_RANGE,
  WATER_EDGE, ambienceEdges, ambienceLevels, ambienceRates, carPass, clubLeak, districtWeights, eventCues, eventPresence, eventRange,
  flareClimb, foghornGap, harbourNear, poissonCount, stepInterval, stepSurface, streetPresence, weatherDrift,
  type AmbienceCityEvent, type AmbienceFrame,
} from "../src/audio/ambience-mix.ts";
import { nearestCar, nearestEvent, nearestTrain, venueDistance, windGust } from "../src/audio/ambience-probe.ts";
import { DISTRICTS, districtAt } from "../src/city/world.ts";
import { METRO_CYCLE } from "../src/city/metro.ts";
import { HARBOUR_COPING, HARBOUR_ROAD, HARBOUR_WALL, harbourZone } from "../src/city/harbour.ts";
import { COMFORT_HZ, activeEvents } from "../src/city/city-events.ts";
import type { InteriorKind } from "../src/city/interiors.ts";

const frame = (patch: Partial<AmbienceFrame> = {}): AmbienceFrame => ({
  district: 1, x: 0, y: 2.7, z: -320, interior: false, rain: true, weather: 0.5, speed: 0, walking: true, driving: false, boost: false,
  riding: false, ridingSpeed: 0, lift: false, trainDistance: Infinity, trainSpeed: 0, trainBraking: false, car: null, time: 0, ...patch,
});
const at = (district: number, patch: Partial<AmbienceFrame> = {}): AmbienceFrame => frame({ district, x: DISTRICTS[district].x, z: DISTRICTS[district].z, ...patch });

test("district weights are one-hot inside each district (matching districtAt) and sum to 1 everywhere", () => {
  for (let x = -700; x <= 700; x += 37) for (let z = -700; z <= 700; z += 41) {
    const w = districtWeights(x, z), sum = w.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `sum at ${x},${z}`);
    assert.ok(w.every((v) => v >= 0 && v <= 1));
    const nearBorder = Math.abs(Math.abs(x) - 256) < 48 || Math.abs(z) < 48;
    if (!nearBorder) assert.equal(w[districtAt(x, z).id], 1, `one-hot at ${x},${z}`);
  }
  const border = districtWeights(256, -320); // Neon Ward / Ghost Circuit line
  assert.ok(Math.abs(border[NEON] - 0.5) < 1e-9 && Math.abs(border[2] - 0.5) < 1e-9);
});

test("the storm drifts slowly inside 0..1 and an explicit weather value wins", () => {
  let last = weatherDrift(0);
  for (let t = 0; t < 3600; t += 1) {
    const value = weatherDrift(t);
    assert.ok(value >= 0 && value <= 1);
    assert.ok(Math.abs(value - last) < 0.02, `no jumps at ${t}s`);
    last = value;
  }
  assert.equal(weatherDrift(Number.NaN), weatherDrift(0));
  assert.ok(ambienceLevels(frame({ weather: 1 })).rain > ambienceLevels(frame({ weather: 0 })).rain);
  assert.ok(ambienceLevels(frame({ weather: 1 })).rainTone > ambienceLevels(frame({ weather: 0 })).rainTone);
});

test("the rain bed follows the rain setting; the rest of the city does not", () => {
  const dry = ambienceLevels(frame({ rain: false })), wet = ambienceLevels(frame({ rain: true }));
  assert.equal(dry.rain, 0);
  assert.ok(wet.rain > 0 && wet.rain <= 0.15);
  assert.equal(dry.hum, wet.hum);
  assert.ok(dry.traffic > 0);
});

test("each district has its own colour", () => {
  const foundry = ambienceLevels(at(FOUNDRY)), neon = ambienceLevels(at(NEON)), ghost = ambienceLevels(at(2));
  const gardens = ambienceLevels(at(GARDENS)), market = ambienceLevels(at(MARKET)), spillway = ambienceLevels(at(SPILLWAY));
  assert.ok(foundry.rumble > 0.05 && foundry.furnace > 0);
  assert.equal(spillway.rumble, 0);
  assert.ok(neon.buzz > market.buzz && market.buzz > 0 && gardens.buzz === 0);
  assert.ok(neon.voices > 0 && market.voices > neon.voices && gardens.voices === 0);
  assert.ok(market.voiceTone > neon.voiceTone, "market chatter is brighter than the Neon murmur");
  assert.ok(ghost.crackle > 0 && neon.crackle === 0);
  assert.ok(gardens.insects > 0 && gardens.water > 0 && spillway.water > gardens.water);
  assert.ok(market.sizzle > 0 && foundry.sizzle === 0);
  assert.ok(gardens.traffic < neon.traffic, "the gardens are quieter");
  const rates = (d: number) => ambienceRates(at(d));
  assert.ok(rates(GARDENS).drips > rates(NEON).drips);
  assert.ok(rates(2).chirps > 0 && rates(NEON).chirps === 0);
  assert.ok(rates(SPILLWAY).gulls > 0 && rates(FOUNDRY).gulls === 0);
});

test("interiors muffle the street and add a room tone; one-shots stop", () => {
  const outside = ambienceLevels(at(NEON)), inside = ambienceLevels(at(NEON, { interior: true }));
  assert.equal(outside.outdoor, 1); assert.equal(outside.room, 0);
  assert.ok(inside.outdoor < 0.3 && inside.muffle < 1000 && inside.room > 0);
  assert.deepEqual(ambienceRates(at(GARDENS, { interior: true })), { drips: 0, chirps: 0, gulls: 0 });
});

test("height thins the street layers but keeps the rain", () => {
  assert.equal(streetPresence(2.7), 1);
  assert.ok(streetPresence(200) <= 0.31);
  const ground = ambienceLevels(at(NEON)), high = ambienceLevels(at(NEON, { y: 150 }));
  assert.ok(high.voices < ground.voices * 0.5 && high.traffic < ground.traffic);
  assert.equal(high.rain, ground.rain);
});

test("the car engine only plays while driving, rising with speed and boost", () => {
  assert.equal(ambienceLevels(frame({ speed: 20 })).engine, 0);
  const idle = ambienceLevels(frame({ driving: true, walking: false, speed: 0 }));
  const fast = ambienceLevels(frame({ driving: true, walking: false, speed: 30 }));
  const boost = ambienceLevels(frame({ driving: true, walking: false, speed: 30, boost: true }));
  assert.ok(idle.engine > 0 && fast.engine > idle.engine && boost.engine > fast.engine);
  assert.ok(fast.enginePitch > idle.enginePitch && boost.enginePitch > fast.enginePitch && boost.enginePitch < 260);
  assert.equal(ambienceLevels(frame({ driving: true, speed: -10 })).enginePitch, ambienceLevels(frame({ driving: true, speed: 10 })).enginePitch, "reverse sounds like forward");
  assert.ok(boost.boost > 0 && fast.boost === 0);
});

test("trains are heard within range, louder and brighter as they near, and not while riding", () => {
  const far = ambienceLevels(frame({ trainDistance: TRAIN_RANGE + 1, trainSpeed: 15 }));
  const mid = ambienceLevels(frame({ trainDistance: 30, trainSpeed: 15 }));
  const close = ambienceLevels(frame({ trainDistance: 5, trainSpeed: 15 }));
  assert.equal(far.train, 0);
  assert.ok(close.train > mid.train && mid.train > 0 && close.trainTone > mid.trainTone);
  assert.equal(ambienceLevels(frame({ trainDistance: 5, trainSpeed: 15, riding: true, ridingSpeed: 15 })).train, 0);
  const ride = ambienceLevels(frame({ riding: true, ridingSpeed: 18 })), dwell = ambienceLevels(frame({ riding: true, ridingSpeed: 0 }));
  assert.ok(ride.carriage > dwell.carriage && dwell.carriage > 0);
});

test("every level stays finite and non-negative for odd input", () => {
  const odd = [Number.NaN, Infinity, -Infinity, -1e9, 1e9, 0];
  for (const v of odd) {
    const event: AmbienceCityEvent = { id: 1, kind: "substation", distance: v, age: v, level: v };
    const levels = ambienceLevels(frame({ x: v, z: v, y: v, speed: v, time: v, ridingSpeed: v, trainSpeed: v, weather: v, gust: v, club: v, event, trainDistance: v }));
    for (const [key, value] of Object.entries(levels)) if (Number.isFinite(value)) assert.ok(value >= 0, `${key}=${value}`);
    const rates = ambienceRates(frame({ x: v, z: v, y: v, time: v, event: { ...event, kind: "checkpoint" } }));
    for (const value of Object.values(rates)) assert.ok(!(value < 0));
  }
});

test("footstep cadence: none standing, quicker when running, within human limits", () => {
  assert.equal(stepInterval(0), null);
  assert.equal(stepInterval(0.5), null);
  assert.equal(stepInterval(Number.NaN), null);
  const walk = stepInterval(1.6), run = stepInterval(6);
  assert.ok(walk !== null && run !== null && run < walk);
  assert.ok(walk >= 0.26 && walk <= 0.62 && run >= 0.26);
  assert.equal(stepInterval(40), 0.26);
});

test("Poisson counts: none at zero rate, the right mean otherwise", () => {
  assert.equal(poissonCount(0, 1, 0.99), 0);
  assert.equal(poissonCount(5, 0, 0.99), 0);
  let total = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) total += poissonCount(0.5, 0.16, (i + 0.5) / n);
  assert.ok(Math.abs(total / n - 0.08) < 0.01, `mean ${total / n}`);
  assert.ok(poissonCount(100, 1, 0.999) <= 3, "capped");
});

test("a car whooshes once as it passes close at speed", () => {
  const steps = [30, 18, 8, 4, 6, 12, 20];
  let track = null, passes = 0;
  for (const distance of steps) { const result = carPass(track, { id: 7, distance, speed: 12 }, 0); track = result.track; if (result.pass) passes++; }
  assert.equal(passes, 1);
  track = null; passes = 0;
  for (const distance of steps) { const result = carPass(track, { id: 7, distance, speed: 1 }, 0); track = result.track; if (result.pass) passes++; }
  assert.equal(passes, 0, "a crawling car does not whoosh");
  track = null; passes = 0;
  for (const distance of [40, 25, 15, 25, 40]) { const result = carPass(track, { id: 3, distance, speed: 15 }, 0); track = result.track; if (result.pass) passes++; }
  assert.equal(passes, 0, "a car that stays beyond 10 m does not whoosh");
  assert.equal(carPass({ id: 1, distance: 3, closest: 3, passed: false }, { id: 2, distance: 5, speed: 20 }, 0).pass, false, "a new car restarts the track");
});

test("edges: lift dings at start and stop, doors on interior changes, one squeal per approach", () => {
  assert.deepEqual(ambienceEdges(null, frame({ lift: true })), { ding: false, door: false, squeal: false });
  assert.equal(ambienceEdges(frame(), frame({ lift: true })).ding, true);
  assert.equal(ambienceEdges(frame({ lift: true }), frame()).ding, true);
  assert.equal(ambienceEdges(frame(), frame({ interior: true })).door, true);
  const braking = frame({ trainBraking: true, trainDistance: 30 });
  assert.equal(ambienceEdges(frame(), braking).squeal, true);
  assert.equal(ambienceEdges(braking, braking).squeal, false);
  assert.equal(ambienceEdges(frame(), frame({ trainBraking: true, trainDistance: 30, riding: true })).squeal, false);
});

test("probe: nearest train and car", () => {
  for (let t = 0; t < METRO_CYCLE; t += METRO_CYCLE / 13) {
    const near = nearestTrain(t, 0, 2.7, 0);
    assert.ok(Number.isFinite(near.distance) && near.distance >= 0);
    if (near.braking) assert.ok(near.distance < TRAIN_RANGE && near.speed > 1);
  }
  const cars = [{ id: 1, x: 10, z: 0, speed: 5 }, { id: 2, x: 3, z: 4, speed: 9 }];
  assert.deepEqual(nearestCar(cars, 0, 0), { id: 2, distance: 5, speed: 9, heavy: false });
  assert.equal(nearestCar([], 0, 0), null);
  assert.equal(nearestCar([{ id: 4, x: 2, z: 0, speed: 7, kind: "bus" }, { id: -4, x: 1, z: 0, speed: 7, trailing: true }], 0, 0)?.heavy, true, "a bus is heavy; its rear footprint is skipped");
  assert.equal(nearestCar([{ id: 5, x: 2, z: 0, speed: 7, kind: "moto" }], 0, 0)?.heavy, false);
});

test("trains far out of range (or none at all) are silent", () => {
  assert.equal(ambienceLevels(frame({ trainDistance: Infinity, trainSpeed: 15 })).train, 0);
  assert.equal(ambienceLevels(frame({ trainDistance: Number.NaN, trainSpeed: 15 })).train, 0);
});

test("harbour: the water edge matches harbour.ts, the swell and gulls are heard near it and not inland", () => {
  assert.equal(WATER_EDGE, HARBOUR_ROAD + HARBOUR_WALL + HARBOUR_COPING);
  assert.equal(harbourZone(WATER_EDGE + 0.5, 0), "water");
  assert.equal(harbourZone(0, -(WATER_EDGE - 0.5)), "wall");
  assert.equal(harbourNear(0, -WATER_EDGE - 50), 1, "out over the water");
  assert.equal(harbourNear(WATER_EDGE - HARBOUR_RANGE - 1, 0), 0);
  const rim = frame({ x: 40, z: -(HARBOUR_ROAD + 2) }), inland = frame({ x: 40, z: -320 });
  assert.ok(harbourNear(rim.x, rim.z) > 0.8, "the rim road is close to the water");
  assert.ok(ambienceLevels(rim).swell > 0.04 && ambienceLevels(inland).swell === 0);
  assert.ok(ambienceRates(rim).gulls > ambienceRates(inland).gulls + 0.05);
});

test("wind swells with gusts and is strongest on the rim, more so up on the Rim Line deck", () => {
  const rim = { x: 40, z: -(HARBOUR_ROAD + 2) };
  const calm = ambienceLevels(frame({ ...rim, gust: 0 })), gusty = ambienceLevels(frame({ ...rim, gust: 1 }));
  assert.ok(gusty.wind > calm.wind * 3 && gusty.windTone > calm.windTone);
  const street = ambienceLevels(frame({ x: 40, z: -320, gust: 1 })), deck = ambienceLevels(frame({ ...rim, y: 40, gust: 1 }));
  assert.ok(gusty.wind > street.wind * 2 && deck.wind > gusty.wind);
  assert.ok(deck.wind < 0.08, "still a quiet layer");
  for (let t = 0; t < 600; t += 7) { const g = windGust(t); assert.ok(g >= 0 && g <= 1); }
  assert.equal(windGust(Number.NaN), 0);
});

test("foghorns are at least FOGHORN_GAP apart", () => {
  assert.ok(FOGHORN_GAP >= 90);
  for (const r of [0, 0.3, 0.999, 1, Number.NaN, -1, 2]) assert.ok(foghornGap(r) >= FOGHORN_GAP && foghornGap(r) <= FOGHORN_GAP + 120);
});

const ev = (kind: string, patch: Partial<AmbienceCityEvent> = {}): AmbienceCityEvent => ({ id: 9, kind, distance: 20, age: 40, level: 1, ...patch });

test("city events: each has its bed near its site, fading with distance and its envelope; the satellite is silent", () => {
  const beds: [string, keyof ReturnType<typeof ambienceLevels>][] = [["substation", "transformer"], ["substation", "sparks"], ["drones", "drones"], ["protest", "march"], ["checkpoint", "chatter"], ["flare", "flareHiss"]];
  for (const [kind, key] of beds) {
    const near = ambienceLevels(frame({ event: ev(kind) }))[key];
    assert.ok(near > 0, `${kind} ${key}`);
    assert.equal(ambienceLevels(frame({ event: ev(kind, { distance: eventRange(kind) + 1 }) }))[key], 0, `${kind} out of range`);
    assert.equal(ambienceLevels(frame({ event: ev(kind, { level: 0 }) }))[key], 0, `${kind} before it blooms`);
    assert.equal(ambienceLevels(frame({ event: ev(kind, { distance: Infinity }) }))[key], 0);
    assert.ok(ambienceLevels(frame({ event: ev(kind, { distance: eventRange(kind) * 0.7 }) }))[key] < near, `${kind} fades with distance`);
    assert.ok(near < 0.07, `${kind} ${key} stays soft`);
  }
  assert.ok(eventRange("checkpoint") >= 140 && eventRange("checkpoint") <= 160);
  assert.equal(eventRange("satellite"), 0);
  const quiet = ambienceLevels(frame()), satellite = ambienceLevels(frame({ event: ev("satellite", { distance: 0 }) }));
  assert.deepEqual(satellite, quiet);
  assert.equal(eventPresence(frame({ event: ev("checkpoint") }), "substation"), 0, "only the running kind");
  assert.ok(ambienceRates(frame({ event: ev("checkpoint") })).chirps > 0.2, "CorpSec radios chirp at the checkpoint");
  const climbing = ambienceLevels(frame({ event: ev("flare", { age: FLARE_LAUNCHES[1] + 3 }) })), hanging = ambienceLevels(frame({ event: ev("flare", { age: 16 }) }));
  assert.ok(climbing.flareHiss > hanging.flareHiss * 2 && hanging.flareHiss > 0);
  assert.equal(flareClimb(-5), 0);
});

test("event cues: a hush per lantern release, a thump per flare launch, none when walking in late or far away", () => {
  const at = (event: AmbienceCityEvent | null): AmbienceFrame => frame({ event });
  assert.equal(eventCues(null, at(ev("flare", { age: 0.1 }))).thump, true, "a flare seen as it launches");
  assert.equal(eventCues(at(ev("flare", { age: 23.9 })), at(ev("flare", { age: 24.1 }))).thump, true, "the second launch");
  assert.equal(eventCues(at(ev("flare", { age: 24.1 })), at(ev("flare", { age: 24.3 }))).thump, false, "once");
  assert.equal(eventCues(null, at(ev("flare", { age: 24.1 }))).thump, false, "walked in after the launch");
  assert.equal(eventCues(at(null), at(ev("flare", { age: 30 }))).thump, false);
  assert.equal(eventCues(at(ev("flare", { age: 23.9, id: 1 })), at(ev("flare", { age: 24.1, id: 2 }))).thump, false, "a different event does not count");
  assert.equal(eventCues(at(ev("flare", { age: 23.9, distance: 900 })), at(ev("flare", { age: 24.1, distance: 900 }))).thump, false, "too far");
  assert.equal(eventCues(at(ev("lanterns", { age: 0.8 })), at(ev("lanterns", { age: 1.1 }))).hush, true);
  assert.equal(eventCues(at(ev("lanterns", { age: 19.9 })), at(ev("lanterns", { age: 20.2 }))).hush, true);
  assert.equal(eventCues(at(ev("lanterns", { age: 5 })), at(ev("lanterns", { age: 5.2 }))).hush, false);
  assert.deepEqual(eventCues(at(ev("flare", { age: -0.1 })), frame({ event: ev("flare", { age: 0.1 }), interior: true })), { hush: false, thump: false }, "not indoors");
});

test("The Static: bass leaks by the door within CLUB_RANGE; inside, the pad, crowd and pulse; all at or under 0.4 Hz", () => {
  const nightclub: InteriorKind = "nightclub";
  assert.ok(1 / CLUB_BEAT <= COMFORT_HZ + 1e-9 && CHANT_HZ <= COMFORT_HZ, "comfort rule");
  const door = ambienceLevels(frame({ club: 3 })), mid = ambienceLevels(frame({ club: 15 })), far = ambienceLevels(frame({ club: CLUB_RANGE + 1 }));
  assert.ok(door.club > mid.club && mid.club > 0 && far.club === 0);
  assert.ok(door.clubTone <= 200, "only the bass comes through the wall");
  assert.equal(door.clubCrowd, 0);
  assert.equal(ambienceLevels(frame()).club, 0, "no club distance: silent");
  assert.equal(clubLeak(frame({ club: 3, y: 40 })), 0, "not up on the Rim Line deck");
  const inside = ambienceLevels(frame({ interior: true, venue: nightclub, club: Infinity }));
  assert.ok(inside.club > door.club && inside.clubTone > door.clubTone && inside.clubCrowd > 0 && inside.clubBed > 0);
  const teahouse = ambienceLevels(frame({ interior: true, venue: "teahouse", club: 3 }));
  assert.equal(teahouse.club, 0, "other venues do not hear the club");
});

test("footstep surfaces: metal on a platform, wet in the rain outdoors, dry indoors", () => {
  assert.equal(stepSurface(frame({ platform: true })), "metal");
  assert.equal(stepSurface(frame({ rain: true })), "wet");
  assert.equal(stepSurface(frame({ rain: false })), "dry");
  assert.equal(stepSurface(frame({ rain: true, interior: true })), "dry");
});

test("a bus or truck rumbles past from a little further out than a car whooshes", () => {
  const steps = [30, 20, 12, 13, 20];
  const run = (heavy: boolean): number => {
    let track = null, passes = 0;
    for (const distance of steps) { const result = carPass(track, { id: 4, distance, speed: 9, heavy }, 0); track = result.track; if (result.pass) passes++; }
    return passes;
  };
  assert.ok(Math.min(...steps) > PASS_RANGE);
  assert.equal(run(false), 0);
  assert.equal(run(true), 1);
});

test("probe: the running event nearest the listener, and venue doors", () => {
  let found = 0;
  for (let t = 0; t < 4000 && found < 3; t += 13) {
    const running = activeEvents(t).filter((event) => event.kind !== "satellite");
    if (running.length === 0) continue;
    found++;
    const target = running[0], heard = nearestEvent(t, target.x, target.z);
    assert.ok(heard && heard.distance < 1e-6 && heard.kind === target.kind && heard.id === target.id);
    assert.ok(heard.level >= 0 && heard.level <= 1 && heard.age >= 0);
  }
  assert.ok(found > 0, "some happening runs in the first hour");
  for (let t = 0; t < 4000; t += 29) assert.ok(nearestEvent(t, 0, 0)?.kind !== "satellite");
  const places = [{ kind: "nightclub", entrance: { x: -45, z: -390 } }, { kind: "teahouse", entrance: { x: 0, z: 0 } }];
  assert.equal(venueDistance(places, "nightclub", -42, -386), 5);
  assert.equal(venueDistance(places, "clinic", 0, 0), Infinity);
});
