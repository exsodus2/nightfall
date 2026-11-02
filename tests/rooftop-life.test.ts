import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const [{ CityWorld }, { buildingParts, roofSpots, heliports, venueLayout, VENUE, VENUE_HEIGHT }, { roofLife, spinnerAt, LIFE, ROOF_RATES, ROTOR_DEG_PER_S, SPINNER_CYCLE }] = await Promise.all([
  import("../src/city/world.ts"),
  import("../src/city/architecture.ts"),
  import("../src/city/rooftop-life.ts"),
]);
const world = new CityWorld();
// Roofs register as the building batch builds each building.
for (const b of world.buildings) buildingParts(b);
const spots = [...world.blocks.values()].flatMap(block => roofSpots(block.x, block.z));

test("every building registers its top roof once", () => {
  assert.ok(spots.length >= world.buildings.length * 0.95, `${spots.length} roofs for ${world.buildings.length} buildings`);
  assert.equal(new Set(spots.map(s => s.id)).size, spots.length);
});

test("rooftop venues: a few per district, each its own kind, never on neighbouring roofs or dark towers", () => {
  const venues = spots.filter(s => s.venue >= 0);
  const mid = spots.filter(s => s.y >= VENUE_HEIGHT[0] && s.y <= VENUE_HEIGHT[1]);
  const share = venues.length / mid.length;
  assert.ok(share > 0.025 && share < 0.08, `${venues.length} venues on ${mid.length} mid-height roofs`);
  for (let district = 0; district < 6; district++) {
    const here = venues.filter(s => s.district === district);
    assert.ok(here.length >= 3, `district ${district}: ${here.length} venues`);
    for (const s of here) assert.equal(s.venue, district, `Roof ${s.id}: one venue kind per district`);
  }
  for (const s of venues) {
    assert.equal(s.dark, false, `Roof ${s.id}: dark towers stay dark`);
    assert.equal(s.pad, false);
    assert.ok(s.y >= VENUE_HEIGHT[0] && s.y <= VENUE_HEIGHT[1]);
  }
  // Plots in a block are 26 m apart (37 m diagonally) and 38 m across a street.
  for (let i = 0; i < venues.length; i++) for (let j = i + 1; j < venues.length; j++) {
    const a = venues[i], b = venues[j];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 45, `Roofs ${a.id} and ${b.id} are neighbours`);
  }
});

test("venue decks lie on the roof clear of the bulkhead, and the bar's lounge stands on its deck", () => {
  const byId = new Map(world.buildings.map(b => [b.id, b]));
  for (const s of spots.filter(spot => spot.venue >= 0)) {
    const L = venueLayout(s.w, s.d), [x0, x1, halfZ] = L.deck, bh = L.bulkhead, b = byId.get(s.id);
    assert.ok(b, `Spot ${s.id} has a building`);
    // The layout's bulkhead is the one buildingParts stands on the roof (the bar's sign sits on it).
    const close = (a: number, c: number) => Math.abs(a - c) < 1e-6;
    assert.ok(buildingParts(b).some(p => close(p.x, s.x + s.sx * bh.x) && close(p.z, s.z) && close(p.w, 2 * bh.half) && close(p.d, 2 * bh.depth) && close(p.h, bh.h) && close(-p.y - p.h / 2, s.y)), `Roof ${s.id} bulkhead`);
    assert.ok(x0 >= bh.x + bh.half + 0.3 && x0 < x1 && x1 <= s.w / 2 && halfZ <= s.d / 2, `Roof ${s.id} deck`);
    if (s.venue !== VENUE.BAR) continue;
    // Tables with a stool either side (0.72 m out, 0.18 m wide), the heater and the leaner all on the deck.
    const on = ([ox, oz]: readonly [number, number], margin: number) => ox - margin >= x0 && ox + margin <= x1 && Math.abs(oz) + margin <= halfZ;
    for (const table of L.bar.tables) assert.ok(on(table, 0.9), `Roof ${s.id} table`);
    assert.ok(on(L.bar.heater, 0.3) && on(L.bar.leaner, 0.25), `Roof ${s.id} heater and leaner`);
    assert.ok(L.bar.sign.lift >= bh.h && L.bar.sign.width <= 3.6, `Roof ${s.id} sign`);
  }
});

