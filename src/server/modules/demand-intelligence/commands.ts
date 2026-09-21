import type { DemandProfileRow, DemandSnapshotRow, ProductRow, ProductSnapshotRow } from "../../db/database.helpers";
import { requireUser } from "../auth";
import { getProductQuery } from "../products";
import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { SupabaseIntelligenceRepository } from "../intelligence/intelligence.repository";
import type { DemandGapReadModel, DemandDriftReadModel, DemandMapReadModel, DemandWindow } from "./demand.schemas";
import { DemandIntelligenceService } from "./demand.service";
import { SupabaseDemandRepository } from "./demand.repository";
import { AppError } from "../../lib/errors";
import { demandDriftWindowAllowed, resolveMonitoringPolicy } from "../entitlements/monitoring-policy";
import { windowDays } from "./demand.schemas";

export const DEMAND_JOB_TYPES = ["aggregate-demand", "calculate-demand-gap", "calculate-demand-drift", "backfill-demand-snapshots"] as const;
export type DemandJobType = (typeof DEMAND_JOB_TYPES)[number];

function readService() {
  const client = createSupabaseServiceClient();
  return new DemandIntelligenceService(new SupabaseDemandRepository(client), new SupabaseIntelligenceRepository(client));
}

/** Thin read wrapper over DemandIntelligenceService.getDemandMap — no ranking/aggregation logic here. */
export async function getDemandMapQuery(workspaceId: unknown, productId: unknown, window: DemandWindow = "30d"): Promise<DemandMapReadModel> {
  const product = await getProductQuery(workspaceId, productId);
  await requireUser();
  return readService().getDemandMap(product.workspace_id, product.id, window);
}

/** Thin read wrapper over DemandIntelligenceService.getDemandGap — no gap-score logic here. */
export async function getDemandGapQuery(workspaceId: unknown, productId: unknown, snapshotId?: string): Promise<DemandGapReadModel> {
  const product = await getProductQuery(workspaceId, productId);
  await requireUser();
  return readService().getDemandGap(product.workspace_id, product.id, snapshotId);
}

/** Thin read wrapper over DemandIntelligenceService.getDemandDrift — no drift-significance logic here. */
export async function getDemandDriftQuery(workspaceId: unknown, productId: unknown, window: DemandWindow = "30d"): Promise<DemandDriftReadModel> {
  const product = await getProductQuery(workspaceId, productId);
  await requireUser();
  const policy = await resolveMonitoringPolicy(createSupabaseServiceClient(), product.workspace_id);
  if (!demandDriftWindowAllowed(policy, windowDays(window))) {
    throw new AppError("CAPABILITY_DISABLED", "Demand drift history is not enabled for this workspace window.");
  }
  return readService().getDemandDrift(product.workspace_id, product.id, window);
}

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
