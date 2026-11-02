// Ground life: one small, themed thing to do in every building's ground floor (`bldg-<id>`).
// Pure (no DOM, no textmode). `groundLifeSpec(place)` is deterministic per building: it picks a
// fixture from the ground-floor plan that suits the floor's kind and finds reachable free floor
// beside it for the use point. `applyGroundLife` resolves one use against a host (the RPG session).
//
// Rate limits (kept in a small GroundLifeLedger persisted beside the RPG save):
//  - freebies (finds, crops, mail) once per building per in-game day (DAY_SECONDS of play time);
//  - a global daily ceiling on credits found and items found, so 2190 buildings are never a farm;
//  - things you pay for (rest, trades, arcade credits) are sinks and stay open.

import { groundFloorPlan } from "../city/building-interiors.ts";
import { interiorWorld, isGroundFloorKind, type InteriorFixture, type InteriorPlace } from "../city/interiors.ts";
import { floorTitle, liftLanding, upperFloorPlan, upperOpenAir, upperVariant, type UpperVariant } from "../city/upper-floors.ts";
import { LANDMARKS, PLAYER_RADIUS } from "../city/world.ts";
import type { InteractableDefinition } from "./types.ts";

/** One in-game day of ground-life limits, in seconds of play time. */
export const DAY_SECONDS = 1200;
/** Credits that can be found (wins, mail) across every ground floor in one day. */
export const DAILY_CREDIT_CAP = 40;
/** Items that can be found for free across every ground floor in one day. */
export const DAILY_ITEM_CAP = 5;
export const GROUND_LIFE_PREFIX = "gl:";

type Tone = "info" | "quest" | "loot" | "danger";
type Kind = InteriorPlace["kind"];

export type GroundLifeAction =
  | "arcade" | "lost-and-found" | "pawn" | "haggle" | "jack-in" | "candle" | "rent-pod"
  | "crop" | "workbench" | "fridge" | "directory" | "mailboxes" | "supplies"
  // Upper floors (bldg-<n>-f<k>)
  | "order-drink" | "look-out" | "terminal" | "knock" | "roof-garden" | "gauges";

export interface GroundLifeSpec {
  readonly id: string;
  readonly placeId: string;
  readonly building: number;
  /** Upper floors only: the floor number (>= 2). */
  readonly floor?: number;
  /** Rate-limit key in the ledger: the building id for a ground floor, UPPER_KEY_BASE + building * 100 + floor upstairs. */
  readonly key: number;
  /** "Ground floor", "Floor 12" or "Roof". */
  readonly floorName: string;
  /** True when the floor is open to the sky. */
  readonly openAir: boolean;
  readonly action: GroundLifeAction;
  readonly label: string;
  readonly glyph: string;
  /** The fixture the use point stands beside (room space), or null on a plan with no furniture. */
  readonly fixture: Pick<InteriorFixture, "kind" | "x" | "z" | "width" | "depth"> | null;
  /** Room space. */
  readonly local: { readonly x: number; readonly z: number };
  /** World space (where the player stands to use it). */
  readonly x: number;
  readonly z: number;
}

/** What the session offers a ground-life use. */
export interface GroundLifeHost {
  /** In-game day index (play time / DAY_SECONDS). */
  readonly day: number;
  readonly credits: number;
  spend(amount: number): boolean;
  earn(amount: number): void;
  /** Adds items; returns how many fit. */
  give(item: string, count: number): number;
  itemName(item: string): string;
  /** Grants experience (optional: hosts without a character skip it). */
  xp?(amount: number): void;
  /** Heals a fraction of max health and refills stamina. */
  rest(healthFraction: number): void;
  /** Removes items (undoing a give that only partly fit). */
  remove(item: string, count: number): boolean;
  /** The persisted ground-life ledger. */
  readonly ledger: GroundLifeLedger;
  say(text: string, tone: Tone): void;
}

// ---- Which fixture, which verb ---------------------------------------------------------------------

