"use client";

// React side of the RPG layer (the canvas combat HUD lives in src/rpg/scene). CityExperience mounts:
//   useRpgUi(...)      state + wiring (source, hotkeys, pause/resume, feed -> toasts)
//   <RpgScreens />     inventory & character (I / Tab), vendor, death screen
//   <RpgPrompt />      pickup / interact prompt in the interaction-prompt slot
//   <InventoryButton/> header button
import { DeathScreen } from "./death-screen";
import { InventoryScreen } from "./inventory-screen";
import type { useRpgUi } from "./use-rpg-ui";
import { VendorScreen } from "./vendor-screen";
import styles from "./rpg.module.css";

export { useRpgUi } from "./use-rpg-ui";
export { RpgPrompt } from "./rpg-prompt";

type RpgUi = ReturnType<typeof useRpgUi>;

/** Whichever RPG screen is up: death > vendor > inventory. Renders nothing without RPG data. */
export function RpgScreens({ ui, place }: { ui: RpgUi; place: string }) {
  const { rpg } = ui;
  if (!rpg) return null;
  if (ui.dead) return <DeathScreen rpg={rpg} place={place} onRespawn={ui.respawn} />;
  if (rpg.vendor) return <VendorScreen rpg={rpg} vendor={rpg.vendor} act={ui.act} onClose={ui.closeVendor} />;
  if (ui.inventoryOpen) return <InventoryScreen rpg={rpg} act={ui.act} onClose={ui.closeInventory} onResume={ui.resumeFromInventory} />;
  return null;
}

/** "Inventory I" in the header (hidden until the RPG layer runs, and on narrow screens). */
export function InventoryButton({ ui, disabled }: { ui: RpgUi; disabled: boolean }) {
  if (!ui.rpg) return null;
  return <button className={`quiet-button ${styles.headerButton}`} disabled={disabled} onClick={ui.openInventory}>Inventory <kbd>I</kbd></button>;
}
