import { districtAt, randomFor, type CityWorld } from "./world.ts";
import { inPark } from "./park.ts";
import type { Citizen, ResidentRole } from "./people.ts";

export interface PerceivedPlayer { id: string; x: number; y?: number; z: number; speed?: number }
/** Where a fight is going on (an enemy in combat, or the player while fighting): positions only. */
export interface PerceivedThreat { x: number; z: number }
/** `threats`: fighting near the eye (RpgSession.threats); the nearest MAX_PERCEIVED_THREATS are used. */
export interface PopulationPerception { players: readonly PerceivedPlayer[]; rain?: boolean; threats?: readonly PerceivedThreat[] }
export type CitizenReaction = "noticing" | "greeting" | "yielding";
export interface AwarenessTarget { x: number; z: number; road?: boolean; crossing?: boolean }
export type AwarenessResponse = "continue" | "handled" | "turn-back";
interface Point { x: number; z: number }
interface CitizenMemory {
  player: string;
  seen: number;
  pauseUntil: number;
  cooldownUntil: number;
  blockedSince: number | null;
  encounters: number;
  detour: Point[];
  trail: Point[];
  returning: boolean;
}

export const CITIZEN_AWARENESS_RADIUS = 36;
export const MAX_PERCEIVED_PLAYERS = 8;
export const CITIZEN_PERSONAL_SPACE = 1.15;
/** A walking player (6 m/s) closes 8 m in about 1.3 s, long enough to read the start of a line
 *  while the speaker is still ahead; at the old 5.5 m the plate was gone before it could be read. */
const NOTICE_RADIUS = 8;
/** A sprinter passing within this (m) may get a remark. */
const SPRINT_RADIUS = 3.2;
/** A player who has stood within LINGER_DRIFT of one spot this long draws glances from groups nearby. */
export const LINGER_SECONDS = 10;
const LINGER_DRIFT = 0.8, GLANCE_RADIUS = 7;
/** Global spacing between two barks anywhere in the crowd. */
const BARK_SPACING = 2.8;
const DISTRICT_BARKS = [
  ["Kiln Nine's test bench is free if you can read the plate.", "Shift ended an hour ago. My ears are still ringing.", "Tomas at the Ember Core knows every pipe by its cough.", "Don't drink from the slag channel. Yes, people ask."],
  ["Undertone does a quiet set at closing. Leave the loud stuff.", "Meridian Spire's lit up again. Somebody got promoted.", "That vending machine on the avenue owes me two credits.", "Night market opens at ten. Good dumplings gone by eleven."],
  ["Dead Letter still posts notices on paper. Paper!", "Keep your phone in your pocket. Ghosts like phones.", "Saw a Chrome Saint praying to a router last night.", "Every antenna on this block is arguing with the next one."],
  ["Glasshouse lets you wait out the rain. Don't touch the trays.", "Take the park path. Only road in town without traffic.", "Juniper fixed my hand. Charged me for the thumb twice.", "Seed swap at the Glasshouse on Sundays. Bring a pot."],
  ["Blue Hour Tea's still open. It's always still open.", "Hana's had that broth going since before the rain.", "Count your change at the stalls. Then count it again.", "Sable just put three new names on the board."],
  ["Second Life fixed my kettle. Now it plays music.", "Afterlight's open. Mama Kestrel doesn't do closing time.", "Razorbacks collect on the arcade lot. Walk the long way.", "River's up again. Wear the tall boots."],
] as const;

export function perceivedPlayers(perception: PopulationPerception | undefined, eye: Point): PerceivedPlayer[] {
  const nearby: { player: PerceivedPlayer; distance: number }[] = [];
  for (const player of perception?.players ?? []) {
    if (!Number.isFinite(player.x) || !Number.isFinite(player.z) || !Number.isFinite(player.y ?? 0) || Math.abs(player.y ?? 0) > 3) continue;
    const distance = (player.x - eye.x) ** 2 + (player.z - eye.z) ** 2;
    if (distance > 40 ** 2 || nearby.some(candidate => candidate.player.id === player.id)) continue;
    let index = 0;
    while (index < nearby.length && (nearby[index].distance < distance || nearby[index].distance === distance && nearby[index].player.id < player.id)) index++;
    if (index >= MAX_PERCEIVED_PLAYERS) continue;
    nearby.splice(index, 0, { player, distance });
    if (nearby.length > MAX_PERCEIVED_PLAYERS) nearby.pop();
  }
  return nearby.map(candidate => candidate.player);
}

