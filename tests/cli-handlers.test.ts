import { describe, it, expect, vi } from "vitest";
import { handleChat } from "../src/cli/handlers.js";

vi.mock("../src/glm-client.js", () => {
  return {
    GlmClient: vi.fn().mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Mocked response" } }],
      }),
    })),
  };
});

describe("CLI Handlers", () => {
  it("should handle chat command", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleChat("Hello", "test-key");
    expect(consoleSpy).toHaveBeenCalledWith("Mocked response");
    consoleSpy.mockRestore();
  });
});
