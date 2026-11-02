// The RPG session: owns every rpg/ system, wires them through the event bus and is the only thing the
// engine talks to. Pure (no DOM, no textmode): the engine passes frames in, reads views out, and
// supplies a Storage-like object for saves.

import { NPCS, type NpcDefinition } from "../city/npcs.ts";
import type { CityWorld } from "../city/world.ts";
import { BUILDING_PLACE_ID, CityInteriors, interiorPlaces, type InteriorPlace } from "../city/interiors.ts";
import { secretPlaces } from "../city/secrets.ts"; // Secrets
import type { DialogueResult, NpcDialogue, NpcMarker, QuestSnapshot } from "../city/quests.ts";
import { EventBus } from "./events.ts";
import { Character, ItemRegistry, ITEMS, LootSystem, Vendors, WorldLoot, loadSave, parseSave, seededRng, writeSave, clearSave, type SaveGame } from "./items/index.ts";
import { CombatWorld, COMBAT_TEST_ARCHETYPES, COMBAT_TEST_ENCOUNTERS, COMBAT_TEST_ITEMS } from "./combat/index.ts";
import { LEGACY_PACK, QuestEngine } from "./quests/index.ts";
import type { ContentPack, EnemyArchetype, EnemyView, CombatEffect, FactionId, GroundLootView, InteractableDefinition, ItemDefinition, PlayerAttack, PlayerCombatView, Point, RpgFrame, RpgSnapshot, RpgUiAction } from "./types.ts";
import type { HackReport, HackSpec, HackView } from "./types.ts"; // Hacking
import { HACK_SAVE_KEY, HackLedger, setHackLook } from "./hacking/index.ts"; // Hacking
import { SPLICE_DECK, hackingTargets } from "./content/hacking-targets.ts"; // Hacking
import { DAY_SECONDS, GROUND_LIFE_PREFIX, GROUND_LIFE_SAVE_KEY, GroundLifeLedger, groundLifeInteractable, groundLifeSpec, applyGroundLife, type GroundLifeHost } from "./ground-life.ts"; // Ground life
import { LOCKED_DAY_SECONDS, LOCKED_SAVE_KEY, LOCK_PREFIX, LockedRoomsLedger, STASH_PREFIX, lockedRoomInteractables, lockedRoomSpec, lootStash, syncGates, unlockGate, type GateHost, type StashHost } from "./locked-rooms.ts"; // Locked rooms

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
type Tone = "info" | "quest" | "loot" | "danger";

export interface RpgSessionOptions {
  world: CityWorld;
  packs?: readonly ContentPack[];
  storage?: Storage | null;
  /** Includes the combat module's test gang and boss encounters (studio / tests). */
  testContent?: boolean;
}

const TRADE_OPTION = "@trade";
const INTERACT_RANGE = 2.6;
const AUTOSAVE_SECONDS = 20;

export class RpgSession {
  readonly bus = new EventBus();
  readonly registry: ItemRegistry;
  readonly character: Character;
  readonly loot: LootSystem;
  readonly worldLoot: WorldLoot;
  readonly vendors: Vendors;
  readonly combat: CombatWorld;
  readonly quests: QuestEngine;
  private readonly storage: Storage | null;
  private readonly venues: Map<string, InteriorPlace>;
  /** Ground and upper floors (bldg-<id>, bldg-<id>-f<floor>): resolved on demand, then cached in `venues`. */
  private groundFloors: CityInteriors | null = null;
  private readonly cityWorld: RpgSessionOptions["world"];
  private readonly archetypes = new Map<string, EnemyArchetype>();
  private readonly npcNames = new Map<string, string>();
  private readonly rng = seededRng(0x5eed);
  private feed: { id: number; text: string; tone: Tone }[] = [];
  private feedId = 0;
  private vendorOpen: string | null = null;
  private waypoint: (Point & { label: string }) | null = null;
  private prompt: string | null = null;
  private lastPlayer: RpgFrame["player"] | null = null;
  private saveTimer = 0;
  private dirty = false;
  /** Seconds of updates so far (the CorpSec toast's once-a-minute limit runs on it). */
  private clock = 0;
  private lastAlert = -Infinity;
  /** The swing or shot started during the last update, until taken. */
  private attack: PlayerAttack | null = null;
  private readonly threatList: Point[] = [];
  /** Hacking: the street ATMs and service doors (outside the quest engine: no floating markers),
   * the economy ledger (saved beside the RPG save) and the open breach screen. */
  private readonly hackTargets: readonly InteractableDefinition[];
  private readonly hackLedger: HackLedger;
  private readonly groundLedger: GroundLifeLedger; // Ground life: its own small ledger, saved beside the RPG save
  private readonly lockedLedger: LockedRoomsLedger; // Locked rooms: gates opened and stashes emptied today, saved beside the RPG save
  private gateHost: GateHost | null = null;
  private gateDay = -1;
  private hackOpen: { target: InteractableDefinition; spec: HackSpec; view: HackView } | null = null;
  private hackAttempts = 0;
  discovered: string[] = [];

