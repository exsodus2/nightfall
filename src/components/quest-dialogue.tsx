"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { NpcDialogue, NpcDialogueOption } from "@/city/quests";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const CHARACTERS_PER_SECOND = 62;

function subscribeReducedMotion(callback: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** OS reduced-motion preference, read without a render-time effect. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
}

/** Stable key that resets the typewriter whenever the conversation advances. */
export function dialogueKey(dialogue: NpcDialogue): string {
  return `${dialogue.npcId}:${dialogue.lines.join("␞")}:${dialogue.options.map((option) => option.id).join(",")}`;
}

const KIND_MARK: Record<NpcDialogueOption["kind"], string> = { accept: "▸", complete: "◆", continue: "…", decline: "×", leave: "↩" };
const KIND_LABEL: Record<NpcDialogueOption["kind"], string> = { accept: "Accept", complete: "Deliver", continue: "Continue", decline: "Decline", leave: "Leave" };
const SIGIL_SHADES = [" ", "░", "▒", "▓"] as const;

/** A deterministic, mirrored glyph "voiceprint" so each contact reads as a distinct signal. */
function sigil(id: string): string[] {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) { hash ^= id.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  const rows: string[] = [];
  for (let row = 0; row < 4; row++) {
    let half = "";
    for (let col = 0; col < 3; col++) {
      hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
      half += SIGIL_SHADES[hash % SIGIL_SHADES.length];
    }
    rows.push(half + [...half].reverse().join(""));
  }
  return rows;
}

interface QuestDialogueProps {
  dialogue: NpcDialogue;
  onChoose: (optionId: string) => void;
  onClose: () => void;
}

/**
 * Conversation strip for quest-giver NPCs. Lines type out (instantly under
 * reduced motion) and can be skipped by clicking the transcript, Enter or Space.
 * 1-9 choose directly, arrows move the selection, Escape leaves. Remount with
 * `key={dialogueKey(dialogue)}` so each exchange starts its own reveal.
 */
