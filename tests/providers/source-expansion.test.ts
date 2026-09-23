import { describe, expect, it, vi } from "vitest";

import { ProductHuntSourceAdapter } from "../../src/server/providers/source/product-hunt";
import { StackExchangeSourceAdapter } from "../../src/server/providers/source/stack-exchange";
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
      if (url.includes("/api/v1/products?")) return response({ data: [{ id: "product-domain", attributes: { name: "Workflow Radar", domain: "radar.example.com", slug: "workflow-radar" } }] });
      return response({ data: [{ id: "g2-review-1", attributes: { comment: "The workflow is easier to operate now.", star_rating: 4, created_at: "2026-09-20T10:00:00.000Z", reviewer_name: "Sam", verified: true } }] });
    });
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", productsBaseUrl: "https://g2.test/api/v1", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", name: "Workflow Radar", domain: "https://www.radar.example.com/pricing" }] } });
    const candidate = adapter.normalize(page.items[0]!);
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "resolved", productId: "product-domain", matchedBy: "domain" });
    expect(candidate.metadata).toMatchObject({ sourceCategory: "software_review", rating: 4, verified: true });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/api/v2/products/product-domain/reviews"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer approved-token" }) }));
  });

  it("resolves a G2 product by normalized name", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).includes("/api/v1/products?")
      ? response({ data: [{ id: "product-name", attributes: { name: "Acme   Flow", slug: "acme-flow" } }] })
      : response({ data: [] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", productsBaseUrl: "https://g2.test/api/v1", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", name: " acme flow " }] } });
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "resolved", productId: "product-name", matchedBy: "name" });
  });

  it("reuses a cached mapping without calling the G2 Products API", async () => {
    const target = { key: "product", kind: "product" as const, name: "Cached Flow", domain: "cached.example.com" };
    const mapping = { status: "resolved" as const, targetKey: "product", targetFingerprint: g2TargetFingerprint(target), productId: "cached-product", matchedBy: "domain" as const, candidateProductIds: ["cached-product"], resolvedAt: "2026-09-23T10:00:00.000Z", resolverVersion: "g2-product-resolution-v1" as const };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [{ id: "g2-review-cached", attributes: { comment: "Cached mapping works." } }] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", productsBaseUrl: "https://g2.test/api/v1", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [target], g2ProductMappings: { product: mapping } } });
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "resolved", productId: "cached-product" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/api/v2/products/cached-product/reviews"), expect.anything());
  });

  it("records a structured no-match state and skips review fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response({ data: [] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", productsBaseUrl: "https://g2.test/api/v1", fetchImpl });
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
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", productsBaseUrl: "https://g2.test/api/v1", fetchImpl });
    const page = await adapter.discover({ limit: 1, expandThreads: false, requestMetadata: { g2Targets: [{ key: "product", domain: "same.example.com" }] } });
    expect(page.items).toHaveLength(0);
    expect(page.diagnostics.resolutions?.[0]).toMatchObject({ status: "ambiguous_match", candidateProductIds: ["product-a", "product-b"] });
    expect(page.diagnostics.messages).toContain("g2_resolution:ambiguous_match:product");
  });

  it("uses the resolved G2 product ID for review fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).includes("/api/v1/products?")
      ? response({ data: [{ id: "resolved-review-product", attributes: { name: "Review Product" } }] })
      : response({ data: [{ id: "review-1", attributes: { comment: "A real review." } }] }));
    const adapter = new G2SourceAdapter({ apiKey: "approved-token", baseUrl: "https://g2.test/api/v2", productsBaseUrl: "https://g2.test/api/v1", fetchImpl });
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
