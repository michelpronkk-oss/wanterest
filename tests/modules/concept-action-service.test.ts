import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DemandClusteringService, InMemoryDemandClusteringRepository } from "../../src/server/modules/demand-intelligence";
import { InMemoryConceptMarketStateRepository } from "../../src/server/modules/demand-intelligence/concept-market-state.repository";
import { ConceptMarketStateService } from "../../src/server/modules/demand-intelligence/concept-market-state.service";
import { DEMAND_CLUSTERING_VERSION } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import { staleBefore } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import { engineVersionId, now, productA, seedEvidence, workspaceA } from "./demand-clustering.fixtures";
import { InMemoryIntelligenceRepository } from "../../src/server/modules/intelligence/intelligence.repository";
import { InMemoryActionRepository } from "../../src/server/modules/actions/action.repository";
import { DemandActionService } from "../../src/server/modules/actions/action.service";
import { ConceptActionService } from "../../src/server/modules/actions/concept-action.service";
import { legacyActionGenerationPauseReason } from "../../src/server/modules/actions/action.schemas";
import type { ProductRow, ProductSnapshotRow } from "../../src/server/db/database.helpers";

const engineVersions = { marketStateEngineVersionId: "eng-market", gapEngineVersionId: "eng-gap", driftEngineVersionId: "eng-drift" };
const productId = productA;
const product = { id: productId, workspace_id: workspaceA, name: "Linear", current_snapshot_id: "snap-1" } as unknown as ProductRow;

function positioning(id: string, contentHash: string): ProductSnapshotRow {
  return { id, workspace_id: workspaceA, product_id: productId, evidence_node_id: `snapshot-node-${id}`, snapshot_version: 1, source_url: null, page_type: "manual", raw_text: "Linear helps teams plan sprints.", normalized_text: "linear helps teams plan sprints", content_hash: contentHash, metadata: {}, capture_status: "captured", capture_engine_version_id: null, captured_at: "2026-09-01T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" } as unknown as ProductSnapshotRow;
}

/**
 * 24 live, currently-valid, high-intent items across two sources: enough for
 * "normal" sample quality (sampleFactor 0.8), which is what it actually takes
 * to clear actionCandidateIsQualified's existing, unmodified 0.35 gap-score
 * floor once real (imperfect) positioning overlap is factored in.
 */
function seedScoredConcept(clusteringRepository: InMemoryDemandClusteringRepository) {
  for (let index = 0; index < 24; index += 1) seedEvidence(clusteringRepository, { key: `live-${index}`, concepts: ["sprint_planning"], intent: "switching_intent", source: index % 2 ? "github" : "bluesky" });
}

function setup() {
  const clusteringRepository = new InMemoryDemandClusteringRepository();
  const stateRepository = new InMemoryConceptMarketStateRepository();
  const clustering = new DemandClusteringService(clusteringRepository);
  const marketStateService = new ConceptMarketStateService(stateRepository, clusteringRepository);
  const intelligence = new InMemoryIntelligenceRepository();
  const actionRepository = new InMemoryActionRepository();
  const actionService = new DemandActionService(actionRepository, { can: async () => true });
  const conceptActionService = new ConceptActionService(stateRepository, marketStateService, actionService, intelligence);
  // Cluster AFTER the caller seeds evidence — clusterProduct only sees evidence that exists at call time.
  const cluster = () => clustering.clusterProduct({ workspaceId: workspaceA, productId, engineVersionId, now });
  return { clusteringRepository, stateRepository, marketStateService, intelligence, actionRepository, actionService, conceptActionService, cluster };
}

