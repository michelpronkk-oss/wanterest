import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Wanterest 1B Stage 2A behavior-preservation tests for the shared public-ingestion
// boundary. These exercise `ingestPublicPartition` in isolation (no real Supabase
// client, no real provider network calls) to prove the extracted discovery loop
// preserves exactly the request ordering, pagination/cursor semantics, dedup, and
// error handling that previously lived inline in `executeSourceDiscovery`.

const discoverSourceMock = vi.fn();
const replayDetailedMock = vi.fn();
type PartitionEnsureInput = { id: string; partitionKey: string; identityVersion: string; sourceKey: string; retrievalSpec: Record<string, unknown> };
const ensurePartitionMock = vi.fn(async (input: PartitionEnsureInput) => { void input; });

vi.mock("@/server/modules/ingestion/ingestion.service", () => ({
  IngestionService: vi.fn().mockImplementation(() => ({
    discoverSource: discoverSourceMock,
    replayDetailed: replayDetailedMock,
  })),
}));
vi.mock("@/server/modules/ingestion/ingestion.repository", () => ({ SupabaseIngestionRepository: vi.fn() }));
vi.mock("@/server/modules/operations/source-control.service", () => ({
  SourceControlService: vi.fn(),
  SupabaseSourceControlStore: vi.fn(),
}));
vi.mock("@/server/providers/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/server/providers/source/x/x.internal", () => ({
  getInternalXDiscoveryOverride: () => null,
  logInternalXDiscoveryOverride: vi.fn(),
}));
// Stage 2B: market-partition persistence is a real (mocked-away-by-default) side
// effect of ingestPublicPartition now. Default to a clean no-op so the Stage 2A
// behavior-preservation tests below stay exactly as they were.
vi.mock("@/server/modules/ingestion/market-partition.repository", () => ({
  MarketPartitionRepository: vi.fn().mockImplementation(() => ({ ensure: ensurePartitionMock })),
}));

const { ingestPublicPartition, mergeProviderMetrics } = await import("../../src/server/modules/ingestion/public-ingestion.service");
const { sourceDiscoveryRequestSchema } = await import("../../src/server/providers/source/contracts");

function req(overrides: { query?: string; limit?: number; requestMetadata?: Record<string, unknown> } = {}) {
  return sourceDiscoveryRequestSchema.parse({ query: "export", limit: 5, ...overrides });
}

function discoveryPage(overrides: Partial<{ rawSourceItemIds: string[]; rawInserted: number; rawDuplicates: number; rejected: number; nextCursor: string | undefined; diagnostics: string[]; providerMetrics: Record<string, unknown>; jobRunId: string; attemptCount: number; rawItemObservations: Array<{ rawSourceItemId: string; providerItemFingerprint: string; inserted: boolean }> }> = {}) {
  return {
    rawSourceItemIds: overrides.rawSourceItemIds ?? [],
    rawInserted: overrides.rawInserted ?? 0,
    rawDuplicates: overrides.rawDuplicates ?? 0,
    rejected: overrides.rejected ?? 0,
    jobRunId: overrides.jobRunId ?? "discovery-job",
    attemptCount: overrides.attemptCount ?? 1,
    rawItemObservations: overrides.rawItemObservations ?? [],
    diagnostics: overrides.diagnostics ?? [],
    nextCursor: overrides.nextCursor,
    ...(overrides.providerMetrics ? { providerMetrics: overrides.providerMetrics } : {}),
  };
}

function replayResult(overrides: Partial<{ normalizedSourceItemIds: string[]; canonicalizedConversationIds: string[]; rawSourceItemIds: string[] }> = {}) {
  const canonicalizedConversationIds = overrides.canonicalizedConversationIds ?? [];
  return {
    normalizedSourceItemIds: overrides.normalizedSourceItemIds ?? [],
    canonicalizedConversationIds,
    replayMappings: canonicalizedConversationIds.map((conversationId, index) => ({ rawSourceItemId: overrides.rawSourceItemIds?.[index], sourceItemId: `source-${index + 1}`, conversationId })),
  };
}

