import { textmode, type Textmodifier, type TextmodeShader, type TextmodeFramebuffer, type TextmodeTileset } from "textmode.js";
import { FiltersPlugin } from "textmode.filters.js";
import { SynthPlugin, osc, plasma, solid } from "textmode.synth.js";
import { CITY_MATERIAL, GROUND_MATERIAL, HOLOGRAM_MATERIAL, REFERENCE_MATERIAL, CLARITY_FILTER, GLYPH_TABLE, SURFACES, cityMaterial } from "./materials.ts";
// Mobile: render profiles, adaptive quality and device class (quality-governor.ts, device.ts).
import { QualityGovernor, desktopProfile, renderProfile, DESKTOP_LEVELS, type QualityPreset, type RenderProfile } from "./quality-governor.ts";
import { isTouchFirst, isWebKit } from "./device.ts";
import { createFrameLoop } from "./frame-pacing.ts";
import { rotationWarp, VIEW_WARP_FILTER } from "./view-warp.ts";
import { buildCityAtlas, ASCII_COUNT, FIRST_ASCII, thinKey } from "./atlas.ts";
import { ASCII_BITMAPS } from "./glyph-font.ts";
import { MESSAGES } from "./messages.ts";
import { BLOCK_SIZE, CityWorld, LANDMARKS, SPAWN, WORLD_EDGE, districtAt, movePlayer, nearestStreetLamps, type Block, type Building, type Landmark, type Player, type RGB } from "./world.ts";
import { drawActivity, cuboid as box, propAlpha, propRange } from "./activity.ts";
import { advanceJourney, createJourney, DOOR_FADE_SECONDS, doorReveal, journeyLookHeading, MouseLook, safeLanding, stepRideTurn, WALK_HEIGHT, type Journey, type RideMode, type RideTurn, type TravelMode } from "./locomotion.ts";
import { drawLetterPanel, drawShop, signFaces } from "./signage.ts";
import { LANDMARK_LABEL_RANGE, visibleLandmarkLabels } from "./landmarks-scene.ts"; // Agent D: landmark titles
import { drawSights } from "./sights-scene.ts"; // Edge sights (LANDMARK agent): ship, barrier, cableway beyond the Rim Roads
import { fullyHidden, visibleFrom } from "./visibility.ts";
import { SceneData, TextData } from "./scene-data.ts";
import { BuildingBatch, BUILDING_VERTEX, BUILDING_MATERIAL, FACADE_MATERIAL, type BatchCamera, type BatchFrame, type BuildingChunk } from "./building-batch.ts";
import { PropBatch, PROP_VERTEX } from "./prop-batch.ts";
import { PropRecorder, SignCanvas, type PropCanvas } from "./prop-canvas.ts";
import { drawBuilding } from "./architecture.ts";
import { CityPopulation, type PopulationStats } from "./people.ts";
import { CityTraffic } from "./traffic.ts";
import { ROAD_AWARENESS_RADIUS } from "./road-awareness.ts";
import { ViewCone, VisibilityCache, nearestCars } from "./frame-cache.ts";
import { SCENE_VIEWS, type InspectionCommand } from "./inspection.ts";
import { drawMetroScene } from "./metro-scene.ts";
// Monorail seats: SEATS … windowYaw sit the passenger on a free bench seat, looking out of the window.
import { STATIONS, TRAIN_COUNT, TRAIN_EYE_HEIGHT, boardingTrain, floorHeight, doorAt, localToWorld, worldToLocal, trainAt, stationArrival, moveInTrain, SEATS, SEAT_LOOK, clampSeatedLook, nearestFreeSeat, seatStand, seatTurnSeconds, seatedEye, windowYaw, type Passenger, type Seat, type Train } from "./metro.ts";
// Quests: named NPCs, dialogue and session quest state (quests.ts, npcs.ts, npc-scene.ts).
import type { NpcDialogue, QuestSnapshot } from "./quests.ts";
import { nearestNpc, type NpcDefinition } from "./npcs.ts";
import { drawNpcs } from "./npc-scene.ts";
import { drawWaypointBeacons } from "./waypoint-scene.ts"; // World map: waypoint beacons
// Driving: kerbside cars, the player's car and its camera (driving.ts, driving-scene.ts).
import { DriveSession, ParkedCars, carObstacle, distanceToCar, exitSpot, type CarPose, type Obstacle, type ParkedCar } from "./driving.ts";
import { drawDriveDashboard, drawDriving } from "./driving-scene.ts";
import { drawPark } from "./park-scene.ts"; // Rootwood Park props (trees, lanterns, benches, fountain, arena pillars)
import { drawHarbourWater } from "./harbour-scene.ts"; // Harbour (GROUND agent): water and quay beyond the Rim Roads
import { drawAlleys } from "./alley-scene.ts"; // Alleys: themed alley dressing
import { drawSecrets } from "./secrets-scene.ts"; // Secrets
import { cityEventWatch, drawCityEvents } from "./city-events-scene.ts"; // City events (EVENTS agent): scheduled happenings (city-events.ts) and their props
import { loadDriveView, saveDriveView, easeViewBlend, stepViewBlend } from "./drive-view.ts"; // Driving: remembered cockpit / chase view; Monorail seats: the same 0.4 s eased blend
// VFX: wheels, rain, steam, sparks, searchlights, sky trails (vfx.ts, vfx-scene.ts, vfx-shaders.ts).
import { beginVfxFrame, drawRain, flushVfx } from "./vfx-scene.ts";
// Multiplayer: remote players, their cars and party quests (src/multiplayer; optional, solo by default).
import type { FriendPosition, LocalPose, MultiplayerLink } from "../multiplayer/types.ts";
import { drawInteriorPlayers, drawRemoteLabels, drawRemotePlayers, type RemoteLabelFrame } from "../multiplayer/remote-scene.ts";
import { localPose, mergeRemoteHeadlights } from "../multiplayer/engine-hooks.ts";
import { nearbyRemoteCars } from "../multiplayer/remote-vehicles.ts";
import { samePlace } from "../multiplayer/presence.ts";
import { METRO_TIME_OFFSET, parseTrainCarrier, type TrainCarrier } from "../multiplayer/rail.ts";
// RPG layer: combat, items, quests (src/rpg; the engine talks to it only through RpgSession).
import type { RpgSnapshot, RpgUiAction } from "../rpg/types.ts";
import { RpgSession } from "../rpg/session.ts";
import { CONTENT_PACKS } from "../rpg/content";
import { RpgInputCollector } from "../rpg/input.ts";
import { combatHudLayout, drawCombatEffects, drawCombatOverlay, drawEnemies, drawGroundLoot, drawInteractables, drawViewmodel, type CombatHudLayout, type CombatOverlayFrame, type HudViewport } from "../rpg/scene";
import { CityInteriors, INTERIOR_HEIGHT, type InteriorPlace } from "./interiors.ts";
import { createAmbience } from "../audio/ambience.ts"; // Ambience: procedural soundscape
import { nearestCar, nearestEvent, nearestTrain, venueDistance, windGust } from "../audio/ambience-probe.ts"; // Ambience
import { interiorUseMarkers, type InteriorUseMarker } from "./interior-map-markers.ts";
import { interiorWorkState, type InteriorWorkState } from "./interior-work-state.ts";
import { drawInterior, setInteriorView, drawInteriorEntrances, drawInteriorInteractables } from "./interior-scene.ts";
import { drawGroundFloorDoors } from "./ground-floor-doors.ts";
import { INTERIOR_MATERIAL } from "./interior-material.ts";
import { upperOpenAir, upperVariant } from "./upper-floors.ts";
import { canPrewarm, materialVertex, prewarmPrograms } from "./shader-prewarm.ts";
import { drawCitizenLabels, type CitizenLabelFrame } from "./citizen-labels.ts";
import { WalkingCollision, WALKING_CAR_QUERY_RADIUS, WALKING_CAR_ROOF_CLEARANCE } from "./walking-collision.ts";
import { findWalkArrival, WALK_ARRIVAL_QUERY_RADIUS } from "./walk-arrival.ts";

/** "auto" (mobile): a phone profile adjusted at runtime by the frame-time governor. */
export type Quality = QualityPreset;
export interface CitySettings {
  rain: boolean;
  effects: boolean;
  sound: boolean;
  motion: boolean;
  quality: Quality;
  sensitivity: number;
}
export interface CitySnapshot {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  district: number;
  distance: number;
  fps: number;
  discovered: string[];
  nearby: string | null;
  mode: TravelMode;
  altitude: number;
  speed: number;
  destination: string | null;
  progress: number;
  cars: number;
  residents: number;
  interaction: string | null;
  station: string | null;
  cabin: (TrainCarrier & { doors: number }) | null;
  population: PopulationStats;
  sceneTime: number;
  /** The shared clock (the room's world time online, the scene clock solo): city events run on it. */
  signalTime: number;
  metroTime: number;
  visibleBuildings: number;
  quests: QuestSnapshot;
  /** Driving: set while mode === "drive" (speed is `speed`). */
  drive?: { gear: "D" | "R" | "N"; view: "cockpit" | "chase"; boost: boolean } | null;
  /** Multiplayer: other players in the room (for the minimap / atlas); empty when solo. */
  friends?: readonly FriendPosition[];
  /** Mobile: the active render profile (governor level when quality is "auto"). */
  render?: { level: number; cell: number; auto: boolean };
  /** RPG: character, combat, vendor and loot feed (src/rpg/types.ts RpgSnapshot); null before the RPG layer starts. */
  rpg?: RpgSnapshot | null;
  interior?: InteriorPlace | null;
  interiorUseMarkers?: readonly InteriorUseMarker[];
  presence?: LocalPose;
}
export type CityBootStage = "materials" | "scene" | "glyphs";
export interface CityCallbacks {
  onReady: () => void;
  onBootStage?: (stage: CityBootStage) => void;
  onError: (message: string) => void;
  onSnapshot: (snapshot: CitySnapshot) => void;
  onPause: () => void;
  onMap: () => void;
  onTransit: () => void;
  onDiscovery: (landmark: Landmark) => void;
  /** NPC conversation opened or changed; null when it closes. Opening releases the mouse without onPause. */
  onDialogue: (dialogue: NpcDialogue | null) => void;
  /** Short quest toasts: "Quest accepted: …", "Quest complete: … · +250 cr". */
  onQuestUpdate?: (message: string) => void;
  /** Mobile: the WebGL context was lost (iOS reclaims GPU memory) / restored. */
  onContextLost?: () => void;
  onContextRestored?: () => void;
}
export interface CityController {
  enter: () => void;
  pause: () => void;
  destroy: () => void;
  setSettings: (settings: CitySettings) => void;
  travel: (x: number, z: number, yaw?: number) => void;
  restorePassenger: (carrier: TrainCarrier, clock: number) => void;
  /** Touch joystick: analog forward / strafe (-1..1); `sprint` = pushed past the ring (also car boost). */
  setTouchMovement: (forward: number, strafe: number, sprint?: boolean) => void;
  look: (dx: number, dy: number) => void;
  setMode: (mode: "walk" | "fly") => void;
  ride: (mode: RideMode, destination: number) => void;
  /** Touch buttons. "handbrake" holds Space while driving; "camera" toggles the chase camera (V). */
  action: (action: "jump" | "up" | "down" | "handbrake" | "camera", pressed: boolean) => void;
  interact: () => void;
  /** Applies a dialogue option; answers through onDialogue (a follow-up, or null when it closes). */
  chooseDialogue: (optionId: string) => void;
  /** Ends the conversation (fires onDialogue(null) if one was open). Call enter() afterwards to resume. */
  closeDialogue: () => void;
  inspect: (command: InspectionCommand) => void;
  /** Multiplayer: attach a room connection (null detaches; solo play needs nothing). */
  setMultiplayer: (link: MultiplayerLink | null) => void;
  /** Radio: scale the rain ambience (1 = normal, e.g. 0.4 while the in-game radio plays). */
  duckAmbience: (level: number) => void;
  /** RPG: inventory / vendor / respawn commands from the React screens. */
  rpgAction: (action: RpgUiAction) => void;
  /** Photo mode (UI, src/components/photo-mode.tsx): "hud" shows / hides the in-engine HUD layer (combat bars, name
   *  tags); "aim" points the paused camera (ignored while running or driving). Returns the camera's yaw / pitch. */
  photo: (command: { kind: "hud"; visible: boolean } | { kind: "aim"; yaw: number; pitch: number }) => { yaw: number; pitch: number };
  /** Photo mode: the base layer's glyph cells and the glyph table to decode them (src/city/photo-mode.ts); null before ready. */
  photoFrame: () => { cols: number; rows: number; cells: Uint8Array; glyphs: [string, readonly number[]][] } | null;
  world: CityWorld;
}

// Hologram colour pairs (figure, chromatic ghost / upper shade), picked per district and tower.
const HOLO_TINTS: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[] = [
  [[0.25, 0.85, 1], [1, 0.3, 0.72]], [[1, 0.3, 0.72], [0.3, 0.6, 1]], [[1, 0.62, 0.26], [1, 0.25, 0.4]],
  [[0.45, 1, 0.6], [0.2, 0.7, 1]], [[0.7, 0.45, 1], [0.25, 0.95, 0.9]], [[0.3, 0.75, 1], [0.95, 0.85, 0.35]],
];

/** Draw distance cap in city blocks, altitude bonus included (23 x 64 m: from a rooftop at the city's
 *  edge the view reaches most of the 1,536 m city). The sky dome is a 1500 m sphere
 *  around the eye and the far plane 1800 m, and fog reaches the sky at 0.97 of the distance. */
export const MAX_DRAW_BLOCKS = 23;
/** LOD: the puddle reflection draws building blocks within this distance (m; the old desktop draw
 *  distance), whatever the main view's draw distance is. */
export const MIRROR_REACH = 11 * BLOCK_SIZE;
/** Knob (signage, Agent B): draw range of shopfront signs and letter panels in metres, at a grid
 *  of ~120 rows (scaled by the prop reach; reduced profiles use 200 m). The mirrored pass keeps
 *  shop panels within 120 m. */
export const SIGN_REACH = 360;
/** Knob (holograms, Agent B): beyond SIGN_REACH, the per-frame `visible` building list keeps only
 *  towers at least this tall (holograms, searchlights) and hologram-screen buildings (id % 17). */
export const FAR_VISIBLE_HEIGHT = 70;
/** Knob: hologram screens are drawn within min(0.6 x draw distance, this) metres. */
export const SCREEN_REACH = 0.6 * 11 * BLOCK_SIZE;
/** LOD: props, people, cars and street life keep their draw ranges at a grid of ~120 rows; larger
 *  grids (more, smaller cells) see them further, smaller grids nearer, in quarter steps, so a prop
 *  dissolves at about the same size on screen whatever the window and cell size. */
export function propReach(rows: number): number {
  return Math.max(0.75, Math.min(1.5, Math.round(rows / 120 * 4) / 4));
}

/** Perf: PropRecorder tag of the rail scene's captured letter panels (shop panels carry their distance). */
const METRO_PANELS = 1e9;
/** Perf: a building's sign faces depend only on its fixed shape; built once instead of several times a frame. */
const signFaceCache = new WeakMap<Building, ReturnType<typeof signFaces>>();
function facesOf(building: Building): ReturnType<typeof signFaces> {
  let faces = signFaceCache.get(building);
  if (!faces) { faces = signFaces(building); signFaceCache.set(building, faces); }
  return faces;
}

function glow(t: PropCanvas, color: RGB, intensity = 1): void {
  t.charColor(color[0] * intensity, color[1] * intensity, color[2] * intensity);
  t.cellColor(color[0] * intensity * 0.14, color[1] * intensity * 0.14, color[2] * intensity * 0.14, propAlpha());
  t.char("#");
}

/** A landmark's title panels (letter panels, sign surface 3, so each letter spans many cells; the
 * old 3D t.print put one glyph per character quad and repeated it in every cell it covered). The
 * structure itself is instanced prop geometry recorded with the other props (landmarks-scene.ts,
 * called from activity.ts), so it is shared by the reflected and main passes. */
