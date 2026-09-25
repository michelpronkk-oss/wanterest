import { schedules, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { getServerEnv } from "@/server/lib/env";
import { refreshMarketPartition, ensureMarketPartitionRefreshState, listDueMarketPartitionRefreshes } from "@/server/modules/ingestion/market-partition-refresh.service";

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
    return refreshMarketPartition({ partitionId: input.partitionId, traceId: input.traceId });
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
    const due = await listDueMarketPartitionRefreshes(MAX_PARTITIONS_PER_TICK);
    if (due.length) {
      await refreshMarketPartitionTask.batchTrigger(
        due.map((candidate) => ({
          payload: { partitionId: candidate.partitionId, traceId: `market-partition-refresh:${candidate.partitionId}:${candidate.nextDueAt}` },
          options: { idempotencyKey: `refresh-market-partition:${candidate.partitionId}:${candidate.nextDueAt}` },
        })),
      );
    }
    return { enabled: true, ensured: ensured.ensured, due: due.length, dispatched: due.length, scheduledAt: payload.timestamp };
  },
});
