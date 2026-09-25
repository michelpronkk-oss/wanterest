import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The service's default dependencies are replaced in every test; these mocks
// only keep the real module graph (Supabase/Trigger/providers) out of the test.
vi.mock("@/server/providers/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/server/modules/onboarding/initial-scan.service", () => ({ getScanProduct: vi.fn(), processScanCandidates: vi.fn() }));
vi.mock("@/server/modules/demand-intelligence/demand.orchestration", () => ({ rebuildDemandIntelligenceForScan: vi.fn() }));
vi.mock("@/server/modules/ingestion/public-ingestion.service", () => ({
  provenanceFromTemplate: (template: Record<string, unknown>, ids: string[]) => ids.map((conversationId) => ({ ...template, conversationId })),
}));

const { matchRefreshedPartitionIncrementally } = await import("../../src/server/modules/operations/incremental-product-matching.service");

const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REFRESH_JOB = "11111111-1111-4111-8111-111111111111";
const PARTITION_KEY = "market_partition_identity_v1:abc";
const C1 = "c0000000-0000-4000-8000-000000000001";
const C2 = "c0000000-0000-4000-8000-000000000002";
const C3 = "c0000000-0000-4000-8000-000000000003";
const S1 = "50000000-0000-4000-8000-000000000001";

type Job = { id: string; job_type: string; idempotency_key: string; status: string; attempt_count: number; input_reference: unknown; workspace_id: string | null; product_id: string | null };

function template(queryPlanId = "qp-github-pain") {
  return { queryPlanId, source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: ["category"], competitorSpecific: false };
}

function makeRepository(state: { refresh: Job | null; artifacts: Array<Record<string, unknown>>; matched: Map<string, Set<string>> }) {
  const jobs: Job[] = [];
  let id = 1;
  return {
    jobs,
    repository: {
      getRefreshJob: vi.fn(async () => state.refresh),
      getJob: vi.fn(async (jobType: string, key: string) => jobs.find((job) => job.job_type === jobType && job.idempotency_key === key) ?? null),
      startJob: vi.fn(async (input: { jobType: string; idempotencyKey: string; workspaceId: string | null; productId: string | null; inputReference: unknown }) => {
        const existing = jobs.find((job) => job.job_type === input.jobType && job.idempotency_key === input.idempotencyKey);
        if (existing) { existing.status = "running"; existing.attempt_count += 1; return existing; }
        const job: Job = { id: `job-${id++}`, job_type: input.jobType, idempotency_key: input.idempotencyKey, status: "running", attempt_count: 1, input_reference: input.inputReference, workspace_id: input.workspaceId, product_id: input.productId };
        jobs.push(job);
        return job;
      }),
      completeJob: vi.fn(async (jobId: string, input: { status: string; inputReference: unknown }) => {
        const job = jobs.find((row) => row.id === jobId)!;
        job.status = input.status;
        job.input_reference = input.inputReference;
      }),
      listInterestArtifacts: vi.fn(async (partitionKey: string) => state.artifacts.filter((row) => row.partitionKey === partitionKey).map((row) => ({ ...row }))),
      listMatchedConversationIds: vi.fn(async (input: { workspaceId: string; productId: string; conversationIds: string[] }) =>
        new Set([...(state.matched.get(`${input.workspaceId}:${input.productId}`) ?? [])].filter((conversationId) => input.conversationIds.includes(conversationId)))),
    },
  };
}

function artifact(workspaceId: string, productId: string, createdAt = "2026-09-25T03:00:00.000Z", provenance: unknown = template()) {
  return { id: `art-${workspaceId.slice(0, 1)}-${productId}`, workspaceId, productId, jobRunId: `scan-${productId}`, queryPlanId: "qp-github-pain", sourceKey: "github", createdAt, discoveryProvenance: provenance, partitionKey: PARTITION_KEY };
}

