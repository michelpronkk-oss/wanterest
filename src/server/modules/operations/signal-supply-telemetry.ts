import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";

/**
 * Wanterest Layer 12A.1: signal supply telemetry v1 (observational only).
 *
 * Normalized, immutable operational facts written AFTER the owning job has
 * finalized, from values that job already computed. Writers never call a
 * provider, never re-run discovery/selection/qualification, never call an LLM,
 * and never change a business outcome: every write is best-effort and a
 * telemetry failure is swallowed (facts are reconcilable against job_runs, so
 * a missing fact is detectable, never a second conflicting truth).
 *
 * Authoritative sources (reconciliation contract):
 *   supply_refresh_facts
 *     raw_count / raw_new_count / normalized_count  <- refresh job_runs.input_reference.result.{rawItems,rawNewItems,normalizedItems}
 *     unique_conversation_count                      <- result.conversations (= |result.conversationIds|)
 *     new_canonical_count                            <- conversations.created_at >= refresh job started_at, over result.conversationIds
 *     reused_canonical_count                         <- unique_conversation_count - new_canonical_count
 *     pages_completed                                <- public ingestion queryTelemetry[0].pagesCompleted
 *     provider_request_count                         <- adapter providerMetrics.requestCount (null when the adapter reports none)
 *     provider_cost_value/unit                       <- result.estimatedCostUsd, unit by source (x=usd, youtube=quota_units, else unknown)
 *     latency_ms                                     <- result.durationMs
 *   product_supply_facts
 *     counts                                         <- match-product-incremental job_runs.input_reference (ProductIncrementalMatchResult)
 *     weak_count / rejected_count                    <- CandidateProcessingOutcome.qualificationStatus of that job's evaluations
 *     materialized_count                             <- processed.signals
 *     clusters_created / cluster_memberships_created <- DemandRebuildResult.clustering (0 when no rebuild ran; null when clustering absent)
 *     reasoning_call_count / cost                    <- processed.semanticReasoningShadow.{llmExecutedCount, reasoningCostUsd}
 *   qualified evidence (signal_supply_funnel)        <- product_match_evaluations first qualified per (workspace, product, conversation)
 */

export const SIGNAL_SUPPLY_TELEMETRY_VERSION = "signal_supply_telemetry_v1" as const;

export type CostUnit = "usd" | "quota_units" | "requests" | "unknown";
export type Cost = { value: number | null; unit: CostUnit };

type Client = SupabaseClient<Database>;

export function signalSupplyTelemetryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SIGNAL_SUPPLY_TELEMETRY_ENABLED === "true";
}

/**
 * Explicit cost units. A value is kept only when its unit is known for that
 * source; quota units are never presented (or converted) as USD, and an
 * unknown unit always stores a null value.
 */
const PROVIDER_COST_UNIT_BY_SOURCE: Readonly<Record<string, Exclude<CostUnit, "unknown">>> = {
  x: "usd",
  youtube: "quota_units",
};

export function providerCost(sourceKey: string, value: number | null | undefined): Cost {
  const unit = PROVIDER_COST_UNIT_BY_SOURCE[sourceKey];
  if (!unit || typeof value !== "number" || !Number.isFinite(value) || value < 0) return { value: null, unit: "unknown" };
  return { value, unit };
}

export function reasoningCost(value: number | null | undefined): Cost {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? { value, unit: "usd" } : { value: null, unit: "unknown" };
}

const count = (value: number) => Math.max(0, Math.floor(value));

export type RefreshFactInput = {
  jobRunId: string;
  marketPartitionId: string;
  partitionKey: string;
  sourceKey: string;
  refreshStatus: "succeeded" | "failed" | "deferred";
  executionStatus: string | null;
  startedAt: string;
  finishedAt: string;
  rawItems: number;
  rawNewItems: number;
  normalizedItems: number;
  conversationIds: string[];
  newCanonicalCount: number | null;
  pagesCompleted: number | null;
  providerRequestCount: number | null;
  estimatedCost: number | null;
  durationMs: number | null;
};

export function buildRefreshFact(input: RefreshFactInput): Database["public"]["Tables"]["supply_refresh_facts"]["Insert"] {
  const unique = new Set(input.conversationIds).size;
  const newCanonical = input.newCanonicalCount === null ? null : Math.min(unique, count(input.newCanonicalCount));
  const cost = providerCost(input.sourceKey, input.estimatedCost);
  return {
    telemetry_version: SIGNAL_SUPPLY_TELEMETRY_VERSION,
    job_run_id: input.jobRunId,
    market_partition_id: input.marketPartitionId,
    partition_key: input.partitionKey,
    source_key: input.sourceKey,
    refresh_status: input.refreshStatus,
    execution_status: input.executionStatus ? input.executionStatus.slice(0, 60) : null,
    refresh_started_at: input.startedAt,
    refresh_finished_at: input.finishedAt < input.startedAt ? input.startedAt : input.finishedAt,
    raw_count: count(input.rawItems),
    raw_new_count: Math.min(count(input.rawItems), count(input.rawNewItems)),
    normalized_count: count(input.normalizedItems),
    unique_conversation_count: unique,
    new_canonical_count: newCanonical,
    reused_canonical_count: newCanonical === null ? null : unique - newCanonical,
    pages_completed: input.pagesCompleted === null ? null : count(input.pagesCompleted),
    provider_request_count: input.providerRequestCount === null ? null : count(input.providerRequestCount),
    provider_cost_value: cost.value,
    provider_cost_unit: cost.unit,
    latency_ms: input.durationMs === null ? null : count(input.durationMs),
  };
}

