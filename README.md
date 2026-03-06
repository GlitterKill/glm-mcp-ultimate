# mcp-glm

An MCP (Model Context Protocol) server that connects Claude Code to GLM/Z.AI models. This allows Claude Code to delegate tasks to GLM, get second opinions, analyze images, generate embeddings, or run autonomous coding agents.

## Features

- **Chat** - Send prompts to GLM and get responses for simple questions or alternative perspectives
- **Vision** - Analyze images using GLM-4V-Plus multimodal capabilities
- **Embeddings** - Generate text embeddings for semantic search and similarity
- **Autonomous Agent Mode** - Let GLM autonomously work on coding tasks with file operations and shell commands

## Prerequisites

- Node.js (v18 or higher)
- npm
- Z.AI API key (get it from [z.ai](https://z.ai))
- Z.AI Coding Plan (Pro or Max required for GLM-5)

## Build

```bash
npm install
npm run build
```

## Installation in Claude Code

Create a `.mcp.json` file at the root of your project (or in `~/.claude/.mcp.json` for global access).

### Windows

```json
{
  "mcpServers": {
    "glm": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "C:\\path\\to\\mcp-glm",
      "env": {
        "GLM_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Linux / macOS

```json
{
  "mcpServers": {
    "glm": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/path/to/mcp-glm",
      "env": {
        "GLM_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Then restart Claude Code. The MCP server will be auto-detected.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GLM_API_KEY` | Yes | - | Your Z.AI API key |
| `GLM_MODEL` | No | `glm-5` | Default model for chat operations |
| `GLM_API_BASE` | No | `https://api.z.ai/api/coding/paas/v4` | API base URL |

## Available Tools

| Tool | Description |
|------|-------------|
| `glm_chat` | Send a prompt to GLM and get a response. Optional system prompt and model selection. |
| `glm_vision` | Analyze an image using GLM-4V-Plus. Accepts image URL or base64 data URI. |
| `glm_embeddings` | Generate text embeddings using GLM's embedding model. |
| `glm_agent_start` | Start a new autonomous agent session. GLM will work on the task independently. |
| `glm_agent_step` | Execute the next step of an agent session. Call repeatedly until completed. |
| `glm_agent_stop` | Stop an agent session and get a summary of all actions taken. |

## Usage Examples

### Simple Chat
```
Use glm_chat to ask GLM: "What are the best practices for TypeScript error handling?"
```

### Image Analysis
```
Use glm_vision to analyze this screenshot: [image URL] and describe the UI elements
```

### Autonomous Agent
```
Use glm_agent_start to create a session with task: "Add unit tests for the calculator module"
Then call glm_agent_step repeatedly until status is "completed"
Finally call glm_agent_stop to get the summary
```

## License

MIT
