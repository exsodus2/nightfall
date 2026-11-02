import { HARBOUR_LEVEL, HARBOUR_STRIPS } from "./harbour.ts";

/** The part of the textmode instance the harbour draws with. */
export interface HarbourCanvas {
  push(): void;
  pop(): void;
  translate(x?: number, y?: number, z?: number): void;
  rotateX(degrees?: number): number | void;
  rect(width?: number, height?: number): void;
}

/**
 * The harbour's ground: four flat strips around the city's street plane, HARBOUR_LEVEL below it,
 * reaching past the draw distance. Call it right after the street plane, with the ground program
 * and its uniforms still bound: that program shades the quay, the flood wall line and the water
 * (harbour.ts `harbourGroundGlsl`). Four quads a frame; the water's pixels are the ones that were
 * bare sky below the horizon before.
 */
export function drawHarbourWater(t: HarbourCanvas): void {
  for (const strip of HARBOUR_STRIPS) {
    // Textmode's y points down (the street plane sits at +0.08), so +HARBOUR_LEVEL is below it.
    t.push(); t.translate(strip.x, HARBOUR_LEVEL, strip.z); t.rotateX(90); t.rect(strip.width, strip.depth); t.pop();
  }
}
