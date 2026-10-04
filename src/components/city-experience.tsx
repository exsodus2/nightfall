"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CityBootStage, CityController, CitySettings, CitySnapshot, Quality } from "@/city/engine";
import { CityWorld, DISTRICTS, LANDMARKS, SPAWN, type Landmark } from "@/city/world";
import { CityMap } from "./city-map";
import { MODE_NAMES, WALK_HEIGHT, type RideMode } from "@/city/locomotion";
import { SceneStudio } from "./scene-studio";
// Quest UI: dialogue, tracker, log and toasts live in their own components.
import type { NpcDialogue } from "@/city/quests";
import { QuestDialogue, dialogueKey } from "./quest-dialogue";
import { QuestTracker } from "./quest-tracker";
import { QuestLog, useQuestLogHotkey } from "./quest-log";
import { ToastStack, createToast, enqueueToast, type Toast } from "./toasts";
import { DriveHud } from "./drive-hud"; // Driving agent: controls strip while driving
import { Radio } from "./radio"; // Radio: Nightride FM widget + hotkeys (self-contained)
// Multiplayer: Colyseus room (optional), lobby, chat and roster (src/multiplayer, server/).
import { useMultiplayer } from "@/multiplayer/use-multiplayer";
import { MultiplayerLobby } from "./multiplayer-lobby";
import { ChatPanel } from "./chat-panel";
// World map: WoW-style map overlay on M (city keeps running), waypoints, compass HUD, heading-up minimap.
import { WorldMap } from "./world-map";
import { WaypointHud } from "./waypoint-hud";
import { useWorldMap } from "./use-world-map";
import { useWaypointSession, useWaypointState } from "./use-waypoints";
import mapStyles from "./world-map.module.css";
// Mobile: phone controls, touch settings, Safari shell (visual viewport, gestures) and device class.
import { RotateHint, TouchControls } from "./touch-controls";
import { TouchSettings } from "./touch-settings";
import { useTouchUi } from "./touch-prefs";
import { useMobileShell } from "./use-mobile-shell";
import { isTouchFirst } from "@/city/device";
// RPG UI: inventory & character (I / Tab), vendor, death screen, pickup prompt, loot feed (src/components/rpg).
import { InventoryButton, RpgPrompt, RpgScreens, useRpgUi } from "./rpg";
import { interiorPlaces } from "@/city/interiors";
import { InteriorMap } from "./interior-map";
import { TRAIN_EYE_HEIGHT } from "@/city/metro";

type Phase = "loading" | "intro" | "playing" | "paused" | "error" | "lost"; // Mobile: "lost" = WebGL context lost
type Panel = "map" | "settings" | "transit" | null;
type BootStage = "opening" | CityBootStage;
const BOOT_STAGES: readonly CityBootStage[] = ["materials", "scene", "glyphs"];
const BOOT_LABELS: Record<BootStage, string> = { opening: "Opening the city.", materials: "Preparing light, glass and reflections.", scene: "Preparing streets and sheltered rooms.", glyphs: "Fitting the letters to your screen." };
const BOOT_STEPS: Record<CityBootStage, string> = { materials: "Lights", scene: "Streets", glyphs: "Letters" };
const DEFAULT_SETTINGS: CitySettings = { rain: true, effects: true, sound: false, motion: true, quality: "high", sensitivity: 1 };
const INITIAL_SNAPSHOT: CitySnapshot = { ...SPAWN, sceneTime: 0, metroTime: 0, visibleBuildings: 0, district: 4, distance: 0, fps: 0, discovered: [], nearby: null, mode: "walk", altitude: WALK_HEIGHT, speed: 0, destination: null, progress: 0, cars: 0, residents: 0, interaction: null, station: null, cabin: null, population: { walking: 0, waiting: 0, visiting: 0, riding: 0, commuters: 0 }, quests: { credits: 0, log: [], nearbyNpc: null, tracked: null } };

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return <button type="button" className="setting-row" role="switch" aria-checked={checked} onClick={onChange}>
    <span><strong>{label}</strong><small>{description}</small></span>
    <span className="toggle-track" data-checked={checked}><span /></span>
  </button>;
}

function coordinate(value: number): string { return `${value < 0 ? "−" : ""}${Math.abs(Math.round(value)).toString().padStart(4, "0")}`; }

