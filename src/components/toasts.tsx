"use client";

import { useEffect } from "react";

export interface Toast { id: number; message: string }

/** Visible lifetime. Keep in sync with the `.quest-toast` fade-out delay in globals.css (5.2s - .45s). */
export const TOAST_LIFETIME = 5200;
const MAX_TOASTS = 4;
let nextToastId = 0;

/** Create the toast outside the state updater (ids stay stable under Strict Mode double-invocation). */
export function createToast(message: string): Toast {
  nextToastId += 1;
  return { id: nextToastId, message };
}

/** Pure queue helper: `setToasts((current) => enqueueToast(current, toast))`. */
export function enqueueToast(current: readonly Toast[], toast: Toast): Toast[] {
  return [...current, toast].slice(-MAX_TOASTS);
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_LIFETIME);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);
  return <li className="quest-toast">
    <span className="quest-toast-mark" aria-hidden="true">▪</span>
    <span className="quest-toast-message">{toast.message}</span>
    <button type="button" className="quest-toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">×</button>
  </li>;
}

/** Stacked, auto-dismissing quest notifications. Motion is CSS-only, so reduced-motion disables it globally. */
export function ToastStack({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
  return <ol className="quest-toasts" role="status" aria-live="polite" aria-relevant="additions">
    {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}
  </ol>;
}
