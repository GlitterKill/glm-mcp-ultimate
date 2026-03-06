import type { RiskLevel, ApprovalCallback } from "./approval.js";
import { ApprovalManager, createApprovalManager } from "./approval.js";
import { SandboxGuard, createSandboxGuard } from "../sandbox/guard.js";
import { SandboxError, ToolError } from "../errors/index.js";
import {
  runCommand,
  runCommandAsync,
  findFiles,
  searchInFiles,
  readFile,
  writeFile,
  editFile,
  listDirectory,
  resolvePath,
  type RunCommandOptions,
  type FindFilesOptions,
  type SearchInFilesOptions,
} from "./platform.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  riskLevel: RiskLevel;
  category: "file" | "command" | "search" | "utility";
}

export interface ToolExecutionContext {
  workingDir: string;
  sessionId?: string;
  planId?: string;
  stepId?: string;
  sandbox?: SandboxGuard;
  approvalManager?: ApprovalManager;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolResult> | ToolResult;

const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the contents of a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file" },
      },
      required: ["path"],
    },
    requiresApproval: false,
    riskLevel: "low",
    category: "file",
  },
  {
    name: "write_file",
    description: "Write content to a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    requiresApproval: true,
    riskLevel: "medium",
    category: "file",
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing text",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file" },
        old_text: { type: "string", description: "Text to replace" },
        new_text: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_text", "new_text"],
    },
    requiresApproval: true,
    riskLevel: "medium",
    category: "file",
  },
  {
    name: "list_files",
    description: "List files in a directory",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path" },
        pattern: { type: "string", description: "Optional glob pattern" },
      },
      required: ["path"],
    },
    requiresApproval: false,
    riskLevel: "low",
    category: "file",
  },
  {
    name: "find_files",
    description: "Find files matching a pattern",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Root path to search" },
        pattern: { type: "string", description: "Glob pattern" },
        max_depth: { type: "number", description: "Maximum search depth" },
      },
      required: ["path"],
    },
    requiresApproval: false,
    riskLevel: "low",
    category: "search",
  },
  {
    name: "search_files",
    description: "Search for text in files",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search pattern" },
        path: { type: "string", description: "Path to search" },
        file_pattern: { type: "string", description: "File pattern filter" },
      },
      required: ["query"],
    },
    requiresApproval: false,
    riskLevel: "low",
    category: "search",
  },
  {
    name: "run_command",
    description: "Execute a shell command",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
        timeout: { type: "number", description: "Timeout in ms" },
      },
      required: ["command"],
    },
    requiresApproval: true,
    riskLevel: "high",
    category: "command",
  },
  {
    name: "task_complete",
    description: "Mark task as complete",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Task summary" },
      },
      required: ["summary"],
    },
    requiresApproval: false,
    riskLevel: "low",
    category: "utility",
  },
];

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private executors: Map<string, ToolExecutor> = new Map();
  private sandbox: SandboxGuard;
  private approvalManager: ApprovalManager;
  private approvalCallback: ApprovalCallback | null = null;

  constructor(
    sandboxConfig?: ConstructorParameters<typeof SandboxGuard>[0],
    approvalConfig?: ConstructorParameters<typeof ApprovalManager>[0]
  ) {
    this.sandbox = createSandboxGuard(sandboxConfig);
    this.approvalManager = createApprovalManager(approvalConfig);
    this.registerBuiltInTools();
  }

  private registerBuiltInTools(): void {
    for (const tool of BUILT_IN_TOOLS) {
      this.tools.set(tool.name, tool);
    }

    this.executors.set("read_file", this.executeReadFile.bind(this));
    this.executors.set("write_file", this.executeWriteFile.bind(this));
    this.executors.set("edit_file", this.executeEditFile.bind(this));
    this.executors.set("list_files", this.executeListFiles.bind(this));
    this.executors.set("find_files", this.executeFindFiles.bind(this));
    this.executors.set("search_files", this.executeSearchFiles.bind(this));
    this.executors.set("run_command", this.executeRunCommand.bind(this));
    this.executors.set("task_complete", this.executeTaskComplete.bind(this));
  }

  register(tool: ToolDefinition, executor: ToolExecutor): void {
    this.tools.set(tool.name, tool);
    this.executors.set(tool.name, executor);
  }

  unregister(name: string): boolean {
    const deleted = this.tools.delete(name);
    this.executors.delete(name);
    return deleted;
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolsByCategory(category: ToolDefinition["category"]): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.category === category);
  }

  getToolsByRiskLevel(riskLevel: RiskLevel): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.riskLevel === riskLevel);
  }

  setApprovalCallback(callback: ApprovalCallback): void {
    this.approvalCallback = callback;
    this.approvalManager.setCallback(callback);
  }

  clearApprovalCallback(): void {
    this.approvalCallback = null;
    this.approvalManager.clearCallback();
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new ToolError("TOOL_NOT_FOUND", `Tool not found: ${toolName}`);
    }

    const executor = this.executors.get(toolName);
    if (!executor) {
      throw new ToolError(
        "TOOL_EXECUTION_FAILED",
        `No executor for tool: ${toolName}`
      );
    }

    const effectiveSandbox = context.sandbox ?? this.sandbox;

    if (tool.category === "file" && args.path) {
      try {
        args.path = effectiveSandbox.validatePath(
          args.path as string,
          context.workingDir
        );
      } catch (err) {
        if (err instanceof SandboxError) {
          throw err;
        }
        throw new SandboxError(
          "SANDBOX_PATH_BLOCKED",
          `Path validation failed: ${(err as Error).message}`
        );
      }
    }

    if (tool.category === "command" && args.command) {
      try {
        effectiveSandbox.validateCommand(args.command as string);
      } catch (err) {
        if (err instanceof SandboxError) {
          throw err;
        }
        throw new SandboxError(
          "SANDBOX_COMMAND_BLOCKED",
          `Command validation failed: ${(err as Error).message}`
        );
      }
    }

    if (tool.requiresApproval) {
      const decision = await this.approvalManager.requestApproval(
        toolName,
        args,
        tool.riskLevel,
        `Execution of ${toolName} tool`,
        {
          sessionId: context.sessionId,
          planId: context.planId,
          stepId: context.stepId,
        }
      );

      if (!decision.approved) {
        return {
          success: false,
          output: "",
          error: decision.reason || "Tool execution not approved",
        };
      }
    }

    try {
      const result = await executor(args, context);
      return result;
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeReadFile(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const path = args.path as string;
    const fullPath = resolvePath(context.workingDir, path);

    try {
      const { content, truncated } = readFile(fullPath);
      return {
        success: true,
        output: content,
        metadata: { truncated, path: fullPath },
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `Failed to read file: ${(err as Error).message}`,
      };
    }
  }

  private async executeWriteFile(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const path = args.path as string;
    const content = args.content as string;
    const fullPath = resolvePath(context.workingDir, path);

    try {
      writeFile(fullPath, content);
      return {
        success: true,
        output: `File written successfully: ${fullPath}`,
        metadata: { path: fullPath, size: content.length },
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `Failed to write file: ${(err as Error).message}`,
      };
    }
  }

  private async executeEditFile(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const path = args.path as string;
    const oldText = args.old_text as string;
    const newText = args.new_text as string;
    const fullPath = resolvePath(context.workingDir, path);

    const result = editFile(fullPath, oldText, newText);
    return {
      success: result.success,
      output: result.message,
      error: result.success ? undefined : result.message,
    };
  }

  private async executeListFiles(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const path = args.path as string;
    const pattern = args.pattern as string | undefined;
    const fullPath = resolvePath(context.workingDir, path);

    if (pattern) {
      const files = findFiles(fullPath, {
        pattern,
        maxDepth: 5,
        maxResults: 200,
      });
      return {
        success: true,
        output: files.map((f) => f.path).join("\n") || "(no matches)",
        metadata: { count: files.length },
      };
    }

    const output = listDirectory(fullPath);
    return {
      success: !output.startsWith("Error:"),
      output,
      error: output.startsWith("Error:") ? output : undefined,
    };
  }

  private async executeFindFiles(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const path = args.path as string;
    const pattern = args.pattern as string | undefined;
    const maxDepth = (args.max_depth as number) ?? 5;
    const fullPath = resolvePath(context.workingDir, path);

    const files = findFiles(fullPath, {
      pattern,
      maxDepth,
      maxResults: 200,
    });

    return {
      success: true,
      output: files.map((f) => `${f.isDirectory ? "[DIR]" : "[FILE]"} ${f.path}`).join("\n") || "(no matches)",
      metadata: { count: files.length },
    };
  }

  private async executeSearchFiles(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const query = args.query as string;
    const searchPath = args.path
      ? resolvePath(context.workingDir, args.path as string)
      : context.workingDir;
    const filePattern = args.file_pattern as string | undefined;

    const results = searchInFiles(searchPath, {
      pattern: query,
      filePattern,
      maxResults: 100,
    });

    if (results.length === 0) {
      return {
        success: true,
        output: "(no matches)",
        metadata: { count: 0 },
      };
    }

    const output = results
      .map((r) => `${r.file}:${r.line}:${r.column}: ${r.content}`)
      .join("\n");

    return {
      success: true,
      output,
      metadata: { count: results.length },
    };
  }

  private async executeRunCommand(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const command = args.command as string;
    const timeout = (args.timeout as number) ?? 60000;

    const result = runCommand(command, [], {
      cwd: context.workingDir,
      timeout,
      maxBuffer: 1024 * 1024,
    });

    const output = result.stdout || result.stderr || "(no output)";
    const truncatedOutput = output.length > 20000
      ? output.substring(0, 20000) + "\n... [truncated]"
      : output;

    return {
      success: result.success,
      output: truncatedOutput,
      error: result.success ? undefined : `Command failed (exit code ${result.exitCode}): ${result.stderr}`,
      metadata: {
        exitCode: result.exitCode,
        truncated: output.length > 20000,
      },
    };
  }

  private async executeTaskComplete(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    return {
      success: true,
      output: `TASK_COMPLETE: ${args.summary as string}`,
    };
  }

  getSandbox(): SandboxGuard {
    return this.sandbox;
  }

  getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }
}

export function createToolRegistry(
  sandboxConfig?: ConstructorParameters<typeof SandboxGuard>[0],
  approvalConfig?: ConstructorParameters<typeof ApprovalManager>[0]
): ToolRegistry {
  return new ToolRegistry(sandboxConfig, approvalConfig);
}