export type ProductFactInput = {
  workspaceId: string;
  productId: string;
  jobRunId: string;
  refreshJobRunId: string;
  marketPartitionId: string | null;
  partitionKey: string;
  sourceKey: string;
  refreshConversationCount: number;
  alreadyMatchedCount: number;
  candidateCount: number;
  overflowCount: number;
  selectedCount: number;
  evaluatedCount: number;
  outcomeStatuses: Array<string | null>;
  materializedCount: number;
  demandRebuilt: boolean;
  /** null = clustering result not observable for this job. */
  clustersCreated: number | null;
  clusterMembershipsCreated: number | null;
  reasoningCalls: number | null;
  reasoningCostUsd: number | null;
  startedAt: string;
  finishedAt: string;
};

export function buildProductFact(input: ProductFactInput): Database["public"]["Tables"]["product_supply_facts"]["Insert"] {
  const status = (value: string) => input.outcomeStatuses.filter((entry) => entry === value).length;
  const cost = reasoningCost(input.reasoningCostUsd);
  return {
    telemetry_version: SIGNAL_SUPPLY_TELEMETRY_VERSION,
    workspace_id: input.workspaceId,
    product_id: input.productId,
    job_run_id: input.jobRunId,
    refresh_job_run_id: input.refreshJobRunId,
    market_partition_id: input.marketPartitionId,
    partition_key: input.partitionKey,
    source_key: input.sourceKey,
    refresh_conversation_count: count(input.refreshConversationCount),
    already_matched_count: count(input.alreadyMatchedCount),
    candidate_count: count(input.candidateCount),
    overflow_count: count(input.overflowCount),
    selected_count: count(input.selectedCount),
    evaluated_count: count(input.evaluatedCount),
    weak_count: status("weak_candidate"),
    rejected_count: status("rejected"),
    qualified_count: status("qualified"),
    materialized_count: count(input.materializedCount),
    demand_rebuilt: input.demandRebuilt,
    clusters_created_count: input.clustersCreated === null ? null : count(input.clustersCreated),
    cluster_memberships_created_count: input.clusterMembershipsCreated === null ? null : count(input.clusterMembershipsCreated),
    reasoning_call_count: input.reasoningCalls === null ? null : count(input.reasoningCalls),
    reasoning_cost_value: cost.value,
    reasoning_cost_unit: cost.unit,
    started_at: input.startedAt,
    finished_at: input.finishedAt < input.startedAt ? input.startedAt : input.finishedAt,
  };
}

export type TelemetryWriteResult = { written: boolean; reason?: "disabled" | "error" };

export type SignalSupplyTelemetryWriter = {
  recordRefresh(input: RefreshFactInput): Promise<TelemetryWriteResult>;
  recordProduct(input: ProductFactInput): Promise<TelemetryWriteResult>;
  /** Bounded read used only while enabled: how many of these (≤ refresh cap) conversations were first created at/after `since`. */
  countNewCanonical(conversationIds: string[], since: string): Promise<number | null>;
};

/** No-op writer: flag OFF means zero telemetry reads and zero telemetry writes. */
export const disabledSignalSupplyTelemetry: SignalSupplyTelemetryWriter = {
  recordRefresh: async () => ({ written: false, reason: "disabled" }),
  recordProduct: async () => ({ written: false, reason: "disabled" }),
  countNewCanonical: async () => null,
};

const MAX_NEW_CANONICAL_LOOKUP = 500;

/**
 * Immutable insert-or-ignore on the job identity: a replay or a concurrent
 * duplicate writer resolves to the first finalized row, never "+=".
 */
export function supabaseSignalSupplyTelemetry(client: Client): SignalSupplyTelemetryWriter {
  return {
    async recordRefresh(input) {
      try {
        const { error } = await client.from("supply_refresh_facts").upsert(buildRefreshFact(input), { onConflict: "job_run_id", ignoreDuplicates: true });
        return error ? { written: false, reason: "error" } : { written: true };
      } catch {
        return { written: false, reason: "error" };
      }
    },
    async recordProduct(input) {
      try {
        const { error } = await client.from("product_supply_facts").upsert(buildProductFact(input), { onConflict: "job_run_id", ignoreDuplicates: true });
        return error ? { written: false, reason: "error" } : { written: true };
      } catch {
        return { written: false, reason: "error" };
      }
    },
    async countNewCanonical(conversationIds, since) {
      const ids = [...new Set(conversationIds)];
      if (!ids.length) return 0;
      if (ids.length > MAX_NEW_CANONICAL_LOOKUP) return null;
      try {
        const { count: created, error } = await client.from("conversations").select("id", { count: "exact", head: true }).in("id", ids).gte("created_at", since);
        return error || created === null ? null : created;
      } catch {
        return null;
      }
    },
  };
}

export function signalSupplyTelemetryFor(client: Client, env: Record<string, string | undefined> = process.env): SignalSupplyTelemetryWriter {
  return signalSupplyTelemetryEnabled(env) ? supabaseSignalSupplyTelemetry(client) : disabledSignalSupplyTelemetry;
}
