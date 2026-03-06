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

async function startMcpServer() {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    console.error("GLM_API_KEY environment variable is required");
    process.exit(1);
  }

  const client = new GlmClient(apiKey);
  const DEFAULT_MODEL = process.env.GLM_MODEL || "glm-5";

  const server = new McpServer({
    name: "glm-mcp-ultimate",
    version: "0.1.0",
  });

  // Ensure database is ready
  runMigrations();

  // --- Agent tools ---

  server.tool(
    "glm_run_task",
    "Execute a single, focused task using a fresh GLM session. This prevents context pollution across tasks. GLM will run autonomously up to a maximum number of steps to complete the task, then return findings back to you. Use this for individual tasks.",
    {
      task: z.string().describe("The specific task for GLM to execute"),
      context: z.string().optional().describe("Relevant context or findings from previous tasks"),
      working_dir: z
        .string()
        .optional()
        .describe("Working directory for the agent (defaults to CWD)"),
      model: z
        .string()
        .optional()
        .describe(`GLM model to use (default: ${DEFAULT_MODEL})`),
      max_steps: z
        .number()
        .optional()
        .describe("Maximum number of tool-use steps (default: 5)"),
    },
    async ({ task, context, working_dir, model, max_steps }) => {
      const workingDir = working_dir || process.cwd();
      const prompt = context ? `Context:\n${context}\n\nTask: ${task}` : `Task: ${task}`;
      const session = createSession(prompt, workingDir, model || DEFAULT_MODEL);
      const limit = max_steps || 5;

      const stepsTaken: any[] = [];
      let finalResult = "";

      for (let i = 0; i < limit; i++) {
        const result = await executeStep(session, client);
        stepsTaken.push({ action: result.action, status: result.status });
        
        if (result.status === "completed") {
          finalResult = result.details;
          break;
        } else if (result.status === "error") {
          finalResult = `Error during execution: ${result.details}`;
          break;
        }
      }

      if (session.status === "running" || session.status === "ready") {
        finalResult = `Task did not complete within the maximum number of steps (${limit}). Last action: ${stepsTaken[stepsTaken.length - 1]?.action}`;
        session.status = "error";
      }

      // Cleanup the session to save memory and avoid polluting long-term context
      deleteSession(session.id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                task_result: finalResult,
                steps_taken: stepsTaken.length,
                status: session.status,
                token_usage: session.tokenUsage,
              },
              null,
              2
            ),
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GLM MCP Ultimate server started");
}
import { Command } from "commander";
import { handleChat, handleAgent, handleVision, handleEmbeddings } from "./cli/handlers.js";

const program = new Command();

program
  .name("glm-mcp-ultimate")
  .description("GLM MCP Ultimate - AI coding agent and tools")
  .version("0.1.0");

program
  .command("server", { isDefault: true })
  .description("Start the MCP stdio server (default)")
  .action(() => {
    startMcpServer().catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
  });

program
  .command("chat <prompt>")
  .description("Send a prompt to GLM models")
  .option("-s, --system <system>", "Optional system prompt")
  .option("-m, --model <model>", "GLM model to use", process.env.GLM_MODEL || "glm-5")
  .action((prompt, options) => {
    handleChat(prompt, process.env.GLM_API_KEY, options.model, options.system).catch(console.error);
  });

program
  .command("agent <task>")
  .description("Start an autonomous coding agent session")
  .option("-d, --dir <directory>", "Working directory for the agent", process.cwd())
  .option("-m, --model <model>", "GLM model to use", process.env.GLM_MODEL || "glm-5")
  .action((task, options) => {
    handleAgent(task, options.dir, process.env.GLM_API_KEY, options.model).catch(console.error);
  });

program
  .command("vision <prompt> <imageUrl>")
  .description("Analyze an image using GLM-4V")
  .option("-m, --model <model>", "Vision model to use", "glm-4v-plus")
  .action((prompt, imageUrl, options) => {
    handleVision(prompt, imageUrl, process.env.GLM_API_KEY, options.model).catch(console.error);
  });

program
  .command("embeddings <input>")
  .description("Generate text embeddings")
  .option("-m, --model <model>", "Embedding model", "embedding-3")
  .action((input, options) => {
    handleEmbeddings(input, process.env.GLM_API_KEY, options.model).catch(console.error);
  });

program.parse(process.argv);

