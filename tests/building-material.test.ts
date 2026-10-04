import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import type { Building } from "../src/city/world.ts";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const [{ cityMaterial, CITY_MATERIAL, REFLECTION_MATERIAL }, { BUILDING_MATERIAL, FACADE_MATERIAL }, { buildingParts }, { CityWorld }] = await Promise.all([
  import("../src/city/materials.ts"),
  import("../src/city/building-batch.ts"),
  import("../src/city/architecture.ts"),
  import("../src/city/world.ts"),
]);

function activeSource(source: string): string {
  const defines = new Set<string>(), stack: boolean[] = [], active: string[] = [];
  for (const line of source.split("\n")) {
    const condition = line.trim().match(/^#(ifdef|ifndef) (\w+)$/);
    if (condition) {
      stack.push(condition[1] === "ifdef" ? defines.has(condition[2]) : !defines.has(condition[2]));
    } else if (line.trim() === "#else") {
      assert.ok(stack.length);
      stack[stack.length - 1] = !stack[stack.length - 1];
    } else if (line.trim() === "#endif") {
      assert.ok(stack.length);
      stack.pop();
    } else if (stack.every(Boolean)) {
      const define = line.trim().match(/^#define (\w+)/);
      if (define) defines.add(define[1]);
      active.push(line);
    }
  }
  assert.equal(stack.length, 0);
  return active.join("\n");
}

test("every generated building part stays in the specialized 0/2/6 surface family", () => {
  const world = new CityWorld(), allowed = new Set([0, 2, 6]), seen = new Set<number>(), styles = new Set<number>();
  assert.ok(world.buildings.length > 100);
  for (const building of world.buildings) for (const part of buildingParts(building)) {
    assert.ok(allowed.has(part.surface), `Building ${building.id} uses unsupported surface ${part.surface}`);
    seen.add(part.surface); styles.add(building.style);
  }
  assert.deepEqual([...seen].sort(), [0, 2, 6]);
  assert.equal(styles.size, 8);
  const template: Building = world.buildings[0];
  for (let style = 0; style < 8; style++) for (const height of [28, 96, 155]) for (const id of [0, 2, 3, 5, 7, 10, 15]) {
    for (const part of buildingParts({ ...template, x: 0, style, height, id })) assert.ok(allowed.has(part.surface), `Style ${style}, height ${height}, id ${id} uses ${part.surface}`);
  }
});

test("batch exports select the specialized families without changing the default city material", () => {
  assert.equal(CITY_MATERIAL, cityMaterial({ reflections: true }));
  assert.equal(REFLECTION_MATERIAL, cityMaterial({ ground: false }));
  assert.equal(BUILDING_MATERIAL, cityMaterial({ batch: true, ground: false }));
  assert.equal(FACADE_MATERIAL, cityMaterial({ batch: true, opaque: true, architecture: true }));
});

test("only ground-capable materials retain park data and the ground dispatch branch", () => {
  for (const lite of [false, true]) {
    const city = activeSource(cityMaterial({ reflections: true, lite }));
    assert.ok(city.includes("PARK_LANTERNS"));
    assert.ok(city.includes("SURFACE < 1.5"));
    for (const options of [{ ground: false }, { batch: true, ground: false }, { batch: true, opaque: true, architecture: true }]) {
      const source = activeSource(cityMaterial({ ...options, lite }));
      assert.ok(!source.includes("parkGround"));
      assert.ok(!source.includes("PARK_LANTERNS"));
      assert.ok(!source.includes("SURFACE < 1.5"));
      assert.ok(source.includes("float fresnel = 0.04"));
      assert.ok(source.includes("SURFACE > 5.5"));
      if (!options.architecture) {
        assert.ok(source.includes("SURFACE > 7.5"));
        assert.ok(source.includes("SURFACE > 6.5"));
      }
    }
  }
});

test("the only native ground draw remains outside reflection and prop recording", () => {
  const source = readFileSync(new URL("../src/city/engine.ts", import.meta.url), "utf8");
  const assignments = [...source.matchAll(/u_surface\s*:\s*1\b|setUniform\("u_surface",\s*1\)/g)];
  assert.equal(assignments.length, 1);
  const groundIndex = assignments[0].index;
  assert.ok(groundIndex > source.indexOf("reflection.end();"));
  assert.ok(groundIndex > source.indexOf("const recordProps ="));
  assert.ok(groundIndex < source.indexOf("scenery(false);", groundIndex));
});
