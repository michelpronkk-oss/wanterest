import { describe, expect, it } from "vitest";

import {
  buildProductRoutingProfile,
  compareCrossProductRouting,
  crossProductRoutingShadowEnabled,
  publicEvidenceFingerprint,
  routePublicEvidence,
} from "../../src/server/modules/operations";

const workspace = "10000000-0000-4000-8000-000000000001";

function profile(productId: string, productName = "Linear", workspaceId = workspace) {
  return buildProductRoutingProfile({
    workspaceId,
    productId,
    productName,
    categories: ["project management"],
    jobs: ["manage engineering projects"],
    pains: ["scattered feedback"],
    features: ["advanced reporting"],
    competitors: ["Jira"],
    comparisonTerms: ["alternative", "switching"],
  });
}

function evidence(body: string, title: string | null = null) {
  return { conversationId: "20000000-0000-4000-8000-000000000001", contentHash: `hash-${body}`, title, body, sourceKey: "fixture", publishedAt: "2026-01-01T00:00:00.000Z" };
}

describe("cross-product routing v1", () => {
  it("builds a stable, versioned profile and evidence fingerprint", () => {
    const first = profile("30000000-0000-4000-8000-000000000001");
    const second = profile("30000000-0000-4000-8000-000000000001");
    expect(first.profileVersion).toBe("product_routing_profile_v1");
    expect(first.profileFingerprint).toBe(second.profileFingerprint);
    expect(publicEvidenceFingerprint(evidence("same"))).toBe(publicEvidenceFingerprint(evidence("same")));
    expect(publicEvidenceFingerprint(evidence("changed"))).not.toBe(publicEvidenceFingerprint(evidence("same")));
  });

  it("routes direct product evidence without treating the route as qualification", () => {
    const result = routePublicEvidence({ evidence: evidence("Linear is great but lacks advanced reporting."), profiles: [profile("30000000-0000-4000-8000-000000000001")] });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]).toMatchObject({ routeType: "direct", status: "eligible" });
    expect(result.routes[0]?.reason.matchedTerms).toContain("linear");
  });

  it("rejects common-word collisions and non-software alternative language", () => {
    const collision = routePublicEvidence({ evidence: evidence("How do I perform linear regression in Python?"), profiles: [profile("30000000-0000-4000-8000-000000000001")] });
    const method = routePublicEvidence({ evidence: evidence("Alternative method for this database transaction"), profiles: [profile("30000000-0000-4000-8000-000000000001")] });
    const plugin = routePublicEvidence({ evidence: evidence("Jira plugin development with the Java API"), profiles: [profile("30000000-0000-4000-8000-000000000001")] });
    expect(collision.routes).toHaveLength(0);
    expect(method.routes).toHaveLength(0);
    expect(plugin.routes).toHaveLength(0);
  });

  it("distinguishes category and competitor routes", () => {
    const category = routePublicEvidence({ evidence: evidence("Our engineering team needs a lighter project management tool."), profiles: [profile("30000000-0000-4000-8000-000000000001")] });
    const competitor = routePublicEvidence({ evidence: evidence("What are lightweight Jira alternatives for a 20-person engineering team?"), profiles: [profile("30000000-0000-4000-8000-000000000001")] });
    expect(category.routes[0]?.routeType).toBe("category");
    expect(competitor.routes[0]).toMatchObject({ routeType: "competitor" });
    expect(competitor.routes[0]?.reason.mentionedCompetitors).toEqual(["jira"]);
  });

  it("uses stable ordering and the existing bounded fanout ceiling", () => {
    const profiles = Array.from({ length: 25 }, (_, index) => profile(`30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`));
    const input = { evidence: evidence("Our team needs a lighter project management tool."), profiles };
    const first = routePublicEvidence(input);
    const second = routePublicEvidence({ ...input, profiles: [...profiles].reverse() });
    expect(first.routes).toHaveLength(20);
    expect(first.telemetry.capSkips).toBe(5);
    expect(first.routes.map((route) => route.productId)).toEqual(second.routes.map((route) => route.productId));
  });

  it("reports shadow misses and extras without changing downstream state", () => {
    const routed = routePublicEvidence({ evidence: evidence("Linear needs better advanced reporting."), profiles: [profile("30000000-0000-4000-8000-000000000001")] });
    expect(compareCrossProductRouting({ existingProductIds: new Set(["30000000-0000-4000-8000-000000000002"]), routes: routed.routes })).toEqual({ routeMissShadow: 1, routeExtraShadow: 1 });
  });

  it("keeps public reuse separate from private cross-workspace route edges", () => {
    const secondWorkspace = "10000000-0000-4000-8000-000000000002";
    const result = routePublicEvidence({
      evidence: evidence("Our team needs a lighter project management tool."),
      profiles: [profile("30000000-0000-4000-8000-000000000001", "Linear", workspace), profile("30000000-0000-4000-8000-000000000002", "ClickUp", secondWorkspace)],
    });
    expect(new Set(result.routes.map((route) => route.conversationId)).size).toBe(1);
    expect(new Set(result.routes.map((route) => route.workspaceId))).toEqual(new Set([workspace, secondWorkspace]));
    expect(result.routes.every((route) => route.conversationId === "20000000-0000-4000-8000-000000000001")).toBe(true);
  });

  it("keeps shadow mode explicit and fail-closed", () => {
    expect(crossProductRoutingShadowEnabled({ CROSS_PRODUCT_ROUTING_MODE: "shadow" }, workspace)).toBe(false);
    expect(crossProductRoutingShadowEnabled({ CROSS_PRODUCT_ROUTING_MODE: "shadow", CROSS_PRODUCT_ROUTING_WORKSPACE_IDS: workspace }, workspace)).toBe(true);
    expect(crossProductRoutingShadowEnabled({ CROSS_PRODUCT_ROUTING_MODE: "off", CROSS_PRODUCT_ROUTING_WORKSPACE_IDS: workspace }, workspace)).toBe(false);
  });
});
