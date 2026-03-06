import { GlmClient } from "../glm-client.js";
import { createSession, executeStep } from "../agent/session.js";

function getApiKey(providedKey?: string): string {
  const key = providedKey || process.env.GLM_API_KEY;
  if (!key) {
    console.error("Error: GLM_API_KEY is required.");
    process.exit(1);
  }
  return key;
}

export async function handleChat(prompt: string, apiKey?: string, model: string = "glm-5", system?: string): Promise<void> {
  const key = getApiKey(apiKey);
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

export async function handleVision(prompt: string, imageUrl: string, apiKey?: string, model: string = "glm-4v-plus"): Promise<void> {
  const key = getApiKey(apiKey);
  const client = new GlmClient(key);

  try {
    const response = await client.chat({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: prompt },
          ] as unknown as string,
        },
      ],
    });

    const content = response.choices[0]?.message?.content || "(empty response from GLM Vision)";
    console.log(content);
  } catch (error) {
    console.error("Error communicating with GLM Vision:", error);
    process.exit(1);
  }
}

export async function handleEmbeddings(input: string, apiKey?: string, model: string = "embedding-3"): Promise<void> {
  const key = getApiKey(apiKey);
  const client = new GlmClient(key);

  try {
    const result = await client.embeddings(input, model);
    console.log(JSON.stringify(
      {
        dimensions: result.embeddings[0]?.length,
        count: result.embeddings.length,
        usage: result.usage,
        embeddings: result.embeddings.map((e) =>
          e.slice(0, 5).concat([NaN]).map((v) =>
            isNaN(v) ? "..." : v
          )
        ),
      },
      null,
      2
    ));
  } catch (error) {
    console.error("Error generating embeddings:", error);
    process.exit(1);
  }
}

export async function handleAgent(task: string, workingDir: string, apiKey?: string, model: string = "glm-5"): Promise<void> {
  const key = getApiKey(apiKey);
  const client = new GlmClient(key);

  console.log(`Starting agent session for task: "${task}" in directory: ${workingDir}`);
  const session = createSession(task, workingDir, model);

  try {
    let stepCount = 0;
    while (session.status !== "completed" && session.status !== "error") {
      stepCount++;
      console.log(`\n--- Executing Step ${stepCount} ---`);
      const result = await executeStep(session, client);
      
      console.log(`Action: ${result.action}`);
      if (result.details) {
        console.log(`Details:\n${result.details}`);
      }
      console.log(`Status: ${result.status}`);

      if (result.status === "completed" || result.status === "error") {
        break;
      }
    }

    console.log("\n--- Agent Session Finished ---");
    console.log(`Final Status: ${session.status}`);
    console.log(`Total Steps: ${session.steps.length}`);
  } catch (error) {
    console.error("Error during agent execution:", error);
    process.exit(1);
  }
}
