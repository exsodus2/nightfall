import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { CityInteriors, interiorFixtures, interiorPlaces } from "../src/city/interiors.ts";
import { MESH_BOX, PROP_STRIDE, PropRecorder } from "../src/city/prop-canvas.ts";
import { CityWorld, SPAWN } from "../src/city/world.ts";
import { HACKING_PACK, SPLICE_BIN, SPLICE_DECK, hackingTargets } from "../src/rpg/content/hacking-targets.ts";
import {
  ABORT_LOCK_SECONDS, ATM_MAX, ATM_MIN, ATM_NIGHT_CAP, DIMINISH_SECONDS, HACK_SAVE_KEY, HACK_TIERS, HackLedger, LOCKOUT_SECONDS, NIGHT_SECONDS, RESTOCK_SECONDS, SPLICE_WINDOW,
  adjacent, createHack, facePoint, fits, hackAbort, hackHead, hackLook, hackMove, hackReport, hackSites, hackTap, hackTick, hackTrace, hackUndo, setHackLook, stepCell,
  type HackDir, type HackState,
} from "../src/rpg/hacking/index.ts";
import { ITEMS } from "../src/rpg/items/index.ts";
import { validateContent } from "../src/rpg/quests/index.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { HackReport, HackTier, RpgFrame } from "../src/rpg/types.ts";

// signage.ts imports its neighbours without extensions (the bundler resolves them); resolve them here.
register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { drawShop } = await import("../src/city/signage.ts");

const world = new CityWorld();
const TIERS: readonly HackTier[] = ["easy", "medium", "hard"];

/** Walks the planted route with arrow moves. */
function solve(state: HackState): HackState {
  let s = state;
  for (let i = 1; i < s.solution.length; i++) {
    const from = s.solution[i - 1], to = s.solution[i];
    const dir: HackDir = to === from - s.size ? "up" : to === from + s.size ? "down" : to === from - 1 ? "left" : "right";
    s = hackMove(s, dir);
  }
  return s;
}
/** A cell next to the cursor that breaks the rule (not ICE, not on the path), or -1. */
function wrongNeighbour(state: HackState): number {
  const head = hackHead(state);
  for (const dir of ["up", "down", "left", "right"] as const) {
    const cell = stepCell(state.size, head, dir);
    if (cell >= 0 && !state.cells[cell].ice && !state.path.includes(cell) && !fits(state.rule, state.cells[head].glyphs, state.cells[cell].glyphs)) return cell;
  }
  return -1;
}

test("every grid is deterministic and solvable: the planted route runs edge to edge, obeys the rule and is never iced", () => {
  for (const tier of TIERS) {
    const spec = HACK_TIERS[tier];
    for (let seed = 1; seed <= 150; seed++) {
      const a = createHack({ seed, tier }), b = createHack({ seed, tier });
      assert.deepEqual(a.cells, b.cells);
      assert.deepEqual(a.solution, b.solution);
      const { size, solution, cells } = a;
      assert.equal(cells.length, size * size);
      assert.equal(solution[0] % size, 0, "entry on the left edge");
      assert.equal(solution.at(-1)! % size, size - 1, "core on the right edge");
      assert.ok(solution.length >= spec.minRoute, `${tier} ${seed}: route of ${solution.length}`);
      assert.equal(new Set(solution).size, solution.length);
      for (let i = 1; i < solution.length; i++) {
        assert.ok(adjacent(size, solution[i - 1], solution[i]));
        assert.ok(fits(a.rule, cells[solution[i - 1]].glyphs, cells[solution[i]].glyphs), `${tier} ${seed}: link ${i}`);
      }
      assert.ok(solution.every(cell => !cells[cell].ice));
      assert.equal(cells.filter(cell => cell.ice).length, spec.ice);
      assert.ok(cells.every(cell => /^[0-9A-F]{2}$/.test(cell.glyphs)));
      const done = solve(a);
      assert.equal(done.status, "success", `${tier} ${seed}`);
      assert.deepEqual(hackReport(done), { outcome: "success", trace: 0, elapsed: 0, mistakes: 0 });
    }
  }
  assert.notDeepEqual(createHack({ seed: 1, tier: "medium" }).cells, createHack({ seed: 2, tier: "medium" }).cells);
});

