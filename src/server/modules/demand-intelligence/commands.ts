import type { DemandProfileRow, DemandSnapshotRow, ProductRow, ProductSnapshotRow } from "../../db/database.helpers";
import type { DemandWindow } from "./demand.schemas";
import type { DemandIntelligenceService } from "./demand.service";

export const DEMAND_JOB_TYPES = ["aggregate-demand", "calculate-demand-gap", "calculate-demand-drift", "backfill-demand-snapshots"] as const;
export type DemandJobType = (typeof DEMAND_JOB_TYPES)[number];

export function aggregateDemand(service: DemandIntelligenceService, input: Parameters<DemandIntelligenceService["aggregateDemand"]>[0]): Promise<DemandSnapshotRow> {
  return service.aggregateDemand(input);
}

export function calculateDemandGap(service: DemandIntelligenceService, product: ProductRow, productSnapshot: ProductSnapshotRow, snapshot: DemandSnapshotRow, engineVersionId: string) {
  return service.calculateDemandGap(product, productSnapshot, snapshot, engineVersionId);
}

export function calculateDemandDrift(service: DemandIntelligenceService, current: DemandSnapshotRow, previous: DemandSnapshotRow, engineVersionId: string) {
  return service.calculateDemandDrift(current, previous, engineVersionId);
}

export function backfillDemandSnapshots(service: DemandIntelligenceService, input: { product: ProductRow; profile: DemandProfileRow; windows: DemandWindow[]; periodEnds: string[]; mapEngineVersionId: string; themeEngineVersionId?: string }) {
  return service.backfillDemandSnapshots(input);
}
