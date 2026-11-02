import assert from "node:assert/strict";
import test from "node:test";
import { OPEN_HOLOGRAMS, ROOF_HOLO_MIN_HEIGHT, plotHolograms, type HoloSite } from "../src/city/vfx.ts";
import { CityWorld, LANDMARKS, RAIL_DECK_HEIGHT, RAIL_SOLIDS, type Building } from "../src/city/world.ts";

const world = new CityWorld();
const inside = (b: Building, x: number, z: number, margin: number) => Math.abs(x - b.x) < b.width / 2 + margin && Math.abs(z - b.z) < b.depth / 2 + margin;
const top = (s: HoloSite) => s.y + s.height * 0.96;

test("street holograms hang low over pavements and alleys, never inside a building", () => {
  const sites = world.buildings.flatMap(b => plotHolograms(b).filter(s => s.mount !== "roof").map(s => ({ s, b })));
  assert.ok(sites.filter(({ s }) => s.mount === "wall").length > 150, "every fifth shopfront carries one");
  assert.ok(sites.filter(({ s }) => s.mount === "cable").length > 40, "alley mouths carry some");
  for (const { s } of sites) {
    assert.ok(s.y >= 6 && top(s) <= 20, `site at ${s.x},${s.z} spans ${s.y}-${top(s)} m`);
    // The projection (half its width either side of the axis) stays out of every building.
    for (const other of world.buildings) assert.ok(!inside(other, s.x, s.z, 0.2), `site at ${s.x},${s.z} is inside building ${other.id}`);
    assert.ok(s.seed >= 0 && s.seed < 1 && Number.isInteger(s.tint) && Number.isInteger(s.row));
  }
  // Facade towers keep their tall hologram or screen only.
  for (const { b, s } of sites) if (s.mount === "wall") assert.ok(b.id % 11 !== 0 && b.id % 17 !== 0);
  // Deterministic.
  assert.deepEqual(plotHolograms(world.buildings[42]), plotHolograms(world.buildings[42]));
});

test("avenue and plaza holograms clear the rail, stations, landmarks and the gate", () => {
  const avenue = OPEN_HOLOGRAMS.filter(s => s.mount === "cable"), plinths = OPEN_HOLOGRAMS.filter(s => s.mount === "plinth");
  assert.ok(avenue.length >= 6 && plinths.length === 10);
  for (const s of avenue) {
    assert.equal(s.x, 0);
    assert.ok(top(s) < RAIL_DECK_HEIGHT - 4 && s.y >= 8, "between the traffic and the service bridges");
    assert.ok(Math.abs(Math.abs(s.z) - 320) >= 56 && Math.abs(s.z - 208) >= 48);
  }
  for (const s of plinths) {
    assert.ok(s.y < 1 && top(s) < 8, "on a pedestal, twice life size");
    for (const solid of RAIL_SOLIDS) assert.ok(Math.hypot(s.x - solid.x, s.z - solid.z) > 8, `pedestal at ${s.x},${s.z} by a rail column`);
    for (const landmark of LANDMARKS) assert.ok(Math.hypot(s.x - landmark.x, s.z - landmark.z) > 18, `pedestal at ${s.x},${s.z} on ${landmark.id}`);
    for (const b of world.buildings) assert.ok(!inside(b, s.x, s.z, 3), `pedestal at ${s.x},${s.z} by building ${b.id}`);
    // Inside its plaza block, well off the streets (centre lines at multiples of 64).
    const local = (v: number) => ((v % 64) + 64) % 64;
    assert.ok(Math.min(local(s.x), 64 - local(s.x)) > 10 && Math.min(local(s.z), 64 - local(s.z)) > 10);
  }
});

test("landmark holograms stand over the roofs of the two or three tallest towers, far apart", () => {
  const roofs = world.buildings.flatMap(b => plotHolograms(b).filter(s => s.mount === "roof").map(s => ({ s, b })));
  assert.ok(roofs.length >= 1 && roofs.length <= 3, `${roofs.length} roof holograms`);
  for (const { s, b } of roofs) {
    assert.ok(b.height >= ROOF_HOLO_MIN_HEIGHT && b.id % 11 !== 0, "tall towers without a facade hologram");
    assert.ok(Math.hypot(s.x - b.x, s.z - b.z) < 1e-6 && s.y > b.height && s.y < b.height + 3, "emitter on the roof");
    assert.ok(s.height >= 40, "landmark scale");
    // The shader's landmark seed: 1 + subject (a holoSubject kind), the site's seed in the fraction.
    const subject = Math.floor(s.seed) - 1, fraction = s.seed - Math.floor(s.seed);
    assert.ok([0, 2, 10].includes(subject) && fraction >= 0 && fraction < 0.5, `seed ${s.seed}`);
  }
  for (const a of roofs) for (const b of roofs) if (a !== b) assert.ok(Math.hypot(a.s.x - b.s.x, a.s.z - b.s.z) > 200);
  // Different subjects, so the skyline does not repeat itself.
  assert.equal(new Set(roofs.map(({ s }) => Math.floor(s.seed))).size, roofs.length);
  // Shorter towers carry none.
  for (const b of world.buildings) if (b.height < ROOF_HOLO_MIN_HEIGHT) assert.ok(plotHolograms(b).every(s => s.mount !== "roof"));
});
