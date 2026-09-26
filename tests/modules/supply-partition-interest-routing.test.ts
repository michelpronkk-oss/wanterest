import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const clientCalls: string[] = [];
vi.mock("@/server/providers/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => { clientCalls.push(table); throw new Error("unexpected client use"); },
    rpc: (name: string) => { clientCalls.push(`rpc:${name}`); throw new Error("unexpected rpc"); },
  }),
}));
vi.mock("@/server/modules/onboarding/initial-scan.service", () => ({ getScanProduct: vi.fn(), processScanCandidates: vi.fn() }));
vi.mock("@/server/modules/demand-intelligence/demand.orchestration", () => ({ rebuildDemandIntelligenceForScan: vi.fn() }));
vi.mock("@/server/modules/actions/action.orchestration", () => ({ generateActionsForScan: vi.fn(async () => ({ actionsUpdated: 0, warnings: [] })) }));
vi.mock("@/server/modules/ingestion/public-ingestion.service", () => ({
  provenanceFromTemplate: (template: Record<string, unknown>, ids: string[]) => ids.map((conversationId) => ({ ...template, conversationId })),
  discoveryProvenanceTemplate: vi.fn(),
}));

const { matchRefreshedPartitionIncrementally } = await import("../../src/server/modules/operations/incremental-product-matching.service");
const { MarketPartitionRefreshRepository } = await import("../../src/server/modules/ingestion/market-partition-refresh.repository");
import type { ActivePartitionInterest } from "../../src/server/modules/operations/supply-partition-interest.repository";

const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REFRESH_JOB = "11111111-1111-4111-8111-111111111111";
const PARTITION_KEY = "market_partition_identity_v1:abc";
const C = ["c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002"];
const NOW = new Date("2026-09-26T01:00:00.000Z");

type Job = { id: string; job_type: string; idempotency_key: string; status: string; attempt_count: number; input_reference: unknown; workspace_id: string | null; product_id: string | null };
const provenance = (queryPlanId: string) => ({ queryPlanId, source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: ["category"], competitorSpecific: false });

function harness(artifactProducts: string[] = ["prod-a"]) {
  const jobs: Job[] = [];
  let id = 1;
  const refresh = { id: REFRESH_JOB, status: "succeeded", input_reference: { partitionKey: PARTITION_KEY, sourceKey: "github", result: { conversationIds: C, normalizedSourceItemIds: [] } } };
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
    listInterestArtifacts: vi.fn(async () => artifactProducts.map((productId, index) => ({ id: `art-${index}`, workspaceId: WS, productId, jobRunId: `scan-${index}`, queryPlanId: `qp-scan-${index}`, sourceKey: "github", createdAt: "2026-09-25T03:00:00.000Z", discoveryProvenance: provenance(`qp-scan-${index}`) }))),
    listMatchedConversationIds: vi.fn(async () => new Set<string>()),
  };
  const processCandidates = vi.fn(async (input: { conversationIds: string[] }) => ({
    conversationCount: input.conversationIds.length, analyses: input.conversationIds.length, evaluations: input.conversationIds.length, rankings: 0, signals: 0,
    evaluationIds: input.conversationIds.map((conversationId) => `eval-${conversationId}`), signalIds: input.conversationIds.map(() => null),
    candidateReviews: [], diagnostics: [], outcomes: input.conversationIds.map((conversationId) => ({ conversationId, selected: true, evaluated: true, qualificationStatus: "rejected" })),
    candidateSelection: { selectedCount: input.conversationIds.length },
  }));
  const loadProduct = vi.fn(async (workspaceId: string, productId: string) => ({ id: productId, workspace_id: workspaceId, current_demand_profile_id: "profile" }));
  const deps = { repository, loadProduct, processCandidates, rebuildDemand: vi.fn(), now: () => NOW };
  return { jobs, deps, processCandidates, repository };
}

