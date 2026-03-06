import type {
  ExecutionPlan,
  PlanStep,
  StepResult,
  StepMetrics,
} from "../types/plan.js";
import {
  updateStepStatus,
  isPlanComplete,
  hasPlanFailed,
  getPlanProgress,
} from "../types/plan.js";
import type { FeedbackEvent } from "../types/feedback.js";
import type { EventBus } from "../streaming/event-bus.js";
import { getEventBus } from "../streaming/event-bus.js";
import { getExecutionOrder, getParallelGroups } from "./parser.js";
import {
  GlmMcpError,
  PlanError,
  RateLimitError,
  isRetryable,
  getRetryDelay,
} from "../errors/index.js";
import { Logger, getLogger } from "../util/logger.js";

export interface ExecutorOptions {
  eventBus?: EventBus;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  logger?: Logger;
}

export interface ExecutorState {
  plan: ExecutionPlan;
  currentStepId: string | null;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  startTime: number;
  retryCount: number;
}

export interface StepExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  tokensUsed: number;
  toolCalls: number;
  retryCount?: number;
}

export type StepExecutor = (
  step: PlanStep,
  context: ExecutorContext
) => Promise<StepExecutionResult>;

export interface ExecutorContext {
  plan: ExecutionPlan;
  sessionId: string;
  tokenBudget: number;
  tokensRemaining: number;
}

export class PlanExecutor {
  private readonly eventBus: EventBus;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly logger: Logger;
  private readonly stepExecutors: Map<string, StepExecutor> = new Map();
  private defaultExecutor?: StepExecutor;
  private state: ExecutorState | null = null;
  private aborted = false;

  constructor(options: ExecutorOptions = {}) {
    this.eventBus = options.eventBus ?? getEventBus();
    this.maxRetries = options.maxRetries ?? 3;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 1000;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30000;
    this.logger = options.logger ?? getLogger();
  }

  registerStepExecutor(stepId: string, executor: StepExecutor): void {
    this.stepExecutors.set(stepId, executor);
  }

  setDefaultExecutor(executor: StepExecutor): void {
    this.defaultExecutor = executor;
  }

  async execute(
    plan: ExecutionPlan,
    sessionId: string,
    options: {
      onProgress?: (progress: ReturnType<typeof getPlanProgress>) => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<ExecutionPlan> {
    this.aborted = false;
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        this.aborted = true;
      });
    }

    this.state = {
      plan,
      currentStepId: null,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      startTime: Date.now(),
      retryCount: 0,
    };

    this.emitEvent("session_started", sessionId, {
      planId: plan.id,
      totalSteps: plan.steps.length,
    });