/** What each street role says when someone stops near them (district small talk is the fallback). */
const ROLE_BARKS: Partial<Record<ResidentRole, readonly string[]>> = {
  patrol: ["Keep it moving. Spire business.", "Badge scans are free. Today.", "Nothing to see. Walk on."],
  cleaner: ["Mind the wet patch. There's always a wet patch.", "Someone dropped a whole noodle bowl on the crossing. Again."],
  dog: ["He doesn't bite. He licks. It's worse.", "Say hello, Byte. Byte. Byte, no."],
  cyborg: ["New arm. Still learning which way is left.", "Warranty ran out at the elbow."],
  crate: ["Crate for the noodle bar. Don't ask what's in it.", "Forty kilos of soy and a lift that's out."],
  musician: ["Requests cost a credit. Silence costs two.", "This one's about the rain. They're all about the rain."],
  queue: ["Queue starts back there, friend.", "Hana's broth. Worth the wait. Mostly."],
  protester: ["Pumps before towers! Fix the locks!", "The river's in my kitchen. Sign the sheet."],
  smoker: ["Undertone's playing the slow stuff tonight.", "Just stepping out. Ears needed a minute."],
  vendor: ["Umbrellas. It'll rain. It always rains.", "Folding ones, ten credits. They mostly fold."],
  kite: ["Look how high it goes!", "Wind's best by the Last Tree."],
  wrist: ["Screen says the train's on time. The screen lies.", "Three missed calls from my landlord. Two from my mum."],
  audience: ["Shh. This is the good bit.", "He's better when it rains. Everyone is."],
  preacher: ["The water remembers every street it ever took!", "Repent, and fix the pumps!", "The river is patient. Are you?"],
  dancer: ["Undertone's bass comes right through the wall.", "Can't hear the words. Don't need them."],
  sitter: ["Twelve hours on the line. Don't ask me to stand.", "Just resting my eyes. And my feet. And my back."],
  chaser: ["I almost got its shadow!", "It's faster when it's high up."],
};
/** Muttered at someone sprinting through the crowd. */
const SPRINT_LINES = ["Oi! Watch it!", "Where's the fire?", "Easy, runner.", "Some of us walk here.", "Late for something?"] as const;
const RAIN_VENDOR = "Umbrellas! Ten credits, twelve if it's pouring.";

/** Seconds a bark stays up so it can be read: a short base plus reading time. */
export function barkHold(text: string): number {
  return Math.min(7, Math.max(3.8, 2.2 + text.length * 0.065));
}

export function citizenBark(person: Pick<Citizen, "id" | "x" | "z" | "occupation" | "role">, encounters: number, yielding: boolean, rain: boolean): string {
  if (yielding) return person.occupation === "courier" ? "Mind the box. Fragile parcel coming through." : person.role === "patrol" ? "Step aside, please." : ["After you.", "Go on, I'll take the kerb.", "Sorry, sorry. Puddle."][Math.floor(randomFor(person.id, encounters, 41) * 3)];
  if (person.role === "vendor" && rain) return RAIN_VENDOR;
  const role = person.role ? ROLE_BARKS[person.role] : undefined;
  if (role) return role[Math.floor(randomFor(person.id, encounters, 44) * role.length)];
  if (person.occupation === "courier") return "Parcel for the ninth floor. Lift's out. Again.";
  if (rain && randomFor(person.id, encounters, 42) < 0.35) return "Mr. Nimbus said it'd clear. He always says it'll clear.";
  const lines = DISTRICT_BARKS[districtAt(person.x, person.z).id];
  return lines[Math.floor(randomFor(person.id, encounters, 43) * lines.length)];
}