function explicit(productId: string, overrides: Partial<ActivePartitionInterest> = {}): ActivePartitionInterest {
  return { id: `interest-${productId}`, workspaceId: WS, productId, partitionKey: PARTITION_KEY, sourceKey: "github", origin: "planner_seed", originJobRunId: `scan-job-${productId}`, queryPlanId: `qp-seed-${productId}`, provenance: provenance(`qp-seed-${productId}`), renewedAt: "2026-09-26T00:00:00.000Z", expiresAt: "2026-10-10T00:00:00.000Z", ...overrides };
}

function interestsReader(rows: ActivePartitionInterest[]) {
  return { listActive: vi.fn(async (keys: string[]) => rows.filter((row) => keys.includes(row.partitionKey))) };
}

describe("Layer 12A.2 incremental matching interest lookup", () => {
  beforeEach(() => { clientCalls.length = 0; delete process.env.SUPPLY_PARTITION_SEEDING_ENABLED; delete process.env.SIGNAL_SUPPLY_TELEMETRY_ENABLED; });

  it("flag OFF (default): no explicit-interest read at all; routing is exactly the legacy scan-artifact behaviour", async () => {
    const { deps, jobs } = harness(["prod-a"]);
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, deps as never);
    expect(clientCalls).toEqual([]);
    expect(outcome.products.map((product) => product.productId)).toEqual(["prod-a"]);
    const productJob = jobs.find((job) => job.job_type === "match-product-incremental")!;
    expect(productJob.input_reference).not.toHaveProperty("interestOrigin");
  });

  it("flag ON: a planner-seeded interest routes new evidence to its product with the seed's own provenance", async () => {
    const { deps, jobs, processCandidates } = harness([]);
    const reader = interestsReader([explicit("prod-seed")]);
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, partitionInterests: reader } as never);
    expect(reader.listActive).toHaveBeenCalledWith([PARTITION_KEY], NOW.toISOString(), 1000);
    expect(outcome.status).toBe("succeeded");
    expect(outcome.products.map((product) => [product.productId, product.status])).toEqual([["prod-seed", "succeeded"]]);
    expect(outcome.skipped).toEqual([]);
    const provenanceArg = (processCandidates.mock.calls[0][0] as unknown as { provenance: Array<{ queryPlanId: string }> }).provenance;
    expect(new Set(provenanceArg.map((entry) => entry.queryPlanId))).toEqual(new Set(["qp-seed-prod-seed"]));
    const productJob = jobs.find((job) => job.job_type === "match-product-incremental")!;
    expect(productJob).toMatchObject({ workspace_id: WS, product_id: "prod-seed" });
    expect(productJob.input_reference).toMatchObject({ interestOrigin: "planner_seed", interestArtifactId: "interest-prod-seed", interestScanJobRunId: "scan-job-prod-seed" });
  });

  it("scan artifacts and explicit interests share one read path: one job per product, newest interest wins, each product isolated", async () => {
    const { deps, jobs } = harness(["prod-a"]);
    const reader = interestsReader([explicit("prod-a", { origin: "scan", queryPlanId: "qp-new", provenance: provenance("qp-new") }), explicit("prod-b")]);
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, partitionInterests: reader } as never);
    expect(outcome.interestedProductCount).toBe(2);
    expect(outcome.products.map((product) => product.productId).sort()).toEqual(["prod-a", "prod-b"]);
    expect(jobs.filter((job) => job.job_type === "match-product-incremental")).toHaveLength(2);
    const jobA = jobs.find((job) => job.product_id === "prod-a")!;
    expect(jobA.input_reference).toMatchObject({ interestOrigin: "scan", interestArtifactId: "interest-prod-a" });
  });

  it("provenance validation is unchanged: a corrupted explicit row is skipped as provenance_missing, never repaired", async () => {
    const { deps } = harness([]);
    const reader = interestsReader([explicit("prod-bad", { provenance: provenance("some-other-query") })]);
    const outcome = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, partitionInterests: reader } as never);
    expect(outcome.products).toEqual([]);
    expect(outcome.skipped).toEqual([{ workspaceId: WS, productId: "prod-bad", reason: "provenance_missing" }]);
  });

  it("the fanout cap applies across the union and replay is idempotent", async () => {
    const { deps, jobs } = harness(["prod-a"]);
    const reader = interestsReader(Array.from({ length: 5 }, (_, index) => explicit(`prod-${index}`, { renewedAt: `2026-09-26T00:0${index}:00.000Z` })));
    const first = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, partitionInterests: reader, maxProducts: 3 } as never);
    expect(first.consideredProductCount).toBe(3);
    expect(first.skipped.filter((skip) => skip.reason === "fanout_cap")).toHaveLength(3);
    const before = jobs.length;
    const replay = await matchRefreshedPartitionIncrementally({ refreshJobRunId: REFRESH_JOB, traceId: "t" }, { ...deps, partitionInterests: reader, maxProducts: 3 } as never);
    expect(replay.reason).toBe("already_succeeded");
    expect(jobs.length).toBe(before);
  });
});

