import "server-only";

import {
  MARKET_PARTITION_REFRESH_INTEREST_WINDOW_MS,
  MARKET_PARTITION_REFRESH_RECENT_SCAN_WINDOW_MS,
  liveMarketPartitionRefreshSourceKeys,
} from "@/server/modules/ingestion/market-partition-refresh.policy";

/**
 * Wanterest 1B Stage 2C: repository for the mutable, global market-partition
 * refresh scheduler state. market_partitions (Stage 2B) is immutable
 * identity and is only ever read here, never written. Untyped against the
 * generated Supabase client - same pattern as MarketPartitionRepository and
 * QueryYieldRepository, because the generated database.types.ts predates
 * Stage 2B/2C and does not include these tables/RPCs (documented technical
 * debt, not something this stage regenerates).
 */

export type MarketPartitionRefreshStateRow = {
  partition_id: string;
  source_key: string;
  enabled: boolean;
  disabled_reason: string | null;
  next_due_at: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  consecutive_zero_new?: number;
  last_job_run_id: string | null;
};

export type MarketPartitionRow = {
  id: string;
  partition_key: string;
  identity_version: string;
  source_key: string;
  retrieval_spec: Record<string, unknown>;
};

export type DueMarketPartitionCandidate = {
  partitionId: string;
  sourceKey: string;
  partitionKey: string;
  nextDueAt: string;
};

type Row = Record<string, unknown>;
type ErrorResult = { code?: string; message?: string } | null;
type Filterable = {
  eq(field: string, value: unknown): Filterable;
  lte(field: string, value: unknown): Filterable;
  gte(field: string, value: unknown): Filterable;
  in(field: string, values: unknown[]): Filterable;
  or(clause: string): Filterable;
  order(field: string, options: { ascending: boolean }): Filterable;
  limit(count: number): Promise<{ data: Row[] | null; error: ErrorResult }>;
  maybeSingle(): Promise<{ data: Row | null; error: ErrorResult }>;
};
type UpdateQuery = {
  eq(field: string, value: unknown): UpdateQuery;
} & Promise<{ data: Row | null; error: ErrorResult }>;
type Query = {
  select(columns: string): Filterable;
  insert(row: Row): { select(columns: string): { maybeSingle(): Promise<{ data: Row | null; error: ErrorResult }> } };
  update(patch: Row): UpdateQuery;
};
type Client = {
  from(table: "market_partition_refresh_state" | "market_partitions" | "query_yield_artifacts"): Query;
  rpc(name: "claim_market_partition_refresh", args: Record<string, unknown>): Promise<{ data: Row | null; error: ErrorResult }>;
};

function persistenceError(error: ErrorResult, context: string): Error {
  const code = error?.code ? ` (${error.code})` : "";
  const message = error?.message ? `: ${error.message.slice(0, 180)}` : "";
  return new Error(`Market partition refresh state persistence failed during ${context}${code}${message}`);
}

export class MarketPartitionRefreshRepository {
  constructor(private readonly client: unknown) {}

  private table(name: "market_partition_refresh_state" | "market_partitions" | "query_yield_artifacts"): Query {
    return (this.client as Client).from(name);
  }

  async getStateRow(partitionId: string): Promise<MarketPartitionRefreshStateRow | null> {
    const { data, error } = await this.table("market_partition_refresh_state").select("*").eq("partition_id", partitionId).maybeSingle();
    if (error) throw persistenceError(error, "state lookup");
    return (data as MarketPartitionRefreshStateRow | null) ?? null;
  }

  async getMarketPartitionById(partitionId: string): Promise<MarketPartitionRow | null> {
    const { data, error } = await this.table("market_partitions").select("id, partition_key, identity_version, source_key, retrieval_spec").eq("id", partitionId).maybeSingle();
    if (error) throw persistenceError(error, "market_partitions lookup");
    return (data as MarketPartitionRow | null) ?? null;
  }

  /** Lists every immutable Stage 2B partition for a currently-live (flag-aware) refreshable source. */
  async listRefreshableMarketPartitions(): Promise<MarketPartitionRow[]> {
    const sourceKeys = liveMarketPartitionRefreshSourceKeys();
    if (!sourceKeys.length) return [];
    const { data, error } = await this.table("market_partitions").select("id, partition_key, identity_version, source_key, retrieval_spec").in("source_key", sourceKeys).limit(10_000);
    if (error) throw persistenceError(error, "market_partitions listing");
    return (data as MarketPartitionRow[] | null) ?? [];
  }

