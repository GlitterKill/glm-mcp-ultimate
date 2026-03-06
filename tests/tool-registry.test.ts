import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ToolRegistry,
  createToolRegistry,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from "../src/tools/registry.js";
import {
  ApprovalManager,
  createApprovalManager,
  type ApprovalRequest,
  type ApprovalDecision,
} from "../src/tools/approval.js";
import { SandboxGuard, createSandboxGuard } from "../src/sandbox/guard.js";
import { SandboxError, ToolError } from "../src/errors/index.js";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

describe("ApprovalManager", () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    manager = createApprovalManager();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const m = createApprovalManager();
      expect(m.getConfig().autoApproveLowRisk).toBe(true);
    });

    it("should accept custom config", () => {
      const m = createApprovalManager({ autoApproveLowRisk: false });
      expect(m.getConfig().autoApproveLowRisk).toBe(false);
    });
  });

  describe("requestApproval", () => {
    it("should auto-approve low risk when configured", async () => {
      const decision = await manager.requestApproval(
        "test_tool",
        {},
        "low",
        "Test reason"
      );
      expect(decision.approved).toBe(true);
    });

    it("should require approval for medium risk by default", async () => {
      const callback = vi.fn().mockResolvedValue({
        approved: true,
        requestId: "test",
        timestamp: Date.now(),
      });
      manager.setCallback(callback);

      await manager.requestApproval("test_tool", {}, "medium", "Test reason");
      expect(callback).toHaveBeenCalled();
    });

    it("should require approval for high risk", async () => {
      const callback = vi.fn().mockResolvedValue({
        approved: true,
        requestId: "test",
        timestamp: Date.now(),
      });
      manager.setCallback(callback);

      await manager.requestApproval("test_tool", {}, "high", "Test reason");
      expect(callback).toHaveBeenCalled();
    });

    it("should require approval for critical risk", async () => {
      const callback = vi.fn().mockResolvedValue({
        approved: true,
        requestId: "test",
        timestamp: Date.now(),
      });
      manager.setCallback(callback);

      await manager.requestApproval("test_tool", {}, "critical", "Test reason");
      expect(callback).toHaveBeenCalled();
    });

    it("should auto-approve when no callback set", async () => {
      manager.clearCallback();
      const decision = await manager.requestApproval(
        "test_tool",
        {},
        "high",
        "Test reason"
      );
      expect(decision.approved).toBe(true);
    });

    it("should pass request details to callback", async () => {
      let capturedRequest: ApprovalRequest | null = null;
      manager.setCallback(async (req) => {
        capturedRequest = req;
        return { approved: true, requestId: req.id, timestamp: Date.now() };
      });

      await manager.requestApproval(
        "my_tool",
        { arg1: "value1" },
        "high",
        "Test reason",
        { sessionId: "session-123", planId: "plan-456" }
      );

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.toolName).toBe("my_tool");
      expect(capturedRequest!.args).toEqual({ arg1: "value1" });
      expect(capturedRequest!.riskLevel).toBe("high");
      expect(capturedRequest!.sessionId).toBe("session-123");
      expect(capturedRequest!.planId).toBe("plan-456");
    });

    it("should return rejected decision when callback rejects", async () => {
      manager.setCallback(async (req) => ({
        approved: false,
        requestId: req.id,
        reason: "User rejected",
        timestamp: Date.now(),
      }));

      const decision = await manager.requestApproval(
        "test_tool",
        {},
        "high",
        "Test"
      );
      expect(decision.approved).toBe(false);
      expect(decision.reason).toBe("User rejected");
    });
  });

  describe("pending requests", () => {
    it("should track pending requests", async () => {
      let resolveApproval: (value: ApprovalDecision) => void;
      manager.setCallback(
        () =>
          new Promise((resolve) => {
            resolveApproval = resolve;
          })
      );

      const approvalPromise = manager.requestApproval(
        "test_tool",
        {},
        "high",
        "Test"
      );

      expect(manager.getPendingRequests().length).toBe(1);
      resolveApproval!({ approved: true, requestId: "test", timestamp: Date.now() });
      await approvalPromise;
      expect(manager.getPendingRequests().length).toBe(0);
    });
  });

  describe("config updates", () => {
    it("should update config", () => {
      manager.updateConfig({ autoApproveLowRisk: false });
      expect(manager.getConfig().autoApproveLowRisk).toBe(false);
    });

    it("should not require approval for low risk when autoApproveLowRisk is true", async () => {
      manager.updateConfig({ autoApproveLowRisk: true });
      const callback = vi.fn();
      manager.setCallback(callback);

      await manager.requestApproval("test_tool", {}, "low", "Test");
      expect(callback).not.toHaveBeenCalled();
    });
  });
});

