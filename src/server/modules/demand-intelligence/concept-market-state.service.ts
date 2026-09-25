import { jsonValueSchema, type Json, type ProductSnapshotRow } from "../../db/database.helpers";
import { deterministicUuid } from "../ingestion/hash";
import { DEMAND_CLUSTERING_VERSION } from "./demand-clustering.policy";
import type { DemandClusteringRepository } from "./demand-clustering.repository";
import { DemandCurrentnessService } from "./demand-currentness.service";
import { buildDemandMap, type DemandMapConcept, type DemandMapResolvedMember } from "./demand-map.policy";
import { buildDemandGapV2 } from "./demand-gap-v2.policy";
import { buildDemandDriftV2Item, computeDriftWindowsForConcepts } from "./demand-drift-v2.policy";
import { planDriftComparison } from "./drift-comparability";
import {
  CONCEPT_DRIFT_STATE_POLICY_VERSION,
  CONCEPT_GAP_STATE_POLICY_VERSION,
  CONCEPT_MARKET_STATE_POLICY_VERSION,
  conceptDriftStateInputFingerprint,
  conceptGapStateInputFingerprint,
  conceptGapStatus,
  conceptMarketStateInputFingerprint,
} from "./concept-market-state.policy";
import type {
  ConceptMarketStateRepository,
  ConceptMarketStateRow,
} from "./concept-market-state.repository";

function json(value: unknown): Json { return jsonValueSchema.parse(value); }

export type ConceptMaterializationEngineVersions = { marketStateEngineVersionId: string; gapEngineVersionId: string; driftEngineVersionId: string };

export type ConceptMaterializationResult = {
  conceptsConsidered: number;
  marketStatesCreated: number;
  gapStatesCreated: number;
  driftStatesCreated: number;
  warnings: string[];
};

const DRIFT_WINDOWS = ["7d", "30d", "90d"] as const;

/**
 * Wanterest Layer 9C materialization. Read-side reuse only: currentness and
 * roll-up come from DemandCurrentnessService/buildDemandMap (Layer 9A/9B),
 * gap math from buildDemandGapV2, drift math from buildDemandDriftV2Item —
 * this service never re-derives any of that, it only decides whether to
 * append a new immutable row. See docs/architecture.md Section 18.
 */
export class ConceptMarketStateService {
  private readonly currentness: DemandCurrentnessService;

  constructor(private readonly repository: ConceptMarketStateRepository, clusteringRepository: DemandClusteringRepository) {
    this.currentness = new DemandCurrentnessService(clusteringRepository);
  }

  /** Shared by materialization and by the live Action-basis validation — one currentness call, one roll-up. */
  async liveConcepts(workspaceId: string, productId: string, now: Date): Promise<DemandMapConcept[]> {
    const result = await this.currentness.getCurrentness({ workspaceId, productId, now });
    const map = buildDemandMap({ clusters: result.clusters, members: result.members, buyerLanguage: [], legacy: null, now, staleBefore: result.staleBefore, statesRead: result.statesRead, statesTruncated: result.statesTruncated });
    return [...map.current, ...map.previouslyObserved];
  }

  /** The live Action-basis fingerprint check (docs/architecture.md Section 18, "Action basis"). Null when the concept no longer rolls up at all. */
  async liveMarketStateFingerprint(workspaceId: string, productId: string, anchorConceptKey: string, now: Date): Promise<string | null> {
    const concepts = await this.liveConcepts(workspaceId, productId, now);
    const concept = concepts.find((item) => item.conceptKey === anchorConceptKey);
    return concept ? conceptMarketStateInputFingerprint(concept) : null;
  }

