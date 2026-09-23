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
import { rateLimitFromHeaders, type SourceFetch } from "../http";

const userSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  username: z.string().optional(),
  url: z.string().url().optional(),
  location: z.string().max(500).nullable().optional(),
}).passthrough();

const commentSchema = z.object({
  id: z.union([z.string(), z.number()]),
  body: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  url: z.string().url(),
  parentId: z.union([z.string(), z.number()]).nullable().optional(),
  user: userSchema.optional(),
  userId: z.union([z.string(), z.number()]).optional(),
  votesCount: z.number().int().optional(),
}).passthrough();

const postSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  tagline: z.string(),
  description: z.string().nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  url: z.string().url(),
  website: z.string().url().optional(),
  votesCount: z.number().int().optional(),
  commentsCount: z.number().int().optional(),
  reviewsCount: z.number().int().optional(),
  reviewsRating: z.number().optional(),
  user: userSchema.optional(),
  userId: z.union([z.string(), z.number()]).optional(),
  topics: z.object({ nodes: z.array(z.object({ name: z.string(), slug: z.string().optional() }).passthrough()) }).optional(),
  comments: z.object({ nodes: z.array(commentSchema).optional() }).optional(),
}).passthrough();

const responseSchema = z.object({
  data: z.object({
    posts: z.object({
      nodes: z.array(postSchema),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable().optional() }),
    }),
  }).optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
}).passthrough();

type ProductHuntPost = z.infer<typeof postSchema>;
type ProductHuntComment = z.infer<typeof commentSchema>;

const queryDocument = `query WanterestProductHuntPosts($first: Int!, $after: String, $postedAfter: DateTime, $postedBefore: DateTime) {
  posts(first: $first, after: $after, order: NEWEST, postedAfter: $postedAfter, postedBefore: $postedBefore) {
    nodes {
      id name tagline description createdAt url website votesCount commentsCount reviewsCount reviewsRating user { id name username url } userId
      topics(first: 8) { nodes { name slug } }
      comments(first: 10, order: NEWEST) { nodes { id body createdAt url parentId user { id name username url } userId votesCount } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const genericTerms = new Set(["a", "an", "and", "best", "for", "from", "how", "in", "looking", "need", "of", "or", "the", "to", "tool", "with"]);

function queryMatches(post: ProductHuntPost, query: string | undefined): boolean {
  if (!query) return true;
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3 && !genericTerms.has(term));
  if (!terms.length) return true;
  const haystack = `${post.name} ${post.tagline} ${post.description ?? ""} ${(post.topics?.nodes ?? []).map((topic) => topic.name).join(" ")} ${(post.comments?.nodes ?? []).map((comment) => comment.body).join(" ")}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function dateInWindow(value: string, request: SourceDiscoveryRequest): boolean {
  const timestamp = Date.parse(value);
  return (!request.windowStart || timestamp >= Date.parse(request.windowStart)) && (!request.windowEnd || timestamp <= Date.parse(request.windowEnd));
}

function id(value: string | number): string {
  return String(value);
}

export type ProductHuntSourceAdapterOptions = {
  token?: string;
  endpoint?: string;
  fetchImpl?: SourceFetch;
  timeoutMs?: number;
};

export class ProductHuntSourceAdapter implements SourceAdapter {
  readonly key = "product-hunt";
  readonly capabilities = { supportsSearch: true, supportsIncrementalCursor: true, supportsThreadExpansion: true } as const;

  private readonly token: string;
  private readonly endpoint: string;
  private readonly fetchImpl: SourceFetch;
  private readonly timeoutMs: number;