interface KindSpec { action: GroundLifeAction; label: string; glyph: string; fixtures: readonly InteriorFixture["kind"][] }
const KINDS: Record<string, KindSpec> = {
  "arcade": { action: "arcade", label: "Play a credit (1 cr)", glyph: "$", fixtures: ["machine", "vending", "cabinet"] },
  "laundromat": { action: "lost-and-found", label: "Check the lost-and-found", glyph: "?", fixtures: ["washer", "crate", "cabinet"] },
  "pawnshop": { action: "pawn", label: "Browse the case", glyph: "?", fixtures: ["case", "counter", "shelf"] },
  "market-hall": { action: "haggle", label: "Haggle at a stall", glyph: "$", fixtures: ["stall", "crate", "counter"] },
  "server-hall": { action: "jack-in", label: "Jack into the console", glyph: "#", fixtures: ["rack", "desk", "machine"] },
  "shrine": { action: "candle", label: "Light a candle", glyph: "*", fixtures: ["altar", "cushion"] },
  "capsule-hotel": { action: "rent-pod", label: "Rent a pod (15 cr)", glyph: "Z", fixtures: ["pod", "locker"] },
  "hydroponics": { action: "crop", label: "Pick a ripe crop", glyph: "+", fixtures: ["growrack", "tank", "planter"] },
  "garage": { action: "workbench", label: "Use the workbench", glyph: "%", fixtures: ["car", "rack", "crate", "lathe"] },
  "machine-shop": { action: "workbench", label: "Use the workbench", glyph: "%", fixtures: ["lathe", "rack", "crate"] },
  "apartment": { action: "fridge", label: "Check the fridge", glyph: "?", fixtures: ["kitchenette", "cabinet", "couch"] },
  "corp-lobby": { action: "directory", label: "Read the directory", glyph: "i", fixtures: ["desk", "sculpture", "turnstile", "lift"] },
  "lobby": { action: "mailboxes", label: "Check the mailboxes", glyph: "@", fixtures: ["mailbox", "desk", "lift"] },
  "chandlery": { action: "supplies", label: "Buy supplies", glyph: "$", fixtures: ["crate", "counter", "shelf", "rack"] },
};

/** Upper-floor verbs, one per variant (plant decks pick a garden or a gauge board per building). */
const UPPER_KINDS: Record<UpperVariant, KindSpec> = {
  "sky-bar": { action: "order-drink", label: "Order a drink (12 cr)", glyph: "$", fixtures: ["counter", "stool", "table"] },
  "penthouse": { action: "look-out", label: "Look out over the city", glyph: "o", fixtures: ["couch", "sculpture", "planter", "table"] },
  "offices": { action: "terminal", label: "Check an unlocked terminal", glyph: "#", fixtures: ["desk", "machine", "rack"] },
  "pods": { action: "rent-pod", label: "Rent a pod (15 cr)", glyph: "Z", fixtures: ["pod", "locker"] },
  "servers": { action: "jack-in", label: "Jack into the console", glyph: "#", fixtures: ["rack", "desk", "machine"] },
  "apartments": { action: "knock", label: "Knock on a door", glyph: "?", fixtures: ["kitchenette", "shelf", "couch"] },
  "plant-deck": { action: "roof-garden", label: "Check the rooftop garden", glyph: "+", fixtures: ["tank", "planter", "machine", "crate"] },
};
const GAUGE_KIND: KindSpec = { action: "gauges", label: "Read the pressure gauges", glyph: "%", fixtures: ["machine", "tank", "locker", "crate"] };
/** Ledger keys of upper floors sit above every ground-floor key (building ids). */
export const UPPER_KEY_BASE = 1_000_000;
/** Keeps an upper floor's use point this far (m) from the lift's landing. */
const LIFT_CLEARANCE = 1.5;

// ---- Deterministic helpers ---------------------------------------------------------------------------

function hash(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h ^= part | 0; h = Math.imul(h, 0x01000193);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  }
  return h >>> 0;
}
const unit = (seed: number): number => seed / 4294967296;
function choose<T>(list: readonly T[], seed: number): T { return list[seed % list.length]; }

// ---- Placement ----------------------------------------------------------------------------------------

/** Use points keep this far (m) from any resident spot (staff stand behind counters). */
const STAFF_CLEARANCE = 0.8;
const specCache = new WeakMap<InteriorPlace, GroundLifeSpec | null>();

/** A floor's thing to do (ground floor or upper floor), or null for other places. Cached per place. */
export function groundLifeSpec(place: InteriorPlace): GroundLifeSpec | null {
  if (specCache.has(place)) return specCache.get(place) ?? null;
  const spec = buildSpec(place);
  specCache.set(place, spec);
  return spec;
}

/** The interactable the RPG layer exposes for a ground floor. */
export function groundLifeInteractable(place: InteriorPlace): InteractableDefinition | null {
  if (interactableCache.has(place)) return interactableCache.get(place) ?? null;
  const spec = groundLifeSpec(place);
  const item = spec ? { id: spec.id, label: spec.label, place: place.id, glyph: spec.glyph, x: spec.x, z: spec.z, y: 2.2 } : null;
  interactableCache.set(place, item);
  return item;
}
const interactableCache = new WeakMap<InteriorPlace, InteractableDefinition | null>();

