import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The only thing that would use the service client here is the telemetry writer; record every table it touches.
const clientCalls: string[] = [];
vi.mock("@/server/providers/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ from: (table: string) => { clientCalls.push(table); throw new Error("unexpected client use"); } }),
}));
vi.mock("@/server/modules/onboarding/initial-scan.service", () => ({ getScanProduct: vi.fn(), processScanCandidates: vi.fn() }));
vi.mock("@/server/modules/demand-intelligence/demand.orchestration", () => ({ rebuildDemandIntelligenceForScan: vi.fn() }));
vi.mock("@/server/modules/actions/action.orchestration", () => ({ generateActionsForScan: vi.fn(async () => ({ actionsUpdated: 0, warnings: [] })) }));
vi.mock("@/server/modules/ingestion/public-ingestion.service", () => ({
  provenanceFromTemplate: (template: Record<string, unknown>, ids: string[]) => ids.map((conversationId) => ({ ...template, conversationId })),
}));

const { matchRefreshedPartitionIncrementally } = await import("../../src/server/modules/operations/incremental-product-matching.service");
const { deterministicUuid } = await import("../../src/server/modules/ingestion/hash");
import type { ProductFactInput, SignalSupplyTelemetryWriter } from "../../src/server/modules/operations/signal-supply-telemetry";

const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REFRESH_JOB = "11111111-1111-4111-8111-111111111111";
const PARTITION_KEY = "market_partition_identity_v1:abc";
const C = ["c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002", "c0000000-0000-4000-8000-000000000003", "c0000000-0000-4000-8000-000000000004"];

type Job = { id: string; job_type: string; idempotency_key: string; status: string; attempt_count: number; input_reference: unknown; workspace_id: string | null; product_id: string | null };

function harness(matched: string[] = [C[0]]) {
  const jobs: Job[] = [];
  let id = 1;
  const refresh: Job = {
    id: REFRESH_JOB, job_type: "refresh-market-partition", idempotency_key: "refresh", status: "succeeded", attempt_count: 1, workspace_id: null, product_id: null,
    input_reference: { partitionKey: PARTITION_KEY, sourceKey: "github", policyVersion: "market_partition_refresh_policy_v1", request: {}, result: { executionStatus: "completed_with_results", rawItems: 4, rawNewItems: 3, normalizedItems: 4, conversations: 4, estimatedCostUsd: null, durationMs: 100, conversationIds: C, normalizedSourceItemIds: [] } },
  };
  const repository = {
    getRefreshJob: vi.fn(async () => refresh),
    getJob: vi.fn(async (jobType: string, key: string) => jobs.find((job) => job.job_type === jobType && job.idempotency_key === key) ?? null),
    startJob: vi.fn(async (input: { jobType: string; idempotencyKey: string; workspaceId: string | null; productId: string | null; inputReference: unknown }) => {
      const existing = jobs.find((job) => job.job_type === input.jobType && job.idempotency_key === input.idempotencyKey);
      if (existing) { existing.status = "running"; return existing; }
      const job: Job = { id: `job-${id++}`, job_type: input.jobType, idempotency_key: input.idempotencyKey, status: "running", attempt_count: 1, input_reference: input.inputReference, workspace_id: input.workspaceId, product_id: input.productId };
      jobs.push(job);
      return job;
    }),
    completeJob: vi.fn(async (jobId: string, input: { status: string; inputReference: unknown }) => { const job = jobs.find((row) => row.id === jobId)!; job.status = input.status; job.input_reference = input.inputReference; }),
    listInterestArtifacts: vi.fn(async () => [{ id: "art-1", workspaceId: WS, productId: "prod-a", jobRunId: "scan-1", queryPlanId: "qp", sourceKey: "github", createdAt: "2026-09-25T03:00:00.000Z", discoveryProvenance: { queryPlanId: "qp", source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: ["category"], competitorSpecific: false } }]),
    listMatchedConversationIds: vi.fn(async (input: { conversationIds: string[] }) => new Set(matched.filter((conversationId) => input.conversationIds.includes(conversationId)))),
  };
  const processCandidates = vi.fn(async (input: { conversationIds: string[] }) => ({
    conversationCount: input.conversationIds.length, analyses: input.conversationIds.length, evaluations: input.conversationIds.length, rankings: 1, signals: 1,
    evaluationIds: input.conversationIds.map((conversationId) => `eval-${conversationId}`),
    signalIds: input.conversationIds.map((conversationId, index) => (index === 0 ? `signal-${conversationId}` : null)),
    candidateReviews: [], diagnostics: [],
    outcomes: input.conversationIds.map((conversationId, index) => ({ conversationId, selected: true, evaluated: true, qualificationStatus: index === 0 ? "qualified" : index === 1 ? "weak_candidate" : "rejected" })),
    candidateSelection: { selectedCount: input.conversationIds.length },
    semanticReasoningShadow: { llmExecutedCount: 2, reasoningCostUsd: 0.004 },
  }));
  const rebuildDemand = vi.fn(async () => ({ observationsUpdated: 1, mapUpdated: 1, gapUpdated: 0, driftUpdated: 0, warnings: [], clustering: { clusteringVersion: "demand_clustering_v1", strengthVersion: "x", evaluationsConsidered: 5, clustersCreated: 1, membershipsCreated: 2, statesAppended: 1, unclustered: {} } }));
  const loadProduct = vi.fn(async (workspaceId: string, productId: string) => ({ id: productId, workspace_id: workspaceId, current_demand_profile_id: "profile-a" }));
  const deps = { repository, loadProduct, processCandidates, rebuildDemand, now: () => new Date("2026-09-26T01:00:00.000Z") };
  return { jobs, deps, processCandidates, rebuildDemand };
}

