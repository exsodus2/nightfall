import type { PropCanvas } from "./prop-canvas.ts";
import type { RGB } from "./world.ts";
import { INTERIOR_HEIGHT, interiorLocal, type InteriorFixture, type InteriorPlace } from "./interiors.ts";
import { drawHuman } from "./human-model.ts";
import { miniFontBytes } from "./mini-font.ts";
import type { InteractableDefinition } from "../rpg/types.ts";

const WALL: RGB = [72, 84, 98];
const METAL: RGB = [108, 129, 141];
const WOOD: RGB = [151, 110, 78];
const WARM: RGB = [255, 206, 138];
const DARK: RGB = [26, 36, 48];
const LETTERS = miniFontBytes();

function style(canvas: PropCanvas, color: RGB, glyph: string, emissive = false): void {
  canvas.char(glyph);
  canvas.charColor(...color);
  canvas.cellColor(0, 0, 0, emissive ? 0 : 255);
}

function block(canvas: PropCanvas, x: number, height: number, z: number, width: number, tall: number, depth: number): void {
  canvas.translate(x, -height, z);
  canvas.box(width, tall, depth);
  canvas.translate(-x, height, -z);
}

function lettering(canvas: PropCanvas, text: string, x: number, height: number, z: number, size = 0.38, yaw = 0, exterior = false): void {
  canvas.push(); canvas.translate(x, -height, z); canvas.rotateY(yaw);
  for (const [index, character] of [...text].entries()) {
    if (character === " ") continue;
    canvas.char("#");
    const offset = (index - (text.length - 1) / 2) * size;
    if (exterior) {
      const code = character.charCodeAt(0) - 32;
      const bitmap = LETTERS[code * 2] | (LETTERS[code * 2 + 1] << 8);
      for (let row = 0; row < 5; row++) for (let column = 0; column < 3; column++) {
        if (bitmap & (1 << (14 - row * 3 - column))) block(canvas, offset + (column - 1) * size / 4, (2 - row) * size / 4, 0, size / 4, size / 4, 0.025);
      }
    } else {
      canvas.cellColor(character.charCodeAt(0), 255, 0, 0);
      canvas.translate(offset, 0, 0); canvas.rect(size * 0.8, size * 1.35); canvas.translate(-offset, 0, 0);
    }
  }
  canvas.pop();
}

function plant(canvas: PropCanvas, x: number, z: number, base: number, time: number): void {
  style(canvas, [145, 105, 71], "#"); block(canvas, x, base + 0.25, z, 0.7, 0.5, 0.7);
  style(canvas, [104, 165, 100], "|"); block(canvas, x, base + 0.95, z, 0.12, 1.1, 0.12);
  style(canvas, [120, 210, 147], "*");
  for (let leaf = 0; leaf < 4; leaf++) {
    const angle = leaf * Math.PI * 0.5 + Math.sin(time * 0.4 + x) * 0.05;
    block(canvas, x + Math.cos(angle) * 0.36, base + 0.8 + leaf * 0.16, z + Math.sin(angle) * 0.36, 0.64, 0.18, 0.55);
  }
}

function resident(canvas: PropCanvas, x: number, z: number, tint: RGB, time: number, seated = false): void {
  canvas.push(); canvas.translate(x, 0, z); canvas.rotateY(180);
  drawHuman(canvas, { coat: tint, trim: [50, 63, 74], skin: [196, 157, 124], light: WARM, headwear: seated ? "bare" : "cap", prop: null, idle: "breathe" }, { time, seed: Math.floor(Math.abs(x * 7)), stride: 0, moving: false, detail: true, seated, talking: !seated }, paintResident);
  canvas.pop();
}

function paintResident(canvas: PropCanvas, color: RGB, glyph: string, gain = 1): void {
  style(canvas, [color[0] * gain, color[1] * gain, color[2] * gain], glyph);
}

