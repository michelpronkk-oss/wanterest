import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// In-memory job_runs fake - enough of the real Supabase query surface for
// market-partition-refresh.service.ts's own direct job_runs calls (the
// repository itself is mocked separately below).
type JobRunFake = {
  id: string;
  job_type: string;
  idempotency_key: string;
  workspace_id: string | null;
  product_id: string | null;
  status: string;
  attempt_count: number;
  input_reference: unknown;
  trace_id: string;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_details: unknown;
};

let jobRuns: JobRunFake[] = [];
let nextId = 1;

function jobRunsClient() {
  return {
    from(table: string) {
      if (table !== "job_runs") throw new Error(`unexpected table in test fake: ${table}`);
      return {
        select: () => ({
          eq: (field1: string, value1: unknown) => ({
            eq: (field2: string, value2: unknown) => ({
              maybeSingle: async () => {
                const row = jobRuns.find((candidate) => (candidate as unknown as Record<string, unknown>)[field1] === value1 && (candidate as unknown as Record<string, unknown>)[field2] === value2);
                return { data: row ?? null, error: null };
              },
            }),
          }),
        }),
        insert: (row: Partial<JobRunFake>) => ({
          select: () => ({
            single: async () => {
              const created: JobRunFake = {
                id: `job-${nextId++}`,
                job_type: row.job_type as string,
                idempotency_key: row.idempotency_key as string,
                workspace_id: row.workspace_id ?? null,
                product_id: row.product_id ?? null,
                status: row.status as string,
                attempt_count: row.attempt_count as number,
                input_reference: row.input_reference ?? {},
                trace_id: row.trace_id as string,
                started_at: (row.started_at as string) ?? null,
                completed_at: null,
                error_code: null,
                error_details: null,
              };
              jobRuns.push(created);
              return { data: created, error: null };
            },
          }),
        }),
        update: (patch: Partial<JobRunFake>) => {
          const applyAndReturn = (row: JobRunFake | undefined) => {
            if (!row) return { data: null, error: null };
            Object.assign(row, patch);
            return { data: row, error: null };
          };
          const chain = {
            eq: (field: string, value: unknown) => {
              const row = jobRuns.find((candidate) => (candidate as unknown as Record<string, unknown>)[field] === value);
              return {
                select: () => ({ single: async () => applyAndReturn(row) }),
                then: (resolve: (value: { data: JobRunFake | null; error: null }) => void) => resolve(applyAndReturn(row) as { data: JobRunFake | null; error: null }),
              };
            },
          };
          return chain;
        },
      };
    },
  };
}

vi.mock("@/server/providers/supabase/service", () => ({ createSupabaseServiceClient: () => jobRunsClient() }));

const getStateRow = vi.fn();
const getMarketPartitionById = vi.fn();
const claim = vi.fn();
const recordSuccess = vi.fn();
const recordFailure = vi.fn();
const recordDeferral = vi.fn();
const disable = vi.fn();
const countDistinctInterests = vi.fn(async () => 0);

vi.mock("@/server/modules/ingestion/market-partition-refresh.repository", () => ({
  MarketPartitionRefreshRepository: vi.fn().mockImplementation(() => ({
    getStateRow,
    getMarketPartitionById,
    claim,
    recordSuccess,
    recordFailure,
    recordDeferral,
    disable,
    countDistinctInterests,
  })),
}));

const ingestPublicPartitionMock = vi.fn();
vi.mock("@/server/modules/ingestion/public-ingestion.service", () => ({ ingestPublicPartition: ingestPublicPartitionMock }));

const { refreshMarketPartition } = await import("../../src/server/modules/ingestion/market-partition-refresh.service");

const PARTITION_ID = "33333333-3333-4333-8333-333333333333";

function baseState(overrides: Partial<{ next_due_at: string; consecutive_failures: number }> = {}) {
  return {
    partition_id: PARTITION_ID,
    source_key: "github",
    enabled: true,
    disabled_reason: null,
    next_due_at: "2026-01-01T00:00:00.000Z",
    lease_token: null,
    lease_expires_at: null,
    last_attempt_at: null,
    last_success_at: null,
    last_failure_at: null,
    consecutive_failures: 0,
    last_job_run_id: null,
    ...overrides,
  };
}

