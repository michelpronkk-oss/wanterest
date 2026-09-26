import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import { jsonObjectSchema, type JobRunRow } from "@/server/db/database.helpers";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { deriveMarketPartitionIdentity } from "@/server/modules/ingestion/market-partition-identity";
import { ingestPublicPartition } from "@/server/modules/ingestion/public-ingestion.service";
import { signalSupplyTelemetryFor, type SignalSupplyTelemetryWriter } from "@/server/modules/operations/signal-supply-telemetry";
import { MarketPartitionRefreshRepository, type DueMarketPartitionCandidate } from "@/server/modules/ingestion/market-partition-refresh.repository";
import {
  MARKET_PARTITION_REFRESH_INTEREST_WINDOW_MS,
  MARKET_PARTITION_REFRESH_MAX_CONSECUTIVE_FAILURES,
  MARKET_PARTITION_REFRESH_POLICY_VERSION,
  buildMarketPartitionRefreshRequest,
  marketPartitionRefreshDeferralAt,
  marketPartitionRefreshFailureBackoffAt,
  adaptiveMarketPartitionCadence,
  isMarketPartitionRefreshSource,
  marketPartitionRefreshNextDueAtAdaptive,
  remainingDailyRefreshBudget,
  type AdaptiveCadenceDecision,
} from "@/server/modules/ingestion/market-partition-refresh.policy";

/**
 * Wanterest 1B Stage 2C: refreshes ONE global market partition, independent
 * of any workspace/product/query planning. This is the boundary described in
 * the Stage 2C architecture review - it ends the moment public evidence is
 * persisted and refresh state is updated. It never selects candidates,
 * qualifies signals, materializes signals, or writes query_yield_artifacts.
 * Existing product scans (initial-scan.service.ts, product-demand-scan.ts)
 * are untouched and remain the only path that does those things.
 */

const REFRESH_JOB_TYPE = "refresh-market-partition";
const REFRESH_LEASE_SECONDS = 1800;

type Client = SupabaseClient<Database>;

export type MarketPartitionRefreshOutcome = {
  status: "succeeded" | "failed" | "deferred" | "skipped";
  jobRunId: string | null;
  rawItems: number;
  rawNewItems: number;
  normalizedItems: number;
  conversations: number;
  executionStatus: string | null;
  reason?: string;
  /** Observational economic telemetry (Stage 2D/2F unit-economics input). Never persisted onto refresh state. */
  partitionKey?: string;
  sourceKey?: string;
  estimatedCostUsd?: number | null;
  durationMs?: number;
  hadRecentInterest?: boolean;
  distinctInterestCount?: number;
};

export type StoredRefreshJobResult = {
  partitionKey: string;
  sourceKey: string;
  policyVersion: string;
  request: unknown;
  result: {
    executionStatus: string;
    rawItems: number;
    rawNewItems: number;
    normalizedItems: number;
    conversations: number;
    estimatedCostUsd: number | null;
    durationMs: number;
    /**
     * Stage 2D: the exact public evidence this refresh persisted (bounded by
     * MARKET_PARTITION_REFRESH_LIMIT x MARKET_PARTITION_REFRESH_MAX_PAGES), so
     * incremental product matching reads durable job state rather than a
     * transient Trigger payload. Absent on pre-2D refresh jobs.
     */
    conversationIds?: string[];
    normalizedSourceItemIds?: string[];
  };
  /** Stage 2F: the adaptive cadence decision taken on success. */
  cadence?: AdaptiveCadenceDecision & { nextDueAt: string };
};

function telemetryPages(entry: unknown): number | null {
  const pages = entry && typeof entry === "object" ? (entry as { pagesCompleted?: unknown }).pagesCompleted : undefined;
  return typeof pages === "number" ? pages : null;
}

function zeroOutcome(status: MarketPartitionRefreshOutcome["status"], jobRunId: string | null, reason?: string): MarketPartitionRefreshOutcome {
  return { status, jobRunId, rawItems: 0, rawNewItems: 0, normalizedItems: 0, conversations: 0, executionStatus: null, ...(reason ? { reason } : {}) };
}

async function getJobRun(client: Client, idempotencyKey: string): Promise<JobRunRow | null> {
  const { data, error } = await client.from("job_runs").select("*").eq("job_type", REFRESH_JOB_TYPE).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (error) throw new Error(`Refresh job lookup failed: ${error.message}`);
  return data;
}

