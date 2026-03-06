import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpProgressReporter, createProgressReporter } from "../src/streaming/progress-reporter.js";
import { EventBus, resetEventBus, getEventBus } from "../src/streaming/event-bus.js";
import type { FeedbackEvent, ProgressFeedback, TokenUsageFeedback } from "../src/types/feedback.js";

describe("McpProgressReporter", () => {
  let reporter: McpProgressReporter;
  let eventBus: EventBus;
  let emittedEvents: FeedbackEvent[];

  beforeEach(() => {
    resetEventBus();
    eventBus = getEventBus();
    emittedEvents = [];

    eventBus.on("step_progress", (e: FeedbackEvent) => emittedEvents.push(e));
    eventBus.on("token_usage", (e: FeedbackEvent) => emittedEvents.push(e));
    eventBus.on("session_error", (e: FeedbackEvent) => emittedEvents.push(e));
    eventBus.on("step_started", (e: FeedbackEvent) => emittedEvents.push(e));
    eventBus.on("step_completed", (e: FeedbackEvent) => emittedEvents.push(e));
    eventBus.on("step_failed", (e: FeedbackEvent) => emittedEvents.push(e));
    eventBus.on("tool_called", (e: FeedbackEvent) => emittedEvents.push(e));
    eventBus.on("tool_result", (e: FeedbackEvent) => emittedEvents.push(e));

    reporter = new McpProgressReporter({
      sessionId: "test-session",
      planId: "test-plan",
    });
  });

  afterEach(() => {
    resetEventBus();
  });

  describe("constructor", () => {
    it("should use provided event bus", () => {
      const customBus = new EventBus();
      const customEvents: FeedbackEvent[] = [];
      customBus.on("step_progress", (e: FeedbackEvent) => customEvents.push(e));

      const customReporter = new McpProgressReporter({
        sessionId: "custom-session",
        eventBus: customBus,
      });

      customReporter.reportProgress(50, "test");
      expect(customEvents).toHaveLength(1);
    });

    it("should use singleton event bus by default", () => {
      reporter.reportProgress(50, "test");
      expect(emittedEvents).toHaveLength(1);
    });
  });

  describe("reportProgress", () => {
    it("should emit step_progress event", () => {
      const result = reporter.reportProgress(50, "Halfway done", 60000);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("step_progress");
      expect(emittedEvents[0].sessionId).toBe("test-session");
      expect(emittedEvents[0].planId).toBe("test-plan");
      expect(emittedEvents[0].payload).toEqual({
        percent: 50,
        message: "Halfway done",
        eta: 60000,
      });
      expect(result).toEqual({
        percent: 50,
        message: "Halfway done",
        eta: 60000,
      });
    });

    it("should clamp percent between 0 and 100", () => {
      reporter.reportProgress(-10, "Negative");
      expect((emittedEvents[0].payload as ProgressFeedback).percent).toBe(0);

      reporter.reportProgress(150, "Overflow");
      expect((emittedEvents[1].payload as ProgressFeedback).percent).toBe(100);
    });

    it("should update internal state", () => {
      reporter.reportProgress(75, "Progress update");
      const state = reporter.getState();

      expect(state.percent).toBe(75);
      expect(state.message).toBe("Progress update");
    });
  });

  describe("reportTokenUsage", () => {
    it("should emit token_usage event", () => {
      const result = reporter.reportTokenUsage(100, 50, 850);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("token_usage");
      expect(emittedEvents[0].payload).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        remainingBudget: 850,
      });
      expect(result).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        remainingBudget: 850,
      });
    });

    it("should update internal token state", () => {
      reporter.reportTokenUsage(100, 50, 850);
      const state = reporter.getState();

      expect(state.tokensUsed).toBe(150);
      expect(state.tokenBudget).toBe(1000);
    });
  });

  describe("reportError", () => {
    it("should emit session_error event with Error object", () => {
      const error = new Error("Test error");
      error.name = "TestError";
      error.stack = "test stack";

      reporter.reportError(error, { context: "additional info" });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("session_error");
      expect(emittedEvents[0].payload).toMatchObject({
        error: "Test error",
        name: "TestError",
        stack: "test stack",
        context: "additional info",
      });
    });

    it("should emit session_error event with string", () => {
      reporter.reportError("Simple error message");

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("session_error");
      expect(emittedEvents[0].payload).toMatchObject({
        error: "Simple error message",
        name: "Error",
      });
    });
  });

  describe("incrementStep", () => {
    it("should increment current step", () => {
      reporter.setTotalSteps(4);
      
      const step1 = reporter.incrementStep("Step 1");
      expect(step1).toBe(1);
      
      const step2 = reporter.incrementStep("Step 2");
      expect(step2).toBe(2);

      const state = reporter.getState();
      expect(state.currentStep).toBe(2);
      expect(state.percent).toBe(50);
    });

    it("should emit step_progress event", () => {
      reporter.setTotalSteps(2);
      reporter.incrementStep("First step");

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("step_progress");
      expect(emittedEvents[0].payload).toMatchObject({
        percent: 50,
        message: "First step",
        currentStep: 1,
        totalSteps: 2,
      });
    });

    it("should use previous message if not provided", () => {
      reporter.reportProgress(0, "Initial message");
      emittedEvents.length = 0;
      
      reporter.incrementStep();

      expect(emittedEvents[0].payload).toHaveProperty("message", "Initial message");
    });
  });

  describe("setStepId", () => {
    it("should update current step id", () => {
      reporter.setStepId("step-123");
      reporter.reportProgress(50, "test");

      expect(emittedEvents[0].stepId).toBe("step-123");
    });
  });

  describe("setTotalSteps", () => {
    it("should update total steps", () => {
      reporter.setTotalSteps(10);
      const state = reporter.getState();

      expect(state.totalSteps).toBe(10);
    });
  });

  describe("getState", () => {
    it("should return copy of state", () => {
      reporter.setTotalSteps(5);
      reporter.incrementStep("test");

      const state1 = reporter.getState();
      const state2 = reporter.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("reportToolCall", () => {
    it("should emit tool_called event", () => {
      reporter.reportToolCall("read_file", { path: "/test.txt" });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("tool_called");
      expect(emittedEvents[0].payload).toEqual({
        toolName: "read_file",
        args: { path: "/test.txt" },
      });
    });
  });

  describe("reportToolResult", () => {
    it("should emit tool_result event", () => {
      reporter.reportToolResult("call-1", "file contents", false);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("tool_result");
      expect(emittedEvents[0].payload).toEqual({
        callId: "call-1",
        result: "file contents",
        isError: false,
      });
    });

    it("should default isError to false", () => {
      reporter.reportToolResult("call-1", "result");

      expect(emittedEvents[0].payload).toMatchObject({
        isError: false,
      });
    });
  });

  describe("reportStepStarted", () => {
    it("should emit step_started event and update stepId", () => {
      reporter.reportStepStarted("step-456", "Do something");

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("step_started");
      expect(emittedEvents[0].stepId).toBe("step-456");
      expect(emittedEvents[0].payload).toEqual({
        stepId: "step-456",
        description: "Do something",
      });
    });
  });

  describe("reportStepCompleted", () => {
    it("should emit step_completed event", () => {
      reporter.reportStepCompleted("step-789", { output: "done" });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("step_completed");
      expect(emittedEvents[0].stepId).toBe("step-789");
      expect(emittedEvents[0].payload).toEqual({
        stepId: "step-789",
        result: { output: "done" },
      });
    });
  });

  describe("reportStepFailed", () => {
    it("should emit step_failed event with Error", () => {
      const error = new Error("Step failed");
      reporter.reportStepFailed("step-fail", error);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe("step_failed");
      expect(emittedEvents[0].payload).toEqual({
        stepId: "step-fail",
        error: "Step failed",
      });
    });

    it("should emit step_failed event with string", () => {
      reporter.reportStepFailed("step-fail", "Simple failure");

      expect(emittedEvents[0].payload).toMatchObject({
        error: "Simple failure",
      });
    });
  });

  describe("createProgressReporter factory", () => {
    it("should create reporter instance", () => {
      const factoryReporter = createProgressReporter({
        sessionId: "factory-session",
      });

      expect(factoryReporter).toBeInstanceOf(McpProgressReporter);
    });
  });
});
