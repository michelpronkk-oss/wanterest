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
  createStackExchangeDepthTelemetry,
  evaluateStackExchangeDepth,
  STACK_EXCHANGE_DEPTH_MAX_ANSWER_COMMENTS,
  STACK_EXCHANGE_DEPTH_MAX_ANSWERS_PER_QUESTION,
  STACK_EXCHANGE_DEPTH_MAX_COMMENT_PAGES,
  STACK_EXCHANGE_DEPTH_MAX_QUESTION_COMMENTS,
  STACK_EXCHANGE_DEPTH_MAX_REQUESTS,
  STACK_EXCHANGE_DEPTH_MAX_ROOTS_PER_PAGE,
  STACK_EXCHANGE_DEPTH_VERSION,
  selectStackExchangeAnswers,
  selectStackExchangeComments,
  type StackExchangeAnswer,
  type StackExchangeComment,
} from "./stack-exchange-depth";
import { stableDepthIdentity } from "../depth";

const ownerSchema = z.object({
  user_id: z.number().int().optional(),
  display_name: z.string().optional(),
  link: z.string().url().optional(),
  location: z.string().max(500).nullable().optional(),
  user_type: z.string().optional(),
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
  comment_count: z.number().int().nonnegative().optional(),
  accepted_answer_id: z.number().int().positive().optional(),
  is_answered: z.boolean().optional(),
  view_count: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()).optional(),
  closed_date: z.number().int().positive().optional(),
  closed_reason: z.string().optional(),
  locked_date: z.number().int().positive().optional(),
  owner: ownerSchema.optional(),
}).passthrough();

const answerSchema = z.object({
  answer_id: z.number().int().positive(),
  question_id: z.number().int().positive(),
  body: z.string().optional(),
  link: z.string().url().optional(),
  creation_date: z.number().int().positive(),
  last_activity_date: z.number().int().positive().optional(),
  last_edit_date: z.number().int().positive().optional(),
  score: z.number().int().optional(),
  is_accepted: z.boolean().optional(),
  owner: ownerSchema.optional(),
}).passthrough();

const commentSchema = z.object({
  comment_id: z.number().int().positive(),
  post_id: z.number().int().positive(),
  post_type: z.enum(["question", "answer", "article"]).optional(),
  body: z.string().optional(),
  link: z.string().url().optional(),
  creation_date: z.number().int().positive(),
  score: z.number().int().optional(),
  owner: ownerSchema.optional(),
}).passthrough();

const apiResponseSchema = z.object({
  items: z.array(z.unknown()),
  has_more: z.boolean().optional(),
  quota_max: z.number().int().nonnegative().optional(),
  quota_remaining: z.number().int().nonnegative().optional(),
  backoff: z.number().nonnegative().optional(),
}).passthrough();

type StackExchangeQuestion = z.infer<typeof questionSchema>;
type StackExchangeApiResponse = z.infer<typeof apiResponseSchema>;

export const stackExchangeFeatureRecencyWindowMonths = 24 as const;

export type StackExchangeFeatureRecencyV1 = {
  windowMonths: typeof stackExchangeFeatureRecencyWindowMonths;
  fromDateIso: string;
  fromDateUnix: number;
  applied: true;
};

function isFeatureDemandRequest(request: SourceDiscoveryRequest): boolean {
  const metadata = request.requestMetadata as Record<string, unknown>;
  return metadata.queryFamily === "feature_requirement" && metadata.demandSurface === "feature_demand";
}

function recencyFromMetadata(value: unknown): StackExchangeFeatureRecencyV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  if (metadata.windowMonths !== stackExchangeFeatureRecencyWindowMonths || metadata.applied !== true) return null;
  if (typeof metadata.fromDateIso !== "string" || typeof metadata.fromDateUnix !== "number" || !Number.isInteger(metadata.fromDateUnix) || metadata.fromDateUnix < 0) return null;
  const parsed = new Date(metadata.fromDateIso);
  if (Number.isNaN(parsed.getTime()) || Math.floor(parsed.getTime() / 1000) !== metadata.fromDateUnix) return null;
  return { windowMonths: stackExchangeFeatureRecencyWindowMonths, fromDateIso: parsed.toISOString(), fromDateUnix: metadata.fromDateUnix, applied: true };
}

