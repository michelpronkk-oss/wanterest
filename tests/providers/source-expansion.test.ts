import { describe, expect, it, vi } from "vitest";

import { ProductHuntSourceAdapter } from "../../src/server/providers/source/product-hunt";
import { deriveStackExchangeFeatureRecency, evaluateStackExchangeDepth, selectStackExchangeAnswers, selectStackExchangeComments, StackExchangeSourceAdapter, STACK_EXCHANGE_DEPTH_VERSION } from "../../src/server/providers/source/stack-exchange";
import { PublicWebSourceAdapter } from "../../src/server/providers/source/public-web";
import { G2SourceAdapter } from "../../src/server/providers/source/g2";
import { g2TargetFingerprint } from "../../src/server/providers/source/g2/product-resolution";
import { TrustpilotSourceAdapter } from "../../src/server/providers/source/trustpilot";

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("Source Expansion v1 adapters", () => {
  it("imports Product Hunt posts and bounded comments through the GraphQL contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({
      data: {
        posts: {
          nodes: [{
            id: "42",
            name: "Workflow Radar",
            tagline: "Demand intelligence for product teams",
            description: "A discussion about finding recurring workflow problems.",
            createdAt: "2026-09-22T12:00:00.000Z",
            url: "https://www.producthunt.com/products/workflow-radar",
            website: "https://workflow-radar.example.com",
            votesCount: 12,
            commentsCount: 1,
            comments: { nodes: [{ id: "comment-1", body: "How does this compare with our current workflow?", createdAt: "2026-09-22T12:30:00.000Z", url: "https://www.producthunt.com/posts/workflow-radar#comment-1", user: { id: "u1", name: "Ada", username: "ada", url: "https://www.producthunt.com/@ada" }, votesCount: 2 }] },
            topics: { nodes: [{ name: "Productivity", slug: "productivity" }] },
            user: { id: "maker-1", name: "Maker", username: "maker", url: "https://www.producthunt.com/@maker" },
          }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    }));
    const adapter = new ProductHuntSourceAdapter({ token: "test-token", endpoint: "https://ph.test/graphql", fetchImpl });
    const page = await adapter.discover({ query: "workflow", limit: 3, expandThreads: false, requestMetadata: {} });
    expect(page.items).toHaveLength(2);
    expect(adapter.normalize(page.items[1]!).metadata).toMatchObject({ sourceCategory: "product_launch_comment", qualificationContext: "launch_discussion_not_switching_by_default" });
    expect(fetchImpl).toHaveBeenCalledWith("https://ph.test/graphql", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
  });

  it("uses Stack Exchange advanced search and preserves developer discussion metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({
      items: [{ question_id: 99, title: "What is a reliable Jira alternative?", body: "<p>We need a <strong>simpler</strong> issue tracker.</p>", link: "https://stackoverflow.com/questions/99/example", creation_date: 1_758_284_800, score: 4, answer_count: 2, accepted_answer_id: 100, tags: ["project-management"] }],
      has_more: false,
      quota_max: 300,
      quota_remaining: 299,
    }));
    const adapter = new StackExchangeSourceAdapter({ fetchImpl, baseUrl: "https://se.test/2.3" });
    const page = await adapter.discover({ query: "Jira alternative", limit: 1, expandThreads: false, requestMetadata: { site: "stackoverflow" } });
    const candidate = adapter.normalize(page.items[0]!);
    expect(candidate.externalId).toBe("stackoverflow:99");
    expect(candidate.body).toContain("simpler issue tracker");
    expect(candidate.metadata).toMatchObject({ sourceCategory: "developer_discussion", site: "stackoverflow", acceptedAnswerId: 100 });
  });

  it("applies deterministic Stack Exchange depth eligibility and bounded message selection", () => {
    expect(evaluateStackExchangeDepth({ title: "Linear regression with alternative method", answerCount: 2, commentCount: 2 })).toMatchObject({ eligible: false });
    expect(evaluateStackExchangeDepth({ title: "What is an alternative method for this calculation?", answerCount: 2, commentCount: 2 })).toMatchObject({ eligible: false });
    expect(evaluateStackExchangeDepth({ title: "How do I install a Jira plugin?", body: "Plugin exception and stack trace", answerCount: 2, commentCount: 2 })).toMatchObject({ eligible: false });
    expect(evaluateStackExchangeDepth({ title: "What are alternatives to Jira?", body: "We need a simpler project management workflow.", answerCount: 2, commentCount: 2, tags: ["project-management"] })).toMatchObject({ eligible: true });
    expect(evaluateStackExchangeDepth({ title: "Historical project management recommendation", body: "Which workflow tool would you recommend?", answerCount: 1, commentCount: 1, tags: ["project-management"] })).toMatchObject({ eligible: true });
    expect(evaluateStackExchangeDepth({ title: "What tool should our bot use?", body: "We need an automated workflow.", answerCount: 2, commentCount: 2, ownerType: "bot" })).toMatchObject({ eligible: false });
    const answers = selectStackExchangeAnswers({ acceptedAnswerId: 10, maxAnswers: 3, answers: [
      { answer_id: 12, question_id: 1, creation_date: 3, score: 100 },
      { answer_id: 10, question_id: 1, creation_date: 2, score: 1, is_accepted: true },
      { answer_id: 11, question_id: 1, creation_date: 1, score: 50 },
      { answer_id: 13, question_id: 1, creation_date: 4, score: 2 },
    ] });
    expect(answers.map((answer) => answer.answer_id)).toEqual([10, 12, 11]);
    expect(selectStackExchangeComments({ maxComments: 2, comments: [
      { comment_id: 2, post_id: 1, creation_date: 2, score: 0, body: "Thanks" },
      { comment_id: 1, post_id: 1, creation_date: 1, score: 2, body: "We need an alternative." },
      { comment_id: 1, post_id: 1, creation_date: 1, score: 2, body: "duplicate" },
    ] }).map((comment) => comment.comment_id)).toEqual([1]);
  });

  it("expands one eligible question into one canonical thread with bounded answers and comments", async () => {
    const question = { question_id: 123, title: "What are alternatives to Jira?", body: "We need a simpler project management workflow.", link: "https://stackoverflow.com/questions/123/example", creation_date: 1_758_284_800, last_activity_date: 1_758_284_900, score: 4, answer_count: 2, comment_count: 2, accepted_answer_id: 101, tags: ["project-management"] };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search/advanced")) return response({ items: [question], has_more: false, quota_remaining: 299 });
      if (url.pathname.endsWith("/questions/123/answers")) return response({ items: [
        { answer_id: 101, question_id: 123, body: "The accepted alternative.", link: "https://stackoverflow.com/a/101", creation_date: 1_758_284_910, score: 1, is_accepted: true },
        { answer_id: 102, question_id: 123, body: "Another workflow tool.", link: "https://stackoverflow.com/a/102", creation_date: 1_758_284_911, score: 8 },
      ], has_more: false, quota_remaining: 298 });
      if (url.pathname.endsWith("/questions/123/comments")) return response({ items: [
        { comment_id: 201, post_id: 123, body: "We need an alternative.", creation_date: 1_758_284_912, score: 1 },
        { comment_id: 202, post_id: 123, body: "Thanks", creation_date: 1_758_284_913, score: 0 },
      ], has_more: false, quota_remaining: 297 });
      if (url.pathname.endsWith("/answers/101;102/comments")) return response({ items: [
        { comment_id: 301, post_id: 101, body: "This solves the workflow need.", creation_date: 1_758_284_914, score: 1 },
        { comment_id: 302, post_id: 102, body: "noise", creation_date: 1_758_284_915, score: 0 },
      ], has_more: false, quota_remaining: 296 });
      throw new Error(`unexpected URL ${url}`);
    });
    const adapter = new StackExchangeSourceAdapter({ fetchImpl, baseUrl: "https://se.test/2.3", clock: () => new Date("2026-09-24T12:00:00.000Z") });
    const page = await adapter.discover({ query: "Jira alternative", limit: 1, expandThreads: false, requestMetadata: { queryPlanVersion: "query_planning_v8", depthPolicyVersion: STACK_EXCHANGE_DEPTH_VERSION } });
    expect(page.providerMetrics).toMatchObject({ stackExchangeDepthV1: { policyVersion: STACK_EXCHANGE_DEPTH_VERSION, searchRoots: 1, depthEligible: 1, depthExpanded: 1, answersLoaded: 2, answersPersisted: 2, commentsLoaded: 4, commentsPersisted: 2, depthRequests: 3 } });
    expect(page.items.map((item) => item.externalId)).toEqual(["stackoverflow:123", "stack-exchange:answer:101", "stack-exchange:answer:102", "stack-exchange:question-comment:201", "stack-exchange:answer-comment:301"]);
    const candidates = page.items.map((item) => adapter.normalize(item));
    expect(new Set(candidates.map((candidate) => candidate.externalConversationId))).toEqual(new Set(["stackoverflow:123"]));
    expect(candidates.find((candidate) => candidate.externalId.endsWith(":101"))?.metadata).toMatchObject({ providerType: "answer", accepted: true, parentQuestionId: "stackoverflow:123" });
    expect(candidates.find((candidate) => candidate.externalId.includes("answer-comment:301"))?.metadata).toMatchObject({ messageType: "answer_comment", parentAnswerId: "stackoverflow:answer:101" });
  });

  it("skips Stack Exchange depth for roots outside an incremental refresh window", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).includes("/search/advanced")) return response({ items: [{ question_id: 55, title: "What are alternatives to Jira?", body: "Need a workflow tool.", link: "https://stackoverflow.com/questions/55/example", creation_date: 1_600_000_000, last_activity_date: 1_600_000_000, answer_count: 1, comment_count: 1 }], has_more: false });
      throw new Error("depth request should have been skipped");
    });
    const adapter = new StackExchangeSourceAdapter({ fetchImpl, baseUrl: "https://se.test/2.3" });
    const page = await adapter.discover({ query: "alternative", limit: 1, expandThreads: false, requestMetadata: { queryPlanVersion: "query_planning_v8", refreshWindowStart: "2026-01-01T00:00:00.000Z" } });
    expect(page.providerMetrics).toMatchObject({ stackExchangeDepthV1: { searchRoots: 1, refreshSkips: 1, depthRequests: 0 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("adds one execution-time 24-month boundary only to feature-demand searches", async () => {
    const now = new Date("2026-09-24T12:34:56.789Z");
    const expected = deriveStackExchangeFeatureRecency(now);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ items: [], has_more: false, quota_remaining: 299 }));
    const adapter = new StackExchangeSourceAdapter({ fetchImpl, baseUrl: "https://se.test/2.3", clock: () => now });
    const page = await adapter.discover({ query: "need project management software with Project management features", limit: 8, expandThreads: false, requestMetadata: { queryFamily: "feature_requirement", demandSurface: "feature_demand" } });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(url.searchParams.get("q")).toBe("need project management software with Project management features");
    expect(url.searchParams.get("site")).toBe("stackoverflow");
    expect(url.searchParams.get("pagesize")).toBe("8");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("sort")).toBe("relevance");
    expect(url.searchParams.get("filter")).toBe("withbody");
    expect(url.searchParams.get("fromdate")).toBe(String(expected.fromDateUnix));
    expect(url.searchParams.has("todate")).toBe(false);
    expect(page.providerMetrics).toEqual({ stackExchangeFeatureRecencyV1: expected });
  });

  it("keeps recent and boundary questions while excluding older feature questions", async () => {
    const now = new Date("2026-09-24T12:34:56.000Z");
    const boundary = deriveStackExchangeFeatureRecency(now);
    const question = (questionId: number, creationDate: number) => ({ question_id: questionId, title: "Looking for project management software with dependencies", body: "Need software with project management features.", link: `https://stackoverflow.com/questions/${questionId}/feature`, creation_date: creationDate });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const fromDate = Number(new URL(String(input)).searchParams.get("fromdate"));
      return response({ items: [question(1, boundary.fromDateUnix - 1), question(2, boundary.fromDateUnix), question(3, boundary.fromDateUnix + 1)].filter((item) => item.creation_date >= fromDate), has_more: false });
    });
    const adapter = new StackExchangeSourceAdapter({ fetchImpl, baseUrl: "https://se.test/2.3", clock: () => now });
    const page = await adapter.discover({ query: "feature", limit: 8, expandThreads: false, requestMetadata: { queryFamily: "feature_requirement", demandSurface: "feature_demand" } });
    expect(page.items.map((item) => item.externalId)).toEqual(["stackoverflow:2", "stackoverflow:3"]);
  });

  it("preserves pagination and applies no extra request for the recency boundary", async () => {
    const now = new Date("2026-09-24T12:34:56.000Z");
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => response({ items: [], has_more: new URL(String(input)).searchParams.get("page") === "1" }));
    const adapter = new StackExchangeSourceAdapter({ fetchImpl, baseUrl: "https://se.test/2.3", clock: () => now });
    const request = { query: "feature", limit: 8, expandThreads: false, requestMetadata: { queryFamily: "feature_requirement", demandSurface: "feature_demand" } } as const;
    const first = await adapter.discover(request);
    await adapter.discover({ ...request, cursor: first.nextCursor });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    const secondUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(firstUrl.searchParams.get("page")).toBe("1");
    expect(secondUrl.searchParams.get("page")).toBe("2");
    expect(secondUrl.searchParams.get("fromdate")).toBe(firstUrl.searchParams.get("fromdate"));
    expect(secondUrl.searchParams.get("pagesize")).toBe("8");
  });

  it.each([
    ["pain_first", "pain"],
    ["job_demand", "jtbd"],
  ])("does not add feature recency to Stack Exchange %s", async (surface, family) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ items: [], has_more: false }));
    const adapter = new StackExchangeSourceAdapter({ fetchImpl, baseUrl: "https://se.test/2.3", clock: () => new Date("2026-09-24T12:34:56.000Z") });
    const page = await adapter.discover({ query: "project management", limit: 8, expandThreads: false, requestMetadata: { queryFamily: family, demandSurface: surface } });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.has("fromdate")).toBe(false);
    expect(page.providerMetrics).toBeUndefined();
  });

  it("fails only the feature query when recency derivation fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ items: [], has_more: false }));
    const adapter = new StackExchangeSourceAdapter({ fetchImpl, baseUrl: "https://se.test/2.3", clock: () => new Date("invalid") });
    await expect(adapter.discover({ query: "feature", limit: 8, expandThreads: false, requestMetadata: { queryFamily: "feature_requirement", demandSurface: "feature_demand" } })).rejects.toMatchObject({ code: "STACK_EXCHANGE_RECENCY_DERIVATION_FAILED" });
    await expect(adapter.discover({ query: "pain", limit: 8, expandThreads: false, requestMetadata: { queryFamily: "pain", demandSurface: "pain_first" } })).resolves.toMatchObject({ items: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fetches only explicit Public Web URLs through the safe website boundary", async () => {
    const adapter = new PublicWebSourceAdapter({
      fetcher: {
        fetchPage: async () => ({ url: "https://forum.example.com/thread/1", status: 200, contentType: "text/html", text: "<html><head><title>Workflow alternatives</title></head><body><main><h1>Workflow alternatives</h1><p>Teams need a simpler process.</p></main></body></html>" }),
      } as never,
    });
    const page = await adapter.discover({ query: "workflow alternatives", limit: 1, expandThreads: false, requestMetadata: { urls: ["https://forum.example.com/thread/1"] } });
    expect(page.items).toHaveLength(1);
    expect(adapter.normalize(page.items[0]!).metadata).toMatchObject({ sourceCategory: "public_web", providerType: "web_page" });
    const empty = await adapter.discover({ query: "workflow", limit: 1, expandThreads: false, requestMetadata: {} });
    expect(empty.items).toHaveLength(0);
    expect(empty.diagnostics.messages[0]).toContain("explicit public URLs");
  });

  it("resolves a G2 product by exact domain before importing reviews", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v2/products?")) return response({ data: [{ id: "product-domain", type: "products", attributes: { name: "Workflow Radar", domain: "radar.example.com", slug: "workflow-radar" } }] });
      return response({ data: [{ id: "g2-review-1", attributes: { comment: "The workflow is easier to operate now.", star_rating: 4, created_at: "2026-09-20T10:00:00.000Z", reviewer_name: "Sam", verified: true } }] });
    });
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", name: "Workflow Radar", domain: "https://www.radar.example.com/pricing" }] } });
    const candidate = adapter.normalize(page.items[0]!);
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "resolved", productId: "product-domain", matchedBy: "domain" });
    expect(candidate.metadata).toMatchObject({ sourceCategory: "software_review", rating: 4, verified: true });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/api/v2/products/product-domain/reviews"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer approved-token" }) }));
    const productCall = fetchImpl.mock.calls.find(([input]) => String(input).includes("/products?"));
    expect(productCall?.[0]).toContain("/api/v2/products?");
    expect(productCall?.[0]).toContain("filter%5Bdomain%5D=radar.example.com");
    expect(productCall?.[0]).toContain("page%5Bsize%5D=25");
    expect(productCall?.[0]).not.toContain("page%5Bnumber%5D");
    expect(productCall?.[0]).not.toContain("/api/v1/products?");
    expect(productCall?.[1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer approved-token" }) }));
  });

  it("resolves a G2 product by normalized name", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).includes("/api/v2/products?")
      ? response({ data: [{ id: "product-name", attributes: { name: "Acme   Flow", slug: "acme-flow" } }] })
      : response({ data: [] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", name: " acme flow " }] } });
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "resolved", productId: "product-name", matchedBy: "name" });
  });

  it("resolves a G2 product by slug", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).includes("/api/v2/products?")
      ? response({ data: [{ id: "product-slug", type: "products", attributes: { name: "Workflow Radar", slug: "workflow-radar" } }] })
      : response({ data: [] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", slug: "workflow-radar" }] } });
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "resolved", productId: "product-slug", matchedBy: "slug" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const productCall = fetchImpl.mock.calls.find(([input]) => String(input).includes("/api/v2/products?"));
    const productUrl = new URL(String(productCall?.[0]));
    expect(productUrl.pathname).toBe("/api/v2/products");
    expect(productUrl.searchParams.getAll("filter[slug][]")).toEqual(["workflow-radar"]);
    expect(productUrl.searchParams.has("filter[slug]")).toBe(false);
    expect(productUrl.searchParams.get("page[size]")).toBe("25");
    expect(productCall?.[1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer approved-token" }) }));
    const reviewCall = fetchImpl.mock.calls.find(([input]) => String(input).includes("/reviews"));
    expect(reviewCall?.[0]).toContain("/api/v2/products/product-slug/reviews");
    expect(reviewCall?.[1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer approved-token" }) }));
  });

  it("preserves G2 resolution order and leaves domain/name filters scalar", async () => {
    const productUrls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v2/products?")) {
        productUrls.push(url);
        const parsed = new URL(url);
        if (parsed.searchParams.has("filter[domain]")) return response({ data: [] });
        if (parsed.searchParams.has("filter[name]")) return response({ data: [] });
        return response({ data: [{ id: "product-ordered", attributes: { name: "Workflow Radar", domain: "radar.example.com", slug: "workflow-radar" } }] });
      }
      return response({ data: [] });
    });
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl });
    await expect(adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", name: "Workflow Radar", domain: "radar.example.com", slug: "workflow-radar" }] } })).resolves.toMatchObject({ diagnostics: { resolutions: [{ status: "resolved", matchedBy: "slug" }] } });
    expect(productUrls).toHaveLength(3);
    expect(productUrls[0]).toContain("filter%5Bdomain%5D=radar.example.com");
    expect(productUrls[1]).toContain("filter%5Bname%5D=Workflow+Radar");
    expect(productUrls[2]).toContain("filter%5Bslug%5D%5B%5D=workflow-radar");
    expect(productUrls.every((url) => url.includes("/api/v2/products?") && url.includes("page%5Bsize%5D=25"))).toBe(true);
    expect(productUrls.some((url) => url.includes("filter%5Bslug%5D=workflow-radar"))).toBe(false);
  });

  it("keeps v2 product lookups bounded and does not follow an unverified next link", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v2/products?")) return response({ data: [], links: { next: "https://g2.test/api/v2/products?page[after]=next" } });
      return response({ data: [] });
    });
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl, maxCatalogRequests: 1 });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", name: "Not Listed" }] } });
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "no_match" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("page%5Bsize%5D=25");
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain("page%5Bnumber%5D");
  });

  it("keeps G2 product-resolution HTTP 401 non-retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ errors: [{ code: "unauthorized" }] }, 401));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl });
    await expect(adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", name: "Workflow Radar" }] } })).rejects.toMatchObject({ code: "HTTP_401", retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reuses a cached mapping without calling the G2 Products API", async () => {
    const target = { key: "product", kind: "product" as const, name: "Cached Flow", domain: "cached.example.com" };
    const mapping = { status: "resolved" as const, targetKey: "product", targetFingerprint: g2TargetFingerprint(target), productId: "cached-product", matchedBy: "domain" as const, candidateProductIds: ["cached-product"], resolvedAt: "2026-09-23T10:00:00.000Z", resolverVersion: "g2-product-resolution-v1" as const };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [{ id: "g2-review-cached", attributes: { comment: "Cached mapping works." } }] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [target], g2ProductMappings: { product: mapping } } });
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "resolved", productId: "cached-product" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/api/v2/products/cached-product/reviews"), expect.anything());
  });

  it("records a structured no-match state and skips review fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response({ data: [] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", name: "Not Listed", domain: "missing.example.com" }] } });
    expect(page.items).toHaveLength(0);
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "no_match", targetKey: "product" });
    expect(page.diagnostics.messages).toContain("g2_resolution:no_match:product");
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining("/reviews"), expect.anything());
  });

  it("does not guess when a G2 domain is ambiguous", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [
      { id: "product-a", attributes: { name: "Flow A", domain: "same.example.com" } },
      { id: "product-b", attributes: { name: "Flow B", domain: "same.example.com" } },
    ] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", domain: "same.example.com" }] } });
    expect(page.items).toHaveLength(0);
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "ambiguous_match", candidateProductIds: ["product-a", "product-b"] });
    expect(page.diagnostics.messages).toContain("g2_resolution:ambiguous_match:product");
  });

  it("uses the resolved G2 product ID for review fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).includes("/api/v2/products?")
      ? response({ data: [{ id: "resolved-review-product", attributes: { name: "Review Product" } }] })
      : response({ data: [{ id: "review-1", attributes: { comment: "A real review." } }] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", fetchImpl });
    await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", name: "Review Product" }] } });
    const reviewCall = fetchImpl.mock.calls.find(([input]) => String(input).includes("/reviews"));
    expect(reviewCall?.[0]).toContain("/products/resolved-review-product/reviews");
  });

  it("normalizes public Trustpilot Business Unit reviews and keeps credentials opt-in", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ reviews: [{ id: "tp-review-1", title: "Much simpler", text: "We replaced a manual process.", stars: 5, createdAt: "2026-09-21T10:00:00.000Z", isVerified: true, consumer: { id: "consumer-1", displayName: "Taylor" } }], nextPageToken: "next-token" }));
    const adapter = new TrustpilotSourceAdapter({ apiKey: "approved-key", businessUnitId: "business-1", baseUrl: "https://trust.test/v1", fetchImpl, businessUrl: "https://www.trustpilot.com/review/example.com" });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: {} });
    const candidate = adapter.normalize(page.items[0]!);
    expect(candidate.canonicalUrl).toBe("https://www.trustpilot.com/review/example.com");
    expect(candidate.metadata).toMatchObject({ sourceCategory: "customer_review", rating: 5, verified: true });
    expect(page.nextCursor).toBe("page-token:next-token");
    await expect(new TrustpilotSourceAdapter({ fetchImpl }).discover({ limit: 1, expandThreads: false, requestMetadata: {} })).rejects.toMatchObject({ code: "CONFIGURATION_MISSING" });
  });
});
