// Shared contracts for the action-RPG layer. Every rpg/ subsystem codes against these types; the
// engine (src/city/engine.ts) talks to the layer only through RpgSession (src/rpg/session.ts).
// Pure types: no DOM, no textmode, no runtime state. Keep additions backward compatible - several
// modules and the content packs depend on them.
//
// Ownership (one directory per system; talk to other systems through these types and the bus):
//   rpg/items/    item database, Character (inventory, equipment, credits, xp/level, reputation), loot, vendors
//   rpg/combat/   player combat, enemy AI and perception, hit detection, encounters
//   rpg/quests/   quest + dialogue runtime, flags, conditions/effects, the QuestBook adapter
//   rpg/scene/    drawing enemies, the first-person weapon, loot, combat VFX, damage numbers
//   rpg/content/  data only: NPCs, dialogues, quests, encounters, areas, loot tables, items
//   components/rpg/  React HUD + inventory/character screens
//   rpg/session.ts, rpg/events.ts, rpg/types.ts, engine wiring: the lead

import type { NpcLook } from "../city/npcs.ts";

// ---- Basics ---------------------------------------------------------------------------------

export interface Point { x: number; z: number }
/** A circular trigger area on the ground. */
export interface Area extends Point { radius: number; label?: string }
export type FlagValue = boolean | number | string;
export type FactionId = "player" | "civilian" | "razorbacks" | "chrome-saints" | "corpsec" | "ghosts" | (string & {});

// ---- Events: the glue between systems -------------------------------------------------------
// Systems never call each other's internals to report what happened; they emit an event. The
// quest runtime listens to all of them to advance objectives.

export type GameEvent =
  | { type: "talked"; npc: string }
  | { type: "dialogueChoice"; npc: string; dialogue: string; node: string; option: string }
  | { type: "killed"; enemy: string; archetype: string; faction: FactionId; tags: readonly string[]; encounter: string | null; x: number; z: number; byPlayer: boolean }
  | { type: "damaged"; target: string; amount: number; source: string; x: number; z: number; critical: boolean }
  | { type: "itemAdded"; item: string; count: number }
  | { type: "itemRemoved"; item: string; count: number }
  | { type: "itemUsed"; item: string }
  | { type: "entered"; area: string }
  | { type: "left"; area: string }
  | { type: "interacted"; object: string }
  | { type: "encounterCleared"; encounter: string }
  | { type: "playerDied" }
  | { type: "flag"; key: string; value: FlagValue }
  | { type: "questUpdated"; quest: string; stage: string; status: QuestStatus }
  | { type: "message"; text: string; tone?: "info" | "quest" | "loot" | "danger" };
export type GameEventType = GameEvent["type"];
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

// ---- Items ----------------------------------------------------------------------------------

export type ItemKind = "melee" | "ranged" | "armor" | "consumable" | "ammo" | "mod" | "quest" | "junk";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type WeaponClass = "blade" | "blunt" | "baton" | "pistol" | "smg" | "shotgun" | "rifle";
export interface WeaponStats {
  class: WeaponClass;
  /** Damage per hit (per pellet for shotguns). */
  damage: number;
  /** Metres: melee reach, or ranged effective range (damage falls off beyond it). */
  range: number;
  /** Seconds between attacks. */
  cooldown: number;
  staminaCost: number;
  /** Melee: charged/heavy attack multiplier. */
  heavyMultiplier?: number;
  /** Melee: arc half-angle in degrees. */
  arc?: number;
  magazine?: number;
  ammo?: string;
  reload?: number;
  /** Radians of random spread (hip fire); aiming halves it. */
  spread?: number;
  pellets?: number;
  /** Metres of push-back on hit, and seconds of stagger. */
  knockback: number;
  stagger: number;
  /** Chance 0..1 and multiplier of a critical hit. */
  critChance?: number;
  critMultiplier?: number;
  /** Rounds per second for automatic fire while held (0 = semi). */
  automatic?: number;
}
export interface ArmorStats { slot: "body" | "head"; protection: number }
export interface ConsumableStats { heal?: number; stamina?: number; /** seconds of the effect */ duration?: number; effect?: "regen" | "focus" | "haste" | "shield" }
export interface ItemDefinition {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  /** One printable ASCII character: the item's icon in lists, on the ground and on the HUD. */
  glyph: string;
  /** Optional multi-line ASCII art (printable ASCII only, <= 24 x 8) for the inspect panel. */
  art?: readonly string[];
  description: string;
  /** Credits (vendors buy at ~40%). */
  value: number;
  weight: number;
  /** Max per stack (1 = unstackable). */
  stack: number;
  weapon?: WeaponStats;
  armor?: ArmorStats;
  consumable?: ConsumableStats;
  tags?: readonly string[];
}
export interface ItemStack { item: string; count: number }
export type EquipSlot = "melee" | "sidearm" | "primary" | "body" | "head" | "quick1" | "quick2";
/** Which weapon is in the player's hands. */
export type WeaponSlot = "melee" | "sidearm" | "primary" | "unarmed";

