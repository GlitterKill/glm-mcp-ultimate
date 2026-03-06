#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GlmClient } from "./glm-client.js";
import { runMigrations } from "./db/migrations.js";
import {
  createSession,
  getSession,
  deleteSession,
  executeStep,
} from "./agent/session.js";

const apiKey = process.env.GLM_API_KEY;
if (!apiKey) {
  console.error("GLM_API_KEY environment variable is required");
  process.exit(1);
}

const client = new GlmClient(apiKey);
const DEFAULT_MODEL = process.env.GLM_MODEL || "glm-5";

const server = new McpServer({
  name: "glm-mcp-ultimate",
  version: "1.0.0",
});

// --- Agent tools ---

server.tool(
  "glm_agent_start",
  "Start a new GLM agent session. GLM will autonomously work on the given task by reading/writing files and running commands. Returns a session_id to use with glm_agent_step.",
  {
    task: z.string().describe("Description of the task for GLM to accomplish"),
    working_dir: z
      .string()
      .optional()
      .describe("Working directory for the agent (defaults to CWD)"),
    model: z
      .string()
      .optional()
      .describe(`GLM model to use (default: ${DEFAULT_MODEL})`),
  },
  async ({ task, working_dir, model }) => {
    const workingDir = working_dir || process.cwd();
    const session = createSession(task, workingDir, model || DEFAULT_MODEL);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              session_id: session.id,
              status: "ready",
              task: session.task,
              model: session.model,
              working_dir: session.workingDir,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "glm_agent_step",
  "Execute the next step of a GLM agent session. GLM will decide what action to take (read file, edit file, run command, etc.) and execute it. Call this repeatedly until status is 'completed'.",
  {
    session_id: z.string().describe("The session ID from glm_agent_start"),
  },
  async ({ session_id }) => {
    const session = getSession(session_id);
    if (!session) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Session not found: ${session_id}`,
          },
        ],
        isError: true,
      };
    }

    if (session.status === "completed") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "completed",
                message: "Session already completed",
                total_steps: session.steps.length,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const result = await executeStep(session, client);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              session_id: session.id,
              step_number: session.steps.length,
              action: result.action,
              details: result.details,
              status: result.status,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "glm_agent_stop",
  "Stop a GLM agent session and get a summary of all actions taken.",
  {
    session_id: z.string().describe("The session ID to stop"),
  },
  async ({ session_id }) => {
    const session = getSession(session_id);
    if (!session) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Session not found: ${session_id}`,
          },
        ],
        isError: true,
      };
    }

    const summary = {
      session_id: session.id,
      task: session.task,
      status: session.status,
      total_steps: session.steps.length,
      steps: session.steps.map((s, i) => ({
        step: i + 1,
        action: s.action,
        result_preview: s.result.substring(0, 200),
      })),
    };

    deleteSession(session_id);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }
);

// --- Simple chat tool ---

server.tool(
  "glm_chat",
  "Send a prompt to GLM and get a response. For simple questions or getting a second opinion from another LLM.",
  {
    prompt: z.string().describe("The prompt to send to GLM"),
    system: z
      .string()
      .optional()
      .describe("Optional system prompt"),
    model: z
      .string()
      .optional()
      .describe(`GLM model to use (default: ${DEFAULT_MODEL})`),
  },
  async ({ prompt, system, model }) => {
    const messages = [];
    if (system) {
      messages.push({ role: "system" as const, content: system });
    }
    messages.push({ role: "user" as const, content: prompt });

    const response = await client.chat({
      model: model || DEFAULT_MODEL,
      messages,
    });

    return {
      content: [
        {
          type: "text",
          text:
            response.choices[0]?.message?.content ||
            "(empty response from GLM)",
        },
      ],
    };
  }
);

// --- Vision tool ---

server.tool(
  "glm_vision",
  "Analyze an image using GLM-4V. Send an image URL or base64 data with a prompt.",
  {
    prompt: z
      .string()
      .describe("What to analyze about the image"),
    image_url: z
      .string()
      .describe("URL of the image or base64 data URI (data:image/png;base64,...)"),
    model: z
      .string()
      .optional()
      .describe("Vision model to use (default: glm-4v-plus)"),
  },
  async ({ prompt, image_url, model }) => {
    const response = await client.chat({
      model: model || "glm-4v-plus",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: image_url } },
            { type: "text", text: prompt },
          ] as unknown as string,
        },
      ],
    });

    return {
      content: [
        {
          type: "text",
          text:
            response.choices[0]?.message?.content ||
            "(empty response from GLM Vision)",
        },
      ],
    };
  }
);

// --- Embeddings tool ---

server.tool(
  "glm_embeddings",
  "Generate text embeddings using GLM's embedding model.",
  {
    input: z
      .union([z.string(), z.array(z.string())])
      .describe("Text or array of texts to embed"),
    model: z
      .string()
      .optional()
      .describe("Embedding model (default: embedding-3)"),
  },
  async ({ input, model }) => {
    const result = await client.embeddings(input, model);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              dimensions: result.embeddings[0]?.length,
              count: result.embeddings.length,
              usage: result.usage,
              embeddings: result.embeddings.map((e) =>
                e.slice(0, 5).concat([NaN]).map((v) =>
                  isNaN(v) ? "..." : v
                )
              ),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Start server ---

async function main() {
  // Ensure database is ready
  runMigrations();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GLM MCP Ultimate server started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
