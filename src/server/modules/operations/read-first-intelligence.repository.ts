import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import type { DemandDriftRow, DemandGapRow } from "@/server/db/database.helpers";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { SupabaseDemandRepository } from "@/server/modules/demand-intelligence/demand.repository";
import { IntelligenceService } from "@/server/modules/intelligence";
import { SupabaseIntelligenceRepository } from "@/server/modules/intelligence/intelligence.repository";
import { PRODUCT_DEMAND_SCAN_JOB_TYPE } from "./product-demand-scan.identity";
import type { ReadFirstIntelligenceRepository, ReadFirstPersistedState, ReadFirstProductKey } from "./read-first-intelligence.service";

type Client = SupabaseClient<Database>;

export class SupabaseReadFirstIntelligenceRepository implements ReadFirstIntelligenceRepository {
  constructor(private readonly client: Client) {}

  async loadPersistedState(key: ReadFirstProductKey): Promise<ReadFirstPersistedState> {
    const intelligenceRepository = new SupabaseIntelligenceRepository(this.client);
    const demandRepository = new SupabaseDemandRepository(this.client);
    const intelligenceService = new IntelligenceService(intelligenceRepository);

    const [signals, snapshots, activeResult, latestResult] = await Promise.all([
      // This is the bounded, persisted signal read model. It does not invoke
      // analysis, qualification, candidate selection, or a provider adapter.
      intelligenceService.listSignals(key.workspaceId, key.productId, { limit: 50 }),
      demandRepository.listSnapshots(key.workspaceId, key.productId),
      this.client.from("job_runs").select("id,status").eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE).eq("workspace_id", key.workspaceId).eq("product_id", key.productId).in("status", ["pending", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      this.client.from("job_runs").select("completed_at").eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE).eq("workspace_id", key.workspaceId).eq("product_id", key.productId).eq("status", "succeeded").not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (activeResult.error || latestResult.error) throw new AppError("INTERNAL_ERROR", "Refresh state could not be loaded.");
    const snapshot = snapshots[0] ?? null;
    const [gaps, drifts]: [DemandGapRow[], DemandDriftRow[]] = snapshot
      ? await Promise.all([
        demandRepository.listGaps(key.workspaceId, key.productId, snapshot.id),
        demandRepository.listDrifts(key.workspaceId, key.productId, snapshot.id),
      ])
      : [[], []];

    return {
      signals,
      snapshot,
      gaps,
      drifts,
      activeRefresh: activeResult.data ? { jobRunId: activeResult.data.id, status: activeResult.data.status as "pending" | "running" } : null,
      lastSuccessfulRefreshAt: latestResult.data?.completed_at ?? null,
    };
  }
}

export function createSupabaseReadFirstIntelligenceRepository(client = createSupabaseServiceClient()): SupabaseReadFirstIntelligenceRepository {
  return new SupabaseReadFirstIntelligenceRepository(client);
}