  constructor(opts: RpgSessionOptions) {
    const packs = [LEGACY_PACK, ...(opts.packs ?? [])];
    this.storage = opts.storage ?? null;
    this.cityWorld = opts.world;
    this.venues = new Map([...interiorPlaces(opts.world), ...secretPlaces(opts.world)].map(place => [place.id, place])); // Secrets: hidden rooms take E and save at their door too
    const save = this.storage ? loadSave(this.storage) : null;
    this.registry = new ItemRegistry([...ITEMS, ...COMBAT_TEST_ITEMS.filter(item => !ITEMS.some(base => base.id === item.id))]);
    for (const pack of packs) this.registry.register(pack.items);
    this.vendors = new Vendors(this.registry);
    this.character = new Character(this.registry, this.bus, save?.character);
    this.loot = new LootSystem(this.registry);
    this.worldLoot = new WorldLoot(this.registry, (x, z) => opts.world.canOccupy(x, z));
    const archetypes = [...COMBAT_TEST_ARCHETYPES, ...packs.flatMap(p => p.archetypes ?? [])];
    for (const a of archetypes) this.archetypes.set(a.id, a);
    this.combat = new CombatWorld({ world: opts.world, bus: this.bus, items: this.registry, archetypes, encounters: [...(opts.testContent ? COMBAT_TEST_ENCOUNTERS : []), ...packs.flatMap(p => p.encounters ?? [])], rng: seededRng(0xc0b) });
    const npcs: NpcDefinition[] = [...NPCS];
    for (const pack of packs) for (const npc of pack.npcs ?? []) if (!npcs.some(n => n.id === npc.id)) npcs.push(npc);
    for (const npc of npcs) this.npcNames.set(npc.id, npc.name);
    this.quests = new QuestEngine({ bus: this.bus, host: this.host(), npcs: NPCS });
    for (const pack of packs) {
      this.loot.register(pack.loot ?? []);
      this.vendors.register(pack.vendors);
      this.quests.register(pack);
    }
    this.wire();
    if (save) {
      this.quests.load(save.quests);
      for (const [key, value] of Object.entries(save.flags)) if (!key.startsWith("gl.") && this.quests.flags.get(key) === undefined) this.quests.setFlag(key, value);
      this.combat.load(save.encounters);
      this.discovered = [...save.discovered];
      this.savedPosition = save.position;
    }
    // Hacking: targets from the city, the ledger from storage; locked machines show their lock again.
    this.hackTargets = hackingTargets(opts.world);
    let ledger: string | null = null;
    try { ledger = this.storage?.getItem(HACK_SAVE_KEY) ?? null; } catch { ledger = null; }
    this.hackLedger = HackLedger.parse(ledger);
    let groundLife: string | null = null;
    try { groundLife = this.storage?.getItem(GROUND_LIFE_SAVE_KEY) ?? null; } catch { groundLife = null; }
    this.groundLedger = GroundLifeLedger.parse(groundLife);
    let lockedRooms: string | null = null;
    try { lockedRooms = this.storage?.getItem(LOCKED_SAVE_KEY) ?? null; } catch { lockedRooms = null; }
    this.lockedLedger = LockedRoomsLedger.parse(lockedRooms);
    for (const target of this.hackTargets) {
      const lock = this.hackLedger.lockRemaining(target.id), restock = this.hackLedger.restockRemaining(target.id);
      if (lock > 0) setHackLook(target.id, "locked", lock); else if (restock > 0) setHackLook(target.id, "open", restock);
    }
  }
  /** Locked rooms: the engine's interiors, whose gates follow the ledger (synced now and on each in-game day). */
  attachInteriors(interiors: GateHost): void {
    this.gateHost = interiors;
    this.syncLockedGates(true);
  }
  private lockedDay(): number { return Math.floor(this.quests.clock / LOCKED_DAY_SECONDS); }
  private syncLockedGates(force = false): void {
    const day = this.lockedDay();
    if (!force && day === this.gateDay) return;
    this.gateDay = day;
    if (this.gateHost) syncGates(this.lockedLedger, this.gateHost, day); else this.lockedLedger.rollDay(day);
  }
  /** Where the loaded save left the player (the engine teleports there once). */
  savedPosition: SaveGame["position"] = null;

