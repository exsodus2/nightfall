// Pack "courier": a repeatable parcel-run loop through the city's building interiors.
//
// The Courier dispatch terminal beside Sable's board in the Silk Market posts three runs at a time
// (a pool of POOL_SIZE runs, generated once from the world and COURIER_SEED, windows of OFFERS).
// Every run is a quest: pick up at the door of one building (visit `interior:bldg-<n>`), deliver to
// another 300-900 m away; some are a three-stop chain, some deliver to an upper floor of a tall
// building. Objectives carry the door as `target`, and each stage drops a waypoint on it.
//
// Anti-farm: the stops of a run are all distinct buildings (so re-entering one door can never
// finish it), a run only completes in order, each run is `repeatable` with a long cooldown, and a
// shift pays out at most SHIFT_JOBS runs per SHIFT_COOLDOWN game seconds (hidden `courier-shift`
// quest + `courier.shift` counter). Rewards scale with distance.

import { CityInteriors, GROUND_FLOOR_KINDS } from "../../city/interiors.ts";
import type { GroundFloorKind, InteriorPlace } from "../../city/interiors.ts";
import { groundFloorPlaces, seeded, seedOf } from "../../city/building-interiors.ts";
import { DISTRICTS, CityWorld } from "../../city/world.ts";
import type { Condition, ContentPack, DialogueDefinition, DialogueOptionDef, InteractableDefinition, Objective, QuestDefinition2, QuestStage } from "../types.ts";
import { LEAVE, available, bye, ending, go, node } from "./helpers.ts";

export const COURIER_SEED = 2089;
/** Runs in the pool, posted OFFERS at a time. */
export const POOL_SIZE = 18;
export const OFFERS = 3;
/** Paying runs per shift, and game seconds before a new shift may begin. */
export const SHIFT_JOBS = 6;
export const SHIFT_COOLDOWN = 1800;
export const JOB_COOLDOWN = 2400;
export const MIN_LEG = 300;
export const MAX_LEG = 900;
/** Pickups are offered within this distance of the dispatch terminal. */
export const PICKUP_RADIUS = 650;
export const MAX_REWARD = 600;
export const DISPATCH = { x: -22, z: 57 } as const;
export const DISPATCH_ID = "courier-dispatch";

const WINDOW = "courier.w", SHIFT = "courier.shift", DONE = "courier.done";
const REST = "courier-shift";

const KIND_NAME: Readonly<Record<GroundFloorKind, string>> = {
  lobby: "Lobby", "capsule-hotel": "Capsule Hotel", "corp-lobby": "Corp Lobby", arcade: "Arcade", pawnshop: "Pawnshop", "machine-shop": "Machine Shop",
  "server-hall": "Server Hall", shrine: "Shrine", hydroponics: "Hydroponics Farm", laundromat: "Laundromat", "market-hall": "Market Hall",
  chandlery: "Chandlery", apartment: "Apartments", garage: "Garage",
};
/** What a place hands over, and who takes it (the end of a leg reads "<parcel> ... <receiver>"). */
const PARCEL: Readonly<Record<GroundFloorKind, string>> = {
  lobby: "a sealed visitor ledger", "capsule-hotel": "a folded set of pod linens", "corp-lobby": "a stamped courier slip in a grey envelope", arcade: "a bag of warm coins",
  pawnshop: "a velvet pouch that clinks", "machine-shop": "a greased gearbox in a paper sleeve", "server-hall": "a sealed coolant flask", shrine: "a bundle of blessed paper charms",
  hydroponics: "a damp crate of seedlings", laundromat: "a bag of warm folded towels", "market-hall": "a crate of unmarked noodles", chandlery: "a spool of waxed line",
  apartment: "a taped shoebox with a name on it", garage: "a jar of loose bolts",
};
const RECEIVER: Readonly<Record<GroundFloorKind, string>> = {
  lobby: "the front desk", "capsule-hotel": "the night clerk", "corp-lobby": "the receptionist who pretends not to see you", arcade: "the cashier behind the token cage",
  pawnshop: "the broker at the glass", "machine-shop": "whoever is holding the lathe", "server-hall": "the technician in the cold aisle", shrine: "the keeper by the incense",
  hydroponics: "the grower at the racks", laundromat: "the attendant folding by the dryers", "market-hall": "the stall boss", chandlery: "the rigger at the counter",
  apartment: "the resident who answers on the third knock", garage: "the mechanic under the lift",
};
/** Hand-written flavour for pairs worth a line of their own (source kind > destination kind). */
const PAIR: Readonly<Partial<Record<`${GroundFloorKind}>${GroundFloorKind}`, string>>> = {
  "arcade>laundromat": "a bag of warm coins from the arcade to the laundromat (the machines there only take old tokens)",
  "server-hall>hydroponics": "a sealed coolant flask from the server hall to the hydroponics farm (the racks run hot)",
  "pawnshop>shrine": "a velvet pouch from the pawnshop to the shrine (nobody asks whose)",
  "garage>machine-shop": "a jar of loose bolts from the garage to the machine shop (they claim to be rare)",
  "market-hall>capsule-hotel": "a crate of unmarked noodles from the market hall to the capsule hotel (breakfast, allegedly)",
};

