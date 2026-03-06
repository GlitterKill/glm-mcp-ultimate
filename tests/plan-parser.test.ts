import { describe, it, expect, beforeEach } from "vitest";
import {
  parsePlan,
  parsePlanFromText,
  validateDependencies,
  detectCycles,
  getExecutionOrder,
  getParallelGroups,
  type RawPlanInput,
} from "../src/plan/parser.js";
import type { PlanStep } from "../src/types/plan.js";
import { createPlanStep } from "../src/types/plan.js";
import { PlanError } from "../src/errors/index.js";

describe("Plan Parser", () => {
  describe("parsePlan", () => {
    it("should parse a simple plan with one step", () => {
      const input: RawPlanInput = {
        description: "Simple plan",
        steps: [{ id: "step-1", description: "Do something" }],
      };

      const result = parsePlan(input);

      expect(result.plan.description).toBe("Simple plan");
      expect(result.plan.steps).toHaveLength(1);
      expect(result.plan.steps[0].id).toBe("step-1");
      expect(result.plan.steps[0].status).toBe("pending");
      expect(result.plan.metadata.source).toBe("user");
      expect(result.plan.budget.maxTokens).toBe(100000);
    });

    it("should parse a plan with dependencies", () => {
      const input: RawPlanInput = {
        description: "Plan with dependencies",
        steps: [
          { id: "step-1", description: "First" },
          { id: "step-2", description: "Second", dependencies: ["step-1"] },
          { id: "step-3", description: "Third", dependencies: ["step-1", "step-2"] },
        ],
      };

      const result = parsePlan(input);

      expect(result.plan.steps).toHaveLength(3);
      expect(result.plan.steps[0].dependencies).toEqual([]);
      expect(result.plan.steps[1].dependencies).toEqual(["step-1"]);
      expect(result.plan.steps[2].dependencies).toEqual(["step-1", "step-2"]);
    });

    it("should use provided plan id", () => {
      const input: RawPlanInput = {
        id: "custom-plan-id",
        description: "Custom plan",
        steps: [{ id: "s1", description: "Step" }],
      };

      const result = parsePlan(input);

      expect(result.plan.id).toBe("custom-plan-id");
    });

    it("should generate plan id if not provided", () => {
      const input: RawPlanInput = {
        description: "Auto ID plan",
        steps: [{ id: "s1", description: "Step" }],
      };

      const result = parsePlan(input);

      expect(result.plan.id).toMatch(/^plan-/);
    });

    it("should apply custom metadata", () => {
      const input: RawPlanInput = {
        description: "Custom metadata",
        steps: [{ id: "s1", description: "Step" }],
        metadata: {
          source: "generated",
          priority: "high",
          tags: ["urgent"],
        },
      };

      const result = parsePlan(input);

      expect(result.plan.metadata.source).toBe("generated");
      expect(result.plan.metadata.priority).toBe("high");
      expect(result.plan.metadata.tags).toEqual(["urgent"]);
    });

    it("should apply custom budget", () => {
      const input: RawPlanInput = {
        description: "Custom budget",
        steps: [{ id: "s1", description: "Step" }],
        budget: {
          maxTokens: 50000,
          maxSteps: 10,
          maxDurationMs: 60000,
          maxParallelSteps: 2,
        },
      };

      const result = parsePlan(input);

      expect(result.plan.budget.maxTokens).toBe(50000);
      expect(result.plan.budget.maxSteps).toBe(10);
      expect(result.plan.budget.maxDurationMs).toBe(60000);
      expect(result.plan.budget.maxParallelSteps).toBe(2);
    });

    it("should throw for empty description", () => {
      const input: RawPlanInput = {
        description: "",
        steps: [{ id: "s1", description: "Step" }],
      };

      expect(() => parsePlan(input)).toThrow(PlanError);
    });

    it("should throw for empty steps", () => {
      const input: RawPlanInput = {
        description: "No steps",
        steps: [],
      };

      expect(() => parsePlan(input)).toThrow(PlanError);
    });

    it("should throw for duplicate step ids", () => {
      const input: RawPlanInput = {
        description: "Duplicate IDs",
        steps: [
          { id: "step-1", description: "First" },
          { id: "step-1", description: "Second" },
        ],
      };

      expect(() => parsePlan(input)).toThrow(PlanError);
    });

    it("should throw for self-referencing dependency", () => {
      const input: RawPlanInput = {
        description: "Self reference",
        steps: [{ id: "step-1", description: "Self", dependencies: ["step-1"] }],
      };

      expect(() => parsePlan(input)).toThrow(PlanError);
    });

    it("should throw for missing dependency", () => {
      const input: RawPlanInput = {
        description: "Missing dep",
        steps: [{ id: "step-1", description: "Step", dependencies: ["nonexistent"] }],
      };

      expect(() => parsePlan(input)).toThrow(PlanError);
    });

    it("should throw for circular dependency", () => {
      const input: RawPlanInput = {
        description: "Circular",
        steps: [
          { id: "a", description: "A", dependencies: ["b"] },
          { id: "b", description: "B", dependencies: ["a"] },
        ],
      };

      expect(() => parsePlan(input)).toThrow(PlanError);
    });

    it("should warn about isolated steps", () => {
      const input: RawPlanInput = {
        description: "Isolated",
        steps: [
          { id: "step-1", description: "First" },
          { id: "step-2", description: "Second" },
        ],
      };

      const result = parsePlan(input);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("no dependencies"))).toBe(true);
    });

    it("should throw for empty step id", () => {
      const input: RawPlanInput = {
        description: "Empty ID",
        steps: [{ id: "", description: "Step" }],
      };

      expect(() => parsePlan(input)).toThrow(PlanError);
    });
  });

  describe("parsePlanFromText", () => {
    it("should parse markdown-style plan", () => {
      const text = `# My Plan
1. First step
2. Second step [step-1]
3. Third step [step-1, step-2]`;

      const result = parsePlanFromText(text);

      expect(result.plan.description).toBe("My Plan");
      expect(result.plan.steps).toHaveLength(3);
      expect(result.plan.steps[0].id).toBe("step-1");
      expect(result.plan.steps[2].dependencies).toEqual(["step-1", "step-2"]);
    });

    it("should parse plan without header", () => {
      const text = `1. First step
2. Second step`;

      const result = parsePlanFromText(text);

      expect(result.plan.description).toBe("Parsed plan");
      expect(result.plan.steps).toHaveLength(2);
    });

    it("should handle steps without numbers", () => {
      const text = `# Plan
First step
Second step`;

      const result = parsePlanFromText(text);

      expect(result.plan.steps).toHaveLength(2);
    });

    it("should skip comments and empty lines", () => {
      const text = `# Plan
# This is a comment

1. Real step

2. Another step`;

      const result = parsePlanFromText(text);

      expect(result.plan.steps).toHaveLength(2);
    });

    it("should throw for empty text", () => {
      expect(() => parsePlanFromText("")).toThrow(PlanError);
    });

    it("should throw for text with no valid steps", () => {
      const text = `# Plan
# Just comments`;
      expect(() => parsePlanFromText(text)).toThrow(PlanError);
    });
  });

  describe("validateDependencies", () => {
    it("should return valid for correct dependencies", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A"),
        createPlanStep("b", "B", ["a"]),
        createPlanStep("c", "C", ["a", "b"]),
      ];

      const result = validateDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing dependency", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A"),
        createPlanStep("b", "B", ["nonexistent"]),
      ];

      const result = validateDependencies(steps);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("non-existent"))).toBe(true);
    });

    it("should warn about isolated steps", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A"),
        createPlanStep("b", "B"),
      ];

      const result = validateDependencies(steps);

      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("detectCycles", () => {
    it("should return no cycles for acyclic graph", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A"),
        createPlanStep("b", "B", ["a"]),
        createPlanStep("c", "C", ["b"]),
      ];

      const result = detectCycles(steps);

      expect(result.cycles).toHaveLength(0);
    });

    it("should detect simple cycle", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A", ["b"]),
        createPlanStep("b", "B", ["a"]),
      ];

      const result = detectCycles(steps);

      expect(result.cycles.length).toBeGreaterThan(0);
      expect(result.cycles[0]).toContain("Circular dependency");
    });

    it("should detect longer cycle", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A", ["c"]),
        createPlanStep("b", "B", ["a"]),
        createPlanStep("c", "C", ["b"]),
      ];

      const result = detectCycles(steps);

      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it("should detect self-cycle", () => {
      const steps: PlanStep[] = [createPlanStep("a", "A", ["a"])];

      const result = detectCycles(steps);

      expect(result.cycles.length).toBeGreaterThan(0);
    });
  });

  describe("getExecutionOrder", () => {
    it("should return correct order for simple chain", () => {
      const steps: PlanStep[] = [
        createPlanStep("c", "C", ["b"]),
        createPlanStep("a", "A"),
        createPlanStep("b", "B", ["a"]),
      ];

      const order = getExecutionOrder(steps);

      expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    });

    it("should handle independent steps", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A"),
        createPlanStep("b", "B"),
        createPlanStep("c", "C"),
      ];

      const order = getExecutionOrder(steps);

      expect(order).toHaveLength(3);
      expect(order).toContain("a");
      expect(order).toContain("b");
      expect(order).toContain("c");
    });

    it("should handle diamond dependency", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A"),
        createPlanStep("b", "B", ["a"]),
        createPlanStep("c", "C", ["a"]),
        createPlanStep("d", "D", ["b", "c"]),
      ];

      const order = getExecutionOrder(steps);

      expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
      expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
    });

    it("should throw for circular dependency", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A", ["b"]),
        createPlanStep("b", "B", ["a"]),
      ];

      expect(() => getExecutionOrder(steps)).toThrow(PlanError);
    });
  });

  describe("getParallelGroups", () => {
    it("should group independent steps together", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A"),
        createPlanStep("b", "B"),
        createPlanStep("c", "C"),
      ];

      const groups = getParallelGroups(steps);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(3);
    });

    it("should respect dependencies", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A"),
        createPlanStep("b", "B", ["a"]),
        createPlanStep("c", "C", ["a"]),
        createPlanStep("d", "D", ["b", "c"]),
      ];

      const groups = getParallelGroups(steps);

      expect(groups).toHaveLength(3);
      expect(groups[0]).toEqual(["a"]);
      expect(groups[1].sort()).toEqual(["b", "c"]);
      expect(groups[2]).toEqual(["d"]);
    });

    it("should handle chain", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A"),
        createPlanStep("b", "B", ["a"]),
        createPlanStep("c", "C", ["b"]),
      ];

      const groups = getParallelGroups(steps);

      expect(groups).toHaveLength(3);
      expect(groups[0]).toEqual(["a"]);
      expect(groups[1]).toEqual(["b"]);
      expect(groups[2]).toEqual(["c"]);
    });

    it("should handle external dependencies (non-existent in step list)", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A", ["external-step"]),
      ];

      const groups = getParallelGroups(steps);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual(["a"]);
    });

    it("should throw for circular dependencies in parallel groups", () => {
      const steps: PlanStep[] = [
        createPlanStep("a", "A", ["b"]),
        createPlanStep("b", "B", ["a"]),
      ];

      expect(() => getParallelGroups(steps)).toThrow(PlanError);
    });
  });
});
