import type { AppConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { authConfigFromEnv } from "../auth/factory.js";

export interface ConfigLoadOptions {
  env?: NodeJS.ProcessEnv;
  allowMissingAuth?: boolean;
}

export function loadConfig(options: ConfigLoadOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const config: AppConfig = {
    server: { ...DEFAULT_CONFIG.server },
    models: { ...DEFAULT_CONFIG.models },
    agent: {
      ...DEFAULT_CONFIG.agent,
      sandbox: { ...DEFAULT_CONFIG.agent.sandbox, blockedCommands: [...DEFAULT_CONFIG.agent.sandbox.blockedCommands] },
    },
    persistence: { ...DEFAULT_CONFIG.persistence },
    apiBase: DEFAULT_CONFIG.apiBase,
    auth: { type: "api_key", apiKey: "" },
  };

  try {
    config.auth = authConfigFromEnv(env as NodeJS.ProcessEnv);
  } catch (error) {
    if (!options.allowMissingAuth) {
      throw error;
    }
  }

  if (env.GLM_API_BASE) {
    config.apiBase = env.GLM_API_BASE;
  }

  if (env.GLM_LOG_LEVEL) {
    const level = env.GLM_LOG_LEVEL.toLowerCase();
    if (["debug", "info", "warn", "error"].includes(level)) {
      config.server.logLevel = level as AppConfig["server"]["logLevel"];
    }
  }

  if (env.GLM_MODEL_DEFAULT) {
    config.models.default = env.GLM_MODEL_DEFAULT;
  }

  if (env.GLM_MODEL_VISION) {
    config.models.vision = env.GLM_MODEL_VISION;
  }

  if (env.GLM_MODEL_EMBEDDING) {
    config.models.embedding = env.GLM_MODEL_EMBEDDING;
  }

  if (env.GLM_AGENT_MAX_STEPS) {
    const maxSteps = parseInt(env.GLM_AGENT_MAX_STEPS, 10);
    if (!isNaN(maxSteps) && maxSteps > 0) {
      config.agent.maxSteps = maxSteps;
    }
  }

  if (env.GLM_AGENT_TIMEOUT) {
    const timeout = parseInt(env.GLM_AGENT_TIMEOUT, 10);
    if (!isNaN(timeout) && timeout > 0) {
      config.agent.timeout = timeout;
    }
  }

  if (env.GLM_PERSISTENCE_PATH) {
    config.persistence.path = env.GLM_PERSISTENCE_PATH;
  }

  if (env.GLM_PERSISTENCE_ENABLED === "false") {
    config.persistence.enabled = false;
  }

  if (env.GLM_SANDBOX_ENABLED === "false") {
    config.agent.sandbox.enabled = false;
  }

  return config;
}

export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];

  if (config.auth.type === "api_key") {
    if (!config.auth.apiKey || config.auth.apiKey.trim() === "") {
      errors.push("API key is required for api_key auth type");
    }
  } else if (config.auth.type === "oauth") {
    if (!config.auth.oauth?.clientId) {
      errors.push("OAuth clientId is required");
    }
    if (!config.auth.oauth?.clientSecret) {
      errors.push("OAuth clientSecret is required");
    }
    if (!config.auth.oauth?.tokenUrl) {
      errors.push("OAuth tokenUrl is required");
    }
  }

  if (config.agent.maxSteps <= 0) {
    errors.push("agent.maxSteps must be positive");
  }

  if (config.agent.timeout <= 0) {
    errors.push("agent.timeout must be positive");
  }

  if (config.agent.maxFileSize <= 0) {
    errors.push("agent.maxFileSize must be positive");
  }

  if (config.agent.maxCommandOutput <= 0) {
    errors.push("agent.maxCommandOutput must be positive");
  }

  if (!config.apiBase || !isValidUrl(config.apiBase)) {
    errors.push("apiBase must be a valid URL");
  }

  return errors;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function mergeConfig(
  base: Partial<AppConfig>,
  override: Partial<AppConfig>
): AppConfig {
  const merged = {
    ...DEFAULT_CONFIG,
    ...base,
    ...override,
    server: { ...DEFAULT_CONFIG.server, ...base.server, ...override.server },
    models: { ...DEFAULT_CONFIG.models, ...base.models, ...override.models },
    agent: {
      ...DEFAULT_CONFIG.agent,
      ...base.agent,
      ...override.agent,
      sandbox: {
        ...DEFAULT_CONFIG.agent.sandbox,
        ...(base.agent?.sandbox ?? {}),
        ...(override.agent?.sandbox ?? {}),
      },
    },
    persistence: {
      ...DEFAULT_CONFIG.persistence,
      ...base.persistence,
      ...override.persistence,
    },
  } as unknown as AppConfig;

  if (base.auth || override.auth) {
    merged.auth = { ...base.auth, ...override.auth } as AppConfig["auth"];
  }

  return merged;
}