async function createOrResumeJobRun(client: Client, input: { idempotencyKey: string; traceId: string; sourceKey: string; partitionKey: string }): Promise<JobRunRow> {
  const existing = await getJobRun(client, input.idempotencyKey);
  if (existing) {
    const { data, error } = await client.from("job_runs").update({ status: "running", attempt_count: existing.attempt_count + 1, started_at: new Date().toISOString(), completed_at: null, error_code: null, error_details: null }).eq("id", existing.id).select("*").single();
    if (error || !data) throw new Error(`Refresh job resume failed: ${error?.message ?? "unknown error"}`);
    return data;
  }
  const { data, error } = await client.from("job_runs").insert({
    job_type: REFRESH_JOB_TYPE,
    workspace_id: null,
    product_id: null,
    idempotency_key: input.idempotencyKey,
    // Source tagged at creation so the Stage 2F daily budget counts in-flight refreshes too.
    input_reference: { sourceKey: input.sourceKey, partitionKey: input.partitionKey },
    status: "running",
    attempt_count: 1,
    started_at: new Date().toISOString(),
    trace_id: input.traceId,
  }).select("*").single();
  if (error || !data) throw new Error(`Refresh job creation failed: ${error?.message ?? "unknown error"}`);
  return data;
}

async function completeJobRun(client: Client, jobId: string, status: "succeeded" | "failed", result: StoredRefreshJobResult | null, errorMessage?: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client.from("job_runs").update({
    status,
    input_reference: jsonObjectSchema.parse(result ?? {}),
    completed_at: now,
    terminal_at: now,
    error_code: status === "failed" ? "REFRESH_FAILED" : null,
    error_details: errorMessage ? { message: errorMessage.slice(0, 500) } : null,
  }).eq("id", jobId);
  if (error) throw new Error(`Refresh job completion failed: ${error.message}`);
}

