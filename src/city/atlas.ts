import { ASCII_BITMAPS } from "./glyph-font";

// The city's glyph atlas: printable ASCII in two weights, rasterised at the exact device cell
// size so every stroke lands on whole pixels (no resampling blur at any quality or DPI).
// Bold is the source 8x8 face (two-pixel verticals); thin keeps one pixel of every stroke.

export const FIRST_ASCII = 32;
export const ASCII_COUNT = 95;
/** Keys for the thin weight live in the Private Use Area; bold uses the characters themselves. */
export const thinKey = (character: string): string => String.fromCodePoint(0xe000 + character.charCodeAt(0) - FIRST_ASCII);

function rows(code: number, thin: boolean): number[] {
  const hex = ASCII_BITMAPS[code - FIRST_ASCII] ?? "0000000000000000";
  return Array.from({ length: 8 }, (_, y) => {
    const row = parseInt(hex.slice(y * 2, y * 2 + 2), 16);
    // Thin: drop the right-hand pixel of every horizontal pair, keeping single pixels.
    return thin ? row & ~(row >> 1) : row;
  });
}

/** Share of lit pixels, used to order density ramps by how dark a glyph really reads. */
export function glyphCoverage(character: string, thin = false): number {
  let lit = 0;
  for (const row of rows(character.charCodeAt(0), thin)) for (let x = 0; x < 8; x++) lit += (row >> x) & 1;
  return lit / 64;
}

/** Characters ordered from empty to dense, for tone that is still plainly ASCII. */
export function densityRamp(candidates = " .`',:;-~=+*!ixoc#%&@", thin = false): string[] {
  return [...candidates].sort((a, b) => glyphCoverage(a, thin) - glyphCoverage(b, thin));
}

export interface CityAtlas { canvas: HTMLCanvasElement; map: string[]; tile: number }

export function buildCityAtlas(tile: number): CityAtlas {
  const n = Math.max(8, Math.round(tile));
  const scale = Math.max(1, Math.floor(n / 8)), size = 8 * scale, inset = Math.floor((n - size) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n * 16;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas is required to build the glyph atlas.");
  const image = context.createImageData(canvas.width, canvas.height);
  const keys: string[] = [];
  for (let weight = 0; weight < 2; weight++) for (let i = 0; i < ASCII_COUNT; i++) {
    const code = FIRST_ASCII + i, index = keys.length, character = String.fromCharCode(code);
    keys.push(weight === 0 ? character : thinKey(character));
    const bitmap = rows(code, weight === 1);
    const ox = (index % 16) * n + inset, oy = Math.floor(index / 16) * n + inset;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!((bitmap[Math.floor(y / scale)] >> (7 - Math.floor(x / scale))) & 1)) continue;
      const o = ((oy + y) * canvas.width + ox + x) * 4;
      image.data[o] = image.data[o + 1] = image.data[o + 2] = image.data[o + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  for (let i = keys.length; i < 256; i++) keys.push(String.fromCodePoint(0xe100 + i));
  const map = Array.from({ length: 16 }, (_, row) => keys.slice(row * 16, row * 16 + 16).join(""));
  return { canvas, map, tile: n };
}