export function CityExperience() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef<CityController | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movement = useRef(new Set<string>());
  const [phase, setPhase] = useState<Phase>("loading");
  const [bootStage, setBootStage] = useState<BootStage>("opening");
  const [panel, setPanel] = useState<Panel>(null);
  const [rideMode, setRideMode] = useState<RideMode>("taxi");
  const [settings, setSettings] = useState<CitySettings>(DEFAULT_SETTINGS);
  const [snapshot, setSnapshot] = useState<CitySnapshot>(INITIAL_SNAPSHOT);
  const [world, setWorld] = useState<CityWorld | null>(null);
  const [engine, setEngine] = useState<CityController | null>(null);
  const [notice, setNotice] = useState<Landmark | null>(null);
  const [error, setError] = useState("");
  // Quest UI state
  const [dialogue, setDialogue] = useState<NpcDialogue | null>(null);
  const [questLog, setQuestLog] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dialogueOpen = useRef(false);
  const recovering = useRef(false);
  const rebuildPending = useRef(false);
  // Multiplayer: lobby panel + room session (toasts reuse the quest notifications).
  const [lobby, setLobby] = useState(false);
  const toast = useCallback((message: string) => { const item = createToast(message); setToasts((current) => enqueueToast(current, item)); }, []);
  const multiplayer = useMultiplayer(engine, toast);
  const district = DISTRICTS[snapshot.district];
  const ready = phase !== "loading" && phase !== "error" && phase !== "lost";
  // Mobile: touch UI, radio widget folded into the touch drawer, and engine rebuilds after a lost context.
  const touchUi = useTouchUi();
  const [radioOpen, setRadioOpen] = useState(false);
  const [bootKey, setBootKey] = useState(0);
  const settingsRef = useRef<CitySettings | null>(null);
  const poseRef = useRef<{ x: number; z: number; yaw: number; cabin: CitySnapshot["cabin"]; metroTime: number } | null>(null);
  const radioAudible = useRef(false); // Radio: re-applied to a rebuilt engine (the radio survives a lost context)
  useMobileShell();
  useEffect(() => { settingsRef.current = settings; poseRef.current = { ...(snapshot.interior?.entrance ?? { x: snapshot.x, z: snapshot.z, yaw: snapshot.yaw }), cabin: snapshot.cabin, metroTime: snapshot.metroTime }; }, [settings, snapshot]);

  const rebuildCity = useCallback(() => {
    if (!recovering.current || rebuildPending.current) return;
    rebuildPending.current = true;
    setBootStage("opening");
    setPhase("loading");
    setBootKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let city: CityController | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Mobile: a rebuild (bootKey > 0) keeps the player's settings and position.
    const rebuild = bootKey > 0 ? poseRef.current : null;
    async function boot() {
      try {
        const { createCity } = await import("@/city/engine");
        if (cancelled || !canvas) return;
        const initial: CitySettings = settingsRef.current && bootKey > 0 ? settingsRef.current : { ...DEFAULT_SETTINGS, quality: isTouchFirst() ? "auto" : DEFAULT_SETTINGS.quality }; // Mobile: phones start on Auto
        setSettings(initial);
        city = createCity(canvas, initial, {
          onReady: () => { if (!cancelled) { recovering.current = false; rebuildPending.current = false; if (rebuild) { if (rebuild.cabin) city?.restorePassenger(rebuild.cabin, rebuild.metroTime); else city?.travel(rebuild.x, rebuild.z, rebuild.yaw); city?.duckAmbience(radioAudible.current ? 0.4 : 1); } setPhase(rebuild ? "paused" : "intro"); if (!rebuild && new URLSearchParams(location.search).has("room")) setLobby(true); } }, // Multiplayer: invite links open the lobby
          onBootStage: (stage) => { if (!cancelled) setBootStage(stage); },
          onContextLost: () => {
            if (cancelled) return;
            recovering.current = true;
            rebuildPending.current = false;
            dialogueOpen.current = false;
            setDialogue(null);
            setPanel(null);
            setQuestLog(false);
            setLobby(false);
            setPhase("lost");
          },
          onContextRestored: () => { if (!cancelled) rebuildCity(); },
          onError: (message) => { if (!cancelled) { rebuildPending.current = false; setError(message); setPhase("error"); } },
          onSnapshot: (next) => { if (!cancelled) setSnapshot(next); },
          onPause: () => { if (!cancelled) setPhase("paused"); },
          onMap: () => { if (!cancelled) { setPhase("paused"); setPanel("map"); } },
          onTransit: () => { if (!cancelled) { setPhase("paused"); setPanel("transit"); } },
          // Quest UI: the engine has already paused and released the mouse; recapture it when the conversation ends.
          onDialogue: (next) => {
            if (cancelled || recovering.current) return;
            setDialogue(next);
            if (next) { dialogueOpen.current = true; return; }
            if (!dialogueOpen.current) return;
            dialogueOpen.current = false;
            setPhase("playing");
            controller.current?.enter();
          },
          onQuestUpdate: (message) => { if (!cancelled) { const toast = createToast(message); setToasts((current) => enqueueToast(current, toast)); } },
          onDiscovery: (landmark) => {
            if (cancelled) return;
            setNotice(landmark);
            if (noticeTimer.current) clearTimeout(noticeTimer.current);
            noticeTimer.current = setTimeout(() => setNotice(null), 6500);
          },
        });
        controller.current = city;
        setEngine(city);
        setWorld(city.world);
      } catch (cause) {
        if (!cancelled) { rebuildPending.current = false; setError(cause instanceof Error ? cause.message : "Unable to initialize WebGL2."); setPhase("error"); }
      }
    }
    void boot();
    return () => {
      cancelled = true;
      controller.current = null;
      city?.destroy();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [bootKey, rebuildCity]);

  useEffect(() => { controller.current?.setSettings(settings); }, [settings]);
  useEffect(() => {
    if (phase !== "playing") {
      movement.current.clear();
      controller.current?.setTouchMovement(0, 0);
    }
  }, [phase]);

  const openPanel = useCallback((next: Panel) => {
    if (recovering.current) return;
    controller.current?.pause();
    setPhase((current) => current === "playing" ? "paused" : current);
    setPanel(next);
  }, []);

  // Quest UI callbacks: stable so child effects don't re-run on every snapshot.
  const openQuestLog = useCallback(() => {
    if (recovering.current) return;
    controller.current?.pause();
    setPhase((current) => current === "playing" ? "paused" : current);
    setPanel(null);
    setLobby(false); // J over the Online panel swaps to the log instead of stacking two modal dialogs
    setQuestLog(true);
  }, []);
  const closeQuestLog = useCallback(() => setQuestLog(false), []);
  // Multiplayer: the Online panel pauses like the other panels.
  const openLobby = useCallback(() => {
    if (recovering.current) return;
    controller.current?.pause();
    setPhase((current) => current === "playing" ? "paused" : current);
    setPanel(null); setQuestLog(false); setLobby(true);
  }, []);
  const closeLobby = useCallback(() => setLobby(false), []);
  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const chooseDialogue = useCallback((optionId: string) => controller.current?.chooseDialogue(optionId), []);
  const closeDialogue = useCallback(() => controller.current?.closeDialogue(), []);
  useQuestLogHotkey(ready && !dialogue, questLog, openQuestLog, closeQuestLog);
  // RPG UI: renders nothing until snapshot.rpg exists. Its screens pause like the quest log; feed lines become toasts.
  const rpgUi = useRpgUi({
    real: snapshot.rpg, controller, canvas: canvasRef, ready, phase, dialogue: !!dialogue, others: !!panel || questLog || lobby,
    pauseCity: () => { controller.current?.pause(); setPhase((current) => current === "playing" ? "paused" : current); },
    resumeCity: () => enter(),
    closeOthers: () => { setPanel(null); setQuestLog(false); setLobby(false); },
    onFeed: (entry, style) => { const item = createToast(entry.text, { tone: entry.tone, ...style }); setToasts((current) => enqueueToast(current, item)); },
  });
  // Radio: duck the rain bed while the radio is audible.
  const duckRain = useCallback((audible: boolean) => { radioAudible.current = audible; controller.current?.duckAmbience(audible ? 0.4 : 1); }, []);
  // World map: M toggles it without pausing; conversations, panels, the quest log and the lobby close it.
  const worldMap = useWorldMap({ ready, phase, blocked: !ready || !!dialogue || !!panel || questLog || lobby || rpgUi.blocking /* RPG UI */, controller, canvas: canvasRef });
  const waypointState = useWaypointState();
  const [minimapRotate, setMinimapRotate] = useState(false);
  const linkWaypointToast = useCallback((label: string) => toast(`Waypoint added from link: ${label}`), [toast]);
  useWaypointSession(ready, linkWaypointToast);

  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const cityCanvas = canvasRef.current;
    dialog?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPanel(null); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>("button, input, select, [tabindex='0']");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => { window.removeEventListener("keydown", handleKey); if (previous instanceof HTMLElement && document.activeElement !== cityCanvas) previous.focus(); };
  }, [panel]);

  function enter() { if (!ready || recovering.current) return; setPanel(null); setPhase("playing"); controller.current?.enter(); }
  function travel(x: number, z: number, yaw?: number) { setNotice(null); controller.current?.travel(x, z, yaw); enter(); }
  function ride(destination: number) { controller.current?.ride(rideMode, destination); enter(); }
  function freeMode(mode: "walk" | "fly") { controller.current?.setMode(mode); enter(); }
  function changeSetting<K extends keyof CitySettings>(key: K, value: CitySettings[K]) { setSettings((current) => ({ ...current, [key]: value })); }

  return <main className="city-experience" data-touch={touchUi /* Mobile */} data-quality={snapshot.render ? `${settings.quality}:${snapshot.render.level}:${snapshot.render.cell}` : ""} data-phase={phase} data-mode={snapshot.mode} data-station={snapshot.station ?? ""} data-cabin-u={snapshot.cabin?.u.toFixed(2) ?? ""} data-cabin-v={snapshot.cabin?.v.toFixed(2) ?? ""} data-doors={snapshot.cabin?.doors.toFixed(2) ?? ""} data-dialogue={!!dialogue /* Quest UI */}>
    <canvas key={bootKey /* Mobile: a fresh canvas (and WebGL context) after a lost context */} ref={canvasRef} className="city-canvas" tabIndex={0} aria-label="First-person cyberpunk city. Use W A S D to walk, mouse or arrow keys to look, and Escape to pause." />
    <div className="edge-shade" aria-hidden="true" />
    {/* Mobile: phone controls. Rendered before the HUD so the minimap, quest tracker and radio stay tappable above its zones. */}
    {phase === "playing" && touchUi && !worldMap.open && !dialogue ? <TouchControls controller={controller} snapshot={snapshot} online={multiplayer.view.status === "connected"} radioOpen={radioOpen}
      onPause={() => { controller.current?.pause(); setPhase("paused"); }} onTransit={() => openPanel("transit")} onMap={worldMap.openMap} onQuests={openQuestLog} onInventory={rpgUi.rpg ? rpgUi.openInventory : undefined /* RPG UI */}
      onRadio={() => setRadioOpen((open) => !open)} onOnline={openLobby} onSettings={() => openPanel("settings")} /> : null}
    {touchUi && (phase === "intro" || phase === "playing") ? <RotateHint /> : null}
    <SceneStudio city={controller} snapshot={snapshot} onExplore={enter} />

    <header className="city-header">
      <Link className="wordmark" href="/" aria-label="Nightfall home"><span className="brand-mark" aria-hidden="true">N<span>/</span></span><span>nightfall<span className="wordmark-dot">.</span></span></Link>
      <span className="header-subtitle">A city in characters</span>
      <nav aria-label="City controls" className="header-controls">
        <button className="quiet-button" disabled={!ready} onClick={() => openPanel("transit")}>Transit <kbd>T</kbd></button>
        <button className="quiet-button" disabled={!ready} onClick={worldMap.openMap}>City map <kbd>M</kbd></button>{/* World map */}
        <button className="quiet-button header-quests" disabled={!ready} onClick={openQuestLog}>Quests <kbd>J</kbd></button>{/* Quest UI */}
        <InventoryButton ui={rpgUi} disabled={!ready} />{/* RPG UI */}
        <button className="quiet-button" disabled={!ready} onClick={openLobby} data-online={multiplayer.view.status}>{multiplayer.view.status === "connected" ? `Online · ${multiplayer.view.roster.length}` : "Online"} <span aria-hidden="true">{multiplayer.view.status === "connected" ? "◉" : "◌"}</span></button>{/* Multiplayer */}
        <button className="quiet-button" disabled={!ready} onClick={() => openPanel("settings")}>Settings <span aria-hidden="true">☷</span></button>
      </nav>
    </header>

    <div className="location-strip" aria-live="off">
      <span className="status-light" aria-hidden="true" />
      <span>{snapshot.interior?.name ?? district.name}</span><span className="location-divider">/</span><span className="location-description">{snapshot.interior ? `${district.name} · Indoors` : district.description}</span>
    </div>

    {phase === "loading" ? <div className="loading-state" role="status" aria-atomic="true" data-boot-stage={bootStage}>
      <span className="loading-glyph" aria-hidden="true">▒</span>
      <h1>{bootKey > 0 ? "Rebuilding the city" : "Building the skyline"}</h1>
      <p>{BOOT_LABELS[bootStage]}</p>
      <div className="loading-stages" aria-hidden="true">{BOOT_STAGES.map((stage, index) => {
        const current = BOOT_STAGES.findIndex(candidate => candidate === bootStage);
        return <span key={stage} data-state={current > index ? "done" : current === index ? "current" : "waiting"}><span>{current > index ? "[x]" : current === index ? "[>]" : "[ ]"}</span>{BOOT_STEPS[stage]}</span>;
      })}</div>
      <p className="loading-hint">First visits can take longer while your browser prepares the graphics.</p>
      <span className="loading-line" aria-hidden="true" />
    </div> : null}
    {phase === "lost" ? <div className="error-state" role="alert"><h1>The city lost its graphics context.</h1><p>Your browser released the graphics context. Rebuild the city to continue from your last position.</p><button className="primary-button" onClick={rebuildCity}>Rebuild the city<span aria-hidden="true">↻</span></button><button className="reset-position" onClick={() => location.reload()}>Reload the page <span aria-hidden="true">↗</span></button></div> : null}{/* Mobile */}
    {phase === "error" ? <div className="error-state" role="alert"><h1>The city couldn’t start.</h1><p>This experience needs a browser with WebGL2 and hardware acceleration enabled.</p><details><summary>Technical details</summary><p>{error}</p></details><button className="primary-button" onClick={() => location.reload()}>Try again</button></div> : null}

    {(phase === "intro" || phase === "paused") && !panel && !worldMap.open /* World map */ ? <section className="entry-panel" aria-label={phase === "intro" ? "Welcome to Nightfall" : "City paused"}>
      <div className="entry-index"><span className="entry-rule" />{phase === "intro" ? "Free to wander. Nothing to outrun." : "Take a breath. The city can wait."}</div>
      <h1>{phase === "intro" ? <>Somewhere,<br />after midnight.</> : snapshot.interior ? <>Out of the rain.<br />For a moment.</> : <>Still here.<br />Still raining.</>}</h1>
      <p className="entry-description">{phase === "intro" ? "Street traffic. Last trains. Lights above the rain. Walk six districts, hail a cab, or take to the skyline." : `${district.name}. ${Math.round(snapshot.distance)} metres behind you. A whole city still ahead.`}</p>
      <button className="primary-button" onClick={enter}>{phase === "intro" ? "Enter the city" : snapshot.mode === "walk" ? "Keep walking" : "Continue journey"}<span aria-hidden="true">↗</span></button>
      <div className="entry-controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span><span><span className="mouse-symbol" aria-hidden="true" /> look</span><span><kbd>Shift</kbd> run</span></div>
      <p className="touch-instructions">Left thumb moves: the stick appears where you touch, push past its ring to run. Right thumb: swipe to look.</p>
    </section> : null}

    {phase === "playing" ? <>
      <div className="crosshair" aria-hidden="true"><span /><span /></div>
      {/* Driving agent: tiny self-contained controls strip (drive-hud.tsx), renders only in drive mode. */}
      <DriveHud snapshot={snapshot} onToggleView={() => controller.current?.action("camera", true)} />
      {!worldMap.open ? <WaypointHud snapshot={snapshot} /> : null}{/* World map: compass + bearing to the active waypoint */}
      {/* RPG UI: the pickup prompt takes the same slot when E would pick up (cars and people come first; loot beats the street lift). */}
      {rpgUi.rpg?.prompt && snapshot.mode === "walk" && (!snapshot.interaction || snapshot.interaction === "Take lift to the platform") ? <RpgPrompt prompt={rpgUi.rpg.prompt} onInteract={() => controller.current?.interact()} />
        : snapshot.interaction ? <button className="interaction-prompt" disabled={snapshot.interaction.startsWith("Walk") || snapshot.interaction === "Lift in motion" || snapshot.interaction === "Finish combat before entering"} onClick={() => controller.current?.interact()}><kbd>E</kbd>{snapshot.interaction}</button> : null}
      <div className="walking-hint"><kbd>Esc</kbd> pause <span /> <kbd>T</kbd> transport <span /> <kbd>{snapshot.mode === "fly" ? "Q / C" : "Space"}</kbd> {snapshot.mode === "fly" ? "rise / descend" : "jump"}</div>
      <div className="travel-hud" aria-label="Locomotion status">
        <span className="travel-symbol" aria-hidden="true">{snapshot.mode === "walk" ? "↟" : snapshot.mode === "metro" ? "═" : "↗"}</span>
        <div><small>{snapshot.interior ? "Indoors · Explore the room" : MODE_NAMES[snapshot.mode]}</small><strong>{snapshot.interior?.name ?? snapshot.destination ?? (snapshot.mode === "fly" ? `${Math.round(snapshot.altitude)} m above the street` : "Follow the lights")}</strong>
          {snapshot.destination ? <div className="journey-progress"><span style={{ width: `${snapshot.progress * 100}%` }} /></div> : null}
        </div>
        {!snapshot.interior ? <span className="travel-speed">{Math.round(snapshot.speed * 3.6)}<small>km/h</small></span> : null}
        {snapshot.mode === "metro" ? <button onClick={() => controller.current?.interact()} disabled={snapshot.interaction !== "Step onto the platform"}>Alight <kbd>E</kbd></button> : snapshot.mode !== "walk" ? <button onClick={() => freeMode("walk")} aria-label="End ride and return to walking">Exit <kbd>E</kbd></button> : <button onClick={() => openPanel("transit")}>{snapshot.interior ? "Places" : "Ride"} <span>↗</span></button>}
      </div>
      {/* Mobile: the old direction pad and touch buttons were replaced by <TouchControls> above. */}
    </> : null}

    {ready && !panel && !worldMap.open ? <aside className="navigation-widget" aria-label="Local navigation">
      {/* World map: the north mark toggles a heading-up minimap; the minimap opens the world map and shows waypoints. */}
      <div className="map-heading"><span>{snapshot.interior ? "Room layout" : "Local streets"}</span>{!snapshot.interior ? <button type="button" className={`north-mark ${mapStyles.minimapToggle}`} aria-pressed={minimapRotate} onClick={() => setMinimapRotate((value) => !value)} title={minimapRotate ? "Heading up: click for north up" : "North up: click for heading up"}>{minimapRotate ? "▲ ahead" : "N ↑"}</button> : <span>Exit ↓</span>}</div>
      <button className="minimap-button" onClick={worldMap.openMap} aria-label="Open city map" aria-describedby={snapshot.interior ? "interior-map-description" : undefined}>{snapshot.interior ? <InteriorMap place={snapshot.interior} snapshot={snapshot} /> : <CityMap world={world} snapshot={snapshot} waypoints={waypointState.waypoints} activeWaypointId={waypointState.activeId} rotate={minimapRotate} />}<span className="map-corner top-left" /><span className="map-corner bottom-right" /></button>
      <div className="map-caption"><span className="you-dot" />You are here<span>{snapshot.interior ? "Sheltered" : `${snapshot.discovered.length} / 6 found`}</span></div>
    </aside> : null}

    {/* Quest UI: tracker + credits, NPC conversation, notifications and the quest log. */}
    {(phase === "playing" || phase === "paused") && !panel && !questLog && !worldMap.open ? <QuestTracker quests={snapshot.quests} x={snapshot.x} z={snapshot.z} yaw={snapshot.yaw} onOpenLog={openQuestLog} /> : null}
    {dialogue ? <QuestDialogue key={dialogueKey(dialogue)} dialogue={dialogue} onChoose={chooseDialogue} onClose={closeDialogue} /> : null}
    <ToastStack toasts={toasts} onDismiss={dismissToast} />
    {ready ? <RpgScreens ui={rpgUi} place={district.name} /> : null}{/* RPG UI: inventory / vendor / death */}
    {questLog ? <QuestLog quests={snapshot.quests} onTrack={(quest) => controller.current?.rpgAction({ kind: "trackQuest", quest })} onClose={closeQuestLog} onResume={() => { setQuestLog(false); enter(); }} /> : null}
    {/* Multiplayer: Online panel, and room chat + roster while connected. */}
    {lobby ? <MultiplayerLobby view={multiplayer.view} pose={{ x: snapshot.x, y: Math.max(0, snapshot.altitude - (snapshot.cabin ? TRAIN_EYE_HEIGHT : WALK_HEIGHT)), z: snapshot.z, yaw: snapshot.yaw, pitch: snapshot.pitch, heading: snapshot.yaw, speed: 0, mode: snapshot.mode, car: 0, place: snapshot.interior?.id ?? "", carrier: snapshot.cabin }} onConnect={multiplayer.connect} onLeave={multiplayer.leave} onClose={closeLobby} onResume={() => { setLobby(false); enter(); }} /> : null}
    {ready && multiplayer.view.status === "connected" && !panel && !questLog && !lobby ? <ChatPanel view={multiplayer.view} enabled={phase === "playing" && !dialogue} onSend={multiplayer.sendChat} /> : null}
    {/* World map: large overlay; the city keeps running behind it when opened while playing. */}
    {worldMap.open && world ? <WorldMap world={world} snapshot={snapshot} live={worldMap.live} onClose={worldMap.closeMap} /> : null}
    {/* Radio: mounted once the city is ready and kept mounted so audio survives pauses/panels; `visible` only hides the widget. */}
    {ready || phase === "lost" || phase === "loading" && bootKey > 0 /* Mobile: a lost GPU context must not stop the music */ ? <Radio active={ready && !dialogue && !panel && !questLog && !lobby && !rpgUi.blocking /* RPG UI */} visible={ready && !panel && !questLog && !lobby && (!touchUi || radioOpen) /* Mobile: opened from the touch drawer */} driving={snapshot.mode === "drive"} onAudibleChange={duckRain} /> : null}

    <footer className="city-footer">
      <div className="footer-place"><span>Night cycle</span><span className="footer-dash" /><span>{snapshot.interior ? "Sheltered from the rain" : settings.rain ? "Persistent rain" : "Clear skies"}</span></div>
      <div className="coordinates" aria-label="Player coordinates" data-x={snapshot.x.toFixed(2)} data-z={snapshot.z.toFixed(2)} data-y={snapshot.altitude.toFixed(2)} data-yaw={snapshot.yaw.toFixed(4)} data-cars={snapshot.cars} data-residents={snapshot.residents}><span>{coordinate(snapshot.x)} E</span><span>{coordinate(-snapshot.z)} N</span><span className="fps-count">{snapshot.fps || "—"} fps</span></div>
    </footer>

    <div className="discovery-notice" data-visible={!!notice} role="status" aria-live="polite">{notice ? <><span className="discovery-symbol" aria-hidden="true">◇</span><div><small>Place discovered</small><strong>{notice.name}</strong><p>{notice.description}</p></div></> : null}</div>

    {panel ? <div className="panel-backdrop" onClick={() => setPanel(null)}>
      <section className="side-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" tabIndex={-1} ref={dialogRef} onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading"><div><span className="panel-kicker">Nightfall city services</span><h2 id="panel-title">{panel === "map" ? "Find your way." : panel === "transit" ? "Enjoy the ride." : "Make it yours."}</h2></div><button className="close-button" onClick={() => setPanel(null)} aria-label="Close panel">×</button></div>
        {panel !== "settings" ? <>
          <p className="panel-intro">Hail a cab, catch the elevated loop, or explore above the skyline.</p>
          <div className="transit-modes" aria-label="Transportation mode">{(["taxi", "metro", "sky"] as RideMode[]).map(mode => <button key={mode} aria-label={MODE_NAMES[mode]} aria-pressed={rideMode === mode} onClick={() => setRideMode(mode)}><span aria-hidden="true">{mode === "taxi" ? "▰" : mode === "metro" ? "═" : "↗"}</span>{MODE_NAMES[mode]}</button>)}</div>
          <p className="ride-description">{rideMode === "taxi" ? "A street-level cab ride through the grid. Door-to-door, with every turn along the way." : rideMode === "metro" ? "Visit a station. Press E at the lift, walk to an open train door, and board. Explore all three carriages while the city passes. Step off at any of the six stations." : "Lift off vertically, cross the skyline above the towers, and descend into your destination."}</p>
          <CityMap world={world} snapshot={snapshot} full />
          <div className="atlas-legend"><span><i className="you-dot" /> Your position</span><span>◇ Landmark</span><span className="atlas-quest-key">◆ Quest</span><span>North ↑</span></div>
          <h3 className="section-title">{rideMode === "metro" ? "Visit a station" : "Choose your destination"} <span>{MODE_NAMES[rideMode]}</span></h3>
          <div className="district-stops">{DISTRICTS.map((item) => <button key={item.id} onClick={() => ride(item.id)}><span className="line-color" style={{ background: item.hex }} /><span>{item.name}</span><small>{Math.round(Math.hypot(snapshot.x - item.x, snapshot.z - item.z))} m</small><span aria-hidden="true">↗</span></button>)}</div>
          <div className="free-modes"><button onClick={() => freeMode("walk")}>Explore on foot <kbd>WASD</kbd></button><button onClick={() => freeMode("fly")}>Free flight <kbd>F</kbd></button></div>
          <h3 className="section-title">Step inside <span>6 open doors</span></h3>
          <p className="ride-description">Visit a doorway, then press E to enter. Each district has a place to get out of the rain.</p>
          <div className="landmark-list">{world ? interiorPlaces(world).map(place => <button key={place.id} onClick={() => travel(place.entrance.x, place.entrance.z, place.entrance.yaw)} aria-label={`Visit ${place.name}`}><span className="landmark-found" aria-hidden="true">⌂</span><span>{place.name}<small>{DISTRICTS[place.district].name} · {Math.round(Math.hypot(snapshot.x - place.entrance.x, snapshot.z - place.entrance.z))} m</small></span><span aria-hidden="true">↗</span></button>) : null}</div>
          <h3 className="section-title">Places worth finding <span>{snapshot.discovered.length}/6</span></h3>
          <div className="landmark-list">{LANDMARKS.map((landmark) => <button key={landmark.id} onClick={() => travel(landmark.arrivalX, landmark.arrivalZ)} aria-label={`Travel to ${landmark.name}`}><span className={snapshot.discovered.includes(landmark.id) ? "landmark-found" : "landmark-marker"}>{snapshot.discovered.includes(landmark.id) ? "✓" : "◇"}</span><span>{landmark.name}<small>{Math.round(Math.hypot(snapshot.x - landmark.x, snapshot.z - landmark.z))} m away</small></span><span aria-hidden="true">↗</span></button>)}</div>
        </> : <>
          <p className="panel-intro">Tune the atmosphere. The streets will be here when you’re ready.</p>
          <Toggle label="Rain" description="Falling rain and wet street reflections" checked={settings.rain} onChange={() => changeSetting("rain", !settings.rain)} />
          <Toggle label="Neon bloom" description="A soft glow around emissive characters" checked={settings.effects} onChange={() => changeSetting("effects", !settings.effects)} />
          <Toggle label="City ambience" description="A quiet bed of rain while you walk" checked={settings.sound} onChange={() => changeSetting("sound", !settings.sound)} />
          <Toggle label="Ambient motion" description="Traffic, residents, rain, steam, and live billboards" checked={settings.motion} onChange={() => changeSetting("motion", !settings.motion)} />
          <div className="quality-setting"><h3>Detail level</h3><div className="segmented-control" aria-label="Detail level">{(["auto", "low", "balanced", "high"] as Quality[]).map((quality) => <button key={quality} aria-pressed={settings.quality === quality} onClick={() => changeSetting("quality", quality)}>{quality === "auto" ? "Auto" : quality === "low" ? "Performance" : quality === "high" ? "Fine" : "Balanced"}</button>)}</div><p>{settings.quality === "auto" ? `Auto tunes character size, view distance and effects to keep a steady 60 fps (level ${snapshot.render?.level ?? 0} · ${snapshot.render?.cell ?? 10} px characters).` : "Performance uses larger characters, a shorter view, and no post-processing."}</p></div>
          {touchUi ? <TouchSettings /> : null}{/* Mobile */}
          <label className="sensitivity-setting"><span>Look sensitivity <output>{settings.sensitivity.toFixed(1)}×</output></span><input type="range" min="0.4" max="2" step="0.1" value={settings.sensitivity} onChange={(event) => changeSetting("sensitivity", Number(event.target.value))} /></label>
          <div className="keyboard-guide"><h3>Your way around</h3><p><span>Walk / fly</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></p><p><span>Run / flight boost</span><kbd>Shift</kbd></p><p><span>Jump / rise</span><kbd>Space</kbd></p><p><span>Flight rise / descend</span><span><kbd>Q</kbd><kbd>C</kbd></span></p><p><span>Toggle free flight</span><kbd>F</kbd></p><p><span>Call transport / exit ride</span><span><kbd>T</kbd><kbd>E</kbd></span></p><p><span>Look</span><span>Mouse / <kbd>←</kbd><kbd>→</kbd></span></p><p><span>Pause / release mouse</span><kbd>Esc</kbd></p><p><span>City map &amp; waypoints</span><kbd>M</kbd></p><p><span>Quest log</span><kbd>J</kbd></p><small>If mouse capture is unavailable, drag to look or use the arrow keys.</small></div>
          <button className="reset-position" onClick={() => travel(SPAWN.x, SPAWN.z, SPAWN.yaw)}>Return to the starting street <span aria-hidden="true">↗</span></button>
          <p className="credits">Rendered with <a href="https://code.textmode.art/" target="_blank" rel="noreferrer">textmode.js</a> and its official synth &amp; filters addons.</p>
        </>}
        <button className="primary-button panel-resume" onClick={enter}>Back to the streets <span aria-hidden="true">↗</span></button>
      </section>
    </div> : null}
  </main>;
}