  // ---- wiring ----------------------------------------------------------------------------------

  private wire(): void {
    this.bus.on("killed", event => {
      if (!event.byPlayer) return;
      const archetype = this.archetypes.get(event.archetype);
      if (!archetype) return;
      const roll = this.loot.roll(archetype.loot, this.rng);
      this.worldLoot.drop(event.x, event.z, roll.items, roll.credits);
      const { levelsGained } = this.character.addXp(archetype.xp);
      this.post(`+${archetype.xp} XP`, "info");
      if (levelsGained) this.post(`Level ${this.character.level}`, "quest");
      this.dirty = true;
    });
    this.bus.on("message", event => this.post(event.text, event.tone ?? "info"));
    this.bus.on("questUpdated", () => { this.dirty = true; });
    this.bus.on("playerDied", () => this.post("Flatlined", "danger"));
  }

  private host(): import("./types.ts").QuestHost {
    const c = (): Character => this.character;
    return {
      give: (item, count) => { c().add(item, count); },
      take: (item, count) => c().remove(item, count),
      count: item => c().count(item),
      credits: delta => c().addCredits(delta),
      get creditBalance() { return c().credits; },
      xp: amount => { c().addXp(amount); },
      get level() { return c().level; },
      rep: (faction: FactionId, delta) => { c().addReputation(faction, delta); },
      reputation: faction => c().reputation(faction),
      stat: name => c().stats[name],
      spawnEncounter: id => this.combat.spawnEncounter(id),
      despawnEncounter: id => this.combat.despawnEncounter(id),
      setHostile: (id, hostile) => this.combat.setHostile(id, hostile),
      encounterCleared: id => this.combat.encounterCleared(id),
      setWaypoint: point => { this.waypoint = point; },
      message: (text, tone) => this.post(text, tone ?? "info"),
    };
  }

  private post(text: string, tone: Tone): void {
    this.feed.push({ id: ++this.feedId, text, tone });
    if (this.feed.length > 12) this.feed.shift();
  }

  // ---- per frame -------------------------------------------------------------------------------

