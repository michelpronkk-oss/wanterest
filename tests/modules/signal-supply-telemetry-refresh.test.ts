import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type JobRunFake = { id: string; job_type: string; idempotency_key: string; workspace_id: string | null; product_id: string | null; status: string; attempt_count: number; input_reference: unknown; trace_id: string; started_at: string | null };
let jobRuns: JobRunFake[] = [];
let nextId = 1;
const otherTables: string[] = [];

function client() {
  return {
    from(table: string) {
      if (table !== "job_runs") { otherTables.push(table); throw new Error(`unexpected table: ${table}`); }
      return {
        select: () => ({ eq: (f1: string, v1: unknown) => ({ eq: (f2: string, v2: unknown) => ({ maybeSingle: async () => ({ data: jobRuns.find((row) => (row as unknown as Record<string, unknown>)[f1] === v1 && (row as unknown as Record<string, unknown>)[f2] === v2) ?? null, error: null }) }) }) }),
        insert: (row: Partial<JobRunFake>) => ({ select: () => ({ single: async () => {
          const created = { id: `job-${nextId++}`, job_type: row.job_type!, idempotency_key: row.idempotency_key!, workspace_id: null, product_id: null, status: row.status!, attempt_count: 1, input_reference: row.input_reference ?? {}, trace_id: row.trace_id!, started_at: row.started_at ?? null };
          jobRuns.push(created);
          return { data: created, error: null };
        } }) }),
        update: (patch: Partial<JobRunFake>) => ({ eq: (field: string, value: unknown) => {
          const row = jobRuns.find((candidate) => (candidate as unknown as Record<string, unknown>)[field] === value);
          const apply = () => { if (row) Object.assign(row, patch); return { data: row ?? null, error: null }; };
          return { select: () => ({ single: async () => apply() }), then: (resolve: (value: unknown) => void) => resolve(apply()) };
        } }),
      };
    },
  };
}
vi.mock("@/server/providers/supabase/service", () => ({ createSupabaseServiceClient: () => client() }));

const repo = {
  getStateRow: vi.fn(), getMarketPartitionById: vi.fn(), claim: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn(), recordDeferral: vi.fn(), disable: vi.fn(),
  countDistinctInterests: vi.fn(async () => 0), countRefreshJobsBySourceSince: vi.fn(async () => ({})), listDuePartitions: vi.fn(async () => []),
};
vi.mock("@/server/modules/ingestion/market-partition-refresh.repository", () => ({ MarketPartitionRefreshRepository: vi.fn().mockImplementation(() => repo) }));
const ingest = vi.fn();
vi.mock("@/server/modules/ingestion/public-ingestion.service", () => ({ ingestPublicPartition: ingest }));

const { refreshMarketPartition } = await import("../../src/server/modules/ingestion/market-partition-refresh.service");
const { deriveMarketPartitionIdentity } = await import("../../src/server/modules/ingestion/market-partition-identity");
const { sourceDiscoveryRequestSchema } = await import("../../src/server/providers/source/contracts");
import type { RefreshFactInput, SignalSupplyTelemetryWriter } from "../../src/server/modules/operations/signal-supply-telemetry";

const PARTITION_ID = "33333333-3333-4333-8333-333333333333";
const spec = { v: "market_partition_identity_v1", source_key: "github", expression: "is:issue slow onboarding", params: { contentType: "issues" }, expandThreads: false };

function partition() {
  const identity = deriveMarketPartitionIdentity({ sourceKey: "github", request: sourceDiscoveryRequestSchema.parse({ query: spec.expression, expandThreads: false, limit: 10, requestMetadata: { ...spec.params, maxPages: 1 } }) });
  if (!identity.eligible) throw new Error("expected eligible");
  return { id: PARTITION_ID, source_key: "github", identity_version: "market_partition_identity_v1", partition_key: identity.partitionKey, retrieval_spec: spec };
}

function ingestion(overrides: Record<string, unknown> = {}) {
  return {
    sourceKey: "github", rawSourceItemIds: ["r1", "r2", "r3"], normalizedSourceItemIds: ["n1", "n2", "n3"], conversationIds: ["c1", "c2", "c3"],
    provenance: [], rawInserted: 2, itemsReturned: 3, queryCount: 1, diagnostics: [], rateLimitRemaining: null, estimatedCost: null,
    providerMetrics: { requestCount: 2 },
    queryTelemetry: [{ queryPlanId: "x", source: "github", family: "fallback", surface: "unknown", concepts: [], competitorSpecific: false, pagesRequested: 1, pagesCompleted: 1, cursorContinuationCount: 0, continuationStoppedReason: "no_cursor", executionStatus: "completed_with_results", rawItems: 3, normalizedItems: 3, uniqueConversations: 3, duplicateCount: 0, estimatedCostUsd: null, marketPartitionKey: "k", marketPartitionIneligibleReason: null, rawNewItems: 2 }],
    ...overrides,
  };
}