test("rooftop life stays on its roof, keeps dark towers dark and fills a share of the skyline", () => {
  const counts = new Map<number, number>();
  for (const s of spots) {
    const items = roofLife(s);
    if (s.dark || s.venue >= 0) assert.equal(items.length, 0, `Roof ${s.id}`);
    for (const item of items) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
      assert.ok(Math.abs(item.x - s.x) <= s.w / 2 + 0.01 && Math.abs(item.z - s.z) <= s.d / 2 + 0.01, `Roof ${s.id} item ${item.kind} is off the roof`);
      // Anchors stand on the roof (a seated couple's floor level is a seat height below its parapet).
      assert.ok(item.y >= s.y - 0.9, `Roof ${s.id} item ${item.kind} sinks into the roof`);
      if (s.pad) assert.equal(item.kind, LIFE.WORKER, `Helipad ${s.id} carries only a worker at its edge`);
      if (item.kind === LIFE.WORKER) assert.ok(s.y > 90);
      if (item.kind === LIFE.DRIP) assert.ok(s.tank);
    }
  }
  for (const kind of Object.values(LIFE)) assert.ok((counts.get(kind) ?? 0) >= 5, `life ${kind}: ${counts.get(kind) ?? 0}`);
});

test("rooftop motion stays comfortable: every rate at most 0.4 Hz, the rotor at most 10 deg/s", () => {
  for (const [name, hz] of Object.entries(ROOF_RATES)) assert.ok(hz > 0 && hz <= 0.4, `${name}: ${hz} Hz`);
  assert.ok(ROTOR_DEG_PER_S > 0 && ROTOR_DEG_PER_S <= 10);
});

test("two or three spinners land on helipads: approach 30 s, sit 60 s, leave 30 s, never jumping", () => {
  const ports = heliports();
  assert.ok(ports.length >= 2 && ports.length <= 3, `${ports.length} heliports`);
  const { approach, sit, leave, period } = SPINNER_CYCLE;
  for (const s of ports) {
    assert.ok(s.pad && !s.dark);
    let previous = spinnerAt(s, 0), sitting = 0, flying = 0;
    const step = 0.1, headings = new Set<number>();
    for (let time = step; time <= period * 2; time += step) {
      const state = spinnerAt(s, time);
      if (state) {
        headings.add(Math.round(state.heading * 1000));
        if (state.phase === "sit") {
          sitting++;
          assert.ok(Math.abs(state.x - s.x) < 1e-9 && Math.abs(state.z - s.z) < 1e-9 && Math.abs(state.y - (s.y + 0.6)) < 1e-9, `Spinner ${s.id} sits on its pad`);
        } else flying++;
        if (previous) {
          // Slow: under 12 m/s, and the rotor turns at most 10 deg/s.
          assert.ok(Math.hypot(state.x - previous.x, state.y - previous.y, state.z - previous.z) <= 1.2, `Spinner ${s.id} jumps at ${time.toFixed(1)} s`);
          const turn = ((state.rotor - previous.rotor) % 360 + 360) % 360;
          assert.ok(turn <= 10 * step + 1e-6, `Rotor ${s.id} turns ${turn} deg in ${step} s`);
        } else {
          // It appears dissolved, out on its approach.
          assert.ok(state.fade < 0.05 && state.phase === "approach", `Spinner ${s.id} pops in at ${time.toFixed(1)} s`);
        }
      } else if (previous) {
        assert.ok(previous.fade < 0.05 && previous.phase === "leave", `Spinner ${s.id} pops out at ${time.toFixed(1)} s`);
      }
      previous = state;
    }
    assert.ok(Math.abs(sitting * step - 2 * sit) < 1, `Spinner ${s.id} sits ${sitting * step} s`);
    assert.ok(Math.abs(flying * step - 2 * (approach + leave)) < 1, `Spinner ${s.id} flies ${flying * step} s`);
    assert.equal(headings.size, 1, `Spinner ${s.id} flies one straight line`);
  }
});