export function citizenPavement(world: Pick<CityWorld, "canOccupy">, x: number, z: number): boolean {
  if (!world.canOccupy(x, z)) return false;
  if (inPark(x, z)) return true;
  const streetX = Math.round(x / 64) * 64, streetZ = Math.round(z / 64) * 64;
  return Math.abs(x - streetX) >= (streetX === 0 ? 13.5 : 6.85) && Math.abs(z - streetZ) >= 6.85;
}

/**
 * Players standing still: each perceived player's anchor spot and when they settled there. Bounded
 * (MAX_PERCEIVED_PLAYERS a frame; entries unseen for 5 s are dropped once the map grows).
 */
export interface LingeringPlayer extends PerceivedPlayer {
  /** When they settled on the spot, and when they left it (Infinity while they are still there). */
  since: number; until: number;
}
/** A glance lasts this long (s); a player who has just moved on is kept this long so one under way ends eased. */
const GLANCE_SECONDS = 2.6;
export class LingerWatch {
  private readonly anchors = new Map<string, { x: number; z: number; since: number; seen: number; stint: { since: number; left: number } | null }>();
  private readonly still: LingeringPlayer[] = [];

  /** Updates the anchors and returns the players who have lingered LINGER_SECONDS or more, and those
   *  who left a lingering spot under GLANCE_SECONDS ago (a reused list). */
  observe(players: readonly PerceivedPlayer[], time: number): readonly LingeringPlayer[] {
    this.still.length = 0;
    for (const player of players) {
      let anchor = this.anchors.get(player.id);
      if (!anchor || time < anchor.seen) {
        anchor = { x: player.x, z: player.z, since: time, seen: time, stint: null };
        this.anchors.set(player.id, anchor);
      } else if ((player.x - anchor.x) ** 2 + (player.z - anchor.z) ** 2 > LINGER_DRIFT ** 2) {
        if (time - anchor.since >= LINGER_SECONDS) anchor.stint = { since: anchor.since, left: time };
        anchor.x = player.x; anchor.z = player.z; anchor.since = time;
      }
      anchor.seen = time;
      if (time - anchor.since >= LINGER_SECONDS) this.still.push({ ...player, since: anchor.since, until: Infinity });
      else if (anchor.stint && time - anchor.stint.left < GLANCE_SECONDS) this.still.push({ ...player, since: anchor.stint.since, until: anchor.stint.left });
    }
    if (this.anchors.size > MAX_PERCEIVED_PLAYERS * 2) for (const [id, anchor] of this.anchors) if (time - anchor.seen > 5) this.anchors.delete(id);
    return this.still;
  }
}

/**
 * A glance at a lingering player: the head turns toward them (at most ~65 degrees off the body's
 * heading) for GLANCE_SECONDS every 8-11 s, eased in and out (sin^2), staggered per person so a
 * group never turns in unison. Only glances that begin once the player has lingered (and before
 * they leave) happen, and the turn fades with distance past GLANCE_RADIUS, so the head never snaps.
 * Returns the head turn in radians (the engine's yaw sense); 0 when not looking. Pure function of
 * the clock and the watch.
 */
export function glanceAt(person: Pick<Citizen, "id" | "x" | "z" | "yaw">, still: readonly LingeringPlayer[], time: number): number {
  let nearest: LingeringPlayer | undefined, best = (GLANCE_RADIUS + 4) ** 2;
  for (const player of still) {
    const distance = (player.x - person.x) ** 2 + (player.z - person.z) ** 2;
    if (distance < best && distance > 0.36) { best = distance; nearest = player; }
  }
  if (!nearest) return 0;
  const period = 8 + (person.id % 5) * 0.7, phase = ((time + randomFor(person.id, 5, 88) * 11) % period + period) % period;
  const start = time - phase;
  if (phase >= GLANCE_SECONDS || start < nearest.since + LINGER_SECONDS || start > nearest.until) return 0;
  let turn = Math.atan2(nearest.x - person.x, person.z - nearest.z) - person.yaw;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  // Fades with distance past GLANCE_RADIUS, and for someone right behind (where the turn's sign flips).
  const reach = 1 - Math.max(0, Math.min(1, (Math.sqrt(best) - GLANCE_RADIUS) / 4));
  const behind = Math.max(0, Math.min(1, (Math.abs(turn) - 1.9) / 0.7));
  return Math.max(-1.15, Math.min(1.15, turn)) * Math.sin(Math.PI * phase / GLANCE_SECONDS) ** 2 * reach * reach * (3 - 2 * reach) * (1 - behind * behind * (3 - 2 * behind));
}

