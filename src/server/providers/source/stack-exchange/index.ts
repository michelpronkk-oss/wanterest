import { z } from "zod";

import {
  rawSourceItemEnvelopeSchema,
  sourceDiscoveryRequestSchema,
  sourceItemCandidateSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type RateLimitMetadata,
  type SourceAdapter,
  type SourceDiscoveryPage,
  type SourceDiscoveryRequest,
  type SourceHealthResult,
  type SourceItemCandidate,
} from "../contracts";
import { fetchJson, type SourceFetch } from "../http";

const ownerSchema = z.object({
  user_id: z.number().int().optional(),
  display_name: z.string().optional(),
  link: z.string().url().optional(),
  location: z.string().max(500).nullable().optional(),
}).passthrough();

const questionSchema = z.object({
  question_id: z.number().int().positive(),
  title: z.string(),
  body: z.string().optional(),
  link: z.string().url(),
  creation_date: z.number().int().positive(),
  last_activity_date: z.number().int().positive().optional(),
  last_edit_date: z.number().int().positive().optional(),
  score: z.number().int().optional(),
  answer_count: z.number().int().nonnegative().optional(),
  accepted_answer_id: z.number().int().positive().optional(),
  is_answered: z.boolean().optional(),
  view_count: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()).optional(),
  owner: ownerSchema.optional(),
}).passthrough();

const responseSchema = z.object({
  items: z.array(questionSchema),
  has_more: z.boolean().optional(),
  quota_max: z.number().int().nonnegative().optional(),
  quota_remaining: z.number().int().nonnegative().optional(),
  backoff: z.number().nonnegative().optional(),
}).passthrough();

type StackExchangeQuestion = z.infer<typeof questionSchema>;

function cleanHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gi, " ").replace(/\s+/g, " ").trim();
}

function sitesFrom(request: SourceDiscoveryRequest): string[] {
  const metadata = request.requestMetadata as Record<string, unknown>;
  const candidates = Array.isArray(metadata.sites) ? metadata.sites : typeof metadata.site === "string" ? [metadata.site] : ["stackoverflow"];
  return [...new Set(candidates.filter((site): site is string => typeof site === "string" && /^[a-z0-9-]+$/.test(site)).map((site) => site.toLowerCase()))].slice(0, 3);
}

