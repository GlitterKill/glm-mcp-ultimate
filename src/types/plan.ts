export interface PlanMetadata {
  source: "user" | "parsed" | "generated";
  model?: string;
  parentPlanId?: string;
  tags: string[];
  priority: "low" | "normal" | "high" | "critical";
}

export interface PlanBudget {
  maxTokens: number;
  maxSteps: number;
  maxDurationMs: number;
  maxParallelSteps: number;
}

export interface Artifact {
  id: string;
  type: "file" | "code" | "data" | "log" | "result";
  name: string;
  content: string;
  mimeType?: string;
  path?: string;
  createdAt: number;
}

export interface StepMetrics {
  startTime: number;
  endTime?: number;
  durationMs?: number;
  tokensUsed: number;
  toolCalls: number;
  retryCount: number;
}

export interface StepResult {
  success: boolean;
  output?: string;
  error?: string;
  artifacts: Artifact[];
  metrics: StepMetrics;
}

export interface PlanStep {
  id: string;
  description: string;
  dependencies: string[];
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  assignedAgent?: string;
  result?: StepResult;
}

export interface ExecutionPlan {
  id: string;
  description: string;
  steps: PlanStep[];
  metadata: PlanMetadata;
  budget: PlanBudget;
  createdAt: number;
  updatedAt: number;
}

export function createPlanStep(
  id: string,
  description: string,
  dependencies: string[] = []
): PlanStep {
  return {
    id,
    description,
    dependencies,
    status: "pending",
  };
}

export function createExecutionPlan(
  id: string,
  description: string,
  steps: PlanStep[],
  options: Partial<PlanMetadata> & Partial<PlanBudget> = {}
): ExecutionPlan {
  const now = Date.now();
  return {
    id,
    description,
    steps,
    metadata: {
      source: options.source ?? "user",
      model: options.model,
      parentPlanId: options.parentPlanId,
      tags: options.tags ?? [],
      priority: options.priority ?? "normal",
    },
    budget: {
      maxTokens: options.maxTokens ?? 100000,
      maxSteps: options.maxSteps ?? 100,
      maxDurationMs: options.maxDurationMs ?? 300000,
      maxParallelSteps: options.maxParallelSteps ?? 4,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function getReadySteps(plan: ExecutionPlan): PlanStep[] {
  const completedIds = new Set(
    plan.steps.filter((s) => s.status === "completed").map((s) => s.id)
  );
  return plan.steps.filter(
    (s) =>
      s.status === "pending" &&
      s.dependencies.every((d) => completedIds.has(d))
  );
}

export function getStepById(plan: ExecutionPlan, stepId: string): PlanStep | undefined {
  return plan.steps.find((s) => s.id === stepId);
}

export function updateStepStatus(
  plan: ExecutionPlan,
  stepId: string,
  status: PlanStep["status"],
  result?: StepResult
): ExecutionPlan {
  return {
    ...plan,
    steps: plan.steps.map((s) =>
      s.id === stepId ? { ...s, status, result } : s
    ),
    updatedAt: Date.now(),
  };
}

export function isPlanComplete(plan: ExecutionPlan): boolean {
  return plan.steps.every(
    (s) => s.status === "completed" || s.status === "skipped"
  );
}

export function hasPlanFailed(plan: ExecutionPlan): boolean {
  return plan.steps.some((s) => s.status === "failed");
}

export function getPlanProgress(plan: ExecutionPlan): {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  running: number;
} {
  return {
    total: plan.steps.length,
    completed: plan.steps.filter((s) => s.status === "completed").length,
    failed: plan.steps.filter((s) => s.status === "failed").length,
    pending: plan.steps.filter((s) => s.status === "pending").length,
    running: plan.steps.filter((s) => s.status === "running").length,
  };
}