  /** Runs combat, loot and quests for one frame. Returns the displacement the engine must apply
   * through its collision (dodge, knockback, lock-on magnetism, enemy body push). */
  update(frame: RpgFrame): { move: Point | null } {
    const player = frame.player.place ? { ...frame.player, onFoot: false } : frame.player;
    this.lastPlayer = player;
    this.worldLoot.update(frame.dt);
    this.hackLedger.tick(frame.dt); // Hacking: lockouts, restocks and the nightly cap run on play time
    const input = player.onFoot && !this.vendorOpen && !this.hackOpen ? frame.input : { ...frame.input, attackPressed: false, attackHeld: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, quickUse: null, selectSlot: null, interactPressed: false };
    const { move } = this.combat.update({ ...frame, player, input }, this.character);
    if (Number.isFinite(frame.dt) && frame.dt > 0) this.clock += frame.dt;
    // Street life: a swing or shot started this frame (taken once by the engine, checked against civilians).
    const attack = this.combat.takePlayerAttack();
    this.attack = attack && player.onFoot ? attack : null;
    this.quests.update(frame.dt, player);
    // Pickups and world objects: E takes the nearest pile, else uses the nearest object.
    const pile = this.canInteract(player) && !player.place ? this.worldLoot.nearest(player.x, player.z) : null;
    const object = !pile ? this.nearestInteractable(player) : null;
    this.prompt = pile ? `Pick up ${pile.name}${pile.count > 1 ? ` x${pile.count}` : ""}${pile.rarity !== "common" ? ` [${pile.rarity}]` : ""}` : object ? this.hackPrompt(object) ?? object.label : null;
    if (input.interactPressed && pile) this.pickup(pile);
    this.saveTimer += frame.dt;
    if (this.saveTimer > AUTOSAVE_SECONDS || (this.dirty && this.saveTimer > 3)) this.save();
    return { move };
  }

  private pickup(pile: GroundLootView): void {
    const result = this.worldLoot.pickup(pile.id, this.character);
    for (const stack of result.taken) this.post(`+ ${this.registry.get(stack.item)?.name ?? stack.item}${stack.count > 1 ? ` x${stack.count}` : ""}`, "loot");
    if (result.credits) this.post(`+ ${result.credits} cr`, "loot");
    if (result.leftover) this.post("Pack full", "danger");
    this.dirty = true;
  }

  private venue(id: string): InteriorPlace | null {
    const known = this.venues.get(id);
    if (known || !BUILDING_PLACE_ID.test(id)) return known ?? null; // ground floors bldg-<id>, upper floors bldg-<id>-f<floor>
    this.groundFloors ??= new CityInteriors(this.cityWorld);
    const place = this.groundFloors.placeById(id);
    if (place) this.venues.set(id, place);
    return place;
  }

  private canInteract(player: RpgFrame["player"]): boolean {
    return !this.dead && !this.vendorOpen && !this.hackOpen && player.mode === "walk" && (player.place ? this.venue(player.place) !== null : player.onFoot);
  }

  private nearestInteractable(player: RpgFrame["player"]): InteractableDefinition | null {
    if (!this.canInteract(player)) return null;
    let best: InteractableDefinition | null = null, bestDistance = INTERACT_RANGE;
    for (const item of this.interactables(player.place)) {
      const d = Math.hypot(item.x - player.x, item.z - player.z);
      if (d < bestDistance) { best = item; bestDistance = d; }
    }
    // Hacking: street ATMs and service doors (outdoors only).
    if (!player.place) for (const item of this.hackTargets) {
      const d = Math.hypot(item.x - player.x, item.z - player.z);
      if (d < bestDistance) { best = item; bestDistance = d; }
    }
    return best;
  }

  /** E with nothing else in reach: a nearby world object. Returns its dialogue if it opens one. */
  interactNearby(): NpcDialogue | null {
    if (!this.lastPlayer || !this.canInteract(this.lastPlayer)) return null;
    if (!this.lastPlayer.place && this.worldLoot.nearest(this.lastPlayer.x, this.lastPlayer.z)) return null;
    const object = this.nearestInteractable(this.lastPlayer);
    if (object?.hack) { this.openHack(object, object.hack); return null; } // Hacking: the breach screen instead
    if (object?.id.startsWith(STASH_PREFIX)) { this.applyStash(object); return null; } // Locked rooms: the stash pays out into the feed
    if (object?.id.startsWith(GROUND_LIFE_PREFIX)) { this.applyGroundLife(object); return null; } // Ground life: a one-line result in the feed
    return object ? this.quests.interact(object.id) : null;
  }
  /** True when E has something RPG-side to do here (a pile or an object). */
  hasInteraction(): boolean {
    const player = this.lastPlayer;
    return !!player && this.canInteract(player) && (!!this.nearestInteractable(player) || (!player.place && !!this.worldLoot.nearest(player.x, player.z)));
  }

