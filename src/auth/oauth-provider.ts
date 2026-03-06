import type { AuthProvider, AuthConfig, OAuthTokenResponse } from "./types.js";

export class OAuthProvider implements AuthProvider {
  private accessToken?: string;
  private expiresAt?: number;
  private storedRefreshToken?: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenUrl: string;

  constructor(config: NonNullable<AuthConfig["oauth"]>) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error("OAuth clientId and clientSecret are required");
    }
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.tokenUrl = config.tokenUrl;
    this.accessToken = config.accessToken;
    this.expiresAt = config.expiresAt;
    this.storedRefreshToken = config.refreshToken;
  }

  async getAccessToken(): Promise<string> {
    if (!this.accessToken && !this.storedRefreshToken) {
      throw new Error("No access token available");
    }
    if (this.isTokenExpired()) {
      await this.refresh();
    }
    if (!this.accessToken) {
      throw new Error("No access token available");
    }
    return this.accessToken;
  }

  getType(): "oauth" {
    return "oauth";
  }

  private isTokenExpired(): boolean {
    if (!this.expiresAt) return !this.accessToken;
    return Date.now() >= this.expiresAt - 60000;
  }

  async refresh(): Promise<void> {
    if (!this.storedRefreshToken) {
      throw new Error("No refresh token available");
    }

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.storedRefreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as OAuthTokenResponse;
    this.accessToken = data.access_token;
    if (data.expires_in) {
      this.expiresAt = Date.now() + data.expires_in * 1000;
    }
    if (data.refresh_token) {
      this.storedRefreshToken = data.refresh_token;
    }
  }

  // Alias for refresh() to match AuthProvider interface method naming convention if needed
  // though refresh() is already defined as async above.
  async refreshToken(): Promise<void> {
    return this.refresh();
  }

  setRefreshToken(token: string): void {
    this.storedRefreshToken = token;
  }

  getExpiresAt(): number | undefined {
    return this.expiresAt;
  }
}
