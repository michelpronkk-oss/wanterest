import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const lookup = { data: { id: "edge-existing" }, error: null };
const saved = {
  id: "edge-existing", workspace_id: "10000000-0000-4000-8000-000000000001", product_id: "30000000-0000-4000-8000-000000000001",
  conversation_id: "20000000-0000-4000-8000-000000000001", evidence_fingerprint: "a".repeat(64), profile_fingerprint: "b".repeat(64),
  route_fingerprint: "c".repeat(64), route_score: 0.8, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};

function client() {
  const lookupQuery = {
    select: vi.fn(() => lookupQuery), eq: vi.fn(() => lookupQuery), maybeSingle: vi.fn(async () => lookup),
  };
  const upsertQuery = {
    upsert: vi.fn(() => upsertQuery), select: vi.fn(() => upsertQuery), maybeSingle: vi.fn(async () => ({ data: saved, error: null })),
  };
  const from = vi.fn().mockReturnValueOnce(lookupQuery).mockReturnValueOnce(upsertQuery);
  return { from, lookupQuery, upsertQuery };
}

describe("CrossProductRoutingRepository", () => {
  it("targets the complete deployed unique key including profile_version", async () => {
    const db = client();
    const { CrossProductRoutingRepository } = await import("../../src/server/modules/operations/cross-product-routing.repository");
    const repository = new CrossProductRoutingRepository(db);
    await repository.upsertEdge({
      workspaceId: "10000000-0000-4000-8000-000000000001", productId: "30000000-0000-4000-8000-000000000001",
      conversationId: "20000000-0000-4000-8000-000000000001", routingVersion: "cross_product_routing_v1", profileVersion: "product_routing_profile_v1",
      evidenceFingerprint: "a".repeat(64), profileFingerprint: "b".repeat(64), routeFingerprint: "c".repeat(64), routeType: "direct", status: "eligible", score: 0.8,
      reason: { matchedTerms: ["product"], mentionedCompetitors: [], stage: "deterministic_entity" },
    });

    expect(db.lookupQuery.eq).toHaveBeenCalledWith("profile_version", "product_routing_profile_v1");
    expect(db.upsertQuery.upsert).toHaveBeenCalledWith(expect.any(Object), {
      onConflict: "workspace_id,product_id,conversation_id,routing_version,profile_version,evidence_fingerprint,profile_fingerprint",
    });
  });
});