export interface LootEntry { item: string; weight: number; min?: number; max?: number }
export interface LootTable { id: string; rolls: number; /** chance 0..1 of rolling nothing per roll */ empty?: number; entries: readonly LootEntry[]; credits?: [number, number]; /** Other table ids rolled in addition (e.g. a boss's guaranteed prize table). Entry items may also be "table:<id>" or "pool:<rarity>[:<kind|class|weapon|gear>]" (see rpg/items/loot.ts). */ also?: readonly string[] }

/** Serializable character sheet (rpg/items owns the Character class that wraps it). */
export interface CharacterState {
  credits: number;
  xp: number;
  level: number;
  inventory: ItemStack[];
  equipped: Partial<Record<EquipSlot, string>>;
  /** Rounds loaded per weapon item id. */
  loaded: Record<string, number>;
  reputation: Record<string, number>;
}

// ---- Combat ---------------------------------------------------------------------------------

export interface EnemyArchetype {
  id: string;
  name: string;
  faction: FactionId;
  health: number;
  armor: number;
  /** m/s walking and running. */
  speed: { walk: number; run: number };
  /** Item id of the weapon it uses (its stats drive the AI's attacks). */
  weapon: string;
  /** Seconds of reaction delay before first attacking after spotting the player. */
  reaction: number;
  /** 0..1: how readily it closes in vs keeps distance / flees at low health. */
  aggression: number;
  perception: { sight: number; fovDegrees: number; hearing: number };
  look: NpcLook;
  loot: string;
  xp: number;
  tags?: readonly string[];
  /** Short barks shown over the enemy (ASCII only). */
  barks?: { alert?: readonly string[]; hurt?: readonly string[]; death?: readonly string[] };
  /** Physical size multiplier (bosses are bigger); default 1. */
  scale?: number;
  /** Boss behaviour: phases trigger as health falls; each can telegraph a signature attack. */
  boss?: { title: string; phases: readonly BossPhase[] };
}
export interface BossPhase {
  /** Enters this phase at or below this health fraction (first phase: 1). */
  atHealth: number;
  message?: string;
  /** Encounter id of reinforcements spawned on entering the phase. */
  spawn?: string;
  speedMultiplier?: number;
  damageMultiplier?: number;
  /** Telegraphed signature attacks used in this phase (the AI cycles them). Each is dodgeable. */
  attacks: readonly ("slam" | "sweep" | "barrage" | "charge" | "summon" | "shockwave")[];
}
/** A group of enemies placed by content, started by a quest effect or present in the world. */
export interface EncounterDefinition {
  id: string;
  label: string;
  /** Where the group stands and fights; members spawn around it. */
  area: Area;
  members: readonly { archetype: string; x: number; z: number; yaw?: number; patrol?: readonly Point[]; tag?: string }[];
  /** Spawned at start (roaming gangs) or only when a quest effect spawns it. */
  auto?: boolean;
  /** Respawn delay in seconds after being cleared (roaming encounters); omit for one-shot. */
  respawn?: number;
  /** Starts hostile, or only if provoked (attacked, or a flag/dialogue turns them). */
  hostile: boolean;
}
export type EnemyState = "idle" | "patrol" | "suspicious" | "alert" | "chase" | "attack" | "reposition" | "flee" | "stagger" | "dead";
/** What rendering and the HUD need to know about one enemy each frame. */
export interface EnemyView {
  id: string;
  archetype: string;
  name: string;
  faction: FactionId;
  x: number; z: number; yaw: number;
  health: number; maxHealth: number;
  state: EnemyState;
  /** 0..1 progress of the current attack wind-up / swing / shot, for animation. */
  attack: number;
  /** Seconds since last hit (for hit flashes); Infinity if never. */
  hitAge: number;
  /** Seconds since death (for the dissolve); -1 while alive. */
  deathAge: number;
  weaponClass: WeaponClass;
  look: NpcLook;
  bark: string | null;
  hostile: boolean;
  /** True during an attack's wind-up (the telegraph): draw the warning glyph. */
  windup?: boolean;
  /** Current attack: "melee", "ranged" or a boss signature ("slam", "charge", ...). */
  attackKind?: string | null;
  /** The player's soft lock-on target. */
  locked?: boolean;
  /** Parried / stunned: hits on it are guaranteed crits (draw a vulnerable marker). */
  vulnerable?: boolean;
  boss?: boolean;
  /** Physical size multiplier (EnemyArchetype.scale). */
  scale?: number;
}
/** The player's combat state for the HUD and the first-person weapon. */
export interface PlayerCombatView {
  health: number; maxHealth: number;
  stamina: number; maxStamina: number;
  weapon: WeaponSlot;
  weaponItem: string | null;
  weaponClass: WeaponClass | "fists";
  /** Rounds in the magazine and in reserve (ranged only). */
  ammo: { loaded: number; reserve: number } | null;
  action: "idle" | "light" | "heavy" | "block" | "dodge" | "reload" | "aim" | "fire" | "hurt" | "dead";
  /** 0..1 progress of the current action, for animation. */
  actionProgress: number;
  /** Seconds since the player last landed a hit / took a hit. */
  hitConfirmAge: number;
  hurtAge: number;
  /** Direction (radians, world yaw) of the last damage source for the HUD indicator. */
  hurtFrom: number | null;
  inCombat: boolean;
  dead: boolean;
  /** 0..1 aim-down-sights blend (ranged, alt held). */
  aim?: number;
  /** Current shot spread in radians (crosshair size). */
  spread?: number;
  /** Multiplier the engine applies to walking speed (aiming, blocking, charging, haste). */
  moveScale?: number;
  /** Soft lock-on target id (see CombatWorld.lockTarget). */
  lock?: string | null;
  /** Melee combo step 0..2 of the current / last swing. */
  combo?: number;
  /** 0..1 heavy-attack charge while the attack button is held. */
  charge?: number;
  blocking?: boolean;
  /** Dodge i-frames active. */
  invulnerable?: boolean;
  /** Remaining shield points from a shield consumable. */
  shield?: number;
  /** Active consumable effects. */
  buffs?: readonly { effect: "regen" | "focus" | "haste" | "shield"; remaining: number }[];
}
/** Short-lived world-space combat effects for rendering (tracers, sparks, damage numbers).
 * Every `y` is height above the ground in metres, up positive (textmode draws it at -y). */