  async listExistingStatePartitionIds(partitionIds: string[]): Promise<Set<string>> {
    if (!partitionIds.length) return new Set();
    const { data, error } = await this.table("market_partition_refresh_state").select("partition_id").in("partition_id", partitionIds).limit(10_000);
    if (error) throw persistenceError(error, "state existence check");
    return new Set((data ?? []).map((row) => row.partition_id as string));
  }

  /** Insert-only: never overwrites an existing state row. */
  async ensureStateRow(input: { partitionId: string; sourceKey: string; now: string }): Promise<void> {
    const inserted = await this.table("market_partition_refresh_state")
      .insert({ partition_id: input.partitionId, source_key: input.sourceKey, next_due_at: input.now })
      .select("partition_id")
      .maybeSingle();
    if (!inserted.error) return;
    if (inserted.error.code === "23505") return;
    throw persistenceError(inserted.error, "state row creation");
  }

  /**
   * Selects due partitions: enabled, due, unleased, with product-scan
   * interest inside the interest window, and NOT recently fetched by a
   * product scan inside the recent-scan window. A partition with no recent
   * interest is simply not selected here - callers must never disable it
   * for that reason (interest can return on a later tick).
   */
  async listDuePartitions(now: string, limit: number, explicitInterestKeys?: (partitionKeys: string[]) => Promise<Set<string>>): Promise<DueMarketPartitionCandidate[]> {
    // Overselect due state rows, then narrow by interest/recent-scan so the
    // final result still respects `limit` after filtering.
    const candidateWindow = Math.max(limit * 10, 50);
    const due = await this.table("market_partition_refresh_state")
      .select("partition_id, source_key, next_due_at")
      .eq("enabled", true)
      .lte("next_due_at", now)
      .or(`lease_expires_at.is.null,lease_expires_at.lte.${now}`)
      .order("next_due_at", { ascending: true })
      .limit(candidateWindow);
    if (due.error) throw persistenceError(due.error, "due listing");
    const dueRows = due.data ?? [];
    if (!dueRows.length) return [];

    const partitionIds = dueRows.map((row) => row.partition_id as string);
    const partitions = await this.table("market_partitions").select("id, partition_key").in("id", partitionIds).limit(candidateWindow);
    if (partitions.error) throw persistenceError(partitions.error, "partition key lookup");
    const partitionKeyById = new Map((partitions.data ?? []).map((row) => [row.id as string, row.partition_key as string]));
    const keys = [...new Set([...partitionKeyById.values()])];
    if (!keys.length) return [];

    const interestSince = new Date(Date.parse(now) - MARKET_PARTITION_REFRESH_INTEREST_WINDOW_MS).toISOString();
    const recentScanSince = new Date(Date.parse(now) - MARKET_PARTITION_REFRESH_RECENT_SCAN_WINDOW_MS).toISOString();
    const interested = await this.table("query_yield_artifacts").select("market_partition_key").in("market_partition_key", keys).gte("created_at", interestSince).limit(10_000);
    if (interested.error) throw persistenceError(interested.error, "interest lookup");
    const interestedKeys = new Set((interested.data ?? []).map((row) => row.market_partition_key as string));
    // Layer 12A.2 (flag-gated by the caller): active explicit scan/seed interests also keep a partition due.
    if (explicitInterestKeys) for (const key of await explicitInterestKeys(keys)) interestedKeys.add(key);
    const recentlyScanned = await this.table("query_yield_artifacts").select("market_partition_key").in("market_partition_key", keys).gte("created_at", recentScanSince).limit(10_000);
    if (recentlyScanned.error) throw persistenceError(recentlyScanned.error, "recent-scan lookup");
    const recentlyScannedKeys = new Set((recentlyScanned.data ?? []).map((row) => row.market_partition_key as string));

    const eligible: DueMarketPartitionCandidate[] = [];
    for (const row of dueRows) {
      const partitionId = row.partition_id as string;
      const partitionKey = partitionKeyById.get(partitionId);
      if (!partitionKey) continue;
      if (!interestedKeys.has(partitionKey)) continue;
      if (recentlyScannedKeys.has(partitionKey)) continue;
      eligible.push({ partitionId, sourceKey: row.source_key as string, partitionKey, nextDueAt: row.next_due_at as string });
      if (eligible.length >= limit) break;
    }
    return eligible;
  }

