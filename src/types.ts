export interface GlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: GlmToolCall[];
  tool_call_id?: string;
}

export interface GlmToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface GlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface GlmChatRequest {
  model: string;
  messages: GlmMessage[];
  tools?: GlmTool[];
  tool_choice?: "auto" | "none";
  temperature?: number;
  max_tokens?: number;
}

export interface GlmChatResponse {
  id: string;
  choices: {
    index: number;
    message: GlmMessage;
    finish_reason: "stop" | "tool_calls" | "length";
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AgentSession {
  id: string;
  task: string;
  workingDir: string;
  model: string;
  messages: GlmMessage[];
  status: "ready" | "running" | "completed" | "error";
  steps: AgentStep[];
}

export interface AgentStep {
  action: string;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
}
