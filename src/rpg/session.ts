// The RPG session: owns every rpg/ system, wires them through the event bus and is the only thing the
// engine talks to. Pure (no DOM, no textmode): the engine passes frames in, reads views out, and
// supplies a Storage-like object for saves.

import { NPCS, type NpcDefinition } from "../city/npcs.ts";
import type { CityWorld } from "../city/world.ts";
import { interiorPlaces, type InteriorPlace } from "../city/interiors.ts";
import type { DialogueResult, NpcDialogue, NpcMarker, QuestSnapshot } from "../city/quests.ts";
import { EventBus } from "./events.ts";
import { Character, ItemRegistry, ITEMS, LootSystem, Vendors, WorldLoot, loadSave, parseSave, seededRng, writeSave, clearSave, type SaveGame } from "./items/index.ts";
import { CombatWorld, COMBAT_TEST_ARCHETYPES, COMBAT_TEST_ENCOUNTERS, COMBAT_TEST_ITEMS } from "./combat/index.ts";
import { LEGACY_PACK, QuestEngine } from "./quests/index.ts";
import type { ContentPack, EnemyArchetype, EnemyView, CombatEffect, FactionId, GroundLootView, InteractableDefinition, ItemDefinition, PlayerCombatView, Point, RpgFrame, RpgSnapshot, RpgUiAction } from "./types.ts";

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
  private readonly venues: ReadonlyMap<string, InteriorPlace>;
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
  discovered: string[] = [];

  constructor(opts: RpgSessionOptions) {
    const packs = [LEGACY_PACK, ...(opts.packs ?? [])];
    this.storage = opts.storage ?? null;
    this.venues = new Map(interiorPlaces(opts.world).map(place => [place.id, place]));
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
      for (const [key, value] of Object.entries(save.flags)) if (this.quests.flags.get(key) === undefined) this.quests.setFlag(key, value);
      this.combat.load(save.encounters);
      this.discovered = [...save.discovered];
      this.savedPosition = save.position;
    }
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
    const input = player.onFoot && !this.vendorOpen ? frame.input : { ...frame.input, attackPressed: false, attackHeld: false, attackReleased: false, altHeld: false, dodgePressed: false, reloadPressed: false, quickUse: null, selectSlot: null, interactPressed: false };
    const { move } = this.combat.update({ ...frame, player, input }, this.character);
    this.quests.update(frame.dt, player);
    // Pickups and world objects: E takes the nearest pile, else uses the nearest object.
    const pile = this.canInteract(player) && !player.place ? this.worldLoot.nearest(player.x, player.z) : null;
    const object = !pile ? this.nearestInteractable(player) : null;
    this.prompt = pile ? `Pick up ${pile.name}${pile.count > 1 ? ` x${pile.count}` : ""}${pile.rarity !== "common" ? ` [${pile.rarity}]` : ""}` : object ? object.label : null;
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

  private canInteract(player: RpgFrame["player"]): boolean {
    return !this.dead && !this.vendorOpen && player.mode === "walk" && (player.place ? this.venues.has(player.place) : player.onFoot);
  }

  private nearestInteractable(player: RpgFrame["player"]): InteractableDefinition | null {
    if (!this.canInteract(player)) return null;
    let best: InteractableDefinition | null = null, bestDistance = INTERACT_RANGE;
    for (const item of this.interactables(player.place)) {
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
    return object ? this.quests.interact(object.id) : null;
  }
  /** True when E has something RPG-side to do here (a pile or an object). */
  hasInteraction(): boolean {
    const player = this.lastPlayer;
    return !!player && this.canInteract(player) && (!!this.nearestInteractable(player) || (!player.place && !!this.worldLoot.nearest(player.x, player.z)));
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

  // ---- views -----------------------------------------------------------------------------------

  enemies(near: Point, radius = 140): EnemyView[] { return this.combat.enemies(near, radius); }
  effects(): readonly CombatEffect[] { return this.combat.effects(); }
  playerView(): PlayerCombatView { return this.combat.playerView(); }
  groundLoot(near: Point, radius = 120): GroundLootView[] { return this.worldLoot.views(near.x, near.z, radius); }
  interactables(place = ""): readonly InteractableDefinition[] { return this.quests.interactables().filter(object => (object.place ?? "") === place); }
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
    return { character: this.character.sheet(), combat: this.combat.playerView(), items, vendor, prompt: this.prompt, boss, feed: [...this.feed] };
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
    }
    this.dirty = true;
  }
  get vendorScreenOpen(): boolean { return this.vendorOpen !== null; }

  // ---- saves -----------------------------------------------------------------------------------

  save(position?: { x: number; z: number; yaw: number }): void {
    this.saveTimer = 0; this.dirty = false;
    if (!this.storage) return;
    const venue = !position && this.lastPlayer?.place ? this.venues.get(this.lastPlayer.place) : null;
    const pos = position ?? venue?.entrance ?? (this.lastPlayer ? { x: this.lastPlayer.x, z: this.lastPlayer.z, yaw: this.lastPlayer.yaw } : null);
    const game: SaveGame = { version: 1, savedAt: Date.now(), character: this.character.serialize(), quests: this.quests.serialize(), flags: { ...this.quests.flags.all() }, discovered: [...this.discovered], encounters: this.combat.serialize(), position: pos };
    if (parseSave(game)) writeSave(this.storage, game);
  }
  /** Wipes the save (Settings → New game); the engine reloads afterwards. */
  reset(): void { if (this.storage) clearSave(this.storage); }
}