  /** Distance to what E would use RPG-side (a pile, else an object), or null when there is nothing. */
  interactionDistance(): number | null {
    const player = this.lastPlayer;
    if (!player || !this.canInteract(player)) return null;
    const pile = !player.place ? this.worldLoot.nearest(player.x, player.z) : null;
    if (pile) return Math.hypot(pile.x - player.x, pile.z - player.z);
    const object = this.nearestInteractable(player);
    return object ? Math.hypot(object.x - player.x, object.z - player.z) : null;
  }

  // ---- dialogue (vendors add a Trade option) --------------------------------------------------

  talk(npcId: string): NpcDialogue | null { return this.withTrade(this.quests.talk(npcId)); }
  choose(optionId: string): DialogueResult {
    const open = this.quests.dialogue;
    if (optionId === TRADE_OPTION && open) { this.vendorOpen = open.npcId; this.quests.close(); return { dialogue: null, message: null }; }
    const result = this.quests.choose(optionId);
    this.dirty = true;
    return { dialogue: this.withTrade(result.dialogue), message: null };
  }
  private withTrade(dialogue: NpcDialogue | null): NpcDialogue | null {
    if (!dialogue || !this.vendors.isVendor(dialogue.npcId) || dialogue.options.some(o => o.id === TRADE_OPTION)) return dialogue;
    return { ...dialogue, options: [{ id: TRADE_OPTION, label: "Trade", kind: "continue" }, ...dialogue.options] };
  }
  get dialogue(): NpcDialogue | null { return this.withTrade(this.quests.dialogue); }
  close(): void { this.quests.close(); }
  marker(npcId: string): NpcMarker { return this.quests.marker(npcId); }
  get npcs(): readonly NpcDefinition[] { return this.quests.npcs; }
  questSnapshot(nearby: NpcDefinition | null): QuestSnapshot {
    const snapshot = this.quests.snapshot(nearby);
    const markers = this.npcs.map(npc => ({ id: npc.id, name: npc.name, x: npc.x, z: npc.z, state: this.marker(npc.id) }));
    return { ...snapshot, credits: this.character.credits, markers };
  }
  get questWaypoint(): (Point & { label: string }) | null { return this.waypoint; }

  /** Street life reports the player hurting a civilian at (x, z): CorpSec patrols nearby respond.
   * Returns true when someone answered (the feed says so once per report). */
  reportCivilianAttack(x: number, z: number): boolean {
    const answered = this.combat.reportCrime(x, z) > 0;
    if (answered) this.post("CorpSec is responding", "danger");
    return answered;
  }
  /** The player's attack landed on or near a civilian at (x, z) (people.ts CityPopulation.assault):
   * reports the crime and returns the toast to show ("CorpSec has been alerted"), at most once a
   * minute and only when a patrol answered; otherwise null. */
  civilianAssault(x: number, z: number): string | null {
    if (!this.reportCivilianAttack(x, z) || this.clock - this.lastAlert < 60) return null;
    this.lastAlert = this.clock;
    return "CorpSec has been alerted";
  }
  /** The swing or shot the player started in the last update, once (then null). */
  takePlayerAttack(): PlayerAttack | null { const attack = this.attack; this.attack = null; return attack; }
  /** Where fighting is going on within `radius` of `near`, nearest first, at most 8 (positions only,
   * a reused list): enemies in a fight and, while the player is in combat, the player. Street life
   * (people.ts) scatters from these. Empty while the player is indoors. */
  threats(near: Point, radius = 80): readonly Point[] {
    const out = this.threatList;
    out.length = 0;
    const player = this.lastPlayer;
    if (!player || player.place) return out;
    this.combat.fightPositions(near, radius, out, 8);
    if (player.onFoot && this.combat.engaged && (player.x - near.x) ** 2 + (player.z - near.z) ** 2 <= radius * radius) {
      const d = (player.x - near.x) ** 2 + (player.z - near.z) ** 2;
      let i = 0;
      while (i < out.length && (out[i].x - near.x) ** 2 + (out[i].z - near.z) ** 2 <= d) i++;
      if (i < 8) { out.splice(i, 0, { x: player.x, z: player.z }); if (out.length > 8) out.pop(); }
    }
    return out;
  }

