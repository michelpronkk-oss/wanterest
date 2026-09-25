import { jsonValueSchema, type Json } from "../../db/database.helpers";
import { deterministicUuid } from "../ingestion/hash";
import { canMaterializeQualifiedSignal, qualificationFromEvidence } from "../intelligence/signal-qualification.service";
import {
  computeDemandClusterStrength,
  DEMAND_CLUSTER_STRENGTH_VERSION,
  DEMAND_CLUSTERING_MAX_EVALUATIONS,
  DEMAND_CLUSTERING_VERSION,
  demandClusterIdempotencyKeys,
  demandClusterIdentity,
  explainDemandCluster,
  type DemandClusterExclusionReason,
  type DemandClusterIntentFamily,
  type DemandClusterMemberEvidence,
  type DemandClusterStrengthLevel,
  type DemandClusterTargetScope,
} from "./demand-clustering.policy";
import type { DemandClusteringEvidence, DemandClusteringRepository, DemandClusterMembershipRow, DemandClusterRow, DemandClusterStateContribution, DemandClusterStateRow } from "./demand-clustering.repository";

function json(value: unknown): Json { return jsonValueSchema.parse(value); }
function numberRecord(value: Json): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

export type DemandClusteringRunResult = {
  clusteringVersion: typeof DEMAND_CLUSTERING_VERSION;
  strengthVersion: typeof DEMAND_CLUSTER_STRENGTH_VERSION;
  evaluationsConsidered: number;
  clustersCreated: number;
  membershipsCreated: number;
  statesAppended: number;
  unclustered: Record<string, number>;
};

export type DemandClusterReadModel = {
  clusterId: string;
  clusterKey: string;
  label: string;
  anchorConceptKey: string;
  intentFamily: DemandClusterIntentFamily;
  targetScope: DemandClusterTargetScope;
  clusteringVersion: string;
  createdAt: string;
  explanation: string;
  evidenceNodeId: string;
  strength: {
    version: string;
    sequence: number;
    level: DemandClusterStrengthLevel;
    score: number;
    distinctEvidenceCount: number;
    distinctSourceCount: number;
    averageDemandQuality: number;
    averageConfidence: number;
    components: Json;
    sourceMix: Record<string, number>;
    intentMix: Record<string, number>;
    alternativeMix: Record<string, number>;
    lifecycleMix: Record<string, number>;
    exclusions: Record<string, number>;
    firstEvidenceAt: string | null;
    lastEvidenceAt: string | null;
    computedAt: string;
    stateEvidenceNodeId: string;
    historyLength: number;
  } | null;
  members: Array<{
    membershipId: string;
    matchEvaluationId: string;
    conversationId: string;
    sourceKey: string;
    evidenceAt: string;
    contributes: boolean;
    exclusionReason: DemandClusterExclusionReason | null;
    evidenceNodeId: string;
  }>;
};

function evidenceTime(item: DemandClusteringEvidence): string {
  return item.sourceItem?.published_at ?? item.conversation?.published_at ?? item.conversation?.last_activity_at ?? item.evaluation.created_at;
}

/**
 * Stage 2G application service. Product-private: every call is scoped by the
 * caller's (workspaceId, productId); evidence that is not a qualified
 * evaluation of that product is never clustered.
 */
export class DemandClusteringService {
  constructor(private readonly repository: DemandClusteringRepository) {}

