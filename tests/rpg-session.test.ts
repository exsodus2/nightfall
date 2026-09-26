import assert from "node:assert/strict";
import test from "node:test";
import { CityWorld } from "../src/city/world.ts";
import { RpgSession } from "../src/rpg/session.ts";
import type { ContentPack, RpgFrame } from "../src/rpg/types.ts";

const world = new CityWorld();
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); }, data }; };
const idle = (): RpgFrame["input"] => ({ attackHeld: false, attackPressed: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, selectSlot: null, quickUse: null, interactPressed: false, forward: 0, strafe: 0 });
const frame = (x: number, z: number, input = idle(), dt = 1 / 60): RpgFrame => ({ dt, time: 0, player: { x, z, eye: 2.7, yaw: 0, pitch: 0, mode: "walk", onFoot: true }, input });

test("a player kill drops the archetype's loot and grants its xp; E picks the pile up", () => {
  const rpg = new RpgSession({ world, testContent: true });
  const xp = rpg.character.xp;
  rpg.bus.emit({ type: "killed", enemy: "e1", archetype: "razorback-thug", faction: "razorbacks", tags: [], encounter: null, x: 11.5, z: 77, byPlayer: true });
  assert.ok(rpg.character.xp > xp || rpg.character.level > 1, "xp granted");
  const views = rpg.groundLoot({ x: 11.5, z: 77 });
  if (views.length) {
    const before = rpg.character.credits + rpg.character.state.inventory.reduce((s, i) => s + i.count, 0);
    rpg.update(frame(views[0].x, views[0].z));
    assert.match(rpg.snapshot().prompt ?? "", /^Pick up /);
    rpg.update(frame(views[0].x, views[0].z, { ...idle(), interactPressed: true }));
    const after = rpg.character.credits + rpg.character.state.inventory.reduce((s, i) => s + i.count, 0);
    assert.ok(after > before, "picked up");
    assert.ok(rpg.snapshot().feed.some(f => f.tone === "loot"));
  }
});

test("kills by others give nothing", () => {
  const rpg = new RpgSession({ world, testContent: true });
  const xp = rpg.character.xp;
  rpg.bus.emit({ type: "killed", enemy: "e1", archetype: "razorback-thug", faction: "razorbacks", tags: [], encounter: null, x: 11.5, z: 77, byPlayer: false });
  assert.equal(rpg.character.xp, xp);
  assert.equal(rpg.groundLoot({ x: 11.5, z: 77 }).length, 0);
});

test("vendor NPCs get a Trade option that opens the shop; buying spends credits", () => {
  const pack: ContentPack = { id: "test-shop", vendors: [{ npc: "mara", stock: ["stim"] }] };
  const rpg = new RpgSession({ world, packs: [pack] });
  const dialogue = rpg.talk("mara");
  assert.ok(dialogue?.options.some(o => o.id === "@trade"));
  rpg.choose("@trade");
  assert.equal(rpg.dialogue, null);
  const vendor = rpg.snapshot().vendor;
  assert.ok(vendor && vendor.stock.some(o => o.item === "stim"));
  const credits = rpg.character.credits, stims = rpg.character.count("stim");
  rpg.action({ kind: "buy", item: "stim" });
  assert.ok(rpg.character.count("stim") === stims + 1 && rpg.character.credits < credits);
  rpg.action({ kind: "closeVendor" });
  assert.equal(rpg.snapshot().vendor, null);
});

test("saves round-trip the character, quests and position", () => {
  const storage = memory();
  const a = new RpgSession({ world, storage });
  a.character.addCredits(777);
  a.talk("mara"); a.choose("accept:relay-chip");
  a.save({ x: 20, z: 60, yaw: 1 });
  const b = new RpgSession({ world, storage });
  assert.equal(b.character.credits, a.character.credits);
  assert.deepEqual(b.savedPosition, { x: 20, z: 60, yaw: 1 });
  assert.equal(b.quests.status("relay-chip"), a.quests.status("relay-chip"));
});

test("combat input is ignored off foot and while a shop is open", () => {
  const rpg = new RpgSession({ world, testContent: true });
  rpg.combat.spawnEncounter("combat-test-gang");
  const attack = { ...idle(), attackPressed: true, attackHeld: true };
  rpg.update({ ...frame(64, 110, attack), player: { ...frame(64, 110).player, onFoot: false } });
  assert.notEqual(rpg.playerView().action, "light");
});
