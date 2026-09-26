import assert from "node:assert/strict";
import test from "node:test";
import { fullyHidden, visibleFrom } from "../src/city/visibility.ts";
import type { Building } from "../src/city/world.ts";

const wall: Building = { id: 1, x: 0, z: -20, width: 20, depth: 10, height: 40, district: 1, style: 0, accent: [255, 100, 160], sign: "HOTEL" };
test("street props are hidden behind walls, but remain visible above and beside them", () => {
  const eye = { x: 0, y: 3, z: 0 };
  assert.equal(visibleFrom(eye, { x: 0, y: 3, z: -40 }, [wall]), false);
  assert.equal(visibleFrom(eye, { x: 30, y: 3, z: -40 }, [wall]), true);
  assert.equal(visibleFrom({ ...eye, y: 50 }, { x: 0, y: 50, z: -40 }, [wall]), true);
  assert.equal(visibleFrom(eye, { x: 0, y: 3, z: 40 }, [wall]), true);
});
test("building culling preserves exposed rooftops and expanded facade details", () => {
  const eye = { x: 0, y: 3, z: 0 }, target = { ...wall, id: 2, z: -60, height: 20, width: 12, depth: 12 };
  assert.equal(fullyHidden({ ...eye, y: 0 }, target, [wall]), true);
  assert.equal(fullyHidden(eye, target, [wall]), false, "The reflected camera still sees the bottom edge");
  assert.equal(fullyHidden(eye, { ...target, height: 160 }, [wall]), false);
  assert.equal(fullyHidden(eye, { ...target, x: 35 }, [wall]), false);
  assert.equal(fullyHidden({ ...eye, y: 100 }, target, [wall]), false);
});
