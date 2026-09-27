import {
  rawSourceItemEnvelopeSchema,
  sourceDiscoveryRequestSchema,
  sourceItemCandidateSchema,
  SourceAdapterError,
  type RawSourceItemEnvelope,
  type SourceAdapter,
  type SourceDiscoveryPage,
  type SourceDiscoveryRequest,
  type SourceHealthResult,
  type SourceItemCandidate,
} from "../contracts";
import { devtoRequestMetadataSchema, devtoArticleSchema, devtoCommentSchema, type DevtoArticle, type DevtoComment } from "./devto.schemas";
import { DevtoClient, normalizeDevtoInstance, type DevtoClientOptions } from "./devto.client";

export const DEVTO_DEPTH_VERSION = "devto_depth_v1" as const;
type DevtoMetrics = {
  searchResults: number;
  articlesAccepted: number;
  articlesDropped: number;
  depthEligible: number;
  depthExpanded: number;
  depthRequests: number;
  commentsLoaded: number;
  commentsPersisted: number;
  dropped: number;
  deduplicated: number;
  refreshSkips: number;
  rateLimitSkips: number;
};

const boundedDate = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

const safeUrl = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  try { return new URL(value).toString(); } catch { return undefined; }
};

const htmlToText = (value: string): string => value
  .replace(/<\/(p|div|li|blockquote|pre|h[1-6])>/gi, "\n")
  .replace(/<br\s*\/?\s*>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/\s+\n/g, "\n")
  .replace(/\n\s+/g, "\n")
  .trim();

