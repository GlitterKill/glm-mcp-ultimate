import { describe, it, expect } from "vitest";
import {
  GlmMcpError,
  AuthError,
  SessionError,
  PlanError,
  ToolError,
  SandboxError,
  StreamError,
  RateLimitError,
  isRetryable,
  getRetryDelay,
  isGlmMcpError,
  isAuthError,
  isSessionError,
  isPlanError,
  isToolError,
  isSandboxError,
  isRateLimitError,
} from "../src/errors/index.js";

describe("Error Classes", () => {
  describe("GlmMcpError", () => {
    it("should create base error with all properties", () => {
      const cause = new Error("Original error");
      const error = new GlmMcpError("INTERNAL_ERROR", "Something went wrong", cause, true, 5000);
      
      expect(error.name).toBe("GlmMcpError");
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.message).toBe("Something went wrong");
      expect(error.cause).toBe(cause);
      expect(error.retryable).toBe(true);
      expect(error.retryAfter).toBe(5000);
    });

    it("should serialize to JSON correctly", () => {
      const cause = new Error("Root cause");
      const error = new GlmMcpError("AUTH_INVALID_KEY", "Invalid API key", cause);
      const json = error.toJSON();
      
      expect(json).toEqual({
        name: "GlmMcpError",
        code: "AUTH_INVALID_KEY",
        message: "Invalid API key",
        retryable: false,
        retryAfter: undefined,
        cause: "Root cause",
      });
    });
  });

  describe("AuthError", () => {
    it("should create auth error with correct code", () => {
      const error = new AuthError("AUTH_INVALID_KEY", "Invalid API key");
      expect(error.name).toBe("AuthError");
      expect(error.code).toBe("AUTH_INVALID_KEY");
      expect(error.retryable).toBe(false);
    });

    it("should create token expired error", () => {
      const error = new AuthError("AUTH_TOKEN_EXPIRED", "Token has expired");
      expect(error.code).toBe("AUTH_TOKEN_EXPIRED");
    });
  });

  describe("SessionError", () => {
    it("should create session not found error", () => {
      const error = new SessionError("SESSION_NOT_FOUND", "Session not found");
      expect(error.name).toBe("SessionError");
      expect(error.code).toBe("SESSION_NOT_FOUND");
      expect(error.retryable).toBe(false);
    });

    it("should create session limit reached error as retryable", () => {
      const error = new SessionError("SESSION_LIMIT_REACHED", "Limit reached");
      expect(error.retryable).toBe(true);
    });
  });

  describe("PlanError", () => {
    it("should create plan not found error", () => {
      const error = new PlanError("PLAN_NOT_FOUND", "Plan not found");
      expect(error.name).toBe("PlanError");
      expect(error.code).toBe("PLAN_NOT_FOUND");
      expect(error.retryable).toBe(false);
    });

    it("should create plan execution failed error as retryable", () => {
      const error = new PlanError("PLAN_EXECUTION_FAILED", "Execution failed");
      expect(error.retryable).toBe(true);
    });

    it("should create invalid dependency error", () => {
      const error = new PlanError("PLAN_INVALID_DEPENDENCY", "Invalid dependency");
      expect(error.code).toBe("PLAN_INVALID_DEPENDENCY");
    });
  });

  describe("ToolError", () => {
    it("should create tool not found error", () => {
      const error = new ToolError("TOOL_NOT_FOUND", "Tool not found");
      expect(error.name).toBe("ToolError");
      expect(error.code).toBe("TOOL_NOT_FOUND");
      expect(error.retryable).toBe(false);
    });

    it("should create tool timeout error as retryable", () => {
      const error = new ToolError("TOOL_TIMEOUT", "Tool timed out");
      expect(error.retryable).toBe(true);
    });

    it("should create tool execution failed error as retryable", () => {
      const error = new ToolError("TOOL_EXECUTION_FAILED", "Execution failed");
      expect(error.retryable).toBe(true);
    });
  });

  describe("SandboxError", () => {
    it("should create sandbox violation error", () => {
      const error = new SandboxError("SANDBOX_VIOLATION", "Sandbox violation");
      expect(error.name).toBe("SandboxError");
      expect(error.code).toBe("SANDBOX_VIOLATION");
      expect(error.retryable).toBe(false);
    });

    it("should create path blocked error", () => {
      const error = new SandboxError("SANDBOX_PATH_BLOCKED", "Path blocked");
      expect(error.code).toBe("SANDBOX_PATH_BLOCKED");
    });

    it("should create command blocked error", () => {
      const error = new SandboxError("SANDBOX_COMMAND_BLOCKED", "Command blocked");
      expect(error.code).toBe("SANDBOX_COMMAND_BLOCKED");
    });
  });

  describe("StreamError", () => {
    it("should create stream error as retryable", () => {
      const error = new StreamError("Stream failed");
      expect(error.name).toBe("StreamError");
      expect(error.code).toBe("STREAM_ERROR");
      expect(error.retryable).toBe(true);
    });

    it("should include retry after", () => {
      const error = new StreamError("Stream failed", undefined, 30);
      expect(error.retryAfter).toBe(30);
    });
  });

  describe("RateLimitError", () => {
    it("should create rate limit error with retry after", () => {
      const error = new RateLimitError(60);
      expect(error.name).toBe("RateLimitError");
      expect(error.code).toBe("RATE_LIMITED");
      expect(error.retryable).toBe(true);
      expect(error.retryAfter).toBe(60);
    });

    it("should accept custom message", () => {
      const error = new RateLimitError(30, "Too many requests");
      expect(error.message).toBe("Too many requests");
    });
  });
});

