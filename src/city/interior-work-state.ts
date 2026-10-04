import type { FlagValue, QuestStatus } from "../rpg/types.ts";

export interface InteriorWorkReader {
  readonly flags: { get(key: string): FlagValue | undefined };
  status(questId: string): QuestStatus;
  stage(questId: string): string | null;
}

export interface InteriorWorkTag {
  readonly fixture: "counter" | "left-planter" | "right-planter" | "right-machine";
  readonly text: string;
  readonly compact: string;
  readonly settled: boolean;
  readonly detail: "ANON" | "DESK" | null;
}

export interface InteriorWorkState {
  readonly place: "glasshouse" | "kiln" | "dead-letter";
  readonly tags: readonly InteriorWorkTag[];
}

function tag(fixture: InteriorWorkTag["fixture"], text: string, settled: boolean, compact = text, detail: InteriorWorkTag["detail"] = null): InteriorWorkTag {
  return { fixture, text, compact, settled, detail };
}

export function interiorWorkState(placeId: string | null | undefined, quests: InteriorWorkReader): InteriorWorkState | null {
  const questId = placeId === "glasshouse" ? "a-little-night" : placeId === "kiln" ? "kiln-calibration" : placeId === "dead-letter" ? "last-good-signal" : null;
  if (!questId) return null;
  const status = quests.status(questId);
  if (status === "locked" || status === "failed") return null;
  const started = status !== "available";
  if (placeId === "glasshouse") {
    const left = started && quests.flags.get("a-little-night.left-tray") === "drain-left";
    const right = started && quests.flags.get("a-little-night.right-tray") === "seat-wick";
    const cycle = status === "complete" && quests.flags.get("glasshouse.nursery-tended") === true;
    return { place: placeId, tags: [tag("left-planter", left ? "OK" : "DRAIN", left, left ? "OK" : "DRN"), tag("right-planter", right ? "OK" : "WICK", right, right ? "OK" : "WCK"), tag("counter", cycle ? "16/8" : "DAY", cycle)] };
  }
  if (placeId === "kiln") {
    const earth = started && quests.flags.get("kiln-calibration.earth-bond") === "bond-earth";
    const supply = earth && quests.flags.get("kiln-calibration.aux-feed") === "aux-feed";
    const load = supply && quests.flags.get("kiln-calibration.test-load") === "dummy-load";
    const certified = status === "complete" && quests.flags.get("kiln.bench-certified") === true;
    const progress = load ? 3 : supply ? 2 : earth ? 1 : 0;
    return { place: placeId, tags: [tag("right-machine", certified ? "PASS" : progress === 3 ? "READY" : `${progress}/3`, certified)] };
  }
  const publication = status === "complete" ? quests.flags.get("dead-letter.publication") : undefined;
  const detail = publication === "anonymous" ? "ANON" : publication === "callback" ? "DESK" : null;
  const queued = status === "active" && quests.stage(questId) === "publish" && quests.flags.get("last-good-signal.venue-route") === "route-glasshouse";
  return { place: "dead-letter", tags: [tag("counter", detail ? "SENT" : queued ? "QUEUE" : "HOLD", detail !== null, undefined, detail)] };
}