describe("ToolRegistry", () => {
  let registry: ToolRegistry;
  const testDir = join(process.cwd(), "test-registry-dir");

  const defaultContext: ToolExecutionContext = {
    workingDir: testDir,
  };

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    registry = createToolRegistry();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("built-in tools", () => {
    it("should have read_file tool", () => {
      expect(registry.hasTool("read_file")).toBe(true);
    });

    it("should have write_file tool", () => {
      expect(registry.hasTool("write_file")).toBe(true);
    });

    it("should have edit_file tool", () => {
      expect(registry.hasTool("edit_file")).toBe(true);
    });

    it("should have list_files tool", () => {
      expect(registry.hasTool("list_files")).toBe(true);
    });

    it("should have find_files tool", () => {
      expect(registry.hasTool("find_files")).toBe(true);
    });

    it("should have search_files tool", () => {
      expect(registry.hasTool("search_files")).toBe(true);
    });

    it("should have run_command tool", () => {
      expect(registry.hasTool("run_command")).toBe(true);
    });

    it("should have task_complete tool", () => {
      expect(registry.hasTool("task_complete")).toBe(true);
    });
  });

  describe("tool registration", () => {
    it("should register custom tool", () => {
      const tool: ToolDefinition = {
        name: "custom_tool",
        description: "A custom tool",
        parameters: { type: "object" },
        requiresApproval: false,
        riskLevel: "low",
        category: "utility",
      };
      registry.register(tool, async () => ({ success: true, output: "done" }));

      expect(registry.hasTool("custom_tool")).toBe(true);
    });

    it("should unregister tool", () => {
      const tool: ToolDefinition = {
        name: "temp_tool",
        description: "Temporary",
        parameters: { type: "object" },
        requiresApproval: false,
        riskLevel: "low",
        category: "utility",
      };
      registry.register(tool, async () => ({ success: true, output: "" }));

      expect(registry.hasTool("temp_tool")).toBe(true);
      registry.unregister("temp_tool");
      expect(registry.hasTool("temp_tool")).toBe(false);
    });

    it("should get tool by name", () => {
      const tool = registry.getTool("read_file");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("read_file");
    });

    it("should get all tools", () => {
      const tools = registry.getAllTools();
      expect(tools.length).toBeGreaterThanOrEqual(8);
    });

    it("should get tools by category", () => {
      const fileTools = registry.getToolsByCategory("file");
      expect(fileTools.length).toBeGreaterThan(0);
      expect(fileTools.every((t) => t.category === "file")).toBe(true);
    });

    it("should get tools by risk level", () => {
      const lowRiskTools = registry.getToolsByRiskLevel("low");
      expect(lowRiskTools.length).toBeGreaterThan(0);
      expect(lowRiskTools.every((t) => t.riskLevel === "low")).toBe(true);
    });
  });

  describe("execute", () => {
    it("should throw for unknown tool", async () => {
      await expect(registry.execute("unknown_tool", {}, defaultContext)).rejects.toThrow(
        ToolError
      );
    });

    it("should execute read_file", async () => {
      const filePath = join(testDir, "test.txt");
      writeFileSync(filePath, "test content");

      const result = await registry.execute(
        "read_file",
        { path: "test.txt" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("test content");
    });

    it("should execute write_file", async () => {
      const result = await registry.execute(
        "write_file",
        { path: "new.txt", content: "new content" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(existsSync(join(testDir, "new.txt"))).toBe(true);
    });

    it("should execute edit_file", async () => {
      const filePath = join(testDir, "edit.txt");
      writeFileSync(filePath, "original text");

      const result = await registry.execute(
        "edit_file",
        { path: "edit.txt", old_text: "original", new_text: "modified" },
        defaultContext
      );

      expect(result.success).toBe(true);
    });

    it("should execute list_files", async () => {
      writeFileSync(join(testDir, "file1.txt"), "");
      writeFileSync(join(testDir, "file2.txt"), "");

      const result = await registry.execute(
        "list_files",
        { path: "." },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("file1.txt");
    });

    it("should execute find_files", async () => {
      writeFileSync(join(testDir, "test.js"), "");
      writeFileSync(join(testDir, "test.txt"), "");

      const result = await registry.execute(
        "find_files",
        { path: ".", pattern: "*.js" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("test.js");
    });

    it("should execute search_files", async () => {
      writeFileSync(join(testDir, "search.txt"), "hello world\nfoo bar");

      const result = await registry.execute(
        "search_files",
        { query: "hello" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("hello");
    });

    it("should execute run_command", async () => {
      const result = await registry.execute(
        "run_command",
        { command: "echo hello" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("hello");
    });

    it("should execute task_complete", async () => {
      const result = await registry.execute(
        "task_complete",
        { summary: "Task done" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("TASK_COMPLETE");
    });
  });

  describe("approval workflow", () => {
    it("should request approval for tools requiring approval", async () => {
      let approvalRequested = false;
      registry.setApprovalCallback(async (req) => {
        approvalRequested = true;
        return { approved: true, requestId: req.id, timestamp: Date.now() };
      });

      await registry.execute(
        "write_file",
        { path: "approved.txt", content: "content" },
        defaultContext
      );

      expect(approvalRequested).toBe(true);
    });

    it("should not execute if approval denied", async () => {
      registry.setApprovalCallback(async (req) => ({
        approved: false,
        requestId: req.id,
        reason: "Denied",
        timestamp: Date.now(),
      }));

      const result = await registry.execute(
        "write_file",
        { path: "denied.txt", content: "content" },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(existsSync(join(testDir, "denied.txt"))).toBe(false);
    });

    it("should not require approval for low-risk tools", async () => {
      let approvalRequested = false;
      registry.setApprovalCallback(async () => {
        approvalRequested = true;
        return { approved: true, requestId: "", timestamp: Date.now() };
      });

      writeFileSync(join(testDir, "existing.txt"), "content");
      await registry.execute(
        "read_file",
        { path: "existing.txt" },
        defaultContext
      );

      expect(approvalRequested).toBe(false);
    });
  });

  describe("sandbox integration", () => {
    it("should block path traversal", async () => {
      await expect(
        registry.execute(
          "read_file",
          { path: "../../../etc/passwd" },
          defaultContext
        )
      ).rejects.toThrow(SandboxError);
    });

    it("should block dangerous commands", async () => {
      await expect(
        registry.execute(
          "run_command",
          { command: "rm -rf /" },
          defaultContext
        )
      ).rejects.toThrow(SandboxError);
    });

    it("should use custom sandbox if provided", async () => {
      const customSandbox = createSandboxGuard({ enabled: false });
      const customRegistry = createToolRegistry({ enabled: false });

      const result = await customRegistry.execute(
        "run_command",
        { command: "echo test" },
        { ...defaultContext, sandbox: customSandbox }
      );

      expect(result.success).toBe(true);
    });
  });

  describe("custom tool execution", () => {
    it("should execute custom registered tool", async () => {
      const tool: ToolDefinition = {
        name: "double",
        description: "Doubles a number",
        parameters: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
        },
        requiresApproval: false,
        riskLevel: "low",
        category: "utility",
      };

      registry.register(tool, async (args) => ({
        success: true,
        output: String((args.value as number) * 2),
      }));

      const result = await registry.execute("double", { value: 5 }, defaultContext);
      expect(result.success).toBe(true);
      expect(result.output).toBe("10");
    });

    it("should handle executor errors", async () => {
      const tool: ToolDefinition = {
        name: "error_tool",
        description: "Always errors",
        parameters: { type: "object" },
        requiresApproval: false,
        riskLevel: "low",
        category: "utility",
      };

      registry.register(tool, async () => {
        throw new Error("Executor error");
      });

      const result = await registry.execute("error_tool", {}, defaultContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Executor error");
    });
  });

  describe("getSandbox and getApprovalManager", () => {
    it("should return sandbox instance", () => {
      const sandbox = registry.getSandbox();
      expect(sandbox).toBeInstanceOf(SandboxGuard);
    });

    it("should return approval manager instance", () => {
      const approvalManager = registry.getApprovalManager();
      expect(approvalManager).toBeInstanceOf(ApprovalManager);
    });
  });
});
