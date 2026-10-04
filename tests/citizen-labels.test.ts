import assert from "node:assert/strict";
import test from "node:test";
import { citizenLabels, type CitizenLabelFrame } from "../src/city/citizen-labels.ts";
import type { Citizen } from "../src/city/people.ts";

const person = (id: number, x: number, z: number): Citizen => ({ id, x, y: 0, z, yaw: 0, state: "walking", moving: false, seated: false, umbrella: false, occupation: "resident", goal: "Meet a friend", bark: "Evening.", barkUntil: 12 });
const frame = (citizens: readonly Citizen[]): CitizenLabelFrame => ({ citizens, time: 10, cam: { x: 0, y: 2.7, z: 0, yaw: 0, pitch: 0, fov: 62, aspect: 1.5 } });

test("ambient speech uses a bounded, non-overlapping nearest-first overlay", () => {
  const citizens = [person(1, 0, -10), person(2, -6, -10), person(3, 6, -10), person(4, 0, -12)];
  const labels = citizenLabels(frame(citizens), 180, 120);
  assert.equal(labels.length, 3);
  assert.equal(labels[0].id, 1);
  assert.equal(labels.some(label => label.id === 4), false, "overlapping background speech stays hidden");
  assert.deepEqual(labels, citizenLabels(frame(citizens), 180, 120));
});

test("expired, hidden, distant and off-camera speech is culled", () => {
  assert.equal(citizenLabels(frame([{ ...person(1, 0, -8), barkUntil: 10 }]), 180, 120).length, 0);
  assert.equal(citizenLabels({ ...frame([person(2, 0, -8)]), visible: () => false }, 180, 120).length, 0);
  assert.equal(citizenLabels(frame([person(3, 0, -25), person(4, 0, 10), person(5, 0, -0.5)]), 180, 120).length, 0);
});

test("speech fits narrow screens and leaves the HUD margins clear", () => {
  const labels = citizenLabels(frame([{ ...person(1, 0, -9), bark: "Blue Hour Tea keeps a light on for late arrivals." }]), 49, 106);
  assert.equal(labels.length, 1);
  assert.ok(labels[0].text.length <= 41);
  assert.ok(Math.abs(labels[0].x) + labels[0].text.length / 2 <= 49 / 2 - 2);
});
