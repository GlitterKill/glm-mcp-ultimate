import type { AuthConfig, AuthProvider } from "./types.js";
import { ApiKeyProvider } from "./api-key-provider.js";
import { OAuthProvider } from "./oauth-provider.js";

export function createAuthProvider(config: AuthConfig): AuthProvider {
  switch (config.type) {
    case "api_key":
      if (!config.apiKey) {
        throw new Error("API key is required for api_key auth type");
      }
      return new ApiKeyProvider(config.apiKey);
    case "oauth":
      if (!config.oauth) {
        throw new Error("OAuth configuration is required for oauth auth type");
      }
      return new OAuthProvider(config.oauth);
    default:
      throw new Error(`Unknown auth type: ${(config as { type: string }).type}`);
  }
}

export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const apiKey = env.GLM_API_KEY;
  if (apiKey && apiKey.trim() !== "") {
    return { type: "api_key", apiKey };
  }

  const clientId = env.GLM_OAUTH_CLIENT_ID;
  const clientSecret = env.GLM_OAUTH_CLIENT_SECRET;

  if (clientId && clientSecret) {
    return {
      type: "oauth",
      oauth: {
        clientId,
        clientSecret,
        tokenUrl: env.GLM_OAUTH_TOKEN_URL || "https://api.z.ai/oauth/token",
        refreshToken: env.GLM_OAUTH_REFRESH_TOKEN,
        accessToken: env.GLM_OAUTH_ACCESS_TOKEN,
        expiresAt: env.GLM_OAUTH_EXPIRES_AT
          ? parseInt(env.GLM_OAUTH_EXPIRES_AT, 10)
          : undefined,
      },
    };
  }

  throw new Error(
    "No valid authentication configuration found. Set GLM_API_KEY or GLM_OAUTH_CLIENT_ID + GLM_OAUTH_CLIENT_SECRET"
  );
}
