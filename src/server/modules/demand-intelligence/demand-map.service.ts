import type { DemandMapReadModel } from "./demand.schemas";
import { DEMAND_CLUSTER_STRENGTH_VERSION, DEMAND_CLUSTERING_VERSION, staleBefore, type DemandClusterIntentFamily, type DemandClusterTargetScope } from "./demand-clustering.policy";
import type { DemandClusteringRepository } from "./demand-clustering.repository";
import { buildDemandMap, resolveDemandMapMember, type DemandMapClusterInput, type DemandMapV2ReadModel } from "./demand-map.policy";

/**
 * Layer 9A read service. Read-only: it never writes clusters, states, observations,
 * signals or actions. All reads are scoped by the caller's (workspaceId, productId)
 * and batched (no per-cluster queries).
 */
export class DemandMapService {
  constructor(private readonly repository: DemandClusteringRepository) {}

  async getDemandMap(input: { workspaceId: string; productId: string; legacy: DemandMapReadModel | null; now?: Date }): Promise<DemandMapV2ReadModel> {
    const now = input.now ?? new Date();
    const cutoff = staleBefore(now);
    const { workspaceId, productId } = input;
    const clusterRows = (await this.repository.listClusters(workspaceId, productId, DEMAND_CLUSTERING_VERSION))
      .filter((row) => row.workspace_id === workspaceId && row.product_id === productId);
    const memberships = clusterRows.length
      ? (await this.repository.listMemberships(workspaceId, productId, DEMAND_CLUSTERING_VERSION)).filter((row) => row.workspace_id === workspaceId && row.product_id === productId)
      : [];
    const latest = clusterRows.length
      ? await this.repository.listLatestStates(workspaceId, productId, DEMAND_CLUSTER_STRENGTH_VERSION)
      : { states: [], historyLength: {}, truncated: false };
    const states = latest.states.filter((row) => row.workspace_id === workspaceId && row.product_id === productId);
    const edges = states.length ? await this.repository.listStateContributionsForStates(states.map((row) => row.evidence_node_id)) : [];
    const lifecycle = memberships.length ? await this.repository.loadMatchLifecycle(workspaceId, productId, memberships.map((row) => row.product_match_id)) : [];

    const stateByCluster = new Map(states.map((row) => [row.cluster_id, row]));
    const edgeByStateAndMember = new Map(edges.map((edge) => [`${edge.stateEvidenceNodeId}:${edge.sourceEvidenceNodeId}`, edge]));
    const lifecycleByMatch = new Map(lifecycle.map((row) => [row.productMatchId, row]));
    const clusterIds = new Set(clusterRows.map((row) => row.id));

    const clusters: DemandMapClusterInput[] = clusterRows.map((row) => {
      const state = stateByCluster.get(row.id);
      return {
        clusterId: row.id,
        clusterKey: row.cluster_key,
        label: row.label,
        anchorConceptKey: row.anchor_concept_key,
        intentFamily: row.intent_family as DemandClusterIntentFamily,
        targetScope: row.target_scope as DemandClusterTargetScope,
        evidenceNodeId: row.evidence_node_id,
        state: state ? { sequence: state.sequence, level: state.strength_level, score: Number(state.strength_score), computedAt: state.computed_at, evidenceNodeId: state.evidence_node_id, historyLength: latest.historyLength[row.id] ?? 1 } : null,
      };
    });

    const members = memberships.filter((row) => clusterIds.has(row.cluster_id)).map((row) => {
      const state = stateByCluster.get(row.cluster_id);
      const edge = state ? edgeByStateAndMember.get(`${state.evidence_node_id}:${row.evidence_node_id}`) : undefined;
      const live = lifecycleByMatch.get(row.product_match_id);
      return resolveDemandMapMember({
        membershipId: row.id,
        clusterId: row.cluster_id,
        matchEvaluationId: row.match_evaluation_id,
        productMatchId: row.product_match_id,
        conversationId: row.conversation_id,
        sourceKey: row.source_key,
        evidenceAt: row.evidence_at,
        evidenceNodeId: row.evidence_node_id,
        persisted: { inLatestState: Boolean(edge), contributes: edge?.relationType === "strengthened_by", reason: edge && edge.relationType !== "strengthened_by" ? edge.reason : null },
        live: { found: Boolean(live?.found), currentEvaluationId: live?.currentEvaluationId ?? null, signalLifecycleStatus: live?.signalLifecycleStatus ?? null },
      }, cutoff);
    });

    const liveEvaluationIds = [...new Set(members.filter((member) => member.contributes).map((member) => member.matchEvaluationId))];
    const buyerLanguage = liveEvaluationIds.length ? await this.repository.listBuyerLanguage(workspaceId, productId, liveEvaluationIds) : [];

    return buildDemandMap({ clusters, members, buyerLanguage, legacy: input.legacy, now, staleBefore: cutoff, statesRead: states.length, statesTruncated: latest.truncated });
  }
}
