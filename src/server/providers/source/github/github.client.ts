import {
  githubDiscussionSearchSchema,
  githubGraphqlResponseSchema,
  githubIssueCommentSchema,
  githubIssueSearchResponseSchema,
  githubRateLimitResponseSchema,
} from "./github.schemas";
import { SourceAdapterError, type RateLimitMetadata } from "../contracts";

type FetchLike = typeof fetch;

export type GitHubClientOptions = {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  graphqlUrl?: string;
  token?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  clock?: () => Date;
};

export type GitHubIssueSearchInput = {
  query: string;
  limit: number;
  page: number;
  sort?: string;
  order?: "asc" | "desc";
};

export type GitHubIssueSearchResult = {
  response: unknown;
  rateLimit: RateLimitMetadata;
  nextPage?: number;
};

export type GitHubCommentsResult = {
  comments: unknown[];
  rejected: number;
  rateLimit: RateLimitMetadata;
  hasNextPage: boolean;
};

export type GitHubDiscussionsResult = {
  response: unknown;
  rateLimit: RateLimitMetadata;
  hasNextPage: boolean;
  endCursor: string | null;
};

const DISCUSSIONS_QUERY = `
query WanterestDiscussionSearch($query: String!, $first: Int!, $after: String, $commentFirst: Int!) {
  search(query: $query, type: DISCUSSION, first: $first, after: $after) {
    nodes {
      ... on Discussion {
        id number title body url createdAt updatedAt
        author { id login url __typename }
        category { name }
        repository { id name nameWithOwner url owner { login } }
        comments(first: $commentFirst) {
          nodes { id body url createdAt updatedAt author { id login url __typename } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function positiveHeader(response: Response, name: string): number | null {
  const value = Number(response.headers.get(name));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function rateLimit(response: Response, clock: () => Date, token?: string, body?: unknown, post = false): RateLimitMetadata {
  const resetEpoch = positiveHeader(response, "x-ratelimit-reset");
  const retryAfterValue = Number(response.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(retryAfterValue) && retryAfterValue >= 0 ? Math.round(retryAfterValue * 1_000) : null;
  const bodyRate = body && typeof body === "object" && "rate" in body && body.rate && typeof body.rate === "object" ? body.rate : undefined;
  const bodyRemaining = bodyRate && "remaining" in bodyRate && typeof bodyRate.remaining === "number" ? bodyRate.remaining : null;
  const bodyLimit = bodyRate && "limit" in bodyRate && typeof bodyRate.limit === "number" ? bodyRate.limit : null;
  const bodyReset = bodyRate && "reset" in bodyRate && typeof bodyRate.reset === "number" ? bodyRate.reset : null;
  const remaining = positiveHeader(response, "x-ratelimit-remaining") ?? bodyRemaining;
  const limit = positiveHeader(response, "x-ratelimit-limit") ?? bodyLimit;
  const reset = resetEpoch ?? bodyReset;
  return {
    provider: post ? "github-graphql" : "github-rest",
    mode: token ? "authenticated" : "public",
    resource: response.headers.get("x-ratelimit-resource") ?? undefined,
    remaining,
    limit,
    retryAfterMs: retryAfterMs ?? (reset !== null ? Math.max(0, reset * 1_000 - clock().getTime()) : null),
    resetAt: reset !== null ? new Date(reset * 1_000).toISOString() : null,
  };
}

function messageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("message" in body) || typeof body.message !== "string") return undefined;
  return body.message.slice(0, 200);
}

function responseError(response: Response, body: unknown, limits: RateLimitMetadata): SourceAdapterError {
  const message = messageFromBody(body)?.toLowerCase() ?? "";
  if (response.status === 401) return new SourceAdapterError("AUTH_FAILED", "GitHub API authentication was rejected.");
  if (response.status === 403 && (limits.remaining === 0 || message.includes("rate limit") || response.headers.has("retry-after"))) {
    return new SourceAdapterError("RATE_LIMITED", "GitHub API rate limit reached.", true);
  }
  if (response.status === 403) return new SourceAdapterError("FORBIDDEN", "GitHub API access was forbidden.");
  if (response.status === 429) return new SourceAdapterError("RATE_LIMITED", "GitHub API rate limit reached.", true);
  return new SourceAdapterError(`HTTP_${response.status}`, "GitHub API request failed.", response.status >= 500);
}

function nextPageFromLink(response: Response): number | undefined {
  const link = response.headers.get("link");
  if (!link) return undefined;
  const match = link.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="next"/i);
  return match ? Number(match[1]) : undefined;
}

function parseCursor(after: string | undefined): string | null {
  if (!after) return null;
  if (after.length > 500) throw new SourceAdapterError("INVALID_CURSOR", "GitHub discussion cursor is too long.");
  return after;
}

function officialRestBase(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.github.com" || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("GitHub REST host must be https://api.github.com.");
  }
  return "https://api.github.com";
}

function officialGraphqlUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.github.com" || url.pathname !== "/graphql") {
    throw new Error("GitHub GraphQL host must be https://api.github.com/graphql.");
  }
  return "https://api.github.com/graphql";
}

export class GitHubClient {
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly graphqlUrl: string;
  private readonly token?: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly clock: () => Date;

  constructor(options: GitHubClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = officialRestBase(options.apiBaseUrl ?? "https://api.github.com");
    this.graphqlUrl = officialGraphqlUrl(options.graphqlUrl ?? "https://api.github.com/graphql");
    this.token = options.token?.trim() || undefined;
    this.userAgent = options.userAgent?.trim() || "Wanterest/1.0 (source-connector)";
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.backoffMs = options.backoffMs ?? 100;
    this.clock = options.clock ?? (() => new Date());
  }

  async searchIssues(input: GitHubIssueSearchInput): Promise<GitHubIssueSearchResult> {
    const url = new URL(`${this.apiBaseUrl}/search/issues`);
    url.searchParams.set("q", input.query);
    url.searchParams.set("per_page", String(Math.min(Math.max(input.limit, 1), 100)));
    url.searchParams.set("page", String(Math.min(Math.max(input.page, 1), 1_000)));
    if (input.sort) url.searchParams.set("sort", input.sort);
    if (input.order) url.searchParams.set("order", input.order);
    const result = await this.requestJson(url, false);
    const parsed = githubIssueSearchResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "GitHub issue search response failed validation.");
    return { response: parsed.data, rateLimit: result.rateLimit, nextPage: nextPageFromLink(result.response) };
  }

  async getIssueComments(owner: string, repository: string, issueNumber: number, page: number, perPage: number): Promise<GitHubCommentsResult> {
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository) || !Number.isInteger(issueNumber) || issueNumber < 1) {
      throw new SourceAdapterError("INVALID_REPOSITORY", "GitHub repository or issue number is invalid.");
    }
    const url = new URL(`${this.apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${issueNumber}/comments`);
    url.searchParams.set("per_page", String(Math.min(Math.max(perPage, 1), 50)));
    url.searchParams.set("page", String(Math.min(Math.max(page, 1), 2)));
    const result = await this.requestJson(url, false);
    if (!Array.isArray(result.body)) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "GitHub issue comments response failed validation.");
    const comments: unknown[] = [];
    let rejected = 0;
    for (const value of result.body) {
      const parsed = githubIssueCommentSchema.safeParse(value);
      if (parsed.success) comments.push(parsed.data);
      else rejected += 1;
    }
    return { comments, rejected, rateLimit: result.rateLimit, hasNextPage: nextPageFromLink(result.response) !== undefined };
  }

  async listDiscussions(searchQuery: string, first: number, after: string | undefined, commentFirst: number): Promise<GitHubDiscussionsResult> {
    if (!searchQuery.trim() || searchQuery.length > 500) throw new SourceAdapterError("QUERY_REQUIRED", "GitHub discussion discovery requires a bounded query.");
    const result = await this.requestJson(new URL(this.graphqlUrl), true, {
      query: DISCUSSIONS_QUERY,
      variables: { query: searchQuery, first: Math.min(Math.max(first, 1), 50), after: parseCursor(after), commentFirst: Math.min(Math.max(commentFirst, 0), 50) },
    });
    const envelope = githubGraphqlResponseSchema.safeParse(result.body);
    if (!envelope.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "GitHub GraphQL response failed validation.");
    if (envelope.data.errors?.length) {
      throw new SourceAdapterError("GRAPHQL_ERROR", envelope.data.errors[0].message.slice(0, 200));
    }
    const parsed = githubDiscussionSearchSchema.safeParse(envelope.data.data);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "GitHub discussions response failed validation.");
    const pageInfo = parsed.data.search.pageInfo;
    return { response: parsed.data, rateLimit: result.rateLimit, hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor };
  }

  async healthCheck(): Promise<RateLimitMetadata> {
    const result = await this.requestJson(new URL(`${this.apiBaseUrl}/rate_limit`), false);
    const parsed = githubRateLimitResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "GitHub rate-limit response failed validation.");
    return result.rateLimit;
  }

  private async requestJson(url: URL, post: boolean, body?: unknown): Promise<{ body: unknown; response: Response; rateLimit: RateLimitMetadata }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url.toString(), {
          method: post ? "POST" : "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": this.userAgent,
            ...(post ? { "Content-Type": "application/json" } : {}),
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          ...(post ? { body: JSON.stringify(body) } : {}),
        });
        let responseBody: unknown;
        try {
          const text = await response.text();
          responseBody = text ? JSON.parse(text) : undefined;
        } catch {
          if (!response.ok) responseBody = undefined;
          else throw new SourceAdapterError("MALFORMED_PROVIDER_RESPONSE", "GitHub API response was not valid JSON.");
        }
        const limits = rateLimit(response, this.clock, this.token, responseBody, post);
        if (!response.ok) throw responseError(response, responseBody, limits);
        return { body: responseBody, response, rateLimit: limits };
      } catch (error) {
        lastError = isAbortError(error) ? new SourceAdapterError("TIMEOUT", "GitHub API request timed out.", true) : error;
        if (!(lastError instanceof SourceAdapterError)) lastError = new SourceAdapterError("REQUEST_FAILED", "GitHub API request failed.", true);
      } finally {
        clearTimeout(timeout);
      }
      if (!(lastError instanceof SourceAdapterError && lastError.retryable)) break;
      if (attempt < this.maxAttempts && this.backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(this.backoffMs * 2 ** (attempt - 1), 1_000)));
      }
    }
    if (lastError instanceof SourceAdapterError) throw lastError;
    throw new SourceAdapterError("REQUEST_FAILED", "GitHub API request failed.", true);
  }
}

export function encodeGitHubIssuesCursor(page: number): string {
  if (!Number.isInteger(page) || page < 1 || page > 1_000) throw new SourceAdapterError("INVALID_CURSOR", "GitHub issue cursor is invalid.");
  return `github:v1:issues:${Buffer.from(JSON.stringify({ page }), "utf8").toString("base64url")}`;
}

export function decodeGitHubIssuesCursor(cursor: string): number {
  if (!cursor.startsWith("github:v1:issues:")) throw new SourceAdapterError("INVALID_CURSOR", "GitHub issue cursor is invalid.");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor.slice("github:v1:issues:".length), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !("page" in parsed) || typeof parsed.page !== "number" || !Number.isInteger(parsed.page) || parsed.page < 1 || parsed.page > 1_000) throw new Error("invalid page");
    return parsed.page;
  } catch {
    throw new SourceAdapterError("INVALID_CURSOR", "GitHub issue cursor is invalid.");
  }
}

export function encodeGitHubDiscussionsCursor(after: string): string {
  if (!after.trim() || after.length > 500) throw new SourceAdapterError("INVALID_CURSOR", "GitHub discussion cursor is invalid.");
  return `github:v1:discussions:${Buffer.from(JSON.stringify({ after }), "utf8").toString("base64url")}`;
}

export function decodeGitHubDiscussionsCursor(cursor: string): string {
  if (!cursor.startsWith("github:v1:discussions:")) throw new SourceAdapterError("INVALID_CURSOR", "GitHub discussion cursor is invalid.");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor.slice("github:v1:discussions:".length), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !("after" in parsed) || typeof parsed.after !== "string" || !parsed.after.trim() || parsed.after.length > 500) throw new Error("invalid after");
    return parsed.after;
  } catch {
    throw new SourceAdapterError("INVALID_CURSOR", "GitHub discussion cursor is invalid.");
  }
}
