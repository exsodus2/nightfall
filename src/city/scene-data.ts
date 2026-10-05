/** Frame-scoped light/occlusion data. textmode caches scalar and texture
 * uniforms, but re-uploads array uniforms on every material change. Packing
 * shared values once avoids thousands of redundant WebGL calls per frame. */
export class SceneData {
  readonly texture: WebGLTexture;
  private readonly gl: WebGL2RenderingContext;
  private readonly values = new Float32Array(16 * 16 * 4);
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 is required for city lighting.");
    this.gl = gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate city lighting data.");
    this.texture = texture;
    this.withTexture(() => {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 16, 16, 0, gl.RGBA, gl.FLOAT, this.values);
    });
  }
  set(index: number, value: readonly number[]): void {
    for (let i = 0; i < 4; i++) this.values[index * 4 + i] = value[i] ?? 0;
  }
  upload(): void {
    const gl = this.gl;
    this.withTexture(() => gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 16, gl.RGBA, gl.FLOAT, this.values));
  }
  private withTexture(action: () => void): void { withBoundTexture(this.gl, this.texture, action); }
  dispose(): void { this.gl.deleteTexture(this.texture); }
}

// Preserve the texture unit, binding and unpack state used by textmode and its official addons.
function withBoundTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, action: () => void): void {
  const active = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0 + 15);
  const previous = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const flipped = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
  const premultiplied = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
  const alignment = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  action();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipped);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
  gl.bindTexture(gl.TEXTURE_2D, previous);
  gl.activeTexture(active);
}

import { miniFontBytes } from "./mini-font";

export const TEXT_WIDTH = 64;
/** Byte offset of the 3x5 mid-distance face (after the 95 x 8 bytes of the 8x8 face). */
export const MINI_FONT_OFFSET = 768;
/** First row of the message table; rows above hold the 8x8 ASCII font, one byte per glyph row. */
export const MESSAGE_ROW = 16;

/** Per-character market colour class of a message, for the tickers: 1 = part of a figure
 *  signed "+", 2 = signed "-", else 0. A sign counts only at the start or after a space and
 *  before a digit, so phone numbers ("0800-555") and times ("02:00 - 05:00") stay neutral. */
export function marketClasses(message: string): Uint8Array {
  const classes = new Uint8Array(message.length), figure = /[0-9.%]/;
  for (let i = 0; i < message.length; i++) {
    const sign = message[i];
    if ((sign !== "+" && sign !== "-") || (i > 0 && message[i - 1] !== " ") || !/[0-9]/.test(message[i + 1] ?? "")) continue;
    const mark = sign === "+" ? 1 : 2;
    classes[i] = mark;
    for (let j = i + 1; j < message.length && figure.test(message[j]); j++) classes[j] = mark;
  }
  return classes;
}

/** Byte texture the material reads text from: the font bitmaps plus a table of messages
 *  (byte 0 = length, then ASCII codes), so any surface can render scrolling text itself. After
 *  the messages, one row per message holds its market classes (MESSAGE_ROW + count + index). */
export class TextData {
  readonly texture: WebGLTexture;
  private readonly gl: WebGL2RenderingContext;
  constructor(canvas: HTMLCanvasElement, fontRows: readonly string[], messages: readonly string[]) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 is required for city text.");
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate city text data.");
    this.gl = gl; this.texture = texture;
    const rows = MESSAGE_ROW + messages.length * 2, bytes = new Uint8Array(TEXT_WIDTH * rows);
    fontRows.forEach((hex, glyph) => { for (let y = 0; y < 8; y++) bytes[glyph * 8 + y] = parseInt(hex.slice(y * 2, y * 2 + 2), 16); });
    bytes.set(miniFontBytes(), MINI_FONT_OFFSET);
    messages.forEach((message, row) => {
      const text = message.slice(0, TEXT_WIDTH - 1), offset = (MESSAGE_ROW + row) * TEXT_WIDTH;
      bytes[offset] = text.length;
      for (let i = 0; i < text.length; i++) bytes[offset + 1 + i] = Math.min(126, Math.max(32, text.charCodeAt(i)));
      bytes.set(marketClasses(text), (MESSAGE_ROW + messages.length + row) * TEXT_WIDTH + 1);
    });
    withBoundTexture(gl, texture, () => {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, TEXT_WIDTH, rows, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    });
  }
  dispose(): void { this.gl.deleteTexture(this.texture); }
}
