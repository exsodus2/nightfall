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

type Scalar = (...values: number[]) => number;

function scalarFunction(source: string, name: string, dependencies: Record<string, Scalar>): Scalar {
  const match = source.match(new RegExp(`float ${name}\\(([^)]*)\\)\\s*\\{([^{}]*)\\}`));
  assert.ok(match, `Missing scalar shader function ${name}`);
  const parameters = match[1].replace(/\bfloat\s+/g, ""), body = match[2].replace(/\bfloat\s+/g, "let ");
  const factory = new Function(...Object.keys(dependencies), `return (${parameters}) => { ${body} };`) as (...functions: Scalar[]) => Scalar;
  return factory(...Object.values(dependencies));
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

test("facade room seeds distinguish opposite planes without changing across the same wall", () => {
  const source = cityMaterial(), match = source.match(/float facadePlane = ([^;]+);/);
  assert.ok(match);
  const expression = match[1].replace(/\bp\./g, "position.").replace(/\bn\./g, "normal.");
  type Vector = { x: number; y: number; z: number };
  const evaluate = new Function("position", "normal", "floor", "abs", `return ${expression};`) as (position: Vector, normal: Vector, floor: Scalar, abs: Scalar) => number;
  const plane = (position: Vector, normal: Vector) => evaluate(position, normal, Math.floor, Math.abs);
  assert.match(source, /windowId = floor\(tile\) \+ floor\(p\.xz \/ 64\.0\) \* 13\.7 \+ vec2\(facadePlane \* 0\.73, abs\(n\.x\) > 0\.5 \? 19\.17 : 0\.0\)/);
  assert.doesNotMatch(expression, /eye|view|time|FragCoord/);
  const world = new CityWorld();
  for (const building of world.buildings) for (const axis of ["x", "z"] as const) {
    const normal = { x: axis === "x" ? 1 : 0, y: 0, z: axis === "z" ? 1 : 0 };
    const oppositeNormal = { x: -normal.x, y: 0, z: -normal.z };
    const tangent = axis === "x" ? "z" : "x", extent = axis === "x" ? building.width : building.depth;
    const positive = { x: building.x, y: -14, z: building.z }, negative = { ...positive };
    positive[axis] += extent * 0.465; negative[axis] -= extent * 0.465;
    assert.notEqual(plane(positive, normal), plane(negative, oppositeNormal));
    for (const offset of [-7, 0, 7]) {
      assert.equal(plane({ ...positive, [tangent]: positive[tangent] + offset, y: -32 + offset }, normal), plane(positive, normal));
      assert.equal(plane(positive, oppositeNormal), plane(positive, normal));
    }
    assert.equal(plane(positive, normal), plane({ ...positive }, { ...normal }));
  }
});

test("glass slat coverage is periodic, bounded and converges to its area at small projected sizes", () => {
  const source = cityMaterial();
  const dependencies: Record<string, Scalar> = {
    floor: Math.floor,
    fract: value => value - Math.floor(value),
    clamp: (value, lower, upper) => Math.max(lower, Math.min(upper, value)),
    max: Math.max,
  };
  const integral = scalarFunction(source, "integral", dependencies);
  const coverage = scalarFunction(source, "prefilteredBand", { ...dependencies, integral });
  for (let index = -120; index <= 120; index++) for (const footprint of [0, 0.003, 0.05, 0.5, 0.875, 1, 2, 8, 64]) {
    const coordinate = index / 17, value = coverage(coordinate, 0, 0.45, footprint);
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    assert.ok(Math.abs(value - coverage(coordinate + 3, 0, 0.45, footprint)) < 1e-9);
    if (Number.isInteger(footprint) && footprint > 0) assert.ok(Math.abs(value - 0.45) < 1e-9);
  }
  for (let index = 0; index <= 100; index++) {
    const coordinate = index / 100 * 7;
    assert.ok(Math.abs(coverage(coordinate, 0, 0.45, 7 / 7.999) - coverage(coordinate, 0, 0.45, 7 / 8.001)) < 0.001);
  }
});

test("blinds keep a fixed full or lite pattern and use the continuous pane footprint", () => {
  for (const lite of [false, true]) for (const options of [{ reflections: true }, { ground: false }, { batch: true, ground: false }, { batch: true, opaque: true, architecture: true }]) {
    const source = activeSource(cityMaterial({ ...options, lite }));
    assert.match(source, new RegExp(`float slatCount = ${lite ? "4" : "7"}\\.0;`));
    assert.ok(source.includes("prefilteredBand(paneUv.y * slatCount, 0.0, 0.45, paneFootprint.y * slatCount)"));
    assert.doesNotMatch(source, /band\(paneUv|fwidth\(paneUv|rich \? 7\.0 : 4\.0/);
    if (lite) {
      assert.ok(source.includes("bool rich = false;"));
      assert.doesNotMatch(source, /roomUv \+=|float recess =/);
    }
  }
});

test("glass retains the same texture-call, loop and three-attachment shader budgets", () => {
  for (const lite of [false, true]) for (const options of [{ reflections: true }, { ground: false }, { batch: true, ground: false }, { batch: true, opaque: true, architecture: true }]) {
    const source = cityMaterial({ ...options, lite }), ground = "reflections" in options;
    assert.equal((source.match(/\b(?:texture|texelFetch)\s*\(/g) ?? []).length, ground ? 11 : 8);
    assert.equal((source.match(/\bfor\s*\(/g) ?? []).length, ground ? 13 : 9);
    assert.equal((source.match(/layout\(location=\d\) out vec4/g) ?? []).length, 3);
  }
});
