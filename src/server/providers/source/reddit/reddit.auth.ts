import { redditTokenResponseSchema } from "./reddit.schemas";
import { SourceAdapterError } from "../contracts";

type FetchLike = typeof fetch;

export type RedditRuntimeConfig = {
  clientId?: string;
  clientSecret?: string;
  userAgent?: string;
  apiBaseUrl?: string;
  authBaseUrl?: string;
};

export type RedditTokenManagerOptions = RedditRuntimeConfig & {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  clock?: () => Date;
};

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getRedditRuntimeConfig(env: Record<string, string | undefined> = process.env): RedditRuntimeConfig {
  return {
    clientId: optional(env.REDDIT_CLIENT_ID),
    clientSecret: optional(env.REDDIT_CLIENT_SECRET),
    userAgent: optional(env.REDDIT_USER_AGENT),
    apiBaseUrl: optional(env.REDDIT_API_BASE_URL),
    authBaseUrl: optional(env.REDDIT_AUTH_BASE_URL),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class RedditTokenManager {
  private readonly fetchImpl: FetchLike;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly userAgent?: string;
  private readonly authBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly clock: () => Date;
  private cached?: { accessToken: string; expiresAt: number };
  private inFlight?: Promise<string>;

  constructor(options: RedditTokenManagerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clientId = optional(options.clientId);
    this.clientSecret = optional(options.clientSecret);
    this.userAgent = optional(options.userAgent);
    this.authBaseUrl = (options.authBaseUrl ?? "https://www.reddit.com").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.backoffMs = options.backoffMs ?? 100;
    this.clock = options.clock ?? (() => new Date());
  }

  async getAccessToken(): Promise<string> {
    const now = this.clock().getTime();
    if (this.cached && this.cached.expiresAt > now + 30_000) return this.cached.accessToken;
    if (!this.inFlight) this.inFlight = this.acquire().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async acquire(): Promise<string> {
    if (!this.clientId || !this.clientSecret || !this.userAgent) {
      throw new SourceAdapterError("AUTH_NOT_CONFIGURED", "Reddit Data API credentials and a user agent are not configured.");
    }
    const url = `${this.authBaseUrl}/api/v1/access_token`;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
            "User-Agent": this.userAgent,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: "grant_type=client_credentials",
        });
        if (response.status === 429) throw new SourceAdapterError("RATE_LIMITED", "Reddit token endpoint rate limit reached.", true);
        if (response.status === 401 || response.status === 403) throw new SourceAdapterError("AUTH_FAILED", "Reddit token acquisition was rejected.");
        if (!response.ok) throw new SourceAdapterError(`HTTP_${response.status}`, "Reddit token acquisition failed.", response.status >= 500);
        let body: unknown;
        try { body = await response.json(); } catch { throw new SourceAdapterError("AUTH_FAILED", "Reddit token response was not valid JSON."); }
        const parsed = redditTokenResponseSchema.safeParse(body);
        if (!parsed.success) throw new SourceAdapterError("AUTH_FAILED", "Reddit token response failed validation.");
        const expiresInMs = Math.max(0, (parsed.data.expires_in - 30) * 1_000);
        this.cached = { accessToken: parsed.data.access_token, expiresAt: this.clock().getTime() + expiresInMs };
        return parsed.data.access_token;
      } catch (error) {
        lastError = isAbortError(error) ? new SourceAdapterError("TIMEOUT", "Reddit token request timed out.", true) : error;
        if (!(lastError instanceof SourceAdapterError)) lastError = new SourceAdapterError("REQUEST_FAILED", "Reddit token request failed.", true);
      } finally {
        clearTimeout(timeout);
      }
      if (!(lastError instanceof SourceAdapterError && lastError.retryable)) break;
      if (attempt < this.maxAttempts && this.backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(this.backoffMs * 2 ** (attempt - 1), 1_000)));
      }
    }
    if (lastError instanceof SourceAdapterError) throw lastError;
    throw new SourceAdapterError("REQUEST_FAILED", "Reddit token request failed.", true);
  }
}