  // ---- hacking (src/rpg/hacking) ---------------------------------------------------------------

  /** The street hacking targets: ATMs and service doors (tests and tooling). */
  get hackingTargets(): readonly InteractableDefinition[] { return this.hackTargets; }
  /** The open breach screen, if any. */
  get hackView(): HackView | null { return this.hackOpen?.view ?? null; }
  /** The E prompt for a hack target: its label, or why it is shut right now (null: not a target). */
  private hackPrompt(object: InteractableDefinition): string | null {
    if (!object.hack) return null;
    const blocked = this.hackLedger.blocked({ id: object.id, kind: object.hack.kind });
    return blocked ? `${object.hack.kind === "atm" ? "ATM" : object.hack.kind === "door" ? "Service door" : "Terminal"}: ${blocked}` : object.label;
  }
  private openHack(target: InteractableDefinition, spec: HackSpec): void {
    const blocked = this.hackLedger.blocked({ id: target.id, kind: spec.kind });
    if (blocked) { this.post(blocked, "info"); return; }
    const attempt = ++this.hackAttempts;
    const seed = (hashId(target.id) ^ Math.imul(Math.floor(this.hackLedger.clock * 1000) + attempt, 0x9e3779b1)) >>> 0;
    const label = spec.kind === "atm" ? "Street ATM" : spec.kind === "door" ? (spec.tier === "hard" ? "Corp service terminal" : "Service door") : target.label;
    this.hackOpen = { target, spec, view: { attempt, target: target.id, label, kind: spec.kind, tier: spec.tier, seed, splice: this.character.count(SPLICE_DECK) > 0, result: null } };
  }
  /** The screen's puzzle ended: pay out, roll the back room, raise the alarm, lock the target. */
  private settleHack(attempt: number, report: HackReport): void {
    const open = this.hackOpen;
    if (!open || open.view.attempt !== attempt || open.view.result) return;
    const { target, spec } = open, c = this.character;
    const settled = this.hackLedger.settle({ id: target.id, kind: spec.kind, tier: spec.tier, district: spec.district ?? 4 }, report, this.rng());
    if (settled.outcome === "aborted") { this.hackOpen = null; this.post(settled.lines[0], "info"); return; }
    const lines = [...settled.lines];
    if (settled.credits > 0) { c.addCredits(settled.credits); this.post(`+ ${settled.credits} cr`, "loot"); }
    if (settled.loot) {
      const roll = this.loot.roll(settled.loot, this.rng);
      if (roll.credits) { c.addCredits(roll.credits); lines.push(`${roll.credits} cr in the strongbox.`); this.post(`+ ${roll.credits} cr`, "loot"); }
      const found = settled.shards ? [...roll.items, { item: "data-shard", count: settled.shards }] : roll.items;
      const left: { item: string; count: number }[] = [];
      for (const stack of found) {
        const taken = c.add(stack.item, stack.count), name = this.registry.get(stack.item)?.name ?? stack.item;
        if (taken > 0) { lines.push(`+ ${name}${taken > 1 ? ` x${taken}` : ""}`); this.post(`+ ${name}${taken > 1 ? ` x${taken}` : ""}`, "loot"); }
        if (taken < stack.count) left.push({ item: stack.item, count: stack.count - taken });
      }
      if (left.length) { this.worldLoot.drop(target.x, target.z, left, 0); lines.push("Pack full: the rest is on the pavement."); }
    }
    if (settled.outcome === "success" && spec.kind === "terminal") {
      const venue = target.id.startsWith(LOCK_PREFIX) && target.place ? this.venue(target.place) : null, room = venue ? lockedRoomSpec(venue) : null;
      if (room) { // Locked rooms: the breach opens the gate for the rest of the in-game day
        this.syncLockedGates();
        unlockGate(room, this.lockedLedger, this.gateHost ?? NO_GATES, this.lockedDay());
        this.post(`The ${room.room.toLowerCase()} shutter rolls up.`, "info");
      } else this.quests.interact(target.id);
    }
    if (settled.alarm) {
      const answered = this.combat.reportCrime(target.x, target.z) > 0;
      this.post(answered ? "Alarm tripped: CorpSec is responding" : "Alarm tripped", "danger");
      lines.push(answered ? "A CorpSec patrol is on its way." : "No patrol close enough to answer. This time.");
    }
    if (settled.outcome === "failed") setHackLook(target.id, "locked", settled.lock);
    else if (spec.kind === "atm") setHackLook(target.id, "paid", 10);
    else if (spec.kind === "door") setHackLook(target.id, "open", this.hackLedger.restockRemaining(target.id));
    this.hackOpen = { ...open, view: { ...open.view, result: { outcome: settled.outcome === "success" ? "success" : "failed", title: settled.title, lines, alarm: settled.alarm } } };
  }

