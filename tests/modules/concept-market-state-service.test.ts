import { describe, expect, it } from "vitest";

import { DemandClusteringService, InMemoryDemandClusteringRepository } from "../../src/server/modules/demand-intelligence";
import { InMemoryConceptMarketStateRepository } from "../../src/server/modules/demand-intelligence/concept-market-state.repository";
import { ConceptMarketStateService } from "../../src/server/modules/demand-intelligence/concept-market-state.service";
import { DEMAND_CLUSTERING_VERSION } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import { driftAnchor } from "../../src/server/modules/demand-intelligence/drift-comparability";
import { engineVersionId, now, productA, productA2, productB, seedEvidence, workspaceA, workspaceB } from "./demand-clustering.fixtures";
import type { ProductSnapshotRow } from "../../src/server/db/database.helpers";

const engineVersions = { marketStateEngineVersionId: "eng-market", gapEngineVersionId: "eng-gap", driftEngineVersionId: "eng-drift" };

function setup() {
  const clusteringRepository = new InMemoryDemandClusteringRepository();
  const stateRepository = new InMemoryConceptMarketStateRepository();
  const clustering = new DemandClusteringService(clusteringRepository);
  const service = new ConceptMarketStateService(stateRepository, clusteringRepository);
  const cluster = (productId = productA, workspaceId = workspaceA, at = now) => clustering.clusterProduct({ workspaceId, productId, engineVersionId, now: at });
  return { clusteringRepository, stateRepository, service, cluster };
}

function snapshot(id: string, contentHash: string, overrides: Partial<ProductSnapshotRow> = {}): ProductSnapshotRow {
  return { id, workspace_id: workspaceA, product_id: productA, evidence_node_id: `snapshot-node-${id}`, snapshot_version: 1, source_url: null, page_type: "manual", raw_text: "Linear helps teams plan sprints and ship software.", normalized_text: "linear helps teams plan sprints and ship software", content_hash: contentHash, metadata: {}, capture_status: "captured", capture_engine_version_id: null, captured_at: "2026-09-01T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z", ...overrides } as unknown as ProductSnapshotRow;
}