test("mistakes cost trace time but never end the run; stepping back is free; the trace never crosses itself", () => {
  let state = createHack({ seed: 7, tier: "medium" });
  const penalty = HACK_TIERS.medium.penalty;
  // Find a seed state with a wrong neighbour at the entry.
  let seed = 7;
  while (wrongNeighbour(state) < 0) state = createHack({ seed: ++seed, tier: "medium" });
  const wrong = wrongNeighbour(state);
  const after = hackTap(state, wrong);
  assert.equal(after.status, "running");
  assert.equal(after.penalty, penalty);
  assert.equal(after.mistakes, 1);
  assert.equal(after.path.length, 1, "the cursor stays put");
  assert.equal(after.event?.kind, "mismatch");
  assert.ok(Math.abs(hackTrace(after) - penalty / after.window) < 1e-9);
  // One legal step, then back onto the previous cell: free.
  const step = hackTap(after, after.solution[1]);
  assert.equal(step.path.length, 2);
  const back = hackTap(step, step.solution[0]);
  assert.equal(back.path.length, 1);
  assert.equal(back.penalty, penalty);
  assert.equal(hackUndo(step).path.length, 1);
  // Non-adjacent taps do nothing.
  assert.equal(hackTap(after, after.core), after);
  // ICE costs the same and blocks.
  const iced = state.cells.findIndex((cell, i) => cell.ice && adjacent(state.size, state.entry, i));
  if (iced >= 0) { const hit = hackTap(state, iced); assert.equal(hit.event?.kind, "ice"); assert.equal(hit.path.length, 1); assert.equal(hit.penalty, penalty); }
  // Enough mistakes run the trace out: that is the only way to fail by mistakes.
  let spam = state;
  while (spam.status === "running") spam = hackTap(spam, wrong);
  assert.equal(spam.status, "failed");
  assert.ok(spam.mistakes >= Math.ceil(spam.window / penalty));
});

test("the trace fills with time, a Splice Deck widens it, ICE spreads only off the route, Esc aborts", () => {
  const plain = createHack({ seed: 11, tier: "hard" }), spliced = createHack({ seed: 11, tier: "hard", splice: true });
  assert.deepEqual(plain.cells, spliced.cells, "the splice changes time, not the grid");
  assert.equal(spliced.window, plain.window * SPLICE_WINDOW);
  let s = plain;
  for (let t = 0; t < 20; t += 0.1) s = hackTick(s, 0.1);
  assert.ok(Math.abs(hackTrace(s) - 20 / plain.window) < 0.01);
  const iced = s.cells.filter(cell => cell.ice).length;
  assert.ok(iced > HACK_TIERS.hard.ice, "ICE spread on the hard tier");
  assert.ok(s.solution.every(cell => !s.cells[cell].ice));
  assert.ok(iced <= Math.floor((s.cells.length - s.solution.length) * 0.45));
  while (s.status === "running") s = hackTick(s, 0.5);
  assert.equal(s.status, "failed");
  assert.equal(hackReport(s)?.outcome, "failed");
  // A huge step (a hidden tab) is clamped.
  assert.ok(hackTick(plain, 30).elapsed <= 0.5);
  // The easy tier's ICE stays put.
  let easy = createHack({ seed: 3, tier: "easy" });
  const before = easy.cells.filter(cell => cell.ice).length;
  for (let t = 0; t < 30; t += 0.25) easy = hackTick(easy, 0.25);
  assert.equal(easy.cells.filter(cell => cell.ice).length, before);
  const aborted = hackAbort(createHack({ seed: 5, tier: "easy" }));
  assert.equal(aborted.status, "aborted");
  assert.equal(hackMove(aborted, "right"), aborted, "a finished run ignores input");
  assert.equal(hackReport(aborted)?.outcome, "aborted");
});

const report = (outcome: HackReport["outcome"], trace = 0.3): HackReport => ({ outcome, trace, elapsed: 10, mistakes: 0 });

