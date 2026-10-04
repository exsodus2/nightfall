import type { ChatLine, SessionView } from "../multiplayer/session.ts";

export const CHAT_PREVIEW_MS = 5000;
export const CHAT_ATTENTION_LIMIT = 60;
export const CHAT_UNREAD_LIMIT = 99;

export interface ChatAttentionSnapshot {
  room: string | null;
  unread: number;
  preview: ChatLine | null;
  expiresAt: number;
}

export function chatRoomKey(view: Pick<SessionView, "serverUrl" | "code" | "selfId">): string | null {
  return view.serverUrl && view.code && view.selfId ? JSON.stringify([view.serverUrl, view.code, view.selfId]) : null;
}

export class ChatAttention {
  private snapshot: ChatAttentionSnapshot = { room: null, unread: 0, preview: null, expiresAt: 0 };
  private readonly listeners = new Set<() => void>();
  private seen = new Set<string>();
  private highestId = 0;

  readonly getSnapshot = (): ChatAttentionSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  observe(room: string | null, lines: readonly ChatLine[], reading: boolean, now: number): void {
    const changedRoom = room !== this.snapshot.room;
    if (changedRoom) { this.seen.clear(); this.highestId = 0; }
    let unread = changedRoom ? 0 : this.snapshot.unread;
    let preview = changedRoom ? null : this.snapshot.preview;
    let expiresAt = changedRoom ? 0 : this.snapshot.expiresAt;
    const time = Number.isFinite(now) ? Math.max(0, now) : Infinity;
    if (!room || reading || time >= expiresAt) { preview = null; expiresAt = 0; }
    if (!room || reading) unread = 0;
    const previousId = this.highestId;
    for (const line of room ? lines.slice(-CHAT_ATTENTION_LIMIT) : []) {
      if (!line.id || line.id.length > 64) continue;
      const numericId = /^c\d+$/.test(line.id) ? Number(line.id.slice(1)) : 0;
      const known = this.seen.has(line.id) || numericId > 0 && numericId <= previousId;
      this.seen.delete(line.id);
      this.seen.add(line.id);
      if (Number.isSafeInteger(numericId)) this.highestId = Math.max(this.highestId, numericId);
      if (known || reading || line.kind !== "chat" || line.self || line.history) continue;
      unread = Math.min(CHAT_UNREAD_LIMIT, unread + 1);
      if (Number.isFinite(time)) { preview = line; expiresAt = time + CHAT_PREVIEW_MS; }
    }
    this.seen = new Set([...this.seen].slice(-CHAT_ATTENTION_LIMIT));
    this.publish({ room, unread, preview, expiresAt });
  }

  expire(now: number): void {
    if (this.snapshot.preview && Number.isFinite(now) && now >= this.snapshot.expiresAt) this.publish({ ...this.snapshot, preview: null, expiresAt: 0 });
  }

  private publish(next: ChatAttentionSnapshot): void {
    const current = this.snapshot;
    if (current.room === next.room && current.unread === next.unread && current.preview === next.preview && current.expiresAt === next.expiresAt) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