/** Derives a calendar-month boundary without allowing month-end overflow. */
export function deriveStackExchangeFeatureRecency(now = new Date()): StackExchangeFeatureRecencyV1 {
  if (Number.isNaN(now.getTime())) throw new SourceAdapterError("STACK_EXCHANGE_RECENCY_DERIVATION_FAILED", "Stack Exchange feature recency boundary could not be derived.");
  const monthIndex = now.getUTCMonth() - stackExchangeFeatureRecencyWindowMonths;
  const targetYear = now.getUTCFullYear() + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const fromDate = new Date(Date.UTC(targetYear, targetMonth, Math.min(now.getUTCDate(), lastTargetDay), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
  if (Number.isNaN(fromDate.getTime())) throw new SourceAdapterError("STACK_EXCHANGE_RECENCY_DERIVATION_FAILED", "Stack Exchange feature recency boundary could not be derived.");
  return { windowMonths: stackExchangeFeatureRecencyWindowMonths, fromDateIso: fromDate.toISOString(), fromDateUnix: Math.floor(fromDate.getTime() / 1000), applied: true };
}

/** Applies the execution-time boundary once so pagination reuses one timestamp. */
export function prepareStackExchangeFeatureRequest(request: SourceDiscoveryRequest, now = new Date()): SourceDiscoveryRequest {
  const parsed = sourceDiscoveryRequestSchema.parse(request);
  if (!isFeatureDemandRequest(parsed)) return parsed;
  const metadata = parsed.requestMetadata as Record<string, unknown>;
  const existing = recencyFromMetadata(metadata.stackExchangeFeatureRecencyV1);
  if (existing) return parsed;
  return sourceDiscoveryRequestSchema.parse({ ...parsed, requestMetadata: { ...metadata, stackExchangeFeatureRecencyV1: deriveStackExchangeFeatureRecency(now) } });
}

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

function depthEnabled(metadata: Record<string, unknown>): boolean {
  return metadata.depthPolicyVersion === STACK_EXCHANGE_DEPTH_VERSION || metadata.stackExchangeV2 === true || metadata.queryPlanVersion === "query_planning_v8";
}

function metadataNumber(metadata: Record<string, unknown>, key: string, fallback: number, max: number): number {
  return typeof metadata[key] === "number" && Number.isFinite(metadata[key]) ? Math.max(0, Math.min(max, Math.floor(metadata[key] as number))) : fallback;
}

function rateLimitFrom(response: { rateLimit: RateLimitMetadata }, parsed: StackExchangeApiResponse): RateLimitMetadata {
  return { ...response.rateLimit, provider: "stack-exchange-api", remaining: parsed.quota_remaining ?? null, limit: parsed.quota_max ?? null, retryAfterMs: parsed.backoff ? Math.round(parsed.backoff * 1000) : response.rateLimit.retryAfterMs };
}

export type StackExchangeSourceAdapterOptions = { apiKey?: string; baseUrl?: string; fetchImpl?: SourceFetch; timeoutMs?: number; clock?: () => Date };

export class StackExchangeSourceAdapter implements SourceAdapter {
  readonly key = "stack-exchange";
  readonly capabilities = { supportsSearch: true, supportsIncrementalCursor: true, supportsThreadExpansion: true } as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: SourceFetch;
  private readonly timeoutMs: number;
  private readonly clock: () => Date;

  constructor(options: StackExchangeSourceAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.STACK_EXCHANGE_API_KEY?.trim() ?? "";
    this.baseUrl = (options.baseUrl ?? "https://api.stackexchange.com/2.3").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.clock = options.clock ?? (() => new Date());
  }

  async discover(input: SourceDiscoveryRequest): Promise<SourceDiscoveryPage> {
    const request = prepareStackExchangeFeatureRequest(input, this.clock());
    const metadata = request.requestMetadata as Record<string, unknown>;
    const sites = sitesFrom(request);
    const pages = decodeCursor(request.cursor, sites);
    const perSite = Math.max(1, Math.min(100, Math.ceil(request.limit / sites.length)));
    const useDepth = depthEnabled(metadata);
    const depthMetrics = createStackExchangeDepthTelemetry();
    const items: RawSourceItemEnvelope[] = [];
    const seen = new Set<string>();
    const roots: Array<{ question: StackExchangeQuestion; site: string; envelope: RawSourceItemEnvelope }> = [];
    const messages: string[] = [];
    let hasMore = false;
    let accepted = 0;
    let rejected = 0;
    let rateLimit: RateLimitMetadata | undefined;
    const nextPages = { ...pages };
    const append = (item: RawSourceItemEnvelope, kind: "root" | "answer" | "comment"): boolean => {
      if (seen.has(item.externalId)) { if (useDepth && kind !== "root") depthMetrics.deduplicated += 1; return false; }
      seen.add(item.externalId);
      items.push(item);
      if (useDepth && kind === "answer") depthMetrics.answersPersisted += 1;
      if (useDepth && kind === "comment") depthMetrics.commentsPersisted += 1;
      return true;
    };

    for (const site of sites) {
      const params = new URLSearchParams({ site, pagesize: String(perSite), page: String(pages[site] ?? 1), order: "desc", sort: request.query ? "relevance" : "activity", filter: "withbody" });
      if (request.query) params.set("q", request.query.slice(0, 180));
      if (request.windowStart) params.set("fromdate", String(Math.floor(Date.parse(request.windowStart) / 1000)));
      if (request.windowEnd) params.set("todate", String(Math.floor(Date.parse(request.windowEnd) / 1000)));
      const featureRecency = recencyFromMetadata(metadata.stackExchangeFeatureRecencyV1);
      if (featureRecency) params.set("fromdate", String(featureRecency.fromDateUnix));
      const response = await this.providerRequest(`/search/advanced?${params.toString()}`);
      const parsed = responseSchemaFrom(response.body);
      rateLimit = rateLimitFrom(response, parsed);
      hasMore ||= Boolean(parsed.has_more);
      nextPages[site] = (pages[site] ?? 1) + 1;
      for (const value of parsed.items) {
        const question = questionSchema.safeParse(value);
        if (!question.success) { rejected += 1; continue; }
        if (request.windowStart && question.data.creation_date * 1000 < Date.parse(request.windowStart)) { rejected += 1; continue; }
        if (request.windowEnd && question.data.creation_date * 1000 > Date.parse(request.windowEnd)) { rejected += 1; continue; }
        if (roots.length >= request.limit) break;
        const envelope = this.rootEnvelope(question.data, site, rateLimit);
        append(envelope, "root");
        roots.push({ question: question.data, site, envelope });
        accepted += 1;
      }
      if (roots.length >= request.limit) break;
    }

    if (useDepth) await this.expandDepth({ request, metadata, roots, append, seen, messages, depthMetrics, rateLimit: () => rateLimit, setRateLimit: (next) => { rateLimit = next; } });
    const featureRecency = recencyFromMetadata(metadata.stackExchangeFeatureRecencyV1);
    return {
      items,
      ...(hasMore ? { nextCursor: encodeCursor(nextPages) } : {}),
      rateLimit,
      ...(featureRecency || useDepth ? { providerMetrics: { ...(featureRecency ? { stackExchangeFeatureRecencyV1: featureRecency } : {}), ...(useDepth ? { stackExchangeDepthV1: depthMetrics } : {}) } } : {}),
      diagnostics: { accepted, rejected, messages: [`Searched ${sites.join(", ")} with Stack Exchange advanced search; canonical question threads preserve answer and comment provenance.`, ...messages] },
    };
  }

  normalize(raw: RawSourceItemEnvelope): SourceItemCandidate {
    const envelope = rawSourceItemEnvelopeSchema.parse(raw);
    const context = envelope.cursorContext;
    const site = typeof context.site === "string" ? context.site : "stackoverflow";
    const itemType = typeof context.itemType === "string" ? context.itemType : "question";
    if (itemType === "answer") {
      const answer = answerSchema.parse(envelope.payload);
      const rootExternalId = typeof context.rootExternalId === "string" ? context.rootExternalId : `${site}:${answer.question_id}`;
      return sourceItemCandidateSchema.parse({ sourceKey: this.key, externalId: `${site}:answer:${answer.answer_id}`, externalConversationId: rootExternalId, canonicalUrl: answer.link, authorExternalId: answer.owner?.user_id ? String(answer.owner.user_id) : undefined, authorDisplayName: answer.owner?.display_name, authorProfileUrl: answer.owner?.link, body: cleanHtml(answer.body ?? ""), publishedAt: new Date(answer.creation_date * 1000).toISOString(), capturedAt: envelope.fetchedAt, metadata: { sourceCategory: "developer_discussion", providerType: "answer", site, parentQuestionId: `${site}:${answer.question_id}`, accepted: answer.is_accepted ?? false, score: answer.score ?? null, lastActivityAt: answer.last_activity_date ? new Date(answer.last_activity_date * 1000).toISOString() : null }, status: "active" });
    }
    if (itemType === "question_comment" || itemType === "answer_comment") {
      const comment = commentSchema.parse(envelope.payload);
      const rootExternalId = typeof context.rootExternalId === "string" ? context.rootExternalId : `${site}:${comment.post_id}`;
      return sourceItemCandidateSchema.parse({ sourceKey: this.key, externalId: `${site}:${itemType === "question_comment" ? "question-comment" : "answer-comment"}:${comment.comment_id}`, externalConversationId: rootExternalId, canonicalUrl: comment.link, authorExternalId: comment.owner?.user_id ? String(comment.owner.user_id) : undefined, authorDisplayName: comment.owner?.display_name, authorProfileUrl: comment.owner?.link, body: cleanHtml(comment.body ?? ""), publishedAt: new Date(comment.creation_date * 1000).toISOString(), capturedAt: envelope.fetchedAt, metadata: { sourceCategory: "developer_discussion", providerType: "comment", messageType: itemType === "question_comment" ? "question_comment" : "answer_comment", site, parentQuestionId: rootExternalId, ...(typeof context.parentAnswerId === "string" ? { parentAnswerId: context.parentAnswerId } : {}), score: comment.score ?? null }, status: "active" });
    }
    const question = questionSchema.parse(envelope.payload);
    const externalId = `${site}:${question.question_id}`;
    return sourceItemCandidateSchema.parse({ sourceKey: this.key, externalId, externalConversationId: externalId, canonicalUrl: question.link, authorExternalId: question.owner?.user_id ? String(question.owner.user_id) : undefined, authorDisplayName: question.owner?.display_name, authorProfileUrl: question.owner?.link, title: question.title, body: cleanHtml(question.body ?? question.title), publishedAt: new Date(question.creation_date * 1000).toISOString(), capturedAt: envelope.fetchedAt, metadata: { sourceCategory: "developer_discussion", providerType: "question", site, tags: question.tags ?? [], score: question.score ?? null, answerCount: question.answer_count ?? 0, commentCount: question.comment_count ?? 0, acceptedAnswerId: question.accepted_answer_id ?? null, isAnswered: question.is_answered ?? false, viewCount: question.view_count ?? null, authorLocation: question.owner?.location ?? null, lastActivityAt: question.last_activity_date ? new Date(question.last_activity_date * 1000).toISOString() : null, lastEditAt: question.last_edit_date ? new Date(question.last_edit_date * 1000).toISOString() : null, stackExchangeDepthPolicy: STACK_EXCHANGE_DEPTH_VERSION }, status: "active" });
  }

  async healthCheck(): Promise<SourceHealthResult> {
    const started = Date.now();
    try { const response = await this.providerRequest("/info?site=stackoverflow&pagesize=1"); return { sourceKey: this.key, ok: true, latencyMs: Date.now() - started, rateLimit: response.rateLimit, degradationState: "healthy" }; }
    catch (error) { return { sourceKey: this.key, ok: false, latencyMs: Date.now() - started, degradationState: "degraded", errorCode: error instanceof SourceAdapterError ? error.code : "HEALTH_CHECK_FAILED", errorSummary: error instanceof Error ? error.message.slice(0, 500) : "Stack Exchange health check failed." }; }
  }

  private async providerRequest(path: string): Promise<{ body: unknown; rateLimit: RateLimitMetadata }> {
    return fetchJson(this.fetchImpl, `${this.baseUrl}${path}${this.apiKey ? `${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.apiKey)}` : ""}`, { provider: "stack-exchange-api", timeoutMs: this.timeoutMs });
  }

  private rootEnvelope(question: StackExchangeQuestion, site: string, rateLimit?: RateLimitMetadata): RawSourceItemEnvelope {
    return { sourceKey: this.key, externalId: `${site}:${question.question_id}`, fetchedAt: this.clock().toISOString(), payload: question, requestMetadata: { provider: "stack-exchange-api", endpoint: "/search/advanced", site }, cursorContext: { site, itemType: "question", rootExternalId: `${site}:${question.question_id}`, rateLimit: rateLimit ?? null } };
  }

  private async expandDepth(input: { request: SourceDiscoveryRequest; metadata: Record<string, unknown>; roots: Array<{ question: StackExchangeQuestion; site: string; envelope: RawSourceItemEnvelope }>; append: (item: RawSourceItemEnvelope, kind: "root" | "answer" | "comment") => boolean; seen: Set<string>; messages: string[]; depthMetrics: ReturnType<typeof createStackExchangeDepthTelemetry>; rateLimit: () => RateLimitMetadata | undefined; setRateLimit: (value: RateLimitMetadata) => void }): Promise<void> {
    const maxRoots = Math.min(STACK_EXCHANGE_DEPTH_MAX_ROOTS_PER_PAGE, metadataNumber(input.metadata, "maxDepthRootsPerPage", STACK_EXCHANGE_DEPTH_MAX_ROOTS_PER_PAGE, STACK_EXCHANGE_DEPTH_MAX_ROOTS_PER_PAGE));
    const maxAnswers = Math.min(STACK_EXCHANGE_DEPTH_MAX_ANSWERS_PER_QUESTION, metadataNumber(input.metadata, "maxAnswersPerQuestion", STACK_EXCHANGE_DEPTH_MAX_ANSWERS_PER_QUESTION, STACK_EXCHANGE_DEPTH_MAX_ANSWERS_PER_QUESTION));
    const maxQuestionComments = Math.min(STACK_EXCHANGE_DEPTH_MAX_QUESTION_COMMENTS, metadataNumber(input.metadata, "maxQuestionComments", STACK_EXCHANGE_DEPTH_MAX_QUESTION_COMMENTS, STACK_EXCHANGE_DEPTH_MAX_QUESTION_COMMENTS));
    const maxAnswerComments = Math.min(STACK_EXCHANGE_DEPTH_MAX_ANSWER_COMMENTS, metadataNumber(input.metadata, "maxAnswerComments", STACK_EXCHANGE_DEPTH_MAX_ANSWER_COMMENTS, STACK_EXCHANGE_DEPTH_MAX_ANSWER_COMMENTS));
    const maxRequests = Math.min(STACK_EXCHANGE_DEPTH_MAX_REQUESTS, metadataNumber(input.metadata, "maxDepthRequests", STACK_EXCHANGE_DEPTH_MAX_REQUESTS, STACK_EXCHANGE_DEPTH_MAX_REQUESTS));
    const refreshStartValue = typeof input.metadata.refreshWindowStart === "string" ? input.metadata.refreshWindowStart : input.request.windowStart;
    const refreshStart = refreshStartValue ? Date.parse(refreshStartValue) : undefined;
    const eligible = input.roots.filter(({ question }) => {
      input.depthMetrics.searchRoots += 1;
      if (refreshStart && (question.last_activity_date ?? question.creation_date) * 1000 < refreshStart) { input.depthMetrics.refreshSkips += 1; return false; }
      const result = evaluateStackExchangeDepth({ title: question.title, body: question.body, answerCount: question.answer_count ?? 0, commentCount: question.comment_count ?? 0, ownerType: question.owner?.user_type, tags: question.tags, closedReason: question.closed_reason, deleted: false });
      if (!result.eligible) { input.depthMetrics.dropped += 1; return false; }
      input.depthMetrics.depthEligible += 1;
      return true;
    }).slice(0, maxRoots);
    input.depthMetrics.quotaSkips += Math.max(0, input.roots.length - eligible.length - input.depthMetrics.refreshSkips);
    for (const root of eligible) {
      if (input.depthMetrics.depthRequests >= maxRequests) { input.depthMetrics.quotaSkips += 1; break; }
      input.depthMetrics.depthExpanded += 1;
      const answers = await this.depthRequest<StackExchangeAnswer>(`/questions/${root.question.question_id}/answers`, root.site, "votes", maxAnswers * 4, 1, maxRequests, input.depthMetrics, input.setRateLimit, input.messages);
      const selectedAnswers = selectStackExchangeAnswers({ answers, acceptedAnswerId: root.question.accepted_answer_id, maxAnswers });
      for (const answer of selectedAnswers) input.append(this.depthEnvelope(answer, root, "answer"), "answer");
      if (input.depthMetrics.depthRequests >= maxRequests) break;
      const questionComments = await this.depthRequest<StackExchangeComment>(`/questions/${root.question.question_id}/comments`, root.site, "votes", maxQuestionComments * 4, STACK_EXCHANGE_DEPTH_MAX_COMMENT_PAGES, maxRequests, input.depthMetrics, input.setRateLimit, input.messages);
      for (const comment of selectStackExchangeComments({ comments: questionComments, maxComments: maxQuestionComments })) input.append(this.depthEnvelope(comment, root, "question_comment"), "comment");
      const answerIds = selectedAnswers.map((answer) => answer.answer_id).join(";");
      if (answerIds && input.depthMetrics.depthRequests < maxRequests) {
        const answerComments = await this.depthRequest<StackExchangeComment>(`/answers/${answerIds}/comments`, root.site, "votes", maxAnswerComments * 4, STACK_EXCHANGE_DEPTH_MAX_COMMENT_PAGES, maxRequests, input.depthMetrics, input.setRateLimit, input.messages);
        for (const comment of selectStackExchangeComments({ comments: answerComments, maxComments: maxAnswerComments })) input.append(this.depthEnvelope(comment, root, "answer_comment", selectedAnswers.find((answer) => answer.answer_id === comment.post_id)), "comment");
      }
    }
  }

  private async depthRequest<T>(path: string, site: string, sort: string, pageSize: number, maxPages: number, maxRequests: number, metrics: ReturnType<typeof createStackExchangeDepthTelemetry>, setRateLimit: (value: RateLimitMetadata) => void, messages: string[]): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= maxPages && metrics.depthRequests < maxRequests; page += 1) {
      const params = new URLSearchParams({ site, pagesize: String(Math.max(1, Math.min(100, pageSize))), page: String(page), sort, order: "desc", filter: "withbody" });
      try {
        metrics.depthRequests += 1;
        const response = await this.providerRequest(`${path}?${params.toString()}`);
        const parsed = responseSchemaFrom(response.body);
        setRateLimit(rateLimitFrom(response, parsed));
        const pageValues = parsed.items.filter((value): value is T => value !== null && typeof value === "object") as T[];
        values.push(...pageValues);
        if (path.includes("comments")) metrics.commentsLoaded += pageValues.length;
        else metrics.answersLoaded += pageValues.length;
        if (!parsed.has_more) break;
      } catch (error) { messages.push(`${path} depth unavailable: ${error instanceof Error ? error.message.slice(0, 200) : "provider error"}`); break; }
    }
    return values;
  }

  private depthEnvelope(value: StackExchangeAnswer | StackExchangeComment, root: { question: StackExchangeQuestion; site: string }, itemType: "answer" | "question_comment" | "answer_comment", parentAnswer?: StackExchangeAnswer): RawSourceItemEnvelope {
    const isAnswer = itemType === "answer";
    const id = isAnswer ? (value as StackExchangeAnswer).answer_id : (value as StackExchangeComment).comment_id;
    const kind = isAnswer ? "answer" : itemType === "question_comment" ? "question-comment" : "answer-comment";
    return { sourceKey: this.key, externalId: stableDepthIdentity(this.key, kind, id), fetchedAt: this.clock().toISOString(), payload: value, requestMetadata: { provider: "stack-exchange-api", endpoint: isAnswer ? "/questions/{ids}/answers" : itemType === "question_comment" ? "/questions/{ids}/comments" : "/answers/{ids}/comments", site: root.site }, cursorContext: { site: root.site, itemType, rootExternalId: `${root.site}:${root.question.question_id}`, ...(parentAnswer ? { parentAnswerId: `${root.site}:answer:${parentAnswer.answer_id}` } : {}) } };
  }
}

function responseSchemaFrom(body: unknown): StackExchangeApiResponse {
  const parsed = apiResponseSchema.safeParse(body);
  if (!parsed.success) throw new SourceAdapterError("MALFORMED_PROVIDER_PAYLOAD", "Stack Exchange response failed validation.");
  return parsed.data;
}

export { STACK_EXCHANGE_DEPTH_VERSION } from "./stack-exchange-depth";
export { evaluateStackExchangeDepth, selectStackExchangeAnswers, selectStackExchangeComments } from "./stack-exchange-depth";
export const stackExchangeSourceAdapter = new StackExchangeSourceAdapter();
