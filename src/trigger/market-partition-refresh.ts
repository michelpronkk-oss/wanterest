import { schedules, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { getServerEnv } from "@/server/lib/env";
import { refreshMarketPartition, ensureMarketPartitionRefreshState, listDueMarketPartitionRefreshes } from "@/server/modules/ingestion/market-partition-refresh.service";
import { supplyPartitionSeedingEnabled } from "@/server/modules/operations/supply-partition-seeding.policy";
import { retireExhaustedSeedPartitions } from "@/server/modules/operations/supply-partition-seeding.service";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { incrementalMatchDispatchKey, incrementalProductMatchingEnabled, matchRefreshedPartitionTask } from "./incremental-product-matching";

/**
 * Wanterest 1B Stage 2C: autonomous public market-partition refresh.
 *
 * This is a SEPARATE continuous-refresh path from automatic-monitoring.ts -
 * that system remains unchanged and still runs full product-demand-scans on
 * a per-workspace/product schedule. This scheduler instead operates on
 * global market partitions (Stage 2B identity) and never invokes
 * product-demand-scan, never touches workspace/product data, and stops the
 * moment public evidence is persisted.
 */

function refreshEnabled(): boolean {
  return getServerEnv().MARKET_PARTITION_REFRESH_ENABLED === "true";
}

const MAX_PARTITIONS_PER_TICK = 5;

export const refreshMarketPartitionTask = schemaTask({
  id: "refresh-market-partition",
  queue: { name: "market-partition-refresh", concurrencyLimit: 2 },
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000, factor: 2, randomize: true },
  maxDuration: 600,
  schema: z.object({
    partitionId: z.string().uuid(),
    traceId: z.string().trim().min(1).max(120),
  }),
  run: async (input) => {
    const outcome = await refreshMarketPartition({ partitionId: input.partitionId, traceId: input.traceId });
    // Stage 2D: hand newly persisted public evidence to interested products.
    // Only a fresh success with evidence dispatches; a replayed slot
    // ("already_succeeded_for_slot") already dispatched on its first run, and
    // the dispatch itself is idempotent on the refresh job run id.
    if (outcome.status === "succeeded" && outcome.jobRunId && outcome.conversations > 0 && outcome.reason !== "already_succeeded_for_slot" && incrementalProductMatchingEnabled()) {
      await matchRefreshedPartitionTask.trigger(
        { refreshJobRunId: outcome.jobRunId, traceId: input.traceId },
        { idempotencyKey: incrementalMatchDispatchKey(outcome.jobRunId) },
      );
      return { ...outcome, incrementalMatchDispatched: true };
    }
    return { ...outcome, incrementalMatchDispatched: false };
  },
});

export const marketPartitionRefreshSchedulerTask = schedules.task({
  id: "market-partition-refresh-scheduler",
  cron: { pattern: "0 * * * *", timezone: "UTC" },
  run: async (payload) => {
    if (!refreshEnabled()) {
      return { enabled: false, ensured: 0, due: 0, dispatched: 0, scheduledAt: payload.timestamp };
    }
    const ensured = await ensureMarketPartitionRefreshState();
    // Layer 12A.2: conservative seed retirement before due selection (flag-gated; never fails the tick).
    let seedRetirement: { retired: number } | { error: true } | null = null;
    if (supplyPartitionSeedingEnabled()) {
      try { seedRetirement = await retireExhaustedSeedPartitions({ client: createSupabaseServiceClient() }); } catch { seedRetirement = { error: true }; }
    }
    const due = await listDueMarketPartitionRefreshes(MAX_PARTITIONS_PER_TICK);
    if (due.length) {
      await refreshMarketPartitionTask.batchTrigger(
        due.map((candidate) => ({
          payload: { partitionId: candidate.partitionId, traceId: `market-partition-refresh:${candidate.partitionId}:${candidate.nextDueAt}` },
          options: { idempotencyKey: `refresh-market-partition:${candidate.partitionId}:${candidate.nextDueAt}` },
        })),
      );
    }
    return { enabled: true, ensured: ensured.ensured, due: due.length, dispatched: due.length, scheduledAt: payload.timestamp, ...(seedRetirement ? { seedRetirement } : {}) };
  },
});
