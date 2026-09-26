import "server-only";

import type { InterestArtifact } from "./incremental-product-matching.policy";

/**
 * Layer 12A.2 persistence for explicit market partition interests.
 * Service-role only. All writes go through the atomic, capped
 * upsert_market_partition_interest RPC; all reads go through the single
 * canonical active_market_partition_interests read path (unexpired, not
 * deactivated, active products only). Untyped against the generated client,
 * same pattern as the other market-partition repositories.
 */

type ErrorResult = { code?: string; message?: string } | null;
type Client = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: ErrorResult }> };

export type InterestUpsertStatus = "created" | "renewed" | "retired" | "product_inactive" | "product_cap_reached" | "source_cap_reached" | "partition_missing";
const statuses = new Set<InterestUpsertStatus>(["created", "renewed", "retired", "product_inactive", "product_cap_reached", "source_cap_reached", "partition_missing"]);

export type InterestUpsertInput = {
  workspaceId: string;
  productId: string;
  origin: "scan" | "planner_seed";
  originJobRunId: string;
  partitionId: string;
  partitionKey: string;
  identityVersion: string;
  sourceKey: string;
  retrievalSpec: Record<string, unknown> | null;
  queryPlanId: string;
  provenance: Record<string, unknown>;
  seedVersion: string | null;
  seedMetadata: Record<string, unknown>;
  now: string;
  ttlSeconds: number;
  maxSeededPartitionsPerSource: number;
  maxSeedsPerProductSource: number;
};

export type ActivePartitionInterest = {
  id: string;
  workspaceId: string;
  productId: string;
  partitionKey: string;
  sourceKey: string;
  origin: "scan" | "planner_seed";
  originJobRunId: string;
  queryPlanId: string;
  provenance: unknown;
  renewedAt: string;
  expiresAt: string;
};

function persistenceError(error: ErrorResult, context: string): Error {
  const code = error?.code ? ` (${error.code})` : "";
  const message = error?.message ? `: ${error.message.slice(0, 180)}` : "";
  return new Error(`Market partition interest persistence failed during ${context}${code}${message}`);
}

export class SupplyPartitionInterestRepository {
  constructor(private readonly client: unknown) {}

  async upsertInterest(input: InterestUpsertInput): Promise<InterestUpsertStatus> {
    const { data, error } = await (this.client as Client).rpc("upsert_market_partition_interest", {
      p_workspace_id: input.workspaceId,
      p_product_id: input.productId,
      p_origin: input.origin,
      p_origin_job_run_id: input.originJobRunId,
      p_partition_id: input.partitionId,
      p_partition_key: input.partitionKey,
      p_identity_version: input.identityVersion,
      p_source_key: input.sourceKey,
      p_retrieval_spec: input.retrievalSpec,
      p_query_plan_id: input.queryPlanId,
      p_provenance: input.provenance,
      p_seed_version: input.seedVersion,
      p_seed_metadata: input.seedMetadata,
      p_now: input.now,
      p_ttl_seconds: input.ttlSeconds,
      p_max_seeded_partitions_per_source: input.maxSeededPartitionsPerSource,
      p_max_seeds_per_product_source: input.maxSeedsPerProductSource,
    });
    if (error) throw persistenceError(error, "interest upsert");
    if (typeof data !== "string" || !statuses.has(data as InterestUpsertStatus)) throw new Error("Market partition interest upsert returned an unexpected status.");
    return data as InterestUpsertStatus;
  }

  async listActive(partitionKeys: string[], now: string, limit = 1000): Promise<ActivePartitionInterest[]> {
    if (!partitionKeys.length) return [];
    const { data, error } = await (this.client as Client).rpc("active_market_partition_interests", { p_partition_keys: partitionKeys, p_now: now, p_limit: limit });
    if (error) throw persistenceError(error, "active interest lookup");
    return ((data as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      productId: row.product_id as string,
      partitionKey: row.partition_key as string,
      sourceKey: row.source_key as string,
      origin: row.origin as "scan" | "planner_seed",
      originJobRunId: row.origin_job_run_id as string,
      queryPlanId: row.query_plan_id as string,
      provenance: row.provenance ?? null,
      renewedAt: row.renewed_at as string,
      expiresAt: row.expires_at as string,
    }));
  }

  async retireExhaustedSeedPartitions(input: { now: string; minRefreshes: number; windowDays: number; limit: number }): Promise<number> {
    const { data, error } = await (this.client as Client).rpc("retire_exhausted_seed_partitions", { p_now: input.now, p_min_refreshes: input.minRefreshes, p_window_days: input.windowDays, p_limit: input.limit });
    if (error) throw persistenceError(error, "seed retirement");
    return typeof data === "number" ? data : 0;
  }
}

/**
 * Maps an explicit interest onto the existing interest-artifact contract so
 * incremental matching keeps ONE selection policy (selectInterestedProducts)
 * and ONE provenance validation (parseDiscoveryProvenanceTemplate) for both
 * scan-created and planner-seeded interest.
 */
export function interestAsArtifact(interest: ActivePartitionInterest): InterestArtifact {
  return {
    id: interest.id,
    workspaceId: interest.workspaceId,
    productId: interest.productId,
    jobRunId: interest.originJobRunId,
    queryPlanId: interest.queryPlanId,
    sourceKey: interest.sourceKey,
    createdAt: interest.renewedAt,
    discoveryProvenance: interest.provenance,
    interestOrigin: interest.origin,
  };
}
