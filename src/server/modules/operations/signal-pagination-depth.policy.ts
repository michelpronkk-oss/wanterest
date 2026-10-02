export const signalPaginationDepthV1Version = "signal_pagination_depth_v1" as const;
export const signalPaginationDepthV1MaxPagesPerQuery = 2;
export const signalPaginationDepthV1MaxContinuationsPerScan = 16;

export const signalPaginationContinuationReasons = [
  "eligible_high_novelty",
  "first_page_failed",
  "empty_first_page",
  "no_cursor",
  "page_budget_exhausted",
  "no_new_raw_evidence",
  "no_unique_provider_items",
  "no_independent_roots",
  "insufficient_root_attribution",
  "repetitive_provider_items",
  "repetitive_roots",
  "provider_rate_limit_exhausted",
  "scan_continuation_budget_exhausted",
] as const;
export type SignalPaginationContinuationReason = (typeof signalPaginationContinuationReasons)[number];

export type SignalPaginationContinuationStatus = "not_attempted" | "received" | "empty" | "repetitive" | "failed";

export type SignalPaginationFirstPageFacts = {
  failed: boolean;
  cursorAvailable: boolean;
  pageBudget: number;
  acceptedItems: number;
  insertedRawItems: number;
  uniqueProviderItems: number;
  attributableResults: number;
  independentRoots: number;
  repeatedRootAttributions: number;
  rateLimitRemaining: number | null;
  continuationBudgetRemaining: number;
};

export type SignalPaginationContinuationDecision = {
  eligible: boolean;
  reason: SignalPaginationContinuationReason;
  status: SignalPaginationContinuationStatus;
};

/**
 * The first release supports only one Algolia page continuation for HN Search v2.
 * The adapters with other cursor mechanisms remain on their existing path until
 * their total per-query request envelope can be bounded without repeating depth
 * expansions or paid batches.
 */
export function supportsSignalPaginationDepthV1(sourceKey: string, metadata: Record<string, unknown>): boolean {
  return sourceKey === "hacker-news" && metadata.executionMode === "algolia_search_v2";
}

/**
 * This is an acquisition-only gate. It is deliberately independent of evidence
 * eligibility, matching, qualification, and signal materialization, all of
 * which happen later in the canonical pipeline.
 */
export function decideSignalPaginationContinuation(input: SignalPaginationFirstPageFacts): SignalPaginationContinuationDecision {
  const reject = (reason: SignalPaginationContinuationReason): SignalPaginationContinuationDecision => ({ eligible: false, reason, status: "not_attempted" });
  if (input.failed) return reject("first_page_failed");
  if (!input.cursorAvailable) return reject("no_cursor");
  if (input.pageBudget <= 1) return reject("page_budget_exhausted");
  if (input.continuationBudgetRemaining <= 0) return reject("scan_continuation_budget_exhausted");
  if (input.rateLimitRemaining !== null && input.rateLimitRemaining <= 0) return reject("provider_rate_limit_exhausted");
  if (input.acceptedItems <= 0) return reject("empty_first_page");
  if (input.insertedRawItems <= 0) return reject("no_new_raw_evidence");
  if (input.uniqueProviderItems <= 0) return reject("no_unique_provider_items");
  if (input.attributableResults <= 0 || input.independentRoots <= 0) return reject("no_independent_roots");
  if (input.attributableResults < input.acceptedItems) return reject("insufficient_root_attribution");
  if (input.uniqueProviderItems * 2 < input.acceptedItems) return reject("repetitive_provider_items");
  if (input.repeatedRootAttributions * 2 > input.attributableResults) return reject("repetitive_roots");
  return { eligible: true, reason: "eligible_high_novelty", status: "not_attempted" };
}

/** One continuation is the hard ceiling; this classifies its results without permitting page three. */
export function classifySignalPaginationContinuation(input: {
  providerResultsReturned: number;
  acceptedItems: number;
  newProviderItems: number;
  firstSeenRootsInExecution: number;
}): Exclude<SignalPaginationContinuationStatus, "not_attempted" | "failed"> {
  if (input.providerResultsReturned <= 0 || input.acceptedItems <= 0) return "empty";
  if (input.newProviderItems <= 0 || input.firstSeenRootsInExecution <= 0) return "repetitive";
  return "received";
}
