import "server-only";

import { deriveMarketPartitionIdentity, MARKET_PARTITION_IDENTITY_VERSION, type MarketPartitionRetrievalSpec } from "@/server/modules/ingestion/market-partition-identity";
import {
  buildMarketPartitionRefreshRequest,
  hnAlgoliaSearchEnabled,
  isMarketPartitionRefreshSource,
  MARKET_PARTITION_REFRESH_INTEREST_WINDOW_MS,
  type MarketPartitionRefreshSourceKey,
} from "@/server/modules/ingestion/market-partition-refresh.policy";
import { discoveryProvenanceTemplate, type DiscoveryProvenanceTemplate } from "@/server/modules/ingestion/public-ingestion.service";
import { prepareStackExchangeFeatureRequest } from "@/server/providers/source/stack-exchange";
import { parseDiscoveryProvenanceTemplate } from "./incremental-product-matching.policy";
import { toSourceDiscoveryRequest } from "./query-planning.execution";
import type { QueryPlanQuery, QueryPlanSource } from "./query-planning.schemas";

/**
 * Layer 12A.2: planner-seeded shared market partitions. Pure and
 * deterministic; reads no external state and calls no provider or model.
 *
 * A seed is a query_planning_v7 candidate the product scan did NOT execute,
 * turned into exactly the provider request executing it would have sent,
 * then into its market_partition_identity_v1 key. Nothing here changes which
 * queries a scan executes; seeds are persisted as reusable partitions plus an
 * explicit, expiring product interest, and are only ever retrieved later by
 * the existing background refresh scheduler inside its source caps/cadence.
 */

export const SUPPLY_PARTITION_SEEDING_VERSION = "supply_partition_seeding_v1" as const;
export const MARKET_PARTITION_INTEREST_VERSION = "market_partition_interest_v1" as const;

/** Max planner seeds one product may hold per refreshable source (active, unexpired). */
export const SEED_MAX_PER_PRODUCT_PER_SOURCE = 6;
/**
 * Global ceiling on distinct partitions kept alive by planner seeds, per
 * source. Sized so that at base cadence (GitHub 12h, Stack Exchange 24h)
 * seed-driven refreshes alone stay inside the existing rolling-24h refresh
 * caps (120 / 60), which remain the hard spend bound regardless.
 */
export const SEED_MAX_PARTITIONS_PER_SOURCE: Readonly<Record<MarketPartitionRefreshSourceKey, number>> = {
  github: 60,
  "stack-exchange": 60,
  "hacker-news": 60,
};
/** Interest lifetime; equals the existing 14-day interest window, renewed by each scan of an active product. */
export const MARKET_PARTITION_INTEREST_TTL_MS = MARKET_PARTITION_REFRESH_INTEREST_WINDOW_MS;
/** Retirement: last N refreshes all zero-new with zero qualified evidence (12A.1 facts required). */
export const SEED_RETIREMENT_MIN_REFRESHES = 6;
export const SEED_RETIREMENT_WINDOW_DAYS = 30;
export const SEED_RETIREMENT_MAX_PER_TICK = 20;

export function supplyPartitionSeedingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SUPPLY_PARTITION_SEEDING_ENABLED === "true";
}

export type SeedSkipReason =
  | "source_not_refreshable"
  | "executed_by_scan"
  | "identity_ineligible"
  | "spec_not_refreshable"
  | "partition_executed_by_scan"
  | "duplicate_partition"
  | "provenance_invalid"
  | "per_source_cap";

export type PartitionSeed = {
  sourceKey: MarketPartitionRefreshSourceKey;
  queryPlanId: string;
  partitionId: string;
  partitionKey: string;
  identityVersion: typeof MARKET_PARTITION_IDENTITY_VERSION;
  retrievalSpec: MarketPartitionRetrievalSpec;
  provenance: DiscoveryProvenanceTemplate;
  metadata: {
    seedOrigin: "query_planning_v7";
    queryFamily: string;
    demandSurface: string;
    intentType: string;
    conceptKeys: string[];
    competitorSpecific: boolean;
    languageContext: string | null;
  };
};

export type SeedSelection = {
  seeds: PartitionSeed[];
  skipped: Array<{ queryPlanId: string; sourceKey: string; reason: SeedSkipReason }>;
};

function sourcePlanFor(query: QueryPlanQuery): QueryPlanSource {
  return { source_key: query.source_key, priority: query.priority, candidate_budget: query.candidate_budget, query_budget: 1, queries: [query], excluded_query_families: [], reason_codes: [], confidence: query.confidence };
}

/**
 * Selects the bounded, deterministic seed set from planner candidates (in the
 * planner's own order). Every seed must: be on a background-refreshable
 * source; not be a query this scan executed; derive an eligible identity from
 * the exact request execution would send (Stack Exchange preparation
 * included, as in ingestion); round-trip through the refresh request builder
 * to the same key (a spec the scheduler would disable is never seeded); map
 * to a partition this scan did not already execute; carry a valid canonical
 * provenance template for its own query id and source; and fit the
 * per-source cap. Duplicate planner candidates collapse onto one partition.
 */