export type CombatEffect =
  | { kind: "tracer"; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; age: number; enemy: boolean }
  | { kind: "spark"; x: number; y: number; z: number; age: number; color: readonly [number, number, number] }
  | { kind: "slash"; x: number; y: number; z: number; yaw: number; age: number; heavy: boolean }
  | { kind: "number"; x: number; y: number; z: number; value: number; critical: boolean; age: number; toPlayer: boolean }
  | { kind: "muzzle"; x: number; y: number; z: number; age: number; enemy: boolean }
  /** Ground warning for a telegraphed (boss) attack, drawn flat on the ground. `progress` runs
   * 0..1 to the impact. circle: radius around (x, z). arc: `radius` reach, `arc` half-angle
   * (radians) around `yaw`. line: from (x, z) along `yaw`, `radius` long, `width` wide. ring: an
   * expanding shockwave of `radius` now and `width` thickness (progress = radius / max). */
  | { kind: "telegraph"; shape: "circle" | "arc" | "line" | "ring"; x: number; z: number; yaw: number; radius: number; width: number; arc: number; progress: number; age: number; enemy: string }
  /** A slow, dodgeable projectile (boss barrage); y is height above the ground. */
  | { kind: "projectile"; id: number; x: number; y: number; z: number; vx: number; vz: number; radius: number; age: number; enemy: boolean };