export class CitizenAwareness {
  private readonly memories = new Map<number, CitizenMemory>();
  private nextBarkAt = 0;
  private readonly world: Pick<CityWorld, "canOccupy">;

  constructor(world: Pick<CityWorld, "canOccupy">) { this.world = world; }

  hasDetour(id: number): boolean { return (this.memories.get(id)?.detour.length ?? 0) > 0; }

  clear(person: Citizen, time: number): void {
    person.reaction = undefined;
    person.attentionYaw = undefined;
    if ((person.barkUntil ?? 0) <= time) { person.bark = undefined; person.barkUntil = undefined; }
  }

  update(person: Citizen, target: AwarenessTarget | undefined, dt: number, time: number, players: readonly PerceivedPlayer[], rain: boolean): AwarenessResponse {
    this.clear(person, time);
    if (person.y > 0.5 || target?.road) return "continue";
    let nearest: PerceivedPlayer | undefined, nearestDistance = Math.max(NOTICE_RADIUS, dt * 3 + CITIZEN_PERSONAL_SPACE) ** 2;
    for (const player of players) {
      const distance = (player.x - person.x) ** 2 + (player.z - person.z) ** 2;
      if (distance < nearestDistance) { nearest = player; nearestDistance = distance; }
    }
    let memory = this.memories.get(person.id);
    if (!nearest && !memory?.detour.length) return "continue";
    if (!memory) {
      memory = { player: "", seen: -Infinity, pauseUntil: 0, cooldownUntil: 0, blockedSince: null, encounters: 0, detour: [], trail: [], returning: false };
      this.memories.set(person.id, memory);
    }
    const firstMeeting = nearest && (memory.player !== nearest.id || time - memory.seen > 8);
    if (nearest) {
      memory.player = nearest.id; memory.seen = time;
      person.attentionYaw = Math.atan2(nearest.x - person.x, person.z - nearest.z);
    }
    if (memory.detour.length) {
      person.reaction = "yielding";
      const destination = memory.detour[0];
      const distance = Math.hypot(destination.x - person.x, destination.z - person.z);
      if (distance < 0.0001) {
        memory.trail.push(memory.detour.shift()!);
        if (!memory.detour.length && memory.returning) { memory.returning = false; return "turn-back"; }
      } else if (this.walk(person, destination, Math.min(distance, dt * 1.45), players)) memory.blockedSince = null;
      else {
        memory.blockedSince ??= time;
        if (!memory.returning && time - memory.blockedSince > 2.5) {
          memory.detour = memory.trail.reverse(); memory.trail = []; memory.returning = true; memory.blockedSince = null;
        }
      }
      return "handled";
    }
    if (target && person.state !== "browsing" && person.state !== "talking") {
      const distance = Math.hypot(target.x - person.x, target.z - person.z);
      if (distance > 0.02) {
        const forward = { x: (target.x - person.x) / distance, z: (target.z - person.z) / distance };
        let blocker: PerceivedPlayer | undefined, closest = Math.max(2.7, dt * 3 + CITIZEN_PERSONAL_SPACE);
        for (const player of players) {
          const ahead = (player.x - person.x) * forward.x + (player.z - person.z) * forward.z;
          const across = Math.abs((player.x - person.x) * forward.z - (player.z - person.z) * forward.x);
          if (ahead > -0.15 && ahead < closest && across < CITIZEN_PERSONAL_SPACE + 0.1) { blocker = player; closest = ahead; }
        }
        if (blocker) {
          person.reaction = "yielding"; person.moving = false;
          person.attentionYaw = Math.atan2(blocker.x - person.x, person.z - blocker.z);
          memory.blockedSince ??= time;
          if (time >= memory.cooldownUntil) this.speak(person, memory, time, true, rain);
          memory.detour = this.detour(person, target, blocker, players);
          if (memory.detour.length) { memory.blockedSince = null; memory.trail = [{ x: person.x, z: person.z }]; memory.returning = false; }
          else if (time - memory.blockedSince >= 2.5) { memory.blockedSince = null; return "turn-back"; }
          return "handled";
        }
      }
    }
    memory.blockedSince = null;
    // Someone sprints past close by: now and then a resident calls after them, without stopping.
    if (nearest && (nearest.speed ?? 0) >= 7 && nearestDistance <= SPRINT_RADIUS ** 2 && time >= memory.cooldownUntil) {
      memory.encounters++;
      memory.cooldownUntil = time + 24 + randomFor(person.id, memory.encounters, 40) * 16;
      if (randomFor(person.id, memory.encounters, 46) < 0.4) this.say(person, SPRINT_LINES[Math.floor(randomFor(person.id, memory.encounters, 47) * SPRINT_LINES.length)], time);
    }
    if (firstMeeting && nearest && nearestDistance <= NOTICE_RADIUS ** 2 && time >= memory.cooldownUntil && (nearest.speed ?? 0) < 7) {
      memory.encounters++;
      memory.pauseUntil = time + 0.6 + randomFor(person.id, memory.encounters, 39) * 0.55;
      person.reaction = person.id % 3 === 0 ? "noticing" : "greeting";
      this.speak(person, memory, time, false, rain);
    }
    if (nearest && time < memory.pauseUntil) {
      person.reaction = person.id % 3 === 0 ? "noticing" : "greeting";
      person.moving = false;
      return "handled";
    }
    person.attentionYaw = undefined;
    return "continue";
  }

