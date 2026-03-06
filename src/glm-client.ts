import type { GlmChatRequest, GlmChatResponse } from "./types.js";
import type { StreamChunk } from "./types/streaming.js";

const GLM_API_BASE =
  process.env.GLM_API_BASE || "https://api.z.ai/api/coding/paas/v4";

export interface StreamCallback {
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void;
  onThinking?: (thinking: string) => void;
  onError?: (error: Error) => void;
  onDone?: (usage?: StreamChunk["usage"]) => void;
}

export class GlmClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(request: GlmChatRequest): Promise<GlmChatResponse> {
    const response = await fetch(`${GLM_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `GLM API error ${response.status}: ${errorBody}`
      );
    }

    return (await response.json()) as GlmChatResponse;
  }

  async *chatStream(
    request: GlmChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const response = await fetch(`${GLM_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ ...request, stream: true }),
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GLM API error ${response.status}: ${errorBody}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let chunkId = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          
          if (!trimmedLine || !trimmedLine.startsWith("data:")) {
            continue;
          }

          const data = trimmedLine.slice(5).trim();
          
          if (data === "[DONE]") {
            yield { type: "done", id: chunkId || "done" };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              id?: string;
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                  reasoning_content?: string;
                };
                finish_reason?: string;
              }>;
              usage?: {
                prompt_tokens: number;
                completion_tokens: number;
                total_tokens: number;
              };
            };

            chunkId = parsed.id ?? chunkId;
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            if (delta?.reasoning_content) {
              yield {
                type: "thinking",
                id: chunkId,
                delta: delta.reasoning_content,
              };
            }

            if (delta?.content) {
              yield {
                type: "text",
                id: chunkId,
                delta: delta.content,
              };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  yield {
                    type: "tool_call",
                    id: chunkId,
                    toolCall: {
                      id: tc.id ?? "",
                      name: tc.function.name,
                      arguments: tc.function.arguments ?? "",
                    },
                  };
                }
              }
            }

            if (choice?.finish_reason === "stop" || choice?.finish_reason === "tool_calls") {
              const usage = parsed.usage
                ? {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  }
                : undefined;

              yield { type: "done", id: chunkId, usage };
              return;
            }
          } catch {
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async chatWithStreaming(
    request: GlmChatRequest,
    callback: StreamCallback,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      for await (const chunk of this.chatStream(request, signal)) {
        switch (chunk.type) {
          case "text":
            callback.onToken?.(chunk.delta ?? "");
            break;
          case "tool_call":
            if (chunk.toolCall) {
              callback.onToolCall?.(chunk.toolCall);
            }
            break;
          case "thinking":
            callback.onThinking?.(chunk.delta ?? "");
            break;
          case "error":
            callback.onError?.(new Error(chunk.delta ?? "Unknown error"));
            break;
          case "done":
            callback.onDone?.(chunk.usage);
            break;
        }
      }
    } catch (error) {
      callback.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async embeddings(
    input: string | string[],
    model = "embedding-3"
  ): Promise<{ embeddings: number[][]; usage: { total_tokens: number } }> {
    const response = await fetch(`${GLM_API_BASE}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model, input }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `GLM Embeddings API error ${response.status}: ${errorBody}`
      );
    }

    const data = (await response.json()) as {
      data: { embedding: number[] }[];
      usage: { total_tokens: number };
    };

    return {
      embeddings: data.data.map((d) => d.embedding),
      usage: data.usage,
    };
  }
}
