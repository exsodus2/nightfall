import { textmode, type Textmodifier, type TextmodeShader, type TextmodeFramebuffer, type TextmodeTileset } from "textmode.js";
import { FiltersPlugin } from "textmode.filters.js";
import { SynthPlugin, osc, plasma, solid } from "textmode.synth.js";
import { CITY_MATERIAL, REFLECTION_MATERIAL, CLARITY_FILTER, GLYPH_TABLE, cityMaterial } from "./materials";
// Mobile: render profiles, adaptive quality and device class (quality-governor.ts, device.ts).
import { QualityGovernor, renderProfile, type QualityPreset, type RenderProfile } from "./quality-governor";
import { isTouchFirst, isWebKit } from "./device";
import { createFrameLoop } from "./frame-pacing";
import { rotationWarp, VIEW_WARP_FILTER } from "./view-warp";
import { buildCityAtlas, ASCII_COUNT, FIRST_ASCII, thinKey } from "./atlas";
import { ASCII_BITMAPS } from "./glyph-font";
import { MESSAGES } from "./messages";
import { BLOCK_SIZE, CityWorld, LANDMARKS, SPAWN, WORLD_EDGE, districtAt, movePlayer, nearestStreetLamps, type Block, type Building, type Landmark, type Player, type RGB } from "./world";
import { drawActivity, cuboid as box, propAlpha, propRange } from "./activity";
import { advanceJourney, createJourney, MouseLook, safeLanding, WALK_HEIGHT, type Journey, type RideMode, type TravelMode } from "./locomotion";
import { drawShop, signFaces } from "./signage";
import { fullyHidden, visibleFrom } from "./visibility";
import { SceneData, TextData } from "./scene-data";
import { BuildingBatch, BUILDING_VERTEX, BUILDING_MATERIAL, FACADE_MATERIAL, type BatchCamera, type BatchFrame, type BuildingChunk } from "./building-batch";
import { PropBatch, PROP_VERTEX } from "./prop-batch";
import { PropRecorder, SignCanvas, type PropCanvas } from "./prop-canvas";
import { drawBuilding } from "./architecture";
import { CityPopulation, type PopulationStats } from "./people";
import { CityTraffic } from "./traffic";
import { SCENE_VIEWS, type InspectionCommand } from "./inspection";
import { drawMetroScene } from "./metro-scene";
import { STATIONS, PLATFORM_HEIGHT, TRAIN_EYE_HEIGHT, boardingTrain, doorAt, localToWorld, worldToLocal, trainAt, stationArrival, moveInTrain, type Passenger } from "./metro";
// Quests: named NPCs, dialogue and session quest state (quests.ts, npcs.ts, npc-scene.ts).
import type { NpcDialogue, QuestSnapshot } from "./quests";
import { nearestNpc, type NpcDefinition } from "./npcs";
import { drawNpcs } from "./npc-scene";
import { drawWaypointBeacons } from "./waypoint-scene"; // World map: waypoint beacons
// Driving: kerbside cars, the player's car and its camera (driving.ts, driving-scene.ts).
import { DriveSession, ParkedCars, carObstacle, distanceToCar, exitSpot, type CarPose, type Obstacle, type ParkedCar } from "./driving";
import { drawDriveDashboard, drawDriving } from "./driving-scene";
import { loadDriveView, saveDriveView } from "./drive-view"; // Driving: remembered cockpit / chase view
// VFX: wheels, rain, steam, sparks, searchlights, sky trails (vfx.ts, vfx-scene.ts, vfx-shaders.ts).
import { beginVfxFrame, drawRain, flushVfx } from "./vfx-scene";
// Multiplayer: remote players, their cars and party quests (src/multiplayer; optional, solo by default).
import type { FriendPosition, LocalPose, MultiplayerLink } from "../multiplayer/types";
import { drawInteriorPlayers, drawRemoteLabels, drawRemotePlayers, type RemoteLabelFrame } from "../multiplayer/remote-scene";
import { localPose, mergeRemoteHeadlights } from "../multiplayer/engine-hooks";
import { nearbyRemoteCars } from "../multiplayer/remote-vehicles";
import { samePlace } from "../multiplayer/presence";
import { METRO_TIME_OFFSET, parseTrainCarrier, type TrainCarrier } from "../multiplayer/rail";
// RPG layer: combat, items, quests (src/rpg; the engine talks to it only through RpgSession).
import type { RpgSnapshot, RpgUiAction } from "../rpg/types";
import { RpgSession } from "../rpg/session";
import { CONTENT_PACKS } from "../rpg/content";
import { RpgInputCollector } from "../rpg/input";
import { combatHudLayout, drawCombatEffects, drawCombatOverlay, drawEnemies, drawGroundLoot, drawInteractables, drawViewmodel, type CombatHudLayout, type CombatOverlayFrame, type HudViewport } from "../rpg/scene";
import { CityInteriors, INTERIOR_HEIGHT, type InteriorPlace } from "./interiors";
import { interiorUseMarkers, type InteriorUseMarker } from "./interior-map-markers";
import { interiorWorkState, type InteriorWorkState } from "./interior-work-state";
import { drawInterior, drawInteriorEntrances, drawInteriorInteractables } from "./interior-scene";
import { INTERIOR_MATERIAL } from "./interior-material";
import { drawCitizenLabels, type CitizenLabelFrame } from "./citizen-labels";
import { WalkingCollision, WALKING_CAR_QUERY_RADIUS, WALKING_CAR_ROOF_CLEARANCE } from "./walking-collision";
import { findWalkArrival, WALK_ARRIVAL_QUERY_RADIUS } from "./walk-arrival";

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
  world: CityWorld;
}

