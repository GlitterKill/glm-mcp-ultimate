import { GlmClient } from "../glm-client.js";

export async function handleChat(prompt: string, apiKey?: string, model: string = "glm-5", system?: string): Promise<void> {
  const key = apiKey || process.env.GLM_API_KEY;
  if (!key) {
    console.error("Error: GLM_API_KEY is required.");
    process.exit(1);
  }

  const client = new GlmClient(key);
  const messages = [];
  if (system) {
    messages.push({ role: "system" as const, content: system });
  }
  messages.push({ role: "user" as const, content: prompt });

  try {
    const response = await client.chat({ model, messages });
    const content = response.choices[0]?.message?.content || "(empty response)";
    console.log(content);
  } catch (error) {
    console.error("Error communicating with GLM:", error);
    process.exit(1);
  }
}
