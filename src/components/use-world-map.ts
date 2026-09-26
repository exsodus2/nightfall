"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { CityController } from "@/city/engine";

interface WorldMapOptions {
  ready: boolean;
  /** CityExperience phase: "playing" means the engine is running. */
  phase: string;
  /** A conversation, panel or quest log is open: the map closes and M does nothing. */
  blocked: boolean;
  controller: RefObject<CityController | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

/**
 * World map open/close without pausing the city (WoW-style). M and Esc are intercepted in the
 * capture phase, before the engine's own handler (which would pause). Opening while playing
 * releases the mouse but keeps the engine running, so WASD still walks and trains still run; the
 * resulting pointer-lock change is swallowed so the engine does not treat it as a pause. Closing
 * recaptures the mouse with controller.enter(), like the quest dialogue does.
 */
export function useWorldMap({ ready, phase, blocked, controller, canvas }: WorldMapOptions) {
  const [open, setOpen] = useState(false);
  const [wasBlocked, setWasBlocked] = useState(blocked);
  const openRef = useRef(false);
  const state = useRef({ ready, phase, blocked });
  const unlockGuard = useRef(false);
  const relock = useRef<AbortController | null>(null);

  // A conversation, panel or quest log takes over: close without recapturing the mouse.
  if (blocked !== wasBlocked) {
    setWasBlocked(blocked);
    if (blocked && open) setOpen(false);
  }
  useEffect(() => { state.current = { ready, phase, blocked }; openRef.current = open; }, [ready, phase, blocked, open]);

  const openMap = useCallback(() => {
    const { ready: isReady, blocked: isBlocked, phase: current } = state.current;
    if (!isReady || isBlocked || openRef.current) return;
    if (current === "playing" && document.pointerLockElement) {
      unlockGuard.current = true;
      setTimeout(() => { unlockGuard.current = false; }, 1500);
      document.exitPointerLock();
    }
    openRef.current = true;
    setOpen(true);
  }, []);

  const closeMap = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    if (state.current.phase !== "playing") return;
    controller.current?.enter();
    // Browsers may refuse to re-lock without a gesture (e.g. after Esc): the next click on the city does it.
    relock.current?.abort();
    const target = canvas.current;
    if (!target) return;
    const abort = new AbortController();
    relock.current = abort;
    target.addEventListener("click", () => {
      abort.abort();
      if (!document.pointerLockElement && !openRef.current && state.current.phase === "playing") controller.current?.enter();
    }, { signal: abort.signal });
  }, [controller, canvas]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) {
        if (openRef.current && event.key === "Escape" && event.target instanceof HTMLElement) { event.target.blur(); event.preventDefault(); event.stopImmediatePropagation(); }
        return;
      }
      if (event.code === "KeyM") {
        const { ready: isReady, blocked: isBlocked, phase: current } = state.current;
        if (openRef.current) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) closeMap(); }
        else if (isReady && !isBlocked && current !== "loading" && current !== "error") { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) openMap(); }
      } else if (event.code === "Escape" && openRef.current) {
        event.preventDefault(); event.stopImmediatePropagation(); closeMap();
      }
    };
    const onLockChange = (event: Event) => {
      if (unlockGuard.current && !document.pointerLockElement) { unlockGuard.current = false; event.stopImmediatePropagation(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    document.addEventListener("pointerlockchange", onLockChange, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      document.removeEventListener("pointerlockchange", onLockChange, { capture: true });
      relock.current?.abort();
    };
  }, [openMap, closeMap]);

  return { open, live: open && phase === "playing", openMap, closeMap };
}