/** What combat needs from the character sheet (rpg/items/Character implements it). */
export interface CombatCharacter {
  weaponFor(slot: WeaponSlot): ItemDefinition | null;
  /** Rounds loaded in a weapon / held in reserve for an ammo item. */
  loaded(weaponItem: string): number;
  reserve(ammoItem: string): number;
  /** Moves rounds from reserve into the magazine; returns rounds loaded. */
  reload(weaponItem: string): number;
  spendRound(weaponItem: string): boolean;
  /** Uses the consumable in a quick slot; returns its stats, or null if empty. */
  useQuick(slot: 1 | 2): ConsumableStats | null;
  readonly maxHealth: number;
  readonly maxStamina: number;
  /** Damage reduction 0..0.8 from armour. */
  readonly protection: number;
  /** Outgoing damage multiplier from level/mods. */
  readonly damageBonus: number;
}

/** A dropped item lying in the world (rpg/items WorldLoot). */
export interface GroundLootView { id: string; x: number; z: number; item: string; name: string; glyph: string; rarity: Rarity; count: number; age: number }

// ---- Quests & dialogue -----------------------------------------------------------------------

export type QuestStatus = "locked" | "available" | "active" | "complete" | "failed";

export type Condition =
  | { flag: string; is?: FlagValue; atLeast?: number; atMost?: number }
  | { quest: string; status?: QuestStatus | readonly QuestStatus[]; stage?: string; outcome?: string }
  | { item: string; count?: number }
  | { credits: number }
  | { level: number }
  | { rep: FactionId; atLeast?: number; atMost?: number }
  | { encounterCleared: string }
  | { all: readonly Condition[] }
  | { any: readonly Condition[] }
  | { not: Condition };

export type Effect =
  | { setFlag: string; value?: FlagValue }
  | { addFlag: string; by: number }
  | { give: string; count?: number }
  | { take: string; count?: number }
  | { credits: number }
  | { xp: number }
  | { rep: FactionId; by: number }
  | { startQuest: string }
  | { stage: string }
  | { outcome: string }
  | { fail: string }
  | { spawn: string }
  | { despawn: string }
  | { hostile: string; value: boolean }
  | { waypoint: Point & { label: string } }
  | { message: string; tone?: "info" | "quest" | "loot" | "danger" }
  | { openDialogue: string; node?: string };

export type Objective = { id: string; text: string; optional?: boolean; hidden?: boolean; /** where the tracker/beacon points */ target?: Point } & (
  | { kind: "talk"; npc: string }
  | { kind: "kill"; count: number; archetype?: string; faction?: FactionId; tag?: string; encounter?: string }
  | { kind: "clear"; encounter: string }
  | { kind: "collect"; item: string; count: number }
  | { kind: "deliver"; item: string; count: number; npc: string }
  | { kind: "reach"; area: Area }
  | { kind: "visit"; area: string }
  | { kind: "interact"; object: string }
  | { kind: "survive"; seconds: number; area?: Area }
  | { kind: "choose"; dialogue: string; options: readonly string[] }
  | { kind: "condition"; condition: Condition }
);

