import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { PlanExecutor, type StepExecutor, type StepExecutionResult } from "../src/plan/executor.js";
import type { ExecutionPlan, PlanStep } from "../src/types/plan.js";
import { createPlanStep, createExecutionPlan } from "../src/types/plan.js";
import { EventBus, resetEventBus, getEventBus } from "../src/streaming/event-bus.js";
import type { FeedbackEvent } from "../src/types/feedback.js";
import { RateLimitError } from "../src/errors/index.js";

describe("Plan Executor", () => {
  let executor: PlanExecutor;
  let eventBus: EventBus;

  beforeEach(() => {
    resetEventBus();
    eventBus = getEventBus();

    executor = new PlanExecutor({
      eventBus,
      maxRetries: 2,
      baseRetryDelayMs: 10,
      maxRetryDelayMs: 100,
    });
  });

  afterEach(() => {
    resetEventBus();
  });

  function createSimplePlan(): ExecutionPlan {
    return createExecutionPlan("test-plan", "Test plan", [
      createPlanStep("step-1", "First step"),
      createPlanStep("step-2", "Second step", ["step-1"]),
      createPlanStep("step-3", "Third step", ["step-2"]),
    ]);
  }

  describe("execute", () => {
    it("should execute steps in order", async () => {
      const plan = createSimplePlan();
      const executionOrder: string[] = [];

      executor.setDefaultExecutor(async (step) => {
        executionOrder.push(step.id);
        return { success: true, output: `Done ${step.id}`, tokensUsed: 10, toolCalls: 0 };
      });

      const result = await executor.execute(plan, "session-1");

      expect(executionOrder).toEqual(["step-1", "step-2", "step-3"]);
      expect(result.steps.every((s) => s.status === "completed")).toBe(true);
    });

    it("should emit events during execution", async () => {
      const plan = createSimplePlan();
      const capturedEvents: FeedbackEvent[] = [];
      eventBus.on("*", (e) => capturedEvents.push(e));

      executor.setDefaultExecutor(async (step) => ({
        success: true,
        output: `Done ${step.id}`,
        tokensUsed: 10,
        toolCalls: 0,
      }));

      await executor.execute(plan, "session-1");

      expect(capturedEvents.some((e) => e.type === "session_started")).toBe(true);
      expect(capturedEvents.some((e) => e.type === "session_completed")).toBe(true);
      expect(capturedEvents.filter((e) => e.type === "step_started")).toHaveLength(3);
      expect(capturedEvents.filter((e) => e.type === "step_completed")).toHaveLength(3);
    });

    it("should track token usage", async () => {
      const plan = createSimplePlan();
      const capturedEvents: FeedbackEvent[] = [];
      eventBus.on("*", (e) => capturedEvents.push(e));

      executor.setDefaultExecutor(async (step) => ({
        success: true,
        output: `Done ${step.id}`,
        tokensUsed: 100,
        toolCalls: 0,
      }));

      await executor.execute(plan, "session-1");

      const tokenEvents = capturedEvents.filter((e) => e.type === "token_usage");
      expect(tokenEvents.length).toBeGreaterThan(0);
      expect(tokenEvents[tokenEvents.length - 1].payload.totalTokens).toBe(300);
    });

    it("should handle step failure", async () => {
      const plan = createSimplePlan();

      executor.setDefaultExecutor(async (step) => {
        if (step.id === "step-2") {
          return { success: false, error: "Step 2 failed", tokensUsed: 10, toolCalls: 0 };
        }
        return { success: true, output: `Done ${step.id}`, tokensUsed: 10, toolCalls: 0 };
      });

      const result = await executor.execute(plan, "session-1");

      expect(result.steps[0].status).toBe("completed");
      expect(result.steps[1].status).toBe("failed");
      expect(result.steps[2].status).toBe("skipped");
    });

    it("should skip steps when dependency fails", async () => {
      const plan = createSimplePlan();

      executor.setDefaultExecutor(async (step) => {
        if (step.id === "step-1") {
          return { success: false, error: "Step 1 failed", tokensUsed: 10, toolCalls: 0 };
        }
        return { success: true, output: `Done ${step.id}`, tokensUsed: 10, toolCalls: 0 };
      });

      const result = await executor.execute(plan, "session-1");

      expect(result.steps[0].status).toBe("failed");
      expect(result.steps[1].status).toBe("skipped");
      expect(result.steps[2].status).toBe("skipped");
    });

    it("should use step-specific executor", async () => {
      const plan = createSimplePlan();

      executor.registerStepExecutor("step-2", async () => ({
        success: true,
        output: "Custom executor",
        tokensUsed: 50,
        toolCalls: 0,
      }));

      executor.setDefaultExecutor(async (step) => ({
        success: true,
        output: `Default ${step.id}`,
        tokensUsed: 10,
        toolCalls: 0,
      }));

      const result = await executor.execute(plan, "session-1");

      expect(result.steps[1].result?.output).toBe("Custom executor");
    });

    it("should handle abort signal", async () => {
      const plan = createSimplePlan();
      const controller = new AbortController();

      const executionOrder: string[] = [];
      executor.setDefaultExecutor(async (step) => {
        executionOrder.push(step.id);
        if (step.id === "step-1") {
          controller.abort();
        }
        return { success: true, output: `Done ${step.id}`, tokensUsed: 10, toolCalls: 0 };
      });

      const result = await executor.execute(plan, "session-1", {
        signal: controller.signal,
      });

      expect(result.steps[0].status).toBe("completed");
      expect(result.steps[1].status).toBe("skipped");
      expect(result.steps[2].status).toBe("skipped");
    });

    it("should call progress callback", async () => {
      const plan = createSimplePlan();
      const progressUpdates: Array<{ total: number; completed: number }> = [];

      executor.setDefaultExecutor(async () => ({
        success: true,
        output: "Done",
        tokensUsed: 10,
        toolCalls: 0,
      }));

      await executor.execute(plan, "session-1", {
        onProgress: (progress) => progressUpdates.push(progress),
      });

      expect(progressUpdates.length).toBe(3);
      expect(progressUpdates[0].completed).toBe(1);
      expect(progressUpdates[2].completed).toBe(3);
    });

    it("should handle already completed steps", async () => {
      const plan = createExecutionPlan("test", "Test", [
        { ...createPlanStep("step-1", "First"), status: "completed" },
        createPlanStep("step-2", "Second", ["step-1"]),
      ]);

      const executedSteps: string[] = [];
      executor.setDefaultExecutor(async (step) => {
        executedSteps.push(step.id);
        return { success: true, output: "Done", tokensUsed: 10, toolCalls: 0 };
      });

      await executor.execute(plan, "session-1");

      expect(executedSteps).toEqual(["step-2"]);
    });
  });

  describe("retry logic", () => {
    it("should retry on rate limit error", async () => {
      const plan = createExecutionPlan("retry-plan", "Retry", [
        createPlanStep("step-1", "Single step")
      ]);
      let attempts = 0;

      executor.setDefaultExecutor(async () => {
        attempts++;
        if (attempts < 3) {
          throw new RateLimitError(1);
        }
        return { success: true, output: "Done", tokensUsed: 10, toolCalls: 0 };
      });

      const result = await executor.execute(plan, "session-1");

      expect(attempts).toBe(3);
      expect(result.steps[0].status).toBe("completed");
    });

    it("should fail after max retries", async () => {
      const plan = createExecutionPlan("fail-plan", "Fail", [
        createPlanStep("step-1", "Single step")
      ]);
      let attempts = 0;

      executor.setDefaultExecutor(async () => {
        attempts++;
        throw new RateLimitError(1);
      });

      const result = await executor.execute(plan, "session-1");

      expect(attempts).toBe(3);
      expect(result.steps[0].status).toBe("failed");
    });

    it("should emit retry events", async () => {
      const plan = createExecutionPlan("events-plan", "Events", [
        createPlanStep("step-1", "Single step")
      ]);
      let attempts = 0;
      const capturedEvents: FeedbackEvent[] = [];
      eventBus.on("*", (e) => capturedEvents.push(e));

      executor.setDefaultExecutor(async () => {
        attempts++;
        if (attempts < 2) {
          throw new RateLimitError(1);
        }
        return { success: true, output: "Done", tokensUsed: 10, toolCalls: 0 };
      });

      await executor.execute(plan, "session-1");

      const retryEvents = capturedEvents.filter(
        (e) => e.type === "step_progress" && e.payload.message?.includes("Retrying")
      );
      expect(retryEvents.length).toBeGreaterThan(0);
    });
  });

  describe("executeParallel", () => {
    it("should execute independent steps in parallel", async () => {
      const plan = createExecutionPlan("test", "Test", [
        createPlanStep("a", "A"),
        createPlanStep("b", "B"),
        createPlanStep("c", "C"),
      ]);

      const startTimes: Map<string, number> = [];
      executor.setDefaultExecutor(async (step) => {
        startTimes.set(step.id, Date.now());
        await new Promise((r) => setTimeout(r, 20));
        return { success: true, output: "Done", tokensUsed: 10, toolCalls: 0 };
      });

      await executor.executeParallel(plan, "session-1");

      const times = Array.from(startTimes.values());
      const allStartedTogether = times.every((t) => Math.abs(t - times[0]) < 15);
      expect(allStartedTogether).toBe(true);
    });

    it("should respect dependencies in parallel execution", async () => {
      const plan = createExecutionPlan("test", "Test", [
        createPlanStep("a", "A"),
        createPlanStep("b", "B", ["a"]),
        createPlanStep("c", "C", ["a"]),
        createPlanStep("d", "D", ["b", "c"]),
      ]);

      const executionOrder: string[] = [];
      executor.setDefaultExecutor(async (step) => {
        executionOrder.push(step.id);
        return { success: true, output: "Done", tokensUsed: 10, toolCalls: 0 };
      });

      await executor.executeParallel(plan, "session-1");

      expect(executionOrder.indexOf("a")).toBeLessThan(executionOrder.indexOf("b"));
      expect(executionOrder.indexOf("a")).toBeLessThan(executionOrder.indexOf("c"));
      expect(executionOrder.indexOf("b")).toBeLessThan(executionOrder.indexOf("d"));
      expect(executionOrder.indexOf("c")).toBeLessThan(executionOrder.indexOf("d"));
    });

    it("should limit parallelism", async () => {
      const plan = createExecutionPlan("test", "Test", [
        createPlanStep("a", "A"),
        createPlanStep("b", "B"),
        createPlanStep("c", "C"),
        createPlanStep("d", "D"),
      ]);

      let concurrentCount = 0;
      let maxConcurrent = 0;

      executor.setDefaultExecutor(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((r) => setTimeout(r, 10));
        concurrentCount--;
        return { success: true, output: "Done", tokensUsed: 10, toolCalls: 0 };
      });

      await executor.executeParallel(plan, "session-1", { maxParallel: 2 });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe("abort", () => {
    it("should abort execution", async () => {
      const plan = createSimplePlan();

      executor.setDefaultExecutor(async (step) => {
        if (step.id === "step-1") {
          executor.abort();
        }
        return { success: true, output: "Done", tokensUsed: 10, toolCalls: 0 };
      });

      const result = await executor.execute(plan, "session-1");

      expect(result.steps[1].status).toBe("skipped");
    });
  });

  describe("getState", () => {
    it("should return null before execution", () => {
      expect(executor.getState()).toBeNull();
    });

    it("should return state during and after execution", async () => {
      const plan = createSimplePlan();

      executor.setDefaultExecutor(async () => ({
        success: true,
        output: "Done",
        tokensUsed: 10,
        toolCalls: 0,
      }));

      const promise = executor.execute(plan, "session-1");

      const stateDuring = executor.getState();
      expect(stateDuring).not.toBeNull();
      expect(stateDuring?.plan.id).toBe("test-plan");

      await promise;

      const stateAfter = executor.getState();
      expect(stateAfter?.tokenUsage.totalTokens).toBe(30);
    });
  });
});
