import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus, getEventBus, resetEventBus } from "../src/streaming/event-bus.js";
import { createFeedbackEvent, type FeedbackEvent } from "../src/types/feedback.js";

describe("EventBus", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    resetEventBus();
    eventBus = getEventBus();
  });

  afterEach(() => {
    resetEventBus();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = getEventBus();
      const instance2 = getEventBus();
      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getEventBus();
      resetEventBus();
      const instance2 = getEventBus();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe("emit and on", () => {
    it("should emit and receive events", () => {
      const handler = vi.fn();
      eventBus.on("session_started", handler);

      const event = createFeedbackEvent("session_started", "session-1", {
        task: "test",
      });
      eventBus.emit(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it("should support multiple listeners for same event type", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on("session_started", handler1);
      eventBus.on("session_started", handler2);

      const event = createFeedbackEvent("session_started", "session-1", {});
      eventBus.emit(event);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should not call listeners for different event types", () => {
      const handler = vi.fn();
      eventBus.on("session_started", handler);

      const event = createFeedbackEvent("step_completed", "session-1", {});
      eventBus.emit(event);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("once", () => {
    it("should receive event only once", () => {
      const handler = vi.fn();
      eventBus.once("session_started", handler);

      const event1 = createFeedbackEvent("session_started", "session-1", {
        count: 1,
      });
      const event2 = createFeedbackEvent("session_started", "session-1", {
        count: 2,
      });

      eventBus.emit(event1);
      eventBus.emit(event2);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event1);
    });
  });

  describe("off", () => {
    it("should remove event listener", () => {
      const handler = vi.fn();
      eventBus.on("session_started", handler);
      eventBus.off("session_started", handler);

      const event = createFeedbackEvent("session_started", "session-1", {});
      eventBus.emit(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should handle removing non-existent listener gracefully", () => {
      const handler = vi.fn();
      expect(() => eventBus.off("nonexistent", handler)).not.toThrow();
    });
  });

  describe("emitAsync", () => {
    it("should await async handlers", async () => {
      const results: number[] = [];
      
      eventBus.on("session_started", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(1);
      });
      
      eventBus.on("session_started", async () => {
        results.push(2);
      });

      const event = createFeedbackEvent("session_started", "session-1", {});
      await eventBus.emitAsync(event);

      expect(results).toContain(1);
      expect(results).toContain(2);
    });

    it("should return false when no listeners", async () => {
      const event = createFeedbackEvent("nonexistent", "session-1", {});
      const result = await eventBus.emitAsync(event);
      expect(result).toBe(false);
    });

    it("should return true when listeners exist", async () => {
      eventBus.on("session_started", () => {});
      const event = createFeedbackEvent("session_started", "session-1", {});
      const result = await eventBus.emitAsync(event);
      expect(result).toBe(true);
    });

    it("should handle handler errors gracefully", async () => {
      const errorHandler = vi.fn();
      
      eventBus.on("session_started", async () => {
        throw new Error("Handler error");
      });
      
      eventBus.on("session_error", errorHandler);

      const event = createFeedbackEvent("session_started", "session-1", {});
      await eventBus.emitAsync(event);

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("should return listener count", () => {
      eventBus.on("session_started", () => {});
      eventBus.on("step_completed", () => {});
      eventBus.on("step_completed", () => {});

      const stats = eventBus.getStats();
      expect(stats.listenerCount).toBe(3);
    });

    it("should return event counts", () => {
      eventBus.emit(createFeedbackEvent("session_started", "s1", {}));
      eventBus.emit(createFeedbackEvent("session_started", "s1", {}));
      eventBus.emit(createFeedbackEvent("step_completed", "s1", {}));

      const stats = eventBus.getStats();
      expect(stats.eventCounts["session_started"]).toBe(2);
      expect(stats.eventCounts["step_completed"]).toBe(1);
    });
  });

  describe("resetStats", () => {
    it("should clear event counts", () => {
      eventBus.emit(createFeedbackEvent("session_started", "s1", {}));
      eventBus.resetStats();
      
      const stats = eventBus.getStats();
      expect(stats.eventCounts).toEqual({});
    });

    it("should not remove listeners", () => {
      const handler = vi.fn();
      eventBus.on("session_started", handler);
      eventBus.resetStats();
      
      eventBus.emit(createFeedbackEvent("session_started", "s1", {}));
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("resetInstance", () => {
    it("should clear all listeners", () => {
      const handler = vi.fn();
      eventBus.on("session_started", handler);
      
      resetEventBus();
      eventBus = getEventBus();
      
      eventBus.emit(createFeedbackEvent("session_started", "s1", {}));
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
