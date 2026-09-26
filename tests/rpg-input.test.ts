import assert from "node:assert/strict";
import test from "node:test";
import { RpgInputCollector } from "../src/rpg/input.ts";

test("a tap between two frames is latched: pressed and released both reach the next frame", () => {
  const input = new RpgInputCollector();
  input.pointer(0, true); input.pointer(0, false);
  const frame = input.frame(0, 0);
  assert.equal(frame.attackPressed, true);
  assert.equal(frame.attackReleased, true);
  assert.equal(frame.attackHeld, false);
  const next = input.frame(0, 0);
  assert.equal(next.attackPressed, false);
  assert.equal(next.attackReleased, false);
});

test("held buttons persist across frames; release() lets go of everything", () => {
  const input = new RpgInputCollector();
  input.pointer(0, true); input.pointer(2, true);
  input.frame(1, 0);
  const held = input.frame(1, 0);
  assert.equal(held.attackHeld, true); assert.equal(held.altHeld, true); assert.equal(held.attackPressed, false);
  input.release();
  const after = input.frame(0, 0);
  assert.equal(after.attackHeld, false); assert.equal(after.altHeld, false); assert.equal(after.attackReleased, true);
});

test("combat keys: slots, dodge, reload and quick items; key repeat is ignored", () => {
  const input = new RpgInputCollector();
  assert.equal(input.key("Digit2", true), true);
  assert.equal(input.key("KeyC", true), true);
  assert.equal(input.key("KeyX", true, true), true); // repeat: claimed but not pressed
  assert.equal(input.key("KeyQ", true), true);
  assert.equal(input.key("KeyW", true), false);
  const frame = input.frame(0.5, -1);
  assert.equal(frame.selectSlot, "sidearm");
  assert.equal(frame.dodgePressed, true);
  assert.equal(frame.reloadPressed, false);
  assert.equal(frame.quickUse, 1);
  assert.equal(frame.forward, 0.5); assert.equal(frame.strafe, -1);
  assert.equal(input.frame(0, 0).selectSlot, null);
});
