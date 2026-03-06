import { randomUUID } from "crypto";
import { GlmClient } from "../glm-client.js";
import { AGENT_TOOLS } from "./tools.js";
import { executeToolCall } from "./executor.js";
import type { AgentSession, AgentStep, GlmMessage } from "../types.js";

const SYSTEM_PROMPT = `You are an autonomous coding agent. You have access to tools to read, write, and edit files, run shell commands, list files, and search code.

Your job is to complete the task given to you by using these tools. Follow these guidelines:

1. Always read files before editing them to understand the current state.
2. Make targeted, minimal changes - don't rewrite entire files unless necessary.
3. After making changes, verify them by reading the file or running tests.
4. Use search_files to find relevant code when you're unsure where something is.
5. Use list_files to explore the project structure.
6. When done, call task_complete with a clear summary of what you did.
7. If you encounter errors, try to fix them before giving up.

Important:
- Work within the project directory.
- Be careful with destructive operations.
- Write clean, well-structured code.`;

const sessions = new Map<string, AgentSession>();

export function createSession(
  task: string,
  workingDir: string,
  model: string
): AgentSession {
  const session: AgentSession = {
    id: randomUUID(),
    task,
    workingDir,
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Working directory: ${workingDir}\n\nTask: ${task}`,
      },
    ],
    status: "ready",
    steps: [],
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(sessionId: string): AgentSession | undefined {
  return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export async function executeStep(
  session: AgentSession,
  client: GlmClient
): Promise<{
  action: string;
  details: string;
  status: "needs_more_steps" | "completed" | "error";
}> {
  session.status = "running";

  try {
    const response = await client.chat({
      model: session.model,
      messages: session.messages,
      tools: AGENT_TOOLS,
      tool_choice: "auto",
      temperature: 0.2,
    });

    const choice = response.choices[0];
    const message = choice.message;

    // Add assistant message to history
    session.messages.push(message);

    // If GLM wants to call tools
    if (choice.finish_reason === "tool_calls" && message.tool_calls) {
      const results: string[] = [];

      for (const toolCall of message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = executeToolCall(
          toolCall.function.name,
          args,
          session.workingDir
        );

        // Add tool result to conversation
        session.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });

        const step: AgentStep = {
          action: `${toolCall.function.name}(${summarizeArgs(args)})`,
          tool: toolCall.function.name,
          args,
          result:
            result.length > 500
              ? result.substring(0, 500) + "... [truncated]"
              : result,
          timestamp: Date.now(),
        };
        session.steps.push(step);
        results.push(
          `${toolCall.function.name}: ${step.result}`
        );

        // Check if task is complete
        if (result.startsWith("TASK_COMPLETE:")) {
          session.status = "completed";
          return {
            action: "task_complete",
            details: result.replace("TASK_COMPLETE: ", ""),
            status: "completed",
          };
        }
      }

      return {
        action: message.tool_calls
          .map(
            (tc) =>
              `${tc.function.name}(${summarizeArgs(JSON.parse(tc.function.arguments))})`
          )
          .join(", "),
        details: results.join("\n---\n"),
        status: "needs_more_steps",
      };
    }

    // If GLM responded with text (no tool calls), it might be thinking or done
    if (message.content) {
      // Check if it seems like GLM is done
      if (
        message.content.toLowerCase().includes("task complete") ||
        message.content.toLowerCase().includes("terminé") ||
        choice.finish_reason === "stop"
      ) {
        session.status = "completed";
        return {
          action: "text_response",
          details: message.content,
          status: "completed",
        };
      }

      return {
        action: "text_response",
        details: message.content,
        status: "needs_more_steps",
      };
    }

    session.status = "error";
    return {
      action: "error",
      details: "GLM returned an empty response",
      status: "error",
    };
  } catch (err) {
    session.status = "error";
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      action: "error",
      details: errorMessage,
      status: "error",
    };
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const strVal = String(value);
    if (strVal.length > 80) {
      parts.push(`${key}: "${strVal.substring(0, 80)}..."`);
    } else {
      parts.push(`${key}: "${strVal}"`);
    }
  }
  return parts.join(", ");
}