describe("Layer 9C ConceptMarketStateService — market state", () => {
  it("Linear-shaped production case: 11 memberships all excluded => 0 contributing, 11 excluded, fully provenanced", async () => {
    const { clusteringRepository, stateRepository, service, cluster } = setup();
    for (let index = 0; index < 10; index += 1) seedEvidence(clusteringRepository, { key: `superseded-${index}`, concepts: ["jira"], intent: index % 2 ? "alternative_search" : "switching_intent", target: "unknown", current: false });
    seedEvidence(clusteringRepository, { key: "invalidated", source: "x", concepts: ["jira"], intent: "switching_intent", target: "unknown", signalStatus: "invalidated" });
    await cluster();

    const result = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt: null });
    expect(result).toMatchObject({ conceptsConsidered: 1, marketStatesCreated: 1, gapStatesCreated: 0, driftStatesCreated: 3 });
    expect(result.warnings).toContain("Concept gap state materialization was skipped because no positioning snapshot is available.");

    const [marketState] = [...stateRepository.marketStates.values()];
    expect(marketState).toMatchObject({
      workspace_id: workspaceA, product_id: productA, clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: "jira",
      strength_level: "inactive", distinct_evidence_count: 0, contributing_membership_count: 0, excluded_membership_count: 11, sequence: 1, previous_state_id: null,
    });
    expect(marketState.exclusions).toEqual({ evaluation_superseded: 10, signal_invalidated: 1 });

    const edgesFrom = stateRepository.provenance.filter((edge) => edge.derivedEvidenceNodeId === marketState.evidence_node_id);
    const byRelation = (relation: string) => edgesFrom.filter((edge) => edge.relationType === relation);
    expect(byRelation("derived_from_cluster_state")).toHaveLength(1);
    expect(byRelation("strengthened_by")).toHaveLength(0);
    expect(byRelation("excluded_member")).toHaveLength(11);
    // Every excluded edge resolves to a real membership evidence node with its reason recorded.
    const realMembershipNodes = new Set([...clusteringRepository.memberships.values()].map((row) => row.evidence_node_id));
    for (const edge of byRelation("excluded_member")) {
      expect(realMembershipNodes.has(edge.sourceEvidenceNodeId)).toBe(true);
      expect(edge.measurement).toMatchObject({ reason: expect.stringMatching(/evaluation_superseded|signal_invalidated/) });
    }
    expect(byRelation("derived_from_cluster_state")[0] && realClusterStateNode(clusteringRepository, edgesFrom)).toBe(true);
  });

  it("clustering_version namespaces histories: two versions never share one concept's sequence", async () => {
    const { stateRepository } = setup();
    const rowV1 = await stateRepository.createMarketState(marketStateInsert({ clustering_version: "demand_clustering_v1", sequence: 1 }));
    const rowV2 = await stateRepository.createMarketState(marketStateInsert({ clustering_version: "demand_clustering_v2", sequence: 1 }));
    expect(rowV1.id).not.toBe(rowV2.id);
    expect(await stateRepository.latestMarketState(workspaceA, productA, "demand_clustering_v1", "jira", "concept_market_state_v1")).toMatchObject({ clustering_version: "demand_clustering_v1", sequence: 1 });
    expect(await stateRepository.latestMarketState(workspaceA, productA, "demand_clustering_v2", "jira", "concept_market_state_v1")).toMatchObject({ clustering_version: "demand_clustering_v2", sequence: 1 });
  });

  it("replay with unchanged evidence appends nothing; a lifecycle change appends the next sequence without mutating the old row", async () => {
    const { clusteringRepository, stateRepository, service, cluster } = setup();
    const evidence = seedEvidence(clusteringRepository, { key: "gh", concepts: ["sprint_planning"], source: "github" });
    seedEvidence(clusteringRepository, { key: "bs", concepts: ["sprint_planning"], source: "bluesky" });
    await cluster();

    const first = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt: null });
    expect(first.marketStatesCreated).toBe(1);
    const firstRow = { ...[...stateRepository.marketStates.values()][0] };
    expect(firstRow).toMatchObject({ sequence: 1, distinct_evidence_count: 2, contributing_membership_count: 2 });

    const replay = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt: null });
    expect(replay.marketStatesCreated).toBe(0);
    expect(stateRepository.marketStates.size).toBe(1);

    evidence.signal = { ...evidence.signal!, lifecycle_status: "invalidated" };
    const afterLifecycleChange = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt: null });
    expect(afterLifecycleChange.marketStatesCreated).toBe(1);
    expect(stateRepository.marketStates.size).toBe(2);
    const secondRow = [...stateRepository.marketStates.values()].find((row) => row.sequence === 2)!;
    expect(secondRow).toMatchObject({ previous_state_id: firstRow.id, distinct_evidence_count: 1, contributing_membership_count: 1, excluded_membership_count: 1 });
    // The original row is untouched.
    expect(stateRepository.marketStates.get(firstRow.id)).toEqual(firstRow);
  });

  it("never leaks another product's or workspace's evidence into a concept's market state", async () => {
    const { clusteringRepository, stateRepository, service, cluster } = setup();
    seedEvidence(clusteringRepository, { key: "a", productId: productA, concepts: ["sprint_planning"] });
    seedEvidence(clusteringRepository, { key: "a2", productId: productA2, concepts: ["roadmap_visibility"] });
    seedEvidence(clusteringRepository, { key: "b", workspaceId: workspaceB, productId: productB, concepts: ["billing"] });
    await cluster(productA); await cluster(productA2); await cluster(productB, workspaceB);
    await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt: null });
    await service.materializeForProduct({ workspaceId: workspaceA, productId: productA2, now, engineVersions, positioning: null, monitoringStartedAt: null });
    await service.materializeForProduct({ workspaceId: workspaceB, productId: productB, now, engineVersions, positioning: null, monitoringStartedAt: null });
    const rows = [...stateRepository.marketStates.values()];
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.product_id === productA)?.anchor_concept_key).toBe("sprint_planning");
    expect(rows.find((row) => row.product_id === productA2)?.anchor_concept_key).toBe("roadmap_visibility");
    expect(rows.find((row) => row.product_id === productB)?.workspace_id).toBe(workspaceB);
  });

  it("rejects a gap/drift state forged to reference another product's market state (composite-FK tenancy)", async () => {
    const { stateRepository } = setup();
    const marketState = await stateRepository.createMarketState(marketStateInsert({}));
    await expect(stateRepository.createGapState({
      id: "forged-gap", workspace_id: workspaceA, product_id: productA2, evidence_node_id: "node-forged-gap",
      clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: "jira", gap_state_policy_version: "concept_gap_state_v1",
      gap_engine_version_id: engineVersions.gapEngineVersionId, market_state_id: marketState.id, product_snapshot_id: "snap-x", previous_state_id: null,
      sequence: 1, input_fingerprint: "c".repeat(64), status: "no_current_demand", share_of_current_demand: 0, positioning_weight: 0, high_intent_share: 0,
      sample_quality: "insufficient_data", gap_score: null, computed_at: now.toISOString(),
    })).rejects.toThrow(/foreign key/);
    await expect(stateRepository.createDriftState({
      id: "forged-drift", workspace_id: workspaceB, product_id: productB, evidence_node_id: "node-forged-drift",
      clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: "jira", drift_state_policy_version: "concept_drift_state_v1",
      comparability_version: "drift_comparability_v1", drift_engine_version_id: engineVersions.driftEngineVersionId, window_type: "7d",
      market_state_id: marketState.id, previous_state_id: null, sequence: 1, input_fingerprint: "d".repeat(64),
      comparable: false, comparability_reason: "insufficient_history", monitoring_started_at_basis: null,
      previous_period_start: null, previous_period_end: null, current_period_start: null, current_period_end: null,
      current_frozen_evidence_count: null, previous_frozen_evidence_count: null, current_frozen_source_count: null, previous_frozen_source_count: null,
      direction: null, significance: null, share_delta: null, growth_rate: null, computed_at: now.toISOString(),
    })).rejects.toThrow(/foreign key/);
  });
});

