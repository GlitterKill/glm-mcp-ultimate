import type { AuthConfig } from "../auth/types.js";

export interface ServerConfig {
  name: string;
  version: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface ModelConfig {
  default: string;
  vision: string;
  embedding: string;
}

export interface SandboxConfig {
  enabled: boolean;
  allowedPaths: string[];
  blockedCommands: string[];
}

export interface AgentConfig {
  maxSteps: number;
  timeout: number;
  maxFileSize: number;
  maxCommandOutput: number;
  sandbox: SandboxConfig;
}

export interface PersistenceConfig {
  enabled: boolean;
  path: string;
}

export interface AppConfig {
  server: ServerConfig;
  auth: AuthConfig;
  models: ModelConfig;
  agent: AgentConfig;
  persistence: PersistenceConfig;
  apiBase: string;
}

export const DEFAULT_CONFIG: Omit<AppConfig, "auth"> = {
  server: {
    name: "glm-mcp-ultimate",
    version: "2.0.0",
    logLevel: "info",
  },
  models: {
    default: "glm-5",
    vision: "glm-4v-plus",
    embedding: "embedding-3",
  },
  agent: {
    maxSteps: 100,
    timeout: 60000,
    maxFileSize: 50000,
    maxCommandOutput: 20000,
    sandbox: {
      enabled: true,
      allowedPaths: [],
      blockedCommands: ["rm -rf /", "sudo", "chmod 777", "mkfs", "dd if="],
    },
  },
  persistence: {
    enabled: true,
    path: "./data/sessions.db",
  },
  apiBase: "https://api.z.ai/api/coding/paas/v4",
};

export const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;
