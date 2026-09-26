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

/**
 * Layer 12A.3A: HN Search v2. Selected per-request via
 * `requestMetadata.executionMode === "algolia_search_v2"` (stamped by
 * `toSourceDiscoveryRequest` only when `HN_ALGOLIA_SEARCH_ENABLED=true`) -
 * never by reading the flag inside this adapter, so the adapter stays a pure
 * function of the request it is given and a refresh-rebuilt request (which
 * carries `executionMode` through `market_partition_identity_v1`'s
 * per-source param allowlist) selects the same path deterministically.
 *
 * Verified live contract (2026-09-26, https://hn.algolia.com/api/v1):
 * - `GET /search_by_date?query=...&tags=(story,comment)&numericFilters=created_at_i>X,created_at_i<Y&page=N&hitsPerPage=M`
 *   returns `{ hits, page, nbPages, hitsPerPage, ... }`; `search_by_date`
 *   (not `search`) is used so results are fresh/recency-ordered, matching
 *   "prefer fresh, query-relevant results" rather than relevance-only ranking.
 * - Story hit: `objectID` (stable item id, string), `created_at`/`created_at_i`
 *   (ISO / unix seconds), `title`, `url?`, `story_text?` (Ask HN / text
 *   posts), `author`, `points`, `num_comments`, `_tags` including `"story"`.
 * - Comment hit: `objectID` (the comment's own id), `comment_text`,
 *   `story_id` (root story id - already resolved, no extra hydration call
 *   needed), `parent_id` (immediate parent, comment or story), `story_title`,
 *   `story_url?`, `author`, `_tags` including `"comment"`.
 * - No API key; no documented hard rate limit; no rate-limit response
 *   headers observed. 429 and 5xx are real, observed-possible failure modes
 *   (Algolia's own status page documents them) even without a published
 *   quota, so this adapter still times out, retries bounded, and backs off.
 * - The official Firebase item API (`https://hacker-news.firebaseio.com/v0/item/{id}.json`)
 *   remains available for hydration; it is not called by the Algolia path in
 *   the common case because Algolia comment hits already carry `story_id`.
 */
const HN_ALGOLIA_DEFAULT_BASE_URL = "https://hn.algolia.com/api/v1";
export const HACKER_NEWS_SEARCH_V2_VERSION = "hacker_news_search_v2_1" as const;
const HN_ALGOLIA_MAX_HITS_PER_PAGE = 20;
const HN_ALGOLIA_MAX_PAGES = 3;
const HN_ALGOLIA_DEFAULT_FRESHNESS_DAYS = 14;

const algoliaHitSchema = z
  .object({
    objectID: z.string().trim().min(1),
    created_at_i: z.number().int().nonnegative(),
    author: z.string().trim().min(1).optional(),
    title: z.string().optional(),
    url: z.string().url().optional(),
    story_text: z.string().nullable().optional(),
    comment_text: z.string().nullable().optional(),
    story_id: z.number().int().positive().optional(),
    parent_id: z.number().int().positive().optional(),
    story_title: z.string().optional(),
    story_url: z.string().url().optional(),
    points: z.number().int().nullable().optional(),
    num_comments: z.number().int().nullable().optional(),
    _tags: z.array(z.string()).optional(),
  })
  .passthrough();

type AlgoliaHit = z.infer<typeof algoliaHitSchema>;

const algoliaResponseSchema = z
  .object({
    hits: z.array(algoliaHitSchema),
    page: z.number().int().nonnegative(),
    nbPages: z.number().int().nonnegative(),
  })
  .passthrough();

function isAlgoliaComment(hit: AlgoliaHit): boolean {
  return typeof hit.comment_text === "string" || (hit._tags?.includes("comment") ?? false);
}

/** Excludes hits with no usable text at all (Algolia's own index already omits dead/deleted items). */
function algoliaHitHasContent(hit: AlgoliaHit): boolean {
  const text = isAlgoliaComment(hit) ? hit.comment_text : (hit.story_text ?? hit.title);
  return typeof text === "string" && text.trim().length > 0;
}

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

const genericQueryTerms = new Set([
  "a", "an", "and", "alternative", "alternatives", "because", "best", "better", "for", "from", "how", "looking", "need", "of", "or", "replace", "switching", "the", "to", "versus", "vs", "with",
]);

function cleanText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&[#a-z0-9]+;/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => cleanText(item)).filter(Boolean) : [];
}

