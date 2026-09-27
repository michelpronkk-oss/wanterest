import { SourceAdapterError, type RateLimitMetadata } from "../contracts";
import { fetchJson, type SourceFetch } from "../http";
import { devtoArticleSearchResponseSchema, devtoCommentsResponseSchema, type DevtoArticle, type DevtoComment } from "./devto.schemas";

export type DevtoClientOptions = {
  fetchImpl?: SourceFetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
};

export function normalizeDevtoInstance(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") throw new SourceAdapterError("INVALID_INSTANCE", "DEV/Forem instance must use HTTPS.");
  const path = url.pathname.replace(/\/api\/?$/, "").replace(/\/$/, "");
  return `${url.host.toLowerCase()}${path}`;
}

export class DevtoClient {
  private readonly fetchImpl: SourceFetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(options: DevtoClientOptions = {}) {
    const configuredBaseUrl = options.baseUrl ?? "https://dev.to/api";
    normalizeDevtoInstance(configuredBaseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = configuredBaseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = Math.min(2, Math.max(1, options.maxAttempts ?? 2));
    this.backoffMs = Math.min(500, Math.max(0, options.backoffMs ?? 100));
  }

  get instanceKey(): string {
    return normalizeDevtoInstance(this.baseUrl);
  }

  async searchArticles(input: { query: string; page: number; perPage: number; topDays?: number }): Promise<{ articles: DevtoArticle[]; rateLimit: RateLimitMetadata }> {
    const url = new URL(`${this.baseUrl}/articles/search`);
    url.searchParams.set("q", input.query.slice(0, 200));
    url.searchParams.set("page", String(Math.max(1, Math.min(2, input.page))));
    url.searchParams.set("per_page", String(Math.max(1, Math.min(30, input.perPage))));
    if (input.topDays) url.searchParams.set("top", String(Math.min(3650, input.topDays)));
    const result = await this.request(url);
    const parsed = devtoArticleSearchResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "DEV article search response failed validation.");
    return { articles: parsed.data, rateLimit: result.rateLimit };
  }

  async listComments(articleId: number): Promise<{ comments: DevtoComment[]; rateLimit: RateLimitMetadata }> {
    const url = new URL(`${this.baseUrl}/comments`);
    url.searchParams.set("a_id", String(articleId));
    const result = await this.request(url);
    const parsed = devtoCommentsResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "DEV comments response failed validation.");
    return { comments: parsed.data, rateLimit: result.rateLimit };
  }

  async healthCheck(): Promise<RateLimitMetadata> {
    const url = new URL(`${this.baseUrl}/instance`);
    const result = await this.request(url);
    if (!result.body || typeof result.body !== "object") throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "DEV instance response failed validation.");
    return result.rateLimit;
  }

  private async request(url: URL): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await fetchJson(this.fetchImpl, url, {
          provider: "devto-public",
          mode: "public",
          timeoutMs: this.timeoutMs,
          headers: { "User-Agent": "Wanterest/12A.3E public-source-adapter" },
        });
        return { body: result.body, rateLimit: result.rateLimit };
      } catch (error) {
        lastError = error;
        if (!(error instanceof SourceAdapterError) || !error.retryable || attempt >= this.maxAttempts) break;
        if (this.backoffMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(this.backoffMs * 2 ** (attempt - 1), 1_000)));
      }
    }
    throw lastError instanceof SourceAdapterError ? lastError : new SourceAdapterError("REQUEST_FAILED", "DEV request failed.", true);
  }
}