function recordingWriter(options: { throws?: boolean } = {}) {
  const products: ProductFactInput[] = [];
  const writer: SignalSupplyTelemetryWriter = {
    recordRefresh: vi.fn(async () => ({ written: true })),
    recordProduct: vi.fn(async (input) => { if (options.throws) throw new Error("telemetry down"); products.push(input); return { written: true }; }),
    countNewCanonical: vi.fn(async () => null),
  };
  return { writer, products };
}

const strip = (outcome: Awaited<ReturnType<typeof matchRefreshedPartitionIncrementally>>) => ({
  ...outcome, durationMs: 0, fanoutJobRunId: null,
  products: outcome.products.map((product) => ({ ...product, durationMs: 0, jobRunId: null })),
});

describe("Layer 12A.1 product supply facts (incremental matching)", () => {
  beforeEach(() => { clientCalls.length = 0; delete process.env.SIGNAL_SUPPLY_TELEMETRY_ENABLED; });

  it("flag OFF (default): zero telemetry reads or writes", async () => {
    const { deps } = harness();
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, deps as never);
    expect(outcome.status).toBe("succeeded");
    expect(clientCalls).toEqual([]);
  });

  it("flag ON: one fact per product job that reconciles exactly with the job result and outcomes", async () => {
    const { deps, jobs } = harness();
    const { writer, products } = recordingWriter();
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, telemetry: writer } as never);
    expect(products).toHaveLength(1);
    const fact = products[0];
    const productJob = jobs.find((job) => job.job_type === "match-product-incremental")!;
    const stored = productJob.input_reference as Record<string, number>;
    // Authoritative source = the finalized match-product-incremental job row.
    expect(fact).toMatchObject({
      workspaceId: WS, productId: "prod-a", jobRunId: productJob.id, refreshJobRunId: REFRESH_JOB, partitionKey: PARTITION_KEY, sourceKey: "github",
      marketPartitionId: deterministicUuid(`market-partition:${PARTITION_KEY}`),
      refreshConversationCount: stored.refreshConversationCount, alreadyMatchedCount: stored.alreadyMatchedCount, candidateCount: stored.candidateCount,
      overflowCount: stored.overflowCount, selectedCount: stored.selectedCount, evaluatedCount: stored.evaluations, materializedCount: stored.signals,
      demandRebuilt: true, clustersCreated: 1, clusterMembershipsCreated: 2, reasoningCalls: 2, reasoningCostUsd: 0.004,
    });
    expect(fact.outcomeStatuses.filter((status) => status === "qualified")).toHaveLength(outcome.products[0].qualifiedCount);
    expect(fact.outcomeStatuses).toEqual(["qualified", "weak_candidate", "rejected"]);
  });

  it("qualification isolation: telemetry ON vs OFF yields identical selection inputs, decisions, signals and rebuilds", async () => {
    const off = harness();
    const on = harness();
    const offOutcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, off.deps as never);
    const onOutcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...on.deps, telemetry: recordingWriter().writer } as never);
    expect(strip(onOutcome)).toEqual(strip(offOutcome));
    expect(on.processCandidates.mock.calls).toEqual(off.processCandidates.mock.calls);
    expect(on.rebuildDemand.mock.calls).toEqual(off.rebuildDemand.mock.calls);
    const noTiming = (value: unknown) => JSON.parse(JSON.stringify(value, (key, entry) => (key === "durationMs" ? 0 : entry)));
    expect(noTiming(on.jobs.map((job) => job.input_reference))).toEqual(noTiming(off.jobs.map((job) => job.input_reference)));
  });

  it("replay writes no second fact; a failing telemetry writer never fails the match", async () => {
    const { deps } = harness();
    const { writer, products } = recordingWriter();
    await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, telemetry: writer } as never);
    await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, telemetry: writer } as never);
    expect(products).toHaveLength(1);

    const failing = harness();
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...failing.deps, telemetry: recordingWriter({ throws: true }).writer } as never);
    expect(outcome.status).toBe("succeeded");
    expect(outcome.products[0].status).toBe("succeeded");
  });

  it("no new evidence: measured zeros (not unknowns) and no reasoning or clustering attributed", async () => {
    const { deps } = harness(C);
    const { writer, products } = recordingWriter();
    await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, telemetry: writer } as never);
    expect(products[0]).toMatchObject({ candidateCount: 0, evaluatedCount: 0, materializedCount: 0, demandRebuilt: false, clustersCreated: 0, clusterMembershipsCreated: 0, reasoningCalls: 0, outcomeStatuses: [] });
  });

  it("clustering not observable after a rebuild is recorded as unknown (null), never as zero", async () => {
    const { deps, rebuildDemand } = harness();
    rebuildDemand.mockResolvedValueOnce({ observationsUpdated: 1, mapUpdated: 1, gapUpdated: 0, driftUpdated: 0, warnings: [] } as never);
    const { writer, products } = recordingWriter();
    await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, telemetry: writer } as never);
    expect(products[0]).toMatchObject({ demandRebuilt: true, clustersCreated: null, clusterMembershipsCreated: null });
  });
});