const demandLanguage = /\b(need|looking for|alternative|switch(?:ing)?|replace|replacement|workflow|pain|friction|feature|missing|cannot|can't|would like|recommend|migration|migrate|pricing|cost|adopt|use instead)\b/i;

function flattenComments(comments: DevtoComment[], parentId: string | null = null, output: Array<{ comment: DevtoComment; parentId: string | null }> = []): Array<{ comment: DevtoComment; parentId: string | null }> {
  for (const comment of comments) {
    output.push({ comment, parentId });
    if (comment.children?.length) flattenComments(comment.children as DevtoComment[], comment.id_code, output);
  }
  return output;
}

function articleId(instance: string, id: number): string { return `devto:${instance}:article:${id}`; }
function commentId(instance: string, idCode: string): string { return `devto:${instance}:comment:${idCode}`; }

export class DevtoSourceAdapter implements SourceAdapter {
  readonly key = "devto";
  readonly capabilities = { supportsSearch: true, supportsIncrementalCursor: true, supportsThreadExpansion: true } as const;
  private readonly client: DevtoClient;
  private readonly clock: () => Date;
  private readonly instance: string;

  constructor(options: DevtoClientOptions & { clock?: () => Date } = {}) {
    this.client = new DevtoClient(options);
    this.clock = options.clock ?? (() => new Date());
    this.instance = normalizeDevtoInstance(options.baseUrl ?? "https://dev.to/api");
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    if (!request.query) throw new SourceAdapterError("QUERY_REQUIRED", "DEV discovery requires a caller-supplied query.");
    const metadata = devtoRequestMetadataSchema.parse(request.requestMetadata);
    const page = request.cursor ? this.parseCursor(request.cursor) : 1;
    if (page > metadata.maxPages) throw new SourceAdapterError("PAGINATION_EXHAUSTED", "DEV pagination is bounded for V1.");
    const result = await this.client.searchArticles({ query: request.query, page, perPage: Math.min(30, Math.max(10, request.limit)), topDays: metadata.topDays });
    const metrics: DevtoMetrics = { searchResults: result.articles.length, articlesAccepted: 0, articlesDropped: 0, depthEligible: 0, depthExpanded: 0, depthRequests: 0, commentsLoaded: 0, commentsPersisted: 0, dropped: 0, deduplicated: 0, refreshSkips: 0, rateLimitSkips: 0 };
    const items: RawSourceItemEnvelope[] = [];
    const seen = new Set<string>();
    const articles: DevtoArticle[] = [];
    const messages: string[] = [];
    for (const value of result.articles) {
      const parsed = devtoArticleSchema.safeParse(value);
      if (!parsed.success) { metrics.articlesDropped += 1; metrics.dropped += 1; continue; }
      const article = parsed.data;
      const externalId = articleId(this.instance, article.id);
      if (seen.has(externalId)) { metrics.deduplicated += 1; continue; }
      seen.add(externalId);
      const publishedAt = boundedDate(article.published_at ?? article.published_timestamp ?? article.created_at);
      if (request.windowStart && publishedAt && publishedAt < request.windowStart) { metrics.refreshSkips += 1; continue; }
      if (request.windowEnd && publishedAt && publishedAt > request.windowEnd) { metrics.articlesDropped += 1; continue; }
      articles.push(article);
      items.push(this.articleEnvelope(article, request));
      metrics.articlesAccepted += 1;
    }
    const maxExpansions = Math.min(metadata.maxArticlesToExpand, articles.length);
    if (metadata.includeComments || request.expandThreads) {
      for (const article of articles.slice(0, maxExpansions)) {
        const searchableText = `${article.title ?? ""} ${article.description ?? ""} ${article.body_markdown ?? ""} ${(article.tag_list ?? []).join(" ")}`;
        if ((article.comments_count ?? 0) <= 0 || !demandLanguage.test(searchableText)) { metrics.refreshSkips += (article.comments_count ?? 0) > 0 ? 1 : 0; continue; }
        metrics.depthEligible += 1;
        try {
          metrics.depthExpanded += 1;
          metrics.depthRequests += 1;
          const comments = await this.client.listComments(article.id);
          const flattened = flattenComments(comments.comments);
          metrics.commentsLoaded += flattened.length;
          const commentSeen = new Set<string>();
          for (const { comment, parentId } of flattened) {
            if (commentSeen.has(comment.id_code)) { metrics.deduplicated += 1; continue; }
            commentSeen.add(comment.id_code);
            const body = htmlToText(comment.body_html ?? "");
            if (!body) { metrics.dropped += 1; continue; }
            const createdAt = boundedDate(comment.created_at);
            if (request.windowStart && createdAt && createdAt < request.windowStart) { metrics.refreshSkips += 1; continue; }
            if (request.windowEnd && createdAt && createdAt > request.windowEnd) { metrics.dropped += 1; continue; }
            if (commentSeen.size > metadata.maxCommentsPerArticle) { metrics.dropped += 1; continue; }
            items.push(this.commentEnvelope(article, comment, parentId, request));
            metrics.commentsPersisted += 1;
          }
        } catch (error) {
          const mapped = error instanceof SourceAdapterError ? error : new SourceAdapterError("DEPTH_REQUEST_FAILED", "DEV comments request failed.", true);
          messages.push(`comments for ${articleId(this.instance, article.id)} unavailable: ${mapped.code}`);
          if (mapped.code === "RATE_LIMITED") metrics.rateLimitSkips += 1;
        }
      }
    }
    for (const item of items) item.requestMetadata.devToV1 = { ...metrics };
    const nextCursor = page < metadata.maxPages && result.articles.length > 0 ? `page:${page + 1}` : undefined;
    return { items, nextCursor, rateLimit: result.rateLimit, providerMetrics: { devToV1: { ...metrics } }, diagnostics: { accepted: items.length, rejected: metrics.dropped, messages: [`DEV article search retained ${metrics.articlesAccepted} public article${metrics.articlesAccepted === 1 ? "" : "s"}; article-vs-demand interpretation remains downstream.`, ...messages] } };
  }

  normalize(rawInput: RawSourceItemEnvelope): SourceItemCandidate {
    const raw = rawSourceItemEnvelopeSchema.parse(rawInput);
    const payload = raw.payload;
    if (!payload || typeof payload !== "object" || !("kind" in payload)) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "DEV envelope is missing kind.");
    const value = payload as { kind?: unknown; article?: unknown; comment?: unknown; parentId?: unknown };
    const article = devtoArticleSchema.safeParse(value.article);
    if (!article.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "DEV article payload failed validation.");
    if (value.kind === "article") return this.normalizeArticle(raw, article.data);
    const comment = devtoCommentSchema.safeParse(value.comment);
    if (!comment.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "DEV comment payload failed validation.");
    return this.normalizeComment(raw, article.data, comment.data, typeof value.parentId === "string" ? value.parentId : null);
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    try { return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit: await this.client.healthCheck(), degradationState: "healthy" }; }
    catch (error) { return { sourceKey: this.key, ok: false, latencyMs: Date.now() - started, degradationState: error instanceof SourceAdapterError && error.code === "RATE_LIMITED" ? "blocked" : "degraded", errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED", errorSummary: error instanceof Error ? error.message.slice(0, 500) : "DEV health check failed." }; }
  }

  private parseCursor(cursor: string): number { const match = /^page:([12])$/.exec(cursor); if (!match) throw new SourceAdapterError("INVALID_CURSOR", "DEV cursor is invalid."); return Number(match[1]); }
  private articleEnvelope(article: DevtoArticle, request: SourceDiscoveryRequest): RawSourceItemEnvelope { return { sourceKey: this.key, externalId: articleId(this.instance, article.id), fetchedAt: this.clock().toISOString(), payload: { kind: "article", article }, requestMetadata: { provider: "devto-public", endpoint: "/api/articles/search", query: request.query ?? null, queryPlanVersion: request.requestMetadata.queryPlanVersion ?? null }, cursorContext: { instance: this.instance, articleId: article.id, itemType: "article" } }; }
  private commentEnvelope(article: DevtoArticle, comment: DevtoComment, parentId: string | null, request: SourceDiscoveryRequest): RawSourceItemEnvelope { return { sourceKey: this.key, externalId: commentId(this.instance, comment.id_code), fetchedAt: this.clock().toISOString(), payload: { kind: "comment", article, comment, parentId }, requestMetadata: { provider: "devto-public", endpoint: "/api/comments", query: request.query ?? null, queryPlanVersion: request.requestMetadata.queryPlanVersion ?? null }, cursorContext: { instance: this.instance, articleId: article.id, commentId: comment.id_code, parentId, rootExternalId: articleId(this.instance, article.id), itemType: "comment" } }; }
  private normalizeArticle(raw: RawSourceItemEnvelope, article: DevtoArticle): SourceItemCandidate { const externalId = articleId(this.instance, article.id); return sourceItemCandidateSchema.parse({ sourceKey: this.key, externalId, externalConversationId: externalId, canonicalUrl: safeUrl(article.url ?? article.canonical_url ?? (article.path ? `https://dev.to${article.path}` : undefined)), authorExternalId: article.user?.user_id ? `devto:user:${article.user.user_id}` : article.user?.username ? `devto:${this.instance}:user:${article.user.username}` : undefined, authorDisplayName: article.user?.name ?? article.user?.username ?? undefined, authorProfileUrl: article.user?.username ? `https://dev.to/${encodeURIComponent(article.user.username)}` : undefined, title: article.title, body: article.body_markdown ?? article.description ?? article.title ?? "", publishedAt: boundedDate(article.published_at ?? article.published_timestamp ?? article.created_at), capturedAt: raw.fetchedAt, metadata: { sourceCategory: "practitioner_article", qualificationContext: "article_context_requires_demand_verification", providerType: "article", instance: this.instance, articleId: article.id, slug: article.slug ?? null, tags: article.tag_list ?? [], commentsCount: article.comments_count ?? 0, publicReactionsCount: article.public_reactions_count ?? null, editedAt: boundedDate(article.edited_at) ?? null, lastCommentAt: boundedDate(article.last_comment_at) ?? null, query: raw.requestMetadata.query ?? null }, status: "active" }); }
  private normalizeComment(raw: RawSourceItemEnvelope, article: DevtoArticle, comment: DevtoComment, parentId: string | null): SourceItemCandidate { const rootExternalId = articleId(this.instance, article.id); const body = htmlToText(comment.body_html ?? ""); return sourceItemCandidateSchema.parse({ sourceKey: this.key, externalId: commentId(this.instance, comment.id_code), externalConversationId: rootExternalId, canonicalUrl: safeUrl(`${article.url ?? `https://dev.to${article.path ?? ""}`}#comments-${encodeURIComponent(comment.id_code)}`), authorExternalId: comment.user?.user_id ? `devto:user:${comment.user.user_id}` : comment.user?.username ? `devto:${this.instance}:user:${comment.user.username}` : undefined, authorDisplayName: comment.user?.name ?? comment.user?.username ?? undefined, authorProfileUrl: comment.user?.username ? `https://dev.to/${encodeURIComponent(comment.user.username)}` : undefined, title: article.title, body, publishedAt: boundedDate(comment.created_at), capturedAt: raw.fetchedAt, metadata: { sourceCategory: "practitioner_article", qualificationContext: "article_comment_context_requires_demand_verification", providerType: "article_comment", instance: this.instance, articleId: article.id, commentId: comment.id_code, parentCommentId: parentId, rootExternalId, rootAuthorId: article.user?.user_id ? `devto:user:${article.user.user_id}` : null }, status: "active" }); }
}

export const devtoSourceAdapter = new DevtoSourceAdapter();
export { DevtoClient, normalizeDevtoInstance } from "./devto.client";
export type { DevtoClientOptions } from "./devto.client";
