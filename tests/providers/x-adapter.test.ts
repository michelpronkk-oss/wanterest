import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  xAuthError,
  xCreditError,
  xEditedPost,
  xForbiddenError,
  xInvalidQueryError,
  xMalformedPost,
  xMultilingualPost,
  xPageOne,
  xPageTwo,
  xPostLookupResponse,
  xQuotePost,
  xRateLimitError,
  xReplyPost,
  xServerError,
  xStandalonePost,
  xUserAlice,
} from "../../src/server/providers/source/x/fixtures";
import { estimateXReadCost } from "../../src/server/providers/source/x/x.cost";
import { getInternalXDiscoveryOverride } from "../../src/server/providers/source/x/x.internal";
import { XSourceAdapter } from "../../src/server/providers/source/x";
import { compileXQuery, X_COMPETITOR_PAIN_DISPLACEMENT_ANCHORS, X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION, X_PAIN_REQUEST_ANCHORS, X_PAIN_RETRIEVAL_TEMPLATE_VERSION } from "../../src/server/providers/source/x/x.query";
import { SIGNAL_QUALIFICATION_THRESHOLD_VERSION, SIGNAL_QUALIFICATION_VERSION } from "../../src/server/modules/intelligence/signal-qualification.config";
import { SEMANTIC_REASONING_ROUTER_VERSION } from "../../src/server/modules/intelligence/semantic-reasoning-router";

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function envelope(payload: unknown, externalId = "test") {
  return {
    sourceKey: "x",
    externalId,
    fetchedAt: "2026-09-20T10:00:00.000Z",
    payload,
    requestMetadata: {},
    cursorContext: {},
  };
}