export function QuestDialogue({ dialogue, onChoose, onClose }: QuestDialogueProps) {
  const reducedMotion = usePrefersReducedMotion();
  const total = dialogue.lines.reduce((sum, line) => sum + line.length, 0);
  const [revealed, setRevealed] = useState(0);
  const [selected, setSelected] = useState(0);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLElement>(null);
  const done = reducedMotion || revealed >= total;
  const { options } = dialogue;

  const skip = useCallback(() => setRevealed(total), [total]);
  const leave = useCallback(() => {
    const exit = options.find((option) => option.kind === "leave");
    if (exit) onChoose(exit.id); else onClose();
  }, [options, onChoose, onClose]);
  const focusOption = useCallback((index: number) => {
    const next = (index + options.length) % Math.max(1, options.length);
    setSelected(next);
    optionRefs.current[next]?.focus();
  }, [options.length]);

  // Typewriter: advance by elapsed time so the reveal speed is frame-rate independent.
  useEffect(() => {
    if (done) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const count = Math.min(total, Math.floor(((now - start) / 1000) * CHARACTERS_PER_SECOND));
      setRevealed(count);
      if (count < total) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [done, total]);

  // Keep keyboard focus inside the conversation; land on the first choice once text settles.
  useEffect(() => {
    if (done) optionRefs.current[0]?.focus();
    else panelRef.current?.focus();
  }, [done]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
      if (event.code === "Escape") { event.preventDefault(); event.stopPropagation(); leave(); return; }
      if (digit) {
        const option = options[Number(digit[1]) - 1];
        if (option && !event.repeat) { event.preventDefault(); onChoose(option.id); }
        return;
      }
      if (event.code === "ArrowDown" || event.code === "ArrowRight") { event.preventDefault(); focusOption(selected + 1); return; }
      if (event.code === "ArrowUp" || event.code === "ArrowLeft") { event.preventDefault(); focusOption(selected - 1); return; }
      // Enter is handled here (not by native button activation) so it behaves the same wherever focus is.
      // `selected` follows focus, so it is the focused option whenever one has focus.
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        event.preventDefault();
        if (!done) skip();
        else if (!event.repeat) { const option = options[selected]; if (option) onChoose(option.id); }
        return;
      }
      if (event.code === "Space") {
        const onOption = optionRefs.current.some((button) => button === document.activeElement);
        if (!done) { event.preventDefault(); skip(); }
        else if (!onOption && !event.repeat) { event.preventDefault(); const option = options[selected]; if (option) onChoose(option.id); }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [done, focusOption, leave, onChoose, options, selected, skip]);

  function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const buttons = optionRefs.current.filter((button): button is HTMLButtonElement => !!button);
    if (!buttons.length) { event.preventDefault(); return; }
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    focusOption(index < 0 ? 0 : index + (event.shiftKey ? -1 : 1));
  }

  const starts = dialogue.lines.map((_, index) => dialogue.lines.slice(0, index).reduce((sum, line) => sum + line.length, 0));
  const glyphs = sigil(dialogue.npcId);
  return <section ref={panelRef} className="quest-dialogue" role="dialog" aria-modal="true" aria-labelledby="quest-dialogue-name" aria-describedby="quest-dialogue-lines" tabIndex={-1} onKeyDown={trapTab} data-revealing={!done}>
    <div className="qd-rule" aria-hidden="true"><span>Channel open</span><span className="qd-rule-line" /><span>{dialogue.district}</span></div>
    <div className="qd-body">
      <header className="qd-ident">
        <pre className="qd-sigil" aria-hidden="true">{glyphs.join("\n")}</pre>
        <div>
          <span className="qd-kicker">Contact</span>
          <h2 id="quest-dialogue-name">{dialogue.npcName}</h2>
          <p className="qd-title">{dialogue.npcTitle}</p>
          <p className="qd-district"><span aria-hidden="true" />{dialogue.district}</p>
        </div>
      </header>
      <div className="qd-transcript">
        <div className="qd-lines" aria-hidden="true" onClick={done ? undefined : skip}>
          {dialogue.lines.map((line, index) => {
            const shown = done ? line.length : Math.max(0, Math.min(line.length, revealed - starts[index]));
            const typing = !done && shown > 0 && shown < line.length;
            return <p key={index} data-pending={!done && shown === 0}>
              <span>{line.slice(0, shown)}</span>{typing ? <span className="qd-caret">▌</span> : null}<span className="qd-unrevealed">{line.slice(shown)}</span>
            </p>;
          })}
        </div>
        <div id="quest-dialogue-lines" className="sr-only">{dialogue.lines.join(" ")}</div>
        <ol className="qd-options" aria-label="Responses">
          {options.map((option, index) => <li key={option.id}>
            <button ref={(element) => { optionRefs.current[index] = element; }} type="button" className="qd-option" data-kind={option.kind} data-selected={selected === index}
              onFocus={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onClick={() => onChoose(option.id)}>
              <span className="qd-index">{index + 1}</span>
              <span className="qd-mark" aria-hidden="true">{KIND_MARK[option.kind]}</span>
              <span className="qd-label">{option.label}</span>
              <span className="qd-kind">{KIND_LABEL[option.kind]}</span>
            </button>
          </li>)}
        </ol>
      </div>
    </div>
    <div className="qd-footer" aria-hidden="true">
      <span className="qd-keys">
        <span>{options.length > 1 ? <><kbd>1</kbd>–<kbd>{Math.min(9, options.length)}</kbd></> : <kbd>1</kbd>} respond</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> select</span>
        {done ? null : <span><kbd>Space</kbd> skip</span>}
        <span><kbd>Esc</kbd> leave</span>
      </span>
      <span className="qd-touch">{done ? "Tap a response" : "Tap the transcript to skip"}</span>
    </div>
  </section>;
}