function fixture(canvas: PropCanvas, item: InteriorFixture, place: InteriorPlace, time: number): void {
  const { x, z, width, depth, height, kind } = item;
  style(canvas, kind === "planter" ? WOOD : kind === "machine" ? METAL : kind === "seat" ? place.color : WOOD, kind === "machine" ? "H" : "=");
  block(canvas, x, height / 2, z, width, height, depth);
  style(canvas, METAL, "-"); block(canvas, x, height + 0.04, z, width + 0.1, 0.1, depth + 0.1);
  if (kind === "shelf") {
    for (let row = 0; row < 3; row++) {
      style(canvas, DARK, ":"); block(canvas, x, 0.6 + row * 1.0, z + depth / 2 + 0.02, width - 0.18, 0.8, 0.05);
      style(canvas, place.color, place.kind === "relay" ? "=" : "#", place.kind === "relay");
      for (let column = 0; column < 3; column++) block(canvas, x - 0.43 + column * 0.43, 0.5 + row, z + depth / 2 + 0.08, 0.21, place.kind === "relay" ? 0.1 : 0.45, 0.12);
    }
  } else if (kind === "planter") {
    plant(canvas, x - 0.5, z, height, time); plant(canvas, x + 0.5, z + 0.3, height, time + 2);
  } else if (kind === "machine") {
    style(canvas, DARK, ":"); block(canvas, x, height + 0.8, z - 0.4, width * 0.7, 1.55, depth * 0.5);
    style(canvas, place.color, place.kind === "workshop" ? "O" : "=", true);
    block(canvas, x, height + 0.7 + (place.kind === "workshop" ? Math.sin(time) * 0.3 : 0), z + 0.2, width * 0.5, 0.3, 0.1);
    if (place.kind === "salvage") {
      style(canvas, WARM, "O"); block(canvas, x + 0.6, height + 0.35, z + 0.6, 0.45, 0.65, 0.45);
    }
  } else if (kind === "table" || kind === "counter") {
    for (const side of [-1, 1]) {
      style(canvas, WARM, "U"); block(canvas, x + side * width * 0.28, height + 0.17, z, 0.24, 0.28, 0.24);
    }
    style(canvas, place.color, "=", true); block(canvas, x, 0.2, z + depth / 2 + 0.04, width * 0.82, 0.08, 0.08);
  } else if (kind === "seat") {
    style(canvas, place.color, "#"); block(canvas, x, height + 0.55, z - depth / 2 + 0.16, width, 1.1, 0.3);
  }
}

