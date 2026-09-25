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

/**
 * Wanterest 1B Stage 2F: adaptive cadence. Pure and deterministic.
 *
 * The next refresh interval adapts to what the partition actually produced,
 * bounded per source by hard minimum/maximum intervals:
 * - novelty (raw new items / raw items) shortens the interval when a
 *   partition keeps producing new public evidence;
 * - consecutive zero-new refreshes back off exponentially (capped);
 * - broader product interest mildly shortens the interval.
 * Plan entitlement deliberately does NOT affect global cadence: the same
 * public partition is retrieved once for everyone, never per plan.
 */
export const MARKET_PARTITION_CADENCE_POLICY_VERSION = "market_partition_cadence_v2" as const;

const HOUR_MS = 60 * 60 * 1000;
export const MARKET_PARTITION_CADENCE_BY_SOURCE: Readonly<Record<MarketPartitionRefreshSourceKey, { baseMs: number; minMs: number; maxMs: number }>> = {
  github: { baseMs: 12 * HOUR_MS, minMs: 6 * HOUR_MS, maxMs: 7 * 24 * HOUR_MS },
  "stack-exchange": { baseMs: 24 * HOUR_MS, minMs: 12 * HOUR_MS, maxMs: 7 * 24 * HOUR_MS },
};

/** Hard global ceilings: refresh jobs per source per rolling 24h, regardless of how many partitions are due. */
export const MARKET_PARTITION_REFRESH_DAILY_CAP: Readonly<Record<MarketPartitionRefreshSourceKey, number>> = {
  github: 120,
  "stack-exchange": 60,
};

const MAX_ZERO_NEW_BACKOFF_STEPS = 4;
const BROAD_INTEREST_PRODUCTS = 3;

export type AdaptiveCadenceInput = {
  sourceKey: MarketPartitionRefreshSourceKey;
  rawItems: number;
  rawNewItems: number;
  consecutiveZeroNewBefore: number;
  distinctInterestCount: number;
};

export type AdaptiveCadenceDecision = {
  policyVersion: typeof MARKET_PARTITION_CADENCE_POLICY_VERSION;
  cadenceMs: number;
  consecutiveZeroNew: number;
  novelty: number;
  factors: { novelty: number; zeroNewBackoff: number; interest: number };
  clamped: "min" | "max" | null;
};

export function adaptiveMarketPartitionCadence(input: AdaptiveCadenceInput): AdaptiveCadenceDecision {
  const bounds = MARKET_PARTITION_CADENCE_BY_SOURCE[input.sourceKey];
  const rawItems = Math.max(0, Math.floor(input.rawItems));
  const rawNewItems = Math.min(rawItems, Math.max(0, Math.floor(input.rawNewItems)));
  const novelty = rawItems ? rawNewItems / rawItems : 0;
  const consecutiveZeroNew = rawNewItems === 0 ? Math.max(0, Math.floor(input.consecutiveZeroNewBefore)) + 1 : 0;
  const noveltyFactor = rawNewItems === 0 ? 1 : novelty >= 0.5 ? 0.5 : novelty >= 0.2 ? 0.75 : 1;
  const zeroNewBackoff = consecutiveZeroNew ? 2 ** Math.min(consecutiveZeroNew, MAX_ZERO_NEW_BACKOFF_STEPS) : 1;
  const interestFactor = input.distinctInterestCount >= BROAD_INTEREST_PRODUCTS ? 0.75 : 1;
  const raw = bounds.baseMs * noveltyFactor * zeroNewBackoff * interestFactor;
  const cadenceMs = Math.round(Math.min(bounds.maxMs, Math.max(bounds.minMs, raw)));
  return {
    policyVersion: MARKET_PARTITION_CADENCE_POLICY_VERSION,
    cadenceMs,
    consecutiveZeroNew,
    novelty: Number(novelty.toFixed(4)),
    factors: { novelty: noveltyFactor, zeroNewBackoff, interest: interestFactor },
    clamped: raw < bounds.minMs ? "min" : raw > bounds.maxMs ? "max" : null,
  };
}

export function marketPartitionRefreshNextDueAtAdaptive(partitionId: string, completedAtIso: string, cadenceMs: number): string {
  const jitterMs = marketPartitionRefreshJitterMinutes(partitionId) * 60_000;
  return new Date(Date.parse(completedAtIso) + cadenceMs + jitterMs).toISOString();
}

/** Remaining refresh budget per source for the rolling 24h window. */
export function remainingDailyRefreshBudget(usedBySource: Record<string, number>): Record<MarketPartitionRefreshSourceKey, number> {
  return Object.fromEntries(MARKET_PARTITION_REFRESH_SOURCE_KEYS.map((sourceKey) => [sourceKey, Math.max(0, MARKET_PARTITION_REFRESH_DAILY_CAP[sourceKey] - (usedBySource[sourceKey] ?? 0))])) as Record<MarketPartitionRefreshSourceKey, number>;
}
