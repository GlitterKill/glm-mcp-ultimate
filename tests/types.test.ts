import { describe, it, expect } from "vitest";
import {
  createPlanStep,
  createExecutionPlan,
  getReadySteps,
  getStepById,
  updateStepStatus,
  isPlanComplete,
  hasPlanFailed,
  getPlanProgress,
  type PlanStep,
  type ExecutionPlan,
} from "../src/types/plan.js";
import {
  createFeedbackEvent,
  createProgressFeedback,
  createTokenUsageFeedback,
  createConfidenceFeedback,
  createCheckpointFeedback,
  isProgressFeedback,
  isTokenUsageFeedback,
  isCheckpointFeedback,
  isErrorFeedback,
} from "../src/types/feedback.js";
import {
  createTextChunk,
  createToolCallChunk,
  createToolResultChunk,
  createThinkingChunk,
  createErrorChunk,
  createDoneChunk,
  isTextChunk,
  isToolCallChunk,
  isToolResultChunk,
  isThinkingChunk,
  isErrorChunk,
  isDoneChunk,
} from "../src/types/streaming.js";

describe("Plan Types", () => {
  describe("createPlanStep", () => {
    it("should create a plan step with default values", () => {
      const step = createPlanStep("step-1", "Test step");
      expect(step.id).toBe("step-1");
      expect(step.description).toBe("Test step");
      expect(step.dependencies).toEqual([]);
      expect(step.status).toBe("pending");
      expect(step.assignedAgent).toBeUndefined();
      expect(step.result).toBeUndefined();
    });

    it("should create a plan step with dependencies", () => {
      const step = createPlanStep("step-2", "Dependent step", ["step-1"]);
      expect(step.dependencies).toEqual(["step-1"]);
    });
  });

  describe("createExecutionPlan", () => {
    it("should create an execution plan with default budget", () => {
      const steps = [createPlanStep("step-1", "First step")];
      const plan = createExecutionPlan("plan-1", "Test plan", steps);
      
      expect(plan.id).toBe("plan-1");
      expect(plan.description).toBe("Test plan");
      expect(plan.steps).toHaveLength(1);
      expect(plan.budget.maxTokens).toBe(100000);
      expect(plan.budget.maxSteps).toBe(100);
      expect(plan.budget.maxDurationMs).toBe(300000);
      expect(plan.budget.maxParallelSteps).toBe(4);
      expect(plan.metadata.priority).toBe("normal");
      expect(plan.metadata.source).toBe("user");
    });

    it("should create an execution plan with custom options", () => {
      const steps = [createPlanStep("step-1", "First step")];
      const plan = createExecutionPlan("plan-1", "Test plan", steps, {
        source: "generated",
        priority: "high",
        maxTokens: 50000,
        maxParallelSteps: 2,
        tags: ["important"],
      });
      
      expect(plan.metadata.source).toBe("generated");
      expect(plan.metadata.priority).toBe("high");
      expect(plan.budget.maxTokens).toBe(50000);
      expect(plan.budget.maxParallelSteps).toBe(2);
      expect(plan.metadata.tags).toEqual(["important"]);
    });
  });

  describe("getReadySteps", () => {
    it("should return pending steps with no dependencies", () => {
      const steps = [
        createPlanStep("step-1", "First"),
        createPlanStep("step-2", "Second", ["step-1"]),
      ];
      const plan = createExecutionPlan("plan-1", "Test", steps);
      
      const ready = getReadySteps(plan);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe("step-1");
    });

    it("should return steps whose dependencies are completed", () => {
      const steps = [
        createPlanStep("step-1", "First"),
        createPlanStep("step-2", "Second", ["step-1"]),
      ];
      let plan = createExecutionPlan("plan-1", "Test", steps);
      plan = updateStepStatus(plan, "step-1", "completed");
      
      const ready = getReadySteps(plan);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe("step-2");
    });
  });

  describe("updateStepStatus", () => {
    it("should update step status", () => {
      const steps = [createPlanStep("step-1", "First")];
      const plan = createExecutionPlan("plan-1", "Test", steps);
      
      const updated = updateStepStatus(plan, "step-1", "running");
      expect(updated.steps[0].status).toBe("running");
      expect(updated.updatedAt).toBeGreaterThanOrEqual(plan.updatedAt);
    });

    it("should include result when provided", () => {
      const steps = [createPlanStep("step-1", "First")];
      const plan = createExecutionPlan("plan-1", "Test", steps);
      const result = {
        success: true,
        output: "Done",
        artifacts: [],
        metrics: {
          startTime: Date.now(),
          tokensUsed: 100,
          toolCalls: 1,
          retryCount: 0,
        },
      };
      
      const updated = updateStepStatus(plan, "step-1", "completed", result);
      expect(updated.steps[0].result).toEqual(result);
    });
  });

  describe("isPlanComplete", () => {
    it("should return false when steps are pending", () => {
      const steps = [createPlanStep("step-1", "First")];
      const plan = createExecutionPlan("plan-1", "Test", steps);
      expect(isPlanComplete(plan)).toBe(false);
    });

    it("should return true when all steps are completed or skipped", () => {
      let plan = createExecutionPlan("plan-1", "Test", [
        createPlanStep("step-1", "First"),
        createPlanStep("step-2", "Second"),
      ]);
      plan = updateStepStatus(plan, "step-1", "completed");
      plan = updateStepStatus(plan, "step-2", "skipped");
      expect(isPlanComplete(plan)).toBe(true);
    });
  });

  describe("hasPlanFailed", () => {
    it("should return false when no steps failed", () => {
      const steps = [createPlanStep("step-1", "First")];
      const plan = createExecutionPlan("plan-1", "Test", steps);
      expect(hasPlanFailed(plan)).toBe(false);
    });

    it("should return true when any step failed", () => {
      let plan = createExecutionPlan("plan-1", "Test", [
        createPlanStep("step-1", "First"),
        createPlanStep("step-2", "Second"),
      ]);
      plan = updateStepStatus(plan, "step-1", "completed");
      plan = updateStepStatus(plan, "step-2", "failed");
      expect(hasPlanFailed(plan)).toBe(true);
    });
  });

  describe("getPlanProgress", () => {
    it("should return correct progress counts", () => {
      let plan = createExecutionPlan("plan-1", "Test", [
        createPlanStep("step-1", "First"),
        createPlanStep("step-2", "Second"),
        createPlanStep("step-3", "Third"),
        createPlanStep("step-4", "Fourth"),
      ]);
      plan = updateStepStatus(plan, "step-1", "completed");
      plan = updateStepStatus(plan, "step-2", "running");
      plan = updateStepStatus(plan, "step-3", "failed");
      
      const progress = getPlanProgress(plan);
      expect(progress.total).toBe(4);
      expect(progress.completed).toBe(1);
      expect(progress.running).toBe(1);
      expect(progress.failed).toBe(1);
      expect(progress.pending).toBe(1);
    });
  });
});

