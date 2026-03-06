export type FeedbackEventType =
  | "session_started"
  | "session_completed"
  | "session_error"
  | "step_started"
  | "step_progress"
  | "step_completed"
  | "step_failed"
  | "tool_called"
  | "tool_result"
  | "token_usage"
  | "checkpoint_created"
  | "agent_spawned";

export interface FeedbackEvent {
  type: FeedbackEventType;
  timestamp: number;
  sessionId: string;
  planId?: string;
  stepId?: string;
  payload: Record<string, unknown>;
}

export interface ProgressFeedback {
  percent: number;
  message: string;
  eta?: number;
}

export interface TokenUsageFeedback {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  remainingBudget: number;
}

export interface ConfidenceFeedback {
  score: number;
  reason?: string;
}

export interface CheckpointFeedback {
  checkpointId: string;
  stepId: string;
  state: Record<string, unknown>;
  canRollback: boolean;
}

export function createFeedbackEvent(
  type: FeedbackEventType,
  sessionId: string,
  payload: Record<string, unknown>,
  options: { planId?: string; stepId?: string } = {}
): FeedbackEvent {
  return {
    type,
    timestamp: Date.now(),
    sessionId,
    planId: options.planId,
    stepId: options.stepId,
    payload,
  };
}

export function createProgressFeedback(
  percent: number,
  message: string,
  eta?: number
): ProgressFeedback {
  return { percent, message, eta };
}

export function createTokenUsageFeedback(
  promptTokens: number,
  completionTokens: number,
  remainingBudget: number
): TokenUsageFeedback {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    remainingBudget,
  };
}

export function createConfidenceFeedback(
  score: number,
  reason?: string
): ConfidenceFeedback {
  return { score, reason };
}

export function createCheckpointFeedback(
  checkpointId: string,
  stepId: string,
  state: Record<string, unknown>,
  canRollback: boolean = true
): CheckpointFeedback {
  return { checkpointId, stepId, state, canRollback };
}

export function isProgressFeedback(event: FeedbackEvent): boolean {
  return event.type === "step_progress";
}

export function isTokenUsageFeedback(event: FeedbackEvent): boolean {
  return event.type === "token_usage";
}

export function isCheckpointFeedback(event: FeedbackEvent): boolean {
  return event.type === "checkpoint_created";
}

export function isErrorFeedback(event: FeedbackEvent): boolean {
  return (
    event.type === "session_error" ||
    event.type === "step_failed"
  );
}
