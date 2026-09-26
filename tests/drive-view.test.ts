import assert from "node:assert/strict";
import test from "node:test";
import { DRIVE_VIEW_TRANSITION, STEERING_WHEEL_LOCK, easeViewBlend, parseDriveView, steeringWheelAngle, stepViewBlend } from "../src/city/drive-view.ts";

test("the stored driving view parses defensively", () => {
  assert.equal(parseDriveView("chase"), "chase");
  assert.equal(parseDriveView("cockpit"), "cockpit");
  for (const junk of [null, undefined, "", "CHASE", "{\"view\":\"chase\"}", 1, true]) assert.equal(parseDriveView(junk), "cockpit");
});

test("the view blend moves at a fixed pace and eases at both ends", () => {
  let p = 0, frames = 0;
  while (p < 1) { p = stepViewBlend(p, true, 1 / 60); frames++; }
  assert.ok(Math.abs(frames - DRIVE_VIEW_TRANSITION * 60) <= 1, `${frames} frames`);
  assert.equal(stepViewBlend(1, true, 0.1), 1, "clamped at the chase view");
  assert.equal(stepViewBlend(0.5, false, 0.1), 0.25, "reverses from where it is");
  assert.equal(stepViewBlend(0.3, true, -1), 0.3, "never steps backwards on a bad dt");
  assert.equal(easeViewBlend(0), 0); assert.equal(easeViewBlend(1), 1); assert.equal(easeViewBlend(0.5), 0.5);
  assert.ok(easeViewBlend(0.05) < 0.01 && easeViewBlend(0.95) > 0.99, "zero velocity at both ends");
  for (let x = 0; x < 1; x += 0.05) assert.ok(easeViewBlend(x + 0.05) >= easeViewBlend(x), "monotonic");
});

test("the steering wheel turns with the steer value, clockwise to the right", () => {
  assert.equal(steeringWheelAngle(0), 0);
  assert.equal(steeringWheelAngle(1), -STEERING_WHEEL_LOCK);
  assert.equal(steeringWheelAngle(-1), STEERING_WHEEL_LOCK);
  assert.equal(steeringWheelAngle(3), -STEERING_WHEEL_LOCK, "clamped at full lock");
  assert.equal(steeringWheelAngle(0.5), -STEERING_WHEEL_LOCK / 2);
});
