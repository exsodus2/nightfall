import type { RpgInput, WeaponSlot } from "./types.ts";

/** Key codes of the on-foot combat bindings (movement keys stay with the engine). */
export const RPG_KEYS = {
  dodge: "KeyC",
  reload: "KeyX",
  quick1: "KeyQ",
  quick2: "KeyZ",
  interact: "KeyE",
  slots: { Digit1: "melee", Digit2: "sidearm", Digit3: "primary", Digit4: "unarmed" } as Readonly<Record<string, WeaponSlot>>,
} as const;

/** Collects combat input between frames. Presses are latched until the next `frame()` so a tap
 * shorter than one frame is never lost; held state follows the latest events. */
export class RpgInputCollector {
  private attackHeld = false;
  private altHeld = false;
  private attackPressed = false;
  private attackReleased = false;
  private dodge = false;
  private reload = false;
  private interact = false;
  private quick: 1 | 2 | null = null;
  private slot: WeaponSlot | null = null;

  /** Mouse button 0 = attack, 2 = block / aim. */
  pointer(button: number, down: boolean): void {
    if (button === 0) {
      if (down && !this.attackHeld) this.attackPressed = true;
      if (!down && this.attackHeld) this.attackReleased = true;
      this.attackHeld = down;
    } else if (button === 2) this.altHeld = down;
  }
  /** Returns true when the key is a combat binding (the caller may then skip its own handling). */
  key(code: string, down: boolean, repeat = false): boolean {
    if (!down || repeat) return code in RPG_KEYS.slots || code === RPG_KEYS.dodge || code === RPG_KEYS.reload || code === RPG_KEYS.quick1 || code === RPG_KEYS.quick2;
    if (code === RPG_KEYS.dodge) this.dodge = true;
    else if (code === RPG_KEYS.reload) this.reload = true;
    else if (code === RPG_KEYS.quick1) this.quick = 1;
    else if (code === RPG_KEYS.quick2) this.quick = 2;
    else if (code in RPG_KEYS.slots) this.slot = RPG_KEYS.slots[code];
    else return false;
    return true;
  }
  /** E is shared with talking, cars and lifts: the engine calls this only when nothing else took it. */
  pressInteract(): void { this.interact = true; }
  /** Drops held buttons (pause, focus loss, dialogue) so nothing stays pressed. */
  release(): void {
    if (this.attackHeld) this.attackReleased = true;
    this.attackHeld = false; this.altHeld = false;
  }
  /** This frame's input; clears the latched presses. */
  frame(forward: number, strafe: number): RpgInput {
    const input: RpgInput = {
      attackHeld: this.attackHeld, attackPressed: this.attackPressed, attackReleased: this.attackReleased,
      altHeld: this.altHeld, dodgePressed: this.dodge, reloadPressed: this.reload,
      selectSlot: this.slot, quickUse: this.quick, interactPressed: this.interact, forward, strafe,
    };
    this.attackPressed = this.attackReleased = this.dodge = this.reload = this.interact = false;
    this.quick = null; this.slot = null;
    return input;
  }
}
