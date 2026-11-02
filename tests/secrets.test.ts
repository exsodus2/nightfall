import assert from "node:assert/strict";
import test from "node:test";
import { BLOCK_SIZE, CityWorld } from "../src/city/world.ts";
import { GROUND_TOP, MOUTH_CLEAR } from "../src/city/alleys.ts";
import { CityInteriors, interiorFixtures, interiorPlaces } from "../src/city/interiors.ts";
import { drawInterior } from "../src/city/interior-scene.ts";
import { pondField } from "../src/city/park.ts";
import { PropRecorder } from "../src/city/prop-canvas.ts";
import {
  GUIDE_PATH, KOI, KOI_WORD, PHONE_RING, SECRETS, SECRET_ARMS, SECRET_COUNT, SECRET_MOTION, SECRET_ROOMS, SECRET_SPOTS, SecretWatch,
  guideLength, guideStep, koiPixels, koiSlot, koiSwim, phoneRinging, roomSecretFor, secretAlleyParts, secretArm, secretFlag, secretPlaces, secretsFound,
  type SecretArm, type SecretPart,
} from "../src/city/secrets.ts";
import { drawSecrets } from "../src/city/secrets-scene.ts";
import { RpgSession } from "../src/rpg/session.ts";
import { CONTENT_PACKS } from "../src/rpg/content/index.ts";
import { SECRETS_PACK } from "../src/rpg/content/secrets.ts";
import { validateContent } from "../src/rpg/quests/validate.ts";
import type { Effect, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld();
const parts = secretAlleyParts(world.blocks);
const recorder = () => new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); }, clear: () => data.clear(), key: () => null, length: 0 }; };
const ground = (p: SecretPart) => p.y - p.h / 2 < GROUND_TOP && p.y + p.h / 2 > 0.2;
const outdoor = SECRETS_PACK.interactables?.filter(item => !item.place) ?? [];
const indoor = SECRETS_PACK.interactables?.filter(item => item.place) ?? [];

/** True when a walk on a 0.5 m grid of walkable cells reaches a street centre line (within 3 m). */
function reachesStreet(x: number, z: number): boolean {
  const step = 0.5, size = 360, half = size / 2, seen = new Uint8Array(size * size);
  let start: [number, number] | null = null;
  for (let r = 0; r <= 2.4 && !start; r += 0.2) for (let a = 0; a < Math.PI * 2 && !start; a += 0.3) if (world.canOccupy(x + Math.cos(a) * r, z + Math.sin(a) * r)) start = [Math.round(Math.cos(a) * r / step) + half, Math.round(Math.sin(a) * r / step) + half];
  if (!start) return false;
  const queue: number[] = [start[0] * size + start[1]];
  seen[queue[0]] = 1;
  for (let head = 0; head < queue.length; head++) {
    const i = Math.floor(queue[head] / size), j = queue[head] % size, wx = x + (i - half) * step, wz = z + (j - half) * step;
    const lx = ((wx % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE, lz = ((wz % BLOCK_SIZE) + BLOCK_SIZE) % BLOCK_SIZE;
    if (Math.min(lx, BLOCK_SIZE - lx) < 3 || Math.min(lz, BLOCK_SIZE - lz) < 3) return true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size || seen[ni * size + nj]) continue;
      seen[ni * size + nj] = 1;
      if (world.canOccupy(x + (ni - half) * step, z + (nj - half) * step)) queue.push(ni * size + nj);
    }
  }
  return false;
}

/** Every flag any effect in the pack can set. */
function flagsSet(): Set<string> {
  const effects: Effect[] = [];
  for (const item of SECRETS_PACK.interactables ?? []) effects.push(...(item.effects ?? []));
  for (const dialogue of SECRETS_PACK.dialogues ?? []) for (const step of dialogue.nodes) {
    effects.push(...(step.effects ?? []));
    for (const option of step.options) effects.push(...(option.effects ?? []));
  }
  return new Set(effects.flatMap(effect => ("setFlag" in effect ? [effect.setFlag] : [])));
}

test("twenty secrets, each with a payoff that sets its flag", () => {
  assert.equal(SECRET_COUNT, 20);
  assert.equal(new Set(SECRETS.map(secret => secret.id)).size, 20);
  const set = flagsSet();
  for (const secret of SECRETS) {
    const byRoom = SECRET_ROOMS.some(room => room.secret === secret.id), byScene = secret.id === "koi";
    assert.ok(set.has(secretFlag(secret.id)) || byRoom || byScene, `${secret.id} has a payoff`);
  }
  assert.deepEqual(validateContent(SECRETS_PACK, CONTENT_PACKS), []);
  assert.ok(CONTENT_PACKS.includes(SECRETS_PACK), "the pack is registered");
});

