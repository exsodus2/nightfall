import type { Textmodifier } from "textmode.js";
import type { Citizen } from "./people.ts";
import { project, type ViewCamera } from "./vfx.ts";

export interface CitizenLabelFrame {
  citizens: readonly Citizen[];
  cam: ViewCamera;
  time: number;
  visible?: (x: number, y: number, z: number) => boolean;
}
/** One speech label on the HUD layer. `lines` are the wrapped rows of `text`; `width` is the plate
 * width in cells (text plus one space of padding either side); `speaker` is drawn above the plate
 * when the speaker is close; `alpha` (0..1) fades with distance and as the line expires. */
export interface CitizenLabel { id: number; text: string; lines: readonly string[]; speaker: string | null; x: number; y: number; distance: number; width: number; alpha: number }

/** Seconds a bark stays up (defined with the speech scheduler in citizen-ai.ts). */
export { barkHold } from "./citizen-ai.ts";

const MAX_LINE = 34, MAX_LABELS = 3, FAR = 18, NEAR = 7.5, FADE_OUT = 0.6;
const NAMES = ["Ines", "Tomo", "Wexler", "Ade", "Rosa", "Kiri", "Dev", "Marguerite", "Bao", "Odile", "Sam", "Yusuf", "Lena", "Pike", "Noor", "Haruto", "Bea", "Calloway", "Femi", "Zhen", "Ruth", "Ozzie", "Priya", "Lazlo", "Mo", "Ilse", "Teo", "Annika", "Rafe", "Suki"] as const;

/** Name shown above a citizen's speech: a stable first name, or the job for couriers. */
export function speakerName(citizen: Pick<Citizen, "id" | "occupation" | "role">): string {
  if (citizen.role === "patrol") return "CorpSec";
  if (citizen.role === "musician") return "Busker";
  if (citizen.role === "vendor") return "Umbrella seller";
  if (citizen.role === "preacher") return "Street preacher";
  if (citizen.occupation === "courier") return "Courier";
  return NAMES[((citizen.id * 2654435761) >>> 0) % NAMES.length];
}

/** Word-wraps printable text into at most two rows of `width` cells; anything left over is cut
 * with "..." (never mid-row without a marker). */
export function wrapBark(text: string, width: number): string[] {
  const limit = Math.max(4, Math.floor(width));
  const words = text.replace(/[^\x20-\x7e]/g, "?").trim().split(/\s+/).filter(Boolean).map(word => word.length > limit ? `${word.slice(0, limit - 3)}...` : word);
  const lines: string[] = [];
  let index = 0;
  while (index < words.length && lines.length < 2) {
    let line = words[index++];
    while (index < words.length && line.length + 1 + words[index].length <= limit) line += ` ${words[index++]}`;
    lines.push(line);
  }
  if (index < words.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.length + 3 <= limit ? `${last}...` : `${last.slice(0, limit - 3)}...`;
  }
  return lines;
}

export function citizenLabels(frame: CitizenLabelFrame, columns: number, rows: number): CitizenLabel[] {
  const candidates: CitizenLabel[] = [];
  const lineWidth = Math.min(MAX_LINE, columns - 8);
  for (const citizen of frame.citizens) {
    if (!citizen.bark || (citizen.barkUntil ?? 0) <= frame.time) continue;
    const distance = Math.hypot(citizen.x - frame.cam.x, citizen.z - frame.cam.z);
    if (distance < 1.4 || distance > FAR || (frame.visible && !frame.visible(citizen.x, citizen.y + 2.6, citizen.z))) continue;
    const point = project(frame.cam, citizen.x, citizen.y + 3.35, citizen.z);
    if (!point) continue;
    const lines = wrapBark(citizen.bark, lineWidth);
    if (!lines.length) continue;
    const width = Math.max(...lines.map(line => line.length)) + 2;
    const speaker = distance < NEAR ? speakerName(citizen) : null;
    const height = lines.length + (speaker ? 1 : 0);
    let x = Math.round(point.sx * columns / 2);
    let y = Math.round(-point.sy * rows / 2);
    // Keep the plate on screen: slide it in by a few cells at the edge, drop it if it would leave its speaker behind.
    const edge = columns / 2 - 2 - width / 2;
    if (Math.abs(x) > edge) { if (Math.abs(x) - edge > 6) continue; x = Math.sign(x) * Math.floor(edge); }
    // A speaker a couple of metres away puts the anchor high on screen: hold the plate just under
    // the HUD margin instead of dropping it (it is still over the speaker's head and shoulders).
    const top = -rows / 2 + 10 + height;
    if (y < top) { if (top - y > 12) continue; y = top; }
    if (y > rows / 2 - 10) continue;
    const near = 1 - Math.max(0, Math.min(1, (distance - 11) / (FAR - 11))) * 0.45;
    const alpha = near * Math.max(0, Math.min(1, ((citizen.barkUntil ?? 0) - frame.time) / FADE_OUT));
    candidates.push({ id: citizen.id, text: citizen.bark, lines, speaker, x, y, distance, width, alpha });
  }
  candidates.sort((left, right) => left.distance - right.distance || left.id - right.id);
  const selected: CitizenLabel[] = [];
  const rowsOf = (label: CitizenLabel) => label.lines.length + (label.speaker ? 1 : 0);
  for (const candidate of candidates) {
    if (selected.some(label => Math.abs(label.y - candidate.y) < Math.max(rowsOf(label), rowsOf(candidate)) + 1 && Math.abs(label.x - candidate.x) < (label.width + candidate.width) / 2 + 2)) continue;
    selected.push(candidate);
    if (selected.length === MAX_LABELS) break;
  }
  return selected;
}

/** Prints the labels on the HUD layer: a dark plate with one cell of padding either side, the
 * speaker's name in a dimmer colour above it. Lines grow upwards from the anchor so a two-line
 * bark never covers the speaker's face. */
export function drawCitizenLabels(canvas: Textmodifier, columns: number, rows: number, frame: CitizenLabelFrame | null): void {
  if (!frame) return;
  canvas.printAlign("center", "middle");
  for (const label of citizenLabels(frame, columns, rows)) {
    const a = label.alpha;
    const top = label.y - (label.lines.length - 1);
    for (let index = 0; index < label.lines.length; index++) {
      const line = label.lines[index];
      const padded = ` ${line}${" ".repeat(label.width - 2 - line.length)} `;
      canvas.charColor(226, 238, 232, 255 * a); canvas.cellColor(5, 13, 17, 232 * a);
      canvas.print(padded, label.x, top + index, { markup: false });
    }
    if (label.speaker) {
      canvas.charColor(130, 214, 194, 235 * a); canvas.cellColor(5, 13, 17, 190 * a);
      canvas.print(` ${label.speaker} `, label.x, top - 1, { markup: false });
    }
  }
  canvas.cellColor(0, 0, 0, 0);
}