describe("Feedback Types", () => {
  describe("createFeedbackEvent", () => {
    it("should create a feedback event", () => {
      const event = createFeedbackEvent("session_started", "session-1", {
        task: "Test task",
      });
      
      expect(event.type).toBe("session_started");
      expect(event.sessionId).toBe("session-1");
      expect(event.payload).toEqual({ task: "Test task" });
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it("should include optional plan and step ids", () => {
      const event = createFeedbackEvent("step_completed", "session-1", 
        { result: "success" },
        { planId: "plan-1", stepId: "step-1" }
      );
      
      expect(event.planId).toBe("plan-1");
      expect(event.stepId).toBe("step-1");
    });
  });

  describe("createProgressFeedback", () => {
    it("should create progress feedback", () => {
      const feedback = createProgressFeedback(50, "Halfway done", 60000);
      expect(feedback.percent).toBe(50);
      expect(feedback.message).toBe("Halfway done");
      expect(feedback.eta).toBe(60000);
    });
  });

  describe("createTokenUsageFeedback", () => {
    it("should calculate total tokens", () => {
      const feedback = createTokenUsageFeedback(100, 50, 850);
      expect(feedback.promptTokens).toBe(100);
      expect(feedback.completionTokens).toBe(50);
      expect(feedback.totalTokens).toBe(150);
      expect(feedback.remainingBudget).toBe(850);
    });
  });

  describe("type guards", () => {
    it("should identify progress feedback", () => {
      const event = createFeedbackEvent("step_progress", "s1", { percent: 50 });
      expect(isProgressFeedback(event)).toBe(true);
      expect(isTokenUsageFeedback(event)).toBe(false);
    });

    it("should identify token usage feedback", () => {
      const event = createFeedbackEvent("token_usage", "s1", { tokens: 100 });
      expect(isTokenUsageFeedback(event)).toBe(true);
    });

    it("should identify error feedback", () => {
      const errorEvent = createFeedbackEvent("session_error", "s1", { error: "fail" });
      const stepError = createFeedbackEvent("step_failed", "s1", { error: "fail" });
      const normalEvent = createFeedbackEvent("step_completed", "s1", {});
      
      expect(isErrorFeedback(errorEvent)).toBe(true);
      expect(isErrorFeedback(stepError)).toBe(true);
      expect(isErrorFeedback(normalEvent)).toBe(false);
    });
  });
});

describe("Streaming Types", () => {
  describe("chunk creators", () => {
    it("should create text chunk", () => {
      const chunk = createTextChunk("id-1", "Hello");
      expect(chunk.type).toBe("text");
      expect(chunk.id).toBe("id-1");
      expect(chunk.delta).toBe("Hello");
    });

    it("should create tool call chunk", () => {
      const chunk = createToolCallChunk("id-1", {
        id: "call-1",
        name: "read_file",
        arguments: '{"path": "/test"}',
      });
      expect(chunk.type).toBe("tool_call");
      expect(chunk.toolCall?.name).toBe("read_file");
    });

    it("should create tool result chunk", () => {
      const chunk = createToolResultChunk("id-1", {
        callId: "call-1",
        result: "file content",
        error: false,
      });
      expect(chunk.type).toBe("tool_result");
      expect(chunk.toolResult?.result).toBe("file content");
    });

    it("should create thinking chunk", () => {
      const chunk = createThinkingChunk("id-1", "thinking...");
      expect(chunk.type).toBe("thinking");
      expect(chunk.delta).toBe("thinking...");
    });

    it("should create error chunk", () => {
      const chunk = createErrorChunk("id-1", "Something went wrong");
      expect(chunk.type).toBe("error");
      expect(chunk.delta).toBe("Something went wrong");
    });

    it("should create done chunk with usage", () => {
      const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
      const chunk = createDoneChunk("id-1", usage);
      expect(chunk.type).toBe("done");
      expect(chunk.usage).toEqual(usage);
    });
  });

  describe("chunk type guards", () => {
    it("should correctly identify chunk types", () => {
      expect(isTextChunk(createTextChunk("1", ""))).toBe(true);
      expect(isToolCallChunk(createToolCallChunk("1", { id: "1", name: "n", arguments: "" }))).toBe(true);
      expect(isToolResultChunk(createToolResultChunk("1", { callId: "1", result: "" }))).toBe(true);
      expect(isThinkingChunk(createThinkingChunk("1", ""))).toBe(true);
      expect(isErrorChunk(createErrorChunk("1", ""))).toBe(true);
      expect(isDoneChunk(createDoneChunk("1"))).toBe(true);
    });

    it("should return false for non-matching types", () => {
      const textChunk = createTextChunk("1", "");
      expect(isToolCallChunk(textChunk)).toBe(false);
      expect(isDoneChunk(textChunk)).toBe(false);
    });
  });
});