test("ATMs pay 40-180 cr by district, half per recent hit, under a nightly cap; failures lock and alarm", () => {
  const ledger = new HackLedger();
  const atm = (district: number, id = `atm:${district}`) => ({ id, kind: "atm" as const, tier: "easy" as const, district });
  for (let district = 0; district < 6; district++) for (const roll of [0, 0.5, 1]) {
    const quote = ledger.atmQuote(atm(district), roll);
    assert.ok(quote >= ATM_MIN && quote <= ATM_MAX, `district ${district}: ${quote}`);
  }
  assert.ok(ledger.atmQuote(atm(1), 0.5) > ledger.atmQuote(atm(5), 0.5), "the Neon Ward pays more than the Spillway");
  const first = ledger.settle(atm(4), report("success"), 0.5);
  assert.ok(first.credits >= ATM_MIN && !first.alarm && first.lock === 0);
  const second = ledger.settle(atm(4), report("success"), 0.5);
  assert.equal(second.credits, Math.round(first.credits / 2));
  ledger.tick(DIMINISH_SECONDS + 1);
  assert.equal(ledger.settle(atm(4), report("success"), 0.5).credits, first.credits, "the machine recovers");
  // Slow success: paid, but the alarm goes.
  assert.equal(ledger.settle(atm(2, "atm:slow"), report("success", 0.9), 0.5).alarm, true);
  // Failure: alarm and a 5 minute lock.
  const failed = ledger.settle(atm(3, "atm:fail"), report("failed", 1), 0.5);
  assert.deepEqual([failed.alarm, failed.lock, failed.credits], [true, LOCKOUT_SECONDS, 0]);
  assert.match(ledger.blocked({ id: "atm:fail", kind: "atm" }) ?? "", /Locked out \(5:00\)/);
  ledger.tick(LOCKOUT_SECONDS);
  assert.equal(ledger.blocked({ id: "atm:fail", kind: "atm" }), null);
  // Abort: a short cool-down, no alarm.
  const aborted = ledger.settle(atm(3, "atm:esc"), report("aborted"), 0.5);
  assert.deepEqual([aborted.alarm, aborted.lock], [false, ABORT_LOCK_SECONDS]);
  // The nightly cap, then a new night.
  const capped = new HackLedger();
  let total = 0;
  for (let k = 0; k < 40; k++) total += capped.settle(atm(2, `atm:cap${k}`), report("success"), 1).credits;
  assert.equal(total, ATM_NIGHT_CAP);
  assert.match(capped.blocked({ id: "atm:new", kind: "atm" }) ?? "", /next night/);
  capped.tick(NIGHT_SECONDS);
  assert.equal(capped.blocked({ id: "atm:new", kind: "atm" }), null);
});

test("doors open a back room (loot and data shards) that restocks; the ledger survives a save", () => {
  const ledger = new HackLedger();
  const door = { id: "door:1", kind: "door" as const, tier: "medium" as const, district: 0 };
  const opened = ledger.settle(door, report("success"), 0.5);
  assert.equal(opened.loot, "hack.backroom");
  assert.equal(opened.shards, 1);
  assert.equal(ledger.settle({ ...door, id: "door:2", tier: "hard" }, report("success"), 0.5).shards, 2);
  assert.match(ledger.blocked(door) ?? "", /cleaned out/);
  ledger.settle({ ...door, id: "door:3" }, report("failed", 1), 0.5);
  ledger.tick(100);
  const copy = HackLedger.parse(ledger.serialize());
  assert.equal(copy.clock, ledger.clock);
  assert.equal(copy.restockRemaining("door:1"), RESTOCK_SECONDS - 100);
  assert.equal(copy.lockRemaining("door:3"), LOCKOUT_SECONDS - 100);
  assert.equal(HackLedger.parse("{broken").clock, 0);
  assert.equal(HackLedger.parse(null).clock, 0);
});

test("about 60 ATMs (mostly Neon Ward and Silk Market, few in the Ghost Circuit) and about 24 doors, off the venues, reachable", () => {
  const sites = hackSites(world);
  assert.equal(hackSites(world), sites, "cached per world");
  const atms = sites.filter(s => s.kind === "atm"), doors = sites.filter(s => s.kind === "door");
  assert.ok(atms.length >= 48 && atms.length <= 75, `${atms.length} ATMs`);
  assert.ok(doors.length >= 16 && doors.length <= 34, `${doors.length} doors`);
  const by = (district: number) => atms.filter(s => s.district === district).length;
  assert.ok(by(1) + by(4) > atms.length / 2);
  assert.ok(by(2) <= 5);
  assert.ok(doors.some(s => s.tier === "hard") && doors.some(s => s.tier === "medium"));
  assert.equal(new Set(sites.map(s => s.id)).size, sites.length);
  const venues = new Set(interiorPlaces(world).map(place => place.building));
  for (const site of sites) {
    assert.ok(!venues.has(site.building), site.id);
    const building = world.buildings.find(b => b.id === site.building)!;
    const stand = facePoint(building, site.side, site.along, 1.4);
    assert.ok(world.canOccupy(stand.x, stand.z), `${site.id} can be reached`);
    assert.ok(Math.hypot(stand.x - site.x, stand.z - site.z) < 2.6);
  }
  const nearest = Math.min(...atms.map(s => Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z)));
  assert.ok(nearest < 60, `nearest ATM ${nearest.toFixed(1)} m from spawn`);
  assert.deepEqual(hackingTargets(world).map(t => t.id), sites.map(s => s.id));
  assert.ok(hackingTargets(world).every(t => t.hack && !t.place));
});