function buildSpec(place: InteriorPlace): GroundLifeSpec | null {
  if (!isGroundFloorKind(place.kind)) return null;
  const variant = place.floor ? upperVariant(place) : null;
  if (place.floor && !variant) return null;
  const kind = variant ? (variant === "plant-deck" && hash(place.building, place.floor ?? 0, 0x6a1) % 2 ? GAUGE_KIND : UPPER_KINDS[variant]) : KINDS[place.kind as Kind];
  if (!kind) return null;
  const plan = variant ? upperFloorPlan(place) : groundFloorPlan(place);
  const landings = variant ? plan.fixtures.filter(f => f.kind === "lift").map(liftLanding) : [];
  const hw = place.width / 2, hd = place.depth / 2, r = PLAYER_RADIUS, margin = 0.08;
  const furniture = plan.fixtures.filter(f => f.kind !== "wall");
  const open = (x: number, z: number) => Math.abs(x) <= hw - r - margin && Math.abs(z) <= hd - r - margin
    && !plan.fixtures.some(f => Math.abs(x - f.x) < f.width / 2 + r + margin && Math.abs(z - f.z) < f.depth / 2 + r + margin);
  const reach = reachable(hw, hd, open);
  // Ground floors keep the exit zone free; upper floors keep the lift's landing free (lift doors open there).
  const clear = (x: number, z: number) => open(x, z) && reach(x, z)
    && (variant ? landings.every(l => Math.hypot(x - l.x, z - l.z) >= LIFT_CLEARANCE) : !(Math.abs(x) < 2.4 && z > hd - 4));
  // Staff stand behind counters: keep the use point off their walkway (customer side only) when possible.
  const staffed = (x: number, z: number) => plan.residents.some(p => Math.hypot(x - p.x, z - p.z) < STAFF_CLEARANCE);

  const seed = (place.floor ? hash(place.building, place.floor, 0x91f3) : hash(place.building, 0x91f3));
  // Fixtures in preference order; within a preference, a seeded start so buildings differ.
  const ordered: InteriorFixture[] = [];
  for (const wanted of kind.fixtures) {
    const matches = furniture.filter(f => f.kind === wanted);
    if (matches.length) { const start = seed % matches.length; ordered.push(...matches.slice(start), ...matches.slice(0, start)); }
  }
  for (const f of furniture) if (!ordered.includes(f)) ordered.push(f);

  const gap = r + margin + 0.12;
  const pointsFor = (f: InteriorFixture): { x: number; z: number }[] => {
    const candidates: { x: number; z: number }[] = [];
    for (const dx of [0, -f.width / 3, f.width / 3]) {
      candidates.push({ x: f.x + dx, z: f.z + f.depth / 2 + gap }, { x: f.x + dx, z: f.z - f.depth / 2 - gap });
    }
    for (const dz of [0, -f.depth / 3, f.depth / 3]) {
      candidates.push({ x: f.x + f.width / 2 + gap, z: f.z + dz }, { x: f.x - f.width / 2 - gap, z: f.z + dz });
    }
    // Nearest the middle of the floor first: it reads as "the aisle side" of the fixture.
    return candidates.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  };
  for (const strict of [true, false]) {
    for (const f of ordered) {
      const spot = pointsFor(f).find(c => clear(c.x, c.z) && (!strict || !staffed(c.x, c.z)));
      if (spot) return finish(place, kind, f, spot);
    }
  }
  // No usable furniture: the first free, reachable lattice point (back of the room first).
  for (const strict of [true, false]) {
    for (let z = -hd + 1; z < hd - 1; z += 0.5) for (let x = -hw + 1; x < hw - 1; x += 0.5) if (clear(x, z) && (!strict || !staffed(x, z))) return finish(place, kind, null, { x, z });
  }
  return null;
}

function finish(place: InteriorPlace, kind: KindSpec, fixture: InteriorFixture | null, spot: { x: number; z: number }): GroundLifeSpec {
  const world = interiorWorld(place, spot.x, spot.z);
  return {
    id: `${GROUND_LIFE_PREFIX}${place.id}`, placeId: place.id, building: place.building,
    ...(place.floor ? { floor: place.floor } : {}), key: place.floor ? UPPER_KEY_BASE + place.building * 100 + place.floor : place.building,
    floorName: floorTitle(place), openAir: place.floor ? upperOpenAir(place) : false, action: kind.action, label: kind.label, glyph: kind.glyph,
    fixture: fixture ? { kind: fixture.kind, x: fixture.x, z: fixture.z, width: fixture.width, depth: fixture.depth } : null,
    local: { x: spot.x, z: spot.z }, x: world.x, z: world.z,
  };
}