  private async materializeMarketStates(workspaceId: string, productId: string, concepts: DemandMapConcept[], engineVersionId: string, now: Date): Promise<{ byConcept: Map<string, ConceptMarketStateRow>; createdCount: number }> {
    const byConcept = new Map<string, ConceptMarketStateRow>();
    let createdCount = 0;
    for (const concept of concepts) {
      const fingerprint = conceptMarketStateInputFingerprint(concept);
      const latest = await this.repository.latestMarketState(workspaceId, productId, DEMAND_CLUSTERING_VERSION, concept.identity.anchorConceptKey, CONCEPT_MARKET_STATE_POLICY_VERSION);
      if (latest?.input_fingerprint === fingerprint) { byConcept.set(concept.conceptKey, latest); continue; }
      const members = concept.clusters.flatMap((cluster) => cluster.members);
      const sequence = (latest?.sequence ?? 0) + 1;
      const seed = `stage9c:market:${workspaceId}:${productId}:${concept.identity.anchorConceptKey}:${CONCEPT_MARKET_STATE_POLICY_VERSION}:${sequence}:${fingerprint}`;
      const row = await this.repository.createMarketState({
        id: deterministicUuid(seed), workspace_id: workspaceId, product_id: productId, evidence_node_id: deterministicUuid(`evidence:${seed}`),
        clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: concept.identity.anchorConceptKey,
        concept_market_state_policy_version: CONCEPT_MARKET_STATE_POLICY_VERSION, market_state_engine_version_id: engineVersionId,
        previous_state_id: latest?.id ?? null, sequence, input_fingerprint: fingerprint,
        strength_level: concept.level ?? "inactive", distinct_evidence_count: concept.activeEvidenceCount, distinct_source_count: concept.activeSourceCount,
        contributing_membership_count: members.filter((member) => member.contributes).length, excluded_membership_count: members.filter((member) => !member.contributes).length,
        source_mix: json(concept.sourceMix), intent_family_mix: json(concept.intentFamilyMix), target_scope_mix: json(concept.targetScopeMix), exclusions: json(concept.exclusions),
        first_evidence_at: concept.firstActiveEvidenceAt, last_evidence_at: concept.lastActiveEvidenceAt, computed_at: now.toISOString(),
      });
      createdCount += 1;
      for (const cluster of concept.clusters) {
        if (cluster.persistedState) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: cluster.persistedState.evidenceNodeId, relationType: "derived_from_cluster_state", engineVersionId });
        for (const member of cluster.members) {
          await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: member.evidenceNodeId, relationType: member.contributes ? "strengthened_by" : "excluded_member", weight: member.contributes ? 1 : 0, engineVersionId, measurement: member.contributes ? null : json({ reason: member.reason }) });
        }
      }
      if (latest) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: latest.evidence_node_id, relationType: "supersedes_state", engineVersionId });
      byConcept.set(concept.conceptKey, row);
    }
    return { byConcept, createdCount };
  }

  private async materializeGapStates(workspaceId: string, productId: string, concepts: DemandMapConcept[], marketStatesByConcept: Map<string, ConceptMarketStateRow>, positioning: ProductSnapshotRow, engineVersionId: string, now: Date): Promise<number> {
    const gapModel = buildDemandGapV2({ current: concepts, positioning, now });
    let createdCount = 0;
    for (const item of gapModel.items) {
      const marketState = marketStatesByConcept.get(item.conceptKey);
      if (!marketState) continue;
      const status = conceptGapStatus(item.activeEvidenceCount);
      const fingerprint = conceptGapStateInputFingerprint({ marketStateId: marketState.id, marketStateInputFingerprint: marketState.input_fingerprint, productSnapshotId: positioning.id, productSnapshotContentHash: positioning.content_hash });
      const latest = await this.repository.latestGapState(workspaceId, productId, DEMAND_CLUSTERING_VERSION, item.identity.anchorConceptKey, CONCEPT_GAP_STATE_POLICY_VERSION);
      if (latest?.input_fingerprint === fingerprint) continue;
      const sequence = (latest?.sequence ?? 0) + 1;
      const seed = `stage9c:gap:${workspaceId}:${productId}:${item.identity.anchorConceptKey}:${CONCEPT_GAP_STATE_POLICY_VERSION}:${sequence}:${fingerprint}`;
      const row = await this.repository.createGapState({
        id: deterministicUuid(seed), workspace_id: workspaceId, product_id: productId, evidence_node_id: deterministicUuid(`evidence:${seed}`),
        clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: item.identity.anchorConceptKey,
        gap_state_policy_version: CONCEPT_GAP_STATE_POLICY_VERSION, gap_engine_version_id: engineVersionId,
        market_state_id: marketState.id, product_snapshot_id: positioning.id, previous_state_id: latest?.id ?? null, sequence, input_fingerprint: fingerprint,
        status, share_of_current_demand: item.shareOfCurrentDemand, positioning_weight: item.positioningWeight, high_intent_share: item.highIntentShare,
        sample_quality: item.sampleQuality, gap_score: item.gapScore, computed_at: now.toISOString(),
      });
      createdCount += 1;
      await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: marketState.evidence_node_id, relationType: "derived_from_market_state", engineVersionId });
      await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: positioning.evidence_node_id, relationType: "uses_positioning", engineVersionId });
      if (latest) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: latest.evidence_node_id, relationType: "supersedes_state", engineVersionId });
    }
    return createdCount;
  }

  private async materializeDriftStatesForWindow(workspaceId: string, productId: string, concepts: DemandMapConcept[], marketStatesByConcept: Map<string, ConceptMarketStateRow>, memberById: Map<string, DemandMapResolvedMember>, window: string, monitoringStartedAt: string | null, engineVersionId: string, now: Date): Promise<number> {
    const plan = planDriftComparison({ window, now, monitoringStartedAt });
    const windowsAll = plan.comparable ? computeDriftWindowsForConcepts(concepts, plan) : [];
    const totalCurrent = windowsAll.reduce((sum, row) => sum + row.current.count, 0);
    const totalPrevious = windowsAll.reduce((sum, row) => sum + row.previous.count, 0);
    const byConceptKey = new Map(windowsAll.map((row) => [row.concept.conceptKey, row]));

    let createdCount = 0;
    for (const concept of concepts) {
      const marketState = marketStatesByConcept.get(concept.conceptKey);
      if (!marketState) continue;
      const windowRow = byConceptKey.get(concept.conceptKey);
      const item = plan.comparable && windowRow ? buildDemandDriftV2Item(concept, windowRow.current, windowRow.previous, totalCurrent, totalPrevious) : null;
      const fingerprint = conceptDriftStateInputFingerprint({
        clusteringVersion: DEMAND_CLUSTERING_VERSION, anchorConceptKey: concept.identity.anchorConceptKey, window,
        previousPeriodStart: plan.comparable ? plan.previousPeriodStart : null, previousPeriodEnd: plan.comparable ? plan.previousPeriodEnd : null,
        currentPeriodStart: plan.comparable ? plan.previousPeriodEnd : null, currentPeriodEnd: plan.comparable ? plan.currentPeriodEnd : null,
        monitoringStartedAtBasis: monitoringStartedAt, currentWindowMemberIds: item?.currentWindowMemberIds ?? [], previousWindowMemberIds: item?.previousWindowMemberIds ?? [],
      });
      const latest = await this.repository.latestDriftState(workspaceId, productId, DEMAND_CLUSTERING_VERSION, concept.identity.anchorConceptKey, CONCEPT_DRIFT_STATE_POLICY_VERSION, window);
      if (latest?.input_fingerprint === fingerprint) continue;
      const sequence = (latest?.sequence ?? 0) + 1;
      const seed = `stage9c:drift:${workspaceId}:${productId}:${concept.identity.anchorConceptKey}:${window}:${CONCEPT_DRIFT_STATE_POLICY_VERSION}:${sequence}:${fingerprint}`;
      const row = await this.repository.createDriftState({
        id: deterministicUuid(seed), workspace_id: workspaceId, product_id: productId, evidence_node_id: deterministicUuid(`evidence:${seed}`),
        clustering_version: DEMAND_CLUSTERING_VERSION, anchor_concept_key: concept.identity.anchorConceptKey,
        drift_state_policy_version: CONCEPT_DRIFT_STATE_POLICY_VERSION, comparability_version: "drift_comparability_v1", drift_engine_version_id: engineVersionId,
        window_type: window, market_state_id: marketState.id, previous_state_id: latest?.id ?? null, sequence, input_fingerprint: fingerprint,
        comparable: plan.comparable, comparability_reason: plan.comparable ? null : plan.reason, monitoring_started_at_basis: monitoringStartedAt,
        previous_period_start: plan.comparable ? plan.previousPeriodStart : null, previous_period_end: plan.comparable ? plan.previousPeriodEnd : null,
        current_period_start: plan.comparable ? plan.previousPeriodEnd : null, current_period_end: plan.comparable ? plan.currentPeriodEnd : null,
        current_frozen_evidence_count: item?.currentCount ?? null, previous_frozen_evidence_count: item?.previousCount ?? null,
        current_frozen_source_count: item?.currentSourceCount ?? null, previous_frozen_source_count: item?.previousSourceCount ?? null,
        direction: item?.direction ?? null, significance: item?.significance ?? null, share_delta: item?.shareDelta ?? null, growth_rate: item?.growthRate ?? null,
        computed_at: now.toISOString(),
      });
      createdCount += 1;
      for (const id of item?.currentWindowMemberIds ?? []) { const member = memberById.get(id); if (member) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: member.evidenceNodeId, relationType: "current_window_member", engineVersionId }); }
      for (const id of item?.previousWindowMemberIds ?? []) { const member = memberById.get(id); if (member) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: member.evidenceNodeId, relationType: "previous_window_member", engineVersionId }); }
      await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: marketState.evidence_node_id, relationType: "derived_from_market_state", engineVersionId });
      if (latest) await this.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: latest.evidence_node_id, relationType: "supersedes_state", engineVersionId });
    }
    return createdCount;
  }

  async materializeForProduct(input: { workspaceId: string; productId: string; now: Date; engineVersions: ConceptMaterializationEngineVersions; positioning: ProductSnapshotRow | null; monitoringStartedAt: string | null; windows?: readonly string[] }): Promise<ConceptMaterializationResult> {
    const warnings: string[] = [];
    const concepts = await this.liveConcepts(input.workspaceId, input.productId, input.now);
    const { byConcept: marketStatesByConcept, createdCount: marketStatesCreated } = await this.materializeMarketStates(input.workspaceId, input.productId, concepts, input.engineVersions.marketStateEngineVersionId, input.now);

    let gapStatesCreated = 0;
    if (input.positioning) {
      gapStatesCreated = await this.materializeGapStates(input.workspaceId, input.productId, concepts, marketStatesByConcept, input.positioning, input.engineVersions.gapEngineVersionId, input.now);
    } else {
      warnings.push("Concept gap state materialization was skipped because no positioning snapshot is available.");
    }

    const memberById = new Map(concepts.flatMap((concept) => concept.clusters.flatMap((cluster) => cluster.members)).map((member) => [member.membershipId, member]));
    let driftStatesCreated = 0;
    for (const window of input.windows ?? DRIFT_WINDOWS) {
      driftStatesCreated += await this.materializeDriftStatesForWindow(input.workspaceId, input.productId, concepts, marketStatesByConcept, memberById, window, input.monitoringStartedAt, input.engineVersions.driftEngineVersionId, input.now);
    }

    return { conceptsConsidered: concepts.length, marketStatesCreated, gapStatesCreated, driftStatesCreated, warnings };
  }
}
