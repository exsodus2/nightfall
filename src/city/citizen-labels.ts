import type { Textmodifier } from "textmode.js";
import type { Citizen } from "./people.ts";
import { project, type ViewCamera } from "./vfx.ts";

export interface CitizenLabelFrame {
  citizens: readonly Citizen[];
  cam: ViewCamera;
  time: number;
  visible?: (x: number, y: number, z: number) => boolean;
}
export interface CitizenLabel { id: number; text: string; x: number; y: number; distance: number }

export function citizenLabels(frame: CitizenLabelFrame, columns: number, rows: number): CitizenLabel[] {
  const candidates: CitizenLabel[] = [];
  for (const citizen of frame.citizens) {
    if (!citizen.bark || (citizen.barkUntil ?? 0) <= frame.time) continue;
    const distance = Math.hypot(citizen.x - frame.cam.x, citizen.z - frame.cam.z);
    if (distance < 1.4 || distance > 18 || (frame.visible && !frame.visible(citizen.x, citizen.y + 2.6, citizen.z))) continue;
    const point = project(frame.cam, citizen.x, citizen.y + 3.35, citizen.z);
    if (!point) continue;
    const x = Math.round(point.sx * columns / 2), y = Math.round(-point.sy * rows / 2);
    const text = citizen.bark.slice(0, Math.min(44, columns - 8));
    if (Math.abs(x) + text.length / 2 > columns / 2 - 2 || y < -rows / 2 + 10 || y > rows / 2 - 10) continue;
    candidates.push({ id: citizen.id, text, x, y, distance });
  }
  candidates.sort((left, right) => left.distance - right.distance || left.id - right.id);
  const selected: CitizenLabel[] = [];
  for (const candidate of candidates) {
    if (selected.some(label => Math.abs(label.y - candidate.y) < 3 && Math.abs(label.x - candidate.x) < (label.text.length + candidate.text.length) / 2 + 2)) continue;
    selected.push(candidate);
    if (selected.length === 3) break;
  }
  return selected;
}

export function drawCitizenLabels(canvas: Textmodifier, columns: number, rows: number, frame: CitizenLabelFrame | null): void {
  if (!frame) return;
  canvas.printAlign("center", "middle");
  canvas.charColor(184, 215, 208); canvas.cellColor(7, 19, 22, 235);
  for (const label of citizenLabels(frame, columns, rows)) canvas.print(label.text, label.x, label.y, { markup: false });
  canvas.cellColor(0, 0, 0, 0);
}
