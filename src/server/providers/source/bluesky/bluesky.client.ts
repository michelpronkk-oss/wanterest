import {
  blueskyRequestMetadataSchema,
  blueskySearchResponseSchema,
  type BlueskySearchResponse,
} from "./bluesky.schemas";
import {
  SourceAdapterError,
  type RateLimitMetadata,
  type SourceDiscoveryRequest,
} from "../contracts";

type FetchLike = typeof fetch;

export type BlueskySearchInput = {
  query: string;
  limit: number;
  cursor?: string;
  windowStart?: string;
  windowEnd?: string;
  requestMetadata: SourceDiscoveryRequest["requestMetadata"];
};

export type BlueskyClientOptions = {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  clock?: () => Date;
};

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

function rateLimit(response: Response): RateLimitMetadata {
  const remaining = Number(response.headers.get("ratelimit-remaining"));
  const limit = Number(response.headers.get("ratelimit-limit"));
  return {
    provider: "bluesky-appview",
    remaining: Number.isInteger(remaining) && remaining >= 0 ? remaining : null,
    limit: Number.isInteger(limit) && limit > 0 ? limit : null,
    retryAfterMs: retryAfterMs(response),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export class BlueskyClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(options: BlueskyClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.bsky.app").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.backoffMs = options.backoffMs ?? 100;
  }

  async searchPosts(input: BlueskySearchInput): Promise<{ response: BlueskySearchResponse; rateLimit: RateLimitMetadata }> {
    if (input.cursor) {
      throw new SourceAdapterError("PAGINATION_UNAVAILABLE", "Bluesky AppView cursor pagination is disabled for V1.");
    }
    const metadata = blueskyRequestMetadataSchema.parse(input.requestMetadata);
    const url = new URL(`${this.baseUrl}/xrpc/app.bsky.feed.searchPosts`);
    url.searchParams.set("q", input.query);
    url.searchParams.set("limit", String(Math.min(input.limit, 20)));
    if (input.windowStart) url.searchParams.set("since", dateOnly(input.windowStart));
    if (input.windowEnd) url.searchParams.set("until", dateOnly(input.windowEnd));
    const lang = metadata.lang ?? metadata.langs?.[0];
    if (lang) url.searchParams.set("lang", lang);
    if (metadata.sort) url.searchParams.set("sort", metadata.sort);
    if (metadata.tag) url.searchParams.set("tag", metadata.tag);

    const result = await this.getJson(url.toString());
    const parsed = blueskySearchResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "Bluesky search response failed validation.");
    return { response: parsed.data, rateLimit: result.rateLimit };
  }

  async healthCheck(): Promise<RateLimitMetadata> {
    const result = await this.searchPosts({ query: "atproto", limit: 1, requestMetadata: {} });
    return result.rateLimit;
  }

  private async getJson(url: string): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let retry = false;
      try {
        const response = await this.fetchImpl(url, { signal: controller.signal });
        const limits = rateLimit(response);
        if (response.status === 429) throw new SourceAdapterError("RATE_LIMITED", "Bluesky rate limit reached.", true);
        if (!response.ok) throw new SourceAdapterError(`HTTP_${response.status}`, "Bluesky request failed.", response.status >= 500);
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "Bluesky response was not valid JSON.");
        }
        return { body, rateLimit: limits };
      } catch (error) {
        lastError = error;
        if (isAbortError(error)) {
          lastError = new SourceAdapterError("TIMEOUT", "Bluesky request timed out.", true);
        }
        if (!(error instanceof SourceAdapterError) && !isAbortError(error)) {
          lastError = new SourceAdapterError("REQUEST_FAILED", "Bluesky request failed.", true);
        }
        retry = lastError instanceof SourceAdapterError && lastError.retryable;
      } finally {
        clearTimeout(timeout);
      }
      if (!retry) break;
      if (attempt < this.maxAttempts && this.backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(this.backoffMs * 2 ** (attempt - 1), 1_000)));
      }
    }
    if (lastError instanceof SourceAdapterError) throw lastError;
    throw new SourceAdapterError("REQUEST_FAILED", "Bluesky request failed.", true);
  }
}
