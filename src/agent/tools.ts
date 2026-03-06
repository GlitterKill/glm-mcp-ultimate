import type { GlmTool } from "../types.js";

export const AGENT_TOOLS: GlmTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file. Use this to understand existing code before making changes.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or relative path to the file to read",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a new file or completely overwrite an existing file with new content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to create or overwrite",
          },
          content: {
            type: "string",
            description: "The full content to write to the file",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edit a file by replacing a specific text block with new text. If the text appears multiple times, use occurrence or context to disambiguate.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to edit",
          },
          old_text: {
            type: "string",
            description: "The exact text to find and replace (must match exactly)",
          },
          new_text: {
            type: "string",
            description: "The new text to replace the old text with",
          },
          occurrence: {
            type: "number",
            description: "If the old_text appears multiple times, which occurrence to replace (1-based index).",
          },
          context_before: {
            type: "string",
            description: "Optional text appearing immediately before old_text to help identify the correct location.",
          },
          context_after: {
            type: "string",
            description: "Optional text appearing immediately after old_text to help identify the correct location.",
          },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Execute a shell command and return its output. Use for running tests, installing packages, git operations, etc.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
          timeout: {
            type: "number",
            description: "Optional timeout in milliseconds (default: 60000)",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files and directories at a given path. Supports glob patterns.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path to list",
          },
          pattern: {
            type: "string",
            description:
              "Optional glob pattern to filter results (e.g. '*.ts', '**/*.test.js')",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Search for a text pattern in files (like grep). Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The text or regex pattern to search for",
          },
          path: {
            type: "string",
            description: "Directory to search in (defaults to working directory)",
          },
          file_pattern: {
            type: "string",
            description:
              "Optional glob pattern to filter files to search (e.g. '*.ts')",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_complete",
      description:
        "Signal that the task is complete. Call this when you have finished all the work.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "A summary of what was accomplished, including files modified and actions taken",
          },
        },
        required: ["summary"],
      },
    },
  },
];
