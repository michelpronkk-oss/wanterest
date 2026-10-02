import "server-only";

import { deterministicUuid, sha256Json } from "@/server/modules/ingestion/hash";
import { MARKET_SOURCE_FAMILY_TAXONOMY_VERSION, marketCoverageIdentityInputSchema, type MarketCoverageIdentityInput } from "./market-coverage.contracts";

export const MARKET_COVERAGE_IDENTITY_VERSION = "market_coverage_partition_v1" as const;

export type MarketCoveragePartitionIdentity = {
  partitionKey: `${typeof MARKET_COVERAGE_IDENTITY_VERSION}:${string}`;
  partitionId: string;
  identityVersion: typeof MARKET_COVERAGE_IDENTITY_VERSION;
  dimensions: ReturnType<typeof marketCoverageIdentityInputSchema.parse>;
};

/** Stable identity for a reviewed public taxonomy slice; it cannot accept workspace, product, query, freshness, or yield inputs. */
export function deriveMarketCoveragePartitionIdentity(input: MarketCoverageIdentityInput): MarketCoveragePartitionIdentity {
  const dimensions = marketCoverageIdentityInputSchema.parse(input);
  const partitionKey = `${MARKET_COVERAGE_IDENTITY_VERSION}:${sha256Json({
    v: MARKET_COVERAGE_IDENTITY_VERSION,
    source_family_taxonomy_version: MARKET_SOURCE_FAMILY_TAXONOMY_VERSION,
    ...dimensions,
  })}` as const;
  return {
    partitionKey,
    partitionId: deterministicUuid(`market-coverage:${partitionKey}`),
    identityVersion: MARKET_COVERAGE_IDENTITY_VERSION,
    dimensions,
  };
}
