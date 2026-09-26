import "server-only";

import { SEED_MAX_PARTITIONS_PER_SOURCE, MARKET_PARTITION_INTEREST_TTL_MS, SEED_MAX_PER_PRODUCT_PER_SOURCE, SEED_RETIREMENT_MAX_PER_TICK, SEED_RETIREMENT_MIN_REFRESHES, SEED_RETIREMENT_WINDOW_DAYS, selectExecutedQueryInterests, selectPartitionSeeds, SUPPLY_PARTITION_SEEDING_VERSION, type SeedSkipReason } from "./supply-partition-seeding.policy";
import { SupplyPartitionInterestRepository, type InterestUpsertStatus } from "./supply-partition-interest.repository";
import { buildQueryPlanSeedCandidates } from "./query-planning.service";
import type { QueryPlanningInput } from "./query-planning.schemas";
import { liveMarketPartitionRefreshSourceKeys, type MarketPartitionRefreshSourceKey } from "@/server/modules/ingestion/market-partition-refresh.policy";
import { deterministicUuid } from "@/server/modules/ingestion/hash";
import { MARKET_PARTITION_IDENTITY_VERSION } from "@/server/modules/ingestion/market-partition-identity";

/**
 * Layer 12A.2: persists planner seeds and scan interests for ONE finished
 * product scan. Metadata/persistence only: no provider request, no model
 * call, no retrieval. Runs after the scan's own work is recorded and never
 * changes what the scan executed or returns; every failure is contained and
 * reported as a count.
 */

export type ExecutedQueryRow = { source: string; queryPlanId: string; executionStatus: string; marketPartitionKey?: string | null; discoveryProvenance?: unknown };

export type SupplyPartitionSeedingOutcome = {
  version: typeof SUPPLY_PARTITION_SEEDING_VERSION;
  plannerCandidates: number;
  seedsSelected: number;
  seeds: Partial<Record<InterestUpsertStatus | "error", number>>;
  scanInterests: Partial<Record<InterestUpsertStatus | "error", number>>;
  skipped: Partial<Record<SeedSkipReason, number>>;
};

type Repository = Pick<SupplyPartitionInterestRepository, "upsertInterest">;

function bump<K extends string>(counts: Partial<Record<K, number>>, key: K): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export async function seedSupplyPartitionsForScan(input: {
  client: unknown;
  workspaceId: string;
  productId: string;
  scanJobRunId: string;
  planningInput: QueryPlanningInput;
  executed: ExecutedQueryRow[];
  now?: Date;
  repository?: Repository;
}): Promise<SupplyPartitionSeedingOutcome> {
  const now = input.now ?? new Date();
  const repository = input.repository ?? new SupplyPartitionInterestRepository(input.client);
  const nowIso = now.toISOString();
  const ttlSeconds = Math.floor(MARKET_PARTITION_INTEREST_TTL_MS / 1000);
  const outcome: SupplyPartitionSeedingOutcome = { version: SUPPLY_PARTITION_SEEDING_VERSION, plannerCandidates: 0, seedsSelected: 0, seeds: {}, scanInterests: {}, skipped: {} };
  const common = {
    workspaceId: input.workspaceId, productId: input.productId, originJobRunId: input.scanJobRunId, now: nowIso, ttlSeconds,
    maxSeedsPerProductSource: SEED_MAX_PER_PRODUCT_PER_SOURCE,
  };

  // 1. Scan interests first: an executed query outranks a seed for the same partition.
  const executedInterests = selectExecutedQueryInterests(input.executed);
  for (const interest of executedInterests) {
    try {
      bump(outcome.scanInterests, await repository.upsertInterest({
        ...common, origin: "scan", partitionId: deterministicUuid(`market-partition:${interest.partitionKey}`), partitionKey: interest.partitionKey,
        identityVersion: MARKET_PARTITION_IDENTITY_VERSION, sourceKey: interest.sourceKey, retrievalSpec: null, queryPlanId: interest.queryPlanId,
        provenance: interest.provenance as unknown as Record<string, unknown>, seedVersion: null, seedMetadata: {},
        maxSeededPartitionsPerSource: SEED_MAX_PARTITIONS_PER_SOURCE[interest.sourceKey as MarketPartitionRefreshSourceKey],
      }));
    } catch {
      bump(outcome.scanInterests, "error");
    }
  }

  // 2. Planner seeds: the planner's own non-executed candidates, bounded and deduplicated.
  const candidates = buildQueryPlanSeedCandidates(input.planningInput, liveMarketPartitionRefreshSourceKeys());
  outcome.plannerCandidates = candidates.length;
  const selection = selectPartitionSeeds({
    candidates,
    executedQueryPlanIds: new Set(input.executed.map((row) => row.queryPlanId)),
    executedPartitionKeys: new Set(input.executed.map((row) => row.marketPartitionKey).filter((key): key is string => typeof key === "string" && key.length > 0)),
    now,
  });
  outcome.seedsSelected = selection.seeds.length;
  for (const skip of selection.skipped) bump(outcome.skipped, skip.reason);
  for (const seed of selection.seeds) {
    try {
      bump(outcome.seeds, await repository.upsertInterest({
        ...common, origin: "planner_seed", partitionId: seed.partitionId, partitionKey: seed.partitionKey, identityVersion: seed.identityVersion,
        sourceKey: seed.sourceKey, retrievalSpec: seed.retrievalSpec as unknown as Record<string, unknown>, queryPlanId: seed.queryPlanId,
        provenance: seed.provenance as unknown as Record<string, unknown>, seedVersion: SUPPLY_PARTITION_SEEDING_VERSION, seedMetadata: seed.metadata,
        maxSeededPartitionsPerSource: SEED_MAX_PARTITIONS_PER_SOURCE[seed.sourceKey],
      }));
    } catch {
      bump(outcome.seeds, "error");
    }
  }
  return outcome;
}

/**
 * Layer 12A.2 conservative retirement pass (flag-gated by the caller). Only
 * seed-only partitions whose last refreshes are ALL covered by 12A.1 facts
 * showing zero new items and zero qualified evidence retire; with missing
 * telemetry nothing retires (fails closed). Bounded per tick.
 */
export async function retireExhaustedSeedPartitions(input: { client: unknown; now?: Date; repository?: Pick<SupplyPartitionInterestRepository, "retireExhaustedSeedPartitions"> }): Promise<{ retired: number }> {
  const repository = input.repository ?? new SupplyPartitionInterestRepository(input.client);
  const retired = await repository.retireExhaustedSeedPartitions({ now: (input.now ?? new Date()).toISOString(), minRefreshes: SEED_RETIREMENT_MIN_REFRESHES, windowDays: SEED_RETIREMENT_WINDOW_DAYS, limit: SEED_RETIREMENT_MAX_PER_TICK });
  return { retired };
}
