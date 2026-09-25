import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import type { DemandDriftRow, DemandGapRow } from "@/server/db/database.helpers";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { selectComparableDrifts } from "@/server/modules/demand-intelligence/drift-comparability";
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

    const [signals, snapshots, activeResult, latestResult, incrementalResult, evidenceRetrievedAt] = await Promise.all([
      // This is the bounded, persisted signal read model. It does not invoke
      // analysis, qualification, candidate selection, or a provider adapter.
      intelligenceService.listSignals(key.workspaceId, key.productId, { limit: 50 }),
      demandRepository.listSnapshots(key.workspaceId, key.productId),
      this.client.from("job_runs").select("id,status").eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE).eq("workspace_id", key.workspaceId).eq("product_id", key.productId).in("status", ["pending", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      this.client.from("job_runs").select("completed_at").eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE).eq("workspace_id", key.workspaceId).eq("product_id", key.productId).eq("status", "succeeded").not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
      // Stage 2E: product interpretation freshness also advances when
      // continuous incremental matching re-checks the market for this product.
      this.client.from("job_runs").select("completed_at").eq("job_type", INCREMENTAL_PRODUCT_MATCH_JOB_TYPE).eq("workspace_id", key.workspaceId).eq("product_id", key.productId).eq("status", "succeeded").not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
      this.loadEvidenceRetrievedAt(key),
    ]);

    if (activeResult.error || latestResult.error || incrementalResult.error) throw new AppError("INTERNAL_ERROR", "Refresh state could not be loaded.");
    const snapshot = snapshots[0] ?? null;
    const [gaps, drifts]: [DemandGapRow[], DemandDriftRow[]] = snapshot
      ? await Promise.all([
        demandRepository.listGaps(key.workspaceId, key.productId, snapshot.id),
        // Drift comparability v1: only surface drift from adjacent windows.
        Promise.all([demandRepository.listSnapshots(key.workspaceId, key.productId), demandRepository.listDrifts(key.workspaceId, key.productId)])
          .then(([allSnapshots, allDrifts]) => selectComparableDrifts(allSnapshots, allDrifts)?.drifts ?? []),
      ])
      : [[], []];

    return {
      signals,
      snapshot,
      gaps,
      drifts,
      activeRefresh: activeResult.data ? { jobRunId: activeResult.data.id, status: activeResult.data.status as "pending" | "running" } : null,
      lastSuccessfulRefreshAt: latestResult.data?.completed_at ?? null,
      lastIncrementalMatchAt: incrementalResult.data?.completed_at ?? null,
      lastEvidenceRetrievedAt: evidenceRetrievedAt,
    };
  }

  /**
   * Stage 2E: when public evidence for this product's market was last
   * retrieved by a continuous partition refresh. Only a timestamp derived
   * from global operational state is returned - never a partition spec - and
   * the partition set is taken from this product's own RLS-scoped artifacts.
   * Best effort: a failure degrades to null instead of failing the read.
   */
  private async loadEvidenceRetrievedAt(key: ReadFirstProductKey): Promise<string | null> {
    try {
      const since = new Date(Date.now() - EVIDENCE_INTEREST_WINDOW_MS).toISOString();
      const artifacts = await (this.client as unknown as UntypedClient).from("query_yield_artifacts").select("market_partition_key").eq("workspace_id", key.workspaceId).eq("product_id", key.productId).not("market_partition_key", "is", null).gte("created_at", since).limit(200);
      if (artifacts.error) return null;
      const keys = [...new Set((artifacts.data ?? []).map((row) => row.market_partition_key as string))];
      if (!keys.length) return null;
      const partitions = await (this.client as unknown as UntypedClient).from("market_partitions").select("id").in("partition_key", keys).limit(200);
      if (partitions.error) return null;
      const ids = (partitions.data ?? []).map((row) => row.id as string);
      if (!ids.length) return null;
      const state = await (this.client as unknown as UntypedClient).from("market_partition_refresh_state").select("last_success_at").in("partition_id", ids).not("last_success_at", "is", null).order("last_success_at", { ascending: false }).limit(1);
      if (state.error) return null;
      return (state.data?.[0]?.last_success_at as string | undefined) ?? null;
    } catch {
      return null;
    }
  }
}

type UntypedQuery = {
  select(columns: string): UntypedQuery;
  eq(field: string, value: unknown): UntypedQuery;
  in(field: string, values: unknown[]): UntypedQuery;
  not(field: string, operator: string, value: unknown): UntypedQuery;
  gte(field: string, value: unknown): UntypedQuery;
  order(field: string, options: { ascending: boolean }): UntypedQuery;
  limit(count: number): Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>;
};
type UntypedClient = { from(table: string): UntypedQuery };

const INCREMENTAL_PRODUCT_MATCH_JOB_TYPE = "match-product-incremental";
const EVIDENCE_INTEREST_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;

export function createSupabaseReadFirstIntelligenceRepository(client = createSupabaseServiceClient()): SupabaseReadFirstIntelligenceRepository {
  return new SupabaseReadFirstIntelligenceRepository(client);
}
