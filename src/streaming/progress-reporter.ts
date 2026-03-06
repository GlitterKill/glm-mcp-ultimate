import type { FeedbackEvent, FeedbackEventType, ProgressFeedback, TokenUsageFeedback } from "../types/feedback.js";
import { getEventBus, type EventBus } from "./event-bus.js";

export interface ProgressReporterOptions {
  sessionId: string;
  planId?: string;
  stepId?: string;
  eventBus?: EventBus;
}

export interface ProgressState {
  currentStep: number;
  totalSteps: number;
  percent: number;
  message: string;
  tokensUsed: number;
  tokenBudget: number;
}

export class McpProgressReporter {
  private readonly eventBus: EventBus;
  private readonly sessionId: string;
  private readonly planId?: string;
  private currentStepId?: string;
  private state: ProgressState;

  constructor(options: ProgressReporterOptions) {
    this.eventBus = options.eventBus ?? getEventBus();
    this.sessionId = options.sessionId;
    this.planId = options.planId;
    this.currentStepId = options.stepId;
    this.state = {
      currentStep: 0,
      totalSteps: 0,
      percent: 0,
      message: "",
      tokensUsed: 0,
      tokenBudget: 0,
    };
  }

  reportProgress(
    percent: number,
    message: string,
    eta?: number
  ): ProgressFeedback {
    this.state.percent = Math.min(100, Math.max(0, percent));
    this.state.message = message;

    const payload: ProgressFeedback = {
      percent: this.state.percent,
      message,
      eta,
    };

    this.emit("step_progress", payload);
    return payload;
  }

  reportTokenUsage(
    promptTokens: number,
    completionTokens: number,
    remainingBudget: number
  ): TokenUsageFeedback {
    this.state.tokensUsed = promptTokens + completionTokens;
    this.state.tokenBudget = remainingBudget + this.state.tokensUsed;

    const payload: TokenUsageFeedback = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      remainingBudget,
    };

    this.emit("token_usage", payload);
    return payload;
  }

  reportError(error: Error | string, details?: Record<string, unknown>): void {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorName = error instanceof Error ? error.name : "Error";
    const errorStack = error instanceof Error ? error.stack : undefined;

    this.emit("session_error", {
      error: errorMessage,
      name: errorName,
      stack: errorStack,
      ...details,
    });
  }

  incrementStep(message?: string): number {
    this.state.currentStep += 1;
    
    if (this.state.totalSteps > 0) {
      this.state.percent = Math.round(
        (this.state.currentStep / this.state.totalSteps) * 100
      );
    }

    if (message) {
      this.state.message = message;
    }

    this.emit("step_progress", {
      percent: this.state.percent,
      message: message ?? this.state.message,
      currentStep: this.state.currentStep,
      totalSteps: this.state.totalSteps,
    });

    return this.state.currentStep;
  }

  setStepId(stepId: string): void {
    this.currentStepId = stepId;
  }

  setTotalSteps(total: number): void {
    this.state.totalSteps = total;
  }

  getState(): Readonly<ProgressState> {
    return { ...this.state };
  }

  reportToolCall(toolName: string, args: Record<string, unknown>): void {
    this.emit("tool_called", {
      toolName,
      args,
    });
  }

  reportToolResult(callId: string, result: string, isError?: boolean): void {
    this.emit("tool_result", {
      callId,
      result,
      isError: isError ?? false,
    });
  }

  reportStepStarted(stepId: string, description: string): void {
    this.currentStepId = stepId;
    this.emit("step_started", { stepId, description }, stepId);
  }

  reportStepCompleted(stepId: string, result?: unknown): void {
    this.emit("step_completed", { stepId, result }, stepId);
  }

  reportStepFailed(stepId: string, error: Error | string): void {
    const errorMessage = error instanceof Error ? error.message : error;
    this.emit("step_failed", { stepId, error: errorMessage }, stepId);
  }

  private emit(
    type: FeedbackEventType,
    payload: Record<string, unknown>,
    overrideStepId?: string
  ): void {
    const event: FeedbackEvent = {
      type,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      planId: this.planId,
      stepId: overrideStepId ?? this.currentStepId,
      payload,
    };

    this.eventBus.emit(event);
  }
}

export function createProgressReporter(
  options: ProgressReporterOptions
): McpProgressReporter {
  return new McpProgressReporter(options);
}
