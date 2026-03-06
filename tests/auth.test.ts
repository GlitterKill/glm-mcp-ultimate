import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ApiKeyProvider } from "../src/auth/api-key-provider.js";
import { OAuthProvider } from "../src/auth/oauth-provider.js";
import { createAuthProvider, authConfigFromEnv } from "../src/auth/factory.js";
import type { AuthConfig } from "../src/auth/types.js";

describe("Auth Module", () => {
  describe("ApiKeyProvider", () => {
    it("should return API key as access token", async () => {
      const provider = new ApiKeyProvider("test-api-key");
      const token = await provider.getAccessToken();
      expect(token).toBe("test-api-key");
    });

    it("should return api_key as type", () => {
      const provider = new ApiKeyProvider("test-api-key");
      expect(provider.getType()).toBe("api_key");
    });

    it("should throw error for empty API key", () => {
      expect(() => new ApiKeyProvider("")).toThrow("API key cannot be empty");
    });

    it("should throw error for whitespace-only API key", () => {
      expect(() => new ApiKeyProvider("   ")).toThrow("API key cannot be empty");
    });
  });

  describe("OAuthProvider", () => {
    const validConfig: NonNullable<AuthConfig["oauth"]> = {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      tokenUrl: "https://example.com/token",
      accessToken: "test-access-token",
      expiresAt: Date.now() + 3600000,
    };

    it("should return access token when valid", async () => {
      const provider = new OAuthProvider(validConfig);
      const token = await provider.getAccessToken();
      expect(token).toBe("test-access-token");
    });

    it("should return oauth as type", () => {
      const provider = new OAuthProvider(validConfig);
      expect(provider.getType()).toBe("oauth");
    });

    it("should throw error for missing clientId", () => {
      expect(
        () =>
          new OAuthProvider({
            ...validConfig,
            clientId: "",
          })
      ).toThrow("OAuth clientId and clientSecret are required");
    });

    it("should throw error for missing clientSecret", () => {
      expect(
        () =>
          new OAuthProvider({
            ...validConfig,
            clientSecret: "",
          })
      ).toThrow("OAuth clientId and clientSecret are required");
    });

    it("should throw error when no access token available", async () => {
      const provider = new OAuthProvider({
        ...validConfig,
        accessToken: undefined,
        expiresAt: undefined,
      });
      await expect(provider.getAccessToken()).rejects.toThrow(
        "No access token available"
      );
    });

    it("should attempt refresh when token is expired", async () => {
      const provider = new OAuthProvider({
        ...validConfig,
        expiresAt: Date.now() - 1000,
        refreshToken: "test-refresh-token",
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          expires_in: 3600,
        }),
      });
      global.fetch = fetchMock;

      const token = await provider.getAccessToken();
      expect(token).toBe("new-access-token");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/token",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("should throw error on refresh failure", async () => {
      const provider = new OAuthProvider({
        ...validConfig,
        expiresAt: Date.now() - 1000,
        refreshToken: "test-refresh-token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await expect(provider.getAccessToken()).rejects.toThrow(
        "Token refresh failed"
      );
    });

    it("should throw error when no refresh token available", async () => {
      const provider = new OAuthProvider({
        ...validConfig,
        expiresAt: Date.now() - 1000,
        refreshToken: undefined,
      });

      await expect(provider.getAccessToken()).rejects.toThrow(
        "No refresh token available"
      );
    });
  });

  describe("createAuthProvider", () => {
    it("should create ApiKeyProvider for api_key type", () => {
      const config: AuthConfig = { type: "api_key", apiKey: "test-key" };
      const provider = createAuthProvider(config);
      expect(provider).toBeInstanceOf(ApiKeyProvider);
    });

    it("should create OAuthProvider for oauth type", () => {
      const config: AuthConfig = {
        type: "oauth",
        oauth: {
          clientId: "id",
          clientSecret: "secret",
          tokenUrl: "https://example.com/token",
        },
      };
      const provider = createAuthProvider(config);
      expect(provider).toBeInstanceOf(OAuthProvider);
    });

    it("should throw error for api_key without apiKey", () => {
      const config = { type: "api_key" as const };
      expect(() => createAuthProvider(config)).toThrow("API key is required");
    });

    it("should throw error for oauth without oauth config", () => {
      const config = { type: "oauth" as const };
      expect(() => createAuthProvider(config)).toThrow(
        "OAuth configuration is required"
      );
    });
  });

  describe("authConfigFromEnv", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.GLM_API_KEY;
      delete process.env.GLM_OAUTH_CLIENT_ID;
      delete process.env.GLM_OAUTH_CLIENT_SECRET;
      delete process.env.GLM_OAUTH_TOKEN_URL;
      delete process.env.GLM_OAUTH_REFRESH_TOKEN;
      delete process.env.GLM_OAUTH_ACCESS_TOKEN;
      delete process.env.GLM_OAUTH_EXPIRES_AT;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should create api_key config from GLM_API_KEY", () => {
      process.env.GLM_API_KEY = "test-api-key";
      const config = authConfigFromEnv();
      expect(config).toEqual({ type: "api_key", apiKey: "test-api-key" });
    });

    it("should create oauth config from OAuth env vars", () => {
      process.env.GLM_OAUTH_CLIENT_ID = "client-id";
      process.env.GLM_OAUTH_CLIENT_SECRET = "client-secret";
      process.env.GLM_OAUTH_TOKEN_URL = "https://custom.token.url";
      process.env.GLM_OAUTH_REFRESH_TOKEN = "refresh-token";
      process.env.GLM_OAUTH_ACCESS_TOKEN = "access-token";
      process.env.GLM_OAUTH_EXPIRES_AT = "1234567890";

      const config = authConfigFromEnv();
      expect(config).toEqual({
        type: "oauth",
        oauth: {
          clientId: "client-id",
          clientSecret: "client-secret",
          tokenUrl: "https://custom.token.url",
          refreshToken: "refresh-token",
          accessToken: "access-token",
          expiresAt: 1234567890,
        },
      });
    });

    it("should use default token URL when not specified", () => {
      process.env.GLM_OAUTH_CLIENT_ID = "client-id";
      process.env.GLM_OAUTH_CLIENT_SECRET = "client-secret";

      const config = authConfigFromEnv();
      expect(config.oauth?.tokenUrl).toBe("https://api.z.ai/oauth/token");
    });

    it("should prefer API key over OAuth when both are set", () => {
      process.env.GLM_API_KEY = "test-api-key";
      process.env.GLM_OAUTH_CLIENT_ID = "client-id";
      process.env.GLM_OAUTH_CLIENT_SECRET = "client-secret";

      const config = authConfigFromEnv();
      expect(config.type).toBe("api_key");
    });

    it("should throw error when no auth config is available", () => {
      expect(() => authConfigFromEnv()).toThrow(
        "No valid authentication configuration found"
      );
    });
  });
});
