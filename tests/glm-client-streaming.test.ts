import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GlmClient, type StreamCallback } from "../src/glm-client.js";
import type { StreamChunk } from "../src/types/streaming.js";

function createMockResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  let index = 0;
  
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) {
              return { done: true, value: undefined };
            }
            const value = encoder.encode(chunks[index]);
            index++;
            return { done: false, value };
          },
          releaseLock() {},
        };
      },
    },
    async text() {
      return status === 200 ? "" : "Error message";
    },
  } as unknown as Response;
}

describe("GlmClient Streaming", () => {
  let client: GlmClient;
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new GlmClient("test-api-key");
    fetchMock = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("chatStream", () => {
    it("should yield text chunks", async () => {
      const sseData = [
        'data: {"id":"chat-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"chat-1","choices":[{"delta":{"content":" world"}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse(sseData));

      const chunks: StreamChunk[] = [];
      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Hi" }],
      };

      for await (const chunk of client.chatStream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: "text", id: "chat-1", delta: "Hello" });
      expect(chunks[1]).toEqual({ type: "text", id: "chat-1", delta: " world" });
      expect(chunks[2]).toEqual({ type: "done", id: "chat-1" });
    });

    it("should yield tool call chunks", async () => {
      const sseData = [
        'data: {"id":"chat-2","choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"read_file","arguments":"{\\"path\\": \\"test\\"}"}}]}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse(sseData));

      const chunks: StreamChunk[] = [];
      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Read file" }],
      };

      for await (const chunk of client.chatStream(request)) {
        chunks.push(chunk);
      }

      expect(chunks[0].type).toBe("tool_call");
      expect(chunks[0].toolCall?.name).toBe("read_file");
    });

    it("should yield thinking chunks for reasoning_content", async () => {
      const sseData = [
        'data: {"id":"chat-3","choices":[{"delta":{"reasoning_content":"Let me think..."}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse(sseData));

      const chunks: StreamChunk[] = [];
      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Think" }],
      };

      for await (const chunk of client.chatStream(request)) {
        chunks.push(chunk);
      }

      expect(chunks[0].type).toBe("thinking");
      expect(chunks[0].delta).toBe("Let me think...");
    });

    it("should include usage in done chunk when available", async () => {
      const sseData = [
        'data: {"id":"chat-4","choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse(sseData));

      const chunks: StreamChunk[] = [];
      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Hi" }],
      };

      for await (const chunk of client.chatStream(request)) {
        chunks.push(chunk);
      }

      expect(chunks[chunks.length - 1].type).toBe("done");
      expect(chunks[chunks.length - 1].usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it("should handle finish_reason tool_calls", async () => {
      const sseData = [
        'data: {"id":"chat-5","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse(sseData));

      const chunks: StreamChunk[] = [];
      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Test" }],
      };

      for await (const chunk of client.chatStream(request)) {
        chunks.push(chunk);
      }

      expect(chunks[chunks.length - 1].type).toBe("done");
    });

    it("should throw on API error", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse([], 500));

      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Hi" }],
      };

      await expect(async () => {
        for await (const _ of client.chatStream(request)) {
          break;
        }
      }).rejects.toThrow("GLM API error 500");
    });

    it("should pass abort signal", async () => {
      const controller = new AbortController();
      fetchMock.mockResolvedValueOnce(createMockResponse([]));

      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Hi" }],
      };

      await client.chatStream(request, controller.signal).next();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal })
      );
    });

    it("should set stream: true in request body", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse([]));

      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Hi" }],
      };

      await client.chatStream(request).next();

      const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callArgs.body as string);
      expect(body.stream).toBe(true);
    });

    it("should include Accept header for SSE", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse([]));

      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Hi" }],
      };

      await client.chatStream(request).next();

      const callArgs = fetchMock.mock.calls[0][1] as RequestInit;
      expect(callArgs.headers).toMatchObject({
        Accept: "text/event-stream",
      });
    });
  });

  describe("chatWithStreaming", () => {
    it("should call onToken for text chunks", async () => {
      const sseData = [
        'data: {"id":"chat-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"chat-1","choices":[{"delta":{"content":" there"}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse(sseData));

      const tokens: string[] = [];
      const callback: StreamCallback = {
        onToken: (token) => tokens.push(token),
      };

      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Hi" }],
      };

      await client.chatWithStreaming(request, callback);

      expect(tokens).toEqual(["Hello", " there"]);
    });

    it("should call onToolCall for tool call chunks", async () => {
      const sseData = [
        'data: {"id":"chat-1","choices":[{"delta":{"tool_calls":[{"id":"tc-1","function":{"name":"test","arguments":"{}"}}]}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse(sseData));

      const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
      const callback: StreamCallback = {
        onToolCall: (tc) => toolCalls.push(tc),
      };

      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Test" }],
      };

      await client.chatWithStreaming(request, callback);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe("test");
    });

    it("should call onThinking for reasoning content", async () => {
      const sseData = [
        'data: {"id":"chat-1","choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse(sseData));

      const thinking: string[] = [];
      const callback: StreamCallback = {
        onThinking: (t) => thinking.push(t),
      };

      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Think" }],
      };

      await client.chatWithStreaming(request, callback);

      expect(thinking).toEqual(["thinking..."]);
    });

    it("should call onDone when complete", async () => {
      const sseData = [
        'data: {"id":"chat-1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      ];

      fetchMock.mockResolvedValueOnce(createMockResponse(sseData));

      let usage: StreamChunk["usage"] | undefined;
      const callback: StreamCallback = {
        onDone: (u) => {
          usage = u;
        },
      };

      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Hi" }],
      };

      await client.chatWithStreaming(request, callback);

      expect(usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it("should call onError on exception", async () => {
      fetchMock.mockResolvedValueOnce(createMockResponse([], 500));

      let capturedError: Error | undefined;
      const callback: StreamCallback = {
        onError: (e) => {
          capturedError = e;
        },
      };

      const request = {
        model: "glm-5",
        messages: [{ role: "user" as const, content: "Hi" }],
      };

      await expect(
        client.chatWithStreaming(request, callback)
      ).rejects.toThrow();

      expect(capturedError).toBeDefined();
      expect(capturedError?.message).toContain("GLM API error 500");
    });
  });
});