  // ---- views -----------------------------------------------------------------------------------

  enemies(near: Point, radius = 140): EnemyView[] { return this.combat.enemies(near, radius); }
  effects(): readonly CombatEffect[] { return this.combat.effects(); }
  playerView(): PlayerCombatView { return this.combat.playerView(); }
  groundLoot(near: Point, radius = 120): GroundLootView[] { return this.worldLoot.views(near.x, near.z, radius); }
  interactables(place = ""): readonly InteractableDefinition[] {
    const quest = this.quests.interactables().filter(object => (object.place ?? "") === place);
    const venue = place.startsWith("bldg-") ? this.venue(place) : null; // Ground life: every ground floor has one thing to do
    const life = venue ? groundLifeInteractable(venue) : null;
    this.syncLockedGates();
    const locked = venue ? lockedRoomInteractables(venue, this.lockedLedger, this.lockedDay()) : [];
    return life || locked.length ? [...quest, ...(life ? [life] : []), ...locked] : quest;
  }

  /** Ground life: runs one use against this session's character and flags (rate limits live in the ground-life ledger, saved with the RPG save). */
  private applyGroundLife(object: InteractableDefinition): void {
    const venue = object.place ? this.venue(object.place) : null, spec = venue ? groundLifeSpec(venue) : null;
    if (!spec) return;
    const c = this.character, quests = this.quests;
    const host: GroundLifeHost = {
      day: Math.floor(quests.clock / DAY_SECONDS),
      get credits() { return c.credits; },
      spend: amount => c.spend(amount),
      earn: amount => c.addCredits(amount),
      give: (item, count) => c.add(item, count),
      itemName: item => this.registry.get(item)?.name ?? item,
      rest: fraction => this.combat.restPlayer(fraction),
      xp: amount => { c.addXp(amount); },
      remove: (item, count) => c.remove(item, count),
      ledger: this.groundLedger,
      say: (text, tone) => this.post(text, tone),
    };
    applyGroundLife(spec, host);
    this.dirty = true;
  }
  /** Locked rooms: E on the stash (credits and an item, once per building per day, capped across the city). */
  private applyStash(object: InteractableDefinition): void {
    const venue = object.place ? this.venue(object.place) : null, spec = venue ? lockedRoomSpec(venue) : null;
    if (!spec) return;
    const c = this.character;
    const host: StashHost = {
      day: this.lockedDay(),
      earn: amount => c.addCredits(amount),
      give: (item, count) => c.add(item, count),
      itemName: item => this.registry.get(item)?.name ?? item,
      ledger: this.lockedLedger,
      say: (text, tone) => this.post(text, tone),
    };
    lootStash(spec, host);
    this.dirty = true;
  }
  weapon(): ItemDefinition | null {
    const view = this.combat.playerView();
    return view.weaponItem ? this.registry.get(view.weaponItem) ?? null : null;
  }
  get dead(): boolean { return this.combat.playerDead; }
  get inCombat(): boolean { return this.combat.playerView().inCombat; }

