import { describe, expect, it } from "vitest";

import { DemandClusteringService, DemandCurrentnessService, DemandMapService, InMemoryDemandClusteringRepository } from "../../src/server/modules/demand-intelligence";
import { engineVersionId, now, productA, seedEvidence, workspaceA } from "./demand-clustering.fixtures";

/**
 * Layer 9B: DemandCurrentnessService was extracted out of DemandMapService so
 * Gap v2, Drift v2 and Digests share one currentness implementation. These
 * tests prove parity with the Map (unchanged after extraction) and cover every
 * exclusion reason directly at the shared-service level.
 */
function setup() {
  const repository = new InMemoryDemandClusteringRepository();
  const clustering = new DemandClusteringService(repository);
  const currentness = new DemandCurrentnessService(repository);
  const map = new DemandMapService(repository);
  const cluster = (productId = productA, workspaceId = workspaceA, at = now) => clustering.clusterProduct({ workspaceId, productId, engineVersionId, now: at });
  return { repository, currentness, map, cluster };
}

describe("Layer 9B DemandCurrentnessService", () => {
  it("covers every exclusion reason: superseded, invalidated, retracted, stale, duplicate conversation", async () => {
    const { repository, currentness, cluster } = setup();
    const superseded = seedEvidence(repository, { key: "superseded", concepts: ["sprint_planning"] });
    const invalidated = seedEvidence(repository, { key: "invalidated", concepts: ["sprint_planning"] });
    const retracted = seedEvidence(repository, { key: "retracted", concepts: ["sprint_planning"] });
    seedEvidence(repository, { key: "stale", concepts: ["sprint_planning"], publishedAt: "2026-05-01T00:00:00.000Z" });
    seedEvidence(repository, { key: "live", concepts: ["sprint_planning"], createdAt: "2026-09-22T00:00:00.000Z" });
    seedEvidence(repository, { key: "repost", concepts: ["sprint_planning"], contentKey: "live", createdAt: "2026-09-23T00:00:00.000Z" });
    await cluster();

    superseded.currentEvaluationId = "re-evaluated-as-weak";
    invalidated.signal = { ...invalidated.signal!, lifecycle_status: "invalidated" };
    retracted.signal = { ...retracted.signal!, lifecycle_status: "retracted" };

    const result = await currentness.getCurrentness({ workspaceId: workspaceA, productId: productA, now });
    const reasons = new Map(result.members.map((member) => [member.reason ?? "contributes", member]));
    expect([...reasons.keys()].sort()).toEqual(["contributes", "duplicate_content", "evaluation_superseded", "signal_invalidated", "signal_retracted", "stale"]);
    expect(result.members.filter((member) => member.contributes)).toHaveLength(1);
  });

  it("is exactly what Layer 9A's Map already derives — extraction changed nothing", async () => {
    const { repository, currentness, map, cluster } = setup();
    const a = seedEvidence(repository, { key: "one", concepts: ["sprint_planning"] });
    const b = seedEvidence(repository, { key: "two", concepts: ["sprint_planning"] });
    await cluster();
    a.currentEvaluationId = "re-evaluated-as-weak";
    b.signal = { ...b.signal!, lifecycle_status: "invalidated" };

    const direct = await currentness.getCurrentness({ workspaceId: workspaceA, productId: productA, now });
    const viaMap = await map.getDemandMap({ workspaceId: workspaceA, productId: productA, legacy: null, now });
    const byId = new Map(direct.members.map((member) => [member.membershipId, member]));
    for (const concept of [...viaMap.current, ...viaMap.previouslyObserved]) {
      for (const cluster of concept.clusters) {
        for (const member of cluster.members) {
          expect(byId.get(member.membershipId)).toMatchObject({ contributes: member.contributes, reason: member.reason });
        }
      }
    }
  });

  it("passes through Stage 2G's own persisted duplicate_content exclusion unchanged", async () => {
    const { repository, currentness, cluster } = setup();
    seedEvidence(repository, { key: "one", concepts: ["sprint_planning"] });
    seedEvidence(repository, { key: "repost", concepts: ["sprint_planning"], contentKey: "one", createdAt: "2026-09-21T00:00:00.000Z" });
    await cluster();
    const result = await currentness.getCurrentness({ workspaceId: workspaceA, productId: productA, now });
    expect(result.members.filter((member) => member.contributes)).toHaveLength(1);
    expect(result.members.find((member) => !member.contributes)?.reason).toBe("duplicate_content");
  });
});