test("secret props keep the alley rules: walking line, street mouth, walls", () => {
  assert.ok(parts.length > 40, `${parts.length} parts`);
  for (const key of Object.keys(SECRET_ARMS) as SecretArm[]) {
    const arm = secretArm(world.blocks, key);
    assert.ok(arm, `${key} arm exists`);
    const wallA = arm.mid - arm.width / 2, wallB = arm.mid + arm.width / 2, base = arm.bx * BLOCK_SIZE;
    const theirs = [...arm.parts, ...arm.mouth].filter(p => p.y - p.h / 2 < GROUND_TOP && p.y + p.h / 2 > 0.2);
    let fromA = 0, fromB = 0;
    for (const p of theirs) { if (p.z < arm.mid) fromA = Math.max(fromA, p.z + p.d / 2 - wallA); else fromB = Math.max(fromB, wallB - (p.z - p.d / 2)); }
    for (const part of parts.filter(p => p.arm === key)) {
      assert.ok(part.x - part.w / 2 - base >= MOUTH_CLEAR - 0.6 && base + BLOCK_SIZE - (part.x + part.w / 2) >= MOUTH_CLEAR - 0.6, `${part.key} is off the street`);
      for (const b of world.blocks.get(`${arm.bx},${arm.bz}`)?.buildings ?? []) {
        const overlapX = Math.min(part.x + part.w / 2, b.x + b.width / 2) - Math.max(part.x - part.w / 2, b.x - b.width / 2);
        const overlapZ = Math.min(part.z + part.d / 2, b.z + b.depth / 2) - Math.max(part.z - part.d / 2, b.z - b.depth / 2);
        assert.ok(overlapX < 0.05 || overlapZ < 0.05, `${part.key} is not inside building ${b.id}`);
      }
      if (!ground(part)) continue;
      assert.ok(part.x - part.w / 2 - base >= MOUTH_CLEAR && base + BLOCK_SIZE - (part.x + part.w / 2) >= MOUTH_CLEAR, `${part.key} stands clear of the mouth`);
      const reach = part.z < arm.mid ? part.z + part.d / 2 - wallA : wallB - (part.z - part.d / 2);
      assert.ok(reach <= arm.reach + 1e-6, `${part.key} reaches ${reach.toFixed(2)} m from its wall`);
      if (part.z < arm.mid) fromA = Math.max(fromA, reach); else fromB = Math.max(fromB, reach);
      for (const other of theirs) {
        const overlapX = Math.min(part.x + part.w / 2, other.x + other.w / 2) - Math.max(part.x - part.w / 2, other.x - other.w / 2);
        const overlapZ = Math.min(part.z + part.d / 2, other.z + other.d / 2) - Math.max(part.z - part.d / 2, other.z - other.d / 2);
        assert.ok(overlapX < 0.01 || overlapZ < 0.01, `${part.key} does not stand inside the alley's own props`);
      }
    }
    assert.ok(arm.width - fromA - fromB >= 1.8 - 1e-6, `${key} keeps a 1.8 m walking line`);
  }
});

test("every secret is reachable on foot from a street", () => {
  const points: { name: string; x: number; z: number }[] = [
    ...Object.entries(SECRET_SPOTS).map(([name, spot]) => ({ name, ...spot })),
    ...secretPlaces(world).map(place => ({ name: place.id, x: place.entrance.x, z: place.entrance.z })),
    ...outdoor.map(item => ({ name: item.id, x: item.x, z: item.z })),
    ...(SECRETS_PACK.npcs ?? []).map(npc => ({ name: npc.id, x: npc.x, z: npc.z })),
  ];
  for (const point of points) {
    assert.ok(reachesStreet(point.x, point.z), `${point.name} at ${point.x}, ${point.z} is reachable`);
  }
  for (const [name, spot] of Object.entries(SECRET_SPOTS)) assert.ok(world.canOccupy(spot.x, spot.z), `${name} is walkable`);
  for (const npc of SECRETS_PACK.npcs ?? []) assert.ok(world.canOccupy(npc.x, npc.z), npc.id);
});