export interface CourierStop { id: string; name: string; kind: GroundFloorKind; district: string; floor: number; entrance: { x: number; z: number }; distanceFromPrev: number }
export interface CourierJob {
  /** Pool slot this run fills (the `counter` it was rolled for). */
  index: number;
  questId: string;
  title: string;
  /** Pickup first, then every drop: 2 stops (run) or 3 (chain). */
  stops: readonly CourierStop[];
  distance: number;
  credits: number;
  xp: number;
  summary: string;
  /** Flavour line for the parcel. */
  parcel: string;
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
const isCourierKind = (kind: string): kind is GroundFloorKind => (GROUND_FLOOR_KINDS as readonly string[]).includes(kind);
const label = (stop: Pick<CourierStop, "name" | "kind" | "district" | "floor">): string =>
  `${stop.name} (${KIND_NAME[stop.kind]}) on ${stop.district}${stop.floor > 1 ? `, floor ${stop.floor}` : ""}`;

/** The reward for `meters` of legs: modest, scaled by distance, capped. */
export function courierReward(meters: number, stops: number): { credits: number; xp: number } {
  const credits = Math.min(MAX_REWARD, 90 + Math.round((meters * 0.28 + (stops - 2) * 60) / 5) * 5);
  return { credits, xp: 40 + Math.round(meters / 25) };
}

export interface CourierContext { interiors: CityInteriors; places: readonly InteriorPlace[] }
export function courierContext(world: CityWorld): CourierContext {
  return { interiors: new CityInteriors(world), places: groundFloorPlaces(world).filter(place => isCourierKind(place.kind) && !place.floor) };
}

function stopFor(place: InteriorPlace, floor: number, prev: { x: number; z: number } | null): CourierStop {
  if (!isCourierKind(place.kind)) throw new Error(`courier: ${place.id} is not a ground-floor kind`);
  return {
    id: floor > 1 ? `${place.id}-f${floor}` : place.id, name: place.name, kind: place.kind, district: DISTRICTS[place.district]?.name ?? "the city", floor,
    entrance: { x: place.entrance.x, z: place.entrance.z }, distanceFromPrev: prev ? Math.round(dist(prev, place.entrance)) : 0,
  };
}

/** Deterministically rolls one run from (day, counter): same inputs, same run. */
export function generateCourierJob(ctx: CourierContext, day: number, counter: number): CourierJob {
  const random = seeded(seedOf(COURIER_SEED + day * 7919, counter * 31 + 5));
  const nearby = ctx.places.filter(place => dist(place.entrance, DISPATCH) <= PICKUP_RADIUS);
  const pool = nearby.length > 0 ? nearby : ctx.places;
  const chain = counter % 4 === 3; // every fourth slot is a three-stop chain
  const wantsFloor = counter % 3 === 1; // a third of the runs end on an upper floor, when one exists
  const used = new Set<number>();
  const pickLeg = (from: InteriorPlace | null, allowFloor: boolean): CourierStop => {
    const candidates = (from ? ctx.places : pool).filter(place => !used.has(place.building) && (!from || (dist(from.entrance, place.entrance) >= MIN_LEG && dist(from.entrance, place.entrance) <= MAX_LEG)));
    if (candidates.length === 0) throw new Error(`courier: no candidates for slot ${counter}`);
    // Prefer a different kind of place than the last one, so a run always crosses between worlds.
    const different = from ? candidates.filter(place => place.kind !== from.kind) : candidates;
    const list = different.length > 0 ? different : candidates;
    const place = list[Math.floor(random() * list.length) % list.length];
    used.add(place.building);
    if (allowFloor && place.stops && place.stops.length > 1) {
      const floors = place.stops.filter(f => f > 1 && ctx.interiors.placeById(`${place.id}-f${f}`) !== null);
      if (floors.length > 0) return stopFor(place, floors[Math.floor(random() * floors.length) % floors.length], from?.entrance ?? null);
    }
    return stopFor(place, 1, from?.entrance ?? null);
  };
  const placeOf = (stop: CourierStop): InteriorPlace => {
    const place = ctx.places.find(candidate => stop.id === candidate.id || stop.id.startsWith(`${candidate.id}-f`));
    if (!place) throw new Error(`courier: lost ${stop.id}`);
    return place;
  };
  const first = pickLeg(null, false);
  const stops: CourierStop[] = [first];
  let from = placeOf(first);
  const legs = chain ? 2 : 1;
  for (let leg = 0; leg < legs; leg++) {
    const stop = pickLeg(from, wantsFloor && leg === legs - 1);
    stops.push(stop);
    from = placeOf(stop);
  }
  const distance = stops.reduce((sum, stop) => sum + stop.distanceFromPrev, 0);
  const { credits, xp } = courierReward(distance, stops.length);
  const pair = stops.length === 2 ? PAIR[`${stops[0].kind}>${stops[1].kind}`] : undefined;
  const parcel = pair ?? `${PARCEL[stops[0].kind]} from ${KIND_NAME[stops[0].kind].toLowerCase()} to ${stops.length === 2 ? `${RECEIVER[stops[1].kind]}` : "two drop-offs"}`;
  const last = stops[stops.length - 1];
  const title = chain ? `Courier chain: ${stops[0].name} to ${last.name}` : `Courier run: ${stops[0].name} to ${last.name}`;
  return {
    index: counter, questId: `courier-${String(counter).padStart(2, "0")}`, title, stops, distance, credits, xp, parcel,
    summary: `Carry ${parcel}. Pick up at ${label(stops[0])}; ${stops.length === 2 ? "deliver to" : "drop at"} ${stops.slice(1).map(label).join(", then ")}. About ${distance} m of walking, ${credits} cr.`,
  };
}

// ---- Quests -------------------------------------------------------------------------------------

const targetOf = (stop: CourierStop): { x: number; z: number } => ({ x: stop.entrance.x, z: stop.entrance.z });
const visit = (id: string, stop: CourierStop, text: string): Objective => ({ id, kind: "visit", area: `interior:${stop.id}`, text, target: targetOf(stop) });
const way = (stop: CourierStop, text: string) => ({ waypoint: { ...targetOf(stop), label: text } });

function jobQuest(job: CourierJob): QuestDefinition2 {
  const [pickup, ...drops] = job.stops;
  const stages: QuestStage[] = [{
    id: "pickup", journal: `Dispatch: pick up ${job.parcel} at ${label(pickup)}. The door is marked on your map; press E at it.`,
    onEnter: [way(pickup, `Pickup: ${pickup.name}`)],
    objectives: [visit("pickup", pickup, `Pick up the parcel: go inside ${label(pickup)}`)],
    onComplete: [{ message: `Parcel collected at ${pickup.name}. Next door is on your map.`, tone: "quest" }],
    next: "drop-1",
  }];
  drops.forEach((drop, i) => {
    const final = i === drops.length - 1;
    stages.push({
      id: `drop-${i + 1}`, journal: `Carry the parcel to ${label(drop)}${drop.floor > 1 ? ` (take the lift to floor ${drop.floor})` : ""}.`,
      onEnter: [way(drop, `${final ? "Deliver" : "Drop"}: ${drop.name}`)],
      objectives: [visit(`drop-${i + 1}`, drop, `${final ? "Deliver" : "Drop off"} at ${label(drop)}`)],
      next: final ? "paid" : `drop-${i + 2}`,
    });
  });
  stages.push(ending("paid", "Delivered. Dispatch has your pay.", "delivered"));
  return {
    id: job.questId, title: job.title, category: "gig", giver: "sable", summary: job.summary,
    rewardHint: `${job.credits} cr, ${job.xp} XP`, recommendedLevel: 1, repeatable: { cooldown: JOB_COOLDOWN }, start: "pickup", stages,
    outcomes: {
      delivered: {
        title: "Delivered", journal: `Parcel delivered: ${job.stops.length - 1} stop${job.stops.length > 2 ? "s" : ""}, ${job.distance} m.`,
        effects: [{ credits: job.credits }, { xp: job.xp }, { setFlag: WINDOW, value: (Math.floor(job.index / OFFERS) + 1) % (POOL_SIZE / OFFERS) },
          { addFlag: SHIFT, by: 1 }, { addFlag: DONE, by: 1 }, { startQuest: REST }],
      },
    },
  };
}

/** Hidden quest whose cooldown is the shift clock: started by every delivery, a no-op while cooling down. */
const shiftQuest: QuestDefinition2 = {
  id: REST, title: "Courier shift logged", category: "gig", giver: null, summary: "The dispatcher's shift clock.",
  repeatable: { cooldown: SHIFT_COOLDOWN }, start: "log", stages: [ending("log", "Shift clock running.", "logged")],
  outcomes: { logged: { title: "Shift clock", journal: "Logged.", effects: [] } },
};

const shiftOpen: Condition = { flag: SHIFT, atMost: SHIFT_JOBS - 1 };
const windowIs = (w: number): Condition => (w === 0 ? { not: { flag: WINDOW, atLeast: 1 } } : { flag: WINDOW, is: w });

function dispatchDialogue(jobs: readonly CourierJob[]): DialogueDefinition {
  const take = (job: CourierJob): DialogueOptionDef => ({
    id: `take-${job.index}`, label: `${job.title} (${job.credits} cr, ${job.distance} m${job.stops.length > 2 ? ", 3 stops" : ""})`,
    condition: { all: [available(job.questId), shiftOpen, windowIs(Math.floor(job.index / OFFERS))] }, hideIfUnavailable: true, kind: "accept",
    effects: [{ startQuest: job.questId }], next: "taken",
  });
  const newShift: DialogueOptionDef = {
    id: "new-shift", label: "Clock a new shift.", condition: { all: [{ flag: SHIFT, atLeast: SHIFT_JOBS }, available(REST)] }, hideIfUnavailable: true,
    kind: "continue", effects: [{ setFlag: SHIFT, value: 0 }], next: "board",
  };
  return {
    id: "courier.dispatch", npc: DISPATCH_ID, entries: [{ node: "board" }],
    nodes: [
      node("board", [
        "[A scuffed dispatch terminal bolted beside the contract board. Parcel manifests scroll past in green.]",
        `Dispatch: ${OFFERS} runs up. Walk it in, hand it over, get paid. No vehicles required. Doors are marked on your map.`,
      ], [...jobs.map(take), newShift,
        { id: "shift-over", label: "(Shift quota met. New shift opens after a rest.)", condition: { all: [{ flag: SHIFT, atLeast: SHIFT_JOBS }, { not: available(REST) }] }, hideIfUnavailable: true, kind: "continue", next: "board" },
        go("rules", "How does this work?", "rules"), LEAVE]),
      node("rules", [
        `Pick a run. Go inside the pickup building, then inside the drop. Chains have two drops. Some drops are on upper floors: take the lift.`,
        `Pay scales with distance. ${SHIFT_JOBS} runs a shift; after that the terminal wants a rest. Re-entering the same door gets you nothing.`,
      ], [go("back", "Show me the manifests.", "board"), LEAVE]),
      node("taken", ["Manifest sent. First door is on your map. Don't open the parcel."], [bye("On my way.")]),
    ],
  };
}

// ---- Build --------------------------------------------------------------------------------------

/** Rolls the whole pool (day 0) for a world. */
export function courierPool(ctx: CourierContext, day = 0): CourierJob[] {
  return Array.from({ length: POOL_SIZE }, (_, counter) => generateCourierJob(ctx, day, counter));
}

const interactable: InteractableDefinition = { id: DISPATCH_ID, label: "Courier dispatch terminal", ...DISPATCH, y: 1.2, glyph: "D", dialogue: "courier.dispatch" };

const context = courierContext(new CityWorld());
/** The generated jobs the pack ships (day 0). */
export const COURIER_JOBS: readonly CourierJob[] = courierPool(context);

/** Repeatable courier runs between building interiors, posted at the Silk Market dispatch terminal. */
export const COURIER_PACK: ContentPack = {
  id: "courier",
  quests: [...COURIER_JOBS.map(jobQuest), shiftQuest],
  dialogues: [dispatchDialogue(COURIER_JOBS)],
  interactables: [interactable],
};