describe("ingestPublicPartition (Stage 2A shared public-ingestion boundary)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    discoverSourceMock.mockReset();
    replayDetailedMock.mockReset();
    ensurePartitionMock.mockReset();
    ensurePartitionMock.mockResolvedValue(undefined);
  });

  it("does not require workspaceId or productId to execute discovery and replay", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1 }));
    replayDetailedMock.mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }));

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req()],
      traceId: "trace-1",
    });

    expect(result.rawSourceItemIds).toEqual(["raw-1"]);
    expect(result.normalizedSourceItemIds).toEqual(["norm-1"]);
    expect(result.conversationIds).toEqual(["conv-1"]);
    expect(result.rawInserted).toBe(1);
    expect(result.itemsReturned).toBe(1);
    expect(result.queryCount).toBe(1);

    // Operational scoping (scanJobRunId / internalWorkspaceId) must never be stamped
    // onto the request when operationalContext is omitted - proves workspace/product
    // context is not required for the ingestion semantics themselves.
    const [, requestArg] = discoverSourceMock.mock.calls[0]!;
    expect(requestArg.requestMetadata?.scanJobRunId).toBeUndefined();
    expect(requestArg.requestMetadata?.internalWorkspaceId).toBeUndefined();
  });

  it("scopes the request to the job run only when operationalContext is provided", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage());
    replayDetailedMock.mockResolvedValueOnce(replayResult());

    await ingestPublicPartition({
      sourceKey: "github",
      requests: [req()],
      traceId: "trace-1",
      operationalContext: { jobRunId: "job-1", workspaceId: "workspace-1" },
    });

    const [, requestArg] = discoverSourceMock.mock.calls[0]!;
    expect(requestArg.requestMetadata?.scanJobRunId).toBe("job-1");
  });

  it("preserves the existing up-to-3-page cursor continuation loop and request ordering", async () => {
    discoverSourceMock
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1, nextCursor: "cursor-2" }))
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-2"], rawInserted: 1, nextCursor: "cursor-3" }))
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-3"], rawInserted: 1, nextCursor: "cursor-4" }));
    replayDetailedMock
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }))
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-2"], canonicalizedConversationIds: ["conv-2"] }))
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-3"], canonicalizedConversationIds: ["conv-3"] }));

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req({ requestMetadata: { maxPages: 5 } })],
      traceId: "trace-1",
    });

    // Capped at 3 pages even though the mock always returns another cursor and the
    // request asked for up to 5 - this is the existing, unchanged safety cap.
    expect(discoverSourceMock).toHaveBeenCalledTimes(3);
    expect(replayDetailedMock).toHaveBeenCalledTimes(3);
    expect(discoverSourceMock.mock.calls[1]![1].cursor).toBe("cursor-2");
    expect(discoverSourceMock.mock.calls[2]![1].cursor).toBe("cursor-3");
    expect(result.rawSourceItemIds).toEqual(["raw-1", "raw-2", "raw-3"]);
    expect(result.conversationIds).toEqual(["conv-1", "conv-2", "conv-3"]);
  });

  it("records per-query unique provider items and independent roots without persisting content or cursor values", async () => {
    vi.stubEnv("SOURCE_EXECUTION_OBSERVABILITY_ENABLED", "true");
    discoverSourceMock
      .mockResolvedValueOnce(discoveryPage({
        rawSourceItemIds: ["raw-1"], rawInserted: 1, nextCursor: "private-cursor-value",
        rawItemObservations: [{ rawSourceItemId: "raw-1", providerItemFingerprint: "provider-item-a", inserted: true }],
      }))
      .mockResolvedValueOnce(discoveryPage({
        rawSourceItemIds: ["raw-2", "raw-3"], rawInserted: 2,
        rawItemObservations: [
          { rawSourceItemId: "raw-2", providerItemFingerprint: "provider-item-a", inserted: true },
          { rawSourceItemId: "raw-3", providerItemFingerprint: "provider-item-b", inserted: true },
        ],
      }));
    replayDetailedMock
      .mockResolvedValueOnce(replayResult({ rawSourceItemIds: ["raw-1"], normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-a"] }))
      .mockResolvedValueOnce(replayResult({ rawSourceItemIds: ["raw-2", "raw-3"], normalizedSourceItemIds: ["norm-2", "norm-3"], canonicalizedConversationIds: ["conv-a", "conv-b"] }));

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req({ requestMetadata: { queryPlanId: "plan-1", maxPages: 2 } })],
      traceId: "trace-1",
    });

    expect(result.resultAttributions).toMatchObject([
      { rawSourceItemId: "raw-1", conversationId: "conv-a", firstProviderItemInExecution: true, firstRootInExecution: true },
      { rawSourceItemId: "raw-2", conversationId: "conv-a", firstProviderItemInExecution: false, firstRootInExecution: false },
      { rawSourceItemId: "raw-3", conversationId: "conv-b", firstProviderItemInExecution: true, firstRootInExecution: true },
    ]);
    expect(result.queryTelemetry[0]).toMatchObject({ pagesRequested: 2, pagesCompleted: 2, cursorContinuationCount: 1, continuationStoppedReason: "no_cursor", normalizedItems: 3, uniqueConversations: 2, duplicateCount: 1 });
    expect(JSON.stringify(result.resultAttributions)).not.toContain("private-cursor-value");
  });

  it("deduplicates repeated raw/normalized/conversation ids across requests", async () => {
    discoverSourceMock
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1 }))
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 0 }));
    replayDetailedMock
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }))
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }));

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req({ query: "a" }), req({ query: "b" })],
      traceId: "trace-1",
    });

    expect(result.rawSourceItemIds).toEqual(["raw-1"]);
    expect(result.normalizedSourceItemIds).toEqual(["norm-1"]);
    expect(result.conversationIds).toEqual(["conv-1"]);
    expect(result.queryCount).toBe(2);
  });

  it("records a provider failure without throwing, matching the prior error-mapping behavior", async () => {
    discoverSourceMock.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "RATE_LIMITED" }));

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req()],
      traceId: "trace-1",
    });

    expect(result.failedQueryCount).toBe(1);
    expect(result.errorCode).toBe("RATE_LIMITED");
    expect(result.queryTelemetry[0]?.executionStatus).toBe("rate_limited");
    expect(result.diagnostics[0]).toMatch(/^query provider_error/);
  });

  it("does not put normalized query text in durable provider error diagnostics", async () => {
    const privatePhrase = "private product launch pain";
    discoverSourceMock.mockRejectedValueOnce(Object.assign(new Error("provider rejected request"), { code: "INVALID_QUERY" }));
    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req({ query: privatePhrase, requestMetadata: { queryPlanId: `qp-github-pain-${privatePhrase.replaceAll(" ", "-")}` } })],
      traceId: "trace-private-query",
    });
    expect(result.diagnostics.join(" ")).not.toContain(privatePhrase);
    expect(result.diagnostics.join(" ")).not.toContain("qp-github-pain-private-product-launch-pain");
    expect(result.diagnostics.join(" ")).toMatch(/queryPlanId=[0-9a-f]{64}/);
  });

  it("reports zero-result completion status without treating it as a failure", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage());
    replayDetailedMock.mockResolvedValueOnce(replayResult());

    const result = await ingestPublicPartition({
      sourceKey: "github",
      requests: [req()],
      traceId: "trace-1",
    });

    expect(result.failedQueryCount).toBeUndefined();
    expect(result.queryTelemetry[0]?.executionStatus).toBe("completed_zero_results");
  });

  it("retains GitHub Depth V1 metrics through the public-ingestion result seam", async () => {
    const githubDepthV1 = {
      policyVersion: "github_depth_v1",
      rootsSeen: 1,
      eligibleRoots: 1,
      ineligibleRoots: 0,
      expandedRoots: 1,
      expansionCapSkips: 0,
      commentRequests: 1,
      commentsReturned: 1,
      commentsPersisted: 1,
      duplicateCommentsSkipped: 0,
      commentsDroppedFromIneligibleRoots: 0,
      rootsOutsideRefreshWindow: 0,
    };
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["root", "comment"], rawInserted: 2, providerMetrics: { githubDepthV1 } }));
    replayDetailedMock.mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["root", "comment"], canonicalizedConversationIds: ["thread-1"] }));

    const result = await ingestPublicPartition({ sourceKey: "github", requests: [req({ requestMetadata: { queryPlanVersion: "query_planning_v8" } })], traceId: "trace-1" });

    expect(result.providerMetrics).toEqual({ githubDepthV1 });
    expect(result.itemsReturned).toBe(2);
    expect(result.conversationIds).toEqual(["thread-1"]);
  });

  it("merges Stack Exchange depth telemetry across pages and selects V2 replay", async () => {
    const first = { policyVersion: "stack_exchange_depth_v1", searchRoots: 1, depthEligible: 1, depthExpanded: 1, depthRequests: 3, commentsLoaded: 2, commentsPersisted: 1, dropped: 0, deduplicated: 0, refreshSkips: 0, quotaSkips: 0, answersLoaded: 2, answersPersisted: 2 };
    const second = { ...first, searchRoots: 1, depthRequests: 2, commentsLoaded: 1, commentsPersisted: 1, answersLoaded: 1, answersPersisted: 1 };
    const merged: Record<string, unknown> = {};
    mergeProviderMetrics(merged, { stackExchangeDepthV1: first });
    mergeProviderMetrics(merged, { stackExchangeDepthV1: second });
    expect(merged.stackExchangeDepthV1).toMatchObject({ searchRoots: 2, depthRequests: 5, commentsLoaded: 3, commentsPersisted: 2, answersLoaded: 3, answersPersisted: 3 });
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["root"], rawInserted: 1, nextCursor: "next", providerMetrics: { stackExchangeDepthV1: first } }));
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["answer"], rawInserted: 1, providerMetrics: { stackExchangeDepthV1: second } }));
    replayDetailedMock.mockResolvedValue(replayResult({ normalizedSourceItemIds: ["item"], canonicalizedConversationIds: ["thread"] }));
    const result = await ingestPublicPartition({ sourceKey: "stack-exchange", requests: [req({ requestMetadata: { stackExchangeV2: true, maxPages: 2 } })], traceId: "trace-1" });
    expect(result.providerMetrics?.stackExchangeDepthV1).toMatchObject({ depthRequests: 5, answersPersisted: 3 });
    expect(replayDetailedMock.mock.calls[0]?.[0]).toMatchObject({ normalizationVersion: "stack-exchange-v2" });
  });

  it("retains Discourse Depth V1 telemetry and planner metadata through the shared seam", async () => {
    const discourseDepthV1 = { policyVersion: "discourse_depth_v1", searchRoots: 1, depthEligible: 1, depthExpanded: 1, depthRequests: 1, postsLoaded: 4, postsPersisted: 3, dropped: 1, deduplicated: 0, refreshSkips: 0, rateLimitSkips: 0, capSkips: 0 };
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["topic", "reply"], rawInserted: 2, providerMetrics: { discourseDepthV1 } }));
    replayDetailedMock.mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["topic", "reply"], canonicalizedConversationIds: ["discourse-thread"] }));
    const result = await ingestPublicPartition({ sourceKey: "discourse", requests: [req({ requestMetadata: { queryPlanVersion: "query_planning_v8", discourseV1: true, depthPolicyVersion: "discourse_depth_v1", maxPages: 2 } })], traceId: "trace-1" });
    expect(result.providerMetrics?.discourseDepthV1).toMatchObject({ depthRequests: 1, postsLoaded: 4, postsPersisted: 3 });
    expect(discoverSourceMock.mock.calls[0]?.[1]).toMatchObject({ requestMetadata: { queryPlanVersion: "query_planning_v8" } });
    expect(replayDetailedMock.mock.calls[0]?.[0]).toMatchObject({ normalizationVersion: "discourse-v1" });
  });
});