/** Flood fill on a 0.25 m grid from the door-side spawn (0, depth/2 - 2.2); the same box test the walk uses. */
function reachable(hw: number, hd: number, open: (x: number, z: number) => boolean): (x: number, z: number) => boolean {
  const cell = 0.25, nx = Math.max(1, Math.floor(hw * 2 / cell)), nz = Math.max(1, Math.floor(hd * 2 / cell));
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) free[j * nx + i] = open(-hw + (i + 0.5) * cell, -hd + (j + 0.5) * cell) ? 1 : 0;
  const seen = new Uint8Array(nx * nz);
  const index = (x: number, z: number) => {
    const i = Math.floor((x + hw) / cell), j = Math.floor((z + hd) / cell);
    return i >= 0 && i < nx && j >= 0 && j < nz ? j * nx + i : -1;
  };
  // The spawn may sit inside the exit-zone margin: start from the nearest free cell around it.
  let start = -1;
  for (let ring = 0; ring < 12 && start < 0; ring++) {
    for (let dz = -ring; dz <= ring && start < 0; dz++) for (let dx = -ring; dx <= ring && start < 0; dx++) {
      const n = index(dx * cell, hd - 2.2 + dz * cell);
      if (n >= 0 && free[n]) start = n;
    }
  }
  if (start < 0) return () => false;
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack.pop() as number, i = c % nx, j = (c - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, n = b * nx + a;
      if (a >= 0 && a < nx && b >= 0 && b < nz && free[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
    }
  }
  return (x, z) => { const n = index(x, z); return n >= 0 && seen[n] === 1; };
}

// ---- Rate limiting ---------------------------------------------------------------------------------------

/** Where the ledger is persisted (its own small key, beside the RPG save). */
export const GROUND_LIFE_SAVE_KEY = "nightfall.groundlife.v1";

interface LedgerData { version: 1; day: number; credits: number; items: number; uses: number; taken: number[] }
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

/** Ground-life state: today's finds and which buildings were used today. `taken` clears on day rollover. */
export class GroundLifeLedger {
  day = 0;
  credits = 0;
  items = 0;
  uses = 0;
  private taken = new Set<number>();

  static parse(text: string | null): GroundLifeLedger {
    const ledger = new GroundLifeLedger();
    if (!text) return ledger;
    try {
      const data = JSON.parse(text) as Partial<LedgerData> | null;
      if (!data || data.version !== 1) return ledger;
      ledger.day = count(data.day); ledger.credits = count(data.credits); ledger.items = count(data.items); ledger.uses = count(data.uses);
      if (Array.isArray(data.taken)) for (const building of data.taken) if (typeof building === "number" && Number.isFinite(building)) ledger.taken.add(building);
    } catch { /* a broken ledger starts fresh */ }
    return ledger;
  }
  serialize(): string {
    const data: LedgerData = { version: 1, day: this.day, credits: this.credits, items: this.items, uses: this.uses, taken: [...this.taken].sort((a, b) => a - b) };
    return JSON.stringify(data);
  }
  /** Rolls the daily ledger over when the in-game day has changed. */
  rollDay(day: number): void {
    if (this.day === day) return;
    this.day = day; this.credits = 0; this.items = 0; this.taken.clear();
  }
  isTaken(building: number): boolean { return this.taken.has(building); }
  take(building: number): void { this.taken.add(building); }
  get takenCount(): number { return this.taken.size; }
}

/** Credits still findable today. */
export function creditsLeftToday(host: GroundLifeHost): number {
  host.ledger.rollDay(host.day);
  return Math.max(0, DAILY_CREDIT_CAP - host.ledger.credits);
}
export function itemsLeftToday(host: GroundLifeHost): number {
  host.ledger.rollDay(host.day);
  return Math.max(0, DAILY_ITEM_CAP - host.ledger.items);
}
/** True when this building's freebie was already taken today. */
export function freebieTaken(host: GroundLifeHost, building: number): boolean { host.ledger.rollDay(host.day); return host.ledger.isTaken(building); }

/** Pays out found credits within the daily ceiling; returns what was actually paid. */
function findCredits(host: GroundLifeHost, amount: number): number {
  const paid = Math.min(amount, creditsLeftToday(host));
  if (paid <= 0) return 0;
  host.earn(paid);
  host.ledger.credits += paid;
  return paid;
}
/** "ok": given; "cap": the day's item cap is spent; "full": the pack could not take it. */
function findItem(host: GroundLifeHost, item: string, qty = 1): "ok" | "cap" | "full" {
  if (itemsLeftToday(host) <= 0) return "cap";
  const taken = host.give(item, qty);
  if (taken <= 0) return "full";
  host.ledger.items += 1;
  host.say(`+ ${host.itemName(item)}${taken > 1 ? ` x${taken}` : ""}`, "loot");
  return "ok";
}