  /** Observational only: how many distinct workspace/product pairs have used this partition recently. Never persisted. */
  async countDistinctInterests(partitionKey: string, sinceIso: string): Promise<number> {
    const { data, error } = await this.table("query_yield_artifacts").select("workspace_id, product_id").eq("market_partition_key", partitionKey).gte("created_at", sinceIso).limit(10_000);
    if (error) throw persistenceError(error, "distinct interest count");
    return new Set((data ?? []).map((row) => `${row.workspace_id as string}:${row.product_id as string}`)).size;
  }

  async claim(partitionId: string, leaseToken: string, now: string, leaseSeconds = 1800): Promise<MarketPartitionRefreshStateRow | null> {
    const { data, error } = await (this.client as Client).rpc("claim_market_partition_refresh", {
      p_partition_id: partitionId,
      p_lease_token: leaseToken,
      p_now: now,
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw persistenceError(error, "claim");
    // The RPC returns a composite row. When nothing qualifies (not due,
    // leased, disabled) PostgREST serializes the empty composite as an
    // object whose fields are all null rather than as JSON null, so only a
    // row carrying a partition_id is a real claim.
    const claimedPartitionId = (data as Row | null | undefined)?.partition_id;
    if (typeof claimedPartitionId !== "string" || !claimedPartitionId) return null;
    if (claimedPartitionId !== partitionId) {
      throw new Error(`Market partition refresh claim invariant violated: requested ${partitionId} but claimed ${claimedPartitionId}`);
    }
    return data as MarketPartitionRefreshStateRow;
  }

  private async update(partitionId: string, leaseToken: string, patch: Row): Promise<void> {
    const { error } = await this.table("market_partition_refresh_state").update(patch).eq("partition_id", partitionId).eq("lease_token", leaseToken);
    if (error) throw persistenceError(error, "state update");
  }

  async recordSuccess(input: { partitionId: string; leaseToken: string; now: string; nextDueAt: string; jobRunId: string; cadence?: { consecutiveZeroNew: number; rawItems: number; rawNewItems: number; cadenceSeconds: number; policyVersion: string } }): Promise<void> {
    await this.update(input.partitionId, input.leaseToken, {
      last_success_at: input.now,
      consecutive_failures: 0,
      last_job_run_id: input.jobRunId,
      next_due_at: input.nextDueAt,
      lease_token: null,
      lease_expires_at: null,
      ...(input.cadence ? {
        consecutive_zero_new: input.cadence.consecutiveZeroNew,
        last_raw_items: input.cadence.rawItems,
        last_raw_new_items: input.cadence.rawNewItems,
        last_cadence_seconds: input.cadence.cadenceSeconds,
        cadence_policy_version: input.cadence.policyVersion,
      } : {}),
    });
  }

  /** Stage 2F daily budget: refresh job runs created since `sinceIso`, per source (source recorded on job creation). */
  async countRefreshJobsBySourceSince(sinceIso: string): Promise<Record<string, number>> {
    const { data, error } = await (this.client as unknown as { from(table: "job_runs"): Query }).from("job_runs").select("input_reference").eq("job_type", "refresh-market-partition").gte("created_at", sinceIso).limit(10_000);
    if (error) throw persistenceError(error, "daily budget lookup");
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const reference = row.input_reference && typeof row.input_reference === "object" ? row.input_reference as Record<string, unknown> : {};
      const sourceKey = typeof reference.sourceKey === "string" ? reference.sourceKey : "unknown";
      counts[sourceKey] = (counts[sourceKey] ?? 0) + 1;
    }
    return counts;
  }

  async recordFailure(input: { partitionId: string; leaseToken: string; now: string; nextDueAt: string; consecutiveFailures: number; jobRunId: string | null }): Promise<void> {
    await this.update(input.partitionId, input.leaseToken, {
      last_failure_at: input.now,
      consecutive_failures: input.consecutiveFailures,
      ...(input.jobRunId ? { last_job_run_id: input.jobRunId } : {}),
      next_due_at: input.nextDueAt,
      lease_token: null,
      lease_expires_at: null,
    });
  }

  async recordDeferral(input: { partitionId: string; leaseToken: string; nextDueAt: string }): Promise<void> {
    await this.update(input.partitionId, input.leaseToken, {
      next_due_at: input.nextDueAt,
      lease_token: null,
      lease_expires_at: null,
    });
  }

  async disable(input: { partitionId: string; leaseToken: string; reason: "spec_roundtrip_mismatch" | "repeated_failure" }): Promise<void> {
    await this.update(input.partitionId, input.leaseToken, {
      enabled: false,
      disabled_reason: input.reason,
      lease_token: null,
      lease_expires_at: null,
    });
  }
}