export async function refreshMarketPartition(input: { partitionId: string; traceId: string }, options: { telemetry?: SignalSupplyTelemetryWriter } = {}): Promise<MarketPartitionRefreshOutcome> {
  const client = createSupabaseServiceClient();
  const repository = new MarketPartitionRefreshRepository(client);
  // Layer 12A.1: observational only; a no-op unless SIGNAL_SUPPLY_TELEMETRY_ENABLED=true.
  const supplyTelemetry = options.telemetry ?? signalSupplyTelemetryFor(client);
  const now = new Date().toISOString();

  const stateBefore = await repository.getStateRow(input.partitionId);
  if (!stateBefore) return zeroOutcome("skipped", null, "state_not_found");

  const dueSlot = stateBefore.next_due_at;
  const idempotencyKey = `${REFRESH_JOB_TYPE}:${input.partitionId}:${dueSlot}`;

  // Replay short-circuit: a due slot that already succeeded is never
  // re-executed and never charges the provider again, without needing to
  // touch the lease at all.
  const existingJob = await getJobRun(client, idempotencyKey);
  if (existingJob?.status === "succeeded") {
    const stored = existingJob.input_reference as unknown as StoredRefreshJobResult | null;
    if (stored?.result) {
      return {
        status: "succeeded",
        jobRunId: existingJob.id,
        rawItems: stored.result.rawItems,
        rawNewItems: stored.result.rawNewItems,
        normalizedItems: stored.result.normalizedItems,
        conversations: stored.result.conversations,
        executionStatus: stored.result.executionStatus,
        partitionKey: stored.partitionKey,
        sourceKey: stored.sourceKey,
        estimatedCostUsd: stored.result.estimatedCostUsd,
        durationMs: stored.result.durationMs,
        reason: "already_succeeded_for_slot",
      };
    }
    return zeroOutcome("succeeded", existingJob.id, "already_succeeded_for_slot");
  }

  const leaseToken = randomUUID();
  const claimed = await repository.claim(input.partitionId, leaseToken, now, REFRESH_LEASE_SECONDS);
  if (!claimed) return zeroOutcome("skipped", existingJob?.id ?? null, "not_claimable");

  const partition = await repository.getMarketPartitionById(input.partitionId);
  if (!partition) {
    await repository.disable({ partitionId: input.partitionId, leaseToken, reason: "spec_roundtrip_mismatch" });
    return zeroOutcome("failed", null, "partition_not_found");
  }

  const job = await createOrResumeJobRun(client, { idempotencyKey, traceId: input.traceId, sourceKey: partition.source_key, partitionKey: partition.partition_key });

  const built = buildMarketPartitionRefreshRequest({ sourceKey: partition.source_key, retrievalSpec: partition.retrieval_spec as never });
  if (!built.ok) {
    await completeJobRun(client, job.id, "failed", null, `Refresh request could not be built: ${built.reason}`);
    await repository.disable({ partitionId: input.partitionId, leaseToken, reason: "spec_roundtrip_mismatch" });
    return zeroOutcome("failed", job.id, built.reason);
  }

  // Round-trip identity check: the request we are about to send must derive
  // back to the exact same immutable partition key. If it doesn't, refresh
  // execution policy or the Stage 2B allowlist has drifted from the stored
  // spec - never call the provider on an unverified request.
  const roundTrip = deriveMarketPartitionIdentity({ sourceKey: partition.source_key, request: built.request });
  if (!roundTrip.eligible || roundTrip.partitionKey !== partition.partition_key) {
    await completeJobRun(client, job.id, "failed", null, "Rebuilt request did not round-trip to the stored partition key.");
    await repository.disable({ partitionId: input.partitionId, leaseToken, reason: "spec_roundtrip_mismatch" });
    return zeroOutcome("failed", job.id, "spec_roundtrip_mismatch");
  }

  const startedAt = Date.now();
  let ingestionResult: Awaited<ReturnType<typeof ingestPublicPartition>>;
  try {
    ingestionResult = await ingestPublicPartition({
      sourceKey: partition.source_key,
      requests: [built.request],
      traceId: input.traceId,
      operationalContext: { jobRunId: job.id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh discovery threw unexpectedly.";
    await completeJobRun(client, job.id, "failed", null, message);
    const consecutiveFailures = stateBefore.consecutive_failures + 1;
    if (consecutiveFailures >= MARKET_PARTITION_REFRESH_MAX_CONSECUTIVE_FAILURES) {
      await repository.disable({ partitionId: input.partitionId, leaseToken, reason: "repeated_failure" });
    } else {
      await repository.recordFailure({ partitionId: input.partitionId, leaseToken, now, nextDueAt: marketPartitionRefreshFailureBackoffAt(now, stateBefore.consecutive_failures), consecutiveFailures, jobRunId: job.id });
    }
    return zeroOutcome("failed", job.id, "discovery_threw");
  }
  const durationMs = Date.now() - startedAt;
  // Handoff follow-up #3: attempt time stays the claim time (`now`), but
  // success/failure/next-due are anchored to when the work actually finished.
  const finishedAt = new Date().toISOString();

  const telemetry = ingestionResult.queryTelemetry[0];
  const rawItems = telemetry?.rawItems ?? 0;
  const rawNewItems = telemetry?.rawNewItems ?? 0;
  const normalizedItems = telemetry?.normalizedItems ?? 0;
  const conversations = ingestionResult.conversationIds.length;
  const executionStatus = telemetry?.executionStatus ?? (ingestionResult.failedQueryCount ? "provider_error" : "completed_zero_results");

  // Layer 12A.1: best-effort fact, written only after the refresh job row is
  // finalized and from values this refresh already computed. It can never
  // change the refresh outcome, refresh state or cadence.
  const queryPages = telemetryPages(ingestionResult.queryTelemetry[0]);
  const recordSupplyFact = async (refreshStatus: "succeeded" | "failed" | "deferred") => {
    try {
    const providerRequests = ingestionResult.providerMetrics?.requestCount;
    await supplyTelemetry.recordRefresh({
      jobRunId: job.id, marketPartitionId: partition.id, partitionKey: partition.partition_key, sourceKey: partition.source_key,
      refreshStatus, executionStatus, startedAt: job.started_at ?? now, finishedAt,
      rawItems, rawNewItems, normalizedItems, conversationIds: ingestionResult.conversationIds,
      newCanonicalCount: await supplyTelemetry.countNewCanonical(ingestionResult.conversationIds, job.started_at ?? now),
      pagesCompleted: queryPages,
      providerRequestCount: typeof providerRequests === "number" ? providerRequests : null,
      estimatedCost: ingestionResult.estimatedCost, durationMs,
    });
    } catch {
      // Telemetry is observational; it never fails a refresh.
    }
  };
  const storedResult: StoredRefreshJobResult = {
    partitionKey: partition.partition_key,
    sourceKey: partition.source_key,
    policyVersion: MARKET_PARTITION_REFRESH_POLICY_VERSION,
    request: built.request,
    result: { executionStatus, rawItems, rawNewItems, normalizedItems, conversations, estimatedCostUsd: ingestionResult.estimatedCost, durationMs, conversationIds: [...ingestionResult.conversationIds].sort(), normalizedSourceItemIds: [...ingestionResult.normalizedSourceItemIds].sort() },
  };

  // Source-control conflicts ("CONFLICT") surface through ingestPublicPartition's
  // existing per-query error mapping. This is a deferral, not a failure - the
  // source itself said it is temporarily unavailable, which is not a public-
  // ingestion or refresh-policy problem.
  if (ingestionResult.errorCode === "CONFLICT") {
    await completeJobRun(client, job.id, "failed", storedResult, "Source control reported the source as temporarily unavailable.");
    await repository.recordDeferral({ partitionId: input.partitionId, leaseToken, nextDueAt: marketPartitionRefreshDeferralAt(finishedAt) });
    await recordSupplyFact("deferred");
    return { status: "deferred", jobRunId: job.id, rawItems, rawNewItems, normalizedItems, conversations, executionStatus, reason: "source_control_conflict", partitionKey: partition.partition_key, sourceKey: partition.source_key, estimatedCostUsd: ingestionResult.estimatedCost, durationMs };
  }

  if (ingestionResult.failedQueryCount) {
    await completeJobRun(client, job.id, "failed", storedResult, `Refresh query failed (${ingestionResult.errorCode ?? "unknown error"}).`);
    const consecutiveFailures = stateBefore.consecutive_failures + 1;
    if (consecutiveFailures >= MARKET_PARTITION_REFRESH_MAX_CONSECUTIVE_FAILURES) {
      await repository.disable({ partitionId: input.partitionId, leaseToken, reason: "repeated_failure" });
    } else {
      await repository.recordFailure({ partitionId: input.partitionId, leaseToken, now: finishedAt, nextDueAt: marketPartitionRefreshFailureBackoffAt(finishedAt, stateBefore.consecutive_failures), consecutiveFailures, jobRunId: job.id });
    }
    await recordSupplyFact("failed");
    return { status: "failed", jobRunId: job.id, rawItems, rawNewItems, normalizedItems, conversations, executionStatus, reason: ingestionResult.errorCode ?? "provider_error", partitionKey: partition.partition_key, sourceKey: partition.source_key, estimatedCostUsd: ingestionResult.estimatedCost, durationMs };
  }

  // Success, including zero results - a query that legitimately found
  // nothing new is not a failure.
  const interestSince = new Date(Date.parse(finishedAt) - MARKET_PARTITION_REFRESH_INTEREST_WINDOW_MS).toISOString();
  const distinctInterestCount = await repository.countDistinctInterests(partition.partition_key, interestSince);
  // Stage 2F: adaptive cadence (bounded per source) instead of a fixed 24h.
  const decision = adaptiveMarketPartitionCadence({
    sourceKey: partition.source_key as Parameters<typeof adaptiveMarketPartitionCadence>[0]["sourceKey"],
    rawItems,
    rawNewItems,
    consecutiveZeroNewBefore: stateBefore.consecutive_zero_new ?? 0,
    distinctInterestCount,
  });
  const nextDueAt = marketPartitionRefreshNextDueAtAdaptive(input.partitionId, finishedAt, decision.cadenceMs);
  storedResult.cadence = { ...decision, nextDueAt };
  await completeJobRun(client, job.id, "succeeded", storedResult);
  await repository.recordSuccess({
    partitionId: input.partitionId, leaseToken, now: finishedAt, nextDueAt, jobRunId: job.id,
    cadence: { consecutiveZeroNew: decision.consecutiveZeroNew, rawItems, rawNewItems, cadenceSeconds: Math.round(decision.cadenceMs / 1000), policyVersion: decision.policyVersion },
  });
  await recordSupplyFact("succeeded");

  return {
    status: "succeeded",
    jobRunId: job.id,
    rawItems,
    rawNewItems,
    normalizedItems,
    conversations,
    executionStatus,
    partitionKey: partition.partition_key,
    sourceKey: partition.source_key,
    estimatedCostUsd: ingestionResult.estimatedCost,
    durationMs,
    hadRecentInterest: distinctInterestCount > 0,
    distinctInterestCount,
  };
}

export async function ensureMarketPartitionRefreshState(): Promise<{ ensured: number }> {
  const client = createSupabaseServiceClient();
  const repository = new MarketPartitionRefreshRepository(client);
  const now = new Date().toISOString();
  const partitions = await repository.listRefreshableMarketPartitions();
  if (!partitions.length) return { ensured: 0 };
  const existing = await repository.listExistingStatePartitionIds(partitions.map((partition) => partition.id));
  const missing = partitions.filter((partition) => !existing.has(partition.id));
  for (const partition of missing) {
    await repository.ensureStateRow({ partitionId: partition.id, sourceKey: partition.source_key, now });
  }
  return { ensured: missing.length };
}

/**
 * Stage 2F: due selection bounded by the per-tick limit AND the rolling 24h
 * per-source hard cap, so no amount of due partitions can exceed the budget.
 */
export async function listDueMarketPartitionRefreshes(limit: number): Promise<DueMarketPartitionCandidate[]> {
  const client = createSupabaseServiceClient();
  const repository = new MarketPartitionRefreshRepository(client);
  const now = new Date();
  const used = await repository.countRefreshJobsBySourceSince(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
  const remaining: Record<string, number> = remainingDailyRefreshBudget(used);
  const candidates = await repository.listDuePartitions(now.toISOString(), Math.max(limit * 4, limit));
  const selected: DueMarketPartitionCandidate[] = [];
  for (const candidate of candidates) {
    if (!isMarketPartitionRefreshSource(candidate.sourceKey) || (remaining[candidate.sourceKey] ?? 0) <= 0) continue;
    remaining[candidate.sourceKey] -= 1;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}
