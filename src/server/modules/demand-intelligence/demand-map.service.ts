import type { DemandMapReadModel } from "./demand.schemas";
import type { DemandClusteringRepository } from "./demand-clustering.repository";
import { DemandCurrentnessService } from "./demand-currentness.service";
import { buildDemandMap, type DemandMapV2ReadModel } from "./demand-map.policy";

/**
 * Layer 9A read service. Read-only: it never writes clusters, states, observations,
 * signals or actions. All reads are scoped by the caller's (workspaceId, productId)
 * and batched (no per-cluster queries). Currentness is delegated to
 * DemandCurrentnessService, shared with Layer 9B's Gap v2 / Drift v2 / Digests.
 */
export class DemandMapService {
  private readonly currentness: DemandCurrentnessService;

  constructor(private readonly repository: DemandClusteringRepository) {
    this.currentness = new DemandCurrentnessService(repository);
  }

  async getDemandMap(input: { workspaceId: string; productId: string; legacy: DemandMapReadModel | null; now?: Date }): Promise<DemandMapV2ReadModel> {
    const now = input.now ?? new Date();
    const { workspaceId, productId } = input;
    const { clusters, members, staleBefore: cutoff, statesRead, statesTruncated } = await this.currentness.getCurrentness({ workspaceId, productId, now });

    const liveEvaluationIds = [...new Set(members.filter((member) => member.contributes).map((member) => member.matchEvaluationId))];
    const buyerLanguage = liveEvaluationIds.length ? await this.repository.listBuyerLanguage(workspaceId, productId, liveEvaluationIds) : [];

    return buildDemandMap({ clusters, members, buyerLanguage, legacy: input.legacy, now, staleBefore: cutoff, statesRead, statesTruncated });
  }
}
