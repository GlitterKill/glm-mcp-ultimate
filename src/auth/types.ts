export interface AuthConfig {
  type: "api_key" | "oauth";
  apiKey?: string;
  oauth?: {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
    refreshToken?: string;
    accessToken?: string;
    expiresAt?: number;
  };
}

export interface AuthProvider {
  getAccessToken(): Promise<string>;
  getType(): "api_key" | "oauth";
  refreshToken?(): Promise<void>;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
}
