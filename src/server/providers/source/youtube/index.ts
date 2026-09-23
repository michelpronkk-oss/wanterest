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

const youtubeAuthorChannelSchema = z.object({ value: z.string().optional() }).passthrough().optional().nullable();
const youtubeCommentSchema = z.object({
  id: z.string().trim().min(1).max(200),
  snippet: z.object({
    authorDisplayName: z.string().optional(),
    authorChannelId: youtubeAuthorChannelSchema,
    textDisplay: z.string().optional(),
    textOriginal: z.string().optional(),
    parentId: z.string().optional(),
    publishedAt: z.string().optional(),
    updatedAt: z.string().optional(),
    likeCount: z.number().int().nonnegative().optional(),
    videoId: z.string().optional(),
  }).passthrough(),
}).passthrough();

const youtubeSearchItemSchema = z.object({
  id: z.object({ videoId: z.string().trim().min(1).max(200).optional() }).passthrough(),
  snippet: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    channelId: z.string().optional(),
    channelTitle: z.string().optional(),
    publishedAt: z.string().optional(),
  }).passthrough(),
}).passthrough();

const youtubeSearchResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(z.unknown()),
}).passthrough();

const youtubeCommentThreadSchema = z.object({
  id: z.string().trim().min(1).max(200),
  snippet: z.object({
    videoId: z.string().trim().min(1).max(200),
    totalReplyCount: z.number().int().nonnegative().optional(),
    topLevelComment: z.unknown(),
  }).passthrough(),
  replies: z.object({ comments: z.array(z.unknown()) }).passthrough().optional(),
}).passthrough();

const youtubeCommentThreadsResponseSchema = z.object({ items: z.array(z.unknown()) }).passthrough();

const youtubePayloadSchema = z.object({
  itemType: z.enum(["comment", "reply"]),
  video: z.object({
    id: z.string().trim().min(1).max(200),
    title: z.string().optional(),
    description: z.string().optional(),
    channelId: z.string().optional(),
    channelTitle: z.string().optional(),
    publishedAt: z.string().optional(),
  }).passthrough(),
  comment: z.unknown(),
  thread: z.object({ totalReplyCount: z.number().int().nonnegative().optional() }).passthrough().optional(),
}).passthrough();

type YouTubeSearchItem = z.infer<typeof youtubeSearchItemSchema>;
type YouTubeComment = z.infer<typeof youtubeCommentSchema>;

export type YouTubeSourceAdapterOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: SourceFetch;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  clock?: () => Date;
};

type YouTubeMetrics = {
  requestCount: number;
  searchRequests: number;
  commentThreadRequests: number;
  videosDiscovered: number;
  commentsReturned: number;
  quotaUnits: number;
  includeReplies: boolean;
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function validDate(value: string | undefined): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function cursorToken(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  if (!cursor.startsWith("youtube:v1:")) throw new SourceAdapterError("INVALID_CURSOR", "YouTube cursor is invalid.");
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor.slice("youtube:v1:".length), "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || !("pageToken" in decoded) || typeof decoded.pageToken !== "string" || decoded.pageToken.length > 500) throw new Error("invalid token");
    return decoded.pageToken;
  } catch {
    throw new SourceAdapterError("INVALID_CURSOR", "YouTube cursor is invalid.");
  }
}

function encodeCursor(pageToken: string): string {
  return `youtube:v1:${Buffer.from(JSON.stringify({ pageToken }), "utf8").toString("base64url")}`;
}

function mapProviderError(error: unknown): SourceAdapterError {
  if (!(error instanceof SourceAdapterError)) return new SourceAdapterError("TEMPORARY_FAILURE", "YouTube API request failed.", true);
  if (error.code === "HTTP_401") return new SourceAdapterError("AUTH_FAILED", "YouTube API authentication failed.");
  if (error.code === "HTTP_403") return new SourceAdapterError("QUOTA_EXCEEDED", "YouTube API quota is unavailable or exhausted.");
  if (error.code === "RATE_LIMITED") return new SourceAdapterError("RATE_LIMITED", "YouTube API rate limit reached.", true);
  if (error.code.startsWith("HTTP_5") || error.code === "TIMEOUT" || error.code === "REQUEST_FAILED") return new SourceAdapterError("TEMPORARY_FAILURE", "YouTube API is temporarily unavailable.", true);
  return error;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : "YouTube provider error.";
}

