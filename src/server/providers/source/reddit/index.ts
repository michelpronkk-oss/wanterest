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
  type RateLimitMetadata,
} from "../contracts";
import type { JsonObject } from "../../../db/database.helpers";
import { RedditClient, decodeRedditCursor, encodeRedditCursor, type RedditClientOptions } from "./reddit.client";
import { RedditTokenManager, getRedditRuntimeConfig } from "./reddit.auth";
import { redditCommentDataSchema, redditListingChildSchema, redditListingSchema, redditRequestMetadataSchema, redditSubmissionDataSchema } from "./reddit.schemas";
import { normalizeRedditItem, redditExternalId } from "./reddit.normalizer";

function postCreatedAt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value * 1_000 : undefined;
}

function inWindow(createdAt: number | undefined, request: SourceDiscoveryRequest): boolean {
  if (createdAt === undefined) return true;
  if (request.windowStart && createdAt < Date.parse(request.windowStart)) return false;
  if (request.windowEnd && createdAt > Date.parse(request.windowEnd)) return false;
  return true;
}

type RedditAdapterOptions = RedditClientOptions & { clock?: () => Date };

export class RedditSourceAdapter implements SourceAdapter {
  readonly key = "reddit";
  readonly capabilities = {
    supportsSearch: true,
    supportsIncrementalCursor: true,
    supportsThreadExpansion: true,
  } as const;

  private readonly client: RedditClient;
  private readonly clock: () => Date;

  constructor(options: RedditAdapterOptions = {}) {
    const runtime = getRedditRuntimeConfig();
    const merged = { ...runtime, ...options };
    this.clock = options.clock ?? (() => new Date());
    this.client = new RedditClient({
      ...merged,
      clock: this.clock,
      tokenManager: options.tokenManager ?? new RedditTokenManager({ ...merged, clock: this.clock }),
    });
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    if (!request.query) throw new SourceAdapterError("QUERY_REQUIRED", "Reddit discovery requires a caller-supplied query.");
    const metadata = redditRequestMetadataSchema.parse(request.requestMetadata);
    if (metadata.subreddit && metadata.community && metadata.subreddit.toLowerCase() !== metadata.community.toLowerCase()) {
      throw new SourceAdapterError("INVALID_REQUEST_METADATA", "Reddit subreddit and community metadata must agree.");
    }
    const subreddit = metadata.subreddit ?? metadata.community;
    const providerAfter = request.cursor ? decodeRedditCursor(request.cursor) : undefined;
    const search = await this.client.searchSubmissions({
      query: request.query,
      limit: request.limit,
      subreddit,
      sort: metadata.sort,
      time: metadata.time,
      excludeNsfw: metadata.excludeNsfw,
      after: providerAfter,
    });
    const listing = redditListingSchema.parse(search.listing);
    const items: RawSourceItemEnvelope[] = [];
    const messages: string[] = [];
    let rejected = 0;
    let rateLimit: RateLimitMetadata | undefined = search.rateLimit;
    const expandedPosts = new Set<string>();
    for (const [index, childValue] of listing.data.children.entries()) {
      const child = redditListingChildSchema.safeParse(childValue);
      if (!child.success || child.data.kind !== "t3") {
        rejected += 1;
        messages.push(`search child ${index} rejected: expected a Reddit submission`);
        continue;
      }
      const submission = redditSubmissionDataSchema.safeParse(child.data.data);
      if (!submission.success || !inWindow(postCreatedAt(submission.data.created_utc), request)) {
        rejected += 1;
        if (submission.success) messages.push(`submission ${index} rejected: outside requested time window`);
        else messages.push(`submission ${index} rejected: malformed Reddit submission`);
        continue;
      }
      const externalId = redditExternalId("t3", submission.data);
      items.push(this.envelope(childValue, externalId, request, metadata, {
        itemType: "post",
        rootFullname: externalId,
        providerAfter: search.providerAfter ?? null,
      }));
      if (request.expandThreads && metadata.maxComments > 0 && !expandedPosts.has(externalId)) {
        expandedPosts.add(externalId);
        try {
          const comments = await this.client.getPostComments({
            postId: submission.data.id,
            limit: metadata.maxComments,
            depth: metadata.maxCommentDepth,
            sort: metadata.commentSort,
          });
          rateLimit = comments.rateLimit;
          const commentItems = this.commentEnvelopes(comments.response, submission.data, request, metadata, messages);
          items.push(...commentItems);
          rejected += Math.max(0, metadata.maxComments - commentItems.length);
        } catch (error) {
          messages.push(`comments for ${externalId} unavailable: ${error instanceof Error ? error.message.slice(0, 200) : "provider error"}`);
        }
      }
    }
    return {
      items,
      nextCursor: listing.data.after ? encodeRedditCursor(listing.data.after) : undefined,
      rateLimit,
      diagnostics: { accepted: items.length, rejected, messages },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    return normalizeRedditItem(rawSourceItemEnvelopeSchema.parse(raw));
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    try {
      const rateLimit = await this.client.healthCheck();
      return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit, degradationState: "healthy" };
    } catch (error) {
      return {
        sourceKey: this.key,
        ok: false,
        latencyMs: Date.now() - started,
        degradationState: error instanceof SourceAdapterError && (error.code === "RATE_LIMITED" || error.code === "FORBIDDEN") ? "blocked" : "degraded",
        errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED",
        errorSummary: error instanceof Error ? error.message.slice(0, 500) : "Reddit health check failed.",
      };
    }
  }

