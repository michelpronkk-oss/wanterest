import { createHash } from "node:crypto";
import { z } from "zod";

import {
  rawSourceItemEnvelopeSchema,
  sourceDiscoveryRequestSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type SourceAdapter,
  type SourceDiscoveryPage,
  type SourceDiscoveryRequest,
  type SourceHealthResult,
  type SourceItemCandidate,
} from "../contracts";
import { fetchJson, type SourceFetch } from "../http";
import { normalizeReviewRecord, type ReviewRecord } from "../reviews";
import {
  g2ProductResolutionTargetSchema,
  G2ProductResolver,
  g2TargetKey,
  readG2ProductMappings,
  type G2ProductResolutionTarget,
  type G2ProductMapping,
} from "./product-resolution";

const responseSchema = z.object({
  data: z.array(z.unknown()).optional(),
  included: z.array(z.unknown()).optional(),
  links: z.record(z.string(), z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function date(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function numberValue(...values: unknown[]): number | null {
  const value = values.find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
  return typeof value === "number" ? value : null;
}

function urlValue(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  try { return new URL(candidate).toString(); } catch { return undefined; }
}

function reviewRecord(value: unknown): ReviewRecord | null {
  const root = record(value);
  const attributes = record(root.attributes);
  const source = { ...root, ...attributes };
  const reviewer = record(source.reviewer);
  const body = text(source.comment) ?? text(source.review_text) ?? text(source.text) ?? text(source.body) ?? text(source.content);
  if (!body) return null;
  const id = text(root.id) ?? text(source.id) ?? `review:${createHash("sha256").update(`${date(source.created_at) ?? date(source.createdAt) ?? ""}|${body}|${text(source.title) ?? ""}`, "utf8").digest("hex")}`;
  return {
    externalId: id,
    title: text(source.title) ?? text(source.summary),
    text: body,
    rating: numberValue(source.star_rating, source.rating, source.stars, source.nps_score),
    authorExternalId: text(reviewer.id) ?? text(source.reviewer_id),
    authorDisplayName: text(reviewer.name) ?? text(source.reviewer_name) ?? text(record(source.author).name),
    publishedAt: date(source.created_at) ?? date(source.createdAt) ?? date(source.published_at),
    updatedAt: date(source.updated_at) ?? date(source.updatedAt),
    canonicalUrl: urlValue(source.url) ?? urlValue(source.review_url),
    language: text(source.language),
    verified: typeof source.verified === "boolean" ? source.verified : undefined,
    metadata: {
      productId: text(source.product_id) ?? null,
      sourceType: "g2_review",
      countryCode: text(source.country_code) ?? text(source.countryCode) ?? text(reviewer.country_code) ?? text(reviewer.countryCode) ?? null,
      country: text(source.country) ?? text(reviewer.country) ?? null,
      region: text(source.region) ?? text(source.region_name) ?? text(reviewer.region) ?? null,
      location: text(source.location) ?? text(source.reviewer_location) ?? text(reviewer.location) ?? null,
    },
  };
}

function pageCursor(cursor: string | undefined): number {
  if (!cursor) return 1;
  const match = /^page:(\d+)$/.exec(cursor);
  if (!match) throw new SourceAdapterError("INVALID_CURSOR", "G2 cursor is invalid.");
  return Math.max(1, Number(match[1]));
}

function queryMatches(review: ReviewRecord, query: string | undefined): boolean {
  if (!query) return true;
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3);
  const haystack = `${review.title ?? ""} ${review.text}`.toLowerCase();
  return !terms.length || terms.some((term) => haystack.includes(term));
}

function targetsFromRequest(metadata: Record<string, unknown>, query?: string): G2ProductResolutionTarget[] {
  const rawTargets = Array.isArray(metadata.g2Targets) ? metadata.g2Targets : metadata.g2Target ? [metadata.g2Target] : [];
  const parsed = rawTargets
    .map((value) => g2ProductResolutionTargetSchema.safeParse(value))
    .filter((value): value is { success: true; data: G2ProductResolutionTarget } => value.success)
    .map((value) => value.data);
  if (parsed.length) return parsed.slice(0, 8);
  if (query?.trim()) return [{ key: "product:query", kind: "product", name: query.trim() }];
  return [{ key: "product:unknown", kind: "product" }];
}

type ReviewPage = { rawReviews: unknown[]; rateLimit?: SourceDiscoveryPage["rateLimit"]; hasNext: boolean };

export type G2SourceAdapterOptions = {
  apiKey?: string;
  baseUrl?: string;
  productsBaseUrl?: string;
  fetchImpl?: SourceFetch;
  timeoutMs?: number;
  maxCatalogRequests?: number;
};

export class G2SourceAdapter implements SourceAdapter {
  readonly key = "g2";
  readonly capabilities = { supportsSearch: true, supportsIncrementalCursor: true, supportsThreadExpansion: false } as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly productsBaseUrl: string;
  private readonly fetchImpl: SourceFetch;
  private readonly timeoutMs: number;
  private readonly resolver: G2ProductResolver;
  private readonly reviewInFlight = new Map<string, Promise<ReviewPage>>();

  constructor(options: G2SourceAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.G2_API_KEY?.trim() ?? "";
    this.baseUrl = (options.baseUrl ?? "https://data.g2.com/api/v2").replace(/\/$/, "");
    this.productsBaseUrl = (options.productsBaseUrl ?? this.baseUrl.replace(/\/v2$/, "/v1")).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.resolver = new G2ProductResolver({ apiKey: this.apiKey, productsBaseUrl: this.productsBaseUrl, fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs, maxCatalogRequests: options.maxCatalogRequests });
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    if (!this.apiKey) throw new SourceAdapterError("CONFIGURATION_MISSING", "G2 API access is not configured.");
    const metadata = request.requestMetadata as Record<string, unknown>;
    const targets = targetsFromRequest(metadata, request.query);
    const cachedMappings = readG2ProductMappings(metadata.g2ProductMappings);
    const page = pageCursor(request.cursor);
    const items: RawSourceItemEnvelope[] = [];
    const resolutions: SourceDiscoveryPage["diagnostics"]["resolutions"] = [];
    const seenProductIds = new Set<string>();
    const seenReviewIds = new Set<string>();
    let rejected = 0;
    let rateLimit: SourceDiscoveryPage["rateLimit"];
    let hasNext = false;

    for (const target of targets) {
      const resolution = await this.resolver.resolve(target, cachedMappings[g2TargetKey(target)] as G2ProductMapping | undefined);
      resolutions.push(resolution);
      if (resolution.status !== "resolved" || !resolution.productId || seenProductIds.has(resolution.productId)) continue;
      if (items.length >= request.limit) break;
      seenProductIds.add(resolution.productId);
      const remaining = Math.max(1, request.limit - items.length);
      const reviewPage = await this.reviewPage(resolution.productId, page, remaining);
      rateLimit = reviewPage.rateLimit ?? rateLimit;
      hasNext = hasNext || reviewPage.hasNext;
      for (const raw of reviewPage.rawReviews) {
        const review = reviewRecord(raw);
        if (!review || seenReviewIds.has(review.externalId) || !queryMatches(review, request.query)) { rejected += 1; continue; }
        if (request.windowStart && review.publishedAt && Date.parse(review.publishedAt) < Date.parse(request.windowStart)) { rejected += 1; continue; }
        if (request.windowEnd && review.publishedAt && Date.parse(review.publishedAt) > Date.parse(request.windowEnd)) { rejected += 1; continue; }
        seenReviewIds.add(review.externalId);
        items.push({ sourceKey: this.key, externalId: review.externalId, fetchedAt: new Date().toISOString(), payload: raw, requestMetadata: { provider: "g2-api", productId: resolution.productId, g2TargetKey: resolution.targetKey }, cursorContext: { productId: resolution.productId, g2TargetKey: resolution.targetKey, defaultUrl: `https://www.g2.com/products/${encodeURIComponent(resolution.productId)}/reviews` } });
        if (items.length >= request.limit) break;
      }
    }

    const messages = ["G2 products are resolved through the approved Products API before review import; HTML review pages are never scraped."];
    for (const resolution of resolutions) {
      if (resolution.status === "no_match") messages.push(`g2_resolution:no_match:${resolution.targetKey}`);
      if (resolution.status === "ambiguous_match") messages.push(`g2_resolution:ambiguous_match:${resolution.targetKey}`);
      if (resolution.status === "resolved" && !resolution.productId) messages.push(`g2_resolution:invalid_resolved_mapping:${resolution.targetKey}`);
    }
    return {
      items,
      nextCursor: hasNext ? `page:${page + 1}` : undefined,
      rateLimit,
      diagnostics: { accepted: items.length, rejected, messages, resolutions },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const review = reviewRecord(envelope.payload);
    if (!review) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "G2 review failed validation.");
    if (!review.canonicalUrl && typeof raw.cursorContext.defaultUrl === "string") review.canonicalUrl = raw.cursorContext.defaultUrl;
    return normalizeReviewRecord({ sourceKey: this.key, record: review, fetchedAt: envelope.fetchedAt, defaultUrl: typeof raw.cursorContext.defaultUrl === "string" ? raw.cursorContext.defaultUrl : undefined, sourceCategory: "software_review", providerType: "review" });
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    if (!this.apiKey) return { sourceKey: this.key, ok: false, latencyMs: 0, degradationState: "blocked", errorCode: "CONFIGURATION_MISSING", errorSummary: "G2 API access is not configured." };
    try {
      const params = new URLSearchParams({ "page[size]": "1", "page[number]": "1" });
      const response = await fetchJson(this.fetchImpl, `${this.productsBaseUrl}/products?${params.toString()}`, { provider: "g2-products-api", mode: "authenticated", headers: { Authorization: `Bearer ${this.apiKey}` }, timeoutMs: this.timeoutMs });
      return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit: response.rateLimit, degradationState: "healthy" };
    } catch (error) {
      return { sourceKey: this.key, ok: false, latencyMs: Date.now() - started, degradationState: "degraded", errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED", errorSummary: error instanceof Error ? error.message.slice(0, 500) : "G2 health check failed." };
    }
  }

  private reviewPage(productId: string, page: number, limit: number): Promise<ReviewPage> {
    const key = `${productId}:${page}:${Math.min(100, limit)}`;
    const existing = this.reviewInFlight.get(key);
    if (existing) return existing;
    const promise = this.fetchReviewPage(productId, page, limit).catch((error) => {
      this.reviewInFlight.delete(key);
      throw error;
    });
    this.reviewInFlight.set(key, promise);
    if (this.reviewInFlight.size > 64) this.reviewInFlight.delete(this.reviewInFlight.keys().next().value as string);
    return promise;
  }

  private async fetchReviewPage(productId: string, page: number, limit: number): Promise<ReviewPage> {
    const params = new URLSearchParams({ "page[size]": String(Math.min(100, limit)), "page[number]": String(page) });
    const response = await fetchJson(this.fetchImpl, `${this.baseUrl}/products/${encodeURIComponent(productId)}/reviews?${params.toString()}`, { provider: "g2-api", mode: "authenticated", headers: { Authorization: `Bearer ${this.apiKey}` }, timeoutMs: this.timeoutMs });
    const parsed = responseSchema.safeParse(response.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "G2 response failed validation.");
    const rawReviews = parsed.data.data ?? [];
    return { rawReviews, rateLimit: response.rateLimit, hasNext: typeof record(parsed.data.links).next === "string" || rawReviews.length >= limit };
  }
}

export const g2SourceAdapter = new G2SourceAdapter();
export { G2ProductResolver } from "./product-resolution";
export type { G2ProductMapping, G2ProductMappings, G2ProductResolutionTarget } from "./product-resolution";