describe("Layer 9C ConceptActionService — Action basis safety", () => {
  it("generates an Action when the live currentness fingerprint and positioning both match the persisted basis", async () => {
    const { clusteringRepository, stateRepository, intelligence, conceptActionService, cluster } = setup();
    seedScoredConcept(clusteringRepository);
    await cluster();
    const snap = positioning("snap-1", "a".repeat(64));
    intelligence.snapshots.set(snap.id, snap);
    const marketStateService = new ConceptMarketStateService(stateRepository, clusteringRepository);
    await marketStateService.materializeForProduct({ workspaceId: workspaceA, productId, now, engineVersions, positioning: snap, monitoringStartedAt: null });

    const result = await conceptActionService.generateEligibleActions({ product, now });
    expect(result.actionsCreated).toBe(1);
    expect(result.attempts).toContainEqual(expect.objectContaining({ triggerType: "concept_gap", outcome: "generated" }));
  });

  it("skips with basis_currentness_mismatch when lifecycle changed after materialization but before the next rebuild", async () => {
    const { clusteringRepository, stateRepository, intelligence, cluster } = setup();
    seedScoredConcept(clusteringRepository);
    await cluster();
    const snap = positioning("snap-1", "a".repeat(64));
    intelligence.snapshots.set(snap.id, snap);
    const marketStateService = new ConceptMarketStateService(stateRepository, clusteringRepository);
    await marketStateService.materializeForProduct({ workspaceId: workspaceA, productId, now, engineVersions, positioning: snap, monitoringStartedAt: null });

    // T2: a signal is invalidated. T3: no rebuild has happened yet — the persisted state is still "latest" but no longer safe.
    const invalidated = [...clusteringRepository.evidence.values()].find((item) => item.evaluation.product_id === productId)!;
    invalidated.signal = { ...invalidated.signal!, lifecycle_status: "invalidated" };

    const actionRepository = new InMemoryActionRepository();
    const actionService = new DemandActionService(actionRepository, { can: async () => true });
    const conceptActionService = new ConceptActionService(stateRepository, marketStateService, actionService, intelligence);
    const result = await conceptActionService.generateEligibleActions({ product, now });
    expect(result.actionsCreated).toBe(0);
    expect(result.attempts).toContainEqual(expect.objectContaining({ triggerType: "concept_gap", outcome: "skipped", reason: "basis_currentness_mismatch" }));
    expect(actionRepository.actions.size).toBe(0);
  });

  it("skips with basis_positioning_mismatch when positioning has moved on since the gap state was materialized", async () => {
    const { clusteringRepository, stateRepository, intelligence, conceptActionService, cluster } = setup();
    seedScoredConcept(clusteringRepository);
    await cluster();
    const snapAtMaterialization = positioning("snap-1", "a".repeat(64));
    intelligence.snapshots.set(snapAtMaterialization.id, snapAtMaterialization);
    const marketStateService = new ConceptMarketStateService(stateRepository, clusteringRepository);
    await marketStateService.materializeForProduct({ workspaceId: workspaceA, productId, now, engineVersions, positioning: snapAtMaterialization, monitoringStartedAt: null });

    // Positioning changed after materialization (product.current_snapshot_id now points elsewhere).
    const newSnap = positioning("snap-2", "b".repeat(64));
    intelligence.snapshots.set(newSnap.id, newSnap);
    const movedProduct = { ...product, current_snapshot_id: "snap-2" } as unknown as ProductRow;

    const result = await conceptActionService.generateEligibleActions({ product: movedProduct, now });
    expect(result.actionsCreated).toBe(0);
    expect(result.attempts).toContainEqual(expect.objectContaining({ triggerType: "concept_gap", outcome: "skipped", reason: "basis_positioning_mismatch" }));
  });

  it("a stale persisted gap basis cannot create an Action even if it is technically still latest", async () => {
    const { stateRepository, marketStateService, intelligence, conceptActionService } = setup();
    const snap = positioning("snap-1", "a".repeat(64));
    intelligence.snapshots.set(snap.id, snap);
    const staleComputedAt = new Date(Date.parse(staleBefore(now)) - 24 * 3_600_000).toISOString(); // one day past the 90-day cutoff
    const marketState = await stateRepository.createMarketState({
      id: "market-stale", workspace_id: workspaceA, product_id: productId, evidence_node_id: "node-market-stale",
      clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: "sprint_planning", concept_market_state_policy_version: "concept_market_state_v1",
      market_state_engine_version_id: engineVersions.marketStateEngineVersionId, previous_state_id: null, sequence: 1, input_fingerprint: "a".repeat(64),
      strength_level: "single", distinct_evidence_count: 5, distinct_source_count: 1, contributing_membership_count: 5, excluded_membership_count: 0,
      source_mix: {}, intent_family_mix: {}, target_scope_mix: {}, exclusions: {}, first_evidence_at: null, last_evidence_at: null, computed_at: staleComputedAt,
    });
    await stateRepository.createGapState({
      id: "gap-stale", workspace_id: workspaceA, product_id: productId, evidence_node_id: "node-gap-stale",
      clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: "sprint_planning", gap_state_policy_version: "concept_gap_state_v1",
      gap_engine_version_id: engineVersions.gapEngineVersionId, market_state_id: marketState.id, product_snapshot_id: snap.id, previous_state_id: null,
      sequence: 1, input_fingerprint: "b".repeat(64), status: "scored", share_of_current_demand: 1, positioning_weight: 0.1, high_intent_share: 1,
      sample_quality: "low_confidence", gap_score: 0.6, computed_at: staleComputedAt,
    });
    void marketStateService;
    const result = await conceptActionService.generateEligibleActions({ product, now });
    expect(result.actionsCreated).toBe(0);
    expect(result.attempts).toContainEqual(expect.objectContaining({ triggerType: "concept_gap", outcome: "skipped", reason: "basis_stale" }));
  });

  it("an older drift state can never create an Action once a newer one exists for the same window — only the latest is ever considered", async () => {
    const { stateRepository, intelligence } = setup();
    const marketState = await stateRepository.createMarketState({
      id: "market-1", workspace_id: workspaceA, product_id: productId, evidence_node_id: "node-market-1",
      clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: "sprint_planning", concept_market_state_policy_version: "concept_market_state_v1",
      market_state_engine_version_id: engineVersions.marketStateEngineVersionId, previous_state_id: null, sequence: 1, input_fingerprint: "z".repeat(64),
      strength_level: "corroborated", distinct_evidence_count: 8, distinct_source_count: 2, contributing_membership_count: 8, excluded_membership_count: 0,
      source_mix: {}, intent_family_mix: {}, target_scope_mix: {}, exclusions: {}, first_evidence_at: null, last_evidence_at: null, computed_at: now.toISOString(),
    });
    const oldRising = await stateRepository.createDriftState({
      id: "drift-old", workspace_id: workspaceA, product_id: productId, evidence_node_id: "node-drift-old",
      clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: "sprint_planning", drift_state_policy_version: "concept_drift_state_v1",
      comparability_version: "drift_comparability_v1", drift_engine_version_id: engineVersions.driftEngineVersionId, window_type: "7d",
      market_state_id: marketState.id, previous_state_id: null, sequence: 1, input_fingerprint: "d1".repeat(32),
      comparable: true, comparability_reason: null, monitoring_started_at_basis: "2026-08-01T00:00:00.000Z",
      previous_period_start: "2026-09-04T00:00:00.000Z", previous_period_end: "2026-09-11T00:00:00.000Z", current_period_start: "2026-09-11T00:00:00.000Z", current_period_end: "2026-09-18T00:00:00.000Z",
      current_frozen_evidence_count: 8, previous_frozen_evidence_count: 5, current_frozen_source_count: 2, previous_frozen_source_count: 1,
      direction: "rising", significance: "strong", share_delta: 0.3, growth_rate: 0.6, computed_at: "2026-09-18T00:00:00.000Z",
    });
    await stateRepository.createDriftState({
      id: "drift-new", workspace_id: workspaceA, product_id: productId, evidence_node_id: "node-drift-new",
      clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: "sprint_planning", drift_state_policy_version: "concept_drift_state_v1",
      comparability_version: "drift_comparability_v1", drift_engine_version_id: engineVersions.driftEngineVersionId, window_type: "7d",
      market_state_id: marketState.id, previous_state_id: oldRising.id, sequence: 2, input_fingerprint: "d2".repeat(32),
      comparable: true, comparability_reason: null, monitoring_started_at_basis: "2026-08-01T00:00:00.000Z",
      previous_period_start: "2026-09-11T00:00:00.000Z", previous_period_end: "2026-09-18T00:00:00.000Z", current_period_start: "2026-09-18T00:00:00.000Z", current_period_end: "2026-09-25T00:00:00.000Z",
      current_frozen_evidence_count: 3, previous_frozen_evidence_count: 8, current_frozen_source_count: 1, previous_frozen_source_count: 2,
      direction: "cooling", significance: "notable", share_delta: -0.2, growth_rate: -0.4, computed_at: now.toISOString(),
    });
    const marketStateService = new ConceptMarketStateService(stateRepository, new InMemoryDemandClusteringRepository());
    const actionRepository = new InMemoryActionRepository();
    const actionService = new DemandActionService(actionRepository, { can: async () => true });
    const conceptActionService = new ConceptActionService(stateRepository, marketStateService, actionService, intelligence);

    const latest = await stateRepository.latestDriftState(workspaceA, productId, DEMAND_CLUSTERING_VERSION, "sprint_planning", "concept_drift_state_v1", "7d");
    expect(latest?.id).toBe("drift-new"); // structurally: only the latest row is ever loaded for eligibility
    const listed = await stateRepository.listLatestDriftStates(workspaceA, productId, DEMAND_CLUSTERING_VERSION, "concept_drift_state_v1", "7d");
    expect(listed.map((row) => row.id)).toEqual(["drift-new"]);

    const result = await conceptActionService.generateEligibleActions({ product, now });
    // drift-new is "cooling", not eligible; drift-old ("rising"/"strong") is never even considered.
    expect(result.actionsCreated).toBe(0);
    expect(result.attempts.some((attempt) => attempt.triggerType === "concept_drift" && attempt.window === "7d")).toBe(false);
  });

  it("a repeated identical basis cannot duplicate an Action (idempotent replay)", async () => {
    const { clusteringRepository, stateRepository, intelligence, conceptActionService, cluster } = setup();
    seedScoredConcept(clusteringRepository);
    await cluster();
    const snap = positioning("snap-1", "a".repeat(64));
    intelligence.snapshots.set(snap.id, snap);
    const marketStateService = new ConceptMarketStateService(stateRepository, clusteringRepository);
    await marketStateService.materializeForProduct({ workspaceId: workspaceA, productId, now, engineVersions, positioning: snap, monitoringStartedAt: null });

    const first = await conceptActionService.generateEligibleActions({ product, now });
    const second = await conceptActionService.generateEligibleActions({ product, now });
    expect(first.actionsCreated).toBe(1);
    expect(second.actionsCreated).toBe(1); // generateActions itself is idempotent: same triggerId => same Action returned, not a new one
    expect(first.attempts[0].actionId).toBe(second.attempts[0].actionId);
  });

  it("plan gating happens before any concept-basis logic — the pure gate function", () => {
    expect(legacyActionGenerationPauseReason(false)).toBeNull();
    expect(legacyActionGenerationPauseReason(true)).toBe("no_lifecycle_verified_basis");
  });

  it("legacy gap/drift/snapshot/geography triggers are structurally unreachable once the concept path is taken", async () => {
    const source = readFileSync("src/server/modules/actions/action.orchestration.ts", "utf8");
    const branchIndex = source.indexOf("return generateConceptActionsForScan(");
    const legacyGapReadIndex = source.indexOf("demand.listGaps(");
    const legacyDriftReadIndex = source.indexOf("selectComparableDrifts(");
    const conceptFnIndex = source.indexOf("async function generateConceptActionsForScan(");
    const conceptFnUsesLegacyCandidates = source.slice(conceptFnIndex).match(/actionInputFromGap\(|actionInputFromDrift\(|actionInputFromSnapshot\(|actionInputFromGeoMarket\(/);
    expect(branchIndex).toBeGreaterThan(0);
    expect(branchIndex).toBeLessThan(legacyGapReadIndex);
    expect(branchIndex).toBeLessThan(legacyDriftReadIndex);
    expect(conceptFnUsesLegacyCandidates).toBeNull();
  });
});