  async clusterProduct(input: { workspaceId: string; productId: string; engineVersionId: string; now?: Date; maxEvaluations?: number }): Promise<DemandClusteringRunResult> {
    const now = input.now ?? new Date();
    const { workspaceId, productId, engineVersionId } = input;
    const result: DemandClusteringRunResult = { clusteringVersion: DEMAND_CLUSTERING_VERSION, strengthVersion: DEMAND_CLUSTER_STRENGTH_VERSION, evaluationsConsidered: 0, clustersCreated: 0, membershipsCreated: 0, statesAppended: 0, unclustered: {} };
    const qualified = await this.repository.listQualifiedEvidence(workspaceId, productId, Math.min(input.maxEvaluations ?? DEMAND_CLUSTERING_MAX_EVALUATIONS, DEMAND_CLUSTERING_MAX_EVALUATIONS));
    result.evaluationsConsidered = qualified.length;

    const clusters = new Map((await this.repository.listClusters(workspaceId, productId, DEMAND_CLUSTERING_VERSION)).map((row) => [row.cluster_key, row]));
    const memberships = await this.repository.listMemberships(workspaceId, productId, DEMAND_CLUSTERING_VERSION);
    const memberedEvaluations = new Set(memberships.map((row) => row.match_evaluation_id));

    // Oldest first so cluster creation order is stable across runs.
    for (const item of [...qualified].sort((left, right) => left.evaluation.created_at.localeCompare(right.evaluation.created_at) || left.evaluation.id.localeCompare(right.evaluation.id))) {
      if (item.evaluation.workspace_id !== workspaceId || item.evaluation.product_id !== productId) continue;
      if (memberedEvaluations.has(item.evaluation.id)) continue;
      const qualification = qualificationFromEvidence(item.evaluation.evidence);
      const identityResult = demandClusterIdentity(qualification, item.evaluation.decision === "qualified" && canMaterializeQualifiedSignal(qualification));
      if (!identityResult.clusterable) { result.unclustered[identityResult.reason] = (result.unclustered[identityResult.reason] ?? 0) + 1; continue; }
      if (!item.conversation || !item.sourceItem) { result.unclustered.evidence_unavailable = (result.unclustered.evidence_unavailable ?? 0) + 1; continue; }
      const { identity } = identityResult;
      let cluster = clusters.get(identity.clusterKey);
      if (!cluster) {
        const key = demandClusterIdempotencyKeys({ workspaceId, productId, clusterKey: identity.clusterKey }).cluster;
        const id = deterministicUuid(key);
        cluster = await this.repository.createCluster({
          id, workspace_id: workspaceId, product_id: productId, evidence_node_id: deterministicUuid(`evidence:${key}`),
          clustering_version: DEMAND_CLUSTERING_VERSION, clustering_engine_version_id: engineVersionId, cluster_key: identity.clusterKey,
          anchor_concept_key: identity.anchorConceptKey, intent_family: identity.intentFamily, target_scope: identity.targetScope, label: identity.label,
          identity: json({ rule: identity.assignment.rule, anchorConceptKey: identity.anchorConceptKey, intentFamily: identity.intentFamily, targetScope: identity.targetScope }),
        });
        if (cluster.id === id) result.clustersCreated += 1;
        clusters.set(identity.clusterKey, cluster);
      }
      const membershipKey = demandClusterIdempotencyKeys({ workspaceId, productId, clusterKey: identity.clusterKey, matchEvaluationId: item.evaluation.id }).membership as string;
      const membershipId = deterministicUuid(membershipKey);
      const membership = await this.repository.createMembership({
        id: membershipId, workspace_id: workspaceId, product_id: productId, cluster_id: cluster.id, match_evaluation_id: item.evaluation.id,
        product_match_id: item.evaluation.product_match_id, conversation_id: item.evaluation.conversation_id, evidence_node_id: deterministicUuid(`evidence:${membershipKey}`),
        clustering_version: DEMAND_CLUSTERING_VERSION, clustering_engine_version_id: engineVersionId, source_key: item.sourceItem.source_key,
        evidence_at: evidenceTime(item), confidence: qualification?.confidence ?? 0, assignment: json(identity.assignment),
      });
      if (membership.id === membershipId) result.membershipsCreated += 1;
      memberships.push(membership);
      memberedEvaluations.add(item.evaluation.id);
      const edges = [
        { id: cluster.evidence_node_id, relation: "assigned_to_cluster" },
        { id: item.evaluation.evidence_node_id, relation: "clusters_match_evaluation" },
        { id: item.conversation.evidence_node_id, relation: "clusters_conversation" },
        { id: item.sourceItem.evidence_node_id, relation: "clusters_source_item" },
        item.signal ? { id: item.signal.evidence_node_id, relation: "clusters_signal" } : null,
      ];
      for (const edge of edges) if (edge) await this.repository.linkProvenance({ derivedEvidenceNodeId: membership.evidence_node_id, sourceEvidenceNodeId: edge.id, relationType: edge.relation, ordinal: 0, weight: membership.confidence, engineVersionId, measurement: json({ clusteringVersion: DEMAND_CLUSTERING_VERSION, clusterKey: identity.clusterKey }) });
    }

    // Recompute strength for every cluster from current evidence validity.
    const evidenceById = new Map<string, DemandClusteringEvidence>(qualified.map((item) => [item.evaluation.id, item]));
    const missing = memberships.map((row) => row.match_evaluation_id).filter((id) => !evidenceById.has(id));
    for (const item of await this.repository.loadEvidence(workspaceId, productId, missing)) evidenceById.set(item.evaluation.id, item);
    const byCluster = new Map<string, DemandClusterMembershipRow[]>();
    for (const row of memberships) byCluster.set(row.cluster_id, [...(byCluster.get(row.cluster_id) ?? []), row]);
    for (const cluster of [...clusters.values()].sort((left, right) => left.cluster_key.localeCompare(right.cluster_key))) {
      const members = byCluster.get(cluster.id) ?? [];
      if (await this.appendState(cluster, members, evidenceById, engineVersionId, now)) result.statesAppended += 1;
    }
    return result;
  }

