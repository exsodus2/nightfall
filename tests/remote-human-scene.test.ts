import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { drawHuman } from "../src/city/human-model.ts";
import { MESH_BOX, MESH_SPHERE, MESH_TORUS, PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import type { ActivityView } from "../src/city/activity.ts";
import type { NpcLook } from "../src/city/npcs.ts";
import type { RGB } from "../src/city/world.ts";
import type { RemoteAvatar } from "../src/multiplayer/types.ts";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const [{ drawRemotePlayers, drawInteriorPlayers }, { ink, propRange, restorePropRange, propAlpha }] = await Promise.all([
  import("../src/multiplayer/remote-scene.ts"),
  import("../src/city/activity.ts"),
]);

const COLOR: RGB = [96, 210, 225];
const APPEARANCES: readonly { id: string; seed: number; headwear: NpcLook["headwear"]; skin: RGB }[] = [
  { id: "runner-0", seed: 3515829878, headwear: "bare", skin: [189, 174, 141] },
  { id: "runner-1", seed: 3532607497, headwear: "visor", skin: [179, 143, 115] },
  { id: "runner-2", seed: 3482274640, headwear: "cap", skin: [144, 112, 88] },
  { id: "runner-3", seed: 3499052259, headwear: "hood", skin: [179, 143, 115] },
  { id: "runner-6", seed: 3549385116, headwear: "cap", skin: [111, 85, 69] },
];
const avatar = (extra: Partial<RemoteAvatar> = {}): RemoteAvatar => ({ id: "runner-0", name: "Runner", color: COLOR, hex: "#60d2e1", x: 0, y: 0, z: 0, yaw: 0, pitch: 0, heading: 0, speed: 0, mode: "walk", car: 0, stride: 0.7, place: "", carrier: null, ...extra });
const view = (extra: Partial<ActivityView> = {}): ActivityView => ({ x: 3, z: 0, yaw: 0, height: 2.7, time: 12, rain: false, low: false, ...extra });
const record = () => new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
const total = (recorder: PropRecorder) => recorder.counts.reduce((sum, count) => sum + count, 0);
const packed = (recorder: PropRecorder) => recorder.data.map((data, mesh) => data.slice(0, recorder.counts[mesh] * PROP_STRIDE));
const geometry = (recorder: PropRecorder) => recorder.data.map((data, mesh) => Array.from({ length: recorder.counts[mesh] }, (_, instance) => Array.from(data.slice(instance * PROP_STRIDE, instance * PROP_STRIDE + 12))));
const capture = (remote = avatar(), frame = view()) => { const recorder = record(); drawRemotePlayers(recorder, frame, [remote]); return recorder; };

function hasInk(recorder: PropRecorder, color: RGB, gain: number): boolean {
  return recorder.data.some((data, mesh) => Array.from({ length: recorder.counts[mesh] }, (_, instance) => instance * PROP_STRIDE).some(offset => color.every((channel, index) => Math.abs(data[offset + 12 + index] - channel * gain / 255) < 1e-6)));
}

test("peer IDs select the established human headwear and skin palettes without rigid extra bars", () => {
  assert.equal(new Set(APPEARANCES.map(appearance => appearance.headwear)).size, 4);
  assert.equal(new Set(APPEARANCES.map(appearance => appearance.skin.join(","))).size, 4);
  for (const appearance of APPEARANCES) {
    const remote = avatar({ id: appearance.id }), actual = capture(remote), expected = record();
    const outer = propRange(420);
    drawHuman(expected, { coat: [COLOR[0] * 0.42, COLOR[1] * 0.42, COLOR[2] * 0.42], trim: [44, 50, 60], skin: appearance.skin, light: COLOR, headwear: appearance.headwear, idle: "breathe", prop: null }, { time: 12, seed: appearance.seed, stride: remote.stride, moving: false, detail: true, distant: false }, ink);
    restorePropRange(outer);
    for (const mesh of [MESH_BOX, MESH_SPHERE]) {
      assert.equal(actual.counts[mesh], expected.counts[mesh]);
      assert.deepEqual(packed(actual)[mesh], packed(expected)[mesh]);
    }
    assert.equal(actual.counts[MESH_TORUS], 1);
    assert.ok(total(actual) <= 40);
    assert.ok(hasInk(actual, appearance.skin, 1));
  }
});

test("peer appearances repeat exactly and preserve team color independently of names", () => {
  for (const appearance of APPEARANCES) {
    const remote = avatar({ id: appearance.id }), first = capture(remote);
    capture(avatar({ id: "unrelated-peer", color: [240, 71, 92] }));
    assert.deepEqual(packed(capture({ ...remote, name: "New display name" })), packed(first));
    assert.ok(hasInk(first, COLOR, 0.42));
    assert.ok(hasInk(first, COLOR, 0.7));
    const replacement: RGB = [243, 152, 66], recolored = capture({ ...remote, color: replacement });
    assert.deepEqual(geometry(recolored), geometry(first));
    assert.ok(hasInk(recolored, replacement, 0.42));
    assert.ok(hasInk(recolored, replacement, 0.7));
    assert.ok(!hasInk(recolored, COLOR, 0.7));
    assert.ok(hasInk(capture(remote, view({ x: 180 })), COLOR, 0.42));
  }
});

test("peer LOD keeps the 48/28 metre limits, seven-instance far silhouettes and bounded party cost", () => {
  for (let index = 0; index < 48; index++) for (const low of [false, true]) {
    const remote = avatar({ id: `runner-${index}`, speed: index % 2 ? 4 : 0 }), threshold = low ? 28 : 48;
    const near = capture(remote, view({ x: threshold - 0.01, low })), far = capture(remote, view({ x: threshold, low }));
    assert.ok(total(near) >= 35 && total(near) <= 40);
    assert.deepEqual(far.counts, [6, 1, 0]);
    const legs = geometry(far)[MESH_BOX].filter(part => part[1] > -0.9);
    assert.equal(legs.length, 2);
    for (const mesh of packed(far)) assert.ok(mesh.every(Number.isFinite));
  }
  const party = Array.from({ length: 7 }, (_, index) => avatar({ id: `runner-${index}`, x: index * 2 }));
  const near = record(), far = record();
  drawRemotePlayers(near, view(), party); drawRemotePlayers(far, view({ x: 180 }), party);
  assert.ok(total(near) <= 7 * 40);
  assert.equal(total(far), 7 * 7);
});

test("peer range and occlusion rules restore the surrounding prop distance state", () => {
  const before = propAlpha();
  assert.equal(total(capture(avatar(), view({ x: 421 }))), 0);
  assert.equal(total(capture(avatar(), view({ x: 420 }))), 7);
  assert.equal(total(capture(avatar(), view({ x: 20, visible: () => false }))), 0);
  assert.ok(total(capture(avatar(), view({ x: 10, visible: () => false }))) > 7);
  assert.equal(propAlpha(), before);
});

test("peer geometry follows body heading and feet height rather than camera yaw", () => {
  const remote = avatar({ x: 2, z: -4 }), base = capture(remote), rotated = capture({ ...remote, heading: Math.PI / 2, yaw: -1.7 });
  assert.deepEqual(packed(capture({ ...remote, yaw: 2.4 })), packed(base));
  for (let mesh = 0; mesh < base.counts.length; mesh++) for (let instance = 0; instance < base.counts[mesh]; instance++) {
    const offset = instance * PROP_STRIDE, before = base.data[mesh], after = rotated.data[mesh];
    assert.ok(Math.abs(after[offset] - (remote.x - (before[offset + 2] - remote.z))) < 1e-5);
    assert.ok(Math.abs(after[offset + 2] - (remote.z + before[offset] - remote.x)) < 1e-5);
    assert.ok(Math.abs(after[offset + 1] - before[offset + 1]) < 1e-5);
    for (const axis of [3, 6, 9]) {
      assert.ok(Math.abs(after[offset + axis] + before[offset + axis + 2]) < 1e-5);
      assert.ok(Math.abs(after[offset + axis + 2] - before[offset + axis]) < 1e-5);
    }
  }
  const raised = capture({ ...remote, y: 4.2 });
  for (let mesh = 0; mesh < base.counts.length; mesh++) for (let instance = 0; instance < base.counts[mesh]; instance++) {
    const offset = instance * PROP_STRIDE;
    assert.ok(Math.abs(raised.data[mesh][offset + 1] - base.data[mesh][offset + 1] + 4.2) < 1e-5);
  }
});

test("walking stride animates legs but stationary train passengers remain standing", () => {
  const first = avatar({ stride: 0 }), later = { ...first, stride: Math.PI / 2 };
  assert.deepEqual(geometry(capture(first)), geometry(capture(later)));
  assert.notDeepEqual(geometry(capture({ ...first, speed: 4 }))[MESH_BOX].slice(0, 8), geometry(capture({ ...later, speed: 4 }))[MESH_BOX].slice(0, 8));
  for (const speed of [0, 4]) {
    const standing = avatar({ y: 3.2, speed });
    const passenger = { ...standing, mode: "metro" as const, carrier: { train: 1, u: 0.3, v: 4, yaw: 0 } };
    assert.deepEqual(packed(capture(passenger)), packed(capture(standing)));
  }
});

test("indoor peers reuse identical articulated geometry with the indoor paint path", () => {
  for (const appearance of APPEARANCES) {
    const remote = avatar({ id: appearance.id, place: "first-interior", x: 2, z: -3, heading: 0.6, speed: 3 });
    const outdoor = capture(remote), indoor = record();
    drawInteriorPlayers(indoor, [remote], 12);
    assert.deepEqual(geometry(indoor), geometry(outdoor));
    assert.ok(total(indoor) <= 40);
    assert.ok(hasInk(indoor, COLOR, 0.7));
    for (let mesh = 0; mesh < indoor.counts.length; mesh++) for (let instance = 0; instance < indoor.counts[mesh]; instance++) {
      const offset = instance * PROP_STRIDE;
      assert.deepEqual(Array.from(indoor.data[mesh].slice(offset + 16, offset + 20)), [0, 0, 0, 1]);
    }
  }
});

test("flight preserves leaning, the hover ring and both thrusters without a walking gait", () => {
  for (const appearance of APPEARANCES) {
    const remote = avatar({ id: appearance.id, mode: "fly", y: 12, speed: 36, stride: 0 });
    const flying = capture(remote), idle = capture({ ...remote, speed: 0 });
    assert.ok(total(flying) <= 42);
    assert.equal(flying.counts[MESH_TORUS], 1);
    assert.notDeepEqual(geometry(flying), geometry(idle));
    assert.deepEqual(geometry(flying), geometry(capture({ ...remote, stride: Math.PI / 2 })));
    const jets = Array.from({ length: flying.counts[MESH_BOX] }, (_, instance) => instance * PROP_STRIDE).filter(offset => Math.abs(flying.data[MESH_BOX][offset + 20] - "*".charCodeAt(0) / 255) < 1e-6);
    assert.equal(jets.length, 2);
    assert.equal(total(capture(remote, view({ x: 180 }))), 7);
  }
});
