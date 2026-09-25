import "server-only";

import { sourceDiscoveryRequestSchema, type SourceDiscoveryRequest } from "@/server/providers/source/contracts";
import type { MarketPartitionRetrievalSpec } from "@/server/modules/ingestion/market-partition-identity";

/**
 * Wanterest 1B Stage 2C: pure refresh execution policy for the autonomous
 * market-partition refresh seam. Everything here is deterministic and reads
 * no external state - the service layer owns claiming, persistence, and
 * calling ingestPublicPartition.
 */

export const MARKET_PARTITION_REFRESH_POLICY_VERSION = "market_partition_refresh_policy_v1" as const;

/**
 * v1 automatic-refresh allowlist. Deliberately narrower than every source
 * Stage 2B can derive a partition identity for: this proves the autonomous
 * refresh seam on two production-proven, quota-safe sources before widening
 * it. X is excluded so continuous refresh adds zero spend beyond the frozen
 * product-scan X experiment. YouTube is excluded because one refresh can
 * consume ~103 API quota units and there is no global YouTube quota ledger
 * yet. This does not change what any of these sources do inside a product
 * scan - only what the Stage 2C scheduler may refresh on its own.
 */
export const MARKET_PARTITION_REFRESH_SOURCE_KEYS = ["github", "stack-exchange"] as const;
export type MarketPartitionRefreshSourceKey = (typeof MARKET_PARTITION_REFRESH_SOURCE_KEYS)[number];

export function isMarketPartitionRefreshSource(sourceKey: string): sourceKey is MarketPartitionRefreshSourceKey {
  return (MARKET_PARTITION_REFRESH_SOURCE_KEYS as readonly string[]).includes(sourceKey);
}

/** Refresh execution settings. These never participate in partition identity (Stage 2B params allowlist). */
export const MARKET_PARTITION_REFRESH_LIMIT = 10;
export const MARKET_PARTITION_REFRESH_MAX_PAGES = 1;

const CADENCE_MS = 24 * 60 * 60 * 1000;
const JITTER_BUCKET_MINUTES = 60;
const MAX_BACKOFF_HOURS = 24;
const MIN_BACKOFF_HOURS = 1;
export const MARKET_PARTITION_REFRESH_MAX_CONSECUTIVE_FAILURES = 5;
/** Short, non-failure deferral when the source itself reports it's unavailable (source-control conflict). */
const SOURCE_CONFLICT_DEFERRAL_MS = 60 * 60 * 1000;
/** How far back product-scan interest still counts as "recent" for due selection. */
export const MARKET_PARTITION_REFRESH_INTEREST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** A partition a product scan already fetched this recently is not independently refreshed. */
export const MARKET_PARTITION_REFRESH_RECENT_SCAN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Deterministic, stable per-partition jitter so refreshes for different partitions don't thunder-herd on the hour. */
export function marketPartitionRefreshJitterMinutes(partitionId: string): number {
  let hash = 0;
  for (let index = 0; index < partitionId.length; index += 1) {
    hash = (hash * 31 + partitionId.charCodeAt(index)) >>> 0;
  }
  return hash % JITTER_BUCKET_MINUTES;
}

export function marketPartitionRefreshNextDueAtAfterSuccess(partitionId: string, completedAtIso: string): string {
  const jitterMs = marketPartitionRefreshJitterMinutes(partitionId) * 60_000;
  return new Date(Date.parse(completedAtIso) + CADENCE_MS + jitterMs).toISOString();
}

export function marketPartitionRefreshFailureBackoffAt(nowIso: string, consecutiveFailuresBeforeThisOne: number): string {
  const hours = Math.min(MAX_BACKOFF_HOURS, Math.max(MIN_BACKOFF_HOURS, 2 ** consecutiveFailuresBeforeThisOne));
  return new Date(Date.parse(nowIso) + hours * 60 * 60_000).toISOString();
}

export function marketPartitionRefreshDeferralAt(nowIso: string): string {
  return new Date(Date.parse(nowIso) + SOURCE_CONFLICT_DEFERRAL_MS).toISOString();
}

export type MarketPartitionRefreshRequestResult =
  | { ok: true; request: SourceDiscoveryRequest }
  | { ok: false; reason: "source_not_refreshable" | "empty_expression" };

/**
 * Rebuilds the exact SourceDiscoveryRequest a refresh should send, from the
 * immutable Stage 2B retrieval_spec alone - no workspace, product, or
 * planner input. Execution settings (limit, maxPages) are refresh policy,
 * not identity, and are deliberately kept out of the Stage 2B params
 * allowlist so they never change the partition key.
 */
export function buildMarketPartitionRefreshRequest(input: { sourceKey: string; retrievalSpec: MarketPartitionRetrievalSpec }): MarketPartitionRefreshRequestResult {
  if (!isMarketPartitionRefreshSource(input.sourceKey)) return { ok: false, reason: "source_not_refreshable" };
  const expression = input.retrievalSpec.expression.trim();
  if (!expression) return { ok: false, reason: "empty_expression" };
  const request = sourceDiscoveryRequestSchema.parse({
    query: expression,
    expandThreads: input.retrievalSpec.expandThreads,
    limit: MARKET_PARTITION_REFRESH_LIMIT,
    requestMetadata: {
      ...input.retrievalSpec.params,
      maxPages: MARKET_PARTITION_REFRESH_MAX_PAGES,
    },
  });
  return { ok: true, request };
}
