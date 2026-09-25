import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const policy = await import("../../src/server/modules/operations/incremental-product-matching.policy");
const { selectInterestedProducts, newCandidateConversationIds, parseDiscoveryProvenanceTemplate, partitionFanoutJobKey, productIncrementalMatchJobKey } = policy;

const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function template(queryPlanId = "qp-github-pain", source = "github") {
  return {
    queryPlanId, source, queryFamily: "pain", demandSurface: "pain_first", concepts: ["category"], competitorSpecific: false,
    githubPainRetrievalV1: { templateVersion: "github_pain_retrieval_v1_1", demandAnchors: ["need"], categoryAnchors: ["project management"] },
  };
}

function artifact(overrides: Partial<{ id: string; workspaceId: string; productId: string; createdAt: string; queryPlanId: string; sourceKey: string; discoveryProvenance: unknown }> = {}) {
  return {
    id: overrides.id ?? "art-1",
    workspaceId: overrides.workspaceId ?? WS_A,
    productId: overrides.productId ?? "prod-1",
    jobRunId: "scan-job-1",
    queryPlanId: overrides.queryPlanId ?? "qp-github-pain",
    sourceKey: overrides.sourceKey ?? "github",
    createdAt: overrides.createdAt ?? "2026-09-25T03:00:00.000Z",
    discoveryProvenance: "discoveryProvenance" in overrides ? overrides.discoveryProvenance : template(),
  };
}

describe("incremental product matching policy (Stage 2D)", () => {
  it("has a versioned policy and preserves the frozen evaluation cap of 15", () => {
    expect(policy.INCREMENTAL_PRODUCT_MATCHING_POLICY_VERSION).toBe("incremental_product_matching_v1");
    expect(policy.INCREMENTAL_MATCH_MAX_EVALUATIONS_PER_PRODUCT).toBe(15);
    expect(policy.INCREMENTAL_MATCH_MAX_PRODUCTS_PER_REFRESH).toBeGreaterThan(0);
    expect(policy.INCREMENTAL_MATCH_MAX_PRODUCTS_PER_REFRESH).toBeLessThanOrEqual(50);
  });

  it("collapses interest to one row per (workspace, product) using the newest valid provenance", () => {
    const result = selectInterestedProducts([
      artifact({ id: "old", createdAt: "2026-09-20T00:00:00.000Z" }),
      artifact({ id: "new-invalid", createdAt: "2026-09-25T00:00:00.000Z", discoveryProvenance: null }),
      artifact({ id: "mid", createdAt: "2026-09-22T00:00:00.000Z" }),
    ]);
    expect(result.interestedProductCount).toBe(1);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].interestArtifactId).toBe("mid");
    expect(result.skipped).toEqual([]);
  });

  it("keeps identical product ids in different workspaces as distinct tenants", () => {
    const result = selectInterestedProducts([artifact({ id: "a", workspaceId: WS_A }), artifact({ id: "b", workspaceId: WS_B })]);
    expect(result.selected.map((entry) => entry.workspaceId).sort()).toEqual([WS_A, WS_B]);
  });

  it("skips products whose interest carries no usable provenance (fail closed, never a guessed context)", () => {
    const result = selectInterestedProducts([artifact({ productId: "legacy", discoveryProvenance: null })]);
    expect(result.selected).toEqual([]);
    expect(result.skipped).toEqual([{ workspaceId: WS_A, productId: "legacy", reason: "provenance_missing" }]);
  });

  it("rejects provenance describing a different query or source than the artifact", () => {
    expect(parseDiscoveryProvenanceTemplate({ queryPlanId: "qp-a", sourceKey: "github", discoveryProvenance: template("qp-b") })).toBeNull();
    expect(parseDiscoveryProvenanceTemplate({ queryPlanId: "qp-a", sourceKey: "github", discoveryProvenance: template("qp-a", "x") })).toBeNull();
    expect(parseDiscoveryProvenanceTemplate({ queryPlanId: "qp-a", sourceKey: "github", discoveryProvenance: template("qp-a") })).toMatchObject({ queryPlanId: "qp-a" });
  });

  it("applies the fanout ceiling deterministically, newest interest first", () => {
    const artifacts = Array.from({ length: 5 }, (_, index) => artifact({ id: `a${index}`, productId: `prod-${index}`, createdAt: `2026-09-2${index}T00:00:00.000Z` }));
    const first = selectInterestedProducts(artifacts, 2);
    const second = selectInterestedProducts([...artifacts].reverse(), 2);
    expect(first.selected.map((entry) => entry.productId)).toEqual(["prod-4", "prod-3"]);
    expect(second.selected).toEqual(first.selected);
    expect(first.skipped.filter((entry) => entry.reason === "fanout_cap").map((entry) => entry.productId)).toEqual(["prod-0", "prod-1", "prod-2"]);
    expect(first.interestedProductCount).toBe(5);
  });

  it("treats only never-matched conversations as new for a product, bounded and sorted", () => {
    const result = newCandidateConversationIds({ refreshConversationIds: ["c3", "c1", "c2", "c1"], alreadyMatchedConversationIds: new Set(["c2"]) });
    expect(result).toEqual({ candidates: ["c1", "c3"], alreadyMatchedCount: 1, overflowCount: 0 });
    const capped = newCandidateConversationIds({ refreshConversationIds: ["c1", "c2", "c3"], alreadyMatchedConversationIds: new Set(), max: 2 });
    expect(capped).toEqual({ candidates: ["c1", "c2"], alreadyMatchedCount: 0, overflowCount: 1 });
  });

  it("derives deterministic idempotency keys from the refresh job run", () => {
    expect(partitionFanoutJobKey("r1")).toBe("match-partition-incremental:r1");
    expect(productIncrementalMatchJobKey("r1", "p1")).toBe("match-product-incremental:r1:p1");
  });
});
