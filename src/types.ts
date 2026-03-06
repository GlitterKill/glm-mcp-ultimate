export interface GlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: GlmToolCall[];
  tool_call_id?: string;
}

export interface GlmToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface GlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface GlmChatRequest {
  model: string;
  messages: GlmMessage[];
  tools?: GlmTool[];
  tool_choice?: "auto" | "none";
  temperature?: number;
  max_tokens?: number;
}

export interface GlmChatResponse {
  id: string;
  choices: {
    index: number;
    message: GlmMessage;
    finish_reason: "stop" | "tool_calls" | "length";
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface Checkpoint {
  id: string;
  stepId: string;
  timestamp: number;
  state: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  budgetRemaining?: number;
}

export interface AgentSession {
  id: string;
  task: string;
  workingDir: string;
  model: string;
  messages: GlmMessage[];
  status: "ready" | "running" | "completed" | "error";
  steps: AgentStep[];
  checkpoints?: Checkpoint[];
  tokenUsage?: TokenUsage;
  planId?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface AgentStep {
  action: string;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
}

export type {
  PlanStep,
  ExecutionPlan,
  PlanMetadata,
  PlanBudget,
  StepResult,
  Artifact,
  StepMetrics,
} from "./types/plan.js";

export type {
  FeedbackEvent,
  FeedbackEventType,
  ProgressFeedback,
  TokenUsageFeedback,
  ConfidenceFeedback,
  CheckpointFeedback,
} from "./types/feedback.js";

export type {
  StreamChunk,
  StreamOptions,
} from "./types/streaming.js";

export {
  createPlanStep,
  createExecutionPlan,
  getReadySteps,
  getStepById,
  updateStepStatus,
  isPlanComplete,
  hasPlanFailed,
  getPlanProgress,
} from "./types/plan.js";

export {
  createFeedbackEvent,
  createProgressFeedback,
  createTokenUsageFeedback,
  createConfidenceFeedback,
  createCheckpointFeedback,
  isProgressFeedback,
  isTokenUsageFeedback,
  isCheckpointFeedback,
  isErrorFeedback,
} from "./types/feedback.js";

export {
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
} from "./types/streaming.js";