export function drawInterior(canvas: PropCanvas, place: InteriorPlace, fixtures: readonly InteriorFixture[], time: number, low: boolean, effects = true): void {
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  canvas.push(); canvas.translate(place.x, 0, place.z); canvas.rotateY(place.yaw * 180 / Math.PI);
  style(canvas, [95, 101, 109], "."); block(canvas, 0, -0.15, 0, place.width, 0.3, place.depth);
  style(canvas, WALL, ":");
  for (const side of [-1, 1]) {
    block(canvas, side * halfWidth, INTERIOR_HEIGHT / 2, 0, 0.35, INTERIOR_HEIGHT, place.depth);
    block(canvas, 0, INTERIOR_HEIGHT / 2, side * halfDepth, place.width, INTERIOR_HEIGHT, 0.35);
  }
  style(canvas, [41, 52, 66], "-"); block(canvas, 0, INTERIOR_HEIGHT + 0.1, 0, place.width, 0.2, place.depth);
  style(canvas, METAL, "|");
  for (const side of [-1, 1]) for (let panel = -1; panel <= 1; panel++) block(canvas, side * (halfWidth - 0.22), 2.6, panel * place.depth * 0.3, 0.14, 5.2, 0.16);
  style(canvas, place.color, "=", true);
  for (const side of [-1, 1]) {
    block(canvas, side * (halfWidth - 0.3), 0.25, 0, 0.08, 0.12, place.depth - 0.6);
    block(canvas, side * 2.9, 5.5, 0, 0.3, 0.12, place.depth * 0.58);
  }
  style(canvas, DARK, " "); block(canvas, 0, 3.85, -halfDepth + 0.22, place.width * 0.78, 1.6, 0.12);
  style(canvas, place.color, "=", true);
  lettering(canvas, place.sign, 0, 3.85, -halfDepth + 0.3, Math.min(0.62, place.width * 0.64 / place.sign.length));
  style(canvas, [38, 77, 87], "="); block(canvas, 0, 2.1, halfDepth - 0.24, 2.8, 4.2, 0.12);
  style(canvas, WARM, "=", true);
  lettering(canvas, "EXIT", 0, 4.65, halfDepth - 0.34, 0.44, 180);
  for (const side of [-1, 1]) block(canvas, side * 1.5, 2.2, halfDepth - 0.3, 0.12, 4.4, 0.14);
  for (const item of fixtures) fixture(canvas, item, place, time);
  resident(canvas, -1.5, -halfDepth + 1.5, place.color, time);
  if (place.kind === "listening-bar" || place.kind === "teahouse") {
    resident(canvas, halfWidth - 2.2, 0.6, [103, 130, 168], time + 3, true);
  } else {
    resident(canvas, -halfWidth + 2.2, 2.45, [161, 126, 80], time + 3);
  }
  if (place.kind === "listening-bar") {
    for (let bar = 0; bar < 9; bar++) {
      const height = 0.3 + (Math.sin(time * 1.3 + bar * 0.7) + 1) * 0.32;
      style(canvas, place.color, "=", true); block(canvas, (bar - 4) * 0.5, 2.1 + height / 2, -halfDepth + 0.3, 0.28, height, 0.05);
    }
  }
  if (effects) {
    const count = low ? 6 : 18;
    const steam = place.kind === "teahouse" || place.kind === "workshop";
    for (let particle = 0; particle < count; particle++) {
      const phase = ((time * (steam ? 0.17 : 0.06) + particle * 0.618) % 1 + 1) % 1;
      const drift = Math.sin(time * 0.3 + particle * 2.4);
      const x = steam ? drift * 0.45 + (particle % 2 ? -1 : 1) * place.width * 0.16 : drift * (halfWidth - 1);
      const z = steam ? -halfDepth + 3.5 : Math.cos(particle * 1.7 + time * 0.12) * (halfDepth - 1.2);
      const tint = steam ? WARM : place.color;
      const gain = Math.sin(phase * Math.PI) * 0.6 + 0.12;
      style(canvas, [tint[0] * gain, tint[1] * gain, tint[2] * gain], steam ? ":" : ".", true);
      block(canvas, x, 1.8 + phase * 2.9, z, steam ? 0.18 + phase * 0.3 : 0.09, 0.15, 0.08);
    }
  }
  canvas.pop();
}

export function drawInteriorEntrances(canvas: PropCanvas, places: readonly InteriorPlace[], eye: { x: number; z: number }, visible: (x: number, y: number, z: number, radius?: number) => boolean): void {
  for (const place of places) {
    const { entrance } = place;
    if (Math.hypot(eye.x - entrance.x, eye.z - entrance.z) > 100 || !visible(entrance.x, 3, entrance.z, 2)) continue;
    canvas.push(); canvas.translate(entrance.x, 0, entrance.z); canvas.rotateY(place.yaw * 180 / Math.PI);
    style(canvas, [255, 206, 138], "|");
    for (const side of [-1, 1]) block(canvas, side * 1.2, 2.0, -0.65, 0.14, 3.7, 0.16);
    block(canvas, 0, 3.87, -0.65, 2.5, 0.14, 0.16);
    style(canvas, [16, 25, 32], " "); block(canvas, 0, 3.0, -0.55, 2.1, 0.95, 0.12);
    style(canvas, place.color, "="); lettering(canvas, "OPEN", 0, 3, -0.47, 0.4, 0, true);
    canvas.pop();
  }
}

export function drawInteriorInteractables(canvas: PropCanvas, place: InteriorPlace, items: readonly InteractableDefinition[]): void {
  canvas.push(); canvas.translate(place.x, 0, place.z); canvas.rotateY(place.yaw * 180 / Math.PI);
  for (const item of items) {
    const local = interiorLocal(place, item.x, item.z), height = item.y ?? 2.4;
    style(canvas, DARK, " "); block(canvas, local.x, height, local.z, 1.65, 0.95, 0.15);
    style(canvas, WARM, ">", true);
    lettering(canvas, item.glyph === ">" ? "USE" : item.glyph ?? "USE", local.x, height + 0.06, local.z + 0.09, 0.31);
    block(canvas, local.x, height - 0.36, local.z + 0.09, 1.3, 0.04, 0.04);
  }
  canvas.pop();
}
