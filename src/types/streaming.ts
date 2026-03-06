export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "thinking" | "error" | "done";
  id: string;
  delta?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  toolResult?: {
    callId: string;
    result: string;
    error?: boolean;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamOptions {
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: StreamChunk["toolCall"]) => void;
  onError?: (error: Error) => void;
  bufferMs?: number;
  includeThinking?: boolean;
}

export function createTextChunk(id: string, delta: string): StreamChunk {
  return { type: "text", id, delta };
}

export function createToolCallChunk(
  id: string,
  toolCall: NonNullable<StreamChunk["toolCall"]>
): StreamChunk {
  return { type: "tool_call", id, toolCall };
}

export function createToolResultChunk(
  id: string,
  toolResult: NonNullable<StreamChunk["toolResult"]>
): StreamChunk {
  return { type: "tool_result", id, toolResult };
}

export function createThinkingChunk(id: string, delta: string): StreamChunk {
  return { type: "thinking", id, delta };
}

export function createErrorChunk(id: string, message: string): StreamChunk {
  return { type: "error", id, delta: message };
}

export function createDoneChunk(
  id: string,
  usage?: StreamChunk["usage"]
): StreamChunk {
  return { type: "done", id, usage };
}

export function isTextChunk(chunk: StreamChunk): boolean {
  return chunk.type === "text";
}

export function isToolCallChunk(chunk: StreamChunk): boolean {
  return chunk.type === "tool_call";
}

export function isToolResultChunk(chunk: StreamChunk): boolean {
  return chunk.type === "tool_result";
}

export function isThinkingChunk(chunk: StreamChunk): boolean {
  return chunk.type === "thinking";
}

export function isErrorChunk(chunk: StreamChunk): boolean {
  return chunk.type === "error";
}

export function isDoneChunk(chunk: StreamChunk): boolean {
  return chunk.type === "done";
}