  private memberEvidence(row: DemandClusterMembershipRow, item: DemandClusteringEvidence | undefined): DemandClusterMemberEvidence {
    const qualification = item ? qualificationFromEvidence(item.evaluation.evidence) : null;
    return {
      membershipId: row.id,
      matchEvaluationId: row.match_evaluation_id,
      conversationId: row.conversation_id,
      sourceKey: row.source_key,
      evidenceAt: row.evidence_at,
      available: Boolean(item && item.conversation && item.sourceItem && qualification),
      isCurrentEvaluation: Boolean(item && item.currentEvaluationId === row.match_evaluation_id),
      signalLifecycleStatus: item?.signal?.lifecycle_status ?? null,
      contentHash: item?.sourceItem?.content_hash ?? null,
      demandQuality: qualification?.demand_quality_score ?? 0,
      confidence: qualification?.confidence ?? 0,
      primaryIntent: qualification?.primary_intent ?? "unknown",
      sourceProducts: qualification?.source_products ?? [],
      createdAt: row.created_at,
    };
  }

  private async appendState(cluster: DemandClusterRow, members: DemandClusterMembershipRow[], evidenceById: Map<string, DemandClusteringEvidence>, engineVersionId: string, now: Date): Promise<boolean> {
    const strength = computeDemandClusterStrength(members.map((row) => this.memberEvidence(row, evidenceById.get(row.match_evaluation_id))), now);
    const latest = await this.repository.latestState(cluster.workspace_id, cluster.product_id, cluster.id, DEMAND_CLUSTER_STRENGTH_VERSION);
    if (latest?.input_fingerprint === strength.inputFingerprint) return false;
    const sequence = (latest?.sequence ?? 0) + 1;
    const seed = `stage2g:state:${cluster.id}:${DEMAND_CLUSTER_STRENGTH_VERSION}:${sequence}:${strength.inputFingerprint}`;
    const state = await this.repository.createState({
      id: deterministicUuid(seed), workspace_id: cluster.workspace_id, product_id: cluster.product_id, cluster_id: cluster.id, previous_state_id: latest?.id ?? null,
      evidence_node_id: deterministicUuid(`evidence:${seed}`), strength_version: DEMAND_CLUSTER_STRENGTH_VERSION, clustering_engine_version_id: engineVersionId,
      sequence, input_fingerprint: strength.inputFingerprint, strength_level: strength.level, strength_score: strength.score,
      distinct_evidence_count: strength.distinctEvidenceCount, distinct_source_count: strength.distinctSourceCount,
      contributing_membership_count: strength.contributingMembershipCount, excluded_membership_count: strength.excludedMembershipCount,
      average_demand_quality: strength.averageDemandQuality, average_confidence: strength.averageConfidence, components: json(strength.components),
      source_mix: json(strength.sourceMix), intent_mix: json(strength.intentMix), alternative_mix: json(strength.alternativeMix),
      lifecycle_mix: json(strength.lifecycleMix), exclusions: json(strength.exclusions), first_evidence_at: strength.firstEvidenceAt,
      last_evidence_at: strength.lastEvidenceAt, stale_before: strength.staleBefore, computed_at: now.toISOString(),
    });
    if (!state) {
      // Lost a concurrent race for this sequence: accept only an identical outcome.
      const winner = await this.repository.latestState(cluster.workspace_id, cluster.product_id, cluster.id, DEMAND_CLUSTER_STRENGTH_VERSION);
      if (winner?.input_fingerprint === strength.inputFingerprint) return false;
      throw new Error(`Demand cluster state sequence conflict for ${cluster.id}; retry the rebuild.`);
    }
    const membershipById = new Map(members.map((row) => [row.id, row]));
    for (const [ordinal, contribution] of strength.contributions.entries()) {
      const membership = membershipById.get(contribution.membershipId);
      if (!membership) continue;
      await this.repository.linkProvenance({ derivedEvidenceNodeId: state.evidence_node_id, sourceEvidenceNodeId: membership.evidence_node_id, relationType: contribution.contributes ? "strengthened_by" : "excluded_membership", ordinal, weight: contribution.contributes ? membership.confidence : 0, engineVersionId, measurement: json({ strengthVersion: DEMAND_CLUSTER_STRENGTH_VERSION, reason: contribution.reason }) });
    }
    await this.repository.linkProvenance({ derivedEvidenceNodeId: state.evidence_node_id, sourceEvidenceNodeId: cluster.evidence_node_id, relationType: "measures_cluster", ordinal: 0, engineVersionId });
    if (latest) await this.repository.linkProvenance({ derivedEvidenceNodeId: state.evidence_node_id, sourceEvidenceNodeId: latest.evidence_node_id, relationType: "supersedes_state", ordinal: 0, engineVersionId });
    return true;
  }

