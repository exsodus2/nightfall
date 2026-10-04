"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { CityController } from "@/city/engine";
import type { RpgSnapshot, RpgUiAction } from "@/rpg/types";
import { findItemMention, freshFeed, rarityColor, type FeedEntry } from "./format";
import type { RpgMock } from "./mock";

const TONE_ACCENT: Record<FeedEntry["tone"], string> = { info: "#95e0c0", quest: "#e6ad62", loot: "#4cf266", danger: "#ff6b5e" };

/** Accent colour and item highlight for a feed entry (loot: the mentioned item's rarity colour). */
export function feedStyle(entry: FeedEntry, items: RpgSnapshot["items"] | undefined): { accent: string; highlight?: { text: string; color: string } } {
  const mention = entry.tone === "danger" || !items ? null : findItemMention(entry.text, items);
  if (!mention) return { accent: TONE_ACCENT[entry.tone] };
  const color = rarityColor(mention.rarity);
  return { accent: entry.tone === "loot" ? color : TONE_ACCENT[entry.tone], highlight: { text: mention.name, color } };
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

const noSubscribe = () => () => undefined;
const noSnapshot = () => null;

interface RpgUiOptions {
  /** snapshot.rpg from the engine (undefined / null until the RPG layer runs). */
  real: RpgSnapshot | null | undefined;
  controller: RefObject<CityController | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  ready: boolean;
  phase: string;
  /** A conversation is open: I / Tab do nothing. */
  dialogue: boolean;
  /** Another panel (settings, transit, quest log, lobby) is open: opening one closes the inventory. */
  others: boolean;
  /** Stop the city and release the mouse (controller.pause + phase "paused"). */
  pauseCity: () => void;
  /** Back to playing (phase "playing" + controller.enter()). */
  resumeCity: () => void;
  /** Close the other panels as the inventory opens. */
  closeOthers: () => void;
  /** A new loot / quest / danger feed line for the toast stack. */
  onFeed: (entry: FeedEntry, style: ReturnType<typeof feedStyle>) => void;
}

/**
 * RPG screens' state and wiring for CityExperience:
 *  - the snapshot source (the engine's, or in development the ?rpgmock=<scene> stand-in from mock.ts),
 *  - the inventory screen (I anywhere in play, Tab while playing), which pauses like the quest log
 *    and resumes on close when it was opened from play,
 *  - the vendor screen and the death screen, which follow snapshot.rpg (pause while shown, resume after),
 *  - feed entries turned into toasts, once per id.
 */
export function useRpgUi(options: RpgUiOptions) {
  const { real, controller, dialogue, others } = options;
  const opts = useRef(options);
  useEffect(() => { opts.current = options; });

  // ---- Source: the engine, or the development mock --------------------------------------------
  // Real data wins: the mock only fills in while snapshot.rpg is missing, unless the URL says
  // ?rpgmock=force (then it replaces the engine's data, for screenshots of vendor / death states).
  const [mock, setMock] = useState<{ mock: RpgMock; force: boolean } | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const scene = new URLSearchParams(location.search).get("rpgmock");
    if (!scene) return;
    let live = true;
    void import("./mock").then((module) => { if (live) setMock({ mock: module.createRpgMock(scene), force: scene === "force" }); });
    return () => { live = false; };
  }, []);
  const mocked = useSyncExternalStore(mock?.mock.subscribe ?? noSubscribe, mock?.mock.getSnapshot ?? noSnapshot, noSnapshot);
  const useMock = !!mocked && (mock?.force || !real);
  const rpg: RpgSnapshot | null = useMock ? mocked : real ?? null;
  const act = useCallback((action: RpgUiAction) => {
    if (useMock && mock) mock.mock.act(action); else controller.current?.rpgAction(action);
  }, [useMock, mock, controller]);

  const vendorOpen = !!rpg?.vendor;
  const dead = !!rpg?.combat.dead;

  // ---- Inventory open / close ------------------------------------------------------------------
  const [open, setOpen] = useState(false);
  const resumeOnClose = useRef(false);
  const [wasOthers, setWasOthers] = useState(others);
  // Another panel took over (J, T, Settings, Online): close without resuming. The vendor and death
  // screens replace it too. Derived during render (no effect round trip).
  if (others !== wasOthers) { setWasOthers(others); if (others && open) setOpen(false); }
  if (open && (vendorOpen || dead || dialogue || !rpg)) setOpen(false);

  const relock = useRef<AbortController | null>(null);
  useEffect(() => () => relock.current?.abort(), []);
  /** Resume, and if the browser refused the pointer lock (Esc is not a user activation), take it on the next click. */
  const resume = useCallback(() => {
    opts.current.resumeCity();
    relock.current?.abort();
    const target = opts.current.canvas.current;
    if (!target || !matchMedia("(pointer: fine)").matches) return;
    const abort = new AbortController();
    relock.current = abort;
    target.addEventListener("click", () => { abort.abort(); if (!document.pointerLockElement) opts.current.controller.current?.enter(); }, { signal: abort.signal });
    setTimeout(() => abort.abort(), 8000);
  }, []);

  const openInventory = useCallback(() => {
    const o = opts.current;
    if (!o.ready || o.dialogue) return;
    resumeOnClose.current = o.phase === "playing";
    o.pauseCity();
    o.closeOthers();
    setOpen(true);
  }, []);
  /** Close (×, Esc, I): back to play if it was opened from play, else to the pause screen. */
  const closeInventory = useCallback(() => {
    setOpen(false);
    if (resumeOnClose.current) { resumeOnClose.current = false; resume(); }
  }, [resume]);
  /** "Back to the streets": always resumes. */
  const resumeFromInventory = useCallback(() => { setOpen(false); resumeOnClose.current = false; resume(); }, [resume]);

  // ---- Hotkeys: I toggles (playing or paused), Tab opens while playing ---------------------------
  const state = useRef({ open, rpg: !!rpg, vendorOpen, dead });
  useEffect(() => { state.current = { open, rpg: !!rpg, vendorOpen, dead }; }, [open, rpg, vendorOpen, dead]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyI" && event.code !== "Tab") return;
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      const s = state.current, o = opts.current;
      if (!s.rpg || !o.ready || o.dialogue || s.vendorOpen || s.dead) return;
      if (event.code === "Tab") {
        // Inside the open screen Tab moves focus (the screen traps it); from the game it opens.
        if (s.open || event.shiftKey || o.phase !== "playing") return;
        if (event.target !== document.body && event.target !== o.canvas.current) return;
      } else if (!s.open && o.phase !== "playing" && o.phase !== "paused") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (s.open) closeInventory(); else openInventory();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [openInventory, closeInventory]);

  // ---- Vendor & death: pause while shown, resume afterwards ---------------------------------------
  const vendorWasOpen = useRef(false);
  useEffect(() => {
    if (vendorOpen) { vendorWasOpen.current = true; opts.current.pauseCity(); return; }
    if (vendorWasOpen.current) { vendorWasOpen.current = false; resume(); }
  }, [vendorOpen, resume]);
  const closeVendor = useCallback(() => act({ kind: "closeVendor" }), [act]);

  const respawning = useRef(false);
  useEffect(() => {
    if (!dead) { respawning.current = false; return; }
    if (!respawning.current) opts.current.pauseCity();
  }, [dead]);
  const respawn = useCallback(() => { respawning.current = true; act({ kind: "respawn" }); resume(); }, [act, resume]);

  // ---- Feed -> toasts -------------------------------------------------------------------------------
  const seen = useRef<Set<number>>(new Set());
  const feed = rpg?.feed;
  const items = rpg?.items;
  useEffect(() => {
    const { fresh, seen: next } = freshFeed(feed, seen.current);
    seen.current = next;
    for (const entry of fresh) opts.current.onFeed(entry, feedStyle(entry, items));
  }, [feed, items]);

  const inventoryOpen = open && !!rpg;
  return {
    rpg, act,
    inventoryOpen, openInventory, closeInventory, resumeFromInventory,
    vendorOpen, closeVendor,
    dead, respawn,
    /** Any RPG screen is up (the world map and radio keys should stand down). */
    blocking: inventoryOpen || vendorOpen || dead,
  };
}