type Row = Record<string, unknown>;
function makeTable(rows: Row[]) {
  return {
    select() {
      let filtered = [...rows];
      const builder = {
        eq(field: string, value: unknown) { filtered = filtered.filter((row) => row[field] === value); return builder; },
        lte(field: string, value: unknown) { filtered = filtered.filter((row) => (row[field] as string) <= (value as string)); return builder; },
        gte(field: string, value: unknown) { filtered = filtered.filter((row) => (row[field] as string) >= (value as string)); return builder; },
        in(field: string, values: unknown[]) { filtered = filtered.filter((row) => values.includes(row[field])); return builder; },
        or() { filtered = filtered.filter((row) => row.lease_expires_at === null); return builder; },
        order(field: string) { filtered.sort((a, b) => (a[field] as string).localeCompare(b[field] as string)); return builder; },
        async limit(count: number) { return { data: filtered.slice(0, count), error: null }; },
        async maybeSingle() { return { data: filtered[0] ?? null, error: null }; },
      };
      return builder;
    },
  };
}

describe("Layer 12A.2 scheduler sees seeded partitions through explicit interest", () => {
  const TICK = "2026-09-26T06:00:00.000Z";
  const state = [
    { partition_id: "p-seed", source_key: "github", enabled: true, next_due_at: "2026-09-26T00:00:00.000Z", lease_expires_at: null },
    { partition_id: "p-scan", source_key: "github", enabled: true, next_due_at: "2026-09-26T00:01:00.000Z", lease_expires_at: null },
    { partition_id: "p-recent", source_key: "stack-exchange", enabled: true, next_due_at: "2026-09-26T00:02:00.000Z", lease_expires_at: null },
    { partition_id: "p-retired", source_key: "github", enabled: false, next_due_at: "2026-09-26T00:03:00.000Z", lease_expires_at: null },
  ];
  const partitions = [
    { id: "p-seed", partition_key: "k-seed" }, { id: "p-scan", partition_key: "k-scan" }, { id: "p-recent", partition_key: "k-recent" }, { id: "p-retired", partition_key: "k-retired" },
  ];
  const yields = [
    { market_partition_key: "k-scan", created_at: "2026-09-20T00:00:00.000Z" },
    { market_partition_key: "k-recent", created_at: "2026-09-26T05:00:00.000Z" },
  ];
  const client = { from: (table: string) => makeTable(table === "market_partition_refresh_state" ? state : table === "market_partitions" ? partitions : yields) };

  it("without explicit interests (flag off) a seed-only partition is never due", async () => {
    const due = await new MarketPartitionRefreshRepository(client).listDuePartitions(TICK, 10);
    expect(due.map((row) => row.partitionId)).toEqual(["p-scan"]);
  });

  it("with explicit interests a seeded partition becomes due normally; recent-scan exclusion and disabled/retired rows still apply", async () => {
    const lookup = vi.fn(async (keys: string[]) => new Set(keys.filter((key) => ["k-seed", "k-recent", "k-retired"].includes(key))));
    const due = await new MarketPartitionRefreshRepository(client).listDuePartitions(TICK, 10, lookup);
    expect(due.map((row) => row.partitionId)).toEqual(["p-seed", "p-scan"]);
    expect(lookup).toHaveBeenCalledWith(["k-seed", "k-scan", "k-recent"]);
  });
});
