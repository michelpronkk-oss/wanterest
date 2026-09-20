import {
  sourceDiscoveryRequestSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type SourceAdapter,
  type SourceDiscoveryPage,
  type SourceDiscoveryRequest,
  type SourceHealthResult,
  type SourceItemCandidate,
} from "../contracts";
import { BlueskyClient, type BlueskyClientOptions } from "./bluesky.client";
import { normalizeBlueskyPost } from "./bluesky.normalizer";
import { blueskyPostSchema } from "./bluesky.schemas";

export class BlueskySourceAdapter implements SourceAdapter {
  readonly key = "bluesky";
  readonly capabilities = {
    supportsSearch: true,
    supportsIncrementalCursor: false,
    supportsThreadExpansion: false,
  } as const;

  private readonly client: BlueskyClient;
  private readonly clock: () => Date;

  constructor(options: BlueskyClientOptions = {}) {
    this.client = new BlueskyClient(options);
    this.clock = options.clock ?? (() => new Date());
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    if (!request.query) throw new SourceAdapterError("QUERY_REQUIRED", "Bluesky discovery requires a caller-supplied query.");
    if (request.expandThreads) throw new SourceAdapterError("THREAD_EXPANSION_UNSUPPORTED", "Bluesky thread expansion is not enabled.");
    if (request.cursor) throw new SourceAdapterError("PAGINATION_UNAVAILABLE", "Bluesky AppView cursor pagination is disabled for V1.");

    const result = await this.client.searchPosts({
      query: request.query,
      limit: Math.min(request.limit, 20),
      cursor: request.cursor,
      windowStart: request.windowStart,
      windowEnd: request.windowEnd,
      requestMetadata: request.requestMetadata,
    });
    const items: RawSourceItemEnvelope[] = [];
    const messages: string[] = result.response.cursor
      ? ["provider cursor returned but withheld: api.bsky.app cursor pagination is disabled for V1"]
      : [];
    for (const [index, value] of result.response.posts.entries()) {
      const parsed = blueskyPostSchema.safeParse(value);
      if (!parsed.success) {
        messages.push(`post ${index} rejected: malformed Bluesky post`);
        continue;
      }
      const createdAt = Date.parse(parsed.data.record.createdAt);
      if (request.windowStart && createdAt < Date.parse(request.windowStart)) continue;
      if (request.windowEnd && createdAt > Date.parse(request.windowEnd)) continue;
      items.push({
        sourceKey: this.key,
        externalId: parsed.data.uri,
        fetchedAt: this.clock().toISOString(),
        payload: parsed.data,
        requestMetadata: {
          provider: "bluesky-appview",
          endpoint: "/xrpc/app.bsky.feed.searchPosts",
          query: request.query,
          limit: Math.min(request.limit, 20),
          providerCursor: result.response.cursor ?? null,
        },
        cursorContext: {
          requestCursor: request.cursor ?? null,
          responseCursor: result.response.cursor ?? null,
          replyRootUri: parsed.data.record.reply?.root.uri ?? null,
        },
      });
    }
    return {
      items,
      rateLimit: result.rateLimit,
      diagnostics: {
        accepted: items.length,
        rejected: result.response.posts.length - items.length,
        messages,
      },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    return normalizeBlueskyPost(raw);
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    try {
      const rateLimit = await this.client.healthCheck();
      return {
        sourceKey: this.key,
        ok: true,
        latencyMs: Date.now() - started,
        rateLimit,
        degradationState: "healthy",
      };
    } catch (error) {
      return {
        sourceKey: this.key,
        ok: false,
        latencyMs: Date.now() - started,
        degradationState: error instanceof SourceAdapterError && error.code === "RATE_LIMITED" ? "blocked" : "degraded",
        errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED",
        errorSummary: error instanceof Error ? error.message.slice(0, 500) : "Bluesky health check failed.",
      };
    }
  }
}

export const blueskySourceAdapter = new BlueskySourceAdapter();
