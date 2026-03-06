import type { GlmChatRequest, GlmChatResponse } from "./types.js";

const GLM_API_BASE =
  process.env.GLM_API_BASE || "https://api.z.ai/api/coding/paas/v4";

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
