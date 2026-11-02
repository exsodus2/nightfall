import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld, PLAYER_RADIUS, type Player } from "../src/city/world.ts";
import { CityInteriors, interiorWorld, type InteriorFixture, type InteriorPlace } from "../src/city/interiors.ts";
import { LOCKABLE, groundFloorPlaces, groundFloorPlan, groundFixtureLabel } from "../src/city/building-interiors.ts";
import { liftLanding } from "../src/city/upper-floors.ts";
import { groundLifeSpec } from "../src/rpg/ground-life.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { RpgFrame } from "../src/rpg/types.ts";
import {
  DAILY_STASH_CREDIT_CAP, DAILY_STASH_ITEM_CAP, LOCKED_DAY_SECONDS, LOCKED_SAVE_KEY, LOCK_PREFIX, LockedRoomsLedger, STASH_PREFIX, lockedRoomBuilding, lockedRoomInteractables, lockedRoomSpec, lootStash,
  stashCredits, syncGates, unlockGate, type LockedRoomSpec, type StashHost,
} from "../src/rpg/locked-rooms.ts";

const world = new CityWorld();
const places = groundFloorPlaces(world);
const locked = places.filter(place => groundFloorPlan(place).locks?.length);

/** CityInteriors.canOccupy's box test on a 0.25 m grid, flood-filled from the spawn (the same as building-interiors.test.ts). */
function flood(place: InteriorPlace, fixtures: readonly InteriorFixture[]): { reached: (x: number, z: number) => boolean; spawn: boolean } {
  const cell = 0.25, hw = place.width / 2, hd = place.depth / 2, r = PLAYER_RADIUS;
  const nx = Math.floor(place.width / cell), nz = Math.floor(place.depth / cell);
  const free = (x: number, z: number) => Math.abs(x) <= hw - r && Math.abs(z) <= hd - r && !fixtures.some(f => Math.abs(x - f.x) < f.width / 2 + r && Math.abs(z - f.z) < f.depth / 2 + r);
  const open = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) open[j * nx + i] = free(-hw + (i + 0.5) * cell, -hd + (j + 0.5) * cell) ? 1 : 0;
  const seen = new Uint8Array(nx * nz);
  const start = Math.floor((2 * hd - 2.2) / cell) * nx + Math.floor(hw / cell);
  const spawn = free(0, hd - 2.2) && open[start] === 1;
  const stack = spawn ? [start] : [];
  if (spawn) seen[start] = 1;
  while (stack.length) {
    const c = stack.pop() as number, i = c % nx, j = (c - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, n = b * nx + a;
      if (a >= 0 && a < nx && b >= 0 && b < nz && open[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
    }
  }
  return { spawn, reached: (x, z) => { const i = Math.floor((x + hw) / cell), j = Math.floor((z + hd) / cell); return i >= 0 && i < nx && j >= 0 && j < nz && seen[j * nx + i] === 1; } };
}

function stashHost(ledger: LockedRoomsLedger, day: number): StashHost & { credits: number; items: string[]; lines: string[] } {
  const host = {
    day, ledger, credits: 0, items: [] as string[], lines: [] as string[],
    earn(amount: number) { host.credits += amount; },
    give(item: string, count: number) { host.items.push(item); return count; },
    itemName: (item: string) => item,
    say(text: string) { host.lines.push(text); },
  };
  return host;
}

test("locking is deterministic and only touches fitting kinds", () => {
  assert.ok(locked.length > 0, "some buildings have a locked room");
  const again = new CityWorld();
  const twin = groundFloorPlaces(again).filter(place => groundFloorPlan(place).locks?.length);
  assert.deepEqual(twin.map(place => place.id), locked.map(place => place.id));
  for (const place of locked) {
    assert.ok(LOCKABLE[place.kind as keyof typeof LOCKABLE], `${place.id}: ${place.kind} may be locked`);
    const plan = groundFloorPlan(place), lock = plan.locks?.[0];
    assert.equal(plan.locks?.length, 1, "one lock per building");
    assert.ok(lock && lock.room >= 1 && lock.room < plan.rooms.length, "never the front room");
    assert.equal(plan.fixtures[lock.fixtureIndex].kind, "gate");
    assert.equal(plan.fixtures.filter(item => item.kind === "gate").length, 1);
    assert.equal(groundFixtureLabel(plan.fixtures[lock.fixtureIndex])?.text, "LOCKED");
  }
});

test("about a fifth of the fitting ground floors are locked", () => {
  const fitting = places.filter(place => LOCKABLE[place.kind as keyof typeof LOCKABLE]);
  const share = locked.length / fitting.length;
  console.log(`locked rooms: ${locked.length}/${fitting.length} fitting ground floors (${(share * 100).toFixed(1)}%)`);
  assert.ok(share >= 0.1 && share <= 0.3, `${(share * 100).toFixed(1)}% locked`);
  for (const place of places) if (!LOCKABLE[place.kind as keyof typeof LOCKABLE]) assert.equal(groundFloorPlan(place).locks, undefined, `${place.id} is never locked`);
});

test("with the gate closed everything but the locked room stays reachable; the room itself is sealed", () => {
  for (const place of locked) {
    const plan = groundFloorPlan(place), lock = plan.locks![0], room = plan.rooms[lock.room], hd = place.depth / 2;
    const closed = flood(place, plan.fixtures);
    assert.ok(closed.spawn, `${place.id}: spawn`);
    assert.ok(closed.reached(0, hd - 3.4) && closed.reached(-1.5, hd - 2.2) && closed.reached(1.5, hd - 2.2), `${place.id}: exit strip`);
    const inside = (x: number, z: number) => Math.abs(x - room.x) < room.width / 2 && Math.abs(z - room.z) < room.depth / 2;
    for (const [index, other] of plan.rooms.entries()) {
      if (index === lock.room) continue;
      let reached = false;
      for (let x = other.x - other.width / 2 + 0.125; x < other.x + other.width / 2 && !reached; x += 0.25) {
        for (let z = other.z - other.depth / 2 + 0.125; z < other.z + other.depth / 2 && !reached; z += 0.25) reached = closed.reached(x, z);
      }
      assert.ok(reached, `${place.id}: ${other.label} reachable`);
    }
    for (const item of plan.fixtures) if (item.kind === "lift") { const landing = liftLanding(item); assert.ok(closed.reached(landing.x, landing.z), `${place.id}: lift landing`); }
    assert.ok(plan.residents.length >= 1, `${place.id}: residents`);
    const near = (x: number, z: number) => closed.reached(x, z) || [0, 1, 2, 3, 4, 5, 6, 7].some(k => closed.reached(x + Math.cos(k * Math.PI / 4) * 0.9, z + Math.sin(k * Math.PI / 4) * 0.9));
    for (const resident of plan.residents) assert.ok(!inside(resident.x, resident.z) && (resident.seated ? near(resident.x, resident.z) : closed.reached(resident.x, resident.z)), `${place.id}: resident on reachable floor`);
    const life = groundLifeSpec(place);
    if (life) assert.ok(closed.reached(life.local.x, life.local.z), `${place.id}: ground-life use point`);
    // Sealed while shut, open once the gate is gone.
    let sealed = true;
    for (let x = room.x - room.width / 2 + 0.125; x < room.x + room.width / 2; x += 0.25) for (let z = room.z - room.depth / 2 + 0.125; z < room.z + room.depth / 2; z += 0.25) if (closed.reached(x, z)) sealed = false;
    assert.ok(sealed, `${place.id}: the locked room is sealed`);
    const open = flood(place, plan.fixtures.filter(item => item.kind !== "gate"));
    const spec = lockedRoomSpec(place);
    assert.ok(spec, `${place.id}: spec`);
    assert.ok(open.reached(spec.stash.x, spec.stash.z), `${place.id}: stash reachable once open`);
    assert.ok(closed.reached(spec.lock.x, spec.lock.z), `${place.id}: lock terminal on the front side`);
    assert.ok(!closed.reached(spec.stash.x, spec.stash.z), `${place.id}: stash is behind the gate`);
  }
});

test("unlocking removes the blocker from the active visit and later ones", () => {
  const place = locked[0], interiors = new CityInteriors(world), ledger = new LockedRoomsLedger();
  const spec = lockedRoomSpec(place)!, plan = groundFloorPlan(place);
  const player: Player = { x: place.entrance.x, z: place.entrance.z, yaw: 0, pitch: 0, distance: 0 };
  interiors.enter(place, player);
  const gate = plan.fixtures[plan.locks![0].fixtureIndex];
  const behind = interiorWorld(place, spec.stash.x, spec.stash.z), at = interiorWorld(place, gate.x, gate.z);
  assert.ok(interiors.fixtures.includes(gate));
  assert.ok(!interiors.canOccupy(at.x, at.z), "the gate blocks the doorway");
  assert.deepEqual(lockedRoomInteractables(place, ledger, 0).map(item => item.id), [`${LOCK_PREFIX}${place.building}`]);
  const [terminal] = lockedRoomInteractables(place, ledger, 0);
  assert.equal(terminal.label, "Hack the lock");
  assert.equal(terminal.hack?.kind, "terminal");
  assert.equal(terminal.place, place.id);
  const list = interiors.fixtures;
  unlockGate(spec, ledger, interiors, 0);
  assert.ok(!interiors.fixtures.some(item => item.kind === "gate"), "gate gone from the live visit");
  assert.equal(interiors.fixtures, list, "the list keeps its identity");
  assert.ok(interiors.canOccupy(at.x, at.z), "doorway passable");
  assert.ok(interiors.canOccupy(behind.x, behind.z));
  assert.deepEqual(lockedRoomInteractables(place, ledger, 0).map(item => item.id), [`${STASH_PREFIX}${place.building}`]);
  interiors.leave(player);
  interiors.enter(place, player);
  assert.ok(!interiors.fixtures.some(item => item.kind === "gate"), "still open on the next visit");
  assert.ok(plan.fixtures.includes(gate), "the cached plan keeps its gate");
  assert.deepEqual(lockedRoomBuilding(`${LOCK_PREFIX}12`), { kind: "lock", building: 12 });
  assert.equal(lockedRoomBuilding("gl:bldg-1"), null);
});

test("gates close again on the next in-game day", () => {
  const place = locked[0], interiors = new CityInteriors(world), ledger = new LockedRoomsLedger();
  const spec = lockedRoomSpec(place)!;
  unlockGate(spec, ledger, interiors, 3);
  assert.ok(interiors.gatesOpen(place.id) && ledger.isOpen(place.building));
  // The ledger round-trips through a save.
  const loaded = LockedRoomsLedger.parse(ledger.serialize());
  assert.ok(loaded.isOpen(place.building));
  syncGates(loaded, interiors, 3);
  assert.ok(interiors.gatesOpen(place.id), "same day: still open after a load");
  syncGates(loaded, interiors, 4);
  assert.ok(!interiors.gatesOpen(place.id) && !loaded.isOpen(place.building), "next day: shut");
  assert.equal(lockedRoomInteractables(place, loaded, 4)[0].id, `${LOCK_PREFIX}${place.building}`);
  assert.equal(LockedRoomsLedger.parse("{not json").isOpen(place.building), false);
  assert.ok(ledger.serialize().length < 200, "the save stays tiny");
});

test("stash rewards: once per building per day, scaled by tier, capped across the city", () => {
  const ledger = new LockedRoomsLedger(), interiors = new CityInteriors(world);
  const specs = locked.map(place => lockedRoomSpec(place)).filter((spec): spec is LockedRoomSpec => spec !== null);
  assert.ok(specs.length >= 10);
  const tiers = new Set(specs.map(spec => spec.tier));
  assert.ok(tiers.size >= 2, "more than one tier in the city");
  assert.ok(stashCredits(1, "easy", 0) < 41 && stashCredits(1, "hard", 0) >= 80, "credits scale with tier");
  const host = stashHost(ledger, 0);
  const first = specs[0];
  lootStash(first, host);
  assert.equal(host.credits, 0, "a shut gate pays nothing");
  unlockGate(first, ledger, interiors, 0);
  lootStash(first, host);
  const paid = host.credits;
  assert.ok(paid > 0 && host.items.length === 1);
  lootStash(first, host);
  assert.equal(host.credits, paid, "once per day");
  assert.equal(lockedRoomInteractables(locked[0], ledger, 0).length, 0, "no stash interactable once emptied");
  for (const spec of specs) { unlockGate(spec, ledger, interiors, 0); lootStash(spec, host); }
  assert.ok(host.credits <= DAILY_STASH_CREDIT_CAP, `${host.credits} credits within the cap`);
  assert.ok(host.items.length <= DAILY_STASH_ITEM_CAP, `${host.items.length} items within the cap`);
  assert.equal(ledger.credits, host.credits);
  // A new day refills the stashes.
  const next = stashHost(ledger, 1);
  unlockGate(first, ledger, interiors, 1);
  lootStash(first, next);
  assert.ok(next.credits > 0 && ledger.credits === next.credits, "a new day resets the caps");
});

test("a full pack leaves the stash untouched", () => {
  const ledger = new LockedRoomsLedger(), interiors = new CityInteriors(world), spec = lockedRoomSpec(locked[0])!;
  unlockGate(spec, ledger, interiors, 0);
  const host = stashHost(ledger, 0);
  host.give = () => 0;
  lootStash(spec, host);
  assert.equal(host.credits, 0);
  assert.equal(ledger.isLooted(spec.building), false);
});

test("session flow: lock listed, a breach opens the gate, the stash pays once, the ledger survives a save", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const place = locked[0], spec = lockedRoomSpec(place)!, interiors = new CityInteriors(world);
  const session = new RpgSession({ world, storage });
  session.attachInteriors(interiors);
  const player: Player = { x: place.entrance.x, z: place.entrance.z, yaw: 0, pitch: 0, distance: 0 };
  interiors.enter(place, player);
  const input: RpgFrame["input"] = { attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 };
  const frameAt = (x: number, z: number): RpgFrame => ({ dt: 0.1, time: 1, input, player: { x, z, eye: 1.7, yaw: 0, pitch: 0, mode: "walk", onFoot: false, place: place.id } });
  const ids = () => session.interactables(place.id).map(item => item.id);
  assert.ok(ids().includes(`${LOCK_PREFIX}${place.building}`) && !ids().includes(`${STASH_PREFIX}${place.building}`));
  session.update(frameAt(spec.lock.worldX, spec.lock.worldZ));
  assert.equal(session.snapshot().prompt, "Hack the lock");
  assert.equal(session.interactNearby(), null, "the breach screen, no dialogue");
  const view = session.snapshot().hack;
  assert.ok(view && view.target === `${LOCK_PREFIX}${place.building}` && view.kind === "terminal");
  assert.ok(interiors.fixtures.some(item => item.kind === "gate"), "shut until the breach succeeds");
  session.action({ kind: "hackResult", attempt: view.attempt, report: { outcome: "success", trace: 0.2, elapsed: 9, mistakes: 0 } });
  assert.ok(!interiors.fixtures.some(item => item.kind === "gate"), "the live visit's gate is gone");
  assert.ok(interiors.gatesOpen(place.id));
  session.action({ kind: "closeHack" });
  assert.deepEqual(ids().filter(id => id.startsWith(LOCK_PREFIX) || id.startsWith(STASH_PREFIX)), [`${STASH_PREFIX}${place.building}`]);
  // E at the stash pays once.
  session.update(frameAt(spec.stash.worldX, spec.stash.worldZ));
  const credits = session.character.credits;
  assert.equal(session.interactNearby(), null);
  const paid = session.character.credits - credits;
  assert.ok(paid > 0, "credits paid");
  assert.equal(ids().some(id => id.startsWith(STASH_PREFIX)), false, "emptied");
  // The ledger round-trips through save and load: still open, still emptied; the next day shuts it.
  session.save();
  assert.ok(data.get(LOCKED_SAVE_KEY));
  const again = new RpgSession({ world, storage }), twin = new CityInteriors(world);
  again.attachInteriors(twin);
  assert.ok(twin.gatesOpen(place.id), "gates reopen after a load on the same day");
  assert.equal(again.interactables(place.id).some(item => item.id.startsWith(LOCK_PREFIX) || item.id.startsWith(STASH_PREFIX)), false);
  for (let t = 0; t <= LOCKED_DAY_SECONDS; t += 0.5) again.update({ ...frameAt(0, 0), dt: 0.5 }); // the quest clock caps each step at 0.5 s
  assert.ok(again.interactables(place.id).some(item => item.id === `${LOCK_PREFIX}${place.building}`), "a new day: locked again");
  assert.ok(!twin.gatesOpen(place.id));
});
