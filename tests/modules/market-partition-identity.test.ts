import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deriveMarketPartitionIdentity, MARKET_PARTITION_IDENTITY_VERSION } from "../../src/server/modules/ingestion/market-partition-identity";
import { sourceDiscoveryRequestSchema, type SourceDiscoveryRequest } from "../../src/server/providers/source/contracts";

// Wanterest 1B Stage 2B behavior-preservation and safety tests for the pure
// market-partition identity function. These prove the partition key depends
// only on the literal, tenant-free public retrieval spec - never on
// workspace/product/job identity, planner metadata, or budgets/pagination.

function xRequest(overrides: Record<string, unknown> = {}): SourceDiscoveryRequest {
  return sourceDiscoveryRequestSchema.parse({
    query: "Jira alternative",
    limit: 25,
    requestMetadata: {
      providerQuery: "Jira alternative -is:retweet",
      queryPlanId: "qp-x-alternative_search-jira-alternative",
      queryFamily: "alternative_search",
      demandSurface: "competitor_pain",
      competitorSpecific: true,
      discoveryIntent: { surface: "competitor_pain", query_family: "alternative_search", concept_keys: ["jira"], competitor_specific: true },
      semanticQuery: "Jira alternative",
      provider_context: { product_name: "Linear", competitors: ["Jira"] },
      maxResults: 25,
      maxPages: 1,
      maxBillablePostsPerDiscovery: 25,
      excludeRetweets: true,
      excludeReplies: false,
      ...overrides,
    },
  });
}

