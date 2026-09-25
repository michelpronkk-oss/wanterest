import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { getServerEnv } from "@/server/lib/env";
import { matchRefreshedPartitionIncrementally } from "@/server/modules/operations/incremental-product-matching.service";

/**
 * Wanterest 1B Stage 2D: incremental product matching for one successful
 * global market-partition refresh. Dispatched by refresh-market-partition
 * (never by a product scan), keyed by the refresh job run id so a replayed
 * refresh or a retried dispatch cannot produce a second fanout.
 */

export function incrementalProductMatchingEnabled(): boolean {
  return getServerEnv().INCREMENTAL_PRODUCT_MATCHING_ENABLED === "true";
}

export function incrementalMatchDispatchKey(refreshJobRunId: string): string {
  return `match-partition-incremental:${refreshJobRunId}`;
}

export const matchRefreshedPartitionTask = schemaTask({
  id: "match-refreshed-partition",
  queue: { name: "incremental-product-matching", concurrencyLimit: 1 },
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000, factor: 2, randomize: true },
  maxDuration: 900,
  schema: z.object({
    refreshJobRunId: z.string().uuid(),
    traceId: z.string().trim().min(1).max(120),
  }),
  run: async (input) => {
    // Kill switch is re-checked at execution time so disabling the flag also
    // stops already-queued runs.
    if (!incrementalProductMatchingEnabled()) return { status: "skipped", reason: "disabled", refreshJobRunId: input.refreshJobRunId };
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: input.refreshJobRunId, traceId: input.traceId });
    // A failed product is retried by Trigger; products that already
    // succeeded short-circuit on their own job_runs idempotency key.
    if (outcome.status === "failed") throw new Error(`Incremental product matching failed for refresh ${input.refreshJobRunId}.`);
    return outcome;
  },
});