  private speak(person: Citizen, memory: CitizenMemory, time: number, yielding: boolean, rain: boolean): void {
    memory.cooldownUntil = time + 24 + randomFor(person.id, memory.encounters, 40) * 16;
    if (!yielding && person.id % 3 === 0 && !person.role) return;
    this.say(person, citizenBark(person, memory.encounters, yielding, rain), time);
  }

  /** Puts `text` over `person` if the crowd-wide spacing allows it; false when someone spoke too
   *  recently. Street locals (street-locals.ts) share this limit with the walkers. */
  say(person: Citizen, text: string, time: number): boolean {
    if (time < this.nextBarkAt) return false;
    person.bark = text;
    person.barkUntil = time + barkHold(text);
    this.nextBarkAt = time + BARK_SPACING;
    return true;
  }

  private clearSegment(from: Point, to: Point, players: readonly PerceivedPlayer[]): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.25));
    for (let index = 1; index <= steps; index++) {
      const x = from.x + (to.x - from.x) * index / steps, z = from.z + (to.z - from.z) * index / steps;
      if (!citizenPavement(this.world, x, z)) return false;
      for (const player of players) {
        const distance = (player.x - x) ** 2 + (player.z - z) ** 2;
        const startingDistance = (player.x - from.x) ** 2 + (player.z - from.z) ** 2;
        if (distance < CITIZEN_PERSONAL_SPACE ** 2 && distance <= startingDistance) return false;
      }
    }
    return true;
  }

  private detour(person: Citizen, target: Point, player: PerceivedPlayer, players: readonly PerceivedPlayer[]): Point[] {
    const distance = Math.hypot(target.x - person.x, target.z - person.z);
    const directionX = (target.x - person.x) / distance, directionZ = (target.z - person.z) / distance;
    const ahead = (player.x - person.x) * directionX + (player.z - person.z) * directionZ;
    if (ahead + 1.6 > distance) return [];
    const firstSide = person.id % 2 ? 1 : -1;
    for (const side of [firstSide, -firstSide]) {
      const offsetX = directionZ * side * 1.65, offsetZ = -directionX * side * 1.65;
      const points = [
        { x: person.x + offsetX, z: person.z + offsetZ },
        { x: person.x + directionX * (ahead + 1.6) + offsetX, z: person.z + directionZ * (ahead + 1.6) + offsetZ },
        { x: person.x + directionX * (ahead + 1.6), z: person.z + directionZ * (ahead + 1.6) },
      ];
      let previous: Point = person;
      if (points.every(point => { const clear = this.clearSegment(previous, point, players); previous = point; return clear; })) return points;
    }
    return [];
  }

  private walk(person: Citizen, target: Point, step: number, players: readonly PerceivedPlayer[]): boolean {
    const distance = Math.hypot(target.x - person.x, target.z - person.z);
    if (!distance || step <= 0) return false;
    const next = { x: person.x + (target.x - person.x) / distance * step, z: person.z + (target.z - person.z) / distance * step };
    if (!this.clearSegment(person, next, players)) { person.moving = false; return false; }
    person.yaw = Math.atan2(next.x - person.x, person.z - next.z);
    person.x = next.x; person.z = next.z; person.moving = true;
    return true;
  }
}