export class YouTubeSourceAdapter implements SourceAdapter {
  readonly key = "youtube";
  readonly capabilities = { supportsSearch: true, supportsIncrementalCursor: true, supportsThreadExpansion: true } as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: SourceFetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly clock: () => Date;

  constructor(options: YouTubeSourceAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.YOUTUBE_API_KEY?.trim() ?? "";
    this.baseUrl = (options.baseUrl ?? "https://www.googleapis.com/youtube/v3").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = Math.min(2, Math.max(1, options.maxAttempts ?? 2));
    this.backoffMs = Math.min(500, Math.max(0, options.backoffMs ?? 100));
    this.clock = options.clock ?? (() => new Date());
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    if (!this.apiKey) throw new SourceAdapterError("MISSING_CREDENTIALS", "YouTube API key is not configured.");
    if (!request.query) throw new SourceAdapterError("QUERY_REQUIRED", "YouTube discovery requires a bounded semantic query.");

    const metadata = request.requestMetadata as Record<string, unknown>;
    const maxVideos = boundedNumber(metadata.maxVideos, Math.min(3, request.limit), 1, 5);
    const maxCommentsPerVideo = boundedNumber(metadata.maxCommentsPerVideo, Math.min(8, request.limit), 0, 25);
    const maxPages = boundedNumber(metadata.maxPages, 1, 1, 2);
    const includeReplies = metadata.includeReplies === true;
    const metrics: YouTubeMetrics = { requestCount: 0, searchRequests: 0, commentThreadRequests: 0, videosDiscovered: 0, commentsReturned: 0, quotaUnits: 0, includeReplies };
    const items: RawSourceItemEnvelope[] = [];
    const messages: string[] = [];
    let rejected = 0;
    const videoIds = new Set<string>();
    const commentIds = new Set<string>();
    const videos = new Map<string, YouTubeSearchItem>();
    let pageToken = cursorToken(request.cursor);
    let nextPageToken: string | undefined;
    let rateLimit: RateLimitMetadata | undefined;

    for (let page = 0; page < maxPages && videos.size < maxVideos; page += 1) {
      const search = await this.search(request.query, Math.min(50, maxVideos), pageToken);
      metrics.requestCount += 1;
      metrics.searchRequests += 1;
      metrics.quotaUnits += 100;
      rateLimit = search.rateLimit;
      for (const value of search.items) {
        const parsed = youtubeSearchItemSchema.safeParse(value);
        const videoId = parsed.success ? parsed.data.id.videoId : undefined;
        if (!parsed.success || !videoId || videoIds.has(videoId)) continue;
        videoIds.add(videoId);
        videos.set(videoId, parsed.data);
        if (videos.size >= maxVideos) break;
      }
      nextPageToken = search.nextPageToken;
      if (!nextPageToken || videos.size >= maxVideos) break;
      pageToken = nextPageToken;
    }
    metrics.videosDiscovered = videos.size;

    for (const [videoId, searchItem] of videos) {
      if (maxCommentsPerVideo <= 0 || items.length >= request.limit) break;
      try {
        const comments = await this.commentThreads(videoId, maxCommentsPerVideo, includeReplies);
        metrics.requestCount += 1;
        metrics.commentThreadRequests += 1;
        metrics.quotaUnits += 1;
        rateLimit = comments.rateLimit;
        for (const value of comments.items) {
          const thread = youtubeCommentThreadSchema.safeParse(value);
          if (!thread.success) { rejected += 1; messages.push(`malformed YouTube comment thread: ${thread.error.issues[0]?.message ?? "invalid payload"}`); continue; }
          const top = youtubeCommentSchema.safeParse(thread.data.snippet.topLevelComment);
          if (!top.success) { rejected += 1; messages.push(`malformed YouTube comment: ${top.error.issues[0]?.message ?? "invalid payload"}`); }
          if (top.success && !commentIds.has(top.data.id) && items.length < request.limit) {
            commentIds.add(top.data.id);
            items.push(this.envelope(top.data, "comment", videoId, searchItem, thread.data.snippet.totalReplyCount, request, metrics));
            metrics.commentsReturned += 1;
          }
          if (!includeReplies || !thread.data.replies || items.length >= request.limit) continue;
          for (const replyValue of thread.data.replies.comments) {
            if (items.length >= request.limit) break;
            const reply = youtubeCommentSchema.safeParse(replyValue);
            if (!reply.success || commentIds.has(reply.data.id)) continue;
            commentIds.add(reply.data.id);
            items.push(this.envelope(reply.data, "reply", videoId, searchItem, thread.data.snippet.totalReplyCount, request, metrics));
            metrics.commentsReturned += 1;
          }
        }
      } catch (error) {
        const mapped = mapProviderError(error);
        messages.push(`comments for youtube:video:${videoId} unavailable: ${errorSummary(mapped)}`);
        if (mapped.code === "QUOTA_EXCEEDED" || mapped.code === "RATE_LIMITED") break;
      }
    }
    for (const item of items) item.requestMetadata.metrics = { ...metrics };

    const diagnostics = {
      accepted: items.length,
      rejected,
      messages: [
        `YouTube searched ${metrics.videosDiscovered} bounded video candidate${metrics.videosDiscovered === 1 ? "" : "s"}; generic engagement remains subject to demand qualification.`,
        ...messages,
      ],
    };
    return {
      items,
      nextCursor: nextPageToken && maxPages > 1 ? encodeCursor(nextPageToken) : undefined,
      rateLimit,
      estimatedCost: metrics.quotaUnits,
      providerMetrics: { ...metrics },
      diagnostics,
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const parsed = youtubePayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "YouTube comment payload failed validation.");
    const comment = youtubeCommentSchema.safeParse(parsed.data.comment);
    if (!comment.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "YouTube comment failed validation.");
    const videoId = parsed.data.video.id;
    const text = comment.data.snippet.textDisplay ?? comment.data.snippet.textOriginal ?? "";
    const commentId = comment.data.id;
    const canonicalUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`;
    return sourceItemCandidateSchema.parse({
      sourceKey: this.key,
      externalId: `youtube:comment:${commentId}`,
      externalConversationId: `youtube:video:${videoId}`,
      canonicalUrl,
      authorExternalId: comment.data.snippet.authorChannelId?.value ? `youtube:channel:${comment.data.snippet.authorChannelId.value}` : undefined,
      authorDisplayName: comment.data.snippet.authorDisplayName,
      title: parsed.data.video.title,
      body: text,
      publishedAt: validDate(comment.data.snippet.publishedAt),
      capturedAt: envelope.fetchedAt,
      metadata: {
        sourceCategory: "conversation",
        qualificationContext: "human_commentary_not_demand_by_default",
        providerType: parsed.data.itemType,
        videoId,
        videoTitle: parsed.data.video.title ?? null,
        channelId: parsed.data.video.channelId ?? null,
        channelName: parsed.data.video.channelTitle ?? null,
        videoPublishedAt: validDate(parsed.data.video.publishedAt) ?? null,
        commentId,
        parentCommentId: comment.data.snippet.parentId ?? null,
        likeCount: comment.data.snippet.likeCount ?? 0,
        replyCount: parsed.data.thread?.totalReplyCount ?? 0,
        query: envelope.requestMetadata.query ?? null,
        sourcePublishedAt: validDate(comment.data.snippet.publishedAt) ?? null,
        sourceUpdatedAt: validDate(comment.data.snippet.updatedAt) ?? null,
        canonicalVideoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      },
      status: "active",
    });
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    if (!this.apiKey) return { sourceKey: this.key, ok: false, latencyMs: 0, degradationState: "blocked", errorCode: "MISSING_CREDENTIALS", errorSummary: "YouTube API key is not configured." };
    try {
      const result = await this.request("videos", { part: "id", id: "dQw4w9WgXcQ" });
      return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit: result.rateLimit, degradationState: "healthy" };
    } catch (error) {
      const mapped = mapProviderError(error);
      const blocked = ["QUOTA_EXCEEDED", "RATE_LIMITED", "AUTH_FAILED"].includes(mapped.code);
      return { sourceKey: this.key, ok: false, latencyMs: Date.now() - started, degradationState: blocked ? "blocked" : "degraded", errorCode: mapped.code, errorSummary: errorSummary(mapped) };
    }
  }

  private async search(query: string, maxResults: number, pageToken?: string): Promise<{ items: unknown[]; nextPageToken?: string; rateLimit: RateLimitMetadata }> {
    const result = await this.request("search", { part: "snippet", type: "video", q: query.slice(0, 180), maxResults: String(maxResults), ...(pageToken ? { pageToken } : {}) });
    const parsed = youtubeSearchResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "YouTube search response failed validation.");
    return { items: parsed.data.items, nextPageToken: parsed.data.nextPageToken, rateLimit: result.rateLimit };
  }

  private async commentThreads(videoId: string, maxResults: number, includeReplies: boolean): Promise<{ items: unknown[]; rateLimit: RateLimitMetadata }> {
    const result = await this.request("commentThreads", { part: includeReplies ? "snippet,replies" : "snippet", videoId, maxResults: String(Math.min(100, maxResults)), order: "relevance", textFormat: "plainText" });
    const parsed = youtubeCommentThreadsResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "YouTube comment response failed validation.");
    return { items: parsed.data.items, rateLimit: result.rateLimit };
  }

  private async request(endpoint: string, params: Record<string, string>): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const url = new URL(`${this.baseUrl}/${endpoint}`);
        Object.entries({ ...params, key: this.apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
        const response = await fetchJson(this.fetchImpl, url, { provider: "youtube-data-api", mode: "authenticated", timeoutMs: this.timeoutMs });
        return { body: response.body, rateLimit: response.rateLimit };
      } catch (error) {
        lastError = mapProviderError(error);
        if (!(lastError instanceof SourceAdapterError) || !lastError.retryable || attempt >= this.maxAttempts) break;
        if (this.backoffMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(this.backoffMs * 2 ** (attempt - 1), 1_000)));
      }
    }
    throw lastError instanceof SourceAdapterError ? lastError : new SourceAdapterError("TEMPORARY_FAILURE", "YouTube API request failed.", true);
  }

  private envelope(comment: YouTubeComment, itemType: "comment" | "reply", videoId: string, searchItem: YouTubeSearchItem, totalReplyCount: number | undefined, request: SourceDiscoveryRequest, metrics: YouTubeMetrics): RawSourceItemEnvelope {
    const video = { id: videoId, title: searchItem.snippet.title, description: searchItem.snippet.description, channelId: searchItem.snippet.channelId, channelTitle: searchItem.snippet.channelTitle, publishedAt: searchItem.snippet.publishedAt };
    return {
      sourceKey: this.key,
      externalId: `youtube:comment:${comment.id}`,
      fetchedAt: this.clock().toISOString(),
      payload: { itemType, video, comment, thread: { totalReplyCount } },
      requestMetadata: { provider: "youtube-data-api", endpoint: itemType === "reply" ? "/commentThreads" : "/commentThreads", query: request.query ?? null, metrics: { ...metrics } },
      cursorContext: { itemType, videoId, parentCommentId: comment.snippet.parentId ?? null, query: request.query ?? null },
    };
  }
}

export const youtubeSourceAdapter = new YouTubeSourceAdapter();