function validPartition(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTITION_ID,
    source_key: "github",
    identity_version: "market_partition_identity_v1",
    partition_key: "market_partition_identity_v1:__will_be_overwritten__",
    retrieval_spec: { v: "market_partition_identity_v1", source_key: "github", expression: "is:issue slow onboarding repo:acme/product", params: { repository: "acme/product", contentType: "issues" }, expandThreads: false },
    ...overrides,
  };
}

async function computeRealPartitionKey(sourceKey: string, retrievalSpec: Record<string, unknown>) {
  const { deriveMarketPartitionIdentity } = await import("../../src/server/modules/ingestion/market-partition-identity");
  const { sourceDiscoveryRequestSchema } = await import("../../src/server/providers/source/contracts");
  const identity = deriveMarketPartitionIdentity({ sourceKey, request: sourceDiscoveryRequestSchema.parse({ query: retrievalSpec.expression, expandThreads: retrievalSpec.expandThreads, limit: 10, requestMetadata: { ...(retrievalSpec.params as Record<string, unknown>), maxPages: 1 } }) });
  if (!identity.eligible) throw new Error("expected eligible");
  return identity.partitionKey;
}

describe("refreshMarketPartition", () => {
  beforeEach(() => {
    jobRuns = [];
    nextId = 1;
    getStateRow.mockReset();
    getMarketPartitionById.mockReset();
    claim.mockReset();
    recordSuccess.mockReset();
    recordFailure.mockReset();
    recordDeferral.mockReset();
    disable.mockReset();
    countDistinctInterests.mockReset();
    countDistinctInterests.mockResolvedValue(0);
    ingestPublicPartitionMock.mockReset();
  });

  it("does nothing when no refresh state row exists", async () => {
    getStateRow.mockResolvedValueOnce(null);
    const result = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });
    expect(result.status).toBe("skipped");
    expect(claim).not.toHaveBeenCalled();
  });

  it("skips without provider calls when the lease cannot be claimed", async () => {
    getStateRow.mockResolvedValueOnce(baseState());
    claim.mockResolvedValueOnce(null);
    const result = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });
    expect(result.status).toBe("skipped");
    expect(ingestPublicPartitionMock).not.toHaveBeenCalled();
    expect(getMarketPartitionById).not.toHaveBeenCalled();
  });

  it("calls ingestPublicPartition with operationalContext limited to jobRunId only - no workspaceId, no productId", async () => {
    const partition = validPartition();
    partition.partition_key = await computeRealPartitionKey(partition.source_key, partition.retrieval_spec as Record<string, unknown>);
    getStateRow.mockResolvedValueOnce(baseState());
    claim.mockResolvedValueOnce(baseState());
    getMarketPartitionById.mockResolvedValueOnce(partition);
    ingestPublicPartitionMock.mockResolvedValueOnce({
      sourceKey: "github", rawSourceItemIds: ["raw-1"], normalizedSourceItemIds: ["norm-1"], conversationIds: ["conv-1"],
      provenance: [], rawInserted: 1, itemsReturned: 1, queryCount: 1, diagnostics: [], rateLimitRemaining: null, estimatedCost: null,
      queryTelemetry: [{ queryPlanId: "x", source: "github", family: "fallback", surface: "unknown", concepts: [], competitorSpecific: false, pagesRequested: 1, pagesCompleted: 1, cursorContinuationCount: 0, continuationStoppedReason: "no_cursor", executionStatus: "completed_with_results", rawItems: 1, normalizedItems: 1, uniqueConversations: 1, duplicateCount: 0, estimatedCostUsd: null, marketPartitionKey: partition.partition_key, marketPartitionIneligibleReason: null, rawNewItems: 1 }],
    });

    const result = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });

    expect(ingestPublicPartitionMock).toHaveBeenCalledTimes(1);
    const call = ingestPublicPartitionMock.mock.calls[0][0];
    expect(call.operationalContext).toEqual({ jobRunId: expect.any(String) });
    expect(call.sourceKey).toBe("github");
    expect(call.requests).toHaveLength(1);
    expect(result.status).toBe("succeeded");
    expect(result.rawItems).toBe(1);
    expect(result.rawNewItems).toBe(1);
    expect(result.normalizedItems).toBe(1);
    expect(result.conversations).toBe(1);
    expect(recordSuccess).toHaveBeenCalledTimes(1);

    // job_runs row created for this refresh must carry no workspace/product.
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0].workspace_id).toBeNull();
    expect(jobRuns[0].product_id).toBeNull();
    expect(jobRuns[0].job_type).toBe("refresh-market-partition");
    expect(jobRuns[0].status).toBe("succeeded");
  });

  it("persists the exact conversation and normalized ids it ingested on the refresh job (Stage 2D durable evidence)", async () => {
    const partition = validPartition();
    partition.partition_key = await computeRealPartitionKey(partition.source_key, partition.retrieval_spec as Record<string, unknown>);
    getStateRow.mockResolvedValueOnce(baseState());
    claim.mockResolvedValueOnce(baseState());
    getMarketPartitionById.mockResolvedValueOnce(partition);
    ingestPublicPartitionMock.mockResolvedValueOnce({
      sourceKey: "github", rawSourceItemIds: ["raw-1", "raw-2"], normalizedSourceItemIds: ["norm-2", "norm-1"], conversationIds: ["conv-2", "conv-1"],
      provenance: [], rawInserted: 1, itemsReturned: 2, queryCount: 1, diagnostics: [], rateLimitRemaining: null, estimatedCost: null,
      queryTelemetry: [{ queryPlanId: "x", source: "github", family: "fallback", surface: "unknown", concepts: [], competitorSpecific: false, pagesRequested: 1, pagesCompleted: 1, cursorContinuationCount: 0, continuationStoppedReason: "no_cursor", executionStatus: "completed_with_results", rawItems: 2, normalizedItems: 2, uniqueConversations: 2, duplicateCount: 0, estimatedCostUsd: null, marketPartitionKey: partition.partition_key, marketPartitionIneligibleReason: null, rawNewItems: 1 }],
    });

    await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });

    const stored = jobRuns[0].input_reference as { result: { conversationIds: string[]; normalizedSourceItemIds: string[] } };
    expect(stored.result.conversationIds).toEqual(["conv-1", "conv-2"]);
    expect(stored.result.normalizedSourceItemIds).toEqual(["norm-1", "norm-2"]);
  });

  it("disables the partition and calls no provider when the rebuilt request does not round-trip to the stored key", async () => {
    const partition = validPartition({ partition_key: "market_partition_identity_v1:deliberately-wrong-key" });
    getStateRow.mockResolvedValueOnce(baseState());
    claim.mockResolvedValueOnce(baseState());
    getMarketPartitionById.mockResolvedValueOnce(partition);

    const result = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });

    expect(ingestPublicPartitionMock).not.toHaveBeenCalled();
    expect(disable).toHaveBeenCalledTimes(1);
    expect(disable.mock.calls[0][0].reason).toBe("spec_roundtrip_mismatch");
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("spec_roundtrip_mismatch");
  });

  it("treats a source-control conflict as a deferral, not a failure - consecutive_failures is not incremented", async () => {
    const partition = validPartition();
    partition.partition_key = await computeRealPartitionKey(partition.source_key, partition.retrieval_spec as Record<string, unknown>);
    getStateRow.mockResolvedValueOnce(baseState());
    claim.mockResolvedValueOnce(baseState());
    getMarketPartitionById.mockResolvedValueOnce(partition);
    ingestPublicPartitionMock.mockResolvedValueOnce({
      sourceKey: "github", rawSourceItemIds: [], normalizedSourceItemIds: [], conversationIds: [], provenance: [], rawInserted: 0, itemsReturned: 0, queryCount: 1,
      diagnostics: ["query provider_error queryPlanId=x requestType=github_issue_search providerStatus=409 providerCode=CONFLICT message=Source github is degraded."],
      rateLimitRemaining: null, estimatedCost: null, failedQueryCount: 1, errorCode: "CONFLICT",
      queryTelemetry: [{ queryPlanId: "x", source: "github", family: "fallback", surface: "unknown", concepts: [], competitorSpecific: false, pagesRequested: 1, pagesCompleted: 0, cursorContinuationCount: 0, continuationStoppedReason: "error", executionStatus: "provider_error", rawItems: 0, normalizedItems: 0, uniqueConversations: 0, duplicateCount: 0, estimatedCostUsd: null, marketPartitionKey: partition.partition_key, marketPartitionIneligibleReason: null, rawNewItems: 0 }],
    });

    const result = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });

    expect(result.status).toBe("deferred");
    expect(recordDeferral).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });

  it("treats a non-conflict provider failure as a failure and applies backoff", async () => {
    const partition = validPartition();
    partition.partition_key = await computeRealPartitionKey(partition.source_key, partition.retrieval_spec as Record<string, unknown>);
    getStateRow.mockResolvedValueOnce(baseState({ consecutive_failures: 1 }));
    claim.mockResolvedValueOnce(baseState({ consecutive_failures: 1 }));
    getMarketPartitionById.mockResolvedValueOnce(partition);
    ingestPublicPartitionMock.mockResolvedValueOnce({
      sourceKey: "github", rawSourceItemIds: [], normalizedSourceItemIds: [], conversationIds: [], provenance: [], rawInserted: 0, itemsReturned: 0, queryCount: 1,
      diagnostics: [], rateLimitRemaining: null, estimatedCost: null, failedQueryCount: 1, errorCode: "RATE_LIMITED",
      queryTelemetry: [{ queryPlanId: "x", source: "github", family: "fallback", surface: "unknown", concepts: [], competitorSpecific: false, pagesRequested: 1, pagesCompleted: 0, cursorContinuationCount: 0, continuationStoppedReason: "error", executionStatus: "rate_limited", rawItems: 0, normalizedItems: 0, uniqueConversations: 0, duplicateCount: 0, estimatedCostUsd: null, marketPartitionKey: partition.partition_key, marketPartitionIneligibleReason: null, rawNewItems: 0 }],
    });

    const result = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });

    expect(result.status).toBe("failed");
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure.mock.calls[0][0].consecutiveFailures).toBe(2);
    expect(disable).not.toHaveBeenCalled();
  });

  it("hard-disables after reaching the max consecutive failure count", async () => {
    const partition = validPartition();
    partition.partition_key = await computeRealPartitionKey(partition.source_key, partition.retrieval_spec as Record<string, unknown>);
    getStateRow.mockResolvedValueOnce(baseState({ consecutive_failures: 4 }));
    claim.mockResolvedValueOnce(baseState({ consecutive_failures: 4 }));
    getMarketPartitionById.mockResolvedValueOnce(partition);
    ingestPublicPartitionMock.mockResolvedValueOnce({
      sourceKey: "github", rawSourceItemIds: [], normalizedSourceItemIds: [], conversationIds: [], provenance: [], rawInserted: 0, itemsReturned: 0, queryCount: 1,
      diagnostics: [], rateLimitRemaining: null, estimatedCost: null, failedQueryCount: 1, errorCode: "PROVIDER_ERROR",
      queryTelemetry: [{ queryPlanId: "x", source: "github", family: "fallback", surface: "unknown", concepts: [], competitorSpecific: false, pagesRequested: 1, pagesCompleted: 0, cursorContinuationCount: 0, continuationStoppedReason: "error", executionStatus: "provider_error", rawItems: 0, normalizedItems: 0, uniqueConversations: 0, duplicateCount: 0, estimatedCostUsd: null, marketPartitionKey: partition.partition_key, marketPartitionIneligibleReason: null, rawNewItems: 0 }],
    });

    await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });

    expect(disable).toHaveBeenCalledTimes(1);
    expect(disable.mock.calls[0][0].reason).toBe("repeated_failure");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("treats a zero-result retrieval as success", async () => {
    const partition = validPartition();
    partition.partition_key = await computeRealPartitionKey(partition.source_key, partition.retrieval_spec as Record<string, unknown>);
    getStateRow.mockResolvedValueOnce(baseState());
    claim.mockResolvedValueOnce(baseState());
    getMarketPartitionById.mockResolvedValueOnce(partition);
    ingestPublicPartitionMock.mockResolvedValueOnce({
      sourceKey: "github", rawSourceItemIds: [], normalizedSourceItemIds: [], conversationIds: [], provenance: [], rawInserted: 0, itemsReturned: 0, queryCount: 1,
      diagnostics: [], rateLimitRemaining: null, estimatedCost: null,
      queryTelemetry: [{ queryPlanId: "x", source: "github", family: "fallback", surface: "unknown", concepts: [], competitorSpecific: false, pagesRequested: 1, pagesCompleted: 1, cursorContinuationCount: 0, continuationStoppedReason: "zero_results", executionStatus: "completed_zero_results", rawItems: 0, normalizedItems: 0, uniqueConversations: 0, duplicateCount: 0, estimatedCostUsd: null, marketPartitionKey: partition.partition_key, marketPartitionIneligibleReason: null, rawNewItems: 0 }],
    });

    const result = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });

    expect(result.status).toBe("succeeded");
    expect(recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not re-execute a due slot whose job already succeeded, and calls no provider", async () => {
    getStateRow.mockResolvedValue(baseState());
    jobRuns.push({
      id: "job-existing", job_type: "refresh-market-partition", idempotency_key: `refresh-market-partition:${PARTITION_ID}:2026-01-01T00:00:00.000Z`,
      workspace_id: null, product_id: null, status: "succeeded", attempt_count: 1,
      input_reference: { partitionKey: "market_partition_identity_v1:abc", sourceKey: "github", policyVersion: "market_partition_refresh_policy_v1", request: {}, result: { executionStatus: "completed_with_results", rawItems: 5, rawNewItems: 2, normalizedItems: 5, conversations: 3, estimatedCostUsd: null, durationMs: 120 } },
      trace_id: "t1", started_at: null, completed_at: null, error_code: null, error_details: null,
    });

    const result = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t2" });

    expect(ingestPublicPartitionMock).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "succeeded", jobRunId: "job-existing", rawItems: 5, rawNewItems: 2, normalizedItems: 5, conversations: 3 });
  });

  it("never calls any product/workspace-scoped repository during a refresh", async () => {
    const partition = validPartition();
    partition.partition_key = await computeRealPartitionKey(partition.source_key, partition.retrieval_spec as Record<string, unknown>);
    getStateRow.mockResolvedValueOnce(baseState());
    claim.mockResolvedValueOnce(baseState());
    getMarketPartitionById.mockResolvedValueOnce(partition);
    ingestPublicPartitionMock.mockResolvedValueOnce({
      sourceKey: "github", rawSourceItemIds: [], normalizedSourceItemIds: [], conversationIds: [], provenance: [], rawInserted: 0, itemsReturned: 0, queryCount: 1,
      diagnostics: [], rateLimitRemaining: null, estimatedCost: null,
      queryTelemetry: [{ queryPlanId: "x", source: "github", family: "fallback", surface: "unknown", concepts: [], competitorSpecific: false, pagesRequested: 1, pagesCompleted: 1, cursorContinuationCount: 0, continuationStoppedReason: "zero_results", executionStatus: "completed_zero_results", rawItems: 0, normalizedItems: 0, uniqueConversations: 0, duplicateCount: 0, estimatedCostUsd: null, marketPartitionKey: partition.partition_key, marketPartitionIneligibleReason: null, rawNewItems: 0 }],
    });

    await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t1" });

    // Only job_runs (global, workspace/product null) was touched by this test's fake client.
    expect(jobRuns.every((row) => row.workspace_id === null && row.product_id === null)).toBe(true);
  });
});
