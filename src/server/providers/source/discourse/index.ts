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
import {
  cleanDiscourseContent,
  createDiscourseDepthTelemetry,
  DISCOURSE_DEPTH_MAX_POSTS_PER_TOPIC,
  DISCOURSE_DEPTH_MAX_REQUESTS,
  DISCOURSE_DEPTH_MAX_TOPIC_PAGES,
  DISCOURSE_DEPTH_MAX_TOPICS_PER_PAGE,
  DISCOURSE_DEPTH_VERSION,
  evaluateDiscourseDepth,
  selectDiscoursePosts,
  type DiscourseDepthPost,
} from "./discourse-depth";

const topicSummarySchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().optional(),
  title: z.string().default(""),
  excerpt: z.string().nullable().optional(),
  blurb: z.string().nullable().optional(),
  posts_count: z.number().int().nonnegative().optional(),
  reply_count: z.number().int().nonnegative().optional(),
  like_count: z.number().int().nonnegative().optional(),
  category_id: z.number().int().positive().nullable().optional(),
  category_name: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  closed: z.boolean().optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  bumped_at: z.string().optional(),
  last_posted_at: z.string().optional(),
  user: z.object({ username: z.string().optional(), user_id: z.number().int().optional(), name: z.string().nullable().optional() }).optional(),
  url: z.string().optional(),
  accepted_answer_post_id: z.number().int().positive().nullable().optional(),
  accepted_answer_post_number: z.number().int().positive().nullable().optional(),
}).passthrough();

const searchResponseSchema = z.object({ topics: z.array(z.unknown()).default([]), more_topics_url: z.string().nullable().optional() }).passthrough();

const postSchema = z.object({
  id: z.number().int().positive(),
  post_number: z.number().int().positive(),
  username: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  user_id: z.number().int().nullable().optional(),
  user_title: z.string().nullable().optional(),
  user: z.object({ user_type: z.string().optional(), username: z.string().optional(), id: z.number().int().optional() }).optional(),
  cooked: z.string().nullable().optional(),
  raw: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  reply_to_post_number: z.number().int().positive().nullable().optional(),
  like_count: z.number().int().nonnegative().nullable().optional(),
  hidden: z.boolean().optional(),
  deleted_at: z.string().nullable().optional(),
  post_type: z.number().int().optional(),
  url: z.string().optional(),
  topic_id: z.number().int().positive().optional(),
  topic_slug: z.string().optional(),
  accepted_answer: z.boolean().optional(),
}).passthrough();

const topicResponseSchema = topicSummarySchema.extend({
  post_stream: z.object({ posts: z.array(z.unknown()).default([]), stream: z.array(z.number().int().positive()).optional() }).optional(),
  posts: z.array(z.unknown()).optional(),
}).passthrough();

type TopicSummary = z.infer<typeof topicSummarySchema>;
type DiscoursePost = z.infer<typeof postSchema>;

export type DiscourseSourceAdapterOptions = {
  baseUrl?: string;
  fetchImpl?: SourceFetch;
  timeoutMs?: number;
  clock?: () => Date;
};