function matchesQuery(item: HnItem, request: SourceDiscoveryRequest): boolean {
  if (!request.query) return true;
  const metadata = request.requestMetadata as Record<string, unknown>;
  const haystack = cleanText(`${item.title ?? ""}\n${item.text ?? ""}`);
  const anchors = strings(metadata.lexicalAnchors);
  const anchorMatches = anchors.some((anchor) => {
    if (haystack.includes(anchor)) return true;
    const terms = anchor.split(/\s+/).filter((term) => term.length >= 3);
    return terms.length >= 2 && terms.filter((term) => haystack.includes(term)).length >= Math.min(2, terms.length);
  });
  if (anchors.length) return anchorMatches;
  const terms = cleanText(request.query).split(/\s+/).filter((term) => term.length >= 3 && !genericQueryTerms.has(term));
  return terms.length >= 2 && terms.some((term) => haystack.includes(term));
}

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
  private readonly algoliaBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(options: { fetchImpl?: FetchLike; baseUrl?: string; algoliaBaseUrl?: string; timeoutMs?: number; maxAttempts?: number } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://hacker-news.firebaseio.com/v0").replace(/\/$/, "");
    this.algoliaBaseUrl = (options.algoliaBaseUrl ?? HN_ALGOLIA_DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = options.maxAttempts ?? 2;
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    if ((request.requestMetadata as Record<string, unknown>).executionMode === "algolia_search_v2") {
      return this.discoverViaAlgolia(request);
    }
    const offset = request.cursor ? this.parseCursor(request.cursor) : 0;
    const idsResponse = await this.getJson(`${this.baseUrl}/newstories.json`);
    const ids = z.array(z.number().int().positive()).parse(idsResponse.body);
    const inspectLimit = Math.min(50, Math.max(request.limit, request.limit * (request.query ? 5 : 1)));
    const selectedIds = ids.slice(offset, offset + inspectLimit);
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
      if (!matchesQuery(item, request)) {
        continue;
      }
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
    const messages = request.query
      ? [`Applied bounded lexical anchors for semantic query "${request.query.slice(0, 120)}"; inspected ${selectedIds.length} recent stories.`]
      : [];
    return {
      items,
      nextCursor: nextOffset < ids.length ? `offset:${nextOffset}` : undefined,
      rateLimit: observedRateLimit,
      diagnostics: { accepted: items.length, rejected: selectedIds.length - items.length, messages },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    if (envelope.cursorContext.origin === "algolia") {
      return this.normalizeAlgoliaHit(envelope);
    }
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

  // --- Layer 12A.3A: HN Search v2 (Algolia) ---

  private parseAlgoliaCursor(cursor: string): number {
    const match = /^algolia-page:(\d+)$/.exec(cursor);
    if (!match) throw new SourceAdapterError("INVALID_CURSOR", "Hacker News Algolia cursor is invalid.");
    return Number(match[1]);
  }

  private async discoverViaAlgolia(request: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const query = (request.query ?? "").trim().slice(0, 200);
    const metadata = request.requestMetadata as Record<string, unknown>;
    const nowMs = Date.now();
    const windowStartMs = request.windowStart ? Date.parse(request.windowStart) : nowMs - HN_ALGOLIA_DEFAULT_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;
    const windowEndMs = request.windowEnd ? Date.parse(request.windowEnd) : nowMs;
    const numericFilters = `created_at_i>${Math.floor(windowStartMs / 1000)},created_at_i<${Math.floor(windowEndMs / 1000)}`;
    const hitsPerPage = Math.max(1, Math.min(HN_ALGOLIA_MAX_HITS_PER_PAGE, request.limit));
    const requestedMaxPages = typeof metadata.maxPages === "number" ? Math.floor(metadata.maxPages) : 1;
    const maxPagesThisCall = Math.max(1, Math.min(HN_ALGOLIA_MAX_PAGES, requestedMaxPages));
    const startPage = request.cursor ? this.parseAlgoliaCursor(request.cursor) : 0;

    const items: RawSourceItemEnvelope[] = [];
    let accepted = 0;
    let rejected = 0;
    let lastRateLimit: RateLimitMetadata | undefined;
    let page = startPage;
    let hasMore = false;
    for (; page < startPage + maxPagesThisCall; page += 1) {
      const params = new URLSearchParams({
        query,
        tags: "(story,comment)",
        numericFilters,
        page: String(page),
        hitsPerPage: String(hitsPerPage),
      });
      const { body, rateLimit: pageRateLimit } = await this.getAlgoliaJson(`${this.algoliaBaseUrl}/search_by_date?${params.toString()}`);
      lastRateLimit = pageRateLimit;
      const parsed = algoliaResponseSchema.safeParse(body);
      if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Hacker News Algolia response failed validation.");
      hasMore = page + 1 < parsed.data.nbPages;
      for (const hit of parsed.data.hits) {
        if (!algoliaHitHasContent(hit)) { rejected += 1; continue; }
        items.push(this.envelopeFromAlgoliaHit(hit, pageRateLimit));
        accepted += 1;
        if (items.length >= request.limit) break;
      }
      if (items.length >= request.limit || !hasMore) { page += 1; break; }
    }
    return {
      items,
      nextCursor: hasMore ? `algolia-page:${page}` : undefined,
      rateLimit: lastRateLimit,
      diagnostics: {
        accepted,
        rejected,
        messages: [`Hacker News Search v2 (Algolia) query "${query.slice(0, 120)}" across stories and comments, page(s) ${startPage}-${page - 1}.`],
      },
    };
  }

  /** Comment hits already carry `story_id` (the root); no Firebase hydration needed to resolve the thread. */
  private envelopeFromAlgoliaHit(hit: AlgoliaHit, hitRateLimit: RateLimitMetadata): RawSourceItemEnvelope {
    const comment = isAlgoliaComment(hit);
    const rootId = comment ? String(hit.story_id ?? hit.objectID) : hit.objectID;
    const parentId = comment ? String(hit.parent_id ?? hit.story_id ?? hit.objectID) : undefined;
    return {
      sourceKey: this.key,
      externalId: hit.objectID,
      fetchedAt: new Date().toISOString(),
      payload: hit,
      requestMetadata: { endpoint: "/search_by_date", provider: "hacker-news-algolia-search-v2" },
      cursorContext: { origin: "algolia", rootId, ...(parentId ? { parentId } : {}), rateLimit: hitRateLimit },
    };
  }

  private normalizeAlgoliaHit(envelope: RawSourceItemEnvelope): SourceItemCandidate {
    const parsed = algoliaHitSchema.safeParse(envelope.payload);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Hacker News Algolia item failed validation.");
    const hit = parsed.data;
    const comment = isAlgoliaComment(hit);
    const rootId = typeof envelope.cursorContext.rootId === "string" ? envelope.cursorContext.rootId : hit.objectID;
    const title = comment ? hit.story_title : hit.title;
    const body = (comment ? hit.comment_text : hit.story_text ?? hit.title) ?? "";
    const threadUrl = `https://news.ycombinator.com/item?id=${rootId}`;
    return sourceItemCandidateSchema.parse({
      sourceKey: this.key,
      externalId: hit.objectID,
      externalConversationId: rootId,
      canonicalUrl: comment ? threadUrl : hit.url ?? threadUrl,
      authorExternalId: hit.author,
      authorDisplayName: hit.author,
      authorProfileUrl: hit.author ? `https://news.ycombinator.com/user?id=${encodeURIComponent(hit.author)}` : undefined,
      title,
      body: body || title || "",
      publishedAt: new Date(hit.created_at_i * 1000).toISOString(),
      capturedAt: envelope.fetchedAt,
      metadata: {
        providerType: comment ? "comment" : "story",
        parentId: envelope.cursorContext.parentId ?? null,
        rootId,
        matchedItemId: hit.objectID,
        threadUrl,
        storyUrl: hit.url ?? hit.story_url ?? null,
        points: hit.points ?? null,
        numComments: hit.num_comments ?? null,
        retrievalImplementationVersion: HACKER_NEWS_SEARCH_V2_VERSION,
      },
      status: (body || title || "").trim() ? "active" : "unavailable",
    });
  }

  private async getAlgoliaJson(url: string): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, { signal: controller.signal });
        const limits: RateLimitMetadata = { provider: "hacker-news-algolia-search-v2", remaining: null, limit: null, retryAfterMs: retryAfterMs(response) };
        if (response.status === 429) throw new SourceAdapterError("RATE_LIMITED", "Hacker News Algolia rate limit reached.", true);
        if (!response.ok) throw new SourceAdapterError(`HTTP_${response.status}`, "Hacker News Algolia request failed.", response.status >= 500);
        return { body: await response.json(), rateLimit: limits };
      } catch (error) {
        lastError = error;
        const retryable = (error instanceof SourceAdapterError && error.retryable) || (error instanceof DOMException && error.name === "AbortError");
        if (!retryable) break;
        if (attempt < this.maxAttempts) {
          const backoffMs = error instanceof SourceAdapterError && error.code === "RATE_LIMITED" ? 1_000 * attempt : 250 * attempt;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastError instanceof SourceAdapterError) throw lastError;
    throw new SourceAdapterError("REQUEST_FAILED", "Hacker News Algolia request timed out or failed.", true);
  }
}

export const hackerNewsSourceAdapter = new HackerNewsSourceAdapter();
