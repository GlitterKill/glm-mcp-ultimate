import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadConfig,
  validateConfig,
  mergeConfig,
  DEFAULT_CONFIG,
} from "../src/config/index.js";
import type { AppConfig, AuthConfig } from "../src/config/types.js";

describe("Config Module", () => {
  describe("DEFAULT_CONFIG", () => {
    it("should have all required top-level keys", () => {
      expect(DEFAULT_CONFIG).toHaveProperty("server");
      expect(DEFAULT_CONFIG).toHaveProperty("models");
      expect(DEFAULT_CONFIG).toHaveProperty("agent");
      expect(DEFAULT_CONFIG).toHaveProperty("persistence");
      expect(DEFAULT_CONFIG).toHaveProperty("apiBase");
    });

    it("should have correct default server config", () => {
      expect(DEFAULT_CONFIG.server.name).toBe("mcp-glm");
      expect(DEFAULT_CONFIG.server.version).toBe("2.0.0");
      expect(DEFAULT_CONFIG.server.logLevel).toBe("info");
    });

    it("should have correct default model config", () => {
      expect(DEFAULT_CONFIG.models.default).toBe("glm-5");
      expect(DEFAULT_CONFIG.models.vision).toBe("glm-4v-plus");
      expect(DEFAULT_CONFIG.models.embedding).toBe("embedding-3");
    });

    it("should have correct default agent config", () => {
      expect(DEFAULT_CONFIG.agent.maxSteps).toBe(100);
      expect(DEFAULT_CONFIG.agent.timeout).toBe(60000);
      expect(DEFAULT_CONFIG.agent.maxFileSize).toBe(50000);
      expect(DEFAULT_CONFIG.agent.maxCommandOutput).toBe(20000);
      expect(DEFAULT_CONFIG.agent.sandbox.enabled).toBe(true);
    });

    it("should have dangerous commands blocked by default", () => {
      expect(DEFAULT_CONFIG.agent.sandbox.blockedCommands).toContain("rm -rf /");
      expect(DEFAULT_CONFIG.agent.sandbox.blockedCommands).toContain("sudo");
    });
  });

  describe("loadConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should load config with API key from env", () => {
      const env = {
        GLM_API_KEY: "test-api-key",
      };
      const config = loadConfig({ env });
      expect(config.auth.type).toBe("api_key");
      expect(config.auth.apiKey).toBe("test-api-key");
    });

    it("should load config with OAuth from env", () => {
      const env = {
        GLM_OAUTH_CLIENT_ID: "client-id",
        GLM_OAUTH_CLIENT_SECRET: "client-secret",
      };
      const config = loadConfig({ env });
      expect(config.auth.type).toBe("oauth");
      expect(config.auth.oauth?.clientId).toBe("client-id");
    });

    it("should override apiBase from env", () => {
      const env = {
        GLM_API_KEY: "test-key",
        GLM_API_BASE: "https://custom.api.url",
      };
      const config = loadConfig({ env });
      expect(config.apiBase).toBe("https://custom.api.url");
    });

    it("should override log level from env", () => {
      const env = {
        GLM_API_KEY: "test-key",
        GLM_LOG_LEVEL: "debug",
      };
      const config = loadConfig({ env });
      expect(config.server.logLevel).toBe("debug");
    });

    it("should override model config from env", () => {
      const env = {
        GLM_API_KEY: "test-key",
        GLM_MODEL_DEFAULT: "custom-model",
        GLM_MODEL_VISION: "custom-vision",
        GLM_MODEL_EMBEDDING: "custom-embedding",
      };
      const config = loadConfig({ env });
      expect(config.models.default).toBe("custom-model");
      expect(config.models.vision).toBe("custom-vision");
      expect(config.models.embedding).toBe("custom-embedding");
    });

    it("should override agent config from env", () => {
      const env = {
        GLM_API_KEY: "test-key",
        GLM_AGENT_MAX_STEPS: "50",
        GLM_AGENT_TIMEOUT: "30000",
      };
      const config = loadConfig({ env });
      expect(config.agent.maxSteps).toBe(50);
      expect(config.agent.timeout).toBe(30000);
    });

    it("should override persistence config from env", () => {
      const env = {
        GLM_API_KEY: "test-key",
        GLM_PERSISTENCE_PATH: "/custom/path/db.sqlite",
        GLM_PERSISTENCE_ENABLED: "false",
      };
      const config = loadConfig({ env });
      expect(config.persistence.path).toBe("/custom/path/db.sqlite");
      expect(config.persistence.enabled).toBe(false);
    });

    it("should disable sandbox from env", () => {
      const env = {
        GLM_API_KEY: "test-key",
        GLM_SANDBOX_ENABLED: "false",
      };
      const config = loadConfig({ env });
      expect(config.agent.sandbox.enabled).toBe(false);
    });

    it("should throw error when no auth config and allowMissingAuth is false", () => {
      const env = {};
      expect(() => loadConfig({ env, allowMissingAuth: false })).toThrow();
    });

    it("should allow missing auth when allowMissingAuth is true", () => {
      const env = {};
      const config = loadConfig({ env, allowMissingAuth: true });
      expect(config.auth.type).toBe("api_key");
    });

    it("should ignore invalid numeric values", () => {
      const env = {
        GLM_API_KEY: "test-key",
        GLM_AGENT_MAX_STEPS: "invalid",
        GLM_AGENT_TIMEOUT: "-100",
      };
      const config = loadConfig({ env });
      expect(config.agent.maxSteps).toBe(100);
      expect(config.agent.timeout).toBe(60000);
    });

    it("should ignore invalid log level", () => {
      const env = {
        GLM_API_KEY: "test-key",
        GLM_LOG_LEVEL: "invalid",
      };
      const config = loadConfig({ env });
      expect(config.server.logLevel).toBe("info");
    });
  });

  describe("validateConfig", () => {
    const validAuth: AuthConfig = { type: "api_key", apiKey: "test-key" };

    it("should return empty array for valid config", () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        auth: validAuth,
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it("should detect missing API key", () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        auth: { type: "api_key", apiKey: "" },
      };
      const errors = validateConfig(config);
      expect(errors).toContain("API key is required for api_key auth type");
    });

    it("should detect missing OAuth fields", () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        auth: { type: "oauth" },
      };
      const errors = validateConfig(config);
      expect(errors).toContain("OAuth clientId is required");
      expect(errors).toContain("OAuth clientSecret is required");
      expect(errors).toContain("OAuth tokenUrl is required");
    });

    it("should detect invalid maxSteps", () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        auth: validAuth,
        agent: { ...DEFAULT_CONFIG.agent, maxSteps: 0 },
      };
      const errors = validateConfig(config);
      expect(errors).toContain("agent.maxSteps must be positive");
    });

    it("should detect invalid timeout", () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        auth: validAuth,
        agent: { ...DEFAULT_CONFIG.agent, timeout: -1 },
      };
      const errors = validateConfig(config);
      expect(errors).toContain("agent.timeout must be positive");
    });

    it("should detect invalid apiBase URL", () => {
      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        auth: validAuth,
        apiBase: "not-a-valid-url",
      };
      const errors = validateConfig(config);
      expect(errors).toContain("apiBase must be a valid URL");
    });
  });

  describe("mergeConfig", () => {
    it("should merge partial configs with defaults", () => {
      const merged = mergeConfig(
        { server: { logLevel: "debug" } },
        {}
      );
      expect(merged.server.logLevel).toBe("debug");
      expect(merged.server.name).toBe("mcp-glm");
    });

    it("should override base with override", () => {
      const merged = mergeConfig(
        { server: { logLevel: "debug" } },
        { server: { logLevel: "error" } }
      );
      expect(merged.server.logLevel).toBe("error");
    });

    it("should deeply merge nested objects", () => {
      const merged = mergeConfig(
        { agent: { maxSteps: 50 } },
        { agent: { timeout: 30000 } }
      );
      expect(merged.agent.maxSteps).toBe(50);
      expect(merged.agent.timeout).toBe(30000);
    });

    it("should merge sandbox config", () => {
      const merged = mergeConfig(
        { agent: { sandbox: { allowedPaths: ["/home"] } } },
        {}
      );
      expect(merged.agent.sandbox.allowedPaths).toContain("/home");
      expect(merged.agent.sandbox.enabled).toBe(true);
    });
  });
});