// ---- Fights: civilians scatter, drift back, and a few look over the scene afterwards --------------
// Everything here is a pure function of positions, the shared clock and the perceived threats
// (tests/civilians-combat.test.ts, tests/shared-signals.test.ts).

export const MAX_PERCEIVED_THREATS = 8;
/** A civilian within FLEE_RADIUS (m) of a fight runs; past SAFE_RADIUS they stop and watch; once
 *  nothing is within CALM_RADIUS they head back 8-15 s later (CALM_MIN + up to CALM_SPREAD). */
export const FLEE_RADIUS = 25;
export const SAFE_RADIUS = 36, CALM_RADIUS = 40, CALM_MIN = 8, CALM_SPREAD = 7;
/** Running pace (m/s) and how fast it is reached or shed (m/s^2): eased, never a jump. */
export const RUN_PACE = 3.1;
const RUN_ACCEL = 3.2;
/** A swing or shot this close to a civilian (m) is an assault. */
export const ASSAULT_RADIUS = 2.5;
/** Open pavement is checked this far ahead of a runner (m), so they turn before a wall or the kerb. */
const LOOKAHEAD = 0.7;
/** Threats further than this from the eye are ignored (m). */
const THREAT_RANGE = 160;

/** The player's swing or shot (structurally rpg/types.ts PlayerAttack). */
export interface PerceivedAttack { x: number; z: number; yaw: number; reach: number; ranged: boolean }
/** How someone is running: heading (a unit vector) and speed (m/s). */
export interface FleeMotion { dirX: number; dirZ: number; speed: number }
/** A walker's flight from a fight: where it was, how they run, when they head back (shared clock;
 *  Infinity while the fight is near), and the trail they ran (points about 1 m apart, at most
 *  MAX_FLEE_TRAIL) that they walk back along to the spot they left their route. */
export interface Panic extends FleeMotion { fromX: number; fromZ: number; calmAt: number; trail: Point[]; returning: boolean }
export const MAX_FLEE_TRAIL = 48;

const threatDistances: number[] = [];
/** The perceived threats near `eye`, nearest first, at most MAX_PERCEIVED_THREATS, into `out`. */
export function perceivedThreats(perception: PopulationPerception | undefined, eye: Point, out: PerceivedThreat[]): PerceivedThreat[] {
  out.length = 0; threatDistances.length = 0;
  for (const threat of perception?.threats ?? []) {
    if (!Number.isFinite(threat.x) || !Number.isFinite(threat.z)) continue;
    const distance = (threat.x - eye.x) ** 2 + (threat.z - eye.z) ** 2;
    if (distance > THREAT_RANGE ** 2) continue;
    let index = out.length;
    while (index > 0 && threatDistances[index - 1] > distance) index--;
    if (index >= MAX_PERCEIVED_THREATS) continue;
    out.splice(index, 0, { x: threat.x, z: threat.z }); threatDistances.splice(index, 0, distance);
    if (out.length > MAX_PERCEIVED_THREATS) { out.pop(); threatDistances.pop(); }
  }
  return out;
}