const HOLO_TINTS: readonly (readonly [number, number, number])[] = [[0.25, 0.85, 1], [1, 0.3, 0.72], [1, 0.62, 0.26]];

function glow(t: PropCanvas, color: RGB, intensity = 1): void {
  t.charColor(color[0] * intensity, color[1] * intensity, color[2] * intensity);
  t.cellColor(color[0] * intensity * 0.14, color[1] * intensity * 0.14, color[2] * intensity * 0.14, propAlpha());
  t.char("#");
}

function drawLandmark(t: Textmodifier, landmark: Landmark, time: number): void {
  const { x, z, color, kind } = landmark;
  glow(t, color, 0.16);
  if (kind === "spire") {
    box(t, x, 58, z, 26, 116, 26);
    box(t, x, 138, z, 15, 44, 15);
    glow(t, color, 0.82);
    for (let i = 0; i < 4; i++) {
      const offset = i < 2 ? -13.2 : 13.2;
      box(t, x + offset, 59, z + (i % 2 ? 13.2 : -13.2), 0.65, 118, 0.65);
    }
    box(t, x, 183, z, 0.7, 46, 0.7);
    for (const height of [122, 139, 157]) {
      t.push();
      t.translate(x, -height, z);
      t.rotateX(90);
      t.rotateZ(time * 4);
      t.torus(18 - (height - 122) * 0.15, 0.7);
      t.pop();
    }
  } else if (kind === "gate") {
    glow(t, color, 0.25);
    box(t, -10, 10, z, 3.4, 20, 3.4);
    box(t, 10, 10, z, 3.4, 20, 3.4);
    box(t, 0, 20, z, 27, 4, 4);
    glow(t, color, 0.95);
    box(t, 0, 22.2, z, 29, 0.4, 4.5);
    box(t, -10, 10, z + 1.8, 0.4, 20, 0.4);
    box(t, 10, 10, z + 1.8, 0.4, 20, 0.4);
  } else if (kind === "reactor") {
    box(t, x, 8, z, 22, 16, 22);
    glow(t, color, 0.85);
    t.push();
    t.translate(x, -24, z);
    t.sphere(11);
    t.rotateX(65);
    t.rotateY(time * 6);
    t.torus(17, 1);
    t.pop();
    for (let i = -1; i <= 1; i += 2) box(t, x + i * 18, 32, z - 8, 4, 64, 4);
  } else if (kind === "array") {
    box(t, x, 32, z, 20, 64, 20);
    glow(t, color, 0.85);
    for (let i = 0; i < 5; i++) {
      t.push();
      t.translate(x, -68 - i * 6, z);
      t.rotateY(time * 9 + i * 22);
      t.box(37 - i * 5, 0.8, 2);
      t.pop();
    }
  } else if (kind === "garden") {
    glow(t, [45, 91, 68], 0.8);
    box(t, x, 11, z, 3.5, 22, 3.5);
    glow(t, color, 0.45);
    for (let i = 0; i < 7; i++) {
      t.push();
      t.translate(x + Math.sin(i * 2.4) * 7, -22 - (i % 3) * 3, z + Math.cos(i * 2.4) * 7);
      t.sphere(7.5);
      t.pop();
    }
    glow(t, color, 0.8);
    t.push();
    t.translate(x, -0.3, z);
    t.rotateX(90);
    t.torus(19, 0.3);
    t.pop();
  } else {
    box(t, x, 9, z, 22, 18, 22);
    glow(t, color, 0.8);
    for (let i = 0; i < 5; i++) box(t, x, 21 + i * 2.5, z, 28 - i * 5, 0.7, 28 - i * 5);
  }
  t.push();
  t.translate(x, kind === "gate" ? -20 : -5, z + (kind === "gate" ? 2.2 : 14));
  t.charColor(...color);
  t.cellColor(4, 12, 18);
  t.printAlign("center", "middle");
  t.print(landmark.name.toUpperCase(), 0, 0);
  t.pop();
}

// Web Audio supplies an optional rain bed without downloaded audio or another dependency.
function createAmbience(): { set: (enabled: boolean) => void; duck: (level: number) => void; destroy: () => void } {
  let context: AudioContext | undefined;
  let gain: GainNode | undefined;
  let on = false; // Radio: remembered so duck() can re-target the gain
  let duckLevel = 1; // Radio: rain ducks while the in-game radio plays
  return {
    duck(level) { duckLevel = Math.max(0, Math.min(1, level)); if (context) gain?.gain.setTargetAtTime(on ? 0.19 * duckLevel : 0, context.currentTime, 0.6); },
    set(enabled) {
      on = enabled; // Radio
      if (!enabled && !context) return;
      if (!context) {
        context = new AudioContext();
        gain = context.createGain();
        gain.gain.value = 0;
        gain.connect(context.destination);
        const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * 0.3;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 1200;
        source.connect(filter);
        filter.connect(gain);
        source.start();
      }
      if (enabled) void context.resume().catch(() => undefined);
      gain?.gain.setTargetAtTime(enabled ? 0.19 * duckLevel : 0, context.currentTime, 0.4); // Radio: * duckLevel
    },
    destroy() { if (context) void context.close().catch(() => undefined); },
  };
}

/** localStorage, or null where it is blocked (private windows, sandboxed previews). */
function safeStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } | null {
  try { const storage = window.localStorage; storage.getItem("nightfall.probe"); return storage; } catch { return null; }
}