describe("deriveMarketPartitionIdentity", () => {
  it("produces identical keys for identical canonical specs, regardless of object key order", () => {
    const a = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest() });
    const b = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest() });
    expect(a.eligible).toBe(true);
    expect(b.eligible).toBe(true);
    if (a.eligible && b.eligible) {
      expect(a.partitionKey).toBe(b.partitionKey);
      expect(a.partitionId).toBe(b.partitionId);
      expect(a.partitionKey.startsWith(`${MARKET_PARTITION_IDENTITY_VERSION}:`)).toBe(true);
    }
  });

  it("is unaffected by workspace id", () => {
    const a = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ internalWorkspaceId: "11111111-1111-4111-8111-111111111111" }) });
    const b = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ internalWorkspaceId: "22222222-2222-4222-8222-222222222222" }) });
    expect(a.eligible && b.eligible && a.partitionKey === b.partitionKey).toBe(true);
  });

  it("is unaffected by product id carried in g2ScanContext-style fields", () => {
    const a = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ g2ScanContext: { workspaceId: "w1", productId: "p1" } }) });
    const b = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ g2ScanContext: { workspaceId: "w1", productId: "p2" } }) });
    expect(a.eligible && b.eligible && a.partitionKey === b.partitionKey).toBe(true);
  });

  it("is unaffected by scan/job run id", () => {
    const a = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ scanJobRunId: "job-1" }) });
    const b = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ scanJobRunId: "job-2" }) });
    expect(a.eligible && b.eligible && a.partitionKey === b.partitionKey).toBe(true);
  });

  it("is unaffected by budgets, page limits, and cursor", () => {
    const a = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ maxResults: 10, maxPages: 1, maxBillablePostsPerDiscovery: 10 }) });
    const b = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ maxResults: 100, maxPages: 2, maxBillablePostsPerDiscovery: 100 }) });
    const withCursor = sourceDiscoveryRequestSchema.parse({ ...xRequest(), cursor: "some-cursor-token" });
    const c = deriveMarketPartitionIdentity({ sourceKey: "x", request: withCursor });
    expect(a.eligible && b.eligible && a.partitionKey === b.partitionKey).toBe(true);
    expect(a.eligible && c.eligible && a.partitionKey === (c as { partitionKey: string }).partitionKey).toBe(true);
  });

  it("is unaffected by planner metadata (queryPlanId, queryFamily, demandSurface, discoveryIntent, semanticQuery, provider_context)", () => {
    const a = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest() });
    const b = deriveMarketPartitionIdentity({
      sourceKey: "x",
      request: xRequest({
        queryPlanId: "qp-different-plan-id",
        queryFamily: "comparison",
        demandSurface: "direct_product",
        discoveryIntent: { surface: "direct_product", query_family: "comparison", concept_keys: ["totally", "different"] },
        semanticQuery: "a completely different planner sentence",
        provider_context: { product_name: "SomeOtherProduct", competitors: ["Acme"], pains: ["slow onboarding"] },
      }),
    });
    expect(a.eligible && b.eligible && a.partitionKey === b.partitionKey).toBe(true);
  });

  it("is unaffected by product-relative fields (competitorSpecific)", () => {
    const a = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ competitorSpecific: true }) });
    const b = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ competitorSpecific: false }) });
    expect(a.eligible && b.eligible && a.partitionKey === b.partitionKey).toBe(true);
  });

  it("changes when an actual result-shaping provider parameter changes (X excludeRetweets)", () => {
    const a = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ excludeRetweets: true }) });
    const b = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ excludeRetweets: false }) });
    expect(a.eligible && b.eligible && a.partitionKey !== b.partitionKey).toBe(true);
  });

  it("changes when an actual result-shaping provider parameter changes (GitHub repository scope)", () => {
    const request = (repository?: string) => sourceDiscoveryRequestSchema.parse({
      query: "is:issue slow onboarding",
      limit: 25,
      requestMetadata: { contentType: "issues", ...(repository ? { repository } : {}), queryPlanId: "qp-github-pain", queryFamily: "pain", demandSurface: "pain_first" },
    });
    const a = deriveMarketPartitionIdentity({ sourceKey: "github", request: request("acme/product") });
    const b = deriveMarketPartitionIdentity({ sourceKey: "github", request: request("other/product") });
    expect(a.eligible && b.eligible && a.partitionKey !== b.partitionKey).toBe(true);
  });

  it("changes when the executed provider expression changes", () => {
    const a = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ providerQuery: "Jira alternative -is:retweet" }) });
    const b = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest({ providerQuery: "Linear alternative -is:retweet" }) });
    expect(a.eligible && b.eligible && a.partitionKey !== b.partitionKey).toBe(true);
  });

  it("retrieval_spec contains only the source's allowlisted params, dropping everything else", () => {
    const identity = deriveMarketPartitionIdentity({ sourceKey: "x", request: xRequest() });
    expect(identity.eligible).toBe(true);
    if (!identity.eligible) return;
    expect(Object.keys(identity.retrievalSpec.params).sort()).toEqual(["excludeReplies", "excludeRetweets"]);
    expect(identity.retrievalSpec).toEqual({
      v: MARKET_PARTITION_IDENTITY_VERSION,
      source_key: "x",
      expression: "Jira alternative -is:retweet",
      params: { excludeRetweets: true, excludeReplies: false },
      expandThreads: false,
    });
  });

  it("never leaks workspace/product/job/private metadata into retrieval_spec", () => {
    const identity = deriveMarketPartitionIdentity({
      sourceKey: "x",
      request: xRequest({
        internalWorkspaceId: "11111111-1111-4111-8111-111111111111",
        scanJobRunId: "job-99999999-9999-4999-8999-999999999999",
        g2ScanContext: { workspaceId: "w1", productId: "p1" },
      }),
    });
    expect(identity.eligible).toBe(true);
    if (!identity.eligible) return;
    const serialized = JSON.stringify(identity.retrievalSpec);
    expect(serialized).not.toContain("internalWorkspaceId");
    expect(serialized).not.toContain("scanJobRunId");
    expect(serialized).not.toContain("g2ScanContext");
    expect(serialized).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(serialized).not.toContain("99999999-9999-4999-8999-999999999999");
    expect(serialized).not.toContain("provider_context");
  });

  it("marks product-parameterized and adapter-side-filtered sources ineligible with the exact documented reason", () => {
    expect(deriveMarketPartitionIdentity({ sourceKey: "hacker-news", request: xRequest() })).toEqual({ eligible: false, reason: "adapter_side_product_filter" });
    expect(deriveMarketPartitionIdentity({ sourceKey: "g2", request: xRequest() })).toEqual({ eligible: false, reason: "product_parameterized_review_import" });
    expect(deriveMarketPartitionIdentity({ sourceKey: "trustpilot", request: xRequest() })).toEqual({ eligible: false, reason: "product_parameterized_review_import" });
    expect(deriveMarketPartitionIdentity({ sourceKey: "public-web", request: xRequest() })).toEqual({ eligible: false, reason: "explicit_url_fetch" });
    expect(deriveMarketPartitionIdentity({ sourceKey: "fixture", request: xRequest() })).toEqual({ eligible: false, reason: "non_production_source" });
    expect(deriveMarketPartitionIdentity({ sourceKey: "some-future-source", request: xRequest() })).toEqual({ eligible: false, reason: "unclassified_source" });
  });

  it("marks every currently eligible source as eligible", () => {
    for (const sourceKey of ["x", "github", "reddit", "bluesky", "stack-exchange", "youtube", "gitlab", "product-hunt"]) {
      const identity = deriveMarketPartitionIdentity({ sourceKey, request: xRequest() });
      expect(identity.eligible, `${sourceKey} should be eligible`).toBe(true);
    }
  });

  it("Layer 12A.3A: Hacker News is eligible only for a Search v2 (Algolia) request, never the legacy filtered-feed shape", () => {
    const legacy = deriveMarketPartitionIdentity({
      sourceKey: "hacker-news",
      request: xRequest({ executionMode: "filtered_newstories_feed", searchUnsupported: true, lexicalAnchors: ["Jira"] }),
    });
    expect(legacy).toEqual({ eligible: false, reason: "adapter_side_product_filter" });

    const searchV2 = deriveMarketPartitionIdentity({
      sourceKey: "hacker-news",
      request: xRequest({ executionMode: "algolia_search_v2", retrievalImplementationVersion: "hacker_news_search_v2_1" }),
    });
    expect(searchV2.eligible).toBe(true);
    if (!searchV2.eligible) return;
    expect(searchV2.retrievalSpec).toEqual({
      v: "market_partition_identity_v1",
      source_key: "hacker-news",
      expression: "Jira alternative -is:retweet",
      params: { executionMode: "algolia_search_v2" },
      expandThreads: false,
    });
  });

  it("trims and collapses whitespace in the expression without lowercasing or reordering", () => {
    const identity = deriveMarketPartitionIdentity({
      sourceKey: "x",
      request: xRequest({ providerQuery: "  Jira   OR  \"project tracker\"  " }),
    });
    expect(identity.eligible).toBe(true);
    if (identity.eligible) expect(identity.retrievalSpec.expression).toBe('Jira OR "project tracker"');
  });
});
