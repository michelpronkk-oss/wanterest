import { describe, expect, it } from "vitest";

import { DemandClusteringService, DownstreamIntelligenceService, InMemoryDemandClusteringRepository } from "../../src/server/modules/demand-intelligence";
import { InMemoryDemandRepository } from "../../src/server/modules/demand-intelligence/demand.repository";
import { engineVersionId, now, productA, productA2, productB, seedEvidence, workspaceA, workspaceB } from "./demand-clustering.fixtures";
import type { DemandSnapshotRow, ProductSnapshotRow } from "../../src/server/db/database.helpers";

function setup() {
  const clusteringRepository = new InMemoryDemandClusteringRepository();
  const demandRepository = new InMemoryDemandRepository();
  const clustering = new DemandClusteringService(clusteringRepository);
  const service = new DownstreamIntelligenceService(clusteringRepository, demandRepository);
  const cluster = (productId = productA, workspaceId = workspaceA, at = now) => clustering.clusterProduct({ workspaceId, productId, engineVersionId, now: at });
  const seedMonitoringHistory = (workspaceId = workspaceA, productId = productA, since = "2026-06-01T00:00:00.000Z") =>
    demandRepository.snapshots.set("monitoring-marker", { id: "monitoring-marker", workspace_id: workspaceId, product_id: productId, created_at: since, period_end: since } as unknown as DemandSnapshotRow);
  return { clusteringRepository, demandRepository, service, cluster, seedMonitoringHistory };
}

describe("Layer 9B DownstreamIntelligenceService — Linear-shaped 0-current fixture", () => {
  it("production-shaped case: 11 memberships all excluded => no current gap, no current drift", async () => {
    const { clusteringRepository, service, cluster, seedMonitoringHistory } = setup();
    for (let index = 0; index < 10; index += 1) {
      seedEvidence(clusteringRepository, { key: `superseded-${index}`, concepts: ["jira"], intent: index % 2 ? "alternative_search" : "switching_intent", target: "unknown", current: false });
    }
    seedEvidence(clusteringRepository, { key: "invalidated", source: "x", concepts: ["jira"], intent: "switching_intent", target: "unknown", signalStatus: "invalidated" });
    await cluster();
    seedMonitoringHistory();

    const gap = await service.getDemandGapV2({ workspaceId: workspaceA, productId: productA, positioning: null, now });
    expect(gap).toMatchObject({ hasCurrentEvidence: false, items: [] });

    const drift = await service.getDemandDriftV2({ workspaceId: workspaceA, productId: productA, window: "7d", now });
    expect(drift.comparable).toBe(true);
    expect(drift.rising).toEqual([]);
    expect(drift.cooling).toEqual([]);

    const combined = await service.getDownstreamIntelligence({ workspaceId: workspaceA, productId: productA, positioning: null, window: "7d", now });
    expect(combined.gap.hasCurrentEvidence).toBe(false);
    expect(combined.drift.rising).toEqual([]);
  });

  it("reports no comparable movement (not fabricated 'insufficient_history') when no monitoring-history marker exists yet", async () => {
    const { clusteringRepository, service, cluster } = setup();
    seedEvidence(clusteringRepository, { key: "one", concepts: ["sprint_planning"] });
    await cluster();
    const drift = await service.getDemandDriftV2({ workspaceId: workspaceA, productId: productA, window: "7d", now });
    expect(drift).toMatchObject({ comparable: false, reason: "insufficient_history" });
  });

  it("scores a gap once there is real current evidence", async () => {
    const { clusteringRepository, service, cluster } = setup();
    for (let index = 0; index < 6; index += 1) {
      seedEvidence(clusteringRepository, { key: `live-${index}`, concepts: ["sprint_planning"], intent: "switching_intent", source: index % 2 ? "github" : "bluesky", publishedAt: "2026-09-20T00:00:00.000Z" });
    }
    await cluster();
    const positioning = { normalized_text: "", raw_text: "", page_type: "manual" } as unknown as ProductSnapshotRow;
    const gap = await service.getDemandGapV2({ workspaceId: workspaceA, productId: productA, positioning, now });
    expect(gap.hasCurrentEvidence).toBe(true);
    expect(gap.items[0]).toMatchObject({ scored: true, activeEvidenceCount: 6 });
  });

  it("shares one currentness read across getDownstreamIntelligence's gap and drift (no duplicated batched read)", async () => {
    const { clusteringRepository, service, cluster, seedMonitoringHistory } = setup();
    seedEvidence(clusteringRepository, { key: "one", concepts: ["sprint_planning"] });
    await cluster();
    seedMonitoringHistory();
    for (const key of Object.keys(clusteringRepository.calls)) delete clusteringRepository.calls[key];
    await service.getDownstreamIntelligence({ workspaceId: workspaceA, productId: productA, positioning: null, window: "7d", now });
    expect(clusteringRepository.calls).toEqual({ listLatestStates: 1, listStateContributionsForStates: 1, loadMatchLifecycle: 1 });
  });

  it("never leaks another product's or workspace's evidence into gap or drift", async () => {
    const { clusteringRepository, service, cluster } = setup();
    seedEvidence(clusteringRepository, { key: "a", productId: productA, concepts: ["sprint_planning"] });
    seedEvidence(clusteringRepository, { key: "a2", productId: productA2, concepts: ["roadmap_visibility"] });
    seedEvidence(clusteringRepository, { key: "b", workspaceId: workspaceB, productId: productB, concepts: ["billing"] });
    await cluster(productA);
    await cluster(productA2);
    await cluster(productB, workspaceB);
    const gapA = await service.getDemandGapV2({ workspaceId: workspaceA, productId: productA, positioning: null, now });
    const gapCross = await service.getDemandGapV2({ workspaceId: workspaceB, productId: productA, positioning: null, now });
    expect(gapA.items.every((item) => item.conceptKey === "sprint_planning")).toBe(true);
    expect(gapCross.items).toEqual([]);
  });
});