export function createCity(canvas: HTMLCanvasElement, initialSettings: CitySettings, callbacks: CityCallbacks): CityController {
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
  let roomWork: InteriorWorkState | null = null;
  let hudFrame: CombatOverlayFrame | null = null; // this frame's combat HUD data, for the overlay layer
  const abort = new AbortController();
  const ambience = createAmbience();
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
  let metroTime = METRO_TIME_OFFSET;
  let passengerSpeed = 0;
  let platform: number | null = null;
  let passenger: Passenger | null = null;
  let lift: { station: number; from: number; to: number; elapsed: number } | null = null;
  let liftStation: number | null = null;
  let liftHeight = 0;
  let counts = { cars: 0, residents: 0 };
  let material: TextmodeShader | undefined;
  let interiorMaterial: TextmodeShader | undefined;
  let reflectionMaterial: TextmodeShader | undefined;
  let reflection: TextmodeFramebuffer | undefined;
  let sceneData: SceneData | undefined;
  let textData: TextData | undefined;
  let buildingBatch: BuildingBatch | undefined;
  let propBatch: PropBatch | undefined;
  let props: PropRecorder | undefined;
  let signs: SignCanvas | undefined;
  const directProps = new URLSearchParams(location.search).get("directProps") === "1";
  const referenceRenderer = new URLSearchParams(location.search).get("reference") === "1";
  // Diagnostics: ?warp=offset renders turning with the old uniform layer offset, ?warp=identity keeps the filter pass but moves nothing.
  const warpMode = new URLSearchParams(location.search).get("warp");
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
  let frameAverage = 1 / 60;
  let blockCache = "";
  let viewDistance = 0;
  let fadeIn = 0;
  let atlasSize = 0;
  let blocks: Block[] = [];
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
  const portrait = () => canvas.clientHeight > canvas.clientWidth;
  let profile: RenderProfile = renderProfile(settings.quality, governor.level, portrait());
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
    const next = renderProfile(settings.quality, governor.level, portrait());
    const previous = profile;
    profile = next;
    if (next.holograms !== previous.holograms) { if (next.holograms && !interiors.active) broadcast.show(); else broadcast.hide(); }
    if (next.baseRadius !== previous.baseRadius) blockCache = "";
    if (ready && next.cell !== previous.cell) { governor.hold(performance.now()); void applyAtlas().then(resize).catch(rendererError); }
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
    if (renderProfile(settings.quality, governor.level, rect.height > rect.width).cell !== profile.cell) applyProfile(); // Mobile: orientation
    governor.hold(performance.now(), 1.5);
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
    const destination = train ? train.station !== null ? `${STATIONS[train.station].name} · doors ${train.doors > 0.85 ? "open" : "closing"}` : `Next: ${STATIONS[train.next].name}` : platform !== null ? `${STATIONS[platform].name} · train ${stationArrival(metroTime, platform).seconds === 0 ? "at platform" : `in ${stationArrival(metroTime, platform).seconds}s`}` : journey?.destination ?? null;
    const useMarkers = interiors.active ? interiorUseMarkers(interiors.active, rpg.interactables(interiors.active.id)) : [];
    roomWork = interiorWorkState(interiors.active?.id, rpg.quests);
    callbacks.onSnapshot({ presence: currentPose(), interior: interiors.active, interiorUseMarkers: useMarkers, x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch, sceneTime: time, metroTime, visibleBuildings, distance: player.distance, district: districtAt(player.x, player.z).id, fps: Math.round(1 / frameAverage), discovered: [...discovered], nearby, mode, altitude: cameraHeight, speed, destination, progress: train?.progress ?? (journey ? journey.travelled / Math.max(1, journey.length) : 0), interaction: interaction(), station: stop?.name ?? null, cabin: passenger && train ? { train: passenger.train, u: passenger.u, v: passenger.v, yaw: player.yaw - train.yaw, doors: train.doors } : null, population: population.stats(player.x, player.z), ...counts, quests: quests.questSnapshot(talkTarget()), rpg: rpg.snapshot(), drive: drive ? { gear: drive.car.speed < -0.3 ? "R" : Math.abs(drive.car.speed) < 0.3 ? "N" : "D", view: drive.chase ? "chase" : "cockpit", boost: keys.has("ShiftLeft") || keys.has("ShiftRight") || touchSprint } : null, friends: link?.friends() ?? [] /* Multiplayer */, render: { level: governor.level, cell: profile.cell, auto: settings.quality === "auto" } /* Mobile */ });
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
    if (interiors.active) return interiors.atExit(player.x, player.z) ? `Exit ${interiors.active.name}` : null;
    if (lift) return "Lift in motion";
    if (drive) return Math.abs(drive.car.speed) > 4 ? "Slow down to get out" : "Get out of the car"; // Driving
    if (passenger) {
      const train = trainAt(metroTime, passenger.train);
      return train.doors > 0.85 && doorAt(passenger.v) && passenger.u > 1 ? "Step onto the platform" : "Walk through the carriages · doors open at stations";
    }
    if (platform !== null) {
      if (nearbyLift() === platform) return "Take lift to the street";
      const p = worldToLocal(STATIONS[platform], player.x, player.z);
      if (p.u < 5.5 && doorAt(p.v) && boardingTrain(metroTime, platform)) return "Board the monorail";
      return "Walk to an open carriage door";
    }
    const doorway = interiorTarget();
    if (doorway) return rpg.inCombat ? "Finish combat before entering" : `Enter ${doorway.name}`;
    const car = carTarget(); // Driving: only when nearer than any NPC
    if (car) return car.traffic !== null ? "Take over the stopped car" : "Get in the car";
    const npc = talkTarget(); // Quests
    if (npc) return `Talk to ${npc.name}`;
    if (mode === "walk" && nearbyLift() !== null) return "Take lift to the platform";
    return null;
  }
  function board(train: ReturnType<typeof trainAt>, v: number): void {
    passenger = { train: train.id, u: 1.65, v, yaw: train.yaw }; platform = null; mode = "metro";
    Object.assign(player, localToWorld(train, passenger.u, passenger.v)); cameraHeight = PLATFORM_HEIGHT + TRAIN_EYE_HEIGHT;
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
    cameraHeight = PLATFORM_HEIGHT + WALK_HEIGHT; passenger = null;
    publishPose();
  }

  function carryPassenger(): void {
    if (!passenger) return;
    const train = trainAt(metroTime, passenger.train);
    const turn = Math.atan2(Math.sin(train.yaw - passenger.yaw), Math.cos(train.yaw - passenger.yaw));
    mouse.yaw += turn; mouse.targetYaw += turn; player.yaw = mouse.yaw; passenger.yaw = train.yaw;
    Object.assign(player, localToWorld(train, passenger.u, passenger.v));
    cameraHeight = PLATFORM_HEIGHT + TRAIN_EYE_HEIGHT;
    speed = train.speed;
  }
  function interact(): void {
    if (!running || lift || rpg.dead) return;
    if (interiors.active) {
      if (interiors.atExit(player.x, player.z)) {
        const arrival = walkArrival(interiors.active.entrance);
        if (arrival) { leaveInterior(); Object.assign(player, arrival); publishPose(); }
        else blockedArrival();
      }
      else if (rpg.hasInteraction()) {
        const opened = rpg.interactNearby();
        if (opened) { pause(); callbacks.onDialogue(opened); }
      }
      snapshot(); return;
    }
    if (passenger) { disembark(); snapshot(); return; }
    if (drive) { exitCar(false); snapshot(); return; } // Driving
    const doorway = interiorTarget();
    if (doorway) { if (!rpg.inCombat) enterInterior(doorway); snapshot(); return; }
    const car = carTarget();
    if (car) { enterCar(car); snapshot(); return; }
    const npc = talkTarget(); // Quests: talking wins only when an NPC is the nearest target.
    if (npc) { talk(npc); return; }
    if (mode === "walk" && rpg.hasInteraction()) { // RPG: pick up loot, else use a world object
      const opened = rpg.interactNearby();
      if (opened) { pause(); callbacks.onDialogue(opened); snapshot(); return; }
      rpgInput.pressInteract(); return;
    }
    const station = nearbyLift();
    if (station !== null && mode === "walk") {
      lift = { station, from: platform !== null ? PLATFORM_HEIGHT : 0, to: platform !== null ? 0 : PLATFORM_HEIGHT, elapsed: 0 };
      liftStation = station; liftHeight = lift.from;
      Object.assign(player, localToWorld(STATIONS[station], 9, 20));
    } else if (platform !== null) {
      const p = worldToLocal(STATIONS[platform], player.x, player.z), train = boardingTrain(metroTime, platform);
      if (train && p.u < 5.5 && doorAt(p.v)) board(train, p.v);
    } else if (mode !== "walk") setMode("walk");
    snapshot();
  }

  function interiorTarget(): InteriorPlace | null {
    if (mode !== "walk" || passenger || platform !== null || lift || journey || cameraHeight > WALK_HEIGHT + 0.5) return null;
    const doorway = interiors.nearby(player.x, player.z);
    if (!doorway) return null;
    const distance = Math.hypot(player.x - doorway.entrance.x, player.z - doorway.entrance.z);
    const car = carTarget(), npc = nearestNpc(quests.npcs, player.x, player.z);
    return (car && car.distance < distance) || (npc && npc.distance < distance) ? null : doorway;
  }

  function enterInterior(place: InteriorPlace): void {
    interiors.enter(place, player);
    rpg.bus.emit({ type: "entered", area: `interior:${place.id}` });
    cameraHeight = WALK_HEIGHT; verticalVelocity = 0; speed = 0;
    keys.clear(); rpgInput.release();
    eased.forward = eased.strafe = eased.sprint = eased.up = 0;
    mouse.reset(player.yaw, player.pitch);
    broadcast.hide(); ambience.set(false);
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
    publishPose();
  }

  function currentPose(): LocalPose {
    const pose = localPose({ x: player.x, z: player.z, eye: cameraHeight, yaw: player.yaw, pitch: player.pitch, speed: passenger ? passengerSpeed : speed, mode, car: drive?.car ?? null, rideHeading, inTrain: !!passenger, place: interiors.active?.id ?? "", carrier: passenger ? { train: passenger.train, u: passenger.u, v: passenger.v, yaw: player.yaw - passenger.yaw } : null });
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
    else if (ready && !contextLost) { governor.hold(performance.now()); frames.start(); }
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
      const [shader, mirrorShader, buildingShader] = await Promise.all([t.createMaterialShader(lite ? cityMaterial({ reflections: true, lite }) : CITY_MATERIAL), t.createMaterialShader(lite ? cityMaterial({ lite, ground: false }) : REFLECTION_MATERIAL), t.createShader(BUILDING_VERTEX, lite ? cityMaterial({ batch: true, opaque: true, lite, architecture: true }) : FACADE_MATERIAL), t.filters.register("neon-clarity", CLARITY_FILTER, { u_radius: ["radius", 2], u_strength: ["strength", 0.28] }), t.filters.register("view-warp", VIEW_WARP_FILTER, { u_row0: ["row0", [1, 0, 0]], u_row1: ["row1", [0, 1, 0]], u_row2: ["row2", [0, 0, 1]], u_focal: ["focal", 800], u_cell: ["cell", 8], u_origin: ["origin", [0, 0]] })]);
      if (!active()) { if (!contextLost) { shader.dispose(); mirrorShader.dispose(); buildingShader.dispose(); } return; }
      material = shader;
      reflectionMaterial = mirrorShader;
      const roomShader = await t.createMaterialShader(INTERIOR_MATERIAL);
      if (!active()) { if (!contextLost) roomShader.dispose(); return; }
      interiorMaterial = roomShader;
      if (!await bootStage("scene")) return;
      reflection = t.createFramebuffer({ filter: "nearest", depth: true });
      sceneData = new SceneData(canvas);
      textData = new TextData(canvas, ASCII_BITMAPS, MESSAGES);
      buildingBatch = new BuildingBatch(canvas, buildingShader, world);
      const propShader = await t.createShader(PROP_VERTEX, lite ? cityMaterial({ batch: true, lite, ground: false }) : BUILDING_MATERIAL);
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
      if (query.get("perf") === "1") (window as Window & { __nightfallPerf?: () => object }).__nightfallPerf = () => ({ cpuMs: +cpuAverage.toFixed(2), fps: Math.round(1 / frameAverage), level: governor.level, window: governor.lastWindow, cell: profile.cell, density: pixelDensity, grid: t.grid ? `${t.grid.cols}x${t.grid.rows}` : "", lite, interior: interiors.active?.id ?? null, visibleBuildings, remotePlayers: remoteLabels?.remotes.length ?? 0 });
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
    drawRemoteLabels(t, cols, rows, remoteLabels); // Multiplayer: crisp name tags over other players
    drawCitizenLabels(t, cols, rows, citizenLabelFrame);
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
    if (cleanHud || !ready || !hudFrame || !t.grid) return;
    if (!hudLayoutCache || hudColumns !== t.grid.cols || hudRows !== t.grid.rows) {
      hudColumns = t.grid.cols; hudRows = t.grid.rows;
      hudLayoutCache = combatHudLayout(hudColumns, hudRows, hudViewport);
    }
    hud.ortho(); hud.resetCamera();
    t.cellColor(0, 0, 0, 0);
    drawCombatOverlay(t, hudColumns, hudRows, hudFrame, hudLayoutCache);
  });

  t.draw(() => {
    if (!ready || !material || !interiorMaterial || !reflectionMaterial || !reflection || !sceneData || !buildingBatch || disposed || contextLost) return;
    const frameStart = performance.now(); // Mobile: CPU time of this callback, for the governor
    const rawDt = t.deltaTime() / 1000;
    if (settings.quality === "auto" && running && !frozen && governor.sample(rawDt * 1000, cpuAverage, frameStart) !== null) applyProfile();
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
    if (settings.motion && !frozen) { population.update(dt, time, metroTime, player, { players: nearbyPlayers, rain: settings.rain }, signalTime); traffic.update(dt, signalTime, trafficBlockers(remoteCars), { eye: player, players: nearbyPlayers, residents: population.walkers }); }
    // Ambient animation frozen but the trains still run: a zero-time update keeps seated riders
    // attached to their moving train instead of hanging where it was.
    else if (sharedTime !== null || !frozen && running) population.update(0, time, metroTime, player, undefined, signalTime);
    if (mode === "walk" && !interiors.active && !passenger && platform === null && !lift && !journey) streetCollision.setCars([...parked.nearby(player.x, player.z, WALKING_CAR_QUERY_RADIUS), ...traffic.nearby(player.x, player.z, WALKING_CAR_QUERY_RADIUS), ...remoteCars], Math.max(0, cameraHeight - WALK_HEIGHT));
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
        moveInTrain(passenger, player.yaw, forward, strafe, dt);
        passengerSpeed = Math.hypot(passenger.u - oldU, passenger.v - oldV) / Math.max(dt, 0.001);
        Object.assign(player, localToWorld(train, passenger.u, passenger.v));
        cameraHeight = PLATFORM_HEIGHT + TRAIN_EYE_HEIGHT;
        speed = train.speed;
        const rightward = Math.sin(player.yaw - train.yaw) * forward + Math.cos(player.yaw - train.yaw) * strafe;
        if (passenger.u > 2.12 && rightward > 0 && train.doors > 0.85) disembark();
        player.distance += Math.hypot(player.x - oldX, player.z - oldZ);
      } else if (platform !== null) {
        const station = STATIONS[platform], p = worldToLocal(station, player.x, player.z);
        const angle = player.yaw - station.yaw, step = (sprint ? 8 : 5.5) * dt / Math.max(1, Math.hypot(forward, strafe));
        const u = p.u + (Math.sin(angle) * forward + Math.cos(angle) * strafe) * step;
        const v = Math.max(-25.5, Math.min(25.5, p.v + (-Math.cos(angle) * forward + Math.sin(angle) * strafe) * step));
        const train = boardingTrain(metroTime, platform);
        if (u < 3.45 && doorAt(v) && train) board(train, v);
        else Object.assign(player, localToWorld(station, Math.max(3.5, Math.min(9.6, u)), v));
        cameraHeight = PLATFORM_HEIGHT + (passenger ? TRAIN_EYE_HEIGHT : WALK_HEIGHT);
        speed = Math.hypot(player.x - oldX, player.z - oldZ) / Math.max(dt, 0.001);
        player.distance += Math.hypot(player.x - oldX, player.z - oldZ);
      } else if (journey) {
        const position = { x: player.x, y: cameraHeight, z: player.z };
        const result = advanceJourney(journey, position, dt);
        player.x = position.x; player.z = position.z; cameraHeight = position.y;
        speed = result.speed;
        if (result.heading !== null) {
          const previous = rideHeading ?? mouse.targetYaw;
          mouse.turn(Math.atan2(Math.sin(result.heading - previous), Math.cos(result.heading - previous)));
          rideHeading = result.heading;
        }
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
      drawInterior(t, place, interiors.fixtures, time, profile.low, settings.effects, roomWork);
      drawInteriorInteractables(t, place, rpg.interactables(place.id));
      drawInteriorPlayers(t, presentRemotes, time);
      t.resetShader();
      if (settings.effects && profile.bloom) t.filter("neon-clarity", { radius: 2 * pixelDensity, strength: 0.18 });
      if (performance.now() - lastSnapshot > 160) { lastSnapshot = performance.now(); snapshot(); }
      cpuAverage += (performance.now() - frameStart - cpuAverage) * 0.05;
      return;
    }
    const baseRadius = profile.baseRadius; // Mobile: profile (desktop presets: 11 / 9 / 5)
    // The draw distance eases when altitude or quality changes; fog reaches the sky colour
    // exactly there, so buildings emerge from and dissolve into the dark instead of popping.
    const targetDistance = Math.min(14, baseRadius + Math.floor(cameraHeight / 40)) * BLOCK_SIZE;
    viewDistance = viewDistance === 0 ? targetDistance : viewDistance + (targetDistance - viewDistance) * (1 - Math.exp(-dt * 1.2));
    fadeIn = Math.min(1, fadeIn + dt / 1.6);
    const reveal = fadeIn * fadeIn * (3 - 2 * fadeIn);
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
    const near = world.nearbyBlocks(player.x, player.z, 2).flatMap(block => block.buildings)
      .sort((a, b) => (a.x - player.x) ** 2 + (a.z - player.z) ** 2 - (b.x - player.x) ** 2 - (b.z - player.z) ** 2);
    const blockers = near.slice(0, 18);
    const eye = { x: player.x, y: cameraHeight, z: player.z };
    const visible: { building: Building; distance: number }[] = [];
    for (const block of blocks) for (const building of block.buildings) {
      const dx = building.x - player.x, dz = building.z - player.z;
      const distance = Math.hypot(dx, dz);
      const margin = 0.25 + Math.asin(Math.min(1, 30 / Math.max(1, distance)));
      if (distance > viewDistance + 12 || (Math.abs(pitch) < 0.85 && distance > 55 && (dx * Math.sin(player.yaw) - dz * Math.cos(player.yaw)) / distance < Math.cos(halfFov + margin))) continue;
      if (distance > 100 && fullyHidden(eye, building, blockers)) continue;
      visible.push({ building, distance });
    }
    // Building chunks: whole city blocks from the static buffer, in range and in view, nearest
    // first so near facades fill the depth buffer before the ones they hide are shaded.
    const chunks: BuildingChunk[] = [];
    for (const block of blocks) {
      const chunk = buildingBatch.chunks.get(`${block.x},${block.z}`);
      if (!chunk) continue;
      const dx = chunk.x - player.x, dz = chunk.z - player.z, distance = Math.hypot(dx, dz);
      if (distance - 46 > viewDistance + 12) continue;
      if (distance > 70 && Math.abs(pitch) < 0.85 && (dx * Math.sin(player.yaw) - dz * Math.cos(player.yaw)) / distance < Math.cos(halfFov + 0.25 + Math.asin(Math.min(1, 50 / distance)))) continue;
      chunks.push(chunk);
    }
    chunks.sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    visibleBuildings = chunks.reduce((sum, chunk) => sum + chunk.buildings, 0);
    const occluders = near.slice(0, 10);
    const boxes = occluders.flatMap(b => [b.x, b.z, b.width / 2, b.depth / 2]);
    const heights = occluders.map(b => b.height);
    while (heights.length < 10) { boxes.push(9999, 9999, 0, 0); heights.push(0); }
    const lamps = near.slice(0, 6).map(b => {
      const faces = signFaces(b).slice(0, 2).sort((a, c) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(c.x - player.x, c.z - player.z));
      const f = faces[0], angle = f.yaw * Math.PI / 180;
      return { position: [f.x + Math.sin(angle), -f.y, f.z + Math.cos(angle), 32], color: f.color.map(v => v / 255) };
    });
    for (const lamp of nearestStreetLamps(player.x, player.z, 2)) lamps.push({ position: [lamp.x, -8, lamp.z, 35], color: [1, 0.66, 0.32] });
    while (lamps.length < 8) lamps.push({ position: [0, -1000, 0, 1], color: [0, 0, 0] });
    if (passenger || platform !== null) {
      lamps[6] = { position: [player.x, -PLATFORM_HEIGHT - 4.1, player.z - 4, 18], color: [1, 0.84, 0.54] };
      lamps[7] = { position: [player.x, -PLATFORM_HEIGHT - 4.1, player.z + 4, 18], color: [0.7, 0.79, 0.65] };
    }
    lamps.forEach((lamp, i) => { sceneData?.set(i, lamp.position); sceneData?.set(i + 8, lamp.color); });
    heights.forEach((height, i) => { sceneData?.set(i + 16, boxes.slice(i * 4, i * 4 + 4)); sceneData?.set(i + 26, [height]); });
    sceneData.set(36, [player.x, eyeY, player.z]);
    const feed = broadcast.drawFramebuffer?.textures ?? [];
    const common = { u_text: textData?.texture ?? sceneData.texture, u_feedGlyph: feed[0] ?? sceneData.texture, u_feedInk: feed[1] ?? sceneData.texture, u_feedPaper: feed[2] ?? sceneData.texture, u_scene: sceneData.texture, u_time: time, u_rain: settings.rain ? 1 : 0, u_atmosphere: settings.effects && profile.atmosphere ? 1 : 0, u_viewRadius: viewDistance, u_fadeIn: reveal };
    const visibility = new Map<string, boolean>();
    // `radius` is the prop's horizontal half-extent: a wide awning or fascia next to the camera stays
    // drawn while any of it is on screen, not only while its centre is (they used to vanish at the
    // edge of the view as you turned).
    const isVisible = (x: number, y: number, z: number, radius = 0) => {
      const key = `${x},${y},${z},${radius}`, cached = visibility.get(key);
      if (cached !== undefined) return cached;
      const dx = x - player.x, dz = z - player.z, distance = Math.hypot(dx, dz);
      if (distance > 10 + radius && Math.abs(pitch) < 0.85 && (dx * Math.sin(player.yaw) - dz * Math.cos(player.yaw)) / distance < Math.cos(halfFov + 0.25 + Math.asin(Math.min(1, radius / Math.max(distance, 1e-3))))) return false;
      // Props are visible when any part could be: test the centre and two points either side.
      const spread = Math.max(3, radius), side = { x: Math.cos(player.yaw) * spread, z: Math.sin(player.yaw) * spread };
      const visible = visibleFrom(eye, { x, y, z }, near) || visibleFrom(eye, { x: x + side.x, y, z: z + side.z }, near) || visibleFrom(eye, { x: x - side.x, y, z: z - side.z }, near);
      visibility.set(key, visible); return visible;
    };
    const view = { x: player.x, z: player.z, yaw: player.yaw, height: cameraHeight, time, signalTime, rain: settings.rain, low: profile.low, visible: isVisible }; // Mobile: profile
    beginVfxFrame({ cam: { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch, fov, aspect: projectionAspect }, time, rows: t.grid?.rows ?? 1, rain: settings.rain, low: view.low, lamps, near, visible, isVisible }, rawDt); // VFX
    const vehicles = traffic.nearby(player.x, player.z, view.low ? 160 : 280);
    // Car lights for the material: nearest cars first, up to 12 slots (texels 240-251).
    const headlights: { x: number; z: number; yaw: number; intensity: number }[] = vehicles
      .map(car => ({ x: car.x, z: car.z, yaw: car.yaw, intensity: 1, distance: Math.hypot(car.x - player.x, car.z - player.z) }))
      .sort((a, b) => a.distance - b.distance);
    if (drive) headlights.unshift({ x: drive.car.x, z: drive.car.z, yaw: drive.car.yaw, intensity: 1 }); // Driving: the player car always gets a slot
    const remotes = presentRemotes;
    remoteLabels = remotes.length ? { remotes, cam: { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch, fov, aspect: projectionAspect }, visible: isVisible } : null; // Multiplayer
    mergeRemoteHeadlights(headlights, remotes, player.x, player.z, !!drive); // Multiplayer: their cars light the street too
    for (let i = 0; i < 12; i++) { const car = headlights[i]; sceneData.set(240 + i, car ? [car.x, car.z, car.yaw, car.intensity] : [0, 0, 0, 0]); }
    sceneData.upload();
    const citizens = population.nearby(player.x, player.z, view.low ? 110 : 220);
    citizenLabelFrame = mode === "walk" ? { citizens, cam: { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch, fov, aspect: projectionAspect }, time, visible: isVisible } : null;
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
    // reflected and main passes. Sign panels, which need per-panel uniforms, are re-walked per
    // pass with SignCanvas; landmarks, screens, holograms and the player's car stay direct.
    const recordProps = (sink: PropCanvas) => {
      drawMetroScene(sink, view, metroTime, passenger?.train ?? null, liftStation, liftHeight);
      counts = drawActivity(sink, view, vehicles, citizens);
      drawDriving(sink, view, parkedNearby, null, false, false); // Driving: kerbside cars
      drawNpcs(sink, view, quests.npcs, id => quests.marker(id), quests.dialogue?.npcId ?? null); // Quests: named NPCs + markers
      drawEnemies(sink, view, rpgEnemies, time); // RPG: enemies, dropped loot, world objects
      drawGroundLoot(sink, view, rpg.groundLoot(player), time);
      drawInteractables(sink, view, rpg.interactables(), time);
      drawWaypointBeacons(sink, view, viewDistance); // World map: waypoint light beacons (waypoint-scene.ts)
      drawRemotePlayers(sink, view, remotes); // Multiplayer: other players' figures and cars (instanced with the props)
      drawInteriorEntrances(sink, interiors.places, player, isVisible);
      for (const { building, distance } of visible) if (distance < (view.low ? 200 : 360)) drawShop(sink, building, distance, player, isVisible, view.low ? 200 : 360);
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
    if (props && !directProps) { props.reset(); recordProps(props); propBatch?.upload(props); }
    const sceneTexture = sceneData.texture;
    // Mobile (perf): the sign passes walk the whole rail scene through textmode transforms only to find its
    // letter panels, which exist only at stations within 400 m and in trains within 150 m (metro-scene.ts).
    // Skipping the walk when neither is near is exact; on reduced profiles the reflection skips them too.
    let metroSigns = passenger !== null || STATIONS.some(s => Math.hypot(player.x - s.x, player.z - s.z) < 400);
    for (let id = 0; id < 4 && !metroSigns; id++) { const train = trainAt(metroTime, id); metroSigns = Math.hypot(train.x - player.x, train.z - player.z) < 150; }
    const batchCamera = (mirror: boolean): BatchCamera => ({ x: player.x, y: mirror ? cameraHeight : eyeY, z: player.z, yaw: viewYaw, pitch: viewPitch, fov, aspect: projectionAspect, mirror });
    const scenery = (mirror: boolean) => {
      const frame: BatchFrame = { scene: sceneTexture, text: textData?.texture ?? sceneTexture, time, rain: settings.rain, atmosphere: !mirror && common.u_atmosphere === 1, viewRadius: viewDistance, fadeIn: reveal };
      // Sky dome centred on the eye: it turns with the camera, and the fog uses the same colours.
      t.setUniform("u_surface", 4);
      t.push(); t.translate(player.x, mirror ? cameraHeight : eyeY, player.z); t.sphere(1500); t.pop();
      t.setUniform("u_surface", 0);
      if (referenceRenderer) for (const { building, distance } of visible) drawBuilding(t, building, distance);
      else buildingBatch?.draw(batchCamera(mirror), frame, chunks);
      t.setUniform("u_surface", 2);
      propRange(0);
      for (const landmark of LANDMARKS) if (Math.hypot(player.x - landmark.x, player.z - landmark.z) < viewDistance + 60) drawLandmark(t, landmark, time);
      if (directProps || !signs) recordProps(t);
      else {
        propBatch?.draw(batchCamera(mirror), frame);
        if (metroSigns && !(mirror && profile.low)) drawMetroScene(signs, view, metroTime, passenger?.train ?? null, liftStation, liftHeight, true); // Mobile (perf): see metroSigns
        for (const { building, distance } of visible) if (distance < (mirror ? 120 : view.low ? 200 : 360)) drawShop(signs, building, distance, player, isVisible, view.low ? 200 : 360);
      }
      if (drive) drawDriving(t, view, [], drive.car, drive.exterior, mirror); // Driving: player car / cockpit
      if (!mirror) { // RPG: the weapon in hand (true camera, so it stays put through the view warp) and combat effects
        if (onFoot && !combatView.dead) drawViewmodel(t, { x: player.x, y: cameraHeight, z: player.z, yaw: player.yaw, pitch }, combatView, rpg.weapon(), time);
        drawCombatEffects(t, hudFrame?.effects ?? [], vfxCam, time, t.grid?.rows ?? 90);
      }
      // Hologram screens read the synth feed's cells directly, so they share fog and lighting.
      if (broadcast.drawFramebuffer && profile.holograms) { // Mobile: profile (desktop: !low)
        t.setUniform("u_surface", 5);
        propRange(viewDistance * 0.6); t.cellColor(0, 0, 0, propAlpha());
        for (const { building, distance } of visible) {
          if (building.id % 17 !== 0 || distance > viewDistance * 0.6) continue;
          const face = signFaces(building)[1];
          t.push(); t.translate(face.x, -Math.min(building.height - 8, 28), face.z); t.rotateY(face.yaw);
          t.rect(6, 9); t.pop();
        }
      }
      // Holograms: tall translucent projections off the upper floors of a few towers, showing the
      // synth feed with a slogan crawling through them. Fog, not a draw distance, hides them.
      if (broadcast.drawFramebuffer && profile.holograms) { // Mobile: profile (desktop: !low)
        t.setUniform("u_surface", 7);
        for (const { building } of visible) {
          if (building.id % 11 !== 0 || building.height < 70) continue;
          const face = signFaces(building)[1], angle = face.yaw * Math.PI / 180, size = 10 + (building.id % 3) * 3;
          t.setUniforms({ u_holoRow: building.id % MESSAGES.length, u_holoSeed: (building.id * 0.618) % 1, u_holoTint: HOLO_TINTS[building.id % HOLO_TINTS.length] });
          t.push(); t.translate(face.x + Math.sin(angle) * 5, -building.height * 0.62, face.z + Math.cos(angle) * 5); t.rotateY(face.yaw);
          t.rect(size * 1.25, size * 2.1); t.pop();
        }
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
    if (settings.rain && profile.reflections) {
      camera(true); t.shader(reflectionMaterial); t.setUniforms({ ...common, u_mirror: 1, u_atmosphere: 0 });
      scenery(true);
    } else if (settings.rain) {
      // Mobile: light reflection mode - puddles mirror the sky dome only (skips the second scene walk).
      camera(true); t.shader(reflectionMaterial); t.setUniforms({ ...common, u_mirror: 1, u_atmosphere: 0, u_surface: 4 });
      t.push(); t.translate(player.x, cameraHeight, player.z); t.sphere(1500); t.pop();
      t.resetShader();
    }
    reflection.end();
    t.clear();
    camera(false); t.shader(material);
    t.setUniforms({ ...common, u_mirror: 0, u_surface: 1,
      u_reflectionGlyph: reflection.textures[0], u_reflectionInk: reflection.textures[1], u_reflectionPaper: reflection.textures[2] });
    t.char("-"); t.push(); t.translate(0, 0.08, 0); t.rotateX(90); t.rect(WORLD_EDGE * 2, WORLD_EDGE * 2); t.pop();
    scenery(false);
    if (settings.effects && profile.bloom) { // Mobile: profile
      t.filter("neon-clarity", { radius: 2 * pixelDensity, strength: 0.28 });
    }
    if (performance.now() - lastSnapshot > 160) { lastSnapshot = performance.now(); snapshot(); }
    cpuAverage += (performance.now() - frameStart - cpuAverage) * 0.05; // Mobile: governor input
  });

  return {
    world,
    enter() {
      if (!ready || disposed || contextLost) return;
      closeDialogue(); // Quests: resuming always ends an open conversation.
      running = true;
      ambience.set(settings.sound && !interiors.active);
      canvas.focus({ preventScroll: true }); // Mobile: never scroll the page on iOS
      governor.hold(performance.now());
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
      const station = STATIONS.find(candidate => candidate.id === destination) ?? STATIONS[4];
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
      if (changedQuality) { governor.hold(performance.now()); applyProfile(); void applyAtlas().then(resize).catch(rendererError); blockCache = ""; } // Mobile: profile
      if (changedMotion && ready) broadcastFeed();
      ambience.set(running && settings.sound && !interiors.active);
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
        reflectionMaterial?.dispose();
        interiorMaterial?.dispose();
        material?.dispose();
      }
      t.destroy();
    },
  };
}