/** Index of the threat nearest (x, z), or -1. */
export function nearestThreat(threats: readonly PerceivedThreat[], x: number, z: number): number {
  let best = -1, bestDistance = Infinity;
  for (let index = 0; index < threats.length; index++) {
    const distance = (threats[index].x - x) ** 2 + (threats[index].z - z) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  }
  return best;
}

function openAhead(world: Pick<CityWorld, "canOccupy">, at: Point, dirX: number, dirZ: number, step: number): boolean {
  return citizenPavement(world, at.x + dirX * step, at.z + dirZ * step) && citizenPavement(world, at.x + dirX * (step + LOOKAHEAD), at.z + dirZ * (step + LOOKAHEAD));
}

/**
 * One running step away from (fromX, fromZ) along open pavement: the speed eases up to RUN_PACE,
 * the heading is kept while it stays open and does not lead back toward the fight, else the most
 * "away" of the pavement's axes (or straight away, on open ground) is taken. Returns false, standing
 * still, when boxed in (a corner with the fight on both open sides).
 */
export function fleeStep(world: Pick<CityWorld, "canOccupy">, person: Pick<Citizen, "x" | "z" | "yaw" | "moving">, motion: FleeMotion, fromX: number, fromZ: number, span: number): boolean {
  let awayX = person.x - fromX, awayZ = person.z - fromZ;
  const length = Math.sqrt(awayX * awayX + awayZ * awayZ);
  if (length > 0.01) { awayX /= length; awayZ /= length; }
  else if (motion.dirX || motion.dirZ) { awayX = motion.dirX; awayZ = motion.dirZ; }
  else { awayX = Math.sin(person.yaw); awayZ = -Math.cos(person.yaw); }
  motion.speed = Math.min(RUN_PACE, motion.speed + RUN_ACCEL * span);
  const step = motion.speed * span;
  if (!((motion.dirX || motion.dirZ) && motion.dirX * awayX + motion.dirZ * awayZ > -0.1 && openAhead(world, person, motion.dirX, motion.dirZ, step))) {
    let best = -0.35, bestX = 0, bestZ = 0;
    for (let k = 0; k < 5; k++) {
      const candidateX = k === 4 ? awayX : k === 0 ? 1 : k === 1 ? -1 : 0, candidateZ = k === 4 ? awayZ : k === 2 ? 1 : k === 3 ? -1 : 0;
      const score = candidateX * awayX + candidateZ * awayZ;
      if (score > best && openAhead(world, person, candidateX, candidateZ, step)) { best = score; bestX = candidateX; bestZ = candidateZ; }
    }
    if (!bestX && !bestZ) { motion.speed = 0; person.moving = false; return false; }
    motion.dirX = bestX; motion.dirZ = bestZ;
  }
  person.x += motion.dirX * step; person.z += motion.dirZ * step;
  person.yaw = Math.atan2(motion.dirX, -motion.dirZ); person.moving = true;
  return true;
}

/** Sheds speed along the current heading (still on open pavement) until standing. */
export function easeStop(world: Pick<CityWorld, "canOccupy">, person: Pick<Citizen, "x" | "z" | "yaw" | "moving">, motion: FleeMotion, span: number): void {
  motion.speed = Math.max(0, motion.speed - RUN_ACCEL * span);
  const step = motion.speed * span;
  if (step > 0 && (motion.dirX || motion.dirZ) && openAhead(world, person, motion.dirX, motion.dirZ, step)) {
    person.x += motion.dirX * step; person.z += motion.dirZ * step; person.moving = true;
  } else { motion.speed = 0; person.moving = false; }
}