export interface QuestStage {
  id: string;
  /** Journal text for this stage (shown in the quest log). */
  journal: string;
  objectives: readonly Objective[];
  /** "all" (default): every non-optional objective; "any": the first finished one wins. */
  mode?: "all" | "any";
  onEnter?: readonly Effect[];
  onComplete?: readonly Effect[];
  /** Next stage: a fixed id, or the first branch whose condition holds; omit for the quest's end (use an `outcome` effect). */
  next?: string | readonly { if?: Condition; stage: string }[];
  /** Fails the quest when it holds (e.g. an NPC you had to protect died). */
  failIf?: Condition;
  /** Seconds allowed for the stage; running out fails the quest (or jumps to `onTimeout`). */
  timeLimit?: number;
  onTimeout?: string;
  /** Fails the quest (or jumps to `onTimeout`) if the player dies during this stage. */
  failOnDeath?: boolean;
}
export interface QuestOutcome { title: string; journal: string; effects?: readonly Effect[] }
export interface QuestDefinition2 {
  id: string;
  title: string;
  category: "story" | "side" | "contract" | "gig";
  /** The NPC who offers it (null: started by an effect or by entering an area). */
  giver: string | null;
  summary: string;
  requires?: Condition;
  /** Shown before accepting: "~400 cr, +Razorback reputation", etc. */
  rewardHint?: string;
  recommendedLevel?: number;
  start: string;
  stages: readonly QuestStage[];
  outcomes: Readonly<Record<string, QuestOutcome>>;
  /** Auto-start when entering this area (for discoverable gigs). */
  trigger?: Area;
  /** MMO-style contract: offered again `cooldown` game seconds after it completes or fails. */
  repeatable?: { cooldown: number };
  /** Effects applied when the quest fails (failIf, timeout, `fail` effect, death). */
  onFail?: readonly Effect[];
}

export interface DialogueOptionDef {
  id: string;
  label: string;
  condition?: Condition;
  /** Hidden when the condition fails (default: shown disabled with the reason). */
  hideIfUnavailable?: boolean;
  effects?: readonly Effect[];
  /** Next node, or null to end the conversation. */
  next: string | null;
  /** A stat check: success/failure jump to different nodes. Deterministic: passes when the stat
   * plus every applicable bonus reaches `difficulty` (the label shows both numbers up front). */
  check?: { stat: "cool" | "tech" | "street"; difficulty: number; success: string; failure: string; bonus?: readonly { if: Condition; by: number; label?: string }[] };
  /** UI styling of the option (inferred from its effects when omitted). */
  kind?: "accept" | "decline" | "complete" | "continue" | "leave";
  /** Disabled-reason text shown instead of the generated one when `condition` fails. */
  reason?: string;
}
export interface DialogueNode { id: string; lines: readonly string[]; options: readonly DialogueOptionDef[]; effects?: readonly Effect[] }
export interface DialogueDefinition {
  id: string;
  npc: string;
  /** Quest whose unqualified `stage` / `outcome` effects this dialogue drives. */
  quest?: string;
  /** Entry points, tried in order; the first whose condition holds opens the conversation.
   * Across an NPC's dialogues, conditional entries win over unconditional ones, then higher `priority`. */
  entries: readonly { condition?: Condition; node: string; priority?: number }[];
  nodes: readonly DialogueNode[];
}

/** World objects the player can interact with (E): terminals, crates, doors, bodies, graffiti. */
export interface InteractableDefinition extends Point {
  id: string;
  label: string;
  place?: string;
  /** Height of the prompt/marker (m). */
  y?: number;
  glyph?: string;
  condition?: Condition;
  effects?: readonly Effect[];
  /** Opens a dialogue instead of (or before) the effects. */
  dialogue?: string;
  once?: boolean;
}

