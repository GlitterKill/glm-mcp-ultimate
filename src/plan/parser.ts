import type {
  ExecutionPlan,
  PlanStep,
  PlanMetadata,
  PlanBudget,
} from "../types/plan.js";
import {
  createPlanStep,
  createExecutionPlan,
} from "../types/plan.js";
import { PlanError } from "../errors/index.js";

export interface RawPlanInput {
  id?: string;
  description: string;
  steps: RawStepInput[];
  metadata?: Partial<PlanMetadata>;
  budget?: Partial<PlanBudget>;
}

export interface RawStepInput {
  id: string;
  description: string;
  dependencies?: string[];
  assignedAgent?: string;
}

export interface ParseResult {
  plan: ExecutionPlan;
  warnings: string[];
}

export interface DependencyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function generatePlanId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function validateDependencies(
  steps: PlanStep[]
): DependencyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stepIds = new Set(steps.map((s) => s.id));

  for (const step of steps) {
    for (const dep of step.dependencies) {
      if (!stepIds.has(dep)) {
        errors.push(`Step "${step.id}" depends on non-existent step "${dep}"`);
      }
    }
  }

  const cycleResult = detectCycles(steps);
  errors.push(...cycleResult.cycles);

  for (const step of steps) {
    if (step.dependencies.length === 0 && steps.length > 1) {
      const dependentCount = steps.filter((s) =>
        s.dependencies.includes(step.id)
      ).length;
      if (dependentCount === 0) {
        warnings.push(
          `Step "${step.id}" has no dependencies and nothing depends on it`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function detectCycles(steps: PlanStep[]): { cycles: string[] } {
  const cycles: string[] = [];
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(stepId: string, path: string[]): boolean {
    if (recursionStack.has(stepId)) {
      const cycleStart = path.indexOf(stepId);
      const cycle = path.slice(cycleStart).concat(stepId);
      cycles.push(`Circular dependency detected: ${cycle.join(" -> ")}`);
      return true;
    }

    if (visited.has(stepId)) {
      return false;
    }

    visited.add(stepId);
    recursionStack.add(stepId);
    path.push(stepId);

    const step = stepMap.get(stepId);
    if (step) {
      for (const dep of step.dependencies) {
        if (dfs(dep, [...path])) {
          // Continue to find all cycles
        }
      }
    }

    recursionStack.delete(stepId);
    return false;
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      dfs(step.id, []);
    }
  }

  return { cycles };
}

export function getExecutionOrder(steps: PlanStep[]): string[] {
  const result: string[] = [];
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(stepId: string): void {
    if (visited.has(stepId)) {
      return;
    }

    if (visiting.has(stepId)) {
      throw new PlanError(
        "PLAN_INVALID_DEPENDENCY",
        `Circular dependency detected at step "${stepId}"`
      );
    }

    visiting.add(stepId);
    const step = stepMap.get(stepId);

    if (step) {
      for (const dep of step.dependencies) {
        if (stepMap.has(dep)) {
          visit(dep);
        }
      }
    }

    visiting.delete(stepId);
    visited.add(stepId);
    result.push(stepId);
  }

  for (const step of steps) {
    visit(step.id);
  }

  return result;
}

export function parsePlan(input: RawPlanInput): ParseResult {
  const warnings: string[] = [];

  if (!input.description || input.description.trim() === "") {
    throw new PlanError(
      "PLAN_INVALID_DEPENDENCY",
      "Plan description is required"
    );
  }

  if (!input.steps || input.steps.length === 0) {
    throw new PlanError(
      "PLAN_INVALID_DEPENDENCY",
      "Plan must have at least one step"
    );
  }

  const stepIds = new Set<string>();
  for (const rawStep of input.steps) {
    if (!rawStep.id || rawStep.id.trim() === "") {
      throw new PlanError(
        "PLAN_INVALID_DEPENDENCY",
        "Each step must have a valid id"
      );
    }
    if (stepIds.has(rawStep.id)) {
      throw new PlanError(
        "PLAN_INVALID_DEPENDENCY",
        `Duplicate step id: "${rawStep.id}"`
      );
    }
    stepIds.add(rawStep.id);
  }

  const steps: PlanStep[] = input.steps.map((rawStep) =>
    createPlanStep(
      rawStep.id,
      rawStep.description,
      rawStep.dependencies ?? [],
    )
  );

  for (const step of steps) {
    if (step.dependencies.includes(step.id)) {
      throw new PlanError(
        "PLAN_INVALID_DEPENDENCY",
        `Step "${step.id}" cannot depend on itself`
      );
    }
  }

  const validation = validateDependencies(steps);
  if (!validation.valid) {
    throw new PlanError(
      "PLAN_INVALID_DEPENDENCY",
      `Invalid dependencies: ${validation.errors.join("; ")}`
    );
  }
  warnings.push(...validation.warnings);

  const planId = input.id ?? generatePlanId();
  const plan = createExecutionPlan(planId, input.description, steps, {
    ...input.metadata,
    ...input.budget,
  });

  return { plan, warnings };
}

export function parsePlanFromText(text: string): ParseResult {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  
  if (lines.length === 0) {
    throw new PlanError(
      "PLAN_INVALID_DEPENDENCY",
      "Plan text cannot be empty"
    );
  }

  const descriptionLine = lines[0];
  const descriptionMatch = descriptionLine.match(/^#\s*(.+)$/);
  const description = descriptionMatch
    ? descriptionMatch[1]
    : "Parsed plan";

  const stepRegex = /^(\d+\.?\s*)?(.+?)(?:\s*\[(.+?)\])?$/;
  const steps: RawStepInput[] = [];
  let stepCounter = 0;

  for (let i = descriptionMatch ? 1 : 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#") || line === "") {
      continue;
    }

    const match = line.match(stepRegex);
    if (match) {
      stepCounter++;
      const stepId = `step-${stepCounter}`;
      const stepDescription = match[2].trim();
      const depString = match[3];
      const dependencies = depString
        ? depString.split(",").map((d) => d.trim())
        : [];

      steps.push({
        id: stepId,
        description: stepDescription,
        dependencies,
      });
    }
  }

  if (steps.length === 0) {
    throw new PlanError(
      "PLAN_INVALID_DEPENDENCY",
      "No valid steps found in plan text"
    );
  }

  return parsePlan({ description, steps });
}

export function getParallelGroups(steps: PlanStep[]): string[][] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const completed = new Set<string>();
  const groups: string[][] = [];

  while (completed.size < steps.length) {
    const ready: string[] = [];

    for (const step of steps) {
      if (completed.has(step.id)) {
        continue;
      }

      const allDepsComplete = step.dependencies.every(
        (dep) =>
          completed.has(dep) || !stepMap.has(dep)
      );

      if (allDepsComplete) {
        ready.push(step.id);
      }
    }

    if (ready.length === 0) {
      const remaining = steps.filter((s) => !completed.has(s.id));
      throw new PlanError(
        "PLAN_INVALID_DEPENDENCY",
        `Unable to make progress. Remaining steps: ${remaining
          .map((s) => s.id)
          .join(", ")}`
      );
    }

    groups.push(ready);
    ready.forEach((id) => completed.add(id));
  }

  return groups;
}
