import { SourceAdapterError, type RateLimitMetadata } from "../contracts";
import { xPostLookupResponseSchema, xSearchResponseSchema, type XSearchResponse } from "./x.schemas";
import { X_PROVIDER_MIN_RESULTS } from "./x.cost";
import { validateXQuery } from "./x.query";

type FetchLike = typeof fetch;

export type XClientOptions = {
  fetchImpl?: FetchLike;
  token?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  clock?: () => Date;
};

export type XRecentSearchInput = {
  query: string;
  maxResults: number;
  paginationToken?: string;
  startTime?: string;
  endTime?: string;
};

type XRequestResult = { body: unknown; rateLimit: RateLimitMetadata };

function officialBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !["api.x.com", "api.twitter.com"].includes(parsed.hostname) || !["", "/"].includes(parsed.pathname)) {
    throw new Error("X API base URL must be an official HTTPS X API host.");
  }
  return `https://${parsed.hostname}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function headerNumber(response: Response, name: string): number | null {
  const value = Number(response.headers.get(name));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function rateLimit(response: Response, clock: () => Date): RateLimitMetadata {
  const reset = headerNumber(response, "x-rate-limit-reset");
  const retryAfter = Number(response.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.round(retryAfter * 1_000) : null;
  return {
    provider: "x-api-v2",
    mode: "authenticated",
    remaining: headerNumber(response, "x-rate-limit-remaining"),
    limit: headerNumber(response, "x-rate-limit-limit"),
    retryAfterMs: retryAfterMs ?? (reset === null ? null : Math.max(0, reset * 1_000 - clock().getTime())),
    resetAt: reset === null ? null : new Date(reset * 1_000).toISOString(),
  };
}

function bodyMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  if ("detail" in body && typeof body.detail === "string") return body.detail.slice(0, 400);
  if ("title" in body && typeof body.title === "string") return body.title.slice(0, 400);
  if ("message" in body && typeof body.message === "string") return body.message.slice(0, 400);
  if ("errors" in body && Array.isArray(body.errors)) {
    const first = body.errors[0];
    if (first && typeof first === "object") {
      if ("detail" in first && typeof first.detail === "string") return first.detail.slice(0, 400);
      if ("title" in first && typeof first.title === "string") return first.title.slice(0, 400);
    }
  }
  return "";
}

function creditFailure(status: number, message: string): boolean {
  const lower = message.toLowerCase();
  return status === 402 || lower.includes("credit") || lower.includes("payment") || lower.includes("subscription") || lower.includes("monthly product cap") || lower.includes("usage cap");
}

function classifyFailure(response: Response, body: unknown): SourceAdapterError {
  const message = bodyMessage(body);
  if (creditFailure(response.status, message)) return new SourceAdapterError("INSUFFICIENT_CREDITS", "X API credits or product allowance are unavailable.");
  if (response.status === 400) return new SourceAdapterError("INVALID_QUERY", "X API query or parameters were invalid.");
  if (response.status === 401) return new SourceAdapterError("AUTH_FAILED", "X API bearer authentication was rejected.");
  if (response.status === 403) return new SourceAdapterError("FORBIDDEN", "X API access was forbidden.");
  if (response.status === 404) return new SourceAdapterError("POST_UNAVAILABLE", "X post is unavailable.");
  if (response.status === 429) return new SourceAdapterError("RATE_LIMITED", "X API rate limit was reached.", true);
  return new SourceAdapterError(`HTTP_${response.status}`, "X API request failed.", response.status >= 500);
}

export class XClient {
  private readonly fetchImpl: FetchLike;
  private readonly token?: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly clock: () => Date;
  private lastRateLimit?: RateLimitMetadata;
  private lastFailure?: { code: string; summary: string };

  constructor(options: XClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.token = options.token?.trim() || undefined;
    this.apiBaseUrl = officialBaseUrl(options.apiBaseUrl ?? "https://api.x.com");
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.backoffMs = options.backoffMs ?? 100;
    this.clock = options.clock ?? (() => new Date());
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  getHealthSnapshot(): { hasToken: boolean; rateLimit?: RateLimitMetadata; failure?: { code: string; summary: string } } {
    return { hasToken: this.hasToken, rateLimit: this.lastRateLimit, failure: this.lastFailure };
  }

  async searchRecent(input: XRecentSearchInput): Promise<{ response: XSearchResponse; rateLimit: RateLimitMetadata }> {
    const queryValidation = validateXQuery(input.query);
    if (!queryValidation.valid) throw new SourceAdapterError("INVALID_QUERY", `X query failed local validation: ${queryValidation.reason}.`);
    const params: Record<string, string | undefined> = {
      query: input.query,
      max_results: String(Math.min(Math.max(input.maxResults, X_PROVIDER_MIN_RESULTS), 100)),
      pagination_token: input.paginationToken,
      start_time: input.startTime,
      end_time: input.endTime,
      "tweet.fields": "author_id,conversation_id,created_at,edit_history_tweet_ids,entities,in_reply_to_user_id,lang,possibly_sensitive,public_metrics,referenced_tweets,reply_settings,text",
      expansions: "author_id",
      "user.fields": "id,name,protected,username",
    };
    const result = await this.getJson("/2/tweets/search/recent", params);
    const parsed = xSearchResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "X recent-search response failed validation.");
    return { response: parsed.data, rateLimit: result.rateLimit };
  }

  async getPostById(id: string): Promise<{ response: XSearchResponse; rateLimit: RateLimitMetadata }> {
    if (!/^\d{1,30}$/.test(id)) throw new SourceAdapterError("INVALID_POST_ID", "X post ID is invalid.");
    const result = await this.getJson(`/2/tweets/${encodeURIComponent(id)}`, {
      "tweet.fields": "author_id,conversation_id,created_at,edit_history_tweet_ids,entities,in_reply_to_user_id,lang,possibly_sensitive,public_metrics,referenced_tweets,reply_settings,text",
      expansions: "author_id",
      "user.fields": "id,name,protected,username",
    });
    const parsed = xPostLookupResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "X post lookup response failed validation.");
    return {
      response: {
        ...parsed.data,
        data: parsed.data.data ? [parsed.data.data] : undefined,
      },
      rateLimit: result.rateLimit,
    };
  }

  private async getJson(path: string, values: Record<string, string | undefined>): Promise<XRequestResult> {
    if (!this.token) throw new SourceAdapterError("CONFIGURATION_MISSING", "X API bearer token is not configured.");
    const url = new URL(`${this.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(values)) if (value !== undefined) url.searchParams.set(key, value);
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url.toString(), {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.token}`,
            "User-Agent": "Wanterest/1.0 (source-connector)",
          },
        });
        const limits = rateLimit(response, this.clock);
        this.lastRateLimit = limits;
        let body: unknown;
        try {
          const text = await response.text();
          body = text ? JSON.parse(text) : undefined;
        } catch {
          if (!response.ok) body = undefined;
          else throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "X API response was not valid JSON.");
        }
        if (!response.ok) {
          const failure = classifyFailure(response, body);
          this.lastFailure = { code: failure.code, summary: failure.message };
          throw failure;
        }
        this.lastFailure = undefined;
        return { body, rateLimit: limits };
      } catch (error) {
        lastError = isAbortError(error) ? new SourceAdapterError("TIMEOUT", "X API request timed out.", true) : error;
        if (!(lastError instanceof SourceAdapterError)) lastError = new SourceAdapterError("REQUEST_FAILED", "X API request failed.", true);
      } finally {
        clearTimeout(timeout);
      }
      if (!(lastError instanceof SourceAdapterError && lastError.retryable)) break;
      if (attempt < this.maxAttempts && this.backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(this.backoffMs * 2 ** (attempt - 1), 1_000)));
      }
    }
    if (lastError instanceof SourceAdapterError) throw lastError;
    throw new SourceAdapterError("REQUEST_FAILED", "X API request failed.", true);
  }
}

export function encodeXCursor(input: { nextToken: string; pagesFetched: number; billablePosts: number }): string {
  if (!input.nextToken.trim() || input.nextToken.length > 1_000 || !Number.isInteger(input.pagesFetched) || input.pagesFetched < 1 || input.pagesFetched > 2 || !Number.isInteger(input.billablePosts) || input.billablePosts < 0) {
    throw new SourceAdapterError("INVALID_CURSOR", "X pagination cursor is invalid.");
  }
  return `x:v1:${Buffer.from(JSON.stringify(input), "utf8").toString("base64url")}`;
}

export function decodeXCursor(cursor: string): { nextToken: string; pagesFetched: number; billablePosts: number } {
  if (!cursor.startsWith("x:v1:")) throw new SourceAdapterError("INVALID_CURSOR", "X pagination cursor is invalid.");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor.slice("x:v1:".length), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !("nextToken" in parsed) || typeof parsed.nextToken !== "string" || !parsed.nextToken.trim() || parsed.nextToken.length > 1_000 || !("pagesFetched" in parsed) || typeof parsed.pagesFetched !== "number" || !Number.isInteger(parsed.pagesFetched) || parsed.pagesFetched < 1 || parsed.pagesFetched > 2 || !("billablePosts" in parsed) || typeof parsed.billablePosts !== "number" || !Number.isInteger(parsed.billablePosts) || parsed.billablePosts < 0) throw new Error("invalid cursor");
    return parsed as { nextToken: string; pagesFetched: number; billablePosts: number };
  } catch {
    throw new SourceAdapterError("INVALID_CURSOR", "X pagination cursor is invalid.");
  }
}