describe("isRetryable", () => {
  it("should return true for retryable GlmMcpError", () => {
    const error = new ToolError("TOOL_TIMEOUT", "Timeout");
    expect(isRetryable(error)).toBe(true);
  });

  it("should return false for non-retryable GlmMcpError", () => {
    const error = new AuthError("AUTH_INVALID_KEY", "Invalid key");
    expect(isRetryable(error)).toBe(false);
  });

  it("should return false for standard Error", () => {
    const error = new Error("Standard error");
    expect(isRetryable(error)).toBe(false);
  });
});

describe("getRetryDelay", () => {
  it("should use retryAfter from error if available", () => {
    const error = new RateLimitError(30);
    const delay = getRetryDelay(error, 0);
    expect(delay).toBe(30000);
  });

  it("should use exponential backoff", () => {
    const error = new ToolError("TOOL_TIMEOUT", "Timeout");
    const delay0 = getRetryDelay(error, 0, 1000, 30000);
    const delay1 = getRetryDelay(error, 1, 1000, 30000);
    const delay2 = getRetryDelay(error, 2, 1000, 30000);
    
    expect(delay0).toBeGreaterThanOrEqual(1000);
    expect(delay1).toBeGreaterThanOrEqual(2000);
    expect(delay2).toBeGreaterThanOrEqual(4000);
  });

  it("should respect max delay", () => {
    const error = new ToolError("TOOL_TIMEOUT", "Timeout");
    const delay = getRetryDelay(error, 10, 1000, 5000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it("should add jitter", () => {
    const error = new ToolError("TOOL_TIMEOUT", "Timeout");
    const delays = Array.from({ length: 10 }, () => getRetryDelay(error, 0, 1000));
    const uniqueDelays = new Set(delays);
    expect(uniqueDelays.size).toBeGreaterThan(1);
  });
});

describe("Type Guards", () => {
  it("should identify GlmMcpError", () => {
    const error = new GlmMcpError("INTERNAL_ERROR", "Error");
    expect(isGlmMcpError(error)).toBe(true);
    expect(isGlmMcpError(new Error("test"))).toBe(false);
  });

  it("should identify AuthError", () => {
    const error = new AuthError("AUTH_INVALID_KEY", "Invalid");
    expect(isAuthError(error)).toBe(true);
    expect(isAuthError(new GlmMcpError("INTERNAL_ERROR", "Error"))).toBe(false);
  });

  it("should identify SessionError", () => {
    const error = new SessionError("SESSION_NOT_FOUND", "Not found");
    expect(isSessionError(error)).toBe(true);
  });

  it("should identify PlanError", () => {
    const error = new PlanError("PLAN_NOT_FOUND", "Not found");
    expect(isPlanError(error)).toBe(true);
  });

  it("should identify ToolError", () => {
    const error = new ToolError("TOOL_NOT_FOUND", "Not found");
    expect(isToolError(error)).toBe(true);
  });

  it("should identify SandboxError", () => {
    const error = new SandboxError("SANDBOX_VIOLATION", "Violation");
    expect(isSandboxError(error)).toBe(true);
  });

  it("should identify RateLimitError", () => {
    const error = new RateLimitError(60);
    expect(isRateLimitError(error)).toBe(true);
  });
});
