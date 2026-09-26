"use client";

import { useEffect, useRef } from "react";
import type { QuestLogEntry, QuestSnapshot } from "@/city/quests";
import { formatCredits } from "./quest-tracker";

const SECTIONS: readonly { status: QuestLogEntry["status"]; title: string; mark: string }[] = [
  { status: "ready", title: "Ready to deliver", mark: "◆" },
  { status: "active", title: "In progress", mark: "▸" },
  { status: "complete", title: "Closed", mark: "✓" },
];

/** J toggles the quest log. Ignored while typing and whenever `enabled` is false (e.g. mid-conversation). */
export function useQuestLogHotkey(enabled: boolean, open: boolean, onOpen: () => void, onClose: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyJ" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (open) onClose(); else onOpen();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled, open, onOpen, onClose]);
}

interface QuestLogProps {
  quests: QuestSnapshot;
  onClose: () => void;
  onResume: () => void;
}

/** Contract ledger overlay: same side-panel frame as the atlas, terminal-styled entries. */
export function QuestLog({ quests, onClose, onResume }: QuestLogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>("button, [tabindex='0']");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      // Hand focus back only if nothing else took it: Back to the streets focuses the city canvas, and a
      // header button left focused there would swallow Enter (chat) / reopen this panel while playing.
      const active = document.activeElement;
      if (previous instanceof HTMLElement && previous.isConnected && (!active || active === document.body || dialog?.contains(active))) previous.focus();
    };
  }, [onClose]);

  const earned = quests.log.filter((entry) => entry.status === "complete").reduce((sum, entry) => sum + entry.reward, 0);
  return <div className="panel-backdrop" onClick={onClose}>
    <section className="side-panel quest-log" role="dialog" aria-modal="true" aria-labelledby="quest-log-title" tabIndex={-1} ref={dialogRef} onClick={(event) => event.stopPropagation()}>
      <div className="panel-heading"><div><span className="panel-kicker">Contract ledger</span><h2 id="quest-log-title">Work, after hours.</h2></div><button className="close-button" onClick={onClose} aria-label="Close quest log">×</button></div>
      <dl className="quest-log-ledger">
        <div><dt>Balance</dt><dd>{formatCredits(quests.credits)}<small>CR</small></dd></div>
        <div><dt>Earned</dt><dd>{formatCredits(earned)}<small>CR</small></dd></div>
        <div><dt>Open</dt><dd>{quests.log.filter((entry) => entry.status !== "complete").length}</dd></div>
      </dl>
      {quests.log.length === 0 ? <p className="quest-log-empty">No contracts yet. People around the city have work that needs doing. When a name appears near you, press <kbd>E</kbd> to talk.</p> : null}
      {SECTIONS.map(({ status, title, mark }) => {
        const entries = quests.log.filter((entry) => entry.status === status);
        if (!entries.length) return null;
        return <section key={status} className="quest-log-section" aria-label={title}>
          <h3 className="section-title">{title} <span>{entries.length}</span></h3>
          <ul>
            {entries.map((entry) => {
              const tracked = quests.tracked?.title === entry.title && status !== "complete";
              return <li key={entry.id} className="quest-log-entry" data-status={entry.status} data-tracked={tracked}>
                <span className="quest-log-mark" aria-hidden="true">{mark}</span>
                <div>
                  <strong>{entry.title}{tracked ? <span className="quest-log-tracked">Tracking</span> : null}</strong>
                  <p>{entry.objective}</p>
                  <small><span>{entry.targetDistrict}</span><span>{status === "complete" ? "Paid" : "Reward"} {formatCredits(entry.reward)} CR</span></small>
                </div>
              </li>;
            })}
          </ul>
        </section>;
      })}
      <button className="primary-button panel-resume" onClick={onResume}>Back to the streets <span aria-hidden="true">↗</span></button>
    </section>
  </div>;
}
