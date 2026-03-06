import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Logger, getLogger, resetLogger, type LogEntry } from "../src/util/logger.js";

describe("Logger", () => {
  let outputCalls: LogEntry[] = [];
  const testOutput = (entry: LogEntry) => {
    outputCalls.push(entry);
  };

  beforeEach(() => {
    outputCalls = [];
    resetLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create logger with default options", () => {
      const logger = new Logger();
      expect(logger.getLevel()).toBe("info");
    });

    it("should create logger with custom level", () => {
      const logger = new Logger({ level: "debug" });
      expect(logger.getLevel()).toBe("debug");
    });

    it("should create logger with custom name", () => {
      const logger = new Logger({ name: "test-logger" });
      const output: LogEntry[] = [];
      const testLogger = new Logger({ name: "test-logger", output: (e) => output.push(e) });
      testLogger.info("test");
      expect(output[0].context?.logger).toBe("test-logger");
    });
  });

  describe("log levels", () => {
    it("should log debug messages when level is debug", () => {
      const logger = new Logger({ level: "debug", output: testOutput });
      logger.debug("debug message");
      expect(outputCalls).toHaveLength(1);
      expect(outputCalls[0].level).toBe("debug");
    });

    it("should not log debug messages when level is info", () => {
      const logger = new Logger({ level: "info", output: testOutput });
      logger.debug("debug message");
      expect(outputCalls).toHaveLength(0);
    });

    it("should log info messages when level is info", () => {
      const logger = new Logger({ level: "info", output: testOutput });
      logger.info("info message");
      expect(outputCalls).toHaveLength(1);
      expect(outputCalls[0].level).toBe("info");
    });

    it("should log warn messages when level is info", () => {
      const logger = new Logger({ level: "info", output: testOutput });
      logger.warn("warn message");
      expect(outputCalls).toHaveLength(1);
      expect(outputCalls[0].level).toBe("warn");
    });

    it("should log error messages when level is error", () => {
      const logger = new Logger({ level: "error", output: testOutput });
      logger.error("error message");
      expect(outputCalls).toHaveLength(1);
      expect(outputCalls[0].level).toBe("error");
    });

    it("should not log info messages when level is warn", () => {
      const logger = new Logger({ level: "warn", output: testOutput });
      logger.info("info message");
      expect(outputCalls).toHaveLength(0);
    });
  });

  describe("log methods", () => {
    it("should include timestamp in ISO format", () => {
      const logger = new Logger({ output: testOutput });
      const before = new Date().toISOString();
      logger.info("test");
      const after = new Date().toISOString();
      expect(outputCalls[0].timestamp >= before).toBe(true);
      expect(outputCalls[0].timestamp <= after).toBe(true);
    });

    it("should include message", () => {
      const logger = new Logger({ output: testOutput });
      logger.info("test message");
      expect(outputCalls[0].message).toBe("test message");
    });

    it("should include context when provided", () => {
      const logger = new Logger({ output: testOutput });
      logger.info("test", { key: "value", count: 42 });
      expect(outputCalls[0].context?.key).toBe("value");
      expect(outputCalls[0].context?.count).toBe(42);
    });
  });

  describe("error method", () => {
    it("should log Error objects with details", () => {
      const logger = new Logger({ output: testOutput });
      const error = new Error("test error");
      error.name = "TestError";
      logger.error("something failed", error);
      
      expect(outputCalls[0].error?.name).toBe("TestError");
      expect(outputCalls[0].error?.message).toBe("test error");
      expect(outputCalls[0].error?.stack).toBeDefined();
    });

    it("should include non-Error objects in context", () => {
      const logger = new Logger({ output: testOutput });
      logger.error("something failed", { code: "ERR001" });
      
      expect(outputCalls[0].context?.error).toEqual({ code: "ERR001" });
      expect(outputCalls[0].error).toBeUndefined();
    });

    it("should handle error without Error object", () => {
      const logger = new Logger({ output: testOutput });
      logger.error("just a message");
      
      expect(outputCalls[0].message).toBe("just a message");
      expect(outputCalls[0].error).toBeUndefined();
    });

    it("should include both error and context", () => {
      const logger = new Logger({ output: testOutput });
      const error = new Error("test");
      logger.error("failed", error, { operation: "test" });
      
      expect(outputCalls[0].error?.message).toBe("test");
      expect(outputCalls[0].context?.operation).toBe("test");
    });
  });

  describe("child logger", () => {
    it("should create child logger with appended name", () => {
      const logger = new Logger({ name: "parent", output: testOutput });
      const child = logger.child("child");
      child.info("test");
      
      expect(outputCalls[0].context?.logger).toBe("parent:child");
    });

    it("should inherit parent log level", () => {
      const logger = new Logger({ level: "warn", output: testOutput });
      const child = logger.child("child");
      child.debug("should not log");
      
      expect(outputCalls).toHaveLength(0);
    });

    it("should use same output function", () => {
      const logger = new Logger({ output: testOutput });
      const child = logger.child("child");
      child.info("test");
      
      expect(outputCalls).toHaveLength(1);
    });
  });

  describe("setLevel", () => {
    it("should change log level", () => {
      const logger = new Logger({ level: "info", output: testOutput });
      logger.debug("before");
      expect(outputCalls).toHaveLength(0);
      
      logger.setLevel("debug");
      logger.debug("after");
      expect(outputCalls).toHaveLength(1);
    });
  });

  describe("getLogger singleton", () => {
    it("should return same logger instance", () => {
      const logger1 = getLogger();
      const logger2 = getLogger();
      expect(logger1).toBe(logger2);
    });

    it("should create new logger with options on first call", () => {
      resetLogger();
      const logger = getLogger({ level: "debug" });
      expect(logger.getLevel()).toBe("debug");
    });

    it("should ignore options on subsequent calls", () => {
      const logger1 = getLogger({ level: "debug" });
      const logger2 = getLogger({ level: "error" });
      expect(logger2.getLevel()).toBe("debug");
    });
  });

  describe("JSON output", () => {
    it("should produce valid JSON", () => {
      const logger = new Logger({ output: testOutput });
      logger.info("test", { key: "value" });
      
      const parsed = JSON.parse(JSON.stringify(outputCalls[0]));
      expect(parsed.message).toBe("test");
      expect(parsed.context.key).toBe("value");
    });
  });
});