  /** Product-private read model; strongest clusters first. */
  async getDemandClusters(workspaceId: string, productId: string): Promise<DemandClusterReadModel[]> {
    const clusters = await this.repository.listClusters(workspaceId, productId, DEMAND_CLUSTERING_VERSION);
    if (!clusters.length) return [];
    const memberships = await this.repository.listMemberships(workspaceId, productId, DEMAND_CLUSTERING_VERSION);
    // Batched reads: one latest-state query and chunked contribution edges, never one query per cluster.
    const latest = await this.repository.listLatestStates(workspaceId, productId, DEMAND_CLUSTER_STRENGTH_VERSION);
    const stateByCluster = new Map(latest.states.map((row) => [row.cluster_id, row]));
    const edges = latest.states.length ? await this.repository.listStateContributionsForStates(latest.states.map((row) => row.evidence_node_id)) : [];
    const models: DemandClusterReadModel[] = [];
    for (const cluster of clusters) {
      const state: DemandClusterStateRow | undefined = stateByCluster.get(cluster.id);
      const members = memberships.filter((row) => row.cluster_id === cluster.id);
      const statusByMembership = this.contributionStatus(state, members, edges);
      models.push({
        clusterId: cluster.id,
        clusterKey: cluster.cluster_key,
        label: cluster.label,
        anchorConceptKey: cluster.anchor_concept_key,
        intentFamily: cluster.intent_family as DemandClusterIntentFamily,
        targetScope: cluster.target_scope as DemandClusterTargetScope,
        clusteringVersion: cluster.clustering_version,
        createdAt: cluster.created_at,
        evidenceNodeId: cluster.evidence_node_id,
        explanation: explainDemandCluster({ anchorConceptKey: cluster.anchor_concept_key, intentFamily: cluster.intent_family as DemandClusterIntentFamily, targetScope: cluster.target_scope as DemandClusterTargetScope, distinctEvidenceCount: state?.distinct_evidence_count ?? 0, distinctSourceCount: state?.distinct_source_count ?? 0 }),
        strength: state ? {
          version: state.strength_version, sequence: state.sequence, level: state.strength_level as DemandClusterStrengthLevel, score: Number(state.strength_score),
          distinctEvidenceCount: state.distinct_evidence_count, distinctSourceCount: state.distinct_source_count,
          averageDemandQuality: Number(state.average_demand_quality), averageConfidence: Number(state.average_confidence), components: state.components,
          sourceMix: numberRecord(state.source_mix), intentMix: numberRecord(state.intent_mix), alternativeMix: numberRecord(state.alternative_mix),
          lifecycleMix: numberRecord(state.lifecycle_mix), exclusions: numberRecord(state.exclusions), firstEvidenceAt: state.first_evidence_at,
          lastEvidenceAt: state.last_evidence_at, computedAt: state.computed_at, stateEvidenceNodeId: state.evidence_node_id, historyLength: latest.historyLength[cluster.id] ?? 1,
        } : null,
        members: members.map((row) => ({ membershipId: row.id, matchEvaluationId: row.match_evaluation_id, conversationId: row.conversation_id, sourceKey: row.source_key, evidenceAt: row.evidence_at, evidenceNodeId: row.evidence_node_id, ...(statusByMembership.get(row.id) ?? { contributes: false, exclusionReason: null }) })),
      });
    }
    return models.sort((left, right) => (right.strength?.score ?? 0) - (left.strength?.score ?? 0) || (right.strength?.distinctEvidenceCount ?? 0) - (left.strength?.distinctEvidenceCount ?? 0) || left.clusterKey.localeCompare(right.clusterKey));
  }

  /**
   * Contribution status exactly as recorded by the latest state's provenance
   * edges (never recomputed on read), so the read model matches history.
   */
  private contributionStatus(state: DemandClusterStateRow | undefined, members: DemandClusterMembershipRow[], edges: DemandClusterStateContribution[]) {
    const status = new Map<string, { contributes: boolean; exclusionReason: DemandClusterExclusionReason | null }>();
    if (!state) return status;
    const membershipByNode = new Map(members.map((row) => [row.evidence_node_id, row.id]));
    for (const edge of edges.filter((item) => item.stateEvidenceNodeId === state.evidence_node_id)) {
      const membershipId = membershipByNode.get(edge.sourceEvidenceNodeId);
      if (!membershipId) continue;
      status.set(membershipId, { contributes: edge.relationType === "strengthened_by", exclusionReason: edge.relationType === "strengthened_by" ? null : edge.reason as DemandClusterExclusionReason | null });
    }
    return status;
  }
}