describe("Layer 9C ConceptMarketStateService — gap state", () => {
  it("persists no_current_demand, directional and scored statuses as evidence count crosses the thresholds", async () => {
    const { clusteringRepository, stateRepository, service, cluster } = setup();
    for (let index = 0; index < 10; index += 1) seedEvidence(clusteringRepository, { key: `x-${index}`, concepts: ["jira"], current: false });
    await cluster();
    const positioning = snapshot("s1", "h1".repeat(32));
    const result = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning, monitoringStartedAt: null });
    expect(result.gapStatesCreated).toBe(1);
    expect([...stateRepository.gapStates.values()][0]).toMatchObject({ status: "no_current_demand", gap_score: null });
  });

  it("freezes the positioning snapshot: a later positioning change produces a new gap state without touching the old one", async () => {
    const { clusteringRepository, stateRepository, service, cluster } = setup();
    for (let index = 0; index < 6; index += 1) seedEvidence(clusteringRepository, { key: `live-${index}`, concepts: ["sprint_planning"], intent: "switching_intent", source: index % 2 ? "github" : "bluesky" });
    await cluster();
    const positioningA = snapshot("s1", "a".repeat(64));
    const first = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: positioningA, monitoringStartedAt: null });
    expect(first.gapStatesCreated).toBe(1);
    const firstGap = { ...[...stateRepository.gapStates.values()][0] };
    expect(firstGap).toMatchObject({ status: "scored", product_snapshot_id: "s1", sequence: 1 });
    expect(firstGap.gap_score).not.toBeNull();

    const replay = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: positioningA, monitoringStartedAt: null });
    expect(replay.gapStatesCreated).toBe(0);

    const positioningB = snapshot("s2", "b".repeat(64), { raw_text: "Completely different homepage copy about billing." , normalized_text: "completely different homepage copy about billing"});
    const afterPositioningChange = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: positioningB, monitoringStartedAt: null });
    expect(afterPositioningChange.gapStatesCreated).toBe(1);
    const secondGap = [...stateRepository.gapStates.values()].find((row) => row.sequence === 2)!;
    expect(secondGap).toMatchObject({ product_snapshot_id: "s2", previous_state_id: firstGap.id });
    expect(stateRepository.gapStates.get(firstGap.id)).toEqual(firstGap);
    const edgesToPositioning = stateRepository.provenance.filter((edge) => edge.derivedEvidenceNodeId === secondGap.evidence_node_id && edge.relationType === "uses_positioning");
    expect(edgesToPositioning[0]?.sourceEvidenceNodeId).toBe(positioningB.evidence_node_id);
  });

  it("is skipped (with a warning, no row) when no positioning snapshot exists — never a fabricated basis", async () => {
    const { clusteringRepository, stateRepository, service, cluster } = setup();
    seedEvidence(clusteringRepository, { key: "a", concepts: ["sprint_planning"] });
    await cluster();
    const result = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt: null });
    expect(result.gapStatesCreated).toBe(0);
    expect(stateRepository.gapStates.size).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("Layer 9C ConceptMarketStateService — drift state", () => {
  function memberSeed(prefix: string, count: number, endIso: string, hoursBeforeEnd = 4) {
    const endMs = Date.parse(endIso);
    return Array.from({ length: count }, (_, index) => ({ key: `${prefix}${index}`, publishedAt: new Date(endMs - (hoursBeforeEnd + index) * 3_600_000).toISOString() }));
  }

  it("persists a non-comparable result (checked, not yet comparable) rather than omitting a row", async () => {
    const { clusteringRepository, stateRepository, service, cluster } = setup();
    seedEvidence(clusteringRepository, { key: "a", concepts: ["sprint_planning"] });
    await cluster();
    const result = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt: null });
    expect(result.driftStatesCreated).toBe(3);
    const rows = [...stateRepository.driftStates.values()];
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toMatchObject({ comparable: false, comparability_reason: "insufficient_history", current_period_start: null, direction: null });
  });

  it("freezes exact adjacent, non-overlapping period boundaries and the frozen membership sets/counts when comparable", async () => {
    const { clusteringRepository, stateRepository, service, cluster } = setup();
    const anchor = driftAnchor(now);
    for (const seed of memberSeed("c", 8, anchor)) seedEvidence(clusteringRepository, { key: seed.key, concepts: ["sprint_planning"], publishedAt: seed.publishedAt });
    const previousEnd = new Date(Date.parse(anchor) - 7 * 86_400_000).toISOString();
    for (const seed of memberSeed("p", 5, previousEnd)) seedEvidence(clusteringRepository, { key: seed.key, concepts: ["sprint_planning"], publishedAt: seed.publishedAt, createdAt: "2026-09-10T00:00:00.000Z" });
    await cluster();

    const monitoringStartedAt = "2026-08-01T00:00:00.000Z";
    const result = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt, windows: ["7d"] });
    expect(result.driftStatesCreated).toBe(1);
    const [drift] = [...stateRepository.driftStates.values()];
    expect(drift).toMatchObject({ comparable: true, window_type: "7d", direction: "rising", current_frozen_evidence_count: 8, previous_frozen_evidence_count: 5, monitoring_started_at_basis: monitoringStartedAt });
    expect(drift.current_period_end).toBe(anchor);
    expect(drift.previous_period_end).toBe(drift.current_period_start); // adjacent, non-overlapping
    expect(new Date(drift.previous_period_start!).getTime()).toBeLessThan(new Date(drift.previous_period_end!).getTime());

    const currentEdges = stateRepository.provenance.filter((edge) => edge.derivedEvidenceNodeId === drift.evidence_node_id && edge.relationType === "current_window_member");
    const previousEdges = stateRepository.provenance.filter((edge) => edge.derivedEvidenceNodeId === drift.evidence_node_id && edge.relationType === "previous_window_member");
    expect(currentEdges).toHaveLength(8);
    expect(previousEdges).toHaveLength(5);
  });

  it("same-day replay with unchanged evidence appends nothing; a later invalidation never rewrites the old drift state, only appends a new one", async () => {
    const { clusteringRepository, stateRepository, service, cluster } = setup();
    const anchor = driftAnchor(now);
    const currentMembers = [];
    for (const seed of memberSeed("c", 8, anchor)) currentMembers.push(seedEvidence(clusteringRepository, { key: seed.key, concepts: ["sprint_planning"], publishedAt: seed.publishedAt }));
    const previousEnd = new Date(Date.parse(anchor) - 7 * 86_400_000).toISOString();
    for (const seed of memberSeed("p", 5, previousEnd)) seedEvidence(clusteringRepository, { key: seed.key, concepts: ["sprint_planning"], publishedAt: seed.publishedAt, createdAt: "2026-09-10T00:00:00.000Z" });
    await cluster();
    const monitoringStartedAt = "2026-08-01T00:00:00.000Z";
    await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt, windows: ["7d"] });
    const firstDrift = { ...[...stateRepository.driftStates.values()][0] };

    const replay = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt, windows: ["7d"] });
    expect(replay.driftStatesCreated).toBe(0);
    expect(stateRepository.driftStates.size).toBe(1);

    currentMembers[0].signal = { ...currentMembers[0].signal!, lifecycle_status: "invalidated" };
    const afterInvalidation = await service.materializeForProduct({ workspaceId: workspaceA, productId: productA, now, engineVersions, positioning: null, monitoringStartedAt, windows: ["7d"] });
    expect(afterInvalidation.driftStatesCreated).toBe(1);
    expect(stateRepository.driftStates.size).toBe(2);
    const secondDrift = [...stateRepository.driftStates.values()].find((row) => row.sequence === 2)!;
    expect(secondDrift).toMatchObject({ previous_state_id: firstDrift.id, current_frozen_evidence_count: 7 });
    expect(stateRepository.driftStates.get(firstDrift.id)).toEqual(firstDrift);
  });
});

