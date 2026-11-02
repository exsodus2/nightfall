import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const [{ CityWorld, FORM, SKIN }, { buildingParts, skinAlpha, PART_SKIN, FLAG, roofSpots }] = await Promise.all([
  import("../src/city/world.ts"),
  import("../src/city/architecture.ts"),
]);
const world = new CityWorld();
const of = (form: number) => world.buildings.filter(b => b.form === form);

test("the stacked, lift-core and billboard-wrapped families appear, typed for visibility.ts", () => {
  for (const [form, min] of [[FORM.STACKED, 40], [FORM.CORE, 20], [FORM.WRAPPED, 20]] as const) assert.ok(of(form).length >= min, `form ${form}: ${of(form).length}`);
  // Setback families keep the slim 0.64 core visibility.ts assumes for type 7.
  for (const b of [...of(FORM.STACKED), ...of(FORM.CORE)]) assert.equal(b.style, 7);
  for (const b of of(FORM.WRAPPED)) assert.notEqual(b.style, 7);
});

test("stacked tiers turn crosswise over plant floors", () => {
  for (const b of of(FORM.STACKED)) {
    const tiers = buildingParts(b).filter(p => p.surface === 0 && p.alpha < skinAlpha(PART_SKIN.MACHINE) && p.h > 8 && -p.y - p.h / 2 > 5);
    assert.ok(tiers.length >= 2, `Building ${b.id} has ${tiers.length} tiers`);
    // A tier runs along x when it spans the whole plot width (it is 0.76 of it otherwise).
    const alongX = (p: { w: number }) => p.w >= b.width - 0.01;
    for (let i = 1; i < tiers.length; i++) assert.notEqual(alongX(tiers[i]), alongX(tiers[i - 1]), `Building ${b.id} tier ${i} does not turn`);
  }
});

test("lift cores run a shader-drawn car in their open shaft, billboard wraps a neon frame", () => {
  for (const b of of(FORM.CORE)) {
    const parts = buildingParts(b);
    // No separate car part (it would z-fight the lattice): the shaft itself is flagged to draw it.
    assert.equal(parts.filter(p => p.alpha === skinAlpha(PART_SKIN.NEON) && p.h > 2.5).length, 0, `Building ${b.id}`);
    const shafts = parts.filter(p => p.alpha === skinAlpha(PART_SKIN.LATTICE) && (p.message & FLAG.PULSE) !== 0);
    assert.equal(shafts.length, 1, `Building ${b.id}`);
    assert.ok(shafts[0].h > 20);
  }
  for (const b of of(FORM.WRAPPED)) {
    // Wall screens (rooftop billboards stand above the roof).
    const screens = buildingParts(b).filter(p => p.alpha === skinAlpha(PART_SKIN.SCREEN) && p.h > 8 && -p.y - p.h / 2 < b.height - 1);
    if (b.height < 40) continue;
    assert.ok(screens.length >= 2, `Building ${b.id} wraps ${screens.length} screens`);
    // Above every street anchor (fascia, blade signs, hologram screens at 34 m hang on the plot face).
    for (const s of screens) assert.ok(-s.y - s.h / 2 >= 13 && (s.message & (FLAG.CROWN | FLAG.CORNERS)) === (FLAG.CROWN | FLAG.CORNERS));
  }
});

test("neighbouring plots rarely repeat a family and facade, and the batch stays within budget", () => {
  let pairs = 0, same = 0, parts = 0;
  for (const block of world.blocks.values()) {
    const list = block.buildings;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { pairs++; if (list[i].form === list[j].form && list[i].skin === list[j].skin) same++; }
  }
  assert.ok(same / pairs < 0.02, `${same} of ${pairs} plot pairs repeat`);
  for (const b of world.buildings) parts += buildingParts(b).length;
  // One static instance buffer: about 19 parts a building (41.3k before the new families).
  assert.ok(parts < 44_000, `${parts} building parts`);
});

/** Main masses and other windowed boxes of a building (part materials and tickers excluded). */
const massesOf = (b: (typeof world.buildings)[number]) => buildingParts(b).filter(p => p.surface === 0 && p.alpha < skinAlpha(PART_SKIN.MACHINE));

