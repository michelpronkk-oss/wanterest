import { redditCommentsResponseSchema, redditListingSchema } from "./reddit.schemas";
import { SourceAdapterError, type RateLimitMetadata } from "../contracts";
import { RedditTokenManager, type RedditTokenManagerOptions } from "./reddit.auth";

type FetchLike = typeof fetch;

export type RedditClientOptions = RedditTokenManagerOptions & {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  tokenManager?: RedditTokenManager;
};

export type RedditSearchInput = {
  query: string;
  limit: number;
  subreddit?: string;
  sort: "relevance" | "hot" | "top" | "new" | "comments";
  time?: "hour" | "day" | "week" | "month" | "year" | "all";
  excludeNsfw?: boolean;
  after?: string;
};

export type RedditCommentsInput = {
  postId: string;
  limit: number;
  depth: number;
  sort: "confidence" | "top" | "new" | "controversial" | "old" | "qa";
};

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : null;
}

function rateLimit(response: Response, clock: () => Date): RateLimitMetadata {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  const limit = Number(response.headers.get("x-ratelimit-limit"));
  const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
  const resetAt = Number.isFinite(resetSeconds) && resetSeconds >= 0
    ? new Date(clock().getTime() + resetSeconds * 1_000).toISOString()
    : null;
  const retry = retryAfterMs(response);
  return {
    provider: "reddit-data-api",
    remaining: Number.isFinite(remaining) && remaining >= 0 ? Math.floor(remaining) : null,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null,
    retryAfterMs: retry ?? (Number.isFinite(resetSeconds) && resetSeconds >= 0 ? Math.round(resetSeconds * 1_000) : null),
    resetAt,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class RedditClient {
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly userAgent?: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly clock: () => Date;
  private readonly tokenManager: RedditTokenManager;

  constructor(options: RedditClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://oauth.reddit.com").replace(/\/$/, "");
    this.userAgent = options.userAgent?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.backoffMs = options.backoffMs ?? 100;
    this.clock = options.clock ?? (() => new Date());
    this.tokenManager = options.tokenManager ?? new RedditTokenManager({ ...options, fetchImpl: this.fetchImpl, clock: this.clock });
  }

  async searchSubmissions(input: RedditSearchInput): Promise<{ listing: unknown; rateLimit: RateLimitMetadata; providerAfter?: string }> {
    const path = input.subreddit ? `/r/${encodeURIComponent(input.subreddit)}/search` : "/search";
    const params: Record<string, string | undefined> = {
      q: input.query,
      sort: input.sort,
      limit: String(Math.min(Math.max(input.limit, 1), 100)),
      type: "link",
      restrict_sr: input.subreddit ? "true" : undefined,
      t: input.time,
      include_over_18: input.excludeNsfw ? "false" : undefined,
      after: input.after,
    };
    const result = await this.getJson(path, params);
    const parsed = redditListingSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "Reddit search response failed validation.");
    return { listing: parsed.data, rateLimit: result.rateLimit, providerAfter: parsed.data.data.after ?? undefined };
  }

  async getPostComments(input: RedditCommentsInput): Promise<{ response: unknown; rateLimit: RateLimitMetadata }> {
    if (!/^[A-Za-z0-9]+$/.test(input.postId)) throw new SourceAdapterError("INVALID_POST_ID", "Reddit post id is invalid.");
    const result = await this.getJson(`/comments/${input.postId}`, {
      limit: String(Math.min(Math.max(input.limit, 0), 50)),
      depth: String(Math.min(Math.max(input.depth, 0), 3)),
      sort: input.sort,
    });
    const parsed = redditCommentsResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "Reddit comments response failed validation.");
    return { response: parsed.data, rateLimit: result.rateLimit };
  }

  async getPost(postId: string): Promise<{ post: unknown; rateLimit: RateLimitMetadata }> {
    if (!/^[A-Za-z0-9]+$/.test(postId)) throw new SourceAdapterError("INVALID_POST_ID", "Reddit post id is invalid.");
    const result = await this.getJson(`/by_id/t3_${postId}`, {});
    const parsed = redditListingSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "Reddit post response failed validation.");
    const children = parsed.data.data.children;
    if (!Array.isArray(children) || children.length === 0) throw new SourceAdapterError("NOT_FOUND", "Reddit post was not found.");
    const child = children[0];
    if (!child || typeof child !== "object" || !("kind" in child) || child.kind !== "t3" || !("data" in child)) {
      throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "Reddit post response did not contain a submission.");
    }
    return { post: child, rateLimit: result.rateLimit };
  }

  async healthCheck(): Promise<RateLimitMetadata> {
    const result = await this.getJson("/r/all/new", { limit: "1" });
    const parsed = redditListingSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "Reddit health response failed validation.");
    return result.rateLimit;
  }

  private async getJson(path: string, values: Record<string, string | undefined>): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    url.searchParams.set("raw_json", "1");
    for (const [key, value] of Object.entries(values)) if (value !== undefined) url.searchParams.set(key, value);
    let lastError: unknown;
    let refreshAttempted = false;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const token = await this.tokenManager.getAccessToken();
        const response = await this.fetchImpl(url.toString(), {
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(this.userAgent ? { "User-Agent": this.userAgent } : {}),
            Accept: "application/json",
          },
        });
        const limits = rateLimit(response, this.clock);
        if (response.status === 401 && !refreshAttempted) {
          refreshAttempted = true;
          this.tokenManager.invalidate();
          attempt -= 1;
          continue;
        }
        if (response.status === 401) throw new SourceAdapterError("AUTH_FAILED", "Reddit API authentication was rejected.");
        if (response.status === 403) throw new SourceAdapterError("FORBIDDEN", "Reddit API access was forbidden.");
        if (response.status === 429) throw new SourceAdapterError("RATE_LIMITED", "Reddit API rate limit reached.", true);
        if (!response.ok) throw new SourceAdapterError(`HTTP_${response.status}`, "Reddit API request failed.", response.status >= 500);
        let body: unknown;
        try { body = await response.json(); } catch { throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "Reddit API response was not valid JSON."); }
        return { body, rateLimit: limits };
      } catch (error) {
        lastError = isAbortError(error) ? new SourceAdapterError("TIMEOUT", "Reddit API request timed out.", true) : error;
        if (!(lastError instanceof SourceAdapterError)) lastError = new SourceAdapterError("REQUEST_FAILED", "Reddit API request failed.", true);
      } finally {
        clearTimeout(timeout);
      }
      if (!(lastError instanceof SourceAdapterError && lastError.retryable)) break;
      if (attempt < this.maxAttempts && this.backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(this.backoffMs * 2 ** (attempt - 1), 1_000)));
      }
    }
    if (lastError instanceof SourceAdapterError) throw lastError;
    throw new SourceAdapterError("REQUEST_FAILED", "Reddit API request failed.", true);
  }
}

export function encodeRedditCursor(after: string): string {
  if (!after.trim()) throw new SourceAdapterError("INVALID_CURSOR", "Reddit provider cursor is empty.");
  return `reddit:v1:${Buffer.from(JSON.stringify({ after }), "utf8").toString("base64url")}`;
}

export function decodeRedditCursor(cursor: string): string {
  if (!cursor.startsWith("reddit:v1:")) throw new SourceAdapterError("INVALID_CURSOR", "Reddit cursor is invalid.");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor.slice("reddit:v1:".length), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !("after" in parsed) || typeof parsed.after !== "string" || !parsed.after.trim()) {
      throw new Error("invalid after");
    }
    return parsed.after;
  } catch {
    throw new SourceAdapterError("INVALID_CURSOR", "Reddit cursor is invalid.");
  }
}
