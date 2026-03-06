import { EventEmitter } from "events";
import type { FeedbackEvent } from "../types/feedback.js";

export type EventHandler<T = FeedbackEvent> = (event: T) => void | Promise<void>;

export interface EventBusStats {
  listenerCount: number;
  eventCounts: Record<string, number>;
}

class EventBus extends EventEmitter {
  private static instance: EventBus | null = null;
  private eventCounts: Record<string, number> = {};

  private constructor() {
    super();
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  emit<T extends FeedbackEvent>(event: T): boolean {
    this.eventCounts[event.type] = (this.eventCounts[event.type] || 0) + 1;
    return super.emit(event.type, event);
  }

  on<T extends FeedbackEvent>(
    eventType: T["type"] | string,
    handler: EventHandler<T>
  ): this {
    return super.on(eventType, handler as (...args: unknown[]) => void);
  }

  once<T extends FeedbackEvent>(
    eventType: T["type"] | string,
    handler: EventHandler<T>
  ): this {
    return super.once(eventType, handler as (...args: unknown[]) => void);
  }

  off<T extends FeedbackEvent>(
    eventType: T["type"] | string,
    handler: EventHandler<T>
  ): this {
    return super.off(eventType, handler as (...args: unknown[]) => void);
  }

  async emitAsync<T extends FeedbackEvent>(event: T): Promise<boolean> {
    this.eventCounts[event.type] = (this.eventCounts[event.type] || 0) + 1;
    const listeners = this.listeners(event.type) as EventHandler<T>[];
    
    if (listeners.length === 0) {
      return false;
    }

    await Promise.all(
      listeners.map(async (listener) => {
        try {
          await listener(event);
        } catch (error) {
          this.emit({
            type: "session_error",
            timestamp: Date.now(),
            sessionId: event.sessionId,
            payload: {
              originalEvent: event.type,
              error: error instanceof Error ? error.message : String(error),
            },
          } as FeedbackEvent);
        }
      })
    );

    return true;
  }

  getStats(): EventBusStats {
    const types = this.eventNames();
    let totalListeners = 0;
    for (const type of types) {
      totalListeners += this.listenerCount(type);
    }

    return {
      listenerCount: totalListeners,
      eventCounts: { ...this.eventCounts },
    };
  }

  resetStats(): void {
    this.eventCounts = {};
  }

  static resetInstance(): void {
    if (EventBus.instance) {
      EventBus.instance.removeAllListeners();
      EventBus.instance.eventCounts = {};
      EventBus.instance = null;
    }
  }
}

export { EventBus };
export const getEventBus = (): EventBus => EventBus.getInstance();
export const resetEventBus = (): void => EventBus.resetInstance();