describe("ingestPublicPartition market-partition wiring (Stage 2B, observational)", () => {
  beforeEach(() => {
    discoverSourceMock.mockReset();
    replayDetailedMock.mockReset();
    ensurePartitionMock.mockReset();
    ensurePartitionMock.mockResolvedValue(undefined);
  });

  it("attaches a partition key and persists the partition for an eligible source", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1 }));
    replayDetailedMock.mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }));

    const result = await ingestPublicPartition({ sourceKey: "github", requests: [req()], traceId: "trace-1" });

    expect(ensurePartitionMock).toHaveBeenCalledTimes(1);
    const [ensureArg] = ensurePartitionMock.mock.calls[0]!;
    expect(ensureArg.sourceKey).toBe("github");
    expect(typeof ensureArg.partitionKey).toBe("string");
    expect(ensureArg.partitionKey.startsWith("market_partition_identity_v1:")).toBe(true);
    expect(result.queryTelemetry[0]?.marketPartitionKey).toBe(ensureArg.partitionKey);
    expect(result.queryTelemetry[0]?.marketPartitionIneligibleReason).toBeNull();
  });

  it("attaches the product-relative provenance template for an eligible partition, identical to replay provenance minus conversationId (Stage 2D)", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1 }));
    replayDetailedMock.mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }));
    const request = req({ requestMetadata: { queryPlanId: "qp-github-feature", demandSurface: "feature_demand", queryFamily: "feature_requirement", discoveryIntent: { concept_keys: ["project_management_features"] }, competitorSpecific: false } });

    const result = await ingestPublicPartition({ sourceKey: "github", requests: [request], traceId: "trace-1" });

    const [replayEntry] = result.provenance;
    const { conversationId, ...expectedTemplate } = replayEntry!;
    expect(conversationId).toBe("conv-1");
    expect(result.queryTelemetry[0]?.discoveryProvenance).toEqual(expectedTemplate);
    expect(result.queryTelemetry[0]?.discoveryProvenance).toMatchObject({ queryPlanId: "qp-github-feature", source: "github", demandSurface: "feature_demand" });
    expect(result.queryTelemetry[0]?.discoveryProvenance).not.toHaveProperty("conversationId");
  });

  it("attaches no provenance template for an ineligible source or a request without planner metadata", async () => {
    discoverSourceMock.mockResolvedValue(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1 }));
    replayDetailedMock.mockResolvedValue(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }));
    const planned = req({ requestMetadata: { queryPlanId: "qp-hn", demandSurface: "pain_first" } });
    const ineligible = await ingestPublicPartition({ sourceKey: "hacker-news", requests: [planned], traceId: "trace-1" });
    const unplanned = await ingestPublicPartition({ sourceKey: "github", requests: [req()], traceId: "trace-1" });
    expect(ineligible.queryTelemetry[0]?.discoveryProvenance).toBeUndefined();
    expect(unplanned.queryTelemetry[0]?.discoveryProvenance).toBeUndefined();
  });

  it("attaches an ineligible reason and never persists a partition for an ineligible source", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1 }));
    replayDetailedMock.mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }));

    const result = await ingestPublicPartition({ sourceKey: "hacker-news", requests: [req()], traceId: "trace-1" });

    expect(ensurePartitionMock).not.toHaveBeenCalled();
    expect(result.queryTelemetry[0]?.marketPartitionKey).toBeNull();
    expect(result.queryTelemetry[0]?.marketPartitionIneligibleReason).toBe("adapter_side_product_filter");
  });

  it("does not fail discovery when partition persistence fails", async () => {
    ensurePartitionMock.mockRejectedValueOnce(new Error("insert failed"));
    discoverSourceMock.mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1"], rawInserted: 1 }));
    replayDetailedMock.mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1"], canonicalizedConversationIds: ["conv-1"] }));

    const result = await ingestPublicPartition({ sourceKey: "github", requests: [req()], traceId: "trace-1" });

    expect(result.failedQueryCount).toBeUndefined();
    expect(result.queryTelemetry[0]?.executionStatus).toBe("completed_with_results");
    expect(result.rawSourceItemIds).toEqual(["raw-1"]);
    expect(result.diagnostics.some((message) => message.includes("market partition persistence skipped"))).toBe(true);
  });

  it("computes rawNewItems as the exact sum of discovery.rawInserted across pages, distinct from rawItems", async () => {
    discoverSourceMock
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-1", "raw-2"], rawInserted: 1, nextCursor: "cursor-2" }))
      .mockResolvedValueOnce(discoveryPage({ rawSourceItemIds: ["raw-3"], rawInserted: 0 }));
    replayDetailedMock
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-1", "norm-2"], canonicalizedConversationIds: ["conv-1", "conv-2"] }))
      .mockResolvedValueOnce(replayResult({ normalizedSourceItemIds: ["norm-3"], canonicalizedConversationIds: ["conv-3"] }));

    const result = await ingestPublicPartition({ sourceKey: "github", requests: [req({ requestMetadata: { maxPages: 2 } })], traceId: "trace-1" });

    expect(result.queryTelemetry[0]?.rawItems).toBe(3);
    expect(result.queryTelemetry[0]?.rawNewItems).toBe(1);
  });

  it("does not change the effective request sent to discoverSource", async () => {
    discoverSourceMock.mockResolvedValueOnce(discoveryPage());
    replayDetailedMock.mockResolvedValueOnce(replayResult());

    await ingestPublicPartition({ sourceKey: "github", requests: [req()], traceId: "trace-1" });

    const [, requestArg] = discoverSourceMock.mock.calls[0]!;
    expect(Object.keys(requestArg).sort()).toEqual(["expandThreads", "limit", "query", "requestMetadata"]);
    expect(requestArg.requestMetadata).not.toHaveProperty("marketPartitionKey");
  });
});
