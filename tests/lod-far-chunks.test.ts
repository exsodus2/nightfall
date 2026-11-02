import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const [{ packBuildingChunks, chunkInstanceCount, FAR_LOD_BLOCKS }, { CityWorld, BLOCK_SIZE }, { buildingParts }] = await Promise.all([
  import("../src/city/building-batch.ts"),
  import("../src/city/world.ts"),
  import("../src/city/architecture.ts"),
]);
const STRIDE = 16;
const world = new CityWorld();
const { values, chunks } = packBuildingChunks(world);
const list = [...chunks.values()];
// The vertex shader's retraction: size scale of an instance seen from (x, z) (1 = full, 0 = gone).
function scale(i: number, x: number, z: number): number {
  const o = i * STRIDE, range = values[o + 15], reach = Math.hypot(values[o] - x, values[o + 2] - z);
  if (range > 1e5) return 1;
  const t = Math.min(1, Math.max(0, (reach - range * 0.7) / (range * 0.3)));
  return 1 - t * t * (3 - 2 * t);
}
const cameras = [[0, 0], [700, -300], [-1200, 900], [BLOCK_SIZE * 3.5, BLOCK_SIZE * -9], [2000, 2000]] as const;

test("every building part is packed once, longest draw range first within its block", () => {
  const total = world.buildings.reduce((sum, b) => sum + buildingParts(b).length, 0);
  assert.equal(list.reduce((sum, c) => sum + c.count, 0), total);
  assert.equal(values.length, total * STRIDE);
  for (const chunk of list) {
    assert.equal(chunk.ranges.length, chunk.count);
    for (let i = 0; i < chunk.count; i++) {
      assert.equal(chunk.ranges[i], values[(chunk.start + i) * STRIDE + 15]);
      if (i) assert.ok(chunk.ranges[i] <= chunk.ranges[i - 1]);
    }
  }
});

test("instances left out of a draw are already fully retracted (no popping)", () => {
  for (const [x, z] of cameras) for (const chunk of list) {
    const count = chunkInstanceCount(chunk, x, z);
    for (let i = chunk.start + count; i < chunk.start + chunk.count; i++) assert.equal(scale(i, x, z), 0, `chunk ${chunk.bx},${chunk.bz} part ${i}`);
  }
});

test("far blocks draw only main masses, and the masses never retract", () => {
  // Past the longest finite range (or the optional FAR_LOD_BLOCKS cap) nothing but main masses is submitted.
  const finite = list.reduce((most, c) => Math.max(most, ...[...c.ranges].filter(r => r <= 1e5)), 0);
  const far = Math.min(finite, FAR_LOD_BLOCKS * BLOCK_SIZE);
  assert.ok(finite <= 1500, `longest finite range ${finite}`);
  const cameras = [[0, 0], [1600, -300], [-1700, 1500]] as const;
  let near = 0, distant = 0;
  for (const [x, z] of cameras) for (const chunk of list) {
    const count = chunkInstanceCount(chunk, x, z), distance = Math.hypot(chunk.x - x, chunk.z - z);
    for (let i = 0; i < chunk.count; i++) if (values[(chunk.start + i) * STRIDE + 15] > 1e5) assert.ok(i < count, "a main mass was dropped");
    if (distance - chunk.reach - 1 >= far) {
      for (let i = 0; i < count; i++) assert.ok(values[(chunk.start + i) * STRIDE + 15] > 1e5, "a detail part survived past the far LOD");
      distant += count;
    } else near += count;
  }
  assert.ok(near > 0 && distant > 0);
});

test("at twelve blocks a block submits little more than its main masses", () => {
  const at = 12 * BLOCK_SIZE;
  let drawn = 0, masses = 0, all = 0;
  for (const chunk of list) {
    drawn += chunkInstanceCount(chunk, chunk.x + chunk.reach + 1 + at, chunk.z);
    masses += chunk.ranges.filter(r => r > 1e5).length; all += chunk.count;
  }
  assert.ok(masses < all / 4, `${masses} masses of ${all}`);
  assert.ok(drawn < masses * 1.3, `${drawn} drawn, ${masses} masses`);
});
