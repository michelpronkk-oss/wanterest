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

const responseSchema = z.object({ reviews: z.array(z.unknown()).default([]), nextPageToken: z.string().optional() }).passthrough();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function date(value: unknown): string | undefined { if (typeof value !== "string" || !value.trim()) return undefined; const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined; }

function reviewRecord(value: unknown): ReviewRecord | null {
  const source = record(value);
  const consumer = record(source.consumer);
  const body = text(source.text);
  if (!body) return null;
  return {
    externalId: text(source.id) ?? `review:${createHash("sha256").update(`${date(source.createdAt) ?? ""}|${text(source.title) ?? ""}|${body}|${text(consumer.id) ?? ""}`, "utf8").digest("hex")}`,
    title: text(source.title),
    text: body,
    rating: typeof source.stars === "number" ? source.stars : null,
    authorExternalId: text(consumer.id),
    authorDisplayName: text(consumer.displayName),
    publishedAt: date(source.createdAt),
    updatedAt: date(source.updatedAt),
    language: text(source.language),
    verified: typeof source.isVerified === "boolean" ? source.isVerified : undefined,
    metadata: {
      sourceType: "trustpilot_business_unit_review",
      companyReply: record(source.companyReply).text ?? null,
      countryCode: text(source.countryCode) ?? text(source.country_code) ?? text(consumer.countryCode) ?? text(consumer.country_code) ?? null,
      country: text(source.country) ?? text(consumer.country) ?? null,
      region: text(source.region) ?? text(consumer.region) ?? null,
      location: text(source.location) ?? text(consumer.location) ?? null,
    },
  };
}

function queryMatches(review: ReviewRecord, query: string | undefined): boolean {
  if (!query) return true;
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3);
  const haystack = `${review.title ?? ""} ${review.text}`.toLowerCase();
  return !terms.length || terms.some((term) => haystack.includes(term));
}

export type TrustpilotSourceAdapterOptions = { apiKey?: string; businessUnitId?: string; businessUrl?: string; baseUrl?: string; fetchImpl?: SourceFetch; timeoutMs?: number };

export class TrustpilotSourceAdapter implements SourceAdapter {
  readonly key = "trustpilot";
  readonly capabilities = { supportsSearch: true, supportsIncrementalCursor: true, supportsThreadExpansion: false } as const;
  private readonly apiKey: string;
  private readonly businessUnitId: string;
  private readonly businessUrl: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: SourceFetch;
  private readonly timeoutMs: number;

  constructor(options: TrustpilotSourceAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.TRUSTPILOT_API_KEY?.trim() ?? "";
    this.businessUnitId = options.businessUnitId ?? process.env.TRUSTPILOT_BUSINESS_UNIT_ID?.trim() ?? "";
    this.businessUrl = options.businessUrl ?? process.env.TRUSTPILOT_BUSINESS_URL?.trim() ?? "https://www.trustpilot.com";
    this.baseUrl = (options.baseUrl ?? "https://api.trustpilot.com/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    const metadata = request.requestMetadata as Record<string, unknown>;
    const businessUnitId = typeof metadata.businessUnitId === "string" && metadata.businessUnitId.trim() ? metadata.businessUnitId.trim() : this.businessUnitId;
    if (!this.apiKey || !businessUnitId) throw new SourceAdapterError("CONFIGURATION_MISSING", "Trustpilot API access and a business unit ID are required.");
    const params = new URLSearchParams();
    const token = typeof request.cursor === "string" ? request.cursor.replace(/^page-token:/, "") : "";
    if (token) params.set("pageToken", token);
    const response = await fetchJson(this.fetchImpl, `${this.baseUrl}/business-units/${encodeURIComponent(businessUnitId)}/all-reviews${params.size ? `?${params.toString()}` : ""}`, { provider: "trustpilot-api", mode: "authenticated", headers: { apikey: this.apiKey }, timeoutMs: this.timeoutMs });
    const parsed = responseSchema.safeParse(response.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Trustpilot response failed validation.");
    const items: RawSourceItemEnvelope[] = [];
    let rejected = 0;
    parsed.data.reviews.forEach((raw) => {
      const review = reviewRecord(raw);
      if (!review || !queryMatches(review, request.query)) { rejected += 1; return; }
      if (request.windowStart && review.publishedAt && Date.parse(review.publishedAt) < Date.parse(request.windowStart)) { rejected += 1; return; }
      if (request.windowEnd && review.publishedAt && Date.parse(review.publishedAt) > Date.parse(request.windowEnd)) { rejected += 1; return; }
      items.push({ sourceKey: this.key, externalId: review.externalId, fetchedAt: new Date().toISOString(), payload: raw, requestMetadata: { provider: "trustpilot-api", businessUnitId }, cursorContext: { businessUnitId, defaultUrl: this.businessUrl } });
    });
    return { items: items.slice(0, request.limit), nextCursor: parsed.data.nextPageToken ? `page-token:${parsed.data.nextPageToken}` : undefined, rateLimit: response.rateLimit, diagnostics: { accepted: items.length, rejected, messages: ["Trustpilot reviews are imported through the approved Business Units API; public profile HTML is never scraped."] } };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const review = reviewRecord(envelope.payload);
    if (!review) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Trustpilot review failed validation.");
    return normalizeReviewRecord({ sourceKey: this.key, record: review, fetchedAt: envelope.fetchedAt, defaultUrl: typeof raw.cursorContext.defaultUrl === "string" ? raw.cursorContext.defaultUrl : this.businessUrl, sourceCategory: "customer_review", providerType: "review" });
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    if (!this.apiKey || !this.businessUnitId) return { sourceKey: this.key, ok: false, latencyMs: 0, degradationState: "blocked", errorCode: "CONFIGURATION_MISSING", errorSummary: "Trustpilot API access and a business unit ID are required." };
    try {
      const response = await fetchJson(this.fetchImpl, `${this.baseUrl}/business-units/${encodeURIComponent(this.businessUnitId)}/all-reviews`, { provider: "trustpilot-api", mode: "authenticated", headers: { apikey: this.apiKey }, timeoutMs: this.timeoutMs });
      return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit: response.rateLimit, degradationState: "healthy" };
    } catch (error) {
      return { sourceKey: this.key, ok: false, latencyMs: Date.now() - started, degradationState: "degraded", errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED", errorSummary: error instanceof Error ? error.message.slice(0, 500) : "Trustpilot health check failed." };
    }
  }
}

export const trustpilotSourceAdapter = new TrustpilotSourceAdapter();
