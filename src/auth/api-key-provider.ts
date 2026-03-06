import type { AuthProvider } from "./types.js";

export class ApiKeyProvider implements AuthProvider {
  constructor(private apiKey: string) {
    if (!apiKey || apiKey.trim() === "") {
      throw new Error("API key cannot be empty");
    }
  }

  async getAccessToken(): Promise<string> {
    return this.apiKey;
  }

  getType(): "api_key" {
    return "api_key";
  }
}
