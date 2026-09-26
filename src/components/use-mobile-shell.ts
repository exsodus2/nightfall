"use client";

import { useEffect } from "react";

/**
 * Mobile / Safari shell, installed once by CityExperience:
 *  - `--vvh` / `--vv-top` on <html>: the visual viewport (shrinks when the iOS keyboard opens), so
 *    the chat input can sit above the keyboard; `--app-height` for the dynamic toolbar.
 *  - No pinch-zoom, double-tap zoom or page pan over the game (touch-action handles most of it; Safari
 *    also needs its proprietary gesture events and multi-finger touchmove cancelled).
 *  - First touch: lets Web Audio (rain bed, radio meter chain) play with the ring/silent switch on
 *    (Safari 16.4+ `navigator.audioSession`). Audio itself still only starts from the player's choices.
 */
export function useMobileShell(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const measure = () => {
      root.style.setProperty("--app-height", `${window.innerHeight}px`);
      root.style.setProperty("--vvh", `${Math.round(viewport?.height ?? window.innerHeight)}px`);
      root.style.setProperty("--vv-top", `${Math.round(viewport?.offsetTop ?? 0)}px`);
      // iOS pans the layout viewport to reveal a focused input even with overflow hidden; pull it back.
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    measure();
    const abort = new AbortController();
    const signal = abort.signal;
    viewport?.addEventListener("resize", measure, { signal });
    viewport?.addEventListener("scroll", measure, { signal });
    window.addEventListener("resize", measure, { signal });
    window.addEventListener("orientationchange", () => setTimeout(measure, 300), { signal });

    const prevent = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", prevent, { signal, passive: false });
    document.addEventListener("gesturechange", prevent, { signal, passive: false });
    document.addEventListener("dblclick", prevent, { signal, passive: false });
    document.addEventListener("touchmove", (event) => {
      // Two fingers anywhere = pinch-zoom attempt (the map handles its own pinch through pointer events).
      if (event.touches.length > 1) event.preventDefault();
    }, { signal, passive: false });

    type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
    const unlock = () => {
      const session = (navigator as AudioSessionNavigator).audioSession;
      try { if (session && session.type !== "playback") session.type = "playback"; } catch { /* unsupported */ }
    };
    window.addEventListener("touchend", unlock, { signal, once: true, passive: true });
    return () => abort.abort();
  }, []);
}
