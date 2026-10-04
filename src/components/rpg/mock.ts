// DEV ONLY: a stand-in RPG layer for building and screenshotting the React screens before the engine
// wires the real RpgSession. Loaded with a dynamic import from use-rpg-ui.ts only when
// NODE_ENV === "development" and the URL has ?rpgmock=<scene>, so it never ships in a production
// bundle path that runs. Scenes: 1 (inventory), vendor, dead, prompt; "force" = 1 even when the engine has real data. It uses the real item
// database and Character / Vendors classes, so equip / use / buy / sell behave like the game.
// window.__rpgMock exposes the same controls to scripts (scratchpad CDP screenshots).

import { EventBus } from "../../rpg/events.ts";
import { Character, ItemRegistry, SELL_RATE, Vendors } from "../../rpg/items/index.ts";
import type { CharacterState, PlayerCombatView, RpgSnapshot, RpgUiAction } from "../../rpg/types.ts";

export interface RpgMock {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => RpgSnapshot;
  act: (action: RpgUiAction) => void;
  openVendor: () => void;
  die: () => void;
  prompt: (text: string | null) => void;
  feed: (text: string, tone?: RpgSnapshot["feed"][number]["tone"]) => void;
}

const VENDOR = { npc: "mock-fixer", name: "Mara Voss, fixer", markup: 1.25, stock: ["medkit", "stim", "coolant-can", "shield-cell", "ammo-pistol", "ammo-shell", "kevlar-weave", "forward-slash", "colon-scatter", "brace-burst", "halo-rig"] };

const STATE: CharacterState = {
  credits: 1840, xp: 1620, level: 7,
  inventory: [
    { item: "backslash", count: 1 }, { item: "backtick-shiv", count: 1 }, { item: "hash-hammer", count: 1 }, { item: "caret-45", count: 1 },
    { item: "quote-magnum", count: 1 }, { item: "asterisk-smg", count: 1 }, { item: "kernel-panic", count: 1 }, { item: "ammo-pistol", count: 86 },
    { item: "ammo-shell", count: 18 }, { item: "mesh-hoodie", count: 1 }, { item: "firewall-vest", count: 1 }, { item: "riot-helm", count: 1 },
    { item: "daemon-crown", count: 1 }, { item: "stim", count: 4 }, { item: "medkit", count: 2 }, { item: "synth-ration", count: 3 },
    { item: "shield-cell", count: 1 }, { item: "copper-scrap", count: 12 }, { item: "data-shard", count: 3 }, { item: "old-world-watch", count: 1 },
    { item: "encrypted-ledger", count: 1 },
  ],
  equipped: { melee: "backslash", sidearm: "caret-45", primary: "asterisk-smg", body: "firewall-vest", head: "riot-helm", quick1: "stim", quick2: "medkit" },
  loaded: { "caret-45": 6, "asterisk-smg": 22 },
  reputation: { razorbacks: 34, "chrome-saints": -62, corpsec: -18, ghosts: 8 },
};

/** Builds the mock for a scene name from the URL. */
export function createRpgMock(scene: string): RpgMock {
  const registry = new ItemRegistry();
  const bus = new EventBus();
  const character = new Character(registry, bus, STATE);
  const vendors = new Vendors(registry);
  vendors.register([VENDOR]);
  const listeners = new Set<() => void>();
  let vendorOpen = scene === "vendor";
  let dead = scene === "dead";
  let prompt: string | null = scene === "prompt" || scene === "1" || scene === "force" ? "E  Pick up Backslash [rare]" : null;
  let feed: RpgSnapshot["feed"][number][] = [];
  let feedId = 0;
  let snapshot: RpgSnapshot;

  const push = (text: string, tone: RpgSnapshot["feed"][number]["tone"] = "info") => { feed = [...feed, { id: ++feedId, text, tone }].slice(-8); };
  bus.on("message", (event) => push(event.text, event.tone ?? "info"));

  const combat = (): PlayerCombatView => ({
    health: dead ? 0 : 118, maxHealth: character.maxHealth, stamina: 74, maxStamina: character.maxStamina,
    weapon: "melee", weaponItem: character.state.equipped.melee ?? null, weaponClass: "blade", ammo: null,
    action: dead ? "dead" : "idle", actionProgress: 0, hitConfirmAge: Infinity, hurtAge: Infinity, hurtFrom: null, inCombat: false, dead,
  });
  const build = (): RpgSnapshot => ({
    character: character.sheet(),
    combat: combat(),
    items: registry.record(),
    vendor: vendorOpen ? { npc: VENDOR.npc, name: VENDOR.name, stock: vendors.stock(VENDOR.npc).map((offer) => ({ item: offer.item, price: offer.price })), sellRate: SELL_RATE } : null,
    prompt,
    boss: null,
    feed,
  });
  const emit = () => { snapshot = build(); for (const listener of listeners) listener(); };
  snapshot = build();

  const nameOf = (id: string) => registry.get(id)?.name ?? id;
  const mock: RpgMock = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    act(action) {
      switch (action.kind) {
        case "equip": character.equip(action.item); break;
        case "unequip": character.unequip(action.slot); break;
        case "use": if (character.use(action.item)) push(`Used ${nameOf(action.item)}`, "info"); break;
        case "drop": if (character.remove(action.item, action.count)) push(`Dropped ${nameOf(action.item)}${action.count > 1 ? ` x${action.count}` : ""}`, "info"); break;
        case "assignQuick": character.assignQuick(action.item, action.slot); break;
        case "buy": vendors.buy(VENDOR.npc, action.item, character); break;
        case "sell": vendors.sell(action.item, action.count, character); break;
        case "closeVendor": vendorOpen = false; break;
        case "respawn": dead = false; push("You wake up in a back-alley clinic. Patched, billed, alive.", "info"); break;
      }
      emit();
    },
    openVendor() { vendorOpen = true; emit(); },
    die() { dead = true; emit(); },
    prompt(text) { prompt = text; emit(); },
    feed(text, tone) { push(text, tone); emit(); },
  };
  if (scene === "1" || scene === "force") {
    push("Picked up Hash Hammer", "loot");
    push("Contract updated: The Ledger -- bring it to Mara", "quest");
    snapshot = build();
  }
  (window as unknown as { __rpgMock?: RpgMock }).__rpgMock = mock;
  return mock;
}