test("the ATM prop stands exactly where its interactable is, and its screen follows the display state", () => {
  const atm = hackSites(world).find(s => s.kind === "atm")!;
  const building = world.buildings.find(b => b.id === atm.building)!;
  const housing = facePoint(building, atm.side, atm.along, 0.17);
  const record = () => {
    const recorder = new PropRecorder(character => [character.charCodeAt(0) / 255, 0, 0]);
    drawShop(recorder, building, 10, { x: atm.x, z: atm.z }, () => true, 300);
    const data = recorder.data[MESH_BOX], boxes: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < recorder.counts[MESH_BOX]; i++) { const o = i * PROP_STRIDE; boxes.push({ x: data[o], y: -data[o + 1], z: data[o + 2] }); }
    return boxes;
  };
  const boxes = record();
  assert.ok(boxes.some(b => Math.hypot(b.x - housing.x, b.z - housing.z) < 0.03 && Math.abs(b.y - 1.2) < 0.03), "housing box at the site");
  const screen = facePoint(building, atm.side, atm.along, 0.355);
  const screenBox = (list: typeof boxes) => list.find(b => Math.hypot(b.x - screen.x, b.z - screen.z) < 0.03 && Math.abs(b.y - 1.55) < 0.03);
  assert.ok(screenBox(boxes));
  // The notes ease out of the slot over the first 0.5 s (signage.ts) instead of popping, so sample
  // the paid state a second in, when they are fully out.
  setHackLook(atm.id, "paid", 10, performance.now() / 1000 - 1);
  assert.equal(hackLook(atm.id)?.look, "paid");
  const paid = record();
  assert.ok(paid.length > boxes.length, "notes out of the slot");
  setHackLook(atm.id, "paid", 0);
  assert.equal(hackLook(atm.id), null);
});