    try {
      const executionOrder = getExecutionOrder(plan.steps);

      for (const stepId of executionOrder) {
        if (this.aborted) {
          this.state.plan = updateStepStatus(
            this.state.plan,
            stepId,
            "skipped"
          );
          continue;
        }

        const step = plan.steps.find((s) => s.id === stepId);
        if (!step) continue;

        if (step.status === "completed" || step.status === "skipped") {
          continue;
        }

        if (!this.checkDependencies(step)) {
          this.state.plan = updateStepStatus(
            this.state.plan,
            stepId,
            "skipped"
          );
          continue;
        }

        this.state.currentStepId = stepId;
        this.state.plan = updateStepStatus(this.state.plan, stepId, "running");

        this.emitEvent("step_started", sessionId, {
          stepId,
          description: step.description,
        });

        const result = await this.executeStepWithRetry(
          step,
          sessionId,
          options.onProgress
        );

        if (result.success) {
          this.state.plan = updateStepStatus(
            this.state.plan,
            stepId,
            "completed",
            this.createStepResult(result)
          );
          this.emitEvent("step_completed", sessionId, {
            stepId,
            output: result.output,
            tokensUsed: result.tokensUsed,
          });
        } else {
          this.state.plan = updateStepStatus(
            this.state.plan,
            stepId,
            "failed",
            this.createStepResult(result)
          );
          this.emitEvent("step_failed", sessionId, {
            stepId,
            error: result.error,
          });

          if (hasPlanFailed(this.state.plan)) {
            // Mark remaining steps as skipped
            const currentIndex = executionOrder.indexOf(stepId);
            for (let j = currentIndex + 1; j < executionOrder.length; j++) {
              const remId = executionOrder[j];
              const remStep = plan.steps.find(s => s.id === remId);
              if (remStep && remStep.status === "pending") {
                this.state.plan = updateStepStatus(
                  this.state.plan,
                  remId,
                  "skipped"
                );
              }
            }
            break;
          }
        }

        options.onProgress?.(getPlanProgress(this.state.plan));
      }

      const finalStatus = isPlanComplete(this.state.plan)
        ? "completed"
        : hasPlanFailed(this.state.plan)
          ? "failed"
          : "partial";

      this.emitEvent("session_completed", sessionId, {
        planId: this.state.plan.id,
        status: finalStatus,
        tokenUsage: this.state.tokenUsage,
        durationMs: Date.now() - this.state.startTime,
        progress: getPlanProgress(this.state.plan),
      });

      return this.state.plan;
    } catch (error) {
      this.emitEvent("session_error", sessionId, {
        planId: plan.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async executeParallel(
    plan: ExecutionPlan,
    sessionId: string,
    options: {
      maxParallel?: number;
      onProgress?: (progress: ReturnType<typeof getPlanProgress>) => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<ExecutionPlan> {
    this.aborted = false;
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        this.aborted = true;
      });
    }

    this.state = {
      plan,
      currentStepId: null,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      startTime: Date.now(),
      retryCount: 0,
    };

    const maxParallel = options.maxParallel ?? plan.budget.maxParallelSteps;

    this.emitEvent("session_started", sessionId, {
      planId: plan.id,
      totalSteps: plan.steps.length,
      parallelMode: true,
      maxParallel,
    });

    try {
      const parallelGroups = getParallelGroups(plan.steps);

      for (const group of parallelGroups) {
        if (this.aborted) {
          for (const stepId of group) {
            this.state.plan = updateStepStatus(
              this.state.plan,
              stepId,
              "skipped"
            );
          }
          continue;
        }

        const stepsToRun = group
          .map((id) => plan.steps.find((s) => s.id === id))
          .filter((s): s is PlanStep => s !== undefined)
          .filter((s) => s.status === "pending" && this.checkDependencies(s));

        const batch = stepsToRun.slice(0, maxParallel);

        const results = await Promise.all(
          batch.map((step) =>
            this.executeStepWithRetry(step, sessionId, options.onProgress)
          )
        );

        for (let i = 0; i < batch.length; i++) {
          const step = batch[i];
          const result = results[i];
          const newStatus = result.success ? "completed" : "failed";
          this.state.plan = updateStepStatus(
            this.state.plan,
            step.id,
            newStatus,
            this.createStepResult(result)
          );

          this.emitEvent(
            result.success ? "step_completed" : "step_failed",
            sessionId,
            {
              stepId: step.id,
              ...(result.success
                ? { output: result.output, tokensUsed: result.tokensUsed }
                : { error: result.error }),
            }
          );
        }

        options.onProgress?.(getPlanProgress(this.state.plan));
      }

      const finalStatus = isPlanComplete(this.state.plan)
        ? "completed"
        : hasPlanFailed(this.state.plan)
          ? "failed"
          : "partial";

      this.emitEvent("session_completed", sessionId, {
        planId: this.state.plan.id,
        status: finalStatus,
        tokenUsage: this.state.tokenUsage,
        durationMs: Date.now() - this.state.startTime,
        progress: getPlanProgress(this.state.plan),
      });

      return this.state.plan;
    } catch (error) {
      this.emitEvent("session_error", sessionId, {
        planId: plan.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  getState(): ExecutorState | null {
    return this.state;
  }

  abort(): void {
    this.aborted = true;
  }

  private async executeStepWithRetry(
    step: PlanStep,
    sessionId: string,
    onProgress?: (progress: ReturnType<typeof getPlanProgress>) => void
  ): Promise<StepExecutionResult> {
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      this.logger.debug(`Executing step ${step.id}, attempt ${attempt}, maxRetries ${this.maxRetries}`);
      if (this.aborted) {
        return {
          success: false,
          error: "Execution aborted",
          tokensUsed: 0,
          toolCalls: 0,
        };
      }

      try {
        const executor =
          this.stepExecutors.get(step.id) ?? this.defaultExecutor;

        if (!executor) {
          return {
            success: true,
            output: `Step "${step.description}" - no executor registered`,
            tokensUsed: 0,
            toolCalls: 0,
          };
        }

        const context: ExecutorContext = {
          plan: this.state!.plan,
          sessionId,
          tokenBudget: this.state!.plan.budget.maxTokens,
          tokensRemaining:
            this.state!.plan.budget.maxTokens - this.state!.tokenUsage.totalTokens,
        };

        const result = await executor(step, context);

        this.state!.tokenUsage.totalTokens += result.tokensUsed;

        this.emitEvent("token_usage", sessionId, {
          promptTokens: Math.floor(result.tokensUsed * 0.7),
          completionTokens: Math.floor(result.tokensUsed * 0.3),
          totalTokens: this.state!.tokenUsage.totalTokens,
          remainingBudget:
            this.state!.plan.budget.maxTokens - this.state!.tokenUsage.totalTokens,
        });

        return { ...result, retryCount: attempt };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (
          attempt < this.maxRetries &&
          (error instanceof RateLimitError ||
            (error instanceof GlmMcpError && isRetryable(error)))
        ) {
          attempt++;
          const delay = getRetryDelay(
            error,
            attempt,
            this.baseRetryDelayMs,
            this.maxRetryDelayMs
          );

          this.logger.warn(`Retrying step ${step.id} after ${delay}ms`, {
            attempt,
            maxRetries: this.maxRetries,
          });

          this.emitEvent("step_progress", sessionId, {
            stepId: step.id,
            message: `Retrying (attempt ${attempt}/${this.maxRetries})`,
            retryDelay: delay,
          });

          await this.sleep(delay);
          continue;
        }

        break;
      }
    }

    return {
      success: false,
      error: lastError?.message ?? "Unknown error",
      tokensUsed: 0,
      toolCalls: 0,
      retryCount: attempt,
    };
  }

  private checkDependencies(step: PlanStep): boolean {
    for (const depId of step.dependencies) {
      const dep = this.state!.plan.steps.find((s) => s.id === depId);
      if (dep && dep.status !== "completed" && dep.status !== "skipped") {
        return false;
      }
    }
    return true;
  }

  private createStepResult(execResult: StepExecutionResult): StepResult {
    const now = Date.now();
    return {
      success: execResult.success,
      output: execResult.output,
      error: execResult.error,
      artifacts: [],
      metrics: {
        startTime: now,
        endTime: now,
        durationMs: 0,
        tokensUsed: execResult.tokensUsed,
        toolCalls: execResult.toolCalls,
        retryCount: execResult.retryCount ?? 0,
      },
    };
  }

  private emitEvent(
    type: FeedbackEvent["type"],
    sessionId: string,
    payload: Record<string, unknown>
  ): void {
    this.eventBus.emitFeedback({
      type,
      timestamp: Date.now(),
      sessionId,
      planId: this.state?.plan.id,
      payload,
    } as FeedbackEvent);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