/** One step toward (x, z), the speed easing toward `pace`; true on arrival. */
export function stepBack(person: Pick<Citizen, "x" | "z" | "yaw" | "moving">, motion: FleeMotion, x: number, z: number, pace: number, span: number): boolean {
  const ease = RUN_ACCEL * span;
  motion.speed = Math.max(0.25, motion.speed + Math.max(-ease, Math.min(ease, pace - motion.speed)));
  const dx = x - person.x, dz = z - person.z, distance = Math.sqrt(dx * dx + dz * dz);
  if (distance < 0.01) { person.x = x; person.z = z; return true; }
  const step = Math.min(distance, motion.speed * span);
  person.x += dx / distance * step; person.z += dz / distance * step;
  person.yaw = Math.atan2(dx, -dz); person.moving = true;
  return step >= distance;
}

/** True when the swing or shot reaches the civilian at (x, z): a swing (or a point-blank shot) within
 *  ASSAULT_RADIUS in front of the attacker, or a shot whose line passes within 0.7 m of them inside the
 *  weapon's range with no fighter in front of them to take it. */
export function assaultReaches(attack: PerceivedAttack, x: number, z: number, threats: readonly PerceivedThreat[]): boolean {
  const dx = x - attack.x, dz = z - attack.z, forwardX = Math.sin(attack.yaw), forwardZ = -Math.cos(attack.yaw);
  const ahead = dx * forwardX + dz * forwardZ;
  if (ahead <= -0.3) return false;
  if (dx * dx + dz * dz <= ASSAULT_RADIUS ** 2) return true;
  if (!attack.ranged || ahead > Math.max(ASSAULT_RADIUS, attack.reach) || Math.abs(dx * forwardZ - dz * forwardX) > 0.7) return false;
  for (const threat of threats) {
    const tx = threat.x - attack.x, tz = threat.z - attack.z, along = tx * forwardX + tz * forwardZ;
    if (along > 0.3 && along < ahead && Math.abs(tx * forwardZ - tz * forwardX) < 1.2) return false;
  }
  return true;
}

const PANIC_LINES = ["Shots!", "Get down!", "Run!", "Move, move!"] as const;
const CRIME_LINES = ["He's attacking people!", "Somebody call CorpSec!", "Get away from him!"] as const;
const DISTRICT_PANIC = [
  ["Not my shift, not my fight!", "Into the yard, go!"],
  ["Not on the avenue! Not again!", "Somebody call CorpSec!"],
  ["Razors! Off the street!", "Phones away and run!"],
  ["Not in the gardens!", "Get behind the glasshouse!"],
  ["Mind the stalls! Run!", "Grab the kids!"],
  ["Razorbacks! Run!", "Up the steps, away from the river!"],
] as const;
const SCENE_LINES = [
  ["Shift's over and there's still a fight.", "Someone tell the Ember Core to send a medic."],
  ["CorpSec'll be here in an hour. Maybe.", "Right outside the good noodle place, too."],
  ["Razorbacks again.", "Don't touch anything. The Ghosts are watching."],
  ["Blood on the moss. Juniper will hate that.", "Not even the gardens are quiet now."],
  ["Bad for business, this.", "Sable will want to hear about this."],
  ["Razorbacks again.", "The river'll wash it off. It always does."],
] as const;

/** What someone shouts as they run: a general cry or a district one; a crime gets its own lines. */
export function panicBark(person: Pick<Citizen, "id" | "x" | "z">, crime: boolean, roll: number): string {
  const pick = (lines: readonly string[], salt: number): string => lines[Math.floor(randomFor(person.id, roll, salt) * lines.length) % lines.length];
  if (crime) return pick(CRIME_LINES, 64);
  return randomFor(person.id, roll, 63) < 0.5 ? pick(PANIC_LINES, 65) : pick(DISTRICT_PANIC[districtAt(person.x, person.z).id], 66);
}

/** A bystander's remark over the scene of a finished fight (district flavoured). */
export function sceneComment(person: Pick<Citizen, "id" | "x" | "z">, roll: number): string {
  if (randomFor(person.id, roll, 67) < 0.2) return randomFor(person.id, roll, 68) < 0.5 ? "Is it over?" : "Every week, this street.";
  const lines = SCENE_LINES[districtAt(person.x, person.z).id];
  return lines[Math.floor(randomFor(person.id, roll, 69) * lines.length) % lines.length];
}