  constructor(options: ProductHuntSourceAdapterOptions = {}) {
    this.token = options.token ?? process.env.PRODUCT_HUNT_API_TOKEN?.trim() ?? "";
    this.endpoint = options.endpoint ?? "https://api.producthunt.com/v2/api/graphql";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    if (!this.token) throw new SourceAdapterError("CONFIGURATION_MISSING", "Product Hunt API access is not configured.");
    const first = Math.min(25, Math.max(1, request.limit));
    const body = await this.graphql({
      query: queryDocument,
      variables: { first, after: request.cursor ?? null, postedAfter: request.windowStart ?? null, postedBefore: request.windowEnd ?? null },
    });
    const parsed = responseSchema.safeParse(body.body);
    if (!parsed.success || !parsed.data.data) {
      const message = parsed.success ? parsed.data.errors?.map((error) => error.message).join("; ") : "Product Hunt response failed validation.";
      throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", message || "Product Hunt response did not contain posts.");
    }
    const posts = parsed.data.data.posts.nodes;
    const items: RawSourceItemEnvelope[] = [];
    const includeComments = request.expandThreads || (request.requestMetadata.includeComments !== false);
    let rejected = 0;
    for (const post of posts) {
      if (!dateInWindow(post.createdAt, request) || !queryMatches(post, request.query)) {
        rejected += 1;
        continue;
      }
      items.push(this.envelope(`post:${id(post.id)}`, post, { itemType: "post", postId: id(post.id) }, body.rateLimit));
      if (includeComments) {
        for (const comment of (post.comments?.nodes ?? []).slice(0, Math.min(10, Math.max(0, request.limit - items.length)))) {
          if (!dateInWindow(comment.createdAt, request)) continue;
          items.push(this.envelope(`comment:${id(comment.id)}`, comment, { itemType: "comment", postId: id(post.id), postUrl: post.url }, body.rateLimit));
          if (items.length >= request.limit) break;
        }
      }
      if (items.length >= request.limit) break;
    }
    const pageInfo = parsed.data.data.posts.pageInfo;
    return {
      items: items.slice(0, request.limit),
      nextCursor: pageInfo.hasNextPage && pageInfo.endCursor ? pageInfo.endCursor : undefined,
      rateLimit: body.rateLimit,
      diagnostics: {
        accepted: Math.min(items.length, request.limit),
        rejected,
        messages: [
          "Product Hunt search is implemented as a bounded recent-post query with deterministic local matching; the official posts connection does not expose a free-text search argument.",
          ...(includeComments ? ["Included bounded post comments as launch-discussion context; qualification remains responsible for demand intent."] : []),
        ],
      },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const itemType = raw.cursorContext.itemType;
    if (itemType === "comment") {
      const comment = commentSchema.safeParse(envelope.payload);
      if (!comment.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Product Hunt comment failed validation.");
      const value = comment.data;
      return sourceItemCandidateSchema.parse({
        sourceKey: this.key,
        externalId: envelope.externalId,
        externalConversationId: String(raw.cursorContext.postId ?? ""),
        canonicalUrl: value.url,
        authorExternalId: value.user?.id ? id(value.user.id) : value.userId ? id(value.userId) : undefined,
        authorDisplayName: value.user?.name ?? value.user?.username,
        authorProfileUrl: value.user?.url,
        body: value.body,
        publishedAt: value.createdAt,
        capturedAt: envelope.fetchedAt,
        metadata: {
          sourceCategory: "product_launch_comment",
          providerType: "comment",
          postId: raw.cursorContext.postId ?? null,
          postUrl: raw.cursorContext.postUrl ?? null,
          parentId: value.parentId ? id(value.parentId) : null,
          authorLocation: value.user?.location ?? null,
          votesCount: value.votesCount ?? null,
          qualificationContext: "launch_discussion_not_switching_by_default",
        },
        status: "active",
      });
    }
    const post = postSchema.safeParse(envelope.payload);
    if (!post.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Product Hunt post failed validation.");
    const value = post.data;
    return sourceItemCandidateSchema.parse({
      sourceKey: this.key,
      externalId: envelope.externalId,
      externalConversationId: id(value.id),
      canonicalUrl: value.url,
      authorExternalId: value.user?.id ? id(value.user.id) : value.userId ? id(value.userId) : undefined,
      authorDisplayName: value.user?.name ?? value.user?.username,
      authorProfileUrl: value.user?.url,
      title: value.name,
      body: value.description || value.tagline,
      publishedAt: value.createdAt,
      capturedAt: envelope.fetchedAt,
      metadata: {
        sourceCategory: "product_launch_discussion",
        providerType: "post",
        tagline: value.tagline,
        website: value.website ?? null,
        topics: value.topics?.nodes.map((topic) => topic.name) ?? [],
        votesCount: value.votesCount ?? null,
        commentsCount: value.commentsCount ?? null,
        reviewsCount: value.reviewsCount ?? null,
        reviewsRating: value.reviewsRating ?? null,
        authorLocation: value.user?.location ?? null,
        qualificationContext: "launch_discussion_not_switching_by_default",
      },
      status: "active",
    });
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    if (!this.token) return { sourceKey: this.key, ok: false, latencyMs: 0, degradationState: "blocked", errorCode: "CONFIGURATION_MISSING", errorSummary: "Product Hunt API access is not configured." };
    try {
      const response = await this.graphql({ query: "query { posts(first: 1) { nodes { id } pageInfo { hasNextPage endCursor } } }", variables: {} });
      return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit: response.rateLimit, degradationState: "healthy" };
    } catch (error) {
      return { sourceKey: this.key, ok: false, latencyMs: Date.now() - started, degradationState: "degraded", errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED", errorSummary: error instanceof Error ? error.message.slice(0, 500) : "Product Hunt health check failed." };
    }
  }

  private envelope(externalId: string, payload: ProductHuntPost | ProductHuntComment, context: Record<string, string>, rateLimit: RateLimitMetadata): RawSourceItemEnvelope {
    return { sourceKey: this.key, externalId, fetchedAt: new Date().toISOString(), payload, requestMetadata: { provider: "product-hunt-graphql", endpoint: this.endpoint }, cursorContext: { ...context, rateLimit } };
  }

  private async graphql(input: { query: string; variables: Record<string, unknown> }): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(15_000, Math.max(1_000, this.timeoutMs)));
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const rateLimit = rateLimitFromHeaders(response, "product-hunt-graphql", "authenticated");
      if (response.status === 401 || response.status === 403) throw new SourceAdapterError("AUTHENTICATION_FAILED", "Product Hunt API authentication failed.");
      if (response.status === 429) throw new SourceAdapterError("RATE_LIMITED", "Product Hunt API rate limit reached.", true);
      if (!response.ok) throw new SourceAdapterError(`HTTP_${response.status}`, "Product Hunt API request failed.", response.status >= 500);
      return { body: await response.json(), rateLimit };
    } catch (error) {
      if (error instanceof SourceAdapterError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new SourceAdapterError("TIMEOUT", "Product Hunt API request timed out.", true);
      throw new SourceAdapterError("REQUEST_FAILED", "Product Hunt API request could not be completed.", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const productHuntSourceAdapter = new ProductHuntSourceAdapter();
