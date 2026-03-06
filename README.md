# GLM MCP Ultimate Server

The GLM MCP Ultimate server allows Claude Code and other MCP-compatible clients to utilize GLM (Zhipu AI) models. It provides an autonomous coding agent, chat capabilities, image analysis, and text embeddings.

## Features

- **Autonomous Coding Agent**: Start a session where GLM works on a task by reading, writing, and editing files, and running shell commands.
- **GLM Chat**: Send direct prompts to GLM models for quick questions or second opinions.
- **GLM Vision**: Analyze images using GLM-4V by providing a URL or base64 data.
- **GLM Vision**: Analyze images using GLM-4V by providing a URL or base64 data.
- **GLM Embeddings**: Generate high-quality text embeddings for search and retrieval tasks.
- **SQLite Persistence**: Robust storage for sessions, messages, and agent steps.

## Prerequisites

- Node.js 18 or later
- A GLM API key from [BigModel.ai](https://bigmodel.ai)

## Installation

### Windows

1. Clone the repository:
   ```cmd
   git clone https://github.com/your-repo/glm-mcp-ultimate.git
   cd glm-mcp-ultimate
   ```
2. Install dependencies:
   ```cmd
   npm install
   ```
3. Build the project:
   ```cmd
   npm run build
   ```
4. Set the API key environment variable:
   ```cmd
   setx GLM_API_KEY your_api_key_here
   ```

### Linux and macOS

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/glm-mcp-ultimate.git
   cd glm-mcp-ultimate
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Set the API key environment variable in your shell profile (e.g., `.bashrc` or `.zshrc`):
   ```bash
   export GLM_API_KEY=your_api_key_here
   ```

## Configuration

To use this server with Claude Desktop, add it to your configuration file:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the following entry to the `mcpServers` object:

```json
{
  "mcpServers": {
    "glm": {
      "command": "node",
      "args": ["F:/Claude/projects/glm-mcp-ultimate/dist/index.js"],
      "env": {
        "GLM_API_KEY": "your_api_key_here",
        "GLM_MODEL": "glm-5"
      }
    }
  }
}
```

Replace the path in `args` with the absolute path to your `dist/index.js`.

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

- `GLM_API_KEY`: Required. Your Zhipu AI API key.
- `GLM_MODEL`: Optional. The default GLM model to use (defaults to `glm-5`).
- `GLM_API_BASE`: Optional. Override the base URL for the GLM API.