/** A bundle of content (rpg/content/*): merged at start-up. */
export interface ContentPack {
  id: string;
  npcs?: readonly import("../city/npcs.ts").NpcDefinition[];
  items?: readonly ItemDefinition[];
  loot?: readonly LootTable[];
  archetypes?: readonly EnemyArchetype[];
  encounters?: readonly EncounterDefinition[];
  quests?: readonly QuestDefinition2[];
  dialogues?: readonly DialogueDefinition[];
  interactables?: readonly InteractableDefinition[];
  /** Named areas referenced by `entered`/`left` events. */
  areas?: readonly (Area & { id: string })[];
  /** Vendors: an NPC id with stock (item ids) and a price multiplier. */
  vendors?: readonly { npc: string; stock: readonly string[]; markup?: number }[];
}

// ---- Input & frame context -------------------------------------------------------------------

/** Per-frame input, already mapped from keys/mouse/touch by the engine. "Pressed" = this frame. */
export interface RpgInput {
  attackHeld: boolean; attackPressed: boolean; attackReleased: boolean;
  /** Right mouse: aim (ranged) / block (melee). */
  altHeld: boolean;
  dodgePressed: boolean;
  reloadPressed: boolean;
  /** 1, 2, 3 select melee / sidearm / primary; 4 holsters. */
  selectSlot: WeaponSlot | null;
  quickUse: 1 | 2 | null;
  interactPressed: boolean;
  /** Movement intent (-1..1) in the player's frame, for dodge direction. */
  forward: number; strafe: number;
}
export interface RpgFrame {
  dt: number;
  time: number;
  player: { x: number; z: number; eye: number; yaw: number; pitch: number; mode: string; onFoot: boolean; place?: string };
  input: RpgInput;
}

/** What quests/dialogue effects may do to the rest of the game (the session implements it). */
export interface QuestHost {
  give(item: string, count: number): void;
  take(item: string, count: number): boolean;
  count(item: string): number;
  credits(delta: number): void;
  readonly creditBalance: number;
  xp(amount: number): void;
  readonly level: number;
  rep(faction: FactionId, delta: number): void;
  reputation(faction: FactionId): number;
  /** Dialogue stat checks. */
  stat(name: "cool" | "tech" | "street"): number;
  spawnEncounter(id: string): void;
  despawnEncounter(id: string): void;
  setHostile(encounter: string, hostile: boolean): void;
  encounterCleared(id: string): boolean;
  setWaypoint(point: (Point & { label: string }) | null): void;
  message(text: string, tone?: "info" | "quest" | "loot" | "danger"): void;
}

// ---- UI contract --------------------------------------------------------------------------------

export interface RpgSnapshot {
  character: CharacterState & { maxHealth: number; maxStamina: number; protection: number; xpToNext: number; stats: { cool: number; tech: number; street: number }; carry: { weight: number; capacity: number } };
  combat: PlayerCombatView;
  /** Item definitions for everything the UI may show (inventory, equipment, vendor stock). */
  items: Readonly<Record<string, ItemDefinition>>;
  /** Open vendor screen, if any. */
  vendor: { npc: string; name: string; stock: readonly { item: string; price: number }[]; sellRate: number } | null;
  /** Nearest pickup / interactable prompt. */
  prompt: string | null;
  boss: { name: string; title: string; health: number; maxHealth: number; phase: number; /** Number of phases (for the HUD's phase pips; rpg/scene). */ phases?: number } | null;
  /** Recent loot and quest messages (newest last). */
  feed: readonly { id: number; text: string; tone: "info" | "quest" | "loot" | "danger" }[];
}
export type RpgUiAction =
  | { kind: "trackQuest"; quest: string }
  | { kind: "equip"; item: string }
  | { kind: "unequip"; slot: EquipSlot }
  | { kind: "use"; item: string }
  | { kind: "drop"; item: string; count: number }
  | { kind: "assignQuick"; item: string; slot: 1 | 2 }
  | { kind: "buy"; item: string }
  | { kind: "sell"; item: string; count: number }
  | { kind: "closeVendor" }
  | { kind: "respawn" };
