export type ErrorCode =
  | "AUTH_INVALID_KEY"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_OAUTH_FAILED"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_LIMIT_REACHED"
  | "PLAN_NOT_FOUND"
  | "PLAN_INVALID_DEPENDENCY"
  | "PLAN_EXECUTION_FAILED"
  | "PLAN_BUDGET_EXCEEDED"
  | "TOOL_NOT_FOUND"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_TIMEOUT"
  | "SANDBOX_VIOLATION"
  | "SANDBOX_PATH_BLOCKED"
  | "SANDBOX_COMMAND_BLOCKED"
  | "STREAM_ERROR"
  | "RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class GlmMcpError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly cause?: Error,
    public readonly retryable: boolean = false,
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = "GlmMcpError";
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      cause: this.cause?.message,
    };
  }
}

export class AuthError extends GlmMcpError {
  constructor(
    code: Extract<
      ErrorCode,
      "AUTH_INVALID_KEY" | "AUTH_TOKEN_EXPIRED" | "AUTH_OAUTH_FAILED"
    >,
    message: string,
    cause?: Error
  ) {
    super(code, message, cause, false);
    this.name = "AuthError";
  }
}

export class SessionError extends GlmMcpError {
  constructor(
    code: Extract<
      ErrorCode,
      "SESSION_NOT_FOUND" | "SESSION_EXPIRED" | "SESSION_LIMIT_REACHED"
    >,
    message: string,
    cause?: Error
  ) {
    super(
      code,
      message,
      cause,
      code === "SESSION_LIMIT_REACHED"
    );
    this.name = "SessionError";
  }
}

export class PlanError extends GlmMcpError {
  constructor(
    code: Extract<
      ErrorCode,
      | "PLAN_NOT_FOUND"
      | "PLAN_INVALID_DEPENDENCY"
      | "PLAN_EXECUTION_FAILED"
      | "PLAN_BUDGET_EXCEEDED"
    >,
    message: string,
    cause?: Error
  ) {
    super(code, message, cause, code === "PLAN_EXECUTION_FAILED");
    this.name = "PlanError";
  }
}

export class ToolError extends GlmMcpError {
  constructor(
    code: Extract<
      ErrorCode,
      "TOOL_NOT_FOUND" | "TOOL_EXECUTION_FAILED" | "TOOL_TIMEOUT"
    >,
    message: string,
    cause?: Error
  ) {
    super(
      code,
      message,
      cause,
      code === "TOOL_TIMEOUT" || code === "TOOL_EXECUTION_FAILED"
    );
    this.name = "ToolError";
  }
}

export class SandboxError extends GlmMcpError {
  constructor(
    code: Extract<
      ErrorCode,
      "SANDBOX_VIOLATION" | "SANDBOX_PATH_BLOCKED" | "SANDBOX_COMMAND_BLOCKED"
    >,
    message: string,
    cause?: Error
  ) {
    super(code, message, cause, false);
    this.name = "SandboxError";
  }
}

export class StreamError extends GlmMcpError {
  constructor(message: string, cause?: Error, retryAfter?: number) {
    super("STREAM_ERROR", message, cause, true, retryAfter);
    this.name = "StreamError";
  }
}

export class RateLimitError extends GlmMcpError {
  constructor(retryAfter: number, message: string = "Rate limited") {
    super("RATE_LIMITED", message, undefined, true, retryAfter);
    this.name = "RateLimitError";
  }
}

export function isRetryable(error: Error): boolean {
  if (error instanceof GlmMcpError) {
    return error.retryable;
  }
  return false;
}

export function getRetryDelay(
  error: Error,
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000
): number {
  if (error instanceof GlmMcpError && error.retryAfter) {
    return error.retryAfter * 1000;
  }
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.1 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

export function isGlmMcpError(error: unknown): error is GlmMcpError {
  return error instanceof GlmMcpError;
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export function isSessionError(error: unknown): error is SessionError {
  return error instanceof SessionError;
}

export function isPlanError(error: unknown): error is PlanError {
  return error instanceof PlanError;
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}

export function isSandboxError(error: unknown): error is SandboxError {
  return error instanceof SandboxError;
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}
