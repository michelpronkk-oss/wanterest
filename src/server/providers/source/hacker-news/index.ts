import { z } from "zod";

import {
  sourceItemCandidateSchema,
  rawSourceItemEnvelopeSchema,
  sourceDiscoveryRequestSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type RateLimitMetadata,
  type SourceAdapter,
  type SourceDiscoveryPage,
  type SourceDiscoveryRequest,
  type SourceHealthResult,
  type SourceItemCandidate,
} from "../contracts";

const hnItemSchema = z
  .object({
    id: z.number().int().positive(),
    type: z.string().optional(),
    by: z.string().optional(),
    time: z.number().int().positive().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
    url: z.string().url().optional(),
    parent: z.number().int().positive().optional(),
    kids: z.array(z.number().int().positive()).optional(),
    deleted: z.boolean().optional(),
    dead: z.boolean().optional(),
  })
  .passthrough();

type HnItem = z.infer<typeof hnItemSchema>;
type FetchLike = typeof fetch;

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

function rateLimit(response: Response): RateLimitMetadata {
  return {
    provider: "hacker-news-firebase",
    remaining: null,
    limit: null,
    retryAfterMs: retryAfterMs(response),
  };
}

export class HackerNewsSourceAdapter implements SourceAdapter {
  readonly key = "hacker-news";
  readonly capabilities = {
    supportsSearch: false,
    supportsIncrementalCursor: true,
    supportsThreadExpansion: true,
  } as const;

  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(options: { fetchImpl?: FetchLike; baseUrl?: string; timeoutMs?: number; maxAttempts?: number } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://hacker-news.firebaseio.com/v0").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = options.maxAttempts ?? 2;
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    if (request.query) throw new SourceAdapterError("SEARCH_UNSUPPORTED", "Hacker News search is not enabled in Phase 2.");
    const offset = request.cursor ? this.parseCursor(request.cursor) : 0;
    const idsResponse = await this.getJson(`${this.baseUrl}/newstories.json`);
    const ids = z.array(z.number().int().positive()).parse(idsResponse.body);
    const selectedIds = ids.slice(offset, offset + request.limit);
    const items: RawSourceItemEnvelope[] = [];
    let observedRateLimit: RateLimitMetadata | undefined = idsResponse.rateLimit;

    for (const id of selectedIds) {
      const itemResponse = await this.getJson(`${this.baseUrl}/item/${id}.json`);
      observedRateLimit = itemResponse.rateLimit;
      const parsed = hnItemSchema.safeParse(itemResponse.body);
      if (!parsed.success) continue;
      const item = parsed.data;
      if (request.windowStart && item.time && item.time * 1000 < Date.parse(request.windowStart)) continue;
      if (request.windowEnd && item.time && item.time * 1000 > Date.parse(request.windowEnd)) continue;
      items.push(this.envelope(item, itemResponse.rateLimit, { rootId: item.id.toString() }));

      if (request.expandThreads && item.kids) {
        for (const childId of item.kids.slice(0, Math.max(0, request.limit - items.length))) {
          const childResponse = await this.getJson(`${this.baseUrl}/item/${childId}.json`);
          observedRateLimit = childResponse.rateLimit;
          const child = hnItemSchema.safeParse(childResponse.body);
          if (child.success) {
            items.push(this.envelope(child.data, childResponse.rateLimit, {
              rootId: item.id.toString(),
              parentId: child.data.parent?.toString() ?? item.id.toString(),
            }));
          }
          if (items.length >= request.limit) break;
        }
      }
      if (items.length >= request.limit) break;
    }

    const nextOffset = offset + selectedIds.length;
    return {
      items,
      nextCursor: nextOffset < ids.length ? `offset:${nextOffset}` : undefined,
      rateLimit: observedRateLimit,
      diagnostics: { accepted: items.length, rejected: selectedIds.length - items.length, messages: [] },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const parsed = hnItemSchema.safeParse(envelope.payload);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Hacker News item failed validation.");
    const item = parsed.data;
    const rootId = typeof raw.cursorContext.rootId === "string" ? raw.cursorContext.rootId : item.id.toString();
    const status = item.deleted || item.dead ? "removed" : item.type === "story" || item.type === "comment" ? "active" : "unavailable";
    return sourceItemCandidateSchema.parse({
      sourceKey: this.key,
      externalId: item.id.toString(),
      externalConversationId: rootId,
      canonicalUrl: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      authorExternalId: item.by,
      authorDisplayName: item.by,
      authorProfileUrl: item.by ? `https://news.ycombinator.com/user?id=${encodeURIComponent(item.by)}` : undefined,
      title: item.title,
      body: item.text ?? item.title ?? "",
      publishedAt: item.time ? new Date(item.time * 1000).toISOString() : undefined,
      capturedAt: raw.fetchedAt,
      metadata: {
        providerType: item.type ?? null,
        parentId: raw.cursorContext.parentId ?? item.parent?.toString() ?? null,
        rootId,
        childCount: item.kids?.length ?? 0,
      },
      status,
    });
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    try {
      const response = await this.getJson(`${this.baseUrl}/item/1.json`);
      return {
        sourceKey: this.key,
        ok: true,
        latencyMs: Date.now() - started,
        rateLimit: response.rateLimit,
        degradationState: "healthy",
      };
    } catch (error) {
      return {
        sourceKey: this.key,
        ok: false,
        latencyMs: Date.now() - started,
        degradationState: "degraded",
        errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED",
        errorSummary: error instanceof Error ? error.message.slice(0, 500) : "Hacker News health check failed.",
      };
    }
  }

  private parseCursor(cursor: string): number {
    const match = /^offset:(\d+)$/.exec(cursor);
    if (!match) throw new SourceAdapterError("INVALID_CURSOR", "Hacker News cursor is invalid.");
    return Number(match[1]);
  }

  private envelope(item: HnItem, itemRateLimit: RateLimitMetadata, context: Record<string, string>): RawSourceItemEnvelope {
    return {
      sourceKey: this.key,
      externalId: item.id.toString(),
      fetchedAt: new Date().toISOString(),
      payload: item,
      requestMetadata: { endpoint: "/item/:id", provider: "hacker-news-firebase" },
      cursorContext: { ...context, rateLimit: itemRateLimit },
    };
  }

  private async getJson(url: string): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, { signal: controller.signal });
        const limits = rateLimit(response);
        if (response.status === 429) throw new SourceAdapterError("RATE_LIMITED", "Hacker News rate limit reached.", true);
        if (!response.ok) throw new SourceAdapterError(`HTTP_${response.status}`, "Hacker News request failed.", response.status >= 500);
        return { body: await response.json(), rateLimit: limits };
      } catch (error) {
        lastError = error;
        if (!(error instanceof SourceAdapterError && error.retryable) && !(error instanceof DOMException && error.name === "AbortError")) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastError instanceof SourceAdapterError) throw lastError;
    throw new SourceAdapterError("REQUEST_FAILED", "Hacker News request timed out or failed.", true);
  }
}

export const hackerNewsSourceAdapter = new HackerNewsSourceAdapter();
