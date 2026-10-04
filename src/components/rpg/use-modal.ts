"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Modal focus handling shared by the RPG screens (same contract as the quest log): focus the dialog
 * on mount, keep Tab inside it, Escape calls `onEscape` (null: Escape is ignored, e.g. the death
 * screen), and hand focus back on unmount only if nothing else took it.
 */
export function useModal(ref: RefObject<HTMLElement | null>, onEscape: (() => void) | null): void {
  const escape = useRef(onEscape);
  useEffect(() => { escape.current = onEscape; });
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // An input keeps Escape for itself first (blur), like the world map.
        if (event.target instanceof HTMLInputElement) { event.target.blur(); dialog?.focus({ preventScroll: true }); event.preventDefault(); return; }
        if (escape.current) { event.preventDefault(); escape.current(); }
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input, [tabindex='0']")].filter((el) => el.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      const active = document.activeElement;
      if (previous instanceof HTMLElement && previous.isConnected && (!active || active === document.body || dialog?.contains(active))) previous.focus({ preventScroll: true });
    };
  }, [ref]);
}