function encodeCursor(pages: Record<string, number>): string {
  return `pages:${Buffer.from(JSON.stringify(pages), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string | undefined, sites: string[]): Record<string, number> {
  if (!cursor) return Object.fromEntries(sites.map((site) => [site, 1]));
  const match = /^pages:([A-Za-z0-9_-]+)$/.exec(cursor);
  if (!match) throw new SourceAdapterError("INVALID_CURSOR", "Stack Exchange cursor is invalid.");
  try {
    const decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as Record<string, unknown>;
    return Object.fromEntries(sites.map((site) => [site, typeof decoded[site] === "number" && Number.isInteger(decoded[site]) && decoded[site] >= 1 ? decoded[site] : 1]));
  } catch {
    throw new SourceAdapterError("INVALID_CURSOR", "Stack Exchange cursor is invalid.");
  }
}

export type StackExchangeSourceAdapterOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: SourceFetch;
  timeoutMs?: number;
};

export class StackExchangeSourceAdapter implements SourceAdapter {
  readonly key = "stack-exchange";
  readonly capabilities = { supportsSearch: true, supportsIncrementalCursor: true, supportsThreadExpansion: false } as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: SourceFetch;
  private readonly timeoutMs: number;

  constructor(options: StackExchangeSourceAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.STACK_EXCHANGE_API_KEY?.trim() ?? "";
    this.baseUrl = (options.baseUrl ?? "https://api.stackexchange.com/2.3").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    const sites = sitesFrom(request);
    const pages = decodeCursor(request.cursor, sites);
    const perSite = Math.max(1, Math.min(100, Math.ceil(request.limit / sites.length)));
    const items: RawSourceItemEnvelope[] = [];
    let hasMore = false;
    let accepted = 0;
    let rejected = 0;
    let lastRateLimit: RateLimitMetadata | undefined;
    const nextPages: Record<string, number> = { ...pages };
    for (const site of sites) {
      const params = new URLSearchParams({ site, pagesize: String(perSite), page: String(pages[site] ?? 1), order: "desc", sort: request.query ? "relevance" : "activity", filter: "withbody" });
      if (request.query) params.set("q", request.query.slice(0, 180));
      if (request.windowStart) params.set("fromdate", String(Math.floor(Date.parse(request.windowStart) / 1000)));
      if (request.windowEnd) params.set("todate", String(Math.floor(Date.parse(request.windowEnd) / 1000)));
      if (this.apiKey) params.set("key", this.apiKey);
      const response = await fetchJson(this.fetchImpl, `${this.baseUrl}/search/advanced?${params.toString()}`, { provider: "stack-exchange-api", timeoutMs: this.timeoutMs });
      const parsed = responseSchema.safeParse(response.body);
      if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Stack Exchange response failed validation.");
      lastRateLimit = { ...response.rateLimit, provider: "stack-exchange-api", remaining: parsed.data.quota_remaining ?? null, limit: parsed.data.quota_max ?? null, retryAfterMs: parsed.data.backoff ? Math.round(parsed.data.backoff * 1000) : response.rateLimit.retryAfterMs };
      hasMore ||= Boolean(parsed.data.has_more);
      nextPages[site] = (pages[site] ?? 1) + 1;
      for (const question of parsed.data.items) {
        if (request.windowStart && question.creation_date * 1000 < Date.parse(request.windowStart)) { rejected += 1; continue; }
        if (request.windowEnd && question.creation_date * 1000 > Date.parse(request.windowEnd)) { rejected += 1; continue; }
        items.push(this.envelope(question, site, lastRateLimit));
        accepted += 1;
        if (items.length >= request.limit) break;
      }
      if (items.length >= request.limit) break;
    }
    return {
      items: items.slice(0, request.limit),
      nextCursor: hasMore ? encodeCursor(nextPages) : undefined,
      rateLimit: lastRateLimit,
      diagnostics: { accepted, rejected, messages: [`Searched ${sites.join(", ")} with Stack Exchange advanced search; results are question-level discussions with provider tags and answer signals preserved.`] },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const parsed = questionSchema.safeParse(envelope.payload);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Stack Exchange question failed validation.");
    const question = parsed.data;
    const site = typeof raw.cursorContext.site === "string" ? raw.cursorContext.site : "stackoverflow";
    const externalId = `${site}:${question.question_id}`;
    return sourceItemCandidateSchema.parse({
      sourceKey: this.key,
      externalId,
      externalConversationId: externalId,
      canonicalUrl: question.link,
      authorExternalId: question.owner?.user_id ? String(question.owner.user_id) : undefined,
      authorDisplayName: question.owner?.display_name,
      authorProfileUrl: question.owner?.link,
      title: question.title,
      body: cleanHtml(question.body ?? question.title),
      publishedAt: new Date(question.creation_date * 1000).toISOString(),
      capturedAt: envelope.fetchedAt,
      metadata: {
        sourceCategory: "developer_discussion",
        providerType: "question",
        site,
        tags: question.tags ?? [],
        score: question.score ?? null,
        answerCount: question.answer_count ?? 0,
        acceptedAnswerId: question.accepted_answer_id ?? null,
        isAnswered: question.is_answered ?? false,
        viewCount: question.view_count ?? null,
        authorLocation: question.owner?.location ?? null,
        lastActivityAt: question.last_activity_date ? new Date(question.last_activity_date * 1000).toISOString() : null,
        lastEditAt: question.last_edit_date ? new Date(question.last_edit_date * 1000).toISOString() : null,
      },
      status: "active",
    });
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    try {
      const response = await fetchJson(this.fetchImpl, `${this.baseUrl}/info?site=stackoverflow&pagesize=1`, { provider: "stack-exchange-api", timeoutMs: this.timeoutMs });
      return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit: response.rateLimit, degradationState: "healthy" };
    } catch (error) {
      return { sourceKey: this.key, ok: false, latencyMs: Date.now() - started, degradationState: "degraded", errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED", errorSummary: error instanceof Error ? error.message.slice(0, 500) : "Stack Exchange health check failed." };
    }
  }

  private envelope(question: StackExchangeQuestion, site: string, rateLimit: RateLimitMetadata): RawSourceItemEnvelope {
    return { sourceKey: this.key, externalId: `${site}:${question.question_id}`, fetchedAt: new Date().toISOString(), payload: question, requestMetadata: { provider: "stack-exchange-api", endpoint: "/search/advanced", site }, cursorContext: { site, rateLimit } };
  }
}

export const stackExchangeSourceAdapter = new StackExchangeSourceAdapter();
