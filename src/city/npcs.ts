import type { RGB } from "./world.ts";

/** Named characters who stand still at fixed places in the city. Pure data: the
 * quest book decides what they say, npc-scene.ts decides how they look. */
export type NpcIdle = "sway" | "scan" | "swing" | "breathe";
export interface NpcLook {
  coat: RGB; trim: RGB; skin: RGB;
  /** Emissive accent: coat seam, visor, lantern, umbrella rim and the ring at their feet. */
  light: RGB;
  /** "mask": a welding mask pushed up over the brow (Foundry street casting). */
  headwear: "hood" | "visor" | "cap" | "bare" | "mask";
  /** Left-hand props; "bag" (a shopping bag) and "tool" (a rake) are street casting. */
  prop: "case" | "antenna" | "lantern" | "umbrella" | "bag" | "tool" | null;
  idle: NpcIdle;
  /** A lit implant at the temple (Ghost Circuit street casting). */
  implant?: boolean;
}
/** What an NPC says about one quest, keyed by where the player is in it. Every key is
 * optional; the quest book falls back to the quest definition's own text. */
export interface NpcQuestLines {
  /** Giver, quest available. */ offer?: string[];
  /** Giver, immediately after accepting. */ accepted?: string[];
  /** Giver, quest under way but not ready. */ reminder?: string[];
  /** Giver, every step done. */ turnIn?: string[];
  /** Giver, on completion and whenever spoken to afterwards. */ thanks?: string[];
  /** Step target, the player arrives for this NPC's step. */ step?: string[];
  /** Step target, right after the step is done. */ handover?: string[];
  /** Step target, spoken to again once the step is done. */ after?: string[];
}
export interface NpcDefinition {
  id: string;
  name: string;
  title: string;
  district: number;
  x: number;
  z: number;
  /** Heading while idle, in the engine's yaw convention (0 faces −z / north). */
  facing: number;
  look: NpcLook;
  /** Small talk when no quest has anything to say. */
  greeting: string[];
  quests?: Readonly<Record<string, NpcQuestLines>>;
}

export const TALK_RANGE = 3;

// Every position is a walkable pavement or plaza cell (tests assert world.canOccupy).
export const NPCS: readonly NpcDefinition[] = [
  {
    id: "mara", name: "Mara Voss", title: "Data broker", district: 4, x: 18, z: 55, facing: -2.2,
    look: { coat: [196, 58, 128], trim: [52, 30, 58], skin: [189, 158, 129], light: [255, 92, 196], headwear: "hood", prop: "case", idle: "sway" },
    greeting: ["Slow night. Half the stalls are shut and the other half are selling the same stolen drives."],
    quests: {
      "relay-chip": {
        offer: [
          "You're not wearing a corp badge. Good. I need legs, not questions.",
          "A courier left a relay chip for me with Juno Reyes, under the Meridian Spire in Neon Ward. I can't be seen up there.",
          "Bring it back unopened and I'll pay 250 credits.",
        ],
        accepted: ["Juno waits on the avenue at the foot of the spire. Head north. Don't plug the chip into anything."],
        reminder: ["Juno Reyes, at the foot of the Meridian Spire. North up the avenue into Neon Ward. Look for the antenna."],
        turnIn: ["You're back, and the seal's intact. Good.", "Hand it over and we're square."],
        thanks: ["Seal's intact and you didn't ask what's on it. Come back when you want better-paid work."],
      },
    },
  },
  {
    id: "juno", name: "Juno Reyes", title: "Signal runner", district: 1, x: 16, z: -139.5, facing: 2.6,
    look: { coat: [46, 150, 224], trim: [24, 38, 64], skin: [128, 96, 76], light: [96, 240, 255], headwear: "visor", prop: "antenna", idle: "scan" },
    greeting: ["Ninety ad feeds on this block and one of them carries Mara's traffic. I'm on shift until it stops."],
    quests: {
      "relay-chip": {
        step: ["Mara sent you? Took her long enough.", "Here. Sealed, like she likes it. Whatever's on this, I never saw it."],
        handover: ["Back to Mara in the Silk Market. If anyone in a visor asks, you're delivering noodles."],
        after: ["I already gave you the chip. Mara's waiting in the Silk Market."],
      },
    },
  },
  {
    id: "tomas", name: "Tomas Okafor", title: "Furnace keeper", district: 0, x: -498, z: -266, facing: 0.5,
    look: { coat: [214, 118, 44], trim: [70, 46, 30], skin: [104, 76, 60], light: [255, 176, 72], headwear: "cap", prop: "lantern", idle: "swing" },
    greeting: ["Forty years on the Ember Core's coolant valves.", "The board says it's automated now. The board can't hear a seal starting to whistle. I can."],
  },
  {
    id: "wren", name: "Sister Wren", title: "Seed keeper", district: 3, x: -494, z: 272, facing: 0.8,
    look: { coat: [88, 176, 118], trim: [34, 60, 44], skin: [196, 170, 146], light: [150, 255, 190], headwear: "bare", prop: "umbrella", idle: "breathe" },
    greeting: ["The Last Tree's roots crack the plaza a little more every year. The council paves it; I unpave it.", "Mind the seed trays. Rain's the only thing that waters them for free."],
  },
];

export function npcById(npcs: readonly NpcDefinition[], id: string): NpcDefinition | undefined {
  return npcs.find(npc => npc.id === id);
}

/** Closest NPC within range of a ground position, or null. */
export function nearestNpc(npcs: readonly NpcDefinition[], x: number, z: number, range = TALK_RANGE): { npc: NpcDefinition; distance: number } | null {
  let best: { npc: NpcDefinition; distance: number } | null = null;
  for (const npc of npcs) {
    const distance = Math.hypot(npc.x - x, npc.z - z);
    if (distance < range && (!best || distance < best.distance)) best = { npc, distance };
  }
  return best;
}