function product(workspaceId: string, id: string, overrides: Record<string, unknown> = {}) {
  return { id, workspace_id: workspaceId, name: `Product ${id}`, status: "active", current_demand_profile_id: `profile-${id}`, current_snapshot_id: null, slug: id, website_url: null, created_at: "", updated_at: "", ...overrides };
}

function refreshJob(conversationIds: string[] | null = [C1, C2, C3], status = "succeeded"): Job {
  return {
    id: REFRESH_JOB, job_type: "refresh-market-partition", idempotency_key: "refresh", status, attempt_count: 1, workspace_id: null, product_id: null,
    input_reference: { partitionKey: PARTITION_KEY, sourceKey: "github", policyVersion: "market_partition_refresh_policy_v1", request: {}, result: { executionStatus: "completed_with_results", rawItems: 10, rawNewItems: 2, normalizedItems: 3, conversations: 3, estimatedCostUsd: null, durationMs: 100, ...(conversationIds ? { conversationIds, normalizedSourceItemIds: [S1] } : {}) } },
  };
}

function processResult(conversationIds: string[], signals = 0) {
  return {
    conversationCount: conversationIds.length, analyses: conversationIds.length, evaluations: conversationIds.length, rankings: signals, signals,
    evaluationIds: conversationIds.map((conversationId) => `eval-${conversationId}`),
    signalIds: conversationIds.map((conversationId, index) => (index < signals ? `signal-${conversationId}` : null)),
    candidateReviews: [], diagnostics: [],
    outcomes: conversationIds.map((conversationId, index) => ({ conversationId, selected: true, evaluated: true, qualificationStatus: index < signals ? "qualified" : "rejected" })),
    candidateSelection: { selectedCount: conversationIds.length },
  };
}