describe("X source adapter", () => {
  const internalWorkspaceId = "8b7a4189-54b7-4cc0-a4a3-1502dc2be82a";
  const normalWorkspaceId = "00000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("INTERNAL_X_DISCOVERY_WORKSPACE_IDS", "");
    vi.stubEnv("INTERNAL_X_MAX_POSTS_PER_SCAN", "10");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the normal below-minimum X skip for a workspace outside the allowlist", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new XSourceAdapter({ fetchImpl, token: "test-token" });

    const page = await adapter.discover({
      query: "workflow",
      limit: 3,
      requestMetadata: { maxResults: 3, maxBillablePostsPerDiscovery: 3, internalWorkspaceId: normalWorkspaceId },
      expandThreads: false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(page.diagnostics.messages.join(" ")).toContain("billable post budget is below the provider minimum");
  });

  it("executes the provider-minimum page for an allowlisted internal workspace", async () => {
    vi.stubEnv("INTERNAL_X_DISCOVERY_WORKSPACE_IDS", internalWorkspaceId);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [], meta: { result_count: 0 } }));
    const adapter = new XSourceAdapter({ fetchImpl, token: "test-token" });

    const page = await adapter.discover({
      query: "workflow",
      limit: 3,
      requestMetadata: { maxResults: 3, maxBillablePostsPerDiscovery: 3, internalWorkspaceId },
      expandThreads: false,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get("max_results")).toBe("10");
    expect(page.estimatedCost).toBe(0.05);
  });

  it("hard-caps the internal override at one provider-minimum page and bounds its cost", () => {
    vi.stubEnv("INTERNAL_X_DISCOVERY_WORKSPACE_IDS", internalWorkspaceId);
    vi.stubEnv("INTERNAL_X_MAX_POSTS_PER_SCAN", "100");

    const override = getInternalXDiscoveryOverride(internalWorkspaceId);

    expect(override?.maxPostsPerScan).toBe(10);
    expect(estimateXReadCost(2 * (override?.maxPostsPerScan ?? 0))).toBe(0.1);
  });

  it("does not override an allowlisted workspace when the max-posts env is missing", async () => {
    vi.stubEnv("INTERNAL_X_DISCOVERY_WORKSPACE_IDS", internalWorkspaceId);
    vi.stubEnv("INTERNAL_X_MAX_POSTS_PER_SCAN", undefined);
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new XSourceAdapter({ fetchImpl, token: "test-token" });

    await adapter.discover({
      query: "workflow",
      limit: 3,
      requestMetadata: { maxResults: 3, maxBillablePostsPerDiscovery: 3, internalWorkspaceId },
      expandThreads: false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("compiles synthetic planner language into a human provider query", () => {
    const compiled = compileXQuery({
      semanticQuery: "switching from productivity_software because Need for better collaboration and workflow tools",
      family: "switching",
      context: { product_name: "Linear", competitors: ["Jira"], category: "project management software" },
    });
    expect(compiled.query).toBe("switching from Jira");
    expect(compiled.usedFallback).toBe(true);
    expect(compiled.query).not.toMatch(/productivity_software|because|workflow tools/);
  });

  it("adds bounded quoted request anchors only to X pain_first compilation", () => {
    const compiled = compileXQuery({
      semanticQuery: "project management software Inefficient software development workflows",
      family: "pain",
      demandSurface: "pain_first",
      context: { category: "project management software", pains: ["Inefficient software development workflows"], product_name: "Linear", competitors: ["Jira"] },
    });

    expect(compiled.query).toBe('("I need" OR "we need" OR "looking for" OR "anyone recommend" OR "our team") project management software Inefficient software development workflows');
    expect(compiled).toMatchObject({ templateVersion: X_PAIN_RETRIEVAL_TEMPLATE_VERSION, requestAnchors: [...X_PAIN_REQUEST_ANCHORS] });
    expect(compiled.query).not.toContain("Linear");
    expect(compiled.query).not.toContain("Jira");
    expect(compiled.query).not.toContain("BAICLAW");
  });

  it("keeps positive request holdouts representable without changing category or pain context", () => {
    const holdouts = [
      "We need a better project management tool for our engineering team",
      "I'm looking for project management software that is less complex",
      "Our team is struggling with issue tracking and we need something simpler",
      "Anyone recommend a project management alternative for a small dev team?",
      "Looking for an issue tracking tool with better workflows",
    ];
    const compiled = compileXQuery({
      semanticQuery: holdouts[0]!,
      family: "pain",
      demandSurface: "pain_first",
      context: { category: "project management software", pains: ["Inefficient software development workflows"] },
    });

    expect(compiled.query).toContain('"we need"');
    expect(compiled.query).toContain('"looking for"');
    expect(compiled.query).toContain('"anyone recommend"');
    expect(compiled.query).toContain("project management software");
    expect(compiled.query).toContain("Inefficient software development workflows");
    expect(compiled.query).not.toMatch(/BAICLAW|productivity tools|changing fast/i);
    for (const holdout of holdouts) {
      expect(compileXQuery({ semanticQuery: holdout, family: "pain", demandSurface: "pain_first", context: { category: "project management software", pains: ["Inefficient software development workflows"] } }).query).toContain('("I need" OR "we need" OR "looking for" OR "anyone recommend" OR "our team")');
    }
  });

  it("fails a pain_first compilation without falling back to a broad query", () => {
    expect(() => compileXQuery({ semanticQuery: "project management pain", family: "pain", demandSurface: "pain_first", context: {} })).toThrow("category/pain context is unavailable");
  });

  it("fails an invalid compiled request before any provider call", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new XSourceAdapter({ fetchImpl, token: "test-token" }).discover({ limit: 5, requestMetadata: { xQueryCompilationError: "category/pain context is unavailable" }, expandThreads: false })).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("compiles competitor_pain to bounded displacement intent without requiring Linear", () => {
    const compiled = compileXQuery({ semanticQuery: "Jira vs Linear", family: "comparison", demandSurface: "competitor_pain", context: { product_name: "Linear", competitors: ["Jira"], category: "project management software" } });
    expect(compiled.query).toBe('("switching from" OR "moving away from" OR "replace" OR "replacing" OR "alternative to" OR "leaving") Jira');
    expect(compiled).toMatchObject({ templateVersion: X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION, competitor: "Jira", displacementAnchors: [...X_COMPETITOR_PAIN_DISPLACEMENT_ANCHORS] });
    expect(compiled.query).not.toContain("Linear");
    expect(compiled.query).not.toContain(" vs ");
  });

  it("keeps displacement holdouts representable without requiring a scanned product literal", () => {
    const holdouts = [
      "We're switching from Jira",
      "Looking for an alternative to Jira",
      "Our team is moving away from Jira",
      "We need to replace Jira",
      "Replacing Jira because the workflow is too complex",
      "Any good alternative to Jira for engineering teams?",
    ];
    for (const holdout of holdouts) {
      const compiled = compileXQuery({ semanticQuery: holdout, family: "comparison", demandSurface: "competitor_pain", context: { competitors: ["Jira"] } });
      expect(compiled.query).toContain('("switching from" OR "moving away from" OR "replace" OR "replacing" OR "alternative to" OR "leaving")');
      expect(compiled.query).toContain("Jira");
      expect(compiled.query).not.toContain("Linear");
      expect(compiled.query).not.toContain(" vs ");
    }
  });

  it("does not accept a bare comparison as competitor_pain intent", () => {
    const compiled = compileXQuery({ semanticQuery: "Jira vs Linear", family: "comparison", demandSurface: "competitor_pain", context: { competitors: ["Jira"] } });
    expect(compiled.query).not.toContain(" vs ");
    expect(compiled.query).toContain('"alternative to"');
  });

  it("sends one displacement-constrained competitor_pain request with unchanged caps and diagnostics", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [], meta: { result_count: 0 } }));
    const compiled = compileXQuery({ semanticQuery: "Jira vs Linear", family: "comparison", demandSurface: "competitor_pain", context: { product_name: "Linear", competitors: ["Jira"] } });
    const page = await new XSourceAdapter({ fetchImpl, token: "test-token" }).discover({
      query: compiled.query,
      limit: 5,
      requestMetadata: { queryFamily: "comparison", demandSurface: "competitor_pain", xCompetitorPainCompetitor: compiled.competitor!, xCompetitorPainDisplacementAnchors: compiled.displacementAnchors!, providerQuery: compiled.query, maxResults: 5, maxPages: 1, maxBillablePostsPerDiscovery: 10, excludeRetweets: true },
      expandThreads: false,
    });

    const requested = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requested.searchParams.get("query")).toBe(`${compiled.query} -is:retweet`);
    expect(requested.searchParams.get("max_results")).toBe("10");
    expect(page.estimatedCost).toBe(0.05);
    expect(page.providerMetrics).toEqual({
      xCompetitorPainRetrievalV1: {
        templateVersion: X_COMPETITOR_PAIN_RETRIEVAL_TEMPLATE_VERSION,
        providerQuery: `${compiled.query} -is:retweet`,
        competitor: "Jira",
        displacementAnchors: [...X_COMPETITOR_PAIN_DISPLACEMENT_ANCHORS],
        requestCount: 1,
        maxBillablePosts: 10,
        estimatedCostUsd: 0.05,
      },
    });
  });

  it("fails competitor_pain compilation without a competitor before provider execution", async () => {
    expect(() => compileXQuery({ semanticQuery: "Jira vs Linear", family: "comparison", demandSurface: "competitor_pain", context: {} })).toThrow("competitor context is unavailable");
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new XSourceAdapter({ fetchImpl, token: "test-token" }).discover({ limit: 5, requestMetadata: { xQueryCompilationError: "competitor context is unavailable" }, expandThreads: false })).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps qualification and semantic reasoning versions outside X retrieval compilation", () => {
    expect(SIGNAL_QUALIFICATION_VERSION).toBe("signal_qualification_v1_7");
    expect(SIGNAL_QUALIFICATION_THRESHOLD_VERSION).toBe("signal_qualification_thresholds_v1");
    expect(SEMANTIC_REASONING_ROUTER_VERSION).toBe("semantic_reasoning_router_v2");
  });

  it("sends one anchored pain_first request with unchanged X caps and bounded diagnostics", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [], meta: { result_count: 0 } }));
    const compiled = compileXQuery({
      semanticQuery: "project management software Inefficient software development workflows",
      family: "pain",
      demandSurface: "pain_first",
      context: { category: "project management software", pains: ["Inefficient software development workflows"] },
    });
    const page = await new XSourceAdapter({ fetchImpl, token: "test-token" }).discover({
      query: compiled.query,
      limit: 5,
      requestMetadata: { queryFamily: "pain", demandSurface: "pain_first", providerQuery: compiled.query, maxResults: 5, maxPages: 1, maxBillablePostsPerDiscovery: 10, excludeRetweets: true },
      expandThreads: false,
    });

    const requested = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requested.searchParams.get("query")).toBe(`${compiled.query} -is:retweet`);
    expect(requested.searchParams.get("max_results")).toBe("10");
    expect(page.estimatedCost).toBe(0.05);
    expect(page.providerMetrics).toEqual({
      xPainRetrievalV1: {
        templateVersion: X_PAIN_RETRIEVAL_TEMPLATE_VERSION,
        providerQuery: `${compiled.query} -is:retweet`,
        requestAnchors: [...X_PAIN_REQUEST_ANCHORS],
        requestCount: 1,
        maxBillablePosts: 10,
        estimatedCostUsd: 0.05,
      },
    });
  });

  it("rejects taxonomy leakage before making a provider request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new XSourceAdapter({ fetchImpl, token: "test-token", backoffMs: 0 });
    await expect(adapter.discover({ query: "switching from productivity_software", limit: 10, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the official v2 recent search endpoint, caller query, bounded page size, and no initial cursor", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [], meta: { result_count: 0 } }, 200, {
      "x-rate-limit-remaining": "99",
      "x-rate-limit-limit": "100",
      "x-rate-limit-reset": "1790000000",
    }));
    const adapter = new XSourceAdapter({ fetchImpl, token: "test-token", clock: () => new Date("2026-09-20T10:00:00.000Z") });

    await adapter.discover({ query: "workflow", limit: 10, requestMetadata: { lang: "en", hasLinks: true }, expandThreads: false });

    const requested = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requested.origin).toBe("https://api.x.com");
    expect(requested.pathname).toBe("/2/tweets/search/recent");
    expect(requested.searchParams.get("query")).toBe("workflow lang:en has:links -is:retweet");
    expect(requested.searchParams.get("max_results")).toBe("10");
    expect(requested.searchParams.has("pagination_token")).toBe(false);
    expect(requested.searchParams.get("expansions")).toBe("author_id");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-token", Accept: "application/json" });
  });

  it("uses the provider minimum page for a smaller planned candidate cap", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [xStandalonePost], meta: { result_count: 1 } }));
    const adapter = new XSourceAdapter({ fetchImpl, token: "test-token" });

    const page = await adapter.discover({
      query: "workflow",
      limit: 3,
      requestMetadata: { maxResults: 3, maxBillablePostsPerDiscovery: 10 },
      expandThreads: false,
    });

    expect(page.items).toHaveLength(1);
    expect(page.estimatedCost).toBe(0.05);
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get("max_results")).toBe("10");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps provider pagination opaque and reuses only the returned cursor within explicit budgets", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(xPageOne))
      .mockResolvedValueOnce(response(xPageTwo));
    const adapter = new XSourceAdapter({ fetchImpl, token: "test-token", maxPostsPerScan: 100, backoffMs: 0 });
    const requestMetadata = { maxResults: 10, maxPages: 2, maxBillablePostsPerDiscovery: 100 };

    const first = await adapter.discover({ query: "workflow", limit: 10, requestMetadata, expandThreads: false });
    expect(first.items.map((item) => item.externalId)).toEqual([xStandalonePost.id, xReplyPost.id, xQuotePost.id]);
    expect(first.nextCursor).toMatch(/^x:v1:/);
    expect(first.diagnostics.rejected).toBe(2);
    expect(first.items[0]?.requestMetadata).toMatchObject({ provider: "x-api-v2", providerNextToken: "x-next-page-token", estimatedReadCostUsd: 0.05 });

    const firstRequest = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(firstRequest.searchParams.has("pagination_token")).toBe(false);
    const second = await adapter.discover({ query: "workflow", limit: 10, cursor: first.nextCursor, requestMetadata, expandThreads: false });
    expect(second.items.map((item) => item.externalId)).toEqual([xMultilingualPost.id, xEditedPost.id]);
    const secondRequest = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(secondRequest.searchParams.get("pagination_token")).toBe("x-next-page-token");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("supports bounded cost estimates and safely filters malformed or retweet records", async () => {
    expect(estimateXReadCost(10)).toBe(0.05);
    expect(estimateXReadCost(100)).toBe(0.5);
    expect(estimateXReadCost(1_000)).toBe(5);

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [xStandalonePost, xMalformedPost, { ...xStandalonePost, id: "1900000000000000007", referenced_tweets: [{ type: "retweeted", id: xStandalonePost.id }] }], includes: { users: [xUserAlice] }, meta: { result_count: 3 } }));
    const page = await new XSourceAdapter({ fetchImpl, token: "test-token" }).discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false });
    expect(page.items).toHaveLength(1);
    expect(page.diagnostics.rejected).toBe(2);
  });

  it("normalizes post identity, conversation mapping, author provenance, links, replies, quotes, and edits", () => {
    const adapter = new XSourceAdapter({ token: "test-token" });
    const standalone = adapter.normalize(envelope({ tweet: xStandalonePost, author: xUserAlice }, xStandalonePost.id));
    const reply = adapter.normalize(envelope({ tweet: xReplyPost, author: xUserAlice }, xReplyPost.id));
    const quote = adapter.normalize(envelope({ tweet: xQuotePost, author: xUserAlice }, xQuotePost.id));
    const edited = adapter.normalize(envelope({ tweet: xEditedPost, author: xUserAlice }, xEditedPost.id));
    const withoutAuthor = adapter.normalize(envelope({ tweet: xStandalonePost, author: null }, xStandalonePost.id));

    expect(standalone).toMatchObject({ sourceKey: "x", externalId: xStandalonePost.id, externalConversationId: xStandalonePost.id, canonicalUrl: `https://x.com/${xUserAlice.username}/status/${xStandalonePost.id}`, authorExternalId: `x:user:${xUserAlice.id}`, body: xStandalonePost.text, language: "en" });
    expect(standalone.metadata).toMatchObject({ postId: xStandalonePost.id, authorUsername: xUserAlice.username, publicMetrics: xStandalonePost.public_metrics, isReply: false });
    expect(reply.externalConversationId).toBe(xStandalonePost.id);
    expect(quote.externalConversationId).toBe(xQuotePost.id);
    expect(quote.metadata).toMatchObject({ isQuote: true });
    expect(edited.metadata).toMatchObject({ editHistoryTweetIds: xEditedPost.edit_history_tweet_ids });
    expect(withoutAuthor.canonicalUrl).toBeUndefined();
    expect(withoutAuthor.authorDisplayName).toBeUndefined();
  });

  it("supports single-post lookup without confusing object data with search arrays", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(xPostLookupResponse));
    const adapter = new XSourceAdapter({ fetchImpl, token: "test-token" });
    const page = await adapter.discover({ requestMetadata: { postId: xQuotePost.id }, limit: 1, expandThreads: false });
    expect(page.items).toHaveLength(1);
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).pathname).toBe(`/2/tweets/${xQuotePost.id}`);
  });

  it("does not retry permanent auth, forbidden, or credit failures and retries transient failures", async () => {
    const invalidQuery = vi.fn<typeof fetch>().mockResolvedValue(response(xInvalidQueryError, 400));
    await expect(new XSourceAdapter({ fetchImpl: invalidQuery, token: "test-token", maxAttempts: 2, backoffMs: 0 }).discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "INVALID_QUERY", retryable: false });
    expect(invalidQuery).toHaveBeenCalledTimes(1);

    const unauthorized = vi.fn<typeof fetch>().mockResolvedValue(response(xAuthError, 401));
    await expect(new XSourceAdapter({ fetchImpl: unauthorized, token: "test-token", maxAttempts: 2, backoffMs: 0 }).discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "AUTH_FAILED", retryable: false });
    expect(unauthorized).toHaveBeenCalledTimes(1);

    const forbidden = vi.fn<typeof fetch>().mockResolvedValue(response(xForbiddenError, 403));
    await expect(new XSourceAdapter({ fetchImpl: forbidden, token: "test-token", maxAttempts: 2, backoffMs: 0 }).discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "FORBIDDEN", retryable: false });
    expect(forbidden).toHaveBeenCalledTimes(1);

    const credits = vi.fn<typeof fetch>().mockResolvedValue(response(xCreditError, 402));
    const creditAdapter = new XSourceAdapter({ fetchImpl: credits, token: "test-token", maxAttempts: 2, backoffMs: 0 });
    await expect(creditAdapter.discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS", retryable: false });
    await expect(creditAdapter.healthCheck()).resolves.toMatchObject({ ok: false, degradationState: "blocked", errorCode: "INSUFFICIENT_CREDITS" });
    expect(credits).toHaveBeenCalledTimes(1);

    const limited = vi.fn<typeof fetch>().mockResolvedValue(response(xRateLimitError, 429, { "x-rate-limit-remaining": "0", "x-rate-limit-limit": "100", "x-rate-limit-reset": "1790000000", "retry-after": "2" }));
    const limitedAdapter = new XSourceAdapter({ fetchImpl: limited, token: "test-token", maxAttempts: 2, backoffMs: 0 });
    await expect(limitedAdapter.discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    await expect(limitedAdapter.healthCheck()).resolves.toMatchObject({ ok: false, degradationState: "blocked", errorCode: "RATE_LIMITED", rateLimit: { remaining: 0, limit: 100, resetAt: "2026-09-21T14:13:20.000Z" } });
    expect(limited).toHaveBeenCalledTimes(2);

    const transient = vi.fn<typeof fetch>().mockResolvedValueOnce(response(xServerError, 503)).mockResolvedValueOnce(response({ data: [], meta: { result_count: 0 } }));
    await expect(new XSourceAdapter({ fetchImpl: transient, token: "test-token", maxAttempts: 2, backoffMs: 0 }).discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false })).resolves.toMatchObject({ diagnostics: { accepted: 0 } });
    expect(transient).toHaveBeenCalledTimes(2);

    const timeout = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(new XSourceAdapter({ fetchImpl: timeout, token: "test-token", maxAttempts: 2, backoffMs: 0 }).discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(timeout).toHaveBeenCalledTimes(2);
  });

  it("reports no paid probe before a request and requires configuration", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new XSourceAdapter({ fetchImpl }).healthCheck()).resolves.toMatchObject({ ok: false, errorCode: "CONFIGURATION_MISSING" });
    await expect(new XSourceAdapter({ fetchImpl }).discover({ query: "workflow", limit: 10, requestMetadata: {}, expandThreads: false })).rejects.toMatchObject({ code: "CONFIGURATION_MISSING" });
    await expect(new XSourceAdapter({ fetchImpl, token: "test-token" }).healthCheck()).resolves.toMatchObject({ ok: false, errorCode: "NOT_PROBED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