export function selectPartitionSeeds(input: {
  candidates: QueryPlanQuery[];
  executedQueryPlanIds: ReadonlySet<string>;
  executedPartitionKeys: ReadonlySet<string>;
  now: Date;
  maxPerSource?: number;
}): SeedSelection {
  const maxPerSource = Math.max(0, Math.floor(input.maxPerSource ?? SEED_MAX_PER_PRODUCT_PER_SOURCE));
  const seeds: PartitionSeed[] = [];
  const skipped: SeedSelection["skipped"] = [];
  const seenKeys = new Set<string>();
  const perSource = new Map<string, number>();
  for (const query of input.candidates) {
    const skip = (reason: SeedSkipReason) => skipped.push({ queryPlanId: query.query_id, sourceKey: query.source_key, reason });
    const sourceKey = query.source_key;
    if (!isMarketPartitionRefreshSource(sourceKey)) { skip("source_not_refreshable"); continue; }
    if (input.executedQueryPlanIds.has(query.query_id)) { skip("executed_by_scan"); continue; }
    const planned = toSourceDiscoveryRequest({ sourcePlan: sourcePlanFor(query), query, maxPages: 1, hnAlgoliaSearchEnabled: hnAlgoliaSearchEnabled() });
    const request = sourceKey === "stack-exchange" ? prepareStackExchangeFeatureRequest(planned, input.now) : planned;
    const identity = deriveMarketPartitionIdentity({ sourceKey, request });
    if (!identity.eligible) { skip("identity_ineligible"); continue; }
    const rebuilt = buildMarketPartitionRefreshRequest({ sourceKey, retrievalSpec: identity.retrievalSpec });
    const roundTrip = rebuilt.ok ? deriveMarketPartitionIdentity({ sourceKey, request: rebuilt.request }) : null;
    if (!roundTrip?.eligible || roundTrip.partitionKey !== identity.partitionKey) { skip("spec_not_refreshable"); continue; }
    if (input.executedPartitionKeys.has(identity.partitionKey)) { skip("partition_executed_by_scan"); continue; }
    if (seenKeys.has(identity.partitionKey)) { skip("duplicate_partition"); continue; }
    const template = discoveryProvenanceTemplate(request, sourceKey);
    const provenance = template ? parseDiscoveryProvenanceTemplate({ discoveryProvenance: template, queryPlanId: query.query_id, sourceKey }) : null;
    if (!provenance) { skip("provenance_invalid"); continue; }
    if ((perSource.get(sourceKey) ?? 0) >= maxPerSource) { skip("per_source_cap"); continue; }
    seenKeys.add(identity.partitionKey);
    perSource.set(sourceKey, (perSource.get(sourceKey) ?? 0) + 1);
    seeds.push({
      sourceKey,
      queryPlanId: query.query_id,
      partitionId: identity.partitionId,
      partitionKey: identity.partitionKey,
      identityVersion: identity.identityVersion,
      retrievalSpec: identity.retrievalSpec,
      provenance,
      metadata: {
        seedOrigin: "query_planning_v7",
        queryFamily: query.query_family,
        demandSurface: query.demand_surface,
        intentType: query.intent_type,
        conceptKeys: [...query.concept_keys].sort(),
        competitorSpecific: query.competitor_specific,
        languageContext: query.language_context,
      },
    });
  }
  return { seeds, skipped };
}

export type ExecutedQueryInterest = {
  sourceKey: string;
  queryPlanId: string;
  partitionKey: string;
  provenance: DiscoveryProvenanceTemplate;
};

/**
 * Scan-origin interests: queries this scan actually executed on a refreshable
 * source whose partition key and provenance were recorded by ingestion. The
 * provenance must parse for its own query id/source - never repaired here.
 */
export function selectExecutedQueryInterests(rows: Array<{ source: string; queryPlanId: string; executionStatus: string; marketPartitionKey?: string | null; discoveryProvenance?: unknown }>): ExecutedQueryInterest[] {
  const byKey = new Map<string, ExecutedQueryInterest>();
  for (const row of rows) {
    if (!isMarketPartitionRefreshSource(row.source) || !row.marketPartitionKey) continue;
    if (row.executionStatus !== "completed_with_results" && row.executionStatus !== "completed_zero_results") continue;
    const provenance = parseDiscoveryProvenanceTemplate({ discoveryProvenance: row.discoveryProvenance ?? null, queryPlanId: row.queryPlanId, sourceKey: row.source });
    if (!provenance || byKey.has(row.marketPartitionKey)) continue;
    byKey.set(row.marketPartitionKey, { sourceKey: row.source, queryPlanId: row.queryPlanId, partitionKey: row.marketPartitionKey, provenance });
  }
  return [...byKey.values()].sort((a, b) => a.partitionKey.localeCompare(b.partitionKey));
}