function writer(options: { throws?: boolean } = {}) {
  const facts: RefreshFactInput[] = [];
  const telemetry: SignalSupplyTelemetryWriter = {
    recordRefresh: vi.fn(async (input) => { if (options.throws) throw new Error("telemetry down"); facts.push(input); return { written: true }; }),
    recordProduct: vi.fn(async () => ({ written: true })),
    countNewCanonical: vi.fn(async () => 1),
  };
  return { telemetry, facts };
}

function arm(next = "2026-09-26T00:00:00.000Z") {
  const state = { partition_id: PARTITION_ID, source_key: "github", enabled: true, next_due_at: next, consecutive_failures: 0, consecutive_zero_new: 0 };
  repo.getStateRow.mockResolvedValueOnce(state);
  repo.claim.mockResolvedValueOnce(state);
  repo.getMarketPartitionById.mockResolvedValueOnce(partition());
}

describe("Layer 12A.1 refresh supply facts", () => {
  beforeEach(() => {
    jobRuns = []; nextId = 1; otherTables.length = 0; ingest.mockReset();
    for (const fn of Object.values(repo)) (fn as ReturnType<typeof vi.fn>).mockClear();
    delete process.env.SIGNAL_SUPPLY_TELEMETRY_ENABLED;
  });

  it("flag OFF (default): the refresh touches no telemetry table and no conversations lookup", async () => {
    arm();
    ingest.mockResolvedValueOnce(ingestion());
    const outcome = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t" });
    expect(outcome.status).toBe("succeeded");
    expect(otherTables).toEqual([]);
  });

  it("flag ON: one fact per refresh job, reconciled with the finalized job result", async () => {
    arm();
    ingest.mockResolvedValueOnce(ingestion());
    const { telemetry, facts } = writer();
    const outcome = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t" }, { telemetry });
    expect(facts).toHaveLength(1);
    const stored = (jobRuns[0].input_reference as { result: Record<string, number> }).result;
    expect(jobRuns[0].status).toBe("succeeded");
    expect(facts[0]).toMatchObject({
      jobRunId: jobRuns[0].id, marketPartitionId: PARTITION_ID, sourceKey: "github", refreshStatus: "succeeded", executionStatus: "completed_with_results",
      rawItems: stored.rawItems, rawNewItems: stored.rawNewItems, normalizedItems: stored.normalizedItems, newCanonicalCount: 1, pagesCompleted: 1, providerRequestCount: 2,
      estimatedCost: null, durationMs: stored.durationMs, startedAt: jobRuns[0].started_at,
    });
    expect(new Set(facts[0].conversationIds).size).toBe(stored.conversations);
    expect(outcome.rawItems).toBe(stored.rawItems);
  });

  it("deferred and failed refreshes are recorded with their status; a replayed slot is not recorded again", async () => {
    arm("2026-09-26T01:00:00.000Z");
    ingest.mockResolvedValueOnce(ingestion({ failedQueryCount: 1, errorCode: "CONFLICT" }));
    const deferred = writer();
    expect((await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t" }, { telemetry: deferred.telemetry })).status).toBe("deferred");
    expect(deferred.facts.map((fact) => fact.refreshStatus)).toEqual(["deferred"]);

    arm("2026-09-26T02:00:00.000Z");
    ingest.mockResolvedValueOnce(ingestion({ failedQueryCount: 1, errorCode: "RATE_LIMITED" }));
    const failed = writer();
    expect((await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t" }, { telemetry: failed.telemetry })).status).toBe("failed");
    expect(failed.facts.map((fact) => fact.refreshStatus)).toEqual(["failed"]);

    arm("2026-09-26T03:00:00.000Z");
    ingest.mockResolvedValueOnce(ingestion());
    const first = writer();
    await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t" }, { telemetry: first.telemetry });
    repo.getStateRow.mockResolvedValueOnce({ partition_id: PARTITION_ID, next_due_at: "2026-09-26T03:00:00.000Z", consecutive_failures: 0 });
    const replay = writer();
    const replayed = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t" }, { telemetry: replay.telemetry });
    expect(replayed.reason).toBe("already_succeeded_for_slot");
    expect(first.facts).toHaveLength(1);
    expect(replay.facts).toHaveLength(0);
    expect(ingest).toHaveBeenCalledTimes(3);
  });

  it("a failing telemetry writer never changes the refresh outcome, state or cadence", async () => {
    arm();
    ingest.mockResolvedValueOnce(ingestion());
    const baseline = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t" }, { telemetry: writer().telemetry });
    const baselineSuccess = repo.recordSuccess.mock.calls[0][0];
    jobRuns = []; repo.recordSuccess.mockClear();
    arm();
    ingest.mockResolvedValueOnce(ingestion());
    const withFailure = await refreshMarketPartition({ partitionId: PARTITION_ID, traceId: "t" }, { telemetry: writer({ throws: true }).telemetry });
    const comparable = (value: Record<string, unknown>) => ({ ...value, durationMs: null, jobRunId: null });
    expect(comparable(withFailure)).toEqual(comparable(baseline));
    const normalize = (value: Record<string, unknown>) => ({ ...value, jobRunId: null, now: null, nextDueAt: null, leaseToken: null });
    expect(normalize(repo.recordSuccess.mock.calls[0][0])).toEqual(normalize(baselineSuccess));
  });
});