const input: RpgFrame["input"] = { attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 };
function memory() {
  const saved = new Map<string, string>();
  return { saved, getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
}

test("E at an ATM opens the breach screen; the session pays, locks, alarms and remembers", () => {
  const storage = memory();
  const session = new RpgSession({ world, packs: [HACKING_PACK], storage });
  const site = hackSites(world).find(s => s.kind === "atm")!;
  const building = world.buildings.find(b => b.id === site.building)!;
  const stand = facePoint(building, site.side, site.along, 1.4);
  const frame = (): RpgFrame => ({ dt: 0.1, time: 1, input, player: { x: stand.x, z: stand.z, eye: 2.7, yaw: 0, pitch: 0, mode: "walk", onFoot: true, place: "" } });
  session.update(frame());
  assert.equal(session.snapshot().prompt, "Hack the ATM");
  assert.equal(session.hasInteraction(), true);
  assert.equal(session.interactNearby(), null, "no dialogue: the breach screen");
  const view = session.snapshot().hack;
  assert.ok(view);
  assert.deepEqual([view.target, view.kind, view.tier, view.splice, view.result], [site.id, "atm", "easy", false, null]);
  assert.equal(session.hasInteraction(), false, "nothing else while the screen is up");
  // Solve the puzzle the screen would build, and report it.
  const solved = solve(createHack({ seed: view.seed, tier: view.tier, splice: view.splice }));
  const credits = session.character.credits;
  session.action({ kind: "hackResult", attempt: view.attempt + 1, report: hackReport(solved)! });
  assert.equal(session.snapshot().hack?.result, null, "a stale attempt is ignored");
  session.action({ kind: "hackResult", attempt: view.attempt, report: hackReport(solved)! });
  const result = session.snapshot().hack?.result;
  assert.equal(result?.outcome, "success");
  const paid = session.character.credits - credits;
  assert.ok(paid >= ATM_MIN && paid <= ATM_MAX, `${paid} cr`);
  assert.equal(hackLook(site.id)?.look, "paid");
  session.action({ kind: "closeHack" });
  assert.equal(session.snapshot().hack, null);
  // Second time within ten minutes: half. Then a failure: alarm, lock, prompt says so.
  session.update(frame());
  session.interactNearby();
  const again = session.snapshot().hack!;
  assert.notEqual(again.seed, view.seed, "a new grid every attempt");
  session.action({ kind: "hackResult", attempt: again.attempt, report: { outcome: "success", trace: 0.2, elapsed: 9, mistakes: 0 } });
  const halved = session.character.credits - credits - paid;
  assert.ok(halved >= ATM_MIN / 2 && halved <= ATM_MAX / 2, `second hit pays half a float: ${halved} cr`);
  session.action({ kind: "closeHack" });
  session.update(frame());
  session.interactNearby();
  const third = session.snapshot().hack!;
  session.action({ kind: "hackResult", attempt: third.attempt, report: { outcome: "failed", trace: 1, elapsed: 40, mistakes: 3 } });
  assert.equal(session.snapshot().hack?.result?.alarm, true);
  assert.ok(session.snapshot().feed.some(line => line.text.startsWith("Alarm tripped")));
  session.action({ kind: "closeHack" });
  session.update(frame());
  assert.match(session.snapshot().prompt ?? "", /^ATM: Locked out \((5:00|4:5\d)\)$/);
  session.interactNearby();
  assert.equal(session.snapshot().hack, null, "a locked ATM does not open");
  // The lock survives a reload; a New game clears it.
  session.save();
  assert.ok(storage.saved.has(HACK_SAVE_KEY));
  const reloaded = new RpgSession({ world, packs: [HACKING_PACK], storage });
  reloaded.update(frame());
  assert.match(reloaded.snapshot().prompt ?? "", /^ATM: Locked out/);
  reloaded.reset();
  assert.equal(storage.saved.has(HACK_SAVE_KEY), false);
});

test("Esc pulls out with a short cool-down; a door's back room pays loot and data shards; the Splice Deck shows", () => {
  const session = new RpgSession({ world, packs: [HACKING_PACK] });
  const door = hackSites(world).find(s => s.kind === "door")!;
  const building = world.buildings.find(b => b.id === door.building)!;
  const stand = facePoint(building, door.side, door.along, 1.4);
  const frame = (): RpgFrame => ({ dt: 0.1, time: 1, input, player: { x: stand.x, z: stand.z, eye: 2.7, yaw: 0, pitch: 0, mode: "walk", onFoot: true, place: "" } });
  session.character.add(SPLICE_DECK, 1);
  session.update(frame());
  assert.match(session.snapshot().prompt ?? "", /^Hack the (service door|corp service terminal)$/);
  session.interactNearby();
  const first = session.snapshot().hack!;
  assert.equal(first.splice, true);
  assert.equal(first.tier, door.tier);
  session.action({ kind: "hackResult", attempt: first.attempt, report: { outcome: "aborted", trace: 0.1, elapsed: 3, mistakes: 0 } });
  assert.equal(session.snapshot().hack, null, "Esc closes at once");
  session.update(frame());
  assert.match(session.snapshot().prompt ?? "", /Locked out \(\d+ s\)/);
  session.update({ ...frame(), dt: ABORT_LOCK_SECONDS + 1 });
  session.interactNearby();
  const second = session.snapshot().hack!;
  const shards = session.character.count("data-shard");
  session.action({ kind: "hackResult", attempt: second.attempt, report: { outcome: "success", trace: 0.3, elapsed: 20, mistakes: 1 } });
  assert.equal(session.character.count("data-shard") - shards, door.tier === "hard" ? 2 : 1);
  assert.ok((session.snapshot().hack?.result?.lines.length ?? 0) >= 2);
  session.action({ kind: "closeHack" });
  session.update(frame());
  assert.match(session.snapshot().prompt ?? "", /cleaned out/);
});

test("the Splice Deck: valid content, sold from a reachable bin in Second Life Salvage, found in back rooms", () => {
  assert.deepEqual(validateContent(HACKING_PACK, { id: "catalogue", items: ITEMS }), []);
  const place = interiorPlaces(world).find(p => p.id === "second-life")!;
  const rooms = new CityInteriors(world);
  rooms.active = place;
  rooms.fixtures = interiorFixtures(place);
  const approach = { x: SPLICE_BIN.x, z: SPLICE_BIN.z + 1.4 };
  assert.ok(rooms.canOccupy(approach.x, approach.z));
  const session = new RpgSession({ world, packs: [HACKING_PACK] });
  session.update({ dt: 0.1, time: 1, input, player: { ...approach, eye: 2.7, yaw: 0, pitch: 0, mode: "walk", onFoot: false, place: "second-life" } });
  assert.equal(session.snapshot().prompt, SPLICE_BIN.label);
  const offer = session.interactNearby();
  const buy = offer?.options.find(option => option.id === "buy-splice");
  assert.ok(buy);
  session.character.addCredits(400 - session.character.credits);
  session.close();
  session.interactNearby();
  session.choose("buy-splice");
  assert.equal(session.character.count(SPLICE_DECK), 1);
  assert.equal(session.character.credits, 400 - 260);
  assert.ok(HACKING_PACK.loot?.every(table => table.entries.some(entry => entry.item === SPLICE_DECK)));
});