  private envelope(payload: unknown, externalId: string, request: SourceDiscoveryRequest, metadata: ReturnType<typeof redditRequestMetadataSchema.parse>, context: JsonObject): RawSourceItemEnvelope {
    return {
      sourceKey: this.key,
      externalId,
      fetchedAt: this.clock().toISOString(),
      payload,
      requestMetadata: {
        provider: "reddit-data-api",
        endpoint: metadata.subreddit ?? metadata.community ? "/r/:subreddit/search" : "/search",
        query: request.query ?? null,
        subreddit: metadata.subreddit ?? metadata.community ?? null,
        sort: metadata.sort,
        time: metadata.time ?? null,
        commentSort: metadata.commentSort,
        maxComments: metadata.maxComments,
        maxCommentDepth: metadata.maxCommentDepth,
      },
      cursorContext: context,
    };
  }

  private commentEnvelopes(response: unknown, post: { id: string; name?: string }, request: SourceDiscoveryRequest, metadata: ReturnType<typeof redditRequestMetadataSchema.parse>, messages: string[]): RawSourceItemEnvelope[] {
    if (!Array.isArray(response) || response.length < 2) {
      messages.push(`comments for ${redditExternalId("t3", post)} rejected: malformed Reddit comment response`);
      return [];
    }
    const commentsListing = redditListingSchema.safeParse(response[1]);
    if (!commentsListing.success) {
      messages.push(`comments for ${redditExternalId("t3", post)} rejected: malformed Reddit comment listing`);
      return [];
    }
    const result: RawSourceItemEnvelope[] = [];
    const root = redditExternalId("t3", post);
    const visit = (value: unknown, depth: number) => {
      if (result.length >= metadata.maxComments) return;
      const child = redditListingChildSchema.safeParse(value);
      if (!child.success) { messages.push("comment rejected: malformed Reddit comment child"); return; }
      if (child.data.kind === "more") return;
      if (child.data.kind !== "t1") { messages.push("comment rejected: unsupported Reddit child kind"); return; }
      const comment = redditCommentDataSchema.safeParse(child.data.data);
      if (!comment.success) { messages.push("comment rejected: malformed Reddit comment"); return; }
      const externalId = redditExternalId("t1", comment.data);
      result.push(this.envelope(child.data, externalId, request, metadata, {
        itemType: "comment",
        rootFullname: root,
        parentFullname: comment.data.parent_id ?? root,
      }));
      if (depth >= metadata.maxCommentDepth) return;
      const replies = comment.data.replies;
      if (!replies || typeof replies !== "object") return;
      const parsedReplies = redditListingSchema.safeParse(replies);
      if (!parsedReplies.success) return;
      const repliesChildren = parsedReplies.data.data.children;
      if (Array.isArray(repliesChildren)) for (const reply of repliesChildren) visit(reply, depth + 1);
    };
    const commentChildren = commentsListing.data.data.children;
    if (Array.isArray(commentChildren)) for (const child of commentChildren) visit(child, 0);
    return result;
  }
}

export const redditSourceAdapter = new RedditSourceAdapter();
export { RedditClient, RedditTokenManager };
export { normalizeRedditItem } from "./reddit.normalizer";