test("dark towers stand between the neon ones: no crown, corners or bands, one aviation light on top", () => {
  const dark = [0, 0, 0, 0, 0, 0], tall = [0, 0, 0, 0, 0, 0];
  for (const b of world.buildings) {
    if (b.height > 48) tall[b.district]++;
    const masses = massesOf(b), unlit = masses.filter(p => (p.message & FLAG.DARK) !== 0);
    if (!unlit.length) continue;
    dark[b.district]++;
    for (const p of unlit) assert.equal(p.message & (FLAG.CORNERS | FLAG.BANDS), 0, `Building ${b.id}`);
    // FLAG.DARK | FLAG.CROWN marks the one mass whose top corner carries the red light.
    assert.equal(unlit.filter(p => (p.message & FLAG.CROWN) !== 0).length, 1, `Building ${b.id} aviation lights`);
    // The street base keeps its lights.
    assert.ok(masses.some(p => (p.message & FLAG.DARK) === 0 && -p.y - p.h / 2 < 0.5), `Building ${b.id} base`);
  }
  assert.equal(dark[5], 0, "the low Spillway has no dark towers");
  for (const district of [0, 1, 2, 4]) assert.ok(dark[district] >= 3, `district ${district}: ${dark[district]} dark towers`);
  // Neon Ward keeps most of its towers crowned, but a good share stand dark between them.
  assert.ok(dark[1] / tall[1] > 0.1 && dark[1] / tall[1] < 0.4, `Neon Ward: ${dark[1]} of ${tall[1]} tall towers dark`);
});

test("Spillway capsule hotels wear a pod grid, and external lifts climb tall towers elsewhere", () => {
  const hotels = world.buildings.filter(b => massesOf(b).some(p => (p.message & FLAG.CAPSULE) !== 0));
  assert.ok(hotels.length >= 5, `${hotels.length} capsule hotels`);
  for (const b of hotels) {
    assert.equal(b.district, 5);
    for (const p of massesOf(b).filter(m => (m.message & FLAG.CAPSULE) !== 0)) assert.equal(p.alpha, skinAlpha(SKIN.PANEL), `Building ${b.id}`);
  }
  const lifts = world.buildings.filter(b => massesOf(b).some(p => (p.message & FLAG.PULSE) !== 0));
  assert.ok(lifts.length >= 10, `${lifts.length} external lifts`);
  for (const b of lifts) {
    assert.notEqual(b.district, 5);
    // One shaft a building, on a mass tall enough for the car to travel.
    const shafts = massesOf(b).filter(p => (p.message & FLAG.PULSE) !== 0);
    assert.equal(shafts.length, 1, `Building ${b.id}`);
    assert.ok(shafts[0].h > 30);
  }
});

test("rooftop venues trade the roof furniture for a small kit standing on the roof", () => {
  let parts = 0;
  for (const b of world.buildings) parts += buildingParts(b).length;
  // Venues swap furniture rather than add to it: the batch stays at about today's 41k parts.
  assert.ok(parts < 41_500, `${parts} building parts`);
  const spots = [...world.blocks.values()].flatMap(block => roofSpots(block.x, block.z));
  const byId = new Map(world.buildings.map(b => [b.id, b]));
  const venues = spots.filter(s => s.venue >= 0);
  assert.ok(venues.length >= 30, `${venues.length} venues`);
  for (const s of venues) {
    const b = byId.get(s.id);
    assert.ok(b, `Spot ${s.id} has a building`);
    const [start, end] = s.venueParts, kit = buildingParts(b).slice(start, end);
    assert.ok(kit.length >= 3 && kit.length <= 8, `Building ${s.id} venue has ${kit.length} parts`);
    for (const p of kit) {
      // Nothing protrudes below the roof slab or past its edges.
      assert.ok(-p.y - p.h / 2 >= s.y - 0.01, `Building ${s.id} venue part dips below the roof`);
      assert.ok(Math.abs(p.x - s.x) + p.w / 2 <= s.w / 2 + 0.01 && Math.abs(p.z - s.z) + p.d / 2 <= s.d / 2 + 0.01, `Building ${s.id} venue part overhangs the roof`);
      // Clear of the stair bulkhead on the -sx half of the roof.
      assert.ok((p.x - s.x) * s.sx - p.w / 2 >= -0.14 * s.w / 2 - 0.01, `Building ${s.id} venue part meets the bulkhead`);
    }
  }
});
