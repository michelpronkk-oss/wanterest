import { describe, expect, it, vi } from "vitest";
import { signalPaginationDepthV1Enabled } from "../../src/server/modules/operations/signal-pagination-depth.config";
import {
  classifySignalPaginationContinuation,
  decideSignalPaginationContinuation,
  signalPaginationDepthV1MaxContinuationsPerScan,
  signalPaginationDepthV1MaxPagesPerQuery,
  supportsSignalPaginationDepthV1,
  type SignalPaginationFirstPageFacts,
} from "../../src/server/modules/operations/signal-pagination-depth.policy";

vi.mock("server-only", () => ({}));

const usefulFirstPage: SignalPaginationFirstPageFacts = {
  failed: false,
  cursorAvailable: true,
  pageBudget: 3,
  acceptedItems: 4,
  insertedRawItems: 3,
  uniqueProviderItems: 4,
  attributableResults: 4,
  independentRoots: 3,
  repeatedRootAttributions: 1,
  rateLimitRemaining: null,
  continuationBudgetRemaining: 4,
};

describe("Signal Pagination / Depth V1 policy", () => {
  it("defaults the server-only feature flag off and accepts only the literal true value", () => {
    expect(signalPaginationDepthV1Enabled({})).toBe(false);
    expect(signalPaginationDepthV1Enabled({ SIGNAL_PAGINATION_DEPTH_V1_ENABLED: "false" })).toBe(false);
    expect(signalPaginationDepthV1Enabled({ SIGNAL_PAGINATION_DEPTH_V1_ENABLED: "true" })).toBe(true);
  });

  it("allows one continuation for an attributable, novel first page without consulting qualification", () => {
    expect(decideSignalPaginationContinuation(usefulFirstPage)).toEqual({ eligible: true, reason: "eligible_high_novelty", status: "not_attempted" });
  });

  it("does not continue an empty first page", () => {
    expect(decideSignalPaginationContinuation({ ...usefulFirstPage, acceptedItems: 0, insertedRawItems: 0, uniqueProviderItems: 0, attributableResults: 0, independentRoots: 0 }).reason).toBe("empty_first_page");
  });

  it("does not continue after a first-page provider error", () => {
    expect(decideSignalPaginationContinuation({ ...usefulFirstPage, failed: true }).reason).toBe("first_page_failed");
  });

  it("stops a page whose roots are majority repeats", () => {
    expect(decideSignalPaginationContinuation({ ...usefulFirstPage, acceptedItems: 5, attributableResults: 5, independentRoots: 2, repeatedRootAttributions: 3 }).reason).toBe("repetitive_roots");
  });

  it("requires inserted raw evidence, canonical attribution, and an available cursor", () => {
    expect(decideSignalPaginationContinuation({ ...usefulFirstPage, insertedRawItems: 0 }).reason).toBe("no_new_raw_evidence");
    expect(decideSignalPaginationContinuation({ ...usefulFirstPage, attributableResults: 3, acceptedItems: 4 }).reason).toBe("insufficient_root_attribution");
    expect(decideSignalPaginationContinuation({ ...usefulFirstPage, cursorAvailable: false }).reason).toBe("no_cursor");
  });

  it("honors the request page budget, provider rate state, and scan continuation ceiling", () => {
    expect(decideSignalPaginationContinuation({ ...usefulFirstPage, pageBudget: 1 }).reason).toBe("page_budget_exhausted");
    expect(decideSignalPaginationContinuation({ ...usefulFirstPage, rateLimitRemaining: 0 }).reason).toBe("provider_rate_limit_exhausted");
    expect(decideSignalPaginationContinuation({ ...usefulFirstPage, continuationBudgetRemaining: 0 }).reason).toBe("scan_continuation_budget_exhausted");
    expect(signalPaginationDepthV1MaxContinuationsPerScan).toBe(16);
    expect(signalPaginationDepthV1MaxPagesPerQuery).toBe(2);
  });

  it("supports only the single-page-resumable HN Algolia request mode", () => {
    expect(supportsSignalPaginationDepthV1("hacker-news", { executionMode: "algolia_search_v2" })).toBe(true);
    expect(supportsSignalPaginationDepthV1("hacker-news", { executionMode: "filtered_newstories_feed" })).toBe(false);
    for (const provider of ["github", "discourse", "stack-exchange", "x", "youtube"]) {
      expect(supportsSignalPaginationDepthV1(provider, { executionMode: "algolia_search_v2" })).toBe(false);
    }
  });

  it("classifies the one continuation from its own page counts and roots", () => {
    expect(classifySignalPaginationContinuation({ providerResultsReturned: 0, acceptedItems: 0, newProviderItems: 0, firstSeenRootsInExecution: 0 })).toBe("empty");
    expect(classifySignalPaginationContinuation({ providerResultsReturned: 4, acceptedItems: 4, newProviderItems: 3, firstSeenRootsInExecution: 0 })).toBe("repetitive");
    expect(classifySignalPaginationContinuation({ providerResultsReturned: 4, acceptedItems: 4, newProviderItems: 3, firstSeenRootsInExecution: 2 })).toBe("received");
  });
});