function marketStateInsert(overrides: Partial<Parameters<InMemoryConceptMarketStateRepository["createMarketState"]>[0]>) {
  const clusteringVersion = overrides.clustering_version ?? DEMAND_CLUSTERING_VERSION;
  return {
    id: `market-${clusteringVersion}`, workspace_id: workspaceA, product_id: productA, evidence_node_id: `node-market-${clusteringVersion}`,
    clustering_version: clusteringVersion, anchor_concept_key: "jira", concept_market_state_policy_version: "concept_market_state_v1",
    market_state_engine_version_id: engineVersions.marketStateEngineVersionId, previous_state_id: null, sequence: 1,
    input_fingerprint: "a".repeat(64), strength_level: "inactive" as const, distinct_evidence_count: 0, distinct_source_count: 0,
    contributing_membership_count: 0, excluded_membership_count: 0, source_mix: {}, intent_family_mix: {}, target_scope_mix: {}, exclusions: {},
    first_evidence_at: null, last_evidence_at: null, computed_at: now.toISOString(),
    ...overrides,
  };
}

function realClusterStateNode(repository: InMemoryDemandClusteringRepository, edges: Array<{ relationType: string; sourceEvidenceNodeId: string }>): boolean {
  const clusterStateNodes = new Set([...repository.states.values()].map((row) => row.evidence_node_id));
  const edge = edges.find((item) => item.relationType === "derived_from_cluster_state");
  return Boolean(edge && clusterStateNodes.has(edge.sourceEvidenceNodeId));
}