test("hidden rooms stay out of the venue lists but open like any door", () => {
  const publicPlaces = interiorPlaces(world), hidden = secretPlaces(world);
  assert.equal(publicPlaces.length, 9, "the nine public venues are unchanged");
  assert.ok(publicPlaces.every(place => !place.hidden && !hidden.some(secret => secret.id === place.id)));
  assert.equal(hidden.length, SECRET_ROOMS.length);
  assert.equal(hidden, secretPlaces(world), "cached");
  const interiors = new CityInteriors(world);
  assert.equal(interiors.places, publicPlaces);
  for (const place of hidden) {
    assert.equal(place.hidden, true);
    assert.ok(world.canOccupy(place.entrance.x, place.entrance.z), `${place.id} door is walkable`);
    assert.equal(interiors.nearby(place.entrance.x, place.entrance.z)?.id, place.id, `${place.id} door is found`);
    for (const other of publicPlaces) assert.ok(Math.hypot(other.entrance.x - place.entrance.x, other.entrance.z - place.entrance.z) > 20, `${place.id} is away from ${other.id}`);
    // No outdoor secret sits under a door's prompt (the door would win the E key).
    for (const item of outdoor) assert.ok(Math.hypot(item.x - place.entrance.x, item.z - place.entrance.z) > 3.5, `${item.id} is clear of ${place.id}`);
    assert.equal(roomSecretFor(`interior:${place.id}`), SECRET_ROOMS.find(room => room.id === place.id)?.secret);
    // Enter, walk about, use what is there, leave.
    const player = { x: 0, z: 0, yaw: 0, pitch: 0, distance: 0 };
    interiors.enter(place, player);
    assert.ok(interiors.canOccupy(player.x, player.z) && interiors.atExit(player.x, player.z), `${place.id} spawn`);
    for (const fixture of interiors.fixtures) assert.ok(Math.abs(fixture.x) < place.width / 2 && Math.abs(fixture.z) < place.depth / 2);
    for (const item of indoor.filter(candidate => candidate.place === place.id)) {
      let reachable = false;
      for (let r = 0; r <= 2.4 && !reachable; r += 0.2) for (let a = 0; a < Math.PI * 2 && !reachable; a += 0.3) reachable = interiors.canOccupy(item.x + Math.cos(a) * r, item.z + Math.sin(a) * r);
      assert.ok(reachable, `${item.id} can be reached inside ${place.id}`);
    }
    interiors.leave(player);
    assert.ok(world.canOccupy(player.x, player.z));
  }
  assert.equal(roomSecretFor("interior:kiln"), null);
});

test("hidden rooms draw bounded, deterministic geometry with lighter low profiles", () => {
  for (const place of secretPlaces(world)) {
    const full = recorder(), repeated = recorder(), low = recorder();
    drawInterior(full, place, interiorFixtures(place), 45, false);
    drawInterior(repeated, place, interiorFixtures(place), 45, false);
    drawInterior(low, place, interiorFixtures(place), 45, true);
    const count = full.counts.reduce((sum, value) => sum + value, 0), lowCount = low.counts.reduce((sum, value) => sum + value, 0);
    assert.ok(count > 30 && count < 250, `${place.id}: ${count} primitives`);
    assert.ok(lowCount <= count, `${place.id}: low profile is no heavier`);
    for (let mesh = 0; mesh < full.data.length; mesh++) {
      const end = full.counts[mesh] * 28;
      assert.deepEqual(full.data[mesh].slice(0, end), repeated.data[mesh].slice(0, end));
      assert.ok(full.data[mesh].slice(0, end).every(Number.isFinite));
    }
  }
});

test("every motion stays under the comfort limit and nothing strobes", () => {
  for (const [name, hz] of Object.entries(SECRET_MOTION)) assert.ok(hz > 0 && hz <= 0.4, `${name} ${hz} Hz`);
  for (const part of parts) if (part.pulse) assert.ok(part.pulse.rate <= 2.5 + 1e-9 && part.pulse.depth <= 0.25, `${part.key} breathes gently`);
  assert.ok(PHONE_RING.length >= 10 && PHONE_RING.period >= 60, "the phone rings in long, rare spells");
  assert.equal(phoneRinging(5), true); assert.equal(phoneRinging(65), false); assert.equal(phoneRinging(125), true); assert.equal(phoneRinging(-100), true);
  // The guide cat walks at most 1.6 m/s and never turns back.
  let progress = 0;
  for (let frame = 0; frame < 600; frame++) {
    const at = GUIDE_PATH[0], next = guideStep(progress, { x: at[0] - frame * 0.02, z: at[1] }, 1 / 60);
    assert.ok(next >= progress && next - progress <= 1.6 / 60 + 1e-9);
    progress = next;
  }
  assert.ok(progress <= guideLength());
  // The koi glide: under 2 m/s on their loops.
  for (let i = 0; i < 10; i++) { const a = koiSwim(i, 10), b = koiSwim(i, 10.1); assert.ok(Math.hypot(b.x - a.x, b.z - a.z) / 0.1 < 2); }
  assert.ok(KOI.gatherSeconds >= 6 && KOI.stillSeconds >= 20);
});

