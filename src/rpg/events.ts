import type { EventOf, GameEvent, GameEventType } from "./types.ts";

type Handler<T extends GameEventType> = (event: EventOf<T>) => void;

/** Synchronous event bus. Events emitted from a handler are queued and delivered after the
 * current one, in order, so handlers never see a half-applied state (a quest effect that gives an
 * item raises itemAdded after the quest has finished reacting to the kill that caused it). */
export class EventBus {
  private handlers = new Map<GameEventType, Set<(event: GameEvent) => void>>();
  private any = new Set<(event: GameEvent) => void>();
  private queue: GameEvent[] = [];
  private delivering = false;

  on<T extends GameEventType>(type: T, handler: Handler<T>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    const wrapped = handler as (event: GameEvent) => void;
    set.add(wrapped); this.handlers.set(type, set);
    return () => set.delete(wrapped);
  }
  onAny(handler: (event: GameEvent) => void): () => void { this.any.add(handler); return () => this.any.delete(handler); }

  emit(event: GameEvent): void {
    this.queue.push(event);
    if (this.delivering) return;
    this.delivering = true;
    try {
      for (let i = 0; i < this.queue.length; i++) {
        const next = this.queue[i];
        for (const handler of this.handlers.get(next.type) ?? []) handler(next);
        for (const handler of this.any) handler(next);
        if (i > 10000) throw new Error("EventBus: runaway event loop");
      }
    } finally { this.queue = []; this.delivering = false; }
  }
}
