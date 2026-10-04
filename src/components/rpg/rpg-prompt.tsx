"use client";

import { parsePrompt, rarityColor } from "./format";
import styles from "./rpg.module.css";

/** snapshot.rpg.prompt ("E  Pick up Backslash [rare]") in the interaction-prompt slot and style.
 * The rarity tag is coloured; clicking / tapping does what E does. On touch screens (where the
 * .interaction-prompt is hidden in favour of the Interact button) it moves above the thumb buttons. */
export function RpgPrompt({ prompt, onInteract }: { prompt: string; onInteract: () => void }) {
  const { key, text, rarity } = parsePrompt(prompt);
  return <button type="button" className={`interaction-prompt ${styles.prompt}`} data-rpg-prompt onClick={onInteract}>
    <kbd>{key}</kbd>
    <span>{text}</span>
    {rarity ? <span className={styles.promptRarity} style={{ color: rarityColor(rarity) }}>[{rarity}]</span> : null}
  </button>;
}