// ---- Content ----------------------------------------------------------------------------------------------

const RUMOURS: readonly string[] = [
  "Someone has pinned a note: the last train on the rim line does not stop where it says.",
  "A scrap of paper: 'Brakka's crew pays in ammo, not credits. Count it twice.'",
  "Scrawled on the wall: the rain stops at midnight in the Glasshouse district. Nobody knows why.",
  "A tenant's flyer: lost cat, answers to its name, but only on the monorail.",
  "Overheard: the harbour lights are on a timer now. The timer is wrong on purpose.",
  "A sticker: 'THE STATIC IS NOT A CLUB'. Underneath, in pen: 'it is a club'.",
  "Someone wrote the Splice deck's price on a napkin and then crossed out the zeroes.",
  "A faded poster: Night of Lanterns, all welcome. Bring your own light.",
];
const DIRECTORY: readonly string[] = [
  "Floor 1: Reception. Floor 2: Compliance. Floor 3: Compliance, again. Floor 4: you were never here.",
  "Tenants: Halcyon Logistics, Meridian Audit, a firm whose name is a single smudge.",
  "'Please do not use the lifts during a fire, a flood, or a quarterly review.'",
  "Suite 9 is listed as 'Vacant'. The light under its door disagrees.",
  "The directory has been updated. The building has not.",
];
const WIN_LINES: readonly string[] = ["The cabinet coughs up tokens.", "HIGH SCORE. The cabinet plays a tune for no one.", "Three in a row. The machine looks as surprised as you."];
const LOSE_LINES: readonly string[] = ["GAME OVER. Insert coin to feel something.", "You lose by one pixel. It was always one pixel.", "The cabinet keeps your credit and your initials."];
const CANDLE_LINES: readonly string[] = ["The flame leans toward the door, then away. You take it as a yes.", "Wax, smoke and a quiet that does not ask for anything.", "You light one for whoever left the others burning."];

interface Pool { item: string; line: string }
const LOST_AND_FOUND: readonly Pool[] = [
  { item: "copper-scrap", line: "A sock, a coin, and a hunk of copper nobody claimed." },
  { item: "burnt-chip", line: "Under a dryer: a chip that has seen some heat." },
  { item: "river-glass", line: "A pocket of river glass. Somebody's lucky charm." },
  { item: "afterlight-token", line: "A token, stuck to a sheet. Finders keepers." },
  { item: "neon-tube", line: "A spare neon tube, labelled 'DO NOT STEAL'. It is now yours." },
];
const CROPS: readonly Pool[] = [
  { item: "harbour-kelp", line: "A ripe frond, still wet." },
  { item: "moss-poultice", line: "The moss is thick enough to pack a wound." },
  { item: "rainfern-seeds", line: "A pod splits and drops its seeds in your palm." },
  { item: "synth-ration", line: "Not quite a crop. Someone planted a ration in the tray." },
];
const FRIDGE: readonly Pool[] = [
  { item: "synth-ration", line: "A ration bar, dated last week. Labelled 'MINE'. Not anymore." },
  { item: "coolant-can", line: "A can of coolant at the back, behind the leftover noodles." },
  { item: "kiln-coffee", line: "A flask of cold Kiln coffee. Cold is fine." },
  { item: "hana-broth", line: "A tub of broth with someone's initials on it." },
];
const SCRAP: readonly Pool[] = [
  { item: "foundry-slag", line: "Slag swept under the bench. Free, if you can carry it." },
  { item: "copper-scrap", line: "An offcut of copper wire, still coiled." },
  { item: "circuit-board", line: "A pulled board from a dead rig. Mostly intact." },
  { item: "burnt-chip", line: "A burnt chip in the parts tray. Nobody will miss it." },
];
const PAWN: readonly { item: string; price: number; line: string }[] = [
  { item: "circuit-board", price: 30, line: "A tested circuit board, with a tag that reads 'no questions'." },
  { item: "hologram-gel", price: 36, line: "A tube of hologram gel, behind glass and a lot of dust." },
  { item: "stim", price: 28, line: "A single stim, priced like it was your last one." },
  { item: "neon-tube", price: 12, line: "A neon tube. The shopkeeper swears it hums in tune." },
];
const HAGGLE: readonly { item: string; price: number; line: string }[] = [
  { item: "synth-ration", price: 10, line: "You haggle a ration down by two credits and a compliment." },
  { item: "coolant-can", price: 15, line: "The stallholder sighs, names a price and shakes on it." },
  { item: "hana-broth", price: 12, line: "A warm tub of broth, fair price, no change." },
  { item: "harbour-kelp", price: 13, line: "Kelp, fresh off the pier. You pay and do not ask which pier." },
];
const SUPPLIES: readonly { item: string; count: number; price: number; line: string }[] = [
  { item: "ammo-pistol", count: 6, price: 8, line: "Six rounds in a twist of paper. Bait for something bigger." },
  { item: "sealant-spray", count: 1, price: 18, line: "A can of sealant spray, sold with a lecture on proper use." },
  { item: "coolant-can", count: 1, price: 18, line: "A can of coolant, for the long walk back." },
  { item: "stim", count: 1, price: 26, line: "The chandler keeps one stim under the counter 'for emergencies'." },
];
const JACK_LINES: readonly string[] = [
  "The console lets you in, scrolls a login banner and hands you a leftover file.",
  "A forgotten session is still open. You copy what you can before it times out.",
  "Default password. Of course. You take a clipping and leave no trace.",
];

