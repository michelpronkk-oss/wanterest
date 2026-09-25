import type { ProductSnapshotRow } from "../../db/database.helpers";
import type { DemandClusteringRepository } from "./demand-clustering.repository";
import { DemandCurrentnessService } from "./demand-currentness.service";
import { buildDemandMap, type DemandMapConcept } from "./demand-map.policy";
import { buildDemandGapV2, type DemandGapV2ReadModel } from "./demand-gap-v2.policy";
import { buildDemandDriftV2, type DemandDriftV2ReadModel } from "./demand-drift-v2.policy";
import type { DemandRepository } from "./demand.repository";
import type { DemandWindow } from "./demand.schemas";

/**
 * Wanterest Layer 9B read service: lifecycle-aware Gap v2 and Drift v2, derived
 * from the same Layer 9A currentness read (never a second lifecycle definition).
 * Read-only, batched, not persisted. See docs/architecture.md §17.
 */
export class DownstreamIntelligenceService {
  private readonly currentness: DemandCurrentnessService;

  constructor(private readonly clusteringRepository: DemandClusteringRepository, private readonly demandRepository: DemandRepository) {
    this.currentness = new DemandCurrentnessService(clusteringRepository);
  }

  private async concepts(workspaceId: string, productId: string, now: Date): Promise<{ current: DemandMapConcept[]; previouslyObserved: DemandMapConcept[] }> {
    const result = await this.currentness.getCurrentness({ workspaceId, productId, now });
    const map = buildDemandMap({ clusters: result.clusters, members: result.members, buyerLanguage: [], legacy: null, now, staleBefore: result.staleBefore, statesRead: result.statesRead, statesTruncated: result.statesTruncated });
    return { current: map.current, previouslyObserved: map.previouslyObserved };
  }

  async getDemandGapV2(input: { workspaceId: string; productId: string; positioning: ProductSnapshotRow | null; now?: Date }): Promise<DemandGapV2ReadModel> {
    const now = input.now ?? new Date();
    const { current } = await this.concepts(input.workspaceId, input.productId, now);
    return buildDemandGapV2({ current, positioning: input.positioning, now });
  }

  async getDemandDriftV2(input: { workspaceId: string; productId: string; window: DemandWindow; now?: Date }): Promise<DemandDriftV2ReadModel> {
    const now = input.now ?? new Date();
    const { current, previouslyObserved } = await this.concepts(input.workspaceId, input.productId, now);
    const monitoringStartedAt = await this.demandRepository.getEarliestSnapshotTimestamp(input.workspaceId, input.productId);
    return buildDemandDriftV2({ concepts: [...current, ...previouslyObserved], window: input.window, now, monitoringStartedAt });
  }

  /** One currentness read shared by both — used where a page needs Gap v2 and Drift v2 together (the Overview). */
  async getDownstreamIntelligence(input: { workspaceId: string; productId: string; positioning: ProductSnapshotRow | null; window: DemandWindow; now?: Date }): Promise<{ gap: DemandGapV2ReadModel; drift: DemandDriftV2ReadModel }> {
    const now = input.now ?? new Date();
    const { current, previouslyObserved } = await this.concepts(input.workspaceId, input.productId, now);
    const monitoringStartedAt = await this.demandRepository.getEarliestSnapshotTimestamp(input.workspaceId, input.productId);
    return {
      gap: buildDemandGapV2({ current, positioning: input.positioning, now }),
      drift: buildDemandDriftV2({ concepts: [...current, ...previouslyObserved], window: input.window, now, monitoringStartedAt }),
    };
  }
}
