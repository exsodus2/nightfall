import { districtAt, randomFor, type CityWorld } from "./world.ts";
import { inPark } from "./park.ts";
import type { Citizen } from "./people.ts";

export interface PerceivedPlayer { id: string; x: number; y?: number; z: number; speed?: number }
export interface PopulationPerception { players: readonly PerceivedPlayer[]; rain?: boolean }
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
const NOTICE_RADIUS = 5.5;
const DISTRICT_BARKS = [
  ["Kiln Nine's still running. Follow the furnace glow.", "Foundry shift's over. Time to find something warm."],
  ["Undertone's taking requests tonight.", "The Neon Ward never did learn to sleep."],
  ["Dead Letter Exchange hears everything.", "Ghost Circuit's quieter than the signals suggest."],
  ["The Glasshouse is a good place to wait out rain.", "Take the park route. You can hear the leaves."],
  ["Blue Hour Tea keeps a light on for late arrivals.", "Silk Market's still open. Watch your change."],
  ["Second Life Salvage can fix almost anything.", "The Spillway has better company than its reputation."],
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

export function citizenBark(person: Pick<Citizen, "id" | "x" | "z" | "occupation">, encounters: number, yielding: boolean, rain: boolean): string {
  if (yielding) return person.occupation === "courier" ? "Easy. Fragile parcel coming through." : ["After you.", "Go ahead. I'll take the other side.", "Plenty of city for both of us."][Math.floor(randomFor(person.id, encounters, 41) * 3)];
  if (person.occupation === "courier") return "Another parcel, another corner. Stay dry.";
  if (rain && randomFor(person.id, encounters, 42) < 0.35) return "Better under an awning than out in this rain.";
  const lines = DISTRICT_BARKS[districtAt(person.x, person.z).id];
  return lines[Math.floor(randomFor(person.id, encounters, 43) * lines.length)];
}

export function citizenPavement(world: Pick<CityWorld, "canOccupy">, x: number, z: number): boolean {
  if (!world.canOccupy(x, z)) return false;
  if (inPark(x, z)) return true;
  const streetX = Math.round(x / 64) * 64, streetZ = Math.round(z / 64) * 64;
  return Math.abs(x - streetX) >= (streetX === 0 ? 13.5 : 6.85) && Math.abs(z - streetZ) >= 6.85;
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
    if (time < this.nextBarkAt || !yielding && person.id % 3 === 0) return;
    person.bark = citizenBark(person, memory.encounters, yielding, rain);
    person.barkUntil = time + 3.8;
    this.nextBarkAt = time + 2.8;
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
