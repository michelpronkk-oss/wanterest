import {
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
import type { JsonObject } from "../../../db/database.helpers";
import { getXRuntimeConfig } from "./x.auth";
import {
  decodeXCursor,
  encodeXCursor,
  XClient,
  type XClientOptions,
} from "./x.client";
import { estimateXReadCost, X_PROVIDER_MIN_RESULTS } from "./x.cost";
import {
  xRawItemPayloadSchema,
  xRequestMetadataSchema,
  xTweetSchema,
  xUserSchema,
  type XRequestMetadata,
  type XTweet,
  type XUser,
} from "./x.schemas";
import { normalizeXItem } from "./x.normalizer";
import { getInternalXDiscoveryOverride } from "./x.internal";
import { X_COMPETITOR_PAIN_DISPLACEMENT_ANCHORS, X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION, X_PAIN_REQUEST_ANCHORS, X_PAIN_RETRIEVAL_TEMPLATE_VERSION } from "./x.query";

type XAdapterOptions = XClientOptions & {
  clock?: () => Date;
  maxPostsPerScan?: number;
  postReadCostUsd?: number;
  costConfigVersion?: string;
};

function hasQueryOperator(query: string, operator: string): boolean {
  return new RegExp(`(?:^|\\s)${operator.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?=[:\\s]|$)`, "i").test(query);
}

function composeQuery(request: SourceDiscoveryRequest, metadata: XRequestMetadata): string {
  if (!request.query) throw new SourceAdapterError("QUERY_REQUIRED", "X post discovery requires a caller-supplied query.");
  const terms = [request.query.trim()];
  if (metadata.lang && !hasQueryOperator(request.query, "lang")) terms.push(`lang:${metadata.lang}`);
  if (metadata.from && !hasQueryOperator(request.query, "from")) terms.push(`from:${metadata.from}`);
  if (metadata.to && !hasQueryOperator(request.query, "to")) terms.push(`to:${metadata.to}`);
  if (metadata.hasLinks === true && !request.query.includes("has:links")) terms.push("has:links");
  if (metadata.hasLinks === false && !request.query.includes("-has:links")) terms.push("-has:links");
  if (metadata.excludeRetweets && !request.query.includes("is:retweet") && !request.query.includes("-is:retweet")) terms.push("-is:retweet");
  if (metadata.excludeReplies && !request.query.includes("is:reply") && !request.query.includes("-is:reply")) terms.push("-is:reply");
  const query = terms.join(" ").trim();
  if (query.length > 512) throw new SourceAdapterError("INVALID_QUERY", "X post query is too long after applying provider filters.");
  return query;
}

function userMap(values: unknown[] | undefined): Map<string, XUser> {
  const users = new Map<string, XUser>();
  for (const value of values ?? []) {
    const parsed = xUserSchema.safeParse(value);
    if (parsed.success) users.set(parsed.data.id, parsed.data);
  }
  return users;
}

function withinWindow(tweet: XTweet, request: SourceDiscoveryRequest): boolean {
  if (!tweet.created_at) return true;
  const createdAt = new Date(tweet.created_at).getTime();
  if (request.windowStart && createdAt < new Date(request.windowStart).getTime()) return false;
  if (request.windowEnd && createdAt > new Date(request.windowEnd).getTime()) return false;
  return true;
}

function rejectionReason(tweet: XTweet, author: XUser | undefined, metadata: XRequestMetadata, request: SourceDiscoveryRequest): string | undefined {
  if (author?.protected) return "protected author content is not supported";
  if (!withinWindow(tweet, request)) return "outside the requested time window";
  const references = tweet.referenced_tweets ?? [];
  if (metadata.excludeRetweets && references.some((reference) => reference.type === "retweeted")) return "retweets are excluded";
  if (metadata.excludeReplies && tweet.in_reply_to_user_id) return "replies are excluded";
  return undefined;
}

export class XSourceAdapter implements SourceAdapter {
  readonly key = "x";
  readonly capabilities = {
    supportsSearch: true,
    supportsIncrementalCursor: true,
    supportsThreadExpansion: false,
  } as const;

  private readonly client: XClient;
  private readonly clock: () => Date;
  private readonly maxPostsPerScan: number;
  private readonly postReadCostUsd: number;
  private readonly costConfigVersion: string;

  constructor(options: XAdapterOptions = {}) {
    const runtime = getXRuntimeConfig();
    this.clock = options.clock ?? (() => new Date());
    const merged = { ...runtime, ...options };
    this.maxPostsPerScan = Math.min(merged.maxPostsPerScan ?? 10, 1_000);
    this.postReadCostUsd = merged.postReadCostUsd ?? runtime.postReadCostUsd;
    this.costConfigVersion = merged.costConfigVersion ?? runtime.costConfigVersion;
    this.client = new XClient({ ...merged, clock: this.clock });
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    const metadata = xRequestMetadataSchema.parse(request.requestMetadata);
    if (request.expandThreads) throw new SourceAdapterError("THREAD_EXPANSION_UNSUPPORTED", "X thread expansion is not available in the bounded search adapter.");
    if (metadata.postId && request.cursor) throw new SourceAdapterError("PAGINATION_UNAVAILABLE", "X post lookup does not support pagination.");
    if (typeof metadata.xQueryCompilationError === "string") throw new SourceAdapterError("INVALID_QUERY", `X query compilation failed: ${metadata.xQueryCompilationError}`);

    const messages: string[] = [];
    const items: RawSourceItemEnvelope[] = [];
    let rejected = 0;
    let rateLimit: RateLimitMetadata | undefined;
    const requestedResults = Math.min(request.limit, metadata.maxResults ?? request.limit, 100);
    const providerPageSize = Math.max(X_PROVIDER_MIN_RESULTS, requestedResults);
    const internalOverride = getInternalXDiscoveryOverride(metadata.internalWorkspaceId);
    const plannedBudget = Math.min(metadata.maxBillablePostsPerDiscovery ?? this.maxPostsPerScan, this.maxPostsPerScan);
    const budget = internalOverride
      ? Math.min(this.maxPostsPerScan, Math.max(plannedBudget, Math.min(providerPageSize, internalOverride.maxPostsPerScan)))
      : plannedBudget;
    const estimatedReadCost = estimateXReadCost(providerPageSize, this.postReadCostUsd);
    const baseMetadata: JsonObject = {
      provider: "x-api-v2",
      endpoint: metadata.postId ? "/2/tweets/{id}" : "/2/tweets/search/recent",
      query: request.query ?? null,
      providerQuery: request.requestMetadata.providerQuery ?? request.query ?? null,
      queryCompilationFallback: request.requestMetadata.queryCompilationFallback ?? null,
      maxResults: providerPageSize,
      maxPages: metadata.maxPages,
      maxBillablePostsPerDiscovery: budget,
      estimatedReadCostUsd: estimatedReadCost,
      costConfigVersion: this.costConfigVersion,
      authenticated: true,
    };
    const diagnostic = `X cost estimate: max_posts=${providerPageSize}; estimated_read_cost_usd=${estimatedReadCost.toFixed(6)}; cost_config_version=${this.costConfigVersion}`;

    if (!this.client.hasToken) throw new SourceAdapterError("CONFIGURATION_MISSING", "X API bearer token is not configured.");
    if (budget < providerPageSize) {
      messages.push(`${diagnostic}; discovery skipped because the billable post budget is below the provider minimum.`);
      return { items, rateLimit, estimatedCost: 0, diagnostics: { accepted: 0, rejected: 0, messages } };
    }

    if (metadata.postId) {
      const result = await this.client.getPostById(metadata.postId);
      rateLimit = result.rateLimit;
      const tweetValue = result.response.data?.[0];
      const tweet = xTweetSchema.safeParse(tweetValue);
      if (!tweet.success) {
        messages.push(`${diagnostic}; requested post was unavailable or malformed.`);
        return { items, rateLimit, estimatedCost: estimatedReadCost, diagnostics: { accepted: 0, rejected: 0, messages } };
      }
      const authors = userMap(result.response.includes?.users);
      const author = tweet.data.author_id ? authors.get(tweet.data.author_id) : undefined;
      const reason = rejectionReason(tweet.data, author, metadata, request);
      if (reason) {
        messages.push(`${diagnostic}; post ${tweet.data.id} rejected: ${reason}.`);
        return { items, rateLimit, estimatedCost: estimatedReadCost, diagnostics: { accepted: 0, rejected: 1, messages } };
      }
      items.push(this.envelope(tweet.data, author ?? null, request, baseMetadata, { itemType: "post", conversationId: tweet.data.conversation_id ?? tweet.data.id, page: 1, providerNextToken: null }));
      messages.push(`${diagnostic}; single-post lookup completed.`);
      return { items, rateLimit, estimatedCost: estimatedReadCost, diagnostics: { accepted: 1, rejected: 0, messages } };
    }

    const query = composeQuery(request, metadata);
    const xPainRetrievalV1 = request.requestMetadata.demandSurface === "pain_first" && request.requestMetadata.queryFamily === "pain"
      ? {
          templateVersion: X_PAIN_RETRIEVAL_TEMPLATE_VERSION,
          providerQuery: query,
          requestAnchors: [...X_PAIN_REQUEST_ANCHORS],
          requestCount: 1,
          maxBillablePosts: budget,
          estimatedCostUsd: estimatedReadCost,
        }
      : undefined;
    const competitor = typeof request.requestMetadata.xCompetitorPainCompetitor === "string" ? request.requestMetadata.xCompetitorPainCompetitor : undefined;
    const displacementAnchors = Array.isArray(request.requestMetadata.xCompetitorPainDisplacementAnchors)
      ? request.requestMetadata.xCompetitorPainDisplacementAnchors.filter((value): value is string => typeof value === "string")
      : [...X_COMPETITOR_PAIN_DISPLACEMENT_ANCHORS];
    const xCompetitorPainRetrievalV1 = request.requestMetadata.demandSurface === "competitor_pain" && request.requestMetadata.queryFamily === "comparison" && competitor
      ? {
          templateVersion: X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION,
          providerQuery: query,
          competitor,
          displacementAnchors,
          requestCount: 1,
          maxBillablePosts: budget,
          estimatedCostUsd: estimatedReadCost,
        }
      : undefined;
    const state = request.cursor ? decodeXCursor(request.cursor) : { nextToken: undefined, pagesFetched: 0, billablePosts: 0 };
    if (state.pagesFetched >= metadata.maxPages) {
      messages.push(`${diagnostic}; additional-page discovery is unavailable because the page budget is exhausted.`);
      return { items, rateLimit, estimatedCost: 0, diagnostics: { accepted: 0, rejected: 0, messages } };
    }
    if (state.billablePosts + providerPageSize > budget) {
      messages.push(`${diagnostic}; additional-page discovery was withheld by the billable post budget.`);
      return { items, rateLimit, estimatedCost: 0, diagnostics: { accepted: 0, rejected: 0, messages } };
    }

    const result = await this.client.searchRecent({
      query,
      maxResults: providerPageSize,
      paginationToken: state.nextToken,
      startTime: request.windowStart,
      endTime: request.windowEnd,
    });
    rateLimit = result.rateLimit;
    const authors = userMap(result.response.includes?.users);
    const providerItems = result.response.data ?? [];
    const providerResultCount = result.response.meta?.result_count ?? providerItems.length;
    const pageNumber = state.pagesFetched + 1;
    for (const [index, value] of providerItems.entries()) {
      const parsed = xTweetSchema.safeParse(value);
      if (!parsed.success) {
        rejected += 1;
        messages.push(`post ${index} rejected: malformed provider post.`);
        continue;
      }
      const author = parsed.data.author_id ? authors.get(parsed.data.author_id) : undefined;
      const reason = rejectionReason(parsed.data, author, metadata, request);
      if (reason) {
        rejected += 1;
        messages.push(`post ${parsed.data.id} rejected: ${reason}.`);
        continue;
      }
      if (items.length >= request.limit) break;
      items.push(this.envelope(parsed.data, author ?? null, request, { ...baseMetadata, query, providerResultCount, providerNextToken: result.response.meta?.next_token ?? null }, {
        itemType: "post",
        conversationId: parsed.data.conversation_id ?? parsed.data.id,
        page: pageNumber,
        providerNextToken: result.response.meta?.next_token ?? null,
      }));
    }

    const billablePosts = state.billablePosts + providerResultCount;
    const nextToken = result.response.meta?.next_token;
    const canContinue = Boolean(nextToken) && pageNumber < metadata.maxPages && billablePosts + providerPageSize <= budget;
    if (nextToken && !canContinue) messages.push("Provider cursor retained in diagnostics but not exposed because the configured page or billable-post budget is exhausted.");
    messages.push(diagnostic);
    return {
      items,
      nextCursor: canContinue && nextToken ? encodeXCursor({ nextToken, pagesFetched: pageNumber, billablePosts }) : undefined,
      rateLimit,
      estimatedCost: estimatedReadCost,
      ...(xPainRetrievalV1 || xCompetitorPainRetrievalV1 ? { providerMetrics: { ...(xPainRetrievalV1 ? { xPainRetrievalV1 } : {}), ...(xCompetitorPainRetrievalV1 ? { xCompetitorPainRetrievalV1 } : {}) } } : {}),
      diagnostics: { accepted: items.length, rejected, messages },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    return normalizeXItem(rawSourceItemEnvelopeSchema.parse(raw));
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const snapshot = this.client.getHealthSnapshot();
    if (!snapshot.hasToken) {
      return { sourceKey: this.key, ok: false, latencyMs: 0, degradationState: "degraded", errorCode: "CONFIGURATION_MISSING", errorSummary: "X API bearer token is not configured." };
    }
    if (snapshot.failure) {
      const blocked = ["RATE_LIMITED", "INSUFFICIENT_CREDITS", "AUTH_FAILED", "FORBIDDEN"].includes(snapshot.failure.code);
      return { sourceKey: this.key, ok: false, latencyMs: 0, rateLimit: snapshot.rateLimit, degradationState: blocked ? "blocked" : "degraded", errorCode: snapshot.failure.code, errorSummary: snapshot.failure.summary };
    }
    if (!snapshot.rateLimit) {
      return { sourceKey: this.key, ok: false, latencyMs: 0, degradationState: "degraded", errorCode: "NOT_PROBED", errorSummary: "X health is awaiting a paid API request." };
    }
    return { sourceKey: this.key, ok: true, latencyMs: 0, rateLimit: snapshot.rateLimit, degradationState: "healthy" };
  }

  private envelope(tweet: XTweet, author: XUser | null, request: SourceDiscoveryRequest, requestMetadata: JsonObject, context: JsonObject): RawSourceItemEnvelope {
    const payload = xRawItemPayloadSchema.parse({ tweet, author });
    return {
      sourceKey: this.key,
      externalId: tweet.id,
      fetchedAt: this.clock().toISOString(),
      payload,
      requestMetadata,
      cursorContext: context,
    };
  }
}

export const xSourceAdapter = new XSourceAdapter();
export { XClient } from "./x.client";
export { estimateXReadCost } from "./x.cost";
export { normalizeXItem } from "./x.normalizer";