  snapshot(): RpgSnapshot {
    const items: Record<string, ItemDefinition> = {};
    const add = (id: string) => { const def = this.registry.get(id); if (def) items[id] = def; };
    for (const stack of this.character.state.inventory) add(stack.item);
    for (const id of Object.values(this.character.state.equipped)) if (id) add(id);
    let vendor: RpgSnapshot["vendor"] = null;
    if (this.vendorOpen) {
      const stock = this.vendors.stock(this.vendorOpen);
      for (const offer of stock) add(offer.item);
      vendor = { npc: this.vendorOpen, name: this.npcNames.get(this.vendorOpen) ?? this.vendorOpen, stock: stock.map(o => ({ item: o.item, price: o.price })), sellRate: 0.4 };
    }
    const boss = this.combat.boss();
    return { character: this.character.sheet(), combat: this.combat.playerView(), items, vendor, prompt: this.prompt, boss, feed: [...this.feed], hack: this.hackOpen?.view ?? null };
  }

  action(action: RpgUiAction): void {
    const c = this.character;
    switch (action.kind) {
      case "trackQuest": this.quests.track(action.quest); break;
      case "equip": c.equip(action.item); break;
      case "unequip": c.unequip(action.slot); break;
      case "use": c.use(action.item); break;
      case "assignQuick": c.assignQuick(action.item, action.slot); break;
      case "drop": {
        if (this.lastPlayer?.place) { this.post("Step outside to drop items", "info"); break; }
        const count = Math.max(1, Math.floor(action.count));
        if (this.lastPlayer && c.remove(action.item, count)) this.worldLoot.drop(this.lastPlayer.x, this.lastPlayer.z, [{ item: action.item, count }], 0);
        break;
      }
      case "buy": if (this.vendorOpen && !this.vendors.buy(this.vendorOpen, action.item, c)) this.post("Can't afford that", "danger"); break;
      case "sell": { const gained = this.vendors.sell(action.item, action.count, c); if (gained) this.post(`+ ${gained} cr`, "loot"); break; }
      case "closeVendor": this.vendorOpen = null; break;
      case "respawn": this.combat.respawnPlayer(); break;
      case "hackResult": this.settleHack(action.attempt, action.report); break; // Hacking
      case "closeHack": if (this.hackOpen?.view.result) this.hackOpen = null; break; // Hacking: a running breach ends through hackResult
    }
    this.dirty = true;
  }
  get vendorScreenOpen(): boolean { return this.vendorOpen !== null; }

  // ---- saves -----------------------------------------------------------------------------------

  save(position?: { x: number; z: number; yaw: number }): void {
    this.saveTimer = 0; this.dirty = false;
    if (!this.storage) return;
    const venue = !position && this.lastPlayer?.place ? this.venue(this.lastPlayer.place) : null;
    const pos = position ?? venue?.entrance ?? (this.lastPlayer ? { x: this.lastPlayer.x, z: this.lastPlayer.z, yaw: this.lastPlayer.yaw } : null);
    const game: SaveGame = { version: 1, savedAt: Date.now(), character: this.character.serialize(), quests: this.quests.serialize(), flags: { ...this.quests.flags.all() }, discovered: [...this.discovered], encounters: this.combat.serialize(), position: pos };
    if (parseSave(game)) writeSave(this.storage, game);
    try { this.storage.setItem(HACK_SAVE_KEY, this.hackLedger.serialize()); } catch { /* Hacking: storage full or blocked */ }
    try { this.storage.setItem(GROUND_LIFE_SAVE_KEY, this.groundLedger.serialize()); } catch { /* Ground life: storage full or blocked */ }
    try { this.storage.setItem(LOCKED_SAVE_KEY, this.lockedLedger.serialize()); } catch { /* Locked rooms: storage full or blocked */ }
  }
  /** Wipes the save (Settings → New game); the engine reloads afterwards. */
  reset(): void {
    if (!this.storage) return;
    clearSave(this.storage);
    try { this.storage.removeItem(HACK_SAVE_KEY); } catch { /* Hacking */ }
    try { this.storage.removeItem(GROUND_LIFE_SAVE_KEY); } catch { /* Ground life */ }
    try { this.storage.removeItem(LOCKED_SAVE_KEY); } catch { /* Locked rooms */ }
  }
}

/** Locked rooms: stands in for the engine's interiors before they are attached (ledger only). */
const NO_GATES: GateHost = { openGates() {}, closeAllGates() {} };

/** FNV-1a of an id (hacking seeds). */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
