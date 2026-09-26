import "server-only";

import { deterministicUuid, sha256Json } from "@/server/modules/ingestion/hash";
import type { SourceDiscoveryRequest } from "@/server/providers/source/contracts";

/**
 * Wanterest 1B Stage 2B: pure identity derivation for a tenant-free public
 * market partition.
 *
 * A market partition is ONE retrieval spec - the literal, provider-executed
 * search operation that determines which public results come back. It is not
 * a concept, a demand surface, or a competitor relationship. Two requests
 * from two different products, workspaces, or scans collapse onto the same
 * partition key whenever the literal retrieval spec is identical.
 *
 * This module must never read workspace/product identifiers, planner
 * metadata (query_family, demand_surface, concept_keys, competitor_refs,
 * alternative_refs, intent_type), budgets, pagination, or job/run ids into
 * the identity. Only fields proven (by reading each adapter's discover()
 * method) to change the actual public result set participate.
 */

export const MARKET_PARTITION_IDENTITY_VERSION = "market_partition_identity_v1" as const;

export const marketPartitionIneligibleReasons = [
  "adapter_side_product_filter",
  "product_parameterized_review_import",
  "explicit_url_fetch",
  "non_production_source",
  "unclassified_source",
] as const;
export type MarketPartitionIneligibleReason = (typeof marketPartitionIneligibleReasons)[number];

/**
 * Positive per-source allowlist of `requestMetadata` fields proven (by
 * reading the adapter's `discover()` method) to change which public items
 * are returned. Everything else - planner metadata, tenant context, budgets,
 * pagination, job/run scoping - is excluded by construction: fields not
 * listed here can never enter `retrieval_spec`, including fields added to
 * `requestMetadata` after this module was written.
 *
 * Known imprecision (documented, not fixed here): Stack Exchange sends
 * windowStart/windowEnd to the provider as literal `fromdate`/`todate`
 * query parameters (src/server/providers/source/stack-exchange/index.ts),
 * and Product Hunt sends them as literal `postedAfter`/`postedBefore`
 * GraphQL variables (src/server/providers/source/product-hunt/index.ts) -
 * for these two sources the time window is actually part of the executed
 * retrieval, not just a refresh-cadence concern, but per architecture
 * direction window fields are excluded from identity for every source in
 * v1. This means Stack Exchange/Product Hunt partitions with different
 * windows collapse onto the same key even though their executed requests
 * differed. Acceptable for an observational stage; revisit before any
 * stage that skips provider calls based on partition freshness.
 */
const PARAM_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  x: ["postId", "lang", "from", "to", "hasLinks", "excludeRetweets", "excludeReplies"],
  github: ["contentType", "repository", "owner", "org", "includeComments", "discussionCategory"],
  reddit: ["subreddit", "community", "sort", "time", "excludeNsfw", "commentSort"],
  bluesky: ["lang", "langs", "sort", "tag"],
  "stack-exchange": ["site", "sites"],
  youtube: ["includeReplies"],
  gitlab: ["includeDiscussions"],
  "product-hunt": ["includeComments"],
  // Layer 12A.3A: only HN Search v2 (Algolia) participates - see the
  // `providerQuery` guard below. `executionMode` is included so a partition
  // created under one Hacker News retrieval implementation can never collapse
  // onto (or be confused with) one from a different implementation.
  "hacker-news": ["executionMode"],
};

const INELIGIBLE_REASON_BY_SOURCE: Readonly<Record<string, MarketPartitionIneligibleReason>> = {
  g2: "product_parameterized_review_import",
  trustpilot: "product_parameterized_review_import",
  "public-web": "explicit_url_fetch",
  fixture: "non_production_source",
};

export type MarketPartitionRetrievalSpec = {
  v: typeof MARKET_PARTITION_IDENTITY_VERSION;
  source_key: string;
  expression: string;
  params: Record<string, unknown>;
  expandThreads: boolean;
};

export type MarketPartitionIdentity =
  | { eligible: true; partitionKey: string; partitionId: string; identityVersion: typeof MARKET_PARTITION_IDENTITY_VERSION; retrievalSpec: MarketPartitionRetrievalSpec }
  | { eligible: false; reason: MarketPartitionIneligibleReason };

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function allowedParams(sourceKey: string, requestMetadata: Record<string, unknown>): Record<string, unknown> {
  const allowlist = PARAM_ALLOWLIST[sourceKey] ?? [];
  const result: Record<string, unknown> = {};
  for (const field of allowlist) {
    if (requestMetadata[field] !== undefined) result[field] = requestMetadata[field];
  }
  return result;
}

/**
 * Derives the market partition identity for one already-compiled provider
 * request. Call once per request (not per page) with the request exactly as
 * it will be sent to `IngestionService.discoverSource` for its first page -
 * i.e. after any source-specific request preparation (Stack Exchange) but
 * before per-page cursor assignment and before operational scoping
 * (`requestScopedToScan`), so scan/job/workspace context never participates.
 */
export function deriveMarketPartitionIdentity(input: { sourceKey: string; request: SourceDiscoveryRequest }): MarketPartitionIdentity {
  const ineligibleReason = INELIGIBLE_REASON_BY_SOURCE[input.sourceKey];
  if (ineligibleReason) return { eligible: false, reason: ineligibleReason };
  if (!(input.sourceKey in PARAM_ALLOWLIST)) return { eligible: false, reason: "unclassified_source" };

  const metadata = objectValue(input.request.requestMetadata);

  // Hacker News keeps one canonical source identity across two retrieval
  // implementations: the legacy Firebase newest-stories feed (client-side
  // lexical filter over an unparameterized fetch - no literal provider query,
  // so the actual public result set is not determined by this request) and
  // HN Search v2 (Algolia; a literal, faithful search query). `executionMode`
  // (not `providerQuery`) is the eligibility signal because it is the field
  // in `PARAM_ALLOWLIST["hacker-news"]` that actually round-trips through a
  // refresh rebuild (`buildMarketPartitionRefreshRequest` restores stored
  // `retrievalSpec.params` into `requestMetadata`, but never re-wraps the
  // stored expression as `providerQuery`) - a request with `providerQuery`
  // but a stripped/legacy `executionMode` must not become eligible. No other
  // source is affected.
  if (input.sourceKey === "hacker-news" && metadata.executionMode !== "algolia_search_v2") {
    return { eligible: false, reason: "adapter_side_product_filter" };
  }

  const providerExpression = typeof metadata.providerQuery === "string" ? metadata.providerQuery : input.request.query ?? "";
  const expression = collapseWhitespace(providerExpression);
  const retrievalSpec: MarketPartitionRetrievalSpec = {
    v: MARKET_PARTITION_IDENTITY_VERSION,
    source_key: input.sourceKey,
    expression,
    params: allowedParams(input.sourceKey, metadata),
    expandThreads: input.request.expandThreads,
  };
  const partitionKey = `${MARKET_PARTITION_IDENTITY_VERSION}:${sha256Json(retrievalSpec)}`;
  return {
    eligible: true,
    partitionKey,
    partitionId: deterministicUuid(`market-partition:${partitionKey}`),
    identityVersion: MARKET_PARTITION_IDENTITY_VERSION,
    retrievalSpec,
  };
}