function drawLandmark(t: Textmodifier, landmark: Landmark, time: number): void {
  void time; // structure animation lives in landmarks-scene.ts
  propRange(LANDMARK_LABEL_RANGE);
  for (const face of visibleLandmarkLabels(landmark)) drawLetterPanel(t, face);
  propRange(0); // the caller draws landmarks at range 0 (always drawn)
}

// Ambience: the procedural city soundscape lives in src/audio/ambience.ts (Web Audio only, no downloads).

/** localStorage, or null where it is blocked (private windows, sandboxed previews). */
function safeStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } | null {
  try { const storage = window.localStorage; storage.getItem("nightfall.probe"); return storage; } catch { return null; }
}

export function createCity(canvas: HTMLCanvasElement, initialSettings: CitySettings, callbacks: CityCallbacks): CityController {
  // A destroyed city released this canvas's WebGL context; textmode would fail on it with an
  // opaque "Shader compilation error: null". Say what happened instead (needs a fresh canvas).
  if (canvas.dataset.retired) throw new Error("This canvas's WebGL context was released by a previous city (hot reload); reload the page or rebuild with a fresh canvas.");
  const world = new CityWorld();
  let population = new CityPopulation(world);
  let traffic = new CityTraffic();
  const player: Player = { ...SPAWN, distance: 0 };
  const streetCollision = new WalkingCollision(world, player);
  const mouse = new MouseLook(SPAWN.yaw, SPAWN.pitch);
  const keys = new Set<string>();
  const discovered = new Set<string>();
  // RPG: combat, items, loot, vendors and the data-driven quest engine, persisted in localStorage.
  // It also answers every quest/dialogue call the engine used to send to QuestBook.
  const rpg = new RpgSession({ world, packs: CONTENT_PACKS, storage: safeStorage(), testContent: new URLSearchParams(location.search).get("rpgtest") === "1" });
  const quests = rpg;
  const rpgInput = new RpgInputCollector();
  const interiors = new CityInteriors(world);
  rpg.attachInteriors(interiors); // Locked rooms: the session opens and closes this instance's gates
  let roomWork: InteriorWorkState | null = null;
  let hudFrame: CombatOverlayFrame | null = null; // this frame's combat HUD data, for the overlay layer
  const abort = new AbortController();
  const ambience = createAmbience();
  rpg.bus.on("itemAdded", () => ambience.event("pickup")); // Ambience: a soft chime (ignored while the ambience is off)
  let settings = initialSettings;
  let running = false;
  let disposed = false;
  let ready = false;
  let time = 0;
  let frozen = false;
  let visibleBuildings = 0;
  let cameraHeight = WALK_HEIGHT;
  let verticalVelocity = 0;
  let mode: TravelMode = "walk";
  let journey: Journey | null = null;
  let speed = 0;
  let rideHeading: number | null = null;
  let rideTurn: (RideTurn & { journey: Journey }) | null = null; // the ride camera's eased, rate-capped turn
  let metroTime = METRO_TIME_OFFSET;
  let passengerSpeed = 0;
  let platform: number | null = null;
  let passenger: Passenger | null = null;
  // Monorail seats: the bench seat `rider` (the passenger object that sat down) occupies. `progress`
  // eases 0 (standing in the aisle) .. 1 (seated) over 0.4 s; `sitting` is the direction, so standing
  // up mid-way turns back from where the eye is. `from` is the aisle spot and look (relative to the
  // train) the sit began from; `look` is the view's own turn to the window (0..1 over `turn` seconds,
  // longer for big turns); `released` arms WASD-to-stand once movement keys have been let go.
  // passenger.u/v stay on the aisle spot in front of the seat (always walkable), so the published
  // carrier, the snapshot cabin and a graphics-recovery restore all stand the player in the aisle.
  let seated: { rider: Passenger; seat: number; progress: number; look: number; turn: number; sitting: boolean; released: boolean; from: { u: number; v: number; yaw: number; pitch: number } } | null = null;
  let lift: { station: number; from: number; to: number; elapsed: number } | null = null;
  let liftStation: number | null = null;
  let liftHeight = 0;
  let counts = { cars: 0, residents: 0 };
  /** The shared clock of the last frame (signalTime), for the HUD snapshot (city events on the map). */
  let signalClock = 0;
  // City programs (materials.ts SURFACES): `material` draws props, signs, sky, screens and VFX in both
  // passes, `groundMaterial` the street plane in the main pass, `hologramMaterial` SURFACE 7 in both.
  let material: TextmodeShader | undefined;
  let interiorMaterial: TextmodeShader | undefined;
  let groundMaterial: TextmodeShader | undefined;
  let hologramMaterial: TextmodeShader | undefined;
  let reflection: TextmodeFramebuffer | undefined;
  let sceneData: SceneData | undefined;
  let textData: TextData | undefined;
  let buildingBatch: BuildingBatch | undefined;
  let propBatch: PropBatch | undefined;
  let props: PropRecorder | undefined;
  let signs: SignCanvas | undefined;
  const directProps = new URLSearchParams(location.search).get("directProps") === "1";
  // Diagnostics: ?legacySigns=1 re-walks the shops and stations per pass for their letter panels
  // (the old path) instead of replaying the panels captured while recording props.
  const legacySigns = new URLSearchParams(location.search).get("legacySigns") === "1";
  const referenceRenderer = new URLSearchParams(location.search).get("reference") === "1";
  // Diagnostics: ?warp=offset renders turning with the old uniform layer offset, ?warp=identity keeps the filter pass but moves nothing.
  const warpMode = new URLSearchParams(location.search).get("warp");
  // Diagnostics / LOD tuning: ?radius=N overrides the profile's base draw distance (city blocks).
  const radiusOverride = Math.max(0, Math.min(MAX_DRAW_BLOCKS, Math.round(Number(new URLSearchParams(location.search).get("radius")) || 0)));
  let touchForward = 0;
  let touchStrafe = 0;
  let touchSprint = false; // Mobile: joystick pushed past its ring
  // Comfort: on foot and in flight the movement input eases in and out (~0.1 s) instead of
  // starting and stopping dead; instant velocity changes are a classic motion-sickness trigger.
  const eased = { forward: 0, strafe: 0, sprint: 0, up: 0 };
  let contextLost = false; // Mobile: iOS drops WebGL contexts under memory pressure
  const active = () => !disposed && !contextLost;
  let drag: { x: number; y: number; id: number } | undefined;
  let lastSnapshot = 0;
  // Perf (?perf=1): smoothed CPU milliseconds of each section of the frame callback, for
  // __nightfallPerf().sections (scripts/perf-bench.mjs). Disabled, mark() is one branch.
  const perfSections = new URLSearchParams(location.search).get("perf") === "1" ? new Map<string, number>() : null;
  let sectionStart = 0;
  const mark = (name: string) => {
    if (!perfSections) return;
    const now = performance.now(), previous = perfSections.get(name);
    perfSections.set(name, previous === undefined ? now - sectionStart : previous + (now - sectionStart - previous) * 0.05);
    sectionStart = now;
  };
  let frameAverage = 1 / 60;
  let blockCache = "";
  let viewDistance = 0;
  let fadeIn = 0;
  let doorFade = 1; // leaving an interior: the street brightens from near-dark over DOOR_FADE_SECONDS (effects on)
  let atlasSize = 0;
  let blocks: Block[] = [];
  // Perf: per-frame scratch, reused (no per-frame allocation). `near`: buildings of the 5x5 blocks
  // around the eye, nearest first; rebuilt only when the eye moves or the block set changes.
  const near: Building[] = [], blockers: Building[] = [];
  let nearX = NaN, nearZ = NaN, nearBlocks: Block[] | null = null;
  // The chunk of each block in `blocks` (looked up when the block set changes) and this frame's
  // chunks in view, nearest first, for the main and the reflected pass.
  // `top`: the block's tallest building (m), for the steep-view cone.
  const blockSlots: { chunk: BuildingChunk; distance: number; top: number }[] = [], slotList: { chunk: BuildingChunk; distance: number; top: number }[] = [];
  let slotBlocks: Block[] | null = null;
  const chunks: BuildingChunk[] = [], mirrorChunks: BuildingChunk[] = [];
  const visibility = new VisibilityCache();
  const steepCone = new ViewCone();
  const roadResidents: CityPopulation["walkers"][number][] = [];
  const nearbyCars: CarPose[] = [];
  // Driving: kerbside cars exist from the start; `drive` is the car being driven.
  const parked = new ParkedCars(world);
  let drive: DriveSession | null = null;
  // Multiplayer: the room link, and the party quest state last adopted from it.
  let link: MultiplayerLink | null = null;
  let partyKey = -1;
  let remoteLabels: RemoteLabelFrame | null = null; // this frame's remotes + camera, for the overlay name tags
  let citizenLabelFrame: CitizenLabelFrame | null = null;

  // Mobile: the render profile (cell size, draw distance, effects) comes from the quality preset;
  // "auto" is the phone profile, stepped by the frame-time governor. Desktop presets are unchanged.
  const touchFirst = isTouchFirst();
  const governor = new QualityGovernor();
  // Desktop presets: a second governor that only gives up draw distance, then full reflections,
  // when a desktop cannot hold its frame rate (quality-governor.ts DESKTOP_LEVELS).
  let desktopGovernor = new QualityGovernor(DESKTOP_LEVELS.length - 1);
  const holdGovernors = (now: number, seconds?: number) => { governor.hold(now, seconds); desktopGovernor.hold(now, seconds); };
  const resolveProfile = (portraitView: boolean) => settings.quality === "auto" ? renderProfile("auto", governor.level, portraitView) : desktopProfile(renderProfile(settings.quality, 0, portraitView), desktopGovernor.level);
  const portrait = () => canvas.clientHeight > canvas.clientWidth;
  let profile: RenderProfile = resolveProfile(portrait());
  let cpuAverage = 0;
  let pixelDensity = Math.min(window.devicePixelRatio || 1, profile.maxDensity);
  // Cells of at least 8 device pixels keep every character legible; the atlas glyphs are 8x8.
  const fontSize = () => Math.round(profile.cell * pixelDensity);
  // Mobile: 62 rather than textmode's default 60 so a 60 Hz display (Safari clamps timestamps to whole
  // milliseconds) never trips the frame limiter into skipping frames; 120 Hz still renders every other frame.
  const t = textmode.create({ canvas, width: canvas.clientWidth, height: canvas.clientHeight, pixelDensity, fontSize: fontSize(), plugins: [FiltersPlugin, SynthPlugin], seed: 2089, loadingScreen: { transition: "none" }, frameRate: touchFirst || isWebKit() ? 62 : 60 });
  // Once the city is ready the frame loop takes over from textmode's limiter: every k-th vsync of the
  // measured display rate (72 fps on 144 Hz, 60 on 120 Hz), so motion never judders (frame-pacing.ts).
  const frames = createFrameLoop(() => { if (!disposed) t.redraw(); }, touchFirst || isWebKit() ? 62 : 100);
  // A live synth broadcast is rendered once and reused by all hologram screens.
  const broadcast = t.layers.add({ opacity: 0, fontSize: 12, visible: profile.holograms });
  const weather = t.layers.add({ fontSize: 12 * pixelDensity, opacity: 0.55 });
  const hud = t.layers.add({ fontSize: 12 * pixelDensity }); // RPG: combat HUD at full opacity
  const hudPointer = matchMedia("(pointer: coarse)");
  const hudQuery = new URLSearchParams(location.search);
  const cleanHud = hudQuery.get("studio") === "1" && hudQuery.get("clean") === "1";
  let hudViewport: HudViewport = { width: 1, height: 1, touch: hudPointer.matches };
  let hudLayoutCache: CombatHudLayout | undefined;
  let hudColumns = 0, hudRows = 0;
  hudPointer.addEventListener("change", resize, { signal: abort.signal });

  /** Mobile: re-resolves the render profile; rebuilds the atlas only when the cell size changes. */
  function applyProfile(): void {
    if (!active()) return;
    const next = resolveProfile(portrait());
    const previous = profile;
    profile = next;
    if (next.holograms !== previous.holograms) { if (next.holograms && !interiors.active) broadcast.show(); else broadcast.hide(); }
    if (next.baseRadius !== previous.baseRadius) blockCache = "";
    if (ready && next.cell !== previous.cell) { holdGovernors(performance.now()); void applyAtlas().then(resize).catch(rendererError); }
  }

  function resize(): void {
    if (disposed || contextLost) return; // a lost context's objects belong to no context
    const rect = canvas.getBoundingClientRect();
    const shellStyle = getComputedStyle(document.documentElement);
    hudViewport = {
      width: rect.width, height: rect.height, touch: hudPointer.matches,
      insets: { top: Number.parseFloat(shellStyle.getPropertyValue("--sat")) || 0, right: Number.parseFloat(shellStyle.getPropertyValue("--sar")) || 0, bottom: Number.parseFloat(shellStyle.getPropertyValue("--sab")) || 0, left: Number.parseFloat(shellStyle.getPropertyValue("--sal")) || 0 },
    };
    hudLayoutCache = undefined;
    if (resolveProfile(rect.height > rect.width).cell !== profile.cell) applyProfile(); // Mobile: orientation
    holdGovernors(performance.now(), 1.5);
    const density = Math.min(window.devicePixelRatio || 1, profile.maxDensity);
    if (density !== pixelDensity) {
      pixelDensity = density;
      t.pixelDensity(density); weather.fontSize(12 * density); hud.fontSize(12 * density); void applyAtlas().catch(rendererError);
    }
    // Render glyphs at their actual display size. Upscaling a capped buffer
    // smears the very strokes that make ASCII details recognizable in motion.
    t.resizeCanvas(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  }

  // The glyph atlas is generated at the exact device cell size so every stroke is pixel-perfect.
  // Rebuilt, never rescaled, when the cell size changes.
  async function applyAtlas(): Promise<void> {
    if (!active()) return;
    const size = fontSize();
    if (size === atlasSize) return;
    atlasSize = size;
    const atlas = buildCityAtlas(size);
    t.fontSize(size);
    const tileset = await t.loadTileset({ source: atlas.canvas, columns: 16, rows: 16, count: 256, map: atlas.map, fontSize: atlas.tile });
    if (!active()) { if (disposed && !contextLost) tileset.dispose(); return; }
    for (let i = 0; i < ASCII_COUNT; i++) {
      const character = String.fromCharCode(FIRST_ASCII + i);
      sceneData?.set(GLYPH_TABLE + i, t.font.characterMap.get(character)?.color ?? [0, 0, 0]);
      sceneData?.set(GLYPH_TABLE + ASCII_COUNT + i, t.font.characterMap.get(thinKey(character))?.color ?? [0, 0, 0]);
    }
    // The feed layer shares the atlas so its glyph indices mean the same thing in the city material.
    const feedTileset = await broadcast.loadTileset(t.font as TextmodeTileset);
    if (!active() && disposed && !contextLost) feedTileset.dispose();
  }

  function rendererError(error: unknown): void {
    if (!active()) return;
    frames.stop();
    pause();
    ready = false;
    t.noLoop();
    callbacks.onError(error instanceof Error ? error.message : "The city renderer could not start.");
  }

  /** Compiles one shader program; a failure names the variant and keeps the GL info log. textmode
   * reports a missing log as "null", which happens when the context is lost mid-compile (a GPU
   * process reset under contention), so that case says so. */
  async function labelled<T>(variant: string, build: () => Promise<T>): Promise<T> {
    try { return await build(); }
    catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).trim();
      const lost = canvas.getContext("webgl2")?.isContextLost() ?? false;
      const log = /:\s*null$/.test(detail) || lost ? `${detail.replace(/:\s*null$/, "")} (no info log${lost ? ": WebGL context lost" : ""})` : detail;
      throw new Error(`${variant} shader: ${log.length > 400 ? `${log.slice(0, 400)}...` : log}`);
    }
  }

  async function bootStage(stage: CityBootStage): Promise<boolean> {
    if (!active()) return false;
    callbacks.onBootStage?.(stage);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    return active();
  }

  function broadcastFeed(): void {
    broadcast.synth(plasma(5, 0, () => time * 0.5, 1.4)
      .modulate(osc(8, 0).rotate(() => time * 0.08), 0.14)
      .kaleid(4).scroll(0, () => time * 0.025)
      .charMap(" .:-=+*#%@")
      .charColor(solid(0.08, 0.8, 0.95).blend(osc(3, 0, 1.8).scroll(() => time * 0.08, 0).color(1, 0.12, 0.6), 0.5))
      .cellColor(0.008, 0.025, 0.06));
  }

  /** The platform's next-train text, computed once per snapshot (stationArrival walks the schedule). */
  function arrivalText(platform: number): string {
    const seconds = stationArrival(metroTime, platform).seconds;
    return seconds === 0 ? "at platform" : `in ${seconds}s`;
  }
  function snapshot(): void {
    let nearby: string | null = null;
    let closest = 65;
    for (const landmark of LANDMARKS) {
      const distance = Math.hypot(player.x - landmark.x, player.z - landmark.z);
      if (distance < closest) { nearby = landmark.id; closest = distance; }
      if (running && distance < 48 && !discovered.has(landmark.id)) {
        discovered.add(landmark.id);
        rpg.discovered = [...discovered]; rpg.bus.emit({ type: "message", text: `Discovered: ${landmark.name}`, tone: "quest" }); // RPG: saved with the game
        callbacks.onDiscovery(landmark);
      }
    }
    const train = passenger ? trainAt(metroTime, passenger.train) : null;
    const stop = platform !== null ? STATIONS[platform] : train?.station !== null && train?.station !== undefined ? STATIONS[train.station] : null;
    const destination = train ? train.station !== null ? `${STATIONS[train.station].name} · doors ${train.doors > 0.85 ? "open" : "closing"}` : `Next: ${STATIONS[train.next].name}` : platform !== null ? `${STATIONS[platform].name} · train ${arrivalText(platform)}` : journey?.destination ?? null;
    const useMarkers = interiors.active ? interiorUseMarkers(interiors.active, rpg.interactables(interiors.active.id)) : [];
    roomWork = interiorWorkState(interiors.active?.id, rpg.quests);
    callbacks.onSnapshot({ presence: currentPose(), interior: interiors.active, interiorUseMarkers: useMarkers, x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch, sceneTime: time, signalTime: signalClock, metroTime, visibleBuildings, distance: player.distance, district: districtAt(player.x, player.z).id, fps: Math.round(1 / frameAverage), discovered: [...discovered], nearby, mode, altitude: cameraHeight, speed, destination, progress: train?.progress ?? (journey ? journey.travelled / Math.max(1, journey.length) : 0), interaction: interaction(), station: stop?.name ?? null, cabin: passenger && train ? { train: passenger.train, u: passenger.u, v: passenger.v, yaw: player.yaw - train.yaw, doors: train.doors } : null, population: population.stats(player.x, player.z), ...counts, quests: quests.questSnapshot(talkTarget()), rpg: rpg.snapshot(), drive: drive ? { gear: drive.car.speed < -0.3 ? "R" : Math.abs(drive.car.speed) < 0.3 ? "N" : "D", view: drive.chase ? "chase" : "cockpit", boost: keys.has("ShiftLeft") || keys.has("ShiftRight") || touchSprint } : null, friends: link?.friends() ?? [] /* Multiplayer */, render: { level: governor.level, cell: profile.cell, auto: settings.quality === "auto" } /* Mobile */ });
    if (running && settings.sound) { const near = nearestTrain(metroTime, player.x, cameraHeight, player.z, passenger?.train ?? null); ambience.update({ district: districtAt(player.x, player.z).id, x: player.x, y: cameraHeight, z: player.z, interior: interiors.active !== null, rain: settings.rain, speed: drive ? drive.car.speed : speed, walking: mode === "walk" && !passenger && verticalVelocity === 0, driving: drive !== null, boost: drive !== null && (keys.has("ShiftLeft") || keys.has("ShiftRight") || touchSprint), riding: passenger !== null && train !== null, ridingSpeed: train?.speed ?? 0, lift: lift !== null, trainDistance: near.distance, trainSpeed: near.speed, trainBraking: near.braking, car: interiors.active ? null : nearestCar(traffic.nearby(player.x, player.z, 24), player.x, player.z), time, gust: windGust(time), platform: platform !== null, event: nearestEvent(link?.worldTime(performance.now() / 1000) ?? time, player.x, player.z), venue: interiors.active?.kind ?? null, venueId: interiors.active?.id ?? null, floor: interiors.active?.floor ?? null, variant: interiors.active ? upperVariant(interiors.active) : null, openAir: interiors.active ? upperOpenAir(interiors.active) : false, club: interiors.active ? Infinity : venueDistance(interiors.places, "nightclub", player.x, player.z) }); } // Ambience
  }

  // Quests: the NPC in talking range while on foot at street level, unless a lift is closer.
  function talkTarget(): NpcDefinition | null {
    if (interiors.active || mode !== "walk" || passenger || platform !== null || lift || journey || cameraHeight > WALK_HEIGHT + 1.5) return null;
    const near = nearestNpc(quests.npcs, player.x, player.z), station = nearbyLift();
    if (!near) return null;
    if (station !== null) { const p = worldToLocal(STATIONS[station], player.x, player.z); if (Math.hypot(p.u - 9, p.v - 20) < near.distance) return null; }
    return near.npc;
  }
  // Opening a conversation stops movement and frees the mouse. pause() clears `running`
  // first, so the pointer-lock listener does not report it as a pause.
  function talk(npc: NpcDefinition): void {
    const dialogue = quests.talk(npc.id);
    if (!dialogue) return;
    pause(); callbacks.onDialogue(dialogue); snapshot();
  }
  function chooseDialogue(optionId: string): void {
    if (!quests.dialogue) return;
    const npcId = quests.dialogue.npcId;
    const result = quests.choose(optionId);
    void npcId; // Multiplayer: party quest sync is paused while the RPG quest engine is the source of truth
    if (result.message) callbacks.onQuestUpdate?.(result.message);
    callbacks.onDialogue(result.dialogue); snapshot();
  }
  function closeDialogue(): void {
    if (!quests.dialogue) return;
    quests.close(); callbacks.onDialogue(null); snapshot();
  }

  // Driving: a car within reach on foot at street level (parked, or traffic waiting at a light).
  // It is offered only when nearer than a talkable NPC: the nearest target wins.
  type CarTarget = { parked: ParkedCar | null; traffic: number | null; distance: number };
  function carTarget(): CarTarget | null {
    if (interiors.active || mode !== "walk" || drive || passenger || platform !== null || lift || journey || cameraHeight > WALK_HEIGHT + 0.5) return null;
    let best: CarTarget | null = null;
    for (const car of parked.nearby(player.x, player.z, 8)) { const d = distanceToCar(car, player.x, player.z); if (d < 2 && (!best || d < best.distance)) best = { parked: car, traffic: null, distance: d }; }
    for (const car of traffic.nearby(player.x, player.z, 8)) { const d = distanceToCar(car, player.x, player.z); if (car.waiting && d < 2 && (!best || d < best.distance)) best = { parked: null, traffic: car.id, distance: d }; }
    const npc = best ? nearestNpc(quests.npcs, player.x, player.z) : null;
    return best && (!npc || best.distance < npc.distance) ? best : null;
  }
  function enterCar(target: CarTarget): void {
    let pose: { x: number; z: number; yaw: number; id: number } | null = null;
    if (target.parked) { parked.take(target.parked); pose = target.parked; }
    else if (target.traffic !== null) pose = traffic.takeOver(target.traffic);
    if (!pose) return;
    drive = new DriveSession(pose, mouse, loadDriveView() === "chase"); mode = "drive"; verticalVelocity = 0;
  }
  // Getting out needs the car (nearly) stopped unless another mode forces it. The car stays
  // exactly where it stopped; the driver steps out beside it, onto the pavement where possible.
  function exitCar(force: boolean): boolean {
    if (!drive) return true;
    if (!force && Math.abs(drive.car.speed) > 4) return false;
    const car = drive.car;
    const anchor = exitSpot(world, car), arrival = walkArrival(anchor);
    if (!arrival && !force) { blockedArrival(); return false; }
    parked.park(car); drive = null;
    settleArrival(anchor, arrival, !force);
    mouse.reset(mouse.yaw, Math.max(-0.2, Math.min(0.2, mouse.pitch))); player.yaw = mouse.yaw; player.pitch = mouse.pitch;
    return true;
  }
  function walkArrival(anchor: { x: number; z: number }): { x: number; z: number } | null {
    const remotes = link?.remotes(performance.now() / 1000) ?? [];
    const cars = [...parked.nearby(anchor.x, anchor.z, WALK_ARRIVAL_QUERY_RADIUS), ...traffic.nearby(anchor.x, anchor.z, WALK_ARRIVAL_QUERY_RADIUS), ...nearbyRemoteCars(remotes, anchor, WALK_ARRIVAL_QUERY_RADIUS)];
    if (drive) cars.push(drive.car);
    return findWalkArrival(world, anchor, cars);
  }
  function departurePosition(): { x: number; z: number } {
    return interiors.active?.entrance ?? (drive ? exitSpot(world, drive.car) : player);
  }
  function blockedArrival(): void {
    callbacks.onQuestUpdate?.("No clear footing nearby. Move a little or choose another destination.");
  }
  function settleArrival(anchor: { x: number; z: number }, arrival: { x: number; z: number } | null, notify = true): void {
    Object.assign(player, arrival ?? anchor);
    mode = arrival ? "walk" : "fly";
    cameraHeight = arrival ? WALK_HEIGHT : WALK_HEIGHT + WALKING_CAR_ROOF_CLEARANCE + 0.5;
    verticalVelocity = 0; speed = 0;
    eased.forward = eased.strafe = eased.sprint = eased.up = 0;
    if (!arrival && notify) callbacks.onQuestUpdate?.("The street is blocked. Hovering above traffic; move to a clear spot to land.");
  }
  function driveObstacles(x: number, z: number, remoteCars: readonly CarPose[]): Obstacle[] {
    return [...parked.nearby(x, z, 20).map(carObstacle), ...traffic.nearby(x, z, 20).map(carObstacle), ...remoteCars.map(carObstacle)];
  }
  // Traffic queues behind the driven car and behind cars the player left in a lane nearby.
  function trafficBlockers(remoteCars: readonly CarPose[]): { x: number; z: number }[] {
    const list: { x: number; z: number }[] = [...parked.nearby(player.x, player.z, 260).filter(car => car.moved), ...remoteCars];
    if (drive) list.push(drive.car);
    return list;
  }

  function nearbyLift(): number | null {
    const station = STATIONS.find(s => { const p = worldToLocal(s, player.x, player.z); return Math.hypot(p.u - 9, p.v - 20) < 3.3; });
    return station?.index ?? null;
  }
  function interaction(): string | null {
    if (interiors.active) return interiors.atExit(player.x, player.z) ? `Exit ${interiors.active.name}` : liftFirst() ? interiors.liftPrompt(player.x, player.z) : null; // Upper floors: the lift
    if (lift) return "Lift in motion";
    if (drive) return Math.abs(drive.car.speed) > 4 ? "Slow down to get out" : "Get out of the car"; // Driving
    if (passenger) {
      const train = trainAt(metroTime, passenger.train);
      if (seated?.sitting) return train.station !== null && train.doors > 0.85 ? "Stand up · doors open" : "Stand up"; // Monorail seats
      if (!seated && train.doors > 0.85 && doorAt(passenger.v) && passenger.u > 1) return "Step onto the platform";
      return !seated && seatTarget() ? "Sit down" : "Walk through the carriages · doors open at stations";
    }
    if (platform !== null) {
      if (nearbyLift() === platform) return "Take lift to the street";
      const p = worldToLocal(STATIONS[platform], player.x, player.z);
      if (p.u < 5.5 && doorAt(p.v) && boardingTrain(metroTime, platform)) return "Board the monorail";
      return "Walk to an open carriage door";
    }
    const target = nearestTarget(); // Same pick as interact(): the nearest of door, car, NPC, RPG object, lift
    if (!target || target.kind === "rpg") return null; // the RPG HUD describes its own action
    if (target.kind === "door") return rpg.inCombat ? "Finish combat before entering" : `Enter ${target.place.name}`;
    if (target.kind === "car") return target.car.traffic !== null ? "Take over the stopped car" : "Get in the car";
    if (target.kind === "npc") return `Talk to ${target.npc.name}`;
    return "Take lift to the platform";
  }
  function board(train: ReturnType<typeof trainAt>, v: number): void {
    passenger = { train: train.id, u: 1.65, v, yaw: train.yaw }; platform = null; mode = "metro";
    Object.assign(player, localToWorld(train, passenger.u, passenger.v)); cameraHeight = floorHeight(train, passenger.v) + TRAIN_EYE_HEIGHT;
    mouse.reset(train.yaw, -0.015); player.yaw = train.yaw; player.pitch = -0.015;
    passengerSpeed = 0;
    publishPose();
  }
  function disembark(): void {
    if (!passenger) return;
    const train = trainAt(metroTime, passenger.train);
    if (train.station === null || train.doors <= 0.85 || !doorAt(passenger.v) || passenger.u < 1) return;
    platform = train.station; mode = "walk";
    Object.assign(player, localToWorld(STATIONS[platform], 4.05, passenger.v));
    cameraHeight = STATIONS[platform].height + WALK_HEIGHT; passenger = null;
    publishPose();
  }

  function carryPassenger(): void {
    if (seated && seated.rider !== passenger) leaveSeat(); // Monorail seats: alighted, re-boarded, restored, teleported
    if (!passenger) return;
    const train = trainAt(metroTime, passenger.train);
    const turn = Math.atan2(Math.sin(train.yaw - passenger.yaw), Math.cos(train.yaw - passenger.yaw));
    mouse.yaw += turn; mouse.targetYaw += turn; player.yaw = mouse.yaw; passenger.yaw = train.yaw;
    if (seated) { population.reservePlayerSeat(passenger.train, seated.seat); placeSeatedEye(train); } // re-asserted: a lab clock reset rebuilds the population
    else {
      Object.assign(player, localToWorld(train, passenger.u, passenger.v));
      cameraHeight = floorHeight(train, passenger.v) + TRAIN_EYE_HEIGHT; // follows the deck's rise; the view never pitches or rolls with it
    }
    speed = train.speed;
  }

  // Monorail seats: sit on a free bench seat (E near it), look out of the window, stand with E/WASD.
  /** The free seat within reach of a standing passenger: not one a commuter sits on or is boarding toward. */
  function seatTarget(): Seat | null {
    if (!passenger || seated) return null;
    const train = passenger.train;
    return nearestFreeSeat(passenger.u, passenger.v, seat => !population.seatTaken(train, seat.index));
  }
  function sit(seat: Seat): void {
    if (!passenger || seated) return;
    const train = trainAt(metroTime, passenger.train);
    const out = windowYaw(train.yaw, seat.side), turn = Math.atan2(Math.sin(out - mouse.yaw), Math.cos(out - mouse.yaw));
    seated = { rider: passenger, seat: seat.index, progress: 0, look: 0, turn: seatTurnSeconds(turn), sitting: true, released: false, from: { u: passenger.u, v: passenger.v, yaw: mouse.yaw - train.yaw, pitch: mouse.pitch } };
    population.reservePlayerSeat(passenger.train, seat.index);
  }
  function leaveSeat(): void {
    seated = null;
    population.reservePlayerSeat(null);
  }
  /** Eye between the standing aisle spot (passenger.u/v) and the seated eye, at the current blend. */
  function placeSeatedEye(train: Train): void {
    if (!passenger || !seated) return;
    const eye = seatedEye(SEATS[seated.seat]), blend = easeViewBlend(seated.progress);
    const v = passenger.v + (eye.v - passenger.v) * blend;
    Object.assign(player, localToWorld(train, passenger.u + (eye.u - passenger.u) * blend, v));
    cameraHeight = floorHeight(train, v) + TRAIN_EYE_HEIGHT + (eye.y - TRAIN_EYE_HEIGHT) * blend;
  }
  /** Per running frame while a seat is held: steps the eased sit/stand, slides the aisle spot from
   *  where the sit began to the spot in front of the seat, and steers the look: eased toward the
   *  window while sitting down (no snap), then free within SEAT_LOOK; standing up frees it again.
   *  Returns false when no seat is held (the passenger walks). */
  function rideSeat(train: Train, dt: number, moving: boolean): boolean {
    if (!passenger || !seated || seated.rider !== passenger) return false;
    if (!moving) seated.released = true;
    else if (seated.released && seated.sitting && seated.progress >= 1) seated.sitting = false; // WASD stands up
    seated.progress = stepViewBlend(seated.progress, seated.sitting, dt);
    const seat = SEATS[seated.seat], blend = easeViewBlend(seated.progress);
    if (seated.sitting) {
      const stand = seatStand(seat);
      passenger.u = seated.from.u + (stand.u - seated.from.u) * blend;
      passenger.v = seated.from.v + (stand.v - seated.from.v) * blend;
      if (seated.look < 1) {
        seated.look = Math.min(1, seated.look + Math.max(0, dt) / seated.turn);
        const turn = easeViewBlend(seated.look), from = train.yaw + seated.from.yaw, out = windowYaw(train.yaw, seat.side);
        const desired = from + Math.atan2(Math.sin(out - from), Math.cos(out - from)) * turn;
        mouse.reset(mouse.yaw + Math.atan2(Math.sin(desired - mouse.yaw), Math.cos(desired - mouse.yaw)), seated.from.pitch + (SEAT_LOOK.tilt - seated.from.pitch) * turn);
      } else {
        const target = clampSeatedLook(mouse.targetYaw, mouse.targetPitch, train.yaw, seat.side), current = clampSeatedLook(mouse.yaw, mouse.pitch, train.yaw, seat.side);
        mouse.targetYaw = target.yaw; mouse.targetPitch = target.pitch; mouse.yaw = current.yaw; mouse.pitch = current.pitch;
      }
      player.yaw = mouse.yaw; player.pitch = mouse.pitch;
    }
    placeSeatedEye(train);
    if (!seated.sitting && seated.progress <= 0) leaveSeat(); // back on the aisle spot; walking resumes next frame
    return true;
  }
  function interact(): void {
    if (!running || lift || rpg.dead) return;
    if (interiors.active) {
      if (interiors.atExit(player.x, player.z)) {
        const arrival = walkArrival(interiors.active.entrance);
        if (arrival) { leaveInterior(); Object.assign(player, arrival); publishPose(); }
        else blockedArrival();
      }
      else if (liftFirst()) rideLift(); // Upper floors
      else if (rpg.hasInteraction()) {
        const opened = rpg.interactNearby();
        if (opened) { pause(); callbacks.onDialogue(opened); }
      }
      snapshot(); return;
    }
    if (passenger) {
      // Monorail seats: E stands up from a seat; at an open door E alights; near a free seat E sits.
      const train = trainAt(metroTime, passenger.train), seat = seatTarget();
      if (seated) { if (seated.sitting) seated.sitting = false; }
      else if (seat && !(train.doors > 0.85 && doorAt(passenger.v) && passenger.u > 1)) sit(seat);
      else disembark();
      snapshot(); return;
    }
    if (drive) { exitCar(false); snapshot(); return; } // Driving
    const target = nearestTarget();
    if (target?.kind === "door") { if (!rpg.inCombat) enterInterior(target.place); snapshot(); return; }
    if (target?.kind === "car") { enterCar(target.car); snapshot(); return; }
    if (target?.kind === "npc") { talk(target.npc); return; } // Quests
    if (target?.kind === "rpg") { // RPG: pick up loot, else use a world object
      const opened = rpg.interactNearby();
      if (opened) { pause(); callbacks.onDialogue(opened); snapshot(); return; }
      rpgInput.pressInteract(); return;
    }
    const station = nearbyLift();
    if (station !== null && mode === "walk") {
      lift = { station, from: platform !== null ? STATIONS[station].height : 0, to: platform !== null ? 0 : STATIONS[station].height, elapsed: 0 };
      liftStation = station; liftHeight = lift.from;
      Object.assign(player, localToWorld(STATIONS[station], 9, 20));
    } else if (platform !== null) {
      const p = worldToLocal(STATIONS[platform], player.x, player.z), train = boardingTrain(metroTime, platform);
      if (train && p.u < 5.5 && doorAt(p.v)) board(train, p.v);
    } else if (mode !== "walk") setMode("walk");
    snapshot();
  }

  // The single source of truth for what E does and what the prompt says: the NEAREST available
  // target among door, car, NPC, RPG interaction and station lift (ties favour that order).
  type Target =
    | { kind: "door"; place: InteriorPlace; distance: number }
    | { kind: "car"; car: CarTarget; distance: number }
    | { kind: "npc"; npc: NpcDefinition; distance: number }
    | { kind: "rpg"; distance: number }
    | { kind: "lift"; station: number; distance: number };
  /** Metres a new target must beat the held one by to take the prompt over (see nearestTarget). */
  const TARGET_MARGIN = 0.4;
  let heldTarget: Target | null = null;
  function nearestTarget(): Target | null {
    const found: Target[] = [];
    const offer = (candidate: Target): void => { found.push(candidate); };
    const use = mode === "walk" ? rpg.interactionDistance() : null; // loot, world objects and hackable doors
    if (mode === "walk" && !passenger && platform === null && !lift && !journey && cameraHeight <= WALK_HEIGHT + 0.5) {
      const doorway = interiors.nearby(player.x, player.z);
      // In combat the door only counts when no RPG action is available (E then runs the RPG action).
      if (doorway && !(rpg.inCombat && use !== null)) offer({ kind: "door", place: doorway, distance: Math.hypot(player.x - doorway.entrance.x, player.z - doorway.entrance.z) });
    }
    const car = carTarget();
    if (car) offer({ kind: "car", car, distance: car.distance });
    const npc = talkTarget();
    if (npc) { const near = nearestNpc(quests.npcs, player.x, player.z); if (near) offer({ kind: "npc", npc, distance: near.distance }); }
    if (use !== null) offer({ kind: "rpg", distance: use });
    const station = mode === "walk" ? nearbyLift() : null;
    if (station !== null) { const p = worldToLocal(STATIONS[station], player.x, player.z); offer({ kind: "lift", station, distance: Math.hypot(p.u - 9, p.v - 20) }); }
    let best: Target | null = null;
    for (const candidate of found) if (!best || candidate.distance < best.distance) best = candidate; // strict: earlier offers win ties
    // Hysteresis: last pick's target, while still on offer, keeps the prompt unless another is closer
    // by more than TARGET_MARGIN (an NPC walking past a door, or two adjacent doors, never flip it
    // frame to frame). interaction() and interact() both read this, so the prompt is what E does.
    const held = heldTarget, kept = held ? found.find(candidate => sameTarget(candidate, held)) : undefined;
    if (kept && best && best.distance >= kept.distance - TARGET_MARGIN) best = kept;
    heldTarget = best;
    return best;
  }
  function sameTarget(a: Target, b: Target): boolean {
    switch (a.kind) {
      case "door": return b.kind === "door" && b.place.id === a.place.id;
      case "car": return b.kind === "car" && b.car.parked === a.car.parked && b.car.traffic === a.car.traffic;
      case "npc": return b.kind === "npc" && b.npc === a.npc;
      case "rpg": return b.kind === "rpg";
      case "lift": return b.kind === "lift" && b.station === a.station;
    }
  }

  function enterInterior(place: InteriorPlace): void {
    interiors.enter(place, player);
    rpg.bus.emit({ type: "entered", area: `interior:${place.id}` });
    cameraHeight = WALK_HEIGHT; verticalVelocity = 0; speed = 0;
    keys.clear(); rpgInput.release();
    eased.forward = eased.strafe = eased.sprint = eased.up = 0;
    mouse.reset(player.yaw, player.pitch);
    broadcast.hide(); // Ambience: stays on indoors; update() muffles the street and adds a room tone
    publishPose();
  }

  // Upper floors: a tall building's lift (upper-floors.ts) moves the visitor between its listed floors.
  let liftRide = -Infinity; // performance.now() of the last ride: a held or repeated E rides once
  /** True when E calls the lift here (an RPG action under the visitor's hand wins). */
  function liftFirst(): boolean {
    if (!interiors.active || !interiors.liftAt(player.x, player.z)) return false;
    const use = rpg.interactionDistance();
    return use === null || use > 1;
  }
  /** Rides to the next stop. The new floor is a new visit (its scene's eased arrival fade, <= 0.5 s);
   * the camera only moves to the new floor's lift landing, never animates. */
  function rideLift(): void {
    const now = performance.now(), from = interiors.active;
    if (!from || now - liftRide < 700) return;
    const place = interiors.ride(player);
    if (!place) return;
    liftRide = now;
    rpg.bus.emit({ type: "left", area: `interior:${from.id}` });
    rpg.bus.emit({ type: "entered", area: `interior:${place.id}` });
    cameraHeight = WALK_HEIGHT; verticalVelocity = 0; speed = 0;
    keys.clear(); rpgInput.release();
    eased.forward = eased.strafe = eased.sprint = eased.up = 0;
    mouse.reset(player.yaw, player.pitch);
    publishPose();
  }

  function leaveInterior(): void {
    if (!interiors.active) return;
    rpg.bus.emit({ type: "left", area: `interior:${interiors.active.id}` });
    interiors.leave(player);
    cameraHeight = WALK_HEIGHT; verticalVelocity = 0; speed = 0;
    eased.forward = eased.strafe = eased.sprint = eased.up = 0;
    rpgInput.release();
    mouse.reset(player.yaw, player.pitch);
    if (profile.holograms) broadcast.show();
    ambience.set(running && settings.sound);
    doorFade = settings.effects ? 0 : 1; // effects off: the documented instant cut
    publishPose();
  }

  function currentPose(): LocalPose {
    // Monorail seats: a seated eye is lower, but others see the rider standing on the aisle spot (feet on the floor).
    const pose = localPose({ x: player.x, z: player.z, eye: seated && passenger ? floorHeight(trainAt(metroTime, passenger.train), passenger.v) + TRAIN_EYE_HEIGHT : cameraHeight, yaw: player.yaw, pitch: player.pitch, speed: passenger ? passengerSpeed : speed, mode, car: drive?.car ?? null, rideHeading, inTrain: !!passenger, place: interiors.active?.id ?? "", carrier: passenger ? { train: passenger.train, u: passenger.u, v: passenger.v, yaw: player.yaw - passenger.yaw } : null });
    if (!running) pose.speed = 0;
    return pose;
  }

  function publishPose(): void {
    link?.publish(currentPose(), performance.now() / 1000);
  }

  function inspect(command: InspectionCommand): void {
    if (command.kind === "view" || command.kind === "camera") leaveInterior();
    if (command.kind === "view" || command.kind === "camera") exitCar(true); // Driving
    if (command.kind === "freeze") frozen = command.value;
    else if (command.kind === "clock" || command.kind === "step") {
      const seconds = Math.max(0, Math.min(600, command.seconds));
      const target = command.kind === "clock" ? seconds : time + seconds;
      if (command.kind === "clock") { time = 0; metroTime = 0; population = new CityPopulation(world); traffic = new CityTraffic(); }
      while (time < target - 0.00001) {
        const dt = Math.min(0.1, target - time); time += dt; metroTime += dt;
        population.update(dt, time, metroTime, player); traffic.update(dt, time);
      }
      if (passenger) { const train = trainAt(metroTime, passenger.train); Object.assign(player, localToWorld(train, passenger.u, passenger.v)); player.yaw = train.yaw; mouse.reset(train.yaw, player.pitch); passenger.yaw = train.yaw; }
    } else if (command.kind === "room") {
      // Captures and checks: straight into any place by id (a ground or upper floor too); `at: "lift"`
      // stands at its first lift, ready for E.
      const place = interiors.placeById(command.id);
      if (!place) return;
      exitCar(true); leaveInterior();
      passenger = null; platform = null; lift = null; journey = null; verticalVelocity = 0; mode = "walk";
      enterInterior(place);
      const landing = command.at === "lift" ? interiors.landingPose() : null;
      if (landing) { Object.assign(player, landing); mouse.reset(player.yaw, player.pitch); publishPose(); }
    } else if (command.kind === "view") {
      const view = SCENE_VIEWS.find(view => view.id === command.id);
      if (!view) return;
      passenger = null; platform = null; lift = null; journey = null; verticalVelocity = 0;
      player.x = view.x; player.z = view.z; cameraHeight = view.height; player.yaw = view.yaw; player.pitch = view.pitch;
      mode = view.height > WALK_HEIGHT ? "fly" : "walk";
      if ("platform" in view) { platform = view.platform; mode = "walk"; Object.assign(player, localToWorld(STATIONS[platform], 7, 22)); }
      if ("train" in view) {
        const train = trainAt(metroTime, view.train); passenger = { train: train.id, u: 0, v: 19, yaw: train.yaw }; mode = "metro";
        Object.assign(player, localToWorld(train, 0, 19)); player.yaw = train.yaw;
      }
      mouse.reset(player.yaw, player.pitch);
    } else {
      passenger = null; platform = null; lift = null; journey = null; mode = command.height > WALK_HEIGHT ? "fly" : "walk";
      player.x = Math.max(-WORLD_EDGE + 4, Math.min(WORLD_EDGE - 4, command.x)); player.z = Math.max(-WORLD_EDGE + 4, Math.min(WORLD_EDGE - 4, command.z));
      cameraHeight = Math.max(WALK_HEIGHT, Math.min(380, command.height));
      player.yaw = command.yaw; player.pitch = Math.max(-1.3, Math.min(1.2, command.pitch)); mouse.reset(player.yaw, player.pitch);
    }
    snapshot();
  }

  function pause(): void {
    running = false;
    publishPose();
    keys.clear();
    touchForward = 0;
    touchStrafe = 0;
    touchSprint = false;
    eased.forward = eased.strafe = eased.sprint = eased.up = 0;
    rpgInput.release(); if (ready) rpg.save(interiors.outdoorPose(player)); // RPG
    mouse.reset(player.yaw, player.pitch);
    drag = undefined;
    ambience.set(false);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    if (ready && active()) snapshot();
  }

  /** Exponential approach of the movement input toward the keys/joystick; `rate` per second. */
  function easeMovement(forward: number, strafe: number, sprint: boolean, up: number, dt: number, rate: number): void {
    const k = 1 - Math.exp(-rate * dt), stop = 1 - Math.exp(-rate * 1.4 * dt);
    const approach = (current: number, target: number) => current + (target - current) * (Math.abs(target) < Math.abs(current) ? stop : k);
    eased.forward = approach(eased.forward, forward);
    eased.strafe = approach(eased.strafe, strafe);
    eased.up = approach(eased.up, up);
    eased.sprint = approach(eased.sprint, sprint ? 1 : 0);
    for (const key of ["forward", "strafe", "up", "sprint"] as const) if (Math.abs(eased[key]) < 0.002) eased[key] = 0;
  }

  function look(dx: number, dy: number): void {
    if (!running) return;
    mouse.add(dx, dy, settings.sensitivity);
  }

  function setMode(next: "walk" | "fly", mandatory = false): void {
    if (next === "walk" && passenger) { disembark(); return; }
    const departure = departurePosition();
    const anchor = safeLanding(world, departure.x, departure.z);
    const arrival = next === "walk" ? walkArrival(anchor) : null;
    if (next === "walk" && !arrival && !mandatory) { blockedArrival(); return; }
    leaveInterior();
    if (drive) exitCar(true); // Driving: another mode parks the car where it stopped
    journey = null;
    passenger = null; platform = null; lift = null;
    rideHeading = null;
    mode = next;
    verticalVelocity = 0;
    if (next === "walk") settleArrival(anchor, arrival);
    snapshot();
  }

  const listenerOptions = { signal: abort.signal };
  window.addEventListener("keydown", (event) => {
    if (!running || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "Escape") { pause(); callbacks.onPause(); }
    else if (event.code === "KeyM" && !event.repeat) { pause(); callbacks.onMap(); }
    else if (event.code === "KeyT" && !event.repeat) { pause(); callbacks.onTransit(); }
    else if (event.code === "KeyF" && !event.repeat) { if (!drive) setMode(mode === "fly" ? "walk" : "fly"); } // Driving: no flight from the driver's seat
    else if (event.code === "KeyV" && !event.repeat && drive) saveDriveView(drive.toggleView()); // Driving: cockpit / chase camera
    else if (event.code === "KeyE" && !event.repeat) interact();
    else if (event.code === "Space" && mode === "walk" && !event.repeat && cameraHeight <= WALK_HEIGHT + 0.01 && !rpg.dead) verticalVelocity = 7;
    else { keys.add(event.code); if (mode === "walk") rpgInput.key(event.code, true, event.repeat); } // RPG: 1-4, C, X, Q, Z on foot
  }, listenerOptions);
  window.addEventListener("keyup", (event) => { keys.delete(event.code); rpgInput.key(event.code, false); }, listenerOptions);
  // RPG: mouse buttons fight while the pointer is captured (left attack, right block / aim).
  document.addEventListener("mousedown", (event) => { if (running && document.pointerLockElement === canvas) rpgInput.pointer(event.button, true); }, listenerOptions);
  document.addEventListener("mouseup", (event) => rpgInput.pointer(event.button, false), listenerOptions);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault(), listenerOptions);
  window.addEventListener("blur", () => { if (running) { pause(); callbacks.onPause(); } }, listenerOptions);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (running) { pause(); callbacks.onPause(); } frames.stop(); }
    else if (ready && !contextLost) { holdGovernors(performance.now()); frames.start(); }
  }, listenerOptions);
  // Mobile: iOS reclaims WebGL contexts under memory pressure (backgrounded tabs, big pages). A lost
  // context can't be drawn to; stop the loop and let the interface offer a rebuild instead of a dead canvas.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    if (running) pause();
    frames.stop();
    t.noLoop();
    callbacks.onContextLost?.();
  }, listenerOptions);
  canvas.addEventListener("webglcontextrestored", () => callbacks.onContextRestored?.(), listenerOptions);
  // Mobile: some iOS versions report the old size during the rotation animation; measure again after it.
  window.addEventListener("orientationchange", () => setTimeout(resize, 350), listenerOptions);
  document.addEventListener("pointerlockchange", () => {
    drag = undefined;
    mouse.reset(player.yaw, player.pitch);
    if (!document.pointerLockElement && running) { pause(); callbacks.onPause(); }
  }, listenerOptions);
  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement === canvas) look(event.movementX, event.movementY);
  }, listenerOptions);
  canvas.addEventListener("pointerdown", (event) => {
    if (!running || document.pointerLockElement === canvas) return;
    drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
  }, listenerOptions);
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    look(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
  }, listenerOptions);
  const endDrag = () => { drag = undefined; };
  canvas.addEventListener("pointerup", endDrag, listenerOptions);
  canvas.addEventListener("pointercancel", endDrag, listenerOptions);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  t.setup(async () => {
    try {
      if (!await bootStage("materials")) return;
      // Mobile: touch-first devices compile the `lite` material variant (sin-free hash, lighter atmosphere).
      const lite = touchFirst;
      // The reference renderer draws buildings through the scene program and the ground through the full material.
      const sceneSource = referenceRenderer ? cityMaterial({ ground: false, lite }) : lite ? cityMaterial({ lite, ground: false, surfaces: SURFACES.scene }) : CITY_MATERIAL;
      const groundSource = referenceRenderer ? REFERENCE_MATERIAL : lite ? cityMaterial({ reflections: true, lite, surfaces: SURFACES.ground }) : GROUND_MATERIAL;
      const facadeSource = lite ? cityMaterial({ batch: true, opaque: true, lite, architecture: true }) : FACADE_MATERIAL;
      const hologramSource = lite ? cityMaterial({ lite, ground: false, surfaces: SURFACES.hologram }) : HOLOGRAM_MATERIAL;
      const propSource = lite ? cityMaterial({ batch: true, lite, ground: false, surfaces: SURFACES.props }) : BUILDING_MATERIAL;
      // Cold start: link every program in parallel off the main thread first (shader-prewarm.ts); the
      // compiles below then hit the program cache. Skipped where that cannot work (`?prewarm=0` to compare).
      const gl = canvas.getContext("webgl2");
      if (canPrewarm(gl) && new URLSearchParams(location.search).get("prewarm") !== "0") {
        const vertex = await materialVertex(t, gl);
        if (vertex && active()) await prewarmPrograms(gl, [
          { vertex, fragment: sceneSource }, { vertex, fragment: groundSource }, { vertex, fragment: hologramSource }, { vertex, fragment: INTERIOR_MATERIAL },
          { vertex: BUILDING_VERTEX, fragment: facadeSource }, { vertex: PROP_VERTEX, fragment: propSource },
        ], active);
        if (!active()) return;
      }
      const [shader, streetShader, buildingShader, holoShader] = await Promise.all([labelled("scene", () => t.createMaterialShader(sceneSource)), labelled("ground", () => t.createMaterialShader(groundSource)), labelled("facade", () => t.createShader(BUILDING_VERTEX, facadeSource)), labelled("hologram", () => t.createMaterialShader(hologramSource)), t.filters.register("neon-clarity", CLARITY_FILTER, { u_radius: ["radius", 2], u_strength: ["strength", 0.28] }), t.filters.register("view-warp", VIEW_WARP_FILTER, { u_row0: ["row0", [1, 0, 0]], u_row1: ["row1", [0, 1, 0]], u_row2: ["row2", [0, 0, 1]], u_focal: ["focal", 800], u_cell: ["cell", 8], u_origin: ["origin", [0, 0]] })]);
      if (!active()) { if (!contextLost) { shader.dispose(); streetShader.dispose(); buildingShader.dispose(); holoShader.dispose(); } return; }
      material = shader;
      groundMaterial = streetShader;
      hologramMaterial = holoShader;
      const roomShader = await labelled("interior", () => t.createMaterialShader(INTERIOR_MATERIAL));
      if (!active()) { if (!contextLost) roomShader.dispose(); return; }
      interiorMaterial = roomShader;
      if (!await bootStage("scene")) return;
      reflection = t.createFramebuffer({ filter: "nearest", depth: true });
      sceneData = new SceneData(canvas);
      textData = new TextData(canvas, ASCII_BITMAPS, MESSAGES);
      buildingBatch = new BuildingBatch(canvas, buildingShader, world);
      const propShader = await labelled("props", () => t.createShader(PROP_VERTEX, propSource));
      if (!active()) { if (!contextLost) propShader.dispose(); return; }
      propBatch = new PropBatch(canvas, propShader);
      props = new PropRecorder(character => t.font.characterMap.get(character)?.color ?? [0, 0, 0]);
      signs = new SignCanvas(t);
      resize();
      if (!await bootStage("glyphs")) return;
      await applyAtlas();
      if (!active()) return;
      broadcastFeed();
      ready = true;
      // RPG: resume where the save left off (not in the studio, which places its own camera).
      for (const id of rpg.discovered) discovered.add(id);
      const saved = rpg.savedPosition;
      if (saved && new URLSearchParams(location.search).get("studio") !== "1" && world.canOccupy(saved.x, saved.z)) { settleArrival(saved, walkArrival(saved)); player.yaw = saved.yaw; mouse.reset(saved.yaw, player.pitch); }
      t.noLoop();
      if (!document.hidden && !contextLost) frames.start();
      const query = new URLSearchParams(location.search);
      // Mobile: ?perf=1 exposes frame statistics for scripts/mobile-check.mjs.
      if (query.get("perf") === "1") (window as Window & { __nightfallPerf?: () => object }).__nightfallPerf = () => ({ cpuMs: +cpuAverage.toFixed(2), fps: Math.round(1 / frameAverage), level: governor.level, desktopLevel: desktopGovernor.level, window: settings.quality === "auto" ? governor.lastWindow : desktopGovernor.lastWindow, cell: profile.cell, density: pixelDensity, grid: t.grid ? `${t.grid.cols}x${t.grid.rows}` : "", lite, interior: interiors.active?.id ?? null, visibleBuildings, remotePlayers: remoteLabels?.remotes.length ?? 0, sections: perfSections ? Object.fromEntries([...perfSections].map(([name, ms]) => [name, +ms.toFixed(3)])) : null });
      if (query.get("studio") === "1") {
        // Scene-lab only: exposes the renderer for scripted inspection.
        (window as Window & { __nightfall?: { t: Textmodifier; inspect: typeof inspect; rpg: RpgSession; interiors: CityInteriors; parked: ParkedCars; look: typeof look; play: () => void } }).__nightfall = { t, inspect, rpg, interiors, parked, look, play: () => { running = true; frozen = false; } };
        frozen = true;
        inspect({ kind: "view", id: query.get("view") ?? "market" });
        const seconds = Number(query.get("clock") ?? "45");
        if (Number.isFinite(seconds)) inspect({ kind: "clock", seconds });
        const camera = query.get("camera")?.split(",").map(Number);
        if (camera?.length === 5 && camera.every(Number.isFinite)) inspect({ kind: "camera", x: camera[0], height: camera[1], z: camera[2], yaw: camera[3], pitch: camera[4] });
        document.documentElement.dataset.sceneClean = query.get("clean") === "1" ? "true" : "false";
      }
      snapshot();
      callbacks.onReady();
    } catch (error) {
      rendererError(error);
    }
  });

  broadcast.draw(() => { const grid = t.grid; if (!grid) return; if (grid.cols !== 96) grid.cols = 96; if (grid.rows !== 48) grid.rows = 48; });
  weather.draw(() => {
    t.clear();
    if (!ready) return;
    weather.ortho(); weather.resetCamera();
    if (!t.grid) return;
    const cols = t.grid.cols, rows = t.grid.rows;
    const count = !settings.rain || interiors.active || passenger || platform !== null || lift ? 0 : profile.rain; // Mobile: profile
    t.cellColor(0, 0, 0, 0);
    drawRain(t, cols, rows, count); // VFX: world-anchored drops, splashes, drips (vfx-scene.ts)
    if (journey) {
      const dashboard = 6;
      t.char("="); t.charColor(80, 138, 153); t.cellColor(5, 15, 25, 230);
      t.push(); t.translate(0, rows / 2 - dashboard / 2); t.rect(cols, dashboard); t.pop();
      t.char("|");
      for (const side of [-1, 1]) { t.push(); t.translate(side * (cols / 2 - 3), rows * 0.12); t.rect(1, rows * 0.76); t.pop(); }
      t.charColor(169, 231, 210); t.cellColor(0, 0, 0, 0); t.printAlign("center", "middle");
      t.print(journey.mode === "taxi" ? "NIGHT CAB  /  AUTO" : "SKYLINE  /  FLIGHT CONTROL", 0, rows / 2 - 3);
    }
    if (drive) drawDriveDashboard(t, rows, drive.car, keys.has("ShiftLeft") || keys.has("ShiftRight")); // Driving
  });

  hud.draw(() => {
    t.clear();
    if (cleanHud || !ready || !t.grid) return;
    hud.ortho(); hud.resetCamera();
    t.cellColor(0, 0, 0, 0);
    // Speech plates and name tags at full strength (the weather layer composites at 0.55). Same
    // font size as the weather layer, so the same grid; drawn under the combat HUD.
    drawRemoteLabels(t, t.grid.cols, t.grid.rows, remoteLabels); // Multiplayer: crisp name tags over other players
    drawCitizenLabels(t, t.grid.cols, t.grid.rows, citizenLabelFrame);
    if (!hudFrame) return;
    if (!hudLayoutCache || hudColumns !== t.grid.cols || hudRows !== t.grid.rows) {
      hudColumns = t.grid.cols; hudRows = t.grid.rows;
      hudLayoutCache = combatHudLayout(hudColumns, hudRows, hudViewport);
    }
    t.cellColor(0, 0, 0, 0);
    drawCombatOverlay(t, hudColumns, hudRows, hudFrame, hudLayoutCache);
  });

  t.draw(() => {
    if (!ready || !material || !interiorMaterial || !groundMaterial || !hologramMaterial || !reflection || !sceneData || !buildingBatch || disposed || contextLost) return;
    const frameStart = performance.now(); // Mobile: CPU time of this callback, for the governor
    sectionStart = frameStart;
    const rawDt = t.deltaTime() / 1000;
    if (running && !frozen && (settings.quality === "auto" ? governor : desktopGovernor).sample(rawDt * 1000, cpuAverage, frameStart) !== null) applyProfile();
    const dt = Math.min(Math.max(rawDt, 0), 0.15);
    const now = performance.now() / 1000;
    const sharedTime = link?.worldTime(now) ?? null;
    if (sharedTime !== null) metroTime = sharedTime + METRO_TIME_OFFSET;
    else if (!frozen && (running || (settings.motion && !lift))) metroTime += dt;
    carryPassenger();
    passengerSpeed = 0;
    const allRemotes = link?.remotes(now) ?? [];
    const presentRemotes = allRemotes.filter(remote => samePlace(remote.place, interiors.active?.id));
    const remoteCars = nearbyRemoteCars(allRemotes, player, 260);
    const nearbyPlayers = interiors.active ? [] : presentRemotes.filter(remote => remote.mode === "walk" && remote.y < WALKING_CAR_ROOF_CLEARANCE).map(remote => ({ id: remote.id, x: remote.x, y: remote.y, z: remote.z, speed: remote.speed }));
    if (!interiors.active && mode === "walk" && !passenger && platform === null && !lift && !journey && cameraHeight < WALK_HEIGHT + WALKING_CAR_ROOF_CLEARANCE) nearbyPlayers.push({ id: "local", x: player.x, y: Math.max(0, cameraHeight - WALK_HEIGHT), z: player.z, speed });
    frameAverage += (Math.max(rawDt, 0.001) - frameAverage) * 0.035;
    if (settings.motion && !frozen) time += dt;
    const signalTime = sharedTime ?? time;
    signalClock = signalTime;
    const eventNews = cityEventWatch.update(signalTime, player.x, player.z, !running || interiors.active !== null); // City events: the line to announce when a happening starts nearby (once each)
    if (eventNews) callbacks.onQuestUpdate?.(eventNews); // City events: surfaced as a toast
    if (settings.motion && !frozen) {
      population.update(dt, time, metroTime, player, { players: nearbyPlayers, rain: settings.rain, threats: rpg.threats(player) }, signalTime); // Civilians: fights nearby (nearest 8 positions) scatter street life
      mark("people"); // Perf (?perf=1): "people" = population.update; "simulate" is now the rest (road awareness + traffic)
      // Perf: road awareness ignores residents beyond ROAD_AWARENESS_RADIUS of the eye (the same
      // test, in the same order), so only those are handed over instead of all ~3,500.
      roadResidents.length = 0;
      const awareness = ROAD_AWARENESS_RADIUS ** 2;
      for (const walker of population.walkers) if ((walker.x - player.x) ** 2 + (walker.z - player.z) ** 2 <= awareness) roadResidents.push(walker);
      traffic.update(dt, signalTime, trafficBlockers(remoteCars), { eye: player, players: nearbyPlayers, residents: roadResidents });
    }
    // Ambient animation frozen but the trains still run: a zero-time update keeps seated riders
    // attached to their moving train instead of hanging where it was.
    else if (sharedTime !== null || !frozen && running) population.update(0, time, metroTime, player, undefined, signalTime);
    mark("simulate");
    if (mode === "walk" && !interiors.active && !passenger && platform === null && !lift && !journey) {
      // Perf: one reused list instead of three spread arrays per frame (same cars, same order).
      nearbyCars.length = 0;
      for (const car of parked.nearby(player.x, player.z, WALKING_CAR_QUERY_RADIUS)) nearbyCars.push(car);
      for (const car of traffic.nearby(player.x, player.z, WALKING_CAR_QUERY_RADIUS)) nearbyCars.push(car);
      for (const car of remoteCars) nearbyCars.push(car);
      streetCollision.setCars(nearbyCars, Math.max(0, cameraHeight - WALK_HEIGHT));
    }
    if (running) {
      if (keys.has("ArrowLeft") && !drive) mouse.turn(-dt * 1.35); // Driving: arrows steer instead
      if (keys.has("ArrowRight") && !drive) mouse.turn(dt * 1.35);
      mouse.update(dt);
      player.yaw = mouse.yaw;
      player.pitch = mouse.pitch;
      const forward = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown")) + touchForward;
      const strafe = Number(keys.has("KeyD")) - Number(keys.has("KeyA")) + touchStrafe;
      const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight") || touchSprint; // Mobile: joystick push
      const oldX = player.x, oldZ = player.z;
      if (lift || passenger || platform !== null || journey || drive) eased.forward = eased.strafe = eased.sprint = eased.up = 0;
      if (lift) {
        lift.elapsed = Math.min(3.6, lift.elapsed + dt);
        const phase = lift.elapsed / 3.6, ease = phase * phase * (3 - 2 * phase);
        liftHeight = lift.from + (lift.to - lift.from) * ease;
        cameraHeight = liftHeight + WALK_HEIGHT;
        speed = 0;
        if (phase >= 1) { platform = lift.to > 0 ? lift.station : null; lift = null; }
      } else if (passenger) {
        const train = trainAt(metroTime, passenger.train);
        const oldU = passenger.u, oldV = passenger.v;
        const onSeat = rideSeat(train, dt, Math.hypot(forward, strafe) > 0.2); // Monorail seats: the seat owns the eye; WASD stands up
        if (!onSeat) {
          moveInTrain(passenger, player.yaw, forward, strafe, dt);
          Object.assign(player, localToWorld(train, passenger.u, passenger.v));
          cameraHeight = floorHeight(train, passenger.v) + TRAIN_EYE_HEIGHT;
        }
        passengerSpeed = Math.hypot(passenger.u - oldU, passenger.v - oldV) / Math.max(dt, 0.001);
        speed = train.speed;
        const rightward = Math.sin(player.yaw - train.yaw) * forward + Math.cos(player.yaw - train.yaw) * strafe;
        if (!onSeat && passenger.u > 2.12 && rightward > 0 && train.doors > 0.85) disembark();
        player.distance += Math.hypot(player.x - oldX, player.z - oldZ);
      } else if (platform !== null) {
        const station = STATIONS[platform], p = worldToLocal(station, player.x, player.z);
        const angle = player.yaw - station.yaw, step = (sprint ? 8 : 5.5) * dt / Math.max(1, Math.hypot(forward, strafe));
        const u = p.u + (Math.sin(angle) * forward + Math.cos(angle) * strafe) * step;
        const v = Math.max(-25.5, Math.min(25.5, p.v + (-Math.cos(angle) * forward + Math.sin(angle) * strafe) * step));
        const train = boardingTrain(metroTime, platform);
        if (u < 3.45 && doorAt(v) && train) board(train, v);
        else Object.assign(player, localToWorld(station, Math.max(3.5, Math.min(9.6, u)), v));
        if (!passenger) cameraHeight = station.height + WALK_HEIGHT; // boarding set the carriage eye
        speed = Math.hypot(player.x - oldX, player.z - oldZ) / Math.max(dt, 0.001);
        player.distance += Math.hypot(player.x - oldX, player.z - oldZ);
      } else if (journey) {
        const position = { x: player.x, y: cameraHeight, z: player.z };
        const result = advanceJourney(journey, position, dt);
        player.x = position.x; player.z = position.z; cameraHeight = position.y;
        speed = result.speed;
        if (result.heading !== null) rideHeading = result.heading; // the vehicle body (multiplayer pose)
        // Motion comfort: the camera never whips round a corner. It turns into the next street over the
        // last metres at a capped, eased rate (locomotion.ts stepRideTurn); mouse look stays an offset.
        if (!rideTurn || rideTurn.journey !== journey) rideTurn ={ journey, heading: mouse.targetYaw, rate: 0, target: mouse.targetYaw };
        mouse.turn(stepRideTurn(rideTurn, journeyLookHeading(journey, position), dt));
        player.distance += Math.hypot(player.x - oldX, player.z - oldZ);
        if (result.done) setMode("walk", true);
      } else if (drive) {
        // Driving: W/S (arrows) throttle, brake, reverse; A/D (arrows) steer; Space handbrake; Shift boost.
        const steer = strafe + Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
        const view = drive.update(world, { throttle: Math.max(-1, Math.min(1, forward)), steer: Math.max(-1, Math.min(1, steer)), handbrake: keys.has("Space"), boost: sprint }, dt, mouse, driveObstacles(drive.car.x, drive.car.z, remoteCars));
        player.x = view.x; player.z = view.z; cameraHeight = view.height; player.yaw = view.yaw; player.pitch = view.pitch;
        speed = Math.abs(drive.car.speed);
        player.distance += view.moved;
      } else if (mode === "fly") {
        const up = Number(keys.has("Space") || keys.has("KeyQ")) - Number(keys.has("ControlLeft") || keys.has("KeyC"));
        easeMovement(forward, strafe, sprint, up, dt, 5);
        const f = eased.forward, s = eased.strafe;
        const step = (32 + 48 * eased.sprint) * dt / Math.max(1, Math.hypot(f, s));
        player.x = Math.max(-WORLD_EDGE + 4, Math.min(WORLD_EDGE - 4, player.x + (Math.sin(player.yaw) * f * Math.cos(player.pitch) + Math.cos(player.yaw) * s) * step));
        player.z = Math.max(-WORLD_EDGE + 4, Math.min(WORLD_EDGE - 4, player.z + (-Math.cos(player.yaw) * f * Math.cos(player.pitch) + Math.sin(player.yaw) * s) * step));
        cameraHeight = Math.max(WALK_HEIGHT, Math.min(380, cameraHeight + (eased.up - Math.sin(player.pitch) * f) * step));
        player.distance += Math.hypot(player.x - oldX, player.z - oldZ);
        speed = Math.hypot(player.x - oldX, player.z - oldZ) / Math.max(dt, 0.001);
      } else {
        easeMovement(rpg.dead ? 0 : forward, rpg.dead ? 0 : strafe, sprint && !rpg.inCombat, 0, dt, 9);
        // Substep collisions; a long render frame must not slow down walking. RPG: blocking, aiming and
        // dodging scale walking (the roll itself arrives as a displacement from the combat step).
        const pace = Math.min(1, rpg.playerView().moveScale ?? 1);
        const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        for (let i = 0; i < steps; i++) movePlayer(interiors.active ? interiors : streetCollision, player, eased.forward * pace, eased.strafe * pace, eased.sprint, dt / steps);
        verticalVelocity -= 18 * dt;
        cameraHeight = Math.max(WALK_HEIGHT, cameraHeight + verticalVelocity * dt);
        if (interiors.active && cameraHeight > INTERIOR_HEIGHT - 0.45) { cameraHeight = INTERIOR_HEIGHT - 0.45; verticalVelocity = 0; }
        if (cameraHeight <= WALK_HEIGHT) verticalVelocity = 0;
        speed = Math.hypot(player.x - oldX, player.z - oldZ) / Math.max(dt, 0.001);
      }
    }
    // RPG: combat, loot and quests for this frame, on foot at street level only; the combat step's
    // displacement (dodge, knockback, lock-on magnetism) goes through the walking collision.
    const onFoot = mode === "walk" && !interiors.active && !passenger && platform === null && !lift && !journey && !drive;
    if (running && !frozen) {
      const forwardIntent = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown")) + touchForward;
      const strafeIntent = Number(keys.has("KeyD")) - Number(keys.has("KeyA")) + touchStrafe;
      const input = rpgInput.frame(onFoot ? forwardIntent : 0, onFoot ? strafeIntent : 0);
      const { move } = rpg.update({ dt, time, player: { x: player.x, z: player.z, eye: cameraHeight, yaw: player.yaw, pitch: player.pitch, mode, onFoot, place: interiors.active?.id ?? "" }, input });
      { const crime = population.assault(rpg.takePlayerAttack(), signalTime), alert = crime ? rpg.civilianAssault(crime.x, crime.z) : null; if (alert) callbacks.onQuestUpdate?.(alert); } // Civilians: a swing or shot on/near a civilian reports a crime (toast at most once a minute)
      if (move && onFoot) {
        const steps = Math.max(1, Math.ceil(Math.hypot(move.x, move.z) / 0.3));
        for (let i = 0; i < steps; i++) {
          if (streetCollision.canOccupy(player.x + move.x / steps, player.z)) player.x += move.x / steps;
          if (streetCollision.canOccupy(player.x, player.z + move.z / steps)) player.z += move.z / steps;
        }
      }
    }
    // Multiplayer: send our pose (throttled by the link) and adopt the party's quest state when it changes.
    if (link) {
      publishPose();
      const party = link.questSync();
      if (party && party.key !== partyKey) partyKey = party.key; // RPG: solo quest engine; party state not adopted yet
    }
    mark("player");
    if (interiors.active) {
      const place = interiors.active;
      hudFrame = null; citizenLabelFrame = null; visibleBuildings = 0;
      remoteLabels = presentRemotes.length ? { remotes: presentRemotes, cam: { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch: player.pitch, fov: 62, aspect: t.grid ? t.grid.cols / t.grid.rows : canvas.width / Math.max(1, canvas.height) } } : null;
      counts = { cars: 0, residents: 2 };
      t.layers.base.offset(0, 0);
      t.clear(); t.background(8, 12, 19);
      t.perspective(62, 0.12, 60);
      t.camera(player.x, -cameraHeight, player.z, player.x + Math.sin(player.yaw) * Math.cos(player.pitch), -cameraHeight + Math.sin(player.pitch), player.z - Math.cos(player.yaw) * Math.cos(player.pitch), 0, 1, 0);
      t.shader(interiorMaterial);
      t.setUniforms({ u_eye: [player.x, -cameraHeight, player.z], u_room: [place.x, 0, place.z], u_tint: place.color.map(channel => channel / 255) });
      setInteriorView(t.grid ? t.grid.rows : 120, 62); // real grid rows + the interior FOV above: sign legibility follows the actual cell size
      drawInterior(t, place, interiors.fixtures, time, profile.low, settings.effects, roomWork);
      drawInteriorInteractables(t, place, rpg.interactables(place.id));
      drawInteriorPlayers(t, presentRemotes, time);
      t.resetShader();
      if (settings.effects && profile.bloom) t.filter("neon-clarity", { radius: 2 * pixelDensity, strength: 0.18 });
      if (performance.now() - lastSnapshot > 160) { lastSnapshot = performance.now(); snapshot(); }
      cpuAverage += (performance.now() - frameStart - cpuAverage) * 0.05;
      return;
    }
    const baseRadius = radiusOverride > 0 ? radiusOverride : profile.baseRadius; // Mobile: profile (desktop presets: see quality-governor.ts)
    // The draw distance eases when altitude or quality changes; fog reaches the sky colour
    // exactly there, so buildings emerge from and dissolve into the dark instead of popping.
    const targetDistance = Math.min(MAX_DRAW_BLOCKS, baseRadius + Math.floor(cameraHeight / 40)) * BLOCK_SIZE;
    viewDistance = viewDistance === 0 ? targetDistance : viewDistance + (targetDistance - viewDistance) * (1 - Math.exp(-dt * 1.2));
    fadeIn = Math.min(1, fadeIn + dt / 1.6);
    doorFade = Math.min(1, doorFade + Math.min(dt, 0.05) / DOOR_FADE_SECONDS); // a hitch on the doorstep cannot skip the fade
    const reveal = fadeIn * fadeIn * (3 - 2 * fadeIn) * doorReveal(doorFade);
    const radius = Math.ceil(Math.max(targetDistance, viewDistance) / BLOCK_SIZE);
    const cache = `${Math.floor(player.x / BLOCK_SIZE)},${Math.floor(player.z / BLOCK_SIZE)},${radius}`;
    if (cache !== blockCache) { blockCache = cache; blocks = world.nearbyBlocks(player.x, player.z, radius); }
    const eyeY = -cameraHeight;
    const pitch = player.pitch;
    // Comfort: a slightly wider view (62 deg vertical, ~95 deg horizontal at 16:9) moves the image
    // fewer pixels per degree of turn than the old 58; the driving FOV kick is kept small.
    const fov = 62 + (drive?.fovKick ?? 0);
    const projectionAspect = t.grid ? t.grid.cols / t.grid.rows : canvas.width / Math.max(1, canvas.height);
    // Smooth turning: the view is rendered with yaw and pitch snapped to whole-cell steps, so
    // characters re-sample once per cell of rotation instead of every frame, and the view-warp
    // filter re-projects every pixel by the sub-cell remainder - an exact rotation across the whole
    // screen, so the periphery glides as smoothly as the centre (view-warp.ts).
    const focalCells = ((t.grid?.rows ?? 1) / 2) / Math.tan(fov * Math.PI / 360);
    const snap = warpMode === "none" ? (v: number) => v : (v: number) => Math.round(v * focalCells) / focalCells;
    const viewYaw = snap(player.yaw), viewPitch = snap(pitch);
    if (warpMode === "offset") t.layers.base.offset(-(player.yaw - viewYaw) * focalCells * (t.grid?.cellWidth ?? 0), -(pitch - viewPitch) * focalCells * (t.grid?.cellHeight ?? 0));
    else {
      const [row0, row1, row2] = warpMode === "identity" ? rotationWarp(0, 0, 0, 0) : rotationWarp(player.yaw, pitch, viewYaw, viewPitch);
      t.layers.base.filter("view-warp", { row0, row1, row2, focal: focalCells * fontSize(), cell: fontSize(), origin: [t.grid?.offsetX ?? 0, canvas.height - (t.grid?.offsetY ?? 0) - (t.grid?.height ?? canvas.height)] });
    }
    const halfFov = Math.atan(Math.tan(fov * Math.PI / 360) * projectionAspect);
    const reach = propReach(t.grid?.rows ?? 120); // LOD: prop ranges follow the cell footprint
    // Perf: the buildings of the 5x5 blocks around the eye, nearest first (occluders, light
    // blockers, lamp sources). Rebuilt only when the eye moves; same order as the old per-frame sort.
    if (nearX !== player.x || nearZ !== player.z || nearBlocks !== blocks) {
      nearX = player.x; nearZ = player.z; nearBlocks = blocks;
      near.length = 0;
      for (const block of world.nearbyBlocks(player.x, player.z, 2)) for (const building of block.buildings) near.push(building);
      near.sort((a, b) => (a.x - player.x) ** 2 + (a.z - player.z) ** 2 - (b.x - player.x) ** 2 - (b.z - player.z) ** 2);
      blockers.length = 0;
      for (let i = 0; i < near.length && i < 18; i++) blockers.push(near[i]);
    }
    const eye = { x: player.x, y: cameraHeight, z: player.z };
    // Reach of the per-building scene walks (shops, VFX, screens). Beyond it only the buildings a
    // far consumer can use stay in `visible`: towers (holograms >= 70 m, searchlights >= 85 m) and
    // hologram screens (id % 17). Every other building is culled before the occlusion test, which
    // is what made a long draw distance expensive on the CPU (the chunks are culled separately).
    const shopReach = (profile.low ? 200 : SIGN_REACH) * reach;
    const visible: { building: Building; distance: number }[] = [];
    // Perf: the yaw terms are loop invariants, and the cone margin is only computed when it is used.
    const viewSin = Math.sin(player.yaw), viewCos = Math.cos(player.yaw), coneTest = Math.abs(pitch) < 0.85;
    // Perf: looking steeply down (flight, the top-down view) the horizontal cone test is off, and
    // the whole draw distance used to be walked, drawn and propped. A 3D cone that contains the
    // frustum culls instead. Its spheres are centred on the ground and reach as far below it as
    // above, so whatever the puddle mirror sees (the scene mirrored in y = 0) is kept too.
    if (!coneTest) steepCone.set(player.x, cameraHeight, player.z, player.yaw, pitch, fov, projectionAspect);
    // Perf: exact shortcuts around the per-building trig (same answers, see coneKeep/coneCull).
    // A squared distance beyond the reach (with a 1e-9 relative margin for rounding) is certainly
    // beyond it, so most of the walk skips Math.hypot. The cone's limit angle,
    // halfFov + (0.25 + asin(min(1, 30 / d))), lies between halfFov + 0.25 and (beyond 55 m)
    // halfFov + (0.25 + asin(30 / 55)), below pi, where cos falls: so a building facing within
    // coneKeep is always kept and one outside coneCull always culled; only the band between them
    // needs its own asin and cos.
    const farLimit = viewDistance + 12, farSquared = farLimit * farLimit * (1 + 1e-9);
    const coneKeep = Math.cos(halfFov + 0.25), coneCull = Math.cos(halfFov + (0.25 + Math.asin(30 / 55)));
    for (const block of blocks) for (const building of block.buildings) {
      const dx = building.x - player.x, dz = building.z - player.z;
      if (dx * dx + dz * dz > farSquared) continue;
      const distance = Math.hypot(dx, dz);
      if (distance > farLimit) continue;
      if (coneTest && distance > 55) {
        const facing = (dx * viewSin - dz * viewCos) / distance;
        if (facing < coneKeep && (facing < coneCull || facing < Math.cos(halfFov + (0.25 + Math.asin(Math.min(1, 30 / Math.max(1, distance))))))) continue;
      }
      // Towers that carry holograms or searchlights stay (their projections reach beyond the mass).
      if (!coneTest && building.height < FAR_VISIBLE_HEIGHT && !steepCone.sees(building.x, 0, building.z, Math.hypot(building.width / 2, building.depth / 2, building.height))) continue;
      if (distance >= shopReach && building.height < FAR_VISIBLE_HEIGHT && building.id % 17 !== 0 && !referenceRenderer) continue;
      if (distance > 100 && fullyHidden(eye, building, blockers)) continue;
      visible.push({ building, distance });
    }
    // Building chunks: whole city blocks from the static buffer, in range and in view, nearest
    // first so near facades fill the depth buffer before the ones they hide are shaded.
    // Perf: each block's chunk is looked up once when the block set changes, not by string key per frame.
    if (slotBlocks !== blocks) {
      slotBlocks = blocks;
      blockSlots.length = 0;
      for (const block of blocks) {
        const chunk = buildingBatch.chunks.get(`${block.x},${block.z}`);
        let top = 0;
        for (const building of block.buildings) top = Math.max(top, building.height);
        if (chunk) blockSlots.push({ chunk, distance: 0, top });
      }
    }
    slotList.length = 0;
    for (const slot of blockSlots) {
      const chunk = slot.chunk, dx = chunk.x - player.x, dz = chunk.z - player.z, distance = Math.hypot(dx, dz);
      if (distance - 46 > viewDistance + 12) continue;
      // Perf: as for buildings, a block facing within coneKeep (the limit angle is at least
      // halfFov + 0.25) is kept without the asin and cos.
      if (distance > 70 && coneTest) {
        const facing = (dx * viewSin - dz * viewCos) / distance;
        if (facing < coneKeep && facing < Math.cos(halfFov + 0.25 + Math.asin(Math.min(1, 50 / distance)))) continue;
      }
      // Steep views: the block's footprint (46 m half-diagonal) and its tallest building.
      if (!coneTest && !steepCone.sees(chunk.x, 0, chunk.z, Math.hypot(46, slot.top))) continue;
      slot.distance = distance; slotList.push(slot);
    }
    slotList.sort((a, b) => a.distance - b.distance);
    chunks.length = 0; mirrorChunks.length = 0; visibleBuildings = 0;
    for (const slot of slotList) {
      chunks.push(slot.chunk); visibleBuildings += slot.chunk.buildings;
      // LOD: the puddle reflection draws only the blocks within MIRROR_REACH (it is a thin band of
      // the frame, and distant reflections are mostly fog).
      if (slot.distance - 46 <= MIRROR_REACH + 12) mirrorChunks.push(slot.chunk);
    }
    // Occluders for the material's light blocking and contact shading: the 10 nearest buildings
    // (texels 16-25 boxes, 26-35 heights), empty slots far away.
    for (let i = 0; i < 10; i++) {
      const b = near[i];
      if (b) { sceneData.set4(i + 16, b.x, b.z, b.width / 2, b.depth / 2); sceneData.set4(i + 26, b.height); }
      else { sceneData.set4(i + 16, 9999, 9999, 0, 0); sceneData.set4(i + 26, 0); }
    }
    const lamps = near.slice(0, 6).map(b => {
      const faces = facesOf(b).slice(0, 2).sort((a, c) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(c.x - player.x, c.z - player.z));
      const f = faces[0], angle = f.yaw * Math.PI / 180;
      return { position: [f.x + Math.sin(angle), -f.y, f.z + Math.cos(angle), 32], color: f.color.map(v => v / 255) };
    });
    for (const lamp of nearestStreetLamps(player.x, player.z, 2)) lamps.push({ position: [lamp.x, -8, lamp.z, 35], color: [1, 0.66, 0.32] });
    while (lamps.length < 8) lamps.push({ position: [0, -1000, 0, 1], color: [0, 0, 0] });
    if (passenger || platform !== null) {
      const floor = passenger ? floorHeight(trainAt(metroTime, passenger.train), passenger.v) : STATIONS[platform ?? 0].height;
      lamps[6] = { position: [player.x, -floor - 4.1, player.z - 4, 18], color: [1, 0.84, 0.54] };
      lamps[7] = { position: [player.x, -floor - 4.1, player.z + 4, 18], color: [0.7, 0.79, 0.65] };
    }
    lamps.forEach((lamp, i) => { sceneData?.set(i, lamp.position); sceneData?.set(i + 8, lamp.color); });
    sceneData.set4(36, player.x, eyeY, player.z);
    const feed = broadcast.drawFramebuffer?.textures ?? [];
    const common = { u_text: textData?.texture ?? sceneData.texture, u_feedGlyph: feed[0] ?? sceneData.texture, u_feedInk: feed[1] ?? sceneData.texture, u_feedPaper: feed[2] ?? sceneData.texture, u_scene: sceneData.texture, u_time: time, u_rain: settings.rain ? 1 : 0, u_atmosphere: settings.effects && profile.atmosphere ? 1 : 0, u_viewRadius: viewDistance, u_fadeIn: reveal };
    // Holograms (SURFACE 7) are drawn with their own program in both passes (materials.ts SURFACES).
    // textmode drops a program's texture bindings when another program is used, so every switch
    // re-applies the pass uniforms; the switch itself costs one batch flush.
    const holoProgram = hologramMaterial, sceneProgram = material;
    const passUniforms = (mirror: boolean) => mirror ? { ...common, u_mirror: 1, u_atmosphere: 0 } : { ...common, u_mirror: 0 };
    const hologramProgram = (on: boolean, mirror: boolean) => {
      t.shader(on ? holoProgram : sceneProgram);
      t.setUniforms(on ? { ...passUniforms(mirror), u_surface: 7, u_holoFrame: [0, 0] } : passUniforms(mirror));
    };
    visibility.clear();
    const yawSin = viewSin, yawCos = viewCos; // Perf: hoisted out of isVisible
    const pointCone = Math.cos(halfFov + 0.25), wideCone = Math.abs(pitch) < 0.85, sight = { x: 0, y: 0, z: 0 };
    // `radius` is the prop's horizontal half-extent: a wide awning or fascia next to the camera stays
    // drawn while any of it is on screen, not only while its centre is (they used to vanish at the
    // edge of the view as you turned).
    const isVisible = (x: number, y: number, z: number, radius = 0) => {
      // Perf: the view-cone test is cheap and was never cached, so it runs before the cache lookup.
      // A point prop's cone margin (radius 0: asin(0) = 0) is a frame constant.
      const dx = x - player.x, dz = z - player.z, distance = Math.hypot(dx, dz);
      // A prop with a positive radius only widens the cone (its limit angle is at least halfFov + 0.25),
      // so one facing within pointCone is kept without the asin and cos; same answers as before.
      if (distance > 10 + radius && wideCone) {
        const facing = (dx * yawSin - dz * yawCos) / distance;
        if (radius === 0 ? facing < pointCone : (facing < pointCone || radius < 0) && facing < Math.cos(halfFov + 0.25 + Math.asin(Math.min(1, radius / Math.max(distance, 1e-3))))) return false;
      }
      // Steep views (see steepCone): a prop of up to ~2 m around (x, y, z), or its mirror image.
      if (!wideCone && !steepCone.sees(x, 0, z, Math.hypot(Math.max(radius, 2), Math.abs(y) + 2))) return false;
      const cached = visibility.get(x, y, z, radius);
      if (cached !== undefined) return cached;
      // Props are visible when any part could be: test the centre and two points either side.
      const spread = Math.max(3, radius), sideX = yawCos * spread, sideZ = yawSin * spread;
      sight.y = y;
      sight.x = x; sight.z = z;
      let seen = visibleFrom(eye, sight, near);
      if (!seen) { sight.x = x + sideX; sight.z = z + sideZ; seen = visibleFrom(eye, sight, near); }
      if (!seen) { sight.x = x - sideX; sight.z = z - sideZ; seen = visibleFrom(eye, sight, near); }
      visibility.set(x, y, z, radius, seen); return seen;
    };
    const view = { x: player.x, z: player.z, yaw: player.yaw, height: cameraHeight, time, signalTime, rain: settings.rain, low: profile.low, reach, visible: isVisible }; // Mobile: profile
    beginVfxFrame({ cam: { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch, fov, aspect: projectionAspect }, time, rows: t.grid?.rows ?? 1, rain: settings.rain, low: view.low, lamps, near, visible, isVisible, hologramProgram: on => hologramProgram(on, false) }, rawDt); // VFX
    const vehicles = traffic.nearby(player.x, player.z, (view.low ? 160 : 280) * reach);
    // Car lights for the material: nearest cars first, up to 12 slots (texels 240-251).
    // Perf: only the 12 nearest can get a slot, so they are selected (ties keep list order, as the
    // stable sort of every car did) instead of mapping and sorting every car in range.
    const headlights: { x: number; z: number; yaw: number; intensity: number }[] = [];
    nearestCars(vehicles, player.x, player.z, 12, headlights, (view.low ? 160 : 280) * reach); // the farthest slots fade out toward the first excluded car
    if (drive) headlights.unshift({ x: drive.car.x, z: drive.car.z, yaw: drive.car.yaw, intensity: 1 }); // Driving: the player car always gets a slot
    const remotes = presentRemotes;
    remoteLabels = remotes.length ? { remotes, cam: { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch, fov, aspect: projectionAspect }, visible: isVisible } : null; // Multiplayer
    mergeRemoteHeadlights(headlights, remotes, player.x, player.z, !!drive); // Multiplayer: their cars light the street too
    for (let i = 0; i < 12; i++) { const car = headlights[i]; if (car) sceneData.set4(240 + i, car.x, car.z, car.yaw, car.intensity); else sceneData.set4(240 + i, 0); }
    sceneData.upload();
    const citizens = population.nearby(player.x, player.z, (view.low ? 110 : 220) * reach);
    citizenLabelFrame = mode === "walk" ? { citizens, cam: { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch, fov, aspect: projectionAspect }, time: signalClock, visible: isVisible } : null;
    const rpgEnemies = rpg.enemies(player); // RPG
    const vfxCam = { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch, fov, aspect: projectionAspect };
    const combatView = rpg.playerView();
    hudFrame = { cam: vfxCam, effects: rpg.effects(), enemies: rpgEnemies, lockTarget: rpg.combat.lockTarget(), player: combatView, boss: rpg.combat.boss(), prompt: null, visible: isVisible, weapon: rpg.weapon(), time };
    const parkedNearby = parked.nearby(player.x, player.z, view.low ? 90 : 140); // Driving
    const camera = (mirror: boolean) => {
      const y = mirror ? cameraHeight : eyeY;
      t.perspective(fov, 0.12, 1800);
      t.camera(player.x, y, player.z, player.x + Math.sin(viewYaw) * Math.cos(viewPitch), y + Math.sin(viewPitch) * (mirror ? -1 : 1), player.z - Math.cos(viewYaw) * Math.cos(viewPitch), 0, mirror ? -1 : 1, 0);
    };
    // Props are recorded once per frame into GPU instances (one draw per mesh) and reused by the
    // reflected and main passes. Sign panels, which need per-panel uniforms, are captured by the
    // same walk and replayed per pass (SignCanvas re-walks them only with ?legacySigns=1);
    // landmarks, screens, holograms and the player's car stay direct.
    const recordProps = (sink: PropCanvas) => {
      // Perf: the recorder also captures the letter panels of the stations and shops (their tag says
      // which pass keeps them), so the render passes replay them instead of re-walking both scenes.
      const capture: PropRecorder | null = props !== undefined && sink === props && !legacySigns ? props : null;
      if (capture) capture.panelTag = METRO_PANELS;
      drawMetroScene(sink, view, metroTime, passenger?.train ?? null, liftStation, liftHeight);
      if (capture) capture.panelTag = -1;
      counts = drawActivity(sink, view, vehicles, citizens);
      drawSights(sink, view); // Edge sights (sights-scene.ts): instanced with the props, titles captured with the shop panels
      drawDriving(sink, view, parkedNearby, null, false, false); // Driving: kerbside cars
      drawPark(sink, view, time); // Park: its props were never recorded before this call (collision was), so the trees players walked into were invisible
      drawAlleys(sink, view, time, world.blocks); // Alleys: themed alley arms (alley-scene.ts, layouts in alleys.ts)
      drawSecrets(sink, view, time, rpg, world.blocks); // Secrets: twenty discoveries, their props and the "A secret: n/20" toasts (secrets-scene.ts)
      drawCityEvents(sink, view); // City events: the running happening's props, only near it and never on the low profile (city-events-scene.ts)
      drawNpcs(sink, view, quests.npcs, id => quests.marker(id), quests.dialogue?.npcId ?? null); // Quests: named NPCs + markers
      drawEnemies(sink, view, rpgEnemies, time); // RPG: enemies, dropped loot, world objects
      drawGroundLoot(sink, view, rpg.groundLoot(player), time);
      drawInteractables(sink, view, rpg.interactables(), time);
      drawWaypointBeacons(sink, view, viewDistance); // World map: waypoint light beacons (waypoint-scene.ts)
      drawRemotePlayers(sink, view, remotes); // Multiplayer: other players' figures and cars (instanced with the props)
      drawInteriorEntrances(sink, interiors.places, player, isVisible);
      drawGroundFloorDoors(sink, interiors, player, isVisible); // Ground floors: a soft lintel light on every nearby building door
      for (const { building, distance } of visible) if (distance < shopReach) { if (capture) capture.panelTag = distance; drawShop(sink, building, distance, player, isVisible, shopReach, world); }
      if (capture) capture.panelTag = -1;
      // Suspended utilities and narrow service bridges break up the avenue's
      // empty silhouette. Small fixtures remain real geometry in reflections.
      propRange(300);
      if (Math.abs(player.x) < 240) for (let z = Math.round(player.z / 128) * 128 - 256; z < player.z + 300; z += 128) {
        glow(sink, [58, 84, 93], 0.5); box(sink, 0, 27, z + 32, 49, 0.18, 0.18);
        glow(sink, [119, 202, 206], 0.95); box(sink, 0, 26, z + 32, 4.6, 0.25, 1.2);
        for (const side of [-1, 1]) { glow(sink, [73, 101, 110], 0.4); box(sink, side * 23, 21, z + 32, 0.16, 12, 0.16); }
        if (Math.abs(z) % 256 === 0 && z !== -256) {
          glow(sink, [62, 85, 91], 0.5); box(sink, 0, 38, z + 7, 51, 1.4, 3);
          glow(sink, [234, 174, 99], 0.72); box(sink, 0, 39.8, z + 8.6, 48, 0.14, 0.14);
          for (let x = -23; x <= 23; x += 3) { glow(sink, [64, 95, 101], 0.55); box(sink, x, 39, z + 8.5, 0.16, 2, 0.16); }
        }
      }
      propRange(0);
    };
    mark("cull");
    if (props && !directProps) { props.reset(); recordProps(props); propBatch?.upload(props); }
    mark("props");
    const sceneTexture = sceneData.texture;
    // Mobile (perf): the sign passes walk the whole rail scene through textmode transforms only to find its
    // letter panels, which exist only at stations within 400 m and in trains within 150 m (metro-scene.ts).
    // Skipping the walk when neither is near is exact; on reduced profiles the reflection skips them too.
    let metroSigns = passenger !== null || STATIONS.some(s => Math.hypot(player.x - s.x, player.z - s.z) < 400);
    for (let id = 0; id < TRAIN_COUNT && !metroSigns; id++) { const train = trainAt(metroTime, id); metroSigns = Math.hypot(train.x - player.x, train.z - player.z) < 150; }
    const batchCamera = (mirror: boolean): BatchCamera => ({ x: player.x, y: mirror ? cameraHeight : eyeY, z: player.z, yaw: viewYaw, pitch: viewPitch, fov, aspect: projectionAspect, mirror });
    const scenery = (mirror: boolean) => {
      const frame: BatchFrame = { scene: sceneTexture, text: textData?.texture ?? sceneTexture, time, rain: settings.rain, atmosphere: !mirror && common.u_atmosphere === 1, viewRadius: viewDistance, fadeIn: reveal };
      // Sky dome centred on the eye: it turns with the camera, and the fog uses the same colours.
      t.setUniform("u_surface", 4);
      t.push(); t.translate(player.x, mirror ? cameraHeight : eyeY, player.z); t.sphere(1500); t.pop();
      t.setUniform("u_surface", 0);
      if (referenceRenderer) for (const { building, distance } of visible) drawBuilding(t, building, distance);
      else buildingBatch?.draw(batchCamera(mirror), frame, mirror ? mirrorChunks : chunks);
      t.setUniform("u_surface", 2);
      propRange(0);
      for (const landmark of LANDMARKS) if (Math.hypot(player.x - landmark.x, player.z - landmark.z) < viewDistance + 60) drawLandmark(t, landmark, time);
      if (directProps || !signs) recordProps(t);
      else {
        propBatch?.draw(batchCamera(mirror), frame);
        if (props && !legacySigns) {
          // Perf: the station and shop letter panels captured while recording props, in the same order
          // and subset the two walks below produce (the reflection keeps shops within 120 m).
          props.replayPanels(t, tag => tag === METRO_PANELS ? metroSigns && !(mirror && profile.low) : !mirror || tag < 120);
        } else {
          if (metroSigns && !(mirror && profile.low)) drawMetroScene(signs, view, metroTime, passenger?.train ?? null, liftStation, liftHeight, true); // Mobile (perf): see metroSigns
          for (const { building, distance } of visible) if (distance < (mirror ? 120 : shopReach)) drawShop(signs, building, distance, player, isVisible, shopReach, world);
        }
      }
      if (drive) drawDriving(t, view, [], drive.car, drive.exterior, mirror); // Driving: player car / cockpit
      if (!mirror) { // RPG: the weapon in hand (true camera, so it stays put through the view warp) and combat effects
        if (onFoot && !combatView.dead) drawViewmodel(t, { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch }, combatView, rpg.weapon(), time);
        drawCombatEffects(t, hudFrame?.effects ?? [], vfxCam, time, t.grid?.rows ?? 90);
      }
      // Hologram screens cycle channels in the material (the synth feed's cells, data rain, scope,
      // map, advert), so they share fog and lighting.
      if (broadcast.drawFramebuffer && profile.holograms) { // Mobile: profile (desktop: !low)
        t.setUniform("u_surface", 5);
        const screenReach = Math.min(viewDistance * 0.6, SCREEN_REACH);
        propRange(screenReach); t.cellColor(0, 0, 0, propAlpha());
        for (const { building, distance } of visible) {
          if (building.id % 17 !== 0 || distance > screenReach) continue;
          const face = facesOf(building)[1];
          // Per screen: channel rotation phase (u_holoSeed) and the advert it shows (u_holoRow).
          t.setUniforms({ u_holoSeed: (building.id * 0.377) % 1, u_holoRow: (building.id * 7) % MESSAGES.length });
          t.push(); t.translate(face.x, -Math.min(building.height - 8, 28), face.z); t.rotateY(face.yaw);
          t.rect(6, 9); t.pop();
        }
      }
      // Holograms: tall translucent projections off a few towers, low enough to read from the street
      // (ten subjects drawn in HOLOGRAM_MATERIAL, see SURFACE 7) with a slogan crawling below. Fog,
      // not a draw distance, hides them.
      if (broadcast.drawFramebuffer && profile.holograms) { // Mobile: profile (desktop: !low)
        let switched = false;
        for (const { building } of visible) {
          if (building.id % 11 !== 0 || building.height < 70) continue;
          if (!switched) { hologramProgram(true, mirror); switched = true; }
          const face = facesOf(building)[1], angle = face.yaw * Math.PI / 180, size = 10 + (building.id % 3) * 3;
          // Projected 7 m out over the street and turned toward the viewer (at most 40 degrees off
          // the facade), so it reads from down the street instead of edge-on. The turn follows the
          // camera smoothly; it never snaps.
          const cx = face.x + Math.sin(angle) * 7, cz = face.z + Math.cos(angle) * 7;
          const off = Math.atan2(player.x - cx, player.z - cz) - angle, turn = Math.atan2(Math.sin(off), Math.cos(off));
          const [tint, tint2] = HOLO_TINTS[(building.district * 2 + building.id) % HOLO_TINTS.length];
          t.setUniforms({ u_holoRow: building.id % MESSAGES.length, u_holoSeed: (building.id * 0.618) % 1, u_holoTint: [...tint], u_holoTint2: [...tint2], u_holoFrame: [0, 0] });
          // Centred at most 14 m + size up (lower edge ~13 m, above the shopfronts), so the street sees them.
          t.push(); t.translate(cx, -Math.min(building.height * 0.62, 14 + size), cz); t.rotateY(face.yaw + Math.max(-40, Math.min(40, turn * 180 / Math.PI)));
          t.rect(size * 1.25, size * 2.1); t.pop();
        }
        if (switched) hologramProgram(false, mirror);
      }
      // VFX: queued wheels, brake lights, steam, searchlights, sparks (queued once per frame while
      // props are recorded, so they are drawn in the main pass).
      if (!mirror || directProps) flushVfx(t, mirror);
      propRange(0);
      t.resetShader();
    };
    const cols = t.grid?.cols ?? 1, rows = t.grid?.rows ?? 1;
    if (reflection.width !== cols || reflection.height !== rows) reflection.resize(cols, rows);
    reflection.begin(); t.clear();
    // Perf: only the street (y = 0) samples the reflection; when the lowest row of the view looks
    // above the horizon (two cells of view-warp margin), no street cell is on screen, so the
    // reflected pass would never be seen.
    const streetInView = viewPitch + fov * Math.PI / 360 + 2 / focalCells > 0;
    if (!streetInView) { /* nothing to reflect into */ }
    else if (settings.rain && profile.reflections) {
      camera(true); t.shader(material); t.setUniforms(passUniforms(true));
      scenery(true);
    } else if (settings.rain) {
      // Mobile: light reflection mode - puddles mirror the sky dome only (skips the second scene walk).
      camera(true); t.shader(material); t.setUniforms({ ...passUniforms(true), u_surface: 4 });
      t.push(); t.translate(player.x, cameraHeight, player.z); t.sphere(1500); t.pop();
      t.resetShader();
    }
    reflection.end();
    mark("mirror");
    t.clear();
    // The street plane has its own program (the park and the puddle reflections), then the scene program.
    camera(false); t.shader(groundMaterial);
    t.setUniforms({ ...common, u_mirror: 0, u_surface: 1,
      u_reflectionGlyph: reflection.textures[0], u_reflectionInk: reflection.textures[1], u_reflectionPaper: reflection.textures[2] });
    t.char("-"); t.push(); t.translate(0, 0.08, 0); t.rotateX(90); t.rect(WORLD_EDGE * 2, WORLD_EDGE * 2); t.pop();
    drawHarbourWater(t); // Harbour (GROUND agent, harbour-scene.ts): quay and water strips around the street plane, same ground program
    t.shader(material); t.setUniforms(passUniforms(false));
    scenery(false);
    if (settings.effects && profile.bloom) { // Mobile: profile
      t.filter("neon-clarity", { radius: 2 * pixelDensity, strength: 0.28 });
    }
    mark("main");
    if (performance.now() - lastSnapshot > 160) { lastSnapshot = performance.now(); snapshot(); }
    mark("snapshot");
    cpuAverage += (performance.now() - frameStart - cpuAverage) * 0.05; // Mobile: governor input
  });

  return {
    world,
    enter() {
      if (!ready || disposed || contextLost) return;
      closeDialogue(); // Quests: resuming always ends an open conversation.
      running = true;
      frozen = false; // Studio: "Walk / look" leaves the frozen inspection scene, so residents perceive and speak again
      ambience.set(settings.sound); // Ambience: interiors are muffled by update(), not silenced
      canvas.focus({ preventScroll: true }); // Mobile: never scroll the page on iOS
      holdGovernors(performance.now());
      if (matchMedia("(pointer: fine)").matches && canvas.requestPointerLock) {
        // Drag-to-look and arrow keys remain available if pointer lock is denied.
        // Raw relative input avoids OS acceleration where supported.
        const capture = async () => {
          try { await canvas.requestPointerLock({ unadjustedMovement: true }); }
          catch { try { await canvas.requestPointerLock(); } catch { /* Drag/arrow fallback stays active. */ } }
        };
        void capture();
      }
    },
    pause,
    // Photo mode (UI agent): hide the HUD layer, aim the paused camera, read the cell grid back.
    photo(command) {
      if (command.kind === "hud") { if (command.visible) hud.show(); else hud.hide(); }
      else if (!running && !drive && Number.isFinite(command.yaw) && Number.isFinite(command.pitch)) {
        player.yaw = command.yaw; player.pitch = Math.max(-1.3, Math.min(1.2, command.pitch)); mouse.reset(player.yaw, player.pitch);
      }
      return { yaw: player.yaw, pitch: player.pitch };
    },
    photoFrame() {
      const frame = ready && !disposed && !contextLost ? t.layers.base.drawFramebuffer : undefined;
      if (!frame) return null;
      return { cols: frame.width, rows: frame.height, cells: frame.readPixels(0), glyphs: [...t.font.characterMap].map(([character, glyph]): [string, readonly number[]] => [character, glyph.color]) };
    },
    duckAmbience: (level) => ambience.duck(level), // Radio
    rpgAction(action) {
      rpg.action(action);
      if (action.kind === "trackQuest") rpg.save(interiors.outdoorPose(player));
      if (action.kind === "respawn") {
        const anchor = safeLanding(world, SPAWN.x, SPAWN.z), arrival = walkArrival(anchor);
        leaveInterior(); exitCar(true); journey = null; passenger = null; platform = null; lift = null; rideHeading = null;
        settleArrival(anchor, arrival);
      }
      snapshot();
    },
    look,
    interact,
    chooseDialogue,
    closeDialogue,
    inspect,
    setMode,
    setMultiplayer(next) {
      link = next; partyKey = -1;
      const sharedTime = link?.worldTime(performance.now() / 1000) ?? null;
      if (sharedTime !== null) metroTime = sharedTime + METRO_TIME_OFFSET;
      carryPassenger();
      snapshot();
    },
    restorePassenger(carrier, clock) {
      const restored = parseTrainCarrier(carrier);
      if (!restored || !Number.isFinite(clock)) return;
      leaveInterior(); exitCar(true);
      journey = null; platform = null; lift = null; verticalVelocity = 0;
      const sharedTime = link?.worldTime(performance.now() / 1000) ?? null;
      metroTime = sharedTime === null ? Math.max(0, clock) : sharedTime + METRO_TIME_OFFSET;
      const train = trainAt(metroTime, restored.train);
      passenger = { train: restored.train, u: restored.u, v: restored.v, yaw: train.yaw };
      mode = "metro"; passengerSpeed = 0;
      mouse.reset(train.yaw + restored.yaw, -0.015);
      player.pitch = -0.015;
      carryPassenger();
      publishPose(); snapshot();
    },
    ride(next, destination) {
      const station = STATIONS[destination] ?? STATIONS[4]; // metro: a STATIONS index (taxis and sky taxis: a district id)
      const departure = departurePosition();
      const anchor = next === "metro" ? localToWorld(station, 9, 20) : safeLanding(world, departure.x, departure.z);
      const arrival = next === "sky" ? null : walkArrival(anchor);
      if (next !== "sky" && !arrival) { blockedArrival(); return; }
      const plannedJourney = next === "taxi" ? createJourney(next, { ...player, ...arrival }, WALK_HEIGHT, destination, world) : null;
      if (next === "taxi" && !plannedJourney) {
        callbacks.onQuestUpdate?.("No clear taxi route from here. Move to a street or choose a sky taxi.");
        return;
      }
      leaveInterior();
      exitCar(true); // Driving: the car stays parked where it stopped
      if (next === "metro") {
        journey = null; passenger = null; platform = null; lift = null; mode = "walk";
        Object.assign(player, arrival); cameraHeight = WALK_HEIGHT;
        player.yaw = station.yaw; player.pitch = -0.04; mouse.reset(player.yaw, player.pitch);
        verticalVelocity = 0; speed = 0; rideHeading = null; snapshot(); return;
      }
      passenger = null; platform = null; lift = null;
      if (next === "taxi") { Object.assign(player, arrival); cameraHeight = WALK_HEIGHT; }
      journey = next === "taxi" ? plannedJourney : createJourney(next, player, cameraHeight, destination, world);
      mode = next;
      rideHeading = null;
      verticalVelocity = 0;
      mouse.reset(player.yaw, next === "sky" ? 0.55 : -0.05);
      player.pitch = mouse.pitch;
      snapshot();
    },
    action(action, pressed) {
      if (action === "handbrake") { if (pressed) keys.add("Space"); else keys.delete("Space"); } // Mobile: touch pedals
      else if (action === "camera") { if (pressed && drive) saveDriveView(drive.toggleView()); }
      else if (action === "jump" && pressed && mode === "walk" && cameraHeight <= WALK_HEIGHT + 0.01) verticalVelocity = 7;
      else { const code = action === "down" ? "KeyC" : "KeyQ"; if (pressed) keys.add(code); else keys.delete(code); }
    },
    setTouchMovement(forward, strafe, sprint = false) { touchForward = forward; touchStrafe = strafe; touchSprint = sprint; },
    setSettings(next) {
      if (!active()) return;
      const changedQuality = next.quality !== settings.quality;
      const changedMotion = next.motion !== settings.motion;
      settings = next;
      if (changedQuality) { desktopGovernor = new QualityGovernor(DESKTOP_LEVELS.length - 1); holdGovernors(performance.now()); applyProfile(); void applyAtlas().then(resize).catch(rendererError); blockCache = ""; } // Mobile: profile
      if (changedMotion && ready) broadcastFeed();
      ambience.set(running && settings.sound); // Ambience
    },
    travel(x, z, yaw) {
      if (!world.canOccupy(x, z)) return;
      const arrival = walkArrival({ x, z });
      if (!arrival) { blockedArrival(); return; }
      leaveInterior();
      exitCar(true); // Driving
      passenger = null; platform = null; lift = null; journey = null; rideHeading = null;
      settleArrival({ x, z }, arrival);
      player.pitch = SPAWN.pitch;
      const nearest = LANDMARKS.reduce((closest, landmark) => Math.hypot(landmark.x - x, landmark.z - z) < Math.hypot(closest.x - x, closest.z - z) ? landmark : closest);
      player.yaw = yaw !== undefined && Number.isFinite(yaw) ? yaw : Math.atan2(nearest.x - x, z - nearest.z);
      mouse.reset(player.yaw, player.pitch);
      snapshot();
    },
    destroy() {
      if (disposed) return;
      if (ready) rpg.save(interiors.outdoorPose(player)); // RPG
      disposed = true;
      frames.stop();
      pause();
      abort.abort();
      resizeObserver.disconnect();
      ambience.destroy();
      if (!contextLost) { // after a context loss these GL objects are already gone
        reflection?.dispose();
        sceneData?.dispose();
        textData?.dispose();
        buildingBatch?.dispose();
        propBatch?.dispose();
        groundMaterial?.dispose();
        hologramMaterial?.dispose();
        interiorMaterial?.dispose();
        material?.dispose();
      }
      t.destroy();
      // textmode's destroy() calls WEBGL_lose_context on this canvas, so it can never host another
      // city (a dev hot reload re-runs the boot effect on the same element): createCity refuses it.
      canvas.dataset.retired = "1";
    },
  };
}