function instanceFrom(value: string): string | null {
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

export function normalizeDiscourseInstance(value: string): string | null {
  return instanceFrom(value.trim());
}

function configuredInstances(metadata: Record<string, unknown>, fallback?: string): string[] {
  const candidates: string[] = [];
  const many = metadata.discourseInstances;
  if (Array.isArray(many)) candidates.push(...many.filter((item): item is string => typeof item === "string"));
  for (const key of ["discourseInstance", "baseUrl", "site"]) {
    if (typeof metadata[key] === "string") candidates.push(metadata[key]);
  }
  const configured = fallback ?? process.env.DISCOURSE_BASE_URL;
  if (configured) candidates.push(...configured.split(","));
  return [...new Set(candidates.map(normalizeDiscourseInstance).filter((value): value is string => Boolean(value)))].slice(0, 3);
}

function pathUrl(instance: string, path: string): string {
  const parsed = new URL(instance);
  const basePath = parsed.pathname.replace(/\/$/, "");
  return `${parsed.origin}${basePath}/${path.replace(/^\//, "")}`;
}

function topicUrl(instance: string, topic: TopicSummary): string {
  const slug = topic.slug ? encodeURIComponent(topic.slug) : "topic";
  return pathUrl(instance, `t/${slug}/${topic.id}`);
}

function postUrl(instance: string, topic: TopicSummary, post: DiscoursePost): string {
  return `${topicUrl(instance, topic)}/${post.post_number}`;
}

function encodeCursor(state: { instanceIndex: number; pages: Record<string, number> }): string {
  return `discourse:v1:${Buffer.from(JSON.stringify(state), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string | undefined, instances: readonly string[]): { instanceIndex: number; pages: Record<string, number> } {
  if (!cursor) return { instanceIndex: 0, pages: Object.fromEntries(instances.map((instance) => [instance, 1])) };
  const match = /^discourse:v1:([A-Za-z0-9_-]+)$/.exec(cursor);
  if (!match) throw new SourceAdapterError("INVALID_CURSOR", "Discourse cursor is invalid.");
  try {
    const parsed = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as { instanceIndex?: unknown; pages?: unknown };
    const instanceIndex = typeof parsed.instanceIndex === "number" && Number.isInteger(parsed.instanceIndex) && parsed.instanceIndex >= 0 ? parsed.instanceIndex : 0;
    const rawPages = parsed.pages && typeof parsed.pages === "object" && !Array.isArray(parsed.pages) ? parsed.pages as Record<string, unknown> : {};
    const pages = Object.fromEntries(instances.map((instance) => [instance, typeof rawPages[instance] === "number" && Number.isInteger(rawPages[instance]) && rawPages[instance] >= 1 ? rawPages[instance] : 1]));
    return { instanceIndex: Math.min(instanceIndex, Math.max(0, instances.length - 1)), pages };
  } catch {
    throw new SourceAdapterError("INVALID_CURSOR", "Discourse cursor is invalid.");
  }
}

function depthEnabled(metadata: Record<string, unknown>): boolean {
  return metadata.depthPolicyVersion === DISCOURSE_DEPTH_VERSION || metadata.discourseV1 === true || metadata.queryPlanVersion === "query_planning_v8";
}

function metadataNumber(metadata: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;
}

function knownPostIds(metadata: Record<string, unknown>): Set<number> {
  const values = Array.isArray(metadata.knownPostIds) ? metadata.knownPostIds : [];
  return new Set(values.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0));
}

function postToDepthPost(post: DiscoursePost, acceptedPostId: number | null | undefined): DiscourseDepthPost {
  return {
    id: post.id,
    postNumber: post.post_number,
    body: post.cooked ?? post.raw,
    username: post.username ?? post.user?.username,
    authorType: post.user?.user_type,
    userId: post.user_id ?? post.user?.id,
    replyToPostNumber: post.reply_to_post_number,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    likeCount: post.like_count,
    hidden: post.hidden,
    deleted: Boolean(post.deleted_at),
    isSolution: post.accepted_answer === true || post.id === acceptedPostId,
  };
}

function postItemEnvelope(input: { instance: string; topic: TopicSummary; post: DiscoursePost; fetchedAt: string; rootExternalId: string; itemType: "topic_root" | "reply"; acceptedPostId?: number | null; queryPlanVersion?: string }): RawSourceItemEnvelope {
  const postIdentity = input.itemType === "topic_root" ? input.rootExternalId : `discourse:${input.instance}:topic:${input.topic.id}:post:${input.post.id}`;
  return {
    sourceKey: "discourse",
    externalId: postIdentity,
    fetchedAt: input.fetchedAt,
    payload: input.post,
    requestMetadata: { provider: "discourse", endpoint: "/t/{slug}/{id}.json", instance: input.instance, ...(input.queryPlanVersion ? { queryPlanVersion: input.queryPlanVersion } : {}), depthPolicyVersion: DISCOURSE_DEPTH_VERSION },
    cursorContext: {
      instance: input.instance,
      topicId: input.topic.id,
      topicSlug: input.topic.slug ?? null,
      topicTitle: input.topic.title,
      topicTags: input.topic.tags ?? [],
      categoryId: input.topic.category_id ?? null,
      categoryName: input.topic.category_name ?? null,
      topicState: input.topic.archived ? "archived" : input.topic.closed ? "closed" : "open",
      topicCreatedAt: input.topic.created_at ?? null,
      topicUpdatedAt: input.topic.updated_at ?? null,
      topicBumpedAt: input.topic.bumped_at ?? null,
      topicLikeCount: input.topic.like_count ?? null,
      topicExternalId: input.rootExternalId,
      rootExternalId: input.rootExternalId,
      itemType: input.itemType,
      postId: input.post.id,
      postNumber: input.post.post_number,
      parentPostNumber: input.post.reply_to_post_number ?? null,
      postUrl: postUrl(input.instance, input.topic, input.post),
      topicUrl: topicUrl(input.instance, input.topic),
      acceptedPostId: input.acceptedPostId ?? null,
    },
  };
}

export class DiscourseSourceAdapter implements SourceAdapter {
  readonly key = "discourse";
  readonly capabilities = { supportsSearch: true, supportsIncrementalCursor: true, supportsThreadExpansion: true } as const;

  private readonly baseUrl?: string;
  private readonly fetchImpl: SourceFetch;
  private readonly timeoutMs: number;
  private readonly clock: () => Date;

  constructor(options: DiscourseSourceAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ? normalizeDiscourseInstance(options.baseUrl) ?? undefined : undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.clock = options.clock ?? (() => new Date());
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = sourceDiscoveryRequestSchema.parse(input);
    const metadata = request.requestMetadata as Record<string, unknown>;
    const instances = configuredInstances(metadata, this.baseUrl);
    if (!instances.length) throw new SourceAdapterError("DISCOURSE_INSTANCE_REQUIRED", "Discourse discovery requires a configured HTTPS public instance.");
    const useDepth = depthEnabled(metadata);
    const depthMetrics = createDiscourseDepthTelemetry();
    const state = decodeCursor(request.cursor, instances);
    const maxPages = Math.min(DISCOURSE_DEPTH_MAX_TOPIC_PAGES, metadataNumber(metadata, "maxPages", DISCOURSE_DEPTH_MAX_TOPIC_PAGES, DISCOURSE_DEPTH_MAX_TOPIC_PAGES));
    const maxTopics = Math.min(DISCOURSE_DEPTH_MAX_TOPICS_PER_PAGE, metadataNumber(metadata, "maxDepthTopicsPerPage", DISCOURSE_DEPTH_MAX_TOPICS_PER_PAGE, DISCOURSE_DEPTH_MAX_TOPICS_PER_PAGE));
    const maxPosts = Math.min(DISCOURSE_DEPTH_MAX_POSTS_PER_TOPIC, metadataNumber(metadata, "maxPostsPerTopic", DISCOURSE_DEPTH_MAX_POSTS_PER_TOPIC, DISCOURSE_DEPTH_MAX_POSTS_PER_TOPIC));
    const maxRequests = Math.min(DISCOURSE_DEPTH_MAX_REQUESTS, metadataNumber(metadata, "maxDepthRequests", DISCOURSE_DEPTH_MAX_REQUESTS, DISCOURSE_DEPTH_MAX_REQUESTS));
    const seen = new Set<string>();
    const items: RawSourceItemEnvelope[] = [];
    const messages: string[] = [];
    let rateLimit: RateLimitMetadata | undefined;
    let instanceIndex = state.instanceIndex;
    let stoppedByRateLimit = false;

    const append = (item: RawSourceItemEnvelope): boolean => {
      if (seen.has(item.externalId)) {
        if (useDepth) depthMetrics.deduplicated += 1;
        return false;
      }
      seen.add(item.externalId);
      items.push(item);
      if (useDepth) depthMetrics.postsPersisted += 1;
      return true;
    };

    while (instanceIndex < instances.length && !stoppedByRateLimit) {
      const instance = instances[instanceIndex]!;
      let page = state.pages[instance] ?? 1;
      for (; page <= maxPages && !stoppedByRateLimit; page += 1) {
        let search: { body: unknown; rateLimit: RateLimitMetadata };
        try {
          const params = new URLSearchParams({ page: String(page), per_page: String(Math.max(1, Math.min(request.limit, useDepth ? maxTopics : 50))) });
          if (request.query) params.set("q", request.query.slice(0, 200));
          if (request.windowStart) params.set("after", request.windowStart);
          if (request.windowEnd) params.set("before", request.windowEnd);
          search = await this.providerRequest(pathUrl(instance, `search.json?${params.toString()}`));
          rateLimit = search.rateLimit;
        } catch (error) {
          if (error instanceof SourceAdapterError && error.code === "RATE_LIMITED") { depthMetrics.rateLimitSkips += 1; stoppedByRateLimit = true; break; }
          throw error;
        }
        const parsedSearch = searchResponseSchema.safeParse(search.body);
        if (!parsedSearch.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Discourse search response failed validation.");
        const topics = parsedSearch.data.topics.map((value) => topicSummarySchema.safeParse(value)).filter((result): result is { success: true; data: TopicSummary } => result.success).map((result) => result.data);
        for (const topic of topics) {
          depthMetrics.searchRoots += 1;
          if (useDepth && depthMetrics.depthEligible >= maxTopics && depthMetrics.searchRoots > maxTopics) { depthMetrics.capSkips += 1; continue; }
          if (request.windowStart && topic.bumped_at && Date.parse(topic.bumped_at) < Date.parse(request.windowStart)) { depthMetrics.refreshSkips += 1; continue; }
          const rootExternalId = `discourse:${instance}:topic:${topic.id}`;
          if (!useDepth) {
            const rootPost = this.summaryAsPost(topic);
            append(postItemEnvelope({ instance, topic, post: rootPost, fetchedAt: this.clock().toISOString(), rootExternalId, itemType: "topic_root", queryPlanVersion: typeof metadata.queryPlanVersion === "string" ? metadata.queryPlanVersion : undefined }));
            continue;
          }
          if (depthMetrics.depthRequests >= maxRequests) { depthMetrics.capSkips += 1; continue; }
          let detail: { body: unknown; rateLimit: RateLimitMetadata };
          try {
            depthMetrics.depthRequests += 1;
            detail = await this.providerRequest(`${topicUrl(instance, topic)}.json`);
            rateLimit = detail.rateLimit;
          } catch (error) {
            if (error instanceof SourceAdapterError && error.code === "RATE_LIMITED") { depthMetrics.rateLimitSkips += 1; stoppedByRateLimit = true; break; }
            messages.push(`topic ${rootExternalId} unavailable: ${error instanceof Error ? error.message.slice(0, 200) : "provider error"}`);
            continue;
          }
          const parsedDetail = topicResponseSchema.safeParse(detail.body);
          if (!parsedDetail.success) { depthMetrics.dropped += 1; messages.push(`topic ${rootExternalId} was malformed`); continue; }
          const topicDetail = parsedDetail.data;
          const posts = (topicDetail.post_stream?.posts ?? topicDetail.posts ?? []).map((value) => postSchema.safeParse(value)).filter((result): result is { success: true; data: DiscoursePost } => result.success).map((result) => result.data);
          depthMetrics.postsLoaded += posts.length;
          const firstPost = posts.find((post) => post.post_number === 1) ?? posts[0];
          const eligibility = evaluateDiscourseDepth({
            title: topicDetail.title,
            body: firstPost?.cooked ?? firstPost?.raw ?? topicDetail.excerpt ?? topicDetail.blurb,
            tags: topicDetail.tags,
            category: topicDetail.category_name,
            state: topicDetail.archived ? "archived" : topicDetail.closed ? "closed" : "open",
            authorType: firstPost?.user?.user_type,
            authorUsername: firstPost?.username ?? topicDetail.user?.username,
            postsCount: topicDetail.posts_count ?? posts.length,
          });
          if (!eligibility.eligible || !firstPost) { depthMetrics.dropped += posts.filter((post) => post.id !== firstPost?.id).length; continue; }
          depthMetrics.depthEligible += 1;
          if (depthMetrics.depthExpanded >= maxTopics) { depthMetrics.capSkips += 1; continue; }
          depthMetrics.depthExpanded += 1;
          const selected = selectDiscoursePosts({ posts: posts.map((post) => postToDepthPost(post, topicDetail.accepted_answer_post_id)), acceptedPostId: topicDetail.accepted_answer_post_id, maxPosts });
          const known = knownPostIds(metadata);
          const highestKnown = typeof metadata.knownHighestPostNumber === "number" ? Math.floor(metadata.knownHighestPostNumber) : 0;
          for (const selectedPost of selected) {
            const fullPost = posts.find((post) => post.id === selectedPost.id);
            if (!fullPost) continue;
            if (selectedPost.postNumber !== 1 && (known.has(selectedPost.id) || selectedPost.postNumber <= highestKnown)) { depthMetrics.refreshSkips += 1; continue; }
            append(postItemEnvelope({ instance, topic: topicDetail, post: fullPost, fetchedAt: this.clock().toISOString(), rootExternalId, itemType: selectedPost.postNumber === 1 ? "topic_root" : "reply", acceptedPostId: topicDetail.accepted_answer_post_id, queryPlanVersion: typeof metadata.queryPlanVersion === "string" ? metadata.queryPlanVersion : undefined }));
          }
          depthMetrics.dropped += Math.max(0, posts.length - selected.length);
        }
        state.pages[instance] = page + 1;
        if (!parsedSearch.data.more_topics_url) break;
      }
      instanceIndex += 1;
    }

    const hasNext = instanceIndex < instances.length || Object.values(state.pages).some((page) => page <= maxPages);
    return {
      items,
      ...(hasNext ? { nextCursor: encodeCursor({ instanceIndex, pages: state.pages }) } : {}),
      rateLimit,
      ...(useDepth ? { providerMetrics: { discourseDepthV1: depthMetrics } } : {}),
      diagnostics: { accepted: items.length, rejected: depthMetrics.dropped, messages },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const context = envelope.cursorContext;
    const payload = postSchema.parse(envelope.payload);
    const instance = typeof context.instance === "string" ? context.instance : "";
    const topicId = typeof context.topicId === "number" ? context.topicId : payload.topic_id;
    const topicExternalId = typeof context.topicExternalId === "string" ? context.topicExternalId : `discourse:${instance}:topic:${topicId ?? "unknown"}`;
    const itemType = context.itemType === "reply" ? "reply" : "topic_root";
    const body = cleanDiscourseContent(payload.cooked, payload.raw);
    const username = payload.username ?? payload.user?.username;
    const userIdentity = payload.user_id ?? payload.user?.id ?? username;
    const canonicalUrl = itemType === "topic_root" ? context.topicUrl : context.postUrl;
    return sourceItemCandidateSchema.parse({
      sourceKey: this.key,
      externalId: envelope.externalId,
      externalConversationId: topicExternalId,
      canonicalUrl: typeof canonicalUrl === "string" ? canonicalUrl : undefined,
      authorExternalId: userIdentity !== undefined && userIdentity !== null ? `discourse:${instance}:user:${String(userIdentity)}` : undefined,
      authorDisplayName: payload.name ?? username,
      authorProfileUrl: username ? `${instance}/u/${encodeURIComponent(username)}` : undefined,
      title: typeof context.topicTitle === "string" ? context.topicTitle : undefined,
      body,
      publishedAt: payload.created_at,
      capturedAt: envelope.fetchedAt,
      metadata: {
        sourceCategory: "public_discussion",
        providerType: itemType,
        discourseInstance: instance,
        topicId: topicId ?? null,
        postId: payload.id,
        postNumber: payload.post_number,
        parentPostNumber: context.parentPostNumber ?? payload.reply_to_post_number ?? null,
        topicUrl: context.topicUrl ?? null,
        postUrl: context.postUrl ?? null,
        topicTags: Array.isArray(context.topicTags) ? context.topicTags : [],
        categoryId: context.categoryId ?? null,
        categoryName: context.categoryName ?? null,
        topicState: context.topicState ?? null,
        topicCreatedAt: context.topicCreatedAt ?? null,
        topicUpdatedAt: context.topicUpdatedAt ?? null,
        topicBumpedAt: context.topicBumpedAt ?? null,
        topicLikeCount: context.topicLikeCount ?? null,
        updatedAt: payload.updated_at ?? null,
        acceptedAnswerPostId: context.acceptedPostId ?? null,
        discourseDepthPolicy: DISCOURSE_DEPTH_VERSION,
      },
      status: payload.deleted_at ? "removed" : "active",
    });
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const instances = configuredInstances({}, this.baseUrl);
    if (!instances.length) return { sourceKey: this.key, ok: false, latencyMs: 0, degradationState: "degraded", errorCode: "DISCOURSE_INSTANCE_REQUIRED", errorSummary: "No public Discourse instance is configured." };
    const started = Date.now();
    try {
      const result = await this.providerRequest(pathUrl(instances[0]!, "site.json"));
      return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit: result.rateLimit, degradationState: "healthy" };
    } catch (error) {
      return { sourceKey: this.key, ok: false, latencyMs: Date.now() - started, degradationState: "degraded", errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED", errorSummary: error instanceof Error ? error.message.slice(0, 500) : "Discourse health check failed." };
    }
  }

  private summaryAsPost(topic: TopicSummary): DiscoursePost {
    return {
      id: topic.id,
      post_number: 1,
      username: topic.user?.username,
      name: topic.user?.name,
      user_id: topic.user?.user_id,
      cooked: topic.excerpt ?? topic.blurb ?? topic.title,
      raw: topic.excerpt ?? topic.blurb ?? topic.title,
      created_at: topic.created_at ?? this.clock().toISOString(),
      updated_at: topic.updated_at ?? null,
      like_count: topic.like_count ?? 0,
      topic_id: topic.id,
      topic_slug: topic.slug,
    };
  }

  private async providerRequest(url: string): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    return fetchJson(this.fetchImpl, url, { provider: "discourse", mode: "public", timeoutMs: this.timeoutMs });
  }
}

export const discourseSourceAdapter = new DiscourseSourceAdapter();

export {
  cleanDiscourseContent,
  createDiscourseDepthTelemetry,
  DISCOURSE_DEPTH_VERSION,
  evaluateDiscourseDepth,
  selectDiscoursePosts,
} from "./discourse-depth";