const DRINK_LINES: readonly string[] = [
  "The barkeep slides over something blue and cold. The glass hums when you set it down.",
  "A short, bitter measure. The skyline swims a little, in a good way.",
  "'House special.' It tastes like rain on hot metal, and it works.",
];
const OFFICE_LINES: readonly string[] = [
  "A terminal left logged in. Someone's expenses spreadsheet is still open.",
  "The screensaver is a countdown to a deadline that passed last week. The session is live.",
  "Sticky note on the monitor: the password. You were not here.",
];
const OFFICE_NONE: readonly string[] = ["Locked the moment you touch it. Even the screensaver has standards.", "An unlocked terminal, and nothing on it worth carrying out."];
const KNOCK_LINES: readonly string[] = [
  "A chain rattles. 'Whatever you are selling, we have already got it.'",
  "A voice through the door: 'Wrong floor, wrong week, keep walking.'",
  "A door opens a hand's width. A face looks you over and shuts it again.",
  "Music inside stops. Starts again. Nobody answers.",
  "'Wrong door, wrong week, good luck.'",
];
const GIFT_LINES: readonly string[] = ["The door opens just long enough for a hand to pass you something. 'Don't tell the others.'", "A neighbour presses something into your palm and closes the door on your thanks."];
const GARDEN_LINES: readonly string[] = ["A rooftop bed someone is plainly proud of. You take what is ripe.", "Roof garden, wind-bent and stubborn. One plant has plenty to spare."];
const GAUGE_LINES: readonly string[] = ["The gauges wobble in the red. Behind the board, someone's spare kit.", "Pressure is fine. The locker beside it is not locked."];
const GARDEN_NONE = "Everything up here is still a week from ripe.";
const GAUGE_NONE = "The needles are steady. The panel hums. Nothing here is yours to take.";
const PLANT_ITEMS: readonly Pool[] = [
  { item: "harbour-kelp", line: "" }, { item: "moss-poultice", line: "" }, { item: "rainfern-seeds", line: "" }, { item: "synth-ration", line: "" },
];
const GAUGE_ITEMS: readonly Pool[] = [{ item: "coolant-can", line: "" }, { item: "sealant-spray", line: "" }, { item: "neon-tube", line: "" }];
const VIEWS: Readonly<Record<string, readonly string[]>> = {
  "sky-bar": ["the whole district laid out in neon below the parapet", "rain drifting sideways past the glass", "a river of tail-lights far under your drink"],
  "penthouse": ["the city spread out in sheets of light", "a skyline that goes on past where the light gives out", "the glass wall full of towers and weather"],
  "plant-deck": ["the wind off the sprawl, and a long drop of lit streets", "every roof in the district, flat and humming", "a sky the colour of old film"],
};
const COMPASS: readonly string[] = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
/** The nearest landmark to a world point, with its compass bearing (north is -z) and distance in metres. */
export function nearestLandmark(x: number, z: number): { name: string; direction: string; metres: number } {
  let best = LANDMARKS[0], bestDistance = Infinity;
  for (const landmark of LANDMARKS) { const d = Math.hypot(landmark.x - x, landmark.z - z); if (d < bestDistance) { bestDistance = d; best = landmark; } }
  const angle = Math.atan2(best.x - x, -(best.z - z)), index = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return { name: best.name, direction: COMPASS[index], metres: Math.round(bestDistance / 10) * 10 };
}

