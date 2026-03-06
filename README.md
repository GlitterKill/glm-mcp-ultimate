# GLM MCP Ultimate Server

The GLM MCP Ultimate server allows Claude Code and other MCP-compatible clients to utilize GLM (Zhipu AI) models. It provides an autonomous coding agent, chat capabilities, image analysis, and text embeddings.

## Features

- **Autonomous Coding Agent**: Start a session where GLM works on a task by reading, writing, and editing files, and running shell commands.
- **GLM Chat**: Send direct prompts to GLM models for quick questions or second opinions.
- **GLM Vision**: Analyze images using GLM-4V by providing a URL or base64 data.
- **GLM Embeddings**: Generate high-quality text embeddings for search and retrieval tasks.
- **SQLite Persistence**: Robust storage for sessions, messages, and agent steps.

## Prerequisites

- Node.js 18 or later
- A GLM API key from [Z.ai - Recommended: GLM Coding Plan (10% off with this link)](https://z.ai/subscribe?ic=LBSWHTJM5T)

## Installation

### Option 1: Easy Installation (NPM)

Install the package globally:
```bash
npm install -g @glitterkill/glm-mcp-ultimate
```

### Option 2: Manual Installation (Development)

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/glm-mcp-ultimate.git
   cd glm-mcp-ultimate
   ```
2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

## Configuration

### Using with Claude Desktop

To use this server with Claude Desktop, add it to your configuration file:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the following entry to the `mcpServers` object:

#### If installed via NPM:
```json
{
  "mcpServers": {
    "glm": {
      "command": "npx",
      "args": ["-y", "@glitterkill/glm-mcp-ultimate"],
      "env": {
        "GLM_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### If installed manually:
```json
{
  "mcpServers": {
    "glm": {
      "command": "node",
      "args": ["/path/to/glm-mcp-ultimate/dist/index.js"],
      "env": {
        "GLM_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Available Tools

### Autonomous Agent

- `glm_agent_start`: Initialize a new agent session for a specific task.
- `glm_agent_step`: Execute the next action in an active session. Call this repeatedly until the task completes.
- `glm_agent_stop`: Terminate a session and retrieve a summary of actions taken.

### General Tools

- `glm_chat`: Send a prompt to a GLM model and receive a text response.
- `glm_vision`: Provide an image and a prompt for visual analysis using GLM-4V.
- `glm_embeddings`: Convert text into vector embeddings using the GLM embedding model.

## Agent Capabilities

When running in autonomous mode, the GLM agent can perform the following actions:

- **File Operations**: Read, create, and edit files using precise text replacement.
- **System Commands**: Execute shell commands to run tests, install packages, or perform version control.
- **Code Exploration**: List files and search for patterns across the codebase.
- **Task completion**: Provide a detailed summary once the objective is reached.

## Environment Variables

- `GLM_API_KEY`: Required. Your Zhipu AI API key (Z.ai Coding Plan keys supported).
- `GLM_MODEL`: Optional. The default GLM model to use (defaults to `glm-5`).
- `GLM_API_BASE`: Optional. Override the base URL for the GLM API (defaults to `https://api.z.ai/api/coding/paas/v4`).

## CLI Command Usage

In addition to acting as an MCP server, GLM MCP Ultimate provides direct CLI commands for terminal users. This allows you to interact with the models without needing an MCP client like Claude Code.

**Global Installation:**
If you installed the package globally, you can use the `glm-mcp-ultimate` command directly:

```bash
# General Chat
glm-mcp-ultimate chat "Write a python script to reverse a string"

# Start Autonomous Agent
glm-mcp-ultimate agent "Refactor the authentication module" -d ./src/auth

# Image Analysis
glm-mcp-ultimate vision "Describe this image" https://example.com/image.jpg

# Generate Embeddings
glm-mcp-ultimate embeddings "Hello world"
```

**Using NPX:**
If you prefer not to install globally, you can use `npx`:

```bash
npx -y @glitterkill/glm-mcp-ultimate chat "What is the capital of France?"
```

*Note: Ensure your `GLM_API_KEY` environment variable is set before running these commands.*
