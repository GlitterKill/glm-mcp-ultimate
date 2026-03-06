import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PlanRepository } from "../src/db/plan-repository.js";
import type { ExecutionPlan, PlanStep } from "../src/types/plan.js";
import { createPlanStep, createExecutionPlan } from "../src/types/plan.js";
import { getDatabase, closeDatabase, resetDatabase } from "../src/db/connection.js";
import { PlanError } from "../src/errors/index.js";
import * as path from "node:path";
import * as fs from "node:fs";

describe("Plan Repository", () => {
  let repository: PlanRepository;
  const testDbPath = path.join(process.cwd(), "data", "test-plans.db");

  beforeEach(() => {
    resetDatabase();
    const dir = path.dirname(testDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const db = getDatabase(testDbPath);
    db.exec("DROP TABLE IF EXISTS plan_steps");
    db.exec("DROP TABLE IF EXISTS plans");
    repository = new PlanRepository(db);
  });

  afterEach(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const shmPath = testDbPath + "-shm";
    const walPath = testDbPath + "-wal";
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  });

  function createTestPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
    const steps = [
      createPlanStep("step-1", "First step"),
      createPlanStep("step-2", "Second step", ["step-1"]),
      createPlanStep("step-3", "Third step", ["step-2"]),
    ];
    return {
      ...createExecutionPlan("test-plan-1", "Test plan description", steps),
      ...overrides,
    };
  }

  describe("save", () => {
    it("should save a plan with steps", () => {
      const plan = createTestPlan();

      const result = repository.save(plan);

      expect(result.id).toBe("test-plan-1");
      expect(result.description).toBe("Test plan description");
      expect(result.steps).toHaveLength(3);
    });

    it("should save plan metadata correctly", () => {
      const plan = createTestPlan({
        metadata: {
          source: "generated",
          priority: "high",
          tags: ["urgent", "important"],
          model: "glm-5",
        },
      });

      repository.save(plan);
      const retrieved = repository.getById("test-plan-1");

      expect(retrieved?.metadata.source).toBe("generated");
      expect(retrieved?.metadata.priority).toBe("high");
      expect(retrieved?.metadata.tags).toEqual(["urgent", "important"]);
      expect(retrieved?.metadata.model).toBe("glm-5");
    });

    it("should save plan budget correctly", () => {
      const plan = createTestPlan({
        budget: {
          maxTokens: 50000,
          maxSteps: 20,
          maxDurationMs: 120000,
          maxParallelSteps: 8,
        },
      });

      repository.save(plan);
      const retrieved = repository.getById("test-plan-1");

      expect(retrieved?.budget.maxTokens).toBe(50000);
      expect(retrieved?.budget.maxSteps).toBe(20);
      expect(retrieved?.budget.maxDurationMs).toBe(120000);
      expect(retrieved?.budget.maxParallelSteps).toBe(8);
    });

    it("should save step with assigned agent", () => {
      const steps = [
        { ...createPlanStep("step-1", "First"), assignedAgent: "agent-1" },
      ];
      const plan = createExecutionPlan("test-plan-1", "Test", steps);

      repository.save(plan);
      const retrieved = repository.getById("test-plan-1");

      expect(retrieved?.steps[0].assignedAgent).toBe("agent-1");
    });

    it("should save step with result", () => {
      const result = {
        success: true,
        output: "Task completed",
        artifacts: [],
        metrics: {
          startTime: 1000,
          endTime: 2000,
          durationMs: 1000,
          tokensUsed: 100,
          toolCalls: 5,
          retryCount: 0,
        },
      };
      const steps = [{ ...createPlanStep("step-1", "First"), status: "completed" as const, result }];
      const plan = createExecutionPlan("test-plan-1", "Test", steps);

      repository.save(plan);
      const retrieved = repository.getById("test-plan-1");

      expect(retrieved?.steps[0].result?.success).toBe(true);
      expect(retrieved?.steps[0].result?.output).toBe("Task completed");
      expect(retrieved?.steps[0].result?.metrics.tokensUsed).toBe(100);
    });
  });

  describe("getById", () => {
    it("should return null for non-existent plan", () => {
      const result = repository.getById("nonexistent");

      expect(result).toBeNull();
    });

    it("should retrieve saved plan", () => {
      const plan = createTestPlan();
      repository.save(plan);

      const retrieved = repository.getById("test-plan-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("test-plan-1");
      expect(retrieved?.steps).toHaveLength(3);
    });
  });

  describe("updateStep", () => {
    it("should update step status", () => {
      const plan = createTestPlan();
      repository.save(plan);

      const result = repository.updateStep("test-plan-1", "step-1", "completed");

      expect(result?.steps[0].status).toBe("completed");
    });

    it("should update step with result", () => {
      const plan = createTestPlan();
      repository.save(plan);

      const stepResult = {
        success: true,
        output: "Done",
        artifacts: [],
        metrics: {
          startTime: Date.now(),
          tokensUsed: 50,
          toolCalls: 2,
          retryCount: 0,
        },
      };

      const result = repository.updateStep(
        "test-plan-1",
        "step-1",
        "completed",
        stepResult
      );

      expect(result?.steps[0].status).toBe("completed");
      expect(result?.steps[0].result?.output).toBe("Done");
      expect(result?.steps[0].result?.metrics.tokensUsed).toBe(50);
    });

    it("should update plan status based on steps", () => {
      const plan = createTestPlan();
      repository.save(plan);

      repository.updateStep("test-plan-1", "step-1", "completed");
      repository.updateStep("test-plan-1", "step-2", "completed");
      repository.updateStep("test-plan-1", "step-3", "completed");

      const finalPlan = repository.getById("test-plan-1");
      expect(finalPlan?.steps.every((s) => s.status === "completed")).toBe(true);
    });

    it("should set plan status to failed when step fails", () => {
      const plan = createTestPlan();
      repository.save(plan);

      repository.updateStep("test-plan-1", "step-1", "failed");

      const finalPlan = repository.getById("test-plan-1");
      expect(finalPlan?.steps[0].status).toBe("failed");
    });

    it("should throw for non-existent plan", () => {
      expect(() =>
        repository.updateStep("nonexistent", "step-1", "completed")
      ).toThrow(PlanError);
    });

    it("should throw for non-existent step", () => {
      const plan = createTestPlan();
      repository.save(plan);

      expect(() =>
        repository.updateStep("test-plan-1", "nonexistent", "completed")
      ).toThrow(PlanError);
    });
  });

  describe("getByStatus", () => {
    it("should return empty array for no matching plans", () => {
      const result = repository.getByStatus("completed");

      expect(result).toHaveLength(0);
    });

    it("should return plans with matching status", () => {
      const plan1 = createTestPlan();
      const plan2 = createExecutionPlan("test-plan-2", "Plan 2", [
        createPlanStep("a", "A"),
      ]);
      repository.save(plan1);
      repository.save(plan2);

      repository.updateStep("test-plan-1", "step-1", "completed");
      repository.updateStep("test-plan-1", "step-2", "completed");
      repository.updateStep("test-plan-1", "step-3", "completed");

      const completed = repository.getByStatus("completed");
      const pending = repository.getByStatus("pending");

      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe("test-plan-1");
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe("test-plan-2");
    });
  });

  describe("getAll", () => {
    it("should return empty array when no plans", () => {
      const result = repository.getAll();

      expect(result).toHaveLength(0);
    });

    it("should return all plans", () => {
      repository.save(createTestPlan());
      repository.save(
        createExecutionPlan("test-plan-2", "Plan 2", [createPlanStep("a", "A")])
      );

      const result = repository.getAll();

      expect(result).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("should delete existing plan", () => {
      const plan = createTestPlan();
      repository.save(plan);

      const deleted = repository.delete("test-plan-1");

      expect(deleted).toBe(true);
      expect(repository.getById("test-plan-1")).toBeNull();
    });

    it("should return false for non-existent plan", () => {
      const deleted = repository.delete("nonexistent");

      expect(deleted).toBe(false);
    });

    it("should delete associated steps", () => {
      const plan = createTestPlan();
      repository.save(plan);

      repository.delete("test-plan-1");

      const db = getDatabase(testDbPath);
      const steps = db
        .prepare("SELECT * FROM plan_steps WHERE plan_id = ?")
        .all("test-plan-1");

      expect(steps).toHaveLength(0);
    });
  });

  describe("updateStatus", () => {
    it("should update plan status", () => {
      const plan = createTestPlan();
      repository.save(plan);

      const result = repository.updateStatus("test-plan-1", "running");

      expect(result).not.toBeNull();
    });

    it("should return null for non-existent plan", () => {
      const result = repository.updateStatus("nonexistent", "running");

      expect(result).toBeNull();
    });
  });

  describe("getStepsByPlanId", () => {
    it("should return steps for existing plan", () => {
      const plan = createTestPlan();
      repository.save(plan);

      const steps = repository.getStepsByPlanId("test-plan-1");

      expect(steps).toHaveLength(3);
      expect(steps[0].id).toBe("step-1");
      expect(steps[1].dependencies).toEqual(["step-1"]);
    });

    it("should return empty array for non-existent plan", () => {
      const steps = repository.getStepsByPlanId("nonexistent");

      expect(steps).toHaveLength(0);
    });
  });

  describe("persistence", () => {
    it("should persist data across repository instances", () => {
      const plan = createTestPlan();
      repository.save(plan);

      const newRepository = new PlanRepository(getDatabase(testDbPath));
      const retrieved = newRepository.getById("test-plan-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("test-plan-1");
    });
  });
});