// ---- Using it ---------------------------------------------------------------------------------------------

/** Uses a ground floor's thing. Always posts at least one line; never throws. */
export function applyGroundLife(spec: GroundLifeSpec, host: GroundLifeHost): void {
  host.ledger.rollDay(host.day);
  const uses = host.ledger.uses;
  host.ledger.uses = uses + 1;
  const seed = hash(spec.key, uses, host.day, 0x5a17);
  const roll = unit(hash(seed, 1));
  const say = (text: string, tone: Tone = "info") => host.say(text, tone);
  const freebie = (pool: readonly Pool[], none?: string, missChance = 0): void => {
    if (freebieTaken(host, spec.key)) { say("You already went through this one today. Nothing new."); return; }
    if (itemsLeftToday(host) <= 0) { say("Picked clean across the city today. Try again tomorrow."); return; }
    if (roll < missChance) { host.ledger.take(spec.key); say(none ?? "Nothing worth taking."); return; }
    const pick = choose(pool, hash(seed, 2));
    const found = findItem(host, pick.item);
    if (found === "full") { say("Your pack is full. It stays where it was."); return; } // not used up: come back with room
    host.ledger.take(spec.key);
    if (found === "ok") say(pick.line); else say("Picked clean across the city today. Try again tomorrow.");
  };
  const buy = (price: number, item: string, count: number, line: string): void => {
    if (!host.spend(price)) { say(`${price} cr, and you are short.`, "danger"); return; }
    const taken = host.give(item, count);
    if (taken < count) { // it does not all fit: undo what went in and refund, so a partial buy is never free
      if (taken > 0) host.remove(item, taken);
      host.earn(price);
      say("Your pack cannot hold all of it. The deal is off.");
      return;
    }
    say(line);
    say(`- ${price} cr  + ${host.itemName(item)}${taken > 1 ? ` x${taken}` : ""}`, "loot");
  };

  switch (spec.action) {
    case "arcade": {
      if (!host.spend(1)) { say("The slot wants a credit. You have none.", "danger"); return; }
      if (roll < 1 / 7) {
        const paid = findCredits(host, 6);
        say(choose(WIN_LINES, hash(seed, 3)));
        if (paid > 0) say(`+ ${paid} cr`, "loot"); else say("The payout chute is empty for today.");
      } else say(choose(LOSE_LINES, hash(seed, 3)));
      return;
    }
    case "lost-and-found": return freebie(LOST_AND_FOUND, "The box holds one glove and a lot of regret.", 0.2);
    case "crop": return freebie(CROPS, "Everything on this rack is still a week from ripe.", 0.15);
    case "fridge": return freebie(FRIDGE, "Every shelf is labelled, and none of the labels are yours.", 0.35);
    case "workbench": return freebie(SCRAP, "The bench is spotless. Somebody cares about this place.", 0.15);
    case "pawn": { const o = choose(PAWN, hash(spec.key, 11)); return buy(o.price, o.item, 1, o.line); }
    case "haggle": { const o = choose(HAGGLE, hash(spec.key, 12)); return buy(o.price, o.item, 1, o.line); }
    case "supplies": { const o = choose(SUPPLIES, hash(spec.key, 13)); return buy(o.price, o.item, o.count, o.line); }
    case "jack-in": {
      if (freebieTaken(host, spec.key)) { say("The console has locked you out for the day."); return; }
      let found = roll < 0.3 ? findItem(host, "data-shard") : "cap";
      if (found !== "ok") found = findItem(host, "burnt-chip");
      if (found === "full") { say("Your pack is full. You log out without a file."); return; }
      host.ledger.take(spec.key);
      say(choose(JACK_LINES, hash(seed, 3)));
      if (found !== "ok") say("Nothing you can carry out. The logs are deleted.");
      return;
    }
    case "candle": {
      if (freebieTaken(host, spec.key)) say("The flame is already yours for today. You stand a while anyway.");
      else if (host.spend(1)) { host.ledger.take(spec.key); host.rest(0.15); say(choose(CANDLE_LINES, hash(seed, 3))); say("A little steadier. - 1 cr", "info"); }
      else say("You cannot spare the coin, but you stand a while. It helps, a bit.");
      say(choose(RUMOURS, hash(spec.key, uses, 5)), "quest");
      return;
    }
    case "rent-pod": {
      if (!host.spend(15)) { say("15 cr for a pod. You have less.", "danger"); return; }
      host.rest(1);
      say(spec.floor ? `A pod on ${spec.floorName.toLowerCase()}: hatch closed, the hum of the stack for a lullaby. Rested. - 15 cr` : "You fold into a pod, close the hatch and sleep like a cable. Rested. - 15 cr", "info");
      return;
    }
    case "order-drink": {
      const view = choose(VIEWS["sky-bar"], hash(seed, 4));
      if (freebieTaken(host, spec.key)) { say(`${spec.floorName}: the barkeep nods at your empty glass. 'One a night. House rule.' You watch ${view}.`); return; }
      if (!host.spend(12)) { say("12 cr for a round, and you are short.", "danger"); return; }
      host.ledger.take(spec.key);
      host.rest(0.3);
      say(choose(DRINK_LINES, hash(seed, 3)));
      say(`${spec.floorName}: ${view}. Warm, steady, a little brave. - 12 cr`, "info");
      return;
    }
    case "look-out": {
      const view = choose(VIEWS["penthouse"], hash(seed, 4)), near = nearestLandmark(spec.x, spec.z);
      say(`${spec.floorName}: you stand at the glass and take in ${view}.`, "info");
      say(`Nearest landmark: ${near.name}, about ${near.metres} m ${near.direction} of here.`, "quest");
      if (freebieTaken(host, spec.key)) return;
      host.ledger.take(spec.key);
      host.xp?.(10);
      const paid = findCredits(host, 2);
      say(paid > 0 ? `+ 10 XP  + ${paid} cr` : "+ 10 XP", "loot");
      return;
    }
    case "terminal": {
      if (freebieTaken(host, spec.key)) { say("The terminal has logged itself out. Whoever owns it is back."); return; }
      const found = roll < 0.4 ? findItem(host, "data-shard") : "cap";
      if (found === "full") { say("Your pack is full. You close the file unread."); return; }
      const paid = found !== "ok" && roll >= 0.4 && roll < 0.8 ? findCredits(host, 4) : 0;
      host.ledger.take(spec.key);
      if (found === "ok" || paid > 0) { say(choose(OFFICE_LINES, hash(seed, 3))); if (paid > 0) say(`+ ${paid} cr`, "loot"); }
      else say(choose(OFFICE_NONE, hash(seed, 3)));
      return;
    }
    case "knock": {
      say(choose(KNOCK_LINES, hash(seed, 3)));
      if (freebieTaken(host, spec.key) || roll >= 0.15) return;
      const pick = choose(FRIDGE, hash(seed, 2)), found = findItem(host, pick.item);
      if (found === "ok") { host.ledger.take(spec.key); say(choose(GIFT_LINES, hash(seed, 5))); }
      return;
    }
    case "roof-garden":
    case "gauges": {
      const garden = spec.action === "roof-garden", pool = garden ? PLANT_ITEMS : GAUGE_ITEMS;
      const view = choose(VIEWS["plant-deck"], hash(seed, 4));
      if (freebieTaken(host, spec.key)) { say(garden ? "Picked over already today. The plants need a night." : "You already took your readings. The board looks unchanged."); return; }
      if (itemsLeftToday(host) <= 0) { say("Picked clean across the city today. Try again tomorrow."); return; }
      if (roll < 0.15) { host.ledger.take(spec.key); say(garden ? GARDEN_NONE : GAUGE_NONE); return; }
      const found = findItem(host, choose(pool, hash(seed, 2)).item);
      if (found === "full") { say("Your pack is full. It stays where it was."); return; }
      host.ledger.take(spec.key);
      say(found === "ok" ? choose(garden ? GARDEN_LINES : GAUGE_LINES, hash(seed, 3)) : "Picked clean across the city today. Try again tomorrow.");
      say(`${spec.floorName}: ${view}.`, "info");
      return;
    }
    case "directory": { say(choose(DIRECTORY, hash(spec.key, 6)), "info"); say(choose(RUMOURS, hash(spec.key, uses, 7)), "quest"); return; }
    case "mailboxes": {
      if (freebieTaken(host, spec.key)) { say("The boxes are empty. Same as last time."); return; }
      if (roll < 0.25) {
        const paid = findCredits(host, 3);
        if (paid > 0) { host.ledger.take(spec.key); say("A box with a loose hinge. Inside: a cash envelope, wrong address.", "info"); say(`+ ${paid} cr`, "loot"); return; }
      }
      if (roll < 0.6) {
        const found = findItem(host, "afterlight-token");
        if (found === "full") { say("Your pack is full. The mail stays where it was."); return; }
        if (found === "ok") { host.ledger.take(spec.key); say("Behind the flyers: a token someone mailed to themselves."); return; }
      }
      host.ledger.take(spec.key);
      say("Bills, flyers, and a letter addressed to 'The Occupant'. You leave it.");
      return;
    }
  }
}