describe("matchRefreshedPartitionIncrementally (Stage 2D)", () => {
  let processCandidates: ReturnType<typeof vi.fn>;
  let rebuildDemand: ReturnType<typeof vi.fn>;
  let loadProduct: ReturnType<typeof vi.fn>;
  const now = () => new Date("2026-09-25T06:00:00.000Z");

  beforeEach(() => {
    processCandidates = vi.fn(async (input: { conversationIds: string[] }) => processResult(input.conversationIds));
    rebuildDemand = vi.fn(async () => ({ observationsUpdated: 1, mapUpdated: 1, gapUpdated: 0, driftUpdated: 0, warnings: [] }));
    loadProduct = vi.fn(async (workspaceId: string, productId: string) => product(workspaceId, productId));
  });

  it("evaluates only interested products, only on never-matched evidence, with the product's own provenance and the frozen cap", async () => {
    const { repository, jobs } = makeRepository({
      refresh: refreshJob(),
      artifacts: [artifact(WS_A, "prod-a")],
      matched: new Map([[`${WS_A}:prod-a`, new Set([C2])]]),
    });
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { repository, loadProduct, processCandidates, rebuildDemand, now } as never);

    expect(outcome.status).toBe("succeeded");
    expect(outcome.consideredProductCount).toBe(1);
    expect(loadProduct).toHaveBeenCalledTimes(1);
    expect(loadProduct).toHaveBeenCalledWith(WS_A, "prod-a");
    expect(processCandidates).toHaveBeenCalledTimes(1);
    const call = processCandidates.mock.calls[0][0];
    expect(call.conversationIds).toEqual([C1, C3]);
    expect(call.maxLlmEvaluations).toBe(15);
    expect(call.profileId).toBe("profile-prod-a");
    expect(call.provenance).toEqual([{ ...template(), conversationId: C1 }, { ...template(), conversationId: C3 }]);
    expect(call.normalizedSourceItemIds).toEqual([S1]);
    expect(outcome.products[0]).toMatchObject({ status: "succeeded", alreadyMatchedCount: 1, candidateCount: 2, evaluations: 2, signals: 0, demandRebuilt: false });
    const productJob = jobs.find((job) => job.job_type === "match-product-incremental")!;
    expect(productJob).toMatchObject({ workspace_id: WS_A, product_id: "prod-a", idempotency_key: `match-product-incremental:${REFRESH_JOB}:prod-a`, status: "succeeded" });
    const fanoutJob = jobs.find((job) => job.job_type === "match-partition-incremental")!;
    expect(fanoutJob).toMatchObject({ workspace_id: null, product_id: null, status: "succeeded" });
  });

  it("never loads or evaluates a product without interest in the partition (no all-product fanout)", async () => {
    const { repository } = makeRepository({ refresh: refreshJob(), artifacts: [artifact(WS_A, "prod-a")], matched: new Map() });
    await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { repository, loadProduct, processCandidates, rebuildDemand, now } as never);
    const touched = loadProduct.mock.calls.map((args) => `${args[0]}:${args[1]}`);
    expect(touched).toEqual([`${WS_A}:prod-a`]);
    expect(repository.listInterestArtifacts).toHaveBeenCalledWith(PARTITION_KEY, "2026-09-11T06:00:00.000Z", 1000);
  });

  it("keeps tenants isolated: each evaluation runs under the interest row's own workspace", async () => {
    const { repository } = makeRepository({ refresh: refreshJob(), artifacts: [artifact(WS_A, "prod-a"), artifact(WS_B, "prod-b", "2026-09-24T00:00:00.000Z")], matched: new Map() });
    await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { repository, loadProduct, processCandidates, rebuildDemand, now } as never);
    const scopes = processCandidates.mock.calls.map((args) => `${args[0].product.workspace_id}:${args[0].product.id}`);
    expect(scopes).toEqual([`${WS_A}:prod-a`, `${WS_B}:prod-b`]);
    expect(repository.listMatchedConversationIds.mock.calls.map((args) => `${args[0].workspaceId}:${args[0].productId}`)).toEqual([`${WS_A}:prod-a`, `${WS_B}:prod-b`]);
  });

  it("refuses a loaded product whose scope does not match the interest row", async () => {
    loadProduct = vi.fn(async () => product(WS_B, "prod-a"));
    const { repository } = makeRepository({ refresh: refreshJob(), artifacts: [artifact(WS_A, "prod-a")], matched: new Map() });
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { repository, loadProduct, processCandidates, rebuildDemand, now } as never);
    expect(processCandidates).not.toHaveBeenCalled();
    expect(outcome.skipped).toContainEqual({ workspaceId: WS_A, productId: "prod-a", reason: "product_scope_mismatch" });
  });

  it("skips inactive products and products without a demand profile", async () => {
    loadProduct = vi.fn(async (workspaceId: string, productId: string) => {
      if (productId === "archived") throw new Error("Archived products cannot be scanned.");
      return product(workspaceId, productId, { current_demand_profile_id: null });
    });
    const { repository } = makeRepository({ refresh: refreshJob(), artifacts: [artifact(WS_A, "archived"), artifact(WS_A, "no-profile")], matched: new Map() });
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { repository, loadProduct, processCandidates, rebuildDemand, now } as never);
    expect(processCandidates).not.toHaveBeenCalled();
    expect(outcome.skipped.map((entry) => entry.reason).sort()).toEqual(["demand_profile_missing", "product_unavailable"]);
  });

  it("does no evaluation work when everything the refresh surfaced is already matched", async () => {
    const { repository } = makeRepository({ refresh: refreshJob(), artifacts: [artifact(WS_A, "prod-a")], matched: new Map([[`${WS_A}:prod-a`, new Set([C1, C2, C3])]]) });
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { repository, loadProduct, processCandidates, rebuildDemand, now } as never);
    expect(processCandidates).not.toHaveBeenCalled();
    expect(rebuildDemand).not.toHaveBeenCalled();
    expect(outcome.products[0]).toMatchObject({ status: "succeeded", reason: "no_new_evidence", candidateCount: 0, alreadyMatchedCount: 3 });
  });

  it("re-aggregates demand only when new signals materialized", async () => {
    processCandidates = vi.fn(async (input: { conversationIds: string[] }) => processResult(input.conversationIds, 1));
    const { repository } = makeRepository({ refresh: refreshJob(), artifacts: [artifact(WS_A, "prod-a")], matched: new Map() });
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { repository, loadProduct, processCandidates, rebuildDemand, now } as never);
    expect(rebuildDemand).toHaveBeenCalledTimes(1);
    expect(rebuildDemand.mock.calls[0][0].evaluationIds).toEqual([`eval-${C1}`, `eval-${C2}`, `eval-${C3}`]);
    expect(outcome.products[0]).toMatchObject({ signals: 1, qualifiedCount: 1, demandRebuilt: true, signalIds: [`signal-${C1}`] });
    expect(outcome.totals).toMatchObject({ signals: 1, evaluations: 3, candidateConversations: 3, productsWithNewEvidence: 1 });
  });

  it("is idempotent on replay: a succeeded fanout never re-evaluates", async () => {
    const { repository, jobs } = makeRepository({ refresh: refreshJob(), artifacts: [artifact(WS_A, "prod-a")], matched: new Map() });
    const deps = { repository, loadProduct, processCandidates, rebuildDemand, now } as never;
    const first = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, deps);
    const second = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, deps);
    expect(processCandidates).toHaveBeenCalledTimes(1);
    expect(second.reason).toBe("already_succeeded");
    expect(second.fanoutJobRunId).toBe(first.fanoutJobRunId);
    expect(jobs.filter((job) => job.job_type === "match-product-incremental")).toHaveLength(1);
    expect(jobs.filter((job) => job.job_type === "match-partition-incremental")).toHaveLength(1);
  });

  it("retries only the failed product after a partial failure", async () => {
    let failB = true;
    processCandidates = vi.fn(async (input: { product: { id: string }; conversationIds: string[] }) => {
      if (input.product.id === "prod-b" && failB) throw new Error("transient failure");
      return processResult(input.conversationIds);
    });
    const { repository } = makeRepository({ refresh: refreshJob(), artifacts: [artifact(WS_A, "prod-a"), artifact(WS_B, "prod-b", "2026-09-24T00:00:00.000Z")], matched: new Map() });
    const deps = { repository, loadProduct, processCandidates, rebuildDemand, now } as never;
    const first = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, deps);
    expect(first.status).toBe("failed");
    failB = false;
    const second = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, deps);
    expect(second.status).toBe("succeeded");
    expect(second.products.find((entry) => entry.productId === "prod-a")?.status).toBe("replayed");
    expect(second.products.find((entry) => entry.productId === "prod-b")?.status).toBe("succeeded");
    expect(processCandidates.mock.calls.filter((args) => args[0].product.id === "prod-a")).toHaveLength(1);
  });

  it("does nothing for refreshes that did not succeed or predate stored evidence", async () => {
    for (const refresh of [null, refreshJob(null), refreshJob([C1], "failed"), refreshJob([])]) {
      const { repository, jobs } = makeRepository({ refresh, artifacts: [artifact(WS_A, "prod-a")], matched: new Map() });
      const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { repository, loadProduct, processCandidates, rebuildDemand, now } as never);
      expect(outcome.status).toBe("skipped");
      expect(jobs).toHaveLength(0);
    }
    expect(processCandidates).not.toHaveBeenCalled();
  });

  it("enforces the product fanout ceiling", async () => {
    const artifacts = Array.from({ length: 4 }, (_, index) => artifact(WS_A, `prod-${index}`, `2026-09-2${index}T00:00:00.000Z`));
    const { repository } = makeRepository({ refresh: refreshJob(), artifacts, matched: new Map() });
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { repository, loadProduct, processCandidates, rebuildDemand, now, maxProducts: 2 } as never);
    expect(processCandidates).toHaveBeenCalledTimes(2);
    expect(outcome.interestedProductCount).toBe(4);
    expect(outcome.skipped.filter((entry) => entry.reason === "fanout_cap")).toHaveLength(2);
  });
});