test("the koi word fits the pond, whoever reads it", () => {
  const count = koiPixels().length;
  assert.ok(count > 20 && count < 40, `${KOI_WORD}: ${count} koi`);
  for (const viewer of [{ x: -416, z: 250 }, { x: -440, z: 224 }, { x: -400, z: 205 }]) {
    for (let i = 0; i < count; i++) { const slot = koiSlot(i, viewer); assert.ok(pondField(slot.x, slot.z) < 0.95, `koi ${i} stays in the water`); }
  }
  for (let i = 0; i < count; i++) for (const time of [0, 100, 1000]) { const swim = koiSwim(i, time); assert.ok(pondField(swim.x, swim.z) < 0.95); }
});

test("the discovery counter counts each secret once, and flags persist", () => {
  const watch = new SecretWatch();
  assert.equal(watch.note(secretFlag("koi"), true), "A secret: 1/20 (The Koi)");
  assert.equal(watch.note(secretFlag("koi"), true), null, "the same secret never counts twice");
  assert.equal(watch.note(secretFlag("cat"), false), null);
  assert.equal(watch.note("secrets.cat1", true), null, "helper flags are not secrets");
  assert.equal(watch.note(secretFlag("cat"), true), "A secret: 2/20 (The Cat's Shrine)");
  assert.equal(watch.count, 2);

  const storage = memory();
  const first = new RpgSession({ world, storage, packs: CONTENT_PACKS });
  const toasts: string[] = [];
  first.bus.on("message", event => { if (event.text.startsWith("A secret")) toasts.push(event.text); });
  drawSecrets(recorder(), { x: 45, z: 96, yaw: 0, height: 1.7, time: 1, rain: true, low: false }, 1, first, world.blocks);
  first.bus.emit({ type: "entered", area: "interior:the-fridge" });
  first.bus.emit({ type: "entered", area: "interior:the-fridge" });
  first.quests.setFlag(secretFlag("bench"), true);
  first.quests.setFlag(secretFlag("bench"), true);
  assert.deepEqual(toasts, ["A secret: 1/20 (The Fridge)", "A secret: 2/20 (Mira's Bench)"]);
  first.save({ x: 45, z: 93.85, yaw: 0 });

  const second = new RpgSession({ world, storage, packs: CONTENT_PACKS });
  assert.equal(secretsFound(key => second.quests.flags.get(key)), 2, "found secrets survive a reload");
  const later: string[] = [];
  second.bus.on("message", event => { if (event.text.startsWith("A secret")) later.push(event.text); });
  drawSecrets(recorder(), { x: 45, z: 96, yaw: 0, height: 1.7, time: 2, rain: true, low: false }, 2, second, world.blocks);
  second.quests.setFlag(secretFlag("koi"), true);
  assert.deepEqual(later, ["A secret: 3/20 (The Koi)"], "a reload does not re-announce old finds");
});

test("hidden rooms take E: the diner note can be read from inside The Fridge", () => {
  const rpg = new RpgSession({ world, packs: CONTENT_PACKS });
  const note = indoor.find(item => item.id === "sec-diner-note");
  assert.ok(note);
  const input: RpgFrame["input"] = { attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 };
  rpg.update({ dt: 1 / 60, time: 0, player: { x: note.x, z: note.z + 0.6, eye: 1.7, yaw: 0, pitch: 0, mode: "walk", onFoot: false, place: "the-fridge" }, input });
  assert.ok(rpg.hasInteraction(), "the note is in reach");
  const opened = rpg.interactNearby();
  assert.ok(opened, "the note opens");
});

test("drawing the secrets near and far stays cheap", () => {
  const rpg = new RpgSession({ world, packs: CONTENT_PACKS });
  const far = recorder();
  drawSecrets(far, { x: 0, z: -600, yaw: 0, height: 1.7, time: 3, rain: true, low: false }, 3, rpg, world.blocks);
  assert.equal(far.counts.reduce((sum, value) => sum + value, 0), 0, "nothing far away");
  for (const [x, z] of [[45, 96], [-420, 236], [-716, -712], [428, 225]] as const) {
    const full = recorder(), low = recorder();
    drawSecrets(full, { x, z, yaw: 0, height: 1.7, time: 4, rain: true, low: false }, 4, rpg, world.blocks);
    drawSecrets(low, { x, z, yaw: 0, height: 1.7, time: 4, rain: true, low: true }, 4, rpg, world.blocks);
    const count = full.counts.reduce((sum, value) => sum + value, 0), lowCount = low.counts.reduce((sum, value) => sum + value, 0);
    assert.ok(count > 0 && count < 200, `${x}, ${z}: ${count} primitives`);
    assert.ok(lowCount <= count, "the low profile drops the animated life");
  }
});
